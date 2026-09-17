import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  parseFlagshipEvidenceAssessmentAdminCaseResponseV4,
  parseFlagshipEvidenceAssessmentResponseV4,
} from "../src/v2/assessment-v4";
import { StudentEvidenceAssessmentSurfaceV4 } from "../src/v2/pages/student-evidence-assessment-v4";
import { TeacherEvidenceAssessmentSurfaceV4 } from "../src/v2/pages/teacher-evidence-assessment-v4";
import {
  AdminBusinessOperationTimeline,
  AdminEvidenceAssessmentCaseSurfaceV4,
  AdminEvidenceAssessmentNotReadySurfaceV4,
} from "../src/v2/pages/admin-evidence-page";
import { completedBusinessOperationReceiptFixture } from "../../../packages/contracts/test/business-operation-receipt.fixture";
import { createHttpExperienceGateway, GatewayHttpError } from "../src/v2/gateway";
import { loadAdminEvidence } from "../src/v2/admin-evidence-loader";
import { sessionExperienceDescriptorFixture } from "./v2-student.fixture";
import { createHttpTeacherGateway } from "../src/v2/teacher-gateway";
import { createHttpAdminGateway } from "../src/v2/admin-gateway";

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

function decision(status: "insufficient_evidence" | "provisional" | "final" = "provisional") {
  const sufficient = status !== "insufficient_evidence";
  const final = status === "final";
  return {
    schemaVersion: "evidence-assessment-decision/4.0.0",
    assessmentDecisionId: `assessment-${status}`,
    blindCaseRef: "blind-case-v4-web",
    blindInputHash: hashA,
    status,
    assessorMode: "deterministic_fallback",
    rubricReviewStatus: final ? "verified" : "pending_expert_review",
    criterionAssessments: criterionIds.map((criterionId) => ({
      criterionId,
      evidenceStatus: sufficient ? "supported" : "insufficient",
      band: sufficient ? "high" : null,
      score: sufficient ? 88 : null,
      confidence: sufficient ? 0.84 : 0,
      evidenceRefs: sufficient ? ["evidence-job-fact"] : [],
      rationale: sufficient
        ? "岗位行为、作品引用和世界后果形成独立证据。"
        : "证据不足，不生成局部分数。",
      surfaceSignalsUsed: false,
    })),
    sessionScore: sufficient ? 85 : null,
    evidenceRefs: sufficient ? ["evidence-job-fact"] : [],
    adviceAgentExcluded: true,
    challengeAppliedAfterBlindAssessment: true,
    challengeAdjustmentRef: sufficient ? "challenge-adjustment-v4" : null,
    teacherReview: final ? {
      status: "confirmed",
      teacherDecisionRef: "teacher-decision-v4",
      rationale: "已核对同一证据并确认本班量规适用。",
      reviewedAt: "2026-08-29T00:10:00.000Z",
    } : {
      status: "pending",
      teacherDecisionRef: null,
      rationale: null,
      reviewedAt: null,
    },
    generatedAt: "2026-08-29T00:00:00.000Z",
  };
}

function response(status: "not_ready" | "insufficient_evidence" | "provisional" | "final" = "provisional") {
  const current = status === "not_ready" ? null : decision(status);
  return {
    assessment: {
      schemaVersion: "flagship-assessment-view/4.0.0",
      status,
      safeMessage: status === "not_ready"
        ? "需要真实行动、作品、证据和世界后果。"
        : "六维岗位证据已经形成。",
      decision: current,
      criteria: criterionIds.map((criterionId, index) => ({
        criterionId,
        title: `能力维度 ${index + 1}`,
        evidenceStatus: current ? current.criterionAssessments[index]!.evidenceStatus : "insufficient",
        band: current ? current.criterionAssessments[index]!.band : null,
        score: current ? current.criterionAssessments[index]!.score : null,
        confidence: current ? current.criterionAssessments[index]!.confidence : 0,
        rationale: current
          ? current.criterionAssessments[index]!.rationale
          : "尚未形成可评分证据。",
      })),
      evidenceCoverage: {
        artifactRevisionCount: current ? 4 : 0,
        claimLinkCount: current ? 3 : 0,
        behaviorCount: current ? 6 : 0,
        consequenceCount: current ? 5 : 0,
        recoveryPairCount: current ? 1 : 0,
      },
      rubric: {
        version: "xunpu-rubric-v4-r1",
        reviewStatus: status === "final" ? "verified" : "pending_expert_review",
        classroomApplicabilityConfirmed: status === "final",
        externalExpertValidityEstablished: false,
      },
      teacherReviewAllowed: false,
      audience: "student",
    },
  };
}

function adminResponse() {
  const current = decision();
  return {
    assessmentCase: {
      schemaVersion: "flagship-assessment-admin-case/4.0.0",
      sessionId: "session-v4-web",
      sourceHash: hashB,
      blindInput: {
        schemaVersion: "blind-evidence-assessment-input/4.0.0",
        blindCaseId: "blind-case-v4-web",
        flagshipContentHash: hashA,
        rubricVersion: "xunpu-rubric-v4-r1",
        rubricContentHash: hashB,
        rubricReviewStatus: "pending_expert_review",
        artifactRevisions: [{
          artifactRef: "artifact-feature-story",
          revisionRef: "revision-feature-r2",
          contentHash: hashA,
        }],
        claimEvidenceLinks: [{
          claimRef: "revision-feature-r2",
          evidenceRefs: ["evidence-job-fact"],
          supportStatus: "supported",
          sourceCount: 1,
        }],
        behaviorEvidenceRefs: ["behavior-job-action"],
        worldConsequenceRefs: ["consequence-job-action"],
        scaffoldingEpisodeRefs: [],
        recoveryPairRefs: ["recovery-job-r1-r2"],
        surfaceSignals: {
          textLength: 99_999,
          keywordMatchCount: 999,
          completionClickCount: 999,
          endingKind: "perfect-looking-ending",
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
        generatedAt: "2026-08-29T00:00:00.000Z",
      },
      evidenceFacts: [{
        evidenceRef: "evidence-job-fact",
        sourceKind: "claim_evidence",
        evidenceCode: "verified_claim_supported",
        independenceKey: "independence-job-fact",
        sourceContentHash: hashB,
      }],
      blindJudgments: current.criterionAssessments,
      rawWeightedScore: 88,
      scoreCeiling: 85,
      qualityRuns: [{
        qualityRunRef: "quality-run-v4-web",
        inputHash: hashA,
        outputHash: hashB,
        mode: "deterministic_fallback",
        fallbackReason: "model_not_configured",
        providerId: null,
        modelId: null,
        traceRef: null,
        latencyMs: null,
        estimatedCostMicros: 0,
        createdAt: "2026-08-29T00:00:00.000Z",
      }],
      decisionHistory: [{ sourceHash: hashB, decision: current }],
      reviewReceipts: [],
      antiGaming: {
        surfaceSignalsUsed: false,
        adviceAgentExcluded: true,
        challengeAppliedAfterBlindAssessment: true,
      },
    },
  };
}

function authFixture(profileId: "student-unassigned" | "teacher-class-a") {
  return {
    profileId,
    principal: {
      principalId: `principal-${profileId}`,
      kind: "human" as const,
      displayName: profileId === "teacher-class-a" ? "课程教师" : "学生记者",
      status: "active" as const,
      createdAt: "2026-08-29T00:00:00.000Z",
    },
    bindings: [],
    csrfToken: "csrf-v4-assessment",
    expiresAt: "2026-08-30T00:00:00.000Z",
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("V4 evidence assessment browser model and surfaces", () => {
  it('lets the teacher assess all submitted-work dimensions without inventing default scores',()=>{
    const source=response('insufficient_evidence');
    const view=parseFlagshipEvidenceAssessmentResponseV4({assessment:{...source.assessment,audience:'teacher',teacherReviewAllowed:true,assessmentBasis:'submitted_work'}},'teacher');
    const markup=renderToStaticMarkup(createElement(TeacherEvidenceAssessmentSurfaceV4,{view,busy:false,error:null,onReview:()=>undefined}));
    expect(markup).toContain('逐维评阅');expect(markup.match(/type="number"/gu)).toHaveLength(6);
    expect(markup).not.toContain('value="70"');expect(markup).not.toContain('确认原判');
  });
  it("strictly parses a not-ready state and rejects invented external validity", () => {
    const parsed = parseFlagshipEvidenceAssessmentResponseV4(response("not_ready"), "student");
    expect(parsed).toMatchObject({ status: "not_ready", decision: null });
    const forged = structuredClone(response("provisional"));
    forged.assessment.rubric.externalExpertValidityEstablished = true;
    expect(() => parseFlagshipEvidenceAssessmentResponseV4(forged, "student"))
      .toThrow(/冻结接口/u);
  });

  it("shows one clear next step when evidence is absent", () => {
    const view = parseFlagshipEvidenceAssessmentResponseV4(response("not_ready"), "student");
    const markup = renderToStaticMarkup(createElement(StudentEvidenceAssessmentSurfaceV4, {
      view,
      sessionId: "session-v4-web",
      navigate: () => undefined,
    }));
    expect(markup).toContain("完成并提交作品后查看评价");
    expect(markup).toContain("回到任务现场");
    expect(markup).not.toContain("/ 100");
    expect(markup.match(/<button/g)).toHaveLength(1);
  });

  it("explains anti-gaming evidence without exposing administrator internals", () => {
    const view = parseFlagshipEvidenceAssessmentResponseV4(response(), "student");
    const markup = renderToStaticMarkup(createElement(StudentEvidenceAssessmentSurfaceV4, {
      view,
      sessionId: "session-v4-web",
      navigate: () => undefined,
    }));
    expect(markup).toContain("篇幅、好友数量、点击次数和采纳建议的比例均不加分");
    expect(markup).toContain("外部专业教师/专家效度尚未建立");
    expect(markup).not.toContain("sourceContentHash");
    expect(markup).not.toContain("evidence-job-fact");
  });

  it("requires an explicit classroom applicability acknowledgment in teacher UI", () => {
    const teacherWire = response();
    teacherWire.assessment.audience = "teacher";
    teacherWire.assessment.teacherReviewAllowed = true;
    const view = parseFlagshipEvidenceAssessmentResponseV4(teacherWire, "teacher");
    const markup = renderToStaticMarkup(createElement(TeacherEvidenceAssessmentSurfaceV4, {
      view,
      busy: false,
      error: null,
      onReview: () => undefined,
    }));
    expect(markup).toContain("课程教师终裁");
    expect(markup).toContain("不代表外部专家效度已经建立");
    expect(markup).toContain("disabled");
  });

  it("keeps surface signals visible only as zero-use administrator audit data", () => {
    const value = parseFlagshipEvidenceAssessmentAdminCaseResponseV4(adminResponse());
    expect(value.blindInput.surfaceSignals).toMatchObject({
      textLength: 99_999,
      allowedForScoring: false,
    });
    const markup = renderToStaticMarkup(createElement(AdminEvidenceAssessmentCaseSurfaceV4, {
      value,
    }));
    expect(markup).toContain("表面信号零使用");
    expect(markup).toContain("verified_claim_supported");
    expect(markup).toContain("挑战后置");
    expect(markup).toContain("确定性降级");
  });

  it("shows an explicit V4 administrator wait state instead of disguising V3 data", () => {
    const markup = renderToStaticMarkup(createElement(
      AdminEvidenceAssessmentNotReadySurfaceV4,
      { message: "当前尚未形成可审计的 V4 盲化评价案例" },
    ));
    expect(markup).toContain("尚无可审计的岗位证据案例");
    expect(markup).toContain("不会用旧版结果");
    expect(markup).not.toContain("能力评价重算案例");
  });

  it("shows administrator-only authority commits and ordered projection delivery without synthetic logs", () => {
    const markup = renderToStaticMarkup(createElement(
      AdminBusinessOperationTimeline,
      { operations: [completedBusinessOperationReceiptFixture()] },
    ));
    expect(markup).toContain("权威提交与恢复时间线");
    expect(markup).toContain("作品修订送审");
    expect(markup).toContain("业务闭环完成");
    expect(markup).toContain("refresh_assessment_projection");
    expect(markup).toContain("权威提交已存在");
    expect(markup).not.toContain("Prompt");
    expect(markup).not.toContain("rawPayload");

    const emptyMarkup = renderToStaticMarkup(createElement(
      AdminBusinessOperationTimeline,
      { operations: [] },
    ));
    expect(emptyMarkup).toContain("当前会话尚无跨存储业务收据");
    expect(emptyMarkup).toContain("不以模拟日志填充");
  });

  it("keeps recovery receipts available when the assessment source fails", async () => {
    const receipt = completedBusinessOperationReceiptFixture();
    const result = await loadAdminEvidence({
      ...createHttpAdminGateway({ apiBase: "http://api.local" }),
      getSessionExperienceDescriptor: async () => sessionExperienceDescriptorFixture(),
      getFlagshipEvidenceAssessmentV4: async () => { throw new GatewayHttpError(409, "来源漂移，原作品保留", "source_drift"); },
      getBusinessOperations: async () => [receipt],
    }, "session-xunpu-001", "binding-admin", new AbortController().signal);
    expect(result).toMatchObject({ kind: "assessment_unavailable_v4", message: "来源漂移，原作品保留", operations: [receipt], operationsError: null });
    if (result.kind !== "assessment_unavailable_v4") throw new Error("expected an unavailable assessment");
    const markup = renderToStaticMarkup(createElement(AdminEvidenceAssessmentNotReadySurfaceV4, { ...result, unavailable: true }));
    expect(markup).toContain("评价读取失败");
    expect(markup).toContain(receipt.authorityCommitRef);
  });

  it("reports unavailable receipts instead of presenting a false empty history", async () => {
    const view = parseFlagshipEvidenceAssessmentResponseV4(response("not_ready"), "student");
    const result = await loadAdminEvidence({
      ...createHttpAdminGateway({ apiBase: "http://api.local" }),
      getSessionExperienceDescriptor: async () => sessionExperienceDescriptorFixture(),
      getFlagshipEvidenceAssessmentV4: async () => view,
      getBusinessOperations: async () => { throw new GatewayHttpError(503, "收据服务暂时不可用", null); },
    }, "session-xunpu-001", "binding-admin", new AbortController().signal);
    expect(result).toMatchObject({ kind: "assessment_not_ready_v4", operationsError: "收据服务暂时不可用" });
    if (result.kind !== "assessment_not_ready_v4") throw new Error("expected not ready assessment");
    const markup = renderToStaticMarkup(createElement(AdminEvidenceAssessmentNotReadySurfaceV4, result));
    expect(markup).toContain("恢复收据读取失败");
    expect(markup).not.toContain("当前会话尚无跨存储业务收据");
  });

  it("uses the frozen student endpoint and derives identity only from the authenticated cookie", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const gateway = createHttpExperienceGateway(authFixture("student-unassigned"), {
      apiBase: "http://api.local",
      fetchImpl: async (input, init) => {
        calls.push({ url: String(input), init });
        return jsonResponse(response("not_ready"));
      },
    });

    const value = await gateway.getFlagshipEvidenceAssessmentV4!(
      "session-v4-web",
      "binding-student",
    );

    expect(value.status).toBe("not_ready");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      "http://api.local/api/v4/sessions/session-v4-web/evidence-assessment?bindingId=binding-student",
    );
    expect(calls[0]?.url).not.toContain("actorId");
    expect(calls[0]?.url).not.toContain("challengeLevel");
  });

  it("sends an explicit same-evidence teacher review with CSRF and no browser-authored verdict context", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const teacherWire = response("provisional");
    teacherWire.assessment.audience = "teacher";
    const gateway = createHttpTeacherGateway(authFixture("teacher-class-a"), {
      apiBase: "http://api.local",
      fetchImpl: async (input, init) => {
        calls.push({ url: String(input), init });
        return jsonResponse(teacherWire);
      },
    });

    await gateway.getFlagshipEvidenceAssessmentV4!("session-v4-web", "binding-teacher");
    await gateway.reviewFlagshipEvidenceAssessmentV4!({
      sessionId: "session-v4-web",
      bindingId: "binding-teacher",
      expectedAssessmentDecisionId: "assessment-provisional",
      requestId: "request-v4-review",
      status: "revised",
      rubricApplicabilityConfirmed: true,
      reason: "已核对同一组岗位证据并修订量规判断。",
      criterionRevisions: [{
        criterionId: "criterion-editorial-judgment",
        band: "medium",
        score: 72,
        rationale: "选择理由成立，但对社区利益相关方的解释仍不充分。",
      }],
    });

    expect(calls[0]?.url).toBe(
      "http://api.local/api/v4/sessions/session-v4-web/evidence-assessment?bindingId=binding-teacher",
    );
    expect(calls[1]?.url).toBe(
      "http://api.local/api/v4/sessions/session-v4-web/evidence-assessment-reviews",
    );
    expect(new Headers(calls[1]?.init?.headers).get("X-CSRF-Token"))
      .toBe("csrf-v4-assessment");
    const body = JSON.parse(String(calls[1]?.init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      bindingId: "binding-teacher",
      expectedAssessmentDecisionId: "assessment-provisional",
      rubricApplicabilityConfirmed: true,
      status: "revised",
    });
    expect(body).not.toHaveProperty("actorId");
    expect(body).not.toHaveProperty("challengeLevel");
    expect(body).not.toHaveProperty("blindInput");
    expect(body).not.toHaveProperty("agentAdvice");
  });

  it("keeps the complete blind case on the administrator-only endpoint", async () => {
    const calls: string[] = [];
    const gateway = createHttpAdminGateway({
      apiBase: "http://api.local",
      fetchImpl: async (input) => {
        calls.push(String(input));
        return String(input).includes("/api/v4/admin/")
          ? jsonResponse(adminResponse())
          : jsonResponse({
            assessment: {
              ...response().assessment,
              audience: "admin",
              teacherReviewAllowed: true,
            },
          });
      },
    });

    const summary = await gateway.getFlagshipEvidenceAssessmentV4!(
      "session-v4-web",
      "binding-admin",
    );
    const value = await gateway.getFlagshipEvidenceAssessmentCaseV4!(
      "session-v4-web",
      "binding-admin",
    );

    expect(summary.audience).toBe("admin");
    expect(value.antiGaming.surfaceSignalsUsed).toBe(false);
    expect(calls).toEqual([
      "http://api.local/api/v4/sessions/session-v4-web/evidence-assessment?bindingId=binding-admin",
      "http://api.local/api/v4/admin/sessions/session-v4-web/evidence-assessment-case?bindingId=binding-admin",
    ]);
  });
});
