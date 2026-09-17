import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import {
  type RoleBinding,
} from "@ronggang/contracts";
import {
  InMemoryEventStore,
  InProcessMessageBus,
  WorldEngine,
  demoScenario,
} from "@ronggang/world-core";
import { UnifiedIflytekAdapter } from "@ronggang/iflytek-adapter";
import type { DemoAuthContext } from "../src/identity.js";
import {
  createApp,
  createMemoryTestApp,
  DEMO_SESSION_ID,
} from "../src/server.js";
import { collaborationStrategyContent } from "./collaboration-strategy.fixture.js";

const localOrigin = "http://localhost:5173";
const temporaryDirectories: string[] = [];

interface Login {
  cookie: string;
  csrfToken: string;
  bindings: RoleBinding[];
}

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function login(app: FastifyInstance): Promise<Login> {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/demo-session",
    headers: { origin: localOrigin },
    payload: {},
  });
  expect(response.statusCode).toBe(200);
  const context = response.json() as DemoAuthContext;
  const setCookie = Array.isArray(response.headers["set-cookie"])
    ? response.headers["set-cookie"][0]
    : response.headers["set-cookie"];
  if (!setCookie) throw new Error("协作策略集成测试登录没有返回 Cookie");
  return {
    cookie: setCookie.split(";")[0]!,
    csrfToken: context.csrfToken,
    bindings: context.bindings,
  };
}

function actorBinding(input: Login, actorId: string): RoleBinding {
  const binding = input.bindings.find((item) => item.actorId === actorId);
  if (!binding) throw new Error(`协作策略集成测试缺少 ${actorId} 绑定`);
  return binding;
}

function headers(
  input: Login,
  mutation = false,
): Record<string, string> {
  return {
    cookie: input.cookie,
    ...(mutation
      ? {
          origin: localOrigin,
          "x-csrf-token": input.csrfToken,
        }
      : {}),
  };
}

function draftPayload(
  bindingId: string,
  strategyId = "strategy-rain-collaboration",
) {
  return {
    bindingId,
    authorizationSessionId: DEMO_SESSION_ID,
    strategy: {
      strategyId,
      version: 1,
      content: collaborationStrategyContent(),
    },
  };
}

function governancePayload(
  bindingId: string,
  contentHash: string,
  expectedStatus: "draft" | "approved" | "disabled" | "retired",
  expectedGovernanceRevision: number,
  action: "approve" | "disable" | "retire",
) {
  return {
    bindingId,
    authorizationSessionId: DEMO_SESSION_ID,
    transition: {
      expectedStatus,
      expectedGovernanceRevision,
      expectedContentHash: contentHash,
      action,
      reason: `教师执行 ${action} 治理动作。`,
    },
  };
}

async function memoryApp(): Promise<FastifyInstance> {
  const engine = new WorldEngine({
    store: new InMemoryEventStore(),
    bus: new InProcessMessageBus(),
    scenario: structuredClone(demoScenario),
  });
  return createMemoryTestApp({
    engine,
    adapter: new UnifiedIflytekAdapter({ mode: "mock", environment: {} }),
    initializeSecondaryDemo: false,
    initializeGoldScenarioRelease: false,
  });
}

async function persistentApp(dataDir: string): Promise<FastifyInstance> {
  return createApp({
    dataDir,
    logger: false,
    initializeDemo: true,
    initializeSecondaryDemo: false,
    initializeGoldScenarioRelease: false,
    adapter: new UnifiedIflytekAdapter({ mode: "mock", environment: {} }),
    environment: {
      NODE_ENV: "test",
      MODEL_PROVIDER: "deterministic",
      IFLYTEK_MODE: "mock",
    },
  });
}

describe("public collaboration strategy API", { timeout: 30_000 }, () => {
  it("uses the authenticated teacher binding for CRUD and legal governance", async () => {
    const app = await memoryApp();
    try {
      const session = await login(app);
      const teacher = actorBinding(session, "teacher-main");
      const created = await app.inject({
        method: "POST",
        url: "/api/collaboration-strategies",
        headers: headers(session, true),
        payload: draftPayload(teacher.bindingId),
      });
      expect(created.statusCode).toBe(201);
      const draft = created.json().strategy as {
        contentHash: string;
        createdBy: string;
      };
      expect(draft.createdBy).toBe("teacher-main");

      const listed = await app.inject({
        method: "GET",
        url: "/api/collaboration-strategies"
          + `?bindingId=${teacher.bindingId}`
          + `&authorizationSessionId=${DEMO_SESSION_ID}`,
        headers: headers(session),
      });
      expect(listed.statusCode).toBe(200);
      expect(listed.json().strategies).toHaveLength(1);

      const detail = await app.inject({
        method: "GET",
        url: "/api/collaboration-strategies"
          + "/strategy-rain-collaboration/versions/1"
          + `?bindingId=${teacher.bindingId}`
          + `&authorizationSessionId=${DEMO_SESSION_ID}`,
        headers: headers(session),
      });
      expect(detail.statusCode).toBe(200);
      expect(detail.json().strategy.contentHash).toBe(draft.contentHash);

      let status = "draft" as "draft" | "approved" | "disabled";
      let revision = 0;
      for (const action of [
        "approve",
        "disable",
        "approve",
      ] as const) {
        const response = await app.inject({
          method: "POST",
          url: "/api/collaboration-strategies"
            + "/strategy-rain-collaboration/versions/1/governance",
          headers: headers(session, true),
          payload: governancePayload(
            teacher.bindingId,
            draft.contentHash,
            status,
            revision,
            action,
          ),
        });
        expect(response.statusCode).toBe(200);
        status = response.json().strategy.governance.status;
        revision = response.json().strategy.governance.revision;
      }
      const retired = await app.inject({
        method: "POST",
        url: "/api/collaboration-strategies"
          + "/strategy-rain-collaboration/versions/1/governance",
        headers: headers(session, true),
        payload: governancePayload(
          teacher.bindingId,
          draft.contentHash,
          "approved",
          3,
          "retire",
        ),
      });
      expect(retired.statusCode).toBe(200);
      expect(retired.json().strategy.governance).toMatchObject({
        status: "retired",
        revision: 4,
        latestReview: {
          action: "retire",
          teacherActorId: "teacher-main",
        },
      });

      const terminal = await app.inject({
        method: "POST",
        url: "/api/collaboration-strategies"
          + "/strategy-rain-collaboration/versions/1/governance",
        headers: headers(session, true),
        payload: governancePayload(
          teacher.bindingId,
          draft.contentHash,
          "retired",
          4,
          "approve",
        ),
      });
      expect(terminal.statusCode).toBe(409);
      expect(terminal.json().code).toBe("invalid_governance_transition");
    } finally {
      await app.close();
    }
  });

  it("fails closed on missing authority, CSRF, origin, forged actor and stale hash", async () => {
    const app = await memoryApp();
    try {
      const session = await login(app);
      const teacher = actorBinding(session, "teacher-main");
      const student = actorBinding(session, "student-editor");
      const listUrl = "/api/collaboration-strategies"
        + `?bindingId=${teacher.bindingId}`
        + `&authorizationSessionId=${DEMO_SESSION_ID}`;

      const anonymous = await app.inject({ method: "GET", url: listUrl });
      expect(anonymous.statusCode).toBe(401);

      const studentDenied = await app.inject({
        method: "GET",
        url: "/api/collaboration-strategies"
          + `?bindingId=${student.bindingId}`
          + `&authorizationSessionId=${DEMO_SESSION_ID}`,
        headers: headers(session),
      });
      expect(studentDenied.statusCode).toBe(403);

      const sessionMismatch = await app.inject({
        method: "GET",
        url: "/api/collaboration-strategies"
          + `?bindingId=${teacher.bindingId}`
          + "&authorizationSessionId=unauthorized-session",
        headers: headers(session),
      });
      expect(sessionMismatch.statusCode).toBe(403);

      const missingCsrf = await app.inject({
        method: "POST",
        url: "/api/collaboration-strategies",
        headers: {
          cookie: session.cookie,
          origin: localOrigin,
        },
        payload: draftPayload(teacher.bindingId),
      });
      expect(missingCsrf.statusCode).toBe(403);

      const wrongCsrf = await app.inject({
        method: "POST",
        url: "/api/collaboration-strategies",
        headers: {
          cookie: session.cookie,
          origin: localOrigin,
          "x-csrf-token": "wrong-token",
        },
        payload: draftPayload(teacher.bindingId),
      });
      expect(wrongCsrf.statusCode).toBe(403);

      const badOrigin = await app.inject({
        method: "POST",
        url: "/api/collaboration-strategies",
        headers: {
          ...headers(session, true),
          origin: "https://example.invalid",
        },
        payload: draftPayload(teacher.bindingId),
      });
      expect(badOrigin.statusCode).toBe(403);

      const forgedActor = await app.inject({
        method: "POST",
        url: "/api/collaboration-strategies",
        headers: headers(session, true),
        payload: {
          ...draftPayload(teacher.bindingId),
          actorId: "forged-teacher",
        },
      });
      expect([400, 403]).toContain(forgedActor.statusCode);

      const created = await app.inject({
        method: "POST",
        url: "/api/collaboration-strategies",
        headers: headers(session, true),
        payload: draftPayload(teacher.bindingId),
      });
      expect(created.statusCode).toBe(201);
      const staleHash = await app.inject({
        method: "POST",
        url: "/api/collaboration-strategies"
          + "/strategy-rain-collaboration/versions/1/governance",
        headers: headers(session, true),
        payload: governancePayload(
          teacher.bindingId,
          "0".repeat(64),
          "draft",
          0,
          "approve",
        ),
      });
      expect(staleHash.statusCode).toBe(409);
      expect(staleHash.json().code).toBe("content_hash_conflict");

      const contentHash = created.json().strategy.contentHash as string;
      const staleRevision = await app.inject({
        method: "POST",
        url: "/api/collaboration-strategies"
          + "/strategy-rain-collaboration/versions/1/governance",
        headers: headers(session, true),
        payload: governancePayload(
          teacher.bindingId,
          contentHash,
          "draft",
          99,
          "approve",
        ),
      });
      expect(staleRevision.statusCode).toBe(409);
      expect(staleRevision.json().code).toBe("governance_conflict");

      const approved = await app.inject({
        method: "POST",
        url: "/api/collaboration-strategies"
          + "/strategy-rain-collaboration/versions/1/governance",
        headers: headers(session, true),
        payload: governancePayload(
          teacher.bindingId,
          contentHash,
          "draft",
          0,
          "approve",
        ),
      });
      expect(approved.statusCode).toBe(200);

      const competing = await app.inject({
        method: "POST",
        url: "/api/collaboration-strategies",
        headers: headers(session, true),
        payload: draftPayload(
          teacher.bindingId,
          "strategy-rain-collaboration-competing",
        ),
      });
      expect(competing.statusCode).toBe(201);
      const competingHash = competing.json().strategy.contentHash as string;
      const duplicateApproved = await app.inject({
        method: "POST",
        url: "/api/collaboration-strategies"
          + "/strategy-rain-collaboration-competing/versions/1/governance",
        headers: headers(session, true),
        payload: governancePayload(
          teacher.bindingId,
          competingHash,
          "draft",
          0,
          "approve",
        ),
      });
      expect(duplicateApproved.statusCode).toBe(409);
      expect(duplicateApproved.json().code).toBe("approved_version_conflict");
    } finally {
      await app.close();
    }
  });

  it("persists across restart and exposes corruption as 503 without truncation", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "ronggang-strategy-api-"));
    temporaryDirectories.push(root);
    const dataDir = resolve(root, "data");
    const strategyPath = resolve(dataDir, "collaboration-strategies.jsonl");

    const first = await persistentApp(dataDir);
    try {
      const session = await login(first);
      const teacher = actorBinding(session, "teacher-main");
      const created = await first.inject({
        method: "POST",
        url: "/api/collaboration-strategies",
        headers: headers(session, true),
        payload: draftPayload(teacher.bindingId),
      });
      expect(created.statusCode).toBe(201);
      const contentHash = created.json().strategy.contentHash as string;
      const approved = await first.inject({
        method: "POST",
        url: "/api/collaboration-strategies"
          + "/strategy-rain-collaboration/versions/1/governance",
        headers: headers(session, true),
        payload: governancePayload(
          teacher.bindingId,
          contentHash,
          "draft",
          0,
          "approve",
        ),
      });
      expect(approved.statusCode).toBe(200);
    } finally {
      await first.close();
    }

    const second = await persistentApp(dataDir);
    try {
      const session = await login(second);
      const teacher = actorBinding(session, "teacher-main");
      const recovered = await second.inject({
        method: "GET",
        url: "/api/collaboration-strategies"
          + `?bindingId=${teacher.bindingId}`
          + `&authorizationSessionId=${DEMO_SESSION_ID}`
          + "&status=approved",
        headers: headers(session),
      });
      expect(recovered.statusCode).toBe(200);
      expect(recovered.json().strategies).toHaveLength(1);
    } finally {
      await second.close();
    }

    const validLog = await readFile(strategyPath, "utf8");
    const corruptedLog = `${validLog}{"schemaVersion":1`;
    await writeFile(strategyPath, corruptedLog, "utf8");
    const third = await persistentApp(dataDir);
    try {
      const session = await login(third);
      const teacher = actorBinding(session, "teacher-main");
      const failedClosed = await third.inject({
        method: "GET",
        url: "/api/collaboration-strategies"
          + `?bindingId=${teacher.bindingId}`
          + `&authorizationSessionId=${DEMO_SESSION_ID}`,
        headers: headers(session),
      });
      expect(failedClosed.statusCode).toBe(503);
      expect(failedClosed.json().code).toBe("corrupted_log");
      expect(await readFile(strategyPath, "utf8")).toBe(corruptedLog);
    } finally {
      await third.close();
    }
  });
});
