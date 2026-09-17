import { z } from "zod";
import {
  CourseReleaseReferenceSchema,
  ScenarioReleaseReferenceSchema,
  V2ContentHashSchema,
  V2IdentifierSchema,
} from "./course-learning.js";
import {
  ChallengeLevelSchema,
  SimulationReleaseReferenceSchema,
} from "./world-simulation-v3.js";
import { FlagshipContentReferenceV4Schema } from "./flagship-world-v4.js";
import {
  LearnerCalibrationDisplayPolicyVersionV4Schema,
  LearnerCalibrationEvidenceRefsV4Schema,
  LearnerCalibrationOutcomeV4Schema,
  LearnerCalibrationObservationWindowPlanV4Schema,
  LearnerCalibrationObservationWindowV4Schema,
} from "./learner-calibration-v4.js";

export const MediaWorkRevisionV4SchemaVersion =
  "media-work-revision/4.0.0" as const;
export const BlindEvidenceAssessmentInputV4SchemaVersion =
  "blind-evidence-assessment-input/4.0.0" as const;
export const EvidenceAssessmentDecisionV4SchemaVersion =
  "evidence-assessment-decision/4.0.0" as const;
export const SecondSessionHandoffV4SchemaVersion =
  "second-session-handoff/4.0.0" as const;

const TimestampSchema = z.string().datetime();
const NonEmptyTextSchema = z.string().trim().min(1);

const MediaKindV4Schema = z.enum([
  "image",
  "audio",
  "video",
  "synthetic_capture",
]);

const MediaDisclosureSchema = z.object({
  explicitLabel: z.literal(true),
  implicitMetadata: z.literal(true),
  disclosureText: NonEmptyTextSchema.max(320),
}).strict();

const SourceMediaReferenceSchema = z.object({
  assetRef: V2IdentifierSchema,
  mediaKind: MediaKindV4Schema,
  contentHash: V2ContentHashSchema,
  rightsReceiptRef: V2IdentifierSchema,
  rightsStatus: z.enum(["cleared", "limited", "withdrawn"]),
  permittedUse: z.enum([
    "teaching_preview",
    "classroom_submission",
    "simulated_publication",
  ]),
  personConsentMode: z.enum([
    "not_applicable",
    "simulated_character",
    "explicit_receipt",
  ]),
  aiDisclosure: MediaDisclosureSchema,
}).strict();

const NormalizedRegionSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().positive().max(1),
  height: z.number().positive().max(1),
}).strict().superRefine((region, context) => {
  if (region.x + region.width > 1 || region.y + region.height > 1) {
    context.addIssue({
      code: "custom",
      path: ["width"],
      message: "归一化裁切/遮挡区域不得越过媒体边界",
    });
  }
});

const MediaTransformationSharedShape = {
  operationId: V2IdentifierSchema,
  inputAssetRef: V2IdentifierSchema,
  outputAssetRef: V2IdentifierSchema,
  operatorKind: z.literal("student"),
  rationale: NonEmptyTextSchema.max(500),
};

const CropTransformationSchema = z.object({
  ...MediaTransformationSharedShape,
  operationKind: z.literal("crop"),
  region: NormalizedRegionSchema,
}).strict();

const TrimTransformationSchema = z.object({
  ...MediaTransformationSharedShape,
  operationKind: z.literal("trim"),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
}).strict().superRefine((operation, context) => {
  if (operation.endMs <= operation.startMs) {
    context.addIssue({
      code: "custom",
      path: ["endMs"],
      message: "媒体裁切结束时间必须晚于开始时间",
    });
  }
});

const RedactTransformationSchema = z.object({
  ...MediaTransformationSharedShape,
  operationKind: z.literal("redact"),
  region: NormalizedRegionSchema,
  redactionKind: z.enum(["blur", "mask", "mute", "remove_metadata"]),
}).strict();

const ReplaceTransformationSchema = z.object({
  ...MediaTransformationSharedShape,
  operationKind: z.literal("replace"),
  replacementAssetRef: V2IdentifierSchema,
  replacementReason: z.enum([
    "consent_withdrawn",
    "rights_scope_mismatch",
    "fact_risk",
    "editorial_choice",
  ]),
}).strict();

const CaptionTransformationSchema = z.object({
  ...MediaTransformationSharedShape,
  operationKind: z.literal("caption"),
  caption: NonEmptyTextSchema.max(320),
  supportingEvidenceRefs: z.array(V2IdentifierSchema).min(1).max(12),
}).strict();

export const MediaTransformationV4Schema = z.discriminatedUnion(
  "operationKind",
  [
    CropTransformationSchema,
    TrimTransformationSchema,
    RedactTransformationSchema,
    ReplaceTransformationSchema,
    CaptionTransformationSchema,
  ],
);
export type MediaTransformationV4 = z.infer<
  typeof MediaTransformationV4Schema
>;

const DerivedMediaAssetSchema = z.object({
  assetRef: V2IdentifierSchema,
  parentAssetRefs: z.array(V2IdentifierSchema).min(1).max(8),
  mediaKind: MediaKindV4Schema,
  mimeType: z.enum([
    "image/png",
    "image/svg+xml",
    "audio/wav",
    "audio/mpeg",
    "video/mp4",
  ]),
  contentHash: V2ContentHashSchema,
  byteLength: z.number().int().positive(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  durationMs: z.number().int().positive().nullable(),
  aiDisclosure: MediaDisclosureSchema,
  createdAt: TimestampSchema,
}).strict().superRefine((asset, context) => {
  const visual = ["image", "video", "synthetic_capture"].includes(asset.mediaKind);
  const timed = ["audio", "video"].includes(asset.mediaKind);
  if (visual !== (asset.width !== null && asset.height !== null)) {
    context.addIssue({
      code: "custom",
      path: ["width"],
      message: "图像/视频必须提供尺寸，纯音频不得伪造尺寸",
    });
  }
  if (timed !== (asset.durationMs !== null)) {
    context.addIssue({
      code: "custom",
      path: ["durationMs"],
      message: "音频/视频必须提供时长，静态媒体不得伪造时长",
    });
  }
});

export const MediaWorkRevisionV4Schema = z.object({
  schemaVersion: z.literal(MediaWorkRevisionV4SchemaVersion),
  mediaRevisionId: V2IdentifierSchema,
  sessionId: V2IdentifierSchema,
  bindingId: V2IdentifierSchema,
  flagshipContentRef: FlagshipContentReferenceV4Schema,
  artifactRef: V2IdentifierSchema,
  revisionNumber: z.number().int().positive(),
  parentRevisionRef: V2IdentifierSchema.nullable(),
  status: z.enum(["draft", "locked", "submitted"]),
  submissionPolicy:z.literal('selected_media/3.0.0').optional(),
  sourceAssets: z.array(SourceMediaReferenceSchema).min(1).max(24),
  transformations: z.array(MediaTransformationV4Schema).max(40),
  derivedAssets: z.array(DerivedMediaAssetSchema).min(1).max(24),
  rightsLedgerRefs: z.array(V2IdentifierSchema).min(1).max(32),
  supportingEvidenceRefs: z.array(V2IdentifierSchema).min(1).max(64),
  studentEditorialRationale: NonEmptyTextSchema.max(1_500),
  contentHash: V2ContentHashSchema,
  createdAt: TimestampSchema,
}).strict().superRefine((revision, context) => {
  if ((revision.revisionNumber === 1) !== (revision.parentRevisionRef === null)) {
    context.addIssue({
      code: "custom",
      path: ["parentRevisionRef"],
      message: "首版不得伪造父版本，后续版本必须保留父版本引用",
    });
  }
  const sourceIds = revision.sourceAssets.map((asset) => asset.assetRef);
  const derivedIds = revision.derivedAssets.map((asset) => asset.assetRef);
  if (new Set(sourceIds).size !== sourceIds.length
    || new Set(derivedIds).size !== derivedIds.length
    || sourceIds.some((assetRef) => derivedIds.includes(assetRef))) {
    context.addIssue({
      code: "custom",
      path: ["sourceAssets"],
      message: "源媒体与派生媒体 ID 必须分别唯一且不得覆盖原件",
    });
  }
  const known = new Set(sourceIds);
  const operationIds = new Set<string>();
  for (const [index, operation] of revision.transformations.entries()) {
    if (operationIds.has(operation.operationId)
      || !known.has(operation.inputAssetRef)
      || known.has(operation.outputAssetRef)) {
      context.addIssue({
        code: "custom",
        path: ["transformations", index],
        message: "媒体操作必须按顺序引用已存在输入并产生新的唯一输出",
      });
    }
    if (operation.operationKind === "replace"
      && !known.has(operation.replacementAssetRef)) {
      context.addIssue({
        code: "custom",
        path: ["transformations", index, "replacementAssetRef"],
        message: "替换操作只能使用本修订已登记媒体",
      });
    }
    operationIds.add(operation.operationId);
    known.add(operation.outputAssetRef);
  }
  if (derivedIds.some((assetRef) => !known.has(assetRef))) {
    context.addIssue({
      code: "custom",
      path: ["derivedAssets"],
      message: "派生媒体必须来自可追溯的学生操作链",
    });
  }
  const rights = new Set(revision.rightsLedgerRefs);
  if (revision.sourceAssets.some((asset) => !rights.has(asset.rightsReceiptRef))) {
    context.addIssue({
      code: "custom",
      path: ["rightsLedgerRefs"],
      message: "每个源媒体必须引用本修订登记的权利回执",
    });
  }
  if (revision.status !== "draft"
    && revision.sourceAssets.some((asset) => asset.rightsStatus === "withdrawn")) {
    context.addIssue({
      code: "custom",
      path: ["sourceAssets"],
      message: "锁定或提交修订不得继续包含已撤回权利的源媒体",
    });
  }
  if (revision.status === "submitted"
    && revision.artifactRef === "artifact-multiplatform-package" && revision.submissionPolicy !== 'selected_media/3.0.0') {
    const kinds = new Set(revision.derivedAssets.map((asset) => asset.mediaKind));
    if (!["image", "audio", "video"].every((kind) => kinds.has(kind as never))) {
      context.addIssue({
        code: "custom",
        path: ["derivedAssets"],
        message: "提交的融媒体包必须同时包含图像、音频和视频成品",
      });
    }
  }
});
export type MediaWorkRevisionV4 = z.infer<typeof MediaWorkRevisionV4Schema>;

export const AssessmentCriterionIdV4Schema = z.enum([
  "criterion-fact-verification",
  "criterion-interview-consent",
  "criterion-editorial-judgment",
  "criterion-rights-governance",
  "criterion-multiplatform-production",
  "criterion-recovery-transfer",
]);
export type AssessmentCriterionIdV4 = z.infer<
  typeof AssessmentCriterionIdV4Schema
>;

const ClaimEvidenceLinkSchema = z.object({
  claimRef: V2IdentifierSchema,
  evidenceRefs: z.array(V2IdentifierSchema).min(1).max(48),
  supportStatus: z.enum(["supported", "mixed", "refuted", "unresolved"]),
  sourceCount: z.number().int().positive().max(48),
}).strict();

export const BlindEvidenceAssessmentInputV4Schema = z.object({
  schemaVersion: z.literal(BlindEvidenceAssessmentInputV4SchemaVersion),
  blindCaseId: V2IdentifierSchema,
  flagshipContentHash: V2ContentHashSchema,
  rubricVersion: NonEmptyTextSchema.max(120),
  rubricContentHash: V2ContentHashSchema,
  rubricReviewStatus: z.enum(["pending_expert_review", "verified"]),
  assessmentBasis: z.literal("submitted_work").optional(),
  sourceContextRefs: z.array(V2IdentifierSchema).max(256).optional(),
  artifactRevisions: z.array(z.object({
    artifactRef: V2IdentifierSchema,
    revisionRef: V2IdentifierSchema,
    contentHash: V2ContentHashSchema,
  }).strict()).min(1).max(16),
  claimEvidenceLinks: z.array(ClaimEvidenceLinkSchema).max(64),
  behaviorEvidenceRefs: z.array(V2IdentifierSchema).max(256),
  worldConsequenceRefs: z.array(V2IdentifierSchema).max(256),
  scaffoldingEpisodeRefs: z.array(V2IdentifierSchema).max(32),
  recoveryPairRefs: z.array(V2IdentifierSchema).max(16),
  surfaceSignals: z.object({
    textLength: z.number().int().nonnegative(),
    keywordMatchCount: z.number().int().nonnegative(),
    completionClickCount: z.number().int().nonnegative(),
    endingKind: NonEmptyTextSchema.max(120),
    allowedForScoring: z.literal(false),
  }).strict(),
  excludedContextFields: z.tuple([
    z.literal("student_identity"),
    z.literal("binding_id"),
    z.literal("challenge_level"),
    z.literal("agent_advice"),
    z.literal("provider_and_model"),
    z.literal("prompt_and_trace"),
  ]),
  inputHash: V2ContentHashSchema,
  generatedAt: TimestampSchema,
}).strict().superRefine((input, context) => {
  if (input.assessmentBasis !== "submitted_work") {
    for (const key of ["claimEvidenceLinks", "behaviorEvidenceRefs", "worldConsequenceRefs"] as const)
      if (input[key].length === 0) context.addIssue({ code: "custom", path: [key], message: "旧版行为证据评价必须保留对应来源" });
  }
});
export type BlindEvidenceAssessmentInputV4 = z.infer<
  typeof BlindEvidenceAssessmentInputV4Schema
>;

const CriterionAssessmentSchema = z.object({
  criterionId: AssessmentCriterionIdV4Schema,
  evidenceStatus: z.enum(["insufficient", "supported", "mixed", "refuted"]),
  band: z.enum(["low", "medium", "high"]).nullable(),
  score: z.number().min(0).max(100).nullable(),
  confidence: z.number().min(0).max(1),
  evidenceRefs: z.array(V2IdentifierSchema).max(32),
  rationale: NonEmptyTextSchema.max(1_000),
  surfaceSignalsUsed: z.literal(false),
}).strict().superRefine((criterion, context) => {
  const insufficient = criterion.evidenceStatus === "insufficient";
  if (insufficient !== (
    criterion.band === null
    && criterion.score === null
    && criterion.evidenceRefs.length === 0
  )) {
    context.addIssue({
      code: "custom",
      path: ["evidenceStatus"],
      message: "证据不足不得给出档位、分数或伪证据；有判断必须保留三者",
    });
  }
});

export const EvidenceAssessmentDecisionV4Schema = z.object({
  schemaVersion: z.literal(EvidenceAssessmentDecisionV4SchemaVersion),
  assessmentDecisionId: V2IdentifierSchema,
  blindCaseRef: V2IdentifierSchema,
  blindInputHash: V2ContentHashSchema,
  status: z.enum(["insufficient_evidence", "provisional", "final"]),
  assessorMode: z.enum(["independent_live_agent", "deterministic_fallback"]),
  rubricReviewStatus: z.enum(["pending_expert_review", "verified"]),
  criterionAssessments: z.array(CriterionAssessmentSchema).length(6),
  sessionScore: z.number().min(0).max(100).nullable(),
  evidenceRefs: z.array(V2IdentifierSchema).max(96),
  adviceAgentExcluded: z.literal(true),
  challengeAppliedAfterBlindAssessment: z.literal(true),
  challengeAdjustmentRef: V2IdentifierSchema.nullable(),
  teacherReview: z.object({
    status: z.enum(["pending", "confirmed", "revised"]),
    teacherDecisionRef: V2IdentifierSchema.nullable(),
    rationale: NonEmptyTextSchema.max(1_000).nullable(),
    reviewedAt: TimestampSchema.nullable(),
  }).strict(),
  generatedAt: TimestampSchema,
}).strict().superRefine((decision, context) => {
  const criterionIds = decision.criterionAssessments.map(
    (criterion) => criterion.criterionId,
  );
  if (new Set(criterionIds).size !== AssessmentCriterionIdV4Schema.options.length
    || AssessmentCriterionIdV4Schema.options.some((id) => !criterionIds.includes(id))) {
    context.addIssue({
      code: "custom",
      path: ["criterionAssessments"],
      message: "评价必须且只能覆盖冻结的六个岗位能力维度",
    });
  }
  if (decision.status === "insufficient_evidence") {
    if (decision.sessionScore !== null || decision.evidenceRefs.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "证据不足时不得生成总分或聚合证据引用",
      });
    }
  } else if (decision.sessionScore === null || decision.evidenceRefs.length === 0) {
    context.addIssue({
      code: "custom",
      path: ["sessionScore"],
      message: "暂定或最终评价必须来自真实证据并给出总分",
    });
  }
  if (decision.status === "final"
    && (decision.rubricReviewStatus !== "verified"
      || decision.teacherReview.status === "pending")) {
    context.addIssue({
      code: "custom",
      path: ["status"],
      message: "最终评价必须使用已专业复核量规并完成教师终裁",
    });
  }
  const pendingTeacher = decision.teacherReview.status === "pending";
  if (pendingTeacher !== (
    decision.teacherReview.teacherDecisionRef === null
    && decision.teacherReview.rationale === null
    && decision.teacherReview.reviewedAt === null
  )) {
    context.addIssue({
      code: "custom",
      path: ["teacherReview"],
      message: "教师终裁状态必须与决定、理由和时间一致",
    });
  }
  const decisionEvidence = new Set(decision.evidenceRefs);
  if (decision.criterionAssessments.some((criterion) => (
    criterion.evidenceRefs.some((reference) => !decisionEvidence.has(reference))
  ))) {
    context.addIssue({
      code: "custom",
      path: ["criterionAssessments"],
      message: "逐维评价只能引用本决定已经登记的真实证据",
    });
  }
});
export type EvidenceAssessmentDecisionV4 = z.infer<
  typeof EvidenceAssessmentDecisionV4Schema
>;

const ChangedMechanicSchema = z.object({
  mechanicKind: z.enum([
    "event_templates",
    "npc_resistance",
    "evidence_availability",
    "deadline_pattern",
    "scaffolding_budget",
  ]),
  beforeHash: V2ContentHashSchema,
  afterHash: V2ContentHashSchema,
  safeSummary: NonEmptyTextSchema.max(500),
}).strict().superRefine((mechanic, context) => {
  if (mechanic.beforeHash === mechanic.afterHash) {
    context.addIssue({
      code: "custom",
      path: ["afterHash"],
      message: "第二场机械变化的前后哈希不得相同",
    });
  }
});

const SecondSessionProposalSchema = z.object({
  variantRef: z.enum([
    "variant-xunpu-source-triangulation",
    "variant-xunpu-consent-negotiation",
    "variant-xunpu-deadline-service",
    "variant-xunpu-editorial-independence",
  ]),
  sourceChallengeLevel: ChallengeLevelSchema,
  targetChallengeLevel: ChallengeLevelSchema,
  changedMechanics: z.array(ChangedMechanicSchema).min(2).max(5),
  growthTargetRefs: z.array(V2IdentifierSchema).min(1).max(8),
  forecastRef: V2IdentifierSchema,
  learnerConsentRequired: z.literal(true),
  observationWindow: LearnerCalibrationObservationWindowPlanV4Schema.optional(),
}).strict().superRefine((proposal, context) => {
  const kinds = proposal.changedMechanics.map((mechanic) => mechanic.mechanicKind);
  if (new Set(kinds).size !== kinds.length) {
    context.addIssue({
      code: "custom",
      path: ["changedMechanics"],
      message: "第二场至少改变两个互不重复的运行机制",
    });
  }
  if (Math.abs(proposal.targetChallengeLevel - proposal.sourceChallengeLevel) > 1) {
    context.addIssue({
      code: "custom",
      path: ["targetChallengeLevel"],
      message: "系统自动挑战等级每次最多变化一级",
    });
  }
});

const SecondSessionProvisionSchema = z.object({
  learnerSubjectHash: V2ContentHashSchema,
  membershipRef: V2IdentifierSchema,
  bindingRef: V2IdentifierSchema,
  courseReleaseRef: CourseReleaseReferenceSchema,
  scenarioReleaseRef: ScenarioReleaseReferenceSchema,
  simulationReleaseRef: SimulationReleaseReferenceSchema,
  sessionRef: V2IdentifierSchema,
  challengeAssignmentRef: V2IdentifierSchema,
  provisionedAt: TimestampSchema,
}).strict();

const SecondSessionHandoffSharedShape = {
  schemaVersion: z.literal(SecondSessionHandoffV4SchemaVersion),
  handoffId: V2IdentifierSchema,
  learnerSubjectHash: V2ContentHashSchema,
  learnerTwinRef: V2IdentifierSchema,
  learnerTwinContentHash: V2ContentHashSchema,
  sourceSessionId: V2IdentifierSchema,
  sourceAssessmentDecisionRef: V2IdentifierSchema,
  flagshipContentRef: FlagshipContentReferenceV4Schema,
  createdAt: TimestampSchema,
};

const NotEligibleSecondSessionHandoffV4Schema = z.object({
  ...SecondSessionHandoffSharedShape,
  status: z.literal("not_eligible"),
  reasonCode: z.enum([
    "assessment_not_final",
    "insufficient_evidence",
    "rubric_not_verified",
    "appeal_open",
    "learner_consent_missing",
  ]),
  proposal: z.null(),
  teacherAuthorizationRef: z.null(),
  provision: z.null(),
  calibration: z.null(),
  failure: z.null(),
  writeDisposition: z.literal("zero_write"),
}).strict();

const ProposedSecondSessionHandoffV4Schema = z.object({
  ...SecondSessionHandoffSharedShape,
  status: z.literal("proposed"),
  reasonCode: z.null(),
  proposal: SecondSessionProposalSchema,
  teacherAuthorizationRef: z.null(),
  provision: z.null(),
  calibration: z.null(),
  failure: z.null(),
  writeDisposition: z.literal("candidate_only"),
}).strict();

const AuthorizedSecondSessionHandoffV4Schema = z.object({
  ...SecondSessionHandoffSharedShape,
  status: z.literal("authorized"),
  reasonCode: z.null(),
  proposal: SecondSessionProposalSchema,
  teacherAuthorizationRef: V2IdentifierSchema,
  provision: z.null(),
  calibration: z.null(),
  failure: z.null(),
  writeDisposition: z.literal("authorization_only"),
}).strict();

const ProvisionedSecondSessionHandoffV4Schema = z.object({
  ...SecondSessionHandoffSharedShape,
  status: z.literal("provisioned"),
  reasonCode: z.null(),
  proposal: SecondSessionProposalSchema,
  teacherAuthorizationRef: V2IdentifierSchema,
  provision: SecondSessionProvisionSchema,
  calibration: z.null(),
  failure: z.null(),
  writeDisposition: z.literal("committed"),
}).strict().superRefine((handoff, context) => {
  if (handoff.provision.learnerSubjectHash !== handoff.learnerSubjectHash) {
    context.addIssue({
      code: "custom",
      path: ["provision", "learnerSubjectHash"],
      message: "第二场授权只能绑定同一去身份学习者主体",
    });
  }
});

const CalibratedSecondSessionHandoffV4Schema = z.object({
  ...SecondSessionHandoffSharedShape,
  status: z.literal("calibration_completed"),
  reasonCode: z.null(),
  proposal: SecondSessionProposalSchema,
  teacherAuthorizationRef: V2IdentifierSchema,
  provision: SecondSessionProvisionSchema,
  calibration: z.object({
    actualStudentActionRefs: z.array(V2IdentifierSchema).max(256),
    forecastError: z.number().min(0).max(1),
    learnerTwinUpdateRef: V2IdentifierSchema,
    evidenceEligibleForScore: z.literal(false),
    calibratedAt: TimestampSchema,
  }).merge(z.object({
    policyVersion: LearnerCalibrationDisplayPolicyVersionV4Schema.optional(),
    outcome: LearnerCalibrationOutcomeV4Schema.optional(),
    observedBehaviorAlignment: z.number().min(0).max(1).optional(),
    observationWindow: LearnerCalibrationObservationWindowV4Schema.optional(),
    evidence: LearnerCalibrationEvidenceRefsV4Schema.optional(),
    completionBasis: z.array(NonEmptyTextSchema.max(500)).min(1).max(8).optional(),
    unmetRequirements: z.array(NonEmptyTextSchema.max(500)).max(8).optional(),
  }).strict()).strict(),
  failure: z.null(),
  writeDisposition: z.literal("committed"),
}).strict().superRefine((handoff, context) => {
  if (handoff.provision.learnerSubjectHash !== handoff.learnerSubjectHash) {
    context.addIssue({
      code: "custom",
      path: ["provision", "learnerSubjectHash"],
      message: "第二场校准只能回写同一去身份学习者主体",
    });
  }
});

const FailedSecondSessionHandoffV4Schema = z.object({
  ...SecondSessionHandoffSharedShape,
  status: z.literal("failed"),
  reasonCode: z.null(),
  proposal: SecondSessionProposalSchema.nullable(),
  teacherAuthorizationRef: V2IdentifierSchema.nullable(),
  provision: z.null(),
  calibration: z.null(),
  failure: z.object({
    reasonCode: z.enum([
      "version_hash_drift",
      "cross_learner_scope",
      "provisioning_failed",
      "authorization_stale",
    ]),
    safeMessage: NonEmptyTextSchema.max(500),
  }).strict(),
  writeDisposition: z.literal("zero_write"),
}).strict();

export const SecondSessionHandoffV4Schema = z.discriminatedUnion("status", [
  NotEligibleSecondSessionHandoffV4Schema,
  ProposedSecondSessionHandoffV4Schema,
  AuthorizedSecondSessionHandoffV4Schema,
  ProvisionedSecondSessionHandoffV4Schema,
  CalibratedSecondSessionHandoffV4Schema,
  FailedSecondSessionHandoffV4Schema,
]);
export type SecondSessionHandoffV4 = z.infer<
  typeof SecondSessionHandoffV4Schema
>;
