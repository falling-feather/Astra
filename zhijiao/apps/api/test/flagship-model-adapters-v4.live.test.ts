import { describe, expect, it } from "vitest";
import { createFlagshipGatewayModelsV4 } from "../src/flagship-model-adapters-v4.js";
import { createModelIntegration } from "../src/model-integration.js";

const liveEnabled = process.env.DEEPSEEK_LIVE_SMOKE === "1"
  && Boolean(process.env.DEEPSEEK_API_KEY);

describe.runIf(liveEnabled)("AI-022 DeepSeek flagship adapter opt-in smoke", () => {
  it("selects one of the server-issued dialogue rules through the real gateway", async () => {
    const integration = createModelIntegration({
      environment: {
        MODEL_PROVIDER: "deepseek",
        MODEL_PROFILE_ID: "flagship-dialogue-live-smoke",
        MODEL_TIMEOUT_MS: "30000",
        MODEL_MAX_RETRIES: "0",
        DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
        DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL,
        DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash",
        DEEPSEEK_VISION_MODEL: process.env.DEEPSEEK_VISION_MODEL
          ?? "deepseek-v4-flash-vision-exp",
      },
    });
    const models = createFlagshipGatewayModelsV4({
      provider: integration.provider,
      ...(integration.visionProvider
        ? { visionProvider: integration.visionProvider }
        : {}),
      timeoutMs: 30_000,
    });
    const candidates = [
      {
        ruleRef: "rule-live-safe-public-observation",
        priority: 90,
        outcome: "resolved" as const,
        npcAct: "commit" as const,
        npcStance: "cooperative" as const,
        publicText: "身份、课堂用途和公共区域边界均已说明，可以先观察巷口。",
        nextPrompt: null,
        routeRef: "route-public-observation",
      },
      {
        ruleRef: "rule-live-clarify-boundary",
        priority: 50,
        outcome: "clarification" as const,
        npcAct: "clarify" as const,
        npcStance: "guarded" as const,
        publicText: "还需要说明用途与拍摄范围。",
        nextPrompt: "你准备在哪里拍摄？",
        routeRef: null,
      },
    ];
    const result = await models.dialogueSelector.select({
      episodeId: "dialogue-live-smoke",
      definitionRef: "dialogue-scene-live-smoke",
      turnNumber: 2,
      utterance: "我是课堂融媒体记者，只在巷口公共区域观察，不进入私人院落。",
      intent: "introduce_scope",
      matchedSignalRefs: ["signal-identity", "signal-purpose", "signal-public-area"],
      issues: [
        {
          issueRef: "issue-identity-purpose",
          publicLabel: "身份与用途",
          status: "satisfied",
          lastReason: "学生说明课堂记者身份与用途。",
        },
        {
          issueRef: "issue-space-boundary",
          publicLabel: "空间边界",
          status: "satisfied",
          lastReason: "学生承诺只观察公共区域。",
        },
      ],
      publicHistory: [],
      candidates,
    });

    expect(candidates.map((candidate) => candidate.ruleRef))
      .toContain(result.selectedRuleRef);
    expect(result.modelRunRef).toMatch(/^model-trace-[a-f0-9]{32}$/u);
    expect(result.costMicros).toBeGreaterThan(0);
  }, 45_000);
});
