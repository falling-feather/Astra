import {
  MediaProcessingWorkAttemptSchema,
  MediaProcessingWorkItemSchema,
  type MediaProcessingWorkAttempt,
  type MediaProcessingWorkItem,
} from "./models.js";
import {
  MediaProcessingLeaseError,
  type AssertMediaProcessingLeaseInput,
  type ClaimMediaProcessingWorkInput,
  type FailMediaProcessingWorkInput,
  type FinishMediaProcessingWorkInput,
  type MediaProcessingWorkStore,
  type ReconcileMediaProcessingWorkInput,
  type ReleaseMediaProcessingWorkInput,
} from "./ports.js";

export interface MediaProcessingWorkStoreSnapshot {
  workItems: MediaProcessingWorkItem[];
  attempts: MediaProcessingWorkAttempt[];
}

function compareWorkItems(
  left: MediaProcessingWorkItem,
  right: MediaProcessingWorkItem,
): number {
  return (
    Date.parse(left.createdAt) - Date.parse(right.createdAt)
    || left.taskId.localeCompare(right.taskId)
    || left.stepId.localeCompare(right.stepId)
    || left.attemptNumber - right.attemptNumber
  );
}

function assertLease(
  workItem: MediaProcessingWorkItem,
  leaseToken: string,
  workerId: string,
  now: string,
): NonNullable<MediaProcessingWorkItem["lease"]> {
  if (workItem.status !== "running" || !workItem.lease) {
    throw new MediaProcessingLeaseError(
      `媒体处理工作项没有有效租约：${workItem.workItemId}`,
    );
  }
  if (
    workItem.lease.token !== leaseToken
    || workItem.lease.ownerId !== workerId
  ) {
    throw new MediaProcessingLeaseError(
      `媒体处理工作项租约不匹配：${workItem.workItemId}`,
    );
  }
  if (Date.parse(workItem.lease.expiresAt) <= Date.parse(now)) {
    throw new MediaProcessingLeaseError(
      `媒体处理工作项租约已过期：${workItem.workItemId}`,
    );
  }
  return workItem.lease;
}

function immutableWorkPayload(
  workItem: MediaProcessingWorkItem,
): Record<string, unknown> {
  return {
    workItemId: workItem.workItemId,
    idempotencyKey: workItem.idempotencyKey,
    sessionId: workItem.sessionId,
    sessionEpoch: workItem.sessionEpoch,
    taskId: workItem.taskId,
    stepId: workItem.stepId,
    capability: workItem.capability,
    governanceDomain: workItem.governanceDomain,
    governanceNode: workItem.governanceNode,
    branchPriority: workItem.branchPriority,
    timeoutMs: workItem.timeoutMs,
    attemptNumber: workItem.attemptNumber,
    inputRef: workItem.inputRef,
    inputContentHash: workItem.inputContentHash,
    mediaType: workItem.mediaType,
  };
}

export class InMemoryMediaProcessingWorkStore
implements MediaProcessingWorkStore {
  readonly #workItems = new Map<string, MediaProcessingWorkItem>();
  readonly #workItemIdsByIdempotencyKey = new Map<string, string>();
  readonly #attempts: MediaProcessingWorkAttempt[] = [];

  constructor(
    snapshot: MediaProcessingWorkStoreSnapshot = {
      workItems: [],
      attempts: [],
    },
  ) {
    for (const rawWorkItem of snapshot.workItems) {
      const workItem = MediaProcessingWorkItemSchema.parse(rawWorkItem);
      this.#workItems.set(workItem.workItemId, structuredClone(workItem));
      this.#workItemIdsByIdempotencyKey.set(
        workItem.idempotencyKey,
        workItem.workItemId,
      );
    }
    this.#attempts.push(
      ...snapshot.attempts.map((attempt) => (
        MediaProcessingWorkAttemptSchema.parse(attempt)
      )),
    );
  }

  snapshot(): MediaProcessingWorkStoreSnapshot {
    return {
      workItems: [...this.#workItems.values()].map((item) => (
        structuredClone(item)
      )),
      attempts: structuredClone(this.#attempts),
    };
  }

  async enqueue(
    rawWorkItems: readonly MediaProcessingWorkItem[],
  ): Promise<MediaProcessingWorkItem[]> {
    const canonical: MediaProcessingWorkItem[] = [];
    for (const rawWorkItem of rawWorkItems) {
      const workItem = MediaProcessingWorkItemSchema.parse(rawWorkItem);
      const existingId = this.#workItemIdsByIdempotencyKey.get(
        workItem.idempotencyKey,
      );
      if (existingId) {
        const existing = this.#workItems.get(existingId);
        if (!existing) {
          throw new Error(
            `媒体处理工作项幂等索引损坏：${workItem.idempotencyKey}`,
          );
        }
        if (
          JSON.stringify(immutableWorkPayload(existing))
          !== JSON.stringify(immutableWorkPayload(workItem))
        ) {
          throw new Error(
            `媒体处理幂等键碰撞且固定载荷不一致：${workItem.idempotencyKey}`,
          );
        }
        canonical.push(structuredClone(existing));
        continue;
      }
      if (this.#workItems.has(workItem.workItemId)) {
        throw new Error(
          `媒体处理工作项 ID 已被不同幂等键占用：${workItem.workItemId}`,
        );
      }
      this.#workItems.set(
        workItem.workItemId,
        structuredClone(workItem),
      );
      this.#workItemIdsByIdempotencyKey.set(
        workItem.idempotencyKey,
        workItem.workItemId,
      );
      canonical.push(structuredClone(workItem));
    }
    return canonical;
  }

  async claimNext(
    input: ClaimMediaProcessingWorkInput,
  ): Promise<MediaProcessingWorkItem | null> {
    const nowMs = Date.parse(input.now);
    if (!Number.isFinite(nowMs)) {
      throw new Error(`无效媒体处理领取时间：${input.now}`);
    }
    if (input.leaseDurationMs <= 0) {
      throw new Error("媒体处理租约时长必须大于 0");
    }

    for (const [workItemId, workItem] of this.#workItems) {
      if (
        workItem.sessionId !== input.sessionId
        || workItem.sessionEpoch !== input.sessionEpoch
        || workItem.status !== "running"
        || !workItem.lease
        || Date.parse(workItem.lease.expiresAt) > nowMs
      ) {
        continue;
      }
      this.#attempts.push(MediaProcessingWorkAttemptSchema.parse({
        attemptId: `lease-expired:${workItem.workItemId}:${workItem.claimCount}`,
        workItemId: workItem.workItemId,
        sessionId: workItem.sessionId,
        taskId: workItem.taskId,
        stepId: workItem.stepId,
        claimNumber: Math.max(1, workItem.claimCount),
        workerId: workItem.lease.ownerId,
        startedAt: workItem.lease.acquiredAt,
        completedAt: input.now,
        outcome: "lease_expired",
        errorCode: "lease_expired",
      }));
      this.#workItems.set(workItemId, MediaProcessingWorkItemSchema.parse({
        ...workItem,
        status: "queued",
        lease: null,
        updatedAt: input.now,
        lastErrorCode: "lease_expired",
      }));
    }

    const candidate = [...this.#workItems.values()]
      .filter((workItem) => (
        workItem.sessionId === input.sessionId
        && workItem.sessionEpoch === input.sessionEpoch
        && workItem.status === "queued"
      ))
      .sort(compareWorkItems)[0];
    if (!candidate) return null;
    const claimed = MediaProcessingWorkItemSchema.parse({
      ...candidate,
      status: "running",
      claimCount: candidate.claimCount + 1,
      lease: {
        ownerId: input.workerId,
        token: input.leaseToken,
        acquiredAt: input.now,
        expiresAt: new Date(
          nowMs + input.leaseDurationMs,
        ).toISOString(),
      },
      updatedAt: input.now,
    });
    this.#workItems.set(claimed.workItemId, claimed);
    return structuredClone(claimed);
  }

  async assertCurrentLease(
    input: AssertMediaProcessingLeaseInput,
  ): Promise<MediaProcessingWorkItem> {
    const workItem = this.#workItems.get(input.workItemId);
    if (!workItem) {
      throw new Error(`媒体处理工作项不存在：${input.workItemId}`);
    }
    assertLease(
      workItem,
      input.leaseToken,
      input.workerId,
      input.now,
    );
    return structuredClone(workItem);
  }

  async complete(
    input: FinishMediaProcessingWorkInput,
  ): Promise<MediaProcessingWorkItem> {
    const workItem = this.#workItems.get(input.workItemId);
    if (!workItem) {
      throw new Error(`媒体处理工作项不存在：${input.workItemId}`);
    }
    const lease = assertLease(
      workItem,
      input.leaseToken,
      input.workerId,
      input.finishedAt,
    );
    const completed = MediaProcessingWorkItemSchema.parse({
      ...workItem,
      status: "completed",
      lease: null,
      updatedAt: input.finishedAt,
      completedAt: input.finishedAt,
      lastErrorCode: null,
    });
    this.#workItems.set(workItem.workItemId, completed);
    this.#attempts.push(MediaProcessingWorkAttemptSchema.parse({
      attemptId: input.attemptId,
      workItemId: workItem.workItemId,
      sessionId: workItem.sessionId,
      taskId: workItem.taskId,
      stepId: workItem.stepId,
      claimNumber: workItem.claimCount,
      workerId: input.workerId,
      startedAt: lease.acquiredAt,
      completedAt: input.finishedAt,
      outcome: input.duplicateSuppressed
        ? "duplicate_suppressed"
        : "completed",
      errorCode: null,
    }));
    return structuredClone(completed);
  }

  async release(
    input: ReleaseMediaProcessingWorkInput,
  ): Promise<MediaProcessingWorkItem> {
    const workItem = this.#workItems.get(input.workItemId);
    if (!workItem) {
      throw new Error(`媒体处理工作项不存在：${input.workItemId}`);
    }
    const lease = assertLease(
      workItem,
      input.leaseToken,
      input.workerId,
      input.releasedAt,
    );
    const released = MediaProcessingWorkItemSchema.parse({
      ...workItem,
      status: "queued",
      lease: null,
      updatedAt: input.releasedAt,
      lastErrorCode: input.errorCode,
    });
    this.#workItems.set(workItem.workItemId, released);
    this.#attempts.push(MediaProcessingWorkAttemptSchema.parse({
      attemptId: input.attemptId,
      workItemId: workItem.workItemId,
      sessionId: workItem.sessionId,
      taskId: workItem.taskId,
      stepId: workItem.stepId,
      claimNumber: workItem.claimCount,
      workerId: input.workerId,
      startedAt: lease.acquiredAt,
      completedAt: input.releasedAt,
      outcome: "released",
      errorCode: input.errorCode,
    }));
    return structuredClone(released);
  }

  async fail(
    input: FailMediaProcessingWorkInput,
  ): Promise<MediaProcessingWorkItem> {
    const workItem = this.#workItems.get(input.workItemId);
    if (!workItem) {
      throw new Error(`媒体处理工作项不存在：${input.workItemId}`);
    }
    const lease = assertLease(
      workItem,
      input.leaseToken,
      input.workerId,
      input.failedAt,
    );
    const failed = MediaProcessingWorkItemSchema.parse({
      ...workItem,
      status: "failed",
      lease: null,
      updatedAt: input.failedAt,
      completedAt: input.failedAt,
      lastErrorCode: input.errorCode,
    });
    this.#workItems.set(workItem.workItemId, failed);
    this.#attempts.push(MediaProcessingWorkAttemptSchema.parse({
      attemptId: input.attemptId,
      workItemId: workItem.workItemId,
      sessionId: workItem.sessionId,
      taskId: workItem.taskId,
      stepId: workItem.stepId,
      claimNumber: workItem.claimCount,
      workerId: input.workerId,
      startedAt: lease.acquiredAt,
      completedAt: input.failedAt,
      outcome: "failed",
      errorCode: input.errorCode,
    }));
    return structuredClone(failed);
  }

  async reconcile(
    input: ReconcileMediaProcessingWorkInput,
  ): Promise<MediaProcessingWorkItem> {
    const workItem = this.#workItems.get(input.workItemId);
    if (!workItem) {
      throw new Error(`媒体处理工作项不存在：${input.workItemId}`);
    }
    if (
      workItem.status === input.status
      && workItem.completedAt
    ) {
      return structuredClone(workItem);
    }
    const reconciled = MediaProcessingWorkItemSchema.parse({
      ...workItem,
      status: input.status,
      lease: null,
      updatedAt: input.reconciledAt,
      completedAt: input.reconciledAt,
      lastErrorCode: input.errorCode,
    });
    this.#workItems.set(workItem.workItemId, reconciled);
    this.#attempts.push(MediaProcessingWorkAttemptSchema.parse({
      attemptId: input.attemptId,
      workItemId: workItem.workItemId,
      sessionId: workItem.sessionId,
      taskId: workItem.taskId,
      stepId: workItem.stepId,
      claimNumber: Math.max(1, workItem.claimCount),
      workerId: input.workerId,
      startedAt: workItem.lease?.acquiredAt ?? workItem.updatedAt,
      completedAt: input.reconciledAt,
      outcome: input.status === "completed"
        ? "duplicate_suppressed"
        : "failed",
      errorCode: input.errorCode,
    }));
    return structuredClone(reconciled);
  }

  async list(sessionId: string): Promise<MediaProcessingWorkItem[]> {
    return [...this.#workItems.values()]
      .filter((workItem) => workItem.sessionId === sessionId)
      .sort(compareWorkItems)
      .map((workItem) => structuredClone(workItem));
  }

  async listAttempts(
    sessionId: string,
  ): Promise<MediaProcessingWorkAttempt[]> {
    return structuredClone(
      this.#attempts.filter((attempt) => attempt.sessionId === sessionId),
    );
  }

  async reset(sessionId: string): Promise<void> {
    for (const [workItemId, workItem] of this.#workItems) {
      if (workItem.sessionId !== sessionId) continue;
      this.#workItems.delete(workItemId);
      this.#workItemIdsByIdempotencyKey.delete(workItem.idempotencyKey);
    }
    for (let index = this.#attempts.length - 1; index >= 0; index -= 1) {
      if (this.#attempts[index]?.sessionId === sessionId) {
        this.#attempts.splice(index, 1);
      }
    }
  }
}
