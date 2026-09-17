import { describe, expect, it } from "vitest";
import {
  ChallengeAssignmentSchema,
  ChallengeAssignmentSchemaVersion,
} from "@ronggang/contracts";
import {
  buildXunpuFlagshipRuntimeReleaseV3R2,
  xunpuV4AdaptationVariants,
  xunpuExplorationLesson,
} from "@ronggang/course-content";
import {
  InMemorySessionControlStore,
  SessionControlService,
  type SessionMembership,
} from "@ronggang/session-control";
import {
  InMemorySimulationSessionStore,
  WorldSimulationEngineV3,
} from "@ronggang/world-core";
import {
  DemoAuthService,
  stableMembershipBindingId,
} from "../src/identity.js";
import {
  deriveSecondSessionReleaseV4,
  LearnerAdaptationErrorV4,
  type LearnerForecastV4,
  type LearnerTwinV4,
  type ProvisionSecondSessionInputV4,
} from "../src/learner-adaptation-v4.js";
import { createDefaultSecondSessionProvisionerV4 } from "../src/server.js";
import {
  BusinessOperationCoordinator,
  InMemoryBusinessOperationReceiptStore,
} from "../src/business-operation-receipt.js";
import {
  buildSessionExperienceDescriptor,
} from "../src/session-experience-descriptor.js";

const now = "2026-08-29T10:00:00.000Z";
const sourceSessionId = "session-source-provisioner-v4";
const secondSessionId = "session-second-provisioner-v4";
const studentPrincipalId = "principal-student-unassigned";
const teacherPrincipalId = "principal-teacher-class-a";
const studentMembershipId = "membership-source-student-v4";

async function runtime() {
  const sessionControl = new SessionControlService(new InMemorySessionControlStore());
  await sessionControl.putClassroom({
    classroomId: "classroom-v4",
    courseId: "course-xunpu-intangible-media",
    name: "蟳埔旗舰班",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  await sessionControl.putTeam({
    teamId: "team-v4",
    classroomId: "classroom-v4",
    name: "采访一组",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  const baseRelease = buildXunpuFlagshipRuntimeReleaseV3R2();
  await sessionControl.createSession({
    sessionId: sourceSessionId,
    classroomId: "classroom-v4",
    teamId: "team-v4",
    releaseId: baseRelease.simulationReleaseRef.releaseId,
    status: "provisioning",
    statusVersion: 0,
    requestedBy: teacherPrincipalId,
    createdAt: now,
    updatedAt: now,
    activatedAt: null,
    completedAt: null,
    lastRecoveryErrorCode: null,
  }, "request-source-session-v4");
  await sessionControl.transitionSessionStatus({
    sessionId: sourceSessionId,
    expectedStatus: "provisioning",
    expectedStatusVersion: 0,
    nextStatus: "active",
    updatedAt: now,
  });
  const studentMembership: SessionMembership = {
    membershipId: studentMembershipId,
    principalId: studentPrincipalId,
    classroomId: "classroom-v4",
    teamId: "team-v4",
    sessionId: null,
    role: "student",
    actorId: "student-reporter",
    status: "active",
    createdAt: now,
    updatedAt: now,
    revokedAt: null,
  };
  const teacherMembership: SessionMembership = {
    membershipId: "membership-source-teacher-v4",
    principalId: teacherPrincipalId,
    classroomId: "classroom-v4",
    teamId: null,
    sessionId: null,
    role: "teacher",
    actorId: "teacher-main",
    status: "active",
    createdAt: now,
    updatedAt: now,
    revokedAt: null,
  };
  await sessionControl.putMembership(studentMembership);
  await sessionControl.putMembership(teacherMembership);
  const sourceAssignment = {
    membershipId: studentMembership.membershipId,
    principalId: studentPrincipalId,
    sessionId: sourceSessionId,
    actorId: "student-reporter",
    actorKind: "student" as const,
    roleId: "reporter" as const,
    status: "active" as const,
  };
  const learnerBindingId = stableMembershipBindingId(
    studentPrincipalId,
    sourceAssignment,
  );
  const auth = new DemoAuthService({ now: () => now });
  const studentLogin = auth.issueMembershipSession({
    profileId: "student-unassigned",
    principalId: studentPrincipalId,
    displayName: "学生记者",
  }, [sourceAssignment]);
  const teacherLogin = auth.issueMembershipSession({
    profileId: "teacher-class-a",
    principalId: teacherPrincipalId,
    displayName: "课程教师",
  }, [{
    membershipId: teacherMembership.membershipId,
    principalId: teacherPrincipalId,
    sessionId: sourceSessionId,
    actorId: "teacher-main",
    actorKind: "teacher",
    roleId: "teacher",
    status: "active",
  }]);
  const world = new WorldSimulationEngineV3({
    store: new InMemorySimulationSessionStore(),
  });
  const variant = xunpuV4AdaptationVariants.find((item) => (
    item.variantId === "variant-xunpu-source-triangulation"
  ))!;
  const derived = deriveSecondSessionReleaseV4({
    baseRelease,
    variant,
    targetChallengeLevel: 4,
  });
  const challengeAssignment = ChallengeAssignmentSchema.parse({
    schemaVersion: ChallengeAssignmentSchemaVersion,
    challengeAssignmentId: "challenge-second-provisioner-v4",
    learnerTwinRef: "learner-twin-provisioner-v4",
    sessionId: secondSessionId,
    simulationReleaseRef: derived.release.simulationReleaseRef,
    worldVariantRef: derived.selectedWorldVariantRef,
    previousChallengeLevel: 4,
    challengeLevel: 4,
    scoreCeiling: 85,
    pressureDimensions: [
      { dimensionId: "source_access", intensity: 4 },
      { dimensionId: "time", intensity: 3 },
    ],
    assignmentReason: "evidence_recovery",
    basisEvidenceRefs: ["evidence-source-v4"],
    forecastRef: "forecast-provisioner-v4",
    teacherOverride: null,
    policyVersion: "evidence-adaptation-v4/1.0.0",
    policyContentHash: "d".repeat(64),
    assignedAt: now,
  });
  const criterionScores = [
    ["criterion-fact-verification", 58],
    ["criterion-interview-consent", 72],
    ["criterion-editorial-judgment", 76],
    ["criterion-rights-governance", 78],
    ["criterion-multiplatform-production", 82],
    ["criterion-recovery-transfer", 68],
  ] as const;
  world.registerFieldLesson(xunpuExplorationLesson);
  await world.startSession({ sessionId: sourceSessionId, release: baseRelease, challengeAssignment: {
    ...challengeAssignment, sessionId: sourceSessionId, challengeAssignmentId: "source-challenge", simulationReleaseRef: baseRelease.simulationReleaseRef,
    worldVariantRef: baseRelease.challengeVariants.find(item => item.challengeLevel === 4)!.worldVariantId,
    previousChallengeLevel: null, assignmentReason: "initial_diagnostic", basisEvidenceRefs: [], forecastRef: null,
  }, targetCompetencyRefs: ["criterion-fact-verification"], scaffoldingLevel: 1, startedAt: now,
    fieldInterview: { lessonHash: xunpuExplorationLesson.contentHash, actorId: "student-reporter", bindingId: learnerBindingId } });
  const learnerTwin: LearnerTwinV4 = {
    learnerTwinRef: "learner-twin-provisioner-v4",
    revision: 1,
    sourceAssessmentDecisionRef: "assessment-final-provisioner-v4",
    criterionStates: criterionScores.map(([criterionId, score], index) => ({
      criterionId,
      evidenceStatus: "supported" as const,
      band: score >= 80 ? "high" as const : score >= 60 ? "medium" as const : "low" as const,
      score,
      confidence: 0.8,
      evidenceRefs: [`evidence-${index}`],
      supportEvidenceRefs: [`evidence-${index}`],
      counterEvidenceRefs: [],
      uncertaintyDrivers: [],
      lastPredictionError: null,
    })),
    growthTargetRefs: ["criterion-fact-verification"],
    sourceChallengeLevel: 4,
    sourceScaffoldingLevel: 1,
    calibrationCount: 0,
    calibrationHistory: [],
    limitations: ["学习者代理仅基于已评分证据推断，不等同于固定人格标签。"],
    contentHash: "b".repeat(64),
    updatedAt: now,
  };
  const forecast: LearnerForecastV4 = {
    forecastRef: "forecast-provisioner-v4",
    revision: 1,
    assessorMode: "deterministic_fallback",
    learnerTwinContentHash: learnerTwin.contentHash,
    candidates: xunpuV4AdaptationVariants.map((candidate) => ({
      variantRef: candidate.variantId as LearnerForecastV4["candidates"][number]["variantRef"],
      predictedSuccessProbability: 0.65,
      predictedOverloadProbability: 0.25,
      predictedGrowthValue: 0.72,
      rationale: "只作为候选比较，不参与评分。",
    })),
    selectedVariantRef: variant.variantId as LearnerForecastV4["selectedVariantRef"],
    evidenceEligibleForScore: false,
    canActForStudent: false,
    generatedAt: now,
  };
  const businessOperations = new BusinessOperationCoordinator(
    new InMemoryBusinessOperationReceiptStore(),
    () => now,
  );
  const provision = createDefaultSecondSessionProvisionerV4({
    sessionControl,
    auth,
    worldSimulationV3: world,
    businessOperations,
    registerFieldLesson: async lesson => world.registerFieldLesson(lesson),
    freezeExperienceDescriptor: ({ sessionId, frozenAt }) => Promise.resolve(
      buildSessionExperienceDescriptor({
        sessionId,
        courseReleaseRef: derived.release.courseReleaseRef,
        scenarioReleaseRef: derived.release.scenarioReleaseRef,
        experienceGeneration: "flagship_v4",
        frozenAt,
      }),
    ),
  });
  const input: ProvisionSecondSessionInputV4 = {
    sourceSessionId,
    learnerBindingId,
    learnerActorId: "student-reporter",
    learnerSubjectHash: "a".repeat(64),
    learnerTwin,
    forecast,
    teacherActorId: "teacher-main",
    teacherPrincipalId,
    teacherAuthorizationRef: "teacher-authorization-provisioner-v4",
    release: derived.release,
    challengeAssignment,
    targetCompetencyRefs: ["criterion-fact-verification"],
    scaffoldingLevel: 2,
    requestedAt: now,
  };
  return {
    sessionControl,
    auth,
    world,
    businessOperations,
    provision,
    input,
    studentLogin,
    teacherLogin,
  };
}

describe("default second-session provisioner V4", () => {
  it("activates only a real changed world with exact learner and teacher memberships", async () => {
    const value = await runtime();
    const receipt = await value.provision(value.input);
    expect(receipt).toMatchObject({
      sessionRef: secondSessionId,
      bindingRef: expect.stringMatching(/^binding-/u),
      challengeAssignmentRef: value.input.challengeAssignment.challengeAssignmentId,
    });
    expect((await value.sessionControl.getSession(secondSessionId))?.status).toBe("active");
    const record = await value.world.getRecord(secondSessionId);
    expect(record.release.simulationReleaseRef.contentHash)
      .toBe(value.input.release.simulationReleaseRef.contentHash);
    expect(record.challengeAssignment.worldVariantRef)
      .toBe(value.input.challengeAssignment.worldVariantRef);
    expect(record.fieldInterview?.lessonRef.contentHash).not.toBe(xunpuExplorationLesson.contentHash);
    const followup = value.world.getFieldLesson(record.fieldInterview!.lessonRef.contentHash);
    expect(followup.choices.find(item => item.id === "chen-mail")!.delayMinutes).toBe(9);
    expect(record.fieldInterview?.turns).toEqual([]);
    const memberships = await value.sessionControl.listMemberships({
      sessionId: secondSessionId,
      statuses: ["active"],
    });
    expect(memberships.map((item) => item.role).sort()).toEqual(["student", "teacher"]);
    expect(value.auth.resolvePrincipal(value.studentLogin.token).bindings)
      .toEqual(expect.arrayContaining([expect.objectContaining({
        bindingId: receipt.bindingRef,
        sessionId: secondSessionId,
        actorKind: "student",
        roleId: "reporter",
      })]));
    expect(value.auth.resolvePrincipal(value.teacherLogin.token).bindings)
      .toEqual(expect.arrayContaining([expect.objectContaining({
        sessionId: secondSessionId,
        actorKind: "teacher",
      })]));
    const [operation] = await value.businessOperations.list();
    expect(operation).toMatchObject({
      operationKind: "provision_second_session",
      phase: "completed",
      authorityCommitRef: secondSessionId,
    });
    expect(operation?.outbox).toHaveLength(6);
    expect(operation?.outbox.every((item) => item.status === "delivered"))
      .toBe(true);

    const replay = await value.provision(value.input);
    expect(replay).toEqual(receipt);
    expect((await value.sessionControl.listMemberships({ sessionId: secondSessionId })))
      .toHaveLength(2);
  });

  it("rejects a cross-learner binding before creating any second session", async () => {
    const value = await runtime();
    await expect(value.provision({
      ...value.input,
      learnerBindingId: "binding-forged-other-learner",
    })).rejects.toBeInstanceOf(LearnerAdaptationErrorV4);
    expect(await value.sessionControl.getSession(secondSessionId)).toBeNull();
    await expect(value.world.getRecord(secondSessionId)).rejects.toThrow();
  });
});
