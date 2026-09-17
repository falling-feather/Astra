import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  ModelInvocationRequestSchema,
  type ModelInvocationRequest,
} from "@ronggang/contracts";
import {
  DeterministicModelProvider,
  ModelInvocationError,
  OpenAiCompatibleModelProvider,
} from "../src/index.js";

function request(overrides: Partial<ModelInvocationRequest> = {}): ModelInvocationRequest {
  return ModelInvocationRequestSchema.parse({
    invocationId: "invoke-fact-checker-1",
    profileId: "deepseek-test",
    taskKind: "fact_checker",
    systemPrompt: "只返回 JSON。",
    userPrompt: "请返回 {\"ok\":true}。",
    outputContractId: "fact-checker-output/v1",
    outputMode: "json_object",
    temperature: 0,
    maxOutputTokens: 256,
    timeoutMs: 100,
    ...overrides,
  });
}

function successResponse(
  content = "{\"ok\":true}",
  finishReason = "stop",
): Response {
  return new Response(JSON.stringify({
    id: "chatcmpl-test",
    model: "deepseek-v4-flash",
    choices: [{
      finish_reason: finishReason,
      message: { content },
    }],
    usage: {
      prompt_tokens: 24,
      completion_tokens: 8,
      total_tokens: 32,
    },
  }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "x-request-id": "provider-request-1",
    },
  });
}

describe("model gateway providers", () => {
  it("normalizes an OpenAI-compatible JSON response without exposing credentials", async () => {
    let authorization = "";
    const fetchImpl = (async (_input: URL | RequestInfo, init?: RequestInit) => {
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      return successResponse();
    }) as typeof fetch;
    const provider = new OpenAiCompatibleModelProvider({
      profileId: "deepseek-test",
      baseUrl: "https://api.deepseek.com",
      apiKey: "test-secret-key",
      model: "deepseek-v4-flash",
      fetchImpl,
      sleep: async () => undefined,
    });

    const result = await provider.invoke(request());

    expect(authorization).toBe("Bearer test-secret-key");
    expect(result.output).toEqual({ ok: true });
    expect(result.trace.provider).toBe("deepseek");
    expect(result.trace.requestId).toBe("provider-request-1");
    expect(result.trace.tokenUsage.total).toBe(32);
    expect(JSON.stringify(provider.health())).not.toContain("test-secret-key");
  });

  it("sends hash-verified local images as bounded user content blocks", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    let bodyText = "";
    const fetchImpl = (async (_input: URL | RequestInfo, init?: RequestInit) => {
      bodyText = String(init?.body);
      return successResponse();
    }) as typeof fetch;
    const provider = new OpenAiCompatibleModelProvider({
      profileId: "deepseek-vision-test",
      baseUrl: "https://api.deepseek.com",
      apiKey: "test-key",
      model: "deepseek-v4-flash-vision-exp",
      fetchImpl,
    });

    await provider.invoke(request({
      imageInputs: [{
        inputRef: "media-input-preview-1",
        sourceContentHash: "a".repeat(64),
        representationContentHash: createHash("sha256").update(png).digest("hex"),
        mimeType: "image/png",
        contentBase64: png.toString("base64"),
        detail: "low",
      }],
    }));

    const body = JSON.parse(bodyText) as {
      messages: Array<{ role: string; content: unknown }>;
      thinking: { type: string };
    };
    const messages = body.messages;
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(messages[1]?.content).toEqual([
      { type: "text", text: "请返回 {\"ok\":true}。" },
      {
        type: "image_url",
        image_url: {
          url: `data:image/png;base64,${png.toString("base64")}`,
          detail: "low",
        },
      },
    ]);
  });

  it("rejects forged image bytes before any provider request", async () => {
    const fetchImpl = vi.fn(async () => successResponse()) as typeof fetch;
    const provider = new OpenAiCompatibleModelProvider({
      profileId: "deepseek-vision-test",
      baseUrl: "https://api.deepseek.com",
      apiKey: "test-key",
      model: "deepseek-v4-flash-vision-exp",
      fetchImpl,
    });
    const failure = await provider.invoke(request({
      imageInputs: [{
        inputRef: "media-input-preview-forged",
        sourceContentHash: "a".repeat(64),
        representationContentHash: "b".repeat(64),
        mimeType: "image/png",
        contentBase64: "iVBORw0KGgo=",
        detail: "low",
      }],
    })).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ModelInvocationError);
    expect((failure as ModelInvocationError).code).toBe("model_image_input_invalid");
    expect((failure as ModelInvocationError).trace.attempts).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("retries a rate limit once and records the attempt count", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return calls === 1
        ? new Response("{\"error\":\"rate limited\"}", { status: 429 })
        : successResponse();
    }) as typeof fetch;
    const provider = new OpenAiCompatibleModelProvider({
      profileId: "deepseek-test",
      baseUrl: "https://api.deepseek.com",
      apiKey: "test-key",
      model: "deepseek-v4-flash",
      maxRetries: 1,
      fetchImpl,
      sleep: async () => undefined,
    });

    const result = await provider.invoke(request());

    expect(calls).toBe(2);
    expect(result.trace.attempts).toBe(2);
  });

  it("returns a sanitized failed trace for invalid model JSON", async () => {
    const provider = new OpenAiCompatibleModelProvider({
      profileId: "deepseek-test",
      baseUrl: "https://api.deepseek.com",
      apiKey: "test-key",
      model: "deepseek-v4-flash",
      fetchImpl: (async () => successResponse("not-json")) as typeof fetch,
      sleep: async () => undefined,
    });

    const failure = await provider.invoke(request()).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ModelInvocationError);
    expect((failure as ModelInvocationError).code).toBe("model_invalid_json");
    expect((failure as ModelInvocationError).trace.status).toBe("failed");
    expect((failure as ModelInvocationError).message).not.toContain("test-key");
  });

  it("rejects an empty JSON-mode response without retrying it", async () => {
    let calls = 0;
    const provider = new OpenAiCompatibleModelProvider({
      profileId: "deepseek-test",
      baseUrl: "https://api.deepseek.com",
      apiKey: "test-key",
      model: "deepseek-v4-flash",
      maxRetries: 2,
      fetchImpl: (async () => {
        calls += 1;
        return successResponse("   ");
      }) as typeof fetch,
      sleep: async () => undefined,
    });

    const failure = await provider.invoke(request()).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ModelInvocationError);
    expect((failure as ModelInvocationError).code).toBe("model_empty_content");
    expect((failure as ModelInvocationError).trace.attempts).toBe(1);
    expect(calls).toBe(1);
  });

  it("rejects a length-truncated response before parsing partial JSON", async () => {
    const provider = new OpenAiCompatibleModelProvider({
      profileId: "deepseek-test",
      baseUrl: "https://api.deepseek.com",
      apiKey: "test-key",
      model: "deepseek-v4-flash",
      fetchImpl: (async () => successResponse("{\"ok\":", "length")) as typeof fetch,
      sleep: async () => undefined,
    });

    const failure = await provider.invoke(request()).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ModelInvocationError);
    expect((failure as ModelInvocationError).code).toBe("model_output_truncated");
    expect((failure as ModelInvocationError).trace.finishReason).toBe("length");
    expect((failure as ModelInvocationError).trace.tokenUsage).toEqual({
      input: 24,
      output: 8,
      total: 32,
    });
  });

  it("aborts the underlying request when the timeout expires", async () => {
    const fetchImpl = ((_input: URL | RequestInfo, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    })) as typeof fetch;
    const provider = new OpenAiCompatibleModelProvider({
      profileId: "deepseek-test",
      baseUrl: "https://api.deepseek.com",
      apiKey: "test-key",
      model: "deepseek-v4-flash",
      maxRetries: 0,
      fetchImpl,
    });

    const failure = await provider.invoke(request({ timeoutMs: 5 })).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ModelInvocationError);
    expect((failure as ModelInvocationError).code).toBe("model_timeout");
  });

  it("honors the caller's one-attempt reservation even when provider retries are enabled", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("unavailable", { status: 503 }));
    const provider = new OpenAiCompatibleModelProvider({ profileId: "deepseek-test", baseUrl: "https://api.deepseek.com", apiKey: "test-key", model: "deepseek-v4-flash", maxRetries: 2, fetchImpl });
    await expect(provider.invoke(request(), { maximumAttempts: 1 })).rejects.toMatchObject({ trace: { attempts: 1 } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("cancels a request from the owning workflow and never retries after cancellation", async () => {
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation((_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      started();
    }));
    const provider = new OpenAiCompatibleModelProvider({ profileId: "deepseek-test", baseUrl: "https://api.deepseek.com", apiKey: "test-key", model: "deepseek-v4-flash", maxRetries: 2, fetchImpl });
    const controller = new AbortController();
    const outcome = provider.invoke(request({ timeoutMs: 1000 }), { signal: controller.signal }).catch(error => error);
    await ready;
    controller.abort();
    expect(await outcome).toMatchObject({ code: "model_cancelled", trace: { attempts: 1 } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await expect(provider.invoke(request(), { signal: controller.signal })).rejects.toMatchObject({ code: "model_cancelled", trace: { attempts: 0 } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("treats timeout as one total invocation budget instead of one budget per retry", async () => {
    let calls = 0;
    const fetchImpl = ((_input: URL | RequestInfo, init?: RequestInit) => {
      calls += 1;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
          { once: true },
        );
      });
    }) as typeof fetch;
    const provider = new OpenAiCompatibleModelProvider({
      profileId: "deepseek-test",
      baseUrl: "https://api.deepseek.com",
      apiKey: "test-key",
      model: "deepseek-v4-flash",
      maxRetries: 2,
      fetchImpl,
    });
    const startedAt = performance.now();

    const failure = await provider.invoke(request({ timeoutMs: 25 })).catch((error: unknown) => error);
    const elapsedMs = performance.now() - startedAt;

    expect(failure).toBeInstanceOf(ModelInvocationError);
    expect((failure as ModelInvocationError).code).toBe("model_timeout");
    expect((failure as ModelInvocationError).trace.attempts).toBe(1);
    expect(calls).toBe(1);
    expect(elapsedMs).toBeLessThan(250);
  });

  it("provides a deterministic offline implementation of the same contract", async () => {
    const provider = new DeterministicModelProvider({
      resolver: () => ({ ok: true }),
      clock: () => "2026-07-25T01:00:00.000Z",
    });

    const result = await provider.invoke(request({ profileId: "offline-test" }));

    expect(result.output).toEqual({ ok: true });
    expect(result.trace.mode).toBe("mock");
    expect(result.trace.estimatedCostUsd).toBe(0);
  });
});
