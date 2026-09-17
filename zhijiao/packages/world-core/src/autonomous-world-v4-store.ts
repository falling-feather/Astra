import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import {
  validateAutonomousWorldRecordV4,
  type AutonomousWorldRecordV4,
} from "./autonomous-world-v4-types.js";

export class AutonomousWorldRecordNotFoundError extends Error {
  constructor(public readonly sessionId: string) {
    super(`V4 自主世界记录不存在：${sessionId}`);
    this.name = "AutonomousWorldRecordNotFoundError";
  }
}

export class AutonomousWorldStoreConflictError extends Error {
  constructor(
    public readonly expectedRevision: number,
    public readonly actualRevision: number,
  ) {
    super(`V4 自主世界记录冲突：期望 ${expectedRevision}，实际 ${actualRevision}`);
    this.name = "AutonomousWorldStoreConflictError";
  }
}

export interface AutonomousWorldStoreV4 {
  create(record: AutonomousWorldRecordV4): Promise<void>;
  load(sessionId: string): Promise<AutonomousWorldRecordV4 | null>;
  compareAndSet(
    sessionId: string,
    expectedRevision: number,
    next: AutonomousWorldRecordV4,
  ): Promise<void>;
}

export class InMemoryAutonomousWorldStoreV4 implements AutonomousWorldStoreV4 {
  readonly #records = new Map<string, AutonomousWorldRecordV4>();

  async create(record: AutonomousWorldRecordV4): Promise<void> {
    const parsed = validateAutonomousWorldRecordV4(record);
    const current = this.#records.get(parsed.sessionId);
    if (current) throw new AutonomousWorldStoreConflictError(-1, current.recordRevision);
    this.#records.set(parsed.sessionId, parsed);
  }

  async load(sessionId: string): Promise<AutonomousWorldRecordV4 | null> {
    const record = this.#records.get(sessionId);
    return record ? structuredClone(record) : null;
  }

  async compareAndSet(
    sessionId: string,
    expectedRevision: number,
    next: AutonomousWorldRecordV4,
  ): Promise<void> {
    const current = this.#records.get(sessionId);
    if (!current) throw new AutonomousWorldRecordNotFoundError(sessionId);
    if (current.recordRevision !== expectedRevision) {
      throw new AutonomousWorldStoreConflictError(
        expectedRevision,
        current.recordRevision,
      );
    }
    const parsed = validateAutonomousWorldRecordV4(next);
    if (parsed.sessionId !== sessionId
      || parsed.recordRevision !== expectedRevision + 1) {
      throw new Error("V4 自主世界 CAS 后继修订非法");
    }
    this.#records.set(sessionId, parsed);
  }
}

function fileName(sessionId: string): string {
  return `${createHash("sha256").update(sessionId).digest("hex")}.json`;
}

export class JsonFileAutonomousWorldStoreV4 implements AutonomousWorldStoreV4 {
  constructor(private readonly directory: string) {}

  async create(record: AutonomousWorldRecordV4): Promise<void> {
    const parsed = validateAutonomousWorldRecordV4(record);
    const current = await this.load(parsed.sessionId);
    if (current) throw new AutonomousWorldStoreConflictError(-1, current.recordRevision);
    await this.#write(parsed);
  }

  async load(sessionId: string): Promise<AutonomousWorldRecordV4 | null> {
    const target = this.#path(sessionId);
    let text: string;
    try {
      text = await readFile(target, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    const parsed = validateAutonomousWorldRecordV4(
      JSON.parse(text) as AutonomousWorldRecordV4,
    );
    if (parsed.sessionId !== sessionId) {
      throw new Error("V4 自主世界文件与请求会话不一致");
    }
    return parsed;
  }

  async compareAndSet(
    sessionId: string,
    expectedRevision: number,
    next: AutonomousWorldRecordV4,
  ): Promise<void> {
    const current = await this.load(sessionId);
    if (!current) throw new AutonomousWorldRecordNotFoundError(sessionId);
    if (current.recordRevision !== expectedRevision) {
      throw new AutonomousWorldStoreConflictError(
        expectedRevision,
        current.recordRevision,
      );
    }
    const parsed = validateAutonomousWorldRecordV4(next);
    if (parsed.sessionId !== sessionId
      || parsed.recordRevision !== expectedRevision + 1) {
      throw new Error("V4 自主世界 CAS 后继修订非法");
    }
    await this.#write(parsed);
  }

  #path(sessionId: string): string {
    return resolve(this.directory, fileName(sessionId));
  }

  async #write(record: AutonomousWorldRecordV4): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const target = this.#path(record.sessionId);
    const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
    const file = await open(temporary, "wx");
    let renamed = false;
    try {
      await file.writeFile(`${JSON.stringify(record)}\n`, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    try {
      await rename(temporary, target);
      renamed = true;
    } finally {
      if (!renamed) await unlink(temporary).catch(() => undefined);
    }
  }
}
