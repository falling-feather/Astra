import { describe, expect, it, vi } from "vitest";
import {
  AgentTaskSchema,
  type AgentTask,
  type DeadLetterRecord,
  type OutboxRecord,
} from "@ronggang/contracts";
import type { MediaProcessingWorkItem } from "@ronggang/media-processing";
import type {
  TrainingSessionRecord,
  TrainingSessionStatus,
} from "@ronggang/session-control";
import {
  buildOperationsHealthSnapshot,
  type OperationsHealthDependencies,
} from "../src/operations-health.js";

const generatedAt = "2026-07-26T12:00:00.000Z";
const hash = "a".repeat(64);

function session(
  sessionId: string,
  status: TrainingSessionStatus,
): TrainingSessionRecord {
  return {
    sessionId,
    classroomId: `classroom-${sessionId}`,
    teamId: `team-${sessionId}`,
    releaseId: "release-1",
    status,
    statusVersion: 1,
    requestedBy: "principal-secret",
    createdAt: "2026-07-26T01:00:00.000Z",
    updatedAt: "2026-07-26T01:00:00.000Z",
    activatedAt: status === "active" ? "2026-07-26T01:00:00.000Z" : null,
    completedAt: status === "completed" ? "2026-07-26T02:00:00.000Z" : null,
    lastRecoveryErrorCode: status === "recovery_failed" ? "PRIVATE_ERROR" : null,
  };
}

function outbox(
  sessionId: string,
  status: OutboxRecord["status"],
  createdAt: string,
): OutboxRecord {
  return {
    outboxId: `outbox-${sessionId}-${status}-${createdAt}`,
    sessionId,
    sessionEpoch: "epoch-secret",
    sceneId: "scene-1",
    eventId: "event-1",
    eventType: "session_started",
    stateVersion: 1,
    correlationId: "correlation-secret",
    topic: "world_event",
    causalDepth: 0,
    status,
    attempts: status === "delivered" ? 1 : 0,
    availableAt: createdAt,
    createdAt,
    deliveredAt: status === "delivered" ? generatedAt : null,
    lastErrorCode: null,
  };
}

function agentTask(
  sessionId: string,
  status: AgentTask["status"],
  createdAt: string,
): AgentTask {
  return AgentTaskSchema.parse({
    taskId: `task-${sessionId}-${status}-${createdAt}`,
    outboxId: "outbox-secret",
    subscriptionId: "subscription-secret",
    agentId: "agent-secret",
    roleId: "reporter",
    definitionVersion: "definition-secret",
    promptVersion: "PRIVATE_PROMPT_VERSION",
    sessionId,
    sessionEpoch: "epoch-secret",
    sceneId: "scene-1",
    triggerEventId: "event-secret",
    triggerEventType: "session_started",
    expectedStateVersion: 1,
    priority: 1,
    correlationId: "correlation-secret",
    causalDepth: 0,
    idempotencyKey: "PRIVATE_IDEMPOTENCY_KEY",
    status,
    attempts: 0,
    maxAttempts: 3,
    availableAt: createdAt,
    lease: status === "running"
      ? {
          ownerId: "worker-secret",
          token: "PRIVATE_LEASE_TOKEN",
          acquiredAt: createdAt,
          expiresAt: generatedAt,
        }
      : null,
    lastErrorCode: null,
    createdAt,
    updatedAt: createdAt,
    completedAt: status === "completed" ? generatedAt : null,
  });
}

function deadLetter(sessionId: string): DeadLetterRecord {
  return {
    deadLetterId: `dead-letter-${sessionId}`,
    taskId: "task-secret",
    sessionId,
    idempotencyKey: "PRIVATE_DEAD_LETTER_IDEMPOTENCY_KEY",
    reasonCode: "PRIVATE_REASON",
    attempts: 3,
    createdAt: "2026-07-26T02:00:00.000Z",
  };
}

function mediaWorkItem(
  sessionId: string,
  status: MediaProcessingWorkItem["status"],
  createdAt: string,
): MediaProcessingWorkItem {
  return {
    workItemId: `media-${sessionId}-${status}-${createdAt}`,
    idempotencyKey: "PRIVATE_MEDIA_IDEMPOTENCY_KEY",
    sessionId,
    sessionEpoch: "epoch-secret",
    taskId: "media-task-secret",
    stepId: "step-secret",
    capability: "image_understanding",
    governanceDomain: null,
    governanceNode: null,
    branchPriority: null,
    timeoutMs: 120_000,
    attemptNumber: 1,
    inputRef: "PRIVATE_INPUT_REF",
    inputContentHash: hash,
    mediaType: "image",
    status,
    claimCount: 0,
    lease: null,
    createdAt,
    updatedAt: createdAt,
    completedAt: status === "completed" ? generatedAt : null,
    lastErrorCode: null,
  };
}

function dependencies(input: {
  sessions?: TrainingSessionRecord[];
  outbox?: OutboxRecord[];
  agentTasks?: AgentTask[];
  deadLetters?: DeadLetterRecord[];
  mediaWorkItems?: MediaProcessingWorkItem[];
} = {}): OperationsHealthDependencies {
  const sessions = input.sessions ?? [];
  const outboxRecords = input.outbox ?? [];
  const tasks = input.agentTasks ?? [];
  const deadLetters = input.deadLetters ?? [];
  const mediaWorkItems = input.mediaWorkItems ?? [];
  return {
    sessionControlStore: {
      getSession: vi.fn(async (sessionId) => (
        sessions.find((item) => item.sessionId === sessionId) ?? null
      )),
    },
    eventStore: {
      loadOutbox: vi.fn(async (sessionId) => (
        outboxRecords.filter((item) => item.sessionId === sessionId)
      )),
    },
    agentTaskStore: {
      list: vi.fn(async (sessionId) => (
        tasks.filter((item) => item.sessionId === sessionId)
      )),
      listDeadLetters: vi.fn(async (sessionId) => (
        deadLetters.filter((item) => item.sessionId === sessionId)
      )),
    },
    mediaProcessingWorkStore: {
      list: vi.fn(async (sessionId) => (
        mediaWorkItems.filter((item) => item.sessionId === sessionId)
      )),
    },
  };
}

describe("buildOperationsHealthSnapshot", () => {
  it("returns zero counts without querying stores when the visible scope is empty", async () => {
    const stores = dependencies({
      sessions: [session("hidden", "recovery_failed")],
      agentTasks: [agentTask("hidden", "failed", "2026-07-26T01:00:00.000Z")],
    });

    const result = await buildOperationsHealthSnapshot(stores, {
      generatedAt,
      productVersion: "0.9.2",
      visibleSessionIds: [],
    });

    expect(result).toMatchObject({
      generatedAt,
      productVersion: "0.9.2",
      scope: { visibleSessionCount: 0 },
      sessions: { total: 0, recoveryFailed: 0 },
      outbox: { pending: 0, delivered: 0 },
      agentTasks: {
        pending: 0,
        running: 0,
        completed: 0,
        failed: 0,
        deadLettered: 0,
      },
    });
    expect(stores.sessionControlStore.getSession).not.toHaveBeenCalled();
    expect(stores.eventStore.loadOutbox).not.toHaveBeenCalled();
  });

  it("isolates records to the visible sessions and counts every public status bucket", async () => {
    const stores = dependencies({
      sessions: [
        session("visible-a", "active"),
        session("visible-b", "recovery_failed"),
        session("visible-c", "provisioning"),
        session("visible-d", "paused"),
        session("visible-e", "completed"),
        session("hidden", "completed"),
      ],
      outbox: [
        outbox("visible-a", "pending", "2026-07-26T05:00:00.000Z"),
        outbox("visible-b", "delivered", "2026-07-26T05:01:00.000Z"),
        outbox("hidden", "pending", "2026-07-25T00:00:00.000Z"),
      ],
      agentTasks: [
        agentTask("visible-a", "queued", "2026-07-26T04:00:00.000Z"),
        agentTask("visible-a", "running", "2026-07-26T04:01:00.000Z"),
        agentTask("visible-a", "completed", "2026-07-26T04:02:00.000Z"),
        agentTask("visible-a", "degraded", "2026-07-26T04:03:00.000Z"),
        agentTask("visible-b", "skipped", "2026-07-26T04:04:00.000Z"),
        agentTask("visible-b", "failed", "2026-07-26T04:05:00.000Z"),
        agentTask("hidden", "failed", "2026-07-25T00:00:00.000Z"),
      ],
      deadLetters: [deadLetter("visible-b"), deadLetter("hidden")],
      mediaWorkItems: [
        mediaWorkItem("visible-a", "queued", "2026-07-26T03:00:00.000Z"),
        mediaWorkItem("visible-a", "running", "2026-07-26T03:01:00.000Z"),
        mediaWorkItem("visible-b", "completed", "2026-07-26T03:02:00.000Z"),
        mediaWorkItem("visible-b", "failed", "2026-07-26T03:03:00.000Z"),
        mediaWorkItem("hidden", "failed", "2026-07-25T00:00:00.000Z"),
      ],
    });

    const result = await buildOperationsHealthSnapshot(stores, {
      generatedAt,
      productVersion: "0.9.2",
      visibleSessionIds: [
        "visible-e",
        "visible-d",
        "visible-c",
        "visible-b",
        "visible-a",
        "visible-a",
      ],
    });

    expect(result).toEqual({
      generatedAt,
      productVersion: "0.9.2",
      scope: { visibleSessionCount: 5 },
      sessions: {
        total: 5,
        statuses: {
          provisioning: 1,
          active: 1,
          paused: 1,
          completed: 1,
          recovery_failed: 1,
        },
        recoveryFailed: 1,
      },
      outbox: { pending: 1, delivered: 1 },
      agentTasks: {
        pending: 1,
        running: 1,
        completed: 3,
        failed: 1,
        deadLettered: 1,
      },
      mediaWorkItems: {
        queued: 1,
        running: 1,
        completed: 1,
        failed: 1,
      },
      oldestPendingAt: {
        overall: "2026-07-26T03:00:00.000Z",
        outbox: "2026-07-26T05:00:00.000Z",
        agentTasks: "2026-07-26T04:00:00.000Z",
        mediaWorkItems: "2026-07-26T03:00:00.000Z",
      },
    });
  });

  it("filters mismatched records defensively and serializes no sensitive fields", async () => {
    const visible = "SESSION_A_SECRET_9271";
    const hidden = "SESSION_B_SECRET_4836";
    const stores: OperationsHealthDependencies = {
      sessionControlStore: {
        getSession: vi.fn(async () => session(visible, "active")),
      },
      eventStore: {
        loadOutbox: vi.fn(async () => [
          outbox(visible, "pending", "2026-07-26T05:00:00.000Z"),
          outbox(hidden, "pending", "2026-07-25T00:00:00.000Z"),
        ]),
      },
      agentTaskStore: {
        list: vi.fn(async () => [
          agentTask(visible, "queued", "2026-07-26T04:00:00.000Z"),
          agentTask(hidden, "failed", "2026-07-25T00:00:00.000Z"),
        ]),
        listDeadLetters: vi.fn(async () => [
          deadLetter(visible),
          deadLetter(hidden),
        ]),
      },
      mediaProcessingWorkStore: {
        list: vi.fn(async () => [
          mediaWorkItem(visible, "queued", "2026-07-26T03:00:00.000Z"),
          mediaWorkItem(hidden, "failed", "2026-07-25T00:00:00.000Z"),
        ]),
      },
    };

    const result = await buildOperationsHealthSnapshot(stores, {
      generatedAt,
      productVersion: "0.9.2",
      visibleSessionIds: [visible],
    });
    const serialized = JSON.stringify(result);

    expect(result.agentTasks).toMatchObject({
      pending: 1,
      failed: 0,
      deadLettered: 1,
    });
    expect(result.mediaWorkItems).toMatchObject({ queued: 1, failed: 0 });
    expect(serialized).not.toContain(visible);
    expect(serialized).not.toContain(hidden);
    expect(serialized).not.toMatch(
      /payload|prompt|private|memory|token|idempotency|correlation|lease|inputRef/iu,
    );
  });
});
