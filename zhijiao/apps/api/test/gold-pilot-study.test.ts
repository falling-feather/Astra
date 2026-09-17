import { afterEach, describe, expect, it } from "vitest";
import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GoldPilotReadinessSchemaVersion,
  GoldPilotStudyViewSchema,
  GoldPilotWorkflowViewSchema,
  type GoldPilotParticipantAssignment,
  type GoldPilotReadinessFreezeReceipt,
  type GoldPilotTaskAllocation,
  type RoleBinding,
} from "@ronggang/contracts";
import { hashValue } from "@ronggang/context-engine";
import {
  createGoldPilotProtocol,
  GoldPilotStudyCoordinator,
  InMemoryGoldPilotStudyStore,
} from "@ronggang/agent-runtime";
import type { FastifyInstance } from "fastify";
import {
  InMemoryEventStore,
  InProcessMessageBus,
  WorldEngine,
  demoScenario,
} from "@ronggang/world-core";
import type { DemoAuthContext } from "../src/identity.js";
import { JsonlGoldPilotStudyStore } from "../src/jsonl-gold-pilot-study-store.js";
import {
  createMemoryTestApp,
  DEMO_SESSION_ID,
} from "../src/server.js";

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
  secondSessionId = "pilot-second-period",
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

function analysisTaskAllocations(
  values: readonly GoldPilotParticipantAssignment[],
): GoldPilotTaskAllocation[] {
  return values.map((assignment) => ({
    participantAlias: assignment.participantAlias,
    taskSequence: "task_a_then_b",
    runs: [
      {
        period: 1,
        sessionId: assignment.runs[0].sessionId,
        taskVariantId: "task_a",
      },
      {
        period: 2,
        sessionId: assignment.runs[1].sessionId,
        taskVariantId: "task_b",
      },
    ],
  }));
}

function analysisReadinessReceipt(
  values: readonly GoldPilotParticipantAssignment[],
  taskAllocations: readonly GoldPilotTaskAllocation[],
): GoldPilotReadinessFreezeReceipt {
  const unsigned = {
    schemaVersion: GoldPilotReadinessSchemaVersion,
    readinessId: `gpr_${"6".repeat(24)}`,
    protocolHash: createGoldPilotProtocol().protocolHash,
    rubricPackageHash: "7".repeat(64),
    equivalentTaskPairHash: "8".repeat(64),
    assignmentSnapshotHash: hashValue(values),
    taskAllocationSnapshotHash: hashValue(taskAllocations),
    contentValiditySnapshotHash: "9".repeat(64),
    consentSnapshotHash: "a".repeat(64),
    frozenAt: "2026-07-30T07:59:00.000Z",
  };
  return {
    ...unsigned,
    receiptHash: hashValue(unsigned),
  };
}

describe("gold pilot study API", () => {
  it("enforces the course-only arm and exposes teacher-only workload receipts", async () => {
    const pilotStore = new InMemoryGoldPilotStudyStore();
    await new GoldPilotStudyCoordinator(pilotStore, {
      now: () => "2026-07-30T08:00:00.000Z",
    }).createStudy({
      anchorSessionId: DEMO_SESSION_ID,
      createdByActorId: "teacher-main",
      participantAssignments: assignments(),
    });
    app = await createMemoryTestApp({
      engine: new WorldEngine({
        store: new InMemoryEventStore(),
        bus: new InProcessMessageBus(),
        scenario: structuredClone(demoScenario),
      }),
      goldPilotStudyStore: pilotStore,
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

    const viewResponse = await app.inject({
      method: "GET",
      url:
        `/api/sessions/${DEMO_SESSION_ID}/gold-pilot-study?bindingId=${teacher.bindingId}`,
      headers: { cookie },
    });
    expect(viewResponse.statusCode).toBe(200);
    const view = GoldPilotWorkflowViewSchema.parse(viewResponse.json());
    expect(view.currentRun).toMatchObject({
      arm: "course_platform_only",
      roleId: "responsible_editor",
      finalized: false,
    });

    const studentDenied = await app.inject({
      method: "GET",
      url:
        `/api/sessions/${DEMO_SESSION_ID}/gold-pilot-study?bindingId=${student.bindingId}`,
      headers: { cookie },
    });
    expect(studentDenied.statusCode).toBe(403);

    const blockedWorldAction = await app.inject({
      method: "POST",
      url: `/api/sessions/${DEMO_SESSION_ID}/commands`,
      headers: {
        cookie,
        origin: localOrigin,
        "x-csrf-token": auth.csrfToken,
      },
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

    const start = await app.inject({
      method: "POST",
      url:
        `/api/sessions/${DEMO_SESSION_ID}/gold-pilot-study/workload/start`,
      headers: {
        cookie,
        origin: localOrigin,
        "x-csrf-token": auth.csrfToken,
      },
      payload: {
        bindingId: teacher.bindingId,
        phase: "configuration",
      },
    });
    expect(start.statusCode).toBe(200);
    const started = GoldPilotStudyViewSchema.parse(start.json());
    const segment = started.workloadSegments[0]!;
    expect(segment.finishedAt).toBeNull();

    const duplicateStart = await app.inject({
      method: "POST",
      url:
        `/api/sessions/${DEMO_SESSION_ID}/gold-pilot-study/workload/start`,
      headers: {
        cookie,
        origin: localOrigin,
        "x-csrf-token": auth.csrfToken,
      },
      payload: {
        bindingId: teacher.bindingId,
        phase: "intervention",
      },
    });
    expect(duplicateStart.statusCode).toBe(409);
    expect(duplicateStart.json()).toMatchObject({
      code: "active_timer_conflict",
    });

    const finish = await app.inject({
      method: "POST",
      url:
        `/api/sessions/${DEMO_SESSION_ID}/gold-pilot-study/workload/${segment.segmentId}/finish`,
      headers: {
        cookie,
        origin: localOrigin,
        "x-csrf-token": auth.csrfToken,
      },
      payload: { bindingId: teacher.bindingId },
    });
    expect(finish.statusCode).toBe(200);
    expect(finish.json()).toMatchObject({
      workloadSegments: [{
        segmentId: segment.segmentId,
        phase: "configuration",
      }],
    });
    expect(
      GoldPilotStudyViewSchema.parse(finish.json())
        .workloadSegments[0]!.receiptHash,
    ).toMatch(/^[a-f0-9]{64}$/u);

    const finalizePayload = {
      bindingId: teacher.bindingId,
      finalization: {
        disposition: {
          outcome: "withdrawn",
          exitCategory: "participant_withdrawal",
        },
        idempotencyKey: "api-pilot-withdraw-01",
      },
    };
    const finalize = await app.inject({
      method: "POST",
      url:
        `/api/sessions/${DEMO_SESSION_ID}/gold-pilot-study/runs/finalize`,
      headers: {
        cookie,
        origin: localOrigin,
        "x-csrf-token": auth.csrfToken,
      },
      payload: finalizePayload,
    });
    expect(finalize.statusCode).toBe(200);
    const finalized = GoldPilotStudyViewSchema.parse(finalize.json());
    expect(finalized.runReceipts).toHaveLength(1);
    expect(finalized.runReceipts[0]).toMatchObject({
      participantAlias: "student_01",
      disposition: {
        outcome: "withdrawn",
        exitCategory: "participant_withdrawal",
      },
    });
    expect(JSON.stringify(finalized.runReceipts[0])).not.toContain(
      "session_started",
    );

    const idempotent = await app.inject({
      method: "POST",
      url:
        `/api/sessions/${DEMO_SESSION_ID}/gold-pilot-study/runs/finalize`,
      headers: {
        cookie,
        origin: localOrigin,
        "x-csrf-token": auth.csrfToken,
      },
      payload: finalizePayload,
    });
    expect(idempotent.statusCode).toBe(200);
    expect(GoldPilotStudyViewSchema.parse(idempotent.json()).runReceipts)
      .toHaveLength(1);

    const invisibleSession = await app.inject({
      method: "POST",
      url:
        `/api/sessions/${DEMO_SESSION_ID}/gold-pilot-study/studies`,
      headers: {
        cookie,
        origin: localOrigin,
        "x-csrf-token": auth.csrfToken,
      },
      payload: {
        bindingId: teacher.bindingId,
        readinessId: `gpr_${"a".repeat(24)}`,
        freezeReceiptHash: "b".repeat(64),
        participantAssignments: assignments("not-visible-session"),
      },
    });
    expect(invisibleSession.statusCode).toBe(403);
  });

  it("replays workload and analysis frames and repairs an incomplete tail", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "ronggang-pilot-study-"));
    const path = join(dataDir, "gold-pilot-study.jsonl");
    try {
      const times = [
        "2026-07-30T09:00:00.000Z",
        "2026-07-30T09:01:00.000Z",
        "2026-07-30T09:03:00.000Z",
        "2026-07-30T09:04:00.000Z",
        "2026-07-30T09:05:00.000Z",
        "2026-07-30T09:06:00.000Z",
      ];
      const values = assignments();
      const taskAllocations = analysisTaskAllocations(values);
      const first = new GoldPilotStudyCoordinator(
        new JsonlGoldPilotStudyStore(path),
        { now: () => times.shift()! },
      );
      await first.createStudy({
        anchorSessionId: DEMO_SESSION_ID,
        createdByActorId: "teacher-main",
        participantAssignments: values,
        taskAllocations,
        readinessFreezeReceipt: analysisReadinessReceipt(
          values,
          taskAllocations,
        ),
      });
      const started = await first.startWorkloadPhase(
        DEMO_SESSION_ID,
        "configuration",
      );
      await first.finishWorkloadSegment(
        DEMO_SESSION_ID,
        started.workloadSegments[0]!.segmentId,
      );
      await first.finalizeRun({
        sessionId: DEMO_SESSION_ID,
        participantActorId: "student-editor",
        finalization: {
          disposition: {
            outcome: "withdrawn",
            exitCategory: "participant_withdrawal",
          },
          idempotencyKey: "jsonl-analysis-withdraw-one",
        },
        events: [],
      });
      await first.finalizeRun({
        sessionId: "pilot-second-period",
        participantActorId: "student-editor",
        finalization: {
          disposition: {
            outcome: "technical_failure",
            exitCategory: "timeout",
          },
          idempotencyKey: "jsonl-analysis-failure-two",
        },
        events: [],
      });
      await first.freezeAnalysisReport(DEMO_SESSION_ID);
      await appendFile(path, "{\"schemaVersion\":", "utf8");

      const restarted = new GoldPilotStudyCoordinator(
        new JsonlGoldPilotStudyStore(path),
        { now: () => "2026-07-30T09:05:00.000Z" },
      );
      const workflow = await restarted.getWorkflowView(DEMO_SESSION_ID);
      expect(workflow.activeStudy).toMatchObject({
        revision: 6,
        workloadSegments: [{
          phase: "configuration",
          durationSeconds: 120,
        }],
        analysisReport: {
          status: "exploratory",
          participantFlow: {
            completePairCount: 0,
            incompletePairCount: 1,
          },
        },
      });
      const repairedLog = await readFile(path, "utf8");
      expect(repairedLog.endsWith("\n")).toBe(true);
      expect(repairedLog.trim().split("\n")).toHaveLength(6);
      for (const line of repairedLog.trim().split("\n")) {
        expect(() => JSON.parse(line)).not.toThrow();
      }
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("freezes an analysis report through a teacher-only endpoint", async () => {
    const pilotStore = new InMemoryGoldPilotStudyStore();
    const values = assignments();
    const taskAllocations = analysisTaskAllocations(values);
    const coordinator = new GoldPilotStudyCoordinator(pilotStore, {
      now: () => "2026-07-30T12:00:00.000Z",
    });
    await coordinator.createStudy({
      anchorSessionId: DEMO_SESSION_ID,
      createdByActorId: "teacher-main",
      participantAssignments: values,
      taskAllocations,
      readinessFreezeReceipt: analysisReadinessReceipt(
        values,
        taskAllocations,
      ),
    });
    await coordinator.finalizeRun({
      sessionId: DEMO_SESSION_ID,
      participantActorId: "student-editor",
      finalization: {
        disposition: {
          outcome: "withdrawn",
          exitCategory: "participant_withdrawal",
        },
        idempotencyKey: "api-analysis-withdraw-one",
      },
      events: [],
    });
    await coordinator.finalizeRun({
      sessionId: "pilot-second-period",
      participantActorId: "student-editor",
      finalization: {
        disposition: {
          outcome: "technical_failure",
          exitCategory: "timeout",
        },
        idempotencyKey: "api-analysis-failure-two",
      },
      events: [],
    });
    app = await createMemoryTestApp({
      engine: new WorldEngine({
        store: new InMemoryEventStore(),
        bus: new InProcessMessageBus(),
        scenario: structuredClone(demoScenario),
      }),
      goldPilotStudyStore: pilotStore,
    });
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/demo-session",
      headers: { origin: localOrigin },
      payload: {},
    });
    const auth = login.json() as DemoAuthContext;
    const setCookie = Array.isArray(login.headers["set-cookie"])
      ? login.headers["set-cookie"][0]
      : login.headers["set-cookie"];
    if (!setCookie) throw new Error("测试登录没有 Cookie");
    const cookie = setCookie.split(";")[0]!;
    const teacher = binding(auth.bindings, "teacher");
    const student = binding(auth.bindings, "student");
    const headers = {
      cookie,
      origin: localOrigin,
      "x-csrf-token": auth.csrfToken,
    };

    const denied = await app.inject({
      method: "POST",
      url:
        `/api/sessions/${DEMO_SESSION_ID}/gold-pilot-study/analysis/freeze`,
      headers,
      payload: { bindingId: student.bindingId },
    });
    expect(denied.statusCode).toBe(403);

    const freeze = await app.inject({
      method: "POST",
      url:
        `/api/sessions/${DEMO_SESSION_ID}/gold-pilot-study/analysis/freeze`,
      headers,
      payload: { bindingId: teacher.bindingId },
    });
    expect(freeze.statusCode).toBe(200);
    const frozen = GoldPilotStudyViewSchema.parse(freeze.json());
    expect(frozen.analysisReport).toMatchObject({
      status: "exploratory",
      participantFlow: {
        completePairCount: 0,
        incompletePairCount: 1,
        withdrawnRunCount: 1,
        technicalFailureRunCount: 1,
      },
    });
    expect(frozen.summary.status).toBe("analysis_frozen");

    const idempotent = await app.inject({
      method: "POST",
      url:
        `/api/sessions/${DEMO_SESSION_ID}/gold-pilot-study/analysis/freeze`,
      headers,
      payload: { bindingId: teacher.bindingId },
    });
    expect(idempotent.statusCode).toBe(200);
    expect(
      GoldPilotStudyViewSchema.parse(idempotent.json()).revision,
    ).toBe(frozen.revision);
  });
});
