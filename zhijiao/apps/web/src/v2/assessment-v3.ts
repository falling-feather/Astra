import {
  AssessmentDecisionSchema,
  CompetencyEvidenceEpisodeSchema,
  type AssessmentDecision,
  type CompetencyEvidenceEpisode,
} from "@ronggang/contracts";
import { WireFormatError } from "./wire";
import {
  contentHashOf,
  exactRecord,
  integerOf,
  listOf,
  numberOf,
  oneOf,
  textOf,
} from "./world-v3";

export interface FlagshipAssessmentCriterionV3 {
  competencyClaimId: string;
  title: string;
  weight: number;
  minimumIndependentEvidenceCount: number;
  observableEvidence: string[];
}

export interface FlagshipCompetencyEvidenceViewV3 {
  schemaVersion: "flagship-competency-evidence-view/3.0.0";
  audience: "student" | "teacher" | "admin";
  assessmentBoundary: {
    artifactCompletionIsNotCompetencyScore: true;
    evidenceInsufficientMeansNoScore: true;
    finalAuthority: "teacher";
    rubricReviewStatus: "pending_expert_review";
  };
  assessment: AssessmentDecision;
  evidenceEpisodes: CompetencyEvidenceEpisode[];
  criteria: FlagshipAssessmentCriterionV3[];
  generatedAt: string;
}

export interface FlagshipSemanticReceiptV3 {
  semanticReceiptId: string;
  evidenceEpisodeId: string;
  competencyClaimId: string;
  evaluatorMode: "deterministic_demo" | "external_model" | "test_double";
  inputHash: string;
  outputHash: string;
  direction: "supports" | "refutes" | "insufficient";
  rawScore: number | null;
  confidence: number;
  rationale: string;
  evaluatedAt: string;
}

export interface FlagshipScoreComputationV3 {
  competencyClaimId: string;
  rawSemanticScore: number | null;
  behaviorAdjustment: number;
  challengeAdjustment: number;
  normalizedScore: number | null;
  minimumIndependentEvidenceCount: number;
  eligibleIndependentEvidenceCount: number;
  failClosedReasons: string[];
  evidenceEpisodeRefs: string[];
}

export interface FlagshipAssessmentCaseV3 {
  schemaVersion: "flagship-assessment-case-view/3.0.0";
  sessionId: string;
  sourceHash: string;
  assessmentBoundary: {
    evaluatorSeesIdentity: false;
    evaluatorSeesChallengeLevel: false;
    evaluatorSeesAgentAdvice: false;
    completionIsScore: false;
    finalAuthority: "teacher";
    rubricReviewStatus: "pending_expert_review";
  };
  evidenceEpisodes: CompetencyEvidenceEpisode[];
  semanticReceipts: FlagshipSemanticReceiptV3[];
  scoreComputations: FlagshipScoreComputationV3[];
  decisionHistory: AssessmentDecision[];
  reviewReceipts: unknown[];
  recomputation: {
    sourceHashAlgorithm: "sha256-canonical-json";
    semanticInputHashRecorded: true;
    challengeAppliedAfterBlindEvaluation: true;
    sourceRecordRevision: number;
  };
  updatedAt: string;
}

export interface ReviewFlagshipAssessmentInputV3 {
  sessionId: string;
  bindingId: string;
  expectedAssessmentDecisionId: string;
  requestId: string;
  status: "confirmed" | "revised";
  reason: string;
  competencyRevisions: Array<{
    competencyClaimId: string;
    score: number;
    competencyLevel: number;
    rationale: string;
  }>;
}

function textList(value: unknown, label: string): string[] {
  return listOf(value, label).map((item, index) => (
    textOf(item, `${label}[${index}]`)
  ));
}

export function parseFlagshipCompetencyEvidenceResponse(
  value: unknown,
  expectedAudience: FlagshipCompetencyEvidenceViewV3["audience"],
): FlagshipCompetencyEvidenceViewV3 {
  const root = exactRecord(value, ["evidence"], "FlagshipCompetencyEvidenceResponse");
  const evidence = exactRecord(root.evidence, [
    "schemaVersion",
    "audience",
    "assessmentBoundary",
    "assessment",
    "evidenceEpisodes",
    "criteria",
    "generatedAt",
  ], "FlagshipCompetencyEvidenceViewV3");
  if (evidence.schemaVersion !== "flagship-competency-evidence-view/3.0.0"
    || evidence.audience !== expectedAudience) {
    throw new WireFormatError("旗舰能力证据版本或认证角色不一致");
  }
  const boundary = exactRecord(evidence.assessmentBoundary, [
    "artifactCompletionIsNotCompetencyScore",
    "evidenceInsufficientMeansNoScore",
    "finalAuthority",
    "rubricReviewStatus",
  ], "assessmentBoundary");
  if (boundary.artifactCompletionIsNotCompetencyScore !== true
    || boundary.evidenceInsufficientMeansNoScore !== true
    || boundary.finalAuthority !== "teacher"
    || boundary.rubricReviewStatus !== "pending_expert_review") {
    throw new WireFormatError("旗舰能力评价安全边界被改变");
  }
  return {
    schemaVersion: "flagship-competency-evidence-view/3.0.0",
    audience: expectedAudience,
    assessmentBoundary: {
      artifactCompletionIsNotCompetencyScore: true,
      evidenceInsufficientMeansNoScore: true,
      finalAuthority: "teacher",
      rubricReviewStatus: "pending_expert_review",
    },
    assessment: AssessmentDecisionSchema.parse(evidence.assessment),
    evidenceEpisodes: listOf(evidence.evidenceEpisodes, "evidenceEpisodes")
      .map((episode) => CompetencyEvidenceEpisodeSchema.parse(episode)),
    criteria: listOf(evidence.criteria, "criteria").map((item, index) => {
      const criterion = exactRecord(item, [
        "competencyClaimId",
        "title",
        "weight",
        "minimumIndependentEvidenceCount",
        "observableEvidence",
      ], `criteria[${index}]`);
      return {
        competencyClaimId: textOf(
          criterion.competencyClaimId,
          `criteria[${index}].competencyClaimId`,
        ),
        title: textOf(criterion.title, `criteria[${index}].title`),
        weight: numberOf(criterion.weight, `criteria[${index}].weight`),
        minimumIndependentEvidenceCount: integerOf(
          criterion.minimumIndependentEvidenceCount,
          `criteria[${index}].minimumIndependentEvidenceCount`,
        ),
        observableEvidence: textList(
          criterion.observableEvidence,
          `criteria[${index}].observableEvidence`,
        ),
      };
    }),
    generatedAt: textOf(evidence.generatedAt, "generatedAt"),
  };
}

function parseSemanticReceipt(value: unknown, index: number): FlagshipSemanticReceiptV3 {
  const label = `semanticReceipts[${index}]`;
  const receipt = exactRecord(value, [
    "semanticReceiptId",
    "evidenceEpisodeId",
    "competencyClaimId",
    "evaluatorMode",
    "inputHash",
    "outputHash",
    "direction",
    "rawScore",
    "confidence",
    "rationale",
    "evaluatedAt",
  ], label);
  return {
    semanticReceiptId: textOf(receipt.semanticReceiptId, `${label}.semanticReceiptId`),
    evidenceEpisodeId: textOf(receipt.evidenceEpisodeId, `${label}.evidenceEpisodeId`),
    competencyClaimId: textOf(receipt.competencyClaimId, `${label}.competencyClaimId`),
    evaluatorMode: oneOf(
      receipt.evaluatorMode,
      ["deterministic_demo", "external_model", "test_double"] as const,
      `${label}.evaluatorMode`,
    ),
    inputHash: contentHashOf(receipt.inputHash, `${label}.inputHash`),
    outputHash: contentHashOf(receipt.outputHash, `${label}.outputHash`),
    direction: oneOf(
      receipt.direction,
      ["supports", "refutes", "insufficient"] as const,
      `${label}.direction`,
    ),
    rawScore: receipt.rawScore === null
      ? null
      : numberOf(receipt.rawScore, `${label}.rawScore`),
    confidence: numberOf(receipt.confidence, `${label}.confidence`),
    rationale: textOf(receipt.rationale, `${label}.rationale`),
    evaluatedAt: textOf(receipt.evaluatedAt, `${label}.evaluatedAt`),
  };
}

function parseScoreComputation(
  value: unknown,
  index: number,
): FlagshipScoreComputationV3 {
  const label = `scoreComputations[${index}]`;
  const item = exactRecord(value, [
    "competencyClaimId",
    "rawSemanticScore",
    "behaviorAdjustment",
    "challengeAdjustment",
    "normalizedScore",
    "minimumIndependentEvidenceCount",
    "eligibleIndependentEvidenceCount",
    "failClosedReasons",
    "evidenceEpisodeRefs",
  ], label);
  return {
    competencyClaimId: textOf(item.competencyClaimId, `${label}.competencyClaimId`),
    rawSemanticScore: item.rawSemanticScore === null
      ? null
      : numberOf(item.rawSemanticScore, `${label}.rawSemanticScore`),
    behaviorAdjustment: numberOf(item.behaviorAdjustment, `${label}.behaviorAdjustment`),
    challengeAdjustment: numberOf(item.challengeAdjustment, `${label}.challengeAdjustment`),
    normalizedScore: item.normalizedScore === null
      ? null
      : numberOf(item.normalizedScore, `${label}.normalizedScore`),
    minimumIndependentEvidenceCount: integerOf(
      item.minimumIndependentEvidenceCount,
      `${label}.minimumIndependentEvidenceCount`,
    ),
    eligibleIndependentEvidenceCount: integerOf(
      item.eligibleIndependentEvidenceCount,
      `${label}.eligibleIndependentEvidenceCount`,
    ),
    failClosedReasons: textList(item.failClosedReasons, `${label}.failClosedReasons`),
    evidenceEpisodeRefs: textList(item.evidenceEpisodeRefs, `${label}.evidenceEpisodeRefs`),
  };
}

export function parseFlagshipAssessmentCaseResponse(
  value: unknown,
): FlagshipAssessmentCaseV3 {
  const root = exactRecord(value, ["assessmentCase"], "FlagshipAssessmentCaseResponse");
  const assessmentCase = exactRecord(root.assessmentCase, [
    "schemaVersion",
    "sessionId",
    "sourceHash",
    "assessmentBoundary",
    "evidenceEpisodes",
    "semanticReceipts",
    "scoreComputations",
    "decisionHistory",
    "reviewReceipts",
    "recomputation",
    "updatedAt",
  ], "FlagshipAssessmentCaseV3");
  if (assessmentCase.schemaVersion !== "flagship-assessment-case-view/3.0.0") {
    throw new WireFormatError("旗舰评价重算案例版本不受支持");
  }
  const boundary = exactRecord(assessmentCase.assessmentBoundary, [
    "evaluatorSeesIdentity",
    "evaluatorSeesChallengeLevel",
    "evaluatorSeesAgentAdvice",
    "completionIsScore",
    "finalAuthority",
    "rubricReviewStatus",
  ], "assessmentCase.assessmentBoundary");
  if (boundary.evaluatorSeesIdentity !== false
    || boundary.evaluatorSeesChallengeLevel !== false
    || boundary.evaluatorSeesAgentAdvice !== false
    || boundary.completionIsScore !== false
    || boundary.finalAuthority !== "teacher"
    || boundary.rubricReviewStatus !== "pending_expert_review") {
    throw new WireFormatError("管理员评价案例安全边界被改变");
  }
  const recomputation = exactRecord(assessmentCase.recomputation, [
    "sourceHashAlgorithm",
    "semanticInputHashRecorded",
    "challengeAppliedAfterBlindEvaluation",
    "sourceRecordRevision",
  ], "assessmentCase.recomputation");
  if (recomputation.sourceHashAlgorithm !== "sha256-canonical-json"
    || recomputation.semanticInputHashRecorded !== true
    || recomputation.challengeAppliedAfterBlindEvaluation !== true) {
    throw new WireFormatError("评价案例不可按冻结算法重算");
  }
  return {
    schemaVersion: "flagship-assessment-case-view/3.0.0",
    sessionId: textOf(assessmentCase.sessionId, "assessmentCase.sessionId"),
    sourceHash: contentHashOf(assessmentCase.sourceHash, "assessmentCase.sourceHash"),
    assessmentBoundary: {
      evaluatorSeesIdentity: false,
      evaluatorSeesChallengeLevel: false,
      evaluatorSeesAgentAdvice: false,
      completionIsScore: false,
      finalAuthority: "teacher",
      rubricReviewStatus: "pending_expert_review",
    },
    evidenceEpisodes: listOf(assessmentCase.evidenceEpisodes, "assessmentCase.evidenceEpisodes")
      .map((episode) => CompetencyEvidenceEpisodeSchema.parse(episode)),
    semanticReceipts: listOf(assessmentCase.semanticReceipts, "assessmentCase.semanticReceipts")
      .map(parseSemanticReceipt),
    scoreComputations: listOf(assessmentCase.scoreComputations, "assessmentCase.scoreComputations")
      .map(parseScoreComputation),
    decisionHistory: listOf(assessmentCase.decisionHistory, "assessmentCase.decisionHistory")
      .map((decision) => AssessmentDecisionSchema.parse(decision)),
    reviewReceipts: listOf(assessmentCase.reviewReceipts, "assessmentCase.reviewReceipts"),
    recomputation: {
      sourceHashAlgorithm: "sha256-canonical-json",
      semanticInputHashRecorded: true,
      challengeAppliedAfterBlindEvaluation: true,
      sourceRecordRevision: integerOf(
        recomputation.sourceRecordRevision,
        "assessmentCase.recomputation.sourceRecordRevision",
      ),
    },
    updatedAt: textOf(assessmentCase.updatedAt, "assessmentCase.updatedAt"),
  };
}
