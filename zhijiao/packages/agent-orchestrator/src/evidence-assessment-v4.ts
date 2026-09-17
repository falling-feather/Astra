import { createHash } from "node:crypto";
import { z } from "zod";
import {
  AssessmentCriterionIdV4Schema,
  BlindEvidenceAssessmentInputV4Schema,
  EvidenceAssessmentDecisionV4Schema,
  EvidenceAssessmentDecisionV4SchemaVersion,
  V2ContentHashSchema,
  V2IdentifierSchema,
  type AssessmentCriterionIdV4,
  type BlindEvidenceAssessmentInputV4,
  type EvidenceAssessmentDecisionV4,
} from "@ronggang/contracts";

export const StructuredAssessmentEvidenceCodeV4Schema = z.enum([
  "verified_claim_supported",
  "cross_source_comparison",
  "bounded_unknown",
  "fabricated_reference_detected",
  "unsupported_claim_detected",
  "current_unsupported_claim",
  "purpose_and_scope_declared",
  "consent_scope_recorded",
  "open_followup_recorded",
  "consent_ignored",
  "public_value_tradeoff",
  "commercial_exchange_disclosed_or_rejected",
  "commercial_exchange_hidden",
  "deadline_tradeoff_evidenced",
  "rights_receipt_linked",
  "withdrawal_replaced",
  "ai_disclosure_preserved",
  "withdrawal_ignored",
  "rights_scope_exceeded",
  "actual_media_derivative",
  "cross_format_consistent",
  "platform_rationale_recorded",
  "text_only_submission",
  "revision_pair_preserved",
  "evidence_request_or_reasoned_rejection",
  "public_correction_preserved",
  "initial_error_preserved",
  "silent_edit_detected",
  "grounded_transfer_reflection",
  "advice_present_context_only",
  "completion_context_only",
]);
export type StructuredAssessmentEvidenceCodeV4 = z.infer<
  typeof StructuredAssessmentEvidenceCodeV4Schema
>;

export const StructuredAssessmentEvidenceFactV4Schema = z.object({
  evidenceRef: V2IdentifierSchema,
  sourceKind: z.enum([
    "artifact_revision",
    "claim_evidence",
    "student_behavior",
    "world_consequence",
    "scaffolding",
    "recovery_pair",
  ]),
  evidenceCode: StructuredAssessmentEvidenceCodeV4Schema,
  independenceKey: V2IdentifierSchema,
  sourceContentHash: V2ContentHashSchema,
}).strict();
export type StructuredAssessmentEvidenceFactV4 = z.infer<
  typeof StructuredAssessmentEvidenceFactV4Schema
>;

export const EvidenceAssessmentRubricCriterionV4Schema = z.object({
  criterionId: AssessmentCriterionIdV4Schema,
  weight: z.number().positive().max(100),
  minimumIndependentEvidenceCount: z.number().int().positive().max(16),
}).strict();

export const EvidenceAssessmentRubricV4Schema = z.object({
  rubricVersion: z.string().trim().min(1).max(120),
  rubricContentHash: V2ContentHashSchema,
  reviewStatus: z.enum(["pending_expert_review", "verified"]),
  criteria: z.array(EvidenceAssessmentRubricCriterionV4Schema).length(6),
  workBasis: z.object({
    courseTitle: z.string().min(1).max(240), assignment: z.string().min(1).max(4000),
    learningObjectives: z.array(z.string().min(1)).min(1).max(20),
    criteria: z.array(z.object({ criterionId: AssessmentCriterionIdV4Schema,
      artifactRefs: z.array(V2IdentifierSchema).min(1).max(32), expectations: z.array(z.string().min(1)).min(1).max(24),
    }).strict()).length(6),
  }).strict().optional(),
}).strict().superRefine((rubric, context) => {
  const criterionIds = rubric.criteria.map((criterion) => criterion.criterionId);
  if (new Set(criterionIds).size !== AssessmentCriterionIdV4Schema.options.length
    || AssessmentCriterionIdV4Schema.options.some((id) => !criterionIds.includes(id))) {
    context.addIssue({
      code: "custom",
      path: ["criteria"],
      message: "评价量规必须且只能覆盖冻结的六个岗位能力维度",
    });
  }
  const totalWeight = rubric.criteria.reduce((sum, criterion) => sum + criterion.weight, 0);
  if (rubric.workBasis && new Set(rubric.workBasis.criteria.map(item => item.criterionId)).size !== 6)
    context.addIssue({ code: "custom", path: ["workBasis", "criteria"], message: "作品评价依据必须逐一对应六个维度" });
  if (Math.abs(totalWeight - 100) > 0.000_001) {
    context.addIssue({
      code: "custom",
      path: ["criteria"],
      message: "评价量规六维权重之和必须为 100",
    });
  }
});
export type EvidenceAssessmentRubricV4 = z.infer<
  typeof EvidenceAssessmentRubricV4Schema
>;

export const BlindCriterionJudgmentV4Schema = z.object({
  criterionId: AssessmentCriterionIdV4Schema,
  evidenceStatus: z.enum(["insufficient", "supported", "mixed", "refuted"]),
  band: z.enum(["low", "medium", "high"]).nullable(),
  score: z.number().min(0).max(100).nullable(),
  confidence: z.number().min(0).max(1),
  evidenceRefs: z.array(V2IdentifierSchema).max(32),
  rationale: z.string().trim().min(1).max(1_000),
  surfaceSignalsUsed: z.literal(false),
}).strict();
export type BlindCriterionJudgmentV4 = z.infer<
  typeof BlindCriterionJudgmentV4Schema
>;

interface EvidenceCodeDefinitionV4 {
  criterionId: AssessmentCriterionIdV4;
  points: number;
  disposition: "supports" | "refutes" | "context" | "invalidates";
  label: string;
}

const evidenceDefinitions: Readonly<
  Record<StructuredAssessmentEvidenceCodeV4, EvidenceCodeDefinitionV4>
> = {
  verified_claim_supported: {
    criterionId: "criterion-fact-verification",
    points: 2,
    disposition: "supports",
    label: "主张由可定位证据支持",
  },
  cross_source_comparison: {
    criterionId: "criterion-fact-verification",
    points: 2,
    disposition: "supports",
    label: "完成独立来源交叉核验",
  },
  bounded_unknown: {
    criterionId: "criterion-fact-verification",
    points: 1,
    disposition: "supports",
    label: "明确区分已知、未知与时点",
  },
  fabricated_reference_detected: {
    criterionId: "criterion-fact-verification",
    points: 0,
    disposition: "invalidates",
    label: "发现伪造或不存在的来源定位",
  },
  unsupported_claim_detected: {
    criterionId: "criterion-fact-verification",
    points: -3,
    disposition: "refutes",
    label: "保留了无依据核心主张",
  },
  current_unsupported_claim: {
    criterionId: "criterion-fact-verification",
    points: -5,
    disposition: "refutes",
    label: "最新送审作品仍作出当前来源未支持的确定性主张",
  },
  purpose_and_scope_declared: {
    criterionId: "criterion-interview-consent",
    points: 2,
    disposition: "supports",
    label: "采访前说明身份、用途与公开范围",
  },
  consent_scope_recorded: {
    criterionId: "criterion-interview-consent",
    points: 2,
    disposition: "supports",
    label: "保存匿名、删题或撤回边界",
  },
  open_followup_recorded: {
    criterionId: "criterion-interview-consent",
    points: 1,
    disposition: "supports",
    label: "围绕矛盾进行了可追溯追问",
  },
  consent_ignored: {
    criterionId: "criterion-interview-consent",
    points: -5,
    disposition: "refutes",
    label: "明确同意边界被忽略",
  },
  public_value_tradeoff: {
    criterionId: "criterion-editorial-judgment",
    points: 2,
    disposition: "supports",
    label: "用公共价值解释编辑取舍",
  },
  commercial_exchange_disclosed_or_rejected: {
    criterionId: "criterion-editorial-judgment",
    points: 3,
    disposition: "supports",
    label: "披露或拒绝商业置换",
  },
  commercial_exchange_hidden: {
    criterionId: "criterion-editorial-judgment",
    points: -5,
    disposition: "refutes",
    label: "商业条件被隐瞒或支配选题",
  },
  deadline_tradeoff_evidenced: {
    criterionId: "criterion-editorial-judgment",
    points: 2,
    disposition: "supports",
    label: "时效与核验取舍具有证据",
  },
  rights_receipt_linked: {
    criterionId: "criterion-rights-governance",
    points: 2,
    disposition: "supports",
    label: "媒体与权利回执逐项闭合",
  },
  withdrawal_replaced: {
    criterionId: "criterion-rights-governance",
    points: 3,
    disposition: "supports",
    label: "撤回后完成替换或补授权",
  },
  ai_disclosure_preserved: {
    criterionId: "criterion-rights-governance",
    points: 2,
    disposition: "supports",
    label: "显隐式 AI 标识均被保留",
  },
  withdrawal_ignored: {
    criterionId: "criterion-rights-governance",
    points: -5,
    disposition: "refutes",
    label: "撤回仍被忽略或素材继续传播",
  },
  rights_scope_exceeded: {
    criterionId: "criterion-rights-governance",
    points: -5,
    disposition: "refutes",
    label: "作品宣称的使用许可超过已取得的权利范围",
  },
  actual_media_derivative: {
    criterionId: "criterion-multiplatform-production",
    points: 2,
    disposition: "supports",
    label: "产生可复算的真实派生媒体",
  },
  cross_format_consistent: {
    criterionId: "criterion-multiplatform-production",
    points: 3,
    disposition: "supports",
    label: "图文、音频与视频事实边界一致",
  },
  platform_rationale_recorded: {
    criterionId: "criterion-multiplatform-production",
    points: 1,
    disposition: "supports",
    label: "平台适配理由可追溯",
  },
  text_only_submission: {
    criterionId: "criterion-multiplatform-production",
    points: -4,
    disposition: "refutes",
    label: "仅有文字完成状态，没有媒体成品",
  },
  revision_pair_preserved: {
    criterionId: "criterion-recovery-transfer",
    points: 2,
    disposition: "supports",
    label: "修订前后版本均被保留",
  },
  evidence_request_or_reasoned_rejection: {
    criterionId: "criterion-recovery-transfer",
    points: 2,
    disposition: "supports",
    label: "补证或拒绝建议具有学生理由",
  },
  public_correction_preserved: {
    criterionId: "criterion-recovery-transfer",
    points: 3,
    disposition: "supports",
    label: "公开更正及影响范围可追溯",
  },
  initial_error_preserved: {
    criterionId: "criterion-recovery-transfer",
    points: 1,
    disposition: "supports",
    label: "初始错误未被最终安全结果抹除",
  },
  silent_edit_detected: {
    criterionId: "criterion-recovery-transfer",
    points: -5,
    disposition: "refutes",
    label: "发现静默修改或破坏版本链",
  },
  grounded_transfer_reflection: {
    criterionId: "criterion-recovery-transfer",
    points: 1,
    disposition: "supports",
    label: "迁移反思引用真实轨迹",
  },
  advice_present_context_only: {
    criterionId: "criterion-recovery-transfer",
    points: 0,
    disposition: "context",
    label: "存在教学建议，但建议内容不参与学生评分",
  },
  completion_context_only: {
    criterionId: "criterion-multiplatform-production",
    points: 0,
    disposition: "context",
    label: "存在完成动作，但完成次数不参与能力评分",
  },
};

const sourceKindsByCriterion: Readonly<
  Record<AssessmentCriterionIdV4, readonly StructuredAssessmentEvidenceFactV4["sourceKind"][]>
> = {
  "criterion-fact-verification": ["claim_evidence", "student_behavior", "world_consequence", "artifact_revision"],
  "criterion-interview-consent": ["student_behavior", "world_consequence", "artifact_revision"],
  "criterion-editorial-judgment": ["student_behavior", "world_consequence", "artifact_revision"],
  "criterion-rights-governance": ["claim_evidence", "world_consequence", "artifact_revision", "recovery_pair"],
  "criterion-multiplatform-production": ["artifact_revision", "world_consequence"],
  "criterion-recovery-transfer": ["recovery_pair", "student_behavior", "world_consequence", "artifact_revision"],
};

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

function round2(value: number): number {
  return Number(value.toFixed(2));
}

function allowedEvidenceRefs(input: BlindEvidenceAssessmentInputV4): Map<string, Set<string>> {
  return new Map([
    ["artifact_revision", new Set(input.artifactRevisions.map((item) => item.revisionRef))],
    ["claim_evidence", new Set(input.claimEvidenceLinks.flatMap((item) => item.evidenceRefs))],
    ["student_behavior", new Set(input.behaviorEvidenceRefs)],
    ["world_consequence", new Set(input.worldConsequenceRefs)],
    ["scaffolding", new Set(input.scaffoldingEpisodeRefs)],
    ["recovery_pair", new Set(input.recoveryPairRefs)],
  ]);
}

export function validateStructuredAssessmentEvidenceV4(input: {
  blindInput: BlindEvidenceAssessmentInputV4;
  evidenceFacts: StructuredAssessmentEvidenceFactV4[];
}): StructuredAssessmentEvidenceFactV4[] {
  const blindInput = BlindEvidenceAssessmentInputV4Schema.parse(input.blindInput);
  const evidenceFacts = input.evidenceFacts.map((fact) => (
    StructuredAssessmentEvidenceFactV4Schema.parse(fact)
  ));
  const allowed = allowedEvidenceRefs(blindInput);
  const uniqueFacts = new Set<string>();
  for (const fact of evidenceFacts) {
    if (!allowed.get(fact.sourceKind)?.has(fact.evidenceRef)) {
      throw new Error(`评价证据 ${fact.evidenceRef} 不属于盲化输入的 ${fact.sourceKind}`);
    }
    const key = `${fact.evidenceRef}\u0000${fact.evidenceCode}`;
    if (uniqueFacts.has(key)) throw new Error("同一评价事实不得重复计入");
    uniqueFacts.add(key);
  }
  return evidenceFacts;
}

export function evaluateBlindCriteriaV4(input: {
  blindInput: BlindEvidenceAssessmentInputV4;
  evidenceFacts: StructuredAssessmentEvidenceFactV4[];
  rubric: EvidenceAssessmentRubricV4;
}): BlindCriterionJudgmentV4[] {
  const blindInput = BlindEvidenceAssessmentInputV4Schema.parse(input.blindInput);
  const rubric = EvidenceAssessmentRubricV4Schema.parse(input.rubric);
  if (blindInput.rubricVersion !== rubric.rubricVersion
    || blindInput.rubricContentHash !== rubric.rubricContentHash
    || blindInput.rubricReviewStatus !== rubric.reviewStatus) {
    throw new Error("盲化输入与冻结量规版本或复核状态漂移");
  }
  const evidenceFacts = validateStructuredAssessmentEvidenceV4({
    blindInput,
    evidenceFacts: input.evidenceFacts,
  });

  if (rubric.workBasis) {
    if (blindInput.assessmentBasis !== "submitted_work") throw new Error("作品评价依据与盲化输入不一致");
    return rubric.criteria.map(criterion => ({ criterionId: criterion.criterionId, evidenceStatus: "insufficient" as const,
      band: null, score: null, confidence: 0, evidenceRefs: [], surfaceSignalsUsed: false as const,
      rationale: "已提交的作品需要按本课目标审读。操作次数、好友数量和填写长度不换算为能力分；当前等待作品质量评估或教师审阅。" }));
  }
  if (blindInput.assessmentBasis === "submitted_work") throw new Error("作品评价缺少冻结课程依据");

  return rubric.criteria.map((criterion): BlindCriterionJudgmentV4 => {
    const relevant = evidenceFacts.filter((fact) => (
      evidenceDefinitions[fact.evidenceCode].criterionId === criterion.criterionId
    ));
    const scored = relevant.filter((fact) => (
      evidenceDefinitions[fact.evidenceCode].disposition !== "context"
    ));
    const independent = new Map<string, StructuredAssessmentEvidenceFactV4>();
    for (const fact of scored) {
      if (!independent.has(fact.independenceKey)) independent.set(fact.independenceKey, fact);
    }
    const independentFacts = [...independent.values()];
    const invalidating = independentFacts.filter((fact) => (
      evidenceDefinitions[fact.evidenceCode].disposition === "invalidates"
    ));
    const hasRequiredSource = independentFacts.some((fact) => (
      sourceKindsByCriterion[criterion.criterionId].includes(fact.sourceKind)
    ));
    const insufficientReasons: string[] = [];
    if (invalidating.length > 0) {
      insufficientReasons.push("证据来源真实性失败，不能把伪定位换算成能力分");
    }
    if (independentFacts.length < criterion.minimumIndependentEvidenceCount) {
      insufficientReasons.push(
        `需 ${criterion.minimumIndependentEvidenceCount} 项独立岗位证据，当前仅 ${independentFacts.length} 项`,
      );
    }
    if (!hasRequiredSource) insufficientReasons.push("缺少该维度要求的真实行为、作品或后果来源");
    if (insufficientReasons.length > 0) {
      return {
        criterionId: criterion.criterionId,
        evidenceStatus: "insufficient",
        band: null,
        score: null,
        confidence: 0,
        evidenceRefs: [],
        rationale: `证据不足：${insufficientReasons.join("；")}。`,
        surfaceSignalsUsed: false,
      };
    }

    const supportFacts = independentFacts.filter((fact) => (
      evidenceDefinitions[fact.evidenceCode].disposition === "supports"
    ));
    const refuteFacts = independentFacts.filter((fact) => (
      evidenceDefinitions[fact.evidenceCode].disposition === "refutes"
    ));
    const points = independentFacts.reduce(
      (sum, fact) => sum + evidenceDefinitions[fact.evidenceCode].points,
      0,
    );
    const severeRefutation = refuteFacts.some((fact) => (
      evidenceDefinitions[fact.evidenceCode].points <= -5
    ));
    const distinctSources = new Set(independentFacts.map((fact) => fact.sourceKind)).size;
    const band = severeRefutation || points <= 0
      ? "low" as const
      : points >= 5 && distinctSources >= 2
        ? "high" as const
        : "medium" as const;
    const score = band === "high" ? 88 : band === "medium" ? 70 : 38;
    const evidenceStatus = refuteFacts.length === 0
      ? "supported" as const
      : supportFacts.length === 0
        ? "refuted" as const
        : "mixed" as const;
    const labels = independentFacts.map((fact) => evidenceDefinitions[fact.evidenceCode].label);
    return {
      criterionId: criterion.criterionId,
      evidenceStatus,
      band,
      score,
      confidence: round2(Math.min(0.9, 0.52 + distinctSources * 0.08 + independentFacts.length * 0.04)),
      evidenceRefs: [...new Set(independentFacts.map((fact) => fact.evidenceRef))].sort(),
      rationale: `依据服务端结构化岗位事实判断：${labels.join("；")}。未使用文本长度、关键词、点击次数或终局标签。`,
      surfaceSignalsUsed: false,
    };
  });
}

export function issueEvidenceAssessmentDecisionV4(input: {
  blindInput: BlindEvidenceAssessmentInputV4;
  evidenceFacts: StructuredAssessmentEvidenceFactV4[];
  rubric: EvidenceAssessmentRubricV4;
  scoreCeiling: 80 | 85 | 90 | 95 | 100;
  challengeAdjustmentRef: string;
  assessorMode?: "independent_live_agent" | "deterministic_fallback";
  generatedAt: string;
}): {
  decision: EvidenceAssessmentDecisionV4;
  blindJudgments: BlindCriterionJudgmentV4[];
  rawWeightedScore: number | null;
} {
  const blindInput = BlindEvidenceAssessmentInputV4Schema.parse(input.blindInput);
  const rubric = EvidenceAssessmentRubricV4Schema.parse(input.rubric);
  const blindJudgments = evaluateBlindCriteriaV4({
    blindInput,
    evidenceFacts: input.evidenceFacts,
    rubric,
  });
  return issueEvidenceAssessmentDecisionFromJudgmentsV4({
    blindInput,
    evidenceFacts: input.evidenceFacts,
    rubric,
    blindJudgments,
    scoreCeiling: input.scoreCeiling,
    challengeAdjustmentRef: input.challengeAdjustmentRef,
    assessorMode: input.assessorMode ?? "deterministic_fallback",
    generatedAt: input.generatedAt,
  });
}

export function issueEvidenceAssessmentDecisionFromJudgmentsV4(input: {
  blindInput: BlindEvidenceAssessmentInputV4;
  evidenceFacts: StructuredAssessmentEvidenceFactV4[];
  rubric: EvidenceAssessmentRubricV4;
  blindJudgments: BlindCriterionJudgmentV4[];
  scoreCeiling: 80 | 85 | 90 | 95 | 100;
  challengeAdjustmentRef: string;
  assessorMode: "independent_live_agent" | "deterministic_fallback";
  generatedAt: string;
}): {
  decision: EvidenceAssessmentDecisionV4;
  blindJudgments: BlindCriterionJudgmentV4[];
  rawWeightedScore: number | null;
} {
  const blindInput = BlindEvidenceAssessmentInputV4Schema.parse(input.blindInput);
  const rubric = EvidenceAssessmentRubricV4Schema.parse(input.rubric);
  validateStructuredAssessmentEvidenceV4({
    blindInput,
    evidenceFacts: input.evidenceFacts,
  });
  const blindJudgments = input.blindJudgments.map((judgment) => (
    BlindCriterionJudgmentV4Schema.parse(judgment)
  ));
  const ids = blindJudgments.map((judgment) => judgment.criterionId);
  if (new Set(ids).size !== AssessmentCriterionIdV4Schema.options.length
    || AssessmentCriterionIdV4Schema.options.some((criterionId) => !ids.includes(criterionId))) {
    throw new Error("盲化评价结果必须且只能覆盖冻结的六项岗位能力");
  }
  const evidenceGate = evaluateBlindCriteriaV4({
    blindInput,
    evidenceFacts: input.evidenceFacts,
    rubric,
  });
  const ranks = { low: 0, medium: 1, high: 2 } as const;
  const sameRefs = (left: readonly string[], right: readonly string[]) => {
    const normalizedLeft = [...left].sort();
    const normalizedRight = [...right].sort();
    return normalizedLeft.length === normalizedRight.length
      && normalizedLeft.every((reference, index) => reference === normalizedRight[index]);
  };
  for (const judgment of blindJudgments) {
    if (rubric.workBasis && input.assessorMode === "independent_live_agent") {
      const criterion = rubric.workBasis.criteria.find(item => item.criterionId === judgment.criterionId)!;
      const allowed = new Set(blindInput.artifactRevisions.filter(item => criterion.artifactRefs.includes(item.artifactRef)).map(item => item.revisionRef));
      if (judgment.score === null || judgment.band === null || judgment.evidenceStatus === "insufficient" || judgment.evidenceRefs.length === 0
        || judgment.evidenceRefs.some(ref => !allowed.has(ref))) throw new Error(`作品评价引用未绑定本维度的已提交作品：${judgment.criterionId}`);
      const inBand = judgment.band === "low" ? judgment.score < 60 : judgment.band === "medium" ? judgment.score >= 60 && judgment.score < 80 : judgment.score >= 80;
      if (!inBand) throw new Error("作品分数与档位不一致");
      continue;
    }
    const gate = evidenceGate.find((candidate) => (
      candidate.criterionId === judgment.criterionId
    ))!;
    if (judgment.evidenceStatus !== gate.evidenceStatus
      || !sameRefs(judgment.evidenceRefs, gate.evidenceRefs)
      || ((gate.score === null || gate.band === null)
        !== (judgment.score === null || judgment.band === null))
      || (gate.band !== null && judgment.band !== null
        && ranks[judgment.band] > ranks[gate.band])) {
      throw new Error(`盲化评价草稿越过确定性证据门：${judgment.criterionId}`);
    }
  }
  const allSufficient = blindJudgments.every((judgment) => judgment.score !== null);
  const rawWeightedScore = allSufficient
    ? Math.round(rubric.criteria.reduce((sum, criterion) => {
        const judgment = blindJudgments.find((item) => item.criterionId === criterion.criterionId)!;
        return sum + judgment.score! * criterion.weight / 100;
      }, 0))
    : null;
  const challengeAdjustedScore = rawWeightedScore === null
    ? null
    : Math.min(rawWeightedScore, input.scoreCeiling);
  const decisionEvidenceRefs = allSufficient
    ? [...new Set(blindJudgments.flatMap((judgment) => judgment.evidenceRefs))].sort()
    : [];
  const criterionAssessments = allSufficient
    ? blindJudgments
    : blindJudgments.map((judgment) => ({
        criterionId: judgment.criterionId,
        evidenceStatus: "insufficient" as const,
        band: null,
        score: null,
        confidence: 0,
        evidenceRefs: [],
        rationale: judgment.evidenceStatus === "insufficient"
          ? judgment.rationale
          : "其余必评维度仍未通过独立证据门，本轮不发布局部分数。",
        surfaceSignalsUsed: false as const,
      }));
  const decision = EvidenceAssessmentDecisionV4Schema.parse({
    schemaVersion: EvidenceAssessmentDecisionV4SchemaVersion,
    assessmentDecisionId: stableId("assessment-v4", {
      blindInputHash: blindInput.inputHash,
      evidenceHash: hash(input.evidenceFacts),
      rubricContentHash: rubric.rubricContentHash,
      judgmentHash: hash(blindJudgments),
      scoreCeiling: input.scoreCeiling,
    }),
    blindCaseRef: blindInput.blindCaseId,
    blindInputHash: blindInput.inputHash,
    status: allSufficient ? "provisional" : "insufficient_evidence",
    assessorMode: input.assessorMode,
    rubricReviewStatus: rubric.reviewStatus,
    criterionAssessments,
    sessionScore: challengeAdjustedScore,
    evidenceRefs: decisionEvidenceRefs,
    adviceAgentExcluded: true,
    challengeAppliedAfterBlindAssessment: true,
    challengeAdjustmentRef: allSufficient ? input.challengeAdjustmentRef : null,
    teacherReview: {
      status: "pending",
      teacherDecisionRef: null,
      rationale: null,
      reviewedAt: null,
    },
    generatedAt: input.generatedAt,
  });
  return { decision, blindJudgments, rawWeightedScore };
}
