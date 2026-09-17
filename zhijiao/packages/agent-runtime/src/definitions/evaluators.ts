import {
  AgentDefinitionSchema,
  AgentSubscriptionSchema,
  EvaluationCaseSchema,
  EvaluationDimensionProposalSchema,
  EvaluationDimensionSnapshotSchema,
  EvaluationEvidenceBundleSchema,
  ExecutableAgentIntentSchema,
  createMessageMeta,
  type AgentDefinition,
  type AgentRunRequest,
  type EvaluationDimensionProposal,
  type EvaluationEvaluatorKind,
  type ExecutableAgentIntent,
  type ModelInvocationTrace,
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

const evaluationDefinitionVersion = "evaluation-semantic/1.0.7";
const evaluationPromptVersion = "evaluation-semantic/1.0.2";
const learningDefinitionVersion = "learning-curator/1.0.2";
const learningPromptVersion = "learning-curator/1.0.0";

export const semanticEvaluatorProfiles = [
  {
    agentId: "agent-evidence-assessor",
    evaluatorKind: "evidence_sufficiency",
    label: "证据充分性评价器",
    focus: "判断证据是否存在、相关、充分且能够支持学生结论；证据不足不等于学生做错。",
  },
  {
    agentId: "agent-work-quality-assessor",
    evaluatorKind: "work_quality",
    label: "作品质量评价器",
    focus: "判断成果内容质量、表达完整性、事实边界与渠道适配；不得使用无引用印象分。",
  },
  {
    agentId: "agent-collaboration-assessor",
    evaluatorKind: "professional_collaboration",
    label: "职业协作评价器",
    focus: "判断沟通、交接、风险权衡与责任意识；不得读取或推断证据包之外的私聊。",
  },
] as const satisfies readonly {
  agentId: string;
  evaluatorKind: Exclude<EvaluationEvaluatorKind, "rule">;
  label: string;
  focus: string;
}[];

export type SemanticEvaluatorProfile = (typeof semanticEvaluatorProfiles)[number];

function evaluatorSubscription(profile: SemanticEvaluatorProfile) {
  return AgentSubscriptionSchema.parse({
    subscriptionId: `${profile.agentId}/evaluation-case-opened/v1`,
    agentId: profile.agentId,
    roleId: "assessor",
    definitionVersion: evaluationDefinitionVersion,
    promptVersion: evaluationPromptVersion,
    eventTypes: ["evaluation_case_opened"],
    targetActorIdField: null,
    maxCausalDepth: 6,
    priority: 70,
    enabled: true,
  });
}

export const semanticEvaluatorSubscriptions = semanticEvaluatorProfiles.map(
  evaluatorSubscription,
);

function evaluatorRetrySubscription(profile: SemanticEvaluatorProfile) {
  return AgentSubscriptionSchema.parse({
    subscriptionId: `${profile.agentId}/evaluation-branch-retry/v1`,
    agentId: profile.agentId,
    roleId: "assessor",
    definitionVersion: evaluationDefinitionVersion,
    promptVersion: evaluationPromptVersion,
    eventTypes: ["evaluation_branch_retry_requested"],
    targetActorIdField: "payload.targetAgentId",
    maxCausalDepth: 6,
    priority: 75,
    enabled: true,
  });
}

export const semanticEvaluatorRetrySubscriptions =
  semanticEvaluatorProfiles.map(evaluatorRetrySubscription);

export const learningCuratorSubscription = AgentSubscriptionSchema.parse({
  subscriptionId: "learning-curator/teacher-reviewed/v1",
  agentId: "agent-learning",
  roleId: "learning_curator",
  definitionVersion: learningDefinitionVersion,
  promptVersion: learningPromptVersion,
  eventTypes: [
    "teacher_reviewed",
    "learning_candidate_generation_retry_requested",
  ],
  targetActorIdField: null,
  maxCausalDepth: 6,
  priority: 60,
  enabled: true,
});

function evaluationPrompt(profile: SemanticEvaluatorProfile): AgentPromptTemplate {
  return {
    templateId: `${profile.agentId}/semantic-evaluation`,
    version: evaluationPromptVersion,
    system: `你是地方文旅融媒体实训的${profile.label}。你是只读评价节点，不能参与剧情、修改证据、形成最终成绩或发布学习内容。`,
    instructions: [
      profile.focus,
      "必须逐一覆盖服务器给出的全部量规维度，不能增删维度或改变 maxScore。",
      "每个分项理由必须引用本次 allowedEvidenceRefs 白名单中的一个或多个 evidenceId。",
      "区分证据不存在、证据存在但质量不足、学生行为错误；不要补写事实。",
      "只使用当前 EvidenceBundle 和授权上下文，不推断个人身份、私聊或教师内部说明。",
    ],
    outputContract: [
      "只返回一个 JSON 对象，不要 Markdown、代码围栏、前后缀或隐藏推理。",
      "字段固定为 dimensions。",
      "dimensions 每项字段固定为 dimensionId、scoreSuggestion、maxScore、reason、evidenceRefs、confidence、riskFlags。",
      "dimensionId 与 maxScore 必须逐项原样复制 evaluationCase.dimensions；不得改写标签、合并维度或换算成百分制。",
      "scoreSuggestion 必须在 0 与 maxScore 之间；confidence 必须在 0 到 1。",
      "evidenceRefs 只能逐字引用 allowedEvidenceRefs，且不得为空。",
      "riskFlags 是字符串数组；无风险时返回空数组。",
      "reason 只写可核验结论与关键依据，控制在 120 个汉字以内，避免复述上下文。",
    ].join("\n"),
  };
}

export const learningCuratorPromptTemplate: AgentPromptTemplate = {
  templateId: "learning-curator/assessment-example",
  version: learningPromptVersion,
  system: "你是地方文旅融媒体实训的学习候选策展智能体。你只能提出待审核的 assessment_example 候选，不能发布、批准、回滚或修改正式知识。",
  instructions: [
    "只基于教师公开反馈、逐维终评和本次授权证据引用提炼候选。",
    "不得使用教师 internalNote、reviewedBy、提供方请求 ID、提示词原文、密钥或个人敏感信息。",
    "sourceEvidenceRefs 只能逐字引用服务器给出的 allowedEvidenceRefs，且不得为空。",
    "候选要明确适用范围、预期收益、已知风险和冲突引用；不得把单次样例概括为普遍规则。",
  ],
  outputContract: [
    "只返回一个 JSON 对象，不要 Markdown、代码围栏、前后缀或隐藏推理。",
    "字段固定为 title、proposedContent、sourceEvidenceRefs、expectedBenefit、knownRisks、conflictRefs。",
    "proposedContent 必须是 JSON 对象，内容仅代表 pending_review 候选。",
    "knownRisks、conflictRefs 是字符串数组。",
  ].join("\n"),
};

function evaluatorDefinition(profile: SemanticEvaluatorProfile): AgentDefinition {
  const prompt = evaluationPrompt(profile);
  return AgentDefinitionSchema.parse({
    agentId: profile.agentId,
    roleId: "assessor",
    definitionVersion: evaluationDefinitionVersion,
    promptVersion: evaluationPromptVersion,
    entryNodeId: "case-router",
    allowedTriggers: [
      "evaluation_case_opened",
      "evaluation_branch_retry_requested",
    ],
    allowedIntents: ["record_evaluation_proposal"],
    maxSteps: 5,
    maxToolCalls: 0,
    timeoutMs: 60_000,
    nodes: [
      { nodeId: "case-router", kind: "router", label: "固定评价案件与证据白名单", executorKey: null, promptTemplateId: null, toolName: null },
      { nodeId: "semantic-model", kind: "model", label: profile.label, executorKey: "evaluation/semantic-model", promptTemplateId: prompt.templateId, toolName: null },
      { nodeId: "proposal-guard", kind: "guard", label: "逐维 Schema 与证据引用守卫", executorKey: "evaluation/proposal-guard", promptTemplateId: null, toolName: null },
      { nodeId: "unavailable", kind: "rule", label: "模型不可用显式降级", executorKey: "evaluation/unavailable", promptTemplateId: null, toolName: null },
      { nodeId: "done", kind: "terminal", label: "返回只读评价意见", executorKey: null, promptTemplateId: null, toolName: null },
    ],
    edges: [
      { edgeId: "case-to-model", from: "case-router", to: "semantic-model", priority: 0, condition: { kind: "always" } },
      { edgeId: "model-to-guard", from: "semantic-model", to: "proposal-guard", priority: 100, condition: { kind: "last_status_equals", value: "success" } },
      { edgeId: "model-to-unavailable", from: "semantic-model", to: "unavailable", priority: 0, condition: { kind: "always" } },
      { edgeId: "guard-to-done", from: "proposal-guard", to: "done", priority: 100, condition: { kind: "last_status_equals", value: "success" } },
      { edgeId: "guard-to-unavailable", from: "proposal-guard", to: "unavailable", priority: 0, condition: { kind: "always" } },
      { edgeId: "unavailable-to-done", from: "unavailable", to: "done", priority: 0, condition: { kind: "always" } },
    ],
  });
}

export const semanticEvaluatorDefinitions: ReadonlyMap<string, AgentDefinition> = new Map(
  semanticEvaluatorProfiles.map((profile) => [
    profile.agentId,
    evaluatorDefinition(profile),
  ]),
);

export const learningCuratorAgentDefinition = AgentDefinitionSchema.parse({
  agentId: "agent-learning",
  roleId: "learning_curator",
  definitionVersion: learningDefinitionVersion,
  promptVersion: learningPromptVersion,
  entryNodeId: "review-router",
  allowedTriggers: [
    "teacher_reviewed",
    "learning_candidate_generation_retry_requested",
  ],
  allowedIntents: ["propose_learning_candidate"],
  maxSteps: 5,
  maxToolCalls: 0,
  timeoutMs: 60_000,
  nodes: [
    { nodeId: "review-router", kind: "router", label: "固定公开终评与授权证据", executorKey: null, promptTemplateId: null, toolName: null },
    { nodeId: "candidate-model", kind: "model", label: "提炼待审核评价样例", executorKey: "learning-curator/model", promptTemplateId: learningCuratorPromptTemplate.templateId, toolName: null },
    { nodeId: "candidate-guard", kind: "guard", label: "隐私、引用和候选类型守卫", executorKey: "learning-curator/guard", promptTemplateId: null, toolName: null },
    { nodeId: "unavailable", kind: "rule", label: "模型不可用显式记录", executorKey: "learning-curator/unavailable", promptTemplateId: null, toolName: null },
    { nodeId: "done", kind: "terminal", label: "返回待审核学习候选意图", executorKey: null, promptTemplateId: null, toolName: null },
  ],
  edges: [
    { edgeId: "review-to-model", from: "review-router", to: "candidate-model", priority: 0, condition: { kind: "always" } },
    { edgeId: "model-to-guard", from: "candidate-model", to: "candidate-guard", priority: 100, condition: { kind: "last_status_equals", value: "success" } },
    { edgeId: "model-to-unavailable", from: "candidate-model", to: "unavailable", priority: 0, condition: { kind: "always" } },
    { edgeId: "guard-to-done", from: "candidate-guard", to: "done", priority: 100, condition: { kind: "last_status_equals", value: "success" } },
    { edgeId: "guard-to-unavailable", from: "candidate-guard", to: "unavailable", priority: 0, condition: { kind: "always" } },
    { edgeId: "unavailable-to-done", from: "unavailable", to: "done", priority: 0, condition: { kind: "always" } },
  ],
});

const SemanticEvaluationModelOutputSchema = z.object({
  dimensions: z.array(EvaluationDimensionProposalSchema).min(1),
}).strict();

const EchoedEvaluationMetadataSchema = EvaluationDimensionSnapshotSchema.pick({
  label: true,
  weight: true,
  rule: true,
  evaluationKind: true,
}).partial();

const SemanticEvaluationModelWireOutputSchema = z.object({
  dimensions: z.array(EvaluationDimensionProposalSchema.extend(
    EchoedEvaluationMetadataSchema.shape,
  ).strict()).min(1),
}).strict();

export type SemanticEvaluationModelOutput = z.infer<
  typeof SemanticEvaluationModelOutputSchema
> & { modelTrace?: ModelInvocationTrace };

const LearningCandidateModelOutputSchema = z.object({
  title: z.string().min(1).max(500),
  proposedContent: z.record(z.string(), z.unknown()),
  sourceEvidenceRefs: z.array(z.string().min(1)).min(1),
  expectedBenefit: z.string().min(1).max(1_200),
  knownRisks: z.array(z.string().min(1)),
  conflictRefs: z.array(z.string().min(1)),
}).strict();

export type LearningCandidateModelOutput = z.infer<
  typeof LearningCandidateModelOutputSchema
> & { modelTrace?: ModelInvocationTrace };

export const LearningCuratorInputSchema = z.object({
  reviewId: z.string().min(1),
  evaluationCaseId: z.string().min(1),
  finalScore: z.number().min(0).max(100),
  publicSummary: z.string().min(1).max(1_500),
  dimensions: z.array(z.object({
    dimensionId: z.string().min(1),
    finalScore: z.number().min(0).max(100),
    maxScore: z.number().positive().max(100),
    publicFeedback: z.string().min(1).max(1_200),
    evidenceRefs: z.array(z.string().min(1)),
  }).strict()).min(1),
  finalHash: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();

export type LearningCuratorInput = z.infer<typeof LearningCuratorInputSchema>;

export interface SemanticEvaluationModelPort {
  invoke(input: {
    request: AgentRunRequest;
    evaluatorKind: Exclude<EvaluationEvaluatorKind, "rule">;
    systemPrompt: string;
    userPrompt: string;
  }): Promise<SemanticEvaluationModelOutput>;
}

export interface LearningCuratorModelPort {
  invoke(input: {
    request: AgentRunRequest;
    systemPrompt: string;
    userPrompt: string;
  }): Promise<LearningCandidateModelOutput>;
}

function stringSignal(request: AgentRunRequest, key: string, fallback = ""): string {
  const value = request.signals[key];
  return typeof value === "string" ? value : fallback;
}

function jsonSignal<T>(
  request: AgentRunRequest,
  key: string,
  schema: z.ZodType<T>,
): T {
  const raw = stringSignal(request, key);
  try {
    return schema.parse(JSON.parse(raw));
  } catch {
    throw new AgentRuntimeExecutionError(
      `signal_invalid:${key}`,
      `智能体任务缺少有效的 ${key} 固定输入`,
    );
  }
}

function allowedEvidenceRefs(request: AgentRunRequest): string[] {
  return stringSignal(request, "allowedEvidenceRefs")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function lastNodeErrorCode(
  signals: Readonly<Record<string, unknown>>,
  fallback: string,
): string {
  const value = signals.lastNodeErrorCode;
  return typeof value === "string" && value.trim().length > 0
    ? value.trim().slice(0, 240)
    : fallback;
}

function evaluatorKind(
  request: AgentRunRequest,
): Exclude<EvaluationEvaluatorKind, "rule"> {
  const value = stringSignal(request, "evaluatorKind");
  if (
    value !== "evidence_sufficiency"
    && value !== "work_quality"
    && value !== "professional_collaboration"
  ) {
    throw new AgentRuntimeExecutionError(
      "evaluator_kind_invalid",
      "评价任务缺少受支持的语义评价器类型",
    );
  }
  return value;
}

function evaluationIntent(input: {
  request: AgentRunRequest;
  status: "completed" | "unavailable";
  dimensions: EvaluationDimensionProposal[];
  errorCode: string | null;
}): ExecutableAgentIntent {
  const evidenceRefs = [...new Set(
    input.dimensions.flatMap((dimension) => dimension.evidenceRefs),
  )].sort();
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
    intentType: "record_evaluation_proposal",
    rationaleSummary: input.status === "completed"
      ? `${evaluatorKind(input.request)} 已形成逐维只读评价建议，等待确定性仲裁与教师终评。`
      : `${evaluatorKind(input.request)} 当前不可用，未伪造分数，转入降级仲裁。`,
    proposedPayload: {
      evaluatorKind: evaluatorKind(input.request),
      status: input.status,
      dimensions: input.dimensions,
      errorCode: input.errorCode,
    },
    expectedStateVersion: input.request.stateVersion,
    causationEventIds: [input.request.trigger.sourceId],
    evidenceRefs,
    citationRefs: evidenceRefs,
    toolResultRefs: [],
    confidence: input.status === "completed"
      ? input.dimensions.reduce((sum, item) => sum + item.confidence, 0)
        / input.dimensions.length
      : 0,
    riskLevel: "low",
    requiresTeacherReview: true,
    visibility: ["teacher_only", "audit_only"],
    visibleToActorIds: [],
    idempotencyKey: `${input.request.sessionId}:${input.request.trigger.sourceId}:${input.request.actorId}:evaluation-proposal`,
    expiresAt: null,
  });
}

function learningIntent(input: {
  request: AgentRunRequest;
  status: "completed" | "unavailable";
  candidate?: z.infer<typeof LearningCandidateModelOutputSchema>;
  errorCode: string | null;
}): ExecutableAgentIntent {
  const evidenceRefs = input.candidate?.sourceEvidenceRefs ?? [];
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
    intentType: "propose_learning_candidate",
    rationaleSummary: input.status === "completed"
      ? "已从公开终评与授权证据中提炼待审核评价样例，不会自动发布。"
      : "学习策展模型当前不可用，未生成或伪造候选。",
    proposedPayload: {
      status: input.status,
      candidateType: "assessment_example",
      ...(input.candidate ?? {}),
      errorCode: input.errorCode,
    },
    expectedStateVersion: input.request.stateVersion,
    causationEventIds: [input.request.trigger.sourceId],
    evidenceRefs,
    citationRefs: evidenceRefs,
    toolResultRefs: [],
    confidence: input.status === "completed" ? 0.8 : 0,
    riskLevel: "low",
    requiresTeacherReview: true,
    visibility: ["teacher_only", "audit_only"],
    visibleToActorIds: [],
    idempotencyKey: `${input.request.sessionId}:${input.request.trigger.sourceId}:${input.request.actorId}:learning-candidate`,
    expiresAt: null,
  });
}

function invocationMetrics(trace: ModelInvocationTrace) {
  return {
    modelCalls: 1,
    modelInvocations: [trace],
    inputTokens: trace.tokenUsage.input ?? 0,
    outputTokens: trace.tokenUsage.output ?? 0,
  };
}

function schemaIssueCode(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "root:unknown";
  const path = issue.path.length > 0
    ? issue.path.map(String).join(".")
    : "root";
  if (issue.code === "unrecognized_keys") {
    return `${path}:${issue.code}:${[...issue.keys].sort().join(",")}`;
  }
  return `${path}:${issue.code}`;
}

function projectEchoedEvaluationMetadata(input: {
  request: AgentRunRequest;
  output: z.infer<typeof SemanticEvaluationModelWireOutputSchema>;
  trace: ModelInvocationTrace;
}): z.infer<typeof SemanticEvaluationModelOutputSchema> {
  const rawCase = input.request.signals.evaluationCase;
  let parsedCase: ReturnType<typeof EvaluationCaseSchema.safeParse> | null = null;
  if (typeof rawCase === "string") {
    try {
      parsedCase = EvaluationCaseSchema.safeParse(JSON.parse(rawCase));
    } catch {
      parsedCase = null;
    }
  }
  const dimensions = parsedCase?.success
    ? parsedCase.data.dimensions
    : [];
  const byId = new Map(
    dimensions.map((dimension) => [dimension.dimensionId, dimension]),
  );
  const byUniqueLabel = new Map(
    dimensions
      .filter((dimension, index, candidates) => (
        candidates.findIndex((item) => item.label === dimension.label) === index
        && candidates.filter((item) => item.label === dimension.label).length === 1
      ))
      .map((dimension) => [dimension.label, dimension]),
  );

  return {
    dimensions: input.output.dimensions.map((dimension, index) => {
      const {
        label: echoedLabel,
        weight: echoedWeight,
        rule: echoedRule,
        evaluationKind: echoedEvaluationKind,
        ...proposal
      } = dimension;
      if (
        echoedLabel === undefined
        && echoedWeight === undefined
        && echoedRule === undefined
        && echoedEvaluationKind === undefined
      ) {
        return proposal;
      }
      const canonical = byId.get(dimension.dimensionId)
        ?? byUniqueLabel.get(dimension.dimensionId);
      const invalidField = !canonical
        ? "dimensionId"
        : echoedLabel !== undefined && echoedLabel !== canonical.label
          ? "label"
          : echoedWeight !== undefined && echoedWeight !== canonical.weight
            ? "weight"
            : echoedRule !== undefined && echoedRule !== canonical.rule
              ? "rule"
              : echoedEvaluationKind !== undefined
                  && echoedEvaluationKind !== canonical.evaluationKind
                ? "evaluationKind"
                : null;
      if (invalidField !== null) {
        throw new AgentRuntimeExecutionError(
          `evaluation_echoed_dimension_metadata_invalid:dimensions.${index}.${invalidField}`,
          "模型回显的量规元数据与服务器冻结案件不一致",
          invocationMetrics(input.trace),
        );
      }
      return {
        ...proposal,
        riskFlags: [...new Set([
          ...proposal.riskFlags,
          "server_removed_echoed_dimension_metadata",
        ])].sort(),
      };
    }),
  };
}

function canonicalizeEvaluationModelOutput(
  request: AgentRunRequest,
  output: z.infer<typeof SemanticEvaluationModelOutputSchema>,
): z.infer<typeof SemanticEvaluationModelOutputSchema> {
  const rawCase = request.signals.evaluationCase;
  if (typeof rawCase !== "string") return output;
  let decoded: unknown;
  try {
    decoded = JSON.parse(rawCase);
  } catch {
    return output;
  }
  const parsedCase = EvaluationCaseSchema.safeParse(decoded);
  if (!parsedCase.success) return output;
  const byId = new Map(
    parsedCase.data.dimensions.map((dimension) => [
      dimension.dimensionId,
      dimension,
    ]),
  );
  const byUniqueLabel = new Map(
    parsedCase.data.dimensions
      .filter((dimension, index, dimensions) => (
        dimensions.findIndex((item) => item.label === dimension.label) === index
        && dimensions.filter((item) => item.label === dimension.label).length === 1
      ))
      .map((dimension) => [dimension.label, dimension]),
  );
  const allowedEvidenceIds = new Set(allowedEvidenceRefs(request));
  return {
    dimensions: output.dimensions.map((dimension) => {
      const exact = byId.get(dimension.dimensionId);
      const canonical = exact
        ?? byUniqueLabel.get(dimension.dimensionId);
      if (!canonical) return dimension;
      const riskFlags = new Set(dimension.riskFlags);
      if (!exact) riskFlags.add("server_normalized_dimension_label");
      const evidenceRefs = dimension.evidenceRefs.map((reference) => {
        const trimmed = reference.trim();
        if (allowedEvidenceIds.has(trimmed)) {
          if (trimmed !== reference) {
            riskFlags.add("server_normalized_evidence_ref");
          }
          return trimmed;
        }
        if (trimmed.startsWith("evidence:")) {
          const unprefixed = trimmed.slice("evidence:".length);
          if (allowedEvidenceIds.has(unprefixed)) {
            riskFlags.add("server_normalized_evidence_ref");
            return unprefixed;
          }
        }
        return reference;
      });
      let scoreSuggestion = dimension.scoreSuggestion;
      if (dimension.maxScore !== canonical.maxScore) {
        scoreSuggestion = Math.round(
          (dimension.scoreSuggestion / dimension.maxScore)
          * canonical.maxScore
          * 100,
        ) / 100;
        riskFlags.add("server_normalized_score_scale");
      } else if (
        dimension.scoreSuggestion > canonical.maxScore
        && dimension.scoreSuggestion <= 100
      ) {
        scoreSuggestion = Math.round(
          (dimension.scoreSuggestion / 100)
          * canonical.maxScore
          * 100,
        ) / 100;
        riskFlags.add("server_normalized_percent_score");
      }
      return {
        ...dimension,
        dimensionId: canonical.dimensionId,
        scoreSuggestion,
        maxScore: canonical.maxScore,
        evidenceRefs,
        riskFlags: [...riskFlags].sort(),
      };
    }),
  };
}

export class GatewaySemanticEvaluationModel
implements SemanticEvaluationModelPort {
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
    evaluatorKind: Exclude<EvaluationEvaluatorKind, "rule">;
    systemPrompt: string;
    userPrompt: string;
  }): Promise<SemanticEvaluationModelOutput> {
    try {
      const result = await this.#provider.invoke({
        invocationId: `${input.request.agentRunId}:${input.evaluatorKind}`,
        profileId: this.#profileId,
        taskKind: `evaluation.${input.evaluatorKind}`,
        systemPrompt: input.systemPrompt,
        userPrompt: input.userPrompt,
        outputContractId: `evaluation-${input.evaluatorKind}/v1`,
        outputMode: "json_object",
        temperature: 0.1,
        maxOutputTokens: 3_200,
        timeoutMs: this.#timeoutMs,
      });
      const parsed = SemanticEvaluationModelWireOutputSchema.safeParse(result.output);
      if (!parsed.success) {
        throw new AgentRuntimeExecutionError(
          `model_output_schema_invalid:evaluation_${input.evaluatorKind}:${schemaIssueCode(parsed.error)}`,
          "语义评价模型输出未通过逐维 Schema",
          invocationMetrics(result.trace),
        );
      }
      const projected = projectEchoedEvaluationMetadata({
        request: input.request,
        output: parsed.data,
        trace: result.trace,
      });
      return {
        ...canonicalizeEvaluationModelOutput(input.request, projected),
        modelTrace: result.trace,
      };
    } catch (error) {
      if (error instanceof AgentRuntimeExecutionError) throw error;
      if (error instanceof ModelInvocationError) {
        throw new AgentRuntimeExecutionError(
          error.code,
          "语义评价模型提供方调用失败",
          invocationMetrics(error.trace),
        );
      }
      throw error;
    }
  }
}

export class GatewayLearningCuratorModel implements LearningCuratorModelPort {
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
  }): Promise<LearningCandidateModelOutput> {
    try {
      const result = await this.#provider.invoke({
        invocationId: `${input.request.agentRunId}:learning-candidate`,
        profileId: this.#profileId,
        taskKind: "learning.assessment_example",
        systemPrompt: input.systemPrompt,
        userPrompt: input.userPrompt,
        outputContractId: "learning-assessment-example/v1",
        outputMode: "json_object",
        temperature: 0.2,
        maxOutputTokens: 2_400,
        timeoutMs: this.#timeoutMs,
      });
      const parsed = LearningCandidateModelOutputSchema.safeParse(result.output);
      if (!parsed.success) {
        throw new AgentRuntimeExecutionError(
          `model_output_schema_invalid:learning_candidate:${schemaIssueCode(parsed.error)}`,
          "学习策展模型输出未通过候选 Schema",
          invocationMetrics(result.trace),
        );
      }
      return { ...parsed.data, modelTrace: result.trace };
    } catch (error) {
      if (error instanceof AgentRuntimeExecutionError) throw error;
      if (error instanceof ModelInvocationError) {
        throw new AgentRuntimeExecutionError(
          error.code,
          "学习策展模型提供方调用失败",
          invocationMetrics(error.trace),
        );
      }
      throw error;
    }
  }
}

export class DeterministicSemanticEvaluationModel
implements SemanticEvaluationModelPort {
  async invoke(input: {
    request: AgentRunRequest;
    evaluatorKind: Exclude<EvaluationEvaluatorKind, "rule">;
    systemPrompt: string;
    userPrompt: string;
  }): Promise<SemanticEvaluationModelOutput> {
    const evaluationCase = jsonSignal(
      input.request,
      "evaluationCase",
      EvaluationCaseSchema,
    );
    const evidenceRef = allowedEvidenceRefs(input.request)[0];
    if (!evidenceRef) {
      throw new AgentRuntimeExecutionError(
        "evaluation_evidence_missing",
        "固定评价证据包为空",
      );
    }
    const ratio = {
      evidence_sufficiency: 0.9,
      work_quality: 0.86,
      professional_collaboration: 0.88,
    }[input.evaluatorKind];
    return {
      dimensions: evaluationCase.dimensions.map((dimension) => ({
        dimensionId: dimension.dimensionId,
        scoreSuggestion: Math.round(dimension.maxScore * ratio * 100) / 100,
        maxScore: dimension.maxScore,
        reason: `${input.evaluatorKind} Mock 基线仅依据固定 EvidenceBundle 给出可追溯建议。`,
        evidenceRefs: [evidenceRef],
        confidence: 0.8,
        riskFlags: [],
      })),
    };
  }
}

export class DeterministicLearningCuratorModel
implements LearningCuratorModelPort {
  async invoke(input: {
    request: AgentRunRequest;
    systemPrompt: string;
    userPrompt: string;
  }): Promise<LearningCandidateModelOutput> {
    const review = jsonSignal(
      input.request,
      "teacherReview",
      LearningCuratorInputSchema,
    );
    const evidenceRefs = allowedEvidenceRefs(input.request);
    if (evidenceRefs.length === 0) {
      throw new AgentRuntimeExecutionError(
        "learning_evidence_missing",
        "终评没有可用于学习候选的授权证据",
      );
    }
    return {
      title: "责任编辑岗位终评证据样例",
      proposedContent: {
        kind: "assessment_example",
        evaluationCaseId: review.evaluationCaseId,
        finalScore: review.finalScore,
        summary: review.publicSummary,
      },
      sourceEvidenceRefs: evidenceRefs,
      expectedBenefit: "为后续同量规终评提供经人工审核、可离线回放的证据样例。",
      knownRisks: ["单次会话样例不能直接推广为通用评分规则"],
      conflictRefs: [],
    };
  }
}

function assertEvaluationOutput(
  request: AgentRunRequest,
  dimensions: readonly EvaluationDimensionProposal[],
): void {
  const evaluationCase = jsonSignal(request, "evaluationCase", EvaluationCaseSchema);
  const allowed = new Set(allowedEvidenceRefs(request));
  if (dimensions.length !== evaluationCase.dimensions.length) {
    throw new AgentRuntimeExecutionError(
      "evaluation_dimension_coverage_invalid",
      "语义评价没有逐一覆盖固定量规维度",
    );
  }
  const expected = new Map(
    evaluationCase.dimensions.map((dimension) => [dimension.dimensionId, dimension]),
  );
  if (new Set(dimensions.map((dimension) => dimension.dimensionId)).size !== dimensions.length) {
    throw new AgentRuntimeExecutionError(
      "evaluation_dimension_duplicate",
      "语义评价包含重复维度",
    );
  }
  for (const dimension of dimensions) {
    const snapshot = expected.get(dimension.dimensionId);
    if (
      !snapshot
      || dimension.maxScore !== snapshot.maxScore
      || dimension.scoreSuggestion > snapshot.maxScore
    ) {
      throw new AgentRuntimeExecutionError(
        "evaluation_dimension_invalid",
        `语义评价维度或分数上限非法：${dimension.dimensionId}`,
      );
    }
    if (
      dimension.evidenceRefs.length === 0
      || dimension.evidenceRefs.some((reference) => !allowed.has(reference))
    ) {
      throw new AgentRuntimeExecutionError(
        "evaluation_evidence_ref_invalid",
        `语义评价引用了 EvidenceBundle 白名单之外的证据：${dimension.dimensionId}`,
      );
    }
  }
}

const privateCandidatePattern =
  /(?:sk-[a-z0-9_-]{8,}|api[_ -]?key|internalnote|reviewedby|providerrequestid|systemprompt|userprompt|modelrequestid)/iu;

function assertLearningOutput(
  request: AgentRunRequest,
  candidate: z.infer<typeof LearningCandidateModelOutputSchema>,
): void {
  const allowed = new Set(allowedEvidenceRefs(request));
  if (
    candidate.sourceEvidenceRefs.length === 0
    || candidate.sourceEvidenceRefs.some((reference) => !allowed.has(reference))
  ) {
    throw new AgentRuntimeExecutionError(
      "learning_evidence_ref_invalid",
      "学习候选引用了终评授权范围之外的证据",
    );
  }
  if (privateCandidatePattern.test(JSON.stringify(candidate))) {
    throw new AgentRuntimeExecutionError(
      "learning_private_content_detected",
      "学习候选包含禁止沉淀的私有或提供方字段",
    );
  }
}

export function createSemanticEvaluatorHandlers(
  models: ReadonlyMap<
    Exclude<EvaluationEvaluatorKind, "rule">,
    SemanticEvaluationModelPort
  >,
): ReadonlyMap<string, AgentNodeExecutor> {
  const handlers = new Map<string, AgentNodeExecutor>();
  handlers.set("evaluation/semantic-model", async ({ request }) => {
    const kind = evaluatorKind(request);
    const model = models.get(kind);
    if (!model) {
      throw new AgentRuntimeExecutionError(
        "evaluation_model_missing",
        `没有注册语义评价模型：${kind}`,
      );
    }
    const profile = semanticEvaluatorProfiles.find(
      (candidate) => candidate.evaluatorKind === kind,
    );
    if (!profile) {
      throw new AgentRuntimeExecutionError(
        "evaluator_profile_missing",
        `没有注册语义评价器定义：${kind}`,
      );
    }
    const prompt = compileAgentPrompt(evaluationPrompt(profile), request);
    const output = await model.invoke({
      request,
      evaluatorKind: kind,
      systemPrompt: prompt.systemPrompt,
      userPrompt: prompt.userPrompt,
    });
    const intent = evaluationIntent({
      request,
      status: "completed",
      dimensions: output.dimensions,
      errorCode: null,
    });
    return {
      intent,
      signals: {
        promptContextHash: prompt.contextHash,
        promptHash: prompt.promptHash,
        evaluationStatus: "completed",
      },
      metrics: {
        modelCalls: 1,
        modelInvocations: output.modelTrace ? [output.modelTrace] : [],
        inputTokens: output.modelTrace?.tokenUsage.input ?? prompt.estimatedInputTokens,
        outputTokens: output.modelTrace?.tokenUsage.output
          ?? Math.ceil(JSON.stringify(output).length / 4),
      },
    };
  });
  handlers.set("evaluation/proposal-guard", async ({ request, intent }) => {
    if (!intent || intent.intentType !== "record_evaluation_proposal") {
      throw new AgentRuntimeExecutionError(
        "evaluation_intent_missing",
        "语义评价没有形成结构化评价意见",
      );
    }
    const dimensions = z.array(EvaluationDimensionProposalSchema).parse(
      intent.proposedPayload.dimensions,
    );
    assertEvaluationOutput(request, dimensions);
    return { signals: { evaluationGuardPassed: true } };
  });
  handlers.set("evaluation/unavailable", async ({ request, signals }) => ({
    intent: evaluationIntent({
      request,
      status: "unavailable",
      dimensions: [],
      errorCode: lastNodeErrorCode(
        signals,
        "evaluation_model_unavailable",
      ),
    }),
    signals: { evaluationStatus: "unavailable" },
  }));
  return handlers;
}

export function createLearningCuratorHandlers(
  model: LearningCuratorModelPort,
): ReadonlyMap<string, AgentNodeExecutor> {
  const handlers = new Map<string, AgentNodeExecutor>();
  handlers.set("learning-curator/model", async ({ request }) => {
    const prompt = compileAgentPrompt(learningCuratorPromptTemplate, request);
    const output = await model.invoke({
      request,
      systemPrompt: prompt.systemPrompt,
      userPrompt: prompt.userPrompt,
    });
    const { modelTrace: _modelTrace, ...candidate } = output;
    return {
      intent: learningIntent({
        request,
        status: "completed",
        candidate,
        errorCode: null,
      }),
      signals: {
        promptContextHash: prompt.contextHash,
        promptHash: prompt.promptHash,
        learningStatus: "completed",
      },
      metrics: {
        modelCalls: 1,
        modelInvocations: output.modelTrace ? [output.modelTrace] : [],
        inputTokens: output.modelTrace?.tokenUsage.input ?? prompt.estimatedInputTokens,
        outputTokens: output.modelTrace?.tokenUsage.output
          ?? Math.ceil(JSON.stringify(output).length / 4),
      },
    };
  });
  handlers.set("learning-curator/guard", async ({ request, intent }) => {
    if (!intent || intent.intentType !== "propose_learning_candidate") {
      throw new AgentRuntimeExecutionError(
        "learning_intent_missing",
        "学习策展没有形成结构化候选意图",
      );
    }
    const {
      status: _status,
      candidateType: _candidateType,
      errorCode: _errorCode,
      ...rawCandidate
    } = intent.proposedPayload;
    const candidate = LearningCandidateModelOutputSchema.parse(rawCandidate);
    assertLearningOutput(request, candidate);
    return { signals: { learningGuardPassed: true } };
  });
  handlers.set("learning-curator/unavailable", async ({ request, signals }) => ({
    intent: learningIntent({
      request,
      status: "unavailable",
      errorCode: lastNodeErrorCode(
        signals,
        "learning_model_unavailable",
      ),
    }),
    signals: { learningStatus: "unavailable" },
  }));
  return handlers;
}
