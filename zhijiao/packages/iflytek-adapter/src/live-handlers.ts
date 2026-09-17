import { createHmac, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  ModelInvocationRequestSchema,
  ModelInvocationResultSchema,
  type ModelInvocationRequest,
  type ModelInvocationResult,
} from "@ronggang/contracts";
import type {
  CapabilityExecutionInput,
  CapabilityExecutionOutput,
  IflytekCapabilityHandler,
  IflytekEnvironment,
} from "./adapter.js";

export type IflytekFetch = typeof fetch;

export interface IflytekLiveHandlerOptions {
  environment: IflytekEnvironment;
  fetchImpl?: IflytekFetch;
  resolveSourceText?: (
    input: CapabilityExecutionInput,
  ) => Promise<string>;
  now?: () => Date;
  nextUuid?: () => string;
}

export class IflytekLiveHandlerError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "IflytekLiveHandlerError";
  }
}

function required(
  environment: IflytekEnvironment,
  name: string,
): string {
  const value = environment[name]?.trim();
  if (!value) {
    throw new IflytekLiveHandlerError(
      "iflytek_configuration_missing",
      `科大讯飞 Live Handler 缺少服务端配置：${name}`,
    );
  }
  return value;
}

function safeChatId(idempotencyKey: string): string {
  return createHmac("sha256", "ronggang-iflytek-chat")
    .update(idempotencyKey)
    .digest("hex")
    .slice(0, 32);
}

function formatIflytekUtc(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/u, "+0000");
}

function parseJsonText(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function recommendationFromSuggest(value: unknown): string {
  if (typeof value !== "string") return "review";
  switch (value.toLowerCase()) {
    case "pass":
    case "allow":
      return "allow";
    case "block":
    case "reject":
      return "block";
    case "review":
      return "review";
    default:
      return "review";
  }
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) {
    throw new IflytekLiveHandlerError(
      `iflytek_http_${response.status}`,
      `科大讯飞 Live Handler 返回 HTTP ${response.status}`,
    );
  }
  try {
    const value: unknown = await response.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("not-object");
    }
    return value as Record<string, unknown>;
  } catch {
    throw new IflytekLiveHandlerError(
      "iflytek_response_invalid_json",
      "科大讯飞 Live Handler 返回了无效 JSON",
    );
  }
}

export class XingchenWorkflowHandler implements IflytekCapabilityHandler {
  readonly capability = "xingchen_agent" as const;
  readonly #environment: IflytekEnvironment;
  readonly #fetch: IflytekFetch;
  readonly #resolveSourceText:
    | IflytekLiveHandlerOptions["resolveSourceText"]
    | undefined;

  constructor(options: IflytekLiveHandlerOptions) {
    this.#environment = options.environment;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#resolveSourceText = options.resolveSourceText;
  }

  async execute(
    input: CapabilityExecutionInput,
  ): Promise<CapabilityExecutionOutput> {
    const endpoint = required(
      this.#environment,
      "IFLYTEK_XINGCHEN_ENDPOINT",
    );
    const token = required(
      this.#environment,
      "IFLYTEK_XINGCHEN_TOKEN",
    );
    const flowId = required(
      this.#environment,
      "IFLYTEK_XINGCHEN_WORKFLOW_ID",
    );
    const sourceText = this.#resolveSourceText
      ? await this.#resolveSourceText(input)
      : "";
    const userInput = [
      input.prompt,
      `固定来源：${input.sourceRef}`,
      sourceText ? `材料正文：\n${sourceText.slice(0, 50_000)}` : "",
      "只返回 JSON：{\"recommendation\":\"allow|review|revise|block\",\"summary\":\"...\",\"riskLabels\":[]}",
    ].filter(Boolean).join("\n\n");
    const response = await this.#fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        flow_id: flowId,
        uid: safeChatId(input.idempotencyKey),
        parameters: {
          AGENT_USER_INPUT: userInput,
        },
        stream: false,
        chat_id: safeChatId(input.idempotencyKey),
        history: [],
      }),
      ...(input.signal ? { signal: input.signal } : {}),
    });
    const body = await responseJson(response);
    const choices = Array.isArray(body.choices) ? body.choices : [];
    const first = choices[0];
    const delta = first && typeof first === "object" && !Array.isArray(first)
      ? (first as Record<string, unknown>).delta
      : null;
    const content = delta && typeof delta === "object" && !Array.isArray(delta)
      ? (delta as Record<string, unknown>).content
      : null;
    if (typeof content !== "string" || !content.trim()) {
      throw new IflytekLiveHandlerError(
        "iflytek_xingchen_contract_mismatch",
        "讯飞星辰工作流响应缺少结构化内容",
      );
    }
    const parsed = parseJsonText(content.trim());
    const summary = typeof parsed?.summary === "string"
      ? parsed.summary
      : content.trim();
    const recommendation = typeof parsed?.recommendation === "string"
      ? parsed.recommendation
      : "review";
    const riskLabels = Array.isArray(parsed?.riskLabels)
      ? parsed.riskLabels.filter((item): item is string => (
          typeof item === "string"
        ))
      : [];
    const requestId = typeof body.request_id === "string"
      ? body.request_id
      : typeof body.sid === "string"
        ? body.sid
        : undefined;
    return {
      summary: summary.slice(0, 2_000),
      extracted: {
        recommendation,
        riskLabels,
      },
      confidence: 0.8,
      ...(requestId ? { providerRequestId: requestId } : {}),
    };
  }
}

/**
 * Adapts the Xingchen workflow endpoint to the generic structured model port.
 * Credentials stay inside the server process and the returned trace contains
 * only the provider request identifier and aggregate usage metadata.
 */
export function createXingchenModelInvocationHandler(
  options: IflytekLiveHandlerOptions,
): (request: ModelInvocationRequest) => Promise<ModelInvocationResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  return async (rawRequest) => {
    const request = ModelInvocationRequestSchema.parse(rawRequest);
    const endpoint = required(
      options.environment,
      "IFLYTEK_XINGCHEN_ENDPOINT",
    );
    const token = required(
      options.environment,
      "IFLYTEK_XINGCHEN_TOKEN",
    );
    const flowId = required(
      options.environment,
      "IFLYTEK_XINGCHEN_WORKFLOW_ID",
    );
    const startedAt = now().toISOString();
    const startedMs = performance.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs);
    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          flow_id: flowId,
          uid: safeChatId(request.invocationId),
          parameters: {
            AGENT_USER_INPUT: [
              `系统边界：\n${request.systemPrompt}`,
              `当前任务：\n${request.userPrompt}`,
              `输出契约：${request.outputContractId}`,
              "只返回满足契约的单个 JSON 对象，不要 Markdown、代码围栏、提示词复述或隐藏推理。",
            ].join("\n\n"),
          },
          stream: false,
          chat_id: safeChatId(request.invocationId),
          history: [],
        }),
        signal: controller.signal,
      });
      const body = await responseJson(response);
      const choices = Array.isArray(body.choices) ? body.choices : [];
      const first = choices[0];
      const delta = first && typeof first === "object" && !Array.isArray(first)
        ? (first as Record<string, unknown>).delta
        : null;
      const content = delta && typeof delta === "object" && !Array.isArray(delta)
        ? (delta as Record<string, unknown>).content
        : null;
      if (typeof content !== "string" || !content.trim()) {
        throw new IflytekLiveHandlerError(
          "iflytek_xingchen_contract_mismatch",
          "讯飞星辰工作流响应缺少结构化模型内容",
        );
      }
      const output = parseJsonText(content.trim());
      if (!output) {
        throw new IflytekLiveHandlerError(
          "iflytek_xingchen_contract_mismatch",
          "讯飞星辰工作流未返回严格 JSON 对象",
        );
      }
      const requestId = typeof body.request_id === "string"
        ? body.request_id
        : typeof body.sid === "string"
          ? body.sid
          : null;
      const inputTokens = Math.ceil(
        (request.systemPrompt.length + request.userPrompt.length) / 4,
      );
      const outputTokens = Math.ceil(content.length / 4);
      return ModelInvocationResultSchema.parse({
        output,
        trace: {
          invocationId: request.invocationId,
          profileId: request.profileId,
          provider: "iflytek_xingchen",
          mode: "live",
          model: "xingchen-workflow",
          requestId,
          status: "completed",
          outputMode: request.outputMode,
          finishReason: "workflow_completed",
          tokenUsage: {
            input: inputTokens,
            output: outputTokens,
            total: inputTokens + outputTokens,
          },
          latencyMs: Math.max(0, performance.now() - startedMs),
          attempts: 1,
          estimatedCostUsd: null,
          errorCode: null,
          startedAt,
          completedAt: now().toISOString(),
        },
      });
    } finally {
      clearTimeout(timeout);
    }
  };
}

export class TextModerationHandler implements IflytekCapabilityHandler {
  readonly capability = "text_moderation" as const;
  readonly #environment: IflytekEnvironment;
  readonly #fetch: IflytekFetch;
  readonly #resolveSourceText:
    | IflytekLiveHandlerOptions["resolveSourceText"]
    | undefined;
  readonly #now: () => Date;
  readonly #nextUuid: () => string;

  constructor(options: IflytekLiveHandlerOptions) {
    this.#environment = options.environment;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#resolveSourceText = options.resolveSourceText;
    this.#now = options.now ?? (() => new Date());
    this.#nextUuid = options.nextUuid ?? randomUUID;
  }

  async execute(
    input: CapabilityExecutionInput,
  ): Promise<CapabilityExecutionOutput> {
    const endpoint = required(
      this.#environment,
      "IFLYTEK_TEXT_MODERATION_ENDPOINT",
    );
    const accessKeyId = required(
      this.#environment,
      "IFLYTEK_MODERATION_API_KEY",
    );
    const accessKeySecret = required(
      this.#environment,
      "IFLYTEK_MODERATION_API_SECRET",
    );
    const appId = required(
      this.#environment,
      "IFLYTEK_MODERATION_APP_ID",
    );
    if (!this.#resolveSourceText) {
      throw new IflytekLiveHandlerError(
        "iflytek_source_resolver_missing",
        "文本合规审核缺少固定材料读取器",
      );
    }
    const content = (await this.#resolveSourceText(input)).trim();
    if (!content) {
      throw new IflytekLiveHandlerError(
        "iflytek_source_empty",
        "文本合规审核固定材料为空",
      );
    }
    const auth = {
      accessKeyId,
      accessKeySecret,
      appId,
      utc: formatIflytekUtc(this.#now()),
      uuid: this.#nextUuid(),
    };
    const canonical = Object.entries(auth)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => (
        `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
      ))
      .join("&");
    const signature = createHmac("sha1", accessKeySecret)
      .update(canonical)
      .digest("base64");
    const url = new URL(endpoint);
    for (const [key, value] of Object.entries(auth)) {
      url.searchParams.set(key, value);
    }
    url.searchParams.set("signature", signature);
    const response = await this.#fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        is_match_all: 1,
        content: content.slice(0, 5_000),
        categories: [
          "pornDetection",
          "violentTerrorism",
          "political",
          "lowQualityIrrigation",
          "contraband",
          "advertisement",
          "uncivilizedLanguage",
        ],
      }),
      ...(input.signal ? { signal: input.signal } : {}),
    });
    const body = await responseJson(response);
    if (body.code !== "000000") {
      throw new IflytekLiveHandlerError(
        "iflytek_text_moderation_rejected",
        `讯飞文本合规审核返回业务错误码 ${String(body.code ?? "missing")}`,
      );
    }
    const data = body.data && typeof body.data === "object"
      && !Array.isArray(body.data)
      ? body.data as Record<string, unknown>
      : {};
    const result = data.result && typeof data.result === "object"
      && !Array.isArray(data.result)
      ? data.result as Record<string, unknown>
      : {};
    const recommendation = recommendationFromSuggest(result.suggest);
    const detail = result.detail && typeof result.detail === "object"
      && !Array.isArray(result.detail)
      ? result.detail as Record<string, unknown>
      : {};
    const categoryItems = Array.isArray(detail.category_list)
      ? detail.category_list
      : [];
    const riskLabels = categoryItems
      .map((item) => (
        item && typeof item === "object" && !Array.isArray(item)
          ? String((item as Record<string, unknown>).category ?? "")
          : ""
      ))
      .filter(Boolean);
    const categoryConfidences = categoryItems
      .map((item) => (
        item && typeof item === "object" && !Array.isArray(item)
          ? (item as Record<string, unknown>).confidence
          : null
      ))
      .filter((value): value is number => (
        typeof value === "number"
        && Number.isFinite(value)
      ));
    const requestId = typeof data.request_id === "string"
      ? data.request_id
      : typeof body.sid === "string"
        ? body.sid
        : undefined;
    return {
      summary: recommendation === "allow"
        ? "讯飞文本合规审核未发现阻断项；结果仍需进入治理教师门。"
        : `讯飞文本合规审核建议 ${recommendation}；结果仍需进入治理教师门。`,
      extracted: {
        recommendation,
        riskLabels,
        suggest: result.suggest ?? "review",
      },
      confidence: categoryConfidences.length > 0
        ? Math.max(...categoryConfidences) / 100
        : recommendation === "allow" ? 1 : 0.85,
      ...(requestId ? { providerRequestId: requestId } : {}),
    };
  }
}

export function createIflytekLiveHandlers(
  options: IflytekLiveHandlerOptions,
): IflytekCapabilityHandler[] {
  return [
    new XingchenWorkflowHandler(options),
    new TextModerationHandler(options),
  ];
}
