import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  rename,
  unlink,
} from "node:fs/promises";
import { resolve } from "node:path";
import {
  validateSimulationSessionRecord,
  type SimulationSessionRecord,
} from "./simulation-v3-types.js";

export class SimulationSessionNotFoundError extends Error {
  constructor(public readonly sessionId: string) {
    super(`V3 世界会话不存在：${sessionId}`);
    this.name = "SimulationSessionNotFoundError";
  }
}

export class SimulationStoreConflictError extends Error {
  constructor(
    public readonly expectedRevision: number,
    public readonly actualRevision: number,
  ) {
    super(`V3 世界记录版本冲突：期望 ${expectedRevision}，实际 ${actualRevision}`);
    this.name = "SimulationStoreConflictError";
  }
}

export interface SimulationSessionStore {
  create(record: SimulationSessionRecord): Promise<void>;
  load(sessionId: string): Promise<SimulationSessionRecord | null>;
  compareAndSet(
    sessionId: string,
    expectedRevision: number,
    next: SimulationSessionRecord,
  ): Promise<void>;
}

export class InMemorySimulationSessionStore implements SimulationSessionStore {
  readonly #records = new Map<string, SimulationSessionRecord>();

  async create(record: SimulationSessionRecord): Promise<void> {
    const parsed = validateSimulationSessionRecord(record);
    const current = this.#records.get(parsed.sessionId);
    if (current) {
      throw new SimulationStoreConflictError(-1, current.recordRevision);
    }
    this.#records.set(parsed.sessionId, parsed);
  }

  async load(sessionId: string): Promise<SimulationSessionRecord | null> {
    const record = this.#records.get(sessionId);
    return record ? structuredClone(record) : null;
  }

  async compareAndSet(
    sessionId: string,
    expectedRevision: number,
    next: SimulationSessionRecord,
  ): Promise<void> {
    const current = this.#records.get(sessionId);
    if (!current) throw new SimulationSessionNotFoundError(sessionId);
    if (current.recordRevision !== expectedRevision) {
      throw new SimulationStoreConflictError(
        expectedRevision,
        current.recordRevision,
      );
    }
    const parsed = validateSimulationSessionRecord(next);
    if (parsed.sessionId !== sessionId
      || parsed.recordRevision !== expectedRevision + 1) {
      throw new Error("V3 世界记录 CAS 后继修订非法");
    }
    this.#records.set(sessionId, parsed);
  }
}

function sessionFileName(sessionId: string): string {
  return `${createHash("sha256").update(sessionId).digest("hex")}.json`;
}

export class JsonFileSimulationSessionStore implements SimulationSessionStore {
  constructor(private readonly directory: string) {}

  async create(record: SimulationSessionRecord): Promise<void> {
    const parsed = validateSimulationSessionRecord(record);
    const current = await this.load(parsed.sessionId);
    if (current !== null) {
      throw new SimulationStoreConflictError(-1, current.recordRevision);
    }
    await this.#write(parsed);
  }

  async load(sessionId: string): Promise<SimulationSessionRecord | null> {
    const path = this.#pathFor(sessionId);
    let text: string;
    try {
      text = await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    const parsed = validateSimulationSessionRecord(
      JSON.parse(text) as SimulationSessionRecord,
    );
    if (parsed.sessionId !== sessionId) {
      throw new Error("V3 世界记录文件与请求会话不一致");
    }
    return parsed;
  }

  async compareAndSet(
    sessionId: string,
    expectedRevision: number,
    next: SimulationSessionRecord,
  ): Promise<void> {
    const current = await this.load(sessionId);
    if (!current) throw new SimulationSessionNotFoundError(sessionId);
    if (current.recordRevision !== expectedRevision) {
      throw new SimulationStoreConflictError(
        expectedRevision,
        current.recordRevision,
      );
    }
    const parsed = validateSimulationSessionRecord(next);
    if (parsed.sessionId !== sessionId
      || parsed.recordRevision !== expectedRevision + 1) {
      throw new Error("V3 世界记录 CAS 后继修订非法");
    }
    await this.#write(parsed);
  }

  #pathFor(sessionId: string): string {
    return resolve(this.directory, sessionFileName(sessionId));
  }

  async #write(record: SimulationSessionRecord): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const target = this.#pathFor(record.sessionId);
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
