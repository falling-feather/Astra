import { constants as bufferConstants } from "node:buffer";
import { appendFile, mkdtemp, readFile, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  OutboxRecordSchema,
  SchemaVersion,
  WorldEventSchema,
  createMessageMeta,
  type Command,
} from "@ronggang/contracts";
import {
  WorldEngine,
  demoScenario,
  type EventStore,
} from "@ronggang/world-core";
import { JsonlEventStore } from "../src/file-event-store.js";

function inspectCommand(sessionId: string, stateVersion: number): Command {
  return {
    ...createMessageMeta({
      sessionId,
      sceneId: "scenario-local-tourism-media-v0.1",
      actorId: "student-editor",
      correlationId: "test-file-store",
      timestamp: "2026-07-25T08:00:00.000Z",
    }),
    kind: "Command",
    name: "inspect_material",
    expectedStateVersion: stateVersion,
    payload: {},
  };
}

function testWorld(store: EventStore): WorldEngine {
  const scenario = structuredClone(demoScenario);
  scenario.interactionGates = [];
  return new WorldEngine({ store, scenario });
}

describe("JsonlEventStore", () => {
  it("enumerates sessions without loading oversized non-world journals", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ronggang-world-enumeration-"));
    try {
      const store = new JsonlEventStore(directory);
      const sessionIds = [
        "demo-ai-copyright-v2",
        "demo-rain-emergency-v2",
        "demo-village-super-v2",
      ];
      for (const sessionId of sessionIds) {
        await testWorld(store).createSession(sessionId, true);
      }

      const unrelatedPath = join(directory, "agent-tasks.jsonl");
      await writeFile(unrelatedPath, "{\"kind\":\"agent_task_snapshot\"}\n", "utf8");
      await truncate(unrelatedPath, bufferConstants.MAX_STRING_LENGTH + 1_024);

      expect(await store.listSessionIds()).toEqual(sessionIds);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("serializes reads behind an active writer so tail repair cannot truncate a live commit", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ronggang-world-lock-"));
    let releaseWriter!: () => void;
    let writerEntered!: () => void;
    const writerGate = new Promise<void>((resolve) => { releaseWriter = resolve; });
    const writerStarted = new Promise<void>((resolve) => { writerEntered = resolve; });
    let appendCount = 0;
    try {
      const sessionId = "session-file-lock";
      const store = new JsonlEventStore(directory, {
        beforeWorldCommitAppend: async () => {
          appendCount += 1;
          if (appendCount !== 2) return;
          writerEntered();
          await writerGate;
        },
      });
      const world = testWorld(store);
      await world.createSession(sessionId, true);
      const projection = await world.getProjection(sessionId, "student-editor");
      const write = world.execute(inspectCommand(sessionId, projection.stateVersion));
      await writerStarted;

      let readSettled = false;
      const read = store.load(sessionId).then((events) => {
        readSettled = true;
        return events;
      });
      await Promise.resolve();
      await Promise.resolve();
      expect(readSettled).toBe(false);

      releaseWriter();
      await write;
      expect((await read).some((event) => event.eventType === "material_observed")).toBe(true);
    } finally {
      releaseWriter?.();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("reopens world events and Outbox transitions from the same journal", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ronggang-world-store-"));
    try {
      const sessionId = "session-file-reopen";
      const store = new JsonlEventStore(directory);
      const world = testWorld(store);
      await world.createSession(sessionId, true);
      const projection = await world.getProjection(sessionId, "student-editor");
      await world.execute(inspectCommand(sessionId, projection.stateVersion));

      const reopened = new JsonlEventStore(directory);
      const events = await reopened.load(sessionId);
      const outbox = await reopened.loadOutbox(sessionId);
      expect(events.some((event) => event.eventType === "material_observed")).toBe(true);
      expect(outbox).toHaveLength(events.length);
      await reopened.markOutboxDelivered(sessionId, outbox[0]!.outboxId, "2026-07-25T08:01:00.000Z");

      const delivered = (await new JsonlEventStore(directory).loadOutbox(sessionId))
        .find((record) => record.outboxId === outbox[0]!.outboxId);
      expect(delivered).toMatchObject({
        status: "delivered",
        attempts: 1,
        deliveredAt: "2026-07-25T08:01:00.000Z",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects duplicate Outbox IDs and event metadata mismatches during append and replay", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ronggang-world-identity-"));
    try {
      const sessionId = "session-file-identity";
      const path = join(directory, `${sessionId}.jsonl`);
      const store = new JsonlEventStore(directory);
      await testWorld(store).createSession(sessionId, true);
      const journal = await store.loadJournalSnapshot(sessionId);
      const lastEvent = journal.events.at(-1)!;
      const templateOutbox = journal.outbox[0]!;
      const timestamp = "2026-07-25T08:05:00.000Z";
      const makeEvent = (offset: number) => WorldEventSchema.parse({
        ...lastEvent,
        eventId: `identity-event-${offset}`,
        messageId: `identity-message-${offset}`,
        correlationId: `identity-correlation-${offset}`,
        timestamp,
        stateVersion: lastEvent.stateVersion + offset,
        summary: `标识约束测试事件 ${offset}`,
      });
      const makeOutbox = (
        event: ReturnType<typeof makeEvent>,
        outboxId: string,
      ) => OutboxRecordSchema.parse({
        ...templateOutbox,
        outboxId,
        eventId: event.eventId,
        sceneId: event.sceneId,
        eventType: event.eventType,
        stateVersion: event.stateVersion,
        correlationId: event.correlationId,
        status: "pending",
        attempts: 0,
        availableAt: event.timestamp,
        createdAt: event.timestamp,
        deliveredAt: null,
        lastErrorCode: null,
      });
      const first = makeEvent(1);
      const second = makeEvent(2);
      const batchCollisionId = "outbox-batch-collision";
      await expect(store.append(
        sessionId,
        lastEvent.stateVersion,
        [first, second],
        [makeOutbox(first, batchCollisionId), makeOutbox(second, batchCollisionId)],
      )).rejects.toThrow("Outbox ID 在当前会话中不唯一");

      await expect(store.append(
        sessionId,
        lastEvent.stateVersion,
        [first],
        [{ ...makeOutbox(first, "outbox-metadata-mismatch"), sceneId: "wrong-scene" }],
      )).rejects.toThrow("Outbox 元数据与所绑定世界事件不一致");

      const epochMismatch = {
        ...makeOutbox(first, "outbox-epoch-mismatch"),
        sessionEpoch: "session-epoch-from-another-world",
      };
      await expect(store.append(
        sessionId,
        lastEvent.stateVersion,
        [first],
        [epochMismatch],
      )).rejects.toThrow("Outbox 元数据与所绑定世界事件不一致");

      const existingCollision = makeOutbox(first, templateOutbox.outboxId);
      await expect(store.append(
        sessionId,
        lastEvent.stateVersion,
        [first],
        [existingCollision],
      )).rejects.toThrow("Outbox ID 在当前会话中不唯一");

      const validBody = await readFile(path, "utf8");
      await appendFile(path, `${JSON.stringify({
        kind: "world_commit",
        events: [first],
        outbox: [existingCollision],
      })}\n`, "utf8");
      await expect(new JsonlEventStore(directory).load(sessionId))
        .rejects.toThrow("Outbox ID 在当前会话中不唯一");

      await writeFile(path, validBody, "utf8");
      await appendFile(path, `${JSON.stringify({
        kind: "world_commit",
        events: [first],
        outbox: [epochMismatch],
      })}\n`, "utf8");
      await expect(new JsonlEventStore(directory).load(sessionId))
        .rejects.toThrow("Outbox 元数据与所绑定世界事件不一致");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("repairs a torn final frame without exposing a partial world commit", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ronggang-world-torn-"));
    try {
      const sessionId = "session-file-torn";
      const path = join(directory, `${sessionId}.jsonl`);
      const store = new JsonlEventStore(directory);
      const world = testWorld(store);
      await world.createSession(sessionId, true);
      const before = await store.load(sessionId);
      await appendFile(path, "{\"kind\":\"world_commit\",\"events\":[", "utf8");

      const recovered = new JsonlEventStore(directory);
      expect(await recovered.load(sessionId)).toEqual(before);
      const projection = await testWorld(recovered)
        .getProjection(sessionId, "student-editor");
      await testWorld(recovered)
        .execute(inspectCommand(sessionId, projection.stateVersion));
      expect((await recovered.load(sessionId)).some((event) => event.eventType === "material_observed"))
        .toBe(true);
      expect((await readFile(path, "utf8")).endsWith("\n")).toBe(true);

      const validBody = await readFile(path, "utf8");
      await writeFile(path, validBody.trimEnd(), "utf8");
      const unterminated = new JsonlEventStore(directory);
      await unterminated.load(sessionId);
      expect((await readFile(path, "utf8")).endsWith("\n")).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("persists a reset marker so restart can rebuild after a crash between reset and bootstrap", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ronggang-world-reset-"));
    try {
      const sessionId = "session-file-reset";
      const store = new JsonlEventStore(directory);
      const world = testWorld(store);
      await world.createSession(sessionId, true);
      const oldEventIds = new Set((await store.load(sessionId)).map((event) => event.eventId));
      await store.reset(sessionId);

      const reopened = new JsonlEventStore(directory);
      expect(await reopened.load(sessionId)).toEqual([]);
      await testWorld(reopened).createSession(sessionId, false);
      const rebuilt = await reopened.load(sessionId);
      expect(rebuilt.length).toBeGreaterThan(0);
      expect(rebuilt.every((event) => !oldEventIds.has(event.eventId))).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("retains read compatibility with the V0.2 event-per-line format", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ronggang-world-legacy-"));
    try {
      const sessionId = "session-file-legacy";
      const legacy = WorldEventSchema.parse({
        kind: "WorldEvent",
        sessionId,
        sceneId: "scenario-local-tourism-media-v0.1",
        actorId: "system",
        messageId: "legacy-message-1",
        correlationId: "legacy-correlation-1",
        timestamp: "2026-07-24T08:00:00.000Z",
        schemaVersion: SchemaVersion,
        eventId: "legacy-event-1",
        eventType: "session_started",
        stateVersion: 1,
        visibility: ["public_world", "audit_only"],
        visibleToActorIds: [],
        summary: "旧版会话启动",
        payload: {},
      });
      await writeFile(join(directory, `${sessionId}.jsonl`), `${JSON.stringify(legacy)}\n`, "utf8");
      expect(await new JsonlEventStore(directory).load(sessionId)).toEqual([legacy]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
