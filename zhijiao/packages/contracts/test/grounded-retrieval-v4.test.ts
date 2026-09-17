import { describe, expect, it } from "vitest";
import {
  GroundedCollaborationPlanV4Schema,
  GroundedRetrievalAuthorizationScopeV4Schema,
  GroundedRetrievalCitationV4Schema,
  GroundedRetrievalResultV4Schema,
} from "../src/index.js";

const fixedNow = "2026-08-28T09:00:00.000Z";
const hash = "a".repeat(64);

function citation(overrides: Record<string, unknown> = {}) {
  return GroundedRetrievalCitationV4Schema.parse({
    knowledgeRef: "knowledge-source-001",
    sourceDocumentRef: "source-document-001",
    sourceRevision: "source-revision-001",
    fragmentRef: "source-fragment-001",
    fragmentHash: hash,
    sourceRef: "source-ref-001",
    sourceKind: "external_url",
    sourceTitle: "原始来源材料",
    sourceUrl: "https://example.com/source-001",
    snippet: "可定位的原始片段。",
    locator: "第 3 页，第 2 段",
    objectRefs: ["artifact-source-matrix"],
    supportsClaimRefs: ["claim-source-year"],
    evidenceKinds: ["source_comparison"],
    stance: "supports",
    reviewStatus: "verified",
    effectiveAt: fixedNow,
    expiresAt: null,
    revokedAt: null,
    ...overrides,
  });
}

describe("Grounded retrieval v4 contract", () => {
  it("requires course/knowledge/object authorization scope and rejects empty scope", () => {
    const scope = GroundedRetrievalAuthorizationScopeV4Schema.parse({
      sessionId: "session-grounded",
      courseReleaseRef: {
        courseId: "course-xunpu",
        releaseId: "release-xunpu",
        version: 4,
        contentHash: hash,
      },
      studentBindingHash: hash,
      purpose: "grounded_collaboration",
      audience: "agent",
      allowedObjectRefs: ["artifact-source-matrix"],
      allowedClaimRefs: ["claim-source-year"],
    allowedKnowledgeRefs: ["knowledge-source-001"],
    allowedSourceRevisionRefs: [],
    schemaVersion: "grounded-evidence-authorization/4.0.0",
    status: "empty",
    authorizationHash: hash,
    allowedFragments: [],
    expiredClaimRefs: [],
    revokedClaimRefs: [],
    grantedAt: fixedNow,
    expiresAt: null,
    failureReason: "没有可用片段",
    });
    expect(scope.allowedKnowledgeRefs).toEqual(["knowledge-source-001"]);
    expect(() => GroundedRetrievalAuthorizationScopeV4Schema.parse({
      ...scope,
      allowedKnowledgeRefs: [],
    })).toThrow();
  });

  it("keeps fragment hash, revision, locator, expiry and revocation auditable", () => {
    expect(citation({ revokedAt: fixedNow })).toMatchObject({
      fragmentHash: hash,
      sourceRevision: "source-revision-001",
      revokedAt: fixedNow,
    });
    expect(() => GroundedRetrievalCitationV4Schema.parse({
      ...citation(),
      fragmentHash: "bad",
    })).toThrow();
  });

  it("accepts a dynamic two-step plan and rejects a plan without proposal/joint bounds", () => {
    const plan = GroundedCollaborationPlanV4Schema.parse({
      schemaVersion: "grounded-retrieval/4.0.0",
      planId: "plan-grounded-001",
      retrievalQueryHash: hash,
      retrievalResultHash: "b".repeat(64),
      steps: [
        {
          stepId: "plan-step-proposal",
          moveKind: "proposal",
          agentTemplateRef: "agent-template-editor",
          position: "propose",
          safeSummary: "先区分已知与未知。",
          rationale: "先建立可审计的事实边界。",
          stopCondition: "continue",
        },
        {
          stepId: "plan-step-joint",
          moveKind: "joint_proposal",
          agentTemplateRef: "agent-template-teaching-director",
          position: "joint",
          safeSummary: "保留学生的合法选择。",
          rationale: "联合建议不替学生决定。",
          stopCondition: "joint",
        },
      ],
      unresolvedClaimRefs: [],
      conflictRefs: [],
      plannerState: "sufficient",
      publicSummary: "当前材料足够形成短链建议。",
      recommendedActionRefs: ["action-compare-primary-locators"],
    });
    expect(plan.steps).toHaveLength(2);
    expect(() => GroundedCollaborationPlanV4Schema.parse({
      ...plan,
      steps: [plan.steps[0]],
    })).toThrow();
    expect(GroundedRetrievalResultV4Schema.parse({
      schemaVersion: "grounded-retrieval/4.0.0",
      status: "ok",
      queryHash: hash,
      resultHash: "b".repeat(64),
      authorizationHash: hash,
      citations: [citation()],
      unresolvedClaimRefs: [],
      conflictRefs: [],
      expiredClaimRefs: [],
      revokedClaimRefs: [],
      retrievedAt: fixedNow,
      failureReason: null,
    }).citations).toHaveLength(1);
  });
});
