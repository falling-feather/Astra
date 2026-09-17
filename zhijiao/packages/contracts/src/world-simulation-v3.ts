import { z } from "zod";
import {
  CourseReleaseReferenceSchema,
  ScenarioReleaseReferenceSchema,
  V2ContentHashSchema,
  V2IdentifierSchema,
} from "./course-learning.js";
import { FlagshipRuntimeActionPolicyV4Schema } from "./flagship-action-policy-v4.js";

export const WorldSimulationReleaseSchemaVersion =
  "world-simulation-release/3.0.0" as const;
export const WorldSnapshotSchemaVersion = "world-snapshot/3.0.0" as const;
export const AgentStateSchemaVersion = "agent-state/3.0.0" as const;
export const AgentObservationSchemaVersion =
  "agent-observation/3.0.0" as const;
export const SimulationAgentIntentSchemaVersion =
  "agent-intent/3.0.0" as const;
export const SimulationResolutionSchemaVersion =
  "simulation-resolution/3.0.0" as const;
export const StudentWorkActionSchemaVersion =
  "student-work-action/3.0.0" as const;

export const ChallengeLevelSchema = z.number().int().min(3).max(7);
export type ChallengeLevel = z.infer<typeof ChallengeLevelSchema>;

export const ChallengeScoreCeilingSchema = z.number().int().min(80).max(100);
export type ChallengeScoreCeiling = z.infer<
  typeof ChallengeScoreCeilingSchema
>;

export function challengeScoreCeiling(level: ChallengeLevel): ChallengeScoreCeiling {
  return ({ 3: 80, 4: 85, 5: 90, 6: 95, 7: 100 } as const)[level]!;
}

export const SimulationVisibilityScopeSchema = z.enum([
  "student",
  "teacher",
  "admin",
  "role_private",
  "audit_only",
]);
export type SimulationVisibilityScope = z.infer<
  typeof SimulationVisibilityScopeSchema
>;

export const SimulationReleaseReferenceSchema = z.object({
  simulationId: V2IdentifierSchema,
  releaseId: V2IdentifierSchema,
  version: z.number().int().positive(),
  contentHash: V2ContentHashSchema,
}).strict();
export type SimulationReleaseReference = z.infer<
  typeof SimulationReleaseReferenceSchema
>;

export const SimulationObjectReferenceSchema = z.object({
  objectType: z.enum([
    "entity",
    "world_variable",
    "fact",
    "relationship",
    "resource",
    "artifact",
    "event",
    "agent",
  ]),
  objectId: V2IdentifierSchema,
}).strict();
export type SimulationObjectReference = z.infer<
  typeof SimulationObjectReferenceSchema
>;

const TimestampSchema = z.string().datetime();
const NonEmptyTextSchema = z.string().trim().min(1);

function addDuplicateIssues(
  values: string[],
  path: PropertyKey[],
  message: string,
  context: z.RefinementCtx,
): void {
  if (new Set(values).size !== values.length) {
    context.addIssue({ code: "custom", path, message });
  }
}

const WorldEntityDefinitionSchema = z.object({
  entityId: V2IdentifierSchema,
  entityKind: z.enum([
    "person",
    "organization",
    "location",
    "platform",
    "source",
    "material",
    "artifact",
  ]),
  title: NonEmptyTextSchema.max(160),
  professionalRole: NonEmptyTextSchema.max(160).nullable(),
  publicDescription: NonEmptyTextSchema.max(800),
  visibleScopes: z.array(SimulationVisibilityScopeSchema).min(1).max(5),
  initialStateHash: V2ContentHashSchema,
}).strict();

const WorldVariableDefinitionSchema = z.object({
  variableId: V2IdentifierSchema,
  title: NonEmptyTextSchema.max(160),
  valueKind: z.enum(["bounded", "counter", "clock"]),
  minimum: z.number(),
  maximum: z.number(),
  initialValue: z.number(),
  studentProjection: NonEmptyTextSchema.max(320),
  visibleScopes: z.array(SimulationVisibilityScopeSchema).min(1).max(5),
}).strict().superRefine((variable, context) => {
  if (variable.minimum >= variable.maximum) {
    context.addIssue({
      code: "custom",
      path: ["maximum"],
      message: "世界变量上界必须大于下界",
    });
  }
  if (variable.initialValue < variable.minimum
    || variable.initialValue > variable.maximum) {
    context.addIssue({
      code: "custom",
      path: ["initialValue"],
      message: "世界变量初值必须位于声明范围内",
    });
  }
});

const WorldRuleDefinitionSchema = z.object({
  ruleId: V2IdentifierSchema,
  title: NonEmptyTextSchema.max(200),
  triggerEventTypes: z.array(V2IdentifierSchema).min(1).max(12),
  allowedIntentTypes: z.array(V2IdentifierSchema).min(1).max(16),
  affectedVariableIds: z.array(V2IdentifierSchema).min(1).max(16),
  riskLevel: z.enum(["low", "medium", "high"]),
  teacherGateId: V2IdentifierSchema.nullable(),
  deterministicFallbackId: V2IdentifierSchema,
}).strict().superRefine((rule, context) => {
  if (rule.riskLevel === "high" && rule.teacherGateId === null) {
    context.addIssue({
      code: "custom",
      path: ["teacherGateId"],
      message: "高风险世界规则必须声明教师门",
    });
  }
});

const WorldEventTemplateSchema = z.object({
  eventTemplateId: V2IdentifierSchema,
  eventType: V2IdentifierSchema,
  title: NonEmptyTextSchema.max(200),
  sourceKind: z.enum([
    "student_action",
    "npc_intent",
    "system_clock",
    "teacher_intervention",
  ]),
  affectedObjectRefs: z.array(SimulationObjectReferenceSchema).min(1).max(24),
  candidateAgentTemplateIds: z.array(V2IdentifierSchema).min(1).max(14),
  ruleRefs: z.array(V2IdentifierSchema).min(1).max(12),
  challengeLevels: z.array(ChallengeLevelSchema).min(1).max(5),
  publicCue: NonEmptyTextSchema.max(500),
}).strict();

const WorldEndingDefinitionSchema = z.object({
  endingId: V2IdentifierSchema,
  endingKind: z.enum([
    "professional_success",
    "recoverable_failure",
    "deadline_failure",
    "governance_failure",
  ]),
  title: NonEmptyTextSchema.max(200),
  conditionRuleRefs: z.array(V2IdentifierSchema).min(1).max(12),
  reflectionPrompt: NonEmptyTextSchema.max(800),
}).strict();

const WorldRiskGateDefinitionSchema = z.object({
  gateId: V2IdentifierSchema,
  title: NonEmptyTextSchema.max(200),
  riskCategory: z.enum([
    "publication",
    "personal_safety",
    "copyright",
    "ethics",
    "public_trust",
  ]),
  requiredReviewerRole: z.literal("teacher"),
  decisionOptions: z.tuple([
    z.literal("approve"),
    z.literal("revise"),
    z.literal("reject"),
  ]),
}).strict();

const ChallengeVariantDefinitionSchema = z.object({
  worldVariantId: V2IdentifierSchema,
  challengeLevel: ChallengeLevelSchema,
  scoreCeiling: ChallengeScoreCeilingSchema,
  pressureSummary: NonEmptyTextSchema.max(320),
  eventTemplateRefs: z.array(V2IdentifierSchema).min(1).max(24),
  scaffoldingBudget: z.number().int().min(0).max(8),
}).strict().superRefine((variant, context) => {
  if (variant.scoreCeiling !== challengeScoreCeiling(variant.challengeLevel)) {
    context.addIssue({
      code: "custom",
      path: ["scoreCeiling"],
      message: "挑战等级与本局分数上限必须按冻结映射一致",
    });
  }
});

export const WorldSimulationReleaseSchema = z.object({
  schemaVersion: z.literal(WorldSimulationReleaseSchemaVersion),
  releaseStatus: z.literal("released"),
  simulationReleaseRef: SimulationReleaseReferenceSchema,
  courseReleaseRef: CourseReleaseReferenceSchema,
  scenarioReleaseRef: ScenarioReleaseReferenceSchema,
  title: NonEmptyTextSchema.max(240),
  summary: NonEmptyTextSchema.max(2_000),
  primaryJobId: z.literal("integrated_media_reporter"),
  studentRoleId: z.literal("reporter"),
  expectedDurationMinutes: z.number().int().min(45).max(60),
  worldEntities: z.array(WorldEntityDefinitionSchema).min(7).max(120),
  variableDefinitions: z.array(WorldVariableDefinitionSchema).min(9).max(48),
  rules: z.array(WorldRuleDefinitionSchema).min(6).max(120),
  eventTemplates: z.array(WorldEventTemplateSchema).min(6).max(160),
  endingDefinitions: z.array(WorldEndingDefinitionSchema).min(3).max(12),
  riskGates: z.array(WorldRiskGateDefinitionSchema).min(1).max(24),
  challengeVariants: z.array(ChallengeVariantDefinitionSchema).length(5),
  actionPolicy: FlagshipRuntimeActionPolicyV4Schema.optional(),
  allowedStudentVerbs: z.tuple([
    z.literal("observe"),
    z.literal("ask"),
    z.literal("probe"),
    z.literal("inspect"),
    z.literal("compare"),
    z.literal("negotiate"),
    z.literal("draft"),
    z.literal("wait"),
    z.literal("escalate"),
    z.literal("submit"),
  ]),
  publishedAt: TimestampSchema,
}).strict().superRefine((release, context) => {
  const entityIds = release.worldEntities.map((entity) => entity.entityId);
  const variableIds = release.variableDefinitions.map(
    (variable) => variable.variableId,
  );
  const ruleIds = release.rules.map((rule) => rule.ruleId);
  const eventIds = release.eventTemplates.map((event) => event.eventTemplateId);
  const endingIds = release.endingDefinitions.map((ending) => ending.endingId);
  const gateIds = release.riskGates.map((gate) => gate.gateId);
  addDuplicateIssues(entityIds, ["worldEntities"], "世界实体 ID 必须唯一", context);
  addDuplicateIssues(variableIds, ["variableDefinitions"], "世界变量 ID 必须唯一", context);
  addDuplicateIssues(ruleIds, ["rules"], "世界规则 ID 必须唯一", context);
  addDuplicateIssues(eventIds, ["eventTemplates"], "事件模板 ID 必须唯一", context);
  addDuplicateIssues(endingIds, ["endingDefinitions"], "结局 ID 必须唯一", context);
  addDuplicateIssues(gateIds, ["riskGates"], "教师门 ID 必须唯一", context);

  const variableSet = new Set(variableIds);
  const ruleSet = new Set(ruleIds);
  const eventSet = new Set(eventIds);
  const gateSet = new Set(gateIds);
  release.rules.forEach((rule, index) => {
    if (rule.affectedVariableIds.some((id) => !variableSet.has(id))) {
      context.addIssue({
        code: "custom",
        path: ["rules", index, "affectedVariableIds"],
        message: "世界规则只能影响本发布版已声明变量",
      });
    }
    if (rule.teacherGateId !== null && !gateSet.has(rule.teacherGateId)) {
      context.addIssue({
        code: "custom",
        path: ["rules", index, "teacherGateId"],
        message: "世界规则教师门引用必须存在",
      });
    }
  });
  release.eventTemplates.forEach((event, index) => {
    if (event.ruleRefs.some((id) => !ruleSet.has(id))) {
      context.addIssue({
        code: "custom",
        path: ["eventTemplates", index, "ruleRefs"],
        message: "事件模板规则引用必须存在",
      });
    }
    for (const objectRef of event.affectedObjectRefs) {
      const known = objectRef.objectType === "entity"
        ? entityIds.includes(objectRef.objectId)
        : objectRef.objectType === "world_variable"
          ? variableSet.has(objectRef.objectId)
          : true;
      if (!known) {
        context.addIssue({
          code: "custom",
          path: ["eventTemplates", index, "affectedObjectRefs"],
          message: "事件模板不得引用未发布的实体或变量",
        });
      }
    }
  });
  release.endingDefinitions.forEach((ending, index) => {
    if (ending.conditionRuleRefs.some((id) => !ruleSet.has(id))) {
      context.addIssue({
        code: "custom",
        path: ["endingDefinitions", index, "conditionRuleRefs"],
        message: "结局条件规则引用必须存在",
      });
    }
  });
  const levels = release.challengeVariants.map((variant) => variant.challengeLevel);
  addDuplicateIssues(
    release.challengeVariants.map((variant) => variant.worldVariantId),
    ["challengeVariants"],
    "世界挑战变体 ID 必须唯一",
    context,
  );
  if (levels.join(",") !== "3,4,5,6,7") {
    context.addIssue({
      code: "custom",
      path: ["challengeVariants"],
      message: "挑战变体必须按 3—7 级各声明一次",
    });
  }
  release.challengeVariants.forEach((variant, index) => {
    if (variant.eventTemplateRefs.some((id) => !eventSet.has(id))) {
      context.addIssue({
        code: "custom",
        path: ["challengeVariants", index, "eventTemplateRefs"],
        message: "挑战变体只能引用本发布版事件模板",
      });
    }
  });
  if (release.actionPolicy) {
    release.actionPolicy.actions.forEach((action, index) => {
      const event = release.eventTemplates.find((candidate) => (
        candidate.eventTemplateId === action.eventTemplateId
      ));
      if (!event) {
        context.addIssue({
          code: "custom",
          path: ["actionPolicy", "actions", index, "eventTemplateId"],
          message: "动作策略只能引用本发布版事件模板",
        });
      } else if (event.sourceKind !== "student_action") {
        context.addIssue({
          code: "custom",
          path: ["actionPolicy", "actions", index, "eventTemplateId"],
          message: "动作策略只能约束学生行动事件",
        });
      }
    });
  }
});
export type WorldSimulationRelease = z.infer<
  typeof WorldSimulationReleaseSchema
>;

const WorldSnapshotEntitySchema = z.object({
  entityId: V2IdentifierSchema,
  revision: z.number().int().nonnegative(),
  status: z.enum(["available", "busy", "withheld", "left", "closed"]),
  publicSummary: NonEmptyTextSchema.max(500),
  visibleScopes: z.array(SimulationVisibilityScopeSchema).min(1).max(5),
}).strict();

const WorldVariableSnapshotSchema = z.object({
  variableId: V2IdentifierSchema,
  before: z.number(),
  delta: z.number(),
  after: z.number(),
  causeRefs: z.array(V2IdentifierSchema).min(1).max(24),
  visibleScopes: z.array(SimulationVisibilityScopeSchema).min(1).max(5),
}).strict().superRefine((variable, context) => {
  if (Math.abs(variable.before + variable.delta - variable.after) > 0.000_001) {
    context.addIssue({
      code: "custom",
      path: ["after"],
      message: "世界变量 after 必须等于 before + delta",
    });
  }
});

const WorldFactSnapshotSchema = z.object({
  factId: V2IdentifierSchema,
  status: z.enum(["unknown", "rumor", "corroborated", "confirmed", "refuted"]),
  confidence: z.number().min(0).max(1),
  sourceRefs: z.array(V2IdentifierSchema).max(16),
  visibleScopes: z.array(SimulationVisibilityScopeSchema).min(1).max(5),
}).strict();

const WorldRelationshipSnapshotSchema = z.object({
  relationshipId: V2IdentifierSchema,
  sourceEntityId: V2IdentifierSchema,
  targetEntityId: V2IdentifierSchema,
  trust: z.number().min(0).max(100),
  tension: z.number().min(0).max(100),
  influence: z.number().min(0).max(100),
  commitmentRefs: z.array(V2IdentifierSchema).max(12),
  lastInteractionAt: TimestampSchema.nullable(),
}).strict();

const WorldResourceSnapshotSchema = z.object({
  resourceId: V2IdentifierSchema,
  resourceKind: z.enum([
    "time",
    "access",
    "permission",
    "source_material",
    "publication_slot",
  ]),
  amount: z.number().nonnegative(),
  unit: NonEmptyTextSchema.max(80),
  visibleScopes: z.array(SimulationVisibilityScopeSchema).min(1).max(5),
}).strict();

export const WorldSnapshotSchema = z.object({
  schemaVersion: z.literal(WorldSnapshotSchemaVersion),
  snapshotId: V2IdentifierSchema,
  sessionId: V2IdentifierSchema,
  simulationReleaseRef: SimulationReleaseReferenceSchema,
  stateVersion: z.number().int().nonnegative(),
  virtualTime: z.object({
    startedAt: TimestampSchema,
    currentAt: TimestampSchema,
    deadlineAt: TimestampSchema,
    elapsedMinutes: z.number().int().nonnegative(),
    remainingMinutes: z.number().int().nonnegative(),
    paused: z.boolean(),
  }).strict(),
  entities: z.array(WorldSnapshotEntitySchema).min(1).max(120),
  variables: z.array(WorldVariableSnapshotSchema).min(1).max(48),
  facts: z.array(WorldFactSnapshotSchema).max(240),
  relationships: z.array(WorldRelationshipSnapshotSchema).max(120),
  resources: z.array(WorldResourceSnapshotSchema).max(80),
  learningContext: z.object({
    learnerTwinRef: V2IdentifierSchema,
    challengeAssignmentRef: V2IdentifierSchema,
    challengeLevel: ChallengeLevelSchema,
    scoreCeiling: ChallengeScoreCeilingSchema,
    targetCompetencyRefs: z.array(V2IdentifierSchema).min(1).max(24),
    scaffoldingLevel: z.number().int().min(0).max(3),
  }).strict(),
  endingState: z.object({
    status: z.enum(["active", "recoverable_failure", "completed"]),
    endingRef: V2IdentifierSchema.nullable(),
  }).strict(),
  generatedAt: TimestampSchema,
}).strict().superRefine((snapshot, context) => {
  if (snapshot.virtualTime.currentAt < snapshot.virtualTime.startedAt
    || snapshot.virtualTime.currentAt > snapshot.virtualTime.deadlineAt) {
    context.addIssue({
      code: "custom",
      path: ["virtualTime", "currentAt"],
      message: "虚拟当前时间必须位于本局起止时间内",
    });
  }
  if (snapshot.learningContext.scoreCeiling
    !== challengeScoreCeiling(snapshot.learningContext.challengeLevel)) {
    context.addIssue({
      code: "custom",
      path: ["learningContext", "scoreCeiling"],
      message: "快照挑战等级与本局分数上限不一致",
    });
  }
  const entityIds = snapshot.entities.map((entity) => entity.entityId);
  const variableIds = snapshot.variables.map((variable) => variable.variableId);
  const factIds = snapshot.facts.map((fact) => fact.factId);
  const relationshipIds = snapshot.relationships.map(
    (relationship) => relationship.relationshipId,
  );
  const resourceIds = snapshot.resources.map((resource) => resource.resourceId);
  addDuplicateIssues(entityIds, ["entities"], "快照实体 ID 必须唯一", context);
  addDuplicateIssues(variableIds, ["variables"], "快照变量 ID 必须唯一", context);
  addDuplicateIssues(factIds, ["facts"], "快照事实 ID 必须唯一", context);
  addDuplicateIssues(
    relationshipIds,
    ["relationships"],
    "快照关系 ID 必须唯一",
    context,
  );
  addDuplicateIssues(resourceIds, ["resources"], "快照资源 ID 必须唯一", context);
  const entitySet = new Set(entityIds);
  snapshot.relationships.forEach((relationship, index) => {
    if (!entitySet.has(relationship.sourceEntityId)
      || !entitySet.has(relationship.targetEntityId)) {
      context.addIssue({
        code: "custom",
        path: ["relationships", index],
        message: "关系两端必须引用当前世界快照实体",
      });
    }
  });
  if (snapshot.endingState.status === "active"
    && snapshot.endingState.endingRef !== null) {
    context.addIssue({
      code: "custom",
      path: ["endingState", "endingRef"],
      message: "进行中的世界不得提前声明结局",
    });
  }
  if (snapshot.endingState.status !== "active"
    && snapshot.endingState.endingRef === null) {
    context.addIssue({
      code: "custom",
      path: ["endingState", "endingRef"],
      message: "结束或可恢复失败状态必须声明结局引用",
    });
  }
});
export type WorldSnapshot = z.infer<typeof WorldSnapshotSchema>;

export const AgentStateSchema = z.object({
  schemaVersion: z.literal(AgentStateSchemaVersion),
  agentStateId: V2IdentifierSchema,
  sessionId: V2IdentifierSchema,
  simulationReleaseRef: SimulationReleaseReferenceSchema,
  agentId: V2IdentifierSchema,
  agentTemplateId: V2IdentifierSchema,
  professionalRoleId: V2IdentifierSchema,
  stateVersion: z.number().int().nonnegative(),
  visibility: z.literal("server_private"),
  currentGoals: z.array(z.object({
    goalId: V2IdentifierSchema,
    description: NonEmptyTextSchema.max(500),
    priority: z.number().int().min(1).max(100),
    status: z.enum(["active", "blocked", "satisfied", "abandoned"]),
  }).strict()).min(1).max(16),
  beliefs: z.array(z.object({
    beliefId: V2IdentifierSchema,
    proposition: NonEmptyTextSchema.max(800),
    confidence: z.number().min(0).max(1),
    evidenceRefs: z.array(V2IdentifierSchema).max(16),
  }).strict()).max(48),
  privateMemory: z.array(z.object({
    memoryId: V2IdentifierSchema,
    memoryKind: z.enum(["episode", "commitment", "relationship", "plan"]),
    contentHash: V2ContentHashSchema,
    retention: z.enum(["turn", "session", "course"]),
  }).strict()).max(64),
  relationshipModel: z.array(z.object({
    entityRef: V2IdentifierSchema,
    trust: z.number().min(0).max(100),
    tension: z.number().min(0).max(100),
    privateNotesHash: V2ContentHashSchema,
  }).strict()).max(32),
  activePlan: z.array(z.object({
    stepId: V2IdentifierSchema,
    actionType: V2IdentifierSchema,
    targetRefs: z.array(SimulationObjectReferenceSchema).max(12),
    status: z.enum(["planned", "executing", "blocked", "done"]),
  }).strict()).max(24),
  disclosurePolicyRef: V2IdentifierSchema,
  toolCapabilityRefs: z.array(V2IdentifierSchema).max(24),
  remainingActionBudget: z.number().int().nonnegative(),
  lastObservedWorldStateVersion: z.number().int().nonnegative(),
  updatedAt: TimestampSchema,
}).strict().superRefine((state, context) => {
  addDuplicateIssues(
    state.currentGoals.map((goal) => goal.goalId),
    ["currentGoals"],
    "智能体目标 ID 必须唯一",
    context,
  );
  addDuplicateIssues(
    state.privateMemory.map((memory) => memory.memoryId),
    ["privateMemory"],
    "智能体私有记忆 ID 必须唯一",
    context,
  );
  if (state.lastObservedWorldStateVersion > state.stateVersion) {
    context.addIssue({
      code: "custom",
      path: ["lastObservedWorldStateVersion"],
      message: "智能体不得声称观察到未来世界状态",
    });
  }
});
export type AgentState = z.infer<typeof AgentStateSchema>;

export const AgentObservationSchema = z.object({
  schemaVersion: z.literal(AgentObservationSchemaVersion),
  observationId: V2IdentifierSchema,
  agentStateId: V2IdentifierSchema,
  agentId: V2IdentifierSchema,
  sessionId: V2IdentifierSchema,
  worldStateVersion: z.number().int().nonnegative(),
  sourceWorldEventIds: z.array(V2IdentifierSchema).min(1).max(24),
  authorizedScopes: z.array(z.enum([
    "public_world",
    "role_private",
    "assigned_task",
  ])).min(1).max(3),
  visibleObjects: z.array(SimulationObjectReferenceSchema).max(80),
  visibleFacts: z.array(z.object({
    factRef: V2IdentifierSchema,
    status: z.enum(["unknown", "rumor", "corroborated", "confirmed", "refuted"]),
    confidence: z.number().min(0).max(1),
  }).strict()).max(80),
  visibleRelationships: z.array(z.object({
    relationshipRef: V2IdentifierSchema,
    trustBand: z.enum(["low", "medium", "high"]),
    tensionBand: z.enum(["low", "medium", "high"]),
  }).strict()).max(40),
  taskInstruction: NonEmptyTextSchema.max(1_200),
  contextHash: V2ContentHashSchema,
  generatedAt: TimestampSchema,
}).strict();
export type AgentObservation = z.infer<typeof AgentObservationSchema>;

export const SimulationAgentIntentSchema = z.object({
  schemaVersion: z.literal(SimulationAgentIntentSchemaVersion),
  intentId: V2IdentifierSchema,
  agentStateId: V2IdentifierSchema,
  agentId: V2IdentifierSchema,
  professionalRoleId: V2IdentifierSchema,
  observationId: V2IdentifierSchema,
  agentTaskId: V2IdentifierSchema,
  agentRunId: V2IdentifierSchema,
  expectedWorldStateVersion: z.number().int().nonnegative(),
  intentType: V2IdentifierSchema,
  targetObjectRefs: z.array(SimulationObjectReferenceSchema).min(1).max(16),
  rationaleSummary: NonEmptyTextSchema.max(600),
  proposedAction: z.object({
    actionType: V2IdentifierSchema,
    payloadHash: V2ContentHashSchema,
    evidenceRefs: z.array(V2IdentifierSchema).max(24),
  }).strict(),
  confidence: z.number().min(0).max(1),
  riskLevel: z.enum(["low", "medium", "high"]),
  requiresTeacherGate: z.boolean(),
  authority: z.literal("proposal_only"),
  createdAt: TimestampSchema,
  expiresAt: TimestampSchema,
}).strict().superRefine((intent, context) => {
  if (intent.riskLevel === "high" && !intent.requiresTeacherGate) {
    context.addIssue({
      code: "custom",
      path: ["requiresTeacherGate"],
      message: "高风险智能体意图必须进入教师门",
    });
  }
  if (intent.expiresAt <= intent.createdAt) {
    context.addIssue({
      code: "custom",
      path: ["expiresAt"],
      message: "智能体意图有效期必须晚于创建时间",
    });
  }
});
export type SimulationAgentIntent = z.infer<
  typeof SimulationAgentIntentSchema
>;

const ResolvedIntentReferenceSchema = z.object({
  intentId: V2IdentifierSchema,
  agentTaskId: V2IdentifierSchema,
  agentRunId: V2IdentifierSchema,
  outputHash: V2ContentHashSchema,
}).strict();

const ResolutionVariableDeltaSchema = z.object({
  variableId: V2IdentifierSchema,
  before: z.number(),
  delta: z.number(),
  after: z.number(),
}).strict().superRefine((variable, context) => {
  if (Math.abs(variable.before + variable.delta - variable.after) > 0.000_001) {
    context.addIssue({
      code: "custom",
      path: ["after"],
      message: "解析变量 after 必须等于 before + delta",
    });
  }
});

export const SimulationResolutionSchema = z.object({
  schemaVersion: z.literal(SimulationResolutionSchemaVersion),
  resolutionId: V2IdentifierSchema,
  sessionId: V2IdentifierSchema,
  sourceWorldEventId: V2IdentifierSchema,
  dispatchPlanId: V2IdentifierSchema,
  resolutionProposalId: V2IdentifierSchema,
  expectedWorldStateVersion: z.number().int().nonnegative(),
  status: z.enum(["pending_teacher_gate", "committed", "rejected", "failed"]),
  acceptedIntents: z.array(ResolvedIntentReferenceSchema).max(14),
  skippedIntents: z.array(z.object({
    intentId: V2IdentifierSchema,
    reasonCode: z.enum([
      "not_necessary",
      "insufficient_evidence",
      "authority_denied",
      "budget_exhausted",
      "stale_state",
      "lower_ranked",
    ]),
  }).strict()).max(14),
  variableDeltas: z.array(ResolutionVariableDeltaSchema).max(48),
  emittedWorldEventIds: z.array(V2IdentifierSchema).max(24),
  emittedEvidenceIds: z.array(V2IdentifierSchema).max(48),
  teacherGate: z.object({
    gateId: V2IdentifierSchema,
    status: z.enum(["pending", "approved", "revised", "rejected"]),
    teacherDecisionRef: V2IdentifierSchema.nullable(),
  }).strict().nullable(),
  failure: z.object({
    code: z.enum([
      "state_version_drift",
      "invalid_reference",
      "policy_denied",
      "agent_failure",
      "resolution_conflict",
    ]),
    safeMessage: NonEmptyTextSchema.max(500),
  }).strict().nullable(),
  committedAt: TimestampSchema.nullable(),
  resolvedAt: TimestampSchema,
}).strict().superRefine((resolution, context) => {
  const acceptedIds = resolution.acceptedIntents.map((intent) => intent.intentId);
  const skippedIds = resolution.skippedIntents.map((intent) => intent.intentId);
  addDuplicateIssues(
    [...acceptedIds, ...skippedIds],
    ["acceptedIntents"],
    "同一智能体意图只能被接受或跳过一次",
    context,
  );
  if (resolution.status === "committed") {
    if (resolution.acceptedIntents.length === 0
      || resolution.emittedWorldEventIds.length === 0
      || resolution.committedAt === null
      || resolution.failure !== null) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "正式解析必须有真实运行、后果事件、提交时间且无失败",
      });
    }
    if (resolution.teacherGate !== null
      && !["approved", "revised"].includes(resolution.teacherGate.status)) {
      context.addIssue({
        code: "custom",
        path: ["teacherGate", "status"],
        message: "存在教师门时，只有批准或修订后的解析才能提交",
      });
    }
  }
  if (resolution.status === "pending_teacher_gate") {
    if (resolution.teacherGate?.status !== "pending"
      || resolution.teacherGate.teacherDecisionRef !== null
      || resolution.emittedWorldEventIds.length > 0
      || resolution.emittedEvidenceIds.length > 0
      || resolution.variableDeltas.length > 0
      || resolution.committedAt !== null
      || resolution.failure !== null) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "等待教师门时必须保持零权威写入",
      });
    }
  }
  if (resolution.status === "rejected") {
    if (resolution.emittedWorldEventIds.length > 0
      || resolution.emittedEvidenceIds.length > 0
      || resolution.variableDeltas.length > 0
      || resolution.committedAt !== null
      || resolution.failure !== null) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "被拒解析必须保持零权威写入且不伪装为失败",
      });
    }
  }
  if (resolution.status === "failed") {
    if (resolution.failure === null
      || resolution.emittedWorldEventIds.length > 0
      || resolution.emittedEvidenceIds.length > 0
      || resolution.variableDeltas.length > 0
      || resolution.committedAt !== null) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "失败解析必须显式说明原因并保持零权威写入",
      });
    }
  }
});
export type SimulationResolution = z.infer<typeof SimulationResolutionSchema>;

const StudentActionPayloadSchema = z.discriminatedUnion("verb", [
  z.object({
    verb: z.literal("observe"),
    targetRef: SimulationObjectReferenceSchema,
    observationFocus: NonEmptyTextSchema.max(500),
  }).strict(),
  z.object({
    verb: z.enum(["ask", "probe", "negotiate"]),
    targetRef: SimulationObjectReferenceSchema,
    utterance: NonEmptyTextSchema.max(8_000),
  }).strict(),
  z.object({
    verb: z.enum(["inspect", "compare"]),
    targetRefs: z.array(SimulationObjectReferenceSchema).min(1).max(8),
    evidenceQuestion: NonEmptyTextSchema.max(1_000),
  }).strict(),
  z.object({
    verb: z.literal("draft"),
    artifactId: V2IdentifierSchema,
    revisionId: V2IdentifierSchema,
    parentRevisionId: V2IdentifierSchema.nullable(),
    contentHash: V2ContentHashSchema,
  }).strict(),
  z.object({
    verb: z.literal("wait"),
    durationMinutes: z.number().int().min(1).max(20),
    reason: NonEmptyTextSchema.max(500),
  }).strict(),
  z.object({
    verb: z.literal("escalate"),
    gateRef: V2IdentifierSchema,
    reason: NonEmptyTextSchema.max(1_000),
    evidenceRefs: z.array(V2IdentifierSchema).min(1).max(24),
  }).strict(),
  z.object({
    verb: z.literal("submit"),
    artifactId: V2IdentifierSchema,
    revisionId: V2IdentifierSchema,
    contentHash: V2ContentHashSchema,
    evidenceRefs: z.array(V2IdentifierSchema).min(1).max(48),
  }).strict(),
]);

export const StudentWorkActionSchema = z.object({
  schemaVersion: z.literal(StudentWorkActionSchemaVersion),
  workActionId: V2IdentifierSchema,
  serverIssuedActionRef: V2IdentifierSchema,
  sessionId: V2IdentifierSchema,
  bindingId: V2IdentifierSchema,
  actorId: V2IdentifierSchema,
  primaryRoleId: z.literal("reporter"),
  // Server-verified interaction context; the executable target remains in action.
  interactionTargetRef: V2IdentifierSchema.optional(),
  expectedWorldStateVersion: z.number().int().nonnegative(),
  action: StudentActionPayloadSchema,
  sourceWorldEventIds: z.array(V2IdentifierSchema).max(24),
  reflectionNote: z.string().trim().max(8_000).nullable(),
  submissionStatus: z.enum(["draft", "submitted", "accepted", "rejected"]),
  createdAt: TimestampSchema,
}).strict().superRefine((action, context) => {
  if (action.action.verb === "submit" && action.submissionStatus === "draft") {
    context.addIssue({
      code: "custom",
      path: ["submissionStatus"],
      message: "最终提交动作不得仍标记为草稿",
    });
  }
  if (action.action.verb === "draft" && action.submissionStatus !== "draft") {
    context.addIssue({
      code: "custom",
      path: ["submissionStatus"],
      message: "稿件草拟动作只能保存为草稿状态",
    });
  }
});
export type StudentWorkAction = z.infer<typeof StudentWorkActionSchema>;
