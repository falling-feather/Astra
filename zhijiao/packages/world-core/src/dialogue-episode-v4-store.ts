import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import { resolve } from "node:path";
import {
  DialogueEpisodeV4Schema,
  type DialogueEpisodeV4,
} from "@ronggang/contracts";

export class DialogueEpisodeNotFoundError extends Error {
  constructor(public readonly episodeId: string) {
    super(`V4 对话 Episode 不存在：${episodeId}`);
    this.name = "DialogueEpisodeNotFoundError";
  }
}

export class DialogueEpisodeStoreConflictError extends Error {
  constructor(
    public readonly expectedRevision: number,
    public readonly actualRevision: number,
  ) {
    super(`V4 对话 Episode 冲突：期望 ${expectedRevision}，实际 ${actualRevision}`);
    this.name = "DialogueEpisodeStoreConflictError";
  }
}

export interface DialogueEpisodeStoreV4 {
  create(episode: DialogueEpisodeV4): Promise<void>;
  load(episodeId: string): Promise<DialogueEpisodeV4 | null>;
  listAll(): Promise<DialogueEpisodeV4[]>;
  listBySession(sessionId: string): Promise<DialogueEpisodeV4[]>;
  compareAndSet(
    episodeId: string,
    expectedRevision: number,
    next: DialogueEpisodeV4,
  ): Promise<void>;
}

export class InMemoryDialogueEpisodeStoreV4 implements DialogueEpisodeStoreV4 {
  readonly #episodes = new Map<string, DialogueEpisodeV4>();

  async create(episode: DialogueEpisodeV4): Promise<void> {
    const parsed = DialogueEpisodeV4Schema.parse(episode);
    const current = this.#episodes.get(parsed.episodeId);
    if (current) {
      throw new DialogueEpisodeStoreConflictError(-1, current.revision);
    }
    this.#episodes.set(parsed.episodeId, structuredClone(parsed));
  }

  async load(episodeId: string): Promise<DialogueEpisodeV4 | null> {
    const episode = this.#episodes.get(episodeId);
    return episode ? structuredClone(episode) : null;
  }

  async listBySession(sessionId: string): Promise<DialogueEpisodeV4[]> {
    return (await this.listAll())
      .filter((episode) => episode.sessionId === sessionId)
      .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  }

  async listAll(): Promise<DialogueEpisodeV4[]> {
    return [...this.#episodes.values()]
      .sort((left, right) => left.startedAt.localeCompare(right.startedAt))
      .map((episode) => structuredClone(episode));
  }

  async compareAndSet(
    episodeId: string,
    expectedRevision: number,
    next: DialogueEpisodeV4,
  ): Promise<void> {
    const current = this.#episodes.get(episodeId);
    if (!current) throw new DialogueEpisodeNotFoundError(episodeId);
    if (current.revision !== expectedRevision) {
      throw new DialogueEpisodeStoreConflictError(expectedRevision, current.revision);
    }
    const parsed = DialogueEpisodeV4Schema.parse(next);
    if (parsed.episodeId !== episodeId || parsed.revision !== expectedRevision + 1) {
      throw new Error("V4 对话 Episode CAS 后继修订非法");
    }
    this.#episodes.set(episodeId, structuredClone(parsed));
  }
}

function episodeFileName(episodeId: string): string {
  return `${createHash("sha256").update(episodeId).digest("hex")}.json`;
}

export class JsonFileDialogueEpisodeStoreV4 implements DialogueEpisodeStoreV4 {
  constructor(private readonly directory: string) {}

  async create(episode: DialogueEpisodeV4): Promise<void> {
    const parsed = DialogueEpisodeV4Schema.parse(episode);
    await this.#withLock(parsed.episodeId, async () => {
      const current = await this.load(parsed.episodeId);
      if (current) throw new DialogueEpisodeStoreConflictError(-1, current.revision);
      await this.#write(parsed);
    });
  }

  async load(episodeId: string): Promise<DialogueEpisodeV4 | null> {
    let text: string;
    try {
      text = await readFile(this.#path(episodeId), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    const parsed = DialogueEpisodeV4Schema.parse(JSON.parse(text));
    if (parsed.episodeId !== episodeId) {
      throw new Error("V4 对话 Episode 文件与请求 ID 不一致");
    }
    return parsed;
  }

  async listBySession(sessionId: string): Promise<DialogueEpisodeV4[]> {
    return (await this.listAll())
      .filter((episode) => episode.sessionId === sessionId)
      .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  }

  async listAll(): Promise<DialogueEpisodeV4[]> {
    let entries: string[];
    try {
      entries = await readdir(this.directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const episodes = await Promise.all(entries
      .filter((entry) => /^[a-f0-9]{64}\.json$/u.test(entry))
      .map(async (entry) => DialogueEpisodeV4Schema.parse(
        JSON.parse(await readFile(resolve(this.directory, entry), "utf8")),
      )));
    return episodes.sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  }

  async compareAndSet(
    episodeId: string,
    expectedRevision: number,
    next: DialogueEpisodeV4,
  ): Promise<void> {
    await this.#withLock(episodeId, async () => {
      const current = await this.load(episodeId);
      if (!current) throw new DialogueEpisodeNotFoundError(episodeId);
      if (current.revision !== expectedRevision) {
        throw new DialogueEpisodeStoreConflictError(expectedRevision, current.revision);
      }
      const parsed = DialogueEpisodeV4Schema.parse(next);
      if (parsed.episodeId !== episodeId || parsed.revision !== expectedRevision + 1) {
        throw new Error("V4 对话 Episode CAS 后继修订非法");
      }
      await this.#write(parsed);
    });
  }

  #path(episodeId: string): string {
    return resolve(this.directory, episodeFileName(episodeId));
  }

  async #withLock<T>(episodeId: string, operation: () => Promise<T>): Promise<T> {
    await mkdir(this.directory, { recursive: true });
    const lockPath = `${this.#path(episodeId)}.lock`;
    let lock: Awaited<ReturnType<typeof open>> | null = null;
    for (let attempt = 0; attempt < 2 && lock === null; attempt += 1) {
      try {
        lock = await open(lockPath, "wx", 0o600);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (attempt === 0 && await this.#isStaleLock(lockPath)) {
          await unlink(lockPath).catch((unlinkError: NodeJS.ErrnoException) => {
            if (unlinkError.code !== "ENOENT") throw unlinkError;
          });
          continue;
        }
        const current = await this.load(episodeId);
        throw new DialogueEpisodeStoreConflictError(-1, current?.revision ?? -1);
      }
      if (lock) {
        try {
          await lock.writeFile(JSON.stringify({
            pid: process.pid,
            createdAt: new Date().toISOString(),
          }), "utf8");
          await lock.sync();
        } catch (error) {
          await lock.close().catch(() => undefined);
          lock = null;
          await unlink(lockPath).catch(() => undefined);
          throw error;
        }
      }
    }
    if (!lock) throw new Error("V4 对话 Episode 文件锁获取失败");
    try {
      return await operation();
    } finally {
      await lock.close();
      await unlink(lockPath).catch(() => undefined);
    }
  }

  async #isStaleLock(lockPath: string): Promise<boolean> {
    let raw = "";
    try {
      raw = await readFile(lockPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
      throw error;
    }
    try {
      const metadata = JSON.parse(raw) as { pid?: unknown };
      if (Number.isInteger(metadata.pid) && Number(metadata.pid) > 0) {
        try {
          process.kill(Number(metadata.pid), 0);
          return false;
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === "ESRCH") return true;
          if (code === "EPERM") return false;
        }
      }
    } catch {
      // A crash before lock metadata was flushed leaves an unreadable file.
    }
    const information = await stat(lockPath).catch(() => null);
    return information === null || Date.now() - information.mtimeMs > 30_000;
  }

  async #write(episode: DialogueEpisodeV4): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const target = this.#path(episode.episodeId);
    const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
    const file = await open(temporary, "wx");
    let renamed = false;
    try {
      await file.writeFile(`${JSON.stringify(episode)}\n`, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    try {
      await rename(temporary, target);
      renamed = true;
      const directory = await open(this.directory, "r").catch(() => null);
      if (directory) {
        try {
          await directory.sync().catch((error: NodeJS.ErrnoException) => {
            if (!["EINVAL", "EPERM", "ENOTSUP"].includes(error.code ?? "")) {
              throw error;
            }
          });
        } finally {
          await directory.close();
        }
      }
    } finally {
      if (!renamed) await unlink(temporary).catch(() => undefined);
    }
  }
}
