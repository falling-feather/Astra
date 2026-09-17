import { describe, expect, it } from "vitest";
import {
  CollaborationStrategyContentSchema,
  CollaborationStrategyDraftInputSchema,
  CollaborationStrategyGovernanceInputSchema,
  CollaborationStrategySchema,
  CollaborationStrategySchemaVersion,
  FlagshipCollaborationEventId,
  FlagshipCollaborationRouteId,
  FlagshipCollaborationScenarioReleaseId,
  FlagshipCollaborationTaskAnchorId,
  flagshipCollaborationStudentDecisionRef,
  parseFlagshipCollaborationStudentDecisionRef,
} from "../src/collaboration-strategy.js";

const content = {
  eventConditions: {
    scenarioReleaseId: FlagshipCollaborationScenarioReleaseId,
    routeId: FlagshipCollaborationRouteId,
    triggerEventId: FlagshipCollaborationEventId,
    taskAnchorId: FlagshipCollaborationTaskAnchorId,
    requiredEventRefs: ["event-rain-triggered"],
  },
  agentSet: [
    "agent-evidence-coach",
    "agent-material-understanding",
  ],
  permissions: [
    {
      agentId: "agent-evidence-coach",
      visibleScopes: ["assigned_team", "role_private"],
      capabilities: ["read-assigned-evidence", "suggest-verification"],
      privateDataPolicy: "subject_only",
      authoritativeWorldWrite: false,
    },
    {
      agentId: "agent-material-understanding",
      visibleScopes: ["assigned_team"],
      capabilities: ["read-assigned-material", "summarize-material"],
      privateDataPolicy: "none",
      authoritativeWorldWrite: false,
    },
  ],
  basisRefs: [
    {
      refType: "world_event",
      refId: "event-rain-triggered",
      version: "state-41",
    },
    {
      refType: "student_action",
      refId: "action-rain-collaboration",
      version: null,
    },
  ],
  recommendationSummary: "暴雨触发后先核对材料，再由学生决定协作路径。",
  studentChoice: {
    decision: "accepted",
    selectedAgentIds: ["agent-evidence-coach"],
    reason: "先补足来源证据再改写交付顺序。",
    actionRef: "action-rain-collaboration",
    decidedAt: "2026-07-30T16:20:00.000Z",
  },
  consequenceRefs: ["consequence-rain-priority-updated"],
  evidenceRefs: ["evidence-rain-source-check"],
} as const;

describe("CollaborationStrategy contracts", () => {
  it("accepts only the frozen flagship strategy shape", () => {
    const parsed = CollaborationStrategyContentSchema.parse(content);
    expect(parsed.eventConditions).toEqual({
      scenarioReleaseId: FlagshipCollaborationScenarioReleaseId,
      routeId: FlagshipCollaborationRouteId,
      triggerEventId: FlagshipCollaborationEventId,
      taskAnchorId: FlagshipCollaborationTaskAnchorId,
      requiredEventRefs: ["event-rain-triggered"],
    });
    expect(parsed.agentSet).toHaveLength(2);
  });

  it("round-trips only scoped student decision semantic refs", () => {
    const accepted = flagshipCollaborationStudentDecisionRef(
      "agent-evidence-coach",
      "accepted",
    );
    expect(parseFlagshipCollaborationStudentDecisionRef(accepted)).toEqual({
      agentId: "agent-evidence-coach",
      decision: "accepted",
    });
    expect(parseFlagshipCollaborationStudentDecisionRef(
      "action-rain-collaboration",
    )).toBeNull();
    expect(parseFlagshipCollaborationStudentDecisionRef(
      "flagship-rain-collaboration:student-decision:agent-unknown:accepted",
    )).toBeNull();
  });

  it("rejects another scenario, a generic condition DSL, and authoritative writes", () => {
    expect(() => CollaborationStrategyContentSchema.parse({
      ...content,
      eventConditions: {
        ...content.eventConditions,
        scenarioReleaseId: "scenario-other@1.0.0",
      },
    })).toThrow();
    expect(() => CollaborationStrategyContentSchema.parse({
      ...content,
      eventConditions: {
        ...content.eventConditions,
        operator: "matches",
      },
    })).toThrow();
    expect(() => CollaborationStrategyContentSchema.parse({
      ...content,
      permissions: [
        {
          ...content.permissions[0],
          authoritativeWorldWrite: true,
        },
        content.permissions[1],
      ],
    })).toThrow();
  });

  it("requires exact agent-to-permission alignment and a coherent student choice", () => {
    expect(() => CollaborationStrategyContentSchema.parse({
      ...content,
      permissions: [content.permissions[0]],
    })).toThrow("权限约束必须与策略智能体集合一一对应");
    expect(() => CollaborationStrategyContentSchema.parse({
      ...content,
      studentChoice: {
        ...content.studentChoice,
        selectedAgentIds: ["agent-evaluation-review"],
      },
    })).toThrow();
    expect(() => CollaborationStrategyContentSchema.parse({
      ...content,
      studentChoice: {
        ...content.studentChoice,
        decision: "rejected",
      },
    })).toThrow("拒绝策略时不得保留已选择智能体");
  });

  it("keeps the evaluation-review agent teacher-governed and not student-selectable", () => {
    expect(() => CollaborationStrategyContentSchema.parse({
      ...content,
      agentSet: [
        ...content.agentSet,
        "agent-evaluation-review",
      ],
      permissions: [
        ...content.permissions,
        {
          agentId: "agent-evaluation-review",
          visibleScopes: ["teacher_only"],
          capabilities: ["review-contribution"],
          privateDataPolicy: "teacher_only",
          authoritativeWorldWrite: false,
        },
      ],
      studentChoice: {
        ...content.studentChoice,
        selectedAgentIds: ["agent-evaluation-review"],
      },
    })).toThrow();
  });

  it("keeps actor identity out of client draft and governance payloads", () => {
    expect(CollaborationStrategyDraftInputSchema.parse({
      strategyId: "strategy-rain-collaboration",
      version: 1,
      content,
    }).version).toBe(1);
    expect(() => CollaborationStrategyDraftInputSchema.parse({
      strategyId: "strategy-rain-collaboration",
      version: 1,
      content,
      createdBy: "forged-teacher",
    })).toThrow();
    expect(() => CollaborationStrategyGovernanceInputSchema.parse({
      expectedStatus: "draft",
      expectedGovernanceRevision: 0,
      expectedContentHash: "a".repeat(64),
      action: "approve",
      reason: "教师确认该策略可复用。",
      teacherActorId: "forged-teacher",
    })).toThrow();
  });

  it("requires governance status, revision and teacher review to agree", () => {
    const draft = {
      kind: "CollaborationStrategy",
      schemaVersion: CollaborationStrategySchemaVersion,
      strategyId: "strategy-rain-collaboration",
      version: 1,
      contentHash: "a".repeat(64),
      content,
      governance: {
        status: "draft",
        revision: 0,
        latestReview: null,
      },
      createdBy: "teacher-main",
      createdAt: "2026-07-30T16:30:00.000Z",
    } as const;
    expect(CollaborationStrategySchema.parse(draft).governance.status).toBe("draft");
    expect(() => CollaborationStrategySchema.parse({
      ...draft,
      governance: {
        status: "approved",
        revision: 1,
        latestReview: {
          action: "disable",
          teacherActorId: "teacher-main",
          reason: "错误动作。",
          reviewedAt: "2026-07-30T16:31:00.000Z",
        },
      },
    })).toThrow("教师治理动作与当前策略状态不一致");
    expect(() => CollaborationStrategySchema.parse({
      ...draft,
      governance: {
        status: "deleted",
        revision: 1,
        latestReview: null,
      },
    })).toThrow();
  });
});
