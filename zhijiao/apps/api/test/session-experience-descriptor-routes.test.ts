import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import {
  buildSessionExperienceDescriptor,
  InMemorySessionExperienceDescriptorStore,
  SessionExperienceDescriptorService,
} from "../src/session-experience-descriptor.js";
import { registerSessionExperienceDescriptorRoutes } from "../src/session-experience-descriptor-routes.js";

function fixture() {
  return buildSessionExperienceDescriptor({
    sessionId: "session-opaque-runtime",
    courseReleaseRef: {
      courseId: "course-xunpu-intangible-media",
      releaseId: "course-xunpu-r4",
      version: 4,
      contentHash: "a".repeat(64),
    },
    scenarioReleaseRef: {
      scenarioId: "scenario-xunpu-living-world",
      version: "4.0.0",
      contentHash: "b".repeat(64),
    },
    experienceGeneration: "flagship_v4",
    frozenAt: "2026-09-01T00:00:00.000Z",
  });
}

async function application() {
  const descriptor = fixture();
  const service = new SessionExperienceDescriptorService(
    new InMemorySessionExperienceDescriptorStore(),
    async () => ({
      sessionId: descriptor.sessionId,
      courseReleaseRef: descriptor.courseReleaseRef,
      scenarioReleaseRef: descriptor.scenarioReleaseRef,
      experienceGeneration: descriptor.experienceGeneration,
    }),
  );
  await service.freeze(descriptor);
  const authorize = vi.fn(async ({ bindingId }: { bindingId: string }) => {
    if (bindingId !== "binding-authorized") throw new Error("binding denied");
  });
  const app = Fastify();
  await registerSessionExperienceDescriptorRoutes(app, {
    descriptors: service,
    authorize,
  });
  return { app, authorize, descriptor };
}

describe("session experience descriptor route", () => {
  it("returns only the server-frozen descriptor after binding authorization", async () => {
    const { app, authorize, descriptor } = await application();
    const response = await app.inject({
      method: "GET",
      url: `/api/sessions/${descriptor.sessionId}/experience-descriptor?bindingId=binding-authorized`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ descriptor });
    expect(authorize).toHaveBeenCalledOnce();
    await app.close();
  });

  it("rejects browser generation hints before authorization", async () => {
    const { app, authorize, descriptor } = await application();
    const response = await app.inject({
      method: "GET",
      url: `/api/sessions/${descriptor.sessionId}/experience-descriptor?bindingId=binding-authorized&experienceGeneration=standard_v2`,
    });
    expect(response.statusCode).toBe(500);
    expect(authorize).not.toHaveBeenCalled();
    await app.close();
  });

  it("does not read the descriptor through a mismatched binding", async () => {
    const { app, descriptor } = await application();
    const response = await app.inject({
      method: "GET",
      url: `/api/sessions/${descriptor.sessionId}/experience-descriptor?bindingId=binding-forged`,
    });
    expect(response.statusCode).toBe(500);
    expect(response.json()).not.toHaveProperty("descriptor");
    await app.close();
  });
});
