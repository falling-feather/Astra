import {
  AgentAblationEvidenceSchema,
  AgentAblationEvidenceSchemaVersion,
  CrossCourseAgentRuleManifestSchema,
  CrossCourseAgentRuleManifestSchemaVersion,
  type AgentAblationEvidence,
  type CrossCourseAgentRuleManifest,
  type V2CourseId,
} from "../src/index.js";

const hash = (character: string) => character.repeat(64);
const courseDefinitions: ReadonlyArray<{
  courseId: V2CourseId;
  count: number;
}> = [
  { courseId: "course-xunpu-intangible-media", count: 7 },
  { courseId: "course-village-super-multiplatform", count: 6 },
  { courseId: "course-village-super-postpublication-context", count: 5 },
  { courseId: "course-ai-tourism-copyright-governance", count: 6 },
  { courseId: "course-scenic-rain-emergency-reporting", count: 6 },
];

export function crossCourseAgentRuleManifestFixture(): CrossCourseAgentRuleManifest {
  return CrossCourseAgentRuleManifestSchema.parse({
    schemaVersion: CrossCourseAgentRuleManifestSchemaVersion,
    manifestId: "v2-cross-course-agent-rules",
    generatedAt: "2026-08-09T12:00:00.000Z",
    topologyHash: hash("a"),
    baselineTopologyAgentIds: [
      "agent-teaching",
      "agent-scene-director",
      "agent-interviewee",
      "agent-chief",
      "agent-fact-checker",
      "agent-copyright",
      "agent-governance-copyright",
      "agent-governance-content-safety",
      "agent-governance-platform-rule",
      "agent-platform",
      "agent-evidence-assessor",
      "agent-work-quality-assessor",
      "agent-collaboration-assessor",
      "agent-learning",
    ],
    contentSnapshotHash: hash("b"),
    courses: courseDefinitions.map(({ courseId, count }, courseIndex) => ({
      courseReleaseRef: {
        courseId,
        releaseId: `release-${courseId}-runtime-1`,
        version: 2,
        contentHash: hash(String(courseIndex + 1)),
      },
      scenarioReleaseRef: {
        scenarioId: `scenario-${courseId}`,
        version: "2.0.0",
        contentHash: hash(String(courseIndex + 5)),
      },
      runtimeEligibility: {
        status: "runtime_ready",
        reasonCode: "runtime_release_exact_match",
        explanation: "课程、情境与智能体规则均已精确发布。",
      },
      chapters: Array.from({ length: count }, (_, chapterIndex) => ({
        chapterId: `${courseId}-chapter-${chapterIndex + 1}`,
        order: chapterIndex + 1,
        eventRef: {
          eventId: `${courseId}-event-${chapterIndex + 1}`,
          triggerKind: "on_action",
          triggerRef: `${courseId}-action-${chapterIndex + 1}`,
        },
        ruleId: `${courseId}-rule-${chapterIndex + 1}`,
        selectWhen: "当前事件命中课程受影响集合或智能体真实订阅时选择。",
        skipWhen: "没有新增业务影响、证据或行动价值时跳过。",
        sourceAffectedAgentIds: ["agent-teaching"],
        sourceCandidateAgentIds: ["agent-teaching"],
        agentResolutions: [{
          sourceAgentId: "agent-teaching",
          targetKind: "baseline_topology",
          targetAgentId: "agent-teaching",
          status: "exact",
          enabled: true,
        }],
        resolvedAffectedAgentIds: ["agent-teaching"],
        resolvedCandidateAgentIds: ["agent-teaching"],
        maximumSelectedAgents: 1,
        teacherGateIds: [`gate-${courseId}-${chapterIndex + 1}`],
        ruleHash: hash("c"),
      })),
    })),
    manifestHash: hash("d"),
  });
}

export function insufficientAgentAblationEvidenceFixture(): AgentAblationEvidence {
  const manifest = crossCourseAgentRuleManifestFixture();
  const metrics = {
    taskCompletionRate: null,
    collaborationNecessityRate: null,
    irrelevantInvocationRate: null,
    unauthorizedWriteAttemptCount: 0,
    unauthorizedWriteCommitCount: 0,
    evidenceCoverageRate: null,
    teacherRevisionCount: 0,
    latencyMsP50: null,
    estimatedCostCny: null,
  };
  const insufficientGateIds = [
    "runtime_eligibility",
    "control_hash_consistency",
    "observation_integrity",
    "balanced_repetitions",
    "no_authoritative_write",
    "blind_review_complete",
    "minimum_effect_margin",
  ] as const;
  return AgentAblationEvidenceSchema.parse({
    schemaVersion: AgentAblationEvidenceSchemaVersion,
    experimentId: "v2-event-driven-agent-ablation",
    protocolVersion: "2.0.0",
    preregistrationHash: hash("e"),
    ruleManifestHash: manifest.manifestHash,
    reportHash: hash("f"),
    generatedAt: "2026-08-09T12:00:00.000Z",
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
      knowledgeSnapshotHash: hash("3"),
      modelProfileHash: hash("4"),
      toolPolicyHash: hash("5"),
      rubricHash: hash("6"),
      topologyHash: hash("7"),
      worldGateHash: hash("8"),
      teacherGateHash: hash("9"),
      budgetHash: hash("a"),
      seed: 20260809,
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
      metrics,
    })),
    gates: [
      ...insufficientGateIds.map((gateId) => ({
        gateId,
        status: "insufficient" as const,
        actual: "尚无观察。",
        requirement: "需要真实齐套观察。",
        evidenceRefs: [],
      })),
      {
        gateId: "no_score_imputation",
        status: "passed",
        actual: "零观察保持空指标。",
        requirement: "不得补分。",
        evidenceRefs: [],
      },
    ],
    blindReviewStatus: "not_configured",
  });
}
