import {
  AgentAblationEvidenceSchema,
  AgentAblationEvidenceSchemaVersion,
  type AgentAblationEvidence,
  type CrossCourseAgentRuleManifest,
} from "@ronggang/contracts";
import {
  hashV2AgentEvidence,
  verifyCrossCourseAgentRuleManifestIntegrity,
} from "./v2-agent-rules.js";

export const V2AblationExperimentId = "v2-event-driven-agent-ablation" as const;
export const V2AblationMinimumRepetitions = 10 as const;

const policyDefinitions = [
  {
    groupId: "group-1" as const,
    conditionCode: "A" as const,
    responsibility: "single_generalist",
    contextVisibility: "shared_public_context",
    dispatchMode: "single",
  },
  {
    groupId: "group-2" as const,
    conditionCode: "B" as const,
    responsibility: "role_partitioned",
    contextVisibility: "shared_public_context",
    dispatchMode: "fixed_broadcast",
  },
  {
    groupId: "group-3" as const,
    conditionCode: "C" as const,
    responsibility: "role_partitioned",
    contextVisibility: "role_private_projection",
    dispatchMode: "affected_set",
  },
] as const;

const sharedControls = {
  modelProfile: "same-deterministic-or-frozen-live-profile",
  toolPolicy: "same-read-only-tools",
  rubric: "same-course-rubric",
  worldGate: "same-authoritative-world-engine-gate",
  teacherGate: "same-course-teacher-gate",
  budget: "same-token-step-time-budget",
  seed: 20260809,
  temperature: 0,
};

export interface V2AblationObservation {
  observationId: string;
  experimentId: typeof V2AblationExperimentId;
  controlVariablesHash: string;
  architecturePolicyHash: string;
  courseId: string;
  chapterId: string;
  eventId: string;
  conditionCode: "A" | "B" | "C";
  repetition: number;
  status: "completed" | "failed" | "timeout" | "unavailable";
}

export class InvalidV2AblationObservationSetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidV2AblationObservationSetError";
  }
}

export function validateV2AblationObservationSet(input: {
  observations: readonly V2AblationObservation[];
  manifest: CrossCourseAgentRuleManifest;
  controlVariablesHash: string;
  architecturePolicyHashes: Readonly<Record<"A" | "B" | "C", string>>;
}): void {
  const manifest = verifyCrossCourseAgentRuleManifestIntegrity(input.manifest);
  const eligibleChapters = new Set(
    manifest.courses.flatMap((course) => (
      course.runtimeEligibility.status === "runtime_ready"
        ? course.chapters.map((chapter) => (
            `${course.courseReleaseRef.courseId}:${chapter.chapterId}:${chapter.eventRef.eventId}`
          ))
        : []
    )),
  );
  const observationIds = new Set<string>();
  const tuples = new Set<string>();
  const caseRepetitions = new Map<string, Set<number>>();
  const caseConditions = new Map<string, Set<string>>();
  for (const observation of input.observations) {
    if (
      observation.experimentId !== V2AblationExperimentId
      || observation.controlVariablesHash !== input.controlVariablesHash
      || observation.architecturePolicyHash
        !== input.architecturePolicyHashes[observation.conditionCode]
    ) {
      throw new InvalidV2AblationObservationSetError(
        "观察记录与预登记实验、控制变量或架构策略哈希不一致",
      );
    }
    const caseId = `${observation.courseId}:${observation.chapterId}:${observation.eventId}`;
    if (!eligibleChapters.has(caseId)) {
      throw new InvalidV2AblationObservationSetError(
        "内容占位、漂移或未解析章节不得生成消融观察",
      );
    }
    const tuple = `${caseId}:${observation.conditionCode}:${observation.repetition}`;
    if (observationIds.has(observation.observationId) || tuples.has(tuple)) {
      throw new InvalidV2AblationObservationSetError(
        "观察 ID 与课程/事件/条件/重复轮次组合必须唯一",
      );
    }
    observationIds.add(observation.observationId);
    tuples.add(tuple);
    const caseRep = `${caseId}:${observation.repetition}`;
    const conditions = caseConditions.get(caseRep) ?? new Set<string>();
    conditions.add(observation.conditionCode);
    caseConditions.set(caseRep, conditions);
    const repetitions = caseRepetitions.get(caseId) ?? new Set<number>();
    repetitions.add(observation.repetition);
    caseRepetitions.set(caseId, repetitions);
  }
  for (const [caseRep, conditions] of caseConditions) {
    if (conditions.size !== 3 || !["A", "B", "C"].every((item) => conditions.has(item))) {
      throw new InvalidV2AblationObservationSetError(
        `每个案例轮次必须保持 A/B/C 齐套：${caseRep}`,
      );
    }
  }
  for (const [caseId, repetitions] of caseRepetitions) {
    const ordered = [...repetitions].sort((left, right) => left - right);
    if (ordered.some((value, index) => value !== index + 1)) {
      throw new InvalidV2AblationObservationSetError(
        `重复轮次必须从 1 开始连续且不可缺失：${caseId}`,
      );
    }
  }
  if (input.observations.length > 0) {
    if (caseRepetitions.size !== eligibleChapters.size) {
      throw new InvalidV2AblationObservationSetError(
        "非零实验必须覆盖全部运行就绪课程章节，不能选择性遗漏案例",
      );
    }
    const repetitionCounts = [...caseRepetitions.values()].map((items) => items.size);
    if (new Set(repetitionCounts).size !== 1) {
      throw new InvalidV2AblationObservationSetError(
        "全部案例必须使用相同且连续的重复轮次",
      );
    }
    if (repetitionCounts.some((count) => count < V2AblationMinimumRepetitions)) {
      throw new InvalidV2AblationObservationSetError(
        `每个案例的 A/B/C 齐套观察至少需要 ${V2AblationMinimumRepetitions} 次`,
      );
    }
  }
}

export function buildInsufficientAgentAblationEvidence(input: {
  manifest: CrossCourseAgentRuleManifest;
  generatedAt?: string;
}): AgentAblationEvidence {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const manifest = verifyCrossCourseAgentRuleManifestIntegrity(input.manifest);
  const controls = {
    caseSuiteHash: hashV2AgentEvidence(manifest.courses.map((course) => ({
      courseReleaseRef: course.courseReleaseRef,
      chapters: course.chapters.map((chapter) => ({
        chapterId: chapter.chapterId,
        eventRef: chapter.eventRef,
      })),
    }))),
    courseScenarioSetHash: hashV2AgentEvidence(manifest.courses.map((course) => ({
      courseReleaseRef: course.courseReleaseRef,
      scenarioReleaseRef: course.scenarioReleaseRef,
    }))),
    knowledgeSnapshotHash: manifest.contentSnapshotHash,
    modelProfileHash: hashV2AgentEvidence(sharedControls.modelProfile),
    toolPolicyHash: hashV2AgentEvidence(sharedControls.toolPolicy),
    rubricHash: hashV2AgentEvidence(sharedControls.rubric),
    topologyHash: manifest.topologyHash,
    worldGateHash: hashV2AgentEvidence(sharedControls.worldGate),
    teacherGateHash: hashV2AgentEvidence(sharedControls.teacherGate),
    budgetHash: hashV2AgentEvidence(sharedControls.budget),
    seed: sharedControls.seed,
    temperature: sharedControls.temperature,
    conditionLabelsHidden: false as const,
    failuresRetained: true as const,
  };
  const architecturePolicyHashes = Object.fromEntries(
    policyDefinitions.map((policy) => [
      policy.conditionCode,
      hashV2AgentEvidence({
        responsibility: policy.responsibility,
        contextVisibility: policy.contextVisibility,
        dispatchMode: policy.dispatchMode,
        worldGateHash: controls.worldGateHash,
        teacherGateHash: controls.teacherGateHash,
        modelProfileHash: controls.modelProfileHash,
        toolPolicyHash: controls.toolPolicyHash,
        rubricHash: controls.rubricHash,
        budgetHash: controls.budgetHash,
      }),
    ]),
  ) as Record<"A" | "B" | "C", string>;
  const preregistrationHash = hashV2AgentEvidence({
    experimentId: V2AblationExperimentId,
    protocolVersion: "2.0.0",
    controls,
    architecturePolicyHashes,
    minimumRepetitions: V2AblationMinimumRepetitions,
    effectMargin: "pre_registered_non_zero_margin_required",
  });
  const gates = [
    "runtime_eligibility",
    "control_hash_consistency",
    "observation_integrity",
    "balanced_repetitions",
    "no_authoritative_write",
    "blind_review_complete",
    "minimum_effect_margin",
  ].map((gateId) => ({
    gateId,
    status: "insufficient" as const,
    actual: "当前尚无受控运行观察，未进行补分或推断。",
    requirement: "必须完成预登记与齐套运行，并在采样前另行冻结私有随机盲分配和可复核解盲收据。",
    evidenceRefs: [],
  }));
  const reportWithoutHash = {
    schemaVersion: AgentAblationEvidenceSchemaVersion,
    experimentId: V2AblationExperimentId,
    protocolVersion: "2.0.0",
    preregistrationHash,
    ruleManifestHash: manifest.manifestHash,
    generatedAt,
    runStatus: "not_ready" as const,
    conclusion: "insufficient_evidence" as const,
    claimBoundary:
      "当前页面只证明五课程规则、公开预登记条件、控制变量与安全门已冻结；尚无真实三组运行样本，也未配置私有随机盲分配，不支持任何架构优越性主张。",
    observationCount: 0,
    eligibility: manifest.courses.map((course) => ({
      courseId: course.courseReleaseRef.courseId,
      status: course.runtimeEligibility.status,
      reasonCode: course.runtimeEligibility.reasonCode,
    })),
    controls,
    groups: policyDefinitions.map((policy) => ({
      groupId: policy.groupId,
      conditionCode: policy.conditionCode,
      architecturePolicyHash: architecturePolicyHashes[policy.conditionCode],
      runCount: 0,
      failedRunCount: 0,
      metrics: {
        taskCompletionRate: null,
        collaborationNecessityRate: null,
        irrelevantInvocationRate: null,
        unauthorizedWriteAttemptCount: 0,
        unauthorizedWriteCommitCount: 0,
        evidenceCoverageRate: null,
        teacherRevisionCount: 0,
        latencyMsP50: null,
        estimatedCostCny: null,
      },
    })),
    gates: [
      ...gates,
      {
        gateId: "no_score_imputation" as const,
        status: "passed" as const,
        actual: "零观察保持零分母、空指标与不足证据结论。",
        requirement: "失败、缺失与零样本不得补分。",
        evidenceRefs: [],
      },
    ],
    blindReviewStatus: "not_configured" as const,
  };
  return verifyAgentAblationEvidenceIntegrity({
    ...reportWithoutHash,
    reportHash: hashV2AgentEvidence(reportWithoutHash),
  });
}

export function verifyAgentAblationEvidenceIntegrity(
  value: unknown,
): AgentAblationEvidence {
  const evidence = AgentAblationEvidenceSchema.parse(value);
  const { reportHash, ...hashInput } = evidence;
  if (hashV2AgentEvidence(hashInput) !== reportHash) {
    throw new Error("智能体消融证据报告哈希漂移");
  }
  return evidence;
}
