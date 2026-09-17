import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import {
  IflytekAdapterConfigurationError,
  TextModerationHandler,
  UnifiedIflytekAdapter,
  XingchenWorkflowHandler,
  createXingchenModelInvocationHandler,
} from "../src/index.js";

const material = {
  materialId: "material-festival-photo",
  title: "水乡非遗市集现场图",
  mediaType: "image" as const,
  source: "现场记者回传",
  sourceRef: "/assets/地方文旅活动现场.png",
  version: "raw-1",
  copyrightStatus: "unknown" as const,
  visibleToRoles: ["responsible_editor" as const],
};

describe("UnifiedIflytekAdapter", () => {
  it("runs every capability in safe mock mode without credentials", async () => {
    const adapter = new UnifiedIflytekAdapter({ mode: "mock", environment: {} });
    const health = adapter.health();
    expect(health.mode).toBe("mock");
    expect(health.capabilities.every((item) => item.available)).toBe(true);
    expect(health.capabilities.every((item) => !item.configured)).toBe(true);

    const observation = await adapter.observeMaterial({
      sessionId: "session-demo",
      sceneId: "scene-demo",
      actorId: "student-editor",
      correlationId: "test-observe",
      material,
    });
    expect(observation.provider).toBe("iflytek:image_understanding");
    expect(observation.providerMode).toBe("mock");
    expect(observation.sourceRef).toBe(material.sourceRef);
  });

  it("refuses live execution until the capability-specific signer is registered", async () => {
    const adapter = new UnifiedIflytekAdapter({ mode: "live", environment: {} });
    await expect(adapter.observeMaterial({
      sessionId: "session-demo",
      sceneId: "scene-demo",
      actorId: "student-editor",
      correlationId: "test-live",
      material,
    })).rejects.toBeInstanceOf(IflytekAdapterConfigurationError);
  });

  it("requires endpoint, credentials, and handler to agree before reporting live output", async () => {
    let calls = 0;
    const handler = {
      capability: "image_understanding" as const,
      async execute(input: { idempotencyKey: string }) {
        calls += 1;
        return {
          summary: `live:${input.idempotencyKey}`,
          extracted: { safe: true },
          confidence: 0.91,
          providerRequestId: "provider-live-1",
        };
      },
    };
    const incomplete = new UnifiedIflytekAdapter({
      mode: "live",
      environment: {},
      handlers: [handler],
    });
    await expect(incomplete.executeCapability({
      capability: "image_understanding",
      sourceRef: "object://session/hash",
      mediaType: "image",
      prompt: "describe",
      idempotencyKey: "live-1",
      metadata: {},
    })).rejects.toBeInstanceOf(IflytekAdapterConfigurationError);
    expect(calls).toBe(0);

    const ready = new UnifiedIflytekAdapter({
      mode: "live",
      environment: {
        IFLYTEK_IMAGE_ENDPOINT: "https://example.invalid/image",
        IFLYTEK_IMAGE_APP_ID: "test-app",
        IFLYTEK_IMAGE_API_KEY: "test-key",
        IFLYTEK_IMAGE_API_SECRET: "test-secret",
      },
      handlers: [handler],
    });
    expect(ready.health().capabilities.find((item) => (
      item.capability === "image_understanding"
    ))).toMatchObject({ available: true, configured: true });
    await expect(ready.executeCapability({
      capability: "image_understanding",
      sourceRef: "object://session/hash",
      mediaType: "image",
      prompt: "describe",
      idempotencyKey: "live-2",
      metadata: {},
    })).resolves.toMatchObject({
      summary: "live:live-2",
      providerRequestId: "provider-live-1",
    });
    expect(calls).toBe(1);
  });

  it("uses the official Xingchen workflow request shape and parses structured output", async () => {
    let requestInit: RequestInit | undefined;
    const handler = new XingchenWorkflowHandler({
      environment: {
        IFLYTEK_XINGCHEN_ENDPOINT: "https://xingchen.example/workflow/v1/chat/completions",
        IFLYTEK_XINGCHEN_TOKEN: "test-key:test-secret",
        IFLYTEK_XINGCHEN_WORKFLOW_ID: "flow-1",
      },
      resolveSourceText: async () => "固定材料正文",
      fetchImpl: async (_input, init) => {
        requestInit = init;
        return new Response(JSON.stringify({
          request_id: "xingchen-request-1",
          choices: [{
            delta: {
              content: JSON.stringify({
                recommendation: "revise",
                summary: "授权用途需要补充",
                riskLabels: ["copyright_scope"],
              }),
            },
          }],
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    });
    const controller = new AbortController();
    const output = await handler.execute({
      sourceRef: "object://session/hash",
      mediaType: "text",
      prompt: "检查版权范围",
      idempotencyKey: "governance-idempotency-1",
      metadata: { governanceDomain: "copyright" },
      timeoutMs: 5_000,
      signal: controller.signal,
    });
    expect(requestInit?.headers).toMatchObject({
      Authorization: "Bearer test-key:test-secret",
      "Content-Type": "application/json",
    });
    const body = JSON.parse(String(requestInit?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      flow_id: "flow-1",
      stream: false,
      history: [],
    });
    expect(String(body.chat_id)).toMatch(/^[a-f0-9]{32}$/u);
    expect(output).toMatchObject({
      summary: "授权用途需要补充",
      extracted: {
        recommendation: "revise",
        riskLabels: ["copyright_scope"],
      },
      providerRequestId: "xingchen-request-1",
    });
  });

  it("backs the generic model gateway with a truthful Xingchen live trace", async () => {
    let requestBody: Record<string, unknown> | null = null;
    const handler = createXingchenModelInvocationHandler({
      environment: {
        IFLYTEK_XINGCHEN_ENDPOINT: "https://xingchen.example/workflow/v1/chat/completions",
        IFLYTEK_XINGCHEN_TOKEN: "server-only-token",
        IFLYTEK_XINGCHEN_WORKFLOW_ID: "flow-model-1",
      },
      now: () => new Date("2026-08-09T08:40:00.000Z"),
      fetchImpl: async (_input, init) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({
          request_id: "xingchen-model-request-1",
          choices: [{
            delta: {
              content: JSON.stringify({
                recommendation: "request_evidence",
                summary: "先补齐来源年份与统计口径。",
              }),
            },
          }],
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    });

    const result = await handler({
      invocationId: "invoke-xunpu-1",
      profileId: "xingchen-v2",
      taskKind: "course.advice",
      systemPrompt: "只处理当前课程公开来源。",
      userPrompt: "判断热门数字是否需要补证。",
      outputContractId: "xunpu-advice/2.0.0",
      outputMode: "json_object",
      temperature: 0,
      maxOutputTokens: 500,
      timeoutMs: 5_000,
    });

    expect(requestBody).toMatchObject({
      flow_id: "flow-model-1",
      stream: false,
      history: [],
    });
    expect(result).toMatchObject({
      output: { recommendation: "request_evidence" },
      trace: {
        provider: "iflytek_xingchen",
        mode: "live",
        requestId: "xingchen-model-request-1",
        status: "completed",
      },
    });
    expect(JSON.stringify(result)).not.toContain("server-only-token");
  });

  it("signs the official text moderation query deterministically without returning credentials", async () => {
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    const now = new Date("2026-07-25T08:00:00.000Z");
    const handler = new TextModerationHandler({
      environment: {
        IFLYTEK_TEXT_MODERATION_ENDPOINT: "https://audit.example/audit/v2/syncText",
        IFLYTEK_MODERATION_APP_ID: "app-1",
        IFLYTEK_MODERATION_API_KEY: "access-key-1",
        IFLYTEK_MODERATION_API_SECRET: "access-secret-1",
      },
      now: () => now,
      nextUuid: () => "uuid-1",
      resolveSourceText: async () => "待审核的固定材料文本",
      fetchImpl: async (input, init) => {
        requestUrl = String(input);
        requestInit = init;
        return new Response(JSON.stringify({
          code: "000000",
          sid: "moderation-session-1",
          data: {
            request_id: "moderation-request-1",
            result: {
              suggest: "block",
              detail: {
                content: "待审核的固定材料文本",
                category_list: [{
                  category: "advertisement",
                  confidence: 87,
                  suggest: "block",
                  category_description: "广告导流",
                  word_list: [],
                }],
              },
            },
          },
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    });
    const output = await handler.execute({
      sourceRef: "object://session/hash",
      mediaType: "text",
      prompt: "检查内容安全",
      idempotencyKey: "moderation-idempotency-1",
      metadata: { governanceDomain: "content_safety" },
    });
    const auth = {
      accessKeyId: "access-key-1",
      accessKeySecret: "access-secret-1",
      appId: "app-1",
      utc: "2026-07-25T08:00:00+0000",
      uuid: "uuid-1",
    };
    const canonical = Object.entries(auth)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => (
        `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
      ))
      .join("&");
    const signature = createHmac("sha1", "access-secret-1")
      .update(canonical)
      .digest("base64");
    const signedUrl = new URL(requestUrl);
    expect(signedUrl.searchParams.get("utc")).toBe(
      "2026-07-25T08:00:00+0000",
    );
    expect(signedUrl.searchParams.get("signature")).toBe(signature);
    expect(JSON.parse(String(requestInit?.body))).toMatchObject({
      is_match_all: 1,
      content: "待审核的固定材料文本",
    });
    expect(output).toMatchObject({
      extracted: {
        recommendation: "block",
        riskLabels: ["advertisement"],
      },
      confidence: 0.87,
      providerRequestId: "moderation-request-1",
    });
    expect(JSON.stringify(output)).not.toContain("access-secret-1");
  });
});
