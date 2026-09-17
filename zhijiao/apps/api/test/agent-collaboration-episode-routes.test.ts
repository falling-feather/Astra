import Fastify from "fastify";
import { ZodError } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ModelProviderHealthSchema,
  WorldEventSchema,
  type ScenarioPackageRef,
} from "@ronggang/contracts";
import { buildAgentTopologyManifest } from "@ronggang/agent-runtime";
import { publishXunpuContractCourseRelease } from "@ronggang/course-content";
import { AgentCollaborationEpisodeService } from "../src/agent-collaboration-episode.js";
import { registerAgentCollaborationEpisodeRoutes } from "../src/agent-collaboration-episode-routes.js";

const scenarioRef: ScenarioPackageRef = {
  releaseId: "release-scenario-xunpu-media-2.0.0-baseline",
  scenarioId: "scenario-xunpu-media",
  version: "2.0.0",
  schemaVersion: "scenario-package/1.0.0",
  contentHash: "a".repeat(64),
};
const release = publishXunpuContractCourseRelease(scenarioRef);
const event = WorldEventSchema.parse({
  schemaVersion: "0.1.0",
  kind: "WorldEvent",
  sessionId: "session-route-xunpu",
  sceneId: "xunpu-topic-brief",
  actorId: "system",
  messageId: "message-route-xunpu",
  correlationId: "correlation-route-xunpu",
  timestamp: "2026-08-09T09:10:00.000Z",
  eventId: "event-route-xunpu",
  eventType: "node_activated",
  stateVersion: 2,
  visibility: ["assigned_team"],
  visibleToActorIds: [],
  summary: "选题现场已激活。",
  payload: { rawTrace: "PRIVATE_TRACE_CANARY" },
  actionContext: null,
});
const health = ModelProviderHealthSchema.parse({
  profileId: "deterministic-route",
  provider: "deterministic",
  mode: "mock",
  configured: true,
  available: true,
  baseUrl: null,
  models: ["deterministic-route"],
  reason: null,
});

async function createRouteApp() {
  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      reply.status(400).send({ error: "InvalidEpisodeRequest" });
      return;
    }
    reply.status(500).send({ error: "InternalError" });
  });
  const loadAuthorizedEpisode = vi.fn().mockImplementation(async () => ({
    audience: "student" as const,
    projection: {
      sessionId: "session-route-xunpu",
      scenarioId: scenarioRef.scenarioId,
      stateVersion: 2,
      currentNodeId: "xunpu-topic-brief",
      currentSourceEventId: event.eventId,
      scenarioReleaseRef: scenarioRef,
    },
    courseRelease: release,
    events: [event],
    adviceDecisionAvailable: true,
    traceRecords: [],
    actorKinds: { system: "system" as const },
    modelHealth: health,
    generatedAt: "2026-08-09T09:11:00.000Z",
  }));
  const authorizeAdministrator = vi.fn();
  await registerAgentCollaborationEpisodeRoutes(app, {
    service: new AgentCollaborationEpisodeService(
      buildAgentTopologyManifest("2026-08-09T09:11:00.000Z"),
    ),
    loadAuthorizedEpisode,
    authorizeAdministrator,
  });
  return { app, loadAuthorizedEpisode, authorizeAdministrator };
}

const apps: Awaited<ReturnType<typeof createRouteApp>>["app"][] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("V2 collaboration episode routes", () => {
  it("infers the student audience server-side and returns the safe DTO", async () => {
    const context = await createRouteApp();
    apps.push(context.app);
    const response = await context.app.inject({
      method: "GET",
      url: "/api/sessions/session-route-xunpu/collaboration-episode?bindingId=binding-reporter",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      audience: "student",
      status: "suggestion_ready",
    });
    expect(JSON.stringify(response.json())).not.toContain(
      "PRIVATE_TRACE_CANARY",
    );
  });

  it("rejects forged audience, replay and provider query before authorization", async () => {
    const context = await createRouteApp();
    apps.push(context.app);
    const response = await context.app.inject({
      method: "GET",
      url: "/api/sessions/session-route-xunpu/collaboration-episode?bindingId=binding-reporter&audience=admin&provider=live&replay=forged",
    });
    expect(response.statusCode).toBe(400);
    expect(context.loadAuthorizedEpisode).not.toHaveBeenCalled();
  });

  it("returns 409 with the safe failure DTO on version drift", async () => {
    const context = await createRouteApp();
    apps.push(context.app);
    context.loadAuthorizedEpisode.mockImplementationOnce(async () => ({
      ...(await context.loadAuthorizedEpisode.getMockImplementation()!({})),
      projection: {
        sessionId: "session-route-xunpu",
        scenarioId: scenarioRef.scenarioId,
        stateVersion: 2,
        currentNodeId: "xunpu-topic-brief",
        currentSourceEventId: event.eventId,
        scenarioReleaseRef: {
          ...scenarioRef,
          contentHash: "0".repeat(64),
        },
      },
    }));
    const response = await context.app.inject({
      method: "GET",
      url: "/api/sessions/session-route-xunpu/collaboration-episode?bindingId=binding-reporter",
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      audience: "student",
      status: "failed",
      failure: { code: "version_hash_drift" },
      authorityWriteback: null,
    });
  });

  it("authorizes and exposes the enriched six-group fourteen-agent admin view", async () => {
    const context = await createRouteApp();
    apps.push(context.app);
    const response = await context.app.inject({
      method: "GET",
      url: "/api/admin/agent-topology",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().groups).toHaveLength(6);
    expect(response.json().agents).toHaveLength(14);
    expect(response.json().agents[0]).toMatchObject({
      runtimeState: "idle",
      latestRun: null,
    });
    expect(context.authorizeAdministrator).toHaveBeenCalledTimes(1);
    expect(context.loadAuthorizedEpisode).not.toHaveBeenCalled();
  });
});
