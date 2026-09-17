import {
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  dirname,
  relative,
  resolve,
} from "node:path";
import {
  captureCommand,
  projectRoot,
} from "./lib/release-process.mjs";
import { assertRuntimePrerequisites } from "./check-runtime-prerequisites.mjs";
import { releaseBaselines, baselineStopMode } from "./lib/release-policy.mjs";

const args = process.argv.slice(2);
const requireClean = args.includes("--require-clean");
const requireTag = args.includes("--require-tag");
const requireReceipts = args.includes("--require-receipts");
const outputIndex = args.indexOf("--output");
const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : null;
if (outputIndex >= 0 && !outputPath) {
  throw new Error("--output 缺少文件路径");
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const STABLE_SNAPSHOT_KEYS = [
  "sessionId",
  "stateVersion",
  "scenarioContentHash",
  "markerInteractionId",
  "markerStatus",
  "markerFingerprint",
];
const FORCED_CRASH_STOP_MODE =
  "forced_crash_then_explicit_stale_lease_recovery";
const GRACEFUL_STOP_MODE = "ipc_graceful_close";

function parseEnvironment(text) {
  const values = new Map();
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) throw new Error(`.env.example 行格式无效：${line}`);
    values.set(line.slice(0, separator), line.slice(separator + 1));
  }
  return values;
}

function assertRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} 必须是对象`);
  }
  return value;
}

function assertExact(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(
      `${label} 不一致：期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`,
    );
  }
}

function assertSha256(value, label) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new Error(`${label} 必须是小写 SHA-256`);
  }
}

function assertStableSnapshot(value, label) {
  const snapshot = assertRecord(value, label);
  if (
    typeof snapshot.sessionId !== "string"
    || snapshot.sessionId.length === 0
  ) {
    throw new Error(`${label}.sessionId 必须是非空字符串`);
  }
  if (
    !Number.isSafeInteger(snapshot.stateVersion)
    || snapshot.stateVersion < 0
  ) {
    throw new Error(`${label}.stateVersion 必须是非负安全整数`);
  }
  assertSha256(
    snapshot.scenarioContentHash,
    `${label}.scenarioContentHash`,
  );
  if (
    typeof snapshot.markerInteractionId !== "string"
    || snapshot.markerInteractionId.length === 0
  ) {
    throw new Error(`${label}.markerInteractionId 必须是非空字符串`);
  }
  assertExact(snapshot.markerStatus, "responded", `${label}.markerStatus`);
  assertSha256(snapshot.markerFingerprint, `${label}.markerFingerprint`);
  return snapshot;
}

function assertSnapshotEquals(actual, expected, label) {
  for (const key of STABLE_SNAPSHOT_KEYS) {
    assertExact(actual[key], expected[key], `${label}.${key}`);
  }
}

function assertRuntimeSection(section, snapshot, label) {
  if (
    !Array.isArray(section.sessionIds)
    || section.sessionIds.length < 2
    || !section.sessionIds.every(
      (sessionId) => typeof sessionId === "string" && sessionId.length > 0,
    )
  ) {
    throw new Error(`${label}.sessionIds 必须至少包含两个有效会话`);
  }
  if (!section.sessionIds.includes(snapshot.sessionId)) {
    throw new Error(`${label}.sessionIds 未包含稳定快照会话`);
  }
  if (
    !Number.isSafeInteger(section.bindingCount)
    || section.bindingCount < 3
  ) {
    throw new Error(`${label}.bindingCount 必须至少为 3`);
  }
}

async function readReceipt(fileName, label) {
  try {
    return JSON.parse(await readFile(
      resolve(projectRoot, ".release-audit", fileName),
      "utf8",
    ));
  } catch (error) {
    throw new Error(
      `${label} 缺失或不是有效 JSON：${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
}

async function workspacePackageFiles() {
  const result = [resolve(projectRoot, "package.json")];
  for (const parentName of ["apps", "packages"]) {
    const parent = resolve(projectRoot, parentName);
    for (const entry of await readdir(parent, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        result.push(resolve(parent, entry.name, "package.json"));
      }
    }
  }
  return result;
}

async function git(args) {
  return (await captureCommand("git", args, {
    cwd: projectRoot,
    label: `git ${args.join(" ")}`,
  })).stdout.trim();
}

const runtime = await assertRuntimePrerequisites();
const packageFiles = await workspacePackageFiles();
const packages = await Promise.all(packageFiles.map(async (path) => {
  const value = JSON.parse(await readFile(path, "utf8"));
  return {
    path: relative(projectRoot, path).replaceAll("\\", "/"),
    name: String(value.name),
    version: String(value.version),
  };
}));
const rootPackage = packages.find((item) => item.path === "package.json");
if (!rootPackage) throw new Error("缺少根 package.json");
const divergent = packages.filter(
  (item) => item.version !== rootPackage.version,
);
if (divergent.length > 0) {
  throw new Error(`工作区版本漂移：${JSON.stringify(divergent)}`);
}
const versionSource = await readFile(
  resolve(projectRoot, "packages/contracts/src/version.ts"),
  "utf8",
);
const productVersion = /ProductVersion = "([^"]+)"/u.exec(versionSource)?.[1];
if (productVersion !== rootPackage.version) {
  throw new Error("ProductVersion 与 package 版本不一致");
}

const rootPackageJson = JSON.parse(await readFile(
  resolve(projectRoot, "package.json"),
  "utf8",
));
const lockfileSha256 = createHash("sha256").update(
  await readFile(resolve(projectRoot, "pnpm-lock.yaml")),
).digest("hex");
const requiredScripts = [
  "build",
  "check",
  "demo",
  "release:audit",
  "release:archive",
  "release:check",
  "release:clean-room",
  "release:data-drill",
  "test:e2e",
];
for (const name of requiredScripts) {
  if (typeof rootPackageJson.scripts?.[name] !== "string") {
    throw new Error(`缺少发布脚本：${name}`);
  }
}

const exampleEnvironment = parseEnvironment(await readFile(
  resolve(projectRoot, ".env.example"),
  "utf8",
));
for (const [name, value] of exampleEnvironment) {
  if (
    /(KEY|SECRET|TOKEN)$/u.test(name)
    && value.trim().length > 0
  ) {
    throw new Error(`.env.example 的敏感字段必须为空：${name}`);
  }
}
if (
  exampleEnvironment.get("MODEL_PROVIDER") !== "deterministic"
  || exampleEnvironment.get("IFLYTEK_MODE") !== "mock"
  || exampleEnvironment.get("STARTUP_RECOVERY_MODE") !== "blocking"
) {
  throw new Error(".env.example 必须保留离线确定性演示默认值");
}

const readme = await readFile(resolve(projectRoot, "README.md"), "utf8");
for (const command of [
  "pnpm install --frozen-lockfile",
  "pnpm browser:install",
  "pnpm demo",
  "pnpm release:clean-room",
  "pnpm release:data-drill",
]) {
  if (!readme.includes(command)) {
    throw new Error(`README 缺少发布入口：${command}`);
  }
}

const trackedFiles = (await git(["ls-files"]))
  .split(/\r?\n/u)
  .filter(Boolean)
  .map((path) => path.replaceAll("\\", "/"));
const forbiddenTracked = trackedFiles.filter((path) => (
  /(^|\/)node_modules\//u.test(path)
  || /(^|\/)dist\//u.test(path)
  || /(^|\/)\.env\.local$/u.test(path)
  || /(^|\/)\.data(?:-|\/|$)/u.test(path)
));
if (forbiddenTracked.length > 0) {
  throw new Error(`Git 跟踪了本地/生成数据：${forbiddenTracked.join(", ")}`);
}

const branch = await git(["branch", "--show-current"]);
const head = await git(["rev-parse", "HEAD"]);
const status = await git(["status", "--porcelain"]);
if ((requireClean || requireReceipts) && status.length > 0) {
  throw new Error("发布审计要求干净工作树");
}
const tagName = `V${rootPackage.version}`;
let tagTarget = null;
let tagType = null;
if (requireTag) {
  tagType = await git(["cat-file", "-t", tagName]);
  if (tagType !== "tag") {
    throw new Error(`${tagName} 必须是 annotated tag`);
  }
  tagTarget = await git(["rev-list", "-n", "1", tagName]);
  if (tagTarget !== head) {
    throw new Error(`${tagName} 未指向当前 HEAD`);
  }
}

function assertReceiptBinding(receipt, label) {
  assertExact(receipt.candidateHead, head, `${label}.candidateHead`);
  assertExact(receipt.sourceClean, true, `${label}.sourceClean`);
  assertExact(
    receipt.lockfileSha256,
    lockfileSha256,
    `${label}.lockfileSha256`,
  );
}

function validateCleanRoomReceipt(receipt) {
  const label = "clean-room 收据";
  assertRecord(receipt, label);
  assertExact(
    receipt.schema,
    "ronggang.clean-room-check.v1",
    `${label}.schema`,
  );
  assertExact(receipt.status, "verified", `${label}.status`);
  assertExact(receipt.version, rootPackage.version, `${label}.version`);
  assertExact(receipt.mode, "full", `${label}.mode`);
  assertExact(receipt.frozenLockfile, true, `${label}.frozenLockfile`);
  assertExact(receipt.browserInstall, true, `${label}.browserInstall`);
  assertReceiptBinding(receipt, label);
}

async function validateUpgradeRollbackReceipt(receipt, expectedRef) {
  const label = `${expectedRef} 升级/回滚收据`;
  assertRecord(receipt, label);
  assertExact(
    receipt.schema,
    "ronggang.upgrade-rollback-drill.v1",
    `${label}.schema`,
  );
  assertExact(receipt.status, "verified", `${label}.status`);
  assertReceiptBinding(receipt, label);

  const from = assertRecord(receipt.from, `${label}.from`);
  const upgrade = assertRecord(receipt.upgrade, `${label}.upgrade`);
  const rollback = assertRecord(receipt.rollback, `${label}.rollback`);
  const expectedFromVersion = expectedRef.slice(1);
  assertExact(from.ref, expectedRef, `${label}.from.ref`);
  assertExact(from.version, expectedFromVersion, `${label}.from.version`);
  assertExact(
    upgrade.version,
    rootPackage.version,
    `${label}.upgrade.version`,
  );
  assertExact(
    rollback.version,
    expectedFromVersion,
    `${label}.rollback.version`,
  );
  assertExact(
    rollback.restoredFromProductVersion,
    expectedFromVersion,
    `${label}.rollback.restoredFromProductVersion`,
  );
  assertExact(
    rollback.dataRule,
    "restore_pre_upgrade_backup_to_new_directory",
    `${label}.rollback.dataRule`,
  );
  assertSha256(rollback.manifestHash, `${label}.rollback.manifestHash`);

  const initialSnapshot = assertStableSnapshot(
    from.initialActionSnapshot,
    `${label}.from.initialActionSnapshot`,
  );
  const fromSnapshot = assertStableSnapshot(
    from.durableSnapshot,
    `${label}.from.durableSnapshot`,
  );
  const upgradeSnapshot = assertStableSnapshot(
    upgrade.durableSnapshot,
    `${label}.upgrade.durableSnapshot`,
  );
  const rollbackSnapshot = assertStableSnapshot(
    rollback.durableSnapshot,
    `${label}.rollback.durableSnapshot`,
  );
  assertSnapshotEquals(
    upgradeSnapshot,
    fromSnapshot,
    `${label}.upgrade.durableSnapshot`,
  );
  assertSnapshotEquals(
    rollbackSnapshot,
    fromSnapshot,
    `${label}.rollback.durableSnapshot`,
  );
  for (const key of STABLE_SNAPSHOT_KEYS.filter(
    (snapshotKey) => snapshotKey !== "stateVersion",
  )) {
    assertExact(
      initialSnapshot[key],
      fromSnapshot[key],
      `${label}.from.initialActionSnapshot.${key}`,
    );
  }
  if (initialSnapshot.stateVersion > fromSnapshot.stateVersion) {
    throw new Error(
      `${label}.from.initialActionSnapshot.stateVersion `
      + "不能大于稳定快照版本",
    );
  }

  assertRuntimeSection(from, fromSnapshot, `${label}.from`);
  assertRuntimeSection(upgrade, upgradeSnapshot, `${label}.upgrade`);
  assertRuntimeSection(rollback, rollbackSnapshot, `${label}.rollback`);
  assertExact(
    upgrade.stopMode,
    GRACEFUL_STOP_MODE,
    `${label}.upgrade.stopMode`,
  );
  if (baselineStopMode(expectedRef) === GRACEFUL_STOP_MODE) {
    for (const [path, value] of [
      ["from.initialStopMode", from.initialStopMode],
      ["from.stopMode", from.stopMode],
      ["rollback.stopMode", rollback.stopMode],
    ]) {
      assertExact(value, GRACEFUL_STOP_MODE, `${label}.${path}`);
    }
  } else {
    for (const [path, value] of [
      ["from.initialStopMode", from.initialStopMode],
      ["from.stopMode", from.stopMode],
      ["rollback.stopMode", rollback.stopMode],
    ]) {
      assertExact(value, FORCED_CRASH_STOP_MODE, `${label}.${path}`);
    }
  }

  const fromTagType = await git(["cat-file", "-t", expectedRef]);
  if (fromTagType !== "tag") {
    throw new Error(`${expectedRef} 必须仍是 annotated tag`);
  }
  return {
    checkedAt: receipt.checkedAt,
    from: expectedRef,
    candidateHead: receipt.candidateHead,
    lockfileSha256: receipt.lockfileSha256,
    markerFingerprint: fromSnapshot.markerFingerprint,
    manifestHash: rollback.manifestHash,
    fromTagType,
  };
}

let releaseEvidence = null;
if (requireReceipts) {
  const requiredDrills = releaseBaselines(rootPackage.version);
  const cleanRoom = await readReceipt(
    "clean-room-check.json",
    "clean-room 收据",
  );
  validateCleanRoomReceipt(cleanRoom);
  const upgradeRollback = [];
  for (const fromRef of requiredDrills) {
    const receipt = await readReceipt(
      `upgrade-rollback-drill-${fromRef}.json`,
      `${fromRef} 升级/回滚收据`,
    );
    upgradeRollback.push(
      await validateUpgradeRollbackReceipt(receipt, fromRef),
    );
  }
  releaseEvidence = {
    cleanRoom: {
      checkedAt: cleanRoom.checkedAt,
      mode: cleanRoom.mode,
      frozenLockfile: cleanRoom.frozenLockfile,
      browserInstall: cleanRoom.browserInstall,
      candidateHead: cleanRoom.candidateHead,
      lockfileSha256: cleanRoom.lockfileSha256,
    },
    upgradeRollback,
  };
}

const sourceClean = status.length === 0;
const tagVerified = requireTag
  && tagType === "tag"
  && tagTarget === head;
const result = {
  schema: "ronggang.release-audit.v1",
  checkedAt: new Date().toISOString(),
  version: rootPackage.version,
  productVersion,
  candidateHead: head,
  sourceClean,
  lockfileSha256,
  manifestCount: packages.length,
  runtime,
  git: {
    branch,
    head,
    clean: sourceClean,
    tagName,
    tagChecked: requireTag,
    tagVerified,
    tagType,
    tagTarget,
  },
  tagVerification: {
    required: requireTag,
    checked: requireTag,
    verified: tagVerified,
    name: tagName,
    type: tagType,
    target: tagTarget,
    matchesHead: requireTag ? tagTarget === head : null,
  },
  defaults: {
    modelProvider: exampleEnvironment.get("MODEL_PROVIDER"),
    iflytekMode: exampleEnvironment.get("IFLYTEK_MODE"),
    startupRecoveryMode: exampleEnvironment.get("STARTUP_RECOVERY_MODE"),
    secretFieldsEmpty: true,
  },
  trackedSourceClean: true,
  releaseEvidence,
  requiredScripts,
  status: "verified",
};
const serialized = `${JSON.stringify(result, null, 2)}\n`;
if (outputPath) {
  const resolvedOutput = resolve(outputPath);
  await mkdir(dirname(resolvedOutput), { recursive: true });
  await writeFile(resolvedOutput, serialized, {
    encoding: "utf8",
    mode: 0o600,
  });
}
process.stdout.write(serialized);
