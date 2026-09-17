import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AgentDispatchPlanSchema,
  AgentScaleSchemaVersion,
  AgentTaskSchema,
  type AgentDispatchPlan,
  type AgentTask,
} from "@ronggang/contracts";
import {
  AgentTaskLeaseError,
  InMemoryAgentTaskStore,
  JsonlAgentTaskStore,
} from "../src/index.js";

function queuedTask(overrides: Partial<AgentTask> = {}): AgentTask {
  return AgentTaskSchema.parse({
    taskId: "task-1",
    outboxId: "outbox-1",
    subscriptionId: "fact-checker/material-observed/v1",
    agentId: "agent-fact-checker",
    roleId: "fact_checker",
    templateRef: {
      templateId: "template:agent-fact-checker",
      templateVersion: "fact-checker/1.2.0",
    },
    instanceRef: {
      instanceId:
        "session-task-store:epoch-1:agent-fact-checker",
      instanceVersion: "fact-checker/1.2.0",
    },
    instanceContext: {
      bindingKind: "teacher_assistant",
      bindingId:
        "role-binding:course-001:fact_checker:agent-fact-checker",
      actorId: "agent-fact-checker",
      actorKind: "agent",
      courseId: "course-001",
      teamId: "team-001",
      privateMemoryNamespaceRef:
        "session:session-task-store/epoch:epoch-1/team:team-001/actor:agent-fact-checker",
      configHash: "a".repeat(64),
      lifecycle: "active",
    },
    definitionVersion: "fact-checker/1.2.0",
    promptVersion: "1.2.0",
    sessionId: "session-task-store",
    sessionEpoch: "epoch-1",
    sceneId: "scenario-local-tourism-media-v0.1",
    triggerEventId: "event-material-observed",
    triggerEventType: "material_observed",
    expectedStateVersion: 10,
    priority: 100,
    correlationId: "correlation-1",
    causalDepth: 0,
    actionContext: null,
    experimentObservation: null,
    dispatchDecision: {
      decisionId: "dispatch-decision-1",
      affected: true,
      decision: "selected",
      reason: "selected",
      selectedOrder: 0,
      budget: {
        limit: 4,
        affected: 2,
        selected: 1,
        filtered: 1,
        consumed: 1,
        remaining: 3,
        exhausted: false,
      },
    },
    idempotencyKey: "epoch-1:event-material-observed:fact-checker/material-observed/v1",
    status: "queued",
    attempts: 0,
    maxAttempts: 3,
    availableAt: "2026-07-25T00:00:00.000Z",
    lease: null,
    lastErrorCode: null,
    createdAt: "2026-07-25T00:00:00.000Z",
    updatedAt: "2026-07-25T00:00:00.000Z",
    completedAt: null,
    ...overrides,
  });
}

function dispatchPlan(task = queuedTask()): AgentDispatchPlan {
  return AgentDispatchPlanSchema.parse({
    planId: "dispatch-plan-1",
    waveId: "dispatch-wave-1",
    policyVersion: AgentScaleSchemaVersion,
    sessionId: task.sessionId,
    sessionEpoch: task.sessionEpoch,
    eventId: task.triggerEventId,
    outboxId: task.outboxId,
    createdAt: task.createdAt,
    architectureProfile: {
      profileId: "architecture-standard",
      profileVersion: "1.0.0",
      enabledTemplateIds: null,
      disabledTemplateIds: [],
      policyHash: "b".repeat(64),
    },
    experimentObservation: null,
    affectedInstanceIds: [task.instanceRef.instanceId, "instance-filtered"],
    budget: task.dispatchDecision.budget!,
    decisions: [
      {
        subscriptionId: task.subscriptionId,
        agentId: task.agentId,
        roleId: task.roleId,
        templateRef: task.templateRef,
        instanceRef: task.instanceRef,
        instanceContext: task.instanceContext,
        decision: task.dispatchDecision,
      },
      {
        subscriptionId: "subscription-filtered",
        agentId: "agent-filtered",
        roleId: "teaching_director",
        templateRef: {
          templateId: "template:agent-filtered",
          templateVersion: "1.0.0",
        },
        instanceRef: {
          instanceId: "instance-filtered",
          instanceVersion: "1.0.0",
        },
        instanceContext: {
          bindingKind: "teacher_assistant",
          bindingId: "binding-filtered",
          actorId: "agent-filtered",
          actorKind: "agent",
          courseId: "course-001",
          teamId: "team-001",
          privateMemoryNamespaceRef: "namespace-filtered",
          configHash: "c".repeat(64),
          lifecycle: "active",
        },
        decision: {
          decisionId: "dispatch-decision-filtered",
          affected: true,
          decision: "filtered",
          reason: "wave_budget_exhausted",
          selectedOrder: null,
          budget: task.dispatchDecision.budget!,
        },
      },
    ],
    tasks: [task],
  });
}

describe("InMemoryAgentTaskStore", () => {
  it("persists complete dispatch decisions atomically with selected tasks only", async () => {
    const store = new InMemoryAgentTaskStore();
    const plan = dispatchPlan();
    const persisted = await store.enqueuePlan(plan);

    expect(persisted.decisions).toHaveLength(2);
    expect(persisted.tasks).toHaveLength(1);
    expect(await store.list(plan.sessionId)).toHaveLength(1);
    expect((await store.listDispatchPlans(plan.sessionId))[0]).toMatchObject({
      planId: plan.planId,
      decisions: [
        { decision: { reason: "selected" } },
        { decision: { reason: "wave_budget_exhausted" } },
      ],
    });
    const replayed = await store.enqueuePlan({
      ...plan,
      tasks: [{ ...plan.tasks[0]!, taskId: "task-replayed" }],
    });
    expect(replayed.tasks[0]?.taskId).toBe("task-1");
    expect(await store.list(plan.sessionId)).toHaveLength(1);
  });

  it("claims completion-gate work before higher-priority ambient director backlog", async () => {
    const store = new InMemoryAgentTaskStore();
    await store.enqueue([
      queuedTask({
        taskId: "task-director",
        outboxId: "outbox-director",
        subscriptionId: "teaching-director/world-progress/v1",
        agentId: "agent-teaching",
        roleId: "teaching_director",
        triggerEventId: "event-evidence-recorded",
        triggerEventType: "evidence_recorded",
        priority: 90,
        idempotencyKey: "epoch-1:event-evidence-recorded:teaching-director",
      }),
      queuedTask({
        taskId: "task-evaluation",
        outboxId: "outbox-evaluation",
        subscriptionId: "agent-evidence-assessor/evaluation-case-opened/v1",
        agentId: "agent-evidence-assessor",
        roleId: "assessor",
        triggerEventId: "event-evaluation-case-opened",
        triggerEventType: "evaluation_case_opened",
        priority: 70,
        idempotencyKey: "epoch-1:event-evaluation-case-opened:evidence-assessor",
      }),
      queuedTask({
        taskId: "task-learning",
        outboxId: "outbox-learning",
        subscriptionId: "learning-curator/teacher-reviewed/v1",
        agentId: "agent-learning",
        roleId: "learning_curator",
        triggerEventId: "event-teacher-reviewed",
        triggerEventType: "teacher_reviewed",
        priority: 60,
        idempotencyKey: "epoch-1:event-teacher-reviewed:learning-curator",
      }),
    ]);

    const claim = async (leaseToken: string) => store.claimNext({
      sessionId: "session-task-store",
      sessionEpoch: "epoch-1",
      workerId: "worker-critical-lane",
      now: "2026-07-25T00:00:01.000Z",
      leaseDurationMs: 10_000,
      leaseToken,
    });
    const evaluation = await claim("lease-evaluation");
    expect(evaluation?.taskId).toBe("task-evaluation");
    await store.complete({
      taskId: evaluation!.taskId,
      leaseToken: "lease-evaluation",
      workerId: "worker-critical-lane",
      completedAt: "2026-07-25T00:00:01.100Z",
      status: "completed",
      duplicateSuppressed: false,
      attemptId: "attempt-evaluation",
    });
    const learning = await claim("lease-learning");
    expect(learning?.taskId).toBe("task-learning");
    await store.complete({
      taskId: learning!.taskId,
      leaseToken: "lease-learning",
      workerId: "worker-critical-lane",
      completedAt: "2026-07-25T00:00:01.200Z",
      status: "completed",
      duplicateSuppressed: false,
      attemptId: "attempt-learning",
    });
    expect((await claim("lease-director"))?.taskId).toBe("task-director");
  });

  it("deduplicates enqueue and rejects stale leases after recovery", async () => {
    const store = new InMemoryAgentTaskStore();
    const task = queuedTask();
    const [first] = await store.enqueue([task]);
    const [duplicate] = await store.enqueue([{ ...task, taskId: "task-random-replay" }]);
    expect(duplicate?.taskId).toBe(first?.taskId);
    expect(await store.list(task.sessionId)).toHaveLength(1);

    const claimedA = await store.claimNext({
      sessionId: task.sessionId,
      sessionEpoch: task.sessionEpoch,
      workerId: "worker-a",
      now: "2026-07-25T00:00:01.000Z",
      leaseDurationMs: 1_000,
      leaseToken: "lease-a",
    });
    expect(claimedA).toMatchObject({ status: "running", attempts: 1 });

    const claimedB = await store.claimNext({
      sessionId: task.sessionId,
      sessionEpoch: task.sessionEpoch,
      workerId: "worker-b",
      now: "2026-07-25T00:00:03.000Z",
      leaseDurationMs: 10_000,
      leaseToken: "lease-b",
    });
    expect(claimedB).toMatchObject({
      status: "running",
      attempts: 2,
      lease: { ownerId: "worker-b", token: "lease-b" },
    });
    await expect(store.complete({
      taskId: task.taskId,
      leaseToken: "lease-a",
      workerId: "worker-a",
      completedAt: "2026-07-25T00:00:04.000Z",
      status: "completed",
      duplicateSuppressed: false,
      attemptId: "attempt-stale",
    })).rejects.toBeInstanceOf(AgentTaskLeaseError);
    expect((await store.listAttempts(task.sessionId))[0]?.outcome).toBe("lease_expired");
  });

  it("retries transient failures and emits one dead letter at the attempt limit", async () => {
    const store = new InMemoryAgentTaskStore();
    const task = queuedTask({ maxAttempts: 2 });
    await store.enqueue([task]);
    const first = await store.claimNext({
      sessionId: task.sessionId,
      sessionEpoch: task.sessionEpoch,
      workerId: "worker-a",
      now: "2026-07-25T00:00:01.000Z",
      leaseDurationMs: 10_000,
      leaseToken: "lease-1",
    });
    expect(first?.lease).not.toBeNull();
    const retry = await store.fail({
      taskId: task.taskId,
      leaseToken: "lease-1",
      workerId: "worker-a",
      failedAt: "2026-07-25T00:00:02.000Z",
      errorCode: "provider_timeout",
      retryable: true,
      retryAt: "2026-07-25T00:00:03.000Z",
      attemptId: "attempt-1",
      deadLetterId: "dead-letter-unused",
    });
    expect(retry).toMatchObject({ task: { status: "queued" }, deadLetter: null });
    expect(await store.claimNext({
      sessionId: task.sessionId,
      sessionEpoch: task.sessionEpoch,
      workerId: "worker-a",
      now: "2026-07-25T00:00:02.500Z",
      leaseDurationMs: 10_000,
      leaseToken: "too-early",
    })).toBeNull();
    await store.claimNext({
      sessionId: task.sessionId,
      sessionEpoch: task.sessionEpoch,
      workerId: "worker-b",
      now: "2026-07-25T00:00:03.000Z",
      leaseDurationMs: 10_000,
      leaseToken: "lease-2",
    });
    const terminal = await store.fail({
      taskId: task.taskId,
      leaseToken: "lease-2",
      workerId: "worker-b",
      failedAt: "2026-07-25T00:00:04.000Z",
      errorCode: "provider_timeout",
      retryable: true,
      retryAt: "2026-07-25T00:00:05.000Z",
      attemptId: "attempt-2",
      deadLetterId: "dead-letter-1",
    });
    expect(terminal.task.status).toBe("failed");
    expect(terminal.deadLetter).toMatchObject({ deadLetterId: "dead-letter-1", attempts: 2 });
    expect(await store.listDeadLetters(task.sessionId)).toHaveLength(1);
  });

  it("rejects expired workers and dead-letters lease expiry at maxAttempts", async () => {
    const store = new InMemoryAgentTaskStore();
    const task = queuedTask({ maxAttempts: 1 });
    await store.enqueue([task]);
    await store.claimNext({
      sessionId: task.sessionId,
      sessionEpoch: task.sessionEpoch,
      workerId: "worker-expired",
      now: "2026-07-25T00:00:01.000Z",
      leaseDurationMs: 1_000,
      leaseToken: "lease-expired",
    });
    await expect(store.assertCurrentLease({
      taskId: task.taskId,
      leaseToken: "lease-expired",
      workerId: "worker-expired",
      now: "2026-07-25T00:00:02.000Z",
    })).rejects.toBeInstanceOf(AgentTaskLeaseError);
    expect(await store.claimNext({
      sessionId: task.sessionId,
      sessionEpoch: task.sessionEpoch,
      workerId: "worker-next",
      now: "2026-07-25T00:00:02.000Z",
      leaseDurationMs: 1_000,
      leaseToken: "lease-next",
    })).toBeNull();
    expect((await store.list(task.sessionId))[0]).toMatchObject({
      status: "failed",
      attempts: 1,
      lastErrorCode: "lease_expired",
    });
    expect(await store.listDeadLetters(task.sessionId)).toHaveLength(1);
    expect(await store.listAttempts(task.sessionId)).toHaveLength(1);
  });
});

describe("JsonlAgentTaskStore", () => {
  it("bounds full-snapshot growth and restores the latest compacted state", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ronggang-task-compaction-"));
    const path = join(directory, "tasks.jsonl");
    try {
      const store = new JsonlAgentTaskStore(path);
      for (let index = 1; index <= 24; index += 1) {
        await store.enqueue([queuedTask({
          taskId: `task-${index}`,
          outboxId: `outbox-${index}`,
          idempotencyKey: `epoch-1:event-${index}:fact-checker/material-observed/v1`,
        })]);
      }

      const frames = (await readFile(path, "utf8")).trim().split(/\r?\n/u);
      expect(frames.length).toBeLessThanOrEqual(16);
      expect(JSON.parse(frames.at(-1)!).sequence).toBe(24);

      const reopened = new JsonlAgentTaskStore(path);
      expect(await reopened.list("session-task-store")).toHaveLength(24);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps the appended snapshot authoritative when compaction fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ronggang-task-compaction-failure-"));
    const path = join(directory, "tasks.jsonl");
    try {
      const store = new JsonlAgentTaskStore(path, {
        compactSnapshot: async () => {
          throw new Error("simulated_compaction_failure");
        },
      });
      for (let index = 1; index <= 16; index += 1) {
        await store.enqueue([queuedTask({
          taskId: `failure-task-${index}`,
          outboxId: `failure-outbox-${index}`,
          idempotencyKey: `epoch-1:failure-event-${index}:fact-checker/material-observed/v1`,
        })]);
      }
      expect((await readFile(path, "utf8")).trim().split(/\r?\n/u)).toHaveLength(16);

      const reopened = new JsonlAgentTaskStore(path);
      expect(await reopened.list("session-task-store")).toHaveLength(16);
      await reopened.enqueue([queuedTask({
        taskId: "failure-task-17",
        outboxId: "failure-outbox-17",
        idempotencyKey: "epoch-1:failure-event-17:fact-checker/material-observed/v1",
      })]);
      expect((await readFile(path, "utf8")).trim().split(/\r?\n/u)).toHaveLength(1);
      expect(await new JsonlAgentTaskStore(path).list("session-task-store")).toHaveLength(17);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("continues to reject a complete non-contiguous journal frame", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ronggang-task-sequence-"));
    const path = join(directory, "tasks.jsonl");
    try {
      const store = new JsonlAgentTaskStore(path);
      await store.enqueue([queuedTask()]);
      await store.enqueue([queuedTask({
        taskId: "task-2",
        outboxId: "outbox-2",
        idempotencyKey: "epoch-1:event-2:fact-checker/material-observed/v1",
      })]);
      const frames = (await readFile(path, "utf8")).trim().split(/\r?\n/u)
        .map((line) => JSON.parse(line));
      frames[1].sequence = 3;
      await writeFile(path, `${frames.map((frame) => JSON.stringify(frame)).join("\n")}\n`, "utf8");

      await expect(new JsonlAgentTaskStore(path).list("session-task-store"))
        .rejects.toThrow("sequence is not contiguous");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("migrates format-1 tasks through definition pinning and the V1.1 scale model", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ronggang-task-migration-"));
    const path = join(directory, "tasks.jsonl");
    try {
      const legacyTask = { ...queuedTask() } as Record<string, unknown>;
      delete legacyTask.definitionVersion;
      delete legacyTask.promptVersion;
      delete legacyTask.templateRef;
      delete legacyTask.instanceRef;
      delete legacyTask.instanceContext;
      delete legacyTask.actionContext;
      delete legacyTask.experimentObservation;
      delete legacyTask.dispatchDecision;
      await writeFile(path, `${JSON.stringify({
        kind: "agent_task_snapshot",
        formatVersion: 1,
        sequence: 1,
        writtenAt: "2026-07-25T00:00:00.000Z",
        snapshot: {
          tasks: [legacyTask],
          attempts: [],
          deadLetters: [],
        },
      })}\n`, "utf8");

      const store = new JsonlAgentTaskStore(path);
      expect((await store.list("session-task-store"))[0]).toMatchObject({
        definitionVersion: "fact-checker/1.2.0",
        promptVersion: "1.2.0",
      });
      await store.claimNext({
        sessionId: "session-task-store",
        sessionEpoch: "epoch-1",
        workerId: "worker-migrated",
        now: "2026-07-25T00:00:01.000Z",
        leaseDurationMs: 10_000,
        leaseToken: "lease-migrated",
      });
      const frames = (await readFile(path, "utf8")).trim().split(/\r?\n/u);
      const migrated = JSON.parse(frames.at(-1)!);
      expect(migrated.formatVersion).toBe(3);
      expect(migrated.snapshot.tasks[0]).toMatchObject({
        templateRef: {
          templateId: "template:agent-fact-checker",
          templateVersion: "fact-checker/1.2.0",
        },
        instanceRef: {
          instanceId: "session-task-store:epoch-1:agent-fact-checker",
          instanceVersion: "fact-checker/1.2.0",
        },
        dispatchDecision: {
          affected: null,
          decision: "unobserved",
          reason: "legacy_unobserved",
          budget: null,
        },
      });
      expect(migrated.snapshot.dispatchPlans).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("survives reopen and repairs a torn final frame before the next append", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ronggang-task-store-"));
    const path = join(directory, "tasks.jsonl");
    try {
      const store = new JsonlAgentTaskStore(path);
      const task = queuedTask();
      await store.enqueue([task]);
      await store.claimNext({
        sessionId: task.sessionId,
        sessionEpoch: task.sessionEpoch,
        workerId: "worker-a",
        now: "2026-07-25T00:00:01.000Z",
        leaseDurationMs: 10_000,
        leaseToken: "lease-1",
      });
      await appendFile(path, "{\"kind\":\"agent_task_snapshot\"", "utf8");

      const reopened = new JsonlAgentTaskStore(path);
      expect((await reopened.list(task.sessionId))[0]).toMatchObject({
        taskId: task.taskId,
        status: "running",
      });
      await reopened.rebase(task.taskId, "lease-1", 12, "2026-07-25T00:00:02.000Z");
      const afterRepair = new JsonlAgentTaskStore(path);
      expect((await afterRepair.list(task.sessionId))[0]?.expectedStateVersion).toBe(12);

      const validBody = await readFile(path, "utf8");
      await writeFile(path, validBody.trimEnd(), "utf8");
      await new JsonlAgentTaskStore(path).list(task.sessionId);
      expect((await readFile(path, "utf8")).endsWith("\n")).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("restores complete dispatch plans and selected tasks after reopening", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ronggang-plan-store-"));
    const path = join(directory, "tasks.jsonl");
    try {
      const plan = dispatchPlan();
      await new JsonlAgentTaskStore(path).enqueuePlan(plan);

      const reopened = new JsonlAgentTaskStore(path);
      expect(await reopened.list(plan.sessionId)).toHaveLength(1);
      const [restored] = await reopened.listDispatchPlans(plan.sessionId);
      expect(restored).toMatchObject({
        planId: plan.planId,
        architectureProfile: plan.architectureProfile,
      });
      expect(restored?.decisions).toHaveLength(2);
      expect(restored?.tasks).toHaveLength(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
