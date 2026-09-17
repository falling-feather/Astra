import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  StudentWorkActionSchema,
  StudentWorkActionSchemaVersion,
  challengeScoreCeiling,
  type StudentWorkAction,
} from "@ronggang/contracts";
import {
  xunpuFlagshipContentManifestV3,
  type XunpuFlagshipContentManifestV3,
} from "@ronggang/course-content";
import {
  DeterministicBlindSemanticAssessmentV3,
  FlagshipAssessmentErrorV3,
  FlagshipCompetencyAssessmentServiceV3,
  InMemoryFlagshipAssessmentStoreV3,
  JsonFileFlagshipAssessmentStoreV3,
  currentFlagshipAssessmentDecisionV3,
  type BlindSemanticAssessmentInputV3,
  type BlindSemanticAssessmentPortV3,
  type FlagshipAssessmentStoreV3,
} from "../src/flagship-assessment-v3.js";
import {
  FlagshipStudentWorkServiceV3,
  InMemoryFlagshipStudentWorkStoreV3,
} from "../src/flagship-student-work-v3.js";
import { createV3WorldTestRuntime } from "./world-simulation-v3.fixture.js";

const bindingId = "binding-assessment-student";
const actorId = "student-assessment-reporter";
const principalId = "principal-assessment-student";
const evidenceRefs = ["evidence-source-a", "evidence-source-b", "evidence-source-c"];
const allowedEvidenceRefs = new Set(evidenceRefs);
let temporaryDirectory: string | null = null;

afterEach(async () => {
  if (temporaryDirectory) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    temporaryDirectory = null;
  }
});

function action(
  sessionId: string,
  suffix: string,
  payload: StudentWorkAction["action"],
): StudentWorkAction {
  return StudentWorkActionSchema.parse({
    schemaVersion: StudentWorkActionSchemaVersion,
    workActionId: `work-action-${suffix}`,
    serverIssuedActionRef: `server-action-${suffix}`,
    sessionId,
    bindingId,
    actorId,
    primaryRoleId: "reporter",
    expectedWorldStateVersion: 0,
    action: payload,
    sourceWorldEventIds: [],
    reflectionNote: "我依据现场反馈重新检查判断，记录不确定项并说明下一步补证与修订路径。",
    submissionStatus: "accepted",
    createdAt: "2026-08-26T04:00:00.000Z",
  });
}

function studentActions(sessionId: string): StudentWorkAction[] {
  return [
    action(sessionId, "observe", {
      verb: "observe",
      targetRef: { objectType: "entity", objectId: "entity-gatekeeper" },
      observationFocus: "观察公共区域、采访边界与现场信息来源，先区分可见事实和待核说法。",
    }),
    action(sessionId, "ask", {
      verb: "ask",
      targetRef: { objectType: "entity", objectId: "entity-gatekeeper" },
      utterance: "您好，我是学生记者，想说明报道用途并确认哪些内容可以公开、哪些需要匿名或撤回。",
    }),
    action(sessionId, "inspect", {
      verb: "inspect",
      targetRefs: [{ objectType: "fact", objectId: "fact-origin-story" }],
      evidenceQuestion: "这项说法能否回到原始来源、准确年份和独立信源，授权范围是否覆盖当前平台？",
    }),
    action(sessionId, "escalate", {
      verb: "escalate",
      gateRef: "gate-publication-risk",
      reason: "授权范围仍有冲突，我先冻结发布并提交教师门，等待补证或替换素材。",
      evidenceRefs,
    }),
  ];
}

function fieldsFor(
  artifact: XunpuFlagshipContentManifestV3["artifacts"][number],
  quality: "strong" | "developing",
  revision: number,
) {
  const seed = quality === "strong"
    ? "高质量专业记录：来源定位、原始信源、交叉核验、知情同意、匿名撤回、公共价值、编辑独立、授权期限、平台标识、图文短视频适配、补证更正与迁移反思。"
    : "基础记录：目前已完成一项内容，后续还可以继续处理相关问题。";
  return artifact.editableFields.map((field) => ({
    fieldId: field.fieldId,
    content: `${seed}第${revision}版。${seed.repeat(
      Math.ceil((field.minimumLength + 40) / Math.max(seed.length, 1)),
    )}`.slice(0, Math.max(field.minimumLength + 12, 36)),
  }));
}

async function completeWork(
  sessionId: string,
  challengeLevel: 3 | 4 | 5 | 6 | 7,
  quality: "strong" | "developing",
) {
  const work = new FlagshipStudentWorkServiceV3({
    store: new InMemoryFlagshipStudentWorkStoreV3(),
    manifest: xunpuFlagshipContentManifestV3,
    now: () => "2026-08-26T04:10:00.000Z",
  });
  await work.getWorkspace({
    sessionId,
    bindingId,
    principalId,
    actorId,
    challengeLevel,
    evidenceCatalog: [],
  });
  for (const artifact of xunpuFlagshipContentManifestV3.artifacts) {
    const revisions = artifact.artifactId === "artifact-feature-story" ? 2 : 1;
    for (let revision = 1; revision <= revisions; revision += 1) {
      await work.saveRevision({
        sessionId,
        bindingId,
        principalId,
        actorId,
        challengeLevel,
        artifactId: artifact.artifactId,
        expectedRevisionNumber: revision - 1,
        requestId: `save-${quality}-${artifact.artifactId}-${revision}`,
        fields: fieldsFor(artifact, quality, revision),
        evidenceRefs,
        revisionNote: revision === 1
          ? "依据真实来源形成首版"
          : "根据核验、采访边界和现场反馈完成实质修订",
        allowedEvidenceRefs,
      });
    }
    const record = (await work.loadRecord(sessionId))!;
    const stored = record.artifacts.find(
      (item) => item.artifactId === artifact.artifactId,
    )!;
    const revision = record.revisions.find(
      (item) => item.revisionId === stored.latestRevisionId,
    )!;
    await work.submitRevision({
      sessionId,
      bindingId,
      principalId,
      actorId,
      challengeLevel,
      artifactId: artifact.artifactId,
      revisionId: revision.revisionId,
      contentHash: revision.contentHash,
      requestId: `submit-${quality}-${artifact.artifactId}`,
    });
  }
  return work;
}

class CapturingEvaluator implements BlindSemanticAssessmentPortV3 {
  readonly inputs: BlindSemanticAssessmentInputV3[] = [];

  evaluate(input: BlindSemanticAssessmentInputV3) {
    this.inputs.push(structuredClone(input));
    const strong = JSON.stringify(input).includes("高质量专业记录");
    return {
      mode: "test_double" as const,
      direction: "supports" as const,
      score: strong ? 90 : 58,
      confidence: 0.8,
      rationale: strong
        ? "作品具有可追溯专业判断。"
        : "作品形成基本过程，但专业判断仍较薄弱。",
    };
  }
}

async function completeAssessment(input: {
  sessionId: string;
  quality: "strong" | "developing";
  challengeLevel?: 3 | 4 | 5 | 6 | 7;
  evaluator?: BlindSemanticAssessmentPortV3;
  store?: FlagshipAssessmentStoreV3;
}) {
  const level = input.challengeLevel ?? 5;
  const runtime = await createV3WorldTestRuntime(input.sessionId);
  const baseWorld = await runtime.engine.getRecord(input.sessionId);
  const scoreCeiling = challengeScoreCeiling(level);
  const variant = baseWorld.release.challengeVariants.find(
    (item) => item.challengeLevel === level,
  )!;
  const world = {
    ...baseWorld,
    challengeAssignment: {
      ...baseWorld.challengeAssignment,
      worldVariantRef: variant.worldVariantId,
      challengeLevel: level,
      scoreCeiling,
    },
    studentActions: studentActions(input.sessionId),
  };
  const work = await completeWork(input.sessionId, level, input.quality);
  const assessment = new FlagshipCompetencyAssessmentServiceV3({
    engine: { getRecord: async () => structuredClone(world) },
    orchestrator: { loadRecord: async () => null },
    work,
    manifest: xunpuFlagshipContentManifestV3,
    store: input.store ?? new InMemoryFlagshipAssessmentStoreV3(),
    evaluator: input.evaluator ?? new CapturingEvaluator(),
    now: () => "2026-08-26T04:30:00.000Z",
  });
  return {
    assessment,
    record: await assessment.getAssessment({ sessionId: input.sessionId }),
  };
}

describe("FlagshipCompetencyAssessmentServiceV3", () => {
  it("keeps an empty or partial session scoreless and never equates completion with competency", async () => {
    const sessionId = "session-assessment-insufficient";
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
      evaluator: new DeterministicBlindSemanticAssessmentV3(),
      now: () => "2026-08-26T04:30:00.000Z",
    });
    const record = await assessment.getAssessment({
      sessionId,
      fallbackLearner: { bindingId, actorId },
    });
    const decision = currentFlagshipAssessmentDecisionV3(record);
    expect(decision.completionStatus).toBe("not_started");
    expect(decision.scoreStatus).toBe("insufficient_evidence");
    expect(decision.sessionScore).toBeNull();
    expect(decision.evidenceEpisodeRefs).toEqual([]);
    expect(decision.competencyEstimates.every((item) => (
      item.evidenceStatus === "insufficient"
        && item.score === null
        && item.evidenceEpisodeRefs.length === 0
    ))).toBe(true);
  });

  it("produces different competency results for mechanically identical completion and blinds identity, challenge and advice", async () => {
    const strongEvaluator = new CapturingEvaluator();
    const developingEvaluator = new CapturingEvaluator();
    const strong = await completeAssessment({
      sessionId: "session-assessment-strong",
      quality: "strong",
      evaluator: strongEvaluator,
    });
    const developing = await completeAssessment({
      sessionId: "session-assessment-developing",
      quality: "developing",
      evaluator: developingEvaluator,
    });
    const strongDecision = currentFlagshipAssessmentDecisionV3(strong.record);
    const developingDecision = currentFlagshipAssessmentDecisionV3(developing.record);
    expect(strongDecision.completionStatus).toBe("submitted");
    expect(developingDecision.completionStatus).toBe("submitted");
    expect(strongDecision.scoreStatus).toBe("provisional");
    expect(developingDecision.scoreStatus).toBe("provisional");
    expect(strongDecision.sessionScore).not.toBe(developingDecision.sessionScore);
    expect(strongDecision.sessionScore).toBeGreaterThan(
      developingDecision.sessionScore ?? 0,
    );
    const blindPayload = JSON.stringify(strongEvaluator.inputs);
    expect(blindPayload).not.toContain(actorId);
    expect(blindPayload).not.toContain(bindingId);
    expect(blindPayload).not.toContain("challengeLevel");
    expect(blindPayload).not.toContain("scoreCeiling");
    expect(blindPayload).not.toContain("selectedSuggestion");
    expect(blindPayload).not.toContain("provider");
    expect(strong.record.evidenceEpisodes.some((episode) => (
      episode.observations.some((observation) => observation.scaffoldingLevel > 0)
    ))).toBe(true);
    expect(strong.record.scoreComputations.find(
      (item) => item.competencyClaimId === "criterion-recovery-transfer",
    )?.failClosedReasons).toEqual([]);
  });

  it("applies challenge normalization only after blind evaluation and respects 3/5/7 ceilings", async () => {
    const level3 = await completeAssessment({
      sessionId: "session-assessment-level-3",
      quality: "strong",
      challengeLevel: 3,
    });
    const level5 = await completeAssessment({
      sessionId: "session-assessment-level-5",
      quality: "strong",
      challengeLevel: 5,
    });
    const level7 = await completeAssessment({
      sessionId: "session-assessment-level-7",
      quality: "strong",
      challengeLevel: 7,
    });
    const decisions = [level3, level5, level7].map((item) => (
      currentFlagshipAssessmentDecisionV3(item.record)
    ));
    expect(decisions.map((item) => item.scoreCeiling)).toEqual([80, 90, 100]);
    expect(decisions.every((item) => (
      item.sessionScore !== null && item.sessionScore <= item.scoreCeiling
    ))).toBe(true);
    expect(level3.record.scoreComputations[0]?.challengeAdjustment).toBe(0);
    expect(level5.record.scoreComputations[0]?.challengeAdjustment).toBe(4);
    expect(level7.record.scoreComputations[0]?.challengeAdjustment).toBe(8);
  });

  it("preserves evidence references while a teacher confirms or revises dimensions idempotently", async () => {
    const result = await completeAssessment({
      sessionId: "session-assessment-teacher-review",
      quality: "strong",
    });
    const provisional = currentFlagshipAssessmentDecisionV3(result.record);
    const target = provisional.competencyEstimates[0]!;
    const reviewed = await result.assessment.reviewAssessment({
      sessionId: provisional.sessionId,
      expectedAssessmentDecisionId: provisional.assessmentDecisionId,
      requestId: "request-teacher-revision",
      reviewerId: "teacher-reviewer",
      status: "revised",
      reason: "根据作品正文与现场证据逐项复核，调整该维度的岗位能力判断。",
      competencyRevisions: [{
        competencyClaimId: target.competencyClaimId,
        score: 76,
        competencyLevel: 4,
        rationale: "作品事实链完整，但两处限定措辞仍需加强，因此修订为四级。",
      }],
    });
    const final = currentFlagshipAssessmentDecisionV3(reviewed);
    expect(final.scoreStatus).toBe("final");
    expect(final.teacherReview).toMatchObject({
      status: "revised",
      reviewerId: "teacher-reviewer",
    });
    expect(final.competencyEstimates[0]?.evidenceEpisodeRefs)
      .toEqual(target.evidenceEpisodeRefs);
    const replayed = await result.assessment.reviewAssessment({
      sessionId: provisional.sessionId,
      expectedAssessmentDecisionId: provisional.assessmentDecisionId,
      requestId: "request-teacher-revision",
      reviewerId: "teacher-reviewer",
      status: "revised",
      reason: "根据作品正文与现场证据逐项复核，调整该维度的岗位能力判断。",
      competencyRevisions: [{
        competencyClaimId: target.competencyClaimId,
        score: 76,
        competencyLevel: 4,
        rationale: "作品事实链完整，但两处限定措辞仍需加强，因此修订为四级。",
      }],
    });
    expect(replayed.recordRevision).toBe(reviewed.recordRevision);
    await expect(result.assessment.reviewAssessment({
      sessionId: provisional.sessionId,
      expectedAssessmentDecisionId: provisional.assessmentDecisionId,
      requestId: "request-teacher-revision",
      reviewerId: "teacher-reviewer",
      status: "confirmed",
      reason: "试图用相同请求编号改写既有教师决定。",
      competencyRevisions: [],
    })).rejects.toMatchObject({ code: "request_replay_conflict" });
  });

  it("restores the exact source hash and decision from the atomic JSON store", async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "flagship-assessment-v3-"));
    const store = new JsonFileFlagshipAssessmentStoreV3(temporaryDirectory);
    const first = await completeAssessment({
      sessionId: "session-assessment-restart",
      quality: "strong",
      store,
    });
    const restoredStore = new JsonFileFlagshipAssessmentStoreV3(temporaryDirectory);
    const restored = await restoredStore.load("session-assessment-restart");
    expect(restored?.sourceHash).toBe(first.record.sourceHash);
    expect(currentFlagshipAssessmentDecisionV3(restored!).assessmentDecisionId)
      .toBe(currentFlagshipAssessmentDecisionV3(first.record).assessmentDecisionId);
  });

  it("rejects teacher scores for an evidence-insufficient dimension", async () => {
    const sessionId = "session-assessment-forged-score";
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
    });
    const record = await assessment.getAssessment({
      sessionId,
      fallbackLearner: { bindingId, actorId },
    });
    const decision = currentFlagshipAssessmentDecisionV3(record);
    await expect(assessment.reviewAssessment({
      sessionId,
      expectedAssessmentDecisionId: decision.assessmentDecisionId,
      requestId: "request-forged-score",
      reviewerId: "teacher-reviewer",
      status: "revised",
      reason: "证据不足仍试图直接填入一个浏览器提交的能力分数。",
      competencyRevisions: [{
        competencyClaimId: decision.competencyEstimates[0]!.competencyClaimId,
        score: 100,
        competencyLevel: 5,
        rationale: "没有证据却试图补造一个满分能力判断。",
      }],
    })).rejects.toBeInstanceOf(FlagshipAssessmentErrorV3);
  });
});
