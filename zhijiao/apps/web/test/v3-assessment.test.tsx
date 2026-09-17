import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AssessmentDecisionSchema,
  AssessmentDecisionSchemaVersion,
  CompetencyEvidenceEpisodeSchema,
  CompetencyEvidenceEpisodeSchemaVersion,
  type AssessmentDecision,
} from "@ronggang/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  parseFlagshipAssessmentCaseResponse,
  parseFlagshipCompetencyEvidenceResponse,
  type FlagshipAssessmentCaseV3,
  type FlagshipCompetencyEvidenceViewV3,
} from "../src/v2/assessment-v3";
import { createHttpTeacherGateway } from "../src/v2/teacher-gateway";
import { createHttpAdminGateway } from "../src/v2/admin-gateway";
import { StudentFlagshipAssessmentSurface } from "../src/v2/pages/student-flagship-assessment-v3";
import { TeacherFlagshipAssessmentSurface } from "../src/v2/pages/teacher-flagship-assessment-v3";
import { AdminAssessmentCaseSurface } from "../src/v2/pages/admin-evidence-page";

const hash = "a".repeat(64);
const courseReleaseRef = {
  courseId: "course-xunpu-intangible-media",
  releaseId: "course-xunpu-intangible-media-r2",
  version: 2,
  contentHash: hash,
};
const simulationReleaseRef = {
  simulationId: "simulation-xunpu-living-world",
  releaseId: "simulation-xunpu-living-world-r2",
  version: 2,
  contentHash: "b".repeat(64),
};
const criteria = [
  ["criterion-fact-verification", "事实与信源核验", 20, 3],
  ["criterion-interview-consent", "采访、沟通与知情边界", 18, 3],
  ["criterion-editorial-judgment", "编辑判断与独立性", 18, 3],
  ["criterion-rights-governance", "素材权利与内容治理", 16, 3],
  ["criterion-multiplatform-production", "融媒体作品生产与适配", 14, 2],
  ["criterion-recovery-transfer", "纠错恢复、协作与迁移", 14, 2],
] as const;

function assessment(status: "insufficient_evidence" | "provisional" | "final"):
AssessmentDecision {
  const scored = status !== "insufficient_evidence";
  const final = status === "final";
  return AssessmentDecisionSchema.parse({
    schemaVersion: AssessmentDecisionSchemaVersion,
    assessmentDecisionId: `assessment-${status}`,
    sessionId: "demo-xunpu-v2",
    bindingId: "binding-student-xunpu",
    learnerTwinRef: "learner-twin-demo-xunpu-v3",
    courseReleaseRef,
    simulationReleaseRef,
    challengeAssignmentRef: "challenge-demo-xunpu-v3",
    challengeLevel: 5,
    scoreCeiling: 90,
    completionStatus: scored ? "submitted" : "in_progress",
    scoreStatus: status,
    sessionScore: scored ? 82 : null,
    competencyEstimates: criteria.map(([competencyClaimId]) => ({
      competencyClaimId,
      evidenceStatus: scored ? "supported" : "insufficient",
      competencyLevel: scored ? 4 : null,
      score: scored ? 82 : null,
      confidence: scored ? 0.78 : 0,
      evidenceEpisodeRefs: scored ? ["evidence-episode-1"] : [],
      rationale: scored
        ? "作品与现场行动形成相互印证的真实岗位证据，等待教师逐维复核。"
        : "证据不足：需要更多独立作品、现场决定与修订轨迹。",
    })),
    evidenceEpisodeRefs: scored ? ["evidence-episode-1"] : [],
    growthSummary: scored
      ? "六个维度已经形成系统暂定判断，教师复核后方可固定。"
      : "已有真实过程记录，但至少一个必评维度未过证据门，因此不显示分数。",
    nextGrowthTargets: ["criterion-interview-consent", "criterion-recovery-transfer"],
    teacherReview: final ? {
      status: "confirmed",
      reviewerId: "teacher-reviewer",
      reviewedAt: "2026-08-26T05:30:00.000Z",
      reason: "已逐项核对作品、行动与后果，确认本轮评价。",
    } : {
      status: "pending",
      reviewerId: null,
      reviewedAt: null,
      reason: null,
    },
    generatedAt: "2026-08-26T05:20:00.000Z",
  });
}

const evidenceEpisode = CompetencyEvidenceEpisodeSchema.parse({
  schemaVersion: CompetencyEvidenceEpisodeSchemaVersion,
  evidenceEpisodeId: "evidence-episode-1",
  sessionId: "demo-xunpu-v2",
  bindingId: "binding-student-xunpu",
  actorId: "student-reporter",
  courseReleaseRef,
  simulationReleaseRef,
  challengeAssignmentRef: "challenge-demo-xunpu-v3",
  sourceKind: "real_student_action",
  sourceActionRefs: ["work-action-interview"],
  observations: [{
    observationId: "observation-interview",
    competencyClaimId: "criterion-interview-consent",
    direction: "supports",
    observableBehavior: "学生说明记者身份、报道用途与公开边界，并针对不确定说法继续追问。",
    sourceRefs: ["work-action-interview"],
    artifactRevisionRefs: [],
    worldConsequenceRefs: [],
    scaffoldingLevel: 1,
    evaluatorConfidence: 0.78,
  }],
  evidenceEligible: true,
  collectedAt: "2026-08-26T05:10:00.000Z",
});

function evidenceView(
  audience: "student" | "teacher" | "admin",
  status: "insufficient_evidence" | "provisional" | "final",
): FlagshipCompetencyEvidenceViewV3 {
  return {
    schemaVersion: "flagship-competency-evidence-view/3.0.0",
    audience,
    assessmentBoundary: {
      artifactCompletionIsNotCompetencyScore: true,
      evidenceInsufficientMeansNoScore: true,
      finalAuthority: "teacher",
      rubricReviewStatus: "pending_expert_review",
    },
    assessment: assessment(status),
    evidenceEpisodes: status === "insufficient_evidence" ? [] : [evidenceEpisode],
    criteria: criteria.map(([competencyClaimId, title, weight, minimum]) => ({
      competencyClaimId,
      title,
      weight,
      minimumIndependentEvidenceCount: minimum,
      observableEvidence: ["必须来自真实岗位行为"],
    })),
    generatedAt: "2026-08-26T05:20:00.000Z",
  };
}

function assessmentCase(): FlagshipAssessmentCaseV3 {
  return {
    schemaVersion: "flagship-assessment-case-view/3.0.0",
    sessionId: "demo-xunpu-v2",
    sourceHash: "c".repeat(64),
    assessmentBoundary: {
      evaluatorSeesIdentity: false,
      evaluatorSeesChallengeLevel: false,
      evaluatorSeesAgentAdvice: false,
      completionIsScore: false,
      finalAuthority: "teacher",
      rubricReviewStatus: "pending_expert_review",
    },
    evidenceEpisodes: [evidenceEpisode],
    semanticReceipts: [{
      semanticReceiptId: "semantic-receipt-1",
      evidenceEpisodeId: "evidence-episode-1",
      competencyClaimId: "criterion-interview-consent",
      evaluatorMode: "deterministic_demo",
      inputHash: "d".repeat(64),
      outputHash: "e".repeat(64),
      direction: "supports",
      rawScore: 78,
      confidence: 0.72,
      rationale: "去身份作品文本形成采访边界证据。",
      evaluatedAt: "2026-08-26T05:20:00.000Z",
    }],
    scoreComputations: criteria.map(([competencyClaimId, , , minimum]) => ({
      competencyClaimId,
      rawSemanticScore: 78,
      behaviorAdjustment: 2,
      challengeAdjustment: 4,
      normalizedScore: competencyClaimId === "criterion-interview-consent" ? 84 : null,
      minimumIndependentEvidenceCount: minimum,
      eligibleIndependentEvidenceCount: competencyClaimId === "criterion-interview-consent" ? 3 : 0,
      failClosedReasons: competencyClaimId === "criterion-interview-consent" ? [] : ["证据不足"],
      evidenceEpisodeRefs: competencyClaimId === "criterion-interview-consent" ? ["evidence-episode-1"] : [],
    })),
    decisionHistory: [assessment("insufficient_evidence")],
    reviewReceipts: [],
    recomputation: {
      sourceHashAlgorithm: "sha256-canonical-json",
      semanticInputHashRecorded: true,
      challengeAppliedAfterBlindEvaluation: true,
      sourceRecordRevision: 3,
    },
    updatedAt: "2026-08-26T05:20:00.000Z",
  };
}

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("V3 evidence-centred competency assessment", () => {
  it("renders no numeric score when evidence is insufficient and keeps the student view instructional", () => {
    const markup = renderToStaticMarkup(createElement(StudentFlagshipAssessmentSurface, {
      view: evidenceView("student", "insufficient_evidence"),
      navigate: vi.fn(),
    }));
    expect(markup).toContain("暂不出分");
    expect(markup).toContain("下一步：补齐最薄弱的真实证据");
    expect(markup).toContain("完成进度不会自动换算成能力分");
    for (const forbidden of ["semanticReceipt", "inputHash", "outputHash", "provider", "Trace", "Prompt"]) {
      expect(markup).not.toContain(forbidden);
    }
  });

  it("renders six teacher decisions and distinguishes provisional from final authority", () => {
    const markup = renderToStaticMarkup(createElement(TeacherFlagshipAssessmentSurface, {
      view: evidenceView("teacher", "provisional"),
      busy: false,
      error: null,
      onReview: vi.fn(),
    }));
    expect(markup).toContain("教师逐维复核");
    expect(markup).toContain("系统暂定 · 等待教师复核");
    expect(markup.match(/确认系统暂定判断/g)).toHaveLength(6);
    expect(markup).toContain("盲评端口看不到学生身份、挑战等级或智能体建议");
    expect(markup).not.toContain("inputHash");
  });

  it("renders the administrator-only recomputation path and semantic hashes", () => {
    const markup = renderToStaticMarkup(createElement(AdminAssessmentCaseSurface, {
      value: assessmentCase(),
    }));
    expect(markup).toContain("能力评价重算案例");
    expect(markup).toContain("盲评隔离");
    expect(markup).toContain("六维计分路径");
    expect(markup).toContain("去身份语义回执");
    expect(markup).toContain("dddddddddddd → eeeeeeeeeeee");
  });

  it("strictly parses role-safe evidence and administrator cases", () => {
    expect(parseFlagshipCompetencyEvidenceResponse({
      evidence: evidenceView("teacher", "provisional"),
    }, "teacher").assessment.sessionScore).toBe(82);
    expect(parseFlagshipAssessmentCaseResponse({
      assessmentCase: assessmentCase(),
    }).recomputation.sourceRecordRevision).toBe(3);
    expect(() => parseFlagshipCompetencyEvidenceResponse({
      evidence: {
        ...evidenceView("student", "insufficient_evidence"),
        semanticReceipts: [],
      },
    }, "student")).toThrow("字段不符合冻结接口");
    expect(() => parseFlagshipAssessmentCaseResponse({
      assessmentCase: {
        ...assessmentCase(),
        assessmentBoundary: {
          ...assessmentCase().assessmentBoundary,
          evaluatorSeesIdentity: true,
        },
      },
    })).toThrow("安全边界");
  });

  it("uses frozen V3 endpoints and sends teacher revisions with CSRF while admin remains read-only", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const teacher = createHttpTeacherGateway({
      profileId: "teacher-class-a",
      principal: {
        principalId: "principal-teacher",
        kind: "human",
        displayName: "课程教师",
        status: "active",
        createdAt: "2026-08-26T05:00:00.000Z",
      },
      bindings: [],
      csrfToken: "csrf-assessment",
      expiresAt: "2026-08-27T05:00:00.000Z",
    }, {
      apiBase: "http://api.local",
      fetchImpl: async (input, init) => {
        const url = String(input);
        calls.push({ url, init });
        return response({ evidence: evidenceView("teacher", "provisional") });
      },
    });
    await teacher.getFlagshipCompetencyEvidence!("demo-xunpu-v2", "binding-teacher");
    await teacher.reviewFlagshipAssessment!({
      sessionId: "demo-xunpu-v2",
      bindingId: "binding-teacher",
      expectedAssessmentDecisionId: "assessment-provisional",
      requestId: "request-review",
      status: "revised",
      reason: "依据真实证据完成逐项教师修订。",
      competencyRevisions: [{
        competencyClaimId: "criterion-fact-verification",
        score: 76,
        competencyLevel: 4,
        rationale: "事实链完整，但限定措辞仍需加强。",
      }],
    });
    expect(calls[0]?.url).toContain("/competency-evidence?bindingId=binding-teacher");
    expect(calls[1]?.url).toContain("/assessment-decisions");
    expect(new Headers(calls[1]?.init?.headers).get("X-CSRF-Token")).toBe("csrf-assessment");
    expect(JSON.parse(String(calls[1]?.init?.body))).not.toHaveProperty("actorId");

    const adminCalls: string[] = [];
    const admin = createHttpAdminGateway({
      apiBase: "http://api.local",
      fetchImpl: async (input) => {
        adminCalls.push(String(input));
        return response({ assessmentCase: assessmentCase() });
      },
    });
    await admin.getFlagshipAssessmentCase!("demo-xunpu-v2", "binding-admin");
    expect(adminCalls).toEqual([
      "http://api.local/api/v3/admin/sessions/demo-xunpu-v2/assessment-case?bindingId=binding-admin",
    ]);
  });
});
