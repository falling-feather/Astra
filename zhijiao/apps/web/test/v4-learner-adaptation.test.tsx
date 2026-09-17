import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  parseLearnerAdaptationAdminCaseResponseV4,
  parseLearnerAdaptationResponseV4,
} from "../src/v2/learner-adaptation-v4";
import { createHttpExperienceGateway } from "../src/v2/gateway";
import { createHttpTeacherGateway } from "../src/v2/teacher-gateway";
import { createHttpAdminGateway } from "../src/v2/admin-gateway";
import { StudentLearnerAdaptationSurfaceV4 } from "../src/v2/pages/student-learner-adaptation-v4";
import { TeacherLearnerAdaptationSurfaceV4 } from "../src/v2/pages/teacher-learner-adaptation-v4";
import { AdminLearnerAdaptationCaseSurfaceV4 } from "../src/v2/pages/admin-evidence-page";

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

const boundaries = {
  observableEvidenceOnly: true,
  immutablePersonalityLabelsForbidden: true,
  sensitiveAttributesExcluded: true,
  studentConsentRequired: true,
  teacherAuthorizationRequired: true,
  proxyCanActForStudent: false,
  proxyCanCreateEvidence: false,
  proxyCanScoreStudent: false,
  calibrationEvidenceEligibleForScore: false,
};

function publicResponse(
  audience: "student" | "teacher",
  options: { consent?: "pending" | "accepted" | "declined"; appealOpen?: boolean } = {},
) {
  return {
    adaptation: {
      schemaVersion: "learner-adaptation-view/4.0.0",
      audience,
      state: options.appealOpen ? "appeal_open" : options.consent === "accepted" ? "consented" : "proposed",
      safeMessage: "系统依据最终证据提出第二场，但仍需学生同意与教师授权。",
      boundaries,
      learnerModel: {
        revision: 1,
        calibrationCount: 0,
        evidenceBased: true,
        personalityDiagnosis: false,
        limitations: [
          "该模型只描述当前证据支持的可观察岗位表现，不是固定人格或能力定型。",
        ],
        criteria: criterionIds.map((criterionId, index) => ({
          criterionId,
          title: `岗位能力 ${index + 1}`,
          band: index < 2 ? "low" : "high",
          score: index < 2 ? 56 + index : 84 + index,
          confidence: 0.82,
          evidenceCount: 2,
          supportEvidenceCount: 2,
          counterEvidenceCount: 0,
          uncertaintyDrivers: [],
          lastPredictionError: null,
          growthTarget: index < 2,
        })),
      },
      forecast: {
        mode: "deterministic_fallback",
        revision: 1,
        candidateCount: 4,
        selectedVariantRef: "variant-xunpu-source-triangulation",
        evidenceEligibleForScore: false,
        canActForStudent: false,
      },
      proposal: {
        handoffId: "second-session-handoff-web-v4",
        variantRef: "variant-xunpu-source-triangulation",
        title: "多源交叉核验压力场",
        sourceChallengeLevel: 4,
        targetChallengeLevel: 4,
        growthTargets: [{ criterionId: criterionIds[0], title: "事实核验" }],
        changedMechanics: [
          { mechanicKind: "event_templates", safeSummary: "强化矛盾信源与时限冲突事件。" },
          { mechanicKind: "npc_resistance", safeSummary: "研究者只提供可复核的局部线索。" },
          { mechanicKind: "evidence_availability", safeSummary: "关键出处需要学生主动追问后才开放。" },
          { mechanicKind: "deadline_pattern", safeSummary: "截稿窗口缩短并出现中途更新。" },
          { mechanicKind: "scaffolding_budget", safeSummary: "建议预算收紧为两次。" },
        ],
        successEvidence: ["至少形成一组独立信源交叉核验", "在证据不足时主动降级主张"],
      },
      consent: { status: options.consent ?? "pending", requestId: null, decidedAt: null },
      appeal: options.appealOpen
        ? { status: "open", appealRef: "appeal-web-v4", reason: "一条采访录音没有进入判断。", resolution: null, teacherReason: null }
        : { status: "none", appealRef: null, reason: null, resolution: null, teacherReason: null },
      handoff: { status: "proposed", sessionRef: null, bindingRef: null, calibration: null },
      nextAction: options.appealOpen ? "等待教师依据原始证据处理申诉。" : "学生可先核对依据，选择同意、拒绝或申诉。",
    },
  };
}

function flagshipContentRef() {
  return {
    schemaVersion: "flagship-content-reference/4.0.0",
    contentSchemaVersion: "xunpu-flagship-content/4.0.0",
    courseReleaseRef: { courseId: "course-xunpu-intangible-media", releaseId: "course-xunpu-r4", version: 4, contentHash: hashA },
    scenarioReleaseRef: { scenarioId: "scenario-xunpu-living-world", version: "4.0.0", contentHash: hashB },
    simulationReleaseRef: { simulationId: "simulation-xunpu-living-world", releaseId: "simulation-xunpu-r4", version: 4, contentHash: hashC },
    contentHash: hashA,
  };
}

function adminResponse() {
  return {
    adaptationCase: {
      schemaVersion: "learner-adaptation-admin-case/4.0.0",
      sourceSessionId: "session-source-v4",
      learnerSubjectHash: hashA,
      sourceAssessmentDecisionRef: "assessment-final-v4",
      sourceAssessmentHash: hashB,
      learnerTwin: {
        learnerTwinRef: "learner-twin-web-v4",
        revision: 1,
        sourceAssessmentDecisionRef: "assessment-final-v4",
        criterionStates: criterionIds.map((criterionId, index) => ({
          criterionId,
          evidenceStatus: "supported",
          band: index < 2 ? "low" : "high",
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
        forecastRef: "forecast-web-v4",
        revision: 1,
        assessorMode: "deterministic_fallback",
        learnerTwinContentHash: hashC,
        candidates: ["source-triangulation", "consent-negotiation", "editorial-independence", "recovery-transfer"].map((kind, index) => ({
          variantRef: `variant-xunpu-${kind}`,
          predictedSuccessProbability: 0.6 + index * 0.03,
          predictedOverloadProbability: 0.28,
          predictedGrowthValue: 0.72,
          rationale: index === 0 ? "直接针对最低证据维度。" : "保留为反事实候选。",
        })),
        selectedVariantRef: "variant-xunpu-source-triangulation",
        evidenceEligibleForScore: false,
        canActForStudent: false,
        generatedAt: "2026-08-29T08:01:00.000Z",
      },
      consent: { status: "accepted", requestId: "request-consent-web-v4", decidedAt: "2026-08-29T08:02:00.000Z" },
      appeal: { status: "none", appealRef: null, reason: null, resolution: null, teacherReason: null, openedAt: null, resolvedAt: null },
      handoff: {
        schemaVersion: "second-session-handoff/4.0.0",
        handoffId: "handoff-web-v4",
        learnerSubjectHash: hashA,
        learnerTwinRef: "learner-twin-web-v4",
        learnerTwinContentHash: hashC,
        sourceSessionId: "session-source-v4",
        sourceAssessmentDecisionRef: "assessment-final-v4",
        flagshipContentRef: flagshipContentRef(),
        createdAt: "2026-08-29T08:01:00.000Z",
        status: "proposed",
        reasonCode: null,
        proposal: {
          variantRef: "variant-xunpu-source-triangulation",
          sourceChallengeLevel: 4,
          targetChallengeLevel: 4,
          changedMechanics: [
            { mechanicKind: "event_templates", beforeHash: hashA, afterHash: hashB, safeSummary: "冲突事件集合改变。" },
            { mechanicKind: "npc_resistance", beforeHash: hashB, afterHash: hashC, safeSummary: "NPC 阻力改变。" },
          ],
          growthTargetRefs: [criterionIds[0]],
          forecastRef: "forecast-web-v4",
          learnerConsentRequired: true,
        },
        teacherAuthorizationRef: null,
        provision: null,
        calibration: null,
        failure: null,
        writeDisposition: "candidate_only",
      },
      proxyRuns: [],
      requestReceipts: [{ requestId: "request-consent-web-v4", requestHash: hashA, operation: "record_consent", resultRef: "handoff-web-v4", createdAt: "2026-08-29T08:02:00.000Z" }],
      boundaries: {
        rawLearnerIdentityStored: false,
        rawStudentUtteranceStored: false,
        sensitiveAttributesExcluded: true,
        proxyCanActForStudent: false,
        proxyCanCreateEvidence: false,
        proxyCanScoreStudent: false,
        calibrationEvidenceEligibleForScore: false,
      },
    },
  };
}

function auth(profileId: string) {
  return {
    profileId,
    principal: { principalId: `principal-${profileId}`, kind: "human" as const, displayName: profileId, status: "active" as const, createdAt: "2026-08-29T00:00:00.000Z" },
    bindings: [],
    csrfToken: "csrf-adaptation-v4",
    expiresAt: "2026-08-30T00:00:00.000Z",
  };
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("V4 learner adaptation browser journey", () => {
  it("strictly rejects public identity or private runtime fields", () => {
    const parsed = parseLearnerAdaptationResponseV4(publicResponse("student"), "student");
    expect(parsed.learnerModel?.personalityDiagnosis).toBe(false);
    const forged = structuredClone(publicResponse("student"));
    Object.assign(forged.adaptation, { learnerActorId: "student-secret" });
    expect(() => parseLearnerAdaptationResponseV4(forged, "student")).toThrow(/冻结接口/u);
  });

  it("shows executable changes, consent and appeal without exposing hashes", () => {
    const view = parseLearnerAdaptationResponseV4(publicResponse("student"), "student");
    const markup = renderToStaticMarkup(createElement(StudentLearnerAdaptationSurfaceV4, {
      view, busy: false, error: null, appealReason: "",
      onAppealReasonChange: () => undefined,
      onConsent: () => undefined,
      onAppeal: () => undefined,
      onEnterSecondSession: () => undefined,
    }));
    expect(markup).toContain("不是给你贴标签，而是改变下一场");
    expect(markup).toContain("冲突事件");
    expect(markup).toContain("人物阻力");
    expect(markup).toContain("同意进入第二场");
    expect(markup).toContain("发起申诉");
    expect(markup).not.toContain(hashA);
    expect(markup).not.toContain("learnerActorId");
  });

  it("explains task-outcome calibration and keeps the legacy label separate", () => {
    const raw = structuredClone(publicResponse("student", { consent: "accepted" })) as Record<string, any>;
    raw.adaptation.state = "calibrated";
    raw.adaptation.handoff = {
      status: "calibration_completed",
      sessionRef: "training-adaptive-v4-calibrated",
      bindingRef: "binding-second-session",
      calibration: {
        actionCount: 4,
        forecastError: 0.2,
        evidenceEligibleForScore: false,
        calibratedAt: "2026-08-29T09:00:00.000Z",
        policyVersion: "learner-calibration-v4/task-outcome-v1",
        outcome: "success",
        observedBehaviorAlignment: 0.8,
        observationWindow: {
          policyVersion: "learner-calibration-v4/task-outcome-v1",
          startVirtualMinute: 0,
          endVirtualMinute: 45,
          startWorldStateVersion: 0,
          endWorldStateVersion: 8,
          closedBy: "window_elapsed",
        },
        completionBasis: ["已形成带时点的真实服务结果。"],
        unmetRequirements: [],
      },
    };
    const view = parseLearnerAdaptationResponseV4(raw, "student");
    const markup = renderToStaticMarkup(createElement(StudentLearnerAdaptationSurfaceV4, {
      view, busy: false, error: null, appealReason: "",
      onAppealReasonChange: () => undefined,
      onConsent: () => undefined,
      onAppeal: () => undefined,
      onEnterSecondSession: () => undefined,
    }));
    expect(markup).toContain("第二场任务结果为成功");
    expect(markup).toContain("冻结观察窗口");
    expect(markup).toContain("learner-calibration-v4/task-outcome-v1");
    expect(markup).not.toContain("旧版动作对齐口径");
  });

  it("lets the teacher authorize only after explicit student consent", () => {
    const pending = parseLearnerAdaptationResponseV4(publicResponse("teacher"), "teacher");
    const accepted = parseLearnerAdaptationResponseV4(publicResponse("teacher", { consent: "accepted" }), "teacher");
    const props = {
      busy: false, error: null, reviewReason: "",
      onReviewReasonChange: () => undefined,
      onReviewAppeal: () => undefined,
      onAuthorize: () => undefined,
      onOpenSecondSession: () => undefined,
    };
    expect(renderToStaticMarkup(createElement(TeacherLearnerAdaptationSurfaceV4, { view: pending, ...props }))).toContain("等待学生决定");
    expect(renderToStaticMarkup(createElement(TeacherLearnerAdaptationSurfaceV4, { view: accepted, ...props }))).toContain("授权并创建真实第二场");
  });

  it("uses role-safe endpoints, CSRF and browser-minimal mutation bodies", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const student = createHttpExperienceGateway(auth("student-unassigned"), {
      apiBase: "http://api.local",
      fetchImpl: async (input, init) => { calls.push({ url: String(input), init }); return json(publicResponse("student")); },
    });
    await student.getLearnerAdaptationV4!("session-source-v4", "binding-student");
    await student.recordLearnerConsentV4!({ sessionId: "session-source-v4", bindingId: "binding-student", requestId: "request-consent-web", accepted: true });
    const teacher = createHttpTeacherGateway(auth("teacher-class-a"), {
      apiBase: "http://api.local",
      fetchImpl: async (input, init) => { calls.push({ url: String(input), init }); return json(publicResponse("teacher", { consent: "accepted" })); },
    });
    await teacher.authorizeSecondSessionV4!({ sessionId: "session-source-v4", bindingId: "binding-teacher", requestId: "request-authorize-web", expectedHandoffId: "second-session-handoff-web-v4" });

    expect(calls.map((call) => call.url)).toEqual([
      "http://api.local/api/v4/sessions/session-source-v4/learner-adaptation?bindingId=binding-student",
      "http://api.local/api/v4/sessions/session-source-v4/learner-adaptation-consents",
      "http://api.local/api/v4/sessions/session-source-v4/second-session-authorizations",
    ]);
    expect(new Headers(calls[1]?.init?.headers).get("X-CSRF-Token")).toBe("csrf-adaptation-v4");
    const consentBody = JSON.parse(String(calls[1]?.init?.body));
    expect(consentBody).toEqual({ bindingId: "binding-student", requestId: "request-consent-web", accepted: true });
    expect(JSON.stringify(calls)).not.toContain("learnerActorId");
    expect(JSON.stringify(calls)).not.toContain("learnerTwin");
  });

  it("keeps the full hashes and four counterfactuals on the admin-only endpoint", async () => {
    const parsed = parseLearnerAdaptationAdminCaseResponseV4(adminResponse());
    expect(parsed?.forecast.candidates).toHaveLength(4);
    if (!parsed) throw new Error("expected admin case");
    const markup = renderToStaticMarkup(createElement(AdminLearnerAdaptationCaseSurfaceV4, { value: parsed }));
    expect(markup).toContain("证据学习者模型与第二场机制审计");
    expect(markup).toContain("四个反事实候选世界");
    expect(markup).toContain("candidate_only");

    const calls: string[] = [];
    const gateway = createHttpAdminGateway({ apiBase: "http://api.local", fetchImpl: async (input) => { calls.push(String(input)); return json(adminResponse()); } });
    expect((await gateway.getLearnerAdaptationCaseV4!("session-source-v4", "binding-admin"))?.learnerSubjectHash).toBe(hashA);
    expect(calls).toEqual(["http://api.local/api/v4/admin/sessions/session-source-v4/learner-adaptation-case?bindingId=binding-admin"]);
  });

  it("labels an old action-alignment history without rewriting its hash", () => {
    const raw = structuredClone(adminResponse()) as Record<string, any>;
    raw.adaptationCase.learnerTwin.calibrationHistory = [{
      calibrationRef: "legacy-calibration-v4",
      variantRef: "variant-xunpu-source-triangulation",
      predictedSuccessProbability: 0.6,
      observedBehaviorAlignment: 1,
      absolutePredictionError: 0.4,
      actionEvidenceHash: hashA,
      calibratedAt: "2026-08-29T09:00:00.000Z",
    }];
    const parsed = parseLearnerAdaptationAdminCaseResponseV4(raw);
    if (!parsed) throw new Error("expected admin case");
    const markup = renderToStaticMarkup(createElement(AdminLearnerAdaptationCaseSurfaceV4, { value: parsed }));
    expect(markup).toContain("legacy/action-alignment/4.0.0");
    expect(markup).toContain("历史 actionEvidenceHash 原样保留");
    expect(markup).toContain(hashA.slice(0, 10));
  });
});
