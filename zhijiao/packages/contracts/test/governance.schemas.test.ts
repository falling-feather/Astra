import { describe, expect, it } from "vitest";
import {
  GovernancePlanSchema,
  GovernanceReviewSchema,
  ReviewGovernancePayloadSchema,
} from "../src/index.js";

const capabilityByMediaType = {
  text: "xingchen_agent",
  audio: "asr",
  image: "image_understanding",
  document: "ocr",
  video: "video_moderation",
} as const;

const governanceNode = {
  nodeId: "governance-fact-consistency",
  nodeType: "rule_tool_model",
  definitionVersion: "governance-specialist/1.0.1",
  promptVersion: "governance-fact/1.0.1",
  rulesetId: "source-consistency/2026.1",
  knowledgeChunkIds: ["course-source-verification"],
} as const;

describe("governance contracts", () => {
  it("requires unique specialist domains and a hard teacher gate", () => {
    const valid = {
      planId: "governance-v1",
      label: "四域治理",
      description: "固定输入上的并行专业发现",
      teacherApprovalRequired: true,
      maxAttemptsPerBranch: 3,
      timeoutMsPerBranch: 20_000,
      branches: [
        {
          domain: "fact",
          label: "事实",
          priority: 200,
          node: governanceNode,
          capabilityByMediaType,
        },
        {
          domain: "copyright",
          label: "版权",
          priority: 300,
          node: {
            ...governanceNode,
            nodeId: "governance-copyright-scope",
            promptVersion: "governance-copyright/1.0.1",
            rulesetId: "copyright-scope/2026.1",
          },
          capabilityByMediaType,
        },
      ],
    };
    expect(GovernancePlanSchema.parse(valid).branches).toHaveLength(2);
    expect(() => GovernancePlanSchema.parse({
      ...valid,
      branches: [valid.branches[0], valid.branches[0]],
    })).toThrow("治理分支领域重复");
    expect(() => GovernancePlanSchema.parse({
      ...valid,
      teacherApprovalRequired: false,
    })).toThrow();
  });

  it("accepts only an exact arbitration revision and decision hash from the client", () => {
    const valid = {
      reviewId: "review-1",
      expectedArbitrationRevision: 2,
      expectedDecisionHash: "a".repeat(64),
      decision: "approve",
      reviewNote: "已对账四域 Finding 和确定性优先级。",
      requestId: "request-1",
    };
    expect(ReviewGovernancePayloadSchema.parse(valid)).toEqual(valid);
    expect(() => ReviewGovernancePayloadSchema.parse({
      ...valid,
      actorId: "forged-teacher",
    })).toThrow();
    expect(() => ReviewGovernancePayloadSchema.parse({
      ...valid,
      expectedDecisionHash: "stale",
    })).toThrow();
  });

  it("never represents a blocked or degraded verdict as approved for release", () => {
    const review = {
      reviewId: "review-1",
      sessionId: "session-1",
      sessionEpoch: "epoch-1",
      materialId: "material-1",
      materialVersion: "1.0.0",
      inputContentHash: "a".repeat(64),
      mediaTaskId: "task-1",
      requestId: "request-1",
      requestedBy: "student-editor",
      requestedAt: "2026-07-25T10:00:00.000Z",
      status: "approved",
      arbitrationRevision: 1,
      policyVersion: "governance-priority/1.0.0",
      verdict: "revise",
      conflict: true,
      branchDomains: ["fact", "copyright"],
      latestFindingIds: ["finding-1", "finding-2"],
      winningFindingId: "finding-2",
      findingSetHash: "b".repeat(64),
      decisionHash: "c".repeat(64),
      arbitratedAt: "2026-07-25T10:01:00.000Z",
      reviewDecision: "approve",
      reviewedBy: "teacher-main",
      reviewedAt: "2026-07-25T10:02:00.000Z",
      reviewNote: "已确认修订要求并批准该固定材料版本进入后续流程。",
      audience: {
        policyVersion: "acl/1.0.0",
        courseId: "course-media",
        sessionId: "session-1",
        sessionEpoch: "epoch-1",
        scopes: ["assigned_team"],
        teamIds: ["team-media"],
        roleIds: ["responsible_editor"],
        actorIds: ["student-editor", "teacher-main"],
        privateNamespaces: [],
        auditReadable: true,
      },
    } as const;
    expect(GovernanceReviewSchema.parse(review).status).toBe("approved");
    expect(() => GovernanceReviewSchema.parse({
      ...review,
      verdict: "block",
    })).toThrow("阻断或降级治理结论不能批准放行");
    expect(() => GovernanceReviewSchema.parse({
      ...review,
      verdict: "degraded",
    })).toThrow("阻断或降级治理结论不能批准放行");
  });
});
