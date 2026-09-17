import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import { hostname } from "node:os";
import {
  basename,
  dirname,
  resolve,
} from "node:path";

export const LOCAL_DATA_DIRECTORY_LEASE_SCHEMA =
  "ronggang.local-data-directory-lease.v1" as const;
export const LOCAL_DATA_RESTORE_OWNER_FILE =
  ".ronggang-restore-owner.json" as const;

export type LocalDataDirectoryLeasePurpose =
  | "api-runtime"
  | "offline-backup"
  | "offline-restore"
  | "offline-checkpoint-rebaseline";

interface LocalDataDirectoryLeaseRecord {
  schema: typeof LOCAL_DATA_DIRECTORY_LEASE_SCHEMA;
  version: 1;
  dataDirectoryHash: string;
  token: string;
  pid: number;
  hostname: string;
  acquiredAt: string;
  purpose: LocalDataDirectoryLeasePurpose;
}

export type LocalDataDirectoryLeaseErrorCode =
  | "lease_active"
  | "lease_invalid"
  | "lease_io_error"
  | "lease_not_stale"
  | "lease_ownership_lost";

export class LocalDataDirectoryLeaseError extends Error {
  constructor(
    readonly code: LocalDataDirectoryLeaseErrorCode,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "LocalDataDirectoryLeaseError";
  }
}

export interface LocalDataDirectoryLease {
  readonly dataDir: string;
  readonly lockPath: string;
  readonly purpose: LocalDataDirectoryLeasePurpose;
  release(): Promise<void>;
}

export interface LocalDataDirectoryLeaseInspection {
  status: "available" | "held";
  lockPath: string;
  owner: null | {
    pid: number;
    hostname: string;
    acquiredAt: string;
    purpose: LocalDataDirectoryLeasePurpose;
    processAlive: boolean | null;
  };
}

function normalizedDataDirectory(dataDir: string): string {
  const normalized = resolve(dataDir);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

async function canonicalDataDirectory(dataDir: string): Promise<string> {
  let cursor = resolve(dataDir);
  const missingSegments: string[] = [];
  while (true) {
    try {
      return resolve(await realpath(cursor), ...missingSegments);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = dirname(cursor);
      if (parent === cursor) throw error;
      missingSegments.unshift(basename(cursor));
      cursor = parent;
    }
  }
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function localDataDirectoryLeasePath(dataDir: string): string {
  const normalized = resolve(dataDir);
  return resolve(
    dirname(normalized),
    `.${basename(normalized)}.ronggang-runtime.lock`,
  );
}

function parseLeaseRecord(value: unknown): LocalDataDirectoryLeaseRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LocalDataDirectoryLeaseError(
      "lease_invalid",
      "数据目录租约文件不是对象",
    );
  }
  const candidate = value as Record<string, unknown>;
  const exactKeys = [
    "acquiredAt",
    "dataDirectoryHash",
    "hostname",
    "pid",
    "purpose",
    "schema",
    "token",
    "version",
  ];
  if (
    Object.keys(candidate).sort().join("\0") !== exactKeys.join("\0")
    || candidate.schema !== LOCAL_DATA_DIRECTORY_LEASE_SCHEMA
    || candidate.version !== 1
    || typeof candidate.dataDirectoryHash !== "string"
    || !/^[a-f0-9]{64}$/u.test(candidate.dataDirectoryHash)
    || typeof candidate.token !== "string"
    || !/^[0-9a-f-]{36}$/u.test(candidate.token)
    || !Number.isSafeInteger(candidate.pid)
    || (candidate.pid as number) <= 0
    || typeof candidate.hostname !== "string"
    || candidate.hostname.length === 0
    || typeof candidate.acquiredAt !== "string"
    || Number.isNaN(Date.parse(candidate.acquiredAt))
    || ![
      "api-runtime",
      "offline-backup",
      "offline-restore",
      "offline-checkpoint-rebaseline",
    ].includes(
      candidate.purpose as string,
    )
  ) {
    throw new LocalDataDirectoryLeaseError(
      "lease_invalid",
      "数据目录租约文件格式或版本无效，拒绝自动接管",
    );
  }
  return candidate as unknown as LocalDataDirectoryLeaseRecord;
}

async function readLeaseRecord(
  lockPath: string,
): Promise<LocalDataDirectoryLeaseRecord | null> {
  try {
    return parseLeaseRecord(JSON.parse(await readFile(lockPath, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    if (error instanceof LocalDataDirectoryLeaseError) throw error;
    throw new LocalDataDirectoryLeaseError(
      "lease_invalid",
      "数据目录租约文件无法解析，拒绝自动接管",
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    if ((error as NodeJS.ErrnoException).code === "EPERM") return true;
    throw error;
  }
}

function assertLeaseMatchesDataDirectory(
  record: LocalDataDirectoryLeaseRecord,
  dataDir: string,
): void {
  if (
    record.dataDirectoryHash
    !== sha256Text(normalizedDataDirectory(dataDir))
  ) {
    throw new LocalDataDirectoryLeaseError(
      "lease_invalid",
      "数据目录租约与当前规范路径不匹配，拒绝接管",
    );
  }
}

/**
 * Node cannot fsync directories on every supported platform. File fsync is
 * always mandatory; this helper reports whether the directory entry was also
 * durably synced so backup manifests can retain the exact durability claim.
 */
export async function syncDirectoryEntry(
  directory: string,
): Promise<"synced" | "unsupported"> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(directory, "r");
    await handle.sync();
    return "synced";
  } catch (error) {
    if (
      ["EACCES", "EINVAL", "EISDIR", "ENOTSUP", "EPERM"].includes(
        (error as NodeJS.ErrnoException).code ?? "",
      )
    ) {
      return "unsupported";
    }
    throw error;
  } finally {
    await handle?.close();
  }
}

export async function inspectLocalDataDirectoryLease(
  dataDir: string,
): Promise<LocalDataDirectoryLeaseInspection> {
  const canonical = await canonicalDataDirectory(dataDir);
  const lockPath = localDataDirectoryLeasePath(canonical);
  const record = await readLeaseRecord(lockPath);
  if (!record) return { status: "available", lockPath, owner: null };
  assertLeaseMatchesDataDirectory(record, canonical);
  const sameHost = record.hostname === hostname();
  return {
    status: "held",
    lockPath,
    owner: {
      pid: record.pid,
      hostname: record.hostname,
      acquiredAt: record.acquiredAt,
      purpose: record.purpose,
      processAlive: sameHost ? processAlive(record.pid) : null,
    },
  };
}

export async function acquireLocalDataDirectoryLease(input: {
  dataDir: string;
  purpose: LocalDataDirectoryLeasePurpose;
  now?: () => string;
}): Promise<LocalDataDirectoryLease> {
  const dataDir = await canonicalDataDirectory(input.dataDir);
  const lockPath = localDataDirectoryLeasePath(dataDir);
  const token = randomUUID();
  const record: LocalDataDirectoryLeaseRecord = {
    schema: LOCAL_DATA_DIRECTORY_LEASE_SCHEMA,
    version: 1,
    dataDirectoryHash: sha256Text(normalizedDataDirectory(dataDir)),
    token,
    pid: process.pid,
    hostname: hostname(),
    acquiredAt: (input.now ?? (() => new Date().toISOString()))(),
    purpose: input.purpose,
  };
  await mkdir(dirname(lockPath), { recursive: true });
  let created = false;
  try {
    const handle = await open(lockPath, "wx", 0o600);
    created = true;
    try {
      await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await syncDirectoryEntry(dirname(lockPath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      const owner = await inspectLocalDataDirectoryLease(dataDir);
      throw new LocalDataDirectoryLeaseError(
        "lease_active",
        "数据目录已被另一个协作进程占用",
        { owner: owner.owner },
      );
    }
    if (created) {
      try {
        await unlink(lockPath);
        await syncDirectoryEntry(dirname(lockPath));
      } catch (cleanupError) {
        throw new LocalDataDirectoryLeaseError(
          "lease_io_error",
          "取得数据目录租约失败，且无法清理本次创建的租约文件",
          {
            cause: error instanceof Error ? error.message : String(error),
            cleanupCause: cleanupError instanceof Error
              ? cleanupError.message
              : String(cleanupError),
          },
        );
      }
    }
    if (error instanceof LocalDataDirectoryLeaseError) throw error;
    throw new LocalDataDirectoryLeaseError(
      "lease_io_error",
      "无法取得数据目录独占租约",
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }

  let released = false;
  return {
    dataDir,
    lockPath,
    purpose: input.purpose,
    async release(): Promise<void> {
      if (released) return;
      const current = await readLeaseRecord(lockPath);
      if (!current) {
        throw new LocalDataDirectoryLeaseError(
          "lease_ownership_lost",
          "数据目录租约文件已消失，无法证明当前进程仍持有租约",
        );
      }
      assertLeaseMatchesDataDirectory(current, dataDir);
      if (current.token !== token) {
        throw new LocalDataDirectoryLeaseError(
          "lease_ownership_lost",
          "数据目录租约所有权已变化，拒绝删除其他进程的租约",
        );
      }
      await unlink(lockPath);
      await syncDirectoryEntry(dirname(lockPath));
      released = true;
    },
  };
}

export async function recoverStaleLocalDataDirectoryLease(
  dataDir: string,
): Promise<void> {
  const canonical = await canonicalDataDirectory(dataDir);
  const lockPath = localDataDirectoryLeasePath(canonical);
  const record = await readLeaseRecord(lockPath);
  if (!record) return;
  assertLeaseMatchesDataDirectory(record, canonical);
  if (record.hostname !== hostname() || processAlive(record.pid)) {
    throw new LocalDataDirectoryLeaseError(
      "lease_not_stale",
      "租约持有进程仍可能存活，拒绝恢复",
      {
        hostname: record.hostname,
        pid: record.pid,
      },
    );
  }
  const quarantinePath = `${lockPath}.stale-${randomUUID()}`;
  try {
    await rename(lockPath, quarantinePath);
    const quarantined = await readLeaseRecord(quarantinePath);
    if (!quarantined || quarantined.token !== record.token) {
      throw new LocalDataDirectoryLeaseError(
        "lease_ownership_lost",
        "租约在恢复期间发生变化",
      );
    }
    await unlink(quarantinePath);
    await syncDirectoryEntry(dirname(lockPath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    if (error instanceof LocalDataDirectoryLeaseError) throw error;
    throw new LocalDataDirectoryLeaseError(
      "lease_io_error",
      "无法清理已确认失效的数据目录租约",
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }
}
