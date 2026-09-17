import {
  createRecoveryCheckpoint,
  type RecoveryCheckpoint,
  type RecoveryCheckpointCatalog,
} from "@ronggang/session-control";
import type { StateProjection } from "@ronggang/contracts";
import { describe, expect, it } from "vitest";
import {
  SESSION_RECOVERY_INTEGRITY_SCHEMA,
  SessionRecoveryCheckpointCoordinator,
  buildStableProjectionPayload,
  classifyRecoveryCheckpoint,
  type SessionRecoveryIntegrityPayload,
} from "../src/recovery-checkpoint-coordinator.js";

const t0 = "2026-07-26T00:00:00.000Z";
const t1 = "2026-07-26T00:01:00.000Z";

function payload(
  sessionId = "session-a",
  overrides: Partial<SessionRecoveryIntegrityPayload> = {},
): SessionRecoveryIntegrityPayload {
  return {
    schema: SESSION_RECOVERY_INTEGRITY_SCHEMA,
    sessionId,
    anchorHash: "a".repeat(64),
    sessionStatusVersion: 1,
    worldStateVersion: 7,
    sessionEpoch: "epoch-a",
    counts: {
      events: 7,
      outbox: 7,
      tasks: 3,
      attempts: 3,
      deadLetters: 0,
      mediaWorkItems: 1,
      mediaAttempts: 1,
      traceRecords: 20,
      traceLinks: 19,
      roleMemoryDeltas: 2,
      referencedObjects: 1,
    },
    componentHashes: {
      session: "1".repeat(64),
      scenarioRelease: "2".repeat(64),
      worldEvents: "3".repeat(64),
      outbox: "4".repeat(64),
      tasks: "5".repeat(64),
      attempts: "6".repeat(64),
      deadLetters: "7".repeat(64),
      mediaWorkItems: "8".repeat(64),
      mediaAttempts: "9".repeat(64),
      teacherProjection: "a".repeat(64),
      teacherTrace: "b".repeat(64),
      roleMemory: "c".repeat(64),
      referencedObjects: "d".repeat(64),
    },
    progressCommitments: {
      roleMemory: ["1".repeat(64), "2".repeat(64)],
      referencedObjects: ["3".repeat(64)],
    },
    ...overrides,
  };
}

function legacyPayload(current: SessionRecoveryIntegrityPayload) {
  const {
    roleMemoryDeltas: _roleMemoryDeltas,
    referencedObjects: _referencedObjects,
    ...counts
  } = current.counts;
  const {
    roleMemory: _roleMemory,
    referencedObjects: _referencedObjectHash,
    ...componentHashes
  } = current.componentHashes;
  return {
    schema: "ronggang.session-recovery-integrity.v1" as const,
    sessionId: current.sessionId,
    anchorHash: current.anchorHash,
    sessionStatusVersion: current.sessionStatusVersion,
    worldStateVersion: current.worldStateVersion,
    sessionEpoch: current.sessionEpoch,
    counts,
    componentHashes,
  };
}

class MemoryCheckpointCatalog implements RecoveryCheckpointCatalog {
  readonly values = new Map<string, RecoveryCheckpoint>();

  async save(value: unknown): Promise<RecoveryCheckpoint> {
    const checkpoint = value as RecoveryCheckpoint;
    this.values.set(checkpoint.sessionId, structuredClone(checkpoint));
    return structuredClone(checkpoint);
  }

  async loadLatest(sessionId: string): Promise<RecoveryCheckpoint | null> {
    const checkpoint = this.values.get(sessionId);
    return checkpoint ? structuredClone(checkpoint) : null;
  }
}

describe("SessionRecoveryCheckpointCoordinator", () => {
  it("keeps the legacy projection commitment when a derived course guide is added", () => {
    const current = {
      messageId: "projection-current",
      correlationId: "trace-current",
      timestamp: t0,
      sessionId: "session-a",
      stateVersion: 7,
      courseGuide: {
        contentVersion: "1.0.0",
        finalDeliverable: "课程交付",
      },
    } as unknown as StateProjection;
    const legacy = { ...current } as Partial<StateProjection>;
    delete legacy.courseGuide;

    expect(buildStableProjectionPayload(current)).toEqual(
      buildStableProjectionPayload(legacy as StateProjection),
    );
    expect(buildStableProjectionPayload(current)).not.toHaveProperty(
      "courseGuide",
    );
  });

  it("records a stable capture and verifies the same durable state after restart", async () => {
    const catalog = new MemoryCheckpointCatalog();
    const current = payload();
    let reads = 0;
    const first = new SessionRecoveryCheckpointCoordinator({
      catalog,
      capture: async () => {
        reads += 1;
        return structuredClone(current);
      },
      now: () => t0,
    });

    await expect(first.record("session-a")).resolves.toMatchObject({
      status: "verified",
      sourceRevision: 1,
      sourceSequence: 0,
      worldStateVersion: 7,
    });
    expect(reads).toBe(2);

    const restarted = new SessionRecoveryCheckpointCoordinator({
      catalog,
      capture: async () => structuredClone(current),
      now: () => t1,
    });
    await expect(restarted.inspect("session-a")).resolves.toMatchObject({
      status: "verified",
      checkpointCreatedAt: t0,
      checkedAt: t1,
    });
  });

  it("distinguishes expected uncheckpointed progress from same-anchor corruption", () => {
    const previous = payload();
    const checkpoint = createRecoveryCheckpoint({
      sessionId: previous.sessionId,
      sourceRevision: previous.sessionStatusVersion,
      sourceSequence: 0,
      createdAt: t0,
      payload: previous,
    });
    const progressed = payload("session-a", {
      anchorHash: "c".repeat(64),
      worldStateVersion: 8,
    });
    const corrupted = payload("session-a", {
      componentHashes: {
        ...previous.componentHashes,
        worldEvents: "f".repeat(64),
      },
    });

    expect(classifyRecoveryCheckpoint(checkpoint, progressed, t1).status)
      .toBe("stale");
    expect(classifyRecoveryCheckpoint(checkpoint, corrupted, t1).status)
      .toBe("mismatch");
  });

  it("does not treat memory or object deletion/replacement as progress", () => {
    const previous = payload();
    const checkpoint = createRecoveryCheckpoint({
      sessionId: previous.sessionId,
      sourceRevision: previous.sessionStatusVersion,
      sourceSequence: 0,
      createdAt: t0,
      payload: previous,
    });
    const changedWithoutCoreProgress = [
      payload("session-a", {
        counts: { ...previous.counts, roleMemoryDeltas: 1 },
        componentHashes: {
          ...previous.componentHashes,
          roleMemory: "e".repeat(64),
        },
        progressCommitments: {
          ...previous.progressCommitments,
          roleMemory: ["1".repeat(64)],
        },
      }),
      payload("session-a", {
        componentHashes: {
          ...previous.componentHashes,
          roleMemory: "e".repeat(64),
        },
        progressCommitments: {
          ...previous.progressCommitments,
          roleMemory: ["1".repeat(64), "e".repeat(64)],
        },
      }),
      payload("session-a", {
        counts: { ...previous.counts, referencedObjects: 0 },
        componentHashes: {
          ...previous.componentHashes,
          referencedObjects: "e".repeat(64),
        },
        progressCommitments: {
          ...previous.progressCommitments,
          referencedObjects: [],
        },
      }),
      payload("session-a", {
        counts: { ...previous.counts, referencedObjects: 2 },
        componentHashes: {
          ...previous.componentHashes,
          referencedObjects: "f".repeat(64),
        },
        progressCommitments: {
          ...previous.progressCommitments,
          referencedObjects: ["e".repeat(64), "f".repeat(64)],
        },
      }),
    ];

    for (const changed of changedWithoutCoreProgress) {
      expect(classifyRecoveryCheckpoint(checkpoint, changed, t1).status)
        .toBe("mismatch");
    }

    const progressedWithNewObjects = payload("session-a", {
      anchorHash: "c".repeat(64),
      worldStateVersion: 8,
      counts: {
        ...previous.counts,
        events: previous.counts.events + 1,
        referencedObjects: previous.counts.referencedObjects + 1,
      },
      componentHashes: {
        ...previous.componentHashes,
        worldEvents: "e".repeat(64),
        referencedObjects: "f".repeat(64),
      },
      progressCommitments: {
        ...previous.progressCommitments,
        referencedObjects: [
          ...previous.progressCommitments.referencedObjects,
          "f".repeat(64),
        ],
      },
    });
    expect(
      classifyRecoveryCheckpoint(checkpoint, progressedWithNewObjects, t1)
        .status,
    ).toBe("stale");

    const progressedWithDeletedObject = payload("session-a", {
      anchorHash: "c".repeat(64),
      worldStateVersion: 8,
      counts: {
        ...previous.counts,
        events: previous.counts.events + 1,
        referencedObjects: 1,
      },
      componentHashes: {
        ...previous.componentHashes,
        worldEvents: "e".repeat(64),
        referencedObjects: "f".repeat(64),
      },
      progressCommitments: {
        ...previous.progressCommitments,
        referencedObjects: ["f".repeat(64)],
      },
    });
    expect(
      classifyRecoveryCheckpoint(
        checkpoint,
        progressedWithDeletedObject,
        t1,
      ).status,
    ).toBe("mismatch");
  });

  it("upgrades only an exact real v1 protected payload", () => {
    const current = payload();
    const legacy = legacyPayload(current);
    const checkpoint = createRecoveryCheckpoint({
      sessionId: current.sessionId,
      sourceRevision: current.sessionStatusVersion,
      sourceSequence: 0,
      createdAt: t0,
      payload: legacy,
    });

    expect(classifyRecoveryCheckpoint(checkpoint, current, t1).status)
      .toBe("stale");

    const tamperedLegacy = {
      ...legacy,
      componentHashes: {
        ...legacy.componentHashes,
        teacherTrace: "f".repeat(64),
      },
    };
    const tamperedCheckpoint = createRecoveryCheckpoint({
      sessionId: current.sessionId,
      sourceRevision: current.sessionStatusVersion,
      sourceSequence: 0,
      createdAt: t0,
      payload: tamperedLegacy,
    });
    expect(
      classifyRecoveryCheckpoint(tamperedCheckpoint, current, t1).status,
    ).toBe("mismatch");

    const progressed = payload("session-a", {
      anchorHash: "e".repeat(64),
      worldStateVersion: 8,
    });
    expect(classifyRecoveryCheckpoint(checkpoint, progressed, t1).status)
      .toBe("stale");
  });

  it("writes v2 once after an exact v1 upgrade and verifies the next restart", async () => {
    const catalog = new MemoryCheckpointCatalog();
    const current = payload();
    await catalog.save(createRecoveryCheckpoint({
      sessionId: current.sessionId,
      sourceRevision: current.sessionStatusVersion,
      sourceSequence: 3,
      createdAt: t0,
      payload: legacyPayload(current),
    }));
    const upgrading = new SessionRecoveryCheckpointCoordinator({
      catalog,
      capture: async () => structuredClone(current),
      now: () => t1,
    });

    await expect(upgrading.record(current.sessionId)).resolves.toMatchObject({
      status: "verified",
      sourceSequence: 4,
    });
    expect((await catalog.loadLatest(current.sessionId))?.payload)
      .toMatchObject({ schema: SESSION_RECOVERY_INTEGRITY_SCHEMA });

    const restarted = new SessionRecoveryCheckpointCoordinator({
      catalog,
      capture: async () => structuredClone(current),
      now: () => "2026-07-26T00:02:00.000Z",
    });
    await expect(restarted.inspect(current.sessionId)).resolves.toMatchObject({
      status: "verified",
      sourceSequence: 4,
    });
  });

  it("never overwrites the last verified checkpoint on a mismatch", async () => {
    const catalog = new MemoryCheckpointCatalog();
    const previous = payload();
    const saved = createRecoveryCheckpoint({
      sessionId: previous.sessionId,
      sourceRevision: previous.sessionStatusVersion,
      sourceSequence: 4,
      createdAt: t0,
      payload: previous,
    });
    await catalog.save(saved);
    const corrupted = payload("session-a", {
      componentHashes: {
        ...previous.componentHashes,
        teacherTrace: "f".repeat(64),
      },
    });
    const coordinator = new SessionRecoveryCheckpointCoordinator({
      catalog,
      capture: async () => structuredClone(corrupted),
      now: () => t1,
    });

    await expect(coordinator.record("session-a")).rejects.toMatchObject({
      code: "checkpoint_tampered",
    });
    expect(await catalog.loadLatest("session-a")).toEqual(saved);
    expect(coordinator.getObservation("session-a")?.status).toBe("mismatch");
  });

  it("rejects a control-plane source regression before startup can treat it as stale", async () => {
    const catalog = new MemoryCheckpointCatalog();
    const previous = payload("session-a", {
      sessionStatusVersion: 2,
    });
    await catalog.save(createRecoveryCheckpoint({
      sessionId: previous.sessionId,
      sourceRevision: previous.sessionStatusVersion,
      sourceSequence: 0,
      createdAt: t0,
      payload: previous,
    }));
    const regressed = payload("session-a", {
      anchorHash: "c".repeat(64),
      sessionStatusVersion: 1,
      worldStateVersion: 6,
    });
    const coordinator = new SessionRecoveryCheckpointCoordinator({
      catalog,
      capture: async () => structuredClone(regressed),
      now: () => t1,
    });

    await expect(coordinator.inspect("session-a")).rejects.toMatchObject({
      code: "checkpoint_source_conflict",
    });
    expect(coordinator.getObservation("session-a")).toBeNull();
  });

  it("summarizes only explicitly visible sessions", async () => {
    const catalog = new MemoryCheckpointCatalog();
    const coordinator = new SessionRecoveryCheckpointCoordinator({
      catalog,
      capture: async (sessionId) => payload(sessionId),
      now: () => t0,
    });
    await coordinator.record("visible-a");
    await coordinator.record("hidden-b");

    expect(coordinator.summarize(["visible-a"])).toEqual({
      total: 1,
      missing: 0,
      verified: 1,
      stale: 0,
      mismatch: 0,
      latestVerifiedAt: t0,
    });
  });
});
