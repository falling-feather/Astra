import {
  StructuredWorldStageProjectionSchema,
  StructuredWorldStageSchemaVersion,
  type ActionSourceMode,
  type CurrentTaskAnchor,
  type Evidence,
  type Material,
  type RoleContract,
  type RoleInteractionOption,
  type RoleInteractionRecord,
  type ScenarioDynamicEvent,
  type ScenarioIntervention,
  type ScenarioPackage,
  type StudentScenarioExperienceGuide,
  type StructuredWorldCausalReplay,
  type StructuredWorldEventCard,
  type StructuredWorldHotspot,
  type StructuredWorldSignal,
  type StructuredWorldStageProjection,
  type StructuredWorldTaskState,
  type WorldEvent,
} from "@ronggang/contracts";

export const FlagshipCurrentTaskAnchorId =
  "flagship-task-rain-collaboration";

export interface StructuredWorldStageInput {
  scenario: ScenarioPackage;
  role: RoleContract;
  experienceGuide: StudentScenarioExperienceGuide | null;
  scenarioStatus: "ready" | "running" | "paused" | "review" | "completed";
  virtualTime: string;
  remainingMinutes: number;
  riskLevel: "low" | "medium" | "high";
  availableRoleInteractions: RoleInteractionOption[];
  roleInteractions: RoleInteractionRecord[];
  events: WorldEvent[];
  evidence: Evidence[];
  materials: Material[];
  activeInterventions: ScenarioIntervention[];
  fixedVisibleEvidenceIds: string[];
  teacherFinalized: boolean;
  currentExperienceTaskId?: string | null;
}

function responseEventFor(
  events: WorldEvent[],
  interactionId: string,
): WorldEvent | undefined {
  return events.findLast((event) => (
    event.eventType === "role_interaction_responded"
    && (
      event.payload.response as { interactionId?: unknown } | undefined
    )?.interactionId === interactionId
  ));
}

function recordedChoiceEvent(
  events: WorldEvent[],
  choiceRef: string,
): WorldEvent | undefined {
  return events.findLast((event) => (
    event.eventType === "experience_choice_recorded"
    && event.payload.choiceRef === choiceRef
  ));
}

function dynamicEventSource(
  dynamicEvent: ScenarioDynamicEvent,
  events: WorldEvent[],
  interactions: RoleInteractionRecord[],
): WorldEvent | undefined {
  const explicit = events.findLast((event) => (
    event.payload.dynamicEventId === dynamicEvent.dynamicEventId
    && (
      event.eventType === dynamicEvent.eventType
      || event.eventType === "experience_consequence_applied"
    )
  ));
  if (explicit) return explicit;

  if (dynamicEvent.triggerKind === "initial_state") {
    return events.findLast((event) => event.eventType === dynamicEvent.eventType);
  }

  if (dynamicEvent.triggerKind === "student_action") {
    const interaction = interactions.findLast((record) => (
      record.request.optionId === dynamicEvent.triggerRef
      && record.status === "responded"
      && record.response !== null
    ));
    const interactionEvent = interaction
      ? responseEventFor(events, interaction.request.interactionId)
      : undefined;
    const choiceEvent = recordedChoiceEvent(events, dynamicEvent.triggerRef);
    const triggerVersion = Math.max(
      interactionEvent?.stateVersion ?? 0,
      choiceEvent?.stateVersion ?? 0,
    );
    if (triggerVersion === 0) return undefined;
    return events.findLast((event) => (
      event.eventType === dynamicEvent.eventType
      && event.stateVersion >= triggerVersion
    ));
  }

  return events.findLast((event) => event.eventType === dynamicEvent.eventType);
}

function eventCardTone(
  dynamicEvent: ScenarioDynamicEvent,
  sourceEvent: WorldEvent,
  riskLevel: StructuredWorldStageInput["riskLevel"],
): StructuredWorldEventCard["tone"] {
  if (
    sourceEvent.eventType === "scenario_intervention_applied"
    || sourceEvent.eventType === "copyright_risk_flagged"
    || riskLevel === "high"
  ) {
    return "critical";
  }
  if (dynamicEvent.triggerKind === "agent_candidate") return "warning";
  if (
    sourceEvent.eventType === "world_fact_updated"
    || sourceEvent.eventType === "teacher_reviewed"
    || (
      dynamicEvent.approvalPolicyId !== null
      && sourceEvent.eventType === dynamicEvent.eventType
    )
  ) {
    return "success";
  }
  return "info";
}

function buildEventCards(
  input: StructuredWorldStageInput,
): StructuredWorldEventCard[] {
  const design = input.scenario.experienceDesign;
  if (!design) return [];
  const cards: StructuredWorldEventCard[] = [];
  for (const mapping of design.nodeMappings) {
    for (const dynamicEvent of mapping.dynamicEvents) {
      const sourceEvent = dynamicEventSource(
        dynamicEvent,
        input.events,
        input.roleInteractions,
      );
      if (!sourceEvent) continue;
      cards.push({
        dynamicEventId: dynamicEvent.dynamicEventId,
        eventType: dynamicEvent.eventType,
        triggerKind: dynamicEvent.triggerKind,
        title: sourceEvent.summary,
        worldChanges: [...dynamicEvent.worldChanges],
        affectedTaskIds: [...dynamicEvent.affectedTaskIds],
        sourceEventId: sourceEvent.eventId,
        rootActionId: sourceEvent.actionContext?.rootActionId ?? null,
        sourceMode: sourceEvent.actionContext?.sourceMode ?? null,
        tone: eventCardTone(dynamicEvent, sourceEvent, input.riskLevel),
      });
    }
  }
  return cards
    .toSorted((left, right) => {
      const leftVersion = input.events.find(
        (event) => event.eventId === left.sourceEventId,
      )?.stateVersion ?? 0;
      const rightVersion = input.events.find(
        (event) => event.eventId === right.sourceEventId,
      )?.stateVersion ?? 0;
      return rightVersion - leftVersion;
    })
    .slice(0, 5);
}

function hotspotStatus(
  choices: StructuredWorldHotspot["choices"],
  records: RoleInteractionRecord[],
): StructuredWorldHotspot["status"] {
  if (records.some((record) => record.status === "pending")) return "awaiting";
  if (choices.some((choice) => choice.enabled)) return "available";
  if (records.some((record) => record.status === "responded")) {
    return "responded";
  }
  if (choices.length === 0) return "observed";
  return "locked";
}

function buildHotspots(
  input: StructuredWorldStageInput,
): StructuredWorldHotspot[] {
  const guide = input.experienceGuide;
  if (!guide) return [];
  const optionById = new Map(
    input.availableRoleInteractions.map((option) => [option.optionId, option]),
  );
  const taskById = new Map(
    guide.currentNodeMapping?.operationTasks.map((task) => [task.taskId, task])
      ?? [],
  );
  const roleByActorId = new Map(
    input.scenario.roles.map((role) => [role.agentId, role]),
  );

  return guide.currentHotspots.map((hotspot) => {
    const opportunities =
      guide.currentNodeMapping?.worldOpportunities.filter(
        (opportunity) => opportunity.hotspotId === hotspot.hotspotId,
      ) ?? [];
    const choiceRefs = [...new Set([
      ...hotspot.interactionOptionIds,
      ...opportunities.flatMap((opportunity) => opportunity.choiceRefs),
    ])];
    const choices: StructuredWorldHotspot["choices"] = [];
    for (const choiceRef of choiceRefs) {
      const option = optionById.get(choiceRef);
      if (option) {
        choices.push({
          choiceRef,
          kind: "role_interaction",
          label: option.label,
          description: option.description,
          enabled: option.enabled,
          disabledReason: option.disabledReason,
          command: "send_role_interaction",
        });
        continue;
      }
      const task = taskById.get(choiceRef);
      if (!task) continue;
      const chosen = recordedChoiceEvent(input.events, choiceRef);
      choices.push({
        choiceRef,
        kind: "course_task",
        label: task.label,
        description: task.description,
        enabled: !chosen,
        disabledReason: chosen
          ? "该任务选择已写入权威事件流"
          : null,
        command: "record_experience_choice",
      });
    }
    const choiceSet = new Set(choiceRefs);
    const records = input.roleInteractions.filter((record) => (
      choiceSet.has(record.request.optionId)
      || record.request.toActorId === hotspot.targetActorId
    ));
    const latestRecord = records.at(-1);
    const targetRole = hotspot.targetActorId
      ? roleByActorId.get(hotspot.targetActorId)
      : undefined;
    return {
      hotspotId: hotspot.hotspotId,
      label: hotspot.label,
      description: hotspot.description,
      targetActorId: hotspot.targetActorId,
      targetDisplayName: targetRole?.displayName ?? null,
      targetRoleId: targetRole?.roleId ?? null,
      status: hotspotStatus(choices, records),
      relationship: latestRecord?.response?.stance ?? "unknown",
      latestResponse: latestRecord?.response?.content ?? null,
      consequencePreview:
        opportunities.map((item) => item.studentVisibleConsequence)[0] ?? null,
      choices,
    };
  });
}

function buildTasks(
  input: StructuredWorldStageInput,
  eventCards: StructuredWorldEventCard[],
): StructuredWorldTaskState[] {
  const mapping = input.experienceGuide?.currentNodeMapping;
  if (!mapping) return [];
  return mapping.operationTasks
    .filter((task) => !task.taskId.includes(":agent-decision:"))
    .map((task) => {
    const opportunities = mapping.worldOpportunities.filter((opportunity) => (
      opportunity.choiceRefs.includes(task.taskId)
      || opportunity.choiceRefs.some((choiceRef) => (
        input.roleInteractions.some(
          (record) => record.request.optionId === choiceRef,
        )
      ))
    ));
    const choiceRefs = new Set(
      opportunities.flatMap((opportunity) => opportunity.choiceRefs),
    );
    const records = input.roleInteractions.filter((record) => (
      choiceRefs.has(record.request.optionId)
    ));
    const choiceEvent = recordedChoiceEvent(input.events, task.taskId);
    const affectingCards = eventCards.filter((card) => (
      card.affectedTaskIds.includes(task.taskId)
    ));
    const sourceEventIds = [...new Set([
      ...(choiceEvent ? [choiceEvent.eventId] : []),
      ...records.flatMap((record) => {
        const responseEvent = record.response
          ? responseEventFor(input.events, record.request.interactionId)
          : undefined;
        return responseEvent ? [responseEvent.eventId] : [];
      }),
      ...affectingCards.map((card) => card.sourceEventId),
    ])];
    const completedInteractions = records.filter(
      (record) => record.status === "responded",
    ).length;
    const waitingForApproval = Boolean(
      choiceEvent?.payload.approvalPolicyId
      && !affectingCards.some((card) => (
        card.dynamicEventId === choiceEvent.payload.dynamicEventId
      )),
    );
    let status: StructuredWorldTaskState["status"] = "ready";
    let statusReason = "当前节点任务已开放";
    if (waitingForApproval) {
      status = "waiting";
      statusReason = "学生选择已留痕，等待教师门决定世界后果";
    } else if (
      choiceEvent
      || (
        affectingCards.length > 0
        && input.currentExperienceTaskId !== task.taskId
      )
    ) {
      status = "completed";
      statusReason = "任务选择与世界后果已进入同一事件链";
    } else if (records.some((record) => record.status === "pending")) {
      status = "in_progress";
      statusReason = "岗位互动已发起，等待 NPC 受控响应";
    } else if (completedInteractions > 0) {
      const requiredInteractions = [...choiceRefs].filter(
        (choiceRef) => input.availableRoleInteractions.some(
          (option) => option.optionId === choiceRef,
        ) || records.some(
          (record) => record.request.optionId === choiceRef,
        ),
      ).length;
      status = completedInteractions >= requiredInteractions
        ? "completed"
        : "in_progress";
      statusReason = status === "completed"
        ? "该岗位可见互动已经形成结果"
        : "部分问题已形成结果，仍有后续问题可执行";
    } else if (
      choiceRefs.size > 0
      && [...choiceRefs].every((choiceRef) => {
        const option = input.availableRoleInteractions.find(
          (candidate) => candidate.optionId === choiceRef,
        );
        return option ? !option.enabled : !taskByChoice(mapping, choiceRef);
      })
    ) {
      status = "blocked";
      statusReason = "前置条件尚未满足";
    }
    return {
      taskId: task.taskId,
      label: task.label,
      description: task.description,
      expectedOutput: task.expectedOutput,
      status,
      priority: affectingCards.some(
        (card) => card.tone === "critical" || card.tone === "warning",
      )
        ? "urgent"
        : "normal",
      statusReason,
      sourceEventIds,
    };
    });
}

export interface CurrentTaskAnchorInput {
  structuredWorld: StructuredWorldStageProjection | null;
  stateVersion: number;
  events: WorldEvent[];
  preferredTaskId?: string;
}

function taskAnchorRank(task: StructuredWorldTaskState): number {
  if (task.status === "in_progress") return 0;
  if (task.status === "waiting") return 1;
  if (task.status === "ready") return 2;
  if (task.status === "blocked") return 3;
  return 4;
}

function chooseCurrentTask(
  tasks: StructuredWorldTaskState[],
  preferredTaskId: string,
): StructuredWorldTaskState | undefined {
  const preferred = tasks.find((task) => task.taskId === preferredTaskId);
  if (preferred) return preferred;
  return tasks.toSorted((left, right) => (
    Number(right.priority === "urgent") - Number(left.priority === "urgent")
    || taskAnchorRank(left) - taskAnchorRank(right)
    || left.taskId.localeCompare(right.taskId)
  ))[0];
}

export function deriveCurrentTaskAnchor(
  input: CurrentTaskAnchorInput,
): CurrentTaskAnchor {
  const preferredTaskId = input.preferredTaskId
    ?? FlagshipCurrentTaskAnchorId;
  const task = chooseCurrentTask(
    input.structuredWorld?.tasks ?? [],
    preferredTaskId,
  );
  if (!task || !input.structuredWorld) {
    return {
      taskId: null,
      phase: "no_task",
      stateVersion: input.stateVersion,
      sourceEventId: null,
      priority: "none",
      worldTarget: null,
      latestFeedbackReason: "当前投影没有可锚定的岗位任务",
    };
  }

  const sourceEventIds = new Set(task.sourceEventIds);
  const latestSourceEvent = input.events
    .filter((event) => sourceEventIds.has(event.eventId))
    .toSorted((left, right) => (
      left.stateVersion - right.stateVersion
      || left.eventId.localeCompare(right.eventId)
    ))
    .at(-1);
  const phase = task.taskId === preferredTaskId
      && task.status === "ready"
      && task.sourceEventIds.length === 0
    ? "not_triggered" as const
    : task.status;

  return {
    taskId: task.taskId,
    phase,
    stateVersion: input.stateVersion,
    sourceEventId: latestSourceEvent?.eventId ?? null,
    priority: task.priority,
    worldTarget: {
      mode: "world_interaction",
      sceneId: input.structuredWorld.scene.sceneId,
      taskId: task.taskId,
    },
    latestFeedbackReason: latestSourceEvent
      ? `${latestSourceEvent.summary}；${task.statusReason}`
      : task.statusReason,
  };
}

function taskByChoice(
  mapping: NonNullable<StudentScenarioExperienceGuide["currentNodeMapping"]>,
  choiceRef: string,
): boolean {
  return mapping.operationTasks.some((task) => task.taskId === choiceRef);
}

function sourceForEvidence(
  evidence: Evidence,
  events: WorldEvent[],
): WorldEvent | undefined {
  const direct = events.findLast((event) => (
    evidence.eventRefs.includes(event.eventId)
  ));
  if (direct) return direct;
  return events.findLast((event) => (
    event.eventType === "evidence_recorded"
    && (
      event.payload.evidence as { evidenceId?: unknown } | undefined
    )?.evidenceId === evidence.evidenceId
  ));
}

function buildSignals(
  input: StructuredWorldStageInput,
  eventCards: StructuredWorldEventCard[],
): StructuredWorldSignal[] {
  const signals: StructuredWorldSignal[] = [];
  for (const record of input.roleInteractions) {
    if (!record.response) continue;
    const event = responseEventFor(
      input.events,
      record.request.interactionId,
    );
    const response = record.response;
    const kind: StructuredWorldSignal["kind"] =
      response.act === "commit"
        ? "commitment"
        : response.act === "refuse" || response.stance === "restricted"
          ? "constraint"
          : response.act === "tool_request"
            ? "material"
            : "clue";
    signals.push({
      signalId: `interaction:${response.responseId}`,
      kind,
      label: response.commitment?.summary
        ?? `${response.fromActorId} 的岗位响应`,
      detail: response.content,
      sourceRef: record.request.optionId,
      sourceEventId: event?.eventId ?? null,
      rootActionId: event?.actionContext?.rootActionId ?? null,
      sourceMode: event?.actionContext?.sourceMode ?? null,
    });
  }
  for (const card of eventCards) {
    signals.push({
      signalId: `consequence:${card.dynamicEventId}:${card.sourceEventId}`,
      kind: card.tone === "critical" || card.tone === "warning"
        ? "risk"
        : "consequence",
      label: card.title,
      detail: card.worldChanges.join("；"),
      sourceRef: card.dynamicEventId,
      sourceEventId: card.sourceEventId,
      rootActionId: card.rootActionId,
      sourceMode: card.sourceMode,
    });
  }
  for (const material of input.materials.slice(-2)) {
    const event = input.events.findLast((candidate) => (
      candidate.eventType === "material_registered"
      && (
        candidate.payload.material as { materialId?: unknown } | undefined
      )?.materialId === material.materialId
    ));
    signals.push({
      signalId: `material:${material.materialId}:${material.version}`,
      kind: "material",
      label: material.title,
      detail: `${material.mediaType} · 固定版本 ${material.version}`,
      sourceRef: material.materialId,
      sourceEventId: event?.eventId ?? null,
      rootActionId: event?.actionContext?.rootActionId ?? null,
      sourceMode: event?.actionContext?.sourceMode ?? null,
    });
  }
  for (const evidence of input.evidence.slice(-4)) {
    const event = sourceForEvidence(evidence, input.events);
    signals.push({
      signalId: `evidence:${evidence.evidenceId}`,
      kind: "capability_evidence",
      label: evidence.action,
      detail: evidence.basis,
      sourceRef: evidence.evidenceId,
      sourceEventId: event?.eventId ?? null,
      rootActionId: event?.actionContext?.rootActionId ?? null,
      sourceMode: event?.actionContext?.sourceMode ?? null,
    });
  }
  const seen = new Set<string>();
  return signals
    .toReversed()
    .filter((signal) => {
      if (seen.has(signal.signalId)) return false;
      seen.add(signal.signalId);
      return true;
    })
    .slice(0, 12);
}

function buildCausalReplay(
  input: StructuredWorldStageInput,
): StructuredWorldCausalReplay[] {
  const groups = new Map<string, WorldEvent[]>();
  for (const event of input.events) {
    const context = event.actionContext;
    if (!context) continue;
    const events = groups.get(context.rootActionId) ?? [];
    events.push(event);
    groups.set(context.rootActionId, events);
  }
  const replay: StructuredWorldCausalReplay[] = [];
  for (const [rootActionId, events] of groups) {
    const first = events[0];
    const last = events.at(-1);
    const context = first?.actionContext;
    if (!first || !last || !context) continue;
    const eventIdSet = new Set(events.map((event) => event.eventId));
    const evidenceIds = input.evidence
      .filter((evidence) => (
        evidence.eventRefs.some((eventId) => eventIdSet.has(eventId))
        || events.some((event) => (
          event.eventType === "evidence_recorded"
          && (
            event.payload.evidence as { evidenceId?: unknown } | undefined
          )?.evidenceId === evidence.evidenceId
        ))
      ))
      .map((evidence) => evidence.evidenceId);
    replay.push({
      rootActionId,
      sourceMode: context.sourceMode,
      commandName: context.commandName,
      firstStateVersion: first.stateVersion,
      lastStateVersion: last.stateVersion,
      eventIds: events.map((event) => event.eventId),
      eventTypes: events.map((event) => event.eventType),
      evidenceIds,
      summary: last.summary,
    });
  }
  return replay
    .toSorted((left, right) => (
      right.lastStateVersion - left.lastStateVersion
    ))
    .slice(0, 8);
}

function phaseFor(
  input: StructuredWorldStageInput,
  eventCards: StructuredWorldEventCard[],
): StructuredWorldStageProjection["scene"]["phase"] {
  if (input.scenarioStatus === "completed") return "completed";
  if (input.scenarioStatus === "review") return "review";
  if (input.scenarioStatus === "paused") return "paused";
  if (
    input.activeInterventions.length > 0
    || eventCards.some((card) => (
      card.eventType === "scenario_intervention_applied"
      || card.tone === "critical"
    ))
  ) {
    return "incident";
  }
  return "active";
}

export function buildStructuredWorldStage(
  input: StructuredWorldStageInput,
): StructuredWorldStageProjection | null {
  const guide = input.experienceGuide;
  const scene = guide?.currentScenes[0];
  if (!guide || !scene || !input.scenario.experienceDesign) return null;
  const eventCards = buildEventCards(input);
  const causalReplay = buildCausalReplay(input);
  const latestChanges = eventCards[0]?.worldChanges.slice(0, 3) ?? [];
  const sourceModes = [...new Set(
    causalReplay.map((entry) => entry.sourceMode),
  )] as ActionSourceMode[];
  const caseState = input.teacherFinalized
    ? "teacher_final" as const
    : input.fixedVisibleEvidenceIds.length > 0
      ? "fixed" as const
      : "collecting" as const;

  return StructuredWorldStageProjectionSchema.parse({
    schemaVersion: StructuredWorldStageSchemaVersion,
    scene: {
      sceneId: scene.sceneId,
      title: scene.title,
      description: scene.description,
      visualMode: scene.visualMode,
      phase: phaseFor(input, eventCards),
      riskLevel: input.riskLevel,
      stateTags: [
        `${input.virtualTime} · 剩余 ${input.remainingMinutes} 分钟`,
        input.role.displayName,
        ...latestChanges,
      ].slice(0, 12),
    },
    hotspots: buildHotspots(input),
    tasks: buildTasks(input, eventCards),
    eventCards,
    signals: buildSignals(input, eventCards),
    causalReplay,
    evidenceContinuity: {
      caseState,
      visibleEvidenceCount: input.evidence.length,
      fixedVisibleEvidenceCount: input.fixedVisibleEvidenceIds.length,
      sourceModes,
      teacherFinalRequired: true,
    },
  });
}
