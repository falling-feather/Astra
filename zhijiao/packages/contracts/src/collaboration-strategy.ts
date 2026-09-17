import { z } from "zod";

export const CollaborationStrategySchemaVersion =
  "collaboration-strategy/1.0.0" as const;

export const FlagshipCollaborationScenarioReleaseId =
  "scenario-local-tourism-media-v0.1@1.1.1" as const;
export const FlagshipCollaborationRouteId =
  "route-rain-escalation" as const;
export const FlagshipCollaborationEventId =
  "flagship-event-rain-escalation" as const;
export const FlagshipCollaborationTaskAnchorId =
  "flagship-task-rain-collaboration" as const;
export const FlagshipCollaborationTeacherApprovedRef =
  "flagship-rain-collaboration:teacher-review:approved" as const;
export const FlagshipCollaborationWorldWritebackRef =
  "flagship-rain-collaboration:world-writeback:completed" as const;
export const FlagshipCollaborationEvidenceWritebackRef =
  "flagship-rain-collaboration:evidence-writeback:present" as const;
export const FlagshipCollaborationStudentDecisionRefPrefix =
  "flagship-rain-collaboration:student-decision:" as const;

export const CollaborationStrategyStatusSchema = z.enum([
  "draft",
  "approved",
  "disabled",
  "retired",
]);
export type CollaborationStrategyStatus = z.infer<
  typeof CollaborationStrategyStatusSchema
>;

export const CollaborationStrategyGovernanceActionSchema = z.enum([
  "approve",
  "disable",
  "retire",
]);
export type CollaborationStrategyGovernanceAction = z.infer<
  typeof CollaborationStrategyGovernanceActionSchema
>;

export const CollaborationStrategyAgentIdSchema = z.enum([
  "agent-evidence-coach",
  "agent-material-understanding",
  "agent-evaluation-review",
]);
export type CollaborationStrategyAgentId = z.infer<
  typeof CollaborationStrategyAgentIdSchema
>;

export const CollaborationStrategyStudentChoiceAgentIdSchema = z.enum([
  "agent-evidence-coach",
  "agent-material-understanding",
]);
export type CollaborationStrategyStudentChoiceAgentId = z.infer<
  typeof CollaborationStrategyStudentChoiceAgentIdSchema
>;

export function flagshipCollaborationStudentDecisionRef(
  agentId: CollaborationStrategyStudentChoiceAgentId,
  decision: "accepted" | "rejected",
): string {
  return `${FlagshipCollaborationStudentDecisionRefPrefix}${agentId}:${decision}`;
}

export function parseFlagshipCollaborationStudentDecisionRef(
  refId: string,
): {
  agentId: CollaborationStrategyStudentChoiceAgentId;
  decision: "accepted" | "rejected";
} | null {
  const match =
    /^flagship-rain-collaboration:student-decision:([^:]+):(accepted|rejected)$/u
      .exec(refId);
  if (!match) return null;
  const agentId = CollaborationStrategyStudentChoiceAgentIdSchema.safeParse(
    match[1],
  );
  if (!agentId.success) return null;
  return {
    agentId: agentId.data,
    decision: match[2] as "accepted" | "rejected",
  };
}

export const CollaborationStrategyVisibilityScopeSchema = z.enum([
  "assigned_team",
  "role_private",
  "teacher_only",
  "audit_only",
]);
export type CollaborationStrategyVisibilityScope = z.infer<
  typeof CollaborationStrategyVisibilityScopeSchema
>;

const IdentifierSchema = z.string()
  .min(1)
  .max(240)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/@-]*$/u);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const StrategyVersionSchema = z.number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);

export const CollaborationStrategyReferenceSchema = z.object({
  strategyId: IdentifierSchema,
  version: StrategyVersionSchema,
  contentHash: Sha256Schema,
}).strict();
export type CollaborationStrategyReference = z.infer<
  typeof CollaborationStrategyReferenceSchema
>;

export const CollaborationStrategyEventConditionsSchema = z.object({
  scenarioReleaseId: z.literal(FlagshipCollaborationScenarioReleaseId),
  routeId: z.literal(FlagshipCollaborationRouteId),
  triggerEventId: z.literal(FlagshipCollaborationEventId),
  taskAnchorId: z.literal(FlagshipCollaborationTaskAnchorId),
  requiredEventRefs: z.array(IdentifierSchema).max(32),
}).strict();
export type CollaborationStrategyEventConditions = z.infer<
  typeof CollaborationStrategyEventConditionsSchema
>;

export const CollaborationStrategyAgentPermissionSchema = z.object({
  agentId: CollaborationStrategyAgentIdSchema,
  visibleScopes: z.array(CollaborationStrategyVisibilityScopeSchema)
    .min(1)
    .max(4),
  capabilities: z.array(IdentifierSchema).min(1).max(32),
  privateDataPolicy: z.enum(["subject_only", "teacher_only", "none"]),
  authoritativeWorldWrite: z.literal(false),
}).strict();
export type CollaborationStrategyAgentPermission = z.infer<
  typeof CollaborationStrategyAgentPermissionSchema
>;

export const CollaborationStrategyBasisReferenceSchema = z.object({
  refType: z.enum([
    "world_event",
    "agent_run",
    "student_action",
    "teacher_review",
    "world_consequence",
    "evidence",
  ]),
  refId: IdentifierSchema,
  version: z.string().min(1).max(120).nullable(),
}).strict();
export type CollaborationStrategyBasisReference = z.infer<
  typeof CollaborationStrategyBasisReferenceSchema
>;

export const CollaborationStrategyStudentChoiceSchema = z.object({
  decision: z.enum(["accepted", "rejected"]),
  selectedAgentIds: z.array(
    CollaborationStrategyStudentChoiceAgentIdSchema,
  ).max(2),
  reason: z.string().trim().min(1).max(2_000),
  actionRef: IdentifierSchema,
  decidedAt: z.string().datetime(),
}).strict();
export type CollaborationStrategyStudentChoice = z.infer<
  typeof CollaborationStrategyStudentChoiceSchema
>;

export const CollaborationStrategyContentSchema = z.object({
  eventConditions: CollaborationStrategyEventConditionsSchema,
  agentSet: z.array(CollaborationStrategyAgentIdSchema).min(1).max(3),
  permissions: z.array(CollaborationStrategyAgentPermissionSchema).min(1).max(3),
  basisRefs: z.array(CollaborationStrategyBasisReferenceSchema).min(1).max(64),
  recommendationSummary: z.string().trim().min(1).max(4_000),
  studentChoice: CollaborationStrategyStudentChoiceSchema,
  consequenceRefs: z.array(IdentifierSchema).min(1).max(64),
  evidenceRefs: z.array(IdentifierSchema).min(1).max(128),
}).strict().superRefine((content, context) => {
  const agentIds = new Set(content.agentSet);
  if (agentIds.size !== content.agentSet.length) {
    context.addIssue({
      code: "custom",
      path: ["agentSet"],
      message: "协作策略智能体集合不得重复",
    });
  }

  const permissionIds = new Set(content.permissions.map(
    (permission) => permission.agentId,
  ));
  if (permissionIds.size !== content.permissions.length) {
    context.addIssue({
      code: "custom",
      path: ["permissions"],
      message: "每个策略智能体只能有一份权限约束",
    });
  }
  if (
    permissionIds.size !== agentIds.size
    || [...agentIds].some((agentId) => !permissionIds.has(agentId))
  ) {
    context.addIssue({
      code: "custom",
      path: ["permissions"],
      message: "权限约束必须与策略智能体集合一一对应",
    });
  }

  const selectedIds = new Set(content.studentChoice.selectedAgentIds);
  if (selectedIds.size !== content.studentChoice.selectedAgentIds.length) {
    context.addIssue({
      code: "custom",
      path: ["studentChoice", "selectedAgentIds"],
      message: "学生选择中的智能体不得重复",
    });
  }
  if ([...selectedIds].some((agentId) => !agentIds.has(agentId))) {
    context.addIssue({
      code: "custom",
      path: ["studentChoice", "selectedAgentIds"],
      message: "学生选择只能引用当前策略中的智能体",
    });
  }
  if (
    content.studentChoice.decision === "accepted"
    && selectedIds.size === 0
  ) {
    context.addIssue({
      code: "custom",
      path: ["studentChoice", "selectedAgentIds"],
      message: "采纳策略时至少选择一个策略智能体",
    });
  }
  if (
    content.studentChoice.decision === "rejected"
    && selectedIds.size > 0
  ) {
    context.addIssue({
      code: "custom",
      path: ["studentChoice", "selectedAgentIds"],
      message: "拒绝策略时不得保留已选择智能体",
    });
  }
});
export type CollaborationStrategyContent = z.infer<
  typeof CollaborationStrategyContentSchema
>;

export const CollaborationStrategyTeacherReviewSchema = z.object({
  action: CollaborationStrategyGovernanceActionSchema,
  teacherActorId: IdentifierSchema,
  reason: z.string().trim().min(1).max(2_000),
  reviewedAt: z.string().datetime(),
}).strict();
export type CollaborationStrategyTeacherReview = z.infer<
  typeof CollaborationStrategyTeacherReviewSchema
>;

export const CollaborationStrategyGovernanceSchema = z.object({
  status: CollaborationStrategyStatusSchema,
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  latestReview: CollaborationStrategyTeacherReviewSchema.nullable(),
}).strict().superRefine((governance, context) => {
  if (governance.status === "draft") {
    if (governance.revision !== 0 || governance.latestReview !== null) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "draft 策略必须保持治理修订 0 且没有教师复核",
      });
    }
    return;
  }
  if (governance.revision < 1 || !governance.latestReview) {
    context.addIssue({
      code: "custom",
      path: ["latestReview"],
      message: "非 draft 策略必须保留教师治理复核",
    });
    return;
  }
  const expectedStatusByAction = {
    approve: "approved",
    disable: "disabled",
    retire: "retired",
  } as const;
  if (expectedStatusByAction[governance.latestReview.action] !== governance.status) {
    context.addIssue({
      code: "custom",
      path: ["latestReview", "action"],
      message: "教师治理动作与当前策略状态不一致",
    });
  }
});
export type CollaborationStrategyGovernance = z.infer<
  typeof CollaborationStrategyGovernanceSchema
>;

export const CollaborationStrategySchema = z.object({
  kind: z.literal("CollaborationStrategy"),
  schemaVersion: z.literal(CollaborationStrategySchemaVersion),
  strategyId: IdentifierSchema,
  version: StrategyVersionSchema,
  contentHash: Sha256Schema,
  content: CollaborationStrategyContentSchema,
  governance: CollaborationStrategyGovernanceSchema,
  createdBy: IdentifierSchema,
  createdAt: z.string().datetime(),
}).strict();
export type CollaborationStrategy = z.infer<
  typeof CollaborationStrategySchema
>;

export const CollaborationStrategyDraftInputSchema = z.object({
  strategyId: IdentifierSchema,
  version: StrategyVersionSchema,
  content: CollaborationStrategyContentSchema,
}).strict();
export type CollaborationStrategyDraftInput = z.infer<
  typeof CollaborationStrategyDraftInputSchema
>;

export const CollaborationStrategyGovernanceInputSchema = z.object({
  expectedStatus: CollaborationStrategyStatusSchema,
  expectedGovernanceRevision: z.number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER),
  expectedContentHash: Sha256Schema,
  action: CollaborationStrategyGovernanceActionSchema,
  reason: z.string().trim().min(1).max(2_000),
}).strict();
export type CollaborationStrategyGovernanceInput = z.infer<
  typeof CollaborationStrategyGovernanceInputSchema
>;

export const CollaborationStrategyQuerySchema = z.object({
  status: CollaborationStrategyStatusSchema.optional(),
  triggerEventId: z.literal(FlagshipCollaborationEventId).optional(),
}).strict();
export type CollaborationStrategyQuery = z.infer<
  typeof CollaborationStrategyQuerySchema
>;
