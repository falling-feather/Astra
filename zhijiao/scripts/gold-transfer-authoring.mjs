import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import {
  dirname,
  relative,
  resolve,
} from "node:path";
import {
  fileURLToPath,
  pathToFileURL,
} from "node:url";
import {
  GoldTransferAuthoringRequiredSmokeCheckIds,
  GoldTransferAuthoringRunSchema,
  GoldTransferAuthoringRunSchemaVersion,
} from "../packages/contracts/dist/index.js";
import { hashValue } from "../packages/context-engine/dist/index.js";
import {
  hashScenarioPackage,
  inspectTransferScenario,
  validateScenarioPackage,
} from "../packages/scenario-catalog/dist/index.js";
import {
  createStaticScenarioRelease,
  transferScenarioV100,
  transferScenarioV100ContentHash,
} from "../packages/world-core/dist/index.js";

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), "..");
const repositoryRoot = projectRoot;
const projectRepositoryPath = ".";
const evidenceRoot = resolve(projectRoot, "artifacts", "gold-transfer-authoring");
const latestPointerPath = resolve(evidenceRoot, "latest.json");
const targetMaxMs = 8 * 60 * 60 * 1_000;
const forbiddenRuntimePaths = [
  "apps/web/src",
  "packages/agent-runtime/src",
  "packages/world-core/src/engine.ts",
  "packages/world-core/src/structured-world.ts",
];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function normalizedProjectPath(path) {
  const normalized = relative(projectRoot, path).replaceAll("\\", "/");
  if (
    normalized === ""
    || normalized === ".."
    || normalized.startsWith("../")
    || /^[A-Za-z]:[\\/]/u.test(normalized)
  ) {
    throw new Error(`路径必须位于原型项目内：${path}`);
  }
  return normalized;
}

function parseArguments(values) {
  const command = values[0] ?? "";
  const options = new Map();
  for (let index = 1; index < values.length; index += 1) {
    const token = values[index];
    if (token === "--") continue;
    if (!token?.startsWith("--")) {
      throw new Error(`无法识别的参数：${token ?? ""}`);
    }
    const value = values[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${token} 缺少值`);
    }
    const key = token.slice(2);
    options.set(key, [...(options.get(key) ?? []), value]);
    index += 1;
  }
  return { command, options };
}

function requiredOption(options, key) {
  const values = options.get(key) ?? [];
  if (values.length !== 1) throw new Error(`必须且只能提供一次 --${key}`);
  return values[0];
}

function optionalOption(options, key, fallback) {
  const values = options.get(key) ?? [];
  if (values.length > 1) throw new Error(`最多提供一次 --${key}`);
  return values[0] ?? fallback;
}

async function runProcess(command, args, options = {}) {
  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? projectRoot,
      env: process.env,
      shell: false,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", rejectPromise);
    child.once("close", (code, signal) => {
      resolvePromise({ code, signal, stdout, stderr });
    });
  });
}

async function git(args, acceptedCodes = [0]) {
  const result = await runProcess("git", ["-C", repositoryRoot, ...args], {
    cwd: repositoryRoot,
  });
  if (!acceptedCodes.includes(result.code)) {
    throw new Error(
      `git ${args.join(" ")} 失败：${result.stderr || result.stdout || result.signal || result.code}`,
    );
  }
  return result;
}

async function fileEvidence(relativePath) {
  const absolutePath = resolve(projectRoot, relativePath);
  if (normalizedProjectPath(absolutePath) !== relativePath.replaceAll("\\", "/")) {
    throw new Error(`创作文件必须使用规范项目相对路径：${relativePath}`);
  }
  const metadata = await stat(absolutePath);
  if (!metadata.isFile() || metadata.size <= 0) {
    throw new Error(`创作文件不存在或为空：${relativePath}`);
  }
  const bytes = await readFile(absolutePath);
  return {
    path: normalizedProjectPath(absolutePath),
    sha256: sha256(bytes),
    bytes: bytes.byteLength,
  };
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, json(value), "utf8");
  await rename(temporaryPath, path);
}

function unsignedRun(run) {
  const { runHash: _runHash, ...unsigned } = run;
  return unsigned;
}

function signRun(run) {
  const unsigned = unsignedRun(run);
  return GoldTransferAuthoringRunSchema.parse({
    ...unsigned,
    runHash: hashValue(unsigned),
  });
}

function verifyRunHash(run) {
  const expected = hashValue(unsignedRun(run));
  if (expected !== run.runHash) {
    throw new Error(`迁移运行哈希不一致：expected=${expected}, observed=${run.runHash}`);
  }
}

function verifyEventLogBytes(bytes) {
  const events = bytes
    .toString("utf8")
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  let previousEventHash = null;
  for (const [index, event] of events.entries()) {
    const { eventHash, ...unsigned } = event;
    if (
      event.schemaVersion !== "gold-transfer-authoring-event/1.0.0"
      || event.sequence !== index + 1
      || event.previousEventHash !== previousEventHash
      || typeof event.occurredAt !== "string"
      || !Number.isFinite(Date.parse(event.occurredAt))
      || hashValue(unsigned) !== eventHash
    ) {
      throw new Error(`迁移事件前向哈希链在第${index + 1}项不一致`);
    }
    previousEventHash = eventHash;
  }
  return events;
}

function runPaths(runId) {
  const runDirectory = resolve(evidenceRoot, runId);
  if (normalizedProjectPath(runDirectory) !== `artifacts/gold-transfer-authoring/${runId}`) {
    throw new Error("runId 不能逃逸迁移证据目录");
  }
  return {
    runDirectory,
    runPath: resolve(runDirectory, "run.json"),
    eventLogPath: resolve(runDirectory, "events.jsonl"),
  };
}

async function appendEvent(paths, input) {
  let previousEventHash = null;
  let sequence = 1;
  try {
    const events = verifyEventLogBytes(await readFile(paths.eventLogPath));
    const previous = events.at(-1);
    previousEventHash = previous?.eventHash ?? null;
    sequence = events.length + 1;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const unsigned = {
    schemaVersion: "gold-transfer-authoring-event/1.0.0",
    sequence,
    occurredAt: input.occurredAt,
    eventType: input.eventType,
    previousEventHash,
    payload: input.payload,
  };
  const event = {
    ...unsigned,
    eventHash: hashValue(unsigned),
  };
  await appendFile(paths.eventLogPath, `${JSON.stringify(event)}\n`, "utf8");
  const logBytes = await readFile(paths.eventLogPath);
  return {
    path: normalizedProjectPath(paths.eventLogPath),
    eventCount: sequence,
    sha256: sha256(logBytes),
  };
}

async function writeRunAndPointer(paths, run) {
  await writeJsonAtomic(paths.runPath, run);
  const events = verifyEventLogBytes(await readFile(paths.eventLogPath));
  const pointerUnsigned = {
    schemaVersion: "gold-transfer-authoring-pointer/1.0.0",
    runId: run.runId,
    runPath: normalizedProjectPath(paths.runPath),
    runHash: run.runHash,
    updatedAt:
      events.at(-1)?.occurredAt
      ?? run.timing.completedAt
      ?? run.timing.startedAt,
  };
  await writeJsonAtomic(latestPointerPath, {
    ...pointerUnsigned,
    pointerHash: hashValue(pointerUnsigned),
  });
}

async function loadRun(runId) {
  const paths = runPaths(runId);
  const run = GoldTransferAuthoringRunSchema.parse(
    JSON.parse(await readFile(paths.runPath, "utf8")),
  );
  verifyRunHash(run);
  if (run.runId !== runId) throw new Error("迁移运行标识与目录不一致");
  const eventLogBytes = await readFile(paths.eventLogPath);
  const eventCount = verifyEventLogBytes(eventLogBytes).length;
  if (
    run.eventLog.path !== normalizedProjectPath(paths.eventLogPath)
    || run.eventLog.sha256 !== sha256(eventLogBytes)
    || run.eventLog.eventCount !== eventCount
  ) {
    throw new Error("迁移运行记录与前向事件日志不一致");
  }
  return { paths, run };
}

async function assertTrackedSourceClean() {
  const result = await git(["status", "--short", "--untracked-files=no"]);
  if (result.stdout.trim() !== "") {
    throw new Error("开始前已跟踪源树必须干净；不得在目标配置产生后补建计时起点");
  }
}

async function repositoryTargetMatchCount(targetScenarioId) {
  const result = await git(
    ["grep", "-l", "-F", "--", targetScenarioId, "--", "."],
    [0, 1],
  );
  if (result.code === 1) return 0;
  return result.stdout.split(/\r?\n/u).filter(Boolean).length;
}

async function workspaceUntrackedTargetMatchCount(targetScenarioId) {
  const result = await git([
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
    "--",
    projectRepositoryPath,
  ]);
  let matchCount = 0;
  for (const repositoryPath of result.stdout.split("\0").filter(Boolean)) {
    const absolutePath = resolve(repositoryRoot, repositoryPath);
    normalizedProjectPath(absolutePath);
    let containsTarget = repositoryPath.includes(targetScenarioId);
    if (!containsTarget) {
      const bytes = await readFile(absolutePath);
      containsTarget = bytes.includes(Buffer.from(targetScenarioId, "utf8"));
    }
    if (containsTarget) matchCount += 1;
  }
  return matchCount;
}

async function catalogTargetAbsence(targetScenarioId) {
  const configuredDataPath = process.env.RONGGANG_DATA_DIR
    ? resolve(projectRoot, process.env.RONGGANG_DATA_DIR)
    : null;
  const candidates = [
    {
      path: resolve(projectRoot, ".data", "scenario-catalog.jsonl"),
      source: ".data/scenario-catalog.jsonl",
    },
    ...(configuredDataPath
      ? [{
        path: resolve(configuredDataPath, "scenario-catalog.jsonl"),
        source: "env:RONGGANG_DATA_DIR/scenario-catalog.jsonl",
      }]
      : []),
  ];
  const uniqueCandidates = [
    ...new Map(candidates.map((candidate) => [candidate.path, candidate]))
      .values(),
  ];
  let matchCount = 0;
  const sources = [];
  for (const candidate of uniqueCandidates) {
    let text = "";
    try {
      text = await readFile(candidate.path, "utf8");
      sources.push(candidate.source);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      sources.push(`${candidate.source} (missing)`);
    }
    matchCount += text.split(targetScenarioId).length - 1;
  }
  return { matchCount, sources };
}

async function collectTextFiles(path) {
  const metadata = await stat(path);
  if (metadata.isFile()) return [path];
  const files = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectTextFiles(child));
    } else if (entry.isFile()) {
      files.push(child);
    }
  }
  return files;
}

async function scanForbiddenRuntime(markers) {
  const matches = [];
  for (const configuredPath of forbiddenRuntimePaths) {
    const absolutePath = resolve(projectRoot, configuredPath);
    for (const file of await collectTextFiles(absolutePath)) {
      const text = await readFile(file, "utf8");
      for (const marker of markers) {
        if (text.includes(marker)) {
          matches.push({
            path: normalizedProjectPath(file),
            marker,
          });
        }
      }
    }
  }
  return {
    status: matches.length === 0 ? "passed" : "failed",
    scannedPaths: forbiddenRuntimePaths,
    topicMarkers: markers,
    matches,
  };
}

function templateBinding() {
  const observedHash = hashScenarioPackage(transferScenarioV100);
  if (observedHash !== transferScenarioV100ContentHash) {
    throw new Error("冻结迁移模板内容哈希不一致，拒绝建立计时起点");
  }
  return {
    scenarioId: transferScenarioV100.scenarioId,
    version: transferScenarioV100.version,
    releaseRef:
      `release-${transferScenarioV100.scenarioId}-${transferScenarioV100.version}-baseline`,
    contentHash: transferScenarioV100ContentHash,
    schemaVersion: transferScenarioV100.schemaVersion,
  };
}

async function start(options) {
  const runId = requiredOption(options, "run-id");
  const targetScenarioId = requiredOption(options, "target-scenario");
  const authorRole = optionalOption(
    options,
    "author-role",
    "content_author_assisted",
  );
  if (!["content_author", "content_author_assisted"].includes(authorRole)) {
    throw new Error("--author-role 只能是 content_author 或 content_author_assisted");
  }
  if (!/^[a-z0-9][a-z0-9._-]{2,119}$/u.test(runId)) {
    throw new Error("--run-id 必须为3—120位小写字母、数字、点、下划线或连字符");
  }
  if (
    targetScenarioId.length < 1
    || targetScenarioId.length > 160
    || targetScenarioId === transferScenarioV100.scenarioId
  ) {
    throw new Error("--target-scenario 必须是基线模板之外的全新情境标识");
  }
  await assertTrackedSourceClean();
  const sourceGitCommit = (await git(["rev-parse", "HEAD"])).stdout.trim();
  const repositoryMatchCount = await repositoryTargetMatchCount(targetScenarioId);
  const workspaceUntrackedMatchCount =
    await workspaceUntrackedTargetMatchCount(targetScenarioId);
  const catalogAbsence = await catalogTargetAbsence(targetScenarioId);
  if (
    repositoryMatchCount !== 0
    || workspaceUntrackedMatchCount !== 0
    || catalogAbsence.matchCount !== 0
  ) {
    throw new Error(
      `目标情境必须在计时基线中不存在：repository=${repositoryMatchCount}, untracked=${workspaceUntrackedMatchCount}, catalog=${catalogAbsence.matchCount}`,
    );
  }
  const paths = runPaths(runId);
  try {
    await stat(paths.runDirectory);
    throw new Error(`迁移运行目录已经存在：${normalizedProjectPath(paths.runDirectory)}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await mkdir(evidenceRoot, { recursive: true });
  await mkdir(paths.runDirectory, { recursive: false });
  const startedAt = new Date().toISOString();
  const baseline = {
    sourceGitCommit,
    sourceTreeState: "clean",
    collectorSha256: sha256(await readFile(scriptPath)),
    templateBinding: templateBinding(),
    targetAbsence: {
      repositoryMatchCount: 0,
      workspaceUntrackedMatchCount: 0,
      catalogMatchCount: 0,
      catalogSourcesScanned: catalogAbsence.sources,
    },
  };
  const eventLog = await appendEvent(paths, {
    occurredAt: startedAt,
    eventType: "authoring_started",
    payload: {
      sourceGitCommit,
      targetScenarioId,
      templateContentHash: baseline.templateBinding.contentHash,
      repositoryMatchCount,
      workspaceUntrackedMatchCount,
      catalogMatchCount: catalogAbsence.matchCount,
    },
  });
  const run = signRun({
    schemaVersion: GoldTransferAuthoringRunSchemaVersion,
    runId,
    status: "started",
    targetScenarioId,
    operator: {
      authorRole,
      witnessRole: "qa",
    },
    baseline,
    timing: {
      startedAt,
      completedAt: null,
      elapsedMs: null,
      targetMaxMs,
    },
    eventLog,
    modifiedFiles: [],
    validationAttempts: [],
    reuse: null,
    structure: null,
    forbiddenRuntimeScan: null,
    targetRelease: null,
    runtimeSmoke: null,
    claimBoundary:
      "该起点只证明目标情境在干净基线与本地目录中不存在；结束前不得预填工时、发布或运行结果。",
  });
  await writeRunAndPointer(paths, run);
  process.stdout.write(json({
    runId,
    status: run.status,
    targetScenarioId,
    sourceGitCommit,
    startedAt,
    runPath: normalizedProjectPath(paths.runPath),
    runHash: run.runHash,
  }));
}

async function loadTargetExport(exportName) {
  const worldCore = await import("../packages/world-core/dist/index.js");
  const target = worldCore[exportName];
  if (!target || typeof target !== "object") {
    throw new Error(`world-core未导出目标情境：${exportName}`);
  }
  return target;
}

async function collectRuntimeSmoke(relativeModulePath, input) {
  const modulePath = resolve(projectRoot, relativeModulePath);
  normalizedProjectPath(modulePath);
  const module = await import(`${pathToFileURL(modulePath).href}?t=${Date.now()}`);
  if (typeof module.runTransferAuthoringSmoke !== "function") {
    throw new Error("运行烟测模块必须导出 runTransferAuthoringSmoke");
  }
  const observed = await module.runTransferAuthoringSmoke(input);
  const sessionId =
    typeof observed?.sessionId === "string" && observed.sessionId.trim() !== ""
      ? observed.sessionId
      : null;
  const checkIds = Array.isArray(observed?.checkIds)
    ? [...new Set(observed.checkIds.map(String).filter(Boolean))]
    : ["runtime_smoke_module_contract"];
  const eventCount = Number.isInteger(observed?.eventCount)
    && observed.eventCount >= 0
    ? observed.eventCount
    : 0;
  const missingCheckIds = GoldTransferAuthoringRequiredSmokeCheckIds.filter(
    (checkId) => !checkIds.includes(checkId),
  );
  const passed = (
    observed?.status === "passed"
    && sessionId !== null
    && eventCount > 0
    && missingCheckIds.length === 0
  );
  const unsigned = {
    status: passed ? "passed" : "failed",
    sessionId,
    checkIds: checkIds.length > 0
      ? checkIds
      : ["runtime_smoke_module_contract"],
    eventCount,
    claimBoundary:
      typeof observed?.claimBoundary === "string"
        && observed.claimBoundary.trim() !== ""
        ? observed.claimBoundary
        : missingCheckIds.length > 0
          ? `运行烟测缺少强制检查项：${missingCheckIds.join(",")}，按失败保留。`
          : "运行烟测模块没有返回完整边界，按失败保留。",
  };
  return {
    ...unsigned,
    receiptHash: hashValue(unsigned),
  };
}

async function recordOpenAttempt(paths, run, input) {
  const eventLog = await appendEvent(paths, {
    occurredAt: input.occurredAt,
    eventType: input.eventType,
    payload: input.payload,
  });
  const elapsedMs =
    Date.parse(input.occurredAt) - Date.parse(run.timing.startedAt);
  const timedOut = elapsedMs > run.timing.targetMaxMs;
  const updated = signRun({
    ...run,
    status: timedOut ? "failed" : "started",
    timing: timedOut
      ? {
        ...run.timing,
        completedAt: input.occurredAt,
        elapsedMs,
      }
      : run.timing,
    eventLog,
    validationAttempts:
      input.validationAttempts ?? run.validationAttempts,
    claimBoundary: timedOut
      ? "前瞻迁移连续计时已经超过八小时，失败尝试与超时均原样保留；不得重开同一目标补造通过工时。"
      : input.claimBoundary,
  });
  await writeRunAndPointer(paths, updated);
  return updated;
}

async function finish(options) {
  const runId = requiredOption(options, "run-id");
  const targetExport = requiredOption(options, "target-export");
  const releaseId = requiredOption(options, "release-id");
  const smokeModule = requiredOption(options, "smoke-module");
  const modifiedFilePaths = options.get("modified-file") ?? [];
  if (modifiedFilePaths.length === 0) {
    throw new Error("结束迁移计时必须至少提供一个 --modified-file");
  }
  const { paths, run } = await loadRun(runId);
  if (run.status !== "started") {
    throw new Error(`迁移运行已经结束：${run.status}`);
  }
  const currentHead = (await git(["rev-parse", "HEAD"])).stdout.trim();
  if (currentHead !== run.baseline.sourceGitCommit) {
    throw new Error("计时期间不得切换或提交基线；请以新runId重新开始");
  }
  if (sha256(await readFile(scriptPath)) !== run.baseline.collectorSha256) {
    throw new Error("计时期间迁移采集器发生变化；请以新runId重新开始");
  }

  const attemptedAt = new Date().toISOString();
  let target;
  try {
    target = await loadTargetExport(targetExport);
  } catch (error) {
    await recordOpenAttempt(paths, run, {
      occurredAt: attemptedAt,
      eventType: "target_import_failed",
      payload: {
        targetExport,
        error: error instanceof Error ? error.message : String(error),
      },
      claimBoundary:
        "目标情境尚未形成可导入配置；失败尝试已经保留，连续计时仍在进行。",
    });
    throw error;
  }
  if (target.scenarioId !== run.targetScenarioId) {
    const error = new Error(
      `目标导出情境标识不一致：expected=${run.targetScenarioId}, observed=${target.scenarioId}`,
    );
    await recordOpenAttempt(paths, run, {
      occurredAt: attemptedAt,
      eventType: "target_binding_failed",
      payload: {
        targetExport,
        expectedScenarioId: run.targetScenarioId,
        observedScenarioId: String(target.scenarioId ?? ""),
      },
      claimBoundary:
        "目标导出与计时起点标识不一致；失败尝试已经保留，连续计时仍在进行。",
    });
    throw error;
  }

  const validation = validateScenarioPackage(target, {
    draftId: `forward-transfer-${runId}`,
    revision: run.validationAttempts.length + 1,
    validatedAt: attemptedAt,
  });
  const validationAttempt = {
    attemptedAt,
    valid: validation.valid,
    issueCount: validation.issues.length,
    issueCodes: validation.issues.map((issue) => issue.code),
    definitionHash: validation.definitionHash,
    validationStamp: validation.validationStamp,
  };
  const validationAttempts = [...run.validationAttempts, validationAttempt];
  const activeRun = await recordOpenAttempt(paths, run, {
    occurredAt: attemptedAt,
    eventType: validation.valid ? "validation_passed" : "validation_failed",
    payload: {
      attempt: validationAttempts.length,
      valid: validationAttempt.valid,
      issueCodes: validationAttempt.issueCodes,
      definitionHash: validationAttempt.definitionHash,
      validationStamp: validationAttempt.validationStamp,
    },
    validationAttempts,
    claimBoundary: validation.valid
      ? "目标配置已通过本轮校验；连续计时继续覆盖结构门、禁区扫描、不可变发布和运行烟测。"
      : "目标配置校验失败；全部问题码已保留且连续计时没有暂停，修订后可再次执行finish。",
  });
  if (!validation.valid || activeRun.status === "failed") {
    process.stdout.write(json({
      runId,
      status: activeRun.status,
      validation: validationAttempt,
      runHash: activeRun.runHash,
    }));
    process.exitCode = 2;
    return;
  }

  let inspection;
  let forbiddenRuntimeScan;
  let modifiedFiles;
  let release;
  let targetRelease;
  let runtimeSmoke;
  try {
    inspection = inspectTransferScenario({
      template: transferScenarioV100,
      target,
    });
    forbiddenRuntimeScan = await scanForbiddenRuntime([
      target.scenarioId,
      target.title,
    ]);
    modifiedFiles = await Promise.all(
      modifiedFilePaths.map(fileEvidence),
    );
    release = createStaticScenarioRelease({
      releaseId,
      package: target,
      publishedAt: attemptedAt,
    });
    targetRelease = {
      scenarioId: release.ref.scenarioId,
      version: release.ref.version,
      releaseRef: release.ref.releaseId,
      contentHash: release.ref.contentHash,
      schemaVersion: release.ref.schemaVersion,
    };
    try {
      runtimeSmoke = await collectRuntimeSmoke(smokeModule, {
        scenario: target,
        release,
        runId,
      });
    } catch (error) {
      const unsigned = {
        status: "failed",
        sessionId: null,
        checkIds: ["runtime_smoke_exception"],
        eventCount: 0,
        claimBoundary:
          `运行烟测异常：${error instanceof Error ? error.message : String(error)}`,
      };
      runtimeSmoke = {
        ...unsigned,
        receiptHash: hashValue(unsigned),
      };
    }
  } catch (error) {
    const failedAt = new Date().toISOString();
    await recordOpenAttempt(paths, activeRun, {
      occurredAt: failedAt,
      eventType: "finish_attempt_error",
      payload: {
        error: error instanceof Error ? error.message : String(error),
      },
      claimBoundary:
        "校验后的结构检查、文件固化、不可变发布或烟测准备失败；失败已进入前向日志，连续计时仍在进行。",
    });
    throw error;
  }
  const completedAt = new Date().toISOString();
  const elapsedMs = Date.parse(completedAt) - Date.parse(run.timing.startedAt);
  const allGatesPassed = (
    elapsedMs > 0
    && inspection.structure.status === "passed"
    && forbiddenRuntimeScan.status === "passed"
    && runtimeSmoke.status === "passed"
    && validation.definitionHash === release.ref.contentHash
    && targetRelease.releaseRef
      !== activeRun.baseline.templateBinding.releaseRef
  );
  if (!allGatesPassed && elapsedMs <= run.timing.targetMaxMs) {
    const updated = await recordOpenAttempt(paths, activeRun, {
      occurredAt: completedAt,
      eventType: "finish_gates_failed",
      payload: {
        elapsedMs,
        targetRelease,
        validationAttemptCount: validationAttempts.length,
        structureStatus: inspection.structure.status,
        forbiddenRuntimeStatus: forbiddenRuntimeScan.status,
        runtimeSmoke,
        definitionMatchesRelease:
          validation.definitionHash === release.ref.contentHash,
        releaseRefDistinct:
          targetRelease.releaseRef
          !== activeRun.baseline.templateBinding.releaseRef,
      },
      claimBoundary:
        "结构、禁区、不可变发布哈希或运行烟测尚未全部通过；失败收据已保留，修订后可在同一连续时钟内再次执行finish。",
    });
    process.stdout.write(json({
      runId,
      status: updated.status,
      elapsedMs,
      structure: inspection.structure,
      forbiddenRuntimeScan,
      runtimeSmoke,
      runHash: updated.runHash,
    }));
    process.exitCode = 2;
    return;
  }
  const status = allGatesPassed
    && elapsedMs <= run.timing.targetMaxMs
    ? "passed"
    : "failed";
  const eventLog = await appendEvent(paths, {
    occurredAt: completedAt,
    eventType: status === "passed"
      ? "authoring_completed"
      : "authoring_failed",
    payload: {
      elapsedMs,
      targetRelease,
      validationAttemptCount: validationAttempts.length,
      structureStatus: inspection.structure.status,
      forbiddenRuntimeStatus: forbiddenRuntimeScan.status,
      runtimeSmokeStatus: runtimeSmoke.status,
    },
  });
  const completed = signRun({
    ...activeRun,
    status,
    timing: {
      ...run.timing,
      completedAt,
      elapsedMs,
    },
    eventLog,
    modifiedFiles,
    validationAttempts,
    reuse: inspection.reuse,
    structure: inspection.structure,
    forbiddenRuntimeScan,
    targetRelease,
    runtimeSmoke,
    claimBoundary: status === "passed"
      ? "该前瞻证据只证明新微型情境从冻结模板起点到首次校验、不可变发布和技术烟测的连续配置迁移工时；不回填旧雨天情境工时，不代表真实教师评价效度、学生成效或生产SLA。"
      : "前瞻迁移连续工时已经超过八小时，完整失败证据原样保留；不得重开同一目标补造通过工时。",
  });
  await writeRunAndPointer(paths, completed);
  process.stdout.write(json({
    runId,
    status: completed.status,
    elapsedMs,
    observedMinutes: elapsedMs / 60_000,
    targetRelease,
    structure: completed.structure,
    runtimeSmoke: completed.runtimeSmoke,
    runPath: normalizedProjectPath(paths.runPath),
    runHash: completed.runHash,
  }));
  if (completed.status !== "passed") process.exitCode = 2;
}

async function verify(options) {
  const runId = requiredOption(options, "run-id");
  const { paths, run } = await loadRun(runId);
  const eventBytes = await readFile(paths.eventLogPath);
  const eventCount = verifyEventLogBytes(eventBytes).length;
  if (
    sha256(eventBytes) !== run.eventLog.sha256
    || eventCount !== run.eventLog.eventCount
  ) {
    throw new Error("迁移事件日志字节哈希或事件数量不一致");
  }
  if (sha256(await readFile(scriptPath)) !== run.baseline.collectorSha256) {
    throw new Error("迁移采集器哈希与起点不一致");
  }
  if (run.runtimeSmoke !== null) {
    const { receiptHash, ...receiptUnsigned } = run.runtimeSmoke;
    if (hashValue(receiptUnsigned) !== receiptHash) {
      throw new Error("迁移运行烟测收据哈希不一致");
    }
  }
  for (const file of run.modifiedFiles) {
    const observed = await fileEvidence(file.path);
    if (observed.sha256 !== file.sha256 || observed.bytes !== file.bytes) {
      throw new Error(`迁移创作文件已经漂移：${file.path}`);
    }
  }
  const pointer = JSON.parse(await readFile(latestPointerPath, "utf8"));
  const { pointerHash, ...pointerUnsigned } = pointer;
  if (
    hashValue(pointerUnsigned) !== pointerHash
    || pointer.runId !== run.runId
    || pointer.runHash !== run.runHash
  ) {
    throw new Error("迁移最新指针与运行记录不一致");
  }
  process.stdout.write(json({
    runId,
    status: run.status,
    runHash: run.runHash,
    eventCount,
    modifiedFileCount: run.modifiedFiles.length,
    validationAttemptCount: run.validationAttempts.length,
    targetRelease: run.targetRelease,
  }));
  if (run.status !== "passed") process.exitCode = 2;
}

const { command, options } = parseArguments(process.argv.slice(2));
try {
  if (command === "start") {
    await start(options);
  } else if (command === "finish") {
    await finish(options);
  } else if (command === "verify") {
    await verify(options);
  } else if (command === "validate-imports") {
    process.stdout.write(json({
      status: "passed",
      schemaVersion: GoldTransferAuthoringRunSchemaVersion,
      templateBinding: templateBinding(),
    }));
  } else {
    throw new Error(
      "用法：gold-transfer-authoring.mjs <start|finish|verify|validate-imports> --run-id <id> ...",
    );
  }
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
