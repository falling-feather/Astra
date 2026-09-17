import { z } from "zod";
import { DecisionRationaleSourceSchema } from "./decision-provenance.js";
import {
  V2ContentHashSchema,
  V2IdentifierSchema,
} from "./course-learning.js";
import { FlagshipContentReferenceV4Schema } from "./flagship-world-v4.js";

export const GroundedAgentCollaborationEpisodeV4SchemaVersion =
  "grounded-agent-collaboration-episode/4.0.0" as const;

const TimestampSchema = z.string().datetime();
const NonEmptyTextSchema = z.string().trim().min(1);

export const GroundedKnowledgeCitationStanceV4Schema = z.enum([
  "supports",
  "refutes",
  "context",
]);

export const GroundedKnowledgeCitationV4Schema = z.object({
  knowledgeRef: V2IdentifierSchema,
  sourceTitle: NonEmptyTextSchema.max(240),
  sourceUrl: z.string().url().startsWith("https://").nullable(),
  sourceRef: V2IdentifierSchema.optional(),
  sourceKind: z.enum(["external_url", "app_document", "upload"]).optional(),
  locator: NonEmptyTextSchema.max(500),
  sourceContentHash: V2ContentHashSchema,
  reviewStatus: z.enum(["pending_expert_review", "verified"]),
  supportsClaimRefs: z.array(V2IdentifierSchema).min(1).max(12),
  // Legacy collaboration records only had supportsClaimRefs. Preserve that
  // affirmative historical meaning explicitly when reading those records.
  stance: GroundedKnowledgeCitationStanceV4Schema.default("supports"),
  snippet: NonEmptyTextSchema.max(2_000).optional(),
  sourceDocumentRef: V2IdentifierSchema.optional(),
  fragmentRef: V2IdentifierSchema.optional(),
  sourceRevision: V2IdentifierSchema.optional(),
  fragmentHash: V2ContentHashSchema.optional(),
  expiresAt: TimestampSchema.nullable().optional(),
  revokedAt: TimestampSchema.nullable().optional(),
}).strict();
export type GroundedKnowledgeCitationV4 = z.infer<
  typeof GroundedKnowledgeCitationV4Schema
>;

export const CollaborationMoveKindV4Schema = z.enum([
  "proposal",
  "challenge",
  "evidence_request",
  "revision",
  "joint_proposal",
]);
export type CollaborationMoveKindV4 = z.infer<
  typeof CollaborationMoveKindV4Schema
>;

export const GroundedDispatchDecisionV4Schema = z.object({
  agentTemplateRef: V2IdentifierSchema,
  professionalRoleId: V2IdentifierSchema,
  decision: z.enum(["selected", "skipped"]),
  reasonCode: z.enum([
    "affected_object_match",
    "claim_domain_match",
    "not_affected",
    "insufficient_permission",
    "duplicate_capability",
    "budget_limit",
    "disabled",
    "unavailable",
  ]),
  businessReason: NonEmptyTextSchema.max(500),
}).strict().superRefine((decision, context) => {
  const selectedReasons = new Set([
    "affected_object_match",
    "claim_domain_match",
  ]);
  if ((decision.decision === "selected") !== selectedReasons.has(decision.reasonCode)) {
    context.addIssue({
      code: "custom",
      path: ["reasonCode"],
      message: "智能体选中或跳过状态必须与业务理由一致",
    });
  }
});

const GroundedBusinessMoveShape = {
  moveId: V2IdentifierSchema,
  moveKind: CollaborationMoveKindV4Schema,
  agentTemplateRef: V2IdentifierSchema,
  professionalRoleId: V2IdentifierSchema,
  safeSummary: NonEmptyTextSchema.max(900),
  rationale: NonEmptyTextSchema.max(1_200),
  groundedClaimRefs: z.array(V2IdentifierSchema).min(1).max(16),
  knowledgeCitations: z.array(GroundedKnowledgeCitationV4Schema).min(1).max(16),
  evidenceRefs: z.array(V2IdentifierSchema).min(1).max(32),
  predecessorMoveRefs: z.array(V2IdentifierSchema).max(16),
  outputHash: V2ContentHashSchema,
};

export const TeacherGroundedBusinessMoveV4Schema = z.object({
  ...GroundedBusinessMoveShape,
}).strict().superRefine((move, context) => {
  const claimRefs = new Set(move.groundedClaimRefs);
  if (move.knowledgeCitations.some((citation) => (
    citation.supportsClaimRefs.some((reference) => !claimRefs.has(reference))
  ))) {
    context.addIssue({
      code: "custom",
      path: ["knowledgeCitations"],
      message: "知识引用只能支持本次协作动作已经声明的 claim",
    });
  }
});
export type TeacherGroundedBusinessMoveV4 = z.infer<
  typeof TeacherGroundedBusinessMoveV4Schema
>;

export const AdminGroundedBusinessMoveV4Schema = z.object({
  ...GroundedBusinessMoveShape,
  execution: z.object({
    agentTaskRef: V2IdentifierSchema,
    agentRunRef: V2IdentifierSchema,
    observationRef: V2IdentifierSchema,
    intentRef: V2IdentifierSchema,
    executionMode: z.enum(["deterministic_demo", "live"]),
    providerId: NonEmptyTextSchema.max(120).nullable(),
    modelId: NonEmptyTextSchema.max(120).nullable(),
    promptTemplateRef: V2IdentifierSchema,
    traceRef: V2IdentifierSchema,
    latencyMs: z.number().int().nonnegative().max(600_000),
    estimatedCostMicros: z.number().int().nonnegative(),
  }).strict(),
}).strict().superRefine((move, context) => {
  const claimRefs = new Set(move.groundedClaimRefs);
  if (move.knowledgeCitations.some((citation) => (
    citation.supportsClaimRefs.some((reference) => !claimRefs.has(reference))
  ))) {
    context.addIssue({
      code: "custom",
      path: ["knowledgeCitations"],
      message: "知识引用只能支持本次协作动作已经声明的 claim",
    });
  }
  const live = move.execution.executionMode === "live";
  if (live !== (move.execution.providerId !== null && move.execution.modelId !== null)) {
    context.addIssue({
      code: "custom",
      path: ["execution", "providerId"],
      message: "Live 必须保留供应方/模型，确定性演示不得伪造供应方/模型",
    });
  }
});
export type AdminGroundedBusinessMoveV4 = z.infer<
  typeof AdminGroundedBusinessMoveV4Schema
>;

const JointProposalSchema = z.object({
  jointProposalId: V2IdentifierSchema,
  sourceMoveRefs: z.array(V2IdentifierSchema).min(2).max(16),
  publicSummary: NonEmptyTextSchema.max(1_000),
  recommendedActionRefs: z.array(V2IdentifierSchema).min(1).max(8),
  groundedClaimRefs: z.array(V2IdentifierSchema).min(1).max(16),
  evidenceRefs: z.array(V2IdentifierSchema).min(1).max(32),
  riskLevel: z.enum(["low", "medium", "high"]),
  requiresTeacherGate: z.boolean(),
  authority: z.literal("proposal_only"),
  contentHash: V2ContentHashSchema,
}).strict().superRefine((proposal, context) => {
  if (new Set(proposal.sourceMoveRefs).size !== proposal.sourceMoveRefs.length) {
    context.addIssue({
      code: "custom",
      path: ["sourceMoveRefs"],
      message: "联合提案必须引用五个互不重复的协作动作",
    });
  }
});

const CollaborationFailureSchema = z.object({
  reasonCode: z.enum([
    "no_applicable_agent",
    "knowledge_not_grounded",
    "move_sequence_incomplete",
    "agent_execution_failed",
    "version_hash_drift",
  ]),
  safeMessage: NonEmptyTextSchema.max(500),
  failedMoveRef: V2IdentifierSchema.nullable(),
}).strict();

const EpisodeSharedShape = {
  schemaVersion: z.literal(GroundedAgentCollaborationEpisodeV4SchemaVersion),
  episodeId: V2IdentifierSchema,
  sessionId: V2IdentifierSchema,
  flagshipContentRef: FlagshipContentReferenceV4Schema,
  sourceWorldStateVersion: z.number().int().nonnegative(),
  triggerEventRef: V2IdentifierSchema,
  affectedObjectRefs: z.array(V2IdentifierSchema).min(1).max(24),
  generatedAt: TimestampSchema,
};

function validateBusinessEpisode(
  episode: {
    status: "in_progress" | "joint_proposal_ready" | "failed";
    dispatchDecisions: Array<z.infer<typeof GroundedDispatchDecisionV4Schema>>;
    moves: Array<{
      moveId: string;
      moveKind: CollaborationMoveKindV4;
      agentTemplateRef: string;
      professionalRoleId: string;
      predecessorMoveRefs: string[];
    }>;
    jointProposal: z.infer<typeof JointProposalSchema> | null;
    failure: z.infer<typeof CollaborationFailureSchema> | null;
    writeDisposition: "proposal_only" | "zero_write";
  },
  context: z.RefinementCtx,
): void {
  const agentRefs = episode.dispatchDecisions.map((decision) => decision.agentTemplateRef);
  if (new Set(agentRefs).size !== agentRefs.length) {
    context.addIssue({
      code: "custom",
      path: ["dispatchDecisions"],
      message: "六组十四智能体的调度决定必须逐模板唯一",
    });
  }
  const selected = new Map(
    episode.dispatchDecisions
      .filter((decision) => decision.decision === "selected")
      .map((decision) => [decision.agentTemplateRef, decision.professionalRoleId]),
  );
  const moveIds = episode.moves.map((move) => move.moveId);
  if (new Set(moveIds).size !== moveIds.length) {
    context.addIssue({
      code: "custom",
      path: ["moves"],
      message: "协作动作 ID 必须唯一",
    });
  }
  const seen = new Set<string>();
  let expectedNext: CollaborationMoveKindV4[] = ["proposal"];
  for (const [index, move] of episode.moves.entries()) {
    const professionalRoleId = selected.get(move.agentTemplateRef);
    if (professionalRoleId === undefined) {
      context.addIssue({
        code: "custom",
        path: ["moves", index, "agentTemplateRef"],
        message: "协作动作只能由本轮实际选中的智能体产生",
      });
    } else if (professionalRoleId !== move.professionalRoleId) {
      context.addIssue({
        code: "custom",
        path: ["moves", index, "professionalRoleId"],
        message: "协作动作的专业角色必须与调度决定一致",
      });
    }
    if (!expectedNext.includes(move.moveKind)) {
      context.addIssue({
        code: "custom",
        path: ["moves", index, "moveKind"],
        message: "协作动作顺序不符合 proposal、challenge、evidence_request、revision、joint_proposal 的动态链",
      });
    }
    if (move.predecessorMoveRefs.some((reference) => !seen.has(reference))) {
      context.addIssue({
        code: "custom",
        path: ["moves", index, "predecessorMoveRefs"],
        message: "协作动作只能引用本轮此前已经发生的动作",
      });
    }
    seen.add(move.moveId);
    expectedNext = move.moveKind === "proposal"
      ? ["challenge", "evidence_request"]
      : move.moveKind === "challenge"
        ? ["evidence_request", "joint_proposal"]
        : move.moveKind === "evidence_request"
          ? ["challenge", "revision", "joint_proposal"]
          : move.moveKind === "revision"
            ? ["joint_proposal"]
            : ["joint_proposal", "proposal"];
  }
  if (episode.status === "joint_proposal_ready") {
    if (episode.moves.length < 3
      || episode.moves.at(0)?.moveKind !== "proposal"
      || episode.moves.at(-1)?.moveKind !== "joint_proposal") {
      context.addIssue({
        code: "custom",
        path: ["moves"],
        message: "联合提案必须经过 proposal、challenge、evidence_request、revision、joint_proposal",
      });
    }
    if (episode.jointProposal === null
      || episode.failure !== null
      || episode.writeDisposition !== "proposal_only") {
      context.addIssue({
        code: "custom",
        path: ["jointProposal"],
        message: "就绪 Episode 必须形成唯一 proposal-only 联合提案且不得伪造失败",
      });
    } else if (new Set(episode.jointProposal.sourceMoveRefs).size !== moveIds.length
      || moveIds.some((moveId) => !episode.jointProposal!.sourceMoveRefs.includes(moveId))) {
      context.addIssue({
        code: "custom",
        path: ["jointProposal", "sourceMoveRefs"],
        message: "联合提案必须引用本轮完整五步协作链",
      });
    }
  } else if (episode.status === "failed") {
    if (episode.failure === null
      || episode.jointProposal !== null
      || episode.writeDisposition !== "zero_write") {
      context.addIssue({
        code: "custom",
        path: ["failure"],
        message: "失败协作必须显式失败并保持零权威写回",
      });
    }
  } else if (episode.jointProposal !== null || episode.failure !== null) {
    context.addIssue({
      code: "custom",
      path: ["status"],
      message: "进行中 Episode 不得提前生成联合提案或失败结论",
    });
  }
}

export const TeacherGroundedCollaborationEpisodeV4Schema = z.object({
  ...EpisodeSharedShape,
  audience: z.literal("teacher"),
  status: z.enum(["in_progress", "joint_proposal_ready", "failed"]),
  dispatchDecisions: z.array(GroundedDispatchDecisionV4Schema).length(14),
  moves: z.array(TeacherGroundedBusinessMoveV4Schema).max(16),
  jointProposal: JointProposalSchema.nullable(),
  failure: CollaborationFailureSchema.nullable(),
  writeDisposition: z.enum(["proposal_only", "zero_write"]),
}).strict().superRefine(validateBusinessEpisode);
export type TeacherGroundedCollaborationEpisodeV4 = z.infer<
  typeof TeacherGroundedCollaborationEpisodeV4Schema
>;

export const AdminGroundedCollaborationEpisodeV4Schema = z.object({
  ...EpisodeSharedShape,
  audience: z.literal("admin"),
  status: z.enum(["in_progress", "joint_proposal_ready", "failed"]),
  dispatchDecisions: z.array(GroundedDispatchDecisionV4Schema).length(14),
  moves: z.array(AdminGroundedBusinessMoveV4Schema).max(16),
  jointProposal: JointProposalSchema.nullable(),
  failure: CollaborationFailureSchema.nullable(),
  writeDisposition: z.enum(["proposal_only", "zero_write"]),
  executionSummary: z.object({
    executionMode: z.enum(["deterministic_demo", "live", "mixed"]),
    selectedCount: z.number().int().nonnegative().max(14),
    skippedCount: z.number().int().nonnegative().max(14),
    totalLatencyMs: z.number().int().nonnegative().max(3_000_000),
    totalEstimatedCostMicros: z.number().int().nonnegative(),
  }).strict(),
}).strict().superRefine((episode, context) => {
  validateBusinessEpisode(episode, context);
  const selected = episode.dispatchDecisions.filter(
    (decision) => decision.decision === "selected",
  ).length;
  if (episode.executionSummary.selectedCount !== selected
    || episode.executionSummary.skippedCount !== 14 - selected) {
    context.addIssue({
      code: "custom",
      path: ["executionSummary"],
      message: "管理员执行汇总必须与十四个调度决定一致",
    });
  }
});
export type AdminGroundedCollaborationEpisodeV4 = z.infer<
  typeof AdminGroundedCollaborationEpisodeV4Schema
>;

const StudentSuggestionSchema = z.object({
  suggestionId: V2IdentifierSchema,
  sourceJointProposalRef: V2IdentifierSchema,
  professionalRole: NonEmptyTextSchema.max(160),
  summary: NonEmptyTextSchema.max(900),
  rationale: NonEmptyTextSchema.max(900),
  knowledgeCitations: z.array(GroundedKnowledgeCitationV4Schema).min(1).max(6),
  recommendedActionRefs: z.array(V2IdentifierSchema).min(1).max(4),
  riskLevel: z.enum(["low", "medium", "high"]),
  allowedDecisions: z.tuple([
    z.literal("accept"),
    z.literal("request_evidence"),
    z.literal("reject"),
  ]),
}).strict();

const StudentSuggestionDecisionSchema = z.object({
  decisionRef: V2IdentifierSchema,
  decision: z.enum(["accept", "request_evidence", "reject"]),
  rationale: NonEmptyTextSchema.max(800),
  rationaleSource: DecisionRationaleSourceSchema.optional(),
  decidedAt: TimestampSchema,
}).strict();

export const StudentGroundedEvidenceStateV4Schema = z.object({
  status: z.enum(["ready", "needs_evidence", "unavailable"]),
  gaps: z.array(NonEmptyTextSchema.max(500)).max(16),
  conflicts: z.array(NonEmptyTextSchema.max(500)).max(16),
  expired: z.array(NonEmptyTextSchema.max(500)).max(16),
  revoked: z.array(NonEmptyTextSchema.max(500)).max(16),
  reason: NonEmptyTextSchema.max(500).nullable(),
  authorizationExpiresAt: TimestampSchema.nullable(),
}).strict();
export type StudentGroundedEvidenceStateV4 = z.infer<typeof StudentGroundedEvidenceStateV4Schema>;

export const StudentGroundedCollaborationEpisodeV4Schema = z.object({
  ...EpisodeSharedShape,
  audience: z.literal("student"),
  status: z.enum(["waiting", "suggestion_ready", "decided", "completed", "failed"]),
  suggestion: StudentSuggestionSchema.nullable(),
  studentDecision: StudentSuggestionDecisionSchema.nullable(),
  worldConsequenceRef: V2IdentifierSchema.nullable(),
  evidenceState: StudentGroundedEvidenceStateV4Schema.optional(),
  failure: z.object({
    reasonCode: z.enum([
      "no_applicable_agent",
      "knowledge_not_grounded",
      "agent_execution_failed",
      "version_hash_drift",
    ]),
    safeMessage: NonEmptyTextSchema.max(500),
  }).strict().nullable(),
}).strict().superRefine((episode, context) => {
  if (episode.status === "waiting") {
    if (episode.suggestion !== null
      || episode.studentDecision !== null
      || episode.worldConsequenceRef !== null
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
    if (episode.failure === null
      || episode.suggestion !== null
      || episode.worldConsequenceRef !== null) {
      context.addIssue({
        code: "custom",
        path: ["failure"],
        message: "学生失败态必须显式失败且保持零世界写回",
      });
    }
    return;
  }
  if (episode.suggestion === null || episode.failure !== null) {
    context.addIssue({
      code: "custom",
      path: ["suggestion"],
      message: "非等待/失败态必须且只能显示一条知识接地建议",
    });
  }
  if (["decided", "completed"].includes(episode.status)
    && episode.studentDecision === null) {
    context.addIssue({
      code: "custom",
      path: ["studentDecision"],
      message: "已决定或完成态必须保留学生真实选择",
    });
  }
  if ((episode.status === "completed") !== (episode.worldConsequenceRef !== null)) {
    context.addIssue({
      code: "custom",
      path: ["worldConsequenceRef"],
      message: "只有完成态可以引用已经提交的世界后果",
    });
  }
});
export type StudentGroundedCollaborationEpisodeV4 = z.infer<
  typeof StudentGroundedCollaborationEpisodeV4Schema
>;

export const GroundedCollaborationEpisodeV4Schema = z.discriminatedUnion(
  "audience",
  [
    StudentGroundedCollaborationEpisodeV4Schema,
    TeacherGroundedCollaborationEpisodeV4Schema,
    AdminGroundedCollaborationEpisodeV4Schema,
  ],
);
export type GroundedCollaborationEpisodeV4 = z.infer<
  typeof GroundedCollaborationEpisodeV4Schema
>;
