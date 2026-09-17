import {
  AgentRunRequestSchema,
  ObservationSchema,
  createMessageMeta,
  type AgentDefinition,
  type AgentRunRequest,
  type AgentRunResult,
} from "@ronggang/contracts";
import {
  VersionedContextAssembler,
  createAccessSubject,
  createResourceAudience,
  type ContextAssemblyResult,
} from "@ronggang/context-engine";
import {
  factCheckerAgentDefinition,
  type AgentRuntime,
} from "@ronggang/agent-runtime";
import { type IdGenerator } from "@ronggang/world-core";
import type {
  AgentTaskHandler,
  AgentTaskHandlerInput,
} from "./ports.js";

export interface AgentRunner {
  run(definition: AgentDefinition, request: AgentRunRequest): Promise<AgentRunResult>;
}

export class FactCheckerTaskHandler implements AgentTaskHandler {
  readonly handlerId = "fact-checker/material-observed/v1";
  readonly #runtime: AgentRunner;
  readonly #contextAssembler: VersionedContextAssembler;
  readonly #now: () => string;
  readonly #nextId: IdGenerator["next"];

  constructor(input: {
    runtime: AgentRunner | AgentRuntime;
    contextAssembler?: VersionedContextAssembler;
    now?: () => string;
    nextId?: IdGenerator["next"];
  }) {
    this.#runtime = input.runtime;
    this.#contextAssembler = input.contextAssembler ?? new VersionedContextAssembler();
    this.#now = input.now ?? (() => new Date().toISOString());
    this.#nextId = input.nextId ?? ((prefix) => `${prefix}-${crypto.randomUUID()}`);
  }

  matches(task: AgentTaskHandlerInput["task"], triggerEvent: AgentTaskHandlerInput["triggerEvent"]): boolean {
    return (
      task.agentId === factCheckerAgentDefinition.agentId
      && task.roleId === factCheckerAgentDefinition.roleId
      && task.definitionVersion === factCheckerAgentDefinition.definitionVersion
      && task.promptVersion === factCheckerAgentDefinition.promptVersion
      && triggerEvent.eventType === "material_observed"
    );
  }

  async run(input: AgentTaskHandlerInput): Promise<AgentRunResult> {
    const { task, triggerEvent, projection, scenario } = input;
    const observation = ObservationSchema.parse(triggerEvent.payload.observation);
    const materialId = String(triggerEvent.payload.materialId ?? observation.materialId);
    const material = projection.materials.find((item) => item.materialId === materialId);
    if (!material) throw new Error(`智能体触发事件引用未知素材：${materialId}`);
    const role = projection.role;
    if (!role || role.roleId !== task.roleId || role.actorKind !== "agent") {
      throw new Error("智能体任务与角色契约不一致");
    }
    const currentVisitorFact = projection.facts.find((fact) => fact.factId === "fact-visitors-v1");
    const currentVisitorValue = Number(
      currentVisitorFact?.statement.match(/客流([\d,]+)人次/u)?.[1]?.replaceAll(",", "") ?? 0,
    );
    const access = createAccessSubject({
      role,
      sessionId: projection.sessionId,
      sessionEpoch: projection.sessionEpoch,
      courseId: projection.scenario.courseId,
      purpose: "runtime",
    });
    const triggerAudience = createResourceAudience({
      scopes: ["assigned_team", "audit_only"],
      courseId: projection.scenario.courseId,
      sessionId: projection.sessionId,
      sessionEpoch: projection.sessionEpoch,
      teamIds: [role.teamId],
      actorIds: [role.agentId],
      auditReadable: true,
    });
    const context: ContextAssemblyResult = await this.#contextAssembler.assemble({
      query: "核验客流统计口径、入口去重表与来源",
      subject: access,
      scenarioVersion: scenario.version,
      scenarioContentHash: projection.scenario.contentHash,
      nodeId: "source",
      stateVersion: projection.stateVersion,
      tokenBudget: role.tokenBudget,
      chunks: scenario.knowledgeChunks,
      facts: projection.facts,
      evidence: projection.evidence,
      transient: [
        {
          itemId: `material:${material.materialId}`,
          content: `本轮材料：${material.title} (${material.materialId})`,
          source: material.source,
          version: material.version,
          audience: triggerAudience,
        },
        {
          itemId: `observation:${observation.observationId}`,
          content: `材料观察：${observation.summary}`,
          source: observation.sourceRef,
          version: observation.providerMode,
          audience: triggerAudience,
        },
      ],
      fixed: [
        "Observation 不自动成为权威事实。",
        "不能用图片中的人流密度证明具体客流数字。",
        "智能体只能输出 AgentIntent，不能生成 WorldEvent。",
      ],
      assembledAt: this.#now(),
    });
    const now = this.#now();
    const request = AgentRunRequestSchema.parse({
      ...createMessageMeta({
        sessionId: projection.sessionId,
        sceneId: scenario.scenarioId,
        actorId: role.agentId,
        correlationId: task.correlationId,
        timestamp: now,
      }),
      kind: "AgentRunRequest",
      taskId: task.taskId,
      agentRunId: this.#nextId("agent-run"),
      templateRef: task.templateRef,
      instanceRef: task.instanceRef,
      role,
      trigger: {
        type: task.triggerEventType,
        sourceId: task.triggerEventId,
      },
      stateVersion: task.expectedStateVersion,
      access,
      context: context.context,
      contextManifest: context.manifest,
      signals: {
        needsVerification: true,
        currentValue: currentVisitorValue,
        currentFactId: currentVisitorFact?.factId ?? "fact-visitors-v1",
        currentFactVersion: currentVisitorFact?.version ?? "1.0",
        currentFactDomain: currentVisitorFact?.domain ?? "audience",
      },
    });
    return this.#runtime.run(factCheckerAgentDefinition, request);
  }
}
