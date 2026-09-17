import { performance } from "node:perf_hooks";
import {
  AgentDefinitionSchema,
  AgentAssistanceProposalSchema,
  AgentRunRequestSchema,
  AgentRunResultSchema,
  AgentRunTraceSchema,
  ExecutableAgentIntentSchema,
  RoleResponseIntentSchema,
  type AgentDefinition,
  type AgentAssistanceProposal,
  type AgentGraphEdge,
  type AgentGraphNode,
  type AgentRunRequest,
  type AgentRunResult,
  type AgentSignalValue,
  type ExecutableAgentIntent,
  type ModelInvocationTrace,
  type RoleResponseIntent,
} from "@ronggang/contracts";
import { compileAgentGraph } from "./graph.js";
import {
  AgentPolicyError,
  assertDefinitionRequestPolicy,
  assertAssistanceProposalPolicy,
  assertIntentPolicy,
  assertRoleResponseIntentPolicy,
  assertToolPolicy,
} from "./policy.js";

export interface AgentNodeMetrics {
  modelCalls?: number;
  modelInvocations?: ModelInvocationTrace[];
  toolCalls?: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface AgentNodeExecutionResult {
  signals?: Record<string, AgentSignalValue>;
  intent?: ExecutableAgentIntent | null;
  roleResponseIntent?: RoleResponseIntent | null;
  assistanceProposal?: AgentAssistanceProposal | null;
  metrics?: AgentNodeMetrics;
}

export interface AgentNodeExecutionContext {
  definition: AgentDefinition;
  request: AgentRunRequest;
  node: AgentGraphNode;
  signals: Readonly<Record<string, AgentSignalValue>>;
  intent: ExecutableAgentIntent | null;
  roleResponseIntent: RoleResponseIntent | null;
  assistanceProposal: AgentAssistanceProposal | null;
}

export type AgentNodeExecutor = (context: AgentNodeExecutionContext) => Promise<AgentNodeExecutionResult>;

export class AgentRuntimeExecutionError extends Error {
  readonly code: string;
  readonly metrics: AgentNodeMetrics | undefined;

  constructor(code: string, message: string, metrics?: AgentNodeMetrics) {
    super(message);
    this.name = "AgentRuntimeExecutionError";
    this.code = code;
    this.metrics = metrics;
  }
}

function conditionMatches(
  edge: AgentGraphEdge,
  signals: Readonly<Record<string, AgentSignalValue>>,
  lastStatus: "success" | "failure",
  intent: ExecutableAgentIntent | null,
): boolean {
  switch (edge.condition.kind) {
    case "always":
      return true;
    case "signal_equals":
      return signals[edge.condition.key] === edge.condition.value;
    case "last_status_equals":
      return lastStatus === edge.condition.value;
    case "intent_present":
      return (intent !== null) === edge.condition.value;
  }
}

function errorCode(error: unknown): string {
  if (error instanceof AgentRuntimeExecutionError || error instanceof AgentPolicyError) return error.code;
  return "node_execution_failed";
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (timeoutMs <= 0) throw new AgentRuntimeExecutionError("agent_timeout", "智能体运行超过总时限");
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new AgentRuntimeExecutionError("agent_timeout", "智能体节点执行超时")),
      timeoutMs,
    );
    timer.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export class AgentRuntime {
  readonly #handlers: ReadonlyMap<string, AgentNodeExecutor>;
  readonly #clock: () => string;

  constructor(options: {
    handlers?: ReadonlyMap<string, AgentNodeExecutor>;
    clock?: () => string;
  } = {}) {
    this.#handlers = options.handlers ?? new Map();
    this.#clock = options.clock ?? (() => new Date().toISOString());
  }

  async run(rawDefinition: AgentDefinition, rawRequest: AgentRunRequest): Promise<AgentRunResult> {
    const definition = AgentDefinitionSchema.parse(rawDefinition);
    const request = AgentRunRequestSchema.parse(rawRequest);
    const graph = compileAgentGraph(definition);
    assertDefinitionRequestPolicy(definition, request);

    const startedAt = this.#clock();
    const startedMs = performance.now();
    let currentNodeId = definition.entryNodeId;
    let intent: ExecutableAgentIntent | null = null;
    let roleResponseIntent: RoleResponseIntent | null = null;
    let assistanceProposal: AgentAssistanceProposal | null = null;
    let signals: Record<string, AgentSignalValue> = { ...request.signals };
    let modelCalls = 0;
    const modelInvocations: ModelInvocationTrace[] = [];
    let toolCalls = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let fallbackUsed = false;
    let terminalReached = false;
    let finalErrorCode: string | null = null;
    const nodeTraces: Array<{
      nodeId: string;
      kind: AgentGraphNode["kind"];
      status: "success" | "failure";
      startedAt: string;
      completedAt: string;
      durationMs: number;
      selectedEdgeId: string | null;
      errorCode: string | null;
    }> = [];

    for (let step = 0; step < definition.maxSteps; step += 1) {
      const node = graph.nodeById.get(currentNodeId);
      if (!node) throw new AgentRuntimeExecutionError("node_missing", `运行节点不存在：${currentNodeId}`);
      const nodeStartedAt = this.#clock();
      const nodeStartedMs = performance.now();
      let status: "success" | "failure" = "success";
      let nodeErrorCode: string | null = null;

      try {
        if (node.kind === "terminal") {
          terminalReached = true;
        } else if (node.kind !== "router") {
          assertToolPolicy(node, request);
          if (node.kind === "tool" && toolCalls >= definition.maxToolCalls) {
            throw new AgentRuntimeExecutionError("tool_budget_exceeded", "工具调用次数超过角色预算");
          }
          const handler = node.executorKey ? this.#handlers.get(node.executorKey) : undefined;
          if (!handler) throw new AgentRuntimeExecutionError("executor_missing", `执行器未注册：${node.executorKey ?? node.nodeId}`);
          const remainingMs = definition.timeoutMs - (performance.now() - startedMs);
          const result: AgentNodeExecutionResult = await withTimeout<AgentNodeExecutionResult>(
            handler({
              definition,
              request,
              node,
              signals,
              intent,
              roleResponseIntent,
              assistanceProposal,
            }),
            remainingMs,
          );
          signals = { ...signals, ...(result.signals ?? {}) };
          if (result.intent !== undefined) intent = result.intent === null ? null : ExecutableAgentIntentSchema.parse(result.intent);
          if (result.roleResponseIntent !== undefined) {
            roleResponseIntent = result.roleResponseIntent === null
              ? null
              : RoleResponseIntentSchema.parse(result.roleResponseIntent);
          }
          if (result.assistanceProposal !== undefined) {
            assistanceProposal = result.assistanceProposal === null
              ? null
              : AgentAssistanceProposalSchema.parse(
                  result.assistanceProposal,
                );
          }
          modelCalls += result.metrics?.modelCalls ?? 0;
          modelInvocations.push(...(result.metrics?.modelInvocations ?? []));
          toolCalls += result.metrics?.toolCalls ?? (node.kind === "tool" ? 1 : 0);
          inputTokens += result.metrics?.inputTokens ?? 0;
          outputTokens += result.metrics?.outputTokens ?? 0;
        }
      } catch (error) {
        status = "failure";
        nodeErrorCode = errorCode(error);
        finalErrorCode = nodeErrorCode;
        signals = {
          ...signals,
          lastNodeErrorCode: nodeErrorCode,
        };
        if (error instanceof AgentRuntimeExecutionError && error.metrics) {
          modelCalls += error.metrics.modelCalls ?? 0;
          modelInvocations.push(...(error.metrics.modelInvocations ?? []));
          toolCalls += error.metrics.toolCalls ?? 0;
          inputTokens += error.metrics.inputTokens ?? 0;
          outputTokens += error.metrics.outputTokens ?? 0;
        }
      }

      let selectedEdge: AgentGraphEdge | undefined;
      if (!terminalReached) {
        selectedEdge = (graph.outgoingByNodeId.get(node.nodeId) ?? [])
          .find((edge) => conditionMatches(edge, signals, status, intent));
        if (!selectedEdge) {
          status = "failure";
          nodeErrorCode ??= "route_not_found";
          finalErrorCode = nodeErrorCode;
        } else if (status === "failure") {
          fallbackUsed = true;
        }
      }

      nodeTraces.push({
        nodeId: node.nodeId,
        kind: node.kind,
        status,
        startedAt: nodeStartedAt,
        completedAt: this.#clock(),
        durationMs: Math.max(0, performance.now() - nodeStartedMs),
        selectedEdgeId: selectedEdge?.edgeId ?? null,
        errorCode: nodeErrorCode,
      });

      if (terminalReached || !selectedEdge) break;
      currentNodeId = selectedEdge.to;
    }

    if (!terminalReached && finalErrorCode === null) finalErrorCode = "max_steps_exceeded";
    let traceStatus: "completed" | "degraded" | "failed" = terminalReached ? (fallbackUsed ? "degraded" : "completed") : "failed";
    if (terminalReached && intent !== null) {
      try {
        intent = assertIntentPolicy(intent, definition, request);
      } catch (error) {
        finalErrorCode = errorCode(error);
        traceStatus = "failed";
        intent = null;
      }
    }
    if (terminalReached && roleResponseIntent !== null) {
      try {
        roleResponseIntent = assertRoleResponseIntentPolicy(
          roleResponseIntent,
          definition,
          request,
        );
      } catch (error) {
        finalErrorCode = errorCode(error);
        traceStatus = "failed";
        roleResponseIntent = null;
        intent = null;
      }
    }
    if (terminalReached && assistanceProposal !== null) {
      try {
        assistanceProposal = assertAssistanceProposalPolicy(
          assistanceProposal,
          definition,
          request,
        );
      } catch (error) {
        finalErrorCode = errorCode(error);
        traceStatus = "failed";
        assistanceProposal = null;
        roleResponseIntent = null;
        intent = null;
      }
    }

    const trace = AgentRunTraceSchema.parse({
      taskId: request.taskId,
      agentRunId: request.agentRunId,
      correlationId: request.correlationId,
      agentId: definition.agentId,
      roleId: definition.roleId,
      templateRef: request.templateRef,
      instanceRef: request.instanceRef,
      definitionVersion: definition.definitionVersion,
      promptVersion: definition.promptVersion,
      inputStateVersion: request.stateVersion,
      triggerRefs: [request.trigger.sourceId],
      contextManifest: request.contextManifest,
      promptHash: typeof signals.promptHash === "string" ? signals.promptHash : null,
      status: traceStatus,
      nodes: nodeTraces,
      modelCalls,
      modelInvocations,
      toolCalls,
      tokenUsage: { input: inputTokens, output: outputTokens },
      fallbackUsed,
      errorCode: traceStatus === "failed" ? finalErrorCode ?? "agent_failed" : null,
      startedAt,
      completedAt: this.#clock(),
      durationMs: Math.max(0, performance.now() - startedMs),
    });

    return AgentRunResultSchema.parse({
      intent: traceStatus === "failed" ? null : intent,
      roleResponseIntent: traceStatus === "failed" ? null : roleResponseIntent,
      assistanceProposal: traceStatus === "failed"
        ? null
        : assistanceProposal,
      trace,
      signals,
    });
  }
}
