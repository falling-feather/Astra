import {
  AgentAssistanceProposalSchema,
  SchemaVersion,
  type AgentAssistanceOutput,
  type AgentAssistanceProposal,
} from "@ronggang/contracts";
import { describe, expect, it } from "vitest";
import {
  AgentContributionDecisionConflictError,
  AgentContributionDecisionEventPayloadSchema,
  AgentContributionDecisionEventType,
  AgentContributionDecisionSchema,
  AgentContributionCardSchema,
  AgentContributionPolicyError,
  FlagshipContributionTaskAnchorId,
  activeAgentContributionTemplateIds,
  buildAgentContributionCard,
  createAgentContributionDecision,
  createAgentContributionDecisionEventPayload,
  recordAgentContributionDecision,
  selectKeyAgentContributionCards,
  type AgentContributionCard,
  type CurrentTaskAnchorView,
} from "../src/index.js";

const studentActorId = "student-editor";
const teacherActorId = "teacher-main";

const activeFixtures = {
  "assistant/evidence-coach": {
    actorId: "agent-evidence-coach",
    roleId: "student_assistant",
    outputSchemaRef: "agent-assistance/evidence-coaching/1.0.0",
    instanceVersion: "assistant-evidence-coach/1.0.0",
    resourceRef: null,
    visibility: ["role_private", "audit_only"],
    subjectActorId: studentActorId,
    output: {
      kind: "evidence_coaching",
      summary: "请先区分现场观察与已核事实，再补充独立来源。",
      questions: ["这项判断依据哪个材料版本？"],
      evidenceGaps: ["缺少第二个独立来源"],
      verificationPath: ["核对原始材料", "记录不能确认的边界"],
    },
  },
  "assistant/material-understanding": {
    actorId: "agent-material-understanding",
    roleId: "content_assistant",
    outputSchemaRef: "agent-assistance/material-understanding/1.0.0",
    instanceVersion: "assistant-material-understanding/1.0.0",
    resourceRef: {
      objectType: "media_processing_task",
      objectId: "media-task-001",
      version: "result-1",
    },
    visibility: ["assigned_team", "audit_only"],
    subjectActorId: studentActorId,
    output: {
      kind: "material_understanding",
      summary: "材料处理结果已整理为观察，声明仍需核验。",
      materialRef: {
        objectType: "material",
        objectId: "material-rain-photo",
        version: "1",
      },
      observations: [{
        label: "现场天气",
        value: "画面出现强降雨",
        sourceRefs: ["media-task-001"],
      }],
      entities: ["非遗市集"],
      claims: [{
        statement: "市集已经关闭",
        verificationStatus: "unverified",
        sourceRefs: ["media-task-001"],
      }],
      timeRefs: [],
    },
  },
  "assistant/evaluation-review": {
    actorId: "agent-evaluation-review",
    roleId: "teacher_assistant",
    outputSchemaRef: "agent-assistance/evaluation-review/1.0.0",
    instanceVersion: "assistant-evaluation-review/1.0.0",
    resourceRef: {
      objectType: "evaluation_arbitration",
      objectId: "arbitration-001",
      version: "1",
    },
    visibility: ["teacher_only", "audit_only"],
    subjectActorId: teacherActorId,
    output: {
      kind: "evaluation_review",
      summary: "证据充分性维度分歧最大，建议教师先核对引用。",
      evaluationCaseId: "evaluation-case-001",
      arbitrationId: "arbitration-001",
      dimensionDifferences: [{
        dimensionId: "evidence-quality",
        proposalScores: [70, 92],
        spread: 22,
      }],
      evidenceGaps: ["高风险结论缺少第二来源"],
      reviewOrder: ["证据充分性", "职业协作"],
    },
  },
} as const;

type ActiveTemplateId = keyof typeof activeFixtures;

function assistanceProposal(
  templateId: ActiveTemplateId,
  input: {
    proposalId?: string;
    timestamp?: string;
    summary?: string;
  } = {},
): AgentAssistanceProposal {
  const fixture = activeFixtures[templateId];
  const output = input.summary
    ? { ...fixture.output, summary: input.summary }
    : fixture.output;
  return AgentAssistanceProposalSchema.parse({
    kind: "AgentAssistanceProposal",
    assistanceSchemaVersion: "agent-assistance/1.0.0",
    sessionId: "session-contribution",
    sceneId: "scenario-local-tourism-media-v0.1",
    actorId: fixture.actorId,
    messageId: `message-${input.proposalId ?? templateId}`,
    correlationId: "correlation-rain-escalation",
    timestamp: input.timestamp ?? "2026-07-31T00:30:00.000Z",
    schemaVersion: SchemaVersion,
    proposalId: input.proposalId ?? `proposal:${templateId}`,
    agentRunId: `run:${input.proposalId ?? templateId}`,
    roleId: fixture.roleId,
    templateRef: {
      templateId,
      templateVersion: "1.0.0",
    },
    instanceRef: {
      instanceId: `instance:${templateId}`,
      instanceVersion: fixture.instanceVersion,
    },
    outputSchemaRef: fixture.outputSchemaRef,
    output: output as unknown as AgentAssistanceOutput,
    subjectActorId: fixture.subjectActorId,
    resourceRef: fixture.resourceRef,
    expectedStateVersion: 24,
    causationEventIds: ["flagship-event-rain-escalation"],
    evidenceRefs: ["evidence-rain-warning"],
    citationRefs: ["citation-weather-alert"],
    authority: "advisory_only",
    requiresHumanAction: true,
    visibility: fixture.visibility,
    visibleToActorIds: [fixture.subjectActorId],
    idempotencyKey: `task:${templateId}:assistance`,
    expiresAt: null,
  });
}

function currentTaskAnchor(
  phase: CurrentTaskAnchorView["phase"] = "in_progress",
): CurrentTaskAnchorView {
  return {
    taskId: FlagshipContributionTaskAnchorId,
    phase,
    stateVersion: 30,
    sourceEventId: "flagship-event-rain-escalation",
    priority: "urgent",
    worldTarget: {
      mode: "world_interaction",
      sceneId: "scene-rain-escalation",
      taskId: FlagshipContributionTaskAnchorId,
    },
    latestFeedbackReason: "暴雨事件已改写任务优先级",
  };
}

function decide(
  card: AgentContributionCard,
  input: {
    decision?: "accepted" | "rejected";
    reason?: string;
    actorId?: string;
  } = {},
) {
  return createAgentContributionDecision({
    card,
    studentActorId: input.actorId ?? studentActorId,
    decision: input.decision ?? "accepted",
    studentReason: input.reason ?? "先按建议补充独立气象来源。",
  });
}

describe("AI-007 agent contribution cards", () => {
  it("fixes the contribution surface to exactly three active templates", () => {
    expect([...activeAgentContributionTemplateIds].sort()).toEqual([
      "assistant/evaluation-review",
      "assistant/evidence-coach",
      "assistant/material-understanding",
    ]);
    for (const templateId of activeAgentContributionTemplateIds) {
      const card = buildAgentContributionCard(
        assistanceProposal(templateId as ActiveTemplateId),
      );
      expect(card).toMatchObject({
        templateRef: { templateId },
        authority: "advisory_only",
        requiresHumanAction: true,
        deliveryStatus: "ready",
      });
      expect(card.basisRefs.map((ref) => ref.kind)).toEqual(
        expect.arrayContaining(["evidence", "citation", "event"]),
      );
      expect(card.rolePerspective.length).toBeGreaterThan(0);
      expect(card.permissionSummary.length).toBeGreaterThan(0);
      expect(card.suggestionSummary.length).toBeGreaterThan(0);
    }
  });

  it("uses the frozen task anchor and suppresses inactive or repeated cards", () => {
    const older = assistanceProposal("assistant/evidence-coach", {
      proposalId: "proposal-evidence-old",
      timestamp: "2026-07-31T00:20:00.000Z",
    });
    const newer = assistanceProposal("assistant/evidence-coach", {
      proposalId: "proposal-evidence-new",
      timestamp: "2026-07-31T00:30:00.000Z",
    });
    const material = assistanceProposal("assistant/material-understanding");
    const evaluation = assistanceProposal("assistant/evaluation-review");
    const cards = selectKeyAgentContributionCards({
      proposals: [older, newer, material, evaluation],
      viewerActorId: studentActorId,
      currentTaskAnchor: currentTaskAnchor(),
    });

    expect(cards).toHaveLength(2);
    expect(cards.map((card) => card.proposalId)).toEqual(
      expect.arrayContaining(["proposal-evidence-new", "proposal:assistant/material-understanding"]),
    );
    expect(cards.map((card) => card.proposalId)).not.toContain(
      "proposal-evidence-old",
    );
    expect(cards.every((card) => card.decisionMode === "student_choice"))
      .toBe(true);
    expect(selectKeyAgentContributionCards({
      proposals: [newer, material],
      viewerActorId: studentActorId,
      currentTaskAnchor: currentTaskAnchor("not_triggered"),
    })).toEqual([]);
  });

  it("marks the existing safe fallback as degraded without changing authority", () => {
    const card = buildAgentContributionCard(assistanceProposal(
      "assistant/evidence-coach",
      {
        summary: "模型或输出守卫不可用；请人工核对当前证据缺口。",
      },
    ));
    expect(card.deliveryStatus).toBe("degraded");
    expect(card.authority).toBe("advisory_only");
    expect(card.decisionMode).toBe("student_choice");
  });

  it("does not expose teacher evaluation review as a student decision", () => {
    const card = buildAgentContributionCard(
      assistanceProposal("assistant/evaluation-review"),
    );
    expect(card.decisionMode).toBe("teacher_review_only");
    expect(card.studentDecisionActorId).toBeNull();
    expect(() => decide(card)).toThrow(AgentContributionPolicyError);
  });

  it("rejects cards that drift from the frozen template contribution mode", () => {
    const card = buildAgentContributionCard(
      assistanceProposal("assistant/evidence-coach"),
    );
    expect(AgentContributionCardSchema.safeParse({
      ...card,
      decisionMode: "teacher_review_only",
      studentDecisionActorId: null,
      decisionIdempotencyKey: null,
    }).success).toBe(false);
  });
});

describe("AI-007 student contribution decisions", () => {
  it.each(["accepted", "rejected"] as const)(
    "records %s as a non-authoritative, non-blocking domain event",
    (decision) => {
      const card = buildAgentContributionCard(
        assistanceProposal("assistant/evidence-coach"),
      );
      const event = decide(card, {
        decision,
        reason: decision === "accepted"
          ? "先补第二来源再提交判断。"
          : "当前已有两条独立来源，暂不采用。",
      });
      expect(AgentContributionDecisionEventType).toBe(
        "agent_contribution_decided",
      );
      expect(event).toEqual({
        templateRef: card.templateRef,
        instanceRef: card.instanceRef,
        rolePerspective: card.rolePerspective,
        basisRefs: card.basisRefs,
        permissionSummary: card.permissionSummary,
        decision,
        studentReason: decision === "accepted"
          ? "先补第二来源再提交判断。"
          : "当前已有两条独立来源，暂不采用。",
        idempotencyKey: card.decisionIdempotencyKey,
      });
      expect(createAgentContributionDecisionEventPayload({
        card,
        studentActorId,
        decision,
        studentReason: event.studentReason,
      })).toEqual({
        proposalId: card.proposalId,
        decision: event,
      });
    },
  );

  it("rejects foreign actors and blank reasons", () => {
    const card = buildAgentContributionCard(
      assistanceProposal("assistant/material-understanding"),
    );
    expect(() => decide(card, { actorId: "student-reporter" }))
      .toThrow(AgentContributionPolicyError);
    expect(() => decide(card, { reason: "   " })).toThrow();
  });

  it("keeps the shared event payload to proposalId plus the frozen decision", () => {
    const card = buildAgentContributionCard(
      assistanceProposal("assistant/material-understanding"),
    );
    const payload = createAgentContributionDecisionEventPayload({
      card,
      studentActorId,
      decision: "accepted",
      studentReason: "按建议核对材料来源。",
    });
    expect(AgentContributionDecisionEventPayloadSchema.parse(payload))
      .toEqual(payload);
    expect(AgentContributionDecisionEventPayloadSchema.safeParse({
      ...payload,
      actorId: studentActorId,
    }).success).toBe(false);
  });

  it("replays the same idempotent choice and rejects payload collisions", () => {
    const card = buildAgentContributionCard(
      assistanceProposal("assistant/evidence-coach"),
    );
    const first = recordAgentContributionDecision([], {
      card,
      studentActorId,
      decision: "accepted",
      studentReason: "先补第二来源再提交判断。",
    });
    const replay = recordAgentContributionDecision(first.decisions, {
      card,
      studentActorId,
      decision: "accepted",
      studentReason: "先补第二来源再提交判断。",
    });
    expect(first.status).toBe("recorded");
    expect(replay.status).toBe("replayed");
    expect(replay.decisions).toHaveLength(1);
    expect(replay.decision).toEqual(first.decision);
    expect(() => recordAgentContributionDecision(first.decisions, {
      card,
      studentActorId,
      decision: "rejected",
      studentReason: "改为拒绝。",
    })).toThrow(AgentContributionDecisionConflictError);
  });

  it("fails closed if a caller tries to upgrade authority or block flow", () => {
    const card = buildAgentContributionCard(
      assistanceProposal("assistant/evidence-coach"),
    );
    const event = decide(card);
    expect(AgentContributionDecisionSchema.safeParse({
      ...event,
      authorityEffect: "world_fact",
    }).success).toBe(false);
    expect(AgentContributionDecisionSchema.safeParse({
      ...event,
      flowEffect: "block",
    }).success).toBe(false);
    expect(AgentContributionDecisionSchema.safeParse({
      ...event,
      permissionSummary: "允许写入世界事实",
    }).success).toBe(false);
  });
});
