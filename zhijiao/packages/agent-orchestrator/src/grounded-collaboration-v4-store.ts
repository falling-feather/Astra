import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import {
  validateGroundedCollaborationRecordV4,
  type GroundedCollaborationRecordV4,
} from "./grounded-collaboration-v4-types.js";

export class GroundedCollaborationRecordNotFoundError extends Error {
  constructor(public readonly episodeId: string) {
    super(`V4 知识协作记录不存在：${episodeId}`);
    this.name = "GroundedCollaborationRecordNotFoundError";
  }
}

export class GroundedCollaborationStoreConflictError extends Error {
  constructor(
    public readonly expectedRevision: number,
    public readonly actualRevision: number,
  ) {
    super(`V4 知识协作记录冲突：期望 ${expectedRevision}，实际 ${actualRevision}`);
    this.name = "GroundedCollaborationStoreConflictError";
  }
}

export interface GroundedCollaborationStoreV4 {
  create(record: GroundedCollaborationRecordV4): Promise<void>;
  load(episodeId: string): Promise<GroundedCollaborationRecordV4 | null>;
  compareAndSet(
    episodeId: string,
    expectedRevision: number,
    next: GroundedCollaborationRecordV4,
  ): Promise<void>;
}

export class InMemoryGroundedCollaborationStoreV4
implements GroundedCollaborationStoreV4 {
  readonly #records = new Map<string, GroundedCollaborationRecordV4>();

  async create(record: GroundedCollaborationRecordV4): Promise<void> {
    const parsed = validateGroundedCollaborationRecordV4(record);
    const current = this.#records.get(parsed.episodeId);
    if (current) {
      throw new GroundedCollaborationStoreConflictError(-1, current.recordRevision);
    }
    this.#records.set(parsed.episodeId, parsed);
  }

  async load(episodeId: string): Promise<GroundedCollaborationRecordV4 | null> {
    const record = this.#records.get(episodeId);
    return record ? structuredClone(record) : null;
  }

  async compareAndSet(
    episodeId: string,
    expectedRevision: number,
    next: GroundedCollaborationRecordV4,
  ): Promise<void> {
    const current = this.#records.get(episodeId);
    if (!current) throw new GroundedCollaborationRecordNotFoundError(episodeId);
    if (current.recordRevision !== expectedRevision) {
      throw new GroundedCollaborationStoreConflictError(
        expectedRevision,
        current.recordRevision,
      );
    }
    const parsed = validateGroundedCollaborationRecordV4(next);
    if (parsed.episodeId !== episodeId
      || parsed.recordRevision !== expectedRevision + 1) {
      throw new Error("V4 知识协作 CAS 后继修订非法");
    }
    this.#records.set(episodeId, parsed);
  }
}

function fileName(episodeId: string): string {
  return `${createHash("sha256").update(episodeId).digest("hex")}.json`;
}

export class JsonFileGroundedCollaborationStoreV4
implements GroundedCollaborationStoreV4 {
  constructor(private readonly directory: string) {}

  async create(record: GroundedCollaborationRecordV4): Promise<void> {
    const parsed = validateGroundedCollaborationRecordV4(record);
    const current = await this.load(parsed.episodeId);
    if (current) {
      throw new GroundedCollaborationStoreConflictError(-1, current.recordRevision);
    }
    await this.#write(parsed);
  }

  async load(episodeId: string): Promise<GroundedCollaborationRecordV4 | null> {
    let text: string;
    try {
      text = await readFile(this.#path(episodeId), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    const parsed = validateGroundedCollaborationRecordV4(
      JSON.parse(text) as GroundedCollaborationRecordV4,
    );
    if (parsed.episodeId !== episodeId) {
      throw new Error("V4 知识协作文件与请求 Episode 不一致");
    }
    return parsed;
  }

  async compareAndSet(
    episodeId: string,
    expectedRevision: number,
    next: GroundedCollaborationRecordV4,
  ): Promise<void> {
    const current = await this.load(episodeId);
    if (!current) throw new GroundedCollaborationRecordNotFoundError(episodeId);
    if (current.recordRevision !== expectedRevision) {
      throw new GroundedCollaborationStoreConflictError(
        expectedRevision,
        current.recordRevision,
      );
    }
    const parsed = validateGroundedCollaborationRecordV4(next);
    if (parsed.episodeId !== episodeId
      || parsed.recordRevision !== expectedRevision + 1) {
      throw new Error("V4 知识协作 CAS 后继修订非法");
    }
    await this.#write(parsed);
  }

  #path(episodeId: string): string {
    return resolve(this.directory, fileName(episodeId));
  }

  async #write(record: GroundedCollaborationRecordV4): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const target = this.#path(record.episodeId);
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
