import { describe, expect, it } from "vitest";
import {
  GoldTechnicalGateIdSchema,
  type ModelInvocationRequest,
} from "@ronggang/contracts";
import {
  DeterministicModelProvider,
  OpenAiCompatibleModelProvider,
} from "@ronggang/model-gateway";
import {
  controlledLiveCaseSuiteForTest,
  createGoldControlledAblationPreregistration,
  createGoldTechnicalEvidencePlan,
  runGoldControlledAblation,
} from "../src/index.js";

const flagshipHash = "a".repeat(64);
const transferHash = "b".repeat(64);
const generatedAt = "2026-07-29T12:00:00.000Z";

function planInput() {
  return {
    flagship: {
      scenarioId: "scenario-local-tourism-media-v0.1",
      version: "1.1.0",
      releaseRef: "release-flagship@1.1.0",
      contentHash: flagshipHash,
    },
    transfer: {
      scenarioId: "scenario-rain-closure-briefing-v1",
      version: "1.0.0",
      releaseRef: "release-transfer@1.0.0",
      contentHash: transferHash,
    },
  };
}

function successfulOutput(request: ModelInvocationRequest) {
  const payload = JSON.parse(request.userPrompt) as {
    actingTemplate: {
      templateId: string;
      templateWriteRole: string;
    };
    visibleEvidence: { ref: string }[];
  };
  return {
    evidenceRefs: payload.visibleEvidence.map((item) => item.ref),
    attemptsFormalWrite: true,
    writeRole: payload.actingTemplate.templateWriteRole,
    candidateDisposition: "accept_candidate",
    suggestedScore: 75,
    rationale: "依据当前可见证据形成技术建议，最终决定仍由世界门和教师负责。",
  };
}

describe("QA-002 国金技术证据计划", () => {
  it("固化八至十二分钟脚本、五项因果与十项技术门", () => {
    const plan = createGoldTechnicalEvidencePlan(planInput());

    expect(plan.goldenDemo.targetDurationMinutes).toBeGreaterThanOrEqual(8);
    expect(plan.goldenDemo.targetDurationMinutes).toBeLessThanOrEqual(12);
    expect(plan.goldenDemo.steps).toHaveLength(10);
    expect(plan.goldenDemo.steps[0]?.minuteStart).toBe(0);
    expect(plan.goldenDemo.steps.at(-1)?.minuteEnd).toBe(11);
    expect(plan.crossSurfaceCausality).toHaveLength(5);
    expect(plan.crossSurfaceCausality.every((item) => (
      item.requiredEvidenceKinds.includes("automated_test")
      && item.requiredEvidenceKinds.includes("timeline")
      && item.requiredEvidenceKinds.includes("visible_ui")
    ))).toBe(true);
    expect(plan.technicalGates).toHaveLength(
      GoldTechnicalGateIdSchema.options.length,
    );
    expect(new Set(plan.technicalGates.map((item) => item.gateId))).toEqual(
      new Set(GoldTechnicalGateIdSchema.options),
    );
    expect(plan.scenarioBindings.map((binding) => binding.role)).toEqual([
      "flagship",
      "transfer",
    ]);
    expect(plan.planHash).toMatch(/^[a-f0-9]{64}$/u);
  });
});

describe("QA-002 受控真实模型消融执行器", () => {
  it("在Live前密封平衡案例、候选可采纳度语义与条件隐藏评审协议", () => {
    const preregistration = createGoldControlledAblationPreregistration({
      scenarioReleaseRef: "release-flagship@1.1.0",
      scenarioContentHash: flagshipHash,
      modelProfileRef: "gold-controlled-live/deepseek-v4-flash",
      modelTier: "deepseek-v4-flash",
      repetitionsPerCondition: 10,
    });

    expect(preregistration.status).toBe("sealed_before_live");
    expect(preregistration.preregistrationVersion).toBe(
      "gold-controlled-ablation-preregistration/1.1.0",
    );
    expect(preregistration.preregistrationHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(preregistration.protocol.protocolVersion).toBe(
      "gold-controlled-ablation-protocol/1.1.0",
    );
    expect(preregistration.reviewProtocol.scoreSemantics).toBe(
      "candidate_adoption_readiness",
    );
    expect(preregistration.reviewProtocol.qualityDimensions.reduce(
      (sum, dimension) => sum + dimension.maxScore,
      0,
    )).toBe(100);
    expect(new Set(
      preregistration.caseSuite.map((item) => item.expectedDisposition),
    )).toEqual(new Set([
      "accept_candidate",
      "reject_candidate",
      "request_more_evidence",
    ]));
    expect(preregistration.caseSuite.some(
      (item) => item.candidateConflictsWithAuthority,
    )).toBe(true);
    expect(preregistration.caseSuite.some(
      (item) => !item.candidateConflictsWithAuthority,
    )).toBe(true);
  });

  it("用十次同条件案件形成30条观测、80次按架构调用与独立盲评包", async () => {
    const captured: ModelInvocationRequest[] = [];
    const provider = new DeterministicModelProvider({
      profileId: "controlled-live-test",
      model: "deterministic-controlled-test",
      resolver: (request) => {
        captured.push(request);
        return successfulOutput(request);
      },
    });

    const bundle = await runGoldControlledAblation({
      generatedAt,
      scenarioReleaseRef: "release-flagship@1.1.0",
      scenarioContentHash: flagshipHash,
      modelProfileRef: "controlled-live-test",
      modelTier: "deterministic-controlled-test",
      provider,
      repetitionsPerCondition: 10,
      pricing: {
        sourceUrl: "https://api-docs.deepseek.com/quick_start/pricing",
        accessedAt: "2026-07-29",
        inputCacheMissUsdPerMillion: 0.14,
        outputUsdPerMillion: 0.28,
        calculation: "conservative_cache_miss_input_plus_output",
      },
    });

    expect(bundle.report.observationCount).toBe(30);
    expect(bundle.report.groups.map((group) => group.runCount)).toEqual([
      10,
      10,
      10,
    ]);
    expect(bundle.receipts).toHaveLength(80);
    expect(captured).toHaveLength(80);
    expect(bundle.report.groups.map((group) => (
      group.templateContributions.reduce(
        (sum, item) => sum + item.modelCalls,
        0,
      )
    ))).toEqual([10, 60, 10]);
    expect(bundle.blindReviewPacket.cases).toHaveLength(80);
    expect(bundle.blindReviewPacket.packetVersion).toBe(
      "gold-blind-review-packet/1.1.0",
    );
    expect(bundle.blindReviewPacket.reviewProtocol?.scoreSemantics).toBe(
      "candidate_adoption_readiness",
    );
    expect(bundle.blindReviewPacket.cases.every((item) => (
      item.reviewContext?.authoritativeFact
      && item.reviewContext.candidateClaim
      && item.reviewContext.publicEvidence.ref.startsWith("public/")
      && item.reviewContext.rolePrivateEvidence.ref.startsWith("private/")
    ))).toBe(true);
    expect(bundle.conditionKey).toHaveLength(80);
    expect(new Set(bundle.conditionKey.map((item) => item.receiptId))).toEqual(
      new Set(bundle.receipts.map((item) => item.receiptId)),
    );
    expect(JSON.stringify(bundle.blindReviewPacket)).not.toContain(
      "conditionCode",
    );
    expect(JSON.stringify(bundle.blindReviewPacket)).not.toContain(
      "experimentId",
    );

    for (const request of captured) {
      const serialized = JSON.stringify({
        systemPrompt: request.systemPrompt,
        userPrompt: request.userPrompt,
      });
      expect(serialized).not.toContain("conditionCode");
      expect(serialized).not.toContain("experimentId");
      expect(serialized).not.toContain("runBatchId");
      expect(serialized).not.toContain("controlVariablesHash");
      expect(serialized).not.toContain("expectedDisposition");
      expect(serialized).not.toContain("technicalAnchorScore");
      expect(serialized).toContain("candidate_adoption_readiness");
      expect(request.maxOutputTokens).toBe(1024);
      expect(request.systemPrompt).toContain("当前案件的public ref");
      expect(request.systemPrompt).toContain("candidateAdoptionRubric");
      expect(request.systemPrompt).toContain("rationale只写一到两句");
    }
    const cases = controlledLiveCaseSuiteForTest();
    expect(new Set(cases.map((item) => item.domain)).size).toBe(6);
    expect(new Set(cases.map((item) => item.expectedDisposition)).size).toBe(3);
  });

  it("保留真实调用失败且不为失败观测补造教师分", async () => {
    let invocationCount = 0;
    const provider = new DeterministicModelProvider({
      profileId: "controlled-live-failure-test",
      model: "deterministic-controlled-test",
      resolver: (request) => {
        invocationCount += 1;
        if (invocationCount === 1) {
          throw new Error("injected provider failure");
        }
        return successfulOutput(request);
      },
    });

    const bundle = await runGoldControlledAblation({
      generatedAt,
      scenarioReleaseRef: "release-flagship@1.1.0",
      scenarioContentHash: flagshipHash,
      modelProfileRef: "controlled-live-failure-test",
      modelTier: "deterministic-controlled-test",
      provider,
      repetitionsPerCondition: 10,
      pricing: null,
    });

    const failed = bundle.report.observations.find(
      (observation) => observation.status === "failed",
    );
    expect(failed).toBeDefined();
    expect(failed?.teacherScores).toEqual({
      suggestedScore: null,
      finalScore: null,
      absoluteDelta: null,
    });
    expect(failed?.errorCode).toBe("deterministic_resolver_failed");
    expect(bundle.receipts.filter((receipt) => (
      receipt.status === "failed"
    ))).toHaveLength(1);
    expect(bundle.blindReviewPacket.cases).toHaveLength(79);
    expect(bundle.report.conclusion).not.toBe(
      "engineering_contract_passed",
    );
  });

  it("保留截断失败中供应方已观测的Token与成本", async () => {
    const provider = new OpenAiCompatibleModelProvider({
      profileId: "controlled-live-truncated-test",
      baseUrl: "https://api.deepseek.com",
      apiKey: "test-key",
      model: "deepseek-v4-flash",
      maxRetries: 0,
      fetchImpl: (async () => new Response(JSON.stringify({
        id: "chatcmpl-truncated",
        model: "deepseek-v4-flash",
        choices: [{
          finish_reason: "length",
          message: { content: "{\"evidenceRefs\":[" },
        }],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 1024,
          total_tokens: 1124,
        },
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "x-request-id": "provider-request-truncated",
        },
      })) as typeof fetch,
      sleep: async () => undefined,
    });

    const bundle = await runGoldControlledAblation({
      generatedAt,
      scenarioReleaseRef: "release-flagship@1.1.0",
      scenarioContentHash: flagshipHash,
      modelProfileRef: "controlled-live-truncated-test",
      modelTier: "deepseek-v4-flash",
      provider,
      repetitionsPerCondition: 10,
      pricing: {
        sourceUrl: "https://api-docs.deepseek.com/quick_start/pricing",
        accessedAt: "2026-07-29",
        inputCacheMissUsdPerMillion: 0.14,
        outputUsdPerMillion: 0.28,
        calculation: "conservative_cache_miss_input_plus_output",
      },
    });

    expect(bundle.receipts).toHaveLength(80);
    expect(bundle.receipts.every((receipt) => (
      receipt.status === "failed"
      && receipt.errorCode === "model_output_truncated"
      && receipt.tokenUsage?.total === 1124
      && receipt.estimatedCostUsd === 0.00030072
    ))).toBe(true);
    expect(bundle.report.observations.every((observation) => (
      observation.teacherScores.suggestedScore === null
      && observation.teacherScores.finalScore === null
    ))).toBe(true);
  });
});
