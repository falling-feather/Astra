import { z } from "zod";
import { ScenarioCollaborationConfigSchema } from "./scenario-authoring.js";
import { ModelInvocationImageInputSchema } from "./multimodal-quality-observation-v4.js";

export * from "./collaboration-replay.js";
export * from "./strategy-reuse.js";
export * from "./scenario-authoring.js";
export * from "./course-learning.js";
export * from "./student-notebook-v1.js";
export * from "./work-supplement-v3.js";
export * from "./field-work-plan-v3.js";
export * from "./character-studio-v3.js";
export * from "./teacher-archive-v3.js";
export * from "./course-archive-v3.js";
export * from "./student-study-v3.js";
export * from "./course-outcomes.js";
export * from "./agent-collaboration-episode.js";
export * from "./agent-ablation.js";
export * from "./student-training-context.js";
export * from "./world-simulation-v3.js";
export * from "./learning-adaptation-v3.js";
export * from "./agent-collaboration-episode-v3.js";
export * from "./decision-provenance.js";
export * from "./v3-simulation-contract-bundle.js";
export * from "./flagship-world-v4.js";
export * from "./flagship-runtime-definition-v4.js";
export * from "./grounded-collaboration-v4.js";
export * from "./grounded-retrieval-v4.js";
export * from "./media-assessment-adaptation-v4.js";
export * from "./learner-adaptation-v4.js";
export * from "./learner-calibration-v4.js";
export * from "./flagship-assessment-view-v4.js";
export * from "./v4-flagship-contract-bundle.js";
export * from "./session-experience-descriptor.js";
export * from "./business-operation-receipt.js";
export * from "./teaching-task-v1.js";
export * from "./dialogue-episode-v4.js";
export * from "./field-exploration-v4.js";
export * from "./field-interview-v1.js";
export * from "./multimodal-quality-observation-v4.js";

export { ProductVersion } from "./version.js";
export * from "./collaboration-strategy.js";
export const SchemaVersion = "0.1.0" as const;
export const AccessPolicyVersion = "acl/1.0.0" as const;
export const ContextSchemaVersion = "context/1.0.0" as const;
export const ContextAssemblerVersion = "assembler/1.0.0" as const;
export const ContextBudgetPolicyVersion = "budget/1.0.0" as const;
export const RoleMemorySchemaVersion = "role-memory/1.0.0" as const;
export const RoleMemoryIntegritySchemaVersion =
  "role-memory-integrity/1.0.0" as const;
export const RoleInteractionSchemaVersion = "role-interaction/1.0.0" as const;
export const ScenarioPackageSchemaVersion = "scenario-package/1.0.0" as const;
export const ScenarioExperienceSchemaVersion =
  "scenario-experience/1.0.0" as const;
export const StructuredWorldStageSchemaVersion =
  "structured-world-stage/1.0.0" as const;
export const ScenarioCompilerVersion = "scenario-compiler/1.0.0" as const;
export const EvaluationSchemaVersion = "evaluation/1.0.0" as const;
export const LearningGovernanceSchemaVersion = "learning-governance/1.0.0" as const;
export const ActionEnvelopeSchemaVersion = "action-envelope/1.0.0" as const;
export const AgentScaleSchemaVersion = "agent-scale/1.0.0" as const;
export const AgentAssistanceSchemaVersion = "agent-assistance/1.0.0" as const;
export const AgentTemplateCatalogSchemaVersion =
  "agent-template-catalog/1.0.0" as const;

export const ActorKindSchema = z.enum(["teacher", "student", "agent", "system"]);
export type ActorKind = z.infer<typeof ActorKindSchema>;

export const RoleIdSchema = z.enum([
  "teacher",
  "responsible_editor",
  "reporter",
  "fact_checker",
  "platform_operator",
  "editor_in_chief",
  "interviewee",
  "copyright_owner",
  "scene_director",
  "teaching_director",
  "assessor",
  "learning_curator",
  "student_assistant",
  "content_assistant",
  "teacher_assistant",
  "system",
]);
export type RoleId = z.infer<typeof RoleIdSchema>;

export const VisibilityScopeSchema = z.enum([
  "public_world",
  "assigned_team",
  "role_private",
  "teacher_only",
  "audit_only",
]);
export type VisibilityScope = z.infer<typeof VisibilityScopeSchema>;

export const AccessPurposeSchema = z.enum(["runtime", "api_rag", "audit", "replay"]);
export type AccessPurpose = z.infer<typeof AccessPurposeSchema>;

export const AccessSubjectSchema = z.object({
  sessionId: z.string().min(1),
  sessionEpoch: z.string().min(1),
  courseId: z.string().min(1),
  actorId: z.string().min(1),
  actorKind: ActorKindSchema,
  roleId: RoleIdSchema,
  teamId: z.string().min(1),
  visibleScopes: z.array(VisibilityScopeSchema),
  privateNamespaces: z.array(z.string().min(1)),
  capabilities: z.array(z.string().min(1)),
  purpose: AccessPurposeSchema,
}).strict();
export type AccessSubject = z.infer<typeof AccessSubjectSchema>;

export const ResourceAudienceSchema = z.object({
  policyVersion: z.literal(AccessPolicyVersion),
  courseId: z.string().min(1).nullable(),
  sessionId: z.string().min(1).nullable(),
  sessionEpoch: z.string().min(1).nullable(),
  scopes: z.array(VisibilityScopeSchema).min(1),
  teamIds: z.array(z.string().min(1)),
  roleIds: z.array(RoleIdSchema),
  actorIds: z.array(z.string().min(1)),
  privateNamespaces: z.array(z.string().min(1)),
  auditReadable: z.boolean(),
}).strict();
export type ResourceAudience = z.infer<typeof ResourceAudienceSchema>;

export const CommandNameSchema = z.enum([
  "inspect_material",
  "request_second_verification",
  "request_media_processing",
  "request_governance_review",
  "retry_media_processing",
  "supply_media_processing_result",
  "create_production_artifact",
  "save_artifact_revision",
  "mark_copyright_risk",
  "pause_publication",
  "submit_for_review",
  "record_experience_choice",
  "record_agent_contribution_decision",
  "send_role_interaction",
  "approve_candidate_event",
  "reject_candidate_event",
  "review_governance",
  "review_assessment",
  "retry_evaluation_branch",
  "create_learning_candidate",
  "retry_learning_candidate_generation",
  "review_learning_candidate",
  "publish_learning_release",
  "rollback_learning_release",
]);
export type CommandName = z.infer<typeof CommandNameSchema>;

export const EventTypeSchema = z.enum([
  "session_started",
  "role_assigned",
  "node_activated",
  "material_registered",
  "material_observed",
  "media_processing_requested",
  "media_processing_started",
  "media_processing_step_completed",
  "media_processing_step_failed",
  "media_processing_completed",
  "media_processing_retry_requested",
  "media_processing_manual_supplied",
  "governance_review_requested",
  "governance_review_reopened",
  "governance_review_arbitrated",
  "governance_reviewed",
  "production_artifact_created",
  "artifact_revision_saved",
  "world_fact_confirmed",
  "world_fact_updated",
  "agent_task_failed",
  "agent_run_recorded",
  "agent_intent_recorded",
  "role_response_intent_recorded",
  "agent_assistance_recorded",
  "agent_contribution_decided",
  "agent_message_posted",
  "role_message_posted",
  "experience_choice_recorded",
  "experience_consequence_applied",
  "role_interaction_requested",
  "role_interaction_responded",
  "candidate_event_proposed",
  "candidate_event_approved",
  "candidate_event_rejected",
  "director_recovery_requested",
  "teaching_directive_recorded",
  "scene_director_decision_recorded",
  "scenario_intervention_applied",
  "verification_requested",
  "evidence_recorded",
  "copyright_risk_flagged",
  "publication_paused",
  "submission_created",
  "evaluation_case_opened",
  "evaluation_branch_retry_requested",
  "evaluation_proposal_recorded",
  "evaluation_arbitrated",
  "assessment_created",
  "teacher_reviewed",
  "learning_candidate_generation_retry_requested",
  "learning_candidate_created",
  "learning_candidate_replay_completed",
  "learning_candidate_reviewed",
  "learning_release_published",
  "learning_release_rolled_back",
  "learning_candidate_generation_failed",
  "scene_completed",
]);
export type EventType = z.infer<typeof EventTypeSchema>;

export const MessageMetaSchema = z.object({
  sessionId: z.string().min(1),
  sceneId: z.string().min(1),
  actorId: z.string().min(1),
  messageId: z.string().min(1),
  correlationId: z.string().min(1),
  timestamp: z.string().datetime(),
  schemaVersion: z.literal(SchemaVersion),
});
export type MessageMeta = z.infer<typeof MessageMetaSchema>;

export const CommandSchema = MessageMetaSchema.extend({
  kind: z.literal("Command"),
  name: CommandNameSchema,
  expectedStateVersion: z.number().int().nonnegative(),
  payload: z.record(z.string(), z.unknown()),
});
export type Command = z.infer<typeof CommandSchema>;

export const ActionSourceModeSchema = z.enum([
  "course_platform",
  "world_interaction",
  "service_api",
  "agent_runtime",
  "system_replay",
]);
export type ActionSourceMode = z.infer<typeof ActionSourceModeSchema>;

export const VersionedObjectRefSchema = z.object({
  objectType: z.string().min(1).max(80),
  objectId: z.string().min(1).max(240),
  version: z.string().min(1).max(120),
}).strict();
export type VersionedObjectRef = z.infer<typeof VersionedObjectRefSchema>;

export const ActionSourceSchema = z.object({
  mode: ActionSourceModeSchema,
  assertion: z.enum(["client_declared", "service_verified"]),
  surfaceId: z.string().min(1).max(120),
  interactionId: z.string().min(1).max(240).nullable().default(null),
}).strict();
export type ActionSource = z.infer<typeof ActionSourceSchema>;

export const ActionCausalitySchema = z.object({
  rootActionId: z.string().min(1).max(240),
  causationId: z.string().min(1).max(240),
  parentActionId: z.string().min(1).nullable().default(null),
  causationEventIds: z.array(z.string().min(1)).max(64).default([]),
  causalDepth: z.number().int().nonnegative().max(64).default(0),
}).strict();
export type ActionCausality = z.infer<typeof ActionCausalitySchema>;

export const ActionActorContextSchema = z.object({
  principalId: z.string().min(1).max(240),
  bindingId: z.string().min(1).max(240),
  actorId: z.string().min(1).max(240),
  actorKind: ActorKindSchema,
  roleId: RoleIdSchema,
  teamId: z.string().min(1).max(240),
  sessionEpoch: z.string().min(1).max(240),
}).strict();
export type ActionActorContext = z.infer<typeof ActionActorContextSchema>;

export const ActionEvidenceSemanticsSchema = z.object({
  evidenceRefs: z.array(z.string().min(1)).max(128).default([]),
  citationRefs: z.array(z.string().min(1)).max(128).default([]),
  toolResultRefs: z.array(z.string().min(1)).max(128).default([]),
}).strict();
export type ActionEvidenceSemantics = z.infer<
  typeof ActionEvidenceSemanticsSchema
>;

export const ActionEnvelopeSchema = z.object({
  kind: z.literal("ActionEnvelope"),
  envelopeVersion: z.literal(ActionEnvelopeSchemaVersion),
  actionId: z.string().min(1).max(240),
  idempotencyKey: z.string().min(1).max(320),
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/u),
  source: ActionSourceSchema,
  actor: ActionActorContextSchema,
  objectRefs: z.array(VersionedObjectRefSchema).min(1).max(64),
  causality: ActionCausalitySchema,
  evidence: ActionEvidenceSemanticsSchema,
  command: CommandSchema,
}).strict().superRefine((envelope, context) => {
  const worldStateRefs = envelope.objectRefs.filter(
    (reference) => reference.objectType === "world_state",
  );
  if (worldStateRefs.length !== 1) {
    context.addIssue({
      code: "custom",
      path: ["objectRefs"],
      message: "ActionEnvelope 必须精确包含一个 world_state 对象版本引用",
    });
    return;
  }
  const worldStateRef = worldStateRefs[0]!;
  if (worldStateRef.objectId !== envelope.command.sessionId) {
    context.addIssue({
      code: "custom",
      path: ["objectRefs"],
      message: "world_state 对象必须引用命令所属会话",
    });
  }
  if (worldStateRef.version !== String(envelope.command.expectedStateVersion)) {
    context.addIssue({
      code: "custom",
      path: ["objectRefs"],
      message: "world_state 对象版本必须与命令期望版本一致",
    });
  }
  if (envelope.actor.actorId !== envelope.command.actorId) {
    context.addIssue({
      code: "custom",
      path: ["actor", "actorId"],
      message: "行动主体必须与命令行动者一致",
    });
  }
  if (
    envelope.causality.causalDepth === 0
    && envelope.causality.rootActionId !== envelope.actionId
  ) {
    context.addIssue({
      code: "custom",
      path: ["causality", "rootActionId"],
      message: "根行动的 rootActionId 必须等于 actionId",
    });
  }
});
export type ActionEnvelope = z.infer<typeof ActionEnvelopeSchema>;

/*
 * 只把可公开审计的引用写入世界事件。命令载荷、实验标签和私有上下文
 * 不属于事件信封，避免统一行动协议意外扩大投影视野。
 */
export const ActionAuditContextSchema = z.object({
  schemaVersion: z.literal(ActionEnvelopeSchemaVersion),
  actionId: z.string().min(1).max(240),
  rootActionId: z.string().min(1).max(240),
  causationId: z.string().min(1).max(240),
  commandName: CommandNameSchema,
  sourceMode: ActionSourceModeSchema,
  sourceAssertion: z.enum(["client_declared", "service_verified"]),
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/u),
  idempotencyHash: z.string().regex(/^[a-f0-9]{64}$/u),
  actorBindingHash: z.string().regex(/^[a-f0-9]{64}$/u),
  causalDepth: z.number().int().nonnegative().max(64),
  objectRefCount: z.number().int().positive().max(64),
  evidenceRefCount: z.number().int().nonnegative().max(384),
}).strict();
export type ActionAuditContext = z.infer<typeof ActionAuditContextSchema>;

export const ObservationSchema = MessageMetaSchema.extend({
  kind: z.literal("Observation"),
  observationId: z.string().min(1),
  materialId: z.string().min(1),
  mediaType: z.enum(["text", "audio", "image", "document", "video"]),
  provider: z.string().min(1),
  providerMode: z.enum(["mock", "live"]),
  summary: z.string().min(1),
  extracted: z.record(z.string(), z.unknown()),
  sourceRef: z.string().min(1),
  confidence: z.number().min(0).max(1),
});
export type Observation = z.infer<typeof ObservationSchema>;

export const AgentIntentSchema = MessageMetaSchema.extend({
  kind: z.literal("AgentIntent"),
  intentId: z.string().min(1),
  roleId: RoleIdSchema,
  intentType: z.string().min(1),
  rationaleSummary: z.string().min(1),
  proposedPayload: z.record(z.string(), z.unknown()),
});
export type AgentIntent = z.infer<typeof AgentIntentSchema>;

export const ExecutableAgentIntentSchema = AgentIntentSchema.extend({
  agentRunId: z.string().min(1),
  expectedStateVersion: z.number().int().nonnegative(),
  causationEventIds: z.array(z.string()),
  evidenceRefs: z.array(z.string()),
  citationRefs: z.array(z.string()),
  toolResultRefs: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  riskLevel: z.enum(["low", "medium", "high"]),
  requiresTeacherReview: z.boolean(),
  visibility: z.array(VisibilityScopeSchema).min(1),
  visibleToActorIds: z.array(z.string()),
  idempotencyKey: z.string().min(1),
  expiresAt: z.string().datetime().nullable(),
});
export type ExecutableAgentIntent = z.infer<typeof ExecutableAgentIntentSchema>;

export const RoleResponseIntentSchema = MessageMetaSchema.extend({
  kind: z.literal("RoleResponseIntent"),
  responseIntentId: z.string().min(1),
  agentRunId: z.string().min(1),
  roleId: RoleIdSchema,
  intentType: z.literal("post_role_response"),
  rationaleSummary: z.string().min(1).max(800),
  proposedResponse: z.record(z.string(), z.unknown()),
  expectedStateVersion: z.number().int().nonnegative(),
  causationEventIds: z.array(z.string().min(1)).min(1),
  citationRefs: z.array(z.string().min(1)),
  confidence: z.number().min(0).max(1),
  visibility: z.array(VisibilityScopeSchema).min(1),
  visibleToActorIds: z.array(z.string().min(1)).min(2),
  idempotencyKey: z.string().min(1),
}).strict();
export type RoleResponseIntent = z.infer<typeof RoleResponseIntentSchema>;

export const WorldEventSchema = MessageMetaSchema.extend({
  kind: z.literal("WorldEvent"),
  eventId: z.string().min(1),
  eventType: EventTypeSchema,
  stateVersion: z.number().int().positive(),
  visibility: z.array(VisibilityScopeSchema).min(1),
  visibleToActorIds: z.array(z.string()),
  audience: ResourceAudienceSchema.optional(),
  summary: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  actionContext: ActionAuditContextSchema.nullable().default(null),
});
export type WorldEvent = z.infer<typeof WorldEventSchema>;

export const PrincipalSchema = z.object({
  principalId: z.string().min(1),
  kind: z.enum(["human", "service"]),
  displayName: z.string().min(1),
  status: z.enum(["active", "disabled"]),
  createdAt: z.string().datetime(),
});
export type Principal = z.infer<typeof PrincipalSchema>;

export const RoleBindingSchema = z.object({
  bindingId: z.string().min(1),
  principalId: z.string().min(1),
  sessionId: z.string().min(1),
  actorId: z.string().min(1),
  actorKind: ActorKindSchema,
  roleId: RoleIdSchema,
  status: z.enum(["active", "revoked"]),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime().nullable(),
});
export type RoleBinding = z.infer<typeof RoleBindingSchema>;

export const SessionControlSchemaVersion = "session-control.v1" as const;
export const TrainingSessionStatusSchema = z.enum([
  "provisioning",
  "active",
  "paused",
  "completed",
  "recovery_failed",
]);
export type TrainingSessionStatus = z.infer<typeof TrainingSessionStatusSchema>;

export const ClassroomSummarySchema = z.object({
  classroomId: z.string().min(1),
  courseId: z.string().min(1),
  name: z.string().min(1),
  status: z.enum(["active", "archived"]),
}).strict();
export type ClassroomSummary = z.infer<typeof ClassroomSummarySchema>;

export const TeamInstanceSummarySchema = z.object({
  teamId: z.string().min(1),
  classroomId: z.string().min(1),
  name: z.string().min(1),
  status: z.enum(["active", "archived"]),
}).strict();
export type TeamInstanceSummary = z.infer<typeof TeamInstanceSummarySchema>;

export const TrainingSessionSummarySchema = z.object({
  schemaVersion: z.literal(SessionControlSchemaVersion),
  sessionId: z.string().min(1),
  classroomId: z.string().min(1),
  teamId: z.string().min(1),
  releaseId: z.string().min(1),
  // Read-only business title resolved from the session's published course/scenario.
  experienceTitle: z.string().trim().min(1).max(240).optional(),
  requiresExplicitStudentMembership: z.boolean().optional(),
  status: TrainingSessionStatusSchema,
  statusVersion: z.number().int().nonnegative(),
  requestedBy: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  activatedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  lastRecoveryErrorCode: z.string().min(1).nullable(),
}).strict();
export type TrainingSessionSummary = z.infer<typeof TrainingSessionSummarySchema>;

export const DemoIdentityProfileSummarySchema = z.object({
  profileId: z.string().min(1),
  displayName: z.string().min(1),
  defaultSessionId: z.string().min(1).nullable(),
  authorizedSessionIds: z.array(z.string().min(1)),
  classroomId: z.string().min(1),
  teamId: z.string().min(1).nullable(),
  role: z.enum(["operator", "teacher", "student"]),
}).strict();
export type DemoIdentityProfileSummary = z.infer<typeof DemoIdentityProfileSummarySchema>;

export const SessionControlOverviewSchema = z.object({
  schemaVersion: z.literal(SessionControlSchemaVersion),
  classrooms: z.array(ClassroomSummarySchema),
  teams: z.array(TeamInstanceSummarySchema),
  sessions: z.array(TrainingSessionSummarySchema),
});
export type SessionControlOverview = z.infer<typeof SessionControlOverviewSchema>;

export const OperationsHealthSchemaVersion = "operations-health.v1" as const;
export const RecoveryCheckpointSchemaVersion =
  "recovery-checkpoint.v1" as const;
export const RecoveryCheckpointObservationStatusSchema = z.enum([
  "missing",
  "verified",
  "stale",
  "mismatch",
]);
export type RecoveryCheckpointObservationStatus = z.infer<
  typeof RecoveryCheckpointObservationStatusSchema
>;
export const RecoveryCheckpointObservationSchema = z.object({
  schemaVersion: z.literal(RecoveryCheckpointSchemaVersion),
  status: RecoveryCheckpointObservationStatusSchema,
  sessionId: z.string().min(1),
  checkedAt: z.string().datetime(),
  checkpointCreatedAt: z.string().datetime().nullable(),
  sourceRevision: z.number().int().nonnegative().nullable(),
  sourceSequence: z.number().int().nonnegative().nullable(),
  worldStateVersion: z.number().int().nonnegative(),
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/u),
  checkpointPayloadHash: z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
}).strict();
export type RecoveryCheckpointObservation = z.infer<
  typeof RecoveryCheckpointObservationSchema
>;

const OperationsHealthCountSchema = z.number().int().nonnegative();
const OperationsHealthOldestPendingAtSchema = z.object({
  overall: z.string().datetime().nullable(),
  outbox: z.string().datetime().nullable(),
  agentTasks: z.string().datetime().nullable(),
  mediaWorkItems: z.string().datetime().nullable(),
}).strict();

export const OperationsHealthSnapshotSchema = z.object({
  schemaVersion: z.literal(OperationsHealthSchemaVersion),
  generatedAt: z.string().datetime(),
  productVersion: z.string().min(1),
  scope: z.object({
    visibleSessionCount: OperationsHealthCountSchema,
  }).strict(),
  sessions: z.object({
    total: OperationsHealthCountSchema,
    statuses: z.object({
      provisioning: OperationsHealthCountSchema,
      active: OperationsHealthCountSchema,
      paused: OperationsHealthCountSchema,
      completed: OperationsHealthCountSchema,
      recovery_failed: OperationsHealthCountSchema,
    }).strict(),
    recoveryFailed: OperationsHealthCountSchema,
  }).strict(),
  outbox: z.object({
    pending: OperationsHealthCountSchema,
    delivered: OperationsHealthCountSchema,
  }).strict(),
  agentTasks: z.object({
    pending: OperationsHealthCountSchema,
    running: OperationsHealthCountSchema,
    completed: OperationsHealthCountSchema,
    failed: OperationsHealthCountSchema,
    deadLettered: OperationsHealthCountSchema,
  }).strict(),
  mediaWorkItems: z.object({
    queued: OperationsHealthCountSchema,
    running: OperationsHealthCountSchema,
    completed: OperationsHealthCountSchema,
    failed: OperationsHealthCountSchema,
  }).strict(),
  oldestPendingAt: OperationsHealthOldestPendingAtSchema,
  recoveryCheckpoints: z.object({
    total: OperationsHealthCountSchema,
    missing: OperationsHealthCountSchema,
    verified: OperationsHealthCountSchema,
    stale: OperationsHealthCountSchema,
    mismatch: OperationsHealthCountSchema,
    latestVerifiedAt: z.string().datetime().nullable(),
  }).strict().optional(),
}).strict();
export type OperationsHealthSnapshot = z.infer<
  typeof OperationsHealthSnapshotSchema
>;

export const OutboxRecordSchema = z.object({
  outboxId: z.string().min(1),
  sessionId: z.string().min(1),
  sessionEpoch: z.string().min(1),
  sceneId: z.string().min(1),
  eventId: z.string().min(1),
  eventType: EventTypeSchema,
  stateVersion: z.number().int().positive(),
  correlationId: z.string().min(1),
  topic: z.literal("world_event"),
  causalDepth: z.number().int().nonnegative(),
  status: z.enum(["pending", "delivered"]),
  attempts: z.number().int().nonnegative(),
  availableAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  deliveredAt: z.string().datetime().nullable(),
  lastErrorCode: z.string().min(1).nullable(),
});
export type OutboxRecord = z.infer<typeof OutboxRecordSchema>;

export const RoleContractSchema = z.object({
  agentId: z.string().min(1),
  actorKind: ActorKindSchema,
  roleId: RoleIdSchema,
  displayName: z.string().min(1),
  purpose: z.string().min(1),
  teamId: z.string().min(1),
  visibleScopes: z.array(VisibilityScopeSchema),
  privateScopes: z.array(z.string()),
  allowedIntents: z.array(z.string().min(1)),
  deniedActions: z.array(z.string()),
  toolPolicy: z.array(z.string()),
  tokenBudget: z.number().int().positive(),
  memoryPolicy: z.object({
    readOwn: z.boolean(),
    writeOwn: z.boolean(),
    auditReadable: z.boolean(),
    retention: z.literal("session_epoch"),
    maxEntries: z.number().int().positive(),
  }).strict().optional(),
  communicationPolicy: z.object({
    canInitiate: z.boolean(),
    canRespond: z.boolean(),
    allowedTargetRoleIds: z.array(RoleIdSchema),
    maxTurnsPerTarget: z.number().int().positive(),
  }).strict().optional(),
});
export type RoleContract = z.infer<typeof RoleContractSchema>;

export const AgentNodeKindSchema = z.enum([
  "router",
  "retrieval",
  "tool",
  "model",
  "rule",
  "guard",
  "handoff",
  "terminal",
]);
export type AgentNodeKind = z.infer<typeof AgentNodeKindSchema>;

export const AgentSignalValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);
export type AgentSignalValue = z.infer<typeof AgentSignalValueSchema>;

export const AgentRouteConditionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("always") }),
  z.object({
    kind: z.literal("signal_equals"),
    key: z.string().min(1),
    value: AgentSignalValueSchema,
  }),
  z.object({
    kind: z.literal("last_status_equals"),
    value: z.enum(["success", "failure"]),
  }),
  z.object({
    kind: z.literal("intent_present"),
    value: z.boolean(),
  }),
]);
export type AgentRouteCondition = z.infer<typeof AgentRouteConditionSchema>;

export const AgentGraphNodeSchema = z.object({
  nodeId: z.string().min(1),
  kind: AgentNodeKindSchema,
  label: z.string().min(1),
  executorKey: z.string().min(1).nullable(),
  promptTemplateId: z.string().min(1).nullable(),
  toolName: z.string().min(1).nullable(),
});
export type AgentGraphNode = z.infer<typeof AgentGraphNodeSchema>;

export const AgentGraphEdgeSchema = z.object({
  edgeId: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  priority: z.number().int(),
  condition: AgentRouteConditionSchema,
});
export type AgentGraphEdge = z.infer<typeof AgentGraphEdgeSchema>;

export const AgentTemplateRefSchema = z.object({
  templateId: z.string().min(1).max(240),
  templateVersion: z.string().min(1).max(120),
}).strict();
export type AgentTemplateRef = z.infer<typeof AgentTemplateRefSchema>;

export const AgentInstanceRefSchema = z.object({
  instanceId: z.string().min(1).max(320),
  instanceVersion: z.string().min(1).max(120),
}).strict();
export type AgentInstanceRef = z.infer<typeof AgentInstanceRefSchema>;

export const AgentTemplateSchema = z.object({
  schemaVersion: z.literal(AgentScaleSchemaVersion),
  templateId: z.string().min(1).max(240),
  templateVersion: z.string().min(1).max(120),
  roleId: RoleIdSchema,
  definitionVersion: z.string().min(1).max(120),
  promptVersion: z.string().min(1).max(120),
  allowedTriggers: z.array(z.string().min(1)).min(1),
  allowedIntents: z.array(z.string().min(1)).min(1),
  responsibility: z.string().min(1).max(500),
  capabilityDomains: z.array(z.string().min(1).max(120)).min(1).max(32),
  graphRef: z.string().min(1).max(240),
  promptPolicyRef: z.string().min(1).max(240),
  toolPolicyRef: z.string().min(1).max(240),
  permissionPolicyRef: z.string().min(1).max(240),
  contextPolicyRef: z.string().min(1).max(240),
  outputSchemaRef: z.string().min(1).max(240),
  allowedInstanceKinds: z.array(
    z.enum([
      "student_role",
      "npc",
      "teacher_assistant",
      "resource",
      "system",
    ]),
  ).min(1),
  failurePolicyRef: z.string().min(1).max(240),
  budget: z.object({
    maxSteps: z.number().int().positive(),
    maxToolCalls: z.number().int().nonnegative(),
    timeoutMs: z.number().int().positive(),
  }).strict(),
  enabled: z.boolean(),
}).strict();
export type AgentTemplate = z.infer<typeof AgentTemplateSchema>;

export const AgentInstanceContextSchema = z.object({
  bindingKind: z.enum([
    "student_role",
    "npc",
    "teacher_assistant",
    "resource",
    "system",
    "legacy_derived",
  ]),
  bindingId: z.string().min(1).max(320),
  actorId: z.string().min(1).max(240),
  actorKind: ActorKindSchema,
  courseId: z.string().min(1).max(240),
  teamId: z.string().min(1).max(240),
  privateMemoryNamespaceRef: z.string().min(1).max(600),
  configHash: z.string().regex(/^[a-f0-9]{64}$/u),
  lifecycle: z.enum(["active", "paused", "retired", "legacy_derived"]),
  subjectActorId: z.string().min(1).max(240).nullable().default(null),
  subjectRoleId: RoleIdSchema.nullable().default(null),
  resourceRef: VersionedObjectRefSchema.nullable().default(null),
}).strict().superRefine((instance, context) => {
  if ((instance.subjectActorId === null) !== (instance.subjectRoleId === null)) {
    context.addIssue({
      code: "custom",
      path: ["subjectActorId"],
      message: "实例主体行动者与角色必须同时存在或同时为空",
    });
  }
  if (instance.bindingKind === "resource" && instance.resourceRef === null) {
    context.addIssue({
      code: "custom",
      path: ["resourceRef"],
      message: "资源实例必须固定精确资源版本引用",
    });
  }
  if (instance.bindingKind !== "resource" && instance.resourceRef !== null) {
    context.addIssue({
      code: "custom",
      path: ["resourceRef"],
      message: "非资源实例不得携带资源绑定引用",
    });
  }
});
export type AgentInstanceContext = z.infer<typeof AgentInstanceContextSchema>;

export const AgentInstanceSchema = z.object({
  schemaVersion: z.literal(AgentScaleSchemaVersion),
  instanceRef: AgentInstanceRefSchema,
  templateRef: AgentTemplateRefSchema,
  agentId: z.string().min(1),
  roleId: RoleIdSchema,
  sessionId: z.string().min(1),
  sessionEpoch: z.string().min(1),
  context: AgentInstanceContextSchema,
  roleSnapshot: RoleContractSchema.nullable().default(null),
  createdAt: z.string().datetime(),
}).strict();
export type AgentInstance = z.infer<typeof AgentInstanceSchema>;

export const AgentTemplatePlaneSchema = z.enum([
  "teaching_direction",
  "world_role",
  "professional_governance",
  "trusted_evaluation",
  "supervised_learning",
  "student_assistance",
  "material_production",
  "teacher_assistance",
]);
export type AgentTemplatePlane = z.infer<typeof AgentTemplatePlaneSchema>;

export const AgentTemplateLifecycleSchema = z.enum([
  "baseline",
  "candidate",
  "active",
  "retired",
]);
export type AgentTemplateLifecycle = z.infer<
  typeof AgentTemplateLifecycleSchema
>;

export const AgentTemplateAdmissionSchema = z.object({
  status: z.enum([
    "baseline",
    "design_gate_passed",
    "pending_ablation",
    "rejected",
  ]),
  responsibilityCase: z.string().min(1).max(1_200),
  permissionBoundary: z.string().min(1).max(1_200),
  contextBoundary: z.string().min(1).max(1_200),
  outputContract: z.string().min(1).max(1_200),
  triggerAndFilterPolicy: z.string().min(1).max(1_200),
  ablationHypothesis: z.string().min(1).max(1_200),
  failureRoute: z.string().min(1).max(1_200),
}).strict();
export type AgentTemplateAdmission = z.infer<
  typeof AgentTemplateAdmissionSchema
>;

export const AgentTemplateCatalogEntrySchema = z.object({
  schemaVersion: z.literal(AgentTemplateCatalogSchemaVersion),
  template: AgentTemplateSchema,
  plane: AgentTemplatePlaneSchema,
  lifecycle: AgentTemplateLifecycleSchema,
  admission: AgentTemplateAdmissionSchema,
}).strict().superRefine((entry, context) => {
  if (entry.lifecycle === "active" && !entry.template.enabled) {
    context.addIssue({
      code: "custom",
      path: ["template", "enabled"],
      message: "活动模板必须启用",
    });
  }
  if (
    (entry.lifecycle === "candidate" || entry.lifecycle === "retired")
    && entry.template.enabled
  ) {
    context.addIssue({
      code: "custom",
      path: ["template", "enabled"],
      message: "候选或退役模板不得进入活动调度",
    });
  }
});
export type AgentTemplateCatalogEntry = z.infer<
  typeof AgentTemplateCatalogEntrySchema
>;

export const AgentAssistanceKindSchema = z.enum([
  "course_navigation",
  "task_planning",
  "evidence_coaching",
  "material_understanding",
  "interview_structuring",
  "content_adaptation",
  "course_design",
  "live_intervention",
  "evaluation_review",
]);
export type AgentAssistanceKind = z.infer<
  typeof AgentAssistanceKindSchema
>;

const AssistanceSummarySchema = z.string().min(1).max(1_500);
const AssistanceTextListSchema = z.array(
  z.string().min(1).max(800),
).max(16);

export const CourseNavigationOutputSchema = z.object({
  kind: z.literal("course_navigation"),
  summary: AssistanceSummarySchema,
  objective: z.string().min(1).max(1_200),
  requirementExplanation: AssistanceTextListSchema,
  roleBoundary: z.string().min(1).max(1_200),
  nextAction: z.string().min(1).max(800),
}).strict();
export type CourseNavigationOutput = z.infer<
  typeof CourseNavigationOutputSchema
>;

export const TaskPlanningOutputSchema = z.object({
  kind: z.literal("task_planning"),
  summary: AssistanceSummarySchema,
  steps: z.array(z.object({
    stepId: z.string().min(1).max(120),
    label: z.string().min(1).max(500),
    priority: z.enum(["now", "next", "later"]),
    dependsOn: z.array(z.string().min(1).max(120)).max(8),
  }).strict()).min(1).max(12),
  missingInputs: AssistanceTextListSchema,
}).strict();
export type TaskPlanningOutput = z.infer<typeof TaskPlanningOutputSchema>;

export const EvidenceCoachingOutputSchema = z.object({
  kind: z.literal("evidence_coaching"),
  summary: AssistanceSummarySchema,
  questions: AssistanceTextListSchema.min(1),
  evidenceGaps: AssistanceTextListSchema,
  verificationPath: AssistanceTextListSchema.min(1),
}).strict();
export type EvidenceCoachingOutput = z.infer<
  typeof EvidenceCoachingOutputSchema
>;

export const MaterialUnderstandingOutputSchema = z.object({
  kind: z.literal("material_understanding"),
  summary: AssistanceSummarySchema,
  materialRef: VersionedObjectRefSchema,
  observations: z.array(z.object({
    label: z.string().min(1).max(240),
    value: z.string().min(1).max(1_200),
    sourceRefs: z.array(z.string().min(1).max(300)).min(1).max(12),
  }).strict()).min(1).max(24),
  entities: AssistanceTextListSchema,
  claims: z.array(z.object({
    statement: z.string().min(1).max(1_200),
    verificationStatus: z.literal("unverified"),
    sourceRefs: z.array(z.string().min(1).max(300)).min(1).max(12),
  }).strict()).max(16),
  timeRefs: AssistanceTextListSchema,
}).strict();
export type MaterialUnderstandingOutput = z.infer<
  typeof MaterialUnderstandingOutputSchema
>;

export const InterviewStructuringOutputSchema = z.object({
  kind: z.literal("interview_structuring"),
  summary: AssistanceSummarySchema,
  transcriptRef: VersionedObjectRefSchema,
  minutesDraft: AssistanceTextListSchema.min(1),
  statements: z.array(z.object({
    speaker: z.string().min(1).max(240),
    statement: z.string().min(1).max(1_200),
    verificationStatus: z.literal("pending_confirmation"),
    evidenceRefs: z.array(z.string().min(1).max(300)).max(12),
  }).strict()).max(24),
  followUpQuestions: AssistanceTextListSchema,
}).strict();
export type InterviewStructuringOutput = z.infer<
  typeof InterviewStructuringOutputSchema
>;

export const ContentAdaptationOutputSchema = z.object({
  kind: z.literal("content_adaptation"),
  summary: AssistanceSummarySchema,
  sourceRevisionRef: VersionedObjectRefSchema,
  channel: z.string().min(1).max(240),
  titleSuggestions: AssistanceTextListSchema,
  structureSuggestions: AssistanceTextListSchema,
  lengthGuidance: z.string().min(1).max(800),
  citationWarnings: AssistanceTextListSchema,
}).strict();
export type ContentAdaptationOutput = z.infer<
  typeof ContentAdaptationOutputSchema
>;

export const CourseDesignOutputSchema = z.object({
  kind: z.literal("course_design"),
  summary: AssistanceSummarySchema,
  draftDiffs: AssistanceTextListSchema,
  missingItems: AssistanceTextListSchema,
  candidateNodes: AssistanceTextListSchema,
  rubricSuggestions: AssistanceTextListSchema,
}).strict();
export type CourseDesignOutput = z.infer<typeof CourseDesignOutputSchema>;

export const LiveInterventionOutputSchema = z.object({
  kind: z.literal("live_intervention"),
  summary: AssistanceSummarySchema,
  options: z.array(z.object({
    strategy: z.enum([
      "wait",
      "hint_card",
      "npc_follow_up",
      "additional_material",
      "human_takeover",
    ]),
    reason: z.string().min(1).max(800),
    targetActorIds: z.array(z.string().min(1).max(240)).max(32),
  }).strict()).min(1).max(8),
  recommendedOrder: AssistanceTextListSchema,
}).strict();
export type LiveInterventionOutput = z.infer<
  typeof LiveInterventionOutputSchema
>;

export const EvaluationReviewOutputSchema = z.object({
  kind: z.literal("evaluation_review"),
  summary: AssistanceSummarySchema,
  evaluationCaseId: z.string().min(1).max(240),
  arbitrationId: z.string().min(1).max(240),
  dimensionDifferences: z.array(z.object({
    dimensionId: z.string().min(1).max(240),
    proposalScores: z.array(z.number().min(0).max(100)).max(8),
    spread: z.number().min(0).max(100),
  }).strict()).max(24),
  evidenceGaps: AssistanceTextListSchema,
  reviewOrder: AssistanceTextListSchema.min(1),
}).strict();
export type EvaluationReviewOutput = z.infer<
  typeof EvaluationReviewOutputSchema
>;

export const AgentAssistanceOutputSchema = z.discriminatedUnion("kind", [
  CourseNavigationOutputSchema,
  TaskPlanningOutputSchema,
  EvidenceCoachingOutputSchema,
  MaterialUnderstandingOutputSchema,
  InterviewStructuringOutputSchema,
  ContentAdaptationOutputSchema,
  CourseDesignOutputSchema,
  LiveInterventionOutputSchema,
  EvaluationReviewOutputSchema,
]);
export type AgentAssistanceOutput = z.infer<
  typeof AgentAssistanceOutputSchema
>;

export const AgentAssistanceProposalSchema = MessageMetaSchema.extend({
  kind: z.literal("AgentAssistanceProposal"),
  assistanceSchemaVersion: z.literal(AgentAssistanceSchemaVersion),
  proposalId: z.string().min(1).max(320),
  agentRunId: z.string().min(1).max(320),
  roleId: RoleIdSchema,
  templateRef: AgentTemplateRefSchema,
  instanceRef: AgentInstanceRefSchema,
  outputSchemaRef: z.string().min(1).max(240),
  output: AgentAssistanceOutputSchema,
  subjectActorId: z.string().min(1).max(240).nullable(),
  resourceRef: VersionedObjectRefSchema.nullable(),
  expectedStateVersion: z.number().int().nonnegative(),
  causationEventIds: z.array(z.string().min(1)).min(1).max(32),
  evidenceRefs: z.array(z.string().min(1)).max(128),
  citationRefs: z.array(z.string().min(1)).max(128),
  authority: z.literal("advisory_only"),
  requiresHumanAction: z.literal(true),
  visibility: z.array(VisibilityScopeSchema).min(1),
  visibleToActorIds: z.array(z.string().min(1)).max(64),
  idempotencyKey: z.string().min(1).max(320),
  expiresAt: z.string().datetime().nullable(),
}).strict().superRefine((proposal, context) => {
  if (proposal.visibility.includes("public_world")) {
    context.addIssue({
      code: "custom",
      path: ["visibility"],
      message: "辅助建议不得直接进入公开世界",
    });
  }
  if (
    proposal.subjectActorId !== null
    && !proposal.visibleToActorIds.includes(proposal.subjectActorId)
  ) {
    context.addIssue({
      code: "custom",
      path: ["visibleToActorIds"],
      message: "面向行动者的辅助建议必须显式包含目标行动者",
    });
  }
  const studentKinds = new Set<AgentAssistanceKind>([
    "course_navigation",
    "task_planning",
    "evidence_coaching",
  ]);
  const teacherKinds = new Set<AgentAssistanceKind>([
    "course_design",
    "live_intervention",
    "evaluation_review",
  ]);
  const materialKinds = new Set<AgentAssistanceKind>([
    "material_understanding",
    "interview_structuring",
    "content_adaptation",
  ]);
  if (
    (studentKinds.has(proposal.output.kind)
      || teacherKinds.has(proposal.output.kind))
    && proposal.subjectActorId === null
  ) {
    context.addIssue({
      code: "custom",
      path: ["subjectActorId"],
      message: "学生或教师辅助建议必须固定目标行动者",
    });
  }
  if (
    materialKinds.has(proposal.output.kind)
    && proposal.resourceRef === null
  ) {
    context.addIssue({
      code: "custom",
      path: ["resourceRef"],
      message: "材料生产辅助建议必须固定资源版本",
    });
  }
  if (
    proposal.output.kind === "evaluation_review"
    && proposal.resourceRef === null
  ) {
    context.addIssue({
      code: "custom",
      path: ["resourceRef"],
      message: "评价复核辅助建议必须固定仲裁资源版本",
    });
  }
});
export type AgentAssistanceProposal = z.infer<
  typeof AgentAssistanceProposalSchema
>;

export const AgentContributionCriticalNodeSchema = z.enum([
  "student_evidence_recorded",
  "material_processing_completed",
  "teacher_evaluation_arbitrated",
]);
export type AgentContributionCriticalNode = z.infer<
  typeof AgentContributionCriticalNodeSchema
>;

export const AgentContributionProfileSchema = z.object({
  templateId: z.string().min(1).max(240),
  templateVersion: z.string().min(1).max(120),
  instanceVersion: z.string().min(1).max(120),
  criticalNode: AgentContributionCriticalNodeSchema,
  rolePerspective: z.string().min(1).max(500),
  permissionSummary: z.string().min(1).max(1_200),
  studentDecision: z.boolean(),
}).strict();
export type AgentContributionProfile = z.infer<
  typeof AgentContributionProfileSchema
>;

export const AgentContributionProfiles = Object.freeze([
  {
    templateId: "assistant/evidence-coach",
    templateVersion: "1.0.0",
    instanceVersion: "assistant-evidence-coach/1.0.0",
    criticalNode: "student_evidence_recorded",
    rolePerspective: "目标学生岗位的证据核验视角",
    permissionSummary:
      "只读目标学生本人可见证据与授权事实；不得确认事实、提交成果或推进节点。",
    studentDecision: true,
  },
  {
    templateId: "assistant/material-understanding",
    templateVersion: "1.0.0",
    instanceVersion: "assistant-material-understanding/1.0.0",
    criticalNode: "material_processing_completed",
    rolePerspective: "材料发起岗位的观察与来源视角",
    permissionSummary:
      "只读取发起人可见的固定材料版本与处理输出；不发布、不覆盖原素材、不确认事实。",
    studentDecision: true,
  },
  {
    templateId: "assistant/evaluation-review",
    templateVersion: "1.0.0",
    instanceVersion: "assistant-evaluation-review/1.0.0",
    criticalNode: "teacher_evaluation_arbitrated",
    rolePerspective: "教师终评前的逐维复核视角",
    permissionSummary:
      "只读当前教师可管理的固定案件、证据包、意见与仲裁，不写最终成绩。",
    studentDecision: false,
  },
] as const satisfies readonly AgentContributionProfile[]);

export const AgentContributionProfilesByTemplateId: ReadonlyMap<
  string,
  AgentContributionProfile
> = new Map(
  AgentContributionProfiles.map((profile) => [
    profile.templateId,
    AgentContributionProfileSchema.parse(profile),
  ]),
);

export const AgentContributionBasisRefSchema = z.object({
  kind: z.enum(["evidence", "citation", "event"]),
  refId: z.string().min(1).max(320),
}).strict();
export type AgentContributionBasisRef = z.infer<
  typeof AgentContributionBasisRefSchema
>;

export const AgentContributionDecisionSchema = z.object({
  templateRef: AgentTemplateRefSchema,
  instanceRef: AgentInstanceRefSchema,
  rolePerspective: z.string().min(1).max(500),
  basisRefs: z.array(AgentContributionBasisRefSchema).min(1).max(128),
  permissionSummary: z.string().min(1).max(1_200),
  decision: z.enum(["accepted", "rejected"]),
  studentReason: z.string().trim().min(1).max(280),
  idempotencyKey: z.string().min(1).max(320),
}).strict().superRefine((decision, context) => {
  const profile = AgentContributionProfilesByTemplateId.get(
    decision.templateRef.templateId,
  );
  if (!profile || !profile.studentDecision) {
    context.addIssue({
      code: "custom",
      path: ["templateRef", "templateId"],
      message: "学生贡献决策只能引用开放学生选择的 active 辅助模板",
    });
    return;
  }
  const frozenFields = [
    {
      path: ["templateRef", "templateVersion"],
      actual: decision.templateRef.templateVersion,
      expected: profile.templateVersion,
    },
    {
      path: ["instanceRef", "instanceVersion"],
      actual: decision.instanceRef.instanceVersion,
      expected: profile.instanceVersion,
    },
    {
      path: ["rolePerspective"],
      actual: decision.rolePerspective,
      expected: profile.rolePerspective,
    },
    {
      path: ["permissionSummary"],
      actual: decision.permissionSummary,
      expected: profile.permissionSummary,
    },
  ] as const;
  for (const field of frozenFields) {
    if (field.actual !== field.expected) {
      context.addIssue({
        code: "custom",
        path: [...field.path],
        message: "学生贡献决策必须匹配冻结的 active 模板配置",
      });
    }
  }
});
export type AgentContributionDecision = z.infer<
  typeof AgentContributionDecisionSchema
>;

export const AgentContributionDecisionEventPayloadSchema = z.object({
  proposalId: z.string().min(1).max(320),
  decision: AgentContributionDecisionSchema,
}).strict();
export type AgentContributionDecisionEventPayload = z.infer<
  typeof AgentContributionDecisionEventPayloadSchema
>;

export const AgentContributionDecisionCommandPayloadSchema = z.object({
  proposalId: z.string().min(1).max(320),
  decision: z.enum(["accepted", "rejected"]),
  studentReason: z.string().trim().min(1).max(280),
  idempotencyKey: z.string().min(1).max(320),
}).strict();
export type AgentContributionDecisionCommandPayload = z.infer<
  typeof AgentContributionDecisionCommandPayloadSchema
>;

export const AgentExperimentConditionSchema = z.enum([
  "standard",
  "single_generalist",
  "shared_view_roles",
  "private_view_event_group",
]);
export type AgentExperimentCondition = z.infer<
  typeof AgentExperimentConditionSchema
>;

export const AgentArchitectureProfileSchema = z.object({
  profileId: z.string().min(1).max(160),
  profileVersion: z.string().min(1).max(120),
  enabledTemplateIds: z.array(z.string().min(1).max(240)).max(64)
    .nullable()
    .default(null),
  disabledTemplateIds: z.array(z.string().min(1).max(240)).max(64)
    .default([]),
  policyHash: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict().superRefine((profile, context) => {
  if (!profile.enabledTemplateIds) return;
  const enabled = new Set(profile.enabledTemplateIds);
  const overlap = profile.disabledTemplateIds.find((templateId) => (
    enabled.has(templateId)
  ));
  if (overlap) {
    context.addIssue({
      code: "custom",
      path: ["disabledTemplateIds"],
      message: `架构配置不能同时启用和停用模板：${overlap}`,
    });
  }
});
export type AgentArchitectureProfile = z.infer<
  typeof AgentArchitectureProfileSchema
>;

export const AgentArchitectureProfileRefSchema = z.object({
  profileId: z.string().min(1).max(160),
  profileVersion: z.string().min(1).max(120),
  policyHash: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();
export type AgentArchitectureProfileRef = z.infer<
  typeof AgentArchitectureProfileRefSchema
>;

export const ExperimentObservationSchemaVersion =
  "experiment-observation/1.0.0" as const;
export const ExperimentObservationRefSchema = z.object({
  schemaVersion: z.literal(ExperimentObservationSchemaVersion),
  experimentId: z.string().min(1).max(160),
  condition: AgentExperimentConditionSchema,
  runBatchId: z.string().min(1).max(160),
  caseId: z.string().min(1).max(160),
  repetition: z.number().int().positive(),
  controlVariablesHash: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();
export type ExperimentObservationRef = z.infer<
  typeof ExperimentObservationRefSchema
>;

export const AgentDispatchReasonSchema = z.enum([
  "selected",
  "subscription_disabled",
  "event_type_mismatch",
  "target_mismatch",
  "causal_depth_exceeded",
  "duplicate_suppressed",
  "debounce_active",
  "instance_inactive",
  "architecture_profile_excluded",
  "wave_budget_exhausted",
  "legacy_unobserved",
]);
export type AgentDispatchReason = z.infer<typeof AgentDispatchReasonSchema>;

export const AgentWaveBudgetObservationSchema = z.object({
  limit: z.number().int().positive(),
  affected: z.number().int().nonnegative(),
  selected: z.number().int().nonnegative(),
  filtered: z.number().int().nonnegative(),
  consumed: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
  exhausted: z.boolean(),
}).strict().superRefine((budget, context) => {
  if (
    budget.selected > budget.affected
    || budget.filtered !== budget.affected - budget.selected
  ) {
    context.addIssue({
      code: "custom",
      message: "单波预算的受影响、入选与过滤数量不一致",
    });
  }
  if (
    budget.consumed > budget.limit
    || budget.remaining !== budget.limit - budget.consumed
  ) {
    context.addIssue({
      code: "custom",
      message: "单波预算的消耗与剩余额度不一致",
    });
  }
});
export type AgentWaveBudgetObservation = z.infer<
  typeof AgentWaveBudgetObservationSchema
>;

export const AgentDispatchDecisionSchema = z.object({
  decisionId: z.string().min(1).max(320),
  affected: z.boolean().nullable(),
  decision: z.enum(["selected", "filtered", "unobserved"]),
  reason: AgentDispatchReasonSchema,
  selectedOrder: z.number().int().nonnegative().nullable(),
  budget: AgentWaveBudgetObservationSchema.nullable(),
}).strict().superRefine((decision, context) => {
  if (
    decision.decision === "selected"
    && (
      decision.affected !== true
      || decision.reason !== "selected"
      || decision.selectedOrder === null
      || decision.budget === null
    )
  ) {
    context.addIssue({
      code: "custom",
      message: "已选择实例必须记录 selected 理由与顺序",
    });
  }
  if (
    decision.decision === "filtered"
    && (
      decision.affected === null
      || decision.reason === "selected"
      || decision.selectedOrder !== null
      || decision.budget === null
    )
  ) {
    context.addIssue({
      code: "custom",
      message: "被过滤实例不得记录 selected 理由或顺序",
    });
  }
  if (
    decision.decision === "unobserved"
    && (
      decision.affected !== null
      || decision.reason !== "legacy_unobserved"
      || decision.selectedOrder !== null
      || decision.budget !== null
    )
  ) {
    context.addIssue({
      code: "custom",
      message: "旧记录的未知调度观测不得伪造受影响集合或预算",
    });
  }
});
export type AgentDispatchDecision = z.infer<
  typeof AgentDispatchDecisionSchema
>;

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function legacyTemplateRef(value: Record<string, unknown>): AgentTemplateRef {
  const agentId = typeof value.agentId === "string"
    ? value.agentId
    : "unknown-agent";
  const definitionVersion = typeof value.definitionVersion === "string"
    ? value.definitionVersion
    : "legacy/unpinned";
  return {
    templateId: `template:${agentId}`,
    templateVersion: definitionVersion,
  };
}

function legacyInstanceRef(value: Record<string, unknown>): AgentInstanceRef {
  const agentId = typeof value.agentId === "string"
    ? value.agentId
    : "unknown-agent";
  const sessionId = typeof value.sessionId === "string"
    ? value.sessionId
    : "legacy-session";
  const sessionEpoch = typeof value.sessionEpoch === "string"
    ? value.sessionEpoch
    : "legacy-epoch";
  const definitionVersion = typeof value.definitionVersion === "string"
    ? value.definitionVersion
    : "legacy/unpinned";
  return {
    instanceId: `${sessionId}:${sessionEpoch}:${agentId}`,
    instanceVersion: definitionVersion,
  };
}

function legacyInstanceContext(
  value: Record<string, unknown>,
): AgentInstanceContext {
  const actorId = typeof value.agentId === "string"
    ? value.agentId
    : "unknown-agent";
  return {
    bindingKind: "legacy_derived",
    bindingId: `legacy:${actorId}`,
    actorId,
    actorKind: "agent",
    courseId: "legacy/unobserved",
    teamId: "legacy/unobserved",
    privateMemoryNamespaceRef: "legacy/unobserved",
    configHash: "0".repeat(64),
    lifecycle: "legacy_derived",
    subjectActorId: null,
    subjectRoleId: null,
    resourceRef: null,
  };
}

function legacyDispatchDecision(value: Record<string, unknown>): AgentDispatchDecision {
  return {
    decisionId: `legacy-unobserved:${String(value.taskId ?? value.agentRunId ?? "unknown")}`,
    affected: null,
    decision: "unobserved",
    reason: "legacy_unobserved",
    selectedOrder: null,
    budget: null,
  };
}

const AgentDefinitionObjectSchema = z.object({
  templateRef: AgentTemplateRefSchema,
  agentId: z.string().min(1),
  roleId: RoleIdSchema,
  definitionVersion: z.string().min(1),
  promptVersion: z.string().min(1),
  entryNodeId: z.string().min(1),
  allowedTriggers: z.array(z.string().min(1)).min(1),
  allowedIntents: z.array(z.string().min(1)).min(1),
  maxSteps: z.number().int().positive(),
  maxToolCalls: z.number().int().nonnegative(),
  timeoutMs: z.number().int().positive(),
  nodes: z.array(AgentGraphNodeSchema).min(1),
  edges: z.array(AgentGraphEdgeSchema),
});
export const AgentDefinitionSchema = z.preprocess((value) => {
  const definition = recordOf(value);
  if (!definition) return value;
  return {
    ...definition,
    templateRef: definition.templateRef ?? legacyTemplateRef(definition),
  };
}, AgentDefinitionObjectSchema);
export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>;

const AgentSubscriptionObjectSchema = z.object({
  subscriptionId: z.string().min(1),
  agentId: z.string().min(1),
  roleId: RoleIdSchema,
  templateRef: AgentTemplateRefSchema,
  definitionVersion: z.string().min(1),
  promptVersion: z.string().min(1),
  eventTypes: z.array(EventTypeSchema).min(1),
  targetActorIdField: z.enum([
    "interaction.toActorId",
    "payload.targetAgentId",
  ]).nullable().default(null),
  maxCausalDepth: z.number().int().nonnegative().default(8),
  debounceMs: z.number().int().nonnegative().default(0),
  waveCost: z.number().int().positive().default(1),
  priority: z.number().int(),
  enabled: z.boolean(),
});
export const AgentSubscriptionSchema = z.preprocess((value) => {
  const subscription = recordOf(value);
  if (!subscription) return value;
  return {
    ...subscription,
    templateRef: subscription.templateRef ?? legacyTemplateRef(subscription),
  };
}, AgentSubscriptionObjectSchema);
export type AgentSubscription = z.infer<typeof AgentSubscriptionSchema>;

export const AgentTaskStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "degraded",
  "failed",
  "skipped",
]);
export type AgentTaskStatus = z.infer<typeof AgentTaskStatusSchema>;

export const AgentTaskLeaseSchema = z.object({
  ownerId: z.string().min(1),
  token: z.string().min(1),
  acquiredAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});
export type AgentTaskLease = z.infer<typeof AgentTaskLeaseSchema>;

const AgentTaskObjectSchema = z.object({
  taskId: z.string().min(1),
  outboxId: z.string().min(1),
  subscriptionId: z.string().min(1),
  agentId: z.string().min(1),
  roleId: RoleIdSchema,
  templateRef: AgentTemplateRefSchema,
  instanceRef: AgentInstanceRefSchema,
  instanceContext: AgentInstanceContextSchema,
  roleSnapshot: RoleContractSchema.nullable().default(null),
  definitionVersion: z.string().min(1),
  promptVersion: z.string().min(1),
  sessionId: z.string().min(1),
  sessionEpoch: z.string().min(1),
  sceneId: z.string().min(1),
  triggerEventId: z.string().min(1),
  triggerEventType: EventTypeSchema,
  expectedStateVersion: z.number().int().nonnegative(),
  priority: z.number().int(),
  correlationId: z.string().min(1),
  causalDepth: z.number().int().nonnegative(),
  actionContext: ActionAuditContextSchema.nullable().default(null),
  experimentObservation: ExperimentObservationRefSchema.nullable().default(null),
  dispatchDecision: AgentDispatchDecisionSchema,
  idempotencyKey: z.string().min(1),
  status: AgentTaskStatusSchema,
  attempts: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  availableAt: z.string().datetime(),
  lease: AgentTaskLeaseSchema.nullable(),
  lastErrorCode: z.string().min(1).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
});
export const AgentTaskSchema = z.preprocess((value) => {
  const task = recordOf(value);
  if (!task) return value;
  return {
    ...task,
    templateRef: task.templateRef ?? legacyTemplateRef(task),
    instanceRef: task.instanceRef ?? legacyInstanceRef(task),
    instanceContext: task.instanceContext ?? legacyInstanceContext(task),
    roleSnapshot: task.roleSnapshot ?? null,
    actionContext: task.actionContext ?? null,
    experimentObservation: task.experimentObservation ?? null,
    dispatchDecision: task.dispatchDecision ?? legacyDispatchDecision(task),
  };
}, AgentTaskObjectSchema);
export type AgentTask = z.infer<typeof AgentTaskSchema>;

export const AgentDispatchPlanDecisionSchema = z.object({
  subscriptionId: z.string().min(1),
  agentId: z.string().min(1),
  roleId: RoleIdSchema,
  templateRef: AgentTemplateRefSchema,
  instanceRef: AgentInstanceRefSchema,
  instanceContext: AgentInstanceContextSchema,
  decision: AgentDispatchDecisionSchema,
}).strict();
export type AgentDispatchPlanDecision = z.infer<
  typeof AgentDispatchPlanDecisionSchema
>;

export const AgentDispatchPlanSchema = z.object({
  planId: z.string().min(1).max(320),
  waveId: z.string().min(1).max(320),
  policyVersion: z.literal(AgentScaleSchemaVersion),
  sessionId: z.string().min(1),
  sessionEpoch: z.string().min(1),
  eventId: z.string().min(1),
  outboxId: z.string().min(1),
  createdAt: z.string().datetime(),
  architectureProfile: AgentArchitectureProfileSchema,
  experimentObservation: ExperimentObservationRefSchema.nullable(),
  affectedInstanceIds: z.array(z.string().min(1)),
  budget: AgentWaveBudgetObservationSchema,
  decisions: z.array(AgentDispatchPlanDecisionSchema),
  tasks: z.array(AgentTaskSchema),
}).strict().superRefine((plan, context) => {
  const decisionIds = new Set<string>();
  const decisionsById = new Map<string, AgentDispatchDecision>();
  const selectedDecisionIds = new Set<string>();
  const affectedInstanceIds = new Set<string>();
  for (const candidate of plan.decisions) {
    const decisionId = candidate.decision.decisionId;
    if (decisionIds.has(decisionId)) {
      context.addIssue({
        code: "custom",
        path: ["decisions"],
        message: `DispatchPlan 调度决定 ID 重复：${decisionId}`,
      });
    }
    decisionIds.add(decisionId);
    decisionsById.set(decisionId, candidate.decision);
    if (candidate.decision.decision === "unobserved") {
      context.addIssue({
        code: "custom",
        path: ["decisions"],
        message: "新调度计划不得写入 legacy_unobserved 决定",
      });
    }
    if (candidate.decision.decision === "selected") {
      selectedDecisionIds.add(decisionId);
    }
    if (candidate.decision.affected === true) {
      affectedInstanceIds.add(candidate.instanceRef.instanceId);
    }
  }
  const declaredAffected = new Set(plan.affectedInstanceIds);
  if (
    declaredAffected.size !== plan.affectedInstanceIds.length
    || declaredAffected.size !== affectedInstanceIds.size
    || [...affectedInstanceIds].some((instanceId) => (
      !declaredAffected.has(instanceId)
    ))
  ) {
    context.addIssue({
      code: "custom",
      path: ["affectedInstanceIds"],
      message: "DispatchPlan 受影响实例集合必须与候选决定一致且不得重复",
    });
  }
  if (
    plan.budget.affected !== plan.decisions.filter(
      (candidate) => candidate.decision.affected === true,
    ).length
    || plan.budget.selected !== selectedDecisionIds.size
  ) {
    context.addIssue({
      code: "custom",
      path: ["budget"],
      message: "DispatchPlan 预算观测必须与候选决定统计一致",
    });
  }
  for (const candidate of plan.decisions) {
    if (
      candidate.decision.budget === null
      || JSON.stringify(candidate.decision.budget) !== JSON.stringify(plan.budget)
    ) {
      context.addIssue({
        code: "custom",
        path: ["decisions"],
        message: `调度决定必须引用计划的同一预算观测：${candidate.decision.decisionId}`,
      });
    }
  }
  const taskDecisionIds = new Set<string>();
  const taskIds = new Set<string>();
  const taskIdempotencyKeys = new Set<string>();
  for (const task of plan.tasks) {
    if (
      taskIds.has(task.taskId)
      || taskIdempotencyKeys.has(task.idempotencyKey)
    ) {
      context.addIssue({
        code: "custom",
        path: ["tasks"],
        message: "DispatchPlan 不得包含重复任务 ID 或幂等键",
      });
    }
    taskIds.add(task.taskId);
    taskIdempotencyKeys.add(task.idempotencyKey);
    if (taskDecisionIds.has(task.dispatchDecision.decisionId)) {
      context.addIssue({
        code: "custom",
        path: ["tasks"],
        message: `一个调度决定只能生成一个 AgentTask：${task.dispatchDecision.decisionId}`,
      });
    }
    taskDecisionIds.add(task.dispatchDecision.decisionId);
    if (task.dispatchDecision.decision !== "selected") {
      context.addIssue({
        code: "custom",
        path: ["tasks"],
        message: "DispatchPlan 只能为已选择实例创建 AgentTask",
      });
    }
    if (!decisionIds.has(task.dispatchDecision.decisionId)) {
      context.addIssue({
        code: "custom",
        path: ["tasks"],
        message: `AgentTask 引用的调度决定不存在：${task.dispatchDecision.decisionId}`,
      });
    }
    const plannedDecision = decisionsById.get(
      task.dispatchDecision.decisionId,
    );
    if (
      plannedDecision
      && JSON.stringify(plannedDecision)
        !== JSON.stringify(task.dispatchDecision)
    ) {
      context.addIssue({
        code: "custom",
        path: ["tasks"],
        message: `AgentTask 调度决定与计划不一致：${task.dispatchDecision.decisionId}`,
      });
    }
    if (
      task.sessionId !== plan.sessionId
      || task.sessionEpoch !== plan.sessionEpoch
      || task.outboxId !== plan.outboxId
      || task.triggerEventId !== plan.eventId
      || JSON.stringify(task.experimentObservation)
        !== JSON.stringify(plan.experimentObservation)
    ) {
      context.addIssue({
        code: "custom",
        path: ["tasks"],
        message: "AgentTask 必须与 DispatchPlan 的会话、事件、Outbox 和实验观测一致",
      });
    }
  }
  if (
    taskDecisionIds.size !== selectedDecisionIds.size
    || [...selectedDecisionIds].some((decisionId) => (
      !taskDecisionIds.has(decisionId)
    ))
  ) {
    context.addIssue({
      code: "custom",
      path: ["tasks"],
      message: "每个 selected 调度决定必须且只能生成一个 AgentTask",
    });
  }
});
export type AgentDispatchPlan = z.infer<typeof AgentDispatchPlanSchema>;

export const DispatchAttemptSchema = z.object({
  attemptId: z.string().min(1),
  taskId: z.string().min(1),
  sessionId: z.string().min(1),
  attemptNumber: z.number().int().positive(),
  workerId: z.string().min(1),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  outcome: z.enum([
    "completed",
    "degraded",
    "retry_scheduled",
    "dead_lettered",
    "lease_expired",
    "duplicate_suppressed",
  ]),
  errorCode: z.string().min(1).nullable(),
});
export type DispatchAttempt = z.infer<typeof DispatchAttemptSchema>;

export const DeadLetterRecordSchema = z.object({
  deadLetterId: z.string().min(1),
  taskId: z.string().min(1),
  sessionId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  reasonCode: z.string().min(1),
  attempts: z.number().int().positive(),
  createdAt: z.string().datetime(),
});
export type DeadLetterRecord = z.infer<typeof DeadLetterRecordSchema>;

export const AgentPromptReferenceSchema = z.object({
  refId: z.string().min(1),
  source: z.string().min(1),
  version: z.string().min(1),
  content: z.string().min(1),
});
export type AgentPromptReference = z.infer<typeof AgentPromptReferenceSchema>;

export const AgentContextLayerSchema = z.enum([
  "fixed",
  "state",
  "retrieved",
  "evidence",
  "privateMemory",
  "transient",
]);
export type AgentContextLayer = z.infer<typeof AgentContextLayerSchema>;

export const ContextSourceRefSchema = z.object({
  refId: z.string().min(1),
  kind: z.string().min(1),
  source: z.string().min(1),
  version: z.string().min(1),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();
export type ContextSourceRef = z.infer<typeof ContextSourceRefSchema>;

export const AgentContextItemSchema = z.object({
  itemId: z.string().min(1),
  layer: AgentContextLayerSchema,
  content: z.string().min(1),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  sourceRefs: z.array(ContextSourceRefSchema).min(1),
  audience: ResourceAudienceSchema,
  priority: z.number().int(),
  stableOrderKey: z.string().min(1),
}).strict();
export type AgentContextItem = z.infer<typeof AgentContextItemSchema>;

export const AgentPromptContextSchema = z.object({
  fixed: z.array(AgentContextItemSchema),
  state: z.array(AgentContextItemSchema),
  retrieved: z.array(AgentContextItemSchema),
  evidence: z.array(AgentContextItemSchema),
  privateMemory: z.array(AgentContextItemSchema),
  transient: z.array(AgentContextItemSchema),
}).strict();
export type AgentPromptContext = z.infer<typeof AgentPromptContextSchema>;

export const ContextManifestItemSchema = z.object({
  itemId: z.string().min(1),
  layer: AgentContextLayerSchema,
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  sourceRefs: z.array(ContextSourceRefSchema),
  characters: z.number().int().nonnegative(),
}).strict();
export type ContextManifestItem = z.infer<typeof ContextManifestItemSchema>;

const ContextManifestLayersSchema = z.object({
  fixed: z.array(ContextManifestItemSchema),
  state: z.array(ContextManifestItemSchema),
  retrieved: z.array(ContextManifestItemSchema),
  evidence: z.array(ContextManifestItemSchema),
  privateMemory: z.array(ContextManifestItemSchema),
  transient: z.array(ContextManifestItemSchema),
}).strict();

export const ContextManifestSchema = z.object({
  contextSchemaVersion: z.literal(ContextSchemaVersion),
  assemblerVersion: z.literal(ContextAssemblerVersion),
  aclPolicyVersion: z.literal(AccessPolicyVersion),
  retrieverVersion: z.string().min(1),
  corpusVersion: z.string().min(1),
  budgetPolicyVersion: z.literal(ContextBudgetPolicyVersion),
  memoryPolicyVersion: z.literal(RoleMemorySchemaVersion),
  scenarioVersion: z.string().min(1),
  scenarioContentHash: z.string().regex(/^[a-f0-9]{64}$/u).nullable().default(null),
  sessionId: z.string().min(1),
  sessionEpoch: z.string().min(1),
  actorId: z.string().min(1),
  roleId: RoleIdSchema,
  teamId: z.string().min(1),
  stateVersion: z.number().int().nonnegative(),
  queryHash: z.string().regex(/^[a-f0-9]{64}$/u),
  accessSubjectHash: z.string().regex(/^[a-f0-9]{64}$/u),
  contextHash: z.string().regex(/^[a-f0-9]{64}$/u),
  memorySnapshotHash: z.string().regex(/^[a-f0-9]{64}$/u),
  layers: ContextManifestLayersSchema,
  droppedItems: z.array(ContextManifestItemSchema),
  includedCitationRefs: z.array(z.string().min(1)),
  acl: z.object({
    preRejectedCount: z.number().int().nonnegative(),
    postRejectedCount: z.number().int().nonnegative(),
  }).strict(),
  assembledAt: z.string().datetime(),
}).strict();
export type ContextManifest = z.infer<typeof ContextManifestSchema>;

const AgentRunRequestObjectSchema = MessageMetaSchema.extend({
  kind: z.literal("AgentRunRequest"),
  taskId: z.string().min(1),
  agentRunId: z.string().min(1),
  templateRef: AgentTemplateRefSchema,
  instanceRef: AgentInstanceRefSchema,
  role: RoleContractSchema,
  trigger: z.object({
    type: z.string().min(1),
    sourceId: z.string().min(1),
  }),
  stateVersion: z.number().int().nonnegative(),
  access: AccessSubjectSchema,
  context: AgentPromptContextSchema,
  contextManifest: ContextManifestSchema,
  signals: z.record(z.string(), AgentSignalValueSchema),
});
export const AgentRunRequestSchema = z.preprocess((value) => {
  const request = recordOf(value);
  if (!request) return value;
  const role = recordOf(request.role);
  const access = recordOf(request.access);
  const legacy = {
    ...request,
    agentId: role?.agentId,
    sessionEpoch: access?.sessionEpoch,
  };
  return {
    ...request,
    templateRef: request.templateRef ?? legacyTemplateRef(legacy),
    instanceRef: request.instanceRef ?? legacyInstanceRef(legacy),
  };
}, AgentRunRequestObjectSchema);
export type AgentRunRequest = z.infer<typeof AgentRunRequestSchema>;

export const ModelProviderSchema = z.enum([
  "deterministic",
  "deepseek",
  "iflytek_xingchen",
]);
export type ModelProvider = z.infer<typeof ModelProviderSchema>;

export const ModelProviderModeSchema = z.enum(["mock", "live", "unavailable"]);
export type ModelProviderMode = z.infer<typeof ModelProviderModeSchema>;

export const ModelOutputModeSchema = z.enum(["json_object", "json_schema"]);
export type ModelOutputMode = z.infer<typeof ModelOutputModeSchema>;

export const ModelInvocationRequestSchema = z.object({
  invocationId: z.string().min(1),
  profileId: z.string().min(1),
  taskKind: z.string().min(1),
  systemPrompt: z.string().min(1),
  userPrompt: z.string().min(1),
  imageInputs: z.array(ModelInvocationImageInputSchema).max(12).optional(),
  outputContractId: z.string().min(1),
  outputMode: ModelOutputModeSchema,
  temperature: z.number().min(0).max(2),
  maxOutputTokens: z.number().int().positive(),
  timeoutMs: z.number().int().positive(),
}).superRefine((request, context) => {
  if ((request.imageInputs ?? []).reduce(
    (total, item) => total + item.contentBase64.length,
    0,
  ) > 12_000_000) {
    context.addIssue({
      code: "custom",
      path: ["imageInputs"],
      message: "单次模型调用的编码图像总量不得超过 12000000 字符",
    });
  }
});
export type ModelInvocationRequest = z.infer<typeof ModelInvocationRequestSchema>;

export const ModelTokenUsageSchema = z.object({
  input: z.number().int().nonnegative().nullable(),
  output: z.number().int().nonnegative().nullable(),
  total: z.number().int().nonnegative().nullable(),
});
export type ModelTokenUsage = z.infer<typeof ModelTokenUsageSchema>;

export const ModelInvocationTraceSchema = z.object({
  invocationId: z.string().min(1),
  profileId: z.string().min(1),
  provider: ModelProviderSchema,
  mode: ModelProviderModeSchema,
  model: z.string().min(1),
  requestId: z.string().min(1).nullable(),
  status: z.enum(["completed", "failed"]),
  outputMode: ModelOutputModeSchema,
  finishReason: z.string().min(1).nullable(),
  tokenUsage: ModelTokenUsageSchema,
  latencyMs: z.number().nonnegative(),
  attempts: z.number().int().nonnegative(),
  estimatedCostUsd: z.number().nonnegative().nullable(),
  errorCode: z.string().min(1).nullable(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
});
export type ModelInvocationTrace = z.infer<typeof ModelInvocationTraceSchema>;

export const ModelInvocationResultSchema = z.object({
  output: z.unknown(),
  trace: ModelInvocationTraceSchema,
});
export type ModelInvocationResult = z.infer<typeof ModelInvocationResultSchema>;

export const ModelProviderHealthSchema = z.object({
  profileId: z.string().min(1),
  provider: ModelProviderSchema,
  mode: ModelProviderModeSchema,
  configured: z.boolean(),
  available: z.boolean(),
  baseUrl: z.string().url().nullable(),
  models: z.array(z.string().min(1)),
  reason: z.string().min(1).nullable(),
});
export type ModelProviderHealth = z.infer<typeof ModelProviderHealthSchema>;

export const AgentNodeTraceSchema = z.object({
  nodeId: z.string().min(1),
  kind: AgentNodeKindSchema,
  status: z.enum(["success", "failure"]),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  durationMs: z.number().nonnegative(),
  selectedEdgeId: z.string().nullable(),
  errorCode: z.string().nullable(),
});
export type AgentNodeTrace = z.infer<typeof AgentNodeTraceSchema>;

const AgentRunTraceObjectSchema = z.object({
  taskId: z.string().min(1),
  agentRunId: z.string().min(1),
  correlationId: z.string().min(1),
  agentId: z.string().min(1),
  roleId: RoleIdSchema,
  templateRef: AgentTemplateRefSchema,
  instanceRef: AgentInstanceRefSchema,
  experimentObservation: ExperimentObservationRefSchema.nullable().default(null),
  dispatchDecision: AgentDispatchDecisionSchema,
  definitionVersion: z.string().min(1),
  promptVersion: z.string().min(1),
  inputStateVersion: z.number().int().nonnegative(),
  triggerRefs: z.array(z.string()).min(1),
  contextManifest: ContextManifestSchema.nullable().default(null),
  promptHash: z.string().regex(/^[a-f0-9]{64}$/u).nullable().default(null),
  status: z.enum(["completed", "degraded", "failed"]),
  nodes: z.array(AgentNodeTraceSchema).min(1),
  modelCalls: z.number().int().nonnegative(),
  modelInvocations: z.array(ModelInvocationTraceSchema).default([]),
  toolCalls: z.number().int().nonnegative(),
  tokenUsage: z.object({
    input: z.number().int().nonnegative(),
    output: z.number().int().nonnegative(),
  }),
  fallbackUsed: z.boolean(),
  errorCode: z.string().nullable(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  durationMs: z.number().nonnegative(),
});
export const AgentRunTraceSchema = z.preprocess((value) => {
  const trace = recordOf(value);
  if (!trace) return value;
  return {
    ...trace,
    templateRef: trace.templateRef ?? legacyTemplateRef(trace),
    instanceRef: trace.instanceRef ?? legacyInstanceRef(trace),
    experimentObservation: trace.experimentObservation ?? null,
    dispatchDecision: trace.dispatchDecision ?? legacyDispatchDecision(trace),
  };
}, AgentRunTraceObjectSchema);
export type AgentRunTrace = z.infer<typeof AgentRunTraceSchema>;

export const TraceRecordKindSchema = z.enum([
  "world_event",
  "agent_intent",
  "agent_assistance",
  "outbox",
  "dispatch_plan",
  "dispatch_decision",
  "agent_task",
  "dispatch_attempt",
  "agent_run",
  "agent_node",
  "model_invocation",
  "tool_step",
  "dead_letter",
]);
export type TraceRecordKind = z.infer<typeof TraceRecordKindSchema>;

export const TraceRecordLaneSchema = z.enum(["world", "execution"]);
export type TraceRecordLane = z.infer<typeof TraceRecordLaneSchema>;

export const TraceRecordStatusSchema = z.enum([
  "pending",
  "queued",
  "running",
  "completed",
  "delivered",
  "degraded",
  "failed",
  "retry_scheduled",
  "dead_lettered",
  "skipped",
]);
export type TraceRecordStatus = z.infer<typeof TraceRecordStatusSchema>;

export const TraceDetailSchema = z.object({
  label: z.string().min(1).max(80),
  value: z.string().min(1).max(2_000),
  valueKind: z.enum(["text", "code", "hash", "status"]),
}).strict();
export type TraceDetail = z.infer<typeof TraceDetailSchema>;

export const TraceRecordSchema = z.object({
  traceId: z.string().min(1),
  kind: TraceRecordKindSchema,
  lane: TraceRecordLaneSchema,
  sourceId: z.string().min(1),
  timestamp: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  status: TraceRecordStatusSchema,
  title: z.string().min(1).max(240),
  summary: z.string().min(1).max(2_000),
  correlationId: z.string().min(1).nullable(),
  stateVersion: z.number().int().nonnegative().nullable(),
  actorId: z.string().min(1).nullable(),
  roleId: RoleIdSchema.nullable(),
  agentId: z.string().min(1).nullable(),
  eventType: EventTypeSchema.nullable(),
  eventId: z.string().min(1).nullable(),
  outboxId: z.string().min(1).nullable(),
  taskId: z.string().min(1).nullable(),
  agentRunId: z.string().min(1).nullable(),
  nodeId: z.string().min(1).nullable(),
  invocationId: z.string().min(1).nullable(),
  toolTaskId: z.string().min(1).nullable(),
  stepId: z.string().min(1).nullable(),
  errorCode: z.string().min(1).nullable(),
  durationMs: z.number().nonnegative().nullable(),
  tokenTotal: z.number().int().nonnegative().nullable(),
  attempts: z.number().int().nonnegative().nullable(),
  provider: z.string().min(1).nullable(),
  providerMode: z.string().min(1).nullable(),
  model: z.string().min(1).nullable(),
  details: z.array(TraceDetailSchema).max(40),
}).strict();
export type TraceRecord = z.infer<typeof TraceRecordSchema>;

export const TraceLinkRelationSchema = z.enum([
  "emits",
  "dispatches",
  "plans",
  "selects",
  "filters",
  "attempts",
  "executes",
  "contains",
  "invokes",
  "produces",
  "relates",
]);
export type TraceLinkRelation = z.infer<typeof TraceLinkRelationSchema>;

export const TraceLinkSchema = z.object({
  linkId: z.string().min(1),
  fromTraceId: z.string().min(1),
  toTraceId: z.string().min(1),
  relation: TraceLinkRelationSchema,
}).strict();
export type TraceLink = z.infer<typeof TraceLinkSchema>;

export const SessionTraceSummarySchema = z.object({
  worldRecordCount: z.number().int().nonnegative(),
  executionRecordCount: z.number().int().nonnegative(),
  eventCount: z.number().int().nonnegative(),
  outboxCount: z.number().int().nonnegative(),
  taskCount: z.number().int().nonnegative(),
  runCount: z.number().int().nonnegative(),
  modelInvocationCount: z.number().int().nonnegative(),
  toolStepCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  degradedCount: z.number().int().nonnegative(),
  pendingCount: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
}).strict();
export type SessionTraceSummary = z.infer<typeof SessionTraceSummarySchema>;

export const SessionTraceProjectionSchema = z.object({
  sessionId: z.string().min(1),
  generatedAt: z.string().datetime(),
  stateVersion: z.number().int().nonnegative(),
  records: z.array(TraceRecordSchema),
  links: z.array(TraceLinkSchema),
  summary: SessionTraceSummarySchema,
}).strict();
export type SessionTraceProjection = z.infer<
  typeof SessionTraceProjectionSchema
>;

export const SessionTracePageSchemaVersion = "session-trace-page.v1" as const;
export const SessionTracePageSchema = z.object({
  schemaVersion: z.literal(SessionTracePageSchemaVersion),
  sessionId: z.string().min(1),
  generatedAt: z.string().datetime(),
  stateVersion: z.number().int().nonnegative(),
  records: z.array(TraceRecordSchema).max(200),
  links: z.array(TraceLinkSchema),
  nextCursor: z.string().min(1).max(4_096).nullable(),
  hasMore: z.boolean(),
  watermark: z.string().min(1).max(256),
}).strict();
export type SessionTracePage = z.infer<typeof SessionTracePageSchema>;

export const AgentRunResultSchema = z.object({
  intent: ExecutableAgentIntentSchema.nullable(),
  roleResponseIntent: RoleResponseIntentSchema.nullable().default(null),
  assistanceProposal: AgentAssistanceProposalSchema.nullable().default(null),
  trace: AgentRunTraceSchema,
  signals: z.record(z.string(), AgentSignalValueSchema),
});
export type AgentRunResult = z.infer<typeof AgentRunResultSchema>;

export const ScenarioNodeSchema = z.object({
  nodeId: z.string().min(1),
  title: z.string().min(1),
  objective: z.string().min(1),
  order: z.number().int().nonnegative(),
  status: z.enum(["locked", "available", "active", "completed"]),
  requiredEvidenceKinds: z.array(z.string()),
  completionEvent: EventTypeSchema,
});
export type ScenarioNode = z.infer<typeof ScenarioNodeSchema>;

export const MaterialSchema = z.object({
  materialId: z.string().min(1),
  title: z.string().min(1),
  mediaType: z.enum(["text", "audio", "image", "document", "video"]),
  source: z.string().min(1),
  sourceRef: z.string().min(1),
  version: z.string().min(1),
  copyrightStatus: z.enum(["unknown", "authorized", "restricted", "disputed"]),
  visibleToRoles: z.array(RoleIdSchema),
  origin: z.enum(["scenario", "upload"]).optional(),
  mimeType: z.string().min(1).optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
  uploadedBy: z.string().min(1).optional(),
  createdAt: z.string().datetime().optional(),
});
export type Material = z.infer<typeof MaterialSchema>;

export const AdapterCapabilitySchema = z.enum([
  "xingchen_agent",
  "rag",
  "asr",
  "ocr",
  "image_understanding",
  "text_moderation",
  "image_moderation",
  "video_moderation",
]);
export type AdapterCapability = z.infer<typeof AdapterCapabilitySchema>;

export const MediaProcessingOutputSchema = z.object({
  outputId: z.string().min(1),
  capability: AdapterCapabilitySchema,
  provider: z.string().min(1),
  providerMode: z.enum(["mock", "live", "manual"]),
  summary: z.string().min(1).max(2_000),
  extracted: z.record(z.string(), z.unknown()),
  sourceRef: z.string().min(1),
  confidence: z.number().min(0).max(1),
  trust: z.enum(["observation_only", "manual_unverified"]),
  verificationStatus: z.enum(["unverified", "pending_review", "verified", "disputed"]),
  providerRequestId: z.string().min(1).nullable(),
  createdAt: z.string().datetime(),
}).strict();
export type MediaProcessingOutput = z.infer<typeof MediaProcessingOutputSchema>;

export const GovernanceDomainSchema = z.enum([
  "fact",
  "copyright",
  "content_safety",
  "platform_rule",
]);
export type GovernanceDomain = z.infer<typeof GovernanceDomainSchema>;

export const GovernanceNodeSnapshotSchema = z.object({
  nodeId: z.string().min(1),
  nodeType: z.literal("rule_tool_model"),
  definitionVersion: z.string().min(1),
  promptVersion: z.string().min(1),
  rulesetId: z.string().min(1),
  knowledgeChunkIds: z.array(z.string().min(1)),
}).strict();
export type GovernanceNodeSnapshot = z.infer<
  typeof GovernanceNodeSnapshotSchema
>;

export const GovernanceRecommendationSchema = z.enum([
  "allow",
  "review",
  "revise",
  "block",
  "unavailable",
]);
export type GovernanceRecommendation = z.infer<
  typeof GovernanceRecommendationSchema
>;

export const GovernanceModelDecisionSchema = z.object({
  recommendation: GovernanceRecommendationSchema.exclude(["unavailable"]),
  summary: z.string().min(1).max(1_200),
  riskLabels: z.array(z.string().min(1)),
  citationChunkIds: z.array(z.string().min(1)),
}).strict();
export type GovernanceModelDecision = z.infer<
  typeof GovernanceModelDecisionSchema
>;

export const GovernanceKnowledgeCitationSchema = z.object({
  chunkId: z.string().min(1),
  source: z.string().min(1),
  version: z.string().min(1),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();
export type GovernanceKnowledgeCitation = z.infer<
  typeof GovernanceKnowledgeCitationSchema
>;

export const GovernanceRuleEvaluationSchema = z.object({
  ruleId: z.string().min(1),
  outcome: z.enum(["passed", "flagged"]),
  recommendation: GovernanceRecommendationSchema,
  summary: z.string().min(1).max(1_200),
  evidenceRefs: z.array(z.string().min(1)),
}).strict();
export type GovernanceRuleEvaluation = z.infer<
  typeof GovernanceRuleEvaluationSchema
>;

export const GovernanceExecutionTraceSchema = z.object({
  definitionHash: z.string().regex(/^[a-f0-9]{64}$/u),
  promptHash: z.string().regex(/^[a-f0-9]{64}$/u),
  rulesetHash: z.string().regex(/^[a-f0-9]{64}$/u),
  knowledgeSnapshotHash: z.string().regex(/^[a-f0-9]{64}$/u),
  executionInputHash: z.string().regex(/^[a-f0-9]{64}$/u),
  toolOutputHash: z.string().regex(/^[a-f0-9]{64}$/u),
  modelOutputHash: z.string().regex(/^[a-f0-9]{64}$/u),
  modelProfileId: z.string().min(1),
  modelProvider: z.string().min(1),
  modelMode: z.enum(["mock", "live"]),
  modelName: z.string().min(1),
  modelRequestId: z.string().min(1).nullable(),
  knowledgeCitations: z.array(GovernanceKnowledgeCitationSchema),
  ruleEvaluations: z.array(GovernanceRuleEvaluationSchema).min(1),
}).strict();
export type GovernanceExecutionTrace = z.infer<
  typeof GovernanceExecutionTraceSchema
>;

export const GovernanceSeveritySchema = z.enum([
  "info",
  "warning",
  "high",
  "blocking",
]);
export type GovernanceSeverity = z.infer<typeof GovernanceSeveritySchema>;

export const GovernanceFindingSchema = z.object({
  findingId: z.string().min(1),
  reviewId: z.string().min(1),
  arbitrationRevision: z.number().int().positive(),
  domain: GovernanceDomainSchema,
  node: GovernanceNodeSnapshotSchema,
  executionTrace: GovernanceExecutionTraceSchema.nullable(),
  toolRecommendation: GovernanceRecommendationSchema,
  modelRecommendation: GovernanceRecommendationSchema,
  branchPriority: z.number().int(),
  materialId: z.string().min(1),
  materialVersion: z.string().min(1),
  mediaTaskId: z.string().min(1),
  stepId: z.string().min(1),
  capability: AdapterCapabilitySchema,
  executionStatus: z.enum([
    "completed",
    "degraded",
    "failed",
    "manual",
  ]),
  provider: z.string().min(1),
  providerMode: z.enum(["mock", "live", "manual"]),
  recommendation: GovernanceRecommendationSchema,
  severity: GovernanceSeveritySchema,
  summary: z.string().min(1).max(2_000),
  riskLabels: z.array(z.string().min(1)),
  confidence: z.number().min(0).max(1),
  sourceRef: z.string().min(1),
  providerRequestId: z.string().min(1).nullable(),
  errorCode: z.string().min(1).nullable(),
  verificationStatus: z.enum([
    "pending_teacher",
    "teacher_approved",
    "teacher_rejected",
  ]),
  createdAt: z.string().datetime(),
  audience: ResourceAudienceSchema,
}).strict();
export type GovernanceFinding = z.infer<typeof GovernanceFindingSchema>;

export const GovernanceVerdictSchema = z.enum([
  "pending",
  "allow",
  "review",
  "revise",
  "block",
  "degraded",
]);
export type GovernanceVerdict = z.infer<typeof GovernanceVerdictSchema>;

export const GovernanceReleasableVerdictSchema = z.enum([
  "allow",
  "review",
  "revise",
]);
export type GovernanceReleasableVerdict = z.infer<
  typeof GovernanceReleasableVerdictSchema
>;

export function isGovernanceVerdictReleasable(
  verdict: GovernanceVerdict,
): verdict is GovernanceReleasableVerdict {
  return GovernanceReleasableVerdictSchema.safeParse(verdict).success;
}

export const GovernanceReviewSchema = z.object({
  reviewId: z.string().min(1),
  sessionId: z.string().min(1),
  sessionEpoch: z.string().min(1),
  materialId: z.string().min(1),
  materialVersion: z.string().min(1),
  inputContentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  mediaTaskId: z.string().min(1),
  requestId: z.string().min(1),
  requestedBy: z.string().min(1),
  requestedAt: z.string().datetime(),
  status: z.enum([
    "running",
    "awaiting_teacher",
    "approved",
    "rejected",
  ]),
  arbitrationRevision: z.number().int().nonnegative(),
  policyVersion: z.string().min(1),
  verdict: GovernanceVerdictSchema,
  conflict: z.boolean(),
  branchDomains: z.array(GovernanceDomainSchema).min(2),
  latestFindingIds: z.array(z.string().min(1)),
  winningFindingId: z.string().min(1).nullable(),
  findingSetHash: z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
  decisionHash: z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
  arbitratedAt: z.string().datetime().nullable(),
  reviewDecision: z.enum(["approve", "reject"]).nullable(),
  reviewedBy: z.string().min(1).nullable(),
  reviewedAt: z.string().datetime().nullable(),
  reviewNote: z.string().min(1).max(1_200).nullable(),
  audience: ResourceAudienceSchema,
}).strict().superRefine((review, context) => {
  if (
    review.status === "approved"
    && !isGovernanceVerdictReleasable(review.verdict)
  ) {
    context.addIssue({
      code: "custom",
      path: ["status"],
      message: "阻断或降级治理结论不能批准放行",
    });
  }
});
export type GovernanceReview = z.infer<typeof GovernanceReviewSchema>;

export const MediaProcessingStepStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "manually_completed",
]);
export type MediaProcessingStepStatus = z.infer<typeof MediaProcessingStepStatusSchema>;

export const MediaProcessingStepSchema = z.object({
  stepId: z.string().min(1),
  capability: AdapterCapabilitySchema,
  governanceDomain: GovernanceDomainSchema.nullable().default(null),
  governanceNode: GovernanceNodeSnapshotSchema.nullable().default(null),
  branchPriority: z.number().int().nullable().default(null),
  timeoutMs: z.number().int().positive().max(300_000).default(120_000),
  requestedProviderMode: z.enum(["mock", "live"]).nullable().default(null),
  effectiveProviderMode: z.enum(["mock", "live", "manual"]).nullable().default(null),
  status: MediaProcessingStepStatusSchema,
  attempts: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  idempotencyKey: z.string().min(1),
  output: MediaProcessingOutputSchema.nullable(),
  lastErrorCode: z.string().min(1).nullable(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
}).strict();
export type MediaProcessingStep = z.infer<typeof MediaProcessingStepSchema>;

export const MediaProcessingTaskStatusSchema = z.enum([
  "queued",
  "running",
  "partially_succeeded",
  "succeeded",
  "failed",
]);
export type MediaProcessingTaskStatus = z.infer<typeof MediaProcessingTaskStatusSchema>;

export const MediaProcessingTaskSchema = z.object({
  taskId: z.string().min(1),
  sessionId: z.string().min(1),
  sessionEpoch: z.string().min(1),
  materialId: z.string().min(1),
  materialVersion: z.string().min(1),
  inputRef: z.string().min(1),
  inputContentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  planId: z.string().min(1),
  governanceReviewId: z.string().min(1).nullable().default(null),
  requestId: z.string().min(1),
  status: MediaProcessingTaskStatusSchema,
  steps: z.array(MediaProcessingStepSchema).min(1),
  requestedBy: z.string().min(1),
  requestedAt: z.string().datetime(),
  idempotencyKey: z.string().min(1),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime(),
  audience: ResourceAudienceSchema,
}).strict();
export type MediaProcessingTask = z.infer<typeof MediaProcessingTaskSchema>;

export const ProductionArtifactKindSchema = z.enum([
  "interview_record",
  "article",
  "short_video_plan",
  "channel_variant",
]);
export type ProductionArtifactKind = z.infer<typeof ProductionArtifactKindSchema>;

export const ArtifactCitationTrustSchema = z.enum([
  "verified_world_fact",
  "source_material",
  "machine_observation",
  "manual_unverified",
  "reviewed_reference",
  "disputed",
]);
export type ArtifactCitationTrust = z.infer<typeof ArtifactCitationTrustSchema>;

export const ArtifactCitationSchema = z.object({
  citationId: z.string().min(1),
  sourceKind: z.enum([
    "material",
    "fact",
    "observation",
    "processing_output",
    "knowledge",
  ]),
  sourceId: z.string().min(1),
  label: z.string().min(1),
  version: z.string().min(1),
  locator: z.string().min(1).max(300).nullable(),
  trust: ArtifactCitationTrustSchema,
}).strict();
export type ArtifactCitation = z.infer<typeof ArtifactCitationSchema>;

export const ArtifactSectionSchema = z.object({
  sectionId: z.string().min(1),
  label: z.string().min(1),
  content: z.string().max(20_000),
}).strict();
export type ArtifactSection = z.infer<typeof ArtifactSectionSchema>;

export const ProductionArtifactSchema = z.object({
  artifactId: z.string().min(1),
  templateId: z.string().min(1),
  creationRequestId: z.string().min(1),
  kind: ProductionArtifactKindSchema,
  title: z.string().min(1).max(240),
  channel: z.string().min(1).max(120).nullable(),
  ownerActorId: z.string().min(1),
  ownerRoleId: RoleIdSchema,
  teamId: z.string().min(1),
  status: z.enum(["draft", "submitted"]),
  latestRevisionId: z.string().min(1),
  revisionCount: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  audience: ResourceAudienceSchema,
}).strict();
export type ProductionArtifact = z.infer<typeof ProductionArtifactSchema>;

export const ArtifactRevisionSchema = z.object({
  revisionId: z.string().min(1),
  artifactId: z.string().min(1),
  revisionNumber: z.number().int().positive(),
  previousRevisionId: z.string().min(1).nullable(),
  title: z.string().min(1).max(240),
  summary: z.string().min(1).max(1_200),
  sections: z.array(ArtifactSectionSchema).min(1),
  citations: z.array(ArtifactCitationSchema),
  revisionNote: z.string().min(1).max(600),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  authorActorId: z.string().min(1),
  requestId: z.string().min(1),
  createdAt: z.string().datetime(),
  audience: ResourceAudienceSchema,
}).strict();
export type ArtifactRevision = z.infer<typeof ArtifactRevisionSchema>;

export const ProductionSubmissionSchema = z.object({
  submissionId: z.string().min(1),
  artifactId: z.string().min(1),
  revisionId: z.string().min(1),
  revisionNumber: z.number().int().positive(),
  evidenceRefs: z.array(z.string().min(1)),
  citationIds: z.array(z.string().min(1)),
  submittedBy: z.string().min(1),
  requestId: z.string().min(1),
  submittedAt: z.string().datetime(),
}).strict();
export type ProductionSubmission = z.infer<typeof ProductionSubmissionSchema>;

export const ProductionArtifactTemplateSchema = z.object({
  templateId: z.string().min(1),
  kind: ProductionArtifactKindSchema,
  label: z.string().min(1),
  description: z.string().min(1),
  channel: z.string().min(1).nullable(),
  allowedRoleIds: z.array(RoleIdSchema).min(1),
  minimumRevisions: z.number().int().min(2).max(20),
  minimumCitations: z.number().int().positive().max(30),
  requiresVerifiedFact: z.boolean(),
  sections: z.array(z.object({
    sectionId: z.string().min(1),
    label: z.string().min(1),
    required: z.boolean(),
    maxLength: z.number().int().positive().max(20_000),
    starterContent: z.string().max(20_000),
  }).strict()).min(1),
}).strict();
export type ProductionArtifactTemplate = z.infer<typeof ProductionArtifactTemplateSchema>;

export const MediaProcessingPlanSchema = z.object({
  planId: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1),
  allowedMediaTypes: z.array(z.enum(["text", "audio", "image", "document", "video"])).min(1),
  capabilities: z.array(AdapterCapabilitySchema).min(1),
  maxAttemptsPerStep: z.number().int().positive().max(10),
  minimumSuccessfulSteps: z.number().int().positive(),
}).strict();
export type MediaProcessingPlan = z.infer<typeof MediaProcessingPlanSchema>;

const GovernanceCapabilityByMediaTypeSchema = z.object({
  text: AdapterCapabilitySchema,
  audio: AdapterCapabilitySchema,
  image: AdapterCapabilitySchema,
  document: AdapterCapabilitySchema,
  video: AdapterCapabilitySchema,
}).strict();

export const GovernancePlanSchema = z.object({
  planId: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1),
  teacherApprovalRequired: z.literal(true),
  maxAttemptsPerBranch: z.number().int().positive().max(10),
  timeoutMsPerBranch: z.number().int().positive().max(300_000),
  branches: z.array(z.object({
    domain: GovernanceDomainSchema,
    label: z.string().min(1),
    priority: z.number().int(),
    node: GovernanceNodeSnapshotSchema,
    capabilityByMediaType: GovernanceCapabilityByMediaTypeSchema,
  }).strict()).min(2),
}).strict().superRefine((plan, context) => {
  const domains = new Set<GovernanceDomain>();
  for (const branch of plan.branches) {
    if (domains.has(branch.domain)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["branches"],
        message: `治理分支领域重复：${branch.domain}`,
      });
    }
    domains.add(branch.domain);
  }
});
export type GovernancePlan = z.infer<typeof GovernancePlanSchema>;

export const ProductionConfigSchema = z.object({
  artifactTemplates: z.array(ProductionArtifactTemplateSchema).min(1),
  processingPlans: z.array(MediaProcessingPlanSchema).min(1),
  governancePlan: GovernancePlanSchema.optional(),
  maximumUploadBytes: z.number().int().positive(),
  allowedUploadMimeTypes: z.array(z.string().min(1)).min(1),
}).strict();
export type ProductionConfig = z.infer<typeof ProductionConfigSchema>;

export const ArtifactCitationInputSchema = z.object({
  sourceKind: z.enum([
    "material",
    "fact",
    "observation",
    "processing_output",
    "knowledge",
  ]),
  sourceId: z.string().min(1),
  locator: z.string().min(1).max(300).nullable().default(null),
}).strict();
export type ArtifactCitationInput = z.infer<typeof ArtifactCitationInputSchema>;

export const ArtifactSectionInputSchema = z.object({
  sectionId: z.string().min(1),
  content: z.string().max(20_000),
}).strict();
export type ArtifactSectionInput = z.infer<typeof ArtifactSectionInputSchema>;

const ArtifactRevisionInputFields = {
  title: z.string().min(1).max(240),
  summary: z.string().min(1).max(1_200),
  sections: z.array(ArtifactSectionInputSchema).min(1),
  citations: z.array(ArtifactCitationInputSchema),
  revisionNote: z.string().min(1).max(600),
};

export const RequestMediaProcessingPayloadSchema = z.object({
  materialId: z.string().min(1),
  planId: z.string().min(1),
  requestId: z.string().min(1),
}).strict();
export type RequestMediaProcessingPayload = z.infer<typeof RequestMediaProcessingPayloadSchema>;

export const RequestGovernanceReviewPayloadSchema = z.object({
  materialId: z.string().min(1),
  requestId: z.string().min(1),
}).strict();
export type RequestGovernanceReviewPayload = z.infer<
  typeof RequestGovernanceReviewPayloadSchema
>;

export const RetryMediaProcessingPayloadSchema = z.object({
  taskId: z.string().min(1),
  requestId: z.string().min(1),
}).strict();
export type RetryMediaProcessingPayload = z.infer<typeof RetryMediaProcessingPayloadSchema>;

export const SupplyMediaProcessingResultPayloadSchema = z.object({
  taskId: z.string().min(1),
  stepId: z.string().min(1),
  summary: z.string().min(1).max(2_000),
  requestId: z.string().min(1),
}).strict();
export type SupplyMediaProcessingResultPayload = z.infer<typeof SupplyMediaProcessingResultPayloadSchema>;

export const ReviewGovernancePayloadSchema = z.object({
  reviewId: z.string().min(1),
  expectedArbitrationRevision: z.number().int().positive(),
  expectedDecisionHash: z.string().regex(/^[a-f0-9]{64}$/u),
  decision: z.enum(["approve", "reject"]),
  reviewNote: z.string().min(1).max(1_200),
  requestId: z.string().min(1),
}).strict();
export type ReviewGovernancePayload = z.infer<
  typeof ReviewGovernancePayloadSchema
>;

export const CreateProductionArtifactPayloadSchema = z.object({
  templateId: z.string().min(1),
  requestId: z.string().min(1),
  ...ArtifactRevisionInputFields,
}).strict();
export type CreateProductionArtifactPayload = z.infer<typeof CreateProductionArtifactPayloadSchema>;

export const SaveArtifactRevisionPayloadSchema = z.object({
  artifactId: z.string().min(1),
  expectedRevisionNumber: z.number().int().positive(),
  requestId: z.string().min(1),
  ...ArtifactRevisionInputFields,
}).strict();
export type SaveArtifactRevisionPayload = z.infer<typeof SaveArtifactRevisionPayloadSchema>;

export const SubmitForReviewPayloadSchema = z.object({
  artifactId: z.string().min(1),
  revisionId: z.string().min(1),
  requestId: z.string().min(1),
}).strict();
export type SubmitForReviewPayload = z.infer<typeof SubmitForReviewPayloadSchema>;

export const RubricCriterionSchema = z.object({
  criterionId: z.string().min(1),
  label: z.string().min(1),
  weight: z.number().positive(),
  rule: z.string().min(1),
  evaluation: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("evidence_action"),
      action: z.string().min(1),
    }).strict(),
    z.object({
      kind: z.literal("event_exists"),
      eventType: EventTypeSchema,
    }).strict(),
    z.object({
      kind: z.literal("evidence_count"),
      minimum: z.number().int().positive(),
    }).strict(),
  ]),
}).strict();
export type RubricCriterion = z.infer<typeof RubricCriterionSchema>;

export const WorldFactSchema = z.object({
  factId: z.string().min(1),
  domain: z.string().min(1),
  statement: z.string().min(1),
  status: z.enum(["unverified", "verified", "disputed", "superseded"]),
  sourceRefs: z.array(z.string()),
  version: z.string().min(1),
  visibility: VisibilityScopeSchema,
  audience: ResourceAudienceSchema.optional(),
});
export type WorldFact = z.infer<typeof WorldFactSchema>;

export const EvidenceSchema = z.object({
  evidenceId: z.string().min(1),
  sessionId: z.string().min(1),
  nodeId: z.string().min(1),
  actorId: z.string().min(1),
  action: z.string().min(1),
  basis: z.string().min(1),
  materialRefs: z.array(z.string()),
  eventRefs: z.array(z.string()),
  observationRefs: z.array(z.string()),
  artifactRevisionRefs: z.array(z.string().min(1)).default([]),
  processingTaskRefs: z.array(z.string().min(1)).default([]),
  createdAt: z.string().datetime(),
  visibility: z.array(VisibilityScopeSchema),
  audience: ResourceAudienceSchema.optional(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const DirectorDifficultySchema = z.enum([
  "supportive",
  "standard",
  "challenging",
]);
export type DirectorDifficulty = z.infer<typeof DirectorDifficultySchema>;

export const TeachingStrategySchema = z.enum([
  "no_intervention",
  "observe_more",
  "procedural_hint",
  "socratic_prompt",
  "scaffold",
  "challenge",
  "teacher_gate",
]);
export type TeachingStrategy = z.infer<typeof TeachingStrategySchema>;

export const DirectorRouteKindSchema = z.enum([
  "scaffold",
  "challenge",
  "recovery",
]);
export type DirectorRouteKind = z.infer<typeof DirectorRouteKindSchema>;

export const TeachingDirectiveSchema = z.object({
  directiveId: z.string().min(1),
  strategy: TeachingStrategySchema,
  reasonCode: z.string().min(1),
  rationaleSummary: z.string().min(1).max(800),
  targetCompetency: z.string().min(1),
  recommendedDifficulty: DirectorDifficultySchema,
  targetRoleIds: z.array(RoleIdSchema),
  triggerEventIds: z.array(z.string().min(1)).min(1),
  evidenceRefs: z.array(z.string().min(1)),
  confidence: z.number().min(0).max(1),
  handoffToSceneDirector: z.boolean(),
  proposedBy: z.string().min(1),
  proposedAt: z.string().datetime(),
}).strict();
export type TeachingDirective = z.infer<typeof TeachingDirectiveSchema>;

export const SceneDirectorDecisionSchema = z.object({
  decisionId: z.string().min(1),
  outcome: z.enum(["candidate", "no_op", "fallback"]),
  reasonCode: z.string().min(1),
  rationaleSummary: z.string().min(1).max(800),
  routeId: z.string().min(1).nullable(),
  alternativeRouteIds: z.array(z.string().min(1)),
  candidateId: z.string().min(1).nullable(),
  triggerEventIds: z.array(z.string().min(1)).min(1),
  teachingDirectiveId: z.string().min(1).nullable(),
  recoveryOfCandidateId: z.string().min(1).nullable(),
  difficulty: DirectorDifficultySchema,
  cooldownKey: z.string().min(1).nullable(),
  cooldownUntilStateVersion: z.number().int().nonnegative().nullable(),
  confidence: z.number().min(0).max(1),
  proposedBy: z.string().min(1),
  proposedAt: z.string().datetime(),
}).strict();
export type SceneDirectorDecision = z.infer<typeof SceneDirectorDecisionSchema>;

export const ScenarioInterventionSchema = z.object({
  interventionId: z.string().min(1),
  routeId: z.string().min(1),
  kind: DirectorRouteKindSchema,
  title: z.string().min(1),
  studentBrief: z.string().min(1).max(1_200),
  competencyTarget: z.string().min(1),
  difficulty: DirectorDifficultySchema,
  expectedImpact: z.string().min(1),
  affectedRoleIds: z.array(RoleIdSchema).min(1),
  riskLevel: z.enum(["low", "medium", "high"]),
  sourceCandidateId: z.string().min(1),
  recoveryOfCandidateId: z.string().min(1).nullable(),
  approvedBy: z.string().min(1),
  appliedAt: z.string().datetime(),
}).strict();
export type ScenarioIntervention = z.infer<typeof ScenarioInterventionSchema>;

export const CandidateEventSchema = z.object({
  candidateId: z.string().min(1),
  eventType: EventTypeSchema,
  title: z.string().min(1),
  triggerReason: z.string().min(1),
  competencyTarget: z.string().min(1),
  expectedImpact: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  status: z.enum(["pending", "approved", "rejected"]),
  proposedBy: z.string().min(1),
  proposedAt: z.string().datetime(),
  approvalPolicyId: z.string().min(1).default("teacher-world-event-review"),
  candidateKind: z.enum(["policy_event", "director_intervention"]).default("policy_event"),
  routeId: z.string().min(1).nullable().default(null),
  triggerEventIds: z.array(z.string().min(1)).default([]),
  evidenceRefs: z.array(z.string().min(1)).default([]),
  sourceRefs: z.array(z.string().min(1)).default([]),
  affectedRoleIds: z.array(RoleIdSchema).default([]),
  riskLevel: z.enum(["low", "medium", "high"]).default("medium"),
  confidence: z.number().min(0).max(1).default(1),
  difficulty: DirectorDifficultySchema.nullable().default(null),
  cooldownKey: z.string().min(1).nullable().default(null),
  cooldownUntilStateVersion: z.number().int().nonnegative().nullable().default(null),
  alternativeRouteIds: z.array(z.string().min(1)).default([]),
  recoveryOfCandidateId: z.string().min(1).nullable().default(null),
  teachingDirectiveId: z.string().min(1).nullable().default(null),
  directorDecisionId: z.string().min(1).nullable().default(null),
  agentRunId: z.string().min(1).nullable().default(null),
  policyId: z.string().min(1).nullable().default(null),
  proposedStateVersion: z.number().int().nonnegative().default(0),
  preconditionHash: z.string().regex(/^[a-f0-9]{64}$/u).nullable().default(null),
  dedupKey: z.string().min(1).nullable().default(null),
  reviewedBy: z.string().min(1).nullable().default(null),
  reviewedAt: z.string().datetime().nullable().default(null),
  reviewReason: z.string().min(1).nullable().default(null),
  requiresTeacherReview: z.literal(true).default(true),
});
export type CandidateEvent = z.infer<typeof CandidateEventSchema>;

export const AssessmentSchema = z.object({
  assessmentId: z.string().min(1),
  stage: z.enum(["rule", "model", "teacher"]),
  status: z.enum(["proposed", "reviewed", "final"]),
  score: z.number().min(0).max(100),
  rubricVersion: z.string().min(1),
  modelVersion: z.string().nullable(),
  reasons: z.array(z.string()),
  evidenceRefs: z.array(z.string()),
  artifactRevisionRefs: z.array(z.string().min(1)).default([]),
  confidence: z.number().min(0).max(1),
  reviewedBy: z.string().nullable(),
  reviewNote: z.string().nullable(),
});
export type Assessment = z.infer<typeof AssessmentSchema>;

export const EvaluationEvaluatorKindSchema = z.enum([
  "rule",
  "evidence_sufficiency",
  "work_quality",
  "professional_collaboration",
]);
export type EvaluationEvaluatorKind = z.infer<
  typeof EvaluationEvaluatorKindSchema
>;

export const EvaluationDimensionSnapshotSchema = z.object({
  dimensionId: z.string().min(1),
  label: z.string().min(1),
  weight: z.number().positive().max(1),
  maxScore: z.number().positive().max(100),
  rule: z.string().min(1),
  evaluationKind: z.enum([
    "evidence_action",
    "event_exists",
    "evidence_count",
  ]),
}).strict();
export type EvaluationDimensionSnapshot = z.infer<
  typeof EvaluationDimensionSnapshotSchema
>;

export const EvaluationEvidenceRefSnapshotSchema = z.object({
  evidenceId: z.string().min(1),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  audienceHash: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();
export type EvaluationEvidenceRefSnapshot = z.infer<
  typeof EvaluationEvidenceRefSnapshotSchema
>;

export const EvaluationEvidenceBundleSchema = z.object({
  schemaVersion: z.literal(EvaluationSchemaVersion),
  bundleId: z.string().min(1),
  sessionEpoch: z.string().min(1),
  submissionId: z.string().min(1),
  artifactId: z.string().min(1),
  revisionId: z.string().min(1),
  revisionNumber: z.number().int().positive(),
  revisionContentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  rubricId: z.string().min(1),
  rubricVersion: z.string().min(1),
  rubricHash: z.string().regex(/^[a-f0-9]{64}$/u),
  evidenceRefs: z.array(EvaluationEvidenceRefSnapshotSchema).min(1),
  sourceEventRefs: z.array(z.string().min(1)).min(1),
  scenarioReleaseId: z.string().min(1),
  scenarioContentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  createdAt: z.string().datetime(),
  bundleHash: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();
export type EvaluationEvidenceBundle = z.infer<
  typeof EvaluationEvidenceBundleSchema
>;

export const EvaluationCaseSchema = z.object({
  schemaVersion: z.literal(EvaluationSchemaVersion),
  evaluationCaseId: z.string().min(1),
  caseRevision: z.literal(1),
  caseHash: z.string().regex(/^[a-f0-9]{64}$/u),
  sessionEpoch: z.string().min(1),
  submissionId: z.string().min(1),
  artifactId: z.string().min(1),
  revisionId: z.string().min(1),
  evidenceBundleId: z.string().min(1),
  evidenceBundleHash: z.string().regex(/^[a-f0-9]{64}$/u),
  rubricId: z.string().min(1),
  rubricVersion: z.string().min(1),
  rubricHash: z.string().regex(/^[a-f0-9]{64}$/u),
  dimensions: z.array(EvaluationDimensionSnapshotSchema).min(1),
  requiredEvaluatorKinds: z.array(EvaluationEvaluatorKindSchema).length(4),
  definitionVersion: z.string().min(1),
  openedFromMessageId: z.string().min(1),
  openedAt: z.string().datetime(),
}).strict().superRefine((value, context) => {
  if (new Set(value.requiredEvaluatorKinds).size !== value.requiredEvaluatorKinds.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["requiredEvaluatorKinds"],
      message: "评价案件的必需评价器不得重复",
    });
  }
  if (new Set(value.dimensions.map((item) => item.dimensionId)).size !== value.dimensions.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["dimensions"],
      message: "评价案件的量规维度不得重复",
    });
  }
});
export type EvaluationCase = z.infer<typeof EvaluationCaseSchema>;

export const EvaluationDimensionProposalSchema = z.object({
  dimensionId: z.string().min(1),
  scoreSuggestion: z.number().min(0).max(100),
  maxScore: z.number().positive().max(100),
  reason: z.string().min(1).max(1_200),
  evidenceRefs: z.array(z.string().min(1)).min(1),
  confidence: z.number().min(0).max(1),
  riskFlags: z.array(z.string().min(1)),
}).strict();
export type EvaluationDimensionProposal = z.infer<
  typeof EvaluationDimensionProposalSchema
>;

export const EvaluationProposalExecutionSchema = z.object({
  agentRunId: z.string().min(1).nullable(),
  definitionVersion: z.string().min(1),
  promptVersion: z.string().min(1).nullable(),
  rulesetVersion: z.string().min(1).nullable(),
  provider: ModelProviderSchema.nullable(),
  providerMode: ModelProviderModeSchema.nullable(),
  model: z.string().min(1).nullable(),
  providerRequestId: z.string().min(1).nullable(),
  inputHash: z.string().regex(/^[a-f0-9]{64}$/u),
  outputHash: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();
export type EvaluationProposalExecution = z.infer<
  typeof EvaluationProposalExecutionSchema
>;

export const EvaluationProposalSchema = z.object({
  schemaVersion: z.literal(EvaluationSchemaVersion),
  proposalId: z.string().min(1),
  evaluationCaseId: z.string().min(1),
  caseHash: z.string().regex(/^[a-f0-9]{64}$/u),
  evidenceBundleHash: z.string().regex(/^[a-f0-9]{64}$/u),
  evaluatorKind: EvaluationEvaluatorKindSchema,
  status: z.enum(["completed", "unavailable"]),
  dimensions: z.array(EvaluationDimensionProposalSchema),
  overallConfidence: z.number().min(0).max(1),
  errorCode: z.string().min(1).nullable(),
  execution: EvaluationProposalExecutionSchema,
  createdAt: z.string().datetime(),
  proposalHash: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict().superRefine((value, context) => {
  if (value.status === "completed") {
    if (value.dimensions.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dimensions"],
        message: "已完成的评价意见必须包含逐维建议",
      });
    }
    if (value.errorCode !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["errorCode"],
        message: "已完成的评价意见不得携带错误码",
      });
    }
  } else {
    if (value.dimensions.length !== 0 || value.overallConfidence !== 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dimensions"],
        message: "不可用评价不得伪造分数或置信度",
      });
    }
    if (value.errorCode === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["errorCode"],
        message: "不可用评价必须保留安全错误码",
      });
    }
  }
});
export type EvaluationProposal = z.infer<typeof EvaluationProposalSchema>;

export const EvaluationDisputeSchema = z.object({
  disputeId: z.string().min(1),
  dimensionId: z.string().min(1),
  code: z.enum([
    "score_spread",
    "low_confidence",
    "evaluator_unavailable",
  ]),
  severity: z.enum(["warning", "critical"]),
  delta: z.number().nonnegative(),
  threshold: z.number().nonnegative(),
  proposalIds: z.array(z.string().min(1)).min(1),
  summary: z.string().min(1).max(600),
}).strict();
export type EvaluationDispute = z.infer<typeof EvaluationDisputeSchema>;

export const EvaluationCriterionRecommendationSchema = z.object({
  dimensionId: z.string().min(1),
  suggestedScore: z.number().min(0).max(100),
  maxScore: z.number().positive().max(100),
  spread: z.number().nonnegative(),
  sourceProposalIds: z.array(z.string().min(1)).min(1),
  availableEvaluatorKinds: z.array(EvaluationEvaluatorKindSchema).min(1),
  evidenceRefs: z.array(z.string().min(1)).min(1),
}).strict();
export type EvaluationCriterionRecommendation = z.infer<
  typeof EvaluationCriterionRecommendationSchema
>;

export const EvaluationArbitrationSchema = z.object({
  schemaVersion: z.literal(EvaluationSchemaVersion),
  arbitrationId: z.string().min(1),
  evaluationCaseId: z.string().min(1),
  revision: z.number().int().positive(),
  status: z.enum([
    "collecting",
    "ready_for_teacher",
    "disputed",
    "degraded",
  ]),
  requiredEvaluatorKinds: z.array(EvaluationEvaluatorKindSchema).length(4),
  completedEvaluatorKinds: z.array(EvaluationEvaluatorKindSchema),
  unavailableEvaluatorKinds: z.array(EvaluationEvaluatorKindSchema),
  proposalIds: z.array(z.string().min(1)).min(1),
  proposalSetHash: z.string().regex(/^[a-f0-9]{64}$/u),
  recommendations: z.array(EvaluationCriterionRecommendationSchema).min(1),
  disputes: z.array(EvaluationDisputeSchema),
  decisionHash: z.string().regex(/^[a-f0-9]{64}$/u),
  arbitratorVersion: z.string().min(1),
  createdAt: z.string().datetime(),
}).strict();
export type EvaluationArbitration = z.infer<
  typeof EvaluationArbitrationSchema
>;

export const TeacherCriterionDecisionInputSchema = z.object({
  dimensionId: z.string().min(1),
  finalScore: z.number().min(0).max(100),
  publicFeedback: z.string().min(1).max(1_200),
  overrideReason: z.string().min(1).max(1_200).nullable(),
}).strict();
export type TeacherCriterionDecisionInput = z.infer<
  typeof TeacherCriterionDecisionInputSchema
>;

export const TeacherCriterionDecisionSchema =
  TeacherCriterionDecisionInputSchema.extend({
    proposedScore: z.number().min(0).max(100),
    maxScore: z.number().positive().max(100),
    delta: z.number().min(-100).max(100),
    evidenceRefs: z.array(z.string().min(1)).min(1),
  }).strict();
export type TeacherCriterionDecision = z.infer<
  typeof TeacherCriterionDecisionSchema
>;

export const TeacherAssessmentReviewSchema = z.object({
  schemaVersion: z.literal(EvaluationSchemaVersion),
  reviewId: z.string().min(1),
  evaluationCaseId: z.string().min(1),
  arbitrationId: z.string().min(1),
  arbitrationRevision: z.number().int().positive(),
  decisionHash: z.string().regex(/^[a-f0-9]{64}$/u),
  evidenceBundleHash: z.string().regex(/^[a-f0-9]{64}$/u),
  dimensions: z.array(TeacherCriterionDecisionSchema).min(1),
  finalScore: z.number().min(0).max(100),
  publicSummary: z.string().min(1).max(1_500),
  internalNote: z.string().min(1).max(1_500),
  reviewedBy: z.string().min(1),
  reviewedAt: z.string().datetime(),
  requestId: z.string().min(1),
  finalHash: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();
export type TeacherAssessmentReview = z.infer<
  typeof TeacherAssessmentReviewSchema
>;

export const GoldReadinessSchemaVersion = "gold-readiness/1.0.0" as const;

export const GoldCapabilityDomainSchema = z.enum([
  "topic_research",
  "interview_verification",
  "content_production",
  "governance_publication",
  "collaboration_response",
  "reflection_transfer",
]);
export type GoldCapabilityDomain = z.infer<
  typeof GoldCapabilityDomainSchema
>;

export const GoldCapabilityEvidenceRowSchema = z.object({
  rowId: z.string().min(1).max(160),
  domain: GoldCapabilityDomainSchema,
  capabilityLabel: z.string().min(1).max(120),
  observableBehaviors: z.array(z.string().min(1).max(400)).min(1),
  evidenceKinds: z.array(z.string().min(1).max(120)).min(1),
  deterministicRuleRefs: z.array(z.string().min(1).max(240)).min(1),
  semanticEvaluatorKinds: z.array(EvaluationEvaluatorKindSchema).min(1),
  teacherReviewRequired: z.literal(true),
  primaryTemplateIds: z.array(z.string().min(1).max(240)).min(1),
}).strict();
export type GoldCapabilityEvidenceRow = z.infer<
  typeof GoldCapabilityEvidenceRowSchema
>;

export const GoldCapabilityEvidenceMatrixSchema = z.object({
  schemaVersion: z.literal(GoldReadinessSchemaVersion),
  matrixVersion: z.string().min(1).max(120),
  rows: z.array(GoldCapabilityEvidenceRowSchema).length(6),
}).strict().superRefine((matrix, context) => {
  const domains = new Set(matrix.rows.map((row) => row.domain));
  if (domains.size !== GoldCapabilityDomainSchema.options.length) {
    context.addIssue({
      code: "custom",
      path: ["rows"],
      message: "能力证据矩阵必须且只能覆盖六个固定能力域",
    });
  }
  if (new Set(matrix.rows.map((row) => row.rowId)).size !== matrix.rows.length) {
    context.addIssue({
      code: "custom",
      path: ["rows"],
      message: "能力证据矩阵行标识不得重复",
    });
  }
});
export type GoldCapabilityEvidenceMatrix = z.infer<
  typeof GoldCapabilityEvidenceMatrixSchema
>;

export const GoldAblationConditionSchema = z.enum(["A", "B", "C"]);
export type GoldAblationCondition = z.infer<
  typeof GoldAblationConditionSchema
>;

export const GoldAblationArchitectureProfileSchema = z.object({
  conditionCode: GoldAblationConditionSchema,
  experimentCondition: AgentExperimentConditionSchema,
  profileId: z.string().min(1).max(160),
  profileVersion: z.string().min(1).max(120),
  policyHash: z.string().regex(/^[a-f0-9]{64}$/u),
  label: z.string().min(1).max(120),
  responsibilitySeparation: z.enum([
    "single_generalist",
    "role_partitioned",
  ]),
  contextView: z.enum(["shared", "role_private"]),
  schedulingMode: z.enum(["broadcast", "affected_set"]),
  worldWriteGate: z.enum(["none", "authoritative"]),
  teacherFinalAuthority: z.literal(true),
  description: z.string().min(1).max(800),
}).strict();
export type GoldAblationArchitectureProfile = z.infer<
  typeof GoldAblationArchitectureProfileSchema
>;

export const GoldAblationMetricDefinitionSchema = z.object({
  metricId: z.string().min(1).max(160),
  label: z.string().min(1).max(160),
  direction: z.enum(["higher", "lower"]),
  coreMetric: z.boolean(),
  unit: z.string().min(1).max(80),
}).strict();
export type GoldAblationMetricDefinition = z.infer<
  typeof GoldAblationMetricDefinitionSchema
>;

export const GoldAblationProtocolSchema = z.object({
  schemaVersion: z.literal(GoldReadinessSchemaVersion),
  experimentId: z.string().min(1).max(160),
  protocolVersion: z.string().min(1).max(120),
  evidenceLevel: z.enum([
    "deterministic_contract_replay",
    "controlled_runtime",
  ]),
  repetitionsPerCondition: z.number().int().min(10),
  profiles: z.array(GoldAblationArchitectureProfileSchema).length(3),
  controlVariables: z.object({
    scenarioReleaseRef: z.string().min(1).max(240),
    scenarioContentHash: z.string().regex(/^[a-f0-9]{64}$/u),
    caseSuiteRef: z.string().min(1).max(240),
    caseSuiteHash: z.string().regex(/^[a-f0-9]{64}$/u),
    modelProfileRef: z.string().min(1).max(240),
    modelTier: z.string().min(1).max(120),
    knowledgeSnapshotHash: z.string().regex(/^[a-f0-9]{64}$/u),
    toolPolicyHash: z.string().regex(/^[a-f0-9]{64}$/u),
    rubricHash: z.string().regex(/^[a-f0-9]{64}$/u),
    temperature: z.number().min(0).max(2),
    seed: z.number().int(),
  }).strict(),
  controlVariablesHash: z.string().regex(/^[a-f0-9]{64}$/u),
  metricDefinitions: z.array(GoldAblationMetricDefinitionSchema).min(1),
  failurePolicy: z.literal(
    "include_failures_timeouts_and_unavailable_without_score_imputation",
  ),
  blindConditionLabels: z.boolean(),
  claimBoundary: z.string().min(1).max(1_200),
}).strict().superRefine((protocol, context) => {
  const conditions = new Set(
    protocol.profiles.map((profile) => profile.conditionCode),
  );
  if (conditions.size !== GoldAblationConditionSchema.options.length) {
    context.addIssue({
      code: "custom",
      path: ["profiles"],
      message: "消融协议必须且只能包含 A、B、C 三组架构",
    });
  }
  if (
    new Set(protocol.metricDefinitions.map((metric) => metric.metricId)).size
      !== protocol.metricDefinitions.length
  ) {
    context.addIssue({
      code: "custom",
      path: ["metricDefinitions"],
      message: "消融指标标识不得重复",
    });
  }
});
export type GoldAblationProtocol = z.infer<
  typeof GoldAblationProtocolSchema
>;

export const GoldTemplateContributionSchema = z.object({
  templateId: z.string().min(1).max(240),
  selectedCount: z.number().int().nonnegative(),
  filteredCount: z.number().int().nonnegative(),
  modelCalls: z.number().int().nonnegative(),
}).strict();
export type GoldTemplateContribution = z.infer<
  typeof GoldTemplateContributionSchema
>;

export const GoldAblationObservationCountsSchema = z.object({
  selectedTemplates: z.number().int().nonnegative(),
  filteredTemplates: z.number().int().nonnegative(),
  privateReferenceReads: z.number().int().nonnegative().nullable(),
  privateReferenceLeaks: z.number().int().nonnegative().nullable(),
  unauthorizedFormalWriteAttempts: z.number().int().nonnegative().nullable(),
  unauthorizedFormalWritesCommitted: z.number().int().nonnegative().nullable(),
  authoritativeFactConflictAttempts: z.number().int().nonnegative().nullable(),
  authoritativeFactConflictsCommitted: z.number().int().nonnegative().nullable(),
  requiredEvidenceItems: z.number().int().nonnegative().nullable(),
  coveredEvidenceItems: z.number().int().nonnegative().nullable(),
  modelCalls: z.number().int().nonnegative(),
  unrelatedModelCalls: z.number().int().nonnegative().nullable(),
  teacherDimensions: z.number().int().nonnegative().nullable(),
  teacherEditedDimensions: z.number().int().nonnegative().nullable(),
}).strict().superRefine((counts, context) => {
  const boundedPairs = [
    [
      "privateReferenceLeaks",
      counts.privateReferenceLeaks,
      counts.privateReferenceReads,
    ],
    [
      "unauthorizedFormalWritesCommitted",
      counts.unauthorizedFormalWritesCommitted,
      counts.unauthorizedFormalWriteAttempts,
    ],
    [
      "authoritativeFactConflictsCommitted",
      counts.authoritativeFactConflictsCommitted,
      counts.authoritativeFactConflictAttempts,
    ],
    [
      "coveredEvidenceItems",
      counts.coveredEvidenceItems,
      counts.requiredEvidenceItems,
    ],
    [
      "unrelatedModelCalls",
      counts.unrelatedModelCalls,
      counts.modelCalls,
    ],
    [
      "teacherEditedDimensions",
      counts.teacherEditedDimensions,
      counts.teacherDimensions,
    ],
  ] as const;
  for (const [field, numerator, denominator] of boundedPairs) {
    if (
      numerator !== null
      && denominator !== null
      && numerator > denominator
    ) {
      context.addIssue({
        code: "custom",
        path: [field],
        message: `${field} 不得大于对应总量`,
      });
    }
  }
});
export type GoldAblationObservationCounts = z.infer<
  typeof GoldAblationObservationCountsSchema
>;

export const GoldAblationRunObservationSchema = z.object({
  schemaVersion: z.literal(GoldReadinessSchemaVersion),
  observationId: z.string().min(1).max(320),
  observationRef: ExperimentObservationRefSchema,
  conditionCode: GoldAblationConditionSchema,
  architecturePolicyHash: z.string().regex(/^[a-f0-9]{64}$/u),
  status: z.enum([
    "completed",
    "degraded",
    "failed",
    "timeout",
    "unavailable",
  ]),
  domainCoverage: z.array(GoldCapabilityDomainSchema).max(6),
  templateContributions: z.array(GoldTemplateContributionSchema).min(1),
  counts: GoldAblationObservationCountsSchema,
  teacherScores: z.object({
    suggestedScore: z.number().min(0).max(100).nullable(),
    finalScore: z.number().min(0).max(100).nullable(),
    absoluteDelta: z.number().min(0).max(100).nullable(),
  }).strict(),
  performance: z.object({
    latencyMs: z.number().nonnegative(),
    tokenUsage: z.object({
      input: z.number().int().nonnegative(),
      output: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
    }).strict().nullable(),
    estimatedCostUsd: z.number().nonnegative().nullable(),
  }).strict(),
  errorCode: z.string().min(1).max(240).nullable(),
}).strict().superRefine((observation, context) => {
  const expectedCondition: Record<
    GoldAblationCondition,
    AgentExperimentCondition
  > = {
    A: "single_generalist",
    B: "shared_view_roles",
    C: "private_view_event_group",
  };
  if (
    observation.observationRef.condition
      !== expectedCondition[observation.conditionCode]
  ) {
    context.addIssue({
      code: "custom",
      path: ["observationRef", "condition"],
      message: "实验观测条件与 A/B/C 组别不一致",
    });
  }
  const terminalFailure = [
    "failed",
    "timeout",
    "unavailable",
  ].includes(observation.status);
  if (terminalFailure && observation.errorCode === null) {
    context.addIssue({
      code: "custom",
      path: ["errorCode"],
      message: "失败、超时或不可用运行必须保留错误码",
    });
  }
  if (observation.status === "completed" && observation.errorCode !== null) {
    context.addIssue({
      code: "custom",
      path: ["errorCode"],
      message: "成功运行不得携带错误码",
    });
  }
  if (
    terminalFailure
    && (
      observation.teacherScores.suggestedScore !== null
      || observation.teacherScores.finalScore !== null
      || observation.teacherScores.absoluteDelta !== null
    )
  ) {
    context.addIssue({
      code: "custom",
      path: ["teacherScores"],
      message: "失败、超时或不可用运行不得补造教师分数",
    });
  }
  const domainSet = new Set(observation.domainCoverage);
  if (domainSet.size !== observation.domainCoverage.length) {
    context.addIssue({
      code: "custom",
      path: ["domainCoverage"],
      message: "单次运行的能力域不得重复",
    });
  }
  if (
    new Set(
      observation.templateContributions.map((item) => item.templateId),
    ).size !== observation.templateContributions.length
  ) {
    context.addIssue({
      code: "custom",
      path: ["templateContributions"],
      message: "单次运行的模板贡献标识不得重复",
    });
  }
});
export type GoldAblationRunObservation = z.infer<
  typeof GoldAblationRunObservationSchema
>;

export const GoldRateMetricSchema = z.object({
  numerator: z.number().nonnegative(),
  denominator: z.number().nonnegative(),
  value: z.number().min(0).max(1).nullable(),
  observedRuns: z.number().int().nonnegative(),
  missingRuns: z.number().int().nonnegative(),
}).strict();
export type GoldRateMetric = z.infer<typeof GoldRateMetricSchema>;

export const GoldDistributionMetricSchema = z.object({
  observedRuns: z.number().int().nonnegative(),
  missingRuns: z.number().int().nonnegative(),
  total: z.number().nonnegative().nullable(),
  mean: z.number().nonnegative().nullable(),
  p50: z.number().nonnegative().nullable(),
  p95: z.number().nonnegative().nullable(),
  min: z.number().nonnegative().nullable(),
  max: z.number().nonnegative().nullable(),
}).strict();
export type GoldDistributionMetric = z.infer<
  typeof GoldDistributionMetricSchema
>;

export const GoldAblationGroupSummarySchema = z.object({
  conditionCode: GoldAblationConditionSchema,
  profileId: z.string().min(1).max(160),
  runCount: z.number().int().nonnegative(),
  completedCount: z.number().int().nonnegative(),
  degradedCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  timeoutCount: z.number().int().nonnegative(),
  unavailableCount: z.number().int().nonnegative(),
  templateContributions: z.array(GoldTemplateContributionSchema),
  rates: z.object({
    completion: GoldRateMetricSchema,
    privateReferenceLeakage: GoldRateMetricSchema,
    unauthorizedFormalWriteCommit: GoldRateMetricSchema,
    authoritativeFactConflictCommit: GoldRateMetricSchema,
    evidenceCoverage: GoldRateMetricSchema,
    unrelatedModelCall: GoldRateMetricSchema,
    teacherEdit: GoldRateMetricSchema,
  }).strict(),
  distributions: z.object({
    teacherAbsoluteScoreDelta: GoldDistributionMetricSchema,
    latencyMs: GoldDistributionMetricSchema,
    inputTokens: GoldDistributionMetricSchema,
    outputTokens: GoldDistributionMetricSchema,
    totalTokens: GoldDistributionMetricSchema,
    estimatedCostUsd: GoldDistributionMetricSchema,
  }).strict(),
}).strict();
export type GoldAblationGroupSummary = z.infer<
  typeof GoldAblationGroupSummarySchema
>;

export const GoldAblationMetricComparisonSchema = z.object({
  metricId: z.string().min(1).max(160),
  direction: z.enum(["higher", "lower"]),
  cValue: z.number().nonnegative().nullable(),
  bestBaselineValue: z.number().nonnegative().nullable(),
  bestBaselineCondition: z.enum(["A", "B"]).nullable(),
  status: z.enum(["improved", "tied", "worse", "insufficient"]),
}).strict();
export type GoldAblationMetricComparison = z.infer<
  typeof GoldAblationMetricComparisonSchema
>;

export const GoldAblationGateResultSchema = z.object({
  gateId: z.string().min(1).max(160),
  label: z.string().min(1).max(240),
  status: z.enum(["passed", "failed", "insufficient"]),
  actual: z.string().min(1).max(240),
  requirement: z.string().min(1).max(240),
  evidenceRefs: z.array(z.string().min(1).max(320)),
}).strict();
export type GoldAblationGateResult = z.infer<
  typeof GoldAblationGateResultSchema
>;

export const GoldAblationReportSchema = z.object({
  schemaVersion: z.literal(GoldReadinessSchemaVersion),
  experimentId: z.string().min(1).max(160),
  protocolVersion: z.string().min(1).max(120),
  evidenceLevel: z.enum([
    "deterministic_contract_replay",
    "controlled_runtime",
  ]),
  generatedAt: z.string().datetime(),
  observationCount: z.number().int().nonnegative(),
  observations: z.array(GoldAblationRunObservationSchema),
  groups: z.array(GoldAblationGroupSummarySchema).length(3),
  comparisons: z.array(GoldAblationMetricComparisonSchema),
  strictCoreImprovementCount: z.number().int().nonnegative(),
  gates: z.array(GoldAblationGateResultSchema).min(1),
  conclusion: z.enum([
    "engineering_contract_passed",
    "engineering_contract_failed",
    "insufficient_evidence",
  ]),
  claimBoundary: z.string().min(1).max(1_500),
  reportHash: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();
export type GoldAblationReport = z.infer<
  typeof GoldAblationReportSchema
>;

export const GoldDeidentifiedEvaluationDimensionSchema = z.object({
  dimensionId: z.string().min(1).max(160),
  label: z.string().min(1).max(240),
  maxScore: z.number().positive().max(100),
  recommendationAvailable: z.boolean(),
  suggestedScore: z.number().min(0).max(100).nullable(),
  teacherFinalAvailable: z.boolean(),
  teacherFinalScore: z.number().min(0).max(100).nullable(),
  absoluteDelta: z.number().min(0).max(100).nullable(),
  evidenceRefHashes: z.array(z.string().regex(/^[a-f0-9]{64}$/u)),
}).strict();
export type GoldDeidentifiedEvaluationDimension = z.infer<
  typeof GoldDeidentifiedEvaluationDimensionSchema
>;

export const GoldDeidentifiedEvaluationCaseSchema = z.object({
  casePseudonym: z.string().regex(/^case_[a-f0-9]{24}$/u),
  caseHash: z.string().regex(/^[a-f0-9]{64}$/u),
  evidenceBundleHash: z.string().regex(/^[a-f0-9]{64}$/u),
  rubricRef: z.string().min(1).max(240),
  rubricHash: z.string().regex(/^[a-f0-9]{64}$/u),
  evaluatorCompletion: z.object({
    required: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    unavailable: z.number().int().nonnegative(),
  }).strict(),
  dimensions: z.array(GoldDeidentifiedEvaluationDimensionSchema).min(1),
  teacherFinalAvailable: z.boolean(),
  teacherFinalScore: z.number().min(0).max(100).nullable(),
  teacherEditedDimensions: z.number().int().nonnegative().nullable(),
}).strict();
export type GoldDeidentifiedEvaluationCase = z.infer<
  typeof GoldDeidentifiedEvaluationCaseSchema
>;

export const GoldDeidentifiedEvaluationExportSchema = z.object({
  schemaVersion: z.literal(GoldReadinessSchemaVersion),
  exportVersion: z.string().min(1).max(120),
  generatedAt: z.string().datetime(),
  source: z.literal("authorized_teacher_projection"),
  cases: z.array(GoldDeidentifiedEvaluationCaseSchema),
  excludedSensitiveFields: z.array(z.string().min(1)).min(1),
  exportHash: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();
export type GoldDeidentifiedEvaluationExport = z.infer<
  typeof GoldDeidentifiedEvaluationExportSchema
>;

export const GoldReadinessWorkbenchSchema = z.object({
  schemaVersion: z.literal(GoldReadinessSchemaVersion),
  generatedAt: z.string().datetime(),
  technicalEvidencePlan: z.lazy(() => GoldTechnicalEvidencePlanSchema),
  controlledAblationPreregistration: z.lazy(
    () => GoldControlledAblationPreregistrationSchema,
  ),
  capabilityMatrix: GoldCapabilityEvidenceMatrixSchema,
  protocol: GoldAblationProtocolSchema,
  contractReplay: GoldAblationReportSchema,
  observedSessionReport: GoldAblationReportSchema.nullable(),
  evaluationExport: GoldDeidentifiedEvaluationExportSchema,
  manifest: z.object({
    productVersion: z.string().min(1).max(120),
    gitCommit: z.string().regex(/^[a-f0-9]{40}$/u).nullable(),
    scenarioReleaseRef: z.string().min(1).max(240),
    scenarioContentHash: z.string().regex(/^[a-f0-9]{64}$/u),
    modelProfileRef: z.string().min(1).max(240),
    promptAndPolicyHash: z.string().regex(/^[a-f0-9]{64}$/u),
    metricDefinitionHash: z.string().regex(/^[a-f0-9]{64}$/u),
    ruleSourceHash: z.string().regex(/^[a-f0-9]{64}$/u),
    generationCommand: z.string().min(1).max(400),
    artifactHashes: z.object({
      capabilityMatrix: z.string().regex(/^[a-f0-9]{64}$/u),
      controlledAblationPreregistration:
        z.string().regex(/^[a-f0-9]{64}$/u),
      protocol: z.string().regex(/^[a-f0-9]{64}$/u),
      contractReplay: z.string().regex(/^[a-f0-9]{64}$/u),
      observedSessionReport: z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
      evaluationExport: z.string().regex(/^[a-f0-9]{64}$/u),
    }).strict(),
  }).strict(),
}).strict();
export type GoldReadinessWorkbench = z.infer<
  typeof GoldReadinessWorkbenchSchema
>;

export const GoldTechnicalEvidenceSchemaVersion =
  "gold-technical-evidence/1.0.0" as const;

export const GoldTechnicalGateIdSchema = z.enum([
  "dual_dimension_continuity",
  "single_world_authority",
  "agent_traceability",
  "affected_set_scheduling",
  "private_view_isolation",
  "vocational_consequence",
  "evidence_teacher_review",
  "explicit_failure_recovery",
  "immutable_compatibility",
  "no_image_model_dependency",
]);
export type GoldTechnicalGateId = z.infer<
  typeof GoldTechnicalGateIdSchema
>;

export const GoldCausalEvidenceIdSchema = z.enum([
  "operation_changes_world",
  "world_changes_operation",
  "incident_changes_both_surfaces",
  "governance_changes_world",
  "unified_evidence_and_replay",
]);
export type GoldCausalEvidenceId = z.infer<
  typeof GoldCausalEvidenceIdSchema
>;

export const GoldEvidenceKindSchema = z.enum([
  "automated_test",
  "timeline",
  "visible_ui",
  "runtime_trace",
  "static_source",
  "version_hash",
  "human_review",
]);
export type GoldEvidenceKind = z.infer<typeof GoldEvidenceKindSchema>;

export const GoldGoldenDemoStepSchema = z.object({
  stepId: z.string().min(1).max(160),
  order: z.number().int().min(1).max(20),
  minuteStart: z.number().min(0).max(12),
  minuteEnd: z.number().min(0).max(12),
  actor: z.enum(["teacher", "student"]),
  surface: z.enum([
    "teacher_control",
    "course_operation",
    "world_interaction",
    "material_and_governance",
    "teacher_review",
    "evaluation_and_replay",
  ]),
  action: z.string().min(1).max(600),
  visibleChange: z.string().min(1).max(600),
  agentContribution: z.string().min(1).max(600),
  evidenceRefs: z.array(z.string().min(1).max(320)).min(1),
  verificationRefs: z.array(z.string().min(1).max(320)).min(1),
  fallback: z.string().min(1).max(500),
}).strict().superRefine((step, context) => {
  if (step.minuteEnd <= step.minuteStart) {
    context.addIssue({
      code: "custom",
      path: ["minuteEnd"],
      message: "黄金演示步骤的结束分钟必须晚于开始分钟",
    });
  }
});
export type GoldGoldenDemoStep = z.infer<
  typeof GoldGoldenDemoStepSchema
>;

export const GoldTechnicalEvidencePlanSchema = z.object({
  schemaVersion: z.literal(GoldTechnicalEvidenceSchemaVersion),
  planVersion: z.string().min(1).max(120),
  scenarioBindings: z.array(z.object({
    role: z.enum(["flagship", "transfer"]),
    scenarioId: z.string().min(1).max(160),
    version: z.string().min(1).max(120),
    releaseRef: z.string().min(1).max(240),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  }).strict()).length(2),
  goldenDemo: z.object({
    targetDurationMinutes: z.number().min(8).max(12),
    steps: z.array(GoldGoldenDemoStepSchema).min(8).max(20),
  }).strict(),
  crossSurfaceCausality: z.array(z.object({
    causalId: GoldCausalEvidenceIdSchema,
    label: z.string().min(1).max(240),
    requirement: z.string().min(1).max(800),
    requiredEvidenceKinds: z.array(GoldEvidenceKindSchema).min(3),
    verificationRefs: z.array(z.string().min(1).max(320)).min(1),
  }).strict()).length(5),
  technicalGates: z.array(z.object({
    gateId: GoldTechnicalGateIdSchema,
    label: z.string().min(1).max(240),
    requirement: z.string().min(1).max(800),
    requiredEvidenceKinds: z.array(GoldEvidenceKindSchema).min(1),
    verificationRefs: z.array(z.string().min(1).max(320)).min(1),
  }).strict()).length(10),
  performanceTargets: z.object({
    localActionP95Ms: z.number().positive(),
    asyncProgressVisibleWithinMs: z.number().positive(),
    liveModelP95Ms: z.number().positive(),
    discloseCallsTokensCost: z.literal(true),
  }).strict(),
  transferTarget: z.object({
    configurationOnly: z.literal(true),
    maxAuthoringMinutes: z.number().positive(),
    requiredStudentRoles: z.number().int().min(2),
    requiredPrivateNpcs: z.number().int().min(2),
    requiredNodes: z.number().int().min(3),
    forbiddenTopicSpecificRuntimePaths: z.array(
      z.string().min(1).max(320),
    ).min(1),
  }).strict(),
  artifactLayout: z.array(z.string().min(1).max(320)).min(1),
  claimBoundary: z.string().min(1).max(1_500),
  planHash: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict().superRefine((plan, context) => {
  const exactEnumCoverage = (
    values: readonly string[],
    options: readonly string[],
    path: (string | number)[],
    message: string,
  ) => {
    if (
      values.length !== options.length
      || new Set(values).size !== options.length
      || options.some((option) => !values.includes(option))
    ) {
      context.addIssue({ code: "custom", path, message });
    }
  };
  exactEnumCoverage(
    plan.scenarioBindings.map((binding) => binding.role),
    ["flagship", "transfer"],
    ["scenarioBindings"],
    "技术证据计划必须同时绑定旗舰与微型迁移情境",
  );
  exactEnumCoverage(
    plan.crossSurfaceCausality.map((item) => item.causalId),
    GoldCausalEvidenceIdSchema.options,
    ["crossSurfaceCausality"],
    "技术证据计划必须且只能覆盖五项跨界面因果",
  );
  exactEnumCoverage(
    plan.technicalGates.map((item) => item.gateId),
    GoldTechnicalGateIdSchema.options,
    ["technicalGates"],
    "技术证据计划必须且只能覆盖十项 V1.1 技术门",
  );
  const orders = plan.goldenDemo.steps.map((step) => step.order);
  if (new Set(orders).size !== orders.length) {
    context.addIssue({
      code: "custom",
      path: ["goldenDemo", "steps"],
      message: "黄金演示步骤顺序不得重复",
    });
  }
  for (const causal of plan.crossSurfaceCausality) {
    const kinds = new Set(causal.requiredEvidenceKinds);
    for (const required of [
      "automated_test",
      "timeline",
      "visible_ui",
    ] as const) {
      if (!kinds.has(required)) {
        context.addIssue({
          code: "custom",
          path: ["crossSurfaceCausality", causal.causalId],
          message: "每项跨界面因果必须同时要求自动测试、时间线与可见界面证据",
        });
      }
    }
  }
});
export type GoldTechnicalEvidencePlan = z.infer<
  typeof GoldTechnicalEvidencePlanSchema
>;

export const GoldCandidateDispositionSchema = z.enum([
  "accept_candidate",
  "reject_candidate",
  "request_more_evidence",
]);
export type GoldCandidateDisposition = z.infer<
  typeof GoldCandidateDispositionSchema
>;

export const GoldLiveModelOutputSchema = z.object({
  evidenceRefs: z.array(z.string().min(1).max(240)).max(20),
  attemptsFormalWrite: z.boolean(),
  writeRole: z.string().min(1).max(120),
  candidateDisposition: GoldCandidateDispositionSchema,
  suggestedScore: z.number().min(0).max(100),
  rationale: z.string().min(1).max(800),
}).strict();
export type GoldLiveModelOutput = z.infer<
  typeof GoldLiveModelOutputSchema
>;

export const GoldLiveModelReceiptSchema = z.object({
  receiptId: z.string().min(1).max(320),
  observationId: z.string().min(1).max(320),
  conditionCode: GoldAblationConditionSchema,
  repetition: z.number().int().min(1),
  domain: GoldCapabilityDomainSchema,
  templateId: z.string().min(1).max(240),
  requestHash: z.string().regex(/^[a-f0-9]{64}$/u),
  outputHash: z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
  provider: z.string().min(1).max(120),
  mode: z.enum(["live", "mock", "unavailable"]),
  model: z.string().min(1).max(160),
  requestIdHash: z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
  status: z.enum(["completed", "failed", "timeout", "unavailable"]),
  latencyMs: z.number().nonnegative(),
  tokenUsage: z.object({
    input: z.number().int().nonnegative(),
    output: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  }).strict().nullable(),
  estimatedCostUsd: z.number().nonnegative().nullable(),
  errorCode: z.string().min(1).max(240).nullable(),
}).strict().superRefine((receipt, context) => {
  if (receipt.status === "completed") {
    if (
      receipt.outputHash === null
      || receipt.tokenUsage === null
      || receipt.errorCode !== null
    ) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "成功 Live 收据必须具有输出哈希、Token 且没有错误码",
      });
    }
  } else if (receipt.errorCode === null) {
    context.addIssue({
      code: "custom",
      path: ["errorCode"],
      message: "失败 Live 收据必须保留错误码",
    });
  }
});
export type GoldLiveModelReceipt = z.infer<
  typeof GoldLiveModelReceiptSchema
>;

export const GoldBlindReviewScoreBandSchema = z.object({
  disposition: GoldCandidateDispositionSchema,
  minInclusive: z.number().int().min(0).max(100),
  maxInclusive: z.number().int().min(0).max(100),
  interpretation: z.string().min(1).max(360),
}).strict().superRefine((band, context) => {
  if (band.minInclusive > band.maxInclusive) {
    context.addIssue({
      code: "custom",
      path: ["minInclusive"],
      message: "盲评分数区间下界不得高于上界",
    });
  }
});
export type GoldBlindReviewScoreBand = z.infer<
  typeof GoldBlindReviewScoreBandSchema
>;

export const GoldBlindReviewProtocolSchema = z.object({
  protocolVersion: z.string().min(1).max(120),
  rubricRef: z.string().min(1).max(240),
  scoreSemantics: z.literal("candidate_adoption_readiness"),
  technicalAnchorTolerance: z.number().min(0).max(100),
  scoreBands: z.array(GoldBlindReviewScoreBandSchema).length(3),
  qualityDimensions: z.array(z.object({
    dimensionId: z.string().min(1).max(120),
    label: z.string().min(1).max(160),
    maxScore: z.number().int().positive().max(100),
    requirement: z.string().min(1).max(600),
  }).strict()).min(1),
  reviewerInstructions: z.array(z.string().min(1).max(600)).min(1),
}).strict().superRefine((protocol, context) => {
  const orderedBands = [...protocol.scoreBands].sort(
    (left, right) => left.minInclusive - right.minInclusive,
  );
  if (
    orderedBands[0]?.minInclusive !== 0
    || orderedBands.at(-1)?.maxInclusive !== 100
    || orderedBands.some((band, index) => (
      index > 0
      && band.minInclusive !== (orderedBands[index - 1]?.maxInclusive ?? -1) + 1
    ))
  ) {
    context.addIssue({
      code: "custom",
      path: ["scoreBands"],
      message: "盲评分数区间必须无重叠、无缺口地覆盖0到100",
    });
  }
  if (
    new Set(protocol.scoreBands.map((band) => band.disposition)).size
      !== GoldCandidateDispositionSchema.options.length
  ) {
    context.addIssue({
      code: "custom",
      path: ["scoreBands"],
      message: "盲评分数区间必须各绑定一种候选处置",
    });
  }
  if (
    new Set(
      protocol.qualityDimensions.map((dimension) => dimension.dimensionId),
    ).size !== protocol.qualityDimensions.length
  ) {
    context.addIssue({
      code: "custom",
      path: ["qualityDimensions"],
      message: "盲评质量维度标识不得重复",
    });
  }
  if (
    protocol.qualityDimensions.reduce(
      (sum, dimension) => sum + dimension.maxScore,
      0,
    ) !== 100
  ) {
    context.addIssue({
      code: "custom",
      path: ["qualityDimensions"],
      message: "盲评质量维度总分必须等于100",
    });
  }
});
export type GoldBlindReviewProtocol = z.infer<
  typeof GoldBlindReviewProtocolSchema
>;

export const GoldBlindReviewContextSchema = z.object({
  caseRef: z.string().min(1).max(240),
  label: z.string().min(1).max(160),
  task: z.string().min(1).max(1_200),
  publicEvidence: z.object({
    ref: z.string().min(1).max(240),
    content: z.string().min(1).max(1_200),
  }).strict(),
  rolePrivateEvidence: z.object({
    ref: z.string().min(1).max(240),
    content: z.string().min(1).max(1_200),
  }).strict(),
  authoritativeFact: z.string().min(1).max(1_200),
  candidateClaim: z.string().min(1).max(1_200),
}).strict();
export type GoldBlindReviewContext = z.infer<
  typeof GoldBlindReviewContextSchema
>;

export const GoldBlindReviewPacketSchema = z.object({
  packetVersion: z.string().min(1).max(120),
  conditionLabelsHidden: z.literal(true),
  reviewProtocol: GoldBlindReviewProtocolSchema.optional(),
  cases: z.array(z.object({
    blindCaseId: z.string().regex(/^blind_[a-f0-9]{24}$/u),
    domain: GoldCapabilityDomainSchema,
    reviewContext: GoldBlindReviewContextSchema.optional(),
    response: GoldLiveModelOutputSchema,
    responseHash: z.string().regex(/^[a-f0-9]{64}$/u),
    rubricRef: z.string().min(1).max(240),
  }).strict()),
  packetHash: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();
export type GoldBlindReviewPacket = z.infer<
  typeof GoldBlindReviewPacketSchema
>;

export const GoldControlledAblationPreregistrationSchema = z.object({
  schemaVersion: z.literal(GoldTechnicalEvidenceSchemaVersion),
  preregistrationVersion: z.string().min(1).max(120),
  status: z.literal("sealed_before_live"),
  protocol: GoldAblationProtocolSchema,
  reviewProtocol: GoldBlindReviewProtocolSchema,
  caseSuite: z.array(z.object({
    caseRef: z.string().min(1).max(240),
    domain: GoldCapabilityDomainSchema,
    label: z.string().min(1).max(160),
    task: z.string().min(1).max(1_200),
    specialistTemplateId: z.string().min(1).max(240),
    requiredWriteRole: z.string().min(1).max(120),
    publicEvidence: z.object({
      ref: z.string().min(1).max(240),
      content: z.string().min(1).max(1_200),
    }).strict(),
    rolePrivateEvidence: z.object({
      ref: z.string().min(1).max(240),
      content: z.string().min(1).max(1_200),
    }).strict(),
    authoritativeFact: z.string().min(1).max(1_200),
    candidateClaim: z.string().min(1).max(1_200),
    candidateConflictsWithAuthority: z.boolean(),
    expectedDisposition: GoldCandidateDispositionSchema,
    technicalAnchorScore: z.number().min(0).max(100),
  }).strict()).length(GoldCapabilityDomainSchema.options.length),
  executionPolicy: z.object({
    conditionLabelsExcludedFromModelRequests: z.literal(true),
    minimumRepetitionsPerCondition: z.number().int().min(10),
    failuresRetainedWithoutScoreImputation: z.literal(true),
    unblindingAllowedAfterReviewCollection: z.literal(true),
    protocolChangeRequiresNewVersionAndCommit: z.literal(true),
  }).strict(),
  claimBoundary: z.string().min(1).max(1_500),
  preregistrationHash: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict().superRefine((preregistration, context) => {
  const domains = new Set(
    preregistration.caseSuite.map((item) => item.domain),
  );
  if (domains.size !== GoldCapabilityDomainSchema.options.length) {
    context.addIssue({
      code: "custom",
      path: ["caseSuite"],
      message: "预登记案例必须且只能覆盖六个能力域",
    });
  }
  for (const item of preregistration.caseSuite) {
    const band = preregistration.reviewProtocol.scoreBands.find(
      (candidate) => candidate.disposition === item.expectedDisposition,
    );
    if (
      !band
      || item.technicalAnchorScore < band.minInclusive
      || item.technicalAnchorScore > band.maxInclusive
    ) {
      context.addIssue({
        code: "custom",
        path: ["caseSuite", item.caseRef, "technicalAnchorScore"],
        message: "案例技术锚点必须落在预期处置对应的预登记分数区间",
      });
    }
  }
  if (!preregistration.protocol.blindConditionLabels) {
    context.addIssue({
      code: "custom",
      path: ["protocol", "blindConditionLabels"],
      message: "预登记受控消融必须隐藏A/B/C条件标签",
    });
  }
});
export type GoldControlledAblationPreregistration = z.infer<
  typeof GoldControlledAblationPreregistrationSchema
>;

export const GoldBlindReviewWorkflowSchemaVersion =
  "gold-blind-review-workflow/1.0.0" as const;

export const GoldBlindReviewBatchIdSchema = z.string().regex(
  /^gbr_[a-f0-9]{24}$/u,
);
export const GoldBlindReviewerAliasSchema = z.string().regex(
  /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,39}$/u,
);
export const GoldBlindReviewBatchStatusSchema = z.enum([
  "collecting",
  "frozen",
  "unblinded",
]);
export type GoldBlindReviewBatchStatus = z.infer<
  typeof GoldBlindReviewBatchStatusSchema
>;

export const GoldBlindReviewConditionKeyEntrySchema = z.object({
  blindCaseId: z.string().regex(/^blind_[a-f0-9]{24}$/u),
  receiptId: z.string().min(1).max(320),
  observationId: z.string().min(1).max(320),
  conditionCode: GoldAblationConditionSchema,
  repetition: z.number().int().min(1),
  templateId: z.string().min(1).max(240),
}).strict();
export type GoldBlindReviewConditionKeyEntry = z.infer<
  typeof GoldBlindReviewConditionKeyEntrySchema
>;

export const GoldBlindReviewDimensionScoreSchema = z.object({
  dimensionId: z.string().min(1).max(120),
  score: z.number().int().min(0).max(100),
}).strict();
export type GoldBlindReviewDimensionScore = z.infer<
  typeof GoldBlindReviewDimensionScoreSchema
>;

export const GoldBlindReviewSubmissionInputSchema = z.object({
  blindCaseId: z.string().regex(/^blind_[a-f0-9]{24}$/u),
  responseHash: z.string().regex(/^[a-f0-9]{64}$/u),
  candidateAdoptionScore: z.number().int().min(0).max(100),
  candidateDisposition: GoldCandidateDispositionSchema,
  qualityDimensionScores: z.array(
    GoldBlindReviewDimensionScoreSchema,
  ).min(1).max(20),
  rationale: z.string().trim().min(20).max(2_000),
  idempotencyKey: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,159}$/u),
}).strict();
export type GoldBlindReviewSubmissionInput = z.infer<
  typeof GoldBlindReviewSubmissionInputSchema
>;

export const GoldBlindReviewRecordSchema = z.object({
  schemaVersion: z.literal(GoldBlindReviewWorkflowSchemaVersion),
  reviewId: z.string().regex(/^gbrv_[a-f0-9]{24}$/u),
  batchId: GoldBlindReviewBatchIdSchema,
  reviewerAlias: GoldBlindReviewerAliasSchema,
  blindCaseId: z.string().regex(/^blind_[a-f0-9]{24}$/u),
  responseHash: z.string().regex(/^[a-f0-9]{64}$/u),
  candidateAdoptionScore: z.number().int().min(0).max(100),
  candidateDisposition: GoldCandidateDispositionSchema,
  qualityDimensionScores: z.array(
    GoldBlindReviewDimensionScoreSchema,
  ).min(1).max(20),
  totalQualityScore: z.number().int().min(0).max(100),
  rationale: z.string().trim().min(20).max(2_000),
  idempotencyKey: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,159}$/u),
  submittedAt: z.string().datetime(),
  reviewHash: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();
export type GoldBlindReviewRecord = z.infer<
  typeof GoldBlindReviewRecordSchema
>;

export const GoldBlindReviewFreezeReceiptSchema = z.object({
  schemaVersion: z.literal(GoldBlindReviewWorkflowSchemaVersion),
  batchId: GoldBlindReviewBatchIdSchema,
  frozenAt: z.string().datetime(),
  reviewerCount: z.number().int().min(2),
  caseCount: z.number().int().positive(),
  reviewCount: z.number().int().positive(),
  reviewSnapshotHash: z.string().regex(/^[a-f0-9]{64}$/u),
  receiptHash: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();
export type GoldBlindReviewFreezeReceipt = z.infer<
  typeof GoldBlindReviewFreezeReceiptSchema
>;

export const GoldBlindReviewMetricStatusSchema = z.enum([
  "passed",
  "failed",
  "insufficient",
]);
export type GoldBlindReviewMetricStatus = z.infer<
  typeof GoldBlindReviewMetricStatusSchema
>;

export const GoldBlindReviewAgreementMetricSchema = z.object({
  method: z.enum(["fleiss_kappa", "icc_2_1"]),
  value: z.number().min(-1).max(1).nullable(),
  thresholdMin: z.number().min(-1).max(1),
  status: GoldBlindReviewMetricStatusSchema,
  reason: z.string().min(1).max(360).nullable(),
}).strict();
export type GoldBlindReviewAgreementMetric = z.infer<
  typeof GoldBlindReviewAgreementMetricSchema
>;

export const GoldBlindReviewModelExpertAssessmentSchema = z.object({
  assessedCaseCount: z.number().int().nonnegative(),
  meanAbsoluteErrorPct: z.number().min(0).max(100).nullable(),
  meanAbsoluteErrorThresholdMax: z.number().min(0).max(100),
  meanAbsoluteErrorStatus: GoldBlindReviewMetricStatusSchema,
  highRiskCaseCount: z.number().int().nonnegative(),
  highRiskAssessableCount: z.number().int().nonnegative(),
  highRiskFalseNegativeCount: z.number().int().nonnegative(),
  highRiskFalseNegativeThresholdMax: z.literal(0),
  highRiskFalseNegativeStatus: GoldBlindReviewMetricStatusSchema,
}).strict();
export type GoldBlindReviewModelExpertAssessment = z.infer<
  typeof GoldBlindReviewModelExpertAssessmentSchema
>;

const GoldBlindReviewDispositionCountsSchema = z.object({
  acceptCandidate: z.number().int().nonnegative(),
  rejectCandidate: z.number().int().nonnegative(),
  requestMoreEvidence: z.number().int().nonnegative(),
}).strict();

export const GoldBlindReviewConditionSummarySchema = z.object({
  conditionCode: GoldAblationConditionSchema,
  blindCaseCount: z.number().int().nonnegative(),
  reviewCount: z.number().int().nonnegative(),
  meanModelSuggestedScore: z.number().min(0).max(100).nullable(),
  meanExpertCandidateAdoptionScore: z.number().min(0).max(100).nullable(),
  meanResponseQualityScore: z.number().min(0).max(100).nullable(),
  modelDispositionCounts: GoldBlindReviewDispositionCountsSchema,
  expertDispositionCounts: GoldBlindReviewDispositionCountsSchema,
}).strict();
export type GoldBlindReviewConditionSummary = z.infer<
  typeof GoldBlindReviewConditionSummarySchema
>;

export const GoldBlindReviewUnblindingReceiptSchema = z.object({
  schemaVersion: z.literal(GoldBlindReviewWorkflowSchemaVersion),
  batchId: GoldBlindReviewBatchIdSchema,
  unblindedAt: z.string().datetime(),
  freezeReceiptHash: z.string().regex(/^[a-f0-9]{64}$/u),
  conditionKeyHash: z.string().regex(/^[a-f0-9]{64}$/u),
  mappingCount: z.number().int().positive(),
  agreement: z.object({
    candidateDisposition: GoldBlindReviewAgreementMetricSchema,
    candidateAdoptionScore: GoldBlindReviewAgreementMetricSchema,
    responseQualityScore: GoldBlindReviewAgreementMetricSchema,
  }).strict(),
  modelExpertAssessment: GoldBlindReviewModelExpertAssessmentSchema,
  conditionSummaries: z.array(GoldBlindReviewConditionSummarySchema).length(3),
  receiptHash: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();
export type GoldBlindReviewUnblindingReceipt = z.infer<
  typeof GoldBlindReviewUnblindingReceiptSchema
>;

export const GoldBlindReviewReviewerProgressSchema = z.object({
  reviewerAlias: GoldBlindReviewerAliasSchema,
  submittedCaseCount: z.number().int().nonnegative(),
  expectedCaseCount: z.number().int().positive(),
  complete: z.boolean(),
}).strict();
export type GoldBlindReviewReviewerProgress = z.infer<
  typeof GoldBlindReviewReviewerProgressSchema
>;

export const GoldBlindReviewBatchViewSchema = z.object({
  schemaVersion: z.literal(GoldBlindReviewWorkflowSchemaVersion),
  batchId: GoldBlindReviewBatchIdSchema,
  sessionId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/u),
  status: GoldBlindReviewBatchStatusSchema,
  packetVersion: z.string().min(1).max(120),
  packetHash: z.string().regex(/^[a-f0-9]{64}$/u),
  preregistrationHash: z.string().regex(/^[a-f0-9]{64}$/u),
  reviewProtocolHash: z.string().regex(/^[a-f0-9]{64}$/u),
  rubricRef: z.string().min(1).max(240),
  caseCount: z.number().int().positive(),
  reviewerCount: z.number().int().min(2),
  submittedReviewCount: z.number().int().nonnegative(),
  expectedReviewCount: z.number().int().positive(),
  readyToFreeze: z.boolean(),
  conditionLabelsVisible: z.boolean(),
  reviewerProgress: z.array(GoldBlindReviewReviewerProgressSchema).min(2),
  freezeReceipt: GoldBlindReviewFreezeReceiptSchema.nullable(),
  unblindingReceipt: GoldBlindReviewUnblindingReceiptSchema.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  revision: z.number().int().positive(),
  claimBoundary: z.string().min(1).max(1_200),
}).strict();
export type GoldBlindReviewBatchView = z.infer<
  typeof GoldBlindReviewBatchViewSchema
>;

export const GoldBlindReviewWorkflowViewSchema = z.object({
  schemaVersion: z.literal(GoldBlindReviewWorkflowSchemaVersion),
  generatedAt: z.string().datetime(),
  activeBatch: GoldBlindReviewBatchViewSchema.nullable(),
  batches: z.array(GoldBlindReviewBatchViewSchema),
  claimBoundary: z.string().min(1).max(1_200),
}).strict();
export type GoldBlindReviewWorkflowView = z.infer<
  typeof GoldBlindReviewWorkflowViewSchema
>;

export const GoldBlindReviewInvitationSchema = z.object({
  reviewerAlias: GoldBlindReviewerAliasSchema,
  accessCode: z.string().regex(/^[a-zA-Z0-9_-]{24,120}$/u),
}).strict();
export type GoldBlindReviewInvitation = z.infer<
  typeof GoldBlindReviewInvitationSchema
>;

export const GoldBlindReviewBatchCreationResultSchema = z.object({
  batch: GoldBlindReviewBatchViewSchema,
  invitations: z.array(GoldBlindReviewInvitationSchema).min(2),
}).strict();
export type GoldBlindReviewBatchCreationResult = z.infer<
  typeof GoldBlindReviewBatchCreationResultSchema
>;

export const GoldBlindReviewReviewerViewSchema = z.object({
  schemaVersion: z.literal(GoldBlindReviewWorkflowSchemaVersion),
  batchId: GoldBlindReviewBatchIdSchema,
  status: GoldBlindReviewBatchStatusSchema,
  reviewerAlias: GoldBlindReviewerAliasSchema,
  packet: GoldBlindReviewPacketSchema,
  progress: GoldBlindReviewReviewerProgressSchema,
  submittedBlindCaseIds: z.array(
    z.string().regex(/^blind_[a-f0-9]{24}$/u),
  ),
  claimBoundary: z.string().min(1).max(1_200),
}).strict();
export type GoldBlindReviewReviewerView = z.infer<
  typeof GoldBlindReviewReviewerViewSchema
>;

export const GoldBlindReviewConditionMappingSchema = z.object({
  blindCaseId: z.string().regex(/^blind_[a-f0-9]{24}$/u),
  conditionCode: GoldAblationConditionSchema,
}).strict();
export type GoldBlindReviewConditionMapping = z.infer<
  typeof GoldBlindReviewConditionMappingSchema
>;

export const GoldBlindReviewUnblindingResultSchema = z.object({
  batch: GoldBlindReviewBatchViewSchema,
  mappings: z.array(GoldBlindReviewConditionMappingSchema).min(1),
}).strict();
export type GoldBlindReviewUnblindingResult = z.infer<
  typeof GoldBlindReviewUnblindingResultSchema
>;

export const GoldPilotStudySchemaVersion =
  "gold-pilot-study/1.0.0" as const;
export const GoldPilotProtocolVersion =
  "gold-pilot-protocol/1.0.0" as const;

export const GoldPilotStudyIdSchema = z.string().regex(
  /^gps_[a-f0-9]{24}$/u,
);
export const GoldPilotAliasSchema = z.string().regex(
  /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,39}$/u,
);
export const GoldPilotArmSchema = z.enum([
  "course_platform_only",
  "full_dual_dimension",
]);
export type GoldPilotArm = z.infer<typeof GoldPilotArmSchema>;

export const GoldPilotSequenceSchema = z.enum([
  "course_then_dual",
  "dual_then_course",
]);
export type GoldPilotSequence = z.infer<typeof GoldPilotSequenceSchema>;

export const GoldPilotProtocolSchema = z.object({
  schemaVersion: z.literal(GoldPilotStudySchemaVersion),
  protocolVersion: z.literal(GoldPilotProtocolVersion),
  design: z.literal("within_participant_crossover"),
  arms: z.tuple([
    z.literal("course_platform_only"),
    z.literal("full_dual_dimension"),
  ]),
  targetMinimums: z.object({
    teacherCount: z.literal(3),
    studentCount: z.literal(20),
    runsPerStudent: z.literal(2),
  }).strict(),
  studentMetrics: z.tuple([
    z.literal("valid_action_count"),
    z.literal("active_question_count"),
    z.literal("evidence_record_count"),
    z.literal("distinct_evidence_ref_count"),
    z.literal("plan_revision_count"),
    z.literal("task_completion_count"),
    z.literal("scene_completion"),
    z.literal("exit_category"),
  ]),
  teacherWorkloadPhases: z.tuple([
    z.literal("configuration"),
    z.literal("intervention"),
    z.literal("final_review"),
  ]),
  stabilityMetrics: z.tuple([
    z.literal("failure_event_count"),
    z.literal("degraded_event_count"),
    z.literal("timeout_count"),
    z.literal("manual_takeover_count"),
    z.literal("recovery_count"),
  ]),
  ethics: z.object({
    informedExplanationRequired: z.literal(true),
    minimumDataOnly: z.literal(true),
    deidentifiedAliasesOnly: z.literal(true),
    withdrawalAllowed: z.literal(true),
    freeTextExitReasonForbidden: z.literal(true),
  }).strict(),
  frozenAt: z.string().datetime(),
  protocolHash: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();
export type GoldPilotProtocol = z.infer<typeof GoldPilotProtocolSchema>;

export const GoldPilotRunSlotSchema = z.object({
  period: z.union([z.literal(1), z.literal(2)]),
  sessionId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/u),
  arm: GoldPilotArmSchema,
  roleId: RoleIdSchema,
  teacherAlias: GoldPilotAliasSchema,
}).strict();
export type GoldPilotRunSlot = z.infer<typeof GoldPilotRunSlotSchema>;

export const GoldPilotParticipantAssignmentSchema = z.object({
  participantAlias: GoldPilotAliasSchema,
  sequence: GoldPilotSequenceSchema,
  runs: z.tuple([
    GoldPilotRunSlotSchema,
    GoldPilotRunSlotSchema,
  ]),
}).strict().superRefine((assignment, context) => {
  const [first, second] = assignment.runs;
  if (first.period !== 1 || second.period !== 2) {
    context.addIssue({
      code: "custom",
      path: ["runs"],
      message: "试点交叉分组必须按 period 1、2 固定登记",
    });
  }
  if (first.sessionId === second.sessionId) {
    context.addIssue({
      code: "custom",
      path: ["runs"],
      message: "同一参与者的两期试点必须使用不同会话",
    });
  }
  const expected = assignment.sequence === "course_then_dual"
    ? ["course_platform_only", "full_dual_dimension"]
    : ["full_dual_dimension", "course_platform_only"];
  if (first.arm !== expected[0] || second.arm !== expected[1]) {
    context.addIssue({
      code: "custom",
      path: ["sequence"],
      message: "试点序列与两期条件分配不一致",
    });
  }
});
export type GoldPilotParticipantAssignment = z.infer<
  typeof GoldPilotParticipantAssignmentSchema
>;

export const GoldPilotReadinessSchemaVersion =
  "gold-pilot-readiness/1.0.0" as const;
export const GoldPilotReadinessIdSchema = z.string().regex(
  /^gpr_[a-f0-9]{24}$/u,
);
export const GoldPilotRubricDimensionIdSchema = z.string().regex(
  /^[a-zA-Z0-9][a-zA-Z0-9._:-]{1,79}$/u,
);
export const GoldPilotTaskVariantIdSchema = z.string().regex(
  /^[a-zA-Z0-9][a-zA-Z0-9._:-]{1,79}$/u,
);
const GoldPilotSha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);

export const GoldPilotRubricDimensionDefinitionSchema = z.object({
  dimensionId: GoldPilotRubricDimensionIdSchema,
  label: z.string().min(1).max(80),
  definitionHash: GoldPilotSha256Schema,
  behaviorAnchorsHash: GoldPilotSha256Schema,
  evidenceSourcesHash: GoldPilotSha256Schema,
  redLinesHash: GoldPilotSha256Schema,
  proposedWeight: z.number().positive().max(100),
}).strict();
export type GoldPilotRubricDimensionDefinition = z.infer<
  typeof GoldPilotRubricDimensionDefinitionSchema
>;

export const GoldPilotRubricPackageInputSchema = z.object({
  rubricRef: z.string().min(1).max(240),
  rubricVersion: z.string().min(1).max(80),
  dimensions: z.array(
    GoldPilotRubricDimensionDefinitionSchema,
  ).min(1).max(32),
}).strict();
export type GoldPilotRubricPackageInput = z.infer<
  typeof GoldPilotRubricPackageInputSchema
>;

export const GoldPilotRubricPackageSchema =
  GoldPilotRubricPackageInputSchema.extend({
    packageHash: GoldPilotSha256Schema,
  }).strict();
export type GoldPilotRubricPackage = z.infer<
  typeof GoldPilotRubricPackageSchema
>;

export const GoldPilotEquivalentTaskVariantSchema = z.object({
  taskVariantId: GoldPilotTaskVariantIdSchema,
  scenarioId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{1,119}$/u),
  scenarioVersion: z.string().regex(/^\d+\.\d+\.\d+$/u),
  scenarioContentHash: GoldPilotSha256Schema,
  taskDefinitionHash: GoldPilotSha256Schema,
  learningOutcomeSetHash: GoldPilotSha256Schema,
  evidenceRequirementSetHash: GoldPilotSha256Schema,
  rubricHash: GoldPilotSha256Schema,
  expectedMinutes: z.number().int().min(1).max(120),
}).strict();
export type GoldPilotEquivalentTaskVariant = z.infer<
  typeof GoldPilotEquivalentTaskVariantSchema
>;

export const GoldPilotEquivalentTaskPairInputSchema = z.object({
  variants: z.tuple([
    GoldPilotEquivalentTaskVariantSchema,
    GoldPilotEquivalentTaskVariantSchema,
  ]),
}).strict();
export type GoldPilotEquivalentTaskPairInput = z.infer<
  typeof GoldPilotEquivalentTaskPairInputSchema
>;

export const GoldPilotEquivalentTaskPairSchema =
  GoldPilotEquivalentTaskPairInputSchema.extend({
    equivalenceRule: z.object({
      sameLearningOutcomes: z.literal(true),
      sameEvidenceRequirements: z.literal(true),
      sameRubric: z.literal(true),
      maximumExpectedMinutesDifference: z.literal(5),
    }).strict(),
    pairHash: GoldPilotSha256Schema,
  }).strict();
export type GoldPilotEquivalentTaskPair = z.infer<
  typeof GoldPilotEquivalentTaskPairSchema
>;

export const GoldPilotTaskSequenceSchema = z.enum([
  "task_a_then_b",
  "task_b_then_a",
]);
export type GoldPilotTaskSequence = z.infer<
  typeof GoldPilotTaskSequenceSchema
>;

export const GoldPilotTaskAllocationSchema = z.object({
  participantAlias: GoldPilotAliasSchema,
  taskSequence: GoldPilotTaskSequenceSchema,
  runs: z.tuple([
    z.object({
      period: z.literal(1),
      sessionId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/u),
      taskVariantId: GoldPilotTaskVariantIdSchema,
    }).strict(),
    z.object({
      period: z.literal(2),
      sessionId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/u),
      taskVariantId: GoldPilotTaskVariantIdSchema,
    }).strict(),
  ]),
}).strict();
export type GoldPilotTaskAllocation = z.infer<
  typeof GoldPilotTaskAllocationSchema
>;

export const GoldPilotInformationSheetSchema = z.object({
  version: z.string().min(1).max(80),
  documentHash: GoldPilotSha256Schema,
}).strict();
export type GoldPilotInformationSheet = z.infer<
  typeof GoldPilotInformationSheetSchema
>;

export const GoldPilotMinimumDataPolicyInputSchema = z.object({
  policyVersion: z.string().min(1).max(80),
  policyDocumentHash: GoldPilotSha256Schema,
}).strict();
export type GoldPilotMinimumDataPolicyInput = z.infer<
  typeof GoldPilotMinimumDataPolicyInputSchema
>;

export const GoldPilotMinimumDataPolicySchema =
  GoldPilotMinimumDataPolicyInputSchema.extend({
    permittedFields: z.tuple([
      z.literal("participant_alias"),
      z.literal("condition_and_task_assignment"),
      z.literal("aggregate_student_metrics"),
      z.literal("aggregate_teacher_workload"),
      z.literal("standardized_exit_category"),
      z.literal("receipt_hashes"),
    ]),
    prohibitedFields: z.tuple([
      z.literal("real_name"),
      z.literal("contact_details"),
      z.literal("raw_chat"),
      z.literal("raw_recording"),
      z.literal("private_memory"),
      z.literal("free_text_exit_reason"),
    ]),
    policyHash: GoldPilotSha256Schema,
  }).strict();
export type GoldPilotMinimumDataPolicy = z.infer<
  typeof GoldPilotMinimumDataPolicySchema
>;

export const GoldPilotReadinessPlanInputSchema = z.object({
  participantAssignments: z.array(
    GoldPilotParticipantAssignmentSchema,
  ).min(1),
  taskAllocations: z.array(GoldPilotTaskAllocationSchema).min(1),
  expertReviewerAliases: z.array(
    GoldPilotAliasSchema,
  ).min(3).max(10),
  rubricPackage: GoldPilotRubricPackageInputSchema,
  equivalentTasks: GoldPilotEquivalentTaskPairInputSchema,
  informationSheet: GoldPilotInformationSheetSchema,
  minimumDataPolicy: GoldPilotMinimumDataPolicyInputSchema,
}).strict();
export type GoldPilotReadinessPlanInput = z.infer<
  typeof GoldPilotReadinessPlanInputSchema
>;

export const GoldPilotRubricAdequacySchema = z.enum([
  "adequate",
  "revision_required",
]);
export type GoldPilotRubricAdequacy = z.infer<
  typeof GoldPilotRubricAdequacySchema
>;

export const GoldPilotRubricWeightRecommendationSchema = z.enum([
  "retain",
  "reduce",
  "exclude_from_high_weight",
]);
export type GoldPilotRubricWeightRecommendation = z.infer<
  typeof GoldPilotRubricWeightRecommendationSchema
>;

export const GoldPilotRubricReviewReasonCodeSchema = z.enum([
  "accepted_as_is",
  "definition_unclear",
  "behavior_anchor_unobservable",
  "evidence_source_uncollectable",
  "red_line_incomplete",
  "weight_not_supported",
  "other_structured_concern",
]);
export type GoldPilotRubricReviewReasonCode = z.infer<
  typeof GoldPilotRubricReviewReasonCodeSchema
>;

export const GoldPilotRubricReviewInputSchema = z.object({
  dimensionId: GoldPilotRubricDimensionIdSchema,
  definition: GoldPilotRubricAdequacySchema,
  behaviorAnchors: GoldPilotRubricAdequacySchema,
  evidenceSources: GoldPilotRubricAdequacySchema,
  redLines: GoldPilotRubricAdequacySchema,
  weightRecommendation: GoldPilotRubricWeightRecommendationSchema,
  reasonCodes: z.array(
    GoldPilotRubricReviewReasonCodeSchema,
  ).min(1).max(7),
  rationaleArtifactHash: GoldPilotSha256Schema.nullable(),
}).strict();
export type GoldPilotRubricReviewInput = z.infer<
  typeof GoldPilotRubricReviewInputSchema
>;

export const GoldPilotRubricReviewRecordSchema = z.object({
  schemaVersion: z.literal(GoldPilotReadinessSchemaVersion),
  reviewId: z.string().regex(/^gprv_[a-f0-9]{24}$/u),
  readinessId: GoldPilotReadinessIdSchema,
  reviewerAlias: GoldPilotAliasSchema,
  review: GoldPilotRubricReviewInputSchema,
  submittedAt: z.string().datetime(),
  receiptHash: GoldPilotSha256Schema,
}).strict();
export type GoldPilotRubricReviewRecord = z.infer<
  typeof GoldPilotRubricReviewRecordSchema
>;

export const GoldPilotRubricResolutionDecisionSchema = z.enum([
  "retained",
  "revised",
  "excluded_from_high_weight",
]);
export type GoldPilotRubricResolutionDecision = z.infer<
  typeof GoldPilotRubricResolutionDecisionSchema
>;

export const GoldPilotRubricResolutionInputSchema = z.object({
  dimensionId: GoldPilotRubricDimensionIdSchema,
  decision: GoldPilotRubricResolutionDecisionSchema,
  revisionArtifactHash: GoldPilotSha256Schema.nullable(),
}).strict();
export type GoldPilotRubricResolutionInput = z.infer<
  typeof GoldPilotRubricResolutionInputSchema
>;

export const GoldPilotRubricResolutionRecordSchema = z.object({
  schemaVersion: z.literal(GoldPilotReadinessSchemaVersion),
  resolutionId: z.string().regex(/^gprs_[a-f0-9]{24}$/u),
  readinessId: GoldPilotReadinessIdSchema,
  resolution: GoldPilotRubricResolutionInputSchema,
  resolvedAt: z.string().datetime(),
  receiptHash: GoldPilotSha256Schema,
}).strict();
export type GoldPilotRubricResolutionRecord = z.infer<
  typeof GoldPilotRubricResolutionRecordSchema
>;

export const GoldPilotParticipantKindSchema = z.enum([
  "teacher",
  "student",
]);
export type GoldPilotParticipantKind = z.infer<
  typeof GoldPilotParticipantKindSchema
>;

export const GoldPilotConsentActionSchema = z.enum([
  "confirmed",
  "withdrawn",
]);
export type GoldPilotConsentAction = z.infer<
  typeof GoldPilotConsentActionSchema
>;

export const GoldPilotConsentEventSchema = z.object({
  schemaVersion: z.literal(GoldPilotReadinessSchemaVersion),
  eventId: z.string().regex(/^gprc_[a-f0-9]{24}$/u),
  readinessId: GoldPilotReadinessIdSchema,
  participantAlias: GoldPilotAliasSchema,
  participantKind: GoldPilotParticipantKindSchema,
  action: GoldPilotConsentActionSchema,
  sourceRecordHash: GoldPilotSha256Schema,
  informationSheetHash: GoldPilotSha256Schema,
  minimumDataPolicyHash: GoldPilotSha256Schema,
  recordedAt: z.string().datetime(),
  receiptHash: GoldPilotSha256Schema,
}).strict();
export type GoldPilotConsentEvent = z.infer<
  typeof GoldPilotConsentEventSchema
>;

export const GoldPilotConsentInputSchema = z.object({
  participantAlias: GoldPilotAliasSchema,
  participantKind: GoldPilotParticipantKindSchema,
  sourceRecordHash: GoldPilotSha256Schema,
}).strict();
export type GoldPilotConsentInput = z.infer<
  typeof GoldPilotConsentInputSchema
>;

export const GoldPilotReadinessFreezeReceiptSchema = z.object({
  schemaVersion: z.literal(GoldPilotReadinessSchemaVersion),
  readinessId: GoldPilotReadinessIdSchema,
  protocolHash: GoldPilotSha256Schema,
  rubricPackageHash: GoldPilotSha256Schema,
  equivalentTaskPairHash: GoldPilotSha256Schema,
  assignmentSnapshotHash: GoldPilotSha256Schema,
  taskAllocationSnapshotHash: GoldPilotSha256Schema,
  contentValiditySnapshotHash: GoldPilotSha256Schema,
  consentSnapshotHash: GoldPilotSha256Schema,
  frozenAt: z.string().datetime(),
  receiptHash: GoldPilotSha256Schema,
}).strict();
export type GoldPilotReadinessFreezeReceipt = z.infer<
  typeof GoldPilotReadinessFreezeReceiptSchema
>;

export const GoldPilotReadinessStatusSchema = z.enum([
  "collecting_prerequisites",
  "ready_to_freeze",
  "frozen",
  "frozen_with_withdrawals",
]);
export type GoldPilotReadinessStatus = z.infer<
  typeof GoldPilotReadinessStatusSchema
>;

export const GoldPilotReadinessSummarySchema = z.object({
  status: GoldPilotReadinessStatusSchema,
  expertReviewerCount: z.number().int().nonnegative(),
  rubricDimensionCount: z.number().int().positive(),
  completedRubricReviewCount: z.number().int().nonnegative(),
  expectedRubricReviewCount: z.number().int().positive(),
  resolvedRubricDimensionCount: z.number().int().nonnegative(),
  consentedTeacherCount: z.number().int().nonnegative(),
  consentedStudentCount: z.number().int().nonnegative(),
  withdrawnParticipantCount: z.number().int().nonnegative(),
  missingRequirements: z.array(z.string().min(1).max(240)),
  claimBoundary: z.string().min(1).max(1_500),
}).strict();
export type GoldPilotReadinessSummary = z.infer<
  typeof GoldPilotReadinessSummarySchema
>;

export const GoldPilotReadinessViewSchema = z.object({
  schemaVersion: z.literal(GoldPilotReadinessSchemaVersion),
  readinessId: GoldPilotReadinessIdSchema,
  anchorSessionId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/u),
  protocol: GoldPilotProtocolSchema,
  participantAssignments: z.array(
    GoldPilotParticipantAssignmentSchema,
  ).min(1),
  taskAllocations: z.array(GoldPilotTaskAllocationSchema).min(1),
  expertReviewerAliases: z.array(GoldPilotAliasSchema).min(3).max(10),
  rubricPackage: GoldPilotRubricPackageSchema,
  equivalentTasks: GoldPilotEquivalentTaskPairSchema,
  informationSheet: GoldPilotInformationSheetSchema,
  minimumDataPolicy: GoldPilotMinimumDataPolicySchema,
  rubricReviews: z.array(GoldPilotRubricReviewRecordSchema),
  rubricResolutions: z.array(GoldPilotRubricResolutionRecordSchema),
  consentEvents: z.array(GoldPilotConsentEventSchema),
  freezeReceipt: GoldPilotReadinessFreezeReceiptSchema.nullable(),
  summary: GoldPilotReadinessSummarySchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  revision: z.number().int().positive(),
}).strict();
export type GoldPilotReadinessView = z.infer<
  typeof GoldPilotReadinessViewSchema
>;

export const GoldPilotReadinessWorkflowViewSchema = z.object({
  schemaVersion: z.literal(GoldPilotReadinessSchemaVersion),
  generatedAt: z.string().datetime(),
  activePlan: GoldPilotReadinessViewSchema.nullable(),
  plans: z.array(GoldPilotReadinessViewSchema),
  claimBoundary: z.string().min(1).max(1_500),
}).strict();
export type GoldPilotReadinessWorkflowView = z.infer<
  typeof GoldPilotReadinessWorkflowViewSchema
>;

export const GoldPilotAnalysisSchemaVersion =
  "gold-pilot-analysis/1.0.0" as const;
export const GoldPilotAnalysisPlanVersion =
  "gold-pilot-analysis-plan/1.0.0" as const;

export const GoldPilotAnalysisMetricIdSchema = z.enum([
  "valid_student_action_count",
  "active_question_count",
  "evidence_record_count",
  "distinct_evidence_ref_count",
  "plan_revision_count",
  "task_completion_count",
  "scene_completion",
  "teacher_intervention_count",
  "teacher_model_correction_count",
  "failure_event_count",
  "degraded_event_count",
  "timeout_count",
  "manual_takeover_count",
  "recovery_count",
  "observed_duration_seconds",
]);
export type GoldPilotAnalysisMetricId = z.infer<
  typeof GoldPilotAnalysisMetricIdSchema
>;

export const GoldPilotAnalysisPlanSchema = z.object({
  schemaVersion: z.literal(GoldPilotAnalysisSchemaVersion),
  planVersion: z.literal(GoldPilotAnalysisPlanVersion),
  unitOfAnalysis: z.literal("complete_participant_pair"),
  inclusionRule: z.literal("both_preregistered_runs_completed"),
  missingDataRule: z.literal("no_imputation"),
  inferenceMode: z.literal("descriptive_only"),
  targetMinimums: z.object({
    teacherCount: z.literal(3),
    completePairCount: z.literal(20),
  }).strict(),
  metrics: z.array(GoldPilotAnalysisMetricIdSchema).min(1),
  diagnostics: z.tuple([
    z.literal("condition_sequence"),
    z.literal("task_sequence"),
    z.literal("condition_by_task_cell"),
    z.literal("period_by_arm"),
  ]),
  frozenAt: z.string().datetime(),
  planHash: GoldPilotSha256Schema,
}).strict();
export type GoldPilotAnalysisPlan = z.infer<
  typeof GoldPilotAnalysisPlanSchema
>;

export const GoldPilotStudyDesignBindingSchema = z.object({
  schemaVersion: z.literal(GoldPilotAnalysisSchemaVersion),
  readinessId: GoldPilotReadinessIdSchema,
  readinessFreezeReceiptHash: GoldPilotSha256Schema,
  readinessProtocolHash: GoldPilotSha256Schema,
  rubricPackageHash: GoldPilotSha256Schema,
  equivalentTaskPairHash: GoldPilotSha256Schema,
  assignmentSnapshotHash: GoldPilotSha256Schema,
  taskAllocationSnapshotHash: GoldPilotSha256Schema,
  contentValiditySnapshotHash: GoldPilotSha256Schema,
  consentSnapshotHash: GoldPilotSha256Schema,
  analysisPlanHash: GoldPilotSha256Schema,
  boundAt: z.string().datetime(),
  bindingHash: GoldPilotSha256Schema,
}).strict();
export type GoldPilotStudyDesignBinding = z.infer<
  typeof GoldPilotStudyDesignBindingSchema
>;

export const GoldPilotWorkloadPhaseSchema = z.enum([
  "configuration",
  "intervention",
  "final_review",
]);
export type GoldPilotWorkloadPhase = z.infer<
  typeof GoldPilotWorkloadPhaseSchema
>;

export const GoldPilotWorkloadSegmentSchema = z.object({
  schemaVersion: z.literal(GoldPilotStudySchemaVersion),
  segmentId: z.string().regex(/^gpsw_[a-f0-9]{24}$/u),
  studyId: GoldPilotStudyIdSchema,
  sessionId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/u),
  teacherAlias: GoldPilotAliasSchema,
  phase: GoldPilotWorkloadPhaseSchema,
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime().nullable(),
  durationSeconds: z.number().int().nonnegative().nullable(),
  receiptHash: z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
}).strict().superRefine((segment, context) => {
  const open = segment.finishedAt === null
    && segment.durationSeconds === null
    && segment.receiptHash === null;
  const closed = segment.finishedAt !== null
    && segment.durationSeconds !== null
    && segment.receiptHash !== null;
  if (!open && !closed) {
    context.addIssue({
      code: "custom",
      path: ["finishedAt"],
      message: "教师负担计时段必须完整处于进行中或已结束状态",
    });
  }
});
export type GoldPilotWorkloadSegment = z.infer<
  typeof GoldPilotWorkloadSegmentSchema
>;

export const GoldPilotRunDispositionSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("completed"),
    exitCategory: z.literal("completed"),
  }).strict(),
  z.object({
    outcome: z.literal("withdrawn"),
    exitCategory: z.enum([
      "participant_withdrawal",
      "consent_revoked",
      "other_withdrawal",
    ]),
  }).strict(),
  z.object({
    outcome: z.literal("technical_failure"),
    exitCategory: z.enum([
      "timeout",
      "degraded_service",
      "stuck_session",
      "manual_abort",
      "other_technical",
    ]),
  }).strict(),
]);
export type GoldPilotRunDisposition = z.infer<
  typeof GoldPilotRunDispositionSchema
>;

export const GoldPilotRunFinalizeInputSchema = z.object({
  disposition: GoldPilotRunDispositionSchema,
  idempotencyKey: z.string().regex(
    /^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,159}$/u,
  ),
}).strict();
export type GoldPilotRunFinalizeInput = z.infer<
  typeof GoldPilotRunFinalizeInputSchema
>;

export const GoldPilotRunMetricsSchema = z.object({
  eventCount: z.number().int().nonnegative(),
  validStudentActionCount: z.number().int().nonnegative(),
  coursePlatformActionCount: z.number().int().nonnegative(),
  worldInteractionActionCount: z.number().int().nonnegative(),
  activeQuestionCount: z.number().int().nonnegative(),
  evidenceRecordedCount: z.number().int().nonnegative(),
  distinctEvidenceRefCount: z.number().int().nonnegative(),
  planRevisionCount: z.number().int().nonnegative(),
  taskCompletionCount: z.number().int().nonnegative(),
  sceneCompleted: z.boolean(),
  teacherInterventionCount: z.number().int().nonnegative(),
  teacherModelCorrectionCount: z.number().int().nonnegative(),
  failureEventCount: z.number().int().nonnegative(),
  degradedEventCount: z.number().int().nonnegative(),
  timeoutCount: z.number().int().nonnegative(),
  manualTakeoverCount: z.number().int().nonnegative(),
  recoveryCount: z.number().int().nonnegative(),
  observedDurationSeconds: z.number().int().nonnegative(),
}).strict();
export type GoldPilotRunMetrics = z.infer<typeof GoldPilotRunMetricsSchema>;

export const GoldPilotRunReceiptSchema = z.object({
  schemaVersion: z.literal(GoldPilotStudySchemaVersion),
  receiptId: z.string().regex(/^gpsr_[a-f0-9]{24}$/u),
  studyId: GoldPilotStudyIdSchema,
  participantAlias: GoldPilotAliasSchema,
  sessionId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/u),
  period: z.union([z.literal(1), z.literal(2)]),
  arm: GoldPilotArmSchema,
  teacherAlias: GoldPilotAliasSchema,
  disposition: GoldPilotRunDispositionSchema,
  metrics: GoldPilotRunMetricsSchema,
  eventSnapshotHash: z.string().regex(/^[a-f0-9]{64}$/u),
  idempotencyHash: z.string().regex(/^[a-f0-9]{64}$/u),
  finalizedAt: z.string().datetime(),
  receiptHash: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();
export type GoldPilotRunReceipt = z.infer<
  typeof GoldPilotRunReceiptSchema
>;

export const GoldPilotArmSummarySchema = z.object({
  arm: GoldPilotArmSchema,
  finalizedRunCount: z.number().int().nonnegative(),
  completedRunCount: z.number().int().nonnegative(),
  completionRate: z.number().min(0).max(1).nullable(),
  meanValidStudentActionCount: z.number().nonnegative().nullable(),
  meanActiveQuestionCount: z.number().nonnegative().nullable(),
  meanEvidenceRecordedCount: z.number().nonnegative().nullable(),
  meanPlanRevisionCount: z.number().nonnegative().nullable(),
  meanTaskCompletionCount: z.number().nonnegative().nullable(),
  meanTeacherInterventionCount: z.number().nonnegative().nullable(),
  meanTeacherModelCorrectionCount: z.number().nonnegative().nullable(),
  meanFailureEventCount: z.number().nonnegative().nullable(),
  meanObservedDurationSeconds: z.number().nonnegative().nullable(),
}).strict();
export type GoldPilotArmSummary = z.infer<
  typeof GoldPilotArmSummarySchema
>;

export const GoldPilotWorkloadSummarySchema = z.object({
  phase: GoldPilotWorkloadPhaseSchema,
  closedSegmentCount: z.number().int().nonnegative(),
  totalDurationSeconds: z.number().int().nonnegative(),
  meanDurationSeconds: z.number().nonnegative().nullable(),
}).strict();
export type GoldPilotWorkloadSummary = z.infer<
  typeof GoldPilotWorkloadSummarySchema
>;

export const GoldPilotAnalysisReportIdSchema = z.string().regex(
  /^gpar_[a-f0-9]{24}$/u,
);
export const GoldPilotAnalysisReportStatusSchema = z.enum([
  "exploratory",
  "target_ready_for_descriptive_comparison",
]);
export type GoldPilotAnalysisReportStatus = z.infer<
  typeof GoldPilotAnalysisReportStatusSchema
>;

export const GoldPilotAnalysisExitCategoryCountsSchema = z.object({
  completed: z.number().int().nonnegative(),
  participantWithdrawal: z.number().int().nonnegative(),
  consentRevoked: z.number().int().nonnegative(),
  otherWithdrawal: z.number().int().nonnegative(),
  timeout: z.number().int().nonnegative(),
  degradedService: z.number().int().nonnegative(),
  stuckSession: z.number().int().nonnegative(),
  manualAbort: z.number().int().nonnegative(),
  otherTechnical: z.number().int().nonnegative(),
}).strict();
export type GoldPilotAnalysisExitCategoryCounts = z.infer<
  typeof GoldPilotAnalysisExitCategoryCountsSchema
>;

export const GoldPilotAnalysisParticipantFlowSchema = z.object({
  registeredTeacherCount: z.number().int().nonnegative(),
  registeredParticipantCount: z.number().int().nonnegative(),
  expectedRunCount: z.number().int().nonnegative(),
  finalizedRunCount: z.number().int().nonnegative(),
  unfinalizedRunCount: z.number().int().nonnegative(),
  completedRunCount: z.number().int().nonnegative(),
  withdrawnRunCount: z.number().int().nonnegative(),
  technicalFailureRunCount: z.number().int().nonnegative(),
  completePairCount: z.number().int().nonnegative(),
  incompletePairCount: z.number().int().nonnegative(),
  analysisIncludedRunCount: z.number().int().nonnegative(),
  exitCategoryCounts: GoldPilotAnalysisExitCategoryCountsSchema,
}).strict();
export type GoldPilotAnalysisParticipantFlow = z.infer<
  typeof GoldPilotAnalysisParticipantFlowSchema
>;

export const GoldPilotAnalysisDesignCellIdSchema = z.enum([
  "course_then_dual__task_a_then_b",
  "course_then_dual__task_b_then_a",
  "dual_then_course__task_a_then_b",
  "dual_then_course__task_b_then_a",
]);
export const GoldPilotAnalysisDesignCellSchema = z.object({
  cellId: GoldPilotAnalysisDesignCellIdSchema,
  conditionSequence: GoldPilotSequenceSchema,
  taskSequence: GoldPilotTaskSequenceSchema,
  registeredParticipantCount: z.number().int().nonnegative(),
  completePairCount: z.number().int().nonnegative(),
}).strict();
export type GoldPilotAnalysisDesignCell = z.infer<
  typeof GoldPilotAnalysisDesignCellSchema
>;

export const GoldPilotAnalysisArmTaskCellSchema = z.object({
  arm: GoldPilotArmSchema,
  taskVariantId: GoldPilotTaskVariantIdSchema,
  registeredRunCount: z.number().int().nonnegative(),
  completedRunCount: z.number().int().nonnegative(),
}).strict();
export type GoldPilotAnalysisArmTaskCell = z.infer<
  typeof GoldPilotAnalysisArmTaskCellSchema
>;

export const GoldPilotAnalysisPeriodArmCellSchema = z.object({
  period: z.union([z.literal(1), z.literal(2)]),
  arm: GoldPilotArmSchema,
  registeredRunCount: z.number().int().nonnegative(),
  completedRunCount: z.number().int().nonnegative(),
}).strict();
export type GoldPilotAnalysisPeriodArmCell = z.infer<
  typeof GoldPilotAnalysisPeriodArmCellSchema
>;

export const GoldPilotAnalysisDesignDiagnosticsSchema = z.object({
  designCells: z.array(GoldPilotAnalysisDesignCellSchema).length(4),
  armTaskCells: z.array(GoldPilotAnalysisArmTaskCellSchema).min(1),
  periodArmCells: z.array(GoldPilotAnalysisPeriodArmCellSchema).length(4),
  maximumRegistrationCellImbalance: z.number().int().nonnegative(),
  balancedAtRegistration: z.boolean(),
}).strict();
export type GoldPilotAnalysisDesignDiagnostics = z.infer<
  typeof GoldPilotAnalysisDesignDiagnosticsSchema
>;

export const GoldPilotPairedMetricSummarySchema = z.object({
  metricId: GoldPilotAnalysisMetricIdSchema,
  completePairCount: z.number().int().nonnegative(),
  coursePlatformMean: z.number().nullable(),
  fullDualMean: z.number().nullable(),
  meanDifference: z.number().nullable(),
  medianDifference: z.number().nullable(),
  minimumDifference: z.number().nullable(),
  maximumDifference: z.number().nullable(),
}).strict();
export type GoldPilotPairedMetricSummary = z.infer<
  typeof GoldPilotPairedMetricSummarySchema
>;

export const GoldPilotAnalysisWorkloadSummarySchema = z.object({
  phase: GoldPilotWorkloadPhaseSchema,
  closedSegmentCount: z.number().int().nonnegative(),
  totalDurationSeconds: z.number().int().nonnegative(),
  meanDurationSeconds: z.number().nonnegative().nullable(),
  medianDurationSeconds: z.number().nonnegative().nullable(),
}).strict();
export type GoldPilotAnalysisWorkloadSummary = z.infer<
  typeof GoldPilotAnalysisWorkloadSummarySchema
>;

export const GoldPilotAnalysisStabilitySummarySchema = z.object({
  arm: GoldPilotArmSchema,
  includedCompletedRunCount: z.number().int().nonnegative(),
  failureEventCount: z.number().int().nonnegative(),
  degradedEventCount: z.number().int().nonnegative(),
  timeoutCount: z.number().int().nonnegative(),
  manualTakeoverCount: z.number().int().nonnegative(),
  recoveryCount: z.number().int().nonnegative(),
}).strict();
export type GoldPilotAnalysisStabilitySummary = z.infer<
  typeof GoldPilotAnalysisStabilitySummarySchema
>;

export const GoldPilotAnalysisSourceSnapshotSchema = z.object({
  designBindingHash: GoldPilotSha256Schema,
  readinessFreezeReceiptHash: GoldPilotSha256Schema,
  protocolHash: GoldPilotSha256Schema,
  assignmentSnapshotHash: GoldPilotSha256Schema,
  taskAllocationSnapshotHash: GoldPilotSha256Schema,
  runReceiptSnapshotHash: GoldPilotSha256Schema,
  workloadSnapshotHash: GoldPilotSha256Schema,
}).strict();
export type GoldPilotAnalysisSourceSnapshot = z.infer<
  typeof GoldPilotAnalysisSourceSnapshotSchema
>;

export const GoldPilotAnalysisReportSchema = z.object({
  schemaVersion: z.literal(GoldPilotAnalysisSchemaVersion),
  reportId: GoldPilotAnalysisReportIdSchema,
  studyId: GoldPilotStudyIdSchema,
  status: GoldPilotAnalysisReportStatusSchema,
  analysisPlan: GoldPilotAnalysisPlanSchema,
  designBinding: GoldPilotStudyDesignBindingSchema,
  sourceRevision: z.number().int().positive(),
  sourceSnapshot: GoldPilotAnalysisSourceSnapshotSchema,
  participantFlow: GoldPilotAnalysisParticipantFlowSchema,
  designDiagnostics: GoldPilotAnalysisDesignDiagnosticsSchema,
  pairedMetrics: z.array(GoldPilotPairedMetricSummarySchema).min(1),
  workloadSummaries: z.array(
    GoldPilotAnalysisWorkloadSummarySchema,
  ).length(3),
  stabilitySummaries: z.array(
    GoldPilotAnalysisStabilitySummarySchema,
  ).length(2),
  missingTargets: z.array(z.string().min(1).max(240)),
  limitations: z.array(z.string().min(1).max(500)).min(1).max(12),
  claimBoundary: z.string().min(1).max(1_500),
  frozenAt: z.string().datetime(),
  reportHash: GoldPilotSha256Schema,
}).strict();
export type GoldPilotAnalysisReport = z.infer<
  typeof GoldPilotAnalysisReportSchema
>;

export const GoldPilotStudySummarySchema = z.object({
  status: z.enum([
    "insufficient",
    "ready_for_analysis",
    "analysis_frozen",
  ]),
  teacherCount: z.number().int().nonnegative(),
  studentCount: z.number().int().nonnegative(),
  expectedRunCount: z.number().int().nonnegative(),
  finalizedRunCount: z.number().int().nonnegative(),
  completedRunCount: z.number().int().nonnegative(),
  withdrawnRunCount: z.number().int().nonnegative(),
  technicalFailureRunCount: z.number().int().nonnegative(),
  completePairCount: z.number().int().nonnegative(),
  incompletePairCount: z.number().int().nonnegative(),
  openWorkloadSegmentCount: z.number().int().nonnegative(),
  analysisFreezeReady: z.boolean(),
  analysisReportStatus: GoldPilotAnalysisReportStatusSchema.nullable(),
  missingTargets: z.array(z.string().min(1).max(240)),
  armSummaries: z.tuple([
    GoldPilotArmSummarySchema,
    GoldPilotArmSummarySchema,
  ]),
  workloadSummaries: z.tuple([
    GoldPilotWorkloadSummarySchema,
    GoldPilotWorkloadSummarySchema,
    GoldPilotWorkloadSummarySchema,
  ]),
  claimBoundary: z.string().min(1).max(1_200),
}).strict();
export type GoldPilotStudySummary = z.infer<
  typeof GoldPilotStudySummarySchema
>;

export const GoldPilotStudyViewSchema = z.object({
  schemaVersion: z.literal(GoldPilotStudySchemaVersion),
  studyId: GoldPilotStudyIdSchema,
  anchorSessionId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/u),
  protocol: GoldPilotProtocolSchema,
  participantAssignments: z.array(
    GoldPilotParticipantAssignmentSchema,
  ).min(1),
  taskAllocations: z.array(GoldPilotTaskAllocationSchema),
  analysisPlan: GoldPilotAnalysisPlanSchema.nullable(),
  designBinding: GoldPilotStudyDesignBindingSchema.nullable(),
  analysisReport: GoldPilotAnalysisReportSchema.nullable(),
  workloadSegments: z.array(GoldPilotWorkloadSegmentSchema),
  runReceipts: z.array(GoldPilotRunReceiptSchema),
  summary: GoldPilotStudySummarySchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  revision: z.number().int().positive(),
}).strict();
export type GoldPilotStudyView = z.infer<typeof GoldPilotStudyViewSchema>;

export const GoldPilotCurrentRunViewSchema = z.object({
  studyId: GoldPilotStudyIdSchema,
  participantAlias: GoldPilotAliasSchema,
  sessionId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/u),
  period: z.union([z.literal(1), z.literal(2)]),
  arm: GoldPilotArmSchema,
  roleId: RoleIdSchema,
  teacherAlias: GoldPilotAliasSchema,
  finalized: z.boolean(),
  activeWorkloadSegment: GoldPilotWorkloadSegmentSchema.nullable(),
}).strict();
export type GoldPilotCurrentRunView = z.infer<
  typeof GoldPilotCurrentRunViewSchema
>;

export const GoldPilotWorkflowViewSchema = z.object({
  schemaVersion: z.literal(GoldPilotStudySchemaVersion),
  generatedAt: z.string().datetime(),
  protocol: GoldPilotProtocolSchema,
  activeStudy: GoldPilotStudyViewSchema.nullable(),
  studies: z.array(GoldPilotStudyViewSchema),
  currentRun: GoldPilotCurrentRunViewSchema.nullable(),
  claimBoundary: z.string().min(1).max(1_200),
}).strict();
export type GoldPilotWorkflowView = z.infer<
  typeof GoldPilotWorkflowViewSchema
>;

export const GoldControlledAblationBundleSchema = z.object({
  schemaVersion: z.literal(GoldTechnicalEvidenceSchemaVersion),
  bundleVersion: z.string().min(1).max(120),
  generatedAt: z.string().datetime(),
  modelBinding: z.object({
    profileRef: z.string().min(1).max(240),
    provider: z.string().min(1).max(120),
    mode: z.enum(["live", "mock", "unavailable"]),
    model: z.string().min(1).max(160),
    pricing: z.object({
      sourceUrl: z.string().url(),
      accessedAt: z.string().date(),
      inputCacheMissUsdPerMillion: z.number().nonnegative(),
      outputUsdPerMillion: z.number().nonnegative(),
      calculation: z.literal(
        "conservative_cache_miss_input_plus_output",
      ),
    }).strict().nullable(),
  }).strict(),
  protocol: GoldAblationProtocolSchema,
  report: GoldAblationReportSchema,
  receipts: z.array(GoldLiveModelReceiptSchema),
  blindReviewPacket: GoldBlindReviewPacketSchema,
  conditionKey: z.array(GoldBlindReviewConditionKeyEntrySchema),
  claimBoundary: z.string().min(1).max(1_500),
  bundleHash: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict().superRefine((bundle, context) => {
  if (bundle.protocol.evidenceLevel !== "controlled_runtime") {
    context.addIssue({
      code: "custom",
      path: ["protocol", "evidenceLevel"],
      message: "Live 消融包必须使用 controlled_runtime 证据等级",
    });
  }
  if (bundle.report.evidenceLevel !== "controlled_runtime") {
    context.addIssue({
      code: "custom",
      path: ["report", "evidenceLevel"],
      message: "Live 消融报告必须使用 controlled_runtime 证据等级",
    });
  }
  if (bundle.conditionKey.length !== bundle.blindReviewPacket.cases.length) {
    context.addIssue({
      code: "custom",
      path: ["conditionKey"],
      message: "盲评条件映射必须与可评审成功输出逐项对应",
    });
  }
});
export type GoldControlledAblationBundle = z.infer<
  typeof GoldControlledAblationBundleSchema
>;

export const GoldEvidenceValidationReceiptSchema = z.object({
  receiptId: z.string().min(1).max(160),
  command: z.string().min(1).max(800),
  scope: z.string().min(1).max(240),
  status: z.enum(["passed", "failed", "insufficient"]),
  startedAt: z.string().datetime(),
  durationMs: z.number().nonnegative(),
  resultSummary: z.string().min(1).max(800),
  outputHash: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();
export type GoldEvidenceValidationReceipt = z.infer<
  typeof GoldEvidenceValidationReceiptSchema
>;

export const GoldEvidenceArtifactFileSchema = z.object({
  path: z.string()
    .min(1)
    .max(320)
    .refine(
      (value) => (
        !value.startsWith("/")
        && !/^[A-Za-z]:[\\/]/u.test(value)
        && !value.split(/[\\/]/u).includes("..")
      ),
      "证据文件路径必须是包内相对路径",
    ),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  bytes: z.number().int().nonnegative(),
  mediaType: z.string().min(1).max(120),
  evidenceRefs: z.array(z.string().min(1).max(320)).min(1),
}).strict();
export type GoldEvidenceArtifactFile = z.infer<
  typeof GoldEvidenceArtifactFileSchema
>;

export const GoldEvidenceStatusSchema = z.enum([
  "passed",
  "failed",
  "insufficient",
]);
export type GoldEvidenceStatus = z.infer<typeof GoldEvidenceStatusSchema>;

export const GoldEvidenceObservationSchema = z.object({
  kind: GoldEvidenceKindSchema,
  ref: z.string().min(1).max(320),
  observed: z.boolean(),
}).strict();
export type GoldEvidenceObservation = z.infer<
  typeof GoldEvidenceObservationSchema
>;

const GoldEvidenceAssessmentRowBaseSchema = z.object({
  label: z.string().min(1).max(240),
  status: GoldEvidenceStatusSchema,
  evidence: z.array(GoldEvidenceObservationSchema).min(1),
  rationale: z.string().min(1).max(800),
}).strict();

export const GoldTechnicalGateAssessmentSchema =
  GoldEvidenceAssessmentRowBaseSchema.extend({
    gateId: GoldTechnicalGateIdSchema,
  }).strict();
export type GoldTechnicalGateAssessment = z.infer<
  typeof GoldTechnicalGateAssessmentSchema
>;

export const GoldCausalClaimAssessmentSchema =
  GoldEvidenceAssessmentRowBaseSchema.extend({
    causalId: GoldCausalEvidenceIdSchema,
  }).strict().superRefine((assessment, context) => {
    if (assessment.status !== "passed") return;
    const observedKinds = new Set(
      assessment.evidence
        .filter((item) => item.observed)
        .map((item) => item.kind),
    );
    for (const required of [
      "automated_test",
      "timeline",
      "visible_ui",
    ] as const) {
      if (!observedKinds.has(required)) {
        context.addIssue({
          code: "custom",
          path: ["evidence"],
          message: "通过的跨界面因果必须同时具有自动测试、时间线和可见界面证据",
        });
      }
    }
  });
export type GoldCausalClaimAssessment = z.infer<
  typeof GoldCausalClaimAssessmentSchema
>;

export const GoldEvidenceAssessmentSchema = z.object({
  schemaVersion: z.literal(GoldTechnicalEvidenceSchemaVersion),
  generatedAt: z.string().datetime(),
  technicalGates: z.array(GoldTechnicalGateAssessmentSchema).length(10),
  causalClaims: z.array(GoldCausalClaimAssessmentSchema).length(5),
  assessmentHash: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict().superRefine((assessment, context) => {
  const exactEnumCoverage = (
    values: readonly string[],
    options: readonly string[],
    path: (string | number)[],
    message: string,
  ) => {
    if (
      values.length !== options.length
      || new Set(values).size !== options.length
      || options.some((option) => !values.includes(option))
    ) {
      context.addIssue({ code: "custom", path, message });
    }
  };
  exactEnumCoverage(
    assessment.technicalGates.map((item) => item.gateId),
    GoldTechnicalGateIdSchema.options,
    ["technicalGates"],
    "证据评估必须且只能覆盖十项 V1.1 技术门",
  );
  exactEnumCoverage(
    assessment.causalClaims.map((item) => item.causalId),
    GoldCausalEvidenceIdSchema.options,
    ["causalClaims"],
    "证据评估必须且只能覆盖五项跨界面因果",
  );
});
export type GoldEvidenceAssessment = z.infer<
  typeof GoldEvidenceAssessmentSchema
>;

export const GoldTransferAuthoringRunSchemaVersion =
  "gold-transfer-authoring-run/1.0.0" as const;
export const GoldTransferAuthoringRequiredSmokeCheckIds = [
  "three_node_path",
  "teacher_gate",
  "fixed_teacher_final",
] as const;

const GoldTransferAuthoringScenarioBindingSchema = z.object({
  scenarioId: z.string().min(1).max(160),
  version: z.string().min(1).max(120),
  releaseRef: z.string().min(1).max(240),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  schemaVersion: z.string().min(1).max(120),
}).strict();

const GoldTransferAuthoringFileSchema = z.object({
  path: z.string()
    .min(1)
    .max(320)
    .refine(
      (value) => !value.startsWith("/") && !value.includes("\\"),
      "迁移创作文件必须使用项目内POSIX相对路径",
    ),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  bytes: z.number().int().positive(),
}).strict();

const GoldTransferAuthoringValidationAttemptSchema = z.object({
  attemptedAt: z.string().datetime(),
  valid: z.boolean(),
  issueCount: z.number().int().nonnegative(),
  issueCodes: z.array(z.string().min(1).max(160)),
  definitionHash: z.string().regex(/^[a-f0-9]{64}$/u),
  validationStamp: z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
}).strict().superRefine((attempt, context) => {
  if (attempt.issueCount !== attempt.issueCodes.length) {
    context.addIssue({
      code: "custom",
      path: ["issueCount"],
      message: "迁移校验问题数量必须与保留的问题码数量一致",
    });
  }
  if (attempt.valid !== (attempt.issueCount === 0)) {
    context.addIssue({
      code: "custom",
      path: ["valid"],
      message: "迁移校验有效性必须与问题数量一致",
    });
  }
});

const GoldTransferAuthoringStatusSchema = z.enum([
  "started",
  "passed",
  "failed",
  "insufficient",
]);

const GoldTransferAuthoringStructureSchema = z.object({
  status: z.enum(["passed", "failed"]),
  studentRoleCount: z.number().int().nonnegative(),
  privateNpcCount: z.number().int().nonnegative(),
  nodeCount: z.number().int().nonnegative(),
  hasStructuredMaterialTask: z.boolean(),
  hasStudentTriggeredEvent: z.boolean(),
  hasTeacherGate: z.boolean(),
  hasFixedEvaluation: z.boolean(),
}).strict().superRefine((structure, context) => {
  const expectedStatus = (
    structure.studentRoleCount >= 2
    && structure.privateNpcCount >= 2
    && structure.nodeCount >= 3
    && structure.hasStructuredMaterialTask
    && structure.hasStudentTriggeredEvent
    && structure.hasTeacherGate
    && structure.hasFixedEvaluation
  )
    ? "passed"
    : "failed";
  if (structure.status !== expectedStatus) {
    context.addIssue({
      code: "custom",
      path: ["status"],
      message: "迁移结构状态必须由岗位、NPC、节点、任务、事件、教师门和固定评价共同决定",
    });
  }
});

const GoldTransferAuthoringRuntimeSmokeSchema = z.object({
  status: GoldEvidenceStatusSchema,
  sessionId: z.string().min(1).max(160).nullable(),
  checkIds: z.array(z.string().min(1).max(160)).min(1),
  eventCount: z.number().int().nonnegative(),
  receiptHash: z.string().regex(/^[a-f0-9]{64}$/u),
  claimBoundary: z.string().min(1).max(800),
}).strict().superRefine((smoke, context) => {
  if (new Set(smoke.checkIds).size !== smoke.checkIds.length) {
    context.addIssue({
      code: "custom",
      path: ["checkIds"],
      message: "迁移运行烟测检查项不得重复",
    });
  }
  if (smoke.status !== "passed") return;
  const missingCheckIds = GoldTransferAuthoringRequiredSmokeCheckIds.filter(
    (checkId) => !smoke.checkIds.includes(checkId),
  );
  if (
    smoke.sessionId === null
    || smoke.eventCount <= 0
    || missingCheckIds.length > 0
  ) {
    context.addIssue({
      code: "custom",
      path: ["status"],
      message:
        `迁移烟测通过必须绑定真实会话、正事件数和完整检查项：${missingCheckIds.join(",") || "session/event"}`,
    });
  }
});

export const GoldTransferAuthoringRunSchema = z.object({
  schemaVersion: z.literal(GoldTransferAuthoringRunSchemaVersion),
  runId: z.string().regex(/^[a-z0-9][a-z0-9._-]{2,119}$/u),
  status: GoldTransferAuthoringStatusSchema,
  targetScenarioId: z.string().min(1).max(160),
  operator: z.object({
    authorRole: z.enum(["content_author", "content_author_assisted"]),
    witnessRole: z.literal("qa"),
  }).strict(),
  baseline: z.object({
    sourceGitCommit: z.string().regex(/^[a-f0-9]{40}$/u),
    sourceTreeState: z.literal("clean"),
    collectorSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    templateBinding: GoldTransferAuthoringScenarioBindingSchema,
    targetAbsence: z.object({
      repositoryMatchCount: z.literal(0),
      workspaceUntrackedMatchCount: z.literal(0),
      catalogMatchCount: z.literal(0),
      catalogSourcesScanned: z.array(z.string().min(1).max(320)),
    }).strict(),
  }).strict(),
  timing: z.object({
    startedAt: z.string().datetime(),
    completedAt: z.string().datetime().nullable(),
    elapsedMs: z.number().int().positive().nullable(),
    targetMaxMs: z.number().int().positive(),
  }).strict(),
  eventLog: z.object({
    path: z.string()
      .min(1)
      .max(320)
      .refine(
        (value) => !value.startsWith("/") && !value.includes("\\"),
        "迁移事件日志必须使用项目内POSIX相对路径",
      ),
    eventCount: z.number().int().positive(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  }).strict(),
  modifiedFiles: z.array(GoldTransferAuthoringFileSchema),
  validationAttempts: z.array(GoldTransferAuthoringValidationAttemptSchema),
  reuse: z.object({
    method: z.literal(
      "canonical-json-pointer-leaf-equality/target-pointer-universe",
    ),
    reusedLeafCount: z.number().int().nonnegative(),
    comparableLeafCount: z.number().int().positive(),
    ratio: z.number().min(0).max(1),
    changedJsonPointers: z.array(z.string().startsWith("/")),
    reusedJsonPointers: z.array(z.string().startsWith("/")),
  }).strict().nullable(),
  structure: GoldTransferAuthoringStructureSchema.nullable(),
  forbiddenRuntimeScan: z.object({
    status: z.enum(["passed", "failed"]),
    scannedPaths: z.array(z.string().min(1).max(320)).min(1),
    topicMarkers: z.array(z.string().min(1).max(320)).min(1),
    matches: z.array(z.object({
      path: z.string().min(1).max(320),
      marker: z.string().min(1).max(320),
    }).strict()),
  }).strict().nullable(),
  targetRelease: GoldTransferAuthoringScenarioBindingSchema.nullable(),
  runtimeSmoke: GoldTransferAuthoringRuntimeSmokeSchema.nullable(),
  claimBoundary: z.string().min(1).max(1_500),
  runHash: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict().superRefine((run, context) => {
  if (run.targetScenarioId === run.baseline.templateBinding.scenarioId) {
    context.addIssue({
      code: "custom",
      path: ["targetScenarioId"],
      message: "前瞻迁移计时必须使用基线中不存在的全新情境标识",
    });
  }

  const completedAtMs = run.timing.completedAt === null
    ? null
    : Date.parse(run.timing.completedAt);
  const expectedElapsedMs = completedAtMs === null
    ? null
    : completedAtMs - Date.parse(run.timing.startedAt);

  if (run.status === "started") {
    if (
      run.timing.completedAt !== null
      || run.timing.elapsedMs !== null
      || run.reuse !== null
      || run.structure !== null
      || run.forbiddenRuntimeScan !== null
      || run.targetRelease !== null
      || run.runtimeSmoke !== null
    ) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "未完成的迁移计时不得预填结束、发布或运行结果",
      });
    }
    return;
  }

  if (
    expectedElapsedMs === null
    || expectedElapsedMs <= 0
    || run.timing.elapsedMs !== expectedElapsedMs
  ) {
    context.addIssue({
      code: "custom",
      path: ["timing", "elapsedMs"],
      message: "迁移耗时必须严格由UTC起止时间连续计算",
    });
  }

  if (
    run.targetRelease !== null
    && run.targetRelease.scenarioId !== run.targetScenarioId
  ) {
    context.addIssue({
      code: "custom",
      path: ["targetRelease", "scenarioId"],
      message: "目标发布必须绑定本次前瞻迁移情境",
    });
  }
  if (
    run.targetRelease !== null
    && run.targetRelease.releaseRef
      === run.baseline.templateBinding.releaseRef
  ) {
    context.addIssue({
      code: "custom",
      path: ["targetRelease", "releaseRef"],
      message: "目标不可变发布不得复用冻结模板发布标识",
    });
  }

  if (run.reuse !== null) {
    const expectedRatio =
      run.reuse.reusedLeafCount / run.reuse.comparableLeafCount;
    if (Math.abs(run.reuse.ratio - expectedRatio) > Number.EPSILON) {
      context.addIssue({
        code: "custom",
        path: ["reuse", "ratio"],
        message: "迁移复用率必须由固定分子和分母计算",
      });
    }
    if (
      run.reuse.reusedJsonPointers.length !== run.reuse.reusedLeafCount
      || run.reuse.reusedLeafCount + run.reuse.changedJsonPointers.length
        !== run.reuse.comparableLeafCount
    ) {
      context.addIssue({
        code: "custom",
        path: ["reuse"],
        message: "迁移复用指针必须与复用率分子分母一致",
      });
    }
    const allPointers = [
      ...run.reuse.reusedJsonPointers,
      ...run.reuse.changedJsonPointers,
    ];
    if (new Set(allPointers).size !== allPointers.length) {
      context.addIssue({
        code: "custom",
        path: ["reuse"],
        message: "迁移复用与变更JSON指针必须唯一且互斥",
      });
    }
  }

  if (
    run.forbiddenRuntimeScan !== null
    && (
      (run.forbiddenRuntimeScan.status === "passed"
        && run.forbiddenRuntimeScan.matches.length > 0)
      || (run.forbiddenRuntimeScan.status === "failed"
        && run.forbiddenRuntimeScan.matches.length === 0)
    )
  ) {
    context.addIssue({
      code: "custom",
      path: ["forbiddenRuntimeScan", "status"],
      message: "题材专用运行时代码扫描状态必须与命中数量一致",
    });
  }

  if (
    new Set(run.modifiedFiles.map((file) => file.path)).size
      !== run.modifiedFiles.length
  ) {
    context.addIssue({
      code: "custom",
      path: ["modifiedFiles"],
      message: "迁移创作文件证据不得重复",
    });
  }

  if (run.status === "passed") {
    const finalValidation =
      run.validationAttempts[run.validationAttempts.length - 1];
    const missingPassedEvidence = (
      run.timing.elapsedMs === null
      || run.timing.elapsedMs > run.timing.targetMaxMs
      || run.modifiedFiles.length === 0
      || !finalValidation?.valid
      || run.reuse === null
      || run.structure?.status !== "passed"
      || run.forbiddenRuntimeScan?.status !== "passed"
      || run.targetRelease === null
      || run.runtimeSmoke?.status !== "passed"
    );
    if (missingPassedEvidence) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "迁移计时只有在工时、配置、校验、发布和运行证据全部通过时才能通过",
      });
    }
    if (
      finalValidation
      && run.targetRelease
      && finalValidation.definitionHash !== run.targetRelease.contentHash
    ) {
      context.addIssue({
        code: "custom",
        path: ["targetRelease", "contentHash"],
        message: "最终校验定义哈希必须等于不可变发布内容哈希",
      });
    }
  }

  if (
    run.timing.elapsedMs !== null
    && run.timing.elapsedMs > run.timing.targetMaxMs
    && run.status !== "failed"
  ) {
    context.addIssue({
      code: "custom",
      path: ["status"],
      message: "连续创作耗时超过目标时必须保留失败判定",
    });
  }
});
export type GoldTransferAuthoringRun = z.infer<
  typeof GoldTransferAuthoringRunSchema
>;

export const GoldTransferConfigurationProofSchema = z.object({
  schemaVersion: z.literal(GoldTechnicalEvidenceSchemaVersion),
  generatedAt: z.string().datetime(),
  scenarioBinding: GoldTechnicalEvidencePlanSchema.shape.scenarioBindings
    .element,
  configurationSourceRefs: z.array(z.string().min(1).max(320)).min(1),
  validation: z.object({
    valid: z.boolean(),
    issueCount: z.number().int().nonnegative(),
    definitionHash: z.string().regex(/^[a-f0-9]{64}$/u),
    validationStamp: z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
  }).strict(),
  observedStructure: z.object({
    studentRoleIds: z.array(z.string().min(1).max(160)),
    privateNpcActorIds: z.array(z.string().min(1).max(160)),
    nodeIds: z.array(z.string().min(1).max(160)),
    eventPolicyCount: z.number().int().nonnegative(),
    teacherApprovalPolicyCount: z.number().int().nonnegative(),
    rubricCriterionCount: z.number().int().nonnegative(),
  }).strict(),
  forbiddenRuntimeScan: z.object({
    scannedPaths: z.array(z.string().min(1).max(320)).min(1),
    topicMarkers: z.array(z.string().min(1).max(320)).min(1),
    matches: z.array(z.object({
      path: z.string().min(1).max(320),
      marker: z.string().min(1).max(320),
    }).strict()),
    status: z.enum(["passed", "failed"]),
  }).strict(),
  architectureStatus: z.enum(["passed", "failed"]),
  authoringTime: z.object({
    targetMaxMinutes: z.number().positive(),
    observedMinutes: z.number().nonnegative().nullable(),
    runId: z.string().min(1).max(120).nullable().default(null),
    startedAt: z.string().datetime().nullable().default(null),
    completedAt: z.string().datetime().nullable().default(null),
    elapsedMs: z.number().int().positive().nullable().default(null),
    baselineGitCommit: z.string()
      .regex(/^[a-f0-9]{40}$/u)
      .nullable()
      .default(null),
    evidenceSnapshotGitCommit: z.string()
      .regex(/^[a-f0-9]{40}$/u)
      .nullable()
      .default(null),
    status: GoldEvidenceStatusSchema,
    evidenceRef: z.string().min(1).max(320).nullable(),
    rationale: z.string().min(1).max(800),
  }).strict(),
  overallStatus: GoldEvidenceStatusSchema,
  claimBoundary: z.string().min(1).max(1_500),
  proofHash: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict().superRefine((proof, context) => {
  if (proof.scenarioBinding.role !== "transfer") {
    context.addIssue({
      code: "custom",
      path: ["scenarioBinding", "role"],
      message: "迁移证明必须绑定 transfer 情境",
    });
  }
  if (
    proof.forbiddenRuntimeScan.status === "passed"
    && proof.forbiddenRuntimeScan.matches.length > 0
  ) {
    context.addIssue({
      code: "custom",
      path: ["forbiddenRuntimeScan", "matches"],
      message: "无题材专用内核扫描通过时不得保留命中项",
    });
  }
  if (
    proof.authoringTime.observedMinutes === null
    && proof.authoringTime.status !== "insufficient"
  ) {
    context.addIssue({
      code: "custom",
      path: ["authoringTime", "status"],
      message: "未观测创作工时时只能标记为证据不足",
    });
  }
  const authoringStartedMs = proof.authoringTime.startedAt === null
    ? null
    : Date.parse(proof.authoringTime.startedAt);
  const authoringCompletedMs = proof.authoringTime.completedAt === null
    ? null
    : Date.parse(proof.authoringTime.completedAt);
  const authoringExpectedElapsedMs = (
    authoringStartedMs === null || authoringCompletedMs === null
  )
    ? null
    : authoringCompletedMs - authoringStartedMs;
  if (proof.authoringTime.observedMinutes !== null) {
    if (
      proof.authoringTime.runId === null
      || proof.authoringTime.evidenceRef === null
      || proof.authoringTime.baselineGitCommit === null
      || proof.authoringTime.evidenceSnapshotGitCommit === null
      || authoringExpectedElapsedMs === null
      || authoringExpectedElapsedMs <= 0
      || proof.authoringTime.elapsedMs !== authoringExpectedElapsedMs
      || Math.abs(
        proof.authoringTime.observedMinutes
          - authoringExpectedElapsedMs / 60_000,
      ) > Number.EPSILON
    ) {
      context.addIssue({
        code: "custom",
        path: ["authoringTime"],
        message: "迁移创作工时必须绑定证据并严格由UTC起止时间计算",
      });
    }
  } else if (
    proof.authoringTime.runId !== null
    || proof.authoringTime.startedAt !== null
    || proof.authoringTime.completedAt !== null
    || proof.authoringTime.elapsedMs !== null
    || proof.authoringTime.baselineGitCommit !== null
    || proof.authoringTime.evidenceSnapshotGitCommit !== null
  ) {
    context.addIssue({
      code: "custom",
      path: ["authoringTime"],
      message: "未观测创作工时时不得填入计时运行字段",
    });
  }
  if (
    proof.authoringTime.status === "passed"
    && (
      proof.authoringTime.observedMinutes === null
      || proof.authoringTime.observedMinutes
        > proof.authoringTime.targetMaxMinutes
      || proof.authoringTime.evidenceRef === null
    )
  ) {
    context.addIssue({
      code: "custom",
      path: ["authoringTime", "status"],
      message: "迁移创作工时只有在完整证据且不超过目标时才能通过",
    });
  }
  if (
    proof.authoringTime.observedMinutes !== null
    && proof.authoringTime.observedMinutes > proof.authoringTime.targetMaxMinutes
    && proof.authoringTime.status !== "failed"
  ) {
    context.addIssue({
      code: "custom",
      path: ["authoringTime", "status"],
      message: "迁移创作工时超过目标时必须标记为失败",
    });
  }
  if (
    proof.authoringTime.status === "insufficient"
    && proof.overallStatus === "passed"
  ) {
    context.addIssue({
      code: "custom",
      path: ["overallStatus"],
      message: "创作工时证据不足时迁移总证明不得标记为通过",
    });
  }
  if (
    proof.overallStatus === "passed"
    && (
      proof.architectureStatus !== "passed"
      || proof.authoringTime.status !== "passed"
    )
  ) {
    context.addIssue({
      code: "custom",
      path: ["overallStatus"],
      message: "迁移总证明仅在架构与前瞻创作工时均通过时才能通过",
    });
  }
});
export type GoldTransferConfigurationProof = z.infer<
  typeof GoldTransferConfigurationProofSchema
>;

const GoldLatencyMeasurementSchema = z.object({
  status: GoldEvidenceStatusSchema,
  environment: z.string().min(1).max(240),
  samples: z.number().int().nonnegative(),
  p50Ms: z.number().nonnegative().nullable(),
  p95Ms: z.number().nonnegative().nullable(),
  maxMs: z.number().nonnegative().nullable(),
  targetP95Ms: z.number().positive(),
  evidenceRefs: z.array(z.string().min(1).max(320)).min(1),
}).strict().superRefine((measurement, context) => {
  const observed = (
    measurement.samples > 0
    && measurement.p50Ms !== null
    && measurement.p95Ms !== null
    && measurement.maxMs !== null
  );
  if (!observed && measurement.status !== "insufficient") {
    context.addIssue({
      code: "custom",
      path: ["status"],
      message: "没有时延样本时只能标记为证据不足",
    });
  }
  if (
    observed
    && measurement.status === "passed"
    && measurement.p95Ms! > measurement.targetP95Ms
  ) {
    context.addIssue({
      code: "custom",
      path: ["p95Ms"],
      message: "P95 超过目标时不得标记为通过",
    });
  }
});

export const GoldTechnicalPerformanceSummarySchema = z.object({
  schemaVersion: z.literal(GoldTechnicalEvidenceSchemaVersion),
  generatedAt: z.string().datetime(),
  localAction: GoldLatencyMeasurementSchema,
  asyncProgress: z.object({
    status: GoldEvidenceStatusSchema,
    targetVisibleWithinMs: z.number().positive(),
    observedWithinMs: z.number().nonnegative().nullable(),
    evidenceRefs: z.array(z.string().min(1).max(320)).min(1),
  }).strict(),
  liveModel: GoldLatencyMeasurementSchema.extend({
    requestedCalls: z.number().int().nonnegative(),
    completedCalls: z.number().int().nonnegative(),
    failedCalls: z.number().int().nonnegative(),
    tokenUsage: z.object({
      input: z.number().int().nonnegative(),
      output: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
    }).strict().nullable(),
    estimatedCostUsd: z.number().nonnegative().nullable(),
    costCalculation: z.string().min(1).max(320).nullable(),
  }).strict(),
  overallStatus: GoldEvidenceStatusSchema,
  claimBoundary: z.string().min(1).max(1_500),
  summaryHash: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict().superRefine((summary, context) => {
  if (
    summary.asyncProgress.observedWithinMs === null
    && summary.asyncProgress.status !== "insufficient"
  ) {
    context.addIssue({
      code: "custom",
      path: ["asyncProgress", "status"],
      message: "没有进度可见时延观测时只能标记为证据不足",
    });
  }
  if (
    summary.asyncProgress.status === "passed"
    && summary.asyncProgress.observedWithinMs! >
      summary.asyncProgress.targetVisibleWithinMs
  ) {
    context.addIssue({
      code: "custom",
      path: ["asyncProgress", "observedWithinMs"],
      message: "进度可见时延超过目标时不得标记为通过",
    });
  }
  const componentStatuses = [
    summary.localAction.status,
    summary.asyncProgress.status,
    summary.liveModel.status,
  ];
  if (
    summary.overallStatus === "passed"
    && componentStatuses.some((status) => status !== "passed")
  ) {
    context.addIssue({
      code: "custom",
      path: ["overallStatus"],
      message: "性能总证明通过要求三个分项全部通过",
    });
  }
});
export type GoldTechnicalPerformanceSummary = z.infer<
  typeof GoldTechnicalPerformanceSummarySchema
>;

export const GoldTechnicalEvidenceManifestSchema = z.object({
  schemaVersion: z.literal(GoldTechnicalEvidenceSchemaVersion),
  manifestVersion: z.string().min(1).max(120),
  generatedAt: z.string().datetime(),
  productVersion: z.string().min(1).max(120),
  sourceGitCommit: z.string().regex(/^[a-f0-9]{40}$/u),
  sourceTreeState: z.literal("clean"),
  planHash: z.string().regex(/^[a-f0-9]{64}$/u),
  scenarioBindings: GoldTechnicalEvidencePlanSchema.shape.scenarioBindings,
  modelBindings: z.array(z.object({
    evidenceKind: z.enum(["contract", "controlled_live"]),
    profileRef: z.string().min(1).max(240),
    provider: z.string().min(1).max(120),
    mode: z.enum(["live", "mock", "unavailable"]),
    model: z.string().min(1).max(160),
    promptAndPolicyHash: z.string().regex(/^[a-f0-9]{64}$/u),
  }).strict()).min(1),
  gateSummary: z.object({
    technicalGates: z.object({
      passed: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative(),
      insufficient: z.number().int().nonnegative(),
    }).strict(),
    causalClaims: z.object({
      passed: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative(),
      insufficient: z.number().int().nonnegative(),
    }).strict(),
    controlledLiveAblation: z.enum([
      "passed",
      "failed",
      "insufficient",
      "not_run",
    ]),
    transferProof: z.enum(["passed", "failed", "insufficient"]),
  }).strict(),
  validationReceipts: z.array(GoldEvidenceValidationReceiptSchema).min(1),
  artifacts: z.array(GoldEvidenceArtifactFileSchema).min(1),
  excludedSensitiveFields: z.array(z.string().min(1).max(160)).min(1),
  knownLimitations: z.array(z.string().min(1).max(800)),
  generationCommand: z.string().min(1).max(800),
  manifestHash: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict().superRefine((manifest, context) => {
  const technicalTotal = Object.values(
    manifest.gateSummary.technicalGates,
  ).reduce((sum, value) => sum + value, 0);
  if (technicalTotal !== GoldTechnicalGateIdSchema.options.length) {
    context.addIssue({
      code: "custom",
      path: ["gateSummary", "technicalGates"],
      message: "manifest 必须汇总十项技术门",
    });
  }
  const causalTotal = Object.values(
    manifest.gateSummary.causalClaims,
  ).reduce((sum, value) => sum + value, 0);
  if (causalTotal !== GoldCausalEvidenceIdSchema.options.length) {
    context.addIssue({
      code: "custom",
      path: ["gateSummary", "causalClaims"],
      message: "manifest 必须汇总五项跨界面因果",
    });
  }
  const paths = manifest.artifacts.map((artifact) => artifact.path);
  if (new Set(paths).size !== paths.length) {
    context.addIssue({
      code: "custom",
      path: ["artifacts"],
      message: "manifest 证据文件路径不得重复",
    });
  }
});
export type GoldTechnicalEvidenceManifest = z.infer<
  typeof GoldTechnicalEvidenceManifestSchema
>;

export const StudentAssessmentFeedbackSchema = z.object({
  evaluationCaseId: z.string().min(1),
  finalScore: z.number().min(0).max(100),
  dimensions: z.array(z.object({
    dimensionId: z.string().min(1),
    label: z.string().min(1),
    score: z.number().min(0).max(100),
    maxScore: z.number().positive().max(100),
    feedback: z.string().min(1).max(1_200),
    evidenceRefs: z.array(z.string().min(1)),
  }).strict()).min(1),
  publicSummary: z.string().min(1).max(1_500),
  finalizedAt: z.string().datetime(),
}).strict();
export type StudentAssessmentFeedback = z.infer<
  typeof StudentAssessmentFeedbackSchema
>;

export const ReviewAssessmentPayloadSchema = z.object({
  evaluationCaseId: z.string().min(1),
  expectedArbitrationRevision: z.number().int().positive(),
  expectedDecisionHash: z.string().regex(/^[a-f0-9]{64}$/u),
  expectedEvidenceBundleHash: z.string().regex(/^[a-f0-9]{64}$/u),
  dimensions: z.array(TeacherCriterionDecisionInputSchema).min(1),
  publicSummary: z.string().min(1).max(1_500),
  internalNote: z.string().min(1).max(1_500),
  requestId: z.string().min(1),
}).strict();
export type ReviewAssessmentPayload = z.infer<
  typeof ReviewAssessmentPayloadSchema
>;

export const RetryEvaluationBranchPayloadSchema = z.object({
  evaluationCaseId: z.string().min(1),
  evaluatorKind: EvaluationEvaluatorKindSchema.exclude(["rule"]),
  expectedCaseHash: z.string().regex(/^[a-f0-9]{64}$/u),
  expectedEvidenceBundleHash: z.string().regex(/^[a-f0-9]{64}$/u),
  expectedUnavailableProposalId: z.string().min(1),
  expectedUnavailableProposalHash: z.string().regex(/^[a-f0-9]{64}$/u),
  expectedArbitrationRevision: z.number().int().positive(),
  expectedDecisionHash: z.string().regex(/^[a-f0-9]{64}$/u),
  requestId: z.string().min(1),
}).strict();
export type RetryEvaluationBranchPayload = z.infer<
  typeof RetryEvaluationBranchPayloadSchema
>;

export const RetryLearningCandidateGenerationPayloadSchema = z.object({
  evaluationCaseId: z.string().min(1),
  teacherReviewId: z.string().min(1),
  expectedFinalHash: z.string().regex(/^[a-f0-9]{64}$/u),
  failureEventId: z.string().min(1),
  expectedFailedTaskId: z.string().min(1),
  requestId: z.string().min(1),
}).strict();
export type RetryLearningCandidateGenerationPayload = z.infer<
  typeof RetryLearningCandidateGenerationPayloadSchema
>;

export const AgentRecoveryStatusSchema = z.enum([
  "ready",
  "in_flight",
  "exhausted",
]);
export type AgentRecoveryStatus = z.infer<
  typeof AgentRecoveryStatusSchema
>;

export const RetryableEvaluationBranchSchema = z.object({
  evaluationCaseId: z.string().min(1),
  evaluatorKind: EvaluationEvaluatorKindSchema.exclude(["rule"]),
  unavailableProposalId: z.string().min(1),
  unavailableProposalHash: z.string().regex(/^[a-f0-9]{64}$/u),
  errorCode: z.string().min(1),
  expectedCaseHash: z.string().regex(/^[a-f0-9]{64}$/u),
  expectedEvidenceBundleHash: z.string().regex(/^[a-f0-9]{64}$/u),
  expectedArbitrationRevision: z.number().int().positive(),
  expectedDecisionHash: z.string().regex(/^[a-f0-9]{64}$/u),
  manualRetryCount: z.number().int().nonnegative(),
  maximumManualRetries: z.number().int().positive(),
  status: AgentRecoveryStatusSchema,
  latestRetryEventId: z.string().min(1).nullable(),
}).strict();
export type RetryableEvaluationBranch = z.infer<
  typeof RetryableEvaluationBranchSchema
>;

export const RetryableLearningGenerationFailureSchema = z.object({
  evaluationCaseId: z.string().min(1),
  teacherReviewId: z.string().min(1),
  expectedFinalHash: z.string().regex(/^[a-f0-9]{64}$/u),
  failureEventId: z.string().min(1),
  failedTaskId: z.string().min(1),
  errorCode: z.string().min(1),
  failedAt: z.string().datetime(),
  manualRetryCount: z.number().int().nonnegative(),
  maximumManualRetries: z.number().int().positive(),
  status: AgentRecoveryStatusSchema,
  latestRetryEventId: z.string().min(1).nullable(),
}).strict();
export type RetryableLearningGenerationFailure = z.infer<
  typeof RetryableLearningGenerationFailureSchema
>;

export const LearningCandidateSchema = z.object({
  schemaVersion: z.literal(LearningGovernanceSchemaVersion)
    .default(LearningGovernanceSchemaVersion),
  candidateId: z.string().min(1),
  candidateType: z.enum([
    "skill",
    "rule",
    "event",
    "assessment_example",
    "prompt_patch",
  ]),
  status: z.literal("pending_review"),
  title: z.string().min(1),
  proposedContent: z.record(z.string(), z.unknown()),
  sourceEvidenceRefs: z.array(z.string()).min(1),
  sourceFinalAssessmentId: z.string().min(1).nullable().default(null),
  evaluationCaseId: z.string().min(1).nullable().default(null),
  applicabilityScope: z.object({
    courseId: z.string().min(1),
    scenarioId: z.string().min(1).nullable(),
    rubricId: z.string().min(1).nullable(),
  }).strict().nullable().default(null),
  expectedBenefit: z.string().min(1).max(1_200).nullable().default(null),
  knownRisks: z.array(z.string().min(1)).default([]),
  conflictRefs: z.array(z.string().min(1)).default([]),
  generatedBy: z.string().min(1).nullable().default(null),
  generatorTraceId: z.string().min(1).nullable().default(null),
  candidateHash: z.string().regex(/^[a-f0-9]{64}$/u).nullable().default(null),
  createdAt: z.string().datetime(),
}).strict();
export type LearningCandidate = z.infer<typeof LearningCandidateSchema>;

export const LearningReplayCheckSchema = z.object({
  checkId: z.string().min(1),
  status: z.enum(["passed", "failed"]),
  summary: z.string().min(1).max(800),
}).strict();
export type LearningReplayCheck = z.infer<typeof LearningReplayCheckSchema>;

export const LearningReplayReportSchema = z.object({
  schemaVersion: z.literal(LearningGovernanceSchemaVersion),
  reportId: z.string().min(1),
  candidateId: z.string().min(1),
  candidateHash: z.string().regex(/^[a-f0-9]{64}$/u),
  datasetVersion: z.string().min(1),
  replayEngineVersion: z.string().min(1),
  baselineReleaseId: z.string().min(1).nullable(),
  status: z.enum(["passed", "failed"]),
  checks: z.array(LearningReplayCheckSchema).min(1),
  testCaseCount: z.number().int().positive(),
  passedCaseCount: z.number().int().nonnegative(),
  scoreDrift: z.number().nonnegative(),
  privacyViolationCount: z.number().int().nonnegative(),
  fixtureHash: z.string().regex(/^[a-f0-9]{64}$/u),
  reportHash: z.string().regex(/^[a-f0-9]{64}$/u),
  completedAt: z.string().datetime(),
}).strict();
export type LearningReplayReport = z.infer<
  typeof LearningReplayReportSchema
>;

export const LearningCandidateReviewSchema = z.object({
  schemaVersion: z.literal(LearningGovernanceSchemaVersion),
  reviewId: z.string().min(1),
  candidateId: z.string().min(1),
  candidateHash: z.string().regex(/^[a-f0-9]{64}$/u),
  replayReportId: z.string().min(1),
  replayReportHash: z.string().regex(/^[a-f0-9]{64}$/u),
  decision: z.enum(["approve", "reject"]),
  reason: z.string().min(1).max(1_200),
  reviewedBy: z.string().min(1),
  reviewedAt: z.string().datetime(),
  requestId: z.string().min(1),
  reviewHash: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();
export type LearningCandidateReview = z.infer<
  typeof LearningCandidateReviewSchema
>;

export const LearningArtifactReleaseSchema = z.object({
  schemaVersion: z.literal(LearningGovernanceSchemaVersion),
  releaseId: z.string().min(1),
  artifactKey: z.string().min(1),
  courseId: z.string().min(1),
  version: z.string().regex(/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u),
  parentReleaseId: z.string().min(1).nullable(),
  candidateId: z.string().min(1),
  candidateHash: z.string().regex(/^[a-f0-9]{64}$/u),
  reviewId: z.string().min(1),
  replayReportId: z.string().min(1),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  publishedBy: z.string().min(1),
  publishedAt: z.string().datetime(),
  requestId: z.string().min(1),
}).strict();
export type LearningArtifactRelease = z.infer<
  typeof LearningArtifactReleaseSchema
>;

export const LearningReleaseRollbackSchema = z.object({
  schemaVersion: z.literal(LearningGovernanceSchemaVersion),
  rollbackId: z.string().min(1),
  artifactKey: z.string().min(1),
  activeReleaseId: z.string().min(1),
  activeContentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  targetReleaseId: z.string().min(1).nullable(),
  reason: z.string().min(1).max(1_200),
  rolledBackBy: z.string().min(1),
  rolledBackAt: z.string().datetime(),
  requestId: z.string().min(1),
  rollbackHash: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();
export type LearningReleaseRollback = z.infer<
  typeof LearningReleaseRollbackSchema
>;

export const ReviewLearningCandidatePayloadSchema = z.object({
  candidateId: z.string().min(1),
  expectedCandidateHash: z.string().regex(/^[a-f0-9]{64}$/u),
  expectedReplayReportHash: z.string().regex(/^[a-f0-9]{64}$/u),
  decision: z.enum(["approve", "reject"]),
  reason: z.string().min(1).max(1_200),
  requestId: z.string().min(1),
}).strict();
export type ReviewLearningCandidatePayload = z.infer<
  typeof ReviewLearningCandidatePayloadSchema
>;

export const PublishLearningReleasePayloadSchema = z.object({
  candidateId: z.string().min(1),
  reviewId: z.string().min(1),
  replayReportId: z.string().min(1),
  expectedActiveReleaseId: z.string().min(1).nullable(),
  version: z.string().regex(/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u),
  requestId: z.string().min(1),
}).strict();
export type PublishLearningReleasePayload = z.infer<
  typeof PublishLearningReleasePayloadSchema
>;

export const RollbackLearningReleasePayloadSchema = z.object({
  activeReleaseId: z.string().min(1),
  expectedActiveContentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  targetReleaseId: z.string().min(1).nullable(),
  reason: z.string().min(1).max(1_200),
  requestId: z.string().min(1),
}).strict();
export type RollbackLearningReleasePayload = z.infer<
  typeof RollbackLearningReleasePayloadSchema
>;

export const RoleInteractionKindSchema = z.enum([
  "question",
  "follow_up",
  "request_commitment",
  "request_tool",
]);
export type RoleInteractionKind = z.infer<typeof RoleInteractionKindSchema>;

export const RoleInteractionTopicSchema = z.enum([
  "heritage_process",
  "visitor_count",
  "copyright_scope",
  "release_decision",
  "platform_review",
]);
export type RoleInteractionTopic = z.infer<typeof RoleInteractionTopicSchema>;

export const RoleResponseActSchema = z.enum([
  "answer",
  "clarify",
  "refuse",
  "commit",
  "tool_request",
]);
export type RoleResponseAct = z.infer<typeof RoleResponseActSchema>;

export const RoleStanceSchema = z.enum([
  "cooperative",
  "cautious",
  "restricted",
  "committed",
]);
export type RoleStance = z.infer<typeof RoleStanceSchema>;

export const RoleInteractionRequestSchema = z.object({
  schemaVersion: z.literal(RoleInteractionSchemaVersion),
  interactionId: z.string().min(1),
  threadId: z.string().min(1),
  replyToInteractionId: z.string().min(1).nullable(),
  optionId: z.string().min(1),
  fromActorId: z.string().min(1),
  fromRoleId: RoleIdSchema,
  toActorId: z.string().min(1),
  toRoleId: RoleIdSchema,
  kind: RoleInteractionKindSchema,
  topic: RoleInteractionTopicSchema,
  content: z.string().min(1).max(1_200),
  turn: z.number().int().positive(),
  relatedEventIds: z.array(z.string().min(1)),
  createdAt: z.string().datetime(),
}).strict();
export type RoleInteractionRequest = z.infer<typeof RoleInteractionRequestSchema>;

export const RoleCommitmentSchema = z.object({
  commitmentId: z.string().min(1),
  ownerActorId: z.string().min(1),
  granteeActorId: z.string().min(1),
  sourceInteractionId: z.string().min(1),
  summary: z.string().min(1).max(600),
  dueWhen: z.string().min(1).max(300),
  status: z.enum(["active", "fulfilled", "revoked"]),
  revision: z.number().int().positive(),
  expiresAt: z.string().datetime().nullable(),
  visibleToActorIds: z.array(z.string().min(1)).min(2),
}).strict();
export type RoleCommitment = z.infer<typeof RoleCommitmentSchema>;

export const RoleInteractionResponseSchema = z.object({
  schemaVersion: z.literal(RoleInteractionSchemaVersion),
  responseId: z.string().min(1),
  interactionId: z.string().min(1),
  threadId: z.string().min(1),
  fromActorId: z.string().min(1),
  fromRoleId: RoleIdSchema,
  toActorId: z.string().min(1),
  toRoleId: RoleIdSchema,
  act: RoleResponseActSchema,
  topic: RoleInteractionTopicSchema,
  content: z.string().min(1).max(1_200),
  stance: RoleStanceSchema,
  commitment: RoleCommitmentSchema.nullable(),
  citedFactIds: z.array(z.string().min(1)),
  confidence: z.number().min(0).max(1),
  createdAt: z.string().datetime(),
}).strict();
export type RoleInteractionResponse = z.infer<typeof RoleInteractionResponseSchema>;

export const RoleInteractionRecordSchema = z.object({
  request: RoleInteractionRequestSchema,
  response: RoleInteractionResponseSchema.nullable(),
  status: z.enum(["pending", "responded"]),
}).strict();
export type RoleInteractionRecord = z.infer<typeof RoleInteractionRecordSchema>;

export const RoleInteractionOptionSchema = z.object({
  optionId: z.string().min(1),
  targetActorId: z.string().min(1),
  targetRoleId: RoleIdSchema,
  targetDisplayName: z.string().min(1),
  kind: RoleInteractionKindSchema,
  topic: RoleInteractionTopicSchema,
  label: z.string().min(1),
  description: z.string().min(1),
  enabled: z.boolean(),
  disabledReason: z.string().nullable(),
}).strict();
export type RoleInteractionOption = z.infer<typeof RoleInteractionOptionSchema>;

export const RoleInteractionCommandPayloadSchema = z.object({
  optionId: z.string().min(1),
}).strict();
export type RoleInteractionCommandPayload = z.infer<typeof RoleInteractionCommandPayloadSchema>;

export const ExperienceChoiceCommandPayloadSchema = z.object({
  choiceRef: z.string().min(1),
}).strict();
export type ExperienceChoiceCommandPayload = z.infer<
  typeof ExperienceChoiceCommandPayloadSchema
>;

export const RoleMessageSchema = z.object({
  messageId: z.string().min(1),
  actorId: z.string().min(1),
  roleId: RoleIdSchema,
  displayName: z.string().min(1),
  content: z.string().min(1),
  timestamp: z.string().datetime(),
  relatedEventId: z.string().nullable(),
  visibility: z.array(VisibilityScopeSchema),
  audience: ResourceAudienceSchema.optional(),
  channel: z.enum(["announcement", "role_interaction"]).default("announcement"),
  threadId: z.string().min(1).nullable().default(null),
  replyToMessageId: z.string().min(1).nullable().default(null),
  interactionId: z.string().min(1).nullable().default(null),
  interactionKind: RoleInteractionKindSchema.nullable().default(null),
  responseAct: RoleResponseActSchema.nullable().default(null),
  topic: RoleInteractionTopicSchema.nullable().default(null),
  stance: RoleStanceSchema.nullable().default(null),
  commitment: RoleCommitmentSchema.nullable().default(null),
  turn: z.number().int().positive().nullable().default(null),
  recipientActorIds: z.array(z.string().min(1)).default([]),
  sourceRefs: z.array(z.string().min(1)).default([]),
});
export type RoleMessage = z.infer<typeof RoleMessageSchema>;

export const ActionDefinitionSchema = z.object({
  command: CommandNameSchema,
  label: z.string().min(1),
  description: z.string().min(1),
  tone: z.enum(["primary", "danger", "warning", "neutral"]),
  enabled: z.boolean(),
  disabledReason: z.string().nullable(),
});
export type ActionDefinition = z.infer<typeof ActionDefinitionSchema>;

const ScenarioContentStringListSchema = z.array(
  z.string().min(1).max(600),
).min(1).max(12);

export const ScenarioLearningObjectiveSchema = z.object({
  objectiveId: z.string().min(1),
  label: z.string().min(1).max(120),
  competencyId: z.string().min(1),
  description: z.string().min(1).max(800),
  evidenceKinds: ScenarioContentStringListSchema,
}).strict();
export type ScenarioLearningObjective = z.infer<
  typeof ScenarioLearningObjectiveSchema
>;

export const ScenarioRoleBriefSchema = z.object({
  roleId: RoleIdSchema,
  mission: z.string().min(1).max(1_200),
  responsibilities: ScenarioContentStringListSchema,
  collaborationRoleIds: z.array(RoleIdSchema).max(12),
  primaryNodeIds: z.array(z.string().min(1)).min(1),
  deliverableTemplateIds: z.array(z.string().min(1)),
  successSignals: ScenarioContentStringListSchema,
  decisionBoundaries: ScenarioContentStringListSchema,
}).strict();
export type ScenarioRoleBrief = z.infer<typeof ScenarioRoleBriefSchema>;

export const ScenarioExperienceKindSchema = z.enum([
  "standard",
  "flagship",
  "micro_transfer",
]);
export type ScenarioExperienceKind = z.infer<
  typeof ScenarioExperienceKindSchema
>;

export const ScenarioExperienceSceneSchema = z.object({
  sceneId: z.string().min(1),
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(1_200),
  visualMode: z.enum(["structured_cards", "fixed_2d", "fixed_2_5d"]),
  nodeIds: z.array(z.string().min(1)).min(1),
}).strict();
export type ScenarioExperienceScene = z.infer<
  typeof ScenarioExperienceSceneSchema
>;

export const ScenarioNpcPrivatePerspectiveSchema = z.object({
  knownInformation: ScenarioContentStringListSchema,
  withheldInformation: ScenarioContentStringListSchema,
  disclosureRules: ScenarioContentStringListSchema,
}).strict();
export type ScenarioNpcPrivatePerspective = z.infer<
  typeof ScenarioNpcPrivatePerspectiveSchema
>;

export const ScenarioNpcInstanceSchema = z.object({
  actorId: z.string().min(1),
  roleId: RoleIdSchema,
  displayName: z.string().min(1).max(120),
  sceneIds: z.array(z.string().min(1)).min(1),
  privatePerspective: ScenarioNpcPrivatePerspectiveSchema,
}).strict();
export type ScenarioNpcInstance = z.infer<typeof ScenarioNpcInstanceSchema>;

export const ScenarioExperienceHotspotSchema = z.object({
  hotspotId: z.string().min(1),
  sceneId: z.string().min(1),
  label: z.string().min(1).max(120),
  description: z.string().min(1).max(800),
  targetActorId: z.string().min(1).nullable(),
  visibleToRoleIds: z.array(RoleIdSchema).min(1),
  interactionOptionIds: z.array(z.string().min(1)),
}).strict();
export type ScenarioExperienceHotspot = z.infer<
  typeof ScenarioExperienceHotspotSchema
>;

export const ScenarioOperationTaskSchema = z.object({
  taskId: z.string().min(1),
  label: z.string().min(1).max(120),
  description: z.string().min(1).max(800),
  roleIds: z.array(RoleIdSchema).min(1),
  expectedOutput: z.string().min(1).max(600),
  completionSignal: z.string().min(1).max(240),
}).strict();
export type ScenarioOperationTask = z.infer<
  typeof ScenarioOperationTaskSchema
>;

export const ScenarioWorldOpportunitySchema = z.object({
  opportunityId: z.string().min(1),
  sceneId: z.string().min(1),
  hotspotId: z.string().min(1),
  label: z.string().min(1).max(120),
  choiceRefs: z.array(z.string().min(1)).min(1),
  studentVisibleConsequence: z.string().min(1).max(800),
}).strict();
export type ScenarioWorldOpportunity = z.infer<
  typeof ScenarioWorldOpportunitySchema
>;

export const ScenarioNpcInformationGapSchema = z.object({
  gapId: z.string().min(1),
  npcActorId: z.string().min(1),
  knownInformation: z.string().min(1).max(800),
  withheldInformation: z.string().min(1).max(800),
  revealCondition: z.string().min(1).max(800),
  resultingObjectKinds: ScenarioContentStringListSchema,
}).strict();
export type ScenarioNpcInformationGap = z.infer<
  typeof ScenarioNpcInformationGapSchema
>;

export const ScenarioAgentContributionSchema = z.object({
  contributionId: z.string().min(1),
  templateId: z.string().min(1),
  plane: AgentTemplatePlaneSchema,
  trigger: z.string().min(1).max(600),
  outputKind: z.string().min(1).max(240),
  authority: z.enum([
    "advisory_only",
    "candidate_requires_teacher",
    "deterministic",
  ]),
}).strict();
export type ScenarioAgentContribution = z.infer<
  typeof ScenarioAgentContributionSchema
>;

export const ScenarioDynamicEventSchema = z.object({
  dynamicEventId: z.string().min(1),
  eventType: EventTypeSchema,
  triggerKind: z.enum([
    "initial_state",
    "student_action",
    "agent_candidate",
    "teacher_decision",
  ]),
  triggerRef: z.string().min(1),
  worldChanges: ScenarioContentStringListSchema,
  affectedTaskIds: z.array(z.string().min(1)).min(1),
  approvalPolicyId: z.string().min(1).nullable(),
}).strict();
export type ScenarioDynamicEvent = z.infer<
  typeof ScenarioDynamicEventSchema
>;

export const ScenarioStageDeliverableSchema = z.object({
  deliverableId: z.string().min(1),
  label: z.string().min(1).max(120),
  objectKind: z.string().min(1).max(120),
  templateId: z.string().min(1).nullable(),
  required: z.boolean(),
}).strict();
export type ScenarioStageDeliverable = z.infer<
  typeof ScenarioStageDeliverableSchema
>;

export const ScenarioCapabilityEvidenceSchema = z.object({
  evidenceRequirementId: z.string().min(1),
  competencyId: z.string().min(1),
  behavior: z.string().min(1).max(800),
  evidenceKind: z.string().min(1).max(240),
  sourceRefs: z.array(z.string().min(1)).min(1),
  successCriterion: z.string().min(1).max(800),
}).strict();
export type ScenarioCapabilityEvidence = z.infer<
  typeof ScenarioCapabilityEvidenceSchema
>;

export const ScenarioNodeExperienceMappingSchema = z.object({
  nodeId: z.string().min(1),
  operationTasks: z.array(ScenarioOperationTaskSchema).min(1),
  worldOpportunities: z.array(ScenarioWorldOpportunitySchema).min(1),
  npcInformationGaps: z.array(ScenarioNpcInformationGapSchema).min(1),
  agentContributions: z.array(ScenarioAgentContributionSchema).min(1),
  dynamicEvents: z.array(ScenarioDynamicEventSchema).min(1),
  stageDeliverables: z.array(ScenarioStageDeliverableSchema).min(1),
  capabilityEvidence: z.array(ScenarioCapabilityEvidenceSchema).min(1),
}).strict();
export type ScenarioNodeExperienceMapping = z.infer<
  typeof ScenarioNodeExperienceMappingSchema
>;

export const ScenarioCausalBranchSchema = z.object({
  branchId: z.string().min(1),
  nodeId: z.string().min(1),
  label: z.string().min(1).max(160),
  studentChoiceRef: z.string().min(1),
  agentContributionRef: z.string().min(1),
  worldConsequenceRef: z.string().min(1),
  capabilityEvidenceRef: z.string().min(1),
}).strict();
export type ScenarioCausalBranch = z.infer<
  typeof ScenarioCausalBranchSchema
>;

export const ScenarioFixedEvaluationSchema = z.object({
  evaluationId: z.string().min(1),
  rubricId: z.string().min(1),
  rubricVersion: z.string().min(1),
  evidenceRequirementIds: z.array(z.string().min(1)).min(1),
  teacherFinalRequired: z.literal(true),
}).strict();
export type ScenarioFixedEvaluation = z.infer<
  typeof ScenarioFixedEvaluationSchema
>;

export const ScenarioExperienceDesignSchema = z.object({
  schemaVersion: z.literal(ScenarioExperienceSchemaVersion),
  contentVersion: z.string().regex(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u,
  ),
  kind: ScenarioExperienceKindSchema,
  summary: z.string().min(1).max(1_200),
  scenes: z.array(ScenarioExperienceSceneSchema).min(1),
  npcInstances: z.array(ScenarioNpcInstanceSchema).min(1),
  hotspots: z.array(ScenarioExperienceHotspotSchema).min(1),
  nodeMappings: z.array(ScenarioNodeExperienceMappingSchema).min(1),
  causalBranches: z.array(ScenarioCausalBranchSchema).min(1),
  fixedEvaluation: ScenarioFixedEvaluationSchema,
}).strict();
export type ScenarioExperienceDesign = z.infer<
  typeof ScenarioExperienceDesignSchema
>;

export const StudentScenarioNodeExperienceMappingSchema = z.object({
  nodeId: z.string().min(1),
  operationTasks: z.array(ScenarioOperationTaskSchema),
  worldOpportunities: z.array(ScenarioWorldOpportunitySchema),
  stageDeliverables: z.array(ScenarioStageDeliverableSchema),
  capabilityEvidence: z.array(ScenarioCapabilityEvidenceSchema),
}).strict();
export type StudentScenarioNodeExperienceMapping = z.infer<
  typeof StudentScenarioNodeExperienceMappingSchema
>;

export const StudentScenarioExperienceGuideSchema = z.object({
  schemaVersion: z.literal(ScenarioExperienceSchemaVersion),
  contentVersion: z.string().min(1),
  kind: ScenarioExperienceKindSchema,
  summary: z.string().min(1),
  currentScenes: z.array(ScenarioExperienceSceneSchema),
  currentHotspots: z.array(ScenarioExperienceHotspotSchema),
  currentNodeMapping:
    StudentScenarioNodeExperienceMappingSchema.nullable(),
  fixedEvaluation: ScenarioFixedEvaluationSchema,
}).strict();
export type StudentScenarioExperienceGuide = z.infer<
  typeof StudentScenarioExperienceGuideSchema
>;

export const StructuredWorldSignalKindSchema = z.enum([
  "clue",
  "commitment",
  "constraint",
  "material",
  "risk",
  "consequence",
  "capability_evidence",
]);
export type StructuredWorldSignalKind = z.infer<
  typeof StructuredWorldSignalKindSchema
>;

export const StructuredWorldSceneStateSchema = z.object({
  sceneId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  visualMode: z.enum(["structured_cards", "fixed_2d", "fixed_2_5d"]),
  phase: z.enum([
    "active",
    "incident",
    "paused",
    "review",
    "completed",
  ]),
  riskLevel: z.enum(["low", "medium", "high"]),
  stateTags: z.array(z.string().min(1)).max(12),
}).strict();
export type StructuredWorldSceneState = z.infer<
  typeof StructuredWorldSceneStateSchema
>;

export const StructuredWorldChoiceSchema = z.object({
  choiceRef: z.string().min(1),
  kind: z.enum(["role_interaction", "course_task"]),
  label: z.string().min(1),
  description: z.string().min(1),
  enabled: z.boolean(),
  disabledReason: z.string().min(1).nullable(),
  command: z.enum([
    "send_role_interaction",
    "record_experience_choice",
  ]).nullable(),
}).strict();
export type StructuredWorldChoice = z.infer<
  typeof StructuredWorldChoiceSchema
>;

export const StructuredWorldHotspotSchema = z.object({
  hotspotId: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1),
  targetActorId: z.string().min(1).nullable(),
  targetDisplayName: z.string().min(1).nullable(),
  targetRoleId: RoleIdSchema.nullable(),
  status: z.enum([
    "available",
    "awaiting",
    "responded",
    "locked",
    "observed",
  ]),
  relationship: z.enum([
    "unknown",
    "cooperative",
    "cautious",
    "restricted",
    "committed",
  ]),
  latestResponse: z.string().min(1).nullable(),
  consequencePreview: z.string().min(1).nullable(),
  choices: z.array(StructuredWorldChoiceSchema).max(12),
}).strict();
export type StructuredWorldHotspot = z.infer<
  typeof StructuredWorldHotspotSchema
>;

export const StructuredWorldTaskStateSchema = z.object({
  taskId: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1),
  expectedOutput: z.string().min(1),
  status: z.enum([
    "ready",
    "in_progress",
    "waiting",
    "completed",
    "blocked",
  ]),
  priority: z.enum(["normal", "urgent"]),
  statusReason: z.string().min(1),
  sourceEventIds: z.array(z.string().min(1)).max(32),
}).strict();
export type StructuredWorldTaskState = z.infer<
  typeof StructuredWorldTaskStateSchema
>;

export const CurrentTaskAnchorPhaseSchema = z.enum([
  "no_task",
  "not_triggered",
  "ready",
  "in_progress",
  "waiting",
  "completed",
  "blocked",
]);
export type CurrentTaskAnchorPhase = z.infer<
  typeof CurrentTaskAnchorPhaseSchema
>;

export const CurrentTaskAnchorSchema = z.object({
  taskId: z.string().min(1).nullable(),
  phase: CurrentTaskAnchorPhaseSchema,
  stateVersion: z.number().int().nonnegative(),
  sourceEventId: z.string().min(1).nullable(),
  priority: z.enum(["none", "normal", "urgent"]),
  worldTarget: z.object({
    mode: z.literal("world_interaction"),
    sceneId: z.string().min(1),
    taskId: z.string().min(1),
  }).strict().nullable(),
  latestFeedbackReason: z.string().min(1),
}).strict().superRefine((anchor, context) => {
  if (anchor.phase === "no_task") {
    if (
      anchor.taskId !== null
      || anchor.sourceEventId !== null
      || anchor.priority !== "none"
      || anchor.worldTarget !== null
    ) {
      context.addIssue({
        code: "custom",
        message: "no_task 锚点不得携带任务、来源事件、优先级或现场目标",
      });
    }
    return;
  }
  if (
    anchor.taskId === null
    || anchor.priority === "none"
    || anchor.worldTarget === null
  ) {
    context.addIssue({
      code: "custom",
      message: "有效任务锚点必须携带任务、优先级和现场目标",
    });
    return;
  }
  if (anchor.worldTarget.taskId !== anchor.taskId) {
    context.addIssue({
      code: "custom",
      message: "现场目标必须指向当前任务",
      path: ["worldTarget", "taskId"],
    });
  }
  if (
    anchor.phase === "not_triggered"
    && anchor.sourceEventId !== null
  ) {
    context.addIssue({
      code: "custom",
      message: "未触发任务不得声明来源事件",
      path: ["sourceEventId"],
    });
  }
});
export type CurrentTaskAnchor = z.infer<typeof CurrentTaskAnchorSchema>;

export const StructuredWorldEventCardSchema = z.object({
  dynamicEventId: z.string().min(1),
  eventType: EventTypeSchema,
  triggerKind: z.enum([
    "initial_state",
    "student_action",
    "agent_candidate",
    "teacher_decision",
  ]),
  title: z.string().min(1),
  worldChanges: z.array(z.string().min(1)).min(1),
  affectedTaskIds: z.array(z.string().min(1)).min(1),
  sourceEventId: z.string().min(1),
  rootActionId: z.string().min(1).nullable(),
  sourceMode: ActionSourceModeSchema.nullable(),
  tone: z.enum(["info", "warning", "critical", "success"]),
}).strict();
export type StructuredWorldEventCard = z.infer<
  typeof StructuredWorldEventCardSchema
>;

export const StructuredWorldSignalSchema = z.object({
  signalId: z.string().min(1),
  kind: StructuredWorldSignalKindSchema,
  label: z.string().min(1),
  detail: z.string().min(1),
  sourceRef: z.string().min(1),
  sourceEventId: z.string().min(1).nullable(),
  rootActionId: z.string().min(1).nullable(),
  sourceMode: ActionSourceModeSchema.nullable(),
}).strict();
export type StructuredWorldSignal = z.infer<
  typeof StructuredWorldSignalSchema
>;

export const StructuredWorldCausalReplaySchema = z.object({
  rootActionId: z.string().min(1),
  sourceMode: ActionSourceModeSchema,
  commandName: CommandNameSchema,
  firstStateVersion: z.number().int().positive(),
  lastStateVersion: z.number().int().positive(),
  eventIds: z.array(z.string().min(1)).min(1).max(64),
  eventTypes: z.array(EventTypeSchema).min(1).max(64),
  evidenceIds: z.array(z.string().min(1)).max(64),
  summary: z.string().min(1),
}).strict();
export type StructuredWorldCausalReplay = z.infer<
  typeof StructuredWorldCausalReplaySchema
>;

export const StructuredWorldEvidenceContinuitySchema = z.object({
  caseState: z.enum(["collecting", "fixed", "teacher_final"]),
  visibleEvidenceCount: z.number().int().nonnegative(),
  fixedVisibleEvidenceCount: z.number().int().nonnegative(),
  sourceModes: z.array(ActionSourceModeSchema),
  teacherFinalRequired: z.literal(true),
}).strict();
export type StructuredWorldEvidenceContinuity = z.infer<
  typeof StructuredWorldEvidenceContinuitySchema
>;

export const StructuredWorldStageProjectionSchema = z.object({
  schemaVersion: z.literal(StructuredWorldStageSchemaVersion),
  scene: StructuredWorldSceneStateSchema,
  hotspots: z.array(StructuredWorldHotspotSchema),
  tasks: z.array(StructuredWorldTaskStateSchema),
  eventCards: z.array(StructuredWorldEventCardSchema),
  signals: z.array(StructuredWorldSignalSchema),
  causalReplay: z.array(StructuredWorldCausalReplaySchema),
  evidenceContinuity: StructuredWorldEvidenceContinuitySchema,
}).strict();
export type StructuredWorldStageProjection = z.infer<
  typeof StructuredWorldStageProjectionSchema
>;

export const ScenarioNodeGuideSchema = z.object({
  nodeId: z.string().min(1),
  situation: z.string().min(1).max(1_200),
  studentGoal: z.string().min(1).max(800),
  requiredOutputs: ScenarioContentStringListSchema,
  requiredMaterialIds: z.array(z.string().min(1)),
  suggestedArtifactTemplateIds: z.array(z.string().min(1)),
  decisionQuestions: ScenarioContentStringListSchema,
  teacherFocus: ScenarioContentStringListSchema,
}).strict();
export type ScenarioNodeGuide = z.infer<typeof ScenarioNodeGuideSchema>;

export const ScenarioDebriefGuideSchema = z.object({
  completionChecklist: ScenarioContentStringListSchema,
  reflectionPrompts: ScenarioContentStringListSchema,
  transferPrompt: z.string().min(1).max(1_200),
}).strict();
export type ScenarioDebriefGuide = z.infer<typeof ScenarioDebriefGuideSchema>;

export const ScenarioCourseGuideSchema = z.object({
  contentVersion: z.string().regex(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u,
  ),
  finalDeliverable: z.string().min(1).max(1_200),
  learningObjectives: z.array(ScenarioLearningObjectiveSchema).min(1),
  roleBriefs: z.array(ScenarioRoleBriefSchema).min(1),
  nodeGuides: z.array(ScenarioNodeGuideSchema).min(1),
  debrief: ScenarioDebriefGuideSchema,
}).strict();
export type ScenarioCourseGuide = z.infer<typeof ScenarioCourseGuideSchema>;

export const StudentScenarioNodeGuideSchema = ScenarioNodeGuideSchema.omit({
  teacherFocus: true,
});
export type StudentScenarioNodeGuide = z.infer<
  typeof StudentScenarioNodeGuideSchema
>;

export const StudentScenarioCourseGuideSchema = z.object({
  contentVersion: z.string().min(1),
  finalDeliverable: z.string().min(1),
  learningObjectives: z.array(ScenarioLearningObjectiveSchema),
  activeRoleBrief: ScenarioRoleBriefSchema.nullable(),
  currentNodeGuide: StudentScenarioNodeGuideSchema.nullable(),
  debrief: ScenarioDebriefGuideSchema,
}).strict();
export type StudentScenarioCourseGuide = z.infer<
  typeof StudentScenarioCourseGuideSchema
>;

export const StateProjectionSchema = MessageMetaSchema.extend({
  kind: z.literal("StateProjection"),
  actorKind: ActorKindSchema,
  role: RoleContractSchema,
  sessionEpoch: z.string().min(1),
  stateVersion: z.number().int().nonnegative(),
  scenario: z.object({
    scenarioId: z.string().min(1),
    version: z.string().min(1),
    releaseId: z.string().min(1),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
    title: z.string(),
    courseId: z.string(),
    virtualTime: z.string(),
    remainingMinutes: z.number().int().nonnegative(),
    status: z.enum(["ready", "running", "paused", "review", "completed"]),
    roles: z.array(z.object({
      agentId: z.string().min(1),
      actorKind: ActorKindSchema,
      roleId: RoleIdSchema,
      displayName: z.string().min(1),
      purpose: z.string().min(1),
    }).strict()),
  }).strict(),
  currentNode: ScenarioNodeSchema,
  nodes: z.array(ScenarioNodeSchema),
  courseGuide: StudentScenarioCourseGuideSchema.nullable().default(null),
  experienceGuide:
    StudentScenarioExperienceGuideSchema.nullable().optional(),
  structuredWorld:
    StructuredWorldStageProjectionSchema.nullable().optional(),
  currentTaskAnchor: CurrentTaskAnchorSchema,
  materials: z.array(MaterialSchema),
  productionConfig: ProductionConfigSchema.nullable(),
  mediaProcessingTasks: z.array(MediaProcessingTaskSchema),
  governanceReviews: z.array(GovernanceReviewSchema),
  governanceFindings: z.array(GovernanceFindingSchema),
  productionArtifacts: z.array(ProductionArtifactSchema),
  artifactRevisions: z.array(ArtifactRevisionSchema),
  productionSubmissions: z.array(ProductionSubmissionSchema),
  facts: z.array(WorldFactSchema),
  recentEvents: z.array(WorldEventSchema),
  roleMessages: z.array(RoleMessageSchema),
  roleInteractions: z.array(RoleInteractionRecordSchema),
  availableRoleInteractions: z.array(RoleInteractionOptionSchema),
  agentAssistance: z.array(AgentAssistanceProposalSchema),
  evidence: z.array(EvidenceSchema),
  pendingCandidates: z.array(CandidateEventSchema),
  candidateHistory: z.array(CandidateEventSchema),
  teachingDirectives: z.array(TeachingDirectiveSchema),
  sceneDirectorDecisions: z.array(SceneDirectorDecisionSchema),
  activeInterventions: z.array(ScenarioInterventionSchema),
  assessments: z.array(AssessmentSchema),
  evaluationEvidenceBundles: z.array(EvaluationEvidenceBundleSchema),
  evaluationCases: z.array(EvaluationCaseSchema),
  evaluationProposals: z.array(EvaluationProposalSchema),
  evaluationArbitrations: z.array(EvaluationArbitrationSchema),
  teacherAssessmentReviews: z.array(TeacherAssessmentReviewSchema),
  retryableEvaluationBranches: z.array(RetryableEvaluationBranchSchema),
  assessmentFeedback: StudentAssessmentFeedbackSchema.nullable(),
  learningCandidates: z.array(LearningCandidateSchema),
  learningReplayReports: z.array(LearningReplayReportSchema),
  learningCandidateReviews: z.array(LearningCandidateReviewSchema),
  learningReleases: z.array(LearningArtifactReleaseSchema),
  learningReleaseRollbacks: z.array(LearningReleaseRollbackSchema),
  activeLearningReleaseId: z.string().min(1).nullable(),
  retryableLearningGenerationFailures: z.array(
    RetryableLearningGenerationFailureSchema,
  ),
  availableActions: z.array(ActionDefinitionSchema),
  riskLevel: z.enum(["low", "medium", "high"]),
});
export type StateProjection = z.infer<typeof StateProjectionSchema>;

export const RagChunkSchema = z.object({
  chunkId: z.string().min(1),
  domain: z.enum(["course", "role", "governance", "scenario"]),
  title: z.string().min(1),
  content: z.string().min(1),
  courseId: z.string().min(1),
  nodeId: z.string().nullable(),
  roleId: RoleIdSchema.nullable(),
  competencyId: z.string().min(1),
  ruleDomain: z.string().min(1),
  mediaType: z.string().min(1),
  source: z.string().min(1),
  version: z.string().min(1),
  visibility: VisibilityScopeSchema,
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  corpusVersion: z.string().min(1),
  status: z.enum(["active", "superseded", "revoked"]),
  audience: ResourceAudienceSchema,
}).strict();
export type RagChunk = z.infer<typeof RagChunkSchema>;

export const ScenarioConditionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("interaction_responded"),
    optionId: z.string().min(1),
    disabledReason: z.string().min(1),
  }).strict(),
  z.object({
    kind: z.literal("event_recorded"),
    eventType: EventTypeSchema,
    disabledReason: z.string().min(1),
  }).strict(),
  z.object({
    kind: z.literal("evidence_action_recorded"),
    action: z.string().min(1),
    disabledReason: z.string().min(1),
  }).strict(),
]);
export type ScenarioCondition = z.infer<typeof ScenarioConditionSchema>;

export const ScenarioRoleInteractionSchema = z.object({
  optionId: z.string().min(1),
  initiatorActorId: z.string().min(1),
  targetActorId: z.string().min(1),
  targetRoleId: RoleIdSchema,
  kind: RoleInteractionKindSchema,
  topic: RoleInteractionTopicSchema,
  label: z.string().min(1),
  description: z.string().min(1),
  content: z.string().min(1).max(1_200),
  prerequisites: z.array(ScenarioConditionSchema).default([]),
}).strict();
export type ScenarioRoleInteraction = z.infer<typeof ScenarioRoleInteractionSchema>;

export const ScenarioOpeningMessageSchema = z.object({
  actorId: z.string().min(1),
  roleId: RoleIdSchema,
  displayName: z.string().min(1),
  content: z.string().min(1).max(1_200),
  visibility: z.array(VisibilityScopeSchema).min(1),
  visibleToActorIds: z.array(z.string().min(1)).default([]),
}).strict();
export type ScenarioOpeningMessage = z.infer<typeof ScenarioOpeningMessageSchema>;

export const ScenarioMemorySeedSchema = z.object({
  actorId: z.string().min(1),
  kind: z.enum(["episodic", "commitment", "risk", "working"]),
  content: z.string().min(1).max(2_000),
}).strict();
export type ScenarioMemorySeed = z.infer<typeof ScenarioMemorySeedSchema>;

export const ScenarioApprovalPolicySchema = z.object({
  approvalPolicyId: z.string().min(1),
  label: z.string().min(1),
  reviewMode: z.literal("teacher_required"),
  allowReject: z.boolean(),
  reasonRequired: z.boolean(),
  minimumEvidenceCount: z.number().int().nonnegative(),
}).strict();
export type ScenarioApprovalPolicy = z.infer<typeof ScenarioApprovalPolicySchema>;

export const DirectorCadenceSchema = z.enum([
  "conservative",
  "balanced",
  "dynamic",
]);
export type DirectorCadence = z.infer<typeof DirectorCadenceSchema>;

export const ScenarioDirectorConfigSchema = z.object({
  difficulty: DirectorDifficultySchema,
  cadence: DirectorCadenceSchema,
  cooldownEvents: z.number().int().min(0).max(100),
  allowedRouteIds: z.array(z.string().min(1)).min(1),
  teacherApprovalRequired: z.literal(true),
}).strict();
export type ScenarioDirectorConfig = z.infer<typeof ScenarioDirectorConfigSchema>;

export const ScenarioDirectorEventTemplateSchema = z.object({
  routeId: z.string().min(1),
  kind: DirectorRouteKindSchema,
  title: z.string().min(1),
  studentBrief: z.string().min(1).max(1_200),
  competencyTarget: z.string().min(1),
  expectedImpact: z.string().min(1),
  affectedRoleIds: z.array(RoleIdSchema).min(1),
  applicableNodeIds: z.array(z.string().min(1)).min(1),
  triggerEventTypes: z.array(EventTypeSchema).min(1),
  teachingStrategies: z.array(TeachingStrategySchema).min(1),
  difficultyLevels: z.array(DirectorDifficultySchema).min(1),
  minimumEvidenceCount: z.number().int().nonnegative(),
  maximumEvidenceCount: z.number().int().nonnegative().nullable(),
  riskLevel: z.enum(["low", "medium", "high"]),
  cooldownKey: z.string().min(1),
  cooldownEvents: z.number().int().min(0).max(100),
  alternativeRouteIds: z.array(z.string().min(1)),
  sourceRefs: z.array(z.string().min(1)).min(1),
  priority: z.number().int(),
  effectHandlerId: z.literal("director_intervention_v1"),
  eventType: z.literal("scenario_intervention_applied"),
  approvalPolicyId: z.string().min(1),
}).strict();
export type ScenarioDirectorEventTemplate = z.infer<typeof ScenarioDirectorEventTemplateSchema>;

export const ScenarioEffectHandlerIdSchema = z.enum([
  "visitor_correction_v1",
  "copyright_dispute_v1",
  "platform_escalation_v1",
]);
export type ScenarioEffectHandlerId = z.infer<typeof ScenarioEffectHandlerIdSchema>;

export const ScenarioEventPolicySchema = z.object({
  policyId: z.string().min(1),
  sourceIntentType: z.string().min(1),
  sourceRoleId: RoleIdSchema,
  requiredOptionId: z.string().min(1).nullable(),
  effectHandlerId: ScenarioEffectHandlerIdSchema,
  eventType: EventTypeSchema,
  title: z.string().min(1),
  competencyTarget: z.string().min(1),
  expectedImpact: z.string().min(1),
  approvalPolicyId: z.string().min(1),
}).strict();
export type ScenarioEventPolicy = z.infer<typeof ScenarioEventPolicySchema>;

export const ScenarioBootstrapSchema = z.object({
  entryNodeId: z.string().min(1),
  initialFacts: z.array(WorldFactSchema),
  openingMessages: z.array(ScenarioOpeningMessageSchema),
  memorySeeds: z.array(ScenarioMemorySeedSchema),
}).strict();
export type ScenarioBootstrap = z.infer<typeof ScenarioBootstrapSchema>;

const ScenarioSemverSchema = z.string().regex(
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/u,
  "情境包版本必须是 SemVer",
);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);

export const ScenarioPackageSchema = z.object({
  schemaVersion: z.literal(ScenarioPackageSchemaVersion),
  runtimeProfileId: z.literal("local-tourism-media/1.0.0"),
  scenarioId: z.string().min(1),
  courseId: z.string().min(1),
  version: ScenarioSemverSchema,
  title: z.string().min(1),
  description: z.string().min(1),
  startVirtualTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u),
  durationMinutes: z.number().int().positive(),
  nodes: z.array(ScenarioNodeSchema).min(1),
  roles: z.array(RoleContractSchema).min(1),
  materials: z.array(MaterialSchema).min(1),
  bootstrap: ScenarioBootstrapSchema,
  roleInteractions: z.array(ScenarioRoleInteractionSchema).min(1),
  rubricId: z.string().min(1),
  rubricVersion: ScenarioSemverSchema,
  rubric: z.array(RubricCriterionSchema).min(1),
  interactionGates: z.array(z.object({
    command: CommandNameSchema,
    requiredOptionIds: z.array(z.string().min(1)).min(1),
  }).strict()).default([]),
  eventPolicies: z.array(ScenarioEventPolicySchema).min(1),
  approvalPolicies: z.array(ScenarioApprovalPolicySchema).min(1),
  directorConfig: ScenarioDirectorConfigSchema.optional(),
  directorEventTemplates: z.array(ScenarioDirectorEventTemplateSchema).min(1).optional(),
  collaborationConfig: ScenarioCollaborationConfigSchema.optional(),
  productionConfig: ProductionConfigSchema.optional(),
  courseGuide: ScenarioCourseGuideSchema.optional(),
  experienceDesign: ScenarioExperienceDesignSchema.optional(),
  knowledgeChunks: z.array(RagChunkSchema).min(1),
}).strict();
export type ScenarioPackage = z.infer<typeof ScenarioPackageSchema>;

export const ScenarioPackageRefSchema = z.object({
  releaseId: z.string().min(1),
  scenarioId: z.string().min(1),
  version: ScenarioSemverSchema,
  schemaVersion: z.literal(ScenarioPackageSchemaVersion),
  contentHash: Sha256Schema,
}).strict();
export type ScenarioPackageRef = z.infer<typeof ScenarioPackageRefSchema>;

export const ScenarioValidationIssueSchema = z.object({
  code: z.string().min(1),
  severity: z.enum(["error", "warning"]),
  path: z.string().min(1),
  message: z.string().min(1),
}).strict();
export type ScenarioValidationIssue = z.infer<typeof ScenarioValidationIssueSchema>;

export const ScenarioValidationReportSchema = z.object({
  draftId: z.string().min(1),
  revision: z.number().int().positive(),
  definitionHash: Sha256Schema,
  compilerVersion: z.literal(ScenarioCompilerVersion),
  valid: z.boolean(),
  issues: z.array(ScenarioValidationIssueSchema),
  validatedAt: z.string().datetime(),
  validationStamp: Sha256Schema.nullable(),
}).strict();
export type ScenarioValidationReport = z.infer<typeof ScenarioValidationReportSchema>;

export const ScenarioDraftSchema = z.object({
  draftId: z.string().min(1),
  sourceRef: ScenarioPackageRefSchema.nullable(),
  revision: z.number().int().positive(),
  status: z.literal("draft"),
  package: ScenarioPackageSchema,
  createdBy: z.string().min(1),
  updatedBy: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  lastValidation: ScenarioValidationReportSchema.nullable(),
}).strict();
export type ScenarioDraft = z.infer<typeof ScenarioDraftSchema>;

export const PublishedScenarioPackageSchema = z.object({
  ref: ScenarioPackageRefSchema,
  compilerVersion: z.literal(ScenarioCompilerVersion),
  package: ScenarioPackageSchema,
  publishedBy: z.string().min(1),
  publishedAt: z.string().datetime(),
  sourceDraftId: z.string().min(1).nullable(),
}).strict();
export type PublishedScenarioPackage = z.infer<typeof PublishedScenarioPackageSchema>;

export const ScenarioPreviewSchema = z.object({
  draftId: z.string().min(1),
  revision: z.number().int().positive(),
  definitionHash: Sha256Schema,
  report: ScenarioValidationReportSchema,
  summary: z.object({
    title: z.string().min(1),
    version: ScenarioSemverSchema,
    roleCount: z.number().int().nonnegative(),
    nodeCount: z.number().int().nonnegative(),
    materialCount: z.number().int().nonnegative(),
    interactionCount: z.number().int().nonnegative(),
    knowledgeChunkCount: z.number().int().nonnegative(),
    approvalPolicyCount: z.number().int().nonnegative(),
    changedFields: z.array(z.string()),
  }).strict(),
}).strict();
export type ScenarioPreview = z.infer<typeof ScenarioPreviewSchema>;

export const RagResultSchema = z.object({
  query: z.string().min(1),
  actorId: z.string().min(1),
  roleId: RoleIdSchema,
  teamId: z.string().min(1),
  stateVersion: z.number().int().nonnegative(),
  policyVersion: z.literal(AccessPolicyVersion),
  retrieverVersion: z.string().min(1),
  corpusVersion: z.string().min(1),
  layers: z.object({
    fixed: z.array(z.string()),
    state: z.array(z.string()),
    retrieved: z.array(RagChunkSchema),
    evidence: z.array(z.string()),
    transient: z.array(z.string()),
  }),
  citations: z.array(z.object({
    chunkId: z.string(),
    source: z.string(),
    version: z.string(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  })),
  acl: z.object({
    preRejectedCount: z.number().int().nonnegative(),
    postRejectedCount: z.number().int().nonnegative(),
  }).strict(),
}).strict();
export type RagResult = z.infer<typeof RagResultSchema>;

export const RoleMemoryOperationSchema = z.enum(["remember", "supersede", "forget"]);
export type RoleMemoryOperation = z.infer<typeof RoleMemoryOperationSchema>;

export const RoleMemoryKindSchema = z.enum(["episodic", "commitment", "risk", "working"]);
export type RoleMemoryKind = z.infer<typeof RoleMemoryKindSchema>;

export const RoleMemoryDeltaSchema = z.object({
  schemaVersion: z.literal(RoleMemorySchemaVersion),
  policyVersion: z.literal(AccessPolicyVersion),
  deltaId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  sessionId: z.string().min(1),
  sessionEpoch: z.string().min(1),
  sceneId: z.string().min(1),
  namespace: z.string().min(1),
  ownerActorId: z.string().min(1),
  ownerRoleId: RoleIdSchema,
  ownerTeamId: z.string().min(1),
  authorActorId: z.string().min(1),
  operation: RoleMemoryOperationSchema,
  memoryId: z.string().min(1),
  kind: RoleMemoryKindSchema,
  content: z.string().min(1),
  sourceEventIds: z.array(z.string().min(1)).min(1),
  revision: z.number().int().positive(),
  previousDeltaHash: z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
  deltaHash: z.string().regex(/^[a-f0-9]{64}$/u),
  createdAt: z.string().datetime(),
  auditReadable: z.boolean(),
}).strict();
export type RoleMemoryDelta = z.infer<typeof RoleMemoryDeltaSchema>;

export const RoleMemoryIntegrityManifestSchema = z.object({
  schemaVersion: z.literal(RoleMemoryIntegritySchemaVersion),
  roleMemorySchemaVersion: z.literal(RoleMemorySchemaVersion),
  policyVersion: z.literal(AccessPolicyVersion),
  sessionBindingHash: z.string().regex(/^[a-f0-9]{64}$/u),
  epochCount: z.number().int().nonnegative(),
  namespaceCount: z.number().int().nonnegative(),
  memoryCount: z.number().int().nonnegative(),
  deltaCount: z.number().int().nonnegative(),
  deltaCommitments: z.array(
    z.string().regex(/^[a-f0-9]{64}$/u),
  ),
  progressAnchorHash: z.string().regex(/^[a-f0-9]{64}$/u),
  journalHash: z.string().regex(/^[a-f0-9]{64}$/u),
  projectionRootHash: z.string().regex(/^[a-f0-9]{64}$/u),
  manifestHash: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();
export type RoleMemoryIntegrityManifest = z.infer<
  typeof RoleMemoryIntegrityManifestSchema
>;

export const RoleMemoryEntrySchema = z.object({
  memoryId: z.string().min(1),
  namespace: z.string().min(1),
  ownerActorId: z.string().min(1),
  ownerRoleId: RoleIdSchema,
  ownerTeamId: z.string().min(1),
  kind: RoleMemoryKindSchema,
  content: z.string().min(1),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  sourceEventIds: z.array(z.string().min(1)).min(1),
  revision: z.number().int().positive(),
  status: z.enum(["active", "forgotten"]),
  lastDeltaId: z.string().min(1),
  lastDeltaHash: z.string().regex(/^[a-f0-9]{64}$/u),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  auditReadable: z.boolean(),
}).strict();
export type RoleMemoryEntry = z.infer<typeof RoleMemoryEntrySchema>;

export const RoleMemorySnapshotSchema = z.object({
  schemaVersion: z.literal(RoleMemorySchemaVersion),
  policyVersion: z.literal(AccessPolicyVersion),
  sessionId: z.string().min(1),
  sessionEpoch: z.string().min(1),
  namespace: z.string().min(1),
  projectionVersion: z.number().int().nonnegative(),
  entries: z.array(RoleMemoryEntrySchema),
  snapshotHash: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();
export type RoleMemorySnapshot = z.infer<typeof RoleMemorySnapshotSchema>;

export const AdapterHealthSchema = z.object({
  provider: z.literal("iflytek"),
  mode: z.enum(["mock", "live"]),
  capabilities: z.array(z.object({
    capability: AdapterCapabilitySchema,
    available: z.boolean(),
    configured: z.boolean(),
    endpoint: z.string().url().nullable(),
  })),
});
export type AdapterHealth = z.infer<typeof AdapterHealthSchema>;

export const GoldCompetitionReadinessSchemaVersion =
  "gold-competition-readiness/1.2.0" as const;

export const GoldCompetitionEvidenceStatusSchema = z.enum([
  "passed",
  "failed",
  "insufficient",
  "unverified",
]);
export type GoldCompetitionEvidenceStatus = z.infer<
  typeof GoldCompetitionEvidenceStatusSchema
>;

export const GoldCompetitionSourceIdSchema = z.enum([
  "technical_manifest",
  "golden_demo_run",
  "golden_demo_screenshots",
  "controlled_ablation",
  "transfer_proof",
]);
export type GoldCompetitionSourceId = z.infer<
  typeof GoldCompetitionSourceIdSchema
>;

export const GoldCompetitionSourceIntegritySchema = z.enum([
  "verified",
  "validated",
  "missing",
  "invalid",
]);
export type GoldCompetitionSourceIntegrity = z.infer<
  typeof GoldCompetitionSourceIntegritySchema
>;

export const GoldCompetitionSourceArtifactSchema = z.object({
  sourceId: GoldCompetitionSourceIdSchema,
  label: z.string().min(1).max(120),
  relativePath: z.string()
    .min(1)
    .max(320)
    .refine(
      (value) => (
        !value.startsWith("/")
        && !/^[A-Za-z]:[\\/]/u.test(value)
        && !value.split(/[\\/]/u).includes("..")
      ),
      "国金证据来源必须使用包内相对路径",
    ),
  integrity: GoldCompetitionSourceIntegritySchema,
  fileSha256: z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
  bytes: z.number().int().nonnegative().nullable(),
  rationale: z.string().min(1).max(800),
}).strict();
export type GoldCompetitionSourceArtifact = z.infer<
  typeof GoldCompetitionSourceArtifactSchema
>;

export const GoldCompetitionGoldenDemoEvidenceSchema = z.object({
  status: z.enum(["passed", "failed"]),
  scenarioVersion: z.string().regex(/^\d+\.\d+\.\d+$/u),
  durationMs: z.number().int().nonnegative(),
  minimumMs: z.number().int().nonnegative(),
  maximumMs: z.number().int().positive(),
  withinTargetWindow: z.boolean(),
  worldEventCount: z.number().int().nonnegative(),
  evidenceCount: z.number().int().nonnegative(),
  taskCount: z.number().int().nonnegative(),
  runCount: z.number().int().nonnegative(),
  failureCount: z.number().int().nonnegative(),
  degradedCount: z.number().int().nonnegative(),
  pendingCount: z.number().int().nonnegative(),
  abnormalCount: z.number().int().nonnegative(),
  finalScore: z.number().min(0).max(100),
  learningReplay: z.object({
    status: z.enum(["passed", "failed"]),
    passedCaseCount: z.number().int().nonnegative(),
    testCaseCount: z.number().int().nonnegative(),
    privacyViolationCount: z.number().int().nonnegative(),
  }).strict(),
  browserConsoleLogCount: z.number().int().nonnegative(),
  providerBoundary: z.object({
    iflytekMode: z.enum(["mock", "live"]),
    semanticModelMode: z.string().min(1).max(120),
    machineOutputsRemain: z.literal("unverified_observation"),
  }).strict(),
  screenshotCount: z.number().int().nonnegative(),
  screenshotsVerified: z.boolean(),
  limitations: z.array(z.string().min(1).max(500)).min(1).max(12),
}).strict().superRefine((evidence, context) => {
  if (
    evidence.withinTargetWindow
    && (
      evidence.durationMs < evidence.minimumMs
      || evidence.durationMs > evidence.maximumMs
    )
  ) {
    context.addIssue({
      code: "custom",
      path: ["withinTargetWindow"],
      message: "黄金演示时长不在冻结窗口内时不得标记为命中窗口",
    });
  }
  if (
    evidence.status === "passed"
    && (
      !evidence.withinTargetWindow
      || !evidence.screenshotsVerified
      || evidence.screenshotCount === 0
      || evidence.failureCount > 0
      || evidence.degradedCount > 0
      || evidence.pendingCount > 0
      || evidence.abnormalCount > 0
      || evidence.learningReplay.status !== "passed"
      || evidence.learningReplay.privacyViolationCount > 0
      || evidence.browserConsoleLogCount > 0
    )
  ) {
    context.addIssue({
      code: "custom",
      path: ["status"],
      message: "黄金演示只有在时长、截图、失败关闭、回放与浏览器门全部通过时才能通过",
    });
  }
});
export type GoldCompetitionGoldenDemoEvidence = z.infer<
  typeof GoldCompetitionGoldenDemoEvidenceSchema
>;

export const GoldCompetitionClaimIdSchema = z.enum([
  "dual_dimension_professional_world",
  "private_view_event_driven_agents",
  "evidence_based_teacher_review",
]);
export type GoldCompetitionClaimId = z.infer<
  typeof GoldCompetitionClaimIdSchema
>;

export const GoldCompetitionCoreClaimSchema = z.object({
  claimId: GoldCompetitionClaimIdSchema,
  label: z.string().min(1).max(120),
  implementationStatus: GoldCompetitionEvidenceStatusSchema,
  empiricalStatus: GoldCompetitionEvidenceStatusSchema,
  evidenceRefs: z.array(z.string().min(1).max(320)),
  rationale: z.string().min(1).max(1_000),
  allowedClaim: z.string().min(1).max(800),
  forbiddenClaim: z.string().min(1).max(800),
}).strict();
export type GoldCompetitionCoreClaim = z.infer<
  typeof GoldCompetitionCoreClaimSchema
>;

export const GoldCompetitionDeliverableIdSchema = z.enum([
  "golden_demo",
  "controlled_ablation",
  "evaluation_validity",
  "teaching_pilot",
  "transferability",
  "competition_package",
]);
export type GoldCompetitionDeliverableId = z.infer<
  typeof GoldCompetitionDeliverableIdSchema
>;

export const GoldCompetitionIndicatorSchema = z.object({
  label: z.string().min(1).max(120),
  value: z.union([
    z.string().min(1).max(240),
    z.number().finite(),
    z.boolean(),
  ]),
}).strict();
export type GoldCompetitionIndicator = z.infer<
  typeof GoldCompetitionIndicatorSchema
>;

export const GoldCompetitionDeliverableSchema = z.object({
  deliverableId: GoldCompetitionDeliverableIdSchema,
  label: z.string().min(1).max(120),
  status: GoldCompetitionEvidenceStatusSchema,
  adverseFinding: z.boolean(),
  evidenceRefs: z.array(z.string().min(1).max(320)),
  indicators: z.array(GoldCompetitionIndicatorSchema).max(12),
  rationale: z.string().min(1).max(1_000),
  nextAction: z.string().min(1).max(500),
  claimBoundary: z.string().min(1).max(1_000),
}).strict();
export type GoldCompetitionDeliverable = z.infer<
  typeof GoldCompetitionDeliverableSchema
>;

export const GoldCompetitionOfficialRegistrySchemaVersion =
  "gold-competition-official-registry/1.0.0" as const;
export const GoldCompetitionOfficialMatrixSchemaVersion =
  "gold-competition-official-matrix/1.0.0" as const;

export const GoldCompetitionOfficialSourceTypeSchema = z.enum([
  "competition_rules",
  "iflytek_requirements",
]);
export type GoldCompetitionOfficialSourceType = z.infer<
  typeof GoldCompetitionOfficialSourceTypeSchema
>;

export const GoldCompetitionOfficialSourceSchema = z.object({
  sourceId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{2,119}$/u),
  sourceType: GoldCompetitionOfficialSourceTypeSchema,
  title: z.string().min(1).max(240),
  issuer: z.string().min(1).max(160),
  url: z.string().url(),
  publishedDate: z.string().date(),
  accessedAt: z.string().datetime(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  contentBytes: z.number().int().positive(),
  containerHash: z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
  containerBytes: z.number().int().positive().nullable(),
  locator: z.string().min(1).max(500),
  retrievalKind: z.enum(["official_html", "official_archive_document"]),
  verificationNote: z.string().min(1).max(800),
}).strict();
export type GoldCompetitionOfficialSource = z.infer<
  typeof GoldCompetitionOfficialSourceSchema
>;

export const GoldCompetitionOfficialSourceRegistrySchema = z.object({
  schemaVersion: z.literal(GoldCompetitionOfficialRegistrySchemaVersion),
  challengeId: z.literal("XA-202603"),
  sourceCount: z.number().int().nonnegative(),
  sources: z.array(GoldCompetitionOfficialSourceSchema).length(2),
  claimBoundary: z.string().min(1).max(1_000),
  registryHash: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict().superRefine((registry, context) => {
  if (registry.sourceCount !== registry.sources.length) {
    context.addIssue({
      code: "custom",
      path: ["sourceCount"],
      message: "官方来源登记计数必须与来源清单一致",
    });
  }
  const sourceTypes = registry.sources.map((source) => source.sourceType);
  if (
    new Set(sourceTypes).size !== 2
    || !GoldCompetitionOfficialSourceTypeSchema.options.every(
      (sourceType) => sourceTypes.includes(sourceType),
    )
  ) {
    context.addIssue({
      code: "custom",
      path: ["sources"],
      message: "官方来源登记必须且只能覆盖赛事规则与讯飞原题要求",
    });
  }
  if (new Set(registry.sources.map((source) => source.sourceId)).size !== 2) {
    context.addIssue({
      code: "custom",
      path: ["sources"],
      message: "官方来源标识不得重复",
    });
  }
});
export type GoldCompetitionOfficialSourceRegistry = z.infer<
  typeof GoldCompetitionOfficialSourceRegistrySchema
>;

export const GoldCompetitionOfficialRequirementIdSchema = z.enum([
  "competition_eligibility",
  "registration_receipt",
  "development_direction",
  "professional_group_and_job",
  "real_scenario_and_pain_point",
  "functional_closed_loop",
  "professional_accuracy_and_citations",
  "multi_turn_friendly_interaction",
  "runnable_interactive_mvp",
  "structured_knowledge_minimum",
  "real_user_feedback",
  "official_scoring_rubric",
  "configuration_extensibility",
  "submission_deadline",
  "submission_package",
  "iflytek_delivery_path",
  "ip_ethics_and_ai_label",
]);
export type GoldCompetitionOfficialRequirementId = z.infer<
  typeof GoldCompetitionOfficialRequirementIdSchema
>;

export const GoldCompetitionOfficialMappingStatusSchema = z.enum([
  "mapped",
  "partial",
  "unmapped",
]);
export type GoldCompetitionOfficialMappingStatus = z.infer<
  typeof GoldCompetitionOfficialMappingStatusSchema
>;

export const GoldCompetitionOfficialRequirementSchema = z.object({
  requirementId: GoldCompetitionOfficialRequirementIdSchema,
  title: z.string().min(1).max(160),
  sourceIds: z.array(z.string().min(1).max(120)).min(1).max(2),
  locator: z.string().min(1).max(320),
  requirementSummary: z.string().min(1).max(800),
  mappingStatus: GoldCompetitionOfficialMappingStatusSchema,
  evidenceStatus: GoldCompetitionEvidenceStatusSchema,
  verificationMode: z.enum(["automated", "artifact_review", "manual"]),
  mappingRefs: z.array(z.string().min(1).max(320)).max(12),
  rationale: z.string().min(1).max(1_000),
  nextAction: z.string().min(1).max(600),
  dueDate: z.string().date().nullable(),
}).strict();
export type GoldCompetitionOfficialRequirement = z.infer<
  typeof GoldCompetitionOfficialRequirementSchema
>;

export const GoldCompetitionOfficialRequirementMatrixSchema = z.object({
  schemaVersion: z.literal(GoldCompetitionOfficialMatrixSchemaVersion),
  challengeId: z.literal("XA-202603"),
  sourceRegistryHash: z.string().regex(/^[a-f0-9]{64}$/u),
  requirements: z.array(GoldCompetitionOfficialRequirementSchema).length(
    GoldCompetitionOfficialRequirementIdSchema.options.length,
  ),
  claimBoundary: z.string().min(1).max(1_200),
  matrixHash: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict().superRefine((matrix, context) => {
  const requirementIds = matrix.requirements.map(
    (requirement) => requirement.requirementId,
  );
  if (
    new Set(requirementIds).size
      !== GoldCompetitionOfficialRequirementIdSchema.options.length
    || !GoldCompetitionOfficialRequirementIdSchema.options.every(
      (requirementId) => requirementIds.includes(requirementId),
    )
  ) {
    context.addIssue({
      code: "custom",
      path: ["requirements"],
      message: "官方条款矩阵必须且只能覆盖全部固定要求",
    });
  }
});
export type GoldCompetitionOfficialRequirementMatrix = z.infer<
  typeof GoldCompetitionOfficialRequirementMatrixSchema
>;

export const GoldCompetitionOfficialArtifactIdSchema = z.enum([
  "source_registry",
  "requirement_matrix",
]);
export type GoldCompetitionOfficialArtifactId = z.infer<
  typeof GoldCompetitionOfficialArtifactIdSchema
>;

export const GoldCompetitionOfficialArtifactSchema = z.object({
  artifactId: GoldCompetitionOfficialArtifactIdSchema,
  label: z.string().min(1).max(120),
  relativePath: z.string()
    .min(1)
    .max(320)
    .refine(
      (value) => (
        !value.startsWith("/")
        && !/^[A-Za-z]:[\\/]/u.test(value)
        && !value.split(/[\\/]/u).includes("..")
      ),
      "官方对齐工件必须使用包内相对路径",
    ),
  integrity: GoldCompetitionSourceIntegritySchema,
  fileSha256: z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
  bytes: z.number().int().nonnegative().nullable(),
  rationale: z.string().min(1).max(800),
}).strict();
export type GoldCompetitionOfficialArtifact = z.infer<
  typeof GoldCompetitionOfficialArtifactSchema
>;

export const GoldCompetitionOfficialAlignmentSchema = z.object({
  status: GoldCompetitionEvidenceStatusSchema,
  sourceCount: z.number().int().nonnegative(),
  sources: z.array(GoldCompetitionOfficialSourceSchema),
  artifacts: z.array(GoldCompetitionOfficialArtifactSchema).length(2),
  registryHash: z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
  matrixHash: z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
  requirementCount: z.number().int().nonnegative(),
  mappedRequirementCount: z.number().int().nonnegative(),
  partialMappingCount: z.number().int().nonnegative(),
  unmappedRequirementCount: z.number().int().nonnegative(),
  passedRequirementCount: z.number().int().nonnegative(),
  failedRequirementCount: z.number().int().nonnegative(),
  insufficientRequirementCount: z.number().int().nonnegative(),
  unverifiedRequirementCount: z.number().int().nonnegative(),
  requirements: z.array(GoldCompetitionOfficialRequirementSchema),
  blockingRequirementIds: z.array(
    GoldCompetitionOfficialRequirementIdSchema,
  ),
  rationale: z.string().min(1).max(800),
  claimBoundary: z.string().min(1).max(1_200),
}).strict().superRefine((alignment, context) => {
  if (alignment.sourceCount !== alignment.sources.length) {
    context.addIssue({
      code: "custom",
      path: ["sourceCount"],
      message: "官方材料来源计数必须与来源清单一致",
    });
  }
  if (alignment.requirementCount !== alignment.requirements.length) {
    context.addIssue({
      code: "custom",
      path: ["requirementCount"],
      message: "官方条款计数必须与条款清单一致",
    });
  }
  const mappingCount = alignment.mappedRequirementCount
    + alignment.partialMappingCount
    + alignment.unmappedRequirementCount;
  if (mappingCount !== alignment.requirements.length) {
    context.addIssue({
      code: "custom",
      path: ["mappedRequirementCount"],
      message: "官方条款映射状态计数必须覆盖全部条款",
    });
  }
  const evidenceCount = alignment.passedRequirementCount
    + alignment.failedRequirementCount
    + alignment.insufficientRequirementCount
    + alignment.unverifiedRequirementCount;
  if (evidenceCount !== alignment.requirements.length) {
    context.addIssue({
      code: "custom",
      path: ["passedRequirementCount"],
      message: "官方条款证据状态计数必须覆盖全部条款",
    });
  }
  const requirementIds = new Set(
    alignment.requirements.map((requirement) => requirement.requirementId),
  );
  if (
    alignment.blockingRequirementIds.some(
      (requirementId) => !requirementIds.has(requirementId),
    )
  ) {
    context.addIssue({
      code: "custom",
      path: ["blockingRequirementIds"],
      message: "官方条款阻断项必须来自当前条款矩阵",
    });
  }
  if (
    alignment.status === "passed"
    && (
      alignment.sourceCount < 2
      || alignment.artifacts.some(
        (artifact) => artifact.integrity !== "verified",
      )
      || alignment.requirements.some(
        (requirement) => (
          requirement.mappingStatus !== "mapped"
          || requirement.evidenceStatus !== "passed"
        ),
      )
    )
  ) {
    context.addIssue({
      code: "custom",
      path: ["status"],
      message: "官方对齐通过需要双来源、双工件及全部条款映射与证据同时通过",
    });
  }
});
export type GoldCompetitionOfficialAlignment = z.infer<
  typeof GoldCompetitionOfficialAlignmentSchema
>;

export const GoldCompetitionScorecardSchemaVersion =
  "gold-competition-scorecard/1.0.0" as const;

export const GoldCompetitionScoreDimensionIdSchema = z.enum([
  "functional_completeness_and_practicality",
  "technical_implementation_and_content_quality",
  "application_potential_and_completion_quality",
]);
export type GoldCompetitionScoreDimensionId = z.infer<
  typeof GoldCompetitionScoreDimensionIdSchema
>;

export const GoldCompetitionScoreItemIdSchema = z.enum([
  "work_completion",
  "creative_practicality",
  "technical_implementation_rationality",
  "professional_content_accuracy",
  "extensibility",
  "validation_and_feedback",
]);
export type GoldCompetitionScoreItemId = z.infer<
  typeof GoldCompetitionScoreItemIdSchema
>;

export const GoldCompetitionScoreMaterialIdSchema = z.enum([
  "pitch_deck",
  "demo",
  "technical_report",
  "user_feedback",
  "compliance_statement",
  "source_or_service_delivery",
]);
export type GoldCompetitionScoreMaterialId = z.infer<
  typeof GoldCompetitionScoreMaterialIdSchema
>;

export const GoldCompetitionScoreMaterialStatusSchema = z.enum([
  "planned",
  "missing",
  "available",
  "verified",
]);
export type GoldCompetitionScoreMaterialStatus = z.infer<
  typeof GoldCompetitionScoreMaterialStatusSchema
>;

const GoldCompetitionScoreSafeRelativePathSchema = z.string()
  .min(1)
  .max(320)
  .refine(
    (value) => (
      !value.startsWith("/")
      && !/^[A-Za-z]:[\\/]/u.test(value)
      && !value.split(/[\\/]/u).includes("..")
    ),
    "得分卡材料必须使用包内相对路径",
  );

export const GoldCompetitionScoreMaterialBindingSchema = z.object({
  materialId: GoldCompetitionScoreMaterialIdSchema,
  status: GoldCompetitionScoreMaterialStatusSchema,
  expectedSection: z.string().min(1).max(240),
  relativePath: GoldCompetitionScoreSafeRelativePathSchema.nullable(),
  locator: z.string().min(1).max(120).nullable(),
  fileSha256: z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
  rationale: z.string().min(1).max(600),
}).strict().superRefine((binding, context) => {
  const hasFile = binding.relativePath !== null
    && binding.fileSha256 !== null;
  if (
    (binding.status === "planned" || binding.status === "missing")
    && (
      binding.relativePath !== null
      || binding.locator !== null
      || binding.fileSha256 !== null
    )
  ) {
    context.addIssue({
      code: "custom",
      path: ["status"],
      message: "规划中或缺失材料不得伪造文件、哈希或页码定位",
    });
  }
  if (binding.status === "available" && !hasFile) {
    context.addIssue({
      code: "custom",
      path: ["status"],
      message: "可用材料必须同时登记包内路径与文件哈希",
    });
  }
  if (
    binding.status === "verified"
    && (!hasFile || binding.locator === null)
  ) {
    context.addIssue({
      code: "custom",
      path: ["status"],
      message: "已复核材料必须同时登记路径、哈希及页码或时间码",
    });
  }
});
export type GoldCompetitionScoreMaterialBinding = z.infer<
  typeof GoldCompetitionScoreMaterialBindingSchema
>;

export const GoldCompetitionScoreAssessmentStatusSchema = z.enum([
  "not_reviewed",
  "frozen",
]);
export type GoldCompetitionScoreAssessmentStatus = z.infer<
  typeof GoldCompetitionScoreAssessmentStatusSchema
>;

export const GoldCompetitionScoreAssessmentSchema = z.object({
  status: GoldCompetitionScoreAssessmentStatusSchema,
  score: z.number().min(0).max(100).nullable(),
  reviewerCount: z.number().int().nonnegative(),
  reviewedAt: z.string().datetime().nullable(),
  receiptHash: z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
  rationale: z.string().min(1).max(600),
}).strict();
export type GoldCompetitionScoreAssessment = z.infer<
  typeof GoldCompetitionScoreAssessmentSchema
>;

export const GoldCompetitionScoreDimensionSchema = z.object({
  dimensionId: GoldCompetitionScoreDimensionIdSchema,
  title: z.string().min(1).max(160),
  maxScore: z.number().int().positive().max(100),
  itemIds: z.array(GoldCompetitionScoreItemIdSchema).length(2),
}).strict();
export type GoldCompetitionScoreDimension = z.infer<
  typeof GoldCompetitionScoreDimensionSchema
>;

export const GoldCompetitionScoreItemSchema = z.object({
  scoreItemId: GoldCompetitionScoreItemIdSchema,
  dimensionId: GoldCompetitionScoreDimensionIdSchema,
  title: z.string().min(1).max(160),
  maxScore: z.number().int().positive().max(100),
  sourceLocator: z.string().min(1).max(320),
  criteria: z.array(z.string().min(1).max(500)).min(1).max(8),
  evidenceStatus: GoldCompetitionEvidenceStatusSchema,
  evidenceRefs: z.array(z.string().min(1).max(320)).max(16),
  materialBindings: z.array(
    GoldCompetitionScoreMaterialBindingSchema,
  ).min(1).max(6),
  assessment: GoldCompetitionScoreAssessmentSchema,
  rationale: z.string().min(1).max(1_000),
  nextAction: z.string().min(1).max(600),
}).strict().superRefine((item, context) => {
  if (
    item.evidenceStatus === "passed"
    && item.evidenceRefs.length === 0
  ) {
    context.addIssue({
      code: "custom",
      path: ["evidenceRefs"],
      message: "证据通过的评分项必须绑定至少一个可复核来源",
    });
  }
  if (
    new Set(
      item.materialBindings.map((binding) => binding.materialId),
    ).size !== item.materialBindings.length
  ) {
    context.addIssue({
      code: "custom",
      path: ["materialBindings"],
      message: "同一评分项不得重复登记同类材料",
    });
  }
  const assessment = item.assessment;
  if (
    assessment.status === "not_reviewed"
    && (
      assessment.score !== null
      || assessment.reviewerCount !== 0
      || assessment.reviewedAt !== null
      || assessment.receiptHash !== null
    )
  ) {
    context.addIssue({
      code: "custom",
      path: ["assessment"],
      message: "未评审状态不得携带分数、评审人数、时间或收据",
    });
  }
  if (
    assessment.status === "frozen"
    && (
      assessment.score === null
      || assessment.score > item.maxScore
      || assessment.reviewerCount < 1
      || assessment.reviewedAt === null
      || assessment.receiptHash === null
    )
  ) {
    context.addIssue({
      code: "custom",
      path: ["assessment"],
      message: "冻结模拟评分必须在本项上限内并具有评审人数、时间和收据",
    });
  }
});
export type GoldCompetitionScoreItem = z.infer<
  typeof GoldCompetitionScoreItemSchema
>;

const goldCompetitionScoreDimensionDefinition = {
  functional_completeness_and_practicality: {
    maxScore: 30,
    itemIds: ["work_completion", "creative_practicality"],
  },
  technical_implementation_and_content_quality: {
    maxScore: 50,
    itemIds: [
      "technical_implementation_rationality",
      "professional_content_accuracy",
    ],
  },
  application_potential_and_completion_quality: {
    maxScore: 20,
    itemIds: ["extensibility", "validation_and_feedback"],
  },
} as const;

const goldCompetitionScoreItemDefinition = {
  work_completion: {
    dimensionId: "functional_completeness_and_practicality",
    maxScore: 10,
  },
  creative_practicality: {
    dimensionId: "functional_completeness_and_practicality",
    maxScore: 20,
  },
  technical_implementation_rationality: {
    dimensionId: "technical_implementation_and_content_quality",
    maxScore: 25,
  },
  professional_content_accuracy: {
    dimensionId: "technical_implementation_and_content_quality",
    maxScore: 25,
  },
  extensibility: {
    dimensionId: "application_potential_and_completion_quality",
    maxScore: 10,
  },
  validation_and_feedback: {
    dimensionId: "application_potential_and_completion_quality",
    maxScore: 10,
  },
} as const;

export const GoldCompetitionScorecardSchema = z.object({
  schemaVersion: z.literal(GoldCompetitionScorecardSchemaVersion),
  challengeId: z.literal("XA-202603"),
  sourceRegistryHash: z.string().regex(/^[a-f0-9]{64}$/u),
  requirementMatrixHash: z.string().regex(/^[a-f0-9]{64}$/u),
  totalMaxScore: z.literal(100),
  dimensions: z.array(GoldCompetitionScoreDimensionSchema).length(3),
  items: z.array(GoldCompetitionScoreItemSchema).length(6),
  claimBoundary: z.string().min(1).max(1_200),
  scorecardHash: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict().superRefine((scorecard, context) => {
  const dimensionIds = scorecard.dimensions.map(
    (dimension) => dimension.dimensionId,
  );
  if (
    new Set(dimensionIds).size
      !== GoldCompetitionScoreDimensionIdSchema.options.length
    || !GoldCompetitionScoreDimensionIdSchema.options.every(
      (dimensionId) => dimensionIds.includes(dimensionId),
    )
  ) {
    context.addIssue({
      code: "custom",
      path: ["dimensions"],
      message: "官方得分卡必须且只能覆盖30/50/20三个固定维度",
    });
  }
  const scoreItemIds = scorecard.items.map((item) => item.scoreItemId);
  if (
    new Set(scoreItemIds).size
      !== GoldCompetitionScoreItemIdSchema.options.length
    || !GoldCompetitionScoreItemIdSchema.options.every(
      (scoreItemId) => scoreItemIds.includes(scoreItemId),
    )
  ) {
    context.addIssue({
      code: "custom",
      path: ["items"],
      message: "官方得分卡必须且只能覆盖六个固定评分项",
    });
  }
  for (const dimension of scorecard.dimensions) {
    const expected =
      goldCompetitionScoreDimensionDefinition[dimension.dimensionId];
    const itemIds = dimension.itemIds;
    if (
      dimension.maxScore !== expected.maxScore
      || new Set(itemIds).size !== expected.itemIds.length
      || expected.itemIds.some((itemId) => !itemIds.includes(itemId))
    ) {
      context.addIssue({
        code: "custom",
        path: ["dimensions", dimension.dimensionId],
        message: "官方评分维度权重或评分项归属与原题不一致",
      });
    }
  }
  for (const item of scorecard.items) {
    const expected = goldCompetitionScoreItemDefinition[item.scoreItemId];
    if (
      item.dimensionId !== expected.dimensionId
      || item.maxScore !== expected.maxScore
    ) {
      context.addIssue({
        code: "custom",
        path: ["items", item.scoreItemId],
        message: "官方评分项权重或维度归属与原题不一致",
      });
    }
  }
  const dimensionWeight = scorecard.dimensions.reduce(
    (sum, dimension) => sum + dimension.maxScore,
    0,
  );
  const itemWeight = scorecard.items.reduce(
    (sum, item) => sum + item.maxScore,
    0,
  );
  if (
    dimensionWeight !== scorecard.totalMaxScore
    || itemWeight !== scorecard.totalMaxScore
  ) {
    context.addIssue({
      code: "custom",
      path: ["totalMaxScore"],
      message: "官方得分卡维度与评分项权重都必须合计100分",
    });
  }
});
export type GoldCompetitionScorecard = z.infer<
  typeof GoldCompetitionScorecardSchema
>;

export const GoldCompetitionScorecardArtifactSchema = z.object({
  artifactId: z.literal("official_scorecard"),
  label: z.string().min(1).max(120),
  relativePath: GoldCompetitionScoreSafeRelativePathSchema,
  integrity: GoldCompetitionSourceIntegritySchema,
  fileSha256: z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
  bytes: z.number().int().nonnegative().nullable(),
  rationale: z.string().min(1).max(800),
}).strict();
export type GoldCompetitionScorecardArtifact = z.infer<
  typeof GoldCompetitionScorecardArtifactSchema
>;

export const GoldCompetitionOfficialScorecardSchema = z.object({
  status: GoldCompetitionEvidenceStatusSchema,
  artifact: GoldCompetitionScorecardArtifactSchema,
  scorecard: GoldCompetitionScorecardSchema.nullable(),
  dimensionCount: z.number().int().min(0).max(3),
  itemCount: z.number().int().min(0).max(6),
  evidencePassedItemCount: z.number().int().min(0).max(6),
  evidenceFailedItemCount: z.number().int().min(0).max(6),
  evidenceInsufficientItemCount: z.number().int().min(0).max(6),
  evidenceUnverifiedItemCount: z.number().int().min(0).max(6),
  evidenceReadyMaxScore: z.number().int().min(0).max(100),
  scoredItemCount: z.number().int().min(0).max(6),
  independentMockScoreTotal: z.number().min(0).max(100).nullable(),
  materialBindingCount: z.number().int().nonnegative(),
  verifiedMaterialBindingCount: z.number().int().nonnegative(),
  blockingItemIds: z.array(GoldCompetitionScoreItemIdSchema),
  rationale: z.string().min(1).max(1_000),
  claimBoundary: z.string().min(1).max(1_200),
}).strict().superRefine((control, context) => {
  const scorecard = control.scorecard;
  if (!scorecard) {
    if (
      control.dimensionCount !== 0
      || control.itemCount !== 0
      || control.evidencePassedItemCount !== 0
      || control.evidenceFailedItemCount !== 0
      || control.evidenceInsufficientItemCount !== 0
      || control.evidenceUnverifiedItemCount !== 0
      || control.evidenceReadyMaxScore !== 0
      || control.scoredItemCount !== 0
      || control.independentMockScoreTotal !== null
      || control.materialBindingCount !== 0
      || control.verifiedMaterialBindingCount !== 0
      || control.blockingItemIds.length !== 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["scorecard"],
        message: "得分卡缺失时不得保留推导计数、分数或阻断项",
      });
    }
    return;
  }
  const countEvidence = (status: GoldCompetitionEvidenceStatus) => (
    scorecard.items.filter((item) => item.evidenceStatus === status).length
  );
  const scoredItems = scorecard.items.filter(
    (item) => item.assessment.status === "frozen",
  );
  const materialBindings = scorecard.items.flatMap(
    (item) => item.materialBindings,
  );
  const expectedBlockingItemIds = scorecard.items
    .filter((item) => (
      item.evidenceStatus !== "passed"
      || item.assessment.status !== "frozen"
      || !item.materialBindings.every(
        (binding) => binding.status === "verified",
      )
    ))
    .map((item) => item.scoreItemId);
  if (
    control.dimensionCount !== scorecard.dimensions.length
    || control.itemCount !== scorecard.items.length
    || control.evidencePassedItemCount !== countEvidence("passed")
    || control.evidenceFailedItemCount !== countEvidence("failed")
    || control.evidenceInsufficientItemCount
      !== countEvidence("insufficient")
    || control.evidenceUnverifiedItemCount !== countEvidence("unverified")
    || control.evidenceReadyMaxScore !== scorecard.items
      .filter((item) => item.evidenceStatus === "passed")
      .reduce((sum, item) => sum + item.maxScore, 0)
    || control.scoredItemCount !== scoredItems.length
    || control.materialBindingCount !== materialBindings.length
    || control.verifiedMaterialBindingCount !== materialBindings.filter(
      (binding) => binding.status === "verified",
    ).length
    || control.blockingItemIds.length !== expectedBlockingItemIds.length
    || expectedBlockingItemIds.some(
      (itemId) => !control.blockingItemIds.includes(itemId),
    )
  ) {
    context.addIssue({
      code: "custom",
      path: ["scorecard"],
      message: "官方得分卡推导计数、权重或阻断项与六项原件不一致",
    });
  }
  const allItemsScored = scoredItems.length === scorecard.items.length;
  const frozenScoreTotal = scoredItems.reduce(
    (sum, item) => sum + (item.assessment.score ?? 0),
    0,
  );
  if (
    (allItemsScored && control.independentMockScoreTotal !== frozenScoreTotal)
    || (!allItemsScored && control.independentMockScoreTotal !== null)
  ) {
    context.addIssue({
      code: "custom",
      path: ["independentMockScoreTotal"],
      message: "只有六项模拟评审全部冻结后才能显示完整模拟总分",
    });
  }
  if (
    control.status === "passed"
    && (
      control.artifact.integrity !== "verified"
      || expectedBlockingItemIds.length > 0
    )
  ) {
    context.addIssue({
      code: "custom",
      path: ["status"],
      message: "得分卡只有在证据、模拟评审和材料定位逐项闭合后才能通过",
    });
  }
});
export type GoldCompetitionOfficialScorecard = z.infer<
  typeof GoldCompetitionOfficialScorecardSchema
>;

export const GoldCompetitionIflytekFitSchema = z.object({
  status: GoldCompetitionEvidenceStatusSchema,
  mode: z.enum(["mock", "live"]),
  capabilityCount: z.number().int().nonnegative(),
  configuredCapabilityCount: z.number().int().nonnegative(),
  availableCapabilityCount: z.number().int().nonnegative(),
  rationale: z.string().min(1).max(800),
  claimBoundary: z.string().min(1).max(800),
}).strict();
export type GoldCompetitionIflytekFit = z.infer<
  typeof GoldCompetitionIflytekFitSchema
>;

export const GoldCompetitionReadinessSummarySchema = z.object({
  overallStatus: GoldCompetitionEvidenceStatusSchema,
  passedDeliverableCount: z.number().int().min(0).max(6),
  failedDeliverableCount: z.number().int().min(0).max(6),
  insufficientDeliverableCount: z.number().int().min(0).max(6),
  unverifiedDeliverableCount: z.number().int().min(0).max(6),
  readyForCompetitionClaim: z.boolean(),
  blockingDeliverableIds: z.array(GoldCompetitionDeliverableIdSchema),
}).strict();
export type GoldCompetitionReadinessSummary = z.infer<
  typeof GoldCompetitionReadinessSummarySchema
>;

export const GoldCompetitionReadinessSnapshotSchema = z.object({
  schemaVersion: z.literal(GoldCompetitionReadinessSchemaVersion),
  generatedAt: z.string().datetime(),
  productVersion: z.string().min(1).max(120),
  evidenceSourceGitCommit: z.string().regex(/^[a-f0-9]{40}$/u).nullable(),
  sourceArtifacts: z.array(GoldCompetitionSourceArtifactSchema).length(5),
  goldenDemo: GoldCompetitionGoldenDemoEvidenceSchema.nullable(),
  coreClaims: z.array(GoldCompetitionCoreClaimSchema).length(3),
  deliverables: z.array(GoldCompetitionDeliverableSchema).length(6),
  officialAlignment: GoldCompetitionOfficialAlignmentSchema,
  officialScorecard: GoldCompetitionOfficialScorecardSchema,
  iflytekFit: GoldCompetitionIflytekFitSchema,
  summary: GoldCompetitionReadinessSummarySchema,
  claimBoundary: z.string().min(1).max(1_500),
  snapshotHash: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict().superRefine((snapshot, context) => {
  const exactCoverage = (
    values: readonly string[],
    options: readonly string[],
    path: string,
    message: string,
  ) => {
    if (
      values.length !== options.length
      || new Set(values).size !== options.length
      || options.some((option) => !values.includes(option))
    ) {
      context.addIssue({ code: "custom", path: [path], message });
    }
  };
  exactCoverage(
    snapshot.sourceArtifacts.map((source) => source.sourceId),
    GoldCompetitionSourceIdSchema.options,
    "sourceArtifacts",
    "国金来源快照必须且只能覆盖五类冻结工件",
  );
  exactCoverage(
    snapshot.coreClaims.map((claim) => claim.claimId),
    GoldCompetitionClaimIdSchema.options,
    "coreClaims",
    "国金主张快照必须且只能覆盖三条核心主张",
  );
  exactCoverage(
    snapshot.deliverables.map((deliverable) => deliverable.deliverableId),
    GoldCompetitionDeliverableIdSchema.options,
    "deliverables",
    "国金成果快照必须且只能覆盖六类成果",
  );
  const statusCount = (
    snapshot.summary.passedDeliverableCount
    + snapshot.summary.failedDeliverableCount
    + snapshot.summary.insufficientDeliverableCount
    + snapshot.summary.unverifiedDeliverableCount
  );
  if (statusCount !== snapshot.deliverables.length) {
    context.addIssue({
      code: "custom",
      path: ["summary"],
      message: "成果状态计数必须覆盖全部六类成果",
    });
  }
  if (
    snapshot.summary.readyForCompetitionClaim
    && (
      snapshot.summary.overallStatus !== "passed"
      || snapshot.deliverables.some((item) => item.status !== "passed")
      || snapshot.officialAlignment.status !== "passed"
      || snapshot.officialScorecard.status !== "passed"
      || snapshot.iflytekFit.status !== "passed"
    )
  ) {
    context.addIssue({
      code: "custom",
      path: ["summary", "readyForCompetitionClaim"],
      message: "只有六类成果、官方对齐、得分卡与讯飞适配全部通过后才能形成参赛就绪主张",
    });
  }
});
export type GoldCompetitionReadinessSnapshot = z.infer<
  typeof GoldCompetitionReadinessSnapshotSchema
>;

export const PersistedSessionSchema = z.object({
  sessionId: z.string().min(1),
  scenarioId: z.string().min(1),
  events: z.array(WorldEventSchema),
});
export type PersistedSession = z.infer<typeof PersistedSessionSchema>;

export function createMessageMeta(input: {
  sessionId: string;
  sceneId: string;
  actorId: string;
  correlationId?: string;
  timestamp?: string;
}): MessageMeta {
  const messageId = crypto.randomUUID();
  return {
    sessionId: input.sessionId,
    sceneId: input.sceneId,
    actorId: input.actorId,
    messageId,
    correlationId: input.correlationId ?? messageId,
    timestamp: input.timestamp ?? new Date().toISOString(),
    schemaVersion: SchemaVersion,
  };
}
export * from './demo-login.js';
