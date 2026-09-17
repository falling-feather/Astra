import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createApp,
  DEMO_XUNPU_SESSION_ID,
  type CreateAppOptions,
} from "../src/server.js";

const localOrigin = "http://localhost:5173";
const apps: FastifyInstance[] = [];
const openingApps = new Set<Promise<FastifyInstance>>();
const directories: string[] = [];
let standardApp: FastifyInstance;
let corruptedReadersApp: FastifyInstance;

afterAll(async () => {
  const started = await Promise.allSettled(openingApps);
  openingApps.clear();
  const opened = new Set([...apps.splice(0), ...started.flatMap(result => result.status === "fulfilled" ? [result.value] : [])]);
  await Promise.all([...opened].map((app) => app.close()));
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

async function createDefaultApp(
  overrides: Partial<CreateAppOptions> = {},
) {
  const dataDir = await mkdtemp(join(tmpdir(), "ronggang-agent-ablation-"));
  directories.push(dataDir);
  const opening = createApp({
    dataDir,
    logger: false,
    initializeSecondaryDemo: false,
    awaitStartupRecovery: true,
    environment: {
      NODE_ENV: "test",
      IFLYTEK_MODE: "mock",
      DEEPSEEK_MODE: "mock",
    },
    ...overrides,
  });
  openingApps.add(opening);
  const app = await opening;
  apps.push(app);
  return app;
}

async function login(
  app: FastifyInstance,
  profileId: string,
  sessionId?: string,
): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/demo-session",
    headers: { origin: localOrigin },
    payload: { profileId, ...(sessionId ? { sessionId } : {}) },
  });
  expect(response.statusCode).toBe(200);
  const cookie = Array.isArray(response.headers["set-cookie"])
    ? response.headers["set-cookie"][0]
    : response.headers["set-cookie"];
  if (!cookie) throw new Error("agent ablation login did not set a cookie");
  return cookie.split(";")[0]!;
}

describe("V2 agent ablation default integration", () => {
  beforeAll(async () => {
    standardApp = await createDefaultApp();
    corruptedReadersApp = await createDefaultApp({
      agentRuleManifestReader: () => ({} as never),
      agentAblationEvidenceReader: () => ({} as never),
    });
  }, 90_000);
  it("allows only operator principal and returns five courses without technical leakage", async () => {
    const app = standardApp;
    const operator = await login(app, "operator-demo", DEMO_XUNPU_SESSION_ID);
    const student = await login(app, "student-team-a", DEMO_XUNPU_SESSION_ID);
    const teacher = await login(app, "teacher-class-a", DEMO_XUNPU_SESSION_ID);

    for (const cookie of [student, teacher]) {
      const response = await app.inject({
        method: "GET",
        url: "/api/admin/agent-ablation-evidence",
        headers: { cookie },
      });
      expect(response.statusCode).toBe(403);
    }

    const manifest = await app.inject({
      method: "GET",
      url: "/api/admin/agent-rule-manifest",
      headers: { cookie: operator },
    });
    const evidence = await app.inject({
      method: "GET",
      url: "/api/admin/agent-ablation-evidence",
      headers: { cookie: operator },
    });
    expect(manifest.statusCode).toBe(200);
    expect(manifest.json().courses).toHaveLength(5);
    expect(manifest.json().baselineTopologyAgentIds).toHaveLength(14);
    expect(manifest.json().courses.every((course: {
      runtimeEligibility: { status: string };
    }) => course.runtimeEligibility.status === "runtime_ready")).toBe(true);
    expect(manifest.json().courses.flatMap((course: { chapters: unknown[] }) => (
      course.chapters
    ))).toHaveLength(30);
    expect(evidence.statusCode).toBe(200);
    expect(evidence.json()).toMatchObject({
      observationCount: 0,
      conclusion: "insufficient_evidence",
      runStatus: "not_ready",
    });
    expect(evidence.json().eligibility.every((item: { status: string }) => (
      item.status === "runtime_ready"
    ))).toBe(true);
    expect(JSON.stringify(evidence.json())).not.toMatch(
      /rolePrivateEvidence|authoritativeFact|prompt|privateMemory|conditionKey|rawTrace|providerRequestId|cookie|token/u,
    );
  }, 30_000);

  it("strictly rejects browser-selected condition, provider and trace", async () => {
    const app = standardApp;
    const operator = await login(app, "operator-demo", DEMO_XUNPU_SESSION_ID);
    const response = await app.inject({
      method: "GET",
      url: "/api/admin/agent-rule-manifest?condition=C&provider=live&trace=raw",
      headers: { cookie: operator },
    });
    expect(response.statusCode).toBe(400);
  }, 30_000);

  it("maps manifest and evidence integrity drift to safe HTTP 409 responses", async () => {
    const app = corruptedReadersApp;
    const operator = await login(app, "operator-demo", DEMO_XUNPU_SESSION_ID);
    for (const url of [
      "/api/admin/agent-rule-manifest",
      "/api/admin/agent-ablation-evidence",
    ]) {
      const response = await app.inject({
        method: "GET",
        url,
        headers: { cookie: operator },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({
        error: "AgentAblationIntegrityError",
        message: expect.any(String),
        code: "AGENT_ABLATION_VERSION_HASH_DRIFT",
      });
      expect(JSON.stringify(response.json())).not.toMatch(
        /cause|manifestHash|reportHash|rawTrace|prompt|privateMemory/u,
      );
    }
  }, 30_000);
});
