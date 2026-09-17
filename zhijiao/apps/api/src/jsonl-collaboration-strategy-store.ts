import { mkdir, open, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  CollaborationStrategySchema,
  type CollaborationStrategy,
  type CollaborationStrategyQuery,
} from "@ronggang/contracts";
import { z } from "zod";
import {
  CollaborationStrategyError,
  CollaborationStrategyTransitionSchema,
  InMemoryCollaborationStrategyStore,
  canonicalJson,
  sha256Canonical,
  type CollaborationStrategyStore,
  type CollaborationStrategyTransition,
} from "./collaboration-strategy-store.js";

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const frameEnvelopeShape = {
  schemaVersion: z.literal(1),
  sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  previousFrameHash: Sha256Schema.nullable(),
  frameHash: Sha256Schema,
};

const CollaborationStrategyCreatedFrameSchema = z.object({
  ...frameEnvelopeShape,
  kind: z.literal("strategy_created"),
  record: CollaborationStrategySchema,
}).strict();

const CollaborationStrategyGovernanceFrameSchema = z.object({
  ...frameEnvelopeShape,
  kind: z.literal("governance_changed"),
  transition: CollaborationStrategyTransitionSchema,
  result: CollaborationStrategySchema,
}).strict();

const CollaborationStrategyFrameSchema = z.discriminatedUnion("kind", [
  CollaborationStrategyCreatedFrameSchema,
  CollaborationStrategyGovernanceFrameSchema,
]);
type CollaborationStrategyFrame = z.infer<
  typeof CollaborationStrategyFrameSchema
>;
type CollaborationStrategyUnsignedFrame =
  | Omit<
    z.infer<typeof CollaborationStrategyCreatedFrameSchema>,
    "frameHash"
  >
  | Omit<
    z.infer<typeof CollaborationStrategyGovernanceFrameSchema>,
    "frameHash"
  >;

const pathLocks = new Map<string, Promise<void>>();

function corruptedLog(
  message: string,
  details: Readonly<Record<string, unknown>> = {},
  cause?: unknown,
): CollaborationStrategyError {
  return new CollaborationStrategyError(
    "corrupted_log",
    message,
    details,
    cause === undefined ? {} : { cause },
  );
}

function unsignedFrame(
  frame: CollaborationStrategyFrame,
): CollaborationStrategyUnsignedFrame {
  const { frameHash: _frameHash, ...unsigned } = frame;
  return unsigned;
}

function signFrame(
  frame: CollaborationStrategyUnsignedFrame,
): CollaborationStrategyFrame {
  return CollaborationStrategyFrameSchema.parse({
    ...frame,
    frameHash: sha256Canonical(frame),
  });
}

function decodeLog(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw corruptedLog("协作策略日志损坏：不是有效 UTF-8", {}, error);
  }
}

async function readFrames(path: string): Promise<CollaborationStrategyFrame[]> {
  let body: Buffer;
  try {
    body = await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  if (body.length === 0) return [];
  if (body.at(-1) !== 0x0a) {
    throw corruptedLog(
      "协作策略日志损坏：末尾帧未完整提交，拒绝自动截断",
    );
  }

  const lines = decodeLog(body).split("\n");
  lines.pop();
  const frames: CollaborationStrategyFrame[] = [];
  let previousFrameHash: string | null = null;
  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    if (line.length === 0) {
      throw corruptedLog(
        `协作策略日志第 ${lineNumber} 行损坏：不允许空帧`,
        { lineNumber },
      );
    }
    let frame: CollaborationStrategyFrame;
    try {
      frame = CollaborationStrategyFrameSchema.parse(JSON.parse(line));
    } catch (error) {
      throw corruptedLog(
        `协作策略日志第 ${lineNumber} 行损坏`,
        { lineNumber },
        error,
      );
    }
    if (frame.sequence !== lineNumber) {
      throw corruptedLog(
        `协作策略日志第 ${lineNumber} 行序号漂移`,
        {
          lineNumber,
          expectedSequence: lineNumber,
          actualSequence: frame.sequence,
        },
      );
    }
    if (frame.previousFrameHash !== previousFrameHash) {
      throw corruptedLog(
        `协作策略日志第 ${lineNumber} 行前序哈希不一致`,
        { lineNumber },
      );
    }
    const expectedFrameHash = sha256Canonical(unsignedFrame(frame));
    if (frame.frameHash !== expectedFrameHash) {
      throw corruptedLog(
        `协作策略日志第 ${lineNumber} 行内容哈希不一致`,
        {
          lineNumber,
          expectedFrameHash,
          actualFrameHash: frame.frameHash,
        },
      );
    }
    frames.push(frame);
    previousFrameHash = frame.frameHash;
  }
  return frames;
}

async function materialize(
  frames: readonly CollaborationStrategyFrame[],
): Promise<InMemoryCollaborationStrategyStore> {
  const store = new InMemoryCollaborationStrategyStore();
  for (const frame of frames) {
    try {
      if (frame.kind === "strategy_created") {
        const result = await store.createDraft(frame.record);
        if (canonicalJson(result) !== canonicalJson(frame.record)) {
          throw new Error("创建帧回放结果漂移");
        }
      } else {
        const result = await store.transitionGovernance(frame.transition);
        if (canonicalJson(result) !== canonicalJson(frame.result)) {
          throw new Error("治理帧回放结果漂移");
        }
      }
    } catch (error) {
      throw corruptedLog(
        `协作策略日志第 ${frame.sequence} 行语义回放失败`,
        { lineNumber: frame.sequence, kind: frame.kind },
        error,
      );
    }
  }
  return store;
}

async function appendAndSync(
  path: string,
  frame: CollaborationStrategyFrame,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const handle = await open(path, "a");
  try {
    await handle.writeFile(`${JSON.stringify(frame)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * Append-only, fsync-backed strategy store.
 *
 * Every read revalidates the complete frame hash chain and replays domain
 * transitions. Unlike legacy repair-tolerant JSONL adapters, this store never
 * truncates a torn or malformed tail: strategy corruption must fail closed.
 */
export class JsonlCollaborationStrategyStore
implements CollaborationStrategyStore {
  readonly #path: string;

  constructor(path: string) {
    this.#path = resolve(path);
  }

  createDraft(
    record: CollaborationStrategy,
  ): Promise<CollaborationStrategy> {
    return this.#withMaterialized(async (store, frames) => {
      const result = await store.createDraft(record);
      const previousFrameHash = frames.at(-1)?.frameHash ?? null;
      await appendAndSync(this.#path, signFrame({
        schemaVersion: 1,
        sequence: frames.length + 1,
        previousFrameHash,
        kind: "strategy_created",
        record: result,
      }));
      return result;
    });
  }

  get(
    strategyId: string,
    version: number,
  ): Promise<CollaborationStrategy | null> {
    return this.#withMaterialized(
      (store) => store.get(strategyId, version),
    );
  }

  list(
    query?: CollaborationStrategyQuery,
  ): Promise<CollaborationStrategy[]> {
    return this.#withMaterialized((store) => store.list(query));
  }

  transitionGovernance(
    transition: CollaborationStrategyTransition,
  ): Promise<CollaborationStrategy> {
    return this.#withMaterialized(async (store, frames) => {
      const result = await store.transitionGovernance(transition);
      const previousFrameHash = frames.at(-1)?.frameHash ?? null;
      await appendAndSync(this.#path, signFrame({
        schemaVersion: 1,
        sequence: frames.length + 1,
        previousFrameHash,
        kind: "governance_changed",
        transition,
        result,
      }));
      return result;
    });
  }

  async #withMaterialized<T>(
    operation: (
      store: InMemoryCollaborationStrategyStore,
      frames: readonly CollaborationStrategyFrame[],
    ) => Promise<T>,
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
      const frames = await readFrames(this.#path);
      return await operation(await materialize(frames), frames);
    } finally {
      release();
      if (pathLocks.get(this.#path) === queued) {
        pathLocks.delete(this.#path);
      }
    }
  }
}
