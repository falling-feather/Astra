import { describe, expect, it } from "vitest";
import {
  FlagshipRuntimeActionPolicyV4Schema,
  type FlagshipRuntimeActionPolicyV4,
} from "@ronggang/contracts";
import { evaluateFlagshipRuntimeActionPolicyV4 } from "../src/flagship-action-policy-v4.js";

function recordFixture() {
  return {
    queue: [{
      eventType: "student_asks_gatekeeper",
      status: "committed",
    }],
    currentSnapshot: {
      entities: [{ entityId: "entity-gatekeeper", status: "available" }],
      facts: [{ factId: "fact-access-condition", status: "confirmed" }],
      variables: [{ variableId: "source_access", after: 42 }],
      resources: [{ resourceId: "interview-minutes", amount: 8 }],
      virtualTime: { elapsedMinutes: 12, remainingMinutes: 43 },
    },
  } as any;
}

function policy(): FlagshipRuntimeActionPolicyV4 {
  return FlagshipRuntimeActionPolicyV4Schema.parse({
    schemaVersion: "flagship-action-policy/4.0.0",
    policyId: "policy-test",
    actions: [{
      eventTemplateId: "event-template-community-source",
      requirements: {
        all: [{
          kind: "event_status",
          eventType: "student_asks_gatekeeper",
          statuses: ["committed"],
        }],
        any: [{
          kind: "resource_threshold",
          resourceId: "interview-minutes",
          operator: "gte",
          value: 10,
        }, {
          kind: "time_threshold",
          metric: "remaining_minutes",
          operator: "gte",
          value: 45,
        }],
        none: [{
          kind: "fact_status",
          factId: "fact-access-condition",
          statuses: ["refuted"],
        }],
      },
      unavailableReason: "采访窗口或剩余时间不足。",
    }],
  });
}

describe("flagship action policy v4", () => {
  it("combines all/any/none conditions and reports concrete failures", () => {
    const evaluation = evaluateFlagshipRuntimeActionPolicyV4(
      policy(),
      "event-template-community-source",
      recordFixture(),
    );
    expect(evaluation).toMatchObject({ status: "blocked", allowed: false });
    expect(evaluation.reasons.join("；")).toContain("采访窗口或剩余时间不足");
    expect(evaluation.reasons.join("；")).toContain("interview-minutes");
  });

  it("allows one alternate route and rejects an undeclared event", () => {
    const record = recordFixture();
    record.currentSnapshot.resources[0]!.amount = 10;
    expect(evaluateFlagshipRuntimeActionPolicyV4(
      policy(),
      "event-template-community-source",
      record,
    )).toMatchObject({ status: "allowed", allowed: true });
    expect(evaluateFlagshipRuntimeActionPolicyV4(
      policy(),
      "event-template-unknown",
      record,
    )).toMatchObject({ status: "missing_rule", allowed: false });
  });

  it("keeps releases without policy on the explicit legacy path", () => {
    expect(evaluateFlagshipRuntimeActionPolicyV4(
      undefined,
      "event-template-legacy",
      recordFixture(),
    )).toMatchObject({ status: "legacy", allowed: true });
  });
});
