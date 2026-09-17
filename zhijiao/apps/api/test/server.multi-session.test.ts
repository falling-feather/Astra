import type { FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";
import type { RoleBinding } from "@ronggang/contracts";
import {
  InMemorySessionControlStore,
  type TrainingSessionRecord,
} from "@ronggang/session-control";
import { UnifiedIflytekAdapter } from "@ronggang/iflytek-adapter";
import {
  InMemoryEventStore,
  InProcessMessageBus,
  WorldEngine,
  demoScenario,
} from "@ronggang/world-core";
import { createMemoryTestApp, DEMO_SESSION_ID } from "../src/server.js";
import {
  DEMO_CLASSROOM_A_ID,
  DEMO_CLASSROOM_B_ID,
  DEMO_SECONDARY_SESSION_ID,
  DEMO_TEAM_A_ID,
} from "../src/session-control-bootstrap.js";
import type { DemoAuthContext } from "../src/identity.js";

const localOrigin = "http://localhost:5173";

interface Login {
  cookie: string;
  csrfToken: string;
  context: DemoAuthContext;
}

async function createMultiClassApp(
  beforeTrainingSessionActivation?: (sessionId: string) => void | Promise<void>,
): Promise<{
  app: FastifyInstance;
  store: InMemorySessionControlStore;
}> {
  const store = new InMemorySessionControlStore();
  const engine = new WorldEngine({
    store: new InMemoryEventStore(),
    bus: new InProcessMessageBus(),
    scenario: structuredClone(demoScenario),
  });
  const app = await createMemoryTestApp({
    engine,
    sessionControlStore: store,
    initializeSecondaryDemo: true,
    adapter: new UnifiedIflytekAdapter({ mode: "mock", environment: {} }),
    ...(beforeTrainingSessionActivation ? { beforeTrainingSessionActivation } : {}),
  });
  return { app, store };
}

async function login(
  app: FastifyInstance,
  profileId: string,
  sessionId: string,
): Promise<Login> {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/demo-session",
    headers: { origin: localOrigin },
    payload: { profileId, sessionId },
  });
  expect(response.statusCode).toBe(200);
  const context = response.json() as DemoAuthContext;
  const setCookie = Array.isArray(response.headers["set-cookie"])
    ? response.headers["set-cookie"][0]
    : response.headers["set-cookie"];
  if (!setCookie) throw new Error("登录响应缺少 Cookie");
  return {
    cookie: setCookie.split(";")[0]!,
    csrfToken: context.csrfToken,
    context,
  };
}

function binding(loginContext: Login, actorKind: "teacher" | "student"): RoleBinding {
  const found = loginContext.context.bindings.find((item) => (
    item.actorKind === actorKind
  ));
  if (!found) throw new Error(`登录缺少 ${actorKind} 岗位`);
  return found;
}

function headers(loginContext: Login, write = false): Record<string, string> {
  return {
    cookie: loginContext.cookie,
    ...(write
      ? {
          origin: localOrigin,
          "x-csrf-token": loginContext.csrfToken,
        }
      : {}),
  };
}

async function seedReleaseId(app: FastifyInstance): Promise<string> {
  const response = await app.inject({ method: "GET", url: "/api/scenario/demo" });
  expect(response.statusCode).toBe(200);
  return response.json().release.releaseId as string;
}

describe("multi-class session control API", { timeout: 15_000 }, () => {
  it("issues bindings from membership and rejects both directions of cross-class access", async () => {
    const { app } = await createMultiClassApp();
    try {
      const teacherA = await login(app, "teacher-class-a", DEMO_SESSION_ID);
      const teacherB = await login(app, "teacher-class-b", DEMO_SECONDARY_SESSION_ID);
      const studentA = await login(app, "student-team-a", DEMO_SESSION_ID);
      const teacherABinding = binding(teacherA, "teacher");
      const teacherBBinding = binding(teacherB, "teacher");
      const studentABinding = binding(studentA, "student");

      const teacherBIntoA = await app.inject({
        method: "POST",
        url: "/api/auth/demo-session",
        headers: { origin: localOrigin },
        payload: {
          profileId: "teacher-class-b",
          sessionId: DEMO_SESSION_ID,
        },
      });
      const studentAIntoB = await app.inject({
        method: "POST",
        url: "/api/auth/demo-session",
        headers: { origin: localOrigin },
        payload: {
          profileId: "student-team-a",
          sessionId: DEMO_SECONDARY_SESSION_ID,
        },
      });
      expect(teacherBIntoA.statusCode).toBe(403);
      expect(studentAIntoB.statusCode).toBe(403);

      for (const path of ["projection", "timeline", "trace"]) {
        const crossRead = await app.inject({
          method: "GET",
          url: `/api/sessions/${DEMO_SECONDARY_SESSION_ID}/${path}?bindingId=${teacherABinding.bindingId}`,
          headers: headers(teacherA),
        });
        expect(crossRead.statusCode).toBe(403);
      }
      const studentCrossRead = await app.inject({
        method: "GET",
        url: `/api/sessions/${DEMO_SECONDARY_SESSION_ID}/projection?bindingId=${studentABinding.bindingId}`,
        headers: headers(studentA),
      });
      expect(studentCrossRead.statusCode).toBe(403);

      const listA = await app.inject({
        method: "GET",
        url: `/api/training-sessions?authorizationSessionId=${DEMO_SESSION_ID}&bindingId=${teacherABinding.bindingId}`,
        headers: headers(teacherA),
      });
      const listB = await app.inject({
        method: "GET",
        url: `/api/training-sessions?authorizationSessionId=${DEMO_SECONDARY_SESSION_ID}&bindingId=${teacherBBinding.bindingId}`,
        headers: headers(teacherB),
      });
      expect(listA.statusCode).toBe(200);
      expect(listB.statusCode).toBe(200);
      expect(listA.json().sessions.map((session: TrainingSessionRecord) => session.sessionId))
        .toEqual([DEMO_SESSION_ID]);
      expect(listB.json().sessions.map((session: TrainingSessionRecord) => session.sessionId))
        .toEqual([DEMO_SECONDARY_SESSION_ID]);
    } finally {
      await app.close();
    }
  });

  it("creates one discoverable session for an idempotent request and blocks another class", async () => {
    const { app } = await createMultiClassApp();
    try {
      const teacherA = await login(app, "teacher-class-a", DEMO_SESSION_ID);
      const teacherBinding = binding(teacherA, "teacher");
      const releaseId = await seedReleaseId(app);
      const payload = {
        authorizationSessionId: DEMO_SESSION_ID,
        bindingId: teacherBinding.bindingId,
        requestId: "request-class-a-session-001",
        classroomId: DEMO_CLASSROOM_A_ID,
        teamId: DEMO_TEAM_A_ID,
        releaseId,
      };
      const first = await app.inject({
        method: "POST",
        url: "/api/training-sessions",
        headers: headers(teacherA, true),
        payload,
      });
      const replay = await app.inject({
        method: "POST",
        url: "/api/training-sessions",
        headers: headers(teacherA, true),
        payload,
      });
      expect(first.statusCode).toBe(200);
      expect(replay.statusCode).toBe(200);
      expect(replay.json().sessionId).toBe(first.json().sessionId);

      const forbidden = await app.inject({
        method: "POST",
        url: "/api/training-sessions",
        headers: headers(teacherA, true),
        payload: {
          ...payload,
          requestId: "request-cross-class",
          classroomId: DEMO_CLASSROOM_B_ID,
          teamId: "team-local-tourism-b",
        },
      });
      expect(forbidden.statusCode).toBe(403);

      const listed = await app.inject({
        method: "GET",
        url: `/api/training-sessions?authorizationSessionId=${DEMO_SESSION_ID}&bindingId=${teacherBinding.bindingId}`,
        headers: headers(teacherA),
      });
      expect(listed.statusCode).toBe(200);
      expect(listed.json().sessions.map((session: TrainingSessionRecord) => session.sessionId))
        .toEqual([DEMO_SESSION_ID, first.json().sessionId]);
    } finally {
      await app.close();
    }
  });

  it("returns the failed session id and recovers the same world without creating another record", async () => {
    let failOnce = true;
    const { app, store } = await createMultiClassApp(() => {
      if (failOnce) {
        failOnce = false;
        throw new Error("InjectedProvisioningFailure");
      }
    });
    try {
      const teacherA = await login(app, "teacher-class-a", DEMO_SESSION_ID);
      const teacherBinding = binding(teacherA, "teacher");
      const releaseId = await seedReleaseId(app);
      const created = await app.inject({
        method: "POST",
        url: "/api/training-sessions",
        headers: headers(teacherA, true),
        payload: {
          authorizationSessionId: DEMO_SESSION_ID,
          bindingId: teacherBinding.bindingId,
          requestId: "request-recovery-001",
          classroomId: DEMO_CLASSROOM_A_ID,
          teamId: DEMO_TEAM_A_ID,
          releaseId,
        },
      });
      expect(created.statusCode).toBe(503);
      expect(created.json()).toMatchObject({
        status: "recovery_failed",
        recoveryErrorCode: "session_provision_failed",
      });
      const failedSessionId = created.json().sessionId as string;
      expect((await store.getSession(failedSessionId))?.status).toBe("recovery_failed");

      const recovered = await app.inject({
        method: "POST",
        url: `/api/training-sessions/${failedSessionId}/recover`,
        headers: headers(teacherA, true),
        payload: {
          authorizationSessionId: DEMO_SESSION_ID,
          bindingId: teacherBinding.bindingId,
        },
      });
      expect(recovered.statusCode).toBe(200);
      expect(recovered.json()).toMatchObject({
        sessionId: failedSessionId,
        status: "active",
      });
      expect((await store.listSessions({
        principalId: teacherA.context.principal.principalId,
      })).filter((session) => session.sessionId === failedSessionId)).toHaveLength(1);
    } finally {
      await app.close();
    }
  });
});
