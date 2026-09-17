import { describe, expect, it } from "vitest";
import {
  createMessageMeta,
  type Command,
  type CommandName,
  type GovernanceRecommendation,
} from "@ronggang/contracts";
import {
  InMemoryEventStore,
  InProcessMessageBus,
  InvalidWorldActionError,
  WorldEngine,
  buildGovernanceExecutionContext,
  compileGovernanceModelPrompt,
  evaluateGovernanceExecution,
} from "../src/index.js";

function sequenceIds() {
  let value = 0;
  return { next: (prefix: string) => `${prefix}-${++value}` };
}

function fixedClock() {
  let second = 0;
  const base = Date.parse("2026-07-25T10:00:00.000Z");
  return {
    now: () => new Date(base + second++ * 1_000).toISOString(),
  };
}

async function execute(
  engine: WorldEngine,
  sessionId: string,
  actorId: string,
  name: CommandName,
  payload: Record<string, unknown>,
) {
  const projection = await engine.getProjection(sessionId, actorId);
  const command: Command = {
    ...createMessageMeta({
      sessionId,
      sceneId: projection.sceneId,
      actorId,
      correlationId: String(payload.requestId ?? `test-${name}`),
      timestamp: "2026-07-25T10:00:00.000Z",
    }),
    kind: "Command",
    name,
    expectedStateVersion: projection.stateVersion,
    payload,
  };
  return engine.execute(command);
}

describe("parallel governance world state", () => {
  it("keeps governance derivatives within the source material role boundary", async () => {
    const engine = new WorldEngine({
      store: new InMemoryEventStore(),
      bus: new InProcessMessageBus(),
      ids: sequenceIds(),
      clock: fixedClock(),
    });
    const sessionId = "governance-source-boundary";
    await engine.createSession(sessionId, true);
    await execute(
      engine,
      sessionId,
      "student-editor",
      "request_governance_review",
      {
        materialId: "material-license-note",
        requestId: "governance-private-material",
      },
    );

    const reporter = await engine.getProjection(
      sessionId,
      "student-reporter",
    );
    expect(reporter.materials.some(
      (material) => material.materialId === "material-license-note",
    )).toBe(false);
    expect(reporter.governanceReviews).toHaveLength(0);
    expect(reporter.mediaProcessingTasks.some(
      (task) => task.governanceReviewId !== null,
    )).toBe(false);

    const teacher = await engine.getProjection(sessionId, "teacher-main");
    expect(teacher.governanceReviews).toHaveLength(1);
  });

  it("pins four findings, arbitrates deterministically, and requires an exact teacher decision", async () => {
    const engine = new WorldEngine({
      store: new InMemoryEventStore(),
      bus: new InProcessMessageBus(),
      ids: sequenceIds(),
      clock: fixedClock(),
    });
    const sessionId = "governance-world";
    await engine.createSession(sessionId, true);
    const requested = await execute(
      engine,
      sessionId,
      "student-editor",
      "request_governance_review",
      {
        materialId: "material-festival-photo",
        requestId: "governance-request-1",
      },
    );
    const task = requested.mediaProcessingTasks.find(
      (item) => item.governanceReviewId,
    )!;
    expect(task.requestId).toBe("redacted");
    expect(task.idempotencyKey).toBe("redacted");
    expect(task.steps.every((step) => step.idempotencyKey === "redacted")).toBe(true);
    expect(JSON.stringify(requested.recentEvents)).not.toContain(
      "governance-request-1",
    );
    expect(task.steps.map((step) => step.governanceDomain).sort()).toEqual([
      "content_safety",
      "copyright",
      "fact",
      "platform_rule",
    ]);

    const recommendations: Record<
      NonNullable<typeof task.steps[number]["governanceDomain"]>,
      GovernanceRecommendation
    > = {
      content_safety: "allow",
      copyright: "block",
      fact: "review",
      platform_rule: "allow",
    };
    for (const step of [...task.steps].reverse()) {
      let state = await engine.getStateSnapshot(sessionId);
      await engine.startMediaProcessingStep({
        sessionId,
        sessionEpoch: state.sessionEpoch,
        taskId: task.taskId,
        stepId: step.stepId,
        expectedStateVersion: state.stateVersion,
        workerId: "governance-test-worker",
        providerMode: "mock",
        correlationId: `start-${step.stepId}`,
      });
      state = await engine.getStateSnapshot(sessionId);
      const currentTask = state.mediaProcessingTasks.find(
        (item) => item.taskId === task.taskId,
      )!;
      const currentStep = currentTask.steps.find(
        (item) => item.stepId === step.stepId,
      )!;
      const toolRecommendation =
        recommendations[step.governanceDomain!] as Exclude<
          GovernanceRecommendation,
          "unavailable"
        >;
      const toolObservation = {
        summary: `${step.governanceDomain} finding`,
        extracted: {
          recommendation: toolRecommendation,
          riskLabels: [`risk-${step.governanceDomain}`],
        },
        confidence: 0.8,
        provider: "iflytek",
        providerMode: "mock",
        providerRequestId: null,
      };
      const context = buildGovernanceExecutionContext(
        state,
        currentTask,
        currentStep,
      );
      const modelDecision = {
        recommendation: toolRecommendation,
        summary: `${step.governanceDomain} model decision`,
        riskLabels: [],
        citationChunkIds: context.knowledgeCitations.map(
          (item) => item.chunkId,
        ),
      };
      const execution = evaluateGovernanceExecution(
        context,
        {
          toolRecommendation,
          modelDecision,
          compiledPrompt: compileGovernanceModelPrompt(
            context,
            toolObservation,
          ),
          modelTrace: {
            status: "completed",
            profileId: "governance-test",
            provider: "deterministic",
            mode: "mock",
            model: "governance-test-model",
            requestId: null,
          },
        },
      );
      await engine.completeMediaProcessingStep({
        sessionId,
        sessionEpoch: state.sessionEpoch,
        taskId: task.taskId,
        stepId: step.stepId,
        expectedStateVersion: state.stateVersion,
        output: {
          outputId: `output-${step.governanceDomain}`,
          capability: step.capability,
          provider: "iflytek",
          providerMode: "mock",
          summary: `${step.governanceDomain} finding`,
          extracted: {
            toolObservation,
            modelDecision,
            toolRecommendation,
            modelRecommendation: modelDecision.recommendation,
            recommendation: execution.recommendation,
            riskLabels: [`risk-${step.governanceDomain}`],
            governanceExecution: execution.trace,
          },
          sourceRef: task.inputRef,
          confidence: 0.8,
          trust: "observation_only",
          verificationStatus: "unverified",
          providerRequestId: null,
          createdAt: "2026-07-25T10:01:00.000Z",
        },
        correlationId: `complete-${step.stepId}`,
      });
    }
    let state = await engine.getStateSnapshot(sessionId);
    await engine.finalizeMediaProcessingTask({
      sessionId,
      sessionEpoch: state.sessionEpoch,
      taskId: task.taskId,
      expectedStateVersion: state.stateVersion,
      correlationId: "governance-finalize",
    });

    const teacher = await engine.getProjection(sessionId, "teacher-main");
    const review = teacher.governanceReviews[0]!;
    expect(review.requestId).toBe("governance-request-1");
    expect(review).toMatchObject({
      status: "awaiting_teacher",
      arbitrationRevision: 1,
      verdict: "block",
      conflict: true,
    });
    expect(review.findingSetHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(review.decisionHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(teacher.governanceFindings).toHaveLength(4);
    const immutableFindings = structuredClone(
      (await engine.getStateSnapshot(sessionId)).governanceFindings,
    );

    await expect(execute(
      engine,
      sessionId,
      "teacher-main",
      "review_governance",
      {
        reviewId: review.reviewId,
        expectedArbitrationRevision: review.arbitrationRevision,
        expectedDecisionHash: "0".repeat(64),
        decision: "approve",
        reviewNote: "陈旧哈希不得通过",
        requestId: "teacher-review-stale",
      },
    )).rejects.toBeInstanceOf(InvalidWorldActionError);

    await expect(execute(
      engine,
      sessionId,
      "teacher-main",
      "review_governance",
      {
        reviewId: review.reviewId,
        expectedArbitrationRevision: review.arbitrationRevision,
        expectedDecisionHash: review.decisionHash,
        decision: "approve",
        reviewNote: "阻断结论不得通过教师批准变成材料放行。",
        requestId: "teacher-review-1",
      },
    )).rejects.toBeInstanceOf(InvalidWorldActionError);

    await execute(
      engine,
      sessionId,
      "teacher-main",
      "review_governance",
      {
        reviewId: review.reviewId,
        expectedArbitrationRevision: review.arbitrationRevision,
        expectedDecisionHash: review.decisionHash,
        decision: "reject",
        reviewNote: "版权分支给出阻断结论，要求形成新的材料版本。",
        requestId: "teacher-review-reject-block",
      },
    );
    const student = await engine.getProjection(sessionId, "student-editor");
    expect(student.governanceReviews[0]).toMatchObject({
      status: "rejected",
      requestId: "redacted",
      reviewedBy: null,
      reviewNote: null,
    });
    expect(student.mediaProcessingTasks[0]).toMatchObject({
      requestId: "redacted",
      idempotencyKey: "redacted",
    });
    expect(JSON.stringify(student)).not.toContain("governance-request-1");
    expect(JSON.stringify(student)).not.toContain("teacher-review-reject-block");
    expect(student.governanceFindings.every(
      (finding) => finding.providerRequestId === null,
    )).toBe(true);
    expect(
      (await engine.getStateSnapshot(sessionId)).governanceFindings,
    ).toEqual(immutableFindings);
    await expect(execute(
      engine,
      sessionId,
      "teacher-main",
      "review_governance",
      {
        reviewId: review.reviewId,
        expectedArbitrationRevision: review.arbitrationRevision,
        expectedDecisionHash: review.decisionHash,
        decision: "reject",
        reviewNote: "试图用相同 requestId 改写教师复核说明。",
        requestId: "teacher-review-reject-block",
      },
    )).rejects.toBeInstanceOf(InvalidWorldActionError);

    await expect(execute(
      engine,
      sessionId,
      "student-editor",
      "retry_media_processing",
      {
        taskId: task.taskId,
        requestId: "retry-reviewed-governance",
      },
    )).rejects.toBeInstanceOf(InvalidWorldActionError);
  });
});
