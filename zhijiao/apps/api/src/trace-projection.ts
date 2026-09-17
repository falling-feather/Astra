import {
  AgentAssistanceProposalSchema,
  SessionTraceProjectionSchema,
  TraceDetailSchema,
  TraceLinkSchema,
  TraceRecordSchema,
  type AgentDispatchPlan,
  type AgentRunTrace,
  type AgentTask,
  type DeadLetterRecord,
  type DispatchAttempt,
  type MediaProcessingTask,
  type OutboxRecord,
  type SessionTraceProjection,
  type StateProjection,
  type TraceDetail,
  type TraceLink,
  type TraceLinkRelation,
  type TraceRecord,
  type TraceRecordStatus,
  type WorldEvent,
} from "@ronggang/contracts";
import type { SimulationSessionRecord } from "@ronggang/world-core";
import type { SimulationCollaborationSessionRecordV3 } from "@ronggang/agent-orchestrator";
import type { FieldModelAttempt } from "./field-model-attempt-store.js";

const intentEventTypes = new Set<WorldEvent["eventType"]>([
  "agent_intent_recorded",
  "role_response_intent_recorded",
]);

const failedEventTypes = new Set<WorldEvent["eventType"]>([
  "agent_task_failed",
  "media_processing_step_failed",
  "learning_candidate_generation_failed",
]);

const kindOrder: Record<TraceRecord["kind"], number> = {
  world_event: 0,
  agent_intent: 1,
  agent_assistance: 2,
  outbox: 3,
  dispatch_plan: 4,
  dispatch_decision: 5,
  agent_task: 6,
  dispatch_attempt: 7,
  agent_run: 8,
  agent_node: 9,
  tool_step: 10,
  model_invocation: 11,
  dead_letter: 12,
};

const recordDefaults = {
  completedAt: null,
  correlationId: null,
  stateVersion: null,
  actorId: null,
  roleId: null,
  agentId: null,
  eventType: null,
  eventId: null,
  outboxId: null,
  taskId: null,
  agentRunId: null,
  nodeId: null,
  invocationId: null,
  toolTaskId: null,
  stepId: null,
  errorCode: null,
  durationMs: null,
  tokenTotal: null,
  attempts: null,
  provider: null,
  providerMode: null,
  model: null,
  details: [],
} satisfies Partial<TraceRecord>;

function detail(
  label: string,
  value: string | number | null | undefined,
  valueKind: TraceDetail["valueKind"] = "code",
): TraceDetail | null {
  if (value === null || value === undefined || String(value).length === 0) {
    return null;
  }
  return TraceDetailSchema.parse({
    label,
    value: String(value).slice(0, 2_000),
    valueKind,
  });
}

function details(
  items: Array<TraceDetail | null>,
): TraceDetail[] {
  return items.filter((item): item is TraceDetail => item !== null);
}

function record(
  input: Pick<
    TraceRecord,
    | "traceId"
    | "kind"
    | "lane"
    | "sourceId"
    | "timestamp"
    | "status"
    | "title"
    | "summary"
  > & Partial<TraceRecord>,
): TraceRecord {
  return TraceRecordSchema.parse({
    ...recordDefaults,
    ...input,
  });
}

function taskStatus(status: AgentTask["status"]): TraceRecordStatus {
  return status;
}

function attemptStatus(
  outcome: DispatchAttempt["outcome"],
): TraceRecordStatus {
  if (outcome === "completed" || outcome === "duplicate_suppressed") {
    return "completed";
  }
  if (outcome === "degraded") return "degraded";
  if (outcome === "retry_scheduled" || outcome === "lease_expired") {
    return "retry_scheduled";
  }
  return "dead_lettered";
}

function toolStatus(
  status: MediaProcessingTask["steps"][number]["status"],
): TraceRecordStatus {
  if (status === "succeeded" || status === "manually_completed") {
    return "completed";
  }
  return status;
}

function eventStatus(event: WorldEvent): TraceRecordStatus {
  if (failedEventTypes.has(event.eventType)) return "failed";
  const proposal = event.payload.proposal;
  if (
    proposal
    && typeof proposal === "object"
    && "status" in proposal
    && proposal.status === "unavailable"
  ) {
    return "degraded";
  }
  return "completed";
}

function contextItemCount(run: AgentRunTrace): number | null {
  const manifest = run.contextManifest;
  if (!manifest) return null;
  return Object.values(manifest.layers).reduce(
    (total, layer) => total + layer.length,
    0,
  );
}

/** Current flagship trace uses the same page contract, never the dormant V2 mirror. */
export function buildFlagshipTraceProjection(
  world: SimulationSessionRecord,
  collaboration: SimulationCollaborationSessionRecordV3 | null,
  fieldModelAttempts: readonly FieldModelAttempt[] = [],
): SessionTraceProjection {
  if (collaboration && (collaboration.sessionId !== world.sessionId
    || collaboration.simulationReleaseRef.contentHash !== world.release.simulationReleaseRef.contentHash)) {
    throw new Error("旗舰运行追踪的会话或发布引用漂移");
  }
  const records: TraceRecord[] = [];
  const links: TraceLink[] = [];
  for (const event of world.consequences) {
    const queued = world.queue.find(item => item.eventId === event.sourceWorldEventId);
    const template = world.release.eventTemplates.find(item => item.eventTemplateId === queued?.eventTemplateId);
    records.push(record({ traceId: `flagship-event:${event.eventId}`, kind: "world_event", lane: "world", sourceId: event.eventId,
      timestamp: event.occurredAt, completedAt: event.occurredAt, status: "completed", title: template?.title ?? "岗位行动后果", summary: event.publicSummary,
      stateVersion: event.resultingStateVersion, eventId: event.eventId, eventType: "experience_consequence_applied", correlationId: event.sourceWorldEventId,
      details: details([detail("权威事件类型", queued?.eventType), detail("发布哈希", world.release.simulationReleaseRef.contentHash, "hash"), detail("原事件", event.sourceWorldEventId)]) }));
  }
  for (const event of world.queue.filter(item => item.status !== "committed")) {
    const template = world.release.eventTemplates.find(item => item.eventTemplateId === event.eventTemplateId);
    records.push(record({ traceId: `flagship-queue:${event.eventId}`, kind: "world_event", lane: "world", sourceId: event.eventId,
      timestamp: event.occurredAt, status: event.status === "queued" || event.status === "awaiting_gate" ? "pending" : "failed",
      title: template?.title ?? "待结算岗位行动", summary: `岗位事件 ${template?.title ?? event.eventType}：${event.status}`,
      stateVersion: event.enqueuedAtStateVersion, eventId: event.eventId, correlationId: event.sourceRef,
      details: details([detail("权威事件类型", event.eventType), detail("队列状态", event.status, "status")]) }));
  }
  for (const event of world.fieldInterview?.events ?? []) {
    const traceId = `field-event:${event.id}`;
    records.push(record({ traceId, kind: "world_event", lane: "world", sourceId: event.id, eventId: event.id,
      timestamp: event.committedAt, completedAt: event.committedAt, status: "completed", title: "开放采访现场", summary: event.summary,
      correlationId: event.requestId, stateVersion: event.resultingWorldStateVersion, actorId: event.actorId, eventType: "experience_consequence_applied",
      details: details([detail("行动类型", event.action.kind), detail("世界时间", `${event.beforeMinute} → ${event.afterMinute} 分钟`, "text"),
        detail("证据引用", event.evidenceRefs.join("、")), detail("采访课程哈希", world.fieldInterview!.lessonRef.contentHash, "hash")]) }));
    for (const turn of world.fieldInterview!.turns.filter(item => event.evidenceRefs.includes(item.id))) {
      if (fieldModelAttempts.some(attempt => attempt.requestId === event.requestId)) continue;
      const receipt = turn.modelReceipt;
      const runId = `field-run:${turn.id}`;
      records.push(record({ traceId: runId, kind: "agent_run", lane: "execution", sourceId: turn.id, timestamp: event.committedAt,
        completedAt: event.committedAt, status: receipt.failureCode ? "degraded" : "completed", title: "采访人物回应",
        summary: `${turn.npcText}\n执行方式：${receipt.mode}`, agentId: turn.npcId, correlationId: event.id,
        stateVersion: event.resultingWorldStateVersion, providerMode: receipt.mode, errorCode: receipt.failureCode,
        details: details([detail("Trace", receipt.traceRef), detail("输入哈希", receipt.inputHash, "hash"), detail("输出哈希", receipt.outputHash, "hash"),
          detail("调用记录成本（微美元）", receipt.costMicros, "text")]) }));
      links.push({ linkId: `${runId}:produces:${traceId}`, fromTraceId: runId, toTraceId: traceId, relation: "produces" });
    }
  }
  for (const attempt of fieldModelAttempts) {
    if (attempt.sessionId !== world.sessionId) throw new Error("调用追踪不能混用其他场次的模型尝试");
    const traceId = `field-model:${attempt.attemptId}`;
    const outcome = attempt.commitStatus === "committed" ? "已写入世界" : attempt.commitStatus === "rejected" ? "世界提交未成功" : "尚未提交世界";
    records.push(record({ traceId, kind: "model_invocation", lane: "execution", sourceId: attempt.attemptId, invocationId: attempt.attemptId,
      timestamp: attempt.startedAt, completedAt: attempt.settledAt,
      status: attempt.status === "started" ? "running" : attempt.status === "failed" || attempt.status === "interrupted" || attempt.commitStatus === "rejected" ? "degraded" : "completed",
      title: "采访模型尝试", summary: `${attempt.status} · ${outcome}；${attempt.costMicros === null ? "费用未知，预算继续保留预留额" : `已记录费用 ${attempt.costMicros} 微美元`}`,
      correlationId: attempt.eventId, errorCode: attempt.failureCode ?? attempt.commitFailureCode, attempts: attempt.called === null ? null : attempt.called ? 1 : 0,
      provider: attempt.execution?.provider ?? null, model: attempt.execution?.model ?? null, providerMode: attempt.execution?.mode ?? null,
      details: details([detail("来源", attempt.status === "legacy" ? "旧回合估计，原始调用次数不可确认" : "独立调用账本", "text"),
        detail("调用是否发生", attempt.called === null ? "不能确认，保留预算预留" : attempt.called ? "已开始" : "未调用", "text"),
        detail("Trace", attempt.traceRef), detail("输入哈希", attempt.inputHash, "hash"), detail("输出哈希", attempt.outputHash, "hash"),
        detail("预留费用（微美元）", attempt.reservedCostMicros, "text"), detail("世界提交错误", attempt.commitFailureCode)]) }));
    if (attempt.eventId && records.some(item => item.traceId === `field-event:${attempt.eventId}`)) {
      links.push({ linkId: `${traceId}:produces:${attempt.eventId}`, fromTraceId: traceId, toTraceId: `field-event:${attempt.eventId}`, relation: "produces" });
    }
  }
  for (const run of collaboration?.runs ?? []) {
    const contribution = collaboration!.contributions.find(item => item.agentRunId === run.agentRunId);
    records.push(record({ traceId: `flagship-run:${run.agentRunId}`, kind: "agent_run", lane: "execution", sourceId: run.agentRunId,
      timestamp: run.startedAt, completedAt: run.completedAt, status: run.status === "failed" ? "failed" : run.executionMode === "degraded" ? "degraded" : "completed",
      title: contribution?.displayName ?? "岗位智能体执行", summary: contribution?.summary ?? run.safeFailureMessage ?? "本次智能体运行已完成，详细引用见执行收据。",
      agentRunId: run.agentRunId, agentId: run.agentId, taskId: run.agentTaskId, provider: run.providerId, providerMode: run.executionMode, model: run.modelId,
      durationMs: run.latencyMs, errorCode: run.failureCode, details: details([detail("Trace", run.traceRef), detail("输出哈希", run.outputHash, "hash")]) }));
  }
  return SessionTraceProjectionSchema.parse({ sessionId: world.sessionId, generatedAt: world.updatedAt, stateVersion: world.currentSnapshot.stateVersion, records, links,
    summary: {
      worldRecordCount: records.filter(item => item.lane === "world").length, executionRecordCount: records.filter(item => item.lane === "execution").length,
      eventCount: records.filter(item => item.kind === "world_event").length, outboxCount: 0, taskCount: collaboration?.tasks.length ?? 0,
      runCount: records.filter(item => item.kind === "agent_run").length, modelInvocationCount: fieldModelAttempts.filter(item => item.called === true).length, toolStepCount: 0,
      failedCount: records.filter(item => item.status === "failed").length, degradedCount: records.filter(item => item.status === "degraded").length,
      pendingCount: records.filter(item => item.status === "pending").length, totalTokens: 0,
    } });
}

function collectStringValues(
  value: unknown,
  target: Set<string>,
  depth = 0,
): void {
  if (depth > 4 || value === null || value === undefined) return;
  if (typeof value === "string") {
    if (value.length <= 300) target.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStringValues(item, target, depth + 1);
    return;
  }
  if (typeof value !== "object") return;
  for (const item of Object.values(value as Record<string, unknown>)) {
    collectStringValues(item, target, depth + 1);
  }
}

export interface BuildSessionTraceProjectionInput {
  sessionId: string;
  generatedAt?: string;
  projection: StateProjection;
  events: readonly WorldEvent[];
  outboxRecords: readonly OutboxRecord[];
  dispatchPlans?: readonly AgentDispatchPlan[];
  tasks: readonly AgentTask[];
  attempts: readonly DispatchAttempt[];
  deadLetters: readonly DeadLetterRecord[];
  runs: readonly AgentRunTrace[];
}

export function buildSessionTraceProjection(
  input: BuildSessionTraceProjectionInput,
): SessionTraceProjection {
  const records: TraceRecord[] = [];
  const links: TraceLink[] = [];
  const linkKeys = new Set<string>();

  const addLink = (
    fromTraceId: string,
    toTraceId: string,
    relation: TraceLinkRelation,
  ): void => {
    if (fromTraceId === toTraceId) return;
    const key = `${fromTraceId}|${toTraceId}|${relation}`;
    if (linkKeys.has(key)) return;
    linkKeys.add(key);
    links.push(TraceLinkSchema.parse({
      linkId: `link:${relation}:${fromTraceId}:${toTraceId}`,
      fromTraceId,
      toTraceId,
      relation,
    }));
  };

  const eventTraceIds = new Map<string, string>();
  const outboxTraceIds = new Map<string, string>();
  const dispatchDecisionTraceIds = new Map<string, string>();
  const taskTraceIds = new Map<string, string>();
  const runTraceIds = new Map<string, string>();
  const sourceTraceIds = new Map<string, string[]>();
  const eventPayloadRefs = new Map<string, Set<string>>();
  const eventsById = new Map(
    input.events.map((event) => [event.eventId, event] as const),
  );
  const outboxById = new Map(
    input.outboxRecords.map((outbox) => [outbox.outboxId, outbox] as const),
  );

  const indexAlias = (sourceId: string, traceId: string): void => {
    const indexed = sourceTraceIds.get(sourceId) ?? [];
    if (!indexed.includes(traceId)) indexed.push(traceId);
    sourceTraceIds.set(sourceId, indexed);
  };

  const indexRecord = (traceRecord: TraceRecord): void => {
    records.push(traceRecord);
    indexAlias(traceRecord.sourceId, traceRecord.traceId);
  };

  for (const event of input.events) {
    const traceId = `event:${event.eventId}`;
    eventTraceIds.set(event.eventId, traceId);
    const payloadRefs = new Set<string>();
    collectStringValues(event.payload, payloadRefs);
    eventPayloadRefs.set(event.eventId, payloadRefs);
    const assistance = event.eventType === "agent_assistance_recorded"
      ? AgentAssistanceProposalSchema.safeParse(event.payload.proposal)
      : null;
    indexRecord(record({
      traceId,
      kind: intentEventTypes.has(event.eventType)
        ? "agent_intent"
        : assistance?.success
          ? "agent_assistance"
        : "world_event",
      lane: "world",
      sourceId: event.eventId,
      timestamp: event.timestamp,
      completedAt: event.timestamp,
      status: eventStatus(event),
      title: event.eventType,
      summary: event.summary,
      correlationId: event.correlationId,
      stateVersion: event.stateVersion,
      actorId: event.actorId,
      eventType: event.eventType,
      eventId: event.eventId,
      details: details([
        detail("事件 ID", event.eventId),
        detail("消息 ID", event.messageId),
        detail("事件类型", event.eventType, "status"),
        detail("世界版本", `STATE #${event.stateVersion}`, "status"),
        detail("行动者", event.actorId, "text"),
        detail("相关编号", event.correlationId),
        detail("可见范围", event.visibility.join("、"), "text"),
        detail("统一行动 ID", event.actionContext?.actionId),
        detail("根行动 ID", event.actionContext?.rootActionId),
        detail("行动命令", event.actionContext?.commandName, "text"),
        detail("界面来源", event.actionContext?.sourceMode, "text"),
        detail("来源断言", event.actionContext?.sourceAssertion, "status"),
        detail("载荷哈希", event.actionContext?.payloadHash, "hash"),
        detail("主体绑定哈希", event.actionContext?.actorBindingHash, "hash"),
        detail("对象引用数", event.actionContext?.objectRefCount, "text"),
        detail("证据引用数", event.actionContext?.evidenceRefCount, "text"),
        detail(
          "辅助模板",
          assistance?.success
            ? `${assistance.data.templateRef.templateId}@${assistance.data.templateRef.templateVersion}`
            : null,
        ),
        detail(
          "辅助实例",
          assistance?.success
            ? `${assistance.data.instanceRef.instanceId}@${assistance.data.instanceRef.instanceVersion}`
            : null,
        ),
        detail(
          "输出 Schema",
          assistance?.success
            ? assistance.data.outputSchemaRef
            : null,
        ),
        detail(
          "建议类型",
          assistance?.success ? assistance.data.output.kind : null,
          "status",
        ),
        detail(
          "权威边界",
          assistance?.success ? assistance.data.authority : null,
          "status",
        ),
        detail(
          "目标主体",
          assistance?.success ? assistance.data.subjectActorId : null,
          "text",
        ),
        detail(
          "固定资源",
          assistance?.success && assistance.data.resourceRef
            ? [
                assistance.data.resourceRef.objectType,
                assistance.data.resourceRef.objectId,
                assistance.data.resourceRef.version,
              ].join(":")
            : null,
        ),
        detail(
          "结构化输出",
          assistance?.success
            ? JSON.stringify(assistance.data.output)
            : null,
          "text",
        ),
      ]),
    }));
  }

  for (const outbox of input.outboxRecords) {
    const traceId = `outbox:${outbox.outboxId}`;
    outboxTraceIds.set(outbox.outboxId, traceId);
    indexRecord(record({
      traceId,
      kind: "outbox",
      lane: "execution",
      sourceId: outbox.outboxId,
      timestamp: outbox.createdAt,
      completedAt: outbox.deliveredAt,
      status: outbox.status,
      title: `Outbox · ${outbox.eventType}`,
      summary: outbox.status === "delivered"
        ? "世界提交已经交付给持久任务调度入口。"
        : "世界提交仍等待调度器交付。",
      correlationId: outbox.correlationId,
      stateVersion: outbox.stateVersion,
      eventType: outbox.eventType,
      eventId: outbox.eventId,
      outboxId: outbox.outboxId,
      errorCode: outbox.lastErrorCode,
      attempts: outbox.attempts,
      details: details([
        detail("Outbox ID", outbox.outboxId),
        detail("世界事件", outbox.eventId),
        detail("主题", outbox.topic, "text"),
        detail("因果深度", outbox.causalDepth, "text"),
        detail("交付尝试", outbox.attempts, "text"),
        detail("可用时间", outbox.availableAt, "text"),
        detail("错误码", outbox.lastErrorCode, "status"),
      ]),
    }));
    const eventTraceId = eventTraceIds.get(outbox.eventId);
    if (eventTraceId) addLink(eventTraceId, traceId, "emits");
  }

  for (const plan of input.dispatchPlans ?? []) {
    const traceId = `dispatch-plan:${plan.planId}`;
    const event = eventsById.get(plan.eventId);
    const outbox = outboxById.get(plan.outboxId);
    indexRecord(record({
      traceId,
      kind: "dispatch_plan",
      lane: "execution",
      sourceId: plan.planId,
      timestamp: plan.createdAt,
      completedAt: plan.createdAt,
      status: "completed",
      title: `事件波计划 · ${plan.budget.selected}/${plan.budget.affected}`,
      summary: `${plan.decisions.length} 个候选，${plan.tasks.length} 个可执行任务`,
      correlationId: event?.correlationId ?? null,
      stateVersion: outbox?.stateVersion ?? null,
      eventType: event?.eventType ?? null,
      eventId: plan.eventId,
      outboxId: plan.outboxId,
      details: details([
        detail("计划 ID", plan.planId),
        detail("事件波 ID", plan.waveId),
        detail("调度策略", plan.policyVersion),
        detail(
          "架构配置",
          `${plan.architectureProfile.profileId}@${plan.architectureProfile.profileVersion}`,
        ),
        detail("架构策略哈希", plan.architectureProfile.policyHash, "hash"),
        detail(
          "启用模板",
          plan.architectureProfile.enabledTemplateIds?.join("、")
            ?? "全部（排除清单除外）",
          "text",
        ),
        detail(
          "停用模板",
          plan.architectureProfile.disabledTemplateIds.join("、") || "无",
          "text",
        ),
        detail("受影响实例", plan.affectedInstanceIds.length, "text"),
        detail("入选实例", plan.budget.selected, "text"),
        detail("过滤实例", plan.budget.filtered, "text"),
        detail(
          "单波预算",
          `${plan.budget.consumed}/${plan.budget.limit}`,
          "text",
        ),
        detail("实验条件", plan.experimentObservation?.condition, "text"),
        detail("实验批次", plan.experimentObservation?.runBatchId),
        detail(
          "实验控制哈希",
          plan.experimentObservation?.controlVariablesHash,
          "hash",
        ),
      ]),
    }));
    const outboxTraceId = outboxTraceIds.get(plan.outboxId);
    if (outboxTraceId) addLink(outboxTraceId, traceId, "plans");
    const eventTraceId = eventTraceIds.get(plan.eventId);
    if (eventTraceId) addLink(eventTraceId, traceId, "plans");

    for (const candidate of plan.decisions) {
      const decision = candidate.decision;
      const decisionTraceId = `dispatch-decision:${decision.decisionId}`;
      dispatchDecisionTraceIds.set(decision.decisionId, decisionTraceId);
      indexRecord(record({
        traceId: decisionTraceId,
        kind: "dispatch_decision",
        lane: "execution",
        sourceId: decision.decisionId,
        timestamp: plan.createdAt,
        completedAt: plan.createdAt,
        status: decision.decision === "selected" ? "completed" : "skipped",
        title: `${candidate.agentId} · ${decision.decision}`,
        summary: decision.reason,
        correlationId: event?.correlationId ?? null,
        stateVersion: outbox?.stateVersion ?? null,
        roleId: candidate.roleId,
        agentId: candidate.agentId,
        eventType: event?.eventType ?? null,
        eventId: plan.eventId,
        outboxId: plan.outboxId,
        details: details([
          detail("决定 ID", decision.decisionId),
          detail("订阅", candidate.subscriptionId),
          detail("智能体", candidate.agentId, "text"),
          detail(
            "模板",
            `${candidate.templateRef.templateId}@${candidate.templateRef.templateVersion}`,
          ),
          detail(
            "实例",
            `${candidate.instanceRef.instanceId}@${candidate.instanceRef.instanceVersion}`,
          ),
          detail("实例类型", candidate.instanceContext.bindingKind, "text"),
          detail("实例配置哈希", candidate.instanceContext.configHash, "hash"),
          detail(
            "是否受影响",
            decision.affected === null
              ? "未观测"
              : decision.affected ? "是" : "否",
            "status",
          ),
          detail("决定", decision.decision, "status"),
          detail("理由", decision.reason, "status"),
          detail("入选顺序", decision.selectedOrder, "text"),
          detail(
            "单波预算",
            decision.budget
              ? `${decision.budget.consumed}/${decision.budget.limit}`
              : null,
            "text",
          ),
        ]),
      }));
      addLink(
        traceId,
        decisionTraceId,
        decision.decision === "selected" ? "selects" : "filters",
      );
    }
  }

  for (const task of input.tasks) {
    const traceId = `task:${task.taskId}`;
    taskTraceIds.set(task.taskId, traceId);
    indexRecord(record({
      traceId,
      kind: "agent_task",
      lane: "execution",
      sourceId: task.taskId,
      timestamp: task.createdAt,
      completedAt: task.completedAt,
      status: taskStatus(task.status),
      title: `${task.agentId} · ${task.triggerEventType}`,
      summary: `${task.definitionVersion} / ${task.promptVersion}`,
      correlationId: task.correlationId,
      stateVersion: task.expectedStateVersion,
      roleId: task.roleId,
      agentId: task.agentId,
      eventType: task.triggerEventType,
      eventId: task.triggerEventId,
      outboxId: task.outboxId,
      taskId: task.taskId,
      errorCode: task.lastErrorCode,
      attempts: task.attempts,
      details: details([
        detail("任务 ID", task.taskId),
        detail("订阅", task.subscriptionId),
        detail("触发事件", task.triggerEventId),
        detail("智能体", task.agentId, "text"),
        detail("角色", task.roleId, "text"),
        detail(
          "模板",
          `${task.templateRef.templateId}@${task.templateRef.templateVersion}`,
        ),
        detail(
          "实例",
          `${task.instanceRef.instanceId}@${task.instanceRef.instanceVersion}`,
        ),
        detail("定义版本", task.definitionVersion),
        detail("提示词版本", task.promptVersion),
        detail(
          "调度决定",
          `${task.dispatchDecision.decision}:${task.dispatchDecision.reason}`,
          "status",
        ),
        detail(
          "单波预算",
          task.dispatchDecision.budget
            ? `${task.dispatchDecision.budget.consumed}/${task.dispatchDecision.budget.limit}`
            : null,
          "text",
        ),
        detail("行动来源", task.actionContext?.sourceMode, "text"),
        detail("行动 ID", task.actionContext?.actionId),
        detail("实验条件", task.experimentObservation?.condition, "text"),
        detail("实验批次", task.experimentObservation?.runBatchId),
        detail("输入世界版本", `STATE #${task.expectedStateVersion}`, "status"),
        detail("优先级", task.priority, "text"),
        detail("因果深度", task.causalDepth, "text"),
        detail("尝试额度", `${task.attempts}/${task.maxAttempts}`, "text"),
        detail("租约持有者", task.lease?.ownerId, "text"),
        detail("租约到期", task.lease?.expiresAt, "text"),
        detail("错误码", task.lastErrorCode, "status"),
      ]),
    }));
    const outboxTraceId = outboxTraceIds.get(task.outboxId);
    if (outboxTraceId) addLink(outboxTraceId, traceId, "dispatches");
    const eventTraceId = eventTraceIds.get(task.triggerEventId);
    if (eventTraceId) addLink(eventTraceId, traceId, "dispatches");
    const decisionTraceId = dispatchDecisionTraceIds.get(
      task.dispatchDecision.decisionId,
    );
    if (decisionTraceId) addLink(decisionTraceId, traceId, "selects");
  }

  for (const attempt of input.attempts) {
    const traceId = `attempt:${attempt.attemptId}`;
    indexRecord(record({
      traceId,
      kind: "dispatch_attempt",
      lane: "execution",
      sourceId: attempt.attemptId,
      timestamp: attempt.startedAt,
      completedAt: attempt.completedAt,
      status: attemptStatus(attempt.outcome),
      title: `任务尝试 #${attempt.attemptNumber}`,
      summary: attempt.outcome,
      taskId: attempt.taskId,
      errorCode: attempt.errorCode,
      attempts: attempt.attemptNumber,
      durationMs: Math.max(
        0,
        Date.parse(attempt.completedAt) - Date.parse(attempt.startedAt),
      ),
      details: details([
        detail("尝试 ID", attempt.attemptId),
        detail("任务 ID", attempt.taskId),
        detail("尝试序号", attempt.attemptNumber, "text"),
        detail("工作器", attempt.workerId, "text"),
        detail("结果", attempt.outcome, "status"),
        detail("错误码", attempt.errorCode, "status"),
      ]),
    }));
    const taskTraceId = taskTraceIds.get(attempt.taskId);
    if (taskTraceId) addLink(taskTraceId, traceId, "attempts");
  }

  for (const run of input.runs) {
    const traceId = `run:${run.agentRunId}`;
    runTraceIds.set(run.agentRunId, traceId);
    const totalTokens = run.tokenUsage.input + run.tokenUsage.output;
    const manifest = run.contextManifest;
    indexRecord(record({
      traceId,
      kind: "agent_run",
      lane: "execution",
      sourceId: run.agentRunId,
      timestamp: run.startedAt,
      completedAt: run.completedAt,
      status: run.status,
      title: `${run.agentId} · AgentRun`,
      summary: `${run.nodes.length} 个节点 · ${run.modelCalls} 次模型 · ${run.toolCalls} 次工具`,
      correlationId: run.correlationId,
      stateVersion: run.inputStateVersion,
      roleId: run.roleId,
      agentId: run.agentId,
      taskId: run.taskId,
      agentRunId: run.agentRunId,
      errorCode: run.errorCode,
      durationMs: run.durationMs,
      tokenTotal: totalTokens,
      details: details([
        detail("AgentRun ID", run.agentRunId),
        detail("任务 ID", run.taskId),
        detail(
          "模板",
          `${run.templateRef.templateId}@${run.templateRef.templateVersion}`,
        ),
        detail(
          "实例",
          `${run.instanceRef.instanceId}@${run.instanceRef.instanceVersion}`,
        ),
        detail(
          "调度决定",
          `${run.dispatchDecision.decision}:${run.dispatchDecision.reason}`,
          "status",
        ),
        detail("实验条件", run.experimentObservation?.condition, "text"),
        detail("实验批次", run.experimentObservation?.runBatchId),
        detail("定义版本", run.definitionVersion),
        detail("提示词版本", run.promptVersion),
        detail("输入世界版本", `STATE #${run.inputStateVersion}`, "status"),
        detail("触发引用", run.triggerRefs.slice(0, 12).join("、")),
        detail("提示词哈希", run.promptHash, "hash"),
        detail("上下文哈希", manifest?.contextHash, "hash"),
        detail("上下文条目", contextItemCount(run), "text"),
        detail("有效引用", manifest?.includedCitationRefs.length, "text"),
        detail("ACL 前置拒绝", manifest?.acl.preRejectedCount, "text"),
        detail("ACL 后置拒绝", manifest?.acl.postRejectedCount, "text"),
        detail("降级回退", run.fallbackUsed ? "是" : "否", "status"),
        detail("错误码", run.errorCode, "status"),
      ]),
    }));
    const taskTraceId = taskTraceIds.get(run.taskId);
    if (taskTraceId) addLink(taskTraceId, traceId, "executes");

    run.nodes.forEach((node, index) => {
      const nodeTraceId = `node:${run.agentRunId}:${index}:${node.nodeId}`;
      indexRecord(record({
        traceId: nodeTraceId,
        kind: "agent_node",
        lane: "execution",
        sourceId: `${run.agentRunId}:${node.nodeId}:${index}`,
        timestamp: node.startedAt,
        completedAt: node.completedAt,
        status: node.status === "success" ? "completed" : "failed",
        title: node.nodeId,
        summary: node.selectedEdgeId
          ? `${node.kind} → ${node.selectedEdgeId}`
          : `${node.kind} → terminal`,
        correlationId: run.correlationId,
        stateVersion: run.inputStateVersion,
        roleId: run.roleId,
        agentId: run.agentId,
        taskId: run.taskId,
        agentRunId: run.agentRunId,
        nodeId: node.nodeId,
        errorCode: node.errorCode,
        durationMs: node.durationMs,
        details: details([
          detail("节点", node.nodeId),
          detail("节点类型", node.kind, "text"),
          detail("选中边", node.selectedEdgeId ?? "terminal"),
          detail("错误码", node.errorCode, "status"),
        ]),
      }));
      addLink(traceId, nodeTraceId, "contains");
    });

    run.modelInvocations.forEach((invocation) => {
      const invocationTraceId = `model:${run.agentRunId}:${invocation.invocationId}`;
      indexRecord(record({
        traceId: invocationTraceId,
        kind: "model_invocation",
        lane: "execution",
        sourceId: invocation.invocationId,
        timestamp: invocation.startedAt,
        completedAt: invocation.completedAt,
        status: invocation.status === "completed" ? "completed" : "failed",
        title: `${invocation.provider} / ${invocation.model}`,
        summary: `${invocation.profileId} · ${invocation.outputMode}`,
        correlationId: run.correlationId,
        stateVersion: run.inputStateVersion,
        roleId: run.roleId,
        agentId: run.agentId,
        taskId: run.taskId,
        agentRunId: run.agentRunId,
        invocationId: invocation.invocationId,
        errorCode: invocation.errorCode,
        durationMs: invocation.latencyMs,
        tokenTotal: invocation.tokenUsage.total,
        attempts: invocation.attempts,
        provider: invocation.provider,
        providerMode: invocation.mode,
        model: invocation.model,
        details: details([
          detail("调用 ID", invocation.invocationId),
          detail("配置档", invocation.profileId),
          detail("提供方请求", invocation.requestId),
          detail("输出模式", invocation.outputMode, "text"),
          detail("结束原因", invocation.finishReason, "text"),
          detail("输入 Token", invocation.tokenUsage.input, "text"),
          detail("输出 Token", invocation.tokenUsage.output, "text"),
          detail("调用尝试", invocation.attempts, "text"),
          detail("错误码", invocation.errorCode, "status"),
        ]),
      }));
      addLink(traceId, invocationTraceId, "invokes");
    });
  }

  const toolTraceIds = new Map<string, string>();
  for (const mediaTask of input.projection.mediaProcessingTasks) {
    for (const step of mediaTask.steps) {
      const traceId = `tool:${mediaTask.taskId}:${step.stepId}`;
      toolTraceIds.set(`${mediaTask.taskId}:${step.stepId}`, traceId);
      indexRecord(record({
        traceId,
        kind: "tool_step",
        lane: "execution",
        sourceId: step.stepId,
        timestamp: step.startedAt ?? mediaTask.requestedAt,
        completedAt: step.completedAt,
        status: toolStatus(step.status),
        title: step.capability,
        summary: step.governanceDomain
          ? `${step.governanceDomain} · ${step.governanceNode?.definitionVersion ?? "固定工具步骤"}`
          : "多模态材料处理步骤",
        toolTaskId: mediaTask.taskId,
        stepId: step.stepId,
        errorCode: step.lastErrorCode,
        attempts: step.attempts,
        provider: step.output?.provider ?? null,
        providerMode: step.effectiveProviderMode,
        details: details([
          detail("工具任务", mediaTask.taskId),
          detail("步骤", step.stepId),
          detail("能力", step.capability, "text"),
          detail("材料", `${mediaTask.materialId}@${mediaTask.materialVersion}`),
          detail("输入哈希", mediaTask.inputContentHash, "hash"),
          detail("治理域", step.governanceDomain, "text"),
          detail("节点定义", step.governanceNode?.definitionVersion),
          detail("节点提示词", step.governanceNode?.promptVersion),
          detail("请求模式", step.requestedProviderMode, "status"),
          detail("实际模式", step.effectiveProviderMode, "status"),
          detail("提供方请求", step.output?.providerRequestId),
          detail("尝试额度", `${step.attempts}/${step.maxAttempts}`, "text"),
          detail("超时预算", `${step.timeoutMs} ms`, "text"),
          detail("错误码", step.lastErrorCode, "status"),
        ]),
      }));
      indexAlias(mediaTask.taskId, traceId);
    }
  }

  for (const finding of input.projection.governanceFindings) {
    if (!finding.executionTrace) continue;
    const traceId = `governance-model:${finding.findingId}`;
    indexRecord(record({
      traceId,
      kind: "model_invocation",
      lane: "execution",
      sourceId: finding.findingId,
      timestamp: finding.createdAt,
      completedAt: finding.createdAt,
      status: finding.executionStatus === "completed"
        ? "completed"
        : finding.executionStatus === "degraded"
          ? "degraded"
          : finding.executionStatus === "manual"
            ? "completed"
            : "failed",
      title: `${finding.node.nodeId} · 模型判断`,
      summary: finding.summary,
      agentId: finding.node.nodeId,
      invocationId: `governance:${finding.findingId}`,
      toolTaskId: finding.mediaTaskId,
      stepId: finding.stepId,
      errorCode: finding.errorCode,
      provider: finding.executionTrace.modelProvider,
      providerMode: finding.executionTrace.modelMode,
      model: finding.executionTrace.modelName,
      details: details([
        detail("发现 ID", finding.findingId),
        detail("治理域", finding.domain, "text"),
        detail("节点定义", finding.node.definitionVersion),
        detail("提示词版本", finding.node.promptVersion),
        detail("提供方请求", finding.providerRequestId),
        detail("输入哈希", finding.executionTrace.executionInputHash, "hash"),
        detail("工具输出哈希", finding.executionTrace.toolOutputHash, "hash"),
        detail("模型输出哈希", finding.executionTrace.modelOutputHash, "hash"),
        detail("知识快照", finding.executionTrace.knowledgeSnapshotHash, "hash"),
        detail("知识引用", finding.executionTrace.knowledgeCitations.length, "text"),
        detail("建议", finding.recommendation, "status"),
        detail("错误码", finding.errorCode, "status"),
      ]),
    }));
    const toolTraceId = toolTraceIds.get(
      `${finding.mediaTaskId}:${finding.stepId}`,
    );
    if (toolTraceId) addLink(toolTraceId, traceId, "invokes");
  }

  for (const deadLetter of input.deadLetters) {
    const traceId = `dead-letter:${deadLetter.deadLetterId}`;
    indexRecord(record({
      traceId,
      kind: "dead_letter",
      lane: "execution",
      sourceId: deadLetter.deadLetterId,
      timestamp: deadLetter.createdAt,
      completedAt: deadLetter.createdAt,
      status: "dead_lettered",
      title: "任务死信",
      summary: deadLetter.reasonCode,
      taskId: deadLetter.taskId,
      errorCode: deadLetter.reasonCode,
      attempts: deadLetter.attempts,
      details: details([
        detail("死信 ID", deadLetter.deadLetterId),
        detail("任务 ID", deadLetter.taskId),
        detail("原因", deadLetter.reasonCode, "status"),
        detail("累计尝试", deadLetter.attempts, "text"),
      ]),
    }));
    const taskTraceId = taskTraceIds.get(deadLetter.taskId);
    if (taskTraceId) addLink(taskTraceId, traceId, "produces");
  }

  for (const event of input.events) {
    const eventTraceId = eventTraceIds.get(event.eventId);
    if (!eventTraceId) continue;
    const payloadRefs = eventPayloadRefs.get(event.eventId) ?? new Set();
    for (const reference of payloadRefs) {
      for (const targetTraceId of sourceTraceIds.get(reference) ?? []) {
        if (targetTraceId.startsWith("event:")) continue;
        addLink(targetTraceId, eventTraceId, "produces");
      }
      const runTraceId = runTraceIds.get(reference);
      if (runTraceId) addLink(runTraceId, eventTraceId, "produces");
      const taskTraceId = taskTraceIds.get(reference);
      if (taskTraceId) addLink(taskTraceId, eventTraceId, "produces");
    }
  }

  const recordIds = new Set(records.map((item) => item.traceId));
  const validLinks = links.filter((link) => (
    recordIds.has(link.fromTraceId) && recordIds.has(link.toTraceId)
  ));
  records.sort((left, right) => (
    Date.parse(left.timestamp) - Date.parse(right.timestamp)
    || kindOrder[left.kind] - kindOrder[right.kind]
    || left.traceId.localeCompare(right.traceId)
  ));
  validLinks.sort((left, right) => left.linkId.localeCompare(right.linkId));

  const failedStatuses = new Set<TraceRecordStatus>([
    "failed",
    "dead_lettered",
  ]);
  const pendingStatuses = new Set<TraceRecordStatus>([
    "pending",
    "queued",
    "running",
    "retry_scheduled",
  ]);

  return SessionTraceProjectionSchema.parse({
    sessionId: input.sessionId,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    stateVersion: input.projection.stateVersion,
    records,
    links: validLinks,
    summary: {
      worldRecordCount: records.filter((item) => item.lane === "world").length,
      executionRecordCount: records.filter(
        (item) => item.lane === "execution",
      ).length,
      eventCount: input.events.length,
      outboxCount: input.outboxRecords.length,
      taskCount: input.tasks.length,
      runCount: input.runs.length,
      modelInvocationCount: records.filter(
        (item) => item.kind === "model_invocation",
      ).length,
      toolStepCount: records.filter(
        (item) => item.kind === "tool_step",
      ).length,
      failedCount: records.filter(
        (item) => failedStatuses.has(item.status),
      ).length,
      degradedCount: records.filter(
        (item) => item.status === "degraded",
      ).length,
      pendingCount: records.filter(
        (item) => pendingStatuses.has(item.status),
      ).length,
      totalTokens: records
        .filter((item) => item.kind === "model_invocation")
        .reduce((total, item) => total + (item.tokenTotal ?? 0), 0),
    },
  });
}
