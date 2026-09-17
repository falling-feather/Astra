import {
  AdminCollaborationEpisodeSchema,
  AgentAssistanceProposalSchema,
  AgentCollaborationEpisodeSchema,
  AgentCollaborationEpisodeSchemaVersion,
  AgentContributionDecisionEventPayloadSchema,
  AgentTopologyManifestSchema,
  CrossCourseAgentRuleManifestSchema,
  CandidateEventSchema,
  CourseReleaseSchema,
  EvidenceSchema,
  StudentCollaborationEpisodeSchema,
  TeacherCollaborationEpisodeSchema,
  courseReleaseReferenceOf,
  type ActorKind,
  type AdminCollaborationEpisode,
  type AgentCollaborationEpisode,
  type AgentContributionSummary,
  type AgentTopologyManifest,
  type AffectedAgentDecision,
  type CandidateEvent,
  type CollaborationAuthorityWriteback,
  type CollaborationEventSummary,
  type CollaborationStudentDecision,
  type CollaborationTeacherGate,
  type CourseRelease,
  type CrossCourseAgentRuleChapter,
  type CrossCourseAgentRuleManifest,
  type ModelProviderHealth,
  type ScenarioPackageRef,
  type StudentAgentSuggestion,
  type StudentCollaborationEpisode,
  type TeacherCollaborationEpisode,
  type TraceRecord,
  type WorldEvent,
} from "@ronggang/contracts";

export type CollaborationEpisodeAudience = "student" | "teacher" | "admin";

export interface CollaborationEpisodeProjectionSnapshot {
  sessionId: string;
  scenarioId: string;
  stateVersion: number;
  currentNodeId: string;
  currentSourceEventId: string | null;
  scenarioReleaseRef: ScenarioPackageRef;
}

export interface BuildCollaborationEpisodeInput {
  audience: CollaborationEpisodeAudience;
  projection: CollaborationEpisodeProjectionSnapshot;
  courseRelease: CourseRelease;
  events: readonly WorldEvent[];
  adviceDecisionAvailable: boolean;
  completionCandidateRef?: {
    actionId: string;
    dynamicEventId: string;
    eventType: CandidateEvent["eventType"];
    approvalPolicyId: string;
  } | null;
  pendingCandidateIds?: readonly string[];
  traceRecords?: readonly TraceRecord[];
  actorKinds?: Readonly<Record<string, ActorKind>>;
  modelHealth: ModelProviderHealth;
  generatedAt?: string;
}

const businessTriggerTypes = new Set<WorldEvent["eventType"]>([
  "session_started",
  "node_activated",
  "material_observed",
  "production_artifact_created",
  "artifact_revision_saved",
  "governance_review_requested",
  "governance_reviewed",
  "world_fact_confirmed",
  "world_fact_updated",
  "role_interaction_requested",
  "role_interaction_responded",
  "agent_contribution_decided",
  "candidate_event_proposed",
  "candidate_event_approved",
  "candidate_event_rejected",
  "verification_requested",
  "evidence_recorded",
  "copyright_risk_flagged",
  "publication_paused",
  "submission_created",
  "evaluation_case_opened",
  "teacher_reviewed",
]);

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function evidenceRefsOf(event: WorldEvent): string[] {
  if (event.eventType === "evidence_recorded") {
    const evidence = EvidenceSchema.safeParse(event.payload.evidence);
    if (evidence.success) return [evidence.data.evidenceId];
  }
  if (event.eventType === "agent_assistance_recorded") {
    const proposal = AgentAssistanceProposalSchema.safeParse(
      event.payload.proposal,
    );
    if (proposal.success) return proposal.data.evidenceRefs;
  }
  return [];
}

function eventSource(
  event: WorldEvent,
  actorKinds: Readonly<Record<string, ActorKind>>,
): CollaborationEventSummary["source"] {
  const actorKind = actorKinds[event.actorId];
  if (actorKind === "student") return "student_action";
  if (actorKind === "teacher") return "teacher_action";
  if (event.actorId === "system" && event.eventType === "session_started") {
    return "system_time";
  }
  return "world";
}

function eventSummary(
  event: WorldEvent,
  actorKinds: Readonly<Record<string, ActorKind>>,
): CollaborationEventSummary {
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    title: event.summary.slice(0, 240),
    occurredAt: event.timestamp,
    source: eventSource(event, actorKinds),
    evidenceRefs: evidenceRefsOf(event),
  };
}

function findTrigger(input: BuildCollaborationEpisodeInput): WorldEvent | null {
  // Once a student has decided the chapter's single suggestion, preserve the
  // event that originally issued that suggestion. The decision itself creates
  // a newer evidence event, but that event must not silently mint a different
  // suggestion ID for the same immutable chapter decision.
  const decision = input.events.toReversed().find((event) => {
    const choiceRef = typeof event.payload.choiceRef === "string"
      ? event.payload.choiceRef
      : "";
    return event.eventType === "experience_choice_recorded"
      && choiceRef.startsWith(
        `${input.projection.currentNodeId}:agent-decision:`,
      );
  });
  const suggestionCausationId = decision?.actionContext?.causationId ?? "";
  if (suggestionCausationId.endsWith(":suggestion")) {
    const withoutSuffix = suggestionCausationId.slice(
      0,
      -":suggestion".length,
    );
    const agentSeparator = withoutSuffix.lastIndexOf(":");
    const sourceEventId = agentSeparator > 0
      ? withoutSuffix.slice(0, agentSeparator)
      : "";
    const decidedTrigger = input.events.find((event) => (
      event.eventId === sourceEventId
      && businessTriggerTypes.has(event.eventType)
    ));
    if (decidedTrigger) return decidedTrigger;
  }
  if (input.projection.currentSourceEventId) {
    const anchored = input.events.find((event) => (
      event.eventId === input.projection.currentSourceEventId
      && businessTriggerTypes.has(event.eventType)
    ));
    if (anchored) return anchored;
  }
  return input.events.toReversed().find((event) => (
    businessTriggerTypes.has(event.eventType)
    && event.eventType !== "candidate_event_approved"
    && event.eventType !== "candidate_event_rejected"
    && event.eventType !== "teacher_reviewed"
  )) ?? null;
}

function sameScenarioRelease(
  expected: CourseRelease["scenarioReleaseRef"],
  actual: ScenarioPackageRef,
): boolean {
  return expected.scenarioId === actual.scenarioId
    && expected.version === actual.version
    && expected.contentHash === actual.contentHash;
}

function evidenceBasis(chapter: CourseRelease["chapters"][number]): string[] {
  return chapter.publicSourceRefs.slice(0, 2);
}

interface SelectedAgentDecisionSet {
  decisions: AffectedAgentDecision[];
  selectedAgentIdsInRankOrder: string[];
}

function selectedAgentDecisions(input: {
  manifest: AgentTopologyManifest;
  chapter: CourseRelease["chapters"][number];
  trigger: WorldEvent;
  ruleChapter?: CrossCourseAgentRuleChapter | null;
}): SelectedAgentDecisionSet {
  if (input.ruleChapter) {
    const affectedIds = new Set(input.ruleChapter.resolvedAffectedAgentIds);
    const candidateIds = new Set(input.ruleChapter.resolvedCandidateAgentIds);
    const eligibleIds = new Set(
      input.manifest.agents
        .filter((agent) => (
          candidateIds.has(agent.agentId)
          && agent.status === "active"
          && (
            affectedIds.has(agent.agentId)
            || agent.subscribedEventTypes.includes(input.trigger.eventType)
          )
        ))
        .map((agent) => agent.agentId),
    );
    const selectedAgentIdsInRankOrder = input.manifest.agents
      .filter((agent) => eligibleIds.has(agent.agentId))
      .toSorted((left, right) => (
          Number(affectedIds.has(right.agentId)) - Number(affectedIds.has(left.agentId))
          || Number(right.subscribedEventTypes.includes(input.trigger.eventType))
            - Number(left.subscribedEventTypes.includes(input.trigger.eventType))
          || left.agentId.localeCompare(right.agentId)
      ))
      .slice(0, input.ruleChapter.maximumSelectedAgents)
      .map((agent) => agent.agentId);
    const selectedIds = new Set(selectedAgentIdsInRankOrder);
    const evidenceRefs = evidenceBasis(input.chapter);
    const decisions = input.manifest.agents.map((agent) => {
      const affected = affectedIds.has(agent.agentId);
      const candidate = candidateIds.has(agent.agentId);
      const subscribed = agent.subscribedEventTypes.includes(input.trigger.eventType);
      const selected = selectedIds.has(agent.agentId);
      const reasonCode = selected
        ? affected
          ? "affected_object_match" as const
          : "event_subscription_match" as const
        : candidate && agent.status !== "active"
          ? "disabled" as const
          : candidate && (affected || subscribed)
            ? "budget_limit" as const
            : "not_affected" as const;
      return {
        agent: {
          agentId: agent.agentId,
          templateId: agent.templateId,
          instanceId: null,
          groupId: agent.groupId,
          title: agent.title,
        },
        decision: selected ? "selected" as const : "skipped" as const,
        reasonCode,
        reason: selected
          ? affected
            ? `${agent.title} 位于课程冻结的受影响集合内，并通过本节最大唤醒数量门。`
            : `${agent.title} 位于课程冻结候选集合内，并真实订阅当前事件，按最大唤醒数量门参与本轮。`
          : reasonCode === "disabled"
            ? `${agent.title} 虽在课程候选集合内，但当前拓扑状态不可运行。`
            : reasonCode === "budget_limit"
              ? `${agent.title} 位于课程候选集合内，但本节已达到冻结的最大唤醒数量。`
              : candidate
                ? `${agent.title} 虽在课程候选集合内，但既不属于受影响集合也未订阅当前事件，本轮不唤醒。`
                : `${agent.title} 不在本节冻结的候选集合内，本轮不唤醒。`,
        evidenceRefs: selected ? evidenceRefs : [],
      };
    });
    return { decisions, selectedAgentIdsInRankOrder };
  }
  const candidateIds = new Set(input.chapter.candidateAgentIds);
  const ranked = input.manifest.agents.map((agent, order) => ({
    agent,
    order,
    candidateMatch: candidateIds.has(agent.agentId),
    subscriptionMatch: agent.subscribedEventTypes.includes(
      input.trigger.eventType,
    ),
  })).sort((left, right) => (
    Number(right.candidateMatch) - Number(left.candidateMatch)
    || Number(right.subscriptionMatch) - Number(left.subscriptionMatch)
    || left.order - right.order
  ));
  const selectedIds = new Set(
    ranked.filter((item) => item.candidateMatch || item.subscriptionMatch)
      .slice(0, 3)
      .map((item) => item.agent.agentId),
  );
  if (selectedIds.size === 0) {
    const fallback = input.manifest.agents.find((agent) => (
      agent.agentId === "agent-teaching"
    ));
    if (fallback) selectedIds.add(fallback.agentId);
  }
  const evidenceRefs = evidenceBasis(input.chapter);
  const decisions = input.manifest.agents.map((agent) => {
    const selected = selectedIds.has(agent.agentId);
    const candidateMatch = candidateIds.has(agent.agentId);
    return {
      agent: {
        agentId: agent.agentId,
        templateId: agent.templateId,
        instanceId: null,
        groupId: agent.groupId,
        title: agent.title,
      },
      decision: selected ? "selected" : "skipped",
      reasonCode: selected
        ? candidateMatch
          ? "affected_object_match"
          : "event_subscription_match"
        : "not_affected",
      reason: selected
        ? candidateMatch
          ? `当前小节已声明 ${agent.title} 为候选，且事件影响其职责对象。`
          : `${agent.title} 订阅 ${input.trigger.eventType}，本轮只读参与。`
        : `${agent.title} 与当前小节的受影响对象或事件订阅不匹配，本轮不唤醒。`,
      evidenceRefs: selected ? evidenceRefs : [],
    } satisfies AffectedAgentDecision;
  });
  const selectedAgentIdsInRankOrder = ranked
    .filter((item) => selectedIds.has(item.agent.agentId))
    .map((item) => item.agent.agentId);
  return { decisions, selectedAgentIdsInRankOrder };
}

function contributionOf(input: {
  decision: AffectedAgentDecision;
  chapter: CourseRelease["chapters"][number];
  trigger: WorldEvent;
}): AgentContributionSummary {
  const requirement = input.chapter.evidenceRequirements[0]
    ?? "补齐当前任务要求的公开来源与证据";
  return {
    contributionId: `${input.trigger.eventId}:${input.decision.agent.agentId}:contribution`,
    agent: input.decision.agent,
    summary: `先完成“${requirement}”，再执行当前主行动；该建议不会自动写入世界事实。`,
    rationale: `${input.decision.agent.title}只依据冻结课程小节、当前事件与公开来源形成只读建议，权威后果仍由学生选择和教师门决定。`,
    evidenceRefs: evidenceBasis(input.chapter),
    riskLevel: input.chapter.teacherGateIds.length > 0 ? "medium" : "low",
    status: "ready",
  };
}

function suggestionOf(
  contribution: AgentContributionSummary,
): StudentAgentSuggestion {
  return {
    suggestionId: contribution.contributionId.replace(
      /:contribution$/u,
      ":suggestion",
    ),
    agent: {
      agentId: contribution.agent.agentId,
      groupId: contribution.agent.groupId,
      title: contribution.agent.title,
    },
    summary: contribution.summary,
    rationale: contribution.rationale,
    evidenceRefs: contribution.evidenceRefs,
    riskLevel: contribution.riskLevel,
    allowedDecisions: ["accept", "request_evidence", "reject"],
  };
}

function latestStudentDecision(
  events: readonly WorldEvent[],
  fallbackEvidenceRefs: readonly string[],
  chapterId: string,
): CollaborationStudentDecision | null {
  for (const event of events.toReversed()) {
    if (event.eventType === "experience_choice_recorded") {
      const choiceRef = typeof event.payload.choiceRef === "string"
        ? event.payload.choiceRef
        : "";
      if (!choiceRef.startsWith(`${chapterId}:agent-decision:`)) {
        continue;
      }
      const decision = choiceRef.match(
        /:agent-decision:(accept|request_evidence|reject)$/u,
      )?.[1] as CollaborationStudentDecision["decision"] | undefined;
      if (!decision) continue;
      const reason = decision === "accept"
        ? "已核对当前来源与任务边界，采纳本轮唯一建议。"
        : decision === "request_evidence"
          ? "建议方向可能有效，但需要先补齐来源、版本或现场证据。"
          : "建议与当前证据、岗位边界或任务目标不匹配。";
      return {
        decision,
        reason,
        decidedAt: event.timestamp,
        evidenceRefs: [...fallbackEvidenceRefs],
      };
    }
    if (event.eventType !== "agent_contribution_decided") continue;
    const parsed = AgentContributionDecisionEventPayloadSchema.safeParse(
      event.payload,
    );
    if (!parsed.success) continue;
    const evidenceRefs = parsed.data.decision.basisRefs
      .filter((ref) => ref.kind === "evidence")
      .map((ref) => ref.refId);
    return {
      decision: parsed.data.decision.decision === "accepted"
        ? "accept"
        : "reject",
      reason: parsed.data.decision.studentReason,
      decidedAt: event.timestamp,
      evidenceRefs: evidenceRefs.length > 0
        ? unique(evidenceRefs)
        : [...fallbackEvidenceRefs],
    };
  }
  return null;
}

interface GateResult {
  gate: CollaborationTeacherGate | null;
  reviewEvent: WorldEvent | null;
}

function teacherGateCandidates(input: {
  events: readonly WorldEvent[];
  chapter: CourseRelease["chapters"][number];
  trigger: WorldEvent;
  completionCandidateRef: NonNullable<
    BuildCollaborationEpisodeInput["completionCandidateRef"]
  > | null;
}): CandidateEvent[] {
  const completionRef = input.completionCandidateRef;
  if (!completionRef) return [];
  const candidates = new Map<string, CandidateEvent>();
  for (const event of input.events) {
    if (
      event.eventType !== "candidate_event_proposed"
      || event.stateVersion < input.trigger.stateVersion
    ) continue;
    const parsed = CandidateEventSchema.safeParse(event.payload.candidate);
    if (!parsed.success) continue;
    const candidate = parsed.data;
    const sourceChoiceRef = typeof event.payload.sourceChoiceRef === "string"
      ? event.payload.sourceChoiceRef
      : null;
    const dynamicEventId = typeof candidate.payload.dynamicEventId === "string"
      ? candidate.payload.dynamicEventId
      : null;
    if (
      sourceChoiceRef !== completionRef.actionId
      || !candidate.sourceRefs.includes(completionRef.actionId)
      || dynamicEventId !== completionRef.dynamicEventId
      || candidate.eventType !== completionRef.eventType
      || candidate.approvalPolicyId !== completionRef.approvalPolicyId
    ) continue;
    candidates.set(candidate.candidateId, candidate);
  }
  return [...candidates.values()];
}

/**
 * Resolves the current chapter's pending teacher-gate candidate without
 * exposing its private candidate reference to the browser. The frozen chapter
 * action/dynamic-event refs are authoritative; the suggestion trigger remains
 * stable even when the final task is committed by a later root action.
 */
export function findPendingTeacherGateCandidate(input: {
  events: readonly WorldEvent[];
  chapter: CourseRelease["chapters"][number];
  trigger: WorldEvent;
  completionCandidateRef: NonNullable<
    BuildCollaborationEpisodeInput["completionCandidateRef"]
  > | null;
  pendingCandidateIds: ReadonlySet<string>;
}): CandidateEvent | null {
  return teacherGateCandidates(input).toReversed().find((candidate) => (
    input.pendingCandidateIds.has(candidate.candidateId)
  )) ?? null;
}

function teacherGateOf(input: {
  events: readonly WorldEvent[];
  chapter: CourseRelease["chapters"][number];
  trigger: WorldEvent;
  studentDecision: CollaborationStudentDecision | null;
  completionCandidateRef: NonNullable<
    BuildCollaborationEpisodeInput["completionCandidateRef"]
  > | null;
  pendingCandidateIds: ReadonlySet<string>;
}): GateResult {
  if (input.chapter.teacherGateIds.length === 0) {
    return {
      gate: input.studentDecision ? {
        gateId: `${input.chapter.chapterId}:no-teacher-gate`,
        status: "not_required",
        summary: "本小节无需教师门，学生决定仍保留在因果链中。",
        reviewedAt: null,
      } : null,
      reviewEvent: null,
    };
  }
  const relevantCandidateIds = new Set(teacherGateCandidates(input).map(
    (candidate) => candidate.candidateId,
  ));
  const reviewEvent = input.events.toReversed().find((event) => {
    if (
      event.stateVersion < input.trigger.stateVersion
      || (
        event.eventType !== "candidate_event_approved"
        && event.eventType !== "candidate_event_rejected"
      )
    ) return false;
    const candidateId = typeof event.payload.candidateId === "string"
      ? event.payload.candidateId
      : null;
    return candidateId !== null && relevantCandidateIds.has(candidateId);
  }) ?? null;
  if (reviewEvent) {
    const reviewReason = typeof reviewEvent.payload.reason === "string"
      ? reviewEvent.payload.reason.trim()
      : "";
    return {
      gate: {
        gateId: input.chapter.teacherGateIds[0]!,
        status: reviewEvent.eventType === "candidate_event_approved"
          ? "approved"
          : "rejected",
        summary: (reviewReason
          ? `${reviewEvent.summary}：${reviewReason}`
          : reviewEvent.summary).slice(0, 1_000),
        reviewedAt: reviewEvent.timestamp,
      },
      reviewEvent,
    };
  }
  const hasPendingCompletionCandidate = [...relevantCandidateIds].some(
    (candidateId) => input.pendingCandidateIds.has(candidateId),
  );
  return {
    gate: input.studentDecision && hasPendingCompletionCandidate ? {
      gateId: input.chapter.teacherGateIds[0]!,
      status: "pending",
      summary: "学生已处理建议，等待教师核对证据与世界后果。",
      reviewedAt: null,
    } : null,
    reviewEvent: null,
  };
}

function authorityWritebackOf(input: {
  events: readonly WorldEvent[];
  traceRecords: readonly TraceRecord[];
  reviewEvent: WorldEvent | null;
  gate: CollaborationTeacherGate | null;
}): CollaborationAuthorityWriteback | null {
  if (!input.gate || !["approved", "rejected"].includes(input.gate.status)) {
    return null;
  }
  if (input.gate.status === "rejected" || !input.reviewEvent) {
    return {
      occurred: false,
      summary: "教师已驳回本轮候选，没有发生世界、任务或证据写回。",
      worldEventIds: [],
      taskIds: [],
      evidenceIds: [],
      consequences: [],
    };
  }
  const writebackEvents = input.events.filter((event) => (
    event.stateVersion > input.reviewEvent!.stateVersion
    && (
      event.correlationId === input.reviewEvent!.correlationId
      || (
        event.actionContext !== null
        && input.reviewEvent!.actionContext !== null
        && event.actionContext.rootActionId
          === input.reviewEvent!.actionContext.rootActionId
      )
    )
    && [
      "node_activated",
      "world_fact_confirmed",
      "world_fact_updated",
      "evidence_recorded",
      "copyright_risk_flagged",
      "publication_paused",
      "scenario_intervention_applied",
    ].includes(event.eventType)
  ));
  const evidenceIds = unique(writebackEvents.flatMap(evidenceRefsOf));
  const writebackEventIds = new Set(
    writebackEvents.map((event) => event.eventId),
  );
  const taskIds = unique(input.traceRecords.flatMap((record) => (
    record.taskId
    && record.eventId !== null
    && writebackEventIds.has(record.eventId)
      ? [record.taskId]
      : []
  )));
  const worldEventIds = unique(writebackEvents.map((event) => event.eventId));
  const occurred = worldEventIds.length + taskIds.length + evidenceIds.length > 0;
  return {
    occurred,
    summary: occurred
      ? "教师批准后，服务端在同一因果链中找到权威世界、任务或证据写回。"
      : "教师已批准，但当前尚未观察到权威世界、任务或证据写回。",
    worldEventIds,
    taskIds,
    evidenceIds,
    consequences: writebackEvents.map((event) => (
      event.summary.slice(0, 500)
    )).slice(0, 16),
  };
}

function executionMode(
  health: ModelProviderHealth,
): AdminCollaborationEpisode["execution"]["mode"] {
  if (health.mode === "live" && health.available) return "live";
  if (health.mode === "mock" && health.available) return "deterministic_demo";
  return "degraded";
}

export class AgentCollaborationEpisodeService {
  readonly #manifest: AgentTopologyManifest;
  readonly #ruleManifest: CrossCourseAgentRuleManifest | null;

  constructor(
    manifest: AgentTopologyManifest,
    ruleManifest?: CrossCourseAgentRuleManifest | null,
  ) {
    this.#manifest = AgentTopologyManifestSchema.parse(manifest);
    this.#ruleManifest = ruleManifest
      ? CrossCourseAgentRuleManifestSchema.parse(ruleManifest)
      : null;
  }

  manifest(): AgentTopologyManifest {
    return structuredClone(this.#manifest);
  }

  build(rawInput: BuildCollaborationEpisodeInput): AgentCollaborationEpisode {
    const input = {
      ...rawInput,
      courseRelease: CourseReleaseSchema.parse(rawInput.courseRelease),
      traceRecords: rawInput.traceRecords ?? [],
      actorKinds: rawInput.actorKinds ?? {},
      generatedAt: rawInput.generatedAt ?? new Date().toISOString(),
    };
    const trigger = findTrigger(input);
    const frozenRef = courseReleaseReferenceOf(input.courseRelease);
    const ruleCourse = this.#ruleManifest?.courses.find((course) => (
      course.courseReleaseRef.courseId === frozenRef.courseId
    )) ?? null;
    if (
      ruleCourse
      && (
        ruleCourse.courseReleaseRef.releaseId !== frozenRef.releaseId
        || ruleCourse.courseReleaseRef.version !== frozenRef.version
        || ruleCourse.courseReleaseRef.contentHash !== frozenRef.contentHash
      )
    ) {
      return this.#failedDrift(input, trigger);
    }
    if (!sameScenarioRelease(
      input.courseRelease.scenarioReleaseRef,
      input.projection.scenarioReleaseRef,
    )) {
      return this.#failedDrift(input, trigger);
    }
    if (!trigger) return this.#waiting(input, frozenRef);
    const chapter = input.courseRelease.chapters.find((candidate) => (
      candidate.chapterId === input.projection.currentNodeId
    )) ?? input.courseRelease.chapters[0]!;
    const ruleChapter = ruleCourse?.chapters.find((candidate) => (
      candidate.chapterId === chapter.chapterId
    )) ?? null;
    if (ruleCourse && !ruleChapter) {
      return this.#failedDrift(input, trigger);
    }
    const agentSelection = selectedAgentDecisions({
      manifest: this.#manifest,
      chapter,
      trigger,
      ruleChapter,
    });
    const affectedAgents = agentSelection.decisions;
    const decisionsByAgentId = new Map(affectedAgents.map((decision) => [
      decision.agent.agentId,
      decision,
    ]));
    const contributions = agentSelection.selectedAgentIdsInRankOrder
      .map((agentId) => decisionsByAgentId.get(agentId) ?? null)
      .filter((decision): decision is AffectedAgentDecision => (
        decision?.decision === "selected"
      ))
      .map((decision) => contributionOf({ decision, chapter, trigger }));
    const studentDecision = latestStudentDecision(
      input.events,
      evidenceBasis(chapter),
      chapter.chapterId,
    );
    const { gate, reviewEvent } = teacherGateOf({
      events: input.events,
      chapter,
      trigger,
      studentDecision,
      completionCandidateRef: input.completionCandidateRef ?? null,
      pendingCandidateIds: new Set(input.pendingCandidateIds ?? []),
    });
    const writeback = authorityWritebackOf({
      events: input.events,
      traceRecords: input.traceRecords,
      reviewEvent,
      gate,
    });
    if (input.audience === "student") {
      const suggestion = (
        input.adviceDecisionAvailable === true
        || studentDecision !== null
      ) && contributions[0]
        ? suggestionOf(contributions[0])
        : null;
      if (!suggestion && studentDecision === null && gate === null) {
        return this.#waiting(input, frozenRef);
      }
      const status: StudentCollaborationEpisode["status"] = gate?.status === "approved"
        || gate?.status === "rejected"
        ? "completed"
        : studentDecision
          ? "decided"
          : suggestion
            ? "suggestion_ready"
            : "failed";
      return StudentCollaborationEpisodeSchema.parse({
        schemaVersion: AgentCollaborationEpisodeSchemaVersion,
        sessionId: input.projection.sessionId,
        scenarioId: input.projection.scenarioId,
        courseReleaseRef: frozenRef,
        stateVersion: input.projection.stateVersion,
        generatedAt: input.generatedAt,
        audience: "student",
        status,
        triggerEvent: eventSummary(trigger, input.actorKinds),
        suggestion,
        studentDecision,
        teacherGate: gate,
        authorityWriteback: status === "completed"
          ? writeback ?? {
              occurred: false,
              summary: "本轮已结束，未发生权威写回。",
              worldEventIds: [],
              taskIds: [],
              evidenceIds: [],
              consequences: [],
            }
          : null,
        failure: status === "failed"
          ? {
              code: "no_applicable_agent",
              message: "当前事件没有可安全展示的智能体建议。",
            }
          : null,
      });
    }
    const status: TeacherCollaborationEpisode["status"] = gate?.status === "rejected"
      ? "failed"
      : gate?.status === "approved"
        ? "completed"
        : gate?.status === "pending"
          ? "awaiting_gate"
          : "in_progress";
    const business = {
      schemaVersion: AgentCollaborationEpisodeSchemaVersion,
      sessionId: input.projection.sessionId,
      scenarioId: input.projection.scenarioId,
      courseReleaseRef: frozenRef,
      stateVersion: input.projection.stateVersion,
      generatedAt: input.generatedAt,
      status,
      triggerEvent: eventSummary(trigger, input.actorKinds),
      affectedAgents,
      contributions,
      studentDecision,
      teacherGate: gate,
      authorityWriteback: status === "completed" ? writeback : null,
      failureCode: status === "failed" ? "teacher_rejected" : null,
    } as const;
    if (input.audience === "teacher") {
      return TeacherCollaborationEpisodeSchema.parse({
        ...business,
        audience: "teacher",
      });
    }
    const selectedAgentIds = new Set(affectedAgents.filter((decision) => (
      decision.decision === "selected"
    )).map((decision) => decision.agent.agentId));
    const traceRefs = unique(input.traceRecords.flatMap((record) => (
      record.eventId === trigger.eventId
      || (record.agentId !== null && selectedAgentIds.has(record.agentId))
        ? [record.traceId]
        : []
    ))).slice(0, 256);
    const mode = executionMode(input.modelHealth);
    return AdminCollaborationEpisodeSchema.parse({
      ...business,
      audience: "admin",
      execution: {
        mode,
        providerId: mode === "live" ? input.modelHealth.provider : null,
        selectedCount: selectedAgentIds.size,
        skippedCount: affectedAgents.length - selectedAgentIds.size,
        failedAgentIds: [],
        traceRefs,
      },
    });
  }

  #waiting(
    input: BuildCollaborationEpisodeInput & {
      courseRelease: CourseRelease;
      traceRecords: readonly TraceRecord[];
      actorKinds: Readonly<Record<string, ActorKind>>;
      generatedAt: string;
    },
    courseReleaseRef: ReturnType<typeof courseReleaseReferenceOf>,
  ): AgentCollaborationEpisode {
    const shared = {
      schemaVersion: AgentCollaborationEpisodeSchemaVersion,
      sessionId: input.projection.sessionId,
      scenarioId: input.projection.scenarioId,
      courseReleaseRef,
      stateVersion: input.projection.stateVersion,
      generatedAt: input.generatedAt,
      status: "waiting" as const,
      triggerEvent: null,
    };
    if (input.audience === "student") {
      return StudentCollaborationEpisodeSchema.parse({
        ...shared,
        audience: "student",
        suggestion: null,
        studentDecision: null,
        teacherGate: null,
        authorityWriteback: null,
        failure: null,
      });
    }
    const business = {
      ...shared,
      affectedAgents: [],
      contributions: [],
      studentDecision: null,
      teacherGate: null,
      authorityWriteback: null,
      failureCode: null,
    };
    if (input.audience === "teacher") {
      return TeacherCollaborationEpisodeSchema.parse({
        ...business,
        audience: "teacher",
      });
    }
    return AdminCollaborationEpisodeSchema.parse({
      ...business,
      audience: "admin",
      execution: {
        mode: executionMode(input.modelHealth),
        providerId: input.modelHealth.mode === "live"
          && input.modelHealth.available
          ? input.modelHealth.provider
          : null,
        selectedCount: 0,
        skippedCount: 0,
        failedAgentIds: [],
        traceRefs: [],
      },
    });
  }

  #failedDrift(
    input: BuildCollaborationEpisodeInput & {
      courseRelease: CourseRelease;
      traceRecords: readonly TraceRecord[];
      actorKinds: Readonly<Record<string, ActorKind>>;
      generatedAt: string;
    },
    trigger: WorldEvent | null,
  ): AgentCollaborationEpisode {
    const safeTrigger = trigger
      ? eventSummary(trigger, input.actorKinds)
      : {
          eventId: "episode-version-hash-drift",
          eventType: "session_started" as const,
          title: "课程与情境发布引用校验失败",
          occurredAt: input.generatedAt,
          source: "system_time" as const,
          evidenceRefs: [],
        };
    const shared = {
      schemaVersion: AgentCollaborationEpisodeSchemaVersion,
      sessionId: input.projection.sessionId,
      scenarioId: input.projection.scenarioId,
      courseReleaseRef: courseReleaseReferenceOf(input.courseRelease),
      stateVersion: input.projection.stateVersion,
      generatedAt: input.generatedAt,
      status: "failed" as const,
      triggerEvent: safeTrigger,
    };
    if (input.audience === "student") {
      return StudentCollaborationEpisodeSchema.parse({
        ...shared,
        audience: "student",
        suggestion: null,
        studentDecision: null,
        teacherGate: null,
        authorityWriteback: null,
        failure: {
          code: "version_hash_drift",
          message: "课程与情境不可变引用不一致，已停止展示建议。",
        },
      });
    }
    const business = {
      ...shared,
      affectedAgents: [],
      contributions: [],
      studentDecision: null,
      teacherGate: null,
      authorityWriteback: null,
      failureCode: "version_hash_drift" as const,
    };
    if (input.audience === "teacher") {
      return TeacherCollaborationEpisodeSchema.parse({
        ...business,
        audience: "teacher",
      });
    }
    return AdminCollaborationEpisodeSchema.parse({
      ...business,
      audience: "admin",
      execution: {
        mode: "degraded",
        providerId: null,
        selectedCount: 0,
        skippedCount: 0,
        failedAgentIds: [],
        traceRefs: [],
      },
    });
  }
}

export function isCollaborationEpisodeDrift(
  episode: AgentCollaborationEpisode,
): boolean {
  const parsed = AgentCollaborationEpisodeSchema.parse(episode);
  return parsed.audience === "student"
    ? parsed.status === "failed"
      && parsed.failure?.code === "version_hash_drift"
    : parsed.status === "failed"
      && parsed.failureCode === "version_hash_drift";
}
