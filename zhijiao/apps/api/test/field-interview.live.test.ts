import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { xunpuExplorationLesson, xunpuFlagshipContentV4 } from "@ronggang/course-content";
import { createModelIntegration } from "../src/model-integration.js";
import { GatewayFieldInterviewModel } from "../src/flagship-model-adapters-v4.js";

const enabled = process.env.FIELD_INTERVIEW_LIVE_SMOKE === "1";
if (enabled) {
  try { process.loadEnvFile(fileURLToPath(new URL("../../../.env.local", import.meta.url))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}

describe.runIf(enabled && Boolean(process.env.DEEPSEEK_API_KEY))("opt-in field dialogue real model smoke", () => {
  it("answers three ordinary professional questions with the correct character's knowledge", async () => {
    const integration = createModelIntegration({ environment: {
      MODEL_PROVIDER: "deepseek", MODEL_PROFILE_ID: "field-interview-live-smoke", MODEL_MAX_RETRIES: "0", MODEL_TIMEOUT_MS: "10000",
      DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL,
      DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash",
    } });
    const model = new GatewayFieldInterviewModel({ provider: integration.provider, timeoutMs: 10_000 });
    const cases = [
      { npcId: "entity-gatekeeper", text: "我先不进小院，打算看看公示栏和沿街店铺，但选题还没想好。你觉得可以先留意什么？" },
      { npcId: "entity-researcher", text: "我怕把旧报道的日期当成全年数据。比较原文和转引时，具体要核对哪几项？" },
      { npcId: "entity-shopkeeper", text: "先不谈样片合作，我想听听你平时怎样回应游客的服务需求。" },
    ];
    const observations: Array<Record<string, unknown>> = [];
    try {
      for (const item of cases) {
        const person = xunpuExplorationLesson.people.find(person => person.id === item.npcId)!;
        const original = xunpuFlagshipContentV4.cast.find(person => person.entityId === item.npcId)!;
        const started = Date.now();
        const result = await model.decide({
          person: { id: person.id, name: person.name, role: person.role, activity: person.activity, goal: person.goal, unknown: person.unknown, topics: person.topics },
          professionalContext: { publicGoal: original.publicGoal, privatePressure: original.privatePressure, refusalConditions: original.refusalConditions, recoveryConditions: original.recoveryConditions, disclosureRules: original.disclosureRules },
          utterance: item.text, history: [], choices: xunpuExplorationLesson.choices.filter(choice => choice.npcId === person.id && !choice.requires.length).map(choice => ({ id: choice.id, label: choice.label, effect: choice.effect })),
          pendingChoiceId: null, context: { presence: "present", virtualMinute: 0, recentMessages: [], commitments: [], proactiveCue: null }, evidence: [],
        });
        observations.push({ npcId: item.npcId, utterance: item.text, elapsedMs: Date.now() - started, ...result });
        expect(result.decision.kind).toBe("question");
        expect(person.topics.some(topic => topic.id === result.decision.topicId)).toBe(true);
        expect(result.decision.reply?.length).toBeGreaterThan(10);
        expect(result.decision.citedTopicIds).toContain(result.decision.topicId);
        expect(result.traceRef).toMatch(/^model-trace-/u);
      }
    } finally {
      const directory = fileURLToPath(new URL("../../../.local/open-interview-20260911/", import.meta.url));
      await mkdir(directory, { recursive: true });
      await writeFile(new URL("../../../.local/open-interview-20260911/live-model-smoke.json", import.meta.url), JSON.stringify({ capturedAt: new Date().toISOString(), maximumCalls: 3, observations }, null, 2) + "\n", "utf8");
      console.log(JSON.stringify({ liveFieldCalls: observations.length, costMicros: observations.map(item => item.costMicros), traces: observations.map(item => item.traceRef) }));
    }
  }, 60_000);
});
