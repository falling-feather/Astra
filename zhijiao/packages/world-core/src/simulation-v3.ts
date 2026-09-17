import { createHash, randomUUID } from "node:crypto";
import {
  ChallengeAssignmentSchema,
  SimulationAgentIntentSchema,
  SimulationResolutionSchema,
  StudentWorkActionSchema,
  WorldSimulationReleaseSchema,
  WorldSnapshotSchema,
  SimulationResolutionSchemaVersion,
  StudentWorkActionSchemaVersion,
  WorldSnapshotSchemaVersion,
  type ChallengeAssignment,
  type SimulationAgentIntent,
  type SimulationObjectReference,
  type SimulationResolution,
  type StudentWorkAction,
  type WorldSimulationRelease,
  type WorldSnapshot,
  type FieldInterviewActionRequestV1,
  type FieldInterviewModelReceiptV1,
  type FieldInterviewSpeechDecisionV1,
  type FieldInterviewViewV1,
} from "@ronggang/contracts";
import { validateExplorationLesson, type ExplorationLesson } from "@ronggang/course-content";
import { applyFieldInterviewAction, createFieldInterview, projectFieldInterview, FieldInterviewRuleError } from "./field-interview-v1.js";
import {
  SimulationSessionNotFoundError,
  type SimulationSessionStore,
} from "./simulation-v3-store.js";
import { evaluateFlagshipRuntimeActionPolicyV4 } from "./flagship-action-policy-v4.js";
import {
  SimulationSessionRecordVersion,
  emptySimulationRunEffects,
  validateSimulationSessionRecord,
  type PendingSimulationGate,
  type SimulationEventSourceKind,
  type SimulationIntentRunProposal,
  type SimulationConsequenceRecord,
  type SimulationQueuedEvent,
  type SimulationRunEffects,
  type SimulationSessionRecord,
} from "./simulation-v3-types.js";

const identifierPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:/@-]*$/u;
const contentHashPattern = /^[a-f0-9]{64}$/u;

export class InvalidSimulationOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSimulationOperationError";
  }
}

export class SimulationRequestReplayError extends Error {
  constructor(public readonly requestId: string) {
    super(`请求 ${requestId} 已使用，但请求内容与首次提交不一致`);
    this.name = "SimulationRequestReplayError";
  }
}

export class SimulationNoReadyEventError extends Error {
  constructor(sessionId: string) {
    super(`V3 世界会话当前没有可结算事件：${sessionId}`);
    this.name = "SimulationNoReadyEventError";
  }
}

export class SimulationTeacherGatePendingError extends Error {
  constructor(sessionId: string) {
    super(`V3 世界会话存在待审教师门，暂不结算后续事件：${sessionId}`);
    this.name = "SimulationTeacherGatePendingError";
  }
}

export class SimulationWorldEndedError extends Error {
  constructor(sessionId: string) {
    super(`V3 世界会话已经结束：${sessionId}`);
    this.name = "SimulationWorldEndedError";
  }
}

export interface WorldSimulationEngineV3Options {
  store: SimulationSessionStore;
  now?: () => string;
  idFactory?: (prefix: string) => string;
  fieldLessons?: readonly ExplorationLesson[];
}

export interface StartWorldSimulationInput {
  sessionId: string;
  release: WorldSimulationRelease;
  challengeAssignment: ChallengeAssignment;
  targetCompetencyRefs: string[];
  scaffoldingLevel: number;
  startedAt?: string;
  fieldInterview?: { lessonHash: string; actorId: string; bindingId: string; inheritedContacts?: import("@ronggang/contracts").FieldContactMemoryV3[] };
}

export interface EnqueueSimulationEventInput {
  sessionId: string;
  eventTemplateId: string;
  sourceRef: string;
  requestId: string;
  expectedWorldStateVersion: number;
  notBeforeVirtualMinute?: number;
}

export interface SubmitStudentWorldActionInput {
  action: StudentWorkAction;
  eventTemplateId: string;
  requestId: string;
  notBeforeVirtualMinute?: number;
}

export interface ResolveSimulationEventInput {
  sessionId: string;
  dispatchPlanId: string;
  resolutionProposalId: string;
  expectedWorldStateVersion: number;
  runs: SimulationIntentRunProposal[];
  consequenceSummary: string;
  evidenceIds: string[];
}

export interface DeclineSimulationEventInput {
  sessionId: string;
  sourceWorldEventId: string;
  dispatchPlanId: string;
  resolutionProposalId: string;
  expectedWorldStateVersion: number;
  skippedIntents: Array<{
    intentId: string;
    reasonCode: "not_necessary" | "insufficient_evidence";
  }>;
}

export interface DecideSimulationTeacherGateInput {
  sessionId: string;
  resolutionId: string;
  decision: "approved" | "revised" | "rejected";
  teacherDecisionRef: string;
  revisionPolicy: "reduce_effects" | null;
  revisedConsequenceSummary: string | null;
}

export interface SimulationEventReceipt {
  event: SimulationQueuedEvent;
  replayed: boolean;
}

interface ResolutionSelection {
  acceptedRuns: SimulationIntentRunProposal[];
  skippedIntents: SimulationResolution["skippedIntents"];
  effects: SimulationRunEffects;
}

function assertOperation(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new InvalidSimulationOperationError(message);
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

function canonicalHash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
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

function datePlusMinutes(timestamp: string, minutes: number): string {
  return new Date(new Date(timestamp).getTime() + minutes * 60_000).toISOString();
}

function uniqueStrings(values: readonly string[], label: string): string[] {
  const result = [...new Set(values)];
  assertOperation(result.length === values.length, `${label} 不得重复`);
  for (const value of result) {
    assertOperation(identifierPattern.test(value), `${label} 包含非法 ID：${value}`);
  }
  return result;
}

function objectReferenceKey(reference: SimulationObjectReference): string {
  return `${reference.objectType}:${reference.objectId}`;
}

function hasReference(
  references: readonly SimulationObjectReference[],
  objectType: SimulationObjectReference["objectType"],
  objectId: string,
): boolean {
  return references.some((reference) => (
    reference.objectType === objectType && reference.objectId === objectId
  ));
}

function actionObjectReferences(
  action: StudentWorkAction["action"],
): SimulationObjectReference[] {
  switch (action.verb) {
    case "observe":
    case "ask":
    case "probe":
    case "negotiate":
      return [action.targetRef];
    case "inspect":
    case "compare":
      return action.targetRefs;
    case "draft":
    case "submit":
      return [{ objectType: "artifact", objectId: action.artifactId }];
    case "wait":
    case "escalate":
      return [];
  }
}

function effectKeys(effects: SimulationRunEffects): string[] {
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

function emptySelection(): ResolutionSelection {
  return {
    acceptedRuns: [],
    skippedIntents: [],
    effects: emptySimulationRunEffects(),
  };
}

function pushWinningEffects(
  target: SimulationRunEffects,
  source: SimulationRunEffects,
  claimed: Set<string>,
): number {
  let wins = 0;
  const append = <T>(
    key: string,
    value: T,
    destination: T[],
  ): void => {
    if (claimed.has(key)) return;
    claimed.add(key);
    destination.push(structuredClone(value));
    wins += 1;
  };
  for (const effect of source.variables) {
    append(`world_variable:${effect.variableId}`, effect, target.variables);
  }
  for (const effect of source.entities) {
    append(`entity:${effect.entityId}`, effect, target.entities);
  }
  for (const effect of source.facts) {
    append(`fact:${effect.factId}`, effect, target.facts);
  }
  for (const effect of source.relationships) {
    append(
      `relationship:${effect.relationshipId}`,
      effect,
      target.relationships,
    );
  }
  for (const effect of source.resources) {
    append(`resource:${effect.resourceId}`, effect, target.resources);
  }
  if (source.advanceMinutes > 0 && !claimed.has("clock:virtual-time")) {
    claimed.add("clock:virtual-time");
    target.advanceMinutes = source.advanceMinutes;
    wins += 1;
  }
  if (source.setPaused !== null && !claimed.has("clock:paused-state")) {
    claimed.add("clock:paused-state");
    target.setPaused = source.setPaused;
    wins += 1;
  }
  if (source.ending !== null && !claimed.has("ending:world")) {
    claimed.add("ending:world");
    target.ending = structuredClone(source.ending);
    wins += 1;
  }
  return wins;
}

function reduceEffectsForTeacherRevision(
  effects: SimulationRunEffects,
): SimulationRunEffects {
  const half = (value: number): number => Math.round(value * 500_000) / 1_000_000;
  return {
    variables: effects.variables.map((effect) => ({
      ...effect,
      delta: half(effect.delta),
    })),
    entities: [],
    facts: [],
    relationships: effects.relationships.map((effect) => ({
      ...effect,
      trustDelta: half(effect.trustDelta),
      tensionDelta: half(effect.tensionDelta),
      influenceDelta: half(effect.influenceDelta),
    })),
    resources: effects.resources.map((effect) => ({
      ...effect,
      amountDelta: half(effect.amountDelta),
    })),
    advanceMinutes: effects.advanceMinutes > 0
      ? Math.max(1, Math.floor(effects.advanceMinutes / 2))
      : 0,
    setPaused: null,
    ending: null,
  };
}

function endingStatusFor(
  release: WorldSimulationRelease,
  endingRef: string,
): WorldSnapshot["endingState"]["status"] {
  const ending = release.endingDefinitions.find(
    (candidate) => candidate.endingId === endingRef,
  );
  assertOperation(ending !== undefined, `结局引用不存在：${endingRef}`);
  return ending.endingKind === "professional_success"
    ? "completed"
    : "recoverable_failure";
}

function applyEffectsToSnapshot(input: {
  record: SimulationSessionRecord;
  event: SimulationQueuedEvent;
  resolutionId: string;
  effects: SimulationRunEffects;
  generatedAt: string;
  nextSnapshotId: string;
}): {
  snapshot: WorldSnapshot;
  variableDeltas: SimulationResolution["variableDeltas"];
} {
  const { record, event, resolutionId, effects, generatedAt } = input;
  const current = record.currentSnapshot;
  const release = record.release;
  const variableDeltas: SimulationResolution["variableDeltas"] = [];
  const variables = structuredClone(current.variables);

  for (const effect of effects.variables) {
    const definition = release.variableDefinitions.find(
      (candidate) => candidate.variableId === effect.variableId,
    );
    assertOperation(definition !== undefined, `世界变量不存在：${effect.variableId}`);
    const index = variables.findIndex(
      (candidate) => candidate.variableId === effect.variableId,
    );
    assertOperation(index >= 0, `世界快照缺少变量：${effect.variableId}`);
    const previous = variables[index]!;
    const before = previous.after;
    const after = before + effect.delta;
    assertOperation(
      after >= definition.minimum && after <= definition.maximum,
      `变量 ${effect.variableId} 结算后超出发布范围`,
    );
    variables[index] = {
      variableId: effect.variableId,
      before,
      delta: effect.delta,
      after,
      causeRefs: [event.eventId, resolutionId],
      visibleScopes: structuredClone(definition.visibleScopes),
    };
    variableDeltas.push({
      variableId: effect.variableId,
      before,
      delta: effect.delta,
      after,
    });
  }

  const entities = structuredClone(current.entities);
  for (const effect of effects.entities) {
    const index = entities.findIndex(
      (candidate) => candidate.entityId === effect.entityId,
    );
    assertOperation(index >= 0, `世界实体不存在：${effect.entityId}`);
    const previous = entities[index]!;
    entities[index] = {
      ...previous,
      revision: previous.revision + 1,
      status: effect.status,
      publicSummary: effect.publicSummary,
    };
  }

  const facts = structuredClone(current.facts);
  for (const effect of effects.facts) {
    const nextFact: WorldSnapshot["facts"][number] = {
      factId: effect.factId,
      status: effect.status,
      confidence: effect.confidence,
      sourceRefs: uniqueStrings(effect.sourceRefs, `事实 ${effect.factId} 来源`),
      visibleScopes: [...new Set(effect.visibleScopes)],
    };
    const index = facts.findIndex((candidate) => candidate.factId === effect.factId);
    if (index < 0) facts.push(nextFact);
    else facts[index] = nextFact;
  }

  const relationships = structuredClone(current.relationships);
  for (const effect of effects.relationships) {
    assertOperation(
      entities.some((entity) => entity.entityId === effect.sourceEntityId)
        && entities.some((entity) => entity.entityId === effect.targetEntityId),
      `关系 ${effect.relationshipId} 的实体端点不存在`,
    );
    const index = relationships.findIndex(
      (candidate) => candidate.relationshipId === effect.relationshipId,
    );
    const previous = index < 0
      ? {
          trust: 50,
          tension: 0,
          influence: 50,
          commitmentRefs: [] as string[],
        }
      : relationships[index]!;
    const trust = previous.trust + effect.trustDelta;
    const tension = previous.tension + effect.tensionDelta;
    const influence = previous.influence + effect.influenceDelta;
    assertOperation(
      [trust, tension, influence].every((value) => value >= 0 && value <= 100),
      `关系 ${effect.relationshipId} 结算后超出 0—100`,
    );
    const nextRelationship: WorldSnapshot["relationships"][number] = {
      relationshipId: effect.relationshipId,
      sourceEntityId: effect.sourceEntityId,
      targetEntityId: effect.targetEntityId,
      trust,
      tension,
      influence,
      commitmentRefs: uniqueStrings(
        [...new Set([...previous.commitmentRefs, ...effect.commitmentRefs])],
        `关系 ${effect.relationshipId} 承诺引用`,
      ),
      lastInteractionAt: generatedAt,
    };
    if (index < 0) relationships.push(nextRelationship);
    else relationships[index] = nextRelationship;
  }

  const resources = structuredClone(current.resources);
  for (const effect of effects.resources) {
    const index = resources.findIndex(
      (candidate) => candidate.resourceId === effect.resourceId,
    );
    const previous = index < 0 ? null : resources[index]!;
    if (previous !== null) {
      assertOperation(
        previous.resourceKind === effect.resourceKind
          && previous.unit === effect.unit,
        `资源 ${effect.resourceId} 类型或单位漂移`,
      );
    }
    const amount = (previous?.amount ?? 0) + effect.amountDelta;
    assertOperation(amount >= 0, `资源 ${effect.resourceId} 不得结算为负数`);
    const nextResource: WorldSnapshot["resources"][number] = {
      resourceId: effect.resourceId,
      resourceKind: effect.resourceKind,
      amount,
      unit: effect.unit,
      visibleScopes: [...new Set(effect.visibleScopes)],
    };
    if (index < 0) resources.push(nextResource);
    else resources[index] = nextResource;
  }

  assertOperation(
    Number.isInteger(effects.advanceMinutes)
      && effects.advanceMinutes >= 0
      && effects.advanceMinutes <= release.expectedDurationMinutes,
    "虚拟时间推进必须是发布时长范围内的非负整数",
  );
  assertOperation(
    effects.setPaused === null || typeof effects.setPaused === "boolean",
    "虚拟时间暂停效果必须为 boolean 或 null",
  );
  assertOperation(
    !(effects.setPaused === true && effects.advanceMinutes > 0),
    "同一结算不得一边推进虚拟时间一边将其暂停",
  );
  assertOperation(
    !current.virtualTime.paused
      || effects.advanceMinutes === 0
      || effects.setPaused === false,
    "暂停中的世界必须先恢复后才能推进虚拟时间",
  );
  const elapsedMinutes = Math.min(
    release.expectedDurationMinutes,
    current.virtualTime.elapsedMinutes + effects.advanceMinutes,
  );
  const remainingMinutes = release.expectedDurationMinutes - elapsedMinutes;
  let endingState = structuredClone(current.endingState);
  if (effects.ending !== null) {
    const expectedStatus = endingStatusFor(release, effects.ending.endingRef);
    assertOperation(
      effects.ending.status === expectedStatus,
      `结局 ${effects.ending.endingRef} 的状态与发布定义不一致`,
    );
    endingState = {
      status: effects.ending.status,
      endingRef: effects.ending.endingRef,
    };
  } else if (remainingMinutes === 0 && endingState.status === "active") {
    const deadlineEnding = release.endingDefinitions.find(
      (candidate) => candidate.endingKind === "deadline_failure",
    );
    if (deadlineEnding) {
      endingState = {
        status: "recoverable_failure",
        endingRef: deadlineEnding.endingId,
      };
    }
  }

  const snapshot = WorldSnapshotSchema.parse({
    ...current,
    schemaVersion: WorldSnapshotSchemaVersion,
    snapshotId: input.nextSnapshotId,
    stateVersion: current.stateVersion + 1,
    virtualTime: {
      ...current.virtualTime,
      currentAt: datePlusMinutes(
        current.virtualTime.startedAt,
        elapsedMinutes,
      ),
      elapsedMinutes,
      remainingMinutes,
      paused: effects.setPaused ?? current.virtualTime.paused,
    },
    entities,
    variables,
    facts,
    relationships,
    resources,
    endingState,
    generatedAt,
  });
  return { snapshot, variableDeltas };
}

export class WorldSimulationEngineV3 {
  readonly #store: SimulationSessionStore;
  readonly #now: () => string;
  readonly #idFactory: (prefix: string) => string;
  readonly #locks = new Map<string, Promise<void>>();
  readonly #fieldLessons = new Map<string, ExplorationLesson>();

  constructor(options: WorldSimulationEngineV3Options) {
    this.#store = options.store;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#idFactory = options.idFactory
      ?? ((prefix) => `${prefix}-${randomUUID()}`);
    for (const lesson of options.fieldLessons ?? []) {
      const errors = validateExplorationLesson(lesson);
      if (errors.length) throw new Error(`现场课程发布无效：${errors.join("；")}`);
      if (this.#fieldLessons.has(lesson.contentHash)) throw new Error("现场课程发布重复");
      this.#fieldLessons.set(lesson.contentHash, structuredClone(lesson));
    }
  }

  registerFieldLesson(lesson: ExplorationLesson): void {
    const errors = validateExplorationLesson(lesson);
    if (errors.length) throw new Error(`现场课程发布无效：${errors.join("；")}`);
    if (!this.#fieldLessons.has(lesson.contentHash)) this.#fieldLessons.set(lesson.contentHash, structuredClone(lesson));
  }

  getFieldLesson(contentHash: string): ExplorationLesson {
    return structuredClone(this.#requiredFieldLesson(contentHash));
  }

  async startSession(
    input: StartWorldSimulationInput,
  ): Promise<WorldSnapshot> {
    return this.#serialized(input.sessionId, async () => {
      assertOperation(identifierPattern.test(input.sessionId), "会话 ID 非法");
      const release = WorldSimulationReleaseSchema.parse(input.release);
      const assignment = ChallengeAssignmentSchema.parse(
        input.challengeAssignment,
      );
      assertOperation(assignment.sessionId === input.sessionId, "挑战分配跨会话");
      assertOperation(
        sameReleaseRef(
          release.simulationReleaseRef,
          assignment.simulationReleaseRef,
        ),
        "挑战分配与世界发布版不一致",
      );
      const variant = release.challengeVariants.find(
        (candidate) => candidate.worldVariantId === assignment.worldVariantRef,
      );
      assertOperation(variant !== undefined, "挑战分配引用的世界变体不存在");
      assertOperation(
        variant.challengeLevel === assignment.challengeLevel
          && variant.scoreCeiling === assignment.scoreCeiling,
        "挑战分配与世界变体等级不一致",
      );
      assertOperation(
        Number.isInteger(input.scaffoldingLevel)
          && input.scaffoldingLevel >= 0
          && input.scaffoldingLevel <= 3,
        "支架等级必须位于 0—3",
      );
      const targetCompetencyRefs = uniqueStrings(
        input.targetCompetencyRefs,
        "目标能力引用",
      );
      assertOperation(targetCompetencyRefs.length > 0, "至少需要一个目标能力");
      const startedAt = input.startedAt ?? this.#now();
      const deadlineAt = datePlusMinutes(
        startedAt,
        release.expectedDurationMinutes,
      );
      const snapshot = WorldSnapshotSchema.parse({
        schemaVersion: WorldSnapshotSchemaVersion,
        snapshotId: this.#nextId("snapshot"),
        sessionId: input.sessionId,
        simulationReleaseRef: release.simulationReleaseRef,
        stateVersion: 0,
        virtualTime: {
          startedAt,
          currentAt: startedAt,
          deadlineAt,
          elapsedMinutes: 0,
          remainingMinutes: release.expectedDurationMinutes,
          paused: false,
        },
        entities: release.worldEntities.map((entity) => ({
          entityId: entity.entityId,
          revision: 0,
          status: "available" as const,
          publicSummary: entity.publicDescription,
          visibleScopes: structuredClone(entity.visibleScopes),
        })),
        variables: release.variableDefinitions.map((variable) => ({
          variableId: variable.variableId,
          before: variable.initialValue,
          delta: 0,
          after: variable.initialValue,
          causeRefs: [input.sessionId],
          visibleScopes: structuredClone(variable.visibleScopes),
        })),
        facts: [],
        relationships: [],
        resources: [],
        learningContext: {
          learnerTwinRef: assignment.learnerTwinRef,
          challengeAssignmentRef: assignment.challengeAssignmentId,
          challengeLevel: assignment.challengeLevel,
          scoreCeiling: assignment.scoreCeiling,
          targetCompetencyRefs,
          scaffoldingLevel: input.scaffoldingLevel,
        },
        endingState: { status: "active", endingRef: null },
        generatedAt: startedAt,
      });
      const record = validateSimulationSessionRecord({
        recordVersion: SimulationSessionRecordVersion,
        recordRevision: 0,
        sessionId: input.sessionId,
        release,
        challengeAssignment: assignment,
        currentSnapshot: snapshot,
        queue: [],
        studentActions: [],
        resolutions: [],
        consequences: [],
        pendingGate: null,
        requestReceipts: [],
        nextEventSequence: 1,
        createdAt: startedAt,
        updatedAt: startedAt,
        ...(input.fieldInterview ? { fieldInterview: createFieldInterview(this.#requiredFieldLesson(input.fieldInterview.lessonHash),
          input.fieldInterview.actorId, input.fieldInterview.bindingId, input.sessionId, input.fieldInterview.inheritedContacts) } : {}),
      });
      await this.#store.create(record);
      return structuredClone(snapshot);
    });
  }

  async getRecord(sessionId: string): Promise<SimulationSessionRecord> {
    const record = await this.#store.load(sessionId);
    if (!record) throw new SimulationSessionNotFoundError(sessionId);
    return validateSimulationSessionRecord(record);
  }

  async getSnapshot(sessionId: string): Promise<WorldSnapshot> {
    return structuredClone((await this.getRecord(sessionId)).currentSnapshot);
  }

  async getFieldInterview(input: { sessionId: string; actorId: string; bindingId: string; lessonHash: string }): Promise<FieldInterviewViewV1> {
    const world = await this.getRecord(input.sessionId);
    const lesson = this.#requiredFieldLesson(world.fieldInterview?.lessonRef.contentHash ?? input.lessonHash);
    const record = world.fieldInterview ?? createFieldInterview(lesson, input.actorId, input.bindingId, input.sessionId);
    if (record.actorId !== input.actorId || record.bindingId !== input.bindingId) throw new FieldInterviewRuleError("这场采访属于其他学生，请进入本人的独立场次。", "ownership");
    return projectFieldInterview({ lesson, record, worldStateVersion: world.currentSnapshot.stateVersion,
      virtualMinute: world.currentSnapshot.virtualTime.elapsedMinutes, remainingMinutes: world.currentSnapshot.virtualTime.remainingMinutes });
  }

  /** Use the same availability gate before external work and again at the authoritative commit. */
  async assertFieldInterviewWritable(request: Pick<FieldInterviewActionRequestV1, "sessionId" | "requestId" | "expectedWorldStateVersion">): Promise<void> {
    this.#assertFieldInterviewWritable(await this.#loadRequired(request.sessionId), request);
  }

  #assertFieldInterviewWritable(world: SimulationSessionRecord, request: Pick<FieldInterviewActionRequestV1, "requestId" | "expectedWorldStateVersion">): void {
    if (world.fieldInterview?.events.some(event => event.requestId === request.requestId)) return;
    this.#assertWorldActive(world);
    if (world.currentSnapshot.stateVersion !== request.expectedWorldStateVersion) throw new FieldInterviewRuleError("现场已经变化，请同步后继续。", "conflict");
    if (world.currentSnapshot.virtualTime.paused) throw new FieldInterviewRuleError("教师已暂停现场，恢复后可继续；原记录仍保留。");
    if (world.pendingGate || world.queue.some(event => event.status === "queued" || event.status === "awaiting_gate")) throw new FieldInterviewRuleError("当前有等待处理的正式岗位决定，请先完成该决定再推进现场。");
  }

  /** One CAS writes the field action, its conversation/material effects and the authoritative world clock. */
  async commitFieldInterview(input: { request: FieldInterviewActionRequestV1; actorId: string; lessonHash: string;
    decision?: FieldInterviewSpeechDecisionV1; modelReceipt?: FieldInterviewModelReceiptV1 }) {
    return this.#serialized(input.request.sessionId, async () => {
      const world = await this.#loadRequired(input.request.sessionId);
      const lesson = this.#requiredFieldLesson(world.fieldInterview?.lessonRef.contentHash ?? input.lessonHash);
      const record = world.fieldInterview ?? createFieldInterview(lesson, input.actorId, input.request.bindingId, input.request.sessionId);
      this.#assertFieldInterviewWritable(world, input.request);
      const result = applyFieldInterviewAction({ lesson, record, request: input.request, actorId: input.actorId,
        worldStateVersion: world.currentSnapshot.stateVersion, virtualMinute: world.currentSnapshot.virtualTime.elapsedMinutes,
        remainingMinutes: world.currentSnapshot.virtualTime.remainingMinutes, now: this.#now(),
        ...(input.decision ? { decision: input.decision } : {}), ...(input.modelReceipt ? { modelReceipt: input.modelReceipt } : {}) });
      if (!result.replayed) {
        const currentSnapshot = WorldSnapshotSchema.parse({ ...world.currentSnapshot,
          snapshotId: this.#nextId("snapshot"), stateVersion: result.event.resultingWorldStateVersion,
          virtualTime: { ...world.currentSnapshot.virtualTime, elapsedMinutes: result.event.afterMinute,
            remainingMinutes: world.release.expectedDurationMinutes - result.event.afterMinute,
            currentAt: datePlusMinutes(world.currentSnapshot.virtualTime.startedAt, result.event.afterMinute) }, generatedAt: this.#now() });
        const next = this.#nextRecord(world, { currentSnapshot, fieldInterview: result.record });
        await this.#save(world, next);
      }
      const saved = result.replayed ? world.currentSnapshot : { ...world.currentSnapshot, stateVersion: result.event.resultingWorldStateVersion,
        virtualTime: { ...world.currentSnapshot.virtualTime, elapsedMinutes: result.event.afterMinute, remainingMinutes: world.release.expectedDurationMinutes - result.event.afterMinute } };
      return { view: projectFieldInterview({ lesson, record: result.record, worldStateVersion: saved.stateVersion,
        virtualMinute: saved.virtualTime.elapsedMinutes, remainingMinutes: saved.virtualTime.remainingMinutes }), eventId: result.event.id, replayed: result.replayed };
    });
  }

  #requiredFieldLesson(hash: string): ExplorationLesson {
    const lesson = this.#fieldLessons.get(hash);
    if (!lesson) throw new FieldInterviewRuleError("本场采访所引用的课程版本未装载，原存档已保留。", "conflict");
    return lesson;
  }

  async submitStudentAction(
    input: SubmitStudentWorldActionInput,
  ): Promise<SimulationEventReceipt> {
    const action = StudentWorkActionSchema.parse(input.action);
    assertOperation(
      action.schemaVersion === StudentWorkActionSchemaVersion,
      "学生动作版本不支持",
    );
    assertOperation(
      action.submissionStatus === "accepted"
        || (action.action.verb === "draft" && action.submissionStatus === "draft"),
      "只有服务端接受的学生动作或已验证草稿版本才能进入世界事件队列",
    );
    return this.#serialized(action.sessionId, async () => {
      const record = await this.#loadRequired(action.sessionId);
      const requestHash = canonicalHash({
        action,
        eventTemplateId: input.eventTemplateId,
        notBeforeVirtualMinute: input.notBeforeVirtualMinute ?? null,
      });
      const replay = this.#existingReceipt(record, input.requestId, requestHash);
      if (replay) return { event: replay, replayed: true };
      this.#assertWorldActive(record);
      assertOperation(
        action.expectedWorldStateVersion === record.currentSnapshot.stateVersion,
        "学生动作基于过期世界状态",
      );
      assertOperation(
        record.release.allowedStudentVerbs.includes(action.action.verb),
        "学生动作不在本发布版允许动词中",
      );
      const template = this.#eventTemplate(
        record,
        input.eventTemplateId,
        "student_action",
      );
      const policyEvaluation = evaluateFlagshipRuntimeActionPolicyV4(
        record.release.actionPolicy,
        input.eventTemplateId,
        record,
      );
      assertOperation(
        policyEvaluation.allowed,
        `学生动作不满足发布前置条件：${policyEvaluation.reasons.join("；")}`,
      );
      const directRefs = actionObjectReferences(action.action).filter(
        (reference) => reference.objectType === "entity"
          || reference.objectType === "world_variable",
      );
      if (directRefs.length > 0) {
        assertOperation(
          directRefs.some((reference) => template.affectedObjectRefs.some(
            (affected) => objectReferenceKey(affected) === objectReferenceKey(reference),
          )),
          "学生动作目标与事件模板受影响对象不相交",
        );
      }
      assertOperation(
        !record.studentActions.some(
          (candidate) => candidate.workActionId === action.workActionId,
        ),
        `学生动作 ID 已存在：${action.workActionId}`,
      );
      const event = this.#buildQueuedEvent({
        record,
        eventTemplateId: input.eventTemplateId,
        sourceKind: "student_action",
        sourceRef: action.workActionId,
        requestId: input.requestId,
        requestHash,
        ...(input.notBeforeVirtualMinute === undefined
          ? {}
          : { notBeforeVirtualMinute: input.notBeforeVirtualMinute }),
      });
      const next = this.#nextRecord(record, {
        queue: [...record.queue, event],
        studentActions: [...record.studentActions, action],
        requestReceipts: [
          ...record.requestReceipts,
          { requestId: input.requestId, requestHash, eventId: event.eventId },
        ],
        nextEventSequence: record.nextEventSequence + 1,
      });
      await this.#save(record, next);
      return { event: structuredClone(event), replayed: false };
    });
  }

  async enqueueNpcEvent(
    input: EnqueueSimulationEventInput,
  ): Promise<SimulationEventReceipt> {
    return this.#enqueueExternalEvent("npc_intent", input);
  }

  async enqueueSystemClockEvent(
    input: EnqueueSimulationEventInput,
  ): Promise<SimulationEventReceipt> {
    return this.#enqueueExternalEvent("system_clock", input);
  }

  async enqueueTeacherIntervention(
    input: EnqueueSimulationEventInput,
  ): Promise<SimulationEventReceipt> {
    return this.#enqueueExternalEvent("teacher_intervention", input);
  }

  async resolveNextEvent(
    input: ResolveSimulationEventInput,
  ): Promise<SimulationResolution> {
    return this.#serialized(input.sessionId, async () => {
      const record = await this.#loadRequired(input.sessionId);
      this.#assertWorldActive(record);
      if (record.pendingGate !== null) {
        throw new SimulationTeacherGatePendingError(input.sessionId);
      }
      const event = record.queue
        .filter((candidate) => candidate.status === "queued")
        .filter((candidate) => (
          candidate.notBeforeVirtualMinute
            <= record.currentSnapshot.virtualTime.elapsedMinutes
        ))
        .sort((left, right) => left.sequence - right.sequence)[0];
      if (!event) throw new SimulationNoReadyEventError(input.sessionId);

      const now = this.#now();
      if (input.expectedWorldStateVersion !== record.currentSnapshot.stateVersion) {
        return this.#commitFailure({
          record,
          event,
          input,
          code: "state_version_drift",
          safeMessage: "世界状态已经变化，请基于最新现场重新调度。",
          resolvedAt: now,
        });
      }
      let selection: ResolutionSelection;
      let gateId: string | null;
      try {
        selection = this.#selectResolution(record, event, input.runs, now);
        assertOperation(selection.acceptedRuns.length > 0, "没有可接受的智能体意图");
        uniqueStrings(input.evidenceIds, "结算证据引用");
        assertOperation(
          input.consequenceSummary.trim().length > 0
            && input.consequenceSummary.trim().length <= 1_000,
          "结算后果摘要必须为 1—1000 字",
        );
        // Preview every authoritative mutation before it can enter a teacher gate.
        // This guarantees that approval cannot reveal a delayed bounds/reference error.
        applyEffectsToSnapshot({
          record,
          event,
          resolutionId: "preview-resolution",
          effects: selection.effects,
          generatedAt: now,
          nextSnapshotId: "preview-snapshot",
        });
        gateId = this.#requiredTeacherGate(
          record,
          event,
          selection.acceptedRuns,
        );
      } catch (error) {
        return this.#commitFailure({
          record,
          event,
          input,
          code: error instanceof InvalidSimulationOperationError
            ? "invalid_reference"
            : "agent_failure",
          safeMessage: error instanceof Error
            ? error.message.slice(0, 500)
            : "智能体提案无法安全结算。",
          resolvedAt: now,
        });
      }

      const resolutionId = this.#nextId("resolution");
      const acceptedIntents = selection.acceptedRuns.map((run) => ({
        intentId: run.intent.intentId,
        agentTaskId: run.intent.agentTaskId,
        agentRunId: run.intent.agentRunId,
        outputHash: run.outputHash,
      }));
      if (gateId !== null) {
        const pendingResolution = SimulationResolutionSchema.parse({
          schemaVersion: SimulationResolutionSchemaVersion,
          resolutionId,
          sessionId: input.sessionId,
          sourceWorldEventId: event.eventId,
          dispatchPlanId: input.dispatchPlanId,
          resolutionProposalId: input.resolutionProposalId,
          expectedWorldStateVersion: input.expectedWorldStateVersion,
          status: "pending_teacher_gate",
          acceptedIntents,
          skippedIntents: selection.skippedIntents,
          variableDeltas: [],
          emittedWorldEventIds: [],
          emittedEvidenceIds: [],
          teacherGate: {
            gateId,
            status: "pending",
            teacherDecisionRef: null,
          },
          failure: null,
          committedAt: null,
          resolvedAt: now,
        });
        const pendingGate: PendingSimulationGate = {
          eventId: event.eventId,
          resolutionId,
          resolutionProposalId: input.resolutionProposalId,
          dispatchPlanId: input.dispatchPlanId,
          acceptedRuns: structuredClone(selection.acceptedRuns),
          skippedIntentIds: selection.skippedIntents.map((item) => item.intentId),
          resolvedEffects: structuredClone(selection.effects),
          consequenceSummary: input.consequenceSummary.trim(),
          evidenceIds: structuredClone(input.evidenceIds),
          gateId,
          createdAt: now,
        };
        const next = this.#nextRecord(record, {
          queue: record.queue.map((candidate) => candidate.eventId === event.eventId
            ? { ...candidate, status: "awaiting_gate", resolutionId }
            : candidate),
          resolutions: [...record.resolutions, pendingResolution],
          pendingGate,
        });
        await this.#save(record, next);
        return structuredClone(pendingResolution);
      }

      const committed = this.#buildCommittedResolution({
        record,
        event,
        resolutionId,
        dispatchPlanId: input.dispatchPlanId,
        resolutionProposalId: input.resolutionProposalId,
        expectedWorldStateVersion: input.expectedWorldStateVersion,
        acceptedRuns: selection.acceptedRuns,
        skippedIntents: selection.skippedIntents,
        effects: selection.effects,
        evidenceIds: input.evidenceIds,
        consequenceSummary: input.consequenceSummary.trim(),
        teacherGate: null,
        committedAt: now,
      });
      const next = this.#nextRecord(record, {
        currentSnapshot: committed.snapshot,
        queue: record.queue.map((candidate) => candidate.eventId === event.eventId
          ? { ...candidate, status: "committed", resolutionId }
          : candidate),
        resolutions: [...record.resolutions, committed.resolution],
        consequences: [...record.consequences, committed.consequence],
      });
      await this.#save(record, next);
      return structuredClone(committed.resolution);
    });
  }

  /**
   * Closes the first ready event after a student explicitly requests more
   * evidence or rejects the proposed handling. This persists the process
   * decision while deliberately leaving the authoritative WorldSnapshot and
   * consequence stream untouched.
   */
  async declineNextEvent(
    input: DeclineSimulationEventInput,
  ): Promise<SimulationResolution> {
    return this.#serialized(input.sessionId, async () => {
      const record = await this.#loadRequired(input.sessionId);
      const existingEvent = record.queue.find(
        (candidate) => candidate.eventId === input.sourceWorldEventId,
      );
      assertOperation(existingEvent !== undefined, "待关闭事件不存在");
      if (existingEvent.status === "rejected") {
        const existing = record.resolutions.find(
          (resolution) => resolution.resolutionId === existingEvent.resolutionId,
        );
        assertOperation(existing?.status === "rejected", "拒绝事件缺少解析记录");
        assertOperation(
          existing.dispatchPlanId === input.dispatchPlanId
            && existing.resolutionProposalId === input.resolutionProposalId,
          "同一事件的关闭请求内容不一致",
        );
        return structuredClone(existing);
      }
      this.#assertWorldActive(record);
      assertOperation(record.pendingGate === null, "教师门等待期间不能关闭其他事件");
      const ready = record.queue
        .filter((candidate) => candidate.status === "queued")
        .filter((candidate) => candidate.notBeforeVirtualMinute
          <= record.currentSnapshot.virtualTime.elapsedMinutes)
        .sort((left, right) => left.sequence - right.sequence)[0];
      assertOperation(ready?.eventId === input.sourceWorldEventId,
        "只能关闭当前最先可处理的事件");
      assertOperation(
        input.expectedWorldStateVersion === record.currentSnapshot.stateVersion,
        "关闭决定基于过期世界状态",
      );
      assertOperation(identifierPattern.test(input.dispatchPlanId), "派发计划引用非法");
      assertOperation(identifierPattern.test(input.resolutionProposalId), "解析提案引用非法");
      const resolvedAt = this.#now();
      const resolution = SimulationResolutionSchema.parse({
        schemaVersion: SimulationResolutionSchemaVersion,
        resolutionId: this.#nextId("resolution"),
        sessionId: input.sessionId,
        sourceWorldEventId: input.sourceWorldEventId,
        dispatchPlanId: input.dispatchPlanId,
        resolutionProposalId: input.resolutionProposalId,
        expectedWorldStateVersion: input.expectedWorldStateVersion,
        status: "rejected",
        acceptedIntents: [],
        skippedIntents: input.skippedIntents,
        variableDeltas: [],
        emittedWorldEventIds: [],
        emittedEvidenceIds: [],
        teacherGate: null,
        failure: null,
        committedAt: null,
        resolvedAt,
      });
      const next = this.#nextRecord(record, {
        queue: record.queue.map((candidate) => (
          candidate.eventId === ready.eventId
            ? { ...candidate, status: "rejected", resolutionId: resolution.resolutionId }
            : candidate
        )),
        resolutions: [...record.resolutions, resolution],
      });
      await this.#save(record, next);
      return structuredClone(resolution);
    });
  }

  async decideTeacherGate(
    input: DecideSimulationTeacherGateInput,
  ): Promise<SimulationResolution> {
    return this.#serialized(input.sessionId, async () => {
      assertOperation(
        identifierPattern.test(input.teacherDecisionRef),
        "教师决定引用非法",
      );
      assertOperation(
        (input.decision === "revised") === (input.revisionPolicy !== null),
        "只有修订决定需要且必须声明修订策略",
      );
      assertOperation(
        (input.decision === "revised")
          === (input.revisedConsequenceSummary !== null),
        "只有修订决定需要且必须提供修订后的公开后果摘要",
      );
      if (input.revisedConsequenceSummary !== null) {
        assertOperation(
          input.revisedConsequenceSummary.trim().length > 0
            && input.revisedConsequenceSummary.trim().length <= 1_000,
          "修订后的公开后果摘要必须为 1—1000 字",
        );
      }
      const record = await this.#loadRequired(input.sessionId);
      const pending = record.pendingGate;
      assertOperation(pending !== null, "当前不存在待审教师门");
      assertOperation(
        pending.resolutionId === input.resolutionId,
        "教师决定与待审解析不一致",
      );
      const resolutionIndex = record.resolutions.findIndex(
        (candidate) => candidate.resolutionId === input.resolutionId,
      );
      assertOperation(resolutionIndex >= 0, "待审解析记录不存在");
      const previous = record.resolutions[resolutionIndex]!;
      assertOperation(
        previous.status === "pending_teacher_gate",
        "解析已经完成教师门处理",
      );
      const event = record.queue.find(
        (candidate) => candidate.eventId === pending.eventId,
      );
      assertOperation(event !== undefined, "待审教师门来源事件不存在");
      const now = this.#now();

      if (input.decision === "rejected") {
        const rejected = SimulationResolutionSchema.parse({
          ...previous,
          status: "rejected",
          variableDeltas: [],
          emittedWorldEventIds: [],
          emittedEvidenceIds: [],
          teacherGate: {
            gateId: pending.gateId,
            status: "rejected",
            teacherDecisionRef: input.teacherDecisionRef,
          },
          failure: null,
          committedAt: null,
          resolvedAt: now,
        });
        const resolutions = [...record.resolutions];
        resolutions[resolutionIndex] = rejected;
        const next = this.#nextRecord(record, {
          queue: record.queue.map((candidate) => candidate.eventId === event.eventId
            ? { ...candidate, status: "rejected", resolutionId: rejected.resolutionId }
            : candidate),
          resolutions,
          pendingGate: null,
        });
        await this.#save(record, next);
        return structuredClone(rejected);
      }

      const effects = input.decision === "revised"
        ? reduceEffectsForTeacherRevision(pending.resolvedEffects)
        : pending.resolvedEffects;
      const committed = this.#buildCommittedResolution({
        record,
        event,
        resolutionId: previous.resolutionId,
        dispatchPlanId: previous.dispatchPlanId,
        resolutionProposalId: previous.resolutionProposalId,
        expectedWorldStateVersion: previous.expectedWorldStateVersion,
        acceptedRuns: pending.acceptedRuns,
        skippedIntents: previous.skippedIntents,
        effects,
        evidenceIds: pending.evidenceIds,
        consequenceSummary: input.revisedConsequenceSummary?.trim()
          ?? pending.consequenceSummary,
        teacherGate: {
          gateId: pending.gateId,
          status: input.decision,
          teacherDecisionRef: input.teacherDecisionRef,
        },
        committedAt: now,
      });
      const resolutions = [...record.resolutions];
      resolutions[resolutionIndex] = committed.resolution;
      const next = this.#nextRecord(record, {
        currentSnapshot: committed.snapshot,
        queue: record.queue.map((candidate) => candidate.eventId === event.eventId
          ? {
              ...candidate,
              status: "committed",
              resolutionId: committed.resolution.resolutionId,
            }
          : candidate),
        resolutions,
        consequences: [...record.consequences, committed.consequence],
        pendingGate: null,
      });
      await this.#save(record, next);
      return structuredClone(committed.resolution);
    });
  }

  async #enqueueExternalEvent(
    sourceKind: Exclude<SimulationEventSourceKind, "student_action">,
    input: EnqueueSimulationEventInput,
  ): Promise<SimulationEventReceipt> {
    return this.#serialized(input.sessionId, async () => {
      const record = await this.#loadRequired(input.sessionId);
      const requestHash = canonicalHash({ ...input, sourceKind });
      const replay = this.#existingReceipt(record, input.requestId, requestHash);
      if (replay) return { event: replay, replayed: true };
      this.#assertWorldActive(record);
      assertOperation(
        input.expectedWorldStateVersion === record.currentSnapshot.stateVersion,
        "事件基于过期世界状态",
      );
      this.#eventTemplate(record, input.eventTemplateId, sourceKind);
      assertOperation(identifierPattern.test(input.sourceRef), "事件来源引用非法");
      const event = this.#buildQueuedEvent({
        record,
        eventTemplateId: input.eventTemplateId,
        sourceKind,
        sourceRef: input.sourceRef,
        requestId: input.requestId,
        requestHash,
        ...(input.notBeforeVirtualMinute === undefined
          ? {}
          : { notBeforeVirtualMinute: input.notBeforeVirtualMinute }),
      });
      const next = this.#nextRecord(record, {
        queue: [...record.queue, event],
        requestReceipts: [
          ...record.requestReceipts,
          { requestId: input.requestId, requestHash, eventId: event.eventId },
        ],
        nextEventSequence: record.nextEventSequence + 1,
      });
      await this.#save(record, next);
      return { event: structuredClone(event), replayed: false };
    });
  }

  #eventTemplate(
    record: SimulationSessionRecord,
    eventTemplateId: string,
    expectedSourceKind: SimulationEventSourceKind,
  ): WorldSimulationRelease["eventTemplates"][number] {
    const template = record.release.eventTemplates.find(
      (candidate) => candidate.eventTemplateId === eventTemplateId,
    );
    assertOperation(template !== undefined, `事件模板不存在：${eventTemplateId}`);
    assertOperation(
      template.sourceKind === expectedSourceKind,
      `事件模板 ${eventTemplateId} 不接受 ${expectedSourceKind} 来源`,
    );
    const variant = record.release.challengeVariants.find(
      (candidate) => candidate.worldVariantId
        === record.challengeAssignment.worldVariantRef,
    );
    assertOperation(variant !== undefined, "当前世界变体不存在");
    assertOperation(
      variant.eventTemplateRefs.includes(eventTemplateId)
        && template.challengeLevels.includes(
          record.challengeAssignment.challengeLevel,
        ),
      `事件模板 ${eventTemplateId} 不属于当前挑战等级`,
    );
    return template;
  }

  #buildQueuedEvent(input: {
    record: SimulationSessionRecord;
    eventTemplateId: string;
    sourceKind: SimulationEventSourceKind;
    sourceRef: string;
    requestId: string;
    requestHash: string;
    notBeforeVirtualMinute?: number;
  }): SimulationQueuedEvent {
    assertOperation(identifierPattern.test(input.requestId), "请求 ID 非法");
    const template = this.#eventTemplate(
      input.record,
      input.eventTemplateId,
      input.sourceKind,
    );
    const notBeforeVirtualMinute = input.notBeforeVirtualMinute
      ?? input.record.currentSnapshot.virtualTime.elapsedMinutes;
    assertOperation(
      Number.isInteger(notBeforeVirtualMinute)
        && notBeforeVirtualMinute >= 0
        && notBeforeVirtualMinute <= input.record.release.expectedDurationMinutes,
      "事件最早虚拟时间必须位于本局时长内",
    );
    return {
      eventId: this.#nextId("world-event"),
      sessionId: input.record.sessionId,
      eventTemplateId: template.eventTemplateId,
      eventType: template.eventType,
      sourceKind: input.sourceKind,
      sourceRef: input.sourceRef,
      requestId: input.requestId,
      requestHash: input.requestHash,
      enqueuedAtStateVersion: input.record.currentSnapshot.stateVersion,
      sequence: input.record.nextEventSequence,
      notBeforeVirtualMinute,
      affectedObjectRefs: structuredClone(template.affectedObjectRefs),
      status: "queued",
      resolutionId: null,
      occurredAt: this.#now(),
    };
  }

  #existingReceipt(
    record: SimulationSessionRecord,
    requestId: string,
    requestHash: string,
  ): SimulationQueuedEvent | null {
    assertOperation(identifierPattern.test(requestId), "请求 ID 非法");
    const receipt = record.requestReceipts.find(
      (candidate) => candidate.requestId === requestId,
    );
    if (!receipt) return null;
    if (receipt.requestHash !== requestHash) {
      throw new SimulationRequestReplayError(requestId);
    }
    const event = record.queue.find(
      (candidate) => candidate.eventId === receipt.eventId,
    );
    assertOperation(event !== undefined, "请求收据引用的事件不存在");
    return structuredClone(event);
  }

  #selectResolution(
    record: SimulationSessionRecord,
    event: SimulationQueuedEvent,
    rawRuns: SimulationIntentRunProposal[],
    now: string,
  ): ResolutionSelection {
    assertOperation(rawRuns.length > 0 && rawRuns.length <= 14, "智能体运行数必须为 1—14");
    const template = this.#eventTemplate(record, event.eventTemplateId, event.sourceKind);
    const rules = template.ruleRefs.map((ruleRef) => {
      const rule = record.release.rules.find((candidate) => candidate.ruleId === ruleRef);
      assertOperation(rule !== undefined, `事件规则不存在：${ruleRef}`);
      return rule;
    });
    const allowedIntentTypes = new Set(rules.flatMap((rule) => rule.allowedIntentTypes));
    const allowedVariableIds = new Set([
      ...rules.flatMap((rule) => rule.affectedVariableIds),
      ...template.affectedObjectRefs
        .filter((reference) => reference.objectType === "world_variable")
        .map((reference) => reference.objectId),
    ]);
    const parsedRuns = rawRuns.map((run) => {
      const intent = SimulationAgentIntentSchema.parse(run.intent);
      assertOperation(contentHashPattern.test(run.outputHash), "智能体输出哈希非法");
      assertOperation(
        intent.expectedWorldStateVersion === record.currentSnapshot.stateVersion,
        `智能体意图 ${intent.intentId} 基于过期世界状态`,
      );
      assertOperation(
        new Date(intent.createdAt).getTime() <= new Date(now).getTime(),
        `智能体意图 ${intent.intentId} 声称来自未来`,
      );
      assertOperation(
        new Date(intent.expiresAt).getTime() > new Date(now).getTime(),
        `智能体意图 ${intent.intentId} 已过期`,
      );
      assertOperation(
        allowedIntentTypes.has(intent.intentType),
        `智能体意图类型未获当前规则授权：${intent.intentType}`,
      );
      this.#validateEffects(record, template, allowedVariableIds, intent, run.effects);
      return structuredClone({ ...run, intent });
    });
    uniqueStrings(parsedRuns.map((run) => run.intent.intentId), "智能体意图 ID");
    uniqueStrings(parsedRuns.map((run) => run.intent.agentRunId), "智能体运行 ID");

    const sorted = parsedRuns.sort((left, right) => (
      right.intent.confidence - left.intent.confidence
        || left.intent.intentId.localeCompare(right.intent.intentId)
    ));
    const selection = emptySelection();
    const claimed = new Set<string>();
    for (const run of sorted) {
      const keys = effectKeys(run.effects);
      if (keys.some((key) => claimed.has(key))) {
        selection.skippedIntents.push({
          intentId: run.intent.intentId,
          reasonCode: "lower_ranked",
        });
        continue;
      }
      pushWinningEffects(selection.effects, run.effects, claimed);
      selection.acceptedRuns.push(run);
    }
    return selection;
  }

  #validateEffects(
    record: SimulationSessionRecord,
    template: WorldSimulationRelease["eventTemplates"][number],
    allowedVariableIds: ReadonlySet<string>,
    intent: SimulationAgentIntent,
    effects: SimulationRunEffects,
  ): void {
    const keys = effectKeys(effects);
    assertOperation(new Set(keys).size === keys.length, `意图 ${intent.intentId} 内存在重复效果目标`);
    assertOperation(
      Number.isInteger(effects.advanceMinutes)
        && effects.advanceMinutes >= 0
        && effects.advanceMinutes <= record.release.expectedDurationMinutes,
      `意图 ${intent.intentId} 的虚拟时间效果非法`,
    );
    assertOperation(
      effects.setPaused === null || typeof effects.setPaused === "boolean",
      `意图 ${intent.intentId} 的暂停效果非法`,
    );
    const requireIntentTarget = (
      objectType: SimulationObjectReference["objectType"],
      objectId: string,
    ): void => assertOperation(
      hasReference(intent.targetObjectRefs, objectType, objectId),
      `意图 ${intent.intentId} 未声明效果目标 ${objectType}:${objectId}`,
    );
    const requireTemplateTarget = (
      objectType: SimulationObjectReference["objectType"],
      objectId: string,
    ): void => assertOperation(
      hasReference(template.affectedObjectRefs, objectType, objectId),
      `事件 ${template.eventTemplateId} 未授权影响 ${objectType}:${objectId}`,
    );
    for (const effect of effects.variables) {
      requireIntentTarget("world_variable", effect.variableId);
      assertOperation(
        allowedVariableIds.has(effect.variableId),
        `事件规则未授权影响变量：${effect.variableId}`,
      );
      assertOperation(Number.isFinite(effect.delta), "世界变量增量必须是有限数值");
    }
    for (const effect of effects.entities) {
      requireIntentTarget("entity", effect.entityId);
      requireTemplateTarget("entity", effect.entityId);
      assertOperation(
        record.currentSnapshot.entities.some(
          (candidate) => candidate.entityId === effect.entityId,
        ),
        `世界实体不存在：${effect.entityId}`,
      );
    }
    for (const effect of effects.facts) {
      requireIntentTarget("fact", effect.factId);
      requireTemplateTarget("fact", effect.factId);
      assertOperation(
        effect.confidence >= 0 && effect.confidence <= 1,
        `事实 ${effect.factId} 置信度非法`,
      );
    }
    for (const effect of effects.relationships) {
      requireIntentTarget("relationship", effect.relationshipId);
      requireTemplateTarget("relationship", effect.relationshipId);
      assertOperation(
        record.currentSnapshot.entities.some(
          (candidate) => candidate.entityId === effect.sourceEntityId,
        ) && record.currentSnapshot.entities.some(
          (candidate) => candidate.entityId === effect.targetEntityId,
        ),
        `关系 ${effect.relationshipId} 端点非法`,
      );
    }
    for (const effect of effects.resources) {
      requireIntentTarget("resource", effect.resourceId);
      requireTemplateTarget("resource", effect.resourceId);
      assertOperation(Number.isFinite(effect.amountDelta), "资源增量必须是有限数值");
    }
    if (effects.ending !== null) {
      assertOperation(
        record.release.endingDefinitions.some(
          (candidate) => candidate.endingId === effects.ending?.endingRef,
        ),
        `结局引用不存在：${effects.ending.endingRef}`,
      );
    }
  }

  #requiredTeacherGate(
    record: SimulationSessionRecord,
    event: SimulationQueuedEvent,
    acceptedRuns: SimulationIntentRunProposal[],
  ): string | null {
    const template = this.#eventTemplate(record, event.eventTemplateId, event.sourceKind);
    const gates = template.ruleRefs.flatMap((ruleRef) => {
      const rule = record.release.rules.find((candidate) => candidate.ruleId === ruleRef);
      return rule?.teacherGateId ? [rule.teacherGateId] : [];
    });
    const requiresGate = gates.length > 0 || acceptedRuns.some(
      (run) => run.intent.requiresTeacherGate || run.intent.riskLevel === "high",
    );
    if (!requiresGate) return null;
    const uniqueGates = [...new Set(gates)].sort();
    assertOperation(uniqueGates.length === 1, "高风险解析必须唯一映射到一个教师门");
    return uniqueGates[0]!;
  }

  #buildCommittedResolution(input: {
    record: SimulationSessionRecord;
    event: SimulationQueuedEvent;
    resolutionId: string;
    dispatchPlanId: string;
    resolutionProposalId: string;
    expectedWorldStateVersion: number;
    acceptedRuns: SimulationIntentRunProposal[];
    skippedIntents: SimulationResolution["skippedIntents"];
    effects: SimulationRunEffects;
      evidenceIds: string[];
    consequenceSummary: string;
    teacherGate: SimulationResolution["teacherGate"];
    committedAt: string;
  }): {
    snapshot: WorldSnapshot;
    resolution: SimulationResolution;
    consequence: SimulationConsequenceRecord;
  } {
    const applied = applyEffectsToSnapshot({
      record: input.record,
      event: input.event,
      resolutionId: input.resolutionId,
      effects: input.effects,
      generatedAt: input.committedAt,
      nextSnapshotId: this.#nextId("snapshot"),
    });
    const consequenceEventId = this.#nextId("world-consequence");
    const resolution = SimulationResolutionSchema.parse({
      schemaVersion: SimulationResolutionSchemaVersion,
      resolutionId: input.resolutionId,
      sessionId: input.record.sessionId,
      sourceWorldEventId: input.event.eventId,
      dispatchPlanId: input.dispatchPlanId,
      resolutionProposalId: input.resolutionProposalId,
      expectedWorldStateVersion: input.expectedWorldStateVersion,
      status: "committed",
      acceptedIntents: input.acceptedRuns.map((run) => ({
        intentId: run.intent.intentId,
        agentTaskId: run.intent.agentTaskId,
        agentRunId: run.intent.agentRunId,
        outputHash: run.outputHash,
      })),
      skippedIntents: input.skippedIntents,
      variableDeltas: applied.variableDeltas,
      emittedWorldEventIds: [consequenceEventId],
      emittedEvidenceIds: uniqueStrings(input.evidenceIds, "结算证据引用"),
      teacherGate: input.teacherGate,
      failure: null,
      committedAt: input.committedAt,
      resolvedAt: input.committedAt,
    });
    const consequence: SimulationConsequenceRecord = {
      eventId: consequenceEventId,
      sessionId: input.record.sessionId,
      resolutionId: resolution.resolutionId,
      sourceWorldEventId: input.event.eventId,
      publicSummary: input.consequenceSummary,
      evidenceIds: structuredClone(resolution.emittedEvidenceIds),
      resultingStateVersion: applied.snapshot.stateVersion,
      occurredAt: input.committedAt,
      virtualMinute: applied.snapshot.virtualTime.elapsedMinutes,
    };
    return { snapshot: applied.snapshot, resolution, consequence };
  }

  async #commitFailure(input: {
    record: SimulationSessionRecord;
    event: SimulationQueuedEvent;
    input: ResolveSimulationEventInput;
    code: NonNullable<SimulationResolution["failure"]>["code"];
    safeMessage: string;
    resolvedAt: string;
  }): Promise<SimulationResolution> {
    const resolution = SimulationResolutionSchema.parse({
      schemaVersion: SimulationResolutionSchemaVersion,
      resolutionId: this.#nextId("resolution"),
      sessionId: input.record.sessionId,
      sourceWorldEventId: input.event.eventId,
      dispatchPlanId: input.input.dispatchPlanId,
      resolutionProposalId: input.input.resolutionProposalId,
      expectedWorldStateVersion: input.input.expectedWorldStateVersion,
      status: "failed",
      acceptedIntents: [],
      skippedIntents: [],
      variableDeltas: [],
      emittedWorldEventIds: [],
      emittedEvidenceIds: [],
      teacherGate: null,
      failure: {
        code: input.code,
        safeMessage: input.safeMessage.trim().slice(0, 500) || "世界结算失败。",
      },
      committedAt: null,
      resolvedAt: input.resolvedAt,
    });
    const next = this.#nextRecord(input.record, {
      queue: input.record.queue.map((candidate) => (
        candidate.eventId === input.event.eventId
          ? { ...candidate, status: "failed", resolutionId: resolution.resolutionId }
          : candidate
      )),
      resolutions: [...input.record.resolutions, resolution],
    });
    await this.#save(input.record, next);
    return structuredClone(resolution);
  }

  #nextRecord(
    record: SimulationSessionRecord,
    changes: Partial<SimulationSessionRecord>,
  ): SimulationSessionRecord {
    return validateSimulationSessionRecord({
      ...record,
      ...changes,
      recordVersion: SimulationSessionRecordVersion,
      recordRevision: record.recordRevision + 1,
      sessionId: record.sessionId,
      updatedAt: this.#now(),
    });
  }

  async #save(
    previous: SimulationSessionRecord,
    next: SimulationSessionRecord,
  ): Promise<void> {
    await this.#store.compareAndSet(
      previous.sessionId,
      previous.recordRevision,
      next,
    );
  }

  async #loadRequired(sessionId: string): Promise<SimulationSessionRecord> {
    const record = await this.#store.load(sessionId);
    if (!record) throw new SimulationSessionNotFoundError(sessionId);
    return validateSimulationSessionRecord(record);
  }

  #assertWorldActive(record: SimulationSessionRecord): void {
    if (record.currentSnapshot.endingState.status !== "active") {
      throw new SimulationWorldEndedError(record.sessionId);
    }
  }

  #nextId(prefix: string): string {
    const value = this.#idFactory(prefix);
    assertOperation(identifierPattern.test(value), `ID 生成器返回非法 ID：${value}`);
    return value;
  }

  async #serialized<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.#locks.get(sessionId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => gate);
    this.#locks.set(sessionId, tail);
    await previous;
    try {
      return await task();
    } finally {
      release();
      if (this.#locks.get(sessionId) === tail) this.#locks.delete(sessionId);
    }
  }
}
