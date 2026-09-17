import {
  GoldCompetitionReadinessSchemaVersion,
  GoldCompetitionReadinessSnapshotSchema,
  type AdapterHealth,
  type GoldBlindReviewWorkflowView,
  type GoldCompetitionEvidenceStatus,
  type GoldCompetitionGoldenDemoEvidence,
  type GoldCompetitionOfficialAlignment,
  type GoldCompetitionOfficialArtifact,
  type GoldCompetitionOfficialRequirement,
  type GoldCompetitionOfficialRequirementMatrix,
  type GoldCompetitionOfficialSourceRegistry,
  type GoldCompetitionReadinessSnapshot,
  type GoldCompetitionScorecard,
  type GoldCompetitionScorecardArtifact,
  type GoldCompetitionSourceArtifact,
  type GoldControlledAblationBundle,
  type GoldPilotReadinessWorkflowView,
  type GoldPilotWorkflowView,
  type GoldTechnicalEvidenceManifest,
  type GoldTransferConfigurationProof,
} from "@ronggang/contracts";
import { hashValue } from "@ronggang/context-engine";

export interface GoldCompetitionLoadedEvidence {
  sourceArtifacts: GoldCompetitionSourceArtifact[];
  technicalManifest: GoldTechnicalEvidenceManifest | null;
  goldenDemo: GoldCompetitionGoldenDemoEvidence | null;
  controlledAblation: GoldControlledAblationBundle | null;
  transferProof: GoldTransferConfigurationProof | null;
}

export interface GoldCompetitionLoadedOfficialEvidence {
  artifacts: GoldCompetitionOfficialArtifact[];
  registry: GoldCompetitionOfficialSourceRegistry | null;
  matrix: GoldCompetitionOfficialRequirementMatrix | null;
}

export interface GoldCompetitionLoadedScorecardEvidence {
  artifact: GoldCompetitionScorecardArtifact;
  scorecard: GoldCompetitionScorecard | null;
}

export interface CreateGoldCompetitionReadinessSnapshotInput {
  generatedAt: string;
  productVersion: string;
  evidence: GoldCompetitionLoadedEvidence;
  blindReview: GoldBlindReviewWorkflowView;
  pilotReadiness: GoldPilotReadinessWorkflowView;
  pilotStudy: GoldPilotWorkflowView;
  iflytekHealth: AdapterHealth;
  officialEvidence?: GoldCompetitionLoadedOfficialEvidence;
  scorecardEvidence?: GoldCompetitionLoadedScorecardEvidence;
}

function sourceById(
  evidence: GoldCompetitionLoadedEvidence,
  sourceId: GoldCompetitionSourceArtifact["sourceId"],
): GoldCompetitionSourceArtifact {
  const source = evidence.sourceArtifacts.find(
    (candidate) => candidate.sourceId === sourceId,
  );
  if (!source) {
    throw new Error(`国金总控输入缺少来源 ${sourceId}`);
  }
  return source;
}

function sourceEvidenceRef(source: GoldCompetitionSourceArtifact): string[] {
  if (!source.contentHash) return [];
  return [`${source.relativePath}#${source.contentHash}`];
}

function sourceFailureStatus(
  source: GoldCompetitionSourceArtifact,
): GoldCompetitionEvidenceStatus | null {
  if (source.integrity === "invalid") return "failed";
  if (source.integrity === "missing") return "unverified";
  return null;
}

function technicalImplementationStatus(
  evidence: GoldCompetitionLoadedEvidence,
): GoldCompetitionEvidenceStatus {
  const source = sourceById(evidence, "technical_manifest");
  const sourceStatus = sourceFailureStatus(source);
  if (sourceStatus) return sourceStatus;
  const manifest = evidence.technicalManifest;
  if (!manifest) return "unverified";
  const technical = manifest.gateSummary.technicalGates;
  const causal = manifest.gateSummary.causalClaims;
  if (technical.failed > 0 || causal.failed > 0) return "failed";
  if (
    technical.insufficient > 0
    || causal.insufficient > 0
    || technical.passed !== 10
    || causal.passed !== 5
  ) return "insufficient";
  return "passed";
}

function controlledAblationStatus(
  evidence: GoldCompetitionLoadedEvidence,
): GoldCompetitionEvidenceStatus {
  const source = sourceById(evidence, "controlled_ablation");
  const sourceStatus = sourceFailureStatus(source);
  if (sourceStatus) return sourceStatus;
  const bundle = evidence.controlledAblation;
  if (!bundle) return "unverified";
  if (
    bundle.report.conclusion === "engineering_contract_failed"
    || bundle.report.gates.some((gate) => gate.status === "failed")
  ) return "failed";
  if (
    bundle.report.conclusion === "insufficient_evidence"
    || bundle.report.gates.some((gate) => gate.status === "insufficient")
  ) return "insufficient";
  return "passed";
}

function newestByUpdatedAt<T extends { updatedAt: string }>(
  values: readonly T[],
): T | null {
  return [...values].sort(
    (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
  )[0] ?? null;
}

function evaluationValidity(
  workflow: GoldBlindReviewWorkflowView,
): {
  status: GoldCompetitionEvidenceStatus;
  evidenceRefs: string[];
  indicators: Array<{ label: string; value: string | number | boolean }>;
  adverseFinding: boolean;
  rationale: string;
} {
  const batch = newestByUpdatedAt(
    workflow.batches.filter((candidate) => candidate.unblindingReceipt),
  );
  const receipt = batch?.unblindingReceipt ?? null;
  if (!receipt) {
    return {
      status: "insufficient",
      evidenceRefs: [],
      indicators: [
        { label: "已解盲批次", value: 0 },
        { label: "冻结评审记录", value: 0 },
      ],
      adverseFinding: false,
      rationale: "尚无完成双人以上盲评、冻结与解盲的效度收据。",
    };
  }
  const statuses = [
    receipt.agreement.candidateDisposition.status,
    receipt.agreement.candidateAdoptionScore.status,
    receipt.agreement.responseQualityScore.status,
    receipt.modelExpertAssessment.meanAbsoluteErrorStatus,
    receipt.modelExpertAssessment.highRiskFalseNegativeStatus,
  ];
  const failed = statuses.filter((status) => status === "failed").length;
  const insufficient = statuses.filter(
    (status) => status === "insufficient",
  ).length;
  const status: GoldCompetitionEvidenceStatus = failed > 0
    ? "failed"
    : insufficient > 0
      ? "insufficient"
      : "passed";
  return {
    status,
    evidenceRefs: [
      `blind-review-freeze#${receipt.freezeReceiptHash}`,
      `blind-review-unblinding#${receipt.receiptHash}`,
    ],
    indicators: [
      { label: "评审人数", value: batch!.reviewerCount },
      { label: "盲评案例", value: batch!.caseCount },
      { label: "达标指标", value: statuses.length - failed - insufficient },
      { label: "未达指标", value: failed },
      { label: "证据不足指标", value: insufficient },
    ],
    adverseFinding: failed > 0,
    rationale: status === "passed"
      ? "盲评快照已先冻结后解盲，三项一致性与两项模型—专家门均达到预登记阈值。"
      : failed > 0
        ? "盲评已完成，但至少一项预登记效度门未达到，失败结果已保留。"
        : "盲评已完成，但仍有预登记指标因样本或可评估性不足而无法闭合。",
  };
}

function teachingPilot(
  readiness: GoldPilotReadinessWorkflowView,
  workflow: GoldPilotWorkflowView,
): {
  status: GoldCompetitionEvidenceStatus;
  evidenceRefs: string[];
  indicators: Array<{ label: string; value: string | number | boolean }>;
  adverseFinding: boolean;
  rationale: string;
} {
  const study = newestByUpdatedAt(
    workflow.studies.filter((candidate) => candidate.analysisReport),
  );
  const report = study?.analysisReport ?? null;
  const readinessPlan = newestByUpdatedAt(
    readiness.plans.filter((candidate) => candidate.freezeReceipt),
  );
  if (!report) {
    return {
      status: "insufficient",
      evidenceRefs: readinessPlan?.freezeReceipt
        ? [
            `pilot-readiness-freeze#${readinessPlan.freezeReceipt.receiptHash}`,
          ]
        : [],
      indicators: [
        {
          label: "采集口径冻结",
          value: readinessPlan?.freezeReceipt !== null
            && readinessPlan !== null,
        },
        { label: "描述性报告", value: false },
        { label: "完整配对", value: 0 },
      ],
      adverseFinding: false,
      rationale: readinessPlan
        ? "采集前口径已经冻结，但尚无基于完整配对且不插补的分析报告。"
        : "量规、等价任务、知情说明、同意与分组尚未形成冻结收据。",
    };
  }
  const status: GoldCompetitionEvidenceStatus =
    report.status === "target_ready_for_descriptive_comparison"
      ? "passed"
      : "insufficient";
  return {
    status,
    evidenceRefs: [
      `pilot-analysis#${report.reportHash}`,
      `pilot-design-binding#${report.designBinding.bindingHash}`,
    ],
    indicators: [
      {
        label: "教师数",
        value: report.participantFlow.registeredTeacherCount,
      },
      {
        label: "学生数",
        value: report.participantFlow.registeredParticipantCount,
      },
      {
        label: "完整配对",
        value: report.participantFlow.completePairCount,
      },
      {
        label: "纳入运行",
        value: report.participantFlow.analysisIncludedRunCount,
      },
      {
        label: "报告口径",
        value: report.analysisPlan.inferenceMode,
      },
    ],
    adverseFinding: (
      report.participantFlow.technicalFailureRunCount > 0
      || report.missingTargets.length > 0
    ),
    rationale: status === "passed"
      ? "真实试点达到冻结目标，报告仅纳入完整配对、拒绝插补并保持描述性比较边界。"
      : "已有不可变描述性报告，但教师数或完整配对数尚未达到冻结目标。",
  };
}

function transferabilityStatus(
  evidence: GoldCompetitionLoadedEvidence,
): GoldCompetitionEvidenceStatus {
  const source = sourceById(evidence, "transfer_proof");
  const sourceStatus = sourceFailureStatus(source);
  if (sourceStatus) return sourceStatus;
  return evidence.transferProof?.overallStatus ?? "unverified";
}

function goldenDemoStatus(
  evidence: GoldCompetitionLoadedEvidence,
): GoldCompetitionEvidenceStatus {
  const runSource = sourceById(evidence, "golden_demo_run");
  const screenshotSource = sourceById(evidence, "golden_demo_screenshots");
  const sourceStatuses = [
    sourceFailureStatus(runSource),
    sourceFailureStatus(screenshotSource),
  ].filter((status): status is GoldCompetitionEvidenceStatus => status !== null);
  if (sourceStatuses.includes("failed")) return "failed";
  if (sourceStatuses.includes("unverified")) return "unverified";
  return evidence.goldenDemo?.status ?? "unverified";
}

function missingOfficialArtifact(
  artifactId: GoldCompetitionOfficialArtifact["artifactId"],
  relativePath: string,
): GoldCompetitionOfficialArtifact {
  return {
    artifactId,
    label: artifactId === "source_registry"
      ? "当届官方来源登记"
      : "当届官方条款矩阵",
    relativePath,
    integrity: "missing",
    fileSha256: null,
    contentHash: null,
    bytes: null,
    rationale: `未找到官方对齐工件 ${relativePath}。`,
  };
}

function officialAlignment(
  evidence?: GoldCompetitionLoadedOfficialEvidence,
) {
  const fallbackArtifacts: GoldCompetitionOfficialArtifact[] = [
    missingOfficialArtifact(
      "source_registry",
      "official/source-registry.json",
    ),
    missingOfficialArtifact(
      "requirement_matrix",
      "official/requirement-matrix.json",
    ),
  ];
  const artifacts = evidence?.artifacts ?? fallbackArtifacts;
  const registry = evidence?.registry ?? null;
  const matrix = evidence?.matrix ?? null;
  const sources = registry?.sources ?? [];
  const requirements = matrix?.requirements ?? [];
  const countMapping = (
    status: GoldCompetitionOfficialRequirement["mappingStatus"],
  ) => requirements.filter(
    (requirement) => requirement.mappingStatus === status,
  ).length;
  const countEvidence = (status: GoldCompetitionEvidenceStatus) => (
    requirements.filter(
      (requirement) => requirement.evidenceStatus === status,
    ).length
  );
  const mappedRequirementCount = countMapping("mapped");
  const partialMappingCount = countMapping("partial");
  const unmappedRequirementCount = countMapping("unmapped");
  const passedRequirementCount = countEvidence("passed");
  const failedRequirementCount = countEvidence("failed");
  const insufficientRequirementCount = countEvidence("insufficient");
  const unverifiedRequirementCount = countEvidence("unverified");
  const blockingRequirementIds = requirements
    .filter((requirement) => (
      requirement.mappingStatus !== "mapped"
      || requirement.evidenceStatus !== "passed"
    ))
    .map((requirement) => requirement.requirementId);
  const invalidArtifact = artifacts.some(
    (artifact) => artifact.integrity === "invalid",
  );
  const allArtifactsVerified = artifacts.length === 2
    && artifacts.every((artifact) => artifact.integrity === "verified");
  const complete = registry !== null
    && matrix !== null
    && allArtifactsVerified;
  const allRequirementsPassed = requirements.length > 0
    && requirements.every((requirement) => (
      requirement.mappingStatus === "mapped"
      && requirement.evidenceStatus === "passed"
    ));
  const status: GoldCompetitionEvidenceStatus = invalidArtifact
    || failedRequirementCount > 0
    ? "failed"
    : complete && allRequirementsPassed
      ? "passed"
      : registry === null && matrix === null
        ? "unverified"
        : "insufficient";
  return {
    status,
    sourceCount: sources.length,
    sources,
    artifacts,
    registryHash: registry?.registryHash ?? null,
    matrixHash: matrix?.matrixHash ?? null,
    requirementCount: requirements.length,
    mappedRequirementCount,
    partialMappingCount,
    unmappedRequirementCount,
    passedRequirementCount,
    failedRequirementCount,
    insufficientRequirementCount,
    unverifiedRequirementCount,
    requirements,
    blockingRequirementIds,
    rationale: invalidArtifact
      ? "官方来源登记或条款矩阵完整性校验失败，已按失败关闭处理。"
      : !complete
        ? registry === null && matrix === null
          ? "当前仓库未形成可验证的当届官方来源登记与条款矩阵。"
          : "官方来源或条款矩阵不完整，不能把部分登记升级为官方对齐通过。"
        : allRequirementsPassed
          ? `当届双来源与 ${requirements.length} 条要求全部完成映射和证据闭环。`
          : `${requirements.length} 条当届要求均已进入矩阵；当前 ${passedRequirementCount} 项通过、${insufficientRequirementCount} 项证据不足、${unverifiedRequirementCount} 项待核验。`,
    claimBoundary: matrix?.claimBoundary
      ?? registry?.claimBoundary
      ?? "这里只确认官方材料的来源完整性与条款状态，不替代主办方最终资格审查。",
  };
}

function missingScorecardArtifact(): GoldCompetitionScorecardArtifact {
  return {
    artifactId: "official_scorecard",
    label: "XA-202603 官方30/50/20得分卡",
    relativePath: "official/scorecard.json",
    integrity: "missing",
    fileSha256: null,
    contentHash: null,
    bytes: null,
    rationale: "未找到官方得分卡工件 official/scorecard.json。",
  };
}

function officialScorecard(
  evidence: GoldCompetitionLoadedScorecardEvidence | undefined,
  official: GoldCompetitionOfficialAlignment,
) {
  const artifact = evidence?.artifact ?? missingScorecardArtifact();
  const scorecard = evidence?.scorecard ?? null;
  const items = scorecard?.items ?? [];
  const dimensions = scorecard?.dimensions ?? [];
  const countEvidence = (status: GoldCompetitionEvidenceStatus) => (
    items.filter((item) => item.evidenceStatus === status).length
  );
  const evidencePassedItemCount = countEvidence("passed");
  const evidenceFailedItemCount = countEvidence("failed");
  const evidenceInsufficientItemCount = countEvidence("insufficient");
  const evidenceUnverifiedItemCount = countEvidence("unverified");
  const evidenceReadyMaxScore = items
    .filter((item) => item.evidenceStatus === "passed")
    .reduce((sum, item) => sum + item.maxScore, 0);
  const scoredItems = items.filter(
    (item) => item.assessment.status === "frozen",
  );
  const materialBindings = items.flatMap((item) => item.materialBindings);
  const verifiedMaterialBindingCount = materialBindings.filter(
    (binding) => binding.status === "verified",
  ).length;
  const blockingItemIds = items
    .filter((item) => (
      item.evidenceStatus !== "passed"
      || item.assessment.status !== "frozen"
      || !item.materialBindings.every(
        (binding) => binding.status === "verified",
      )
    ))
    .map((item) => item.scoreItemId);
  const allItemsScored = items.length > 0
    && scoredItems.length === items.length;
  const independentMockScoreTotal = allItemsScored
    ? scoredItems.reduce(
        (sum, item) => sum + (item.assessment.score ?? 0),
        0,
      )
    : null;
  const bindingMismatch = scorecard !== null
    && (
      (
        official.registryHash !== null
        && scorecard.sourceRegistryHash !== official.registryHash
      )
      || (
        official.matrixHash !== null
        && scorecard.requirementMatrixHash !== official.matrixHash
      )
    );
  const bindingVerified = scorecard !== null
    && official.registryHash !== null
    && official.matrixHash !== null
    && scorecard.sourceRegistryHash === official.registryHash
    && scorecard.requirementMatrixHash === official.matrixHash;
  const complete = scorecard !== null
    && artifact.integrity === "verified"
    && bindingVerified;
  const status: GoldCompetitionEvidenceStatus =
    artifact.integrity === "invalid"
    || bindingMismatch
    || evidenceFailedItemCount > 0
      ? "failed"
      : scorecard === null
        ? "unverified"
        : complete && blockingItemIds.length === 0
          ? "passed"
          : "insufficient";

  return {
    status,
    artifact,
    scorecard,
    dimensionCount: dimensions.length,
    itemCount: items.length,
    evidencePassedItemCount,
    evidenceFailedItemCount,
    evidenceInsufficientItemCount,
    evidenceUnverifiedItemCount,
    evidenceReadyMaxScore,
    scoredItemCount: scoredItems.length,
    independentMockScoreTotal,
    materialBindingCount: materialBindings.length,
    verifiedMaterialBindingCount,
    blockingItemIds,
    rationale: artifact.integrity === "invalid"
      ? "官方得分卡格式、编码或规范哈希校验失败，已按失败关闭处理。"
      : bindingMismatch
        ? "官方得分卡没有绑定当前来源登记或条款矩阵，已按失败关闭处理。"
        : scorecard === null
          ? "当前仓库未形成可验证的XA-202603官方30/50/20得分卡。"
          : !bindingVerified
            ? "得分卡结构有效，但当前官方来源或条款矩阵不可验证，不能确认跨工件绑定。"
            : blockingItemIds.length === 0
              ? "六项评分的证据、独立模拟评审和正式材料定位均已闭合。"
              : `六项官方评分已固定；当前 ${evidencePassedItemCount} 项证据通过、${scoredItems.length} 项模拟评分冻结、${verifiedMaterialBindingCount} 个材料定位复核。`,
    claimBoundary: scorecard?.claimBoundary
      ?? "得分卡只组织官方权重、证据、模拟评审和材料定位，不产生发榜单位官方得分。",
  };
}

function iflytekFit(health: AdapterHealth) {
  const configuredCapabilityCount = health.capabilities.filter(
    (capability) => capability.configured,
  ).length;
  const availableCapabilityCount = health.capabilities.filter(
    (capability) => capability.available,
  ).length;
  const allLiveReady = health.mode === "live"
    && health.capabilities.length > 0
    && configuredCapabilityCount === health.capabilities.length
    && availableCapabilityCount === health.capabilities.length;
  return {
    status: health.mode === "mock"
      ? "unverified" as const
      : allLiveReady
        ? "passed" as const
        : "insufficient" as const,
    mode: health.mode,
    capabilityCount: health.capabilities.length,
    configuredCapabilityCount,
    availableCapabilityCount,
    rationale: health.mode === "mock"
      ? "当前适配器处于 mock 模式，只能证明接口与降级链可演示，不能声称讯飞 Live 已验证。"
      : allLiveReady
        ? "讯飞适配器处于 Live 模式，登记能力均已配置且当前可用。"
        : "讯飞适配器虽处于 Live 模式，但仍有能力未配置或不可用。",
    claimBoundary: "适配健康只证明运行时配置与可用性，不自动证明比赛资格、模型效果或生产 SLA。",
  };
}

export function createGoldCompetitionReadinessSnapshot(
  input: CreateGoldCompetitionReadinessSnapshotInput,
): GoldCompetitionReadinessSnapshot {
  const technicalSource = sourceById(
    input.evidence,
    "technical_manifest",
  );
  const demoRunSource = sourceById(input.evidence, "golden_demo_run");
  const demoScreenshotSource = sourceById(
    input.evidence,
    "golden_demo_screenshots",
  );
  const ablationSource = sourceById(
    input.evidence,
    "controlled_ablation",
  );
  const transferSource = sourceById(input.evidence, "transfer_proof");
  const implementationStatus = technicalImplementationStatus(input.evidence);
  const demoStatus = goldenDemoStatus(input.evidence);
  const ablationStatus = controlledAblationStatus(input.evidence);
  const evaluation = evaluationValidity(input.blindReview);
  const pilot = teachingPilot(input.pilotReadiness, input.pilotStudy);
  const transferStatus = transferabilityStatus(input.evidence);
  const official = officialAlignment(input.officialEvidence);
  const scorecard = officialScorecard(input.scorecardEvidence, official);
  const iflytek = iflytekFit(input.iflytekHealth);
  const ablation = input.evidence.controlledAblation;
  const ablationAdverse = ablation?.report.comparisons.some(
    (comparison) => comparison.status === "worse",
  ) ?? false;
  const demo = input.evidence.goldenDemo;
  const transfer = input.evidence.transferProof;

  const firstFiveStatuses = [
    demoStatus,
    ablationStatus,
    evaluation.status,
    pilot.status,
    transferStatus,
  ];
  const competitionPackageStatus: GoldCompetitionEvidenceStatus =
    firstFiveStatuses.some((status) => status === "failed")
      ? "failed"
      : firstFiveStatuses.every((status) => status === "passed")
        && official.status === "passed"
        && scorecard.status === "passed"
        && iflytek.status === "passed"
        ? "passed"
        : "insufficient";

  const deliverables = [
    {
      deliverableId: "golden_demo" as const,
      label: "8–12 分钟黄金演示",
      status: demoStatus,
      adverseFinding: demo?.status === "failed",
      evidenceRefs: [
        ...sourceEvidenceRef(demoRunSource),
        ...sourceEvidenceRef(demoScreenshotSource),
      ],
      indicators: demo
        ? [
            { label: "演示时长（秒）", value: demo.durationMs / 1_000 },
            { label: "截图数", value: demo.screenshotCount },
            { label: "失败运行", value: demo.failureCount },
            { label: "学习回放", value: demo.learningReplay.status },
            { label: "讯飞模式", value: demo.providerBoundary.iflytekMode },
          ]
        : [],
      rationale: demoStatus === "passed"
        ? "正式演示在冻结时窗内完成，截图逐文件校验，运行、回放与浏览器失败门均闭合。"
        : "正式演示记录缺失、无效或未通过冻结的时长与失败关闭门。",
      nextAction: demoStatus === "passed"
        ? "保留当前快照；接入 Live 服务后另起新证据版本，不覆盖本次 mock 边界。"
        : "重新执行正式计时演示并冻结运行记录、截图清单与逐文件哈希。",
      claimBoundary: demo
        ? `本项证明可复现展示链；当前讯飞为 ${demo.providerBoundary.iflytekMode}、语义模型为 ${demo.providerBoundary.semanticModelMode}，不替代真实学生成效或官方验收。`
        : "没有有效演示快照时不得声称黄金路径已经通过。",
    },
    {
      deliverableId: "controlled_ablation" as const,
      label: "A/B/C 受控消融",
      status: ablationStatus,
      adverseFinding: ablationAdverse,
      evidenceRefs: sourceEvidenceRef(ablationSource),
      indicators: ablation
        ? [
            { label: "受控观测", value: ablation.report.observationCount },
            {
              label: "严格改善指标",
              value: ablation.report.strictCoreImprovementCount,
            },
            {
              label: "未达或不足门",
              value: ablation.report.gates.filter(
                (gate) => gate.status !== "passed",
              ).length,
            },
            { label: "存在反向指标", value: ablationAdverse },
            { label: "模型模式", value: ablation.modelBinding.mode },
          ]
        : [],
      rationale: ablationStatus === "passed"
        ? "同条件受控运行达到预登记门槛，失败样本未插补。"
        : ablationAdverse
          ? "受控运行完整保留了反向指标，非劣性或严格改善门未闭合，因此不得声称完整架构全面优于基线。"
          : "受控运行尚未达到预登记的样本或效果门槛。",
      nextAction: "完成独立盲评并依据冻结协议复核非劣性、严格改善和反向指标。",
      claimBoundary: ablation?.report.claimBoundary
        ?? "没有有效受控消融快照时不得形成架构优越性主张。",
    },
    {
      deliverableId: "evaluation_validity" as const,
      label: "评价量规与模型效度",
      status: evaluation.status,
      adverseFinding: evaluation.adverseFinding,
      evidenceRefs: evaluation.evidenceRefs,
      indicators: evaluation.indicators,
      rationale: evaluation.rationale,
      nextAction: evaluation.status === "passed"
        ? "保留冻结收据，并在新模型或新量规版本出现时重新盲评。"
        : "由至少两名专家完成独立盲评，冻结后解盲并处理所有未达阈值指标。",
      claimBoundary: "一致性与模型—专家门只支持评价口径效度，不等于学生学习成效或教师终评被模型替代。",
    },
    {
      deliverableId: "teaching_pilot" as const,
      label: "真实教学试点与描述性分析",
      status: pilot.status,
      adverseFinding: pilot.adverseFinding,
      evidenceRefs: pilot.evidenceRefs,
      indicators: pilot.indicators,
      rationale: pilot.rationale,
      nextAction: pilot.status === "passed"
        ? "在冻结边界内解读配对差异，并由评审决定是否需要扩大样本或预登记推断研究。"
        : "完成至少 3 名教师、20 个完整学生配对的采集，并冻结无插补描述性报告。",
      claimBoundary: "试点报告只允许完整配对、无插补的描述性比较；未预登记推断检验时不得声称因果提升。",
    },
    {
      deliverableId: "transferability" as const,
      label: "第二情境配置迁移",
      status: transferStatus,
      adverseFinding: transferStatus === "failed",
      evidenceRefs: sourceEvidenceRef(transferSource),
      indicators: transfer
        ? [
            {
              label: "架构校验",
              value: transfer.architectureStatus,
            },
            {
              label: "前瞻工时（分钟）",
              value: transfer.authoringTime.observedMinutes ?? "未观测",
            },
            {
              label: "题材内核扫描",
              value: transfer.forbiddenRuntimeScan.status,
            },
          ]
        : [],
      rationale: transferStatus === "passed"
        ? "第二情境通过通用配置、结构校验、受限内核扫描和前瞻工时门。"
        : "迁移证明缺失、无效或仍有结构与前瞻工时门未闭合。",
      nextAction: transferStatus === "passed"
        ? "保持证据快照不可变，并在第三类题材迁移时复用同一验证协议。"
        : "从冻结模板起点重新计时，完成配置、发布、烟测和受限内核扫描。",
      claimBoundary: transfer?.claimBoundary
        ?? "没有有效迁移证明时不得声称平台可配置迁移。",
    },
    {
      deliverableId: "competition_package" as const,
      label: "参赛材料与官方口径闭环",
      status: competitionPackageStatus,
      adverseFinding: competitionPackageStatus === "failed",
      evidenceRefs: [
        ...sourceEvidenceRef(technicalSource),
        ...official.sources.map(
          (source) => `${source.url}#${source.contentHash}`,
        ),
        ...(
          scorecard.artifact.contentHash
            ? [
                `${scorecard.artifact.relativePath}#${scorecard.artifact.contentHash}`,
              ]
            : []
        ),
      ],
      indicators: [
        { label: "冻结工件", value: input.evidence.sourceArtifacts.length },
        { label: "官方来源", value: official.sourceCount },
        {
          label: "官方条款通过",
          value:
            `${official.passedRequirementCount}/${official.requirementCount}`,
        },
        {
          label: "官方阻断项",
          value: official.blockingRequirementIds.length,
        },
        {
          label: "得分卡证据通过",
          value:
            `${scorecard.evidencePassedItemCount}/${scorecard.itemCount}`,
        },
        {
          label: "证据就绪权重",
          value: `${scorecard.evidenceReadyMaxScore}/100`,
        },
        {
          label: "模拟评分冻结",
          value: `${scorecard.scoredItemCount}/${scorecard.itemCount}`,
        },
        {
          label: "材料定位复核",
          value:
            `${scorecard.verifiedMaterialBindingCount}/${scorecard.materialBindingCount}`,
        },
        { label: "讯飞模式", value: iflytek.mode },
        {
          label: "前五类通过",
          value: firstFiveStatuses.filter((status) => status === "passed")
            .length,
        },
      ],
      rationale: competitionPackageStatus === "passed"
        ? "六类成果、官方材料对齐、六项得分卡与讯飞 Live 适配均已形成可哈希证据。"
        : "当前可形成展示型原型证据包；当届来源、条款映射和30/50/20得分卡结构已经冻结，但报名回执、评分证据、独立模拟评审、材料页码、讯飞交付或前置实证成果仍未全部关闭。",
      nextAction: "优先确认报名审核回执，再补齐50条权威知识与真实用户反馈，把六项证据写入正式材料页码并组织独立模拟评审。",
      claimBoundary: "当前总控台是参赛证据索引与失败边界，不等于主办方已确认资格，也不替代最终申报包。",
    },
  ];

  const coreClaims = [
    {
      claimId: "dual_dimension_professional_world" as const,
      label: "课程平台 × 职业世界双维度连续运行",
      implementationStatus,
      empiricalStatus: pilot.status,
      evidenceRefs: [
        ...sourceEvidenceRef(technicalSource),
        ...pilot.evidenceRefs,
      ],
      rationale: "工程门验证同一权威世界、双界面行动与职业后果链；真实效果只能由冻结试点报告支持。",
      allowedClaim: "可以声称原型已实现同一权威状态下的课程操作与职业世界连续体验。",
      forbiddenClaim: "在真实试点未闭合前，不得声称双维度设计已显著提升学习成效。",
    },
    {
      claimId: "private_view_event_driven_agents" as const,
      label: "岗位私有视野 × 事件驱动智能体",
      implementationStatus,
      empiricalStatus: ablationStatus,
      evidenceRefs: [
        ...sourceEvidenceRef(technicalSource),
        ...sourceEvidenceRef(ablationSource),
      ],
      rationale: ablationAdverse
        ? "职责分离、私有视野、受影响集合与权威写入门已实现；受控运行同时出现反向指标，优越性主张必须收缩。"
        : "工程合同证明架构行为存在，受控消融决定其比较性价值是否成立。",
      allowedClaim: "可以声称原型具备岗位私有视野、受影响集合调度与权威世界写入门。",
      forbiddenClaim: "在非劣性和严格改善门未闭合前，不得声称完整架构在所有核心指标上优于基线。",
    },
    {
      claimId: "evidence_based_teacher_review" as const,
      label: "证据链 × 教师终评",
      implementationStatus,
      empiricalStatus: evaluation.status,
      evidenceRefs: [
        ...sourceEvidenceRef(technicalSource),
        ...evaluation.evidenceRefs,
      ],
      rationale: "工程链保留来源、建议、仲裁与教师终评；独立盲评决定量规一致性和模型—专家适配度。",
      allowedClaim: "可以声称模型建议可追踪、教师拥有最终裁决权，且结果可按哈希复核。",
      forbiddenClaim: "在盲评效度门未闭合前，不得声称模型评分等同专家评分或可替代教师。",
    },
  ];

  const countStatus = (status: GoldCompetitionEvidenceStatus) => (
    deliverables.filter((deliverable) => deliverable.status === status).length
  );
  const failedDeliverableCount = countStatus("failed");
  const passedDeliverableCount = countStatus("passed");
  const insufficientDeliverableCount = countStatus("insufficient");
  const unverifiedDeliverableCount = countStatus("unverified");
  const overallStatus: GoldCompetitionEvidenceStatus =
    failedDeliverableCount > 0
      ? "failed"
      : passedDeliverableCount === deliverables.length
        ? "passed"
        : unverifiedDeliverableCount === deliverables.length
          ? "unverified"
          : "insufficient";

  const unsigned = {
    schemaVersion: GoldCompetitionReadinessSchemaVersion,
    generatedAt: input.generatedAt,
    productVersion: input.productVersion,
    evidenceSourceGitCommit:
      input.evidence.technicalManifest?.sourceGitCommit ?? null,
    sourceArtifacts: input.evidence.sourceArtifacts,
    goldenDemo: input.evidence.goldenDemo,
    coreClaims,
    deliverables,
    officialAlignment: official,
    officialScorecard: scorecard,
    iflytekFit: iflytek,
    summary: {
      overallStatus,
      passedDeliverableCount,
      failedDeliverableCount,
      insufficientDeliverableCount,
      unverifiedDeliverableCount,
      readyForCompetitionClaim: overallStatus === "passed",
      blockingDeliverableIds: deliverables
        .filter((deliverable) => deliverable.status !== "passed")
        .map((deliverable) => deliverable.deliverableId),
    },
    claimBoundary: "本快照只聚合已验证工件、动态盲评/试点收据、官方来源、30/50/20得分卡和讯飞健康状态；任何 missing、invalid、insufficient 或 unverified 项都阻止完整参赛就绪主张。证据就绪权重与独立模拟评分都不是发榜单位官方得分，工程通过不替代真实模型效果、教学成效、赛事资格或生产安全结论。",
  };

  return GoldCompetitionReadinessSnapshotSchema.parse({
    ...unsigned,
    snapshotHash: hashValue(unsigned),
  });
}
