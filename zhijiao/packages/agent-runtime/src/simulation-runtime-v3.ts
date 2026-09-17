import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  AgentObservationSchema,
  AgentStateSchema,
  SimulationAgentIntentSchema,
  SimulationAgentIntentSchemaVersion,
  SimulationObjectReferenceSchema,
  V2ContentHashSchema,
  V2IdentifierSchema,
  type AgentObservation,
  type AgentState,
  type SimulationAgentIntent,
  type SimulationObjectReference,
} from "@ronggang/contracts";

export const SimulationAgentTemplateV3SchemaVersion =
  "simulation-agent-template/3.0.0" as const;
export const SimulationDispatchPlanV3SchemaVersion =
  "simulation-dispatch-plan/3.0.0" as const;
export const SimulationAgentTaskV3SchemaVersion =
  "simulation-agent-task/3.0.0" as const;
export const SimulationAgentRunV3SchemaVersion =
  "simulation-agent-run/3.0.0" as const;

const TimestampSchema = z.string().datetime();
const NonEmptyTextSchema = z.string().trim().min(1);

const SimulationObjectSelectorSchema = z.object({
  objectType: SimulationObjectReferenceSchema.shape.objectType,
  objectId: V2IdentifierSchema.nullable(),
}).strict();

export const SimulationAgentTemplateV3Schema = z.object({
  schemaVersion: z.literal(SimulationAgentTemplateV3SchemaVersion),
  agentTemplateId: V2IdentifierSchema,
  agentId: V2IdentifierSchema,
  professionalRoleId: V2IdentifierSchema,
  displayName: NonEmptyTextSchema.max(160),
  responsibility: NonEmptyTextSchema.max(800),
  groupId: V2IdentifierSchema,
  contributionKind: z.enum(["world_actor", "professional_advisor"]),
  subscribedEventTypes: z.array(V2IdentifierSchema).min(1).max(64),
  affectedObjectSelectors: z.array(SimulationObjectSelectorSchema).max(32),
  disclosurePolicyRef: V2IdentifierSchema,
  toolCapabilityRefs: z.array(V2IdentifierSchema).max(24),
  initialGoals: z.array(z.object({
    goalId: V2IdentifierSchema,
    description: NonEmptyTextSchema.max(500),
    priority: z.number().int().min(1).max(100),
  }).strict()).min(1).max(16),
  initialActionBudget: z.number().int().min(1).max(100),
  dispatchPriority: z.number().int().min(1).max(100),
  enabled: z.boolean(),
  available: z.boolean(),
}).strict();
export type SimulationAgentTemplateV3 = z.infer<
  typeof SimulationAgentTemplateV3Schema
>;

const DispatchReasonCodeSchema = z.enum([
  "event_subscription_match",
  "affected_object_match",
  "not_affected",
  "permission_denied",
  "budget_limit",
  "deduplicated",
  "disabled",
  "unavailable",
]);

export const SimulationDispatchDecisionV3Schema = z.object({
  agentId: V2IdentifierSchema,
  agentTemplateId: V2IdentifierSchema,
  professionalRoleId: V2IdentifierSchema,
  decision: z.enum(["selected", "skipped"]),
  reasonCode: DispatchReasonCodeSchema,
  reason: NonEmptyTextSchema.max(600),
}).strict().superRefine((decision, context) => {
  const selected = decision.reasonCode === "event_subscription_match"
    || decision.reasonCode === "affected_object_match";
  if ((decision.decision === "selected") !== selected) {
    context.addIssue({
      code: "custom",
      path: ["reasonCode"],
      message: "派发决定与因果理由不一致",
    });
  }
});
export type SimulationDispatchDecisionV3 = z.infer<
  typeof SimulationDispatchDecisionV3Schema
>;

export const SimulationDispatchPlanV3Schema = z.object({
  schemaVersion: z.literal(SimulationDispatchPlanV3SchemaVersion),
  dispatchPlanId: V2IdentifierSchema,
  sessionId: V2IdentifierSchema,
  sourceWorldEventId: V2IdentifierSchema,
  sourceWorldStateVersion: z.number().int().nonnegative(),
  decisions: z.array(SimulationDispatchDecisionV3Schema).min(1).max(14),
  selectedCount: z.number().int().nonnegative().max(14),
  skippedCount: z.number().int().nonnegative().max(14),
  createdAt: TimestampSchema,
}).strict().superRefine((plan, context) => {
  const selectedCount = plan.decisions.filter(
    (decision) => decision.decision === "selected",
  ).length;
  if (selectedCount !== plan.selectedCount
    || plan.decisions.length - selectedCount !== plan.skippedCount) {
    context.addIssue({
      code: "custom",
      path: ["selectedCount"],
      message: "派发计划计数与逐项决定不一致",
    });
  }
  const agentIds = plan.decisions.map((decision) => decision.agentId);
  if (new Set(agentIds).size !== agentIds.length) {
    context.addIssue({
      code: "custom",
      path: ["decisions"],
      message: "同一智能体只能出现一次派发决定",
    });
  }
});
export type SimulationDispatchPlanV3 = z.infer<
  typeof SimulationDispatchPlanV3Schema
>;

export const SimulationAgentTaskV3Schema = z.object({
  schemaVersion: z.literal(SimulationAgentTaskV3SchemaVersion),
  agentTaskId: V2IdentifierSchema,
  sessionId: V2IdentifierSchema,
  sourceWorldEventId: V2IdentifierSchema,
  eventType: V2IdentifierSchema,
  affectedObjectRefs: z.array(SimulationObjectReferenceSchema).min(1).max(24),
  dispatchPlanId: V2IdentifierSchema,
  agentId: V2IdentifierSchema,
  agentTemplateId: V2IdentifierSchema,
  professionalRoleId: V2IdentifierSchema,
  agentStateId: V2IdentifierSchema,
  observationId: V2IdentifierSchema,
  expectedWorldStateVersion: z.number().int().nonnegative(),
  taskInstructionHash: V2ContentHashSchema,
  status: z.enum(["pending", "running", "completed", "failed"]),
  attempt: z.number().int().positive().max(3),
  createdAt: TimestampSchema,
  startedAt: TimestampSchema.nullable(),
  completedAt: TimestampSchema.nullable(),
  failureCode: V2IdentifierSchema.nullable(),
}).strict().superRefine((task, context) => {
  const terminal = task.status === "completed" || task.status === "failed";
  if (terminal !== (task.completedAt !== null)) {
    context.addIssue({
      code: "custom",
      path: ["completedAt"],
      message: "终态任务必须记录完成时间",
    });
  }
  if ((task.status === "failed") !== (task.failureCode !== null)) {
    context.addIssue({
      code: "custom",
      path: ["failureCode"],
      message: "只有失败任务可以记录失败代码",
    });
  }
});
export type SimulationAgentTaskV3 = z.infer<
  typeof SimulationAgentTaskV3Schema
>;

export const SimulationAgentRunV3Schema = z.object({
  schemaVersion: z.literal(SimulationAgentRunV3SchemaVersion),
  agentRunId: V2IdentifierSchema,
  agentTaskId: V2IdentifierSchema,
  sessionId: V2IdentifierSchema,
  agentId: V2IdentifierSchema,
  observationId: V2IdentifierSchema,
  status: z.enum(["succeeded", "failed"]),
  executionMode: z.enum(["live", "deterministic_demo", "degraded"]),
  providerId: V2IdentifierSchema.nullable(),
  modelId: V2IdentifierSchema.nullable(),
  traceRef: V2IdentifierSchema.nullable(),
  promptTemplateRef: V2IdentifierSchema.nullable(),
  intentId: V2IdentifierSchema.nullable(),
  outputHash: V2ContentHashSchema.nullable(),
  effectPayloadHash: V2ContentHashSchema.nullable(),
  latencyMs: z.number().int().nonnegative(),
  estimatedCostMicrounits: z.number().int().nonnegative(),
  failureCode: V2IdentifierSchema.nullable(),
  safeFailureMessage: NonEmptyTextSchema.max(500).nullable(),
  startedAt: TimestampSchema,
  completedAt: TimestampSchema,
}).strict().superRefine((run, context) => {
  const succeeded = run.status === "succeeded";
  const successValues = [run.intentId, run.outputHash, run.effectPayloadHash];
  if (succeeded !== successValues.every((value) => value !== null)) {
    context.addIssue({
      code: "custom",
      path: ["intentId"],
      message: "成功运行必须完整引用意图、输出和效果哈希",
    });
  }
  if (succeeded && (run.failureCode !== null || run.safeFailureMessage !== null)) {
    context.addIssue({
      code: "custom",
      path: ["failureCode"],
      message: "成功运行不得附带失败信息",
    });
  }
  if (!succeeded && (run.failureCode === null || run.safeFailureMessage === null)) {
    context.addIssue({
      code: "custom",
      path: ["failureCode"],
      message: "失败运行必须提供安全失败信息",
    });
  }
  if (run.executionMode === "live"
    && (run.providerId === null || run.modelId === null)) {
    context.addIssue({
      code: "custom",
      path: ["providerId"],
      message: "Live 运行必须明确供应方与模型",
    });
  }
  if (run.executionMode === "deterministic_demo"
    && (run.providerId !== null || run.modelId !== null)) {
    context.addIssue({
      code: "custom",
      path: ["providerId"],
      message: "确定性演示不得伪装为外部模型调用",
    });
  }
});
export type SimulationAgentRunV3 = z.infer<
  typeof SimulationAgentRunV3Schema
>;

export interface CreateSimulationDispatchPlanV3Input {
  sessionId: string;
  sourceWorldEventId: string;
  sourceWorldStateVersion: number;
  eventType: string;
  affectedObjectRefs: SimulationObjectReference[];
  candidateAgentTemplateIds: string[];
  templates: SimulationAgentTemplateV3[];
  maxSelected: number;
  createdAt: string;
  dispatchPlanId?: string;
}

function referenceMatches(
  selector: z.infer<typeof SimulationObjectSelectorSchema>,
  reference: SimulationObjectReference,
): boolean {
  return selector.objectType === reference.objectType
    && (selector.objectId === null || selector.objectId === reference.objectId);
}

export function hashSimulationRuntimeValueV3(value: unknown): string {
  const canonical = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(canonical);
    if (item && typeof item === "object") {
      return Object.fromEntries(
        Object.entries(item)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, child]) => [key, canonical(child)]),
      );
    }
    return item;
  };
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

export function createSimulationDispatchPlanV3(
  rawInput: CreateSimulationDispatchPlanV3Input,
): SimulationDispatchPlanV3 {
  const templates = rawInput.templates.map((template) => (
    SimulationAgentTemplateV3Schema.parse(template)
  ));
  if (templates.length === 0 || templates.length > 14) {
    throw new Error("V3 派发目录必须包含 1—14 个智能体");
  }
  if (!Number.isInteger(rawInput.maxSelected)
    || rawInput.maxSelected < 1
    || rawInput.maxSelected > 14) {
    throw new Error("V3 派发预算必须位于 1—14");
  }
  const agentIds = templates.map((template) => template.agentId);
  const templateIds = templates.map((template) => template.agentTemplateId);
  if (new Set(templateIds).size !== templateIds.length) {
    throw new Error("V3 智能体模板 ID 不得重复");
  }

  const candidateOrder = new Map(
    rawInput.candidateAgentTemplateIds.map((templateId, index) => [templateId, index]),
  );
  const duplicateAgents = new Set<string>();
  const firstAgentTemplate = new Map<string, string>();
  for (const template of templates) {
    const first = firstAgentTemplate.get(template.agentId);
    if (first) duplicateAgents.add(template.agentTemplateId);
    else firstAgentTemplate.set(template.agentId, template.agentTemplateId);
  }
  const prelim = templates.map((template) => {
    if (!template.enabled) {
      return { template, selectable: false, reasonCode: "disabled" as const };
    }
    if (!template.available) {
      return { template, selectable: false, reasonCode: "unavailable" as const };
    }
    if (duplicateAgents.has(template.agentTemplateId)) {
      return { template, selectable: false, reasonCode: "deduplicated" as const };
    }
    if (!candidateOrder.has(template.agentTemplateId)
      || !template.subscribedEventTypes.includes(rawInput.eventType)) {
      return { template, selectable: false, reasonCode: "not_affected" as const };
    }
    const objectMatch = template.affectedObjectSelectors.length > 0
      && template.affectedObjectSelectors.some((selector) => (
        rawInput.affectedObjectRefs.some((reference) => (
          referenceMatches(selector, reference)
        ))
      ));
    if (template.affectedObjectSelectors.length > 0 && !objectMatch) {
      return { template, selectable: false, reasonCode: "not_affected" as const };
    }
    return {
      template,
      selectable: true,
      reasonCode: objectMatch
        ? "affected_object_match" as const
        : "event_subscription_match" as const,
    };
  });
  const selectedTemplateIds = new Set(
    prelim
      .filter((item) => item.selectable)
      .sort((left, right) => (
        right.template.dispatchPriority - left.template.dispatchPriority
          || (candidateOrder.get(left.template.agentTemplateId) ?? 99)
            - (candidateOrder.get(right.template.agentTemplateId) ?? 99)
          || left.template.agentTemplateId.localeCompare(
            right.template.agentTemplateId,
          )
      ))
      .slice(0, rawInput.maxSelected)
      .map((item) => item.template.agentTemplateId),
  );
  const reasons: Record<z.infer<typeof DispatchReasonCodeSchema>, string> = {
    event_subscription_match: "订阅当前事件，进入本次必要协作集合。",
    affected_object_match: "职责对象与本事件受影响集合相交，进入本次必要协作集合。",
    not_affected: "职责、事件订阅或受影响对象与本次变化无因果交集。",
    permission_denied: "当前权限边界不允许读取完成该任务所需上下文。",
    budget_limit: "已达到本事件的最小必要智能体预算，本次不调用。",
    deduplicated: "同一智能体已有更明确的模板实例，本次已去重。",
    disabled: "该智能体模板处于禁用状态。",
    unavailable: "该智能体执行能力当前不可用。",
  };
  const decisions = prelim.map((item): SimulationDispatchDecisionV3 => {
    const selected = selectedTemplateIds.has(item.template.agentTemplateId);
    const reasonCode = item.selectable && !selected
      ? "budget_limit"
      : item.reasonCode;
    return {
      agentId: item.template.agentId,
      agentTemplateId: item.template.agentTemplateId,
      professionalRoleId: item.template.professionalRoleId,
      decision: selected ? "selected" : "skipped",
      reasonCode,
      reason: reasons[reasonCode],
    };
  });
  if (new Set(agentIds).size !== agentIds.length) {
    const planAgentIds = decisions.map((decision) => decision.agentId);
    if (new Set(planAgentIds).size !== planAgentIds.length) {
      throw new Error("同一派发计划不能输出重复智能体；请清理目录实例");
    }
  }
  return SimulationDispatchPlanV3Schema.parse({
    schemaVersion: SimulationDispatchPlanV3SchemaVersion,
    dispatchPlanId: rawInput.dispatchPlanId ?? `dispatch-plan-${randomUUID()}`,
    sessionId: rawInput.sessionId,
    sourceWorldEventId: rawInput.sourceWorldEventId,
    sourceWorldStateVersion: rawInput.sourceWorldStateVersion,
    decisions,
    selectedCount: decisions.filter((item) => item.decision === "selected").length,
    skippedCount: decisions.filter((item) => item.decision === "skipped").length,
    createdAt: rawInput.createdAt,
  });
}

export interface SimulationAgentExecutionDraftV3<TEffects = unknown> {
  intentType: string;
  targetObjectRefs: SimulationObjectReference[];
  actionType: string;
  actionPayload: unknown;
  summary: string;
  rationale: string;
  evidenceRefs: string[];
  confidence: number;
  riskLevel: SimulationAgentIntent["riskLevel"];
  requiresTeacherGate: boolean;
  effects: TEffects;
  executionMode: SimulationAgentRunV3["executionMode"];
  providerId: string | null;
  modelId: string | null;
  traceRef: string | null;
  promptTemplateRef: string | null;
  estimatedCostMicrounits: number;
}

export interface SimulationAgentExecutorInputV3 {
  template: SimulationAgentTemplateV3;
  state: AgentState;
  observation: AgentObservation;
  task: SimulationAgentTaskV3;
}

export type SimulationAgentExecutorV3<TEffects = unknown> = (
  input: SimulationAgentExecutorInputV3,
) => Promise<SimulationAgentExecutionDraftV3<TEffects>>;

export interface SimulationAgentRunOutcomeV3<TEffects = unknown> {
  task: SimulationAgentTaskV3;
  run: SimulationAgentRunV3;
  intent: SimulationAgentIntent | null;
  effects: TEffects | null;
  publicSummary: string | null;
  rationale: string | null;
  evidenceRefs: string[];
}

export interface RunSimulationAgentTaskV3Input<TEffects = unknown> {
  template: SimulationAgentTemplateV3;
  state: AgentState;
  observation: AgentObservation;
  task: SimulationAgentTaskV3;
  executor: SimulationAgentExecutorV3<TEffects>;
  now?: () => string;
  monotonicNowMs?: () => number;
  idFactory?: (prefix: string) => string;
}

function safeFailure(error: unknown): { code: string; message: string } {
  if (error && typeof error === "object") {
    const candidate = error as { code?: unknown; message?: unknown };
    const code = typeof candidate.code === "string"
      && /^[a-z0-9][a-z0-9_-]{0,127}$/u.test(candidate.code)
      ? candidate.code
      : "agent_execution_failed";
    const message = typeof candidate.message === "string"
      ? candidate.message.trim().slice(0, 500)
      : "智能体执行失败，世界未发生权威写回。";
    return { code, message: message || "智能体执行失败，世界未发生权威写回。" };
  }
  return {
    code: "agent_execution_failed",
    message: "智能体执行失败，世界未发生权威写回。",
  };
}

export async function runSimulationAgentTaskV3<TEffects = unknown>(
  rawInput: RunSimulationAgentTaskV3Input<TEffects>,
): Promise<SimulationAgentRunOutcomeV3<TEffects>> {
  const template = SimulationAgentTemplateV3Schema.parse(rawInput.template);
  const state = AgentStateSchema.parse(rawInput.state);
  const observation = AgentObservationSchema.parse(rawInput.observation);
  const task = SimulationAgentTaskV3Schema.parse(rawInput.task);
  if (task.status !== "pending") throw new Error("只有待执行任务可以启动运行");
  if (task.agentId !== template.agentId
    || task.agentTemplateId !== template.agentTemplateId
    || task.agentStateId !== state.agentStateId
    || task.observationId !== observation.observationId) {
    throw new Error("V3 Task、AgentState、Observation 与模板身份链不一致");
  }
  const now = rawInput.now ?? (() => new Date().toISOString());
  const monotonicNowMs = rawInput.monotonicNowMs ?? (() => Date.now());
  const idFactory = rawInput.idFactory ?? ((prefix) => `${prefix}-${randomUUID()}`);
  const startedAt = now();
  const startedMs = monotonicNowMs();
  const runningTask = SimulationAgentTaskV3Schema.parse({
    ...task,
    status: "running",
    startedAt,
  });
  const agentRunId = idFactory("agent-run");
  try {
    const draft = await rawInput.executor({
      template,
      state,
      observation,
      task: runningTask,
    });
    if (draft.evidenceRefs.length === 0) {
      throw Object.assign(new Error("智能体贡献缺少可核验依据"), {
        code: "evidence_missing",
      });
    }
    const completedAt = now();
    const intentId = idFactory("intent");
    const outputHash = hashSimulationRuntimeValueV3({
      summary: draft.summary,
      rationale: draft.rationale,
      evidenceRefs: draft.evidenceRefs,
      intentType: draft.intentType,
      targetObjectRefs: draft.targetObjectRefs,
      actionType: draft.actionType,
      actionPayload: draft.actionPayload,
    });
    const effectPayloadHash = hashSimulationRuntimeValueV3(draft.effects);
    const intent = SimulationAgentIntentSchema.parse({
      schemaVersion: SimulationAgentIntentSchemaVersion,
      intentId,
      agentStateId: state.agentStateId,
      agentId: template.agentId,
      professionalRoleId: template.professionalRoleId,
      observationId: observation.observationId,
      agentTaskId: task.agentTaskId,
      agentRunId,
      expectedWorldStateVersion: task.expectedWorldStateVersion,
      intentType: draft.intentType,
      targetObjectRefs: draft.targetObjectRefs,
      rationaleSummary: draft.rationale,
      proposedAction: {
        actionType: draft.actionType,
        payloadHash: hashSimulationRuntimeValueV3(draft.actionPayload),
        evidenceRefs: [...new Set(draft.evidenceRefs)],
      },
      confidence: draft.confidence,
      riskLevel: draft.riskLevel,
      requiresTeacherGate: draft.requiresTeacherGate,
      authority: "proposal_only",
      createdAt: completedAt,
      expiresAt: new Date(new Date(completedAt).getTime() + 30 * 60_000)
        .toISOString(),
    });
    const run = SimulationAgentRunV3Schema.parse({
      schemaVersion: SimulationAgentRunV3SchemaVersion,
      agentRunId,
      agentTaskId: task.agentTaskId,
      sessionId: task.sessionId,
      agentId: task.agentId,
      observationId: observation.observationId,
      status: "succeeded",
      executionMode: draft.executionMode,
      providerId: draft.providerId,
      modelId: draft.modelId,
      traceRef: draft.traceRef,
      promptTemplateRef: draft.promptTemplateRef,
      intentId,
      outputHash,
      effectPayloadHash,
      latencyMs: Math.max(0, Math.round(monotonicNowMs() - startedMs)),
      estimatedCostMicrounits: draft.estimatedCostMicrounits,
      failureCode: null,
      safeFailureMessage: null,
      startedAt,
      completedAt,
    });
    return {
      task: SimulationAgentTaskV3Schema.parse({
        ...runningTask,
        status: "completed",
        completedAt,
      }),
      run,
      intent,
      effects: structuredClone(draft.effects),
      publicSummary: draft.summary.trim(),
      rationale: draft.rationale.trim(),
      evidenceRefs: [...new Set(draft.evidenceRefs)],
    };
  } catch (error) {
    const completedAt = now();
    const failure = safeFailure(error);
    return {
      task: SimulationAgentTaskV3Schema.parse({
        ...runningTask,
        status: "failed",
        completedAt,
        failureCode: failure.code,
      }),
      run: SimulationAgentRunV3Schema.parse({
        schemaVersion: SimulationAgentRunV3SchemaVersion,
        agentRunId,
        agentTaskId: task.agentTaskId,
        sessionId: task.sessionId,
        agentId: task.agentId,
        observationId: observation.observationId,
        status: "failed",
        executionMode: "degraded",
        providerId: null,
        modelId: null,
        traceRef: null,
        promptTemplateRef: null,
        intentId: null,
        outputHash: null,
        effectPayloadHash: null,
        latencyMs: Math.max(0, Math.round(monotonicNowMs() - startedMs)),
        estimatedCostMicrounits: 0,
        failureCode: failure.code,
        safeFailureMessage: failure.message,
        startedAt,
        completedAt,
      }),
      intent: null,
      effects: null,
      publicSummary: null,
      rationale: null,
      evidenceRefs: [],
    };
  }
}
