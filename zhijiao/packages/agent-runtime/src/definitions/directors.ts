import {
  AgentDefinitionSchema,
  AgentSubscriptionSchema,
  ExecutableAgentIntentSchema,
  createMessageMeta,
  type AgentRunRequest,
  type ExecutableAgentIntent,
  type ModelInvocationTrace,
  type TeachingStrategy,
} from "@ronggang/contracts";
import {
  ModelInvocationError,
  type StructuredModelPort,
} from "@ronggang/model-gateway";
import { z } from "zod";
import { compileAgentPrompt, type AgentPromptTemplate } from "../prompt.js";
import {
  AgentRuntimeExecutionError,
  type AgentNodeExecutor,
} from "../runtime.js";

const teachingDefinitionVersion = "teaching-director/1.0.0";
const sceneDefinitionVersion = "scene-director/1.0.0";
const directorPromptVersion = "1.0.0";

export const teachingDirectorSubscription = AgentSubscriptionSchema.parse({
  subscriptionId: "teaching-director/world-progress/v1",
  agentId: "agent-teaching",
  roleId: "teaching_director",
  definitionVersion: teachingDefinitionVersion,
  promptVersion: directorPromptVersion,
  eventTypes: [
    "session_started",
    "node_activated",
    "world_fact_confirmed",
    "world_fact_updated",
    "evidence_recorded",
    "copyright_risk_flagged",
    "publication_paused",
  ],
  targetActorIdField: null,
  maxCausalDepth: 6,
  priority: 90,
  enabled: true,
});

export const sceneDirectorSubscription = AgentSubscriptionSchema.parse({
  subscriptionId: "scene-director/world-pressure/v1",
  agentId: "agent-scene-director",
  roleId: "scene_director",
  definitionVersion: sceneDefinitionVersion,
  promptVersion: directorPromptVersion,
  eventTypes: [
    "session_started",
    "node_activated",
    "world_fact_confirmed",
    "world_fact_updated",
    "director_recovery_requested",
  ],
  targetActorIdField: null,
  maxCausalDepth: 6,
  priority: 80,
  enabled: true,
});

export const teachingDirectorAgentDefinition = AgentDefinitionSchema.parse({
  agentId: "agent-teaching",
  roleId: "teaching_director",
  definitionVersion: teachingDefinitionVersion,
  promptVersion: directorPromptVersion,
  entryNodeId: "progress-router",
  allowedTriggers: teachingDirectorSubscription.eventTypes,
  allowedIntents: ["record_teaching_directive"],
  maxSteps: 3,
  maxToolCalls: 0,
  timeoutMs: 10_000,
  nodes: [
    { nodeId: "progress-router", kind: "router", label: "按证据与难度判断教学策略", executorKey: null, promptTemplateId: null, toolName: null },
    { nodeId: "procedural-hint", kind: "rule", label: "操作提示路线", executorKey: "teaching-director/emit", promptTemplateId: null, toolName: null },
    { nodeId: "socratic-prompt", kind: "rule", label: "苏格拉底追问路线", executorKey: "teaching-director/emit", promptTemplateId: null, toolName: null },
    { nodeId: "challenge", kind: "rule", label: "增加岗位压力路线", executorKey: "teaching-director/emit", promptTemplateId: null, toolName: null },
    { nodeId: "scaffold", kind: "rule", label: "提供任务支架路线", executorKey: "teaching-director/emit", promptTemplateId: null, toolName: null },
    { nodeId: "teacher-gate", kind: "guard", label: "建议教师介入路线", executorKey: "teaching-director/emit", promptTemplateId: null, toolName: null },
    { nodeId: "observe-more", kind: "rule", label: "继续观察路线", executorKey: "teaching-director/emit", promptTemplateId: null, toolName: null },
    { nodeId: "no-intervention", kind: "rule", label: "无干预审计路线", executorKey: "teaching-director/emit", promptTemplateId: null, toolName: null },
    { nodeId: "done", kind: "terminal", label: "返回结构化教学指令", executorKey: null, promptTemplateId: null, toolName: null },
  ],
  edges: [
    { edgeId: "route-procedural", from: "progress-router", to: "procedural-hint", priority: 100, condition: { kind: "signal_equals", key: "teachingStrategy", value: "procedural_hint" } },
    { edgeId: "route-socratic", from: "progress-router", to: "socratic-prompt", priority: 90, condition: { kind: "signal_equals", key: "teachingStrategy", value: "socratic_prompt" } },
    { edgeId: "route-challenge", from: "progress-router", to: "challenge", priority: 80, condition: { kind: "signal_equals", key: "teachingStrategy", value: "challenge" } },
    { edgeId: "route-scaffold", from: "progress-router", to: "scaffold", priority: 70, condition: { kind: "signal_equals", key: "teachingStrategy", value: "scaffold" } },
    { edgeId: "route-teacher-gate", from: "progress-router", to: "teacher-gate", priority: 60, condition: { kind: "signal_equals", key: "teachingStrategy", value: "teacher_gate" } },
    { edgeId: "route-observe", from: "progress-router", to: "observe-more", priority: 50, condition: { kind: "signal_equals", key: "teachingStrategy", value: "observe_more" } },
    { edgeId: "route-no-intervention", from: "progress-router", to: "no-intervention", priority: 0, condition: { kind: "always" } },
    { edgeId: "procedural-done", from: "procedural-hint", to: "done", priority: 0, condition: { kind: "always" } },
    { edgeId: "socratic-done", from: "socratic-prompt", to: "done", priority: 0, condition: { kind: "always" } },
    { edgeId: "challenge-done", from: "challenge", to: "done", priority: 0, condition: { kind: "always" } },
    { edgeId: "scaffold-done", from: "scaffold", to: "done", priority: 0, condition: { kind: "always" } },
    { edgeId: "teacher-gate-done", from: "teacher-gate", to: "done", priority: 0, condition: { kind: "always" } },
    { edgeId: "observe-done", from: "observe-more", to: "done", priority: 0, condition: { kind: "always" } },
    { edgeId: "no-intervention-done", from: "no-intervention", to: "done", priority: 0, condition: { kind: "always" } },
  ],
});

export const sceneDirectorPromptTemplate: AgentPromptTemplate = {
  templateId: "scene-director/route-selection",
  version: directorPromptVersion,
  system: "你是地方文旅融媒体实训的情境导演。你只能从服务器给出的候选 routeId 中选择一条，并给出简短、可审计的业务理由。",
  instructions: [
    "不得生成世界事实、事件载荷、effect handler 或标准答案。",
    "不得引用未出现在授权上下文中的私有信息。",
    "优先选择能覆盖当前能力目标、且风险不超过教师策略的路线。",
    "若候选路线存在冲突，只返回一个 routeId。",
  ],
  outputContract: [
    "只返回 JSON 对象，不要 Markdown 或隐藏推理。",
    "字段固定为 routeId、rationaleSummary、confidence。",
    "routeId 必须逐字匹配授权候选列表。",
    "confidence 为 0 到 1。",
  ].join("\n"),
};

export const sceneDirectorAgentDefinition = AgentDefinitionSchema.parse({
  agentId: "agent-scene-director",
  roleId: "scene_director",
  definitionVersion: sceneDefinitionVersion,
  promptVersion: directorPromptVersion,
  entryNodeId: "route-router",
  allowedTriggers: sceneDirectorSubscription.eventTypes,
  allowedIntents: ["propose_scenario_intervention", "record_scene_no_op"],
  maxSteps: 5,
  maxToolCalls: 0,
  timeoutMs: 30_000,
  nodes: [
    { nodeId: "route-router", kind: "router", label: "判断模板、复杂规划或无动作", executorKey: null, promptTemplateId: null, toolName: null },
    { nodeId: "safe-template", kind: "rule", label: "确定性安全模板", executorKey: "scene-director/template", promptTemplateId: null, toolName: null },
    { nodeId: "complex-planner", kind: "model", label: "复杂路线选择模型", executorKey: "scene-director/model", promptTemplateId: sceneDirectorPromptTemplate.templateId, toolName: null },
    { nodeId: "route-guard", kind: "guard", label: "路线白名单与置信度守卫", executorKey: "scene-director/guard", promptTemplateId: null, toolName: null },
    { nodeId: "safe-fallback", kind: "rule", label: "模型失败安全降级", executorKey: "scene-director/fallback", promptTemplateId: null, toolName: null },
    { nodeId: "no-op", kind: "rule", label: "显式 no_op", executorKey: "scene-director/no-op", promptTemplateId: null, toolName: null },
    { nodeId: "done", kind: "terminal", label: "返回导演决策", executorKey: null, promptTemplateId: null, toolName: null },
  ],
  edges: [
    { edgeId: "route-no-op", from: "route-router", to: "no-op", priority: 100, condition: { kind: "signal_equals", key: "directorAction", value: "no_op" } },
    { edgeId: "route-complex-model", from: "route-router", to: "complex-planner", priority: 90, condition: { kind: "signal_equals", key: "selectionMode", value: "model" } },
    { edgeId: "route-safe-template", from: "route-router", to: "safe-template", priority: 0, condition: { kind: "always" } },
    { edgeId: "template-guard", from: "safe-template", to: "route-guard", priority: 100, condition: { kind: "last_status_equals", value: "success" } },
    { edgeId: "template-fallback", from: "safe-template", to: "safe-fallback", priority: 0, condition: { kind: "always" } },
    { edgeId: "model-guard", from: "complex-planner", to: "route-guard", priority: 100, condition: { kind: "last_status_equals", value: "success" } },
    { edgeId: "model-fallback", from: "complex-planner", to: "safe-fallback", priority: 0, condition: { kind: "always" } },
    { edgeId: "guard-done", from: "route-guard", to: "done", priority: 100, condition: { kind: "last_status_equals", value: "success" } },
    { edgeId: "guard-fallback", from: "route-guard", to: "safe-fallback", priority: 0, condition: { kind: "always" } },
    { edgeId: "fallback-done", from: "safe-fallback", to: "done", priority: 0, condition: { kind: "always" } },
    { edgeId: "no-op-done", from: "no-op", to: "done", priority: 0, condition: { kind: "always" } },
  ],
});

const SceneRouteModelOutputSchema = z.object({
  routeId: z.string().min(1),
  rationaleSummary: z.string().min(1).max(800),
  confidence: z.number().min(0).max(1),
}).strict();

export type SceneRouteModelOutput = z.infer<typeof SceneRouteModelOutputSchema> & {
  modelTrace?: ModelInvocationTrace;
};

export interface SceneDirectorModelPort {
  invoke(input: {
    request: AgentRunRequest;
    systemPrompt: string;
    userPrompt: string;
  }): Promise<SceneRouteModelOutput>;
}

function allowedRouteIds(request: AgentRunRequest): string[] {
  return String(request.signals.allowedRouteIds ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export class DeterministicSceneDirectorModel implements SceneDirectorModelPort {
  async invoke(input: {
    request: AgentRunRequest;
    systemPrompt: string;
    userPrompt: string;
  }): Promise<SceneRouteModelOutput> {
    const routeId = allowedRouteIds(input.request)[0];
    if (!routeId) {
      throw new AgentRuntimeExecutionError("eligible_route_missing", "没有可选择的情境路线");
    }
    return {
      routeId,
      rationaleSummary: "按能力目标、证据覆盖与教师难度策略选择优先级最高的受控路线。",
      confidence: 1,
    };
  }
}

export class GatewaySceneDirectorModel implements SceneDirectorModelPort {
  readonly #provider: StructuredModelPort;
  readonly #profileId: string;
  readonly #timeoutMs: number;

  constructor(input: {
    provider: StructuredModelPort;
    profileId?: string;
    timeoutMs?: number;
  }) {
    this.#provider = input.provider;
    this.#profileId = input.profileId ?? input.provider.health().profileId;
    this.#timeoutMs = input.timeoutMs ?? 20_000;
  }

  async invoke(input: {
    request: AgentRunRequest;
    systemPrompt: string;
    userPrompt: string;
  }): Promise<SceneRouteModelOutput> {
    try {
      const result = await this.#provider.invoke({
        invocationId: `${input.request.agentRunId}:scene-route-model`,
        profileId: this.#profileId,
        taskKind: "scene_director_route",
        systemPrompt: input.systemPrompt,
        userPrompt: input.userPrompt,
        outputContractId: "scene-director-route/v1",
        outputMode: "json_object",
        temperature: 0.2,
        maxOutputTokens: 500,
        timeoutMs: this.#timeoutMs,
      });
      const parsed = SceneRouteModelOutputSchema.safeParse(result.output);
      if (!parsed.success) {
        throw new AgentRuntimeExecutionError(
          "model_output_schema_invalid:scene_director_route",
          "情境导演模型输出未通过路线 Schema",
          {
            modelCalls: 1,
            modelInvocations: [result.trace],
            inputTokens: result.trace.tokenUsage.input ?? 0,
            outputTokens: result.trace.tokenUsage.output ?? 0,
          },
        );
      }
      if (!allowedRouteIds(input.request).includes(parsed.data.routeId)) {
        throw new AgentRuntimeExecutionError(
          "model_route_not_allowed",
          "情境导演模型选择了白名单之外的路线",
          {
            modelCalls: 1,
            modelInvocations: [result.trace],
            inputTokens: result.trace.tokenUsage.input ?? 0,
            outputTokens: result.trace.tokenUsage.output ?? 0,
          },
        );
      }
      return { ...parsed.data, modelTrace: result.trace };
    } catch (error) {
      if (error instanceof AgentRuntimeExecutionError) throw error;
      if (error instanceof ModelInvocationError) {
        throw new AgentRuntimeExecutionError(
          error.code,
          "情境导演模型提供方调用失败",
          {
            modelCalls: 1,
            modelInvocations: [error.trace],
            inputTokens: error.trace.tokenUsage.input ?? 0,
            outputTokens: error.trace.tokenUsage.output ?? 0,
          },
        );
      }
      throw error;
    }
  }
}

function stringSignal(request: AgentRunRequest, key: string, fallback = ""): string {
  const value = request.signals[key];
  return typeof value === "string" ? value : fallback;
}

function booleanSignal(
  request: AgentRunRequest,
  key: string,
  fallback: boolean,
): boolean {
  const value = request.signals[key];
  return typeof value === "boolean" ? value : fallback;
}

function createDirectorIntent(input: {
  request: AgentRunRequest;
  intentType: "propose_scenario_intervention" | "record_scene_no_op";
  rationaleSummary: string;
  proposedPayload: Record<string, unknown>;
  confidence: number;
  citationRefs?: string[];
  riskLevel?: "low" | "medium" | "high";
  requiresTeacherReview: boolean;
}): ExecutableAgentIntent {
  return ExecutableAgentIntentSchema.parse({
    ...createMessageMeta({
      sessionId: input.request.sessionId,
      sceneId: input.request.sceneId,
      actorId: input.request.actorId,
      correlationId: input.request.correlationId,
      timestamp: input.request.timestamp,
    }),
    kind: "AgentIntent",
    intentId: `intent-${input.request.agentRunId}`,
    agentRunId: input.request.agentRunId,
    roleId: input.request.role.roleId,
    intentType: input.intentType,
    rationaleSummary: input.rationaleSummary,
    proposedPayload: input.proposedPayload,
    expectedStateVersion: input.request.stateVersion,
    causationEventIds: [input.request.trigger.sourceId],
    evidenceRefs: stringSignal(input.request, "evidenceRefs")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    citationRefs: input.citationRefs ?? [],
    toolResultRefs: [],
    confidence: input.confidence,
    riskLevel: input.riskLevel ?? "low",
    requiresTeacherReview: input.requiresTeacherReview,
    visibility: ["teacher_only", "audit_only"],
    visibleToActorIds: [],
    idempotencyKey: `${input.request.sessionId}:${input.request.trigger.sourceId}:${input.request.actorId}:${input.intentType}`,
    expiresAt: null,
  });
}

function sceneProposalIntent(
  request: AgentRunRequest,
  routeId: string,
  rationaleSummary: string,
  confidence: number,
  selectionOutcome: "candidate" | "fallback",
  citationRefs: string[],
): ExecutableAgentIntent {
  return createDirectorIntent({
    request,
    intentType: "propose_scenario_intervention",
    rationaleSummary,
    proposedPayload: {
      routeId,
      reasonCode: stringSignal(request, "reasonCode", "eligible_route_selected"),
      selectionOutcome,
      teachingDirectiveId: stringSignal(request, "teachingDirectiveId") || null,
      recoveryOfCandidateId: stringSignal(request, "recoveryOfCandidateId") || null,
    },
    confidence,
    citationRefs,
    riskLevel: stringSignal(request, "selectedRiskLevel", "low") as "low" | "medium" | "high",
    requiresTeacherReview: true,
  });
}

function sceneNoOpIntent(request: AgentRunRequest): ExecutableAgentIntent {
  return createDirectorIntent({
    request,
    intentType: "record_scene_no_op",
    rationaleSummary: stringSignal(
      request,
      "rationaleSummary",
      "当前没有满足节点、证据、难度与冷却约束的必要事件。",
    ),
    proposedPayload: {
      reasonCode: stringSignal(request, "reasonCode", "no_matching_route"),
      teachingDirectiveId: stringSignal(request, "teachingDirectiveId") || null,
      recoveryOfCandidateId: stringSignal(request, "recoveryOfCandidateId") || null,
      evaluatedRouteIds: allowedRouteIds(request),
    },
    confidence: 1,
    requiresTeacherReview: false,
  });
}

export function createTeachingDirectorHandlers(): ReadonlyMap<string, AgentNodeExecutor> {
  const handlers = new Map<string, AgentNodeExecutor>();
  handlers.set("teaching-director/emit", async ({ request }) => {
    const strategy = stringSignal(request, "teachingStrategy", "no_intervention") as TeachingStrategy;
    const targetRoleIds = stringSignal(request, "targetRoleIds")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const intent = ExecutableAgentIntentSchema.parse({
      ...createMessageMeta({
        sessionId: request.sessionId,
        sceneId: request.sceneId,
        actorId: request.actorId,
        correlationId: request.correlationId,
        timestamp: request.timestamp,
      }),
      kind: "AgentIntent",
      intentId: `intent-${request.agentRunId}`,
      agentRunId: request.agentRunId,
      roleId: request.role.roleId,
      intentType: "record_teaching_directive",
      rationaleSummary: stringSignal(request, "rationaleSummary", "继续观察当前岗位表现。"),
      proposedPayload: {
        strategy,
        reasonCode: stringSignal(request, "reasonCode", "progress_observed"),
        targetCompetency: stringSignal(request, "targetCompetency", "岗位决策与证据意识"),
        recommendedDifficulty: stringSignal(request, "difficulty", "standard"),
        targetRoleIds,
        handoffToSceneDirector: booleanSignal(
          request,
          "handoffToSceneDirector",
          ["scaffold", "challenge", "teacher_gate"].includes(strategy),
        ),
      },
      expectedStateVersion: request.stateVersion,
      causationEventIds: [request.trigger.sourceId],
      evidenceRefs: stringSignal(request, "evidenceRefs")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      citationRefs: request.contextManifest.includedCitationRefs,
      toolResultRefs: [],
      confidence: 1,
      riskLevel: "low",
      requiresTeacherReview: false,
      visibility: ["teacher_only", "audit_only"],
      visibleToActorIds: [],
      idempotencyKey: `${request.sessionId}:${request.trigger.sourceId}:${request.actorId}:teaching-directive`,
      expiresAt: null,
    });
    return { intent, signals: { teachingStrategy: strategy } };
  });
  return handlers;
}

export function createSceneDirectorHandlers(
  model: SceneDirectorModelPort = new DeterministicSceneDirectorModel(),
): ReadonlyMap<string, AgentNodeExecutor> {
  const handlers = new Map<string, AgentNodeExecutor>();

  handlers.set("scene-director/template", async ({ request }) => {
    const routeId = stringSignal(request, "selectedRouteId");
    if (!routeId || !allowedRouteIds(request).includes(routeId)) {
      throw new AgentRuntimeExecutionError("safe_route_missing", "确定性模板路线不存在");
    }
    return {
      intent: sceneProposalIntent(
        request,
        routeId,
        stringSignal(request, "rationaleSummary", "受控模板满足当前节点、证据与难度条件。"),
        1,
        "candidate",
        request.contextManifest.includedCitationRefs,
      ),
      signals: { selectedRouteId: routeId, selectionOutcome: "candidate" },
    };
  });

  handlers.set("scene-director/model", async ({ request }) => {
    const prompt = compileAgentPrompt(sceneDirectorPromptTemplate, request);
    const output = await model.invoke({
      request,
      systemPrompt: prompt.systemPrompt,
      userPrompt: prompt.userPrompt,
    });
    return {
      intent: sceneProposalIntent(
        request,
        output.routeId,
        output.rationaleSummary,
        output.confidence,
        "candidate",
        prompt.includedReferenceIds,
      ),
      signals: {
        selectedRouteId: output.routeId,
        modelConfidence: output.confidence,
        promptContextHash: prompt.contextHash,
        promptHash: prompt.promptHash,
        selectionOutcome: "candidate",
      },
      metrics: {
        modelCalls: 1,
        modelInvocations: output.modelTrace ? [output.modelTrace] : [],
        inputTokens: output.modelTrace?.tokenUsage.input ?? prompt.estimatedInputTokens,
        outputTokens: output.modelTrace?.tokenUsage.output ?? Math.ceil(JSON.stringify(output).length / 4),
      },
    };
  });

  handlers.set("scene-director/guard", async ({ request, intent }) => {
    if (!intent) throw new AgentRuntimeExecutionError("director_intent_missing", "情境导演没有输出结构化意图");
    const routeId = String(intent.proposedPayload.routeId ?? "");
    if (!allowedRouteIds(request).includes(routeId)) {
      throw new AgentRuntimeExecutionError("director_route_not_allowed", "情境导演路线不在本次白名单");
    }
    if (intent.confidence < 0.65) {
      throw new AgentRuntimeExecutionError("director_confidence_low", "情境导演路线置信度不足");
    }
    return { signals: { routeGuardPassed: true } };
  });

  handlers.set("scene-director/fallback", async ({ request }) => {
    const routeId = stringSignal(request, "fallbackRouteId");
    if (!routeId || !allowedRouteIds(request).includes(routeId)) {
      return {
        intent: sceneNoOpIntent(request),
        signals: { fallbackReason: "no_safe_fallback", selectionOutcome: "no_op" },
      };
    }
    return {
      intent: sceneProposalIntent(
        request,
        routeId,
        "复杂规划未通过校验，已降级到优先级最高的受控安全模板。",
        1,
        "fallback",
        request.contextManifest.includedCitationRefs,
      ),
      signals: {
        selectedRouteId: routeId,
        fallbackReason: "model_or_guard_failed",
        selectionOutcome: "fallback",
      },
    };
  });

  handlers.set("scene-director/no-op", async ({ request }) => ({
    intent: sceneNoOpIntent(request),
    signals: { selectionOutcome: "no_op" },
  }));

  return handlers;
}
