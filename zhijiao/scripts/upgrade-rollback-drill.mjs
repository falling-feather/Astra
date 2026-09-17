import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  basename,
  dirname,
  join,
  resolve,
  sep,
} from "node:path";
import {
  captureCommand,
  forkApi,
  pnpmExecutable,
  projectRoot,
  runCommand,
  stopApiGracefully,
  terminateProcessTree,
  waitForHttpJson,
} from "./lib/release-process.mjs";
import { assertRuntimePrerequisites } from "./check-runtime-prerequisites.mjs";
import { releaseBaselines } from "./lib/release-policy.mjs";

const args = process.argv.slice(2).filter((argument) => argument !== "--");
const fromRefIndex = args.indexOf("--from-ref");
const fromRef = fromRefIndex >= 0
  ? args[fromRefIndex + 1]
  : releaseBaselines(JSON.parse(await readFile(resolve(projectRoot, 'package.json'), 'utf8')).version).at(-1);
if (!fromRef || !/^V\d+\.\d+\.\d+$/u.test(fromRef)) {
  throw new Error("--from-ref 必须是 Vx.y.z 标签");
}
const allowDirty = args.includes("--allow-dirty");
const skipCurrentBuild =
  process.env.RELEASE_DRILL_SKIP_CURRENT_BUILD === "1";
const keep = process.env.RELEASE_DRILL_KEEP === "1";
const tempParent = resolve(projectRoot, '.local', 'release-validation');
await mkdir(tempParent, {recursive: true});
const root = await mkdtemp(join(tempParent, "ronggang-upgrade-drill-"));
const oldTree = resolve(root, "old-tree");
const repositoryRoot = projectRoot;
const oldProject = oldTree;
const oldData = resolve(root, "old-data");
const oldBackupRoot = resolve(root, "old-backups");
const rollbackData = resolve(root, "rollback-data");
const apiPort = Number(process.env.RELEASE_DRILL_API_PORT ?? 3201);
const apiOrigin = `http://127.0.0.1:${apiPort}`;
const webOrigin = "http://127.0.0.1:4173";
const durableMarkerOptionId = "reporter-interview-process";
const activeChildren = new Set();
let worktreeRegistered = false;
let primaryFailure = null;
let candidateHead = null;
let candidateTree = null;
let lockfileSha256 = null;
let sourceClean = false;
let fromTarget = null;
const receiptPath = resolve(
  projectRoot,
  ".release-audit",
  `upgrade-rollback-drill-${fromRef}.json`,
);
await rm(receiptPath, { force: true });

async function removeRegisteredWorktreeWithRetry(path) {
  let latestError = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      await captureCommand("git", [
        "worktree",
        "remove",
        "--force",
        path,
      ], {
        cwd: repositoryRoot,
        label: `remove ${fromRef} worktree`,
      });
      return;
    } catch (error) {
      if (
        error instanceof Error
        && error.message.includes("is not a working tree")
      ) {
        return;
      }
      latestError = error;
      if (attempt < 4) {
        await new Promise((resolvePromise) => {
          setTimeout(resolvePromise, attempt * 300);
        });
      }
    }
  }
  throw latestError ?? new Error(`remove ${fromRef} worktree failed`);
}

async function parsePackageVersion(directory) {
  return JSON.parse(await readFile(
    resolve(directory, "package.json"),
    "utf8",
  )).version;
}

function isVersionAtLeast(version, minimum) {
  const parse = (value) => {
    const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(value);
    if (!match) throw new Error(`无法比较非语义版本：${value}`);
    return match.slice(1).map(Number);
  };
  const actual = parse(version);
  const floor = parse(minimum);
  for (let index = 0; index < floor.length; index += 1) {
    if (actual[index] !== floor[index]) {
      return actual[index] > floor[index];
    }
  }
  return true;
}

async function requestJson(url, label, request = {}) {
  const response = await fetch(url, {
    ...request,
    signal: AbortSignal.timeout(5_000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `${label} failed (${response.status}): ${text.slice(0, 500)}`,
    );
  }
  return {
    body: text ? JSON.parse(text) : null,
    response,
  };
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

function snapshotMarker(projection, marker) {
  return {
    sessionId: projection.sessionId,
    stateVersion: projection.stateVersion,
    scenarioContentHash: projection.scenario.contentHash,
    markerInteractionId: marker.request.interactionId,
    markerStatus: marker.status,
    markerFingerprint: createHash("sha256")
      .update(JSON.stringify(canonicalize(marker)))
      .digest("hex"),
  };
}

async function readProjection(runtime) {
  return (await requestJson(
    `${apiOrigin}/api/sessions/${runtime.sessionId}/projection?bindingId=${encodeURIComponent(runtime.reporterBindingId)}`,
    "drill reporter projection",
    {
      headers: {
        Cookie: runtime.cookie,
      },
    },
  )).body;
}

function assertSnapshotMatches(actual, expected, label) {
  for (const key of [
    "sessionId",
    "stateVersion",
    "scenarioContentHash",
    "markerInteractionId",
    "markerStatus",
    "markerFingerprint",
  ]) {
    if (actual[key] !== expected[key]) {
      throw new Error(
        `${label} 没有保留旧版业务状态：${key} 期待 ${expected[key]}，实际 ${actual[key]}`,
      );
    }
  }
}

function assertMarkerContinuity(actual, expected, label) {
  for (const key of [
    "sessionId",
    "scenarioContentHash",
    "markerInteractionId",
    "markerStatus",
    "markerFingerprint",
  ]) {
    if (actual[key] !== expected[key]) {
      throw new Error(
        `${label} 在稳定化期间改变了业务标记：${key} 期待 ${expected[key]}，实际 ${actual[key]}`,
      );
    }
  }
  if (actual.stateVersion < expected.stateVersion) {
    throw new Error(
      `${label} 在稳定化期间状态版本回退：期待不小于 ${expected.stateVersion}，实际 ${actual.stateVersion}`,
    );
  }
}

async function waitForDurableMarker(runtime, expectedSnapshot = null) {
  const deadline = Date.now() + 60_000;
  let latest = "marker missing";
  while (Date.now() < deadline) {
    try {
      const projection = await readProjection(runtime);
      const marker = projection.roleInteractions?.find(
        (interaction) => (
          interaction.request?.optionId === durableMarkerOptionId
        ),
      );
      if (marker?.status === "responded") {
        const snapshot = snapshotMarker(projection, marker);
        if (expectedSnapshot) {
          assertSnapshotMatches(snapshot, expectedSnapshot, runtime.version);
        }
        return snapshot;
      }
      latest = marker ? `marker status=${marker.status}` : "marker missing";
    } catch (error) {
      latest = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`业务状态标记等待超时：${latest}`);
}

async function seedDurableMarker(runtime) {
  const before = await readProjection(runtime);
  if (before.roleInteractions?.some(
    (interaction) => interaction.request?.optionId === durableMarkerOptionId,
  )) {
    throw new Error("旧版演练数据在播种前已经包含业务状态标记");
  }
  await requestJson(
    `${apiOrigin}/api/sessions/${runtime.sessionId}/commands`,
    "seed durable world action",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: runtime.cookie,
        Origin: webOrigin,
        "x-csrf-token": runtime.csrfToken,
      },
      body: JSON.stringify({
        bindingId: runtime.reporterBindingId,
        name: "send_role_interaction",
        expectedStateVersion: before.stateVersion,
        payload: {
          optionId: durableMarkerOptionId,
        },
      }),
    },
  );
  return waitForDurableMarker(runtime);
}

async function startApi(
  directory,
  dataDir,
  expectedVersion,
  expectedSnapshot = null,
) {
  const child = forkApi(resolve(directory, "apps/api/dist/main.js"), {
    cwd: directory,
    env: {
      NODE_ENV: "production",
      HOST: "127.0.0.1",
      PORT: String(apiPort),
      DATA_DIR: dataDir,
      MODEL_PROVIDER: "deterministic",
      MODEL_PROFILE_ID: "deterministic-release-drill",
      IFLYTEK_MODE: "mock",
      DEEPSEEK_LIVE_SMOKE: "0",
      STARTUP_RECOVERY_MODE: "blocking",
      WEB_ALLOWED_ORIGINS: webOrigin,
    },
  });
  activeChildren.add(child);
  child.once("exit", () => activeChildren.delete(child));
  const health = await waitForHttpJson(`${apiOrigin}/health`, "drill API");
  if (health?.version !== expectedVersion) {
    throw new Error(
      `演练 API 版本不一致：期待 ${expectedVersion}，实际 ${health?.version ?? "missing"}`,
    );
  }
  const profiles = await waitForHttpJson(
    `${apiOrigin}/api/auth/demo-profiles`,
    "drill demo profiles",
  );
  const profileById = new Map(
    (profiles?.profiles ?? []).map((profile) => [profile.profileId, profile]),
  );
  const operator = profileById.get("operator-demo");
  const teacherA = profileById.get("teacher-class-a");
  const teacherB = profileById.get("teacher-class-b");
  if (!operator || !teacherA || !teacherB) {
    throw new Error("演练身份目录缺少操作员或 A/B 班教师");
  }
  const sessionIds = [teacherA.defaultSessionId, teacherB.defaultSessionId];
  if (
    sessionIds.some((sessionId) => !sessionId)
    || new Set(sessionIds).size !== 2
    || !teacherA.authorizedSessionIds?.includes(teacherA.defaultSessionId)
    || !teacherB.authorizedSessionIds?.includes(teacherB.defaultSessionId)
    || !operator.authorizedSessionIds?.includes(operator.defaultSessionId)
  ) {
    throw new Error("演练数据没有形成相互隔离的 A/B 授权会话");
  }
  const loginResult = await requestJson(
    `${apiOrigin}/api/auth/demo-session`,
    "drill demo login",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: webOrigin,
      },
      body: JSON.stringify({
        profileId: operator.profileId,
        sessionId: operator.defaultSessionId,
      }),
    },
  );
  const login = loginResult.body;
  if (!Array.isArray(login?.bindings) || login.bindings.length < 3) {
    throw new Error("演练 API 未签发完整岗位绑定");
  }
  const cookieHeader = typeof loginResult.response.headers.getSetCookie === "function"
    ? loginResult.response.headers.getSetCookie()[0]
    : loginResult.response.headers.get("set-cookie");
  const cookie = cookieHeader?.split(";", 1)[0];
  const reporter = login.bindings.find(
    (binding) => binding.actorId === "student-reporter",
  );
  if (!cookie || !login.csrfToken || !reporter?.bindingId) {
    throw new Error("演练登录缺少 Cookie、CSRF 或记者岗位绑定");
  }
  const runtime = {
    child,
    version: health.version,
    sessionIds,
    sessionId: operator.defaultSessionId,
    bindingCount: login.bindings.length,
    cookie,
    csrfToken: login.csrfToken,
    reporterBindingId: reporter.bindingId,
  };
  const durableSnapshot = expectedSnapshot
    ? await waitForDurableMarker(runtime, expectedSnapshot)
    : null;
  return {
    ...runtime,
    durableSnapshot,
  };
}

async function dataCli(directory, args) {
  const result = await captureCommand(
    process.execPath,
    [resolve(directory, "apps/api/dist/data-safety-cli.js"), ...args],
    {
      cwd: directory,
      label: `data-safety-cli ${args[0]}`,
    },
  );
  return JSON.parse(result.stdout);
}

async function recoverForcedOldLease(directory, dataDir) {
  await dataCli(directory, [
    "recover-stale-lease",
    "--data-dir",
    dataDir,
  ]);
}

async function stopHistoricalApi(runtime, directory, dataDir) {
  if (isVersionAtLeast(runtime.version, "0.9.4")) {
    await stopApiGracefully(runtime.child);
    return "ipc_graceful_close";
  }
  await terminateProcessTree(runtime.child);
  await recoverForcedOldLease(directory, dataDir);
  return "forced_crash_then_explicit_stale_lease_recovery";
}

try {
  await assertRuntimePrerequisites();
  const gitStatus = (await captureCommand(
    "git",
    ["status", "--porcelain"],
    {
      cwd: repositoryRoot,
      label: "inspect release-drill source status",
    },
  )).stdout.trim();
  sourceClean = gitStatus.length === 0;
  if (!sourceClean && !allowDirty) {
    throw new Error(
      "升级/回滚发布收据要求干净工作树；开发态演练必须显式使用 --allow-dirty",
    );
  }
  candidateHead = (await captureCommand(
    "git",
    ["rev-parse", "HEAD"],
    {
      cwd: repositoryRoot,
      label: "resolve release-drill candidate HEAD",
    },
  )).stdout.trim();
  candidateTree = (await captureCommand(
    "git",
    ["rev-parse", "HEAD^{tree}"],
    {
      cwd: repositoryRoot,
      label: "resolve release-drill candidate tree",
    },
  )).stdout.trim();
  lockfileSha256 = createHash("sha256").update(
    await readFile(resolve(projectRoot, "pnpm-lock.yaml")),
  ).digest("hex");
  const fromRefType = (await captureCommand(
    "git",
    ["cat-file", "-t", fromRef],
    {
      cwd: repositoryRoot,
      label: `inspect ${fromRef}`,
    },
  )).stdout.trim();
  if (fromRefType !== "tag") {
    throw new Error(`${fromRef} 必须是 annotated tag`);
  }
  fromTarget = (await captureCommand(
    "git",
    ["rev-list", "-n", "1", fromRef],
    {
      cwd: repositoryRoot,
      label: `resolve ${fromRef} target`,
    },
  )).stdout.trim();
  await runCommand("git", [
    "worktree",
    "add",
    "--detach",
    oldTree,
    fromRef,
  ], {
    cwd: repositoryRoot,
    label: `checkout ${fromRef} worktree`,
  });
  worktreeRegistered = true;

  const oldInstallArgs = ["install", "--frozen-lockfile"];
  if (process.env.RELEASE_DRILL_OFFLINE === "1") {
    oldInstallArgs.push("--offline");
  }
  await runCommand(pnpmExecutable, oldInstallArgs, {
    cwd: oldProject,
    env: { CI: "1" },
    label: `${fromRef} frozen install`,
  });
  await runCommand(pnpmExecutable, ["build"], {
    cwd: oldProject,
    label: `${fromRef} production build`,
  });
  if (!skipCurrentBuild) {
    await runCommand(pnpmExecutable, ["build"], {
      cwd: projectRoot,
      label: "current production build",
    });
  }

  const oldVersion = await parsePackageVersion(oldProject);
  const currentVersion = await parsePackageVersion(projectRoot);
  if (`V${oldVersion}` !== fromRef) {
    throw new Error(`${fromRef} 归档版本不一致：${oldVersion}`);
  }
  if (isVersionAtLeast(oldVersion, currentVersion)) {
    throw new Error(
      `${fromRef} 版本 ${oldVersion} 必须早于候选版本 ${currentVersion}`,
    );
  }

  const seeded = await startApi(oldProject, oldData, oldVersion);
  const initialActionSnapshot = await seedDurableMarker(seeded);
  const initialStopMode = await stopHistoricalApi(
    seeded,
    oldProject,
    oldData,
  );
  const stabilized = await startApi(oldProject, oldData, oldVersion);
  const seededSnapshot = await waitForDurableMarker(stabilized);
  assertMarkerContinuity(
    seededSnapshot,
    initialActionSnapshot,
    `${fromRef} stable restart`,
  );
  const oldStopMode = await stopHistoricalApi(
    stabilized,
    oldProject,
    oldData,
  );

  const backup = await dataCli(oldProject, [
    "backup",
    "--data-dir",
    oldData,
    "--backup-root",
    oldBackupRoot,
  ]);
  if (
    backup.status !== "verified"
    || backup.productVersion !== oldVersion
  ) {
    throw new Error("升级前备份没有通过旧版本验证");
  }
  await dataCli(projectRoot, [
    "verify",
    "--backup",
    backup.backupPath,
  ]);

  const checkpointRebaseline = await dataCli(projectRoot, [
    "prepare-upgrade-checkpoints",
    "--data-dir",
    oldData,
    "--backup",
    backup.backupPath,
  ]);
  if (
    checkpointRebaseline.status !== "prepared"
    || checkpointRebaseline.fromProductVersion !== oldVersion
    || checkpointRebaseline.toProductVersion !== currentVersion
    || checkpointRebaseline.backupManifestHash !== backup.manifestHash
    || checkpointRebaseline.checkpointFileCount < 1
  ) {
    throw new Error("旧检查点没有经过备份绑定的显式升级准备");
  }

  const upgraded = await startApi(
    projectRoot,
    oldData,
    currentVersion,
    seededSnapshot,
  );
  await stopApiGracefully(upgraded.child);

  await dataCli(projectRoot, [
    "restore",
    "--backup",
    backup.backupPath,
    "--target-data-dir",
    rollbackData,
  ]);
  const rolledBack = await startApi(
    oldProject,
    rollbackData,
    oldVersion,
    seededSnapshot,
  );
  const rollbackStopMode = await stopHistoricalApi(
    rolledBack,
    oldProject,
    rollbackData,
  );

  const receipt = {
    schema: "ronggang.upgrade-rollback-drill.v1",
    checkedAt: new Date().toISOString(),
    status: sourceClean && !skipCurrentBuild
      ? "verified"
      : "candidate_verified",
    candidateHead,
    candidateTree,
    sourceClean,
    lockfileSha256,
    currentBuildVerified: !skipCurrentBuild,
    from: {
      ref: fromRef,
      target: fromTarget,
      version: oldVersion,
      sessionIds: seeded.sessionIds,
      bindingCount: seeded.bindingCount,
      initialActionSnapshot,
      durableSnapshot: seededSnapshot,
      stopMode: oldStopMode,
      initialStopMode,
      baselineRule: isVersionAtLeast(oldVersion, "0.9.4")
        ? "graceful_stop_then_blocking_recovery_and_stable_snapshot"
        : "forced_crash_then_explicit_stale_lease_recovery_and_blocking_restart_stable_snapshot",
    },
    upgrade: {
      version: currentVersion,
      checkpointRebaseline: {
        mode: "verified_backup_exact_match_then_archive_old_projection_checkpoints",
        fromProductVersion: checkpointRebaseline.fromProductVersion,
        toProductVersion: checkpointRebaseline.toProductVersion,
        backupManifestHash: checkpointRebaseline.backupManifestHash,
        checkpointFileCount: checkpointRebaseline.checkpointFileCount,
      },
      sessionIds: upgraded.sessionIds,
      bindingCount: upgraded.bindingCount,
      durableSnapshot: upgraded.durableSnapshot,
      stopMode: "ipc_graceful_close",
    },
    rollback: {
      restoredFromProductVersion: backup.productVersion,
      manifestHash: backup.manifestHash,
      version: rolledBack.version,
      sessionIds: rolledBack.sessionIds,
      bindingCount: rolledBack.bindingCount,
      durableSnapshot: rolledBack.durableSnapshot,
      stopMode: rollbackStopMode,
      dataRule: "restore_pre_upgrade_backup_to_new_directory",
    },
    keptAt: keep ? root : null,
  };
  await mkdir(dirname(receiptPath), { recursive: true });
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
} catch (error) {
  primaryFailure = error;
  const failure = {
    schema: "ronggang.upgrade-rollback-drill.v1",
    checkedAt: new Date().toISOString(),
    status: "failed",
    fromRef,
    candidateHead,
    candidateTree,
    sourceClean,
    lockfileSha256,
    error: error instanceof Error ? error.message : String(error),
  };
  await mkdir(dirname(receiptPath), { recursive: true });
  await writeFile(receiptPath, `${JSON.stringify(failure, null, 2)}\n`, "utf8");
  throw error;
} finally {
  await Promise.allSettled(
    [...activeChildren].map((child) => terminateProcessTree(child)),
  );
  if (!keep) {
    if (worktreeRegistered) {
      try {
        await removeRegisteredWorktreeWithRetry(oldTree);
      } catch (error) {
        process.stderr.write(
          `worktree 目录将由受控临时根清理：${
            error instanceof Error ? error.message : String(error)
          }\n`,
        );
      }
      worktreeRegistered = false;
    }
    const resolvedTemp = tempParent;
    const resolvedRoot = resolve(root);
    if (
      resolvedRoot.startsWith(`${resolvedTemp}${sep}`)
      && basename(resolvedRoot).startsWith("ronggang-upgrade-drill-")
    ) {
      try {
        await rm(resolvedRoot, { recursive: true, force: true });
        await runCommand("git", ["worktree", "prune"], {
          cwd: repositoryRoot,
          label: "prune removed release-drill worktrees",
        });
      } catch (error) {
        if (!primaryFailure) throw error;
        process.stderr.write(
          `演练失败后的临时目录清理也失败：${
            error instanceof Error ? error.message : String(error)
          }\n`,
        );
      }
    }
  }
}
