import { z } from "zod";
import {
  CourseReleaseReferenceSchema,
  V2IdentifierSchema,
} from "./course-learning.js";

export const AgentCollaborationEpisodeSchemaVersion =
  "agent-collaboration-episode/2.0.0" as const;
export const AgentTopologyManifestSchemaVersion =
  "agent-topology-manifest/2.0.0" as const;

export const AgentGroupIdSchema = z.enum([
  "teaching_direction",
  "editorial_production",
  "fact_verification",
  "content_governance",
  "operations_distribution",
  "evaluation_learning",
]);
export type AgentGroupId = z.infer<typeof AgentGroupIdSchema>;

export const AgentExecutionModeSchema = z.enum([
  "live",
  "deterministic_demo",
  "degraded",
]);
export type AgentExecutionMode = z.infer<typeof AgentExecutionModeSchema>;

export const AgentTopologyGroupSchema = z.object({
  groupId: AgentGroupIdSchema,
  title: z.string().trim().min(1).max(120),
  responsibility: z.string().trim().min(1).max(600),
  order: z.number().int().min(1).max(6),
}).strict();
export type AgentTopologyGroup = z.infer<typeof AgentTopologyGroupSchema>;

export const AgentTopologyNodeSchema = z.object({
  agentId: V2IdentifierSchema,
  templateId: V2IdentifierSchema,
  title: z.string().trim().min(1).max(160),
  groupId: AgentGroupIdSchema,
  responsibility: z.string().trim().min(1).max(600),
  subscribedEventTypes: z.array(V2IdentifierSchema).min(1).max(32),
  inputTypes: z.array(V2IdentifierSchema).min(1).max(32),
  outputTypes: z.array(V2IdentifierSchema).min(1).max(32),
  allowedActions: z.array(V2IdentifierSchema).max(32),
  forbiddenActions: z.array(V2IdentifierSchema).min(1).max(32),
  teacherGateRequired: z.boolean(),
  status: z.enum(["active", "disabled", "retired"]),
}).strict().superRefine((node, context) => {
  const forbidden = new Set(node.forbiddenActions);
  const overlap = node.allowedActions.filter((action) => forbidden.has(action));
  if (overlap.length > 0) {
    context.addIssue({
      code: "custom",
      path: ["allowedActions"],
      message: "智能体动作不得同时出现在允许与禁止集合",
    });
  }
});
export type AgentTopologyNode = z.infer<typeof AgentTopologyNodeSchema>;

export const AgentTopologyEdgeSchema = z.object({
  edgeId: V2IdentifierSchema,
  sourceAgentId: V2IdentifierSchema,
  targetAgentId: V2IdentifierSchema,
  eventType: V2IdentifierSchema,
  relation: z.enum(["notifies", "supports", "reviews", "gates"]),
}).strict();
export type AgentTopologyEdge = z.infer<typeof AgentTopologyEdgeSchema>;

export const AgentTopologyManifestSchema = z.object({
  schemaVersion: z.literal(AgentTopologyManifestSchemaVersion),
  generatedAt: z.string().datetime(),
  groups: z.array(AgentTopologyGroupSchema).length(6),
  agents: z.array(AgentTopologyNodeSchema).length(14),
  edges: z.array(AgentTopologyEdgeSchema).max(128),
}).strict().superRefine((manifest, context) => {
  const expectedGroups = AgentGroupIdSchema.options;
  const groupIds = manifest.groups.map((group) => group.groupId);
  if (
    new Set(groupIds).size !== expectedGroups.length
    || expectedGroups.some((groupId) => !groupIds.includes(groupId))
  ) {
    context.addIssue({
      code: "custom",
      path: ["groups"],
      message: "智能体拓扑必须且只能覆盖六个冻结分组",
    });
  }
  const orders = manifest.groups.map((group) => group.order);
  if (orders.join(",") !== "1,2,3,4,5,6") {
    context.addIssue({
      code: "custom",
      path: ["groups"],
      message: "智能体分组必须按 1—6 稳定排序",
    });
  }
  const agentIds = manifest.agents.map((agent) => agent.agentId);
  if (new Set(agentIds).size !== manifest.agents.length) {
    context.addIssue({
      code: "custom",
      path: ["agents"],
      message: "十四智能体 ID 必须唯一",
    });
  }
  const agentIdSet = new Set(agentIds);
  manifest.edges.forEach((edge, index) => {
    if (!agentIdSet.has(edge.sourceAgentId) || !agentIdSet.has(edge.targetAgentId)) {
      context.addIssue({
        code: "custom",
        path: ["edges", index],
        message: "拓扑边的两端必须引用已登记智能体",
      });
    }
  });
});
export type AgentTopologyManifest = z.infer<
  typeof AgentTopologyManifestSchema
>;

export const CollaborationEventSummarySchema = z.object({
  eventId: V2IdentifierSchema,
  eventType: V2IdentifierSchema,
  title: z.string().trim().min(1).max(240),
  occurredAt: z.string().datetime(),
  source: z.enum(["student_action", "teacher_action", "world", "system_time"]),
  evidenceRefs: z.array(V2IdentifierSchema).max(64),
}).strict();
export type CollaborationEventSummary = z.infer<
  typeof CollaborationEventSummarySchema
>;

export const CollaborationAgentRefSchema = z.object({
  agentId: V2IdentifierSchema,
  templateId: V2IdentifierSchema,
  instanceId: V2IdentifierSchema.nullable(),
  groupId: AgentGroupIdSchema,
  title: z.string().trim().min(1).max(160),
}).strict();
export type CollaborationAgentRef = z.infer<
  typeof CollaborationAgentRefSchema
>;

export const AffectedAgentDecisionSchema = z.object({
  agent: CollaborationAgentRefSchema,
  decision: z.enum(["selected", "skipped"]),
  reasonCode: z.enum([
    "event_subscription_match",
    "affected_object_match",
    "not_affected",
    "permission_denied",
    "budget_limit",
    "deduplicated",
    "disabled",
    "unavailable",
  ]),
  reason: z.string().trim().min(1).max(600),
  evidenceRefs: z.array(V2IdentifierSchema).max(64),
}).strict().superRefine((decision, context) => {
  const selectedReasons = new Set([
    "event_subscription_match",
    "affected_object_match",
  ]);
  if (
    decision.decision === "selected"
    && !selectedReasons.has(decision.reasonCode)
  ) {
    context.addIssue({
      code: "custom",
      path: ["reasonCode"],
      message: "选中智能体只能使用订阅或受影响对象匹配理由",
    });
  }
  if (
    decision.decision === "skipped"
    && selectedReasons.has(decision.reasonCode)
  ) {
    context.addIssue({
      code: "custom",
      path: ["reasonCode"],
      message: "跳过智能体必须提供明确过滤理由",
    });
  }
});
export type AffectedAgentDecision = z.infer<
  typeof AffectedAgentDecisionSchema
>;

export const AgentContributionSummarySchema = z.object({
  contributionId: V2IdentifierSchema,
  agent: CollaborationAgentRefSchema,
  summary: z.string().trim().min(1).max(1_000),
  rationale: z.string().trim().min(1).max(1_000),
  evidenceRefs: z.array(V2IdentifierSchema).min(1).max(64),
  riskLevel: z.enum(["low", "medium", "high"]),
  status: z.enum(["ready", "failed", "rejected"]),
}).strict();
export type AgentContributionSummary = z.infer<
  typeof AgentContributionSummarySchema
>;

export const StudentAgentSuggestionSchema = z.object({
  suggestionId: V2IdentifierSchema,
  agent: z.object({
    agentId: V2IdentifierSchema,
    groupId: AgentGroupIdSchema,
    title: z.string().trim().min(1).max(160),
  }).strict(),
  summary: z.string().trim().min(1).max(1_000),
  rationale: z.string().trim().min(1).max(1_000),
  evidenceRefs: z.array(V2IdentifierSchema).min(1).max(64),
  riskLevel: z.enum(["low", "medium", "high"]),
  allowedDecisions: z.tuple([
    z.literal("accept"),
    z.literal("request_evidence"),
    z.literal("reject"),
  ]),
}).strict();
export type StudentAgentSuggestion = z.infer<
  typeof StudentAgentSuggestionSchema
>;

export const CollaborationStudentDecisionSchema = z.object({
  decision: z.enum(["accept", "request_evidence", "reject"]),
  reason: z.string().trim().min(1).max(1_000),
  decidedAt: z.string().datetime(),
  evidenceRefs: z.array(V2IdentifierSchema).max(64),
}).strict();
export type CollaborationStudentDecision = z.infer<
  typeof CollaborationStudentDecisionSchema
>;

export const CollaborationTeacherGateSchema = z.object({
  gateId: V2IdentifierSchema,
  status: z.enum(["not_required", "pending", "approved", "rejected"]),
  summary: z.string().trim().min(1).max(1_000),
  reviewedAt: z.string().datetime().nullable(),
}).strict().superRefine((gate, context) => {
  if (
    (gate.status === "approved" || gate.status === "rejected")
    !== (gate.reviewedAt !== null)
  ) {
    context.addIssue({
      code: "custom",
      path: ["reviewedAt"],
      message: "只有已审批或已驳回教师门才能携带复核时间",
    });
  }
});
export type CollaborationTeacherGate = z.infer<
  typeof CollaborationTeacherGateSchema
>;

export const CollaborationAuthorityWritebackSchema = z.object({
  occurred: z.boolean(),
  summary: z.string().trim().min(1).max(1_000),
  worldEventIds: z.array(V2IdentifierSchema).max(64),
  taskIds: z.array(V2IdentifierSchema).max(64),
  evidenceIds: z.array(V2IdentifierSchema).max(128),
  consequences: z.array(z.string().trim().min(1).max(500)).max(16),
}).strict().superRefine((writeback, context) => {
  const referenceCount = writeback.worldEventIds.length
    + writeback.taskIds.length
    + writeback.evidenceIds.length;
  if (writeback.occurred && referenceCount === 0) {
    context.addIssue({
      code: "custom",
      path: ["occurred"],
      message: "发生权威写回时必须保留至少一项世界、任务或证据引用",
    });
  }
  if (!writeback.occurred && referenceCount > 0) {
    context.addIssue({
      code: "custom",
      path: ["occurred"],
      message: "未发生写回时不得附带可写引用",
    });
  }
});
export type CollaborationAuthorityWriteback = z.infer<
  typeof CollaborationAuthorityWritebackSchema
>;

const EpisodeSharedShape = {
  schemaVersion: z.literal(AgentCollaborationEpisodeSchemaVersion),
  sessionId: V2IdentifierSchema,
  scenarioId: V2IdentifierSchema,
  courseReleaseRef: CourseReleaseReferenceSchema,
  stateVersion: z.number().int().nonnegative(),
  generatedAt: z.string().datetime(),
};

export const StudentCollaborationEpisodeSchema = z.object({
  ...EpisodeSharedShape,
  audience: z.literal("student"),
  status: z.enum([
    "waiting",
    "suggestion_ready",
    "decided",
    "completed",
    "failed",
  ]),
  triggerEvent: CollaborationEventSummarySchema.nullable(),
  suggestion: StudentAgentSuggestionSchema.nullable(),
  studentDecision: CollaborationStudentDecisionSchema.nullable(),
  teacherGate: CollaborationTeacherGateSchema.nullable(),
  authorityWriteback: CollaborationAuthorityWritebackSchema.nullable(),
  failure: z.object({
    code: z.enum(["no_applicable_agent", "suggestion_failed", "version_hash_drift"]),
    message: z.string().trim().min(1).max(500),
  }).strict().nullable(),
}).strict().superRefine((episode, context) => {
  if (episode.status === "waiting") {
    if (
      episode.triggerEvent !== null
      || episode.suggestion !== null
      || episode.studentDecision !== null
      || episode.teacherGate !== null
      || episode.authorityWriteback !== null
      || episode.failure !== null
    ) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "学生等待态不得伪造事件、建议、决定、写回或失败",
      });
    }
    return;
  }
  if (episode.status === "failed") {
    if (episode.failure === null || episode.authorityWriteback !== null) {
      context.addIssue({
        code: "custom",
        path: ["failure"],
        message: "失败 Episode 必须显式失败且不得伪造权威写回",
      });
    }
    return;
  }
  if (episode.triggerEvent === null || episode.suggestion === null) {
    context.addIssue({
      code: "custom",
      path: ["suggestion"],
      message: "非等待学生 Episode 必须有触发事件和唯一建议",
    });
  }
  if (
    (episode.status === "decided" || episode.status === "completed")
    && episode.studentDecision === null
  ) {
    context.addIssue({
      code: "custom",
      path: ["studentDecision"],
      message: "已决定或已完成 Episode 必须保留学生选择",
    });
  }
  if (episode.status === "completed" && episode.authorityWriteback === null) {
    context.addIssue({
      code: "custom",
      path: ["authorityWriteback"],
      message: "完成 Episode 必须显式说明是否发生权威写回",
    });
  }
  if (
    episode.teacherGate?.status !== "approved"
    && episode.authorityWriteback?.occurred === true
  ) {
    context.addIssue({
      code: "custom",
      path: ["authorityWriteback"],
      message: "未获教师门批准不得声称已发生权威写回",
    });
  }
  if (episode.failure !== null) {
    context.addIssue({
      code: "custom",
      path: ["failure"],
      message: "非失败 Episode 不得附带失败对象",
    });
  }
});
export type StudentCollaborationEpisode = z.infer<
  typeof StudentCollaborationEpisodeSchema
>;

const BusinessEpisodeShape = {
  ...EpisodeSharedShape,
  status: z.enum(["waiting", "in_progress", "awaiting_gate", "completed", "failed"]),
  triggerEvent: CollaborationEventSummarySchema.nullable(),
  affectedAgents: z.array(AffectedAgentDecisionSchema).max(14),
  contributions: z.array(AgentContributionSummarySchema).max(14),
  studentDecision: CollaborationStudentDecisionSchema.nullable(),
  teacherGate: CollaborationTeacherGateSchema.nullable(),
  authorityWriteback: CollaborationAuthorityWritebackSchema.nullable(),
  failureCode: z.enum([
    "no_applicable_agent",
    "agent_execution_failed",
    "version_hash_drift",
    "teacher_rejected",
  ]).nullable(),
};

export const TeacherCollaborationEpisodeSchema = z.object({
  ...BusinessEpisodeShape,
  audience: z.literal("teacher"),
}).strict().superRefine(validateBusinessEpisode);
export type TeacherCollaborationEpisode = z.infer<
  typeof TeacherCollaborationEpisodeSchema
>;

export const AdminCollaborationEpisodeSchema = z.object({
  ...BusinessEpisodeShape,
  audience: z.literal("admin"),
  execution: z.object({
    mode: AgentExecutionModeSchema,
    providerId: V2IdentifierSchema.nullable(),
    selectedCount: z.number().int().nonnegative().max(14),
    skippedCount: z.number().int().nonnegative().max(14),
    failedAgentIds: z.array(V2IdentifierSchema).max(14),
    traceRefs: z.array(V2IdentifierSchema).max(256),
  }).strict(),
}).strict().superRefine((episode, context) => {
  validateBusinessEpisode(episode, context);
  const selectedCount = episode.affectedAgents.filter(
    (decision) => decision.decision === "selected",
  ).length;
  const skippedCount = episode.affectedAgents.length - selectedCount;
  if (
    episode.execution.selectedCount !== selectedCount
    || episode.execution.skippedCount !== skippedCount
  ) {
    context.addIssue({
      code: "custom",
      path: ["execution"],
      message: "管理员执行计数必须与受影响集合一致",
    });
  }
  if (episode.execution.mode !== "live" && episode.execution.providerId !== null) {
    context.addIssue({
      code: "custom",
      path: ["execution", "providerId"],
      message: "只有真实 Live 执行可以公开安全供应方标识",
    });
  }
});
export type AdminCollaborationEpisode = z.infer<
  typeof AdminCollaborationEpisodeSchema
>;

export const AgentCollaborationEpisodeSchema = z.discriminatedUnion(
  "audience",
  [
    StudentCollaborationEpisodeSchema,
    TeacherCollaborationEpisodeSchema,
    AdminCollaborationEpisodeSchema,
  ],
);
export type AgentCollaborationEpisode = z.infer<
  typeof AgentCollaborationEpisodeSchema
>;

function validateBusinessEpisode(
  episode: z.infer<z.ZodObject<typeof BusinessEpisodeShape>>,
  context: z.RefinementCtx,
): void {
  if (episode.status === "waiting") {
    if (
      episode.triggerEvent !== null
      || episode.affectedAgents.length > 0
      || episode.contributions.length > 0
      || episode.studentDecision !== null
      || episode.teacherGate !== null
      || episode.authorityWriteback !== null
      || episode.failureCode !== null
    ) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "教师/管理员等待态必须保持单一紧凑空态",
      });
    }
    return;
  }
  if (episode.triggerEvent === null) {
    context.addIssue({
      code: "custom",
      path: ["triggerEvent"],
      message: "非等待业务 Episode 必须有触发事件",
    });
  }
  const selectedAgentIds = new Set(
    episode.affectedAgents
      .filter((decision) => decision.decision === "selected")
      .map((decision) => decision.agent.agentId),
  );
  for (const contribution of episode.contributions) {
    if (!selectedAgentIds.has(contribution.agent.agentId)) {
      context.addIssue({
        code: "custom",
        path: ["contributions"],
        message: "贡献只能来自受影响集合中被选中的智能体",
      });
    }
  }
  if (
    episode.status === "awaiting_gate"
    && episode.teacherGate?.status !== "pending"
  ) {
    context.addIssue({
      code: "custom",
      path: ["teacherGate"],
      message: "等待教师门状态必须对应 pending 门",
    });
  }
  if (
    episode.teacherGate?.status !== "approved"
    && episode.authorityWriteback?.occurred === true
  ) {
    context.addIssue({
      code: "custom",
      path: ["authorityWriteback"],
      message: "未获教师门批准不得声称已发生权威写回",
    });
  }
  if (episode.status === "failed") {
    if (episode.failureCode === null || episode.authorityWriteback !== null) {
      context.addIssue({
        code: "custom",
        path: ["failureCode"],
        message: "失败业务 Episode 必须显式失败且不得伪造写回",
      });
    }
  } else if (episode.failureCode !== null) {
    context.addIssue({
      code: "custom",
      path: ["failureCode"],
      message: "非失败业务 Episode 不得附带失败码",
    });
  }
  if (episode.status === "completed" && episode.authorityWriteback === null) {
    context.addIssue({
      code: "custom",
      path: ["authorityWriteback"],
      message: "完成业务 Episode 必须显式说明是否发生权威写回",
    });
  }
}
