import { createReadStream } from "node:fs";
import { mkdir, open, readFile, readdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import {
  OutboxRecordSchema,
  WorldEventSchema,
  type OutboxRecord,
  type WorldEvent,
} from "@ronggang/contracts";
import {
  StateVersionConflictError,
  validateCommittedOutbox,
  type EventStore,
  type EventStoreJournalSnapshot,
} from "@ronggang/world-core";

function validateSessionId(sessionId: string): string {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(sessionId)) throw new Error("会话标识只允许字母、数字、下划线和连字符");
  return sessionId;
}

async function appendAndSync(path: string, content: string): Promise<void> {
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

export interface JsonlEventStoreOptions {
  beforeWorldCommitAppend?: () => void | Promise<void>;
}

async function readFirstNonEmptyLine(path: string): Promise<string | null> {
  const input = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (line.trim().length > 0) return line;
    }
    return null;
  } finally {
    lines.close();
    input.destroy();
  }
}

const journalLocks = new Map<string, Promise<void>>();

export class JsonlEventStore implements EventStore {
  readonly #baseDir: string;
  readonly #beforeWorldCommitAppend: () => void | Promise<void>;

  constructor(baseDir: string, options: JsonlEventStoreOptions = {}) {
    this.#baseDir = resolve(baseDir);
    this.#beforeWorldCommitAppend = options.beforeWorldCommitAppend ?? (() => undefined);
  }

  async listSessionIds(): Promise<string[]> {
    try {
      const entries = await readdir(this.#baseDir, { withFileTypes: true });
      const sessionIds: string[] = [];
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
        const sessionId = entry.name.slice(0, -".jsonl".length);
        if (!/^[a-zA-Z0-9_-]{1,80}$/u.test(sessionId)) continue;
        const firstLine = await readFirstNonEmptyLine(resolve(this.#baseDir, entry.name));
        if (!firstLine) continue;
        try {
          const first = JSON.parse(firstLine) as unknown;
          const recordKind = first && typeof first === "object" && "kind" in first
            ? (first as { kind?: unknown }).kind
            : null;
          if (
            WorldEventSchema.safeParse(first).success
            || recordKind === "world_commit"
            || recordKind === "world_reset"
          ) {
            sessionIds.push(sessionId);
          }
        } catch {
          continue;
        }
      }
      return sessionIds.sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async load(sessionId: string): Promise<WorldEvent[]> {
    return (await this.loadJournalSnapshot(sessionId)).events;
  }

  async loadJournalSnapshot(sessionId: string): Promise<EventStoreJournalSnapshot> {
    return this.withLock(sessionId, async () => structuredClone(
      await this.readJournalUnlocked(sessionId),
    ));
  }

  async append(
    sessionId: string,
    expectedVersion: number,
    events: WorldEvent[],
    outboxRecords: OutboxRecord[],
  ): Promise<void> {
    return this.withLock(sessionId, async () => {
      const journal = await this.readJournalUnlocked(sessionId);
      const current = journal.events;
      const actual = current.at(-1)?.stateVersion ?? 0;
      if (actual !== expectedVersion) throw new StateVersionConflictError(expectedVersion, actual);
      let nextVersion = actual + 1;
      for (const event of events) {
        WorldEventSchema.parse(event);
        if (event.sessionId !== sessionId || event.stateVersion !== nextVersion) throw new Error(`事件序列非法：${event.eventId}`);
        nextVersion += 1;
      }
      const parsedOutbox = validateCommittedOutbox(
        sessionId,
        events,
        outboxRecords,
        current,
        journal.outbox,
      );
      await mkdir(this.#baseDir, { recursive: true });
      await this.#beforeWorldCommitAppend();
      await appendAndSync(this.fileFor(sessionId), `${JSON.stringify({
        kind: "world_commit",
        events,
        outbox: parsedOutbox,
      })}\n`);
    });
  }

  async loadOutbox(sessionId: string): Promise<OutboxRecord[]> {
    return (await this.loadJournalSnapshot(sessionId)).outbox;
  }

  async markOutboxDelivered(sessionId: string, outboxId: string, deliveredAt: string): Promise<void> {
    return this.withLock(sessionId, async () => {
      const journal = await this.readJournalUnlocked(sessionId);
      const record = journal.outbox.find((candidate) => candidate.outboxId === outboxId);
      if (!record) throw new Error(`Outbox 记录不存在：${outboxId}`);
      if (record.status === "delivered") return;
      await appendAndSync(this.fileFor(sessionId), `${JSON.stringify({
        kind: "outbox_delivered",
        outboxId,
        deliveredAt,
      })}\n`);
    });
  }

  async markOutboxAttemptFailed(
    sessionId: string,
    outboxId: string,
    failedAt: string,
    errorCode: string,
    availableAt: string,
  ): Promise<void> {
    return this.withLock(sessionId, async () => {
      const journal = await this.readJournalUnlocked(sessionId);
      const record = journal.outbox.find((candidate) => candidate.outboxId === outboxId);
      if (!record) throw new Error(`Outbox 记录不存在：${outboxId}`);
      if (record.status === "delivered") return;
      await appendAndSync(this.fileFor(sessionId), `${JSON.stringify({
        kind: "outbox_attempt_failed",
        outboxId,
        failedAt,
        errorCode,
        availableAt,
      })}\n`);
    });
  }

  async reset(sessionId: string): Promise<void> {
    return this.withLock(sessionId, async () => {
      await mkdir(this.#baseDir, { recursive: true });
      await appendAndSync(this.fileFor(sessionId), `${JSON.stringify({
        kind: "world_reset",
        resetAt: new Date().toISOString(),
      })}\n`);
    });
  }

  private fileFor(sessionId: string): string {
    return resolve(this.#baseDir, `${validateSessionId(sessionId)}.jsonl`);
  }

  private async readJournalUnlocked(sessionId: string): Promise<{
    events: WorldEvent[];
    outbox: OutboxRecord[];
  }> {
    try {
      const body = await readFile(this.fileFor(sessionId), "utf8");
      const events: WorldEvent[] = [];
      const outbox = new Map<string, OutboxRecord>();
      const lines = body.split(/\r?\n/u).filter((line) => line.length > 0);
      let repairedTornTail = false;
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const line = lines[lineIndex]!;
        let decoded: unknown;
        try {
          decoded = JSON.parse(line) as unknown;
        } catch (error) {
          if (lineIndex === lines.length - 1 && !body.endsWith("\n")) {
            const prefix = body.slice(0, body.lastIndexOf(line));
            await truncateAndSync(this.fileFor(sessionId), Buffer.byteLength(prefix, "utf8"));
            repairedTornTail = true;
            break;
          }
          throw new Error(`世界日志第 ${lineIndex + 1} 行损坏`, { cause: error });
        }
        const legacyEvent = WorldEventSchema.safeParse(decoded);
        if (legacyEvent.success) {
          const expected = (events.at(-1)?.stateVersion ?? 0) + 1;
          if (
            legacyEvent.data.sessionId !== sessionId
            || legacyEvent.data.stateVersion !== expected
            || events.some((event) => event.eventId === legacyEvent.data.eventId)
          ) {
            throw new Error(`旧版世界事件序列非法：${legacyEvent.data.eventId}`);
          }
          events.push(legacyEvent.data);
          continue;
        }
        if (!decoded || typeof decoded !== "object" || !("kind" in decoded)) {
          throw new Error("世界日志包含未知记录");
        }
        const frame = decoded as Record<string, unknown>;
        if (frame.kind === "world_reset") {
          const resetAt = String(frame.resetAt ?? "");
          if (!Number.isFinite(Date.parse(resetAt))) throw new Error("世界重置帧时间非法");
          events.splice(0, events.length);
          outbox.clear();
          continue;
        }
        if (frame.kind === "world_commit") {
          const frameEvents = Array.isArray(frame.events)
            ? frame.events.map((event) => WorldEventSchema.parse(event))
            : [];
          const frameOutbox = Array.isArray(frame.outbox)
            ? frame.outbox.map((record) => OutboxRecordSchema.parse(record))
            : [];
          if (frameEvents.length !== frameOutbox.length) {
            throw new Error("世界提交中的事件与 Outbox 数量不一致");
          }
          let expected = (events.at(-1)?.stateVersion ?? 0) + 1;
          for (const event of frameEvents) {
            if (event.sessionId !== sessionId || event.stateVersion !== expected) {
              throw new Error(`世界提交事件序列非法：${event.eventId}`);
            }
            expected += 1;
          }
          const parsedFrameOutbox = validateCommittedOutbox(
            sessionId,
            frameEvents,
            frameOutbox,
            events,
            [...outbox.values()],
          );
          events.push(...frameEvents);
          for (const record of parsedFrameOutbox) outbox.set(record.outboxId, record);
          continue;
        }
        if (frame.kind === "outbox_delivered") {
          const outboxId = String(frame.outboxId ?? "");
          const deliveredAt = String(frame.deliveredAt ?? "");
          const current = outbox.get(outboxId);
          if (!current) throw new Error(`Outbox 交付记录缺少原始提交：${outboxId}`);
          outbox.set(outboxId, OutboxRecordSchema.parse({
            ...current,
            status: "delivered",
            attempts: current.attempts + 1,
            deliveredAt,
            lastErrorCode: null,
          }));
          continue;
        }
        if (frame.kind === "outbox_attempt_failed") {
          const outboxId = String(frame.outboxId ?? "");
          const failedAt = String(frame.failedAt ?? "");
          const errorCode = String(frame.errorCode ?? "");
          const availableAt = String(frame.availableAt ?? "");
          const current = outbox.get(outboxId);
          if (!current) throw new Error(`Outbox 失败记录缺少原始提交：${outboxId}`);
          if (current.status === "delivered") continue;
          outbox.set(outboxId, OutboxRecordSchema.parse({
            ...current,
            status: "pending",
            attempts: current.attempts + 1,
            availableAt,
            deliveredAt: null,
            lastErrorCode: errorCode,
          }));
          if (!Number.isFinite(Date.parse(failedAt))) {
            throw new Error(`Outbox 失败时间非法：${outboxId}`);
          }
          continue;
        }
        throw new Error(`世界日志包含未知帧：${String(frame.kind)}`);
      }
      if (body.length > 0 && !body.endsWith("\n") && !repairedTornTail) {
        await appendAndSync(this.fileFor(sessionId), "\n");
      }
      return {
        events,
        outbox: [...outbox.values()],
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { events: [], outbox: [] };
      }
      throw error;
    }
  }

  private async withLock<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const lockKey = this.fileFor(sessionId);
    const previous = journalLocks.get(lockKey) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const next = result.then(() => undefined, () => undefined);
    journalLocks.set(lockKey, next);
    try {
      return await result;
    } finally {
      if (journalLocks.get(lockKey) === next) journalLocks.delete(lockKey);
    }
  }
}
