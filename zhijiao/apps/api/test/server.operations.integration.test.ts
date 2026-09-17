import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";
import type { RoleBinding } from "@ronggang/contracts";
import {
  InMemorySessionControlStore,
  type RecoveryCheckpoint,
  type RecoveryCheckpointCatalog,
} from "@ronggang/session-control";
import { UnifiedIflytekAdapter } from "@ronggang/iflytek-adapter";
import {
  InMemoryEventStore,
  InProcessMessageBus,
  WorldEngine,
  demoScenario,
} from "@ronggang/world-core";
import type { DemoAuthContext } from "../src/identity.js";
import {
  DEMO_SECONDARY_SESSION_ID,
} from "../src/session-control-bootstrap.js";
import {
  createApp,
  createMemoryTestApp,
  DEMO_SESSION_ID,
} from "../src/server.js";
import { LOCAL_DATA_RESTORE_OWNER_FILE } from "../src/local-data-directory-lease.js";

const localOrigin = "http://localhost:5173";

interface Login {
  cookie: string;
  context: DemoAuthContext;
}

interface TracePageResponse {
  schemaVersion: "session-trace-page.v1";
  sessionId: string;
  records: Array<{ traceId: string }>;
  links: Array<{
    fromTraceId: string;
    toTraceId: string;
  }>;
  nextCursor: string | null;
  hasMore: boolean;
  watermark: string;
}

class MemoryRecoveryCheckpointCatalog implements RecoveryCheckpointCatalog {
  readonly values = new Map<string, RecoveryCheckpoint>();

  async save(value: unknown): Promise<RecoveryCheckpoint> {
    const checkpoint = structuredClone(value as RecoveryCheckpoint);
    this.values.set(checkpoint.sessionId, checkpoint);
    return structuredClone(checkpoint);
  }

  async loadLatest(sessionId: string): Promise<RecoveryCheckpoint | null> {
    const checkpoint = this.values.get(sessionId);
    return checkpoint ? structuredClone(checkpoint) : null;
  }
}

async function createOperationsApp(
  recoveryCheckpointCatalog?: RecoveryCheckpointCatalog,
): Promise<FastifyInstance> {
  const engine = new WorldEngine({
    store: new InMemoryEventStore(),
    bus: new InProcessMessageBus(),
    scenario: structuredClone(demoScenario),
  });
  return createMemoryTestApp({
    engine,
    sessionControlStore: new InMemorySessionControlStore(),
    ...(recoveryCheckpointCatalog ? { recoveryCheckpointCatalog } : {}),
    initializeSecondaryDemo: true,
    adapter: new UnifiedIflytekAdapter({ mode: "mock", environment: {} }),
  });
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
    context,
  };
}

function binding(
  loginContext: Login,
  actorKind: "teacher" | "student",
): RoleBinding {
  const found = loginContext.context.bindings.find((item) => (
    item.actorKind === actorKind
  ));
  if (!found) throw new Error(`登录缺少 ${actorKind} 岗位绑定`);
  return found;
}

function headers(loginContext: Login): Record<string, string> {
  return { cookie: loginContext.cookie };
}

function healthUrl(
  sessionId: string,
  roleBinding: RoleBinding,
): string {
  return "/api/operations/health"
    + `?authorizationSessionId=${encodeURIComponent(sessionId)}`
    + `&bindingId=${encodeURIComponent(roleBinding.bindingId)}`;
}

function tracePageUrl(
  sessionId: string,
  roleBinding: RoleBinding,
  options: { limit?: number; cursor?: string } = {},
): string {
  const query = new URLSearchParams({
    bindingId: roleBinding.bindingId,
  });
  if (options.limit !== undefined) {
    query.set("limit", String(options.limit));
  }
  if (options.cursor !== undefined) {
    query.set("cursor", options.cursor);
  }
  return `/api/sessions/${encodeURIComponent(sessionId)}/trace-page?${query}`;
}

describe("operations and paged trace API integration", { timeout: 15_000 }, () => {
  it("exposes class-scoped health only to administrators", async () => {
    const app = await createOperationsApp();
    try {
      const administrator = await login(
        app,
        "operator-demo",
        DEMO_SESSION_ID,
      );
      const teacherA = await login(app, "teacher-class-a", DEMO_SESSION_ID);
      const studentA = await login(app, "student-team-a", DEMO_SESSION_ID);
      const administratorBinding = binding(administrator, "teacher");
      const teacherABinding = binding(teacherA, "teacher");
      const studentABinding = binding(studentA, "student");

      const healthA = await app.inject({
        method: "GET",
        url: healthUrl(DEMO_SESSION_ID, administratorBinding),
        headers: headers(administrator),
      });
      expect(healthA.statusCode).toBe(200);
      expect(healthA.json()).toMatchObject({
        schemaVersion: "operations-health.v1",
        scope: { visibleSessionCount: 1 },
        sessions: { total: 1 },
        ...(healthA.json().recoveryCheckpoints
          ? {
              recoveryCheckpoints: {
                total: 1,
              },
            }
          : {}),
      });

      // The administrator profile belongs to class A. Its health snapshot must
      // never aggregate the second demo class.
      expect(healthA.json().scope.visibleSessionCount).not.toBe(2);
      expect(healthA.body).not.toContain(DEMO_SECONDARY_SESSION_ID);

      const teacherDenied = await app.inject({
        method: "GET",
        url: healthUrl(DEMO_SESSION_ID, teacherABinding),
        headers: headers(teacherA),
      });
      expect(teacherDenied.statusCode).toBe(403);

      const studentDenied = await app.inject({
        method: "GET",
        url: healthUrl(DEMO_SESSION_ID, studentABinding),
        headers: headers(studentA),
      });
      expect(studentDenied.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it("creates and verifies teacher-only recovery checkpoints without crossing classes", async () => {
    const catalog = new MemoryRecoveryCheckpointCatalog();
    const app = await createOperationsApp(catalog);
    try {
      const teacherA = await login(app, "teacher-class-a", DEMO_SESSION_ID);
      const teacherB = await login(
        app,
        "teacher-class-b",
        DEMO_SECONDARY_SESSION_ID,
      );
      const administrator = await login(
        app,
        "operator-demo",
        DEMO_SESSION_ID,
      );
      const studentA = await login(app, "student-team-a", DEMO_SESSION_ID);
      const teacherABinding = binding(teacherA, "teacher");
      const teacherBBinding = binding(teacherB, "teacher");
      const administratorBinding = binding(administrator, "teacher");
      const studentABinding = binding(studentA, "student");
      const checkpointUrl = (
        targetSessionId: string,
        authorizationSessionId: string,
        roleBinding: RoleBinding,
      ) => (
        `/api/training-sessions/${targetSessionId}/recovery-checkpoint`
        + `?authorizationSessionId=${authorizationSessionId}`
        + `&bindingId=${roleBinding.bindingId}`
      );

      const verified = await app.inject({
        method: "GET",
        url: checkpointUrl(
          DEMO_SESSION_ID,
          DEMO_SESSION_ID,
          teacherABinding,
        ),
        headers: headers(teacherA),
      });
      expect(verified.statusCode).toBe(200);
      expect(verified.json()).toMatchObject({
        schemaVersion: "recovery-checkpoint.v1",
        status: "verified",
        sessionId: DEMO_SESSION_ID,
        sourceSequence: 0,
      });
      expect(verified.json().payloadHash).toMatch(/^[a-f0-9]{64}$/u);
      expect(verified.body).not.toContain("privateMemory");

      const onlineCheckpoint = await app.inject({
        method: "POST",
        url: `/api/training-sessions/${DEMO_SESSION_ID}/recovery-checkpoint`,
        headers: {
          ...headers(teacherA),
          origin: localOrigin,
          "x-csrf-token": teacherA.context.csrfToken,
        },
        payload: {
          authorizationSessionId: DEMO_SESSION_ID,
          bindingId: teacherABinding.bindingId,
        },
      });
      expect(onlineCheckpoint.statusCode).toBe(200);
      expect(onlineCheckpoint.json()).toMatchObject({
        status: "verified",
        sourceSequence: 0,
      });

      const crossClass = await app.inject({
        method: "GET",
        url: checkpointUrl(
          DEMO_SECONDARY_SESSION_ID,
          DEMO_SESSION_ID,
          teacherABinding,
        ),
        headers: headers(teacherA),
      });
      expect(crossClass.statusCode).toBe(403);

      const studentDenied = await app.inject({
        method: "GET",
        url: checkpointUrl(
          DEMO_SESSION_ID,
          DEMO_SESSION_ID,
          studentABinding,
        ),
        headers: headers(studentA),
      });
      expect(studentDenied.statusCode).toBe(403);

      const teacherBVerified = await app.inject({
        method: "GET",
        url: checkpointUrl(
          DEMO_SECONDARY_SESSION_ID,
          DEMO_SECONDARY_SESSION_ID,
          teacherBBinding,
        ),
        headers: headers(teacherB),
      });
      expect(teacherBVerified.statusCode).toBe(200);
      expect(teacherBVerified.json()).toMatchObject({
        status: "verified",
        sessionId: DEMO_SECONDARY_SESSION_ID,
      });

      const health = await app.inject({
        method: "GET",
        url: healthUrl(DEMO_SESSION_ID, administratorBinding),
        headers: headers(administrator),
      });
      expect(health.statusCode).toBe(200);
      expect(health.json().recoveryCheckpoints).toMatchObject({
        total: 1,
        verified: 1,
        mismatch: 0,
      });
    } finally {
      await app.close();
    }
  });

  it("replays local world, task and trace state to the same checkpoint hash after restart", async () => {
    const dataDir = await mkdtemp(resolve(tmpdir(), "ronggang-v091-restart-"));
    const environment = {
      MODEL_PROVIDER: "deterministic",
      IFLYTEK_MODE: "mock",
      NODE_ENV: "test",
    };
    let first: FastifyInstance | null = null;
    let second: FastifyInstance | null = null;
    try {
      first = await createApp({
        dataDir,
        environment,
        awaitStartupRecovery: true,
      });
      const firstLogin = await login(
        first,
        "teacher-class-a",
        DEMO_SESSION_ID,
      );
      const firstBinding = binding(firstLogin, "teacher");
      const firstCheckpoint = await first.inject({
        method: "GET",
        url: `/api/training-sessions/${DEMO_SESSION_ID}/recovery-checkpoint`
          + `?authorizationSessionId=${DEMO_SESSION_ID}`
          + `&bindingId=${firstBinding.bindingId}`,
        headers: headers(firstLogin),
      });
      expect(firstCheckpoint.statusCode).toBe(200);
      expect(firstCheckpoint.json().status).toBe("verified");
      const firstHash = firstCheckpoint.json().payloadHash as string;
      const firstSequence = firstCheckpoint.json().sourceSequence as number;
      await first.close();
      first = null;

      second = await createApp({
        dataDir,
        environment,
        awaitStartupRecovery: true,
      });
      const secondLogin = await login(
        second,
        "teacher-class-a",
        DEMO_SESSION_ID,
      );
      const secondBinding = binding(secondLogin, "teacher");
      const secondCheckpoint = await second.inject({
        method: "GET",
        url: `/api/training-sessions/${DEMO_SESSION_ID}/recovery-checkpoint`
          + `?authorizationSessionId=${DEMO_SESSION_ID}`
          + `&bindingId=${secondBinding.bindingId}`,
        headers: headers(secondLogin),
      });
      expect(secondCheckpoint.statusCode).toBe(200);
      expect(secondCheckpoint.json()).toMatchObject({
        status: "verified",
        payloadHash: firstHash,
        checkpointPayloadHash: firstHash,
        sourceSequence: firstSequence,
      });
    } finally {
      await first?.close();
      await second?.close();
      await rm(dataDir, { recursive: true, force: true });
    }
  }, 120_000);

  it("keeps the persistent DATA_DIR lease even when a WorldEngine is injected", async () => {
    const dataDir = await mkdtemp(resolve(tmpdir(), "ronggang-engine-lease-"));
    const environment = {
      MODEL_PROVIDER: "deterministic",
      IFLYTEK_MODE: "mock",
      NODE_ENV: "test",
    };
    const makeEngine = () => new WorldEngine({
      store: new InMemoryEventStore(),
      bus: new InProcessMessageBus(),
      scenario: structuredClone(demoScenario),
    });
    let first: FastifyInstance | null = null;
    let restarted: FastifyInstance | null = null;
    try {
      first = await createApp({
        engine: makeEngine(),
        dataDir,
        environment,
        recoveryCheckpointCatalog: null,
      });
      await expect(createApp({
        engine: makeEngine(),
        dataDir,
        environment,
        recoveryCheckpointCatalog: null,
      })).rejects.toMatchObject({ code: "lease_active" });

      await first.close();
      first = null;
      restarted = await createApp({
        engine: makeEngine(),
        dataDir,
        environment,
        recoveryCheckpointCatalog: null,
      });
      await expect(restarted.inject({
        method: "GET",
        url: "/health",
      })).resolves.toMatchObject({ statusCode: 200 });
    } finally {
      await first?.close();
      await restarted?.close();
      await rm(dataDir, { recursive: true, force: true });
    }
  }, 30_000);

  it("refuses a DATA_DIR with an incomplete-restore marker and releases its lease", async () => {
    const dataDir = await mkdtemp(resolve(tmpdir(), "ronggang-restore-marker-"));
    const environment = {
      MODEL_PROVIDER: "deterministic",
      IFLYTEK_MODE: "mock",
      NODE_ENV: "test",
    };
    const markerPath = resolve(dataDir, LOCAL_DATA_RESTORE_OWNER_FILE);
    let app: FastifyInstance | null = null;
    try {
      await writeFile(markerPath, "{\"schema\":\"incomplete\"}\n", "utf8");
      await expect(createApp({
        dataDir,
        environment,
        recoveryCheckpointCatalog: null,
      })).rejects.toThrow(/未完成恢复标记/u);

      await rm(markerPath, { force: true });
      app = await createApp({
        dataDir,
        environment,
        recoveryCheckpointCatalog: null,
      });
      await expect(app.inject({
        method: "GET",
        url: "/health",
      })).resolves.toMatchObject({ statusCode: 200 });
    } finally {
      await app?.close();
      await rm(dataDir, { recursive: true, force: true });
    }
  }, 30_000);

  it("pages an administrator trace and denies teacher and student access", async () => {
    const app = await createOperationsApp();
    try {
      const administrator = await login(
        app,
        "operator-demo",
        DEMO_SESSION_ID,
      );
      const teacherA = await login(app, "teacher-class-a", DEMO_SESSION_ID);
      const studentA = await login(app, "student-team-a", DEMO_SESSION_ID);
      const administratorBinding = binding(administrator, "teacher");
      const teacherABinding = binding(teacherA, "teacher");
      const studentABinding = binding(studentA, "student");

      const firstResponse = await app.inject({
        method: "GET",
        url: tracePageUrl(DEMO_SESSION_ID, administratorBinding, { limit: 1 }),
        headers: headers(administrator),
      });
      expect(firstResponse.statusCode).toBe(200);
      const first = firstResponse.json() as TracePageResponse;
      expect(first).toMatchObject({
        schemaVersion: "session-trace-page.v1",
        sessionId: DEMO_SESSION_ID,
        hasMore: true,
      });
      expect(first.records).toHaveLength(1);
      expect(first.nextCursor).toEqual(expect.any(String));
      expect(first.watermark).toMatch(/^trace-watermark\.v1\.[A-Za-z0-9_-]+$/u);

      const secondResponse = await app.inject({
        method: "GET",
        url: tracePageUrl(DEMO_SESSION_ID, administratorBinding, {
          limit: 1,
          cursor: first.nextCursor!,
        }),
        headers: headers(administrator),
      });
      expect(secondResponse.statusCode).toBe(200);
      const second = secondResponse.json() as TracePageResponse;
      expect(second.records).toHaveLength(1);
      expect(second.records[0]?.traceId).not.toBe(first.records[0]?.traceId);
      expect(second.watermark).toBe(first.watermark);

      const teacherDenied = await app.inject({
        method: "GET",
        url: tracePageUrl(DEMO_SESSION_ID, teacherABinding, { limit: 1 }),
        headers: headers(teacherA),
      });
      expect(teacherDenied.statusCode).toBe(403);

      const studentDenied = await app.inject({
        method: "GET",
        url: tracePageUrl(DEMO_SESSION_ID, studentABinding, { limit: 1 }),
        headers: headers(studentA),
      });
      expect(studentDenied.statusCode).toBe(403);

      const crossMembershipDenied = await app.inject({
        method: "GET",
        url: tracePageUrl(
          DEMO_SECONDARY_SESSION_ID,
          administratorBinding,
          { limit: 1 },
        ),
        headers: headers(administrator),
      });
      expect(crossMembershipDenied.statusCode).toBe(403);

      const crossSessionCursorPayload = JSON.parse(
        Buffer.from(first.nextCursor!, "base64url").toString("utf8"),
      ) as Record<string, unknown>;
      crossSessionCursorPayload.s = createHash("sha256")
        .update(`trace-session.v1:${DEMO_SECONDARY_SESSION_ID}`)
        .digest("base64url");
      const crossSessionCursorValue = Buffer.from(
        JSON.stringify(crossSessionCursorPayload),
        "utf8",
      ).toString("base64url");
      const crossSessionCursor = await app.inject({
        method: "GET",
        url: tracePageUrl(
          DEMO_SESSION_ID,
          administratorBinding,
          { limit: 1, cursor: crossSessionCursorValue },
        ),
        headers: headers(administrator),
      });
      expect(crossSessionCursor.statusCode).toBe(400);
      expect(crossSessionCursor.json()).toMatchObject({
        error: "TracePaginationCursorError",
        code: "TRACE_CURSOR_SESSION_MISMATCH",
      });
    } finally {
      await app.close();
    }
  });
});
