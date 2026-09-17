import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { PermissionDeniedError } from "@ronggang/world-core";
import {
  FlagshipAssessmentErrorV4,
  type FlagshipAssessmentRecordV4,
} from "../src/flagship-assessment-v4.js";
import {
  registerFlagshipAssessmentV4Routes,
  type FlagshipAssessmentV4RouteDependencies,
} from "../src/flagship-assessment-v4-routes.js";

const apps: FastifyInstance[] = [];
const hashA = "a".repeat(64);
const hashB = "b".repeat(64);
const criterionIds = [
  "criterion-fact-verification",
  "criterion-interview-consent",
  "criterion-editorial-judgment",
  "criterion-rights-governance",
  "criterion-multiplatform-production",
  "criterion-recovery-transfer",
] as const;

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function fakeRecord(): FlagshipAssessmentRecordV4 {
  return {
    learnerActorId: "student-v4",
    learnerBindingId: "binding-student",
  } as FlagshipAssessmentRecordV4;
}

function routeDecision() {
  const evidenceRefs = criterionIds.map((_, index) => `evidence-route-${index + 1}`);
  return {
    schemaVersion: "evidence-assessment-decision/4.0.0",
    assessmentDecisionId: "assessment-v4-route",
    blindCaseRef: "blind-case-v4-route",
    blindInputHash: hashA,
    status: "provisional",
    assessorMode: "deterministic_fallback",
    rubricReviewStatus: "pending_expert_review",
    criterionAssessments: criterionIds.map((criterionId, index) => ({
      criterionId,
      evidenceStatus: "supported",
      band: "high",
      score: 86,
      confidence: 0.82,
      evidenceRefs: [evidenceRefs[index]!],
      rationale: "岗位行为、作品证据和世界后果形成独立证据。",
      surfaceSignalsUsed: false,
    })),
    sessionScore: 86,
    evidenceRefs,
    adviceAgentExcluded: true,
    challengeAppliedAfterBlindAssessment: true,
    challengeAdjustmentRef: "challenge-adjustment-v4-route",
    teacherReview: {
      status: "pending",
      teacherDecisionRef: null,
      rationale: null,
      reviewedAt: null,
    },
    generatedAt: "2026-08-31T00:00:00.000Z",
  } as const;
}

function routeView(record: FlagshipAssessmentRecordV4 | null, audience: "student" | "teacher" | "admin") {
  const decision = record ? routeDecision() : null;
  return {
    schemaVersion: "flagship-assessment-view/4.0.0",
    status: record ? "provisional" : "not_ready",
    safeMessage: record
      ? "六维盲化判断已形成，仍需课程教师逐维终裁。"
      : "至少需要一项已送审作品、真实行为、世界后果和可追溯证据。",
    decision,
    criteria: criterionIds.map((criterionId, index) => ({
      criterionId,
      title: `岗位能力维度 ${index + 1}`,
      evidenceStatus: record ? "supported" : "insufficient",
      band: record ? "high" : null,
      score: record ? 86 : null,
      confidence: record ? 0.82 : 0,
      rationale: record ? "岗位证据已形成。" : "尚未形成可评分证据。",
    })),
    evidenceCoverage: {
      artifactRevisionCount: record ? 1 : 0,
      claimLinkCount: record ? 1 : 0,
      behaviorCount: record ? 6 : 0,
      consequenceCount: record ? 1 : 0,
      recoveryPairCount: 0,
    },
    rubric: {
      version: "xunpu-rubric-v4-r1",
      reviewStatus: "pending_expert_review",
      classroomApplicabilityConfirmed: false,
      externalExpertValidityEstablished: false,
    },
    teacherReviewAllowed: record !== null && audience !== "student",
    audience,
  };
}

function routeAdminCase() {
  const decision = routeDecision();
  return {
    schemaVersion: "flagship-assessment-admin-case/4.0.0",
    sessionId: "session-v4-route",
    sourceHash: hashB,
    blindInput: {
      schemaVersion: "blind-evidence-assessment-input/4.0.0",
      blindCaseId: "blind-case-v4-route",
      flagshipContentHash: hashA,
      rubricVersion: "xunpu-rubric-v4-r1",
      rubricContentHash: hashB,
      rubricReviewStatus: "pending_expert_review",
      artifactRevisions: [{
        artifactRef: "artifact-v4-route",
        revisionRef: "revision-v4-route",
        contentHash: hashA,
      }],
      claimEvidenceLinks: [{
        claimRef: "revision-v4-route",
        evidenceRefs: ["evidence-route-1"],
        supportStatus: "supported",
        sourceCount: 1,
      }],
      behaviorEvidenceRefs: ["evidence-route-2"],
      worldConsequenceRefs: ["evidence-route-3"],
      scaffoldingEpisodeRefs: [],
      recoveryPairRefs: [],
      surfaceSignals: {
        textLength: 999,
        keywordMatchCount: 99,
        completionClickCount: 9,
        endingKind: "surface-only",
        allowedForScoring: false,
      },
      excludedContextFields: [
        "student_identity",
        "binding_id",
        "challenge_level",
        "agent_advice",
        "provider_and_model",
        "prompt_and_trace",
      ],
      inputHash: hashA,
      generatedAt: "2026-08-31T00:00:00.000Z",
    },
    evidenceFacts: [{
      evidenceRef: "evidence-route-1",
      sourceKind: "claim_evidence",
      evidenceCode: "verified_claim_supported",
      independenceKey: "independence-route-1",
      sourceContentHash: hashB,
    }],
    blindJudgments: decision.criterionAssessments,
    rawWeightedScore: 86,
    scoreCeiling: 90,
    qualityRuns: [{
      qualityRunRef: "quality-run-v4-route",
      inputHash: hashA,
      outputHash: hashB,
      mode: "deterministic_fallback",
      fallbackReason: "model_not_configured",
      providerId: null,
      modelId: null,
      traceRef: null,
      latencyMs: null,
      estimatedCostMicros: 0,
      createdAt: "2026-08-31T00:00:00.000Z",
    }],
    decisionHistory: [{ sourceHash: hashB, decision }],
    reviewReceipts: [],
    antiGaming: {
      adviceAgentExcluded: true,
      surfaceSignalsUsed: false,
      challengeAppliedAfterBlindAssessment: true,
    },
  };
}

async function setup(input?: { record?: FlagshipAssessmentRecordV4 | null }) {
  const record = input && "record" in input ? input.record! : fakeRecord();
  const reviewAssessment = vi.fn(async () => record as FlagshipAssessmentRecordV4);
  const assessment = {
    getAssessment: vi.fn(async () => record),
    getLearningObservations: vi.fn(async () => []),
    reviewAssessment,
    projectView: vi.fn(routeView),
    projectAdminCase: vi.fn(routeAdminCase),
  } as unknown as FlagshipAssessmentV4RouteDependencies["assessment"];
  let authorizeCalls = 0;
  const app = Fastify({ logger: false });
  apps.push(app);
  await registerFlagshipAssessmentV4Routes(app, {
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
        actorId: audience === "student" ? "student-v4" : `actor-${audience}`,
        bindingId,
      };
    },
  });
  app.setErrorHandler((error, _request, reply) => {
    const status = error instanceof z.ZodError
      ? 400
      : error instanceof PermissionDeniedError
        ? 403
        : error instanceof FlagshipAssessmentErrorV4
          ? error.code === "invalid_review" ? 400 : 409
          : 500;
    void reply.status(status).send({
      code: error instanceof FlagshipAssessmentErrorV4 ? error.code : null,
      message: error instanceof Error ? error.message : "unknown",
    });
  });
  return {
    app,
    assessment,
    reviewAssessment,
    authorizeCalls: () => authorizeCalls,
  };
}

describe("flagship V4 evidence assessment routes", () => {
  it("returns a role-safe not-ready state without exposing a stale V3 score", async () => {
    const { app } = await setup({ record: null });
    const response = await app.inject({
      method: "GET",
      url: "/api/v4/sessions/session-v4-route/evidence-assessment?bindingId=binding-student",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().assessment).toMatchObject({
      schemaVersion: "flagship-assessment-view/4.0.0",
      status: "not_ready",
      audience: "student",
      decision: null,
      rubric: { externalExpertValidityEstablished: false },
    });
  });

  it("allows teacher review only with explicit classroom applicability confirmation", async () => {
    const { app, reviewAssessment } = await setup();
    const payload = {
      bindingId: "binding-teacher",
      expectedAssessmentDecisionId: "assessment-v4-route",
      requestId: "request-v4-route-review",
      status: "confirmed",
      rubricApplicabilityConfirmed: true,
      reason: "我已逐维核对同一组盲化证据，并确认量规适用于本班本次训练。",
      criterionRevisions: [],
    };
    const reviewed = await app.inject({
      method: "POST",
      url: "/api/v4/sessions/session-v4-route/evidence-assessment-reviews",
      payload,
    });
    expect(reviewed.statusCode, reviewed.body).toBe(200);
    expect(reviewAssessment).toHaveBeenCalledWith(expect.objectContaining({
      reviewerId: "actor-teacher",
      rubricApplicabilityConfirmed: true,
    }));

    const student = await app.inject({
      method: "POST",
      url: "/api/v4/sessions/session-v4-route/evidence-assessment-reviews",
      payload: { ...payload, bindingId: "binding-student", requestId: "student-forgery" },
    });
    expect(student.statusCode).toBe(403);
  });

  it("keeps the full blind case administrator-only", async () => {
    const { app } = await setup();
    const admin = await app.inject({
      method: "GET",
      url: "/api/v4/admin/sessions/session-v4-route/evidence-assessment-case?bindingId=binding-admin",
    });
    expect(admin.statusCode).toBe(200);
    expect(admin.json().assessmentCase).toMatchObject({
      schemaVersion: "flagship-assessment-admin-case/4.0.0",
      antiGaming: { adviceAgentExcluded: true, surfaceSignalsUsed: false },
    });
    const teacher = await app.inject({
      method: "GET",
      url: "/api/v4/admin/sessions/session-v4-route/evidence-assessment-case?bindingId=binding-teacher",
    });
    expect(teacher.statusCode).toBe(403);
  });

  it("fails closed when an outbound projector drifts from the shared public contract", async () => {
    const { app, assessment } = await setup();
    vi.mocked(assessment.projectView).mockReturnValueOnce({
      ...routeView(fakeRecord(), "student"),
      leakedProviderContext: "must-never-cross-route",
    } as never);
    const response = await app.inject({
      method: "GET",
      url: "/api/v4/sessions/session-v4-route/evidence-assessment?bindingId=binding-student",
    });
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain("must-never-cross-route");
  });

  it("rejects forged query, score and missing confirmation before authorization", async () => {
    const { app, authorizeCalls } = await setup();
    const before = authorizeCalls();
    const forgedQuery = await app.inject({
      method: "GET",
      url: "/api/v4/sessions/session-v4-route/evidence-assessment?bindingId=binding-student&actorId=operator-demo",
    });
    expect(forgedQuery.statusCode).toBe(400);
    expect(authorizeCalls()).toBe(before);

    const forgedBody = await app.inject({
      method: "POST",
      url: "/api/v4/sessions/session-v4-route/evidence-assessment-reviews",
      payload: {
        bindingId: "binding-teacher",
        expectedAssessmentDecisionId: "assessment-v4-route",
        requestId: "request-v4-forged-score",
        status: "confirmed",
        rubricApplicabilityConfirmed: true,
        reason: "浏览器不应能够直接提交总分或覆盖证据判断。",
        criterionRevisions: [],
        sessionScore: 100,
      },
    });
    expect(forgedBody.statusCode).toBe(400);
    expect(authorizeCalls()).toBe(before);

    const noConfirmation = await app.inject({
      method: "POST",
      url: "/api/v4/sessions/session-v4-route/evidence-assessment-reviews",
      payload: {
        bindingId: "binding-teacher",
        expectedAssessmentDecisionId: "assessment-v4-route",
        requestId: "request-v4-no-confirmation",
        status: "confirmed",
        reason: "没有本班量规适用性确认时不能形成最终评价。",
        criterionRevisions: [],
      },
    });
    expect(noConfirmation.statusCode).toBe(400);
    expect(authorizeCalls()).toBe(before);
  });
});
