import { mkdir, open, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import {
  MediaProcessingWorkAttemptSchema,
  MediaProcessingWorkItemSchema,
  type MediaProcessingWorkItem,
} from "./models.js";
import type {
  AssertMediaProcessingLeaseInput,
  ClaimMediaProcessingWorkInput,
  FailMediaProcessingWorkInput,
  FinishMediaProcessingWorkInput,
  MediaProcessingWorkStore,
  ReconcileMediaProcessingWorkInput,
  ReleaseMediaProcessingWorkInput,
} from "./ports.js";
import {
  InMemoryMediaProcessingWorkStore,
  type MediaProcessingWorkStoreSnapshot,
} from "./task-store.js";

const MediaProcessingStoreFrameSchema = z.object({
  kind: z.literal("media_processing_work_snapshot"),
  formatVersion: z.literal(1),
  sequence: z.number().int().positive(),
  writtenAt: z.string().datetime(),
  snapshot: z.object({
    workItems: z.array(MediaProcessingWorkItemSchema),
    attempts: z.array(MediaProcessingWorkAttemptSchema),
  }).strict(),
}).strict();
type MediaProcessingStoreFrame = z.infer<
  typeof MediaProcessingStoreFrameSchema
>;

async function appendAndSync(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const handle = await open(path, "a");
  try {
    await handle.writeFile(content, "utf8");
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

const storeLocks = new Map<string, Promise<void>>();

export class JsonlMediaProcessingWorkStore
implements MediaProcessingWorkStore {
  readonly #path: string;

  constructor(path: string) {
    this.#path = resolve(path);
  }

  async #withLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = storeLocks.get(this.#path) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const next = result.then(() => undefined, () => undefined);
    storeLocks.set(this.#path, next);
    try {
      return await result;
    } finally {
      if (storeLocks.get(this.#path) === next) storeLocks.delete(this.#path);
    }
  }

  async #readFrame(): Promise<MediaProcessingStoreFrame | null> {
    let content: string;
    try {
      content = await readFile(this.#path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    const rawLines = content.split(/\r?\n/u);
    let latest: MediaProcessingStoreFrame | null = null;
    let acceptedBytes = 0;
    for (let index = 0; index < rawLines.length; index += 1) {
      const line = rawLines[index] ?? "";
      const lineBytes = Buffer.byteLength(`${line}\n`, "utf8");
      if (!line.trim()) {
        acceptedBytes += lineBytes;
        continue;
      }
      try {
        const frame = MediaProcessingStoreFrameSchema.parse(
          JSON.parse(line),
        );
        if (latest && frame.sequence !== latest.sequence + 1) {
          throw new Error("媒体处理存储快照序号不连续");
        }
        latest = frame;
        acceptedBytes += lineBytes;
      } catch (error) {
        const isTail = index === rawLines.length - 1
          || rawLines.slice(index + 1).every((value) => !value.trim());
        if (!isTail) {
          throw new Error(
            `媒体处理存储中段损坏：${this.#path}`,
            { cause: error },
          );
        }
        await truncateAndSync(this.#path, acceptedBytes);
        break;
      }
    }
    return latest;
  }

  async #mutate<T>(
    operation: (
      store: InMemoryMediaProcessingWorkStore,
    ) => Promise<T>,
  ): Promise<T> {
    return this.#withLock(async () => {
      const previous = await this.#readFrame();
      const store = new InMemoryMediaProcessingWorkStore(
        previous?.snapshot ?? {
          workItems: [],
          attempts: [],
        },
      );
      const result = await operation(store);
      const frame = MediaProcessingStoreFrameSchema.parse({
        kind: "media_processing_work_snapshot",
        formatVersion: 1,
        sequence: (previous?.sequence ?? 0) + 1,
        writtenAt: new Date().toISOString(),
        snapshot: store.snapshot(),
      });
      await appendAndSync(
        this.#path,
        `${JSON.stringify(frame)}\n`,
      );
      return result;
    });
  }

  async #readSnapshot(): Promise<MediaProcessingWorkStoreSnapshot> {
    const frame = await this.#readFrame();
    return frame?.snapshot ?? { workItems: [], attempts: [] };
  }

  async enqueue(
    workItems: readonly MediaProcessingWorkItem[],
  ): Promise<MediaProcessingWorkItem[]> {
    return this.#mutate((store) => store.enqueue(workItems));
  }

  async claimNext(
    input: ClaimMediaProcessingWorkInput,
  ): Promise<MediaProcessingWorkItem | null> {
    return this.#mutate((store) => store.claimNext(input));
  }

  async assertCurrentLease(
    input: AssertMediaProcessingLeaseInput,
  ): Promise<MediaProcessingWorkItem> {
    return this.#withLock(async () => {
      const snapshot = await this.#readSnapshot();
      return new InMemoryMediaProcessingWorkStore(
        snapshot,
      ).assertCurrentLease(input);
    });
  }

  async complete(
    input: FinishMediaProcessingWorkInput,
  ): Promise<MediaProcessingWorkItem> {
    return this.#mutate((store) => store.complete(input));
  }

  async release(
    input: ReleaseMediaProcessingWorkInput,
  ): Promise<MediaProcessingWorkItem> {
    return this.#mutate((store) => store.release(input));
  }

  async fail(
    input: FailMediaProcessingWorkInput,
  ): Promise<MediaProcessingWorkItem> {
    return this.#mutate((store) => store.fail(input));
  }

  async reconcile(
    input: ReconcileMediaProcessingWorkInput,
  ): Promise<MediaProcessingWorkItem> {
    return this.#mutate((store) => store.reconcile(input));
  }

  async list(sessionId: string): Promise<MediaProcessingWorkItem[]> {
    return this.#withLock(async () => {
      const snapshot = await this.#readSnapshot();
      return new InMemoryMediaProcessingWorkStore(snapshot).list(sessionId);
    });
  }

  async listAttempts(sessionId: string) {
    return this.#withLock(async () => {
      const snapshot = await this.#readSnapshot();
      return new InMemoryMediaProcessingWorkStore(snapshot).listAttempts(
        sessionId,
      );
    });
  }

  async reset(sessionId: string): Promise<void> {
    await this.#mutate((store) => store.reset(sessionId));
  }
}
