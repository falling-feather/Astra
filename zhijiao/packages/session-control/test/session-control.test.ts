import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  InMemorySessionControlStore,
  SessionControlError,
  SessionControlService,
  type Classroom,
  type SessionMembership,
  type TeamInstance,
  type TrainingSessionRecord,
} from "../src/index.js";

const t0 = "2026-07-26T00:00:00.000Z";
const t1 = "2026-07-26T00:01:00.000Z";
const t2 = "2026-07-26T00:02:00.000Z";

function classroom(
  classroomId: string,
  overrides: Partial<Classroom> = {},
): Classroom {
  return {
    classroomId,
    courseId: "course-tourism-media",
    name: classroomId,
    status: "active",
    createdAt: t0,
    updatedAt: t0,
    ...overrides,
  };
}

function team(
  teamId: string,
  classroomId: string,
  overrides: Partial<TeamInstance> = {},
): TeamInstance {
  return {
    teamId,
    classroomId,
    name: teamId,
    status: "active",
    createdAt: t0,
    updatedAt: t0,
    ...overrides,
  };
}

function session(
  sessionId: string,
  classroomId: string,
  teamId: string,
  overrides: Partial<TrainingSessionRecord> = {},
): TrainingSessionRecord {
  return {
    sessionId,
    classroomId,
    teamId,
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

function membership(
  membershipId: string,
  principalId: string,
  classroomId: string,
  teamId: string | null,
  overrides: Partial<SessionMembership> = {},
): SessionMembership {
  return {
    membershipId,
    principalId,
    classroomId,
    teamId,
    sessionId: null,
    role: teamId === null ? "teacher" : "student",
    actorId: `actor-${principalId}`,
    status: "active",
    createdAt: t0,
    updatedAt: t0,
    revokedAt: null,
    ...overrides,
  };
}

async function seededService(): Promise<SessionControlService> {
  const service = new SessionControlService(new InMemorySessionControlStore());
  await service.putClassroom(classroom("class-a"));
  await service.putClassroom(classroom("class-b"));
  await service.putTeam(team("team-a1", "class-a"));
  await service.putTeam(team("team-a2", "class-a"));
  await service.putTeam(team("team-b1", "class-b"));
  return service;
}

describe("session creation idempotency", () => {
  it("keeps an individually assigned session out of another student's class-wide visibility", async () => {
    const service = await seededService();
    await service.putMembership(membership("class-student-a", "student-a", "class-a", "team-a1"));
    await service.putMembership(membership("class-student-b", "student-b", "class-a", "team-a1"));
    await service.putMembership(membership("class-teacher", "teacher-a", "class-a", null));
    const task = { ...session("individual-task", "class-a", "team-a1"), requiresExplicitStudentMembership: true };
    await service.createSession(task, "individual-task-request");
    await service.putMembership(membership("individual-owner", "student-a", "class-a", "team-a1", { sessionId: task.sessionId }));
    assert.equal((await service.listSessions({ principalId: "student-a" })).length, 1);
    assert.equal((await service.listSessions({ principalId: "student-b" })).length, 0);
    assert.equal((await service.listSessions({ principalId: "teacher-a" })).length, 1);
  });
  it("returns the same immutable record for an identical requestId and payload", async () => {
    const service = await seededService();
    const record = session("session-a1", "class-a", "team-a1");

    const first = await service.createSession(record, "request-a1");
    first.releaseId = "mutated-by-caller";
    const replay = await service.createSession(record, "request-a1");

    assert.equal(replay.releaseId, record.releaseId);
    assert.deepEqual(replay, record);
    const fetched = await service.getSession(record.sessionId);
    assert.deepEqual(fetched, record);
    if (fetched) fetched.status = "completed";
    assert.equal((await service.getSession(record.sessionId))?.status, "provisioning");
  });

  it("rejects a different payload reused with the same requestId", async () => {
    const service = await seededService();
    await service.createSession(
      session("session-a1", "class-a", "team-a1"),
      "request-shared",
    );

    await assert.rejects(
      service.createSession(
        session("session-a2", "class-a", "team-a2"),
        "request-shared",
      ),
      (error: unknown) => (
        error instanceof SessionControlError
        && error.code === "idempotency_conflict"
        && error.details.existingSessionId === "session-a1"
      ),
    );
  });
});

describe("scoped listing and membership isolation", () => {
  it("separates classrooms, teams, and active membership visibility", async () => {
    const service = await seededService();
    await service.createSession(session("session-a1", "class-a", "team-a1"), "request-a1");
    await service.createSession(session("session-a2", "class-a", "team-a2"), "request-a2");
    await service.createSession(session("session-b1", "class-b", "team-b1"), "request-b1");
    await service.putMembership(membership(
      "membership-student-a1",
      "student-a1",
      "class-a",
      "team-a1",
    ));
    await service.putMembership(membership(
      "membership-teacher-a",
      "teacher-a",
      "class-a",
      null,
    ));

    assert.deepEqual(
      (await service.listSessions({ classroomId: "class-a" })).map((item) => item.sessionId),
      ["session-a1", "session-a2"],
    );
    assert.deepEqual(
      (await service.listSessions({ classroomId: "class-a", teamId: "team-a2" }))
        .map((item) => item.sessionId),
      ["session-a2"],
    );
    assert.deepEqual(
      (await service.listSessions({ principalId: "student-a1" }))
        .map((item) => item.sessionId),
      ["session-a1"],
    );
    assert.deepEqual(
      (await service.listSessions({ principalId: "teacher-a" }))
        .map((item) => item.sessionId),
      ["session-a1", "session-a2"],
    );
    assert.deepEqual(await service.listSessions({ principalId: "unknown" }), []);
  });

  it("rejects a team attached to another classroom", async () => {
    const service = await seededService();
    await assert.rejects(
      service.createSession(
        session("session-invalid", "class-a", "team-b1"),
        "request-invalid",
      ),
      (error: unknown) => (
        error instanceof SessionControlError && error.code === "scope_mismatch"
      ),
    );
  });
});

describe("session status compare-and-set", () => {
  it("allows one competing transition and reports structured status conflict", async () => {
    const service = await seededService();
    await service.createSession(session("session-race", "class-a", "team-a1"), "request-race");

    const [left, right] = await Promise.allSettled([
      service.transitionSessionStatus({
        sessionId: "session-race",
        expectedStatus: "provisioning",
        expectedStatusVersion: 0,
        nextStatus: "active",
        updatedAt: t1,
      }),
      service.transitionSessionStatus({
        sessionId: "session-race",
        expectedStatus: "provisioning",
        expectedStatusVersion: 0,
        nextStatus: "recovery_failed",
        recoveryErrorCode: "world_init_failed",
        updatedAt: t1,
      }),
    ]);

    const fulfilled = [left, right].filter((item) => item.status === "fulfilled");
    const rejected = [left, right].filter((item) => item.status === "rejected");
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    const reason = rejected[0]?.reason as unknown;
    assert.ok(reason instanceof SessionControlError);
    assert.equal(reason.code, "status_conflict");
    assert.equal(reason.details.actualStatusVersion, 1);
  });

  it("rejects transitions from a terminal session", async () => {
    const service = await seededService();
    await service.createSession(session("session-terminal", "class-a", "team-a1"), "request-terminal");
    await service.transitionSessionStatus({
      sessionId: "session-terminal",
      expectedStatus: "provisioning",
      expectedStatusVersion: 0,
      nextStatus: "active",
      updatedAt: t1,
    });
    await service.transitionSessionStatus({
      sessionId: "session-terminal",
      expectedStatus: "active",
      expectedStatusVersion: 1,
      nextStatus: "completed",
      updatedAt: t2,
    });
    await assert.rejects(
      service.transitionSessionStatus({
        sessionId: "session-terminal",
        expectedStatus: "completed",
        expectedStatusVersion: 2,
        nextStatus: "active",
        updatedAt: "2026-07-26T00:03:00.000Z",
      }),
      (error: unknown) => (
        error instanceof SessionControlError && error.code === "invalid_status_transition"
      ),
    );
  });
});

describe("memberships and recovery", () => {
  it("revokes memberships idempotently and removes their session visibility", async () => {
    const service = await seededService();
    await service.createSession(session("session-a1", "class-a", "team-a1"), "request-a1");
    await service.putMembership(membership(
      "membership-a1",
      "student-a1",
      "class-a",
      "team-a1",
    ));
    assert.equal((await service.listSessions({ principalId: "student-a1" })).length, 1);

    const revoked = await service.revokeMembership("membership-a1", t1);
    const replay = await service.revokeMembership("membership-a1", t2);
    assert.equal(revoked.status, "revoked");
    assert.equal(replay.revokedAt, t1);
    assert.deepEqual(
      await service.listMemberships({
        principalId: "student-a1",
        statuses: ["active"],
      }),
      [],
    );
    assert.deepEqual(await service.listSessions({ principalId: "student-a1" }), []);
  });

  it("lists only provisioning and recovery_failed sessions as recoverable", async () => {
    const service = await seededService();
    await service.createSession(session("session-provisioning", "class-a", "team-a1"), "request-p");
    await service.createSession(session("session-failed", "class-a", "team-a2"), "request-f");
    await service.createSession(session("session-active", "class-b", "team-b1"), "request-a");
    await service.transitionSessionStatus({
      sessionId: "session-failed",
      expectedStatus: "provisioning",
      expectedStatusVersion: 0,
      nextStatus: "recovery_failed",
      recoveryErrorCode: "event_store_unavailable",
      updatedAt: t1,
    });
    await service.transitionSessionStatus({
      sessionId: "session-active",
      expectedStatus: "provisioning",
      expectedStatusVersion: 0,
      nextStatus: "active",
      updatedAt: t1,
    });

    assert.deepEqual(
      (await service.listRecoverableSessions()).map((item) => item.sessionId),
      ["session-failed", "session-provisioning"].sort(),
    );
    assert.deepEqual(
      (await service.listRecoverableSessions({ classroomId: "class-b" }))
        .map((item) => item.sessionId),
      [],
    );
  });
});
