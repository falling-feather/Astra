import {
  createVerifiedLocalDataBackup,
  prepareVerifiedCheckpointRebaseline,
  restoreVerifiedLocalDataBackup,
  verifyLocalDataBackup,
} from "./local-data-backup.js";
import {
  inspectLocalDataDirectoryLease,
  recoverStaleLocalDataDirectoryLease,
} from "./local-data-directory-lease.js";

function usage(): string {
  return [
    "用法：",
    "  data-safety-cli backup --data-dir <目录> --backup-root <目录>",
    "  data-safety-cli verify --backup <备份目录>",
    "  data-safety-cli restore --backup <备份目录> --target-data-dir <新目录>",
    "  data-safety-cli prepare-upgrade-checkpoints --data-dir <目录> --backup <备份目录>",
    "  data-safety-cli lease-status --data-dir <目录>",
    "  data-safety-cli recover-stale-lease --data-dir <目录>",
    "",
    "backup 是停机备份：API 持有同一 DATA_DIR 租约时会明确拒绝。",
    "restore 只接受不存在的新目标目录，不覆盖现有数据。",
    "prepare-upgrade-checkpoints 仅在数据逐文件匹配已验证停机备份后归档旧派生检查点。",
  ].join("\n");
}

function parseFlags(values: readonly string[]): Map<string, string> {
  const normalized = values[0] === "--" ? values.slice(1) : values;
  const result = new Map<string, string>();
  for (let index = 0; index < normalized.length; index += 2) {
    const key = normalized[index];
    const value = normalized[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error(usage());
    }
    if (result.has(key)) throw new Error(`参数重复：${key}`);
    result.set(key, value);
  }
  return result;
}

function required(flags: Map<string, string>, name: string): string {
  const value = flags.get(name);
  if (!value) throw new Error(`缺少参数 ${name}\n\n${usage()}`);
  return value;
}

function assertOnlyFlags(
  flags: Map<string, string>,
  allowed: readonly string[],
): void {
  for (const key of flags.keys()) {
    if (!allowed.includes(key)) throw new Error(`不支持的参数：${key}`);
  }
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function run(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);
  if (command === "backup") {
    assertOnlyFlags(flags, ["--data-dir", "--backup-root"]);
    const result = await createVerifiedLocalDataBackup({
      dataDir: required(flags, "--data-dir"),
      backupRoot: required(flags, "--backup-root"),
    });
    print({
      status: "verified",
      backupPath: result.backupPath,
      manifestHash: result.manifestHash,
      productVersion: result.manifest.productVersion,
      fileCount: result.manifest.files.length,
      directorySync: result.manifest.directorySync,
    });
    return;
  }
  if (command === "verify") {
    assertOnlyFlags(flags, ["--backup"]);
    const result = await verifyLocalDataBackup(
      required(flags, "--backup"),
    );
    print({
      status: "verified",
      backupPath: result.backupPath,
      manifestHash: result.manifestHash,
      productVersion: result.manifest.productVersion,
      fileCount: result.manifest.files.length,
    });
    return;
  }
  if (command === "restore") {
    assertOnlyFlags(flags, ["--backup", "--target-data-dir"]);
    const result = await restoreVerifiedLocalDataBackup({
      backupPath: required(flags, "--backup"),
      targetDataDir: required(flags, "--target-data-dir"),
    });
    print({
      status: "restored",
      manifestHash: result.manifestHash,
      productVersion: result.manifest.productVersion,
      fileCount: result.manifest.files.length,
    });
    return;
  }
  if (command === "prepare-upgrade-checkpoints") {
    assertOnlyFlags(flags, ["--data-dir", "--backup"]);
    print(await prepareVerifiedCheckpointRebaseline({
      dataDir: required(flags, "--data-dir"),
      backupPath: required(flags, "--backup"),
    }));
    return;
  }
  if (command === "lease-status") {
    assertOnlyFlags(flags, ["--data-dir"]);
    print(await inspectLocalDataDirectoryLease(
      required(flags, "--data-dir"),
    ));
    return;
  }
  if (command === "recover-stale-lease") {
    assertOnlyFlags(flags, ["--data-dir"]);
    const dataDir = required(flags, "--data-dir");
    await recoverStaleLocalDataDirectoryLease(dataDir);
    print({ status: "available" });
    return;
  }
  throw new Error(usage());
}

await run().catch((error) => {
  const candidate = error as {
    code?: unknown;
    message?: unknown;
    details?: unknown;
  };
  process.stderr.write(`${JSON.stringify({
    status: "error",
    code: typeof candidate.code === "string"
      ? candidate.code
      : "data_safety_cli_error",
    message: typeof candidate.message === "string"
      ? candidate.message
      : String(error),
    ...(candidate.details && typeof candidate.details === "object"
      ? { details: candidate.details }
      : {}),
  })}\n`);
  process.exitCode = 1;
});
