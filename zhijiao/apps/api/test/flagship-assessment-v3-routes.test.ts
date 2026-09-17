import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { PermissionDeniedError } from "@ronggang/world-core";
import { xunpuFlagshipContentManifestV3 } from "@ronggang/course-content";
import {
  FlagshipAssessmentErrorV3,
  FlagshipCompetencyAssessmentServiceV3,
  InMemoryFlagshipAssessmentStoreV3,
} from "../src/flagship-assessment-v3.js";
import { registerFlagshipAssessmentV3Routes } from "../src/flagship-assessment-v3-routes.js";
import {
  FlagshipStudentWorkServiceV3,
  InMemoryFlagshipStudentWorkStoreV3,
} from "../src/flagship-student-work-v3.js";
import { createV3WorldTestRuntime } from "./world-simulation-v3.fixture.js";

const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function appFor(sessionId: string) {
  const runtime = await createV3WorldTestRuntime(sessionId);
  const work = new FlagshipStudentWorkServiceV3({
    store: new InMemoryFlagshipStudentWorkStoreV3(),
    manifest: xunpuFlagshipContentManifestV3,
  });
  const assessment = new FlagshipCompetencyAssessmentServiceV3({
    engine: runtime.engine,
    orchestrator: runtime.orchestrator,
    work,
    manifest: xunpuFlagshipContentManifestV3,
    store: new InMemoryFlagshipAssessmentStoreV3(),
    now: () => "2026-08-26T05:00:00.000Z",
  });
  const app = Fastify({ logger: false });
  apps.push(app);
  let authorizeCalls = 0;
  await registerFlagshipAssessmentV3Routes(app, {
    assessment,
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
        actorId: audience === "student" ? "student-assessment" : `actor-${audience}`,
        bindingId,
      };
    },
  });
  app.setErrorHandler((error, _request, reply) => {
    const status = error instanceof z.ZodError
      ? 400
      : error instanceof PermissionDeniedError
        ? 403
        : error instanceof FlagshipAssessmentErrorV3
          ? error.code === "not_found"
            ? 404
            : error.code === "invalid_review"
              ? 400
              : 409
          : 500;
    void reply.status(status).send({
      code: error instanceof FlagshipAssessmentErrorV3 ? error.code : null,
      message: error instanceof Error ? error.message : "unknown",
    });
  });
  return { app, assessment, authorizeCalls: () => authorizeCalls };
}

describe("flagship V3 assessment routes", () => {
  it("returns role-safe evidence and keeps missing evidence scoreless", async () => {
    const sessionId = "session-assessment-route";
    const { app } = await appFor(sessionId);
    const student = await app.inject({
      method: "GET",
      url: `/api/v3/sessions/${sessionId}/competency-evidence?bindingId=binding-student`,
    });
    expect(student.statusCode).toBe(200);
    expect(student.json().evidence).toMatchObject({
      schemaVersion: "flagship-competency-evidence-view/3.0.0",
      audience: "student",
      assessmentBoundary: {
        artifactCompletionIsNotCompetencyScore: true,
        evidenceInsufficientMeansNoScore: true,
        finalAuthority: "teacher",
      },
      assessment: {
        scoreStatus: "insufficient_evidence",
        sessionScore: null,
      },
    });
    const serialized = JSON.stringify(student.json());
    for (const forbidden of [
      "semanticReceipts",
      "scoreComputations",
      "Trace",
      "Prompt",
      "privateMemory",
      "provider",
      "token",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }

    const teacher = await app.inject({
      method: "GET",
      url: `/api/v3/sessions/${sessionId}/competency-evidence?bindingId=binding-teacher`,
    });
    expect(teacher.statusCode).toBe(200);
    expect(teacher.json().evidence.audience).toBe("teacher");
  });

  it("lets only teacher/admin confirm an evidence-insufficient case without fabricating a score", async () => {
    const sessionId = "session-assessment-route-review";
    const { app } = await appFor(sessionId);
    const studentEvidence = await app.inject({
      method: "GET",
      url: `/api/v3/sessions/${sessionId}/competency-evidence?bindingId=binding-student`,
    });
    const decisionId = studentEvidence.json().evidence.assessment.assessmentDecisionId;
    const body = {
      bindingId: "binding-teacher",
      expectedAssessmentDecisionId: decisionId,
      requestId: "request-route-review",
      status: "confirmed",
      reason: "已逐项查看当前真实证据，确认维持证据不足，不形成数值分数。",
      competencyRevisions: [],
    };
    const teacher = await app.inject({
      method: "POST",
      url: `/api/v3/sessions/${sessionId}/assessment-decisions`,
      payload: body,
    });
    expect(teacher.statusCode).toBe(200);
    expect(teacher.json().evidence.assessment).toMatchObject({
      scoreStatus: "insufficient_evidence",
      sessionScore: null,
      teacherReview: { status: "confirmed" },
    });

    const student = await app.inject({
      method: "POST",
      url: `/api/v3/sessions/${sessionId}/assessment-decisions`,
      payload: { ...body, bindingId: "binding-student", requestId: "student-forgery" },
    });
    expect(student.statusCode).toBe(403);
  });

  it("exposes de-identified semantic receipts and recomputation only to administrators", async () => {
    const sessionId = "session-assessment-route-admin";
    const { app } = await appFor(sessionId);
    await app.inject({
      method: "GET",
      url: `/api/v3/sessions/${sessionId}/competency-evidence?bindingId=binding-student`,
    });
    const admin = await app.inject({
      method: "GET",
      url: `/api/v3/admin/sessions/${sessionId}/assessment-case?bindingId=binding-admin`,
    });
    expect(admin.statusCode).toBe(200);
    expect(admin.json().assessmentCase).toMatchObject({
      schemaVersion: "flagship-assessment-case-view/3.0.0",
      assessmentBoundary: {
        evaluatorSeesIdentity: false,
        evaluatorSeesChallengeLevel: false,
        evaluatorSeesAgentAdvice: false,
        completionIsScore: false,
      },
      recomputation: {
        sourceHashAlgorithm: "sha256-canonical-json",
        semanticInputHashRecorded: true,
        challengeAppliedAfterBlindEvaluation: true,
      },
    });
    const teacher = await app.inject({
      method: "GET",
      url: `/api/v3/admin/sessions/${sessionId}/assessment-case?bindingId=binding-teacher`,
    });
    expect(teacher.statusCode).toBe(403);
  });

  it("rejects forged query/body fields before authorization", async () => {
    const sessionId = "session-assessment-route-strict";
    const { app, authorizeCalls } = await appFor(sessionId);
    const before = authorizeCalls();
    const forgedQuery = await app.inject({
      method: "GET",
      url: `/api/v3/sessions/${sessionId}/competency-evidence?bindingId=binding-student&actorId=forged`,
    });
    expect(forgedQuery.statusCode).toBe(400);
    expect(authorizeCalls()).toBe(before);

    const forgedBody = await app.inject({
      method: "POST",
      url: `/api/v3/sessions/${sessionId}/assessment-decisions`,
      payload: {
        bindingId: "binding-teacher",
        expectedAssessmentDecisionId: "assessment-forged",
        requestId: "request-forged-body",
        status: "confirmed",
        reason: "这是包含浏览器伪造分数的非法教师复核请求。",
        competencyRevisions: [],
        score: 100,
      },
    });
    expect(forgedBody.statusCode).toBe(400);
    expect(authorizeCalls()).toBe(before);
  });
});
