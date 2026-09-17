import {
  AgentDefinitionSchema,
  AgentSubscriptionSchema,
  ExecutableAgentIntentSchema,
  WorldFactSchema,
  createMessageMeta,
  type AgentRunRequest,
  type ExecutableAgentIntent,
  type ModelInvocationTrace,
} from "@ronggang/contracts";
import {
  ModelInvocationError,
  type StructuredModelPort,
} from "@ronggang/model-gateway";
import { z } from "zod";
import { compileAgentPrompt, type AgentPromptTemplate } from "../prompt.js";
import { AgentRuntime, AgentRuntimeExecutionError, type AgentNodeExecutor } from "../runtime.js";

export const factCheckerSubscription = AgentSubscriptionSchema.parse({
  subscriptionId: "fact-checker/material-observed/v1",
  agentId: "agent-fact-checker",
  roleId: "fact_checker",
  definitionVersion: "fact-checker/1.2.0",
  promptVersion: "1.2.0",
  eventTypes: ["material_observed"],
  targetActorIdField: null,
  maxCausalDepth: 4,
  priority: 100,
  enabled: true,
});

export const factCheckerPromptTemplate: AgentPromptTemplate = {
  templateId: "fact-checker/system",
  version: "1.2.0",
  system: "你是地方文旅融媒体报道情境中的事实核查员。只处理被分配的声明与可见来源。",
  instructions: [
    "Observation 只是观察，不自动成为权威事实。",
    "不能用图片中的人群密度证明具体客流数字。",
    "更正必须保留旧值、新值、统计口径、来源引用和置信度。",
    "单一来源不足时输出 ask_for_evidence，不得猜测数值。",
    "只提出业务内容草稿；factId、事实状态、版本、可见范围、后续节点和最终来源由受信任运行时构造。",
    "不得直接生成 WorldEvent，不得输出隐藏推理，只输出简短 rationaleSummary。",
  ],
  outputContract: [
    "只返回一个 JSON 对象，不要 Markdown、解释或代码围栏。",
    "字段固定为 intentType、rationaleSummary、proposedPayload、confidence。",
    "intentType 只能是 propose_data_correction 或 ask_for_evidence。",
    "propose_data_correction 的 proposedPayload 只能包含 statement；statement 必须写清新值、统计口径和来源依据。",
    "ask_for_evidence 的 proposedPayload 必须列出 requestedEvidence。",
    "更正示例：{\"intentType\":\"propose_data_correction\",\"rationaleSummary\":\"入口去重表支持修正。\",\"proposedPayload\":{\"statement\":\"截至14:20，按唯一票务标识去重后的有效客流为12,600人次。\"},\"confidence\":0.9}",
    "补证示例：{\"intentType\":\"ask_for_evidence\",\"rationaleSummary\":\"缺少独立来源。\",\"proposedPayload\":{\"requestedEvidence\":[\"入口去重表\"]},\"confidence\":0.8}",
  ].join("\n"),
};

export const factCheckerAgentDefinition = AgentDefinitionSchema.parse({
  agentId: "agent-fact-checker",
  roleId: "fact_checker",
  definitionVersion: "fact-checker/1.2.0",
  promptVersion: factCheckerPromptTemplate.version,
  entryNodeId: "claim-router",
  allowedTriggers: ["material_observed"],
  allowedIntents: ["propose_data_correction", "ask_for_evidence"],
  maxSteps: 6,
  maxToolCalls: 0,
  timeoutMs: 30_000,
  nodes: [
    { nodeId: "claim-router", kind: "router", label: "判断是否存在待核声明", executorKey: null, promptTemplateId: null, toolName: null },
    { nodeId: "source-retrieval", kind: "retrieval", label: "读取授权来源与核验规则", executorKey: "fact-checker/retrieve", promptTemplateId: null, toolName: null },
    { nodeId: "correction-model", kind: "model", label: "形成结构化更正意图", executorKey: "fact-checker/model", promptTemplateId: factCheckerPromptTemplate.templateId, toolName: null },
    { nodeId: "intent-guard", kind: "guard", label: "校验来源、置信度和意图范围", executorKey: "fact-checker/guard", promptTemplateId: null, toolName: null },
    { nodeId: "safe-fallback", kind: "rule", label: "证据不足时请求补证", executorKey: "fact-checker/fallback", promptTemplateId: null, toolName: null },
    { nodeId: "done", kind: "terminal", label: "返回受控意图或无动作", executorKey: null, promptTemplateId: null, toolName: null },
  ],
  edges: [
    { edgeId: "route-needs-check", from: "claim-router", to: "source-retrieval", priority: 100, condition: { kind: "signal_equals", key: "needsVerification", value: true } },
    { edgeId: "route-no-op", from: "claim-router", to: "done", priority: 0, condition: { kind: "always" } },
    { edgeId: "retrieval-ok", from: "source-retrieval", to: "correction-model", priority: 100, condition: { kind: "last_status_equals", value: "success" } },
    { edgeId: "retrieval-fallback", from: "source-retrieval", to: "safe-fallback", priority: 0, condition: { kind: "always" } },
    { edgeId: "model-ok", from: "correction-model", to: "intent-guard", priority: 100, condition: { kind: "last_status_equals", value: "success" } },
    { edgeId: "model-fallback", from: "correction-model", to: "safe-fallback", priority: 0, condition: { kind: "always" } },
    { edgeId: "guard-ok", from: "intent-guard", to: "done", priority: 100, condition: { kind: "last_status_equals", value: "success" } },
    { edgeId: "guard-fallback", from: "intent-guard", to: "safe-fallback", priority: 0, condition: { kind: "always" } },
    { edgeId: "fallback-done", from: "safe-fallback", to: "done", priority: 0, condition: { kind: "always" } },
  ],
});

const FactCheckerModelDraftSchema = z.discriminatedUnion("intentType", [
  z.object({
    intentType: z.literal("propose_data_correction"),
    rationaleSummary: z.string().min(1).max(800),
    proposedPayload: z.object({
      statement: z.string().min(1).max(1_200),
    }).strict(),
    confidence: z.number().min(0).max(1),
  }).strict(),
  z.object({
    intentType: z.literal("ask_for_evidence"),
    rationaleSummary: z.string().min(1).max(800),
    proposedPayload: z.object({
      requestedEvidence: z.array(z.string().min(1)).min(1),
    }).strict(),
    confidence: z.number().min(0).max(1),
  }).strict(),
]);

const FactCheckerModelOutputSchema = z.discriminatedUnion("intentType", [
  z.object({
    intentType: z.literal("propose_data_correction"),
    rationaleSummary: z.string().min(1).max(800),
    proposedPayload: z.object({
      fact: WorldFactSchema,
      supersedesFactId: z.string().min(1),
      nextNodeId: z.string().min(1),
    }).strict(),
    confidence: z.number().min(0).max(1),
  }).strict(),
  z.object({
    intentType: z.literal("ask_for_evidence"),
    rationaleSummary: z.string().min(1).max(800),
    proposedPayload: z.object({
      requestedEvidence: z.array(z.string().min(1)).min(1),
    }).strict(),
    confidence: z.number().min(0).max(1),
  }).strict(),
]);

function nextFactId(currentFactId: string): string {
  const match = /^(.*-v)(\d+)$/u.exec(currentFactId);
  if (!match) return `${currentFactId}-next`;
  return `${match[1]}${Number(match[2]) + 1}`;
}

function nextFactVersion(currentVersion: string): string {
  const match = /^(\d+)(?:\.(\d+))?$/u.exec(currentVersion);
  if (!match) return "2.0";
  return `${Number(match[1]) + 1}.0`;
}

function normalizeModelDraft(
  draft: z.infer<typeof FactCheckerModelDraftSchema>,
  request: AgentRunRequest,
): z.infer<typeof FactCheckerModelOutputSchema> {
  if (draft.intentType === "ask_for_evidence") {
    return FactCheckerModelOutputSchema.parse(draft);
  }
  const currentFactId = typeof request.signals.currentFactId === "string"
    ? request.signals.currentFactId
    : "fact-visitors-v1";
  const currentFactVersion = typeof request.signals.currentFactVersion === "string"
    ? request.signals.currentFactVersion
    : "1.0";
  const currentFactDomain = typeof request.signals.currentFactDomain === "string"
    ? request.signals.currentFactDomain
    : "audience";
  const sourceRefs = Array.from(new Set([
    ...request.context.retrieved.flatMap((item) => item.sourceRefs.map((source) => source.source)),
    request.trigger.sourceId,
  ]));
  return FactCheckerModelOutputSchema.parse({
    intentType: draft.intentType,
    rationaleSummary: draft.rationaleSummary,
    proposedPayload: {
      fact: {
        factId: nextFactId(currentFactId),
        domain: currentFactDomain,
        statement: draft.proposedPayload.statement,
        status: "verified",
        sourceRefs,
        version: nextFactVersion(currentFactVersion),
        visibility: "assigned_team",
      },
      supersedesFactId: currentFactId,
      nextNodeId: "verification",
    },
    confidence: draft.confidence,
  });
}

function modelOutputSchemaErrorCode(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "model_output_schema_invalid";
  const path = issue.path
    .map((segment) => typeof segment === "number" ? "item" : segment)
    .join(".");
  return [
    "model_output_schema_invalid",
    path || "root",
    issue.code,
  ].join(":");
}

export type FactCheckerModelOutput = z.infer<typeof FactCheckerModelOutputSchema> & {
  modelTrace?: ModelInvocationTrace;
};

export interface FactCheckerModelPort {
  invoke(input: {
    request: AgentRunRequest;
    systemPrompt: string;
    userPrompt: string;
  }): Promise<FactCheckerModelOutput>;
}

export class GatewayFactCheckerModel implements FactCheckerModelPort {
  readonly #provider: StructuredModelPort;
  readonly #profileId: string;
  readonly #timeoutMs: number;
  readonly #maxOutputTokens: number;

  constructor(input: {
    provider: StructuredModelPort;
    profileId?: string;
    timeoutMs?: number;
    maxOutputTokens?: number;
  }) {
    this.#provider = input.provider;
    this.#profileId = input.profileId ?? input.provider.health().profileId;
    this.#timeoutMs = input.timeoutMs ?? 20_000;
    this.#maxOutputTokens = input.maxOutputTokens ?? 1_200;
  }

  async invoke(input: {
    request: AgentRunRequest;
    systemPrompt: string;
    userPrompt: string;
  }): Promise<FactCheckerModelOutput> {
    try {
      const result = await this.#provider.invoke({
        invocationId: `${input.request.agentRunId}:fact-checker-model`,
        profileId: this.#profileId,
        taskKind: "fact_checker",
        systemPrompt: input.systemPrompt,
        userPrompt: input.userPrompt,
        outputContractId: "fact-checker-output/v1",
        outputMode: "json_object",
        temperature: 0,
        maxOutputTokens: this.#maxOutputTokens,
        timeoutMs: this.#timeoutMs,
      });
      const parsed = FactCheckerModelDraftSchema.safeParse(result.output);
      if (!parsed.success) {
        throw new AgentRuntimeExecutionError(
          modelOutputSchemaErrorCode(parsed.error),
          "事实核查模型输出未通过业务 Schema",
          {
            modelCalls: 1,
            modelInvocations: [result.trace],
            inputTokens: result.trace.tokenUsage.input ?? 0,
            outputTokens: result.trace.tokenUsage.output ?? 0,
          },
        );
      }
      const normalized = normalizeModelDraft(parsed.data, input.request);
      return {
        ...normalized,
        modelTrace: result.trace,
      };
    } catch (error) {
      if (error instanceof AgentRuntimeExecutionError) throw error;
      if (error instanceof ModelInvocationError) {
        throw new AgentRuntimeExecutionError(
          error.code,
          "事实核查模型提供方调用失败",
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

/*
 * 事实核查专用端口保留为领域适配缝；供应方调用统一进入 GatewayFactCheckerModel，
 * 运行时仍只消费下列受限业务草稿并自行构造身份、因果、权限与状态版本。
 */
type FactCheckerBusinessOutput = {
  intentType: "propose_data_correction" | "ask_for_evidence";
  rationaleSummary: string;
  proposedPayload: Record<string, unknown>;
  confidence: number;
};

export class DeterministicFactCheckerModel implements FactCheckerModelPort {
  async invoke(input: {
    request: AgentRunRequest;
    systemPrompt: string;
    userPrompt: string;
  }): Promise<FactCheckerModelOutput> {
    const oldValue = Number(input.request.signals.currentValue ?? 0);
    const correctionSource = input.request.context.retrieved.find((item) => /有效客流为[\d,]+人次/u.test(item.content));
    const proposedValueText = correctionSource?.content.match(/有效客流为([\d,]+)人次/u)?.[1] ?? "";
    const proposedValue = Number(proposedValueText.replaceAll(",", ""));
    const sourceRef = correctionSource?.sourceRefs[0]?.source ?? "";
    if (!oldValue || !proposedValue || !sourceRef) {
      return {
        intentType: "ask_for_evidence",
        rationaleSummary: "当前调用缺少可核验数值或来源，需要补充证据。",
        proposedPayload: { requestedEvidence: ["当前客流数值", "入口去重表或独立来源"] },
        confidence: 1,
      };
    }
    return {
      intentType: "propose_data_correction",
      rationaleSummary: `初版 ${oldValue.toLocaleString("en-US")} 人次与入口去重口径冲突，授权来源支持更正为 ${proposedValue.toLocaleString("en-US")} 人次。`,
      proposedPayload: {
        fact: {
          factId: "fact-visitors-v2",
          domain: "audience",
          statement: `活动执行方复核后确认，截至14:20有效客流为${proposedValue.toLocaleString("en-US")}人次，${oldValue.toLocaleString("en-US")}为重复汇总值。`,
          status: "verified",
          sourceRefs: [sourceRef, input.request.trigger.sourceId],
          version: "2.0",
          visibility: "assigned_team",
        },
        supersedesFactId: "fact-visitors-v1",
        nextNodeId: "verification",
      },
      confidence: 0.91,
    };
  }
}

function createIntent(
  request: AgentRunRequest,
  output: FactCheckerBusinessOutput,
  citationRefs: string[],
): ExecutableAgentIntent {
  return ExecutableAgentIntentSchema.parse({
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
    intentType: output.intentType,
    rationaleSummary: output.rationaleSummary,
    proposedPayload: output.proposedPayload,
    expectedStateVersion: request.stateVersion,
    causationEventIds: [request.trigger.sourceId],
    evidenceRefs: [],
    citationRefs,
    toolResultRefs: [request.trigger.sourceId],
    confidence: output.confidence,
    riskLevel: output.intentType === "propose_data_correction" ? "medium" : "low",
    requiresTeacherReview: output.intentType === "propose_data_correction",
    visibility: output.intentType === "propose_data_correction" ? ["teacher_only", "audit_only"] : ["assigned_team", "audit_only"],
    visibleToActorIds: [],
    idempotencyKey: `${request.sessionId}:${request.stateVersion}:${request.actorId}:${output.intentType}`,
    expiresAt: null,
  });
}

export function createFactCheckerHandlers(
  model: FactCheckerModelPort = new DeterministicFactCheckerModel(),
): ReadonlyMap<string, AgentNodeExecutor> {
  const handlers = new Map<string, AgentNodeExecutor>();

  handlers.set("fact-checker/retrieve", async ({ request }) => {
    if (request.context.retrieved.length === 0) {
      throw new AgentRuntimeExecutionError("rag_empty", "事实核查未检索到授权规则或来源");
    }
    return {
      signals: {
        retrievalReady: true,
        citationCount: request.contextManifest.includedCitationRefs.length,
      },
    };
  });

  handlers.set("fact-checker/model", async ({ request }) => {
    const prompt = compileAgentPrompt(factCheckerPromptTemplate, request);
    const output = await model.invoke({
      request,
      systemPrompt: prompt.systemPrompt,
      userPrompt: prompt.userPrompt,
    });
    return {
      intent: createIntent(request, output, prompt.includedReferenceIds),
      signals: {
        modelConfidence: output.confidence,
        promptContextHash: prompt.contextHash,
        promptHash: prompt.promptHash,
      },
      metrics: {
        modelCalls: 1,
        modelInvocations: output.modelTrace ? [output.modelTrace] : [],
        inputTokens: output.modelTrace?.tokenUsage.input ?? prompt.estimatedInputTokens,
        outputTokens: output.modelTrace?.tokenUsage.output ?? Math.ceil(JSON.stringify(output).length / 4),
      },
    };
  });

  handlers.set("fact-checker/guard", async ({ intent }) => {
    if (!intent) throw new AgentRuntimeExecutionError("intent_missing", "事实核查模型没有返回结构化意图");
    if (intent.intentType === "propose_data_correction" && intent.citationRefs.length === 0) {
      throw new AgentRuntimeExecutionError("citation_missing", "更正意图缺少检索引用");
    }
    if (intent.confidence < 0.75) {
      throw new AgentRuntimeExecutionError("confidence_low", "更正意图置信度不足");
    }
    return { signals: { intentGuardPassed: true } };
  });

  handlers.set("fact-checker/fallback", async ({ request }) => ({
    intent: createIntent(request, {
      intentType: "ask_for_evidence",
      rationaleSummary: "模型、检索或输出校验未达到更正门槛，需要补充原始去重表与独立来源。",
      proposedPayload: {
        requestedEvidence: ["入口去重表", "独立票务或闸机来源"],
      },
      confidence: 1,
    }, []),
    signals: { fallbackReason: "insufficient_or_failed_analysis" },
  }));

  return handlers;
}

export function createFactCheckerRuntime(options: {
  model?: FactCheckerModelPort;
  clock?: () => string;
} = {}): AgentRuntime {
  return new AgentRuntime({
    handlers: createFactCheckerHandlers(options.model),
    ...(options.clock ? { clock: options.clock } : {}),
  });
}
