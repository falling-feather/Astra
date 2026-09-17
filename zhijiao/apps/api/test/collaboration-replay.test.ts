import { describe, expect, it } from "vitest";
import {
  AgentAssistanceProposalSchema,
  AgentContributionProfilesByTemplateId,
  FlagshipCollaborationEvidenceWritebackRef,
  FlagshipCollaborationTeacherApprovedRef,
  FlagshipCollaborationWorldWritebackRef,
  flagshipCollaborationStudentDecisionRef,
  type SessionTraceProjection,
  type StateProjection,
  type TraceRecord,
  type WorldEvent,
} from "@ronggang/contracts";
import {
  buildCollaborationReplay,
  FlagshipCollaborationEventId,
  FlagshipCollaborationRouteId,
  FlagshipCollaborationTaskId,
} from "../src/collaboration-replay.js";

const sessionId = "session-collaboration";
const scenarioId = "scenario-local-tourism-media-v0.1";
const now = "2026-07-31T00:00:00.000Z";
const candidateId = "candidate-rain";
const proposalId = "proposal-evidence-rain";

function event(input: {
  eventId: string;
  eventType: string;
  stateVersion: number;
  actorId: string;
  summary: string;
  payload?: Record<string, unknown>;
}): WorldEvent {
  return {
    kind: "WorldEvent",
    eventId: input.eventId,
    eventType: input.eventType,
    stateVersion: input.stateVersion,
    visibility: ["assigned_team"],
    visibleToActorIds: [],
    summary: input.summary,
    payload: input.payload ?? {},
    sessionId,
    sceneId: scenarioId,
    actorId: input.actorId,
    messageId: `message-${input.eventId}`,
    correlationId: `correlation-${input.eventId}`,
    timestamp: new Date(
      Date.parse(now) + input.stateVersion * 1_000,
    ).toISOString(),
    schemaVersion: "0.1.0",
    actionContext: null,
  } as WorldEvent;
}

function record(input: {
  traceId: string;
  kind: TraceRecord["kind"];
  status?: TraceRecord["status"];
  sourceId?: string;
  eventId?: string | null;
  taskId?: string | null;
  agentRunId?: string | null;
  agentId?: string | null;
  actorId?: string | null;
  stateVersion?: number | null;
}): TraceRecord {
  const agentId = input.agentId ?? null;
  return {
    traceId: input.traceId,
    kind: input.kind,
    lane: input.kind === "world_event" || input.kind === "agent_assistance"
      ? "world"
      : "execution",
    sourceId: input.sourceId ?? input.traceId,
    timestamp: now,
    completedAt: now,
    status: input.status ?? "completed",
    title: input.kind,
    summary: `${input.kind} 安全摘要`,
    correlationId: "correlation-rain",
    stateVersion: input.stateVersion ?? 20,
    actorId: input.actorId ?? agentId,
    roleId: agentId ? "student_assistant" : null,
    agentId,
    eventType: null,
    eventId: input.eventId ?? null,
    outboxId: null,
    taskId: input.taskId ?? null,
    agentRunId: input.agentRunId ?? null,
    nodeId: null,
    invocationId: null,
    toolTaskId: null,
    stepId: null,
    errorCode: input.status === "failed" ? "model_timeout" : null,
    durationMs: null,
    tokenTotal: null,
    attempts: null,
    provider: null,
    providerMode: null,
    model: null,
    details: agentId
      ? [
          {
            label: "模板",
            value: "assistant/evidence-coach@agent-assistance/1.0.0",
            valueKind: "code",
          },
          {
            label: "实例",
            value: "instance-evidence-coach@agent-assistance/1.0.0",
            valueKind: "code",
          },
        ]
      : [],
  };
}

function projection(sourceEventId: string | null): StateProjection {
  return {
    sessionId,
    stateVersion: 28,
    scenario: { scenarioId },
    currentTaskAnchor: {
      taskId: FlagshipCollaborationTaskId,
      phase: sourceEventId ? "completed" : "not_triggered",
      stateVersion: 28,
      sourceEventId,
      priority: sourceEventId ? "urgent" : "normal",
      worldTarget: {
        mode: "world_interaction",
        sceneId: "scene-rain-transition",
        taskId: FlagshipCollaborationTaskId,
      },
      latestFeedbackReason: sourceEventId
        ? "暴雨后任务优先级已改写"
        : "当前节点任务已开放",
    },
  } as unknown as StateProjection;
}

function trace(
  records: TraceRecord[],
  links?: SessionTraceProjection["links"],
): SessionTraceProjection {
  const resolvedLinks = links ?? [
    ...(records.some((record) => record.traceId === "run:evidence")
      && records.some((record) => record.traceId === "event:event-assistance")
      ? [{
          linkId: "link-assistance-run",
          fromTraceId: "run:evidence",
          toTraceId: "event:event-assistance",
          relation: "produces" as const,
        }]
      : []),
    ...(records.some((record) => record.traceId === "task:evidence")
      && records.some((record) => record.traceId === "run:evidence")
      ? [{
          linkId: "link-run-task",
          fromTraceId: "task:evidence",
          toTraceId: "run:evidence",
          relation: "executes" as const,
        }]
      : []),
  ];
  return {
    sessionId,
    generatedAt: now,
    stateVersion: 28,
    records,
    links: resolvedLinks,
    summary: {
      worldRecordCount: 0,
      executionRecordCount: records.length,
      eventCount: 0,
      outboxCount: 0,
      taskCount: 0,
      runCount: 0,
      modelInvocationCount: 0,
      toolStepCount: 0,
      failedCount: 0,
      degradedCount: 0,
      pendingCount: 0,
      totalTokens: 0,
    },
  };
}

function successfulFixture() {
  const contributionProfile = AgentContributionProfilesByTemplateId.get(
    "assistant/evidence-coach",
  );
  if (!contributionProfile) {
    throw new Error("测试缺少 evidence-coach 冻结贡献配置");
  }
  const applied = event({
    eventId: "event-rain-applied",
    eventType: "scenario_intervention_applied",
    stateVersion: 20,
    actorId: "system",
    summary: "暴雨突发下的双岗应变已生效",
    payload: {
      privatePrompt: "PRIVATE_INTERVENTION_PAYLOAD",
      intervention: {
        interventionId: "intervention-rain",
        routeId: FlagshipCollaborationRouteId,
        kind: "challenge",
        title: "暴雨突发下的双岗应变",
        studentBrief: "现场展演暂停并开始疏散。",
        competencyTarget: "C-COLLAB-03",
        difficulty: "challenging",
        expectedImpact: "任务重排并提升平台风险。",
        affectedRoleIds: ["responsible_editor", "reporter"],
        riskLevel: "high",
        sourceCandidateId: candidateId,
        recoveryOfCandidateId: null,
        approvedBy: "teacher-main",
        appliedAt: "2026-07-31T00:00:20.000Z",
      },
    },
  });
  const proposal = AgentAssistanceProposalSchema.parse({
    kind: "AgentAssistanceProposal",
    assistanceSchemaVersion: "agent-assistance/1.0.0",
    proposalId,
    agentRunId: "run-evidence",
    roleId: "student_assistant",
    templateRef: {
      templateId: "assistant/evidence-coach",
      templateVersion: contributionProfile.templateVersion,
    },
    instanceRef: {
      instanceId: "instance-evidence-coach",
      instanceVersion: contributionProfile.instanceVersion,
    },
    outputSchemaRef: "agent-assistance/evidence-coaching/1.0.0",
    output: {
      kind: "evidence_coaching",
      summary: "先核对气象来源和现场疏散回执，再调整发布时限。",
      questions: ["气象预警来自哪个固定来源？"],
      evidenceGaps: ["缺少现场疏散回执"],
      verificationPath: ["核对材料版本与平台回执"],
    },
    subjectActorId: "student-editor",
    resourceRef: null,
    expectedStateVersion: 21,
    causationEventIds: [applied.eventId],
    evidenceRefs: ["evidence-rain"],
    citationRefs: ["material-rain-alert"],
    authority: "advisory_only",
    requiresHumanAction: true,
    visibility: ["assigned_team"],
    visibleToActorIds: ["student-editor"],
    idempotencyKey: "decision-rain",
    expiresAt: null,
    sessionId,
    sceneId: scenarioId,
    actorId: "agent-evidence-coach",
    messageId: "message-assistance",
    correlationId: "correlation-assistance",
    timestamp: "2026-07-31T00:00:21.000Z",
    schemaVersion: "0.1.0",
  });
  const assistance = event({
    eventId: "event-assistance",
    eventType: "agent_assistance_recorded",
    stateVersion: 21,
    actorId: "agent-evidence-coach",
    summary: "证据教练形成关键节点贡献",
    payload: {
      proposal,
      privateMemory: "PRIVATE_ASSISTANCE_MEMORY",
    },
  });
  const decision = event({
    eventId: "event-student-decision",
    eventType: "agent_contribution_decided",
    stateVersion: 22,
    actorId: "student-editor",
    summary: "学生采纳证据教练建议",
    payload: {
      proposalId,
      decision: {
        templateRef: proposal.templateRef,
        instanceRef: proposal.instanceRef,
        rolePerspective: contributionProfile.rolePerspective,
        basisRefs: [{ kind: "evidence", refId: "evidence-rain" }],
        permissionSummary: contributionProfile.permissionSummary,
        decision: "accepted",
        studentReason: "建议能补齐现场来源核验。",
        idempotencyKey: "decision-rain",
      },
    },
  });
  const review = event({
    eventId: "event-teacher-review",
    eventType: "candidate_event_approved",
    stateVersion: 23,
    actorId: "teacher-main",
    summary: "教师批准暴雨候选",
    payload: { candidateId },
  });
  const evidence = event({
    eventId: "event-evidence",
    eventType: "evidence_recorded",
    stateVersion: 24,
    actorId: "student-editor",
    summary: "暴雨应变证据已记录",
    payload: {
      evidence: {
        evidenceId: "evidence-rain",
        sessionId,
        nodeId: "production",
        actorId: "student-editor",
        action: "完成暴雨后的双岗任务重排",
        basis: "气象材料、现场回执和修订记录可回指。",
        materialRefs: [],
        eventRefs: [applied.eventId],
        observationRefs: [],
        artifactRevisionRefs: [],
        processingTaskRefs: [],
        createdAt: "2026-07-31T00:00:24.000Z",
        visibility: ["assigned_team"],
      },
    },
  });
  const records = [
    record({
      traceId: "plan:rain",
      kind: "dispatch_plan",
      eventId: applied.eventId,
    }),
    record({
      traceId: "decision:evidence",
      kind: "dispatch_decision",
      eventId: applied.eventId,
      agentId: "agent-evidence-coach",
    }),
    record({
      traceId: "task:evidence",
      kind: "agent_task",
      eventId: applied.eventId,
      taskId: "task-evidence",
      agentId: "agent-evidence-coach",
    }),
    record({
      traceId: "run:evidence",
      kind: "agent_run",
      sourceId: "run-evidence",
      eventId: applied.eventId,
      taskId: "task-evidence",
      agentRunId: "run-evidence",
      agentId: "agent-evidence-coach",
    }),
    record({
      traceId: "event:event-assistance",
      kind: "agent_assistance",
      sourceId: assistance.eventId,
      eventId: assistance.eventId,
      taskId: "task-evidence",
      actorId: "agent-evidence-coach",
      stateVersion: 21,
    }),
  ];
  const links: SessionTraceProjection["links"] = [
    {
      linkId: "link-assistance-run",
      fromTraceId: "run:evidence",
      toTraceId: "event:event-assistance",
      relation: "produces",
    },
    {
      linkId: "link-run-task",
      fromTraceId: "task:evidence",
      toTraceId: "run:evidence",
      relation: "executes",
    },
  ];
  return {
    applied,
    events: [applied, assistance, decision, review, evidence],
    records,
    links,
  };
}

describe("flagship collaboration replay", () => {
  it("returns an explicit not-triggered chain without inventing missing nodes", () => {
    const replay = buildCollaborationReplay({
      projection: projection(null),
      events: [],
      trace: trace([]),
      generatedAt: now,
    });

    expect(replay.status).toBe("not_triggered");
    expect(replay.stages.map((stage) => stage.status)).toEqual([
      "missing",
      "not_applicable",
      "not_applicable",
      "not_applicable",
      "not_applicable",
      "not_applicable",
      "not_applicable",
      "not_applicable",
    ]);
    expect(replay.representativeEventId).toBe(
      FlagshipCollaborationEventId,
    );
  });

  it("aggregates success in fixed causal order and excludes private payloads", () => {
    const fixture = successfulFixture();
    const replay = buildCollaborationReplay({
      projection: projection(fixture.applied.eventId),
      events: fixture.events,
      trace: trace(fixture.records),
      generatedAt: now,
    });

    expect(replay.status).toBe("completed");
    expect(replay.stages.map((stage) => stage.phase)).toEqual([
      "event_trigger",
      "candidate_screening",
      "agent_wakeup",
      "permission_check",
      "agent_contribution",
      "student_decision",
      "teacher_review",
      "world_writeback",
    ]);
    expect(replay.stages[4]).toMatchObject({
      status: "completed",
      evidenceIds: ["evidence-rain"],
      agentRefs: [{
        agentId: "agent-evidence-coach",
        templateId: "assistant/evidence-coach",
        instanceId: "instance-evidence-coach",
      }],
    });
    expect(replay.stages[0]?.eventIds).toEqual(expect.arrayContaining([
      FlagshipCollaborationEventId,
      fixture.applied.eventId,
    ]));
    expect(replay.stages[5]).toMatchObject({
      status: "completed",
      actorIds: ["student-editor"],
    });
    expect(replay.stages[5]?.eventIds).toEqual(expect.arrayContaining([
      "event-student-decision",
      flagshipCollaborationStudentDecisionRef(
        "agent-evidence-coach",
        "accepted",
      ),
    ]));
    expect(replay.stages[6]?.eventIds).toContain(
      FlagshipCollaborationTeacherApprovedRef,
    );
    expect(replay.stages[7]).toMatchObject({
      status: "completed",
      taskIds: [FlagshipCollaborationTaskId],
    });
    expect(replay.stages[7]?.eventIds).toContain(
      FlagshipCollaborationWorldWritebackRef,
    );
    expect(replay.stages[7]?.evidenceIds).toEqual(expect.arrayContaining([
      "evidence-rain",
      FlagshipCollaborationEvidenceWritebackRef,
    ]));
    expect(replay.technicalTraceRefs).toEqual(expect.arrayContaining([
      "decision:evidence",
      "task:evidence",
      "run:evidence",
      "event:event-assistance",
    ]));
    expect(fixture.records.find(
      (record) => record.traceId === "event:event-assistance",
    )).toMatchObject({
      actorId: "agent-evidence-coach",
      agentId: null,
    });
    const serialized = JSON.stringify(replay);
    expect(serialized).not.toContain("PRIVATE_INTERVENTION_PAYLOAD");
    expect(serialized).not.toContain("PRIVATE_ASSISTANCE_MEMORY");
  });

  it("excludes later active-agent assistance without a rain causation edge", () => {
    const fixture = successfulFixture();
    const contributionProfile = AgentContributionProfilesByTemplateId.get(
      "assistant/material-understanding",
    );
    if (!contributionProfile) {
      throw new Error("测试缺少 material-understanding 冻结贡献配置");
    }
    const sourceProposal = AgentAssistanceProposalSchema.parse(
      fixture.events.find(
        (item) => item.eventId === "event-assistance",
      )!.payload.proposal,
    );
    const unrelatedProposal = AgentAssistanceProposalSchema.parse({
      ...sourceProposal,
      proposalId: "proposal-unrelated",
      agentRunId: "run-unrelated",
      templateRef: {
        templateId: "assistant/material-understanding",
        templateVersion: contributionProfile.templateVersion,
      },
      instanceRef: {
        instanceId: "instance-material-understanding",
        instanceVersion: contributionProfile.instanceVersion,
      },
      output: {
        ...sourceProposal.output,
        summary: "UNRELATED_ASSISTANCE_SUMMARY",
      },
      causationEventIds: ["event-unrelated"],
      evidenceRefs: ["evidence-unrelated"],
      idempotencyKey: "decision-unrelated",
      actorId: "agent-material-understanding",
      messageId: "message-assistance-unrelated",
      correlationId: "correlation-assistance-unrelated",
      timestamp: "2026-07-31T00:00:25.000Z",
    });
    fixture.events.push(event({
      eventId: "event-assistance-unrelated",
      eventType: "agent_assistance_recorded",
      stateVersion: 25,
      actorId: "agent-material-understanding",
      summary: "同会话后续无关建议",
      payload: { proposal: unrelatedProposal },
    }));

    const replay = buildCollaborationReplay({
      projection: projection(fixture.applied.eventId),
      events: fixture.events,
      trace: trace(fixture.records),
      generatedAt: now,
    });
    const contribution = replay.stages.find(
      (item) => item.phase === "agent_contribution",
    )!;

    expect(contribution.eventIds).toEqual(expect.arrayContaining([
      "event-assistance",
      "event-rain-applied",
    ]));
    expect(contribution.eventIds).not.toContain(
      "event-assistance-unrelated",
    );
    expect(contribution.agentRefs.map((item) => item.agentId)).toEqual([
      "agent-evidence-coach",
    ]);
    expect(contribution.evidenceIds).toEqual(["evidence-rain"]);
    expect(contribution.summary).not.toContain("UNRELATED_ASSISTANCE_SUMMARY");
  });

  it("accepts decisions only from the frozen event type and current proposals", () => {
    const fixture = successfulFixture();
    const validDecision = fixture.events.find(
      (item) => item.eventId === "event-student-decision",
    )!;
    const wrongType = structuredClone(validDecision);
    wrongType.eventId = "event-student-decision-wrong-type";
    wrongType.eventType = "world_fact_updated";
    wrongType.stateVersion = 25;
    wrongType.payload = structuredClone(validDecision.payload);
    (
      wrongType.payload.decision as { decision: "accepted" | "rejected" }
    ).decision = "rejected";
    const foreignProposal = structuredClone(validDecision);
    foreignProposal.eventId = "event-student-decision-foreign-proposal";
    foreignProposal.stateVersion = 26;
    foreignProposal.payload = structuredClone(validDecision.payload);
    foreignProposal.payload.proposalId = "proposal-foreign";
    (
      foreignProposal.payload.decision as {
        decision: "accepted" | "rejected";
      }
    ).decision = "rejected";
    fixture.events.push(wrongType, foreignProposal);

    const replay = buildCollaborationReplay({
      projection: projection(fixture.applied.eventId),
      events: fixture.events,
      trace: trace(fixture.records),
      generatedAt: now,
    });
    const decision = replay.stages.find(
      (item) => item.phase === "student_decision",
    )!;

    expect(decision.status).toBe("completed");
    expect(decision.eventIds).toEqual(expect.arrayContaining([
      "event-student-decision",
      flagshipCollaborationStudentDecisionRef(
        "agent-evidence-coach",
        "accepted",
      ),
    ]));
    expect(decision.eventIds).not.toContain(
      flagshipCollaborationStudentDecisionRef(
        "agent-evidence-coach",
        "rejected",
      ),
    );
    expect(decision.eventIds).not.toContain(
      flagshipCollaborationStudentDecisionRef(
        "agent-material-understanding",
        "rejected",
      ),
    );
    expect(decision.summary).not.toContain("proposal-foreign");
  });

  it.each([
    ["material rejection before evidence acceptance", true],
    ["evidence acceptance before material rejection", false],
  ] as const)(
    "aggregates mixed decisions independently of order: %s",
    (_label, rejectionFirst) => {
      const fixture = successfulFixture();
      const materialProfile = AgentContributionProfilesByTemplateId.get(
        "assistant/material-understanding",
      );
      if (!materialProfile) {
        throw new Error(
          "测试缺少 material-understanding 冻结贡献配置",
        );
      }
      const sourceAssistance = fixture.events.find(
        (item) => item.eventId === "event-assistance",
      )!;
      const sourceProposal = AgentAssistanceProposalSchema.parse(
        sourceAssistance.payload.proposal,
      );
      const materialProposal = AgentAssistanceProposalSchema.parse({
        ...sourceProposal,
        proposalId: "proposal-material-rain",
        agentRunId: "run-material-rain",
        templateRef: {
          templateId: "assistant/material-understanding",
          templateVersion: materialProfile.templateVersion,
        },
        instanceRef: {
          instanceId: "instance-material-understanding",
          instanceVersion: materialProfile.instanceVersion,
        },
        actorId: "agent-material-understanding",
        messageId: "message-assistance-material",
        correlationId: "correlation-assistance-material",
        idempotencyKey: "decision-material-rain",
      });
      const materialAssistance = event({
        eventId: "event-assistance-material",
        eventType: "agent_assistance_recorded",
        stateVersion: 22,
        actorId: "agent-material-understanding",
        summary: "材料理解智能体形成关键节点贡献",
        payload: { proposal: materialProposal },
      });
      const materialDecision = event({
        eventId: "event-student-decision-material",
        eventType: "agent_contribution_decided",
        stateVersion: rejectionFirst ? 23 : 24,
        actorId: "student-editor",
        summary: "学生拒绝材料理解建议",
        payload: {
          proposalId: materialProposal.proposalId,
          decision: {
            templateRef: materialProposal.templateRef,
            instanceRef: materialProposal.instanceRef,
            rolePerspective: materialProfile.rolePerspective,
            basisRefs: [{ kind: "evidence", refId: "evidence-rain" }],
            permissionSummary: materialProfile.permissionSummary,
            decision: "rejected",
            studentReason: "当前先采用证据教练的核验顺序。",
            idempotencyKey: "decision-material-rain",
          },
        },
      });
      const evidenceDecision = fixture.events.find(
        (item) => item.eventId === "event-student-decision",
      )!;
      evidenceDecision.stateVersion = rejectionFirst ? 24 : 23;
      const review = fixture.events.find(
        (item) => item.eventId === "event-teacher-review",
      )!;
      const evidence = fixture.events.find(
        (item) => item.eventId === "event-evidence",
      )!;
      fixture.events = [
        fixture.applied,
        sourceAssistance,
        materialAssistance,
        ...(rejectionFirst
          ? [materialDecision, evidenceDecision]
          : [evidenceDecision, materialDecision]),
        review,
        evidence,
      ];

      const replay = buildCollaborationReplay({
        projection: projection(fixture.applied.eventId),
        events: fixture.events,
        trace: trace(fixture.records),
        generatedAt: now,
      });
      const decision = replay.stages.find(
        (item) => item.phase === "student_decision",
      )!;

      expect(decision.status).toBe("completed");
      expect(decision.eventIds).toEqual(expect.arrayContaining([
        flagshipCollaborationStudentDecisionRef(
          "agent-material-understanding",
          "rejected",
        ),
        flagshipCollaborationStudentDecisionRef(
          "agent-evidence-coach",
          "accepted",
        ),
      ]));

      const allRejectedEvents = structuredClone(fixture.events);
      for (const item of allRejectedEvents) {
        if (item.eventType === "agent_contribution_decided") {
          (
            item.payload.decision as {
              decision: "accepted" | "rejected";
            }
          ).decision = "rejected";
        }
      }
      const allRejectedReplay = buildCollaborationReplay({
        projection: projection(fixture.applied.eventId),
        events: allRejectedEvents,
        trace: trace(fixture.records),
        generatedAt: now,
      });
      const allRejectedDecision = allRejectedReplay.stages.find(
        (item) => item.phase === "student_decision",
      )!;
      expect(allRejectedDecision.status).toBe("rejected");
      expect(allRejectedDecision.eventIds).toEqual(expect.arrayContaining([
        flagshipCollaborationStudentDecisionRef(
          "agent-material-understanding",
          "rejected",
        ),
        flagshipCollaborationStudentDecisionRef(
          "agent-evidence-coach",
          "rejected",
        ),
      ]));
    },
  );

  it("excludes evidence without a rain event or proposal evidence edge", () => {
    const fixture = successfulFixture();
    const sourceEvidence = structuredClone(
      fixture.events.find(
        (item) => item.eventId === "event-evidence",
      )!,
    );
    sourceEvidence.eventId = "event-evidence-unrelated";
    sourceEvidence.stateVersion = 25;
    sourceEvidence.payload = structuredClone(sourceEvidence.payload);
    sourceEvidence.payload.evidence = {
      ...sourceEvidence.payload.evidence as Record<string, unknown>,
      evidenceId: "evidence-unrelated",
      eventRefs: ["event-unrelated"],
    };
    fixture.events.push(sourceEvidence);

    const replay = buildCollaborationReplay({
      projection: projection(fixture.applied.eventId),
      events: fixture.events,
      trace: trace(fixture.records),
      generatedAt: now,
    });
    const writeback = replay.stages.find(
      (item) => item.phase === "world_writeback",
    )!;

    expect(writeback.evidenceIds).toEqual([
      "evidence-rain",
      FlagshipCollaborationEvidenceWritebackRef,
    ]);
    expect(writeback.eventIds).not.toContain("event-evidence-unrelated");
  });

  it("excludes audit-only same-agent trace records outside the rain event-task closure", () => {
    const fixture = successfulFixture();
    const auditOnlyNoise = event({
      eventId: "event-audit-only-unrelated",
      eventType: "agent_run_recorded",
      stateVersion: 25,
      actorId: "agent-evidence-coach",
      summary: "STUDENT_INVISIBLE_AUDIT_ONLY_EVENT",
    });
    auditOnlyNoise.visibility = ["audit_only"];
    fixture.events.push(auditOnlyNoise);
    fixture.records.push(record({
      traceId: "run:audit-only-unrelated",
      kind: "agent_run",
      eventId: auditOnlyNoise.eventId,
      taskId: "task-audit-only-unrelated",
      agentId: "agent-evidence-coach",
      stateVersion: 25,
    }));

    const replay = buildCollaborationReplay({
      projection: projection(fixture.applied.eventId),
      events: fixture.events,
      trace: trace(fixture.records),
      generatedAt: now,
    });

    expect(replay.technicalTraceRefs).not.toContain(
      "run:audit-only-unrelated",
    );
    expect(replay.stages.every(
      (item) => !item.technicalTraceRefs.includes(
        "run:audit-only-unrelated",
      ),
    )).toBe(true);
    expect(JSON.stringify(replay)).not.toContain(
      "STUDENT_INVISIBLE_AUDIT_ONLY_EVENT",
    );
  });

  it("follows explicit trace links from a grounded contribution to its permission task and run", () => {
    const fixture = successfulFixture();
    fixture.records = fixture.records.map((item) => {
      if (item.traceId === "event:event-assistance") {
        return { ...item, taskId: null };
      }
      if (
        item.traceId === "task:evidence"
        || item.traceId === "run:evidence"
      ) {
        return { ...item, eventId: null };
      }
      return item;
    });
    const replay = buildCollaborationReplay({
      projection: projection(fixture.applied.eventId),
      events: fixture.events,
      trace: trace(fixture.records, [
        {
          linkId: "link-assistance-run",
          fromTraceId: "run:evidence",
          toTraceId: "event:event-assistance",
          relation: "produces",
        },
        {
          linkId: "link-run-task",
          fromTraceId: "task:evidence",
          toTraceId: "run:evidence",
          relation: "executes",
        },
      ]),
      generatedAt: now,
    });
    const permission = replay.stages.find(
      (item) => item.phase === "permission_check",
    )!;

    expect(permission.status).toBe("completed");
    expect(permission.technicalTraceRefs).toEqual(expect.arrayContaining([
      "task:evidence",
      "run:evidence",
    ]));
  });

  it("fails closed for missing, reversed, or incorrect executes edges", () => {
    const cases: Array<{
      label: string;
      taskLink: SessionTraceProjection["links"][number] | null;
    }> = [
      {
        label: "missing executes",
        taskLink: null,
      },
      {
        label: "reversed executes",
        taskLink: {
          linkId: "link-run-task-reversed",
          fromTraceId: "run:evidence",
          toTraceId: "task:evidence",
          relation: "executes",
        },
      },
      {
        label: "incorrect executes target",
        taskLink: {
          linkId: "link-run-task-wrong-target",
          fromTraceId: "task:evidence",
          toTraceId: "run:not-the-proposal-run",
          relation: "executes",
        },
      },
    ];

    for (const current of cases) {
      const fixture = successfulFixture();
      const replay = buildCollaborationReplay({
        projection: projection(fixture.applied.eventId),
        events: fixture.events,
        trace: trace(fixture.records, [
          fixture.links[0]!,
          ...(current.taskLink ? [current.taskLink] : []),
        ]),
        generatedAt: now,
      });
      const permission = replay.stages.find(
        (item) => item.phase === "permission_check",
      )!;

      expect(permission.status, current.label).toBe("missing");
      expect(
        permission.technicalTraceRefs,
        current.label,
      ).not.toContain("run:evidence");
      expect(
        permission.technicalTraceRefs,
        current.label,
      ).not.toContain("task:evidence");
      expect(replay.technicalTraceRefs, current.label)
        .not.toContain("run:evidence");
      expect(replay.technicalTraceRefs, current.label)
        .not.toContain("task:evidence");
    }
  });

  it("rejects a task producer shortcut and a same-agent run identity mismatch", () => {
    const directTaskFixture = successfulFixture();
    const directTaskReplay = buildCollaborationReplay({
      projection: projection(directTaskFixture.applied.eventId),
      events: directTaskFixture.events,
      trace: trace(directTaskFixture.records, [
        {
          linkId: "link-task-assistance-shortcut",
          fromTraceId: "task:evidence",
          toTraceId: "event:event-assistance",
          relation: "produces",
        },
        directTaskFixture.links[1]!,
      ]),
      generatedAt: now,
    });

    const identityFixture = successfulFixture();
    identityFixture.records = identityFixture.records.map((item) => (
      item.traceId === "run:evidence"
        ? {
            ...item,
            sourceId: "run-same-agent-wrong-identity",
            agentRunId: "run-same-agent-wrong-identity",
          }
        : item
    ));
    const identityReplay = buildCollaborationReplay({
      projection: projection(identityFixture.applied.eventId),
      events: identityFixture.events,
      trace: trace(identityFixture.records, identityFixture.links),
      generatedAt: now,
    });

    for (const replay of [directTaskReplay, identityReplay]) {
      const permission = replay.stages.find(
        (item) => item.phase === "permission_check",
      )!;
      expect(permission.status).toBe("missing");
      expect(permission.technicalTraceRefs).toEqual([]);
      expect(replay.technicalTraceRefs).not.toContain("run:evidence");
      expect(replay.technicalTraceRefs).not.toContain("task:evidence");
    }
  });

  it("does not fan out to a same-task later run, attempt, or related-event producer", () => {
    const fixture = successfulFixture();
    fixture.records.push(
      record({
        traceId: "run:evidence-later-noise",
        kind: "agent_run",
        sourceId: "run-evidence-later-noise",
        eventId: fixture.applied.eventId,
        taskId: "task-evidence",
        agentRunId: "run-evidence-later-noise",
        agentId: "agent-evidence-coach",
        stateVersion: 25,
      }),
      record({
        traceId: "attempt:evidence-later-noise",
        kind: "dispatch_attempt",
        eventId: fixture.applied.eventId,
        taskId: "task-evidence",
        agentId: "agent-evidence-coach",
        stateVersion: 25,
      }),
      record({
        traceId: "event:event-teacher-review",
        kind: "world_event",
        sourceId: "event-teacher-review",
        eventId: "event-teacher-review",
        stateVersion: 23,
      }),
    );
    const replay = buildCollaborationReplay({
      projection: projection(fixture.applied.eventId),
      events: fixture.events,
      trace: trace(fixture.records, [
        ...fixture.links,
        {
          linkId: "link-task-later-run",
          fromTraceId: "task:evidence",
          toTraceId: "run:evidence-later-noise",
          relation: "executes",
        },
        {
          linkId: "link-task-later-attempt",
          fromTraceId: "task:evidence",
          toTraceId: "attempt:evidence-later-noise",
          relation: "attempts",
        },
        {
          linkId: "link-later-run-related-review",
          fromTraceId: "run:evidence-later-noise",
          toTraceId: "event:event-teacher-review",
          relation: "produces",
        },
      ]),
      generatedAt: now,
    });
    const permission = replay.stages.find(
      (item) => item.phase === "permission_check",
    )!;

    expect(permission.status).toBe("completed");
    expect(permission.technicalTraceRefs).toEqual(expect.arrayContaining([
      "task:evidence",
      "run:evidence",
    ]));
    for (const unrelated of [
      "run:evidence-later-noise",
      "attempt:evidence-later-noise",
      "event:event-teacher-review",
    ]) {
      expect(permission.technicalTraceRefs).not.toContain(unrelated);
      expect(replay.technicalTraceRefs).not.toContain(unrelated);
    }
  });

  it("keeps writeback missing until the teacher explicitly approves", () => {
    const fixture = successfulFixture();
    fixture.events = fixture.events.filter(
      (item) => item.eventId !== "event-teacher-review",
    );

    const replay = buildCollaborationReplay({
      projection: projection(fixture.applied.eventId),
      events: fixture.events,
      trace: trace(fixture.records),
      generatedAt: now,
    });
    const teacherReview = replay.stages.find(
      (item) => item.phase === "teacher_review",
    )!;
    const writeback = replay.stages.find(
      (item) => item.phase === "world_writeback",
    )!;

    expect(teacherReview.status).toBe("missing");
    expect(teacherReview.eventIds).not.toContain(
      FlagshipCollaborationTeacherApprovedRef,
    );
    expect(writeback).toMatchObject({
      status: "missing",
      eventIds: [],
      taskIds: [],
      evidenceIds: [],
    });
  });

  it("keeps historical writeback grounded after the current anchor advances", () => {
    const fixture = successfulFixture();
    const evaluationProfile = AgentContributionProfilesByTemplateId.get(
      "assistant/evaluation-review",
    );
    if (!evaluationProfile) {
      throw new Error("测试缺少 evaluation-review 冻结贡献配置");
    }
    const sourceProposal = AgentAssistanceProposalSchema.parse(
      fixture.events.find(
        (item) => item.eventId === "event-assistance",
      )!.payload.proposal,
    );
    const evaluationProposal = AgentAssistanceProposalSchema.parse({
      ...sourceProposal,
      proposalId: "proposal-evaluation-rain",
      agentRunId: "run-evaluation-rain",
      roleId: "teacher_assistant",
      templateRef: {
        templateId: "assistant/evaluation-review",
        templateVersion: evaluationProfile.templateVersion,
      },
      instanceRef: {
        instanceId: "instance-evaluation-review",
        instanceVersion: evaluationProfile.instanceVersion,
      },
      outputSchemaRef: "agent-assistance/evaluation-review/1.0.0",
      output: {
        kind: "evaluation_review",
        summary: "锚点前移后仍保留已发生的教师评价复核贡献。",
        evaluationCaseId: "evaluation-case-rain",
        arbitrationId: "arbitration-rain",
        dimensionDifferences: [],
        evidenceGaps: ["继续核对暴雨协作证据引用。"],
        reviewOrder: ["先核对证据", "再核对逐维理由"],
      },
      subjectActorId: "teacher-main",
      resourceRef: {
        objectType: "evaluation_case",
        objectId: "evaluation-case-rain",
        version: "1",
      },
      expectedStateVersion: 26,
      visibility: ["teacher_only", "audit_only"],
      visibleToActorIds: ["teacher-main"],
      idempotencyKey: "decision-evaluation-rain",
      actorId: "agent-evaluation-review",
      messageId: "message-assistance-evaluation",
      correlationId: "correlation-assistance-evaluation",
    });
    const evaluationAssistance = event({
      eventId: "event-assistance-evaluation",
      eventType: "agent_assistance_recorded",
      stateVersion: 26,
      actorId: "agent-evaluation-review",
      summary: "评价复核智能体形成历史关键贡献",
      payload: { proposal: evaluationProposal },
    });
    const unrelatedAnchorEvent = event({
      eventId: "event-unrelated-current-anchor",
      eventType: "world_fact_updated",
      stateVersion: 27,
      actorId: "student-editor",
      summary: "后续节点的无关当前任务事件",
    });
    fixture.events.push(evaluationAssistance, unrelatedAnchorEvent);
    fixture.records.push(record({
      traceId: "task:evaluation-rain",
      kind: "agent_task",
      eventId: "event-evaluation-arbitrated",
      taskId: "task-evaluation-rain",
      agentId: "agent-evaluation-review",
      stateVersion: 26,
    }));
    fixture.records.push(record({
      traceId: "run:evaluation-rain",
      kind: "agent_run",
      sourceId: "run-evaluation-rain",
      eventId: null,
      taskId: "task-evaluation-rain",
      agentRunId: "run-evaluation-rain",
      agentId: "agent-evaluation-review",
      stateVersion: 26,
    }));
    fixture.records.push(record({
      traceId: "event:event-assistance-evaluation",
      kind: "agent_assistance",
      sourceId: evaluationAssistance.eventId,
      eventId: evaluationAssistance.eventId,
      taskId: null,
      agentId: "agent-evaluation-review",
      stateVersion: 26,
    }));
    const mismatchedProjection = projection(unrelatedAnchorEvent.eventId);
    mismatchedProjection.currentTaskAnchor = {
      ...mismatchedProjection.currentTaskAnchor,
      taskId: "task-unrelated-current",
      worldTarget: {
        mode: "world_interaction",
        sceneId: "scene-rain-transition",
        taskId: "task-unrelated-current",
      },
    };

    const replay = buildCollaborationReplay({
      projection: mismatchedProjection,
      events: fixture.events,
      trace: trace(fixture.records, [
        ...fixture.links,
        {
          linkId: "link-evaluation-assistance-run",
          fromTraceId: "run:evaluation-rain",
          toTraceId: "event:event-assistance-evaluation",
          relation: "produces",
        },
        {
          linkId: "link-evaluation-run-task",
          fromTraceId: "task:evaluation-rain",
          toTraceId: "run:evaluation-rain",
          relation: "executes",
        },
      ]),
      generatedAt: now,
    });
    const writeback = replay.stages.find(
      (item) => item.phase === "world_writeback",
    )!;
    const contribution = replay.stages.find(
      (item) => item.phase === "agent_contribution",
    )!;

    expect(replay.stages.find(
      (item) => item.phase === "teacher_review",
    )?.status).toBe("completed");
    expect(writeback).toMatchObject({
      status: "completed",
      taskIds: [FlagshipCollaborationTaskId],
    });
    expect(writeback.eventIds).toContain(
      FlagshipCollaborationWorldWritebackRef,
    );
    expect(writeback.evidenceIds).toContain(
      FlagshipCollaborationEvidenceWritebackRef,
    );
    expect(writeback.eventIds).not.toContain(
      unrelatedAnchorEvent.eventId,
    );
    expect(contribution.agentRefs.map((item) => item.agentId)).toContain(
      "agent-evaluation-review",
    );
    expect(contribution.eventIds).toContain(
      evaluationAssistance.eventId,
    );
  });

  it("does not ground writeback without a real applied intervention event", () => {
    const fixture = successfulFixture();
    const candidate = event({
      eventId: "event-rain-candidate",
      eventType: "candidate_event_proposed",
      stateVersion: 19,
      actorId: "agent-scene-director",
      summary: "暴雨升级候选已形成",
      payload: {
        candidate: {
          candidateId,
          eventType: "scenario_intervention_applied",
          title: "暴雨突发下的双岗应变",
          triggerReason: "现场暴雨预警",
          competencyTarget: "C-COLLAB-03",
          expectedImpact: "任务重排并提升平台风险。",
          payload: {},
          status: "pending",
          proposedBy: "agent-scene-director",
          proposedAt: "2026-07-31T00:00:19.000Z",
          routeId: FlagshipCollaborationRouteId,
        },
      },
    });
    fixture.events = [
      candidate,
      ...fixture.events.filter(
        (item) => item.eventId !== fixture.applied.eventId,
      ),
    ];

    const replay = buildCollaborationReplay({
      projection: projection(candidate.eventId),
      events: fixture.events,
      trace: trace(fixture.records),
      generatedAt: now,
    });
    const writeback = replay.stages.find(
      (item) => item.phase === "world_writeback",
    )!;

    expect(replay.stages.find(
      (item) => item.phase === "teacher_review",
    )?.status).toBe("completed");
    expect(writeback).toMatchObject({
      status: "missing",
      eventIds: [],
      taskIds: [],
      evidenceIds: [],
    });
    expect(writeback.eventIds).not.toContain(
      FlagshipCollaborationWorldWritebackRef,
    );
    expect(writeback.evidenceIds).not.toContain(
      FlagshipCollaborationEvidenceWritebackRef,
    );
  });

  it("never joins an applied intervention from another rain candidate", () => {
    const fixture = successfulFixture();
    const latestCandidateId = "candidate-rain-latest";
    const latestCandidate = event({
      eventId: "event-rain-candidate-latest",
      eventType: "candidate_event_proposed",
      stateVersion: 19,
      actorId: "agent-scene-director",
      summary: "最新暴雨升级候选已形成",
      payload: {
        candidate: {
          candidateId: latestCandidateId,
          eventType: "scenario_intervention_applied",
          title: "最新暴雨突发下的双岗应变",
          triggerReason: "最新现场暴雨预警",
          competencyTarget: "C-COLLAB-03",
          expectedImpact: "任务重排并提升平台风险。",
          payload: {},
          status: "pending",
          proposedBy: "agent-scene-director",
          proposedAt: "2026-07-31T00:00:19.000Z",
          routeId: FlagshipCollaborationRouteId,
        },
      },
    });
    const review = fixture.events.find(
      (item) => item.eventId === "event-teacher-review",
    )!;
    review.payload.candidateId = latestCandidateId;
    fixture.events.unshift(latestCandidate);

    const mismatched = buildCollaborationReplay({
      projection: projection(fixture.applied.eventId),
      events: fixture.events,
      trace: trace(fixture.records),
      generatedAt: now,
    });
    const mismatchedWriteback = mismatched.stages.find(
      (item) => item.phase === "world_writeback",
    )!;
    expect(mismatchedWriteback).toMatchObject({
      status: "missing",
      eventIds: [],
      taskIds: [],
      evidenceIds: [],
      technicalTraceRefs: [],
    });
    expect(mismatchedWriteback.eventIds).not.toContain(
      FlagshipCollaborationWorldWritebackRef,
    );
    expect(mismatchedWriteback.evidenceIds).not.toContain(
      FlagshipCollaborationEvidenceWritebackRef,
    );
    expect(mismatched.stages.every(
      (stage) => !stage.eventIds.includes(fixture.applied.eventId),
    )).toBe(true);
    expect(mismatched.stages.every(
      (stage) => !stage.evidenceIds.includes("evidence-rain"),
    )).toBe(true);
    expect(mismatched.technicalTraceRefs).toEqual([]);
    expect(JSON.stringify(mismatched)).not.toContain("run:evidence");

    const intervention = fixture.applied.payload.intervention as {
      sourceCandidateId: string;
    };
    intervention.sourceCandidateId = latestCandidateId;
    const matched = buildCollaborationReplay({
      projection: projection(fixture.applied.eventId),
      events: fixture.events,
      trace: trace(fixture.records),
      generatedAt: now,
    });
    const matchedWriteback = matched.stages.find(
      (item) => item.phase === "world_writeback",
    )!;
    expect(matched.status).toBe("completed");
    expect(matchedWriteback).toMatchObject({
      status: "completed",
      taskIds: [FlagshipCollaborationTaskId],
    });
    expect(matchedWriteback.eventIds).toContain(
      FlagshipCollaborationWorldWritebackRef,
    );
    expect(matchedWriteback.evidenceIds).toContain(
      FlagshipCollaborationEvidenceWritebackRef,
    );
  });

  it("keeps student rejection, teacher rejection and failures explicit", () => {
    const fixture = successfulFixture();
    (
      fixture.events.find(
        (item) => item.eventId === "event-student-decision",
      )!.payload.decision as { decision: string }
    ).decision = "rejected";
    fixture.events.find(
      (item) => item.eventId === "event-teacher-review",
    )!.eventType = "candidate_event_rejected";
    fixture.records.find(
      (item) => item.traceId === "run:evidence",
    )!.status = "failed";

    const replay = buildCollaborationReplay({
      projection: projection(fixture.applied.eventId),
      events: fixture.events,
      trace: trace(fixture.records),
      generatedAt: now,
    });

    expect(replay.status).toBe("failed");
    expect(replay.stages[3]?.status).toBe("failed");
    expect(replay.stages[5]?.status).toBe("rejected");
    expect(replay.stages[5]?.eventIds).toContain(
      flagshipCollaborationStudentDecisionRef(
        "agent-evidence-coach",
        "rejected",
      ),
    );
    expect(replay.stages[6]?.status).toBe("rejected");
    expect(replay.stages[6]?.eventIds).not.toContain(
      FlagshipCollaborationTeacherApprovedRef,
    );
    expect(replay.stages[7]?.status).toBe("not_applicable");
    expect(replay.stages[7]).toMatchObject({
      eventIds: [],
      taskIds: [],
      evidenceIds: [],
      technicalTraceRefs: [],
    });
  });

  it("omits grounded decision and evidence aliases until matching real stages exist", () => {
    const fixture = successfulFixture();
    fixture.events = fixture.events.filter((item) => (
      item.eventId !== "event-student-decision"
      && item.eventId !== "event-evidence"
    ));

    const replay = buildCollaborationReplay({
      projection: projection(fixture.applied.eventId),
      events: fixture.events,
      trace: trace(fixture.records),
      generatedAt: now,
    });
    const decision = replay.stages.find(
      (item) => item.phase === "student_decision",
    )!;
    const writeback = replay.stages.find(
      (item) => item.phase === "world_writeback",
    )!;

    expect(decision.status).toBe("missing");
    expect(decision.eventIds).toEqual([]);
    expect(writeback.status).toBe("completed");
    expect(writeback.evidenceIds).not.toContain(
      FlagshipCollaborationEvidenceWritebackRef,
    );
    expect(writeback.evidenceIds).toEqual([]);
  });
});
