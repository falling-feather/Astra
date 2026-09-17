import {
  AgentDispatchPlanSchema,
  AgentTaskSchema,
  DeadLetterRecordSchema,
  DispatchAttemptSchema,
  type AgentDispatchPlan,
  type AgentTask,
  type DeadLetterRecord,
  type DispatchAttempt,
} from "@ronggang/contracts";
import {
  AgentTaskLeaseError,
  type AgentTaskStore,
  type AssertAgentTaskLeaseInput,
  type ClaimAgentTaskInput,
  type CompleteAgentTaskInput,
  type FailAgentTaskInput,
  type FailAgentTaskResult,
  type ReconcileAgentTaskResultInput,
} from "./ports.js";

export interface AgentTaskStoreSnapshot {
  tasks: AgentTask[];
  attempts: DispatchAttempt[];
  deadLetters: DeadLetterRecord[];
  dispatchPlans?: AgentDispatchPlan[];
}

const completionGateTriggers = new Set<AgentTask["triggerEventType"]>([
  "evaluation_case_opened",
  "evaluation_branch_retry_requested",
  "teacher_reviewed",
  "learning_candidate_generation_retry_requested",
]);

function completionGateLane(task: AgentTask): number {
  return completionGateTriggers.has(task.triggerEventType) ? 1 : 0;
}

function compareTasks(left: AgentTask, right: AgentTask): number {
  return (
    // Evaluation and supervised-learning gates are on the user-visible
    // completion path. They must not starve behind an accumulated stream of
    // non-blocking director observations. The persisted task priority remains
    // unchanged, so crash recovery and idempotency payloads stay compatible.
    completionGateLane(right) - completionGateLane(left)
    || right.priority - left.priority
    || Date.parse(left.availableAt) - Date.parse(right.availableAt)
    || Date.parse(left.createdAt) - Date.parse(right.createdAt)
    || left.taskId.localeCompare(right.taskId)
  );
}

function assertLease(
  task: AgentTask,
  leaseToken: string,
  workerId?: string,
  now?: string,
): NonNullable<AgentTask["lease"]> {
  if (task.status !== "running" || !task.lease) {
    throw new AgentTaskLeaseError(`任务没有有效租约：${task.taskId}`);
  }
  if (task.lease.token !== leaseToken || (workerId && task.lease.ownerId !== workerId)) {
    throw new AgentTaskLeaseError(`任务租约不匹配：${task.taskId}`);
  }
  if (now && Date.parse(task.lease.expiresAt) <= Date.parse(now)) {
    throw new AgentTaskLeaseError(`任务租约已经过期：${task.taskId}`);
  }
  return task.lease;
}

export class InMemoryAgentTaskStore implements AgentTaskStore {
  readonly #tasks = new Map<string, AgentTask>();
  readonly #taskIdsByIdempotencyKey = new Map<string, string>();
  readonly #dispatchPlans = new Map<string, AgentDispatchPlan>();
  readonly #attempts: DispatchAttempt[] = [];
  readonly #deadLetters: DeadLetterRecord[] = [];

  constructor(snapshot: AgentTaskStoreSnapshot = {
    tasks: [],
    attempts: [],
    deadLetters: [],
    dispatchPlans: [],
  }) {
    for (const rawTask of snapshot.tasks) {
      const task = AgentTaskSchema.parse(rawTask);
      this.#tasks.set(task.taskId, structuredClone(task));
      this.#taskIdsByIdempotencyKey.set(task.idempotencyKey, task.taskId);
    }
    this.#attempts.push(...snapshot.attempts.map((attempt) => DispatchAttemptSchema.parse(attempt)));
    this.#deadLetters.push(...snapshot.deadLetters.map((record) => DeadLetterRecordSchema.parse(record)));
    for (const rawPlan of snapshot.dispatchPlans ?? []) {
      const plan = AgentDispatchPlanSchema.parse(rawPlan);
      this.#dispatchPlans.set(plan.planId, structuredClone(plan));
    }
  }

  snapshot(): AgentTaskStoreSnapshot {
    return {
      tasks: [...this.#tasks.values()].map((task) => structuredClone(task)),
      attempts: structuredClone(this.#attempts),
      deadLetters: structuredClone(this.#deadLetters),
      dispatchPlans: [...this.#dispatchPlans.values()]
        .map((plan) => structuredClone(plan)),
    };
  }

  async enqueuePlan(rawPlan: AgentDispatchPlan): Promise<AgentDispatchPlan> {
    const plan = AgentDispatchPlanSchema.parse(rawPlan);
    const existingPlan = this.#dispatchPlans.get(plan.planId);
    if (existingPlan) {
      if (
        existingPlan.sessionId !== plan.sessionId
        || existingPlan.outboxId !== plan.outboxId
        || existingPlan.architectureProfile.policyHash
          !== plan.architectureProfile.policyHash
      ) {
        throw new Error(`调度计划 ID 冲突：${plan.planId}`);
      }
      return structuredClone(existingPlan);
    }

    const pendingTasks: AgentTask[] = [];
    const canonicalTasks: AgentTask[] = [];
    const seenTaskIds = new Set<string>();
    const seenIdempotencyKeys = new Set<string>();
    for (const task of plan.tasks) {
      if (
        seenTaskIds.has(task.taskId)
        || seenIdempotencyKeys.has(task.idempotencyKey)
      ) {
        throw new Error(`调度计划包含重复任务：${plan.planId}`);
      }
      seenTaskIds.add(task.taskId);
      seenIdempotencyKeys.add(task.idempotencyKey);
      const existingTaskId = this.#taskIdsByIdempotencyKey.get(
        task.idempotencyKey,
      );
      if (existingTaskId) {
        const existingTask = this.#tasks.get(existingTaskId);
        if (!existingTask) {
          throw new Error(`任务幂等索引损坏：${task.idempotencyKey}`);
        }
        if (
          existingTask.dispatchDecision.decisionId
          !== task.dispatchDecision.decisionId
        ) {
          throw new Error(`任务已属于其他调度决定：${task.idempotencyKey}`);
        }
        canonicalTasks.push(structuredClone(existingTask));
        continue;
      }
      if (this.#tasks.has(task.taskId)) {
        throw new Error(`任务 ID 重复但幂等键不同：${task.taskId}`);
      }
      pendingTasks.push(task);
      canonicalTasks.push(task);
    }

    const canonicalPlan = AgentDispatchPlanSchema.parse({
      ...plan,
      tasks: canonicalTasks,
    });
    for (const task of pendingTasks) {
      this.#tasks.set(task.taskId, structuredClone(task));
      this.#taskIdsByIdempotencyKey.set(task.idempotencyKey, task.taskId);
    }
    this.#dispatchPlans.set(
      canonicalPlan.planId,
      structuredClone(canonicalPlan),
    );
    return structuredClone(canonicalPlan);
  }

  async enqueue(rawTasks: readonly AgentTask[]): Promise<AgentTask[]> {
    const canonical: AgentTask[] = [];
    for (const rawTask of rawTasks) {
      const task = AgentTaskSchema.parse(rawTask);
      const existingTaskId = this.#taskIdsByIdempotencyKey.get(task.idempotencyKey);
      if (existingTaskId) {
        const existing = this.#tasks.get(existingTaskId);
        if (!existing) throw new Error(`任务幂等索引损坏：${task.idempotencyKey}`);
        canonical.push(structuredClone(existing));
        continue;
      }
      if (this.#tasks.has(task.taskId)) {
        throw new Error(`任务 ID 重复但幂等键不同：${task.taskId}`);
      }
      this.#tasks.set(task.taskId, structuredClone(task));
      this.#taskIdsByIdempotencyKey.set(task.idempotencyKey, task.taskId);
      canonical.push(structuredClone(task));
    }
    return canonical;
  }

  async claimNext(input: ClaimAgentTaskInput): Promise<AgentTask | null> {
    const nowMs = Date.parse(input.now);
    if (!Number.isFinite(nowMs)) throw new Error(`无效领取时间：${input.now}`);
    if (input.leaseDurationMs <= 0) throw new Error("租约时长必须大于 0");

    for (const [taskId, task] of this.#tasks) {
      if (
        task.sessionId !== input.sessionId
        || task.sessionEpoch !== input.sessionEpoch
        || task.status !== "running"
        || !task.lease
        || Date.parse(task.lease.expiresAt) > nowMs
      ) {
        continue;
      }
      this.#attempts.push(DispatchAttemptSchema.parse({
        attemptId: `lease-expired:${task.taskId}:${task.attempts}`,
        taskId: task.taskId,
        sessionId: task.sessionId,
        attemptNumber: Math.max(1, task.attempts),
        workerId: task.lease.ownerId,
        startedAt: task.lease.acquiredAt,
        completedAt: input.now,
        outcome: "lease_expired",
        errorCode: "lease_expired",
      }));
      if (task.attempts >= task.maxAttempts) {
        this.#tasks.set(taskId, AgentTaskSchema.parse({
          ...task,
          status: "failed",
          lease: null,
          updatedAt: input.now,
          completedAt: input.now,
          lastErrorCode: "lease_expired",
        }));
        if (!this.#deadLetters.some((record) => record.taskId === task.taskId)) {
          this.#deadLetters.push(DeadLetterRecordSchema.parse({
            deadLetterId: `dead-letter:lease-expired:${task.taskId}`,
            taskId: task.taskId,
            sessionId: task.sessionId,
            idempotencyKey: task.idempotencyKey,
            reasonCode: "lease_expired",
            attempts: task.attempts,
            createdAt: input.now,
          }));
        }
      } else {
        this.#tasks.set(taskId, AgentTaskSchema.parse({
          ...task,
          status: "queued",
          lease: null,
          availableAt: input.now,
          updatedAt: input.now,
          lastErrorCode: "lease_expired",
        }));
      }
    }

    const candidate = [...this.#tasks.values()]
      .filter((task) => (
        task.sessionId === input.sessionId
        && task.sessionEpoch === input.sessionEpoch
        && task.status === "queued"
        && task.attempts < task.maxAttempts
        && Date.parse(task.availableAt) <= nowMs
      ))
      .sort(compareTasks)[0];
    if (!candidate) return null;

    const claimed = AgentTaskSchema.parse({
      ...candidate,
      status: "running",
      attempts: candidate.attempts + 1,
      lease: {
        ownerId: input.workerId,
        token: input.leaseToken,
        acquiredAt: input.now,
        expiresAt: new Date(nowMs + input.leaseDurationMs).toISOString(),
      },
      updatedAt: input.now,
    });
    this.#tasks.set(claimed.taskId, claimed);
    return structuredClone(claimed);
  }

  async assertCurrentLease(input: AssertAgentTaskLeaseInput): Promise<AgentTask> {
    const task = this.#tasks.get(input.taskId);
    if (!task) throw new Error(`任务不存在：${input.taskId}`);
    assertLease(task, input.leaseToken, input.workerId, input.now);
    return structuredClone(task);
  }

  async rebase(
    taskId: string,
    leaseToken: string,
    expectedStateVersion: number,
    updatedAt: string,
  ): Promise<AgentTask> {
    const task = this.#tasks.get(taskId);
    if (!task) throw new Error(`任务不存在：${taskId}`);
    assertLease(task, leaseToken, undefined, updatedAt);
    const rebased = AgentTaskSchema.parse({
      ...task,
      expectedStateVersion,
      updatedAt,
    });
    this.#tasks.set(taskId, rebased);
    return structuredClone(rebased);
  }

  async complete(input: CompleteAgentTaskInput): Promise<AgentTask> {
    const task = this.#tasks.get(input.taskId);
    if (!task) throw new Error(`任务不存在：${input.taskId}`);
    const lease = assertLease(task, input.leaseToken, input.workerId, input.completedAt);
    const completed = AgentTaskSchema.parse({
      ...task,
      status: input.status,
      lease: null,
      lastErrorCode: null,
      updatedAt: input.completedAt,
      completedAt: input.completedAt,
    });
    this.#tasks.set(task.taskId, completed);
    this.#attempts.push(DispatchAttemptSchema.parse({
      attemptId: input.attemptId,
      taskId: task.taskId,
      sessionId: task.sessionId,
      attemptNumber: task.attempts,
      workerId: input.workerId,
      startedAt: lease.acquiredAt,
      completedAt: input.completedAt,
      outcome: input.duplicateSuppressed ? "duplicate_suppressed" : input.status,
      errorCode: null,
    }));
    return structuredClone(completed);
  }

  async reconcileWorldResult(input: ReconcileAgentTaskResultInput): Promise<AgentTask> {
    const task = this.#tasks.get(input.taskId);
    if (!task) throw new Error(`任务不存在：${input.taskId}`);
    if (task.status === "completed" || task.status === "degraded") {
      for (let index = this.#deadLetters.length - 1; index >= 0; index -= 1) {
        if (this.#deadLetters[index]?.taskId === task.taskId) this.#deadLetters.splice(index, 1);
      }
      return structuredClone(task);
    }
    if (this.#attempts.some((attempt) => attempt.attemptId === input.attemptId)) {
      throw new Error(`任务尝试 ID 重复：${input.attemptId}`);
    }
    const reconciled = AgentTaskSchema.parse({
      ...task,
      status: input.status,
      lease: null,
      lastErrorCode: null,
      updatedAt: input.reconciledAt,
      completedAt: input.reconciledAt,
    });
    this.#tasks.set(task.taskId, reconciled);
    for (let index = this.#deadLetters.length - 1; index >= 0; index -= 1) {
      if (this.#deadLetters[index]?.taskId === task.taskId) this.#deadLetters.splice(index, 1);
    }
    this.#attempts.push(DispatchAttemptSchema.parse({
      attemptId: input.attemptId,
      taskId: task.taskId,
      sessionId: task.sessionId,
      attemptNumber: Math.max(1, task.attempts),
      workerId: input.workerId,
      startedAt: task.lease?.acquiredAt ?? task.updatedAt,
      completedAt: input.reconciledAt,
      outcome: "duplicate_suppressed",
      errorCode: null,
    }));
    return structuredClone(reconciled);
  }

  async fail(input: FailAgentTaskInput): Promise<FailAgentTaskResult> {
    const task = this.#tasks.get(input.taskId);
    if (!task) throw new Error(`任务不存在：${input.taskId}`);
    const lease = assertLease(task, input.leaseToken, input.workerId, input.failedAt);
    const shouldRetry = input.retryable && task.attempts < task.maxAttempts;
    const updated = AgentTaskSchema.parse({
      ...task,
      status: shouldRetry ? "queued" : "failed",
      lease: null,
      availableAt: shouldRetry ? input.retryAt : task.availableAt,
      lastErrorCode: input.errorCode,
      updatedAt: input.failedAt,
      completedAt: shouldRetry ? null : input.failedAt,
    });
    this.#tasks.set(task.taskId, updated);
    this.#attempts.push(DispatchAttemptSchema.parse({
      attemptId: input.attemptId,
      taskId: task.taskId,
      sessionId: task.sessionId,
      attemptNumber: task.attempts,
      workerId: input.workerId,
      startedAt: lease.acquiredAt,
      completedAt: input.failedAt,
      outcome: shouldRetry ? "retry_scheduled" : "dead_lettered",
      errorCode: input.errorCode,
    }));

    let deadLetter: DeadLetterRecord | null = null;
    if (!shouldRetry) {
      deadLetter = DeadLetterRecordSchema.parse({
        deadLetterId: input.deadLetterId,
        taskId: task.taskId,
        sessionId: task.sessionId,
        idempotencyKey: task.idempotencyKey,
        reasonCode: input.errorCode,
        attempts: task.attempts,
        createdAt: input.failedAt,
      });
      if (!this.#deadLetters.some((record) => record.taskId === task.taskId)) {
        this.#deadLetters.push(deadLetter);
      } else {
        deadLetter = this.#deadLetters.find((record) => record.taskId === task.taskId) ?? deadLetter;
      }
    }
    return {
      task: structuredClone(updated),
      deadLetter: deadLetter ? structuredClone(deadLetter) : null,
    };
  }

  async list(sessionId: string): Promise<AgentTask[]> {
    return [...this.#tasks.values()]
      .filter((task) => task.sessionId === sessionId)
      .sort(compareTasks)
      .map((task) => structuredClone(task));
  }

  async listDispatchPlans(sessionId: string): Promise<AgentDispatchPlan[]> {
    return [...this.#dispatchPlans.values()]
      .filter((plan) => plan.sessionId === sessionId)
      .sort((left, right) => (
        Date.parse(left.createdAt) - Date.parse(right.createdAt)
        || left.planId.localeCompare(right.planId)
      ))
      .map((plan) => structuredClone(plan));
  }

  async listAttempts(sessionId: string): Promise<DispatchAttempt[]> {
    return structuredClone(this.#attempts.filter((attempt) => attempt.sessionId === sessionId));
  }

  async listDeadLetters(sessionId: string): Promise<DeadLetterRecord[]> {
    return structuredClone(this.#deadLetters.filter((record) => record.sessionId === sessionId));
  }

  async reset(sessionId: string): Promise<void> {
    for (const [taskId, task] of this.#tasks) {
      if (task.sessionId !== sessionId) continue;
      this.#tasks.delete(taskId);
      this.#taskIdsByIdempotencyKey.delete(task.idempotencyKey);
    }
    for (let index = this.#attempts.length - 1; index >= 0; index -= 1) {
      if (this.#attempts[index]?.sessionId === sessionId) this.#attempts.splice(index, 1);
    }
    for (let index = this.#deadLetters.length - 1; index >= 0; index -= 1) {
      if (this.#deadLetters[index]?.sessionId === sessionId) this.#deadLetters.splice(index, 1);
    }
    for (const [planId, plan] of this.#dispatchPlans) {
      if (plan.sessionId === sessionId) this.#dispatchPlans.delete(planId);
    }
  }
}
