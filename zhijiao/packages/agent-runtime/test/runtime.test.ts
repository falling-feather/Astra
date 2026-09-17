import { describe, expect, it } from "vitest";
import {
  AgentDefinitionSchema,
  AgentRunRequestSchema,
  SchemaVersion,
  type AgentRunRequest,
} from "@ronggang/contracts";
import {
  AgentRuntime,
  createRoleAgentHandlers,
  createFactCheckerRuntime,
  factCheckerAgentDefinition,
  GatewayFactCheckerModel,
  GatewayRoleAgentModel,
  roleAgentDefinitions,
  roleAgentPromptTemplates,
  type FactCheckerModelPort,
} from "../src/index.js";
import {
  DeterministicModelProvider,
  HandlerBackedModelProvider,
  type StructuredModelPort,
} from "@ronggang/model-gateway";
import { buildAgentContext } from "./context-fixture.js";

const defaultDedupContent = "14:20入口去重表显示：初版18,000人次包含跨入口重复汇总；按唯一票务标识去重后，有效客流为12,600人次。";

function request(
  overrides: Partial<AgentRunRequest> = {},
  dedupContent = defaultDedupContent,
): AgentRunRequest {
  const role: AgentRunRequest["role"] = {
    agentId: "agent-fact-checker",
    actorKind: "agent",
    roleId: "fact_checker",
    displayName: "事实核查员·方宁",
    purpose: "核验数据、来源与表述",
    teamId: "team-jiangnan-01",
    visibleScopes: ["public_world", "assigned_team", "role_private"],
    privateScopes: ["actor:agent-fact-checker"],
    allowedIntents: ["propose_data_correction", "ask_for_evidence"],
    deniedActions: ["mutate_world_state", "read_other_private_memory"],
    toolPolicy: ["rag_search", "memory.read.own"],
    tokenBudget: 2_000,
  };
  const contextBundle = buildAgentContext({
    role,
    sessionId: "session-agent-test",
    stateVersion: 23,
    fixed: [
      { itemId: "fixed-reviewed", content: "只采用经审核事实" },
      { itemId: "fixed-image", content: "不能用图片人流证明具体客流" },
    ],
    state: [{ itemId: "fact-visitors-v1", content: "fact-visitors-v1: 初版快报为18,000人次" }],
    retrieved: [{
      itemId: "course-source-verification",
      source: "课程知识库/事实核验",
      version: "2026.1",
      content: "关键数据需要原始来源、独立来源与时间版本。",
    }, {
      itemId: "scenario-visitor-dedup-source",
      source: "material-visitor-sheet",
      version: "2.0",
      content: dedupContent,
    }],
    privateMemory: [{ itemId: "memory-risk", content: "初版快报疑似跨入口重复汇总" }],
    transient: [{ itemId: "trigger-observation", content: "图片观察只能证明现场人流密集" }],
  });
  return AgentRunRequestSchema.parse({
    kind: "AgentRunRequest",
    sessionId: "session-agent-test",
    sceneId: "scenario-local-tourism-media-v0.1",
    actorId: "agent-fact-checker",
    messageId: "run-message-1",
    correlationId: "corr-material-observed",
    timestamp: "2026-07-24T08:00:00.000Z",
    schemaVersion: SchemaVersion,
    taskId: "task-fact-checker-1",
    agentRunId: "run-fact-checker-1",
    role,
    trigger: { type: "material_observed", sourceId: "observation-photo-1" },
    stateVersion: 23,
    ...contextBundle,
    signals: {
      needsVerification: true,
      currentValue: 18000,
    },
    ...overrides,
  });
}

function roleRequest(input: {
  agentId: "agent-chief" | "agent-copyright";
  roleId: "editor_in_chief" | "copyright_owner";
  optionId: "editor-chief-commit" | "editor-copyright-decision";
  topic: "release_decision" | "copyright_scope";
  turn: number;
}): AgentRunRequest {
  const allowedIntents = input.roleId === "copyright_owner"
    ? ["post_role_response", "propose_copyright_dispute"]
    : ["post_role_response"];
  const role: AgentRunRequest["role"] = {
    agentId: input.agentId,
    actorKind: "agent",
    roleId: input.roleId,
    displayName: input.roleId === "copyright_owner" ? "版权方·苏禾影像" : "总编·沈砚",
    purpose: "在授权上下文内作出岗位响应",
    teamId: "team-jiangnan-01",
    visibleScopes: ["public_world", "assigned_team", "role_private"],
    privateScopes: [`actor:${input.agentId}`],
    allowedIntents,
    deniedActions: ["直接改写世界事实"],
    toolPolicy: ["memory.read.own"],
    tokenBudget: 2_000,
    communicationPolicy: {
      canInitiate: false,
      canRespond: true,
      allowedTargetRoleIds: [],
      maxTurnsPerTarget: 4,
    },
  };
  const contextBundle = buildAgentContext({
    role,
    sessionId: "session-role-agent-test",
    stateVersion: 31,
    fixed: [{ itemId: "fixed-role-boundary", content: "岗位响应与世界行动必须分离" }],
    state: [
      { itemId: "fact-event-schedule", content: "fact-event-schedule: 首发窗口为16:00" },
      { itemId: "fact-license-scope", content: "fact-license-scope: 当前授权只覆盖课程内展示" },
    ],
    retrieved: [{
      itemId: "role-policy",
      source: "岗位技能库",
      version: "2026.1",
      content: "争议未解除时不得放行；商业信息流用途需要补充授权。",
    }],
    privateMemory: [{ itemId: "memory-role-stance", content: "保持审慎，承诺必须明确对象与条件" }],
    transient: [{ itemId: "trigger-role-request", content: "学生发来第二轮结构化岗位请求" }],
  });
  return AgentRunRequestSchema.parse({
    kind: "AgentRunRequest",
    sessionId: "session-role-agent-test",
    sceneId: "scenario-local-tourism-media-v0.1",
    actorId: input.agentId,
    messageId: `message-${input.optionId}`,
    correlationId: `correlation-${input.optionId}`,
    timestamp: "2026-07-25T08:00:00.000Z",
    schemaVersion: SchemaVersion,
    taskId: `task-${input.optionId}`,
    agentRunId: `run-${input.optionId}`,
    role,
    trigger: {
      type: "role_interaction_requested",
      sourceId: `event-${input.optionId}`,
    },
    stateVersion: 31,
    ...contextBundle,
    signals: {
      interactionId: `interaction-${input.optionId}`,
      threadId: `thread-${input.agentId}`,
      optionId: input.optionId,
      fromActorId: "student-editor",
      fromRoleId: "responsible_editor",
      topic: input.topic,
      requestKind: "request_commitment",
      turn: input.turn,
      replyToInteractionId: "interaction-first-turn",
      allowedFactIds: "fact-event-schedule,fact-license-scope",
    },
  });
}

describe("AgentRuntime", () => {
  it("pins the role-model contract vocabulary and reserves enough structured-output budget", async () => {
    let observedMaxOutputTokens = 0;
    const provider: StructuredModelPort = {
      health: () => ({
        profileId: "role-model-test",
        provider: "deterministic",
        mode: "mock",
        configured: true,
        available: true,
        baseUrl: null,
        models: ["role-model-test"],
        reason: null,
      }),
      invoke: async (modelRequest) => {
        observedMaxOutputTokens = modelRequest.maxOutputTokens;
        return {
          output: {
            act: "clarify",
            content: "请先补齐可核验材料。",
            stance: "cautious",
            commitment: null,
            confidence: 0.8,
          },
          trace: {
            invocationId: modelRequest.invocationId,
            profileId: modelRequest.profileId,
            provider: "deterministic",
            mode: "mock",
            model: "role-model-test",
            requestId: null,
            status: "completed",
            outputMode: modelRequest.outputMode,
            finishReason: "stop",
            tokenUsage: { input: 10, output: 10, total: 20 },
            latencyMs: 1,
            attempts: 1,
            estimatedCostUsd: 0,
            errorCode: null,
            startedAt: "2026-07-25T08:00:00.000Z",
            completedAt: "2026-07-25T08:00:00.001Z",
          },
        };
      },
    };
    const model = new GatewayRoleAgentModel({ provider });
    const modelRequest = roleRequest({
      agentId: "agent-chief",
      roleId: "editor_in_chief",
      optionId: "editor-chief-commit",
      topic: "release_decision",
      turn: 2,
    });

    await model.invoke({
      request: modelRequest,
      systemPrompt: "system",
      userPrompt: "user",
    });

    const template = roleAgentPromptTemplates.get("agent-chief");
    expect(template?.outputContract).toContain(
      "stance 只能是 cooperative、cautious、restricted、committed",
    );
    expect(template?.outputContract).toContain(
      "confidence 必须是 0 到 1 之间的 JSON 数字",
    );
    expect(observedMaxOutputTokens).toBe(1_200);
  });

  it("keeps a private role response separate from a world action intent", async () => {
    const runtime = new AgentRuntime({
      handlers: createRoleAgentHandlers(),
      clock: () => "2026-07-25T08:00:00.000Z",
    });
    const chiefDefinition = roleAgentDefinitions.get("agent-chief")!;
    const chief = await runtime.run(chiefDefinition, roleRequest({
      agentId: "agent-chief",
      roleId: "editor_in_chief",
      optionId: "editor-chief-commit",
      topic: "release_decision",
      turn: 2,
    }));
    expect(chief.intent).toBeNull();
    expect(chief.roleResponseIntent?.intentType).toBe("post_role_response");
    expect(chief.roleResponseIntent?.visibility).toEqual(["role_private", "audit_only"]);
    expect(chief.roleResponseIntent?.proposedResponse).toMatchObject({
      act: "commit",
      stance: "committed",
      commitment: {
        ownerActorId: "agent-chief",
        granteeActorId: "student-editor",
        sourceInteractionId: "interaction-editor-chief-commit",
      },
    });

    const copyrightDefinition = roleAgentDefinitions.get("agent-copyright")!;
    const copyright = await runtime.run(copyrightDefinition, roleRequest({
      agentId: "agent-copyright",
      roleId: "copyright_owner",
      optionId: "editor-copyright-decision",
      topic: "copyright_scope",
      turn: 2,
    }));
    expect(copyright.roleResponseIntent?.proposedResponse).toMatchObject({
      act: "refuse",
      commitment: null,
    });
    expect(copyright.intent).toMatchObject({
      intentType: "propose_copyright_dispute",
      requiresTeacherReview: true,
      visibility: ["teacher_only", "audit_only"],
    });
    expect(copyright.roleResponseIntent?.responseIntentId)
      .not.toBe(copyright.intent?.intentId);
  });

  it("routes through retrieval, model and guard to a structured correction intent", async () => {
    const runtime = createFactCheckerRuntime({ clock: () => "2026-07-24T08:00:00.000Z" });
    const result = await runtime.run(factCheckerAgentDefinition, request());

    expect(result.intent?.intentType).toBe("propose_data_correction");
    expect(result.intent?.expectedStateVersion).toBe(23);
    expect(result.intent?.requiresTeacherReview).toBe(true);
    expect(result.trace.status).toBe("completed");
    expect(result.trace.nodes.map((node) => node.nodeId)).toEqual([
      "claim-router",
      "source-retrieval",
      "correction-model",
      "intent-guard",
      "done",
    ]);
    expect(result.trace.modelCalls).toBe(1);
    expect(result.trace.tokenUsage.input).toBeGreaterThan(0);
    expect(result.trace.contextManifest?.includedCitationRefs).toEqual([
      "course-source-verification",
      "scenario-visitor-dedup-source",
    ]);
    expect(result.trace.promptHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("uses a visible degraded fallback when the model fails", async () => {
    const failingModel: FactCheckerModelPort = {
      invoke: async () => {
        throw new Error("provider unavailable");
      },
    };
    const runtime = createFactCheckerRuntime({
      model: failingModel,
      clock: () => "2026-07-24T08:00:00.000Z",
    });
    const result = await runtime.run(factCheckerAgentDefinition, request());

    expect(result.intent?.intentType).toBe("ask_for_evidence");
    expect(result.trace.status).toBe("degraded");
    expect(result.trace.fallbackUsed).toBe(true);
    expect(result.trace.nodes.some((node) => node.nodeId === "safe-fallback")).toBe(true);
  });

  it("derives the proposed value from retrieved scenario evidence instead of a fixed engine branch", async () => {
    const changedEvidence = request(
      { agentRunId: "run-fact-checker-changed-source" },
      "入口去重表复核后，有效客流为11,900人次。",
    );
    const runtime = createFactCheckerRuntime({ clock: () => "2026-07-24T08:00:00.000Z" });
    const result = await runtime.run(factCheckerAgentDefinition, changedEvidence);
    const fact = result.intent?.proposedPayload.fact as { statement?: string } | undefined;

    expect(fact?.statement).toContain("11,900");
  });

  it("records provider-neutral model telemetry without accepting provider-controlled identity", async () => {
    const provider = new DeterministicModelProvider({
      profileId: "gateway-contract-test",
      resolver: () => ({
        intentType: "ask_for_evidence",
        rationaleSummary: "供应方只能返回领域草稿，运行时仍负责身份和权限。",
        proposedPayload: { requestedEvidence: ["入口去重表"] },
        confidence: 0.9,
      }),
      clock: () => "2026-07-25T01:00:00.000Z",
    });
    const runtime = createFactCheckerRuntime({
      model: new GatewayFactCheckerModel({ provider }),
      clock: () => "2026-07-25T01:00:00.000Z",
    });

    const result = await runtime.run(factCheckerAgentDefinition, request());

    expect(result.intent?.actorId).toBe("agent-fact-checker");
    expect(result.intent?.expectedStateVersion).toBe(23);
    expect(result.trace.modelInvocations).toHaveLength(1);
    expect(result.trace.modelInvocations[0]?.provider).toBe("deterministic");
  });

  it("degrades a provider response that violates the fact-checker business schema", async () => {
    const provider = new DeterministicModelProvider({
      profileId: "gateway-invalid-output",
      resolver: () => ({
        intentType: "propose_data_correction",
        rationaleSummary: "故意夹带运行时才有权构造的事实字段。",
        proposedPayload: {
          statement: "截至14:20，按唯一票务标识去重后的有效客流为12,600人次。",
          fact: {
            factId: "provider-controlled-id",
            status: "verified",
          },
        },
        confidence: 0.9,
      }),
      clock: () => "2026-07-25T01:00:00.000Z",
    });
    const runtime = createFactCheckerRuntime({
      model: new GatewayFactCheckerModel({ provider }),
      clock: () => "2026-07-25T01:00:00.000Z",
    });

    const result = await runtime.run(factCheckerAgentDefinition, request());
    const modelNode = result.trace.nodes.find((node) => node.kind === "model");

    expect(result.trace.status).toBe("degraded");
    expect(modelNode?.errorCode).toBe(
      "model_output_schema_invalid:proposedPayload:unrecognized_keys",
    );
    expect(result.trace.modelInvocations[0]?.status).toBe("completed");
    expect(result.intent?.intentType).toBe("ask_for_evidence");
  });

  it("keeps a failed live-provider trace when the graph degrades to evidence request", async () => {
    const provider = new HandlerBackedModelProvider({
      profileId: "iflytek-reserved",
      provider: "iflytek_xingchen",
      model: "xingchen-workflow",
      baseUrl: "https://xingchen.example.invalid",
      configured: false,
    });
    const runtime = createFactCheckerRuntime({
      model: new GatewayFactCheckerModel({ provider }),
      clock: () => "2026-07-25T01:00:00.000Z",
    });

    const result = await runtime.run(factCheckerAgentDefinition, request());

    expect(result.trace.status).toBe("degraded");
    expect(result.trace.modelInvocations[0]?.status).toBe("failed");
    expect(result.trace.modelInvocations[0]?.errorCode).toBe("live_handler_not_registered");
    expect(result.intent?.intentType).toBe("ask_for_evidence");
  });

  it("stops a looping graph at maxSteps", async () => {
    const looping = AgentDefinitionSchema.parse({
      agentId: "agent-fact-checker",
      roleId: "fact_checker",
      definitionVersion: "loop/1",
      promptVersion: "loop/1",
      entryNodeId: "route",
      allowedTriggers: ["material_observed"],
      allowedIntents: ["ask_for_evidence"],
      maxSteps: 2,
      maxToolCalls: 0,
      timeoutMs: 1_000,
      nodes: [
        { nodeId: "route", kind: "router", label: "循环路由", executorKey: null, promptTemplateId: null, toolName: null },
        { nodeId: "done", kind: "terminal", label: "终止", executorKey: null, promptTemplateId: null, toolName: null },
      ],
      edges: [
        { edgeId: "loop", from: "route", to: "route", priority: 100, condition: { kind: "always" } },
        { edgeId: "unselected-terminal", from: "route", to: "done", priority: 0, condition: { kind: "signal_equals", key: "stop", value: true } },
      ],
    });
    const runtime = new AgentRuntime({ clock: () => "2026-07-24T08:00:00.000Z" });
    const result = await runtime.run(looping, request());

    expect(result.intent).toBeNull();
    expect(result.trace.status).toBe("failed");
    expect(result.trace.errorCode).toBe("max_steps_exceeded");
  });
});
