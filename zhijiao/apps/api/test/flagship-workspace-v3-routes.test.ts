import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { xunpuFlagshipContentManifestV3 } from "@ronggang/course-content";
import {
  FlagshipStudentWorkErrorV3,
  FlagshipStudentWorkServiceV3,
  InMemoryFlagshipStudentWorkStoreV3,
} from "../src/flagship-student-work-v3.js";
import { registerFlagshipWorkspaceV3Routes } from "../src/flagship-workspace-v3-routes.js";
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
    now: () => "2026-08-26T09:00:00.000Z",
  });
  await registerFlagshipWorkspaceV3Routes(app, {
    engine: runtime.engine,
    work,
    authorize: ({ bindingId }) => {
      authorizeCalls += 1;
      const audience = bindingId === "binding-teacher" ? "teacher" as const : "student" as const;
      return {
        audience,
        principalId: audience === "student" ? "principal-student" : "principal-teacher",
        actorId: audience === "student" ? "student-reporter" : "teacher-main",
        bindingId,
      };
    },
  });
  app.setErrorHandler((error, _request, reply) => {
    const status = error instanceof z.ZodError
      ? 400
      : error instanceof FlagshipStudentWorkErrorV3
        ? error.code === "access_denied"
          ? 403
          : error.code === "invalid_revision"
            ? 400
            : 409
        : 403;
    void reply.status(status).send({
      message: error instanceof Error ? error.message : "unknown",
    });
  });
  return { app, authorizeCalls: () => authorizeCalls };
}

describe("flagship workspace V3 routes", () => {
  it("returns a student-safe workspace and rejects staff or forged query fields", async () => {
    const sessionId = "session-workspace-route-safe";
    const { app, authorizeCalls } = await appFor(sessionId);
    const student = await app.inject({
      method: "GET",
      url: `/api/v3/sessions/${sessionId}/workspace?bindingId=binding-student`,
    });
    expect(student.statusCode).toBe(200);
    expect(student.json().workspace.artifacts).toHaveLength(9);
    expect(JSON.stringify(student.json())).not.toContain("traceRef");
    expect(JSON.stringify(student.json())).not.toContain("prompt");

    const teacher = await app.inject({
      method: "GET",
      url: `/api/v3/sessions/${sessionId}/workspace?bindingId=binding-teacher`,
    });
    expect(teacher.statusCode).toBe(403);
    const callsBeforeForgery = authorizeCalls();
    const forged = await app.inject({
      method: "GET",
      url: `/api/v3/sessions/${sessionId}/workspace?bindingId=binding-student&actorId=forged-admin`,
    });
    expect(forged.statusCode).toBe(400);
    expect(authorizeCalls()).toBe(callsBeforeForgery);
  });

  it("saves one real server revision and rejects an unknown evidence reference", async () => {
    const sessionId = "session-workspace-route-save";
    const { app } = await appFor(sessionId);
    const initial = await app.inject({
      method: "GET",
      url: `/api/v3/sessions/${sessionId}/workspace?bindingId=binding-student`,
    });
    const workspace = initial.json().workspace;
    const artifact = workspace.artifacts[0] as {
      artifactId: string;
      editableFields: Array<{ fieldId: string }>;
    };
    const body = {
      bindingId: "binding-student",
      requestId: "request-route-work-r1",
      expectedRevisionNumber: 0,
      fields: artifact.editableFields.map((field, index) => ({
        fieldId: field.fieldId,
        content: index === 0 ? "这是学生自己写下的真实选题判断。" : "",
      })),
      evidenceRefs: [workspace.evidenceCatalog[0].evidenceRef],
      revisionNote: "建立第一版真实作品",
    };
    const saved = await app.inject({
      method: "POST",
      url: `/api/v3/sessions/${sessionId}/workspace/artifacts/${artifact.artifactId}/revisions`,
      payload: body,
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().workspace.artifacts[0]).toMatchObject({
      status: "draft",
      revisionCount: 1,
      latestRevision: { parentRevisionId: null },
    });

    const forged = await app.inject({
      method: "POST",
      url: `/api/v3/sessions/${sessionId}/workspace/artifacts/${artifact.artifactId}/revisions`,
      payload: {
        ...body,
        requestId: "request-route-work-forged-evidence",
        expectedRevisionNumber: 1,
        evidenceRefs: ["private-agent-trace"],
      },
    });
    expect(forged.statusCode).toBe(400);
  });
});
