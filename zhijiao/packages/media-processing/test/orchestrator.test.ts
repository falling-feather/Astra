import { describe, expect, it } from "vitest";
import {
  createMessageMeta,
  type AdapterCapability,
  type Command,
} from "@ronggang/contracts";
import {
  InMemoryEventStore,
  InProcessMessageBus,
  WorldEngine,
  demoScenario,
} from "@ronggang/world-core";
import {
  DeterministicGovernanceModel,
  InMemoryMediaProcessingWorkStore,
  MediaProcessingWorkItemSchema,
  MediaProcessingOrchestrator,
  type GovernanceModelPort,
  type MediaCapabilityExecutionInput,
  type MediaCapabilityExecutionResult,
  type MediaCapabilityExecutor,
} from "../src/index.js";

function sequence() {
  let value = 0;
  return (prefix: string) => `${prefix}-${++value}`;
}

function clock() {
  let value = 0;
  const base = Date.parse("2026-07-25T06:00:00.000Z");
  return () => new Date(base + value++ * 1_000).toISOString();
}

class RecordingExecutor implements MediaCapabilityExecutor {
  readonly provider = "iflytek";
  readonly mode = "mock" as const;
  readonly calls: MediaCapabilityExecutionInput[] = [];
  readonly #failFirst: Set<AdapterCapability>;

  constructor(failFirst: AdapterCapability[] = []) {
    this.#failFirst = new Set(failFirst);
  }

  async executeCapability(
    input: MediaCapabilityExecutionInput,
  ): Promise<MediaCapabilityExecutionResult> {
    this.calls.push(structuredClone(input));
    if (
      this.#failFirst.has(input.capability)
      && this.calls.filter((call) => (
        call.capability === input.capability
      )).length === 1
    ) {
      throw new Error("simulated provider failure with secret raw body");
    }
    return {
      summary: `${input.capability} completed`,
      extracted: { capability: input.capability, safe: true },
      confidence: 0.88,
      providerRequestId: `provider-${input.idempotencyKey}`,
    };
  }
}

async function requestImageTask(
  engine: WorldEngine,
  sessionId: string,
  requestId = "request-media-1",
) {
  const projection = await engine.getProjection(
    sessionId,
    "student-editor",
  );
  const command: Command = {
    ...createMessageMeta({
      sessionId,
      sceneId: projection.sceneId,
      actorId: "student-editor",
      correlationId: requestId,
      timestamp: "2026-07-25T06:00:05.000Z",
    }),
    kind: "Command",
    name: "request_media_processing",
    expectedStateVersion: projection.stateVersion,
    payload: {
      materialId: "material-festival-photo",
      planId: "image-editorial-analysis",
      requestId,
    },
  };
  return engine.execute(command);
}

async function requestGovernanceTask(
  engine: WorldEngine,
  sessionId: string,
  requestId = "request-governance-1",
) {
  const projection = await engine.getProjection(
    sessionId,
    "student-editor",
  );
  return engine.execute({
    ...createMessageMeta({
      sessionId,
      sceneId: projection.sceneId,
      actorId: "student-editor",
      correlationId: requestId,
      timestamp: "2026-07-25T06:00:05.000Z",
    }),
    kind: "Command",
    name: "request_governance_review",
    expectedStateVersion: projection.stateVersion,
    payload: {
      materialId: "material-festival-photo",
      requestId,
    },
  });
}

class BarrierExecutor implements MediaCapabilityExecutor {
  readonly provider = "iflytek";
  readonly mode = "mock" as const;
  readonly startedDomains: string[] = [];
  maxActive = 0;
  #active = 0;
  #release!: () => void;
  readonly #barrier = new Promise<void>((resolve) => {
    this.#release = resolve;
  });

  async executeCapability(
    input: MediaCapabilityExecutionInput,
  ): Promise<MediaCapabilityExecutionResult> {
    this.#active += 1;
    this.maxActive = Math.max(this.maxActive, this.#active);
    this.startedDomains.push(String(input.metadata.governanceDomain));
    if (this.startedDomains.length === 4) this.#release();
    await this.#barrier;
    this.#active -= 1;
    return {
      summary: `${String(input.metadata.governanceDomain)} completed`,
      extracted: { recommendation: "allow", riskLabels: [] },
      confidence: 0.9,
    };
  }
}

class RecordingGovernanceModel implements GovernanceModelPort {
  readonly delegate = new DeterministicGovernanceModel(clock());
  readonly calls: Parameters<GovernanceModelPort["invoke"]>[0][] = [];

  health() {
    return this.delegate.health();
  }

  async invoke(request: Parameters<GovernanceModelPort["invoke"]>[0]) {
    this.calls.push(structuredClone(request));
    return this.delegate.invoke(request);
  }
}

class HangingLiveExecutor implements MediaCapabilityExecutor {
  readonly provider = "iflytek";
  readonly mode = "live" as const;

  async executeCapability(
    input: MediaCapabilityExecutionInput,
  ): Promise<MediaCapabilityExecutionResult> {
    if (input.metadata.governanceDomain === "content_safety") {
      return new Promise<MediaCapabilityExecutionResult>(() => undefined);
    }
    return {
      summary: `${String(input.metadata.governanceDomain)} completed`,
      extracted: { recommendation: "allow", riskLabels: [] },
      confidence: 0.9,
      providerRequestId: `live-${String(input.metadata.governanceDomain)}`,
    };
  }
}

class SlowGovernanceExecutor implements MediaCapabilityExecutor {
  readonly provider = "iflytek";
  readonly mode = "live" as const;

  async executeCapability(
    input: MediaCapabilityExecutionInput,
  ): Promise<MediaCapabilityExecutionResult> {
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    return {
      summary: `${String(input.metadata.governanceDomain)} completed slowly`,
      extracted: { recommendation: "allow", riskLabels: [] },
      confidence: 0.9,
      providerRequestId: `slow-${String(input.metadata.governanceDomain)}`,
    };
  }
}

class HangingGovernanceModel implements GovernanceModelPort {
  readonly delegate = new DeterministicGovernanceModel(clock());
  readonly timeoutBudgets: number[] = [];

  health() {
    return this.delegate.health();
  }

  async invoke(request: Parameters<GovernanceModelPort["invoke"]>[0]) {
    this.timeoutBudgets.push(request.timeoutMs);
    return new Promise<never>(() => undefined);
  }
}

class InterruptFirstWaveExecutor implements MediaCapabilityExecutor {
  readonly provider = "iflytek";
  readonly mode = "mock" as const;
  readonly calls: MediaCapabilityExecutionInput[] = [];
  readonly firstWaveStarted: Promise<void>;
  readonly #attempts = new Map<string, number>();
  #resolveFirstWave!: () => void;

  constructor(private readonly expectedFirstWaveSize: number) {
    this.firstWaveStarted = new Promise<void>((resolve) => {
      this.#resolveFirstWave = resolve;
    });
  }

  async executeCapability(
    input: MediaCapabilityExecutionInput,
  ): Promise<MediaCapabilityExecutionResult> {
    this.calls.push(structuredClone(input));
    const attempt = (this.#attempts.get(input.idempotencyKey) ?? 0) + 1;
    this.#attempts.set(input.idempotencyKey, attempt);
    if (attempt === 1) {
      const firstWaveCount = [...this.#attempts.values()].filter(
        (value) => value === 1,
      ).length;
      if (firstWaveCount === this.expectedFirstWaveSize) {
        this.#resolveFirstWave();
      }
      await new Promise<never>((_resolve, reject) => {
        const rejectInterrupted = () => {
          const error = new Error("worker interrupted");
          error.name = "AbortError";
          reject(error);
        };
        if (input.signal.aborted) {
          rejectInterrupted();
          return;
        }
        input.signal.addEventListener("abort", rejectInterrupted, {
          once: true,
        });
      });
    }
    return {
      summary: `${input.capability} resumed`,
      extracted: { capability: input.capability, safe: true },
      confidence: 0.91,
      providerRequestId: `resumed-${input.idempotencyKey}`,
    };
  }
}

describe("MediaProcessingOrchestrator", () => {
  it("commits a queued business task before executing fixed capability steps", async () => {
    const bus = new InProcessMessageBus();
    const engine = new WorldEngine({
      store: new InMemoryEventStore(),
      bus,
      ids: { next: sequence() },
      clock: { now: clock() },
    });
    const sessionId = "media-success";
    await engine.createSession(sessionId, true);
    const queued = await requestImageTask(engine, sessionId);
    expect(queued.mediaProcessingTasks[0]).toMatchObject({
      status: "queued",
      steps: [
        { capability: "image_understanding", status: "queued" },
        { capability: "image_moderation", status: "queued" },
      ],
    });

    const executor = new RecordingExecutor();
    const workStore = new InMemoryMediaProcessingWorkStore();
    const orchestrator = new MediaProcessingOrchestrator({
      world: engine,
      workStore,
      executor,
      workerId: "media-test-worker",
      now: clock(),
      nextId: sequence(),
    });
    orchestrator.start([sessionId]);
    await orchestrator.drainUntilIdle(sessionId);

    const state = await engine.getStateSnapshot(sessionId);
    const task = state.mediaProcessingTasks[0]!;
    expect(task.status).toBe("succeeded");
    expect(task.steps.map((step) => step.status)).toEqual([
      "succeeded",
      "succeeded",
    ]);
    expect(task.steps.every((step) => (
      step.output?.verificationStatus === "unverified"
      && step.output.trust === "observation_only"
      && step.output.providerMode === "mock"
    ))).toBe(true);
    expect(executor.calls.map((call) => call.capability)).toEqual([
      "image_understanding",
      "image_moderation",
    ]);
    expect(executor.calls.every((call) => (
      call.sourceRef === task.inputRef
      && call.metadata.inputContentHash === task.inputContentHash
    ))).toBe(true);
    expect((await workStore.list(sessionId)).every((item) => (
      item.status === "completed"
    ))).toBe(true);
    await orchestrator.stop();
  });

  it("preserves successful output, becomes partial, and retries only the failed step", async () => {
    const bus = new InProcessMessageBus();
    const engine = new WorldEngine({
      store: new InMemoryEventStore(),
      bus,
      ids: { next: sequence() },
      clock: { now: clock() },
    });
    const sessionId = "media-partial-retry";
    await engine.createSession(sessionId, true);
    await requestImageTask(engine, sessionId);

    const executor = new RecordingExecutor(["image_moderation"]);
    const orchestrator = new MediaProcessingOrchestrator({
      world: engine,
      workStore: new InMemoryMediaProcessingWorkStore(),
      executor,
      workerId: "media-test-worker",
      now: clock(),
      nextId: sequence(),
    });
    orchestrator.start([sessionId]);
    await orchestrator.drainUntilIdle(sessionId);

    let projection = await engine.getProjection(sessionId, "student-editor");
    const partial = projection.mediaProcessingTasks[0]!;
    expect(partial.status).toBe("partially_succeeded");
    expect(partial.steps[0]).toMatchObject({
      capability: "image_understanding",
      status: "succeeded",
      attempts: 1,
    });
    expect(partial.steps[1]).toMatchObject({
      capability: "image_moderation",
      status: "failed",
      attempts: 1,
    });
    expect(partial.steps[1]?.lastErrorCode).toBe(
      "PROCESSING_STEP_FAILED",
    );

    const retry: Command = {
      ...createMessageMeta({
        sessionId,
        sceneId: projection.sceneId,
        actorId: "student-editor",
        correlationId: "retry-media-1",
        timestamp: "2026-07-25T06:02:00.000Z",
      }),
      kind: "Command",
      name: "retry_media_processing",
      expectedStateVersion: projection.stateVersion,
      payload: {
        taskId: partial.taskId,
        requestId: "retry-media-1",
      },
    };
    await engine.execute(retry);
    orchestrator.wake(sessionId);
    await orchestrator.drainUntilIdle(sessionId);

    projection = await engine.getProjection(sessionId, "student-editor");
    const completed = projection.mediaProcessingTasks[0]!;
    expect(completed.status).toBe("succeeded");
    expect(completed.steps[0]).toMatchObject({
      status: "succeeded",
      attempts: 1,
    });
    expect(completed.steps[1]).toMatchObject({
      status: "succeeded",
      attempts: 2,
    });
    expect(executor.calls.filter((call) => (
      call.capability === "image_understanding"
    ))).toHaveLength(1);
    expect(executor.calls.filter((call) => (
      call.capability === "image_moderation"
    ))).toHaveLength(2);
    await orchestrator.stop();
  });

  it("executes all four governance branches concurrently before deterministic arbitration", async () => {
    const engine = new WorldEngine({
      store: new InMemoryEventStore(),
      bus: new InProcessMessageBus(),
      ids: { next: sequence() },
      clock: { now: clock() },
    });
    const sessionId = "governance-concurrent";
    await engine.createSession(sessionId, true);
    await requestGovernanceTask(engine, sessionId);
    const executor = new BarrierExecutor();
    const governanceModel = new RecordingGovernanceModel();
    const orchestrator = new MediaProcessingOrchestrator({
      world: engine,
      workStore: new InMemoryMediaProcessingWorkStore(),
      executor,
      governanceModel,
      workerId: "governance-worker",
      now: clock(),
      nextId: sequence(),
      maxConcurrentWorkItems: 4,
    });
    orchestrator.start([sessionId]);
    await orchestrator.drainUntilIdle(sessionId);

    const state = await engine.getStateSnapshot(sessionId);
    expect(executor.maxActive).toBe(4);
    expect(executor.startedDomains.sort()).toEqual([
      "content_safety",
      "copyright",
      "fact",
      "platform_rule",
    ]);
    expect(state.governanceFindings).toHaveLength(4);
    expect(state.governanceReviews[0]).toMatchObject({
      status: "awaiting_teacher",
      verdict: "revise",
      conflict: true,
    });
    expect(governanceModel.calls).toHaveLength(4);
    expect(governanceModel.calls.every((call) => (
      call.systemPrompt.includes("后台")
      && call.userPrompt.includes("固定工具观察")
      && call.userPrompt.includes("内容哈希")
      && call.userPrompt.includes("citationChunkIds 允许值全集")
      && call.userPrompt.includes("不得填入事实 ID、材料 ID、规则 ID")
      && call.outputContractId === "governance-model-decision/1.0.0"
      && call.maxOutputTokens === 1_600
    ))).toBe(true);
    expect(state.governanceFindings.every((finding) => (
      finding.executionTrace !== null
      && /^[a-f0-9]{64}$/u.test(finding.executionTrace.promptHash)
      && /^[a-f0-9]{64}$/u.test(finding.executionTrace.rulesetHash)
      && finding.executionTrace.ruleEvaluations.length >= 2
      && finding.executionTrace.modelName
        === "deterministic-governance-model/1.0.0"
    ))).toBe(true);
    await orchestrator.stop();
  });

  it("times out one live branch, preserves the other findings, and never treats degradation as allow", async () => {
    const scenario = structuredClone(demoScenario);
    scenario.productionConfig!.governancePlan!.timeoutMsPerBranch = 25;
    const engine = new WorldEngine({
      scenario,
      store: new InMemoryEventStore(),
      bus: new InProcessMessageBus(),
      ids: { next: sequence() },
      clock: { now: clock() },
    });
    const sessionId = "governance-live-timeout";
    await engine.createSession(sessionId, true);
    const before = await engine.getStateSnapshot(sessionId);
    await requestGovernanceTask(engine, sessionId);
    const orchestrator = new MediaProcessingOrchestrator({
      world: engine,
      workStore: new InMemoryMediaProcessingWorkStore(),
      executor: new HangingLiveExecutor(),
      workerId: "governance-live-worker",
      now: clock(),
      nextId: sequence(),
      maxConcurrentWorkItems: 4,
    });
    orchestrator.start([sessionId]);
    await orchestrator.drainUntilIdle(sessionId);

    const state = await engine.getStateSnapshot(sessionId);
    expect(state.currentNodeId).toBe(before.currentNodeId);
    expect(state.facts).toEqual(before.facts);
    expect(state.governanceFindings).toHaveLength(4);
    expect(state.governanceFindings.find(
      (finding) => finding.domain === "content_safety",
    )).toMatchObject({
      executionStatus: "degraded",
      providerMode: "live",
      recommendation: "unavailable",
      errorCode: "provider_timeout",
    });
    expect(state.governanceReviews[0]).toMatchObject({
      status: "awaiting_teacher",
      verdict: "degraded",
    });
    await orchestrator.stop();
  });

  it("shares one wall-clock timeout budget between the tool and governance model", async () => {
    const scenario = structuredClone(demoScenario);
    scenario.productionConfig!.governancePlan!.timeoutMsPerBranch = 120;
    const engine = new WorldEngine({
      scenario,
      store: new InMemoryEventStore(),
      bus: new InProcessMessageBus(),
      ids: { next: sequence() },
      clock: { now: clock() },
    });
    const sessionId = "governance-single-deadline";
    await engine.createSession(sessionId, true);
    await requestGovernanceTask(engine, sessionId);
    const governanceModel = new HangingGovernanceModel();
    const orchestrator = new MediaProcessingOrchestrator({
      world: engine,
      workStore: new InMemoryMediaProcessingWorkStore(),
      executor: new SlowGovernanceExecutor(),
      governanceModel,
      workerId: "single-deadline-worker",
      now: clock(),
      nextId: sequence(),
      maxConcurrentWorkItems: 4,
    });

    orchestrator.start([sessionId]);
    await orchestrator.drainUntilIdle(sessionId);

    expect(governanceModel.timeoutBudgets).toHaveLength(4);
    expect(Math.max(...governanceModel.timeoutBudgets)).toBeLessThan(110);
    expect((await engine.getStateSnapshot(sessionId)).governanceReviews[0])
      .toMatchObject({
        status: "awaiting_teacher",
        verdict: "degraded",
      });
    await orchestrator.stop();
  });

  it("releases active leases on pause and resumes without consuming a new world attempt", async () => {
    const engine = new WorldEngine({
      store: new InMemoryEventStore(),
      bus: new InProcessMessageBus(),
      ids: { next: sequence() },
      clock: { now: clock() },
    });
    const sessionId = "media-pause-resume";
    await engine.createSession(sessionId, true);
    await requestImageTask(engine, sessionId);
    const workStore = new InMemoryMediaProcessingWorkStore();
    const executor = new InterruptFirstWaveExecutor(2);
    const orchestrator = new MediaProcessingOrchestrator({
      world: engine,
      workStore,
      executor,
      workerId: "pause-worker",
      now: clock(),
      nextId: sequence(),
      maxConcurrentWorkItems: 2,
    });

    orchestrator.start([sessionId]);
    await executor.firstWaveStarted;
    await orchestrator.pauseSession(sessionId);

    const pausedItems = await workStore.list(sessionId);
    expect(pausedItems).toHaveLength(2);
    expect(pausedItems.every((item) => (
      item.status === "queued"
      && item.lease === null
      && item.lastErrorCode === "worker_interrupted"
    ))).toBe(true);
    expect((await workStore.listAttempts(sessionId)).every(
      (attempt) => (
        attempt.outcome === "released"
        && attempt.errorCode === "worker_interrupted"
      ),
    )).toBe(true);
    expect((await engine.getStateSnapshot(sessionId))
      .mediaProcessingTasks[0]?.steps.every((step) => (
        step.status === "running" && step.attempts === 1
      ))).toBe(true);

    orchestrator.resumeSession(sessionId);
    await orchestrator.drainUntilIdle(sessionId);

    const resumed = await engine.getStateSnapshot(sessionId);
    expect(resumed.mediaProcessingTasks[0]).toMatchObject({
      status: "succeeded",
      steps: [
        { status: "succeeded", attempts: 1 },
        { status: "succeeded", attempts: 1 },
      ],
    });
    expect((await workStore.list(sessionId)).every(
      (item) => item.status === "completed",
    )).toBe(true);
    await orchestrator.stop();
  });

  it("releases active leases on stop and recovers them with a cold orchestrator", async () => {
    const engine = new WorldEngine({
      store: new InMemoryEventStore(),
      bus: new InProcessMessageBus(),
      ids: { next: sequence() },
      clock: { now: clock() },
    });
    const sessionId = "media-stop-recover";
    await engine.createSession(sessionId, true);
    await requestImageTask(engine, sessionId);
    const workStore = new InMemoryMediaProcessingWorkStore();
    const interruptedExecutor = new InterruptFirstWaveExecutor(2);
    const first = new MediaProcessingOrchestrator({
      world: engine,
      workStore,
      executor: interruptedExecutor,
      workerId: "stopping-worker",
      now: clock(),
      nextId: sequence(),
      maxConcurrentWorkItems: 2,
    });

    first.start([sessionId]);
    await interruptedExecutor.firstWaveStarted;
    await first.stop();
    expect((await workStore.list(sessionId)).every((item) => (
      item.status === "queued"
      && item.lease === null
      && item.lastErrorCode === "worker_interrupted"
    ))).toBe(true);

    const recoveredExecutor = new RecordingExecutor();
    const recovered = new MediaProcessingOrchestrator({
      world: engine,
      workStore,
      executor: recoveredExecutor,
      workerId: "recovered-worker",
      now: clock(),
      nextId: sequence(),
      maxConcurrentWorkItems: 2,
    });
    recovered.start([sessionId]);
    await recovered.drainUntilIdle(sessionId);

    const state = await engine.getStateSnapshot(sessionId);
    expect(state.mediaProcessingTasks[0]).toMatchObject({
      status: "succeeded",
      steps: [
        { status: "succeeded", attempts: 1 },
        { status: "succeeded", attempts: 1 },
      ],
    });
    expect(recoveredExecutor.calls).toHaveLength(2);
    await recovered.stop();
  });

  it("treats a future crash lease as quiescent and schedules recovery instead of spinning", async () => {
    const engine = new WorldEngine({
      store: new InMemoryEventStore(),
      bus: new InProcessMessageBus(),
      ids: { next: sequence() },
      clock: { now: clock() },
    });
    const sessionId = "media-future-crash-lease";
    await engine.createSession(sessionId, true);
    await requestImageTask(engine, sessionId);
    const state = await engine.getStateSnapshot(sessionId);
    const task = state.mediaProcessingTasks[0]!;
    const material = state.materials.find(
      (item) => item.materialId === task.materialId,
    )!;
    const workStore = new InMemoryMediaProcessingWorkStore();
    await workStore.enqueue(task.steps.map((step) => (
      MediaProcessingWorkItemSchema.parse({
        workItemId: [
          "media-work",
          state.sessionEpoch,
          task.taskId,
          step.stepId,
          1,
        ].join(":"),
        idempotencyKey: `${step.idempotencyKey}:attempt:1`,
        sessionId,
        sessionEpoch: state.sessionEpoch,
        taskId: task.taskId,
        stepId: step.stepId,
        capability: step.capability,
        governanceDomain: step.governanceDomain,
        governanceNode: step.governanceNode,
        branchPriority: step.branchPriority,
        timeoutMs: step.timeoutMs,
        attemptNumber: 1,
        inputRef: task.inputRef,
        inputContentHash: task.inputContentHash,
        mediaType: material.mediaType,
        status: "queued",
        claimCount: 0,
        lease: null,
        createdAt: task.updatedAt,
        updatedAt: task.updatedAt,
        completedAt: null,
        lastErrorCode: null,
      })
    )));
    for (const step of task.steps) {
      expect(await workStore.claimNext({
        sessionId,
        sessionEpoch: state.sessionEpoch,
        workerId: "crashed-worker",
        now: "2026-07-25T06:00:00.000Z",
        leaseDurationMs: 60_000,
        leaseToken: `crashed-lease:${step.stepId}`,
      })).not.toBeNull();
    }

    const recovered = new MediaProcessingOrchestrator({
      world: engine,
      workStore,
      executor: new RecordingExecutor(),
      workerId: "future-lease-worker",
      now: () => "2026-07-25T06:00:10.000Z",
      nextId: sequence(),
      maxConcurrentWorkItems: 2,
    });
    recovered.start([sessionId]);
    await recovered.drainUntilIdle(sessionId, 3);

    expect((await workStore.list(sessionId)).every((item) => (
      item.status === "running"
      && item.lease?.ownerId === "crashed-worker"
    ))).toBe(true);
    expect((await engine.getStateSnapshot(sessionId))
      .mediaProcessingTasks[0]?.steps.every((step) => (
        step.status === "queued" && step.attempts === 0
      ))).toBe(true);
    await recovered.stop();
  });
});
