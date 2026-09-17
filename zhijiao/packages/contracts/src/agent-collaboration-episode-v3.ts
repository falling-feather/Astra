import { z } from "zod";
import {
  CourseReleaseReferenceSchema,
  V2ContentHashSchema,
  V2IdentifierSchema,
} from "./course-learning.js";
import { SimulationReleaseReferenceSchema } from "./world-simulation-v3.js";
import { DecisionRationaleSourceSchema } from "./decision-provenance.js";

export const AgentCollaborationEpisodeV3SchemaVersion =
  "agent-collaboration-episode/3.0.0" as const;

const TimestampSchema = z.string().datetime();
const NonEmptyTextSchema = z.string().trim().min(1);

const WorldEventReceiptSchema = z.object({
  eventId: V2IdentifierSchema,
  eventType: V2IdentifierSchema,
  title: NonEmptyTextSchema.max(240),
  occurredAt: TimestampSchema,
  sourceKind: z.enum([
    "student_action",
    "npc_intent",
    "system_clock",
    "teacher_intervention",
  ]),
  affectedObjectRefs: z.array(V2IdentifierSchema).min(1).max(32),
  evidenceRefs: z.array(V2IdentifierSchema).max(64),
}).strict();

const StudentDecisionReceiptSchema = z.object({
  decisionRef: V2IdentifierSchema,
  decision: z.enum(["accept", "request_evidence", "reject"]),
  rationale: NonEmptyTextSchema.max(1_000),
  rationaleSource: DecisionRationaleSourceSchema.optional(),
  decidedAt: TimestampSchema,
}).strict();

const TeacherGateReceiptSchema = z.object({
  gateId: V2IdentifierSchema,
  status: z.enum(["not_required", "pending", "approved", "revised", "rejected"]),
  teacherDecisionRef: V2IdentifierSchema.nullable(),
  safeSummary: NonEmptyTextSchema.max(800),
  reviewedAt: TimestampSchema.nullable(),
}).strict().superRefine((gate, context) => {
  const resolved = ["approved", "revised", "rejected"].includes(gate.status);
  if (resolved !== (gate.teacherDecisionRef !== null && gate.reviewedAt !== null)) {
    context.addIssue({
      code: "custom",
      path: ["teacherDecisionRef"],
      message: "已决教师门必须保留决定与时间，未决状态不得伪造决定",
    });
  }
});

const ConsequenceReceiptSchema = z.object({
  resolutionId: V2IdentifierSchema,
  status: z.enum(["pending_teacher_gate", "committed", "rejected", "failed"]),
  publicSummary: NonEmptyTextSchema.max(1_000),
  worldEventIds: z.array(V2IdentifierSchema).max(32),
  evidenceIds: z.array(V2IdentifierSchema).max(64),
  resultingStateVersion: z.number().int().nonnegative().nullable(),
}).strict().superRefine((receipt, context) => {
  if (receipt.status === "committed") {
    if (receipt.worldEventIds.length === 0 || receipt.resultingStateVersion === null) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "已提交后果必须具备世界事件与结果状态版本",
      });
    }
  } else if (receipt.worldEventIds.length > 0
    || receipt.evidenceIds.length > 0
    || receipt.resultingStateVersion !== null) {
    context.addIssue({
      code: "custom",
      path: ["status"],
      message: "未提交、被拒或失败 Episode 必须保持零权威写回",
    });
  }
});

const EpisodeSharedShape = {
  schemaVersion: z.literal(AgentCollaborationEpisodeV3SchemaVersion),
  episodeId: V2IdentifierSchema,
  sessionId: V2IdentifierSchema,
  scenarioId: V2IdentifierSchema,
  courseReleaseRef: CourseReleaseReferenceSchema,
  simulationReleaseRef: SimulationReleaseReferenceSchema,
  sourceWorldStateVersion: z.number().int().nonnegative(),
  generatedAt: TimestampSchema,
};

export const StudentAgentCollaborationEpisodeV3Schema = z.object({
  ...EpisodeSharedShape,
  audience: z.literal("student"),
  status: z.enum([
    "waiting",
    "suggestion_ready",
    "decided",
    "completed",
    "failed",
  ]),
  triggerEvent: WorldEventReceiptSchema.pick({
    eventId: true,
    eventType: true,
    title: true,
    occurredAt: true,
    sourceKind: true,
  }).nullable(),
  suggestion: z.object({
    suggestionId: V2IdentifierSchema,
    sourceContributionId: V2IdentifierSchema,
    provenanceVerified: z.literal(true),
    professionalRole: NonEmptyTextSchema.max(120),
    displayName: NonEmptyTextSchema.max(160),
    summary: NonEmptyTextSchema.max(1_000),
    rationale: NonEmptyTextSchema.max(1_000),
    evidenceRefs: z.array(V2IdentifierSchema).min(1).max(32),
    riskLevel: z.enum(["low", "medium", "high"]),
    allowedDecisions: z.tuple([
      z.literal("accept"),
      z.literal("request_evidence"),
      z.literal("reject"),
    ]),
  }).strict().nullable(),
  studentDecision: StudentDecisionReceiptSchema.nullable(),
  teacherGate: TeacherGateReceiptSchema.nullable(),
  consequence: ConsequenceReceiptSchema.nullable(),
  failure: z.object({
    code: z.enum([
      "no_applicable_agent",
      "agent_execution_failed",
      "version_hash_drift",
      "resolution_failed",
    ]),
    safeMessage: NonEmptyTextSchema.max(500),
  }).strict().nullable(),
}).strict().superRefine((episode, context) => {
  if (episode.status === "waiting") {
    if (episode.triggerEvent !== null
      || episode.suggestion !== null
      || episode.studentDecision !== null
      || episode.teacherGate !== null
      || episode.consequence !== null
      || episode.failure !== null) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "学生等待态不得伪造建议、决定、后果或失败",
      });
    }
    return;
  }
  if (episode.status === "failed") {
    if (episode.failure === null || episode.consequence !== null) {
      context.addIssue({
        code: "custom",
        path: ["failure"],
        message: "学生失败态必须显式失败且不得伪造后果写回",
      });
    }
    return;
  }
  if (episode.triggerEvent === null || episode.suggestion === null) {
    context.addIssue({
      code: "custom",
      path: ["suggestion"],
      message: "非等待 Episode 必须包含触发事件与唯一相关建议",
    });
  }
  if (["decided", "completed"].includes(episode.status)
    && episode.studentDecision === null) {
    context.addIssue({
      code: "custom",
      path: ["studentDecision"],
      message: "已决定或已完成 Episode 必须保留学生真实选择",
    });
  }
  if (episode.status === "completed"
    && episode.consequence?.status !== "committed") {
    context.addIssue({
      code: "custom",
      path: ["consequence"],
      message: "完成 Episode 必须显式引用已提交世界后果",
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
export type StudentAgentCollaborationEpisodeV3 = z.infer<
  typeof StudentAgentCollaborationEpisodeV3Schema
>;

const DispatchAgentDecisionSchema = z.object({
  agentId: V2IdentifierSchema,
  agentTemplateId: V2IdentifierSchema,
  professionalRoleId: V2IdentifierSchema,
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
  reason: NonEmptyTextSchema.max(600),
}).strict().superRefine((decision, context) => {
  const selectedReasons = new Set([
    "event_subscription_match",
    "affected_object_match",
  ]);
  if ((decision.decision === "selected") !== selectedReasons.has(decision.reasonCode)) {
    context.addIssue({
      code: "custom",
      path: ["reasonCode"],
      message: "智能体选中或跳过必须与因果理由一致",
    });
  }
});

const BusinessContributionSchema = z.object({
  contributionId: V2IdentifierSchema,
  agentId: V2IdentifierSchema,
  professionalRoleId: V2IdentifierSchema,
  agentTaskId: V2IdentifierSchema,
  agentRunId: V2IdentifierSchema,
  observationId: V2IdentifierSchema,
  intentId: V2IdentifierSchema,
  outputHash: V2ContentHashSchema,
  summary: NonEmptyTextSchema.max(1_000),
  rationale: NonEmptyTextSchema.max(1_000),
  evidenceRefs: z.array(V2IdentifierSchema).min(1).max(64),
  riskLevel: z.enum(["low", "medium", "high"]),
  status: z.enum(["ready", "failed", "rejected"]),
}).strict();

const BusinessEpisodeShape = {
  ...EpisodeSharedShape,
  status: z.enum([
    "waiting",
    "in_progress",
    "awaiting_gate",
    "completed",
    "failed",
  ]),
  triggerEvent: WorldEventReceiptSchema.nullable(),
  dispatchPlan: z.object({
    dispatchPlanId: V2IdentifierSchema,
    decisions: z.array(DispatchAgentDecisionSchema).min(1).max(14),
    selectedCount: z.number().int().nonnegative().max(14),
    skippedCount: z.number().int().nonnegative().max(14),
  }).strict().nullable(),
  contributions: z.array(BusinessContributionSchema).max(14),
  studentDecision: StudentDecisionReceiptSchema.nullable(),
  teacherGate: TeacherGateReceiptSchema.nullable(),
  resolutionProposalId: V2IdentifierSchema.nullable(),
  consequence: ConsequenceReceiptSchema.nullable(),
  failureCode: z.enum([
    "no_applicable_agent",
    "agent_execution_failed",
    "version_hash_drift",
    "resolution_failed",
    "teacher_rejected",
  ]).nullable(),
};

type BusinessEpisode = z.infer<z.ZodObject<typeof BusinessEpisodeShape>>;

function validateBusinessEpisode(
  episode: BusinessEpisode,
  context: z.RefinementCtx,
): void {
  if (episode.status === "waiting") {
    if (episode.triggerEvent !== null
      || episode.dispatchPlan !== null
      || episode.contributions.length > 0
      || episode.studentDecision !== null
      || episode.teacherGate !== null
      || episode.resolutionProposalId !== null
      || episode.consequence !== null
      || episode.failureCode !== null) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "业务等待态不得伪造事件、运行链或后果",
      });
    }
    return;
  }
  if (episode.triggerEvent === null || episode.dispatchPlan === null) {
    context.addIssue({
      code: "custom",
      path: ["dispatchPlan"],
      message: "非等待 Episode 必须保留触发事件与派发计划",
    });
    return;
  }
  const decisions = episode.dispatchPlan.decisions;
  const selected = decisions.filter((decision) => decision.decision === "selected");
  const skipped = decisions.filter((decision) => decision.decision === "skipped");
  if (episode.dispatchPlan.selectedCount !== selected.length
    || episode.dispatchPlan.skippedCount !== skipped.length) {
    context.addIssue({
      code: "custom",
      path: ["dispatchPlan"],
      message: "派发计划计数必须与逐项选择决策一致",
    });
  }
  const decisionAgentIds = decisions.map((decision) => decision.agentId);
  if (new Set(decisionAgentIds).size !== decisionAgentIds.length) {
    context.addIssue({
      code: "custom",
      path: ["dispatchPlan", "decisions"],
      message: "同一智能体只能出现一次派发决策",
    });
  }
  const selectedAgentIds = new Set(selected.map((decision) => decision.agentId));
  const contributionIds = episode.contributions.map(
    (contribution) => contribution.contributionId,
  );
  if (new Set(contributionIds).size !== contributionIds.length) {
    context.addIssue({
      code: "custom",
      path: ["contributions"],
      message: "智能体贡献 ID 必须唯一",
    });
  }
  episode.contributions.forEach((contribution, index) => {
    if (!selectedAgentIds.has(contribution.agentId)) {
      context.addIssue({
        code: "custom",
        path: ["contributions", index, "agentId"],
        message: "只有派发计划选中的智能体才能产生贡献",
      });
    }
  });
  if (episode.status === "awaiting_gate") {
    if (episode.teacherGate?.status !== "pending"
      || episode.consequence !== null
      || episode.failureCode !== null) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "等待教师门时必须零写回且不伪装为失败",
      });
    }
  }
  if (episode.status === "in_progress"
    && (episode.consequence !== null || episode.failureCode !== null)) {
    context.addIssue({
      code: "custom",
      path: ["status"],
      message: "进行中 Episode 不得提前携带后果或失败代码",
    });
  }
  if (episode.status === "completed") {
    if (episode.resolutionProposalId === null
      || episode.consequence === null
      || episode.consequence.status !== "committed"
      || episode.failureCode !== null) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "完成 Episode 必须具有解析提案和已提交世界后果",
      });
    }
  }
  if (episode.status === "failed") {
    if (episode.failureCode === null || episode.consequence !== null) {
      context.addIssue({
        code: "custom",
        path: ["failureCode"],
        message: "失败 Episode 必须显式失败且不得产生后果写回",
      });
    }
  } else if (episode.failureCode !== null) {
    context.addIssue({
      code: "custom",
      path: ["failureCode"],
      message: "非失败 Episode 不得附带失败代码",
    });
  }
}

export const TeacherAgentCollaborationEpisodeV3Schema = z.object({
  ...BusinessEpisodeShape,
  audience: z.literal("teacher"),
}).strict().superRefine(validateBusinessEpisode);
export type TeacherAgentCollaborationEpisodeV3 = z.infer<
  typeof TeacherAgentCollaborationEpisodeV3Schema
>;

export const AdminAgentCollaborationEpisodeV3Schema = z.object({
  ...BusinessEpisodeShape,
  audience: z.literal("admin"),
  execution: z.object({
    executionMode: z.enum(["live", "deterministic_demo", "degraded"]),
    providerId: V2IdentifierSchema.nullable(),
    modelId: V2IdentifierSchema.nullable(),
    traceRefs: z.array(V2IdentifierSchema).max(64),
    promptTemplateRefs: z.array(V2IdentifierSchema).max(32),
    failedAgentIds: z.array(V2IdentifierSchema).max(14),
    totalLatencyMs: z.number().int().nonnegative(),
    estimatedCostMicrounits: z.number().int().nonnegative(),
    recoveryActions: z.array(NonEmptyTextSchema.max(500)).max(16),
  }).strict(),
}).strict().superRefine((episode, context) => {
  validateBusinessEpisode(episode, context);
  if (episode.execution.executionMode === "live"
    && (episode.execution.providerId === null
      || episode.execution.modelId === null)) {
    context.addIssue({
      code: "custom",
      path: ["execution", "providerId"],
      message: "Live 执行必须明确记录供应方与模型",
    });
  }
  if (episode.execution.executionMode === "deterministic_demo"
    && (episode.execution.providerId !== null
      || episode.execution.modelId !== null)) {
    context.addIssue({
      code: "custom",
      path: ["execution", "providerId"],
      message: "确定性演示不得伪装成外部模型 Live 调用",
    });
  }
});
export type AdminAgentCollaborationEpisodeV3 = z.infer<
  typeof AdminAgentCollaborationEpisodeV3Schema
>;

export const AgentCollaborationEpisodeV3Schema = z.discriminatedUnion(
  "audience",
  [
    StudentAgentCollaborationEpisodeV3Schema,
    TeacherAgentCollaborationEpisodeV3Schema,
    AdminAgentCollaborationEpisodeV3Schema,
  ],
);
export type AgentCollaborationEpisodeV3 = z.infer<
  typeof AgentCollaborationEpisodeV3Schema
>;
