import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import {
  AssessmentDecisionSchema,
  AssessmentDecisionSchemaVersion,
  CompetencyEvidenceEpisodeSchema,
  CompetencyEvidenceEpisodeSchemaVersion,
  V2ContentHashSchema,
  V2IdentifierSchema,
  type AssessmentDecision,
  type CompetencyEvidenceEpisode,
} from "@ronggang/contracts";
import type {
  SimulationCollaborationSessionRecordV3,
} from "@ronggang/agent-orchestrator";
import type { XunpuFlagshipContentManifestV3 } from "@ronggang/course-content";
import type {
  SimulationSessionRecord,
  WorldSimulationEngineV3,
} from "@ronggang/world-core";
import type {
  FlagshipStudentWorkRecordV3,
  FlagshipStudentWorkServiceV3,
  FlagshipWorkRevisionV3,
} from "./flagship-student-work-v3.js";

export const FlagshipAssessmentRecordV3Version =
  "flagship-assessment-record/3.0.0" as const;
export const FlagshipCompetencyEvidenceViewV3Version =
  "flagship-competency-evidence-view/3.0.0" as const;
export const FlagshipAssessmentCaseViewV3Version =
  "flagship-assessment-case-view/3.0.0" as const;

type ChallengeLevel = 3 | 4 | 5 | 6 | 7;
type Rubric = XunpuFlagshipContentManifestV3["rubricBlueprints"][number];
type CompetencyEstimate = AssessmentDecision["competencyEstimates"][number];
type EvidenceObservation = CompetencyEvidenceEpisode["observations"][number];

const TimestampSchema = z.string().datetime();

export interface BlindAssessmentDocumentV3 {
  artifactId: string;
  revisionId: string;
  revisionNumber: number;
  fields: Array<{ fieldId: string; content: string }>;
  evidenceCount: number;
  revisionNote: string;
}

export interface BlindAssessmentBehaviorV3 {
  verb: string;
  statement: string;
  reflection: string | null;
}

/**
 * Deliberately excludes learner identity, binding, challenge level, experiment
 * condition, agent advice, provider metadata and teacher score. Implementations
 * receive only de-identified work and a frozen criterion.
 */
export interface BlindSemanticAssessmentInputV3 {
  criterion: {
    criterionId: string;
    title: string;
    observableEvidence: string[];
    failClosedWhen: string[];
  };
  documents: BlindAssessmentDocumentV3[];
  behaviors: BlindAssessmentBehaviorV3[];
}

export interface BlindSemanticAssessmentOutputV3 {
  mode: "deterministic_demo" | "external_model" | "test_double";
  direction: "supports" | "refutes" | "insufficient";
  score: number | null;
  confidence: number;
  rationale: string;
}

export interface BlindSemanticAssessmentPortV3 {
  evaluate(
    input: BlindSemanticAssessmentInputV3,
  ): BlindSemanticAssessmentOutputV3 | Promise<BlindSemanticAssessmentOutputV3>;
}

const keywordMap: Readonly<Record<string, readonly string[]>> = {
  "criterion-fact-verification": ["来源", "信源", "核验", "原始", "年份", "未知", "交叉", "限定"],
  "criterion-interview-consent": ["身份", "用途", "同意", "匿名", "撤回", "追问", "原话", "公开"],
  "criterion-editorial-judgment": ["公共价值", "受众", "独立", "利益", "披露", "时效", "取舍", "角度"],
  "criterion-rights-governance": ["授权", "许可", "版权", "肖像", "期限", "平台", "标识", "替换"],
  "criterion-multiplatform-production": ["图文", "短视频", "快讯", "标题", "平台", "受众", "版本", "分镜"],
  "criterion-recovery-transfer": ["修订", "补证", "更正", "拒绝", "反思", "迁移", "下一次", "后果"],
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
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

function hashValue(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

function stableId(prefix: string, value: unknown): string {
  return `${prefix}-${hashValue(value).slice(0, 24)}`;
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function ngramDiversity(text: string): number {
  const normalized = text.replace(/\s+/gu, "");
  if (normalized.length < 2) return 0;
  const grams = Array.from({ length: normalized.length - 1 }, (_, index) => (
    normalized.slice(index, index + 2)
  ));
  return clamp(new Set(grams).size / Math.min(grams.length, 120), 0, 1);
}

/**
 * Honest local fallback for an offline competition demo. It is deterministic,
 * provisional and intentionally conservative; it is not presented as a model
 * call, expert judgement or validated occupational instrument.
 */
export class DeterministicBlindSemanticAssessmentV3
implements BlindSemanticAssessmentPortV3 {
  evaluate(input: BlindSemanticAssessmentInputV3): BlindSemanticAssessmentOutputV3 {
    if (input.documents.length === 0) {
      return {
        mode: "deterministic_demo",
        direction: "insufficient",
        score: null,
        confidence: 0.2,
        rationale: "没有该维度对应的真实作品版本，确定性演示评估保持证据不足。",
      };
    }
    const text = input.documents.flatMap((document) => [
      ...document.fields.map((field) => field.content),
      document.revisionNote,
    ]).join("\n");
    const keywords = keywordMap[input.criterion.criterionId] ?? [];
    const keywordHits = keywords.filter((keyword) => text.includes(keyword)).length;
    const keywordCoverage = keywords.length === 0
      ? 0
      : clamp(keywordHits / Math.min(5, keywords.length), 0, 1);
    const fieldCount = input.documents.reduce(
      (total, document) => total + document.fields.length,
      0,
    );
    const substantialFields = input.documents.reduce(
      (total, document) => total + document.fields.filter(
        (field) => field.content.trim().length >= 80,
      ).length,
      0,
    );
    const completeness = fieldCount === 0 ? 0 : substantialFields / fieldCount;
    const evidenceDensity = clamp(
      input.documents.reduce((sum, document) => sum + document.evidenceCount, 0) / 4,
      0,
      1,
    );
    const revisionSignal = input.documents.some(
      (document) => document.revisionNumber >= 2,
    ) ? 1 : 0;
    const behaviorSignal = clamp(input.behaviors.length / 3, 0, 1);
    const score = Math.round(clamp(
      20
        + keywordCoverage * 28
        + completeness * 18
        + evidenceDensity * 14
        + revisionSignal * 8
        + behaviorSignal * 7
        + ngramDiversity(text) * 5,
      0,
      100,
    ));
    const direction = score >= 60
      ? "supports" as const
      : score < 35
        ? "refutes" as const
        : "insufficient" as const;
    return {
      mode: "deterministic_demo",
      direction,
      score,
      confidence: Number(clamp(
        0.35 + input.documents.length * 0.06 + evidenceDensity * 0.2,
        0,
        0.82,
      ).toFixed(2)),
      rationale: `确定性演示盲评：专业语义命中 ${keywordHits} 项，充分字段 ${substantialFields}/${fieldCount}，作品证据密度 ${Math.round(evidenceDensity * 100)}%。结果仅作为教师复核前的暂定判断。`,
    };
  }
}

const SemanticReceiptSchema = z.object({
  semanticReceiptId: V2IdentifierSchema,
  evidenceEpisodeId: V2IdentifierSchema,
  competencyClaimId: V2IdentifierSchema,
  evaluatorMode: z.enum(["deterministic_demo", "external_model", "test_double"]),
  inputHash: V2ContentHashSchema,
  outputHash: V2ContentHashSchema,
  direction: z.enum(["supports", "refutes", "insufficient"]),
  rawScore: z.number().min(0).max(100).nullable(),
  confidence: z.number().min(0).max(1),
  rationale: z.string().trim().min(1).max(1_000),
  evaluatedAt: TimestampSchema,
}).strict();
export type FlagshipSemanticAssessmentReceiptV3 = z.infer<
  typeof SemanticReceiptSchema
>;

const ScoreComputationSchema = z.object({
  competencyClaimId: V2IdentifierSchema,
  rawSemanticScore: z.number().min(0).max(100).nullable(),
  behaviorAdjustment: z.number().min(-20).max(20),
  challengeAdjustment: z.number().min(0).max(12),
  normalizedScore: z.number().min(0).max(100).nullable(),
  minimumIndependentEvidenceCount: z.number().int().positive(),
  eligibleIndependentEvidenceCount: z.number().int().nonnegative(),
  failClosedReasons: z.array(z.string().trim().min(1).max(400)).max(12),
  evidenceEpisodeRefs: z.array(V2IdentifierSchema).max(32),
}).strict();
export type FlagshipScoreComputationV3 = z.infer<typeof ScoreComputationSchema>;

const ReviewReceiptSchema = z.object({
  requestId: V2IdentifierSchema,
  requestHash: V2ContentHashSchema,
  sourceAssessmentDecisionId: V2IdentifierSchema,
  resultAssessmentDecisionId: V2IdentifierSchema,
  reviewerId: V2IdentifierSchema,
  status: z.enum(["confirmed", "revised"]),
  changedCompetencyClaimIds: z.array(V2IdentifierSchema).max(32),
  createdAt: TimestampSchema,
}).strict();

const DecisionEntrySchema = z.object({
  sourceHash: V2ContentHashSchema,
  decision: AssessmentDecisionSchema,
}).strict();

const FlagshipAssessmentRecordSchema = z.object({
  recordVersion: z.literal(FlagshipAssessmentRecordV3Version),
  recordRevision: z.number().int().nonnegative(),
  sessionId: V2IdentifierSchema,
  learnerBindingId: V2IdentifierSchema,
  learnerActorId: V2IdentifierSchema,
  sourceHash: V2ContentHashSchema,
  evidenceEpisodes: z.array(CompetencyEvidenceEpisodeSchema).max(1_024),
  semanticReceipts: z.array(SemanticReceiptSchema).max(1_024),
  scoreComputations: z.array(ScoreComputationSchema).max(64),
  decisionHistory: z.array(DecisionEntrySchema).min(1).max(256),
  reviewReceipts: z.array(ReviewReceiptSchema).max(256),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
}).strict().superRefine((record, context) => {
  if (record.decisionHistory.at(-1)?.sourceHash !== record.sourceHash) {
    context.addIssue({
      code: "custom",
      path: ["decisionHistory"],
      message: "当前评价必须对应当前真实来源哈希",
    });
  }
  const episodeIds = new Set(record.evidenceEpisodes.map(
    (episode) => episode.evidenceEpisodeId,
  ));
  for (const receipt of record.semanticReceipts) {
    if (!episodeIds.has(receipt.evidenceEpisodeId)) {
      context.addIssue({
        code: "custom",
        path: ["semanticReceipts"],
        message: "语义回执必须引用当前证据 Episode",
      });
    }
  }
});

export type FlagshipAssessmentRecordV3 = z.infer<
  typeof FlagshipAssessmentRecordSchema
>;

export interface FlagshipAssessmentStoreV3 {
  create(record: FlagshipAssessmentRecordV3): Promise<void>;
  load(sessionId: string): Promise<FlagshipAssessmentRecordV3 | null>;
  compareAndSet(
    sessionId: string,
    expectedRevision: number,
    next: FlagshipAssessmentRecordV3,
  ): Promise<void>;
}

export class FlagshipAssessmentErrorV3 extends Error {
  constructor(
    public readonly code:
      | "not_found"
      | "access_denied"
      | "source_drift"
      | "revision_conflict"
      | "request_replay_conflict"
      | "invalid_review"
      | "assessment_stale",
    message: string,
  ) {
    super(message);
    this.name = "FlagshipAssessmentErrorV3";
  }
}

export class InMemoryFlagshipAssessmentStoreV3
implements FlagshipAssessmentStoreV3 {
  readonly #records = new Map<string, FlagshipAssessmentRecordV3>();

  async create(record: FlagshipAssessmentRecordV3): Promise<void> {
    const parsed = FlagshipAssessmentRecordSchema.parse(record);
    if (this.#records.has(parsed.sessionId)) {
      throw new FlagshipAssessmentErrorV3(
        "revision_conflict",
        "旗舰评价记录已经存在",
      );
    }
    this.#records.set(parsed.sessionId, structuredClone(parsed));
  }

  async load(sessionId: string): Promise<FlagshipAssessmentRecordV3 | null> {
    const record = this.#records.get(sessionId);
    return record ? structuredClone(record) : null;
  }

  async compareAndSet(
    sessionId: string,
    expectedRevision: number,
    next: FlagshipAssessmentRecordV3,
  ): Promise<void> {
    const current = this.#records.get(sessionId);
    if (!current || current.recordRevision !== expectedRevision) {
      throw new FlagshipAssessmentErrorV3(
        "revision_conflict",
        "旗舰评价已被其他操作更新",
      );
    }
    const parsed = FlagshipAssessmentRecordSchema.parse(next);
    if (parsed.sessionId !== sessionId
      || parsed.recordRevision !== expectedRevision + 1) {
      throw new FlagshipAssessmentErrorV3(
        "revision_conflict",
        "旗舰评价 CAS 后继修订非法",
      );
    }
    this.#records.set(sessionId, structuredClone(parsed));
  }
}

function recordFileName(sessionId: string): string {
  return `${hashValue(sessionId)}.json`;
}

export class JsonFileFlagshipAssessmentStoreV3
implements FlagshipAssessmentStoreV3 {
  constructor(private readonly directory: string) {}

  async create(record: FlagshipAssessmentRecordV3): Promise<void> {
    const parsed = FlagshipAssessmentRecordSchema.parse(record);
    if (await this.load(parsed.sessionId)) {
      throw new FlagshipAssessmentErrorV3(
        "revision_conflict",
        "旗舰评价记录已经存在",
      );
    }
    await this.#write(parsed);
  }

  async load(sessionId: string): Promise<FlagshipAssessmentRecordV3 | null> {
    let text: string;
    try {
      text = await readFile(this.#pathFor(sessionId), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    const parsed = FlagshipAssessmentRecordSchema.parse(JSON.parse(text));
    if (parsed.sessionId !== sessionId) {
      throw new FlagshipAssessmentErrorV3(
        "source_drift",
        "旗舰评价记录文件与会话不一致",
      );
    }
    return parsed;
  }

  async compareAndSet(
    sessionId: string,
    expectedRevision: number,
    next: FlagshipAssessmentRecordV3,
  ): Promise<void> {
    const current = await this.load(sessionId);
    if (!current || current.recordRevision !== expectedRevision) {
      throw new FlagshipAssessmentErrorV3(
        "revision_conflict",
        "旗舰评价已被其他操作更新",
      );
    }
    const parsed = FlagshipAssessmentRecordSchema.parse(next);
    if (parsed.sessionId !== sessionId
      || parsed.recordRevision !== expectedRevision + 1) {
      throw new FlagshipAssessmentErrorV3(
        "revision_conflict",
        "旗舰评价 CAS 后继修订非法",
      );
    }
    await this.#write(parsed);
  }

  #pathFor(sessionId: string): string {
    return resolve(this.directory, recordFileName(sessionId));
  }

  async #write(record: FlagshipAssessmentRecordV3): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const target = this.#pathFor(record.sessionId);
    const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
    const file = await open(temporary, "wx");
    let renamed = false;
    try {
      await file.writeFile(`${JSON.stringify(record)}\n`, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    try {
      await rename(temporary, target);
      renamed = true;
    } finally {
      if (!renamed) await unlink(temporary).catch(() => undefined);
    }
  }
}

interface AssessmentSourcesV3 {
  world: SimulationSessionRecord;
  work: FlagshipStudentWorkRecordV3 | null;
  collaboration: SimulationCollaborationSessionRecordV3 | null;
  learnerBindingId: string;
  learnerActorId: string;
  sourceHash: string;
}

interface EvidenceBuildV3 {
  episodes: CompetencyEvidenceEpisode[];
  semanticReceipts: FlagshipSemanticAssessmentReceiptV3[];
}

export interface TeacherCompetencyRevisionV3 {
  competencyClaimId: string;
  score: number;
  competencyLevel: number;
  rationale: string;
}

export interface ReviewFlagshipAssessmentInputV3 {
  sessionId: string;
  expectedAssessmentDecisionId: string;
  requestId: string;
  reviewerId: string;
  status: "confirmed" | "revised";
  reason: string;
  competencyRevisions: TeacherCompetencyRevisionV3[];
}

export interface FlagshipCompetencyAssessmentServiceV3Options {
  engine: Pick<WorldSimulationEngineV3, "getRecord">;
  orchestrator: {
    loadRecord(
      sessionId: string,
    ): Promise<SimulationCollaborationSessionRecordV3 | null>;
  };
  work: Pick<FlagshipStudentWorkServiceV3, "loadRecord">;
  manifest: XunpuFlagshipContentManifestV3;
  store: FlagshipAssessmentStoreV3;
  evaluator?: BlindSemanticAssessmentPortV3;
  now?: () => string;
}

function actionText(
  action: SimulationSessionRecord["studentActions"][number],
): string {
  const payload = action.action;
  if (payload.verb === "observe") return payload.observationFocus;
  if (payload.verb === "ask"
    || payload.verb === "probe"
    || payload.verb === "negotiate") return payload.utterance;
  if (payload.verb === "inspect" || payload.verb === "compare") {
    return payload.evidenceQuestion;
  }
  if (payload.verb === "wait") return payload.reason;
  if (payload.verb === "escalate") return payload.reason;
  if (payload.verb === "draft" || payload.verb === "submit") {
    return `${payload.verb}:${payload.artifactId}`;
  }
  return "未知学生行动";
}

function actionArtifactId(
  action: SimulationSessionRecord["studentActions"][number],
): string | null {
  return action.action.verb === "draft" || action.action.verb === "submit"
    ? action.action.artifactId
    : null;
}

function actionCriterionIds(
  action: SimulationSessionRecord["studentActions"][number],
  manifest: XunpuFlagshipContentManifestV3,
): string[] {
  const verb = action.action.verb;
  const ids = verb === "observe"
    ? ["criterion-fact-verification", "criterion-editorial-judgment"]
    : verb === "ask" || verb === "probe" || verb === "negotiate"
      ? ["criterion-interview-consent", "criterion-editorial-judgment"]
      : verb === "inspect" || verb === "compare"
        ? ["criterion-fact-verification", "criterion-rights-governance"]
        : verb === "escalate"
          ? ["criterion-rights-governance", "criterion-editorial-judgment", "criterion-recovery-transfer"]
          : verb === "wait"
            ? ["criterion-recovery-transfer"]
            : [];
  const artifactId = actionArtifactId(action);
  if (artifactId !== null) {
    ids.push(...manifest.rubricBlueprints
      .filter((criterion) => criterion.artifactRefs.includes(artifactId))
      .map((criterion) => criterion.criterionId));
  }
  return unique(ids);
}

function observationDirectionFromAction(
  action: SimulationSessionRecord["studentActions"][number],
): EvidenceObservation["direction"] {
  const text = `${actionText(action)} ${action.reflectionNote ?? ""}`.trim();
  if (action.submissionStatus === "rejected") return "refutes";
  return text.length >= 24 ? "supports" : "insufficient";
}

function completionStatus(
  sources: AssessmentSourcesV3,
  manifest: XunpuFlagshipContentManifestV3,
): AssessmentDecision["completionStatus"] {
  const hasActivity = sources.world.studentActions.length > 0
    || (sources.work?.revisions.length ?? 0) > 0;
  if (!hasActivity) return "not_started";
  if (sources.world.currentSnapshot.endingState.status !== "active") {
    return "completed";
  }
  const required = manifest.artifacts.filter((artifact) => (
    artifact.requiredAtChallengeLevels.includes(
      sources.world.challengeAssignment.challengeLevel,
    )
  ));
  const allSubmitted = required.every((definition) => (
    sources.work?.artifacts.some((artifact) => (
      artifact.artifactId === definition.artifactId
        && artifact.status === "submitted"
    )) === true
  ));
  return allSubmitted ? "submitted" : "in_progress";
}

function criterionLevel(score: number): number {
  if (score >= 90) return 5;
  if (score >= 75) return 4;
  if (score >= 60) return 3;
  if (score >= 45) return 2;
  return 1;
}

function behaviorStatement(
  action: SimulationSessionRecord["studentActions"][number],
): BlindAssessmentBehaviorV3 {
  return {
    verb: action.action.verb,
    statement: actionText(action),
    reflection: action.reflectionNote,
  };
}

export class FlagshipCompetencyAssessmentServiceV3 {
  readonly #evaluator: BlindSemanticAssessmentPortV3;
  readonly #locks = new Map<string, Promise<void>>();

  constructor(
    private readonly options: FlagshipCompetencyAssessmentServiceV3Options,
  ) {
    if (options.manifest.rubricBlueprints.reduce(
      (sum, criterion) => sum + criterion.weight,
      0,
    ) !== 100) {
      throw new Error("旗舰能力评价量规权重必须冻结为 100");
    }
    this.#evaluator = options.evaluator
      ?? new DeterministicBlindSemanticAssessmentV3();
  }

  /**
   * Read-only access for downstream learning analytics. This method never
   * creates an assessment or re-runs the evaluator; callers that need a fresh
   * decision must explicitly call getAssessment first.
   */
  async loadRecord(sessionId: string): Promise<FlagshipAssessmentRecordV3 | null> {
    return this.options.store.load(sessionId);
  }

  async getAssessment(input: {
    sessionId: string;
    fallbackLearner?: { bindingId: string; actorId: string };
  }): Promise<FlagshipAssessmentRecordV3> {
    return this.#serialized(input.sessionId, async () => {
      const current = await this.options.store.load(input.sessionId);
      const sources = await this.#sources({
        ...input,
        ...(input.fallbackLearner || !current ? {} : {
          fallbackLearner: {
            bindingId: current.learnerBindingId,
            actorId: current.learnerActorId,
          },
        }),
      });
      if (current?.sourceHash === sources.sourceHash) return current;
      const timestamp = this.#now();
      const evidence = await this.#buildEvidence(sources, timestamp);
      const { decision, computations } = this.#buildDecision(
        sources,
        evidence,
        timestamp,
      );
      if (current === null) {
        const created = FlagshipAssessmentRecordSchema.parse({
          recordVersion: FlagshipAssessmentRecordV3Version,
          recordRevision: 0,
          sessionId: input.sessionId,
          learnerBindingId: sources.learnerBindingId,
          learnerActorId: sources.learnerActorId,
          sourceHash: sources.sourceHash,
          evidenceEpisodes: evidence.episodes,
          semanticReceipts: evidence.semanticReceipts,
          scoreComputations: computations,
          decisionHistory: [{ sourceHash: sources.sourceHash, decision }],
          reviewReceipts: [],
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        try {
          await this.options.store.create(created);
          return created;
        } catch (error) {
          if (!(error instanceof FlagshipAssessmentErrorV3)
            || error.code !== "revision_conflict") throw error;
          const raced = await this.options.store.load(input.sessionId);
          if (!raced) throw error;
          return raced;
        }
      }
      if (current.learnerActorId !== sources.learnerActorId) {
        throw new FlagshipAssessmentErrorV3(
          "source_drift",
          "同一旗舰会话出现不同学生演员，拒绝合并评价证据",
        );
      }
      const next = FlagshipAssessmentRecordSchema.parse({
        ...current,
        recordRevision: current.recordRevision + 1,
        sourceHash: sources.sourceHash,
        evidenceEpisodes: evidence.episodes,
        semanticReceipts: evidence.semanticReceipts,
        scoreComputations: computations,
        decisionHistory: [
          ...current.decisionHistory,
          { sourceHash: sources.sourceHash, decision },
        ],
        updatedAt: timestamp,
      });
      await this.options.store.compareAndSet(
        input.sessionId,
        current.recordRevision,
        next,
      );
      return next;
    });
  }

  async reviewAssessment(
    input: ReviewFlagshipAssessmentInputV3,
  ): Promise<FlagshipAssessmentRecordV3> {
    return this.#serialized(input.sessionId, async () => {
      const record = await this.options.store.load(input.sessionId);
      if (!record) {
        throw new FlagshipAssessmentErrorV3("not_found", "尚未形成旗舰评价案例");
      }
      const requestHash = hashValue({
        expectedAssessmentDecisionId: input.expectedAssessmentDecisionId,
        status: input.status,
        reason: input.reason.trim(),
        competencyRevisions: input.competencyRevisions,
      });
      const replay = record.reviewReceipts.find(
        (receipt) => receipt.requestId === input.requestId,
      );
      if (replay) {
        if (replay.requestHash !== requestHash) {
          throw new FlagshipAssessmentErrorV3(
            "request_replay_conflict",
            "同一教师复核请求不得承载不同内容",
          );
        }
        return record;
      }
      const current = record.decisionHistory.at(-1)!.decision;
      if (current.assessmentDecisionId !== input.expectedAssessmentDecisionId) {
        throw new FlagshipAssessmentErrorV3(
          "assessment_stale",
          "学生证据已经更新，请按最新评价重新复核",
        );
      }
      if (current.teacherReview.status !== "pending") {
        throw new FlagshipAssessmentErrorV3(
          "invalid_review",
          "当前评价已经完成教师复核",
        );
      }
      if (input.reason.trim().length < 8 || input.reason.trim().length > 1_000) {
        throw new FlagshipAssessmentErrorV3(
          "invalid_review",
          "教师复核理由必须为 8—1000 字",
        );
      }
      if (input.status === "confirmed" && input.competencyRevisions.length > 0) {
        throw new FlagshipAssessmentErrorV3(
          "invalid_review",
          "确认评价不得同时提交维度修订",
        );
      }
      if (input.status === "revised" && input.competencyRevisions.length === 0) {
        throw new FlagshipAssessmentErrorV3(
          "invalid_review",
          "修订评价必须至少修改一个有充分证据的能力维度",
        );
      }
      const revisionByClaim = new Map(
        input.competencyRevisions.map((revision) => [
          revision.competencyClaimId,
          revision,
        ]),
      );
      if (revisionByClaim.size !== input.competencyRevisions.length) {
        throw new FlagshipAssessmentErrorV3(
          "invalid_review",
          "同一能力维度不得重复修订",
        );
      }
      const estimates = current.competencyEstimates.map((estimate) => {
        const revision = revisionByClaim.get(estimate.competencyClaimId);
        if (!revision) return estimate;
        if (estimate.evidenceStatus === "insufficient"
          || estimate.score === null
          || estimate.competencyLevel === null) {
          throw new FlagshipAssessmentErrorV3(
            "invalid_review",
            "证据不足维度不得由教师直接补造分数",
          );
        }
        if (!Number.isFinite(revision.score)
          || revision.score < 0
          || revision.score > 100
          || !Number.isInteger(revision.competencyLevel)
          || revision.competencyLevel < 1
          || revision.competencyLevel > 5
          || revision.rationale.trim().length < 8
          || revision.rationale.trim().length > 1_000) {
          throw new FlagshipAssessmentErrorV3(
            "invalid_review",
            "教师维度修订的分数、等级或理由非法",
          );
        }
        return {
          ...estimate,
          score: revision.score,
          competencyLevel: revision.competencyLevel,
          rationale: revision.rationale.trim(),
        };
      });
      if ([...revisionByClaim.keys()].some((claimId) => (
        !current.competencyEstimates.some(
          (estimate) => estimate.competencyClaimId === claimId,
        )
      ))) {
        throw new FlagshipAssessmentErrorV3(
          "invalid_review",
          "教师不得修订冻结量规之外的能力维度",
        );
      }
      const timestamp = this.#now();
      const reviewedScore = current.scoreStatus === "insufficient_evidence"
        ? null
        : this.#weightedScore(estimates, current.scoreCeiling);
      const reviewed = AssessmentDecisionSchema.parse({
        ...current,
        assessmentDecisionId: stableId("assessment-review", {
          requestId: input.requestId,
          requestHash,
        }),
        scoreStatus: current.scoreStatus === "insufficient_evidence"
          ? "insufficient_evidence"
          : "final",
        sessionScore: reviewedScore,
        competencyEstimates: estimates,
        teacherReview: {
          status: input.status,
          reviewerId: input.reviewerId,
          reviewedAt: timestamp,
          reason: input.reason.trim(),
        },
        generatedAt: timestamp,
      });
      const next = FlagshipAssessmentRecordSchema.parse({
        ...record,
        recordRevision: record.recordRevision + 1,
        decisionHistory: [
          ...record.decisionHistory,
          { sourceHash: record.sourceHash, decision: reviewed },
        ],
        reviewReceipts: [
          ...record.reviewReceipts,
          {
            requestId: input.requestId,
            requestHash,
            sourceAssessmentDecisionId: current.assessmentDecisionId,
            resultAssessmentDecisionId: reviewed.assessmentDecisionId,
            reviewerId: input.reviewerId,
            status: input.status,
            changedCompetencyClaimIds: [...revisionByClaim.keys()],
            createdAt: timestamp,
          },
        ],
        updatedAt: timestamp,
      });
      await this.options.store.compareAndSet(
        input.sessionId,
        record.recordRevision,
        next,
      );
      return next;
    });
  }

  projectEvidence(
    record: FlagshipAssessmentRecordV3,
    audience: "student" | "teacher" | "admin",
  ) {
    const decision = record.decisionHistory.at(-1)!.decision;
    return {
      schemaVersion: FlagshipCompetencyEvidenceViewV3Version,
      audience,
      assessmentBoundary: {
        artifactCompletionIsNotCompetencyScore: true as const,
        evidenceInsufficientMeansNoScore: true as const,
        finalAuthority: "teacher" as const,
        rubricReviewStatus: "pending_expert_review" as const,
      },
      assessment: decision,
      evidenceEpisodes: record.evidenceEpisodes,
      criteria: this.options.manifest.rubricBlueprints.map((criterion) => ({
        competencyClaimId: criterion.criterionId,
        title: criterion.title,
        weight: criterion.weight,
        minimumIndependentEvidenceCount:
          criterion.minimumIndependentEvidenceCount,
        observableEvidence: criterion.observableEvidence,
      })),
      generatedAt: record.updatedAt,
    };
  }

  projectAdminCase(record: FlagshipAssessmentRecordV3) {
    return {
      schemaVersion: FlagshipAssessmentCaseViewV3Version,
      sessionId: record.sessionId,
      sourceHash: record.sourceHash,
      assessmentBoundary: {
        evaluatorSeesIdentity: false as const,
        evaluatorSeesChallengeLevel: false as const,
        evaluatorSeesAgentAdvice: false as const,
        completionIsScore: false as const,
        finalAuthority: "teacher" as const,
        rubricReviewStatus: "pending_expert_review" as const,
      },
      evidenceEpisodes: record.evidenceEpisodes,
      semanticReceipts: record.semanticReceipts,
      scoreComputations: record.scoreComputations,
      decisionHistory: record.decisionHistory.map((entry) => entry.decision),
      reviewReceipts: record.reviewReceipts,
      recomputation: {
        sourceHashAlgorithm: "sha256-canonical-json",
        semanticInputHashRecorded: true,
        challengeAppliedAfterBlindEvaluation: true,
        sourceRecordRevision: record.recordRevision,
      },
      updatedAt: record.updatedAt,
    };
  }

  async #sources(input: {
    sessionId: string;
    fallbackLearner?: { bindingId: string; actorId: string };
  }): Promise<AssessmentSourcesV3> {
    const [world, work, collaboration] = await Promise.all([
      this.options.engine.getRecord(input.sessionId),
      this.options.work.loadRecord(input.sessionId),
      this.options.orchestrator.loadRecord(input.sessionId),
    ]);
    const actionActors = unique(world.studentActions.map((action) => action.actorId));
    if (actionActors.length > 1) {
      throw new FlagshipAssessmentErrorV3(
        "source_drift",
        "同一会话存在多个学生演员，拒绝混合能力证据",
      );
    }
    const learnerActorId = work?.actorId
      ?? actionActors[0]
      ?? input.fallbackLearner?.actorId;
    const learnerBindingId = work?.bindingId
      ?? world.studentActions[0]?.bindingId
      ?? input.fallbackLearner?.bindingId;
    if (!learnerActorId || !learnerBindingId) {
      throw new FlagshipAssessmentErrorV3(
        "not_found",
        "学生尚未进入旗舰世界，当前没有可评价主体",
      );
    }
    if (work && actionActors[0] && work.actorId !== actionActors[0]) {
      throw new FlagshipAssessmentErrorV3(
        "source_drift",
        "作品作者与世界行动者不一致",
      );
    }
    if (work && (
      work.challengeLevel !== world.challengeAssignment.challengeLevel
      || work.manifestId !== this.options.manifest.manifestId
      || work.manifestContentHash !== this.options.manifest.contentHash
    )) {
      throw new FlagshipAssessmentErrorV3(
        "source_drift",
        "作品、挑战或旗舰内容发布版发生漂移",
      );
    }
    if (collaboration && (
      collaboration.simulationReleaseRef.releaseId
        !== world.release.simulationReleaseRef.releaseId
      || collaboration.simulationReleaseRef.version
        !== world.release.simulationReleaseRef.version
      || collaboration.simulationReleaseRef.contentHash
        !== world.release.simulationReleaseRef.contentHash
    )) {
      throw new FlagshipAssessmentErrorV3(
        "source_drift",
        "智能体 Episode 与世界发布版发生漂移",
      );
    }
    const sourceHash = hashValue({
      manifestId: this.options.manifest.manifestId,
      manifestContentHash: this.options.manifest.contentHash,
      challengeAssignment: world.challengeAssignment,
      endingState: world.currentSnapshot.endingState,
      studentActions: world.studentActions,
      resolutions: world.resolutions.map((resolution) => ({
        resolutionId: resolution.resolutionId,
        sourceWorldEventId: resolution.sourceWorldEventId,
        status: resolution.status,
        emittedEvidenceIds: resolution.emittedEvidenceIds,
        teacherGate: resolution.teacherGate,
        resolvedAt: resolution.resolvedAt,
      })),
      consequences: world.consequences,
      work: work ? {
        recordRevision: work.recordRevision,
        artifacts: work.artifacts,
        revisions: work.revisions,
      } : null,
      collaboration: collaboration ? {
        recordRevision: collaboration.recordRevision,
        episodes: collaboration.episodes.map((episode) => ({
          episodeId: episode.episodeId,
          eventId: episode.event.eventId,
          studentDecision: episode.studentDecision,
          resolutionId: episode.resolutionId,
          status: episode.status,
          failureCode: episode.failureCode,
        })),
      } : null,
    });
    return {
      world,
      work,
      collaboration,
      learnerActorId,
      learnerBindingId,
      sourceHash,
    };
  }

  async #buildEvidence(
    sources: AssessmentSourcesV3,
    evaluatedAt: string,
  ): Promise<EvidenceBuildV3> {
    const episodes: CompetencyEvidenceEpisode[] = [];
    const semanticReceipts: FlagshipSemanticAssessmentReceiptV3[] = [];
    const actions = sources.world.studentActions.filter(
      (action) => action.actorId === sources.learnerActorId,
    );
    const behaviors = actions.map(behaviorStatement);
    for (const revision of sources.work?.revisions ?? []) {
      const criteria = this.options.manifest.rubricBlueprints.filter(
        (criterion) => criterion.artifactRefs.includes(revision.artifactId),
      );
      if (criteria.length === 0) continue;
      const episodeId = stableId("evidence-artifact", revision.revisionId);
      const observations: EvidenceObservation[] = [];
      for (const criterion of criteria) {
        const blindInput: BlindSemanticAssessmentInputV3 = {
          criterion: {
            criterionId: criterion.criterionId,
            title: criterion.title,
            observableEvidence: [...criterion.observableEvidence],
            failClosedWhen: [...criterion.failClosedWhen],
          },
          documents: [{
            artifactId: revision.artifactId,
            revisionId: revision.revisionId,
            revisionNumber: revision.revisionNumber,
            fields: revision.fields.map((field) => ({ ...field })),
            evidenceCount: revision.evidenceRefs.length,
            revisionNote: revision.revisionNote,
          }],
          behaviors: behaviors.filter((behavior) => (
            this.#behaviorRelevant(criterion.criterionId, behavior.verb)
          )),
        };
        const output = await this.#evaluator.evaluate(structuredClone(blindInput));
        if ((output.direction !== "insufficient" && output.score === null)
          || (output.score !== null && (output.score < 0 || output.score > 100))
          || output.confidence < 0
          || output.confidence > 1
          || output.rationale.trim().length === 0) {
          throw new FlagshipAssessmentErrorV3(
            "source_drift",
            "盲评端口返回了不一致的分数或证据方向",
          );
        }
        const observation: EvidenceObservation = {
          observationId: stableId("observation", {
            revisionId: revision.revisionId,
            criterionId: criterion.criterionId,
          }),
          competencyClaimId: criterion.criterionId,
          direction: output.direction,
          observableBehavior: `作品《${this.#artifactTitle(revision.artifactId)}》第 ${revision.revisionNumber} 版形成可复核文本与 ${revision.evidenceRefs.length} 项来源引用。`,
          sourceRefs: unique([revision.revisionId, ...revision.evidenceRefs]),
          artifactRevisionRefs: [revision.revisionId],
          worldConsequenceRefs: [],
          scaffoldingLevel: sources.world.currentSnapshot.learningContext.scaffoldingLevel,
          evaluatorConfidence: output.confidence,
        };
        observations.push(observation);
        const receipt = SemanticReceiptSchema.parse({
          semanticReceiptId: stableId("semantic-receipt", {
            episodeId,
            criterionId: criterion.criterionId,
            inputHash: hashValue(blindInput),
          }),
          evidenceEpisodeId: episodeId,
          competencyClaimId: criterion.criterionId,
          evaluatorMode: output.mode,
          inputHash: hashValue(blindInput),
          outputHash: hashValue(output),
          direction: output.direction,
          rawScore: output.score,
          confidence: output.confidence,
          rationale: output.rationale,
          evaluatedAt,
        });
        semanticReceipts.push(receipt);
      }
      episodes.push(CompetencyEvidenceEpisodeSchema.parse({
        schemaVersion: CompetencyEvidenceEpisodeSchemaVersion,
        evidenceEpisodeId: episodeId,
        sessionId: sources.world.sessionId,
        bindingId: sources.learnerBindingId,
        actorId: sources.learnerActorId,
        courseReleaseRef: sources.world.release.courseReleaseRef,
        simulationReleaseRef: sources.world.release.simulationReleaseRef,
        challengeAssignmentRef:
          sources.world.challengeAssignment.challengeAssignmentId,
        sourceKind: "artifact_revision",
        sourceActionRefs: [revision.revisionId],
        observations,
        evidenceEligible: true,
        collectedAt: revision.createdAt,
      }));
    }
    for (const action of actions) {
      const criterionIds = actionCriterionIds(action, this.options.manifest);
      if (criterionIds.length === 0) continue;
      const direction = observationDirectionFromAction(action);
      const sourceRefs = unique([
        action.workActionId,
        ...action.sourceWorldEventIds,
      ]);
      episodes.push(CompetencyEvidenceEpisodeSchema.parse({
        schemaVersion: CompetencyEvidenceEpisodeSchemaVersion,
        evidenceEpisodeId: stableId("evidence-action", action.workActionId),
        sessionId: sources.world.sessionId,
        bindingId: sources.learnerBindingId,
        actorId: sources.learnerActorId,
        courseReleaseRef: sources.world.release.courseReleaseRef,
        simulationReleaseRef: sources.world.release.simulationReleaseRef,
        challengeAssignmentRef:
          sources.world.challengeAssignment.challengeAssignmentId,
        sourceKind: "real_student_action",
        sourceActionRefs: [action.workActionId],
        observations: criterionIds.map((criterionId) => ({
          observationId: stableId("observation", {
            actionId: action.workActionId,
            criterionId,
          }),
          competencyClaimId: criterionId,
          direction,
          observableBehavior: `学生真实执行“${action.action.verb}”：${actionText(action).slice(0, 520)}`,
          sourceRefs,
          artifactRevisionRefs: action.action.verb === "draft"
            || action.action.verb === "submit"
            ? [action.action.revisionId]
            : [],
          worldConsequenceRefs: [],
          scaffoldingLevel:
            sources.world.currentSnapshot.learningContext.scaffoldingLevel,
          evaluatorConfidence: direction === "insufficient" ? 0.35 : 0.72,
        })),
        evidenceEligible: true,
        collectedAt: action.createdAt,
      }));
    }
    for (const episode of sources.collaboration?.episodes ?? []) {
      const decision = episode.studentDecision;
      if (!decision) continue;
      const criterionIds = decision.decision === "request_evidence"
        ? ["criterion-fact-verification", "criterion-recovery-transfer"]
        : decision.decision === "reject"
          ? ["criterion-editorial-judgment", "criterion-recovery-transfer"]
          : ["criterion-recovery-transfer"];
      const direction = decision.decision === "accept"
        ? "insufficient" as const
        : decision.rationale.trim().length >= 24
          ? "supports" as const
          : "insufficient" as const;
      episodes.push(CompetencyEvidenceEpisodeSchema.parse({
        schemaVersion: CompetencyEvidenceEpisodeSchemaVersion,
        evidenceEpisodeId: stableId("evidence-decision", decision.decisionRef),
        sessionId: sources.world.sessionId,
        bindingId: sources.learnerBindingId,
        actorId: sources.learnerActorId,
        courseReleaseRef: sources.world.release.courseReleaseRef,
        simulationReleaseRef: sources.world.release.simulationReleaseRef,
        challengeAssignmentRef:
          sources.world.challengeAssignment.challengeAssignmentId,
        sourceKind: "real_student_action",
        sourceActionRefs: [decision.decisionRef],
        observations: criterionIds.map((criterionId) => ({
          observationId: stableId("observation", {
            decisionRef: decision.decisionRef,
            criterionId,
          }),
          competencyClaimId: criterionId,
          direction,
          observableBehavior: `学生对协作建议选择“${decision.decision}”，并给出理由：${decision.rationale.slice(0, 480)}`,
          sourceRefs: [decision.decisionRef, episode.event.eventId],
          artifactRevisionRefs: [],
          worldConsequenceRefs: [],
          scaffoldingLevel: decision.decision === "accept"
            ? clamp(
                sources.world.currentSnapshot.learningContext.scaffoldingLevel + 1,
                0,
                3,
              )
            : sources.world.currentSnapshot.learningContext.scaffoldingLevel,
          evaluatorConfidence: direction === "supports" ? 0.7 : 0.35,
        })),
        evidenceEligible: true,
        collectedAt: decision.decidedAt,
      }));
    }
    for (const resolution of sources.world.resolutions) {
      if (!resolution.teacherGate
        || resolution.teacherGate.teacherDecisionRef === null
        || resolution.teacherGate.status === "pending") continue;
      const direction = resolution.teacherGate.status === "approved"
        ? "supports" as const
        : "refutes" as const;
      const decisionRef = resolution.teacherGate.teacherDecisionRef;
      episodes.push(CompetencyEvidenceEpisodeSchema.parse({
        schemaVersion: CompetencyEvidenceEpisodeSchemaVersion,
        evidenceEpisodeId: stableId("evidence-teacher", decisionRef),
        sessionId: sources.world.sessionId,
        bindingId: sources.learnerBindingId,
        actorId: sources.learnerActorId,
        courseReleaseRef: sources.world.release.courseReleaseRef,
        simulationReleaseRef: sources.world.release.simulationReleaseRef,
        challengeAssignmentRef:
          sources.world.challengeAssignment.challengeAssignmentId,
        sourceKind: "teacher_decision",
        sourceActionRefs: [decisionRef],
        observations: ["criterion-editorial-judgment", "criterion-rights-governance"].map(
          (criterionId) => ({
            observationId: stableId("observation", { decisionRef, criterionId }),
            competencyClaimId: criterionId,
            direction,
            observableBehavior: `教师门对学生提交形成“${resolution.teacherGate!.status}”决定；该判断只作为该维度证据，不由终局状态替代。`,
            sourceRefs: [decisionRef, resolution.resolutionId],
            artifactRevisionRefs: [],
            worldConsequenceRefs: [],
            scaffoldingLevel:
              sources.world.currentSnapshot.learningContext.scaffoldingLevel,
            evaluatorConfidence: 0.8,
          }),
        ),
        evidenceEligible: true,
        collectedAt: resolution.committedAt ?? resolution.resolvedAt,
      }));
    }
    for (const consequence of sources.world.consequences) {
      episodes.push(CompetencyEvidenceEpisodeSchema.parse({
        schemaVersion: CompetencyEvidenceEpisodeSchemaVersion,
        evidenceEpisodeId: stableId("evidence-consequence", consequence.eventId),
        sessionId: sources.world.sessionId,
        bindingId: sources.learnerBindingId,
        actorId: sources.learnerActorId,
        courseReleaseRef: sources.world.release.courseReleaseRef,
        simulationReleaseRef: sources.world.release.simulationReleaseRef,
        challengeAssignmentRef:
          sources.world.challengeAssignment.challengeAssignmentId,
        sourceKind: "world_consequence",
        sourceActionRefs: [consequence.eventId],
        observations: [{
          observationId: stableId("observation", consequence.eventId),
          competencyClaimId: "criterion-recovery-transfer",
          direction: "insufficient",
          observableBehavior: `世界已真实回写后果：${consequence.publicSummary.slice(0, 520)}。后果本身不自动换算为高分或低分。`,
          sourceRefs: [consequence.eventId, consequence.resolutionId],
          artifactRevisionRefs: [],
          worldConsequenceRefs: [consequence.eventId],
          scaffoldingLevel:
            sources.world.currentSnapshot.learningContext.scaffoldingLevel,
          evaluatorConfidence: 0.5,
        }],
        evidenceEligible: true,
        collectedAt: consequence.occurredAt,
      }));
    }
    return { episodes, semanticReceipts };
  }

  #buildDecision(
    sources: AssessmentSourcesV3,
    evidence: EvidenceBuildV3,
    generatedAt: string,
  ): {
    decision: AssessmentDecision;
    computations: FlagshipScoreComputationV3[];
  } {
    const computations = this.options.manifest.rubricBlueprints.map(
      (criterion) => this.#criterionComputation(
        criterion,
        sources,
        evidence,
      ),
    );
    const allSufficient = computations.every(
      (computation) => computation.failClosedReasons.length === 0
        && computation.normalizedScore !== null,
    );
    const estimates: CompetencyEstimate[] = allSufficient
      ? computations.map((computation) => {
          const score = computation.normalizedScore!;
          const episodes = evidence.episodes.filter((episode) => (
            computation.evidenceEpisodeRefs.includes(episode.evidenceEpisodeId)
          ));
          const directions = episodes.flatMap((episode) => episode.observations)
            .filter((observation) => (
              observation.competencyClaimId === computation.competencyClaimId
                && observation.direction !== "insufficient"
            ));
          const supports = directions.filter(
            (observation) => observation.direction === "supports",
          ).length;
          const refutes = directions.filter(
            (observation) => observation.direction === "refutes",
          ).length;
          return {
            competencyClaimId: computation.competencyClaimId,
            evidenceStatus: refutes === 0
              ? "supported" as const
              : supports === 0
                ? "refuted" as const
                : "mixed" as const,
            competencyLevel: criterionLevel(score),
            score,
            confidence: Number(clamp(
              0.45 + computation.eligibleIndependentEvidenceCount * 0.06,
              0,
              0.9,
            ).toFixed(2)),
            evidenceEpisodeRefs: computation.evidenceEpisodeRefs,
            rationale: this.#criterionRationale(computation),
          };
        })
      : computations.map((computation) => ({
          competencyClaimId: computation.competencyClaimId,
          evidenceStatus: "insufficient" as const,
          competencyLevel: null,
          score: null,
          confidence: 0,
          evidenceEpisodeRefs: [],
          rationale: computation.failClosedReasons.length > 0
            ? `证据不足：${computation.failClosedReasons.join("；")}`
            : "其余必评维度仍证据不足，本轮不发布局部分数，避免形成误导性排名。",
        }));
    const evidenceEpisodeRefs = allSufficient
      ? unique(computations.flatMap((item) => item.evidenceEpisodeRefs))
      : [];
    const nextGrowthTargets = computations
      .filter((item) => item.normalizedScore === null)
      .map((item) => item.competencyClaimId)
      .slice(0, 6);
    if (nextGrowthTargets.length === 0) {
      nextGrowthTargets.push(...[...computations]
        .sort((left, right) => (
          (left.normalizedScore ?? 101) - (right.normalizedScore ?? 101)
        ))
        .slice(0, 2)
        .map((item) => item.competencyClaimId));
    }
    const sessionScore = allSufficient
      ? this.#weightedScore(estimates, sources.world.challengeAssignment.scoreCeiling)
      : null;
    const decision = AssessmentDecisionSchema.parse({
      schemaVersion: AssessmentDecisionSchemaVersion,
      assessmentDecisionId: stableId("assessment", sources.sourceHash),
      sessionId: sources.world.sessionId,
      bindingId: sources.learnerBindingId,
      learnerTwinRef: sources.world.challengeAssignment.learnerTwinRef,
      courseReleaseRef: sources.world.release.courseReleaseRef,
      simulationReleaseRef: sources.world.release.simulationReleaseRef,
      challengeAssignmentRef:
        sources.world.challengeAssignment.challengeAssignmentId,
      challengeLevel: sources.world.challengeAssignment.challengeLevel,
      scoreCeiling: sources.world.challengeAssignment.scoreCeiling,
      completionStatus: completionStatus(sources, this.options.manifest),
      scoreStatus: allSufficient ? "provisional" : "insufficient_evidence",
      sessionScore,
      competencyEstimates: estimates,
      evidenceEpisodeRefs,
      growthSummary: allSufficient
        ? `本轮已形成六维暂定能力判断，挑战 ${sources.world.challengeAssignment.challengeLevel} 级、分数上限 ${sources.world.challengeAssignment.scoreCeiling}；须经教师逐维复核后方可成为最终评价。`
        : `当前已记录 ${evidence.episodes.length} 个真实证据 Episode，但至少一个必评维度未过独立证据门，因此不显示数值分数。`,
      nextGrowthTargets,
      teacherReview: {
        status: "pending",
        reviewerId: null,
        reviewedAt: null,
        reason: null,
      },
      generatedAt,
    });
    return { decision, computations };
  }

  #criterionComputation(
    criterion: Rubric,
    sources: AssessmentSourcesV3,
    evidence: EvidenceBuildV3,
  ): FlagshipScoreComputationV3 {
    const relevantEpisodes = evidence.episodes.filter((episode) => (
      episode.observations.some((observation) => (
        observation.competencyClaimId === criterion.criterionId
          && observation.direction !== "insufficient"
      ))
    ));
    const semantic = evidence.semanticReceipts.filter((receipt) => (
      receipt.competencyClaimId === criterion.criterionId
        && receipt.rawScore !== null
    ));
    const failClosedReasons: string[] = [];
    if (relevantEpisodes.length < criterion.minimumIndependentEvidenceCount) {
      failClosedReasons.push(
        `需 ${criterion.minimumIndependentEvidenceCount} 项独立证据，当前仅 ${relevantEpisodes.length} 项`,
      );
    }
    const hasArtifact = relevantEpisodes.some(
      (episode) => episode.sourceKind === "artifact_revision",
    );
    if (!hasArtifact) failClosedReasons.push("缺少可复核作品版本");
    const verbs = new Set(sources.world.studentActions.map(
      (action) => action.action.verb,
    ));
    const latestArtifactIds = new Set((sources.work?.artifacts ?? [])
      .filter((artifact) => artifact.latestRevisionId !== null)
      .map((artifact) => artifact.artifactId));
    if (criterion.criterionId === "criterion-fact-verification"
      && !["inspect", "compare", "probe"].some((verb) => verbs.has(verb as never))) {
      failClosedReasons.push("缺少真实核查、比较或追问信源行动");
    }
    if (criterion.criterionId === "criterion-interview-consent"
      && !["ask", "probe", "negotiate"].some((verb) => verbs.has(verb as never))) {
      failClosedReasons.push("缺少真实 NPC 采访或知情边界协商");
    }
    if (criterion.criterionId === "criterion-editorial-judgment"
      && !["observe", "ask", "probe", "negotiate", "escalate"].some(
        (verb) => verbs.has(verb as never),
      )) {
      failClosedReasons.push("缺少能够说明编辑取舍的现场决定");
    }
    if (criterion.criterionId === "criterion-rights-governance"
      && !["inspect", "compare", "escalate", "submit"].some(
        (verb) => verbs.has(verb as never),
      )) {
      failClosedReasons.push("缺少权利核查、升级或发布门行动");
    }
    if (criterion.criterionId === "criterion-multiplatform-production") {
      const count = criterion.artifactRefs.filter(
        (artifactId) => latestArtifactIds.has(artifactId),
      ).length;
      if (count < 2) failClosedReasons.push("至少需要两类相互一致的平台作品");
    }
    if (criterion.criterionId === "criterion-recovery-transfer") {
      const revised = (sources.work?.artifacts ?? []).some(
        (artifact) => artifact.revisionCount >= 2,
      );
      const reflectiveDecision = (sources.collaboration?.episodes ?? []).some(
        (episode) => episode.studentDecision?.decision !== "accept",
      ) || sources.world.studentActions.some(
        (action) => (action.reflectionNote?.length ?? 0) >= 24,
      );
      if (!revised && !reflectiveDecision) {
        failClosedReasons.push("缺少真实修订、补证/拒绝决定或轨迹反思");
      }
      if (!latestArtifactIds.has("artifact-transfer-reflection")) {
        failClosedReasons.push("缺少迁移复盘作品");
      }
    }
    const rawSemanticScore = semantic.length === 0
      ? null
      : Math.round(semantic.reduce(
          (sum, receipt) => sum + receipt.rawScore! * receipt.confidence,
          0,
        ) / Math.max(0.01, semantic.reduce(
          (sum, receipt) => sum + receipt.confidence,
          0,
        )));
    const directions = relevantEpisodes.flatMap((episode) => episode.observations)
      .filter((observation) => (
        observation.competencyClaimId === criterion.criterionId
          && observation.direction !== "insufficient"
      ));
    const behaviorAdjustment = clamp(Math.round(directions.reduce(
      (sum, observation) => sum + (observation.direction === "supports" ? 2 : -4),
      0,
    )), -20, 20);
    const challengeAdjustment = (sources.world.challengeAssignment.challengeLevel - 3) * 2;
    const normalizedScore = rawSemanticScore === null || failClosedReasons.length > 0
      ? null
      : Math.round(clamp(
          rawSemanticScore + behaviorAdjustment + challengeAdjustment,
          0,
          100,
        ));
    return ScoreComputationSchema.parse({
      competencyClaimId: criterion.criterionId,
      rawSemanticScore,
      behaviorAdjustment,
      challengeAdjustment,
      normalizedScore,
      minimumIndependentEvidenceCount:
        criterion.minimumIndependentEvidenceCount,
      eligibleIndependentEvidenceCount: relevantEpisodes.length,
      failClosedReasons: unique(failClosedReasons),
      evidenceEpisodeRefs: relevantEpisodes.map(
        (episode) => episode.evidenceEpisodeId,
      ),
    });
  }

  #weightedScore(
    estimates: CompetencyEstimate[],
    ceiling: number,
  ): number {
    const weighted = this.options.manifest.rubricBlueprints.reduce(
      (total, criterion) => {
        const estimate = estimates.find(
          (item) => item.competencyClaimId === criterion.criterionId,
        );
        if (!estimate || estimate.score === null) {
          throw new FlagshipAssessmentErrorV3(
            "invalid_review",
            "证据不完整时不得计算总分",
          );
        }
        return total + estimate.score * criterion.weight / 100;
      },
      0,
    );
    return Math.round(Math.min(weighted, ceiling));
  }

  #criterionRationale(computation: FlagshipScoreComputationV3): string {
    return `盲评原始分 ${computation.rawSemanticScore}，真实行为调整 ${computation.behaviorAdjustment >= 0 ? "+" : ""}${computation.behaviorAdjustment}，挑战后置调整 +${computation.challengeAdjustment}；共 ${computation.eligibleIndependentEvidenceCount} 项独立证据。此结果待教师逐维复核。`;
  }

  #behaviorRelevant(criterionId: string, verb: string): boolean {
    const map: Readonly<Record<string, readonly string[]>> = {
      "criterion-fact-verification": ["observe", "inspect", "compare", "probe"],
      "criterion-interview-consent": ["ask", "probe", "negotiate"],
      "criterion-editorial-judgment": ["observe", "ask", "probe", "negotiate", "escalate"],
      "criterion-rights-governance": ["inspect", "compare", "escalate", "submit"],
      "criterion-multiplatform-production": ["draft", "submit"],
      "criterion-recovery-transfer": ["wait", "escalate", "draft", "submit"],
    };
    return map[criterionId]?.includes(verb) ?? false;
  }

  #artifactTitle(artifactId: string): string {
    return this.options.manifest.artifacts.find(
      (artifact) => artifact.artifactId === artifactId,
    )?.title ?? artifactId;
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

export function currentFlagshipAssessmentDecisionV3(
  record: FlagshipAssessmentRecordV3,
): AssessmentDecision {
  return record.decisionHistory.at(-1)!.decision;
}

export function latestFlagshipWorkRevisionV3(
  work: FlagshipStudentWorkRecordV3,
  artifactId: string,
): FlagshipWorkRevisionV3 | null {
  const artifact = work.artifacts.find((item) => item.artifactId === artifactId);
  return artifact?.latestRevisionId
    ? work.revisions.find(
        (revision) => revision.revisionId === artifact.latestRevisionId,
      ) ?? null
    : null;
}
