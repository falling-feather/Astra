import {
  GovernanceModelDecisionSchema,
  ModelInvocationRequestSchema,
  ModelInvocationResultSchema,
  ModelProviderHealthSchema,
  type GovernanceDomain,
  type GovernanceRecommendation,
} from "@ronggang/contracts";
import type { GovernanceModelPort } from "./ports.js";

const recommendationByDomain: Record<
  GovernanceDomain,
  Exclude<GovernanceRecommendation, "unavailable">
> = {
  fact: "review",
  copyright: "revise",
  content_safety: "allow",
  platform_rule: "allow",
};

export class DeterministicGovernanceModel implements GovernanceModelPort {
  readonly #clock: () => string;

  constructor(clock: () => string = () => new Date().toISOString()) {
    this.#clock = clock;
  }

  health() {
    return ModelProviderHealthSchema.parse({
      profileId: "governance-deterministic/1.0.0",
      provider: "deterministic",
      mode: "mock",
      configured: true,
      available: true,
      baseUrl: null,
      models: ["deterministic-governance-model/1.0.0"],
      reason: null,
    });
  }

  async invoke(rawRequest: Parameters<GovernanceModelPort["invoke"]>[0]) {
    const request = ModelInvocationRequestSchema.parse(rawRequest);
    const domain = request.taskKind.replace(
      /^governance\./u,
      "",
    ) as GovernanceDomain;
    const recommendation = recommendationByDomain[domain];
    if (!recommendation) {
      throw new Error(`确定性治理模型不支持任务：${request.taskKind}`);
    }
    const knowledgeSection = request.userPrompt
      .split("经 ACL 授权的知识：", 2)[1]
      ?.split("当前可见世界事实：", 1)[0]
      ?? "";
    const suppliedChunkIds = [...knowledgeSection.matchAll(
      /\[([a-z0-9-]+)@[^\]]+\]/giu,
    )].map((match) => match[1]!).filter((value, index, values) => (
      values.indexOf(value) === index
    ));
    const output = GovernanceModelDecisionSchema.parse({
      recommendation,
      summary: `确定性治理模型已消费固定工具观察与版本化提示词，给出 ${recommendation} 建议。`,
      riskLabels: recommendation === "allow"
        ? []
        : [`model_${domain}_${recommendation}`],
      citationChunkIds: suppliedChunkIds,
    });
    const now = this.#clock();
    return ModelInvocationResultSchema.parse({
      output,
      trace: {
        invocationId: request.invocationId,
        profileId: request.profileId,
        provider: "deterministic",
        mode: "mock",
        model: "deterministic-governance-model/1.0.0",
        requestId: null,
        status: "completed",
        outputMode: request.outputMode,
        finishReason: "deterministic",
        tokenUsage: {
          input: Math.ceil(
            (request.systemPrompt.length + request.userPrompt.length) / 4,
          ),
          output: Math.ceil(JSON.stringify(output).length / 4),
          total: null,
        },
        latencyMs: 0,
        attempts: 1,
        estimatedCostUsd: 0,
        errorCode: null,
        startedAt: now,
        completedAt: now,
      },
    });
  }
}
