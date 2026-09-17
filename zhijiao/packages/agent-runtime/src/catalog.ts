import {
  AgentInstanceSchema,
  AgentScaleSchemaVersion,
  AgentSubscriptionSchema,
  AgentTemplateCatalogEntrySchema,
  AgentTemplateCatalogSchemaVersion,
  AgentTemplateSchema,
  type AgentDefinition,
  type AgentInstance,
  type AgentSubscription,
  type AgentTask,
  type AgentTemplate,
  type AgentTemplateCatalogEntry,
  type AgentTemplatePlane,
  type AgentTemplateRef,
  type RoleId,
} from "@ronggang/contracts";
import {
  assistanceAgentDefinitions,
  assistanceTemplateProfiles,
} from "./definitions/assistants.js";
import {
  sceneDirectorAgentDefinition,
  teachingDirectorAgentDefinition,
} from "./definitions/directors.js";
import {
  learningCuratorAgentDefinition,
  semanticEvaluatorDefinitions,
} from "./definitions/evaluators.js";
import { factCheckerAgentDefinition } from "./definitions/fact-checker.js";
import { roleAgentDefinitions } from "./definitions/role-agent.js";
import { createAgentTemplate } from "./scale-model.js";

export class AgentTemplateCatalogConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentTemplateCatalogConfigurationError";
  }
}

function templateKey(reference: AgentTemplateRef): string {
  return `${reference.templateId}@${reference.templateVersion}`;
}

function baselineAdmission(input: {
  responsibility: string;
  permissionBoundary: string;
  contextBoundary: string;
  outputContract: string;
  triggerAndFilterPolicy: string;
  failureRoute: string;
}): AgentTemplateCatalogEntry["admission"] {
  return {
    status: "baseline",
    responsibilityCase: input.responsibility,
    permissionBoundary: input.permissionBoundary,
    contextBoundary: input.contextBoundary,
    outputContract: input.outputContract,
    triggerAndFilterPolicy: input.triggerAndFilterPolicy,
    failureRoute: input.failureRoute,
    ablationHypothesis:
      "作为 V1.0 已验证基线保留；后续实验只可通过固定输入和完整回放证明可合并，不能按名称直接删除。",
  };
}

interface BaselineDefinitionProfile {
  definition: AgentDefinition;
  plane: AgentTemplatePlane;
  responsibility: string;
  permissionBoundary: string;
  contextBoundary: string;
  outputContract: string;
  triggerAndFilterPolicy: string;
  failureRoute: string;
}

const baselineDefinitionProfiles: readonly BaselineDefinitionProfile[] = [
  {
    definition: teachingDirectorAgentDefinition,
    plane: "teaching_direction",
    responsibility: "根据节点、证据和教学节奏选择支架、挑战、等待、补证或教师交接方向。",
    permissionBoundary: "只读公开能力、节点、证据摘要和教师策略；不得创造剧情、读取岗位私有记忆或直接改变世界。",
    contextBoundary: "固定到当前情境发布版、节点、节奏和冷却状态。",
    outputContract: "TeachingDirective 或可审计 no_op。",
    triggerAndFilterPolicy: "仅处理发布版声明的世界进展事件，并在无合法路线时停止。",
    failureRoute: "缺少合法路线时记录 no_op，不伪造教学目标。",
  },
  {
    definition: sceneDirectorAgentDefinition,
    plane: "teaching_direction",
    responsibility: "把教学方向转成白名单内的职业压力、冲突或反馈候选。",
    permissionBoundary: "只可从发布版路线白名单选择；不得批准候选、判断事实真伪或读取角色私有记忆。",
    contextBoundary: "固定当前发布版、前置哈希、能力点、冷却和公开事实。",
    outputContract: "CandidateEvent 草稿或可审计 no_op。",
    triggerAndFilterPolicy: "只处理合法路线的声明触发，驳回恢复最多选择一次受控替代路线。",
    failureRoute: "模型失败时回退安全模板或 no_op。",
  },
  ...[...roleAgentDefinitions.values()].map((definition) => ({
    definition,
    plane: "world_role" as const,
    responsibility: `以 ${definition.roleId} 岗位身份进行定向、连续且可追踪的职业协作。`,
    permissionBoundary: "只读本岗位、团队、线程与私有记忆；对话和世界动作严格分离。",
    contextBoundary: "固定接收者、互动选项、线程、轮次、团队和岗位安全投影。",
    outputContract: "RoleResponseIntent 与可选独立 ExecutableAgentIntent。",
    triggerAndFilterPolicy: "仅精确匹配 role_interaction_requested 的目标 agentId。",
    failureRoute: "返回安全追问、稍后回复或显式 degraded，不拼接其他岗位上下文。",
  })),
  {
    definition: factCheckerAgentDefinition,
    plane: "professional_governance",
    responsibility: "核验固定材料中的事实声明并提出更正或补证建议。",
    permissionBoundary: "只能使用授权来源与观察，不得把观察自动提升为事实或批准发布。",
    contextBoundary: "固定材料、观察、事实版本、来源引用和学生可见投影。",
    outputContract: "事实更正或补证 ExecutableAgentIntent。",
    triggerAndFilterPolicy: "仅 material_observed 触发，并受材料与来源完整性守卫。",
    failureRoute: "证据不足时只请求补证。",
  },
  ...[...semanticEvaluatorDefinitions.values()].map((definition) => ({
    definition,
    plane: "trusted_evaluation" as const,
    responsibility: `只承担 ${definition.agentId} 声明的评价维度，形成非最终逐维建议。`,
    permissionBoundary: "只读固定案件、Rubric 和证据白名单；不得形成最终成绩。",
    contextBoundary: "固定 evaluationCase、evidenceBundle、成果修订和分支类型。",
    outputContract: "EvaluationProposal 或 status=unavailable。",
    triggerAndFilterPolicy: "只处理案件开启或同分支重试事件。",
    failureRoute: "超时、坏 JSON 或越权引用时形成显式 unavailable，不复制旧分。",
  })),
  {
    definition: learningCuratorAgentDefinition,
    plane: "supervised_learning",
    responsibility: "从教师已终评的安全输入提炼待审核、可回放的学习候选。",
    permissionBoundary: "只读公开终评与授权证据；不得发布、改分、修改课程或回写历史。",
    contextBoundary: "固定终评、案件、证据交集与候选类型白名单。",
    outputContract: "pending_review LearningCandidate 建议。",
    triggerAndFilterPolicy: "只处理教师终评和该候选生成重试。",
    failureRoute: "生成失败时记录 unavailable，保持人工审核链。",
  },
];

function baselineEntry(
  profile: BaselineDefinitionProfile,
): AgentTemplateCatalogEntry {
  const template = AgentTemplateSchema.parse({
    ...createAgentTemplate(profile.definition, true),
    responsibility: profile.responsibility,
  });
  return AgentTemplateCatalogEntrySchema.parse({
    schemaVersion: AgentTemplateCatalogSchemaVersion,
    template,
    plane: profile.plane,
    lifecycle: "baseline",
    admission: baselineAdmission(profile),
  });
}

interface GovernanceTemplateProfile {
  templateId: string;
  roleId: RoleId;
  responsibility: string;
  outputSchemaRef: string;
  promptVersion: string;
  rulesetRef: string;
}

const governanceTemplateProfiles: readonly GovernanceTemplateProfile[] = [
  {
    templateId: "governance/copyright",
    roleId: "fact_checker",
    responsibility: "对固定材料版本执行版权来源、授权范围、渠道、地域和期限分析。",
    outputSchemaRef: "governance-finding/copyright/1.0.0",
    promptVersion: "governance-copyright/1.0.1",
    rulesetRef: "copyright-scope/2026.1",
  },
  {
    templateId: "governance/content-safety",
    roleId: "fact_checker",
    responsibility: "对固定材料版本执行内容安全规则与风险分析。",
    outputSchemaRef: "governance-finding/content-safety/1.0.0",
    promptVersion: "governance-content-safety/1.0.1",
    rulesetRef: "content-safety/2026.1",
  },
  {
    templateId: "governance/platform-rule",
    roleId: "fact_checker",
    responsibility: "对固定材料版本执行目标平台规则与发布适配分析。",
    outputSchemaRef: "governance-finding/platform-rule/1.0.0",
    promptVersion: "governance-platform-rule/1.0.1",
    rulesetRef: "platform-rule/2026.1",
  },
];

function governanceEntry(
  profile: GovernanceTemplateProfile,
): AgentTemplateCatalogEntry {
  const template = AgentTemplateSchema.parse({
    schemaVersion: AgentScaleSchemaVersion,
    templateId: profile.templateId,
    templateVersion: "1.0.0",
    roleId: profile.roleId,
    definitionVersion: `${profile.templateId}/1.0.0`,
    promptVersion: profile.promptVersion,
    allowedTriggers: ["governance_review_requested"],
    allowedIntents: ["record_governance_finding"],
    responsibility: profile.responsibility,
    capabilityDomains: ["professional_governance", profile.templateId],
    graphRef: `governance-execution:${profile.templateId}@1.0.0`,
    promptPolicyRef: profile.promptVersion,
    toolPolicyRef: "governance-observation-tools/1.0.0",
    permissionPolicyRef: "governance-fixed-material/1.0.0",
    contextPolicyRef: "governance-material-version-and-citations/1.0.0",
    outputSchemaRef: profile.outputSchemaRef,
    allowedInstanceKinds: ["resource"],
    failurePolicyRef: "governance-unavailable/1.0.0",
    budget: { maxSteps: 5, maxToolCalls: 1, timeoutMs: 60_000 },
    enabled: true,
  });
  return AgentTemplateCatalogEntrySchema.parse({
    schemaVersion: AgentTemplateCatalogSchemaVersion,
    template,
    plane: "professional_governance",
    lifecycle: "baseline",
    admission: baselineAdmission({
      responsibility: profile.responsibility,
      permissionBoundary: "只处理固定 materialId@version/contentHash，不能降低确定性规则下限或批准发布。",
      contextBoundary: `只装配材料安全快照、授权观察、规则集 ${profile.rulesetRef} 和引用白名单。`,
      outputContract: `${profile.outputSchemaRef}，由世界内核复算并仲裁。`,
      triggerAndFilterPolicy: "仅治理案件中的同域固定步骤运行；其他领域不共享模型结论。",
      failureRoute: "工具或模型不可用时记录 unavailable，不用其他分支结果冒充。",
    }),
  });
}

function assistanceEntry(
  profile: (typeof assistanceTemplateProfiles)[number],
): AgentTemplateCatalogEntry {
  const definition = assistanceAgentDefinitions.get(profile.agentId);
  if (!definition) {
    throw new AgentTemplateCatalogConfigurationError(
      `辅助模板缺少定义：${profile.agentId}`,
    );
  }
  const template = AgentTemplateSchema.parse({
    ...createAgentTemplate(definition, profile.active),
    responsibility: profile.responsibility,
    capabilityDomains: [profile.plane, profile.kind],
    permissionPolicyRef: `assistance-permission:${profile.kind}/1.0.0`,
    contextPolicyRef: `assistance-context:${profile.kind}/1.0.0`,
    outputSchemaRef: profile.outputSchemaRef,
    allowedInstanceKinds: profile.plane === "student_assistance"
      ? ["student_role"]
      : profile.plane === "material_production"
        ? ["resource"]
        : profile.kind === "evaluation_review"
          ? ["teacher_assistant", "resource"]
          : ["teacher_assistant"],
    failurePolicyRef: `assistance-failure:${profile.kind}/1.0.0`,
    enabled: profile.active,
  });
  return AgentTemplateCatalogEntrySchema.parse({
    schemaVersion: AgentTemplateCatalogSchemaVersion,
    template,
    plane: profile.plane,
    lifecycle: profile.active ? "active" : "candidate",
    admission: {
      status: profile.active ? "pending_ablation" : "design_gate_passed",
      responsibilityCase: profile.responsibility,
      permissionBoundary: profile.permissionBoundary,
      contextBoundary: profile.contextBoundary,
      outputContract: profile.outputSchemaRef,
      triggerAndFilterPolicy: profile.triggerPolicy,
      ablationHypothesis: profile.ablationHypothesis,
      failureRoute: profile.failureRoute,
    },
  });
}

export class AgentTemplateCatalog {
  readonly #entries: readonly AgentTemplateCatalogEntry[];
  readonly #byReference: ReadonlyMap<string, AgentTemplateCatalogEntry>;

  constructor(rawEntries: readonly AgentTemplateCatalogEntry[]) {
    const entries = rawEntries.map((entry) => (
      AgentTemplateCatalogEntrySchema.parse(entry)
    ));
    const byReference = new Map<string, AgentTemplateCatalogEntry>();
    for (const entry of entries) {
      const key = templateKey({
        templateId: entry.template.templateId,
        templateVersion: entry.template.templateVersion,
      });
      if (byReference.has(key)) {
        throw new AgentTemplateCatalogConfigurationError(
          `模板目录存在重复版本：${key}`,
        );
      }
      byReference.set(key, entry);
    }
    this.#entries = Object.freeze(entries.slice());
    this.#byReference = byReference;
  }

  list(): AgentTemplateCatalogEntry[] {
    return this.#entries.map((entry) => structuredClone(entry));
  }

  get(reference: AgentTemplateRef): AgentTemplateCatalogEntry | null {
    const entry = this.#byReference.get(templateKey(reference));
    return entry ? structuredClone(entry) : null;
  }

  assertSubscription(rawSubscription: AgentSubscription): void {
    const subscription = AgentSubscriptionSchema.parse(rawSubscription);
    const entry = this.#byReference.get(templateKey(subscription.templateRef));
    if (!entry) {
      throw new AgentTemplateCatalogConfigurationError(
        `订阅引用未登记模板：${subscription.subscriptionId}/${templateKey(subscription.templateRef)}`,
      );
    }
    const template = entry.template;
    const mismatches = [
      template.roleId === subscription.roleId ? null : "roleId",
      template.definitionVersion === subscription.definitionVersion
        ? null
        : "definitionVersion",
      template.promptVersion === subscription.promptVersion
        ? null
        : "promptVersion",
      template.enabled === subscription.enabled ? null : "enabled",
      subscription.eventTypes.every((eventType) => (
        template.allowedTriggers.includes(eventType)
      ))
        ? null
        : "eventTypes",
    ].filter((value): value is string => value !== null);
    if (mismatches.length > 0) {
      throw new AgentTemplateCatalogConfigurationError(
        `订阅与模板目录不一致：${subscription.subscriptionId}/${mismatches.join(",")}`,
      );
    }
  }
}

export function materializeAgentInstances(
  rawTasks: readonly AgentTask[],
): AgentInstance[] {
  const instances = new Map<string, AgentInstance>();
  const signatures = new Map<string, string>();
  for (const task of rawTasks) {
    const signature = JSON.stringify({
      templateRef: task.templateRef,
      agentId: task.agentId,
      roleId: task.roleId,
      sessionId: task.sessionId,
      sessionEpoch: task.sessionEpoch,
      context: task.instanceContext,
      roleSnapshot: task.roleSnapshot,
    });
    const existingSignature = signatures.get(task.instanceRef.instanceId);
    if (existingSignature && existingSignature !== signature) {
      throw new AgentTemplateCatalogConfigurationError(
        `同一实例引用出现不一致任务快照：${task.instanceRef.instanceId}`,
      );
    }
    signatures.set(task.instanceRef.instanceId, signature);
    if (instances.has(task.instanceRef.instanceId)) continue;
    instances.set(task.instanceRef.instanceId, AgentInstanceSchema.parse({
      schemaVersion: AgentScaleSchemaVersion,
      instanceRef: task.instanceRef,
      templateRef: task.templateRef,
      agentId: task.agentId,
      roleId: task.roleId,
      sessionId: task.sessionId,
      sessionEpoch: task.sessionEpoch,
      context: task.instanceContext,
      roleSnapshot: task.roleSnapshot,
      createdAt: task.createdAt,
    }));
  }
  return [...instances.values()].sort((left, right) => (
    left.createdAt.localeCompare(right.createdAt)
    || left.instanceRef.instanceId.localeCompare(right.instanceRef.instanceId)
  ));
}

export const productionAgentTemplateCatalog = new AgentTemplateCatalog([
  ...baselineDefinitionProfiles.map(baselineEntry),
  ...governanceTemplateProfiles.map(governanceEntry),
  ...assistanceTemplateProfiles.map(assistanceEntry),
]);
