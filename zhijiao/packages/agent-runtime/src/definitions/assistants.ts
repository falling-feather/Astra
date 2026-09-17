import {
  AgentAssistanceOutputSchema,
  AgentAssistanceProposalSchema,
  AgentDefinitionSchema,
  AgentSubscriptionSchema,
  RoleContractSchema,
  createMessageMeta,
  type AgentAssistanceKind,
  type AgentAssistanceOutput,
  type AgentAssistanceProposal,
  type AgentDefinition,
  type AgentRunRequest,
  type AgentSubscription,
  type AgentTemplatePlane,
  type ModelInvocationTrace,
  type RoleContract,
  type RoleId,
  type VersionedObjectRef,
  type VisibilityScope,
  type WorldEvent,
} from "@ronggang/contracts";
import {
  ModelInvocationError,
  type StructuredModelPort,
} from "@ronggang/model-gateway";
import { compileAgentPrompt, type AgentPromptTemplate } from "../prompt.js";
import {
  AgentRuntimeExecutionError,
  type AgentNodeExecutor,
} from "../runtime.js";

export type AssistanceInstanceStrategy =
  | "event_actor"
  | "evidence_actor"
  | "media_task_requester"
  | "artifact_author"
  | "teacher_actor";

export type AssistanceContributionNode =
  | "student_evidence_recorded"
  | "material_processing_completed"
  | "teacher_evaluation_arbitrated";

export interface AssistanceContributionView {
  criticalNode: AssistanceContributionNode;
  rolePerspective: string;
  studentDecision: boolean;
}

export interface AssistanceTemplateProfile {
  kind: AgentAssistanceKind;
  agentId: string;
  roleId: Extract<
    RoleId,
    "student_assistant" | "content_assistant" | "teacher_assistant"
  >;
  label: string;
  responsibility: string;
  plane: Extract<
    AgentTemplatePlane,
    "student_assistance" | "material_production" | "teacher_assistance"
  >;
  templateId: string;
  templateVersion: string;
  definitionVersion: string;
  promptVersion: string;
  outputSchemaRef: string;
  active: boolean;
  triggerEvents: WorldEvent["eventType"][];
  instanceStrategy: AssistanceInstanceStrategy;
  permissionBoundary: string;
  contextBoundary: string;
  triggerPolicy: string;
  ablationHypothesis: string;
  failureRoute: string;
  contributionView?: AssistanceContributionView;
}

const assistanceTemplateVersion = "1.0.0";
const assistancePromptVersion = "assistance/1.0.0";

export const assistanceTemplateProfiles = [
  {
    kind: "course_navigation",
    agentId: "agent-course-navigation",
    roleId: "student_assistant",
    label: "课程导航助理",
    responsibility: "解释当前课程目标、岗位职责、节点要求与交付标准，不拆解或完成学生任务。",
    plane: "student_assistance",
    templateId: "assistant/course-navigation",
    templateVersion: assistanceTemplateVersion,
    definitionVersion: "assistant-course-navigation/1.0.0",
    promptVersion: assistancePromptVersion,
    outputSchemaRef: "agent-assistance/course-navigation/1.0.0",
    active: false,
    triggerEvents: ["node_activated"],
    instanceStrategy: "event_actor",
    permissionBoundary: "只读取目标学生当前课程、岗位、节点和公开交付标准，不读取教师说明或其他岗位私有记忆。",
    contextBoundary: "按学生岗位安全投影装配课程指引、当前节点和授权知识。",
    triggerPolicy: "仅在节点切换或学生显式求助时成为候选；当前切片保持停用并留下 subscription_disabled 证据。",
    ablationHypothesis: "移除后学生定位要求的耗时和误解率上升；若与任务规划合并无显著退化则应合并。",
    failureRoute: "模型或 Schema 失败时只返回当前节点入口与人工查看课程卡提示。",
  },
  {
    kind: "task_planning",
    agentId: "agent-task-planning",
    roleId: "student_assistant",
    label: "任务规划助理",
    responsibility: "把学生已经确定的目标拆成可执行步骤、优先级和缺失输入，不替学生作最终选择。",
    plane: "student_assistance",
    templateId: "assistant/task-planning",
    templateVersion: assistanceTemplateVersion,
    definitionVersion: "assistant-task-planning/1.0.0",
    promptVersion: assistancePromptVersion,
    outputSchemaRef: "agent-assistance/task-planning/1.0.0",
    active: false,
    triggerEvents: ["evidence_recorded"],
    instanceStrategy: "evidence_actor",
    permissionBoundary: "只处理目标学生可见的任务状态和本人证据，不改变任务完成状态。",
    contextBoundary: "按目标学生投影装配当前节点、完成门和本人证据缺口。",
    triggerPolicy: "学生计划或证据变化时成为候选；当前切片保持停用以验证无关模板不运行。",
    ablationHypothesis: "移除后返工和遗漏增加；若与课程导航合并不增加越权或输出漂移则应合并。",
    failureRoute: "失败时返回一个不含答案的最小检查清单并要求学生自行确认。",
  },
  {
    kind: "evidence_coaching",
    agentId: "agent-evidence-coach",
    roleId: "student_assistant",
    label: "证据教练",
    responsibility: "针对学生已经形成的判断指出证据缺口、追问和核验路径，不提供标准答案。",
    plane: "student_assistance",
    templateId: "assistant/evidence-coach",
    templateVersion: assistanceTemplateVersion,
    definitionVersion: "assistant-evidence-coach/1.0.0",
    promptVersion: assistancePromptVersion,
    outputSchemaRef: "agent-assistance/evidence-coaching/1.0.0",
    active: true,
    triggerEvents: ["evidence_recorded"],
    instanceStrategy: "evidence_actor",
    permissionBoundary: "只读目标学生本人可见证据与授权事实；不得确认事实、提交成果或推进节点。",
    contextBoundary: "实例绑定目标学生岗位，按其安全投影装配当前证据、事实和课程知识。",
    triggerPolicy: "仅学生证据进入世界后运行；非学生证据将实例标记 paused 并记录 instance_inactive。",
    ablationHypothesis: "移除后无来源判断、弱证据结论和教师补证次数上升。",
    failureRoute: "模型、上下文或守卫失败时输出通用补证问题，世界状态保持不变。",
    contributionView: {
      criticalNode: "student_evidence_recorded",
      rolePerspective: "目标学生岗位的证据核验视角",
      studentDecision: true,
    },
  },
  {
    kind: "material_understanding",
    agentId: "agent-material-understanding",
    roleId: "content_assistant",
    label: "材料理解助理",
    responsibility: "把固定材料处理结果整理为观察、实体、未核声明、时间与来源片段，不把观察升级为事实。",
    plane: "material_production",
    templateId: "assistant/material-understanding",
    templateVersion: assistanceTemplateVersion,
    definitionVersion: "assistant-material-understanding/1.0.0",
    promptVersion: assistancePromptVersion,
    outputSchemaRef: "agent-assistance/material-understanding/1.0.0",
    active: true,
    triggerEvents: ["media_processing_completed"],
    instanceStrategy: "media_task_requester",
    permissionBoundary: "只读取发起人可见的固定材料版本与处理输出；不发布、不覆盖原素材、不确认事实。",
    contextBoundary: "实例绑定精确 media task 与材料版本，并复用其请求者安全投影。",
    triggerPolicy: "仅处理档案进入终态后运行；采访结构化等无关候选保持停用。",
    ablationHypothesis: "移除后材料到结构化证据的人工整理时间和来源遗漏上升。",
    failureRoute: "模型失败时保留工具输出并生成 observation_only 摘要，绝不伪造完整提取。",
    contributionView: {
      criticalNode: "material_processing_completed",
      rolePerspective: "材料发起岗位的观察与来源视角",
      studentDecision: true,
    },
  },
  {
    kind: "interview_structuring",
    agentId: "agent-interview-structuring",
    roleId: "content_assistant",
    label: "采访结构化助理",
    responsibility: "把采访转写整理为纪要草稿、待确认声明和追问清单，不确认受访者声明。",
    plane: "material_production",
    templateId: "assistant/interview-structuring",
    templateVersion: assistanceTemplateVersion,
    definitionVersion: "assistant-interview-structuring/1.0.0",
    promptVersion: assistancePromptVersion,
    outputSchemaRef: "agent-assistance/interview-structuring/1.0.0",
    active: false,
    triggerEvents: ["media_processing_completed"],
    instanceStrategy: "media_task_requester",
    permissionBoundary: "只读取授权采访转写与同线程证据，不公开私有承诺或替学生确认纪要。",
    contextBoundary: "绑定精确转写任务、请求岗位和材料版本。",
    triggerPolicy: "仅音频/采访转写完成时应运行；当前切片停用并记录过滤。",
    ablationHypothesis: "移除后声明—证据链接遗漏和追问缺口上升；与材料理解无差异时应合并。",
    failureRoute: "失败时仅提示保留原转写并由学生人工分段确认。",
  },
  {
    kind: "content_adaptation",
    agentId: "agent-content-adaptation",
    roleId: "content_assistant",
    label: "内容适配助理",
    responsibility: "针对固定成果修订给出渠道标题、结构、长度和引用一致性建议，不覆盖原稿或点击发布。",
    plane: "material_production",
    templateId: "assistant/content-adaptation",
    templateVersion: assistanceTemplateVersion,
    definitionVersion: "assistant-content-adaptation/1.0.0",
    promptVersion: assistancePromptVersion,
    outputSchemaRef: "agent-assistance/content-adaptation/1.0.0",
    active: false,
    triggerEvents: ["artifact_revision_saved"],
    instanceStrategy: "artifact_author",
    permissionBoundary: "只读作者可见的固定修订、渠道规则和引用，不写回成果。",
    contextBoundary: "实例绑定精确 revisionId/contentHash 和作者岗位安全投影。",
    triggerPolicy: "仅需要渠道版本的成果修订后运行；当前切片停用。",
    ablationHypothesis: "移除后跨渠道一致性问题增加；若普通编辑提示可达到同等效果则应合并。",
    failureRoute: "失败时只给格式检查入口，不生成或覆盖渠道版本。",
  },
  {
    kind: "course_design",
    agentId: "agent-course-design",
    roleId: "teacher_assistant",
    label: "课程设计助理",
    responsibility: "根据教师目标给出情境草稿差异、缺项、候选节点和量规建议，不能发布课程。",
    plane: "teacher_assistance",
    templateId: "assistant/course-design",
    templateVersion: assistanceTemplateVersion,
    definitionVersion: "assistant-course-design/1.0.0",
    promptVersion: assistancePromptVersion,
    outputSchemaRef: "agent-assistance/course-design/1.0.0",
    active: false,
    triggerEvents: ["session_started"],
    instanceStrategy: "teacher_actor",
    permissionBoundary: "只读取当前教师可管理的课程草稿与版本，不执行发布或修改已发布包。",
    contextBoundary: "实例绑定教师与课程草稿版本，发布包仍由教师校验门控制。",
    triggerPolicy: "教师复制情境或显式请求时运行；当前切片停用。",
    ablationHypothesis: "移除后配置缺项和准备时间上升；若静态校验可替代则保留规则而合并模型模板。",
    failureRoute: "失败时返回现有确定性校验入口和缺项列表。",
  },
  {
    kind: "live_intervention",
    agentId: "agent-live-intervention",
    roleId: "teacher_assistant",
    label: "实时干预助理",
    responsibility: "汇总停滞、证据和风险，给教师等待、提示、追问、追加材料或接管候选，不自动干预。",
    plane: "teacher_assistance",
    templateId: "assistant/live-intervention",
    templateVersion: assistanceTemplateVersion,
    definitionVersion: "assistant-live-intervention/1.0.0",
    promptVersion: assistancePromptVersion,
    outputSchemaRef: "agent-assistance/live-intervention/1.0.0",
    active: false,
    triggerEvents: ["evidence_recorded"],
    instanceStrategy: "teacher_actor",
    permissionBoundary: "只读取教师有权管理的班级/团队聚合；所有干预均需教师选择。",
    contextBoundary: "实例绑定教师与班级会话，不读取无关班级和其他会话。",
    triggerPolicy: "停滞、证据不足、风险升级或教师查询时运行；当前切片停用。",
    ablationHypothesis: "移除后教师发现问题与选择最小介入的时间上升。",
    failureRoute: "失败时明确 unavailable，教师仍可使用现有控制台手动干预。",
  },
  {
    kind: "evaluation_review",
    agentId: "agent-evaluation-review",
    roleId: "teacher_assistant",
    label: "评价复核助理",
    responsibility: "定位固定评价案件的逐维分歧、证据缺口和建议复核顺序，不给最终分。",
    plane: "teacher_assistance",
    templateId: "assistant/evaluation-review",
    templateVersion: assistanceTemplateVersion,
    definitionVersion: "assistant-evaluation-review/1.0.0",
    promptVersion: assistancePromptVersion,
    outputSchemaRef: "agent-assistance/evaluation-review/1.0.0",
    active: true,
    triggerEvents: ["evaluation_arbitrated"],
    instanceStrategy: "teacher_actor",
    permissionBoundary: "只读当前教师可管理的固定案件、证据包、意见与仲裁，不写最终成绩。",
    contextBoundary: "实例绑定教师和精确 arbitration/case；只装配该案件的教师安全投影。",
    triggerPolicy: "评价仲裁完成或发生分歧时运行；无关教师模板不创建任务。",
    ablationHypothesis: "移除后教师定位分歧和完成逐维复核的时间与修订次数上升。",
    failureRoute: "模型失败时按确定性 spread 排序并提示教师人工逐维复核。",
    contributionView: {
      criticalNode: "teacher_evaluation_arbitrated",
      rolePerspective: "教师终评前的逐维复核视角",
      studentDecision: false,
    },
  },
] as const satisfies readonly AssistanceTemplateProfile[];

export const assistanceProfilesByAgentId = new Map<
  string,
  AssistanceTemplateProfile
>(
  assistanceTemplateProfiles.map((profile) => [profile.agentId, profile]),
);

export const assistanceProfilesByTemplateId = new Map<
  string,
  AssistanceTemplateProfile
>(
  assistanceTemplateProfiles.map((profile) => [profile.templateId, profile]),
);

const sharedInstructions = [
  "你是教学工作流中的辅助者，不是行动执行者。",
  "只使用当前实例授权的课程、岗位、材料、案件和引用。",
  "输出只能形成 advisory_only 结构化建议；不得宣称世界、任务、发布、事实、审批或成绩已经改变。",
  "不得提供标准答案、替学生完成成果、替教师终评或绕过 WorldEngine。",
  "未知内容必须保留缺口或未核验状态，不得用模型常识补造情境事实。",
];

function assistancePrompt(
  profile: AssistanceTemplateProfile,
): AgentPromptTemplate {
  return {
    templateId: `${profile.templateId}/prompt`,
    version: profile.promptVersion,
    system: `你是融岗智训的${profile.label}。${profile.responsibility}`,
    instructions: [
      ...sharedInstructions,
      profile.permissionBoundary,
      profile.contextBoundary,
    ],
    outputContract: [
      "只返回一个 JSON 对象，不要 Markdown、代码围栏、前后缀或隐藏推理。",
      `kind 必须为 ${profile.kind}。`,
      `输出契约为 ${profile.outputSchemaRef}；不得增加 WorldEvent、Command、最终成绩或发布状态字段。`,
    ].join("\n"),
  };
}

export const assistancePromptTemplates = new Map<
  string,
  AgentPromptTemplate
>(
  assistanceTemplateProfiles.map((profile) => [
    profile.agentId,
    assistancePrompt(profile),
  ]),
);

function assistanceDefinition(
  profile: AssistanceTemplateProfile,
): AgentDefinition {
  const prompt = assistancePrompt(profile);
  return AgentDefinitionSchema.parse({
    templateRef: {
      templateId: profile.templateId,
      templateVersion: profile.templateVersion,
    },
    agentId: profile.agentId,
    roleId: profile.roleId,
    definitionVersion: profile.definitionVersion,
    promptVersion: profile.promptVersion,
    entryNodeId: "scope-router",
    allowedTriggers: profile.triggerEvents,
    allowedIntents: ["provide_assistance"],
    maxSteps: 5,
    maxToolCalls: 0,
    timeoutMs: 30_000,
    nodes: [
      { nodeId: "scope-router", kind: "router", label: "固定实例、主体与资源权限范围", executorKey: null, promptTemplateId: null, toolName: null },
      { nodeId: "assistance-model", kind: "model", label: `生成${profile.label}结构化草稿`, executorKey: "assistance/model", promptTemplateId: prompt.templateId, toolName: null },
      { nodeId: "output-guard", kind: "guard", label: "Schema、引用与非权威边界守卫", executorKey: "assistance/guard", promptTemplateId: null, toolName: null },
      { nodeId: "safe-fallback", kind: "rule", label: "失败时返回最小安全建议", executorKey: "assistance/fallback", promptTemplateId: null, toolName: null },
      { nodeId: "done", kind: "terminal", label: "返回非权威结构化建议", executorKey: null, promptTemplateId: null, toolName: null },
    ],
    edges: [
      { edgeId: "scope-to-model", from: "scope-router", to: "assistance-model", priority: 0, condition: { kind: "always" } },
      { edgeId: "model-to-guard", from: "assistance-model", to: "output-guard", priority: 100, condition: { kind: "last_status_equals", value: "success" } },
      { edgeId: "model-to-fallback", from: "assistance-model", to: "safe-fallback", priority: 0, condition: { kind: "always" } },
      { edgeId: "guard-to-done", from: "output-guard", to: "done", priority: 100, condition: { kind: "last_status_equals", value: "success" } },
      { edgeId: "guard-to-fallback", from: "output-guard", to: "safe-fallback", priority: 0, condition: { kind: "always" } },
      { edgeId: "fallback-to-done", from: "safe-fallback", to: "done", priority: 0, condition: { kind: "always" } },
    ],
  });
}

export const assistanceAgentDefinitions = new Map<string, AgentDefinition>(
  assistanceTemplateProfiles.map((profile) => [
    profile.agentId,
    assistanceDefinition(profile),
  ]),
);

export const assistanceSubscriptions: AgentSubscription[] =
  assistanceTemplateProfiles.map((profile) => {
    const definition = assistanceAgentDefinitions.get(profile.agentId);
    if (!definition) {
      throw new Error(`辅助智能体定义缺失：${profile.agentId}`);
    }
    return AgentSubscriptionSchema.parse({
      subscriptionId: `${profile.agentId}/${profile.triggerEvents.join("+")}/v1`,
      agentId: profile.agentId,
      roleId: profile.roleId,
      templateRef: definition.templateRef,
      definitionVersion: definition.definitionVersion,
      promptVersion: definition.promptVersion,
      eventTypes: profile.triggerEvents,
      targetActorIdField: null,
      maxCausalDepth: 6,
      debounceMs: 0,
      waveCost: 1,
      priority: profile.active ? 65 : 10,
      enabled: profile.active,
    });
  });

export function createAssistanceRoleSnapshot(
  profile: AssistanceTemplateProfile,
  teamId: string,
): RoleContract {
  const visibleScopes: VisibilityScope[] = profile.plane === "teacher_assistance"
    ? ["teacher_only", "audit_only"]
    : ["assigned_team", "role_private", "audit_only"];
  const toolPolicy = profile.plane === "student_assistance"
    ? ["read_reviewed_facts", "rag_search", "assistance.student.read"]
    : profile.plane === "material_production"
      ? ["material_preview", "processing_output.read", "assistance.material.read"]
      : ["evaluation.case.read", "evaluation.evidence.read", "assistance.teacher.read"];
  return RoleContractSchema.parse({
    agentId: profile.agentId,
    actorKind: "agent",
    roleId: profile.roleId,
    displayName: profile.label,
    purpose: profile.responsibility,
    teamId,
    visibleScopes,
    privateScopes: [`assistant:${profile.templateId}`],
    allowedIntents: ["provide_assistance"],
    deniedActions: [
      "write_world_event",
      "complete_student_task",
      "publish_artifact",
      "approve_candidate",
      "finalize_assessment",
    ],
    toolPolicy,
    tokenBudget: 4_000,
    memoryPolicy: {
      readOwn: false,
      writeOwn: false,
      auditReadable: true,
      retention: "session_epoch",
      maxEntries: 8,
    },
    communicationPolicy: {
      canInitiate: false,
      canRespond: false,
      allowedTargetRoleIds: [],
      maxTurnsPerTarget: 1,
    },
  });
}

export type AssistanceModelOutput = AgentAssistanceOutput & {
  modelTrace?: ModelInvocationTrace;
};

export interface AssistanceModelPort {
  invoke(input: {
    request: AgentRunRequest;
    profile: AssistanceTemplateProfile;
    systemPrompt: string;
    userPrompt: string;
  }): Promise<AssistanceModelOutput>;
}

function signalString(
  request: AgentRunRequest,
  key: string,
  fallback: string,
): string {
  const value = request.signals[key];
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function trustedResourceRef(
  request: AgentRunRequest,
  fallbackType: string,
): VersionedObjectRef {
  return {
    objectType: signalString(request, "resourceType", fallbackType),
    objectId: signalString(request, "resourceId", "unavailable"),
    version: signalString(request, "resourceVersion", "unavailable"),
  };
}

function normalizeAssistanceOutput(
  rawOutput: unknown,
  request: AgentRunRequest,
  profile: AssistanceTemplateProfile,
): AgentAssistanceOutput {
  const parsed = AgentAssistanceOutputSchema.parse(rawOutput);
  if (parsed.kind !== profile.kind) {
    throw new AgentRuntimeExecutionError(
      "assistance_output_kind_mismatch",
      `辅助模型返回错误输出类型：${parsed.kind}`,
    );
  }
  if (parsed.kind === "material_understanding") {
    return AgentAssistanceOutputSchema.parse({
      ...parsed,
      materialRef: {
        objectType: "material",
        objectId: signalString(request, "materialId", "unavailable"),
        version: signalString(request, "materialVersion", "unavailable"),
      },
    });
  }
  if (parsed.kind === "interview_structuring") {
    return AgentAssistanceOutputSchema.parse({
      ...parsed,
      transcriptRef: trustedResourceRef(request, "media_processing_task"),
    });
  }
  if (parsed.kind === "content_adaptation") {
    return AgentAssistanceOutputSchema.parse({
      ...parsed,
      sourceRevisionRef: trustedResourceRef(request, "artifact_revision"),
    });
  }
  if (parsed.kind === "evaluation_review") {
    let dimensionDifferences = parsed.dimensionDifferences;
    const rawDifferences = request.signals.dimensionDifferences;
    if (typeof rawDifferences === "string") {
      try {
        const candidate = JSON.parse(rawDifferences);
        const normalized = AgentAssistanceOutputSchema.safeParse({
          ...parsed,
          dimensionDifferences: candidate,
        });
        if (normalized.success && normalized.data.kind === "evaluation_review") {
          dimensionDifferences = normalized.data.dimensionDifferences;
        }
      } catch {
        // Keep the model result; the output guard still validates it.
      }
    }
    return AgentAssistanceOutputSchema.parse({
      ...parsed,
      evaluationCaseId: signalString(
        request,
        "evaluationCaseId",
        "unavailable",
      ),
      arbitrationId: signalString(
        request,
        "arbitrationId",
        "unavailable",
      ),
      dimensionDifferences,
    });
  }
  return parsed;
}

export class GatewayAssistanceModel implements AssistanceModelPort {
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
    this.#maxOutputTokens = input.maxOutputTokens ?? 1_600;
  }

  async invoke(input: {
    request: AgentRunRequest;
    profile: AssistanceTemplateProfile;
    systemPrompt: string;
    userPrompt: string;
  }): Promise<AssistanceModelOutput> {
    try {
      const result = await this.#provider.invoke({
        invocationId: `${input.request.agentRunId}:${input.profile.kind}`,
        profileId: this.#profileId,
        taskKind: `assistance.${input.profile.kind}`,
        systemPrompt: input.systemPrompt,
        userPrompt: input.userPrompt,
        outputContractId: input.profile.outputSchemaRef,
        outputMode: "json_object",
        temperature: 0,
        maxOutputTokens: this.#maxOutputTokens,
        timeoutMs: this.#timeoutMs,
      });
      return {
        ...normalizeAssistanceOutput(
          result.output,
          input.request,
          input.profile,
        ),
        modelTrace: result.trace,
      };
    } catch (error) {
      if (error instanceof AgentRuntimeExecutionError) throw error;
      if (error instanceof ModelInvocationError) {
        throw new AgentRuntimeExecutionError(
          error.code,
          "辅助模型提供方调用失败",
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

const placeholderRef: VersionedObjectRef = {
  objectType: "pending",
  objectId: "pending",
  version: "pending",
};

export function deterministicAssistanceModelDraft(
  taskKind: string,
): AgentAssistanceOutput | null {
  const kind = taskKind.replace(/^assistance\./u, "");
  switch (kind) {
    case "course_navigation":
      return {
        kind,
        summary: "已按当前岗位解释本节点目标与交付边界。",
        objective: "先确认当前节点要求，再由学生自行完成岗位行动。",
        requirementExplanation: ["查看当前节点必需产物", "核对允许引用的材料与证据"],
        roleBoundary: "助理只解释要求，不替学生完成或提交任务。",
        nextAction: "打开当前节点任务卡并确认一项最小可执行行动。",
      };
    case "task_planning":
      return {
        kind,
        summary: "已把当前目标拆成不含答案的最小步骤。",
        steps: [
          { stepId: "check-gap", label: "核对当前证据缺口", priority: "now", dependsOn: [] },
          { stepId: "collect-source", label: "选择一条可核验来源", priority: "next", dependsOn: ["check-gap"] },
        ],
        missingInputs: ["学生仍需自行确定采用哪条来源"],
      };
    case "evidence_coaching":
      return {
        kind,
        summary: "当前判断需要补充可追溯来源与独立核验。",
        questions: [
          "这项判断直接依据哪一个材料版本或世界事实？",
          "是否存在第二个独立来源能够验证同一结论？",
        ],
        evidenceGaps: ["来源等级尚未说明", "观察与已核事实尚未区分"],
        verificationPath: ["定位原始来源", "记录可确认与不能确认的边界", "再提交学生自己的判断"],
      };
    case "material_understanding":
      return {
        kind,
        summary: "已把处理输出整理为观察与待核声明；没有生成世界事实。",
        materialRef: placeholderRef,
        observations: [{
          label: "处理档案摘要",
          value: "工具输出已经完成，内容仍保持 observation_only。",
          sourceRefs: ["trigger-event"],
        }],
        entities: [],
        claims: [{
          statement: "材料中的声明仍需与授权来源或世界事实核验。",
          verificationStatus: "unverified",
          sourceRefs: ["trigger-event"],
        }],
        timeRefs: [],
      };
    case "interview_structuring":
      return {
        kind,
        summary: "已生成采访纪要草稿与待确认声明。",
        transcriptRef: placeholderRef,
        minutesDraft: ["按说话者与主题复核转写内容"],
        statements: [],
        followUpQuestions: ["哪些内容是亲历陈述，哪些内容需要活动方材料确认？"],
      };
    case "content_adaptation":
      return {
        kind,
        summary: "已给出渠道适配建议；原修订没有被覆盖。",
        sourceRevisionRef: placeholderRef,
        channel: "待选择渠道",
        titleSuggestions: ["突出已核事实，不放大未核观察"],
        structureSuggestions: ["保留来源说明与风险备注"],
        lengthGuidance: "按目标渠道限制压缩重复背景，不删证据边界。",
        citationWarnings: ["改写后逐项核对引用是否仍支持相邻表述"],
      };
    case "course_design":
      return {
        kind,
        summary: "已生成待教师编辑的课程设计检查草稿。",
        draftDiffs: ["核对目标、岗位、节点与交付物是否闭环"],
        missingItems: ["确认每个关键判断对应的行为证据"],
        candidateNodes: ["保留可由学生行动触发的节点"],
        rubricSuggestions: ["高风险维度继续保持教师必审"],
      };
    case "live_intervention":
      return {
        kind,
        summary: "已生成教师可选择的最小干预候选；尚未生效。",
        options: [{
          strategy: "wait",
          reason: "先观察学生是否能依据现有证据自主修订。",
          targetActorIds: [],
        }],
        recommendedOrder: ["等待", "提示卡", "追加材料", "人工接管"],
      };
    case "evaluation_review":
      return {
        kind,
        summary: "已定位评价分歧与复核顺序；未给出最终分。",
        evaluationCaseId: "pending",
        arbitrationId: "pending",
        dimensionDifferences: [],
        evidenceGaps: ["优先检查意见分歧最大的维度是否引用同一固定证据包"],
        reviewOrder: ["先核对证据引用", "再比较逐维理由", "最后由教师形成终评"],
      };
    default:
      return null;
  }
}

function stringListSignal(
  request: AgentRunRequest,
  key: string,
): string[] {
  const raw = request.signals[key];
  if (typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function assistanceCausationEventIds(request: AgentRunRequest): string[] {
  const anchorEventId =
    typeof request.signals.currentTaskAnchorEventId === "string"
      ? request.signals.currentTaskAnchorEventId
      : null;
  return [...new Set([
    request.trigger.sourceId,
    ...(anchorEventId ? [anchorEventId] : []),
  ])];
}

function proposalFor(
  request: AgentRunRequest,
  profile: AssistanceTemplateProfile,
  output: AgentAssistanceOutput,
): AgentAssistanceProposal {
  const subjectActorId = typeof request.signals.subjectActorId === "string"
    ? request.signals.subjectActorId
    : null;
  const resourceRef = (
    profile.plane === "material_production"
    || profile.kind === "evaluation_review"
  )
    ? trustedResourceRef(request, "resource")
    : null;
  const visibility: VisibilityScope[] = profile.plane === "teacher_assistance"
    ? ["teacher_only", "audit_only"]
    : profile.plane === "student_assistance"
      ? ["role_private", "audit_only"]
      : ["assigned_team", "audit_only"];
  return AgentAssistanceProposalSchema.parse({
    ...createMessageMeta({
      sessionId: request.sessionId,
      sceneId: request.sceneId,
      actorId: request.actorId,
      correlationId: request.correlationId,
      timestamp: request.timestamp,
    }),
    kind: "AgentAssistanceProposal",
    assistanceSchemaVersion: "agent-assistance/1.0.0",
    proposalId: `assistance:${request.agentRunId}`,
    agentRunId: request.agentRunId,
    roleId: request.role.roleId,
    templateRef: request.templateRef,
    instanceRef: request.instanceRef,
    outputSchemaRef: profile.outputSchemaRef,
    output,
    subjectActorId,
    resourceRef,
    expectedStateVersion: request.stateVersion,
    causationEventIds: assistanceCausationEventIds(request),
    evidenceRefs: stringListSignal(request, "evidenceRefs"),
    citationRefs: request.contextManifest.includedCitationRefs,
    authority: "advisory_only",
    requiresHumanAction: true,
    visibility,
    visibleToActorIds: subjectActorId ? [subjectActorId] : [],
    idempotencyKey: `${request.taskId}:${profile.templateId}:assistance`,
    expiresAt: null,
  });
}

function profileForRequest(
  request: AgentRunRequest,
): AssistanceTemplateProfile {
  const profile = assistanceProfilesByAgentId.get(request.actorId);
  if (!profile) {
    throw new AgentRuntimeExecutionError(
      "assistance_profile_missing",
      `辅助智能体模板未注册：${request.actorId}`,
    );
  }
  return profile;
}

const forbiddenAssistancePattern =
  /(?:标准答案|已经替你完成|已经发布|最终得分|finalScore|write_world_event)/iu;

export function createAssistanceHandlers(
  model: AssistanceModelPort,
): ReadonlyMap<string, AgentNodeExecutor> {
  const handlers = new Map<string, AgentNodeExecutor>();
  handlers.set("assistance/model", async ({ request }) => {
    const profile = profileForRequest(request);
    const template = assistancePromptTemplates.get(profile.agentId);
    if (!template) {
      throw new AgentRuntimeExecutionError(
        "assistance_prompt_missing",
        `辅助智能体提示词未注册：${profile.agentId}`,
      );
    }
    const prompt = compileAgentPrompt(template, request);
    const output = await model.invoke({
      request,
      profile,
      systemPrompt: prompt.systemPrompt,
      userPrompt: prompt.userPrompt,
    });
    const { modelTrace: _modelTrace, ...structuredOutput } = output;
    return {
      assistanceProposal: proposalFor(
        request,
        profile,
        AgentAssistanceOutputSchema.parse(structuredOutput),
      ),
      signals: {
        assistanceKind: profile.kind,
        promptContextHash: prompt.contextHash,
        promptHash: prompt.promptHash,
      },
      metrics: {
        modelCalls: 1,
        modelInvocations: output.modelTrace ? [output.modelTrace] : [],
        inputTokens: output.modelTrace?.tokenUsage.input
          ?? prompt.estimatedInputTokens,
        outputTokens: output.modelTrace?.tokenUsage.output
          ?? Math.ceil(JSON.stringify(structuredOutput).length / 4),
      },
    };
  });
  handlers.set("assistance/guard", async ({
    request,
    assistanceProposal,
  }) => {
    const profile = profileForRequest(request);
    if (
      !assistanceProposal
      || assistanceProposal.output.kind !== profile.kind
      || assistanceProposal.outputSchemaRef !== profile.outputSchemaRef
    ) {
      throw new AgentRuntimeExecutionError(
        "assistance_output_contract_mismatch",
        "辅助建议没有命中模板声明的独立输出契约",
      );
    }
    if (forbiddenAssistancePattern.test(
      JSON.stringify(assistanceProposal.output),
    )) {
      throw new AgentRuntimeExecutionError(
        "assistance_authority_claim_detected",
        "辅助建议包含标准答案、最终成绩或权威写入声明",
      );
    }
    return { signals: { assistanceGuardPassed: true } };
  });
  handlers.set("assistance/fallback", async ({ request }) => {
    const profile = profileForRequest(request);
    const fallback = deterministicAssistanceModelDraft(
      `assistance.${profile.kind}`,
    );
    if (!fallback) {
      throw new AgentRuntimeExecutionError(
        "assistance_fallback_missing",
        `辅助智能体缺少安全降级：${profile.kind}`,
      );
    }
    const normalized = normalizeAssistanceOutput(
      {
        ...fallback,
        summary: `模型或输出守卫不可用；${fallback.summary}`,
      },
      request,
      profile,
    );
    return {
      assistanceProposal: proposalFor(request, profile, normalized),
      signals: { assistanceFallback: true },
    };
  });
  return handlers;
}
