import { performance } from "node:perf_hooks";
import {
  ModelInvocationRequestSchema,
  ModelInvocationResultSchema,
  ModelInvocationTraceSchema,
  ModelProviderHealthSchema,
  type ModelInvocationRequest,
  type ModelInvocationResult,
  type ModelInvocationTrace,
  type ModelProvider,
  type ModelProviderHealth,
} from "@ronggang/contracts";

export interface ModelInvocationControl {
  signal?: AbortSignal;
  maximumAttempts?: number;
}
export interface StructuredModelPort {
  invoke(request: ModelInvocationRequest, control?: ModelInvocationControl): Promise<ModelInvocationResult>;
  health(): ModelProviderHealth;
}

export class ModelInvocationError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly trace: ModelInvocationTrace;

  constructor(input: {
    code: string;
    message: string;
    retryable: boolean;
    trace: ModelInvocationTrace;
  }) {
    super(input.message);
    this.name = "ModelInvocationError";
    this.code = input.code;
    this.retryable = input.retryable;
    this.trace = ModelInvocationTraceSchema.parse(input.trace);
  }
}

export interface DeterministicModelProviderOptions {
  profileId?: string;
  model?: string;
  resolver: (request: ModelInvocationRequest) => unknown | Promise<unknown>;
  clock?: () => string;
}

export class DeterministicModelProvider implements StructuredModelPort {
  readonly #profileId: string;
  readonly #model: string;
  readonly #resolver: DeterministicModelProviderOptions["resolver"];
  readonly #clock: () => string;

  constructor(options: DeterministicModelProviderOptions) {
    this.#profileId = options.profileId ?? "deterministic-default";
    this.#model = options.model ?? "deterministic-json-v1";
    this.#resolver = options.resolver;
    this.#clock = options.clock ?? (() => new Date().toISOString());
  }

  health(): ModelProviderHealth {
    return ModelProviderHealthSchema.parse({
      profileId: this.#profileId,
      provider: "deterministic",
      mode: "mock",
      configured: true,
      available: true,
      baseUrl: null,
      models: [this.#model],
      reason: null,
    });
  }

  async invoke(rawRequest: ModelInvocationRequest): Promise<ModelInvocationResult> {
    const request = ModelInvocationRequestSchema.parse(rawRequest);
    const startedAt = this.#clock();
    const startedMs = performance.now();
    try {
      const output = await this.#resolver(request);
      return ModelInvocationResultSchema.parse({
        output,
        trace: {
          invocationId: request.invocationId,
          profileId: request.profileId,
          provider: "deterministic",
          mode: "mock",
          model: this.#model,
          requestId: null,
          status: "completed",
          outputMode: request.outputMode,
          finishReason: "deterministic",
          tokenUsage: {
            input: Math.ceil((request.systemPrompt.length + request.userPrompt.length) / 4),
            output: Math.ceil(JSON.stringify(output).length / 4),
            total: null,
          },
          latencyMs: Math.max(0, performance.now() - startedMs),
          attempts: 1,
          estimatedCostUsd: 0,
          errorCode: null,
          startedAt,
          completedAt: this.#clock(),
        },
      });
    } catch {
      const trace = ModelInvocationTraceSchema.parse({
        invocationId: request.invocationId,
        profileId: request.profileId,
        provider: "deterministic",
        mode: "mock",
        model: this.#model,
        requestId: null,
        status: "failed",
        outputMode: request.outputMode,
        finishReason: null,
        tokenUsage: { input: null, output: null, total: null },
        latencyMs: Math.max(0, performance.now() - startedMs),
        attempts: 1,
        estimatedCostUsd: 0,
        errorCode: "deterministic_resolver_failed",
        startedAt,
        completedAt: this.#clock(),
      });
      throw new ModelInvocationError({
        code: "deterministic_resolver_failed",
        message: "确定性模型提供方未能生成结构化输出",
        retryable: false,
        trace,
      });
    }
  }
}

export interface HandlerBackedModelProviderOptions {
  profileId: string;
  provider: Exclude<ModelProvider, "deterministic" | "deepseek">;
  model: string;
  baseUrl: string;
  configured: boolean;
  handler?: (request: ModelInvocationRequest) => Promise<ModelInvocationResult>;
  clock?: () => string;
}

export class HandlerBackedModelProvider implements StructuredModelPort {
  readonly #options: HandlerBackedModelProviderOptions;
  readonly #clock: () => string;

  constructor(options: HandlerBackedModelProviderOptions) {
    this.#options = options;
    this.#clock = options.clock ?? (() => new Date().toISOString());
  }

  health(): ModelProviderHealth {
    return ModelProviderHealthSchema.parse({
      profileId: this.#options.profileId,
      provider: this.#options.provider,
      mode: this.#options.handler ? "live" : "unavailable",
      configured: this.#options.configured,
      available: Boolean(this.#options.handler),
      baseUrl: this.#options.baseUrl,
      models: [this.#options.model],
      reason: this.#options.handler ? null : "live_handler_not_registered",
    });
  }

  async invoke(rawRequest: ModelInvocationRequest): Promise<ModelInvocationResult> {
    const request = ModelInvocationRequestSchema.parse(rawRequest);
    if (this.#options.handler) {
      const result = ModelInvocationResultSchema.parse(await this.#options.handler(request));
      if (result.trace.provider !== this.#options.provider) {
        throw new Error("模型 Handler 返回的提供方与注册配置不一致");
      }
      return result;
    }
    const now = this.#clock();
    const trace = ModelInvocationTraceSchema.parse({
      invocationId: request.invocationId,
      profileId: request.profileId,
      provider: this.#options.provider,
      mode: "unavailable",
      model: this.#options.model,
      requestId: null,
      status: "failed",
      outputMode: request.outputMode,
      finishReason: null,
      tokenUsage: { input: null, output: null, total: null },
      latencyMs: 0,
      attempts: 1,
      estimatedCostUsd: null,
      errorCode: "live_handler_not_registered",
      startedAt: now,
      completedAt: now,
    });
    throw new ModelInvocationError({
      code: "live_handler_not_registered",
      message: "实时模型 Handler 尚未注册，已拒绝伪装为 Live",
      retryable: false,
      trace,
    });
  }
}
