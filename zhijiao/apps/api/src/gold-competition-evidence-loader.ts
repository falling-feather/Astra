import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import {
  GoldBlindReviewConditionKeyEntrySchema,
  GoldBlindReviewPacketSchema,
  GoldCompetitionGoldenDemoEvidenceSchema,
  GoldCompetitionSourceArtifactSchema,
  GoldControlledAblationBundleSchema,
  GoldTechnicalEvidenceManifestSchema,
  GoldTransferConfigurationProofSchema,
  type GoldCompetitionGoldenDemoEvidence,
  type GoldCompetitionSourceArtifact,
  type GoldControlledAblationBundle,
  type GoldTechnicalEvidenceManifest,
  type GoldTransferConfigurationProof,
} from "@ronggang/contracts";
import type { GoldCompetitionLoadedEvidence } from "@ronggang/agent-runtime";
import { hashValue } from "@ronggang/context-engine";
import { z, type ZodType } from "zod";

const technicalManifestPath = "manifest.json";
const goldenDemoRunPath = "demo/formal-v1.1.16-pass/run.json";
const goldenDemoScreenshotManifestPath =
  "demo/formal-v1.1.16-pass/screenshot-manifest.json";
const controlledAblationPath = "ablation/controlled-live-report.json";
const controlledAblationBlindPacketPath =
  "ablation/blind-review-packet.json";
const controlledAblationConditionKeyPath = "ablation/condition-key.json";
const transferProofPath = "transfer/configuration-proof.json";

const goldenDemoRunSchema = z.object({
  schemaVersion: z.literal("golden-demo-run/1.0.0"),
  runId: z.string().min(1).max(120),
  status: z.enum(["passed", "failed"]),
  scenario: z.object({
    version: z.string().regex(/^\d+\.\d+\.\d+$/u),
  }).passthrough(),
  timing: z.object({
    operatorToStudentReplayMs: z.number().int().nonnegative(),
    minimumMs: z.number().int().nonnegative(),
    maximumMs: z.number().int().positive(),
    pass: z.boolean(),
  }).passthrough(),
  result: z.object({
    worldEventCount: z.number().int().nonnegative(),
    evidenceCount: z.number().int().nonnegative(),
    taskCount: z.number().int().nonnegative(),
    runCount: z.number().int().nonnegative(),
    failureCount: z.number().int().nonnegative(),
    degradedCount: z.number().int().nonnegative(),
    pendingCount: z.number().int().nonnegative(),
    abnormalCount: z.number().int().nonnegative(),
    finalScore: z.number().min(0).max(100),
    learningReplay: z.object({
      status: z.enum(["passed", "failed"]),
      passedCaseCount: z.number().int().nonnegative(),
      testCaseCount: z.number().int().nonnegative(),
      privacyViolationCount: z.number().int().nonnegative(),
    }).passthrough(),
    browserConsoleLogCount: z.number().int().nonnegative(),
  }).passthrough(),
  providerBoundary: z.object({
    iflytekMode: z.enum(["mock", "live"]),
    semanticModelMode: z.string().min(1).max(120),
    machineOutputsRemain: z.literal("unverified_observation"),
  }).strict(),
  limitations: z.array(z.string().min(1).max(500)).min(1).max(12),
}).passthrough();

const screenshotManifestSchema = z.object({
  schemaVersion: z.literal("screenshot-manifest/1.0.0"),
  runId: z.string().min(1).max(120),
  status: z.literal("passed"),
  files: z.array(z.object({
    file: z.string().regex(
      /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}\.png$/u,
    ),
    bytes: z.number().int().positive(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  }).strict()).min(1).max(40),
}).strict();

const controlledAblationReportFileSchema = z.object({
  schemaVersion: GoldControlledAblationBundleSchema.shape.schemaVersion,
  bundleVersion: GoldControlledAblationBundleSchema.shape.bundleVersion,
  generatedAt: GoldControlledAblationBundleSchema.shape.generatedAt,
  modelBinding: GoldControlledAblationBundleSchema.shape.modelBinding,
  protocol: GoldControlledAblationBundleSchema.shape.protocol,
  report: GoldControlledAblationBundleSchema.shape.report,
  receipts: GoldControlledAblationBundleSchema.shape.receipts,
  claimBoundary: GoldControlledAblationBundleSchema.shape.claimBoundary,
  bundleHash: GoldControlledAblationBundleSchema.shape.bundleHash,
}).strict();

const controlledAblationConditionKeyFileSchema = z.object({
  mappingVersion: z.string().min(1).max(120),
  conditionKey: z.array(GoldBlindReviewConditionKeyEntrySchema).min(1),
  mappingHash: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();

interface LoadedJson<T> {
  data: T;
  bytes: Buffer;
  fileSha256: string;
}

interface LoadAttempt<T> {
  value: LoadedJson<T> | null;
  missing: boolean;
  rationale: string | null;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function resolveEvidencePath(evidenceDir: string, relativePath: string): string {
  if (
    isAbsolute(relativePath)
    || relativePath.split(/[\\/]/u).includes("..")
  ) {
    throw new Error("证据来源路径不是安全的包内相对路径");
  }
  const base = resolve(evidenceDir);
  const target = resolve(base, relativePath);
  const relation = relative(base, target);
  if (
    relation.startsWith("..")
    || isAbsolute(relation)
    || relation.length === 0
  ) {
    throw new Error("证据来源路径越出冻结工件目录");
  }
  return target;
}

async function readJson<T>(
  evidenceDir: string,
  relativePath: string,
  schema: ZodType<T>,
): Promise<LoadedJson<T>> {
  const bytes = await readFile(resolveEvidencePath(evidenceDir, relativePath));
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const raw: unknown = JSON.parse(text);
  return {
    data: schema.parse(raw),
    bytes,
    fileSha256: sha256(bytes),
  };
}

async function attemptJson<T>(
  evidenceDir: string,
  relativePath: string,
  schema: ZodType<T>,
): Promise<LoadAttempt<T>> {
  try {
    return {
      value: await readJson(evidenceDir, relativePath, schema),
      missing: false,
      rationale: null,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        value: null,
        missing: true,
        rationale: `未找到冻结工件 ${relativePath}。`,
      };
    }
    return {
      value: null,
      missing: false,
      rationale: `${relativePath} 的格式或完整性校验失败，已按失败关闭处理。`,
    };
  }
}

function sourceArtifact(input: {
  sourceId: GoldCompetitionSourceArtifact["sourceId"];
  label: string;
  relativePath: string;
  integrity: GoldCompetitionSourceArtifact["integrity"];
  loaded?: LoadedJson<unknown> | null;
  contentHash?: string | null;
  rationale: string;
}): GoldCompetitionSourceArtifact {
  return GoldCompetitionSourceArtifactSchema.parse({
    sourceId: input.sourceId,
    label: input.label,
    relativePath: input.relativePath,
    integrity: input.integrity,
    fileSha256: input.loaded?.fileSha256 ?? null,
    contentHash: input.contentHash ?? null,
    bytes: input.loaded?.bytes.byteLength ?? null,
    rationale: input.rationale,
  });
}

async function verifyManifest(
  evidenceDir: string,
  loaded: LoadedJson<GoldTechnicalEvidenceManifest>,
): Promise<void> {
  const { manifestHash, ...unsigned } = loaded.data;
  if (hashValue(unsigned) !== manifestHash) {
    throw new Error("技术证据 manifestHash 与规范化内容不一致");
  }
  for (const artifact of loaded.data.artifacts) {
    const bytes = await readFile(
      resolveEvidencePath(evidenceDir, artifact.path),
    );
    if (
      bytes.byteLength !== artifact.bytes
      || sha256(bytes) !== artifact.sha256
    ) {
      throw new Error(`技术证据工件 ${artifact.path} 与清单不一致`);
    }
  }
}

function verifyControlledAblation(
  bundle: GoldControlledAblationBundle,
  packet: z.infer<typeof GoldBlindReviewPacketSchema>,
  conditionKeyFile: z.infer<
    typeof controlledAblationConditionKeyFileSchema
  >,
): void {
  const { packetHash, ...packetUnsigned } = packet;
  if (hashValue(packetUnsigned) !== packetHash) {
    throw new Error("盲评包 packetHash 与规范化内容不一致");
  }
  if (hashValue(conditionKeyFile.conditionKey) !== conditionKeyFile.mappingHash) {
    throw new Error("消融条件键 mappingHash 与规范化内容不一致");
  }
  const { bundleHash, ...unsigned } = bundle;
  if (hashValue(unsigned) !== bundleHash) {
    throw new Error("受控消融 bundleHash 与规范化内容不一致");
  }
}

function verifyTransferProof(
  loaded: LoadedJson<GoldTransferConfigurationProof>,
): void {
  const { proofHash, ...unsigned } = loaded.data;
  if (hashValue(unsigned) !== proofHash) {
    throw new Error("迁移证明 proofHash 与规范化内容不一致");
  }
}

async function verifyScreenshots(
  evidenceDir: string,
  loaded: LoadedJson<z.infer<typeof screenshotManifestSchema>>,
): Promise<void> {
  const screenshotDirectory = goldenDemoScreenshotManifestPath
    .split("/")
    .slice(0, -1)
    .join("/");
  for (const screenshot of loaded.data.files) {
    const relativePath = `${screenshotDirectory}/${screenshot.file}`;
    const bytes = await readFile(
      resolveEvidencePath(evidenceDir, relativePath),
    );
    if (
      bytes.byteLength !== screenshot.bytes
      || sha256(bytes) !== screenshot.sha256
    ) {
      throw new Error(`演示截图 ${screenshot.file} 与冻结清单不一致`);
    }
  }
}

function createGoldenDemoEvidence(
  run: z.infer<typeof goldenDemoRunSchema>,
  screenshotCount: number,
): GoldCompetitionGoldenDemoEvidence {
  return GoldCompetitionGoldenDemoEvidenceSchema.parse({
    status: run.status,
    scenarioVersion: run.scenario.version,
    durationMs: run.timing.operatorToStudentReplayMs,
    minimumMs: run.timing.minimumMs,
    maximumMs: run.timing.maximumMs,
    withinTargetWindow: run.timing.pass,
    worldEventCount: run.result.worldEventCount,
    evidenceCount: run.result.evidenceCount,
    taskCount: run.result.taskCount,
    runCount: run.result.runCount,
    failureCount: run.result.failureCount,
    degradedCount: run.result.degradedCount,
    pendingCount: run.result.pendingCount,
    abnormalCount: run.result.abnormalCount,
    finalScore: run.result.finalScore,
    learningReplay: {
      status: run.result.learningReplay.status,
      passedCaseCount: run.result.learningReplay.passedCaseCount,
      testCaseCount: run.result.learningReplay.testCaseCount,
      privacyViolationCount:
        run.result.learningReplay.privacyViolationCount,
    },
    browserConsoleLogCount: run.result.browserConsoleLogCount,
    providerBoundary: run.providerBoundary,
    screenshotCount,
    screenshotsVerified: true,
    limitations: run.limitations,
  });
}

export async function loadGoldCompetitionEvidence(
  evidenceDir: string,
): Promise<GoldCompetitionLoadedEvidence> {
  const [
    manifestAttempt,
    demoRunAttempt,
    screenshotsAttempt,
    ablationAttempt,
    ablationBlindPacketAttempt,
    ablationConditionKeyAttempt,
    transferAttempt,
  ] = await Promise.all([
    attemptJson(
      evidenceDir,
      technicalManifestPath,
      GoldTechnicalEvidenceManifestSchema,
    ),
    attemptJson(evidenceDir, goldenDemoRunPath, goldenDemoRunSchema),
    attemptJson(
      evidenceDir,
      goldenDemoScreenshotManifestPath,
      screenshotManifestSchema,
    ),
    attemptJson(
      evidenceDir,
      controlledAblationPath,
      controlledAblationReportFileSchema,
    ),
    attemptJson(
      evidenceDir,
      controlledAblationBlindPacketPath,
      GoldBlindReviewPacketSchema,
    ),
    attemptJson(
      evidenceDir,
      controlledAblationConditionKeyPath,
      controlledAblationConditionKeyFileSchema,
    ),
    attemptJson(
      evidenceDir,
      transferProofPath,
      GoldTransferConfigurationProofSchema,
    ),
  ]);

  let technicalManifest: GoldTechnicalEvidenceManifest | null =
    manifestAttempt.value?.data ?? null;
  let manifestIntegrity: GoldCompetitionSourceArtifact["integrity"] =
    manifestAttempt.missing ? "missing" : "invalid";
  let manifestRationale = manifestAttempt.rationale
    ?? "技术证据根清单及其逐文件字节数、SHA-256 和规范化清单哈希均已复核。";
  if (manifestAttempt.value) {
    try {
      await verifyManifest(evidenceDir, manifestAttempt.value);
      manifestIntegrity = "verified";
    } catch {
      technicalManifest = null;
      manifestIntegrity = "invalid";
      manifestRationale =
        "技术证据根清单或其所列工件与冻结哈希不一致，已按失败关闭处理。";
    }
  }

  let controlledAblation: GoldControlledAblationBundle | null = null;
  let ablationIntegrity: GoldCompetitionSourceArtifact["integrity"] =
    ablationAttempt.missing ? "missing" : "invalid";
  let ablationRationale = ablationAttempt.rationale
    ?? "受控消融包通过严格契约与规范化 bundleHash 复核。";
  if (
    ablationAttempt.value
    && ablationBlindPacketAttempt.value
    && ablationConditionKeyAttempt.value
  ) {
    try {
      controlledAblation = GoldControlledAblationBundleSchema.parse({
        ...ablationAttempt.value.data,
        blindReviewPacket: ablationBlindPacketAttempt.value.data,
        conditionKey: ablationConditionKeyAttempt.value.data.conditionKey,
      });
      verifyControlledAblation(
        controlledAblation,
        ablationBlindPacketAttempt.value.data,
        ablationConditionKeyAttempt.value.data,
      );
      ablationIntegrity = "verified";
    } catch {
      controlledAblation = null;
      ablationIntegrity = "invalid";
      ablationRationale =
        "受控消融包与冻结 bundleHash 不一致，已按失败关闭处理。";
    }
  } else if (
    ablationAttempt.value
    && (
      ablationBlindPacketAttempt.missing
      || ablationConditionKeyAttempt.missing
    )
  ) {
    ablationIntegrity = "invalid";
    ablationRationale =
      "受控消融主报告存在，但盲评包或独立条件键缺失，无法重建冻结 bundleHash。";
  }

  let transferProof: GoldTransferConfigurationProof | null =
    transferAttempt.value?.data ?? null;
  let transferIntegrity: GoldCompetitionSourceArtifact["integrity"] =
    transferAttempt.missing ? "missing" : "invalid";
  let transferRationale = transferAttempt.rationale
    ?? "迁移证明通过严格契约与规范化 proofHash 复核。";
  if (transferAttempt.value) {
    try {
      verifyTransferProof(transferAttempt.value);
      transferIntegrity = "verified";
    } catch {
      transferProof = null;
      transferIntegrity = "invalid";
      transferRationale =
        "迁移证明与冻结 proofHash 不一致，已按失败关闭处理。";
    }
  }

  let screenshotIntegrity: GoldCompetitionSourceArtifact["integrity"] =
    screenshotsAttempt.missing ? "missing" : "invalid";
  let screenshotRationale = screenshotsAttempt.rationale
    ?? "截图清单与全部截图的字节数、SHA-256 均已逐文件复核。";
  let screenshotsValid = false;
  if (screenshotsAttempt.value) {
    try {
      await verifyScreenshots(evidenceDir, screenshotsAttempt.value);
      screenshotIntegrity = "verified";
      screenshotsValid = true;
    } catch {
      screenshotIntegrity = "invalid";
      screenshotRationale =
        "至少一张演示截图与冻结清单不一致，已按失败关闭处理。";
    }
  }

  let goldenDemo: GoldCompetitionGoldenDemoEvidence | null = null;
  let runIntegrity: GoldCompetitionSourceArtifact["integrity"] =
    demoRunAttempt.missing ? "missing" : "invalid";
  let runRationale = demoRunAttempt.rationale
    ?? "演示运行记录通过去标识投影契约，文件 SHA-256 已登记；原记录不具外部签名。";
  if (demoRunAttempt.value) {
    runIntegrity = "validated";
    if (
      screenshotsValid
      && screenshotsAttempt.value
      && screenshotsAttempt.value.data.runId ===
        demoRunAttempt.value.data.runId
    ) {
      try {
        goldenDemo = createGoldenDemoEvidence(
          demoRunAttempt.value.data,
          screenshotsAttempt.value.data.files.length,
        );
      } catch {
        runIntegrity = "invalid";
        runRationale =
          "演示运行状态与冻结时长、失败关闭、回放或截图门不一致，已按失败关闭处理。";
      }
    } else if (screenshotsValid) {
      screenshotIntegrity = "invalid";
      screenshotRationale =
        "截图清单与演示运行记录的关联标识不一致，已按失败关闭处理。";
    }
  }

  const sourceArtifacts = [
    sourceArtifact({
      sourceId: "technical_manifest",
      label: "技术证据根清单",
      relativePath: technicalManifestPath,
      integrity: manifestIntegrity,
      loaded: manifestAttempt.value,
      contentHash: technicalManifest?.manifestHash ?? null,
      rationale: manifestRationale,
    }),
    sourceArtifact({
      sourceId: "golden_demo_run",
      label: "正式黄金演示运行记录",
      relativePath: goldenDemoRunPath,
      integrity: runIntegrity,
      loaded: demoRunAttempt.value,
      contentHash: demoRunAttempt.value?.fileSha256 ?? null,
      rationale: runRationale,
    }),
    sourceArtifact({
      sourceId: "golden_demo_screenshots",
      label: "正式黄金演示截图清单",
      relativePath: goldenDemoScreenshotManifestPath,
      integrity: screenshotIntegrity,
      loaded: screenshotsAttempt.value,
      contentHash: screenshotsAttempt.value?.fileSha256 ?? null,
      rationale: screenshotRationale,
    }),
    sourceArtifact({
      sourceId: "controlled_ablation",
      label: "受控 Live A/B/C 消融包",
      relativePath: controlledAblationPath,
      integrity: ablationIntegrity,
      loaded: ablationAttempt.value,
      contentHash: controlledAblation?.bundleHash ?? null,
      rationale: ablationRationale,
    }),
    sourceArtifact({
      sourceId: "transfer_proof",
      label: "第二情境配置迁移证明",
      relativePath: transferProofPath,
      integrity: transferIntegrity,
      loaded: transferAttempt.value,
      contentHash: transferProof?.proofHash ?? null,
      rationale: transferRationale,
    }),
  ];

  return {
    sourceArtifacts,
    technicalManifest,
    goldenDemo,
    controlledAblation,
    transferProof,
  };
}

export type GoldCompetitionEvidenceLoader =
  () => Promise<GoldCompetitionLoadedEvidence>;

export function createGoldCompetitionEvidenceLoader(
  evidenceDir: string,
): GoldCompetitionEvidenceLoader {
  return () => loadGoldCompetitionEvidence(evidenceDir);
}
