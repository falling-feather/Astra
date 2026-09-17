import { createReadStream } from "node:fs";
import { randomUUID } from "node:crypto";
import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  AgentDispatchPlanSchema,
  AgentTaskSchema,
  DeadLetterRecordSchema,
  DispatchAttemptSchema,
  type AgentDispatchPlan,
  type AgentTask,
} from "@ronggang/contracts";
import { z } from "zod";
import {
  InMemoryAgentTaskStore,
  type AgentTaskStoreSnapshot,
} from "./task-store.js";
import type {
  AgentTaskStore,
  AssertAgentTaskLeaseInput,
  ClaimAgentTaskInput,
  CompleteAgentTaskInput,
  FailAgentTaskInput,
  FailAgentTaskResult,
  ReconcileAgentTaskResultInput,
} from "./ports.js";

const MigratingAgentTaskSchema = z.preprocess((value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const task = value as Record<string, unknown>;
  const isFactCheckerV1 = task.subscriptionId === "fact-checker/material-observed/v1";
  return {
    ...task,
    definitionVersion: task.definitionVersion
      ?? (isFactCheckerV1 ? "fact-checker/1.2.0" : "legacy/unpinned"),
    promptVersion: task.promptVersion
      ?? (isFactCheckerV1 ? "1.2.0" : "legacy/unpinned"),
  };
}, AgentTaskSchema);

const TaskStoreFrameSchema = z.object({
  kind: z.literal("agent_task_snapshot"),
  formatVersion: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  sequence: z.number().int().positive(),
  writtenAt: z.string().datetime(),
  snapshot: z.object({
    tasks: z.array(MigratingAgentTaskSchema),
    attempts: z.array(DispatchAttemptSchema),
    deadLetters: z.array(DeadLetterRecordSchema),
    dispatchPlans: z.array(AgentDispatchPlanSchema).default([]),
  }),
});
type TaskStoreFrame = z.infer<typeof TaskStoreFrameSchema>;

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

async function truncateAndSync(path: string, byteLength: number): Promise<void> {
  const handle = await open(path, "r+");
  try {
    await handle.truncate(byteLength);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

const MAX_SNAPSHOT_FRAMES = 16;
const MAX_JOURNAL_BYTES = 64 * 1024 * 1024;

async function replaceAndSync(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.compact-${process.pid}-${randomUUID()}`;
  const handle = await open(temporaryPath, "wx");
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporaryPath, path);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

async function readSnapshotFrames(path: string): Promise<{
  latest: TaskStoreFrame | null;
  frameCount: number;
}> {
  try {
    await stat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { latest: null, frameCount: 0 };
    }
    throw error;
  }

  const stream = createReadStream(path);
  let buffered = Buffer.alloc(0);
  let consumedBytes = 0;
  let lineNumber = 0;
  let latest: TaskStoreFrame | null = null;
  let frameCount = 0;

  const parseCompleteLine = (lineBuffer: Buffer): void => {
    lineNumber += 1;
    const normalized = lineBuffer.at(-1) === 0x0d
      ? lineBuffer.subarray(0, lineBuffer.length - 1)
      : lineBuffer;
    const line = normalized.toString("utf8");
    if (line.trim().length === 0) return;
    let frame: TaskStoreFrame;
    try {
      frame = TaskStoreFrameSchema.parse(JSON.parse(line));
    } catch (error) {
      throw new Error(`Agent task journal line ${lineNumber} is corrupted`, { cause: error });
    }
    if (latest && frame.sequence !== latest.sequence + 1) {
      throw new Error(`Agent task journal sequence is not contiguous: ${latest.sequence} -> ${frame.sequence}`);
    }
    latest = frame;
    frameCount += 1;
  };

  for await (const chunk of stream) {
    const data = buffered.length === 0
      ? chunk as Buffer
      : Buffer.concat([buffered, chunk as Buffer]);
    let lineStart = 0;
    let newline = data.indexOf(0x0a, lineStart);
    while (newline >= 0) {
      parseCompleteLine(data.subarray(lineStart, newline));
      consumedBytes += newline - lineStart + 1;
      lineStart = newline + 1;
      newline = data.indexOf(0x0a, lineStart);
    }
    buffered = Buffer.from(data.subarray(lineStart));
  }

  if (buffered.length > 0) {
    try {
      parseCompleteLine(buffered);
      await appendAndSync(path, "\n");
    } catch {
      await truncateAndSync(path, consumedBytes);
    }
  }
  return { latest, frameCount };
}

/*
 * 本地演示存储：每次状态变更追加完整快照并 fsync，达到边界后原子压缩为最新快照。
 * 恢复过程逐帧流式校验，避免长课程把完整日志一次性载入字符串。
 * 锁只覆盖当前 Node.js 进程；多进程/生产部署必须替换为 SQLite/PostgreSQL 实现。
 */
const taskStoreLocks = new Map<string, Promise<void>>();

export interface JsonlAgentTaskStoreOptions {
  compactSnapshot?: (path: string, content: string) => Promise<void>;
}

export class JsonlAgentTaskStore implements AgentTaskStore {
  readonly #path: string;
  readonly #compactSnapshot: (path: string, content: string) => Promise<void>;
  #cache: {
    frame: TaskStoreFrame | null;
    frameCount: number;
    store: InMemoryAgentTaskStore;
  } | null = null;

  constructor(path: string, options: JsonlAgentTaskStoreOptions = {}) {
    this.#path = resolve(path);
    this.#compactSnapshot = options.compactSnapshot ?? replaceAndSync;
  }

  async #withLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = taskStoreLocks.get(this.#path) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const next = result.then(() => undefined, () => undefined);
    taskStoreLocks.set(this.#path, next);
    try {
      return await result;
    } finally {
      if (taskStoreLocks.get(this.#path) === next) taskStoreLocks.delete(this.#path);
    }
  }

  async #readFrameStreaming(): Promise<{
    frame: TaskStoreFrame | null;
    frameCount: number;
  }> {
    const { latest, frameCount } = await readSnapshotFrames(this.#path);
    if (!latest) return { frame: null, frameCount: 0 };
    const size = (await stat(this.#path)).size;
    if (frameCount > MAX_SNAPSHOT_FRAMES || size > MAX_JOURNAL_BYTES) {
      try {
        await this.#compactSnapshot(this.#path, `${JSON.stringify(latest)}\n`);
        return { frame: latest, frameCount: 1 };
      } catch {
        // The append-only journal stays authoritative if best-effort compaction fails.
      }
    }
    return { frame: latest, frameCount };
  }

  async #loadStore(): Promise<{
    frame: TaskStoreFrame | null;
    frameCount: number;
    store: InMemoryAgentTaskStore;
  }> {
    if (this.#cache) return this.#cache;
    const { frame, frameCount } = await this.#readFrameStreaming();
    this.#cache = {
      frame,
      frameCount,
      store: new InMemoryAgentTaskStore(frame?.snapshot),
    };
    return this.#cache;
  }

  async #persist(
    frame: TaskStoreFrame | null,
    frameCount: number,
    snapshot: AgentTaskStoreSnapshot,
  ): Promise<{ frame: TaskStoreFrame; frameCount: number }> {
    const next = TaskStoreFrameSchema.parse({
      kind: "agent_task_snapshot",
      formatVersion: 3,
      sequence: (frame?.sequence ?? 0) + 1,
      writtenAt: new Date().toISOString(),
      snapshot,
    });
    const serialized = `${JSON.stringify(next)}\n`;
    await appendAndSync(this.#path, serialized);
    const nextFrameCount = frameCount + 1;
    const size = (await stat(this.#path)).size;
    if (nextFrameCount >= MAX_SNAPSHOT_FRAMES || size > MAX_JOURNAL_BYTES) {
      try {
        await this.#compactSnapshot(this.#path, serialized);
        return { frame: next, frameCount: 1 };
      } catch {
        // The newly appended frame is durable; retry compaction after a later mutation.
      }
    }
    return { frame: next, frameCount: nextFrameCount };
  }

  async #mutate<T>(operation: (store: InMemoryAgentTaskStore) => Promise<T>): Promise<T> {
    return this.#withLock(async () => {
      const { frame, frameCount, store } = await this.#loadStore();
      const result = await operation(store);
      const persisted = await this.#persist(frame, frameCount, store.snapshot());
      this.#cache = { ...persisted, store };
      return result;
    });
  }

  async enqueue(tasks: readonly AgentTask[]): Promise<AgentTask[]> {
    return this.#mutate((store) => store.enqueue(tasks));
  }

  async enqueuePlan(plan: AgentDispatchPlan): Promise<AgentDispatchPlan> {
    return this.#mutate((store) => store.enqueuePlan(plan));
  }

  async claimNext(input: ClaimAgentTaskInput): Promise<AgentTask | null> {
    return this.#mutate((store) => store.claimNext(input));
  }

  async assertCurrentLease(input: AssertAgentTaskLeaseInput): Promise<AgentTask> {
    return this.#withLock(async () => {
      const { store } = await this.#loadStore();
      return store.assertCurrentLease(input);
    });
  }

  async reconcileWorldResult(input: ReconcileAgentTaskResultInput): Promise<AgentTask> {
    return this.#mutate((store) => store.reconcileWorldResult(input));
  }

  async rebase(
    taskId: string,
    leaseToken: string,
    expectedStateVersion: number,
    updatedAt: string,
  ): Promise<AgentTask> {
    return this.#mutate((store) => store.rebase(taskId, leaseToken, expectedStateVersion, updatedAt));
  }

  async complete(input: CompleteAgentTaskInput): Promise<AgentTask> {
    return this.#mutate((store) => store.complete(input));
  }

  async fail(input: FailAgentTaskInput): Promise<FailAgentTaskResult> {
    return this.#mutate((store) => store.fail(input));
  }

  async list(sessionId: string): Promise<AgentTask[]> {
    return this.#withLock(async () => {
      const { store } = await this.#loadStore();
      return store.list(sessionId);
    });
  }

  async listDispatchPlans(sessionId: string) {
    return this.#withLock(async () => {
      const { store } = await this.#loadStore();
      return store.listDispatchPlans(sessionId);
    });
  }

  async listAttempts(sessionId: string) {
    return this.#withLock(async () => {
      const { store } = await this.#loadStore();
      return store.listAttempts(sessionId);
    });
  }

  async listDeadLetters(sessionId: string) {
    return this.#withLock(async () => {
      const { store } = await this.#loadStore();
      return store.listDeadLetters(sessionId);
    });
  }

  async reset(sessionId: string): Promise<void> {
    return this.#mutate((store) => store.reset(sessionId));
  }
}
