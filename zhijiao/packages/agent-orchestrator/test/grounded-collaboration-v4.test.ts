import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FlagshipContentReferenceV4SchemaVersion,
  type FlagshipContentReferenceV4,
  type GroundedRetrievalCitationV4,
  type GroundedEvidenceAuthorizationFragmentV4,
} from "@ronggang/contracts";
import {
  xunpuCourseRelease,
  xunpuFlagshipContentV4,
} from "@ronggang/course-content";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  InMemoryGroundedCollaborationStoreV4,
  InMemoryGroundedEvidenceAuthorizationResolverV4,
  InMemoryGroundedRetrievalPortV4,
  JsonFileGroundedCollaborationStoreV4,
  XunpuGroundedCollaborationServiceV4,
  buildXunpuGroundedCollaborationRuntimeContentV4,
  issueGroundedWorldConsequenceTokenV4,
  observeGroundedCollaborationAblationV4,
  recomputeGroundedDispatchV4,
  type GroundedCollaborationModelV4,
  type GroundedCollaborationModelInputV4,
  type GroundedCollaborationPolicyV4,
  type GroundedCollaborationStoreV4,
  type GroundedEvidenceSnapshotV4,
  type GroundedRetrievalPortV4,
  type GroundedEvidenceAuthorizationResolverV4,
  type StartGroundedCollaborationEpisodeV4Input,
} from "../src/index.js";

const decisionSecret = "grounded-decision-secret-for-v4-tests";
const worldAuthoritySecret = "grounded-world-authority-secret-v4-tests";
const fixedNow = "2026-08-28T09:00:00.000Z";
const temporaryDirectories: string[] = [];
const worldVersions = new Map<string, number>();

const flagshipContentRef: FlagshipContentReferenceV4 = {
  schemaVersion: FlagshipContentReferenceV4SchemaVersion,
  contentSchemaVersion: xunpuFlagshipContentV4.schemaVersion,
  courseReleaseRef: {
    courseId: xunpuFlagshipContentV4.courseId,
    releaseId: "course-xunpu-r4",
    version: 4,
    contentHash: "a".repeat(64),
  },
  scenarioReleaseRef: {
    scenarioId: xunpuFlagshipContentV4.scenarioId,
    version: "4.0.0",
    contentHash: "b".repeat(64),
  },
  simulationReleaseRef: {
    simulationId: "simulation-xunpu-living-world",
    releaseId: "simulation-xunpu-r4",
    version: 4,
    contentHash: "c".repeat(64),
  },
  contentHash: xunpuFlagshipContentV4.contentHash,
};

const runtimeContent = buildXunpuGroundedCollaborationRuntimeContentV4({
  content: xunpuFlagshipContentV4,
  baseKnowledge: xunpuCourseRelease.knowledgeRecords,
  addedKnowledge: xunpuFlagshipContentV4.addedKnowledgeRecords,
});

function service(input: {
  store?: GroundedCollaborationStoreV4;
  model?: GroundedCollaborationModelV4;
  groundingMode?: "legacy" | "retrieval";
  retrieval?: GroundedRetrievalPortV4;
  authorizationResolver?: GroundedEvidenceAuthorizationResolverV4;
  now?: () => string;
} = {}) {
  return new XunpuGroundedCollaborationServiceV4({
    store: input.store ?? new InMemoryGroundedCollaborationStoreV4(),
    content: runtimeContent,
    flagshipContentRef,
    decisionSecret,
    worldAuthoritySecret,
    getCurrentWorldStateVersion: async (sessionId) => (
      worldVersions.get(sessionId) ?? 7
    ),
    ...(input.model === undefined ? {} : { model: input.model }),
    groundingMode: input.groundingMode ?? "legacy",
    ...(input.retrieval === undefined ? {} : { retrieval: input.retrieval }),
    ...(input.authorizationResolver === undefined
      ? {}
      : { authorizationResolver: input.authorizationResolver }),
    now: input.now ?? (() => fixedNow),
  });
}

function episodeClaims(episodeTemplateRef: string): string[] {
  return [...xunpuFlagshipContentV4.agentEpisodes.find((episode) => (
    episode.episodeTemplateId === episodeTemplateRef
  ))!.groundedClaimRefs];
}

function evidenceFor(
  episodeTemplateRef: string,
): GroundedEvidenceSnapshotV4[] {
  if (episodeTemplateRef === "episode-media-rights-challenge") {
    return [
      {
        evidenceRef: "evidence-media-metadata",
        evidenceKind: "asset_metadata",
        objectRefs: ["artifact-rights-ledger"],
        contentHash: "d".repeat(64),
      },
      {
        evidenceRef: "evidence-consent-withdrawal",
        evidenceKind: "withdrawal_receipt",
        objectRefs: ["entity-rights-contact"],
        contentHash: "e".repeat(64),
      },
    ];
  }
  if (episodeTemplateRef === "episode-breaking-rumor-challenge") {
    return [
      {
        evidenceRef: "evidence-rumor-source-comparison",
        evidenceKind: "source_comparison",
        objectRefs: ["artifact-fact-check-sheet"],
        contentHash: "f".repeat(64),
      },
      {
        evidenceRef: "evidence-public-receipt",
        evidenceKind: "official_receipt",
        objectRefs: ["entity-public-liaison"],
        contentHash: "1".repeat(64),
      },
    ];
  }
  return [{
    evidenceRef: "evidence-year-source-comparison",
    evidenceKind: "source_comparison",
    objectRefs: ["artifact-source-matrix"],
    contentHash: "2".repeat(64),
  }];
}

function affectedObjects(episodeTemplateRef: string): string[] {
  if (episodeTemplateRef === "episode-media-rights-challenge") {
    return ["entity-rights-contact", "artifact-rights-ledger"];
  }
  if (episodeTemplateRef === "episode-breaking-rumor-challenge") {
    return [
      "entity-public-liaison",
      "artifact-fact-check-sheet",
      "artifact-multiplatform-package",
    ];
  }
  return ["entity-researcher", "artifact-source-matrix"];
}

function startInput(
  episodeTemplateRef: string,
  input: {
    episodeId?: string;
    sessionId?: string;
    policy?: GroundedCollaborationPolicyV4;
    evidence?: GroundedEvidenceSnapshotV4[];
    sourceWorldStateVersion?: number;
    maximumSelectedAgents?: number;
    executionBudgetMicros?: number;
  } = {},
): StartGroundedCollaborationEpisodeV4Input {
  return {
    episodeId: input.episodeId ?? `episode-run-${episodeTemplateRef}`,
    sessionId: input.sessionId ?? "session-grounded-v4",
    studentBindingId: "binding-student-grounded",
    flagshipContentRef,
    episodeTemplateRef,
    sourceWorldStateVersion: input.sourceWorldStateVersion ?? 7,
    triggerEventRef: `world-event-${episodeTemplateRef}`,
    affectedObjectRefs: affectedObjects(episodeTemplateRef),
    claimRefs: episodeClaims(episodeTemplateRef),
    evidence: input.evidence ?? evidenceFor(episodeTemplateRef),
    policy: input.policy ?? "affected_set",
    maximumSelectedAgents: input.maximumSelectedAgents ?? 5,
    executionBudgetMicros: input.executionBudgetMicros ?? 0,
  };
}

function retrievalCitationsFor(
  episodeTemplateRef: string,
  stance: "supports" | "conflict" | "revoked",
): GroundedRetrievalCitationV4[] {
  const claimRefs = episodeClaims(episodeTemplateRef);
  const objectRefs = affectedObjects(episodeTemplateRef);
  const knowledgeRefs = [...new Set(runtimeContent.claims
    .filter((claim) => claimRefs.includes(claim.claimRef))
    .flatMap((claim) => claim.knowledgeRefs))];
  return knowledgeRefs.slice(0, stance === "conflict" ? 2 : 1).map((knowledgeRef, index) => {
    const knowledge = runtimeContent.knowledge.find((item) => item.knowledgeRef === knowledgeRef)!;
    return {
      knowledgeRef,
      sourceDocumentRef: `source-document-${index + 1}`,
      sourceRevision: `source-revision-${index + 1}`,
      fragmentRef: `source-fragment-${index + 1}-${stance}`,
      fragmentHash: knowledge.sourceContentHash,
      sourceRef: `source-ref-${index + 1}`,
      sourceKind: "external_url",
      sourceTitle: knowledge.sourceTitle,
      sourceUrl: knowledge.sourceUrl,
      snippet: stance === "conflict"
        ? `${knowledge.teachingSummary} 该片段与另一版本存在冲突。`
        : knowledge.teachingSummary,
      locator: knowledge.locator,
      objectRefs,
      supportsClaimRefs: claimRefs,
      evidenceKinds: ["source_comparison"],
      stance: stance === "conflict" && index === 1 ? "refutes" : "supports",
      reviewStatus: "verified",
      effectiveAt: fixedNow,
      expiresAt: null,
      revokedAt: stance === "revoked" ? fixedNow : null,
    };
  });
}

function authorizationResolverFor(
  citations: readonly GroundedRetrievalCitationV4[],
  now: () => string = () => fixedNow,
): InMemoryGroundedEvidenceAuthorizationResolverV4 {
  const fragments: GroundedEvidenceAuthorizationFragmentV4[] = citations.map((citation) => ({
    knowledgeRef: citation.knowledgeRef,
    sourceDocumentRef: citation.sourceDocumentRef,
    sourceRevision: citation.sourceRevision,
    fragmentRef: citation.fragmentRef,
    fragmentHash: citation.fragmentHash,
    sourceRef: citation.sourceRef,
    sourceKind: citation.sourceKind,
    sourceUrl: citation.sourceUrl,
    sourceTitle: citation.sourceTitle,
    snippet: citation.snippet,
    locator: citation.locator,
    objectRefs: [...citation.objectRefs],
    supportsClaimRefs: [...citation.supportsClaimRefs],
    evidenceKinds: [...citation.evidenceKinds],
    reviewStatus: citation.reviewStatus,
    effectiveAt: citation.effectiveAt,
    expiresAt: citation.expiresAt,
    revokedAt: citation.revokedAt,
  }));
  return new InMemoryGroundedEvidenceAuthorizationResolverV4({
    courseReleaseRef: flagshipContentRef.courseReleaseRef,
    fragments,
    now,
  });
}

afterEach(async () => {
  worldVersions.clear();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => (
      rm(directory, { recursive: true, force: true })
    )),
  );
});

describe("V4 知识接地多智能体协作", () => {
  it("从 36 条发布知识构建无悬空引用的运行索引，并拒绝退役来源", () => {
    expect(runtimeContent.knowledge).toHaveLength(36);
    expect(runtimeContent.claims).toHaveLength(12);
    expect(runtimeContent.episodes).toHaveLength(3);
    expect(runtimeContent.knowledge.every((item) => (
      item.sourceUrl.startsWith("https://")
        && item.locator.length > 0
        && /^[a-f0-9]{64}$/u.test(item.sourceContentHash)
    ))).toBe(true);

    const retired = structuredClone(xunpuCourseRelease.knowledgeRecords);
    retired[0]!.reviewStatus = "retired";
    expect(() => buildXunpuGroundedCollaborationRuntimeContentV4({
      content: xunpuFlagshipContentV4,
      baseKnowledge: retired,
      addedKnowledge: xunpuFlagshipContentV4.addedKnowledgeRecords,
    })).toThrow("未知或退役知识");
  });

  it("真实片段变化会改变协作计划、角色链和学生建议", async () => {
    const episodeTemplateRef = "episode-source-year-challenge";
    const cleanService = service({
      groundingMode: "retrieval",
      retrieval: new InMemoryGroundedRetrievalPortV4({
        citations: retrievalCitationsFor(episodeTemplateRef, "supports"),
        now: () => fixedNow,
      }),
      authorizationResolver: authorizationResolverFor(
        retrievalCitationsFor(episodeTemplateRef, "supports"),
      ),
    });
    const conflictCitations = retrievalCitationsFor(episodeTemplateRef, "conflict");
    const conflictService = service({
      groundingMode: "retrieval",
      retrieval: new InMemoryGroundedRetrievalPortV4({
        citations: conflictCitations,
        now: () => fixedNow,
      }),
      authorizationResolver: authorizationResolverFor(conflictCitations),
    });
    const clean = await cleanService.startEpisode(startInput(episodeTemplateRef, {
      episodeId: "episode-retrieval-clean",
    }));
    const conflict = await conflictService.startEpisode(startInput(episodeTemplateRef, {
      episodeId: "episode-retrieval-conflict",
    }));

    expect(clean.request.retrieval?.status).toBe("ok");
    expect(clean.plan?.plannerState).toBe("sufficient");
    expect(clean.plan?.steps).toHaveLength(3);
    expect(conflict.plan?.plannerState).toBe("conflicted");
    expect(conflict.plan?.steps).toHaveLength(5);
    expect(conflict.plan?.publicSummary).not.toBe(clean.plan?.publicSummary);
    expect(conflict.moves[1]?.safeSummary).toContain("冲突");
    expect(clean.jointProposal?.recommendedActionRefs).not.toEqual(
      conflict.jointProposal?.recommendedActionRefs,
    );
    expect(clean.moves[0]?.knowledgeCitations[0]).toMatchObject({
      sourceRevision: "source-revision-1",
      fragmentHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      snippet: expect.any(String),
    });
  });

  it("检索库不可用或片段撤回时暂停，不伪造引用或继续固定五步", async () => {
    const revokedCitations = retrievalCitationsFor("episode-source-year-challenge", "revoked");
    const revoked = await service({
      groundingMode: "retrieval",
      retrieval: new InMemoryGroundedRetrievalPortV4({
        citations: revokedCitations,
        now: () => fixedNow,
      }),
      authorizationResolver: authorizationResolverFor(revokedCitations),
    }).startEpisode(startInput("episode-source-year-challenge", {
      episodeId: "episode-retrieval-revoked",
    }));
    expect(revoked).toMatchObject({
      status: "in_progress",
      failure: null,
      tasks: [],
      runs: [],
      moves: [],
      jointProposal: null,
    });
    expect(revoked.request.retrieval?.revokedClaimRefs.length).toBeGreaterThan(0);

    const approved = retrievalCitationsFor("episode-source-year-challenge", "supports");
    const tampered = structuredClone(approved);
    tampered[0]!.sourceRevision = "unapproved-revision-qa";
    const tamperedSameHashRecord = await service({
      groundingMode: "retrieval",
      retrieval: new InMemoryGroundedRetrievalPortV4({
        citations: tampered,
        now: () => fixedNow,
      }),
      authorizationResolver: authorizationResolverFor(approved),
    }).startEpisode(startInput("episode-source-year-challenge", {
      episodeId: "episode-retrieval-unapproved-revision",
    }));
    expect(tamperedSameHashRecord).toMatchObject({
      status: "in_progress",
      failure: null,
      tasks: [],
      jointProposal: null,
    });

    const partial = retrievalCitationsFor("episode-source-year-challenge", "supports");
    partial[0]!.supportsClaimRefs = [episodeClaims("episode-source-year-challenge")[0]!];
    const partialService = service({
      groundingMode: "retrieval",
      retrieval: new InMemoryGroundedRetrievalPortV4({
        citations: partial,
        now: () => fixedNow,
      }),
      authorizationResolver: authorizationResolverFor(partial),
    });
    const partialRecord = await partialService.startEpisode(startInput(
      "episode-source-year-challenge",
      { episodeId: "episode-retrieval-partial" },
    ));
    expect(partialRecord).toMatchObject({
      status: "in_progress",
      moves: [
        { moveKind: "proposal" },
        { moveKind: "evidence_request" },
      ],
      jointProposal: null,
    });
    expect((await partialService.startEpisode(startInput(
      "episode-source-year-challenge",
      { episodeId: "episode-retrieval-partial" },
    ))).moves).toHaveLength(2);

    let currentCitations = partial;
    const refreshService = service({
      groundingMode: "retrieval",
      retrieval: {
        retrieve: (input) => new InMemoryGroundedRetrievalPortV4({
          citations: currentCitations,
          now: () => fixedNow,
        }).retrieve(input),
      },
      authorizationResolver: {
        authorize: (input) => authorizationResolverFor(currentCitations).authorize(input),
      },
    });
    const refreshEpisodeId = "episode-retrieval-refresh";
    const partialRefresh = await refreshService.startEpisode(startInput(
      "episode-source-year-challenge",
      { episodeId: refreshEpisodeId },
    ));
    expect(partialRefresh.moves).toHaveLength(2);
    currentCitations = retrievalCitationsFor("episode-source-year-challenge", "supports");
    const resumed = await refreshService.resumeEpisodeWithEvidence(startInput(
      "episode-source-year-challenge",
      {
        episodeId: refreshEpisodeId,
        evidence: [
          ...evidenceFor("episode-source-year-challenge"),
          {
            evidenceRef: "evidence-year-source-comparison-2",
            evidenceKind: "source_comparison",
            objectRefs: ["artifact-source-matrix"],
            contentHash: "3".repeat(64),
          },
        ],
      },
    ));
    expect(resumed.status).toBe("joint_proposal_ready");
    expect(resumed.refreshHistory).toHaveLength(1);
    expect(resumed.refreshHistory?.[0]).toMatchObject({
      previousPlan: { plannerState: "missing_evidence" },
      previousRetrieval: { status: "ok" },
      addedEvidenceRefs: ["evidence-year-source-comparison-2"],
    });
    expect(resumed.refreshHistory?.[0]?.previousRetrieval?.resultHash)
      .not.toBe(resumed.request.retrieval?.resultHash);
    expect(resumed.moves).toHaveLength(4);
    expect(resumed.moves.slice(0, 2).map((move) => move.moveKind)).toEqual([
      "proposal",
      "evidence_request",
    ]);
    await expect(refreshService.resumeEpisodeWithEvidence(startInput(
      "episode-source-year-challenge",
      {
        episodeId: refreshEpisodeId,
        evidence: [
          ...evidenceFor("episode-source-year-challenge"),
          {
            evidenceRef: "evidence-year-source-comparison-2",
            evidenceKind: "source_comparison",
            objectRefs: ["artifact-source-matrix"],
            contentHash: "3".repeat(64),
          },
        ],
      },
    ))).resolves.toEqual(resumed);

    const approvedForTamper = retrievalCitationsFor("episode-source-year-challenge", "supports");
    const tamperedRetrieval = {
      retrieve: async (input: Parameters<GroundedRetrievalPortV4["retrieve"]>[0]) => {
        const valid = await new InMemoryGroundedRetrievalPortV4({
          citations: approvedForTamper,
          now: () => fixedNow,
        }).retrieve(input);
        return {
          ...valid,
          citations: valid.citations.map((citation) => ({
            ...citation,
            sourceRevision: "unapproved-revision-same-auth-hash",
            sourceTitle: "替换标题",
          })),
        };
      },
    };
    const tamperedRecord = await service({
      groundingMode: "retrieval",
      retrieval: tamperedRetrieval,
      authorizationResolver: authorizationResolverFor(approvedForTamper),
    }).startEpisode(startInput("episode-source-year-challenge", {
      episodeId: "episode-retrieval-tampered-citation",
    }));
    expect(tamperedRecord).toMatchObject({
      status: "in_progress",
      failure: null,
      jointProposal: null,
    });

    let clock = fixedNow;
    const clockService = service({
      groundingMode: "retrieval",
      now: () => clock,
      retrieval: {
        retrieve: (input) => new InMemoryGroundedRetrievalPortV4({
          citations: partial,
          now: () => clock,
        }).retrieve(input),
      },
      authorizationResolver: {
        authorize: (input) => authorizationResolverFor(partial, () => clock).authorize(input),
      },
    });
    const clockEpisodeId = "episode-retrieval-clock-only";
    const clockStart = await clockService.startEpisode(startInput(
      "episode-source-year-challenge",
      { episodeId: clockEpisodeId },
    ));
    clock = "2026-08-28T09:01:00.000Z";
    await expect(clockService.resumeEpisodeWithEvidence(startInput(
      "episode-source-year-challenge",
      { episodeId: clockEpisodeId },
    ))).resolves.toEqual(clockStart);

    let expiryClock = fixedNow;
    const expiring = retrievalCitationsFor("episode-source-year-challenge", "supports");
    expiring[0]!.supportsClaimRefs = [episodeClaims("episode-source-year-challenge")[0]!];
    expiring[0]!.expiresAt = "2026-08-28T10:00:00.000Z";
    const expiryService = service({
      groundingMode: "retrieval",
      now: () => expiryClock,
      retrieval: {
        retrieve: (input) => new InMemoryGroundedRetrievalPortV4({
          citations: expiring,
          now: () => expiryClock,
        }).retrieve(input),
      },
      authorizationResolver: {
        authorize: (input) => authorizationResolverFor(expiring, () => expiryClock).authorize(input),
      },
    });
    const expiryEpisodeId = "episode-retrieval-expiry";
    const expiryStart = await expiryService.startEpisode(startInput(
      "episode-source-year-challenge",
      { episodeId: expiryEpisodeId },
    ));
    expect(expiryStart.moves).toHaveLength(2);
    expiryClock = "2026-08-28T10:01:00.000Z";
    const expired = await expiryService.resumeEpisodeWithEvidence(startInput(
      "episode-source-year-challenge",
      { episodeId: expiryEpisodeId },
    ));
    expect(expired).toMatchObject({
      status: "in_progress",
      refreshHistory: [{ previousRetrieval: { status: "ok" } }],
      plan: { plannerState: "revoked_evidence" },
      request: { retrieval: { status: "forbidden" } },
    });
    expect(expired.request.retrieval?.expiredClaimRefs.length).toBeGreaterThan(0);

    let decisionClock = fixedNow;
    const decisionCitations = retrievalCitationsFor("episode-source-year-challenge", "supports");
    decisionCitations[0]!.expiresAt = "2026-08-28T10:00:00.000Z";
    const decisionService = service({
      groundingMode: "retrieval",
      now: () => decisionClock,
      retrieval: {
        retrieve: (input) => new InMemoryGroundedRetrievalPortV4({
          citations: decisionCitations,
          now: () => decisionClock,
        }).retrieve(input),
      },
      authorizationResolver: {
        authorize: (input) => authorizationResolverFor(decisionCitations, () => decisionClock).authorize(input),
      },
    });
    const decisionEpisode = await decisionService.startEpisode(startInput(
      "episode-source-year-challenge",
      { episodeId: "episode-decision-expiry" },
    ));
    expect(decisionEpisode.status).toBe("joint_proposal_ready");
    const decisionToken = await decisionService.issueStudentDecisionToken(
      decisionEpisode.episodeId,
      "binding-student-grounded",
    );
    decisionClock = "2026-08-28T10:01:00.000Z";
    await expect(decisionService.issueStudentDecisionToken(
      decisionEpisode.episodeId,
      "binding-student-grounded",
    )).rejects.toThrow("来源授权已变化");
    await expect(decisionService.recordStudentDecision({
      episodeId: decisionEpisode.episodeId,
      bindingId: "binding-student-grounded",
      decisionRef: "decision-after-expiry",
      decision: "accept",
      rationale: "我确认建议。",
      decidedAt: decisionClock,
      decisionToken,
    })).rejects.toThrow("来源授权已变化");

    const unavailable = await service({ groundingMode: "retrieval" }).startEpisode(
      startInput("episode-source-year-challenge", {
        episodeId: "episode-retrieval-unavailable",
      }),
    );
    expect(unavailable).toMatchObject({
      status: "in_progress",
      failure: null,
      tasks: [],
      runs: [],
    });
    expect(JSON.stringify(unavailable)).not.toContain("source-fragment");
  });

  it("从空资料暂停中恢复同一协作，并在同知识来源换版后只向学生呈现新引用", async () => {
    let current: GroundedRetrievalCitationV4[] = [];
    const runtime = service({ groundingMode: "retrieval",
      authorizationResolver: { authorize: (input) => authorizationResolverFor(current).authorize(input) },
      retrieval: { retrieve: (input) => new InMemoryGroundedRetrievalPortV4({ citations: current, now: () => fixedNow }).retrieve(input) },
    });
    const input = startInput("episode-source-year-challenge", { episodeId: "episode-empty-to-current" });
    const initial = await runtime.startEpisode(input);
    expect(initial).toMatchObject({ status: "in_progress", moves: [], jointProposal: null });
    expect(await runtime.getStudentEpisode(input.episodeId)).toMatchObject({ status: "waiting", suggestion: null, evidenceState: { status: "unavailable" } });
    current = retrievalCitationsFor("episode-source-year-challenge", "supports");
    const resumed = await runtime.resumeEpisodeWithEvidence(input);
    expect(resumed).toMatchObject({ status: "joint_proposal_ready" });
    const previousMoveIds = resumed.moves.map((move) => move.moveId);
    current = current.map((citation, index) => ({ ...citation, sourceRevision: `source-revision-current-${index}`,
      fragmentRef: `fragment-current-${index}`, fragmentHash: "8".repeat(64) }));
    const updated = await runtime.resumeEpisodeWithEvidence(input);
    expect(updated.moves.slice(0, previousMoveIds.length).map((move) => move.moveId)).toEqual(previousMoveIds);
    const student = await runtime.getStudentEpisode(input.episodeId);
    expect(student.evidenceState?.status).toBe("ready");
    expect(student.suggestion?.knowledgeCitations.every((citation) => citation.sourceRevision?.startsWith("source-revision-current-"))).toBe(true);
  });

  it("连续补证恢复保留超过五步历史，并通过教师与管理员公共投影校验", async () => {
    const episodeTemplateRef = "episode-source-year-challenge";
    const partial = retrievalCitationsFor(episodeTemplateRef, "supports");
    partial[0]!.supportsClaimRefs = [episodeClaims(episodeTemplateRef)[0]!];
    const current = retrievalCitationsFor(episodeTemplateRef, "supports");
    let available = partial;
    const runtime = service({
      groundingMode: "retrieval",
      retrieval: {
        retrieve: (input) => new InMemoryGroundedRetrievalPortV4({
          citations: available,
          now: () => fixedNow,
        }).retrieve(input),
      },
      authorizationResolver: {
        authorize: (input) => authorizationResolverFor(available).authorize(input),
      },
    });
    const extraEvidence = (index: number): GroundedEvidenceSnapshotV4 => ({
      evidenceRef: `evidence-year-refresh-${index}`,
      evidenceKind: "source_comparison",
      objectRefs: ["artifact-source-matrix"],
      contentHash: `${index}`.repeat(64),
    });
    const episodeId = "episode-retrieval-history-over-five";
    const initial = await runtime.startEpisode(startInput(episodeTemplateRef, { episodeId }));
    expect(initial.moves.map((move) => move.moveKind)).toEqual([
      "proposal",
      "evidence_request",
    ]);

    for (let refreshIndex = 1; refreshIndex <= 3; refreshIndex += 1) {
      available = current;
      const resumed = await runtime.resumeEpisodeWithEvidence(startInput(episodeTemplateRef, {
        episodeId,
        evidence: [
          ...evidenceFor(episodeTemplateRef),
          ...Array.from({ length: refreshIndex }, (_, index) => extraEvidence(index + 1)),
        ],
      }));
      expect(resumed.status).toBe("joint_proposal_ready");
      expect(resumed.moves).toHaveLength(3 + refreshIndex);
    }

    const [teacher, admin] = await Promise.all([
      runtime.getTeacherEpisode(episodeId),
      runtime.getAdminEpisode(episodeId),
    ]);
    expect(teacher.moves).toHaveLength(6);
    expect(admin.moves).toHaveLength(6);
    expect(teacher.moves.map((move) => move.moveKind)).toEqual([
      "proposal",
      "evidence_request",
      "challenge",
      "joint_proposal",
      "joint_proposal",
      "joint_proposal",
    ]);
    expect(admin.jointProposal?.sourceMoveRefs).toHaveLength(6);
    expect(admin.moves.every((move, index) => move.predecessorMoveRefs.length === index))
      .toBe(true);
  });

  it("把片段短引、版本和定位送入结构化模型输入并沿用同一候选校验", async () => {
    const inputs: GroundedCollaborationModelInputV4[] = [];
    const model: GroundedCollaborationModelV4 = {
      run: vi.fn(async (input: Readonly<GroundedCollaborationModelInputV4>) => {
        inputs.push(structuredClone(input));
        const citation = input.allowedKnowledge[0]!;
        return {
          output: {
            position: input.expectedPosition,
            safeSummary: `${input.approvedSafeSummary} ${citation.snippet ?? citation.locator}`,
            rationale: `${input.approvedRationale} 版本 ${citation.sourceRevision ?? "legacy"}。`,
            groundedClaimRefs: input.allowedClaims.map((item) => item.claimRef),
            knowledgeRefs: input.allowedKnowledge.map((item) => item.knowledgeRef),
            evidenceRefs: input.evidenceRefs,
          },
          providerId: "provider-retrieval-test",
          modelId: "model-retrieval-test",
          traceRef: `trace-retrieval-${input.moveKind}`,
          latencyMs: 1,
          estimatedCostMicros: 1,
        };
      }),
    };
    const modelCitations = retrievalCitationsFor("episode-source-year-challenge", "supports");
    const record = await service({
      model,
      groundingMode: "retrieval",
      retrieval: new InMemoryGroundedRetrievalPortV4({
        citations: modelCitations,
        now: () => fixedNow,
      }),
      authorizationResolver: authorizationResolverFor(modelCitations),
    }).startEpisode(startInput("episode-source-year-challenge", {
      episodeId: "episode-retrieval-model-input",
      executionBudgetMicros: 20,
    }));
    expect(inputs.length).toBe(3);
    expect(inputs[0]?.allowedKnowledge[0]).toMatchObject({
      sourceRevision: "source-revision-1",
      fragmentHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      snippet: expect.any(String),
      locator: expect.any(String),
    });
    expect(record.runs.every((run) => run.executionMode === "live")).toBe(true);
  });

  it("把 refutes/context 立场送入 Live 模型并保留公共引用，非支持材料不能提前形成联合建议", async () => {
    const source = retrievalCitationsFor(
      "episode-source-year-challenge",
      "supports",
    )[0]!;
    const stanceCitations: GroundedRetrievalCitationV4[] = [
      {
        ...source,
        sourceDocumentRef: "source-document-refutes",
        sourceRevision: "source-revision-refutes",
        fragmentRef: "source-fragment-refutes",
        sourceRef: "source-ref-refutes",
        snippet: "片段反驳：海风贝壳密码并不能证明主张。",
        stance: "refutes",
      },
      {
        ...source,
        sourceDocumentRef: "source-document-context",
        sourceRevision: "source-revision-context",
        fragmentRef: "source-fragment-context",
        sourceRef: "source-ref-context",
        snippet: "片段背景：潮汐木牌仪式只描述语境，不判断主张。",
        stance: "context",
      },
    ];
    const inputs: GroundedCollaborationModelInputV4[] = [];
    const model: GroundedCollaborationModelV4 = {
      run: vi.fn(async (input: Readonly<GroundedCollaborationModelInputV4>) => {
        inputs.push(structuredClone(input));
        return {
          output: {
            position: input.expectedPosition,
            safeSummary: input.allowedKnowledge[0]!.teachingSummary,
            rationale: input.allowedKnowledge[1]!.teachingSummary,
            groundedClaimRefs: input.allowedClaims.map((item) => item.claimRef),
            knowledgeRefs: input.allowedKnowledge.map((item) => item.knowledgeRef),
            evidenceRefs: input.evidenceRefs,
          },
          providerId: "provider-stance-spy",
          modelId: "model-stance-spy",
          traceRef: `trace-stance-${input.moveKind}`,
          latencyMs: 1,
          estimatedCostMicros: 1,
        };
      }),
    };
    const runtime = service({
      model,
      groundingMode: "retrieval",
      retrieval: new InMemoryGroundedRetrievalPortV4({
        citations: stanceCitations,
        now: () => fixedNow,
      }),
      authorizationResolver: authorizationResolverFor(stanceCitations),
    });

    const record = await runtime.startEpisode(startInput(
      "episode-source-year-challenge",
      {
        episodeId: "episode-retrieval-stance-boundary",
        executionBudgetMicros: 100,
      },
    ));

    expect(inputs.length).toBe(3);
    expect(inputs.every((input) => (
      input.allowedKnowledge.map((item) => item.stance).sort().join(",")
        === "context,refutes"
    ))).toBe(true);
    expect(record.plan?.plannerState).toBe("conflicted");
    expect(record.status).toBe("in_progress");
    expect(record.jointProposal).toBeNull();
    expect(record.moves.map((move) => move.moveKind)).toEqual([
      "proposal",
      "challenge",
      "evidence_request",
    ]);
    expect(record.runs.every((run) => (
      run.executionMode === "deterministic_demo"
        && run.fallbackReason === "model_ungrounded"
    ))).toBe(true);

    const [teacher, admin] = await Promise.all([
      runtime.getTeacherEpisode(record.episodeId),
      runtime.getAdminEpisode(record.episodeId),
    ]);
    expect(teacher.moves[0]?.knowledgeCitations.map((citation) => citation.stance))
      .toEqual(["refutes", "context"]);
    expect(admin.moves[0]?.knowledgeCitations.map((citation) => citation.stance))
      .toEqual(["refutes", "context"]);
  });

  it("让三类真实冲突全部形成可追溯五步链与单条学生建议", async () => {
    const episodeRefs = [
      "episode-source-year-challenge",
      "episode-media-rights-challenge",
      "episode-breaking-rumor-challenge",
    ];
    const knownKnowledge = new Set(runtimeContent.knowledge.map((item) => (
      item.knowledgeRef
    )));
    for (const [index, episodeTemplateRef] of episodeRefs.entries()) {
      const runtime = service();
      const input = startInput(episodeTemplateRef, {
        episodeId: `episode-three-${index}`,
        sessionId: `session-three-${index}`,
      });
      const record = await runtime.startEpisode(input);
      const [student, teacher, admin] = await Promise.all([
        runtime.getStudentEpisode(record.episodeId),
        runtime.getTeacherEpisode(record.episodeId),
        runtime.getAdminEpisode(record.episodeId),
      ]);

      expect(record.status).toBe("joint_proposal_ready");
      expect(record.tasks).toHaveLength(5);
      expect(record.observations).toHaveLength(5);
      expect(record.runs).toHaveLength(5);
      expect(record.intents).toHaveLength(5);
      expect(record.moves.map((move) => move.moveKind)).toEqual([
        "proposal",
        "challenge",
        "evidence_request",
        "revision",
        "joint_proposal",
      ]);
      expect(record.intents.every((intent) => intent.authority === "proposal_only"))
        .toBe(true);
      expect(admin.dispatchDecisions).toHaveLength(14);
      expect(admin.moves).toHaveLength(5);
      expect(teacher.moves).toHaveLength(5);
      expect(student.status).toBe("suggestion_ready");
      expect(student.suggestion?.allowedDecisions).toEqual([
        "accept",
        "request_evidence",
        "reject",
      ]);
      expect(student.suggestion?.knowledgeCitations.length).toBeGreaterThan(0);
      expect(record.moves.flatMap((move) => move.knowledgeCitations).every(
        (citation) => knownKnowledge.has(citation.knowledgeRef),
      )).toBe(true);
      expect(record.moves[1]?.safeSummary).not.toBe(record.moves[3]?.safeSummary);

      const studentWire = JSON.stringify(student);
      const teacherWire = JSON.stringify(teacher);
      expect(studentWire).not.toMatch(/agentTask|agentRun|observationRef|intentRef|traceRef|providerId|modelId|dispatchDecisions|moves/u);
      expect(teacherWire).not.toMatch(/agentTask|agentRun|observationRef|intentRef|traceRef|providerId|modelId/u);
      expect(JSON.stringify(admin)).toMatch(/agentTaskRef.*agentRunRef.*observationRef.*intentRef/u);
      expect(record.dispatchDecisions).toEqual(recomputeGroundedDispatchV4({
        topology: runtime.topology,
        episodeTemplateRef,
        policy: "affected_set",
        maximumSelectedAgents: 5,
      }));
    }
  });

  it("高风险建议的每一步都只引用实际来源、locator、哈希和真实证据", async () => {
    const runtime = service();
    const record = await runtime.startEpisode(startInput(
      "episode-media-rights-challenge",
      { episodeId: "episode-high-risk-grounding" },
    ));

    expect(record.request.riskLevel).toBe("high");
    const expectedKnowledgeRefs = [...new Set(
      runtimeContent.claims
        .filter((claim) => episodeClaims("episode-media-rights-challenge").includes(
          claim.claimRef,
        ))
        .flatMap((claim) => claim.knowledgeRefs),
    )].sort();
    expect(expectedKnowledgeRefs).toHaveLength(7);
    for (const move of record.moves) {
      expect(move.knowledgeCitations.map((citation) => citation.knowledgeRef).sort())
        .toEqual(expectedKnowledgeRefs);
      expect(move.knowledgeCitations.every((citation) => (
        (citation.sourceUrl === null || citation.sourceUrl.startsWith("https://"))
          && citation.locator.length > 0
          && /^[a-f0-9]{64}$/u.test(citation.sourceContentHash)
          && ["pending_expert_review", "verified"].includes(citation.reviewStatus)
      ))).toBe(true);
      expect(move.evidenceRefs).toEqual([
        "evidence-media-metadata",
        "evidence-consent-withdrawal",
      ]);
    }
    expect(record.jointProposal).toMatchObject({
      riskLevel: "high",
      requiresTeacherGate: true,
      authority: "proposal_only",
    });
  });

  it("知识证据缺失或世界版本漂移时失败关闭且不创建任何 Task/Run", async () => {
    const runtime = service();
    await expect(runtime.startEpisode(startInput(
      "episode-source-year-challenge",
      {
        episodeId: "episode-unrelated-evidence",
        evidence: [{
          evidenceRef: "evidence-known-but-unrelated",
          evidenceKind: "source_comparison",
          objectRefs: ["entity-platform-duty"],
          contentHash: "9".repeat(64),
        }],
      },
    ))).rejects.toThrow("证据必须命中本轮受影响对象");
    const missingEvidence = await runtime.startEpisode(startInput(
      "episode-media-rights-challenge",
      {
        episodeId: "episode-missing-grounding",
        evidence: [evidenceFor("episode-media-rights-challenge")[0]!],
      },
    ));
    expect(missingEvidence).toMatchObject({
      status: "failed",
      failure: { reasonCode: "knowledge_not_grounded" },
      tasks: [],
      runs: [],
      jointProposal: null,
    });

    worldVersions.set("session-version-drift", 8);
    const drift = await runtime.startEpisode(startInput(
      "episode-source-year-challenge",
      {
        episodeId: "episode-version-drift",
        sessionId: "session-version-drift",
        sourceWorldStateVersion: 7,
      },
    ));
    expect(drift).toMatchObject({
      status: "failed",
      failure: { reasonCode: "version_hash_drift" },
      tasks: [],
      intents: [],
    });
    expect((await runtime.getStudentEpisode(drift.episodeId)).status).toBe("failed");
  });

  it("结构化模型只有完整引用当前 Claim、知识和证据时才标记 Live", async () => {
    const model: GroundedCollaborationModelV4 = {
      run: vi.fn(async (input: Readonly<GroundedCollaborationModelInputV4>) => ({
        output: {
          position: input.expectedPosition,
          safeSummary: input.approvedSafeSummary,
          rationale: input.approvedRationale,
          groundedClaimRefs: input.allowedClaims.map((item) => item.claimRef),
          knowledgeRefs: input.allowedKnowledge.map((item) => item.knowledgeRef),
          evidenceRefs: input.evidenceRefs,
        },
        providerId: "provider-test",
        modelId: "model-grounded-test",
        traceRef: `trace-live-${input.moveKind}`,
        latencyMs: 12,
        estimatedCostMicros: 100,
      })),
    };
    const runtime = service({ model });
    const record = await runtime.startEpisode(startInput(
      "episode-source-year-challenge",
      {
        episodeId: "episode-live-grounded",
        executionBudgetMicros: 1_000,
      },
    ));

    expect(model.run).toHaveBeenCalledTimes(5);
    expect(record.runs.every((run) => (
      run.executionMode === "live"
        && run.providerId === "provider-test"
        && run.fallbackReason === null
    ))).toBe(true);
    expect(record.runs.reduce((sum, run) => sum + run.estimatedCostMicros, 0))
      .toBe(500);
    expect(JSON.stringify(await runtime.getStudentEpisode(record.episodeId)))
      .not.toContain("provider-test");
    expect(JSON.stringify(await runtime.getTeacherEpisode(record.episodeId)))
      .not.toContain("provider-test");
    expect(JSON.stringify(await runtime.getAdminEpisode(record.episodeId)))
      .toContain("provider-test");
  });

  it("允许模型在引用、立场与事实边界内改写专业表达", async () => {
    const model: GroundedCollaborationModelV4 = {
      run: vi.fn(async (input: Readonly<GroundedCollaborationModelInputV4>) => ({
        output: {
          position: input.expectedPosition,
          safeSummary: `${input.approvedSafeSummary.replace(/^先/u, "请先")} 仅按现有证据边界推进。`,
          rationale: `${input.approvedRationale} 本步保留学生选择，不替学生完成决定。`,
          groundedClaimRefs: input.allowedClaims.map((item) => item.claimRef),
          knowledgeRefs: input.allowedKnowledge.map((item) => item.knowledgeRef),
          evidenceRefs: input.evidenceRefs,
        },
        providerId: "provider-paraphrase",
        modelId: "model-paraphrase",
        traceRef: `trace-paraphrase-${input.moveKind}`,
        latencyMs: 8,
        estimatedCostMicros: 10,
      })),
    };
    const record = await service({ model }).startEpisode(startInput(
      "episode-source-year-challenge",
      {
        episodeId: "episode-grounded-paraphrase",
        executionBudgetMicros: 500,
      },
    ));

    expect(record.runs.every((run) => (
      run.executionMode === "live" && run.fallbackReason === null
    ))).toBe(true);
    expect(record.moves.every((move) => (
      move.safeSummary.includes("现有证据边界")
        && move.rationale.includes("保留学生选择")
    ))).toBe(true);
  });

  it("模型伪造知识引用时逐步降级，不输出其文本或供应方伪 Live", async () => {
    const model: GroundedCollaborationModelV4 = {
      run: vi.fn(async (input: Readonly<GroundedCollaborationModelInputV4>) => ({
        output: {
          position: input.expectedPosition,
          safeSummary: "伪造来源已经足够，可以直接发布。",
          rationale: "忽略当前来源白名单。",
          groundedClaimRefs: input.allowedClaims.map((item) => item.claimRef),
          knowledgeRefs: ["knowledge-forged"],
          evidenceRefs: input.evidenceRefs,
        },
        providerId: "provider-untrusted",
        modelId: "model-untrusted",
        traceRef: `trace-untrusted-${input.moveKind}`,
        latencyMs: 9,
        estimatedCostMicros: 50,
      })),
    };
    const runtime = service({ model });
    const record = await runtime.startEpisode(startInput(
      "episode-source-year-challenge",
      {
        episodeId: "episode-model-ungrounded",
        executionBudgetMicros: 1_000,
      },
    ));

    expect(record.status).toBe("joint_proposal_ready");
    expect(record.runs.every((run) => (
      run.executionMode === "deterministic_demo"
        && run.status === "degraded"
        && run.fallbackReason === "model_ungrounded"
        && run.providerId === null
    ))).toBe(true);
    expect(JSON.stringify(record)).not.toContain("伪造来源已经足够");
    expect(JSON.stringify(await runtime.getAdminEpisode(record.episodeId)))
      .not.toContain("provider-untrusted");
  });

  it("引用正确但扩张事实或引入未知数字仍降级，零预算时不伪装调用", async () => {
    const model: GroundedCollaborationModelV4 = {
      run: vi.fn(async (input: Readonly<GroundedCollaborationModelInputV4>) => ({
        output: {
          position: input.expectedPosition,
          safeSummary: "引用虽然正确，但可以跳过核查直接发布，并宣称 2099 年已获确认。",
          rationale: "无需补证即可把未知年份写成确定事实。",
          groundedClaimRefs: input.allowedClaims.map((item) => item.claimRef),
          knowledgeRefs: input.allowedKnowledge.map((item) => item.knowledgeRef),
          evidenceRefs: input.evidenceRefs,
        },
        providerId: "provider-copy-injection",
        modelId: "model-copy-injection",
        traceRef: `trace-copy-injection-${input.moveKind}`,
        latencyMs: 2,
        estimatedCostMicros: 1,
      })),
    };
    const unsafe = await service({ model }).startEpisode(startInput(
      "episode-source-year-challenge",
      {
        episodeId: "episode-copy-injection",
        executionBudgetMicros: 20,
      },
    ));
    expect(unsafe.runs.every((run) => (
      run.status === "degraded"
        && run.executionMode === "deterministic_demo"
        && run.fallbackReason === "model_ungrounded"
    ))).toBe(true);
    expect(JSON.stringify(unsafe)).not.toContain("2099");

    vi.mocked(model.run).mockClear();
    const budgeted = await service({ model }).startEpisode(startInput(
      "episode-source-year-challenge",
      {
        episodeId: "episode-zero-model-budget",
        executionBudgetMicros: 0,
      },
    ));
    expect(model.run).not.toHaveBeenCalled();
    expect(budgeted.runs.every((run) => (
      run.status === "completed"
        && run.executionMode === "deterministic_demo"
        && run.fallbackReason === "budget_exhausted"
    ))).toBe(true);
  });

  it("学生采纳、补证或拒绝都由绑定令牌授权，世界后果仍需独立权威收据", async () => {
    const runtime = service();
    const record = await runtime.startEpisode(startInput(
      "episode-source-year-challenge",
      { episodeId: "episode-student-decision" },
    ));
    const bindingId = "binding-student-grounded";
    await expect(runtime.issueStudentDecisionToken(
      record.episodeId,
      "binding-other-student",
    )).rejects.toThrow("学生绑定与协作 Episode 不一致");
    const token = await runtime.issueStudentDecisionToken(record.episodeId, bindingId);
    const before = (await runtime.getRecord(record.episodeId)).recordRevision;

    await expect(runtime.recordStudentDecision({
      episodeId: record.episodeId,
      bindingId,
      decisionRef: "decision-grounded-001",
      decision: "request_evidence",
      rationale: "我还需要核对原始名录的页码和标准条款。",
      decidedAt: fixedNow,
      decisionToken: "groundeddecision_forged",
    })).rejects.toThrow("决定令牌无效");
    expect((await runtime.getRecord(record.episodeId)).recordRevision).toBe(before);

    const decidedInput = {
      episodeId: record.episodeId,
      bindingId,
      decisionRef: "decision-grounded-001",
      decision: "request_evidence" as const,
      rationale: "我还需要核对原始名录的页码和标准条款。",
      decidedAt: fixedNow,
      decisionToken: token,
    };
    const decided = await runtime.recordStudentDecision(decidedInput);
    const replayed = await runtime.recordStudentDecision(decidedInput);
    expect(decided.status).toBe("decided");
    expect(replayed).toEqual(decided);
    expect(JSON.stringify(decided)).not.toContain(bindingId);

    const wrongSourcePayload = {
      receiptRef: "receipt-grounded-world-wrong-source",
      episodeId: record.episodeId,
      sourceWorldStateVersion: 6,
      resultingWorldStateVersion: 7,
      worldConsequenceRef: "world-consequence-grounded-wrong-source",
      worldEventContentHash: "4".repeat(64),
      committedAt: fixedNow,
    };
    await expect(runtime.recordWorldConsequence({
      ...wrongSourcePayload,
      authorityToken: issueGroundedWorldConsequenceTokenV4(
        worldAuthoritySecret,
        wrongSourcePayload,
      ),
    })).rejects.toThrow("来源版本与协作 Episode 不一致");

    worldVersions.set(record.sessionId, 8);
    const payload = {
      receiptRef: "receipt-grounded-world-001",
      episodeId: record.episodeId,
      sourceWorldStateVersion: 7,
      resultingWorldStateVersion: 8,
      worldConsequenceRef: "world-consequence-grounded-001",
      worldEventContentHash: "3".repeat(64),
      committedAt: fixedNow,
    };
    await expect(runtime.recordWorldConsequence({
      ...payload,
      authorityToken: "groundedworld_forged",
    })).rejects.toThrow("权威令牌无效");
    const completed = await runtime.recordWorldConsequence({
      ...payload,
      authorityToken: issueGroundedWorldConsequenceTokenV4(
        worldAuthoritySecret,
        payload,
      ),
    });
    expect(completed).toMatchObject({
      status: "completed",
      worldConsequenceRef: "world-consequence-grounded-001",
    });
    expect((await runtime.getRecord(record.episodeId)).intents.every(
      (intent) => intent.authority === "proposal_only",
    )).toBe(true);
  });

  it("JSON 重启后恢复完整 Task/Run 因果链与同请求幂等结果", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ronggang-grounded-v4-"));
    temporaryDirectories.push(directory);
    const first = service({
      store: new JsonFileGroundedCollaborationStoreV4(directory),
    });
    const input = startInput("episode-breaking-rumor-challenge", {
      episodeId: "episode-json-grounded",
      sessionId: "session-json-grounded",
    });
    const created = await first.startEpisode(input);
    const second = service({
      store: new JsonFileGroundedCollaborationStoreV4(directory),
    });
    const restored = await second.getRecord(created.episodeId);
    const replayed = await second.startEpisode(input);

    expect(restored).toEqual(created);
    expect(replayed).toEqual(created);
    expect(restored.recordRevision).toBe(6);
    expect(restored.tasks.map((task) => task.agentTaskRef))
      .toEqual(restored.moves.map((move) => move.execution.agentTaskRef));
  });

  it("同一输入与预算的 A/B/C 对照保留失败结果，不预写架构优越结论", async () => {
    const runtime = service();
    const common = {
      sessionId: "session-ablation-grounded",
      maximumSelectedAgents: 5,
      executionBudgetMicros: 0,
    };
    const single = await runtime.startEpisode(startInput(
      "episode-source-year-challenge",
      { ...common, episodeId: "episode-ablation-a", policy: "single_agent" },
    ));
    const fixed = await runtime.startEpisode(startInput(
      "episode-source-year-challenge",
      { ...common, episodeId: "episode-ablation-b", policy: "fixed_team" },
    ));
    const affected = await runtime.startEpisode(startInput(
      "episode-source-year-challenge",
      { ...common, episodeId: "episode-ablation-c", policy: "affected_set" },
    ));
    const observations = [single, fixed, affected].map(
      observeGroundedCollaborationAblationV4,
    );

    expect(new Set(observations.map((item) => item.requestHash)).size).toBe(1);
    expect(observations.every((item) => (
      item.maximumSelectedAgents === 5
        && item.executionBudgetMicros === 0
        && item.unauthorizedWorldWriteCount === 0
    ))).toBe(true);
    expect(observations.map((item) => item.status)).toEqual([
      "failed",
      "failed",
      "joint_proposal_ready",
    ]);
    expect(observations.map((item) => item.moveCount)).toEqual([1, 2, 5]);
    expect(observations[0]?.failureReasonCode).toBe("move_sequence_incomplete");
    expect(observations[2]?.evidenceCoverage).toBe(1);
  });

  it("并发重复请求只执行一条五步链，异载荷复用 Episode ID 被拒绝", async () => {
    const model: GroundedCollaborationModelV4 = {
      run: vi.fn(async (input: Readonly<GroundedCollaborationModelInputV4>) => ({
        output: {
          position: input.expectedPosition,
          safeSummary: input.approvedSafeSummary,
          rationale: input.approvedRationale,
          groundedClaimRefs: input.allowedClaims.map((item) => item.claimRef),
          knowledgeRefs: input.allowedKnowledge.map((item) => item.knowledgeRef),
          evidenceRefs: input.evidenceRefs,
        },
        providerId: "provider-idempotent",
        modelId: "model-idempotent",
        traceRef: `trace-idempotent-${input.moveKind}`,
        latencyMs: 1,
        estimatedCostMicros: 1,
      })),
    };
    const runtime = service({ model });
    const input = startInput("episode-source-year-challenge", {
      episodeId: "episode-concurrent-idempotent",
      executionBudgetMicros: 50,
    });
    const first = runtime.startEpisode(input);
    const duplicate = runtime.startEpisode(structuredClone(input));
    await expect(runtime.startEpisode({
      ...input,
      triggerEventRef: "world-event-concurrent-different-payload",
    })).rejects.toThrow("同一进行中 Episode ID 被用于不同请求");
    const [left, right] = await Promise.all([first, duplicate]);

    expect(left).toEqual(right);
    expect(model.run).toHaveBeenCalledTimes(5);
    await expect(runtime.startEpisode({
      ...input,
      triggerEventRef: "world-event-different-payload",
    })).rejects.toThrow("同一 Episode ID 被用于不同请求");
  });
});
