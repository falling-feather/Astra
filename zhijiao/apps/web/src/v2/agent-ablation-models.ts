import { WireFormatError } from "./wire";

export const CrossCourseAgentRuleManifestSchemaVersion =
  "cross-course-agent-rule-manifest/2.0.0" as const;
export const AgentAblationEvidenceSchemaVersion =
  "agent-ablation-evidence/2.0.0" as const;

export const V2CourseIds = [
  "course-xunpu-intangible-media",
  "course-village-super-multiplatform",
  "course-village-super-postpublication-context",
  "course-ai-tourism-copyright-governance",
  "course-scenic-rain-emergency-reporting",
] as const;

export type V2CourseId = typeof V2CourseIds[number];
export type AgentRuleRuntimeStatus =
  | "runtime_ready"
  | "content_only"
  | "unresolved_agent_ref"
  | "version_hash_drift"
  | "runtime_unavailable";
export type AgentAblationRunStatus =
  | "not_ready"
  | "running"
  | "frozen"
  | "completed"
  | "failed";
export type AgentAblationConclusion =
  | "insufficient_evidence"
  | "hypothesis_not_supported"
  | "hypothesis_supported";
export type AgentAblationGateStatus = "passed" | "failed" | "insufficient";

interface CourseReleaseReference {
  courseId: V2CourseId;
  releaseId: string;
  version: number;
  contentHash: string;
}

interface ScenarioReleaseReference {
  scenarioId: string;
  version: string;
  contentHash: string;
}

export interface AgentRuleRuntimeEligibility {
  status: AgentRuleRuntimeStatus;
  reasonCode: string;
  explanation: string;
}

export interface CrossCourseAgentResolution {
  sourceAgentId: string;
  targetKind: "baseline_topology" | "supporting_capability";
  targetAgentId: string | null;
  status: "exact" | "mapped" | "unresolved";
  enabled: boolean;
}

export interface CrossCourseAgentRuleChapter {
  chapterId: string;
  order: number;
  eventRef: {
    eventId: string;
    triggerKind: "on_action" | "on_evidence_count" | "on_section_submit";
    triggerRef: string;
  };
  ruleId: string;
  sourceAffectedAgentIds: string[];
  sourceCandidateAgentIds: string[];
  agentResolutions: CrossCourseAgentResolution[];
  resolvedAffectedAgentIds: string[];
  resolvedCandidateAgentIds: string[];
  maximumSelectedAgents: number;
  selectWhen: string;
  skipWhen: string;
  teacherGateIds: string[];
  ruleHash: string;
}

export interface CrossCourseAgentRuleCourse {
  courseReleaseRef: CourseReleaseReference;
  scenarioReleaseRef: ScenarioReleaseReference;
  runtimeEligibility: AgentRuleRuntimeEligibility;
  chapters: CrossCourseAgentRuleChapter[];
}

export interface CrossCourseAgentRuleManifest {
  schemaVersion: typeof CrossCourseAgentRuleManifestSchemaVersion;
  manifestId: string;
  generatedAt: string;
  topologyHash: string;
  baselineTopologyAgentIds: string[];
  contentSnapshotHash: string;
  courses: CrossCourseAgentRuleCourse[];
  manifestHash: string;
}

export interface AgentAblationMetrics {
  taskCompletionRate: number | null;
  collaborationNecessityRate: number | null;
  irrelevantInvocationRate: number | null;
  unauthorizedWriteAttemptCount: number;
  unauthorizedWriteCommitCount: number;
  evidenceCoverageRate: number | null;
  teacherRevisionCount: number;
  latencyMsP50: number | null;
  estimatedCostCny: number | null;
}

export interface AgentAblationGroup {
  groupId: "group-1" | "group-2" | "group-3";
  conditionCode: "A" | "B" | "C";
  architecturePolicyHash: string;
  runCount: number;
  failedRunCount: number;
  metrics: AgentAblationMetrics;
}

export const AgentAblationGateIds = [
  "runtime_eligibility",
  "control_hash_consistency",
  "observation_integrity",
  "balanced_repetitions",
  "no_authoritative_write",
  "blind_review_complete",
  "minimum_effect_margin",
  "no_score_imputation",
] as const;

export type AgentAblationGateId = typeof AgentAblationGateIds[number];

export interface AgentAblationGate {
  gateId: AgentAblationGateId;
  status: AgentAblationGateStatus;
  actual: string;
  requirement: string;
  evidenceRefs: string[];
}

export interface AgentAblationEvidence {
  schemaVersion: typeof AgentAblationEvidenceSchemaVersion;
  experimentId: string;
  protocolVersion: string;
  preregistrationHash: string;
  ruleManifestHash: string;
  reportHash: string;
  generatedAt: string;
  runStatus: AgentAblationRunStatus;
  conclusion: AgentAblationConclusion;
  claimBoundary: string;
  observationCount: number;
  eligibility: Array<{
    courseId: V2CourseId;
    status: AgentRuleRuntimeStatus;
    reasonCode: string;
  }>;
  controls: {
    caseSuiteHash: string;
    courseScenarioSetHash: string;
    knowledgeSnapshotHash: string;
    modelProfileHash: string;
    toolPolicyHash: string;
    rubricHash: string;
    topologyHash: string;
    worldGateHash: string;
    teacherGateHash: string;
    budgetHash: string;
    seed: number;
    temperature: number;
    conditionLabelsHidden: false;
    failuresRetained: true;
  };
  groups: AgentAblationGroup[];
  gates: AgentAblationGate[];
  blindReviewStatus: "not_configured";
}

type UnknownRecord = Record<string, unknown>;

function objectOf(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WireFormatError(`${label} 必须是对象`);
  }
  return value as UnknownRecord;
}

function exactObject(
  value: unknown,
  keys: readonly string[],
  label: string,
): UnknownRecord {
  const object = objectOf(value, label);
  const actual = Object.keys(object).sort();
  const expected = [...keys].sort();
  if (actual.join("\u0000") !== expected.join("\u0000")) {
    throw new WireFormatError(`${label} 字段不符合冻结接口`);
  }
  return object;
}

function enumOf<const T extends readonly string[]>(
  value: unknown,
  options: T,
  label: string,
): T[number] {
  if (typeof value !== "string" || !options.includes(value)) {
    throw new WireFormatError(`${label} 不符合冻结枚举`);
  }
  return value as T[number];
}

function identifierOf(value: unknown, label: string): string {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > 320
    || !/^[a-zA-Z0-9][a-zA-Z0-9._:/@-]*$/u.test(value)
  ) {
    throw new WireFormatError(`${label} 不是合法标识`);
  }
  return value;
}

function textOf(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string") {
    throw new WireFormatError(`${label} 必须是文本`);
  }
  const text = value.trim();
  if (text.length < 1 || text.length > maximum) {
    throw new WireFormatError(`${label} 长度不符合冻结接口`);
  }
  return text;
}

function hashOf(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new WireFormatError(`${label} 必须是 64 位内容哈希`);
  }
  return value;
}

function dateTimeOf(value: unknown, label: string): string {
  if (
    typeof value !== "string"
    || !value.includes("T")
    || !Number.isFinite(Date.parse(value))
  ) {
    throw new WireFormatError(`${label} 必须是 ISO 日期时间`);
  }
  return value;
}

function integerOf(
  value: unknown,
  label: string,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new WireFormatError(`${label} 必须是 ${minimum}—${maximum} 范围内的整数`);
  }
  return value as number;
}

function numberOf(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new WireFormatError(`${label} 必须是 ${minimum}—${maximum} 范围内的数值`);
  }
  return value;
}

function nullableNumberOf(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number | null {
  return value === null ? null : numberOf(value, label, minimum, maximum);
}

function booleanLiteral<const T extends boolean>(
  value: unknown,
  expected: T,
  label: string,
): T {
  if (value !== expected) {
    throw new WireFormatError(`${label} 必须为 ${String(expected)}`);
  }
  return expected;
}

function identifierListOf(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): string[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw new WireFormatError(`${label} 数量不符合冻结接口`);
  }
  const items = value.map((item, index) => identifierOf(item, `${label}[${index}]`));
  if (new Set(items).size !== items.length) {
    throw new WireFormatError(`${label} 不得包含重复标识`);
  }
  return items;
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && new Set(left).size === left.length
    && left.every((item) => right.includes(item));
}

function parseCourseReleaseReference(value: unknown): CourseReleaseReference {
  const object = exactObject(value, [
    "courseId",
    "releaseId",
    "version",
    "contentHash",
  ], "CrossCourseAgentRuleCourse.courseReleaseRef");
  return {
    courseId: enumOf(object.courseId, V2CourseIds, "courseReleaseRef.courseId"),
    releaseId: identifierOf(object.releaseId, "courseReleaseRef.releaseId"),
    version: integerOf(object.version, "courseReleaseRef.version", 1),
    contentHash: hashOf(object.contentHash, "courseReleaseRef.contentHash"),
  };
}

function parseScenarioReleaseReference(value: unknown): ScenarioReleaseReference {
  const object = exactObject(value, [
    "scenarioId",
    "version",
    "contentHash",
  ], "CrossCourseAgentRuleCourse.scenarioReleaseRef");
  return {
    scenarioId: identifierOf(object.scenarioId, "scenarioReleaseRef.scenarioId"),
    version: textOf(object.version, "scenarioReleaseRef.version", 120),
    contentHash: hashOf(object.contentHash, "scenarioReleaseRef.contentHash"),
  };
}

const runtimeStatuses = [
  "runtime_ready",
  "content_only",
  "unresolved_agent_ref",
  "version_hash_drift",
  "runtime_unavailable",
] as const;

function parseRuntimeEligibility(value: unknown): AgentRuleRuntimeEligibility {
  const object = exactObject(value, [
    "status",
    "reasonCode",
    "explanation",
  ], "AgentRuleRuntimeEligibility");
  return {
    status: enumOf(object.status, runtimeStatuses, "runtimeEligibility.status"),
    reasonCode: identifierOf(object.reasonCode, "runtimeEligibility.reasonCode"),
    explanation: textOf(object.explanation, "runtimeEligibility.explanation", 800),
  };
}

function parseResolution(
  value: unknown,
  label: string,
): CrossCourseAgentResolution {
  const object = exactObject(value, [
    "sourceAgentId",
    "targetKind",
    "targetAgentId",
    "status",
    "enabled",
  ], label);
  const sourceAgentId = identifierOf(object.sourceAgentId, `${label}.sourceAgentId`);
  const targetKind = enumOf(
    object.targetKind,
    ["baseline_topology", "supporting_capability"] as const,
    `${label}.targetKind`,
  );
  const targetAgentId = object.targetAgentId === null
    ? null
    : identifierOf(object.targetAgentId, `${label}.targetAgentId`);
  const status = enumOf(
    object.status,
    ["exact", "mapped", "unresolved"] as const,
    `${label}.status`,
  );
  if (typeof object.enabled !== "boolean") {
    throw new WireFormatError(`${label}.enabled 必须是布尔值`);
  }
  if (status === "unresolved" && (targetAgentId !== null || object.enabled)) {
    throw new WireFormatError(`${label} 未解析引用不得伪造目标或启用状态`);
  }
  if (status !== "unresolved" && targetAgentId === null) {
    throw new WireFormatError(`${label} 已解析引用必须登记明确目标`);
  }
  if (status === "exact" && targetAgentId !== sourceAgentId) {
    throw new WireFormatError(`${label} 精确解析不得改写智能体 ID`);
  }
  return {
    sourceAgentId,
    targetKind,
    targetAgentId,
    status,
    enabled: object.enabled,
  };
}

function parseChapter(
  value: unknown,
  courseLabel: string,
  index: number,
): CrossCourseAgentRuleChapter {
  const label = `${courseLabel}.chapters[${index}]`;
  const object = exactObject(value, [
    "chapterId",
    "order",
    "eventRef",
    "ruleId",
    "sourceAffectedAgentIds",
    "sourceCandidateAgentIds",
    "agentResolutions",
    "resolvedAffectedAgentIds",
    "resolvedCandidateAgentIds",
    "maximumSelectedAgents",
    "selectWhen",
    "skipWhen",
    "teacherGateIds",
    "ruleHash",
  ], label);
  const event = exactObject(object.eventRef, [
    "eventId",
    "triggerKind",
    "triggerRef",
  ], `${label}.eventRef`);
  const sourceAffectedAgentIds = identifierListOf(
    object.sourceAffectedAgentIds,
    `${label}.sourceAffectedAgentIds`,
    1,
    32,
  );
  const sourceCandidateAgentIds = identifierListOf(
    object.sourceCandidateAgentIds,
    `${label}.sourceCandidateAgentIds`,
    1,
    32,
  );
  if (!sourceAffectedAgentIds.every((id) => sourceCandidateAgentIds.includes(id))) {
    throw new WireFormatError(`${label} 受影响集合必须属于课程候选集合`);
  }
  if (!Array.isArray(object.agentResolutions)
    || object.agentResolutions.length < 1
    || object.agentResolutions.length > 32) {
    throw new WireFormatError(`${label}.agentResolutions 数量不符合冻结接口`);
  }
  const agentResolutions = object.agentResolutions.map((item, resolutionIndex) => (
    parseResolution(item, `${label}.agentResolutions[${resolutionIndex}]`)
  ));
  const resolutionSources = agentResolutions.map((item) => item.sourceAgentId);
  if (!sameSet(resolutionSources, sourceCandidateAgentIds)) {
    throw new WireFormatError(`${label} 每个课程候选必须且只能有一条解析记录`);
  }
  const resolvedAffectedAgentIds = identifierListOf(
    object.resolvedAffectedAgentIds,
    `${label}.resolvedAffectedAgentIds`,
    0,
    14,
  );
  const resolvedCandidateAgentIds = identifierListOf(
    object.resolvedCandidateAgentIds,
    `${label}.resolvedCandidateAgentIds`,
    0,
    14,
  );
  const expectedCandidates = agentResolutions.flatMap((resolution) => (
    resolution.targetKind === "baseline_topology"
    && resolution.status !== "unresolved"
    && resolution.targetAgentId !== null
      ? [resolution.targetAgentId]
      : []
  ));
  const expectedAffected = agentResolutions.flatMap((resolution) => (
    sourceAffectedAgentIds.includes(resolution.sourceAgentId)
    && resolution.targetKind === "baseline_topology"
    && resolution.status !== "unresolved"
    && resolution.targetAgentId !== null
      ? [resolution.targetAgentId]
      : []
  ));
  if (!sameSet(resolvedCandidateAgentIds, expectedCandidates)) {
    throw new WireFormatError(`${label} 十四节点候选集合与显式解析不一致`);
  }
  if (!sameSet(resolvedAffectedAgentIds, expectedAffected)) {
    throw new WireFormatError(`${label} 十四节点受影响集合与显式解析不一致`);
  }
  const maximumSelectedAgents = integerOf(
    object.maximumSelectedAgents,
    `${label}.maximumSelectedAgents`,
    1,
    14,
  );
  if (maximumSelectedAgents > sourceCandidateAgentIds.length) {
    throw new WireFormatError(`${label} 最大唤醒数量超过源候选集合`);
  }
  return {
    chapterId: identifierOf(object.chapterId, `${label}.chapterId`),
    order: integerOf(object.order, `${label}.order`, 1, 64),
    eventRef: {
      eventId: identifierOf(event.eventId, `${label}.eventRef.eventId`),
      triggerKind: enumOf(
        event.triggerKind,
        ["on_action", "on_evidence_count", "on_section_submit"] as const,
        `${label}.eventRef.triggerKind`,
      ),
      triggerRef: identifierOf(event.triggerRef, `${label}.eventRef.triggerRef`),
    },
    ruleId: identifierOf(object.ruleId, `${label}.ruleId`),
    sourceAffectedAgentIds,
    sourceCandidateAgentIds,
    agentResolutions,
    resolvedAffectedAgentIds,
    resolvedCandidateAgentIds,
    maximumSelectedAgents,
    selectWhen: textOf(object.selectWhen, `${label}.selectWhen`, 1_000),
    skipWhen: textOf(object.skipWhen, `${label}.skipWhen`, 1_000),
    teacherGateIds: identifierListOf(
      object.teacherGateIds,
      `${label}.teacherGateIds`,
      1,
      8,
    ),
    ruleHash: hashOf(object.ruleHash, `${label}.ruleHash`),
  };
}

function parseRuleCourse(value: unknown, index: number): CrossCourseAgentRuleCourse {
  const label = `CrossCourseAgentRuleManifest.courses[${index}]`;
  const object = exactObject(value, [
    "courseReleaseRef",
    "scenarioReleaseRef",
    "runtimeEligibility",
    "chapters",
  ], label);
  const courseReleaseRef = parseCourseReleaseReference(object.courseReleaseRef);
  if (!Array.isArray(object.chapters)) {
    throw new WireFormatError(`${label}.chapters 必须是数组`);
  }
  const chapters = object.chapters.map((chapter, chapterIndex) => (
    parseChapter(chapter, label, chapterIndex)
  ));
  const expectedCount: Record<V2CourseId, number> = {
    "course-xunpu-intangible-media": 7,
    "course-village-super-multiplatform": 6,
    "course-village-super-postpublication-context": 5,
    "course-ai-tourism-copyright-governance": 6,
    "course-scenic-rain-emergency-reporting": 6,
  };
  const count = expectedCount[courseReleaseRef.courseId];
  if (
    chapters.length !== count
    || new Set(chapters.map((chapter) => chapter.chapterId)).size !== count
    || chapters.some((chapter, chapterIndex) => chapter.order !== chapterIndex + 1)
  ) {
    throw new WireFormatError(`${label} 必须覆盖冻结章节并保持连续顺序`);
  }
  const runtimeEligibility = parseRuntimeEligibility(object.runtimeEligibility);
  const hasUnresolved = chapters.some((chapter) => (
    chapter.agentResolutions.some((resolution) => resolution.status === "unresolved")
  ));
  if (
    (runtimeEligibility.status === "runtime_ready" && hasUnresolved)
    || (runtimeEligibility.status === "unresolved_agent_ref" && !hasUnresolved)
  ) {
    throw new WireFormatError(`${label} 运行资格与智能体解析状态不一致`);
  }
  return {
    courseReleaseRef,
    scenarioReleaseRef: parseScenarioReleaseReference(object.scenarioReleaseRef),
    runtimeEligibility,
    chapters,
  };
}

export function parseCrossCourseAgentRuleManifest(
  value: unknown,
): CrossCourseAgentRuleManifest {
  const object = exactObject(value, [
    "schemaVersion",
    "manifestId",
    "generatedAt",
    "topologyHash",
    "baselineTopologyAgentIds",
    "contentSnapshotHash",
    "courses",
    "manifestHash",
  ], "CrossCourseAgentRuleManifest");
  if (object.schemaVersion !== CrossCourseAgentRuleManifestSchemaVersion) {
    throw new WireFormatError("CrossCourseAgentRuleManifest 版本漂移");
  }
  const baselineTopologyAgentIds = identifierListOf(
    object.baselineTopologyAgentIds,
    "CrossCourseAgentRuleManifest.baselineTopologyAgentIds",
    14,
    14,
  );
  if (!Array.isArray(object.courses) || object.courses.length !== 5) {
    throw new WireFormatError("CrossCourseAgentRuleManifest 必须覆盖五门课程");
  }
  const courses = object.courses.map(parseRuleCourse);
  const courseIds = courses.map((course) => course.courseReleaseRef.courseId);
  if (!sameSet(courseIds, V2CourseIds)) {
    throw new WireFormatError("CrossCourseAgentRuleManifest 课程集合不符合冻结范围");
  }
  if (courses.flatMap((course) => course.chapters).length !== 30) {
    throw new WireFormatError("CrossCourseAgentRuleManifest 必须覆盖三十个章节");
  }
  for (const course of courses) {
    for (const chapter of course.chapters) {
      const baselineTargets = chapter.agentResolutions.flatMap((resolution) => (
        resolution.targetKind === "baseline_topology"
        && resolution.targetAgentId !== null
          ? [resolution.targetAgentId]
          : []
      ));
      if (
        baselineTargets.some((id) => !baselineTopologyAgentIds.includes(id))
        || chapter.resolvedAffectedAgentIds.some((id) => !baselineTopologyAgentIds.includes(id))
        || chapter.resolvedCandidateAgentIds.some((id) => !baselineTopologyAgentIds.includes(id))
      ) {
        throw new WireFormatError("章节的十四节点引用超出冻结拓扑");
      }
    }
  }
  return {
    schemaVersion: CrossCourseAgentRuleManifestSchemaVersion,
    manifestId: identifierOf(object.manifestId, "CrossCourseAgentRuleManifest.manifestId"),
    generatedAt: dateTimeOf(object.generatedAt, "CrossCourseAgentRuleManifest.generatedAt"),
    topologyHash: hashOf(object.topologyHash, "CrossCourseAgentRuleManifest.topologyHash"),
    baselineTopologyAgentIds,
    contentSnapshotHash: hashOf(
      object.contentSnapshotHash,
      "CrossCourseAgentRuleManifest.contentSnapshotHash",
    ),
    courses,
    manifestHash: hashOf(object.manifestHash, "CrossCourseAgentRuleManifest.manifestHash"),
  };
}

function parseMetrics(value: unknown, label: string): AgentAblationMetrics {
  const object = exactObject(value, [
    "taskCompletionRate",
    "collaborationNecessityRate",
    "irrelevantInvocationRate",
    "unauthorizedWriteAttemptCount",
    "unauthorizedWriteCommitCount",
    "evidenceCoverageRate",
    "teacherRevisionCount",
    "latencyMsP50",
    "estimatedCostCny",
  ], label);
  return {
    taskCompletionRate: nullableNumberOf(object.taskCompletionRate, `${label}.taskCompletionRate`, 0, 1),
    collaborationNecessityRate: nullableNumberOf(
      object.collaborationNecessityRate,
      `${label}.collaborationNecessityRate`,
      0,
      1,
    ),
    irrelevantInvocationRate: nullableNumberOf(
      object.irrelevantInvocationRate,
      `${label}.irrelevantInvocationRate`,
      0,
      1,
    ),
    unauthorizedWriteAttemptCount: integerOf(
      object.unauthorizedWriteAttemptCount,
      `${label}.unauthorizedWriteAttemptCount`,
      0,
    ),
    unauthorizedWriteCommitCount: integerOf(
      object.unauthorizedWriteCommitCount,
      `${label}.unauthorizedWriteCommitCount`,
      0,
    ),
    evidenceCoverageRate: nullableNumberOf(
      object.evidenceCoverageRate,
      `${label}.evidenceCoverageRate`,
      0,
      1,
    ),
    teacherRevisionCount: integerOf(
      object.teacherRevisionCount,
      `${label}.teacherRevisionCount`,
      0,
    ),
    latencyMsP50: nullableNumberOf(
      object.latencyMsP50,
      `${label}.latencyMsP50`,
      0,
      Number.MAX_SAFE_INTEGER,
    ),
    estimatedCostCny: nullableNumberOf(
      object.estimatedCostCny,
      `${label}.estimatedCostCny`,
      0,
      Number.MAX_SAFE_INTEGER,
    ),
  };
}

function parseGroup(value: unknown, index: number): AgentAblationGroup {
  const label = `AgentAblationEvidence.groups[${index}]`;
  const object = exactObject(value, [
    "groupId",
    "conditionCode",
    "architecturePolicyHash",
    "runCount",
    "failedRunCount",
    "metrics",
  ], label);
  const runCount = integerOf(object.runCount, `${label}.runCount`, 0);
  const failedRunCount = integerOf(object.failedRunCount, `${label}.failedRunCount`, 0);
  if (failedRunCount > runCount) {
    throw new WireFormatError(`${label} 失败运行数不得超过实际运行数`);
  }
  const metrics = parseMetrics(object.metrics, `${label}.metrics`);
  if (runCount === 0 && (
    metrics.taskCompletionRate !== null
    || metrics.collaborationNecessityRate !== null
    || metrics.irrelevantInvocationRate !== null
    || metrics.unauthorizedWriteAttemptCount !== 0
    || metrics.unauthorizedWriteCommitCount !== 0
    || metrics.evidenceCoverageRate !== null
    || metrics.teacherRevisionCount !== 0
    || metrics.latencyMsP50 !== null
    || metrics.estimatedCostCny !== null
  )) {
    throw new WireFormatError(`${label} 零样本不得伪造指标`);
  }
  return {
    groupId: enumOf(
      object.groupId,
      ["group-1", "group-2", "group-3"] as const,
      `${label}.groupId`,
    ),
    conditionCode: enumOf(
      object.conditionCode,
      ["A", "B", "C"] as const,
      `${label}.conditionCode`,
    ),
    architecturePolicyHash: hashOf(
      object.architecturePolicyHash,
      `${label}.architecturePolicyHash`,
    ),
    runCount,
    failedRunCount,
    metrics,
  };
}

function parseGate(value: unknown, index: number): AgentAblationGate {
  const label = `AgentAblationEvidence.gates[${index}]`;
  const object = exactObject(value, [
    "gateId",
    "status",
    "actual",
    "requirement",
    "evidenceRefs",
  ], label);
  return {
    gateId: enumOf(object.gateId, AgentAblationGateIds, `${label}.gateId`),
    status: enumOf(
      object.status,
      ["passed", "failed", "insufficient"] as const,
      `${label}.status`,
    ),
    actual: textOf(object.actual, `${label}.actual`, 600),
    requirement: textOf(object.requirement, `${label}.requirement`, 600),
    evidenceRefs: identifierListOf(object.evidenceRefs, `${label}.evidenceRefs`, 0, 64),
  };
}

function parseControls(value: unknown): AgentAblationEvidence["controls"] {
  const object = exactObject(value, [
    "caseSuiteHash",
    "courseScenarioSetHash",
    "knowledgeSnapshotHash",
    "modelProfileHash",
    "toolPolicyHash",
    "rubricHash",
    "topologyHash",
    "worldGateHash",
    "teacherGateHash",
    "budgetHash",
    "seed",
    "temperature",
    "conditionLabelsHidden",
    "failuresRetained",
  ], "AgentAblationEvidence.controls");
  return {
    caseSuiteHash: hashOf(object.caseSuiteHash, "controls.caseSuiteHash"),
    courseScenarioSetHash: hashOf(
      object.courseScenarioSetHash,
      "controls.courseScenarioSetHash",
    ),
    knowledgeSnapshotHash: hashOf(
      object.knowledgeSnapshotHash,
      "controls.knowledgeSnapshotHash",
    ),
    modelProfileHash: hashOf(object.modelProfileHash, "controls.modelProfileHash"),
    toolPolicyHash: hashOf(object.toolPolicyHash, "controls.toolPolicyHash"),
    rubricHash: hashOf(object.rubricHash, "controls.rubricHash"),
    topologyHash: hashOf(object.topologyHash, "controls.topologyHash"),
    worldGateHash: hashOf(object.worldGateHash, "controls.worldGateHash"),
    teacherGateHash: hashOf(object.teacherGateHash, "controls.teacherGateHash"),
    budgetHash: hashOf(object.budgetHash, "controls.budgetHash"),
    seed: integerOf(object.seed, "controls.seed", 0),
    temperature: numberOf(object.temperature, "controls.temperature", 0, 2),
    conditionLabelsHidden: booleanLiteral(
      object.conditionLabelsHidden,
      false,
      "controls.conditionLabelsHidden",
    ),
    failuresRetained: booleanLiteral(
      object.failuresRetained,
      true,
      "controls.failuresRetained",
    ),
  };
}

export function parseAgentAblationEvidence(value: unknown): AgentAblationEvidence {
  const object = exactObject(value, [
    "schemaVersion",
    "experimentId",
    "protocolVersion",
    "preregistrationHash",
    "ruleManifestHash",
    "reportHash",
    "generatedAt",
    "runStatus",
    "conclusion",
    "claimBoundary",
    "observationCount",
    "eligibility",
    "controls",
    "groups",
    "gates",
    "blindReviewStatus",
  ], "AgentAblationEvidence");
  if (object.schemaVersion !== AgentAblationEvidenceSchemaVersion) {
    throw new WireFormatError("AgentAblationEvidence 版本漂移");
  }
  if (!Array.isArray(object.eligibility) || object.eligibility.length !== 5) {
    throw new WireFormatError("AgentAblationEvidence.eligibility 必须覆盖五门课程");
  }
  const eligibility = object.eligibility.map((item, index) => {
    const label = `AgentAblationEvidence.eligibility[${index}]`;
    const entry = exactObject(item, ["courseId", "status", "reasonCode"], label);
    return {
      courseId: enumOf(entry.courseId, V2CourseIds, `${label}.courseId`),
      status: enumOf(entry.status, runtimeStatuses, `${label}.status`),
      reasonCode: identifierOf(entry.reasonCode, `${label}.reasonCode`),
    };
  });
  if (!sameSet(eligibility.map((item) => item.courseId), V2CourseIds)) {
    throw new WireFormatError("AgentAblationEvidence.eligibility 课程集合不完整");
  }
  if (!Array.isArray(object.groups) || object.groups.length !== 3) {
    throw new WireFormatError("AgentAblationEvidence.groups 必须是三个预登记对照组");
  }
  const groups = object.groups.map(parseGroup);
  if (!sameSet(groups.map((group) => group.groupId), ["group-1", "group-2", "group-3"])) {
    throw new WireFormatError("AgentAblationEvidence.groups 预登记组集合不完整");
  }
  if (!Array.isArray(object.gates) || object.gates.length !== 8) {
    throw new WireFormatError("AgentAblationEvidence.gates 必须包含八个证据门");
  }
  const gates = object.gates.map(parseGate);
  if (!sameSet(gates.map((gate) => gate.gateId), AgentAblationGateIds)) {
    throw new WireFormatError("AgentAblationEvidence.gates 证据门集合不完整");
  }
  const conditionCodes = groups.map((group) => group.conditionCode);
  if (!sameSet(conditionCodes, ["A", "B", "C"])) {
    throw new WireFormatError("未配置盲评时必须公开三个唯一预登记条件标签");
  }
  const runStatus = enumOf(
    object.runStatus,
    ["not_ready", "running", "frozen", "completed", "failed"] as const,
    "AgentAblationEvidence.runStatus",
  );
  if (object.blindReviewStatus !== "not_configured") {
    throw new WireFormatError("当前协议尚未配置私有随机盲评");
  }
  const conclusion = enumOf(
    object.conclusion,
    ["insufficient_evidence", "hypothesis_not_supported", "hypothesis_supported"] as const,
    "AgentAblationEvidence.conclusion",
  );
  const observationCount = integerOf(
    object.observationCount,
    "AgentAblationEvidence.observationCount",
    0,
  );
  if (observationCount === 0) {
    const noImputation = gates.find((gate) => gate.gateId === "no_score_imputation");
    if (
      runStatus !== "not_ready"
      || conclusion !== "insufficient_evidence"
      || groups.some((group) => group.runCount !== 0)
      || gates.some((gate) => (
        gate.gateId !== "no_score_imputation" && gate.status !== "insufficient"
      ))
      || noImputation?.status !== "passed"
    ) {
      throw new WireFormatError("零样本只能形成未就绪、不足证据且不补分的结论");
    }
  }
  if (conclusion === "hypothesis_supported") {
    throw new WireFormatError("当前协议未配置私有随机盲评，禁止宣称架构假设获得支持");
  }
  return {
    schemaVersion: AgentAblationEvidenceSchemaVersion,
    experimentId: identifierOf(object.experimentId, "AgentAblationEvidence.experimentId"),
    protocolVersion: textOf(object.protocolVersion, "AgentAblationEvidence.protocolVersion", 120),
    preregistrationHash: hashOf(object.preregistrationHash, "AgentAblationEvidence.preregistrationHash"),
    ruleManifestHash: hashOf(object.ruleManifestHash, "AgentAblationEvidence.ruleManifestHash"),
    reportHash: hashOf(object.reportHash, "AgentAblationEvidence.reportHash"),
    generatedAt: dateTimeOf(object.generatedAt, "AgentAblationEvidence.generatedAt"),
    runStatus,
    conclusion,
    claimBoundary: textOf(object.claimBoundary, "AgentAblationEvidence.claimBoundary", 1_500),
    observationCount,
    eligibility,
    controls: parseControls(object.controls),
    groups,
    gates,
    blindReviewStatus: "not_configured",
  };
}

const courseTitles: Record<V2CourseId, string> = {
  "course-xunpu-intangible-media": "泉州蟳埔簪花围非遗专题采编实战",
  "course-village-super-multiplatform": "贵州村超多平台视听报道",
  "course-village-super-postpublication-context": "村超短视频语境回应与多平台更正",
  "course-ai-tourism-copyright-governance": "AI 文旅视觉版权与内容治理",
  "course-scenic-rain-emergency-reporting": "景区暴雨闭园与复开应急报道",
};

const runtimeStatusCopy: Record<AgentRuleRuntimeStatus, {
  label: string;
  tone: "available" | "warning" | "blocked";
}> = {
  runtime_ready: { label: "运行引用已对齐", tone: "available" },
  content_only: { label: "仅内容就绪", tone: "warning" },
  unresolved_agent_ref: { label: "智能体引用待解析", tone: "blocked" },
  version_hash_drift: { label: "版本哈希漂移", tone: "blocked" },
  runtime_unavailable: { label: "运行时不可用", tone: "blocked" },
};

const gateLabels: Record<AgentAblationGateId, string> = {
  runtime_eligibility: "运行资格",
  control_hash_consistency: "控制变量哈希一致",
  observation_integrity: "观察完整性",
  balanced_repetitions: "重复轮次齐套",
  no_authoritative_write: "无越权权威写入",
  blind_review_complete: "私有随机盲评",
  minimum_effect_margin: "最小效应门",
  no_score_imputation: "禁止缺失补分",
};

export interface AgentEvaluationView {
  generatedAt: string;
  manifest: {
    courseCount: number;
    chapterCount: number;
    baselineAgentCount: number;
    supportingCapabilityIds: string[];
    courses: Array<{
      courseId: V2CourseId;
      title: string;
      chapterCount: number;
      status: AgentRuleRuntimeStatus;
      statusLabel: string;
      tone: "available" | "warning" | "blocked";
      explanation: string;
      candidateReferenceCount: number;
      baselineReferenceCount: number;
      supportingCapabilityCount: number;
      ruleGuidance: Array<{
        chapterId: string;
        order: number;
        selectWhen: string;
        skipWhen: string;
      }>;
    }>;
  };
  evidence: {
    runStatus: AgentAblationRunStatus;
    runStatusLabel: string;
    conclusion: AgentAblationConclusion;
    conclusionLabel: string;
    observationCount: number;
    insufficient: boolean;
    warningTitle: string;
    warningDetail: string;
    claimBoundary: string;
    groups: Array<{
      groupId: AgentAblationGroup["groupId"];
      conditionCode: AgentAblationGroup["conditionCode"];
      label: string;
      runCount: number;
      failedRunCount: number;
      metrics: AgentAblationMetrics;
    }>;
    gates: Array<{
      gateId: AgentAblationGateId;
      label: string;
      status: AgentAblationGateStatus;
      statusLabel: string;
      actual: string;
      requirement: string;
      evidenceCount: number;
    }>;
  };
}

export function buildAgentEvaluationView(
  manifest: CrossCourseAgentRuleManifest,
  evidence: AgentAblationEvidence,
): AgentEvaluationView {
  if (
    evidence.ruleManifestHash !== manifest.manifestHash
    || evidence.controls.topologyHash !== manifest.topologyHash
    || evidence.controls.knowledgeSnapshotHash !== manifest.contentSnapshotHash
  ) {
    throw new WireFormatError("规则清单与消融证据冻结哈希不一致");
  }
  for (const course of manifest.courses) {
    const eligibility = evidence.eligibility.find((item) => (
      item.courseId === course.courseReleaseRef.courseId
    ));
    if (
      !eligibility
      || eligibility.status !== course.runtimeEligibility.status
      || eligibility.reasonCode !== course.runtimeEligibility.reasonCode
    ) {
      throw new WireFormatError("规则清单与消融证据课程资格不一致");
    }
  }
  const supportingCapabilityIds = [...new Set(manifest.courses.flatMap((course) => (
    course.chapters.flatMap((chapter) => chapter.agentResolutions.flatMap((resolution) => (
      resolution.targetKind === "supporting_capability"
      && resolution.targetAgentId !== null
        ? [resolution.targetAgentId]
        : []
    )))
  )))].sort();
  const insufficient = evidence.observationCount === 0
    || evidence.conclusion === "insufficient_evidence";
  const runStatusLabel: Record<AgentAblationRunStatus, string> = {
    not_ready: "尚未就绪",
    running: "采集中",
    frozen: "已冻结待结论",
    completed: "已完成",
    failed: "运行失败",
  };
  const conclusionLabel: Record<AgentAblationConclusion, string> = {
    insufficient_evidence: "证据不足",
    hypothesis_not_supported: "预登记假设未获支持",
    hypothesis_supported: "预登记假设获得支持",
  };
  const gateStatusLabel: Record<AgentAblationGateStatus, string> = {
    passed: "已核验",
    failed: "未通过",
    insufficient: "证据不足",
  };
  return {
    generatedAt: evidence.generatedAt,
    manifest: {
      courseCount: manifest.courses.length,
      chapterCount: manifest.courses.flatMap((course) => course.chapters).length,
      baselineAgentCount: manifest.baselineTopologyAgentIds.length,
      supportingCapabilityIds,
      courses: manifest.courses.map((course) => {
        const resolutions = course.chapters.flatMap((chapter) => chapter.agentResolutions);
        const statusCopy = runtimeStatusCopy[course.runtimeEligibility.status];
        return {
          courseId: course.courseReleaseRef.courseId,
          title: courseTitles[course.courseReleaseRef.courseId],
          chapterCount: course.chapters.length,
          status: course.runtimeEligibility.status,
          statusLabel: statusCopy.label,
          tone: statusCopy.tone,
          explanation: course.runtimeEligibility.explanation,
          candidateReferenceCount: resolutions.length,
          baselineReferenceCount: resolutions.filter((item) => (
            item.targetKind === "baseline_topology"
          )).length,
          supportingCapabilityCount: resolutions.filter((item) => (
            item.targetKind === "supporting_capability"
          )).length,
          ruleGuidance: course.chapters.map((chapter) => ({
            chapterId: chapter.chapterId,
            order: chapter.order,
            selectWhen: chapter.selectWhen,
            skipWhen: chapter.skipWhen,
          })),
        };
      }),
    },
    evidence: {
      runStatus: evidence.runStatus,
      runStatusLabel: runStatusLabel[evidence.runStatus],
      conclusion: evidence.conclusion,
      conclusionLabel: conclusionLabel[evidence.conclusion],
      observationCount: evidence.observationCount,
      insufficient,
      warningTitle: insufficient
        ? "当前不足以比较三种协作架构"
        : "消融证据已形成可复核结论",
      warningDetail: insufficient
        ? "尚无真实三组运行样本，私有随机盲分配也未配置；页面只呈现冻结规则、公开预登记条件与证据缺口。"
        : "结论仍受预登记方案、私有随机盲评和证据门约束。",
      claimBoundary: insufficient
        ? "当前只证明五课程规则、公开预登记条件、控制变量与安全门已冻结；尚未配置私有随机盲分配，不能声称已盲评。"
        : evidence.claimBoundary,
      groups: evidence.groups.map((group) => ({
        groupId: group.groupId,
        conditionCode: group.conditionCode,
        label: `预登记组 ${group.conditionCode}`,
        runCount: group.runCount,
        failedRunCount: group.failedRunCount,
        metrics: group.metrics,
      })),
      gates: evidence.gates.map((gate) => ({
        gateId: gate.gateId,
        label: gateLabels[gate.gateId],
        status: gate.status,
        statusLabel: gateStatusLabel[gate.status],
        actual: gate.actual,
        requirement: gate.requirement,
        evidenceCount: gate.evidenceRefs.length,
      })),
    },
  };
}
