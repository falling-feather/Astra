import {
  AutonomousWorldDecisionV4Schema,
  FlagshipContentReferenceV4Schema,
  type AutonomousWorldDecisionV4,
  type FlagshipContentReferenceV4,
} from "@ronggang/contracts";

export const AutonomousWorldRecordV4Version =
  "autonomous-world-record/4.0.0" as const;

export type AutonomousSignalValueV4 = boolean | number | string;

export interface AutonomousNpcMemoryV4 {
  memoryKey: string;
  valueHash: string;
  publicSummary: string | null;
  sourceWorldEventRef: string;
  updatedAtWorldStateVersion: number;
}

export interface AutonomousNpcCommitmentV4 {
  commitmentId: string;
  publicSummary: string;
  status: "active" | "kept" | "breached" | "released";
  sourceWorldEventRef: string;
  updatedAtWorldStateVersion: number;
}

export interface AutonomousNpcLocalFactV4 {
  factRef: string;
  confidence: number;
  visibility: "npc_private" | "student_public" | "teacher_public";
  knowledgeRefs: string[];
  sourceWorldEventRef: string;
  updatedAtWorldStateVersion: number;
}

export interface AutonomousNpcStateV4 {
  entityId: string;
  roleId: string;
  revision: number;
  localKnowledgeRefs: string[];
  allowedMemoryKeys: string[];
  memories: AutonomousNpcMemoryV4[];
  commitments: AutonomousNpcCommitmentV4[];
  localFacts: AutonomousNpcLocalFactV4[];
  lastPublicActionMinute: number | null;
}

export interface AutonomousPlanStateV4 {
  planRef: string;
  actorEntityRef: string;
  status: "pending" | "scheduled" | "committed" | "suppressed";
  evaluationCount: number;
  lastEvaluatedWorldStateVersion: number | null;
  candidateEventRef: string | null;
  committedWorldEventRef: string | null;
  deferredUntilVirtualMinute: number | null;
}

export interface AutonomousNpcDecisionReceiptV4 {
  cycleRef: string;
  decisionId: string;
  inputHash: string;
  mode: "model" | "deterministic_fallback";
  disposition: "select" | "defer" | "no_action";
  selectedPlanRef: string | null;
  deferUntilVirtualMinute: number | null;
  safeRationale: string;
  fallbackReason:
    | "model_not_configured"
    | "session_budget_exhausted"
    | "model_timeout"
    | "model_error"
    | "model_invalid_output"
    | "model_cost_exceeded"
    | null;
  providerId: string | null;
  modelId: string | null;
  traceRef: string | null;
  latencyMs: number | null;
  estimatedCostMicros: number;
}

export interface AutonomousResponseWindowV4 {
  responseWindowId: string;
  candidateEventId: string;
  planRef: string;
  actorEntityRef: string;
  openedAtVirtualMinute: number;
  expiresAtVirtualMinute: number;
  status: "open" | "committed" | "expired" | "cancelled";
  committedWorldEventRef: string | null;
}

export interface AutonomousCycleReceiptV4 {
  cycleRef: string;
  sourceStateHash: string;
  decisionId: string;
}

export interface AutonomousWorldCommitReceiptV4 {
  commitRef: string;
  commitPayloadHash: string;
  sourceWorldStateVersion: number;
  resultingWorldStateVersion: number;
  sourceWorldEventRef: string;
}

export interface AutonomousWorldRecordV4 {
  recordVersion: typeof AutonomousWorldRecordV4Version;
  recordRevision: number;
  sessionId: string;
  flagshipContentRef: FlagshipContentReferenceV4;
  challengeLevel: 3 | 4 | 5 | 6 | 7;
  seed: string;
  currentWorldStateVersion: number;
  virtualMinute: number;
  paused: boolean;
  endingStatus: "active" | "completed" | "recoverable_failure";
  signals: Record<string, AutonomousSignalValueV4>;
  variables: Record<string, number>;
  npcStates: AutonomousNpcStateV4[];
  planStates: AutonomousPlanStateV4[];
  responseWindows: AutonomousResponseWindowV4[];
  decisions: AutonomousWorldDecisionV4[];
  npcDecisionReceipts: AutonomousNpcDecisionReceiptV4[];
  cycleReceipts: AutonomousCycleReceiptV4[];
  commitReceipts: AutonomousWorldCommitReceiptV4[];
  createdAt: string;
  updatedAt: string;
}

const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:/@-]*$/u;
const hashPattern = /^[a-f0-9]{64}$/u;
const signalPattern = /^[a-z][a-z0-9_]{0,127}$/u;

function assertRecord(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`V4 自主世界记录非法：${message}`);
}

function unique(values: readonly string[], label: string): void {
  assertRecord(new Set(values).size === values.length, `${label} 不得重复`);
}

function validDate(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

export function validateAutonomousWorldRecordV4(
  value: AutonomousWorldRecordV4,
): AutonomousWorldRecordV4 {
  const normalized = structuredClone(value) as AutonomousWorldRecordV4;
  const legacy = normalized as AutonomousWorldRecordV4 & {
    npcDecisionReceipts?: AutonomousNpcDecisionReceiptV4[];
    planStates: Array<AutonomousPlanStateV4 & {
      deferredUntilVirtualMinute?: number | null;
    }>;
  };
  legacy.npcDecisionReceipts ??= [];
  legacy.planStates = legacy.planStates.map((plan) => ({
    ...plan,
    deferredUntilVirtualMinute: plan.deferredUntilVirtualMinute ?? null,
  }));
  value = normalized;
  assertRecord(
    value.recordVersion === AutonomousWorldRecordV4Version,
    "记录版本不支持",
  );
  assertRecord(
    Number.isInteger(value.recordRevision) && value.recordRevision >= 0,
    "记录修订号非法",
  );
  assertRecord(idPattern.test(value.sessionId), "会话 ID 非法");
  FlagshipContentReferenceV4Schema.parse(value.flagshipContentRef);
  assertRecord([3, 4, 5, 6, 7].includes(value.challengeLevel), "挑战等级非法");
  assertRecord(value.seed.trim().length > 0 && value.seed.length <= 128, "种子非法");
  assertRecord(
    Number.isInteger(value.currentWorldStateVersion)
      && value.currentWorldStateVersion >= 0,
    "世界版本非法",
  );
  assertRecord(
    Number.isInteger(value.virtualMinute)
      && value.virtualMinute >= 0
      && value.virtualMinute <= 60,
    "虚拟分钟非法",
  );
  assertRecord(typeof value.paused === "boolean", "暂停状态非法");
  assertRecord(
    ["active", "completed", "recoverable_failure"].includes(value.endingStatus),
    "结局状态非法",
  );
  assertRecord(validDate(value.createdAt) && validDate(value.updatedAt), "时间戳非法");
  for (const [signalId, signalValue] of Object.entries(value.signals)) {
    assertRecord(signalPattern.test(signalId), `信号 ID 非法：${signalId}`);
    assertRecord(
      typeof signalValue === "boolean"
        || typeof signalValue === "string"
        || (typeof signalValue === "number" && Number.isFinite(signalValue)),
      `信号值非法：${signalId}`,
    );
  }
  for (const [variableId, variableValue] of Object.entries(value.variables)) {
    assertRecord(signalPattern.test(variableId), `变量 ID 非法：${variableId}`);
    assertRecord(
      Number.isFinite(variableValue) && variableValue >= 0 && variableValue <= 100,
      `变量值非法：${variableId}`,
    );
  }

  const npcIds = value.npcStates.map((npc) => npc.entityId);
  unique(npcIds, "NPC");
  for (const npc of value.npcStates) {
    assertRecord(idPattern.test(npc.entityId) && idPattern.test(npc.roleId), "NPC 引用非法");
    assertRecord(Number.isInteger(npc.revision) && npc.revision >= 0, "NPC 修订非法");
    unique(npc.localKnowledgeRefs, `${npc.entityId} 本地知识`);
    unique(npc.allowedMemoryKeys, `${npc.entityId} 记忆键`);
    unique(npc.memories.map((memory) => memory.memoryKey), `${npc.entityId} 记忆`);
    for (const memory of npc.memories) {
      assertRecord(npc.allowedMemoryKeys.includes(memory.memoryKey), "NPC 使用未声明记忆键");
      assertRecord(hashPattern.test(memory.valueHash), "NPC 记忆哈希非法");
      assertRecord(
        memory.publicSummary === null
          || (memory.publicSummary.trim().length > 0 && memory.publicSummary.length <= 500),
        "NPC 公开记忆摘要非法",
      );
      assertRecord(idPattern.test(memory.sourceWorldEventRef), "NPC 记忆来源非法");
      assertRecord(
        Number.isInteger(memory.updatedAtWorldStateVersion)
          && memory.updatedAtWorldStateVersion <= value.currentWorldStateVersion,
        "NPC 记忆版本非法",
      );
    }
    unique(
      npc.commitments.map((commitment) => commitment.commitmentId),
      `${npc.entityId} 承诺`,
    );
    for (const commitment of npc.commitments) {
      assertRecord(idPattern.test(commitment.commitmentId), "NPC 承诺 ID 非法");
      assertRecord(commitment.publicSummary.trim().length > 0, "NPC 承诺摘要为空");
      assertRecord(idPattern.test(commitment.sourceWorldEventRef), "NPC 承诺来源非法");
    }
    unique(npc.localFacts.map((fact) => fact.factRef), `${npc.entityId} 局部事实`);
    for (const fact of npc.localFacts) {
      assertRecord(idPattern.test(fact.factRef), "NPC 局部事实 ID 非法");
      assertRecord(fact.confidence >= 0 && fact.confidence <= 1, "NPC 局部事实置信非法");
      unique(fact.knowledgeRefs, `${npc.entityId} 局部事实知识引用`);
      assertRecord(idPattern.test(fact.sourceWorldEventRef), "NPC 局部事实来源非法");
    }
    assertRecord(
      npc.lastPublicActionMinute === null
        || (Number.isInteger(npc.lastPublicActionMinute)
          && npc.lastPublicActionMinute >= 0
          && npc.lastPublicActionMinute <= value.virtualMinute),
      "NPC 最近行动分钟非法",
    );
  }

  const planRefs = value.planStates.map((plan) => plan.planRef);
  unique(planRefs, "NPC 计划");
  for (const plan of value.planStates) {
    assertRecord(idPattern.test(plan.planRef), "NPC 计划 ID 非法");
    assertRecord(npcIds.includes(plan.actorEntityRef), "NPC 计划角色不存在");
    assertRecord(
      Number.isInteger(plan.evaluationCount) && plan.evaluationCount >= 0,
      "NPC 计划评估次数非法",
    );
    if (plan.status === "scheduled") {
      assertRecord(plan.candidateEventRef !== null, "已调度计划缺少候选事件");
    }
    if (plan.status === "committed") {
      assertRecord(plan.committedWorldEventRef !== null, "已提交计划缺少世界事件");
    }
    assertRecord(
      plan.deferredUntilVirtualMinute === null
        || (Number.isInteger(plan.deferredUntilVirtualMinute)
          && plan.deferredUntilVirtualMinute >= 0
          && plan.deferredUntilVirtualMinute <= 60),
      "NPC 计划延迟分钟非法",
    );
  }

  const windowIds = value.responseWindows.map((window) => window.responseWindowId);
  const candidateIds = value.responseWindows.map((window) => window.candidateEventId);
  unique(windowIds, "主动回应窗口");
  unique(candidateIds, "主动候选事件");
  for (const window of value.responseWindows) {
    assertRecord(idPattern.test(window.responseWindowId), "主动窗口 ID 非法");
    assertRecord(planRefs.includes(window.planRef), "主动窗口计划不存在");
    assertRecord(npcIds.includes(window.actorEntityRef), "主动窗口 NPC 不存在");
    assertRecord(
      window.expiresAtVirtualMinute > window.openedAtVirtualMinute
        && window.expiresAtVirtualMinute <= 60,
      "主动窗口时间非法",
    );
    if (window.status === "committed") {
      assertRecord(window.committedWorldEventRef !== null, "已提交窗口缺世界事件");
    }
  }

  const decisions = value.decisions.map((decision) =>
    AutonomousWorldDecisionV4Schema.parse(decision));
  unique(decisions.map((decision) => decision.autonomyDecisionId), "自主决定");
  for (const decision of decisions) {
    assertRecord(decision.sessionId === value.sessionId, "自主决定跨会话");
    assertRecord(
      decision.flagshipContentRef.contentHash === value.flagshipContentRef.contentHash,
      "自主决定内容哈希漂移",
    );
    if (decision.status === "scheduled") {
      assertRecord(
        candidateIds.includes(decision.candidateEvent.candidateEventId),
        "已调度决定缺少响应窗口",
      );
    }
  }
  unique(
    value.npcDecisionReceipts.map((receipt) => receipt.cycleRef),
    "NPC 决策收据",
  );
  for (const receipt of value.npcDecisionReceipts) {
    assertRecord(idPattern.test(receipt.cycleRef), "NPC 决策循环引用非法");
    assertRecord(idPattern.test(receipt.decisionId), "NPC 决策引用非法");
    assertRecord(hashPattern.test(receipt.inputHash), "NPC 决策输入哈希非法");
    assertRecord(
      decisions.some((decision) => decision.autonomyDecisionId === receipt.decisionId),
      "NPC 决策收据缺少对应公开决定",
    );
    assertRecord(
      receipt.safeRationale.trim().length > 0
        && receipt.safeRationale.length <= 500,
      "NPC 决策安全理由非法",
    );
    assertRecord(
      Number.isInteger(receipt.estimatedCostMicros)
        && receipt.estimatedCostMicros >= 0,
      "NPC 决策成本非法",
    );
    const providerFields = [
      receipt.providerId,
      receipt.modelId,
      receipt.traceRef,
      receipt.latencyMs,
    ];
    assertRecord(
      providerFields.every((field) => field === null)
        || providerFields.every((field) => field !== null),
      "NPC 决策模型收据字段必须同时存在或同时为空",
    );
    if (receipt.traceRef !== null) {
      assertRecord(
        receipt.providerId!.trim().length > 0
          && receipt.modelId!.trim().length > 0
          && idPattern.test(receipt.traceRef),
        "NPC 决策模型引用非法",
      );
      assertRecord(
        Number.isFinite(receipt.latencyMs) && receipt.latencyMs! >= 0,
        "NPC 决策模型延迟非法",
      );
    }
    if (receipt.mode === "model") {
      assertRecord(receipt.fallbackReason === null, "模型决策不得携带降级原因");
      assertRecord(receipt.providerId !== null, "模型决策缺少私有运行收据");
    } else {
      assertRecord(receipt.fallbackReason !== null, "确定性降级缺少原因");
    }
    if (receipt.disposition === "no_action") {
      assertRecord(
        receipt.selectedPlanRef === null && receipt.deferUntilVirtualMinute === null,
        "无动作决定不得选择或延迟计划",
      );
    } else {
      assertRecord(
        receipt.selectedPlanRef !== null && planRefs.includes(receipt.selectedPlanRef),
        "NPC 决策选择了内容包外计划",
      );
      assertRecord(
        receipt.disposition === "defer"
          ? receipt.deferUntilVirtualMinute !== null
          : receipt.deferUntilVirtualMinute === null,
        "NPC 决策延迟字段与处置不一致",
      );
    }
  }
  unique(value.cycleReceipts.map((receipt) => receipt.cycleRef), "自主循环收据");
  for (const receipt of value.cycleReceipts) {
    assertRecord(hashPattern.test(receipt.sourceStateHash), "循环状态哈希非法");
    assertRecord(
      decisions.some((decision) => decision.autonomyDecisionId === receipt.decisionId),
      "循环收据决定不存在",
    );
  }
  unique(value.commitReceipts.map((receipt) => receipt.commitRef), "世界提交收据");
  for (const receipt of value.commitReceipts) {
    assertRecord(hashPattern.test(receipt.commitPayloadHash), "提交载荷哈希非法");
    assertRecord(
      receipt.resultingWorldStateVersion === receipt.sourceWorldStateVersion + 1,
      "世界提交版本必须单步前进",
    );
    assertRecord(idPattern.test(receipt.sourceWorldEventRef), "世界提交事件非法");
  }
  return structuredClone({ ...value, decisions });
}
