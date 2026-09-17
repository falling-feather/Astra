import { describe, expect, it } from "vitest";
import {
  ActionEnvelopeSchemaVersion,
  GoldPilotReadinessSchemaVersion,
  SchemaVersion,
  WorldEventSchema,
  type ActionSourceMode,
  type EventType,
  type GoldPilotParticipantAssignment,
  type GoldPilotReadinessFreezeReceipt,
  type GoldPilotTaskAllocation,
  type WorldEvent,
} from "@ronggang/contracts";
import { hashValue } from "@ronggang/context-engine";
import {
  createGoldPilotProtocol,
  GoldPilotStudyCoordinator,
  InMemoryGoldPilotStudyStore,
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

function event(input: {
  sessionId: string;
  index: number;
  eventType: EventType;
  actorId: string;
  rootActionId?: string;
  commandName?: "record_experience_choice" | "send_role_interaction";
  sourceMode?: ActionSourceMode;
  payload?: Record<string, unknown>;
}): WorldEvent {
  const timestamp = new Date(
    Date.UTC(2026, 6, 30, 9, 0, input.index),
  ).toISOString();
  return WorldEventSchema.parse({
    schemaVersion: SchemaVersion,
    kind: "WorldEvent",
    sessionId: input.sessionId,
    sceneId: "scenario-pilot",
    actorId: input.actorId,
    messageId: `message-${input.index}`,
    correlationId: `correlation-${input.index}`,
    timestamp,
    eventId: `event-${input.sessionId}-${input.index}`,
    eventType: input.eventType,
    stateVersion: input.index,
    visibility: ["audit_only"],
    visibleToActorIds: [],
    summary: `试点测试事件 ${input.index}`,
    payload: input.payload ?? {},
    actionContext: input.rootActionId
      ? {
          schemaVersion: ActionEnvelopeSchemaVersion,
          actionId: input.rootActionId,
          rootActionId: input.rootActionId,
          causationId: input.rootActionId,
          commandName: input.commandName ?? "record_experience_choice",
          sourceMode: input.sourceMode ?? "course_platform",
          sourceAssertion: "client_declared",
          payloadHash: "a".repeat(64),
          idempotencyHash: "b".repeat(64),
          actorBindingHash: "c".repeat(64),
          causalDepth: 0,
          objectRefCount: 1,
          evidenceRefCount: 0,
        }
      : null,
  });
}

function courseEvents(sourceMode: ActionSourceMode): WorldEvent[] {
  return [
    event({
      sessionId: "pilot-course-01",
      index: 1,
      eventType: "session_started",
      actorId: "system",
    }),
    event({
      sessionId: "pilot-course-01",
      index: 2,
      eventType: "experience_choice_recorded",
      actorId: "student-editor",
      rootActionId: "action-course-01",
      sourceMode,
    }),
    event({
      sessionId: "pilot-course-01",
      index: 3,
      eventType: "evidence_recorded",
      actorId: "system",
      rootActionId: "action-course-01",
      sourceMode,
      payload: {
        evidence: {
          evidenceId: "evidence-course-01",
        },
      },
    }),
    event({
      sessionId: "pilot-course-01",
      index: 4,
      eventType: "scene_completed",
      actorId: "system",
    }),
  ];
}

function taskAllocations(
  values: readonly GoldPilotParticipantAssignment[],
  taskSequences?: readonly ("task_a_then_b" | "task_b_then_a")[],
): GoldPilotTaskAllocation[] {
  return values.map((assignment, index) => {
    const taskSequence = taskSequences?.[index] ?? "task_a_then_b";
    const variants = taskSequence === "task_a_then_b"
      ? ["task_a", "task_b"] as const
      : ["task_b", "task_a"] as const;
    return {
      participantAlias: assignment.participantAlias,
      taskSequence,
      runs: [
        {
          period: 1,
          sessionId: assignment.runs[0].sessionId,
          taskVariantId: variants[0],
        },
        {
          period: 2,
          sessionId: assignment.runs[1].sessionId,
          taskVariantId: variants[1],
        },
      ],
    };
  });
}

function readinessReceipt(
  values: readonly GoldPilotParticipantAssignment[],
  allocations: readonly GoldPilotTaskAllocation[],
): GoldPilotReadinessFreezeReceipt {
  const sortedAssignments = [...values].sort((left, right) => (
    left.participantAlias.localeCompare(right.participantAlias)
  ));
  const sortedAllocations = [...allocations].sort((left, right) => (
    left.participantAlias.localeCompare(right.participantAlias)
  ));
  const unsigned = {
    schemaVersion: GoldPilotReadinessSchemaVersion,
    readinessId: `gpr_${"1".repeat(24)}`,
    protocolHash: createGoldPilotProtocol().protocolHash,
    rubricPackageHash: "2".repeat(64),
    equivalentTaskPairHash: "3".repeat(64),
    assignmentSnapshotHash: hashValue(sortedAssignments),
    taskAllocationSnapshotHash: hashValue(sortedAllocations),
    contentValiditySnapshotHash: "4".repeat(64),
    consentSnapshotHash: "5".repeat(64),
    frozenAt: "2026-07-30T07:59:00.000Z",
  };
  return {
    ...unsigned,
    receiptHash: hashValue(unsigned),
  };
}

function completedEvents(
  sessionId: string,
  actionCount = 0,
): WorldEvent[] {
  const events: WorldEvent[] = [event({
    sessionId,
    index: 1,
    eventType: "session_started",
    actorId: "system",
  })];
  for (let index = 0; index < actionCount; index += 1) {
    events.push(event({
      sessionId,
      index: index + 2,
      eventType: "experience_choice_recorded",
      actorId: "student-editor",
      rootActionId: `action-${sessionId}-${index}`,
      sourceMode: "course_platform",
    }));
  }
  events.push(event({
    sessionId,
    index: actionCount + 2,
    eventType: "scene_completed",
    actorId: "system",
  }));
  return events;
}

describe("GoldPilotStudyCoordinator", () => {
  it("enforces the preregistered arm and freezes only aggregate receipts", async () => {
    let clockIndex = 0;
    const coordinator = new GoldPilotStudyCoordinator(
      new InMemoryGoldPilotStudyStore(),
      {
        now: () => new Date(
          Date.UTC(2026, 6, 30, 8, clockIndex++, 0),
        ).toISOString(),
      },
    );
    const created = await coordinator.createStudy({
      anchorSessionId: "pilot-course-01",
      createdByActorId: "teacher-main",
      participantAssignments: assignments(),
    });
    expect(created.summary).toMatchObject({
      status: "insufficient",
      teacherCount: 1,
      studentCount: 1,
      expectedRunCount: 2,
      finalizedRunCount: 0,
    });
    expect(created.summary.missingTargets).toEqual(expect.arrayContaining([
      "还需 2 名去标识教师样本",
      "还需 19 名去标识学生样本",
      "还需 2 个冻结运行收据",
    ]));

    await expect(coordinator.assertSourceModeAllowed({
      sessionId: "pilot-course-01",
      actorKind: "student",
      roleId: "responsible_editor",
      sourceMode: "world_interaction",
    })).rejects.toMatchObject({ code: "arm_policy_violation" });
    await expect(coordinator.assertSourceModeAllowed({
      sessionId: "pilot-dual-01",
      actorKind: "student",
      roleId: "responsible_editor",
      sourceMode: "world_interaction",
    })).resolves.toBeUndefined();
    await expect(coordinator.assertSourceModeAllowed({
      sessionId: "pilot-dual-01",
      actorKind: "student",
      roleId: "reporter",
      sourceMode: "course_platform",
    })).rejects.toMatchObject({ code: "arm_policy_violation" });
    await expect(coordinator.assertSourceModeAllowed({
      sessionId: "pilot-course-01",
      actorKind: "teacher",
      roleId: "teacher",
      sourceMode: "world_interaction",
    })).resolves.toBeUndefined();

    const timing = await coordinator.startWorkloadPhase(
      "pilot-course-01",
      "configuration",
    );
    const activeSegment = timing.workloadSegments[0]!;
    expect(activeSegment).toMatchObject({
      phase: "configuration",
      finishedAt: null,
      receiptHash: null,
    });
    await expect(coordinator.startWorkloadPhase(
      "pilot-course-01",
      "intervention",
    )).rejects.toMatchObject({ code: "active_timer_conflict" });
    await expect(coordinator.startWorkloadPhase(
      "pilot-dual-01",
      "intervention",
    )).rejects.toMatchObject({ code: "active_timer_conflict" });
    const timed = await coordinator.finishWorkloadSegment(
      "pilot-course-01",
      activeSegment.segmentId,
    );
    expect(timed.workloadSegments[0]).toMatchObject({
      durationSeconds: 180,
    });
    expect(timed.workloadSegments[0]!.receiptHash).toMatch(/^[a-f0-9]{64}$/u);

    await expect(coordinator.finalizeRun({
      sessionId: "pilot-course-01",
      participantActorId: "student-editor",
      finalization: {
        disposition: {
          outcome: "completed",
          exitCategory: "completed",
        },
        idempotencyKey: "pilot-course-finalize-01",
      },
      events: courseEvents("world_interaction"),
    })).rejects.toMatchObject({ code: "arm_policy_violation" });

    const finalized = await coordinator.finalizeRun({
      sessionId: "pilot-course-01",
      participantActorId: "student-editor",
      finalization: {
        disposition: {
          outcome: "completed",
          exitCategory: "completed",
        },
        idempotencyKey: "pilot-course-finalize-01",
      },
      events: courseEvents("course_platform"),
    });
    expect(finalized.runReceipts).toHaveLength(1);
    expect(finalized.runReceipts[0]).toMatchObject({
      participantAlias: "student_01",
      arm: "course_platform_only",
      metrics: {
        validStudentActionCount: 1,
        coursePlatformActionCount: 1,
        worldInteractionActionCount: 0,
        evidenceRecordedCount: 1,
        distinctEvidenceRefCount: 1,
        taskCompletionCount: 1,
        sceneCompleted: true,
      },
    });
    expect(JSON.stringify(finalized.runReceipts[0])).not.toContain(
      "试点测试事件",
    );
    expect(finalized.summary.status).toBe("insufficient");

    const idempotent = await coordinator.finalizeRun({
      sessionId: "pilot-course-01",
      participantActorId: "student-editor",
      finalization: {
        disposition: {
          outcome: "completed",
          exitCategory: "completed",
        },
        idempotencyKey: "pilot-course-finalize-01",
      },
      events: courseEvents("course_platform"),
    });
    expect(idempotent.runReceipts).toHaveLength(1);

    const workflow = await coordinator.getWorkflowView("pilot-course-01");
    expect(workflow.currentRun).toMatchObject({
      participantAlias: "student_01",
      arm: "course_platform_only",
      finalized: true,
    });
    expect(workflow.protocol.targetMinimums).toEqual({
      teacherCount: 3,
      studentCount: 20,
      runsPerStudent: 2,
    });
  });

  it("requires a completion event but permits standardized withdrawal", async () => {
    const coordinator = new GoldPilotStudyCoordinator(
      new InMemoryGoldPilotStudyStore(),
      { now: () => "2026-07-30T10:00:00.000Z" },
    );
    await coordinator.createStudy({
      anchorSessionId: "pilot-course-01",
      createdByActorId: "teacher-main",
      participantAssignments: assignments(),
    });
    await expect(coordinator.finalizeRun({
      sessionId: "pilot-dual-01",
      participantActorId: "student-editor",
      finalization: {
        disposition: {
          outcome: "completed",
          exitCategory: "completed",
        },
        idempotencyKey: "pilot-dual-finalize-01",
      },
      events: [event({
        sessionId: "pilot-dual-01",
        index: 1,
        eventType: "session_started",
        actorId: "system",
      })],
    })).rejects.toMatchObject({ code: "invalid_run_snapshot" });

    const withdrawn = await coordinator.finalizeRun({
      sessionId: "pilot-dual-01",
      participantActorId: "student-editor",
      finalization: {
        disposition: {
          outcome: "withdrawn",
          exitCategory: "consent_revoked",
        },
        idempotencyKey: "pilot-dual-withdraw-01",
      },
      events: [event({
        sessionId: "pilot-dual-01",
        index: 1,
        eventType: "session_started",
        actorId: "system",
      })],
    });
    expect(withdrawn.runReceipts[0]!.disposition).toEqual({
      outcome: "withdrawn",
      exitCategory: "consent_revoked",
    });
    expect(withdrawn.summary.withdrawnRunCount).toBe(1);
  });

  it("freezes a source-bound report and excludes incomplete pairs", async () => {
    const values: GoldPilotParticipantAssignment[] = [
      assignments()[0]!,
      {
        participantAlias: "student_02",
        sequence: "dual_then_course",
        runs: [
          {
            period: 1,
            sessionId: "pilot-dual-02",
            arm: "full_dual_dimension",
            roleId: "responsible_editor",
            teacherAlias: "teacher_02",
          },
          {
            period: 2,
            sessionId: "pilot-course-02",
            arm: "course_platform_only",
            roleId: "responsible_editor",
            teacherAlias: "teacher_02",
          },
        ],
      },
    ];
    const allocations = taskAllocations(values, [
      "task_a_then_b",
      "task_b_then_a",
    ]);
    let minute = 0;
    const coordinator = new GoldPilotStudyCoordinator(
      new InMemoryGoldPilotStudyStore(),
      {
        now: () => new Date(
          Date.UTC(2026, 6, 30, 11, minute++, 0),
        ).toISOString(),
      },
    );
    const created = await coordinator.createStudy({
      anchorSessionId: "pilot-course-01",
      createdByActorId: "teacher-main",
      participantAssignments: values,
      taskAllocations: allocations,
      readinessFreezeReceipt: readinessReceipt(values, allocations),
    });
    expect(created.designBinding).toMatchObject({
      readinessId: `gpr_${"1".repeat(24)}`,
      analysisPlanHash: created.analysisPlan!.planHash,
    });
    expect(created.designBinding!.bindingHash).toMatch(/^[a-f0-9]{64}$/u);

    await expect(
      coordinator.freezeAnalysisReport("pilot-course-01"),
    ).rejects.toMatchObject({ code: "status_conflict" });

    for (const phase of [
      "configuration",
      "intervention",
      "final_review",
    ] as const) {
      const started = await coordinator.startWorkloadPhase(
        "pilot-course-01",
        phase,
      );
      const segment = started.workloadSegments.find(
        (candidate) => candidate.finishedAt === null,
      )!;
      await coordinator.finishWorkloadSegment(
        "pilot-course-01",
        segment.segmentId,
      );
    }
    await coordinator.finalizeRun({
      sessionId: "pilot-course-01",
      participantActorId: "student-editor",
      finalization: {
        disposition: {
          outcome: "completed",
          exitCategory: "completed",
        },
        idempotencyKey: "analysis-course-01",
      },
      events: completedEvents("pilot-course-01", 1),
    });
    await coordinator.finalizeRun({
      sessionId: "pilot-dual-01",
      participantActorId: "student-editor",
      finalization: {
        disposition: {
          outcome: "completed",
          exitCategory: "completed",
        },
        idempotencyKey: "analysis-dual-01",
      },
      events: completedEvents("pilot-dual-01", 3),
    });
    await coordinator.finalizeRun({
      sessionId: "pilot-dual-02",
      participantActorId: "student-editor",
      finalization: {
        disposition: {
          outcome: "technical_failure",
          exitCategory: "timeout",
        },
        idempotencyKey: "analysis-dual-02",
      },
      events: completedEvents("pilot-dual-02"),
    });
    await coordinator.finalizeRun({
      sessionId: "pilot-course-02",
      participantActorId: "student-editor",
      finalization: {
        disposition: {
          outcome: "withdrawn",
          exitCategory: "participant_withdrawal",
        },
        idempotencyKey: "analysis-course-02",
      },
      events: completedEvents("pilot-course-02"),
    });

    const frozen = await coordinator.freezeAnalysisReport(
      "pilot-course-01",
    );
    const report = frozen.analysisReport!;
    expect(report.status).toBe("exploratory");
    expect(report.participantFlow).toMatchObject({
      registeredParticipantCount: 2,
      expectedRunCount: 4,
      finalizedRunCount: 4,
      completePairCount: 1,
      incompletePairCount: 1,
      analysisIncludedRunCount: 2,
      withdrawnRunCount: 1,
      technicalFailureRunCount: 1,
    });
    expect(
      report.pairedMetrics.find(
        (metric) => metric.metricId === "valid_student_action_count",
      ),
    ).toMatchObject({
      completePairCount: 1,
      coursePlatformMean: 1,
      fullDualMean: 3,
      meanDifference: 2,
      medianDifference: 2,
    });
    expect(report.workloadSummaries.every(
      (summary) => summary.closedSegmentCount === 1,
    )).toBe(true);
    expect(JSON.stringify(report)).not.toContain("student_01");
    expect(JSON.stringify(report)).not.toContain("pilot-course-01");
    expect(report.reportHash).toMatch(/^[a-f0-9]{64}$/u);

    const idempotent = await coordinator.freezeAnalysisReport(
      "pilot-course-01",
    );
    expect(idempotent.revision).toBe(frozen.revision);
    expect(idempotent.analysisReport?.reportHash).toBe(report.reportHash);
  });

  it("marks only twenty complete pairs across three teachers target-ready", async () => {
    const values: GoldPilotParticipantAssignment[] = Array.from(
      { length: 20 },
      (_, index) => {
        const student = String(index + 1).padStart(2, "0");
        const conditionSequence = index % 4 < 2
          ? "course_then_dual" as const
          : "dual_then_course" as const;
        const firstArm = conditionSequence === "course_then_dual"
          ? "course_platform_only" as const
          : "full_dual_dimension" as const;
        const secondArm = firstArm === "course_platform_only"
          ? "full_dual_dimension" as const
          : "course_platform_only" as const;
        return {
          participantAlias: `student_${student}`,
          sequence: conditionSequence,
          runs: [
            {
              period: 1 as const,
              sessionId: `pilot-${student}-p1`,
              arm: firstArm,
              roleId: "responsible_editor" as const,
              teacherAlias: `teacher_${(index % 3) + 1}`,
            },
            {
              period: 2 as const,
              sessionId: `pilot-${student}-p2`,
              arm: secondArm,
              roleId: "responsible_editor" as const,
              teacherAlias: `teacher_${(index % 3) + 1}`,
            },
          ] as const,
        };
      },
    );
    const allocations = taskAllocations(
      values,
      values.map((_, index) => (
        index % 2 === 0 ? "task_a_then_b" : "task_b_then_a"
      )),
    );
    let minute = 0;
    const coordinator = new GoldPilotStudyCoordinator(
      new InMemoryGoldPilotStudyStore(),
      {
        now: () => new Date(
          Date.UTC(2026, 6, 30, 14, minute++, 0),
        ).toISOString(),
      },
    );
    await coordinator.createStudy({
      anchorSessionId: values[0]!.runs[0].sessionId,
      createdByActorId: "teacher-main",
      participantAssignments: values,
      taskAllocations: allocations,
      readinessFreezeReceipt: readinessReceipt(values, allocations),
    });
    for (const phase of [
      "configuration",
      "intervention",
      "final_review",
    ] as const) {
      const started = await coordinator.startWorkloadPhase(
        values[0]!.runs[0].sessionId,
        phase,
      );
      await coordinator.finishWorkloadSegment(
        values[0]!.runs[0].sessionId,
        started.workloadSegments.find(
          (segment) => segment.finishedAt === null,
        )!.segmentId,
      );
    }
    for (const assignment of values) {
      for (const run of assignment.runs) {
        await coordinator.finalizeRun({
          sessionId: run.sessionId,
          participantActorId: "student-editor",
          finalization: {
            disposition: {
              outcome: "completed",
              exitCategory: "completed",
            },
            idempotencyKey: `analysis-${run.sessionId}`,
          },
          events: completedEvents(run.sessionId),
        });
      }
    }
    const frozen = await coordinator.freezeAnalysisReport(
      values[0]!.runs[0].sessionId,
    );
    expect(frozen.analysisReport).toMatchObject({
      status: "target_ready_for_descriptive_comparison",
      missingTargets: [],
      participantFlow: {
        registeredTeacherCount: 3,
        completePairCount: 20,
        incompletePairCount: 0,
      },
      designDiagnostics: {
        maximumRegistrationCellImbalance: 0,
        balancedAtRegistration: true,
      },
    });
  });
});
