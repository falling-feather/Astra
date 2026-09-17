import type {
  AgentAblationEvidence,
  AgentAblationGateId,
  AgentRuleRuntimeStatus,
  CrossCourseAgentRuleManifest,
  V2CourseId,
} from "../src/v2/agent-ablation-models";

const hash = (character: string) => character.repeat(64);

const courses: ReadonlyArray<{
  courseId: V2CourseId;
  chapterCount: number;
  status: AgentRuleRuntimeStatus;
}> = [
  {
    courseId: "course-xunpu-intangible-media",
    chapterCount: 7,
    status: "runtime_ready",
  },
  {
    courseId: "course-village-super-multiplatform",
    chapterCount: 6,
    status: "content_only",
  },
  {
    courseId: "course-village-super-postpublication-context",
    chapterCount: 5,
    status: "content_only",
  },
  {
    courseId: "course-ai-tourism-copyright-governance",
    chapterCount: 6,
    status: "content_only",
  },
  {
    courseId: "course-scenic-rain-emergency-reporting",
    chapterCount: 6,
    status: "content_only",
  },
];

export function crossCourseAgentRuleManifestWireFixture(): CrossCourseAgentRuleManifest {
  const baselineTopologyAgentIds = Array.from(
    { length: 14 },
    (_, index) => `agent-baseline-${index + 1}`,
  );
  return {
    schemaVersion: "cross-course-agent-rule-manifest/2.0.0",
    manifestId: "v2-cross-course-agent-rules",
    generatedAt: "2026-08-10T01:00:00.000Z",
    topologyHash: hash("a"),
    baselineTopologyAgentIds,
    contentSnapshotHash: hash("b"),
    courses: courses.map(({ courseId, chapterCount, status }, courseIndex) => ({
      courseReleaseRef: {
        courseId,
        releaseId: `release-${courseId}-1`,
        version: 1,
        contentHash: hash(String(courseIndex + 1)),
      },
      scenarioReleaseRef: {
        scenarioId: `scenario-${courseId.replace(/^course-/u, "")}`,
        version: status === "runtime_ready" ? "2.0.0" : "2.0.0-content.1",
        contentHash: hash(String(courseIndex + 5)),
      },
      runtimeEligibility: {
        status,
        reasonCode: status === "runtime_ready"
          ? "runtime_release_exact_match"
          : "runtime_scenario_not_published",
        explanation: status === "runtime_ready"
          ? "课程、情境与智能体规则均已按不可变引用精确发布。"
          : "课程内容已冻结，但真实运行情境尚未发布，不生成运行观察。",
      },
      chapters: Array.from({ length: chapterCount }, (_, chapterIndex) => {
        const hasSupportingCapability = courseIndex === 0 && chapterIndex === 0;
        const sourceCandidateAgentIds = hasSupportingCapability
          ? ["agent-baseline-1", "agent-evidence-coach"]
          : ["agent-baseline-1"];
        return {
          chapterId: `${courseId}-chapter-${chapterIndex + 1}`,
          order: chapterIndex + 1,
          eventRef: {
            eventId: `${courseId}-event-${chapterIndex + 1}`,
            triggerKind: "on_action" as const,
            triggerRef: `${courseId}-action-${chapterIndex + 1}`,
          },
          ruleId: `${courseId}-rule-${chapterIndex + 1}`,
          sourceAffectedAgentIds: ["agent-baseline-1"],
          sourceCandidateAgentIds,
          agentResolutions: [
            {
              sourceAgentId: "agent-baseline-1",
              targetKind: "baseline_topology" as const,
              targetAgentId: "agent-baseline-1",
              status: "exact" as const,
              enabled: true,
            },
            ...(hasSupportingCapability ? [{
              sourceAgentId: "agent-evidence-coach",
              targetKind: "supporting_capability" as const,
              targetAgentId: "agent-evidence-coach",
              status: "exact" as const,
              enabled: true,
            }] : []),
          ],
          resolvedAffectedAgentIds: ["agent-baseline-1"],
          resolvedCandidateAgentIds: ["agent-baseline-1"],
          maximumSelectedAgents: sourceCandidateAgentIds.length,
          selectWhen: "事件影响对象与候选智能体职责、证据输入均匹配时进入调度候选。",
          skipWhen: "当前事件未影响该职责对象，或必要证据尚未进入安全投影时跳过。",
          teacherGateIds: [`gate-${courseId}-${chapterIndex + 1}`],
          ruleHash: hash("c"),
        };
      }),
    })),
    manifestHash: hash("d"),
  };
}

export function insufficientAgentAblationEvidenceWireFixture(): AgentAblationEvidence {
  const manifest = crossCourseAgentRuleManifestWireFixture();
  const gateIds: AgentAblationGateId[] = [
    "runtime_eligibility",
    "control_hash_consistency",
    "observation_integrity",
    "balanced_repetitions",
    "no_authoritative_write",
    "blind_review_complete",
    "minimum_effect_margin",
    "no_score_imputation",
  ];
  return {
    schemaVersion: "agent-ablation-evidence/2.0.0",
    experimentId: "v2-event-driven-agent-ablation",
    protocolVersion: "2.0.0",
    preregistrationHash: hash("e"),
    ruleManifestHash: manifest.manifestHash,
    reportHash: hash("f"),
    generatedAt: "2026-08-10T01:00:00.000Z",
    runStatus: "not_ready",
    conclusion: "insufficient_evidence",
    claimBoundary: "尚无真实三组运行样本，不支持任何架构优越性主张。",
    observationCount: 0,
    eligibility: manifest.courses.map((course) => ({
      courseId: course.courseReleaseRef.courseId,
      status: course.runtimeEligibility.status,
      reasonCode: course.runtimeEligibility.reasonCode,
    })),
    controls: {
      caseSuiteHash: hash("1"),
      courseScenarioSetHash: hash("2"),
      knowledgeSnapshotHash: manifest.contentSnapshotHash,
      modelProfileHash: hash("4"),
      toolPolicyHash: hash("5"),
      rubricHash: hash("6"),
      topologyHash: manifest.topologyHash,
      worldGateHash: hash("8"),
      teacherGateHash: hash("9"),
      budgetHash: hash("a"),
      seed: 20260810,
      temperature: 0,
      conditionLabelsHidden: false,
      failuresRetained: true,
    },
    groups: (["group-1", "group-2", "group-3"] as const).map((groupId, index) => ({
      groupId,
      conditionCode: (["A", "B", "C"] as const)[index]!,
      architecturePolicyHash: hash("b"),
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
    gates: gateIds.map((gateId) => ({
      gateId,
      status: gateId === "no_score_imputation" ? "passed" : "insufficient",
      actual: gateId === "no_score_imputation"
        ? "零观察保持零分母、空指标与不足证据结论。"
        : "当前尚无受控运行观察，未进行补分或推断。",
      requirement: gateId === "no_score_imputation"
        ? "失败、缺失与零样本不得补分。"
        : "必须完成预登记、齐套、盲化且可复核的真实运行观察。",
      evidenceRefs: [],
    })),
    blindReviewStatus: "not_configured",
  };
}
