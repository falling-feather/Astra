import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  AutonomousWorldDecisionV4Schema,
  AutonomousWorldDecisionV4SchemaVersion,
  FlagshipContentReferenceV4Schema,
  type AutonomousWorldDecisionV4,
  type FlagshipContentReferenceV4,
} from "@ronggang/contracts";
import {
  type XunpuChallengeProfileV4,
  type XunpuFlagshipContentV4,
  type XunpuNpcV4,
} from "@ronggang/course-content";
import {
  AutonomousWorldRecordNotFoundError,
  AutonomousWorldStoreConflictError,
  type AutonomousWorldStoreV4,
} from "./autonomous-world-v4-store.js";
import {
  AutonomousWorldRecordV4Version,
  validateAutonomousWorldRecordV4,
  type AutonomousNpcCommitmentV4,
  type AutonomousNpcLocalFactV4,
  type AutonomousNpcMemoryV4,
  type AutonomousNpcDecisionReceiptV4,
  type AutonomousSignalValueV4,
  type AutonomousWorldRecordV4,
} from "./autonomous-world-v4-types.js";

export const XunpuAutonomousWorldRuntimeV4Version =
  "xunpu-autonomous-world-runtime/4.0.0" as const;
export const AutonomousNpcDecisionRuntimeV4Version =
  "autonomous-npc-decision-runtime/4.0.0" as const;

export interface CompiledAutonomyPlanV4 {
  planRef: string;
  actorEntityRef: string;
  triggerExpression: string;
  intent: string;
  eventTemplateRef: string;
  publicCue: string;
  affectedObjectRefs: string[];
  priority: number;
  responseWindowMinutes: number;
}

export interface StartAutonomousWorldV4Input {
  sessionId: string;
  flagshipContentRef: FlagshipContentReferenceV4;
  challengeLevel: 3 | 4 | 5 | 6 | 7;
  seed: string;
  initialWorldStateVersion: number;
  initialVirtualMinute?: number;
  initialVariableValues?: Record<string, number>;
  initialSignals?: Record<string, AutonomousSignalValueV4>;
  startedAt?: string;
}

export interface EvaluateAutonomousWorldV4Input {
  sessionId: string;
  cycleRef: string;
  expectedWorldStateVersion: number;
  triggerKind: "virtual_clock" | "state_threshold" | "npc_plan" | "teacher_event";
  triggerRef: string;
}

export interface AutonomousNpcDecisionCandidateV4 {
  planRef: string;
  actorEntityRef: string;
  professionalRole: string;
  publicGoal: string;
  intent: string;
  affectedObjectRefs: string[];
  refusalConditions: string[];
  recoveryConditions: string[];
  disclosureRules: string[];
  localObservation: {
    triggerSignals: Record<string, AutonomousSignalValueV4>;
    relevantWorldVariables: Record<string, number>;
    publicMemorySummaries: Array<{
      memoryKey: string;
      publicSummary: string;
      updatedAtWorldStateVersion: number;
    }>;
    commitments: Array<{
      commitmentId: string;
      publicSummary: string;
      status: AutonomousNpcCommitmentV4["status"];
    }>;
    localFacts: Array<{
      factRef: string;
      confidence: number;
      visibility: AutonomousNpcLocalFactV4["visibility"];
      knowledgeRefs: string[];
    }>;
    relationshipToReporter: {
      cooperationBand: "guarded" | "provisional" | "collaborative";
      interactionCount: number;
      activeCommitmentCount: number;
      lastPublicActionMinute: number | null;
    };
  };
}

export interface AutonomousNpcDecisionObservationV4 {
  runtimeVersion: typeof AutonomousNpcDecisionRuntimeV4Version;
  contentHash: string;
  sourceWorldStateVersion: number;
  virtualMinute: number;
  challengeLevel: 3 | 4 | 5 | 6 | 7;
  trigger: {
    triggerKind: EvaluateAutonomousWorldV4Input["triggerKind"];
    triggerRef: string;
  };
  remainingConflictSlots: number;
  remainingBudgetMicros: number;
  allowedDispositions: ["select", "defer", "no_action"];
  candidates: AutonomousNpcDecisionCandidateV4[];
}

export interface AutonomousNpcDecisionModelRunV4 {
  output: unknown;
  providerId: string;
  modelId: string;
  traceRef: string;
  latencyMs: number;
  estimatedCostMicros: number;
}

export interface AutonomousNpcDecisionModelV4 {
  decide(
    input: Readonly<AutonomousNpcDecisionObservationV4>,
  ): Promise<AutonomousNpcDecisionModelRunV4>;
}

export interface AutonomousNpcMemoryUpdateV4 {
  entityId: string;
  memoryKey: string;
  valueHash: string;
  publicSummary: string | null;
}

export interface AutonomousNpcCommitmentUpdateV4 {
  entityId: string;
  commitmentId: string;
  publicSummary: string;
  status: AutonomousNpcCommitmentV4["status"];
}

export interface AutonomousNpcLocalFactUpdateV4 {
  entityId: string;
  factRef: string;
  confidence: number;
  visibility: AutonomousNpcLocalFactV4["visibility"];
  knowledgeRefs: string[];
}

export interface AuthoritativeWorldCommitPayloadV4 {
  sessionId: string;
  commitRef: string;
  sourceWorldStateVersion: number;
  resultingWorldStateVersion: number;
  sourceWorldEventRef: string;
  candidateEventId: string | null;
  virtualMinute: number;
  paused: boolean;
  endingStatus: AutonomousWorldRecordV4["endingStatus"];
  signalUpdates: Record<string, AutonomousSignalValueV4>;
  variableValues: Record<string, number>;
  npcMemoryUpdates: AutonomousNpcMemoryUpdateV4[];
  npcCommitmentUpdates: AutonomousNpcCommitmentUpdateV4[];
  npcLocalFactUpdates: AutonomousNpcLocalFactUpdateV4[];
  committedAt: string;
}

export interface AuthoritativeWorldCommitInputV4
  extends AuthoritativeWorldCommitPayloadV4 {
  authorityToken: string;
}

export interface AuthoritativeWorldCommitResultV4 {
  record: AutonomousWorldRecordV4;
  replayed: boolean;
}

export interface XunpuAutonomousWorldDirectorV4Options {
  store: AutonomousWorldStoreV4;
  content: XunpuFlagshipContentV4;
  authoritySecret: string;
  npcDecisionModel?: AutonomousNpcDecisionModelV4;
  npcDecisionTimeoutMs?: number;
  npcDecisionSessionBudgetMicros?: number;
  now?: () => string;
}

export interface AutonomousWorldSchedulerV4Options {
  director: XunpuAutonomousWorldDirectorV4;
  listSessionIds: () => Promise<string[]>;
  dispatchCandidate: (
    decision: Extract<AutonomousWorldDecisionV4, { status: "scheduled" }>,
  ) => Promise<void>;
}

const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:/@-]*$/u;
const hashPattern = /^[a-f0-9]{64}$/u;
const signalIdPattern = /^[a-z][a-z0-9_]{0,127}$/u;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

function canonicalString(value: unknown): string {
  return JSON.stringify(canonical(value));
}

function hash(value: unknown): string {
  return createHash("sha256").update(canonicalString(value)).digest("hex");
}

function stableId(prefix: string, value: unknown): string {
  return `${prefix}-${hash(value).slice(0, 24)}`;
}

function token(secret: string, prefix: string, value: unknown): string {
  return `${prefix}_${createHmac("sha256", secret)
    .update(canonicalString(value))
    .digest("base64url")}`;
}

function tokensMatch(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length
    && timingSafeEqual(leftBuffer, rightBuffer);
}

function assertRuntime(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`V4 自主世界运行失败：${message}`);
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function planPriority(planRef: string, trigger: string): number {
  if (/(?:-boundary|-withdraw(?:al)?|-gate|-response|-postcheck)$/u.test(planRef)) {
    return 95;
  }
  if (/(?:-deadline|-update|-precheck|-scan)$/u.test(planRef)) return 85;
  if (/(?:-introduction|-purpose|-challenge|-source-level)$/u.test(planRef)) {
    return 75;
  }
  if (/world_minute/u.test(trigger)) return 70;
  return 60;
}

function conflictForNpc(content: XunpuFlagshipContentV4, entityId: string) {
  return content.conflictDomains.find((conflict) => (
    conflict.actorRefs.includes(entityId)
  )) ?? null;
}

export function compileXunpuAutonomyPlansV4(
  content: XunpuFlagshipContentV4,
): CompiledAutonomyPlanV4[] {
  const plans = content.cast.flatMap((npc) => npc.planSteps.map((step) => {
    const conflict = conflictForNpc(content, npc.entityId);
    const variableRefs = conflict
      ? unique(conflict.legalRoutes.flatMap((route) => (
          route.stateDeltas.map((delta) => delta.variableId)
        )))
      : [];
    return {
      planRef: step.planStepId,
      actorEntityRef: npc.entityId,
      triggerExpression: step.trigger,
      intent: step.intent,
      eventTemplateRef: `event-template-${step.planStepId}`,
      publicCue: `【教学仿真】${npc.displayName}主动回应：${step.intent}。`,
      affectedObjectRefs: unique([
        npc.entityId,
        ...(conflict?.objectRefs ?? []),
        ...variableRefs,
      ]).slice(0, 24),
      priority: planPriority(step.planStepId, step.trigger),
      responseWindowMinutes: Math.max(
        3,
        Math.min(8, Math.round(content.expectedDurationMinutes / 8)),
      ),
    } satisfies CompiledAutonomyPlanV4;
  }));
  assertRuntime(plans.length > 0 && plans.length <= 32, "自主计划数量超出契约范围");
  assertRuntime(
    new Set(plans.map((plan) => plan.planRef)).size === plans.length,
    "自主计划 ID 重复",
  );
  for (const plan of plans) {
    assertRuntime(idPattern.test(plan.planRef), `计划 ID 非法：${plan.planRef}`);
    assertRuntime(plan.affectedObjectRefs.length > 0, `计划没有受影响对象：${plan.planRef}`);
    assertRuntime(plan.publicCue.length <= 600, `计划公开提示过长：${plan.planRef}`);
  }
  return plans;
}

function challengeProfile(
  content: XunpuFlagshipContentV4,
  level: number,
): XunpuChallengeProfileV4 {
  const profile = content.challengeProfiles.find(
    (candidate) => candidate.challengeLevel === level,
  );
  assertRuntime(profile !== undefined, `挑战等级没有内容配置：${level}`);
  return profile;
}

function npcDefinition(
  content: XunpuFlagshipContentV4,
  entityId: string,
): XunpuNpcV4 {
  const npc = content.cast.find((candidate) => candidate.entityId === entityId);
  assertRuntime(npc !== undefined, `NPC 不存在：${entityId}`);
  return npc;
}

function signalNumber(
  identifier: string,
  record: AutonomousWorldRecordV4,
): number | null {
  if (identifier === "world_minute") return record.virtualMinute;
  const signal = record.signals[identifier];
  return typeof signal === "number" && Number.isFinite(signal) ? signal : null;
}

function signalTruth(identifier: string, record: AutonomousWorldRecordV4): boolean {
  if (identifier === "world_minute") return record.virtualMinute > 0;
  const value = record.signals[identifier];
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  return typeof value === "string" && value.length > 0;
}

function evaluateTriggerAtom(
  atomInput: string,
  record: AutonomousWorldRecordV4,
): boolean {
  const atom = atomInput.trim();
  const negated = atom.match(/^!([a-z][a-z0-9_]*)$/u);
  if (negated) return !signalTruth(negated[1]!, record);
  const comparison = atom.match(
    /^([a-z][a-z0-9_]*)\s*(>=|>|<=|<|==)\s*([a-z][a-z0-9_]*|\d+)$/u,
  );
  if (comparison) {
    const left = signalNumber(comparison[1]!, record);
    const literal = Number(comparison[3]);
    const right = Number.isFinite(literal)
      ? literal
      : signalNumber(comparison[3]!, record);
    if (left === null || right === null) return false;
    switch (comparison[2]) {
      case ">=": return left >= right;
      case ">": return left > right;
      case "<=": return left <= right;
      case "<": return left < right;
      case "==": return left === right;
    }
  }
  assertRuntime(
    /^[a-z][a-z0-9_]*$/u.test(atom),
    `不支持的计划触发表达式：${atomInput}`,
  );
  return signalTruth(atom, record);
}

export function evaluateAutonomyTriggerV4(
  expression: string,
  record: AutonomousWorldRecordV4,
): boolean {
  const atoms = expression.split("&&").map((atom) => atom.trim());
  assertRuntime(atoms.length > 0 && atoms.every((atom) => atom.length > 0), "计划触发为空");
  return atoms.every((atom) => evaluateTriggerAtom(atom, record));
}

function stateHash(record: AutonomousWorldRecordV4): string {
  return hash({
    sessionId: record.sessionId,
    contentHash: record.flagshipContentRef.contentHash,
    worldStateVersion: record.currentWorldStateVersion,
    virtualMinute: record.virtualMinute,
    paused: record.paused,
    endingStatus: record.endingStatus,
    signals: record.signals,
    variables: record.variables,
    planStates: record.planStates.map((plan) => ({
      planRef: plan.planRef,
      status: plan.status,
      candidateEventRef: plan.candidateEventRef,
      committedWorldEventRef: plan.committedWorldEventRef,
      deferredUntilVirtualMinute: plan.deferredUntilVirtualMinute,
    })),
    npcStates: record.npcStates.map((npc) => ({
      entityId: npc.entityId,
      revision: npc.revision,
      memories: npc.memories,
      commitments: npc.commitments,
      localFacts: npc.localFacts,
      lastPublicActionMinute: npc.lastPublicActionMinute,
    })),
    openWindows: record.responseWindows.filter((window) => window.status === "open")
      .map((window) => ({
        candidateEventId: window.candidateEventId,
        expiresAtVirtualMinute: window.expiresAtVirtualMinute,
      })),
  });
}

function seedRank(seed: string, planRef: string, worldVersion: number): number {
  return Number.parseInt(hash({ seed, planRef, worldVersion }).slice(0, 12), 16);
}

function triggerSignalIds(expression: string): string[] {
  return unique(
    [...expression.matchAll(/[a-z][a-z0-9_]*/gu)]
      .map((match) => match[0]!)
      .filter((identifier) => identifier !== "world_minute"),
  );
}

function cooperationBand(record: AutonomousWorldRecordV4) {
  const trust = record.variables.community_trust ?? 50;
  if (trust < 35) return "guarded" as const;
  if (trust >= 65) return "collaborative" as const;
  return "provisional" as const;
}

export function buildAutonomousNpcDecisionObservationV4(input: {
  content: XunpuFlagshipContentV4;
  record: AutonomousWorldRecordV4;
  candidates: readonly CompiledAutonomyPlanV4[];
  trigger: Pick<EvaluateAutonomousWorldV4Input, "triggerKind" | "triggerRef">;
  remainingConflictSlots: number;
  remainingBudgetMicros: number;
}): AutonomousNpcDecisionObservationV4 {
  return {
    runtimeVersion: AutonomousNpcDecisionRuntimeV4Version,
    contentHash: input.record.flagshipContentRef.contentHash,
    sourceWorldStateVersion: input.record.currentWorldStateVersion,
    virtualMinute: input.record.virtualMinute,
    challengeLevel: input.record.challengeLevel,
    trigger: { ...input.trigger },
    remainingConflictSlots: input.remainingConflictSlots,
    remainingBudgetMicros: input.remainingBudgetMicros,
    allowedDispositions: ["select", "defer", "no_action"],
    candidates: input.candidates.map((plan) => {
      const npc = npcDefinition(input.content, plan.actorEntityRef);
      const state = input.record.npcStates.find((candidate) => (
        candidate.entityId === plan.actorEntityRef
      ));
      assertRuntime(state !== undefined, `NPC 状态不存在：${plan.actorEntityRef}`);
      const signalIds = triggerSignalIds(plan.triggerExpression);
      const relevantVariableIds = plan.affectedObjectRefs.filter((reference) => (
        Object.hasOwn(input.record.variables, reference)
      ));
      return {
        planRef: plan.planRef,
        actorEntityRef: plan.actorEntityRef,
        professionalRole: npc.professionalRole,
        publicGoal: npc.publicGoal,
        intent: plan.intent,
        affectedObjectRefs: [...plan.affectedObjectRefs],
        refusalConditions: [...npc.refusalConditions],
        recoveryConditions: [...npc.recoveryConditions],
        disclosureRules: [...npc.disclosureRules],
        localObservation: {
          triggerSignals: Object.fromEntries(signalIds.flatMap((signalId) => (
            Object.hasOwn(input.record.signals, signalId)
              ? [[signalId, input.record.signals[signalId]!]]
              : []
          ))),
          relevantWorldVariables: Object.fromEntries(relevantVariableIds.map(
            (variableId) => [variableId, input.record.variables[variableId]!],
          )),
          publicMemorySummaries: state.memories.flatMap((memory) => (
            memory.publicSummary === null
              ? []
              : [{
                  memoryKey: memory.memoryKey,
                  publicSummary: memory.publicSummary,
                  updatedAtWorldStateVersion: memory.updatedAtWorldStateVersion,
                }]
          )),
          commitments: state.commitments.map((commitment) => ({
            commitmentId: commitment.commitmentId,
            publicSummary: commitment.publicSummary,
            status: commitment.status,
          })),
          localFacts: state.localFacts.map((fact) => ({
            factRef: fact.factRef,
            confidence: fact.confidence,
            visibility: fact.visibility,
            knowledgeRefs: [...fact.knowledgeRefs],
          })),
          relationshipToReporter: {
            cooperationBand: cooperationBand(input.record),
            interactionCount: state.memories.length
              + state.commitments.length
              + state.localFacts.length,
            activeCommitmentCount: state.commitments.filter(
              (commitment) => commitment.status === "active",
            ).length,
            lastPublicActionMinute: state.lastPublicActionMinute,
          },
        },
      };
    }),
  };
}

function expireWindows(record: AutonomousWorldRecordV4): void {
  for (const window of record.responseWindows) {
    if (window.status !== "open" || window.expiresAtVirtualMinute > record.virtualMinute) {
      continue;
    }
    window.status = "expired";
    const plan = record.planStates.find((candidate) => candidate.planRef === window.planRef);
    if (plan?.status === "scheduled"
      && plan.candidateEventRef === window.candidateEventId) {
      plan.status = "pending";
      plan.candidateEventRef = null;
    }
  }
}

function refusalDecision(input: {
  record: AutonomousWorldRecordV4;
  plans: readonly CompiledAutonomyPlanV4[];
  cycle: EvaluateAutonomousWorldV4Input;
  now: string;
  reasonCode: "version_hash_drift" | "invalid_plan" | "unauthorized_scope" | "resolution_unavailable";
  safeMessage: string;
}): AutonomousWorldDecisionV4 {
  const observedStateHash = stateHash(input.record);
  return AutonomousWorldDecisionV4Schema.parse({
    schemaVersion: AutonomousWorldDecisionV4SchemaVersion,
    autonomyDecisionId: stableId("autonomy-decision", {
      cycleRef: input.cycle.cycleRef,
      observedStateHash,
      reasonCode: input.reasonCode,
    }),
    sessionId: input.record.sessionId,
    flagshipContentRef: input.record.flagshipContentRef,
    sourceWorldStateVersion: input.record.currentWorldStateVersion,
    virtualMinute: input.record.virtualMinute,
    trigger: {
      triggerKind: input.cycle.triggerKind,
      triggerRef: input.cycle.triggerRef,
      observedStateHash,
    },
    evaluatedPlanRefs: input.plans.map((plan) => plan.planRef),
    evaluatedAt: input.now,
    status: "failed",
    selectedPlanRef: null,
    candidateEvent: null,
    suppression: null,
    failure: { reasonCode: input.reasonCode, safeMessage: input.safeMessage },
    writeDisposition: "zero_write",
  });
}

function suppressionDecision(input: {
  record: AutonomousWorldRecordV4;
  plans: readonly CompiledAutonomyPlanV4[];
  cycle: EvaluateAutonomousWorldV4Input;
  now: string;
  observedStateHash?: string;
  reasonCode:
    | "cooldown_not_elapsed"
    | "preconditions_not_met"
    | "conflict_budget_exhausted"
    | "higher_priority_plan_selected"
    | "session_paused"
    | "no_public_window"
    | "npc_decision_deferred"
    | "npc_decision_no_action";
  safeReason: string;
}): AutonomousWorldDecisionV4 {
  const observedStateHash = input.observedStateHash ?? stateHash(input.record);
  return AutonomousWorldDecisionV4Schema.parse({
    schemaVersion: AutonomousWorldDecisionV4SchemaVersion,
    autonomyDecisionId: stableId("autonomy-decision", {
      cycleRef: input.cycle.cycleRef,
      observedStateHash,
      reasonCode: input.reasonCode,
    }),
    sessionId: input.record.sessionId,
    flagshipContentRef: input.record.flagshipContentRef,
    sourceWorldStateVersion: input.record.currentWorldStateVersion,
    virtualMinute: input.record.virtualMinute,
    trigger: {
      triggerKind: input.cycle.triggerKind,
      triggerRef: input.cycle.triggerRef,
      observedStateHash,
    },
    evaluatedPlanRefs: input.plans.map((plan) => plan.planRef),
    evaluatedAt: input.now,
    status: "suppressed",
    selectedPlanRef: null,
    candidateEvent: null,
    suppression: { reasonCode: input.reasonCode, safeReason: input.safeReason },
    failure: null,
    writeDisposition: "zero_write",
  });
}

export function hashAutonomousPrivateValueV4(value: unknown): string {
  return hash(value);
}

export function issueAuthoritativeWorldCommitTokenV4(
  authoritySecret: string,
  payload: AuthoritativeWorldCommitPayloadV4,
): string {
  assertRuntime(authoritySecret.length >= 32, "权威提交密钥至少需要 32 个字符");
  return token(authoritySecret, "worldcommit", payload);
}

type AutonomousNpcDecisionSelectionV4 = Omit<
  AutonomousNpcDecisionReceiptV4,
  "cycleRef" | "decisionId" | "inputHash"
> & { inputHash: string };

class AutonomousNpcDecisionTimeoutError extends Error {}
class AutonomousNpcDecisionOutputError extends Error {}

function validModelReceiptMetadata(
  run: AutonomousNpcDecisionModelRunV4,
): boolean {
  return run.providerId.trim().length > 0
    && run.providerId.length <= 100
    && run.modelId.trim().length > 0
    && run.modelId.length <= 200
    && idPattern.test(run.traceRef)
    && Number.isFinite(run.latencyMs)
    && run.latencyMs >= 0
    && Number.isInteger(run.estimatedCostMicros)
    && run.estimatedCostMicros >= 0;
}

function parseNpcDecisionOutput(input: {
  output: unknown;
  candidates: readonly CompiledAutonomyPlanV4[];
  virtualMinute: number;
}): {
  disposition: "select" | "defer" | "no_action";
  selectedPlanRef: string | null;
  deferUntilVirtualMinute: number | null;
  rationale: string;
} {
  if (!input.output || typeof input.output !== "object" || Array.isArray(input.output)) {
    throw new AutonomousNpcDecisionOutputError("模型输出不是对象");
  }
  const output = input.output as Record<string, unknown>;
  const expectedKeys = [
    "deferUntilVirtualMinute",
    "disposition",
    "rationale",
    "selectedPlanRef",
  ];
  if (Object.keys(output).sort().join("|") !== expectedKeys.join("|")) {
    throw new AutonomousNpcDecisionOutputError("模型输出字段不符合冻结结构");
  }
  if (!(["select", "defer", "no_action"] as const).includes(
    output.disposition as "select" | "defer" | "no_action",
  )) {
    throw new AutonomousNpcDecisionOutputError("模型处置类型非法");
  }
  if (typeof output.rationale !== "string"
    || output.rationale.trim().length === 0
    || output.rationale.length > 500) {
    throw new AutonomousNpcDecisionOutputError("模型决策理由非法");
  }
  const disposition = output.disposition as "select" | "defer" | "no_action";
  const candidateRefs = new Set(input.candidates.map((candidate) => candidate.planRef));
  if (disposition === "no_action") {
    if (output.selectedPlanRef !== null || output.deferUntilVirtualMinute !== null) {
      throw new AutonomousNpcDecisionOutputError("无动作输出不得携带计划或延迟时间");
    }
    return {
      disposition,
      selectedPlanRef: null,
      deferUntilVirtualMinute: null,
      rationale: output.rationale.trim(),
    };
  }
  if (typeof output.selectedPlanRef !== "string"
    || !candidateRefs.has(output.selectedPlanRef)) {
    throw new AutonomousNpcDecisionOutputError("模型选择了未签发计划");
  }
  if (disposition === "select") {
    if (output.deferUntilVirtualMinute !== null) {
      throw new AutonomousNpcDecisionOutputError("立即选择不得携带延迟时间");
    }
    return {
      disposition,
      selectedPlanRef: output.selectedPlanRef,
      deferUntilVirtualMinute: null,
      rationale: output.rationale.trim(),
    };
  }
  if (!Number.isInteger(output.deferUntilVirtualMinute)
    || Number(output.deferUntilVirtualMinute) <= input.virtualMinute
    || Number(output.deferUntilVirtualMinute) > 60) {
    throw new AutonomousNpcDecisionOutputError("模型延迟时间超出当前世界窗口");
  }
  return {
    disposition,
    selectedPlanRef: output.selectedPlanRef,
    deferUntilVirtualMinute: Number(output.deferUntilVirtualMinute),
    rationale: output.rationale.trim(),
  };
}

async function withNpcDecisionTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new AutonomousNpcDecisionTimeoutError("NPC 模型决策超时")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

export class XunpuAutonomousWorldDirectorV4 {
  readonly #store: AutonomousWorldStoreV4;
  readonly #content: XunpuFlagshipContentV4;
  readonly #plans: CompiledAutonomyPlanV4[];
  readonly #authoritySecret: string;
  readonly #npcDecisionModel: AutonomousNpcDecisionModelV4 | undefined;
  readonly #npcDecisionTimeoutMs: number;
  readonly #npcDecisionSessionBudgetMicros: number;
  readonly #now: () => string;

  constructor(options: XunpuAutonomousWorldDirectorV4Options) {
    assertRuntime(options.authoritySecret.length >= 32, "权威提交密钥至少需要 32 个字符");
    this.#store = options.store;
    this.#content = options.content;
    this.#plans = compileXunpuAutonomyPlansV4(options.content);
    this.#authoritySecret = options.authoritySecret;
    this.#npcDecisionModel = options.npcDecisionModel;
    this.#npcDecisionTimeoutMs = options.npcDecisionTimeoutMs ?? 4_000;
    this.#npcDecisionSessionBudgetMicros =
      options.npcDecisionSessionBudgetMicros ?? 250_000;
    assertRuntime(
      Number.isInteger(this.#npcDecisionTimeoutMs)
        && this.#npcDecisionTimeoutMs >= 1
        && this.#npcDecisionTimeoutMs <= 30_000,
      "NPC 模型决策超时必须在 1—30000 毫秒之间",
    );
    assertRuntime(
      Number.isInteger(this.#npcDecisionSessionBudgetMicros)
        && this.#npcDecisionSessionBudgetMicros >= 0,
      "NPC 模型会话预算非法",
    );
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  get compiledPlans(): readonly CompiledAutonomyPlanV4[] {
    return structuredClone(this.#plans);
  }

  async #selectNpcPlan(
    record: AutonomousWorldRecordV4,
    candidates: readonly CompiledAutonomyPlanV4[],
    trigger: Pick<EvaluateAutonomousWorldV4Input, "triggerKind" | "triggerRef">,
    remainingConflictSlots: number,
  ): Promise<AutonomousNpcDecisionSelectionV4> {
    const alreadySpent = record.npcDecisionReceipts.reduce(
      (total, receipt) => total + receipt.estimatedCostMicros,
      0,
    );
    const remainingBudgetMicros = Math.max(
      0,
      this.#npcDecisionSessionBudgetMicros - alreadySpent,
    );
    const observation = buildAutonomousNpcDecisionObservationV4({
      content: this.#content,
      record,
      candidates,
      trigger,
      remainingConflictSlots,
      remainingBudgetMicros,
    });
    const inputHash = hash(observation);
    const fallback = (
      fallbackReason: Exclude<
        AutonomousNpcDecisionReceiptV4["fallbackReason"],
        null
      >,
      run: AutonomousNpcDecisionModelRunV4 | null = null,
    ): AutonomousNpcDecisionSelectionV4 => ({
      inputHash,
      mode: "deterministic_fallback",
      disposition: "select",
      selectedPlanRef: candidates[0]!.planRef,
      deferUntilVirtualMinute: null,
      safeRationale: "模型未形成可接受的受限决定，使用同状态可复算的优先级与种子选择。",
      fallbackReason,
      providerId: run?.providerId ?? null,
      modelId: run?.modelId ?? null,
      traceRef: run?.traceRef ?? null,
      latencyMs: run?.latencyMs ?? null,
      estimatedCostMicros: run?.estimatedCostMicros ?? 0,
    });
    if (!this.#npcDecisionModel) return fallback("model_not_configured");
    if (remainingBudgetMicros <= 0) return fallback("session_budget_exhausted");
    try {
      const run = await withNpcDecisionTimeout(
        this.#npcDecisionModel.decide(structuredClone(observation)),
        this.#npcDecisionTimeoutMs,
      );
      if (!validModelReceiptMetadata(run)) {
        return fallback("model_invalid_output");
      }
      if (run.estimatedCostMicros > remainingBudgetMicros) {
        return fallback("model_cost_exceeded", run);
      }
      let output: ReturnType<typeof parseNpcDecisionOutput>;
      try {
        output = parseNpcDecisionOutput({
          output: run.output,
          candidates,
          virtualMinute: record.virtualMinute,
        });
      } catch (error) {
        if (error instanceof AutonomousNpcDecisionOutputError) {
          return fallback("model_invalid_output", run);
        }
        throw error;
      }
      return {
        inputHash,
        mode: "model",
        disposition: output.disposition,
        selectedPlanRef: output.selectedPlanRef,
        deferUntilVirtualMinute: output.deferUntilVirtualMinute,
        safeRationale: output.rationale,
        fallbackReason: null,
        providerId: run.providerId,
        modelId: run.modelId,
        traceRef: run.traceRef,
        latencyMs: run.latencyMs,
        estimatedCostMicros: run.estimatedCostMicros,
      };
    } catch (error) {
      return fallback(
        error instanceof AutonomousNpcDecisionTimeoutError
          ? "model_timeout"
          : "model_error",
      );
    }
  }

  async start(input: StartAutonomousWorldV4Input): Promise<AutonomousWorldRecordV4> {
    const contentRef = FlagshipContentReferenceV4Schema.parse(input.flagshipContentRef);
    assertRuntime(
      contentRef.contentHash === this.#content.contentHash
        && contentRef.contentSchemaVersion === this.#content.schemaVersion,
      "启动内容引用与 V4 内容清单漂移",
    );
    challengeProfile(this.#content, input.challengeLevel);
    const startedAt = input.startedAt ?? this.#now();
    assertRuntime(Number.isFinite(Date.parse(startedAt)), "启动时间非法");
    assertRuntime(
      Number.isInteger(input.initialWorldStateVersion)
        && input.initialWorldStateVersion >= 0,
      "初始世界版本非法",
    );
    const initialVirtualMinute = input.initialVirtualMinute ?? 0;
    assertRuntime(
      Number.isInteger(initialVirtualMinute)
        && initialVirtualMinute >= 0
        && initialVirtualMinute <= 60,
      "初始虚拟分钟非法",
    );
    const initialVariableValues = input.initialVariableValues ?? {};
    const knownVariableIds = new Set<string>(
      this.#content.variables.map((variable) => variable.variableId),
    );
    assertRuntime(
      Object.keys(initialVariableValues).every((variableId) => (
        knownVariableIds.has(variableId)
      )),
      "初始世界变量包含内容包之外的引用",
    );
    for (const variable of this.#content.variables) {
      const value = initialVariableValues[variable.variableId]
        ?? variable.initialValue;
      assertRuntime(
        Number.isFinite(value)
          && value >= variable.minimum
          && value <= variable.maximum,
        `初始世界变量超出范围：${variable.variableId}`,
      );
    }
    const record: AutonomousWorldRecordV4 = {
      recordVersion: AutonomousWorldRecordV4Version,
      recordRevision: 0,
      sessionId: input.sessionId,
      flagshipContentRef: contentRef,
      challengeLevel: input.challengeLevel,
      seed: input.seed,
      currentWorldStateVersion: input.initialWorldStateVersion,
      virtualMinute: initialVirtualMinute,
      paused: false,
      endingStatus: "active",
      signals: { ...(input.initialSignals ?? {}) },
      variables: Object.fromEntries(this.#content.variables.map((variable) => [
        variable.variableId,
        initialVariableValues[variable.variableId] ?? variable.initialValue,
      ])),
      npcStates: this.#content.cast.map((npc) => ({
        entityId: npc.entityId,
        roleId: npc.roleId,
        revision: 0,
        localKnowledgeRefs: [...npc.localKnowledgeRefs],
        allowedMemoryKeys: [...npc.memoryKeys],
        memories: [],
        commitments: [],
        localFacts: [],
        lastPublicActionMinute: null,
      })),
      planStates: this.#plans.map((plan) => ({
        planRef: plan.planRef,
        actorEntityRef: plan.actorEntityRef,
        status: "pending",
        evaluationCount: 0,
        lastEvaluatedWorldStateVersion: null,
        candidateEventRef: null,
        committedWorldEventRef: null,
        deferredUntilVirtualMinute: null,
      })),
      responseWindows: [],
      decisions: [],
      npcDecisionReceipts: [],
      cycleReceipts: [],
      commitReceipts: [],
      createdAt: startedAt,
      updatedAt: startedAt,
    };
    const parsed = validateAutonomousWorldRecordV4(record);
    this.#assertContentConsistency(parsed);
    await this.#store.create(parsed);
    return parsed;
  }

  async getRecord(sessionId: string): Promise<AutonomousWorldRecordV4> {
    const record = await this.#store.load(sessionId);
    if (!record) throw new AutonomousWorldRecordNotFoundError(sessionId);
    this.#assertContentConsistency(record);
    return record;
  }

  async evaluate(
    input: EvaluateAutonomousWorldV4Input,
  ): Promise<AutonomousWorldDecisionV4> {
    assertRuntime(idPattern.test(input.cycleRef), "循环引用非法");
    assertRuntime(idPattern.test(input.triggerRef), "触发引用非法");
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const record = await this.getRecord(input.sessionId);
      const observedStateHash = stateHash(record);
      const existingReceipt = record.cycleReceipts.find(
        (receipt) => receipt.cycleRef === input.cycleRef,
      );
      if (existingReceipt) {
        const existing = record.decisions.find(
          (decision) => decision.autonomyDecisionId === existingReceipt.decisionId,
        );
        assertRuntime(existing !== undefined, "自主循环收据决定缺失");
        assertRuntime(
          existing.sourceWorldStateVersion === input.expectedWorldStateVersion
            && existing.trigger.triggerKind === input.triggerKind
            && existing.trigger.triggerRef === input.triggerRef
            && existing.trigger.observedStateHash === existingReceipt.sourceStateHash,
          "同一自主循环引用被用于不同输入",
        );
        return existing;
      }
      const now = this.#now();
      if (input.expectedWorldStateVersion !== record.currentWorldStateVersion) {
        return refusalDecision({
          record,
          plans: this.#plans,
          cycle: input,
          now,
          reasonCode: "version_hash_drift",
          safeMessage: "自主导演读取的世界版本已经变化，本轮没有创建候选事件。",
        });
      }
      const next = structuredClone(record);
      expireWindows(next);
      let decision: AutonomousWorldDecisionV4;
      let npcSelection: AutonomousNpcDecisionSelectionV4 | null = null;
      if (next.endingStatus !== "active" || next.virtualMinute >= 60) {
        decision = suppressionDecision({
          record: next,
          plans: this.#plans,
          cycle: input,
          now,
          observedStateHash,
          reasonCode: "no_public_window",
          safeReason: "本局已结束或发布窗口关闭，NPC 不再注入新冲突。",
        });
      } else if (next.paused) {
        decision = suppressionDecision({
          record: next,
          plans: this.#plans,
          cycle: input,
          now,
          observedStateHash,
          reasonCode: "session_paused",
          safeReason: "教师已暂停本局，虚拟时钟和 NPC 计划均保持不变。",
        });
      } else {
        const profile = challengeProfile(this.#content, next.challengeLevel);
        const openWindows = next.responseWindows.filter(
          (window) => window.status === "open",
        );
        const triggerEligible = this.#plans.filter((plan) => {
          const state = next.planStates.find((candidate) => (
            candidate.planRef === plan.planRef
          ));
          return state?.status === "pending"
            && evaluateAutonomyTriggerV4(plan.triggerExpression, next);
        });
        const eligible = triggerEligible.filter((plan) => {
          const state = next.planStates.find((candidate) => (
            candidate.planRef === plan.planRef
          ));
          return state?.deferredUntilVirtualMinute === null
            || state?.deferredUntilVirtualMinute === undefined
            || state.deferredUntilVirtualMinute <= next.virtualMinute;
        }).sort((left, right) => (
          right.priority - left.priority
          || seedRank(next.seed, right.planRef, next.currentWorldStateVersion)
            - seedRank(next.seed, left.planRef, next.currentWorldStateVersion)
          || left.planRef.localeCompare(right.planRef)
        ));
        if (triggerEligible.length > 0 && eligible.length === 0) {
          decision = suppressionDecision({
            record: next,
            plans: triggerEligible,
            cycle: input,
            now,
            observedStateHash,
            reasonCode: "cooldown_not_elapsed",
            safeReason: "达到条件的 NPC 计划仍在已记录的延迟窗口内，本轮不重复注入。",
          });
        } else if (eligible.length === 0) {
          decision = suppressionDecision({
            record: next,
            plans: this.#plans,
            cycle: input,
            now,
            observedStateHash,
            reasonCode: "preconditions_not_met",
            safeReason: "当前没有达到触发条件的 NPC 计划；导演不会用空日志替代学生岗位行动。",
          });
        } else if (openWindows.length >= profile.concurrentConflictLimit) {
          decision = suppressionDecision({
            record: next,
            plans: this.#plans,
            cycle: input,
            now,
            observedStateHash,
            reasonCode: "conflict_budget_exhausted",
            safeReason: "当前开放冲突已达到本级压力预算，其余计划保留到下一窗口。",
          });
        } else {
          npcSelection = await this.#selectNpcPlan(
            next,
            eligible,
            { triggerKind: input.triggerKind, triggerRef: input.triggerRef },
            profile.concurrentConflictLimit - openWindows.length,
          );
          if (npcSelection.disposition === "defer") {
            const state = next.planStates.find((candidate) => (
              candidate.planRef === npcSelection!.selectedPlanRef
            ));
            assertRuntime(state !== undefined, "延迟决定引用的计划不存在");
            state.evaluationCount += 1;
            state.lastEvaluatedWorldStateVersion = next.currentWorldStateVersion;
            state.deferredUntilVirtualMinute = npcSelection.deferUntilVirtualMinute;
            decision = suppressionDecision({
              record: next,
              plans: eligible,
              cycle: input,
              now,
              observedStateHash,
              reasonCode: "npc_decision_deferred",
              safeReason: "NPC 根据当前岗位目标与已知信息选择等待；本轮没有形成世界候选事件。",
            });
          } else if (npcSelection.disposition === "no_action") {
            decision = suppressionDecision({
              record: next,
              plans: eligible,
              cycle: input,
              now,
              observedStateHash,
              reasonCode: "npc_decision_no_action",
              safeReason: "NPC 判断此刻无需打断学生岗位行动；本轮没有形成世界候选事件。",
            });
          } else {
            const selected = eligible.find((plan) => (
              plan.planRef === npcSelection!.selectedPlanRef
            ));
            assertRuntime(selected !== undefined, "受限决策选择了候选集外计划");
            const candidateEventId = stableId("candidate-event", {
              sessionId: next.sessionId,
              planRef: selected.planRef,
              worldStateVersion: next.currentWorldStateVersion,
              evaluationCount: next.planStates.find(
                (state) => state.planRef === selected.planRef,
              )?.evaluationCount ?? 0,
            });
            const pressureAdjustedWindow = Math.max(
              3,
              selected.responseWindowMinutes - (profile.challengeLevel - 3),
            );
            const expiresAt = Math.min(
              60,
              next.virtualMinute + pressureAdjustedWindow,
            );
            decision = AutonomousWorldDecisionV4Schema.parse({
              schemaVersion: AutonomousWorldDecisionV4SchemaVersion,
              autonomyDecisionId: stableId("autonomy-decision", {
                cycleRef: input.cycleRef,
                observedStateHash,
                selectedPlanRef: selected.planRef,
              }),
              sessionId: next.sessionId,
              flagshipContentRef: next.flagshipContentRef,
              sourceWorldStateVersion: next.currentWorldStateVersion,
              virtualMinute: next.virtualMinute,
              trigger: {
                triggerKind: input.triggerKind,
                triggerRef: input.triggerRef,
                observedStateHash,
              },
              evaluatedPlanRefs: eligible.map((plan) => plan.planRef),
              evaluatedAt: now,
              status: "scheduled",
              selectedPlanRef: selected.planRef,
              candidateEvent: {
                candidateEventId,
                eventTemplateRef: selected.eventTemplateRef,
                actorEntityRef: selected.actorEntityRef,
                affectedObjectRefs: selected.affectedObjectRefs,
                publicCue: selected.publicCue,
                earliestVirtualMinute: next.virtualMinute,
                expiresVirtualMinute: expiresAt,
                authority: "proposal_only",
              },
              suppression: null,
              failure: null,
              writeDisposition: "candidate_only",
            });
            const state = next.planStates.find(
              (candidate) => candidate.planRef === selected.planRef,
            )!;
            state.status = "scheduled";
            state.evaluationCount += 1;
            state.lastEvaluatedWorldStateVersion = next.currentWorldStateVersion;
            state.candidateEventRef = candidateEventId;
            state.deferredUntilVirtualMinute = null;
            next.responseWindows.push({
              responseWindowId: stableId("response-window", candidateEventId),
              candidateEventId,
              planRef: selected.planRef,
              actorEntityRef: selected.actorEntityRef,
              openedAtVirtualMinute: next.virtualMinute,
              expiresAtVirtualMinute: expiresAt,
              status: "open",
              committedWorldEventRef: null,
            });
          }
        }
      }
      next.decisions.push(decision);
      if (npcSelection !== null) {
        next.npcDecisionReceipts.push({
          ...npcSelection,
          cycleRef: input.cycleRef,
          decisionId: decision.autonomyDecisionId,
        });
      }
      next.cycleReceipts.push({
        cycleRef: input.cycleRef,
        sourceStateHash: observedStateHash,
        decisionId: decision.autonomyDecisionId,
      });
      next.recordRevision += 1;
      next.updatedAt = now;
      const parsed = validateAutonomousWorldRecordV4(next);
      this.#assertContentConsistency(parsed);
      try {
        await this.#store.compareAndSet(
          parsed.sessionId,
          record.recordRevision,
          parsed,
        );
        return decision;
      } catch (error) {
        if (!(error instanceof AutonomousWorldStoreConflictError) || attempt === 3) {
          throw error;
        }
      }
    }
    throw new Error("V4 自主世界 CAS 重试耗尽");
  }

  async recordWorldCommit(
    input: AuthoritativeWorldCommitInputV4,
  ): Promise<AuthoritativeWorldCommitResultV4> {
    const { authorityToken, ...payload } = input;
    const expectedToken = issueAuthoritativeWorldCommitTokenV4(
      this.#authoritySecret,
      payload,
    );
    assertRuntime(tokensMatch(authorityToken, expectedToken), "权威世界提交令牌无效");
    assertRuntime(Number.isFinite(Date.parse(payload.committedAt)), "世界提交时间非法");
    assertRuntime(idPattern.test(payload.commitRef), "世界提交引用非法");
    assertRuntime(idPattern.test(payload.sourceWorldEventRef), "世界事件引用非法");
    assertRuntime(
      payload.resultingWorldStateVersion === payload.sourceWorldStateVersion + 1,
      "权威世界版本必须单步前进",
    );
    const memoryTargets = payload.npcMemoryUpdates.map(
      (update) => `${update.entityId}:${update.memoryKey}`,
    );
    const commitmentTargets = payload.npcCommitmentUpdates.map(
      (update) => `${update.entityId}:${update.commitmentId}`,
    );
    const factTargets = payload.npcLocalFactUpdates.map(
      (update) => `${update.entityId}:${update.factRef}`,
    );
    assertRuntime(
      new Set(memoryTargets).size === memoryTargets.length,
      "同一权威提交不得重复更新同一 NPC 记忆",
    );
    assertRuntime(
      new Set(commitmentTargets).size === commitmentTargets.length,
      "同一权威提交不得重复更新同一 NPC 承诺",
    );
    assertRuntime(
      new Set(factTargets).size === factTargets.length,
      "同一权威提交不得重复更新同一 NPC 局部事实",
    );
    const payloadHash = hash(payload);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const record = await this.getRecord(payload.sessionId);
      const existing = record.commitReceipts.find(
        (receipt) => receipt.commitRef === payload.commitRef,
      );
      if (existing) {
        assertRuntime(
          existing.commitPayloadHash === payloadHash,
          "同一世界提交引用被用于不同载荷",
        );
        return { record, replayed: true };
      }
      assertRuntime(
        payload.sourceWorldStateVersion === record.currentWorldStateVersion,
        "权威世界提交来源版本漂移",
      );
      assertRuntime(
        Number.isInteger(payload.virtualMinute)
          && payload.virtualMinute >= record.virtualMinute
          && payload.virtualMinute <= 60,
        "权威世界虚拟分钟非法",
      );
      const next = structuredClone(record);
      if (payload.candidateEventId !== null) {
        const window = next.responseWindows.find((candidate) => (
          candidate.candidateEventId === payload.candidateEventId
        ));
        assertRuntime(window !== undefined, "权威提交引用的主动候选不存在");
        assertRuntime(window.status === "open", "主动候选窗口已经关闭");
        assertRuntime(
          payload.virtualMinute <= window.expiresAtVirtualMinute,
          "主动候选已超过回应窗口",
        );
        window.status = "committed";
        window.committedWorldEventRef = payload.sourceWorldEventRef;
        const plan = next.planStates.find(
          (candidate) => candidate.planRef === window.planRef,
        );
        assertRuntime(plan?.status === "scheduled", "主动候选计划状态非法");
        plan.status = "committed";
        plan.committedWorldEventRef = payload.sourceWorldEventRef;
        const actor = next.npcStates.find(
          (candidate) => candidate.entityId === window.actorEntityRef,
        );
        assertRuntime(actor !== undefined, "主动候选 NPC 状态不存在");
        actor.lastPublicActionMinute = payload.virtualMinute;
        actor.revision += 1;
      }
      for (const [signalId, value] of Object.entries(payload.signalUpdates)) {
        assertRuntime(signalIdPattern.test(signalId), `信号 ID 非法：${signalId}`);
        assertRuntime(
          typeof value === "boolean"
            || typeof value === "string"
            || (typeof value === "number" && Number.isFinite(value)),
          `信号值非法：${signalId}`,
        );
        next.signals[signalId] = value;
      }
      for (const [variableId, value] of Object.entries(payload.variableValues)) {
        const definition = this.#content.variables.find(
          (candidate) => candidate.variableId === variableId,
        );
        assertRuntime(definition !== undefined, `世界变量不存在：${variableId}`);
        assertRuntime(
          Number.isFinite(value)
            && value >= definition.minimum
            && value <= definition.maximum,
          `世界变量超出范围：${variableId}`,
        );
        next.variables[variableId] = value;
      }
      this.#applyNpcUpdates(next, payload);
      next.currentWorldStateVersion = payload.resultingWorldStateVersion;
      next.virtualMinute = payload.virtualMinute;
      next.paused = payload.paused;
      next.endingStatus = payload.endingStatus;
      next.commitReceipts.push({
        commitRef: payload.commitRef,
        commitPayloadHash: payloadHash,
        sourceWorldStateVersion: payload.sourceWorldStateVersion,
        resultingWorldStateVersion: payload.resultingWorldStateVersion,
        sourceWorldEventRef: payload.sourceWorldEventRef,
      });
      next.recordRevision += 1;
      next.updatedAt = payload.committedAt;
      expireWindows(next);
      const parsed = validateAutonomousWorldRecordV4(next);
      this.#assertContentConsistency(parsed);
      try {
        await this.#store.compareAndSet(
          parsed.sessionId,
          record.recordRevision,
          parsed,
        );
        return { record: parsed, replayed: false };
      } catch (error) {
        if (!(error instanceof AutonomousWorldStoreConflictError) || attempt === 3) {
          throw error;
        }
      }
    }
    throw new Error("V4 权威世界提交 CAS 重试耗尽");
  }

  #applyNpcUpdates(
    record: AutonomousWorldRecordV4,
    payload: AuthoritativeWorldCommitPayloadV4,
  ): void {
    const touched = new Set<string>();
    for (const update of payload.npcMemoryUpdates) {
      assertRuntime(hashPattern.test(update.valueHash), "NPC 记忆必须是内容哈希");
      const npc = record.npcStates.find((candidate) => candidate.entityId === update.entityId);
      const definition = npcDefinition(this.#content, update.entityId);
      assertRuntime(npc !== undefined, `NPC 记忆目标不存在：${update.entityId}`);
      assertRuntime(definition.memoryKeys.includes(update.memoryKey), "NPC 记忆键未在内容中声明");
      const memory: AutonomousNpcMemoryV4 = {
        memoryKey: update.memoryKey,
        valueHash: update.valueHash,
        publicSummary: update.publicSummary,
        sourceWorldEventRef: payload.sourceWorldEventRef,
        updatedAtWorldStateVersion: payload.resultingWorldStateVersion,
      };
      const index = npc.memories.findIndex(
        (candidate) => candidate.memoryKey === update.memoryKey,
      );
      if (index < 0) npc.memories.push(memory);
      else npc.memories[index] = memory;
      touched.add(npc.entityId);
    }
    for (const update of payload.npcCommitmentUpdates) {
      const npc = record.npcStates.find((candidate) => candidate.entityId === update.entityId);
      assertRuntime(npc !== undefined, `NPC 承诺目标不存在：${update.entityId}`);
      const commitment: AutonomousNpcCommitmentV4 = {
        commitmentId: update.commitmentId,
        publicSummary: update.publicSummary,
        status: update.status,
        sourceWorldEventRef: payload.sourceWorldEventRef,
        updatedAtWorldStateVersion: payload.resultingWorldStateVersion,
      };
      const index = npc.commitments.findIndex(
        (candidate) => candidate.commitmentId === update.commitmentId,
      );
      if (index < 0) npc.commitments.push(commitment);
      else npc.commitments[index] = commitment;
      touched.add(npc.entityId);
    }
    for (const update of payload.npcLocalFactUpdates) {
      const npc = record.npcStates.find((candidate) => candidate.entityId === update.entityId);
      assertRuntime(npc !== undefined, `NPC 局部事实目标不存在：${update.entityId}`);
      assertRuntime(
        Number.isFinite(update.confidence)
          && update.confidence >= 0
          && update.confidence <= 1,
        "NPC 局部事实置信非法",
      );
      const knownKnowledge = new Set([
        ...this.#content.baseKnowledgeRefs,
        ...this.#content.addedKnowledgeRecords.map((knowledge) => knowledge.knowledgeId),
      ]);
      assertRuntime(
        update.knowledgeRefs.every((reference) => knownKnowledge.has(reference)),
        "NPC 局部事实引用未知知识",
      );
      const fact: AutonomousNpcLocalFactV4 = {
        factRef: update.factRef,
        confidence: update.confidence,
        visibility: update.visibility,
        knowledgeRefs: unique(update.knowledgeRefs),
        sourceWorldEventRef: payload.sourceWorldEventRef,
        updatedAtWorldStateVersion: payload.resultingWorldStateVersion,
      };
      const index = npc.localFacts.findIndex(
        (candidate) => candidate.factRef === update.factRef,
      );
      if (index < 0) npc.localFacts.push(fact);
      else npc.localFacts[index] = fact;
      touched.add(npc.entityId);
    }
    for (const entityId of touched) {
      const npc = record.npcStates.find((candidate) => candidate.entityId === entityId)!;
      npc.revision += 1;
    }
  }

  #assertContentConsistency(record: AutonomousWorldRecordV4): void {
    assertRuntime(
      record.flagshipContentRef.contentHash === this.#content.contentHash,
      "自主世界记录内容哈希漂移",
    );
    const expectedNpcIds = this.#content.cast.map((npc) => npc.entityId).sort();
    const actualNpcIds = record.npcStates.map((npc) => npc.entityId).sort();
    assertRuntime(
      canonicalString(expectedNpcIds) === canonicalString(actualNpcIds),
      "自主世界 NPC 集合漂移",
    );
    for (const definition of this.#content.cast) {
      const npc = record.npcStates.find(
        (candidate) => candidate.entityId === definition.entityId,
      )!;
      assertRuntime(npc.roleId === definition.roleId, "自主世界 NPC 角色漂移");
      assertRuntime(
        canonicalString([...npc.allowedMemoryKeys].sort())
          === canonicalString([...definition.memoryKeys].sort()),
        `自主世界 NPC 记忆边界漂移：${definition.entityId}`,
      );
      assertRuntime(
        canonicalString([...npc.localKnowledgeRefs].sort())
          === canonicalString([...definition.localKnowledgeRefs].sort()),
        `自主世界 NPC 知识边界漂移：${definition.entityId}`,
      );
    }
    const expectedVariableIds = this.#content.variables
      .map((variable) => variable.variableId)
      .sort();
    const actualVariableIds = Object.keys(record.variables).sort();
    assertRuntime(
      canonicalString(expectedVariableIds) === canonicalString(actualVariableIds),
      "自主世界变量集合漂移",
    );
    const expectedPlanRefs = this.#plans.map((plan) => plan.planRef).sort();
    const actualPlanRefs = record.planStates.map((plan) => plan.planRef).sort();
    assertRuntime(
      canonicalString(expectedPlanRefs) === canonicalString(actualPlanRefs),
      "自主世界计划集合漂移",
    );
    for (const definition of this.#plans) {
      const plan = record.planStates.find(
        (candidate) => candidate.planRef === definition.planRef,
      )!;
      assertRuntime(
        plan.actorEntityRef === definition.actorEntityRef,
        `自主世界计划角色漂移：${definition.planRef}`,
      );
    }
  }
}

export class AutonomousWorldSchedulerV4 {
  readonly #director: XunpuAutonomousWorldDirectorV4;
  readonly #listSessionIds: () => Promise<string[]>;
  readonly #dispatchCandidate: AutonomousWorldSchedulerV4Options["dispatchCandidate"];

  constructor(options: AutonomousWorldSchedulerV4Options) {
    this.#director = options.director;
    this.#listSessionIds = options.listSessionIds;
    this.#dispatchCandidate = options.dispatchCandidate;
  }

  async runCycle(): Promise<AutonomousWorldDecisionV4[]> {
    const sessionIds = unique(await this.#listSessionIds()).sort();
    const decisions: AutonomousWorldDecisionV4[] = [];
    for (const sessionId of sessionIds) {
      const record = await this.#director.getRecord(sessionId);
      const cycleRef = `scheduler-${record.currentWorldStateVersion}-${record.virtualMinute}`;
      const alreadyEvaluated = record.cycleReceipts.some(
        (receipt) => receipt.cycleRef === cycleRef,
      );
      const decision = await this.#director.evaluate({
        sessionId,
        cycleRef,
        expectedWorldStateVersion: record.currentWorldStateVersion,
        triggerKind: "virtual_clock",
        triggerRef: `server-scheduler-${record.currentWorldStateVersion}`,
      });
      decisions.push(decision);
      if (decision.status === "scheduled" && !alreadyEvaluated) {
        await this.#dispatchCandidate(decision);
      }
    }
    return decisions;
  }
}
