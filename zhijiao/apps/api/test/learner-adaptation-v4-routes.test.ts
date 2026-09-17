import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { PermissionDeniedError } from "@ronggang/world-core";
import {
  LearnerAdaptationErrorV4,
  type LearnerAdaptationRecordV4,
} from "../src/learner-adaptation-v4.js";
import {
  registerLearnerAdaptationV4Routes,
  type LearnerAdaptationV4RouteDependencies,
} from "../src/learner-adaptation-v4-routes.js";

const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function publicView(audience: "student" | "teacher") {
  return {
    schemaVersion: "learner-adaptation-view/4.0.0",
    audience,
    state: "evidence_required",
    safeMessage: "最终评价证据尚未形成，第二场不会提前生成。",
    boundaries: {
      observableEvidenceOnly: true,
      immutablePersonalityLabelsForbidden: true,
      sensitiveAttributesExcluded: true,
      studentConsentRequired: true,
      teacherAuthorizationRequired: true,
      proxyCanActForStudent: false,
      proxyCanCreateEvidence: false,
      proxyCanScoreStudent: false,
      calibrationEvidenceEligibleForScore: false,
    },
    learnerModel: null,
    forecast: null,
    proposal: null,
    consent: null,
    appeal: null,
    handoff: null,
    nextAction: "先完成真实岗位任务与教师最终评价。",
  };
}

const hashA = "a".repeat(64);
const hashB = "b".repeat(64);
const hashC = "c".repeat(64);
const criterionIds = [
  "criterion-fact-verification",
  "criterion-interview-consent",
  "criterion-editorial-judgment",
  "criterion-rights-governance",
  "criterion-multiplatform-production",
  "criterion-recovery-transfer",
] as const;

function adminCase() {
  return {
    schemaVersion: "learner-adaptation-admin-case/4.0.0",
    sourceSessionId: "session-source",
    learnerSubjectHash: hashA,
    sourceAssessmentDecisionRef: "assessment-final-route-v4",
    sourceAssessmentHash: hashB,
    learnerTwin: {
      learnerTwinRef: "learner-twin-route-v4",
      revision: 1,
      sourceAssessmentDecisionRef: "assessment-final-route-v4",
      criterionStates: criterionIds.map((criterionId, index) => ({
        criterionId,
        evidenceStatus: "supported" as const,
        band: index < 2 ? "low" as const : "high" as const,
        score: index < 2 ? 58 : 86,
        confidence: 0.82,
        evidenceRefs: [`evidence-${index}`],
        supportEvidenceRefs: [`evidence-${index}`],
        counterEvidenceRefs: [],
        uncertaintyDrivers: [],
        lastPredictionError: null,
      })),
      growthTargetRefs: [criterionIds[0]],
      sourceChallengeLevel: 4,
      sourceScaffoldingLevel: 2,
      calibrationCount: 0,
      calibrationHistory: [],
      limitations: [
        "该模型只描述当前证据支持的可观察岗位表现，不是固定人格或能力定型。",
      ],
      contentHash: hashC,
      updatedAt: "2026-08-29T08:00:00.000Z",
    },
    forecast: {
      forecastRef: "forecast-route-v4",
      revision: 1,
      assessorMode: "deterministic_fallback" as const,
      learnerTwinContentHash: hashC,
      candidates: [
        "source-triangulation",
        "consent-negotiation",
        "deadline-service",
        "editorial-independence",
      ].map((kind, index) => ({
        variantRef: `variant-xunpu-${kind}`,
        predictedSuccessProbability: 0.6 + index * 0.03,
        predictedOverloadProbability: 0.28,
        predictedGrowthValue: 0.72,
        rationale: index === 0 ? "直接针对最低证据维度。" : "保留为反事实候选。",
      })),
      selectedVariantRef: "variant-xunpu-source-triangulation",
      evidenceEligibleForScore: false as const,
      canActForStudent: false as const,
      generatedAt: "2026-08-29T08:01:00.000Z",
    },
    consent: { status: "pending" as const, requestId: null, decidedAt: null },
    appeal: {
      status: "none" as const,
      appealRef: null,
      reason: null,
      resolution: null,
      teacherReason: null,
      openedAt: null,
      resolvedAt: null,
    },
    handoff: {
      schemaVersion: "second-session-handoff/4.0.0",
      handoffId: "handoff-route-v4",
      learnerSubjectHash: hashA,
      learnerTwinRef: "learner-twin-route-v4",
      learnerTwinContentHash: hashC,
      sourceSessionId: "session-source",
      sourceAssessmentDecisionRef: "assessment-final-route-v4",
      flagshipContentRef: {
        schemaVersion: "flagship-content-reference/4.0.0",
        contentSchemaVersion: "xunpu-flagship-content/4.0.0",
        courseReleaseRef: {
          courseId: "course-xunpu-intangible-media",
          releaseId: "course-xunpu-r4",
          version: 4,
          contentHash: hashA,
        },
        scenarioReleaseRef: {
          scenarioId: "scenario-xunpu-living-world",
          version: "4.0.0",
          contentHash: hashB,
        },
        simulationReleaseRef: {
          simulationId: "simulation-xunpu-living-world",
          releaseId: "simulation-xunpu-r4",
          version: 4,
          contentHash: hashC,
        },
        contentHash: hashA,
      },
      createdAt: "2026-08-29T08:01:00.000Z",
      status: "proposed" as const,
      reasonCode: null,
      proposal: {
        variantRef: "variant-xunpu-source-triangulation",
        sourceChallengeLevel: 4,
        targetChallengeLevel: 4,
        changedMechanics: [
          {
            mechanicKind: "event_templates" as const,
            beforeHash: hashA,
            afterHash: hashB,
            safeSummary: "冲突事件集合改变。",
          },
          {
            mechanicKind: "npc_resistance" as const,
            beforeHash: hashB,
            afterHash: hashC,
            safeSummary: "NPC 阻力改变。",
          },
        ],
        growthTargetRefs: [criterionIds[0]],
        forecastRef: "forecast-route-v4",
        learnerConsentRequired: true as const,
      },
      teacherAuthorizationRef: null,
      provision: null,
      calibration: null,
      failure: null,
      writeDisposition: "candidate_only" as const,
    },
    proxyRuns: [],
    requestReceipts: [],
    boundaries: {
      rawLearnerIdentityStored: false as const,
      rawStudentUtteranceStored: false as const,
      sensitiveAttributesExcluded: true as const,
      proxyCanActForStudent: false as const,
      proxyCanCreateEvidence: false as const,
      proxyCanScoreStudent: false as const,
      calibrationEvidenceEligibleForScore: false as const,
    },
  };
}

async function appFor() {
  const app = Fastify({ logger: false });
  apps.push(app);
  let authorizeCalls = 0;
  const record = {
    learnerBindingId: "binding-student",
    learnerActorId: "student-reporter",
  } as LearnerAdaptationRecordV4;
  const adaptation = {
    getOrRefresh: vi.fn(async () => record),
    recordConsent: vi.fn(async () => record),
    requestAppeal: vi.fn(async () => record),
    reviewAppeal: vi.fn(async () => record),
    authorizeAndProvision: vi.fn(async () => record),
    projectView: vi.fn((_: unknown, audience: "student" | "teacher") => publicView(audience)),
    projectAdminCase: vi.fn(() => adminCase()),
  } as unknown as LearnerAdaptationV4RouteDependencies["adaptation"];
  await registerLearnerAdaptationV4Routes(app, {
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
        actorId: audience === "student" ? "student-reporter" : `actor-${audience}`,
        bindingId,
      };
    },
  });
  app.setErrorHandler((error, _request, reply) => {
    const status = error instanceof z.ZodError
      ? 400
      : error instanceof PermissionDeniedError
        ? 403
        : error instanceof LearnerAdaptationErrorV4
          ? error.code === "not_ready" ? 404 : error.code === "access_denied" ? 403 : 409
          : 500;
    void reply.status(status).send({
      code: error instanceof LearnerAdaptationErrorV4 ? error.code : null,
      message: error instanceof Error ? error.message : "unknown",
    });
  });
  return { app, adaptation, authorizeCalls: () => authorizeCalls };
}

describe("learner adaptation V4 routes", () => {
  it("returns only a role-safe public view to the learner and teacher", async () => {
    const { app } = await appFor();
    const student = await app.inject({
      method: "GET",
      url: "/api/v4/sessions/session-source/learner-adaptation?bindingId=binding-student",
    });
    expect(student.statusCode).toBe(200);
    expect(student.json().adaptation).toMatchObject({
      audience: "student",
      boundaries: { immutablePersonalityLabelsForbidden: true },
    });
    const teacher = await app.inject({
      method: "GET",
      url: "/api/v4/sessions/session-source/learner-adaptation?bindingId=binding-teacher",
    });
    expect(teacher.statusCode).toBe(200);
    expect(teacher.json().adaptation.audience).toBe("teacher");
    const admin = await app.inject({
      method: "GET",
      url: "/api/v4/sessions/session-source/learner-adaptation?bindingId=binding-admin",
    });
    expect(admin.statusCode).toBe(403);
  });

  it("fails closed when the outbound public projection drifts", async () => {
    const { app, adaptation } = await appFor();
    vi.mocked(adaptation.projectView).mockReturnValueOnce({
      ...publicView("student"),
      leakedInternalField: "must-not-cross-the-route-boundary",
    } as never);

    const response = await app.inject({
      method: "GET",
      url: "/api/v4/sessions/session-source/learner-adaptation?bindingId=binding-student",
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain("must-not-cross-the-route-boundary");
  });

  it("lets only the learner consent or appeal", async () => {
    const { app, adaptation } = await appFor();
    const consent = await app.inject({
      method: "POST",
      url: "/api/v4/sessions/session-source/learner-adaptation-consents",
      payload: {
        bindingId: "binding-student",
        requestId: "request-route-consent",
        accepted: true,
      },
    });
    expect(consent.statusCode).toBe(200);
    expect(adaptation.recordConsent).toHaveBeenCalledWith(expect.objectContaining({
      learnerActorId: "student-reporter",
      accepted: true,
    }));
    const forgedTeacher = await app.inject({
      method: "POST",
      url: "/api/v4/sessions/session-source/learner-adaptation-consents",
      payload: {
        bindingId: "binding-teacher",
        requestId: "request-route-consent-teacher",
        accepted: true,
      },
    });
    expect(forgedTeacher.statusCode).toBe(403);
    const appeal = await app.inject({
      method: "POST",
      url: "/api/v4/sessions/session-source/learner-adaptation-appeals",
      payload: {
        bindingId: "binding-student",
        requestId: "request-route-appeal",
        reason: "本轮有一条来源证据遗漏，请教师按原始记录重新核对。",
      },
    });
    expect(appeal.statusCode).toBe(200);
    expect(adaptation.requestAppeal).toHaveBeenCalledTimes(1);
  });

  it("lets only teacher/admin review appeals and authorize a real second session", async () => {
    const { app, adaptation } = await appFor();
    const unauthorized = await app.inject({
      method: "POST",
      url: "/api/v4/sessions/session-source/second-session-authorizations",
      payload: {
        bindingId: "binding-student",
        requestId: "request-student-authorizes",
        expectedHandoffId: "handoff-route-v4",
      },
    });
    expect(unauthorized.statusCode).toBe(403);
    const authorized = await app.inject({
      method: "POST",
      url: "/api/v4/sessions/session-source/second-session-authorizations",
      payload: {
        bindingId: "binding-teacher",
        requestId: "request-teacher-authorizes",
        expectedHandoffId: "handoff-route-v4",
      },
    });
    expect(authorized.statusCode).toBe(200);
    expect(adaptation.authorizeAndProvision).toHaveBeenCalledWith(expect.objectContaining({
      teacherActorId: "actor-teacher",
    }));
    const review = await app.inject({
      method: "POST",
      url: "/api/v4/sessions/session-source/learner-adaptation-appeal-reviews",
      payload: {
        bindingId: "binding-admin",
        requestId: "request-admin-review",
        expectedAppealRef: "appeal-route-v4",
        resolution: "confirmed",
        reason: "管理员代课程教师演示逐项复核证据并维持当前训练靶点。",
      },
    });
    expect(review.statusCode).toBe(200);
    expect(adaptation.reviewAppeal).toHaveBeenCalledTimes(1);
  });

  it("exposes hashes only in the admin audit endpoint", async () => {
    const { app } = await appFor();
    const admin = await app.inject({
      method: "GET",
      url: "/api/v4/admin/sessions/session-source/learner-adaptation-case?bindingId=binding-admin",
    });
    expect(admin.statusCode).toBe(200);
    expect(admin.json().adaptationCase).toMatchObject({
      learnerSubjectHash: "a".repeat(64),
      boundaries: { rawLearnerIdentityStored: false },
    });
    const teacher = await app.inject({
      method: "GET",
      url: "/api/v4/admin/sessions/session-source/learner-adaptation-case?bindingId=binding-teacher",
    });
    expect(teacher.statusCode).toBe(403);
  });

  it("rejects forged browser fields before authorization", async () => {
    const { app, authorizeCalls } = await appFor();
    const before = authorizeCalls();
    const query = await app.inject({
      method: "GET",
      url: "/api/v4/sessions/session-source/learner-adaptation?bindingId=binding-student&learnerActorId=forged",
    });
    expect(query.statusCode).toBe(400);
    expect(authorizeCalls()).toBe(before);
    const body = await app.inject({
      method: "POST",
      url: "/api/v4/sessions/session-source/second-session-authorizations",
      payload: {
        bindingId: "binding-teacher",
        requestId: "request-forged-body",
        expectedHandoffId: "handoff-route-v4",
        learnerTwinRef: "forged",
        targetChallengeLevel: 7,
      },
    });
    expect(body.statusCode).toBe(400);
    expect(authorizeCalls()).toBe(before);
  });
});
