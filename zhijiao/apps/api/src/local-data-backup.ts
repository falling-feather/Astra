import { createHash, randomUUID } from "node:crypto";
import {
  constants,
  type Stats,
} from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  unlink,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { ProductVersion } from "@ronggang/contracts/version";
import {
  LOCAL_DATA_RESTORE_OWNER_FILE,
  acquireLocalDataDirectoryLease,
  syncDirectoryEntry,
} from "./local-data-directory-lease.js";

export const LOCAL_DATA_BACKUP_SCHEMA =
  "ronggang.local-data-backup.v1" as const;

const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const MANIFEST_FILE = "manifest.json";
const MANIFEST_HASH_FILE = "manifest.sha256";
const PAYLOAD_DIRECTORY = "payload";
const RESTORE_OWNER_SCHEMA = "ronggang.local-data-restore-owner.v1";
const CHECKPOINT_REBASELINE_SCHEMA =
  "ronggang.local-data-checkpoint-rebaseline.v1";
const SUPPORTED_RESTORABLE_PRODUCT_VERSIONS = new Set([
  "0.9.3",
  "0.9.4",
  "1.0.0",
  "2.6.0",
  "2.7.0",
  "2.8.0",
  "2.9.0",
  ProductVersion,
]);

export interface LocalDataBackupFile {
  path: string;
  sizeBytes: number;
  sha256: string;
}

export interface LocalDataBackupManifest {
  schema: typeof LOCAL_DATA_BACKUP_SCHEMA;
  formatVersion: 1 | 2;
  productVersion: string;
  createdAt: string;
  storageMode: "single_writer_local";
  backupMode: "offline";
  durabilityPolicy:
    "file_fsync+atomic_rename+parent_fsync_when_supported";
  directorySync: "synced" | "unsupported";
  directories?: string[];
  files: LocalDataBackupFile[];
}

export interface VerifiedLocalDataBackup {
  backupPath: string;
  manifest: LocalDataBackupManifest;
  manifestHash: string;
}

export interface PreparedCheckpointRebaseline {
  status: "prepared";
  dataDir: string;
  fromProductVersion: string;
  toProductVersion: string;
  backupManifestHash: string;
  archivedDirectory: string;
  markerPath: string;
  checkpointFileCount: number;
}

export class LocalDataBackupError extends Error {
  constructor(
    readonly code:
      | "backup_invalid"
      | "backup_io_error"
      | "backup_source_changed"
      | "restore_target_exists",
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "LocalDataBackupError";
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function canonicalPath(path: string): Promise<string> {
  let cursor = resolve(path);
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

function canonicalManifestJson(manifest: LocalDataBackupManifest): string {
  return JSON.stringify(manifest);
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function parseProductVersion(value: string): [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(value);
  if (!match) {
    throw new LocalDataBackupError(
      "backup_invalid",
      "备份产品版本不是受支持的语义版本",
      { productVersion: value },
    );
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareProductVersion(left: string, right: string): number {
  const leftParts = parseProductVersion(left);
  const rightParts = parseProductVersion(right);
  for (let index = 0; index < leftParts.length; index += 1) {
    const delta = leftParts[index]! - rightParts[index]!;
    if (delta !== 0) return delta;
  }
  return 0;
}

export function assertRestorableBackupProductVersion(
  backupProductVersion: string,
  currentProductVersion: string = ProductVersion,
): void {
  parseProductVersion(backupProductVersion);
  parseProductVersion(currentProductVersion);
  if (
    !SUPPORTED_RESTORABLE_PRODUCT_VERSIONS.has(backupProductVersion)
    || !SUPPORTED_RESTORABLE_PRODUCT_VERSIONS.has(currentProductVersion)
    || compareProductVersion(backupProductVersion, currentProductVersion) > 0
  ) {
    throw new LocalDataBackupError(
      "backup_invalid",
      "备份产品版本不在当前程序允许的恢复窗口内",
      {
        backupProductVersion,
        currentProductVersion,
        supportedRestorableProductVersions:
          [...SUPPORTED_RESTORABLE_PRODUCT_VERSIONS],
      },
    );
  }
}

async function hashFileHandle(
  handle: Awaited<ReturnType<typeof open>>,
): Promise<string> {
  const digest = createHash("sha256");
  const stream = handle.createReadStream({
    start: 0,
    autoClose: false,
  });
  for await (const chunk of stream) digest.update(chunk);
  return digest.digest("hex");
}

function assertRestorableBackupLayout(manifest: LocalDataBackupManifest): void {
  if (manifest.formatVersion === 1 && manifest.files.some(file => file.path === "PG_VERSION" || file.path.endsWith("/PG_VERSION"))) {
    throw new LocalDataBackupError("backup_invalid", "旧格式SQL备份没有完整目录清单，请从原DATA_DIR重新备份；未修改数据目录");
  }
}

async function assertOpenedRegularFileAtPath(
  root: string,
  path: string,
  opened: Stats,
): Promise<void> {
  const info = await lstat(path);
  if (
    !info.isFile()
    || info.isSymbolicLink()
    || info.dev !== opened.dev
    || info.ino !== opened.ino
  ) {
    throw new LocalDataBackupError(
      "backup_source_changed",
      "文件路径在校验期间发生替换",
    );
  }
  const [physicalRoot, physicalPath] = await Promise.all([
    realpath(root),
    realpath(path),
  ]);
  if (!isWithin(physicalRoot, physicalPath)) {
    throw new LocalDataBackupError(
      "backup_invalid",
      "文件物理路径越出受保护目录",
    );
  }
}

async function sha256VerifiedFile(
  root: string,
  path: string,
): Promise<string> {
  const handle = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const opened = await handle.stat();
    if (!opened.isFile()) {
      throw new LocalDataBackupError(
        "backup_invalid",
        "清单路径不是普通文件",
      );
    }
    await assertOpenedRegularFileAtPath(root, path, opened);
    const digest = await hashFileHandle(handle);
    const after = await handle.stat();
    if (
      after.dev !== opened.dev
      || after.ino !== opened.ino
      || after.size !== opened.size
    ) {
      throw new LocalDataBackupError(
        "backup_source_changed",
        "文件在哈希期间发生变化",
      );
    }
    await assertOpenedRegularFileAtPath(root, path, opened);
    return digest;
  } finally {
    await handle.close();
  }
}

async function writeAndSync(path: string, content: string): Promise<void> {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function isWithin(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return (
    fromRoot.length > 0
    && !fromRoot.startsWith(`..${sep}`)
    && fromRoot !== ".."
    && !isAbsolute(fromRoot)
  );
}

function portableRelative(root: string, candidate: string): string {
  const result = relative(root, candidate);
  if (
    result.length === 0
    || result === ".."
    || result.startsWith(`..${sep}`)
    || isAbsolute(result)
    || result.includes("\0")
  ) {
    throw new LocalDataBackupError(
      "backup_invalid",
      "备份文件路径越出数据目录",
    );
  }
  return result.split(sep).join("/");
}

function resolvedManifestPath(root: string, portablePath: string): string {
  if (
    portablePath.length === 0
    || portablePath.startsWith("/")
    || portablePath.includes("\\")
    || portablePath.includes("\0")
    || portablePath.split("/").some((segment) => (
      segment.length === 0 || segment === "." || segment === ".."
    ))
  ) {
    throw new LocalDataBackupError(
      "backup_invalid",
      "备份清单包含不安全的相对路径",
      { path: portablePath },
    );
  }
  const result = resolve(root, ...portablePath.split("/"));
  if (!isWithin(root, result)) {
    throw new LocalDataBackupError(
      "backup_invalid",
      "备份清单路径越界",
      { path: portablePath },
    );
  }
  return result;
}

function isExcludedTemporaryOrSecret(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower === ".env"
    || lower.startsWith(".env.")
    || lower.startsWith(".tmp-")
    || lower.endsWith(".tmp")
    || lower.endsWith(".temp")
  );
}

async function listRegularFiles(
  root: string,
  options: { allowRootRestoreOwner?: boolean; directories?: string[] } = {},
): Promise<string[]> {
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory()) {
    throw new LocalDataBackupError(
      "backup_invalid",
      "备份源必须是数据目录",
    );
  }
  const files: string[] = [];
  const walk = async (directory: string): Promise<void> => {
    const entries = (await readdir(directory, { withFileTypes: true }))
      .sort((left, right) => compareText(left.name, right.name));
    for (const entry of entries) {
      if (entry.name === LOCAL_DATA_RESTORE_OWNER_FILE) {
        if (options.allowRootRestoreOwner && directory === root) continue;
        throw new LocalDataBackupError(
          "backup_invalid",
          "数据目录含有未完成恢复标记，拒绝备份或验证",
          { path: portableRelative(root, resolve(directory, entry.name)) },
        );
      }
      if (isExcludedTemporaryOrSecret(entry.name)) continue;
      const path = resolve(directory, entry.name);
      if (!isWithin(root, path)) {
        throw new LocalDataBackupError(
          "backup_invalid",
          "备份源目录项越界",
        );
      }
      if (entry.isSymbolicLink()) {
        throw new LocalDataBackupError(
          "backup_invalid",
          "备份源不允许符号链接",
          { path: portableRelative(root, path) },
        );
      }
      if (entry.isDirectory()) {
        options.directories?.push(path);
        await walk(path);
      } else if (entry.isFile()) {
        files.push(path);
      } else {
        throw new LocalDataBackupError(
          "backup_invalid",
          "备份源包含不支持的特殊文件",
          { path: portableRelative(root, path) },
        );
      }
    }
  };
  await walk(root);
  return files.sort((left, right) => compareText(
    portableRelative(root, left),
    portableRelative(root, right),
  ));
}

async function syncDirectoryTree(
  root: string,
): Promise<"synced" | "unsupported"> {
  let status: "synced" | "unsupported" = "synced";
  const walk = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        await walk(resolve(directory, entry.name));
      }
    }
    if (await syncDirectoryEntry(directory) === "unsupported") {
      status = "unsupported";
    }
  };
  await walk(root);
  return status;
}

async function copyStableFile(
  sourceRoot: string,
  source: string,
  destination: string,
): Promise<LocalDataBackupFile> {
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  const sourceHandle = await open(
    source,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const sourceInfo = await sourceHandle.stat();
    if (!sourceInfo.isFile()) {
      throw new LocalDataBackupError(
        "backup_invalid",
        "复制源不是普通文件",
      );
    }
    await assertOpenedRegularFileAtPath(sourceRoot, source, sourceInfo);
    const sourceHashBefore = await hashFileHandle(sourceHandle);
    const destinationHandle = await open(destination, "wx", 0o600);
    let destinationHash: string;
    let sizeBytes = 0;
    try {
      const digest = createHash("sha256");
      const stream = sourceHandle.createReadStream({
        start: 0,
        autoClose: false,
      });
      for await (const chunk of stream) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        await destinationHandle.write(
          bytes,
          0,
          bytes.length,
          sizeBytes,
        );
        digest.update(bytes);
        sizeBytes += bytes.length;
      }
      await destinationHandle.chmod(0o600);
      await destinationHandle.sync();
      destinationHash = digest.digest("hex");
    } finally {
      await destinationHandle.close();
    }
    const sourceHashAfter = await hashFileHandle(sourceHandle);
    const afterSource = await sourceHandle.stat();
    await assertOpenedRegularFileAtPath(sourceRoot, source, sourceInfo);
    if (
      afterSource.dev !== sourceInfo.dev
      || afterSource.ino !== sourceInfo.ino
      || afterSource.size !== sourceInfo.size
      || sourceHashBefore !== sourceHashAfter
      || sourceHashAfter !== destinationHash
      || sizeBytes !== sourceInfo.size
    ) {
      throw new LocalDataBackupError(
        "backup_source_changed",
        "备份期间源文件发生变化，未发布备份",
      );
    }
    const destinationInfo = await lstat(destination);
    if (
      !destinationInfo.isFile()
      || destinationInfo.isSymbolicLink()
      || destinationInfo.size !== sizeBytes
    ) {
      throw new LocalDataBackupError(
        "backup_source_changed",
        "复制目标在校验期间发生变化",
      );
    }
    return {
      path: "",
      sizeBytes,
      sha256: destinationHash,
    };
  } finally {
    await sourceHandle.close();
  }
}

async function hardenPrivateTree(root: string): Promise<void> {
  const walk = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new LocalDataBackupError(
          "backup_invalid",
          "本地数据树不得包含符号链接",
        );
      }
      if (entry.isDirectory()) {
        await walk(path);
      } else if (entry.isFile()) {
        await chmod(path, 0o600);
      } else {
        throw new LocalDataBackupError(
          "backup_invalid",
          "本地数据树包含不支持的特殊文件",
        );
      }
    }
    await chmod(directory, 0o700);
  };
  await walk(root);
}

function validateManifest(value: unknown): LocalDataBackupManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LocalDataBackupError("backup_invalid", "备份清单不是对象");
  }
  const candidate = value as Record<string, unknown>;
  const expectedKeys = [
    "backupMode",
    "createdAt",
    "directorySync",
    "durabilityPolicy",
    "files",
    "formatVersion",
    "productVersion",
    "schema",
    "storageMode",
  ];
  if (candidate.formatVersion === 2) expectedKeys.push("directories");
  expectedKeys.sort();
  if (
    Object.keys(candidate).sort().join("\0") !== expectedKeys.join("\0")
    || candidate.schema !== LOCAL_DATA_BACKUP_SCHEMA
    || (candidate.formatVersion !== 1 && candidate.formatVersion !== 2)
    || typeof candidate.productVersion !== "string"
    || candidate.productVersion.length === 0
    || typeof candidate.createdAt !== "string"
    || Number.isNaN(Date.parse(candidate.createdAt))
    || candidate.storageMode !== "single_writer_local"
    || candidate.backupMode !== "offline"
    || candidate.durabilityPolicy
      !== "file_fsync+atomic_rename+parent_fsync_when_supported"
    || !["synced", "unsupported"].includes(candidate.directorySync as string)
    || !Array.isArray(candidate.files)
    || (candidate.formatVersion === 2 && (!Array.isArray(candidate.directories) || candidate.directories.some(path => typeof path !== "string")))
  ) {
    throw new LocalDataBackupError(
      "backup_invalid",
      "备份清单格式或版本无效",
    );
  }
  const files = candidate.files.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new LocalDataBackupError(
        "backup_invalid",
        "备份清单文件项无效",
        { index },
      );
    }
    const file = value as Record<string, unknown>;
    if (
      Object.keys(file).sort().join("\0") !== "path\0sha256\0sizeBytes"
      || typeof file.path !== "string"
      || !Number.isSafeInteger(file.sizeBytes)
      || (file.sizeBytes as number) < 0
      || typeof file.sha256 !== "string"
      || !HASH_PATTERN.test(file.sha256)
    ) {
      throw new LocalDataBackupError(
        "backup_invalid",
        "备份清单文件元数据无效",
        { index },
      );
    }
    return {
      path: file.path,
      sizeBytes: file.sizeBytes as number,
      sha256: file.sha256,
    };
  });
  const paths = files.map((file) => file.path);
  const directories = candidate.formatVersion === 2 ? candidate.directories as string[] : null;
  if (
    new Set(paths).size !== paths.length
    || paths.some((path) => (
      path.split("/").includes(LOCAL_DATA_RESTORE_OWNER_FILE)
    ))
    || paths.some((path, index) => index > 0 && paths[index - 1]! >= path)
    || (directories !== null && (new Set(directories).size !== directories.length
      || directories.some((path, index) => paths.includes(path) || path.split("/").includes(LOCAL_DATA_RESTORE_OWNER_FILE)
        || (index > 0 && directories[index - 1]! >= path))))
  ) {
    throw new LocalDataBackupError(
      "backup_invalid",
      "备份清单路径重复或未按稳定顺序排列",
    );
  }
  return {
    schema: LOCAL_DATA_BACKUP_SCHEMA,
    formatVersion: candidate.formatVersion,
    productVersion: candidate.productVersion,
    createdAt: candidate.createdAt,
    storageMode: "single_writer_local",
    backupMode: "offline",
    durabilityPolicy:
      "file_fsync+atomic_rename+parent_fsync_when_supported",
    directorySync: candidate.directorySync as "synced" | "unsupported",
    ...(directories !== null ? { directories } : {}),
    files,
  };
}

async function verifyRestoredPayload(
  targetDataDir: string,
  manifest: LocalDataBackupManifest,
): Promise<void> {
  const directories: string[] = [];
  const actualPaths = (
    await listRegularFiles(targetDataDir, { allowRootRestoreOwner: true, directories })
  ).map((path) => portableRelative(targetDataDir, path));
  const expectedPaths = manifest.files.map((file) => file.path);
  assertDirectoryInventory(targetDataDir, directories, manifest);
  if (actualPaths.join("\0") !== expectedPaths.join("\0")) {
    throw new LocalDataBackupError(
      "backup_invalid",
      "恢复目标文件集合与清单不一致",
    );
  }
  for (const file of manifest.files) {
    const path = resolvedManifestPath(targetDataDir, file.path);
    const [info, digest] = await Promise.all([
      lstat(path),
      sha256VerifiedFile(targetDataDir, path),
    ]);
    if (
      !info.isFile()
      || info.isSymbolicLink()
      || info.size !== file.sizeBytes
      || digest !== file.sha256
    ) {
      throw new LocalDataBackupError(
        "backup_invalid",
        "恢复目标文件未通过最终清单复核",
        { path: file.path },
      );
    }
  }
}

function assertDirectoryInventory(root: string, actual: string[], manifest: LocalDataBackupManifest): void {
  if (manifest.formatVersion === 1) return;
  const expected = manifest.directories ?? [];
  for (const directory of expected) resolvedManifestPath(root, directory);
  const paths = actual.map(path => portableRelative(root, path)).sort(compareText);
  if (paths.join("\0") !== expected.join("\0")) throw new LocalDataBackupError("backup_invalid", "备份或恢复的目录集合与清单不一致");
}

async function removeOwnedStagingDirectory(
  parent: string,
  path: string,
  prefix: string,
): Promise<void> {
  const resolvedParent = resolve(parent);
  const resolvedPath = resolve(path);
  if (
    !isWithin(resolvedParent, resolvedPath)
    || !basename(resolvedPath).startsWith(prefix)
  ) {
    throw new LocalDataBackupError(
      "backup_io_error",
      "拒绝清理不属于本次操作的暂存目录",
    );
  }
  await rm(resolvedPath, { recursive: true, force: true });
}

export async function createVerifiedLocalDataBackup(input: {
  dataDir: string;
  backupRoot: string;
  now?: () => string;
}): Promise<VerifiedLocalDataBackup> {
  const dataDir = await canonicalPath(input.dataDir);
  const backupRoot = await canonicalPath(input.backupRoot);
  if (backupRoot === dataDir || isWithin(dataDir, backupRoot)) {
    throw new LocalDataBackupError(
      "backup_invalid",
      "备份目录必须位于 DATA_DIR 之外",
    );
  }
  const lease = await acquireLocalDataDirectoryLease({
    dataDir,
    purpose: "offline-backup",
    ...(input.now ? { now: input.now } : {}),
  });
  const stagingPath = resolve(
    backupRoot,
    `.tmp-backup-${randomUUID()}`,
  );
  let stagingCreated = false;
  try {
    await mkdir(backupRoot, { recursive: true });
    await mkdir(resolve(stagingPath, PAYLOAD_DIRECTORY), {
      recursive: true,
      mode: 0o700,
    });
    await chmod(stagingPath, 0o700);
    await chmod(resolve(stagingPath, PAYLOAD_DIRECTORY), 0o700);
    stagingCreated = true;
    const files: LocalDataBackupFile[] = [];
    const sourceDirectories: string[] = [];
    const sourceFiles = await listRegularFiles(dataDir, { directories: sourceDirectories });
    const directories = sourceDirectories.map(path => portableRelative(dataDir, path)).sort(compareText);
    for (const directory of directories) await mkdir(resolvedManifestPath(resolve(stagingPath, PAYLOAD_DIRECTORY), directory), { recursive: true, mode: 0o700 });
    for (const source of sourceFiles) {
      const portablePath = portableRelative(dataDir, source);
      const destination = resolvedManifestPath(
        resolve(stagingPath, PAYLOAD_DIRECTORY),
        portablePath,
      );
      const copied = await copyStableFile(dataDir, source, destination);
      files.push({ ...copied, path: portablePath });
    }
    const directorySync = await syncDirectoryTree(stagingPath);
    const createdAt = (input.now ?? (() => new Date().toISOString()))();
    const manifest: LocalDataBackupManifest = {
      schema: LOCAL_DATA_BACKUP_SCHEMA,
      formatVersion: 2,
      productVersion: ProductVersion,
      createdAt,
      storageMode: "single_writer_local",
      backupMode: "offline",
      durabilityPolicy:
        "file_fsync+atomic_rename+parent_fsync_when_supported",
      directorySync,
      directories,
      files,
    };
    const manifestJson = canonicalManifestJson(manifest);
    const manifestHash = sha256Text(manifestJson);
    await writeAndSync(
      resolve(stagingPath, MANIFEST_FILE),
      `${manifestJson}\n`,
    );
    await writeAndSync(
      resolve(stagingPath, MANIFEST_HASH_FILE),
      `${manifestHash}\n`,
    );
    await syncDirectoryEntry(stagingPath);
    await verifyLocalDataBackupDirectory(stagingPath, false);
    const timestamp = createdAt.replace(/[^0-9]/gu, "").slice(0, 17);
    const finalPath = resolve(
      backupRoot,
      `backup-${timestamp}-${randomUUID().slice(0, 8)}-${manifestHash.slice(0, 16)}`,
    );
    try {
      await lstat(finalPath);
      throw new LocalDataBackupError(
        "backup_invalid",
        "正式备份目标已存在，拒绝覆盖",
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await rename(stagingPath, finalPath);
    stagingCreated = false;
    await syncDirectoryEntry(backupRoot);
    return verifyLocalDataBackup(finalPath);
  } catch (error) {
    if (
      error instanceof LocalDataBackupError
      || (error as { name?: string }).name === "LocalDataDirectoryLeaseError"
    ) {
      throw error;
    }
    throw new LocalDataBackupError(
      "backup_io_error",
      "创建本地数据备份失败",
      { cause: error instanceof Error ? error.message : String(error) },
    );
  } finally {
    if (stagingCreated) {
      await removeOwnedStagingDirectory(
        backupRoot,
        stagingPath,
        ".tmp-backup-",
      ).catch(() => undefined);
    }
    await lease.release();
  }
}

async function verifyLocalDataBackupDirectory(
  backupPath: string,
  requireFingerprintedName: boolean,
): Promise<VerifiedLocalDataBackup> {
  try {
    const manifestText = await readFile(
      resolve(backupPath, MANIFEST_FILE),
      "utf8",
    );
    const manifest = validateManifest(JSON.parse(manifestText));
    const canonical = canonicalManifestJson(manifest);
    const manifestHash = sha256Text(canonical);
    const declaredHash = (
      await readFile(resolve(backupPath, MANIFEST_HASH_FILE), "utf8")
    ).trim();
    if (
      !HASH_PATTERN.test(declaredHash)
      || declaredHash !== manifestHash
      || (
        requireFingerprintedName
        && !basename(backupPath).endsWith(`-${manifestHash.slice(0, 16)}`)
      )
    ) {
      throw new LocalDataBackupError(
        "backup_invalid",
        "备份清单哈希或目录指纹不匹配",
      );
    }
    const payloadRoot = resolve(backupPath, PAYLOAD_DIRECTORY);
    const directories: string[] = [];
    const actualPaths = (await listRegularFiles(payloadRoot, { directories }))
      .map((path) => portableRelative(payloadRoot, path));
    const expectedPaths = manifest.files.map((file) => file.path);
    assertDirectoryInventory(payloadRoot, directories, manifest);
    if (actualPaths.join("\0") !== expectedPaths.join("\0")) {
      throw new LocalDataBackupError(
        "backup_invalid",
        "备份载荷文件集合与清单不一致",
      );
    }
    for (const file of manifest.files) {
      const path = resolvedManifestPath(payloadRoot, file.path);
      const [info, digest] = await Promise.all([
        lstat(path),
        sha256VerifiedFile(payloadRoot, path),
      ]);
      if (
        !info.isFile()
        || info.size !== file.sizeBytes
        || digest !== file.sha256
      ) {
        throw new LocalDataBackupError(
          "backup_invalid",
          "备份载荷文件大小或哈希不匹配",
          { path: file.path },
        );
      }
    }
    return { backupPath, manifest, manifestHash };
  } catch (error) {
    if (error instanceof LocalDataBackupError) throw error;
    throw new LocalDataBackupError(
      "backup_invalid",
      "无法读取或验证本地数据备份",
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }
}

export async function verifyLocalDataBackup(
  backupPathInput: string,
): Promise<VerifiedLocalDataBackup> {
  return verifyLocalDataBackupDirectory(
    await canonicalPath(backupPathInput),
    true,
  );
}

/**
 * Prepares an explicit integrity-projection rebaseline for an offline upgrade.
 *
 * Recovery checkpoints commit to both durable facts and versioned derived
 * projections. When the projection schema changes, silently treating an old
 * derived hash as current would either reject every legitimate upgrade or
 * weaken tamper detection. This operation therefore requires a verified,
 * byte-for-byte matching offline backup before it atomically archives the old
 * checkpoint catalog. The new runtime can then create a checkpoint with its
 * own projection schema, while rollback keeps the original catalog in the
 * verified backup.
 */
export async function prepareVerifiedCheckpointRebaseline(input: {
  backupPath: string;
  dataDir: string;
  now?: () => string;
}): Promise<PreparedCheckpointRebaseline> {
  const verified = await verifyLocalDataBackup(input.backupPath);
  assertRestorableBackupProductVersion(verified.manifest.productVersion);
  assertRestorableBackupLayout(verified.manifest);
  const dataDir = await canonicalPath(input.dataDir);
  const lease = await acquireLocalDataDirectoryLease({
    dataDir,
    purpose: "offline-checkpoint-rebaseline",
    ...(input.now ? { now: input.now } : {}),
  });
  const checkpointPrefix = "recovery-checkpoints/";
  const checkpointFileCount = verified.manifest.files.filter(
    (file) => file.path.startsWith(checkpointPrefix),
  ).length;
  const fingerprint = verified.manifestHash.slice(0, 16);
  const archiveName = [
    "recovery-checkpoints-legacy",
    verified.manifest.productVersion,
    fingerprint,
  ].join("-");
  const markerName = `.ronggang-checkpoint-rebaseline-${fingerprint}.json`;
  const source = resolve(dataDir, "recovery-checkpoints");
  const archivedDirectory = resolve(dataDir, archiveName);
  const markerPath = resolve(dataDir, markerName);
  let archived = false;
  let markerWriteAttempted = false;
  try {
    await verifyRestoredPayload(dataDir, verified.manifest);
    if (checkpointFileCount === 0) {
      throw new LocalDataBackupError(
        "backup_invalid",
        "备份不含恢复检查点，不能证明旧运行时完整性基线",
      );
    }
    const sourceInfo = await lstat(source);
    if (!sourceInfo.isDirectory() || sourceInfo.isSymbolicLink()) {
      throw new LocalDataBackupError(
        "backup_invalid",
        "恢复检查点目录不是受支持的普通目录",
      );
    }
    for (const target of [archivedDirectory, markerPath]) {
      try {
        await lstat(target);
        throw new LocalDataBackupError(
          "backup_invalid",
          "检查点升级目标已经存在，拒绝覆盖",
          { target },
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    await rename(source, archivedDirectory);
    archived = true;
    const preparedAt = (input.now ?? (() => new Date().toISOString()))();
    markerWriteAttempted = true;
    await writeAndSync(markerPath, `${JSON.stringify({
      schema: CHECKPOINT_REBASELINE_SCHEMA,
      version: 1,
      preparedAt,
      fromProductVersion: verified.manifest.productVersion,
      toProductVersion: ProductVersion,
      backupManifestHash: verified.manifestHash,
      archivedDirectory: archiveName,
      checkpointFileCount,
      rule: "verified_backup_exact_match_then_archive_old_projection_checkpoints",
    })}\n`);
    await syncDirectoryEntry(dataDir);
    return {
      status: "prepared",
      dataDir,
      fromProductVersion: verified.manifest.productVersion,
      toProductVersion: ProductVersion,
      backupManifestHash: verified.manifestHash,
      archivedDirectory,
      markerPath,
      checkpointFileCount,
    };
  } catch (error) {
    if (markerWriteAttempted) await unlink(markerPath).catch(() => undefined);
    if (archived) await rename(archivedDirectory, source).catch(() => undefined);
    await syncDirectoryEntry(dataDir).catch(() => undefined);
    if (error instanceof LocalDataBackupError) throw error;
    throw new LocalDataBackupError(
      "backup_io_error",
      "准备恢复检查点升级基线失败",
      { cause: error instanceof Error ? error.message : String(error) },
    );
  } finally {
    await lease.release();
  }
}

export async function restoreVerifiedLocalDataBackup(input: {
  backupPath: string;
  targetDataDir: string;
}): Promise<VerifiedLocalDataBackup> {
  const verified = await verifyLocalDataBackup(input.backupPath);
  assertRestorableBackupProductVersion(verified.manifest.productVersion);
  assertRestorableBackupLayout(verified.manifest);
  const targetDataDir = await canonicalPath(input.targetDataDir);
  if (
    targetDataDir === verified.backupPath
    || isWithin(verified.backupPath, targetDataDir)
  ) {
    throw new LocalDataBackupError(
      "backup_invalid",
      "恢复目标不得位于备份目录内部",
    );
  }
  const lease = await acquireLocalDataDirectoryLease({
    dataDir: targetDataDir,
    purpose: "offline-restore",
  });
  const targetParent = dirname(targetDataDir);
  const ownerToken = randomUUID();
  const ownerPath = resolve(targetDataDir, LOCAL_DATA_RESTORE_OWNER_FILE);
  let targetCreated = false;
  let ownerWritten = false;
  let restoreCommitted = false;
  try {
    try {
      await mkdir(targetParent, { recursive: true });
      await mkdir(targetDataDir, { recursive: false, mode: 0o700 });
      targetCreated = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new LocalDataBackupError(
          "restore_target_exists",
          "恢复目标已存在；为避免覆盖，必须选择不存在的新目录",
        );
      }
      throw error;
    }
    await writeAndSync(
      ownerPath,
      `${JSON.stringify({
        schema: RESTORE_OWNER_SCHEMA,
        token: ownerToken,
      })}\n`,
    );
    ownerWritten = true;
    await syncDirectoryEntry(targetDataDir);
    await syncDirectoryEntry(targetParent);
    const payloadRoot = resolve(verified.backupPath, PAYLOAD_DIRECTORY);
    for (const directory of verified.manifest.directories ?? []) await mkdir(resolvedManifestPath(targetDataDir, directory), { recursive: true, mode: 0o700 });
    for (const file of verified.manifest.files) {
      const source = resolvedManifestPath(payloadRoot, file.path);
      const destination = resolvedManifestPath(targetDataDir, file.path);
      const copied = await copyStableFile(
        payloadRoot,
        source,
        destination,
      );
      if (
        copied.sizeBytes !== file.sizeBytes
        || copied.sha256 !== file.sha256
      ) {
        throw new LocalDataBackupError(
          "backup_invalid",
          "恢复目标文件未通过清单复核",
          { path: file.path },
        );
      }
    }
    await hardenPrivateTree(targetDataDir);
    await verifyRestoredPayload(targetDataDir, verified.manifest);
    await syncDirectoryTree(targetDataDir);
    await unlink(ownerPath);
    restoreCommitted = true;
    await syncDirectoryEntry(targetDataDir);
    await syncDirectoryEntry(targetParent);
    return verified;
  } catch (error) {
    if (error instanceof LocalDataBackupError) throw error;
    throw new LocalDataBackupError(
      "backup_io_error",
      "恢复本地数据备份失败",
      { cause: error instanceof Error ? error.message : String(error) },
    );
  } finally {
    if (targetCreated && !restoreCommitted) {
      let ownsTarget = !ownerWritten;
      if (ownerWritten) {
        try {
          const owner = JSON.parse(
            await readFile(ownerPath, "utf8"),
          ) as Record<string, unknown>;
          ownsTarget = owner.schema === RESTORE_OWNER_SCHEMA
            && owner.token === ownerToken;
        } catch {
          ownsTarget = false;
        }
      }
      if (ownsTarget) {
        const resolvedParent = resolve(targetParent);
        const resolvedTarget = resolve(targetDataDir);
        if (
          dirname(resolvedTarget) === resolvedParent
          && isWithin(resolvedParent, resolvedTarget)
        ) {
          await rm(resolvedTarget, {
            recursive: true,
            force: true,
          }).catch(() => undefined);
        }
      }
    }
    await lease.release();
  }
}
