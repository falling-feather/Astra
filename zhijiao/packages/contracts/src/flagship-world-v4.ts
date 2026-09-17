import { z } from "zod";
import {
  CourseReleaseReferenceSchema,
  ScenarioReleaseReferenceSchema,
  V2ContentHashSchema,
  V2IdentifierSchema,
} from "./course-learning.js";
import { SimulationReleaseReferenceSchema } from "./world-simulation-v3.js";

export const SemanticActionRequestV4SchemaVersion =
  "semantic-action-request/4.0.0" as const;
export const SemanticActionDecisionV4SchemaVersion =
  "semantic-action-decision/4.0.0" as const;
export const AutonomousWorldDecisionV4SchemaVersion =
  "autonomous-world-decision/4.0.0" as const;
export const FlagshipContentReferenceV4SchemaVersion =
  "flagship-content-reference/4.0.0" as const;

const TimestampSchema = z.string().datetime();
const NonEmptyTextSchema = z.string().trim().min(1);
const OpaqueSelectionTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{24,192}$/u);

export const FlagshipContentReferenceV4Schema = z.object({
  schemaVersion: z.literal(FlagshipContentReferenceV4SchemaVersion),
  contentSchemaVersion: z.string().regex(/^[a-z0-9-]+\/4\.0\.0$/u),
  courseReleaseRef: CourseReleaseReferenceSchema,
  scenarioReleaseRef: ScenarioReleaseReferenceSchema,
  simulationReleaseRef: SimulationReleaseReferenceSchema,
  contentHash: V2ContentHashSchema,
}).strict();
export type FlagshipContentReferenceV4 = z.infer<
  typeof FlagshipContentReferenceV4Schema
>;

export const SemanticActionVerbV4Schema = z.enum([
  "observe",
  "ask",
  "probe",
  "inspect",
  "compare",
  "negotiate",
  "draft",
  "wait",
  "escalate",
  "submit",
]);
export type SemanticActionVerbV4 = z.infer<
  typeof SemanticActionVerbV4Schema
>;

const ClientSelectionSchema = z.object({
  selectionToken: OpaqueSelectionTokenSchema,
  displayKind: z.enum(["world_object", "npc", "material", "artifact"]),
}).strict();

export const SemanticActionRequestV4Schema = z.object({
  schemaVersion: z.literal(SemanticActionRequestV4SchemaVersion),
  requestId: V2IdentifierSchema,
  sessionId: V2IdentifierSchema,
  bindingId: V2IdentifierSchema,
  actionWindowRef: V2IdentifierSchema,
  actionWindowHash: V2ContentHashSchema,
  expectedWorldStateVersion: z.number().int().nonnegative(),
  utterance: NonEmptyTextSchema.min(2).max(2_000),
  selections: z.array(ClientSelectionSchema).max(12),
  submittedAt: TimestampSchema,
}).strict().superRefine((request, context) => {
  const tokens = request.selections.map((selection) => selection.selectionToken);
  if (new Set(tokens).size !== tokens.length) {
    context.addIssue({
      code: "custom",
      path: ["selections"],
      message: "客户端只能提交互不重复的服务端签发选择令牌",
    });
  }
});
export type SemanticActionRequestV4 = z.infer<
  typeof SemanticActionRequestV4Schema
>;

const ResolvedObjectReferenceSchema = z.object({
  objectType: z.enum(["entity", "location", "material", "artifact", "source"]),
  objectId: V2IdentifierSchema,
  sourceSelectionTokenHash: V2ContentHashSchema,
}).strict();

const AcceptedActionSchema = z.object({
  actionId: V2IdentifierSchema,
  verb: SemanticActionVerbV4Schema,
  targetRefs: z.array(ResolvedObjectReferenceSchema).min(1).max(8),
  materialRefs: z.array(ResolvedObjectReferenceSchema).max(8),
  intentSummary: NonEmptyTextSchema.max(800),
  professionalCriteriaRefs: z.array(V2IdentifierSchema).min(1).max(16),
  riskRefs: z.array(V2IdentifierSchema).max(12),
  requiresTeacherGate: z.boolean(),
  authorizationCheck: z.literal("service_verified"),
  authority: z.literal("proposal_only"),
}).strict().superRefine((action, context) => {
  const allRefs = [...action.targetRefs, ...action.materialRefs];
  const keys = allRefs.map((reference) => (
    `${reference.objectType}:${reference.objectId}`
  ));
  if (new Set(keys).size !== keys.length) {
    context.addIssue({
      code: "custom",
      path: ["targetRefs"],
      message: "语义行动对象与材料引用不得重复或跨字段伪装",
    });
  }
});

const ClarificationSchema = z.object({
  prompt: NonEmptyTextSchema.max(500),
  ambiguityCode: z.enum([
    "missing_target",
    "multiple_targets",
    "missing_material",
    "unclear_intent",
    "state_dependent_choice",
  ]),
  choices: z.array(z.object({
    choiceToken: OpaqueSelectionTokenSchema,
    label: NonEmptyTextSchema.max(160),
    consequenceHint: NonEmptyTextSchema.max(320),
  }).strict()).min(2).max(6),
  expiresAt: TimestampSchema,
}).strict().superRefine((clarification, context) => {
  const tokens = clarification.choices.map((choice) => choice.choiceToken);
  if (new Set(tokens).size !== tokens.length) {
    context.addIssue({
      code: "custom",
      path: ["choices"],
      message: "澄清选项令牌必须唯一",
    });
  }
});

const RefusalSchema = z.object({
  reasonCode: z.enum([
    "unsafe_or_illegal",
    "forged_authority",
    "privacy_boundary",
    "outside_role_scope",
    "stale_action_window",
    "unauthorized_reference",
    "unsupported_operation",
  ]),
  safeMessage: NonEmptyTextSchema.max(500),
  recoveryHint: NonEmptyTextSchema.max(500).nullable(),
}).strict();

const SemanticActionDecisionSharedShape = {
  schemaVersion: z.literal(SemanticActionDecisionV4SchemaVersion),
  decisionId: V2IdentifierSchema,
  requestId: V2IdentifierSchema,
  sessionId: V2IdentifierSchema,
  bindingId: V2IdentifierSchema,
  flagshipContentRef: FlagshipContentReferenceV4Schema,
  sourceWorldStateVersion: z.number().int().nonnegative(),
  requestPayloadHash: V2ContentHashSchema,
  parserMode: z.enum(["live_model", "deterministic_fallback"]),
  confidence: z.number().min(0).max(1),
  decidedAt: TimestampSchema,
};

const AcceptedSemanticActionDecisionV4Schema = z.object({
  ...SemanticActionDecisionSharedShape,
  status: z.literal("accepted"),
  canonicalAction: AcceptedActionSchema,
  clarification: z.null(),
  refusal: z.null(),
  writeDisposition: z.literal("candidate_only"),
}).strict();

const ClarificationSemanticActionDecisionV4Schema = z.object({
  ...SemanticActionDecisionSharedShape,
  status: z.literal("clarification_required"),
  canonicalAction: z.null(),
  clarification: ClarificationSchema,
  refusal: z.null(),
  writeDisposition: z.literal("zero_write"),
}).strict();

const RefusedSemanticActionDecisionV4Schema = z.object({
  ...SemanticActionDecisionSharedShape,
  status: z.literal("refused"),
  canonicalAction: z.null(),
  clarification: z.null(),
  refusal: RefusalSchema,
  writeDisposition: z.literal("zero_write"),
}).strict();

export const SemanticActionDecisionV4Schema = z.discriminatedUnion("status", [
  AcceptedSemanticActionDecisionV4Schema,
  ClarificationSemanticActionDecisionV4Schema,
  RefusedSemanticActionDecisionV4Schema,
]);
export type SemanticActionDecisionV4 = z.infer<
  typeof SemanticActionDecisionV4Schema
>;

const WorldAutonomyTriggerSchema = z.object({
  triggerKind: z.enum([
    "virtual_clock",
    "state_threshold",
    "npc_plan",
    "teacher_event",
  ]),
  triggerRef: V2IdentifierSchema,
  observedStateHash: V2ContentHashSchema,
}).strict();

const CandidateAutonomousEventSchema = z.object({
  candidateEventId: V2IdentifierSchema,
  eventTemplateRef: V2IdentifierSchema,
  actorEntityRef: V2IdentifierSchema,
  affectedObjectRefs: z.array(V2IdentifierSchema).min(1).max(24),
  publicCue: NonEmptyTextSchema.max(600),
  earliestVirtualMinute: z.number().int().nonnegative().max(60),
  expiresVirtualMinute: z.number().int().positive().max(60),
  authority: z.literal("proposal_only"),
}).strict().superRefine((event, context) => {
  if (event.expiresVirtualMinute <= event.earliestVirtualMinute) {
    context.addIssue({
      code: "custom",
      path: ["expiresVirtualMinute"],
      message: "自主事件截止时间必须晚于最早发生时间",
    });
  }
  if (new Set(event.affectedObjectRefs).size !== event.affectedObjectRefs.length) {
    context.addIssue({
      code: "custom",
      path: ["affectedObjectRefs"],
      message: "自主事件受影响对象引用必须唯一",
    });
  }
});

const AutonomousWorldDecisionSharedShape = {
  schemaVersion: z.literal(AutonomousWorldDecisionV4SchemaVersion),
  autonomyDecisionId: V2IdentifierSchema,
  sessionId: V2IdentifierSchema,
  flagshipContentRef: FlagshipContentReferenceV4Schema,
  sourceWorldStateVersion: z.number().int().nonnegative(),
  virtualMinute: z.number().int().nonnegative().max(60),
  trigger: WorldAutonomyTriggerSchema,
  evaluatedPlanRefs: z.array(V2IdentifierSchema).min(1).max(32),
  evaluatedAt: TimestampSchema,
};

const ScheduledAutonomousWorldDecisionV4Schema = z.object({
  ...AutonomousWorldDecisionSharedShape,
  status: z.literal("scheduled"),
  selectedPlanRef: V2IdentifierSchema,
  candidateEvent: CandidateAutonomousEventSchema,
  suppression: z.null(),
  failure: z.null(),
  writeDisposition: z.literal("candidate_only"),
}).strict().superRefine((decision, context) => {
  if (!decision.evaluatedPlanRefs.includes(decision.selectedPlanRef)) {
    context.addIssue({
      code: "custom",
      path: ["selectedPlanRef"],
      message: "自主世界只能选择本次实际评估的 NPC 计划",
    });
  }
  if (decision.candidateEvent.earliestVirtualMinute < decision.virtualMinute) {
    context.addIssue({
      code: "custom",
      path: ["candidateEvent", "earliestVirtualMinute"],
      message: "自主事件不得安排到已经过去的虚拟时间",
    });
  }
});

const SuppressedAutonomousWorldDecisionV4Schema = z.object({
  ...AutonomousWorldDecisionSharedShape,
  status: z.literal("suppressed"),
  selectedPlanRef: z.null(),
  candidateEvent: z.null(),
  suppression: z.object({
    reasonCode: z.enum([
      "cooldown_not_elapsed",
      "preconditions_not_met",
      "conflict_budget_exhausted",
      "higher_priority_plan_selected",
      "session_paused",
      "no_public_window",
      "npc_decision_deferred",
      "npc_decision_no_action",
    ]),
    safeReason: NonEmptyTextSchema.max(500),
  }).strict(),
  failure: z.null(),
  writeDisposition: z.literal("zero_write"),
}).strict();

const FailedAutonomousWorldDecisionV4Schema = z.object({
  ...AutonomousWorldDecisionSharedShape,
  status: z.literal("failed"),
  selectedPlanRef: z.null(),
  candidateEvent: z.null(),
  suppression: z.null(),
  failure: z.object({
    reasonCode: z.enum([
      "version_hash_drift",
      "invalid_plan",
      "unauthorized_scope",
      "resolution_unavailable",
    ]),
    safeMessage: NonEmptyTextSchema.max(500),
  }).strict(),
  writeDisposition: z.literal("zero_write"),
}).strict();

export const AutonomousWorldDecisionV4Schema = z.discriminatedUnion("status", [
  ScheduledAutonomousWorldDecisionV4Schema,
  SuppressedAutonomousWorldDecisionV4Schema,
  FailedAutonomousWorldDecisionV4Schema,
]);
export type AutonomousWorldDecisionV4 = z.infer<
  typeof AutonomousWorldDecisionV4Schema
>;
