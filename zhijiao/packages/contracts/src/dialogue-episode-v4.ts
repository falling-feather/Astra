import { z } from "zod";
import {
  V2ContentHashSchema,
  V2IdentifierSchema,
} from "./course-learning.js";
import { FlagshipContentReferenceV4Schema } from "./flagship-world-v4.js";

export const DialogueSceneDefinitionV4SchemaVersion =
  "dialogue-scene-definition/4.0.0" as const;
export const DialogueEpisodeV4SchemaVersion =
  "dialogue-episode/4.0.0" as const;
export const DialogueTurnRequestV4SchemaVersion =
  "dialogue-turn-request/4.0.0" as const;
export const DialogueEpisodeViewV4SchemaVersion =
  "dialogue-episode-view/4.0.0" as const;
export const DialogueStartResponseV4SchemaVersion =
  "dialogue-start-response/4.0.0" as const;

const TimestampSchema = z.string().datetime();
const TextSchema = z.string().trim().min(1);

export const DialogueIntentV4Schema = z.enum([
  "introduce_scope",
  "ask_open_question",
  "probe_detail",
  "reflect_back",
  "request_evidence",
  "negotiate_terms",
  "set_boundary",
  "accept_condition",
  "repair_breach",
  "exit_conversation",
]);
export type DialogueIntentV4 = z.infer<typeof DialogueIntentV4Schema>;

export const DialogueNpcActV4Schema = z.enum([
  "answer",
  "clarify",
  "challenge",
  "refuse",
  "commit",
  "acknowledge",
  "close",
]);
export type DialogueNpcActV4 = z.infer<typeof DialogueNpcActV4Schema>;

export const DialogueNpcStanceV4Schema = z.enum([
  "guarded",
  "cautious",
  "cooperative",
  "committed",
  "withdrawn",
]);

export const DialogueIssueStatusV4Schema = z.enum([
  "open",
  "satisfied",
  "contested",
  "withdrawn",
]);
export type DialogueIssueStatusV4 = z.infer<
  typeof DialogueIssueStatusV4Schema
>;

export const DialogueRuleOutcomeV4Schema = z.enum([
  "continue",
  "clarification",
  "refusal",
  "recovery",
  "resolved",
  "exited",
]);

const DialogueIssueDefinitionV4Schema = z.object({
  issueRef: V2IdentifierSchema,
  publicLabel: TextSchema.max(160),
  initialStatus: DialogueIssueStatusV4Schema,
  requiredForResolution: z.boolean(),
}).strict();

const DialogueFactDefinitionV4Schema = z.object({
  factRef: V2IdentifierSchema,
  publicText: TextSchema.max(600),
  knowledgeRefs: z.array(V2IdentifierSchema).min(1).max(12),
  disclosureRuleRefs: z.array(V2IdentifierSchema).min(1).max(12),
}).strict();

const DialogueSignalDefinitionV4Schema = z.object({
  signalRef: V2IdentifierSchema,
  keywordGroups: z.array(
    z.array(TextSchema.max(80)).min(1).max(12),
  ).min(1).max(12),
}).strict();

const DialogueIssueRequirementV4Schema = z.object({
  issueRef: V2IdentifierSchema,
  allowedStatuses: z.array(DialogueIssueStatusV4Schema).min(1).max(4),
}).strict();

const DialogueIssueUpdateV4Schema = z.object({
  issueRef: V2IdentifierSchema,
  nextStatus: DialogueIssueStatusV4Schema,
  publicReason: TextSchema.max(240),
}).strict();

const DialogueCommitmentDraftV4Schema = z.object({
  madeBy: z.enum(["student", "npc"]),
  summary: TextSchema.max(360),
  condition: TextSchema.max(360),
  dueAfterVirtualMinutes: z.number().int().positive().max(60).nullable(),
}).strict();

const DialogueRelationshipDeltaV4Schema = z.object({
  trust: z.number().int().min(-30).max(30),
  cooperation: z.number().int().min(-30).max(30),
  alertness: z.number().int().min(-30).max(30),
  publicReason: TextSchema.max(240),
}).strict();

const DialogueResponseTemplateV4Schema = z.object({
  act: DialogueNpcActV4Schema,
  stance: DialogueNpcStanceV4Schema,
  publicText: TextSchema.max(1_200),
  nextPrompt: TextSchema.max(600).nullable(),
}).strict();

const DialogueRuleV4Schema = z.object({
  ruleRef: V2IdentifierSchema,
  priority: z.number().int().min(-1_000).max(1_000),
  minTurn: z.number().int().positive().max(12),
  maxTurn: z.number().int().positive().max(12),
  allowedIntents: z.array(DialogueIntentV4Schema).min(1).max(10),
  requiredAllSignalRefs: z.array(V2IdentifierSchema).max(20),
  requiredAnySignalRefs: z.array(V2IdentifierSchema).max(20),
  forbiddenSignalRefs: z.array(V2IdentifierSchema).max(20),
  issueRequirements: z.array(DialogueIssueRequirementV4Schema).max(12),
  response: DialogueResponseTemplateV4Schema,
  issueUpdates: z.array(DialogueIssueUpdateV4Schema).max(12),
  disclosedFactRefs: z.array(V2IdentifierSchema).max(12),
  relationshipDelta: DialogueRelationshipDeltaV4Schema,
  commitment: DialogueCommitmentDraftV4Schema.nullable(),
  timeCostMinutes: z.number().int().positive().max(12),
  outcome: DialogueRuleOutcomeV4Schema,
  routeRef: V2IdentifierSchema.nullable(),
  eventTemplateRef: V2IdentifierSchema.nullable(),
  resolutionSummary: TextSchema.max(600).nullable(),
}).strict().superRefine((rule, context) => {
  if (rule.maxTurn < rule.minTurn) {
    context.addIssue({
      code: "custom",
      path: ["maxTurn"],
      message: "规则最大轮次不得早于最小轮次",
    });
  }
  const resolves = rule.outcome === "resolved";
  if (resolves !== (
    rule.routeRef !== null
    && rule.eventTemplateRef !== null
    && rule.resolutionSummary !== null
  )) {
    context.addIssue({
      code: "custom",
      path: ["outcome"],
      message: "只有 resolved 规则必须同时声明路线、世界事件与结论",
    });
  }
});

export const DialogueSceneDefinitionV4Schema = z.object({
  schemaVersion: z.literal(DialogueSceneDefinitionV4SchemaVersion),
  definitionId: V2IdentifierSchema,
  definitionHash: V2ContentHashSchema,
  npcRef: V2IdentifierSchema,
  npcRoleRef: V2IdentifierSchema,
  topicRef: V2IdentifierSchema,
  title: TextSchema.max(240),
  objective: TextSchema.max(600),
  openingMessage: TextSchema.max(1_200),
  openingPrompt: TextSchema.max(600),
  privateBoundaryHash: V2ContentHashSchema,
  localKnowledgeRefs: z.array(V2IdentifierSchema).min(1).max(24),
  allowedIntents: z.array(DialogueIntentV4Schema).min(2).max(10),
  maximumTurnsByChallenge: z.object({
    level3: z.number().int().min(3).max(12),
    level4: z.number().int().min(3).max(12),
    level5: z.number().int().min(3).max(12),
    level6: z.number().int().min(3).max(12),
    level7: z.number().int().min(3).max(12),
  }).strict(),
  responseWindowMinutesByChallenge: z.object({
    level3: z.number().int().min(3).max(20),
    level4: z.number().int().min(3).max(20),
    level5: z.number().int().min(3).max(20),
    level6: z.number().int().min(3).max(20),
    level7: z.number().int().min(3).max(20),
  }).strict(),
  initialRelationship: z.object({
    trust: z.number().int().min(0).max(100),
    cooperation: z.number().int().min(0).max(100),
    alertness: z.number().int().min(0).max(100),
  }).strict(),
  issues: z.array(DialogueIssueDefinitionV4Schema).min(2).max(12),
  facts: z.array(DialogueFactDefinitionV4Schema).min(1).max(20),
  signals: z.array(DialogueSignalDefinitionV4Schema).min(2).max(40),
  rules: z.array(DialogueRuleV4Schema).min(3).max(60),
  exitOptions: z.array(TextSchema.max(240)).min(1).max(6),
}).strict().superRefine((definition, context) => {
  const unique = (values: string[], path: string) => {
    if (new Set(values).size !== values.length) {
      context.addIssue({ code: "custom", path: [path], message: `${path} ID 不得重复` });
    }
  };
  const issueRefs = definition.issues.map((item) => item.issueRef);
  const factRefs = definition.facts.map((item) => item.factRef);
  const signalRefs = definition.signals.map((item) => item.signalRef);
  const ruleRefs = definition.rules.map((item) => item.ruleRef);
  unique(issueRefs, "issues");
  unique(factRefs, "facts");
  unique(signalRefs, "signals");
  unique(ruleRefs, "rules");
  const issues = new Set(issueRefs);
  const facts = new Set(factRefs);
  const signals = new Set(signalRefs);
  const rules = new Set(ruleRefs);
  const allowedIntents = new Set(definition.allowedIntents);
  const localKnowledgeRefs = new Set(definition.localKnowledgeRefs);
  for (const fact of definition.facts) {
    if (fact.disclosureRuleRefs.some((ref) => !rules.has(ref))) {
      context.addIssue({ code: "custom", path: ["facts"], message: "事实引用未知披露规则" });
    }
    if (fact.knowledgeRefs.some((ref) => !localKnowledgeRefs.has(ref))) {
      context.addIssue({ code: "custom", path: ["facts"], message: "事实只能引用该 NPC 的局部知识" });
    }
  }
  for (const rule of definition.rules) {
    if (rule.allowedIntents.some((intent) => !allowedIntents.has(intent))) {
      context.addIssue({ code: "custom", path: ["rules"], message: "规则意图必须属于场景允许意图" });
    }
    const signalReferences = [
      ...rule.requiredAllSignalRefs,
      ...rule.requiredAnySignalRefs,
      ...rule.forbiddenSignalRefs,
    ];
    if (signalReferences.some((ref) => !signals.has(ref))) {
      context.addIssue({ code: "custom", path: ["rules"], message: "规则引用未知语义信号" });
    }
    if (rule.issueRequirements.some((item) => !issues.has(item.issueRef))
      || rule.issueUpdates.some((item) => !issues.has(item.issueRef))) {
      context.addIssue({ code: "custom", path: ["rules"], message: "规则引用未知议题" });
    }
    if (rule.disclosedFactRefs.some((ref) => !facts.has(ref))) {
      context.addIssue({ code: "custom", path: ["rules"], message: "规则尝试披露未知事实" });
    }
    if (rule.disclosedFactRefs.some((ref) => (
      !definition.facts.find((fact) => fact.factRef === ref)?.disclosureRuleRefs.includes(rule.ruleRef)
    ))) {
      context.addIssue({
        code: "custom",
        path: ["rules"],
        message: "规则不得绕过事实声明的披露白名单",
      });
    }
    if (rule.outcome === "resolved") {
      const requiredIssueRefs = definition.issues
        .filter((issue) => issue.requiredForResolution)
        .map((issue) => issue.issueRef);
      const resolvedByRule = new Set(rule.issueUpdates
        .filter((update) => update.nextStatus === "satisfied")
        .map((update) => update.issueRef));
      const requiredAsSatisfied = new Set(rule.issueRequirements
        .filter((requirement) => (
          requirement.allowedStatuses.length === 1
          && requirement.allowedStatuses[0] === "satisfied"
        ))
        .map((requirement) => requirement.issueRef));
      if (requiredIssueRefs.some((ref) => (
        !resolvedByRule.has(ref) && !requiredAsSatisfied.has(ref)
      ))) {
        context.addIssue({
          code: "custom",
          path: ["rules"],
          message: "结算规则必须证明每个必需议题已满足或在本轮被满足",
        });
      }
    }
  }
  if (!definition.rules.some((rule) => rule.outcome === "resolved")
    || !definition.rules.some((rule) => rule.outcome === "recovery")
    || !definition.rules.some((rule) => rule.outcome === "refusal")
    || !definition.rules.some((rule) => rule.outcome === "exited")) {
    context.addIssue({
      code: "custom",
      path: ["rules"],
      message: "每段人物对话必须同时提供结算、拒绝、恢复和主动退出规则",
    });
  }
  const maximumTurns = Math.max(...Object.values(definition.maximumTurnsByChallenge));
  for (const intent of definition.allowedIntents) {
    for (let turn = 1; turn <= maximumTurns; turn += 1) {
      const hasSafeFallback = definition.rules.some((rule) => (
        rule.allowedIntents.includes(intent)
        && turn >= rule.minTurn
        && turn <= rule.maxTurn
        && rule.requiredAllSignalRefs.length === 0
        && rule.requiredAnySignalRefs.length === 0
        && rule.forbiddenSignalRefs.length === 0
        && rule.issueRequirements.length === 0
      ));
      if (!hasSafeFallback) {
        context.addIssue({
          code: "custom",
          path: ["rules"],
          message: `意图 ${intent} 在第 ${turn} 轮缺少不编造事实的安全兜底`,
        });
        break;
      }
    }
  }
});
export type DialogueSceneDefinitionV4 = z.infer<
  typeof DialogueSceneDefinitionV4Schema
>;

const DialogueIssueStateV4Schema = z.object({
  issueRef: V2IdentifierSchema,
  publicLabel: TextSchema.max(160),
  status: DialogueIssueStatusV4Schema,
  lastReason: TextSchema.max(240).nullable(),
}).strict();

const DialogueCommitmentV4Schema = z.object({
  commitmentId: V2IdentifierSchema,
  madeBy: z.enum(["student", "npc"]),
  summary: TextSchema.max(360),
  condition: TextSchema.max(360),
  dueAtVirtualMinute: z.number().int().nonnegative().max(120).nullable(),
  status: z.enum(["active", "fulfilled", "breached", "withdrawn"]),
  sourceTurnRef: V2IdentifierSchema,
}).strict();

const DialogueTurnV4Schema = z.object({
  turnId: V2IdentifierSchema,
  sequence: z.number().int().positive().max(12),
  requestId: V2IdentifierSchema,
  requestHash: V2ContentHashSchema,
  studentUtterance: TextSchema.max(2_000),
  intent: DialogueIntentV4Schema,
  matchedSignalRefs: z.array(V2IdentifierSchema).max(40),
  selectedRuleRef: V2IdentifierSchema,
  npcAct: DialogueNpcActV4Schema,
  npcStance: DialogueNpcStanceV4Schema,
  npcPublicText: TextSchema.max(1_200),
  nextPrompt: TextSchema.max(600).nullable(),
  issueUpdates: z.array(DialogueIssueUpdateV4Schema).max(12),
  disclosedFactRefs: z.array(V2IdentifierSchema).max(12),
  relationshipDelta: DialogueRelationshipDeltaV4Schema,
  commitmentRef: V2IdentifierSchema.nullable(),
  timeCostMinutes: z.number().int().positive().max(12),
  outcome: DialogueRuleOutcomeV4Schema,
  decidedAt: TimestampSchema,
}).strict();

const DialogueRuntimeReceiptV4Schema = z.object({
  receiptId: V2IdentifierSchema,
  turnRef: V2IdentifierSchema,
  decisionMode: z.enum(["live_model", "deterministic_rule", "deterministic_fallback"]),
  candidateRuleRefs: z.array(V2IdentifierSchema).min(1).max(60),
  selectedRuleRef: V2IdentifierSchema,
  inputHash: V2ContentHashSchema,
  outputHash: V2ContentHashSchema,
  modelRunRef: V2IdentifierSchema.nullable(),
  failureCode: z.string().regex(/^[a-z][a-z0-9_]{0,79}$/u).nullable(),
  latencyMs: z.number().int().nonnegative().max(120_000),
  costMicros: z.number().int().nonnegative().max(10_000_000),
}).strict().superRefine((receipt, context) => {
  if (!receipt.candidateRuleRefs.includes(receipt.selectedRuleRef)) {
    context.addIssue({
      code: "custom",
      path: ["selectedRuleRef"],
      message: "对话规则选择必须来自服务端本轮候选集合",
    });
  }
  if (receipt.decisionMode === "live_model" && receipt.modelRunRef === null) {
    context.addIssue({ code: "custom", path: ["modelRunRef"], message: "Live 选择必须有运行引用" });
  }
  if (receipt.decisionMode !== "live_model" && receipt.modelRunRef !== null) {
    context.addIssue({ code: "custom", path: ["modelRunRef"], message: "确定性选择不得伪造模型运行引用" });
  }
});

const PendingDialogueResolutionV4Schema = z.object({
  routeRef: V2IdentifierSchema,
  eventTemplateRef: V2IdentifierSchema,
  resolutionSummary: TextSchema.max(600),
  combinedStudentUtterance: TextSchema.max(8_000),
  worldRequestId: V2IdentifierSchema,
  preparedAt: TimestampSchema,
}).strict();

const DialogueWorldCommitV4Schema = z.object({
  routeRef: V2IdentifierSchema,
  resolutionSummary: TextSchema.max(600),
  worldEventRef: V2IdentifierSchema,
  resultingWorldStateVersion: z.number().int().nonnegative().nullable(),
  consequenceRef: V2IdentifierSchema.nullable(),
  committedAt: TimestampSchema,
}).strict().superRefine((commit, context) => {
  if ((commit.resultingWorldStateVersion === null) !== (commit.consequenceRef === null)) {
    context.addIssue({
      code: "custom",
      path: ["consequenceRef"],
      message: "世界结果版本与后果引用必须同时出现或同时为空",
    });
  }
});

const DialogueRequestReceiptV4Schema = z.object({
  requestId: V2IdentifierSchema,
  requestHash: V2ContentHashSchema,
  resultRevision: z.number().int().nonnegative(),
  resultTurnRef: V2IdentifierSchema,
}).strict();

export const DialogueEpisodeV4Schema = z.object({
  schemaVersion: z.literal(DialogueEpisodeV4SchemaVersion),
  episodeId: V2IdentifierSchema,
  definitionRef: V2IdentifierSchema,
  definitionHash: V2ContentHashSchema,
  flagshipContentRef: FlagshipContentReferenceV4Schema,
  sessionId: V2IdentifierSchema,
  learnerSubjectHash: V2ContentHashSchema,
  studentActorRef: V2IdentifierSchema,
  studentBindingRef: V2IdentifierSchema,
  npcRef: V2IdentifierSchema,
  npcRoleRef: V2IdentifierSchema,
  npcDisplayName: TextSchema.max(120),
  topicRef: V2IdentifierSchema,
  title: TextSchema.max(240),
  objective: TextSchema.max(600),
  privateBoundaryHash: V2ContentHashSchema,
  openingStudentUtterance: TextSchema.max(2_000).optional(),
  sourceWorldStateVersion: z.number().int().nonnegative(),
  challengeLevel: z.number().int().min(3).max(7),
  startedAtVirtualMinute: z.number().int().nonnegative().max(60),
  expiresAtVirtualMinute: z.number().int().positive().max(120),
  elapsedDialogueMinutes: z.number().int().nonnegative().max(60),
  status: z.enum([
    "active",
    "resolution_pending",
    "resolved",
    "exited",
    "expired",
    "stale",
  ]),
  revision: z.number().int().nonnegative(),
  turnCount: z.number().int().nonnegative().max(12),
  maximumTurns: z.number().int().positive().max(12),
  currentPrompt: TextSchema.max(600).nullable(),
  allowedIntents: z.array(DialogueIntentV4Schema).min(1).max(10),
  issues: z.array(DialogueIssueStateV4Schema).min(2).max(12),
  disclosedFactRefs: z.array(V2IdentifierSchema).max(20),
  relationship: z.object({
    trust: z.number().int().min(0).max(100),
    cooperation: z.number().int().min(0).max(100),
    alertness: z.number().int().min(0).max(100),
  }).strict(),
  commitments: z.array(DialogueCommitmentV4Schema).max(24),
  turns: z.array(DialogueTurnV4Schema).max(12),
  runtimeReceipts: z.array(DialogueRuntimeReceiptV4Schema).max(12),
  requestReceipts: z.array(DialogueRequestReceiptV4Schema).min(1).max(13),
  pendingResolution: PendingDialogueResolutionV4Schema.nullable(),
  worldCommit: DialogueWorldCommitV4Schema.nullable(),
  exitOptions: z.array(TextSchema.max(240)).min(1).max(6),
  startedAt: TimestampSchema,
  updatedAt: TimestampSchema,
  closedAt: TimestampSchema.nullable(),
}).strict().superRefine((episode, context) => {
  if (episode.turnCount !== episode.turns.length
    || episode.turnCount !== episode.runtimeReceipts.length) {
    context.addIssue({ code: "custom", path: ["turnCount"], message: "轮次、回合和运行收据数量必须一致" });
  }
  if (episode.turns.some((turn, index) => turn.sequence !== index + 1)) {
    context.addIssue({ code: "custom", path: ["turns"], message: "对话轮次必须从 1 连续递增" });
  }
  if (episode.turnCount > episode.maximumTurns) {
    context.addIssue({ code: "custom", path: ["maximumTurns"], message: "实际轮次不得超过场景上限" });
  }
  if (episode.requestReceipts.length !== episode.turnCount + 1) {
    context.addIssue({
      code: "custom",
      path: ["requestReceipts"],
      message: "请求收据必须覆盖一次开始请求和每个对话回合",
    });
  }
  if (episode.turns.some((turn, index) => (
    episode.runtimeReceipts[index]?.turnRef !== turn.turnId
    || episode.runtimeReceipts[index]?.selectedRuleRef !== turn.selectedRuleRef
  ))) {
    context.addIssue({
      code: "custom",
      path: ["runtimeReceipts"],
      message: "每个回合必须与同序运行收据一一对应",
    });
  }
  if (episode.expiresAtVirtualMinute <= episode.startedAtVirtualMinute) {
    context.addIssue({ code: "custom", path: ["expiresAtVirtualMinute"], message: "对话窗口必须晚于开始时间" });
  }
  const active = episode.status === "active";
  if (active !== (episode.currentPrompt !== null && episode.closedAt === null)) {
    context.addIssue({ code: "custom", path: ["status"], message: "活动对话必须有当前问题且尚未关闭" });
  }
  if ((episode.status === "resolution_pending") !== (episode.pendingResolution !== null)) {
    context.addIssue({ code: "custom", path: ["pendingResolution"], message: "待结算状态必须且只能携带待提交结论" });
  }
  if (episode.status === "resolution_pending" && episode.closedAt !== null) {
    context.addIssue({ code: "custom", path: ["closedAt"], message: "待结算对话仍可恢复，不得伪装成已关闭" });
  }
  if ((episode.status === "resolved") !== (episode.worldCommit !== null)) {
    context.addIssue({ code: "custom", path: ["worldCommit"], message: "已结算对话必须且只能携带世界提交" });
  }
  if (["resolved", "exited", "expired", "stale"].includes(episode.status)
    && episode.closedAt === null) {
    context.addIssue({ code: "custom", path: ["closedAt"], message: "终态对话必须有关闭时间" });
  }
  if (["resolved", "exited", "expired", "stale"].includes(episode.status)
    && episode.currentPrompt !== null) {
    context.addIssue({ code: "custom", path: ["currentPrompt"], message: "终态对话不得继续发出问题" });
  }
  const requestIds = episode.requestReceipts.map((item) => item.requestId);
  if (new Set(requestIds).size !== requestIds.length) {
    context.addIssue({ code: "custom", path: ["requestReceipts"], message: "对话请求 ID 不得重复" });
  }
  const initialReceipt = episode.requestReceipts[0];
  if (initialReceipt?.resultRevision !== 0 || initialReceipt?.resultTurnRef !== episode.episodeId) {
    context.addIssue({
      code: "custom",
      path: ["requestReceipts", 0],
      message: "首条请求收据必须对应 Episode 创建修订",
    });
  }
  if (episode.turns.some((turn, index) => {
    const receipt = episode.requestReceipts[index + 1];
    return receipt?.requestId !== turn.requestId
      || receipt.requestHash !== turn.requestHash
      || receipt.resultRevision !== turn.sequence
      || receipt.resultTurnRef !== turn.turnId;
  })) {
    context.addIssue({
      code: "custom",
      path: ["requestReceipts"],
      message: "每个回合必须与同序请求收据的 ID、哈希、修订和结果引用一致",
    });
  }
  const uniqueFields: Array<[string, string[]]> = [
    ["issues", episode.issues.map((item) => item.issueRef)],
    ["commitments", episode.commitments.map((item) => item.commitmentId)],
    ["disclosedFactRefs", episode.disclosedFactRefs],
  ];
  for (const [path, values] of uniqueFields) {
    if (new Set(values).size !== values.length) {
      context.addIssue({ code: "custom", path: [path], message: `${path} 引用不得重复` });
    }
  }
});
export type DialogueEpisodeV4 = z.infer<typeof DialogueEpisodeV4Schema>;

export const DialogueTurnRequestV4Schema = z.object({
  schemaVersion: z.literal(DialogueTurnRequestV4SchemaVersion),
  requestId: V2IdentifierSchema,
  sessionId: V2IdentifierSchema,
  bindingId: V2IdentifierSchema,
  episodeId: V2IdentifierSchema,
  expectedEpisodeRevision: z.number().int().nonnegative(),
  expectedWorldStateVersion: z.number().int().nonnegative(),
  turnToken: z.string().regex(/^dialogueturn_[A-Za-z0-9_-]{32,192}$/u),
  utterance: TextSchema.min(2).max(2_000),
  submittedAt: TimestampSchema,
}).strict();
export type DialogueTurnRequestV4 = z.infer<
  typeof DialogueTurnRequestV4Schema
>;

const DialogueRelationshipBandV4Schema = z.enum([
  "closed",
  "guarded",
  "working",
  "open",
]);

const PublicDialogueTurnV4Schema = z.object({
  turnId: V2IdentifierSchema,
  sequence: z.number().int().positive(),
  studentUtterance: TextSchema.max(2_000),
  intent: DialogueIntentV4Schema,
  npcAct: DialogueNpcActV4Schema,
  npcStance: DialogueNpcStanceV4Schema,
  npcPublicText: TextSchema.max(1_200),
  disclosedFactRefs: z.array(V2IdentifierSchema),
  commitmentRef: V2IdentifierSchema.nullable(),
  outcome: DialogueRuleOutcomeV4Schema,
  decidedAt: TimestampSchema,
}).strict();

const PublicDialogueResolutionV4Schema = z.object({
  routeRef: V2IdentifierSchema,
  summary: TextSchema.max(600),
  worldEventRef: V2IdentifierSchema.nullable(),
  resultingWorldStateVersion: z.number().int().nonnegative().nullable(),
  consequenceRef: V2IdentifierSchema.nullable(),
}).strict();

const DialogueViewCommonShape = {
  schemaVersion: z.literal(DialogueEpisodeViewV4SchemaVersion),
  episodeId: V2IdentifierSchema,
  sessionId: V2IdentifierSchema,
  status: z.enum(["active", "resolution_pending", "resolved", "exited", "expired", "stale"]),
  npc: z.object({
    npcRef: V2IdentifierSchema,
    displayName: TextSchema.max(120),
    roleRef: V2IdentifierSchema,
  }).strict(),
  topicRef: V2IdentifierSchema,
  title: TextSchema.max(240),
  objective: TextSchema.max(600),
  openingStudentUtterance: TextSchema.max(2_000).optional(),
  currentPrompt: TextSchema.max(600).nullable(),
  allowedIntents: z.array(DialogueIntentV4Schema).min(1).max(10),
  turnCount: z.number().int().nonnegative(),
  maximumTurns: z.number().int().positive(),
  expiresAtVirtualMinute: z.number().int().positive(),
  relationship: z.object({
    trust: DialogueRelationshipBandV4Schema,
    cooperation: DialogueRelationshipBandV4Schema,
    alertness: DialogueRelationshipBandV4Schema,
    recentChanges: z.array(TextSchema.max(240)).max(6),
  }).strict(),
  issues: z.array(DialogueIssueStateV4Schema),
  commitments: z.array(DialogueCommitmentV4Schema),
  disclosedFacts: z.array(z.object({
    factRef: V2IdentifierSchema,
    publicText: TextSchema.max(600),
    knowledgeRefs: z.array(V2IdentifierSchema).min(1).max(12),
  }).strict()).max(20),
  turns: z.array(PublicDialogueTurnV4Schema),
  exitOptions: z.array(TextSchema.max(240)),
  resolution: PublicDialogueResolutionV4Schema.nullable(),
};

export const StudentDialogueEpisodeViewV4Schema = z.object({
  ...DialogueViewCommonShape,
  audience: z.literal("student"),
}).strict();

const TeacherDialogueEpisodeViewV4Schema = z.object({
  ...DialogueViewCommonShape,
  audience: z.literal("teacher"),
  causalSummary: z.object({
    sourceWorldStateVersion: z.number().int().nonnegative(),
    elapsedDialogueMinutes: z.number().int().nonnegative(),
    exactRelationship: z.object({
      trust: z.number().int().min(0).max(100),
      cooperation: z.number().int().min(0).max(100),
      alertness: z.number().int().min(0).max(100),
    }).strict(),
    unresolvedIssueRefs: z.array(V2IdentifierSchema),
  }).strict(),
}).strict();

const AdminDialogueEpisodeViewV4Schema = z.object({
  ...DialogueViewCommonShape,
  audience: z.literal("admin"),
  causalSummary: TeacherDialogueEpisodeViewV4Schema.shape.causalSummary,
  runtime: z.object({
    definitionRef: V2IdentifierSchema,
    definitionHash: V2ContentHashSchema,
    learnerSubjectHash: V2ContentHashSchema,
    privateBoundaryHash: V2ContentHashSchema,
    receipts: z.array(DialogueRuntimeReceiptV4Schema),
  }).strict(),
}).strict();

export const DialogueEpisodeViewV4Schema = z.discriminatedUnion("audience", [
  StudentDialogueEpisodeViewV4Schema,
  TeacherDialogueEpisodeViewV4Schema,
  AdminDialogueEpisodeViewV4Schema,
]);
export type DialogueEpisodeViewV4 = z.infer<
  typeof DialogueEpisodeViewV4Schema
>;

const StudentDialogueEpisodeEnvelopeV4Schema = z.object({
  audience: z.literal("student"),
  episode: StudentDialogueEpisodeViewV4Schema,
  turnToken: z.string().regex(/^dialogueturn_[A-Za-z0-9_-]{32,192}$/u).nullable(),
}).strict();
const TeacherDialogueEpisodeEnvelopeV4Schema = z.object({
  audience: z.literal("teacher"),
  episode: TeacherDialogueEpisodeViewV4Schema,
  turnToken: z.null(),
}).strict();
const AdminDialogueEpisodeEnvelopeV4Schema = z.object({
  audience: z.literal("admin"),
  episode: AdminDialogueEpisodeViewV4Schema,
  turnToken: z.null(),
}).strict();

export const DialogueEpisodeEnvelopeV4Schema = z.discriminatedUnion("audience", [
  StudentDialogueEpisodeEnvelopeV4Schema,
  TeacherDialogueEpisodeEnvelopeV4Schema,
  AdminDialogueEpisodeEnvelopeV4Schema,
]);
export type DialogueEpisodeEnvelopeV4 = z.infer<
  typeof DialogueEpisodeEnvelopeV4Schema
>;

export const DialogueEpisodeResponseV4Schema = z.object({
  dialogue: DialogueEpisodeEnvelopeV4Schema.nullable(),
}).strict();

const DialogueStartResponseSharedShape = {
  schemaVersion: z.literal(DialogueStartResponseV4SchemaVersion),
  safeMessage: TextSchema.max(600),
};

export const DialogueStartResponseV4Schema = z.discriminatedUnion("status", [
  z.object({
    ...DialogueStartResponseSharedShape,
    status: z.literal("opened"),
    dialogue: StudentDialogueEpisodeEnvelopeV4Schema,
  }).strict(),
  z.object({
    ...DialogueStartResponseSharedShape,
    status: z.enum(["clarification_required", "refused"]),
    dialogue: z.null(),
  }).strict(),
]);
export type DialogueStartResponseV4 = z.infer<
  typeof DialogueStartResponseV4Schema
>;
