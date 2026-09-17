import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import {
  ChallengeAssignmentSchema,
  ChallengeAssignmentSchemaVersion,
  LearnerSimulationForecastSchema,
  LearnerSimulationForecastSchemaVersion,
  LearnerTwinProfileSchema,
  LearnerTwinProfileSchemaVersion,
  PersonalizedLearningPlanSchema,
  PersonalizedLearningPlanSchemaVersion,
  V2ContentHashSchema,
  V2IdentifierSchema,
  challengeScoreCeiling,
  type AssessmentDecision,
  type ChallengeAssignment,
  type LearnerSimulationForecast,
  type LearnerTwinProfile,
  type PersonalizedLearningPlan,
  type StudentWorkAction,
} from "@ronggang/contracts";
import type { SimulationCollaborationSessionRecordV3 } from "@ronggang/agent-orchestrator";
import type { SimulationSessionRecord } from "@ronggang/world-core";
import {
  currentFlagshipAssessmentDecisionV3,
  type FlagshipAssessmentRecordV3,
} from "./flagship-assessment-v3.js";

export const LearnerAdaptationRecordV3Version =
  "learner-adaptation-record/3.0.0" as const;
export const LearnerGrowthViewV3Version =
  "learner-growth-view/3.0.0" as const;
export const LearnerAdaptationCaseViewV3Version =
  "learner-adaptation-case-view/3.0.0" as const;

const learnerTwinModelVersion = "learner-twin-evidence-updater/1.0.0";
const learnerProxyModelVersion = "learner-proxy-deterministic/1.0.0";
const challengePolicyVersion = "challenge-policy-evidence-zone/1.0.0";
const TimestampSchema = z.string().datetime();
const ChallengeLevelSchema = z.union([
  z.literal(3), z.literal(4), z.literal(5), z.literal(6), z.literal(7),
]);
type ChallengeLevel = z.infer<typeof ChallengeLevelSchema>;

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

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number, digits = 2): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function addDays(timestamp: string, days: number): string {
  return new Date(new Date(timestamp).getTime() + days * 86_400_000).toISOString();
}

const AdaptationUpdateReceiptSchema = z.object({
  sourceSessionId: V2IdentifierSchema,
  sourceAssessmentDecisionId: V2IdentifierSchema,
  sourceAssessmentHash: V2ContentHashSchema,
  learnerTwinRevision: z.number().int().positive(),
  forecastId: V2IdentifierSchema,
  challengeAssignmentId: V2IdentifierSchema,
  learningPlanId: V2IdentifierSchema,
  createdAt: TimestampSchema,
}).strict();

const ChallengePolicyReceiptSchema = z.object({
  policyReceiptId: V2IdentifierSchema,
  forecastId: V2IdentifierSchema,
  selectedCandidateId: V2IdentifierSchema,
  previousChallengeLevel: ChallengeLevelSchema,
  selectedChallengeLevel: ChallengeLevelSchema,
  fallbackReason: z.enum([
    "none",
    "low_profile_confidence",
    "high_prediction_error",
  ]),
  explanation: z.string().trim().min(1).max(1_000),
  createdAt: TimestampSchema,
}).strict();

const LearnerAppealRecordSchema = z.object({
  appealId: V2IdentifierSchema,
  requestId: V2IdentifierSchema,
  requestHash: V2ContentHashSchema,
  reason: z.string().trim().min(8).max(1_000),
  status: z.enum(["requested", "under_review", "resolved"]),
  requestedAt: TimestampSchema,
  reviewerHash: V2ContentHashSchema.nullable(),
  resolutionReason: z.string().trim().min(8).max(1_000).nullable(),
  resolvedAt: TimestampSchema.nullable(),
}).strict();

const AdaptationCommandReceiptSchema = z.object({
  requestId: V2IdentifierSchema,
  requestHash: V2ContentHashSchema,
  action: z.enum([
    "request_appeal",
    "confirm_plan",
    "override_challenge",
    "begin_appeal_review",
    "resolve_appeal",
  ]),
  resultRef: V2IdentifierSchema,
  actorHash: V2ContentHashSchema,
  createdAt: TimestampSchema,
}).strict();

const LearnerAdaptationRecordSchema = z.object({
  recordVersion: z.literal(LearnerAdaptationRecordV3Version),
  recordRevision: z.number().int().nonnegative(),
  learnerTwinId: V2IdentifierSchema,
  principalBindingHash: V2ContentHashSchema,
  profileHistory: z.array(LearnerTwinProfileSchema).min(1).max(256),
  forecasts: z.array(LearnerSimulationForecastSchema).max(256),
  challengeAssignments: z.array(ChallengeAssignmentSchema).max(256),
  learningPlans: z.array(PersonalizedLearningPlanSchema).max(256),
  updateReceipts: z.array(AdaptationUpdateReceiptSchema).max(256),
  policyReceipts: z.array(ChallengePolicyReceiptSchema).max(256),
  appeals: z.array(LearnerAppealRecordSchema).max(128),
  commandReceipts: z.array(AdaptationCommandReceiptSchema).max(256),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
}).strict().superRefine((record, context) => {
  if (record.profileHistory.some((profile) => (
    profile.learnerTwinId !== record.learnerTwinId
      || profile.principalBindingHash !== record.principalBindingHash
  ))) {
    context.addIssue({
      code: "custom",
      path: ["profileHistory"],
      message: "学习者画像历史不得跨主体拼接",
    });
  }
  const revisions = record.profileHistory.map((profile) => profile.revision);
  if (new Set(revisions).size !== revisions.length) {
    context.addIssue({
      code: "custom",
      path: ["profileHistory"],
      message: "学习者画像修订号必须唯一",
    });
  }
});

export type LearnerAdaptationRecordV3 = z.infer<
  typeof LearnerAdaptationRecordSchema
>;

export interface LearnerAdaptationStoreV3 {
  create(record: LearnerAdaptationRecordV3): Promise<void>;
  load(learnerTwinId: string): Promise<LearnerAdaptationRecordV3 | null>;
  compareAndSet(
    learnerTwinId: string,
    expectedRevision: number,
    next: LearnerAdaptationRecordV3,
  ): Promise<void>;
}

export class LearnerAdaptationErrorV3 extends Error {
  constructor(
    public readonly code:
      | "not_found"
      | "access_denied"
      | "insufficient_evidence"
      | "source_drift"
      | "revision_conflict"
      | "request_replay_conflict"
      | "invalid_decision"
      | "appeal_pending",
    message: string,
  ) {
    super(message);
    this.name = "LearnerAdaptationErrorV3";
  }
}

export class InMemoryLearnerAdaptationStoreV3
implements LearnerAdaptationStoreV3 {
  readonly #records = new Map<string, LearnerAdaptationRecordV3>();

  async create(record: LearnerAdaptationRecordV3): Promise<void> {
    const parsed = LearnerAdaptationRecordSchema.parse(record);
    if (this.#records.has(parsed.learnerTwinId)) {
      throw new LearnerAdaptationErrorV3(
        "revision_conflict",
        "学习者成长记录已经存在",
      );
    }
    this.#records.set(parsed.learnerTwinId, structuredClone(parsed));
  }

  async load(learnerTwinId: string): Promise<LearnerAdaptationRecordV3 | null> {
    const record = this.#records.get(learnerTwinId);
    return record ? structuredClone(record) : null;
  }

  async compareAndSet(
    learnerTwinId: string,
    expectedRevision: number,
    next: LearnerAdaptationRecordV3,
  ): Promise<void> {
    const current = this.#records.get(learnerTwinId);
    if (!current || current.recordRevision !== expectedRevision) {
      throw new LearnerAdaptationErrorV3(
        "revision_conflict",
        "学习者成长记录已被其他操作更新",
      );
    }
    const parsed = LearnerAdaptationRecordSchema.parse(next);
    if (parsed.learnerTwinId !== learnerTwinId
      || parsed.recordRevision !== expectedRevision + 1) {
      throw new LearnerAdaptationErrorV3(
        "revision_conflict",
        "学习者成长 CAS 后继修订非法",
      );
    }
    this.#records.set(learnerTwinId, structuredClone(parsed));
  }
}

function recordFileName(learnerTwinId: string): string {
  return `${hashValue(learnerTwinId)}.json`;
}

export class JsonFileLearnerAdaptationStoreV3
implements LearnerAdaptationStoreV3 {
  constructor(private readonly directory: string) {}

  async create(record: LearnerAdaptationRecordV3): Promise<void> {
    const parsed = LearnerAdaptationRecordSchema.parse(record);
    if (await this.load(parsed.learnerTwinId)) {
      throw new LearnerAdaptationErrorV3(
        "revision_conflict",
        "学习者成长记录已经存在",
      );
    }
    await this.#write(parsed);
  }

  async load(learnerTwinId: string): Promise<LearnerAdaptationRecordV3 | null> {
    let text: string;
    try {
      text = await readFile(this.#pathFor(learnerTwinId), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    const parsed = LearnerAdaptationRecordSchema.parse(JSON.parse(text));
    if (parsed.learnerTwinId !== learnerTwinId) {
      throw new LearnerAdaptationErrorV3(
        "source_drift",
        "学习者成长记录文件与主体不一致",
      );
    }
    return parsed;
  }

  async compareAndSet(
    learnerTwinId: string,
    expectedRevision: number,
    next: LearnerAdaptationRecordV3,
  ): Promise<void> {
    const current = await this.load(learnerTwinId);
    if (!current || current.recordRevision !== expectedRevision) {
      throw new LearnerAdaptationErrorV3(
        "revision_conflict",
        "学习者成长记录已被其他操作更新",
      );
    }
    const parsed = LearnerAdaptationRecordSchema.parse(next);
    if (parsed.learnerTwinId !== learnerTwinId
      || parsed.recordRevision !== expectedRevision + 1) {
      throw new LearnerAdaptationErrorV3(
        "revision_conflict",
        "学习者成长 CAS 后继修订非法",
      );
    }
    await this.#write(parsed);
  }

  #pathFor(learnerTwinId: string): string {
    return resolve(this.directory, recordFileName(learnerTwinId));
  }

  async #write(record: LearnerAdaptationRecordV3): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const target = this.#pathFor(record.learnerTwinId);
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

export interface LearnerProxySafeInputV3 {
  competencyMean: number;
  profileConfidence: number;
  currentChallengeLevel: ChallengeLevel;
  strategyTendencies: Array<{
    tendencyId: LearnerTwinProfile["strategyTendencies"][number]["tendencyId"];
    observedRate: number;
    confidence: number;
  }>;
  candidateWorlds: Array<{
    challengeLevel: ChallengeLevel;
    worldVariantRef: string;
  }>;
}

export interface LearnerProxyOutputV3 {
  candidates: LearnerSimulationForecast["candidates"];
  uncertainty: LearnerSimulationForecast["uncertainty"];
}

export interface LearnerProxyAgentPortV3 {
  forecast(input: LearnerProxySafeInputV3):
    | LearnerProxyOutputV3
    | Promise<LearnerProxyOutputV3>;
}

function preferredActions(
  tendencies: LearnerProxySafeInputV3["strategyTendencies"],
): LearnerSimulationForecast["candidates"][number]["predictedActions"] {
  const ranked = [...tendencies].sort(
    (left, right) => right.observedRate - left.observedRate,
  );
  const actionKinds: StudentWorkAction["action"]["verb"][] = [];
  for (const tendency of ranked) {
    const mapped = tendency.tendencyId === "evidence_first"
      ? "inspect"
      : tendency.tendencyId === "relationship_first"
        ? "ask"
        : tendency.tendencyId === "speed_first"
          ? "draft"
          : tendency.tendencyId === "risk_averse"
            ? "escalate"
            : tendency.tendencyId === "revision_responsive"
              ? "draft"
              : "probe";
    if (!actionKinds.includes(mapped)) actionKinds.push(mapped);
  }
  for (const fallback of ["observe", "inspect", "draft"] as const) {
    if (!actionKinds.includes(fallback)) actionKinds.push(fallback);
  }
  return actionKinds.slice(0, 3).map((actionKind, index) => ({
    actionKind,
    probability: [0.5, 0.27, 0.16][index]!,
  }));
}

/**
 * Offline competition fallback. It predicts only strategy distributions for
 * candidate worlds; it cannot call tools, submit work, create evidence or score.
 */
export class DeterministicLearnerProxyAgentV3
implements LearnerProxyAgentPortV3 {
  forecast(input: LearnerProxySafeInputV3): LearnerProxyOutputV3 {
    const capabilityChallenge = clamp(
      Math.round(input.competencyMean) + 2,
      3,
      7,
    );
    const actions = preferredActions(input.strategyTendencies);
    return {
      candidates: input.candidateWorlds.map((candidate) => {
        const distance = candidate.challengeLevel - capabilityChallenge;
        const overload = clamp(
          0.12 + Math.max(0, distance) * 0.2
            + (1 - input.profileConfidence) * 0.24,
          0.04,
          0.92,
        );
        const success = clamp(
          0.78 - Math.max(0, distance) * 0.17
            + Math.max(0, -distance) * 0.035
            - (1 - input.profileConfidence) * 0.1,
          0.12,
          0.94,
        );
        const growth = clamp(
          0.86 - Math.abs(distance) * 0.16 - overload * 0.16,
          0.18,
          0.9,
        );
        return {
          candidateId: stableId("forecast-candidate", {
            challengeLevel: candidate.challengeLevel,
            worldVariantRef: candidate.worldVariantRef,
            competencyMean: input.competencyMean,
          }),
          challengeLevel: candidate.challengeLevel,
          worldVariantRef: candidate.worldVariantRef,
          predictedActions: actions,
          predictedSuccessProbability: round(success),
          predictedOverloadProbability: round(overload),
          predictedGrowthValue: round(growth),
          rationale: `仅依据可变岗位能力与已观察策略，估计 ${candidate.challengeLevel} 级世界的成功、过载与成长区间；不替学生行动或评分。`,
        };
      }),
      uncertainty: {
        epistemic: round(1 - input.profileConfidence),
        behavioral: round(clamp(
          0.35 + (1 - input.profileConfidence) * 0.35,
          0.2,
          0.85,
        )),
        dataSufficiency: input.profileConfidence >= 0.78
          ? "high"
          : input.profileConfidence >= 0.58
            ? "medium"
            : "low",
      },
    };
  }
}

interface AdaptationWorldContextV3 {
  sessionId: string;
  release: Pick<SimulationSessionRecord["release"],
    "simulationReleaseRef" | "challengeVariants">;
  challengeAssignment: ChallengeAssignment;
  studentActions: StudentWorkAction[];
}

interface AdaptationCollaborationContextV3 {
  episodes: Array<Pick<
    SimulationCollaborationSessionRecordV3["episodes"][number],
    "studentDecision"
  >>;
}

export interface LearnerAdaptationServiceV3Options {
  assessment: {
    getAssessment(input: {
      sessionId: string;
      fallbackLearner?: { bindingId: string; actorId: string };
    }): Promise<FlagshipAssessmentRecordV3>;
  };
  engine: {
    getRecord(sessionId: string): Promise<AdaptationWorldContextV3>;
  };
  orchestrator: {
    loadRecord(sessionId: string): Promise<AdaptationCollaborationContextV3 | null>;
  };
  store: LearnerAdaptationStoreV3;
  proxy?: LearnerProxyAgentPortV3;
  now?: () => string;
}

export interface LearnerAdaptationSnapshotV3 {
  assessment: FlagshipAssessmentRecordV3;
  decision: AssessmentDecision;
  record: LearnerAdaptationRecordV3 | null;
  evidenceReady: boolean;
  updateBlockedByAppeal: boolean;
}

export interface ReviewLearnerAdaptationInputV3 {
  sessionId: string;
  requestId: string;
  teacherActorId: string;
  expectedProfileRevision: number;
  action:
    | "confirm_plan"
    | "override_challenge"
    | "begin_appeal_review"
    | "resolve_appeal";
  reason: string;
  challengeLevel?: ChallengeLevel;
}

function currentProfile(record: LearnerAdaptationRecordV3): LearnerTwinProfile {
  return record.profileHistory.at(-1)!;
}

function currentPlan(
  record: LearnerAdaptationRecordV3,
): PersonalizedLearningPlan | null {
  return record.learningPlans.at(-1) ?? null;
}

function currentAssignment(
  record: LearnerAdaptationRecordV3,
): ChallengeAssignment | null {
  return record.challengeAssignments.at(-1) ?? null;
}

function withProfileContentHash(
  profile: Omit<LearnerTwinProfile, "profileContentHash">,
): LearnerTwinProfile {
  return LearnerTwinProfileSchema.parse({
    ...profile,
    profileContentHash: hashValue(profile),
  });
}

const competencyTitles: Readonly<Record<string, string>> = {
  "criterion-fact-verification": "事实核验",
  "criterion-interview-consent": "采访同意与关系沟通",
  "criterion-editorial-judgment": "编辑判断",
  "criterion-rights-governance": "权利与内容治理",
  "criterion-multiplatform-production": "多平台生产",
  "criterion-recovery-transfer": "复盘恢复与迁移",
};

function observedStrategyTendencies(
  world: AdaptationWorldContextV3,
  collaboration: AdaptationCollaborationContextV3 | null,
): LearnerTwinProfile["strategyTendencies"] {
  const actions = world.studentActions;
  const decisions = collaboration?.episodes.flatMap((episode) => (
    episode.studentDecision ? [episode.studentDecision] : []
  )) ?? [];
  const actionRefs = (verbs: StudentWorkAction["action"]["verb"][]) => actions
    .filter((action) => verbs.includes(action.action.verb))
    .map((action) => action.workActionId);
  const groundingVerbs: StudentWorkAction["action"]["verb"][] = [
    "observe",
    "inspect",
    "compare",
    "ask",
    "probe",
    "negotiate",
  ];
  const firstGroundingIndex = actions.findIndex((action) => (
    groundingVerbs.includes(action.action.verb)
  ));
  const speedFirstRefs = actions.flatMap((action, index) => (
    ["draft", "submit"].includes(action.action.verb)
      && (firstGroundingIndex === -1 || index < firstGroundingIndex)
      ? [action.workActionId]
      : []
  ));
  const authoredByArtifact = new Map<string, StudentWorkAction[]>();
  for (const action of actions) {
    if (action.action.verb !== "draft" && action.action.verb !== "submit") continue;
    const prior = authoredByArtifact.get(action.action.artifactId) ?? [];
    prior.push(action);
    authoredByArtifact.set(action.action.artifactId, prior);
  }
  const revisionResponsiveRefs = [...authoredByArtifact.values()]
    .filter((artifactActions) => artifactActions.length >= 2)
    .flatMap((artifactActions) => artifactActions.map((action) => action.workActionId));
  const denominator = Math.max(actions.length + decisions.length, 1);
  const candidates: Array<{
    tendencyId: LearnerTwinProfile["strategyTendencies"][number]["tendencyId"];
    refs: string[];
    use: string;
  }> = [
    {
      tendencyId: "evidence_first",
      refs: actionRefs(["observe", "inspect", "compare"]),
      use: "在下一轮保留可主动核验的路径，并逐步减少直接提示。",
    },
    {
      tendencyId: "relationship_first",
      refs: actionRefs(["ask", "probe", "negotiate"]),
      use: "用信息差与关系冲突检验采访边界，而不是把偏好固化为人格。",
    },
    {
      tendencyId: "speed_first",
      refs: speedFirstRefs,
      use: "在时效压力下增加必要核验门，观察速度与准确性的真实取舍。",
    },
    {
      tendencyId: "risk_averse",
      refs: actionRefs(["wait", "escalate"]),
      use: "提供可控风险升级，让学生练习何时自行判断、何时请求教师门。",
    },
    {
      tendencyId: "revision_responsive",
      refs: revisionResponsiveRefs,
      use: "用新证据触发实质修订，并在稳定后逐步撤除修订提示。",
    },
    {
      tendencyId: "help_seeking",
      refs: decisions
        .filter((decision) => decision.decision === "request_evidence")
        .map((decision) => decision.decisionRef),
      use: "区分有效补证与依赖性求助，逐轮减少不必要支架。",
    },
  ];
  return candidates.flatMap((candidate) => candidate.refs.length === 0 ? [] : [{
    tendencyId: candidate.tendencyId,
    observedRate: round(candidate.refs.length / denominator),
    confidence: round(clamp(0.42 + candidate.refs.length * 0.09, 0, 0.88)),
    basisEvidenceRefs: unique(candidate.refs).slice(0, 32),
    pedagogicalUse: candidate.use,
  }]);
}

function mergeTendencies(
  previous: LearnerTwinProfile["strategyTendencies"],
  current: LearnerTwinProfile["strategyTendencies"],
): LearnerTwinProfile["strategyTendencies"] {
  const currentById = new Map(current.map((item) => [item.tendencyId, item]));
  const previousById = new Map(previous.map((item) => [item.tendencyId, item]));
  return unique([...previousById.keys(), ...currentById.keys()]).map((id) => {
    const before = previousById.get(id);
    const after = currentById.get(id);
    if (!before) return after!;
    if (!after) return before;
    return {
      ...after,
      observedRate: round(before.observedRate * 0.45 + after.observedRate * 0.55),
      confidence: round(clamp(before.confidence * 0.45 + after.confidence * 0.55 + 0.04, 0, 0.96)),
      basisEvidenceRefs: unique([
        ...before.basisEvidenceRefs,
        ...after.basisEvidenceRefs,
      ]).slice(-32),
    };
  });
}

function scaffoldingResponse(
  decision: AssessmentDecision,
  collaboration: AdaptationCollaborationContextV3 | null,
  world: AdaptationWorldContextV3,
): LearnerTwinProfile["scaffoldingResponse"] {
  const decisions = collaboration?.episodes.flatMap((episode) => (
    episode.studentDecision ? [episode.studentDecision] : []
  )) ?? [];
  const total = Math.max(decisions.length, 1);
  const count = (kind: "accept" | "request_evidence" | "reject") => (
    decisions.filter((item) => item.decision === kind).length / total
  );
  const authoredByArtifact = new Map<string, StudentWorkAction[]>();
  for (const action of world.studentActions) {
    if (action.action.verb !== "draft" && action.action.verb !== "submit") continue;
    const prior = authoredByArtifact.get(action.action.artifactId) ?? [];
    prior.push(action);
    authoredByArtifact.set(action.action.artifactId, prior);
  }
  const authoredActions = [...authoredByArtifact.values()].flat();
  const revisionActions = [...authoredByArtifact.values()]
    .filter((artifactActions) => artifactActions.length >= 2)
    .flatMap((artifactActions) => artifactActions.slice(1));
  return {
    acceptedSuggestionRate: round(count("accept")),
    requestedEvidenceRate: round(count("request_evidence")),
    rejectedSuggestionRate: round(count("reject")),
    productiveRevisionRate: round(
      authoredActions.length === 0 ? 0 : revisionActions.length / authoredActions.length,
    ),
    basisEvidenceRefs: unique([
      ...decisions.map((item) => item.decisionRef),
      ...revisionActions.map((item) => item.workActionId),
      ...decision.evidenceEpisodeRefs,
    ]).slice(-64),
  };
}

function mergeScaffoldingResponse(
  previous: LearnerTwinProfile["scaffoldingResponse"] | null,
  current: LearnerTwinProfile["scaffoldingResponse"],
): LearnerTwinProfile["scaffoldingResponse"] {
  if (!previous) return current;
  return {
    acceptedSuggestionRate: round(
      previous.acceptedSuggestionRate * 0.45 + current.acceptedSuggestionRate * 0.55,
    ),
    requestedEvidenceRate: round(
      previous.requestedEvidenceRate * 0.45 + current.requestedEvidenceRate * 0.55,
    ),
    rejectedSuggestionRate: round(
      previous.rejectedSuggestionRate * 0.45 + current.rejectedSuggestionRate * 0.55,
    ),
    productiveRevisionRate: round(
      previous.productiveRevisionRate * 0.45 + current.productiveRevisionRate * 0.55,
    ),
    basisEvidenceRefs: unique([
      ...previous.basisEvidenceRefs,
      ...current.basisEvidenceRefs,
    ]).slice(-64),
  };
}

function pressureDimensions(level: ChallengeLevel): ChallengeAssignment["pressureDimensions"] {
  const bounded = (value: number) => ChallengeLevelSchema.parse(
    clamp(value, 3, 7),
  );
  return [
    { dimensionId: "time", intensity: level },
    { dimensionId: "source_access", intensity: bounded(level) },
    { dimensionId: "relationship_conflict", intensity: bounded(level - 1) },
    { dimensionId: "platform_risk", intensity: bounded(level) },
    { dimensionId: "copyright_risk", intensity: bounded(level - 1) },
    { dimensionId: "editorial_pressure", intensity: bounded(level + 1) },
  ];
}

function profileEvidenceReady(decision: AssessmentDecision): boolean {
  return decision.scoreStatus === "final"
    && decision.teacherReview.status !== "pending"
    && decision.sessionScore !== null
    && decision.evidenceEpisodeRefs.length > 0
    && decision.competencyEstimates.every((estimate) => (
      estimate.evidenceStatus !== "insufficient"
        && estimate.competencyLevel !== null
        && estimate.score !== null
        && estimate.evidenceEpisodeRefs.length > 0
    ));
}

function calibrationError(
  forecast: LearnerSimulationForecast,
  assignment: ChallengeAssignment,
  actions: StudentWorkAction[],
): number {
  const candidate = forecast.candidates.find((item) => (
    item.worldVariantRef === assignment.worldVariantRef
  ));
  if (!candidate) return 1;
  const probabilityByAction = new Map(candidate.predictedActions.map(
    (item) => [item.actionKind, item.probability],
  ));
  const observed = actions.slice(0, 32).map((action) => action.action.verb);
  if (observed.length === 0) return 1;
  const meanObservedProbability = observed.reduce(
    (sum, action) => sum + (probabilityByAction.get(action) ?? 0),
    0,
  ) / observed.length;
  return round(clamp(1 - meanObservedProbability, 0, 1));
}

export class LearnerAdaptationServiceV3 {
  readonly #proxy: LearnerProxyAgentPortV3;
  readonly #locks = new Map<string, Promise<void>>();

  constructor(private readonly options: LearnerAdaptationServiceV3Options) {
    this.#proxy = options.proxy ?? new DeterministicLearnerProxyAgentV3();
  }

  async getOrRefresh(input: {
    sessionId: string;
    fallbackLearner?: { bindingId: string; actorId: string };
  }): Promise<LearnerAdaptationSnapshotV3> {
    const assessment = await this.options.assessment.getAssessment(input);
    const decision = currentFlagshipAssessmentDecisionV3(assessment);
    const learnerTwinId = stableId("learner-twin", {
      learnerActorId: assessment.learnerActorId,
    });
    return this.#serialized(learnerTwinId, async () => {
      const world = await this.options.engine.getRecord(input.sessionId);
      this.#assertSources(decision, world);
      const collaboration = await this.options.orchestrator.loadRecord(input.sessionId);
      let current = await this.options.store.load(learnerTwinId);
      if (current && current.principalBindingHash !== hashValue({
        learnerActorId: assessment.learnerActorId,
      })) {
        throw new LearnerAdaptationErrorV3(
          "source_drift",
          "学习者成长记录主体哈希发生漂移",
        );
      }
      let changed = false;
      if (current) {
        const calibrated = this.#calibratePendingForecasts(
          current,
          world,
          this.#now(),
        );
        current = calibrated.record;
        changed = calibrated.changed;
      }
      const evidenceReady = profileEvidenceReady(decision);
      const appealOpen = current
        ? ["requested", "under_review"].includes(currentProfile(current).appeal.status)
        : false;
      const alreadyUpdated = current?.updateReceipts.some((receipt) => (
        receipt.sourceAssessmentDecisionId === decision.assessmentDecisionId
      )) ?? false;

      if (evidenceReady && !appealOpen && !alreadyUpdated) {
        const timestamp = this.#now();
        const previous = current ? currentProfile(current) : null;
        const profile = this.#buildProfile({
          assessment,
          decision,
          world,
          collaboration,
          previous,
          timestamp,
        });
        const forecast = await this.#buildForecast(profile, world, timestamp);
        const selection = this.#selectChallenge(
          profile,
          forecast,
          world,
          current,
          timestamp,
        );
        const plan = this.#buildPlan(
          profile,
          decision,
          world,
          selection.assignment,
          timestamp,
        );
        const receipt = {
          sourceSessionId: input.sessionId,
          sourceAssessmentDecisionId: decision.assessmentDecisionId,
          sourceAssessmentHash: hashValue(decision),
          learnerTwinRevision: profile.revision,
          forecastId: forecast.forecastId,
          challengeAssignmentId: selection.assignment.challengeAssignmentId,
          learningPlanId: plan.learningPlanId,
          createdAt: timestamp,
        };
        if (!current) {
          const created = LearnerAdaptationRecordSchema.parse({
            recordVersion: LearnerAdaptationRecordV3Version,
            recordRevision: 0,
            learnerTwinId,
            principalBindingHash: profile.principalBindingHash,
            profileHistory: [profile],
            forecasts: [forecast],
            challengeAssignments: [selection.assignment],
            learningPlans: [plan],
            updateReceipts: [receipt],
            policyReceipts: [selection.receipt],
            appeals: [],
            commandReceipts: [],
            createdAt: timestamp,
            updatedAt: timestamp,
          });
          try {
            await this.options.store.create(created);
            current = created;
          } catch (error) {
            if (!(error instanceof LearnerAdaptationErrorV3)
              || error.code !== "revision_conflict") throw error;
            current = await this.options.store.load(learnerTwinId);
            if (!current) throw error;
          }
        } else {
          current = LearnerAdaptationRecordSchema.parse({
            ...current,
            recordRevision: current.recordRevision + 1,
            profileHistory: [...current.profileHistory, profile],
            forecasts: [...current.forecasts, forecast],
            challengeAssignments: [
              ...current.challengeAssignments,
              selection.assignment,
            ],
            learningPlans: [...current.learningPlans, plan],
            updateReceipts: [...current.updateReceipts, receipt],
            policyReceipts: [...current.policyReceipts, selection.receipt],
            updatedAt: timestamp,
          });
          await this.options.store.compareAndSet(
            learnerTwinId,
            current.recordRevision - 1,
            current,
          );
        }
      } else if (current && changed) {
        const next = LearnerAdaptationRecordSchema.parse({
          ...current,
          recordRevision: current.recordRevision + 1,
          updatedAt: this.#now(),
        });
        await this.options.store.compareAndSet(
          learnerTwinId,
          current.recordRevision,
          next,
        );
        current = next;
      }

      return {
        assessment,
        decision,
        record: current,
        evidenceReady,
        updateBlockedByAppeal: appealOpen,
      };
    });
  }

  async requestAppeal(input: {
    sessionId: string;
    learnerBindingId: string;
    learnerActorId: string;
    requestId: string;
    reason: string;
  }): Promise<LearnerAdaptationSnapshotV3> {
    const snapshot = await this.getOrRefresh({
      sessionId: input.sessionId,
      fallbackLearner: {
        bindingId: input.learnerBindingId,
        actorId: input.learnerActorId,
      },
    });
    if (snapshot.assessment.learnerActorId !== input.learnerActorId) {
      throw new LearnerAdaptationErrorV3(
        "access_denied",
        "学生只能申诉自己的学习者画像",
      );
    }
    if (!snapshot.record) {
      throw new LearnerAdaptationErrorV3(
        "insufficient_evidence",
        "尚未形成学习者画像，当前没有可申诉结论",
      );
    }
    const learnerTwinId = snapshot.record.learnerTwinId;
    return this.#serialized(learnerTwinId, async () => {
      const record = await this.#requiredRecord(learnerTwinId);
      const requestHash = hashValue({ reason: input.reason.trim() });
      const replay = record.commandReceipts.find(
        (receipt) => receipt.requestId === input.requestId,
      );
      if (replay) {
        if (replay.requestHash !== requestHash
          || replay.action !== "request_appeal") {
          throw new LearnerAdaptationErrorV3(
            "request_replay_conflict",
            "同一申诉请求不得承载不同内容",
          );
        }
        return { ...snapshot, record };
      }
      const profile = currentProfile(record);
      if (["requested", "under_review"].includes(profile.appeal.status)) {
        throw new LearnerAdaptationErrorV3(
          "appeal_pending",
          "已有画像申诉正在处理",
        );
      }
      if (input.reason.trim().length < 8 || input.reason.trim().length > 1_000) {
        throw new LearnerAdaptationErrorV3(
          "invalid_decision",
          "申诉理由必须为 8—1000 字",
        );
      }
      const timestamp = this.#now();
      const appealId = stableId("learner-appeal", {
        learnerTwinId,
        requestId: input.requestId,
        requestHash,
      });
      const appealedProfile = this.#profileWithAppeal(profile, {
        status: "requested",
        appealRef: appealId,
        requestedAt: timestamp,
        resolvedAt: null,
      }, timestamp);
      const next = LearnerAdaptationRecordSchema.parse({
        ...record,
        recordRevision: record.recordRevision + 1,
        profileHistory: [...record.profileHistory, appealedProfile],
        appeals: [...record.appeals, {
          appealId,
          requestId: input.requestId,
          requestHash,
          reason: input.reason.trim(),
          status: "requested",
          requestedAt: timestamp,
          reviewerHash: null,
          resolutionReason: null,
          resolvedAt: null,
        }],
        commandReceipts: [...record.commandReceipts, {
          requestId: input.requestId,
          requestHash,
          action: "request_appeal",
          resultRef: appealId,
          actorHash: hashValue({ actorId: input.learnerActorId }),
          createdAt: timestamp,
        }],
        updatedAt: timestamp,
      });
      await this.options.store.compareAndSet(
        learnerTwinId,
        record.recordRevision,
        next,
      );
      return {
        ...snapshot,
        record: next,
        updateBlockedByAppeal: true,
      };
    });
  }

  async reviewAdaptation(
    input: ReviewLearnerAdaptationInputV3,
  ): Promise<LearnerAdaptationSnapshotV3> {
    const snapshot = await this.getOrRefresh({ sessionId: input.sessionId });
    if (!snapshot.record) {
      throw new LearnerAdaptationErrorV3(
        "insufficient_evidence",
        "尚未形成可复核的学习者画像",
      );
    }
    const learnerTwinId = snapshot.record.learnerTwinId;
    return this.#serialized(learnerTwinId, async () => {
      const record = await this.#requiredRecord(learnerTwinId);
      const requestHash = hashValue({
        action: input.action,
        expectedProfileRevision: input.expectedProfileRevision,
        reason: input.reason.trim(),
        challengeLevel: input.challengeLevel ?? null,
      });
      const replay = record.commandReceipts.find(
        (receipt) => receipt.requestId === input.requestId,
      );
      if (replay) {
        if (replay.requestHash !== requestHash || replay.action !== input.action) {
          throw new LearnerAdaptationErrorV3(
            "request_replay_conflict",
            "同一教师成长决策请求不得承载不同内容",
          );
        }
        return { ...snapshot, record };
      }
      const profile = currentProfile(record);
      if (profile.revision !== input.expectedProfileRevision) {
        throw new LearnerAdaptationErrorV3(
          "revision_conflict",
          "学习者画像已经更新，请按最新修订重新决策",
        );
      }
      if (input.reason.trim().length < 8 || input.reason.trim().length > 1_000) {
        throw new LearnerAdaptationErrorV3(
          "invalid_decision",
          "教师成长决策理由必须为 8—1000 字",
        );
      }
      const appealIsOpen = ["requested", "under_review"].includes(
        profile.appeal.status,
      );
      if (appealIsOpen
        && input.action !== "begin_appeal_review"
        && input.action !== "resolve_appeal") {
        throw new LearnerAdaptationErrorV3(
          "appeal_pending",
          "申诉处理完成前不得确认成长方案或覆写挑战等级",
        );
      }
      const world = await this.options.engine.getRecord(input.sessionId);
      const timestamp = this.#now();
      let profiles = record.profileHistory;
      let plans = record.learningPlans;
      let assignments = record.challengeAssignments;
      let appeals = record.appeals;
      let resultRef: string;

      if (input.action === "confirm_plan") {
        const plan = currentPlan(record);
        if (!plan || plan.status !== "proposed") {
          throw new LearnerAdaptationErrorV3(
            "invalid_decision",
            "当前没有等待教师确认的成长方案",
          );
        }
        const confirmed = PersonalizedLearningPlanSchema.parse({
          ...plan,
          learningPlanId: stableId("learning-plan-confirmed", {
            source: plan.learningPlanId,
            requestId: input.requestId,
          }),
          status: "teacher_confirmed",
          teacherConfirmation: {
            teacherId: input.teacherActorId,
            confirmedAt: timestamp,
            note: input.reason.trim(),
          },
          updatedAt: timestamp,
        });
        plans = [...plans, confirmed];
        resultRef = confirmed.learningPlanId;
      } else if (input.action === "override_challenge") {
        if (input.challengeLevel === undefined) {
          throw new LearnerAdaptationErrorV3(
            "invalid_decision",
            "教师覆写必须明确 3—7 级挑战",
          );
        }
        const level = ChallengeLevelSchema.parse(input.challengeLevel);
        const variant = world.release.challengeVariants.find(
          (item) => item.challengeLevel === level,
        );
        if (!variant) {
          throw new LearnerAdaptationErrorV3(
            "source_drift",
            "当前不可变世界发布版缺少教师选择的挑战变体",
          );
        }
        const previous = world.challengeAssignment.challengeLevel;
        const latestAssignment = currentAssignment(record);
        const override = ChallengeAssignmentSchema.parse({
          schemaVersion: ChallengeAssignmentSchemaVersion,
          challengeAssignmentId: stableId("challenge-override", {
            learnerTwinId,
            requestId: input.requestId,
            level,
          }),
          learnerTwinRef: learnerTwinId,
          sessionId: latestAssignment?.sessionId
            ?? `${input.sessionId}-next-r${profile.revision}`,
          simulationReleaseRef: world.release.simulationReleaseRef,
          worldVariantRef: variant.worldVariantId,
          previousChallengeLevel: previous,
          challengeLevel: level,
          scoreCeiling: challengeScoreCeiling(level),
          pressureDimensions: pressureDimensions(level),
          assignmentReason: "teacher_override",
          basisEvidenceRefs: profile.evidenceRefs,
          forecastRef: record.forecasts.at(-1)?.forecastId ?? null,
          teacherOverride: {
            teacherId: input.teacherActorId,
            reason: input.reason.trim(),
            decidedAt: timestamp,
          },
          policyVersion: challengePolicyVersion,
          policyContentHash: hashValue(challengePolicyVersion),
          assignedAt: timestamp,
        });
        assignments = [...assignments, override];
        const plan = currentPlan(record);
        if (plan) {
          const revisedPlan = PersonalizedLearningPlanSchema.parse({
            ...plan,
            learningPlanId: stableId("learning-plan-override", {
              source: plan.learningPlanId,
              assignment: override.challengeAssignmentId,
              requestId: input.requestId,
            }),
            sourceChallengeAssignmentRef: override.challengeAssignmentId,
            recommendedChallengeLevel: level,
            recommendedWorldVariantRefs: unique([
              variant.worldVariantId,
              ...world.release.challengeVariants
                .filter((candidate) => Math.abs(candidate.challengeLevel - level) <= 1)
                .map((candidate) => candidate.worldVariantId),
            ]).slice(0, 8),
            updatedAt: timestamp,
          });
          plans = [...plans, revisedPlan];
        }
        resultRef = override.challengeAssignmentId;
      } else {
        const appeal = record.appeals.at(-1);
        if (!appeal || appeal.appealId !== profile.appeal.appealRef) {
          throw new LearnerAdaptationErrorV3(
            "invalid_decision",
            "当前画像没有对应的待处理申诉",
          );
        }
        if (input.action === "begin_appeal_review") {
          if (appeal.status !== "requested") {
            throw new LearnerAdaptationErrorV3(
              "invalid_decision",
              "只有已申请申诉可以进入复核",
            );
          }
          const reviewing = this.#profileWithAppeal(profile, {
            ...profile.appeal,
            status: "under_review",
          }, timestamp);
          profiles = [...profiles, reviewing];
          appeals = [
            ...appeals.slice(0, -1),
            {
              ...appeal,
              status: "under_review",
              reviewerHash: hashValue({ actorId: input.teacherActorId }),
            },
          ];
          resultRef = appeal.appealId;
        } else {
          if (appeal.status !== "requested" && appeal.status !== "under_review") {
            throw new LearnerAdaptationErrorV3(
              "invalid_decision",
              "当前申诉已经结束",
            );
          }
          const resolvedProfile = this.#profileWithAppeal(profile, {
            ...profile.appeal,
            status: "resolved",
            resolvedAt: timestamp,
          }, timestamp);
          profiles = [...profiles, resolvedProfile];
          appeals = [
            ...appeals.slice(0, -1),
            {
              ...appeal,
              status: "resolved",
              reviewerHash: hashValue({ actorId: input.teacherActorId }),
              resolutionReason: input.reason.trim(),
              resolvedAt: timestamp,
            },
          ];
          resultRef = appeal.appealId;
        }
      }

      const next = LearnerAdaptationRecordSchema.parse({
        ...record,
        recordRevision: record.recordRevision + 1,
        profileHistory: profiles,
        challengeAssignments: assignments,
        learningPlans: plans,
        appeals,
        commandReceipts: [...record.commandReceipts, {
          requestId: input.requestId,
          requestHash,
          action: input.action,
          resultRef,
          actorHash: hashValue({ actorId: input.teacherActorId }),
          createdAt: timestamp,
        }],
        updatedAt: timestamp,
      });
      await this.options.store.compareAndSet(
        learnerTwinId,
        record.recordRevision,
        next,
      );
      return {
        ...snapshot,
        record: next,
        updateBlockedByAppeal: ["requested", "under_review"].includes(
          currentProfile(next).appeal.status,
        ),
      };
    });
  }

  projectGrowth(
    snapshot: LearnerAdaptationSnapshotV3,
    audience: "student" | "teacher",
  ) {
    const record = snapshot.record;
    const profile = record ? currentProfile(record) : null;
    const forecast = record?.forecasts.at(-1) ?? null;
    const assignment = record ? currentAssignment(record) : null;
    const plan = record ? currentPlan(record) : null;
    const criteriaById = new Map(snapshot.decision.competencyEstimates.map(
      (estimate) => [estimate.competencyClaimId, estimate],
    ));
    return {
      schemaVersion: LearnerGrowthViewV3Version,
      audience,
      state: !snapshot.evidenceReady
        ? "evidence_required" as const
        : snapshot.updateBlockedByAppeal
          ? "appeal_pending" as const
          : "ready" as const,
      boundaries: {
        evidenceOnly: true as const,
        immutablePersonalityLabelsForbidden: true as const,
        sensitiveAttributesExcluded: true as const,
        proxyCanActForStudent: false as const,
        proxyCanCreateEvidence: false as const,
        proxyCanScoreStudent: false as const,
        teacherControlsActivation: true as const,
      },
      evidenceReadiness: {
        assessmentDecisionId: snapshot.decision.assessmentDecisionId,
        scoreStatus: snapshot.decision.scoreStatus,
        teacherReviewStatus: snapshot.decision.teacherReview.status,
        message: !snapshot.evidenceReady
          ? "需要六个岗位能力维度均有真实证据并完成教师复核后，才会建立或更新成长模型。"
          : snapshot.updateBlockedByAppeal
            ? "画像申诉处理中，系统已暂停静默更新和自动调压。"
            : "本轮成长建议来自已完成教师复核的真实作品、行动与世界后果。",
      },
      profile: profile ? {
        revision: profile.revision,
        confidence: profile.confidence,
        competencies: profile.competencyStates.map((state) => ({
          competencyClaimId: state.competencyClaimId,
          title: competencyTitles[state.competencyClaimId]
            ?? state.competencyClaimId,
          level: state.competencyLevel,
          confidence: state.confidence,
          strengths: state.observedStrengths,
          growthNeeds: state.growthNeeds,
          evidenceCount: criteriaById.get(state.competencyClaimId)
            ?.evidenceEpisodeRefs.length ?? state.supportingAssessmentRefs.length,
        })),
        strategySignals: profile.strategyTendencies.map((tendency) => ({
          tendencyId: tendency.tendencyId,
          observedRate: tendency.observedRate,
          confidence: tendency.confidence,
          pedagogicalUse: tendency.pedagogicalUse,
        })),
        appeal: profile.appeal,
        updatedAt: profile.updatedAt,
      } : null,
      forecast: forecast ? {
        dataSufficiency: forecast.uncertainty.dataSufficiency,
        behavioralUncertainty: forecast.uncertainty.behavioral,
        calibrationStatus: forecast.calibration.status,
        predictionError: audience === "teacher"
          ? forecast.calibration.predictionError
          : null,
        candidateCount: forecast.candidates.length,
        explanation: "代理只在沙箱比较候选冲突与过载风险；不会替你作答，也不会把预测当作能力证据。",
      } : null,
      nextChallenge: assignment ? {
        challengeLevel: assignment.challengeLevel,
        previousChallengeLevel: assignment.previousChallengeLevel,
        scoreCeiling: assignment.scoreCeiling,
        assignmentReason: assignment.assignmentReason,
        pressureDimensions: assignment.pressureDimensions,
        teacherOverride: assignment.teacherOverride === null ? null : {
          reason: assignment.teacherOverride.reason,
          decidedAt: assignment.teacherOverride.decidedAt,
        },
      } : null,
      learningPlan: plan ? {
        learningPlanId: plan.learningPlanId,
        status: plan.status,
        targets: plan.targetCompetencies.map((target) => ({
          competencyClaimId: target.competencyClaimId,
          title: competencyTitles[target.competencyClaimId]
            ?? target.competencyClaimId,
          currentLevel: target.currentLevel,
          targetLevel: target.targetLevel,
          practiceIntent: target.practiceIntent,
          successEvidence: target.successEvidence,
        })),
        scaffoldingActions: plan.scaffoldingActions,
        recommendedChallengeLevel: plan.recommendedChallengeLevel,
        teacherConfirmed: plan.teacherConfirmation !== null,
        reviewDueAt: plan.reviewDueAt,
      } : null,
      updatedAt: record?.updatedAt ?? snapshot.decision.generatedAt,
    };
  }

  projectAdminCase(snapshot: LearnerAdaptationSnapshotV3) {
    const record = snapshot.record;
    return {
      schemaVersion: LearnerAdaptationCaseViewV3Version,
      state: record === null ? "evidence_required" as const : "available" as const,
      boundaries: {
        rawLearnerIdentityStored: false as const,
        sensitiveAttributesExcluded: true as const,
        immutablePersonalityLabel: null,
        proxyCanActForStudent: false as const,
        proxyCanCreateEvidence: false as const,
        proxyCanScoreStudent: false as const,
        automaticStepLimit: 1 as const,
        initialChallengeRange: [3, 5] as const,
      },
      evidenceReadiness: {
        scoreStatus: snapshot.decision.scoreStatus,
        teacherReviewStatus: snapshot.decision.teacherReview.status,
        updateBlockedByAppeal: snapshot.updateBlockedByAppeal,
      },
      ...(record ? {
        learnerTwinId: record.learnerTwinId,
        principalBindingHash: record.principalBindingHash,
        recordRevision: record.recordRevision,
        profileHistory: record.profileHistory,
        forecasts: record.forecasts,
        challengeAssignments: record.challengeAssignments,
        learningPlans: record.learningPlans,
        updateReceipts: record.updateReceipts,
        policyReceipts: record.policyReceipts,
        appeals: record.appeals,
        commandReceipts: record.commandReceipts,
      } : {
        learnerTwinId: null,
        principalBindingHash: null,
        recordRevision: null,
        profileHistory: [],
        forecasts: [],
        challengeAssignments: [],
        learningPlans: [],
        updateReceipts: [],
        policyReceipts: [],
        appeals: [],
        commandReceipts: [],
      }),
      updatedAt: record?.updatedAt ?? snapshot.decision.generatedAt,
    };
  }

  #buildProfile(input: {
    assessment: FlagshipAssessmentRecordV3;
    decision: AssessmentDecision;
    world: AdaptationWorldContextV3;
    collaboration: AdaptationCollaborationContextV3 | null;
    previous: LearnerTwinProfile | null;
    timestamp: string;
  }): LearnerTwinProfile {
    const previousByClaim = new Map(input.previous?.competencyStates.map(
      (state) => [state.competencyClaimId, state],
    ) ?? []);
    const competencyStates = input.decision.competencyEstimates.map((estimate) => {
      if (estimate.competencyLevel === null) {
        throw new LearnerAdaptationErrorV3(
          "insufficient_evidence",
          "证据不足维度不得进入学习者画像",
        );
      }
      const before = previousByClaim.get(estimate.competencyClaimId);
      const combinedLevel = before
        ? Math.round((
          before.competencyLevel * before.confidence
            + estimate.competencyLevel * estimate.confidence
        ) / Math.max(before.confidence + estimate.confidence, 0.01))
        : estimate.competencyLevel;
      const confidence = before
        ? clamp(
          1 - (1 - before.confidence) * (1 - estimate.confidence * 0.8),
          0,
          0.98,
        )
        : estimate.confidence;
      const title = competencyTitles[estimate.competencyClaimId]
        ?? estimate.competencyClaimId;
      return {
        competencyClaimId: estimate.competencyClaimId,
        competencyLevel: clamp(combinedLevel, 1, 5),
        confidence: round(confidence),
        supportingAssessmentRefs: unique([
          ...(before?.supportingAssessmentRefs ?? []),
          input.decision.assessmentDecisionId,
        ]).slice(-32),
        observedStrengths: combinedLevel >= 3
          ? [`${title}已在真实作品或岗位行动中形成可追溯证据。`]
          : [],
        growthNeeds: combinedLevel < 5
          ? [`下一轮继续在${title}中形成独立证据，并说明判断与后果。`]
          : [],
        updatedAt: input.timestamp,
      };
    });
    const currentTendencies = observedStrategyTendencies(
      input.world,
      input.collaboration,
    );
    const currentScaffolding = scaffoldingResponse(
      input.decision,
      input.collaboration,
      input.world,
    );
    const nextTargets = [...competencyStates]
      .sort((left, right) => (
        left.competencyLevel - right.competencyLevel
          || left.confidence - right.confidence
      ))
      .slice(0, 3)
      .map((state) => state.competencyClaimId);
    const profileBase: Omit<LearnerTwinProfile, "profileContentHash"> = {
      schemaVersion: LearnerTwinProfileSchemaVersion,
      learnerTwinId: stableId("learner-twin", {
        learnerActorId: input.assessment.learnerActorId,
      }),
      principalBindingHash: hashValue({
        learnerActorId: input.assessment.learnerActorId,
      }),
      modelVersion: learnerTwinModelVersion,
      modelContentHash: hashValue(learnerTwinModelVersion),
      revision: (input.previous?.revision ?? 0) + 1,
      competencyStates,
      strategyTendencies: mergeTendencies(
        input.previous?.strategyTendencies ?? [],
        currentTendencies,
      ),
      scaffoldingResponse: mergeScaffoldingResponse(
        input.previous?.scaffoldingResponse ?? null,
        currentScaffolding,
      ),
      recentChallengeHistory: [
        ...(input.previous?.recentChallengeHistory ?? []),
        {
          challengeAssignmentRef:
            input.world.challengeAssignment.challengeAssignmentId,
          challengeLevel: input.world.challengeAssignment.challengeLevel,
          assessmentDecisionRef: input.decision.assessmentDecisionId,
          completedAt: input.decision.generatedAt,
        },
      ].filter((history, index, all) => (
        all.findIndex((item) => item.assessmentDecisionRef
          === history.assessmentDecisionRef) === index
      )).slice(-12),
      nextCompetencyTargetRefs: nextTargets,
      evidenceRefs: unique([
        ...(input.previous?.evidenceRefs ?? []),
        ...input.decision.evidenceEpisodeRefs,
      ]).slice(-120),
      confidence: round(
        competencyStates.reduce((sum, state) => sum + state.confidence, 0)
          / Math.max(competencyStates.length, 1),
      ),
      immutablePersonalityLabel: null,
      sensitiveAttributesExcluded: true,
      appeal: input.previous?.appeal ?? {
        status: "none",
        appealRef: null,
        requestedAt: null,
        resolvedAt: null,
      },
      updatedAt: input.timestamp,
    };
    return withProfileContentHash(profileBase);
  }

  async #buildForecast(
    profile: LearnerTwinProfile,
    world: AdaptationWorldContextV3,
    timestamp: string,
  ): Promise<LearnerSimulationForecast> {
    const currentLevel = ChallengeLevelSchema.parse(
      world.challengeAssignment.challengeLevel,
    );
    const levels = unique([
      clamp(currentLevel - 1, 3, 7),
      currentLevel,
      clamp(currentLevel + 1, 3, 7),
    ]).map((level) => ChallengeLevelSchema.parse(level));
    const candidateWorlds = levels.map((challengeLevel) => {
      const variant = world.release.challengeVariants.find(
        (item) => item.challengeLevel === challengeLevel,
      );
      if (!variant) {
        throw new LearnerAdaptationErrorV3(
          "source_drift",
          `不可变世界发布版缺少 ${challengeLevel} 级候选变体`,
        );
      }
      return { challengeLevel, worldVariantRef: variant.worldVariantId };
    });
    const safeInput: LearnerProxySafeInputV3 = {
      competencyMean: round(profile.competencyStates.reduce(
        (sum, state) => sum + state.competencyLevel,
        0,
      ) / profile.competencyStates.length),
      profileConfidence: profile.confidence,
      currentChallengeLevel: currentLevel,
      strategyTendencies: profile.strategyTendencies.map((tendency) => ({
        tendencyId: tendency.tendencyId,
        observedRate: tendency.observedRate,
        confidence: tendency.confidence,
      })),
      candidateWorlds,
    };
    const output = await this.#proxy.forecast(structuredClone(safeInput));
    return LearnerSimulationForecastSchema.parse({
      schemaVersion: LearnerSimulationForecastSchemaVersion,
      forecastId: stableId("learner-forecast", {
        learnerTwinId: profile.learnerTwinId,
        revision: profile.revision,
        safeInput,
        output,
      }),
      learnerTwinRef: profile.learnerTwinId,
      learnerTwinRevision: profile.revision,
      learnerTwinContentHash: profile.profileContentHash,
      simulationReleaseRef: world.release.simulationReleaseRef,
      forecastModelVersion: learnerProxyModelVersion,
      forecastModelContentHash: hashValue(learnerProxyModelVersion),
      candidates: output.candidates,
      uncertainty: output.uncertainty,
      evidenceEligible: false,
      canActForStudent: false,
      canScoreStudent: false,
      calibration: {
        status: "pending",
        actualStudentActionRefs: [],
        predictionError: null,
        evaluatedAt: null,
      },
      generatedAt: timestamp,
    });
  }

  #selectChallenge(
    profile: LearnerTwinProfile,
    forecast: LearnerSimulationForecast,
    world: AdaptationWorldContextV3,
    record: LearnerAdaptationRecordV3 | null,
    timestamp: string,
  ): { assignment: ChallengeAssignment; receipt: z.infer<typeof ChallengePolicyReceiptSchema> } {
    const previousLevel = ChallengeLevelSchema.parse(
      world.challengeAssignment.challengeLevel,
    );
    const latestEvaluated = [...(record?.forecasts ?? [])].reverse().find(
      (item) => item.calibration.status === "evaluated",
    );
    const fallbackReason = profile.confidence < 0.55
      ? "low_profile_confidence" as const
      : (latestEvaluated?.calibration.predictionError ?? 0) > 0.6
        ? "high_prediction_error" as const
        : "none" as const;
    const ranked = [...forecast.candidates].sort((left, right) => (
      (right.predictedGrowthValue
        - Math.max(0, right.predictedOverloadProbability - 0.35) * 1.4)
      - (left.predictedGrowthValue
        - Math.max(0, left.predictedOverloadProbability - 0.35) * 1.4)
      || left.challengeLevel - right.challengeLevel
    ));
    const selected = fallbackReason === "none"
      ? ranked[0]!
      : forecast.candidates.find(
        (candidate) => candidate.challengeLevel === previousLevel,
      )!;
    const level = ChallengeLevelSchema.parse(selected.challengeLevel);
    const assignmentReason = level < previousLevel || fallbackReason !== "none"
      ? "evidence_recovery" as const
      : "evidence_progression" as const;
    const assignment = ChallengeAssignmentSchema.parse({
      schemaVersion: ChallengeAssignmentSchemaVersion,
      challengeAssignmentId: stableId("challenge-adaptive", {
        learnerTwinId: profile.learnerTwinId,
        profileRevision: profile.revision,
        forecastId: forecast.forecastId,
        level,
      }),
      learnerTwinRef: profile.learnerTwinId,
      sessionId: `${world.sessionId}-next-r${profile.revision}`,
      simulationReleaseRef: world.release.simulationReleaseRef,
      worldVariantRef: selected.worldVariantRef,
      previousChallengeLevel: previousLevel,
      challengeLevel: level,
      scoreCeiling: challengeScoreCeiling(level),
      pressureDimensions: pressureDimensions(level),
      assignmentReason,
      basisEvidenceRefs: profile.evidenceRefs,
      forecastRef: forecast.forecastId,
      teacherOverride: null,
      policyVersion: challengePolicyVersion,
      policyContentHash: hashValue(challengePolicyVersion),
      assignedAt: timestamp,
    });
    const receipt = ChallengePolicyReceiptSchema.parse({
      policyReceiptId: stableId("challenge-policy-receipt", {
        assignmentId: assignment.challengeAssignmentId,
      }),
      forecastId: forecast.forecastId,
      selectedCandidateId: selected.candidateId,
      previousChallengeLevel: previousLevel,
      selectedChallengeLevel: level,
      fallbackReason,
      explanation: fallbackReason === "low_profile_confidence"
        ? "画像置信度不足，下一轮保持原压力并交由教师确认。"
        : fallbackReason === "high_prediction_error"
          ? "上一轮代理预测误差过高，下一轮保持原压力并回退教师确认。"
          : `在自动单次最多升降一级的边界内，选择成长价值较高且过载风险可控的 ${level} 级候选。`,
      createdAt: timestamp,
    });
    return { assignment, receipt };
  }

  #buildPlan(
    profile: LearnerTwinProfile,
    decision: AssessmentDecision,
    world: AdaptationWorldContextV3,
    assignment: ChallengeAssignment,
    timestamp: string,
  ): PersonalizedLearningPlan {
    const estimatesById = new Map(decision.competencyEstimates.map(
      (estimate) => [estimate.competencyClaimId, estimate],
    ));
    const targets = profile.nextCompetencyTargetRefs.map((claimId) => {
      const state = profile.competencyStates.find(
        (item) => item.competencyClaimId === claimId,
      )!;
      const estimate = estimatesById.get(claimId)!;
      const title = competencyTitles[claimId] ?? claimId;
      return {
        competencyClaimId: claimId,
        currentLevel: state.competencyLevel,
        targetLevel: clamp(state.competencyLevel + 1, 1, 5),
        evidenceRefs: estimate.evidenceEpisodeRefs,
        practiceIntent: `在下一轮${title}任务中先自主判断，再用至少两条独立依据说明取舍。`,
        successEvidence: `形成可追溯作品修订、真实岗位行动与相应世界后果，且教师可复核其因果关系。`,
      };
    });
    const scaffolds: PersonalizedLearningPlan["scaffoldingActions"] = [
      {
        actionId: stableId("scaffold-action", {
          profile: profile.profileContentHash,
          kind: "evidence_prompt",
        }),
        title: "证据追问卡",
        triggerCondition: "连续行动仍只有单一信源，或关键说法无法定位原始出处时出现。",
        fadeCondition: "学生连续两次主动形成独立信源交叉核验后自动撤除。",
      },
      {
        actionId: stableId("scaffold-action", {
          profile: profile.profileContentHash,
          kind: "reflection_pause",
        }),
        title: "冲突后复盘停顿",
        triggerCondition: "现场关系或版权风险上升，且首次处理未形成恢复路径时出现。",
        fadeCondition: "学生能在不依赖提示的情况下说明修订、补证或升级教师门的理由后撤除。",
      },
    ];
    return PersonalizedLearningPlanSchema.parse({
      schemaVersion: PersonalizedLearningPlanSchemaVersion,
      learningPlanId: stableId("learning-plan", {
        learnerTwinId: profile.learnerTwinId,
        revision: profile.revision,
        assignmentId: assignment.challengeAssignmentId,
      }),
      learnerTwinRef: profile.learnerTwinId,
      sourceAssessmentDecisionRef: decision.assessmentDecisionId,
      sourceChallengeAssignmentRef:
        world.challengeAssignment.challengeAssignmentId,
      status: "proposed",
      targetCompetencies: targets,
      recommendedChallengeLevel: assignment.challengeLevel,
      recommendedWorldVariantRefs: unique([
        assignment.worldVariantRef,
        ...world.release.challengeVariants
          .filter((variant) => Math.abs(
            variant.challengeLevel - assignment.challengeLevel,
          ) <= 1)
          .map((variant) => variant.worldVariantId),
      ]).slice(0, 8),
      scaffoldingActions: scaffolds,
      learnerChoiceRefs: [],
      teacherConfirmation: null,
      reviewDueAt: addDays(timestamp, 14),
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  #calibratePendingForecasts(
    record: LearnerAdaptationRecordV3,
    world: AdaptationWorldContextV3,
    timestamp: string,
  ): { record: LearnerAdaptationRecordV3; changed: boolean } {
    if (world.studentActions.length === 0) return { record, changed: false };
    let changed = false;
    const forecasts = record.forecasts.map((forecast) => {
      if (forecast.calibration.status !== "pending") return forecast;
      const assignment = record.challengeAssignments.find((candidate) => (
        candidate.forecastRef === forecast.forecastId
          && candidate.sessionId === world.sessionId
      ));
      if (!assignment) return forecast;
      changed = true;
      return LearnerSimulationForecastSchema.parse({
        ...forecast,
        calibration: {
          status: "evaluated",
          actualStudentActionRefs: world.studentActions
            .map((action) => action.workActionId)
            .slice(0, 32),
          predictionError: calibrationError(
            forecast,
            assignment,
            world.studentActions,
          ),
          evaluatedAt: timestamp,
        },
      });
    });
    return changed ? {
      record: LearnerAdaptationRecordSchema.parse({ ...record, forecasts }),
      changed,
    } : { record, changed };
  }

  #profileWithAppeal(
    profile: LearnerTwinProfile,
    appeal: LearnerTwinProfile["appeal"],
    timestamp: string,
  ): LearnerTwinProfile {
    const { profileContentHash: _ignored, ...base } = profile;
    return withProfileContentHash({
      ...base,
      revision: profile.revision + 1,
      appeal,
      updatedAt: timestamp,
    });
  }

  #assertSources(
    decision: AssessmentDecision,
    world: AdaptationWorldContextV3,
  ): void {
    const release = decision.simulationReleaseRef;
    const actual = world.release.simulationReleaseRef;
    if (decision.sessionId !== world.sessionId
      || decision.challengeAssignmentRef
        !== world.challengeAssignment.challengeAssignmentId
      || release.simulationId !== actual.simulationId
      || release.releaseId !== actual.releaseId
      || release.version !== actual.version
      || release.contentHash !== actual.contentHash) {
      throw new LearnerAdaptationErrorV3(
        "source_drift",
        "评价、挑战分配与不可变世界发布版不在同一因果链",
      );
    }
  }

  async #requiredRecord(learnerTwinId: string): Promise<LearnerAdaptationRecordV3> {
    const record = await this.options.store.load(learnerTwinId);
    if (!record) {
      throw new LearnerAdaptationErrorV3(
        "not_found",
        "学习者成长记录不存在",
      );
    }
    return record;
  }

  #now(): string {
    return this.options.now?.() ?? new Date().toISOString();
  }

  async #serialized<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolveLock) => {
      release = resolveLock;
    });
    const queued = previous.then(() => current);
    this.#locks.set(key, queued);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.#locks.get(key) === queued) this.#locks.delete(key);
    }
  }
}
