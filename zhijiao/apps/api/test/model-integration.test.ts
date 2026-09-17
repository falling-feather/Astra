import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UnifiedIflytekAdapter } from "@ronggang/iflytek-adapter";
import {
  SemanticActionRequestV4SchemaVersion,
  type ModelInvocationRequest,
  type ModelInvocationResult,
  type ModelProviderHealth,
} from "@ronggang/contracts";
import type { StructuredModelPort } from "@ronggang/model-gateway";
import {
  InMemoryEventStore,
  InProcessMessageBus,
  WorldEngine,
  demoScenario,
} from "@ronggang/world-core";
import { createModelIntegration } from "../src/model-integration.js";
import type { DemoAuthContext } from "../src/identity.js";
import {
  createMemoryTestApp,
  createApp,
  DEMO_SESSION_ID,
  DEMO_XUNPU_SESSION_ID,
} from "../src/server.js";

const trackedApps: FastifyInstance[] = [];
const trackedDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(trackedApps.splice(0).map((app) => app.close()));
  await Promise.all(trackedDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  )));
});

describe("API model integration", () => {
  it("injects a healthy structured provider into the public V4 semantic action chain", async () => {
    const deterministic = createModelIntegration({
      environment: { MODEL_PROVIDER: "deterministic" },
    });
    const health = (): ModelProviderHealth => ({
      profileId: "v4-public-live",
      provider: "deepseek",
      mode: "live",
      configured: true,
      available: true,
      baseUrl: "https://model.example/v1/",
      models: ["model-v4-public"],
      reason: null,
    });
    const invoke = vi.fn(async (
      request: ModelInvocationRequest,
    ): Promise<ModelInvocationResult> => {
      const prompt = JSON.parse(request.userPrompt) as {
        observation?: {
          selectedObjects?: Array<{ objectId: string }>;
          candidates?: Array<{ planRef: string }>;
        };
      };
      const targetObjectId = prompt.observation?.selectedObjects?.[0]?.objectId
        ?? "entity-gatekeeper";
      const output = request.taskKind === "flagship_v4.autonomous_npc_decision"
        ? {
            disposition: "select",
            selectedPlanRef: prompt.observation?.candidates?.[0]?.planRef,
            deferUntilVirtualMinute: null,
            rationale: "当前角色的岗位目标要求及时回应学生行动。",
          }
        : {
            outcome: "accepted",
            intent: "ask",
            confidence: 0.93,
            rationale: "先说明记者身份，再询问公共采访边界。",
            targetObjectIds: [targetObjectId],
            materialObjectIds: [],
            riskRefs: [],
            ambiguityCode: null,
            refusalReasonCode: null,
          };
      return {
        output,
        trace: {
          invocationId: request.invocationId,
          profileId: request.profileId,
          provider: "deepseek",
          mode: "live",
          model: "model-v4-public",
          requestId: "private-provider-request",
          status: "completed",
          outputMode: request.outputMode,
          finishReason: "stop",
          tokenUsage: { input: 80, output: 30, total: 110 },
          latencyMs: 11,
          attempts: 1,
          estimatedCostUsd: 0.0001,
          errorCode: null,
          startedAt: "2026-08-31T00:00:00.000Z",
          completedAt: "2026-08-31T00:00:01.000Z",
        },
      };
    });
    const provider: StructuredModelPort = { invoke, health };
    const dataDir = await mkdtemp(join(tmpdir(), "ronggang-v4-model-wiring-"));
    trackedDirectories.push(dataDir);
    const app = await createApp({
      dataDir,
      initializeSecondaryDemo: false,
      awaitStartupRecovery: true,
      environment: { NODE_ENV: "test" },
      modelIntegration: {
        runtime: deterministic.runtime,
        provider,
        health,
      },
    });
    trackedApps.push(app);
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/demo-session",
      headers: { origin: "http://localhost:5173" },
      payload: {
        profileId: "student-team-a",
        sessionId: DEMO_XUNPU_SESSION_ID,
      },
    });
    expect(login.statusCode).toBe(200);
    const auth = login.json() as DemoAuthContext;
    const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
    const binding = auth.bindings.find((item) => (
      item.sessionId === DEMO_XUNPU_SESSION_ID && item.actorKind === "student"
    ));
    expect(binding).toBeTruthy();
    const experienceResponse = await app.inject({
      method: "GET",
      url: `/api/v4/sessions/${DEMO_XUNPU_SESSION_ID}/experience?bindingId=${binding!.bindingId}`,
      headers: { cookie },
    });
    expect(experienceResponse.statusCode).toBe(200);
    const experience = experienceResponse.json().experience as {
      actionWindow: {
        actionWindowRef: string;
        actionWindowHash: string;
        worldStateVersion: number;
        selections: Array<{
          selectionToken: string;
          displayKind: string;
          label: string;
        }>;
      };
    };
    const gatekeeper = experience.actionWindow.selections.find((selection) => (
      selection.label.includes("林师傅")
    ));
    expect(gatekeeper).toBeTruthy();
    const action = await app.inject({
      method: "POST",
      url: `/api/v4/sessions/${DEMO_XUNPU_SESSION_ID}/semantic-actions`,
      headers: {
        cookie,
        origin: "http://localhost:5173",
        "x-csrf-token": auth.csrfToken,
      },
      payload: {
        schemaVersion: SemanticActionRequestV4SchemaVersion,
        requestId: "request-v4-public-live-model",
        sessionId: DEMO_XUNPU_SESSION_ID,
        bindingId: binding!.bindingId,
        actionWindowRef: experience.actionWindow.actionWindowRef,
        actionWindowHash: experience.actionWindow.actionWindowHash,
        expectedWorldStateVersion: experience.actionWindow.worldStateVersion,
        utterance: "您好，我是实训记者，想先确认公共拍摄和采访边界。",
        selections: [{
          selectionToken: gatekeeper!.selectionToken,
          displayKind: gatekeeper!.displayKind,
        }],
        submittedAt: new Date().toISOString(),
      },
    });

    expect(action.statusCode).toBe(200);
    expect(action.json()).toMatchObject({
      decision: { status: "accepted", parserMode: "live_model" },
      execution: { status: "world_event_created" },
    });
    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({
      taskKind: "flagship_v4.semantic_action",
      outputContractId: "semantic-action-parser/4.0.0",
    }));
    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({
      taskKind: "flagship_v4.autonomous_npc_decision",
      outputContractId: "autonomous-npc-decision/4.0.0",
    }));
    expect(JSON.stringify(action.json())).not.toMatch(
      /private-provider-request|trace|prompt|provider/iu,
    );
  }, 30_000);

  it("registers the Xingchen workflow handler in the public startup chain", async () => {
    const engine = new WorldEngine({
      store: new InMemoryEventStore(),
      bus: new InProcessMessageBus(),
      scenario: structuredClone(demoScenario),
    });
    const app = await createMemoryTestApp({
      engine,
      initializeDemo: false,
      initializeSecondaryDemo: false,
      environment: {
        MODEL_PROVIDER: "iflytek_xingchen",
        MODEL_PROFILE_ID: "xingchen-public-wiring",
        IFLYTEK_XINGCHEN_ENDPOINT: "https://xingchen.example/workflow/v1/chat/completions",
        IFLYTEK_XINGCHEN_TOKEN: "server-only-token",
        IFLYTEK_XINGCHEN_WORKFLOW_ID: "workflow-public-1",
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/models/health",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      health: expect.objectContaining({
        profileId: "xingchen-public-wiring",
        provider: "iflytek_xingchen",
        mode: "live",
        configured: true,
        available: true,
        baseUrl: null,
        reason: null,
      }),
    });
    expect(JSON.stringify(response.json())).not.toContain(
      "server-only-token",
    );
    await app.close();
  });

  it("injects the DeepSeek profile through the model gateway and persists a sanitized trace", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({
      id: "chatcmpl-integration",
      model: "deepseek-v4-flash",
      choices: [{
        finish_reason: "stop",
        message: {
          content: JSON.stringify({
            intentType: "propose_data_correction",
            rationaleSummary: "入口去重表证明初版存在跨入口重复汇总，应将口径更正为唯一票务标识去重后的12,600人次。",
            proposedPayload: {
              statement: "活动执行方复核后确认，截至14:20按唯一票务标识去重后的有效客流为12,600人次，18,000为重复汇总值。",
            },
            confidence: 0.93,
          }),
        },
      }],
      usage: {
        prompt_tokens: 260,
        completion_tokens: 120,
        total_tokens: 380,
      },
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "x-request-id": "deepseek-request-integration",
      },
    })) as typeof fetch;
    const modelIntegration = createModelIntegration({
      environment: {
        MODEL_PROVIDER: "deepseek",
        MODEL_PROFILE_ID: "deepseek-integration-test",
        DEEPSEEK_API_KEY: "test-only-key",
        DEEPSEEK_MODEL: "deepseek-v4-flash",
      },
      fetchImpl,
    });
    const scenario = structuredClone(demoScenario);
    scenario.interactionGates = [];
    const engine = new WorldEngine({
      store: new InMemoryEventStore(),
      bus: new InProcessMessageBus(),
      scenario,
    });
    const app = await createMemoryTestApp({
      engine,
      modelIntegration,
      adapter: new UnifiedIflytekAdapter({ mode: "mock", environment: {} }),
    });
    const projection = await app.inject({
      method: "POST",
      url: "/api/auth/demo-session",
      headers: { origin: "http://localhost:5173" },
      payload: {},
    });
    const auth = projection.json() as DemoAuthContext;
    const setCookie = String(projection.headers["set-cookie"]).split(";")[0]!;
    const studentBinding = auth.bindings.find((item) => item.actorKind === "student")!;
    const teacherBinding = auth.bindings.find((item) => item.actorKind === "teacher")!;
    const studentProjection = await app.inject({
      method: "GET",
      url: `/api/sessions/${DEMO_SESSION_ID}/projection?bindingId=${studentBinding.bindingId}`,
      headers: { cookie: setCookie },
    });
    const action = await app.inject({
      method: "POST",
      url: `/api/sessions/${DEMO_SESSION_ID}/commands`,
      headers: {
        cookie: setCookie,
        origin: "http://localhost:5173",
        "x-csrf-token": auth.csrfToken,
      },
      payload: {
        bindingId: studentBinding.bindingId,
        name: "inspect_material",
        expectedStateVersion: studentProjection.json().stateVersion,
        payload: { materialId: "material-festival-photo" },
      },
    });

    expect(action.statusCode).toBe(200);
    let runs = await app.inject({
      method: "GET",
      url: `/api/sessions/${DEMO_SESSION_ID}/agent-runs?bindingId=${teacherBinding.bindingId}`,
      headers: { cookie: setCookie },
    });
    for (
      let attempt = 0;
      attempt < 50 && !runs.json().runs.some((run: {
        agentId: string;
        modelInvocations: unknown[];
      }) => run.agentId === "agent-fact-checker" && run.modelInvocations.length > 0);
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      runs = await app.inject({
        method: "GET",
        url: `/api/sessions/${DEMO_SESSION_ID}/agent-runs?bindingId=${teacherBinding.bindingId}`,
        headers: { cookie: setCookie },
      });
    }
    const factCheckerRun = runs.json().runs.find((run: {
      agentId: string;
      modelInvocations: unknown[];
    }) => run.agentId === "agent-fact-checker" && run.modelInvocations.length > 0);
    expect(factCheckerRun.modelInvocations[0]).toMatchObject({
      provider: "deepseek",
      mode: "live",
      model: "deepseek-v4-flash",
      requestId: "deepseek-request-integration",
      status: "completed",
    });
    expect(JSON.stringify(runs.json())).not.toContain("test-only-key");

    const teacher = await app.inject({
      method: "GET",
      url: `/api/sessions/${DEMO_SESSION_ID}/projection?bindingId=${teacherBinding.bindingId}`,
      headers: { cookie: setCookie },
    });
    expect(teacher.json().pendingCandidates.find(
      (candidate: { title: string }) => candidate.title === "客流数据更正",
    )).toBeTruthy();
    await app.close();
  });

  it("keeps DeepSeek available while the showcase path uses deterministic structured agents", async () => {
    const fetchImpl = vi.fn(async () => new Response("unexpected", { status: 500 })) as typeof fetch;
    const modelIntegration = createModelIntegration({
      environment: {
        MODEL_PROVIDER: "deepseek",
        MODEL_PROFILE_ID: "deepseek-showcase-test",
        DEEPSEEK_API_KEY: "test-only-key",
        DEEPSEEK_MODEL: "deepseek-v4-flash",
        SHOWCASE_DETERMINISTIC_STRUCTURED: "1",
      },
      fetchImpl,
    });
    expect(modelIntegration.health()).toMatchObject({
      provider: "deepseek",
      mode: "live",
      available: true,
    });

    const scenario = structuredClone(demoScenario);
    scenario.interactionGates = [];
    const engine = new WorldEngine({
      store: new InMemoryEventStore(),
      bus: new InProcessMessageBus(),
      scenario,
    });
    const app = await createMemoryTestApp({
      engine,
      modelIntegration,
      adapter: new UnifiedIflytekAdapter({ mode: "mock", environment: {} }),
    });
    const demoAuth = await app.inject({
      method: "POST",
      url: "/api/auth/demo-session",
      headers: { origin: "http://localhost:5173" },
      payload: {},
    });
    const auth = demoAuth.json() as DemoAuthContext;
    const cookie = String(demoAuth.headers["set-cookie"]).split(";")[0]!;
    const studentBinding = auth.bindings.find((item) => item.actorKind === "student")!;
    const teacherBinding = auth.bindings.find((item) => item.actorKind === "teacher")!;
    const studentProjection = await app.inject({
      method: "GET",
      url: `/api/sessions/${DEMO_SESSION_ID}/projection?bindingId=${studentBinding.bindingId}`,
      headers: { cookie },
    });
    await app.inject({
      method: "POST",
      url: `/api/sessions/${DEMO_SESSION_ID}/commands`,
      headers: {
        cookie,
        origin: "http://localhost:5173",
        "x-csrf-token": auth.csrfToken,
      },
      payload: {
        bindingId: studentBinding.bindingId,
        name: "inspect_material",
        expectedStateVersion: studentProjection.json().stateVersion,
        payload: { materialId: "material-festival-photo" },
      },
    });

    let teacher = await app.inject({
      method: "GET",
      url: `/api/sessions/${DEMO_SESSION_ID}/projection?bindingId=${teacherBinding.bindingId}`,
      headers: { cookie },
    });
    for (
      let attempt = 0;
      attempt < 50 && !teacher.json().pendingCandidates.some(
        (candidate: { title: string }) => candidate.title === "客流数据更正",
      );
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      teacher = await app.inject({
        method: "GET",
        url: `/api/sessions/${DEMO_SESSION_ID}/projection?bindingId=${teacherBinding.bindingId}`,
        headers: { cookie },
      });
    }
    expect(teacher.json().pendingCandidates.some(
      (candidate: { title: string }) => candidate.title === "客流数据更正",
    )).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
    await app.close();
  });
});
