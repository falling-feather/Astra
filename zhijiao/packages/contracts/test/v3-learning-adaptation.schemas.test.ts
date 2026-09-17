import { describe, expect, it } from "vitest";
import {
  AssessmentDecisionSchema,
  ChallengeAssignmentSchema,
  CompetencyEvidenceEpisodeSchema,
  LearnerSimulationForecastSchema,
  LearnerTwinProfileSchema,
  PersonalizedLearningPlanSchema,
} from "../src/index.js";
import {
  assessmentDecisionFixture,
  challengeAssignmentFixture,
  competencyEvidenceEpisodeFixture,
  learnerSimulationForecastFixture,
  learnerTwinProfileFixture,
  personalizedLearningPlanFixture,
} from "./v3-simulation.fixture.js";

describe("V3 learner twin and adaptive challenge contracts", () => {
  it("accepts real evidence, assessment, safe twin, forecast, challenge and plan", () => {
    expect(CompetencyEvidenceEpisodeSchema.parse(
      competencyEvidenceEpisodeFixture(),
    ).evidenceEligible).toBe(true);
    expect(AssessmentDecisionSchema.parse(assessmentDecisionFixture()).sessionScore)
      .toBe(72);
    expect(LearnerTwinProfileSchema.parse(
      learnerTwinProfileFixture(),
    ).sensitiveAttributesExcluded).toBe(true);
    const forecast = LearnerSimulationForecastSchema.parse(
      learnerSimulationForecastFixture(),
    );
    expect(forecast.evidenceEligible).toBe(false);
    expect(forecast.canActForStudent).toBe(false);
    expect(forecast.canScoreStudent).toBe(false);
    expect(ChallengeAssignmentSchema.parse(
      challengeAssignmentFixture(),
    ).challengeLevel).toBe(5);
    expect(PersonalizedLearningPlanSchema.parse(
      personalizedLearningPlanFixture(),
    ).status).toBe("proposed");
  });

  it("does not allow a learner proxy prediction to become student evidence", () => {
    expect(() => CompetencyEvidenceEpisodeSchema.parse({
      ...competencyEvidenceEpisodeFixture(),
      sourceKind: "learner_proxy_prediction",
      sourceActionRefs: ["forecast-candidate-level-5"],
    })).toThrow();

    expect(() => CompetencyEvidenceEpisodeSchema.parse({
      ...competencyEvidenceEpisodeFixture(),
      proxyPredictionRef: "forecast-candidate-level-5",
    })).toThrow();
  });

  it("separates completion, evidence sufficiency and capped session scoring", () => {
    const overCeiling = structuredClone(assessmentDecisionFixture());
    overCeiling.sessionScore = 95;
    expect(() => AssessmentDecisionSchema.parse(overCeiling)).toThrow();

    const badMapping = structuredClone(assessmentDecisionFixture());
    badMapping.scoreCeiling = 100;
    expect(() => AssessmentDecisionSchema.parse(badMapping)).toThrow();

    const insufficientWithScore = structuredClone(assessmentDecisionFixture());
    insufficientWithScore.scoreStatus = "insufficient_evidence";
    expect(() => AssessmentDecisionSchema.parse(insufficientWithScore)).toThrow();

    const finalWithoutTeacher = structuredClone(assessmentDecisionFixture());
    finalWithoutTeacher.scoreStatus = "final";
    expect(() => AssessmentDecisionSchema.parse(finalWithoutTeacher)).toThrow();
  });

  it("keeps the learner twin pedagogical, appealable and free of fixed labels", () => {
    expect(() => LearnerTwinProfileSchema.parse({
      ...learnerTwinProfileFixture(),
      immutablePersonalityLabel: "introvert",
      gender: "unknown",
      familyIncome: "high",
    })).toThrow();

    const unresolvedAppeal = structuredClone(learnerTwinProfileFixture());
    unresolvedAppeal.appeal = {
      status: "resolved",
      appealRef: "appeal-001",
      requestedAt: "2026-08-26T02:18:00.000Z",
      resolvedAt: null,
    };
    expect(() => LearnerTwinProfileSchema.parse(unresolvedAppeal)).toThrow();
  });

  it("makes proxy forecasts uncertain, non-acting, non-scoring and calibratable", () => {
    expect(() => LearnerSimulationForecastSchema.parse({
      ...learnerSimulationForecastFixture(),
      evidenceEligible: true,
      canActForStudent: true,
      canScoreStudent: true,
    })).toThrow();

    const fakeCalibration = structuredClone(learnerSimulationForecastFixture());
    fakeCalibration.calibration.predictionError = 0;
    expect(() => LearnerSimulationForecastSchema.parse(fakeCalibration)).toThrow();
  });

  it("limits automatic pressure changes to one level and freezes score ceilings", () => {
    const levelJump = structuredClone(challengeAssignmentFixture());
    levelJump.previousChallengeLevel = 3;
    levelJump.challengeLevel = 6;
    levelJump.scoreCeiling = 95;
    expect(() => ChallengeAssignmentSchema.parse(levelJump)).toThrow();

    const badCeiling = structuredClone(challengeAssignmentFixture());
    badCeiling.scoreCeiling = 100;
    expect(() => ChallengeAssignmentSchema.parse(badCeiling)).toThrow();

    const unsafeInitial = structuredClone(challengeAssignmentFixture());
    unsafeInitial.previousChallengeLevel = null;
    unsafeInitial.challengeLevel = 7;
    unsafeInitial.scoreCeiling = 100;
    unsafeInitial.assignmentReason = "initial_diagnostic";
    unsafeInitial.basisEvidenceRefs = [];
    expect(() => ChallengeAssignmentSchema.parse(unsafeInitial)).toThrow();
  });

  it("requires teacher confirmation before a personalized plan becomes active", () => {
    const activeWithoutTeacher = structuredClone(personalizedLearningPlanFixture());
    activeWithoutTeacher.status = "active";
    expect(() => PersonalizedLearningPlanSchema.parse(activeWithoutTeacher)).toThrow();

    const backwardTarget = structuredClone(personalizedLearningPlanFixture());
    backwardTarget.targetCompetencies[0]!.targetLevel = 1;
    expect(() => PersonalizedLearningPlanSchema.parse(backwardTarget)).toThrow();
  });
});
