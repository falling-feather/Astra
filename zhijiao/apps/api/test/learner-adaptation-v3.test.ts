import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AssessmentDecisionSchema,
  AssessmentDecisionSchemaVersion,
  ChallengeAssignmentSchema,
  ChallengeAssignmentSchemaVersion,
  StudentWorkActionSchema,
  StudentWorkActionSchemaVersion,
  challengeScoreCeiling,
  type AssessmentDecision,
  type ChallengeAssignment,
  type StudentWorkAction,
} from "@ronggang/contracts";
import { getXunpuWorldSimulationReleaseV3 } from "@ronggang/course-content";
import type { FlagshipAssessmentRecordV3 } from "../src/flagship-assessment-v3.js";
import {
  DeterministicLearnerProxyAgentV3,
  InMemoryLearnerAdaptationStoreV3,
  JsonFileLearnerAdaptationStoreV3,
  LearnerAdaptationServiceV3,
  type LearnerProxyAgentPortV3,
  type LearnerProxySafeInputV3,
} from "../src/learner-adaptation-v3.js";

const actorId = "student-learner-twin";
const bindingId = "binding-learner-twin";
const now = "2026-08-26T08:00:00.000Z";
const release = getXunpuWorldSimulationReleaseV3();
const claimIds = [
  "criterion-fact-verification",
  "criterion-interview-consent",
  "criterion-editorial-judgment",
  "criterion-rights-governance",
  "criterion-multiplatform-production",
  "criterion-recovery-transfer",
];
let temporaryDirectory: string | null = null;

afterEach(async () => {
  if (temporaryDirectory) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    temporaryDirectory = null;
  }
});

function challengeAssignment(
  sessionId: string,
  level: 3 | 4 | 5 | 6 | 7,
): ChallengeAssignment {
  const variant = release.challengeVariants.find(
    (item) => item.challengeLevel === level,
  )!;
  return ChallengeAssignmentSchema.parse({
    schemaVersion: ChallengeAssignmentSchemaVersion,
    challengeAssignmentId: `challenge-${sessionId}`,
    learnerTwinRef: "learner-twin-pending-evidence",
    sessionId,
    simulationReleaseRef: release.simulationReleaseRef,
    worldVariantRef: variant.worldVariantId,
    previousChallengeLevel: level === 3 ? null : level - 1,
    challengeLevel: level,
    scoreCeiling: challengeScoreCeiling(level),
    pressureDimensions: [
      { dimensionId: "time", intensity: level },
      { dimensionId: "source_access", intensity: level },
    ],
    assignmentReason: level === 3 ? "initial_diagnostic" : "evidence_progression",
    basisEvidenceRefs: level === 3 ? [] : ["evidence-prior-round"],
    forecastRef: level === 3 ? null : `forecast-${sessionId}`,
    teacherOverride: null,
    policyVersion: "test-policy/1.0.0",
    policyContentHash: "a".repeat(64),
    assignedAt: "2026-08-26T07:00:00.000Z",
  });
}

function action(
  sessionId: string,
  index: number,
  verb: "observe" | "inspect" | "ask" | "draft",
  parentRevisionId: string | null = null,
): StudentWorkAction {
  const payload = verb === "observe"
    ? {
      verb,
      targetRef: { objectType: "entity" as const, objectId: "entity-gatekeeper" },
      observationFocus: "先观察采访边界、公开空间和现场信源，再决定下一步。",
    }
    : verb === "inspect"
      ? {
        verb,
        targetRefs: [{ objectType: "fact" as const, objectId: "fact-origin-story" }],
        evidenceQuestion: "回到原始出处并寻找独立信源交叉核验。",
      }
      : verb === "ask"
        ? {
          verb,
          targetRef: { objectType: "entity" as const, objectId: "entity-inheritor" },
          utterance: "我先说明报道用途，请问哪些内容可以公开以及是否允许撤回？",
        }
        : {
          verb,
           artifactId: "artifact-feature-story",
           revisionId: `work-revision-${sessionId}-${index}`,
           parentRevisionId,
          contentHash: "b".repeat(64),
        };
  return StudentWorkActionSchema.parse({
    schemaVersion: StudentWorkActionSchemaVersion,
    workActionId: `work-action-${sessionId}-${index}`,
    serverIssuedActionRef: `server-action-${sessionId}-${index}`,
    sessionId,
    bindingId,
    actorId,
    primaryRoleId: "reporter",
    expectedWorldStateVersion: index,
    action: payload,
    sourceWorldEventIds: [],
    reflectionNote: "我将根据真实反馈继续核验、修订并承担选择造成的世界后果。",
    submissionStatus: verb === "draft" ? "draft" : "accepted",
    createdAt: now,
  });
}

function decision(input: {
  sessionId: string;
  assignment: ChallengeAssignment;
  competencyLevel: 1 | 2 | 3 | 4 | 5;
  id?: string;
  final?: boolean;
}): AssessmentDecision {
  const final = input.final ?? true;
  return AssessmentDecisionSchema.parse({
    schemaVersion: AssessmentDecisionSchemaVersion,
    assessmentDecisionId: input.id ?? `assessment-${input.sessionId}`,
    sessionId: input.sessionId,
    bindingId,
    learnerTwinRef: "learner-twin-pending-evidence",
    courseReleaseRef: release.courseReleaseRef,
    simulationReleaseRef: release.simulationReleaseRef,
    challengeAssignmentRef: input.assignment.challengeAssignmentId,
    challengeLevel: input.assignment.challengeLevel,
    scoreCeiling: input.assignment.scoreCeiling,
    completionStatus: "completed",
    scoreStatus: final ? "final" : "insufficient_evidence",
    sessionScore: final ? Math.min(72, input.assignment.scoreCeiling) : null,
    competencyEstimates: claimIds.map((competencyClaimId, index) => ({
      competencyClaimId,
      evidenceStatus: final ? "supported" : "insufficient",
      competencyLevel: final ? input.competencyLevel : null,
      score: final ? 62 + index : null,
      confidence: final ? 0.82 : 0.2,
      evidenceEpisodeRefs: final
        ? [`evidence-${input.sessionId}-${index}`]
        : [],
      rationale: final
        ? "真实作品、岗位行动和世界后果共同支持该维度判断。"
        : "当前尚无足够独立证据。",
    })),
    evidenceEpisodeRefs: final
      ? claimIds.map((_, index) => `evidence-${input.sessionId}-${index}`)
      : [],
    growthSummary: final
      ? "本轮已形成可追溯岗位证据，下一轮继续训练最薄弱维度。"
      : "继续完成真实作品和岗位行动后再形成判断。",
    nextGrowthTargets: final ? claimIds.slice(0, 3) : [],
    teacherReview: final ? {
      status: "confirmed",
      reviewerId: "teacher-reviewer",
      reviewedAt: now,
      reason: "依据全部冻结作品与真实过程证据确认本轮能力判断。",
    } : {
      status: "pending",
      reviewerId: null,
      reviewedAt: null,
      reason: null,
    },
    generatedAt: now,
  });
}

function assessmentRecord(current: AssessmentDecision): FlagshipAssessmentRecordV3 {
  return {
    recordVersion: "flagship-assessment-record/3.0.0",
    recordRevision: 0,
    sessionId: current.sessionId,
    learnerBindingId: bindingId,
    learnerActorId: actorId,
    sourceHash: "c".repeat(64),
    evidenceEpisodes: [],
    semanticReceipts: [],
    scoreComputations: [],
    decisionHistory: [{ sourceHash: "c".repeat(64), decision: current }],
    reviewReceipts: [],
    createdAt: now,
    updatedAt: now,
  };
}

function worldContext(
  sessionId: string,
  assignment: ChallengeAssignment,
  actions: StudentWorkAction[] = [
    action(sessionId, 1, "observe"),
    action(sessionId, 2, "inspect"),
    action(sessionId, 3, "ask"),
  ],
) {
  return {
    sessionId,
    release: {
      simulationReleaseRef: release.simulationReleaseRef,
      challengeVariants: release.challengeVariants,
    },
    challengeAssignment: assignment,
    studentActions: actions,
  };
}

class CapturingProxy implements LearnerProxyAgentPortV3 {
  readonly inputs: LearnerProxySafeInputV3[] = [];
  readonly delegate = new DeterministicLearnerProxyAgentV3();

  forecast(input: LearnerProxySafeInputV3) {
    this.inputs.push(structuredClone(input));
    return this.delegate.forecast(input);
  }
}

function serviceFixture(input: {
  sessionId: string;
  level: 3 | 4 | 5 | 6 | 7;
  competencyLevel: 1 | 2 | 3 | 4 | 5;
  final?: boolean;
  store?: InMemoryLearnerAdaptationStoreV3 | JsonFileLearnerAdaptationStoreV3;
  proxy?: LearnerProxyAgentPortV3;
}) {
  let assignment = challengeAssignment(input.sessionId, input.level);
  let currentDecision = decision({
    sessionId: input.sessionId,
    assignment,
    competencyLevel: input.competencyLevel,
    ...(input.final === undefined ? {} : { final: input.final }),
  });
  let currentWorld = worldContext(input.sessionId, assignment);
  const service = new LearnerAdaptationServiceV3({
    assessment: {
      getAssessment: async () => assessmentRecord(currentDecision),
    },
    engine: { getRecord: async () => structuredClone(currentWorld) },
    orchestrator: {
      loadRecord: async () => ({
        episodes: [
          { studentDecision: {
            decisionRef: `decision-${input.sessionId}-accept`,
            decision: "accept",
            rationale: "建议与现场证据一致，因此采纳。",
            decidedAt: now,
          } },
          { studentDecision: {
            decisionRef: `decision-${input.sessionId}-evidence`,
            decision: "request_evidence",
            rationale: "关键说法缺少原始出处，先请求补证。",
            decidedAt: now,
          } },
        ],
      }),
    },
    store: input.store ?? new InMemoryLearnerAdaptationStoreV3(),
    ...(input.proxy ? { proxy: input.proxy } : {}),
    now: () => now,
  });
  return {
    service,
    setRound(next: {
      sessionId: string;
      assignment: ChallengeAssignment;
      competencyLevel: 1 | 2 | 3 | 4 | 5;
      decisionId: string;
      actions?: StudentWorkAction[];
    }) {
      assignment = next.assignment;
      currentDecision = decision({
        sessionId: next.sessionId,
        assignment,
        competencyLevel: next.competencyLevel,
        id: next.decisionId,
      });
      currentWorld = worldContext(
        next.sessionId,
        assignment,
        next.actions,
      );
    },
  };
}

describe("LearnerAdaptationServiceV3", () => {
  it("does not manufacture a learner twin, forecast or plan before final sufficient evidence", async () => {
    const proxy = new CapturingProxy();
    const fixture = serviceFixture({
      sessionId: "session-twin-insufficient",
      level: 4,
      competencyLevel: 2,
      final: false,
      proxy,
    });
    const snapshot = await fixture.service.getOrRefresh({
      sessionId: "session-twin-insufficient",
      fallbackLearner: { bindingId, actorId },
    });
    expect(snapshot.evidenceReady).toBe(false);
    expect(snapshot.record).toBeNull();
    expect(proxy.inputs).toEqual([]);
    const view = fixture.service.projectGrowth(snapshot, "student");
    expect(view.state).toBe("evidence_required");
    expect(view.profile).toBeNull();
    expect(view.forecast).toBeNull();
    expect(view.nextChallenge).toBeNull();
  });

  it("builds an evidence-only mutable profile and sends a de-identified safe summary to the proxy", async () => {
    const proxy = new CapturingProxy();
    const fixture = serviceFixture({
      sessionId: "session-twin-ready",
      level: 5,
      competencyLevel: 3,
      proxy,
    });
    const snapshot = await fixture.service.getOrRefresh({
      sessionId: "session-twin-ready",
    });
    const record = snapshot.record!;
    expect(record.profileHistory).toHaveLength(1);
    expect(record.forecasts).toHaveLength(1);
    expect(record.learningPlans).toHaveLength(1);
    expect(record.profileHistory[0]).toMatchObject({
      immutablePersonalityLabel: null,
      sensitiveAttributesExcluded: true,
    });
    expect(record.forecasts[0]).toMatchObject({
      evidenceEligible: false,
      canActForStudent: false,
      canScoreStudent: false,
    });
    expect(record.learningPlans[0]?.status).toBe("proposed");
    expect(record.learningPlans[0]?.teacherConfirmation).toBeNull();
    const proxyPayload = JSON.stringify(proxy.inputs);
    expect(proxyPayload).not.toContain(actorId);
    expect(proxyPayload).not.toContain(bindingId);
    expect(proxyPayload).not.toContain("principalBindingHash");
    expect(proxyPayload).not.toContain("teacher-reviewer");
    expect(proxyPayload).not.toContain("immutablePersonalityLabel");
    expect(record.challengeAssignments[0]!.challengeLevel).toBe(5);
    expect(record.challengeAssignments[0]!.scoreCeiling).toBe(90);
  });

  it("infers speed-first and revision response only from their authentic action order and repeated artifact work", async () => {
    const sessionId = "session-twin-tendency-evidence";
    const fixture = serviceFixture({
      sessionId,
      level: 4,
      competencyLevel: 2,
    });
    const assigned = challengeAssignment(sessionId, 4);
    fixture.setRound({
      sessionId,
      assignment: assigned,
      competencyLevel: 2,
      decisionId: "assessment-tendency-evidence",
      actions: [
        action(sessionId, 1, "draft"),
        action(sessionId, 2, "observe"),
        action(
          sessionId,
          3,
          "draft",
          `work-revision-${sessionId}-1`,
        ),
      ],
    });
    const snapshot = await fixture.service.getOrRefresh({ sessionId });
    const profile = snapshot.record!.profileHistory.at(-1)!;
    const speedFirst = profile.strategyTendencies.find(
      (item) => item.tendencyId === "speed_first",
    );
    const revisionResponsive = profile.strategyTendencies.find(
      (item) => item.tendencyId === "revision_responsive",
    );
    expect(speedFirst?.basisEvidenceRefs).toEqual([
      `work-action-${sessionId}-1`,
    ]);
    expect(revisionResponsive?.basisEvidenceRefs).toEqual([
      `work-action-${sessionId}-1`,
      `work-action-${sessionId}-3`,
    ]);
    expect(profile.scaffoldingResponse.productiveRevisionRate).toBe(0.5);
  });

  it.each([
    { current: 3 as const, competency: 1 as const, expected: 3 },
    { current: 5 as const, competency: 3 as const, expected: 5 },
    { current: 7 as const, competency: 5 as const, expected: 7 },
  ])("mechanically differentiates challenge 3/5/7 without exceeding one automatic step: $expected", async ({ current, competency, expected }) => {
    const sessionId = `session-twin-level-${expected}`;
    const fixture = serviceFixture({
      sessionId,
      level: current,
      competencyLevel: competency,
    });
    const snapshot = await fixture.service.getOrRefresh({ sessionId });
    const assignment = snapshot.record!.challengeAssignments[0]!;
    expect(assignment.challengeLevel).toBe(expected);
    expect(Math.abs(assignment.challengeLevel - current)).toBeLessThanOrEqual(1);
    expect(assignment.scoreCeiling).toBe(challengeScoreCeiling(expected));
  });

  it("pauses silent updating during appeal, then resumes only after a teacher resolution", async () => {
    const sessionId = "session-twin-appeal";
    const fixture = serviceFixture({
      sessionId,
      level: 4,
      competencyLevel: 2,
    });
    const first = await fixture.service.getOrRefresh({ sessionId });
    const appealed = await fixture.service.requestAppeal({
      sessionId,
      learnerBindingId: bindingId,
      learnerActorId: actorId,
      requestId: "request-twin-appeal",
      reason: "本轮现场断网导致部分证据没有进入画像，请教师核对作品版本。",
    });
    expect(appealed.updateBlockedByAppeal).toBe(true);
    expect(appealed.record!.updateReceipts).toHaveLength(1);
    await expect(fixture.service.reviewAdaptation({
      sessionId,
      requestId: "request-confirm-plan-during-appeal",
      teacherActorId: "teacher-reviewer",
      expectedProfileRevision: appealed.record!.profileHistory.at(-1)!.revision,
      action: "confirm_plan",
      reason: "申诉尚未完成，教师不应在此时确认或改变学生的成长安排。",
    })).rejects.toMatchObject({ code: "appeal_pending" });
    const nextDecisionAssignment = challengeAssignment(sessionId, 4);
    fixture.setRound({
      sessionId,
      assignment: nextDecisionAssignment,
      competencyLevel: 4,
      decisionId: "assessment-session-twin-appeal-second",
    });
    const blocked = await fixture.service.getOrRefresh({ sessionId });
    expect(blocked.record!.updateReceipts).toHaveLength(1);
    const resolved = await fixture.service.reviewAdaptation({
      sessionId,
      requestId: "request-resolve-twin-appeal",
      teacherActorId: "teacher-reviewer",
      expectedProfileRevision: blocked.record!.profileHistory.at(-1)!.revision,
      action: "resolve_appeal",
      reason: "已核对断网前后的作品哈希与证据引用，申诉记录成立并恢复后续更新。",
    });
    expect(resolved.record!.profileHistory.at(-1)!.appeal.status).toBe("resolved");
    const resumed = await fixture.service.getOrRefresh({ sessionId });
    expect(resumed.record!.updateReceipts).toHaveLength(2);
    expect(resumed.record!.profileHistory.at(-1)!.competencyStates[0]!.competencyLevel)
      .toBeGreaterThan(first.record!.profileHistory[0]!.competencyStates[0]!.competencyLevel);
  });

  it("allows a reasoned teacher override beyond one step while automatic policy remains bounded", async () => {
    const sessionId = "session-twin-override";
    const fixture = serviceFixture({
      sessionId,
      level: 3,
      competencyLevel: 1,
    });
    const first = await fixture.service.getOrRefresh({ sessionId });
    const overridden = await fixture.service.reviewAdaptation({
      sessionId,
      requestId: "request-teacher-challenge-override",
      teacherActorId: "teacher-reviewer",
      expectedProfileRevision: first.record!.profileHistory.at(-1)!.revision,
      action: "override_challenge",
      challengeLevel: 7,
      reason: "线下诊断显示该学生已有专业采编经验，教师决定用七级场景进一步检验。",
    });
    const assignment = overridden.record!.challengeAssignments.at(-1)!;
    expect(assignment.challengeLevel).toBe(7);
    expect(assignment.assignmentReason).toBe("teacher_override");
    expect(assignment.teacherOverride?.teacherId).toBe("teacher-reviewer");
    expect(assignment.scoreCeiling).toBe(100);
    const revisedPlan = overridden.record!.learningPlans.at(-1)!;
    expect(revisedPlan.sourceChallengeAssignmentRef)
      .toBe(assignment.challengeAssignmentId);
    expect(revisedPlan.recommendedChallengeLevel).toBe(7);
    expect(revisedPlan.recommendedWorldVariantRefs[0])
      .toBe(assignment.worldVariantRef);
  });

  it("calibrates a pending forecast only from authentic actions in its assigned next session", async () => {
    const firstSession = "session-twin-calibration";
    const fixture = serviceFixture({
      sessionId: firstSession,
      level: 5,
      competencyLevel: 3,
    });
    const first = await fixture.service.getOrRefresh({ sessionId: firstSession });
    const assigned = first.record!.challengeAssignments.at(-1)!;
    const nextActions = [
      action(assigned.sessionId, 1, "ask"),
      action(assigned.sessionId, 2, "draft"),
    ];
    fixture.setRound({
      sessionId: assigned.sessionId,
      assignment: assigned,
      competencyLevel: 3,
      decisionId: "assessment-calibration-next",
      actions: nextActions,
    });
    const calibrated = await fixture.service.getOrRefresh({
      sessionId: assigned.sessionId,
    });
    const forecast = calibrated.record!.forecasts.find(
      (item) => item.forecastId === assigned.forecastRef,
    )!;
    expect(forecast.calibration.status).toBe("evaluated");
    expect(forecast.calibration.actualStudentActionRefs).toEqual(
      nextActions.map((item) => item.workActionId),
    );
    expect(forecast.calibration.predictionError).not.toBeNull();
  });

  it("restores the exact profile and policy receipts from the atomic JSON store", async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "learner-adaptation-v3-"));
    const store = new JsonFileLearnerAdaptationStoreV3(temporaryDirectory);
    const fixture = serviceFixture({
      sessionId: "session-twin-restart",
      level: 5,
      competencyLevel: 3,
      store,
    });
    const snapshot = await fixture.service.getOrRefresh({
      sessionId: "session-twin-restart",
    });
    const restored = await new JsonFileLearnerAdaptationStoreV3(
      temporaryDirectory,
    ).load(snapshot.record!.learnerTwinId);
    expect(restored).toEqual(snapshot.record);
  });
});
