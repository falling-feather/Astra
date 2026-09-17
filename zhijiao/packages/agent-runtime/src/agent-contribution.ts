import {
  AgentAssistanceProposalSchema,
  AgentContributionBasisRefSchema as SharedAgentContributionBasisRefSchema,
  AgentContributionDecisionEventPayloadSchema as SharedAgentContributionDecisionEventPayloadSchema,
  AgentContributionDecisionSchema as SharedAgentContributionDecisionSchema,
  AgentContributionProfilesByTemplateId,
  AgentInstanceRefSchema,
  AgentTemplateRefSchema,
  VisibilityScopeSchema,
  type AgentAssistanceProposal,
  type AgentContributionBasisRef as SharedAgentContributionBasisRef,
  type AgentContributionDecision as SharedAgentContributionDecision,
  type AgentContributionDecisionEventPayload as SharedAgentContributionDecisionEventPayload,
  type CurrentTaskAnchor,
} from "@ronggang/contracts";
import { hashValue } from "@ronggang/context-engine";
import { z } from "zod";
import {
  assistanceProfilesByTemplateId,
  type AssistanceContributionView,
  type AssistanceTemplateProfile,
} from "./definitions/assistants.js";

export const AgentContributionCardSchemaVersion =
  "agent-contribution-card/1.0.0" as const;
export const AgentContributionDecisionEventType =
  "agent_contribution_decided" as const;
export const FlagshipContributionTaskAnchorId =
  "flagship-task-rain-collaboration" as const;

export const activeAgentContributionTemplateIds = Object.freeze([
  "assistant/evidence-coach",
  "assistant/material-understanding",
  "assistant/evaluation-review",
] as const);

const activeAgentContributionTemplateIdSet: ReadonlySet<string> = new Set(
  activeAgentContributionTemplateIds,
);

type FrozenContributionProfile = AssistanceTemplateProfile & {
  contributionView: AssistanceContributionView;
};

function frozenContributionProfile(
  templateId: string,
): FrozenContributionProfile | null {
  const profile = assistanceProfilesByTemplateId.get(templateId);
  if (
    !profile
    || !profile.active
    || !profile.contributionView
    || !activeAgentContributionTemplateIdSet.has(profile.templateId)
  ) {
    return null;
  }
  const sharedProfile = AgentContributionProfilesByTemplateId.get(
    profile.templateId,
  );
  if (
    !sharedProfile
    || sharedProfile.templateVersion !== profile.templateVersion
    || sharedProfile.instanceVersion !== profile.definitionVersion
    || sharedProfile.criticalNode !== profile.contributionView.criticalNode
    || sharedProfile.rolePerspective !== profile.contributionView.rolePerspective
    || sharedProfile.permissionSummary !== profile.permissionBoundary
    || sharedProfile.studentDecision !== profile.contributionView.studentDecision
  ) {
    return null;
  }
  return profile as FrozenContributionProfile;
}

export const AgentContributionBasisRefSchema =
  SharedAgentContributionBasisRefSchema;
export type AgentContributionBasisRef = SharedAgentContributionBasisRef;

export const AgentContributionCardSchema = z.object({
  schemaVersion: z.literal(AgentContributionCardSchemaVersion),
  cardId: z.string().min(1).max(320),
  proposalId: z.string().min(1).max(320),
  agentRunId: z.string().min(1).max(320),
  sessionId: z.string().min(1).max(240),
  sceneId: z.string().min(1).max(240),
  createdAt: z.string().datetime(),
  templateRef: AgentTemplateRefSchema,
  instanceRef: AgentInstanceRefSchema,
  criticalNode: z.enum([
    "student_evidence_recorded",
    "material_processing_completed",
    "teacher_evaluation_arbitrated",
  ]),
  rolePerspective: z.string().min(1).max(500),
  basisRefs: z.array(AgentContributionBasisRefSchema).min(1).max(128),
  permissionSummary: z.string().min(1).max(1_200),
  suggestionSummary: z.string().min(1).max(1_500),
  authority: z.literal("advisory_only"),
  requiresHumanAction: z.literal(true),
  deliveryStatus: z.enum(["ready", "degraded"]),
  decisionMode: z.enum(["student_choice", "teacher_review_only"]),
  studentDecisionActorId: z.string().min(1).max(240).nullable(),
  decisionIdempotencyKey: z.string().min(1).max(320).nullable(),
  expectedStateVersion: z.number().int().nonnegative(),
  causationEventIds: z.array(z.string().min(1).max(320)).min(1).max(32),
  visibility: z.array(VisibilityScopeSchema).min(1),
  visibleToActorIds: z.array(z.string().min(1).max(240)).max(64),
}).strict().superRefine((card, context) => {
  const profile = frozenContributionProfile(card.templateRef.templateId);
  if (!profile) {
    context.addIssue({
      code: "custom",
      path: ["templateRef", "templateId"],
      message: "关键贡献卡只能来自三个 active 辅助模板",
    });
    return;
  }
  const expectedDecisionMode = profile.contributionView.studentDecision
    ? "student_choice"
    : "teacher_review_only";
  const frozenFields = [
    {
      path: ["templateRef", "templateVersion"],
      actual: card.templateRef.templateVersion,
      expected: profile.templateVersion,
    },
    {
      path: ["instanceRef", "instanceVersion"],
      actual: card.instanceRef.instanceVersion,
      expected: profile.definitionVersion,
    },
    {
      path: ["criticalNode"],
      actual: card.criticalNode,
      expected: profile.contributionView.criticalNode,
    },
    {
      path: ["rolePerspective"],
      actual: card.rolePerspective,
      expected: profile.contributionView.rolePerspective,
    },
    {
      path: ["permissionSummary"],
      actual: card.permissionSummary,
      expected: profile.permissionBoundary,
    },
    {
      path: ["decisionMode"],
      actual: card.decisionMode,
      expected: expectedDecisionMode,
    },
  ] as const;
  for (const field of frozenFields) {
    if (field.actual !== field.expected) {
      context.addIssue({
        code: "custom",
        path: [...field.path],
        message: "贡献卡字段必须匹配冻结的 active 模板配置",
      });
    }
  }
  if (
    card.decisionMode === "student_choice"
    && (
      card.studentDecisionActorId === null
      || card.decisionIdempotencyKey === null
      || !card.visibleToActorIds.includes(card.studentDecisionActorId)
    )
  ) {
    context.addIssue({
      code: "custom",
      path: ["studentDecisionActorId"],
      message: "学生决策卡必须固定到有权查看的目标学生与幂等键",
    });
  }
  if (
    card.decisionMode === "teacher_review_only"
    && (
      card.studentDecisionActorId !== null
      || card.decisionIdempotencyKey !== null
    )
  ) {
    context.addIssue({
      code: "custom",
      path: ["decisionMode"],
      message: "教师复核卡不得暴露学生采纳或拒绝入口",
    });
  }
});
export type AgentContributionCard = z.infer<
  typeof AgentContributionCardSchema
>;

// Actor, time, visibility and causation stay in the shared domain-event envelope.
export const AgentContributionDecisionSchema =
  SharedAgentContributionDecisionSchema;
export type AgentContributionDecision = SharedAgentContributionDecision;

export const AgentContributionDecisionEventPayloadSchema =
  SharedAgentContributionDecisionEventPayloadSchema;
export type AgentContributionDecisionEventPayload =
  SharedAgentContributionDecisionEventPayload;

export type CurrentTaskAnchorView = CurrentTaskAnchor;

export class AgentContributionPolicyError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AgentContributionPolicyError";
    this.code = code;
  }
}

export class AgentContributionDecisionConflictError extends Error {
  readonly code = "agent_contribution_decision_conflict";

  constructor(message: string) {
    super(message);
    this.name = "AgentContributionDecisionConflictError";
  }
}

function profileForContribution(
  proposal: AgentAssistanceProposal,
): FrozenContributionProfile {
  const profile = frozenContributionProfile(
    proposal.templateRef.templateId,
  );
  if (!profile) {
    throw new AgentContributionPolicyError(
      "contribution_template_not_active",
      "关键贡献卡只能由三个 active 辅助模板生成",
    );
  }
  if (
    proposal.actorId !== profile.agentId
    || proposal.roleId !== profile.roleId
    || proposal.templateRef.templateVersion !== profile.templateVersion
    || proposal.instanceRef.instanceVersion !== profile.definitionVersion
    || proposal.outputSchemaRef !== profile.outputSchemaRef
    || proposal.output.kind !== profile.kind
  ) {
    throw new AgentContributionPolicyError(
      "contribution_template_identity_mismatch",
      "关键贡献与辅助模板身份、版本或输出类型不一致",
    );
  }
  return profile;
}

function contributionBasisRefs(
  proposal: AgentAssistanceProposal,
): AgentContributionBasisRef[] {
  const refs = [
    ...proposal.evidenceRefs.map((refId) => ({
      kind: "evidence" as const,
      refId,
    })),
    ...proposal.citationRefs.map((refId) => ({
      kind: "citation" as const,
      refId,
    })),
    ...proposal.causationEventIds.map((refId) => ({
      kind: "event" as const,
      refId,
    })),
  ];
  return [...new Map(
    refs.map((ref) => [`${ref.kind}:${ref.refId}`, ref]),
  ).values()];
}

function decisionKey(proposalId: string, studentActorId: string): string {
  return `agent-contribution:${hashValue({ proposalId, studentActorId })}`;
}

function isFallbackProposal(proposal: AgentAssistanceProposal): boolean {
  return proposal.output.summary.startsWith("模型或输出守卫不可用；");
}

export function buildAgentContributionCard(
  rawProposal: AgentAssistanceProposal,
  options: { degraded?: boolean } = {},
): AgentContributionCard {
  const proposal = AgentAssistanceProposalSchema.parse(rawProposal);
  const profile = profileForContribution(proposal);
  const studentDecisionActorId = profile.contributionView.studentDecision
    ? proposal.subjectActorId
    : null;
  if (
    profile.contributionView.studentDecision
    && studentDecisionActorId === null
  ) {
    throw new AgentContributionPolicyError(
      "contribution_student_subject_missing",
      "学生贡献卡必须固定目标学生，不能退化为团队公共决策",
    );
  }
  return AgentContributionCardSchema.parse({
    schemaVersion: AgentContributionCardSchemaVersion,
    cardId: `agent-contribution:${hashValue({
      proposalId: proposal.proposalId,
      templateRef: proposal.templateRef,
      instanceRef: proposal.instanceRef,
    })}`,
    proposalId: proposal.proposalId,
    agentRunId: proposal.agentRunId,
    sessionId: proposal.sessionId,
    sceneId: proposal.sceneId,
    createdAt: proposal.timestamp,
    templateRef: proposal.templateRef,
    instanceRef: proposal.instanceRef,
    criticalNode: profile.contributionView.criticalNode,
    rolePerspective: profile.contributionView.rolePerspective,
    basisRefs: contributionBasisRefs(proposal),
    permissionSummary: profile.permissionBoundary,
    suggestionSummary: proposal.output.summary,
    authority: proposal.authority,
    requiresHumanAction: proposal.requiresHumanAction,
    deliveryStatus: options.degraded || isFallbackProposal(proposal)
      ? "degraded"
      : "ready",
    decisionMode: profile.contributionView.studentDecision
      ? "student_choice"
      : "teacher_review_only",
    studentDecisionActorId,
    decisionIdempotencyKey: studentDecisionActorId
      ? decisionKey(proposal.proposalId, studentDecisionActorId)
      : null,
    expectedStateVersion: proposal.expectedStateVersion,
    causationEventIds: proposal.causationEventIds,
    visibility: proposal.visibility,
    visibleToActorIds: proposal.visibleToActorIds,
  });
}

function isContributionAnchorActive(anchor: CurrentTaskAnchorView): boolean {
  if (
    anchor.taskId !== FlagshipContributionTaskAnchorId
    || anchor.phase === "no_task"
    || anchor.phase === "not_triggered"
  ) {
    return false;
  }
  return (
    anchor.worldTarget === null
    || (
      anchor.worldTarget.mode === "world_interaction"
      && anchor.worldTarget.taskId === FlagshipContributionTaskAnchorId
    )
  );
}

export function selectKeyAgentContributionCards(input: {
  proposals: readonly AgentAssistanceProposal[];
  viewerActorId: string;
  currentTaskAnchor: CurrentTaskAnchorView;
}): AgentContributionCard[] {
  if (!isContributionAnchorActive(input.currentTaskAnchor)) return [];
  const latestByTemplate = new Map<string, AgentContributionCard>();
  for (const proposal of input.proposals) {
    if (!activeAgentContributionTemplateIdSet.has(
      proposal.templateRef.templateId,
    )) {
      continue;
    }
    const card = buildAgentContributionCard(proposal);
    if (
      !card.visibleToActorIds.includes(input.viewerActorId)
      || card.expectedStateVersion > input.currentTaskAnchor.stateVersion
    ) {
      continue;
    }
    const current = latestByTemplate.get(card.templateRef.templateId);
    if (!current || current.createdAt < card.createdAt) {
      latestByTemplate.set(card.templateRef.templateId, card);
    }
  }
  return [...latestByTemplate.values()]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 3);
}

export interface CreateAgentContributionDecisionInput {
  card: AgentContributionCard;
  studentActorId: string;
  decision: "accepted" | "rejected";
  studentReason: string;
}

export function createAgentContributionDecision(
  input: CreateAgentContributionDecisionInput,
): AgentContributionDecision {
  const card = AgentContributionCardSchema.parse(input.card);
  if (
    card.decisionMode !== "student_choice"
    || card.studentDecisionActorId !== input.studentActorId
    || !card.visibleToActorIds.includes(input.studentActorId)
    || card.decisionIdempotencyKey === null
  ) {
    throw new AgentContributionPolicyError(
      "contribution_decision_denied",
      "当前行动者无权对该贡献执行学生采纳或拒绝",
    );
  }
  return AgentContributionDecisionSchema.parse({
    templateRef: card.templateRef,
    instanceRef: card.instanceRef,
    rolePerspective: card.rolePerspective,
    basisRefs: card.basisRefs,
    permissionSummary: card.permissionSummary,
    decision: input.decision,
    studentReason: input.studentReason,
    idempotencyKey: card.decisionIdempotencyKey,
  });
}

export function createAgentContributionDecisionEventPayload(
  input: CreateAgentContributionDecisionInput,
): AgentContributionDecisionEventPayload {
  const card = AgentContributionCardSchema.parse(input.card);
  return AgentContributionDecisionEventPayloadSchema.parse({
    proposalId: card.proposalId,
    decision: createAgentContributionDecision({
      ...input,
      card,
    }),
  });
}

function decisionIntentHash(decision: AgentContributionDecision): string {
  return hashValue(decision);
}

export function recordAgentContributionDecision(
  existing: readonly AgentContributionDecision[],
  input: CreateAgentContributionDecisionInput,
): {
  status: "recorded" | "replayed";
  decision: AgentContributionDecision;
  decisions: AgentContributionDecision[];
} {
  const parsedExisting = existing.map((decision) => (
    AgentContributionDecisionSchema.parse(decision)
  ));
  const candidate = createAgentContributionDecision(input);
  const replay = parsedExisting.find((decision) => (
    decision.idempotencyKey === candidate.idempotencyKey
  ));
  if (replay) {
    if (decisionIntentHash(replay) !== decisionIntentHash(candidate)) {
      throw new AgentContributionDecisionConflictError(
        "同一贡献决策幂等键不能改写采纳/拒绝或学生原因",
      );
    }
    return {
      status: "replayed",
      decision: replay,
      decisions: parsedExisting,
    };
  }
  return {
    status: "recorded",
    decision: candidate,
    decisions: [...parsedExisting, candidate],
  };
}
