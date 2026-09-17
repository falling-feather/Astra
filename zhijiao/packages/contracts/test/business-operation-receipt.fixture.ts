import {
  BusinessOperationReceiptSchema,
  BusinessOperationReceiptSchemaVersion,
  type BusinessOperationReceipt,
} from "../src/business-operation-receipt.js";

export function businessOperationReceiptFixture(): BusinessOperationReceipt {
  const now = "2026-09-01T08:00:00.000Z";
  return BusinessOperationReceiptSchema.parse({
    schemaVersion: BusinessOperationReceiptSchemaVersion,
    operationId: "business-op-demo-submit",
    operationKind: "submit_work_revision",
    requestId: "request-submit-r2",
    requestHash: "a".repeat(64),
    scope: {
      sourceSessionId: "demo-xunpu-v2",
      targetSessionId: null,
      artifactId: "artifact-feature-story",
    },
    phase: "requested",
    revision: 0,
    authorityCommitRef: null,
    authorityCommittedAt: null,
    outbox: [{
      outboxId: "business-outbox-refresh-assessment",
      step: "refresh_assessment_projection",
      status: "pending",
      attempts: 0,
      resultRef: null,
      lastErrorCode: null,
      deliveredAt: null,
      updatedAt: now,
    }],
    recovery: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  });
}

export function completedBusinessOperationReceiptFixture(): BusinessOperationReceipt {
  const receipt = businessOperationReceiptFixture();
  const completedAt = "2026-09-01T08:00:02.000Z";
  return BusinessOperationReceiptSchema.parse({
    ...receipt,
    phase: "completed",
    revision: 2,
    authorityCommitRef: "work-revision-demo-r2",
    authorityCommittedAt: "2026-09-01T08:00:01.000Z",
    outbox: receipt.outbox.map((item) => ({
      ...item,
      status: "delivered",
      attempts: 1,
      resultRef: "assessment-projection-demo-r2",
      deliveredAt: completedAt,
      updatedAt: completedAt,
    })),
    updatedAt: completedAt,
    completedAt,
  });
}
