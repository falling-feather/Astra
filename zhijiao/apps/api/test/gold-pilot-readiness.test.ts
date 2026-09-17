import { afterEach, describe, expect, it } from "vitest";
import {
  appendFile,
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GoldPilotReadinessViewSchema,
  GoldPilotReadinessWorkflowViewSchema,
  GoldPilotStudyViewSchema,
  type GoldPilotParticipantAssignment,
  type GoldPilotReadinessPlanInput,
  type RoleBinding,
} from "@ronggang/contracts";
import { hashValue } from "@ronggang/context-engine";
import {
  GoldPilotReadinessCoordinator,
  InMemoryGoldPilotReadinessStore,
  createGoldPilotRubricPackage,
} from "@ronggang/agent-runtime";
import type { FastifyInstance } from "fastify";
import {
  InMemoryEventStore,
  InProcessMessageBus,
  WorldEngine,
  demoScenario,
  demoScenarioV100ContentHash,
} from "@ronggang/world-core";
import type { DemoAuthContext } from "../src/identity.js";
import { JsonlGoldPilotReadinessStore } from "../src/jsonl-gold-pilot-readiness-store.js";
import {
  createMemoryTestApp,
  DEMO_SESSION_ID,
} from "../src/server.js";
import {
  DEMO_CLASSROOM_A_ID,
  DEMO_SECONDARY_SESSION_ID,
  DEMO_TEAM_A_ID,
} from "../src/session-control-bootstrap.js";

const localOrigin = "http://localhost:5173";
let app: FastifyInstance | null = null;

afterEach(async () => {
  if (app) await app.close();
  app = null;
});

function binding(
  bindings: readonly RoleBinding[],
  actorKind: "student" | "teacher",
): RoleBinding {
  const value = bindings.find((item) => item.actorKind === actorKind);
  if (!value) throw new Error(`测试登录缺少 ${actorKind} 绑定`);
  return value;
}

function assignments(
  secondSessionId = DEMO_SECONDARY_SESSION_ID,
): GoldPilotParticipantAssignment[] {
  return [{
    participantAlias: "student_01",
    sequence: "course_then_dual",
    runs: [
      {
        period: 1,
        sessionId: DEMO_SESSION_ID,
        arm: "course_platform_only",
        roleId: "responsible_editor",
        teacherAlias: "teacher_01",
      },
      {
        period: 2,
        sessionId: secondSessionId,
        arm: "full_dual_dimension",
        roleId: "responsible_editor",
        teacherAlias: "teacher_01",
      },
    ],
  }];
}

function planInput(
  secondSessionId = DEMO_SECONDARY_SESSION_ID,
): GoldPilotReadinessPlanInput {
  const rubricPackage = {
    rubricRef: "rubric://api-pilot/1.0.0",
    rubricVersion: "1.0.0",
    dimensions: [{
      dimensionId: "fact-checking",
      label: "事实核验",
      definitionHash: hashValue("definition"),
      behaviorAnchorsHash: hashValue("anchors"),
      evidenceSourcesHash: hashValue("evidence"),
      redLinesHash: hashValue("red-lines"),
      proposedWeight: 100,
    }],
  };
  const rubricHash = createGoldPilotRubricPackage(
    rubricPackage,
  ).packageHash;
  return {
    participantAssignments: assignments(secondSessionId),
    taskAllocations: [{
      participantAlias: "student_01",
      taskSequence: "task_a_then_b",
      runs: [
        {
          period: 1,
          sessionId: DEMO_SESSION_ID,
          taskVariantId: "task-a",
        },
        {
          period: 2,
          sessionId: secondSessionId,
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
          scenarioId: demoScenario.scenarioId,
          scenarioVersion: demoScenario.version,
          scenarioContentHash: demoScenarioV100ContentHash,
          taskDefinitionHash: hashValue("task-a-definition"),
          learningOutcomeSetHash: hashValue("shared-outcomes"),
          evidenceRequirementSetHash: hashValue("shared-evidence"),
          rubricHash,
          expectedMinutes: 30,
        },
        {
          taskVariantId: "task-b",
          scenarioId: demoScenario.scenarioId,
          scenarioVersion: demoScenario.version,
          scenarioContentHash: demoScenarioV100ContentHash,
          taskDefinitionHash: hashValue("task-b-definition"),
          learningOutcomeSetHash: hashValue("shared-outcomes"),
          evidenceRequirementSetHash: hashValue("shared-evidence"),
          rubricHash,
          expectedMinutes: 30,
        },
      ],
    },
    informationSheet: {
      version: "information/1.0.0",
      documentHash: hashValue("fixed-information"),
    },
    minimumDataPolicy: {
      policyVersion: "minimum-data/1.0.0",
      policyDocumentHash: hashValue("fixed-policy"),
    },
  };
}

function acceptedReview() {
  return {
    dimensionId: "fact-checking",
    definition: "adequate" as const,
    behaviorAnchors: "adequate" as const,
    evidenceSources: "adequate" as const,
    redLines: "adequate" as const,
    weightRecommendation: "retain" as const,
    reasonCodes: ["accepted_as_is" as const],
    rationaleArtifactHash: null,
  };
}

describe("gold pilot readiness API", () => {
  it("gates study launch and participant actions on frozen, revocable evidence", async () => {
    app = await createMemoryTestApp({
      engine: new WorldEngine({
        store: new InMemoryEventStore(),
        bus: new InProcessMessageBus(),
        scenario: structuredClone(demoScenario),
      }),
      initializeSecondaryDemo: true,
    });
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/demo-session",
      headers: { origin: localOrigin },
      payload: {},
    });
    expect(login.statusCode).toBe(200);
    const auth = login.json() as DemoAuthContext;
    const setCookie = Array.isArray(login.headers["set-cookie"])
      ? login.headers["set-cookie"][0]
      : login.headers["set-cookie"];
    if (!setCookie) throw new Error("测试登录没有 Cookie");
    const cookie = setCookie.split(";")[0]!;
    const teacher = binding(auth.bindings, "teacher");
    const student = binding(auth.bindings, "student");
    const mutationHeaders = {
      cookie,
      origin: localOrigin,
      "x-csrf-token": auth.csrfToken,
    };
    const demoRelease = await app.inject({
      method: "GET",
      url: "/api/scenario/demo",
    });
    expect(demoRelease.statusCode).toBe(200);
    const secondSession = await app.inject({
      method: "POST",
      url: "/api/training-sessions",
      headers: mutationHeaders,
      payload: {
        authorizationSessionId: DEMO_SESSION_ID,
        bindingId: teacher.bindingId,
        requestId: "gold-pilot-readiness-task-b",
        classroomId: DEMO_CLASSROOM_A_ID,
        teamId: DEMO_TEAM_A_ID,
        releaseId: demoRelease.json().release.releaseId,
      },
    });
    expect(secondSession.statusCode).toBe(200);
    const secondSessionId = secondSession.json().sessionId as string;

    const emptyResponse = await app.inject({
      method: "GET",
      url:
        `/api/sessions/${DEMO_SESSION_ID}/gold-pilot-readiness?bindingId=${teacher.bindingId}`,
      headers: { cookie },
    });
    expect(emptyResponse.statusCode).toBe(200);
    expect(
      GoldPilotReadinessWorkflowViewSchema.parse(emptyResponse.json())
        .activePlan,
    ).toBeNull();

    const studentDenied = await app.inject({
      method: "GET",
      url:
        `/api/sessions/${DEMO_SESSION_ID}/gold-pilot-readiness?bindingId=${student.bindingId}`,
      headers: { cookie },
    });
    expect(studentDenied.statusCode).toBe(403);

    const create = await app.inject({
      method: "POST",
      url:
        `/api/sessions/${DEMO_SESSION_ID}/gold-pilot-readiness/plans`,
      headers: mutationHeaders,
      payload: {
        bindingId: teacher.bindingId,
        ...planInput(secondSessionId),
      },
    });
    expect(create.statusCode).toBe(201);
    let plan = GoldPilotReadinessViewSchema.parse(create.json());
    expect(plan.summary.status).toBe("collecting_prerequisites");

    const prematureStudy = await app.inject({
      method: "POST",
      url: `/api/sessions/${DEMO_SESSION_ID}/gold-pilot-study/studies`,
      headers: mutationHeaders,
      payload: {
        bindingId: teacher.bindingId,
        readinessId: plan.readinessId,
        freezeReceiptHash: "a".repeat(64),
        participantAssignments: assignments(secondSessionId),
      },
    });
    expect(prematureStudy.statusCode).toBe(409);
    expect(prematureStudy.json()).toMatchObject({
      code: "readiness_not_frozen",
    });

    const blockedBeforeFreeze = await app.inject({
      method: "POST",
      url: `/api/sessions/${DEMO_SESSION_ID}/commands`,
      headers: mutationHeaders,
      payload: {
        bindingId: student.bindingId,
        name: "record_experience_choice",
        expectedStateVersion: 0,
        sourceMode: "course_platform",
        payload: {},
      },
    });
    expect(blockedBeforeFreeze.statusCode).toBe(409);
    expect(blockedBeforeFreeze.json()).toMatchObject({
      code: "readiness_not_frozen",
    });

    for (const reviewerAlias of plan.expertReviewerAliases) {
      const response = await app.inject({
        method: "POST",
        url:
          `/api/sessions/${DEMO_SESSION_ID}/gold-pilot-readiness/plans/${plan.readinessId}/reviews`,
        headers: mutationHeaders,
        payload: {
          bindingId: teacher.bindingId,
          reviewerAlias,
          review: acceptedReview(),
        },
      });
      expect(response.statusCode).toBe(200);
      plan = GoldPilotReadinessViewSchema.parse(response.json());
    }
    const resolution = await app.inject({
      method: "POST",
      url:
        `/api/sessions/${DEMO_SESSION_ID}/gold-pilot-readiness/plans/${plan.readinessId}/resolutions`,
      headers: mutationHeaders,
      payload: {
        bindingId: teacher.bindingId,
        resolution: {
          dimensionId: "fact-checking",
          decision: "retained",
          revisionArtifactHash: null,
        },
      },
    });
    expect(resolution.statusCode).toBe(200);
    plan = GoldPilotReadinessViewSchema.parse(resolution.json());

    for (const consent of [
      {
        participantAlias: "teacher_01",
        participantKind: "teacher" as const,
        sourceRecordHash: hashValue("teacher-consent"),
      },
      {
        participantAlias: "student_01",
        participantKind: "student" as const,
        sourceRecordHash: hashValue("student-consent"),
      },
    ]) {
      const response = await app.inject({
        method: "POST",
        url:
          `/api/sessions/${DEMO_SESSION_ID}/gold-pilot-readiness/plans/${plan.readinessId}/consents`,
        headers: mutationHeaders,
        payload: { bindingId: teacher.bindingId, consent },
      });
      expect(response.statusCode).toBe(200);
      plan = GoldPilotReadinessViewSchema.parse(response.json());
    }
    expect(plan.summary.status).toBe("ready_to_freeze");

    const freeze = await app.inject({
      method: "POST",
      url:
        `/api/sessions/${DEMO_SESSION_ID}/gold-pilot-readiness/plans/${plan.readinessId}/freeze`,
      headers: mutationHeaders,
      payload: { bindingId: teacher.bindingId },
    });
    expect(freeze.statusCode).toBe(200);
    plan = GoldPilotReadinessViewSchema.parse(freeze.json());
    expect(plan.summary.status).toBe("frozen");

    const createStudy = await app.inject({
      method: "POST",
      url: `/api/sessions/${DEMO_SESSION_ID}/gold-pilot-study/studies`,
      headers: mutationHeaders,
      payload: {
        bindingId: teacher.bindingId,
        readinessId: plan.readinessId,
        freezeReceiptHash: plan.freezeReceipt!.receiptHash,
        participantAssignments: assignments(secondSessionId),
      },
    });
    expect(createStudy.statusCode).toBe(201);
    const study = GoldPilotStudyViewSchema.parse(createStudy.json());
    expect(study.designBinding).toMatchObject({
      readinessId: plan.readinessId,
      readinessFreezeReceiptHash: plan.freezeReceipt!.receiptHash,
      assignmentSnapshotHash:
        plan.freezeReceipt!.assignmentSnapshotHash,
      taskAllocationSnapshotHash:
        plan.freezeReceipt!.taskAllocationSnapshotHash,
    });
    expect(study.analysisPlan?.planHash).toBe(
      study.designBinding?.analysisPlanHash,
    );

    const blockedWorldAction = await app.inject({
      method: "POST",
      url: `/api/sessions/${DEMO_SESSION_ID}/commands`,
      headers: mutationHeaders,
      payload: {
        bindingId: student.bindingId,
        name: "record_experience_choice",
        expectedStateVersion: 0,
        sourceMode: "world_interaction",
        payload: {},
      },
    });
    expect(blockedWorldAction.statusCode).toBe(409);
    expect(blockedWorldAction.json()).toMatchObject({
      code: "arm_policy_violation",
    });

    const withdrawal = await app.inject({
      method: "POST",
      url:
        `/api/sessions/${DEMO_SESSION_ID}/gold-pilot-readiness/plans/${plan.readinessId}/withdrawals`,
      headers: mutationHeaders,
      payload: {
        bindingId: teacher.bindingId,
        consent: {
          participantAlias: "student_01",
          participantKind: "student",
          sourceRecordHash: hashValue("student-withdrawal"),
        },
      },
    });
    expect(withdrawal.statusCode).toBe(200);
    expect(
      GoldPilotReadinessViewSchema.parse(withdrawal.json()).summary.status,
    ).toBe("frozen_with_withdrawals");

    const blockedAfterWithdrawal = await app.inject({
      method: "POST",
      url: `/api/sessions/${DEMO_SESSION_ID}/commands`,
      headers: mutationHeaders,
      payload: {
        bindingId: student.bindingId,
        name: "record_experience_choice",
        expectedStateVersion: 0,
        sourceMode: "course_platform",
        payload: {},
      },
    });
    expect(blockedAfterWithdrawal.statusCode).toBe(403);
    expect(blockedAfterWithdrawal.json()).toMatchObject({
      code: "consent_withdrawn",
    });

    const invalidFinalize = await app.inject({
      method: "POST",
      url:
        `/api/sessions/${DEMO_SESSION_ID}/gold-pilot-study/runs/finalize`,
      headers: mutationHeaders,
      payload: {
        bindingId: teacher.bindingId,
        finalization: {
          disposition: {
            outcome: "withdrawn",
            exitCategory: "participant_withdrawal",
          },
          idempotencyKey: "readiness-invalid-withdrawal",
        },
      },
    });
    expect(invalidFinalize.statusCode).toBe(403);
    expect(invalidFinalize.json()).toMatchObject({
      code: "consent_withdrawn",
    });

    const consentFinalize = await app.inject({
      method: "POST",
      url:
        `/api/sessions/${DEMO_SESSION_ID}/gold-pilot-study/runs/finalize`,
      headers: mutationHeaders,
      payload: {
        bindingId: teacher.bindingId,
        finalization: {
          disposition: {
            outcome: "withdrawn",
            exitCategory: "consent_revoked",
          },
          idempotencyKey: "readiness-consent-revoked",
        },
      },
    });
    expect(consentFinalize.statusCode).toBe(200);
  }, 15_000);

  it("replays semantic readiness frames and repairs an incomplete tail", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "ronggang-readiness-"));
    const path = join(dataDir, "gold-pilot-readiness.jsonl");
    try {
      const times = [
        "2026-07-30T13:00:00.000Z",
        "2026-07-30T13:01:00.000Z",
      ];
      const first = new GoldPilotReadinessCoordinator(
        new JsonlGoldPilotReadinessStore(path),
        { now: () => times.shift()! },
      );
      const created = await first.createPlan({
        anchorSessionId: DEMO_SESSION_ID,
        createdByActorId: "teacher-main",
        ...planInput(),
      });
      await first.submitRubricReview(
        created.readinessId,
        "expert_01",
        acceptedReview(),
      );
      await appendFile(path, "{\"schemaVersion\":", "utf8");

      const restarted = new GoldPilotReadinessCoordinator(
        new JsonlGoldPilotReadinessStore(path),
        { now: () => "2026-07-30T13:05:00.000Z" },
      );
      const workflow = await restarted.getWorkflowView(DEMO_SESSION_ID);
      expect(workflow.activePlan).toMatchObject({
        revision: 2,
        rubricReviews: [{
          reviewerAlias: "expert_01",
        }],
      });
      const repairedLog = await readFile(path, "utf8");
      expect(repairedLog.endsWith("\n")).toBe(true);
      expect(repairedLog.trim().split("\n")).toHaveLength(2);
      expect(repairedLog).not.toContain("teacher-consent");
      for (const line of repairedLog.trim().split("\n")) {
        expect(() => JSON.parse(line)).not.toThrow();
      }
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
