import {
  AgentScheduler,
  AgentSchedulerConfigurationError,
  agentDebounceKey,
  assistanceProfilesByAgentId,
  assistanceSubscriptions,
  createAssistanceRoleSnapshot,
  factCheckerSubscription,
  learningCuratorSubscription,
  materializeAgentInstances,
  productionAgentTemplateCatalog,
  roleAgentSubscriptions,
  semanticEvaluatorSubscriptions,
  semanticEvaluatorRetrySubscriptions,
  sceneDirectorSubscription,
  teachingDirectorSubscription,
} from "@ronggang/agent-runtime";
import {
  AgentRunResultSchema,
  type AgentArchitectureProfile,
  type AgentInstance,
  type AgentInstanceContext,
  type AgentSubscription,
  type AgentTask,
  type AgentTemplateCatalogEntry,
  type ExperimentObservationRef,
  type OutboxRecord,
  type RoleContract,
  type ScenarioPackage,
  type WorldEvent,
} from "@ronggang/contracts";
import {
  roleBindingConfigHash,
  roleMemoryNamespace,
  createScopedAgentInstanceBinding,
} from "@ronggang/context-engine";
import {
  InvalidWorldActionError,
  PermissionDeniedError,
  SessionNotFoundError,
  StateVersionConflictError,
  type WorldEngine,
  type WorldState,
} from "@ronggang/world-core";
import {
  AgentTaskLeaseError,
  AgentTaskHandlerNotFoundError,
  type AgentTaskHandler,
  type AgentTaskStore,
} from "./ports.js";

export interface TrainingSessionOrchestratorOptions {
  world: WorldEngine;
  taskStore: AgentTaskStore;
  handlers: readonly AgentTaskHandler[];
  scheduler?: AgentScheduler;
  workerId?: string;
  leaseDurationMs?: number;
  retryDelayMs?: number;
  maxTasksPerDrain?: number;
  architectureProfile?: AgentArchitectureProfile | null;
  experimentObservation?: ExperimentObservationRef | null;
  now?: () => string;
  nextId?: (prefix: string) => string;
  onBackgroundError?: (error: unknown) => void;
}

class AgentRunFailedError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(`智能体运行失败：${code}`);
    this.name = "AgentRunFailedError";
    this.code = code;
  }
}

function taskErrorCode(error: unknown): string {
  if (error instanceof StateVersionConflictError) return "state_version_conflict";
  if (error instanceof AgentTaskHandlerNotFoundError) return "handler_not_found";
  if (error instanceof PermissionDeniedError) return "permission_denied";
  if (error instanceof InvalidWorldActionError) return "invalid_world_action";
  if (error instanceof SessionNotFoundError) return "session_not_found";
  if (
    error
    && typeof error === "object"
    && "code" in error
    && typeof error.code === "string"
    && error.code.length > 0
  ) {
    return error.code;
  }
  if (error instanceof Error && error.name) {
    return error.name
      .replace(/([a-z])([A-Z])/gu, "$1_$2")
      .replaceAll(" ", "_")
      .toLowerCase();
  }
  return "unknown_error";
}

function isRetryable(error: unknown): boolean {
  if (error instanceof StateVersionConflictError) return true;
  if (
    error
    && typeof error === "object"
    && "retryable" in error
    && error.retryable === false
  ) {
    return false;
  }
  if (
    error instanceof AgentTaskHandlerNotFoundError
    || error instanceof PermissionDeniedError
    || error instanceof InvalidWorldActionError
    || error instanceof SessionNotFoundError
  ) {
    return false;
  }
  return true;
}

function sortOutbox(left: OutboxRecord, right: OutboxRecord): number {
  return left.stateVersion - right.stateVersion || left.outboxId.localeCompare(right.outboxId);
}

function instanceBindingKind(
  role: RoleContract,
): AgentInstanceContext["bindingKind"] {
  if (role.actorKind === "student") return "student_role";
  if (role.actorKind === "system" || role.roleId === "system") return "system";
  if (
    role.roleId === "interviewee"
    || role.roleId === "copyright_owner"
    || role.roleId === "editor_in_chief"
    || role.roleId === "platform_operator"
  ) {
    return "npc";
  }
  return "teacher_assistant";
}

function createInstanceContexts(
  scenario: ScenarioPackage,
  sessionId: string,
  sessionEpoch: string,
): ReadonlyMap<string, AgentInstanceContext> {
  return new Map(scenario.roles.map((role) => {
    const bindingKind = instanceBindingKind(role);
    const bindingId = [
      "role-binding",
      scenario.courseId,
      role.roleId,
      role.agentId,
    ].join(":");
    const privateMemoryNamespaceRef = roleMemoryNamespace({
      sessionId,
      sessionEpoch,
      teamId: role.teamId,
      actorId: role.agentId,
    });
    const configHash = roleBindingConfigHash({
      scenarioId: scenario.scenarioId,
      scenarioVersion: scenario.version,
      role,
    });
    return [
      role.agentId,
      {
        bindingKind,
        bindingId,
        actorId: role.agentId,
        actorKind: role.actorKind,
        courseId: scenario.courseId,
        teamId: role.teamId,
        privateMemoryNamespaceRef,
        configHash,
        lifecycle: "active",
        subjectActorId: null,
        subjectRoleId: null,
        resourceRef: null,
      } satisfies AgentInstanceContext,
    ] as const;
  }));
}

function firstRole(
  scenario: ScenarioPackage,
  predicate: (role: RoleContract) => boolean,
): RoleContract {
  const role = scenario.roles.find(predicate);
  if (!role) {
    throw new AgentSchedulerConfigurationError(
      "按需辅助模板找不到授权主体岗位",
    );
  }
  return role;
}

function assistanceSubjectRole(
  state: WorldState,
  event: WorldEvent,
  subscription: AgentSubscription,
): {
  subjectRole: RoleContract;
  lifecycle: "active" | "paused";
  resourceRef: {
    objectType: string;
    objectId: string;
    version: string;
  } | null;
  bindingKind: "student_role" | "teacher_assistant" | "resource";
} {
  const profile = assistanceProfilesByAgentId.get(subscription.agentId);
  if (!profile) {
    throw new AgentSchedulerConfigurationError(
      `按需辅助模板未登记：${subscription.agentId}`,
    );
  }
  const firstStudent = () => firstRole(
    state.scenario,
    (role) => role.actorKind === "student",
  );
  const teacher = () => firstRole(
    state.scenario,
    (role) => role.actorKind === "teacher",
  );
  if (
    profile.instanceStrategy === "evidence_actor"
    || profile.instanceStrategy === "event_actor"
  ) {
    const evidenceActorId = (
      event.payload.evidence as { actorId?: unknown } | undefined
    )?.actorId;
    const requestedActorId = profile.instanceStrategy === "evidence_actor"
      && typeof evidenceActorId === "string"
      ? evidenceActorId
      : event.actorId;
    const exact = state.scenario.roles.find(
      (role) => role.agentId === requestedActorId,
    );
    const subjectRole = exact?.actorKind === "student"
      ? exact
      : firstStudent();
    return {
      subjectRole,
      lifecycle: exact?.actorKind === "student" ? "active" : "paused",
      resourceRef: null,
      bindingKind: "student_role",
    };
  }
  if (profile.instanceStrategy === "media_task_requester") {
    const taskId = String(event.payload.taskId ?? "");
    const mediaTask = state.mediaProcessingTasks.find(
      (task) => task.taskId === taskId,
    );
    if (!mediaTask) {
      throw new AgentSchedulerConfigurationError(
        `材料辅助触发事件引用未知处理档案：${taskId}`,
      );
    }
    const subjectRole = firstRole(
      state.scenario,
      (role) => role.agentId === mediaTask.requestedBy,
    );
    return {
      subjectRole,
      lifecycle: subjectRole.actorKind === "student" ? "active" : "paused",
      resourceRef: {
        objectType: "media_processing_task",
        objectId: mediaTask.taskId,
        version: mediaTask.inputContentHash,
      },
      bindingKind: "resource",
    };
  }
  if (profile.instanceStrategy === "artifact_author") {
    const artifact = event.payload.artifact as {
      ownerActorId?: unknown;
    } | undefined;
    const revision = event.payload.revision as {
      revisionId?: unknown;
      contentHash?: unknown;
    } | undefined;
    const subjectRole = typeof artifact?.ownerActorId === "string"
      ? firstRole(
          state.scenario,
          (role) => role.agentId === artifact.ownerActorId,
        )
      : firstStudent();
    if (
      typeof revision?.revisionId !== "string"
      || typeof revision.contentHash !== "string"
    ) {
      throw new AgentSchedulerConfigurationError(
        "内容适配触发事件缺少精确成果修订",
      );
    }
    return {
      subjectRole,
      lifecycle: subjectRole.actorKind === "student" ? "active" : "paused",
      resourceRef: {
        objectType: "artifact_revision",
        objectId: revision.revisionId,
        version: revision.contentHash,
      },
      bindingKind: "resource",
    };
  }
  const subjectRole = teacher();
  if (profile.kind === "evaluation_review") {
    const arbitration = event.payload.arbitration as {
      arbitrationId?: unknown;
      decisionHash?: unknown;
    } | undefined;
    if (
      typeof arbitration?.arbitrationId !== "string"
      || typeof arbitration.decisionHash !== "string"
    ) {
      throw new AgentSchedulerConfigurationError(
        "评价复核触发事件缺少精确仲裁快照",
      );
    }
    return {
      subjectRole,
      lifecycle: "active",
      resourceRef: {
        objectType: "evaluation_arbitration",
        objectId: arbitration.arbitrationId,
        version: arbitration.decisionHash,
      },
      bindingKind: "resource",
    };
  }
  return {
    subjectRole,
    lifecycle: "active",
    resourceRef: null,
    bindingKind: "teacher_assistant",
  };
}

function resolveAgentInstance(
  state: WorldState,
  event: WorldEvent,
  subscription: AgentSubscription,
  standardContexts: ReadonlyMap<string, AgentInstanceContext>,
) {
  const profile = assistanceProfilesByAgentId.get(subscription.agentId);
  if (!profile) {
    const instanceContext = standardContexts.get(subscription.agentId);
    if (!instanceContext) {
      throw new AgentSchedulerConfigurationError(
        `固定智能体缺少实例上下文：${subscription.agentId}`,
      );
    }
    return {
      instanceRef: {
        instanceId: `${event.sessionId}:${state.sessionEpoch}:${subscription.agentId}`,
        instanceVersion: subscription.definitionVersion,
      },
      instanceContext,
      roleSnapshot: null,
    };
  }
  const resolved = assistanceSubjectRole(state, event, subscription);
  return createScopedAgentInstanceBinding({
    templateRef: subscription.templateRef,
    definitionVersion: subscription.definitionVersion,
    roleSnapshot: createAssistanceRoleSnapshot(
      profile,
      resolved.subjectRole.teamId,
    ),
    scenarioId: state.scenario.scenarioId,
    scenarioVersion: state.scenario.version,
    courseId: state.scenario.courseId,
    sessionId: state.sessionId,
    sessionEpoch: state.sessionEpoch,
    bindingKind: resolved.bindingKind,
    subjectRole: resolved.subjectRole,
    resourceRef: resolved.resourceRef,
    lifecycle: resolved.lifecycle,
  });
}

interface ScheduledWake {
  timer: ReturnType<typeof setTimeout>;
  dueAt: number;
}

export class TrainingSessionOrchestrator {
  readonly #world: WorldEngine;
  readonly #taskStore: AgentTaskStore;
  readonly #handlers: readonly AgentTaskHandler[];
  readonly #scheduler: AgentScheduler;
  readonly #workerId: string;
  readonly #leaseDurationMs: number;
  readonly #retryDelayMs: number;
  readonly #maxTasksPerDrain: number;
  readonly #architectureProfile: AgentArchitectureProfile | null;
  readonly #experimentObservation: ExperimentObservationRef | null;
  readonly #now: () => string;
  readonly #nextId: (prefix: string) => string;
  readonly #onBackgroundError: (error: unknown) => void;
  readonly #running = new Map<string, Promise<void>>();
  readonly #unsubscribers = new Map<string, () => void>();
  readonly #wakeTimers = new Map<string, ScheduledWake>();
  readonly #wakeRequested = new Set<string>();
  readonly #paused = new Set<string>();
  readonly #generations = new Map<string, number>();
  readonly #sessionOperationTails = new Map<string, Promise<void>>();
  #stopped = false;

  constructor(options: TrainingSessionOrchestratorOptions) {
    this.#world = options.world;
    this.#taskStore = options.taskStore;
    this.#handlers = options.handlers;
    const handlerIds = new Set(options.handlers.map((handler) => handler.handlerId));
    this.#scheduler = options.scheduler ?? new AgentScheduler([
      factCheckerSubscription,
      ...roleAgentSubscriptions,
      ...(handlerIds.has("teaching-director/world-progress/v1")
        ? [teachingDirectorSubscription]
        : []),
      ...(handlerIds.has("scene-director/world-pressure/v1")
        ? [sceneDirectorSubscription]
        : []),
      ...(handlerIds.has("evaluation/semantic/v1")
        ? [
            ...semanticEvaluatorSubscriptions,
            ...semanticEvaluatorRetrySubscriptions,
          ]
        : []),
      ...(handlerIds.has("learning-curator/teacher-reviewed/v1")
        ? [learningCuratorSubscription]
        : []),
      ...(handlerIds.has("assistance/full-flow/v1")
        ? assistanceSubscriptions
        : []),
    ], {
      templateCatalog: productionAgentTemplateCatalog,
    });
    this.#workerId = options.workerId ?? `worker-${crypto.randomUUID()}`;
    this.#leaseDurationMs = options.leaseDurationMs ?? 45_000;
    this.#retryDelayMs = options.retryDelayMs ?? 1_000;
    this.#maxTasksPerDrain = options.maxTasksPerDrain ?? 32;
    this.#architectureProfile = options.architectureProfile ?? null;
    this.#experimentObservation = options.experimentObservation ?? null;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#nextId = options.nextId ?? ((prefix) => `${prefix}-${crypto.randomUUID()}`);
    this.#onBackgroundError = options.onBackgroundError ?? ((error) => {
      console.error("[agent-orchestrator]", error);
    });
  }

  start(sessionIds: readonly string[]): void {
    this.#stopped = false;
    for (const sessionId of sessionIds) {
      if (!this.#unsubscribers.has(sessionId)) {
        const unsubscribe = this.#world.bus.subscribe(sessionId, () => {
          this.wake(sessionId);
        });
        this.#unsubscribers.set(sessionId, unsubscribe);
      }
      this.wake(sessionId);
    }
  }

  wake(sessionId: string): void {
    if (this.#stopped) return;
    this.#wakeRequested.add(sessionId);
    if (this.#paused.has(sessionId) || this.#running.has(sessionId)) return;
    this.#scheduleWake(sessionId, 0);
  }

  #scheduleWake(sessionId: string, delayMs: number): void {
    if (this.#stopped || this.#paused.has(sessionId)) return;
    const safeDelay = Math.max(0, Math.min(delayMs, 2_147_483_647));
    const dueAt = Date.now() + safeDelay;
    const existing = this.#wakeTimers.get(sessionId);
    if (existing && existing.dueAt <= dueAt) return;
    if (existing) clearTimeout(existing.timer);
    const timer = setTimeout(() => {
      const scheduled = this.#wakeTimers.get(sessionId);
      if (!scheduled || scheduled.timer !== timer) return;
      this.#wakeTimers.delete(sessionId);
      this.#wakeRequested.add(sessionId);
      void this.drain(sessionId).catch(this.#onBackgroundError);
    }, safeDelay);
    timer.unref?.();
    this.#wakeTimers.set(sessionId, { timer, dueAt });
  }

  #scheduleWakeAt(sessionId: string, timestamp: string): void {
    const target = Date.parse(timestamp);
    const now = Date.parse(this.#now());
    if (!Number.isFinite(target) || !Number.isFinite(now)) return;
    this.#scheduleWake(sessionId, Math.max(0, target - now));
  }

  async runSessionOperation<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#sessionOperationTails.get(sessionId) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const next = result.then(() => undefined, () => undefined);
    this.#sessionOperationTails.set(sessionId, next);
    try {
      return await result;
    } finally {
      if (this.#sessionOperationTails.get(sessionId) === next) {
        this.#sessionOperationTails.delete(sessionId);
      }
    }
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    for (const scheduled of this.#wakeTimers.values()) clearTimeout(scheduled.timer);
    this.#wakeTimers.clear();
    this.#wakeRequested.clear();
    for (const unsubscribe of this.#unsubscribers.values()) unsubscribe();
    this.#unsubscribers.clear();
    await Promise.allSettled(this.#running.values());
  }

  async resetSession<T>(sessionId: string, rebuildWorld: () => Promise<T>): Promise<T> {
    return this.runSessionOperation(sessionId, async () => {
      this.#paused.add(sessionId);
      this.#generations.set(sessionId, (this.#generations.get(sessionId) ?? 0) + 1);
      this.#wakeRequested.delete(sessionId);
      const scheduled = this.#wakeTimers.get(sessionId);
      if (scheduled) {
        clearTimeout(scheduled.timer);
        this.#wakeTimers.delete(sessionId);
      }
      const running = this.#running.get(sessionId);
      if (running) await running.catch(() => undefined);
      let rebuilt = false;
      try {
        const result = await rebuildWorld();
        rebuilt = true;
        return result;
      } finally {
        this.#paused.delete(sessionId);
        if (rebuilt) {
          this.#wakeRequested.add(sessionId);
          this.#scheduleWake(sessionId, 0);
        }
      }
    });
  }

  listAgentTemplates(): AgentTemplateCatalogEntry[] {
    return productionAgentTemplateCatalog.list();
  }

  async listAgentInstances(sessionId: string): Promise<AgentInstance[]> {
    return materializeAgentInstances(await this.#taskStore.list(sessionId));
  }

  #isGenerationActive(sessionId: string, generation: number): boolean {
    return (
      !this.#stopped
      && !this.#paused.has(sessionId)
      && (this.#generations.get(sessionId) ?? 0) === generation
    );
  }

  async drain(sessionId: string): Promise<void> {
    const existing = this.#running.get(sessionId);
    if (existing) {
      this.#wakeRequested.add(sessionId);
      return existing;
    }
    if (this.#stopped || this.#paused.has(sessionId)) return;
    this.#wakeRequested.delete(sessionId);
    const generation = this.#generations.get(sessionId) ?? 0;
    const run = this.#drainUnlocked(sessionId, generation);
    this.#running.set(sessionId, run);
    let failed = false;
    try {
      await run;
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      if (this.#running.get(sessionId) === run) this.#running.delete(sessionId);
      if (
        !this.#stopped
        && !this.#paused.has(sessionId)
        && this.#wakeRequested.delete(sessionId)
      ) {
        this.#scheduleWake(sessionId, 0);
      } else if (failed && this.#isGenerationActive(sessionId, generation)) {
        this.#scheduleWake(sessionId, this.#retryDelayMs);
      }
    }
  }

  async drainUntilIdle(sessionId: string, maxWaves = 16): Promise<void> {
    for (let wave = 0; wave < maxWaves; wave += 1) {
      const scheduled = this.#wakeTimers.get(sessionId);
      if (scheduled && scheduled.dueAt <= Date.now()) {
        clearTimeout(scheduled.timer);
        this.#wakeTimers.delete(sessionId);
      }
      await this.drain(sessionId);
      const now = Date.parse(this.#now());
      const [journal, tasks] = await Promise.all([
        this.#world.store.loadJournalSnapshot(sessionId),
        this.#taskStore.list(sessionId),
      ]);
      const hasDueOutbox = journal.outbox.some((record) => (
        record.status === "pending" && Date.parse(record.availableAt) <= now
      ));
      const hasDueTask = tasks.some((task) => (
        (
          task.status === "running"
          && (
            !task.lease
            || Date.parse(task.lease.expiresAt) <= now
          )
        )
        || (task.status === "queued" && Date.parse(task.availableAt) <= now)
      ));
      if (!hasDueOutbox && !hasDueTask) {
        const trailingWake = this.#wakeTimers.get(sessionId);
        if (trailingWake && trailingWake.dueAt <= Date.now()) {
          clearTimeout(trailingWake.timer);
          this.#wakeTimers.delete(sessionId);
        }
        this.#wakeRequested.delete(sessionId);
        return;
      }
    }
    throw new Error(`智能体事件波在 ${maxWaves} 轮内未进入空闲状态：${sessionId}`);
  }

  async #dispatchOutbox(
    sessionId: string,
    state: WorldState,
    generation: number,
  ): Promise<void> {
    const sessionEpoch = state.sessionEpoch;
    const [journal, existingTasks] = await Promise.all([
      this.#world.store.loadJournalSnapshot(sessionId),
      this.#taskStore.list(sessionId),
    ]);
    const eventsById = new Map(journal.events.map((event) => [event.eventId, event]));
    const completedKeys = new Set(
      existingTasks
        .filter((task) => ["completed", "degraded", "failed", "skipped"].includes(task.status))
        .map((task) => task.idempotencyKey),
    );
    const recentlyScheduledAtByInstanceSubscription = new Map<string, string>();
    for (const task of existingTasks) {
      if (task.dispatchDecision.decision !== "selected") continue;
      const key = agentDebounceKey(
        task.instanceRef.instanceId,
        task.subscriptionId,
      );
      const previous = recentlyScheduledAtByInstanceSubscription.get(key);
      if (!previous || Date.parse(task.createdAt) > Date.parse(previous)) {
        recentlyScheduledAtByInstanceSubscription.set(key, task.createdAt);
      }
    }
    const instanceContextsByAgentId = createInstanceContexts(
      state.scenario,
      sessionId,
      sessionEpoch,
    );
    for (const record of journal.outbox.filter((candidate) => candidate.status === "pending").sort(sortOutbox)) {
      if (!this.#isGenerationActive(sessionId, generation)) return;
      if (Date.parse(record.availableAt) > Date.parse(this.#now())) continue;
      if (record.sessionEpoch !== sessionEpoch) {
        throw new InvalidWorldActionError(`Outbox 会话世代与权威世界不一致：${record.outboxId}`);
      }
      const event = eventsById.get(record.eventId);
      if (!event) throw new Error(`Outbox 引用的世界事件不存在：${record.eventId}`);
      const plan = this.#scheduler.createDispatchPlan({
        event,
        outboxId: record.outboxId,
        sessionEpoch,
        causalDepth: record.causalDepth,
        expectedStateVersion: state.stateVersion,
        createdAt: this.#now(),
        completedIdempotencyKeys: completedKeys,
        recentlyScheduledAtByInstanceSubscription,
        architectureProfile: this.#architectureProfile,
        experimentObservation: this.#experimentObservation,
        instanceContextsByAgentId,
        instanceResolver: (trigger, subscription) => resolveAgentInstance(
          state,
          trigger,
          subscription,
          instanceContextsByAgentId,
        ),
        nextTaskId: () => this.#nextId("agent-task"),
      });
      try {
        const persistedPlan = await this.#taskStore.enqueuePlan(plan);
        for (const task of persistedPlan.tasks) {
          recentlyScheduledAtByInstanceSubscription.set(
            agentDebounceKey(task.instanceRef.instanceId, task.subscriptionId),
            task.createdAt,
          );
        }
        if (!this.#isGenerationActive(sessionId, generation)) return;
        const currentState = await this.#world.getStateSnapshot(sessionId);
        if (currentState.sessionEpoch !== sessionEpoch) return;
        if (!this.#isGenerationActive(sessionId, generation)) return;
        await this.#world.store.markOutboxDelivered(sessionId, record.outboxId, this.#now());
      } catch (error) {
        if (this.#isGenerationActive(sessionId, generation)) {
          const failedAt = this.#now();
          await this.#world.store.markOutboxAttemptFailed(
            sessionId,
            record.outboxId,
            failedAt,
            taskErrorCode(error),
            new Date(Date.parse(failedAt) + this.#retryDelayMs).toISOString(),
          );
        }
        throw error;
      }
    }
  }

  #findHandler(task: AgentTask, triggerEvent: WorldEvent): AgentTaskHandler {
    const handler = this.#handlers.find((candidate) => candidate.matches(task, triggerEvent));
    if (!handler) throw new AgentTaskHandlerNotFoundError(task);
    return handler;
  }

  async #completeDuplicate(
    task: AgentTask,
    status: "completed" | "degraded",
  ): Promise<void> {
    if (!task.lease) throw new Error(`重复任务没有租约：${task.taskId}`);
    await this.#taskStore.complete({
      taskId: task.taskId,
      leaseToken: task.lease.token,
      workerId: this.#workerId,
      completedAt: this.#now(),
      status,
      duplicateSuppressed: true,
      attemptId: this.#nextId("dispatch-attempt"),
    });
  }

  async #reconcileDeadLetters(
    sessionId: string,
    sessionEpoch: string,
    generation: number,
  ): Promise<void> {
    const [tasks, deadLetters] = await Promise.all([
      this.#taskStore.list(sessionId),
      this.#taskStore.listDeadLetters(sessionId),
    ]);
    const tasksById = new Map(tasks.map((task) => [task.taskId, task]));
    for (const deadLetter of deadLetters) {
      if (!this.#isGenerationActive(sessionId, generation)) return;
      const task = tasksById.get(deadLetter.taskId);
      if (!task || task.sessionEpoch !== sessionEpoch) continue;
      const worldStatus = await this.#world.getAgentTaskResultStatus(
        sessionId,
        task.idempotencyKey,
      );
      if (worldStatus === "completed" || worldStatus === "degraded") {
        await this.#taskStore.reconcileWorldResult({
          taskId: task.taskId,
          status: worldStatus,
          reconciledAt: this.#now(),
          workerId: this.#workerId,
          attemptId: this.#nextId("dispatch-attempt"),
        });
        continue;
      }
      if (worldStatus === "failed" || task.status !== "failed") continue;
      await this.#world.recordAgentTaskFailure(task, deadLetter.reasonCode, deadLetter);
    }
  }

  async #scheduleNextEligible(sessionId: string, sessionEpoch: string): Promise<void> {
    if (this.#stopped || this.#paused.has(sessionId)) return;
    const [journal, tasks] = await Promise.all([
      this.#world.store.loadJournalSnapshot(sessionId),
      this.#taskStore.list(sessionId),
    ]);
    const candidates = [
      ...journal.outbox
        .filter((record) => record.status === "pending" && record.sessionEpoch === sessionEpoch)
        .map((record) => record.availableAt),
      ...tasks
        .filter((task) => task.sessionEpoch === sessionEpoch && task.status === "queued")
        .map((task) => task.availableAt),
      ...tasks
        .filter((task) => task.sessionEpoch === sessionEpoch && task.status === "running" && task.lease)
        .map((task) => task.lease?.expiresAt)
        .filter((timestamp): timestamp is string => Boolean(timestamp)),
    ].sort((left, right) => Date.parse(left) - Date.parse(right));
    const next = candidates[0];
    if (next) this.#scheduleWakeAt(sessionId, next);
  }

  async #handleFailure(task: AgentTask, error: unknown, generation: number): Promise<void> {
    if (!this.#isGenerationActive(task.sessionId, generation)) return;
    if (error instanceof AgentTaskLeaseError) return;
    if (!task.lease) throw error;
    const failedAt = this.#now();
    let result: Awaited<ReturnType<AgentTaskStore["fail"]>>;
    try {
      result = await this.#taskStore.fail({
        taskId: task.taskId,
        leaseToken: task.lease.token,
        workerId: this.#workerId,
        failedAt,
        errorCode: taskErrorCode(error),
        retryable: isRetryable(error),
        retryAt: new Date(Date.parse(failedAt) + this.#retryDelayMs).toISOString(),
        attemptId: this.#nextId("dispatch-attempt"),
        deadLetterId: this.#nextId("dead-letter"),
      });
    } catch (leaseError) {
      if (leaseError instanceof AgentTaskLeaseError) return;
      throw leaseError;
    }
    if (result.deadLetter) {
      await this.#reconcileDeadLetters(task.sessionId, task.sessionEpoch, generation);
    }
  }

  async #drainUnlocked(sessionId: string, generation: number): Promise<void> {
    let processed = 0;
    while (processed < this.#maxTasksPerDrain) {
      if (!this.#isGenerationActive(sessionId, generation)) return;
      const state = await this.#world.getStateSnapshot(sessionId);
      await this.#dispatchOutbox(
        sessionId,
        state,
        generation,
      );
      if (!this.#isGenerationActive(sessionId, generation)) return;
      await this.#reconcileDeadLetters(sessionId, state.sessionEpoch, generation);
      if (!this.#isGenerationActive(sessionId, generation)) return;
      const claimState = await this.#world.getStateSnapshot(sessionId);
      const now = this.#now();
      let task = await this.#taskStore.claimNext({
        sessionId,
        sessionEpoch: claimState.sessionEpoch,
        workerId: this.#workerId,
        now,
        leaseDurationMs: this.#leaseDurationMs,
        leaseToken: this.#nextId("lease"),
      });
      if (!task) {
        await this.#reconcileDeadLetters(sessionId, claimState.sessionEpoch, generation);
        await this.#scheduleNextEligible(sessionId, claimState.sessionEpoch);
        return;
      }
      processed += 1;

      try {
        const existingResult = await this.#world.getAgentTaskResultStatus(
          sessionId,
          task.idempotencyKey,
        );
        if (existingResult === "completed" || existingResult === "degraded") {
          await this.#completeDuplicate(task, existingResult);
          continue;
        }
        if (existingResult === "failed") {
          throw new InvalidWorldActionError("任务已经存在权威失败结果");
        }
        const latestState = await this.#world.getStateSnapshot(sessionId);
        if (latestState.sessionEpoch !== task.sessionEpoch) {
          throw new InvalidWorldActionError("任务会话世代已经失效");
        }
        if (task.expectedStateVersion !== latestState.stateVersion) {
          if (!task.lease) throw new Error(`任务没有租约：${task.taskId}`);
          task = await this.#taskStore.rebase(
            task.taskId,
            task.lease.token,
            latestState.stateVersion,
            this.#now(),
          );
        }
        const activeTask = task;
        const authorizedTimeline = await this.#world.getTimeline(
          sessionId,
          activeTask.instanceContext.subjectActorId
            ?? activeTask.agentId,
        );
        const triggerEvent = authorizedTimeline.find((event) => event.eventId === activeTask.triggerEventId);
        if (!triggerEvent || triggerEvent.eventType !== activeTask.triggerEventType) {
          throw new InvalidWorldActionError("任务触发事件不存在或类型不一致");
        }
        const handler = this.#findHandler(activeTask, triggerEvent);
        const projection = await this.#world.getAgentTaskProjection(activeTask);
        if (
          projection.stateVersion !== latestState.stateVersion
          || activeTask.expectedStateVersion !== projection.stateVersion
        ) {
          throw new StateVersionConflictError(
            activeTask.expectedStateVersion,
            projection.stateVersion,
          );
        }
        const handlerResult = await handler.run({
          task: activeTask,
          triggerEvent,
          projection,
          scenario: latestState.scenario,
        });
        const result = AgentRunResultSchema.parse({
          ...handlerResult,
          trace: {
            ...handlerResult.trace,
            templateRef: activeTask.templateRef,
            instanceRef: activeTask.instanceRef,
            experimentObservation: activeTask.experimentObservation,
            dispatchDecision: activeTask.dispatchDecision,
          },
        });
        if (!this.#isGenerationActive(sessionId, generation)) return;
        if (result.trace.status === "failed") {
          throw new AgentRunFailedError(result.trace.errorCode ?? "agent_run_failed");
        }
        if (!activeTask.lease) throw new Error(`任务完成时租约丢失：${activeTask.taskId}`);
        await this.#taskStore.assertCurrentLease({
          taskId: activeTask.taskId,
          leaseToken: activeTask.lease.token,
          workerId: this.#workerId,
          now: this.#now(),
        });
        if (!this.#isGenerationActive(sessionId, generation)) return;
        const committed = await this.#world.applyAgentResult(activeTask, result);
        await this.#taskStore.complete({
          taskId: activeTask.taskId,
          leaseToken: activeTask.lease.token,
          workerId: this.#workerId,
          completedAt: this.#now(),
          status: result.trace.status === "degraded" ? "degraded" : "completed",
          duplicateSuppressed: committed.length === 0,
          attemptId: this.#nextId("dispatch-attempt"),
        });
      } catch (error) {
        await this.#handleFailure(task, error, generation);
      }
    }
    this.#wakeRequested.add(sessionId);
  }
}
