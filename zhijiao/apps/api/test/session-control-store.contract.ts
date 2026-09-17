import {
  type Classroom,
  type SessionControlStore,
  type SessionMembership,
  type TeamInstance,
  type TrainingSessionRecord,
} from "@ronggang/session-control";
import { describe, expect, it } from "vitest";

const t0 = "2026-07-26T00:00:00.000Z";
const t1 = "2026-07-26T00:01:00.000Z";
const t2 = "2026-07-26T00:02:00.000Z";

type StoreFactory = () => SessionControlStore | Promise<SessionControlStore>;

function classroom(classroomId: string): Classroom {
  return {
    classroomId,
    courseId: "course-tourism-media",
    name: classroomId,
    status: "active",
    createdAt: t0,
    updatedAt: t0,
  };
}

function team(teamId: string, classroomId: string): TeamInstance {
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
  sessionId: string,
  classroomId: string,
  teamId: string,
): TrainingSessionRecord {
  return {
    sessionId,
    classroomId,
    teamId,
    releaseId: "release-tourism-v0.9",
    status: "provisioning",
    statusVersion: 0,
    requestedBy: "principal-teacher-a",
    createdAt: t0,
    updatedAt: t0,
    activatedAt: null,
    completedAt: null,
    lastRecoveryErrorCode: null,
  };
}

function membership(input: {
  membershipId: string;
  principalId: string;
  classroomId: string;
  teamId: string | null;
  role: "teacher" | "student";
}): SessionMembership {
  return {
    ...input,
    sessionId: null,
    actorId: input.role === "teacher" ? "teacher-main" : "student-reporter",
    status: "active",
    createdAt: t0,
    updatedAt: t0,
    revokedAt: null,
  };
}

async function seedOrganization(store: SessionControlStore): Promise<void> {
  await store.putClassroom(classroom("class-a"));
  await store.putClassroom(classroom("class-b"));
  await store.putTeam(team("team-a-1", "class-a"));
  await store.putTeam(team("team-a-2", "class-a"));
  await store.putTeam(team("team-b-1", "class-b"));
}

/**
 * Reusable behavioral contract for every SessionControlStore adapter.
 *
 * Adapter-specific durability and corruption behavior belongs in the adapter
 * suite; this contract locks the semantics callers are allowed to depend on.
 */
export function registerSessionControlStoreContract(
  label: string,
  createStore: StoreFactory,
): void {
  describe(`${label} SessionControlStore contract`, () => {
    it("keeps create idempotency stable after status changes", async () => {
      const store = await createStore();
      await seedOrganization(store);
      const record = session("session-a-1", "class-a", "team-a-1");

      expect(await store.createSession(record, "request-shared")).toEqual(record);
      const active = await store.compareAndSetSessionStatus({
        sessionId: record.sessionId,
        expectedStatus: "provisioning",
        expectedStatusVersion: 0,
        nextStatus: "active",
        updatedAt: t1,
      });
      expect(await store.createSession(record, "request-shared")).toEqual(active);
      await expect(store.createSession(
        session("session-a-other", "class-a", "team-a-1"),
        "request-shared",
      )).rejects.toMatchObject({ code: "idempotency_conflict" });
      expect((await store.listSessions()).map((item) => item.sessionId))
        .toEqual(["session-a-1"]);
    });

    it("returns only sessions visible through classroom and team memberships", async () => {
      const store = await createStore();
      await seedOrganization(store);
      const records = [
        session("session-a-1", "class-a", "team-a-1"),
        session("session-a-2", "class-a", "team-a-2"),
        session("session-b-1", "class-b", "team-b-1"),
      ];
      for (const record of records) {
        await store.createSession(record, `request-${record.sessionId}`);
      }
      await store.compareAndSetSessionStatus({
        sessionId: "session-a-1",
        expectedStatus: "provisioning",
        expectedStatusVersion: 0,
        nextStatus: "active",
        updatedAt: t1,
      });
      await store.putMembership(membership({
        membershipId: "membership-teacher-a",
        principalId: "principal-teacher-a",
        classroomId: "class-a",
        teamId: null,
        role: "teacher",
      }));
      await store.putMembership(membership({
        membershipId: "membership-student-a-1",
        principalId: "principal-student-a-1",
        classroomId: "class-a",
        teamId: "team-a-1",
        role: "student",
      }));
      await store.putMembership(membership({
        membershipId: "membership-teacher-b",
        principalId: "principal-teacher-b",
        classroomId: "class-b",
        teamId: null,
        role: "teacher",
      }));

      expect((await store.listSessions({
        principalId: "principal-teacher-a",
      })).map((item) => item.sessionId)).toEqual([
        "session-a-1",
        "session-a-2",
      ]);
      expect((await store.listSessions({
        principalId: "principal-student-a-1",
      })).map((item) => item.sessionId)).toEqual(["session-a-1"]);
      expect((await store.listSessions({
        principalId: "principal-teacher-b",
      })).map((item) => item.sessionId)).toEqual(["session-b-1"]);
      expect((await store.listSessions({
        classroomId: "class-a",
        teamId: "team-a-2",
      })).map((item) => item.sessionId)).toEqual(["session-a-2"]);
      expect((await store.listSessions({
        classroomId: "class-a",
        statuses: ["active"],
      })).map((item) => item.sessionId)).toEqual(["session-a-1"]);
      expect((await store.listTeams({
        classroomId: "class-a",
        statuses: ["active"],
      })).map((item) => item.teamId)).toEqual(["team-a-1", "team-a-2"]);
      expect((await store.listMemberships({
        classroomId: "class-a",
        teamId: "team-a-1",
        roles: ["student"],
        statuses: ["active"],
      })).map((item) => item.membershipId)).toEqual([
        "membership-student-a-1",
      ]);
    });

    it("applies compare-and-set once and rejects a stale writer", async () => {
      const store = await createStore();
      await seedOrganization(store);
      await store.createSession(
        session("session-a-1", "class-a", "team-a-1"),
        "request-a",
      );

      const active = await store.compareAndSetSessionStatus({
        sessionId: "session-a-1",
        expectedStatus: "provisioning",
        expectedStatusVersion: 0,
        nextStatus: "active",
        updatedAt: t1,
      });
      expect(active).toMatchObject({
        status: "active",
        statusVersion: 1,
        activatedAt: t1,
      });
      await expect(store.compareAndSetSessionStatus({
        sessionId: "session-a-1",
        expectedStatus: "provisioning",
        expectedStatusVersion: 0,
        nextStatus: "recovery_failed",
        recoveryErrorCode: "stale_failure",
        updatedAt: t2,
      })).rejects.toMatchObject({ code: "status_conflict" });
      expect(await store.getSession("session-a-1")).toEqual(active);
    });

    it("persists recovery failure state and returns it through recoverable scope", async () => {
      const store = await createStore();
      await seedOrganization(store);
      await store.createSession(
        session("session-a-1", "class-a", "team-a-1"),
        "request-a",
      );

      const failed = await store.compareAndSetSessionStatus({
        sessionId: "session-a-1",
        expectedStatus: "provisioning",
        expectedStatusVersion: 0,
        nextStatus: "recovery_failed",
        recoveryErrorCode: "world_init_failed",
        updatedAt: t1,
      });
      expect(failed).toMatchObject({
        status: "recovery_failed",
        statusVersion: 1,
        lastRecoveryErrorCode: "world_init_failed",
      });
      expect(await store.listRecoverableSessions({ classroomId: "class-a" }))
        .toEqual([failed]);

      const retrying = await store.compareAndSetSessionStatus({
        sessionId: "session-a-1",
        expectedStatus: "recovery_failed",
        expectedStatusVersion: 1,
        nextStatus: "provisioning",
        updatedAt: t2,
      });
      expect(retrying).toMatchObject({
        status: "provisioning",
        statusVersion: 2,
        lastRecoveryErrorCode: null,
      });
    });

    it("makes membership revocation idempotent and removes visibility", async () => {
      const store = await createStore();
      await seedOrganization(store);
      await store.createSession(
        session("session-a-1", "class-a", "team-a-1"),
        "request-a",
      );
      const member = membership({
        membershipId: "membership-student-a-1",
        principalId: "principal-student-a-1",
        classroomId: "class-a",
        teamId: "team-a-1",
        role: "student",
      });
      await store.putMembership(member);
      expect(await store.listSessions({
        principalId: member.principalId,
      })).toHaveLength(1);

      const revoked = await store.revokeMembership(member.membershipId, t1);
      expect(await store.revokeMembership(member.membershipId, t2)).toEqual(revoked);
      expect(revoked).toMatchObject({
        status: "revoked",
        updatedAt: t1,
        revokedAt: t1,
      });
      expect(await store.listSessions({
        principalId: member.principalId,
      })).toEqual([]);
    });
  });
}
