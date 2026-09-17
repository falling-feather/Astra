import { describe, expect, it } from "vitest";
import {
  BusinessOperationReceiptSchema,
} from "../src/business-operation-receipt.js";
import {
  businessOperationReceiptFixture,
  completedBusinessOperationReceiptFixture,
} from "./business-operation-receipt.fixture.js";

describe("BusinessOperationReceipt/4.0.0", () => {
  it("accepts requested and completed receipts", () => {
    expect(BusinessOperationReceiptSchema.parse(
      businessOperationReceiptFixture(),
    ).phase).toBe("requested");
    expect(BusinessOperationReceiptSchema.parse(
      completedBusinessOperationReceiptFixture(),
    ).phase).toBe("completed");
  });

  it("rejects duplicated outbox steps", () => {
    const receipt = businessOperationReceiptFixture();
    expect(BusinessOperationReceiptSchema.safeParse({
      ...receipt,
      outbox: [receipt.outbox[0], {
        ...receipt.outbox[0],
        outboxId: "business-outbox-duplicate",
      }],
    }).success).toBe(false);
  });

  it("rejects skipped authority and projection phases", () => {
    const receipt = businessOperationReceiptFixture();
    expect(BusinessOperationReceiptSchema.safeParse({
      ...receipt,
      phase: "completed",
      completedAt: "2026-09-01T08:00:03.000Z",
    }).success).toBe(false);
    expect(BusinessOperationReceiptSchema.safeParse({
      ...receipt,
      phase: "projections_pending",
      authorityCommitRef: "work-revision-demo-r2",
      authorityCommittedAt: "2026-09-01T08:00:01.000Z",
    }).success).toBe(false);
  });

  it("rejects delivered outbox without a result receipt", () => {
    const receipt = businessOperationReceiptFixture();
    expect(BusinessOperationReceiptSchema.safeParse({
      ...receipt,
      phase: "completed",
      authorityCommitRef: "work-revision-demo-r2",
      authorityCommittedAt: "2026-09-01T08:00:01.000Z",
      completedAt: "2026-09-01T08:00:02.000Z",
      outbox: receipt.outbox.map((item) => ({
        ...item,
        status: "delivered",
        attempts: 1,
        deliveredAt: "2026-09-01T08:00:02.000Z",
      })),
    }).success).toBe(false);
  });

  it("rejects recovery without an explicit next safe action", () => {
    const receipt = businessOperationReceiptFixture();
    expect(BusinessOperationReceiptSchema.safeParse({
      ...receipt,
      phase: "recovery_required",
      recovery: {
        reasonCode: "projection_timeout",
        failedAt: "2026-09-01T08:00:02.000Z",
      },
    }).success).toBe(false);
  });

  it("rejects unknown fields and invalid request hashes", () => {
    const receipt = businessOperationReceiptFixture();
    expect(BusinessOperationReceiptSchema.safeParse({
      ...receipt,
      requestHash: "not-a-hash",
    }).success).toBe(false);
    expect(BusinessOperationReceiptSchema.safeParse({
      ...receipt,
      rawPayload: { private: true },
    }).success).toBe(false);
  });
});
