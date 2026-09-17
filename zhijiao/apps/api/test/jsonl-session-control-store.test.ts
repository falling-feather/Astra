import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  InMemorySessionControlStore,
  SessionControlError,
  type Classroom,
  type SessionMembership,
  type TeamInstance,
  type TrainingSessionRecord,
} from "@ronggang/session-control";
import { afterEach, describe, expect, it } from "vitest";
import { JsonlSessionControlStore } from "../src/jsonl-session-control-store.js";
import { registerSessionControlStoreContract } from "./session-control-store.contract.js";

const t0 = "2026-07-26T00:00:00.000Z";
const t1 = "2026-07-26T00:01:00.000Z";
const t2 = "2026-07-26T00:02:00.000Z";
const temporaryDirectories: string[] = [];

afterEach(async () => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});

async function makePath(): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), "ronggang-session-control-"));
  temporaryDirectories.push(directory);
  return resolve(directory, "session-control.jsonl");
}

function classroom(classroomId = "class-a"): Classroom {
  return {
    classroomId,
    courseId: "course-tourism-media",
    name: classroomId,
    status: "active",
    createdAt: t0,
    updatedAt: t0,
  };
}

function team(teamId = "team-a", classroomId = "class-a"): TeamInstance {
  return {
    teamId,
    classroomId,
    name: teamId,
    status: "active",
    createdAt: t0,
    updatedAt: t0,
  };
}

function session(
  sessionId = "session-a",
  overrides: Partial<TrainingSessionRecord> = {},
): TrainingSessionRecord {
  return {
    sessionId,
    classroomId: "class-a",
    teamId: "team-a",
    releaseId: "release-tourism-v0.1",
    status: "provisioning",
    statusVersion: 0,
    requestedBy: "principal-teacher",
    createdAt: t0,
    updatedAt: t0,
    activatedAt: null,
    completedAt: null,
    lastRecoveryErrorCode: null,
    ...overrides,
  };
}

function membership(): SessionMembership {
  return {
    membershipId: "membership-student-a",
    principalId: "principal-student-a",
    classroomId: "class-a",
    teamId: "team-a",
    sessionId: null,
    role: "student",
    actorId: "student-reporter",
    status: "active",
    createdAt: t0,
    updatedAt: t0,
    revokedAt: null,
  };
}

async function seed(store: JsonlSessionControlStore): Promise<void> {
  await store.putClassroom(classroom());
  await store.putTeam(team());
}

registerSessionControlStoreContract(
  "in-memory reference",
  () => new InMemorySessionControlStore(),
);
registerSessionControlStoreContract(
  "JSONL adapter",
  async () => new JsonlSessionControlStore(await makePath()),
);

describe("JsonlSessionControlStore", () => {
  it("persists classroom, team, session, idempotency, membership, and status across reopen", async () => {
    const path = await makePath();
    const store = new JsonlSessionControlStore(path);
    await seed(store);
    await store.createSession(session(), "request-a");
    await store.putMembership(membership());
    await store.compareAndSetSessionStatus({
      sessionId: "session-a",
      expectedStatus: "provisioning",
      expectedStatusVersion: 0,
      nextStatus: "active",
      updatedAt: t1,
    });

    const reopened = new JsonlSessionControlStore(path);
    expect(await reopened.getClassroom("class-a")).toEqual(classroom());
    expect(await reopened.getTeam("team-a")).toEqual(team());
    expect((await reopened.getSession("session-a"))?.status).toBe("active");
    expect(await reopened.getMembership("membership-student-a")).toEqual(membership());
    expect((await reopened.listSessions({ principalId: "principal-student-a" })))
      .toHaveLength(1);
    expect(await reopened.createSession(session(), "request-a")).toMatchObject({
      sessionId: "session-a",
      status: "active",
      statusVersion: 1,
    });
  });

  it("preserves same-request idempotency and rejects a changed payload after reopen", async () => {
    const path = await makePath();
    const store = new JsonlSessionControlStore(path);
    await seed(store);
    await store.createSession(session(), "request-shared");

    const reopened = new JsonlSessionControlStore(path);
    await expect(reopened.createSession(
      session("session-other", { teamId: "team-a" }),
      "request-shared",
    )).rejects.toMatchObject({
      code: "idempotency_conflict",
    });
    expect((await reopened.listSessions()).map((record) => record.sessionId))
      .toEqual(["session-a"]);
  });

  it("serializes competing CAS operations across adapter instances", async () => {
    const path = await makePath();
    const first = new JsonlSessionControlStore(path);
    const second = new JsonlSessionControlStore(path);
    await seed(first);
    await first.createSession(session(), "request-a");

    const results = await Promise.allSettled([
      first.compareAndSetSessionStatus({
        sessionId: "session-a",
        expectedStatus: "provisioning",
        expectedStatusVersion: 0,
        nextStatus: "active",
        updatedAt: t1,
      }),
      second.compareAndSetSessionStatus({
        sessionId: "session-a",
        expectedStatus: "provisioning",
        expectedStatusVersion: 0,
        nextStatus: "recovery_failed",
        recoveryErrorCode: "world_init_failed",
        updatedAt: t1,
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    assert.ok(rejected && rejected.status === "rejected");
    assert.ok(rejected.reason instanceof SessionControlError);
    expect(rejected.reason.code).toBe("status_conflict");
    expect((await new JsonlSessionControlStore(path).getSession("session-a"))?.statusVersion)
      .toBe(1);
  });

  it("persists idempotent membership revocation and removes scoped visibility", async () => {
    const path = await makePath();
    const store = new JsonlSessionControlStore(path);
    await seed(store);
    await store.createSession(session(), "request-a");
    await store.putMembership(membership());
    await store.revokeMembership("membership-student-a", t1);

    const reopened = new JsonlSessionControlStore(path);
    const replay = await reopened.revokeMembership("membership-student-a", t2);
    expect(replay).toMatchObject({
      status: "revoked",
      revokedAt: t1,
      updatedAt: t1,
    });
    expect(await reopened.listSessions({ principalId: "principal-student-a" })).toEqual([]);
  });

  it("repairs only a torn final frame and continues appending valid frames", async () => {
    const path = await makePath();
    const store = new JsonlSessionControlStore(path);
    await seed(store);
    await appendFile(
      path,
      '{"schemaVersion":1,"kind":"session_created","requestId":"torn"',
      "utf8",
    );

    const reopened = new JsonlSessionControlStore(path);
    expect((await reopened.listClassrooms()).map((record) => record.classroomId))
      .toEqual(["class-a"]);
    expect((await readFile(path, "utf8")).endsWith("\n")).toBe(true);
    await reopened.createSession(session(), "request-after-repair");
    expect((await new JsonlSessionControlStore(path).listSessions())).toHaveLength(1);
  });

  it("rejects a corrupted non-tail frame without truncating the log", async () => {
    const path = await makePath();
    const valid = `${JSON.stringify({
      schemaVersion: 1,
      kind: "classroom_put",
      record: classroom(),
    })}\n`;
    const corrupted = '{"schemaVersion":1,"kind":"team_put","record":BROKEN}\n';
    const final = `${JSON.stringify({
      schemaVersion: 1,
      kind: "team_put",
      record: team(),
    })}\n`;
    const original = `${valid}${corrupted}${final}`;
    await writeFile(path, original, "utf8");

    await expect(new JsonlSessionControlStore(path).listClassrooms())
      .rejects.toThrow("会话控制日志第 2 行损坏");
    expect(await readFile(path, "utf8")).toBe(original);
  });

  it("replays an existing log once and reuses the materialized state for bounded work", async () => {
    const path = await makePath();
    const writer = new JsonlSessionControlStore(path);
    await seed(writer);
    for (let index = 0; index < 40; index += 1) {
      await writer.createSession(
        session(`legacy-session-${String(index).padStart(2, "0")}`),
        `legacy-request-${index}`,
      );
    }

    const reopened = new JsonlSessionControlStore(path);
    expect(await reopened.listSessions()).toHaveLength(40);
    expect(reopened.getDiagnostics()).toEqual({
      fullReplayCount: 1,
      replayedFrameCount: 42,
      cacheHitCount: 0,
    });

    for (let index = 0; index < 30; index += 1) {
      expect(await reopened.getSession(
        `legacy-session-${String(index).padStart(2, "0")}`,
      )).not.toBeNull();
    }
    for (let index = 40; index < 50; index += 1) {
      await reopened.createSession(
        session(`new-session-${index}`),
        `new-request-${index}`,
      );
    }

    const diagnostics = reopened.getDiagnostics();
    expect(diagnostics.fullReplayCount).toBe(1);
    expect(diagnostics.replayedFrameCount).toBe(42);
    expect(diagnostics.cacheHitCount).toBeGreaterThanOrEqual(40);
    expect(await reopened.listSessions()).toHaveLength(50);
  });
});
