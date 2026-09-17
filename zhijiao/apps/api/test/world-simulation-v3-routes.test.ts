import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  registerWorldSimulationV3Routes,
  type SimulationWorldAudienceV3,
} from "../src/world-simulation-v3-routes.js";
import { XunpuWorldDirectorV3 } from "../src/xunpu-world-director-v3.js";
import {
  createV3WorldTestRuntime,
  v3StudentAskBody,
} from "./world-simulation-v3.fixture.js";

const apps: FastifyInstance[] = [];

async function appFor(sessionId: string) {
  const runtime = await createV3WorldTestRuntime(sessionId);
  const app = Fastify({ logger: false });
  apps.push(app);
  let authorizeCalls = 0;
  await registerWorldSimulationV3Routes(app, {
    ...runtime,
    director: new XunpuWorldDirectorV3(runtime.engine),
    authorize: ({ bindingId }) => {
      authorizeCalls += 1;
      const audience: SimulationWorldAudienceV3 = bindingId === "binding-admin"
        ? "admin"
        : bindingId === "binding-teacher"
          ? "teacher"
          : "student";
      return {
        audience,
        principalId: audience === "student" ? "principal-student" : "principal-staff",
        actorId: audience === "student" ? "student-reporter" : "teacher-main",
        bindingId,
      };
    },
  });
  app.setErrorHandler((error, _request, reply) => {
    void reply.status(error instanceof z.ZodError ? 400 : 409).send({
      error: error instanceof Error ? error.message : "unknown",
    });
  });
  return { app, runtime, authorizeCalls: () => authorizeCalls };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("V3 persistent-world routes", () => {
  it("returns role-safe world projections with one real empty Episode", async () => {
    const sessionId = "session-route-safe-world";
    const { app } = await appFor(sessionId);
    const student = await app.inject({
      method: "GET",
      url: `/api/v3/sessions/${sessionId}/world?bindingId=binding-student`,
    });
    const teacher = await app.inject({
      method: "GET",
      url: `/api/v3/sessions/${sessionId}/world?bindingId=binding-teacher`,
    });
    const admin = await app.inject({
      method: "GET",
      url: `/api/v3/sessions/${sessionId}/world?bindingId=binding-admin`,
    });

    expect(student.statusCode).toBe(200);
    expect(student.json().world.availableActions[0].serverIssuedActionRef)
      .toBe("server-action-event-template-gatekeeper-0");
    expect(student.json().world.indicators[0]).not.toHaveProperty("value");
    expect(student.json().world).not.toHaveProperty("queue");
    expect(teacher.json().world.indicators[0]).toHaveProperty("value");
    expect(teacher.json().world).not.toHaveProperty("queue");
    expect(admin.json().world).toHaveProperty("queue");
    const waiting = await app.inject({
      method: "GET",
      url: `/api/v3/sessions/${sessionId}/collaboration-episode?bindingId=binding-student`,
    });
    expect(waiting.json().episode).toMatchObject({
      audience: "student",
      status: "waiting",
      suggestion: null,
    });
  });

  it("runs student action, one suggestion and accepted world consequence through HTTP", async () => {
    const sessionId = "session-route-student-action";
    const { app, runtime } = await appFor(sessionId);
    const action = await app.inject({
      method: "POST",
      url: `/api/v3/sessions/${sessionId}/student-actions`,
      payload: v3StudentAskBody(),
    });

    expect(action.statusCode).toBe(200);
    const episode = action.json().episode;
    expect(episode).toMatchObject({
      audience: "student",
      status: "suggestion_ready",
      suggestion: {
        displayName: "林师傅·社区门卫",
        provenanceVerified: true,
      },
    });
    const decision = await app.inject({
      method: "POST",
      url: `/api/v3/sessions/${sessionId}/episodes/${episode.episodeId}/decisions`,
      payload: {
        bindingId: "binding-student",
        decisionRef: "student-decision-route-accept",
        decision: "accept",
        rationale: "接受条件准入，继续在公共区域采访。",
      },
    });
    expect(decision.statusCode).toBe(200);
    expect(decision.json().episode).toMatchObject({
      audience: "student",
      status: "completed",
      consequence: { status: "committed", resultingStateVersion: 1 },
    });
    expect((await runtime.engine.getSnapshot(sessionId)).stateVersion).toBe(1);
    const teacher = await app.inject({
      method: "GET",
      url: `/api/v3/sessions/${sessionId}/collaboration-episode?bindingId=binding-teacher`,
    });
    expect(teacher.json().episode).toMatchObject({
      audience: "teacher",
      status: "completed",
      dispatchPlan: { selectedCount: 1, skippedCount: 13 },
    });
    expect(JSON.stringify(teacher.json())).not.toContain("traceRefs");
  });

  it("does not let the server-owned scene policy skip required reporting work", async () => {
    const sessionId = "session-route-world-director";
    const { app } = await appFor(sessionId);
    const action = await app.inject({
      method: "POST",
      url: `/api/v3/sessions/${sessionId}/student-actions`,
      payload: v3StudentAskBody(),
    });
    const episode = action.json().episode;
    await app.inject({
      method: "POST",
      url: `/api/v3/sessions/${sessionId}/episodes/${episode.episodeId}/decisions`,
      payload: {
        bindingId: "binding-student",
        decisionRef: "student-decision-before-director",
        decision: "accept",
        rationale: "接受条件准入，观察世界接下来的真实反应。",
      },
    });

    const advanced = await app.inject({
      method: "POST",
      url: `/api/v3/sessions/${sessionId}/advance`,
      payload: { bindingId: "binding-student" },
    });
    expect(advanced.statusCode).toBe(200);
    expect(advanced.json()).toMatchObject({
      advance: {
        scheduled: false,
        reason: "当前应由学生主动采访、核验信源或提交作品，情境导演不替代岗位行动。",
      },
      episode: {
        audience: "student",
        status: "waiting",
        triggerEvent: null,
      },
    });

    const forged = await app.inject({
      method: "POST",
      url: `/api/v3/sessions/${sessionId}/advance`,
      payload: {
        bindingId: "binding-student",
        eventTemplateId: "event-template-publication",
      },
    });
    expect(forged.statusCode).toBe(400);
  });

  it("rejects forged actor/trace inputs before authorization", async () => {
    const sessionId = "session-route-forgery";
    const { app, authorizeCalls } = await appFor(sessionId);
    const forgedBody = await app.inject({
      method: "POST",
      url: `/api/v3/sessions/${sessionId}/student-actions`,
      payload: {
        ...v3StudentAskBody(),
        actorId: "forged-admin",
        traceRef: "forged-trace",
      },
    });
    expect(forgedBody.statusCode).toBe(400);
    expect(authorizeCalls()).toBe(0);

    const forgedQuery = await app.inject({
      method: "GET",
      url: `/api/v3/sessions/${sessionId}/world?bindingId=binding-student&audience=admin`,
    });
    expect(forgedQuery.statusCode).toBe(400);
    expect(authorizeCalls()).toBe(0);

    const staleActionRef = await app.inject({
      method: "POST",
      url: `/api/v3/sessions/${sessionId}/student-actions`,
      payload: {
        ...v3StudentAskBody(),
        serverIssuedActionRef: "server-action-forged",
      },
    });
    expect(staleActionRef.statusCode).toBe(409);
  });

  it("lets only administrator injection create an NPC event and returns admin traces", async () => {
    const sessionId = "session-route-admin-npc";
    const { app } = await appFor(sessionId);
    const injected = await app.inject({
      method: "POST",
      url: `/api/v3/admin/sessions/${sessionId}/world-events`,
      payload: {
        bindingId: "binding-admin",
        requestId: "request-route-npc-shopkeeper",
        sourceKind: "npc_intent",
        eventTemplateId: "event-template-shopkeeper",
        sourceRef: "npc-intent-shopkeeper-route",
        expectedWorldStateVersion: 0,
      },
    });

    expect(injected.statusCode).toBe(200);
    expect(injected.json().episode).toMatchObject({
      audience: "admin",
      status: "in_progress",
      triggerEvent: { sourceKind: "npc_intent" },
      dispatchPlan: { selectedCount: 2 },
      execution: { executionMode: "deterministic_demo" },
    });
    expect(injected.json().episode.execution.traceRefs).toHaveLength(2);

    const denied = await app.inject({
      method: "POST",
      url: `/api/v3/admin/sessions/${sessionId}/world-events`,
      payload: {
        bindingId: "binding-student",
        requestId: "request-route-npc-forged",
        sourceKind: "npc_intent",
        eventTemplateId: "event-template-shopkeeper",
        sourceRef: "npc-intent-shopkeeper-forged",
        expectedWorldStateVersion: 0,
      },
    });
    expect(denied.statusCode).toBe(409);
  });
});
