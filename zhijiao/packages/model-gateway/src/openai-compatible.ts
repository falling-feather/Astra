import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  ModelInvocationRequestSchema,
  ModelInvocationResultSchema,
  ModelInvocationTraceSchema,
  ModelProviderHealthSchema,
  type ModelInvocationRequest,
  type ModelInvocationResult,
  type ModelInvocationTrace,
  type ModelProviderHealth,
} from "@ronggang/contracts";
import { z } from "zod";
import { ModelInvocationError, type ModelInvocationControl, type StructuredModelPort } from "./provider.js";

const chatResponseSchema = z.object({
  id: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  choices: z.array(z.object({
    finish_reason: z.string().nullable().optional(),
    message: z.object({
      content: z.string().nullable(),
    }),
  })).min(1),
  usage: z.object({
    prompt_tokens: z.number().int().nonnegative().optional(),
    completion_tokens: z.number().int().nonnegative().optional(),
    total_tokens: z.number().int().nonnegative().optional(),
  }).optional(),
});

export interface OpenAiCompatibleModelProviderOptions {
  profileId: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
  clock?: () => string;
  sleep?: (delayMs: number) => Promise<void>;
}

type FailureDetails = {
  code: string;
  retryable: boolean;
  requestId: string | null;
  finishReason: string | null;
  tokenUsage?: ModelInvocationTrace["tokenUsage"];
};

function normalizeBaseUrl(baseUrl: string): string {
  const parsed = new URL(baseUrl);
  if (!parsed.pathname.endsWith("/")) parsed.pathname = `${parsed.pathname}/`;
  return parsed.toString();
}

function httpFailure(status: number): FailureDetails {
  if (status === 429) {
    return { code: "model_rate_limited", retryable: true, requestId: null, finishReason: null };
  }
  if ([500, 502, 503, 504].includes(status)) {
    return { code: "model_provider_unavailable", retryable: true, requestId: null, finishReason: null };
  }
  if (status === 401 || status === 403) {
    return { code: "model_auth_failed", retryable: false, requestId: null, finishReason: null };
  }
  if (status === 402) {
    return { code: "model_quota_exhausted", retryable: false, requestId: null, finishReason: null };
  }
  return { code: "model_request_rejected", retryable: false, requestId: null, finishReason: null };
}

function unknownFailure(error: unknown): FailureDetails {
  if (error instanceof DOMException && error.name === "AbortError") {
    return { code: "model_timeout", retryable: true, requestId: null, finishReason: null };
  }
  return { code: "model_network_error", retryable: true, requestId: null, finishReason: null };
}

function imageBytes(input: {
  mimeType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  contentBase64: string;
  representationContentHash: string;
}): Buffer {
  const bytes = Buffer.from(input.contentBase64, "base64");
  if (bytes.length === 0
    || createHash("sha256").update(bytes).digest("hex")
      !== input.representationContentHash) {
    throw new Error("model_image_hash_mismatch");
  }
  const matchesMime = input.mimeType === "image/png"
    ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : input.mimeType === "image/jpeg"
      ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9
      : input.mimeType === "image/gif"
        ? ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))
        : bytes.subarray(0, 4).toString("ascii") === "RIFF"
          && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  if (!matchesMime) throw new Error("model_image_mime_mismatch");
  return bytes;
}

export class OpenAiCompatibleModelProvider implements StructuredModelPort {
  readonly #profileId: string;
  readonly #baseUrl: string;
  readonly #apiKey: string;
  readonly #model: string;
  readonly #maxRetries: number;
  readonly #fetch: typeof fetch;
  readonly #clock: () => string;
  readonly #sleep: (delayMs: number) => Promise<void>;

  constructor(options: OpenAiCompatibleModelProviderOptions) {
    if (!options.apiKey.trim()) throw new Error("DeepSeek API Key 未配置");
    this.#profileId = options.profileId;
    this.#baseUrl = normalizeBaseUrl(options.baseUrl);
    this.#apiKey = options.apiKey;
    this.#model = options.model;
    this.#maxRetries = Math.max(0, Math.min(2, options.maxRetries ?? 1));
    this.#fetch = options.fetchImpl ?? fetch;
    this.#clock = options.clock ?? (() => new Date().toISOString());
    this.#sleep = options.sleep ?? ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
  }

  health(): ModelProviderHealth {
    return ModelProviderHealthSchema.parse({
      profileId: this.#profileId,
      provider: "deepseek",
      mode: "live",
      configured: true,
      available: true,
      baseUrl: this.#baseUrl,
      models: [this.#model],
      reason: null,
    });
  }

  async invoke(rawRequest: ModelInvocationRequest, control: ModelInvocationControl = {}): Promise<ModelInvocationResult> {
    const request = ModelInvocationRequestSchema.parse(rawRequest);
    const startedAt = this.#clock();
    const startedMs = performance.now();
    try {
      for (const input of request.imageInputs ?? []) imageBytes(input);
    } catch {
      const now = this.#clock();
      const trace = ModelInvocationTraceSchema.parse({
        invocationId: request.invocationId,
        profileId: request.profileId,
        provider: "deepseek",
        mode: "live",
        model: this.#model,
        requestId: null,
        status: "failed",
        outputMode: request.outputMode,
        finishReason: null,
        tokenUsage: { input: null, output: null, total: null },
        latencyMs: Math.max(0, performance.now() - startedMs),
        attempts: 0,
        estimatedCostUsd: null,
        errorCode: "model_image_input_invalid",
        startedAt,
        completedAt: now,
      });
      throw new ModelInvocationError({
        code: "model_image_input_invalid",
        message: "模型图像输入未通过内容哈希与媒体类型校验",
        retryable: false,
        trace,
      });
    }
    const deadlineMs = startedMs + request.timeoutMs;
    let attempts = 0;
    let lastFailure: FailureDetails = {
      code: "model_network_error",
      retryable: true,
      requestId: null,
      finishReason: null,
    };

    const maximumAttempts = Math.max(1, Math.min(this.#maxRetries + 1, Math.floor(control.maximumAttempts ?? this.#maxRetries + 1)));
    while (attempts < maximumAttempts) {
      if (control.signal?.aborted) {
        lastFailure = { code: "model_cancelled", retryable: false, requestId: lastFailure.requestId, finishReason: null };
        break;
      }
      const remainingMs = deadlineMs - performance.now();
      if (remainingMs <= 0) {
        lastFailure = {
          code: "model_timeout",
          retryable: true,
          requestId: lastFailure.requestId,
          finishReason: lastFailure.finishReason,
        };
        break;
      }
      attempts += 1;
      const controller = new AbortController();
      const cancel = () => controller.abort();
      control.signal?.addEventListener("abort", cancel, { once: true });
      const timer = setTimeout(
        () => controller.abort(),
        Math.max(1, Math.ceil(remainingMs)),
      );
      timer.unref?.();
      try {
        const response = await this.#fetch(new URL("chat/completions", this.#baseUrl), {
          method: "POST",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${this.#apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: this.#model,
            messages: [
              { role: "system", content: request.systemPrompt },
              {
                role: "user",
                content: request.imageInputs?.length
                  ? [
                      { type: "text", text: request.userPrompt },
                      ...request.imageInputs.map((input) => ({
                        type: "image_url",
                        image_url: {
                          url: `data:${input.mimeType};base64,${input.contentBase64}`,
                          detail: input.detail,
                        },
                      })),
                    ]
                  : request.userPrompt,
              },
            ],
            response_format: { type: "json_object" },
            // Structured business decisions must be short, machine-parseable and
            // budget-predictable. DeepSeek V4 enables reasoning by default, which
            // can consume the entire completion budget before the JSON answer.
            thinking: { type: "disabled" },
            temperature: request.temperature,
            max_tokens: request.maxOutputTokens,
            stream: false,
          }),
          signal: controller.signal,
        });
        const headerRequestId = response.headers.get("x-request-id");
        if (!response.ok) {
          await response.text();
          lastFailure = { ...httpFailure(response.status), requestId: headerRequestId };
        } else {
          let decoded: unknown;
          try {
            decoded = await response.json();
          } catch {
            lastFailure = {
              code: "model_response_invalid",
              retryable: false,
              requestId: headerRequestId,
              finishReason: null,
            };
            break;
          }
          const parsed = chatResponseSchema.safeParse(decoded);
          if (!parsed.success) {
            lastFailure = {
              code: "model_response_invalid",
              retryable: false,
              requestId: headerRequestId,
              finishReason: null,
            };
            break;
          }
          const choice = parsed.data.choices[0];
          const finishReason = choice?.finish_reason ?? null;
          const requestId = headerRequestId ?? parsed.data.id ?? null;
          const inputTokens = parsed.data.usage?.prompt_tokens ?? null;
          const outputTokens = parsed.data.usage?.completion_tokens ?? null;
          const totalTokens = parsed.data.usage?.total_tokens
            ?? (
              inputTokens !== null && outputTokens !== null
                ? inputTokens + outputTokens
                : null
            );
          const observedTokenUsage = {
            input: inputTokens,
            output: outputTokens,
            total: totalTokens,
          };
          if (finishReason === "length") {
            lastFailure = {
              code: "model_output_truncated",
              retryable: false,
              requestId,
              finishReason,
              tokenUsage: observedTokenUsage,
            };
            break;
          }
          const content = choice?.message.content?.trim() ?? "";
          if (!content) {
            lastFailure = {
              code: "model_empty_content",
              retryable: false,
              requestId,
              finishReason,
            };
            break;
          }
          let output: unknown;
          try {
            output = JSON.parse(content);
          } catch {
            lastFailure = {
              code: "model_invalid_json",
              retryable: false,
              requestId,
              finishReason,
            };
            break;
          }
          return ModelInvocationResultSchema.parse({
            output,
            trace: {
              invocationId: request.invocationId,
              profileId: request.profileId,
              provider: "deepseek",
              mode: "live",
              model: parsed.data.model ?? this.#model,
              requestId,
              status: "completed",
              outputMode: request.outputMode,
              finishReason,
              tokenUsage: observedTokenUsage,
              latencyMs: Math.max(0, performance.now() - startedMs),
              attempts,
              estimatedCostUsd: null,
              errorCode: null,
              startedAt,
              completedAt: this.#clock(),
            },
          });
        }
      } catch (error) {
        lastFailure = control.signal?.aborted
          ? { code: "model_cancelled", retryable: false, requestId: lastFailure.requestId, finishReason: null }
          : unknownFailure(error);
      } finally {
        clearTimeout(timer);
        control.signal?.removeEventListener("abort", cancel);
      }

      // The per-attempt abort timer always receives the entire remaining
      // invocation budget. Once it fires there is no legitimate retry window,
      // even if the timer callback ran a fraction early on a busy event loop.
      if (lastFailure.code === "model_timeout") break;
      if (!lastFailure.retryable || attempts >= maximumAttempts) break;
      const remainingBeforeRetryMs = deadlineMs - performance.now();
      if (remainingBeforeRetryMs <= 0) {
        lastFailure = {
          code: "model_timeout",
          retryable: true,
          requestId: lastFailure.requestId,
          finishReason: lastFailure.finishReason,
        };
        break;
      }
      const backoffMs = Math.min(1_000, 100 * (2 ** (attempts - 1)));
      const boundedBackoffMs = Math.min(
        backoffMs,
        Math.max(0, remainingBeforeRetryMs - 1),
      );
      if (boundedBackoffMs > 0) await this.#sleep(boundedBackoffMs);
      if (performance.now() >= deadlineMs) {
        lastFailure = {
          code: "model_timeout",
          retryable: true,
          requestId: lastFailure.requestId,
          finishReason: lastFailure.finishReason,
        };
        break;
      }
    }

    const trace = ModelInvocationTraceSchema.parse({
      invocationId: request.invocationId,
      profileId: request.profileId,
      provider: "deepseek",
      mode: "live",
      model: this.#model,
      requestId: lastFailure.requestId,
      status: "failed",
      outputMode: request.outputMode,
      finishReason: lastFailure.finishReason,
      tokenUsage: lastFailure.tokenUsage
        ?? { input: null, output: null, total: null },
      latencyMs: Math.max(0, performance.now() - startedMs),
      attempts,
      estimatedCostUsd: null,
      errorCode: lastFailure.code,
      startedAt,
      completedAt: this.#clock(),
    });
    throw new ModelInvocationError({
      code: lastFailure.code,
      message: "模型提供方调用失败，运行时将进入显式降级路径",
      retryable: lastFailure.retryable,
      trace,
    });
  }
}
