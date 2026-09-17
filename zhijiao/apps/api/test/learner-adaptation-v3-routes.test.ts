import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { PermissionDeniedError } from "@ronggang/world-core";
import { LearnerAdaptationErrorV3 } from "../src/learner-adaptation-v3.js";
import {
  registerLearnerAdaptationV3Routes,
  type LearnerAdaptationV3RouteDependencies,
} from "../src/learner-adaptation-v3-routes.js";

const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function safeGrowth(audience: "student" | "teacher") {
  return {
    schemaVersion: "learner-growth-view/3.0.0",
    audience,
    state: "ready",
    boundaries: {
      evidenceOnly: true,
      immutablePersonalityLabelsForbidden: true,
      sensitiveAttributesExcluded: true,
      proxyCanActForStudent: false,
      proxyCanCreateEvidence: false,
      proxyCanScoreStudent: false,
      teacherControlsActivation: true,
    },
    profile: { revision: 2, confidence: 0.82 },
    forecast: { calibrationStatus: "pending" },
    nextChallenge: { challengeLevel: 5, scoreCeiling: 90 },
    learningPlan: { status: "proposed" },
  };
}

async function appFor() {
  const app = Fastify({ logger: false });
  apps.push(app);
  let authorizeCalls = 0;
  const snapshot = {
    assessment: { learnerActorId: "student-adaptation-route" },
  };
  const adaptation = {
    getOrRefresh: vi.fn(async () => snapshot as never),
    requestAppeal: vi.fn(async () => snapshot as never),
    reviewAdaptation: vi.fn(async () => snapshot as never),
    projectGrowth: vi.fn((_, audience: "student" | "teacher") => (
      safeGrowth(audience)
    )),
    projectAdminCase: vi.fn(() => ({
      schemaVersion: "learner-adaptation-case-view/3.0.0",
      state: "available",
      boundaries: {
        rawLearnerIdentityStored: false,
        sensitiveAttributesExcluded: true,
        proxyCanActForStudent: false,
        proxyCanCreateEvidence: false,
        proxyCanScoreStudent: false,
      },
      learnerTwinId: "learner-twin-route",
      principalBindingHash: "a".repeat(64),
      forecasts: [{
        evidenceEligible: false,
        canActForStudent: false,
        canScoreStudent: false,
      }],
    })),
  } as unknown as LearnerAdaptationV3RouteDependencies["adaptation"];
  await registerLearnerAdaptationV3Routes(app, {
    adaptation,
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
        actorId: audience === "student"
          ? "student-adaptation-route"
          : `actor-${audience}`,
        bindingId,
      };
    },
  });
  app.setErrorHandler((error, _request, reply) => {
    const status = error instanceof z.ZodError
      ? 400
      : error instanceof PermissionDeniedError
        ? 403
        : error instanceof LearnerAdaptationErrorV3
          ? error.code === "not_found"
            ? 404
            : error.code === "invalid_decision"
              ? 400
              : 409
          : 500;
    void reply.status(status).send({
      message: error instanceof Error ? error.message : "unknown",
    });
  });
  return { app, adaptation, authorizeCalls: () => authorizeCalls };
}

describe("learner adaptation V3 routes", () => {
  it("returns role-safe learner growth to the student and teacher only", async () => {
    const { app } = await appFor();
    const student = await app.inject({
      method: "GET",
      url: "/api/v3/sessions/session-adaptation/learner-growth?bindingId=binding-student",
    });
    expect(student.statusCode).toBe(200);
    expect(student.json().growth).toMatchObject({
      schemaVersion: "learner-growth-view/3.0.0",
      audience: "student",
      boundaries: {
        proxyCanActForStudent: false,
        proxyCanCreateEvidence: false,
        proxyCanScoreStudent: false,
      },
    });
    const serialized = JSON.stringify(student.json());
    for (const forbidden of [
      "principalBindingHash",
      "modelContentHash",
      "policyContentHash",
      "actorId",
      "provider",
      "prompt",
      "trace",
    ]) expect(serialized).not.toContain(forbidden);

    const teacher = await app.inject({
      method: "GET",
      url: "/api/v3/sessions/session-adaptation/learner-growth?bindingId=binding-teacher",
    });
    expect(teacher.statusCode).toBe(200);
    expect(teacher.json().growth.audience).toBe("teacher");

    const admin = await app.inject({
      method: "GET",
      url: "/api/v3/sessions/session-adaptation/learner-growth?bindingId=binding-admin",
    });
    expect(admin.statusCode).toBe(403);
  });

  it("lets only the student request an appeal and only teacher/admin decide adaptation", async () => {
    const { app, adaptation } = await appFor();
    const appealed = await app.inject({
      method: "POST",
      url: "/api/v3/sessions/session-adaptation/learner-growth/appeals",
      payload: {
        bindingId: "binding-student",
        requestId: "request-route-appeal",
        reason: "本轮网络中断导致作品证据没有完整进入画像，请教师复核。",
      },
    });
    expect(appealed.statusCode).toBe(200);
    expect(adaptation.requestAppeal).toHaveBeenCalledWith(expect.objectContaining({
      learnerActorId: "student-adaptation-route",
    }));
    const teacherAppeal = await app.inject({
      method: "POST",
      url: "/api/v3/sessions/session-adaptation/learner-growth/appeals",
      payload: {
        bindingId: "binding-teacher",
        requestId: "request-route-appeal-teacher",
        reason: "教师试图代替学生提交画像申诉，应被权限边界拒绝。",
      },
    });
    expect(teacherAppeal.statusCode).toBe(403);

    const decided = await app.inject({
      method: "POST",
      url: "/api/v3/sessions/session-adaptation/learner-adaptation-decisions",
      payload: {
        bindingId: "binding-teacher",
        requestId: "request-route-confirm-plan",
        expectedProfileRevision: 2,
        action: "confirm_plan",
        reason: "方案目标与本轮真实证据一致，确认作为下一轮训练方案。",
      },
    });
    expect(decided.statusCode).toBe(200);
    const forgedStudent = await app.inject({
      method: "POST",
      url: "/api/v3/sessions/session-adaptation/learner-adaptation-decisions",
      payload: {
        bindingId: "binding-student",
        requestId: "request-route-forged-student-decision",
        expectedProfileRevision: 2,
        action: "confirm_plan",
        reason: "学生试图自行确认系统成长方案，应被权限边界拒绝。",
      },
    });
    expect(forgedStudent.statusCode).toBe(403);
  });

  it("discloses full hashes and proxy calibration only through the admin case", async () => {
    const { app } = await appFor();
    const admin = await app.inject({
      method: "GET",
      url: "/api/v3/admin/sessions/session-adaptation/learner-adaptation-case?bindingId=binding-admin",
    });
    expect(admin.statusCode).toBe(200);
    expect(admin.json().adaptationCase).toMatchObject({
      schemaVersion: "learner-adaptation-case-view/3.0.0",
      boundaries: {
        rawLearnerIdentityStored: false,
        proxyCanActForStudent: false,
        proxyCanCreateEvidence: false,
        proxyCanScoreStudent: false,
      },
      principalBindingHash: "a".repeat(64),
    });
    const teacher = await app.inject({
      method: "GET",
      url: "/api/v3/admin/sessions/session-adaptation/learner-adaptation-case?bindingId=binding-teacher",
    });
    expect(teacher.statusCode).toBe(403);
  });

  it("rejects forged query/body fields before authorization", async () => {
    const { app, authorizeCalls } = await appFor();
    const before = authorizeCalls();
    const forgedQuery = await app.inject({
      method: "GET",
      url: "/api/v3/sessions/session-adaptation/learner-growth?bindingId=binding-student&learnerTwinId=forged",
    });
    expect(forgedQuery.statusCode).toBe(400);
    expect(authorizeCalls()).toBe(before);

    const forgedBody = await app.inject({
      method: "POST",
      url: "/api/v3/sessions/session-adaptation/learner-adaptation-decisions",
      payload: {
        bindingId: "binding-teacher",
        requestId: "request-route-forged-body",
        expectedProfileRevision: 2,
        action: "override_challenge",
        challengeLevel: 7,
        reason: "试图同时传入浏览器伪造的画像和预测引用，应在授权前拒绝。",
        learnerTwinRef: "forged",
        forecastRef: "forged",
      },
    });
    expect(forgedBody.statusCode).toBe(400);
    expect(authorizeCalls()).toBe(before);
  });
});
