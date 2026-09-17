import {
  AgentAssistanceProposalSchema,
  AgentContributionDecisionEventPayloadSchema,
  CandidateEventSchema,
  CollaborationReplaySchema,
  CollaborationReplaySchemaVersion,
  EvidenceSchema,
  FlagshipCollaborationEvidenceWritebackRef,
  FlagshipCollaborationTeacherApprovedRef,
  FlagshipCollaborationWorldWritebackRef,
  ScenarioInterventionSchema,
  flagshipCollaborationStudentDecisionRef,
  type AgentAssistanceProposal,
  type CollaborationReplay,
  type CollaborationReplayAgentRef,
  type CollaborationReplayPhase,
  type CollaborationReplayStage,
  type CollaborationReplayStageStatus,
  type CollaborationStrategyStudentChoiceAgentId,
  type SessionTraceProjection,
  type StateProjection,
  type TraceRecord,
  type WorldEvent,
} from "@ronggang/contracts";

export const FlagshipCollaborationRouteId = "route-rain-escalation";
export const FlagshipCollaborationEventId =
  "flagship-event-rain-escalation";
export const FlagshipCollaborationTaskId =
  "flagship-task-rain-collaboration";

const activeAgentIds = new Set([
  "agent-evidence-coach",
  "agent-material-understanding",
  "agent-evaluation-review",
]);

const phaseTitles: Record<CollaborationReplayPhase, string> = {
  event_trigger: "代表性事件触发",
  candidate_screening: "候选筛选与调度理由",
  agent_wakeup: "智能体实际唤醒",
  permission_check: "权限与权威边界",
  agent_contribution: "关键岗位贡献",
  student_decision: "学生采纳或拒绝",
  teacher_review: "教师复核",
  world_writeback: "世界、任务与证据写回",
};

interface ParsedAssistance {
  event: WorldEvent;
  proposal: AgentAssistanceProposal;
  agentId: string;
}

interface ParsedStudentDecision {
  event: WorldEvent;
  agentId: CollaborationStrategyStudentChoiceAgentId;
  decision: "accepted" | "rejected";
  proposalId: string;
  reason: string;
}

export interface BuildCollaborationReplayInput {
  projection: StateProjection;
  events: readonly WorldEvent[];
  trace: SessionTraceProjection;
  generatedAt?: string;
}

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(
    values.filter((value): value is string => Boolean(value)),
  )];
}

function detailValue(
  record: TraceRecord,
  label: string,
): string | null {
  return record.details.find((item) => item.label === label)?.value ?? null;
}

function splitVersionedRef(
  value: string | null,
): string | null {
  if (!value) return null;
  const separator = value.lastIndexOf("@");
  return separator > 0 ? value.slice(0, separator) : value;
}

function agentRefsFromRecords(
  records: readonly TraceRecord[],
): CollaborationReplayAgentRef[] {
  const refs = new Map<string, CollaborationReplayAgentRef>();
  for (const record of records) {
    if (!record.agentId || !activeAgentIds.has(record.agentId)) continue;
    const templateId = splitVersionedRef(detailValue(record, "模板"));
    const instanceId = splitVersionedRef(detailValue(record, "实例"));
    if (!templateId || !instanceId) continue;
    refs.set(record.agentId, {
      agentId: record.agentId,
      templateId,
      instanceId,
    });
  }
  return [...refs.values()].toSorted((left, right) => (
    left.agentId.localeCompare(right.agentId)
  ));
}

function agentRefsFromAssistance(
  assistance: readonly ParsedAssistance[],
): CollaborationReplayAgentRef[] {
  const refs = new Map<string, CollaborationReplayAgentRef>();
  for (const item of assistance) {
    refs.set(item.agentId, {
      agentId: item.agentId,
      templateId: item.proposal.templateRef.templateId,
      instanceId: item.proposal.instanceRef.instanceId,
    });
  }
  return [...refs.values()].toSorted((left, right) => (
    left.agentId.localeCompare(right.agentId)
  ));
}

function stageStatusFromRecords(
  records: readonly TraceRecord[],
  emptyStatus: CollaborationReplayStageStatus = "missing",
): CollaborationReplayStageStatus {
  if (records.length === 0) return emptyStatus;
  if (records.some((record) => (
    record.status === "failed"
    || record.status === "dead_lettered"
    || record.status === "degraded"
  ))) {
    return "failed";
  }
  return "completed";
}

function stage(input: {
  phase: CollaborationReplayPhase;
  status: CollaborationReplayStageStatus;
  summary: string;
  records?: readonly TraceRecord[];
  events?: readonly WorldEvent[];
  actorIds?: string[];
  agentRefs?: CollaborationReplayAgentRef[];
  eventIds?: string[];
  taskIds?: string[];
  evidenceIds?: string[];
}): CollaborationReplayStage {
  const records = input.records ?? [];
  const events = input.events ?? [];
  const occurredAt = [
    ...events.map((event) => event.timestamp),
    ...records.map((record) => record.timestamp),
  ].toSorted()[0] ?? null;
  const stateVersions = [
    ...events.map((event) => event.stateVersion),
    ...records.flatMap((record) => (
      record.stateVersion === null ? [] : [record.stateVersion]
    )),
  ];
  return {
    phase: input.phase,
    status: input.status,
    occurredAt,
    stateVersion: stateVersions.length > 0
      ? Math.min(...stateVersions)
      : null,
    title: phaseTitles[input.phase],
    summary: input.summary,
    actorIds: unique([
      ...(input.actorIds ?? []),
      ...events.map((event) => event.actorId),
      ...records.map((record) => record.actorId),
    ]),
    agentRefs: input.agentRefs ?? agentRefsFromRecords(records),
    eventIds: unique([
      ...(input.eventIds ?? []),
      ...events.map((event) => event.eventId),
      ...records.map((record) => record.eventId),
    ]),
    taskIds: unique([
      ...(input.taskIds ?? []),
      ...records.map((record) => record.taskId),
    ]),
    evidenceIds: unique(input.evidenceIds ?? []),
    technicalTraceRefs: unique(records.map((record) => record.traceId)),
  };
}

function rainCandidateEvent(
  events: readonly WorldEvent[],
): { event: WorldEvent; candidateId: string } | null {
  for (const event of events.toReversed()) {
    if (event.eventType !== "candidate_event_proposed") continue;
    const candidate = CandidateEventSchema.safeParse(event.payload.candidate);
    if (
      candidate.success
      && candidate.data.routeId === FlagshipCollaborationRouteId
    ) {
      return {
        event,
        candidateId: candidate.data.candidateId,
      };
    }
  }
  return null;
}

function rainAppliedEvent(
  events: readonly WorldEvent[],
  candidateId?: string,
  minimumStateVersion = 0,
): { event: WorldEvent; candidateId: string } | null {
  for (const event of events.toReversed()) {
    if (
      event.eventType !== "scenario_intervention_applied"
      || event.stateVersion < minimumStateVersion
    ) {
      continue;
    }
    const intervention = ScenarioInterventionSchema.safeParse(
      event.payload.intervention,
    );
    if (
      intervention.success
      && intervention.data.routeId === FlagshipCollaborationRouteId
      && (
        candidateId === undefined
        || intervention.data.sourceCandidateId === candidateId
      )
    ) {
      return {
        event,
        candidateId: intervention.data.sourceCandidateId,
      };
    }
  }
  return null;
}

function assistanceItems(
  events: readonly WorldEvent[],
  minimumStateVersion: number,
  causationEventIds: ReadonlySet<string>,
): ParsedAssistance[] {
  const items: ParsedAssistance[] = [];
  for (const event of events) {
    if (
      event.eventType !== "agent_assistance_recorded"
      || event.stateVersion < minimumStateVersion
    ) {
      continue;
    }
    const proposal = AgentAssistanceProposalSchema.safeParse(
      event.payload.proposal,
    );
    if (
      !proposal.success
      || !activeAgentIds.has(event.actorId)
      || !proposal.data.causationEventIds.some(
        (eventId) => causationEventIds.has(eventId),
      )
    ) {
      continue;
    }
    items.push({
      event,
      proposal: proposal.data,
      agentId: event.actorId,
    });
  }
  return items;
}

function studentDecision(
  event: WorldEvent,
  agentIdByProposalId: ReadonlyMap<
    string,
    CollaborationStrategyStudentChoiceAgentId
  >,
): ParsedStudentDecision | null {
  if (event.eventType !== "agent_contribution_decided") return null;
  const payload = AgentContributionDecisionEventPayloadSchema.safeParse(
    event.payload,
  );
  if (
    !payload.success
    || !agentIdByProposalId.has(payload.data.proposalId)
  ) {
    return null;
  }
  const agentId = agentIdByProposalId.get(payload.data.proposalId);
  if (!agentId) return null;
  return {
    event,
    agentId,
    decision: payload.data.decision.decision,
    proposalId: payload.data.proposalId,
    reason: payload.data.decision.studentReason,
  };
}

function evidenceWrittenAfter(
  events: readonly WorldEvent[],
  stateVersion: number,
  causationEventIds: ReadonlySet<string>,
  proposalEvidenceIds: ReadonlySet<string>,
): { events: WorldEvent[]; evidenceIds: string[] } {
  const evidenceEvents: WorldEvent[] = [];
  const evidenceIds: string[] = [];
  for (const event of events) {
    if (
      event.eventType !== "evidence_recorded"
      || event.stateVersion < stateVersion
    ) {
      continue;
    }
    const evidence = EvidenceSchema.safeParse(event.payload.evidence);
    if (
      !evidence.success
      || (
        !proposalEvidenceIds.has(evidence.data.evidenceId)
        && !evidence.data.eventRefs.some(
          (eventId) => causationEventIds.has(eventId),
        )
      )
    ) {
      continue;
    }
    evidenceEvents.push(event);
    evidenceIds.push(evidence.data.evidenceId);
  }
  return {
    events: evidenceEvents,
    evidenceIds: unique(evidenceIds),
  };
}

interface AssistanceTracePath {
  assistance: ParsedAssistance;
  eventRecord: TraceRecord | null;
  runRecord: TraceRecord | null;
  taskRecord: TraceRecord | null;
  records: TraceRecord[];
  complete: boolean;
}

function uniqueRecords(
  records: Array<TraceRecord | null>,
): TraceRecord[] {
  return [...new Map(
    records.flatMap((record) => (
      record ? [[record.traceId, record] as const] : []
    )),
  ).values()];
}

function assistanceTracePath(
  trace: SessionTraceProjection,
  assistance: ParsedAssistance,
): AssistanceTracePath {
  const eventRecords = trace.records.filter((record) => (
    record.kind === "agent_assistance"
    && record.eventId === assistance.event.eventId
    && record.sourceId === assistance.event.eventId
    && record.actorId === assistance.agentId
  ));
  const eventRecord = eventRecords.length === 1
    ? eventRecords[0]!
    : null;
  if (!eventRecord) {
    return {
      assistance,
      eventRecord: null,
      runRecord: null,
      taskRecord: null,
      records: [],
      complete: false,
    };
  }

  const runRecords = trace.records.filter((record) => (
    record.kind === "agent_run"
    && record.agentRunId === assistance.proposal.agentRunId
    && record.sourceId === assistance.proposal.agentRunId
    && record.agentId === assistance.agentId
    && trace.links.some((link) => (
      link.relation === "produces"
      && link.fromTraceId === record.traceId
      && link.toTraceId === eventRecord.traceId
    ))
  ));
  const runRecord = runRecords.length === 1 ? runRecords[0]! : null;
  if (!runRecord || runRecord.taskId === null) {
    return {
      assistance,
      eventRecord,
      runRecord,
      taskRecord: null,
      records: [eventRecord],
      complete: false,
    };
  }

  const taskRecords = trace.records.filter((record) => (
    record.kind === "agent_task"
    && record.taskId === runRecord.taskId
    && record.agentId === assistance.agentId
    && trace.links.some((link) => (
      link.relation === "executes"
      && link.fromTraceId === record.traceId
      && link.toTraceId === runRecord.traceId
    ))
  ));
  const taskRecord = taskRecords.length === 1 ? taskRecords[0]! : null;
  return {
    assistance,
    eventRecord,
    runRecord,
    taskRecord,
    records: taskRecord
      ? uniqueRecords([eventRecord, runRecord, taskRecord])
      : [eventRecord],
    complete: taskRecord !== null,
  };
}

function recordsForEvents(
  trace: SessionTraceProjection,
  eventIds: ReadonlySet<string>,
  kinds: ReadonlySet<TraceRecord["kind"]>,
): TraceRecord[] {
  return trace.records.filter((record) => (
    record.eventId !== null
    && eventIds.has(record.eventId)
    && kinds.has(record.kind)
  ));
}

export function buildCollaborationReplay(
  input: BuildCollaborationReplayInput,
): CollaborationReplay {
  const candidate = rainCandidateEvent(input.events);
  const applied = candidate === null
    ? rainAppliedEvent(input.events)
    : rainAppliedEvent(
        input.events,
        candidate.candidateId,
        candidate.event.stateVersion,
      );
  const trigger = candidate?.event ?? applied?.event ?? null;
  const candidateId = candidate?.candidateId ?? applied?.candidateId ?? null;
  const relatedEvents = input.events.filter((event) => (
    event.eventId === trigger?.eventId
    || event.eventId === applied?.event.eventId
    || (
      candidateId !== null
      && (
        event.payload.candidateId === candidateId
        || (
          typeof event.payload.candidate === "object"
          && event.payload.candidate !== null
          && (
            event.payload.candidate as { candidateId?: unknown }
          ).candidateId === candidateId
        )
      )
    )
  ));
  const relatedEventIds = new Set(
    relatedEvents.map((event) => event.eventId),
  );
  const contributionFloor =
    trigger?.stateVersion ?? input.projection.stateVersion;
  const assistance = assistanceItems(
    input.events,
    contributionFloor,
    relatedEventIds,
  );
  const assistanceEvents = assistance.map((item) => item.event);
  const assistanceEventIds = new Set(
    assistanceEvents.map((event) => event.eventId),
  );
  const screeningRecords = recordsForEvents(
    input.trace,
    relatedEventIds,
    new Set(["dispatch_plan", "dispatch_decision"]),
  );
  const assistanceTracePaths = assistance.map((item) => (
    assistanceTracePath(input.trace, item)
  ));
  const assistanceTraceComplete =
    assistanceTracePaths.length > 0
    && assistanceTracePaths.every((path) => path.complete);
  const assistanceTraceRecords = uniqueRecords(
    assistanceTracePaths.flatMap((path) => path.records),
  );
  const permissionRecords = uniqueRecords(
    assistanceTracePaths.flatMap((path) => (
      path.complete
        ? [path.taskRecord, path.runRecord]
        : []
    )),
  );
  const wakeupRecords = permissionRecords;
  const studentDecisionAgentIds = new Set<
    CollaborationStrategyStudentChoiceAgentId
  >([
    "agent-evidence-coach",
    "agent-material-understanding",
  ]);
  const agentIdByProposalId = new Map<
    string,
    CollaborationStrategyStudentChoiceAgentId
  >(
    assistance.flatMap((item) => (
      studentDecisionAgentIds.has(
        item.agentId as CollaborationStrategyStudentChoiceAgentId,
      )
        ? [[
            item.proposal.proposalId,
            item.agentId as CollaborationStrategyStudentChoiceAgentId,
          ]]
        : []
    )),
  );
  const decisions = input.events
    .map((event) => studentDecision(event, agentIdByProposalId))
    .filter((item): item is ParsedStudentDecision => item !== null)
    .filter((item) => item.event.stateVersion >= contributionFloor);
  const reviewEvents = candidateId === null
    ? []
    : input.events.filter((event) => (
        (
          event.eventType === "candidate_event_approved"
          || event.eventType === "candidate_event_rejected"
        )
        && event.payload.candidateId === candidateId
      ));
  const latestReview = reviewEvents.at(-1);
  const evidenceCausationEventIds = new Set([
    ...relatedEventIds,
    ...assistanceEventIds,
    ...decisions.map((item) => item.event.eventId),
  ]);
  const proposalEvidenceIds = new Set(assistance.flatMap((item) => (
    item.proposal.evidenceRefs
  )));
  const evidenceWriteback = evidenceWrittenAfter(
    input.events,
    applied?.event.stateVersion ?? contributionFloor,
    evidenceCausationEventIds,
    proposalEvidenceIds,
  );
  const anchorSourceEventId =
    input.projection.currentTaskAnchor.sourceEventId;
  const relatedAnchorSourceEventId =
    anchorSourceEventId !== null
      && relatedEventIds.has(anchorSourceEventId)
      ? anchorSourceEventId
      : null;
  const writebackEvents = unique([
    applied?.event.eventId,
    relatedAnchorSourceEventId,
    ...evidenceWriteback.events.map((event) => event.eventId),
  ]).flatMap((eventId) => (
    input.events.find((event) => event.eventId === eventId) ?? []
  ));
  const teacherApproved =
    latestReview?.eventType === "candidate_event_approved";
  const writebackApprovedAndGrounded =
    teacherApproved
    && applied !== null;
  const approvedWritebackEvents = writebackApprovedAndGrounded
    ? writebackEvents
    : [];
  const approvedEvidenceIds = writebackApprovedAndGrounded
    ? evidenceWriteback.evidenceIds
    : [];
  const worldWritebackCompleted =
    writebackApprovedAndGrounded
    && applied !== null
    && approvedWritebackEvents.some(
      (event) => event.eventId === applied.event.eventId,
    );
  const triggerMissing = trigger === null;

  const stages: CollaborationReplayStage[] = [
    stage({
      phase: "event_trigger",
      status: triggerMissing ? "missing" : "completed",
      summary: trigger
        ? trigger.summary
        : "旗舰暴雨事件尚未进入当前角色可见的权威事件链。",
      events: trigger ? [trigger] : [],
      eventIds: trigger ? [FlagshipCollaborationEventId] : [],
    }),
    stage({
      phase: "candidate_screening",
      status: triggerMissing
        ? "not_applicable"
        : stageStatusFromRecords(screeningRecords),
      summary: triggerMissing
        ? "事件尚未触发，候选筛选不适用。"
        : screeningRecords.length > 0
          ? `${screeningRecords.filter((record) => record.status === "completed").length} 项选中或计划记录，${screeningRecords.filter((record) => record.status === "skipped").length} 项明确过滤。`
          : "事件已经触发，但安全 Trace 中缺少候选筛选记录。",
      records: screeningRecords,
    }),
    stage({
      phase: "agent_wakeup",
      status: triggerMissing
        ? "not_applicable"
        : !assistanceTraceComplete
          ? "missing"
          : stageStatusFromRecords(wakeupRecords),
      summary: triggerMissing
        ? "事件尚未触发，智能体唤醒不适用。"
        : wakeupRecords.length > 0
          ? `已记录 ${agentRefsFromRecords(wakeupRecords).length} 个核心智能体的持久任务、尝试或运行。`
          : "候选存在，但安全 Trace 中缺少核心智能体实际唤醒记录。",
      records: wakeupRecords,
    }),
    stage({
      phase: "permission_check",
      status: triggerMissing
        ? "not_applicable"
        : !assistanceTraceComplete
          ? "missing"
          : stageStatusFromRecords(permissionRecords),
      summary: triggerMissing
        ? "事件尚未触发，权限检查不适用。"
        : permissionRecords.length > 0
          ? "核心智能体只读取绑定主体或资源的授权投影，输出保持 advisory_only，失败不会写成权威事实。"
          : "核心智能体已被候选筛选，但缺少可复核的授权任务或运行记录。",
      records: permissionRecords,
    }),
    stage({
      phase: "agent_contribution",
      status: triggerMissing
        ? "not_applicable"
        : assistance.length === 0
          ? "missing"
          : !assistanceTraceComplete
            ? "missing"
            : stageStatusFromRecords(assistanceTraceRecords),
      summary: triggerMissing
        ? "事件尚未触发，智能体贡献不适用。"
        : assistance.length > 0
          ? assistance.map((item) => (
              `${item.agentId}：${item.proposal.output.summary}`
            )).join("；").slice(0, 2_000)
          : "核心智能体运行后尚未形成角色安全的建议贡献。",
      records: assistanceTraceRecords,
      events: assistanceEvents,
      agentRefs: agentRefsFromAssistance(assistance),
      evidenceIds: unique(assistance.flatMap((item) => (
        item.proposal.evidenceRefs
      ))),
    }),
    stage({
      phase: "student_decision",
      status: triggerMissing || assistance.length === 0
        ? "not_applicable"
        : decisions.length === 0
          ? "missing"
          : decisions.some((item) => item.decision === "accepted")
            ? "completed"
            : "rejected",
      summary: triggerMissing || assistance.length === 0
        ? "没有可供学生判断的智能体贡献，本阶段不适用。"
        : decisions.length > 0
          ? decisions.map((item) => (
              `${item.proposalId}：${item.decision}（${item.reason}）`
            )).join("；").slice(0, 2_000)
          : "智能体已贡献，但学生尚未形成采纳或拒绝的幂等记录。",
      events: decisions.map((item) => item.event),
      eventIds: decisions.map((item) => (
        flagshipCollaborationStudentDecisionRef(
          item.agentId,
          item.decision,
        )
      )),
    }),
    stage({
      phase: "teacher_review",
      status: triggerMissing || candidateId === null
        ? "not_applicable"
        : latestReview === undefined
          ? "missing"
          : latestReview.eventType === "candidate_event_rejected"
            ? "rejected"
            : "completed",
      summary: triggerMissing || candidateId === null
        ? "没有进入教师门的候选，本阶段不适用。"
        : latestReview?.summary
          ?? "旗舰候选已经形成，但教师尚未批准或驳回。",
      events: latestReview ? [latestReview] : [],
      eventIds: teacherApproved
        ? [FlagshipCollaborationTeacherApprovedRef]
        : [],
    }),
    stage({
      phase: "world_writeback",
      status: triggerMissing
        ? "not_applicable"
        : latestReview === undefined
          ? "missing"
        : latestReview?.eventType === "candidate_event_rejected"
          ? "not_applicable"
          : !worldWritebackCompleted
            ? "missing"
            : "completed",
      summary: triggerMissing
        ? "事件尚未触发，没有世界、任务或证据写回。"
        : latestReview === undefined
          ? "教师尚未复核候选，不得把后续世界、任务或证据事件视为已审查写回。"
        : latestReview?.eventType === "candidate_event_rejected"
          ? "教师已驳回候选，不产生世界写回。"
          : approvedWritebackEvents.length > 0
            ? `世界事件、任务 ${FlagshipCollaborationTaskId} 与 ${approvedEvidenceIds.length} 条可见证据可回指同一投影。`
            : "教师复核链存在，但尚未找到世界、任务或证据写回。",
      events: approvedWritebackEvents,
      eventIds: worldWritebackCompleted
        ? [FlagshipCollaborationWorldWritebackRef]
        : [],
      taskIds: worldWritebackCompleted
        ? [FlagshipCollaborationTaskId]
        : [],
      evidenceIds: [
        ...approvedEvidenceIds,
        ...(worldWritebackCompleted && approvedEvidenceIds.length > 0
          ? [FlagshipCollaborationEvidenceWritebackRef]
          : []),
      ],
    }),
  ];

  const failed = stages.some((item) => item.status === "failed");
  const hasMissing = stages.some((item) => item.status === "missing");
  const status: CollaborationReplay["status"] = triggerMissing
    ? "not_triggered"
    : failed
      ? "failed"
      : hasMissing
        ? "in_progress"
        : "completed";
  const technicalTraceRefs = unique(stages.flatMap((item) => (
    item.technicalTraceRefs
  )));

  return CollaborationReplaySchema.parse({
    schemaVersion: CollaborationReplaySchemaVersion,
    sessionId: input.projection.sessionId,
    scenarioId: input.projection.scenario.scenarioId,
    routeId: FlagshipCollaborationRouteId,
    representativeEventId: FlagshipCollaborationEventId,
    representativeTaskId: FlagshipCollaborationTaskId,
    stateVersion: input.projection.stateVersion,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    status,
    stages,
    technicalTraceRefs,
  });
}
