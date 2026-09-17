import Fastify from "fastify";
import { ZodError } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildCrossCourseAgentRuleManifest,
  buildInsufficientAgentAblationEvidence,
  buildAgentTopologyManifest,
} from "@ronggang/agent-runtime";
import {
  aiCopyrightContractCourseRelease,
  rainEmergencyContractCourseRelease,
  villagePostpublicationContractCourseRelease,
  villageSuperContractCourseRelease,
  xunpuContractCourseRelease,
} from "@ronggang/course-content";
import {
  AgentAblationIntegrityError,
  registerAgentAblationRoutes,
} from "../src/agent-ablation-routes.js";

function fixtures() {
  const manifest = buildCrossCourseAgentRuleManifest({
    topology: buildAgentTopologyManifest("2026-08-09T12:00:00.000Z"),
    courseReleases: [
      xunpuContractCourseRelease,
      villageSuperContractCourseRelease,
      villagePostpublicationContractCourseRelease,
      aiCopyrightContractCourseRelease,
      rainEmergencyContractCourseRelease,
    ],
    publishedScenarioRefs: [],
    generatedAt: "2026-08-09T12:00:00.000Z",
  });
  return {
    manifest,
    evidence: buildInsufficientAgentAblationEvidence({
      manifest,
      generatedAt: "2026-08-09T12:00:00.000Z",
    }),
  };
}

async function createApp() {
  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      reply.status(400).send({ error: "InvalidAgentAblationRequest" });
      return;
    }
    if (error instanceof AgentAblationIntegrityError) {
      reply.status(409).send({ error: error.code });
      return;
    }
    reply.status(403).send({ error: "AccessDenied" });
  });
  const { manifest, evidence } = fixtures();
  const authorizeAdministrator = vi.fn();
  const readRuleManifest = vi.fn(() => manifest);
  const readAblationEvidence = vi.fn(() => evidence);
  await registerAgentAblationRoutes(app, {
    authorizeAdministrator,
    readRuleManifest,
    readAblationEvidence,
  });
  return {
    app,
    authorizeAdministrator,
    readRuleManifest,
    readAblationEvidence,
  };
}

const apps: Awaited<ReturnType<typeof createApp>>["app"][] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("V2 admin-only agent ablation routes", () => {
  it("returns the strict five-course manifest and honest insufficient evidence", async () => {
    const context = await createApp();
    apps.push(context.app);
    const manifest = await context.app.inject({
      method: "GET",
      url: "/api/admin/agent-rule-manifest",
    });
    const evidence = await context.app.inject({
      method: "GET",
      url: "/api/admin/agent-ablation-evidence",
    });
    expect(manifest.statusCode).toBe(200);
    expect(manifest.json().courses).toHaveLength(5);
    expect(evidence.statusCode).toBe(200);
    expect(evidence.json()).toMatchObject({
      observationCount: 0,
      conclusion: "insufficient_evidence",
    });
    expect(JSON.stringify(evidence.json())).not.toMatch(
      /rolePrivateEvidence|authoritativeFact|prompt|privateMemory|rawTrace|providerRequestId/u,
    );
  });

  it("rejects forged query before authorization or readers", async () => {
    const context = await createApp();
    apps.push(context.app);
    const response = await context.app.inject({
      method: "GET",
      url: "/api/admin/agent-ablation-evidence?condition=C&provider=live&trace=raw",
    });
    expect(response.statusCode).toBe(400);
    expect(context.authorizeAdministrator).not.toHaveBeenCalled();
    expect(context.readAblationEvidence).not.toHaveBeenCalled();
    expect(context.readRuleManifest).not.toHaveBeenCalled();
  });

  it("does not call readers when administrator authorization fails", async () => {
    const context = await createApp();
    apps.push(context.app);
    context.authorizeAdministrator.mockRejectedValueOnce(new Error("denied"));
    const response = await context.app.inject({
      method: "GET",
      url: "/api/admin/agent-rule-manifest",
    });
    expect(response.statusCode).toBe(403);
    expect(context.readRuleManifest).not.toHaveBeenCalled();
  });

  it("fails closed with 409 when a reader returns a drifted manifest or report", async () => {
    const context = await createApp();
    apps.push(context.app);
    const values = fixtures();
    context.readRuleManifest.mockReturnValueOnce({
      ...values.manifest,
      manifestHash: "f".repeat(64),
    });
    const manifest = await context.app.inject({
      method: "GET",
      url: "/api/admin/agent-rule-manifest",
    });
    expect(manifest.statusCode).toBe(409);

    context.readAblationEvidence.mockReturnValueOnce({
      ...values.evidence,
      reportHash: "f".repeat(64),
    });
    const evidence = await context.app.inject({
      method: "GET",
      url: "/api/admin/agent-ablation-evidence",
    });
    expect(evidence.statusCode).toBe(409);
  });
});
