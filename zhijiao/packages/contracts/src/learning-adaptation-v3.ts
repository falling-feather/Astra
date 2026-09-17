import { z } from "zod";
import {
  CourseReleaseReferenceSchema,
  V2ContentHashSchema,
  V2IdentifierSchema,
} from "./course-learning.js";
import {
  ChallengeLevelSchema,
  ChallengeScoreCeilingSchema,
  SimulationReleaseReferenceSchema,
  challengeScoreCeiling,
} from "./world-simulation-v3.js";

export const CompetencyEvidenceEpisodeSchemaVersion =
  "competency-evidence-episode/3.0.0" as const;
export const AssessmentDecisionSchemaVersion =
  "assessment-decision/3.0.0" as const;
export const LearnerTwinProfileSchemaVersion =
  "learner-twin-profile/3.0.0" as const;
export const LearnerSimulationForecastSchemaVersion =
  "learner-simulation-forecast/3.0.0" as const;
export const ChallengeAssignmentSchemaVersion =
  "challenge-assignment/3.0.0" as const;
export const PersonalizedLearningPlanSchemaVersion =
  "personalized-learning-plan/3.0.0" as const;

const TimestampSchema = z.string().datetime();
const NonEmptyTextSchema = z.string().trim().min(1);

function addDuplicateIssues(
  values: string[],
  path: PropertyKey[],
  message: string,
  context: z.RefinementCtx,
): void {
  if (new Set(values).size !== values.length) {
    context.addIssue({ code: "custom", path, message });
  }
}

const CompetencyObservationSchema = z.object({
  observationId: V2IdentifierSchema,
  competencyClaimId: V2IdentifierSchema,
  direction: z.enum(["supports", "refutes", "insufficient"]),
  observableBehavior: NonEmptyTextSchema.max(800),
  sourceRefs: z.array(V2IdentifierSchema).min(1).max(32),
  artifactRevisionRefs: z.array(V2IdentifierSchema).max(16),
  worldConsequenceRefs: z.array(V2IdentifierSchema).max(16),
  scaffoldingLevel: z.number().int().min(0).max(3),
  evaluatorConfidence: z.number().min(0).max(1),
}).strict();

export const CompetencyEvidenceEpisodeSchema = z.object({
  schemaVersion: z.literal(CompetencyEvidenceEpisodeSchemaVersion),
  evidenceEpisodeId: V2IdentifierSchema,
  sessionId: V2IdentifierSchema,
  bindingId: V2IdentifierSchema,
  actorId: V2IdentifierSchema,
  courseReleaseRef: CourseReleaseReferenceSchema,
  simulationReleaseRef: SimulationReleaseReferenceSchema,
  challengeAssignmentRef: V2IdentifierSchema,
  sourceKind: z.enum([
    "real_student_action",
    "teacher_decision",
    "world_consequence",
    "artifact_revision",
  ]),
  sourceActionRefs: z.array(V2IdentifierSchema).min(1).max(32),
  observations: z.array(CompetencyObservationSchema).min(1).max(32),
  evidenceEligible: z.literal(true),
  collectedAt: TimestampSchema,
}).strict().superRefine((episode, context) => {
  addDuplicateIssues(
    episode.observations.map((observation) => observation.observationId),
    ["observations"],
    "能力证据观察 ID 必须唯一",
    context,
  );
  const referencedSources = new Set(
    episode.observations.flatMap((observation) => observation.sourceRefs),
  );
  if (!episode.sourceActionRefs.some((sourceRef) => referencedSources.has(sourceRef))) {
    context.addIssue({
      code: "custom",
      path: ["sourceActionRefs"],
      message: "能力证据必须由至少一个已记录真实行为直接支持",
    });
  }
});
export type CompetencyEvidenceEpisode = z.infer<
  typeof CompetencyEvidenceEpisodeSchema
>;

const CompetencyEstimateSchema = z.object({
  competencyClaimId: V2IdentifierSchema,
  evidenceStatus: z.enum([
    "insufficient",
    "supported",
    "mixed",
    "refuted",
  ]),
  competencyLevel: z.number().int().min(1).max(5).nullable(),
  score: z.number().min(0).max(100).nullable(),
  confidence: z.number().min(0).max(1),
  evidenceEpisodeRefs: z.array(V2IdentifierSchema).max(32),
  rationale: NonEmptyTextSchema.max(1_000),
}).strict().superRefine((estimate, context) => {
  if (estimate.evidenceStatus === "insufficient") {
    if (estimate.competencyLevel !== null
      || estimate.score !== null
      || estimate.evidenceEpisodeRefs.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["evidenceStatus"],
        message: "证据不足时不得伪造等级、分数或证据引用",
      });
    }
  } else if (estimate.competencyLevel === null
    || estimate.score === null
    || estimate.evidenceEpisodeRefs.length === 0) {
    context.addIssue({
      code: "custom",
      path: ["evidenceStatus"],
      message: "形成能力判断时必须给出等级、分数和真实证据引用",
    });
  }
});

export const AssessmentDecisionSchema = z.object({
  schemaVersion: z.literal(AssessmentDecisionSchemaVersion),
  assessmentDecisionId: V2IdentifierSchema,
  sessionId: V2IdentifierSchema,
  bindingId: V2IdentifierSchema,
  learnerTwinRef: V2IdentifierSchema,
  courseReleaseRef: CourseReleaseReferenceSchema,
  simulationReleaseRef: SimulationReleaseReferenceSchema,
  challengeAssignmentRef: V2IdentifierSchema,
  challengeLevel: ChallengeLevelSchema,
  scoreCeiling: ChallengeScoreCeilingSchema,
  completionStatus: z.enum([
    "not_started",
    "in_progress",
    "submitted",
    "completed",
  ]),
  scoreStatus: z.enum(["insufficient_evidence", "provisional", "final"]),
  sessionScore: z.number().min(0).max(100).nullable(),
  competencyEstimates: z.array(CompetencyEstimateSchema).min(1).max(32),
  evidenceEpisodeRefs: z.array(V2IdentifierSchema).max(64),
  growthSummary: NonEmptyTextSchema.max(1_200),
  nextGrowthTargets: z.array(V2IdentifierSchema).max(12),
  teacherReview: z.object({
    status: z.enum(["pending", "confirmed", "revised"]),
    reviewerId: V2IdentifierSchema.nullable(),
    reviewedAt: TimestampSchema.nullable(),
    reason: z.string().trim().max(1_000).nullable(),
  }).strict(),
  generatedAt: TimestampSchema,
}).strict().superRefine((decision, context) => {
  if (decision.scoreCeiling !== challengeScoreCeiling(decision.challengeLevel)) {
    context.addIssue({
      code: "custom",
      path: ["scoreCeiling"],
      message: "评价分数上限必须与本局挑战等级一致",
    });
  }
  if (decision.sessionScore !== null
    && decision.sessionScore > decision.scoreCeiling) {
    context.addIssue({
      code: "custom",
      path: ["sessionScore"],
      message: "本局原始分数不得突破已冻结挑战上限",
    });
  }
  if (decision.scoreStatus === "insufficient_evidence") {
    if (decision.sessionScore !== null || decision.evidenceEpisodeRefs.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["scoreStatus"],
        message: "证据不足时不得给出本局分数或伪造证据",
      });
    }
  } else if (decision.sessionScore === null
    || decision.evidenceEpisodeRefs.length === 0) {
    context.addIssue({
      code: "custom",
      path: ["scoreStatus"],
      message: "暂定或最终评价必须具有分数和真实证据",
    });
  }
  if (decision.scoreStatus === "final"
    && decision.teacherReview.status === "pending") {
    context.addIssue({
      code: "custom",
      path: ["teacherReview", "status"],
      message: "最终评价必须完成教师确认或修订",
    });
  }
  if (decision.teacherReview.status === "pending") {
    if (decision.teacherReview.reviewerId !== null
      || decision.teacherReview.reviewedAt !== null) {
      context.addIssue({
        code: "custom",
        path: ["teacherReview"],
        message: "待复核评价不得冒充已完成教师评审",
      });
    }
  } else if (decision.teacherReview.reviewerId === null
    || decision.teacherReview.reviewedAt === null
    || decision.teacherReview.reason === null) {
    context.addIssue({
      code: "custom",
      path: ["teacherReview"],
      message: "教师确认或修订必须保留身份、时间与理由",
    });
  }
  const decisionEvidence = new Set(decision.evidenceEpisodeRefs);
  for (const [index, estimate] of decision.competencyEstimates.entries()) {
    if (estimate.evidenceEpisodeRefs.some((ref) => !decisionEvidence.has(ref))) {
      context.addIssue({
        code: "custom",
        path: ["competencyEstimates", index, "evidenceEpisodeRefs"],
        message: "能力判断只能引用本评价已登记证据 Episode",
      });
    }
  }
});
export type AssessmentDecision = z.infer<typeof AssessmentDecisionSchema>;

const LearnerCompetencyStateSchema = z.object({
  competencyClaimId: V2IdentifierSchema,
  competencyLevel: z.number().int().min(1).max(5),
  confidence: z.number().min(0).max(1),
  supportingAssessmentRefs: z.array(V2IdentifierSchema).min(1).max(32),
  observedStrengths: z.array(NonEmptyTextSchema.max(320)).max(8),
  growthNeeds: z.array(NonEmptyTextSchema.max(320)).max(8),
  updatedAt: TimestampSchema,
}).strict();

const LearnerStrategyTendencySchema = z.object({
  tendencyId: z.enum([
    "evidence_first",
    "relationship_first",
    "speed_first",
    "risk_averse",
    "revision_responsive",
    "help_seeking",
  ]),
  observedRate: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  basisEvidenceRefs: z.array(V2IdentifierSchema).min(1).max(32),
  pedagogicalUse: NonEmptyTextSchema.max(500),
}).strict();

export const LearnerTwinProfileSchema = z.object({
  schemaVersion: z.literal(LearnerTwinProfileSchemaVersion),
  learnerTwinId: V2IdentifierSchema,
  principalBindingHash: V2ContentHashSchema,
  modelVersion: z.string().trim().min(1).max(120),
  modelContentHash: V2ContentHashSchema,
  profileContentHash: V2ContentHashSchema,
  revision: z.number().int().positive(),
  competencyStates: z.array(LearnerCompetencyStateSchema).min(1).max(32),
  strategyTendencies: z.array(LearnerStrategyTendencySchema).max(12),
  scaffoldingResponse: z.object({
    acceptedSuggestionRate: z.number().min(0).max(1),
    requestedEvidenceRate: z.number().min(0).max(1),
    rejectedSuggestionRate: z.number().min(0).max(1),
    productiveRevisionRate: z.number().min(0).max(1),
    basisEvidenceRefs: z.array(V2IdentifierSchema).min(1).max(64),
  }).strict(),
  recentChallengeHistory: z.array(z.object({
    challengeAssignmentRef: V2IdentifierSchema,
    challengeLevel: ChallengeLevelSchema,
    assessmentDecisionRef: V2IdentifierSchema,
    completedAt: TimestampSchema,
  }).strict()).max(12),
  nextCompetencyTargetRefs: z.array(V2IdentifierSchema).min(1).max(12),
  evidenceRefs: z.array(V2IdentifierSchema).min(1).max(120),
  confidence: z.number().min(0).max(1),
  immutablePersonalityLabel: z.null(),
  sensitiveAttributesExcluded: z.literal(true),
  appeal: z.object({
    status: z.enum(["none", "requested", "under_review", "resolved"]),
    appealRef: V2IdentifierSchema.nullable(),
    requestedAt: TimestampSchema.nullable(),
    resolvedAt: TimestampSchema.nullable(),
  }).strict(),
  updatedAt: TimestampSchema,
}).strict().superRefine((profile, context) => {
  addDuplicateIssues(
    profile.competencyStates.map((state) => state.competencyClaimId),
    ["competencyStates"],
    "学习者画像中的能力主张必须唯一",
    context,
  );
  addDuplicateIssues(
    profile.strategyTendencies.map((tendency) => tendency.tendencyId),
    ["strategyTendencies"],
    "学习策略倾向不得重复",
    context,
  );
  const responseTotal = profile.scaffoldingResponse.acceptedSuggestionRate
    + profile.scaffoldingResponse.requestedEvidenceRate
    + profile.scaffoldingResponse.rejectedSuggestionRate;
  if (responseTotal > 1.000_001) {
    context.addIssue({
      code: "custom",
      path: ["scaffoldingResponse"],
      message: "建议采纳、补证和拒绝比率之和不得超过 1",
    });
  }
  const appeal = profile.appeal;
  if (appeal.status === "none"
    && (appeal.appealRef !== null
      || appeal.requestedAt !== null
      || appeal.resolvedAt !== null)) {
    context.addIssue({
      code: "custom",
      path: ["appeal"],
      message: "无申诉状态不得携带申诉记录",
    });
  }
  if (appeal.status !== "none"
    && (appeal.appealRef === null || appeal.requestedAt === null)) {
    context.addIssue({
      code: "custom",
      path: ["appeal"],
      message: "申诉状态必须保留申诉引用与申请时间",
    });
  }
  if (appeal.status === "resolved" && appeal.resolvedAt === null) {
    context.addIssue({
      code: "custom",
      path: ["appeal", "resolvedAt"],
      message: "已解决申诉必须保留解决时间",
    });
  }
});
export type LearnerTwinProfile = z.infer<typeof LearnerTwinProfileSchema>;

const ForecastCandidateSchema = z.object({
  candidateId: V2IdentifierSchema,
  challengeLevel: ChallengeLevelSchema,
  worldVariantRef: V2IdentifierSchema,
  predictedActions: z.array(z.object({
    actionKind: z.enum([
      "observe",
      "ask",
      "probe",
      "inspect",
      "compare",
      "negotiate",
      "draft",
      "wait",
      "escalate",
      "submit",
    ]),
    probability: z.number().min(0).max(1),
  }).strict()).min(1).max(10),
  predictedSuccessProbability: z.number().min(0).max(1),
  predictedOverloadProbability: z.number().min(0).max(1),
  predictedGrowthValue: z.number().min(0).max(1),
  rationale: NonEmptyTextSchema.max(800),
}).strict().superRefine((candidate, context) => {
  const probabilityTotal = candidate.predictedActions.reduce(
    (sum, action) => sum + action.probability,
    0,
  );
  if (probabilityTotal > 1.000_001) {
    context.addIssue({
      code: "custom",
      path: ["predictedActions"],
      message: "预测行为概率之和不得超过 1",
    });
  }
});

export const LearnerSimulationForecastSchema = z.object({
  schemaVersion: z.literal(LearnerSimulationForecastSchemaVersion),
  forecastId: V2IdentifierSchema,
  learnerTwinRef: V2IdentifierSchema,
  learnerTwinRevision: z.number().int().positive(),
  learnerTwinContentHash: V2ContentHashSchema,
  simulationReleaseRef: SimulationReleaseReferenceSchema,
  forecastModelVersion: z.string().trim().min(1).max(120),
  forecastModelContentHash: V2ContentHashSchema,
  candidates: z.array(ForecastCandidateSchema).min(1).max(5),
  uncertainty: z.object({
    epistemic: z.number().min(0).max(1),
    behavioral: z.number().min(0).max(1),
    dataSufficiency: z.enum(["low", "medium", "high"]),
  }).strict(),
  evidenceEligible: z.literal(false),
  canActForStudent: z.literal(false),
  canScoreStudent: z.literal(false),
  calibration: z.object({
    status: z.enum(["pending", "evaluated"]),
    actualStudentActionRefs: z.array(V2IdentifierSchema).max(32),
    predictionError: z.number().min(0).max(1).nullable(),
    evaluatedAt: TimestampSchema.nullable(),
  }).strict(),
  generatedAt: TimestampSchema,
}).strict().superRefine((forecast, context) => {
  addDuplicateIssues(
    forecast.candidates.map((candidate) => candidate.candidateId),
    ["candidates"],
    "预测候选 ID 必须唯一",
    context,
  );
  if (forecast.calibration.status === "pending") {
    if (forecast.calibration.actualStudentActionRefs.length > 0
      || forecast.calibration.predictionError !== null
      || forecast.calibration.evaluatedAt !== null) {
      context.addIssue({
        code: "custom",
        path: ["calibration"],
        message: "待校准预测不得冒充已观察到真实学生行为",
      });
    }
  } else if (forecast.calibration.actualStudentActionRefs.length === 0
    || forecast.calibration.predictionError === null
    || forecast.calibration.evaluatedAt === null) {
    context.addIssue({
      code: "custom",
      path: ["calibration"],
      message: "完成校准必须记录真实行为、误差与时间",
    });
  }
});
export type LearnerSimulationForecast = z.infer<
  typeof LearnerSimulationForecastSchema
>;

export const ChallengeAssignmentSchema = z.object({
  schemaVersion: z.literal(ChallengeAssignmentSchemaVersion),
  challengeAssignmentId: V2IdentifierSchema,
  learnerTwinRef: V2IdentifierSchema,
  sessionId: V2IdentifierSchema,
  simulationReleaseRef: SimulationReleaseReferenceSchema,
  worldVariantRef: V2IdentifierSchema,
  previousChallengeLevel: ChallengeLevelSchema.nullable(),
  challengeLevel: ChallengeLevelSchema,
  scoreCeiling: ChallengeScoreCeilingSchema,
  pressureDimensions: z.array(z.object({
    dimensionId: z.enum([
      "time",
      "source_access",
      "relationship_conflict",
      "platform_risk",
      "copyright_risk",
      "editorial_pressure",
    ]),
    intensity: ChallengeLevelSchema,
  }).strict()).min(1).max(6),
  assignmentReason: z.enum([
    "initial_diagnostic",
    "evidence_progression",
    "evidence_recovery",
    "teacher_override",
  ]),
  basisEvidenceRefs: z.array(V2IdentifierSchema).max(64),
  forecastRef: V2IdentifierSchema.nullable(),
  teacherOverride: z.object({
    teacherId: V2IdentifierSchema,
    reason: NonEmptyTextSchema.max(1_000),
    decidedAt: TimestampSchema,
  }).strict().nullable(),
  policyVersion: z.string().trim().min(1).max(120),
  policyContentHash: V2ContentHashSchema,
  assignedAt: TimestampSchema,
}).strict().superRefine((assignment, context) => {
  if (assignment.scoreCeiling !== challengeScoreCeiling(assignment.challengeLevel)) {
    context.addIssue({
      code: "custom",
      path: ["scoreCeiling"],
      message: "挑战分配的分数上限必须与等级一致",
    });
  }
  if (assignment.previousChallengeLevel === null) {
    if (assignment.challengeLevel > 5
      || !(assignment.assignmentReason === "initial_diagnostic" || (assignment.assignmentReason === "teacher_override" && assignment.teacherOverride !== null))) {
      context.addIssue({
        code: "custom",
        path: ["challengeLevel"],
        message: "初始训练须采用3—5级课程基线或明确的教师设置",
      });
    }
  } else if (Math.abs(
    assignment.challengeLevel - assignment.previousChallengeLevel,
  ) > 1 && assignment.teacherOverride === null) {
    context.addIssue({
      code: "custom",
      path: ["challengeLevel"],
      message: "无教师覆写时挑战等级单次最多升降一级",
    });
  }
  if (assignment.assignmentReason === "initial_diagnostic"
    && assignment.basisEvidenceRefs.length > 0) {
    context.addIssue({
      code: "custom",
      path: ["basisEvidenceRefs"],
      message: "首次诊断不得伪装为已有学习证据",
    });
  }
  if (assignment.assignmentReason !== "initial_diagnostic"
    && assignment.assignmentReason !== "teacher_override"
    && assignment.basisEvidenceRefs.length === 0) {
    context.addIssue({
      code: "custom",
      path: ["basisEvidenceRefs"],
      message: "自动升降级必须有真实学习证据",
    });
  }
  if ((assignment.assignmentReason === "teacher_override")
    !== (assignment.teacherOverride !== null)) {
    context.addIssue({
      code: "custom",
      path: ["teacherOverride"],
      message: "教师覆写原因与覆写记录必须同时出现",
    });
  }
  addDuplicateIssues(
    assignment.pressureDimensions.map((dimension) => dimension.dimensionId),
    ["pressureDimensions"],
    "压力维度不得重复",
    context,
  );
});
export type ChallengeAssignment = z.infer<typeof ChallengeAssignmentSchema>;

export const PersonalizedLearningPlanSchema = z.object({
  schemaVersion: z.literal(PersonalizedLearningPlanSchemaVersion),
  learningPlanId: V2IdentifierSchema,
  learnerTwinRef: V2IdentifierSchema,
  sourceAssessmentDecisionRef: V2IdentifierSchema,
  sourceChallengeAssignmentRef: V2IdentifierSchema,
  status: z.enum([
    "proposed",
    "teacher_confirmed",
    "active",
    "completed",
    "retired",
  ]),
  targetCompetencies: z.array(z.object({
    competencyClaimId: V2IdentifierSchema,
    currentLevel: z.number().int().min(1).max(5),
    targetLevel: z.number().int().min(1).max(5),
    evidenceRefs: z.array(V2IdentifierSchema).min(1).max(32),
    practiceIntent: NonEmptyTextSchema.max(800),
    successEvidence: NonEmptyTextSchema.max(800),
  }).strict()).min(1).max(12),
  recommendedChallengeLevel: ChallengeLevelSchema,
  recommendedWorldVariantRefs: z.array(V2IdentifierSchema).min(1).max(8),
  scaffoldingActions: z.array(z.object({
    actionId: V2IdentifierSchema,
    title: NonEmptyTextSchema.max(200),
    triggerCondition: NonEmptyTextSchema.max(500),
    fadeCondition: NonEmptyTextSchema.max(500),
  }).strict()).max(12),
  learnerChoiceRefs: z.array(V2IdentifierSchema).max(12),
  teacherConfirmation: z.object({
    teacherId: V2IdentifierSchema,
    confirmedAt: TimestampSchema,
    note: NonEmptyTextSchema.max(1_000),
  }).strict().nullable(),
  reviewDueAt: TimestampSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
}).strict().superRefine((plan, context) => {
  addDuplicateIssues(
    plan.targetCompetencies.map((target) => target.competencyClaimId),
    ["targetCompetencies"],
    "个性化方案能力目标不得重复",
    context,
  );
  plan.targetCompetencies.forEach((target, index) => {
    if (target.targetLevel < target.currentLevel) {
      context.addIssue({
        code: "custom",
        path: ["targetCompetencies", index, "targetLevel"],
        message: "个性化成长目标不得低于当前能力等级",
      });
    }
  });
  if (["teacher_confirmed", "active", "completed"].includes(plan.status)
    && plan.teacherConfirmation === null) {
    context.addIssue({
      code: "custom",
      path: ["teacherConfirmation"],
      message: "进入执行链的个性化方案必须由教师确认",
    });
  }
  if (plan.status === "proposed" && plan.teacherConfirmation !== null) {
    context.addIssue({
      code: "custom",
      path: ["teacherConfirmation"],
      message: "待确认方案不得冒充已获教师确认",
    });
  }
  if (plan.updatedAt < plan.createdAt || plan.reviewDueAt < plan.createdAt) {
    context.addIssue({
      code: "custom",
      path: ["reviewDueAt"],
      message: "个性化方案时间线必须单向推进",
    });
  }
});
export type PersonalizedLearningPlan = z.infer<
  typeof PersonalizedLearningPlanSchema
>;
