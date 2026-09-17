import { mkdir, open, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  GoldPilotReadinessStateSchema,
  InMemoryGoldPilotReadinessStore,
  type GoldPilotReadinessState,
  type GoldPilotReadinessStore,
} from "@ronggang/agent-runtime";
import {
  GoldPilotConsentEventSchema,
  GoldPilotReadinessFreezeReceiptSchema,
  GoldPilotReadinessIdSchema,
  GoldPilotRubricResolutionRecordSchema,
  GoldPilotRubricReviewRecordSchema,
} from "@ronggang/contracts";
import { z } from "zod";

const IsoDateSchema = z.string().datetime();

const GoldPilotReadinessFrameSchema = z.discriminatedUnion("kind", [
  z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("plan_created"),
    state: GoldPilotReadinessStateSchema,
  }).strict(),
  z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("rubric_review_recorded"),
    readinessId: GoldPilotReadinessIdSchema,
    expectedRevision: z.number().int().positive(),
    record: GoldPilotRubricReviewRecordSchema,
    updatedAt: IsoDateSchema,
  }).strict(),
  z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("rubric_resolution_recorded"),
    readinessId: GoldPilotReadinessIdSchema,
    expectedRevision: z.number().int().positive(),
    record: GoldPilotRubricResolutionRecordSchema,
    updatedAt: IsoDateSchema,
  }).strict(),
  z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("consent_event_recorded"),
    readinessId: GoldPilotReadinessIdSchema,
    expectedRevision: z.number().int().positive(),
    event: GoldPilotConsentEventSchema,
    updatedAt: IsoDateSchema,
  }).strict(),
  z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("plan_frozen"),
    readinessId: GoldPilotReadinessIdSchema,
    expectedRevision: z.number().int().positive(),
    receipt: GoldPilotReadinessFreezeReceiptSchema,
    updatedAt: IsoDateSchema,
  }).strict(),
]);

type GoldPilotReadinessFrame = z.infer<
  typeof GoldPilotReadinessFrameSchema
>;

const pathLocks = new Map<string, Promise<void>>();
const pathRevisions = new Map<string, number>();

async function appendAndSync(
  path: string,
  frame: GoldPilotReadinessFrame,
): Promise<void> {
  const parsed = GoldPilotReadinessFrameSchema.parse(frame);
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

async function truncateAndSync(
  path: string,
  byteLength: number,
): Promise<void> {
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
      `试点采集前冻结日志第 ${lineNumber} 行损坏：不是有效 UTF-8`,
      { cause: error },
    );
  }
}

function parseFrame(
  line: string,
  lineNumber: number,
): GoldPilotReadinessFrame {
  try {
    return GoldPilotReadinessFrameSchema.parse(JSON.parse(line));
  } catch (error) {
    throw new Error(`试点采集前冻结日志第 ${lineNumber} 行损坏`, {
      cause: error,
    });
  }
}

async function readFrames(
  path: string,
): Promise<GoldPilotReadinessFrame[]> {
  let body: Buffer;
  try {
    body = await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  if (body.length === 0) return [];
  const frames: GoldPilotReadinessFrame[] = [];
  let lineStart = 0;
  let lineNumber = 1;
  for (let index = 0; index < body.length; index += 1) {
    if (body[index] !== 0x0a) continue;
    let lineEnd = index;
    if (lineEnd > lineStart && body[lineEnd - 1] === 0x0d) lineEnd -= 1;
    const line = decodeUtf8(body.subarray(lineStart, lineEnd), lineNumber);
    if (line.length === 0) {
      throw new Error(
        `试点采集前冻结日志第 ${lineNumber} 行损坏：不允许空帧`,
      );
    }
    frames.push(parseFrame(line, lineNumber));
    lineStart = index + 1;
    lineNumber += 1;
  }
  if (lineStart === body.length) return frames;
  try {
    const tail = decodeUtf8(body.subarray(lineStart), lineNumber);
    frames.push(parseFrame(tail, lineNumber));
  } catch {
    await truncateAndSync(path, lineStart);
    return frames;
  }
  await appendNewlineAndSync(path);
  return frames;
}

async function replayFrame(
  store: InMemoryGoldPilotReadinessStore,
  frame: GoldPilotReadinessFrame,
): Promise<void> {
  switch (frame.kind) {
    case "plan_created":
      await store.create(frame.state);
      return;
    case "rubric_review_recorded":
      await store.appendRubricReview({
        readinessId: frame.readinessId,
        expectedRevision: frame.expectedRevision,
        record: frame.record,
        updatedAt: frame.updatedAt,
      });
      return;
    case "rubric_resolution_recorded":
      await store.recordRubricResolution({
        readinessId: frame.readinessId,
        expectedRevision: frame.expectedRevision,
        record: frame.record,
        updatedAt: frame.updatedAt,
      });
      return;
    case "consent_event_recorded":
      await store.appendConsentEvent({
        readinessId: frame.readinessId,
        expectedRevision: frame.expectedRevision,
        event: frame.event,
        updatedAt: frame.updatedAt,
      });
      return;
    case "plan_frozen":
      await store.freeze({
        readinessId: frame.readinessId,
        expectedRevision: frame.expectedRevision,
        receipt: frame.receipt,
        updatedAt: frame.updatedAt,
      });
  }
}

/**
 * Append-only, fsync-backed adapter for pilot collection-readiness state.
 *
 * The journal contains aliases, structured decisions and hashes only. It does
 * not contain names, contact details, raw consent text, chat, recordings,
 * private memory or free-text withdrawal reasons.
 */
export class JsonlGoldPilotReadinessStore
implements GoldPilotReadinessStore {
  readonly #path: string;
  #cachedStore: InMemoryGoldPilotReadinessStore | null = null;
  #cachedRevision = -1;

  constructor(path: string) {
    this.#path = resolve(path);
  }

  create(
    state: GoldPilotReadinessState,
  ): Promise<GoldPilotReadinessState> {
    return this.#withStore(async (store) => {
      const result = await store.create(state);
      await appendAndSync(this.#path, {
        schemaVersion: 1,
        kind: "plan_created",
        state,
      });
      return result;
    }, true);
  }

  get(
    readinessId: string,
  ): Promise<GoldPilotReadinessState | null> {
    return this.#withStore((store) => store.get(readinessId));
  }

  list(sessionId: string): Promise<GoldPilotReadinessState[]> {
    return this.#withStore((store) => store.list(sessionId));
  }

  appendRubricReview(input: Parameters<
    GoldPilotReadinessStore["appendRubricReview"]
  >[0]): Promise<GoldPilotReadinessState> {
    return this.#withStore(async (store) => {
      const result = await store.appendRubricReview(input);
      await appendAndSync(this.#path, {
        schemaVersion: 1,
        kind: "rubric_review_recorded",
        ...input,
      });
      return result;
    }, true);
  }

  recordRubricResolution(input: Parameters<
    GoldPilotReadinessStore["recordRubricResolution"]
  >[0]): Promise<GoldPilotReadinessState> {
    return this.#withStore(async (store) => {
      const result = await store.recordRubricResolution(input);
      await appendAndSync(this.#path, {
        schemaVersion: 1,
        kind: "rubric_resolution_recorded",
        ...input,
      });
      return result;
    }, true);
  }

  appendConsentEvent(input: Parameters<
    GoldPilotReadinessStore["appendConsentEvent"]
  >[0]): Promise<GoldPilotReadinessState> {
    return this.#withStore(async (store) => {
      const result = await store.appendConsentEvent(input);
      await appendAndSync(this.#path, {
        schemaVersion: 1,
        kind: "consent_event_recorded",
        ...input,
      });
      return result;
    }, true);
  }

  freeze(input: Parameters<
    GoldPilotReadinessStore["freeze"]
  >[0]): Promise<GoldPilotReadinessState> {
    return this.#withStore(async (store) => {
      const result = await store.freeze(input);
      await appendAndSync(this.#path, {
        schemaVersion: 1,
        kind: "plan_frozen",
        ...input,
      });
      return result;
    }, true);
  }

  async #withStore<T>(
    operation: (store: InMemoryGoldPilotReadinessStore) => Promise<T>,
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
        const store = new InMemoryGoldPilotReadinessStore();
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
