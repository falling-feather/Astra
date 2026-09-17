import { describe, expect, it } from "vitest";
import {
  type GoldPilotParticipantAssignment,
  type GoldPilotReadinessPlanInput,
  type GoldPilotRubricReviewInput,
} from "@ronggang/contracts";
import { hashValue } from "@ronggang/context-engine";
import {
  GoldPilotReadinessCoordinator,
  InMemoryGoldPilotReadinessStore,
  createGoldPilotRubricPackage,
} from "../src/index.js";

function assignments(): GoldPilotParticipantAssignment[] {
  return [{
    participantAlias: "student_01",
    sequence: "course_then_dual",
    runs: [
      {
        period: 1,
        sessionId: "pilot-course-01",
        arm: "course_platform_only",
        roleId: "responsible_editor",
        teacherAlias: "teacher_01",
      },
      {
        period: 2,
        sessionId: "pilot-dual-01",
        arm: "full_dual_dimension",
        roleId: "responsible_editor",
        teacherAlias: "teacher_01",
      },
    ],
  }];
}

function planInput(): GoldPilotReadinessPlanInput {
  const rubricPackage = {
    rubricRef: "rubric://pilot-media/1.0.0",
    rubricVersion: "1.0.0",
    dimensions: [
      {
        dimensionId: "fact-checking",
        label: "事实核验",
        definitionHash: hashValue("fact-definition"),
        behaviorAnchorsHash: hashValue("fact-anchors"),
        evidenceSourcesHash: hashValue("fact-evidence"),
        redLinesHash: hashValue("fact-red-lines"),
        proposedWeight: 60,
      },
      {
        dimensionId: "professional-judgement",
        label: "职业判断",
        definitionHash: hashValue("judgement-definition"),
        behaviorAnchorsHash: hashValue("judgement-anchors"),
        evidenceSourcesHash: hashValue("judgement-evidence"),
        redLinesHash: hashValue("judgement-red-lines"),
        proposedWeight: 40,
      },
    ],
  };
  const rubricHash = createGoldPilotRubricPackage(
    rubricPackage,
  ).packageHash;
  return {
    participantAssignments: assignments(),
    taskAllocations: [{
      participantAlias: "student_01",
      taskSequence: "task_a_then_b",
      runs: [
        {
          period: 1,
          sessionId: "pilot-course-01",
          taskVariantId: "task-a",
        },
        {
          period: 2,
          sessionId: "pilot-dual-01",
          taskVariantId: "task-b",
        },
      ],
    }],
    expertReviewerAliases: [
      "expert_01",
      "expert_02",
      "expert_03",
    ],
    rubricPackage,
    equivalentTasks: {
      variants: [
        {
          taskVariantId: "task-a",
          scenarioId: "scenario-pilot-a",
          scenarioVersion: "1.0.0",
          scenarioContentHash: hashValue("scenario-a"),
          taskDefinitionHash: hashValue("task-a-definition"),
          learningOutcomeSetHash: hashValue("shared-outcomes"),
          evidenceRequirementSetHash: hashValue("shared-evidence"),
          rubricHash,
          expectedMinutes: 30,
        },
        {
          taskVariantId: "task-b",
          scenarioId: "scenario-pilot-b",
          scenarioVersion: "1.0.0",
          scenarioContentHash: hashValue("scenario-b"),
          taskDefinitionHash: hashValue("task-b-definition"),
          learningOutcomeSetHash: hashValue("shared-outcomes"),
          evidenceRequirementSetHash: hashValue("shared-evidence"),
          rubricHash,
          expectedMinutes: 32,
        },
      ],
    },
    informationSheet: {
      version: "pilot-information/1.0.0",
      documentHash: hashValue("fixed-information-sheet"),
    },
    minimumDataPolicy: {
      policyVersion: "pilot-minimum-data/1.0.0",
      policyDocumentHash: hashValue("fixed-minimum-data-policy"),
    },
  };
}

function acceptedReview(
  dimensionId: string,
): GoldPilotRubricReviewInput {
  return {
    dimensionId,
    definition: "adequate",
    behaviorAnchors: "adequate",
    evidenceSources: "adequate",
    redLines: "adequate",
    weightRecommendation: "retain",
    reasonCodes: ["accepted_as_is"],
    rationaleArtifactHash: null,
  };
}

function clock() {
  let index = 0;
  return () => new Date(
    Date.UTC(2026, 6, 30, 12, index++, 0),
  ).toISOString();
}

describe("GoldPilotReadinessCoordinator", () => {
  it("freezes only complete content-validity, task and consent evidence", async () => {
    const coordinator = new GoldPilotReadinessCoordinator(
      new InMemoryGoldPilotReadinessStore(),
      { now: clock() },
    );
    let plan = await coordinator.createPlan({
      anchorSessionId: "pilot-course-01",
      createdByActorId: "teacher-main",
      ...planInput(),
    });
    expect(plan.summary).toMatchObject({
      status: "collecting_prerequisites",
      expertReviewerCount: 3,
      rubricDimensionCount: 2,
      completedRubricReviewCount: 0,
      expectedRubricReviewCount: 6,
      consentedTeacherCount: 0,
      consentedStudentCount: 0,
    });
    expect(plan.summary.missingRequirements).toEqual(expect.arrayContaining([
      "还需 6 份独立量规维度评审",
      "还需 2 个量规维度处置",
      "还需 1 份去标识教师知情确认收据",
      "还需 1 份去标识学生知情确认收据",
    ]));
    await expect(
      coordinator.freezePlan(plan.readinessId),
    ).rejects.toMatchObject({ code: "readiness_not_ready" });

    for (const reviewerAlias of plan.expertReviewerAliases) {
      for (const dimension of plan.rubricPackage.dimensions) {
        plan = await coordinator.submitRubricReview(
          plan.readinessId,
          reviewerAlias,
          acceptedReview(dimension.dimensionId),
        );
      }
    }
    for (const dimension of plan.rubricPackage.dimensions) {
      plan = await coordinator.resolveRubricDimension(
        plan.readinessId,
        {
          dimensionId: dimension.dimensionId,
          decision: "retained",
          revisionArtifactHash: null,
        },
      );
    }
    plan = await coordinator.confirmConsent(plan.readinessId, {
      participantAlias: "teacher_01",
      participantKind: "teacher",
      sourceRecordHash: hashValue("offline-teacher-consent"),
    });
    plan = await coordinator.confirmConsent(plan.readinessId, {
      participantAlias: "student_01",
      participantKind: "student",
      sourceRecordHash: hashValue("offline-student-consent"),
    });
    expect(plan.summary.status).toBe("ready_to_freeze");

    plan = await coordinator.freezePlan(plan.readinessId);
    expect(plan.summary.status).toBe("frozen");
    expect(plan.freezeReceipt?.receiptHash).toMatch(/^[a-f0-9]{64}$/u);
    await expect(coordinator.assertStudyLaunchAllowed({
      readinessId: plan.readinessId,
      freezeReceiptHash: plan.freezeReceipt!.receiptHash,
      anchorSessionId: "pilot-course-01",
      participantAssignments: assignments(),
    })).resolves.toEqual(plan.freezeReceipt);
    await expect(coordinator.assertSessionAccessAllowed({
      sessionId: "pilot-course-01",
      actorKind: "student",
      roleId: "responsible_editor",
    })).resolves.toBeUndefined();
    await expect(coordinator.assertSessionAccessAllowed({
      sessionId: "pilot-course-01",
      actorKind: "student",
      roleId: "reporter",
    })).rejects.toMatchObject({ code: "consent_required" });

    plan = await coordinator.withdrawConsent(plan.readinessId, {
      participantAlias: "student_01",
      participantKind: "student",
      sourceRecordHash: hashValue("offline-withdrawal-record"),
    });
    expect(plan.summary.status).toBe("frozen_with_withdrawals");
    await expect(coordinator.assertSessionAccessAllowed({
      sessionId: "pilot-course-01",
      actorKind: "student",
      roleId: "responsible_editor",
    })).rejects.toMatchObject({ code: "consent_withdrawn" });
    await expect(coordinator.assertFinalizationAllowed(
      "pilot-course-01",
      { outcome: "completed", exitCategory: "completed" },
    )).rejects.toMatchObject({ code: "consent_withdrawn" });
    await expect(coordinator.assertFinalizationAllowed(
      "pilot-course-01",
      {
        outcome: "withdrawn",
        exitCategory: "consent_revoked",
      },
    )).resolves.toBeUndefined();

    const serialized = JSON.stringify(plan);
    expect(serialized).not.toContain("offline-student-consent");
    expect(serialized).not.toContain("fixed-information-sheet");
    expect(plan.minimumDataPolicy.prohibitedFields).toContain("real_name");
  });

  it("requires all expert reviews and a non-retained resolution for concerns", async () => {
    const coordinator = new GoldPilotReadinessCoordinator(
      new InMemoryGoldPilotReadinessStore(),
      { now: clock() },
    );
    let plan = await coordinator.createPlan({
      anchorSessionId: "pilot-course-01",
      createdByActorId: "teacher-main",
      ...planInput(),
    });
    const dimensionId = plan.rubricPackage.dimensions[0]!.dimensionId;
    plan = await coordinator.submitRubricReview(
      plan.readinessId,
      "expert_01",
      {
        ...acceptedReview(dimensionId),
        behaviorAnchors: "revision_required",
        reasonCodes: ["behavior_anchor_unobservable"],
        rationaleArtifactHash: hashValue("expert-01-rationale"),
      },
    );
    for (const reviewerAlias of ["expert_02", "expert_03"]) {
      plan = await coordinator.submitRubricReview(
        plan.readinessId,
        reviewerAlias,
        acceptedReview(dimensionId),
      );
    }
    await expect(coordinator.resolveRubricDimension(plan.readinessId, {
      dimensionId,
      decision: "retained",
      revisionArtifactHash: null,
    })).rejects.toMatchObject({ code: "invalid_plan_input" });
    plan = await coordinator.resolveRubricDimension(plan.readinessId, {
      dimensionId,
      decision: "revised",
      revisionArtifactHash: hashValue("rubric-revision-1"),
    });
    expect(plan.rubricResolutions[0]).toMatchObject({
      resolution: {
        dimensionId,
        decision: "revised",
      },
    });
    await expect(coordinator.submitRubricReview(
      plan.readinessId,
      "expert_01",
      acceptedReview(dimensionId),
    )).rejects.toMatchObject({ code: "status_conflict" });
  });

  it("requires one session per run and disjoint teacher/student aliases", async () => {
    const coordinator = new GoldPilotReadinessCoordinator(
      new InMemoryGoldPilotReadinessStore(),
      { now: clock() },
    );
    const duplicateSession = structuredClone(planInput());
    duplicateSession.participantAssignments[0]!.runs[1].sessionId =
      duplicateSession.participantAssignments[0]!.runs[0].sessionId;
    duplicateSession.taskAllocations[0]!.runs[1].sessionId =
      duplicateSession.taskAllocations[0]!.runs[0].sessionId;
    await expect(coordinator.createPlan({
      anchorSessionId: "pilot-course-01",
      createdByActorId: "teacher-main",
      ...duplicateSession,
    })).rejects.toMatchObject({ code: "invalid_plan_input" });

    const reusedAlias = structuredClone(planInput());
    reusedAlias.participantAssignments[0]!.runs[0].teacherAlias =
      "student_01";
    reusedAlias.participantAssignments[0]!.runs[1].teacherAlias =
      "student_01";
    await expect(coordinator.createPlan({
      anchorSessionId: "pilot-course-01",
      createdByActorId: "teacher-main",
      ...reusedAlias,
    })).rejects.toMatchObject({ code: "invalid_plan_input" });
  });
});
