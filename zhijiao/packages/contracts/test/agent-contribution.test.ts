import { describe, expect, it } from "vitest";
import {
  AgentContributionDecisionCommandPayloadSchema,
  AgentContributionDecisionEventPayloadSchema,
  AgentContributionDecisionSchema,
  AgentContributionProfiles,
  CommandNameSchema,
  EventTypeSchema,
} from "../src/index.js";

const decision = {
  templateRef: {
    templateId: "assistant/evidence-coach",
    templateVersion: "1.0.0",
  },
  instanceRef: {
    instanceId: "instance:assistant/evidence-coach",
    instanceVersion: "assistant-evidence-coach/1.0.0",
  },
  rolePerspective: "目标学生岗位的证据核验视角",
  basisRefs: [
    { kind: "evidence" as const, refId: "evidence-rain-warning" },
    { kind: "event" as const, refId: "flagship-event-rain-escalation" },
  ],
  permissionSummary:
    "只读目标学生本人可见证据与授权事实；不得确认事实、提交成果或推进节点。",
  decision: "accepted" as const,
  studentReason: "先核对第二来源再继续。",
  idempotencyKey: `agent-contribution:${"a".repeat(64)}`,
};

describe("agent contribution public contracts", () => {
  it("freezes exactly three active contribution profiles", () => {
    expect(AgentContributionProfiles.map((profile) => profile.templateId))
      .toEqual([
        "assistant/evidence-coach",
        "assistant/material-understanding",
        "assistant/evaluation-review",
      ]);
    expect(
      AgentContributionProfiles.filter((profile) => profile.studentDecision),
    ).toHaveLength(2);
  });

  it("accepts a student decision event and rejects frozen-field drift", () => {
    expect(AgentContributionDecisionEventPayloadSchema.parse({
      proposalId: "proposal-rain-evidence",
      decision,
    })).toEqual({
      proposalId: "proposal-rain-evidence",
      decision,
    });
    expect(AgentContributionDecisionSchema.safeParse({
      ...decision,
      permissionSummary: "允许写入世界事实",
    }).success).toBe(false);
    expect(AgentContributionDecisionSchema.safeParse({
      ...decision,
      templateRef: {
        templateId: "assistant/evaluation-review",
        templateVersion: "1.0.0",
      },
      instanceRef: {
        instanceId: "instance:assistant/evaluation-review",
        instanceVersion: "assistant-evaluation-review/1.0.0",
      },
      rolePerspective: "教师终评前的逐维复核视角",
      permissionSummary:
        "只读当前教师可管理的固定案件、证据包、意见与仲裁，不写最终成绩。",
    }).success).toBe(false);
  });

  it("keeps the client command narrow and registers command/event names", () => {
    expect(AgentContributionDecisionCommandPayloadSchema.parse({
      proposalId: "proposal-rain-evidence",
      decision: "rejected",
      studentReason: "当前依据不足。",
      idempotencyKey: decision.idempotencyKey,
    })).toEqual({
      proposalId: "proposal-rain-evidence",
      decision: "rejected",
      studentReason: "当前依据不足。",
      idempotencyKey: decision.idempotencyKey,
    });
    expect(CommandNameSchema.parse("record_agent_contribution_decision"))
      .toBe("record_agent_contribution_decision");
    expect(EventTypeSchema.parse("agent_contribution_decided"))
      .toBe("agent_contribution_decided");
  });
});
