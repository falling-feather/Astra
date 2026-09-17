import {
  GovernanceModelDecisionSchema,
  MediaProcessingOutputSchema,
  type AdapterCapability,
  type GovernanceDomain,
  type Material,
  type MediaProcessingOutput,
  type MediaProcessingTask,
} from "@ronggang/contracts";
import {
  buildGovernanceExecutionContext,
  compileGovernanceModelPrompt,
  evaluateGovernanceExecution,
  GovernanceExecutionConfigurationError,
  InvalidWorldActionError,
  recommendationFromExtracted,
  SessionNotFoundError,
  StateVersionConflictError,
  WorldEngine,
  type WorldState,
} from "@ronggang/world-core";
import {
  MediaProcessingLeaseError,
  type GovernanceModelPort,
  type MediaCapabilityExecutionResult,
  type MediaCapabilityExecutor,
  type MediaProcessingWorkStore,
} from "./ports.js";
import { DeterministicGovernanceModel } from "./governance-model.js";
import {
  MediaProcessingWorkItemSchema,
  type MediaProcessingWorkItem,
} from "./models.js";

export interface MediaProcessingOrchestratorOptions {
  world: WorldEngine;
  workStore: MediaProcessingWorkStore;
  executor: MediaCapabilityExecutor;
  governanceModel?: GovernanceModelPort;
  workerId?: string;
  leaseDurationMs?: number;
  maxWorkItemsPerDrain?: number;
  maxConcurrentWorkItems?: number;
  now?: () => string;
  nextId?: (prefix: string) => string;
  onBackgroundError?: (error: unknown) => void;
}

function capabilityPrompt(
  capability: AdapterCapability,
  governanceDomain: GovernanceDomain | null,
): string {
  const prompts: Record<AdapterCapability, string> = {
    xingchen_agent: "提取可核验信息、来源边界与风险；不要把推断写成事实。",
    rag: "检索与固定材料直接相关的参考内容，并保留来源边界。",
    asr: "转写音频中的可辨识语音；不确定内容使用明确的不确定标记。",
    ocr: "提取文档或图像中的可读文字与版面线索；不要补写缺失文本。",
    image_understanding: "描述图像中的可观察对象、场景与风险；不要推断不可见事实。",
    text_moderation: "检查文本中的合规、隐私、事实表述与发布风险。",
    image_moderation: "检查图像中的合规、版权、隐私与发布风险。",
    video_moderation: "检查视频中的合规、版权、隐私与发布风险。",
  };
  const base = prompts[capability];
  if (!governanceDomain) return base;
  const domainInstruction: Record<GovernanceDomain, string> = {
    fact: "只判断事实一致性、来源充分性和表述边界。",
    copyright: "只判断授权用途、渠道、期限、地域和权利争议。",
    content_safety: "只判断内容安全、隐私、违法违规与伤害风险。",
    platform_rule: "只判断目标发布平台的格式、标签、红线和人工复核要求。",
  };
  return [
    base,
    domainInstruction[governanceDomain],
    "结构化输出必须包含 recommendation=allow|review|revise|block 与 riskLabels；未知或工具不可用不得写成 allow。",
  ].join("\n");
}

function safeErrorCode(error: unknown): string {
  if (error instanceof StateVersionConflictError) return "state_version_conflict";
  if (error instanceof SessionNotFoundError) return "session_not_found";
  if (error instanceof InvalidWorldActionError) return "world_action_rejected";
  if (error instanceof GovernanceExecutionConfigurationError) {
    if (error.message.includes("未提供的知识切片")) {
      return "governance_model_citation_invalid";
    }
    if (error.message.includes("模型输出不符合")) {
      return "governance_model_contract_invalid";
    }
    return "governance_definition_invalid";
  }
  if (error instanceof MediaProcessingLeaseError) return "lease_invalid";
  if (error instanceof Error) {
    if (error.name === "IflytekAdapterConfigurationError") {
      return "provider_not_configured";
    }
    if (error.name === "IflytekLiveHandlerError") {
      const code = (error as Error & { code?: unknown }).code;
      if (
        typeof code === "string"
        && /^[a-z0-9_]{1,120}$/u.test(code)
      ) return code;
      return "provider_contract_failed";
    }
    if (error.name === "ModelInvocationError") {
      const code = (error as Error & { code?: unknown }).code;
      return typeof code === "string"
        && /^[a-z0-9_]{1,120}$/u.test(code)
        ? code
        : "governance_model_failed";
    }
    if (error.name === "AbortError") return "provider_timeout";
  }
  return "provider_execution_failed";
}

function cloneJsonRecord(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error("媒体处理输出不是可持久化 JSON 对象");
  }
  const parsed: unknown = JSON.parse(serialized);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("媒体处理输出不是 JSON 对象");
  }
  return parsed as Record<string, unknown>;
}

function workItemFor(
  state: WorldState,
  task: MediaProcessingTask,
  step: MediaProcessingTask["steps"][number],
  material: Material,
): MediaProcessingWorkItem {
  const attemptNumber = step.status === "running"
    ? Math.max(1, step.attempts)
    : step.attempts + 1;
  const workItemId = [
    "media-work",
    state.sessionEpoch,
    task.taskId,
    step.stepId,
    attemptNumber,
  ].join(":");
  return MediaProcessingWorkItemSchema.parse({
    workItemId,
    idempotencyKey: `${step.idempotencyKey}:attempt:${attemptNumber}`,
    sessionId: state.sessionId,
    sessionEpoch: state.sessionEpoch,
    taskId: task.taskId,
    stepId: step.stepId,
    capability: step.capability,
    governanceDomain: step.governanceDomain,
    governanceNode: step.governanceNode,
    branchPriority: step.branchPriority,
    timeoutMs: step.timeoutMs,
    attemptNumber,
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
  });
}

interface ScheduledWake {
  timer: ReturnType<typeof setTimeout>;
  dueAt: number;
}

function abortError(): Error {
  const error = new Error("媒体处理提供方调用已取消或超时");
  error.name = "AbortError";
  return error;
}

function remainingTimeoutMs(deadlineMs: number): number {
  const remaining = Math.floor(deadlineMs - Date.now());
  if (remaining <= 0) throw abortError();
  return remaining;
}

export class MediaProcessingOrchestrator {
  readonly #world: WorldEngine;
  readonly #workStore: MediaProcessingWorkStore;
  readonly #executor: MediaCapabilityExecutor;
  readonly #governanceModel: GovernanceModelPort;
  readonly #workerId: string;
  readonly #leaseDurationMs: number;
  readonly #maxWorkItemsPerDrain: number;
  readonly #maxConcurrentWorkItems: number;
  readonly #now: () => string;
  readonly #nextId: (prefix: string) => string;
  readonly #onBackgroundError: (error: unknown) => void;
  readonly #running = new Map<string, Promise<void>>();
  readonly #unsubscribers = new Map<string, () => void>();
  readonly #wakeTimers = new Map<string, ScheduledWake>();
  readonly #wakeRequested = new Set<string>();
  readonly #paused = new Set<string>();
  readonly #generations = new Map<string, number>();
  readonly #activeControllers = new Map<string, Set<AbortController>>();
  #stopped = false;

  constructor(options: MediaProcessingOrchestratorOptions) {
    this.#world = options.world;
    this.#workStore = options.workStore;
    this.#executor = options.executor;
    this.#workerId = options.workerId
      ?? `media-worker-${crypto.randomUUID()}`;
    this.#leaseDurationMs = options.leaseDurationMs ?? 120_000;
    this.#maxWorkItemsPerDrain = options.maxWorkItemsPerDrain ?? 32;
    this.#maxConcurrentWorkItems = Math.max(
      1,
      options.maxConcurrentWorkItems ?? 4,
    );
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#governanceModel = options.governanceModel
      ?? new DeterministicGovernanceModel(this.#now);
    this.#nextId = options.nextId
      ?? ((prefix) => `${prefix}-${crypto.randomUUID()}`);
    this.#onBackgroundError = options.onBackgroundError ?? ((error) => {
      console.error("[media-processing]", error);
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
    if (this.#stopped || this.#paused.has(sessionId)) return;
    this.#wakeRequested.add(sessionId);
    if (this.#running.has(sessionId)) return;
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
      void this.drain(sessionId).catch(this.#onBackgroundError);
    }, safeDelay);
    timer.unref?.();
    this.#wakeTimers.set(sessionId, { timer, dueAt });
  }

  #isActive(sessionId: string, generation: number): boolean {
    return (
      !this.#stopped
      && !this.#paused.has(sessionId)
      && (this.#generations.get(sessionId) ?? 0) === generation
    );
  }

  #abortSession(sessionId: string): void {
    const controllers = this.#activeControllers.get(sessionId);
    if (!controllers) return;
    for (const controller of controllers) controller.abort();
  }

  async #executeCapability(
    workItem: MediaProcessingWorkItem,
    task: MediaProcessingTask,
    prompt: string,
    governanceMetadata: Record<string, unknown> | null,
    timeoutMs: number,
  ): Promise<MediaCapabilityExecutionResult> {
    const controller = new AbortController();
    const controllers = this.#activeControllers.get(workItem.sessionId)
      ?? new Set<AbortController>();
    controllers.add(controller);
    this.#activeControllers.set(workItem.sessionId, controllers);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();
    const aborted = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener(
        "abort",
        () => reject(abortError()),
        { once: true },
      );
    });
    try {
      return await Promise.race([
        this.#executor.executeCapability({
          capability: workItem.capability,
          sourceRef: workItem.inputRef,
          mediaType: workItem.mediaType,
          prompt,
          idempotencyKey: workItem.idempotencyKey,
          timeoutMs,
          signal: controller.signal,
          metadata: {
            taskId: workItem.taskId,
            stepId: workItem.stepId,
            attemptNumber: workItem.attemptNumber,
            claimNumber: workItem.claimCount,
            inputContentHash: workItem.inputContentHash,
            materialId: task.materialId,
            materialVersion: task.materialVersion,
            governanceDomain: workItem.governanceDomain,
            governanceNode: workItem.governanceNode,
            branchPriority: workItem.branchPriority,
            ...(governanceMetadata ?? {}),
          },
        }),
        aborted,
      ]);
    } finally {
      clearTimeout(timer);
      controllers.delete(controller);
      if (controllers.size === 0) {
        this.#activeControllers.delete(workItem.sessionId);
      }
    }
  }

  async #executeGovernanceModel(
    workItem: MediaProcessingWorkItem,
    request: Parameters<GovernanceModelPort["invoke"]>[0],
    timeoutMs: number,
  ) {
    const controller = new AbortController();
    const controllers = this.#activeControllers.get(workItem.sessionId)
      ?? new Set<AbortController>();
    controllers.add(controller);
    this.#activeControllers.set(workItem.sessionId, controllers);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();
    const aborted = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener(
        "abort",
        () => reject(abortError()),
        { once: true },
      );
    });
    try {
      return await Promise.race([
        this.#governanceModel.invoke(request),
        aborted,
      ]);
    } finally {
      clearTimeout(timer);
      controllers.delete(controller);
      if (controllers.size === 0) {
        this.#activeControllers.delete(workItem.sessionId);
      }
    }
  }

  async pauseSession(sessionId: string): Promise<void> {
    this.#paused.add(sessionId);
    this.#generations.set(
      sessionId,
      (this.#generations.get(sessionId) ?? 0) + 1,
    );
    this.#wakeRequested.delete(sessionId);
    this.#abortSession(sessionId);
    const scheduled = this.#wakeTimers.get(sessionId);
    if (scheduled) {
      clearTimeout(scheduled.timer);
      this.#wakeTimers.delete(sessionId);
    }
    const running = this.#running.get(sessionId);
    if (running) await running.catch(() => undefined);
  }

  resumeSession(sessionId: string): void {
    this.#paused.delete(sessionId);
    this.start([sessionId]);
  }

  async resetSessionWork(sessionId: string): Promise<void> {
    if (!this.#paused.has(sessionId)) {
      throw new Error("重置媒体处理工作项前必须暂停会话");
    }
    await this.#workStore.reset(sessionId);
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    for (const scheduled of this.#wakeTimers.values()) {
      clearTimeout(scheduled.timer);
    }
    this.#wakeTimers.clear();
    this.#wakeRequested.clear();
    for (const sessionId of this.#activeControllers.keys()) {
      this.#abortSession(sessionId);
    }
    for (const unsubscribe of this.#unsubscribers.values()) unsubscribe();
    this.#unsubscribers.clear();
    await Promise.allSettled(this.#running.values());
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
    const running = this.#drainUnlocked(sessionId, generation);
    this.#running.set(sessionId, running);
    try {
      await running;
    } finally {
      if (this.#running.get(sessionId) === running) {
        this.#running.delete(sessionId);
      }
      if (
        this.#wakeRequested.delete(sessionId)
        && this.#isActive(sessionId, generation)
      ) {
        this.#scheduleWake(sessionId, 0);
      }
    }
  }

  async drainUntilIdle(
    sessionId: string,
    maxWaves = 24,
  ): Promise<void> {
    for (let wave = 0; wave < maxWaves; wave += 1) {
      const scheduled = this.#wakeTimers.get(sessionId);
      if (scheduled && scheduled.dueAt <= Date.now()) {
        clearTimeout(scheduled.timer);
        this.#wakeTimers.delete(sessionId);
      }
      await this.drain(sessionId);
      const state = await this.#world.getStateSnapshot(sessionId);
      const workItems = await this.#workStore.list(sessionId);
      const now = Date.parse(this.#now());
      const worldBusy = state.mediaProcessingTasks.some((task) => (
        task.sessionEpoch === state.sessionEpoch
        && task.steps.some((step) => (
          step.status === "queued" || step.status === "running"
        ))
      ));
      const storeDue = workItems.some((workItem) => (
        workItem.sessionEpoch === state.sessionEpoch
        && (
          workItem.status === "queued"
          || (
            workItem.status === "running"
            && (
              !workItem.lease
              || Date.parse(workItem.lease.expiresAt) <= now
            )
          )
        )
      ));
      const nextLeaseExpiry = workItems
        .filter((workItem) => (
          workItem.sessionEpoch === state.sessionEpoch
          && workItem.status === "running"
          && workItem.lease
          && Date.parse(workItem.lease.expiresAt) > now
        ))
        .map((workItem) => workItem.lease!.expiresAt)
        .sort((left, right) => Date.parse(left) - Date.parse(right))[0];
      if (!storeDue && (!worldBusy || nextLeaseExpiry)) {
        if (nextLeaseExpiry) {
          this.#scheduleWake(
            sessionId,
            Math.max(0, Date.parse(nextLeaseExpiry) - now),
          );
        }
        this.#wakeRequested.delete(sessionId);
        return;
      }
    }
    throw new Error(
      `媒体处理在 ${maxWaves} 轮内未进入空闲状态：${sessionId}`,
    );
  }

  async #syncWorkItems(state: WorldState): Promise<void> {
    const workItems: MediaProcessingWorkItem[] = [];
    for (const task of state.mediaProcessingTasks) {
      if (
        task.sessionEpoch !== state.sessionEpoch
        || !["queued", "running"].includes(task.status)
      ) {
        continue;
      }
      const material = state.materials.find((item) => (
        item.materialId === task.materialId
      ));
      if (!material) continue;
      for (const step of task.steps) {
        if (step.status !== "queued" && step.status !== "running") continue;
        workItems.push(workItemFor(state, task, step, material));
      }
    }
    if (workItems.length > 0) await this.#workStore.enqueue(workItems);
  }

  async #finalizeOneSettledTask(
    state: WorldState,
  ): Promise<boolean> {
    const task = state.mediaProcessingTasks.find((candidate) => (
      candidate.sessionEpoch === state.sessionEpoch
      && !candidate.completedAt
      && candidate.steps.every((step) => (
        step.status !== "queued" && step.status !== "running"
      ))
    ));
    if (!task) return false;
    try {
      await this.#world.finalizeMediaProcessingTask({
        sessionId: state.sessionId,
        sessionEpoch: state.sessionEpoch,
        taskId: task.taskId,
        expectedStateVersion: state.stateVersion,
        correlationId: this.#nextId("media-finalize"),
      });
      return true;
    } catch (error) {
      if (error instanceof StateVersionConflictError) return true;
      throw error;
    }
  }

  async #completeDuplicate(
    workItem: MediaProcessingWorkItem,
  ): Promise<void> {
    if (!workItem.lease) {
      throw new MediaProcessingLeaseError(
        `媒体处理重复工作项没有租约：${workItem.workItemId}`,
      );
    }
    await this.#workStore.complete({
      workItemId: workItem.workItemId,
      leaseToken: workItem.lease.token,
      workerId: this.#workerId,
      finishedAt: this.#now(),
      attemptId: this.#nextId("media-attempt"),
      duplicateSuppressed: true,
    });
  }

  async #releaseInterruptedWorkItem(
    workItem: MediaProcessingWorkItem,
  ): Promise<void> {
    if (!workItem.lease) return;
    try {
      await this.#workStore.release({
        workItemId: workItem.workItemId,
        leaseToken: workItem.lease.token,
        workerId: this.#workerId,
        releasedAt: this.#now(),
        attemptId: this.#nextId("media-attempt"),
        errorCode: "worker_interrupted",
      });
    } catch (error) {
      if (!(error instanceof MediaProcessingLeaseError)) throw error;
    }
  }

  async #processWorkItem(
    workItem: MediaProcessingWorkItem,
    generation: number,
  ): Promise<void> {
    if (!workItem.lease) {
      throw new MediaProcessingLeaseError(
        `媒体处理工作项没有租约：${workItem.workItemId}`,
      );
    }
    try {
      let state = await this.#world.getStateSnapshot(workItem.sessionId);
      if (!this.#isActive(workItem.sessionId, generation)) {
        await this.#releaseInterruptedWorkItem(workItem);
        return;
      }
      if (state.sessionEpoch !== workItem.sessionEpoch) {
        await this.#workStore.reconcile({
          workItemId: workItem.workItemId,
          workerId: this.#workerId,
          reconciledAt: this.#now(),
          attemptId: this.#nextId("media-attempt"),
          status: "failed",
          errorCode: "session_epoch_changed",
        });
        return;
      }
      let task = state.mediaProcessingTasks.find((item) => (
        item.taskId === workItem.taskId
      ));
      let step = task?.steps.find((item) => (
        item.stepId === workItem.stepId
      ));
      if (!task || !step) {
        await this.#workStore.reconcile({
          workItemId: workItem.workItemId,
          workerId: this.#workerId,
          reconciledAt: this.#now(),
          attemptId: this.#nextId("media-attempt"),
          status: "failed",
          errorCode: "world_task_missing",
        });
        return;
      }
      if (step.status === "succeeded" || step.status === "manually_completed") {
        await this.#completeDuplicate(workItem);
        return;
      }
      if (step.status === "failed") {
        await this.#workStore.reconcile({
          workItemId: workItem.workItemId,
          workerId: this.#workerId,
          reconciledAt: this.#now(),
          attemptId: this.#nextId("media-attempt"),
          status: "failed",
          errorCode: step.lastErrorCode ?? "world_step_failed",
        });
        return;
      }
      if (
        task.inputRef !== workItem.inputRef
        || task.inputContentHash !== workItem.inputContentHash
        || step.capability !== workItem.capability
        || step.governanceDomain !== workItem.governanceDomain
        || JSON.stringify(step.governanceNode)
          !== JSON.stringify(workItem.governanceNode)
        || step.branchPriority !== workItem.branchPriority
        || step.timeoutMs !== workItem.timeoutMs
      ) {
        throw new InvalidWorldActionError(
          "媒体处理工作项固定输入与世界任务不一致",
        );
      }

      if (step.status === "queued") {
        let started = false;
        for (let attempt = 0; attempt < 8; attempt += 1) {
          state = await this.#world.getStateSnapshot(workItem.sessionId);
          task = state.mediaProcessingTasks.find((item) => (
            item.taskId === workItem.taskId
          ));
          step = task?.steps.find((item) => (
            item.stepId === workItem.stepId
          ));
          if (!task || !step) {
            throw new InvalidWorldActionError(
              "媒体处理步骤在启动前已经失效",
            );
          }
          if (step.status === "running") {
            started = true;
            break;
          }
          if (
            step.status === "succeeded"
            || step.status === "manually_completed"
          ) {
            await this.#completeDuplicate(workItem);
            return;
          }
          if (step.status !== "queued") {
            throw new InvalidWorldActionError(
              "媒体处理步骤在启动前进入不可执行状态",
            );
          }
          try {
            await this.#workStore.assertCurrentLease({
              workItemId: workItem.workItemId,
              leaseToken: workItem.lease.token,
              workerId: this.#workerId,
              now: this.#now(),
            });
            await this.#world.startMediaProcessingStep({
              sessionId: state.sessionId,
              sessionEpoch: state.sessionEpoch,
              taskId: task.taskId,
              stepId: step.stepId,
              expectedStateVersion: state.stateVersion,
              workerId: this.#workerId,
              providerMode: this.#executor.mode,
              correlationId: this.#nextId("media-start"),
            });
            started = true;
            break;
          } catch (error) {
            if (!(error instanceof StateVersionConflictError)) throw error;
          }
        }
        if (!started) {
          throw new StateVersionConflictError(
            state.stateVersion,
            (await this.#world.getStateSnapshot(workItem.sessionId)).stateVersion,
          );
        }
        state = await this.#world.getStateSnapshot(workItem.sessionId);
        task = state.mediaProcessingTasks.find((item) => (
          item.taskId === workItem.taskId
        ));
        step = task?.steps.find((item) => (
          item.stepId === workItem.stepId
        ));
      }
      if (
        task
        && step?.status === "running"
        && workItem.claimCount > 1
        && workItem.lastErrorCode === "lease_expired"
      ) {
        let restarted = false;
        for (let attempt = 0; attempt < 8; attempt += 1) {
          state = await this.#world.getStateSnapshot(workItem.sessionId);
          task = state.mediaProcessingTasks.find(
            (item) => item.taskId === workItem.taskId,
          );
          step = task?.steps.find(
            (item) => item.stepId === workItem.stepId,
          );
          if (!task || !step || step.status !== "running") break;
          try {
            await this.#workStore.assertCurrentLease({
              workItemId: workItem.workItemId,
              leaseToken: workItem.lease.token,
              workerId: this.#workerId,
              now: this.#now(),
            });
            await this.#world.startMediaProcessingStep({
              sessionId: state.sessionId,
              sessionEpoch: state.sessionEpoch,
              taskId: task.taskId,
              stepId: step.stepId,
              expectedStateVersion: state.stateVersion,
              workerId: this.#workerId,
              providerMode: this.#executor.mode,
              correlationId: this.#nextId("media-reclaim"),
            });
            restarted = true;
            break;
          } catch (error) {
            if (!(error instanceof StateVersionConflictError)) throw error;
          }
        }
        if (restarted) {
          state = await this.#world.getStateSnapshot(workItem.sessionId);
          task = state.mediaProcessingTasks.find(
            (item) => item.taskId === workItem.taskId,
          );
          step = task?.steps.find(
            (item) => item.stepId === workItem.stepId,
          );
        }
      }
      if (!task || !step || step.status !== "running") {
        throw new InvalidWorldActionError(
          "媒体处理步骤未进入运行状态",
        );
      }
      if (!this.#isActive(workItem.sessionId, generation)) {
        await this.#releaseInterruptedWorkItem(workItem);
        return;
      }

      const executionDeadlineMs = Date.now() + workItem.timeoutMs;
      const governanceContext = workItem.governanceDomain
        ? buildGovernanceExecutionContext(state, task, step)
        : null;
      const rawOutput = await this.#executeCapability(
        workItem,
        task,
        governanceContext?.prompt
          ?? capabilityPrompt(workItem.capability, null),
        governanceContext
          ? {
              governanceDefinitionHash: governanceContext.definitionHash,
              governancePromptTemplateHash:
                governanceContext.basePromptHash,
              governanceRulesetHash: governanceContext.rulesetHash,
              governanceKnowledgeSnapshotHash:
                governanceContext.knowledgeSnapshotHash,
              governanceExecutionInputHash:
                governanceContext.baseExecutionInputHash,
              governanceKnowledgeCitations:
                governanceContext.knowledgeCitations,
          }
          : null,
        remainingTimeoutMs(executionDeadlineMs),
      );
      if (!this.#isActive(workItem.sessionId, generation)) {
        await this.#releaseInterruptedWorkItem(workItem);
        return;
      }
      const rawExtracted = cloneJsonRecord(rawOutput.extracted);
      const toolRecommendation = governanceContext
        ? recommendationFromExtracted(rawExtracted)
        : null;
      const toolObservation = governanceContext
        ? {
            summary: rawOutput.summary,
            extracted: rawExtracted,
            confidence: rawOutput.confidence,
            provider: this.#executor.provider,
            providerMode: this.#executor.mode,
            providerRequestId: rawOutput.providerRequestId ?? null,
          }
        : null;
      const compiledPrompt = governanceContext && toolObservation
        ? compileGovernanceModelPrompt(
            governanceContext,
            toolObservation,
          )
        : null;
      let modelResult: Awaited<
        ReturnType<GovernanceModelPort["invoke"]>
      > | null = null;
      if (governanceContext && compiledPrompt) {
        const modelTimeoutMs = remainingTimeoutMs(executionDeadlineMs);
        modelResult = await this.#executeGovernanceModel(workItem, {
            invocationId: this.#nextId("governance-model"),
            profileId: this.#governanceModel.health().profileId,
            taskKind: `governance.${governanceContext.domain}`,
            systemPrompt: compiledPrompt.systemPrompt,
            userPrompt: compiledPrompt.userPrompt,
            outputContractId: "governance-model-decision/1.0.0",
            outputMode: "json_object",
            temperature: 0,
            maxOutputTokens: 1_600,
            timeoutMs: modelTimeoutMs,
          }, modelTimeoutMs);
      }
      if (!this.#isActive(workItem.sessionId, generation)) {
        await this.#releaseInterruptedWorkItem(workItem);
        return;
      }
      const parsedModelDecision = modelResult
        ? GovernanceModelDecisionSchema.safeParse(modelResult.output)
        : null;
      if (parsedModelDecision && !parsedModelDecision.success) {
        throw new GovernanceExecutionConfigurationError(
          "治理模型输出不符合 governance-model-decision/1.0.0",
        );
      }
      const modelDecision = parsedModelDecision?.success
        ? parsedModelDecision.data
        : null;
      if (
        modelResult
        && (
          modelResult.trace.status !== "completed"
          || modelResult.trace.mode === "unavailable"
        )
      ) {
        throw new GovernanceExecutionConfigurationError(
          "治理模型调用未形成可验收的完成轨迹",
        );
      }
      const governed = governanceContext
        && toolRecommendation
        && compiledPrompt
        && modelDecision
        && modelResult
        ? evaluateGovernanceExecution(governanceContext, {
            toolRecommendation,
            modelDecision,
            compiledPrompt,
            modelTrace: {
              status: "completed",
              profileId: modelResult.trace.profileId,
              provider: modelResult.trace.provider,
              mode: modelResult.trace.mode === "mock" ? "mock" : "live",
              model: modelResult.trace.model,
              requestId: modelResult.trace.requestId,
            },
          })
        : null;
      const providerRiskLabels = Array.isArray(rawExtracted.riskLabels)
        ? rawExtracted.riskLabels.map(String).filter(Boolean)
        : [];
      const extracted = governed
        ? {
            ...rawExtracted,
            toolObservation,
            modelDecision,
            toolRecommendation,
            modelRecommendation: modelDecision?.recommendation,
            recommendation: governed.recommendation,
            riskLabels: [...new Set([
              ...providerRiskLabels,
              ...(modelDecision?.riskLabels ?? []),
              ...governed.riskLabels,
            ])],
            governanceExecution: governed.trace,
          }
        : rawExtracted;
      const output: MediaProcessingOutput = MediaProcessingOutputSchema.parse({
        outputId: `media-output:${workItem.workItemId}`,
        capability: workItem.capability,
        provider: this.#executor.provider,
        providerMode: this.#executor.mode,
        summary: [
          rawOutput.summary.trim(),
          modelDecision?.summary,
        ].filter(Boolean).join(" ").slice(0, 2_000),
        extracted,
        sourceRef: workItem.inputRef,
        confidence: Math.max(0, Math.min(1, rawOutput.confidence)),
        trust: "observation_only",
        verificationStatus: "unverified",
        providerRequestId: rawOutput.providerRequestId?.trim() || null,
        createdAt: this.#now(),
      });

      let worldCompleted = false;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        state = await this.#world.getStateSnapshot(workItem.sessionId);
        task = state.mediaProcessingTasks.find((item) => (
          item.taskId === workItem.taskId
        ));
        step = task?.steps.find((item) => item.stepId === workItem.stepId);
        if (step?.status === "succeeded") {
          await this.#completeDuplicate(workItem);
          return;
        }
        if (!task || !step || step.status !== "running") {
          throw new InvalidWorldActionError(
            "媒体处理结果返回时世界步骤已失效",
          );
        }
        try {
          await this.#workStore.assertCurrentLease({
            workItemId: workItem.workItemId,
            leaseToken: workItem.lease.token,
            workerId: this.#workerId,
            now: this.#now(),
          });
          await this.#world.completeMediaProcessingStep({
            sessionId: state.sessionId,
            sessionEpoch: state.sessionEpoch,
            taskId: task.taskId,
            stepId: step.stepId,
            expectedStateVersion: state.stateVersion,
            output,
            correlationId: this.#nextId("media-complete"),
          });
          worldCompleted = true;
          break;
        } catch (error) {
          if (!(error instanceof StateVersionConflictError)) throw error;
        }
      }
      if (!worldCompleted) {
        throw new StateVersionConflictError(
          state.stateVersion,
          (await this.#world.getStateSnapshot(workItem.sessionId)).stateVersion,
        );
      }
      await this.#workStore.complete({
        workItemId: workItem.workItemId,
        leaseToken: workItem.lease.token,
        workerId: this.#workerId,
        finishedAt: this.#now(),
        attemptId: this.#nextId("media-attempt"),
        duplicateSuppressed: false,
      });
    } catch (error) {
      if (!this.#isActive(workItem.sessionId, generation)) {
        await this.#releaseInterruptedWorkItem(workItem);
        return;
      }
      if (error instanceof MediaProcessingLeaseError) return;
      const errorCode = safeErrorCode(error);
      let worldFailureSettled = false;
      try {
        for (let attempt = 0; attempt < 8; attempt += 1) {
          const state = await this.#world.getStateSnapshot(workItem.sessionId);
          const task = state.mediaProcessingTasks.find((item) => (
            item.taskId === workItem.taskId
          ));
          const step = task?.steps.find((item) => (
            item.stepId === workItem.stepId
          ));
          if (
            step?.status === "succeeded"
            || step?.status === "manually_completed"
          ) {
            await this.#completeDuplicate(workItem);
            return;
          }
          if (step?.status === "failed") {
            worldFailureSettled = true;
            break;
          }
          if (!task || !step || step.status !== "running") break;
          try {
            await this.#workStore.assertCurrentLease({
              workItemId: workItem.workItemId,
              leaseToken: workItem.lease.token,
              workerId: this.#workerId,
              now: this.#now(),
            });
            await this.#world.failMediaProcessingStep({
              sessionId: state.sessionId,
              sessionEpoch: state.sessionEpoch,
              taskId: task.taskId,
              stepId: step.stepId,
              expectedStateVersion: state.stateVersion,
              errorCode,
              providerMode: this.#executor.mode,
              correlationId: this.#nextId("media-fail"),
            });
            worldFailureSettled = true;
            break;
          } catch (worldError) {
            if (!(worldError instanceof StateVersionConflictError)) {
              throw worldError;
            }
          }
        }
      } catch (worldError) {
        if (!(worldError instanceof StateVersionConflictError)) {
          this.#onBackgroundError(worldError);
        }
      }
      if (!worldFailureSettled) {
        try {
          await this.#workStore.release({
            workItemId: workItem.workItemId,
            leaseToken: workItem.lease.token,
            workerId: this.#workerId,
            releasedAt: this.#now(),
            attemptId: this.#nextId("media-attempt"),
            errorCode,
          });
        } catch (storeError) {
          if (!(storeError instanceof MediaProcessingLeaseError)) {
            throw storeError;
          }
        }
        this.#wakeRequested.add(workItem.sessionId);
        return;
      }
      try {
        await this.#workStore.fail({
          workItemId: workItem.workItemId,
          leaseToken: workItem.lease.token,
          workerId: this.#workerId,
          failedAt: this.#now(),
          attemptId: this.#nextId("media-attempt"),
          errorCode,
        });
      } catch (storeError) {
        if (!(storeError instanceof MediaProcessingLeaseError)) {
          throw storeError;
        }
      }
    }
  }

  async #drainUnlocked(
    sessionId: string,
    generation: number,
  ): Promise<void> {
    let processed = 0;
    while (processed < this.#maxWorkItemsPerDrain) {
      if (!this.#isActive(sessionId, generation)) return;
      const state = await this.#world.getStateSnapshot(sessionId);
      if (await this.#finalizeOneSettledTask(state)) continue;
      await this.#syncWorkItems(state);
      if (!this.#isActive(sessionId, generation)) return;
      const latest = await this.#world.getStateSnapshot(sessionId);
      const workItems: MediaProcessingWorkItem[] = [];
      const waveLimit = Math.min(
        this.#maxConcurrentWorkItems,
        this.#maxWorkItemsPerDrain - processed,
      );
      for (let index = 0; index < waveLimit; index += 1) {
        const workItem = await this.#workStore.claimNext({
          sessionId,
          sessionEpoch: latest.sessionEpoch,
          workerId: this.#workerId,
          now: this.#now(),
          leaseDurationMs: this.#leaseDurationMs,
          leaseToken: this.#nextId("media-lease"),
        });
        if (!workItem) break;
        workItems.push(workItem);
      }
      if (workItems.length === 0) {
        const pendingItems = await this.#workStore.list(sessionId);
        const now = Date.parse(this.#now());
        const nextLeaseExpiry = pendingItems
          .filter((workItem) => (
            workItem.sessionEpoch === latest.sessionEpoch
            && workItem.status === "running"
            && workItem.lease
            && Date.parse(workItem.lease.expiresAt) > now
          ))
          .map((workItem) => workItem.lease!.expiresAt)
          .sort((left, right) => Date.parse(left) - Date.parse(right))[0];
        if (nextLeaseExpiry) {
          this.#scheduleWake(
            sessionId,
            Math.max(0, Date.parse(nextLeaseExpiry) - now),
          );
        }
        return;
      }
      processed += workItems.length;
      const results = await Promise.allSettled(
        workItems.map((workItem) => (
          this.#processWorkItem(workItem, generation)
        )),
      );
      for (const result of results) {
        if (result.status === "rejected") {
          this.#onBackgroundError(result.reason);
        }
      }
    }
    this.#wakeRequested.add(sessionId);
  }
}
