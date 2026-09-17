import {
  AgentRuntime,
  createAssistanceHandlers,
  createFactCheckerHandlers,
  createLearningCuratorHandlers,
  createSemanticEvaluatorHandlers,
  createSceneDirectorHandlers,
  createTeachingDirectorHandlers,
  createRoleAgentHandlers,
  DeterministicFactCheckerModel,
  DeterministicLearningCuratorModel,
  DeterministicSemanticEvaluationModel,
  DeterministicSceneDirectorModel,
  DeterministicRoleAgentModel,
  deterministicAssistanceModelDraft,
  GatewayFactCheckerModel,
  GatewayLearningCuratorModel,
  GatewaySemanticEvaluationModel,
  GatewaySceneDirectorModel,
  GatewayRoleAgentModel,
  GatewayAssistanceModel,
  type AssistanceModelPort,
  type LearningCuratorModelPort,
  type SemanticEvaluationModelPort,
  type AgentNodeExecutor,
} from "@ronggang/agent-runtime";
import {
  GovernanceModelDecisionSchema,
  ModelProviderHealthSchema,
  type ModelInvocationRequest,
  type ModelInvocationResult,
  type ModelProviderHealth,
} from "@ronggang/contracts";
import {
  DeterministicModelProvider,
  HandlerBackedModelProvider,
  OpenAiCompatibleModelProvider,
  readModelGatewayConfig,
  type StructuredModelPort,
} from "@ronggang/model-gateway";

export interface ModelIntegration {
  runtime: AgentRuntime;
  provider: StructuredModelPort;
  visionProvider?: StructuredModelPort;
  health: () => ModelProviderHealth;
}

export interface CreateModelIntegrationOptions {
  environment?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  iflytekHandler?: (request: ModelInvocationRequest) => Promise<ModelInvocationResult>;
}

function createDeterministicStructuredProvider(profileId: string): StructuredModelPort {
  return new DeterministicModelProvider({
    profileId,
    model: "deterministic-governance-model/1.0.0",
    resolver: (request) => {
      const assistance = deterministicAssistanceModelDraft(request.taskKind);
      if (assistance) return assistance;
      const domain = request.taskKind.replace(/^governance\./u, "");
      const recommendation = {
        fact: "review",
        copyright: "revise",
        content_safety: "allow",
        platform_rule: "allow",
      }[domain];
      if (!recommendation) {
        throw new Error(`确定性模型不支持任务：${request.taskKind}`);
      }
      const knowledgeSection = request.userPrompt
        .split("经 ACL 授权的知识：", 2)[1]
        ?.split("当前可见世界事实：", 1)[0]
        ?? "";
      const citationChunkIds = [...knowledgeSection.matchAll(
        /\[([a-z0-9-]+)@[^\]]+\]/giu,
      )].map((match) => match[1]!).filter(
        (value, index, values) => values.indexOf(value) === index,
      );
      return GovernanceModelDecisionSchema.parse({
        recommendation,
        summary: `确定性治理模型已消费工具观察与版本化提示词，给出 ${recommendation} 建议。`,
        riskLabels: recommendation === "allow"
          ? []
          : [`model_${domain}_${recommendation}`],
        citationChunkIds,
      });
    },
  });
}

export function createModelIntegration(
  options: CreateModelIntegrationOptions = {},
): ModelIntegration {
  const integratedRuntime = (input: {
    factCheckerModel: DeterministicFactCheckerModel | GatewayFactCheckerModel;
    roleAgentModel: DeterministicRoleAgentModel | GatewayRoleAgentModel;
    sceneDirectorModel: DeterministicSceneDirectorModel | GatewaySceneDirectorModel;
    semanticEvaluationModels: ReadonlyMap<
      "evidence_sufficiency" | "work_quality" | "professional_collaboration",
      SemanticEvaluationModelPort
    >;
    learningCuratorModel: LearningCuratorModelPort;
    assistanceModel: AssistanceModelPort;
  }): AgentRuntime => {
    const handlers = new Map<string, AgentNodeExecutor>([
      ...createFactCheckerHandlers(input.factCheckerModel),
      ...createRoleAgentHandlers(input.roleAgentModel),
      ...createTeachingDirectorHandlers(),
      ...createSceneDirectorHandlers(input.sceneDirectorModel),
      ...createSemanticEvaluatorHandlers(input.semanticEvaluationModels),
      ...createLearningCuratorHandlers(input.learningCuratorModel),
      ...createAssistanceHandlers(input.assistanceModel),
    ]);
    return new AgentRuntime({ handlers });
  };
  const environment = options.environment ?? process.env;
  const config = readModelGatewayConfig(environment);
  if (config.provider === "deterministic") {
    const provider = createDeterministicStructuredProvider(config.profileId);
    const health = ModelProviderHealthSchema.parse({
      profileId: config.profileId,
      provider: "deterministic",
      mode: "mock",
      configured: true,
      available: true,
      baseUrl: null,
      models: [
        "deterministic-fact-checker-v1",
        "deterministic-role-agent-v1",
        "deterministic-scene-director-v1",
        "deterministic-assistance-v1",
      ],
      reason: null,
    });
    return {
      provider,
      runtime: integratedRuntime({
        factCheckerModel: new DeterministicFactCheckerModel(),
        roleAgentModel: new DeterministicRoleAgentModel(),
        sceneDirectorModel: new DeterministicSceneDirectorModel(),
        semanticEvaluationModels: new Map([
          ["evidence_sufficiency", new DeterministicSemanticEvaluationModel()],
          ["work_quality", new DeterministicSemanticEvaluationModel()],
          ["professional_collaboration", new DeterministicSemanticEvaluationModel()],
        ]),
        learningCuratorModel: new DeterministicLearningCuratorModel(),
        assistanceModel: new GatewayAssistanceModel({
          provider,
          profileId: config.profileId,
          timeoutMs: config.timeoutMs,
        }),
      }),
      health: () => health,
    };
  }

  let provider: StructuredModelPort;
  let visionProvider: StructuredModelPort | undefined;
  if (config.provider === "deepseek") {
    provider = new OpenAiCompatibleModelProvider({
      profileId: config.profileId,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.model,
      maxRetries: config.maxRetries,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    });
    if(config.visionModel)visionProvider = new OpenAiCompatibleModelProvider({
      profileId: `${config.profileId}-vision`,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.visionModel,
      maxRetries: config.maxRetries,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    });
  } else {
    provider = new HandlerBackedModelProvider({
      profileId: config.profileId,
      provider: "iflytek_xingchen",
      model: "xingchen-workflow",
      baseUrl: config.endpoint,
      configured: true,
      ...(options.iflytekHandler ? { handler: options.iflytekHandler } : {}),
    });
  }

  const semanticEvaluationModel = new GatewaySemanticEvaluationModel({
    provider,
    profileId: config.profileId,
    timeoutMs: config.timeoutMs,
  });
  const useShowcaseStructuredFallback =
    environment.SHOWCASE_DETERMINISTIC_STRUCTURED?.trim() === "1";
  const deterministicStructuredProvider = useShowcaseStructuredFallback
    ? createDeterministicStructuredProvider(
        `${config.profileId}-showcase-structured`,
      )
    : null;
  return {
    provider,
    ...(visionProvider ? { visionProvider } : {}),
    runtime: integratedRuntime({
      factCheckerModel: useShowcaseStructuredFallback
        ? new DeterministicFactCheckerModel()
        : new GatewayFactCheckerModel({
            provider,
            profileId: config.profileId,
            timeoutMs: config.timeoutMs,
          }),
      roleAgentModel: new GatewayRoleAgentModel({
        provider,
        profileId: config.profileId,
        timeoutMs: config.timeoutMs,
      }),
      sceneDirectorModel: useShowcaseStructuredFallback
        ? new DeterministicSceneDirectorModel()
        : new GatewaySceneDirectorModel({
            provider,
            profileId: config.profileId,
            timeoutMs: config.timeoutMs,
          }),
      semanticEvaluationModels: useShowcaseStructuredFallback
        ? new Map([
            ["evidence_sufficiency", new DeterministicSemanticEvaluationModel()],
            ["work_quality", new DeterministicSemanticEvaluationModel()],
            ["professional_collaboration", new DeterministicSemanticEvaluationModel()],
          ])
        : new Map([
            ["evidence_sufficiency", semanticEvaluationModel],
            ["work_quality", semanticEvaluationModel],
            ["professional_collaboration", semanticEvaluationModel],
          ]),
      learningCuratorModel: useShowcaseStructuredFallback
        ? new DeterministicLearningCuratorModel()
        : new GatewayLearningCuratorModel({
            provider,
            profileId: config.profileId,
            timeoutMs: config.timeoutMs,
          }),
      assistanceModel: new GatewayAssistanceModel({
        provider: deterministicStructuredProvider ?? provider,
        profileId: deterministicStructuredProvider
          ? `${config.profileId}-showcase-structured`
          : config.profileId,
        timeoutMs: config.timeoutMs,
      }),
    }),
    health: () => provider.health(),
  };
}
