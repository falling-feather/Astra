import type { AgentTaskStore } from "@ronggang/agent-orchestrator";
import type { MediaProcessingWorkStore } from "@ronggang/media-processing";
import type {
  SessionControlStore,
  TrainingSessionStatus,
} from "@ronggang/session-control";
import type { EventStore } from "@ronggang/world-core";
import type { RecoveryCheckpointHealthSummary } from "./recovery-checkpoint-coordinator.js";

export interface OperationsHealthSnapshot {
  generatedAt: string;
  productVersion: string;
  scope: {
    visibleSessionCount: number;
  };
  sessions: {
    total: number;
    statuses: Record<TrainingSessionStatus, number>;
    recoveryFailed: number;
  };
  outbox: {
    pending: number;
    delivered: number;
  };
  agentTasks: {
    pending: number;
    running: number;
    completed: number;
    failed: number;
    deadLettered: number;
  };
  mediaWorkItems: {
    queued: number;
    running: number;
    completed: number;
    failed: number;
  };
  oldestPendingAt: {
    overall: string | null;
    outbox: string | null;
    agentTasks: string | null;
    mediaWorkItems: string | null;
  };
  recoveryCheckpoints?: RecoveryCheckpointHealthSummary;
}

export interface OperationsHealthDependencies {
  eventStore: Pick<EventStore, "loadOutbox">;
  agentTaskStore: Pick<AgentTaskStore, "list" | "listDeadLetters">;
  mediaProcessingWorkStore: Pick<MediaProcessingWorkStore, "list">;
  sessionControlStore: Pick<SessionControlStore, "getSession">;
  getRecoveryCheckpointHealth?: (
    visibleSessionIds: readonly string[],
  ) => RecoveryCheckpointHealthSummary;
}

export interface BuildOperationsHealthSnapshotInput {
  generatedAt: string;
  productVersion: string;
  visibleSessionIds: readonly string[];
}

const SESSION_STATUSES = [
  "provisioning",
  "active",
  "paused",
  "completed",
  "recovery_failed",
] as const satisfies readonly TrainingSessionStatus[];

function emptySessionStatusCounts(): Record<TrainingSessionStatus, number> {
  return {
    provisioning: 0,
    active: 0,
    paused: 0,
    completed: 0,
    recovery_failed: 0,
  };
}

function oldestTimestamp(values: readonly string[]): string | null {
  let oldest: { value: string; time: number } | null = null;
  for (const value of values) {
    const time = Date.parse(value);
    if (Number.isNaN(time)) continue;
    if (!oldest || time < oldest.time) oldest = { value, time };
  }
  return oldest?.value ?? null;
}

/**
 * Builds an operations-only projection. It deliberately emits counts and
 * timestamps only: record identifiers, payloads, prompts, memory, lease
 * tokens and idempotency keys never cross this boundary.
 */
export async function buildOperationsHealthSnapshot(
  dependencies: OperationsHealthDependencies,
  input: BuildOperationsHealthSnapshotInput,
): Promise<OperationsHealthSnapshot> {
  const visibleSessionIds = [...new Set(input.visibleSessionIds)]
    .filter((sessionId) => sessionId.length > 0)
    .sort();

  const snapshot: OperationsHealthSnapshot = {
    generatedAt: input.generatedAt,
    productVersion: input.productVersion,
    scope: {
      visibleSessionCount: visibleSessionIds.length,
    },
    sessions: {
      total: 0,
      statuses: emptySessionStatusCounts(),
      recoveryFailed: 0,
    },
    outbox: {
      pending: 0,
      delivered: 0,
    },
    agentTasks: {
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0,
      deadLettered: 0,
    },
    mediaWorkItems: {
      queued: 0,
      running: 0,
      completed: 0,
      failed: 0,
    },
    oldestPendingAt: {
      overall: null,
      outbox: null,
      agentTasks: null,
      mediaWorkItems: null,
    },
  };
  if (dependencies.getRecoveryCheckpointHealth) {
    snapshot.recoveryCheckpoints = dependencies.getRecoveryCheckpointHealth(
      visibleSessionIds,
    );
  }

  // An empty authorization scope is an empty result, never a global query.
  if (visibleSessionIds.length === 0) return snapshot;

  const perSession = await Promise.all(
    visibleSessionIds.map(async (sessionId) => {
      const [session, outbox, agentTasks, deadLetters, mediaWorkItems] = await Promise.all([
        dependencies.sessionControlStore.getSession(sessionId),
        dependencies.eventStore.loadOutbox(sessionId),
        dependencies.agentTaskStore.list(sessionId),
        dependencies.agentTaskStore.listDeadLetters(sessionId),
        dependencies.mediaProcessingWorkStore.list(sessionId),
      ]);
      return {
        sessionId,
        session: session?.sessionId === sessionId ? session : null,
        outbox: outbox.filter((record) => record.sessionId === sessionId),
        agentTasks: agentTasks.filter((task) => task.sessionId === sessionId),
        deadLetters: deadLetters.filter((record) => record.sessionId === sessionId),
        mediaWorkItems: mediaWorkItems.filter((item) => item.sessionId === sessionId),
      };
    }),
  );

  const pendingOutboxCreatedAt: string[] = [];
  const pendingAgentTaskCreatedAt: string[] = [];
  const pendingMediaWorkItemCreatedAt: string[] = [];

  for (const records of perSession) {
    if (records.session && SESSION_STATUSES.includes(records.session.status)) {
      snapshot.sessions.total += 1;
      snapshot.sessions.statuses[records.session.status] += 1;
    }

    for (const record of records.outbox) {
      snapshot.outbox[record.status] += 1;
      if (record.status === "pending") pendingOutboxCreatedAt.push(record.createdAt);
    }

    for (const task of records.agentTasks) {
      switch (task.status) {
        case "queued":
          snapshot.agentTasks.pending += 1;
          pendingAgentTaskCreatedAt.push(task.createdAt);
          break;
        case "running":
          snapshot.agentTasks.running += 1;
          break;
        case "completed":
        case "degraded":
        case "skipped":
          snapshot.agentTasks.completed += 1;
          break;
        case "failed":
          snapshot.agentTasks.failed += 1;
          break;
      }
    }
    snapshot.agentTasks.deadLettered += records.deadLetters.length;

    for (const item of records.mediaWorkItems) {
      snapshot.mediaWorkItems[item.status] += 1;
      if (item.status === "queued") pendingMediaWorkItemCreatedAt.push(item.createdAt);
    }
  }

  snapshot.sessions.recoveryFailed = snapshot.sessions.statuses.recovery_failed;
  snapshot.oldestPendingAt.outbox = oldestTimestamp(pendingOutboxCreatedAt);
  snapshot.oldestPendingAt.agentTasks = oldestTimestamp(pendingAgentTaskCreatedAt);
  snapshot.oldestPendingAt.mediaWorkItems = oldestTimestamp(
    pendingMediaWorkItemCreatedAt,
  );
  snapshot.oldestPendingAt.overall = oldestTimestamp([
    ...pendingOutboxCreatedAt,
    ...pendingAgentTaskCreatedAt,
    ...pendingMediaWorkItemCreatedAt,
  ]);
  return snapshot;
}
