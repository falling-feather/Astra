import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import type { DemoAuthContext } from "../src/identity.js";
import { createApp, DEMO_XUNPU_SESSION_ID } from "../src/server.js";

const localOrigin = "http://localhost:5173";
let app: FastifyInstance | null = null;
let dataDir: string | null = null;

afterEach(async () => {
  await app?.close();
  app = null;
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
  dataDir = null;
});

async function login(
  target: FastifyInstance,
  profileId: string,
  sessionId?: string,
) {
  const response = await target.inject({
    method: "POST",
    url: "/api/auth/demo-session",
    headers: { origin: localOrigin },
    payload: { profileId, ...(sessionId ? { sessionId } : {}) },
  });
  expect(response.statusCode).toBe(200);
  const auth = response.json() as DemoAuthContext;
  const rawCookie = Array.isArray(response.headers["set-cookie"])
    ? response.headers["set-cookie"][0]
    : response.headers["set-cookie"];
  if (!rawCookie) throw new Error("V3 integration login cookie missing");
  return {
    auth,
    cookie: rawCookie.split(";")[0]!,
  };
}

function appOptions(directory: string) {
  return {
    dataDir: directory,
    logger: false,
    initializeSecondaryDemo: false,
    awaitStartupRecovery: true,
    environment: {
      NODE_ENV: "test",
      IFLYTEK_MODE: "mock",
      DEEPSEEK_MODE: "mock",
    },
  } as const;
}

describe("V3 flagship world public wiring", () => {
  it("opens from a real course claim, preserves role boundaries and survives restart", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "ronggang-v3-public-"));
    app = await createApp(appOptions(dataDir));
    const learner = await login(app, "student-unassigned");
    const catalog = await app.inject({ method: "GET", url: "/api/courses" });
    const xunpu = catalog.json().courses.find((course: { courseId: string }) => (
      course.courseId === "course-xunpu-intangible-media"
    ));
    const claim = await app.inject({
      method: "POST",
      url: "/api/course-enrollments",
      headers: {
        origin: localOrigin,
        cookie: learner.cookie,
        "x-csrf-token": learner.auth.csrfToken,
      },
      payload: { courseReleaseId: xunpu.courseReleaseId },
    });
    expect(claim.statusCode).toBe(200);
    const bindingId = claim.json().enrollment.bindingId as string;

    const initialWorld = await app.inject({
      method: "GET",
      url: `/api/v3/sessions/${DEMO_XUNPU_SESSION_ID}/world?bindingId=${bindingId}`,
      headers: { cookie: learner.cookie },
    });
    expect(initialWorld.statusCode).toBe(200);
    expect(initialWorld.json().world).toMatchObject({
      audience: "student",
      worldStateVersion: 0,
      challenge: { level: 4, scoreCeiling: 85 },
    });
    expect(initialWorld.json().world).not.toHaveProperty("queue");
    expect(JSON.stringify(initialWorld.json())).not.toContain("learnerTwinRef");

    const initialWorkspace = await app.inject({
      method: "GET",
      url: `/api/v3/sessions/${DEMO_XUNPU_SESSION_ID}/workspace?bindingId=${bindingId}`,
      headers: { cookie: learner.cookie },
    });
    expect(initialWorkspace.statusCode).toBe(200);
    expect(initialWorkspace.json().workspace).toMatchObject({
      schemaVersion: "flagship-student-workspace/3.0.0",
      challengeLevel: 4,
      completion: {
        requiredArtifactCount: 7,
        submittedRequiredCount: 0,
        readyForPublication: false,
      },
    });
    expect(initialWorkspace.json().workspace.artifacts).toHaveLength(9);
    expect(JSON.stringify(initialWorkspace.json())).not.toContain("traceRef");
    const initialEvidenceAssessmentV4 = await app.inject({
      method: "GET",
      url: `/api/v4/sessions/${DEMO_XUNPU_SESSION_ID}/evidence-assessment?bindingId=${bindingId}`,
      headers: { cookie: learner.cookie },
    });
    expect(initialEvidenceAssessmentV4.statusCode).toBe(200);
    expect(initialEvidenceAssessmentV4.json().assessment).toMatchObject({
      schemaVersion: "flagship-assessment-view/4.0.0",
      status: "not_ready",
      decision: null,
      teacherReviewAllowed: false,
      audience: "student",
      rubric: {
        reviewStatus: "pending_expert_review",
        classroomApplicabilityConfirmed: false,
        externalExpertValidityEstablished: false,
      },
    });
    const initialEvidenceAssessmentV4Json = JSON.stringify(
      initialEvidenceAssessmentV4.json(),
    );
    for (const forbidden of [
      "blindInput",
      "sourceContentHash",
      "surfaceSignals",
      "prompt",
      "trace",
      "provider",
    ]) expect(initialEvidenceAssessmentV4Json).not.toContain(forbidden);
    const forgedEvidenceAssessmentV4 = await app.inject({
      method: "GET",
      url: `/api/v4/sessions/${DEMO_XUNPU_SESSION_ID}/evidence-assessment?bindingId=${bindingId}&actorId=operator-demo`,
      headers: { cookie: learner.cookie },
    });
    expect(forgedEvidenceAssessmentV4.statusCode).toBe(400);
    const forbiddenStudentReviewV4 = await app.inject({
      method: "POST",
      url: `/api/v4/sessions/${DEMO_XUNPU_SESSION_ID}/evidence-assessment-reviews`,
      headers: {
        origin: localOrigin,
        cookie: learner.cookie,
        "x-csrf-token": learner.auth.csrfToken,
      },
      payload: {
        bindingId,
        expectedAssessmentDecisionId: "assessment-not-created",
        requestId: "request-student-forged-v4-review",
        status: "confirmed",
        rubricApplicabilityConfirmed: true,
        reason: "学生不得为自己的证据评价执行教师终裁。",
        criterionRevisions: [],
      },
    });
    expect(forbiddenStudentReviewV4.statusCode).toBe(403);
    const firstArtifact = initialWorkspace.json().workspace.artifacts[0] as {
      artifactId: string;
      editableFields: Array<{ fieldId: string }>;
    };
    const savedWorkspace = await app.inject({
      method: "POST",
      url: `/api/v3/sessions/${DEMO_XUNPU_SESSION_ID}/workspace/artifacts/${firstArtifact.artifactId}/revisions`,
      headers: {
        origin: localOrigin,
        cookie: learner.cookie,
        "x-csrf-token": learner.auth.csrfToken,
      },
      payload: {
        bindingId,
        requestId: "request-public-workspace-r1",
        expectedRevisionNumber: 0,
        fields: firstArtifact.editableFields.map((field, index) => ({
          fieldId: field.fieldId,
          content: index === 0 ? "面向公共文化理解的真实选题角度。" : "",
        })),
        evidenceRefs: [initialWorkspace.json().workspace.evidenceCatalog[0].evidenceRef],
        revisionNote: "保存真实选题判断第一版",
      },
    });
    expect(savedWorkspace.statusCode).toBe(200);
    expect(savedWorkspace.json().workspace.artifacts[0]).toMatchObject({
      status: "draft",
      revisionCount: 1,
      latestRevision: { parentRevisionId: null },
    });
    expect(savedWorkspace.json().workspace.artifacts[0].latestRevision.contentHash)
      .toMatch(/^[a-f0-9]{64}$/);
    const forgedWorkspaceQuery = await app.inject({
      method: "GET",
      url: `/api/v3/sessions/${DEMO_XUNPU_SESSION_ID}/workspace?bindingId=${bindingId}&actorId=operator-demo`,
      headers: { cookie: learner.cookie },
    });
    expect(forgedWorkspaceQuery.statusCode).toBe(400);

    const action = await app.inject({
      method: "POST",
      url: `/api/v3/sessions/${DEMO_XUNPU_SESSION_ID}/student-actions`,
      headers: {
        origin: localOrigin,
        cookie: learner.cookie,
        "x-csrf-token": learner.auth.csrfToken,
      },
      payload: {
        bindingId,
        requestId: "request-public-gatekeeper",
        eventTemplateId: "event-template-gatekeeper",
        serverIssuedActionRef: initialWorld.json().world.availableActions.find(
          (candidate: { eventTemplateId: string }) => (
            candidate.eventTemplateId === "event-template-gatekeeper"
          ),
        ).serverIssuedActionRef,
        expectedWorldStateVersion: 0,
        action: {
          verb: "ask",
          targetRef: { objectType: "entity", objectId: "entity-gatekeeper" },
          utterance: "您好，我是学生记者。我只在公共区域采访，不进入私人住宅。",
        },
        sourceWorldEventIds: [],
        reflectionNote: "先说明身份、目的与边界。",
      },
    });
    expect(action.statusCode).toBe(200);
    expect(action.json().episode).toMatchObject({
      audience: "student",
      status: "suggestion_ready",
      suggestion: { displayName: "阿环·社区信源" },
    });
    const episodeId = action.json().episode.episodeId as string;
    const accepted = await app.inject({
      method: "POST",
      url: `/api/v3/sessions/${DEMO_XUNPU_SESSION_ID}/episodes/${episodeId}/decisions`,
      headers: {
        origin: localOrigin,
        cookie: learner.cookie,
        "x-csrf-token": learner.auth.csrfToken,
      },
      payload: {
        bindingId,
        decisionRef: "student-decision-public-accept",
        decision: "accept",
        rationale: "接受条件准入并继续遵守社区隐私边界。",
      },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().episode).toMatchObject({
      audience: "student",
      status: "completed",
      consequence: { resultingStateVersion: 1 },
    });

    const teacher = await login(app, "teacher-class-a", DEMO_XUNPU_SESSION_ID);
    const teacherBinding = teacher.auth.bindings.find(
      (binding) => binding.actorKind === "teacher",
    );
    expect(teacherBinding).toBeDefined();
    const teacherEvidenceAssessmentV4 = await app.inject({
      method: "GET",
      url: `/api/v4/sessions/${DEMO_XUNPU_SESSION_ID}/evidence-assessment?bindingId=${teacherBinding!.bindingId}`,
      headers: { cookie: teacher.cookie },
    });
    expect(teacherEvidenceAssessmentV4.statusCode).toBe(200);
    expect(teacherEvidenceAssessmentV4.json().assessment).toMatchObject({
      status: "not_ready",
      decision: null,
      teacherReviewAllowed: false,
      audience: "teacher",
    });
    const forbiddenTeacherAuditV4 = await app.inject({
      method: "GET",
      url: `/api/v4/admin/sessions/${DEMO_XUNPU_SESSION_ID}/evidence-assessment-case?bindingId=${teacherBinding!.bindingId}`,
      headers: { cookie: teacher.cookie },
    });
    expect(forbiddenTeacherAuditV4.statusCode).toBe(403);
    const teacherEpisode = await app.inject({
      method: "GET",
      url: `/api/v3/sessions/${DEMO_XUNPU_SESSION_ID}/collaboration-episode?bindingId=${teacherBinding!.bindingId}`,
      headers: { cookie: teacher.cookie },
    });
    expect(teacherEpisode.statusCode).toBe(200);
    expect(teacherEpisode.json().episode).toMatchObject({
      audience: "teacher",
      dispatchPlan: { selectedCount: 1, skippedCount: 13 },
    });
    expect(JSON.stringify(teacherEpisode.json())).not.toContain("traceRefs");
    const teacherWorkspace = await app.inject({
      method: "GET",
      url: `/api/v3/sessions/${DEMO_XUNPU_SESSION_ID}/workspace?bindingId=${teacherBinding!.bindingId}`,
      headers: { cookie: teacher.cookie },
    });
    expect(teacherWorkspace.statusCode).toBe(403);
    const teacherWorkReview = await app.inject({
      method: "GET",
      url: `/api/v3/sessions/${DEMO_XUNPU_SESSION_ID}/work-review?bindingId=${teacherBinding!.bindingId}`,
      headers: { cookie: teacher.cookie },
    });
    expect(teacherWorkReview.statusCode).toBe(200);
    expect(teacherWorkReview.json().review).toMatchObject({
      schemaVersion: "flagship-work-review/3.0.0",
      completion: { requiredArtifactCount: 7, submittedRequiredCount: 0 },
    });
    expect(teacherWorkReview.json().review.artifacts).toHaveLength(9);
    expect(teacherWorkReview.json().review.artifacts[0]).toMatchObject({
      status: "draft",
      revisionCount: 1,
    });
    const teacherReviewJson = JSON.stringify(teacherWorkReview.json());
    expect(teacherReviewJson).not.toContain("ownerPrincipalId");
    expect(teacherReviewJson).not.toContain("bindingId");
    expect(teacherReviewJson).not.toContain("requestReceipts");
    const studentCompetency = await app.inject({
      method: "GET",
      url: `/api/v3/sessions/${DEMO_XUNPU_SESSION_ID}/competency-evidence?bindingId=${bindingId}`,
      headers: { cookie: learner.cookie },
    });
    expect(studentCompetency.statusCode).toBe(200);
    expect(studentCompetency.json().evidence).toMatchObject({
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
    expect(studentCompetency.json().evidence.evidenceEpisodes.length).toBeGreaterThan(0);
    const studentCompetencyJson = JSON.stringify(studentCompetency.json());
    expect(studentCompetencyJson).not.toContain("semanticReceipts");
    expect(studentCompetencyJson).not.toContain("scoreComputations");
    expect(studentCompetencyJson).not.toContain("provider");
    const studentGrowth = await app.inject({
      method: "GET",
      url: `/api/v3/sessions/${DEMO_XUNPU_SESSION_ID}/learner-growth?bindingId=${bindingId}`,
      headers: { cookie: learner.cookie },
    });
    expect(studentGrowth.statusCode).toBe(200);
    expect(studentGrowth.json().growth).toMatchObject({
      schemaVersion: "learner-growth-view/3.0.0",
      audience: "student",
      state: "evidence_required",
      boundaries: {
        evidenceOnly: true,
        immutablePersonalityLabelsForbidden: true,
        sensitiveAttributesExcluded: true,
        proxyCanActForStudent: false,
        proxyCanCreateEvidence: false,
        proxyCanScoreStudent: false,
      },
      profile: null,
      forecast: null,
      nextChallenge: null,
      learningPlan: null,
    });
    const studentGrowthJson = JSON.stringify(studentGrowth.json());
    for (const forbidden of [
      "principalBindingHash",
      "modelContentHash",
      "policyContentHash",
      "provider",
      "prompt",
      "trace",
    ]) expect(studentGrowthJson).not.toContain(forbidden);
    const forgedGrowthQuery = await app.inject({
      method: "GET",
      url: `/api/v3/sessions/${DEMO_XUNPU_SESSION_ID}/learner-growth?bindingId=${bindingId}&learnerTwinRef=forged`,
      headers: { cookie: learner.cookie },
    });
    expect(forgedGrowthQuery.statusCode).toBe(400);
    const prematureAppeal = await app.inject({
      method: "POST",
      url: `/api/v3/sessions/${DEMO_XUNPU_SESSION_ID}/learner-growth/appeals`,
      headers: {
        origin: localOrigin,
        cookie: learner.cookie,
        "x-csrf-token": learner.auth.csrfToken,
      },
      payload: {
        bindingId,
        requestId: "request-public-premature-appeal",
        reason: "尚无画像时试图申诉，不应由系统制造一个可申诉结论。",
      },
    });
    expect(prematureAppeal.statusCode).toBe(409);

    const teacherCompetency = await app.inject({
      method: "GET",
      url: `/api/v3/sessions/${DEMO_XUNPU_SESSION_ID}/competency-evidence?bindingId=${teacherBinding!.bindingId}`,
      headers: { cookie: teacher.cookie },
    });
    expect(teacherCompetency.statusCode).toBe(200);
    expect(teacherCompetency.json().evidence.audience).toBe("teacher");
    const confirmedInsufficient = await app.inject({
      method: "POST",
      url: `/api/v3/sessions/${DEMO_XUNPU_SESSION_ID}/assessment-decisions`,
      headers: {
        origin: localOrigin,
        cookie: teacher.cookie,
        "x-csrf-token": teacher.auth.csrfToken,
      },
      payload: {
        bindingId: teacherBinding!.bindingId,
        expectedAssessmentDecisionId:
          teacherCompetency.json().evidence.assessment.assessmentDecisionId,
        requestId: "request-public-assessment-confirm",
        status: "confirmed",
        reason: "已逐项核对当前作品与现场行为，确认维持证据不足且不形成数值分数。",
        competencyRevisions: [],
      },
    });
    expect(confirmedInsufficient.statusCode).toBe(200);
    expect(confirmedInsufficient.json().evidence.assessment).toMatchObject({
      scoreStatus: "insufficient_evidence",
      sessionScore: null,
      teacherReview: { status: "confirmed" },
    });
    const teacherGrowth = await app.inject({
      method: "GET",
      url: `/api/v3/sessions/${DEMO_XUNPU_SESSION_ID}/learner-growth?bindingId=${teacherBinding!.bindingId}`,
      headers: { cookie: teacher.cookie },
    });
    expect(teacherGrowth.statusCode).toBe(200);
    expect(teacherGrowth.json().growth).toMatchObject({
      audience: "teacher",
      state: "evidence_required",
      profile: null,
    });
    const forgedAssessmentQuery = await app.inject({
      method: "GET",
      url: `/api/v3/sessions/${DEMO_XUNPU_SESSION_ID}/competency-evidence?bindingId=${teacherBinding!.bindingId}&actorId=operator-demo`,
      headers: { cookie: teacher.cookie },
    });
    expect(forgedAssessmentQuery.statusCode).toBe(400);
    const studentWorkReview = await app.inject({
      method: "GET",
      url: `/api/v3/sessions/${DEMO_XUNPU_SESSION_ID}/work-review?bindingId=${bindingId}`,
      headers: { cookie: learner.cookie },
    });
    expect(studentWorkReview.statusCode).toBe(403);
    const forgedWorkReview = await app.inject({
      method: "GET",
      url: `/api/v3/sessions/${DEMO_XUNPU_SESSION_ID}/work-review?bindingId=${teacherBinding!.bindingId}&actorId=operator-demo`,
      headers: { cookie: teacher.cookie },
    });
    expect(forgedWorkReview.statusCode).toBe(400);

    const administrator = await login(app, "operator-demo", DEMO_XUNPU_SESSION_ID);
    const adminBinding = administrator.auth.bindings[0];
    expect(adminBinding).toBeDefined();
    const adminEpisode = await app.inject({
      method: "GET",
      url: `/api/v3/sessions/${DEMO_XUNPU_SESSION_ID}/collaboration-episode?bindingId=${adminBinding!.bindingId}`,
      headers: { cookie: administrator.cookie },
    });
    expect(adminEpisode.statusCode).toBe(200);
    expect(adminEpisode.json().episode).toMatchObject({
      audience: "admin",
      execution: { executionMode: "deterministic_demo" },
    });
    expect(adminEpisode.json().episode.execution.traceRefs).toHaveLength(1);
    const adminTopology = await app.inject({
      method: "GET",
      url: `/api/v3/admin/sessions/${DEMO_XUNPU_SESSION_ID}/agent-topology?bindingId=${adminBinding!.bindingId}`,
      headers: { cookie: administrator.cookie },
    });
    expect(adminTopology.statusCode).toBe(200);
    expect(adminTopology.json().topology).toMatchObject({
      schemaVersion: "simulation-agent-topology/3.0.0",
      sessionId: DEMO_XUNPU_SESSION_ID,
    });
    expect(adminTopology.json().topology.groups).toHaveLength(6);
    expect(adminTopology.json().topology.agents).toHaveLength(14);
    expect(adminTopology.json().topology.agents.every((agent: { authority: string }) => (
      agent.authority === "proposal_only"
    ))).toBe(true);
    const adminAssessment = await app.inject({
      method: "GET",
      url: `/api/v3/admin/sessions/${DEMO_XUNPU_SESSION_ID}/assessment-case?bindingId=${adminBinding!.bindingId}`,
      headers: { cookie: administrator.cookie },
    });
    expect(adminAssessment.statusCode).toBe(200);
    expect(adminAssessment.json().assessmentCase).toMatchObject({
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
    expect(adminAssessment.json().assessmentCase.decisionHistory).toHaveLength(2);
    const pendingAdminAssessmentV4 = await app.inject({
      method: "GET",
      url: `/api/v4/admin/sessions/${DEMO_XUNPU_SESSION_ID}/evidence-assessment-case?bindingId=${adminBinding!.bindingId}`,
      headers: { cookie: administrator.cookie },
    });
    expect(pendingAdminAssessmentV4.statusCode).toBe(409);
    expect(pendingAdminAssessmentV4.json()).toMatchObject({
      code: "not_ready",
    });
    const adminAdaptation = await app.inject({
      method: "GET",
      url: `/api/v3/admin/sessions/${DEMO_XUNPU_SESSION_ID}/learner-adaptation-case?bindingId=${adminBinding!.bindingId}`,
      headers: { cookie: administrator.cookie },
    });
    expect(adminAdaptation.statusCode).toBe(200);
    expect(adminAdaptation.json().adaptationCase).toMatchObject({
      schemaVersion: "learner-adaptation-case-view/3.0.0",
      state: "evidence_required",
      boundaries: {
        rawLearnerIdentityStored: false,
        sensitiveAttributesExcluded: true,
        immutablePersonalityLabel: null,
        proxyCanActForStudent: false,
        proxyCanCreateEvidence: false,
        proxyCanScoreStudent: false,
        automaticStepLimit: 1,
        initialChallengeRange: [3, 5],
      },
      learnerTwinId: null,
      profileHistory: [],
      forecasts: [],
      challengeAssignments: [],
      learningPlans: [],
    });
    const forbiddenAdminAdaptation = await app.inject({
      method: "GET",
      url: `/api/v3/admin/sessions/${DEMO_XUNPU_SESSION_ID}/learner-adaptation-case?bindingId=${teacherBinding!.bindingId}`,
      headers: { cookie: teacher.cookie },
    });
    expect(forbiddenAdminAdaptation.statusCode).toBe(403);
    const teacherTopology = await app.inject({
      method: "GET",
      url: `/api/v3/admin/sessions/${DEMO_XUNPU_SESSION_ID}/agent-topology?bindingId=${teacherBinding!.bindingId}`,
      headers: { cookie: teacher.cookie },
    });
    expect(teacherTopology.statusCode).toBe(403);

    const featureArtifact = initialWorkspace.json().workspace.artifacts.find(
      (artifact: { artifactId: string }) => artifact.artifactId === "artifact-feature-story",
    ) as {
      artifactId: string;
      editableFields: Array<{ fieldId: string }>;
    };
    const featureFields = (label: string) => featureArtifact.editableFields.map(
      (field, index) => ({
        fieldId: field.fieldId,
        content: index === 0 ? `${label}：这是学生记者自己写下的专题稿真实内容。` : "",
      }),
    );
    const featureR1Response = await app.inject({
      method: "POST",
      url: `/api/v3/sessions/${DEMO_XUNPU_SESSION_ID}/workspace/artifacts/${featureArtifact.artifactId}/revisions`,
      headers: {
        origin: localOrigin,
        cookie: learner.cookie,
        "x-csrf-token": learner.auth.csrfToken,
      },
      payload: {
        bindingId,
        requestId: "request-public-feature-r1",
        expectedRevisionNumber: 0,
        fields: featureFields("第一版"),
        evidenceRefs: [initialWorkspace.json().workspace.evidenceCatalog[0].evidenceRef],
        revisionNote: "根据第一轮现场采访形成初稿",
      },
    });
    expect(featureR1Response.statusCode).toBe(200);
    const featureR2Response = await app.inject({
      method: "POST",
      url: `/api/v3/sessions/${DEMO_XUNPU_SESSION_ID}/workspace/artifacts/${featureArtifact.artifactId}/revisions`,
      headers: {
        origin: localOrigin,
        cookie: learner.cookie,
        "x-csrf-token": learner.auth.csrfToken,
      },
      payload: {
        bindingId,
        requestId: "request-public-feature-r2",
        expectedRevisionNumber: 1,
        fields: featureFields("第二版补充社区主体与来源边界"),
        evidenceRefs: [initialWorkspace.json().workspace.evidenceCatalog[0].evidenceRef],
        revisionNote: "根据社区公开边界形成第二版",
      },
    });
    expect(featureR2Response.statusCode).toBe(200);
    const featureR2 = featureR2Response.json().workspace.artifacts.find(
      (artifact: { artifactId: string }) => artifact.artifactId === featureArtifact.artifactId,
    ).latestRevision;
    const worldBeforeDraft = await app.inject({
      method: "GET",
      url: `/api/v3/sessions/${DEMO_XUNPU_SESSION_ID}/world?bindingId=${bindingId}`,
      headers: { cookie: learner.cookie },
    });
    const draftEntry = worldBeforeDraft.json().world.availableActions.find(
      (candidate: { eventTemplateId: string }) => (
        candidate.eventTemplateId === "event-template-draft-story"
      ),
    );
    const forgedDraft = await app.inject({
      method: "POST",
      url: `/api/v3/sessions/${DEMO_XUNPU_SESSION_ID}/student-actions`,
      headers: {
        origin: localOrigin,
        cookie: learner.cookie,
        "x-csrf-token": learner.auth.csrfToken,
      },
      payload: {
        bindingId,
        requestId: "request-public-feature-forged",
        eventTemplateId: "event-template-draft-story",
        serverIssuedActionRef: draftEntry.serverIssuedActionRef,
        expectedWorldStateVersion: 1,
        action: {
          verb: "draft",
          artifactId: featureArtifact.artifactId,
          revisionId: featureR2.revisionId,
          parentRevisionId: featureR2.parentRevisionId,
          contentHash: "f".repeat(64),
        },
        sourceWorldEventIds: [],
        reflectionNote: "伪造哈希不应进入编辑部。",
      },
    });
    expect(forgedDraft.statusCode).toBe(409);
    const reviewedDraft = await app.inject({
      method: "POST",
      url: `/api/v3/sessions/${DEMO_XUNPU_SESSION_ID}/student-actions`,
      headers: {
        origin: localOrigin,
        cookie: learner.cookie,
        "x-csrf-token": learner.auth.csrfToken,
      },
      payload: {
        bindingId,
        requestId: "request-public-feature-review",
        eventTemplateId: "event-template-draft-story",
        serverIssuedActionRef: draftEntry.serverIssuedActionRef,
        expectedWorldStateVersion: 1,
        action: {
          verb: "draft",
          artifactId: featureArtifact.artifactId,
          revisionId: featureR2.revisionId,
          parentRevisionId: featureR2.parentRevisionId,
          contentHash: featureR2.contentHash,
        },
        sourceWorldEventIds: [],
        reflectionNote: "提交真实第二版，请编辑部只依据该版本审阅。",
      },
    });
    expect(reviewedDraft.statusCode, reviewedDraft.body).toBe(200);
    expect(reviewedDraft.json().episode).toMatchObject({
      status: "suggestion_ready",
      // The director no longer raises the merchant conflict after gatekeeper
      // access alone. The newest append-only Episode is this draft review,
      // rather than a stale earlier suggestion selected by lexical id order.
      suggestion: { displayName: "陈编辑·责任编辑" },
    });

    await app.close();
    app = await createApp(appOptions(dataDir));
    const restored = await login(app, "student-unassigned", DEMO_XUNPU_SESSION_ID);
    const restoredEnrollment = await app.inject({
      method: "GET",
      url: "/api/me/course-enrollments",
      headers: { cookie: restored.cookie },
    });
    const restoredBinding = restoredEnrollment.json().enrollments[0].bindingId as string;
    const restoredWorld = await app.inject({
      method: "GET",
      url: `/api/v3/sessions/${DEMO_XUNPU_SESSION_ID}/world?bindingId=${restoredBinding}`,
      headers: { cookie: restored.cookie },
    });
    expect(restoredWorld.statusCode).toBe(200);
    expect(restoredWorld.json().world.worldStateVersion).toBe(1);
    const restoredWorkspace = await app.inject({
      method: "GET",
      url: `/api/v3/sessions/${DEMO_XUNPU_SESSION_ID}/workspace?bindingId=${restoredBinding}`,
      headers: { cookie: restored.cookie },
    });
    expect(restoredWorkspace.statusCode).toBe(200);
    expect(restoredWorkspace.json().workspace.artifacts[0]).toMatchObject({
      status: "draft",
      revisionCount: 1,
    });
    const restoredAssessment = await app.inject({
      method: "GET",
      url: `/api/v3/sessions/${DEMO_XUNPU_SESSION_ID}/competency-evidence?bindingId=${restoredBinding}`,
      headers: { cookie: restored.cookie },
    });
    expect(restoredAssessment.statusCode).toBe(200);
    expect(restoredAssessment.json().evidence.assessment.scoreStatus)
      .toBe("insufficient_evidence");
    expect(restoredAssessment.json().evidence.evidenceEpisodes.length)
      .toBeGreaterThan(studentCompetency.json().evidence.evidenceEpisodes.length);
  }, 45_000);
});
