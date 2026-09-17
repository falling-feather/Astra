import { describe, expect, it } from "vitest";
import {
  AgentRunTraceSchema,
  AgentSubscriptionSchema,
  EvaluationArbitrationSchema,
  EvaluationCaseSchema,
  EvaluationSchemaVersion,
  SchemaVersion,
  TeacherAssessmentReviewSchema,
  WorldEventSchema,
} from "@ronggang/contracts";
import { hashValue } from "@ronggang/context-engine";
import {
  AgentScheduler,
  aggregateGoldAblationObservations,
  buildGoldContractModelRequestForTest,
  createGoldAblationProtocol,
  createAgentArchitectureProfile,
  createGoldCapabilityEvidenceMatrix,
  createGoldDeidentifiedEvaluationExport,
  deriveRuntimeGoldObservations,
  runGoldContractReplay,
} from "../src/index.js";

const generatedAt = "2026-07-29T08:00:00.000Z";
const scenarioContentHash = hashValue({
  scenario: "flagship",
  version: "1.1.0",
});

function protocol() {
  return createGoldAblationProtocol({
    scenarioReleaseRef: "release:flagship@1.1.0",
    scenarioContentHash,
  });
}

describe("gold-readiness evidence laboratory", () => {
  it("fixes one complete capability-behavior-evidence chain per domain", () => {
    const matrix = createGoldCapabilityEvidenceMatrix();

    expect(matrix.rows).toHaveLength(6);
    expect(new Set(matrix.rows.map((row) => row.domain)).size).toBe(6);
    expect(matrix.rows.every((row) => (
      row.observableBehaviors.length > 0
      && row.evidenceKinds.length > 0
      && row.deterministicRuleRefs.length > 0
      && row.semanticEvaluatorKinds.length > 0
      && row.teacherReviewRequired
      && row.primaryTemplateIds.length > 0
    ))).toBe(true);
  });

  it("keeps the A/B/C observation label out of the deterministic model payload", () => {
    const experiment = protocol();
    const requests = experiment.profiles.map((profile) => (
      buildGoldContractModelRequestForTest({
        conditionCode: profile.conditionCode,
        domain: "governance_publication",
      })
    ));

    expect(experiment.profiles.map((profile) => profile.conditionCode))
      .toEqual(["A", "B", "C"]);
    expect(new Set(
      experiment.profiles.map((profile) => profile.policyHash),
    ).size).toBe(3);
    expect(experiment.profiles.map((profile) => ({
      conditionCode: profile.conditionCode,
      worldWriteGate: profile.worldWriteGate,
    }))).toEqual([
      { conditionCode: "A", worldWriteGate: "authoritative" },
      { conditionCode: "B", worldWriteGate: "none" },
      { conditionCode: "C", worldWriteGate: "authoritative" },
    ]);
    expect(new Set(
      experiment.profiles.map(() => experiment.controlVariablesHash),
    ).size).toBe(1);
    for (const request of requests) {
      const serialized = JSON.stringify(request);
      expect(serialized).not.toContain(experiment.experimentId);
      expect(serialized).not.toContain("runBatchId");
      expect(serialized).not.toContain("conditionCode");
      expect(serialized).not.toContain("controlVariablesHash");
    }
  });

  it("replays ten runs per group, retains the same failure, and closes engineering gates", () => {
    const report = runGoldContractReplay({
      protocol: protocol(),
      generatedAt,
    });

    expect(report.observations).toHaveLength(30);
    expect(report.groups.map((group) => ({
      condition: group.conditionCode,
      runs: group.runCount,
      failures: group.failedCount,
    }))).toEqual([
      { condition: "A", runs: 10, failures: 1 },
      { condition: "B", runs: 10, failures: 1 },
      { condition: "C", runs: 10, failures: 1 },
    ]);
    const failed = report.observations.filter(
      (observation) => observation.status === "failed",
    );
    expect(failed).toHaveLength(3);
    expect(failed.every((observation) => (
      observation.errorCode === "deterministic_provider_unavailable"
      && observation.teacherScores.suggestedScore === null
      && observation.teacherScores.finalScore === null
      && observation.teacherScores.absoluteDelta === null
      && observation.performance.tokenUsage === null
      && observation.performance.estimatedCostUsd === null
    ))).toBe(true);

    const cGroup = report.groups.find((group) => group.conditionCode === "C");
    const aGroup = report.groups.find((group) => group.conditionCode === "A");
    expect(aGroup?.rates.unrelatedModelCall.value).toBe(0);
    expect(aGroup?.rates.unauthorizedFormalWriteCommit.numerator).toBe(0);
    expect(aGroup?.rates.authoritativeFactConflictCommit.numerator).toBe(0);
    expect(cGroup?.rates.privateReferenceLeakage.numerator).toBe(0);
    expect(cGroup?.rates.unauthorizedFormalWriteCommit.numerator).toBe(0);
    expect(cGroup?.rates.authoritativeFactConflictCommit.numerator).toBe(0);
    expect(cGroup?.rates.evidenceCoverage.value).toBe(1);
    expect(cGroup?.rates.unrelatedModelCall.value).toBe(0);
    expect(report.strictCoreImprovementCount).toBe(3);
    expect(report.gates.every((gate) => gate.status === "passed")).toBe(true);
    expect(report.conclusion).toBe("engineering_contract_passed");
  });

  it("exports teacher scoring without identities, notes, prompts, or raw evidence ids", () => {
    const caseHash = hashValue({ case: "case-1" });
    const evidenceBundleHash = hashValue({ bundle: "bundle-1" });
    const rubricHash = hashValue({ rubric: "rubric-1" });
    const proposalSetHash = hashValue({ proposals: ["proposal-1"] });
    const decisionHash = hashValue({ arbitration: "arbitration-1" });
    const evaluationCase = EvaluationCaseSchema.parse({
      schemaVersion: EvaluationSchemaVersion,
      evaluationCaseId: "evaluation-case-sensitive",
      caseRevision: 1,
      caseHash,
      sessionEpoch: "epoch-sensitive",
      submissionId: "submission-sensitive",
      artifactId: "artifact-sensitive",
      revisionId: "revision-sensitive",
      evidenceBundleId: "bundle-sensitive",
      evidenceBundleHash,
      rubricId: "rubric-professional",
      rubricVersion: "1.0.0",
      rubricHash,
      dimensions: [{
        dimensionId: "fact-quality",
        label: "事实质量",
        weight: 1,
        maxScore: 100,
        rule: "事实必须有证据",
        evaluationKind: "evidence_count",
      }],
      requiredEvaluatorKinds: [
        "rule",
        "evidence_sufficiency",
        "work_quality",
        "professional_collaboration",
      ],
      definitionVersion: "evaluation-case/1.0.0",
      openedFromMessageId: "message-sensitive",
      openedAt: generatedAt,
    });
    const arbitration = EvaluationArbitrationSchema.parse({
      schemaVersion: EvaluationSchemaVersion,
      arbitrationId: "arbitration-sensitive",
      evaluationCaseId: evaluationCase.evaluationCaseId,
      revision: 1,
      status: "ready_for_teacher",
      requiredEvaluatorKinds: evaluationCase.requiredEvaluatorKinds,
      completedEvaluatorKinds: evaluationCase.requiredEvaluatorKinds,
      unavailableEvaluatorKinds: [],
      proposalIds: ["proposal-sensitive"],
      proposalSetHash,
      recommendations: [{
        dimensionId: "fact-quality",
        suggestedScore: 82,
        maxScore: 100,
        spread: 4,
        sourceProposalIds: ["proposal-sensitive"],
        availableEvaluatorKinds: evaluationCase.requiredEvaluatorKinds,
        evidenceRefs: ["evidence-sensitive"],
      }],
      disputes: [],
      decisionHash,
      arbitratorVersion: "evaluation-arbitrator/1.0.0",
      createdAt: generatedAt,
    });
    const reviewWithoutHash = {
      schemaVersion: EvaluationSchemaVersion,
      reviewId: "review-sensitive",
      evaluationCaseId: evaluationCase.evaluationCaseId,
      arbitrationId: arbitration.arbitrationId,
      arbitrationRevision: arbitration.revision,
      decisionHash,
      evidenceBundleHash,
      dimensions: [{
        dimensionId: "fact-quality",
        finalScore: 85,
        publicFeedback: "敏感公开反馈",
        overrideReason: "敏感修订原因",
        proposedScore: 82,
        maxScore: 100,
        delta: 3,
        evidenceRefs: ["evidence-sensitive"],
      }],
      finalScore: 85,
      publicSummary: "敏感总结",
      internalNote: "教师私密备注",
      reviewedBy: "teacher-sensitive",
      reviewedAt: generatedAt,
      requestId: "request-sensitive",
    };
    const teacherReview = TeacherAssessmentReviewSchema.parse({
      ...reviewWithoutHash,
      finalHash: hashValue(reviewWithoutHash),
    });

    const exported = createGoldDeidentifiedEvaluationExport({
      generatedAt,
      evaluationCases: [evaluationCase],
      evaluationArbitrations: [arbitration],
      teacherReviews: [teacherReview],
    });
    const serialized = JSON.stringify(exported);

    expect(exported.cases).toHaveLength(1);
    expect(exported.cases[0]?.teacherFinalScore).toBe(85);
    expect(exported.cases[0]?.teacherEditedDimensions).toBe(1);
    expect(exported.cases[0]?.dimensions[0]?.suggestedScore).toBe(82);
    expect(exported.cases[0]?.dimensions[0]?.absoluteDelta).toBe(3);
    expect(serialized).not.toContain("teacher-sensitive");
    expect(serialized).not.toContain("epoch-sensitive");
    expect(serialized).not.toContain("submission-sensitive");
    expect(serialized).not.toContain("evidence-sensitive");
    expect(serialized).not.toContain("教师私密备注");
    expect(serialized).not.toContain("敏感公开反馈");
    expect(serialized).not.toContain("systemPrompt");
    expect(serialized).not.toContain("userPrompt");
  });

  it("keeps absent runtime semantics unavailable instead of inferring a pass", () => {
    const experiment = protocol();
    const profile = createAgentArchitectureProfile({
      profileId: "runtime-test/A",
      profileVersion: "1.0.0",
      enabledTemplateIds: ["runtime/generalist"],
      disabledTemplateIds: [],
    });
    const observationRef = {
      schemaVersion: "experiment-observation/1.0.0" as const,
      experimentId: experiment.experimentId,
      condition: "single_generalist" as const,
      runBatchId: "runtime-batch-1",
      caseId: "runtime-case-without-evaluation",
      repetition: 1,
      controlVariablesHash: experiment.controlVariablesHash,
    };
    const scheduler = new AgentScheduler([
      AgentSubscriptionSchema.parse({
        subscriptionId: "runtime/generalist/session-started",
        agentId: "runtime-generalist",
        roleId: "fact_checker",
        templateRef: {
          templateId: "runtime/generalist",
          templateVersion: "1.0.0",
        },
        definitionVersion: "runtime-generalist/1.0.0",
        promptVersion: "1.0.0",
        eventTypes: ["session_started"],
        targetActorIdField: null,
        maxCausalDepth: 2,
        priority: 10,
        enabled: true,
      }),
    ]);
    let taskSequence = 0;
    const plan = scheduler.createDispatchPlan({
      event: WorldEventSchema.parse({
        kind: "WorldEvent",
        sessionId: "session-runtime-gold",
        sceneId: "scene-runtime-gold",
        actorId: "system",
        messageId: "message-runtime-gold",
        correlationId: "correlation-runtime-gold",
        timestamp: generatedAt,
        schemaVersion: SchemaVersion,
        eventId: "event-runtime-gold",
        eventType: "session_started",
        stateVersion: 1,
        visibility: ["audit_only"],
        visibleToActorIds: [],
        summary: "启动受控运行",
        payload: {},
      }),
      outboxId: "outbox-runtime-gold",
      sessionEpoch: "epoch-runtime-gold",
      causalDepth: 0,
      expectedStateVersion: 1,
      createdAt: generatedAt,
      architectureProfile: profile,
      experimentObservation: observationRef,
      nextTaskId: () => `task-runtime-gold-${++taskSequence}`,
    });
    const task = plan.tasks[0];
    if (!task) throw new Error("运行时观测测试没有调度任务");
    const run = AgentRunTraceSchema.parse({
      taskId: task.taskId,
      agentRunId: "run-runtime-gold",
      correlationId: task.correlationId,
      agentId: task.agentId,
      roleId: task.roleId,
      templateRef: task.templateRef,
      instanceRef: task.instanceRef,
      experimentObservation: observationRef,
      dispatchDecision: task.dispatchDecision,
      definitionVersion: task.definitionVersion,
      promptVersion: task.promptVersion,
      inputStateVersion: task.expectedStateVersion,
      triggerRefs: [task.triggerEventId],
      contextManifest: null,
      promptHash: null,
      status: "completed",
      nodes: [{
        nodeId: "done",
        kind: "terminal",
        status: "success",
        startedAt: generatedAt,
        completedAt: generatedAt,
        durationMs: 0,
        selectedEdgeId: null,
        errorCode: null,
      }],
      modelCalls: 1,
      modelInvocations: [],
      toolCalls: 0,
      tokenUsage: { input: 10, output: 5 },
      fallbackUsed: false,
      errorCode: null,
      startedAt: generatedAt,
      completedAt: generatedAt,
      durationMs: 4,
    });

    const observations = deriveRuntimeGoldObservations({
      plans: [plan],
      runs: [run],
      evaluationCases: [],
      evaluationProposals: [],
      evaluationArbitrations: [],
      teacherReviews: [],
    });
    expect(observations).toHaveLength(1);
    expect(observations[0]?.counts.requiredEvidenceItems).toBeNull();
    expect(observations[0]?.counts.unauthorizedFormalWritesCommitted)
      .toBeNull();
    expect(observations[0]?.teacherScores.suggestedScore).toBeNull();
    expect(observations[0]?.teacherScores.finalScore).toBeNull();

    const report = aggregateGoldAblationObservations({
      protocol: {
        ...experiment,
        evidenceLevel: "controlled_runtime",
      },
      observations,
      generatedAt,
    });
    expect(report.conclusion).toBe("insufficient_evidence");
    expect(report.gates.some((gate) => gate.status === "insufficient"))
      .toBe(true);
  });
});
