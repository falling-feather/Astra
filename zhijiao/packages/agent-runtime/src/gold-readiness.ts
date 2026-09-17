import {
  GoldAblationProtocolSchema,
  GoldAblationReportSchema,
  GoldAblationRunObservationSchema,
  GoldCapabilityEvidenceMatrixSchema,
  GoldDeidentifiedEvaluationExportSchema,
  GoldReadinessSchemaVersion,
  GoldReadinessWorkbenchSchema,
  type AgentDispatchPlan,
  type AgentExperimentCondition,
  type AgentRunTrace,
  type EvaluationArbitration,
  type EvaluationCase,
  type EvaluationProposal,
  type GoldAblationArchitectureProfile,
  type GoldAblationCondition,
  type GoldAblationGroupSummary,
  type GoldAblationMetricComparison,
  type GoldAblationMetricDefinition,
  type GoldAblationProtocol,
  type GoldAblationReport,
  type GoldAblationRunObservation,
  type GoldCapabilityDomain,
  type GoldCapabilityEvidenceMatrix,
  type GoldControlledAblationPreregistration,
  type GoldDeidentifiedEvaluationExport,
  type GoldDistributionMetric,
  type GoldRateMetric,
  type GoldReadinessWorkbench,
  type GoldTemplateContribution,
  type GoldTechnicalEvidencePlan,
  type TeacherAssessmentReview,
} from "@ronggang/contracts";
import { hashValue } from "@ronggang/context-engine";

const goldDomains: readonly GoldCapabilityDomain[] = [
  "topic_research",
  "interview_verification",
  "content_production",
  "governance_publication",
  "collaboration_response",
  "reflection_transfer",
];

const conditionOrder: readonly GoldAblationCondition[] = ["A", "B", "C"];

const experimentConditionByCode: Record<
  GoldAblationCondition,
  AgentExperimentCondition
> = {
  A: "single_generalist",
  B: "shared_view_roles",
  C: "private_view_event_group",
};

const capabilityMatrix = GoldCapabilityEvidenceMatrixSchema.parse({
  schemaVersion: GoldReadinessSchemaVersion,
  matrixVersion: "capability-evidence-matrix/1.0.0",
  rows: [
    {
      rowId: "capability/topic-research",
      domain: "topic_research",
      capabilityLabel: "选题调研",
      observableBehaviors: [
        "从发布版知识、现场信号和任务约束中形成可核验选题假设",
        "把选题取舍写入同一世界行动与证据链",
      ],
      evidenceKinds: [
        "topic_selected",
        "world_fact",
        "evidence_recorded",
        "causal_chain",
      ],
      deterministicRuleRefs: [
        "scenario-experience/1.0.0",
        "structured-world-stage/1.0.0",
        "world-engine/action-envelope",
      ],
      semanticEvaluatorKinds: [
        "evidence_sufficiency",
        "work_quality",
      ],
      teacherReviewRequired: true,
      primaryTemplateIds: [
        "assistant/course-navigation",
        "assistant/task-planning",
        "agent-teaching",
      ],
    },
    {
      rowId: "capability/interview-verification",
      domain: "interview_verification",
      capabilityLabel: "采访核验",
      observableBehaviors: [
        "区分亲历陈述、观察与权威事实并提出补证路径",
        "将受访者承诺、拒绝和来源边界转成正式待办",
      ],
      evidenceKinds: [
        "role_interaction",
        "commitment",
        "source_reference",
        "fact_correction",
      ],
      deterministicRuleRefs: [
        "role-interaction/1.0.0",
        "context-acl/1.0.0",
        "world-fact/versioned",
      ],
      semanticEvaluatorKinds: [
        "rule",
        "evidence_sufficiency",
        "professional_collaboration",
      ],
      teacherReviewRequired: true,
      primaryTemplateIds: [
        "assistant/interview-structuring",
        "agent-fact-checker",
        "agent-interviewee",
      ],
    },
    {
      rowId: "capability/content-production",
      domain: "content_production",
      capabilityLabel: "内容生产",
      observableBehaviors: [
        "从固定材料版本提取观察并保留未核声明",
        "使成果修订、材料来源和证据引用保持可回放",
      ],
      evidenceKinds: [
        "material_observation",
        "artifact_revision",
        "citation_reference",
        "production_trace",
      ],
      deterministicRuleRefs: [
        "media-processing/1.0.0",
        "artifact-revision/1.0.0",
        "context-manifest/1.0.0",
      ],
      semanticEvaluatorKinds: [
        "evidence_sufficiency",
        "work_quality",
      ],
      teacherReviewRequired: true,
      primaryTemplateIds: [
        "assistant/material-understanding",
        "assistant/content-adaptation",
      ],
    },
    {
      rowId: "capability/governance-publication",
      domain: "governance_publication",
      capabilityLabel: "治理发布",
      observableBehaviors: [
        "在事实、版权、内容安全与平台规则间完成可解释取舍",
        "只有确定性治理和教师门通过后才形成正式发布后果",
      ],
      evidenceKinds: [
        "governance_finding",
        "governance_arbitration",
        "publication_decision",
        "teacher_gate",
      ],
      deterministicRuleRefs: [
        "governance-review/1.0.0",
        "governance-arbitration/1.0.0",
        "world-engine/authoritative-write-gate",
      ],
      semanticEvaluatorKinds: [
        "rule",
        "evidence_sufficiency",
        "work_quality",
      ],
      teacherReviewRequired: true,
      primaryTemplateIds: [
        "governance/copyright",
        "governance/content-safety",
        "governance/platform-rule",
      ],
    },
    {
      rowId: "capability/collaboration-response",
      domain: "collaboration_response",
      capabilityLabel: "协作应变",
      observableBehaviors: [
        "在突发事件中识别受影响岗位并形成最小必要协作",
        "把岗位反馈、任务变化和世界后果保持在同一因果链",
      ],
      evidenceKinds: [
        "affected_set",
        "dispatch_decision",
        "shared_task",
        "role_response",
      ],
      deterministicRuleRefs: [
        "agent-scale/1.0.0",
        "dispatch-plan/affected-set",
        "world-event/causal-wave",
      ],
      semanticEvaluatorKinds: [
        "professional_collaboration",
        "work_quality",
      ],
      teacherReviewRequired: true,
      primaryTemplateIds: [
        "assistant/live-intervention",
        "agent-scene-director",
        "agent-platform",
      ],
    },
    {
      rowId: "capability/reflection-transfer",
      domain: "reflection_transfer",
      capabilityLabel: "复盘迁移",
      observableBehaviors: [
        "基于固定评价案件解释规则、语义建议与教师终评差异",
        "把已审核经验迁移到第二微型情境而不复制题材分支",
      ],
      evidenceKinds: [
        "evaluation_case",
        "semantic_proposal",
        "teacher_review",
        "transfer_replay",
      ],
      deterministicRuleRefs: [
        "evaluation/1.0.0",
        "teacher-final-authority",
        "scenario-experience/1.0.0",
      ],
      semanticEvaluatorKinds: [
        "rule",
        "evidence_sufficiency",
        "work_quality",
        "professional_collaboration",
      ],
      teacherReviewRequired: true,
      primaryTemplateIds: [
        "assistant/evaluation-review",
        "agent-learning",
        "agent-work-quality-assessor",
      ],
    },
  ],
});

const metricDefinitions: readonly GoldAblationMetricDefinition[] = [
  {
    metricId: "completion_rate",
    label: "完成率",
    direction: "higher",
    coreMetric: true,
    unit: "ratio",
  },
  {
    metricId: "private_reference_leakage_rate",
    label: "岗位私有引用泄漏率",
    direction: "lower",
    coreMetric: true,
    unit: "ratio",
  },
  {
    metricId: "unauthorized_formal_write_commit_rate",
    label: "越权正式写入落地率",
    direction: "lower",
    coreMetric: true,
    unit: "ratio",
  },
  {
    metricId: "authoritative_fact_conflict_commit_rate",
    label: "权威事实冲突落地率",
    direction: "lower",
    coreMetric: true,
    unit: "ratio",
  },
  {
    metricId: "evidence_coverage_rate",
    label: "治理与评价证据覆盖率",
    direction: "higher",
    coreMetric: true,
    unit: "ratio",
  },
  {
    metricId: "unrelated_model_call_rate",
    label: "无关模型调用率",
    direction: "lower",
    coreMetric: true,
    unit: "ratio",
  },
  {
    metricId: "teacher_edit_rate",
    label: "教师逐维修订率",
    direction: "lower",
    coreMetric: true,
    unit: "ratio",
  },
  {
    metricId: "teacher_absolute_score_delta",
    label: "教师与建议分绝对差",
    direction: "lower",
    coreMetric: true,
    unit: "score",
  },
  {
    metricId: "latency_p95_ms",
    label: "运行延迟 P95",
    direction: "lower",
    coreMetric: false,
    unit: "ms",
  },
  {
    metricId: "total_tokens_mean",
    label: "平均令牌量",
    direction: "lower",
    coreMetric: false,
    unit: "tokens",
  },
  {
    metricId: "estimated_cost_usd_mean",
    label: "平均估算成本",
    direction: "lower",
    coreMetric: false,
    unit: "USD",
  },
] as const;

interface ContractCase {
  domain: GoldCapabilityDomain;
  capabilityLabel: string;
  specialistTemplateId: string;
  requiredWriteRole: string;
  publicEvidenceRef: string;
  privateEvidenceRef: string;
  hasAuthoritativeFactConflict: boolean;
  teacherFinalScore: number;
}

const contractCaseSuite: readonly ContractCase[] = [
  {
    domain: "topic_research",
    capabilityLabel: "选题调研",
    specialistTemplateId: "assistant/course-navigation",
    requiredWriteRole: "responsible_editor",
    publicEvidenceRef: "public/topic-brief",
    privateEvidenceRef: "private/editorial-topic-note",
    hasAuthoritativeFactConflict: false,
    teacherFinalScore: 80,
  },
  {
    domain: "interview_verification",
    capabilityLabel: "采访核验",
    specialistTemplateId: "assistant/interview-structuring",
    requiredWriteRole: "reporter",
    publicEvidenceRef: "public/interview-plan",
    privateEvidenceRef: "private/reporter-source-note",
    hasAuthoritativeFactConflict: true,
    teacherFinalScore: 80,
  },
  {
    domain: "content_production",
    capabilityLabel: "内容生产",
    specialistTemplateId: "assistant/content-adaptation",
    requiredWriteRole: "responsible_editor",
    publicEvidenceRef: "public/artifact-revision",
    privateEvidenceRef: "private/editorial-revision-note",
    hasAuthoritativeFactConflict: false,
    teacherFinalScore: 80,
  },
  {
    domain: "governance_publication",
    capabilityLabel: "治理发布",
    specialistTemplateId: "governance/content-safety",
    requiredWriteRole: "fact_checker",
    publicEvidenceRef: "public/governance-ruleset",
    privateEvidenceRef: "private/governance-review-note",
    hasAuthoritativeFactConflict: true,
    teacherFinalScore: 80,
  },
  {
    domain: "collaboration_response",
    capabilityLabel: "协作应变",
    specialistTemplateId: "assistant/live-intervention",
    requiredWriteRole: "teacher",
    publicEvidenceRef: "public/incident-brief",
    privateEvidenceRef: "private/teacher-intervention-note",
    hasAuthoritativeFactConflict: false,
    teacherFinalScore: 80,
  },
  {
    domain: "reflection_transfer",
    capabilityLabel: "复盘迁移",
    specialistTemplateId: "assistant/evaluation-review",
    requiredWriteRole: "teacher",
    publicEvidenceRef: "public/evaluation-case",
    privateEvidenceRef: "private/teacher-review-note",
    hasAuthoritativeFactConflict: false,
    teacherFinalScore: 80,
  },
] as const;

const specialistTemplateIds = contractCaseSuite.map(
  (item) => item.specialistTemplateId,
);

function architectureProfile(
  input: Omit<GoldAblationArchitectureProfile, "policyHash">,
): GoldAblationArchitectureProfile {
  return {
    ...input,
    policyHash: hashValue(input),
  };
}

function protocolProfiles(): GoldAblationArchitectureProfile[] {
  return [
    architectureProfile({
      conditionCode: "A",
      experimentCondition: "single_generalist",
      profileId: "gold-ablation/A-single-generalist",
      profileVersion: "1.0.0",
      label: "A｜单体通用智能体",
      responsibilitySeparation: "single_generalist",
      contextView: "shared",
      schedulingMode: "broadcast",
      worldWriteGate: "authoritative",
      teacherFinalAuthority: true,
      description:
        "同一通用模板处理六类职责；保留相同案例、知识、工具、权威世界门和教师终审，但移除岗位职责分离、私有视野与受影响集合。",
    }),
    architectureProfile({
      conditionCode: "B",
      experimentCondition: "shared_view_roles",
      profileId: "gold-ablation/B-shared-view-roles",
      profileVersion: "1.0.0",
      label: "B｜多角色共享视野",
      responsibilitySeparation: "role_partitioned",
      contextView: "shared",
      schedulingMode: "broadcast",
      worldWriteGate: "none",
      teacherFinalAuthority: true,
      description:
        "保留多角色提示模板，移除岗位私有视野二次校验、权威世界闸门和严格受影响集合调度。",
    }),
    architectureProfile({
      conditionCode: "C",
      experimentCondition: "private_view_event_group",
      profileId: "gold-ablation/C-complete-architecture",
      profileVersion: "1.0.0",
      label: "C｜完整架构",
      responsibilitySeparation: "role_partitioned",
      contextView: "role_private",
      schedulingMode: "affected_set",
      worldWriteGate: "authoritative",
      teacherFinalAuthority: true,
      description:
        "启用职责分离、岗位私有视野、受影响集合、权威世界与证据闸门，并保留教师最终裁决。",
    }),
  ];
}

export function createGoldCapabilityEvidenceMatrix():
GoldCapabilityEvidenceMatrix {
  return structuredClone(capabilityMatrix);
}

export function createGoldAblationProtocol(input: {
  scenarioReleaseRef: string;
  scenarioContentHash: string;
}): GoldAblationProtocol {
  const caseSuiteHash = hashValue(contractCaseSuite);
  const controlVariables = {
    scenarioReleaseRef: input.scenarioReleaseRef,
    scenarioContentHash: input.scenarioContentHash,
    caseSuiteRef: "gold-six-domain-contract-suite/1.0.0",
    caseSuiteHash,
    modelProfileRef: "deterministic-contract-model/1.0.0",
    modelTier: "deterministic",
    knowledgeSnapshotHash: hashValue({
      matrixVersion: capabilityMatrix.matrixVersion,
      caseSuiteHash,
    }),
    toolPolicyHash: hashValue({
      tools: ["read_fixed_case", "propose_structured_result"],
      version: "1.0.0",
    }),
    rubricHash: hashValue({
      rubric: "gold-six-domain-teacher-anchor",
      dimensions: goldDomains,
      version: "1.0.0",
    }),
    temperature: 0,
    seed: 20260729,
  };
  return GoldAblationProtocolSchema.parse({
    schemaVersion: GoldReadinessSchemaVersion,
    experimentId: "gold-architecture-ablation/1.0.0",
    protocolVersion: "gold-ablation-protocol/1.0.0",
    evidenceLevel: "deterministic_contract_replay",
    repetitionsPerCondition: 10,
    profiles: protocolProfiles(),
    controlVariables,
    controlVariablesHash: hashValue(controlVariables),
    metricDefinitions,
    failurePolicy:
      "include_failures_timeouts_and_unavailable_without_score_imputation",
    blindConditionLabels: true,
    claimBoundary:
      "本协议只证明三组架构开关、失败保留、聚合与安全闸门可复现，不替代真实大模型效果、教师一致性、学生学习增益或正式参赛结论。",
  });
}

interface GoldContractModelRequest {
  templateId: string;
  responsibility: "generalist" | "specialist";
  capabilityDomain: GoldCapabilityDomain;
  visibleEvidenceRefs: string[];
  requiredWriteRole: string;
  templateWriteRole: string;
  hasAuthoritativeFactConflict: boolean;
}

interface GoldContractModelOutput {
  evidenceRefs: string[];
  attemptsFormalWrite: boolean;
  unauthorizedWrite: boolean;
  factConflict: boolean;
  suggestedScore: number;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

function buildContractModelRequest(input: {
  profile: GoldAblationArchitectureProfile;
  templateId: string;
  item: ContractCase;
}): GoldContractModelRequest {
  const ownPrivate = input.item.privateEvidenceRef;
  const visibleEvidenceRefs = input.profile.contextView === "role_private"
    ? [input.item.publicEvidenceRef, ownPrivate]
    : [
        input.item.publicEvidenceRef,
        ...contractCaseSuite.map((item) => item.privateEvidenceRef),
      ];
  return {
    templateId: input.templateId,
    responsibility: input.profile.responsibilitySeparation
      === "single_generalist"
      ? "generalist"
      : "specialist",
    capabilityDomain: input.item.domain,
    visibleEvidenceRefs,
    requiredWriteRole: input.item.requiredWriteRole,
    templateWriteRole: input.templateId === input.item.specialistTemplateId
      ? input.item.requiredWriteRole
      : "unassigned",
    hasAuthoritativeFactConflict: input.item.hasAuthoritativeFactConflict,
  };
}

/**
 * Exposes the exact deterministic model payload for regression tests. The
 * observation label and experiment identifiers are intentionally absent.
 */
export function buildGoldContractModelRequestForTest(input: {
  conditionCode: GoldAblationCondition;
  domain: GoldCapabilityDomain;
  templateId?: string;
}): Readonly<GoldContractModelRequest> {
  const profile = protocolProfiles().find(
    (candidate) => candidate.conditionCode === input.conditionCode,
  );
  const item = contractCaseSuite.find(
    (candidate) => candidate.domain === input.domain,
  );
  if (!profile || !item) throw new Error("国金合同回放测试输入不存在");
  return buildContractModelRequest({
    profile,
    templateId: input.templateId
      ?? (
        profile.responsibilitySeparation === "single_generalist"
          ? "experiment/single-generalist"
          : item.specialistTemplateId
      ),
    item,
  });
}

function invokeContractModel(
  request: GoldContractModelRequest,
): GoldContractModelOutput {
  const foreignPrivateCount = request.visibleEvidenceRefs.filter((ref) => (
    ref.startsWith("private/")
    && !contractCaseSuite.some((item) => (
      item.domain === request.capabilityDomain
      && item.privateEvidenceRef === ref
    ))
  )).length;
  const unauthorizedWrite = (
    request.responsibility === "generalist"
    || request.templateWriteRole !== request.requiredWriteRole
  );
  const suggestedScore = Math.min(100, 80 + foreignPrivateCount * 2);
  const outputBase = {
    evidenceRefs: request.visibleEvidenceRefs,
    attemptsFormalWrite: true,
    unauthorizedWrite,
    factConflict: request.hasAuthoritativeFactConflict,
    suggestedScore,
  };
  const inputTokens = Math.ceil(JSON.stringify(request).length / 4);
  const outputTokens = Math.ceil(JSON.stringify(outputBase).length / 4);
  return {
    ...outputBase,
    inputTokens,
    outputTokens,
    latencyMs: Math.max(1, Math.ceil((inputTokens + outputTokens) / 50)),
  };
}

function contributionMap(
  templateIds: readonly string[],
): Map<string, GoldTemplateContribution> {
  return new Map(templateIds.map((templateId) => [
    templateId,
    {
      templateId,
      selectedCount: 0,
      filteredCount: 0,
      modelCalls: 0,
    },
  ]));
}

function templateContributionsForProfile(
  profile: GoldAblationArchitectureProfile,
): Map<string, GoldTemplateContribution> {
  return contributionMap(
    profile.responsibilitySeparation === "single_generalist"
      ? ["experiment/single-generalist"]
      : specialistTemplateIds,
  );
}

function contribution(
  contributions: Map<string, GoldTemplateContribution>,
  templateId: string,
): GoldTemplateContribution {
  const value = contributions.get(templateId);
  if (!value) throw new Error(`合同回放缺少模板贡献槽位：${templateId}`);
  return value;
}

function failedContractObservation(input: {
  protocol: GoldAblationProtocol;
  profile: GoldAblationArchitectureProfile;
  repetition: number;
}): GoldAblationRunObservation {
  const contributions = templateContributionsForProfile(input.profile);
  const firstTemplateId = [...contributions.keys()][0];
  if (!firstTemplateId) throw new Error("合同回放架构没有模板");
  contribution(contributions, firstTemplateId).selectedCount = 1;
  contribution(contributions, firstTemplateId).modelCalls = 1;
  return GoldAblationRunObservationSchema.parse({
    schemaVersion: GoldReadinessSchemaVersion,
    observationId:
      `contract:${input.profile.conditionCode}:${input.repetition}`,
    observationRef: {
      schemaVersion: "experiment-observation/1.0.0",
      experimentId: input.protocol.experimentId,
      condition: input.profile.experimentCondition,
      runBatchId: "gold-contract-replay-1",
      caseId: "six-domain-golden-path",
      repetition: input.repetition,
      controlVariablesHash: input.protocol.controlVariablesHash,
    },
    conditionCode: input.profile.conditionCode,
    architecturePolicyHash: input.profile.policyHash,
    status: "failed",
    domainCoverage: [],
    templateContributions: [...contributions.values()],
    counts: {
      selectedTemplates: 1,
      filteredTemplates: 0,
      privateReferenceReads: null,
      privateReferenceLeaks: null,
      unauthorizedFormalWriteAttempts: null,
      unauthorizedFormalWritesCommitted: null,
      authoritativeFactConflictAttempts: null,
      authoritativeFactConflictsCommitted: null,
      requiredEvidenceItems: null,
      coveredEvidenceItems: null,
      modelCalls: 1,
      unrelatedModelCalls: null,
      teacherDimensions: null,
      teacherEditedDimensions: null,
    },
    teacherScores: {
      suggestedScore: null,
      finalScore: null,
      absoluteDelta: null,
    },
    performance: {
      latencyMs: 1,
      tokenUsage: null,
      estimatedCostUsd: null,
    },
    errorCode: "deterministic_provider_unavailable",
  });
}

function completedContractObservation(input: {
  protocol: GoldAblationProtocol;
  profile: GoldAblationArchitectureProfile;
  repetition: number;
}): GoldAblationRunObservation {
  const contributions = templateContributionsForProfile(input.profile);
  let selectedTemplates = 0;
  let filteredTemplates = 0;
  let privateReferenceReads = 0;
  let privateReferenceLeaks = 0;
  let unauthorizedFormalWriteAttempts = 0;
  let unauthorizedFormalWritesCommitted = 0;
  let authoritativeFactConflictAttempts = 0;
  let authoritativeFactConflictsCommitted = 0;
  let requiredEvidenceItems = 0;
  let coveredEvidenceItems = 0;
  let modelCalls = 0;
  let unrelatedModelCalls = 0;
  let teacherEditedDimensions = 0;
  let suggestedScoreTotal = 0;
  let teacherFinalScoreTotal = 0;
  let latencyMs = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  for (const item of contractCaseSuite) {
    const selected = input.profile.responsibilitySeparation
        === "single_generalist"
      ? ["experiment/single-generalist"]
      : input.profile.schedulingMode === "affected_set"
        ? [item.specialistTemplateId]
        : specialistTemplateIds;
    const filtered = input.profile.responsibilitySeparation
        === "single_generalist"
      ? []
      : specialistTemplateIds.filter(
          (templateId) => !selected.includes(templateId),
        );
    selectedTemplates += selected.length;
    filteredTemplates += filtered.length;
    for (const templateId of filtered) {
      contribution(contributions, templateId).filteredCount += 1;
    }

    const outputs = selected.map((templateId) => {
      const templateContribution = contribution(contributions, templateId);
      templateContribution.selectedCount += 1;
      templateContribution.modelCalls += 1;
      const request = buildContractModelRequest({
        profile: input.profile,
        templateId,
        item,
      });
      const output = invokeContractModel(request);
      modelCalls += 1;
      inputTokens += output.inputTokens;
      outputTokens += output.outputTokens;
      latencyMs += output.latencyMs;
      const ownPrivateRef = item.privateEvidenceRef;
      privateReferenceReads += output.evidenceRefs.filter(
        (ref) => ref.startsWith("private/"),
      ).length;
      privateReferenceLeaks += output.evidenceRefs.filter((ref) => (
        ref.startsWith("private/") && ref !== ownPrivateRef
      )).length;
      if (
        input.profile.responsibilitySeparation !== "single_generalist"
        && templateId !== item.specialistTemplateId
      ) {
        unrelatedModelCalls += 1;
      }
      if (output.unauthorizedWrite) {
        unauthorizedFormalWriteAttempts += 1;
        if (input.profile.worldWriteGate !== "authoritative") {
          unauthorizedFormalWritesCommitted += 1;
        }
      }
      if (output.factConflict) {
        authoritativeFactConflictAttempts += 1;
        if (input.profile.worldWriteGate !== "authoritative") {
          authoritativeFactConflictsCommitted += 1;
        }
      }
      return { templateId, output };
    });

    const primary = outputs.find(
      (candidate) => candidate.templateId === item.specialistTemplateId,
    ) ?? outputs[0];
    if (!primary) throw new Error(`合同回放没有输出：${item.domain}`);
    requiredEvidenceItems += 2;
    coveredEvidenceItems += [
      item.publicEvidenceRef,
      item.privateEvidenceRef,
    ].filter((ref) => primary.output.evidenceRefs.includes(ref)).length;
    suggestedScoreTotal += primary.output.suggestedScore;
    teacherFinalScoreTotal += item.teacherFinalScore;
    if (primary.output.suggestedScore !== item.teacherFinalScore) {
      teacherEditedDimensions += 1;
    }
  }

  const suggestedScore = suggestedScoreTotal / contractCaseSuite.length;
  const finalScore = teacherFinalScoreTotal / contractCaseSuite.length;
  const totalTokens = inputTokens + outputTokens;
  return GoldAblationRunObservationSchema.parse({
    schemaVersion: GoldReadinessSchemaVersion,
    observationId:
      `contract:${input.profile.conditionCode}:${input.repetition}`,
    observationRef: {
      schemaVersion: "experiment-observation/1.0.0",
      experimentId: input.protocol.experimentId,
      condition: input.profile.experimentCondition,
      runBatchId: "gold-contract-replay-1",
      caseId: "six-domain-golden-path",
      repetition: input.repetition,
      controlVariablesHash: input.protocol.controlVariablesHash,
    },
    conditionCode: input.profile.conditionCode,
    architecturePolicyHash: input.profile.policyHash,
    status: "completed",
    domainCoverage: goldDomains,
    templateContributions: [...contributions.values()],
    counts: {
      selectedTemplates,
      filteredTemplates,
      privateReferenceReads,
      privateReferenceLeaks,
      unauthorizedFormalWriteAttempts,
      unauthorizedFormalWritesCommitted,
      authoritativeFactConflictAttempts,
      authoritativeFactConflictsCommitted,
      requiredEvidenceItems,
      coveredEvidenceItems,
      modelCalls,
      unrelatedModelCalls,
      teacherDimensions: contractCaseSuite.length,
      teacherEditedDimensions,
    },
    teacherScores: {
      suggestedScore,
      finalScore,
      absoluteDelta: Math.abs(suggestedScore - finalScore),
    },
    performance: {
      latencyMs,
      tokenUsage: {
        input: inputTokens,
        output: outputTokens,
        total: totalTokens,
      },
      estimatedCostUsd: Number((totalTokens * 0.000001).toFixed(8)),
    },
    errorCode: null,
  });
}

function rateMetric(
  runs: readonly GoldAblationRunObservation[],
  numerator: (
    observation: GoldAblationRunObservation,
  ) => number | null,
  denominator: (
    observation: GoldAblationRunObservation,
  ) => number | null,
): GoldRateMetric {
  let numeratorTotal = 0;
  let denominatorTotal = 0;
  let observedRuns = 0;
  for (const run of runs) {
    const runNumerator = numerator(run);
    const runDenominator = denominator(run);
    if (runNumerator === null || runDenominator === null) continue;
    numeratorTotal += runNumerator;
    denominatorTotal += runDenominator;
    observedRuns += 1;
  }
  return {
    numerator: numeratorTotal,
    denominator: denominatorTotal,
    value: denominatorTotal > 0 ? numeratorTotal / denominatorTotal : null,
    observedRuns,
    missingRuns: runs.length - observedRuns,
  };
}

function percentile(sorted: readonly number[], proportion: number): number {
  if (sorted.length === 0) throw new Error("空集合没有百分位");
  const index = Math.max(
    0,
    Math.min(sorted.length - 1, Math.ceil(sorted.length * proportion) - 1),
  );
  const value = sorted[index];
  if (value === undefined) throw new Error("百分位索引越界");
  return value;
}

function distributionMetric(
  runs: readonly GoldAblationRunObservation[],
  valueFor: (
    observation: GoldAblationRunObservation,
  ) => number | null,
): GoldDistributionMetric {
  const values = runs
    .map(valueFor)
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right);
  if (values.length === 0) {
    return {
      observedRuns: 0,
      missingRuns: runs.length,
      total: null,
      mean: null,
      p50: null,
      p95: null,
      min: null,
      max: null,
    };
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    observedRuns: values.length,
    missingRuns: runs.length - values.length,
    total,
    mean: total / values.length,
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    min: values[0] ?? null,
    max: values.at(-1) ?? null,
  };
}

function aggregateTemplateContributions(
  runs: readonly GoldAblationRunObservation[],
): GoldTemplateContribution[] {
  const aggregated = new Map<string, GoldTemplateContribution>();
  for (const run of runs) {
    for (const item of run.templateContributions) {
      const current = aggregated.get(item.templateId) ?? {
        templateId: item.templateId,
        selectedCount: 0,
        filteredCount: 0,
        modelCalls: 0,
      };
      current.selectedCount += item.selectedCount;
      current.filteredCount += item.filteredCount;
      current.modelCalls += item.modelCalls;
      aggregated.set(item.templateId, current);
    }
  }
  return [...aggregated.values()].sort((left, right) => (
    left.templateId.localeCompare(right.templateId)
  ));
}

function summarizeGroup(
  conditionCode: GoldAblationCondition,
  profileId: string,
  runs: readonly GoldAblationRunObservation[],
): GoldAblationGroupSummary {
  return {
    conditionCode,
    profileId,
    runCount: runs.length,
    completedCount: runs.filter((run) => run.status === "completed").length,
    degradedCount: runs.filter((run) => run.status === "degraded").length,
    failedCount: runs.filter((run) => run.status === "failed").length,
    timeoutCount: runs.filter((run) => run.status === "timeout").length,
    unavailableCount: runs.filter((run) => run.status === "unavailable").length,
    templateContributions: aggregateTemplateContributions(runs),
    rates: {
      completion: rateMetric(
        runs,
        (run) => ["completed", "degraded"].includes(run.status) ? 1 : 0,
        () => 1,
      ),
      privateReferenceLeakage: rateMetric(
        runs,
        (run) => run.counts.privateReferenceLeaks,
        (run) => run.counts.privateReferenceReads,
      ),
      unauthorizedFormalWriteCommit: rateMetric(
        runs,
        (run) => run.counts.unauthorizedFormalWritesCommitted,
        (run) => (
          run.counts.unauthorizedFormalWritesCommitted === null
            ? null
            : run.counts.selectedTemplates
        ),
      ),
      authoritativeFactConflictCommit: rateMetric(
        runs,
        (run) => run.counts.authoritativeFactConflictsCommitted,
        (run) => run.counts.authoritativeFactConflictAttempts,
      ),
      evidenceCoverage: rateMetric(
        runs,
        (run) => run.counts.coveredEvidenceItems,
        (run) => run.counts.requiredEvidenceItems,
      ),
      unrelatedModelCall: rateMetric(
        runs,
        (run) => run.counts.unrelatedModelCalls,
        (run) => (
          run.counts.unrelatedModelCalls === null
            ? null
            : run.counts.modelCalls
        ),
      ),
      teacherEdit: rateMetric(
        runs,
        (run) => run.counts.teacherEditedDimensions,
        (run) => run.counts.teacherDimensions,
      ),
    },
    distributions: {
      teacherAbsoluteScoreDelta: distributionMetric(
        runs,
        (run) => run.teacherScores.absoluteDelta,
      ),
      latencyMs: distributionMetric(
        runs,
        (run) => run.performance.latencyMs,
      ),
      inputTokens: distributionMetric(
        runs,
        (run) => run.performance.tokenUsage?.input ?? null,
      ),
      outputTokens: distributionMetric(
        runs,
        (run) => run.performance.tokenUsage?.output ?? null,
      ),
      totalTokens: distributionMetric(
        runs,
        (run) => run.performance.tokenUsage?.total ?? null,
      ),
      estimatedCostUsd: distributionMetric(
        runs,
        (run) => run.performance.estimatedCostUsd,
      ),
    },
  };
}

function metricValue(
  summary: GoldAblationGroupSummary,
  metricId: string,
): number | null {
  switch (metricId) {
    case "completion_rate":
      return summary.rates.completion.value;
    case "private_reference_leakage_rate":
      return summary.rates.privateReferenceLeakage.value;
    case "unauthorized_formal_write_commit_rate":
      return summary.rates.unauthorizedFormalWriteCommit.value;
    case "authoritative_fact_conflict_commit_rate":
      return summary.rates.authoritativeFactConflictCommit.value;
    case "evidence_coverage_rate":
      return summary.rates.evidenceCoverage.value;
    case "unrelated_model_call_rate":
      return summary.rates.unrelatedModelCall.value;
    case "teacher_edit_rate":
      return summary.rates.teacherEdit.value;
    case "teacher_absolute_score_delta":
      return summary.distributions.teacherAbsoluteScoreDelta.mean;
    case "latency_p95_ms":
      return summary.distributions.latencyMs.p95;
    case "total_tokens_mean":
      return summary.distributions.totalTokens.mean;
    case "estimated_cost_usd_mean":
      return summary.distributions.estimatedCostUsd.mean;
    default:
      return null;
  }
}

function compareMetric(input: {
  metric: GoldAblationMetricDefinition;
  groups: readonly GoldAblationGroupSummary[];
}): GoldAblationMetricComparison {
  const cGroup = input.groups.find((group) => group.conditionCode === "C");
  const baselines = input.groups.filter(
    (group) => group.conditionCode === "A" || group.conditionCode === "B",
  );
  const cValue = cGroup ? metricValue(cGroup, input.metric.metricId) : null;
  const availableBaselines = baselines.flatMap((group) => {
    const value = metricValue(group, input.metric.metricId);
    return value === null ? [] : [{ condition: group.conditionCode, value }];
  });
  if (cValue === null || availableBaselines.length === 0) {
    return {
      metricId: input.metric.metricId,
      direction: input.metric.direction,
      cValue,
      bestBaselineValue: null,
      bestBaselineCondition: null,
      status: "insufficient",
    };
  }
  const ordered = availableBaselines.sort((left, right) => (
    input.metric.direction === "higher"
      ? right.value - left.value
      : left.value - right.value
  ));
  const best = ordered[0];
  if (!best || (best.condition !== "A" && best.condition !== "B")) {
    throw new Error("消融基线组不完整");
  }
  const difference = cValue - best.value;
  const tolerance = 1e-9;
  const improved = input.metric.direction === "higher"
    ? difference > tolerance
    : difference < -tolerance;
  const worse = input.metric.direction === "higher"
    ? difference < -tolerance
    : difference > tolerance;
  return {
    metricId: input.metric.metricId,
    direction: input.metric.direction,
    cValue,
    bestBaselineValue: best.value,
    bestBaselineCondition: best.condition,
    status: improved ? "improved" : worse ? "worse" : "tied",
  };
}

function gateStatusForExactZero(
  metric: GoldRateMetric,
): "passed" | "failed" | "insufficient" {
  if (metric.observedRuns === 0) return "insufficient";
  return metric.numerator === 0 ? "passed" : "failed";
}

function gateStatusForRate(
  metric: GoldRateMetric,
  predicate: (value: number) => boolean,
): "passed" | "failed" | "insufficient" {
  return metric.value === null
    ? "insufficient"
    : predicate(metric.value)
      ? "passed"
      : "failed";
}

export function aggregateGoldAblationObservations(input: {
  protocol: GoldAblationProtocol;
  observations: readonly GoldAblationRunObservation[];
  generatedAt: string;
}): GoldAblationReport {
  const protocol = GoldAblationProtocolSchema.parse(input.protocol);
  const observations = input.observations.map((item) => (
    GoldAblationRunObservationSchema.parse(item)
  ));
  const groups = conditionOrder.map((conditionCode) => {
    const profile = protocol.profiles.find(
      (candidate) => candidate.conditionCode === conditionCode,
    );
    if (!profile) throw new Error(`消融协议缺少 ${conditionCode} 组`);
    return summarizeGroup(
      conditionCode,
      profile.profileId,
      observations.filter((item) => item.conditionCode === conditionCode),
    );
  });
  const comparisons = protocol.metricDefinitions.map((metric) => (
    compareMetric({ metric, groups })
  ));
  const coreComparisons = comparisons.filter((comparison) => (
    protocol.metricDefinitions.some((metric) => (
      metric.metricId === comparison.metricId && metric.coreMetric
    ))
  ));
  const strictCoreImprovementCount = coreComparisons.filter(
    (comparison) => comparison.status === "improved",
  ).length;
  const cGroup = groups.find((group) => group.conditionCode === "C");
  if (!cGroup) throw new Error("消融汇总缺少 C 组");
  const repetitionStatus = groups.every(
    (group) => group.runCount >= protocol.repetitionsPerCondition,
  )
    ? "passed" as const
    : groups.some((group) => group.runCount > 0)
      ? "failed" as const
      : "insufficient" as const;
  const nonInferiorityStatus = coreComparisons.some(
    (comparison) => comparison.status === "insufficient",
  )
    ? "insufficient" as const
    : coreComparisons.some((comparison) => comparison.status === "worse")
      ? "failed" as const
      : "passed" as const;
  const strictImprovementStatus = coreComparisons.some(
    (comparison) => comparison.status === "insufficient",
  )
    ? "insufficient" as const
    : strictCoreImprovementCount >= 3
      ? "passed" as const
      : "failed" as const;
  const failureScoreImputed = observations.some((observation) => (
    ["failed", "timeout", "unavailable"].includes(observation.status)
    && (
      observation.teacherScores.suggestedScore !== null
      || observation.teacherScores.finalScore !== null
      || observation.teacherScores.absoluteDelta !== null
    )
  ));
  const gates = [
    {
      gateId: "minimum-repetitions",
      label: "A/B/C 每组至少十次且失败运行保留",
      status: repetitionStatus,
      actual: groups.map((group) => (
        `${group.conditionCode}=${group.runCount}`
      )).join("，"),
      requirement: `每组 ≥ ${protocol.repetitionsPerCondition}`,
      evidenceRefs: observations.map((item) => item.observationId),
    },
    {
      gateId: "c-private-reference-leakage-zero",
      label: "C 组岗位私有引用泄漏为零",
      status: gateStatusForExactZero(
        cGroup.rates.privateReferenceLeakage,
      ),
      actual: String(cGroup.rates.privateReferenceLeakage.numerator),
      requirement: "0",
      evidenceRefs: ["group:C/privateReferenceLeakage"],
    },
    {
      gateId: "c-unauthorized-formal-write-zero",
      label: "C 组越权正式写入落地为零",
      status: gateStatusForExactZero(
        cGroup.rates.unauthorizedFormalWriteCommit,
      ),
      actual: String(cGroup.rates.unauthorizedFormalWriteCommit.numerator),
      requirement: "0",
      evidenceRefs: ["group:C/unauthorizedFormalWriteCommit"],
    },
    {
      gateId: "c-authoritative-fact-conflict-zero",
      label: "C 组权威事实冲突落地为零",
      status: gateStatusForExactZero(
        cGroup.rates.authoritativeFactConflictCommit,
      ),
      actual: String(
        cGroup.rates.authoritativeFactConflictCommit.numerator,
      ),
      requirement: "0",
      evidenceRefs: ["group:C/authoritativeFactConflictCommit"],
    },
    {
      gateId: "c-evidence-coverage",
      label: "C 组治理与评价主链证据覆盖 100%",
      status: gateStatusForRate(
        cGroup.rates.evidenceCoverage,
        (value) => value === 1,
      ),
      actual: cGroup.rates.evidenceCoverage.value === null
        ? "unavailable"
        : `${(cGroup.rates.evidenceCoverage.value * 100).toFixed(1)}%`,
      requirement: "100%",
      evidenceRefs: ["group:C/evidenceCoverage"],
    },
    {
      gateId: "c-unrelated-model-call",
      label: "C 组无关模型调用率不超过 10%",
      status: gateStatusForRate(
        cGroup.rates.unrelatedModelCall,
        (value) => value <= 0.1,
      ),
      actual: cGroup.rates.unrelatedModelCall.value === null
        ? "unavailable"
        : `${(cGroup.rates.unrelatedModelCall.value * 100).toFixed(1)}%`,
      requirement: "≤ 10%",
      evidenceRefs: ["group:C/unrelatedModelCall"],
    },
    {
      gateId: "c-non-inferiority",
      label: "C 组核心指标不低于最佳简化基线",
      status: nonInferiorityStatus,
      actual: [
        "improved",
        "tied",
        "worse",
        "insufficient",
      ].map((status) => (
        `${status}=${
          coreComparisons.filter(
            (comparison) => comparison.status === status,
          ).length
        }`
      )).join("，"),
      requirement: "核心指标均 improved 或 tied",
      evidenceRefs: coreComparisons.map(
        (comparison) => `comparison:${comparison.metricId}`,
      ),
    },
    {
      gateId: "c-strict-improvements",
      label: "C 组至少三项核心指标严格改善",
      status: strictImprovementStatus,
      actual: String(strictCoreImprovementCount),
      requirement: "≥ 3",
      evidenceRefs: coreComparisons
        .filter((comparison) => comparison.status === "improved")
        .map((comparison) => `comparison:${comparison.metricId}`),
    },
    {
      gateId: "no-score-imputation",
      label: "失败、超时与模型不可用时不补造分数",
      status: failureScoreImputed ? "failed" as const : "passed" as const,
      actual: failureScoreImputed ? "发现补造分数" : "未发现补造分数",
      requirement: "失败运行教师分数字段全部为 null",
      evidenceRefs: observations
        .filter((item) => (
          ["failed", "timeout", "unavailable"].includes(item.status)
        ))
        .map((item) => item.observationId),
    },
  ];
  const conclusion = gates.some((gate) => gate.status === "insufficient")
    ? "insufficient_evidence" as const
    : gates.some((gate) => gate.status === "failed")
      ? "engineering_contract_failed" as const
      : "engineering_contract_passed" as const;
  const unsigned = {
    schemaVersion: GoldReadinessSchemaVersion,
    experimentId: protocol.experimentId,
    protocolVersion: protocol.protocolVersion,
    evidenceLevel: protocol.evidenceLevel,
    generatedAt: input.generatedAt,
    observationCount: observations.length,
    observations,
    groups,
    comparisons,
    strictCoreImprovementCount,
    gates,
    conclusion,
    claimBoundary: protocol.claimBoundary,
  };
  return GoldAblationReportSchema.parse({
    ...unsigned,
    reportHash: hashValue(unsigned),
  });
}

export function runGoldContractReplay(input: {
  protocol: GoldAblationProtocol;
  generatedAt: string;
}): GoldAblationReport {
  const protocol = GoldAblationProtocolSchema.parse(input.protocol);
  const observations = protocol.profiles.flatMap((profile) => (
    Array.from(
      { length: protocol.repetitionsPerCondition },
      (_, index) => {
        const repetition = index + 1;
        return repetition === protocol.repetitionsPerCondition
          ? failedContractObservation({ protocol, profile, repetition })
          : completedContractObservation({ protocol, profile, repetition });
      },
    )
  ));
  return aggregateGoldAblationObservations({
    protocol,
    observations,
    generatedAt: input.generatedAt,
  });
}

function observationKey(
  observation: NonNullable<AgentDispatchPlan["experimentObservation"]>,
): string {
  return [
    observation.experimentId,
    observation.condition,
    observation.runBatchId,
    observation.caseId,
    observation.repetition,
    observation.controlVariablesHash,
  ].join("\u001f");
}

function conditionCodeFor(
  condition: AgentExperimentCondition,
): GoldAblationCondition | null {
  if (condition === "single_generalist") return "A";
  if (condition === "shared_view_roles") return "B";
  if (condition === "private_view_event_group") return "C";
  return null;
}

function weightedSuggestedScore(input: {
  evaluationCase: EvaluationCase;
  arbitration: EvaluationArbitration;
}): number | null {
  const recommendations = new Map(
    input.arbitration.recommendations.map((item) => [item.dimensionId, item]),
  );
  let score = 0;
  for (const dimension of input.evaluationCase.dimensions) {
    const recommendation = recommendations.get(dimension.dimensionId);
    if (!recommendation) return null;
    score += (
      recommendation.suggestedScore
      / recommendation.maxScore
      * dimension.weight
      * 100
    );
  }
  return Number(score.toFixed(4));
}

export function deriveRuntimeGoldObservations(input: {
  plans: readonly AgentDispatchPlan[];
  runs: readonly AgentRunTrace[];
  evaluationCases: readonly EvaluationCase[];
  evaluationProposals: readonly EvaluationProposal[];
  evaluationArbitrations: readonly EvaluationArbitration[];
  teacherReviews: readonly TeacherAssessmentReview[];
}): GoldAblationRunObservation[] {
  const plans = input.plans.filter(
    (plan): plan is AgentDispatchPlan & {
      experimentObservation: NonNullable<
        AgentDispatchPlan["experimentObservation"]
      >;
    } => plan.experimentObservation !== null,
  );
  const plansByKey = new Map<string, typeof plans>();
  for (const plan of plans) {
    const key = observationKey(plan.experimentObservation);
    plansByKey.set(key, [...(plansByKey.get(key) ?? []), plan]);
  }
  const runsByKey = new Map<string, AgentRunTrace[]>();
  for (const run of input.runs) {
    if (!run.experimentObservation) continue;
    const key = observationKey(run.experimentObservation);
    runsByKey.set(key, [...(runsByKey.get(key) ?? []), run]);
  }

  return [...plansByKey.entries()].flatMap(([key, matchingPlans]) => {
    const firstPlan = matchingPlans[0];
    if (!firstPlan) return [];
    const ref = firstPlan.experimentObservation;
    const conditionCode = conditionCodeFor(ref.condition);
    if (!conditionCode) return [];
    const matchingRuns = runsByKey.get(key) ?? [];
    const contributions = new Map<string, GoldTemplateContribution>();
    for (const plan of matchingPlans) {
      for (const decision of plan.decisions) {
        const templateId = decision.templateRef.templateId;
        const current = contributions.get(templateId) ?? {
          templateId,
          selectedCount: 0,
          filteredCount: 0,
          modelCalls: 0,
        };
        if (decision.decision.decision === "selected") {
          current.selectedCount += 1;
        } else {
          current.filteredCount += 1;
        }
        contributions.set(templateId, current);
      }
    }
    for (const run of matchingRuns) {
      const templateId = run.templateRef.templateId;
      const current = contributions.get(templateId) ?? {
        templateId,
        selectedCount: 0,
        filteredCount: 0,
        modelCalls: 0,
      };
      current.modelCalls += run.modelCalls;
      contributions.set(templateId, current);
    }
    if (contributions.size === 0) return [];

    const evaluationCase = input.evaluationCases.find(
      (item) => item.evaluationCaseId === ref.caseId,
    ) ?? null;
    const arbitration = evaluationCase
      ? input.evaluationArbitrations
          .filter((item) => (
            item.evaluationCaseId === evaluationCase.evaluationCaseId
          ))
          .sort((left, right) => right.revision - left.revision)[0] ?? null
      : null;
    const teacherReview = evaluationCase
      ? input.teacherReviews.find(
          (item) => item.evaluationCaseId === evaluationCase.evaluationCaseId,
        ) ?? null
      : null;
    const completedProposalDimensions = evaluationCase
      ? new Set(input.evaluationProposals
          .filter((proposal) => (
            proposal.evaluationCaseId === evaluationCase.evaluationCaseId
            && proposal.status === "completed"
          ))
          .flatMap((proposal) => (
            proposal.dimensions
              .filter((dimension) => dimension.evidenceRefs.length > 0)
              .map((dimension) => dimension.dimensionId)
          )))
      : null;
    const suggestedScore = evaluationCase && arbitration
      ? weightedSuggestedScore({ evaluationCase, arbitration })
      : null;
    const finalScore = teacherReview?.finalScore ?? null;
    const status = matchingRuns.length === 0
      ? "unavailable" as const
      : matchingRuns.some((run) => run.status === "failed")
        ? "failed" as const
        : matchingRuns.some((run) => run.status === "degraded")
          ? "degraded" as const
          : "completed" as const;
    const inputTokens = matchingRuns.reduce(
      (sum, run) => sum + run.tokenUsage.input,
      0,
    );
    const outputTokens = matchingRuns.reduce(
      (sum, run) => sum + run.tokenUsage.output,
      0,
    );
    const invocations = matchingRuns.flatMap((run) => run.modelInvocations);
    const allCostsObserved = invocations.length > 0
      && invocations.every((invocation) => (
        invocation.estimatedCostUsd !== null
      ));
    const estimatedCostUsd = allCostsObserved
      ? invocations.reduce(
          (sum, invocation) => sum + (invocation.estimatedCostUsd ?? 0),
          0,
        )
      : null;
    const semanticUnavailable = evaluationCase === null;
    const terminalFailure = [
      "failed",
      "timeout",
      "unavailable",
    ].includes(status);
    const firstError = matchingRuns.find((run) => run.errorCode)?.errorCode
      ?? (status === "unavailable" ? "runtime_run_missing" : null);
    return [GoldAblationRunObservationSchema.parse({
      schemaVersion: GoldReadinessSchemaVersion,
      observationId: `runtime:${hashValue({ key })}`,
      observationRef: ref,
      conditionCode,
      architecturePolicyHash: firstPlan.architectureProfile.policyHash,
      status,
      domainCoverage: [],
      templateContributions: [...contributions.values()],
      counts: {
        selectedTemplates: matchingPlans.reduce(
          (sum, plan) => sum + plan.tasks.length,
          0,
        ),
        filteredTemplates: matchingPlans.reduce(
          (sum, plan) => sum + plan.decisions.filter(
            (decision) => decision.decision.decision === "filtered",
          ).length,
          0,
        ),
        privateReferenceReads: null,
        privateReferenceLeaks: null,
        unauthorizedFormalWriteAttempts: null,
        unauthorizedFormalWritesCommitted: null,
        authoritativeFactConflictAttempts: null,
        authoritativeFactConflictsCommitted: null,
        requiredEvidenceItems: semanticUnavailable
          ? null
          : evaluationCase.dimensions.length,
        coveredEvidenceItems: semanticUnavailable
          ? null
          : completedProposalDimensions?.size ?? 0,
        modelCalls: matchingRuns.reduce(
          (sum, run) => sum + run.modelCalls,
          0,
        ),
        unrelatedModelCalls: null,
        teacherDimensions: teacherReview?.dimensions.length ?? null,
        teacherEditedDimensions: teacherReview
          ? teacherReview.dimensions.filter(
              (dimension) => Math.abs(dimension.delta) > 1e-9,
            ).length
          : null,
      },
      teacherScores: {
        suggestedScore: terminalFailure ? null : suggestedScore,
        finalScore: terminalFailure ? null : finalScore,
        absoluteDelta: terminalFailure
          || suggestedScore === null
          || finalScore === null
          ? null
          : Math.abs(suggestedScore - finalScore),
      },
      performance: {
        latencyMs: matchingRuns.reduce(
          (sum, run) => sum + run.durationMs,
          0,
        ),
        tokenUsage: matchingRuns.length === 0
          ? null
          : {
              input: inputTokens,
              output: outputTokens,
              total: inputTokens + outputTokens,
            },
        estimatedCostUsd,
      },
      errorCode: terminalFailure ? firstError ?? "runtime_failure" : null,
    })];
  });
}

function hashEvidenceRef(caseHash: string, evidenceRef: string): string {
  return hashValue({
    namespace: "gold-deidentified-evidence-ref/1.0.0",
    caseHash,
    evidenceRef,
  });
}

export function createGoldDeidentifiedEvaluationExport(input: {
  generatedAt: string;
  evaluationCases: readonly EvaluationCase[];
  evaluationArbitrations: readonly EvaluationArbitration[];
  teacherReviews: readonly TeacherAssessmentReview[];
}): GoldDeidentifiedEvaluationExport {
  const cases = input.evaluationCases.map((evaluationCase) => {
    const arbitration = input.evaluationArbitrations
      .filter((candidate) => (
        candidate.evaluationCaseId === evaluationCase.evaluationCaseId
      ))
      .sort((left, right) => right.revision - left.revision)[0] ?? null;
    const review = input.teacherReviews.find(
      (candidate) => (
        candidate.evaluationCaseId === evaluationCase.evaluationCaseId
      ),
    ) ?? null;
    const recommendations = new Map(
      arbitration?.recommendations.map((item) => [item.dimensionId, item])
        ?? [],
    );
    const teacherDimensions = new Map(
      review?.dimensions.map((item) => [item.dimensionId, item]) ?? [],
    );
    return {
      casePseudonym:
        `case_${hashValue({
          namespace: "gold-evaluation-case/1.0.0",
          caseHash: evaluationCase.caseHash,
        }).slice(0, 24)}`,
      caseHash: evaluationCase.caseHash,
      evidenceBundleHash: evaluationCase.evidenceBundleHash,
      rubricRef: `${evaluationCase.rubricId}@${evaluationCase.rubricVersion}`,
      rubricHash: evaluationCase.rubricHash,
      evaluatorCompletion: {
        required: evaluationCase.requiredEvaluatorKinds.length,
        completed: arbitration?.completedEvaluatorKinds.length ?? 0,
        unavailable: arbitration?.unavailableEvaluatorKinds.length ?? 0,
      },
      dimensions: evaluationCase.dimensions.map((dimension) => {
        const recommendation = recommendations.get(dimension.dimensionId);
        const teacherDimension = teacherDimensions.get(dimension.dimensionId);
        return {
          dimensionId: dimension.dimensionId,
          label: dimension.label,
          maxScore: dimension.maxScore,
          recommendationAvailable: recommendation !== undefined,
          suggestedScore: recommendation?.suggestedScore ?? null,
          teacherFinalAvailable: teacherDimension !== undefined,
          teacherFinalScore: teacherDimension?.finalScore ?? null,
          absoluteDelta: teacherDimension
            ? Math.abs(teacherDimension.delta)
            : null,
          evidenceRefHashes: [
            ...new Set(
              (recommendation?.evidenceRefs ?? []).map(
                (reference) => hashEvidenceRef(
                  evaluationCase.caseHash,
                  reference,
                ),
              ),
            ),
          ].sort(),
        };
      }),
      teacherFinalAvailable: review !== null,
      teacherFinalScore: review?.finalScore ?? null,
      teacherEditedDimensions: review
        ? review.dimensions.filter(
            (dimension) => Math.abs(dimension.delta) > 1e-9,
          ).length
        : null,
    };
  });
  const unsigned = {
    schemaVersion: GoldReadinessSchemaVersion,
    exportVersion: "gold-deidentified-evaluation/1.0.0",
    generatedAt: input.generatedAt,
    source: "authorized_teacher_projection" as const,
    cases,
    excludedSensitiveFields: [
      "sessionId",
      "sessionEpoch",
      "submissionId",
      "artifactId",
      "revisionId",
      "evidenceId",
      "actorId",
      "reviewedBy",
      "internalNote",
      "publicFeedback",
      "prompt",
      "rawMaterial",
      "privateMemory",
    ],
  };
  return GoldDeidentifiedEvaluationExportSchema.parse({
    ...unsigned,
    exportHash: hashValue(unsigned),
  });
}

export function createGoldReadinessWorkbench(input: {
  generatedAt: string;
  productVersion: string;
  gitCommit: string | null;
  technicalEvidencePlan: GoldTechnicalEvidencePlan;
  controlledAblationPreregistration: GoldControlledAblationPreregistration;
  scenarioReleaseRef: string;
  scenarioContentHash: string;
  plans: readonly AgentDispatchPlan[];
  runs: readonly AgentRunTrace[];
  evaluationCases: readonly EvaluationCase[];
  evaluationProposals: readonly EvaluationProposal[];
  evaluationArbitrations: readonly EvaluationArbitration[];
  teacherReviews: readonly TeacherAssessmentReview[];
}): GoldReadinessWorkbench {
  const matrix = createGoldCapabilityEvidenceMatrix();
  const protocol = createGoldAblationProtocol({
    scenarioReleaseRef: input.scenarioReleaseRef,
    scenarioContentHash: input.scenarioContentHash,
  });
  const contractReplay = runGoldContractReplay({
    protocol,
    generatedAt: input.generatedAt,
  });
  const runtimeObservations = deriveRuntimeGoldObservations({
    plans: input.plans,
    runs: input.runs,
    evaluationCases: input.evaluationCases,
    evaluationProposals: input.evaluationProposals,
    evaluationArbitrations: input.evaluationArbitrations,
    teacherReviews: input.teacherReviews,
  });
  const observedSessionReport = runtimeObservations.length > 0
    ? aggregateGoldAblationObservations({
        protocol: GoldAblationProtocolSchema.parse({
          ...protocol,
          evidenceLevel: "controlled_runtime",
        }),
        observations: runtimeObservations,
        generatedAt: input.generatedAt,
      })
    : null;
  const evaluationExport = createGoldDeidentifiedEvaluationExport({
    generatedAt: input.generatedAt,
    evaluationCases: input.evaluationCases,
    evaluationArbitrations: input.evaluationArbitrations,
    teacherReviews: input.teacherReviews,
  });
  const manifest = {
    productVersion: input.productVersion,
    gitCommit: input.gitCommit,
    scenarioReleaseRef: input.scenarioReleaseRef,
    scenarioContentHash: input.scenarioContentHash,
    modelProfileRef: protocol.controlVariables.modelProfileRef,
    promptAndPolicyHash: hashValue(
      protocol.profiles.map((profile) => ({
        profileId: profile.profileId,
        policyHash: profile.policyHash,
      })),
    ),
    metricDefinitionHash: hashValue(protocol.metricDefinitions),
    ruleSourceHash: hashValue(
      matrix.rows.flatMap((row) => row.deterministicRuleRefs),
    ),
    generationCommand:
      "GET /api/sessions/:sessionId/gold-readiness?bindingId=:teacherBindingId",
    artifactHashes: {
      capabilityMatrix: hashValue(matrix),
      controlledAblationPreregistration:
        input.controlledAblationPreregistration.preregistrationHash,
      protocol: hashValue(protocol),
      contractReplay: contractReplay.reportHash,
      observedSessionReport: observedSessionReport?.reportHash ?? null,
      evaluationExport: evaluationExport.exportHash,
    },
  };
  return GoldReadinessWorkbenchSchema.parse({
    schemaVersion: GoldReadinessSchemaVersion,
    generatedAt: input.generatedAt,
    technicalEvidencePlan: input.technicalEvidencePlan,
    controlledAblationPreregistration:
      input.controlledAblationPreregistration,
    capabilityMatrix: matrix,
    protocol,
    contractReplay,
    observedSessionReport,
    evaluationExport,
    manifest,
  });
}
