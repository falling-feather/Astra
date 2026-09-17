import { z } from "zod";
import {
  V2ContentHashSchema,
  V2IdentifierSchema,
} from "./course-learning.js";
import {
  AssessmentCriterionIdV4Schema,
  BlindEvidenceAssessmentInputV4Schema,
  EvidenceAssessmentDecisionV4Schema,
} from "./media-assessment-adaptation-v4.js";

export const FlagshipAssessmentViewV4SchemaVersion =
  "flagship-assessment-view/4.0.0" as const;
export const FlagshipAssessmentAdminCaseV4SchemaVersion =
  "flagship-assessment-admin-case/4.0.0" as const;

const TimestampSchema = z.string().datetime();
const NonEmptyTextSchema = z.string().trim().min(1);
const AssessmentStatusSchema = z.enum([
  "not_ready",
  "insufficient_evidence",
  "provisional",
  "final",
]);
const EvidenceStatusSchema = z.enum([
  "insufficient",
  "supported",
  "mixed",
  "refuted",
]);
const AssessmentBandSchema = z.enum(["low", "medium", "high"]);

export const LearningObservationV4Schema = z.object({
  observationId: V2IdentifierSchema, criterionId: AssessmentCriterionIdV4Schema,
  status: z.enum(["observed", "needs_review", "gap", "conflict"]),
  title: NonEmptyTextSchema.max(240), detail: NonEmptyTextSchema.max(2_000),
  evidenceRefs: z.array(V2IdentifierSchema).max(64),
  workExcerpt: z.string().max(700).nullable(), sourceExcerpt: z.string().max(700).nullable(),
}).strict();
export type LearningObservationV4 = z.infer<typeof LearningObservationV4Schema>;

export const EvidenceAssessmentCriterionViewV4Schema = z.object({
  criterionId: AssessmentCriterionIdV4Schema,
  title: NonEmptyTextSchema.max(160),
  evidenceStatus: EvidenceStatusSchema,
  band: AssessmentBandSchema.nullable(),
  score: z.number().min(0).max(100).nullable(),
  confidence: z.number().min(0).max(1),
  rationale: NonEmptyTextSchema.max(1_000),
}).strict().superRefine((criterion, context) => {
  const insufficient = criterion.evidenceStatus === "insufficient";
  if (insufficient !== (criterion.band === null && criterion.score === null)) {
    context.addIssue({
      code: "custom",
      path: ["evidenceStatus"],
      message: "证据不足的公开维度不得携带档位或分数",
    });
  }
});
export type EvidenceAssessmentCriterionViewV4 = z.infer<
  typeof EvidenceAssessmentCriterionViewV4Schema
>;

const EvidenceCoverageV4Schema = z.object({
  artifactRevisionCount: z.number().int().nonnegative(),
  claimLinkCount: z.number().int().nonnegative(),
  behaviorCount: z.number().int().nonnegative(),
  consequenceCount: z.number().int().nonnegative(),
  recoveryPairCount: z.number().int().nonnegative(),
}).strict();

const AssessmentRubricViewV4Schema = z.object({
  version: NonEmptyTextSchema.max(120),
  reviewStatus: z.enum(["pending_expert_review", "verified"]),
  classroomApplicabilityConfirmed: z.boolean(),
  externalExpertValidityEstablished: z.literal(false),
}).strict();

function requireAllCriteria(
  criteria: ReadonlyArray<{ criterionId: z.infer<typeof AssessmentCriterionIdV4Schema> }>,
  context: z.RefinementCtx,
): void {
  const criterionIds = criteria.map((criterion) => criterion.criterionId);
  if (
    new Set(criterionIds).size !== AssessmentCriterionIdV4Schema.options.length
    || AssessmentCriterionIdV4Schema.options.some(
      (criterionId) => !criterionIds.includes(criterionId),
    )
  ) {
    context.addIssue({
      code: "custom",
      path: ["criteria"],
      message: "公开评价必须且只能覆盖冻结的六个岗位能力维度",
    });
  }
}

export const FlagshipEvidenceAssessmentViewV4Schema = z.object({
  schemaVersion: z.literal(FlagshipAssessmentViewV4SchemaVersion),
  status: AssessmentStatusSchema,
  safeMessage: NonEmptyTextSchema.max(1_000),
  decision: EvidenceAssessmentDecisionV4Schema.nullable(),
  criteria: z.array(EvidenceAssessmentCriterionViewV4Schema).length(6),
  evidenceCoverage: EvidenceCoverageV4Schema,
  rubric: AssessmentRubricViewV4Schema,
  teacherReviewAllowed: z.boolean(),
  assessmentBasis:z.literal('submitted_work').optional(),
  retryAvailable:z.boolean().optional(),
  audience: z.enum(["student", "teacher", "admin"]),
  learningObservations: z.array(LearningObservationV4Schema).max(512).optional(),
}).strict().superRefine((view, context) => {
  requireAllCriteria(view.criteria, context);
  const notReady = view.status === "not_ready";
  if (notReady !== (view.decision === null)) {
    context.addIssue({
      code: "custom",
      path: ["decision"],
      message: "公开评价空态必须与评价决定同时出现或同时缺失",
    });
  }
  if (view.decision !== null && view.decision.status !== view.status) {
    context.addIssue({
      code: "custom",
      path: ["status"],
      message: "公开评价状态必须与冻结评价决定一致",
    });
  }
  if (view.teacherReviewAllowed && (
    view.audience === "student"
    || view.status === "not_ready"
    || view.status === "final"
    || view.decision?.teacherReview.status !== "pending"
  )) {
    context.addIssue({
      code: "custom",
      path: ["teacherReviewAllowed"],
      message: "只有教师或管理员能对待终裁评价发起复核",
    });
  }
});
export type FlagshipEvidenceAssessmentViewV4 = z.infer<
  typeof FlagshipEvidenceAssessmentViewV4Schema
>;

export const FlagshipEvidenceAssessmentResponseV4Schema = z.object({
  assessment: FlagshipEvidenceAssessmentViewV4Schema,
}).strict();
export type FlagshipEvidenceAssessmentResponseV4 = z.infer<
  typeof FlagshipEvidenceAssessmentResponseV4Schema
>;

export const StructuredAssessmentEvidenceFactViewV4Schema = z.object({
  evidenceRef: V2IdentifierSchema,
  sourceKind: z.enum([
    "artifact_revision",
    "claim_evidence",
    "student_behavior",
    "world_consequence",
    "scaffolding",
    "recovery_pair",
  ]),
  evidenceCode: NonEmptyTextSchema.max(160),
  independenceKey: V2IdentifierSchema,
  sourceContentHash: V2ContentHashSchema,
}).strict();
export type StructuredAssessmentEvidenceFactViewV4 = z.infer<
  typeof StructuredAssessmentEvidenceFactViewV4Schema
>;

export const BlindCriterionJudgmentViewV4Schema = z.object({
  criterionId: AssessmentCriterionIdV4Schema,
  evidenceStatus: EvidenceStatusSchema,
  band: AssessmentBandSchema.nullable(),
  score: z.number().min(0).max(100).nullable(),
  confidence: z.number().min(0).max(1),
  evidenceRefs: z.array(V2IdentifierSchema).max(32),
  rationale: NonEmptyTextSchema.max(1_000),
  surfaceSignalsUsed: z.literal(false),
}).strict().superRefine((judgment, context) => {
  const insufficient = judgment.evidenceStatus === "insufficient";
  if (insufficient !== (
    judgment.band === null
    && judgment.score === null
    && judgment.evidenceRefs.length === 0
  )) {
    context.addIssue({
      code: "custom",
      path: ["evidenceStatus"],
      message: "盲评证据不足不得给出档位、分数或证据引用",
    });
  }
});

export const WorkQualityAssessmentRunReceiptV4Schema = z.object({
  qualityRunRef: V2IdentifierSchema,
  inputHash: V2ContentHashSchema,
  outputHash: V2ContentHashSchema,
  mode: z.enum(["independent_live_agent", "deterministic_fallback"]),
  fallbackReason: z.enum([
    "evidence_insufficient",
    "model_not_configured",
    "model_timeout",
    "model_error",
    "model_invalid_output",
    "model_cost_exceeded",
    "media_not_eligible",
    "media_unavailable",
    "media_observation_incomplete",
  ]).nullable(),
  providerId: NonEmptyTextSchema.max(100).nullable(),
  modelId: NonEmptyTextSchema.max(200).nullable(),
  traceRef: V2IdentifierSchema.nullable(),
  latencyMs: z.number().nonnegative().nullable(),
  estimatedCostMicros: z.number().int().nonnegative(),
  mediaObservation: z.object({
    preparationStatus: z.enum([
      "not_applicable",
      "ready",
      "incomplete",
      "not_eligible",
    ]),
    expectedAssetCount: z.number().int().nonnegative().max(24),
    preparedInputCount: z.number().int().nonnegative().max(12),
    representationKinds: z.array(z.enum([
      "image_preview",
      "audio_spectrogram",
      "video_keyframe",
    ])).max(12),
    inputContentHashes: z.array(V2ContentHashSchema).max(12),
    providerInvocationIncludedMedia: z.boolean(),
    limitations: z.array(NonEmptyTextSchema.max(500)).max(8),
  }).strict().default({
    preparationStatus: "not_applicable",
    expectedAssetCount: 0,
    preparedInputCount: 0,
    representationKinds: [],
    inputContentHashes: [],
    providerInvocationIncludedMedia: false,
    limitations: [],
  }),
  createdAt: TimestampSchema,
}).strict().superRefine((receipt, context) => {
  const providerFields = [
    receipt.providerId,
    receipt.modelId,
    receipt.traceRef,
    receipt.latencyMs,
  ];
  if (!(providerFields.every((field) => field === null)
    || providerFields.every((field) => field !== null))) {
    context.addIssue({
      code: "custom",
      path: ["providerId"],
      message: "作品质量模型运行字段必须同时存在或同时为空",
    });
  }
  if (receipt.mode === "independent_live_agent"
    && (receipt.fallbackReason !== null || receipt.providerId === null)) {
    context.addIssue({
      code: "custom",
      path: ["mode"],
      message: "Live 作品质量判断必须有运行收据且不得携带降级原因",
    });
  }
  if (receipt.mode === "deterministic_fallback" && receipt.fallbackReason === null) {
    context.addIssue({
      code: "custom",
      path: ["fallbackReason"],
      message: "确定性作品质量判断必须说明降级原因",
    });
  }
  if (receipt.mediaObservation.preparedInputCount
      !== receipt.mediaObservation.inputContentHashes.length
    || receipt.mediaObservation.preparedInputCount
      !== receipt.mediaObservation.representationKinds.length) {
    context.addIssue({
      code: "custom",
      path: ["mediaObservation", "preparedInputCount"],
      message: "多模态观察输入数量、类型与哈希必须逐项对应",
    });
  }
  if (receipt.mediaObservation.preparationStatus === "ready"
    && (receipt.mediaObservation.expectedAssetCount === 0
      || receipt.mediaObservation.preparedInputCount === 0)) {
    context.addIssue({
      code: "custom",
      path: ["mediaObservation", "preparationStatus"],
      message: "多模态输入就绪必须包含真实资产与派生观察输入",
    });
  }
  if (receipt.mediaObservation.providerInvocationIncludedMedia
    && receipt.mediaObservation.preparedInputCount === 0) {
    context.addIssue({
      code: "custom",
      path: ["mediaObservation", "providerInvocationIncludedMedia"],
      message: "没有准备真实媒体输入时不得声称供应方已经观察媒体",
    });
  }
  if (receipt.mediaObservation.preparationStatus === "not_applicable"
    && (receipt.mediaObservation.expectedAssetCount !== 0
      || receipt.mediaObservation.preparedInputCount !== 0)) {
    context.addIssue({
      code: "custom",
      path: ["mediaObservation", "preparationStatus"],
      message: "无媒体场景不得携带预期资产或观察输入",
    });
  }
  if (receipt.mediaObservation.preparationStatus === "not_eligible"
    && (receipt.mediaObservation.preparedInputCount !== 0
      || receipt.mediaObservation.providerInvocationIncludedMedia)) {
    context.addIssue({
      code: "custom",
      path: ["mediaObservation", "preparationStatus"],
      message: "未通过权利门时不得携带媒体输入或声称已发送供应方",
    });
  }
  if (receipt.mode === "independent_live_agent"
    && receipt.mediaObservation.expectedAssetCount > 0
    && (receipt.mediaObservation.preparationStatus !== "ready"
      || !receipt.mediaObservation.providerInvocationIncludedMedia)) {
    context.addIssue({
      code: "custom",
      path: ["mediaObservation"],
      message: "含媒体资产的 Live 质量判断必须证明真实表示已进入供应方调用",
    });
  }
});
export type WorkQualityAssessmentRunReceiptV4 = z.infer<
  typeof WorkQualityAssessmentRunReceiptV4Schema
>;

const AssessmentDecisionHistoryEntryV4Schema = z.object({
  sourceHash: V2ContentHashSchema,
  decision: EvidenceAssessmentDecisionV4Schema,
}).strict();

export const AssessmentReviewReceiptV4Schema = z.object({
  requestId: V2IdentifierSchema,
  requestHash: V2ContentHashSchema,
  sourceAssessmentDecisionId: V2IdentifierSchema,
  resultAssessmentDecisionId: V2IdentifierSchema,
  reviewerId: V2IdentifierSchema,
  status: z.enum(["confirmed", "revised"]),
  rubricApplicabilityConfirmed: z.literal(true),
  changedCriterionIds: z.array(AssessmentCriterionIdV4Schema).max(6),
  createdAt: TimestampSchema,
}).strict();
export type AssessmentReviewReceiptV4 = z.infer<
  typeof AssessmentReviewReceiptV4Schema
>;

export const FlagshipEvidenceAssessmentAdminCaseV4Schema = z.object({
  schemaVersion: z.literal(FlagshipAssessmentAdminCaseV4SchemaVersion),
  sessionId: V2IdentifierSchema,
  sourceHash: V2ContentHashSchema,
  blindInput: BlindEvidenceAssessmentInputV4Schema,
  evidenceFacts: z.array(StructuredAssessmentEvidenceFactViewV4Schema).max(256),
  blindJudgments: z.array(BlindCriterionJudgmentViewV4Schema).length(6),
  rawWeightedScore: z.number().min(0).max(100).nullable(),
  scoreCeiling: z.union([
    z.literal(80),
    z.literal(85),
    z.literal(90),
    z.literal(95),
    z.literal(100),
  ]),
  qualityRuns: z.array(WorkQualityAssessmentRunReceiptV4Schema).max(128),
  decisionHistory: z.array(AssessmentDecisionHistoryEntryV4Schema).min(1).max(128),
  reviewReceipts: z.array(AssessmentReviewReceiptV4Schema).max(128),
  antiGaming: z.object({
    surfaceSignalsUsed: z.literal(false),
    adviceAgentExcluded: z.literal(true),
    challengeAppliedAfterBlindAssessment: z.literal(true),
  }).strict(),
}).strict().superRefine((assessmentCase, context) => {
  requireAllCriteria(
    assessmentCase.blindJudgments.map(({ criterionId }) => ({ criterionId })),
    context,
  );
  const latestDecision = assessmentCase.decisionHistory.at(-1)?.decision;
  const latestQualityRun = assessmentCase.qualityRuns.at(-1);
  if (latestQualityRun && latestDecision
    && latestQualityRun.mode !== latestDecision.assessorMode) {
    context.addIssue({
      code: "custom",
      path: ["qualityRuns"],
      message: "作品质量运行模式必须与当前盲评决定一致",
    });
  }
});
export type FlagshipEvidenceAssessmentAdminCaseV4 = z.infer<
  typeof FlagshipEvidenceAssessmentAdminCaseV4Schema
>;

export const FlagshipEvidenceAssessmentAdminCaseResponseV4Schema = z.object({
  assessmentCase: FlagshipEvidenceAssessmentAdminCaseV4Schema,
}).strict();
export type FlagshipEvidenceAssessmentAdminCaseResponseV4 = z.infer<
  typeof FlagshipEvidenceAssessmentAdminCaseResponseV4Schema
>;
