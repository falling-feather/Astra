import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FlagshipContentReferenceV4SchemaVersion,
  type AutonomousWorldDecisionV4,
  type FlagshipContentReferenceV4,
} from "@ronggang/contracts";
import {
  xunpuFlagshipContentV4,
} from "@ronggang/course-content";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AutonomousWorldSchedulerV4,
  InMemoryAutonomousWorldStoreV4,
  JsonFileAutonomousWorldStoreV4,
  XunpuAutonomousWorldDirectorV4,
  compileXunpuAutonomyPlansV4,
  evaluateAutonomyTriggerV4,
  hashAutonomousPrivateValueV4,
  issueAuthoritativeWorldCommitTokenV4,
  validateAutonomousWorldRecordV4,
  type AuthoritativeWorldCommitPayloadV4,
  type AutonomousNpcDecisionModelV4,
  type AutonomousNpcDecisionObservationV4,
  type AutonomousWorldRecordV4,
  type AutonomousWorldStoreV4,
} from "../src/index.js";

const authoritySecret = "world-engine-authority-secret-for-v4-tests";
const fixedNow = "2026-08-28T08:00:00.000Z";
const temporaryDirectories: string[] = [];

const flagshipContentRef: FlagshipContentReferenceV4 = {
  schemaVersion: FlagshipContentReferenceV4SchemaVersion,
  contentSchemaVersion: xunpuFlagshipContentV4.schemaVersion,
  courseReleaseRef: {
    courseId: xunpuFlagshipContentV4.courseId,
    releaseId: "course-xunpu-r4",
    version: 4,
    contentHash: "a".repeat(64),
  },
  scenarioReleaseRef: {
    scenarioId: xunpuFlagshipContentV4.scenarioId,
    version: "4.0.0",
    contentHash: "b".repeat(64),
  },
  simulationReleaseRef: {
    simulationId: "simulation-xunpu-living-world",
    releaseId: "simulation-xunpu-r4",
    version: 4,
    contentHash: "c".repeat(64),
  },
  contentHash: xunpuFlagshipContentV4.contentHash,
};

function director(
  store: AutonomousWorldStoreV4 = new InMemoryAutonomousWorldStoreV4(),
  options: {
    npcDecisionModel?: AutonomousNpcDecisionModelV4;
    npcDecisionTimeoutMs?: number;
    npcDecisionSessionBudgetMicros?: number;
  } = {},
): XunpuAutonomousWorldDirectorV4 {
  return new XunpuAutonomousWorldDirectorV4({
    store,
    content: xunpuFlagshipContentV4,
    authoritySecret,
    now: () => fixedNow,
    ...options,
  });
}

async function start(
  runtime: XunpuAutonomousWorldDirectorV4,
  input: {
    sessionId?: string;
    seed?: string;
    challengeLevel?: 3 | 4 | 5 | 6 | 7;
    initialVirtualMinute?: number;
    initialVariableValues?: Record<string, number>;
    initialSignals?: Record<string, boolean | number | string>;
  } = {},
): Promise<AutonomousWorldRecordV4> {
  return runtime.start({
    sessionId: input.sessionId ?? "session-autonomy-v4",
    flagshipContentRef,
    challengeLevel: input.challengeLevel ?? 5,
    seed: input.seed ?? "seed-autonomy-v4",
    initialWorldStateVersion: 0,
    ...(input.initialVirtualMinute === undefined
      ? {} : { initialVirtualMinute: input.initialVirtualMinute }),
    ...(input.initialVariableValues
      ? { initialVariableValues: input.initialVariableValues } : {}),
    startedAt: fixedNow,
    ...(input.initialSignals ? { initialSignals: input.initialSignals } : {}),
  });
}

function commitPayload(
  record: AutonomousWorldRecordV4,
  overrides: Partial<AuthoritativeWorldCommitPayloadV4> = {},
): AuthoritativeWorldCommitPayloadV4 {
  return {
    sessionId: record.sessionId,
    commitRef: `commit-${record.currentWorldStateVersion + 1}`,
    sourceWorldStateVersion: record.currentWorldStateVersion,
    resultingWorldStateVersion: record.currentWorldStateVersion + 1,
    sourceWorldEventRef: `world-event-${record.currentWorldStateVersion + 1}`,
    candidateEventId: null,
    virtualMinute: record.virtualMinute,
    paused: record.paused,
    endingStatus: record.endingStatus,
    signalUpdates: {},
    variableValues: {},
    npcMemoryUpdates: [],
    npcCommitmentUpdates: [],
    npcLocalFactUpdates: [],
    committedAt: fixedNow,
    ...overrides,
  };
}

async function commit(
  runtime: XunpuAutonomousWorldDirectorV4,
  record: AutonomousWorldRecordV4,
  overrides: Partial<AuthoritativeWorldCommitPayloadV4> = {},
) {
  const payload = commitPayload(record, overrides);
  return runtime.recordWorldCommit({
    ...payload,
    authorityToken: issueAuthoritativeWorldCommitTokenV4(
      authoritySecret,
      payload,
    ),
  });
}

function scheduled(
  decision: AutonomousWorldDecisionV4,
): Extract<AutonomousWorldDecisionV4, { status: "scheduled" }> {
  expect(decision.status).toBe("scheduled");
  if (decision.status !== "scheduled") {
    throw new Error("测试要求主动事件已调度");
  }
  return decision;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => (
      rm(directory, { recursive: true, force: true })
    )),
  );
});

describe("V4 泉州自主世界导演", () => {
  it("can attach to an existing authoritative session without resetting its clock or variables", async () => {
    const runtime = director();
    const record = await start(runtime, {
      sessionId: "session-autonomy-existing-world",
      initialVirtualMinute: 17,
      initialVariableValues: { community_trust: 63, evidence_confidence: 48 },
      initialSignals: { conflicting_year_claim_received: true },
    });
    expect(record.virtualMinute).toBe(17);
    expect(record.variables.community_trust).toBe(63);
    expect(record.variables.evidence_confidence).toBe(48);
    expect(record.signals.conflicting_year_claim_received).toBe(true);
  });

  it("读取旧 4.0 存档时只补决策收据与延迟字段，不改写世界事实", async () => {
    const runtime = director();
    const record = await start(runtime, { sessionId: "session-legacy-record" });
    const legacy = structuredClone(record) as unknown as Record<string, any>;
    delete legacy.npcDecisionReceipts;
    for (const plan of legacy.planStates) delete plan.deferredUntilVirtualMinute;
    const normalized = validateAutonomousWorldRecordV4(
      legacy as AutonomousWorldRecordV4,
    );
    expect(normalized.npcDecisionReceipts).toEqual([]);
    expect(normalized.planStates.every(
      (plan) => plan.deferredUntilVirtualMinute === null,
    )).toBe(true);
    expect(normalized.currentWorldStateVersion).toBe(record.currentWorldStateVersion);
    expect(normalized.variables).toEqual(record.variables);
  });

  it("编译十名 NPC 的三十二个计划，并安全解释全部触发表达式", async () => {
    const runtime = director();
    const record = await start(runtime);
    const plans = compileXunpuAutonomyPlansV4(xunpuFlagshipContentV4);

    expect(plans).toHaveLength(32);
    expect(new Set(plans.map((plan) => plan.actorEntityRef)).size).toBe(10);
    expect(new Set(plans.map((plan) => plan.planRef)).size).toBe(32);
    for (const plan of plans) {
      expect(() => evaluateAutonomyTriggerV4(
        plan.triggerExpression,
        record,
      )).not.toThrow();
      expect(plan.publicCue).toContain("【教学仿真】");
      expect(plan.affectedObjectRefs).toContain(plan.actorEntityRef);
    }
  });

  it("让模型只在服务端候选中依据本 NPC 的目标、关系与公开记忆选择", async () => {
    let observed: AutonomousNpcDecisionObservationV4 | null = null;
    const decide = vi.fn(async (
      input: Readonly<AutonomousNpcDecisionObservationV4>,
    ) => {
      observed = structuredClone(input);
      return {
        output: {
          disposition: "select",
          selectedPlanRef: "merchant-plan-offer",
          deferUntilVirtualMinute: null,
          rationale: "商户交换条件会先改变素材权利边界，应优先回应。",
        },
        providerId: "deepseek",
        modelId: "model-v4-test",
        traceRef: "model-trace-npc-selection",
        latencyMs: 18,
        estimatedCostMicros: 120,
      };
    });
    const runtime = director(new InMemoryAutonomousWorldStoreV4(), {
      npcDecisionModel: { decide },
    });
    let record = await start(runtime, {
      initialSignals: {
        camera_targets_private_marker: true,
        student_inspects_shop_material: true,
      },
    });
    record = (await commit(runtime, record, {
      npcMemoryUpdates: [{
        entityId: "entity-gatekeeper",
        memoryKey: "boundary_breach",
        valueHash: hashAutonomousPrivateValueV4("不得进入模型观察的私有原值"),
        publicSummary: null,
      }, {
        entityId: "entity-shopkeeper",
        memoryKey: "material_offer",
        valueHash: hashAutonomousPrivateValueV4("商户私有交换底价"),
        publicSummary: "商户曾提出需要进入权利台账的素材合作条件。",
      }],
    })).record;

    const decision = scheduled(await runtime.evaluate({
      sessionId: record.sessionId,
      cycleRef: "cycle-model-selects-lower-priority",
      expectedWorldStateVersion: 1,
      triggerKind: "state_threshold",
      triggerRef: "multiple-npc-goals",
    }));
    expect(decision.selectedPlanRef).toBe("merchant-plan-offer");
    expect(decide).toHaveBeenCalledTimes(1);
    const observation = observed as AutonomousNpcDecisionObservationV4 | null;
    expect(observation).not.toBeNull();
    const merchant = observation!.candidates.find(
      (candidate) => candidate.planRef === "merchant-plan-offer",
    );
    const gatekeeper = observation!.candidates.find(
      (candidate) => candidate.planRef === "gatekeeper-plan-boundary",
    );
    expect(merchant?.localObservation.publicMemorySummaries).toEqual([{
      memoryKey: "material_offer",
      publicSummary: "商户曾提出需要进入权利台账的素材合作条件。",
      updatedAtWorldStateVersion: 1,
    }]);
    expect(gatekeeper?.localObservation.publicMemorySummaries).toEqual([]);
    expect(JSON.stringify(observation)).not.toMatch(/私有原值|私有交换底价|valueHash|privatePressure/u);
    const persisted = await runtime.getRecord(record.sessionId);
    expect(persisted.npcDecisionReceipts).toEqual([expect.objectContaining({
      mode: "model",
      disposition: "select",
      selectedPlanRef: "merchant-plan-offer",
      providerId: "deepseek",
      estimatedCostMicros: 120,
    })]);
    expect(JSON.stringify(decision)).not.toMatch(/deepseek|model-v4-test|trace|交换底价/u);
  });

  it("拒绝模型自造计划并以同状态可复算选择降级，模型始终不能直接写世界", async () => {
    const runtime = director(new InMemoryAutonomousWorldStoreV4(), {
      npcDecisionModel: {
        decide: async () => ({
          output: {
            disposition: "select",
            selectedPlanRef: "invented-npc-plan",
            deferUntilVirtualMinute: null,
            rationale: "尝试越界选择。",
          },
          providerId: "deepseek",
          modelId: "model-v4-test",
          traceRef: "model-trace-invalid-plan",
          latencyMs: 9,
          estimatedCostMicros: 80,
        }),
      },
    });
    const record = await start(runtime, {
      initialSignals: {
        camera_targets_private_marker: true,
        student_inspects_shop_material: true,
      },
    });
    const decision = scheduled(await runtime.evaluate({
      sessionId: record.sessionId,
      cycleRef: "cycle-model-invents-plan",
      expectedWorldStateVersion: 0,
      triggerKind: "state_threshold",
      triggerRef: "invalid-model-plan",
    }));
    expect(decision.selectedPlanRef).toBe("gatekeeper-plan-boundary");
    expect(decision.writeDisposition).toBe("candidate_only");
    const persisted = await runtime.getRecord(record.sessionId);
    expect(persisted.currentWorldStateVersion).toBe(0);
    expect(persisted.commitReceipts).toEqual([]);
    expect(persisted.npcDecisionReceipts[0]).toMatchObject({
      mode: "deterministic_fallback",
      fallbackReason: "model_invalid_output",
      selectedPlanRef: "gatekeeper-plan-boundary",
    });
  });

  it("支持模型延迟与无动作，并在延迟窗口内不重复调用模型", async () => {
    const decide = vi.fn()
      .mockResolvedValueOnce({
        output: {
          disposition: "defer",
          selectedPlanRef: "merchant-plan-offer",
          deferUntilVirtualMinute: 4,
          rationale: "先等待学生完成素材范围确认。",
        },
        providerId: "deepseek",
        modelId: "model-v4-test",
        traceRef: "model-trace-defer",
        latencyMs: 10,
        estimatedCostMicros: 50,
      })
      .mockResolvedValueOnce({
        output: {
          disposition: "no_action",
          selectedPlanRef: null,
          deferUntilVirtualMinute: null,
          rationale: "学生正在处理边界，本轮无需再打断。",
        },
        providerId: "deepseek",
        modelId: "model-v4-test",
        traceRef: "model-trace-no-action",
        latencyMs: 11,
        estimatedCostMicros: 55,
      });
    const runtime = director(new InMemoryAutonomousWorldStoreV4(), {
      npcDecisionModel: { decide },
    });
    let record = await start(runtime, {
      initialSignals: { student_inspects_shop_material: true },
    });
    const deferred = await runtime.evaluate({
      sessionId: record.sessionId,
      cycleRef: "cycle-model-defer",
      expectedWorldStateVersion: 0,
      triggerKind: "state_threshold",
      triggerRef: "merchant-offer-defer",
    });
    expect(deferred).toMatchObject({
      status: "suppressed",
      suppression: { reasonCode: "npc_decision_deferred" },
      writeDisposition: "zero_write",
    });
    const replayedDeferred = await runtime.evaluate({
      sessionId: record.sessionId,
      cycleRef: "cycle-model-defer",
      expectedWorldStateVersion: 0,
      triggerKind: "state_threshold",
      triggerRef: "merchant-offer-defer",
    });
    expect(replayedDeferred).toEqual(deferred);
    const cooldown = await runtime.evaluate({
      sessionId: record.sessionId,
      cycleRef: "cycle-model-defer-cooldown",
      expectedWorldStateVersion: 0,
      triggerKind: "virtual_clock",
      triggerRef: "minute-before-defer",
    });
    expect(cooldown).toMatchObject({
      status: "suppressed",
      suppression: { reasonCode: "cooldown_not_elapsed" },
    });
    expect(decide).toHaveBeenCalledTimes(1);

    record = await runtime.getRecord(record.sessionId);
    record = (await commit(runtime, record, {
      virtualMinute: 4,
      commitRef: "commit-model-defer-clock",
      sourceWorldEventRef: "world-event-model-defer-clock",
    })).record;
    const noAction = await runtime.evaluate({
      sessionId: record.sessionId,
      cycleRef: "cycle-model-no-action",
      expectedWorldStateVersion: 1,
      triggerKind: "virtual_clock",
      triggerRef: "minute-defer-reached",
    });
    expect(noAction).toMatchObject({
      status: "suppressed",
      suppression: { reasonCode: "npc_decision_no_action" },
      writeDisposition: "zero_write",
    });
    expect(decide).toHaveBeenCalledTimes(2);
    const persisted = await runtime.getRecord(record.sessionId);
    expect(persisted.currentWorldStateVersion).toBe(1);
    expect(persisted.responseWindows).toEqual([]);
  });

  it("模型超时后快速降级且保留明确私有收据", async () => {
    const runtime = director(new InMemoryAutonomousWorldStoreV4(), {
      npcDecisionTimeoutMs: 1,
      npcDecisionModel: {
        decide: async () => new Promise(() => undefined),
      },
    });
    const record = await start(runtime, {
      initialSignals: { student_inspects_shop_material: true },
    });
    const decision = scheduled(await runtime.evaluate({
      sessionId: record.sessionId,
      cycleRef: "cycle-model-timeout",
      expectedWorldStateVersion: 0,
      triggerKind: "state_threshold",
      triggerRef: "model-timeout",
    }));
    expect(decision.selectedPlanRef).toBe("merchant-plan-offer");
    expect((await runtime.getRecord(record.sessionId)).npcDecisionReceipts[0])
      .toMatchObject({
        mode: "deterministic_fallback",
        fallbackReason: "model_timeout",
      });
  });

  it("单场模型预算耗尽时不调用供应方并确定性继续世界", async () => {
    const decide = vi.fn(async () => {
      throw new Error("预算为零时不应调用模型");
    });
    const runtime = director(new InMemoryAutonomousWorldStoreV4(), {
      npcDecisionModel: { decide },
      npcDecisionSessionBudgetMicros: 0,
    });
    const record = await start(runtime, {
      initialSignals: { student_inspects_shop_material: true },
    });
    const decision = scheduled(await runtime.evaluate({
      sessionId: record.sessionId,
      cycleRef: "cycle-model-budget-exhausted",
      expectedWorldStateVersion: 0,
      triggerKind: "state_threshold",
      triggerRef: "model-budget-exhausted",
    }));
    expect(decision.selectedPlanRef).toBe("merchant-plan-offer");
    expect(decide).not.toHaveBeenCalled();
    expect((await runtime.getRecord(record.sessionId)).npcDecisionReceipts[0])
      .toMatchObject({
        mode: "deterministic_fallback",
        fallbackReason: "session_budget_exhausted",
        estimatedCostMicros: 0,
      });
  });

  it("把 3—7 级岗位压力落实为不同的真实响应窗口", async () => {
    const lowRuntime = director();
    const highRuntime = director();
    const low = await start(lowRuntime, {
      sessionId: "session-pressure-low",
      challengeLevel: 3,
      initialSignals: { student_inspects_shop_material: true },
    });
    const high = await start(highRuntime, {
      sessionId: "session-pressure-high",
      challengeLevel: 7,
      initialSignals: { student_inspects_shop_material: true },
    });

    const lowDecision = scheduled(await lowRuntime.evaluate({
      sessionId: low.sessionId,
      cycleRef: "cycle-pressure-low",
      expectedWorldStateVersion: 0,
      triggerKind: "state_threshold",
      triggerRef: "merchant-pressure-low",
    }));
    const highDecision = scheduled(await highRuntime.evaluate({
      sessionId: high.sessionId,
      cycleRef: "cycle-pressure-high",
      expectedWorldStateVersion: 0,
      triggerKind: "state_threshold",
      triggerRef: "merchant-pressure-high",
    }));

    expect(lowDecision.candidateEvent.expiresVirtualMinute).toBe(7);
    expect(highDecision.candidateEvent.expiresVirtualMinute).toBe(3);
  });

  it("让商户主动提出交换条件，并只在权威世界写回后形成持续记忆和承诺", async () => {
    const runtime = director();
    let record = await start(runtime, {
      initialSignals: { student_inspects_shop_material: true },
    });

    const offer = scheduled(await runtime.evaluate({
      sessionId: record.sessionId,
      cycleRef: "cycle-merchant-offer",
      expectedWorldStateVersion: 0,
      triggerKind: "npc_plan",
      triggerRef: "student-inspects-material",
    }));
    expect(offer.selectedPlanRef).toBe("merchant-plan-offer");
    expect((await runtime.getRecord(record.sessionId)).currentWorldStateVersion)
      .toBe(0);

    const result = await commit(runtime, await runtime.getRecord(record.sessionId), {
      candidateEventId: offer.candidateEvent.candidateEventId,
      virtualMinute: 4,
      signalUpdates: { material_offer_received: true },
      npcMemoryUpdates: [{
        entityId: "entity-shopkeeper",
        memoryKey: "material_offer",
        valueHash: hashAutonomousPrivateValueV4({
          requestedPlacement: "标题与首图突出门店",
        }),
        publicSummary: "吴姐提出素材交换条件，学生尚未接受。",
      }],
      npcCommitmentUpdates: [{
        entityId: "entity-shopkeeper",
        commitmentId: "commitment-material-offer",
        publicSummary: "素材仅在双方明确用途和披露方式后开放。",
        status: "active",
      }],
    });
    record = result.record;

    expect(result.replayed).toBe(false);
    expect(record.currentWorldStateVersion).toBe(1);
    expect(record.responseWindows[0]?.status).toBe("committed");
    expect(record.planStates.find((plan) => plan.planRef === "merchant-plan-offer"))
      .toMatchObject({ status: "committed" });
    expect(record.npcStates.find((npc) => npc.entityId === "entity-shopkeeper"))
      .toMatchObject({
        memories: [{ memoryKey: "material_offer" }],
        commitments: [{ commitmentId: "commitment-material-offer" }],
      });

    record = (await commit(runtime, record, {
      commitRef: "commit-consent-withdrawal",
      sourceWorldEventRef: "world-event-consent-withdrawal",
      virtualMinute: 9,
      signalUpdates: { consent_withdrawn: true },
    })).record;
    const withdrawal = scheduled(await runtime.evaluate({
      sessionId: record.sessionId,
      cycleRef: "cycle-rights-withdrawal",
      expectedWorldStateVersion: record.currentWorldStateVersion,
      triggerKind: "state_threshold",
      triggerRef: "consent-withdrawn",
    }));
    expect(withdrawal.selectedPlanRef).toBe("rights-plan-withdrawal");
    expect(withdrawal.candidateEvent.actorEntityRef).toBe("entity-rights-contact");
  });

  it("跨轮保存三名 NPC 的局部记忆，而不把私有原值写入公开记录", async () => {
    const runtime = director();
    let record = await start(runtime);
    const privateValues = {
      identity: { reporter: "学生甲", credential: "internal-only" },
      purpose: { topic: "社区劳动", privateNote: "不得外传" },
      counteroffer: { headlineControl: false, attribution: true },
    };

    record = (await commit(runtime, record, {
      commitRef: "commit-three-npc-memory",
      sourceWorldEventRef: "world-event-three-npc-memory",
      virtualMinute: 6,
      signalUpdates: {
        student_enters_gate: true,
        first_contact: true,
        placement_rejected_professionally: true,
      },
      npcMemoryUpdates: [
        {
          entityId: "entity-gatekeeper",
          memoryKey: "reporter_identity",
          valueHash: hashAutonomousPrivateValueV4(privateValues.identity),
          publicSummary: "学生已说明记者身份。",
        },
        {
          entityId: "entity-community-source",
          memoryKey: "purpose_explained",
          valueHash: hashAutonomousPrivateValueV4(privateValues.purpose),
          publicSummary: "学生已说明报道面向社区劳动。",
        },
        {
          entityId: "entity-shopkeeper",
          memoryKey: "student_counteroffer",
          valueHash: hashAutonomousPrivateValueV4(privateValues.counteroffer),
          publicSummary: "学生拒绝标题控制，并提出透明署名方案。",
        },
      ],
    })).record;
    const reloaded = await runtime.getRecord(record.sessionId);
    const serialized = JSON.stringify(reloaded);

    expect(reloaded.npcStates.filter((npc) => npc.memories.length > 0)).toHaveLength(3);
    expect(serialized).not.toContain("internal-only");
    expect(serialized).not.toContain("不得外传");
    expect(serialized).not.toContain("headlineControl");
    const next = scheduled(await runtime.evaluate({
      sessionId: record.sessionId,
      cycleRef: "cycle-memory-continuation",
      expectedWorldStateVersion: 1,
      triggerKind: "state_threshold",
      triggerRef: "remembered-contact-state",
    }));
    expect([
      "gatekeeper-plan-introduction",
      "community-plan-purpose",
    ]).toContain(next.selectedPlanRef);
  });

  it("暂停时不注入冲突，恢复后才重新开启 NPC 计划", async () => {
    const runtime = director();
    let record = await start(runtime);
    record = (await commit(runtime, record, {
      commitRef: "commit-pause",
      sourceWorldEventRef: "world-event-pause",
      paused: true,
      signalUpdates: { first_contact: true },
    })).record;

    const paused = await runtime.evaluate({
      sessionId: record.sessionId,
      cycleRef: "cycle-paused",
      expectedWorldStateVersion: 1,
      triggerKind: "teacher_event",
      triggerRef: "teacher-paused-session",
    });
    expect(paused).toMatchObject({
      status: "suppressed",
      suppression: { reasonCode: "session_paused" },
      writeDisposition: "zero_write",
    });
    expect((await runtime.getRecord(record.sessionId)).responseWindows).toHaveLength(0);

    record = (await commit(runtime, await runtime.getRecord(record.sessionId), {
      commitRef: "commit-resume",
      sourceWorldEventRef: "world-event-resume",
      paused: false,
    })).record;
    const resumed = scheduled(await runtime.evaluate({
      sessionId: record.sessionId,
      cycleRef: "cycle-resumed",
      expectedWorldStateVersion: 2,
      triggerKind: "teacher_event",
      triggerRef: "teacher-resumed-session",
    }));
    expect(resumed.selectedPlanRef).toBe("community-plan-purpose");
  });

  it("在 JSON 持久化重启后恢复同一候选、NPC 状态和循环幂等结果", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ronggang-world-v4-"));
    temporaryDirectories.push(directory);
    const firstModel = vi.fn(async () => ({
      output: {
        disposition: "select",
        selectedPlanRef: "merchant-plan-offer",
        deferUntilVirtualMinute: null,
        rationale: "素材合作需要先明确权利条件。",
      },
      providerId: "deepseek",
      modelId: "model-v4-test",
      traceRef: "model-trace-before-restart",
      latencyMs: 8,
      estimatedCostMicros: 60,
    }));
    const first = director(new JsonFileAutonomousWorldStoreV4(directory), {
      npcDecisionModel: { decide: firstModel },
    });
    const record = await start(first, {
      sessionId: "session-json-restart",
      initialSignals: { student_inspects_shop_material: true },
    });
    const decision = scheduled(await first.evaluate({
      sessionId: record.sessionId,
      cycleRef: "cycle-before-restart",
      expectedWorldStateVersion: 0,
      triggerKind: "virtual_clock",
      triggerRef: "scheduler-before-restart",
    }));

    const secondModel = vi.fn(async () => {
      throw new Error("同循环重放不应再次调用模型");
    });
    const second = director(new JsonFileAutonomousWorldStoreV4(directory), {
      npcDecisionModel: { decide: secondModel },
    });
    const restored = await second.getRecord(record.sessionId);
    const replayed = await second.evaluate({
      sessionId: record.sessionId,
      cycleRef: "cycle-before-restart",
      expectedWorldStateVersion: 0,
      triggerKind: "virtual_clock",
      triggerRef: "scheduler-before-restart",
    });

    expect(restored.responseWindows).toHaveLength(1);
    expect(restored.planStates.find((plan) => plan.planRef === "merchant-plan-offer"))
      .toMatchObject({ status: "scheduled" });
    expect(restored.npcDecisionReceipts).toHaveLength(1);
    expect(firstModel).toHaveBeenCalledTimes(1);
    expect(secondModel).not.toHaveBeenCalled();
    expect(replayed).toEqual(decision);
    expect((await second.getRecord(record.sessionId)).recordRevision)
      .toBe(restored.recordRevision);
  });

  it("拒绝伪造令牌、未知候选、非法记忆键与同引用异载荷，且全部零写入", async () => {
    const runtime = director();
    let record = await start(runtime, {
      initialSignals: { student_inspects_shop_material: true },
    });
    const decision = scheduled(await runtime.evaluate({
      sessionId: record.sessionId,
      cycleRef: "cycle-security",
      expectedWorldStateVersion: 0,
      triggerKind: "npc_plan",
      triggerRef: "security-test",
    }));
    record = await runtime.getRecord(record.sessionId);
    const beforeRevision = record.recordRevision;
    const drift = await runtime.evaluate({
      sessionId: record.sessionId,
      cycleRef: "cycle-security-version-drift",
      expectedWorldStateVersion: 99,
      triggerKind: "state_threshold",
      triggerRef: "stale-world-reader",
    });
    expect(drift).toMatchObject({
      status: "failed",
      failure: { reasonCode: "version_hash_drift" },
      writeDisposition: "zero_write",
    });
    expect((await runtime.getRecord(record.sessionId)).recordRevision).toBe(beforeRevision);
    const payload = commitPayload(record, {
      commitRef: "commit-secure-candidate",
      sourceWorldEventRef: "world-event-secure-candidate",
      candidateEventId: decision.candidateEvent.candidateEventId,
    });

    await expect(runtime.recordWorldCommit({
      ...payload,
      authorityToken: "worldcommit_forged",
    })).rejects.toThrow("令牌无效");
    expect((await runtime.getRecord(record.sessionId)).recordRevision).toBe(beforeRevision);

    const unknown = { ...payload, candidateEventId: "candidate-event-forged" };
    await expect(runtime.recordWorldCommit({
      ...unknown,
      authorityToken: issueAuthoritativeWorldCommitTokenV4(authoritySecret, unknown),
    })).rejects.toThrow("主动候选不存在");
    expect((await runtime.getRecord(record.sessionId)).recordRevision).toBe(beforeRevision);

    const illegalMemory = {
      ...payload,
      candidateEventId: null,
      npcMemoryUpdates: [{
        entityId: "entity-shopkeeper",
        memoryKey: "private_prompt",
        valueHash: "d".repeat(64),
        publicSummary: null,
      }],
    };
    await expect(runtime.recordWorldCommit({
      ...illegalMemory,
      authorityToken: issueAuthoritativeWorldCommitTokenV4(
        authoritySecret,
        illegalMemory,
      ),
    })).rejects.toThrow("记忆键未在内容中声明");
    expect((await runtime.getRecord(record.sessionId)).recordRevision).toBe(beforeRevision);

    const committed = await runtime.recordWorldCommit({
      ...payload,
      authorityToken: issueAuthoritativeWorldCommitTokenV4(authoritySecret, payload),
    });
    const committedRevision = committed.record.recordRevision;
    const replayed = await runtime.recordWorldCommit({
      ...payload,
      authorityToken: issueAuthoritativeWorldCommitTokenV4(authoritySecret, payload),
    });
    expect(replayed.replayed).toBe(true);
    expect(replayed.record.recordRevision).toBe(committedRevision);

    const reusedRef = { ...payload, virtualMinute: 1 };
    await expect(runtime.recordWorldCommit({
      ...reusedRef,
      authorityToken: issueAuthoritativeWorldCommitTokenV4(
        authoritySecret,
        reusedRef,
      ),
    })).rejects.toThrow("同一世界提交引用被用于不同载荷");
    expect((await runtime.getRecord(record.sessionId)).recordRevision)
      .toBe(committedRevision);
  });

  it("五组种子在同优先级压力中保持可复现但不固化为唯一事件", async () => {
    const selectedPlans: string[] = [];
    const signals = {
      student_enters_gate: true,
      first_contact: true,
      framing_contains_exotic_or_absolute: true,
      conflicting_year_claim_received: true,
    };
    for (const seed of ["seed-a", "seed-b", "seed-c", "seed-d", "seed-e"]) {
      const runtime = director();
      const record = await start(runtime, {
        sessionId: `session-${seed}`,
        seed,
        initialSignals: signals,
      });
      const first = scheduled(await runtime.evaluate({
        sessionId: record.sessionId,
        cycleRef: `cycle-${seed}`,
        expectedWorldStateVersion: 0,
        triggerKind: "state_threshold",
        triggerRef: "multi-plan-state",
      }));
      const replay = await runtime.evaluate({
        sessionId: record.sessionId,
        cycleRef: `cycle-${seed}`,
        expectedWorldStateVersion: 0,
        triggerKind: "state_threshold",
        triggerRef: "multi-plan-state",
      });
      expect(replay).toEqual(first);
      selectedPlans.push(first.selectedPlanRef);
    }

    expect(new Set(selectedPlans).size).toBeGreaterThan(1);
    expect(selectedPlans.every((planRef) => [
      "gatekeeper-plan-introduction",
      "community-plan-purpose",
      "inheritor-plan-challenge",
      "researcher-plan-source-level",
    ].includes(planRef))).toBe(true);
  });

  it("三种信号到达顺序收敛为同一世界选择，不依赖对象插入顺序", async () => {
    const orders = [
      ["student_enters_gate", "first_contact", "framing_contains_exotic_or_absolute"],
      ["framing_contains_exotic_or_absolute", "student_enters_gate", "first_contact"],
      ["first_contact", "framing_contains_exotic_or_absolute", "student_enters_gate"],
    ];
    const selected: string[] = [];
    for (const [orderIndex, order] of orders.entries()) {
      const runtime = director();
      let record = await start(runtime, {
        sessionId: `session-order-${orderIndex}`,
        seed: "seed-order-invariant",
      });
      for (const [signalIndex, signalId] of order.entries()) {
        record = (await commit(runtime, record, {
          commitRef: `commit-order-${orderIndex}-${signalIndex}`,
          sourceWorldEventRef: `world-event-order-${orderIndex}-${signalIndex}`,
          signalUpdates: { [signalId]: true },
        })).record;
      }
      const decision = scheduled(await runtime.evaluate({
        sessionId: record.sessionId,
        cycleRef: `cycle-order-${orderIndex}`,
        expectedWorldStateVersion: 3,
        triggerKind: "state_threshold",
        triggerRef: "same-final-signals",
      }));
      selected.push(decision.selectedPlanRef);
    }
    expect(new Set(selected).size).toBe(1);
  });

  it("响应窗口超时后释放压力预算，并以新候选重新调度未完成计划", async () => {
    const runtime = director();
    let record = await start(runtime, {
      initialSignals: { student_inspects_shop_material: true },
    });
    const first = scheduled(await runtime.evaluate({
      sessionId: record.sessionId,
      cycleRef: "cycle-expiry-first",
      expectedWorldStateVersion: 0,
      triggerKind: "virtual_clock",
      triggerRef: "clock-zero",
    }));
    record = await runtime.getRecord(record.sessionId);
    const expiresAt = first.candidateEvent.expiresVirtualMinute;
    record = (await commit(runtime, record, {
      commitRef: "commit-clock-expiry",
      sourceWorldEventRef: "world-event-clock-expiry",
      virtualMinute: expiresAt,
    })).record;

    expect(record.responseWindows[0]?.status).toBe("expired");
    expect(record.planStates.find((plan) => plan.planRef === "merchant-plan-offer"))
      .toMatchObject({ status: "pending", candidateEventRef: null });
    const second = scheduled(await runtime.evaluate({
      sessionId: record.sessionId,
      cycleRef: "cycle-expiry-second",
      expectedWorldStateVersion: 1,
      triggerKind: "virtual_clock",
      triggerRef: "clock-after-expiry",
    }));
    expect(second.selectedPlanRef).toBe("merchant-plan-offer");
    expect(second.candidateEvent.candidateEventId)
      .not.toBe(first.candidateEvent.candidateEventId);
  });

  it("服务端调度器无需浏览器继续按钮，并且不会重复派发同一候选", async () => {
    const runtime = director();
    const record = await start(runtime, {
      initialSignals: { student_inspects_shop_material: true },
    });
    const dispatchCandidate = vi.fn(async () => undefined);
    const scheduler = new AutonomousWorldSchedulerV4({
      director: runtime,
      listSessionIds: async () => [record.sessionId, record.sessionId],
      dispatchCandidate,
    });

    const first = await scheduler.runCycle();
    const second = await scheduler.runCycle();

    expect(first).toHaveLength(1);
    expect(first[0]?.status).toBe("scheduled");
    expect(second).toEqual(first);
    expect(dispatchCandidate).toHaveBeenCalledTimes(1);
  });
});
