import {
  LearningArtifactReleaseSchema,
  LearningCandidateReviewSchema,
  LearningCandidateSchema,
  LearningReleaseRollbackSchema,
  LearningReplayReportSchema,
  type LearningArtifactRelease,
  type LearningCandidate,
  type LearningCandidateReview,
  type LearningReleaseRollback,
  type LearningReplayReport,
  type TeacherAssessmentReview,
} from "@ronggang/contracts";
import { hashValue } from "@ronggang/context-engine";

export const learningCandidateDefinitionVersion = "learning-curator/1.0.0";
export const learningReplayEngineVersion = "learning-replay/1.0.0";
export const learningReplayDatasetVersion =
  "local-tourism-assessment-fixtures/1.0.0";

const privateFieldPattern =
  /(?:sk-[a-z0-9_-]{8,}|api[_ -]?key|internalnote|reviewedby|providerrequestid|systemprompt|userprompt|modelrequestid)/iu;

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function createLearningCandidate(input: {
  nextId: (prefix: string) => string;
  now: string;
  title: string;
  proposedContent: Record<string, unknown>;
  sourceEvidenceRefs: readonly string[];
  sourceFinalAssessmentId: string;
  evaluationCaseId: string;
  courseId: string;
  scenarioId: string;
  rubricId: string;
  expectedBenefit: string;
  knownRisks: readonly string[];
  conflictRefs: readonly string[];
  generatedBy: string;
  generatorTraceId: string;
}): LearningCandidate {
  const candidateBase = {
    schemaVersion: "learning-governance/1.0.0" as const,
    candidateId: input.nextId("learning-candidate"),
    candidateType: "assessment_example" as const,
    status: "pending_review" as const,
    title: input.title,
    proposedContent: input.proposedContent,
    sourceEvidenceRefs: [...new Set(input.sourceEvidenceRefs)].sort(),
    sourceFinalAssessmentId: input.sourceFinalAssessmentId,
    evaluationCaseId: input.evaluationCaseId,
    applicabilityScope: {
      courseId: input.courseId,
      scenarioId: input.scenarioId,
      rubricId: input.rubricId,
    },
    expectedBenefit: input.expectedBenefit,
    knownRisks: [...new Set(input.knownRisks)].sort(),
    conflictRefs: [...new Set(input.conflictRefs)].sort(),
    generatedBy: input.generatedBy,
    generatorTraceId: input.generatorTraceId,
    createdAt: input.now,
  };
  return LearningCandidateSchema.parse({
    ...candidateBase,
    candidateHash: hashValue(candidateBase),
  });
}

export function runLearningCandidateReplay(input: {
  nextId: (prefix: string) => string;
  now: string;
  candidate: LearningCandidate;
  finalAssessment: TeacherAssessmentReview;
  allowedEvidenceRefs: readonly string[];
  scenarioReleaseId: string;
  scenarioContentHash: string;
  rubricHash: string;
  activeReleaseId: string | null;
}): LearningReplayReport {
  if (!input.candidate.candidateHash) {
    throw new Error("学习候选缺少固定内容哈希");
  }
  const allowed = new Set(input.allowedEvidenceRefs);
  const traceabilityPassed = input.candidate.sourceEvidenceRefs.every(
    (evidenceRef) => allowed.has(evidenceRef),
  );
  const serializedContent = JSON.stringify(input.candidate.proposedContent);
  const privacyPassed = !privateFieldPattern.test(serializedContent);
  const typePassed = input.candidate.candidateType === "assessment_example";
  const candidateScore = typeof input.candidate.proposedContent.finalScore === "number"
    ? input.candidate.proposedContent.finalScore
    : Number.NaN;
  const scoreDrift = Number.isFinite(candidateScore)
    ? round(Math.abs(candidateScore - input.finalAssessment.finalScore))
    : 100;
  const scorePassed = scoreDrift <= 0.01;
  const checks = [
    {
      checkId: "candidate_type_allowlist",
      status: typePassed ? "passed" as const : "failed" as const,
      summary: typePassed
        ? "首切片仅发布 assessment_example，候选类型符合白名单"
        : "候选类型不在 V0.7.0 发布白名单内",
    },
    {
      checkId: "source_traceability",
      status: traceabilityPassed ? "passed" as const : "failed" as const,
      summary: traceabilityPassed
        ? "候选引用均属于固定评价证据包"
        : "候选引用了固定评价证据包之外的证据",
    },
    {
      checkId: "privacy_boundary",
      status: privacyPassed ? "passed" as const : "failed" as const,
      summary: privacyPassed
        ? "脱敏夹具未发现密钥、提示词、审核人或内部请求字段"
        : "候选内容触发隐私或内部字段金丝雀",
    },
    {
      checkId: "score_stability",
      status: scorePassed ? "passed" as const : "failed" as const,
      summary: scorePassed
        ? "候选固化分数与教师终评一致"
        : `候选分数相对终评漂移 ${scoreDrift}`,
    },
  ];
  const fixture = {
    scenarioReleaseId: input.scenarioReleaseId,
    scenarioContentHash: input.scenarioContentHash,
    rubricHash: input.rubricHash,
    finalAssessment: {
      evaluationCaseId: input.finalAssessment.evaluationCaseId,
      finalHash: input.finalAssessment.finalHash,
      finalScore: input.finalAssessment.finalScore,
      dimensions: input.finalAssessment.dimensions.map((dimension) => ({
        dimensionId: dimension.dimensionId,
        proposedScore: dimension.proposedScore,
        finalScore: dimension.finalScore,
        evidenceRefs: [...dimension.evidenceRefs].sort(),
      })),
    },
    candidateHash: input.candidate.candidateHash,
    candidateContentHash: hashValue(input.candidate.proposedContent),
  };
  const status = checks.every((check) => check.status === "passed")
    ? "passed" as const
    : "failed" as const;
  const reportBase = {
    schemaVersion: "learning-governance/1.0.0" as const,
    reportId: input.nextId("learning-replay"),
    candidateId: input.candidate.candidateId,
    candidateHash: input.candidate.candidateHash,
    datasetVersion: learningReplayDatasetVersion,
    replayEngineVersion: learningReplayEngineVersion,
    baselineReleaseId: input.activeReleaseId,
    status,
    checks,
    testCaseCount: checks.length,
    passedCaseCount: checks.filter((check) => check.status === "passed").length,
    scoreDrift,
    privacyViolationCount: privacyPassed ? 0 : 1,
    fixtureHash: hashValue(fixture),
    completedAt: input.now,
  };
  return LearningReplayReportSchema.parse({
    ...reportBase,
    reportHash: hashValue(reportBase),
  });
}

export function createLearningCandidateReview(input: {
  nextId: (prefix: string) => string;
  now: string;
  candidate: LearningCandidate;
  replayReport: LearningReplayReport;
  decision: "approve" | "reject";
  reason: string;
  reviewedBy: string;
  requestId: string;
}): LearningCandidateReview {
  if (!input.candidate.candidateHash) {
    throw new Error("学习候选缺少固定内容哈希");
  }
  if (
    input.replayReport.candidateId !== input.candidate.candidateId
    || input.replayReport.candidateHash !== input.candidate.candidateHash
  ) {
    throw new Error("离线回放与学习候选不匹配");
  }
  if (input.decision === "approve" && input.replayReport.status !== "passed") {
    throw new Error("离线回放未通过的候选不能批准");
  }
  const reviewBase = {
    schemaVersion: "learning-governance/1.0.0" as const,
    reviewId: input.nextId("learning-candidate-review"),
    candidateId: input.candidate.candidateId,
    candidateHash: input.candidate.candidateHash,
    replayReportId: input.replayReport.reportId,
    replayReportHash: input.replayReport.reportHash,
    decision: input.decision,
    reason: input.reason,
    reviewedBy: input.reviewedBy,
    reviewedAt: input.now,
    requestId: input.requestId,
  };
  return LearningCandidateReviewSchema.parse({
    ...reviewBase,
    reviewHash: hashValue(reviewBase),
  });
}

export function createLearningArtifactRelease(input: {
  nextId: (prefix: string) => string;
  now: string;
  artifactKey: string;
  courseId: string;
  version: string;
  parentReleaseId: string | null;
  candidate: LearningCandidate;
  review: LearningCandidateReview;
  replayReport: LearningReplayReport;
  publishedBy: string;
  requestId: string;
}): LearningArtifactRelease {
  if (!input.candidate.candidateHash) {
    throw new Error("学习候选缺少固定内容哈希");
  }
  if (
    input.review.decision !== "approve"
    || input.review.candidateHash !== input.candidate.candidateHash
    || input.review.replayReportHash !== input.replayReport.reportHash
    || input.replayReport.status !== "passed"
  ) {
    throw new Error("学习候选尚未通过精确回放与人工批准门");
  }
  return LearningArtifactReleaseSchema.parse({
    schemaVersion: "learning-governance/1.0.0",
    releaseId: input.nextId("learning-release"),
    artifactKey: input.artifactKey,
    courseId: input.courseId,
    version: input.version,
    parentReleaseId: input.parentReleaseId,
    candidateId: input.candidate.candidateId,
    candidateHash: input.candidate.candidateHash,
    reviewId: input.review.reviewId,
    replayReportId: input.replayReport.reportId,
    contentHash: hashValue(input.candidate.proposedContent),
    publishedBy: input.publishedBy,
    publishedAt: input.now,
    requestId: input.requestId,
  });
}

export function createLearningReleaseRollback(input: {
  nextId: (prefix: string) => string;
  now: string;
  activeRelease: LearningArtifactRelease;
  targetReleaseId: string | null;
  reason: string;
  rolledBackBy: string;
  requestId: string;
}): LearningReleaseRollback {
  const rollbackBase = {
    schemaVersion: "learning-governance/1.0.0" as const,
    rollbackId: input.nextId("learning-rollback"),
    artifactKey: input.activeRelease.artifactKey,
    activeReleaseId: input.activeRelease.releaseId,
    activeContentHash: input.activeRelease.contentHash,
    targetReleaseId: input.targetReleaseId,
    reason: input.reason,
    rolledBackBy: input.rolledBackBy,
    rolledBackAt: input.now,
    requestId: input.requestId,
  };
  return LearningReleaseRollbackSchema.parse({
    ...rollbackBase,
    rollbackHash: hashValue(rollbackBase),
  });
}
