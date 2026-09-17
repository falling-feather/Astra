import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ChallengeAssignmentSchemaVersion,
  LearnerSimulationForecastSchemaVersion,
  LearnerTwinProfileSchemaVersion,
  PersonalizedLearningPlanSchemaVersion,
  type ChallengeAssignment,
  type LearnerSimulationForecast,
  type LearnerTwinProfile,
  type PersonalizedLearningPlan,
} from "@ronggang/contracts";
import { describe, expect, it } from "vitest";
import {
  parseLearnerAdaptationCaseResponse,
  parseLearnerGrowthResponse,
  type LearnerAdaptationCaseV3,
  type LearnerGrowthViewV3,
} from "../src/v2/learner-adaptation-v3";
import { createHttpExperienceGateway } from "../src/v2/gateway";
import { createHttpTeacherGateway } from "../src/v2/teacher-gateway";
import { createHttpAdminGateway } from "../src/v2/admin-gateway";
import { AdminLearnerAdaptationCaseSurface } from "../src/v2/pages/admin-evidence-page";

const hash = "a".repeat(64);
const simulationReleaseRef = {
  simulationId: "simulation-xunpu-living-world",
  releaseId: "simulation-xunpu-living-world-r2",
  version: 2,
  contentHash: "b".repeat(64),
};
const timestamp = "2026-08-26T08:00:00.000Z";

function growthView(audience: "student" | "teacher"): LearnerGrowthViewV3 {
  return {
    schemaVersion: "learner-growth-view/3.0.0",
    audience,
    state: "ready",
    boundaries: {
      evidenceOnly: true,
      immutablePersonalityLabelsForbidden: true,
      sensitiveAttributesExcluded: true,
      proxyCanActForStudent: false,
      proxyCanCreateEvidence: false,
      proxyCanScoreStudent: false,
      teacherControlsActivation: true,
    },
    evidenceReadiness: {
      assessmentDecisionId: "assessment-final-growth",
      scoreStatus: "final",
      teacherReviewStatus: "confirmed",
      message: "本轮成长建议来自已完成教师复核的真实证据。",
    },
    profile: {
      revision: 2,
      confidence: 0.82,
      competencies: [{
        competencyClaimId: "criterion-fact-verification",
        title: "事实核验",
        level: 3,
        confidence: 0.82,
        strengths: ["能够定位原始来源。"],
        growthNeeds: ["继续形成独立交叉核验。"],
        evidenceCount: 3,
      }],
      strategySignals: [{
        tendencyId: "evidence_first",
        observedRate: 0.6,
        confidence: 0.75,
        pedagogicalUse: "下一轮逐步撤除直接提示。",
      }],
      appeal: {
        status: "none",
        appealRef: null,
        requestedAt: null,
        resolvedAt: null,
      },
      updatedAt: timestamp,
    },
    forecast: {
      dataSufficiency: "medium",
      behavioralUncertainty: 0.42,
      calibrationStatus: "pending",
      predictionError: null,
      candidateCount: 3,
      explanation: "代理只比较候选冲突，不替学生行动、造证据或评分。",
    },
    nextChallenge: {
      challengeLevel: 5,
      previousChallengeLevel: 4,
      scoreCeiling: 90,
      assignmentReason: "evidence_progression",
      pressureDimensions: [
        { dimensionId: "time", intensity: 5 },
        { dimensionId: "source_access", intensity: 5 },
      ],
      teacherOverride: null,
    },
    learningPlan: {
      learningPlanId: "learning-plan-growth",
      status: "proposed",
      targets: [{
        competencyClaimId: "criterion-fact-verification",
        title: "事实核验",
        currentLevel: 3,
        targetLevel: 4,
        practiceIntent: "先自主判断，再用两条独立依据说明取舍。",
        successEvidence: "形成真实行动、作品修订和世界后果。",
      }],
      scaffoldingActions: [{
        actionId: "scaffold-evidence-card",
        title: "证据追问卡",
        triggerCondition: "连续行动仍只有单一信源时出现。",
        fadeCondition: "连续两次自主交叉核验后撤除。",
      }],
      recommendedChallengeLevel: 5,
      teacherConfirmed: false,
      reviewDueAt: "2026-09-09T08:00:00.000Z",
    },
    updatedAt: timestamp,
  };
}

const profile: LearnerTwinProfile = {
  schemaVersion: LearnerTwinProfileSchemaVersion,
  learnerTwinId: "learner-twin-growth",
  principalBindingHash: hash,
  modelVersion: "learner-twin-evidence-updater/1.0.0",
  modelContentHash: "c".repeat(64),
  profileContentHash: "d".repeat(64),
  revision: 2,
  competencyStates: [{
    competencyClaimId: "criterion-fact-verification",
    competencyLevel: 3,
    confidence: 0.82,
    supportingAssessmentRefs: ["assessment-final-growth"],
    observedStrengths: ["能够定位原始来源。"],
    growthNeeds: ["继续形成独立交叉核验。"],
    updatedAt: timestamp,
  }],
  strategyTendencies: [{
    tendencyId: "evidence_first",
    observedRate: 0.6,
    confidence: 0.75,
    basisEvidenceRefs: ["work-action-inspect"],
    pedagogicalUse: "下一轮逐步撤除直接提示。",
  }],
  scaffoldingResponse: {
    acceptedSuggestionRate: 0.4,
    requestedEvidenceRate: 0.3,
    rejectedSuggestionRate: 0.2,
    productiveRevisionRate: 0.7,
    basisEvidenceRefs: ["evidence-episode-growth"],
  },
  recentChallengeHistory: [{
    challengeAssignmentRef: "challenge-growth-current",
    challengeLevel: 4,
    assessmentDecisionRef: "assessment-final-growth",
    completedAt: timestamp,
  }],
  nextCompetencyTargetRefs: ["criterion-fact-verification"],
  evidenceRefs: ["evidence-episode-growth"],
  confidence: 0.82,
  immutablePersonalityLabel: null,
  sensitiveAttributesExcluded: true,
  appeal: {
    status: "none",
    appealRef: null,
    requestedAt: null,
    resolvedAt: null,
  },
  updatedAt: timestamp,
};

const forecast: LearnerSimulationForecast = {
  schemaVersion: LearnerSimulationForecastSchemaVersion,
  forecastId: "forecast-growth-next",
  learnerTwinRef: profile.learnerTwinId,
  learnerTwinRevision: profile.revision,
  learnerTwinContentHash: profile.profileContentHash,
  simulationReleaseRef,
  forecastModelVersion: "learner-proxy-deterministic/1.0.0",
  forecastModelContentHash: "e".repeat(64),
  candidates: [4, 5, 6].map((level) => ({
    candidateId: `candidate-growth-${level}`,
    challengeLevel: level,
    worldVariantRef: `world-variant-level-${level}`,
    predictedActions: [{ actionKind: "inspect", probability: 0.5 }],
    predictedSuccessProbability: level === 5 ? 0.78 : 0.65,
    predictedOverloadProbability: level === 6 ? 0.44 : 0.2,
    predictedGrowthValue: level === 5 ? 0.82 : 0.65,
    rationale: `只比较 ${level} 级候选世界，不替学生行动。`,
  })),
  uncertainty: { epistemic: 0.18, behavioral: 0.42, dataSufficiency: "medium" },
  evidenceEligible: false,
  canActForStudent: false,
  canScoreStudent: false,
  calibration: {
    status: "pending",
    actualStudentActionRefs: [],
    predictionError: null,
    evaluatedAt: null,
  },
  generatedAt: timestamp,
};

const assignment: ChallengeAssignment = {
  schemaVersion: ChallengeAssignmentSchemaVersion,
  challengeAssignmentId: "challenge-growth-next",
  learnerTwinRef: profile.learnerTwinId,
  sessionId: "demo-xunpu-v2-next-r2",
  simulationReleaseRef,
  worldVariantRef: "world-variant-level-5",
  previousChallengeLevel: 4,
  challengeLevel: 5,
  scoreCeiling: 90,
  pressureDimensions: [{ dimensionId: "time", intensity: 5 }],
  assignmentReason: "evidence_progression",
  basisEvidenceRefs: ["evidence-episode-growth"],
  forecastRef: forecast.forecastId,
  teacherOverride: null,
  policyVersion: "challenge-policy-evidence-zone/1.0.0",
  policyContentHash: "f".repeat(64),
  assignedAt: timestamp,
};

const plan: PersonalizedLearningPlan = {
  schemaVersion: PersonalizedLearningPlanSchemaVersion,
  learningPlanId: "learning-plan-growth",
  learnerTwinRef: profile.learnerTwinId,
  sourceAssessmentDecisionRef: "assessment-final-growth",
  sourceChallengeAssignmentRef: "challenge-growth-current",
  status: "proposed",
  targetCompetencies: [{
    competencyClaimId: "criterion-fact-verification",
    currentLevel: 3,
    targetLevel: 4,
    evidenceRefs: ["evidence-episode-growth"],
    practiceIntent: "先自主判断，再用两条独立依据说明取舍。",
    successEvidence: "形成真实行动、作品修订和世界后果。",
  }],
  recommendedChallengeLevel: 5,
  recommendedWorldVariantRefs: ["world-variant-level-5"],
  scaffoldingActions: [{
    actionId: "scaffold-evidence-card",
    title: "证据追问卡",
    triggerCondition: "连续行动仍只有单一信源时出现。",
    fadeCondition: "连续两次自主交叉核验后撤除。",
  }],
  learnerChoiceRefs: [],
  teacherConfirmation: null,
  reviewDueAt: "2026-09-09T08:00:00.000Z",
  createdAt: timestamp,
  updatedAt: timestamp,
};

function adaptationCase(): LearnerAdaptationCaseV3 {
  return {
    schemaVersion: "learner-adaptation-case-view/3.0.0",
    state: "available",
    boundaries: {
      rawLearnerIdentityStored: false,
      sensitiveAttributesExcluded: true,
      immutablePersonalityLabel: null,
      proxyCanActForStudent: false,
      proxyCanCreateEvidence: false,
      proxyCanScoreStudent: false,
      automaticStepLimit: 1,
      initialChallengeRange: [3, 5],
    },
    evidenceReadiness: {
      scoreStatus: "final",
      teacherReviewStatus: "confirmed",
      updateBlockedByAppeal: false,
    },
    learnerTwinId: profile.learnerTwinId,
    principalBindingHash: profile.principalBindingHash,
    recordRevision: 2,
    profileHistory: [profile],
    forecasts: [forecast],
    challengeAssignments: [assignment],
    learningPlans: [plan],
    updateReceipts: [],
    policyReceipts: [{
      policyReceiptId: "policy-receipt-growth",
      forecastId: forecast.forecastId,
      selectedCandidateId: "candidate-growth-5",
      previousChallengeLevel: 4,
      selectedChallengeLevel: 5,
      fallbackReason: "none",
      explanation: "选择成长价值较高且过载风险可控的五级候选。",
      createdAt: timestamp,
    }],
    appeals: [],
    commandReceipts: [],
    updatedAt: timestamp,
  };
}

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const auth = {
  profileId: "student-xunpu",
  principal: {
    principalId: "principal-student",
    kind: "human" as const,
    displayName: "学生记者",
    status: "active" as const,
    createdAt: timestamp,
  },
  bindings: [],
  csrfToken: "csrf-growth",
  expiresAt: "2026-08-27T08:00:00.000Z",
};

describe("V3 learner twin and adaptive growth", () => {
  it("strictly parses the role-safe growth view and rejects leaked technical fields", () => {
    expect(parseLearnerGrowthResponse({ growth: growthView("student") }, "student"))
      .toEqual(growthView("student"));
    expect(() => parseLearnerGrowthResponse({
      growth: { ...growthView("student"), principalBindingHash: hash },
    }, "student")).toThrow("字段不符合冻结接口");
    expect(() => parseLearnerGrowthResponse({
      growth: {
        ...growthView("student"),
        boundaries: {
          ...growthView("student").boundaries,
          proxyCanActForStudent: true,
        },
      },
    }, "student")).toThrow("安全边界");
  });

  it("parses and renders the administrator-only profile, candidates, hashes and calibration boundary", () => {
    const parsed = parseLearnerAdaptationCaseResponse({
      adaptationCase: adaptationCase(),
    });
    expect(parsed.forecasts[0]).toMatchObject({
      evidenceEligible: false,
      canActForStudent: false,
      canScoreStudent: false,
    });
    const markup = renderToStaticMarkup(createElement(
      AdminLearnerAdaptationCaseSurface,
      { value: parsed },
    ));
    expect(markup).toContain("学习者数字分身与反事实候选");
    expect(markup).toContain("零代答 / 零造证据 / 零评分");
    expect(markup).toContain("沙箱候选世界");
    expect(markup).toContain("等待下一轮真实学生行动");
    expect(markup).toContain("成长方案仍为 proposed");
  });

  it("uses frozen student and teacher endpoints, sends CSRF and never accepts browser actor/twin/forecast refs", async () => {
    const studentCalls: Array<{ url: string; init?: RequestInit }> = [];
    const student = createHttpExperienceGateway(auth, {
      apiBase: "http://api.local",
      fetchImpl: async (input, init) => {
        studentCalls.push({ url: String(input), init });
        return response({ growth: growthView("student") });
      },
    });
    await student.getLearnerGrowth!("demo-xunpu-v2", "binding-student");
    await student.requestLearnerAppeal!({
      sessionId: "demo-xunpu-v2",
      bindingId: "binding-student",
      requestId: "request-growth-appeal",
      reason: "请教师复核尚未进入画像的真实作品证据。",
    });
    expect(studentCalls[0]?.url).toContain("/learner-growth?bindingId=binding-student");
    const studentBody = JSON.parse(String(studentCalls[1]?.init?.body));
    expect(studentBody).toEqual({
      bindingId: "binding-student",
      requestId: "request-growth-appeal",
      reason: "请教师复核尚未进入画像的真实作品证据。",
    });
    expect(new Headers(studentCalls[1]?.init?.headers).get("X-CSRF-Token"))
      .toBe("csrf-growth");

    const teacherCalls: Array<{ url: string; init?: RequestInit }> = [];
    const teacher = createHttpTeacherGateway({ ...auth, profileId: "teacher-class-a" }, {
      apiBase: "http://api.local",
      fetchImpl: async (input, init) => {
        teacherCalls.push({ url: String(input), init });
        return response({ growth: growthView("teacher") });
      },
    });
    await teacher.reviewLearnerAdaptation!({
      sessionId: "demo-xunpu-v2",
      bindingId: "binding-teacher",
      requestId: "request-growth-confirm",
      expectedProfileRevision: 2,
      action: "confirm_plan",
      reason: "本轮真实证据支持该成长方案，确认进入下一轮。",
    });
    const teacherBody = JSON.parse(String(teacherCalls[0]?.init?.body));
    expect(teacherBody).not.toHaveProperty("actorId");
    expect(teacherBody).not.toHaveProperty("learnerTwinRef");
    expect(teacherBody).not.toHaveProperty("forecastRef");
    expect(new Headers(teacherCalls[0]?.init?.headers).get("X-CSRF-Token"))
      .toBe("csrf-growth");
  });

  it("loads the full adaptation case from the administrator-only endpoint", async () => {
    const calls: string[] = [];
    const admin = createHttpAdminGateway({
      apiBase: "http://api.local",
      fetchImpl: async (input) => {
        calls.push(String(input));
        return response({ adaptationCase: adaptationCase() });
      },
    });
    await admin.getLearnerAdaptationCase!("demo-xunpu-v2", "binding-admin");
    expect(calls).toEqual([
      "http://api.local/api/v3/admin/sessions/demo-xunpu-v2/learner-adaptation-case?bindingId=binding-admin",
    ]);
  });
});
