import { z } from "zod";
import {
  AssessmentCriterionIdV4Schema,
  SecondSessionHandoffV4Schema,
} from "./media-assessment-adaptation-v4.js";
import {
  LearnerCalibrationPublicSummaryV4Schema,
  LearnerCalibrationDisplayPolicyVersionV4Schema,
  LearnerCalibrationOutcomeV4Schema,
  LearnerCalibrationObservationWindowPlanV4Schema,
} from "./learner-calibration-v4.js";

export const LearnerAdaptationViewV4SchemaVersion =
  "learner-adaptation-view/4.0.0" as const;
export const LearnerAdaptationAdminCaseV4SchemaVersion =
  "learner-adaptation-admin-case/4.0.0" as const;

export const AdaptiveSecondSessionIdV4Schema = z.string().regex(
  /^training-adaptive-v4-[a-f0-9]{24}$/u,
  "V4 第二场会话必须使用服务端签发的冻结命名空间",
);
export type AdaptiveSecondSessionIdV4 = z.infer<
  typeof AdaptiveSecondSessionIdV4Schema
>;

const IdSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/@-]*$/u);
const HashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const TimestampSchema = z.string().datetime();
const NonEmptyTextSchema = z.string().trim().min(1);

export const LearnerUncertaintyDriverV4Schema = z.enum([
  "limited_evidence",
  "mixed_evidence",
  "refuting_evidence",
  "teacher_revision",
  "cross_session_prediction_error",
]);
export type LearnerUncertaintyDriverV4 = z.infer<
  typeof LearnerUncertaintyDriverV4Schema
>;

export const LearnerAssessorModeV4Schema = z.enum([
  "independent_live_agent",
  "deterministic_fallback",
]);
export type LearnerAssessorModeV4 = z.infer<
  typeof LearnerAssessorModeV4Schema
>;

const PublicCriterionV4Schema = z.object({
  criterionId: AssessmentCriterionIdV4Schema,
  title: NonEmptyTextSchema.max(160),
  band: z.enum(["low", "medium", "high"]),
  score: z.number().min(0).max(100),
  confidence: z.number().min(0).max(1),
  evidenceCount: z.number().int().nonnegative(),
  supportEvidenceCount: z.number().int().nonnegative(),
  counterEvidenceCount: z.number().int().nonnegative(),
  uncertaintyDrivers: z.array(LearnerUncertaintyDriverV4Schema).max(5),
  lastPredictionError: z.number().min(0).max(1).nullable(),
  growthTarget: z.boolean(),
}).strict().superRefine((criterion, context) => {
  if (
    criterion.supportEvidenceCount + criterion.counterEvidenceCount
    > criterion.evidenceCount
  ) {
    context.addIssue({
      code: "custom",
      path: ["supportEvidenceCount"],
      message: "学习者模型的支持与反证计数不得超过证据总数",
    });
  }
});

const PublicLearnerModelV4Schema = z.object({
  revision: z.number().int().positive(),
  calibrationCount: z.number().int().nonnegative(),
  evidenceBased: z.literal(true),
  personalityDiagnosis: z.literal(false),
  limitations: z.array(NonEmptyTextSchema.max(500)).min(1).max(8),
  criteria: z.array(PublicCriterionV4Schema).length(6),
}).strict().superRefine((model, context) => {
  const criterionIds = model.criteria.map((criterion) => criterion.criterionId);
  if (
    new Set(criterionIds).size !== AssessmentCriterionIdV4Schema.options.length
    || AssessmentCriterionIdV4Schema.options.some(
      (criterionId) => !criterionIds.includes(criterionId),
    )
  ) {
    context.addIssue({
      code: "custom",
      path: ["criteria"],
      message: "公开学习者模型必须且只能覆盖冻结的六项可观察能力",
    });
  }
});

const PublicForecastV4Schema = z.object({
  mode: LearnerAssessorModeV4Schema,
  revision: z.number().int().positive(),
  candidateCount: z.number().int().positive(),
  selectedVariantRef: IdSchema,
  evidenceEligibleForScore: z.literal(false),
  canActForStudent: z.literal(false),
}).strict();

const PublicProposalV4Schema = z.object({
  handoffId: IdSchema,
  variantRef: IdSchema,
  title: NonEmptyTextSchema.max(240),
  sourceChallengeLevel: z.number().int().min(3).max(7),
  targetChallengeLevel: z.number().int().min(3).max(7),
  growthTargets: z.array(z.object({
    criterionId: AssessmentCriterionIdV4Schema,
    title: NonEmptyTextSchema.max(160),
  }).strict()).min(1).max(3),
  changedMechanics: z.array(z.object({
    mechanicKind: NonEmptyTextSchema.max(120),
    safeSummary: NonEmptyTextSchema.max(600),
  }).strict()).min(1).max(8),
  successEvidence: z.array(NonEmptyTextSchema.max(500)).min(1).max(12),
  observationWindow: LearnerCalibrationObservationWindowPlanV4Schema.optional(),
}).strict();

const PublicConsentV4Schema = z.object({
  status: z.enum(["pending", "accepted", "declined"]),
  requestId: IdSchema.nullable(),
  decidedAt: TimestampSchema.nullable(),
}).strict();

const PublicAppealV4Schema = z.object({
  status: z.enum(["none", "open", "resolved"]),
  appealRef: IdSchema.nullable(),
  reason: NonEmptyTextSchema.max(1_000).nullable(),
  resolution: z.enum(["confirmed", "reopen_assessment"]).nullable(),
  teacherReason: NonEmptyTextSchema.max(1_000).nullable(),
}).strict();

const PublicHandoffV4Schema = z.object({
  status: z.enum([
    "not_eligible",
    "proposed",
    "authorized",
    "provisioned",
    "calibration_completed",
    "failed",
  ]),
  sessionRef: IdSchema.nullable(),
  bindingRef: IdSchema.nullable(),
  calibration: z.object({
    actionCount: z.number().int().nonnegative(),
    forecastError: z.number().min(0).max(1),
    evidenceEligibleForScore: z.literal(false),
    calibratedAt: TimestampSchema,
  }).merge(LearnerCalibrationPublicSummaryV4Schema.partial()).strict().nullable(),
}).strict();

export const LearnerAdaptationPublicBoundariesV4Schema = z.object({
  observableEvidenceOnly: z.literal(true),
  immutablePersonalityLabelsForbidden: z.literal(true),
  sensitiveAttributesExcluded: z.literal(true),
  studentConsentRequired: z.literal(true),
  teacherAuthorizationRequired: z.literal(true),
  proxyCanActForStudent: z.literal(false),
  proxyCanCreateEvidence: z.literal(false),
  proxyCanScoreStudent: z.literal(false),
  calibrationEvidenceEligibleForScore: z.literal(false),
}).strict();

export const LearnerAdaptationViewV4Schema = z.object({
  schemaVersion: z.literal(LearnerAdaptationViewV4SchemaVersion),
  audience: z.enum(["student", "teacher"]),
  state: z.enum([
    "evidence_required",
    "proposed",
    "consented",
    "appeal_open",
    "provisioned",
    "calibrated",
    "failed",
  ]),
  safeMessage: NonEmptyTextSchema.max(1_200),
  boundaries: LearnerAdaptationPublicBoundariesV4Schema,
  learnerModel: PublicLearnerModelV4Schema.nullable(),
  forecast: PublicForecastV4Schema.nullable(),
  proposal: PublicProposalV4Schema.nullable(),
  consent: PublicConsentV4Schema.nullable(),
  appeal: PublicAppealV4Schema.nullable(),
  handoff: PublicHandoffV4Schema.nullable(),
  nextAction: NonEmptyTextSchema.max(800),
}).strict().superRefine((view, context) => {
  const absent = [
    view.learnerModel,
    view.forecast,
    view.proposal,
    view.consent,
    view.appeal,
    view.handoff,
  ].every((value) => value === null);
  if ((view.state === "evidence_required") !== absent) {
    context.addIssue({
      code: "custom",
      path: ["state"],
      message: "证据不足状态必须与全部自适应数据为空保持一致",
    });
  }
  if (
    view.state !== "evidence_required"
    && (
      view.learnerModel === null
      || view.forecast === null
      || view.consent === null
      || view.appeal === null
      || view.handoff === null
    )
  ) {
    context.addIssue({
      code: "custom",
      path: ["state"],
      message: "已生成的自适应状态必须具备完整模型、预测与控制状态",
    });
  }
  if (
    view.audience === "teacher"
    && view.handoff !== null
    && view.handoff.bindingRef !== null
  ) {
    context.addIssue({
      code: "custom",
      path: ["handoff", "bindingRef"],
      message: "教师视图不得取得学生第二场绑定引用",
    });
  }
  if (
    (view.state === "provisioned" || view.state === "calibrated")
    && view.handoff?.sessionRef === null
  ) {
    context.addIssue({
      code: "custom",
      path: ["handoff", "sessionRef"],
      message: "已创建第二场必须携带真实会话引用",
    });
  }
  if (view.state === "calibrated" && view.handoff?.calibration === null) {
    context.addIssue({
      code: "custom",
      path: ["handoff", "calibration"],
      message: "已校准状态必须携带非评分校准回执",
    });
  }
});
export type LearnerAdaptationViewV4 = z.infer<
  typeof LearnerAdaptationViewV4Schema
>;

export const LearnerAdaptationResponseV4Schema = z.object({
  adaptation: LearnerAdaptationViewV4Schema,
}).strict();
export type LearnerAdaptationResponseV4 = z.infer<
  typeof LearnerAdaptationResponseV4Schema
>;

const AuditCriterionV4Schema = z.object({
  criterionId: AssessmentCriterionIdV4Schema,
  evidenceStatus: z.enum(["supported", "mixed", "refuted"]),
  band: z.enum(["low", "medium", "high"]),
  score: z.number().min(0).max(100),
  confidence: z.number().min(0).max(1),
  evidenceRefs: z.array(IdSchema).min(1).max(32),
  supportEvidenceRefs: z.array(IdSchema).max(32),
  counterEvidenceRefs: z.array(IdSchema).max(32),
  uncertaintyDrivers: z.array(LearnerUncertaintyDriverV4Schema).max(5),
  lastPredictionError: z.number().min(0).max(1).nullable(),
}).strict();

const CalibrationHistoryEntryV4Schema = z.object({
  calibrationRef: IdSchema,
  variantRef: IdSchema,
  predictedSuccessProbability: z.number().min(0).max(1),
  observedBehaviorAlignment: z.number().min(0).max(1),
  absolutePredictionError: z.number().min(0).max(1),
  actionEvidenceHash: HashSchema,
  policyVersion: LearnerCalibrationDisplayPolicyVersionV4Schema.optional(),
  outcome: LearnerCalibrationOutcomeV4Schema.optional(),
  observationEvidenceHash: HashSchema.optional(),
  calibratedAt: TimestampSchema,
}).strict();

const LearnerTwinAuditV4Schema = z.object({
  learnerTwinRef: IdSchema,
  revision: z.number().int().positive(),
  sourceAssessmentDecisionRef: IdSchema,
  criterionStates: z.array(AuditCriterionV4Schema).length(6),
  growthTargetRefs: z.array(AssessmentCriterionIdV4Schema).min(1).max(3),
  sourceChallengeLevel: z.number().int().min(3).max(7),
  sourceScaffoldingLevel: z.number().int().min(0).max(3),
  calibrationCount: z.number().int().nonnegative(),
  calibrationHistory: z.array(CalibrationHistoryEntryV4Schema).max(16),
  limitations: z.array(NonEmptyTextSchema.max(500)).min(1).max(8),
  contentHash: HashSchema,
  updatedAt: TimestampSchema,
}).strict();

const ForecastCandidateAuditV4Schema = z.object({
  variantRef: IdSchema,
  predictedSuccessProbability: z.number().min(0).max(1),
  predictedOverloadProbability: z.number().min(0).max(1),
  predictedGrowthValue: z.number().min(0).max(1),
  rationale: NonEmptyTextSchema.max(600),
}).strict();

const LearnerForecastAuditV4Schema = z.object({
  forecastRef: IdSchema,
  revision: z.number().int().positive(),
  assessorMode: LearnerAssessorModeV4Schema,
  learnerTwinContentHash: HashSchema,
  candidates: z.array(ForecastCandidateAuditV4Schema).length(4),
  selectedVariantRef: IdSchema,
  evidenceEligibleForScore: z.literal(false),
  canActForStudent: z.literal(false),
  generatedAt: TimestampSchema,
}).strict();

const AdminAppealV4Schema = PublicAppealV4Schema.extend({
  openedAt: TimestampSchema.nullable(),
  resolvedAt: TimestampSchema.nullable(),
}).strict();

const ProxyRunReceiptV4Schema = z.object({
  proxyRunRef: IdSchema,
  inputHash: HashSchema,
  outputHash: HashSchema,
  mode: LearnerAssessorModeV4Schema,
  fallbackReason: z.enum([
    "model_not_configured",
    "model_timeout",
    "model_error",
    "model_invalid_output",
    "model_cost_exceeded",
  ]).nullable(),
  providerId: NonEmptyTextSchema.max(100).nullable(),
  modelId: NonEmptyTextSchema.max(200).nullable(),
  traceRef: IdSchema.nullable(),
  latencyMs: z.number().nonnegative().nullable(),
  estimatedCostMicros: z.number().int().nonnegative(),
  createdAt: TimestampSchema,
}).strict();

const RequestReceiptV4Schema = z.object({
  requestId: IdSchema,
  requestHash: HashSchema,
  operation: z.enum([
    "record_consent",
    "open_appeal",
    "review_appeal",
    "authorize_second_session",
  ]),
  resultRef: IdSchema,
  createdAt: TimestampSchema,
}).strict();

const AdminBoundariesV4Schema = z.object({
  rawLearnerIdentityStored: z.literal(false),
  rawStudentUtteranceStored: z.literal(false),
  sensitiveAttributesExcluded: z.literal(true),
  proxyCanActForStudent: z.literal(false),
  proxyCanCreateEvidence: z.literal(false),
  proxyCanScoreStudent: z.literal(false),
  calibrationEvidenceEligibleForScore: z.literal(false),
}).strict();

export const LearnerAdaptationAdminCaseV4Schema = z.object({
  schemaVersion: z.literal(LearnerAdaptationAdminCaseV4SchemaVersion),
  sourceSessionId: IdSchema,
  learnerSubjectHash: HashSchema,
  sourceAssessmentDecisionRef: IdSchema,
  sourceAssessmentHash: HashSchema,
  learnerTwin: LearnerTwinAuditV4Schema,
  forecast: LearnerForecastAuditV4Schema,
  consent: PublicConsentV4Schema,
  appeal: AdminAppealV4Schema,
  handoff: SecondSessionHandoffV4Schema,
  proxyRuns: z.array(ProxyRunReceiptV4Schema).max(32),
  requestReceipts: z.array(RequestReceiptV4Schema).max(128),
  boundaries: AdminBoundariesV4Schema,
}).strict();
export type LearnerAdaptationAdminCaseV4 = z.infer<
  typeof LearnerAdaptationAdminCaseV4Schema
>;

export const LearnerAdaptationAdminCaseResponseV4Schema = z.object({
  adaptationCase: LearnerAdaptationAdminCaseV4Schema.nullable(),
}).strict();
export type LearnerAdaptationAdminCaseResponseV4 = z.infer<
  typeof LearnerAdaptationAdminCaseResponseV4Schema
>;
