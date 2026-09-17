import { describe, expect, it } from "vitest";
import {
  AgentAssistanceProposalSchema,
  AgentAssistanceSchemaVersion,
  SchemaVersion,
} from "../src/index.js";

const proposal = {
  kind: "AgentAssistanceProposal",
  assistanceSchemaVersion: AgentAssistanceSchemaVersion,
  sessionId: "session-assistance-schema",
  sceneId: "scenario-local-tourism-media-v0.1",
  actorId: "agent-evidence-coach",
  messageId: "message-assistance-001",
  correlationId: "correlation-evidence-001",
  timestamp: "2026-07-29T04:10:00.000Z",
  schemaVersion: SchemaVersion,
  proposalId: "assistance-proposal-001",
  agentRunId: "agent-run-assistance-001",
  roleId: "student_assistant",
  templateRef: {
    templateId: "assistant/evidence-coach",
    templateVersion: "1.0.0",
  },
  instanceRef: {
    instanceId: "agent-instance:evidence-coach-student-editor",
    instanceVersion: "assistant-evidence-coach/1.0.0",
  },
  outputSchemaRef: "agent-assistance/evidence-coaching/1.0.0",
  output: {
    kind: "evidence_coaching",
    summary: "现有判断仍需补充来源交叉核验。",
    questions: ["这项判断来自哪一条可回指的材料？"],
    evidenceGaps: ["缺少第二个独立来源。"],
    verificationPath: ["对照授权资料中的原始时间与主体。"],
  },
  subjectActorId: "student-editor",
  resourceRef: null,
  expectedStateVersion: 19,
  causationEventIds: ["event-evidence-recorded"],
  evidenceRefs: ["evidence-student-001"],
  citationRefs: ["course-source-verification"],
  authority: "advisory_only",
  requiresHumanAction: true,
  visibility: ["assigned_team", "role_private", "audit_only"],
  visibleToActorIds: ["student-editor"],
  idempotencyKey: "session-assistance-schema:event-evidence-recorded:evidence-coach",
  expiresAt: null,
} as const;

describe("AgentAssistanceProposalSchema", () => {
  it("accepts a scoped, advisory-only coaching proposal", () => {
    const parsed = AgentAssistanceProposalSchema.parse(proposal);

    expect(parsed.authority).toBe("advisory_only");
    expect(parsed.requiresHumanAction).toBe(true);
    expect(parsed.output.kind).toBe("evidence_coaching");
    expect(parsed.visibility).not.toContain("public_world");
  });

  it("rejects public-world, authoritative or answer-bearing assistance", () => {
    expect(() => AgentAssistanceProposalSchema.parse({
      ...proposal,
      visibility: ["public_world", "audit_only"],
    })).toThrow();
    expect(() => AgentAssistanceProposalSchema.parse({
      ...proposal,
      authority: "authoritative",
    })).toThrow();
    expect(() => AgentAssistanceProposalSchema.parse({
      ...proposal,
      requiresHumanAction: false,
    })).toThrow();
    expect(() => AgentAssistanceProposalSchema.parse({
      ...proposal,
      finalAnswer: "绕过学生行动的标准答案",
    })).toThrow();
    expect(() => AgentAssistanceProposalSchema.parse({
      ...proposal,
      output: {
        ...proposal.output,
        worldEvent: {
          eventType: "scene_completed",
        },
      },
    })).toThrow();
  });

  it("requires the addressed student to be explicitly visible", () => {
    expect(() => AgentAssistanceProposalSchema.parse({
      ...proposal,
      visibleToActorIds: [],
    })).toThrow();
  });

  it("requires evaluation review to pin an arbitration resource", () => {
    const evaluationProposal = {
      ...proposal,
      roleId: "teacher_assistant",
      templateRef: {
        templateId: "assistant/evaluation-review",
        templateVersion: "1.0.0",
      },
      instanceRef: {
        instanceId: "agent-instance:evaluation-review-teacher",
        instanceVersion: "assistant-evaluation-review/1.0.0",
      },
      outputSchemaRef: "agent-assistance/evaluation-review/1.0.0",
      output: {
        kind: "evaluation_review",
        summary: "教师仍需复核逐维分歧。",
        evaluationCaseId: "evaluation-case-001",
        arbitrationId: "evaluation-arbitration-001",
        dimensionDifferences: [],
        evidenceGaps: ["核对证据引用范围。"],
        reviewOrder: ["先复核分歧最大的维度。"],
      },
      subjectActorId: "teacher-main",
      resourceRef: null,
      visibility: ["teacher_only", "audit_only"],
      visibleToActorIds: ["teacher-main"],
    } as const;

    expect(() => AgentAssistanceProposalSchema.parse(evaluationProposal))
      .toThrow();
    expect(AgentAssistanceProposalSchema.parse({
      ...evaluationProposal,
      resourceRef: {
        objectType: "evaluation_arbitration",
        objectId: "evaluation-arbitration-001",
        version: "decision-hash-001",
      },
    }).resourceRef).toMatchObject({
      objectType: "evaluation_arbitration",
      objectId: "evaluation-arbitration-001",
    });
  });
});
