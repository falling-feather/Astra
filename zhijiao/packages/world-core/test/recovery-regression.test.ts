import { describe, expect, it } from "vitest";
import {
  AgentRunResultSchema,
  AgentTaskSchema,
  WorldEventSchema,
  createMessageMeta,
  type AgentRunResult,
  type AgentTask,
  type ArtifactRevision,
  type Assessment,
  type Command,
  type CommandName,
  type Evidence,
  type ExecutableAgentIntent,
  type OutboxRecord,
  type ProductionSubmission,
  type TeacherAssessmentReview,
  type WorldEvent,
} from "@ronggang/contracts";
import {
  InMemoryEventStore,
  InProcessMessageBus,
  WorldEngine,
  arbitrateEvaluationProposals,
  createEvaluationCase,
  createRuleEvaluationProposal,
  createUnavailableEvaluationProposal,
} from "../src/index.js";

const now = "2026-07-26T01:00:00.000Z";
const hash = (character: string) => character.repeat(64);

function sequenceIds() {
  let value = 0;
  return { next: (prefix: string) => `${prefix}-recovery-${++value}` };
}

function fixedClock() {
  let millisecond = 0;
  const base = Date.parse(now);
  return {
    now: () => new Date(base + millisecond++).toISOString(),
  };
}

function command(
  sessionId: string,
  actorId: string,
  name: CommandName,
  version: number,
  payload: Record<string, unknown>,
): Command {
  return {
    ...createMessageMeta({
      sessionId,
      sceneId: "scenario-local-tourism-media-v0.1",
      actorId,
      correlationId: `test-${name}`,
      timestamp: now,
    }),
    kind: "Command",
    name,
    expectedStateVersion: version,
    payload,
  };
}

async function appendFixtureEvents(input: {
  store: InMemoryEventStore;
  sessionId: string;
  sessionEpoch: string;
  stateVersion: number;
  sceneId: string;
  drafts: Array<{
    eventId?: string;
    eventType: WorldEvent["eventType"];
    actorId: string;
    summary: string;
    visibility: WorldEvent["visibility"];
    visibleToActorIds?: string[];
    payload: Record<string, unknown>;
  }>;
}): Promise<WorldEvent[]> {
  const events = input.drafts.map((draft, index) => WorldEventSchema.parse({
    ...createMessageMeta({
      sessionId: input.sessionId,
      sceneId: input.sceneId,
      actorId: draft.actorId,
      correlationId: "fixture-recovery-regression",
      timestamp: new Date(
        Date.parse(now) + (index + 1) * 1_000,
      ).toISOString(),
    }),
    kind: "WorldEvent",
    eventId: draft.eventId
      ?? `event-recovery-fixture-${input.stateVersion}-${index + 1}`,
    eventType: draft.eventType,
    stateVersion: input.stateVersion + index + 1,
    visibility: draft.visibility,
    visibleToActorIds: draft.visibleToActorIds ?? [],
    summary: draft.summary,
    payload: draft.payload,
  }));
  const outbox = events.map<OutboxRecord>((event, index) => ({
    outboxId: `outbox-recovery-fixture-${input.stateVersion}-${index + 1}`,
    sessionId: input.sessionId,
    sessionEpoch: input.sessionEpoch,
    sceneId: event.sceneId,
    eventId: event.eventId,
    eventType: event.eventType,
    stateVersion: event.stateVersion,
    correlationId: event.correlationId,
    topic: "world_event",
    causalDepth: 0,
    status: "pending",
    attempts: 0,
    availableAt: event.timestamp,
    createdAt: event.timestamp,
    deliveredAt: null,
    lastErrorCode: null,
  }));
  await input.store.append(
    input.sessionId,
    input.stateVersion,
    events,
    outbox,
  );
  return events;
}

async function seedEvaluationRecoveryFixture(sessionId: string) {
  const store = new InMemoryEventStore();
  const ids = sequenceIds();
  const engine = new WorldEngine({
    store,
    bus: new InProcessMessageBus(),
    ids,
    clock: fixedClock(),
  });
  await engine.createSession(sessionId, true);
  const state = await engine.getStateSnapshot(sessionId);
  const teacher = await engine.getProjection(sessionId, "teacher-main");
  const history = await store.load(sessionId);
  let fixtureId = 0;
  const nextFixtureId = (prefix: string) => (
    `${prefix}-fixture-${++fixtureId}`
  );
  const evidence: Evidence = {
    evidenceId: "evidence-recovery-fixture",
    sessionId,
    nodeId: "review",
    actorId: "student-editor",
    action: "完成精确成果提交",
    basis: "成果修订、岗位交接和来源链已经固定。",
    materialRefs: ["material-festival-photo"],
    eventRefs: [history.at(-1)!.eventId],
    observationRefs: [],
    artifactRevisionRefs: ["revision-recovery-fixture"],
    processingTaskRefs: [],
    createdAt: now,
    visibility: ["assigned_team", "audit_only"],
  };
  const revision: ArtifactRevision = {
    revisionId: "revision-recovery-fixture",
    artifactId: "artifact-recovery-fixture",
    revisionNumber: 2,
    previousRevisionId: "revision-recovery-fixture-r1",
    title: "地方文旅活动融媒体报道",
    summary: "用于验证 V0.7 评价和学习恢复链路。",
    sections: [{
      sectionId: "lead",
      label: "导语",
      content: "经核验后的报道正文。",
    }],
    citations: [],
    revisionNote: "固定 R2 评价修订。",
    contentHash: hash("a"),
    authorActorId: "student-editor",
    requestId: "revision-recovery-request",
    createdAt: now,
    audience: {
      policyVersion: "acl/1.0.0",
      courseId: state.scenario.courseId,
      sessionId,
      sessionEpoch: state.sessionEpoch,
      scopes: ["assigned_team"],
      teamIds: ["team-jiangnan-01"],
      roleIds: ["responsible_editor"],
      actorIds: ["student-editor"],
      privateNamespaces: [],
      auditReadable: true,
    },
  };
  const submission: ProductionSubmission = {
    submissionId: "submission-recovery-fixture",
    artifactId: revision.artifactId,
    revisionId: revision.revisionId,
    revisionNumber: revision.revisionNumber,
    evidenceRefs: [evidence.evidenceId],
    citationIds: [],
    submittedBy: "student-editor",
    requestId: "submission-recovery-request",
    submittedAt: now,
  };
  const { evidenceBundle, evaluationCase } = createEvaluationCase({
    nextId: nextFixtureId,
    now,
    sessionEpoch: state.sessionEpoch,
    openedFromMessageId: "message-recovery-fixture",
    submission,
    revision,
    rubricId: state.scenario.rubricId,
    rubricVersion: state.scenario.rubricVersion,
    rubric: state.scenario.rubric,
    evidence: [evidence],
    events: history,
    scenarioReleaseId: teacher.scenario.releaseId,
    scenarioContentHash: teacher.scenario.contentHash,
  });
  const ruleProposal = createRuleEvaluationProposal({
    nextId: nextFixtureId,
    now,
    evaluationCase,
    evidenceBundle,
    rubric: state.scenario.rubric,
    evidence: [evidence],
    events: history,
  });
  const unavailableProposal = createUnavailableEvaluationProposal({
    nextId: nextFixtureId,
    now,
    evaluationCase,
    evidenceBundle,
    evaluatorKind: "work_quality",
    definitionVersion: "evaluation-semantic/1.0.5",
    promptVersion: "evaluation-semantic/1.0.2",
    errorCode: "provider_timeout",
  });
  const arbitration = arbitrateEvaluationProposals({
    nextId: nextFixtureId,
    now,
    evaluationCase,
    proposals: [ruleProposal, unavailableProposal],
  });
  await appendFixtureEvents({
    store,
    sessionId,
    sessionEpoch: state.sessionEpoch,
    stateVersion: state.stateVersion,
    sceneId: state.scenario.scenarioId,
    drafts: [
      {
        eventType: "evidence_recorded",
        actorId: "student-editor",
        summary: "测试证据已固定",
        visibility: ["assigned_team", "audit_only"],
        payload: { evidence },
      },
      {
        eventType: "evaluation_case_opened",
        actorId: "system",
        summary: "测试固定评价案件",
        visibility: ["role_private", "audit_only"],
        visibleToActorIds: ["agent-work-quality-assessor"],
        payload: { evaluationCase, evidenceBundle },
      },
      {
        eventType: "evaluation_proposal_recorded",
        actorId: "system",
        summary: "测试规则意见",
        visibility: ["teacher_only", "audit_only"],
        payload: { proposal: ruleProposal },
      },
      {
        eventType: "evaluation_proposal_recorded",
        actorId: "agent-work-quality-assessor",
        summary: "测试不可用意见",
        visibility: ["teacher_only", "audit_only"],
        payload: { proposal: unavailableProposal },
      },
      {
        eventType: "evaluation_arbitrated",
        actorId: "system",
        summary: "测试降级仲裁",
        visibility: ["teacher_only", "audit_only"],
        payload: { arbitration },
      },
    ],
  });
  return {
    engine,
    store,
    evidence,
    evaluationCase,
    evidenceBundle,
    unavailableProposal,
    arbitration,
  };
}

function evaluationRetryPayload(
  branch: Awaited<ReturnType<WorldEngine["getProjection"]>>[
    "retryableEvaluationBranches"
  ][number],
  requestId: string,
) {
  return {
    evaluationCaseId: branch.evaluationCaseId,
    evaluatorKind: branch.evaluatorKind,
    expectedCaseHash: branch.expectedCaseHash,
    expectedEvidenceBundleHash: branch.expectedEvidenceBundleHash,
    expectedUnavailableProposalId: branch.unavailableProposalId,
    expectedUnavailableProposalHash: branch.unavailableProposalHash,
    expectedArbitrationRevision: branch.expectedArbitrationRevision,
    expectedDecisionHash: branch.expectedDecisionHash,
    requestId,
  };
}

function taskForTrigger(input: {
  sessionId: string;
  sessionEpoch: string;
  sceneId: string;
  trigger: WorldEvent;
  expectedStateVersion: number;
  agentId: string;
  roleId: AgentTask["roleId"];
  definitionVersion: string;
  promptVersion: string;
  sequence: number;
}): AgentTask {
  return AgentTaskSchema.parse({
    taskId: `agent-task-recovery-${input.sequence}`,
    outboxId: `outbox-recovery-${input.sequence}`,
    subscriptionId: `${input.agentId}/recovery-test/v1`,
    agentId: input.agentId,
    roleId: input.roleId,
    definitionVersion: input.definitionVersion,
    promptVersion: input.promptVersion,
    sessionId: input.sessionId,
    sessionEpoch: input.sessionEpoch,
    sceneId: input.sceneId,
    triggerEventId: input.trigger.eventId,
    triggerEventType: input.trigger.eventType,
    expectedStateVersion: input.expectedStateVersion,
    priority: 75,
    correlationId: `correlation-recovery-${input.sequence}`,
    causalDepth: 0,
    idempotencyKey: `${input.sessionEpoch}:${input.trigger.eventId}:${input.agentId}`,
    status: "queued",
    attempts: 0,
    maxAttempts: 3,
    availableAt: now,
    lease: null,
    lastErrorCode: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  });
}

function successfulRun(
  task: AgentTask,
  intent: ExecutableAgentIntent,
): AgentRunResult {
  const agentRunId = intent.agentRunId;
  return AgentRunResultSchema.parse({
    intent,
    roleResponseIntent: null,
    trace: {
      taskId: task.taskId,
      agentRunId,
      correlationId: task.correlationId,
      agentId: task.agentId,
      roleId: task.roleId,
      definitionVersion: task.definitionVersion,
      promptVersion: task.promptVersion,
      inputStateVersion: task.expectedStateVersion,
      triggerRefs: [task.triggerEventId],
      contextManifest: null,
      promptHash: hash("f"),
      status: "completed",
      nodes: [{
        nodeId: "semantic-model",
        kind: "model",
        status: "success",
        startedAt: now,
        completedAt: now,
        durationMs: 10,
        selectedEdgeId: "model-to-done",
        errorCode: null,
      }],
      modelCalls: 1,
      modelInvocations: [{
        invocationId: `invocation-${agentRunId}`,
        profileId: "deterministic-recovery-test",
        provider: "deterministic",
        mode: "mock",
        model: "recovery-fixture-model",
        requestId: null,
        status: "completed",
        outputMode: "json_object",
        finishReason: "stop",
        tokenUsage: { input: 100, output: 40, total: 140 },
        latencyMs: 10,
        attempts: 1,
        estimatedCostUsd: null,
        errorCode: null,
        startedAt: now,
        completedAt: now,
      }],
      toolCalls: 0,
      tokenUsage: { input: 100, output: 40 },
      fallbackUsed: false,
      errorCode: null,
      startedAt: now,
      completedAt: now,
      durationMs: 10,
    },
    signals: {},
  });
}

function intent(input: {
  task: AgentTask;
  agentRunId: string;
  intentType: "record_evaluation_proposal" | "propose_learning_candidate";
  proposedPayload: Record<string, unknown>;
  evidenceRefs: string[];
}): ExecutableAgentIntent {
  return {
    ...createMessageMeta({
      sessionId: input.task.sessionId,
      sceneId: input.task.sceneId,
      actorId: input.task.agentId,
      correlationId: input.task.correlationId,
      timestamp: now,
    }),
    kind: "AgentIntent",
    intentId: `intent-${input.agentRunId}`,
    agentRunId: input.agentRunId,
    roleId: input.task.roleId,
    intentType: input.intentType,
    rationaleSummary: "基于固定输入形成结构化待审结果。",
    proposedPayload: input.proposedPayload,
    expectedStateVersion: input.task.expectedStateVersion,
    causationEventIds: [input.task.triggerEventId],
    evidenceRefs: input.evidenceRefs,
    citationRefs: input.evidenceRefs,
    toolResultRefs: [],
    confidence: 0.9,
    riskLevel: "low",
    requiresTeacherReview: true,
    visibility: ["teacher_only", "audit_only"],
    visibleToActorIds: [],
    idempotencyKey: `${input.task.idempotencyKey}:intent`,
    expiresAt: null,
  };
}

describe("V0.7 evaluation and learning recovery regressions", () => {
  it("does not charge infrastructure failures against the three manual evaluation retries", async () => {
    const sessionId = "session-evaluation-infrastructure-budget";
    const fixture = await seedEvaluationRecoveryFixture(sessionId);
    const infrastructureCodes = [
      "trigger_denied",
      "invalid_world_action",
      "trigger_denied",
      "invalid_world_action",
    ];

    for (const [index, errorCode] of infrastructureCodes.entries()) {
      const before = await fixture.engine.getProjection(
        sessionId,
        "teacher-main",
      );
      const branch = before.retryableEvaluationBranches.find(
        (item) => item.evaluatorKind === "work_quality",
      );
      expect(branch).toMatchObject({
        status: "ready",
        manualRetryCount: 0,
        maximumManualRetries: 3,
      });
      await fixture.engine.execute(command(
        sessionId,
        "teacher-main",
        "retry_evaluation_branch",
        before.stateVersion,
        evaluationRetryPayload(branch!, `retry-infrastructure-${index + 1}`),
      ));
      const retryEvent = (await fixture.store.load(sessionId)).findLast(
        (event) => event.eventType === "evaluation_branch_retry_requested",
      )!;
      expect(retryEvent.payload).toMatchObject({
        manualRetryAttempt: 1,
        manualRetryRequestSequence: index + 1,
      });
      const afterRequest = await fixture.engine.getProjection(
        sessionId,
        "teacher-main",
      );
      const task = taskForTrigger({
        sessionId,
        sessionEpoch: afterRequest.sessionEpoch,
        sceneId: retryEvent.sceneId,
        trigger: retryEvent,
        expectedStateVersion: afterRequest.stateVersion,
        agentId: "agent-work-quality-assessor",
        roleId: "assessor",
        definitionVersion: "evaluation-semantic/1.0.5",
        promptVersion: "evaluation-semantic/1.0.2",
        sequence: index + 1,
      });
      await fixture.engine.recordAgentTaskFailure(task, errorCode);
    }

    const finalProjection = await fixture.engine.getProjection(
      sessionId,
      "teacher-main",
    );
    expect(finalProjection.retryableEvaluationBranches).toContainEqual(
      expect.objectContaining({
        evaluatorKind: "work_quality",
        status: "ready",
        manualRetryCount: 0,
        maximumManualRetries: 3,
      }),
    );
    expect((await fixture.store.load(sessionId)).filter(
      (event) => event.eventType === "evaluation_branch_retry_requested",
    )).toHaveLength(4);
  });

  it("appends a completed retry proposal, preserves unavailable history, and advances arbitration revision", async () => {
    const sessionId = "session-evaluation-completed-retry";
    const fixture = await seedEvaluationRecoveryFixture(sessionId);
    const before = await fixture.engine.getProjection(
      sessionId,
      "teacher-main",
    );
    const branch = before.retryableEvaluationBranches.find(
      (item) => item.evaluatorKind === "work_quality",
    )!;
    await fixture.engine.execute(command(
      sessionId,
      "teacher-main",
      "retry_evaluation_branch",
      before.stateVersion,
      evaluationRetryPayload(branch, "retry-completed-1"),
    ));
    const retryEvent = (await fixture.store.load(sessionId)).findLast(
      (event) => event.eventType === "evaluation_branch_retry_requested",
    )!;
    const afterRequest = await fixture.engine.getProjection(
      sessionId,
      "teacher-main",
    );
    const task = taskForTrigger({
      sessionId,
      sessionEpoch: afterRequest.sessionEpoch,
      sceneId: retryEvent.sceneId,
      trigger: retryEvent,
      expectedStateVersion: afterRequest.stateVersion,
      agentId: "agent-work-quality-assessor",
      roleId: "assessor",
      definitionVersion: "evaluation-semantic/1.0.5",
      promptVersion: "evaluation-semantic/1.0.2",
      sequence: 20,
    });
    const completedIntent = intent({
      task,
      agentRunId: "run-evaluation-retry-completed",
      intentType: "record_evaluation_proposal",
      proposedPayload: {
        evaluatorKind: "work_quality",
        status: "completed",
        dimensions: fixture.evaluationCase.dimensions.map((dimension) => ({
          dimensionId: dimension.dimensionId,
          scoreSuggestion: Math.round(dimension.maxScore * 0.8 * 100) / 100,
          maxScore: dimension.maxScore,
          reason: "固定成果修订与过程证据能够支持该项建议。",
          evidenceRefs: [fixture.evidence.evidenceId],
          confidence: 0.9,
          riskFlags: [],
        })),
        errorCode: null,
      },
      evidenceRefs: [fixture.evidence.evidenceId],
    });
    const resultEvents = await fixture.engine.applyAgentResult(
      task,
      successfulRun(task, completedIntent),
    );

    expect(resultEvents.map((event) => event.eventType)).toEqual([
      "agent_run_recorded",
      "agent_intent_recorded",
      "evaluation_proposal_recorded",
      "evaluation_arbitrated",
    ]);
    const after = await fixture.engine.getProjection(
      sessionId,
      "teacher-main",
    );
    const workQualityProposals = after.evaluationProposals.filter(
      (proposal) => proposal.evaluatorKind === "work_quality",
    );
    expect(workQualityProposals).toHaveLength(2);
    expect(workQualityProposals[0]).toEqual(fixture.unavailableProposal);
    expect(workQualityProposals[1]).toMatchObject({
      status: "completed",
      evaluatorKind: "work_quality",
    });
    const arbitrations = after.evaluationArbitrations.filter(
      (item) => (
        item.evaluationCaseId === fixture.evaluationCase.evaluationCaseId
      ),
    );
    expect(arbitrations.map((item) => item.revision)).toEqual([
      fixture.arbitration.revision,
      fixture.arbitration.revision + 1,
    ]);
    expect(after.retryableEvaluationBranches.some(
      (item) => item.evaluatorKind === "work_quality",
    )).toBe(false);
  });

  it("rebuilds a redacted learning input on retry and appends a successful candidate", async () => {
    const sessionId = "session-learning-generation-retry";
    const fixture = await seedEvaluationRecoveryFixture(sessionId);
    const beforeLearning = await fixture.engine.getProjection(
      sessionId,
      "teacher-main",
    );
    const review: TeacherAssessmentReview = {
      schemaVersion: "evaluation/1.0.0",
      reviewId: "teacher-review-recovery",
      evaluationCaseId: fixture.evaluationCase.evaluationCaseId,
      arbitrationId: fixture.arbitration.arbitrationId,
      arbitrationRevision: fixture.arbitration.revision,
      decisionHash: fixture.arbitration.decisionHash,
      evidenceBundleHash: fixture.evidenceBundle.bundleHash,
      dimensions: fixture.evaluationCase.dimensions.map((dimension) => ({
        dimensionId: dimension.dimensionId,
        proposedScore: Math.round(dimension.maxScore * 0.8 * 100) / 100,
        finalScore: Math.round(dimension.maxScore * 0.8 * 100) / 100,
        maxScore: dimension.maxScore,
        delta: 0,
        publicFeedback: "公开反馈仅描述可核验表现。",
        overrideReason: null,
        evidenceRefs: [fixture.evidence.evidenceId],
      })),
      finalScore: 80,
      publicSummary: "公开终评总结。",
      internalNote: "teacher-private-internal-note-canary",
      reviewedBy: "teacher-private-reviewer-canary",
      reviewedAt: now,
      requestId: "teacher-private-request-canary",
      finalHash: hash("9"),
    };
    const assessment: Assessment = {
      assessmentId: "assessment-teacher-recovery",
      stage: "teacher",
      status: "final",
      score: review.finalScore,
      rubricVersion: `${fixture.evaluationCase.rubricId}@${fixture.evaluationCase.rubricVersion}`,
      modelVersion: null,
      reasons: ["教师已形成公开终评。"],
      evidenceRefs: [fixture.evidence.evidenceId],
      artifactRevisionRefs: [],
      confidence: 1,
      reviewedBy: "teacher-main",
      reviewNote: review.internalNote,
    };
    const sourceEvents = await appendFixtureEvents({
      store: fixture.store,
      sessionId,
      sessionEpoch: beforeLearning.sessionEpoch,
      stateVersion: beforeLearning.stateVersion,
      sceneId: beforeLearning.scenario.scenarioId,
      drafts: [
        {
          eventId: "event-teacher-reviewed-recovery",
          eventType: "teacher_reviewed",
          actorId: "teacher-main",
          summary: "测试教师终评",
          visibility: ["role_private", "teacher_only", "audit_only"],
          visibleToActorIds: ["agent-learning"],
          payload: {
            review,
            finalAssessmentId: assessment.assessmentId,
            learningInput: {
              internalNote: review.internalNote,
              reviewedBy: review.reviewedBy,
              requestId: review.requestId,
            },
            requestId: review.requestId,
            requestPayloadHash: hash("8"),
          },
        },
        {
          eventId: "event-assessment-created-recovery",
          eventType: "assessment_created",
          actorId: "system",
          summary: "测试教师终评对象",
          visibility: ["teacher_only", "audit_only"],
          payload: { assessment },
        },
        {
          eventId: "event-learning-generation-failed-recovery",
          eventType: "learning_candidate_generation_failed",
          actorId: "agent-learning",
          summary: "测试学习候选生成失败",
          visibility: ["teacher_only", "audit_only"],
          payload: {
            taskId: "agent-task-learning-failed",
            triggerEventId: "event-teacher-reviewed-recovery",
            errorCode: "provider_timeout",
            evaluationCaseId: review.evaluationCaseId,
            teacherReviewId: review.reviewId,
            finalHash: review.finalHash,
            finalAssessmentId: assessment.assessmentId,
          },
        },
      ],
    });
    const failureEvent = sourceEvents[2]!;

    const beforeRetry = await fixture.engine.getProjection(
      sessionId,
      "teacher-main",
    );
    const failure = beforeRetry.retryableLearningGenerationFailures[0]!;
    await fixture.engine.execute(command(
      sessionId,
      "teacher-main",
      "retry_learning_candidate_generation",
      beforeRetry.stateVersion,
      {
        evaluationCaseId: failure.evaluationCaseId,
        teacherReviewId: failure.teacherReviewId,
        expectedFinalHash: failure.expectedFinalHash,
        failureEventId: failure.failureEventId,
        expectedFailedTaskId: failure.failedTaskId,
        requestId: "retry-learning-recovery-1",
      },
    ));
    const retryEvent = (await fixture.store.load(sessionId)).findLast(
      (event) => (
        event.eventType
          === "learning_candidate_generation_retry_requested"
      ),
    )!;
    const learningInput = retryEvent.payload.learningInput as Record<
      string,
      unknown
    >;
    expect(Object.keys(learningInput).sort()).toEqual([
      "dimensions",
      "evaluationCaseId",
      "finalHash",
      "finalScore",
      "publicSummary",
      "reviewId",
    ]);
    const serializedLearningInput = JSON.stringify(learningInput);
    expect(serializedLearningInput).not.toContain("internalNote");
    expect(serializedLearningInput).not.toContain("reviewedBy");
    expect(serializedLearningInput).not.toContain("requestId");
    expect(serializedLearningInput).not.toContain(review.internalNote);
    expect(serializedLearningInput).not.toContain(review.reviewedBy);
    expect(serializedLearningInput).not.toContain(review.requestId);

    const afterRequest = await fixture.engine.getProjection(
      sessionId,
      "teacher-main",
    );
    const task = taskForTrigger({
      sessionId,
      sessionEpoch: afterRequest.sessionEpoch,
      sceneId: retryEvent.sceneId,
      trigger: retryEvent,
      expectedStateVersion: afterRequest.stateVersion,
      agentId: "agent-learning",
      roleId: "learning_curator",
      definitionVersion: "learning-curator/1.0.2",
      promptVersion: "learning-curator/1.0.1",
      sequence: 30,
    });
    const learningIntent = intent({
      task,
      agentRunId: "run-learning-retry-completed",
      intentType: "propose_learning_candidate",
      proposedPayload: {
        status: "completed",
        candidateType: "assessment_example",
        title: "地方文旅岗位终评样例",
        proposedContent: {
          exemplarSummary: "展示公开反馈与过程证据如何形成终评。",
          improvementFocus: ["保持事实核验与岗位交接可追溯"],
        },
        sourceEvidenceRefs: [fixture.evidence.evidenceId],
        expectedBenefit: "沉淀经教师审核的评价样例。",
        knownRisks: ["仅适用于相同量规版本"],
        conflictRefs: [],
        errorCode: null,
      },
      evidenceRefs: [fixture.evidence.evidenceId],
    });
    await fixture.engine.applyAgentResult(
      task,
      successfulRun(task, learningIntent),
    );

    const after = await fixture.engine.getProjection(
      sessionId,
      "teacher-main",
    );
    expect(after.learningCandidates).toHaveLength(1);
    expect(after.retryableLearningGenerationFailures).toEqual([]);
    expect(after.learningCandidates[0]).toMatchObject({
      evaluationCaseId: review.evaluationCaseId,
      sourceFinalAssessmentId: assessment.assessmentId,
      status: "pending_review",
    });
    const serializedCandidate = JSON.stringify(after.learningCandidates[0]);
    expect(serializedCandidate).not.toContain(review.internalNote);
    expect(serializedCandidate).not.toContain(review.reviewedBy);
    expect(serializedCandidate).not.toContain(review.requestId);
  });
});
