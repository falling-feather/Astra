import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import {
  AssessmentCriterionIdV4Schema,
  ChallengeAssignmentSchema,
  ChallengeAssignmentSchemaVersion,
  LearnerAdaptationVariantRefV4Schema,
  LearnerCalibrationLegacyPolicyVersionV4,
  LearnerCalibrationDisplayPolicyVersionV4Schema,
  LearnerCalibrationResultV4Schema,
  SecondSessionHandoffV4Schema,
  SecondSessionHandoffV4SchemaVersion,
  WorldSimulationReleaseSchema,
  challengeScoreCeiling,
  type AssessmentCriterionIdV4,
  type ChallengeAssignment,
  type EvidenceAssessmentDecisionV4,
  type SecondSessionHandoffV4,
  type WorldSimulationRelease,
} from "@ronggang/contracts";
import {
  xunpuV4AdaptationVariants,
  type XunpuAdaptationVariantV4,
} from "@ronggang/course-content";
import type { WorldSimulationEngineV3 } from "@ronggang/world-core";
import {
  currentFlagshipAssessmentDecisionV4,
  type FlagshipAssessmentRecordV4,
  type FlagshipEvidenceAssessmentServiceV4,
} from "./flagship-assessment-v4.js";
import { flagshipContentReferenceV4Of } from "./flagship-experience-v4.js";
import {
  evaluateLearnerCalibrationV4,
  calibrationWindowPlanForVariantV4,
} from "./learner-calibration-v4.js";

export const LearnerAdaptationRecordV4Version =
  "learner-adaptation-record/4.0.0" as const;
export const LearnerAdaptationViewV4Version =
  "learner-adaptation-view/4.0.0" as const;
export const LearnerAdaptationAdminCaseV4Version =
  "learner-adaptation-admin-case/4.0.0" as const;
export const LearnerProxyRuntimeV4Version =
  "learner-proxy-runtime/4.0.0" as const;

const TimestampSchema = z.string().datetime();
const HashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const IdSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/@-]*$/u);
const NonEmptyTextSchema = z.string().trim().min(1);

const CriterionStateV4Schema = z.object({
  criterionId: AssessmentCriterionIdV4Schema,
  evidenceStatus: z.enum(["supported", "mixed", "refuted"]),
  band: z.enum(["low", "medium", "high"]),
  score: z.number().min(0).max(100),
  confidence: z.number().min(0).max(1),
  evidenceRefs: z.array(IdSchema).min(1).max(32),
  supportEvidenceRefs: z.array(IdSchema).max(32).default([]),
  counterEvidenceRefs: z.array(IdSchema).max(32).default([]),
  uncertaintyDrivers: z.array(z.enum([
    "limited_evidence",
    "mixed_evidence",
    "refuting_evidence",
    "teacher_revision",
    "cross_session_prediction_error",
  ])).max(5).default([]),
  lastPredictionError: z.number().min(0).max(1).nullable().default(null),
}).strict().superRefine((criterion, context) => {
  const evidenceRefs = new Set(criterion.evidenceRefs);
  const support = new Set(criterion.supportEvidenceRefs);
  const counter = new Set(criterion.counterEvidenceRefs);
  if ([...support, ...counter].some((reference) => !evidenceRefs.has(reference))) {
    context.addIssue({
      code: "custom",
      path: ["supportEvidenceRefs"],
      message: "学习者模型的支持与反证必须来自本维已登记证据",
    });
  }
  if ([...support].some((reference) => counter.has(reference))) {
    context.addIssue({
      code: "custom",
      path: ["counterEvidenceRefs"],
      message: "同一证据不得同时作为支持与反证",
    });
  }
});

const LearnerCalibrationHistoryEntryV4Schema = z.object({
  calibrationRef: IdSchema,
  variantRef: LearnerAdaptationVariantRefV4Schema,
  predictedSuccessProbability: z.number().min(0).max(1),
  observedBehaviorAlignment: z.number().min(0).max(1),
  absolutePredictionError: z.number().min(0).max(1),
  actionEvidenceHash: HashSchema,
  policyVersion: LearnerCalibrationDisplayPolicyVersionV4Schema.optional(),
  outcome: z.enum(["success", "failure"]).optional(),
  observationEvidenceHash: HashSchema.optional(),
  calibratedAt: TimestampSchema,
}).strict();

const LearnerTwinV4Schema = z.object({
  learnerTwinRef: IdSchema,
  revision: z.number().int().positive(),
  sourceAssessmentDecisionRef: IdSchema,
  criterionStates: z.array(CriterionStateV4Schema).length(6),
  growthTargetRefs: z.array(AssessmentCriterionIdV4Schema).min(1).max(3),
  sourceChallengeLevel: z.number().int().min(3).max(7),
  sourceScaffoldingLevel: z.number().int().min(0).max(3),
  calibrationCount: z.number().int().nonnegative(),
  calibrationHistory: z.array(LearnerCalibrationHistoryEntryV4Schema)
    .max(16).default([]),
  limitations: z.array(NonEmptyTextSchema.max(500)).min(1).max(8).default([
    "该模型只描述当前证据支持的可观察岗位表现，不是固定人格或能力定型。",
  ]),
  contentHash: HashSchema,
  updatedAt: TimestampSchema,
}).strict().superRefine((twin, context) => {
  const ids = twin.criterionStates.map((criterion) => criterion.criterionId);
  if (new Set(ids).size !== AssessmentCriterionIdV4Schema.options.length
    || AssessmentCriterionIdV4Schema.options.some((id) => !ids.includes(id))) {
    context.addIssue({
      code: "custom",
      path: ["criterionStates"],
      message: "V4 学习者模型必须且只能覆盖冻结的六项可观察能力",
    });
  }
});
export type LearnerTwinV4 = z.infer<typeof LearnerTwinV4Schema>;

const ForecastCandidateV4Schema = z.object({
  variantRef: LearnerAdaptationVariantRefV4Schema,
  predictedSuccessProbability: z.number().min(0).max(1),
  predictedOverloadProbability: z.number().min(0).max(1),
  predictedGrowthValue: z.number().min(0).max(1),
  rationale: NonEmptyTextSchema.max(600),
}).strict();
type AdaptationVariantRefV4 = z.infer<typeof LearnerAdaptationVariantRefV4Schema>;

const LearnerForecastV4Schema = z.object({
  forecastRef: IdSchema,
  revision: z.number().int().positive().default(1),
  assessorMode: z.enum(["independent_live_agent", "deterministic_fallback"]),
  learnerTwinContentHash: HashSchema,
  candidates: z.array(ForecastCandidateV4Schema).length(4),
  selectedVariantRef: ForecastCandidateV4Schema.shape.variantRef,
  evidenceEligibleForScore: z.literal(false),
  canActForStudent: z.literal(false),
  generatedAt: TimestampSchema,
}).strict();
export type LearnerForecastV4 = z.infer<typeof LearnerForecastV4Schema>;

const LearnerProxyDraftOutputV4Schema = z.object({
  growthTargetRefs: z.array(AssessmentCriterionIdV4Schema).min(1).max(3),
  selectedVariantRef: ForecastCandidateV4Schema.shape.variantRef,
  candidates: z.array(ForecastCandidateV4Schema).length(4),
  limitations: z.array(NonEmptyTextSchema.max(500)).min(1).max(8),
}).strict().superRefine((draft, context) => {
  if (new Set(draft.growthTargetRefs).size !== draft.growthTargetRefs.length) {
    context.addIssue({
      code: "custom",
      path: ["growthTargetRefs"],
      message: "学习者代理成长靶点不得重复",
    });
  }
  const variants = draft.candidates.map((candidate) => candidate.variantRef);
  if (new Set(variants).size !== ForecastCandidateV4Schema.shape.variantRef.options.length
    || ForecastCandidateV4Schema.shape.variantRef.options.some(
      (variantRef) => !variants.includes(variantRef),
    )) {
    context.addIssue({
      code: "custom",
      path: ["candidates"],
      message: "学习者代理必须且只能比较服务端签发的四个反事实候选",
    });
  }
});

export interface LearnerProxyObservationV4 {
  runtimeVersion: typeof LearnerProxyRuntimeV4Version;
  sourceChallengeLevel: 3 | 4 | 5 | 6 | 7;
  sourceScaffoldingLevel: number;
  criterionStates: Array<{
    criterionId: AssessmentCriterionIdV4;
    evidenceStatus: "supported" | "mixed" | "refuted";
    band: "low" | "medium" | "high";
    score: number;
    confidence: number;
    supportEvidenceCount: number;
    counterEvidenceCount: number;
    uncertaintyDrivers: Array<
      | "limited_evidence"
      | "mixed_evidence"
      | "refuting_evidence"
      | "teacher_revision"
      | "cross_session_prediction_error"
    >;
    lastPredictionError: number | null;
  }>;
  calibrationHistory: Array<{
    variantRef: AdaptationVariantRefV4;
    predictedSuccessProbability: number;
    observedBehaviorAlignment: number;
    absolutePredictionError: number;
  }>;
  allowedVariants: Array<{
    variantRef: AdaptationVariantRefV4;
    title: string;
    targetCriterionRefs: AssessmentCriterionIdV4[];
    mechanicalDifferenceCount: number;
    scaffoldingBudget: number;
    successEvidence: string[];
  }>;
  constraints: {
    evidenceEligibleForScore: false;
    canActForStudent: false;
    studentConsentRequired: true;
    teacherAuthorizationRequired: true;
    maximumChallengeChange: 1;
  };
  remainingBudgetMicros: number;
}

export interface LearnerProxyModelRunV4 {
  output: unknown;
  providerId: string;
  modelId: string;
  traceRef: string;
  latencyMs: number;
  estimatedCostMicros: number;
}

export interface LearnerProxyModelV4 {
  propose(
    input: Readonly<LearnerProxyObservationV4>,
  ): Promise<LearnerProxyModelRunV4>;
}

const LearnerProxyRunReceiptV4Schema = z.object({
  proxyRunRef: IdSchema,
  inputHash: HashSchema,
  outputHash: HashSchema,
  mode: z.enum(["independent_live_agent", "deterministic_fallback"]),
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
      message: "学习者代理模型运行字段必须同时存在或同时为空",
    });
  }
  if (receipt.mode === "independent_live_agent"
    && (receipt.fallbackReason !== null || receipt.providerId === null)) {
    context.addIssue({
      code: "custom",
      path: ["mode"],
      message: "Live 学习者代理必须具有私有运行收据且不得携带降级原因",
    });
  }
  if (receipt.mode === "deterministic_fallback" && receipt.fallbackReason === null) {
    context.addIssue({
      code: "custom",
      path: ["fallbackReason"],
      message: "确定性学习者代理必须说明降级原因",
    });
  }
});

const ConsentV4Schema = z.object({
  status: z.enum(["pending", "accepted", "declined"]),
  requestId: IdSchema.nullable(),
  decidedAt: TimestampSchema.nullable(),
}).strict().superRefine((consent, context) => {
  if ((consent.status === "pending") !== (
    consent.requestId === null && consent.decidedAt === null
  )) {
    context.addIssue({
      code: "custom",
      path: ["status"],
      message: "同意状态必须与请求及决定时间一致",
    });
  }
});

const AppealV4Schema = z.object({
  status: z.enum(["none", "open", "resolved"]),
  appealRef: IdSchema.nullable(),
  reason: NonEmptyTextSchema.max(1_000).nullable(),
  resolution: z.enum(["confirmed", "reopen_assessment"]).nullable(),
  teacherReason: NonEmptyTextSchema.max(1_000).nullable(),
  openedAt: TimestampSchema.nullable(),
  resolvedAt: TimestampSchema.nullable(),
}).strict().superRefine((appeal, context) => {
  if (appeal.status === "none" && Object.entries(appeal)
    .some(([key, value]) => key !== "status" && value !== null)) {
    context.addIssue({ code: "custom", path: ["status"], message: "无申诉不得携带申诉数据" });
  }
  if (appeal.status === "open" && (
    appeal.appealRef === null || appeal.reason === null || appeal.openedAt === null
    || appeal.resolution !== null || appeal.teacherReason !== null || appeal.resolvedAt !== null
  )) {
    context.addIssue({ code: "custom", path: ["status"], message: "开放申诉结构非法" });
  }
  if (appeal.status === "resolved" && Object.values({
    appealRef: appeal.appealRef,
    reason: appeal.reason,
    resolution: appeal.resolution,
    teacherReason: appeal.teacherReason,
    openedAt: appeal.openedAt,
    resolvedAt: appeal.resolvedAt,
  }).some((value) => value === null)) {
    context.addIssue({ code: "custom", path: ["status"], message: "已处理申诉缺少完整裁决链" });
  }
});

const RequestReceiptV4Schema = z.object({
  requestId: IdSchema,
  requestHash: HashSchema,
  operation: z.enum(["record_consent", "open_appeal", "review_appeal", "authorize_second_session"]),
  resultRef: IdSchema,
  createdAt: TimestampSchema,
}).strict();

const LearnerAdaptationRecordV4Schema = z.object({
  recordVersion: z.literal(LearnerAdaptationRecordV4Version),
  recordRevision: z.number().int().nonnegative(),
  sourceSessionId: IdSchema,
  learnerBindingId: IdSchema,
  learnerActorId: IdSchema,
  learnerSubjectHash: HashSchema,
  sourceAssessmentDecisionRef: IdSchema,
  sourceAssessmentHash: HashSchema,
  learnerTwin: LearnerTwinV4Schema,
  forecast: LearnerForecastV4Schema,
  consent: ConsentV4Schema,
  appeal: AppealV4Schema,
  handoff: SecondSessionHandoffV4Schema,
  proxyRuns: z.array(LearnerProxyRunReceiptV4Schema).max(32).default([]),
  requestReceipts: z.array(RequestReceiptV4Schema).max(128),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
}).strict().superRefine((record, context) => {
  if (record.learnerTwin.sourceAssessmentDecisionRef
    !== record.sourceAssessmentDecisionRef) {
    context.addIssue({
      code: "custom",
      path: ["learnerTwin", "sourceAssessmentDecisionRef"],
      message: "学习者模型必须来自当前最终评价",
    });
  }
  if (record.forecast.learnerTwinContentHash !== record.learnerTwin.contentHash) {
    context.addIssue({
      code: "custom",
      path: ["forecast", "learnerTwinContentHash"],
      message: "预测必须绑定当前学习者模型哈希",
    });
  }
  if (record.handoff.learnerSubjectHash !== record.learnerSubjectHash
    || record.handoff.learnerTwinRef !== record.learnerTwin.learnerTwinRef
    || record.handoff.learnerTwinContentHash !== record.learnerTwin.contentHash
    || record.handoff.sourceAssessmentDecisionRef !== record.sourceAssessmentDecisionRef) {
    context.addIssue({
      code: "custom",
      path: ["handoff"],
      message: "第二场交接必须绑定同一主体、模型与最终评价",
    });
  }
  const proxyRunRefs = record.proxyRuns.map((run) => run.proxyRunRef);
  if (new Set(proxyRunRefs).size !== proxyRunRefs.length) {
    context.addIssue({
      code: "custom",
      path: ["proxyRuns"],
      message: "学习者代理运行收据不得重复",
    });
  }
});
export type LearnerAdaptationRecordV4 = z.infer<
  typeof LearnerAdaptationRecordV4Schema
>;

export interface LearnerAdaptationStoreV4 {
  load(sourceSessionId: string): Promise<LearnerAdaptationRecordV4 | null>;
  create(record: LearnerAdaptationRecordV4): Promise<void>;
  compareAndSet(
    sourceSessionId: string,
    expectedRevision: number,
    next: LearnerAdaptationRecordV4,
  ): Promise<void>;
}

export class LearnerAdaptationErrorV4 extends Error {
  constructor(
    public readonly code:
      | "not_ready"
      | "access_denied"
      | "source_drift"
      | "revision_conflict"
      | "request_replay_conflict"
      | "consent_required"
      | "appeal_open"
      | "invalid_transition"
      | "provisioning_failed",
    message: string,
  ) {
    super(message);
    this.name = "LearnerAdaptationErrorV4";
  }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

function stableId(prefix: string, value: unknown): string {
  return `${prefix}-${hash(value).slice(0, 24)}`;
}

function validateRecord(value: unknown): LearnerAdaptationRecordV4 {
  return LearnerAdaptationRecordV4Schema.parse(value);
}

export class InMemoryLearnerAdaptationStoreV4 implements LearnerAdaptationStoreV4 {
  readonly #records = new Map<string, LearnerAdaptationRecordV4>();

  async load(sourceSessionId: string): Promise<LearnerAdaptationRecordV4 | null> {
    const record = this.#records.get(sourceSessionId);
    return record ? structuredClone(record) : null;
  }

  async create(record: LearnerAdaptationRecordV4): Promise<void> {
    const parsed = validateRecord(record);
    if (this.#records.has(parsed.sourceSessionId)) {
      throw new LearnerAdaptationErrorV4("revision_conflict", "V4 自适应记录已经存在");
    }
    this.#records.set(parsed.sourceSessionId, structuredClone(parsed));
  }

  async compareAndSet(
    sourceSessionId: string,
    expectedRevision: number,
    next: LearnerAdaptationRecordV4,
  ): Promise<void> {
    const current = this.#records.get(sourceSessionId);
    if (!current || current.recordRevision !== expectedRevision) {
      throw new LearnerAdaptationErrorV4("revision_conflict", "V4 自适应记录已被并发更新");
    }
    const parsed = validateRecord(next);
    if (parsed.sourceSessionId !== sourceSessionId
      || parsed.recordRevision !== expectedRevision + 1) {
      throw new LearnerAdaptationErrorV4("revision_conflict", "V4 自适应 CAS 后继修订非法");
    }
    this.#records.set(sourceSessionId, structuredClone(parsed));
  }
}

export class JsonFileLearnerAdaptationStoreV4 implements LearnerAdaptationStoreV4 {
  constructor(private readonly directory: string) {}

  async load(sourceSessionId: string): Promise<LearnerAdaptationRecordV4 | null> {
    try {
      const record = validateRecord(JSON.parse(await readFile(this.#path(sourceSessionId), "utf8")));
      if (record.sourceSessionId !== sourceSessionId) {
        throw new LearnerAdaptationErrorV4("source_drift", "V4 自适应文件跨会话");
      }
      return record;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async create(record: LearnerAdaptationRecordV4): Promise<void> {
    const parsed = validateRecord(record);
    if (await this.load(parsed.sourceSessionId)) {
      throw new LearnerAdaptationErrorV4("revision_conflict", "V4 自适应记录已经存在");
    }
    await this.#write(parsed);
  }

  async compareAndSet(
    sourceSessionId: string,
    expectedRevision: number,
    next: LearnerAdaptationRecordV4,
  ): Promise<void> {
    const current = await this.load(sourceSessionId);
    if (!current || current.recordRevision !== expectedRevision) {
      throw new LearnerAdaptationErrorV4("revision_conflict", "V4 自适应记录已被并发更新");
    }
    const parsed = validateRecord(next);
    if (parsed.sourceSessionId !== sourceSessionId
      || parsed.recordRevision !== expectedRevision + 1) {
      throw new LearnerAdaptationErrorV4("revision_conflict", "V4 自适应 CAS 后继修订非法");
    }
    await this.#write(parsed);
  }

  #path(sourceSessionId: string): string {
    return resolve(this.directory, `${hash(sourceSessionId)}.json`);
  }

  async #write(record: LearnerAdaptationRecordV4): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const target = this.#path(record.sourceSessionId);
    const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
    const file = await open(temporary, "wx");
    let renamed = false;
    try {
      await file.writeFile(`${JSON.stringify(record)}\n`, "utf8");
      await file.sync();
      await file.close();
      await rename(temporary, target);
      renamed = true;
    } finally {
      await file.close().catch(() => undefined);
      if (!renamed) await unlink(temporary).catch(() => undefined);
    }
  }
}

const criterionTitles: Record<AssessmentCriterionIdV4, string> = {
  "criterion-fact-verification": "事实核验",
  "criterion-interview-consent": "采访沟通与同意",
  "criterion-editorial-judgment": "编辑判断",
  "criterion-rights-governance": "权利治理",
  "criterion-multiplatform-production": "融媒体制作",
  "criterion-recovery-transfer": "纠错与迁移",
};

const variantByCriterion: Record<AssessmentCriterionIdV4, AdaptationVariantRefV4> = {
  "criterion-fact-verification": "variant-xunpu-source-triangulation",
  "criterion-interview-consent": "variant-xunpu-consent-negotiation",
  "criterion-editorial-judgment": "variant-xunpu-editorial-independence",
  "criterion-rights-governance": "variant-xunpu-consent-negotiation",
  "criterion-multiplatform-production": "variant-xunpu-deadline-service",
  "criterion-recovery-transfer": "variant-xunpu-deadline-service",
};

const refutingEvidenceCodes = new Set([
  "fabricated_reference_detected",
  "unsupported_claim_detected",
  "current_unsupported_claim",
  "consent_ignored",
  "commercial_exchange_hidden",
  "withdrawal_ignored",
  "rights_scope_exceeded",
  "text_only_submission",
  "silent_edit_detected",
]);

function targetCriteriaForVariant(
  variantRef: AdaptationVariantRefV4,
): AssessmentCriterionIdV4[] {
  const variant = xunpuV4AdaptationVariants.find(
    (candidate) => candidate.variantId === variantRef,
  )!;
  return [...new Set([
    ...variant.triggerCriterionRefs,
    ...Object.entries(variantByCriterion).flatMap(([criterionId, mapped]) => (
      mapped === variantRef ? [criterionId] : []
    )),
  ])].map((criterionId) => AssessmentCriterionIdV4Schema.parse(criterionId));
}

const focusEventIds: Record<AdaptationVariantRefV4, string[]> = {
  "variant-xunpu-source-triangulation": [
    "event-template-source-check",
    "event-template-compare-sources",
    "event-template-researcher-probe",
    "event-template-official-request",
    "event-template-verification-wait",
  ],
  "variant-xunpu-consent-negotiation": [
    "event-template-gatekeeper",
    "event-template-community-source",
    "event-template-inheritor",
    "event-template-rights-inspection",
    "event-template-visual-consent",
    "event-template-consent-withdrawal",
  ],
  "variant-xunpu-deadline-service": [
    "event-template-limited-alert",
    "event-template-official-request",
    "event-template-verification-wait",
    "event-template-clock",
    "event-template-publication",
  ],
  "variant-xunpu-editorial-independence": [
    "event-template-topic-brief",
    "event-template-shopkeeper",
    "event-template-platform-feedback",
    "event-template-community-challenge",
    "event-template-draft",
  ],
};

const resistanceEntityId: Record<AdaptationVariantRefV4, string> = {
  "variant-xunpu-source-triangulation": "entity-researcher",
  "variant-xunpu-consent-negotiation": "entity-community-source",
  "variant-xunpu-deadline-service": "entity-public-liaison",
  "variant-xunpu-editorial-independence": "entity-shopkeeper",
};

const durationByVariant: Record<AdaptationVariantRefV4, number> = {
  "variant-xunpu-source-triangulation": 52,
  "variant-xunpu-consent-negotiation": 50,
  "variant-xunpu-deadline-service": 45,
  "variant-xunpu-editorial-independence": 48,
};

const essentialEventIds = [
  "event-template-topic-brief",
  "event-template-gatekeeper",
  "event-template-source-check",
  "event-template-clock",
  "event-template-draft",
  "event-template-publication",
  "event-template-teacher-pause",
];

export interface DerivedSecondSessionReleaseV4 {
  release: WorldSimulationRelease;
  changedMechanics: NonNullable<Extract<
    SecondSessionHandoffV4,
    { status: "proposed" }
  >["proposal"]>["changedMechanics"];
  selectedWorldVariantRef: string;
}

/**
 * Builds an immutable runtime release whose differences are executable rather
 * than descriptive: event availability, NPC cues, evidence conditions,
 * deadline and scaffolding are all part of the parsed world release.
 */
export function deriveSecondSessionReleaseV4(input: {
  baseRelease: WorldSimulationRelease;
  variant: XunpuAdaptationVariantV4;
  targetChallengeLevel: 3 | 4 | 5 | 6 | 7;
}): DerivedSecondSessionReleaseV4 {
  const base = WorldSimulationReleaseSchema.parse(input.baseRelease);
  const variantRef = ForecastCandidateV4Schema.shape.variantRef.parse(
    input.variant.variantId,
  );
  const focusedEventIds = focusEventIds[variantRef];
  const baseVariant = base.challengeVariants.find(
    (candidate) => candidate.challengeLevel === input.targetChallengeLevel,
  )!;
  const knownEventIds = new Set(base.eventTemplates.map((event) => event.eventTemplateId));
  const targetRefs = [...new Set([
    ...essentialEventIds,
    ...focusedEventIds,
  ])].filter((eventId) => knownEventIds.has(eventId));
  if (targetRefs.length < 6) {
    throw new LearnerAdaptationErrorV4(
      "source_drift",
      "基础世界缺少第二场所需的可执行事件模板",
    );
  }
  const targetSet = new Set(targetRefs);
  const resistanceTarget = resistanceEntityId[variantRef];
  const worldEntities = base.worldEntities.map((entity) => entity.entityId === resistanceTarget
    ? {
        ...entity,
        publicDescription: `${entity.publicDescription} 第二场行为约束：${input.variant.npcResistance}`.slice(0, 800),
        initialStateHash: hash({
          source: entity.initialStateHash,
          resistance: input.variant.npcResistance,
        }),
      }
    : entity);
  const eventTemplates = base.eventTemplates.flatMap((template) => {
    const levels = new Set(template.challengeLevels);
    if (targetSet.has(template.eventTemplateId)) levels.add(input.targetChallengeLevel);
    else levels.delete(input.targetChallengeLevel);
    if (levels.size === 0) return [];
    const focused = focusedEventIds.includes(template.eventTemplateId);
    return [{
      ...template,
      challengeLevels: [...levels].sort() as Array<3 | 4 | 5 | 6 | 7>,
      publicCue: focused
        ? `${template.publicCue} 第二场新增条件：${input.variant.evidenceAvailability} ${input.variant.deadlinePattern}`.slice(0, 500)
        : template.publicCue,
    }];
  });
  const survivingIds = new Set(eventTemplates.map((event) => event.eventTemplateId));
  const selectedWorldVariantRef = `world-variant-v4-${input.variant.variantId.replace("variant-xunpu-", "")}-level-${input.targetChallengeLevel}`;
  const challengeVariants = base.challengeVariants.map((variant) => {
    if (variant.challengeLevel === input.targetChallengeLevel) {
      return {
        ...variant,
        worldVariantId: selectedWorldVariantRef,
        pressureSummary: `${input.targetChallengeLevel} 级第二场：${input.variant.npcResistance}${input.variant.deadlinePattern}`.slice(0, 320),
        eventTemplateRefs: targetRefs,
        scaffoldingBudget: input.variant.scaffoldingBudget,
      };
    }
    return {
      ...variant,
      eventTemplateRefs: variant.eventTemplateRefs.filter((eventId) => survivingIds.has(eventId)),
    };
  });
  const scenarioReleaseRef = {
    ...base.scenarioReleaseRef,
    version: `${base.scenarioReleaseRef.version}-adapt-${input.variant.variantId.replace("variant-xunpu-", "")}-l${input.targetChallengeLevel}`,
    contentHash: hash({
      base: base.scenarioReleaseRef,
      variant: input.variant,
      targetRefs,
    }),
  };
  const releaseWithoutRef = {
    ...base,
    scenarioReleaseRef,
    title: `${base.title}｜${input.variant.title}`,
    summary: `${base.summary} 本次依据上一场可复核证据改变冲突机制，预测不进入评分。`,
    expectedDurationMinutes: durationByVariant[variantRef],
    worldEntities,
    eventTemplates,
    challengeVariants,
  };
  const release = WorldSimulationReleaseSchema.parse({
    ...releaseWithoutRef,
    simulationReleaseRef: {
      simulationId: base.simulationReleaseRef.simulationId,
      releaseId: `${base.simulationReleaseRef.releaseId}-adapt-${input.variant.variantId.replace("variant-xunpu-", "")}-l${input.targetChallengeLevel}`,
      version: base.simulationReleaseRef.version + 1,
      contentHash: hash({
        base: base.simulationReleaseRef,
        releaseWithoutRef: {
          ...releaseWithoutRef,
          simulationReleaseRef: undefined,
        },
      }),
    },
  });
  const mechanics = [
    {
      mechanicKind: "event_templates" as const,
      before: baseVariant.eventTemplateRefs,
      after: targetRefs,
      safeSummary: `第二场只保留基础岗位链，并强化 ${input.variant.changedEventTemplateRefs.length} 组目标冲突事件。`,
    },
    {
      mechanicKind: "npc_resistance" as const,
      before: base.worldEntities.find((entity) => entity.entityId === resistanceTarget)?.publicDescription ?? "未声明",
      after: worldEntities.find((entity) => entity.entityId === resistanceTarget)?.publicDescription ?? input.variant.npcResistance,
      safeSummary: input.variant.npcResistance,
    },
    {
      mechanicKind: "evidence_availability" as const,
      before: focusedEventIds.map((eventId) => base.eventTemplates.find((event) => event.eventTemplateId === eventId)?.publicCue ?? null),
      after: focusedEventIds.map((eventId) => eventTemplates.find((event) => event.eventTemplateId === eventId)?.publicCue ?? null),
      safeSummary: input.variant.evidenceAvailability,
    },
    {
      mechanicKind: "deadline_pattern" as const,
      before: base.expectedDurationMinutes,
      after: durationByVariant[variantRef],
      safeSummary: input.variant.deadlinePattern,
    },
    {
      mechanicKind: "scaffolding_budget" as const,
      before: baseVariant.scaffoldingBudget,
      after: input.variant.scaffoldingBudget,
      safeSummary: `支架预算从 ${baseVariant.scaffoldingBudget} 次调整为 ${input.variant.scaffoldingBudget} 次；建议仍须学生自主决定。`,
    },
  ].flatMap((mechanic) => {
    const beforeHash = hash(mechanic.before);
    const afterHash = hash(mechanic.after);
    return beforeHash === afterHash ? [] : [{
      mechanicKind: mechanic.mechanicKind,
      beforeHash,
      afterHash,
      safeSummary: mechanic.safeSummary,
    }];
  });
  if (mechanics.length < 2) {
    throw new LearnerAdaptationErrorV4(
      "source_drift",
      "第二场没有形成至少两项真实运行机制变化",
    );
  }
  return { release, changedMechanics: mechanics, selectedWorldVariantRef };
}

export interface ProvisionSecondSessionInputV4 {
  sourceSessionId: string;
  learnerBindingId: string;
  learnerActorId: string;
  learnerSubjectHash: string;
  learnerTwin: LearnerTwinV4;
  forecast: LearnerForecastV4;
  teacherActorId: string;
  teacherPrincipalId: string;
  teacherAuthorizationRef: string;
  release: WorldSimulationRelease;
  challengeAssignment: ChallengeAssignment;
  targetCompetencyRefs: AssessmentCriterionIdV4[];
  scaffoldingLevel: number;
  requestedAt: string;
}

export type ProvisionSecondSessionV4 = (
  input: ProvisionSecondSessionInputV4,
) => Promise<Extract<SecondSessionHandoffV4, { status: "provisioned" }>["provision"]>;

export interface LearnerAdaptationServiceV4Options {
  assessment: Pick<FlagshipEvidenceAssessmentServiceV4, "getAssessment">;
  engine: Pick<WorldSimulationEngineV3, "getRecord">;
  store: LearnerAdaptationStoreV4;
  provisionSecondSession?: ProvisionSecondSessionV4;
  learnerProxyModel?: LearnerProxyModelV4;
  learnerProxyTimeoutMs?: number;
  learnerProxyBudgetMicros?: number;
  now?: () => string;
}

function eligibleDecision(record: FlagshipAssessmentRecordV4): EvidenceAssessmentDecisionV4 | null {
  const decision = currentFlagshipAssessmentDecisionV4(record);
  if (decision.status !== "final"
    || decision.rubricReviewStatus !== "verified"
    || decision.teacherReview.status === "pending"
    || decision.sessionScore === null
    || decision.criterionAssessments.some((criterion) => (
      criterion.score === null || criterion.band === null || criterion.evidenceRefs.length === 0
    ))) return null;
  return decision;
}

function targetLevelFor(
  source: 3 | 4 | 5 | 6 | 7,
  score: number,
): 3 | 4 | 5 | 6 | 7 {
  const delta = score >= 85 ? 1 : score <= 60 ? -1 : 0;
  return Math.max(3, Math.min(7, source + delta)) as 3 | 4 | 5 | 6 | 7;
}

function pressureDimensionsFor(
  variantRef: AdaptationVariantRefV4,
  level: 3 | 4 | 5 | 6 | 7,
): ChallengeAssignment["pressureDimensions"] {
  const secondary = Math.max(3, level - 1) as 3 | 4 | 5 | 6 | 7;
  if (variantRef === "variant-xunpu-source-triangulation") {
    return [
      { dimensionId: "source_access", intensity: level },
      { dimensionId: "time", intensity: secondary },
    ];
  }
  if (variantRef === "variant-xunpu-consent-negotiation") {
    return [
      { dimensionId: "relationship_conflict", intensity: level },
      { dimensionId: "copyright_risk", intensity: secondary },
    ];
  }
  if (variantRef === "variant-xunpu-editorial-independence") {
    return [
      { dimensionId: "editorial_pressure", intensity: level },
      { dimensionId: "platform_risk", intensity: secondary },
    ];
  }
  return [
    { dimensionId: "time", intensity: level },
    { dimensionId: "source_access", intensity: secondary },
  ];
}

class LearnerProxyTimeoutError extends Error {}

async function withLearnerProxyTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new LearnerProxyTimeoutError("学习者代理模型超时")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function safeProxyText(value: string): boolean {
  return !/(?:prompt|trace|provider|binding|actor|session|token|api.?key|身份证|手机号|住址|性别|民族|家庭收入)/iu
    .test(value);
}

function validLearnerProxyRun(run: LearnerProxyModelRunV4): boolean {
  return run.providerId.trim().length > 0
    && run.providerId.length <= 100
    && run.modelId.trim().length > 0
    && run.modelId.length <= 200
    && IdSchema.safeParse(run.traceRef).success
    && Number.isFinite(run.latencyMs)
    && run.latencyMs >= 0
    && Number.isInteger(run.estimatedCostMicros)
    && run.estimatedCostMicros >= 0;
}

type LearnerProxyDraftV4 = z.infer<typeof LearnerProxyDraftOutputV4Schema>;

interface LearnerProxyDraftResultV4 {
  draft: LearnerProxyDraftV4;
  mode: "independent_live_agent" | "deterministic_fallback";
  receipt: z.infer<typeof LearnerProxyRunReceiptV4Schema>;
}

export class LearnerAdaptationServiceV4 {
  readonly #locks = new Map<string, Promise<void>>();
  readonly #proxyTimeoutMs: number;
  readonly #proxyBudgetMicros: number;

  constructor(private readonly options: LearnerAdaptationServiceV4Options) {
    this.#proxyTimeoutMs = options.learnerProxyTimeoutMs ?? 4_000;
    this.#proxyBudgetMicros = options.learnerProxyBudgetMicros ?? 150_000;
    if (!Number.isInteger(this.#proxyTimeoutMs)
      || this.#proxyTimeoutMs < 1
      || this.#proxyTimeoutMs > 30_000) {
      throw new Error("V4 学习者代理模型超时必须在 1—30000 毫秒之间");
    }
    if (!Number.isInteger(this.#proxyBudgetMicros) || this.#proxyBudgetMicros < 0) {
      throw new Error("V4 学习者代理模型预算非法");
    }
  }

  async getOrRefresh(input: {
    sessionId: string;
    fallbackLearner?: { bindingId: string; actorId: string };
  }): Promise<LearnerAdaptationRecordV4 | null> {
    return this.#serialized(input.sessionId, async () => {
      const assessment = await this.options.assessment.getAssessment(input);
      if (!assessment) return null;
      const decision = eligibleDecision(assessment);
      if (!decision) return null;
      if (input.fallbackLearner && (
        input.fallbackLearner.bindingId !== assessment.learnerBindingId
        || input.fallbackLearner.actorId !== assessment.learnerActorId
      )) {
        throw new LearnerAdaptationErrorV4("access_denied", "学生只能读取自己的自适应方案");
      }
      const current = await this.options.store.load(input.sessionId);
      if (current) {
        if (current.learnerBindingId !== assessment.learnerBindingId
          || current.learnerActorId !== assessment.learnerActorId
          || current.learnerSubjectHash !== assessment.learnerSubjectHash) {
          throw new LearnerAdaptationErrorV4("source_drift", "评价主体与已冻结自适应记录不一致");
        }
        if (current.sourceAssessmentDecisionRef !== decision.assessmentDecisionId
          || current.sourceAssessmentHash !== hash(decision)) {
          throw new LearnerAdaptationErrorV4("source_drift", "最终评价在第二场规划后发生漂移");
        }
        return this.#calibrateIfReady(current);
      }
      const sourceWorld = await this.options.engine.getRecord(input.sessionId);
      const created = await this.#buildRecord(assessment, decision, sourceWorld.release,
        sourceWorld.challengeAssignment.challengeLevel as 3 | 4 | 5 | 6 | 7,
        sourceWorld.currentSnapshot.learningContext.scaffoldingLevel, Boolean(sourceWorld.fieldInterview));
      await this.options.store.create(created);
      return created;
    });
  }

  async recordConsent(input: {
    sessionId: string;
    learnerBindingId: string;
    learnerActorId: string;
    requestId: string;
    accepted: boolean;
  }): Promise<LearnerAdaptationRecordV4> {
    return this.#serialized(input.sessionId, async () => {
      const record = await this.#required(input.sessionId);
      this.#assertLearner(record, input.learnerBindingId, input.learnerActorId);
      const requestHash = hash(input);
      const replay = this.#receipt(record, input.requestId, requestHash);
      if (replay) return record;
      if (record.appeal.status === "open") {
        throw new LearnerAdaptationErrorV4("appeal_open", "画像申诉处理前不能确认第二场");
      }
      if (!["proposed"].includes(record.handoff.status)) {
        throw new LearnerAdaptationErrorV4("invalid_transition", "当前第二场状态不接受新的学生同意决定");
      }
      const now = this.#now();
      const next = validateRecord({
        ...record,
        recordRevision: record.recordRevision + 1,
        consent: {
          status: input.accepted ? "accepted" : "declined",
          requestId: input.requestId,
          decidedAt: now,
        },
        requestReceipts: [...record.requestReceipts, {
          requestId: input.requestId,
          requestHash,
          operation: "record_consent",
          resultRef: record.handoff.handoffId,
          createdAt: now,
        }],
        updatedAt: now,
      });
      await this.options.store.compareAndSet(input.sessionId, record.recordRevision, next);
      return next;
    });
  }

  async requestAppeal(input: {
    sessionId: string;
    learnerBindingId: string;
    learnerActorId: string;
    requestId: string;
    reason: string;
  }): Promise<LearnerAdaptationRecordV4> {
    return this.#serialized(input.sessionId, async () => {
      const record = await this.#required(input.sessionId);
      this.#assertLearner(record, input.learnerBindingId, input.learnerActorId);
      const requestHash = hash(input);
      const replay = this.#receipt(record, input.requestId, requestHash);
      if (replay) return record;
      if (record.handoff.status !== "proposed" || record.appeal.status === "open") {
        throw new LearnerAdaptationErrorV4("invalid_transition", "当前状态不能发起新的画像申诉");
      }
      const now = this.#now();
      const appealRef = stableId("adaptation-appeal-v4", { source: input.sessionId, requestId: input.requestId });
      const next = validateRecord({
        ...record,
        recordRevision: record.recordRevision + 1,
        appeal: {
          status: "open",
          appealRef,
          reason: input.reason,
          resolution: null,
          teacherReason: null,
          openedAt: now,
          resolvedAt: null,
        },
        consent: { status: "pending", requestId: null, decidedAt: null },
        requestReceipts: [...record.requestReceipts, {
          requestId: input.requestId,
          requestHash,
          operation: "open_appeal",
          resultRef: appealRef,
          createdAt: now,
        }],
        updatedAt: now,
      });
      await this.options.store.compareAndSet(input.sessionId, record.recordRevision, next);
      return next;
    });
  }

  async reviewAppeal(input: {
    sessionId: string;
    teacherActorId: string;
    requestId: string;
    expectedAppealRef: string;
    resolution: "confirmed" | "reopen_assessment";
    reason: string;
  }): Promise<LearnerAdaptationRecordV4> {
    return this.#serialized(input.sessionId, async () => {
      const record = await this.#required(input.sessionId);
      const requestHash = hash(input);
      const replay = this.#receipt(record, input.requestId, requestHash);
      if (replay) return record;
      if (record.appeal.status !== "open"
        || record.appeal.appealRef !== input.expectedAppealRef) {
        throw new LearnerAdaptationErrorV4("source_drift", "申诉已变化，请刷新后再处理");
      }
      const now = this.#now();
      const next = validateRecord({
        ...record,
        recordRevision: record.recordRevision + 1,
        appeal: {
          ...record.appeal,
          status: "resolved",
          resolution: input.resolution,
          teacherReason: input.reason,
          resolvedAt: now,
        },
        requestReceipts: [...record.requestReceipts, {
          requestId: input.requestId,
          requestHash,
          operation: "review_appeal",
          resultRef: input.expectedAppealRef,
          createdAt: now,
        }],
        updatedAt: now,
      });
      await this.options.store.compareAndSet(input.sessionId, record.recordRevision, next);
      return next;
    });
  }

  async authorizeAndProvision(input: {
    sessionId: string;
    teacherActorId: string;
    teacherPrincipalId: string;
    requestId: string;
    expectedHandoffId: string;
  }): Promise<LearnerAdaptationRecordV4> {
    return this.#serialized(input.sessionId, async () => {
      let record = await this.#required(input.sessionId);
      const requestHash = hash(input);
      const replay = this.#receipt(record, input.requestId, requestHash);
      if (replay && ["provisioned", "calibration_completed"].includes(record.handoff.status)) {
        return record;
      }
      if (record.handoff.handoffId !== input.expectedHandoffId) {
        throw new LearnerAdaptationErrorV4("source_drift", "第二场方案已变化，请刷新后再授权");
      }
      if (record.consent.status !== "accepted") {
        throw new LearnerAdaptationErrorV4("consent_required", "学生尚未明确同意进入第二场");
      }
      if (record.appeal.status === "open"
        || (record.appeal.status === "resolved"
          && record.appeal.resolution === "reopen_assessment")) {
        throw new LearnerAdaptationErrorV4("appeal_open", "画像申诉或重新评价尚未关闭");
      }
      if (record.handoff.status !== "proposed"
        && !(record.handoff.status === "authorized" && replay)) {
        if (["provisioned", "calibration_completed"].includes(record.handoff.status)) return record;
        throw new LearnerAdaptationErrorV4("invalid_transition", "当前第二场状态不能授权");
      }
      if (!this.options.provisionSecondSession) {
        throw new LearnerAdaptationErrorV4("provisioning_failed", "当前运行模式没有第二场创建器");
      }
      const now = this.#now();
      const sourceWorld = await this.options.engine.getRecord(input.sessionId);
      const proposal = record.handoff.proposal;
      if (!proposal) {
        throw new LearnerAdaptationErrorV4("source_drift", "第二场授权缺少已同意的机制方案");
      }
      const targetChallengeLevel = proposal.targetChallengeLevel as 3 | 4 | 5 | 6 | 7;
      const variant = xunpuV4AdaptationVariants.find(
        (candidate) => candidate.variantId === proposal.variantRef,
      )!;
      const derived = deriveSecondSessionReleaseV4({
        baseRelease: sourceWorld.release,
        variant,
        targetChallengeLevel,
      });
      if (hash(derived.changedMechanics) !== hash(proposal.changedMechanics)) {
        throw new LearnerAdaptationErrorV4("source_drift", "授权时第二场运行机制与已同意方案不一致");
      }
      const sourceAssessment = await this.options.assessment.getAssessment({
        sessionId: input.sessionId,
      });
      const sourceDecision = sourceAssessment
        ? currentFlagshipAssessmentDecisionV4(sourceAssessment)
        : null;
      if (!sourceDecision
        || sourceDecision.assessmentDecisionId !== record.sourceAssessmentDecisionRef
        || hash(sourceDecision) !== record.sourceAssessmentHash) {
        throw new LearnerAdaptationErrorV4("source_drift", "授权时最终评价已发生变化");
      }
      const teacherAuthorizationRef = record.handoff.status === "authorized"
        ? record.handoff.teacherAuthorizationRef
        : stableId("second-session-authorization-v4", {
            handoffId: record.handoff.handoffId,
            teacherActorId: input.teacherActorId,
            teacherPrincipalId: input.teacherPrincipalId,
            requestId: input.requestId,
          });
      if (record.handoff.status === "proposed") {
        const authorizedHandoff = SecondSessionHandoffV4Schema.parse({
          ...record.handoff,
          status: "authorized",
          teacherAuthorizationRef,
          writeDisposition: "authorization_only",
        });
        if (authorizedHandoff.status !== "authorized") {
          throw new LearnerAdaptationErrorV4("source_drift", "第二场授权状态解析失败");
        }
        const authorized = validateRecord({
          ...record,
          recordRevision: record.recordRevision + 1,
          handoff: authorizedHandoff,
          requestReceipts: [...record.requestReceipts, {
            requestId: input.requestId,
            requestHash,
            operation: "authorize_second_session",
            resultRef: teacherAuthorizationRef,
            createdAt: now,
          }],
          updatedAt: now,
        });
        await this.options.store.compareAndSet(input.sessionId, record.recordRevision, authorized);
        record = authorized;
      }
      const secondSessionId = stableId("training-adaptive-v4", {
        handoffId: record.handoff.handoffId,
        learnerSubjectHash: record.learnerSubjectHash,
      });
      const challengeAssignment = ChallengeAssignmentSchema.parse({
        schemaVersion: ChallengeAssignmentSchemaVersion,
        challengeAssignmentId: stableId("challenge-adaptive-v4", record.handoff.handoffId),
        learnerTwinRef: record.learnerTwin.learnerTwinRef,
        sessionId: secondSessionId,
        simulationReleaseRef: derived.release.simulationReleaseRef,
        worldVariantRef: derived.selectedWorldVariantRef,
        previousChallengeLevel: proposal.sourceChallengeLevel,
        challengeLevel: targetChallengeLevel,
        scoreCeiling: challengeScoreCeiling(targetChallengeLevel),
        pressureDimensions: pressureDimensionsFor(proposal.variantRef, targetChallengeLevel),
        assignmentReason: targetChallengeLevel > proposal.sourceChallengeLevel
          ? "evidence_progression"
          : "evidence_recovery",
        basisEvidenceRefs: sourceDecision.evidenceRefs,
        forecastRef: record.forecast.forecastRef,
        teacherOverride: null,
        policyVersion: "evidence-adaptation-v4/1.0.0",
        policyContentHash: hash({
          policy: "final-evidence-one-level-max-student-consent-teacher-authorization",
          variants: xunpuV4AdaptationVariants,
        }),
        assignedAt: now,
      });
      let provision: Awaited<ReturnType<ProvisionSecondSessionV4>>;
      try {
        provision = await this.options.provisionSecondSession({
          sourceSessionId: input.sessionId,
          learnerBindingId: record.learnerBindingId,
          learnerActorId: record.learnerActorId,
          learnerSubjectHash: record.learnerSubjectHash,
          learnerTwin: record.learnerTwin,
          forecast: record.forecast,
          teacherActorId: input.teacherActorId,
          teacherPrincipalId: input.teacherPrincipalId,
          teacherAuthorizationRef,
          release: derived.release,
          challengeAssignment,
          targetCompetencyRefs: [...record.learnerTwin.growthTargetRefs],
          scaffoldingLevel: Math.min(3, variant.scaffoldingBudget),
          requestedAt: now,
        });
      } catch (error) {
        if (error instanceof LearnerAdaptationErrorV4) throw error;
        throw new LearnerAdaptationErrorV4(
          "provisioning_failed",
          "第二场尚未激活；授权回执已保留，可安全继续创建",
        );
      }
      const provisioned = validateRecord({
        ...record,
        recordRevision: record.recordRevision + 1,
        handoff: SecondSessionHandoffV4Schema.parse({
          ...record.handoff,
          status: "provisioned",
          provision,
          writeDisposition: "committed",
        }),
        updatedAt: this.#now(),
      });
      await this.options.store.compareAndSet(input.sessionId, record.recordRevision, provisioned);
      return provisioned;
    });
  }

  projectView(
    record: LearnerAdaptationRecordV4 | null,
    audience: "student" | "teacher",
  ) {
    if (!record) {
      return {
        schemaVersion: LearnerAdaptationViewV4Version,
        audience,
        state: "evidence_required" as const,
        safeMessage: "只有六维岗位证据经教师终裁后，系统才会建立可申诉的能力模型并提出第二场。",
        boundaries: this.#publicBoundaries(),
        learnerModel: null,
        forecast: null,
        proposal: null,
        consent: null,
        appeal: null,
        handoff: null,
        nextAction: "先完成真实作品、世界行动与教师终裁。",
      };
    }
    const proposal = "proposal" in record.handoff ? record.handoff.proposal : null;
    const variant = proposal
      ? xunpuV4AdaptationVariants.find((candidate) => candidate.variantId === proposal.variantRef)!
      : null;
    const state = record.handoff.status === "calibration_completed"
      ? "calibrated"
      : record.handoff.status === "provisioned"
        ? "provisioned"
        : record.handoff.status === "failed"
          ? "failed"
          : record.appeal.status === "open"
            ? "appeal_open"
            : record.consent.status === "accepted"
              ? "consented"
              : "proposed";
    const provision = "provision" in record.handoff ? record.handoff.provision : null;
    const calibration = "calibration" in record.handoff ? record.handoff.calibration : null;
    const detailedCalibration = calibration
      && calibration.outcome !== undefined
      && calibration.observedBehaviorAlignment !== undefined
      && calibration.observationWindow !== undefined
      && calibration.completionBasis !== undefined
      && calibration.unmetRequirements !== undefined
      ? calibration
      : null;
    return {
      schemaVersion: LearnerAdaptationViewV4Version,
      audience,
      state,
      safeMessage: state === "provisioned"
        ? "学生同意且教师授权后，系统已经创建真实的第二场世界与记者岗位。"
        : state === "calibrated"
          ? "第二场真实行动已用于校准预测；校准结果不会反向冒充本轮成绩。"
          : record.handoff.status === "authorized"
            ? "教师授权已经记录，第二场仍在安全创建中；完成前不会显示为已开课。"
          : state === "appeal_open"
            ? "学生已对能力模型提出申诉，第二场创建已冻结。"
            : state === "failed"
              ? "第二场创建失败关闭，没有候选记录冒充真实会话。"
              : "系统依据最终证据提出第二场，但仍需学生同意与教师授权。",
      boundaries: this.#publicBoundaries(),
      learnerModel: {
        revision: record.learnerTwin.revision,
        calibrationCount: record.learnerTwin.calibrationCount,
        evidenceBased: true as const,
        personalityDiagnosis: false as const,
        limitations: [...record.learnerTwin.limitations],
        criteria: record.learnerTwin.criterionStates.map((criterion) => ({
          criterionId: criterion.criterionId,
          title: criterionTitles[criterion.criterionId],
          band: criterion.band,
          score: criterion.score,
          confidence: criterion.confidence,
          evidenceCount: criterion.evidenceRefs.length,
          supportEvidenceCount: criterion.supportEvidenceRefs.length,
          counterEvidenceCount: criterion.counterEvidenceRefs.length,
          uncertaintyDrivers: [...criterion.uncertaintyDrivers],
          lastPredictionError: criterion.lastPredictionError,
          growthTarget: record.learnerTwin.growthTargetRefs.includes(criterion.criterionId),
        })),
      },
      forecast: {
        mode: record.forecast.assessorMode,
        revision: record.forecast.revision,
        candidateCount: record.forecast.candidates.length,
        selectedVariantRef: record.forecast.selectedVariantRef,
        evidenceEligibleForScore: false as const,
        canActForStudent: false as const,
      },
      proposal: proposal && variant ? {
        handoffId: record.handoff.handoffId,
        variantRef: proposal.variantRef,
        title: variant.title,
        sourceChallengeLevel: proposal.sourceChallengeLevel,
        targetChallengeLevel: proposal.targetChallengeLevel,
        growthTargets: proposal.growthTargetRefs.map((criterionId) => ({
          criterionId,
          title: criterionTitles[criterionId as AssessmentCriterionIdV4] ?? criterionId,
        })),
        changedMechanics: proposal.changedMechanics.map((mechanic) => ({
          mechanicKind: mechanic.mechanicKind,
          safeSummary: mechanic.safeSummary,
        })),
        successEvidence: variant.successEvidence,
        ...(proposal.observationWindow
          ? { observationWindow: structuredClone(proposal.observationWindow) }
          : {}),
      } : null,
      consent: structuredClone(record.consent),
      appeal: {
        status: record.appeal.status,
        appealRef: record.appeal.appealRef,
        reason: record.appeal.reason,
        resolution: record.appeal.resolution,
        teacherReason: record.appeal.teacherReason,
      },
      handoff: {
        status: record.handoff.status,
        sessionRef: provision?.sessionRef ?? null,
        bindingRef: audience === "student" ? provision?.bindingRef ?? null : null,
        calibration: calibration ? {
          actionCount: calibration.actualStudentActionRefs.length,
          forecastError: calibration.forecastError,
          evidenceEligibleForScore: false as const,
          calibratedAt: calibration.calibratedAt,
          policyVersion: calibration.policyVersion
            ?? LearnerCalibrationLegacyPolicyVersionV4,
          ...(detailedCalibration
            ? {
                outcome: detailedCalibration.outcome,
                observedBehaviorAlignment: detailedCalibration.observedBehaviorAlignment,
                observationWindow: structuredClone(detailedCalibration.observationWindow),
                completionBasis: [...(detailedCalibration.completionBasis ?? [])],
                unmetRequirements: [...(detailedCalibration.unmetRequirements ?? [])],
              }
            : {}),
        } : null,
      },
      nextAction: state === "provisioned" || state === "calibrated"
        ? "进入第二场，面对已经改变的冲突与证据条件。"
        : record.handoff.status === "authorized"
          ? "由教师使用同一授权回执继续创建第二场。"
        : record.appeal.status === "open"
          ? "等待教师依据原始证据处理申诉。"
          : record.consent.status !== "accepted"
            ? "学生可先核对依据，选择同意、拒绝或申诉。"
            : "等待课程教师授权创建第二场。",
    };
  }

  projectAdminCase(record: LearnerAdaptationRecordV4) {
    return {
      schemaVersion: LearnerAdaptationAdminCaseV4Version,
      sourceSessionId: record.sourceSessionId,
      learnerSubjectHash: record.learnerSubjectHash,
      sourceAssessmentDecisionRef: record.sourceAssessmentDecisionRef,
      sourceAssessmentHash: record.sourceAssessmentHash,
      learnerTwin: {
        ...structuredClone(record.learnerTwin),
        calibrationHistory: record.learnerTwin.calibrationHistory.map((entry) => ({
          ...entry,
          policyVersion: entry.policyVersion ?? LearnerCalibrationLegacyPolicyVersionV4,
        })),
      },
      forecast: structuredClone(record.forecast),
      consent: structuredClone(record.consent),
      appeal: structuredClone(record.appeal),
      handoff: structuredClone(record.handoff),
      proxyRuns: structuredClone(record.proxyRuns),
      requestReceipts: structuredClone(record.requestReceipts),
      boundaries: {
        rawLearnerIdentityStored: false as const,
        rawStudentUtteranceStored: false as const,
        sensitiveAttributesExcluded: true as const,
        proxyCanActForStudent: false as const,
        proxyCanCreateEvidence: false as const,
        proxyCanScoreStudent: false as const,
        calibrationEvidenceEligibleForScore: false as const,
      },
    };
  }

  #buildCriterionStates(
    assessment: FlagshipAssessmentRecordV4,
    decision: EvidenceAssessmentDecisionV4,
  ): LearnerTwinV4["criterionStates"] {
    const refutingRefs = new Set((assessment.evidenceFacts ?? [])
      .filter(fact => refutingEvidenceCodes.has(fact.evidenceCode)).map(fact => fact.evidenceRef));
    return decision.criterionAssessments.map((criterion) => {
      const counterEvidenceRefs = criterion.evidenceRefs.filter(reference => refutingRefs.has(reference));
      let supportEvidenceRefs = criterion.evidenceRefs.filter(
        (reference) => !counterEvidenceRefs.includes(reference),
      );
      if (criterion.evidenceStatus === "refuted" && counterEvidenceRefs.length === 0) {
        counterEvidenceRefs.push(...criterion.evidenceRefs);
        supportEvidenceRefs = [];
      }
      if (criterion.evidenceStatus === "supported"
        && supportEvidenceRefs.length === 0
        && counterEvidenceRefs.length === 0) {
        supportEvidenceRefs = [...criterion.evidenceRefs];
      }
      const uncertaintyDrivers = [
        ...(criterion.evidenceRefs.length <= 1 ? ["limited_evidence" as const] : []),
        ...(criterion.evidenceStatus === "mixed" ? ["mixed_evidence" as const] : []),
        ...(criterion.evidenceStatus === "refuted" || counterEvidenceRefs.length > 0
          ? ["refuting_evidence" as const] : []),
        ...(decision.teacherReview.status === "revised"
          ? ["teacher_revision" as const] : []),
      ];
      return CriterionStateV4Schema.parse({
        criterionId: criterion.criterionId,
        evidenceStatus: criterion.evidenceStatus,
        band: criterion.band,
        score: criterion.score,
        confidence: criterion.confidence,
        evidenceRefs: criterion.evidenceRefs,
        supportEvidenceRefs,
        counterEvidenceRefs,
        uncertaintyDrivers: [...new Set(uncertaintyDrivers)],
        lastPredictionError: null,
      });
    });
  }

  #deterministicProxyDraft(
    criterionStates: LearnerTwinV4["criterionStates"],
    sessionScore: number,
    targetChallengeLevel: 3 | 4 | 5 | 6 | 7,
  ): LearnerProxyDraftV4 {
    const ranked = [...criterionStates].sort((left, right) => (
      left.score - right.score || left.criterionId.localeCompare(right.criterionId)
    ));
    const minimum = ranked[0]!.score;
    const growthTargetRefs = ranked
      .filter((criterion, index) => index < 2 && criterion.score <= minimum + 10)
      .map((criterion) => criterion.criterionId);
    const selectedVariantRef = variantByCriterion[growthTargetRefs[0]!];
    const candidates = xunpuV4AdaptationVariants.map((variant) => {
      const matching = criterionStates.filter((criterion) => (
        targetCriteriaForVariant(
          ForecastCandidateV4Schema.shape.variantRef.parse(variant.variantId),
        ).includes(criterion.criterionId)
      ));
      const average = matching.length > 0
        ? matching.reduce((sum, item) => sum + item.score, 0) / matching.length
        : sessionScore;
      const selected = variant.variantId === selectedVariantRef;
      return {
        variantRef: variant.variantId,
        predictedSuccessProbability: Math.max(
          0.2,
          Math.min(0.9, (average + (selected ? 8 : 0)) / 110),
        ),
        predictedOverloadProbability: Math.max(
          0.1,
          Math.min(
            0.8,
            (targetChallengeLevel * 12
              - average / 2
              + (variant.scaffoldingBudget === 1 ? 8 : 0)) / 100,
          ),
        ),
        predictedGrowthValue: Math.max(
          0.2,
          Math.min(0.95, (100 - average + (selected ? 20 : 0)) / 110),
        ),
        rationale: selected
          ? `该候选直接针对最低证据维度：${growthTargetRefs.map((ref) => criterionTitles[ref]).join("、")}。`
          : "该候选保留为反事实比较，不会自动替学生行动或进入评分。",
      };
    });
    return LearnerProxyDraftOutputV4Schema.parse({
      growthTargetRefs,
      selectedVariantRef,
      candidates,
      limitations: [
        "该模型只描述当前证据支持的可观察岗位表现，不是固定人格或能力定型。",
        "候选概率是下一场设计假设，不进入本轮成绩，也不能替代学生真实行动。",
        "证据较少、存在反证或跨场预测误差时，置信度必须下降而不是补造结论。",
      ],
    });
  }

  async #createProxyDraft(input: {
    criterionStates: LearnerTwinV4["criterionStates"];
    sessionScore: number;
    sourceChallengeLevel: 3 | 4 | 5 | 6 | 7;
    sourceScaffoldingLevel: number;
    targetChallengeLevel: 3 | 4 | 5 | 6 | 7;
    calibrationHistory?: LearnerTwinV4["calibrationHistory"];
  }): Promise<LearnerProxyDraftResultV4> {
    const deterministicDraft = this.#deterministicProxyDraft(
      input.criterionStates,
      input.sessionScore,
      input.targetChallengeLevel,
    );
    const observation: LearnerProxyObservationV4 = {
      runtimeVersion: LearnerProxyRuntimeV4Version,
      sourceChallengeLevel: input.sourceChallengeLevel,
      sourceScaffoldingLevel: input.sourceScaffoldingLevel,
      criterionStates: input.criterionStates.map((criterion) => ({
        criterionId: criterion.criterionId,
        evidenceStatus: criterion.evidenceStatus,
        band: criterion.band,
        score: criterion.score,
        confidence: criterion.confidence,
        supportEvidenceCount: criterion.supportEvidenceRefs.length,
        counterEvidenceCount: criterion.counterEvidenceRefs.length,
        uncertaintyDrivers: [...criterion.uncertaintyDrivers],
        lastPredictionError: criterion.lastPredictionError,
      })),
      calibrationHistory: (input.calibrationHistory ?? []).map((entry) => ({
        variantRef: entry.variantRef,
        predictedSuccessProbability: entry.predictedSuccessProbability,
        observedBehaviorAlignment: entry.observedBehaviorAlignment,
        absolutePredictionError: entry.absolutePredictionError,
      })),
      allowedVariants: xunpuV4AdaptationVariants.map((variant) => ({
        variantRef: ForecastCandidateV4Schema.shape.variantRef.parse(variant.variantId),
        title: variant.title,
        targetCriterionRefs: targetCriteriaForVariant(
          ForecastCandidateV4Schema.shape.variantRef.parse(variant.variantId),
        ),
        mechanicalDifferenceCount: variant.mechanicalDifferenceCount,
        scaffoldingBudget: variant.scaffoldingBudget,
        successEvidence: [...variant.successEvidence],
      })),
      constraints: {
        evidenceEligibleForScore: false,
        canActForStudent: false,
        studentConsentRequired: true,
        teacherAuthorizationRequired: true,
        maximumChallengeChange: 1,
      },
      remainingBudgetMicros: this.#proxyBudgetMicros,
    };
    const inputHash = hash(observation);
    const now = this.#now();
    const fallback = (
      fallbackReason: Exclude<
        z.infer<typeof LearnerProxyRunReceiptV4Schema>["fallbackReason"],
        null
      >,
      run: LearnerProxyModelRunV4 | null = null,
    ): LearnerProxyDraftResultV4 => {
      const outputHash = hash(deterministicDraft);
      return {
        draft: deterministicDraft,
        mode: "deterministic_fallback",
        receipt: LearnerProxyRunReceiptV4Schema.parse({
          proxyRunRef: stableId("learner-proxy-run-v4", {
            inputHash,
            outputHash,
            fallbackReason,
          }),
          inputHash,
          outputHash,
          mode: "deterministic_fallback",
          fallbackReason,
          providerId: run?.providerId ?? null,
          modelId: run?.modelId ?? null,
          traceRef: run?.traceRef ?? null,
          latencyMs: run?.latencyMs ?? null,
          estimatedCostMicros: run?.estimatedCostMicros ?? 0,
          createdAt: now,
        }),
      };
    };
    if (!this.options.learnerProxyModel) return fallback("model_not_configured");
    if (this.#proxyBudgetMicros === 0) return fallback("model_cost_exceeded");
    try {
      const run = await withLearnerProxyTimeout(
        this.options.learnerProxyModel.propose(structuredClone(observation)),
        this.#proxyTimeoutMs,
      );
      if (!validLearnerProxyRun(run)) return fallback("model_invalid_output");
      if (run.estimatedCostMicros > this.#proxyBudgetMicros) {
        return fallback("model_cost_exceeded", run);
      }
      let draft: LearnerProxyDraftV4;
      try {
        draft = LearnerProxyDraftOutputV4Schema.parse(run.output);
      } catch {
        return fallback("model_invalid_output", run);
      }
      const minimum = Math.min(...input.criterionStates.map((criterion) => criterion.score));
      const eligibleTargets = new Set(input.criterionStates.filter((criterion) => (
        criterion.score <= minimum + 15
          || criterion.evidenceStatus !== "supported"
          || (criterion.lastPredictionError ?? 0) >= 0.25
      )).map((criterion) => criterion.criterionId));
      const selectedTargets = targetCriteriaForVariant(draft.selectedVariantRef);
      if (draft.growthTargetRefs.some((criterionId) => !eligibleTargets.has(criterionId))
        || !draft.growthTargetRefs.some((criterionId) => (
          selectedTargets.includes(criterionId)
        ))
        || draft.candidates.some((candidate) => (
          !safeProxyText(candidate.rationale)
        ))
        || draft.limitations.some((limitation) => !safeProxyText(limitation))) {
        return fallback("model_invalid_output", run);
      }
      const outputHash = hash(draft);
      return {
        draft,
        mode: "independent_live_agent",
        receipt: LearnerProxyRunReceiptV4Schema.parse({
          proxyRunRef: stableId("learner-proxy-run-v4", {
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
          createdAt: now,
        }),
      };
    } catch (error) {
      return fallback(
        error instanceof LearnerProxyTimeoutError ? "model_timeout" : "model_error",
      );
    }
  }

  async #buildRecord(
    assessment: FlagshipAssessmentRecordV4,
    decision: EvidenceAssessmentDecisionV4,
    baseRelease: WorldSimulationRelease,
    sourceChallengeLevel: 3 | 4 | 5 | 6 | 7,
    sourceScaffoldingLevel: number,
    fieldMode: boolean,
  ): Promise<LearnerAdaptationRecordV4> {
    const now = this.#now();
    const criterionStates = this.#buildCriterionStates(assessment, decision);
    const targetChallengeLevel = targetLevelFor(
      sourceChallengeLevel,
      decision.sessionScore!,
    );
    const proxy = await this.#createProxyDraft({
      criterionStates,
      sessionScore: decision.sessionScore!,
      sourceChallengeLevel,
      sourceScaffoldingLevel,
      targetChallengeLevel,
    });
    const growthTargetRefs = proxy.draft.growthTargetRefs;
    const selectedVariantRef = proxy.draft.selectedVariantRef;
    const selectedVariant = xunpuV4AdaptationVariants.find(
      (variant) => variant.variantId === selectedVariantRef,
    )!;
    const twinPayload = {
      learnerTwinRef: stableId("learner-twin-v4", assessment.learnerSubjectHash),
      revision: 1,
      sourceAssessmentDecisionRef: decision.assessmentDecisionId,
      criterionStates,
      growthTargetRefs,
      sourceChallengeLevel,
      sourceScaffoldingLevel,
      calibrationCount: 0,
      calibrationHistory: [],
      limitations: proxy.draft.limitations,
      updatedAt: now,
    };
    const learnerTwin = LearnerTwinV4Schema.parse({
      ...twinPayload,
      contentHash: hash(twinPayload),
    });
    const forecast = LearnerForecastV4Schema.parse({
      forecastRef: stableId("learner-forecast-v4", {
        learnerTwinContentHash: learnerTwin.contentHash,
        candidates: proxy.draft.candidates,
      }),
      revision: 1,
      assessorMode: proxy.mode,
      learnerTwinContentHash: learnerTwin.contentHash,
      candidates: proxy.draft.candidates,
      selectedVariantRef,
      evidenceEligibleForScore: false,
      canActForStudent: false,
      generatedAt: now,
    });
    const derived = deriveSecondSessionReleaseV4({
      baseRelease,
      variant: selectedVariant,
      targetChallengeLevel,
    });
    const handoffId = stableId("second-session-handoff-v4", {
      learnerTwinContentHash: learnerTwin.contentHash,
      sourceAssessmentDecisionRef: decision.assessmentDecisionId,
      variantRef: selectedVariantRef,
    });
    const handoff = SecondSessionHandoffV4Schema.parse({
      schemaVersion: SecondSessionHandoffV4SchemaVersion,
      handoffId,
      learnerSubjectHash: assessment.learnerSubjectHash,
      learnerTwinRef: learnerTwin.learnerTwinRef,
      learnerTwinContentHash: learnerTwin.contentHash,
      sourceSessionId: assessment.sessionId,
      sourceAssessmentDecisionRef: decision.assessmentDecisionId,
      flagshipContentRef: flagshipContentReferenceV4Of(baseRelease),
      createdAt: now,
      status: "proposed",
      reasonCode: null,
      proposal: {
        variantRef: selectedVariantRef,
        sourceChallengeLevel,
        targetChallengeLevel,
        changedMechanics: derived.changedMechanics,
        growthTargetRefs,
        forecastRef: forecast.forecastRef,
        learnerConsentRequired: true,
        observationWindow: calibrationWindowPlanForVariantV4(selectedVariantRef, fieldMode),
      },
      teacherAuthorizationRef: null,
      provision: null,
      calibration: null,
      failure: null,
      writeDisposition: "candidate_only",
    });
    return validateRecord({
      recordVersion: LearnerAdaptationRecordV4Version,
      recordRevision: 0,
      sourceSessionId: assessment.sessionId,
      learnerBindingId: assessment.learnerBindingId,
      learnerActorId: assessment.learnerActorId,
      learnerSubjectHash: assessment.learnerSubjectHash,
      sourceAssessmentDecisionRef: decision.assessmentDecisionId,
      sourceAssessmentHash: hash(decision),
      learnerTwin,
      forecast,
      consent: { status: "pending", requestId: null, decidedAt: null },
      appeal: {
        status: "none",
        appealRef: null,
        reason: null,
        resolution: null,
        teacherReason: null,
        openedAt: null,
        resolvedAt: null,
      },
      handoff,
      proxyRuns: [proxy.receipt],
      requestReceipts: [],
      createdAt: now,
      updatedAt: now,
    });
  }

  async #calibrateIfReady(
    record: LearnerAdaptationRecordV4,
  ): Promise<LearnerAdaptationRecordV4> {
    if (record.handoff.status !== "provisioned") return record;
    const proposal = record.handoff.proposal;
    if (!proposal) {
      throw new LearnerAdaptationErrorV4(
        "source_drift",
        "第二场已开通但缺少经授权的适应方案",
      );
    }
    const second = await this.options.engine.getRecord(record.handoff.provision.sessionRef);
    const fieldAssessment = second.fieldInterview ? await this.options.assessment.getAssessment({ sessionId: second.sessionId }) : null;
    const observation = evaluateLearnerCalibrationV4({
      variantRef: proposal.variantRef,
      learnerActorId: record.learnerActorId,
      record: second,
      assessment: fieldAssessment,
      ...(proposal.observationWindow
        ? { observationWindow: proposal.observationWindow }
        : {}),
    });
    if (observation.status !== "completed" || observation.result === null) return record;
    const calibrationResult = LearnerCalibrationResultV4Schema.parse(observation.result);
    const actions = second.studentActions
      .filter((action) => calibrationResult.evidence.studentActionRefs.includes(action.workActionId));
    const fieldActions = second.fieldInterview?.turns.filter(turn => calibrationResult.evidence.studentActionRefs.includes(turn.id)) ?? [];
    const selectedForecast = record.forecast.candidates.find((candidate) => (
      candidate.variantRef === proposal.variantRef
    ));
    if (!selectedForecast) {
      throw new LearnerAdaptationErrorV4(
        "source_drift",
        "第二场校准缺少来源预测候选",
      );
    }
    const observedOutcome = calibrationResult.outcome === "success" ? 1 : 0;
    const forecastError = Number(Math.abs(
      selectedForecast.predictedSuccessProbability - observedOutcome,
    ).toFixed(3));
    const now = this.#now();
    const actionEvidenceHash = hash([...actions.map((action) => ({
      workActionId: action.workActionId,
      action: action.action,
      submissionStatus: action.submissionStatus,
    })), ...fieldActions.map(turn => ({ workActionId: turn.id, action: turn, submissionStatus: "committed" }))]);
    const observationEvidenceHash = hash(calibrationResult);
    const calibrationRef = stableId("learner-calibration-v4", {
      learnerTwinContentHash: record.learnerTwin.contentHash,
      variantRef: proposal.variantRef,
      observationEvidenceHash,
    });
    const targetedCriteria = new Set(
      targetCriteriaForVariant(proposal.variantRef),
    );
    const criterionStates = record.learnerTwin.criterionStates.map((criterion) => {
      if (!targetedCriteria.has(criterion.criterionId)) return criterion;
      const confidence = Math.max(0.1, Math.min(0.99,
        criterion.confidence + 0.08 * (1 - forecastError) - 0.25 * forecastError));
      const uncertaintyDrivers: LearnerTwinV4["criterionStates"][number]["uncertaintyDrivers"] = criterion.uncertaintyDrivers.filter(
        (driver) => driver !== "cross_session_prediction_error",
      );
      if (forecastError >= 0.25) {
        uncertaintyDrivers.push("cross_session_prediction_error");
      }
      return CriterionStateV4Schema.parse({
        ...criterion,
        confidence: Number(confidence.toFixed(3)),
        uncertaintyDrivers: [...new Set(uncertaintyDrivers)],
        lastPredictionError: forecastError,
      });
    });
    const calibrationHistory = [
      ...record.learnerTwin.calibrationHistory,
      {
        calibrationRef,
        variantRef: proposal.variantRef,
        predictedSuccessProbability: selectedForecast.predictedSuccessProbability,
        observedBehaviorAlignment: calibrationResult.observedBehaviorAlignment,
        absolutePredictionError: forecastError,
        actionEvidenceHash,
        policyVersion: calibrationResult.policyVersion,
        outcome: calibrationResult.outcome,
        observationEvidenceHash,
        calibratedAt: now,
      },
    ].slice(-16);
    const twinPayload = {
      ...record.learnerTwin,
      revision: record.learnerTwin.revision + 1,
      criterionStates,
      calibrationCount: record.learnerTwin.calibrationCount + 1,
      calibrationHistory,
      updatedAt: now,
      contentHash: undefined,
    };
    const learnerTwin = LearnerTwinV4Schema.parse({
      ...twinPayload,
      contentHash: hash(twinPayload),
    });
    const forecast = LearnerForecastV4Schema.parse({
      ...record.forecast,
      forecastRef: stableId("learner-forecast-v4", {
        previousForecastRef: record.forecast.forecastRef,
        learnerTwinContentHash: learnerTwin.contentHash,
        calibrationRef,
      }),
      revision: record.forecast.revision + 1,
      learnerTwinContentHash: learnerTwin.contentHash,
      candidates: record.forecast.candidates.map((candidate) => (
        candidate.variantRef === proposal.variantRef
          ? {
              ...candidate,
              predictedSuccessProbability: Number((
                candidate.predictedSuccessProbability * 0.6
                  + observedOutcome * 0.4
              ).toFixed(3)),
              predictedOverloadProbability: Number(Math.max(0, Math.min(1,
                candidate.predictedOverloadProbability
                  + (1 - calibrationResult.observedBehaviorAlignment) * 0.15
                  - calibrationResult.observedBehaviorAlignment * 0.05,
              )).toFixed(3)),
              predictedGrowthValue: Number(Math.max(0, Math.min(1,
                candidate.predictedGrowthValue * 0.8 + forecastError * 0.2,
              )).toFixed(3)),
              rationale: `${candidate.rationale} 第二场冻结窗口最终结果为${calibrationResult.outcome === "success" ? "成功" : "失败"}，预测绝对误差 ${forecastError.toFixed(3)}；过程覆盖度 ${calibrationResult.observedBehaviorAlignment.toFixed(3)}。`,
            }
          : candidate
      )),
      generatedAt: now,
    });
    const calibrated = validateRecord({
      ...record,
      recordRevision: record.recordRevision + 1,
      learnerTwin,
      forecast,
      handoff: SecondSessionHandoffV4Schema.parse({
        ...record.handoff,
        learnerTwinContentHash: learnerTwin.contentHash,
        status: "calibration_completed",
        calibration: {
          ...calibrationResult,
          actualStudentActionRefs: [...actions.map((action) => action.workActionId), ...fieldActions.map(turn => turn.id)],
          forecastError,
          learnerTwinUpdateRef: stableId("learner-twin-calibration-v4", {
            twin: learnerTwin.contentHash,
            calibrationRef,
          }),
          evidenceEligibleForScore: false,
          calibratedAt: now,
        },
        writeDisposition: "committed",
      }),
      updatedAt: now,
    });
    await this.options.store.compareAndSet(record.sourceSessionId, record.recordRevision, calibrated);
    return calibrated;
  }

  #publicBoundaries() {
    return {
      observableEvidenceOnly: true as const,
      immutablePersonalityLabelsForbidden: true as const,
      sensitiveAttributesExcluded: true as const,
      studentConsentRequired: true as const,
      teacherAuthorizationRequired: true as const,
      proxyCanActForStudent: false as const,
      proxyCanCreateEvidence: false as const,
      proxyCanScoreStudent: false as const,
      calibrationEvidenceEligibleForScore: false as const,
    };
  }

  async #required(sessionId: string): Promise<LearnerAdaptationRecordV4> {
    const record = await this.options.store.load(sessionId);
    if (!record) {
      throw new LearnerAdaptationErrorV4("not_ready", "最终证据评价尚未形成第二场方案");
    }
    return record;
  }

  #assertLearner(
    record: LearnerAdaptationRecordV4,
    bindingId: string,
    actorId: string,
  ): void {
    if (record.learnerBindingId !== bindingId || record.learnerActorId !== actorId) {
      throw new LearnerAdaptationErrorV4("access_denied", "学生只能操作自己的自适应方案");
    }
  }

  #receipt(
    record: LearnerAdaptationRecordV4,
    requestId: string,
    requestHash: string,
  ) {
    const receipt = record.requestReceipts.find((candidate) => candidate.requestId === requestId);
    if (receipt && receipt.requestHash !== requestHash) {
      throw new LearnerAdaptationErrorV4("request_replay_conflict", "请求 ID 已被不同内容占用");
    }
    return receipt ?? null;
  }

  #now(): string {
    return this.options.now?.() ?? new Date().toISOString();
  }

  async #serialized<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#locks.get(sessionId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolveLock) => { release = resolveLock; });
    const tail = previous.then(() => current);
    this.#locks.set(sessionId, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.#locks.get(sessionId) === tail) this.#locks.delete(sessionId);
    }
  }
}
