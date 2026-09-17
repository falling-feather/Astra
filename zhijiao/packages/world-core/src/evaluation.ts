import {
  EvaluationArbitrationSchema,
  EvaluationCaseSchema,
  EvaluationEvidenceBundleSchema,
  EvaluationProposalSchema,
  type AgentRunTrace,
  type ArtifactRevision,
  type EvaluationArbitration,
  type EvaluationCase,
  type EvaluationDimensionProposal,
  type EvaluationEvaluatorKind,
  type EvaluationEvidenceBundle,
  type EvaluationProposal,
  type Evidence,
  type ProductionSubmission,
  type RubricCriterion,
  type WorldEvent,
} from "@ronggang/contracts";
import { hashValue } from "@ronggang/context-engine";

export const evaluationCaseDefinitionVersion = "evaluation-case/1.0.0";
export const evaluationRulesetVersion = "evaluation-rules/1.0.0";
export const evaluationArbitratorVersion = "evaluation-arbitrator/1.0.0";
export const evaluationDisputeThresholdRatio = 0.15;

const evaluatorWeights: Record<EvaluationEvaluatorKind, number> = {
  rule: 0.35,
  evidence_sufficiency: 0.25,
  work_quality: 0.25,
  professional_collaboration: 0.15,
};

function roundScore(value: number): number {
  return Math.round(value * 100) / 100;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export interface CreateEvaluationCaseInput {
  nextId: (prefix: string) => string;
  now: string;
  sessionEpoch: string;
  openedFromMessageId: string;
  submission: ProductionSubmission;
  revision: ArtifactRevision;
  rubricId: string;
  rubricVersion: string;
  rubric: readonly RubricCriterion[];
  evidence: readonly Evidence[];
  events: readonly WorldEvent[];
  scenarioReleaseId: string;
  scenarioContentHash: string;
}

export function createEvaluationCase(input: CreateEvaluationCaseInput): {
  evidenceBundle: EvaluationEvidenceBundle;
  evaluationCase: EvaluationCase;
} {
  const evidenceRefs = input.evidence
    .map((evidence) => ({
      evidenceId: evidence.evidenceId,
      contentHash: hashValue(evidence),
      audienceHash: hashValue(
        evidence.audience ?? {
          visibility: evidence.visibility,
          actorId: evidence.actorId,
        },
      ),
    }))
    .sort((left, right) => left.evidenceId.localeCompare(right.evidenceId));
  const sourceEventRefs = uniqueSorted([
    ...input.events.map((event) => event.eventId),
    ...input.evidence.flatMap((evidence) => evidence.eventRefs),
  ]);
  const rubricHash = hashValue({
    rubricId: input.rubricId,
    rubricVersion: input.rubricVersion,
    rubric: input.rubric,
  });
  const bundleBase = {
    schemaVersion: "evaluation/1.0.0" as const,
    bundleId: input.nextId("evaluation-evidence-bundle"),
    sessionEpoch: input.sessionEpoch,
    submissionId: input.submission.submissionId,
    artifactId: input.submission.artifactId,
    revisionId: input.submission.revisionId,
    revisionNumber: input.submission.revisionNumber,
    revisionContentHash: input.revision.contentHash,
    rubricId: input.rubricId,
    rubricVersion: input.rubricVersion,
    rubricHash,
    evidenceRefs,
    sourceEventRefs: sourceEventRefs.length > 0
      ? sourceEventRefs
      : [input.openedFromMessageId],
    scenarioReleaseId: input.scenarioReleaseId,
    scenarioContentHash: input.scenarioContentHash,
    createdAt: input.now,
  };
  const evidenceBundle = EvaluationEvidenceBundleSchema.parse({
    ...bundleBase,
    bundleHash: hashValue(bundleBase),
  });
  const dimensions = input.rubric.map((criterion) => ({
    dimensionId: criterion.criterionId,
    label: criterion.label,
    weight: criterion.weight,
    maxScore: roundScore(criterion.weight * 100),
    rule: criterion.rule,
    evaluationKind: criterion.evaluation.kind,
  }));
  const caseBase = {
    schemaVersion: "evaluation/1.0.0" as const,
    evaluationCaseId: input.nextId("evaluation-case"),
    caseRevision: 1 as const,
    sessionEpoch: input.sessionEpoch,
    submissionId: input.submission.submissionId,
    artifactId: input.submission.artifactId,
    revisionId: input.submission.revisionId,
    evidenceBundleId: evidenceBundle.bundleId,
    evidenceBundleHash: evidenceBundle.bundleHash,
    rubricId: input.rubricId,
    rubricVersion: input.rubricVersion,
    rubricHash,
    dimensions,
    requiredEvaluatorKinds: [
      "rule",
      "evidence_sufficiency",
      "work_quality",
      "professional_collaboration",
    ] as EvaluationEvaluatorKind[],
    definitionVersion: evaluationCaseDefinitionVersion,
    openedFromMessageId: input.openedFromMessageId,
    openedAt: input.now,
  };
  const evaluationCase = EvaluationCaseSchema.parse({
    ...caseBase,
    caseHash: hashValue(caseBase),
  });
  return { evidenceBundle, evaluationCase };
}

function criterionEvidenceRefs(
  criterion: RubricCriterion,
  evidence: readonly Evidence[],
  events: readonly WorldEvent[],
): string[] {
  const evaluation = criterion.evaluation;
  if (evaluation.kind === "evidence_action") {
    const matched = evidence
      .filter((item) => item.action.includes(evaluation.action))
      .map((item) => item.evidenceId);
    return uniqueSorted(matched.length > 0 ? matched : evidence.map((item) => item.evidenceId));
  }
  if (evaluation.kind === "event_exists") {
    const matchingEventIds = new Set(
      events
        .filter((event) => event.eventType === evaluation.eventType)
        .map((event) => event.eventId),
    );
    const matched = evidence
      .filter((item) => item.eventRefs.some((eventId) => matchingEventIds.has(eventId)))
      .map((item) => item.evidenceId);
    return uniqueSorted(matched.length > 0 ? matched : evidence.map((item) => item.evidenceId));
  }
  return uniqueSorted(evidence.map((item) => item.evidenceId));
}

export function createRuleEvaluationProposal(input: {
  nextId: (prefix: string) => string;
  now: string;
  evaluationCase: EvaluationCase;
  evidenceBundle: EvaluationEvidenceBundle;
  rubric: readonly RubricCriterion[];
  evidence: readonly Evidence[];
  events: readonly WorldEvent[];
}): EvaluationProposal {
  const bundledEvidenceIds = new Set(
    input.evidenceBundle.evidenceRefs.map((item) => item.evidenceId),
  );
  const evidence = input.evidence.filter((item) => bundledEvidenceIds.has(item.evidenceId));
  const dimensions: EvaluationDimensionProposal[] = input.rubric.map((criterion) => {
    const maximum = roundScore(criterion.weight * 100);
    const evaluation = criterion.evaluation;
    const achieved = evaluation.kind === "evidence_action"
      ? evidence.some((item) => item.action.includes(evaluation.action))
      : evaluation.kind === "event_exists"
        ? input.events.some((event) => event.eventType === evaluation.eventType)
        : evidence.length >= evaluation.minimum;
    const rawScore = evaluation.kind === "evidence_count" && !achieved
      ? maximum * Math.min(1, evidence.length / evaluation.minimum)
      : achieved ? maximum : 0;
    const scoreSuggestion = roundScore(rawScore);
    return {
      dimensionId: criterion.criterionId,
      scoreSuggestion,
      maxScore: maximum,
      reason: achieved
        ? `确定性规则已命中：${criterion.rule}`
        : `确定性规则未完全命中：${criterion.rule}`,
      evidenceRefs: criterionEvidenceRefs(criterion, evidence, input.events),
      confidence: 1,
      riskFlags: achieved ? [] : ["rule_not_fully_satisfied"],
    };
  });
  const executionInput = {
    caseHash: input.evaluationCase.caseHash,
    bundleHash: input.evidenceBundle.bundleHash,
    rubricHash: input.evaluationCase.rubricHash,
    rulesetVersion: evaluationRulesetVersion,
  };
  const proposalBase = {
    schemaVersion: "evaluation/1.0.0" as const,
    proposalId: input.nextId("evaluation-proposal-rule"),
    evaluationCaseId: input.evaluationCase.evaluationCaseId,
    caseHash: input.evaluationCase.caseHash,
    evidenceBundleHash: input.evidenceBundle.bundleHash,
    evaluatorKind: "rule" as const,
    status: "completed" as const,
    dimensions,
    overallConfidence: 1,
    errorCode: null,
    execution: {
      agentRunId: null,
      definitionVersion: evaluationRulesetVersion,
      promptVersion: null,
      rulesetVersion: evaluationRulesetVersion,
      provider: null,
      providerMode: null,
      model: null,
      providerRequestId: null,
      inputHash: hashValue(executionInput),
      outputHash: hashValue(dimensions),
    },
    createdAt: input.now,
  };
  return EvaluationProposalSchema.parse({
    ...proposalBase,
    proposalHash: hashValue(proposalBase),
  });
}

export function createSemanticEvaluationProposal(input: {
  nextId: (prefix: string) => string;
  now: string;
  evaluationCase: EvaluationCase;
  evidenceBundle: EvaluationEvidenceBundle;
  evaluatorKind: Exclude<EvaluationEvaluatorKind, "rule">;
  status: "completed" | "unavailable";
  dimensions: readonly EvaluationDimensionProposal[];
  errorCode: string | null;
  trace: AgentRunTrace;
}): EvaluationProposal {
  const allowedEvidenceRefs = new Set(
    input.evidenceBundle.evidenceRefs.map((item) => item.evidenceId),
  );
  const expectedDimensions = new Map(
    input.evaluationCase.dimensions.map((item) => [item.dimensionId, item]),
  );
  if (input.status === "completed") {
    if (input.dimensions.length !== input.evaluationCase.dimensions.length) {
      throw new Error("语义评价必须逐一覆盖案件中的全部量规维度");
    }
    if (new Set(input.dimensions.map((item) => item.dimensionId)).size !== input.dimensions.length) {
      throw new Error("语义评价包含重复量规维度");
    }
    for (const dimension of input.dimensions) {
      const expected = expectedDimensions.get(dimension.dimensionId);
      if (!expected) throw new Error(`语义评价引用未知量规维度：${dimension.dimensionId}`);
      if (
        dimension.maxScore !== expected.maxScore
        || dimension.scoreSuggestion > expected.maxScore
      ) {
        throw new Error(`语义评价分数超出维度上限：${dimension.dimensionId}`);
      }
      for (const evidenceRef of dimension.evidenceRefs) {
        if (!allowedEvidenceRefs.has(evidenceRef)) {
          throw new Error(`语义评价引用证据包之外的证据：${evidenceRef}`);
        }
      }
    }
  } else if (input.dimensions.length > 0) {
    throw new Error("不可用语义评价不得携带分数");
  }
  const modelTrace = input.trace.modelInvocations.at(-1) ?? null;
  const dimensions = input.status === "completed"
    ? input.dimensions.map((item) => ({
        ...item,
        evidenceRefs: uniqueSorted(item.evidenceRefs),
        riskFlags: uniqueSorted(item.riskFlags),
      }))
    : [];
  const overallConfidence = dimensions.length > 0
    ? roundScore(
        dimensions.reduce((total, item) => total + item.confidence, 0)
        / dimensions.length,
      )
    : 0;
  const proposalBase = {
    schemaVersion: "evaluation/1.0.0" as const,
    proposalId: input.nextId(`evaluation-proposal-${input.evaluatorKind}`),
    evaluationCaseId: input.evaluationCase.evaluationCaseId,
    caseHash: input.evaluationCase.caseHash,
    evidenceBundleHash: input.evidenceBundle.bundleHash,
    evaluatorKind: input.evaluatorKind,
    status: input.status,
    dimensions,
    overallConfidence,
    errorCode: input.status === "unavailable"
      ? input.errorCode ?? "evaluation_model_unavailable"
      : null,
    execution: {
      agentRunId: input.trace.agentRunId,
      definitionVersion: input.trace.definitionVersion,
      promptVersion: input.trace.promptVersion,
      rulesetVersion: null,
      provider: modelTrace?.provider ?? null,
      providerMode: modelTrace?.mode ?? null,
      model: modelTrace?.model ?? null,
      providerRequestId: modelTrace?.requestId ?? null,
      inputHash: input.trace.promptHash
        ?? input.trace.contextManifest?.contextHash
        ?? hashValue({
          caseHash: input.evaluationCase.caseHash,
          evaluatorKind: input.evaluatorKind,
        }),
      outputHash: hashValue({
        status: input.status,
        dimensions,
        errorCode: input.errorCode,
      }),
    },
    createdAt: input.now,
  };
  return EvaluationProposalSchema.parse({
    ...proposalBase,
    proposalHash: hashValue(proposalBase),
  });
}

export function createUnavailableEvaluationProposal(input: {
  nextId: (prefix: string) => string;
  now: string;
  evaluationCase: EvaluationCase;
  evidenceBundle: EvaluationEvidenceBundle;
  evaluatorKind: Exclude<EvaluationEvaluatorKind, "rule">;
  definitionVersion: string;
  promptVersion: string;
  errorCode: string;
}): EvaluationProposal {
  const proposalBase = {
    schemaVersion: "evaluation/1.0.0" as const,
    proposalId: input.nextId(`evaluation-proposal-${input.evaluatorKind}`),
    evaluationCaseId: input.evaluationCase.evaluationCaseId,
    caseHash: input.evaluationCase.caseHash,
    evidenceBundleHash: input.evidenceBundle.bundleHash,
    evaluatorKind: input.evaluatorKind,
    status: "unavailable" as const,
    dimensions: [],
    overallConfidence: 0,
    errorCode: input.errorCode,
    execution: {
      agentRunId: null,
      definitionVersion: input.definitionVersion,
      promptVersion: input.promptVersion,
      rulesetVersion: null,
      provider: null,
      providerMode: null,
      model: null,
      providerRequestId: null,
      inputHash: hashValue({
        caseHash: input.evaluationCase.caseHash,
        evaluatorKind: input.evaluatorKind,
      }),
      outputHash: hashValue({
        status: "unavailable",
        errorCode: input.errorCode,
      }),
    },
    createdAt: input.now,
  };
  return EvaluationProposalSchema.parse({
    ...proposalBase,
    proposalHash: hashValue(proposalBase),
  });
}

function latestProposalByEvaluator(
  proposals: readonly EvaluationProposal[],
): Map<EvaluationEvaluatorKind, EvaluationProposal> {
  // Proposal order is event-log order. A manual retry appends a new immutable
  // proposal and must supersede the prior unavailable proposal even when a
  // deterministic test clock gives both records the same timestamp.
  return new Map(
    proposals.map((proposal) => [proposal.evaluatorKind, proposal]),
  );
}

export function arbitrateEvaluationProposals(input: {
  nextId: (prefix: string) => string;
  now: string;
  evaluationCase: EvaluationCase;
  proposals: readonly EvaluationProposal[];
  previousRevision?: number;
}): EvaluationArbitration {
  const current = latestProposalByEvaluator(
    input.proposals.filter((proposal) => (
      proposal.evaluationCaseId === input.evaluationCase.evaluationCaseId
      && proposal.caseHash === input.evaluationCase.caseHash
    )),
  );
  const selected = input.evaluationCase.requiredEvaluatorKinds
    .map((kind) => current.get(kind))
    .filter((proposal): proposal is EvaluationProposal => Boolean(proposal));
  if (selected.length === 0) {
    throw new Error("评价仲裁至少需要一条已记录意见");
  }
  const completedEvaluatorKinds = selected
    .filter((proposal) => proposal.status === "completed")
    .map((proposal) => proposal.evaluatorKind);
  const unavailableEvaluatorKinds = selected
    .filter((proposal) => proposal.status === "unavailable")
    .map((proposal) => proposal.evaluatorKind);
  const recommendations = input.evaluationCase.dimensions.map((dimension) => {
    const scored = selected.flatMap((proposal) => {
      if (proposal.status !== "completed") return [];
      const suggestion = proposal.dimensions.find(
        (item) => item.dimensionId === dimension.dimensionId,
      );
      return suggestion ? [{ proposal, suggestion }] : [];
    });
    if (scored.length === 0) {
      throw new Error(`评价维度没有任何可用意见：${dimension.dimensionId}`);
    }
    const totalWeight = scored.reduce(
      (total, item) => total + evaluatorWeights[item.proposal.evaluatorKind],
      0,
    );
    const suggestedScore = roundScore(
      scored.reduce((total, item) => (
        total
        + item.suggestion.scoreSuggestion
          * evaluatorWeights[item.proposal.evaluatorKind]
      ), 0) / totalWeight,
    );
    const scores = scored.map((item) => item.suggestion.scoreSuggestion);
    return {
      dimensionId: dimension.dimensionId,
      suggestedScore: Math.min(dimension.maxScore, suggestedScore),
      maxScore: dimension.maxScore,
      spread: roundScore(Math.max(...scores) - Math.min(...scores)),
      sourceProposalIds: scored
        .map((item) => item.proposal.proposalId)
        .sort((left, right) => left.localeCompare(right)),
      availableEvaluatorKinds: scored.map((item) => item.proposal.evaluatorKind),
      evidenceRefs: uniqueSorted(
        scored.flatMap((item) => item.suggestion.evidenceRefs),
      ),
    };
  });
  const disputes = recommendations.flatMap((recommendation) => {
    const result: Array<{
      disputeId: string;
      dimensionId: string;
      code: "score_spread" | "low_confidence" | "evaluator_unavailable";
      severity: "warning" | "critical";
      delta: number;
      threshold: number;
      proposalIds: string[];
      summary: string;
    }> = [];
    const threshold = roundScore(
      recommendation.maxScore * evaluationDisputeThresholdRatio,
    );
    if (recommendation.spread >= threshold && threshold > 0) {
      result.push({
        disputeId: `dispute:${input.evaluationCase.evaluationCaseId}:${recommendation.dimensionId}:spread`,
        dimensionId: recommendation.dimensionId,
        code: "score_spread",
        severity: recommendation.spread >= threshold * 2 ? "critical" : "warning",
        delta: recommendation.spread,
        threshold,
        proposalIds: recommendation.sourceProposalIds,
        summary: `评价意见最大分差 ${recommendation.spread}，达到复核阈值 ${threshold}`,
      });
    }
    const lowConfidence = selected.filter((proposal) => (
      proposal.status === "completed"
      && proposal.dimensions.some((item) => (
        item.dimensionId === recommendation.dimensionId && item.confidence < 0.6
      ))
    ));
    if (lowConfidence.length > 0) {
      result.push({
        disputeId: `dispute:${input.evaluationCase.evaluationCaseId}:${recommendation.dimensionId}:confidence`,
        dimensionId: recommendation.dimensionId,
        code: "low_confidence",
        severity: "warning",
        delta: 0,
        threshold: 0.6,
        proposalIds: lowConfidence.map((proposal) => proposal.proposalId),
        summary: "至少一个评价节点置信度低于 0.6，必须由教师明确判断",
      });
    }
    if (unavailableEvaluatorKinds.length > 0) {
      result.push({
        disputeId: `dispute:${input.evaluationCase.evaluationCaseId}:${recommendation.dimensionId}:unavailable`,
        dimensionId: recommendation.dimensionId,
        code: "evaluator_unavailable",
        severity: "critical",
        delta: unavailableEvaluatorKinds.length,
        threshold: 0,
        proposalIds: selected
          .filter((proposal) => proposal.status === "unavailable")
          .map((proposal) => proposal.proposalId),
        summary: `评价节点不可用：${unavailableEvaluatorKinds.join("、")}`,
      });
    }
    return result;
  });
  const allTerminal = selected.length === input.evaluationCase.requiredEvaluatorKinds.length;
  const status = !allTerminal
    ? "collecting" as const
    : unavailableEvaluatorKinds.length > 0
      ? "degraded" as const
      : disputes.length > 0
        ? "disputed" as const
        : "ready_for_teacher" as const;
  const proposalIds = selected
    .map((proposal) => proposal.proposalId)
    .sort((left, right) => left.localeCompare(right));
  const proposalSetHash = hashValue(
    selected.map((proposal) => proposal.proposalHash).sort(),
  );
  const decision = {
    evaluationCaseId: input.evaluationCase.evaluationCaseId,
    caseHash: input.evaluationCase.caseHash,
    status,
    proposalSetHash,
    recommendations,
    disputes,
    completedEvaluatorKinds,
    unavailableEvaluatorKinds,
    arbitratorVersion: evaluationArbitratorVersion,
  };
  return EvaluationArbitrationSchema.parse({
    schemaVersion: "evaluation/1.0.0",
    arbitrationId: input.nextId("evaluation-arbitration"),
    evaluationCaseId: input.evaluationCase.evaluationCaseId,
    revision: (input.previousRevision ?? 0) + 1,
    status,
    requiredEvaluatorKinds: input.evaluationCase.requiredEvaluatorKinds,
    completedEvaluatorKinds,
    unavailableEvaluatorKinds,
    proposalIds,
    proposalSetHash,
    recommendations,
    disputes,
    decisionHash: hashValue(decision),
    arbitratorVersion: evaluationArbitratorVersion,
    createdAt: input.now,
  });
}
