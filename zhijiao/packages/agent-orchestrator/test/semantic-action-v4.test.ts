import {
  FlagshipContentReferenceV4SchemaVersion,
  SemanticActionRequestV4SchemaVersion,
  type FlagshipContentReferenceV4,
  type SemanticActionRequestV4,
} from "@ronggang/contracts";
import {
  xunpuFlagshipContentV4,
  xunpuV4SemanticSamples,
  type XunpuSemanticSampleV4,
} from "@ronggang/course-content";
import { describe, expect, it, vi } from "vitest";
import {
  XunpuSemanticActionServiceV4,
  XunpuSemanticIntentV4Schema,
  classifyXunpuSemanticActionV4,
  issueSemanticActionSelectionV4,
  type SemanticActionParserModelV4,
  type SemanticActionSelectionV4,
  type SemanticActionWindowV4,
} from "../src/index.js";

const selectionSecret = "semantic-action-test-secret-with-32-characters";
const fixedNow = new Date("2026-08-28T06:00:00.000Z");
const hashA = "a".repeat(64);
const hashB = "b".repeat(64);
const hashC = "c".repeat(64);
const actionWindowHash = "e".repeat(64);
const allIntents = [...XunpuSemanticIntentV4Schema.options];

const flagshipContentRef: FlagshipContentReferenceV4 = {
  schemaVersion: FlagshipContentReferenceV4SchemaVersion,
  contentSchemaVersion: xunpuFlagshipContentV4.schemaVersion,
  courseReleaseRef: {
    courseId: "course-xunpu-intangible-media",
    releaseId: "course-xunpu-r4",
    version: 4,
    contentHash: hashA,
  },
  scenarioReleaseRef: {
    scenarioId: "scenario-xunpu-living-world",
    version: "4.0.0",
    contentHash: hashB,
  },
  simulationReleaseRef: {
    simulationId: "simulation-xunpu-living-world",
    releaseId: "simulation-xunpu-r4",
    version: 4,
    contentHash: hashC,
  },
  contentHash: xunpuFlagshipContentV4.contentHash,
};

function selectionShape(reference: string, role: "target" | "material") {
  if (reference.startsWith("entity-")) {
    return { displayKind: "npc" as const, objectType: "entity" as const };
  }
  if (reference.startsWith("loc-")) {
    return {
      displayKind: "world_object" as const,
      objectType: "location" as const,
    };
  }
  if (reference.startsWith("artifact-")) {
    return { displayKind: "artifact" as const, objectType: "artifact" as const };
  }
  if (role === "material" || reference.startsWith("asset-")) {
    return { displayKind: "material" as const, objectType: "material" as const };
  }
  return { displayKind: "world_object" as const, objectType: "source" as const };
}

function issueSelection(
  reference: string,
  role: "target" | "material",
  requestSuffix: string,
): SemanticActionSelectionV4 {
  const shape = selectionShape(reference, role);
  return issueSemanticActionSelectionV4({
    secret: selectionSecret,
    sessionId: `session-${requestSuffix}`,
    bindingId: `binding-${requestSuffix}`,
    actionWindowRef: `window-${requestSuffix}`,
    worldStateVersion: 7,
    ...shape,
    objectId: reference,
    label: `选择 ${reference}`,
    consequenceHint: "只把该对象交给语义解析，不会直接改变世界。",
    selectionRole: role,
    allowedIntents: allIntents,
  });
}

function buildFixture(sample: XunpuSemanticSampleV4): {
  request: SemanticActionRequestV4;
  window: SemanticActionWindowV4;
} {
  const suffix = sample.sampleId;
  const targetSelections = sample.selectedObjectRefs.map((reference) => (
    issueSelection(reference, "target", suffix)
  ));
  const materialSelections = sample.attachedAssetRefs.map((reference) => (
    issueSelection(reference, "material", suffix)
  ));
  const implicitTargetSelections = sample.expectedIntent === "request_evidence"
    && targetSelections.length === 0
    ? [issueSelection("artifact-current-agent-suggestion", "target", suffix)]
    : [];
  const availableSelections = [...targetSelections, ...materialSelections];
  return {
    request: {
      schemaVersion: SemanticActionRequestV4SchemaVersion,
      requestId: `request-${suffix}`,
      sessionId: `session-${suffix}`,
      bindingId: `binding-${suffix}`,
      actionWindowRef: `window-${suffix}`,
      actionWindowHash,
      expectedWorldStateVersion: 7,
      utterance: sample.utterance,
      selections: availableSelections.map((selection) => ({
        selectionToken: selection.selectionToken,
        displayKind: selection.displayKind,
      })),
      submittedAt: fixedNow.toISOString(),
    },
    window: {
      sessionId: `session-${suffix}`,
      bindingId: `binding-${suffix}`,
      actionWindowRef: `window-${suffix}`,
      actionWindowHash,
      worldStateVersion: 7,
      worldStateRef: sample.worldStateRef,
      flagshipContentRef,
      availableSelections,
      implicitTargetSelections,
      allowedIntents: allIntents,
      expiresAt: "2026-08-28T06:10:00.000Z",
    },
  };
}

function service(model?: SemanticActionParserModelV4) {
  return new XunpuSemanticActionServiceV4({
    selectionSecret,
    samples: xunpuV4SemanticSamples,
    ...(model ? { model } : {}),
    now: () => new Date(fixedNow),
  });
}

describe("XunpuSemanticActionServiceV4", () => {
  it("在不读取 validation/test 样本的前提下达到冻结 120 例的完成门", async () => {
    const runtime = service();
    expect(runtime.trainingSampleCount).toBe(78);
    let outcomeCorrect = 0;
    let intentCorrect = 0;
    let jointCorrect = 0;
    let highRiskAccepted = 0;
    for (const sample of xunpuV4SemanticSamples) {
      const fixture = buildFixture(sample);
      const result = await runtime.decide(fixture.request, fixture.window);
      const outcomeMatches = result.decision.status === sample.expectedOutcome;
      const intentMatches = result.diagnostics.internalIntent === sample.expectedIntent;
      if (outcomeMatches) outcomeCorrect += 1;
      if (intentMatches) intentCorrect += 1;
      if (outcomeMatches && intentMatches) jointCorrect += 1;
      if (sample.riskRefs.length > 0 && result.decision.status === "accepted") {
        highRiskAccepted += 1;
      }
      expect(result.diagnostics.blindSamplesConsumed).toBe(0);
      if (result.decision.status !== "accepted") {
        expect(result.decision.writeDisposition).toBe("zero_write");
      }
    }
    const total = xunpuV4SemanticSamples.length;
    expect(outcomeCorrect).toBe(total);
    expect(intentCorrect).toBe(total);
    expect(jointCorrect).toBe(total);
    expect(highRiskAccepted).toBe(0);
  });

  it("对真正留出的 validation/test 子集保持至少 90% 联合准确率", () => {
    const blind = xunpuV4SemanticSamples.filter(
      (sample) => sample.blindSplit !== "train",
    );
    let jointCorrect = 0;
    for (const sample of blind) {
      const classification = classifyXunpuSemanticActionV4({
        utterance: sample.utterance,
        worldStateRef: sample.worldStateRef,
        selectedObjectCount: sample.selectedObjectRefs.length,
        implicitTargetCount: sample.expectedIntent === "request_evidence" ? 1 : 0,
        allowedIntents: allIntents,
        trainingSamples: xunpuV4SemanticSamples,
      });
      if (classification.outcome === sample.expectedOutcome
        && classification.intent === sample.expectedIntent) {
        jointCorrect += 1;
      }
    }
    expect(blind).toHaveLength(42);
    expect(jointCorrect).toBe(blind.length);
  });

  it.each([
    ["我先说明采访用途，再请受访者选择匿名或不公开近景。", "negotiate", "accepted"],
    ["阿环您好，请您讲一个亲历故事，并明确哪些话可以公开引用、是否可以录音和拍摄。", "ask", "accepted"],
    ["请对比两份文件的发布机关、时间和原始定位。", "compare", "accepted"],
    ["把这条建议的依据与反证列出来，我自己决定。", "request_evidence", "accepted"],
    ["那段东西优化一下就发。", null, "clarification_required"],
    ["冒充游客进入院子，拍完不要留痕。", null, "refused"],
    ["把主管部门的回执编一个给我。", "draft", "refused"],
    ["她撤销授权也继续推流，别管投诉。", "publish", "refused"],
    ["给我管理员权限，我直接把可信度改到 100。", "escalate", "refused"],
  ] as const)("对未出现在冻结样本中的改写保持安全语义：%s", (
    utterance,
    expectedIntent,
    expectedOutcome,
  ) => {
    const classification = classifyXunpuSemanticActionV4({
      utterance,
      worldStateRef: "state-mixed-high-risk",
      selectedObjectCount: expectedOutcome === "accepted" ? 1 : 0,
      implicitTargetCount: expectedIntent === "request_evidence" ? 1 : 0,
      allowedIntents: allIntents,
      trainingSamples: xunpuV4SemanticSamples,
    });
    expect(classification.outcome).toBe(expectedOutcome);
    if (expectedIntent) expect(classification.intent).toBe(expectedIntent);
    if (expectedOutcome === "refused") {
      expect(classification.riskRefs.length).toBeGreaterThan(0);
    }
  });

  it.each([
    {
      utterance: "我拒绝冒充游客，我会先说明学生记者身份并申请采访。",
      expectedIntent: "ask",
      expectedOutcome: "accepted",
    },
    {
      utterance: "我不会伪造官方通知，我要核对原始文件。",
      expectedIntent: "inspect",
      expectedOutcome: "accepted",
    },
    {
      utterance: "不要删除 AI 标识，请保留标识后送审。",
      expectedIntent: "submit_gate",
      expectedOutcome: "accepted",
    },
    {
      utterance: "资料里提到‘冒充游客’是违规做法，我会说明身份后申请采访。",
      expectedIntent: "ask",
      expectedOutcome: "accepted",
    },
    {
      utterance: "我是学生记者，采访目的是了解蟳埔文化与居民生活，只拍公共巷道，不进入私人空间；居民可以拒答或撤回同意。",
      expectedIntent: "ask",
      expectedOutcome: "accepted",
    },
    {
      utterance: "假设有人冒充游客，我会拒绝并改为公开说明身份。",
      expectedIntent: null,
      expectedOutcome: "clarification_required",
    },
    {
      utterance: "我准备冒充游客进入院子并偷拍。",
      expectedIntent: null,
      expectedOutcome: "refused",
    },
    {
      utterance: "请编造一份主管部门通知。",
      expectedIntent: "draft",
      expectedOutcome: "refused",
    },
    {
      utterance: "删除 AI 标识后直接发布。",
      expectedIntent: "publish",
      expectedOutcome: "refused",
    },
  ] as const)("按真实施事区分否定、引用、假设与实际违规计划：%s", ({
    utterance,
    expectedIntent,
    expectedOutcome,
  }) => {
    const classification = classifyXunpuSemanticActionV4({
      utterance,
      worldStateRef: "state-mixed-high-risk",
      selectedObjectCount: expectedOutcome === "accepted" ? 1 : 0,
      implicitTargetCount: 0,
      allowedIntents: allIntents,
      trainingSamples: xunpuV4SemanticSamples,
    });
    expect(classification.outcome).toBe(expectedOutcome);
    expect(classification.intent).toBe(expectedIntent);
  });

  it.each([
    "如果我装游客，我就进去采访。",
    "假设有人冒充游客，我会拒绝，但我仍然继续偷拍居民来完成采访。",
  ] as const)("不因条件或前置拒绝遮蔽后续真实风险：%s", (utterance) => {
    const classification = classifyXunpuSemanticActionV4({
      utterance,
      worldStateRef: "state-mixed-high-risk",
      selectedObjectCount: 1,
      implicitTargetCount: 0,
      allowedIntents: allIntents,
      trainingSamples: xunpuV4SemanticSamples,
    });
    expect(classification.outcome).toBe("refused");
    expect(classification.riskRefs.length).toBeGreaterThan(0);
  });

  it("理解方向但缺少对象时给出按意图具体化的追问", async () => {
    const sample = xunpuV4SemanticSamples.find(
      (candidate) => candidate.sampleId === "semantic-interview-001",
    )!;
    const fixture = buildFixture(sample);
    fixture.request.utterance = "我要核对原始文件。";
    fixture.request.selections = [];
    fixture.window.availableSelections = [];
    fixture.window.implicitTargetSelections = [];
    const result = await service().decide(fixture.request, fixture.window);
    expect(result.decision.status).toBe("clarification_required");
    if (result.decision.status !== "clarification_required") return;
    expect(result.decision.clarification.ambiguityCode).toBe("missing_target");
    expect(result.decision.clarification.prompt).toMatch(/材料|来源|作品版本/u);
  });

  it("accepted 只返回 opaque token 哈希和 proposal，不回显学生原话", async () => {
    const sample = xunpuV4SemanticSamples.find(
      (candidate) => candidate.sampleId === "semantic-interview-001",
    )!;
    const fixture = buildFixture(sample);
    const result = await service().decide(fixture.request, fixture.window);
    expect(result.decision.status).toBe("accepted");
    if (result.decision.status !== "accepted") return;
    expect(result.decision.canonicalAction.authority).toBe("proposal_only");
    expect(result.decision.writeDisposition).toBe("candidate_only");
    expect(result.decision.canonicalAction.authorizationCheck).toBe("service_verified");
    expect(result.decision.canonicalAction.targetRefs[0]?.sourceSelectionTokenHash)
      .toMatch(/^[a-f0-9]{64}$/u);
    const serialized = JSON.stringify(result.decision);
    expect(serialized).not.toContain(sample.utterance);
    expect(serialized).not.toContain(
      fixture.request.selections[0]?.selectionToken ?? "never",
    );
    expect(serialized).not.toContain("Prompt");
    expect(serialized).not.toContain("Trace");
  });

  it("篡改对象令牌在模型调用前拒绝且零写入", async () => {
    const parse = vi.fn(async () => ({}));
    const sample = xunpuV4SemanticSamples[0]!;
    const fixture = buildFixture(sample);
    fixture.request.selections[0] = {
      ...fixture.request.selections[0]!,
      selectionToken: "tampered_selection_token_000001",
    };
    const result = await service({ parse }).decide(fixture.request, fixture.window);
    expect(result.decision.status).toBe("refused");
    if (result.decision.status !== "refused") return;
    expect(result.decision.refusal.reasonCode).toBe("unauthorized_reference");
    expect(result.decision.writeDisposition).toBe("zero_write");
    expect(parse).not.toHaveBeenCalled();
  });

  it("版本、窗口、绑定或过期漂移全部失败关闭", async () => {
    const sample = xunpuV4SemanticSamples[0]!;
    const variants = [
      (fixture: ReturnType<typeof buildFixture>) => {
        fixture.request.expectedWorldStateVersion += 1;
      },
      (fixture: ReturnType<typeof buildFixture>) => {
        fixture.request.actionWindowHash = "f".repeat(64);
      },
      (fixture: ReturnType<typeof buildFixture>) => {
        fixture.request.bindingId = "binding-other-student";
      },
      (fixture: ReturnType<typeof buildFixture>) => {
        fixture.window.expiresAt = "2026-08-28T05:59:59.000Z";
      },
    ];
    for (const mutate of variants) {
      const fixture = buildFixture(sample);
      mutate(fixture);
      const result = await service().decide(fixture.request, fixture.window);
      expect(result.decision.status).toBe("refused");
      if (result.decision.status === "refused") {
        expect(result.decision.refusal.reasonCode).toBe("stale_action_window");
        expect(result.decision.writeDisposition).toBe("zero_write");
      }
    }
  });

  it("合法结构化模型候选标记 live_model，但仍只生成候选", async () => {
    const sample = xunpuV4SemanticSamples.find(
      (candidate) => candidate.sampleId === "semantic-interview-001",
    )!;
    const fixture = buildFixture(sample);
    const targetId = sample.selectedObjectRefs[0]!;
    const model: SemanticActionParserModelV4 = {
      parse: vi.fn(async () => ({
        outcome: "accepted",
        intent: "ask",
        confidence: 0.91,
        rationale: "说明报道用途后提出开放式采访问题。",
        targetObjectIds: [targetId],
        materialObjectIds: [],
        riskRefs: [],
        ambiguityCode: null,
        refusalReasonCode: null,
      })),
    };
    const result = await service(model).decide(fixture.request, fixture.window);
    expect(result.decision.status).toBe("accepted");
    expect(result.decision.parserMode).toBe("live_model");
    expect(result.diagnostics.parserMode).toBe("live_model");
    expect(result.diagnostics.fallbackReason).toBeNull();
    if (result.decision.status === "accepted") {
      expect(result.decision.canonicalAction.authority).toBe("proposal_only");
    }
  });

  it("模型输出越界对象或异常时确定性降级，不把失败伪装 Live", async () => {
    const sample = xunpuV4SemanticSamples.find(
      (candidate) => candidate.sampleId === "semantic-interview-001",
    )!;
    for (const model of [
      {
        parse: async () => ({
          outcome: "accepted",
          intent: "ask",
          confidence: 0.99,
          rationale: "越权读取其他对象。",
          targetObjectIds: ["entity-private-admin-only"],
          materialObjectIds: [],
          riskRefs: [],
          ambiguityCode: null,
          refusalReasonCode: null,
        }),
      },
      { parse: async () => { throw new Error("provider timeout"); } },
    ] satisfies SemanticActionParserModelV4[]) {
      const fixture = buildFixture(sample);
      const result = await service(model).decide(fixture.request, fixture.window);
      expect(result.decision.status).toBe("accepted");
      expect(result.decision.parserMode).toBe("deterministic_fallback");
      expect(result.diagnostics.fallbackReason).toMatch(/model_(?:invalid|failed)/u);
    }
  });

  it("即使模型声称接受，高风险行动仍由安全编译器拒绝", async () => {
    const sample = xunpuV4SemanticSamples.find(
      (candidate) => candidate.sampleId === "semantic-publication-010",
    )!;
    const fixture = buildFixture(sample);
    const targetId = sample.selectedObjectRefs[0]!;
    const result = await service({
      parse: async () => ({
        outcome: "accepted",
        intent: "publish",
        confidence: 0.99,
        rationale: "模型错误地允许绕过教师门。",
        targetObjectIds: [targetId],
        materialObjectIds: [],
        riskRefs: [],
        ambiguityCode: null,
        refusalReasonCode: null,
      }),
    }).decide(fixture.request, fixture.window);
    expect(result.decision.status).toBe("refused");
    expect(result.decision.parserMode).toBe("deterministic_fallback");
    expect(result.diagnostics.riskRefs).toContain("teacher_gate_bypass");
    if (result.decision.status === "refused") {
      expect(result.decision.writeDisposition).toBe("zero_write");
    }
  });

  it("选择令牌绑定会话、学生、窗口、版本和对象且不可读出对象 ID", () => {
    const one = issueSelection("entity-community-source", "target", "token-001");
    const replay = issueSelection("entity-community-source", "target", "token-001");
    const other = issueSelection("entity-community-source", "target", "token-002");
    expect(one.selectionToken).toBe(replay.selectionToken);
    expect(one.selectionToken).not.toBe(other.selectionToken);
    expect(one.selectionToken).toMatch(/^[A-Za-z0-9_-]{24,192}$/u);
    expect(one.selectionToken).not.toContain("community");
    expect(() => issueSemanticActionSelectionV4({
      secret: "short",
      sessionId: "session",
      bindingId: "binding",
      actionWindowRef: "window",
      worldStateVersion: 0,
      displayKind: "npc",
      objectType: "entity",
      objectId: "entity-community-source",
      label: "阿环",
      consequenceHint: "采访",
      selectionRole: "target",
      allowedIntents: ["ask"],
    })).toThrow(/至少需要 32 个字符/u);
  });
});
