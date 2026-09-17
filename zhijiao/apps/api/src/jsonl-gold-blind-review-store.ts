import { mkdir, open, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  GoldBlindReviewBatchStateSchema,
  InMemoryGoldBlindReviewBatchStore,
  type GoldBlindReviewBatchState,
  type GoldBlindReviewBatchStore,
} from "@ronggang/agent-runtime";
import {
  GoldBlindReviewFreezeReceiptSchema,
  GoldBlindReviewRecordSchema,
  GoldBlindReviewUnblindingReceiptSchema,
} from "@ronggang/contracts";
import { z } from "zod";

const IsoDateSchema = z.string().datetime();

const GoldBlindReviewFrameSchema = z.discriminatedUnion("kind", [
  z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("batch_created"),
    state: GoldBlindReviewBatchStateSchema,
  }).strict(),
  z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("review_appended"),
    batchId: z.string().regex(/^gbr_[a-f0-9]{24}$/u),
    expectedRevision: z.number().int().positive(),
    review: GoldBlindReviewRecordSchema,
    updatedAt: IsoDateSchema,
  }).strict(),
  z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("batch_frozen"),
    batchId: z.string().regex(/^gbr_[a-f0-9]{24}$/u),
    expectedRevision: z.number().int().positive(),
    receipt: GoldBlindReviewFreezeReceiptSchema,
    updatedAt: IsoDateSchema,
  }).strict(),
  z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("batch_unblinded"),
    batchId: z.string().regex(/^gbr_[a-f0-9]{24}$/u),
    expectedRevision: z.number().int().positive(),
    receipt: GoldBlindReviewUnblindingReceiptSchema,
    updatedAt: IsoDateSchema,
  }).strict(),
]);

type GoldBlindReviewFrame = z.infer<typeof GoldBlindReviewFrameSchema>;

const pathLocks = new Map<string, Promise<void>>();
const pathRevisions = new Map<string, number>();

async function appendAndSync(
  path: string,
  frame: GoldBlindReviewFrame,
): Promise<void> {
  const parsed = GoldBlindReviewFrameSchema.parse(frame);
  await mkdir(dirname(path), { recursive: true });
  const handle = await open(path, "a");
  try {
    await handle.writeFile(`${JSON.stringify(parsed)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function appendNewlineAndSync(path: string): Promise<void> {
  const handle = await open(path, "a");
  try {
    await handle.writeFile("\n", "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function truncateAndSync(path: string, byteLength: number): Promise<void> {
  const handle = await open(path, "r+");
  try {
    await handle.truncate(byteLength);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function decodeUtf8(bytes: Uint8Array, lineNumber: number): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error(
      `盲评工作流日志第 ${lineNumber} 行损坏：不是有效 UTF-8`,
      { cause: error },
    );
  }
}

function parseFrame(line: string, lineNumber: number): GoldBlindReviewFrame {
  try {
    return GoldBlindReviewFrameSchema.parse(JSON.parse(line));
  } catch (error) {
    throw new Error(`盲评工作流日志第 ${lineNumber} 行损坏`, {
      cause: error,
    });
  }
}

async function readFrames(path: string): Promise<GoldBlindReviewFrame[]> {
  let body: Buffer;
  try {
    body = await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  if (body.length === 0) return [];
  const frames: GoldBlindReviewFrame[] = [];
  let lineStart = 0;
  let lineNumber = 1;
  for (let index = 0; index < body.length; index += 1) {
    if (body[index] !== 0x0a) continue;
    let lineEnd = index;
    if (lineEnd > lineStart && body[lineEnd - 1] === 0x0d) lineEnd -= 1;
    const line = decodeUtf8(body.subarray(lineStart, lineEnd), lineNumber);
    if (line.length === 0) {
      throw new Error(`盲评工作流日志第 ${lineNumber} 行损坏：不允许空帧`);
    }
    frames.push(parseFrame(line, lineNumber));
    lineStart = index + 1;
    lineNumber += 1;
  }
  if (lineStart === body.length) return frames;
  let tailFrame: GoldBlindReviewFrame;
  try {
    const tail = decodeUtf8(body.subarray(lineStart), lineNumber);
    tailFrame = parseFrame(tail, lineNumber);
  } catch {
    await truncateAndSync(path, lineStart);
    return frames;
  }
  frames.push(tailFrame);
  await appendNewlineAndSync(path);
  return frames;
}

async function replayFrame(
  store: InMemoryGoldBlindReviewBatchStore,
  frame: GoldBlindReviewFrame,
): Promise<void> {
  switch (frame.kind) {
    case "batch_created":
      await store.create(frame.state);
      return;
    case "review_appended":
      await store.appendReview({
        batchId: frame.batchId,
        expectedRevision: frame.expectedRevision,
        review: frame.review,
        updatedAt: frame.updatedAt,
      });
      return;
    case "batch_frozen":
      await store.freeze({
        batchId: frame.batchId,
        expectedRevision: frame.expectedRevision,
        receipt: frame.receipt,
        updatedAt: frame.updatedAt,
      });
      return;
    case "batch_unblinded":
      await store.unblind({
        batchId: frame.batchId,
        expectedRevision: frame.expectedRevision,
        receipt: frame.receipt,
        updatedAt: frame.updatedAt,
      });
  }
}

/**
 * Append-only, fsync-backed adapter for blind-review workflow state.
 *
 * The canonical data-directory lease keeps production on one writer. A
 * process-wide path lock additionally serializes tests and duplicate adapter
 * instances, while semantic frames avoid repeating the private packet and
 * condition key for every submitted score.
 */
export class JsonlGoldBlindReviewBatchStore
implements GoldBlindReviewBatchStore {
  readonly #path: string;
  #cachedStore: InMemoryGoldBlindReviewBatchStore | null = null;
  #cachedRevision = -1;

  constructor(path: string) {
    this.#path = resolve(path);
  }

  create(state: GoldBlindReviewBatchState): Promise<GoldBlindReviewBatchState> {
    return this.#withStore(async (store) => {
      const result = await store.create(state);
      await appendAndSync(this.#path, {
        schemaVersion: 1,
        kind: "batch_created",
        state,
      });
      return result;
    }, true);
  }

  get(batchId: string): Promise<GoldBlindReviewBatchState | null> {
    return this.#withStore((store) => store.get(batchId));
  }

  list(sessionId: string): Promise<GoldBlindReviewBatchState[]> {
    return this.#withStore((store) => store.list(sessionId));
  }

  appendReview(input: {
    batchId: string;
    expectedRevision: number;
    review: Parameters<GoldBlindReviewBatchStore["appendReview"]>[0]["review"];
    updatedAt: string;
  }): Promise<GoldBlindReviewBatchState> {
    return this.#withStore(async (store) => {
      const result = await store.appendReview(input);
      await appendAndSync(this.#path, {
        schemaVersion: 1,
        kind: "review_appended",
        ...input,
      });
      return result;
    }, true);
  }

  freeze(input: {
    batchId: string;
    expectedRevision: number;
    receipt: Parameters<GoldBlindReviewBatchStore["freeze"]>[0]["receipt"];
    updatedAt: string;
  }): Promise<GoldBlindReviewBatchState> {
    return this.#withStore(async (store) => {
      const result = await store.freeze(input);
      await appendAndSync(this.#path, {
        schemaVersion: 1,
        kind: "batch_frozen",
        ...input,
      });
      return result;
    }, true);
  }

  unblind(input: {
    batchId: string;
    expectedRevision: number;
    receipt: Parameters<GoldBlindReviewBatchStore["unblind"]>[0]["receipt"];
    updatedAt: string;
  }): Promise<GoldBlindReviewBatchState> {
    return this.#withStore(async (store) => {
      const result = await store.unblind(input);
      await appendAndSync(this.#path, {
        schemaVersion: 1,
        kind: "batch_unblinded",
        ...input,
      });
      return result;
    }, true);
  }

  async #withStore<T>(
    operation: (store: InMemoryGoldBlindReviewBatchStore) => Promise<T>,
    mutation = false,
  ): Promise<T> {
    const previous = pathLocks.get(this.#path) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolveLock) => {
      release = resolveLock;
    });
    const queued = previous.then(() => current);
    pathLocks.set(this.#path, queued);
    await previous;
    try {
      const revision = pathRevisions.get(this.#path) ?? 0;
      if (!this.#cachedStore || this.#cachedRevision !== revision) {
        const store = new InMemoryGoldBlindReviewBatchStore();
        for (const frame of await readFrames(this.#path)) {
          await replayFrame(store, frame);
        }
        this.#cachedStore = store;
        this.#cachedRevision = revision;
      }
      try {
        const result = await operation(this.#cachedStore);
        if (mutation) {
          const nextRevision = (pathRevisions.get(this.#path) ?? 0) + 1;
          pathRevisions.set(this.#path, nextRevision);
          this.#cachedRevision = nextRevision;
        }
        return result;
      } catch (error) {
        if (mutation) {
          this.#cachedStore = null;
          this.#cachedRevision = -1;
        }
        throw error;
      }
    } finally {
      release();
      if (pathLocks.get(this.#path) === queued) {
        pathLocks.delete(this.#path);
      }
    }
  }
}
