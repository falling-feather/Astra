import { describe, expect, it } from "vitest";
import {
  AgentSubscriptionSchema,
  createMessageMeta,
  type Command,
  type CommandName,
  type ExperimentObservationRef,
} from "@ronggang/contracts";
import {
  AgentScheduler,
  createFactCheckerRuntime,
  factCheckerSubscription,
  type AgentRuntime,
} from "@ronggang/agent-runtime";
import {
  InMemoryEventStore,
  InProcessMessageBus,
  WorldEngine,
  demoScenario,
} from "@ronggang/world-core";
import {
  AgentTaskLeaseError,
  AgentTaskInputError,
  FactCheckerTaskHandler,
  InMemoryAgentTaskStore,
  TrainingSessionOrchestrator,
  type AgentRunner,
  type AgentTaskHandler,
  type AgentTaskStore,
  type CompleteAgentTaskInput,
} from "../src/index.js";

function sequenceIds() {
  let value = 0;
  return {
    next: (prefix: string) => `${prefix}-${++value}`,
  };
}

function fixedClock() {
  let millisecond = 0;
  const base = Date.parse("2026-07-25T06:35:00.000Z");
  return {
    now: () => new Date(base + millisecond++).toISOString(),
  };
}

function command(
  sessionId: string,
  actorId: string,
  name: CommandName,
  version: number,
  payload: Record<string, unknown> = {},
): Command {
  return {
    ...createMessageMeta({
      sessionId,
      sceneId: "scenario-local-tourism-media-v0.1",
      actorId,
      correlationId: `test-${name}`,
      timestamp: "2026-07-25T06:35:00.000Z",
    }),
    kind: "Command",
    name,
    expectedStateVersion: version,
    payload,
  };
}

function createHarness(input: {
  runner?: AgentRunner | AgentRuntime;
  taskStore?: AgentTaskStore;
  leaseDurationMs?: number;
  retryDelayMs?: number;
  now?: () => string;
  handler?: AgentTaskHandler;
  scheduler?: AgentScheduler;
  experimentObservation?: ExperimentObservationRef;
} = {}) {
  const ids = sequenceIds();
  const clock = input.now ? { now: input.now } : fixedClock();
  const eventStore = new InMemoryEventStore();
  const scenario = structuredClone(demoScenario);
  scenario.interactionGates = [];
  const world = new WorldEngine({
    store: eventStore,
    bus: new InProcessMessageBus(),
    ids,
    clock,
    scenario,
  });
  const taskStore = input.taskStore ?? new InMemoryAgentTaskStore();
  const runtime = input.runner ?? createFactCheckerRuntime({ clock: clock.now });
  const orchestrator = new TrainingSessionOrchestrator({
    world,
    taskStore,
    handlers: [input.handler ?? new FactCheckerTaskHandler({
        runtime,
        now: clock.now,
        nextId: ids.next,
      })],
    ...(input.scheduler ? { scheduler: input.scheduler } : {}),
    ...(input.experimentObservation
      ? { experimentObservation: input.experimentObservation }
      : {}),
    workerId: "worker-test",
    leaseDurationMs: input.leaseDurationMs ?? 45_000,
    retryDelayMs: input.retryDelayMs ?? 0,
    now: clock.now,
    nextId: ids.next,
  });
  return { world, eventStore, taskStore, orchestrator };
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 3_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error(`等待条件超时：${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

class FailFirstCompleteTaskStore implements AgentTaskStore {
  readonly #inner: InMemoryAgentTaskStore;
  #failComplete = true;

  constructor(inner: InMemoryAgentTaskStore) {
    this.#inner = inner;
  }

  enqueue(...args: Parameters<AgentTaskStore["enqueue"]>) {
    return this.#inner.enqueue(...args);
  }

  enqueuePlan(...args: Parameters<AgentTaskStore["enqueuePlan"]>) {
    return this.#inner.enqueuePlan(...args);
  }

  claimNext(...args: Parameters<AgentTaskStore["claimNext"]>) {
    return this.#inner.claimNext(...args);
  }

  assertCurrentLease(...args: Parameters<AgentTaskStore["assertCurrentLease"]>) {
    return this.#inner.assertCurrentLease(...args);
  }

  reconcileWorldResult(...args: Parameters<AgentTaskStore["reconcileWorldResult"]>) {
    return this.#inner.reconcileWorldResult(...args);
  }

  rebase(...args: Parameters<AgentTaskStore["rebase"]>) {
    return this.#inner.rebase(...args);
  }

  fail(...args: Parameters<AgentTaskStore["fail"]>) {
    return this.#inner.fail(...args);
  }

  list(...args: Parameters<AgentTaskStore["list"]>) {
    return this.#inner.list(...args);
  }

  listDispatchPlans(
    ...args: Parameters<AgentTaskStore["listDispatchPlans"]>
  ) {
    return this.#inner.listDispatchPlans(...args);
  }

  listAttempts(...args: Parameters<AgentTaskStore["listAttempts"]>) {
    return this.#inner.listAttempts(...args);
  }

  listDeadLetters(...args: Parameters<AgentTaskStore["listDeadLetters"]>) {
    return this.#inner.listDeadLetters(...args);
  }

  reset(...args: Parameters<AgentTaskStore["reset"]>) {
    return this.#inner.reset(...args);
  }

  async complete(input: CompleteAgentTaskInput) {
    if (this.#failComplete) {
      this.#failComplete = false;
      throw new Error("simulated_crash_after_world_commit");
    }
    return this.#inner.complete(input);
  }
}

class CrashFinalCompleteTaskStore extends InMemoryAgentTaskStore {
  #crashComplete = true;

  override enqueue(tasks: Parameters<InMemoryAgentTaskStore["enqueue"]>[0]) {
    return super.enqueue(tasks.map((task) => ({ ...task, maxAttempts: 1 })));
  }

  override enqueuePlan(
    plan: Parameters<InMemoryAgentTaskStore["enqueuePlan"]>[0],
  ) {
    return super.enqueuePlan({
      ...plan,
      tasks: plan.tasks.map((task) => ({ ...task, maxAttempts: 1 })),
    });
  }

  override async complete(input: CompleteAgentTaskInput) {
    if (this.#crashComplete) {
      this.#crashComplete = false;
      throw new AgentTaskLeaseError("simulated_process_crash_after_final_world_commit");
    }
    return super.complete(input);
  }
}

class PauseEmptyClaimTaskStore extends InMemoryAgentTaskStore {
  #armed = false;
  #release: (() => void) | null = null;
  #entered: (() => void) | null = null;

  arm(): { entered: Promise<void>; release: () => void } {
    this.#armed = true;
    const entered = new Promise<void>((resolve) => { this.#entered = resolve; });
    const gate = new Promise<void>((resolve) => { this.#release = resolve; });
    return {
      entered,
      release: () => {
        this.#release?.();
        this.#release = null;
      },
    };
  }

  override async claimNext(...args: Parameters<InMemoryAgentTaskStore["claimNext"]>) {
    const claimed = await super.claimNext(...args);
    if (claimed || !this.#armed) return claimed;
    this.#armed = false;
    this.#entered?.();
    this.#entered = null;
    await new Promise<void>((resolve) => {
      const originalRelease = this.#release;
      this.#release = () => {
        originalRelease?.();
        resolve();
      };
    });
    return null;
  }
}

class CrashAfterDeadLetterTaskStore extends InMemoryAgentTaskStore {
  #crashOnce = true;

  override async fail(...args: Parameters<InMemoryAgentTaskStore["fail"]>) {
    const result = await super.fail(...args);
    if (result.deadLetter && this.#crashOnce) {
      this.#crashOnce = false;
      throw new Error("simulated_crash_after_dead_letter");
    }
    return result;
  }
}

describe("TrainingSessionOrchestrator", () => {
  it("updates debounce state inside one pending outbox batch", async () => {
    const subscription = AgentSubscriptionSchema.parse({
      ...factCheckerSubscription,
      subscriptionId: "fact-checker/bootstrap/debounced",
      eventTypes: ["session_started", "role_assigned"],
      debounceMs: 60_000,
    });
    const { world, taskStore, orchestrator } = createHarness({
      scheduler: new AgentScheduler([subscription]),
    });
    const sessionId = "session-same-batch-debounce";
    await world.createSession(sessionId, true);
    await orchestrator.drainUntilIdle(sessionId);

    const plans = await taskStore.listDispatchPlans(sessionId);
    const decisions = plans.flatMap((plan) => plan.decisions)
      .filter((candidate) => (
        candidate.subscriptionId === subscription.subscriptionId
      ))
      .map((candidate) => candidate.decision.reason);
    expect(decisions.filter((reason) => reason === "selected")).toHaveLength(1);
    expect(decisions.filter((reason) => reason === "debounce_active").length)
      .toBeGreaterThan(1);
    expect(await taskStore.list(sessionId)).toHaveLength(1);
  });

  it("attaches experiment observation after execution without leaking it into agent input", async () => {
    const marker = "batch-observation-canary";
    const observedRequests: string[] = [];
    const deterministic = createFactCheckerRuntime({
      clock: () => "2026-07-25T06:35:00.000Z",
    });
    const runner: AgentRunner = {
      run: async (definition, request) => {
        observedRequests.push(JSON.stringify(request));
        return deterministic.run(definition, request);
      },
    };
    const { world, orchestrator } = createHarness({
      runner,
      experimentObservation: {
        schemaVersion: "experiment-observation/1.0.0",
        experimentId: "ablation-canary",
        condition: "private_view_event_group",
        runBatchId: marker,
        caseId: "case-canary",
        repetition: 1,
        controlVariablesHash: "a".repeat(64),
      },
    });
    const sessionId = "session-observation-canary";
    await world.createSession(sessionId, true);
    await orchestrator.drainUntilIdle(sessionId);
    const student = await world.getProjection(sessionId, "student-editor");
    await world.execute(command(
      sessionId,
      "student-editor",
      "inspect_material",
      student.stateVersion,
    ));
    await orchestrator.drainUntilIdle(sessionId);

    expect(observedRequests).toHaveLength(1);
    expect(observedRequests[0]).not.toContain(marker);
    expect(observedRequests[0]).not.toContain("experimentObservation");
    const runEvent = (await world.store.load(sessionId)).findLast((event) => (
      event.eventType === "agent_run_recorded"
    ));
    expect(runEvent?.payload.trace).toMatchObject({
      experimentObservation: {
        runBatchId: marker,
      },
    });
  });

  it("keeps a student command non-blocking while a slow model runs in the background", async () => {
    const deterministic = createFactCheckerRuntime({
      clock: () => "2026-07-25T06:35:00.000Z",
    });
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const modelStarted = new Promise<void>((resolve) => { started = resolve; });
    const slowRunner: AgentRunner = {
      run: async (definition, request) => {
        started();
        await gate;
        return deterministic.run(definition, request);
      },
    };
    const { world, orchestrator } = createHarness({ runner: slowRunner });
    const sessionId = "session-non-blocking";
    await world.createSession(sessionId, true);
    await orchestrator.drain(sessionId);
    orchestrator.start([sessionId]);

    const student = await world.getProjection(sessionId, "student-editor");
    const commandResult = await world.execute(
      command(sessionId, "student-editor", "inspect_material", student.stateVersion),
    );
    expect(commandResult.pendingCandidates).toEqual([]);
    await modelStarted;
    expect((await world.getProjection(sessionId, "teacher-main")).pendingCandidates).toEqual([]);

    release();
    await orchestrator.drain(sessionId);
    expect((await world.getProjection(sessionId, "teacher-main")).pendingCandidates[0]?.title)
      .toBe("客流数据更正");
    await orchestrator.stop();
  });

  it("suppresses duplicate world effects after a crash between result commit and task completion", async () => {
    let runtimeCalls = 0;
    const runtime = createFactCheckerRuntime({
      clock: () => "2026-07-25T06:35:00.000Z",
    });
    const runner: AgentRunner = {
      run: async (definition, request) => {
        runtimeCalls += 1;
        return runtime.run(definition, request);
      },
    };
    const inner = new InMemoryAgentTaskStore();
    const taskStore = new FailFirstCompleteTaskStore(inner);
    const { world, eventStore, orchestrator } = createHarness({ runner, taskStore });
    const sessionId = "session-result-recovery";
    await world.createSession(sessionId, true);
    await orchestrator.drain(sessionId);
    const student = await world.getProjection(sessionId, "student-editor");
    await world.execute(command(sessionId, "student-editor", "inspect_material", student.stateVersion));
    await orchestrator.drain(sessionId);

    const events = await eventStore.load(sessionId);
    expect(runtimeCalls).toBe(1);
    expect(events.filter((event) => event.eventType === "agent_run_recorded")).toHaveLength(1);
    expect(events.filter((event) => event.eventType === "candidate_event_proposed")).toHaveLength(1);
    expect((await inner.listAttempts(sessionId)).map((attempt) => attempt.outcome))
      .toEqual(["retry_scheduled", "duplicate_suppressed"]);
  });

  it("repairs a max-attempt dead letter when the world already contains the successful result", async () => {
    let runtimeCalls = 0;
    const runtime = createFactCheckerRuntime();
    const runner: AgentRunner = {
      run: async (definition, request) => {
        runtimeCalls += 1;
        return runtime.run(definition, request);
      },
    };
    const taskStore = new CrashFinalCompleteTaskStore();
    const { world, eventStore, orchestrator } = createHarness({
      runner,
      taskStore,
      leaseDurationMs: 500,
      now: () => new Date().toISOString(),
    });
    const sessionId = "session-final-result-reconcile";
    await world.createSession(sessionId, true);
    await orchestrator.drain(sessionId);
    orchestrator.start([sessionId]);
    const student = await world.getProjection(sessionId, "student-editor");
    await world.execute(command(sessionId, "student-editor", "inspect_material", student.stateVersion));

    await waitFor(async () => {
      const [task] = await taskStore.list(sessionId);
      return (
        task?.status === "completed"
        && (await taskStore.listDeadLetters(sessionId)).length === 0
      );
    }, 5_000);

    const events = await eventStore.load(sessionId);
    expect(runtimeCalls).toBe(1);
    expect(events.filter((event) => event.eventType === "agent_run_recorded")).toHaveLength(1);
    expect(events.filter((event) => event.eventType === "candidate_event_proposed")).toHaveLength(1);
    expect(events.filter((event) => event.eventType === "agent_task_failed")).toHaveLength(0);
    expect((await taskStore.listAttempts(sessionId)).map((attempt) => attempt.outcome))
      .toEqual(["lease_expired", "duplicate_suppressed"]);
    await orchestrator.stop();
  });

  it("retries hard failures and records a dead letter without rolling back the observation", async () => {
    const failingRunner: AgentRunner = {
      run: async () => {
        throw new Error("runtime configuration failed");
      },
    };
    const { world, eventStore, taskStore, orchestrator } = createHarness({ runner: failingRunner });
    const sessionId = "session-dead-letter";
    await world.createSession(sessionId, true);
    await orchestrator.drain(sessionId);
    const student = await world.getProjection(sessionId, "student-editor");
    await world.execute(command(sessionId, "student-editor", "inspect_material", student.stateVersion));
    await orchestrator.drain(sessionId);

    const events = await eventStore.load(sessionId);
    expect(events.some((event) => event.eventType === "material_observed")).toBe(true);
    expect(events.filter((event) => event.eventType === "agent_task_failed")).toHaveLength(1);
    expect(events.some((event) => event.eventType === "candidate_event_proposed")).toBe(false);
    expect(await taskStore.listDeadLetters(sessionId)).toHaveLength(1);
    expect(await taskStore.listAttempts(sessionId)).toHaveLength(3);
  });

  it("dead-letters a deterministic task-input failure once with its stable code", async () => {
    const handler: AgentTaskHandler = {
      handlerId: "test/deterministic-input-error",
      matches: (task) => task.agentId === "agent-fact-checker",
      run: async () => {
        throw new AgentTaskInputError(
          "evaluation_evidence_projection_missing",
          "fixed evidence is absent from the authorized projection",
          {
            stage: "evidence_projection",
            projectedEvidenceCount: 0,
            requiredEvidenceCount: 3,
            missingEvidenceCount: 3,
          },
        );
      },
    };
    const { world, taskStore, orchestrator } = createHarness({ handler });
    const sessionId = "session-non-retryable-input-error";
    await world.createSession(sessionId, true);
    await orchestrator.drain(sessionId);
    const student = await world.getProjection(sessionId, "student-editor");
    await world.execute(command(
      sessionId,
      "student-editor",
      "inspect_material",
      student.stateVersion,
    ));
    await orchestrator.drain(sessionId);

    expect(await taskStore.listAttempts(sessionId)).toEqual([
      expect.objectContaining({
        outcome: "dead_lettered",
        errorCode: "evaluation_evidence_projection_missing",
        attemptNumber: 1,
      }),
    ]);
    expect(await taskStore.listDeadLetters(sessionId)).toEqual([
      expect.objectContaining({
        reasonCode: "evaluation_evidence_projection_missing",
        attempts: 1,
      }),
    ]);
  });

  it("rejects a stale intent at the world boundary and dead-letters the task", async () => {
    const honest = createFactCheckerRuntime({
      clock: () => "2026-07-25T06:35:00.000Z",
    });
    const staleRunner: AgentRunner = {
      run: async (definition, request) => {
        const result = await honest.run(definition, request);
        return {
          ...result,
          intent: result.intent
            ? { ...result.intent, expectedStateVersion: request.stateVersion + 1 }
            : null,
        };
      },
    };
    const { world, eventStore, orchestrator } = createHarness({ runner: staleRunner });
    const sessionId = "session-stale-intent";
    await world.createSession(sessionId, true);
    await orchestrator.drain(sessionId);
    const student = await world.getProjection(sessionId, "student-editor");
    await world.execute(command(sessionId, "student-editor", "inspect_material", student.stateVersion));
    await orchestrator.drain(sessionId);

    const events = await eventStore.load(sessionId);
    expect(events.some((event) => event.eventType === "agent_task_failed")).toBe(true);
    expect(events.some((event) => event.eventType === "agent_intent_recorded")).toBe(false);
    expect(events.some((event) => event.eventType === "candidate_event_proposed")).toBe(false);
  });

  it("automatically wakes at a non-zero retryAt until a transient failure succeeds", async () => {
    const deterministic = createFactCheckerRuntime();
    let calls = 0;
    const flakyRunner: AgentRunner = {
      run: async (definition, request) => {
        calls += 1;
        if (calls < 3) throw new Error("temporary provider outage");
        return deterministic.run(definition, request);
      },
    };
    const { world, taskStore, orchestrator } = createHarness({
      runner: flakyRunner,
      retryDelayMs: 20,
      now: () => new Date().toISOString(),
    });
    const sessionId = "session-delayed-retry";
    await world.createSession(sessionId, true);
    await orchestrator.drain(sessionId);
    orchestrator.start([sessionId]);
    const student = await world.getProjection(sessionId, "student-editor");
    await world.execute(command(sessionId, "student-editor", "inspect_material", student.stateVersion));

    await waitFor(async () => (
      (await world.getProjection(sessionId, "teacher-main")).pendingCandidates.length === 1
    ));
    expect(calls).toBe(3);
    expect((await taskStore.listAttempts(sessionId)).map((attempt) => attempt.outcome))
      .toEqual(["retry_scheduled", "retry_scheduled", "completed"]);
    await orchestrator.stop();
  });

  it("recovers a still-running task after restart by waking at lease expiry", async () => {
    const now = () => new Date().toISOString();
    const crashedLeaseDurationMs = 60;
    const recoveredWorkerLeaseDurationMs = 1_000;
    const harness = createHarness({ now, leaseDurationMs: crashedLeaseDurationMs });
    const { world, eventStore, taskStore, orchestrator } = harness;
    const sessionId = "session-lease-restart";
    await world.createSession(sessionId, true);
    await orchestrator.drain(sessionId);
    const student = await world.getProjection(sessionId, "student-editor");
    await world.execute(command(sessionId, "student-editor", "inspect_material", student.stateVersion));

    const state = await world.getStateSnapshot(sessionId);
    const journal = await eventStore.loadJournalSnapshot(sessionId);
    const trigger = journal.events.find((event) => event.eventType === "material_observed");
    const outbox = journal.outbox.find((record) => record.eventId === trigger?.eventId);
    expect(trigger).toBeDefined();
    expect(outbox).toBeDefined();
    const [task] = new AgentScheduler([factCheckerSubscription]).createTasks({
      event: trigger!,
      outboxId: outbox!.outboxId,
      sessionEpoch: state.sessionEpoch,
      causalDepth: 0,
      expectedStateVersion: state.stateVersion,
      createdAt: now(),
      nextTaskId: () => "agent-task-restart",
    });
    await taskStore.enqueue([task!]);
    await eventStore.markOutboxDelivered(sessionId, outbox!.outboxId, now());
    await taskStore.claimNext({
      sessionId,
      sessionEpoch: state.sessionEpoch,
      workerId: "worker-crashed",
      now: now(),
      leaseDurationMs: crashedLeaseDurationMs,
      leaseToken: "lease-crashed",
    });
    await orchestrator.stop();

    const ids = sequenceIds();
    const restarted = new TrainingSessionOrchestrator({
      world,
      taskStore,
      handlers: [new FactCheckerTaskHandler({
        runtime: createFactCheckerRuntime(),
        now,
        nextId: ids.next,
      })],
      workerId: "worker-restarted",
      // The short lease above controls recovery wake-up. The restarted worker
      // needs an independent execution lease so suite load cannot turn this
      // recovery test into a handler-timeout test.
      leaseDurationMs: recoveredWorkerLeaseDurationMs,
      retryDelayMs: 10,
      now,
      nextId: ids.next,
    });
    restarted.start([sessionId]);
    await waitFor(async () => (
      (await world.getProjection(sessionId, "teacher-main")).pendingCandidates.length === 1
    ));
    expect((await taskStore.listAttempts(sessionId)).map((attempt) => attempt.outcome))
      .toEqual(["lease_expired", "completed"]);
    await restarted.stop();
  });

  it("re-runs drain when a world event arrives during the final empty claim", async () => {
    const taskStore = new PauseEmptyClaimTaskStore();
    const { world, orchestrator } = createHarness({ taskStore });
    const sessionId = "session-level-triggered-wake";
    await world.createSession(sessionId, true);
    await orchestrator.drain(sessionId);
    const unsubscribe = world.bus.subscribe(sessionId, () => orchestrator.wake(sessionId));
    const pause = taskStore.arm();
    const draining = orchestrator.drain(sessionId);
    await pause.entered;

    const student = await world.getProjection(sessionId, "student-editor");
    await world.execute(command(sessionId, "student-editor", "inspect_material", student.stateVersion));
    pause.release();
    await draining;
    await waitFor(async () => (
      (await world.getProjection(sessionId, "teacher-main")).pendingCandidates.length === 1
    ));
    unsubscribe();
    await orchestrator.stop();
  });

  it("pauses the session during reset and prevents old-generation results from crossing the boundary", async () => {
    const deterministic = createFactCheckerRuntime({
      clock: () => "2026-07-25T06:35:00.000Z",
    });
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const modelStarted = new Promise<void>((resolve) => { started = resolve; });
    const slowRunner: AgentRunner = {
      run: async (definition, request) => {
        started();
        await gate;
        return deterministic.run(definition, request);
      },
    };
    const { world, orchestrator } = createHarness({ runner: slowRunner });
    const sessionId = "session-atomic-reset";
    await world.createSession(sessionId, true);
    await orchestrator.drain(sessionId);
    orchestrator.start([sessionId]);
    const before = await world.getStateSnapshot(sessionId);
    const student = await world.getProjection(sessionId, "student-editor");
    await world.execute(command(sessionId, "student-editor", "inspect_material", student.stateVersion));
    await modelStarted;

    const reset = orchestrator.resetSession(
      sessionId,
      () => world.createSession(sessionId, true),
    );
    let operationEpoch = "";
    const operationAfterReset = orchestrator.runSessionOperation(sessionId, async () => {
      operationEpoch = (await world.getStateSnapshot(sessionId)).sessionEpoch;
    });
    release();
    await reset;
    await operationAfterReset;

    const after = await world.getStateSnapshot(sessionId);
    expect(after.sessionEpoch).not.toBe(before.sessionEpoch);
    expect(operationEpoch).toBe(after.sessionEpoch);
    expect(after.observations).toEqual([]);
    expect(after.candidates).toEqual([]);

    const nextStudent = await world.getProjection(sessionId, "student-editor");
    await orchestrator.runSessionOperation(sessionId, () => world.execute(
      command(sessionId, "student-editor", "inspect_material", nextStudent.stateVersion),
    ));
    await waitFor(async () => (
      (await world.getProjection(sessionId, "teacher-main")).pendingCandidates.length === 1
    ));
    await orchestrator.stop();
  });

  it("reconciles a persisted dead letter into the world after a crash before failure audit", async () => {
    const taskStore = new CrashAfterDeadLetterTaskStore();
    const failingRunner: AgentRunner = {
      run: async () => {
        throw new Error("permanent runtime failure");
      },
    };
    const { world, eventStore, orchestrator } = createHarness({
      runner: failingRunner,
      taskStore,
    });
    const sessionId = "session-dead-letter-reconcile";
    await world.createSession(sessionId, true);
    await orchestrator.drain(sessionId);
    const student = await world.getProjection(sessionId, "student-editor");
    await world.execute(command(sessionId, "student-editor", "inspect_material", student.stateVersion));
    await expect(orchestrator.drain(sessionId)).rejects.toThrow("simulated_crash_after_dead_letter");
    await orchestrator.stop();
    expect((await eventStore.load(sessionId)).some((event) => event.eventType === "agent_task_failed"))
      .toBe(false);

    const ids = sequenceIds();
    const restarted = new TrainingSessionOrchestrator({
      world,
      taskStore,
      handlers: [new FactCheckerTaskHandler({
        runtime: failingRunner,
        nextId: ids.next,
      })],
      workerId: "worker-dead-letter-recovery",
      retryDelayMs: 0,
      nextId: ids.next,
    });
    restarted.start([sessionId]);
    await waitFor(async () => (
      (await eventStore.load(sessionId)).some((event) => event.eventType === "agent_task_failed")
    ));
    expect((await eventStore.load(sessionId))
      .filter((event) => event.eventType === "agent_task_failed")).toHaveLength(1);
    await restarted.stop();
  });
});
