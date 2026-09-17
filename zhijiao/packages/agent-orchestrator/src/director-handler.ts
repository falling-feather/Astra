import {
  AgentRunRequestSchema,
  createMessageMeta,
  type AgentDefinition,
  type AgentRunRequest,
  type AgentRunResult,
  type DirectorCadence,
  type DirectorDifficulty,
  type RoleId,
  type ScenarioDirectorEventTemplate,
  type TeachingStrategy,
} from "@ronggang/contracts";
import {
  VersionedContextAssembler,
  createAccessSubject,
  createResourceAudience,
  type ContextAssemblyResult,
} from "@ronggang/context-engine";
import {
  sceneDirectorAgentDefinition,
  teachingDirectorAgentDefinition,
  type AgentRuntime,
} from "@ronggang/agent-runtime";
import { type IdGenerator } from "@ronggang/world-core";
import type {
  AgentTaskHandler,
  AgentTaskHandlerInput,
} from "./ports.js";

interface DirectorRunner {
  run(definition: AgentDefinition, request: AgentRunRequest): Promise<AgentRunResult>;
}

interface TeachingPlan {
  strategy: TeachingStrategy;
  reasonCode: string;
  rationaleSummary: string;
  targetCompetency: string;
  targetRoleIds: RoleId[];
}

function shouldHandoffToSceneDirector(
  strategy: TeachingStrategy,
  cadence: DirectorCadence,
): boolean {
  if (strategy === "teacher_gate") return true;
  if (cadence === "conservative") return strategy === "challenge";
  if (cadence === "dynamic") {
    return [
      "procedural_hint",
      "socratic_prompt",
      "scaffold",
      "challenge",
    ].includes(strategy);
  }
  return strategy === "scaffold" || strategy === "challenge";
}

function teachingPlan(input: AgentTaskHandlerInput): TeachingPlan {
  const { projection, triggerEvent, scenario } = input;
  const difficulty = scenario.directorConfig?.difficulty ?? "standard";
  const evidenceCount = projection.evidence.length;
  if (!scenario.directorConfig || !scenario.directorEventTemplates) {
    return {
      strategy: "no_intervention",
      reasonCode: "director_not_configured",
      rationaleSummary: "当前固定情境版本未启用双导演策略，不产生教学干预。",
      targetCompetency: "岗位决策与证据意识",
      targetRoleIds: [],
    };
  }
  if (triggerEvent.eventType === "session_started") {
    return {
      strategy: "no_intervention",
      reasonCode: "session_initializing",
      rationaleSummary: "会话刚启动，先保留岗位自主观察窗口，不提前给出解题方向。",
      targetCompetency: "岗位任务识别",
      targetRoleIds: ["responsible_editor", "reporter"],
    };
  }
  if (triggerEvent.eventType === "publication_paused") {
    return {
      strategy: "observe_more",
      reasonCode: "release_gate_reached",
      rationaleSummary: "学生已经主动触发发布门禁，继续观察其证据组织与提交质量。",
      targetCompetency: "发布风险决策",
      targetRoleIds: ["responsible_editor"],
    };
  }
  if (triggerEvent.eventType === "copyright_risk_flagged") {
    return {
      strategy: "teacher_gate",
      reasonCode: "high_risk_governance",
      rationaleSummary: "版权风险已经进入权威世界，建议教师关注学生能否说明用途与授权边界。",
      targetCompetency: "C-GOV-03 素材版权治理",
      targetRoleIds: ["responsible_editor"],
    };
  }
  if (triggerEvent.eventType === "evidence_recorded") {
    if (difficulty === "supportive" || evidenceCount <= 1) {
      return {
        strategy: "procedural_hint",
        reasonCode: "evidence_gap",
        rationaleSummary: "当前证据覆盖仍薄弱，仅提示学生按来源、口径和版本整理下一步，不提供结论。",
        targetCompetency: "C-FACT-01 事实核验与信源分级",
        targetRoleIds: ["responsible_editor", "reporter"],
      };
    }
    if (difficulty === "challenging" && evidenceCount >= 3) {
      return {
        strategy: "challenge",
        reasonCode: "evidence_ready_for_pressure",
        rationaleSummary: "现有证据已能支撑更高难度的时效与岗位责任冲突。",
        targetCompetency: "C-ROLE-02 时效压力下的发布门禁",
        targetRoleIds: ["responsible_editor", "reporter"],
      };
    }
    return {
      strategy: "socratic_prompt",
      reasonCode: "evidence_needs_reasoning",
      rationaleSummary: "证据数量开始形成，但仍需学生说明哪些材料能支持哪些判断。",
      targetCompetency: "证据—结论对应关系",
      targetRoleIds: ["responsible_editor", "reporter"],
    };
  }
  if (triggerEvent.eventType === "node_activated") {
    const mapping = scenario.experienceDesign?.nodeMappings.find(
      (candidate) => candidate.nodeId === projection.currentNode.nodeId,
    );
    const sceneDirectorContributionRefs = new Set(
      (mapping?.agentContributions ?? [])
        .filter((contribution) => (
          contribution.templateId === "template:agent-scene-director"
        ))
        .map((contribution) => contribution.contributionId),
    );
    const configuredSceneEvent = mapping?.dynamicEvents.find((event) => (
      event.triggerKind === "agent_candidate"
      && sceneDirectorContributionRefs.has(event.triggerRef)
    ));
    if (configuredSceneEvent) {
      return {
        strategy: "challenge",
        reasonCode: "configured_scene_event_ready",
        rationaleSummary: "发布版在当前节点声明了情境导演事件，交由白名单路线生成待教师审批的世界压力。",
        targetCompetency:
          mapping?.capabilityEvidence[0]?.competencyId
          ?? "情境适应与岗位协作",
        targetRoleIds: [
          ...new Set(
            (mapping?.operationTasks ?? []).flatMap((task) => task.roleIds),
          ),
        ],
      };
    }
    if (evidenceCount === 0 || difficulty === "supportive") {
      return {
        strategy: "scaffold",
        reasonCode: "entry_scaffold_needed",
        rationaleSummary: "当前节点缺少过程证据，以任务支架帮助两岗拆分补证责任，但不透露答案。",
        targetCompetency: "C-FACT-01 事实核验与信源分级",
        targetRoleIds: ["responsible_editor", "reporter"],
      };
    }
    if (difficulty === "challenging" && evidenceCount >= 2) {
      return {
        strategy: "challenge",
        reasonCode: "difficulty_pressure_requested",
        rationaleSummary: "证据已达到挑战阈值，建议加入受控时效压力检验岗位门禁。",
        targetCompetency: "C-ROLE-02 时效压力下的发布门禁",
        targetRoleIds: ["responsible_editor", "reporter"],
      };
    }
    return {
      strategy: "socratic_prompt",
      reasonCode: "standard_reasoning_prompt",
      rationaleSummary: "当前采用标准难度，要求学生自行解释证据与行动之间的关系。",
      targetCompetency: "岗位判断与证据解释",
      targetRoleIds: ["responsible_editor", "reporter"],
    };
  }
  return {
    strategy: "observe_more",
    reasonCode: "world_change_observed",
    rationaleSummary: "世界事实刚发生变化，先观察学生如何调整岗位行动，避免连续干预。",
    targetCompetency: "情境适应与证据更新",
    targetRoleIds: ["responsible_editor", "reporter"],
  };
}

function riskRank(risk: "low" | "medium" | "high"): number {
  return risk === "high" ? 3 : risk === "medium" ? 2 : 1;
}

function matchesEvidenceRange(
  template: ScenarioDirectorEventTemplate,
  evidenceCount: number,
): boolean {
  return (
    evidenceCount >= template.minimumEvidenceCount
    && (
      template.maximumEvidenceCount === null
      || evidenceCount <= template.maximumEvidenceCount
    )
  );
}

function activeCooldownKeys(input: AgentTaskHandlerInput): Set<string> {
  const stateVersion = input.projection.stateVersion;
  return new Set(
    input.projection.sceneDirectorDecisions
      .filter((decision) => (
        (decision.outcome === "candidate" || decision.outcome === "fallback")
        && decision.cooldownKey
        && decision.cooldownUntilStateVersion !== null
        && decision.cooldownUntilStateVersion >= stateVersion
      ))
      .map((decision) => decision.cooldownKey)
      .filter((key): key is string => Boolean(key)),
  );
}

function scenarioDifficulty(input: AgentTaskHandlerInput): DirectorDifficulty {
  return input.scenario.directorConfig?.difficulty ?? "standard";
}

interface ScenePlan {
  action: "candidate" | "no_op";
  eligible: ScenarioDirectorEventTemplate[];
  selected: ScenarioDirectorEventTemplate | null;
  fallback: ScenarioDirectorEventTemplate | null;
  reasonCode: string;
  rationaleSummary: string;
  teachingDirectiveId: string | null;
  recoveryOfCandidateId: string | null;
}

function scenePlan(input: AgentTaskHandlerInput): ScenePlan {
  const { projection, scenario, triggerEvent } = input;
  const config = scenario.directorConfig;
  const templates = scenario.directorEventTemplates ?? [];
  if (!config || templates.length === 0) {
    return {
      action: "no_op",
      eligible: [],
      selected: null,
      fallback: null,
      reasonCode: "director_not_configured",
      rationaleSummary: "当前固定情境版本未配置情境导演路线。",
      teachingDirectiveId: null,
      recoveryOfCandidateId: null,
    };
  }

  const currentNodeId = projection.currentNode.nodeId;
  const evidenceCount = projection.evidence.length;
  const difficulty = config.difficulty;
  const allowed = new Set(config.allowedRouteIds);

  if (triggerEvent.eventType === "director_recovery_requested") {
    const candidateId = String(triggerEvent.payload.candidateId ?? "");
    const rejected = projection.candidateHistory.find((candidate) => candidate.candidateId === candidateId);
    if (!rejected || rejected.status !== "rejected") {
      return {
        action: "no_op",
        eligible: [],
        selected: null,
        fallback: null,
        reasonCode: "rejected_candidate_missing",
        rationaleSummary: "驳回恢复触发未找到对应的已驳回候选，安全终止本轮恢复。",
        teachingDirectiveId: null,
        recoveryOfCandidateId: candidateId || null,
      };
    }
    const attemptedRouteIds = new Set(
      projection.candidateHistory
        .filter((candidate) => (
          candidate.candidateId === rejected.candidateId
          || candidate.recoveryOfCandidateId === rejected.candidateId
        ))
        .map((candidate) => candidate.routeId)
        .filter((routeId): routeId is string => Boolean(routeId)),
    );
    const recoveryRoutes = rejected.alternativeRouteIds
      .map((routeId) => templates.find((template) => template.routeId === routeId))
      .filter((template): template is ScenarioDirectorEventTemplate => Boolean(template))
      .filter((template) => allowed.has(template.routeId))
      .filter((template) => template.kind === "recovery")
      .filter((template) => template.applicableNodeIds.includes(currentNodeId))
      .filter((template) => !attemptedRouteIds.has(template.routeId))
      .sort((left, right) => right.priority - left.priority || left.routeId.localeCompare(right.routeId));
    const selected = recoveryRoutes[0] ?? null;
    if (!selected) {
      return {
        action: "no_op",
        eligible: [],
        selected: null,
        fallback: null,
        reasonCode: rejected.candidateKind === "director_intervention"
          ? "recovery_exhausted"
          : "recovery_not_applicable",
        rationaleSummary: rejected.candidateKind === "director_intervention"
          ? "原候选没有尚未尝试的安全替代路线，已审计终止恢复以避免循环。"
          : "该固定岗位事件不属于导演路线，已记录安全终止且不改写世界。",
        teachingDirectiveId: rejected.teachingDirectiveId,
        recoveryOfCandidateId: rejected.candidateId,
      };
    }
    return {
      action: "candidate",
      eligible: recoveryRoutes,
      selected,
      fallback: selected,
      reasonCode: "teacher_rejection_recovery",
      rationaleSummary: "教师驳回原压力事件后，改用情境包预先审核的低风险替代路线。",
      teachingDirectiveId: rejected.teachingDirectiveId,
      recoveryOfCandidateId: rejected.candidateId,
    };
  }

  if (projection.pendingCandidates.some((candidate) => candidate.candidateKind === "director_intervention")) {
    return {
      action: "no_op",
      eligible: [],
      selected: null,
      fallback: null,
      reasonCode: "duplicate_pending",
      rationaleSummary: "已有情境导演候选等待教师处理，本轮不重复施加世界压力。",
      teachingDirectiveId: null,
      recoveryOfCandidateId: null,
    };
  }

  const directive = projection.teachingDirectives.findLast((item) => (
    item.triggerEventIds.includes(triggerEvent.eventId)
  ));
  if (!directive) {
    return {
      action: "no_op",
      eligible: [],
      selected: null,
      fallback: null,
      reasonCode: "teaching_directive_missing",
      rationaleSummary: "没有找到与本次触发同因果的教学导演指令，安全保持世界不变。",
      teachingDirectiveId: null,
      recoveryOfCandidateId: null,
    };
  }
  if (!directive.handoffToSceneDirector) {
    return {
      action: "no_op",
      eligible: [],
      selected: null,
      fallback: null,
      reasonCode: "difficulty_aligned",
      rationaleSummary: "教学导演判断当前只需观察或追问，不需要新增世界事件。",
      teachingDirectiveId: directive.directiveId,
      recoveryOfCandidateId: null,
    };
  }

  const beforeCooldown = templates
    .filter((template) => allowed.has(template.routeId))
    .filter((template) => template.kind !== "recovery")
    .filter((template) => template.applicableNodeIds.includes(currentNodeId))
    .filter((template) => template.triggerEventTypes.includes(triggerEvent.eventType))
    .filter((template) => template.teachingStrategies.includes(directive.strategy))
    .filter((template) => template.difficultyLevels.includes(difficulty))
    .filter((template) => matchesEvidenceRange(template, evidenceCount))
    .sort((left, right) => right.priority - left.priority || left.routeId.localeCompare(right.routeId));
  const cooldowns = activeCooldownKeys(input);
  const eligible = beforeCooldown.filter((template) => !cooldowns.has(template.cooldownKey));
  if (eligible.length === 0) {
    return {
      action: "no_op",
      eligible: beforeCooldown,
      selected: null,
      fallback: null,
      reasonCode: beforeCooldown.length > 0 ? "cooldown_active" : "no_matching_route",
      rationaleSummary: beforeCooldown.length > 0
        ? "匹配路线仍处于事件日志可回放的冷却窗口，本轮不重复提议。"
        : "没有同时满足节点、证据、难度和教学策略约束的路线。",
      teachingDirectiveId: directive.directiveId,
      recoveryOfCandidateId: null,
    };
  }
  return {
    action: "candidate",
    eligible,
    selected: eligible[0] ?? null,
    fallback: eligible.find((template) => template.riskLevel === "low") ?? eligible[0] ?? null,
    reasonCode: eligible.length > 1 ? "multiple_routes_eligible" : "single_route_eligible",
    rationaleSummary: eligible.length > 1
      ? "多条受控路线同时满足约束，交由复杂规划节点在白名单内选择。"
      : "唯一受控模板满足当前节点、证据、难度与教学目标。",
    teachingDirectiveId: directive.directiveId,
    recoveryOfCandidateId: null,
  };
}

abstract class BaseDirectorTaskHandler implements AgentTaskHandler {
  abstract readonly handlerId: string;
  abstract matches(
    task: AgentTaskHandlerInput["task"],
    triggerEvent: AgentTaskHandlerInput["triggerEvent"],
  ): boolean;
  abstract run(input: AgentTaskHandlerInput): Promise<AgentRunResult>;
  protected readonly runtime: DirectorRunner;
  protected readonly contextAssembler: VersionedContextAssembler;
  protected readonly now: () => string;
  protected readonly nextId: IdGenerator["next"];

  constructor(input: {
    runtime: DirectorRunner | AgentRuntime;
    contextAssembler?: VersionedContextAssembler;
    now?: () => string;
    nextId?: IdGenerator["next"];
  }) {
    this.runtime = input.runtime;
    this.contextAssembler = input.contextAssembler ?? new VersionedContextAssembler();
    this.now = input.now ?? (() => new Date().toISOString());
    this.nextId = input.nextId ?? ((prefix) => `${prefix}-${crypto.randomUUID()}`);
  }

  protected async context(
    input: AgentTaskHandlerInput,
    query: string,
    fixed: string[],
    transient: Array<{ itemId: string; content: string; source: string; version: string }>,
  ): Promise<ContextAssemblyResult> {
    const role = input.projection.role;
    const access = createAccessSubject({
      role,
      sessionId: input.projection.sessionId,
      sessionEpoch: input.projection.sessionEpoch,
      courseId: input.projection.scenario.courseId,
      purpose: "runtime",
    });
    const audience = createResourceAudience({
      scopes: ["assigned_team", "audit_only"],
      courseId: input.projection.scenario.courseId,
      sessionId: input.projection.sessionId,
      sessionEpoch: input.projection.sessionEpoch,
      teamIds: [role.teamId],
      roleIds: [role.roleId],
      actorIds: [role.agentId],
      auditReadable: true,
    });
    return this.contextAssembler.assemble({
      query,
      subject: access,
      scenarioVersion: input.scenario.version,
      scenarioContentHash: input.projection.scenario.contentHash,
      nodeId: input.projection.currentNode.nodeId,
      stateVersion: input.projection.stateVersion,
      tokenBudget: role.tokenBudget,
      chunks: input.scenario.knowledgeChunks,
      facts: input.projection.facts,
      evidence: input.projection.evidence,
      fixed,
      transient: transient.map((item) => ({ ...item, audience })),
      assembledAt: this.now(),
    });
  }

  protected request(
    input: AgentTaskHandlerInput,
    context: ContextAssemblyResult,
    signals: AgentRunRequest["signals"],
  ): AgentRunRequest {
    const now = this.now();
    return AgentRunRequestSchema.parse({
      ...createMessageMeta({
        sessionId: input.projection.sessionId,
        sceneId: input.scenario.scenarioId,
        actorId: input.projection.role.agentId,
        correlationId: input.task.correlationId,
        timestamp: now,
      }),
      kind: "AgentRunRequest",
      taskId: input.task.taskId,
      agentRunId: this.nextId("agent-run"),
      templateRef: input.task.templateRef,
      instanceRef: input.task.instanceRef,
      role: input.projection.role,
      trigger: {
        type: input.task.triggerEventType,
        sourceId: input.task.triggerEventId,
      },
      stateVersion: input.task.expectedStateVersion,
      access: createAccessSubject({
        role: input.projection.role,
        sessionId: input.projection.sessionId,
        sessionEpoch: input.projection.sessionEpoch,
        courseId: input.projection.scenario.courseId,
        purpose: "runtime",
      }),
      context: context.context,
      contextManifest: context.manifest,
      signals,
    });
  }
}

export class TeachingDirectorTaskHandler extends BaseDirectorTaskHandler {
  readonly handlerId = "teaching-director/world-progress/v1";

  matches(
    task: AgentTaskHandlerInput["task"],
    triggerEvent: AgentTaskHandlerInput["triggerEvent"],
  ): boolean {
    return (
      task.agentId === teachingDirectorAgentDefinition.agentId
      && task.roleId === teachingDirectorAgentDefinition.roleId
      && task.definitionVersion === teachingDirectorAgentDefinition.definitionVersion
      && task.promptVersion === teachingDirectorAgentDefinition.promptVersion
      && teachingDirectorAgentDefinition.allowedTriggers.includes(triggerEvent.eventType)
    );
  }

  async run(input: AgentTaskHandlerInput): Promise<AgentRunResult> {
    if (
      input.projection.role.agentId !== input.task.agentId
      || input.projection.role.roleId !== input.task.roleId
      || input.projection.role.actorKind !== "agent"
    ) {
      throw new Error("教学导演任务与授权投影身份不一致");
    }
    const plan = teachingPlan(input);
    const cadence = input.scenario.directorConfig?.cadence ?? "balanced";
    const context = await this.context(
      input,
      "根据当前节点、证据覆盖和教师难度策略判断是否需要教学干预",
      [
        "只输出结构化教学指令，不生成世界事实、分数或标准答案。",
        "证据不足时可以明确 no_intervention；任何情境压力由世界内核和教师门处理。",
        `固定情境难度：${scenarioDifficulty(input)}`,
        `固定事件节奏：${cadence}`,
      ],
      [{
        itemId: `trigger:${input.triggerEvent.eventId}`,
        content: `脱敏触发：${input.triggerEvent.eventType}；当前节点：${input.projection.currentNode.nodeId}；可见证据数：${input.projection.evidence.length}`,
        source: input.triggerEvent.eventId,
        version: String(input.triggerEvent.stateVersion),
      }],
    );
    const request = this.request(input, context, {
      teachingStrategy: plan.strategy,
      reasonCode: plan.reasonCode,
      rationaleSummary: plan.rationaleSummary,
      targetCompetency: plan.targetCompetency,
      targetRoleIds: plan.targetRoleIds.join(","),
      difficulty: scenarioDifficulty(input),
      cadence,
      handoffToSceneDirector: shouldHandoffToSceneDirector(plan.strategy, cadence),
      evidenceRefs: input.projection.evidence.map((item) => item.evidenceId).join(","),
    });
    return this.runtime.run(teachingDirectorAgentDefinition, request);
  }
}

export class SceneDirectorTaskHandler extends BaseDirectorTaskHandler {
  readonly handlerId = "scene-director/world-pressure/v1";

  matches(
    task: AgentTaskHandlerInput["task"],
    triggerEvent: AgentTaskHandlerInput["triggerEvent"],
  ): boolean {
    return (
      task.agentId === sceneDirectorAgentDefinition.agentId
      && task.roleId === sceneDirectorAgentDefinition.roleId
      && task.definitionVersion === sceneDirectorAgentDefinition.definitionVersion
      && task.promptVersion === sceneDirectorAgentDefinition.promptVersion
      && sceneDirectorAgentDefinition.allowedTriggers.includes(triggerEvent.eventType)
    );
  }

  async run(input: AgentTaskHandlerInput): Promise<AgentRunResult> {
    if (
      input.projection.role.agentId !== input.task.agentId
      || input.projection.role.roleId !== input.task.roleId
      || input.projection.role.actorKind !== "agent"
    ) {
      throw new Error("情境导演任务与授权投影身份不一致");
    }
    const plan = scenePlan(input);
    const routeSummaries = plan.eligible.map((template) => ({
      itemId: `director-route:${template.routeId}`,
      content: [
        `routeId=${template.routeId}`,
        `类型=${template.kind}`,
        `能力点=${template.competencyTarget}`,
        `预期影响=${template.expectedImpact}`,
        `风险=${template.riskLevel}`,
        `受影响岗位=${template.affectedRoleIds.join("、")}`,
      ].join("\n"),
      source: template.sourceRefs[0] ?? template.routeId,
      version: input.scenario.version,
    }));
    const context = await this.context(
      input,
      "从情境包白名单路线中选择与当前能力、证据、难度和冷却状态一致的下一事件",
      [
        "模型只能选择已列出的 routeId；世界内核会重新解析模板并生成候选。",
        "不得读取或推断角色私有记忆、评价分数、教师备注和标准答案。",
        `固定情境难度：${scenarioDifficulty(input)}`,
        `固定事件节奏：${input.scenario.directorConfig?.cadence ?? "balanced"}`,
      ],
      routeSummaries.length > 0
        ? routeSummaries
        : [{
            itemId: `director-no-op:${input.triggerEvent.eventId}`,
            content: `本轮无可用路线；原因码=${plan.reasonCode}`,
            source: input.triggerEvent.eventId,
            version: String(input.triggerEvent.stateVersion),
          }],
    );
    const highestRisk = plan.eligible
      .map((template) => template.riskLevel)
      .sort((left, right) => riskRank(right) - riskRank(left))[0] ?? "low";
    const request = this.request(input, context, {
      directorAction: plan.action === "candidate" ? "candidate" : "no_op",
      selectionMode: plan.eligible.length > 1 ? "model" : "template",
      allowedRouteIds: plan.eligible.map((template) => template.routeId).join(","),
      selectedRouteId: plan.selected?.routeId ?? "",
      fallbackRouteId: plan.fallback?.routeId ?? "",
      selectedRiskLevel: highestRisk,
      reasonCode: plan.reasonCode,
      rationaleSummary: plan.rationaleSummary,
      teachingDirectiveId: plan.teachingDirectiveId ?? "",
      recoveryOfCandidateId: plan.recoveryOfCandidateId ?? "",
      difficulty: scenarioDifficulty(input),
      cadence: input.scenario.directorConfig?.cadence ?? "balanced",
      evidenceRefs: input.projection.evidence.map((item) => item.evidenceId).join(","),
    });
    return this.runtime.run(sceneDirectorAgentDefinition, request);
  }
}
