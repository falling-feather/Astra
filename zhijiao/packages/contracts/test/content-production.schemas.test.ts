import { describe, expect, it } from "vitest";
import {
  CreateProductionArtifactPayloadSchema,
  MediaProcessingOutputSchema,
  MediaProcessingTaskSchema,
  RequestMediaProcessingPayloadSchema,
  SaveArtifactRevisionPayloadSchema,
  SupplyMediaProcessingResultPayloadSchema,
} from "../src/index.js";

const revisionFields = {
  title: "水乡非遗市集主稿",
  summary: "区分经审核事实、原始材料与机器观察。",
  sections: [
    { sectionId: "lead", content: "水乡非遗市集连接游客与传统技艺。" },
  ],
  citations: [
    { sourceKind: "fact", sourceId: "fact-visitors-v2", locator: null },
  ],
  revisionNote: "建立可追溯首版。",
};

describe("content production contracts", () => {
  it("rejects client attempts to choose actor, provider, capability, state, or sourceRef", () => {
    const injections = [
      { actorId: "system" },
      { teamId: "other-team" },
      { provider: "forged" },
      { capability: "ocr" },
      { status: "succeeded" },
      { sourceRef: "https://internal.example/secret" },
    ];
    for (const injection of injections) {
      expect(RequestMediaProcessingPayloadSchema.safeParse({
        materialId: "material-1",
        planId: "document-source-extraction",
        requestId: "request-1",
        ...injection,
      }).success).toBe(false);
    }
  });

  it("keeps artifact mutation payloads strict and pins an expected revision", () => {
    expect(CreateProductionArtifactPayloadSchema.parse({
      templateId: "article-main",
      requestId: "create-r1",
      ...revisionFields,
    })).toMatchObject({ templateId: "article-main" });
    expect(SaveArtifactRevisionPayloadSchema.parse({
      artifactId: "artifact-1",
      expectedRevisionNumber: 1,
      requestId: "save-r2",
      ...revisionFields,
    })).toMatchObject({ expectedRevisionNumber: 1 });
    expect(SaveArtifactRevisionPayloadSchema.safeParse({
      artifactId: "artifact-1",
      expectedRevisionNumber: 1,
      requestId: "save-r2",
      ...revisionFields,
      audience: { scopes: ["public_world"] },
    }).success).toBe(false);
    expect(CreateProductionArtifactPayloadSchema.safeParse({
      templateId: "article-main",
      requestId: "create-r1",
      ...revisionFields,
      sections: [{
        sectionId: "lead",
        content: "正文",
        actorId: "system",
      }],
    }).success).toBe(false);
  });

  it("models execution, provider, and verification as independent axes", () => {
    const output = MediaProcessingOutputSchema.parse({
      outputId: "output-1",
      capability: "ocr",
      provider: "iflytek",
      providerMode: "manual",
      summary: "人工查阅补录，仍待教师复核。",
      extracted: { note: "人工来源" },
      sourceRef: "object://session/hash",
      confidence: 0.6,
      trust: "manual_unverified",
      verificationStatus: "pending_review",
      providerRequestId: null,
      createdAt: "2026-07-25T06:00:00.000Z",
    });
    const task = MediaProcessingTaskSchema.parse({
      taskId: "task-1",
      sessionId: "session-1",
      sessionEpoch: "epoch-1",
      materialId: "material-1",
      materialVersion: "v1",
      inputRef: "object://session/hash",
      inputContentHash: "a".repeat(64),
      planId: "document-source-extraction",
      requestId: "request-1",
      status: "succeeded",
      steps: [{
        stepId: "step-1",
        capability: "ocr",
        status: "manually_completed",
        attempts: 1,
        maxAttempts: 3,
        idempotencyKey: "task-1:step-1",
        output,
        lastErrorCode: "provider_execution_failed",
        startedAt: "2026-07-25T05:59:00.000Z",
        completedAt: "2026-07-25T06:00:00.000Z",
      }],
      requestedBy: "student-editor",
      requestedAt: "2026-07-25T05:58:00.000Z",
      idempotencyKey: "request-1",
      startedAt: "2026-07-25T05:59:00.000Z",
      completedAt: "2026-07-25T06:00:00.000Z",
      updatedAt: "2026-07-25T06:00:00.000Z",
      audience: {
        policyVersion: "acl/1.0.0",
        scopes: ["assigned_team", "audit_only"],
        courseId: "course-1",
        sessionId: "session-1",
        sessionEpoch: "epoch-1",
        teamIds: ["team-1"],
        roleIds: [],
        actorIds: [],
        privateNamespaces: [],
        auditReadable: true,
      },
    });
    expect(task.status).toBe("succeeded");
    expect(task.steps[0]?.output).toMatchObject({
      providerMode: "manual",
      verificationStatus: "pending_review",
      trust: "manual_unverified",
    });
    expect(SupplyMediaProcessingResultPayloadSchema.safeParse({
      taskId: "task-1",
      stepId: "step-1",
      summary: "人工补录",
      requestId: "manual-1",
      verificationStatus: "verified",
    }).success).toBe(false);
  });
});
