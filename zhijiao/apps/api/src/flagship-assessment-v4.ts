import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import {
  AssessmentCriterionIdV4Schema,
  AssessmentReviewReceiptV4Schema,
  BlindEvidenceAssessmentInputV4Schema,
  BlindEvidenceAssessmentInputV4SchemaVersion,
  EvidenceAssessmentDecisionV4Schema,
  WorkQualityAssessmentRunReceiptV4Schema,
  LearningObservationV4Schema,
  type AssessmentCriterionIdV4,
  type BlindEvidenceAssessmentInputV4,
  type EvidenceAssessmentDecisionV4,
} from "@ronggang/contracts";
import {
  BlindMediaArtifactSummaryV4Schema,
  BlindCriterionJudgmentV4Schema,
  BlindWorkArtifactV4Schema,
  EvidenceAssessmentRubricV4Schema,
  StructuredAssessmentEvidenceFactV4Schema,
  issueEvidenceAssessmentWithWorkQualityV4,
  type BlindMediaArtifactSummaryV4,
  type BlindCriterionJudgmentV4,
  type BlindWorkArtifactV4,
  type EvidenceAssessmentRubricV4,
  type StructuredAssessmentEvidenceCodeV4,
  type StructuredAssessmentEvidenceFactV4,
  type WorkQualityMediaInputV4,
  type WorkQualityMediaPreparationStatusV4,
  type WorkQualityModelV4,
} from "@ronggang/agent-orchestrator";
import type { SimulationCollaborationSessionRecordV3 } from "@ronggang/agent-orchestrator";
import { isFieldBoundaryRequest, type SimulationSessionRecord, type WorldSimulationEngineV3 } from "@ronggang/world-core";
import type { ExplorationLesson } from "@ronggang/course-content";
import { FieldEvidenceSourceError, resolveFieldEvidence } from "./field-evidence.js";
import { buildFieldLearningEvidence, FieldLearningEvidenceVersion } from "./field-learning-evidence.js";
import { fieldWorkRubric } from "./field-work-rubric.js";
import type {
  FlagshipStudentWorkRecordV3,
  FlagshipStudentWorkServiceV3,
  FlagshipWorkRevisionV3,
} from "./flagship-student-work-v3.js";
import type {
  FlagshipMediaServiceV4,
  FlagshipMediaWorkspaceV4,
} from "./flagship-media-v4.js";
import {
  MultimodalMediaIntegrityErrorV4,
  type FlagshipMultimodalQualityPreparerV4,
} from "./flagship-multimodal-quality-v4.js";
import type {
  BusinessOperationCoordinator,
  CommitBusinessOperationInput,
} from "./business-operation-receipt.js";

export const FlagshipAssessmentRecordV4Version =
  "flagship-assessment-record/4.0.0" as const;
export const FlagshipAssessmentViewV4Version =
  "flagship-assessment-view/4.0.0" as const;
export const FlagshipAssessmentAdminCaseV4Version =
  "flagship-assessment-admin-case/4.0.0" as const;

const TimestampSchema = z.string().datetime();

const DecisionEntryV4Schema = z.object({
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/u),
  decision: EvidenceAssessmentDecisionV4Schema,
}).strict();

const FlagshipAssessmentRecordV4Schema = z.object({
  recordVersion: z.literal(FlagshipAssessmentRecordV4Version),
  recordRevision: z.number().int().nonnegative(),
  sessionId: z.string().trim().min(1).max(256),
  learnerBindingId: z.string().trim().min(1).max(256),
  learnerActorId: z.string().trim().min(1).max(256),
  learnerSubjectHash: z.string().regex(/^[a-f0-9]{64}$/u),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/u),
  blindInput: BlindEvidenceAssessmentInputV4Schema,
  evidenceFacts: z.array(StructuredAssessmentEvidenceFactV4Schema).max(256),
  blindJudgments: z.array(BlindCriterionJudgmentV4Schema).length(6),
  rawWeightedScore: z.number().min(0).max(100).nullable(),
  scoreCeiling: z.union([
    z.literal(80), z.literal(85), z.literal(90), z.literal(95), z.literal(100),
  ]),
  rubric: EvidenceAssessmentRubricV4Schema,
  qualityRuns: z.array(WorkQualityAssessmentRunReceiptV4Schema).max(128).default([]),
  retryReceipts:z.array(z.object({requestId:z.string().min(1).max(256),sourceHash:z.string().regex(/^[a-f0-9]{64}$/u)}).strict()).max(128).optional(),
  learningObservations: z.array(LearningObservationV4Schema).max(512).optional(),
  decisionHistory: z.array(DecisionEntryV4Schema).min(1).max(128),
  reviewReceipts: z.array(AssessmentReviewReceiptV4Schema).max(128),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
}).strict().superRefine((record, context) => {
  const latest = record.decisionHistory.at(-1);
  if (latest?.sourceHash !== record.sourceHash
    || latest.decision.blindInputHash !== record.blindInput.inputHash) {
    context.addIssue({
      code: "custom",
      path: ["decisionHistory"],
      message: "当前 V4 评价必须对应当前盲化输入和真实来源哈希",
    });
  }
  const qualityRun = record.qualityRuns.at(-1);
  if (qualityRun && latest && qualityRun.mode !== latest.decision.assessorMode) {
    context.addIssue({
      code: "custom",
      path: ["qualityRuns"],
      message: "作品质量运行模式必须与当前盲评决定一致",
    });
  }
});
export type FlagshipAssessmentRecordV4 = z.infer<
  typeof FlagshipAssessmentRecordV4Schema
>;

export interface FlagshipAssessmentStoreV4 {
  load(sessionId: string): Promise<FlagshipAssessmentRecordV4 | null>;
  create(record: FlagshipAssessmentRecordV4): Promise<void>;
  compareAndSet(
    sessionId: string,
    expectedRevision: number,
    next: FlagshipAssessmentRecordV4,
  ): Promise<void>;
}

export class FlagshipAssessmentErrorV4 extends Error {
  constructor(
    public readonly code:
      | "not_ready"
      | "access_denied"
      | "source_drift"
      | "revision_conflict"
      | "request_replay_conflict"
      | "invalid_review",
    message: string,
  ) {
    super(message);
    this.name = "FlagshipAssessmentErrorV4";
  }
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

function validateRecord(value: unknown): FlagshipAssessmentRecordV4 {
  return FlagshipAssessmentRecordV4Schema.parse(value);
}

export class InMemoryFlagshipAssessmentStoreV4 implements FlagshipAssessmentStoreV4 {
  readonly #records = new Map<string, FlagshipAssessmentRecordV4>();

  async load(sessionId: string): Promise<FlagshipAssessmentRecordV4 | null> {
    const record = this.#records.get(sessionId);
    return record ? structuredClone(record) : null;
  }

  async create(record: FlagshipAssessmentRecordV4): Promise<void> {
    const parsed = validateRecord(record);
    if (this.#records.has(parsed.sessionId)) {
      throw new FlagshipAssessmentErrorV4("revision_conflict", "V4 评价记录已经存在");
    }
    this.#records.set(parsed.sessionId, structuredClone(parsed));
  }

  async compareAndSet(
    sessionId: string,
    expectedRevision: number,
    next: FlagshipAssessmentRecordV4,
  ): Promise<void> {
    const current = this.#records.get(sessionId);
    if (!current || current.recordRevision !== expectedRevision) {
      throw new FlagshipAssessmentErrorV4("revision_conflict", "V4 评价已被其他操作更新");
    }
    const parsed = validateRecord(next);
    if (parsed.sessionId !== sessionId || parsed.recordRevision !== expectedRevision + 1) {
      throw new FlagshipAssessmentErrorV4("revision_conflict", "V4 评价 CAS 后继修订非法");
    }
    this.#records.set(sessionId, structuredClone(parsed));
  }
}

export class JsonFileFlagshipAssessmentStoreV4 implements FlagshipAssessmentStoreV4 {
  constructor(private readonly directory: string) {}

  async load(sessionId: string): Promise<FlagshipAssessmentRecordV4 | null> {
    try {
      const parsed = validateRecord(JSON.parse(await readFile(this.#path(sessionId), "utf8")));
      if (parsed.sessionId !== sessionId) {
        throw new FlagshipAssessmentErrorV4("source_drift", "V4 评价文件与会话不一致");
      }
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async create(record: FlagshipAssessmentRecordV4): Promise<void> {
    const parsed = validateRecord(record);
    if (await this.load(parsed.sessionId)) {
      throw new FlagshipAssessmentErrorV4("revision_conflict", "V4 评价记录已经存在");
    }
    await this.#write(parsed);
  }

  async compareAndSet(
    sessionId: string,
    expectedRevision: number,
    next: FlagshipAssessmentRecordV4,
  ): Promise<void> {
    const current = await this.load(sessionId);
    if (!current || current.recordRevision !== expectedRevision) {
      throw new FlagshipAssessmentErrorV4("revision_conflict", "V4 评价已被其他操作更新");
    }
    const parsed = validateRecord(next);
    if (parsed.sessionId !== sessionId || parsed.recordRevision !== expectedRevision + 1) {
      throw new FlagshipAssessmentErrorV4("revision_conflict", "V4 评价 CAS 后继修订非法");
    }
    await this.#write(parsed);
  }

  #path(sessionId: string): string {
    return resolve(this.directory, `${hash(sessionId)}.json`);
  }

  async #write(record: FlagshipAssessmentRecordV4): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const target = this.#path(record.sessionId);
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

interface AssessmentSourcesV4 {
  world: SimulationSessionRecord;
  work: FlagshipStudentWorkRecordV3 | null;
  collaboration: SimulationCollaborationSessionRecordV3 | null;
  media: FlagshipMediaWorkspaceV4;
  learnerBindingId: string;
  learnerActorId: string;
  learnerSubjectHash: string;
  sourceHash: string;
  generatedAt: string;
}

export interface TeacherCriterionRevisionV4 {
  criterionId: AssessmentCriterionIdV4;
  band: "low" | "medium" | "high";
  score: number;
  rationale: string;
}

const TeacherCriterionRevisionV4Schema = z.object({
  criterionId: AssessmentCriterionIdV4Schema,
  band: z.enum(["low", "medium", "high"]),
  score: z.number().min(0).max(100),
  rationale: z.string().trim().min(8).max(1_000),
}).strict().superRefine((revision, context) => {
  const inBand = revision.band === "low"
    ? revision.score < 60
    : revision.band === "medium"
      ? revision.score >= 60 && revision.score < 80
      : revision.score >= 80;
  if (!inBand) {
    context.addIssue({
      code: "custom",
      path: ["score"],
      message: "教师修订分数必须落在所选能力档位内",
    });
  }
});

export interface ReviewFlagshipAssessmentV4Input {
  sessionId: string;
  expectedAssessmentDecisionId: string;
  requestId: string;
  reviewerId: string;
  status: "confirmed" | "revised";
  rubricApplicabilityConfirmed: true;
  reason: string;
  criterionRevisions: TeacherCriterionRevisionV4[];
}

export interface FlagshipAssessmentServiceV4Options {
  fieldLessons?: readonly ExplorationLesson[];
  engine: Pick<WorldSimulationEngineV3, "getRecord">;
  orchestrator: {
    loadRecord(sessionId: string): Promise<SimulationCollaborationSessionRecordV3 | null>;
  };
  work: Pick<FlagshipStudentWorkServiceV3, "loadRecord">;
  media: Pick<FlagshipMediaServiceV4, "getWorkspace">
    & Partial<Pick<FlagshipMediaServiceV4, "readDerivedAsset">>;
  store: FlagshipAssessmentStoreV4;
  rubric: EvidenceAssessmentRubricV4;
  flagshipContentHash: string;
  studentWorkManifestContentHash: string;
  publicKnowledgeEvidenceRefs: readonly string[];
  workQualityModel?: WorkQualityModelV4;
  workQualityTimeoutMs?: number;
  workQualityBudgetMicros?: number;
  onWorkQualityFailure?:(error:unknown)=>void;
  multimodalQualityPreparer?: FlagshipMultimodalQualityPreparerV4;
  businessOperations?: Pick<
    BusinessOperationCoordinator,
    "commitAuthority" | "deliverOutbox"
  >;
  afterAssessmentFinalized?: (input: {
    sessionId: string;
    assessmentDecisionId: string;
  }) => Promise<string>;
  now?: () => string;
}

const criterionTitles: Readonly<Record<AssessmentCriterionIdV4, string>> = {
  "criterion-fact-verification": "事实与信源核验",
  "criterion-interview-consent": "采访、沟通与知情边界",
  "criterion-editorial-judgment": "编辑判断与独立性",
  "criterion-rights-governance": "素材权利与内容治理",
  "criterion-multiplatform-production": "融媒体作品生产与适配",
  "criterion-recovery-transfer": "纠错恢复、协作与迁移",
};

function latestSubmittedRevision(
  work: FlagshipStudentWorkRecordV3,
  artifactId: string,
): FlagshipWorkRevisionV3 | null {
  const artifact = work.artifacts.find((item) => item.artifactId === artifactId);
  if (artifact?.status !== "submitted" || !artifact.submittedRevisionId) return null;
  return work.revisions.find((revision) => revision.revisionId === artifact.submittedRevisionId)
    ?? null;
}

function eventForResolution(
  world: SimulationSessionRecord,
  resolution: SimulationSessionRecord["resolutions"][number],
) {
  return world.queue.find((event) => event.eventId === resolution.sourceWorldEventId) ?? null;
}

function deltaOf(
  resolution: SimulationSessionRecord["resolutions"][number],
  variableId: string,
): number {
  return resolution.variableDeltas.find((item) => item.variableId === variableId)?.delta ?? 0;
}

function explicitDeltaOf(
  resolution: SimulationSessionRecord["resolutions"][number],
  variableId: string,
): number | null {
  return resolution.variableDeltas.find((item) => item.variableId === variableId)?.delta
    ?? null;
}

function requireWithin(label: string, values: readonly unknown[], maximum: number): void {
  if (values.length > maximum) {
    throw new FlagshipAssessmentErrorV4(
      "not_ready",
      `${label} 超出冻结评价上限，拒绝静默截断证据`,
    );
  }
}

function redactBlindWorkText(value: string, maximum: number): {
  contentExcerpt: string;
  wasTruncated: boolean;
  redactionApplied: boolean;
} {
  let redactionApplied = false;
  let redacted = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/gu, " ");
  const apply = (pattern: RegExp, replacement: string) => {
    const next = redacted.replace(pattern, replacement);
    if (next !== redacted) redactionApplied = true;
    redacted = next;
  };
  apply(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/gu, "[邮箱已脱敏]");
  apply(/(?<!\d)1[3-9]\d{9}(?!\d)/gu, "[手机号已脱敏]");
  apply(/(?<!\d)\d{17}[\dXx](?!\d)/gu, "[证件号已脱敏]");
  apply(/(?:学生姓名|姓名|学号|班级|手机号|身份证号)\s*[:：]\s*[^\s，。；;]{1,40}/gu, "[身份字段已脱敏]");
  const normalized = redacted.trim();
  return {
    contentExcerpt: normalized.slice(0, maximum),
    wasTruncated: normalized.length > maximum,
    redactionApplied,
  };
}

export class FlagshipEvidenceAssessmentServiceV4 {
  readonly #rubric: EvidenceAssessmentRubricV4;
  readonly #locks = new Map<string, Promise<void>>();
  #rubricFor(world: SimulationSessionRecord) {
    return fieldWorkRubric(this.options.fieldLessons?.find(lesson=>lesson.contentHash===world.fieldInterview?.lessonRef.contentHash),this.#rubric);
  }

  constructor(private readonly options: FlagshipAssessmentServiceV4Options) {
    this.#rubric = EvidenceAssessmentRubricV4Schema.parse(options.rubric);
    if (!/^[a-f0-9]{64}$/u.test(options.flagshipContentHash)) {
      throw new Error("V4 评价旗舰内容哈希非法");
    }
    if (!/^[a-f0-9]{64}$/u.test(options.studentWorkManifestContentHash)) {
      throw new Error("V4 评价作品清单哈希非法");
    }
    if (new Set(options.publicKnowledgeEvidenceRefs).size
      !== options.publicKnowledgeEvidenceRefs.length) {
      throw new Error("V4 评价公开知识证据引用不得重复");
    }
  }

  /** Read a still-current decision without scheduling a model run or creating an assessment. */
  async loadCurrentAssessment(input: {
    sessionId: string;
    fallbackLearner?: { bindingId: string; actorId: string };
  }): Promise<FlagshipAssessmentRecordV4 | null> {
    return this.#serialized(input.sessionId, async () => {
      const current = await this.options.store.load(input.sessionId);
      if (!current) return null;
      const sources = await this.#loadSources(input);
      return sources?.sourceHash === current.sourceHash ? current : null;
    });
  }

  async getAssessment(input: {
    sessionId: string;
    fallbackLearner?: { bindingId: string; actorId: string };
    retryRequestId?:string;
  }): Promise<FlagshipAssessmentRecordV4 | null> {
    return this.#serialized(input.sessionId, async () => {
      const sources = await this.#loadSources(input);
      if (!sources) return null;
      const current = await this.options.store.load(input.sessionId);
      if(input.retryRequestId){
        const replay=current?.retryReceipts?.find(receipt=>receipt.requestId===input.retryRequestId);
        if(replay){if(replay.sourceHash!==sources.sourceHash)throw new FlagshipAssessmentErrorV4('request_replay_conflict','同一重评请求不能更换作品依据');return current!;}
      }
      if (current?.sourceHash === sources.sourceHash && (!input.retryRequestId
        || current.decisionHistory.at(-1)!.decision.teacherReview.status!=='pending'
        || current.qualityRuns.at(-1)?.mode==='independent_live_agent')) return current;
      let next: FlagshipAssessmentRecordV4;
      try {
        next = await this.#buildRecord(sources, current,input.retryRequestId);
      } catch (error) {
        if (error instanceof FlagshipAssessmentErrorV4 && error.code === "not_ready") {
          return null;
        }
        throw error;
      }
      if (!current) await this.options.store.create(next);
      else await this.options.store.compareAndSet(input.sessionId, current.recordRevision, next);
      return next;
    });
  }

  async reviewAssessment(
    input: ReviewFlagshipAssessmentV4Input,
  ): Promise<FlagshipAssessmentRecordV4> {
    const outcome = await this.#serialized(input.sessionId, async () => {
      if (input.rubricApplicabilityConfirmed !== true) {
        throw new FlagshipAssessmentErrorV4(
          "invalid_review",
          "教师必须明确确认本班量规适用性；该确认不代表外部专家效度",
        );
      }
      const record = await this.options.store.load(input.sessionId);
      if (!record) throw new FlagshipAssessmentErrorV4("not_ready", "当前尚无可复核 V4 评价");
      const requestHash = hash(input);
      const replay = record.reviewReceipts.find((receipt) => receipt.requestId === input.requestId);
      const operationInput: CommitBusinessOperationInput = {
        operationKind: "finalize_assessment",
        requestId: input.requestId,
        requestHash,
        scope: {
          sourceSessionId: input.sessionId,
          targetSessionId: null,
          artifactId: null,
        },
        outboxSteps: ["refresh_learner_adaptation"],
      };
      if (replay) {
        if (replay.requestHash !== requestHash) {
          throw new FlagshipAssessmentErrorV4(
            "request_replay_conflict",
            "评价复核请求 ID 已被不同内容占用",
          );
        }
        const operation = this.options.businessOperations
          ? await this.options.businessOperations.commitAuthority(
              operationInput,
              async () => ({ commitRef: replay.resultAssessmentDecisionId }),
            )
          : null;
        return {
          record,
          operationId: operation?.operationId ?? null,
          assessmentDecisionId: replay.resultAssessmentDecisionId,
        };
      }
      const current = record.decisionHistory.at(-1)!.decision;
      if (current.assessmentDecisionId !== input.expectedAssessmentDecisionId) {
        throw new FlagshipAssessmentErrorV4("source_drift", "评价已更新，请刷新后再复核");
      }
      if (current.teacherReview.status !== "pending") {
        throw new FlagshipAssessmentErrorV4("invalid_review", "当前评价已经完成教师裁决");
      }
      const revisions = input.criterionRevisions.map((revision) => (
        TeacherCriterionRevisionV4Schema.parse(revision)
      ));
      if (input.status === "confirmed" && revisions.length > 0) {
        throw new FlagshipAssessmentErrorV4("invalid_review", "确认原判时不得附带逐维改分");
      }
      if (input.status === "revised" && revisions.length === 0) {
        throw new FlagshipAssessmentErrorV4("invalid_review", "修订评价必须明确至少一个维度");
      }
      if (new Set(revisions.map((revision) => revision.criterionId)).size !== revisions.length) {
        throw new FlagshipAssessmentErrorV4("invalid_review", "同一维度不得重复修订");
      }
      if (current.status === "insufficient_evidence" && input.status === "revised" && (!record.rubric.workBasis || revisions.length !== 6)) {
        throw new FlagshipAssessmentErrorV4(
          "invalid_review",
          "证据不足时教师不能凭空补分，只能确认不足或等待新增证据",
        );
      }
      const reviewedAt = this.#now();
      const teacherDecisionRef = stableId("teacher-assessment-v4", {
        sourceDecision: current.assessmentDecisionId,
        requestId: input.requestId,
        reviewerId: input.reviewerId,
      });
      const assessments = current.criterionAssessments.map((criterion) => {
        const revision = revisions.find((item) => item.criterionId === criterion.criterionId);
        if (!revision) return criterion;
        if ((criterion.score === null || criterion.band === null) && !record.rubric.workBasis) {
          throw new FlagshipAssessmentErrorV4("invalid_review", "证据不足维度不得直接改分");
        }
        return {
          ...criterion,
          ...(record.rubric.workBasis ? { evidenceStatus:'supported' as const, confidence:.8,
            evidenceRefs:record.blindInput.artifactRevisions.filter(artifact=>record.rubric.workBasis!.criteria.find(item=>item.criterionId===criterion.criterionId)!.artifactRefs.includes(artifact.artifactRef)).map(artifact=>artifact.revisionRef) } : {}),
          band: revision.band,
          score: revision.score,
          rationale: `教师依据同一证据修订：${revision.rationale}`,
        };
      });
      const allScored = assessments.every((criterion) => criterion.score !== null);
      const weighted = allScored
        ? Math.round(record.rubric.criteria.reduce((sum, rubricCriterion) => {
            const assessment = assessments.find(
              (criterion) => criterion.criterionId === rubricCriterion.criterionId,
            )!;
            return sum + assessment.score! * rubricCriterion.weight / 100;
          }, 0))
        : null;
      const reviewed = EvidenceAssessmentDecisionV4Schema.parse({
        ...current,
        assessmentDecisionId: stableId("assessment-v4-reviewed", {
          current: current.assessmentDecisionId,
          requestHash,
        }),
        status: allScored ? "final" : "insufficient_evidence",
        rubricReviewStatus: "verified",
        criterionAssessments: assessments,
        evidenceRefs: allScored ? [...new Set(assessments.flatMap(criterion => criterion.evidenceRefs))].sort() : [],
        sessionScore: weighted === null ? null : Math.min(weighted, record.scoreCeiling),
        teacherReview: {
          status: input.status,
          teacherDecisionRef,
          rationale: input.reason,
          reviewedAt,
        },
        generatedAt: reviewedAt,
      });
      const next = validateRecord({
        ...record,
        recordRevision: record.recordRevision + 1,
        decisionHistory: [...record.decisionHistory, {
          sourceHash: record.sourceHash,
          decision: reviewed,
        }],
        reviewReceipts: [...record.reviewReceipts, AssessmentReviewReceiptV4Schema.parse({
          requestId: input.requestId,
          requestHash,
          sourceAssessmentDecisionId: current.assessmentDecisionId,
          resultAssessmentDecisionId: reviewed.assessmentDecisionId,
          reviewerId: input.reviewerId,
          status: input.status,
          rubricApplicabilityConfirmed: true,
          changedCriterionIds: revisions.map((revision) => revision.criterionId),
          createdAt: reviewedAt,
        })],
        updatedAt: reviewedAt,
      });
      const operation = this.options.businessOperations
        ? await this.options.businessOperations.commitAuthority(
            operationInput,
            async () => {
              await this.options.store.compareAndSet(
                input.sessionId,
                record.recordRevision,
                next,
              );
              return { commitRef: reviewed.assessmentDecisionId };
            },
          )
        : null;
      if (!this.options.businessOperations) {
        await this.options.store.compareAndSet(
          input.sessionId,
          record.recordRevision,
          next,
        );
      }
      return {
        record: next,
        operationId: operation?.operationId ?? null,
        assessmentDecisionId: reviewed.assessmentDecisionId,
      };
    });
    if (outcome.operationId !== null) {
      await this.options.businessOperations!.deliverOutbox(
        outcome.operationId,
        {
          refresh_learner_adaptation: async () => {
            const refresh = this.options.afterAssessmentFinalized;
            if (!refresh) {
              throw new FlagshipAssessmentErrorV4(
                "not_ready",
                "评价终裁投影处理器尚未完成装配",
              );
            }
            return { resultRef: await refresh({
              sessionId: input.sessionId,
              assessmentDecisionId: outcome.assessmentDecisionId,
            }) };
          },
        },
      );
    }
    return outcome.record;
  }

  projectView(
    record: FlagshipAssessmentRecordV4 | null,
    audience: "student" | "teacher" | "admin",
    learningObservations = record?.learningObservations ?? [],
  ) {
    if (!record) {
      return {
        schemaVersion: FlagshipAssessmentViewV4Version,
        status: "not_ready" as const,
        safeMessage: "请先完成本课要求并提交作品；评价主要审读交付内容，过程记录用于核对具体判断。",
        decision: null,
        criteria: this.#rubric.criteria.map((criterion) => ({
          criterionId: criterion.criterionId,
          title: criterionTitles[criterion.criterionId],
          evidenceStatus: "insufficient" as const,
          band: null,
          score: null,
          confidence: 0,
          rationale: "尚未形成可评分证据。",
        })),
        evidenceCoverage: {
          artifactRevisionCount: 0,
          claimLinkCount: 0,
          behaviorCount: 0,
          consequenceCount: 0,
          recoveryPairCount: 0,
        },
        rubric: {
          version: this.#rubric.rubricVersion,
          reviewStatus: this.#rubric.reviewStatus,
          classroomApplicabilityConfirmed: false,
          externalExpertValidityEstablished: false,
        },
        teacherReviewAllowed: false,
        learningObservations,
        audience,
      };
    }
    const decision = record.decisionHistory.at(-1)!.decision;
    return {
      schemaVersion: FlagshipAssessmentViewV4Version,
      status: decision.status,
      safeMessage: decision.status === "insufficient_evidence"
        ? record.rubric.workBasis ? "作品已留存，当前尚未形成有效的质量评估。教师可审阅作品后逐维评价。" : "至少一个必评维度未通过独立证据门，本轮不显示数值分数。"
        : decision.status === "provisional"
          ? "六维盲化判断已形成，仍需课程教师逐维终裁。"
          : "课程教师已依据同一证据完成逐维终裁。",
      decision,
      criteria: decision.criterionAssessments.map((criterion) => ({
        criterionId: criterion.criterionId,
        title: criterionTitles[criterion.criterionId],
        evidenceStatus: criterion.evidenceStatus,
        band: criterion.band,
        score: criterion.score,
        confidence: criterion.confidence,
        rationale: criterion.rationale,
      })),
      evidenceCoverage: {
        artifactRevisionCount: record.blindInput.artifactRevisions.length,
        claimLinkCount: record.blindInput.claimEvidenceLinks.length,
        behaviorCount: record.blindInput.behaviorEvidenceRefs.length,
        consequenceCount: record.blindInput.worldConsequenceRefs.length,
        recoveryPairCount: record.blindInput.recoveryPairRefs.length,
      },
      rubric: {
        version: record.rubric.rubricVersion,
        reviewStatus: decision.rubricReviewStatus,
        classroomApplicabilityConfirmed: decision.teacherReview.status !== "pending",
        externalExpertValidityEstablished: false,
      },
      teacherReviewAllowed: (audience === "teacher" || audience === "admin")
        && decision.teacherReview.status === "pending",
      ...(record.rubric.workBasis?{assessmentBasis:'submitted_work' as const,retryAvailable:Boolean(this.options.workQualityModel)&&decision.teacherReview.status==='pending'
        && record.qualityRuns.at(-1)?.mode==='deterministic_fallback'}:{}),
      learningObservations,
      audience,
    };
  }

  projectAdminCase(record: FlagshipAssessmentRecordV4) {
    return {
      schemaVersion: FlagshipAssessmentAdminCaseV4Version,
      sessionId: record.sessionId,
      sourceHash: record.sourceHash,
      blindInput: structuredClone(record.blindInput),
      evidenceFacts: structuredClone(record.evidenceFacts),
      blindJudgments: structuredClone(record.blindJudgments),
      rawWeightedScore: record.rawWeightedScore,
      scoreCeiling: record.scoreCeiling,
      qualityRuns: structuredClone(record.qualityRuns),
      decisionHistory: structuredClone(record.decisionHistory),
      reviewReceipts: structuredClone(record.reviewReceipts),
      antiGaming: {
        surfaceSignalsUsed: false,
        adviceAgentExcluded: true,
        challengeAppliedAfterBlindAssessment: true,
      },
    };
  }

  async #buildRecord(
    sources: AssessmentSourcesV4,
    previous: FlagshipAssessmentRecordV4 | null,
    retryRequestId?:string,
  ): Promise<FlagshipAssessmentRecordV4> {
    const {
      blindInput,
      evidenceFacts,
      workQualityArtifacts,
      mediaQualityArtifacts,
      mediaInputs,
      mediaPreparationStatus,
      mediaPreparationLimitations,
      sourceContext,
    } = await this.#buildBlindCase(sources);
    const rubric = this.#rubricFor(sources.world);
    const result = await issueEvidenceAssessmentWithWorkQualityV4({
      blindInput,
      evidenceFacts,
      rubric,
      workArtifacts: workQualityArtifacts,
      sourceContext,
      ...(this.options.onWorkQualityFailure?{onFailure:this.options.onWorkQualityFailure}:{}),
      mediaArtifacts: mediaQualityArtifacts,
      mediaInputs,
      mediaPreparationStatus,
      mediaPreparationLimitations,
      scoreCeiling: sources.world.challengeAssignment.scoreCeiling as 80 | 85 | 90 | 95 | 100,
      challengeAdjustmentRef: stableId("challenge-adjustment-v4", {
        assignmentRef: sources.world.challengeAssignment.challengeAssignmentId,
        scoreCeiling: sources.world.challengeAssignment.scoreCeiling,
      }),
      ...(this.options.workQualityModel
        ? { model: this.options.workQualityModel }
        : {}),
      ...(this.options.workQualityTimeoutMs !== undefined
        ? { timeoutMs: this.options.workQualityTimeoutMs }
        : {}),
      ...(this.options.workQualityBudgetMicros !== undefined
        ? { budgetMicros: this.options.workQualityBudgetMicros }
        : {}),
      generatedAt: sources.generatedAt,
    });
    return validateRecord({
      recordVersion: FlagshipAssessmentRecordV4Version,
      recordRevision: previous ? previous.recordRevision + 1 : 0,
      sessionId: sources.world.sessionId,
      learnerBindingId: sources.learnerBindingId,
      learnerActorId: sources.learnerActorId,
      learnerSubjectHash: sources.learnerSubjectHash,
      sourceHash: sources.sourceHash,
      blindInput,
      evidenceFacts,
      blindJudgments: result.blindJudgments,
      rawWeightedScore: result.rawWeightedScore,
      scoreCeiling: sources.world.challengeAssignment.scoreCeiling,
      rubric,
      qualityRuns: [...(previous?.qualityRuns ?? []), result.receipt],
      ...((retryRequestId||previous?.retryReceipts)?{retryReceipts:[...(previous?.retryReceipts??[]),...(retryRequestId?[{requestId:retryRequestId,sourceHash:sources.sourceHash}]:[])]}:{}),
      learningObservations: this.#learningEvidence(sources).observations,
      decisionHistory: [...(previous?.decisionHistory ?? []), { sourceHash: sources.sourceHash, decision: result.decision }],
      reviewReceipts: previous?.reviewReceipts ?? [],
      createdAt: previous?.createdAt ?? sources.generatedAt,
      updatedAt: sources.generatedAt,
    });
  }

  async #loadSources(input: {
    sessionId: string;
    fallbackLearner?: { bindingId: string; actorId: string };
  }): Promise<AssessmentSourcesV4 | null> {
    const world = await this.options.engine.getRecord(input.sessionId);
    const work = await this.options.work.loadRecord(input.sessionId);
    const actionActors = [...new Set([...world.studentActions.map((action) => action.actorId), ...(world.fieldInterview ? [world.fieldInterview.actorId] : [])])];
    const actionBindings = [...new Set([...world.studentActions.map((action) => action.bindingId), ...(world.fieldInterview ? [world.fieldInterview.bindingId] : [])])];
    if (actionActors.length > 1 || actionBindings.length > 1) {
      throw new FlagshipAssessmentErrorV4(
        "source_drift",
        "同一会话混入多个学生行为主体，拒绝合并评价",
      );
    }
    const learnerBindingId = work?.bindingId
      ?? actionBindings[0]
      ?? input.fallbackLearner?.bindingId;
    const learnerActorId = work?.actorId
      ?? actionActors[0]
      ?? input.fallbackLearner?.actorId;
    if (!learnerBindingId || !learnerActorId) return null;
    if (input.fallbackLearner && (
      input.fallbackLearner.actorId !== learnerActorId
      || input.fallbackLearner.bindingId !== learnerBindingId
    )) {
      throw new FlagshipAssessmentErrorV4("access_denied", "学生只能读取自己的 V4 评价");
    }
    const workPlan = this.options.fieldLessons?.find(lesson => lesson.contentHash === world.fieldInterview?.lessonRef.contentHash)?.workPlan;
    if ((work && (
      work.sessionId !== world.sessionId
      || work.challengeLevel !== world.challengeAssignment.challengeLevel
      || work.manifestContentHash !== (workPlan?.contentHash ?? this.options.studentWorkManifestContentHash)
    ))
      || (actionActors[0] !== undefined && actionActors[0] !== learnerActorId)
      || (actionBindings[0] !== undefined && actionBindings[0] !== learnerBindingId)) {
      throw new FlagshipAssessmentErrorV4("source_drift", "作品与权威世界会话漂移");
    }
    const [collaboration, media] = await Promise.all([
      this.options.orchestrator.loadRecord(input.sessionId),
      this.options.media.getWorkspace({
        sessionId: input.sessionId,
        bindingId: learnerBindingId,
        artifactRef: "artifact-multiplatform-package",
      }),
    ]);
    if (collaboration && (
      collaboration.simulationReleaseRef.releaseId
        !== world.release.simulationReleaseRef.releaseId
      || collaboration.simulationReleaseRef.version
        !== world.release.simulationReleaseRef.version
      || collaboration.simulationReleaseRef.contentHash
        !== world.release.simulationReleaseRef.contentHash
    )) {
      throw new FlagshipAssessmentErrorV4(
        "source_drift",
        "智能体协作 Episode 与权威世界发布版漂移",
      );
    }
    if (media.sessionId !== world.sessionId || media.bindingId !== learnerBindingId) {
      throw new FlagshipAssessmentErrorV4("source_drift", "媒体作品与学习者会话漂移");
    }
    const generatedAt = [
      world.updatedAt,
      work?.updatedAt,
      collaboration?.updatedAt,
      ...media.revisions.map((revision) => revision.createdAt),
    ].filter((value): value is string => Boolean(value)).sort().at(-1) ?? this.#now();
    const sourceHash = hash({
      assessmentPolicyVersion: workPlan ? "submitted-work/3.0.0" : "evidence-projection/4.1.0",
      ...(world.fieldInterview ? { fieldLearningEvidenceVersion: FieldLearningEvidenceVersion } : {}),
      world: {
        fieldInterview: world.fieldInterview ? {
          lessonRef: world.fieldInterview.lessonRef,
          actorId: world.fieldInterview.actorId, bindingId: world.fieldInterview.bindingId,
          topic: world.fieldInterview.topic, strategyId: world.fieldInterview.strategyId,
          materialIds: world.fieldInterview.materialIds, flags: world.fieldInterview.flags,
          turns: world.fieldInterview.turns.filter(turn => turn.topicId || turn.choiceConfirmed || isFieldBoundaryRequest(turn.studentText)),
          promises: world.fieldInterview.promises, appointments: world.fieldInterview.appointments,
        } : null,
        release: world.release.simulationReleaseRef,
        assignment: world.challengeAssignment.challengeAssignmentId,
        endingState: world.currentSnapshot.endingState,
        actions: world.studentActions.map((action) => ({
          ref: action.workActionId,
          status: action.submissionStatus,
          verb: action.action.verb,
        })),
        resolutions: world.resolutions.map((resolution) => ({
          id: resolution.resolutionId,
          status: resolution.status,
          event: resolution.sourceWorldEventId,
          deltas: resolution.variableDeltas,
          evidence: resolution.emittedEvidenceIds,
        })),
        consequences: world.consequences.map((consequence) => ({
          id: consequence.eventId,
          resolutionId: consequence.resolutionId,
          evidenceIds: consequence.evidenceIds,
          version: consequence.resultingStateVersion,
        })),
      },
      work: work ? {
        manifestContentHash: work.manifestContentHash,
        recordRevision: work.recordRevision,
        artifacts: work.artifacts,
        revisions: work.revisions.map((revision) => ({
          revisionId: revision.revisionId,
          artifactId: revision.artifactId,
          revisionNumber: revision.revisionNumber,
          parentRevisionId: revision.parentRevisionId,
          contentHash: revision.contentHash,
          evidenceRefs: revision.evidenceRefs,
        })),
      } : null,
      collaboration: collaboration ? {
        recordRevision: collaboration.recordRevision,
        decisions: collaboration.episodes.map((episode) => ({
          episodeId: episode.episodeId,
          eventId: episode.event.eventId,
          decision: episode.studentDecision?.decision ?? null,
          decisionRef: episode.studentDecision?.decisionRef ?? null,
        })),
      } : null,
      media: media.revisions.map((revision) => ({
        id: revision.mediaRevisionId,
        status: revision.status,
        contentHash: revision.contentHash,
      })),
      rubric: this.#rubricFor(world),
      flagshipContentHash: this.options.flagshipContentHash,
    });
    return {
      world,
      work,
      collaboration,
      media,
      learnerBindingId,
      learnerActorId,
      learnerSubjectHash: hash({ learnerActorId, learnerBindingId }),
      sourceHash,
      generatedAt,
    };
  }

  async #buildBlindCase(sources: AssessmentSourcesV4): Promise<{
    blindInput: BlindEvidenceAssessmentInputV4;
    evidenceFacts: StructuredAssessmentEvidenceFactV4[];
    workQualityArtifacts: BlindWorkArtifactV4[];
    mediaQualityArtifacts: BlindMediaArtifactSummaryV4[];
    mediaInputs: WorkQualityMediaInputV4[];
    mediaPreparationStatus: WorkQualityMediaPreparationStatusV4;
    mediaPreparationLimitations: string[];
    sourceContext: Array<{evidenceRef:string;title:string;content:string;wasTruncated:boolean}>;
  }> {
    const lesson = this.options.fieldLessons?.find(item=>item.contentHash===sources.world.fieldInterview?.lessonRef.contentHash);
    const rubric = this.#rubricFor(sources.world);
    let fieldSources;
    try {
      fieldSources = resolveFieldEvidence(sources.world, { actorId: sources.learnerActorId, bindingId: sources.learnerBindingId }, this.options.fieldLessons);
    } catch (error) {
      if (error instanceof FieldEvidenceSourceError) throw new FlagshipAssessmentErrorV4("source_drift", error.message);
      throw error;
    }
    const fieldTurns = fieldSources.filter(source => source.turn !== null);
    const submittedWork = (sources.work?.artifacts ?? []).flatMap((artifact) => {
      const revision = latestSubmittedRevision(sources.work!, artifact.artifactId);
      return revision ? [revision] : [];
    });
    if (lesson?.workPlan && lesson.workPlan.artifacts.some(artifact=>artifact.requiredAtChallengeLevels.includes(sources.world.challengeAssignment.challengeLevel)
      && !submittedWork.some(revision=>revision.artifactId===artifact.artifactId)))
      throw new FlagshipAssessmentErrorV4('not_ready','本课要求的作品尚未全部送审；请完成交付后再形成整体评价。');
    const submittedMedia = [...new Map(
      sources.media.revisions
        .filter((revision) => revision.status === "submitted")
        .sort((left, right) => left.revisionNumber - right.revisionNumber)
        .map((revision) => [revision.artifactRef, revision] as const),
    ).values()];
    const behaviorRefs = [...new Set([
      ...fieldTurns.map(source => source.option.evidenceRef),
      ...sources.world.studentActions
        .filter((action) => action.submissionStatus === "accepted")
        .map((action) => action.workActionId),
      ...(sources.collaboration?.episodes.flatMap((episode) => (
        episode.studentDecision ? [episode.studentDecision.decisionRef] : []
      )) ?? []),
    ])].sort();
    const consequenceRefs = [...new Set([...sources.world.consequences.map((consequence) => consequence.eventId), ...fieldTurns.map(source => source.event.id)])];
    const evidenceRefs = [...new Set([
      ...submittedWork.flatMap((revision) => revision.evidenceRefs),
      ...submittedMedia.flatMap((revision) => revision.rightsLedgerRefs),
    ])].sort();
    const allowedEvidenceRefs = new Set([
      ...fieldSources.map(source => source.option.evidenceRef),
      ...(this.options.fieldLessons?.find(lesson => lesson.contentHash === sources.world.fieldInterview?.lessonRef.contentHash)?.workPlan?.sourceKnowledgeIds ?? this.options.publicKnowledgeEvidenceRefs),
      ...sources.world.consequences.flatMap((consequence) => [
        consequence.eventId,
        ...consequence.evidenceIds,
      ]),
      ...submittedMedia.flatMap((revision) => revision.sourceAssets.map(
        (asset) => asset.rightsReceiptRef,
      )),
    ]);
    if (evidenceRefs.some((evidenceRef) => !allowedEvidenceRefs.has(evidenceRef))) {
      throw new FlagshipAssessmentErrorV4(
        "source_drift",
        "送审作品包含未由公开知识或权威世界后果签发的证据引用",
      );
    }
    if (submittedWork.length + submittedMedia.length === 0
      || (!rubric.workBasis && (behaviorRefs.length === 0
      || consequenceRefs.length === 0
      || evidenceRefs.length === 0))) {
      throw new FlagshipAssessmentErrorV4(
        "not_ready",
        "至少需要已送审文本或融媒体作品、真实行为、世界后果和可追溯证据才能构建盲化评价",
      );
    }
    const recoveryPairs = (sources.work?.artifacts ?? []).flatMap((artifact) => {
      const revisions = sources.work!.revisions
        .filter((revision) => revision.artifactId === artifact.artifactId)
        .sort((left, right) => left.revisionNumber - right.revisionNumber);
      return revisions.length >= 2
        ? [stableId("recovery-pair", {
            first: revisions[0]!.revisionId,
            latest: revisions.at(-1)!.revisionId,
          })]
        : [];
    });
    const scaffoldingRefs = sources.collaboration?.episodes
      .filter((episode) => episode.selectedSuggestionContributionId !== null)
      .map((episode) => episode.episodeId) ?? [];
    const artifactRevisions = [
      ...submittedWork.map((revision) => ({
        artifactRef: revision.artifactId,
        revisionRef: revision.revisionId,
        contentHash: revision.contentHash,
      })),
      ...submittedMedia.map((revision) => ({
        artifactRef: revision.artifactRef,
        revisionRef: revision.mediaRevisionId,
        contentHash: revision.contentHash,
      })),
    ];
    requireWithin("作品版本", artifactRevisions, 16);
    requireWithin("学生行为", behaviorRefs, 256);
    requireWithin("世界后果", consequenceRefs, 256);
    requireWithin("支架 Episode", scaffoldingRefs, 32);
    requireWithin("恢复对", recoveryPairs, 16);
    const resolutionByEvidenceRef = new Map<string, SimulationSessionRecord["resolutions"][number]>();
    for (const consequence of sources.world.consequences) {
      const resolution = sources.world.resolutions.find(
        (candidate) => candidate.resolutionId === consequence.resolutionId,
      );
      if (!resolution || resolution.status !== "committed") continue;
      for (const evidenceRef of [consequence.eventId, ...consequence.evidenceIds]) {
        resolutionByEvidenceRef.set(evidenceRef, resolution);
      }
    }
    const claimEvidenceLinks = [
      ...submittedWork.flatMap((revision) => {
      const refs = [...new Set(revision.evidenceRefs)].sort();
      if (refs.length === 0) return [];
      requireWithin(`作品版本 ${revision.revisionId} 的证据引用`, refs, 48);
      const verificationDeltas = refs.flatMap((evidenceRef) => {
        const resolution = resolutionByEvidenceRef.get(evidenceRef);
        const delta = resolution ? explicitDeltaOf(resolution, "evidence_confidence") : null;
        return delta === null ? [] : [delta];
      });
      const positive = verificationDeltas.some((delta) => delta > 0);
      const negative = verificationDeltas.some((delta) => delta < 0);
        return [{
        claimRef: revision.revisionId,
        evidenceRefs: refs,
        supportStatus: positive
          ? negative ? "mixed" as const : "supported" as const
          : negative ? "refuted" as const : "unresolved" as const,
        sourceCount: refs.length,
        }];
      }),
      ...submittedMedia.map((revision) => ({
        claimRef: revision.mediaRevisionId,
        evidenceRefs: [...new Set(revision.rightsLedgerRefs)].sort(),
        supportStatus: "supported" as const,
        sourceCount: new Set(revision.rightsLedgerRefs).size,
      })),
    ];
    requireWithin("主张证据关系", claimEvidenceLinks, 64);
    const payload = {
      schemaVersion: BlindEvidenceAssessmentInputV4SchemaVersion,
      blindCaseId: stableId("blind-case-v4", sources.sourceHash),
      flagshipContentHash: this.options.flagshipContentHash,
      rubricVersion: rubric.rubricVersion,
      rubricContentHash: rubric.rubricContentHash,
      rubricReviewStatus: rubric.reviewStatus,
      ...(rubric.workBasis ? {assessmentBasis:'submitted_work' as const,sourceContextRefs:fieldSources.map(source=>source.option.evidenceRef)} : {}),
      artifactRevisions,
      claimEvidenceLinks,
      behaviorEvidenceRefs: behaviorRefs,
      worldConsequenceRefs: consequenceRefs,
      scaffoldingEpisodeRefs: scaffoldingRefs,
      recoveryPairRefs: recoveryPairs,
      surfaceSignals: {
        textLength: submittedWork.reduce(
          (sum, revision) => sum + revision.fields.reduce(
            (fieldSum, field) => fieldSum + field.content.length,
            0,
          ),
          0,
        ),
        keywordMatchCount: 0,
        completionClickCount: (sources.work?.requestReceipts ?? []).filter(
          (receipt) => receipt.operation === "submit_revision",
        ).length,
        endingKind: sources.world.currentSnapshot.endingState.endingRef ?? "active",
        allowedForScoring: false as const,
      },
      excludedContextFields: [
        "student_identity",
        "binding_id",
        "challenge_level",
        "agent_advice",
        "provider_and_model",
        "prompt_and_trace",
      ] as const,
      generatedAt: sources.generatedAt,
    };
    const blindInput = BlindEvidenceAssessmentInputV4Schema.parse({
      ...payload,
      inputHash: hash(payload),
    });
    if (submittedWork.some((revision) => revision.fields.length > 12)) {
      throw new FlagshipAssessmentErrorV4(
        "not_ready",
        "单项送审作品字段超出盲化质量评价上限，拒绝静默截断",
      );
    }
    const workQualityArtifacts = submittedWork.map((revision) => (
      BlindWorkArtifactV4Schema.parse({
        artifactRef: revision.artifactId,
        revisionRef: revision.revisionId,
        contentHash: revision.contentHash,
        revisionNumber: revision.revisionNumber,
        parentRevisionRef: revision.parentRevisionId,
        fields: revision.fields.map((field) => ({
          fieldRef: field.fieldId,
          ...redactBlindWorkText(field.content, 2_400),
        })),
        revisionNote: redactBlindWorkText(revision.revisionNote, 600).contentExcerpt,
      })
    ));
    const mediaQualityArtifacts = submittedMedia.map((revision) => (
      BlindMediaArtifactSummaryV4Schema.parse({
        artifactRef: revision.artifactRef,
        revisionRef: revision.mediaRevisionId,
        contentHash: revision.contentHash,
        sourceKinds: revision.sourceAssets.map((asset) => asset.mediaKind),
        rightsStatuses: revision.sourceAssets.map((asset) => asset.rightsStatus),
        transformationKinds: revision.transformations.map((operation) => operation.operationKind),
        derivedAssets: revision.derivedAssets.map((asset) => ({
          assetRef: asset.assetRef,
          contentHash: asset.contentHash,
          mediaKind: asset.mediaKind,
          mimeType: asset.mimeType,
          byteLength: asset.byteLength,
          width: asset.width,
          height: asset.height,
          durationMs: asset.durationMs,
        })),
        editorialRationale: redactBlindWorkText(
          revision.studentEditorialRationale,
          1_500,
        ).contentExcerpt,
      })
    ));
    let mediaPreparationStatus: WorkQualityMediaPreparationStatusV4 =
      submittedMedia.length === 0 ? "not_applicable" : "incomplete";
    let mediaInputs: WorkQualityMediaInputV4[] = [];
    let mediaPreparationLimitations: string[] = [];
    if (submittedMedia.length > 0 && this.options.workQualityModel) {
      if (!this.options.multimodalQualityPreparer || !this.options.media.readDerivedAsset) {
        mediaPreparationLimitations = [
          "真实媒体观察端口未装配，质量模型没有读取图像、音频或视频文件。",
        ];
      } else {
        try {
          const prepared = await this.options.multimodalQualityPreparer.prepare({
            revisions: submittedMedia,
            reader: {
              readDerivedAsset: (input) => this.options.media.readDerivedAsset!(input),
            },
          });
          mediaPreparationStatus = prepared.status;
          mediaInputs = prepared.inputs;
          mediaPreparationLimitations = prepared.limitations;
        } catch (error) {
          if (error instanceof MultimodalMediaIntegrityErrorV4) {
            throw new FlagshipAssessmentErrorV4("source_drift", error.message);
          }
          mediaPreparationStatus = "incomplete";
          mediaPreparationLimitations = [
            "真实媒体观察准备失败，已停止供应方媒体调用并使用确定性评价。",
          ];
        }
      }
    }
    return {
      blindInput,
      evidenceFacts: rubric.workBasis ? [] : this.#buildEvidenceFacts(sources, blindInput),
      sourceContext: rubric.workBasis ? fieldSources.map(source=>{
        const raw=source.material?.body ?? source.option.detail;
        const redacted=redactBlindWorkText(raw,2000);
        return {evidenceRef:source.option.evidenceRef,title:source.option.label,content:redacted.contentExcerpt,wasTruncated:redacted.wasTruncated};
      }) : [],
      workQualityArtifacts,
      mediaQualityArtifacts,
      mediaInputs,
      mediaPreparationStatus,
      mediaPreparationLimitations,
    };
  }

  #buildEvidenceFacts(
    sources: AssessmentSourcesV4,
    blindInput: BlindEvidenceAssessmentInputV4,
  ): StructuredAssessmentEvidenceFactV4[] {
    const facts: StructuredAssessmentEvidenceFactV4[] = [];
    const factKeys = new Set<string>();
    const add = (
      evidenceRef: string,
      sourceKind: StructuredAssessmentEvidenceFactV4["sourceKind"],
      evidenceCode: StructuredAssessmentEvidenceCodeV4,
      independenceKey: string,
      source: unknown,
    ) => {
      const factKey = `${evidenceRef}\u0000${evidenceCode}`;
      if (factKeys.has(factKey)) return;
      factKeys.add(factKey);
      facts.push(StructuredAssessmentEvidenceFactV4Schema.parse({
        evidenceRef,
        sourceKind,
        evidenceCode,
        independenceKey,
        sourceContentHash: hash(source),
      }));
    };

    for (const resolution of sources.world.resolutions.filter((item) => item.status === "committed")) {
      const event = eventForResolution(sources.world, resolution);
      const consequence = sources.world.consequences.find(
        (item) => item.resolutionId === resolution.resolutionId,
      );
      if (!event || !consequence) continue;
      const ref = consequence.eventId;
      const key = `world-${event.eventId}`;
      const isStudentConsequence = event.sourceKind === "student_action"
        && blindInput.behaviorEvidenceRefs.includes(event.sourceRef);
      if (["event-template-gatekeeper", "event-template-community-source", "event-template-inheritor", "event-template-community-challenge"].includes(event.eventTemplateId)) {
        const trustDelta = explicitDeltaOf(resolution, "community_trust");
        if (isStudentConsequence && trustDelta !== null) {
          add(ref, "world_consequence", trustDelta > 0
            ? "purpose_and_scope_declared" : "consent_ignored", key, resolution);
        }
        if (isStudentConsequence && trustDelta !== null && trustDelta > 0
          && event.eventTemplateId !== "event-template-gatekeeper") {
          add(ref, "world_consequence", "open_followup_recorded", `${key}-followup`, resolution);
        }
      }
      if (["event-template-source-check", "event-template-compare-sources", "event-template-researcher-probe", "event-template-official-request", "event-template-verification-wait"].includes(event.eventTemplateId)) {
        const evidenceDelta = explicitDeltaOf(resolution, "evidence_confidence");
        if (isStudentConsequence && evidenceDelta !== null) {
          add(ref, "world_consequence", evidenceDelta > 0
            ? "cross_source_comparison" : "unsupported_claim_detected", key, resolution);
        }
      }
      if (event.eventTemplateId === "event-template-limited-alert") {
        const safetyDelta = explicitDeltaOf(resolution, "public_safety_risk");
        if (isStudentConsequence && safetyDelta !== null) {
          add(ref, "world_consequence", safetyDelta < 0
            ? "bounded_unknown" : "unsupported_claim_detected", key, resolution);
          if (safetyDelta < 0) {
            add(ref, "world_consequence", "deadline_tradeoff_evidenced", `${key}-deadline`, resolution);
          }
        }
      }
      if (event.eventTemplateId === "event-template-verification-wait") {
        const evidenceDelta = explicitDeltaOf(resolution, "evidence_confidence");
        if (isStudentConsequence && evidenceDelta !== null && evidenceDelta > 0) {
          add(ref, "world_consequence", "deadline_tradeoff_evidenced", `${key}-deadline`, resolution);
        }
      }
      if (event.eventTemplateId === "event-template-rights-inspection") {
        const copyrightDelta = explicitDeltaOf(resolution, "copyright_risk");
        if (isStudentConsequence && copyrightDelta !== null) {
          add(ref, "world_consequence", copyrightDelta < 0
            ? "withdrawal_replaced" : "withdrawal_ignored", key, resolution);
        }
      }
      if (event.eventTemplateId === "event-template-topic-brief") {
        const editorialDelta = explicitDeltaOf(resolution, "editorial_independence");
        if (isStudentConsequence && editorialDelta !== null && editorialDelta > 0) {
          add(ref, "world_consequence", "public_value_tradeoff", key, resolution);
        }
      }
      if (event.eventTemplateId === "event-template-commercial-response") {
        const editorialDelta = explicitDeltaOf(resolution, "editorial_independence");
        if (isStudentConsequence && editorialDelta !== null) {
          add(ref, "world_consequence", editorialDelta > 0
            ? "commercial_exchange_disclosed_or_rejected"
            : "commercial_exchange_hidden", key, resolution);
        }
      }
      if (event.eventTemplateId === "event-template-correction") {
        const correctionDelta = explicitDeltaOf(resolution, "correction_debt");
        if (isStudentConsequence && correctionDelta !== null) {
          add(ref, "world_consequence", correctionDelta < 0
            ? "public_correction_preserved" : "silent_edit_detected", key, resolution);
        }
      }
    }

    const submittedById = new Map(blindInput.artifactRevisions.map((item) => [item.artifactRef, item]));
    const consequenceByEvidenceRef = new Map<string, {
      consequence: SimulationSessionRecord["consequences"][number];
      resolution: SimulationSessionRecord["resolutions"][number];
      event: SimulationSessionRecord["queue"][number];
    }>();
    for (const consequence of sources.world.consequences) {
      const resolution = sources.world.resolutions.find(
        (candidate) => candidate.resolutionId === consequence.resolutionId,
      );
      const event = sources.world.queue.find(
        (candidate) => candidate.eventId === consequence.sourceWorldEventId,
      );
      if (!resolution || !event || resolution.status !== "committed") continue;
      for (const evidenceRef of [consequence.eventId, ...consequence.evidenceIds]) {
        consequenceByEvidenceRef.set(evidenceRef, { consequence, resolution, event });
      }
    }
    const submittedRevisionById = new Map(
      (sources.work?.revisions ?? []).map((revision) => [revision.revisionId, revision]),
    );
    for (const link of blindInput.claimEvidenceLinks) {
      if (link.supportStatus !== "supported" && link.supportStatus !== "mixed") continue;
      for (const evidenceRef of link.evidenceRefs) {
        const source = consequenceByEvidenceRef.get(evidenceRef);
        if (!source || explicitDeltaOf(source.resolution, "evidence_confidence")! <= 0) continue;
        add(
          evidenceRef,
          "claim_evidence",
          "verified_claim_supported",
          `claim-${link.claimRef}-${evidenceRef}`,
          { link, resolutionId: source.resolution.resolutionId },
        );
      }
    }

    const linkedArtifactFact = (
      artifactId: string,
      code: StructuredAssessmentEvidenceCodeV4,
      accepts: (
        source: NonNullable<ReturnType<typeof consequenceByEvidenceRef.get>>,
      ) => boolean,
    ) => {
      const submitted = submittedById.get(artifactId);
      const revision = submitted ? submittedRevisionById.get(submitted.revisionRef) : null;
      if (!submitted || !revision) return;
      const linked = revision.evidenceRefs
        .map((evidenceRef) => consequenceByEvidenceRef.get(evidenceRef))
        .filter((source): source is NonNullable<typeof source> => Boolean(source))
        .find(accepts);
      if (linked) add(
        submitted.revisionRef,
        "artifact_revision",
        code,
        `artifact-${submitted.revisionRef}`,
        { revision: submitted, linkedConsequence: linked.consequence.eventId },
      );
    };
    linkedArtifactFact(
      "artifact-topic-brief",
      "public_value_tradeoff",
      (source) => source.event.eventTemplateId === "event-template-topic-brief"
        && (explicitDeltaOf(source.resolution, "editorial_independence") ?? 0) > 0,
    );
    linkedArtifactFact(
      "artifact-interview-plan-log",
      "consent_scope_recorded",
      (source) => ["event-template-gatekeeper", "event-template-community-source", "event-template-inheritor"]
        .includes(source.event.eventTemplateId)
        && (explicitDeltaOf(source.resolution, "community_trust") ?? 0) > 0,
    );
    linkedArtifactFact(
      "artifact-rights-ledger",
      "rights_receipt_linked",
      (source) => source.event.eventTemplateId === "event-template-rights-inspection"
        && (explicitDeltaOf(source.resolution, "copyright_risk") ?? 0) < 0,
    );
    linkedArtifactFact(
      "artifact-publication-correction-decision",
      "deadline_tradeoff_evidenced",
      (source) => ["event-template-limited-alert", "event-template-verification-wait"]
        .includes(source.event.eventTemplateId),
    );
    linkedArtifactFact(
      "artifact-transfer-reflection",
      "grounded_transfer_reflection",
      (source) => source.event.eventTemplateId === "event-template-correction"
        && (explicitDeltaOf(source.resolution, "correction_debt") ?? 0) < 0,
    );

    for (const recoveryPair of blindInput.recoveryPairRefs) {
      add(
        recoveryPair,
        "recovery_pair",
        "revision_pair_preserved",
        recoveryPair,
        recoveryPair,
      );
    }
    for (const episode of sources.collaboration?.episodes ?? []) {
      if (!episode.studentDecision) continue;
      if (["request_evidence", "reject"].includes(episode.studentDecision.decision)) {
        add(
          episode.studentDecision.decisionRef,
          "student_behavior",
          "evidence_request_or_reasoned_rejection",
          `decision-${episode.studentDecision.decisionRef}`,
          {
            decisionRef: episode.studentDecision.decisionRef,
            decision: episode.studentDecision.decision,
          },
        );
      }
      if (episode.selectedSuggestionContributionId && blindInput.scaffoldingEpisodeRefs.includes(episode.episodeId)) {
        add(
          episode.episodeId,
          "scaffolding",
          "advice_present_context_only",
          `advice-${episode.episodeId}`,
          { episodeId: episode.episodeId },
        );
      }
    }
    const blindMediaRevisionRefs = new Set(
      blindInput.artifactRevisions.map((revision) => revision.revisionRef),
    );
    for (const media of sources.media.revisions.filter((revision) => (
      revision.status === "submitted"
      && blindMediaRevisionRefs.has(revision.mediaRevisionId)
    ))) {
      add(
        media.mediaRevisionId,
        "artifact_revision",
        "actual_media_derivative",
        `media-${media.mediaRevisionId}`,
        media,
      );
      // The existence of image/audio/video files cannot establish semantic
      // consistency between them. Keep that judgment for actual work review.
      for (const sourceAsset of media.sourceAssets.filter(
        (asset) => asset.rightsStatus === "cleared"
          && media.rightsLedgerRefs.includes(asset.rightsReceiptRef),
      )) {
        // Each media item has its own independently verifiable rights receipt.
        // Keeping image/audio/video receipts separate is what lets the rubric
        // verify a real three-format package without counting one aggregate
        // "submitted" flag three times.
        add(
          sourceAsset.rightsReceiptRef,
          "claim_evidence",
          "rights_receipt_linked",
          `media-rights-${sourceAsset.rightsReceiptRef}`,
          sourceAsset,
        );
      }
      if (media.derivedAssets.every((asset) => (
        asset.aiDisclosure.explicitLabel && asset.aiDisclosure.implicitMetadata
      ))) {
        add(
          media.mediaRevisionId,
          "artifact_revision",
          "ai_disclosure_preserved",
          `media-ai-${media.mediaRevisionId}`,
          media.derivedAssets.map((asset) => asset.aiDisclosure),
        );
      }
    }
    const hasSubmittedMedia = sources.media.revisions.some((revision) => (
      revision.status === "submitted"
      && blindMediaRevisionRefs.has(revision.mediaRevisionId)
    ));
    const script = submittedById.get("artifact-multiplatform-script");
    const scriptRevision = script ? submittedRevisionById.get(script.revisionRef) : null;
    if (hasSubmittedMedia && script && scriptRevision
      && new Set(scriptRevision.fields.map(field => field.content.trim()).filter(Boolean)).size >= 2
      && scriptRevision.evidenceRefs.length > 0) {
      add(script.revisionRef, "artifact_revision", "platform_rationale_recorded", `artifact-${script.revisionRef}`, scriptRevision);
    }
    if (!hasSubmittedMedia) {
      const textPackage = submittedById.get("artifact-multiplatform-script");
      if (textPackage) add(
        textPackage.revisionRef,
        "artifact_revision",
        "text_only_submission",
        `media-text-only-${textPackage.revisionRef}`,
        textPackage,
      );
    }
    for (const fact of this.#learningEvidence(sources).facts) {
      const key = `${fact.evidenceRef}\u0000${fact.evidenceCode}`;
      if (!factKeys.has(key)) { facts.push(fact); factKeys.add(key); }
    }
    return facts;
  }

  #learningEvidence(sources: AssessmentSourcesV4) {
    const revisions = (sources.work?.artifacts ?? []).flatMap(artifact => latestSubmittedRevision(sources.work!, artifact.artifactId) ?? []);
    return buildFieldLearningEvidence({ world: sources.world, revisions,
      sources: resolveFieldEvidence(sources.world, { actorId: sources.learnerActorId, bindingId: sources.learnerBindingId }, this.options.fieldLessons) });
  }

  async getLearningObservations(input: { sessionId: string; fallbackLearner?: { actorId: string; bindingId: string } }) {
    const sources = await this.#loadSources(input);
    return sources ? this.#learningEvidence(sources).observations : [];
  }

  #now(): string {
    return this.options.now?.() ?? new Date().toISOString();
  }

  async #serialized<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#locks.get(sessionId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolveLock) => {
      release = resolveLock;
    });
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

export function currentFlagshipAssessmentDecisionV4(
  record: FlagshipAssessmentRecordV4,
): EvidenceAssessmentDecisionV4 {
  return record.decisionHistory.at(-1)!.decision;
}
