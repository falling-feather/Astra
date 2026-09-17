import { createHash } from "node:crypto";
import { z } from "zod";
import {
  AssessmentCriterionIdV4Schema,
  BlindEvidenceAssessmentInputV4Schema,
  MultimodalQualityObservationV4Schema,
  MultimodalQualityObservationV4SchemaVersion,
  MultimodalQualityRepresentationV4Schema,
  WorkQualityAssessmentRunReceiptV4Schema,
  V2ContentHashSchema,
  V2IdentifierSchema,
  type AssessmentCriterionIdV4,
  type BlindEvidenceAssessmentInputV4,
  type EvidenceAssessmentDecisionV4,
  type MultimodalQualityRepresentationV4,
  type WorkQualityAssessmentRunReceiptV4,
} from "@ronggang/contracts";
export {
  WorkQualityAssessmentRunReceiptV4Schema,
  type WorkQualityAssessmentRunReceiptV4,
} from "@ronggang/contracts";
import {
  BlindCriterionJudgmentV4Schema,
  EvidenceAssessmentRubricV4Schema,
  evaluateBlindCriteriaV4,
  issueEvidenceAssessmentDecisionFromJudgmentsV4,
  type BlindCriterionJudgmentV4,
  type EvidenceAssessmentRubricV4,
  type StructuredAssessmentEvidenceFactV4,
} from "./evidence-assessment-v4.js";

export const WorkQualityAssessmentRuntimeV4Version =
  "work-quality-assessment-runtime/4.0.0" as const;

const TimestampSchema = z.string().datetime();
const NonEmptyTextSchema = z.string().trim().min(1);

export const BlindWorkArtifactV4Schema = z.object({
  artifactRef: V2IdentifierSchema,
  revisionRef: V2IdentifierSchema,
  contentHash: V2ContentHashSchema,
  revisionNumber: z.number().int().positive(),
  parentRevisionRef: V2IdentifierSchema.nullable(),
  fields: z.array(z.object({
    fieldRef: V2IdentifierSchema,
    contentExcerpt: z.string().max(2_400),
    wasTruncated: z.boolean(),
    redactionApplied: z.boolean(),
  }).strict()).min(1).max(12),
  revisionNote: NonEmptyTextSchema.max(600),
}).strict();
export type BlindWorkArtifactV4 = z.infer<typeof BlindWorkArtifactV4Schema>;

export const BlindMediaArtifactSummaryV4Schema = z.object({
  artifactRef: V2IdentifierSchema,
  revisionRef: V2IdentifierSchema,
  contentHash: V2ContentHashSchema,
  sourceKinds: z.array(z.enum(["image", "audio", "video", "synthetic_capture"]))
    .min(1).max(24),
  rightsStatuses: z.array(z.enum(["cleared", "limited"]))
    .min(1).max(24),
  transformationKinds: z.array(z.enum(["crop", "trim", "redact", "replace", "caption"]))
    .max(40),
  derivedAssets: z.array(z.object({
    assetRef: V2IdentifierSchema,
    contentHash: V2ContentHashSchema,
    mediaKind: z.enum(["image", "audio", "video", "synthetic_capture"]),
    mimeType: z.string().trim().min(1).max(100),
    byteLength: z.number().int().positive(),
    width: z.number().int().positive().nullable(),
    height: z.number().int().positive().nullable(),
    durationMs: z.number().int().positive().nullable(),
  }).strict()).min(1).max(24),
  editorialRationale: NonEmptyTextSchema.max(1_500),
}).strict();
export type BlindMediaArtifactSummaryV4 = z.infer<
  typeof BlindMediaArtifactSummaryV4Schema
>;

export const WorkQualityMediaInputV4Schema =
  MultimodalQualityRepresentationV4Schema;
export type WorkQualityMediaInputV4 = MultimodalQualityRepresentationV4;

export type WorkQualityMediaPreparationStatusV4 =
  | "not_applicable"
  | "ready"
  | "incomplete"
  | "not_eligible";

const WorkQualityCriterionDraftV4Schema = z.object({
  criterionId: AssessmentCriterionIdV4Schema,
  band: z.enum(["low", "medium", "high"]),
  score: z.number().min(0).max(100),
  confidence: z.number().min(0).max(0.95),
  evidenceRefs: z.array(V2IdentifierSchema).min(1).max(32),
  rationale: NonEmptyTextSchema.max(1_000),
}).strict().superRefine((judgment, context) => {
  const scoreMatchesBand = judgment.band === "low"
    ? judgment.score < 60
    : judgment.band === "medium"
      ? judgment.score >= 60 && judgment.score < 80
      : judgment.score >= 80;
  if (!scoreMatchesBand) {
    context.addIssue({
      code: "custom",
      path: ["score"],
      message: "作品质量草稿分数必须落在所选档位内",
    });
  }
});

export const WorkQualityModelOutputV4Schema = z.object({
  judgments: z.array(WorkQualityCriterionDraftV4Schema).length(6),
  limitations: z.array(NonEmptyTextSchema.max(500)).min(1).max(8),
}).strict().superRefine((output, context) => {
  const ids = output.judgments.map((judgment) => judgment.criterionId);
  if (new Set(ids).size !== AssessmentCriterionIdV4Schema.options.length
    || AssessmentCriterionIdV4Schema.options.some((criterionId) => !ids.includes(criterionId))) {
    context.addIssue({
      code: "custom",
      path: ["judgments"],
      message: "作品质量模型必须且只能判断冻结的六项能力",
    });
  }
});

export interface BlindWorkQualityObservationV4 {
  runtimeVersion: typeof WorkQualityAssessmentRuntimeV4Version;
  rubric: Array<{
    criterionId: AssessmentCriterionIdV4;
    weight: number;
    minimumIndependentEvidenceCount: number;
  }>;
  deterministicJudgments: Array<{
    criterionId: AssessmentCriterionIdV4;
    evidenceStatus: "supported" | "mixed" | "refuted";
    maximumBand: "low" | "medium" | "high";
    maximumScore: number;
    confidenceCeiling: number;
    evidenceRefs: string[];
  }>;
  workArtifacts: BlindWorkArtifactV4[];
  courseContext?: NonNullable<EvidenceAssessmentRubricV4["workBasis"]>;
  sourceContext?: Array<{ evidenceRef: string; title: string; content: string; wasTruncated: boolean }>;
  mediaArtifacts: BlindMediaArtifactSummaryV4[];
  mediaInputs: WorkQualityMediaInputV4[];
  constraints: {
    surfaceSignalsAllowed: false;
    challengeLevelVisible: false;
    agentAdviceVisible: false;
    mayChangeEvidenceRefs: false;
    mayReturnSessionScore: false;
    teacherReviewRequired: true;
  };
  remainingBudgetMicros: number;
}

export interface WorkQualityModelRunV4 {
  output: unknown;
  providerId: string;
  modelId: string;
  traceRef: string;
  latencyMs: number;
  estimatedCostMicros: number;
}

export interface WorkQualityModelV4 {
  assess(
    observation: Readonly<BlindWorkQualityObservationV4>,
  ): Promise<WorkQualityModelRunV4>;
}

export interface WorkQualityAssessmentResultV4 {
  decision: EvidenceAssessmentDecisionV4;
  blindJudgments: BlindCriterionJudgmentV4[];
  rawWeightedScore: number | null;
  receipt: WorkQualityAssessmentRunReceiptV4;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

function stableId(prefix: string, value: unknown): string {
  return `${prefix}-${hash(value).slice(0, 24)}`;
}

function exactSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && [...left].sort().every((reference, index) => reference === [...right].sort()[index]);
}

function safeModelText(value: string): boolean {
  return !/(?:prompt|trace|provider|token|api.?key|student.?id|binding.?id|session.?id|身份证|手机号|住址|家庭收入|心理诊断|政治倾向)/iu
    .test(value);
}

function validRun(run: WorkQualityModelRunV4): boolean {
  return run.providerId.trim().length > 0
    && run.providerId.length <= 100
    && run.modelId.trim().length > 0
    && run.modelId.length <= 200
    && V2IdentifierSchema.safeParse(run.traceRef).success
    && Number.isFinite(run.latencyMs)
    && run.latencyMs >= 0
    && Number.isInteger(run.estimatedCostMicros)
    && run.estimatedCostMicros >= 0;
}

class WorkQualityModelTimeoutError extends Error {}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new WorkQualityModelTimeoutError("作品质量模型超时")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

const bandRank = { low: 0, medium: 1, high: 2 } as const;

export async function issueEvidenceAssessmentWithWorkQualityV4(input: {
  blindInput: BlindEvidenceAssessmentInputV4;
  evidenceFacts: StructuredAssessmentEvidenceFactV4[];
  rubric: EvidenceAssessmentRubricV4;
  workArtifacts: BlindWorkArtifactV4[];
  mediaArtifacts: BlindMediaArtifactSummaryV4[];
  sourceContext?: BlindWorkQualityObservationV4["sourceContext"];
  onFailure?:(error:unknown)=>void;
  mediaInputs?: WorkQualityMediaInputV4[];
  mediaPreparationStatus?: WorkQualityMediaPreparationStatusV4;
  mediaPreparationLimitations?: string[];
  scoreCeiling: 80 | 85 | 90 | 95 | 100;
  challengeAdjustmentRef: string;
  model?: WorkQualityModelV4;
  timeoutMs?: number;
  budgetMicros?: number;
  generatedAt: string;
}): Promise<WorkQualityAssessmentResultV4> {
  const blindInput = BlindEvidenceAssessmentInputV4Schema.parse(input.blindInput);
  const rubric = EvidenceAssessmentRubricV4Schema.parse(input.rubric);
  const workArtifacts = input.workArtifacts.map((artifact) => (
    BlindWorkArtifactV4Schema.parse(artifact)
  ));
  const mediaArtifacts = input.mediaArtifacts.map((artifact) => (
    BlindMediaArtifactSummaryV4Schema.parse(artifact)
  ));
  const mediaInputs = (input.mediaInputs ?? []).map((mediaInput) => (
    WorkQualityMediaInputV4Schema.parse(mediaInput)
  ));
  const mediaPreparationLimitations = (input.mediaPreparationLimitations ?? [])
    .map((limitation) => limitation.trim())
    .filter(Boolean);
  if (mediaPreparationLimitations.length > 8
    || mediaPreparationLimitations.some((limitation) => limitation.length > 500)) {
    throw new Error("多模态作品观察限制说明超出安全上限");
  }
  const expectedMediaAssets = mediaArtifacts.flatMap((artifact) => (
    artifact.derivedAssets.map((asset) => ({
      artifactRef: artifact.artifactRef,
      revisionRef: artifact.revisionRef,
      ...asset,
    }))
  ));
  const expectedByRef = new Map(expectedMediaAssets.map((asset) => [asset.assetRef, asset]));
  if (new Set(mediaInputs.map((mediaInput) => mediaInput.inputRef)).size
      !== mediaInputs.length) {
    throw new Error("多模态作品观察输入引用不得重复");
  }
  for (const mediaInput of mediaInputs) {
    const expected = expectedByRef.get(mediaInput.sourceAssetRef);
    const bytes = Buffer.from(mediaInput.contentBase64, "base64");
    if (!expected
      || expected.artifactRef !== mediaInput.artifactRef
      || expected.revisionRef !== mediaInput.revisionRef
      || mediaInput.sourceAssetContentHash !== expected.contentHash
      || bytes.length === 0
      || createHash("sha256").update(bytes).digest("hex")
        !== mediaInput.representationContentHash) {
      throw new Error("多模态作品观察输入没有绑定当前送审派生资产");
    }
  }
  const observedAssetRefs = new Set(mediaInputs.map((mediaInput) => mediaInput.sourceAssetRef));
  const inferredPreparationStatus: WorkQualityMediaPreparationStatusV4 =
    expectedMediaAssets.length === 0
      ? "not_applicable"
      : expectedMediaAssets.every((asset) => observedAssetRefs.has(asset.assetRef))
        && mediaInputs.length > 0
        ? "ready"
        : "incomplete";
  const mediaPreparationStatus = input.mediaPreparationStatus
    ?? inferredPreparationStatus;
  if ((mediaPreparationStatus === "not_applicable") !== (expectedMediaAssets.length === 0)
    || (mediaPreparationStatus === "not_eligible" && mediaInputs.length > 0)
    || (mediaPreparationStatus === "ready" && inferredPreparationStatus !== "ready")) {
    throw new Error("多模态作品观察准备状态与实际资产输入不一致");
  }
  const multimodalObservation = MultimodalQualityObservationV4Schema.parse({
    schemaVersion: MultimodalQualityObservationV4SchemaVersion,
    preparationStatus: mediaPreparationStatus,
    expectedAssetCount: expectedMediaAssets.length,
    representations: mediaInputs,
    limitations: mediaPreparationLimitations,
  });
  const timeoutMs = input.timeoutMs ?? 6_000;
  const budgetMicros = input.budgetMicros ?? 250_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new Error("作品质量模型超时必须在 1—30000 毫秒之间");
  }
  if (!Number.isInteger(budgetMicros) || budgetMicros < 0) {
    throw new Error("作品质量模型预算非法");
  }
  const deterministicJudgments = evaluateBlindCriteriaV4({
    blindInput,
    evidenceFacts: input.evidenceFacts,
    rubric,
  });
  for (const artifact of workArtifacts) {
    const frozen = blindInput.artifactRevisions.find(item => item.revisionRef === artifact.revisionRef);
    if (!frozen || frozen.artifactRef !== artifact.artifactRef || frozen.contentHash !== artifact.contentHash)
      throw new Error("质量观察中的作品与已提交版本不一致");
  }
  const sourceContext = (input.sourceContext ?? []).map(source => ({ ...source }));
  const validSourceRefs = new Set([...(blindInput.sourceContextRefs ?? []), ...blindInput.behaviorEvidenceRefs, ...blindInput.worldConsequenceRefs, ...blindInput.claimEvidenceLinks.flatMap(link => link.evidenceRefs)]);
  if (sourceContext.length > 256 || sourceContext.some(source => !validSourceRefs.has(source.evidenceRef) || source.content.length > 2000 || !source.title.trim()))
    throw new Error("作品核验上下文包含未冻结的来源或超出长度限制");
  const eligibility = rubric.workBasis ? rubric.workBasis.criteria.map(criterion => ({ criterionId:criterion.criterionId,
    evidenceStatus:'supported' as const, maximumBand:'high' as const, maximumScore:100, confidenceCeiling:.8,
    evidenceRefs:workArtifacts.filter(artifact=>criterion.artifactRefs.includes(artifact.artifactRef)).map(artifact=>artifact.revisionRef),
  })) : null;
  const sufficient = eligibility ? eligibility.every(criterion=>criterion.evidenceRefs.length>0) : deterministicJudgments.every((judgment) => (
    judgment.score !== null && judgment.band !== null
  ));
  const observation: BlindWorkQualityObservationV4 = {
    runtimeVersion: WorkQualityAssessmentRuntimeV4Version,
    rubric: rubric.criteria.map((criterion) => ({ ...criterion })),
    deterministicJudgments: eligibility ?? (sufficient
      ? deterministicJudgments.map((judgment) => ({
          criterionId: judgment.criterionId,
          evidenceStatus: judgment.evidenceStatus as "supported" | "mixed" | "refuted",
          maximumBand: judgment.band!,
          maximumScore: judgment.band === "high" ? 100 : judgment.band === "medium" ? 79 : 59,
          confidenceCeiling: Math.min(0.95, judgment.confidence + 0.05),
          evidenceRefs: [...judgment.evidenceRefs],
        }))
      : []),
    workArtifacts,
    ...(rubric.workBasis ? { courseContext:rubric.workBasis, sourceContext } : {}),
    mediaArtifacts,
    mediaInputs,
    constraints: {
      surfaceSignalsAllowed: false,
      challengeLevelVisible: false,
      agentAdviceVisible: false,
      mayChangeEvidenceRefs: false,
      mayReturnSessionScore: false,
      teacherReviewRequired: true,
    },
    remainingBudgetMicros: budgetMicros,
  };
  const inputHash = hash({
    ...observation,
    mediaInputs: observation.mediaInputs.map(({ contentBase64: _contentBase64, ...mediaInput }) => (
      mediaInput
    )),
    mediaPreparation: {
      schemaVersion: multimodalObservation.schemaVersion,
      preparationStatus: multimodalObservation.preparationStatus,
      expectedAssetCount: multimodalObservation.expectedAssetCount,
      limitations: multimodalObservation.limitations,
    },
  });
  const mediaObservationReceipt = (providerInvocationIncludedMedia: boolean) => ({
    preparationStatus: mediaPreparationStatus,
    expectedAssetCount: expectedMediaAssets.length,
    preparedInputCount: mediaInputs.length,
    representationKinds: mediaInputs.map((mediaInput) => mediaInput.representationKind),
    inputContentHashes: mediaInputs.map(
      (mediaInput) => mediaInput.representationContentHash,
    ),
    providerInvocationIncludedMedia,
    limitations: [...mediaPreparationLimitations],
  });
  const fallback = (
    reason: Exclude<WorkQualityAssessmentRunReceiptV4["fallbackReason"], null>,
    run: WorkQualityModelRunV4 | null = null,
    providerInvocationIncludedMedia = run !== null && mediaInputs.length > 0,
  ): WorkQualityAssessmentResultV4 => {
    const issued = issueEvidenceAssessmentDecisionFromJudgmentsV4({
      blindInput,
      evidenceFacts: input.evidenceFacts,
      rubric,
      blindJudgments: deterministicJudgments,
      scoreCeiling: input.scoreCeiling,
      challengeAdjustmentRef: input.challengeAdjustmentRef,
      assessorMode: "deterministic_fallback",
      generatedAt: input.generatedAt,
    });
    const outputHash = hash(issued.blindJudgments);
    return {
      ...issued,
      receipt: WorkQualityAssessmentRunReceiptV4Schema.parse({
        qualityRunRef: stableId("work-quality-run-v4", { inputHash, outputHash, reason }),
        inputHash,
        outputHash,
        mode: "deterministic_fallback",
        fallbackReason: reason,
        providerId: run?.providerId ?? null,
        modelId: run?.modelId ?? null,
        traceRef: run?.traceRef ?? null,
        latencyMs: run?.latencyMs ?? null,
        estimatedCostMicros: run?.estimatedCostMicros ?? 0,
        mediaObservation: mediaObservationReceipt(providerInvocationIncludedMedia),
        createdAt: input.generatedAt,
      }),
    };
  };
  if (!sufficient) return fallback("evidence_insufficient");
  if (!input.model) return fallback("model_not_configured");
  if (mediaPreparationStatus === "not_eligible") {
    return fallback("media_not_eligible");
  }
  if (expectedMediaAssets.length > 0 && mediaPreparationStatus !== "ready") {
    return fallback(mediaInputs.length === 0
      ? "media_unavailable"
      : "media_observation_incomplete");
  }
  if (budgetMicros === 0) return fallback("model_cost_exceeded");
  try {
    const run = await withTimeout(
      input.model.assess(structuredClone(observation)),
      timeoutMs,
    );
    if (!validRun(run)) return fallback("model_invalid_output");
    if (run.estimatedCostMicros > budgetMicros) {
      return fallback("model_cost_exceeded", run);
    }
    const parsed = WorkQualityModelOutputV4Schema.safeParse(run.output);
    if (!parsed.success
      || parsed.data.limitations.some((limitation) => !safeModelText(limitation))) {
      return fallback("model_invalid_output", run);
    }
    const merged: BlindCriterionJudgmentV4[] = [];
    const modelBounds = eligibility ? eligibility.map(bound=>({ criterionId:bound.criterionId,evidenceStatus:bound.evidenceStatus,
      band:bound.maximumBand,score:bound.maximumScore,confidence:bound.confidenceCeiling,evidenceRefs:bound.evidenceRefs,
      rationale:'作品版本已核对，分数由本课作品审读决定。',surfaceSignalsUsed:false as const })) : deterministicJudgments;
    for (const deterministic of modelBounds) {
      const draft = parsed.data.judgments.find(
        (judgment) => judgment.criterionId === deterministic.criterionId,
      );
      if (!draft || deterministic.band === null || deterministic.score === null
        || bandRank[draft.band] > bandRank[deterministic.band]
        || !exactSet(draft.evidenceRefs, deterministic.evidenceRefs)
        || !safeModelText(draft.rationale)) {
        return fallback("model_invalid_output", run);
      }
      merged.push(BlindCriterionJudgmentV4Schema.parse({
        ...deterministic,
        band: draft.band,
        score: draft.score,
        confidence: Math.min(draft.confidence, rubric.workBasis ? .8 : deterministic.confidence + 0.05),
        rationale: `盲化作品质量草稿：${draft.rationale}`,
        surfaceSignalsUsed: false,
      }));
    }
    const issued = issueEvidenceAssessmentDecisionFromJudgmentsV4({
      blindInput,
      evidenceFacts: input.evidenceFacts,
      rubric,
      blindJudgments: merged,
      scoreCeiling: input.scoreCeiling,
      challengeAdjustmentRef: input.challengeAdjustmentRef,
      assessorMode: "independent_live_agent",
      generatedAt: input.generatedAt,
    });
    const outputHash = hash(parsed.data);
    return {
      ...issued,
      receipt: WorkQualityAssessmentRunReceiptV4Schema.parse({
        qualityRunRef: stableId("work-quality-run-v4", {
          inputHash,
          outputHash,
          traceRef: run.traceRef,
        }),
        inputHash,
        outputHash,
        mode: "independent_live_agent",
        fallbackReason: null,
        providerId: run.providerId,
        modelId: run.modelId,
        traceRef: run.traceRef,
        latencyMs: run.latencyMs,
        estimatedCostMicros: run.estimatedCostMicros,
        mediaObservation: mediaObservationReceipt(mediaInputs.length > 0),
        createdAt: input.generatedAt,
      }),
    };
  } catch (error) {
    input.onFailure?.(error);
    return fallback(
      error instanceof WorkQualityModelTimeoutError ? "model_timeout" : "model_error",
      null,
      mediaInputs.length > 0,
    );
  }
}
