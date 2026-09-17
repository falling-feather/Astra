import { z } from "zod";
import {
  CourseReleaseReferenceSchema,
  ScenarioReleaseReferenceSchema,
  V2ContentHashSchema,
  V2IdentifierSchema,
} from "./course-learning.js";

export const CrossCourseAgentRuleManifestSchemaVersion =
  "cross-course-agent-rule-manifest/2.0.0" as const;
export const AgentAblationEvidenceSchemaVersion =
  "agent-ablation-evidence/2.0.0" as const;

export const V2CourseIdSchema = z.enum([
  "course-xunpu-intangible-media",
  "course-village-super-multiplatform",
  "course-village-super-postpublication-context",
  "course-ai-tourism-copyright-governance",
  "course-scenic-rain-emergency-reporting",
]);
export type V2CourseId = z.infer<typeof V2CourseIdSchema>;

const expectedChapterCounts: Record<V2CourseId, number> = {
  "course-xunpu-intangible-media": 7,
  "course-village-super-multiplatform": 6,
  "course-village-super-postpublication-context": 5,
  "course-ai-tourism-copyright-governance": 6,
  "course-scenic-rain-emergency-reporting": 6,
};

export const AgentRuleRuntimeEligibilitySchema = z.object({
  status: z.enum([
    "runtime_ready",
    "content_only",
    "unresolved_agent_ref",
    "version_hash_drift",
    "runtime_unavailable",
  ]),
  reasonCode: V2IdentifierSchema,
  explanation: z.string().trim().min(1).max(800),
}).strict();
export type AgentRuleRuntimeEligibility = z.infer<
  typeof AgentRuleRuntimeEligibilitySchema
>;

export const CrossCourseAgentResolutionSchema = z.object({
  sourceAgentId: V2IdentifierSchema,
  targetKind: z.enum(["baseline_topology", "supporting_capability"]),
  targetAgentId: V2IdentifierSchema.nullable(),
  status: z.enum(["exact", "mapped", "unresolved"]),
  enabled: z.boolean(),
}).strict().superRefine((resolution, context) => {
  if (
    resolution.status === "unresolved"
    && (resolution.targetAgentId !== null || resolution.enabled)
  ) {
    context.addIssue({
      code: "custom",
      path: ["status"],
      message: "未解析智能体引用不得伪造目标或启用状态",
    });
  }
  if (resolution.status !== "unresolved" && resolution.targetAgentId === null) {
    context.addIssue({
      code: "custom",
      path: ["targetAgentId"],
      message: "已解析智能体引用必须登记明确目标",
    });
  }
  if (
    resolution.status === "exact"
    && resolution.targetAgentId !== resolution.sourceAgentId
  ) {
    context.addIssue({
      code: "custom",
      path: ["targetAgentId"],
      message: "精确解析不得静默改写智能体 ID",
    });
  }
});
export type CrossCourseAgentResolution = z.infer<
  typeof CrossCourseAgentResolutionSchema
>;

export const CrossCourseAgentRuleChapterSchema = z.object({
  chapterId: V2IdentifierSchema,
  order: z.number().int().positive().max(64),
  eventRef: z.object({
    eventId: V2IdentifierSchema,
    triggerKind: z.enum(["on_action", "on_evidence_count", "on_section_submit"]),
    triggerRef: V2IdentifierSchema,
  }).strict(),
  ruleId: V2IdentifierSchema,
  selectWhen: z.string().min(1).max(1_000),
  skipWhen: z.string().min(1).max(1_000),
  sourceAffectedAgentIds: z.array(V2IdentifierSchema).min(1).max(32),
  sourceCandidateAgentIds: z.array(V2IdentifierSchema).min(1).max(32),
  agentResolutions: z.array(CrossCourseAgentResolutionSchema).min(1).max(32),
  resolvedAffectedAgentIds: z.array(V2IdentifierSchema).max(14),
  resolvedCandidateAgentIds: z.array(V2IdentifierSchema).max(14),
  maximumSelectedAgents: z.number().int().positive().max(14),
  teacherGateIds: z.array(V2IdentifierSchema).min(1).max(8),
  ruleHash: V2ContentHashSchema,
}).strict().superRefine((chapter, context) => {
  const unique = (values: readonly string[]) => new Set(values).size === values.length;
  for (const [path, values] of [
    ["sourceAffectedAgentIds", chapter.sourceAffectedAgentIds],
    ["sourceCandidateAgentIds", chapter.sourceCandidateAgentIds],
    ["resolvedAffectedAgentIds", chapter.resolvedAffectedAgentIds],
    ["resolvedCandidateAgentIds", chapter.resolvedCandidateAgentIds],
  ] as const) {
    if (!unique(values)) {
      context.addIssue({ code: "custom", path: [path], message: "智能体集合不得包含重复 ID" });
    }
  }
  const sourceCandidates = new Set(chapter.sourceCandidateAgentIds);
  if (chapter.sourceAffectedAgentIds.some((id) => !sourceCandidates.has(id))) {
    context.addIssue({
      code: "custom",
      path: ["sourceAffectedAgentIds"],
      message: "受影响智能体必须属于课程声明的候选集合",
    });
  }
  const resolutionSources = chapter.agentResolutions.map((item) => item.sourceAgentId);
  if (
    !unique(resolutionSources)
    || resolutionSources.length !== chapter.sourceCandidateAgentIds.length
    || chapter.sourceCandidateAgentIds.some((id) => !resolutionSources.includes(id))
  ) {
    context.addIssue({
      code: "custom",
      path: ["agentResolutions"],
      message: "每个课程候选智能体必须且只能有一条显式解析记录",
    });
  }
  const baselineTargets = chapter.agentResolutions
    .filter((item) => (
      item.targetKind === "baseline_topology"
      && item.status !== "unresolved"
      && item.targetAgentId !== null
    ))
    .map((item) => item.targetAgentId!);
  const expectedCandidates = baselineTargets.filter((id) => (
    chapter.sourceCandidateAgentIds.some((sourceId) => (
      chapter.agentResolutions.some((item) => (
        item.sourceAgentId === sourceId && item.targetAgentId === id
      ))
    ))
  ));
  if (
    !unique(baselineTargets)
    || chapter.resolvedCandidateAgentIds.length !== expectedCandidates.length
    || expectedCandidates.some((id) => !chapter.resolvedCandidateAgentIds.includes(id))
  ) {
    context.addIssue({
      code: "custom",
      path: ["resolvedCandidateAgentIds"],
      message: "十四节点候选集合必须与显式基线解析完全一致",
    });
  }
  const expectedAffected = chapter.agentResolutions
    .filter((item) => (
      chapter.sourceAffectedAgentIds.includes(item.sourceAgentId)
      && item.targetKind === "baseline_topology"
      && item.status !== "unresolved"
      && item.targetAgentId !== null
    ))
    .map((item) => item.targetAgentId!);
  if (
    chapter.resolvedAffectedAgentIds.length !== expectedAffected.length
    || expectedAffected.some((id) => !chapter.resolvedAffectedAgentIds.includes(id))
  ) {
    context.addIssue({
      code: "custom",
      path: ["resolvedAffectedAgentIds"],
      message: "十四节点受影响集合必须与显式基线解析完全一致",
    });
  }
  if (chapter.maximumSelectedAgents > chapter.sourceCandidateAgentIds.length) {
    context.addIssue({
      code: "custom",
      path: ["maximumSelectedAgents"],
      message: "最大唤醒数量不得超过课程声明的候选智能体数量",
    });
  }
});
export type CrossCourseAgentRuleChapter = z.infer<
  typeof CrossCourseAgentRuleChapterSchema
>;

export const CrossCourseAgentRuleCourseSchema = z.object({
  courseReleaseRef: CourseReleaseReferenceSchema.extend({
    courseId: V2CourseIdSchema,
  }).strict(),
  scenarioReleaseRef: ScenarioReleaseReferenceSchema,
  runtimeEligibility: AgentRuleRuntimeEligibilitySchema,
  chapters: z.array(CrossCourseAgentRuleChapterSchema).min(1).max(16),
}).strict().superRefine((course, context) => {
  const expected = expectedChapterCounts[course.courseReleaseRef.courseId];
  const ids = course.chapters.map((chapter) => chapter.chapterId);
  const orders = course.chapters.map((chapter) => chapter.order);
  if (
    course.chapters.length !== expected
    || new Set(ids).size !== expected
    || orders.join(",") !== Array.from({ length: expected }, (_, i) => i + 1).join(",")
  ) {
    context.addIssue({
      code: "custom",
      path: ["chapters"],
      message: "课程规则必须覆盖冻结章节且保持连续顺序",
    });
  }
  const hasUnresolved = course.chapters.some((chapter) => (
    chapter.agentResolutions.some((resolution) => resolution.status === "unresolved")
  ));
  if (
    (course.runtimeEligibility.status === "runtime_ready" && hasUnresolved)
    || (course.runtimeEligibility.status === "unresolved_agent_ref" && !hasUnresolved)
  ) {
    context.addIssue({
      code: "custom",
      path: ["runtimeEligibility"],
      message: "运行资格必须与智能体引用解析状态一致",
    });
  }
});
export type CrossCourseAgentRuleCourse = z.infer<
  typeof CrossCourseAgentRuleCourseSchema
>;

export const CrossCourseAgentRuleManifestSchema = z.object({
  schemaVersion: z.literal(CrossCourseAgentRuleManifestSchemaVersion),
  manifestId: V2IdentifierSchema,
  generatedAt: z.string().datetime(),
  topologyHash: V2ContentHashSchema,
  baselineTopologyAgentIds: z.array(V2IdentifierSchema).length(14),
  contentSnapshotHash: V2ContentHashSchema,
  courses: z.array(CrossCourseAgentRuleCourseSchema).length(5),
  manifestHash: V2ContentHashSchema,
}).strict().superRefine((manifest, context) => {
  const baselineIds = new Set(manifest.baselineTopologyAgentIds);
  const ids = manifest.courses.map((course) => course.courseReleaseRef.courseId);
  if (
    baselineIds.size !== 14
  ) {
    context.addIssue({
      code: "custom",
      path: ["baselineTopologyAgentIds"],
      message: "基线拓扑必须登记十四个唯一智能体 ID",
    });
  }
  for (const [courseIndex, course] of manifest.courses.entries()) {
    for (const [chapterIndex, chapter] of course.chapters.entries()) {
      const baselineTargets = chapter.agentResolutions.flatMap((resolution) => (
        resolution.targetKind === "baseline_topology"
        && resolution.targetAgentId !== null
          ? [resolution.targetAgentId]
          : []
      ));
      if (
        baselineTargets.some((agentId) => !baselineIds.has(agentId))
        || chapter.resolvedAffectedAgentIds.some((agentId) => !baselineIds.has(agentId))
        || chapter.resolvedCandidateAgentIds.some((agentId) => !baselineIds.has(agentId))
      ) {
        context.addIssue({
          code: "custom",
          path: ["courses", courseIndex, "chapters", chapterIndex],
          message: "基线解析目标必须属于冻结的十四节点拓扑",
        });
      }
    }
  }
  if (
    new Set(ids).size !== V2CourseIdSchema.options.length
    || V2CourseIdSchema.options.some((id) => !ids.includes(id))
    || manifest.courses.reduce((sum, course) => sum + course.chapters.length, 0) !== 30
  ) {
    context.addIssue({
      code: "custom",
      path: ["courses"],
      message: "跨课程规则必须且只能覆盖五门冻结课程的三十个章节",
    });
  }
});
export type CrossCourseAgentRuleManifest = z.infer<
  typeof CrossCourseAgentRuleManifestSchema
>;

export const AgentAblationControlHashesSchema = z.object({
  caseSuiteHash: V2ContentHashSchema,
  courseScenarioSetHash: V2ContentHashSchema,
  knowledgeSnapshotHash: V2ContentHashSchema,
  modelProfileHash: V2ContentHashSchema,
  toolPolicyHash: V2ContentHashSchema,
  rubricHash: V2ContentHashSchema,
  topologyHash: V2ContentHashSchema,
  worldGateHash: V2ContentHashSchema,
  teacherGateHash: V2ContentHashSchema,
  budgetHash: V2ContentHashSchema,
  seed: z.number().int().nonnegative(),
  temperature: z.number().min(0).max(2),
  conditionLabelsHidden: z.literal(false),
  failuresRetained: z.literal(true),
}).strict();
export type AgentAblationControlHashes = z.infer<
  typeof AgentAblationControlHashesSchema
>;

export const AgentAblationGroupSchema = z.object({
  groupId: z.enum(["group-1", "group-2", "group-3"]),
  conditionCode: z.enum(["A", "B", "C"]),
  architecturePolicyHash: V2ContentHashSchema,
  runCount: z.number().int().nonnegative(),
  failedRunCount: z.number().int().nonnegative(),
  metrics: z.object({
    taskCompletionRate: z.number().min(0).max(1).nullable(),
    collaborationNecessityRate: z.number().min(0).max(1).nullable(),
    irrelevantInvocationRate: z.number().min(0).max(1).nullable(),
    unauthorizedWriteAttemptCount: z.number().int().nonnegative(),
    unauthorizedWriteCommitCount: z.number().int().nonnegative(),
    evidenceCoverageRate: z.number().min(0).max(1).nullable(),
    teacherRevisionCount: z.number().int().nonnegative(),
    latencyMsP50: z.number().nonnegative().nullable(),
    estimatedCostCny: z.number().nonnegative().nullable(),
  }).strict(),
}).strict().superRefine((group, context) => {
  if (group.failedRunCount > group.runCount) {
    context.addIssue({
      code: "custom",
      path: ["failedRunCount"],
      message: "失败运行数不得超过实际运行数",
    });
  }
  if (
    group.runCount === 0
    && Object.entries(group.metrics).some(([key, value]) => (
      key.endsWith("Count") ? value !== 0 : value !== null
    ))
  ) {
    context.addIssue({
      code: "custom",
      path: ["metrics"],
      message: "零样本组不得伪造比率、延迟、成本或计数",
    });
  }
});
export type AgentAblationGroup = z.infer<typeof AgentAblationGroupSchema>;

export const AgentAblationGateSchema = z.object({
  gateId: z.enum([
    "runtime_eligibility",
    "control_hash_consistency",
    "observation_integrity",
    "balanced_repetitions",
    "no_authoritative_write",
    "blind_review_complete",
    "minimum_effect_margin",
    "no_score_imputation",
  ]),
  status: z.enum(["passed", "failed", "insufficient"]),
  actual: z.string().trim().min(1).max(600),
  requirement: z.string().trim().min(1).max(600),
  evidenceRefs: z.array(V2IdentifierSchema).max(64),
}).strict();
export type AgentAblationGate = z.infer<typeof AgentAblationGateSchema>;

export const AgentAblationEvidenceSchema = z.object({
  schemaVersion: z.literal(AgentAblationEvidenceSchemaVersion),
  experimentId: V2IdentifierSchema,
  protocolVersion: z.string().trim().min(1).max(120),
  preregistrationHash: V2ContentHashSchema,
  ruleManifestHash: V2ContentHashSchema,
  reportHash: V2ContentHashSchema,
  generatedAt: z.string().datetime(),
  runStatus: z.enum(["not_ready", "running", "frozen", "completed", "failed"]),
  conclusion: z.enum([
    "insufficient_evidence",
    "hypothesis_not_supported",
    "hypothesis_supported",
  ]),
  claimBoundary: z.string().trim().min(1).max(1_500),
  observationCount: z.number().int().nonnegative(),
  eligibility: z.array(z.object({
    courseId: V2CourseIdSchema,
    status: AgentRuleRuntimeEligibilitySchema.shape.status,
    reasonCode: V2IdentifierSchema,
  }).strict()).length(5),
  controls: AgentAblationControlHashesSchema,
  groups: z.array(AgentAblationGroupSchema).length(3),
  gates: z.array(AgentAblationGateSchema).length(8),
  blindReviewStatus: z.literal("not_configured"),
}).strict().superRefine((evidence, context) => {
  const courseIds = evidence.eligibility.map((item) => item.courseId);
  const groupIds = evidence.groups.map((item) => item.groupId);
  const gateIds = evidence.gates.map((item) => item.gateId);
  if (
    new Set(courseIds).size !== 5
    || V2CourseIdSchema.options.some((id) => !courseIds.includes(id))
  ) {
    context.addIssue({ code: "custom", path: ["eligibility"], message: "实验资格必须覆盖五门冻结课程" });
  }
  if (
    new Set(groupIds).size !== 3
    || !["group-1", "group-2", "group-3"].every((id) => groupIds.includes(id as never))
  ) {
    context.addIssue({ code: "custom", path: ["groups"], message: "消融必须包含三个唯一预登记对照组" });
  }
  if (new Set(gateIds).size !== 8) {
    context.addIssue({ code: "custom", path: ["gates"], message: "消融证据门不得重复或缺失" });
  }
  const conditionCodes = evidence.groups.map((item) => item.conditionCode);
  if (
    new Set(conditionCodes).size !== 3
    || !["A", "B", "C"].every((code) => conditionCodes.includes(code as never))
  ) {
    context.addIssue({
      code: "custom",
      path: ["groups"],
      message: "未配置盲评时必须诚实公开三个唯一预登记条件标签",
    });
  }
  if (evidence.observationCount === 0) {
    if (
      evidence.runStatus !== "not_ready"
      || evidence.conclusion !== "insufficient_evidence"
      || evidence.groups.some((group) => group.runCount !== 0)
      || evidence.gates.some((gate) => (
        gate.gateId !== "no_score_imputation" && gate.status !== "insufficient"
      ))
      || evidence.gates.find((gate) => gate.gateId === "no_score_imputation")?.status !== "passed"
    ) {
      context.addIssue({
        code: "custom",
        path: ["observationCount"],
        message: "零样本只能形成未就绪、不足证据且不补分的诚实结论",
      });
    }
  }
  if (evidence.conclusion === "hypothesis_supported") {
    context.addIssue({
      code: "custom",
      path: ["conclusion"],
      message: "V2.0.0 尚未配置私有随机盲评，禁止宣称支持预登记假设",
    });
  }
});
export type AgentAblationEvidence = z.infer<
  typeof AgentAblationEvidenceSchema
>;
