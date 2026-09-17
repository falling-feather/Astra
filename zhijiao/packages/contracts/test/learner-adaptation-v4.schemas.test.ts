import { describe, expect, it } from "vitest";
import {
  AdaptiveSecondSessionIdV4Schema,
  LearnerAdaptationResponseV4Schema,
  LearnerAdaptationViewV4Schema,
} from "../src/index.js";

function evidenceRequiredView(audience: "student" | "teacher") {
  return {
    schemaVersion: "learner-adaptation-view/4.0.0",
    audience,
    state: "evidence_required",
    safeMessage: "最终评价证据尚未形成，第二场不会提前生成。",
    boundaries: {
      observableEvidenceOnly: true,
      immutablePersonalityLabelsForbidden: true,
      sensitiveAttributesExcluded: true,
      studentConsentRequired: true,
      teacherAuthorizationRequired: true,
      proxyCanActForStudent: false,
      proxyCanCreateEvidence: false,
      proxyCanScoreStudent: false,
      calibrationEvidenceEligibleForScore: false,
    },
    learnerModel: null,
    forecast: null,
    proposal: null,
    consent: null,
    appeal: null,
    handoff: null,
    nextAction: "先完成真实岗位任务与教师最终评价。",
  };
}

describe("learner adaptation V4 public contracts", () => {
  it("recognizes only server-signed adaptive second-session identifiers", () => {
    expect(AdaptiveSecondSessionIdV4Schema.safeParse(
      "training-adaptive-v4-e8e2bdbce75d938ab68935cb",
    ).success).toBe(true);
    expect(AdaptiveSecondSessionIdV4Schema.safeParse(
      "training-adaptive-v4-forged",
    ).success).toBe(false);
  });

  it("accepts the role-safe evidence-required state for student and teacher", () => {
    for (const audience of ["student", "teacher"] as const) {
      expect(LearnerAdaptationResponseV4Schema.parse({
        adaptation: evidenceRequiredView(audience),
      }).adaptation.audience).toBe(audience);
    }
  });

  it("rejects extra private runtime fields at the shared contract boundary", () => {
    expect(() => LearnerAdaptationViewV4Schema.parse({
      ...evidenceRequiredView("student"),
      learnerActorId: "student-private",
    })).toThrow();
  });

  it("rejects a generated state that omits the evidence model and controls", () => {
    expect(() => LearnerAdaptationViewV4Schema.parse({
      ...evidenceRequiredView("teacher"),
      state: "proposed",
    })).toThrow(/完整模型/u);
  });
});
