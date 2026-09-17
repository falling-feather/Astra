import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { buildXunpuSimulationAgentTemplatesV3R2 } from "@ronggang/agent-orchestrator";
import { xunpuFlagshipContentManifestV3 } from "@ronggang/course-content";
import { PermissionDeniedError } from "@ronggang/world-core";
import {
  FlagshipStudentWorkServiceV3,
  InMemoryFlagshipStudentWorkStoreV3,
} from "../src/flagship-student-work-v3.js";
import { registerFlagshipRoleViewsV3Routes } from "../src/flagship-role-views-v3-routes.js";
import { createV3WorldTestRuntime } from "./world-simulation-v3.fixture.js";

const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function appFor(sessionId: string) {
  const runtime = await createV3WorldTestRuntime(sessionId);
  const app = Fastify({ logger: false });
  apps.push(app);
  let authorizeCalls = 0;
  const work = new FlagshipStudentWorkServiceV3({
    store: new InMemoryFlagshipStudentWorkStoreV3(),
    manifest: xunpuFlagshipContentManifestV3,
    now: () => "2026-08-26T09:30:00.000Z",
  });
  await registerFlagshipRoleViewsV3Routes(app, {
    engine: runtime.engine,
    work,
    templates: buildXunpuSimulationAgentTemplatesV3R2(),
    authorize: ({ bindingId }) => {
      authorizeCalls += 1;
      const audience = bindingId === "binding-admin"
        ? "admin" as const
        : bindingId === "binding-teacher"
          ? "teacher" as const
          : "student" as const;
      return {
        audience,
        principalId: `principal-${audience}`,
        actorId: `actor-${audience}`,
        bindingId,
      };
    },
  });
  app.setErrorHandler((error, _request, reply) => {
    const status = error instanceof z.ZodError
      ? 400
      : error instanceof PermissionDeniedError
        ? 403
        : 500;
    void reply.status(status).send({
      message: error instanceof Error ? error.message : "unknown",
    });
  });
  return { app, authorizeCalls: () => authorizeCalls };
}

describe("flagship V3 teacher and administrator views", () => {
  it("returns a role-safe nine-artifact review without creating or exposing ownership", async () => {
    const sessionId = "session-role-work-review";
    const { app } = await appFor(sessionId);
    const response = await app.inject({
      method: "GET",
      url: `/api/v3/sessions/${sessionId}/work-review?bindingId=binding-teacher`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().review).toMatchObject({
      schemaVersion: "flagship-work-review/3.0.0",
      sessionId,
      completion: {
        requiredArtifactCount: 9,
        submittedRequiredCount: 0,
        readyForPublication: false,
      },
    });
    expect(response.json().review.artifacts).toHaveLength(9);
    const serialized = JSON.stringify(response.json());
    expect(serialized).not.toContain("ownerPrincipalId");
    expect(serialized).not.toContain("bindingId");
    expect(serialized).not.toContain("requestReceipts");
    expect(serialized).not.toContain("private");

    const student = await app.inject({
      method: "GET",
      url: `/api/v3/sessions/${sessionId}/work-review?bindingId=binding-student`,
    });
    expect(student.statusCode).toBe(403);
  });

  it("projects the exact server topology only to administrators", async () => {
    const sessionId = "session-role-topology";
    const { app, authorizeCalls } = await appFor(sessionId);
    const response = await app.inject({
      method: "GET",
      url: `/api/v3/admin/sessions/${sessionId}/agent-topology?bindingId=binding-admin`,
    });

    expect(response.statusCode).toBe(200);
    const topology = response.json().topology;
    expect(topology.schemaVersion).toBe("simulation-agent-topology/3.0.0");
    expect(topology.groups).toHaveLength(6);
    expect(topology.agents).toHaveLength(14);
    expect(new Set(topology.agents.map((agent: { groupId: string }) => agent.groupId)).size)
      .toBe(6);
    expect(topology.agents.every((agent: { authority: string }) => (
      agent.authority === "proposal_only"
    ))).toBe(true);
    expect(topology.agents.every((agent: { forbiddenActions: string[] }) => (
      agent.forbiddenActions.includes("authoritative_world_write")
    ))).toBe(true);

    const teacher = await app.inject({
      method: "GET",
      url: `/api/v3/admin/sessions/${sessionId}/agent-topology?bindingId=binding-teacher`,
    });
    expect(teacher.statusCode).toBe(403);

    const callsBeforeForgery = authorizeCalls();
    const forged = await app.inject({
      method: "GET",
      url: `/api/v3/admin/sessions/${sessionId}/agent-topology?bindingId=binding-admin&traceRef=forged`,
    });
    expect(forged.statusCode).toBe(400);
    expect(authorizeCalls()).toBe(callsBeforeForgery);
  });
});
