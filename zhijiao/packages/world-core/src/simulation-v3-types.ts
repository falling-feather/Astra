import {
  ChallengeAssignmentSchema,
  SimulationAgentIntentSchema,
  SimulationResolutionSchema,
  StudentWorkActionSchema,
  WorldSimulationReleaseSchema,
  WorldSnapshotSchema,
  FieldInterviewRecordV1Schema,
  type FieldInterviewRecordV1,
  type ChallengeAssignment,
  type SimulationAgentIntent,
  type SimulationObjectReference,
  type SimulationResolution,
  type SimulationVisibilityScope,
  type StudentWorkAction,
  type WorldSimulationRelease,
  type WorldSnapshot,
} from "@ronggang/contracts";

export const SimulationSessionRecordVersion =
  "world-simulation-session-record/1.0.0" as const;

export type SimulationEventSourceKind =
  | "student_action"
  | "npc_intent"
  | "system_clock"
  | "teacher_intervention";

export type SimulationQueuedEventStatus =
  | "queued"
  | "awaiting_gate"
  | "committed"
  | "rejected"
  | "failed";

export interface SimulationQueuedEvent {
  eventId: string;
  sessionId: string;
  eventTemplateId: string;
  eventType: string;
  sourceKind: SimulationEventSourceKind;
  sourceRef: string;
  requestId: string;
  requestHash: string;
  enqueuedAtStateVersion: number;
  sequence: number;
  notBeforeVirtualMinute: number;
  affectedObjectRefs: SimulationObjectReference[];
  status: SimulationQueuedEventStatus;
  resolutionId: string | null;
  occurredAt: string;
}

export interface SimulationVariableEffect {
  variableId: string;
  delta: number;
}

export interface SimulationEntityEffect {
  entityId: string;
  status: WorldSnapshot["entities"][number]["status"];
  publicSummary: string;
}

export interface SimulationFactEffect {
  factId: string;
  status: WorldSnapshot["facts"][number]["status"];
  confidence: number;
  sourceRefs: string[];
  visibleScopes: SimulationVisibilityScope[];
}

export interface SimulationRelationshipEffect {
  relationshipId: string;
  sourceEntityId: string;
  targetEntityId: string;
  trustDelta: number;
  tensionDelta: number;
  influenceDelta: number;
  commitmentRefs: string[];
}

export interface SimulationResourceEffect {
  resourceId: string;
  resourceKind: WorldSnapshot["resources"][number]["resourceKind"];
  amountDelta: number;
  unit: string;
  visibleScopes: SimulationVisibilityScope[];
}

export interface SimulationEndingEffect {
  status: Exclude<WorldSnapshot["endingState"]["status"], "active">;
  endingRef: string;
}

export interface SimulationRunEffects {
  variables: SimulationVariableEffect[];
  entities: SimulationEntityEffect[];
  facts: SimulationFactEffect[];
  relationships: SimulationRelationshipEffect[];
  resources: SimulationResourceEffect[];
  advanceMinutes: number;
  setPaused: boolean | null;
  ending: SimulationEndingEffect | null;
}

export interface SimulationIntentRunProposal {
  intent: SimulationAgentIntent;
  outputHash: string;
  effects: SimulationRunEffects;
}

export interface PendingSimulationGate {
  eventId: string;
  resolutionId: string;
  resolutionProposalId: string;
  dispatchPlanId: string;
  acceptedRuns: SimulationIntentRunProposal[];
  skippedIntentIds: string[];
  resolvedEffects: SimulationRunEffects;
  consequenceSummary: string;
  evidenceIds: string[];
  gateId: string;
  createdAt: string;
}

export interface SimulationRequestReceipt {
  requestId: string;
  requestHash: string;
  eventId: string;
}

export interface SimulationConsequenceRecord {
  eventId: string;
  sessionId: string;
  resolutionId: string;
  sourceWorldEventId: string;
  publicSummary: string;
  evidenceIds: string[];
  resultingStateVersion: number;
  occurredAt: string;
  virtualMinute?: number;
}

export interface SimulationSessionRecord {
  recordVersion: typeof SimulationSessionRecordVersion;
  recordRevision: number;
  sessionId: string;
  release: WorldSimulationRelease;
  challengeAssignment: ChallengeAssignment;
  currentSnapshot: WorldSnapshot;
  queue: SimulationQueuedEvent[];
  studentActions: StudentWorkAction[];
  resolutions: SimulationResolution[];
  consequences: SimulationConsequenceRecord[];
  pendingGate: PendingSimulationGate | null;
  requestReceipts: SimulationRequestReceipt[];
  nextEventSequence: number;
  createdAt: string;
  updatedAt: string;
  /** Published-rule field actions share this record's writer, clock and version sequence. */
  fieldInterview?: FieldInterviewRecordV1;
}

const hashPattern = /^[a-f0-9]{64}$/u;
const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:/@-]*$/u;

function assertRecord(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`V3 世界会话记录非法：${message}`);
}

function sameReleaseRef(
  left: WorldSimulationRelease["simulationReleaseRef"],
  right: WorldSimulationRelease["simulationReleaseRef"],
): boolean {
  return left.simulationId === right.simulationId
    && left.releaseId === right.releaseId
    && left.version === right.version
    && left.contentHash === right.contentHash;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

function canonicalString(value: unknown): string {
  return JSON.stringify(canonical(value));
}

function effectTargetKeys(effects: SimulationRunEffects): string[] {
  assertRecord(
    Array.isArray(effects.variables)
      && Array.isArray(effects.entities)
      && Array.isArray(effects.facts)
      && Array.isArray(effects.relationships)
      && Array.isArray(effects.resources),
    "运行效果集合结构非法",
  );
  assertRecord(
    Number.isInteger(effects.advanceMinutes) && effects.advanceMinutes >= 0,
    "运行效果虚拟时间非法",
  );
  assertRecord(
    effects.setPaused === null || typeof effects.setPaused === "boolean",
    "运行效果暂停状态非法",
  );
  return [
    ...effects.variables.map((effect) => `world_variable:${effect.variableId}`),
    ...effects.entities.map((effect) => `entity:${effect.entityId}`),
    ...effects.facts.map((effect) => `fact:${effect.factId}`),
    ...effects.relationships.map(
      (effect) => `relationship:${effect.relationshipId}`,
    ),
    ...effects.resources.map((effect) => `resource:${effect.resourceId}`),
    ...(effects.advanceMinutes > 0 ? ["clock:virtual-time"] : []),
    ...(effects.setPaused === null ? [] : ["clock:paused-state"]),
    ...(effects.ending === null ? [] : ["ending:world"]),
  ];
}

export function validateSimulationSessionRecord(
  value: SimulationSessionRecord,
): SimulationSessionRecord {
  assertRecord(
    value.recordVersion === SimulationSessionRecordVersion,
    "记录版本不支持",
  );
  assertRecord(
    Number.isInteger(value.recordRevision) && value.recordRevision >= 0,
    "记录修订号非法",
  );
  assertRecord(idPattern.test(value.sessionId), "会话 ID 非法");
  const release = WorldSimulationReleaseSchema.parse(value.release);
  const challengeAssignment = ChallengeAssignmentSchema.parse(
    value.challengeAssignment,
  );
  const currentSnapshot = WorldSnapshotSchema.parse(value.currentSnapshot);
  const fieldInterview = value.fieldInterview === undefined ? undefined : FieldInterviewRecordV1Schema.parse(value.fieldInterview);
  const studentActions = value.studentActions.map((action) =>
    StudentWorkActionSchema.parse(action));
  const resolutions = value.resolutions.map((resolution) =>
    SimulationResolutionSchema.parse(resolution));
  assertRecord(currentSnapshot.sessionId === value.sessionId, "快照跨会话");
  assertRecord(challengeAssignment.sessionId === value.sessionId, "挑战分配跨会话");
  assertRecord(
    sameReleaseRef(release.simulationReleaseRef, currentSnapshot.simulationReleaseRef),
    "快照发布版漂移",
  );
  assertRecord(
    sameReleaseRef(
      release.simulationReleaseRef,
      challengeAssignment.simulationReleaseRef,
    ),
    "挑战分配发布版漂移",
  );
  assertRecord(
    currentSnapshot.learningContext.challengeAssignmentRef
      === challengeAssignment.challengeAssignmentId,
    "快照挑战引用漂移",
  );
  assertRecord(
    currentSnapshot.learningContext.challengeLevel
      === challengeAssignment.challengeLevel
      && currentSnapshot.learningContext.scoreCeiling
        === challengeAssignment.scoreCeiling,
    "快照挑战等级或分数上限漂移",
  );
  const maximumEventSequence = value.queue.reduce(
    (maximum, event) => Math.max(maximum, event.sequence),
    0,
  );
  assertRecord(
    Number.isInteger(value.nextEventSequence)
      && value.nextEventSequence === maximumEventSequence + 1,
    "事件序列游标必须精确指向下一序列",
  );
  const eventIds = value.queue.map((event) => event.eventId);
  assertRecord(new Set(eventIds).size === eventIds.length, "事件 ID 重复");
  const sequences = value.queue.map((event) => event.sequence);
  assertRecord(new Set(sequences).size === sequences.length, "事件序列重复");
  const receiptIds = value.requestReceipts.map((receipt) => receipt.requestId);
  assertRecord(new Set(receiptIds).size === receiptIds.length, "请求收据 ID 重复");
  assertRecord(
    new Set(value.requestReceipts.map((receipt) => receipt.eventId)).size
      === value.requestReceipts.length,
    "同一事件不得对应多个请求收据",
  );
  for (const event of value.queue) {
    assertRecord(event.sessionId === value.sessionId, "队列事件跨会话");
    assertRecord(idPattern.test(event.eventId), "事件 ID 非法");
    assertRecord(idPattern.test(event.requestId), "请求 ID 非法");
    assertRecord(hashPattern.test(event.requestHash), "请求哈希非法");
    assertRecord(
      Number.isInteger(event.sequence) && event.sequence > 0,
      "事件序列必须为正整数",
    );
    assertRecord(event.notBeforeVirtualMinute >= 0, "事件不得排入负虚拟时间");
    const template = release.eventTemplates.find(
      (candidate) => candidate.eventTemplateId === event.eventTemplateId,
    );
    assertRecord(template !== undefined, "队列事件模板不存在");
    assertRecord(template.eventType === event.eventType, "队列事件类型漂移");
    assertRecord(template.sourceKind === event.sourceKind, "队列事件来源漂移");
    const actualAffectedRefs = event.affectedObjectRefs
      .map((reference) => `${reference.objectType}:${reference.objectId}`)
      .sort();
    const expectedAffectedRefs = template.affectedObjectRefs
      .map((reference) => `${reference.objectType}:${reference.objectId}`)
      .sort();
    assertRecord(
      JSON.stringify(actualAffectedRefs) === JSON.stringify(expectedAffectedRefs),
      "队列事件受影响对象与发布模板不一致",
    );
    if (event.status === "queued") {
      assertRecord(event.resolutionId === null, "未结算事件不得提前引用解析");
    } else {
      assertRecord(event.resolutionId !== null, "已处理事件必须引用解析");
    }
  }
  for (const receipt of value.requestReceipts) {
    assertRecord(idPattern.test(receipt.requestId), "请求收据 ID 非法");
    assertRecord(hashPattern.test(receipt.requestHash), "请求收据哈希非法");
    assertRecord(eventIds.includes(receipt.eventId), "请求收据事件引用不存在");
  }
  for (const action of studentActions) {
    assertRecord(action.sessionId === value.sessionId, "学生工作动作跨会话");
  }
  const actionIds = studentActions.map((action) => action.workActionId);
  assertRecord(new Set(actionIds).size === actionIds.length, "学生工作动作 ID 重复");
  for (const event of value.queue.filter(
    (candidate) => candidate.sourceKind === "student_action",
  )) {
    assertRecord(actionIds.includes(event.sourceRef), "学生事件来源动作不存在");
    const action = studentActions.find(
      (candidate) => candidate.workActionId === event.sourceRef,
    );
    assertRecord(
      action?.expectedWorldStateVersion === event.enqueuedAtStateVersion,
      "学生事件与来源动作的世界版本不一致",
    );
  }
  const resolutionIds = resolutions.map((resolution) => resolution.resolutionId);
  assertRecord(new Set(resolutionIds).size === resolutionIds.length, "解析 ID 重复");
  for (const resolution of resolutions) {
    assertRecord(resolution.sessionId === value.sessionId, "解析记录跨会话");
    assertRecord(eventIds.includes(resolution.sourceWorldEventId), "解析来源事件不存在");
  }
  for (const event of value.queue.filter((candidate) => candidate.resolutionId !== null)) {
    const resolution = resolutions.find(
      (candidate) => candidate.resolutionId === event.resolutionId,
    );
    assertRecord(resolution !== undefined, "队列事件引用的解析不存在");
    const expectedStatus = event.status === "awaiting_gate"
      ? "pending_teacher_gate"
      : event.status;
    assertRecord(resolution.status === expectedStatus, "队列事件与解析状态不一致");
  }
  const consequenceIds = value.consequences.map((item) => item.eventId);
  assertRecord(new Set(consequenceIds).size === consequenceIds.length, "世界后果事件 ID 重复");
  for (const consequence of value.consequences) {
    assertRecord(consequence.sessionId === value.sessionId, "世界后果跨会话");
    assertRecord(idPattern.test(consequence.eventId), "世界后果事件 ID 非法");
    assertRecord(idPattern.test(consequence.resolutionId), "世界后果解析 ID 非法");
    assertRecord(idPattern.test(consequence.sourceWorldEventId), "世界后果来源 ID 非法");
    assertRecord(
      consequence.evidenceIds.every((evidenceId) => idPattern.test(evidenceId))
        && new Set(consequence.evidenceIds).size === consequence.evidenceIds.length,
      "世界后果证据引用非法或重复",
    );
    assertRecord(
      !Number.isNaN(Date.parse(consequence.occurredAt)),
      "世界后果时间非法",
    );
    const resolution = resolutions.find(
      (candidate) => candidate.resolutionId === consequence.resolutionId,
    );
    assertRecord(resolution?.status === "committed", "世界后果必须来自正式提交解析");
    assertRecord(
      resolution.sourceWorldEventId === consequence.sourceWorldEventId,
      "世界后果来源事件漂移",
    );
    assertRecord(
      resolution.emittedWorldEventIds.includes(consequence.eventId),
      "世界后果未被解析登记",
    );
    assertRecord(
      canonicalString(resolution.emittedEvidenceIds)
        === canonicalString(consequence.evidenceIds),
      "世界后果证据与解析登记不一致",
    );
    assertRecord(
      consequence.resultingStateVersion > 0
        && consequence.resultingStateVersion <= currentSnapshot.stateVersion,
      "世界后果状态版本非法",
    );
    if (consequence.virtualMinute !== undefined) assertRecord(Number.isInteger(consequence.virtualMinute)
      && consequence.virtualMinute >= 0 && consequence.virtualMinute <= currentSnapshot.virtualTime.elapsedMinutes, "世界后果虚拟时间非法");
    assertRecord(
      consequence.publicSummary.trim().length > 0
        && consequence.publicSummary.length <= 1_000,
      "世界后果公开摘要不得为空",
    );
  }
  const committedResolutions = resolutions.filter(
    (resolution) => resolution.status === "committed",
  );
  assertRecord(
    value.consequences.length === committedResolutions.length
      && committedResolutions.every(
        (resolution) => resolution.emittedWorldEventIds.length === 1,
      ),
    "每个正式解析必须且只能形成一条内部世界后果",
  );
  assertRecord(
    currentSnapshot.stateVersion
      === committedResolutions.length + (fieldInterview?.events.length ?? 0),
    "世界状态版本必须等于智能体结算与已发布现场规则事件的合计数量",
  );
  const authoritativeVersions = [...value.consequences.map(item => item.resultingStateVersion),
    ...(fieldInterview?.events.map(event => event.resultingWorldStateVersion) ?? [])].sort((a, b) => a - b);
  assertRecord(authoritativeVersions.every((version, index) => version === index + 1), "世界提交版本不得重复或出现空洞");
  if (fieldInterview) {
    assertRecord(fieldInterview.sessionId === value.sessionId, "现场采访记录跨会话");
    const requestIds = fieldInterview.events.map(event => event.requestId);
    assertRecord(new Set(requestIds).size === requestIds.length, "现场动作请求不得重复");
    for (const event of fieldInterview.events) {
      assertRecord(event.actorId === fieldInterview.actorId && event.bindingId === fieldInterview.bindingId, "现场事件必须属于同一学生");
      assertRecord(event.resultingWorldStateVersion === event.sourceWorldStateVersion + 1, "现场事件版本必须连续");
      assertRecord(event.afterMinute >= event.beforeMinute && event.afterMinute <= currentSnapshot.virtualTime.elapsedMinutes, "现场事件时间不得倒退或领先世界");
    }
  }
  if (value.pendingGate !== null) {
    const pending = value.pendingGate;
    assertRecord(eventIds.includes(pending.eventId), "待审教师门来源事件不存在");
    assertRecord(
      value.queue.find((event) => event.eventId === pending.eventId)?.status
        === "awaiting_gate",
      "待审教师门与队列状态不一致",
    );
    assertRecord(
      pending.acceptedRuns.length > 0
        && pending.acceptedRuns.every((run) =>
          SimulationAgentIntentSchema.safeParse(run.intent).success
            && hashPattern.test(run.outputHash)),
      "待审教师门缺少真实意图运行",
    );
    const pendingEvent = value.queue.find((event) => event.eventId === pending.eventId)!;
    const pendingTemplate = release.eventTemplates.find(
      (template) => template.eventTemplateId === pendingEvent.eventTemplateId,
    )!;
    const pendingRules = pendingTemplate.ruleRefs.map((ruleRef) => (
      release.rules.find((rule) => rule.ruleId === ruleRef)!
    ));
    const allowedVariableIds = new Set(
      [
        ...pendingRules.flatMap((rule) => rule.affectedVariableIds),
        ...pendingTemplate.affectedObjectRefs
          .filter((reference) => reference.objectType === "world_variable")
          .map((reference) => reference.objectId),
      ],
    );
    const allowedIntentTypes = new Set(
      pendingRules.flatMap((rule) => rule.allowedIntentTypes),
    );
    const affectedTargets = new Set(
      pendingTemplate.affectedObjectRefs.map(
        (reference) => `${reference.objectType}:${reference.objectId}`,
      ),
    );
    const claimedTargets = new Set<string>();
    const reconstructedEffects = emptySimulationRunEffects();
    for (const run of pending.acceptedRuns) {
      assertRecord(
        allowedIntentTypes.has(run.intent.intentType)
          && run.intent.expectedWorldStateVersion === currentSnapshot.stateVersion,
        "待审教师门包含未授权或过期智能体意图",
      );
      const targetSet = new Set(run.intent.targetObjectRefs.map(
        (reference) => `${reference.objectType}:${reference.objectId}`,
      ));
      const keys = effectTargetKeys(run.effects);
      assertRecord(
        new Set(keys).size === keys.length
          && keys.every((key) => !claimedTargets.has(key)),
        "待审教师门包含重复或冲突效果目标",
      );
      for (const key of keys) claimedTargets.add(key);
      for (const effect of run.effects.variables) {
        assertRecord(
          allowedVariableIds.has(effect.variableId)
            && targetSet.has(`world_variable:${effect.variableId}`),
          "待审教师门包含越权变量效果",
        );
      }
      for (const key of keys.filter((key) => (
        !key.startsWith("world_variable:")
          && !key.startsWith("clock:")
          && key !== "ending:world"
      ))) {
        assertRecord(
          targetSet.has(key) && affectedTargets.has(key),
          "待审教师门包含越权对象效果",
        );
      }
      reconstructedEffects.variables.push(...structuredClone(run.effects.variables));
      reconstructedEffects.entities.push(...structuredClone(run.effects.entities));
      reconstructedEffects.facts.push(...structuredClone(run.effects.facts));
      reconstructedEffects.relationships.push(
        ...structuredClone(run.effects.relationships),
      );
      reconstructedEffects.resources.push(...structuredClone(run.effects.resources));
      if (run.effects.advanceMinutes > 0) {
        reconstructedEffects.advanceMinutes = run.effects.advanceMinutes;
      }
      if (run.effects.setPaused !== null) {
        reconstructedEffects.setPaused = run.effects.setPaused;
      }
      if (run.effects.ending !== null) {
        assertRecord(
          release.endingDefinitions.some(
            (ending) => ending.endingId === run.effects.ending?.endingRef,
          ),
          "待审教师门结局引用不存在",
        );
        reconstructedEffects.ending = structuredClone(run.effects.ending);
      }
    }
    assertRecord(
      canonicalString(reconstructedEffects)
        === canonicalString(pending.resolvedEffects),
      "待审教师门聚合效果与已接受运行不一致",
    );
    assertRecord(
      resolutions.some((resolution) => (
        resolution.resolutionId === pending.resolutionId
          && resolution.status === "pending_teacher_gate"
      )),
      "待审教师门解析记录不存在",
    );
  }
  return structuredClone({
    ...value,
    release,
    challengeAssignment,
    currentSnapshot,
    studentActions,
    resolutions,
    ...(fieldInterview === undefined ? {} : { fieldInterview }),
  });
}

export function emptySimulationRunEffects(): SimulationRunEffects {
  return {
    variables: [],
    entities: [],
    facts: [],
    relationships: [],
    resources: [],
    advanceMinutes: 0,
    setPaused: null,
    ending: null,
  };
}
