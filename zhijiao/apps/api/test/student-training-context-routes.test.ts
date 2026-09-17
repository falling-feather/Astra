import Fastify from "fastify";
import { ZodError } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  StudentTrainingContextSchema,
  type StudentTrainingContext,
} from "@ronggang/contracts";
import { registerStudentTrainingContextRoutes } from "../src/student-training-context-routes.js";

const contextFixture = (): StudentTrainingContext => (
  StudentTrainingContextSchema.parse({
    schemaVersion: "student-training-context/2.0.0",
    sessionId: "session-xunpu-route",
    bindingId: "binding-xunpu-reporter",
    courseReleaseRef: {
      courseId: "course-xunpu-intangible-media",
      releaseId: "release-course-xunpu-runtime-2",
      version: 3,
      contentHash: "a".repeat(64),
    },
    scenarioReleaseRef: {
      scenarioId: "scenario-xunpu-media",
      version: "2.0.1",
      contentHash: "b".repeat(64),
    },
    stateVersion: 9,
    generatedAt: "2026-08-09T09:11:00.000Z",
    actor: { roleId: "reporter", displayName: "学生记者" },
    remainingMinutes: 42,
    scene: {
      sceneId: "xunpu-scene-topic-desk",
      title: "选题会现场",
      description: "比较两个选题角度并提交判断。",
      phase: "active",
      riskLevel: "low",
      stateTags: ["选题"],
    },
    hotspots: [],
    eventCards: [],
    currentAction: {
      actionRef: "xunpu-topic-compare-angles",
      sceneId: "xunpu-scene-topic-desk",
      label: "比较选题角度",
      description: "比较文化价值与传播热度。",
      expectedOutput: "选题比较卡",
      status: "ready",
      priority: "normal",
      sourceEventRefs: [],
    },
    evidenceRefs: [],
  })
);

async function createRouteApp() {
  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      reply.status(400).send({ error: "InvalidStudentTrainingContextRequest" });
      return;
    }
    reply.status(500).send({ error: "InternalError" });
  });
  const loadAuthorizedContext = vi.fn().mockResolvedValue(contextFixture());
  await registerStudentTrainingContextRoutes(app, { loadAuthorizedContext });
  return { app, loadAuthorizedContext };
}

const apps: Awaited<ReturnType<typeof createRouteApp>>["app"][] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("student-safe V2 training context route", () => {
  it("returns only the strict student training context", async () => {
    const context = await createRouteApp();
    apps.push(context.app);
    const response = await context.app.inject({
      method: "GET",
      url: "/api/sessions/session-xunpu-route/student-training-context?bindingId=binding-xunpu-reporter",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(contextFixture());
    expect(JSON.stringify(response.json())).not.toMatch(
      /RoleContract|privateScopes|toolPolicy|prompt|provider|trace/i,
    );
  });

  it("rejects forged actor and projection query before authorization", async () => {
    const context = await createRouteApp();
    apps.push(context.app);
    const response = await context.app.inject({
      method: "GET",
      url: "/api/sessions/session-xunpu-route/student-training-context?bindingId=binding-xunpu-reporter&actorKind=student&includeProjection=true",
    });
    expect(response.statusCode).toBe(400);
    expect(context.loadAuthorizedContext).not.toHaveBeenCalled();
  });
});
