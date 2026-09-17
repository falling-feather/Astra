import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  dirname,
  relative,
  resolve,
} from "node:path";
import {
  GoldEvidenceAssessmentSchema,
  GoldEvidenceValidationReceiptSchema,
  GoldTechnicalEvidenceManifestSchema,
  GoldTechnicalPerformanceSummarySchema,
  GoldTransferAuthoringRunSchema,
  GoldTransferConfigurationProofSchema,
} from "../packages/contracts/dist/index.js";
import { ProductVersion } from "../packages/contracts/dist/version.js";
import {
  createGoldAblationProtocol,
  createGoldControlledAblationProtocol,
  createGoldControlledAblationPreregistration,
  createGoldTechnicalEvidencePlan,
  runGoldContractReplay,
  runGoldControlledAblation,
} from "../packages/agent-runtime/dist/index.js";
import { hashValue } from "../packages/context-engine/dist/index.js";
import { OpenAiCompatibleModelProvider } from "../packages/model-gateway/dist/index.js";
import { validateScenarioPackage } from "../packages/scenario-catalog/dist/index.js";
import {
  flagshipScenarioV111,
  flagshipScenarioV111ContentHash,
  heritageNightTourScenarioV100,
  heritageNightTourScenarioV100ContentHash,
} from "../packages/world-core/dist/index.js";

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), "..");
const repositoryRoot = projectRoot;
const argumentsList = process.argv.slice(2);
const live = argumentsList.includes("--live");
const fullValidation = argumentsList.includes("--full");
const outputIndex = argumentsList.indexOf("--output");
const outputArgument = outputIndex >= 0
  ? argumentsList[outputIndex + 1]
  : "artifacts/gold-readiness";
if (!outputArgument) throw new Error("--output 缺少目录");

const outputRoot = resolve(projectRoot, outputArgument);
const outputRelative = relative(projectRoot, outputRoot).replaceAll("\\", "/");
if (
  outputRelative === ""
  || outputRelative === ".."
  || outputRelative.startsWith("../")
  || /^[A-Za-z]:[\\/]/u.test(outputRelative)
) {
  throw new Error("证据目录必须位于原型项目内且不能是项目根目录");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function percentile(values, ratio) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * ratio) - 1);
  return sorted[index] ?? null;
}

function statusSummary(statuses) {
  return {
    passed: statuses.filter((status) => status === "passed").length,
    failed: statuses.filter((status) => status === "failed").length,
    insufficient:
      statuses.filter((status) => status === "insufficient").length,
  };
}

function combinedStatus(statuses) {
  if (statuses.includes("failed")) return "failed";
  if (statuses.includes("insufficient")) return "insufficient";
  return "passed";
}

function normalizedPath(path) {
  return relative(projectRoot, path).replaceAll("\\", "/");
}

function verifyTransferEventLogBytes(bytes) {
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
      throw new Error(`前瞻迁移事件前向哈希链在第${index + 1}项不一致`);
    }
    previousEventHash = eventHash;
  }
  return events;
}

function releaseRef(scenario) {
  return `release-${scenario.scenarioId}-${scenario.version}-baseline`;
}

async function runProcess(command, args, options = {}) {
  const startedAt = new Date().toISOString();
  const startedMs = performance.now();
  let child;
  try {
    child = spawn(command, args, {
      cwd: projectRoot,
      env: {
        ...process.env,
        ...options.environment,
      },
      shell: false,
      windowsHide: true,
    });
  } catch (error) {
    const stderrText = error instanceof Error
      ? `${error.name}: ${error.message}`
      : String(error);
    return {
      startedAt,
      durationMs: Math.max(0, performance.now() - startedMs),
      code: null,
      signal: null,
      stdoutBuffer: Buffer.alloc(0),
      stdout: "",
      stderr: stderrText,
      outputHash: sha256(`\n---stderr---\n${stderrText}`),
    };
  }
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
  child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
  const result = await new Promise((resolveResult) => {
    child.once("error", (error) => resolveResult({
      code: null,
      signal: null,
      error,
    }));
    child.once("close", (code, signal) => resolveResult({ code, signal }));
  });
  const stdoutBuffer = Buffer.concat(stdout);
  const stdoutText = stdoutBuffer.toString("utf8");
  const processError = result.error instanceof Error
    ? `${result.error.name}: ${result.error.message}`
    : "";
  const stderrText = [
    Buffer.concat(stderr).toString("utf8"),
    processError,
  ].filter(Boolean).join("\n");
  return {
    startedAt,
    durationMs: Math.max(0, performance.now() - startedMs),
    code: result.code,
    signal: result.signal,
    stdoutBuffer,
    stdout: stdoutText,
    stderr: stderrText,
    outputHash: sha256(`${stdoutText}\n---stderr---\n${stderrText}`),
  };
}

function packageManagerInvocation(args) {
  const entrypoint = process.env.npm_execpath;
  if (entrypoint) {
    return {
      command: process.execPath,
      args: [entrypoint, ...args],
    };
  }
  return {
    command: process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    args,
  };
}

async function git(args) {
  const result = await runProcess("git", args);
  if (result.code !== 0) {
    throw new Error(`git ${args.join(" ")} 执行失败`);
  }
  return result.stdout.trim();
}

async function gitBytes(args) {
  const result = await runProcess("git", args);
  if (result.code !== 0) {
    throw new Error(`git ${args.join(" ")} 执行失败`);
  }
  return result.stdoutBuffer;
}

function repositoryPath(absolutePath) {
  const normalized = relative(repositoryRoot, absolutePath).replaceAll("\\", "/");
  if (
    normalized === ""
    || normalized === ".."
    || normalized.startsWith("../")
    || /^[A-Za-z]:[\\/]/u.test(normalized)
  ) {
    throw new Error(`证据路径越出Git仓库：${absolutePath}`);
  }
  return normalized;
}

async function assertTrackedSourceClean() {
  const trackedStatus = await git([
    "status",
    "--porcelain",
    "--untracked-files=no",
  ]);
  if (trackedStatus) {
    throw new Error(
      "国金证据必须从无已跟踪改动的提交生成；请先完成代码与文档提交",
    );
  }
}

function validationReceipt(input) {
  return GoldEvidenceValidationReceiptSchema.parse({
    receiptId: input.receiptId,
    command: input.command,
    scope: input.scope,
    status: input.status,
    startedAt: input.startedAt,
    durationMs: input.durationMs,
    resultSummary: input.resultSummary,
    outputHash: input.outputHash,
  });
}

async function commandReceipt(input) {
  const result = await runProcess(input.command, input.args, {
    environment: input.environment,
  });
  return {
    receipt: validationReceipt({
      receiptId: input.receiptId,
      command: input.displayCommand,
      scope: input.scope,
      status: result.code === 0 ? "passed" : "failed",
      startedAt: result.startedAt,
      durationMs: result.durationMs,
      resultSummary: result.code === 0
        ? input.passedSummary
        : `${input.failedSummary}；退出码=${String(result.code)}；信号=${result.signal ?? "none"}`,
      outputHash: result.outputHash,
    }),
    result,
  };
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

async function scanForbiddenRuntime(plan) {
  const markers = [
    heritageNightTourScenarioV100.scenarioId,
    heritageNightTourScenarioV100.title,
  ];
  const matches = [];
  for (const configuredPath of plan.transferTarget
    .forbiddenTopicSpecificRuntimePaths) {
    const absolutePath = resolve(projectRoot, configuredPath);
    for (const file of await collectTextFiles(absolutePath)) {
      const text = await readFile(file, "utf8");
      for (const marker of markers) {
        if (text.includes(marker)) {
          matches.push({
            path: normalizedPath(file),
            marker,
          });
        }
      }
    }
  }
  return { markers, matches };
}

function makeEvidence(kind, ref, observed) {
  return { kind, ref, observed };
}

function assessmentStatus(evidence, failed) {
  if (failed) return "failed";
  return evidence.every((item) => item.observed)
    ? "passed"
    : "insufficient";
}

function createEvidenceAssessment(input) {
  const receiptById = new Map(
    input.validationReceipts.map((receipt) => [receipt.receiptId, receipt]),
  );
  const passed = (receiptId) =>
    receiptById.get(receiptId)?.status === "passed";
  const failed = (receiptId) =>
    receiptById.get(receiptId)?.status === "failed";
  const browserPassed = passed("browser-golden-path");
  const browserFailed = failed("browser-golden-path");
  const runtimePassed = passed("agent-runtime-tests");
  const runtimeFailed = failed("agent-runtime-tests");
  const worldPassed = passed("world-core-tests");
  const worldFailed = failed("world-core-tests");
  const scenarioPassed = passed("scenario-package-validation");
  const scenarioFailed = failed("scenario-package-validation");
  const contractPassed = passed("ablation-contract-replay");
  const contractFailed = failed("ablation-contract-replay");

  const technicalDefinitions = [
    {
      gateId: "dual_dimension_continuity",
      receiptFailed: browserFailed,
      evidence: [
        makeEvidence("automated_test", "e2e/ronggang-full-loop.spec.ts::双维度共用同一投影", browserPassed),
        makeEvidence("timeline", "e2e/ronggang-full-loop.spec.ts::同一世界时间线", browserPassed),
        makeEvidence("visible_ui", "e2e/chromium::学生课程操作与世界互动", browserPassed),
      ],
    },
    {
      gateId: "single_world_authority",
      receiptFailed: worldFailed || scenarioFailed,
      evidence: [
        makeEvidence("automated_test", "packages/world-core/test::权威世界写入门", worldPassed),
        makeEvidence("runtime_trace", "packages/world-core/test::事件溯源投影", worldPassed),
        makeEvidence("version_hash", "scenario-package-validation::旗舰与迁移哈希", scenarioPassed),
      ],
    },
    {
      gateId: "agent_traceability",
      receiptFailed: runtimeFailed || browserFailed,
      evidence: [
        makeEvidence("automated_test", "packages/agent-runtime/test::模板实例任务追踪", runtimePassed),
        makeEvidence("runtime_trace", "e2e/ronggang-full-loop.spec.ts::教师智能体运行轨迹", browserPassed),
      ],
    },
    {
      gateId: "affected_set_scheduling",
      receiptFailed: runtimeFailed || contractFailed,
      evidence: [
        makeEvidence("automated_test", "packages/agent-runtime/test::受影响集合调度", runtimePassed),
        makeEvidence("runtime_trace", "ablation/contract-report.json::C组调度贡献", contractPassed),
      ],
    },
    {
      gateId: "private_view_isolation",
      receiptFailed: runtimeFailed || browserFailed,
      evidence: [
        makeEvidence("automated_test", "packages/agent-runtime/test::岗位私有视野", runtimePassed),
        makeEvidence("runtime_trace", "e2e/ronggang-full-loop.spec.ts::私有NPC互动", browserPassed),
      ],
    },
    {
      gateId: "vocational_consequence",
      receiptFailed: browserFailed,
      evidence: [
        makeEvidence("automated_test", "e2e/ronggang-full-loop.spec.ts::暴雨与发布后果", browserPassed),
        makeEvidence("timeline", "e2e/ronggang-full-loop.spec.ts::世界状态回写", browserPassed),
        makeEvidence("visible_ui", "e2e/chromium::任务优先级与发布门变化", browserPassed),
      ],
    },
    {
      gateId: "evidence_teacher_review",
      receiptFailed: browserFailed,
      evidence: [
        makeEvidence("automated_test", "e2e/ronggang-full-loop.spec.ts::四路评价与教师终评", browserPassed),
        makeEvidence("runtime_trace", "e2e/ronggang-full-loop.spec.ts::固定评价案件", browserPassed),
        makeEvidence("visible_ui", "e2e/chromium::教师逐维复核", browserPassed),
      ],
    },
    {
      gateId: "explicit_failure_recovery",
      receiptFailed: runtimeFailed || browserFailed,
      evidence: [
        makeEvidence("automated_test", "packages/agent-runtime/test::失败样本与空值保留", runtimePassed),
        makeEvidence("runtime_trace", "e2e/ronggang-full-loop.spec.ts::失败降级与重试入口", browserPassed),
      ],
    },
    {
      gateId: "immutable_compatibility",
      receiptFailed: scenarioFailed || worldFailed,
      evidence: [
        makeEvidence("version_hash", "scenario-package-validation::固定发布哈希", scenarioPassed),
        makeEvidence("automated_test", "packages/world-core/test::旧版恢复回归", worldPassed),
      ],
    },
    {
      gateId: "no_image_model_dependency",
      receiptFailed: browserFailed,
      evidence: [
        makeEvidence("visible_ui", "e2e/chromium::CSS场景与结构化卡片全流程", browserPassed),
        makeEvidence("static_source", "apps/web/src::无图像模型依赖的世界舞台", true),
      ],
    },
  ];
  const technicalGates = input.plan.technicalGates.map((gate) => {
    const definition = technicalDefinitions.find(
      (candidate) => candidate.gateId === gate.gateId,
    );
    if (!definition) throw new Error(`缺少技术门证据映射：${gate.gateId}`);
    const status = assessmentStatus(
      definition.evidence,
      definition.receiptFailed,
    );
    return {
      gateId: gate.gateId,
      label: gate.label,
      status,
      evidence: definition.evidence,
      rationale: status === "passed"
        ? "所需自动化、运行或界面证据均已由本次版本化验证收据确认。"
        : status === "failed"
          ? "至少一项必需验证失败，失败收据已保留，不能关闭该门。"
          : "必需证据尚未全部观测，保持证据不足，不以源码存在替代运行证明。",
    };
  });

  const causalClaims = input.plan.crossSurfaceCausality.map((causal) => {
    const evidence = [
      makeEvidence(
        "automated_test",
        `e2e/ronggang-full-loop.spec.ts::${causal.causalId}`,
        browserPassed,
      ),
      makeEvidence(
        "timeline",
        `e2e/session-timeline::${causal.causalId}`,
        browserPassed,
      ),
      makeEvidence(
        "visible_ui",
        `e2e/chromium-visible-ui::${causal.causalId}`,
        browserPassed,
      ),
    ];
    const status = assessmentStatus(evidence, browserFailed);
    return {
      causalId: causal.causalId,
      label: causal.label,
      status,
      evidence,
      rationale: status === "passed"
        ? "同一 Chromium 黄金路径同时断言自动化结果、事件时间线与可见界面变化。"
        : status === "failed"
          ? "黄金路径浏览器验证失败，因果主张保持失败并引用原始收据哈希。"
          : "尚未执行完整浏览器黄金路径，三类证据未同时形成。",
    };
  });
  const unsigned = {
    schemaVersion: input.plan.schemaVersion,
    generatedAt: input.generatedAt,
    technicalGates,
    causalClaims,
  };
  return GoldEvidenceAssessmentSchema.parse({
    ...unsigned,
    assessmentHash: hashValue(unsigned),
  });
}

function createGoldenDemoMarkdown(plan, sourceGitCommit) {
  const lines = [
    "# 国金双维度黄金演示脚本",
    "",
    `- 目标时长：${plan.goldenDemo.targetDurationMinutes} 分钟`,
    `- 源代码提交：\`${sourceGitCommit}\``,
    `- 技术计划哈希：\`${plan.planHash}\``,
    "- 口径：演示脚本用于可重复展示；模型失败必须显式降级，不得临场补造。",
    "",
    "| 顺序 | 时间 | 操作者 | 界面 | 操作与可见变化 | 失败回退 |",
    "| ---: | --- | --- | --- | --- | --- |",
    ...plan.goldenDemo.steps.map((step) => {
      const clean = (value) => value.replaceAll("|", "｜").replaceAll("\n", " ");
      return `| ${step.order} | ${step.minuteStart}–${step.minuteEnd} 分 | ${step.actor} | ${step.surface} | ${clean(step.action)}<br>${clean(step.visibleChange)} | ${clean(step.fallback)} |`;
    }),
    "",
    "## 五项跨界面因果",
    "",
    ...plan.crossSurfaceCausality.map(
      (item, index) =>
        `${index + 1}. **${item.label}**：${item.requirement}`,
    ),
    "",
    "## 结论边界",
    "",
    plan.claimBoundary,
    "",
  ];
  return lines.join("\n");
}

function parsePerformanceMetric(stdout) {
  const match = /GOLD_PERFORMANCE_METRIC (\{[^\r\n]+\})/u.exec(stdout);
  if (!match?.[1]) return null;
  return JSON.parse(match[1]);
}

function parseAsyncProgressMetric(stdout) {
  const match = /GOLD_ASYNC_PROGRESS_METRIC (\{[^\r\n]+\})/u.exec(stdout);
  if (!match?.[1]) return null;
  try {
    const metric = JSON.parse(match[1]);
    if (
      metric.environment !== "chromium/deterministic-e2e"
      || metric.samples !== 1
      || metric.selector !== ".student-action-progress"
      || !Number.isFinite(metric.observedWithinMs)
      || metric.observedWithinMs < 0
      || !Number.isFinite(metric.targetVisibleWithinMs)
      || metric.targetVisibleWithinMs <= 0
    ) return null;
    return metric;
  } catch {
    return null;
  }
}

function createPerformanceSummary(input) {
  const metric = input.localMetric;
  const localStatus = !metric
    ? input.localReceipt.status === "failed" ? "failed" : "insufficient"
    : metric.p95Ms <= metric.targetP95Ms
      ? "passed"
      : "failed";
  const completedReceipts = input.liveBundle?.receipts.filter(
    (receipt) => receipt.status === "completed",
  ) ?? [];
  const failedReceipts = input.liveBundle?.receipts.filter(
    (receipt) => receipt.status !== "completed",
  ) ?? [];
  const allLiveReceipts = input.liveBundle?.receipts ?? [];
  const latencies = allLiveReceipts.map((receipt) => receipt.latencyMs);
  const tokenReceipts = allLiveReceipts.filter(
    (receipt) => receipt.tokenUsage !== null,
  );
  const tokenUsage = (
    tokenReceipts.length === 0
    || tokenReceipts.length !== allLiveReceipts.length
  )
    ? null
    : tokenReceipts.reduce(
      (total, receipt) => ({
        input: total.input + receipt.tokenUsage.input,
        output: total.output + receipt.tokenUsage.output,
        total: total.total + receipt.tokenUsage.total,
      }),
      { input: 0, output: 0, total: 0 },
    );
  const pricedReceipts = allLiveReceipts.filter(
    (receipt) => receipt.estimatedCostUsd !== null,
  );
  const estimatedCostUsd = (
    pricedReceipts.length === 0
    || pricedReceipts.length !== allLiveReceipts.length
  )
    ? null
    : Number(pricedReceipts.reduce(
      (sum, receipt) => sum + receipt.estimatedCostUsd,
      0,
    ).toFixed(10));
  const liveP95 = percentile(latencies, 0.95);
  const liveStatus = !input.liveBundle
    ? "insufficient"
    : failedReceipts.length > 0
      || liveP95 === null
      || liveP95 > input.plan.performanceTargets.liveModelP95Ms
      ? "failed"
      : "passed";
  const asyncMetric = (
    input.asyncProgressMetric?.targetVisibleWithinMs
      === input.plan.performanceTargets.asyncProgressVisibleWithinMs
  )
    ? input.asyncProgressMetric
    : null;
  const asyncStatus = !asyncMetric
    ? "insufficient"
    : asyncMetric.observedWithinMs
        <= input.plan.performanceTargets.asyncProgressVisibleWithinMs
      ? "passed"
      : "failed";
  const unsigned = {
    schemaVersion: input.plan.schemaVersion,
    generatedAt: input.generatedAt,
    localAction: {
      status: localStatus,
      environment: metric?.environment ?? "fastify-inject-memory-test",
      samples: metric?.samples ?? 0,
      p50Ms: metric?.p50Ms ?? null,
      p95Ms: metric?.p95Ms ?? null,
      maxMs: metric?.maxMs ?? null,
      targetP95Ms: input.plan.performanceTargets.localActionP95Ms,
      evidenceRefs: [
        "validation/receipts.json::api-local-action-performance",
      ],
    },
    asyncProgress: {
      status: asyncStatus,
      targetVisibleWithinMs:
        input.plan.performanceTargets.asyncProgressVisibleWithinMs,
      observedWithinMs: asyncMetric?.observedWithinMs ?? null,
      evidenceRefs: asyncMetric
        ? [
          "validation/receipts.json::browser-golden-path#GOLD_ASYNC_PROGRESS_METRIC",
          "e2e/ronggang-full-loop.spec.ts::.student-action-progress",
        ]
        : ["pending:browser-observed-async-progress-timing"],
    },
    liveModel: {
      status: liveStatus,
      environment: input.liveBundle
        ? `${input.liveBundle.modelBinding.provider}/${input.liveBundle.modelBinding.mode}`
        : "not_run",
      samples: allLiveReceipts.length,
      p50Ms: percentile(latencies, 0.5),
      p95Ms: liveP95,
      maxMs: latencies.length > 0 ? Math.max(...latencies) : null,
      targetP95Ms: input.plan.performanceTargets.liveModelP95Ms,
      evidenceRefs: input.liveBundle
        ? ["ablation/controlled-live-report.json::receipts"]
        : ["pending:controlled-live-ablation"],
      requestedCalls: input.liveBundle?.receipts.length ?? 0,
      completedCalls: completedReceipts.length,
      failedCalls: failedReceipts.length,
      tokenUsage,
      estimatedCostUsd,
      costCalculation: input.liveBundle?.modelBinding.pricing
        ?.calculation ?? null,
    },
    overallStatus: combinedStatus([
      localStatus,
      asyncStatus,
      liveStatus,
    ]),
    claimBoundary: asyncMetric
      ? "本地行动只代表Fastify内存注入环境；Live时延、Token与成本覆盖本次受控合成案件全部可观测调用，任一调用缺失用量时总Token/成本保持null；异步进度时延由确定性Chromium在真实点击捕获点与.student-action-progress首次可见之间用performance.now单样本计时，不代表生产网络分布。"
      : "本地行动只代表Fastify内存注入环境；Live时延、Token与成本覆盖本次受控合成案件全部可观测调用，任一调用缺失用量时总Token/成本保持null；异步进度尚无独立浏览器计时，因此该单项保持证据不足。",
  };
  return GoldTechnicalPerformanceSummarySchema.parse({
    ...unsigned,
    summaryHash: hashValue(unsigned),
  });
}

async function writeArtifact(relativePath, content, evidenceRefs) {
  const absolutePath = resolve(outputRoot, relativePath);
  const normalized = relative(outputRoot, absolutePath).replaceAll("\\", "/");
  if (
    normalized === ".."
    || normalized.startsWith("../")
    || /^[A-Za-z]:[\\/]/u.test(normalized)
  ) {
    throw new Error(`证据文件越出输出目录：${relativePath}`);
  }
  const buffer = Buffer.isBuffer(content)
    ? content
    : Buffer.from(content, "utf8");
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, buffer, { mode: 0o600 });
  return {
    path: relativePath.replaceAll("\\", "/"),
    sha256: sha256(buffer),
    bytes: buffer.byteLength,
    mediaType: relativePath.endsWith(".md")
      ? "text/markdown; charset=utf-8"
      : "application/json",
    evidenceRefs,
  };
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function loadTransferAuthoringRun() {
  const pointerPath = resolve(
    projectRoot,
    "artifacts/gold-transfer-authoring/latest.json",
  );
  let pointer;
  try {
    pointer = JSON.parse(await readFile(pointerPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  const { pointerHash, ...pointerUnsigned } = pointer;
  if (hashValue(pointerUnsigned) !== pointerHash) {
    throw new Error("前瞻迁移证据指针哈希不一致");
  }
  const runPath = resolve(projectRoot, pointer.runPath);
  if (
    normalizedPath(runPath) !== pointer.runPath
    || pointer.runPath.startsWith("../")
  ) {
    throw new Error("前瞻迁移证据指针必须位于原型项目内");
  }
  const runBytes = await readFile(runPath);
  const run = GoldTransferAuthoringRunSchema.parse(
    JSON.parse(runBytes.toString("utf8")),
  );
  const { runHash, ...runUnsigned } = run;
  if (
    hashValue(runUnsigned) !== runHash
    || pointer.runId !== run.runId
    || pointer.runHash !== run.runHash
  ) {
    throw new Error("前瞻迁移运行记录与指针不一致");
  }
  const eventLogPath = resolve(projectRoot, run.eventLog.path);
  const eventLogBytes = await readFile(eventLogPath);
  const transferEvents = verifyTransferEventLogBytes(eventLogBytes);
  if (
    normalizedPath(eventLogPath) !== run.eventLog.path
    || sha256(eventLogBytes) !== run.eventLog.sha256
    || transferEvents.length !== run.eventLog.eventCount
  ) {
    throw new Error("前瞻迁移事件日志与运行记录不一致");
  }
  if (run.runtimeSmoke !== null) {
    const { receiptHash, ...receiptUnsigned } = run.runtimeSmoke;
    if (hashValue(receiptUnsigned) !== receiptHash) {
      throw new Error("前瞻迁移运行烟测收据哈希不一致");
    }
  }

  const runRepositoryPath = repositoryPath(runPath);
  const evidenceSnapshotCommits = (
    await git([
      "log",
      "--diff-filter=A",
      "--format=%H",
      "--",
      `:(top)${runRepositoryPath}`,
    ])
  )
    .split(/\r?\n/u)
    .filter(Boolean);
  if (
    evidenceSnapshotCommits.length !== 1
    || !/^[a-f0-9]{40}$/u.test(evidenceSnapshotCommits[0])
  ) {
    throw new Error("前瞻迁移运行记录必须唯一绑定到首次纳入Git的不可变提交");
  }
  const evidenceSnapshotGitCommit = evidenceSnapshotCommits[0];
  const snapshotRunBytes = await gitBytes([
    "show",
    `${evidenceSnapshotGitCommit}:${runRepositoryPath}`,
  ]);
  if (
    snapshotRunBytes.byteLength !== runBytes.byteLength
    || sha256(snapshotRunBytes) !== sha256(runBytes)
  ) {
    throw new Error("前瞻迁移运行记录与Git证据快照不一致");
  }

  const eventLogRepositoryPath = repositoryPath(eventLogPath);
  const snapshotEventLogBytes = await gitBytes([
    "show",
    `${evidenceSnapshotGitCommit}:${eventLogRepositoryPath}`,
  ]);
  if (
    snapshotEventLogBytes.byteLength !== eventLogBytes.byteLength
    || sha256(snapshotEventLogBytes) !== sha256(eventLogBytes)
  ) {
    throw new Error("前瞻迁移事件日志与Git证据快照不一致");
  }

  for (const file of run.modifiedFiles) {
    const absolutePath = resolve(projectRoot, file.path);
    const fileRepositoryPath = repositoryPath(absolutePath);
    const bytes = await gitBytes([
      "show",
      `${evidenceSnapshotGitCommit}:${fileRepositoryPath}`,
    ]);
    if (
      normalizedPath(absolutePath) !== file.path
      || bytes.byteLength !== file.bytes
      || sha256(bytes) !== file.sha256
    ) {
      throw new Error(
        `前瞻迁移创作文件与Git证据快照中的运行记录不一致：${file.path}`,
      );
    }
  }

  const collectorPath = resolve(
    projectRoot,
    "scripts/gold-transfer-authoring.mjs",
  );
  const baselineCollectorBytes = await gitBytes([
    "show",
    `${run.baseline.sourceGitCommit}:${repositoryPath(collectorPath)}`,
  ]);
  if (sha256(baselineCollectorBytes) !== run.baseline.collectorSha256) {
    throw new Error("前瞻迁移采集器与基线Git提交不一致");
  }

  return {
    run,
    evidenceRef: normalizedPath(runPath),
    baselineGitCommit: run.baseline.sourceGitCommit,
    evidenceSnapshotGitCommit,
  };
}

if (argumentsList.includes("--validate-imports")) {
  const packageManager = packageManagerInvocation(["--version"]);
  const result = await runProcess(
    packageManager.command,
    packageManager.args,
  );
  if (result.code !== 0) {
    throw new Error(
      `gold evidence process runner failed: ${result.stderr || "unknown error"}`,
    );
  }
  console.log(
    `gold evidence runtime ok: product=${ProductVersion}, pnpm=${result.stdout.trim()}`,
  );
  process.exit(0);
}

await assertTrackedSourceClean();
const sourceGitCommit = await git(["rev-parse", "HEAD"]);
if (!/^[a-f0-9]{40}$/u.test(sourceGitCommit)) {
  throw new Error("无法取得40位源代码提交哈希");
}
const discoveredRepositoryRoot = resolve(
  await git(["rev-parse", "--show-toplevel"]),
);
if (relative(repositoryRoot, discoveredRepositoryRoot) !== "") {
  throw new Error("原型项目Git仓库根目录与证据生成器预期不一致");
}
const generatedAt = new Date().toISOString();
const transferAuthoringEvidence = await loadTransferAuthoringRun();
const flagshipBinding = {
  role: "flagship",
  scenarioId: flagshipScenarioV111.scenarioId,
  version: flagshipScenarioV111.version,
  releaseRef: releaseRef(flagshipScenarioV111),
  contentHash: flagshipScenarioV111ContentHash,
};
const transferBinding = {
  role: "transfer",
  scenarioId: heritageNightTourScenarioV100.scenarioId,
  version: heritageNightTourScenarioV100.version,
  releaseRef: releaseRef(heritageNightTourScenarioV100),
  contentHash: heritageNightTourScenarioV100ContentHash,
};
const plan = createGoldTechnicalEvidencePlan({
  flagship: flagshipBinding,
  transfer: transferBinding,
});
const protocol = createGoldAblationProtocol({
  scenarioReleaseRef: flagshipBinding.releaseRef,
  scenarioContentHash: flagshipBinding.contentHash,
});
const contractReport = runGoldContractReplay({ protocol, generatedAt });
const preregisteredLiveModel = "deepseek-v4-flash";
const preregisteredLiveProfile =
  `gold-controlled-live/${preregisteredLiveModel}`;
const controlledAblationProtocolInput = {
  scenarioReleaseRef: flagshipBinding.releaseRef,
  scenarioContentHash: flagshipBinding.contentHash,
  modelProfileRef: preregisteredLiveProfile,
  modelTier: preregisteredLiveModel,
  repetitionsPerCondition: 10,
};
const controlledAblationPreregistration =
  createGoldControlledAblationPreregistration(
    controlledAblationProtocolInput,
  );
const contractPassed = contractReport.gates.every(
  (gate) => gate.status === "passed",
);
const validationReceipts = [];

const flagshipValidation = validateScenarioPackage(flagshipScenarioV111, {
  draftId: "gold-flagship-detached",
  validatedAt: generatedAt,
});
const transferValidation = validateScenarioPackage(
  heritageNightTourScenarioV100,
  {
  draftId: "gold-transfer-detached",
  validatedAt: generatedAt,
  },
);
const scenarioValidationPassed = (
  flagshipValidation.valid
  && transferValidation.valid
  && flagshipValidation.definitionHash === flagshipBinding.contentHash
  && transferValidation.definitionHash === transferBinding.contentHash
);
validationReceipts.push(validationReceipt({
  receiptId: "scenario-package-validation",
  command: "internal: validateScenarioPackage(flagship, transfer)",
  scope: "旗舰与迁移情境的Schema、引用与内容哈希",
  status: scenarioValidationPassed ? "passed" : "failed",
  startedAt: generatedAt,
  durationMs: 0,
  resultSummary: scenarioValidationPassed
    ? "两个情境均通过编译校验，且定义哈希与发布绑定一致。"
    : "至少一个情境校验或发布哈希不一致。",
  outputHash: hashValue({ flagshipValidation, transferValidation }),
}));
validationReceipts.push(validationReceipt({
  receiptId: "ablation-contract-replay",
  command: "internal: runGoldContractReplay(protocol)",
  scope: "A/B/C确定性工程合同与失败关闭门",
  status: contractPassed ? "passed" : "failed",
  startedAt: generatedAt,
  durationMs: 0,
  resultSummary: contractPassed
    ? `合同回放${contractReport.observationCount}次，全部工程门通过。`
    : "合同回放存在未通过或证据不足的工程门。",
  outputHash: contractReport.reportHash,
}));

const runtimeScan = await scanForbiddenRuntime(plan);
const runtimeScanPassed = runtimeScan.matches.length === 0;
validationReceipts.push(validationReceipt({
  receiptId: "transfer-runtime-scan",
  command: "internal: scan transfer topic markers in forbidden runtime paths",
  scope: "第二情境题材专用内核代码扫描",
  status: runtimeScanPassed ? "passed" : "failed",
  startedAt: generatedAt,
  durationMs: 0,
  resultSummary: runtimeScanPassed
    ? `扫描${plan.transferTarget.forbiddenTopicSpecificRuntimePaths.length}个受限路径，未发现迁移题材标记。`
    : `发现${runtimeScan.matches.length}项迁移题材标记命中。`,
  outputHash: hashValue(runtimeScan),
}));

const nodeCommand = process.execPath;
const performanceRun = await commandReceipt({
  receiptId: "api-local-action-performance",
  command: nodeCommand,
  args: [
    "node_modules/vitest/vitest.mjs",
    "run",
    "apps/api/test/gold-performance.test.ts",
    "--maxWorkers=1",
    "--reporter=verbose",
  ],
  displayCommand:
    "node node_modules/vitest/vitest.mjs run apps/api/test/gold-performance.test.ts --maxWorkers=1 --reporter=verbose",
  scope: "本地世界行动确认P50/P95",
  passedSummary: "本地世界行动性能测试通过，精确分位数见performance/summary.json。",
  failedSummary: "本地世界行动性能测试失败",
});
validationReceipts.push(performanceRun.receipt);
const localMetric = parsePerformanceMetric(performanceRun.result.stdout);

const agentRuntimeCommand = packageManagerInvocation([
  "--filter",
  "@ronggang/agent-runtime",
  "test",
]);
const agentRuntimeRun = await commandReceipt({
  receiptId: "agent-runtime-tests",
  command: agentRuntimeCommand.command,
  args: agentRuntimeCommand.args,
  displayCommand: "pnpm --filter @ronggang/agent-runtime test",
  scope: "多智能体合同、调度、视野、失败与Live执行器",
  passedSummary: "智能体运行时测试通过。",
  failedSummary: "智能体运行时测试失败",
  environment: {
    DEEPSEEK_LIVE_SMOKE: "0",
  },
});
validationReceipts.push(agentRuntimeRun.receipt);
const worldCoreCommand = packageManagerInvocation([
  "--filter",
  "@ronggang/world-core",
  "test",
]);
const worldCoreRun = await commandReceipt({
  receiptId: "world-core-tests",
  command: worldCoreCommand.command,
  args: worldCoreCommand.args,
  displayCommand: "pnpm --filter @ronggang/world-core test",
  scope: "统一世界、情境后果、版本哈希与旧版回归",
  passedSummary: "世界核心测试通过。",
  failedSummary: "世界核心测试失败",
});
validationReceipts.push(worldCoreRun.receipt);

let browserReceipt;
let asyncProgressMetric = null;
if (fullValidation) {
  const browserCommand = packageManagerInvocation(["test:e2e:built"]);
  const browserRun = await commandReceipt({
    receiptId: "browser-golden-path",
    command: browserCommand.command,
    args: browserCommand.args,
    displayCommand: "pnpm test:e2e:built",
    scope: "Chromium双维度黄金路径、时间线与可见界面",
    passedSummary: "Chromium黄金路径全部通过。",
    failedSummary: "Chromium黄金路径失败",
  });
  browserReceipt = browserRun.receipt;
  asyncProgressMetric = parseAsyncProgressMetric(browserRun.result.stdout);
} else {
  browserReceipt = validationReceipt({
    receiptId: "browser-golden-path",
    command: "pnpm test:e2e:built",
    scope: "Chromium双维度黄金路径、时间线与可见界面",
    status: "insufficient",
    startedAt: generatedAt,
    durationMs: 0,
    resultSummary: "本次使用核心验证模式，未运行完整Chromium黄金路径。",
    outputHash: hashValue({
      command: "pnpm test:e2e:built",
      status: "not_run",
    }),
  });
}
validationReceipts.push(browserReceipt);

let liveBundle = null;
if (live) {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) throw new Error("--live 要求配置 DEEPSEEK_API_KEY");
  const model = process.env.DEEPSEEK_MODEL?.trim() || preregisteredLiveModel;
  if (model !== preregisteredLiveModel) {
    throw new Error(
      `Live模型${model}与预登记${preregisteredLiveModel}不一致；必须先形成新协议版本与Git提交`,
    );
  }
  const pricingSnapshot = JSON.parse(await readFile(
    resolve(projectRoot, "scripts/gold-evidence-pricing.json"),
    "utf8",
  ));
  const modelPricing = pricingSnapshot.models?.[model];
  if (!modelPricing) {
    throw new Error(
      `定价快照未包含模型 ${model}；请先核对官方价格并更新版本化快照`,
    );
  }
  const timeoutMs = Number(process.env.MODEL_TIMEOUT_MS || 30_000);
  const maxRetries = Number(process.env.MODEL_MAX_RETRIES || 1);
  const profileId = process.env.MODEL_PROFILE_ID?.trim()
    || preregisteredLiveProfile;
  if (profileId !== preregisteredLiveProfile) {
    throw new Error(
      `Live模型档案${profileId}与预登记${preregisteredLiveProfile}不一致；必须先形成新协议版本与Git提交`,
    );
  }
  const liveProtocolPreflight = createGoldControlledAblationProtocol({
    ...controlledAblationProtocolInput,
    modelProfileRef: profileId,
    modelTier: model,
  });
  if (
    liveProtocolPreflight.controlVariablesHash
      !== controlledAblationPreregistration.protocol.controlVariablesHash
  ) {
    throw new Error("Live执行协议与已密封预登记哈希不一致；未发起任何模型调用");
  }
  const provider = new OpenAiCompatibleModelProvider({
    profileId,
    baseUrl: process.env.DEEPSEEK_BASE_URL?.trim()
      || "https://api.deepseek.com",
    apiKey,
    model,
    maxRetries,
  });
  liveBundle = await runGoldControlledAblation({
    generatedAt,
    ...controlledAblationProtocolInput,
    provider,
    pricing: {
      sourceUrl: pricingSnapshot.sourceUrl,
      accessedAt: pricingSnapshot.accessedAt,
      inputCacheMissUsdPerMillion:
        modelPricing.inputCacheMissUsdPerMillion,
      outputUsdPerMillion: modelPricing.outputUsdPerMillion,
      calculation: pricingSnapshot.calculation,
    },
    timeoutMs,
    maxOutputTokens: 1024,
    maxParallelCalls: 3,
  });
  if (
    liveBundle.protocol.controlVariablesHash
      !== controlledAblationPreregistration.protocol.controlVariablesHash
  ) {
    throw new Error("Live执行协议与已密封预登记哈希不一致");
  }
}

const studentRoleIds = heritageNightTourScenarioV100.roles
  .filter((role) => role.actorKind === "student")
  .map((role) => role.agentId);
const privateNpcActorIds = [...new Set(
  heritageNightTourScenarioV100.bootstrap.openingMessages
    .filter((message) => message.visibility.includes("role_private"))
    .map((message) => message.actorId)
    .filter((actorId) => !studentRoleIds.includes(actorId)),
)];
const architecturePassed = (
  transferValidation.valid
  && transferValidation.definitionHash === transferBinding.contentHash
  && runtimeScanPassed
  && studentRoleIds.length >= plan.transferTarget.requiredStudentRoles
  && privateNpcActorIds.length >= plan.transferTarget.requiredPrivateNpcs
  && heritageNightTourScenarioV100.nodes.length
    >= plan.transferTarget.requiredNodes
  && heritageNightTourScenarioV100.eventPolicies.length > 0
  && heritageNightTourScenarioV100.approvalPolicies.some(
    (policy) => policy.reviewMode === "teacher_required",
  )
  && heritageNightTourScenarioV100.rubric.length > 0
);
const matchedTransferAuthoringRun = (
  transferAuthoringEvidence?.run.targetScenarioId
    === heritageNightTourScenarioV100.scenarioId
  && transferAuthoringEvidence.run.targetRelease?.version
    === heritageNightTourScenarioV100.version
  && transferAuthoringEvidence.run.targetRelease?.contentHash
    === heritageNightTourScenarioV100ContentHash
)
  ? transferAuthoringEvidence
  : null;
const authoringRun = matchedTransferAuthoringRun?.run ?? null;
const authoringStatus = authoringRun?.status === "passed"
  ? "passed"
  : authoringRun?.status === "failed"
    ? "failed"
    : "insufficient";
const observedAuthoringMinutes = authoringRun?.timing.elapsedMs === null
  || authoringRun?.timing.elapsedMs === undefined
  ? null
  : authoringRun.timing.elapsedMs / 60_000;
const transferUnsigned = {
  schemaVersion: plan.schemaVersion,
  generatedAt,
  scenarioBinding: transferBinding,
  configurationSourceRefs: [
    "packages/world-core/src/heritage-night-tour-scenario.ts::heritageNightTourScenarioV100",
  ],
  validation: {
    valid: transferValidation.valid,
    issueCount: transferValidation.issues.length,
    definitionHash: transferValidation.definitionHash,
    validationStamp: transferValidation.validationStamp,
  },
  observedStructure: {
    studentRoleIds,
    privateNpcActorIds,
    nodeIds: heritageNightTourScenarioV100.nodes.map((node) => node.nodeId),
    eventPolicyCount: heritageNightTourScenarioV100.eventPolicies.length,
    teacherApprovalPolicyCount:
      heritageNightTourScenarioV100.approvalPolicies.filter(
        (policy) => policy.reviewMode === "teacher_required",
      ).length,
    rubricCriterionCount: heritageNightTourScenarioV100.rubric.length,
  },
  forbiddenRuntimeScan: {
    scannedPaths: plan.transferTarget.forbiddenTopicSpecificRuntimePaths,
    topicMarkers: runtimeScan.markers,
    matches: runtimeScan.matches,
    status: runtimeScanPassed ? "passed" : "failed",
  },
  architectureStatus: architecturePassed ? "passed" : "failed",
  authoringTime: {
    targetMaxMinutes: plan.transferTarget.maxAuthoringMinutes,
    observedMinutes: observedAuthoringMinutes,
    runId: authoringRun?.runId ?? null,
    startedAt: authoringRun?.timing.startedAt ?? null,
    completedAt: authoringRun?.timing.completedAt ?? null,
    elapsedMs: authoringRun?.timing.elapsedMs ?? null,
    baselineGitCommit:
      matchedTransferAuthoringRun?.baselineGitCommit ?? null,
    evidenceSnapshotGitCommit:
      matchedTransferAuthoringRun?.evidenceSnapshotGitCommit ?? null,
    status: authoringStatus,
    evidenceRef: matchedTransferAuthoringRun?.evidenceRef ?? null,
    rationale: authoringRun
      ? `前瞻运行${authoringRun.runId}从干净基线连续计时到首次校验、不可变发布和技术烟测，状态为${authoringStatus}；运行记录、事件日志和创作文件已按Git证据快照${matchedTransferAuthoringRun.evidenceSnapshotGitCommit}逐字节复核，当前目标发布另按版本与内容哈希复核；该工时不回填历史情境。`
      : "当前正式迁移情境没有与版本及内容哈希匹配的前瞻计时运行；不得倒推或补造历史工时。",
  },
  overallStatus: !architecturePassed
    ? "failed"
    : authoringStatus,
  claimBoundary: authoringStatus === "passed"
    ? "该证明确认前瞻新微型情境由通用ScenarioPackage配置完成、结构达标、受限内核无题材标记，历史创作文件由不可变Git快照逐字节复核，当前目标发布由版本与内容哈希独立复核，且从冻结模板起点到首次校验、不可变发布和技术烟测的连续工时不超过八小时；它不回填旧情境工时，也不代表教师评价效度、学生成效或生产SLA。"
    : "该证明可确认正式迁移情境由通用ScenarioPackage配置运行、结构达标且受限内核路径无题材标记；由于缺少与当前版本和内容哈希匹配的前瞻计时，不能声称已满足八小时迁移工时目标。",
};
const transferProof = GoldTransferConfigurationProofSchema.parse({
  ...transferUnsigned,
  proofHash: hashValue(transferUnsigned),
});
const evidenceAssessment = createEvidenceAssessment({
  plan,
  validationReceipts,
  generatedAt,
});
const performanceSummary = createPerformanceSummary({
  plan,
  generatedAt,
  localReceipt: performanceRun.receipt,
  localMetric,
  asyncProgressMetric,
  liveBundle,
});

const artifacts = [];
artifacts.push(await writeArtifact(
  "technical-plan.json",
  json(plan),
  ["qa-002:technical-plan", `plan:${plan.planHash}`],
));
artifacts.push(await writeArtifact(
  "validation/receipts.json",
  json({
    schemaVersion: plan.schemaVersion,
    generatedAt,
    receipts: validationReceipts,
    receiptsHash: hashValue(validationReceipts),
  }),
  validationReceipts.map((receipt) => `receipt:${receipt.receiptId}`),
));
artifacts.push(await writeArtifact(
  "gates/evidence-assessment.json",
  json(evidenceAssessment),
  ["qa-002:ten-technical-gates", "qa-002:five-causal-claims"],
));
artifacts.push(await writeArtifact(
  "demo/golden-demo.md",
  createGoldenDemoMarkdown(plan, sourceGitCommit),
  ["qa-002:8-12-minute-golden-demo"],
));
artifacts.push(await writeArtifact(
  "ablation/preregistration.json",
  json(controlledAblationPreregistration),
  [
    "qa-002:controlled-ablation-preregistration",
    `preregistration:${controlledAblationPreregistration.preregistrationHash}`,
  ],
));
artifacts.push(await writeArtifact(
  "ablation/contract-report.json",
  json({ protocol, report: contractReport }),
  ["qa-002:abc-contract-replay", `report:${contractReport.reportHash}`],
));
if (liveBundle) {
  artifacts.push(await writeArtifact(
    "ablation/controlled-live-report.json",
    json({
      schemaVersion: liveBundle.schemaVersion,
      bundleVersion: liveBundle.bundleVersion,
      generatedAt: liveBundle.generatedAt,
      modelBinding: liveBundle.modelBinding,
      protocol: liveBundle.protocol,
      report: liveBundle.report,
      receipts: liveBundle.receipts,
      claimBoundary: liveBundle.claimBoundary,
      bundleHash: liveBundle.bundleHash,
    }),
    ["qa-002:controlled-live-ablation", `bundle:${liveBundle.bundleHash}`],
  ));
  artifacts.push(await writeArtifact(
    "ablation/blind-review-packet.json",
    json(liveBundle.blindReviewPacket),
    ["qa-002:condition-label-hidden-review"],
  ));
  artifacts.push(await writeArtifact(
    "ablation/condition-key.json",
    json({
      mappingVersion: "gold-condition-key/1.1.0",
      conditionKey: liveBundle.conditionKey,
      mappingHash: hashValue(liveBundle.conditionKey),
    }),
    ["qa-002:separate-condition-key"],
  ));
}
artifacts.push(await writeArtifact(
  "transfer/configuration-proof.json",
  json(transferProof),
  ["qa-002:configuration-only-transfer", `proof:${transferProof.proofHash}`],
));
artifacts.push(await writeArtifact(
  "performance/summary.json",
  json(performanceSummary),
  ["qa-002:latency-token-cost-disclosure"],
));

const contractModelBinding = {
  evidenceKind: "contract",
  profileRef: protocol.controlVariables.modelProfileRef,
  provider: "deterministic",
  mode: "mock",
  model: "gold-contract-replay-v1",
  promptAndPolicyHash: hashValue({
    controlVariablesHash: protocol.controlVariablesHash,
    profiles: protocol.profiles.map((profile) => ({
      profileId: profile.profileId,
      policyHash: profile.policyHash,
    })),
  }),
};
const modelBindings = [contractModelBinding];
if (liveBundle) {
  modelBindings.push({
    evidenceKind: "controlled_live",
    profileRef: liveBundle.modelBinding.profileRef,
    provider: liveBundle.modelBinding.provider,
    mode: liveBundle.modelBinding.mode,
    model: liveBundle.modelBinding.model,
    promptAndPolicyHash: hashValue({
      controlVariablesHash: liveBundle.protocol.controlVariablesHash,
      requestHashes: liveBundle.receipts.map((receipt) => receipt.requestHash),
    }),
  });
}
const liveAblationStatus = !liveBundle
  ? "not_run"
  : liveBundle.receipts.some((receipt) => receipt.status !== "completed")
    || liveBundle.report.gates.some((gate) => gate.status !== "passed")
    ? "failed"
    : "passed";
const knownLimitations = [
  transferProof.authoringTime.status === "passed"
    ? "迁移工时只覆盖本次前瞻新微型情境从冻结模板到首次可运行发布的连续配置创作，不回填旧情境历史，也不外推跨专业规模化生产。"
    : "迁移情境的配置化结构已验证，但没有与当前正式版本及内容哈希匹配的前瞻计时，八小时目标保持证据不足。",
  performanceSummary.asyncProgress.observedWithinMs === null
    ? "异步进度可见时延尚未由独立浏览器计时器采样，性能总证明保持证据不足。"
    : `异步进度可见时延${performanceSummary.asyncProgress.observedWithinMs}ms来自确定性Chromium单样本，只证明当前原型点击后可见反馈，不代表生产网络分布。`,
  liveBundle
    ? "Live A/B/C使用V1.1预登记平衡案件、候选可采纳度技术锚点和条件隐藏盲评包；技术锚点不是真实教师评分，未完成独立评审前不得外推任务质量。"
    : `本次未运行真实模型A/B/C受控消融；已密封V1.1协议${controlledAblationPreregistration.preregistrationHash}，但只有确定性工程合同，不得外推模型表现。`,
  "真实教师双盲评分、评分者一致性和学生试点属于QA-003，当前证据包不包含这些结论。",
  "sourceTreeState=clean指生成前Git已跟踪文件无改动；未跟踪且未进入提交树的本地材料不属于证据源。",
];
const manifestUnsigned = {
  schemaVersion: plan.schemaVersion,
  manifestVersion: "gold-technical-evidence-manifest/1.0.0",
  generatedAt,
  productVersion: ProductVersion,
  sourceGitCommit,
  sourceTreeState: "clean",
  planHash: plan.planHash,
  scenarioBindings: plan.scenarioBindings,
  modelBindings,
  gateSummary: {
    technicalGates: statusSummary(
      evidenceAssessment.technicalGates.map((gate) => gate.status),
    ),
    causalClaims: statusSummary(
      evidenceAssessment.causalClaims.map((claim) => claim.status),
    ),
    controlledLiveAblation: liveAblationStatus,
    transferProof: transferProof.overallStatus,
  },
  validationReceipts,
  artifacts,
  excludedSensitiveFields: [
    "apiKey",
    "rawPrompt",
    "rawPrivateMemory",
    "rawMaterial",
    "rawProviderRequestId",
    "teacherIdentity",
    "studentIdentity",
  ],
  knownLimitations,
  generationCommand: live
    ? "node --env-file=.env.local scripts/generate-gold-readiness-evidence.mjs --full --live"
    : fullValidation
      ? "node scripts/generate-gold-readiness-evidence.mjs --full"
      : "node scripts/generate-gold-readiness-evidence.mjs",
};
const manifest = GoldTechnicalEvidenceManifestSchema.parse({
  ...manifestUnsigned,
  manifestHash: hashValue(manifestUnsigned),
});
await writeArtifact(
  "manifest.json",
  json(manifest),
  ["qa-002:root-manifest", `manifest:${manifest.manifestHash}`],
);

const failedValidationCount = validationReceipts.filter(
  (receipt) => receipt.status === "failed",
).length;
const result = {
  output: outputRelative,
  sourceGitCommit,
  manifestHash: manifest.manifestHash,
  artifactCount: artifacts.length + 1,
  technicalGates: manifest.gateSummary.technicalGates,
  causalClaims: manifest.gateSummary.causalClaims,
  controlledLiveAblation: manifest.gateSummary.controlledLiveAblation,
  transferProof: manifest.gateSummary.transferProof,
  performance: performanceSummary.overallStatus,
  failedValidationCount,
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (
  failedValidationCount > 0
  || transferProof.architectureStatus === "failed"
  || liveAblationStatus === "failed"
) {
  process.exitCode = 2;
}
