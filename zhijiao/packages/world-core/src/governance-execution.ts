import {
  GovernanceExecutionTraceSchema,
  type GovernanceDomain,
  type GovernanceExecutionTrace,
  type GovernanceModelDecision,
  type GovernanceRecommendation,
  type GovernanceRuleEvaluation,
  type MediaProcessingTask,
  type RagChunk,
  type WorldFact,
} from "@ronggang/contracts";
import {
  authorizeResource,
  createAccessSubject,
  hashContent,
  hashValue,
} from "@ronggang/context-engine";
import type { WorldState } from "./types.js";

type GovernanceStep = MediaProcessingTask["steps"][number];

type GovernanceRuleKind =
  | "provider_signal"
  | "fact_source_boundary"
  | "copyright_scope"
  | "knowledge_integrity";

interface GovernancePromptDefinition {
  definitionVersion: string;
  promptVersion: string;
  domain: GovernanceDomain;
  systemPrompt: string;
  taskInstruction: string;
}

interface GovernanceRuleSpec {
  ruleId: string;
  kind: GovernanceRuleKind;
  description: string;
}

interface GovernanceRuleset {
  rulesetId: string;
  domain: GovernanceDomain;
  rules: readonly GovernanceRuleSpec[];
}

const promptDefinitions: Record<string, GovernancePromptDefinition> = {
  "governance-fact/1.0.1": {
    definitionVersion: "governance-specialist/1.0.1",
    promptVersion: "governance-fact/1.0.1",
    domain: "fact",
    systemPrompt: "你是后台事实一致性治理节点。只依据固定材料、经授权知识和当前可见世界事实判断；不得把推断写成事实，不得修改世界状态。",
    taskInstruction: "核对材料的来源充分性、时间版本、数字口径和可证实边界。未知时必须给出 review，明确冲突时给出 revise 或 block。",
  },
  "governance-copyright/1.0.1": {
    definitionVersion: "governance-specialist/1.0.1",
    promptVersion: "governance-copyright/1.0.1",
    domain: "copyright",
    systemPrompt: "你是后台版权范围治理节点。只判断授权主体、用途、渠道、期限、地域和权利争议；不得代替权利人补造授权。",
    taskInstruction: "将材料版权状态与固定规则逐项对照。授权范围不完整时至少给出 revise，存在明确争议时给出 block。",
  },
  "governance-content-safety/1.0.1": {
    definitionVersion: "governance-specialist/1.0.1",
    promptVersion: "governance-content-safety/1.0.1",
    domain: "content_safety",
    systemPrompt: "你是后台内容安全治理节点。只识别违法违规、暴恐色情、隐私泄露、歧视伤害和其他发布安全风险；不得因工具不可用推定安全。",
    taskInstruction: "结合内容审核工具输出给出保守结论。任何不可用或无法判定的情况都必须进入人工复核，不得写成 allow。",
  },
  "governance-platform/1.0.1": {
    definitionVersion: "governance-specialist/1.0.1",
    promptVersion: "governance-platform/1.0.1",
    domain: "platform_rule",
    systemPrompt: "你是后台平台规则治理节点。只判断目标渠道格式、标签、人工复核触发条件和发布红线；不得声称平台已完成未发生的审核。",
    taskInstruction: "依据固定平台治理知识检查材料。触发人工复核时给出 review 或 revise，并明确需要保留的版本与回执。",
  },
};

const rulesets: Record<string, GovernanceRuleset> = {
  "source-consistency/2026.1": {
    rulesetId: "source-consistency/2026.1",
    domain: "fact",
    rules: [
      {
        ruleId: "fact.provider-signal-required",
        kind: "provider_signal",
        description: "工具或模型输出不可用时不得判定事实通过。",
      },
      {
        ruleId: "fact.direct-source-boundary",
        kind: "fact_source_boundary",
        description: "没有直接引用该材料的经审核世界事实时，材料只能进入人工核验。",
      },
      {
        ruleId: "fact.knowledge-snapshot-integrity",
        kind: "knowledge_integrity",
        description: "所有固定知识切片必须通过内容哈希与 ACL 校验。",
      },
    ],
  },
  "copyright-scope/2026.1": {
    rulesetId: "copyright-scope/2026.1",
    domain: "copyright",
    rules: [
      {
        ruleId: "copyright.provider-signal-required",
        kind: "provider_signal",
        description: "工具或模型输出不可用时不得判定版权通过。",
      },
      {
        ruleId: "copyright.material-status-gate",
        kind: "copyright_scope",
        description: "未知或受限授权至少要求修订，争议授权直接阻断。",
      },
      {
        ruleId: "copyright.knowledge-snapshot-integrity",
        kind: "knowledge_integrity",
        description: "所有固定版权知识切片必须通过内容哈希与 ACL 校验。",
      },
    ],
  },
  "content-safety-cn/2026.1": {
    rulesetId: "content-safety-cn/2026.1",
    domain: "content_safety",
    rules: [
      {
        ruleId: "safety.provider-hard-gate",
        kind: "provider_signal",
        description: "内容安全工具结论按保守等级进入硬门，工具不可用即降级。",
      },
      {
        ruleId: "safety.knowledge-snapshot-integrity",
        kind: "knowledge_integrity",
        description: "固定安全规则知识必须通过内容哈希与 ACL 校验。",
      },
    ],
  },
  "platform-publication/2026.1": {
    rulesetId: "platform-publication/2026.1",
    domain: "platform_rule",
    rules: [
      {
        ruleId: "platform.provider-signal-required",
        kind: "provider_signal",
        description: "平台规则工具或检索不可用时不得判定通过。",
      },
      {
        ruleId: "platform.knowledge-snapshot-integrity",
        kind: "knowledge_integrity",
        description: "固定平台知识切片必须通过内容哈希与 ACL 校验。",
      },
    ],
  },
};

const recommendationRank: Record<GovernanceRecommendation, number> = {
  allow: 1,
  review: 2,
  revise: 3,
  unavailable: 4,
  block: 5,
};

export class GovernanceExecutionConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GovernanceExecutionConfigurationError";
  }
}

export interface GovernanceExecutionContext {
  domain: GovernanceDomain;
  systemPrompt: string;
  userPrompt: string;
  prompt: string;
  definitionHash: string;
  basePromptHash: string;
  rulesetHash: string;
  knowledgeSnapshotHash: string;
  baseExecutionInputHash: string;
  knowledgeCitations: GovernanceExecutionTrace["knowledgeCitations"];
  ruleSpecs: readonly GovernanceRuleSpec[];
  material: {
    materialId: string;
    version: string;
    copyrightStatus: "unknown" | "authorized" | "restricted" | "disputed";
  };
  visibleFacts: readonly WorldFact[];
}

function factVisibleToSubject(
  fact: WorldFact,
  subject: ReturnType<typeof createAccessSubject>,
): boolean {
  if (fact.audience) return authorizeResource(subject, fact.audience).allowed;
  if (fact.visibility === "public_world") return true;
  if (fact.visibility === "assigned_team") {
    return subject.visibleScopes.includes("assigned_team");
  }
  if (fact.visibility === "teacher_only") {
    return subject.actorKind === "teacher";
  }
  if (fact.visibility === "audit_only") {
    return subject.purpose === "audit";
  }
  return false;
}

function resolveKnowledge(
  state: WorldState,
  step: GovernanceStep,
  subject: ReturnType<typeof createAccessSubject>,
): RagChunk[] {
  const node = step.governanceNode;
  if (!node) {
    throw new GovernanceExecutionConfigurationError(
      "治理步骤缺少节点快照",
    );
  }
  return node.knowledgeChunkIds.map((chunkId) => {
    const chunk = state.scenario.knowledgeChunks.find(
      (candidate) => candidate.chunkId === chunkId,
    );
    if (!chunk) {
      throw new GovernanceExecutionConfigurationError(
        `治理节点引用未知知识切片：${chunkId}`,
      );
    }
    if (
      chunk.status !== "active"
      || hashContent(chunk.content) !== chunk.contentHash
    ) {
      throw new GovernanceExecutionConfigurationError(
        `治理知识切片未激活或内容哈希失配：${chunkId}`,
      );
    }
    if (!authorizeResource(subject, chunk.audience).allowed) {
      throw new GovernanceExecutionConfigurationError(
        `治理请求岗位无权读取知识切片：${chunkId}`,
      );
    }
    return chunk;
  });
}

export function buildGovernanceExecutionContext(
  state: WorldState,
  task: MediaProcessingTask,
  step: GovernanceStep,
): GovernanceExecutionContext {
  const node = step.governanceNode;
  const domain = step.governanceDomain;
  if (!node || !domain) {
    throw new GovernanceExecutionConfigurationError(
      "治理执行缺少领域或节点快照",
    );
  }
  const definition = promptDefinitions[node.promptVersion];
  if (
    !definition
    || definition.definitionVersion !== node.definitionVersion
    || definition.domain !== domain
  ) {
    throw new GovernanceExecutionConfigurationError(
      `未注册或不匹配的治理提示词定义：${node.promptVersion}`,
    );
  }
  const ruleset = rulesets[node.rulesetId];
  if (!ruleset || ruleset.domain !== domain) {
    throw new GovernanceExecutionConfigurationError(
      `未注册或不匹配的治理规则集：${node.rulesetId}`,
    );
  }
  const material = state.materials.find(
    (candidate) => candidate.materialId === task.materialId,
  );
  if (
    !material
    || material.version !== task.materialVersion
    || material.sourceRef !== task.inputRef
  ) {
    throw new GovernanceExecutionConfigurationError(
      "治理节点固定材料版本已经失效",
    );
  }
  const requester = state.scenario.roles.find(
    (role) => role.agentId === task.requestedBy,
  );
  if (!requester || !material.visibleToRoles.includes(requester.roleId)) {
    throw new GovernanceExecutionConfigurationError(
      "治理请求岗位不存在或无权读取固定材料",
    );
  }
  const subject = createAccessSubject({
    role: requester,
    sessionId: state.sessionId,
    sessionEpoch: state.sessionEpoch,
    courseId: state.scenario.courseId,
    purpose: "runtime",
  });
  const knowledge = resolveKnowledge(state, step, subject);
  const outputRecipients = state.scenario.roles
    .map((role) => createAccessSubject({
      role,
      sessionId: state.sessionId,
      sessionEpoch: state.sessionEpoch,
      courseId: state.scenario.courseId,
      purpose: "runtime",
    }))
    .filter((candidate) => (
      authorizeResource(candidate, task.audience).allowed
    ));
  const knowledgeCitations = knowledge.map((chunk) => ({
    chunkId: chunk.chunkId,
    source: chunk.source,
    version: chunk.version,
    contentHash: chunk.contentHash,
  }));
  const visibleFacts = state.facts
    .filter((fact) => (
      (fact.status === "verified" || fact.status === "disputed")
      && factVisibleToSubject(fact, subject)
      && outputRecipients.every((recipient) => (
        factVisibleToSubject(fact, recipient)
      ))
    ))
    .sort((left, right) => left.factId.localeCompare(right.factId));
  const definitionHash = hashValue(definition);
  const rulesetHash = hashValue(ruleset);
  const knowledgeSnapshotHash = hashValue(knowledgeCitations);
  const baseExecutionInputHash = hashValue({
    sessionEpoch: state.sessionEpoch,
    taskId: task.taskId,
    stepId: step.stepId,
    inputContentHash: task.inputContentHash,
    node,
    definitionHash,
    rulesetHash,
    knowledgeSnapshotHash,
    facts: visibleFacts.map((fact) => ({
      factId: fact.factId,
      version: fact.version,
      status: fact.status,
      statement: fact.statement,
      sourceRefs: fact.sourceRefs,
    })),
  });
  const userPrompt = [
    definition.taskInstruction,
    `固定材料：${material.title}（${material.materialId}@${material.version}）`,
    `来源：${material.source}｜${material.sourceRef}`,
    `内容哈希：${task.inputContentHash}`,
    `版权状态：${material.copyrightStatus}`,
    "确定性规则：",
    ...ruleset.rules.map((rule) => (
      `- ${rule.ruleId}：${rule.description}`
    )),
    "经 ACL 授权的知识：",
    ...knowledge.map((chunk) => (
      `- [${chunk.chunkId}@${chunk.version}] ${chunk.title}：${chunk.content}`
    )),
    "当前可见世界事实：",
    ...(visibleFacts.length > 0
      ? visibleFacts.map((fact) => (
          `- [${fact.factId}@${fact.version}/${fact.status}] ${fact.statement}`
        ))
      : ["- 无"]),
    "输出 JSON 必须包含 recommendation=allow|review|revise|block、summary、riskLabels；不得输出最终教师决定。",
  ].join("\n");
  const basePromptHash = hashValue({
    promptVersion: definition.promptVersion,
    systemPrompt: definition.systemPrompt,
    userPrompt,
  });
  return {
    domain,
    systemPrompt: definition.systemPrompt,
    userPrompt,
    prompt: [
      `[SYSTEM ${definition.promptVersion}]`,
      definition.systemPrompt,
      "[TASK]",
      userPrompt,
    ].join("\n"),
    definitionHash,
    basePromptHash,
    rulesetHash,
    knowledgeSnapshotHash,
    baseExecutionInputHash,
    knowledgeCitations,
    ruleSpecs: ruleset.rules,
    material: {
      materialId: material.materialId,
      version: material.version,
      copyrightStatus: material.copyrightStatus,
    },
    visibleFacts,
  };
}

export interface CompiledGovernanceModelPrompt {
  systemPrompt: string;
  userPrompt: string;
  promptHash: string;
  executionInputHash: string;
  toolOutputHash: string;
}

export interface GovernanceModelTraceSummary {
  status: "completed";
  profileId: string;
  provider: string;
  mode: "mock" | "live";
  model: string;
  requestId: string | null;
}

export function compileGovernanceModelPrompt(
  context: GovernanceExecutionContext,
  toolObservation: Record<string, unknown>,
): CompiledGovernanceModelPrompt {
  const toolOutputHash = hashValue(toolObservation);
  const allowedCitationChunkIds = context.knowledgeCitations
    .map((item) => item.chunkId);
  const userPrompt = [
    context.userPrompt,
    "固定工具观察：",
    JSON.stringify(toolObservation),
    "综合工具观察、确定性规则和已提供知识，返回且只返回一个 JSON 对象；不要输出 Markdown、代码围栏、解释前缀或额外字段。",
    "唯一允许的对象形状：",
    '{"recommendation":"allow|review|revise|block","summary":"不超过300字的中文结论","riskLabels":["短风险标签"],"citationChunkIds":["仅允许的知识块ID"]}',
    `citationChunkIds 允许值全集：${JSON.stringify(allowedCitationChunkIds)}。不得填入事实 ID、材料 ID、规则 ID或任何未列出的字符串；没有引用时返回空数组。`,
    "riskLabels 必须是字符串数组；recommendation 不得返回 unavailable；不确定时使用 review。",
  ].join("\n");
  const promptHash = hashValue({
    systemPrompt: context.systemPrompt,
    userPrompt,
  });
  return {
    systemPrompt: context.systemPrompt,
    userPrompt,
    promptHash,
    executionInputHash: hashValue({
      baseExecutionInputHash: context.baseExecutionInputHash,
      toolOutputHash,
      promptHash,
    }),
    toolOutputHash,
  };
}

function providerEvaluation(
  ruleId: string,
  toolRecommendation: GovernanceRecommendation,
  modelRecommendation: GovernanceRecommendation,
): GovernanceRuleEvaluation {
  const recommendation = recommendationRank[toolRecommendation]
    >= recommendationRank[modelRecommendation]
    ? toolRecommendation
    : modelRecommendation;
  return {
    ruleId,
    outcome: recommendation === "allow" ? "passed" : "flagged",
    recommendation,
    summary: recommendation === "unavailable"
      ? "提供方结果不可用，按降级处理，禁止视为通过。"
      : `工具建议为 ${toolRecommendation}，模型建议为 ${modelRecommendation}；确定性规则采用更保守的 ${recommendation}。`,
    evidenceRefs: [
      "tool:structured-recommendation",
      "model:structured-recommendation",
    ],
  };
}

function evaluateRule(
  context: GovernanceExecutionContext,
  rule: GovernanceRuleSpec,
  toolRecommendation: GovernanceRecommendation,
  modelRecommendation: GovernanceRecommendation,
): GovernanceRuleEvaluation {
  if (rule.kind === "provider_signal") {
    return providerEvaluation(
      rule.ruleId,
      toolRecommendation,
      modelRecommendation,
    );
  }
  if (rule.kind === "knowledge_integrity") {
    return {
      ruleId: rule.ruleId,
      outcome: "passed",
      recommendation: "allow",
      summary: `${context.knowledgeCitations.length} 个固定知识切片均已通过内容哈希与 ACL 校验。`,
      evidenceRefs: context.knowledgeCitations.map((item) => item.chunkId),
    };
  }
  if (rule.kind === "fact_source_boundary") {
    const directFacts = context.visibleFacts.filter((fact) => (
      fact.sourceRefs.includes(context.material.materialId)
    ));
    return {
      ruleId: rule.ruleId,
      outcome: directFacts.length > 0 ? "passed" : "flagged",
      recommendation: directFacts.length > 0 ? "allow" : "review",
      summary: directFacts.length > 0
        ? "存在直接引用该材料的可见世界事实。"
        : "没有直接引用该材料的经审核世界事实，必须人工核验表述边界。",
      evidenceRefs: directFacts.length > 0
        ? directFacts.map((fact) => fact.factId)
        : [context.material.materialId],
    };
  }
  const recommendation = context.material.copyrightStatus === "authorized"
    ? "allow" as const
    : context.material.copyrightStatus === "disputed"
      ? "block" as const
      : "revise" as const;
  return {
    ruleId: rule.ruleId,
    outcome: recommendation === "allow" ? "passed" : "flagged",
    recommendation,
    summary: `固定材料版权状态为 ${context.material.copyrightStatus}；确定性授权范围规则给出 ${recommendation}。`,
    evidenceRefs: [context.material.materialId],
  };
}

export function evaluateGovernanceExecution(
  context: GovernanceExecutionContext,
  input: {
    toolRecommendation: GovernanceRecommendation;
    modelDecision: GovernanceModelDecision;
    compiledPrompt: CompiledGovernanceModelPrompt;
    modelTrace: GovernanceModelTraceSummary;
  },
): {
  recommendation: GovernanceRecommendation;
  trace: GovernanceExecutionTrace;
  riskLabels: string[];
} {
  const allowedChunkIds = new Set(
    context.knowledgeCitations.map((item) => item.chunkId),
  );
  const unknownCitation = input.modelDecision.citationChunkIds.find(
    (chunkId) => !allowedChunkIds.has(chunkId),
  );
  if (unknownCitation) {
    throw new GovernanceExecutionConfigurationError(
      `治理模型引用了未提供的知识切片：${unknownCitation}`,
    );
  }
  const ruleEvaluations = context.ruleSpecs.map((rule) => (
    evaluateRule(
      context,
      rule,
      input.toolRecommendation,
      input.modelDecision.recommendation,
    )
  ));
  const recommendation = [...ruleEvaluations]
    .sort((left, right) => (
      recommendationRank[right.recommendation]
        - recommendationRank[left.recommendation]
      || left.ruleId.localeCompare(right.ruleId)
    ))[0]!.recommendation;
  const trace = GovernanceExecutionTraceSchema.parse({
    definitionHash: context.definitionHash,
    promptHash: input.compiledPrompt.promptHash,
    rulesetHash: context.rulesetHash,
    knowledgeSnapshotHash: context.knowledgeSnapshotHash,
    executionInputHash: input.compiledPrompt.executionInputHash,
    toolOutputHash: input.compiledPrompt.toolOutputHash,
    modelOutputHash: hashValue(input.modelDecision),
    modelProfileId: input.modelTrace.profileId,
    modelProvider: input.modelTrace.provider,
    modelMode: input.modelTrace.mode,
    modelName: input.modelTrace.model,
    modelRequestId: input.modelTrace.requestId,
    knowledgeCitations: context.knowledgeCitations,
    ruleEvaluations,
  });
  return {
    recommendation,
    trace,
    riskLabels: ruleEvaluations
      .filter((item) => item.outcome === "flagged")
      .map((item) => item.ruleId),
  };
}
