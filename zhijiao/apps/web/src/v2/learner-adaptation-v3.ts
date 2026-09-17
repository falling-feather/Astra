import {
  ChallengeAssignmentSchema,
  LearnerSimulationForecastSchema,
  LearnerTwinProfileSchema,
  PersonalizedLearningPlanSchema,
  type ChallengeAssignment,
  type LearnerSimulationForecast,
  type LearnerTwinProfile,
  type PersonalizedLearningPlan,
} from "@ronggang/contracts";
import { WireFormatError } from "./wire";
import {
  booleanOf,
  contentHashOf,
  exactRecord,
  integerOf,
  listOf,
  numberOf,
  oneOf,
  textOf,
} from "./world-v3";

export type LearnerGrowthAudienceV3 = "student" | "teacher";
export type LearnerGrowthStateV3 =
  | "evidence_required"
  | "ready"
  | "appeal_pending";

export interface LearnerGrowthViewV3 {
  schemaVersion: "learner-growth-view/3.0.0";
  audience: LearnerGrowthAudienceV3;
  state: LearnerGrowthStateV3;
  boundaries: {
    evidenceOnly: true;
    immutablePersonalityLabelsForbidden: true;
    sensitiveAttributesExcluded: true;
    proxyCanActForStudent: false;
    proxyCanCreateEvidence: false;
    proxyCanScoreStudent: false;
    teacherControlsActivation: true;
  };
  evidenceReadiness: {
    assessmentDecisionId: string;
    scoreStatus: "insufficient_evidence" | "provisional" | "final";
    teacherReviewStatus: "pending" | "confirmed" | "revised";
    message: string;
  };
  profile: null | {
    revision: number;
    confidence: number;
    competencies: Array<{
      competencyClaimId: string;
      title: string;
      level: number;
      confidence: number;
      strengths: string[];
      growthNeeds: string[];
      evidenceCount: number;
    }>;
    strategySignals: Array<{
      tendencyId: string;
      observedRate: number;
      confidence: number;
      pedagogicalUse: string;
    }>;
    appeal: {
      status: "none" | "requested" | "under_review" | "resolved";
      appealRef: string | null;
      requestedAt: string | null;
      resolvedAt: string | null;
    };
    updatedAt: string;
  };
  forecast: null | {
    dataSufficiency: "low" | "medium" | "high";
    behavioralUncertainty: number;
    calibrationStatus: "pending" | "evaluated";
    predictionError: number | null;
    candidateCount: number;
    explanation: string;
  };
  nextChallenge: null | {
    challengeLevel: 3 | 4 | 5 | 6 | 7;
    previousChallengeLevel: 3 | 4 | 5 | 6 | 7 | null;
    scoreCeiling: 80 | 85 | 90 | 95 | 100;
    assignmentReason:
      | "initial_diagnostic"
      | "evidence_progression"
      | "evidence_recovery"
      | "teacher_override";
    pressureDimensions: Array<{
      dimensionId: string;
      intensity: 3 | 4 | 5 | 6 | 7;
    }>;
    teacherOverride: null | { reason: string; decidedAt: string };
  };
  learningPlan: null | {
    learningPlanId: string;
    status: "proposed" | "teacher_confirmed" | "active" | "completed" | "retired";
    targets: Array<{
      competencyClaimId: string;
      title: string;
      currentLevel: number;
      targetLevel: number;
      practiceIntent: string;
      successEvidence: string;
    }>;
    scaffoldingActions: Array<{
      actionId: string;
      title: string;
      triggerCondition: string;
      fadeCondition: string;
    }>;
    recommendedChallengeLevel: 3 | 4 | 5 | 6 | 7;
    teacherConfirmed: boolean;
    reviewDueAt: string;
  };
  updatedAt: string;
}

export interface LearnerAdaptationPolicyReceiptV3 {
  policyReceiptId: string;
  forecastId: string;
  selectedCandidateId: string;
  previousChallengeLevel: 3 | 4 | 5 | 6 | 7;
  selectedChallengeLevel: 3 | 4 | 5 | 6 | 7;
  fallbackReason:
    | "none"
    | "low_profile_confidence"
    | "high_prediction_error";
  explanation: string;
  createdAt: string;
}

export interface LearnerAdaptationCaseV3 {
  schemaVersion: "learner-adaptation-case-view/3.0.0";
  state: "evidence_required" | "available";
  boundaries: {
    rawLearnerIdentityStored: false;
    sensitiveAttributesExcluded: true;
    immutablePersonalityLabel: null;
    proxyCanActForStudent: false;
    proxyCanCreateEvidence: false;
    proxyCanScoreStudent: false;
    automaticStepLimit: 1;
    initialChallengeRange: readonly [3, 5];
  };
  evidenceReadiness: {
    scoreStatus: "insufficient_evidence" | "provisional" | "final";
    teacherReviewStatus: "pending" | "confirmed" | "revised";
    updateBlockedByAppeal: boolean;
  };
  learnerTwinId: string | null;
  principalBindingHash: string | null;
  recordRevision: number | null;
  profileHistory: LearnerTwinProfile[];
  forecasts: LearnerSimulationForecast[];
  challengeAssignments: ChallengeAssignment[];
  learningPlans: PersonalizedLearningPlan[];
  updateReceipts: unknown[];
  policyReceipts: LearnerAdaptationPolicyReceiptV3[];
  appeals: unknown[];
  commandReceipts: unknown[];
  updatedAt: string;
}

export interface RequestLearnerAppealInputV3 {
  sessionId: string;
  bindingId: string;
  requestId: string;
  reason: string;
}

export interface ReviewLearnerAdaptationInputV3 {
  sessionId: string;
  bindingId: string;
  requestId: string;
  expectedProfileRevision: number;
  action:
    | "confirm_plan"
    | "override_challenge"
    | "begin_appeal_review"
    | "resolve_appeal";
  reason: string;
  challengeLevel?: 3 | 4 | 5 | 6 | 7;
}

function textList(value: unknown, label: string): string[] {
  return listOf(value, label).map((item, index) => (
    textOf(item, `${label}[${index}]`)
  ));
}

function nullableText(value: unknown, label: string): string | null {
  return value === null ? null : textOf(value, label);
}

function nullableNumber(value: unknown, label: string): number | null {
  return value === null ? null : numberOf(value, label);
}

function parseBoundaries(value: unknown): LearnerGrowthViewV3["boundaries"] {
  const boundary = exactRecord(value, [
    "evidenceOnly",
    "immutablePersonalityLabelsForbidden",
    "sensitiveAttributesExcluded",
    "proxyCanActForStudent",
    "proxyCanCreateEvidence",
    "proxyCanScoreStudent",
    "teacherControlsActivation",
  ], "growth.boundaries");
  if (boundary.evidenceOnly !== true
    || boundary.immutablePersonalityLabelsForbidden !== true
    || boundary.sensitiveAttributesExcluded !== true
    || boundary.proxyCanActForStudent !== false
    || boundary.proxyCanCreateEvidence !== false
    || boundary.proxyCanScoreStudent !== false
    || boundary.teacherControlsActivation !== true) {
    throw new WireFormatError("学习者成长安全边界被改变");
  }
  return {
    evidenceOnly: true,
    immutablePersonalityLabelsForbidden: true,
    sensitiveAttributesExcluded: true,
    proxyCanActForStudent: false,
    proxyCanCreateEvidence: false,
    proxyCanScoreStudent: false,
    teacherControlsActivation: true,
  };
}

function parseProfile(value: unknown): NonNullable<LearnerGrowthViewV3["profile"]> {
  const profile = exactRecord(value, [
    "revision",
    "confidence",
    "competencies",
    "strategySignals",
    "appeal",
    "updatedAt",
  ], "growth.profile");
  const appeal = exactRecord(profile.appeal, [
    "status", "appealRef", "requestedAt", "resolvedAt",
  ], "growth.profile.appeal");
  return {
    revision: integerOf(profile.revision, "growth.profile.revision"),
    confidence: numberOf(profile.confidence, "growth.profile.confidence"),
    competencies: listOf(profile.competencies, "growth.profile.competencies")
      .map((item, index) => {
        const competency = exactRecord(item, [
          "competencyClaimId", "title", "level", "confidence",
          "strengths", "growthNeeds", "evidenceCount",
        ], `growth.profile.competencies[${index}]`);
        return {
          competencyClaimId: textOf(competency.competencyClaimId, `competencies[${index}].competencyClaimId`),
          title: textOf(competency.title, `competencies[${index}].title`),
          level: integerOf(competency.level, `competencies[${index}].level`),
          confidence: numberOf(competency.confidence, `competencies[${index}].confidence`),
          strengths: textList(competency.strengths, `competencies[${index}].strengths`),
          growthNeeds: textList(competency.growthNeeds, `competencies[${index}].growthNeeds`),
          evidenceCount: integerOf(competency.evidenceCount, `competencies[${index}].evidenceCount`),
        };
      }),
    strategySignals: listOf(profile.strategySignals, "growth.profile.strategySignals")
      .map((item, index) => {
        const signal = exactRecord(item, [
          "tendencyId", "observedRate", "confidence", "pedagogicalUse",
        ], `growth.profile.strategySignals[${index}]`);
        return {
          tendencyId: textOf(signal.tendencyId, `strategySignals[${index}].tendencyId`),
          observedRate: numberOf(signal.observedRate, `strategySignals[${index}].observedRate`),
          confidence: numberOf(signal.confidence, `strategySignals[${index}].confidence`),
          pedagogicalUse: textOf(signal.pedagogicalUse, `strategySignals[${index}].pedagogicalUse`),
        };
      }),
    appeal: {
      status: oneOf(
        appeal.status,
        ["none", "requested", "under_review", "resolved"] as const,
        "growth.profile.appeal.status",
      ),
      appealRef: nullableText(appeal.appealRef, "growth.profile.appeal.appealRef"),
      requestedAt: nullableText(appeal.requestedAt, "growth.profile.appeal.requestedAt"),
      resolvedAt: nullableText(appeal.resolvedAt, "growth.profile.appeal.resolvedAt"),
    },
    updatedAt: textOf(profile.updatedAt, "growth.profile.updatedAt"),
  };
}

function parseForecast(value: unknown): NonNullable<LearnerGrowthViewV3["forecast"]> {
  const forecast = exactRecord(value, [
    "dataSufficiency", "behavioralUncertainty", "calibrationStatus",
    "predictionError", "candidateCount", "explanation",
  ], "growth.forecast");
  return {
    dataSufficiency: oneOf(
      forecast.dataSufficiency,
      ["low", "medium", "high"] as const,
      "growth.forecast.dataSufficiency",
    ),
    behavioralUncertainty: numberOf(
      forecast.behavioralUncertainty,
      "growth.forecast.behavioralUncertainty",
    ),
    calibrationStatus: oneOf(
      forecast.calibrationStatus,
      ["pending", "evaluated"] as const,
      "growth.forecast.calibrationStatus",
    ),
    predictionError: nullableNumber(
      forecast.predictionError,
      "growth.forecast.predictionError",
    ),
    candidateCount: integerOf(forecast.candidateCount, "growth.forecast.candidateCount"),
    explanation: textOf(forecast.explanation, "growth.forecast.explanation"),
  };
}

function parseNextChallenge(
  value: unknown,
): NonNullable<LearnerGrowthViewV3["nextChallenge"]> {
  const challenge = exactRecord(value, [
    "challengeLevel", "previousChallengeLevel", "scoreCeiling",
    "assignmentReason", "pressureDimensions", "teacherOverride",
  ], "growth.nextChallenge");
  const teacherOverride = challenge.teacherOverride === null
    ? null
    : (() => {
      const override = exactRecord(challenge.teacherOverride, [
        "reason", "decidedAt",
      ], "growth.nextChallenge.teacherOverride");
      return {
        reason: textOf(override.reason, "teacherOverride.reason"),
        decidedAt: textOf(override.decidedAt, "teacherOverride.decidedAt"),
      };
    })();
  return {
    challengeLevel: oneOf(challenge.challengeLevel, [3, 4, 5, 6, 7] as const, "nextChallenge.challengeLevel"),
    previousChallengeLevel: challenge.previousChallengeLevel === null
      ? null
      : oneOf(challenge.previousChallengeLevel, [3, 4, 5, 6, 7] as const, "nextChallenge.previousChallengeLevel"),
    scoreCeiling: oneOf(challenge.scoreCeiling, [80, 85, 90, 95, 100] as const, "nextChallenge.scoreCeiling"),
    assignmentReason: oneOf(
      challenge.assignmentReason,
      ["initial_diagnostic", "evidence_progression", "evidence_recovery", "teacher_override"] as const,
      "nextChallenge.assignmentReason",
    ),
    pressureDimensions: listOf(challenge.pressureDimensions, "nextChallenge.pressureDimensions")
      .map((item, index) => {
        const dimension = exactRecord(item, ["dimensionId", "intensity"], `pressureDimensions[${index}]`);
        return {
          dimensionId: textOf(dimension.dimensionId, `pressureDimensions[${index}].dimensionId`),
          intensity: oneOf(dimension.intensity, [3, 4, 5, 6, 7] as const, `pressureDimensions[${index}].intensity`),
        };
      }),
    teacherOverride,
  };
}

function parseLearningPlan(value: unknown): NonNullable<LearnerGrowthViewV3["learningPlan"]> {
  const plan = exactRecord(value, [
    "learningPlanId", "status", "targets", "scaffoldingActions",
    "recommendedChallengeLevel", "teacherConfirmed", "reviewDueAt",
  ], "growth.learningPlan");
  return {
    learningPlanId: textOf(plan.learningPlanId, "growth.learningPlan.learningPlanId"),
    status: oneOf(
      plan.status,
      ["proposed", "teacher_confirmed", "active", "completed", "retired"] as const,
      "growth.learningPlan.status",
    ),
    targets: listOf(plan.targets, "growth.learningPlan.targets").map((item, index) => {
      const target = exactRecord(item, [
        "competencyClaimId", "title", "currentLevel", "targetLevel",
        "practiceIntent", "successEvidence",
      ], `growth.learningPlan.targets[${index}]`);
      return {
        competencyClaimId: textOf(target.competencyClaimId, `plan.targets[${index}].competencyClaimId`),
        title: textOf(target.title, `plan.targets[${index}].title`),
        currentLevel: integerOf(target.currentLevel, `plan.targets[${index}].currentLevel`),
        targetLevel: integerOf(target.targetLevel, `plan.targets[${index}].targetLevel`),
        practiceIntent: textOf(target.practiceIntent, `plan.targets[${index}].practiceIntent`),
        successEvidence: textOf(target.successEvidence, `plan.targets[${index}].successEvidence`),
      };
    }),
    scaffoldingActions: listOf(plan.scaffoldingActions, "growth.learningPlan.scaffoldingActions")
      .map((item, index) => {
        const scaffold = exactRecord(item, [
          "actionId", "title", "triggerCondition", "fadeCondition",
        ], `growth.learningPlan.scaffoldingActions[${index}]`);
        return {
          actionId: textOf(scaffold.actionId, `scaffoldingActions[${index}].actionId`),
          title: textOf(scaffold.title, `scaffoldingActions[${index}].title`),
          triggerCondition: textOf(scaffold.triggerCondition, `scaffoldingActions[${index}].triggerCondition`),
          fadeCondition: textOf(scaffold.fadeCondition, `scaffoldingActions[${index}].fadeCondition`),
        };
      }),
    recommendedChallengeLevel: oneOf(
      plan.recommendedChallengeLevel,
      [3, 4, 5, 6, 7] as const,
      "growth.learningPlan.recommendedChallengeLevel",
    ),
    teacherConfirmed: booleanOf(plan.teacherConfirmed, "growth.learningPlan.teacherConfirmed"),
    reviewDueAt: textOf(plan.reviewDueAt, "growth.learningPlan.reviewDueAt"),
  };
}

export function parseLearnerGrowthResponse(
  value: unknown,
  expectedAudience: LearnerGrowthAudienceV3,
): LearnerGrowthViewV3 {
  const root = exactRecord(value, ["growth"], "LearnerGrowthResponse");
  const growth = exactRecord(root.growth, [
    "schemaVersion", "audience", "state", "boundaries",
    "evidenceReadiness", "profile", "forecast", "nextChallenge",
    "learningPlan", "updatedAt",
  ], "LearnerGrowthViewV3");
  if (growth.schemaVersion !== "learner-growth-view/3.0.0"
    || growth.audience !== expectedAudience) {
    throw new WireFormatError("学习者成长视图版本或认证角色不一致");
  }
  const readiness = exactRecord(growth.evidenceReadiness, [
    "assessmentDecisionId", "scoreStatus", "teacherReviewStatus", "message",
  ], "growth.evidenceReadiness");
  return {
    schemaVersion: "learner-growth-view/3.0.0",
    audience: expectedAudience,
    state: oneOf(
      growth.state,
      ["evidence_required", "ready", "appeal_pending"] as const,
      "growth.state",
    ),
    boundaries: parseBoundaries(growth.boundaries),
    evidenceReadiness: {
      assessmentDecisionId: textOf(readiness.assessmentDecisionId, "evidenceReadiness.assessmentDecisionId"),
      scoreStatus: oneOf(readiness.scoreStatus, ["insufficient_evidence", "provisional", "final"] as const, "evidenceReadiness.scoreStatus"),
      teacherReviewStatus: oneOf(readiness.teacherReviewStatus, ["pending", "confirmed", "revised"] as const, "evidenceReadiness.teacherReviewStatus"),
      message: textOf(readiness.message, "evidenceReadiness.message"),
    },
    profile: growth.profile === null ? null : parseProfile(growth.profile),
    forecast: growth.forecast === null ? null : parseForecast(growth.forecast),
    nextChallenge: growth.nextChallenge === null
      ? null
      : parseNextChallenge(growth.nextChallenge),
    learningPlan: growth.learningPlan === null
      ? null
      : parseLearningPlan(growth.learningPlan),
    updatedAt: textOf(growth.updatedAt, "growth.updatedAt"),
  };
}

function parsePolicyReceipt(
  value: unknown,
  index: number,
): LearnerAdaptationPolicyReceiptV3 {
  const receipt = exactRecord(value, [
    "policyReceiptId", "forecastId", "selectedCandidateId",
    "previousChallengeLevel", "selectedChallengeLevel", "fallbackReason",
    "explanation", "createdAt",
  ], `adaptationCase.policyReceipts[${index}]`);
  return {
    policyReceiptId: textOf(receipt.policyReceiptId, `policyReceipts[${index}].policyReceiptId`),
    forecastId: textOf(receipt.forecastId, `policyReceipts[${index}].forecastId`),
    selectedCandidateId: textOf(receipt.selectedCandidateId, `policyReceipts[${index}].selectedCandidateId`),
    previousChallengeLevel: oneOf(receipt.previousChallengeLevel, [3, 4, 5, 6, 7] as const, `policyReceipts[${index}].previousChallengeLevel`),
    selectedChallengeLevel: oneOf(receipt.selectedChallengeLevel, [3, 4, 5, 6, 7] as const, `policyReceipts[${index}].selectedChallengeLevel`),
    fallbackReason: oneOf(receipt.fallbackReason, ["none", "low_profile_confidence", "high_prediction_error"] as const, `policyReceipts[${index}].fallbackReason`),
    explanation: textOf(receipt.explanation, `policyReceipts[${index}].explanation`),
    createdAt: textOf(receipt.createdAt, `policyReceipts[${index}].createdAt`),
  };
}

export function parseLearnerAdaptationCaseResponse(
  value: unknown,
): LearnerAdaptationCaseV3 {
  const root = exactRecord(value, ["adaptationCase"], "LearnerAdaptationCaseResponse");
  const item = exactRecord(root.adaptationCase, [
    "schemaVersion", "state", "boundaries", "evidenceReadiness",
    "learnerTwinId", "principalBindingHash", "recordRevision",
    "profileHistory", "forecasts", "challengeAssignments", "learningPlans",
    "updateReceipts", "policyReceipts", "appeals", "commandReceipts", "updatedAt",
  ], "LearnerAdaptationCaseV3");
  if (item.schemaVersion !== "learner-adaptation-case-view/3.0.0") {
    throw new WireFormatError("学习者数字分身审计案例版本不受支持");
  }
  const boundary = exactRecord(item.boundaries, [
    "rawLearnerIdentityStored", "sensitiveAttributesExcluded",
    "immutablePersonalityLabel", "proxyCanActForStudent",
    "proxyCanCreateEvidence", "proxyCanScoreStudent", "automaticStepLimit",
    "initialChallengeRange",
  ], "adaptationCase.boundaries");
  const initialRange = listOf(boundary.initialChallengeRange, "boundaries.initialChallengeRange");
  if (boundary.rawLearnerIdentityStored !== false
    || boundary.sensitiveAttributesExcluded !== true
    || boundary.immutablePersonalityLabel !== null
    || boundary.proxyCanActForStudent !== false
    || boundary.proxyCanCreateEvidence !== false
    || boundary.proxyCanScoreStudent !== false
    || boundary.automaticStepLimit !== 1
    || initialRange.length !== 2
    || initialRange[0] !== 3
    || initialRange[1] !== 5) {
    throw new WireFormatError("学习者数字分身审计边界被改变");
  }
  const readiness = exactRecord(item.evidenceReadiness, [
    "scoreStatus", "teacherReviewStatus", "updateBlockedByAppeal",
  ], "adaptationCase.evidenceReadiness");
  return {
    schemaVersion: "learner-adaptation-case-view/3.0.0",
    state: oneOf(item.state, ["evidence_required", "available"] as const, "adaptationCase.state"),
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
      scoreStatus: oneOf(readiness.scoreStatus, ["insufficient_evidence", "provisional", "final"] as const, "adaptationCase.evidenceReadiness.scoreStatus"),
      teacherReviewStatus: oneOf(readiness.teacherReviewStatus, ["pending", "confirmed", "revised"] as const, "adaptationCase.evidenceReadiness.teacherReviewStatus"),
      updateBlockedByAppeal: booleanOf(readiness.updateBlockedByAppeal, "adaptationCase.evidenceReadiness.updateBlockedByAppeal"),
    },
    learnerTwinId: nullableText(item.learnerTwinId, "adaptationCase.learnerTwinId"),
    principalBindingHash: item.principalBindingHash === null
      ? null
      : contentHashOf(item.principalBindingHash, "adaptationCase.principalBindingHash"),
    recordRevision: item.recordRevision === null
      ? null
      : integerOf(item.recordRevision, "adaptationCase.recordRevision"),
    profileHistory: listOf(item.profileHistory, "adaptationCase.profileHistory")
      .map((profile) => LearnerTwinProfileSchema.parse(profile)),
    forecasts: listOf(item.forecasts, "adaptationCase.forecasts")
      .map((forecast) => LearnerSimulationForecastSchema.parse(forecast)),
    challengeAssignments: listOf(item.challengeAssignments, "adaptationCase.challengeAssignments")
      .map((assignment) => ChallengeAssignmentSchema.parse(assignment)),
    learningPlans: listOf(item.learningPlans, "adaptationCase.learningPlans")
      .map((plan) => PersonalizedLearningPlanSchema.parse(plan)),
    updateReceipts: listOf(item.updateReceipts, "adaptationCase.updateReceipts"),
    policyReceipts: listOf(item.policyReceipts, "adaptationCase.policyReceipts")
      .map(parsePolicyReceipt),
    appeals: listOf(item.appeals, "adaptationCase.appeals"),
    commandReceipts: listOf(item.commandReceipts, "adaptationCase.commandReceipts"),
    updatedAt: textOf(item.updatedAt, "adaptationCase.updatedAt"),
  };
}
