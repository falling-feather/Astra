import { createHash } from "node:crypto";
import {
  DialogueEpisodeV4Schema,
  DialogueEpisodeV4SchemaVersion,
  DialogueEpisodeViewV4Schema,
  DialogueEpisodeViewV4SchemaVersion,
  DialogueSceneDefinitionV4Schema,
  DialogueTurnRequestV4Schema,
  V2IdentifierSchema,
  type DialogueEpisodeV4,
  type DialogueEpisodeViewV4,
  type DialogueIntentV4,
  type DialogueSceneDefinitionV4,
  type DialogueTurnRequestV4,
  type FlagshipContentReferenceV4,
} from "@ronggang/contracts";
import { hashCanonical } from "@ronggang/course-content";
import {
  DialogueEpisodeNotFoundError,
  type DialogueEpisodeStoreV4,
} from "./dialogue-episode-v4-store.js";
import {
  hasAffirmedNaturalLanguageMatchV4,
  hasNaturalLanguageIntentMatchV4,
} from "./natural-language-scope-v4.js";

export {
  hasAffirmedNaturalLanguageMatchV4,
  hasNaturalLanguageIntentMatchV4,
} from "./natural-language-scope-v4.js";

export class DialogueDefinitionNotFoundError extends Error {
  constructor(public readonly npcRef: string) {
    super(`当前人物没有发布 V4 对话场景：${npcRef}`);
    this.name = "DialogueDefinitionNotFoundError";
  }
}

export class DialogueDefinitionDriftError extends Error {
  constructor(
    public readonly definitionRef: string,
    public readonly expectedHash: string,
    public readonly actualHash: string,
  ) {
    super(`对话定义发生内容漂移：${definitionRef}`);
    this.name = "DialogueDefinitionDriftError";
  }
}

export class DialogueAlreadyActiveError extends Error {
  constructor(public readonly episodeId: string) {
    super(`当前学习者已有未结束的对话：${episodeId}`);
    this.name = "DialogueAlreadyActiveError";
  }
}

export class DialogueIdempotencyConflictError extends Error {
  constructor(public readonly requestId: string) {
    super(`对话请求 ID 已由不同载荷使用：${requestId}`);
    this.name = "DialogueIdempotencyConflictError";
  }
}

export class DialogueRevisionConflictError extends Error {
  constructor(
    public readonly expectedRevision: number,
    public readonly actualRevision: number,
  ) {
    super(`对话修订冲突：期望 ${expectedRevision}，实际 ${actualRevision}`);
    this.name = "DialogueRevisionConflictError";
  }
}

export class DialogueWorldStateConflictError extends Error {
  constructor(
    public readonly expectedWorldStateVersion: number,
    public readonly actualWorldStateVersion: number,
  ) {
    super(`对话所依赖的世界状态已改变：期望 ${expectedWorldStateVersion}，实际 ${actualWorldStateVersion}`);
    this.name = "DialogueWorldStateConflictError";
  }
}

export class DialogueAudienceMismatchError extends Error {
  constructor() {
    super("当前身份无权读取或推进这段对话");
    this.name = "DialogueAudienceMismatchError";
  }
}

export class DialogueClosedError extends Error {
  constructor(public readonly status: DialogueEpisodeV4["status"]) {
    super(`对话已经不能继续：${status}`);
    this.name = "DialogueClosedError";
  }
}

export interface BeginDialogueInputV4 {
  requestId: string;
  sessionId: string;
  learnerSubjectHash: string;
  studentActorRef: string;
  studentBindingRef: string;
  npcRef: string;
  flagshipContentRef: FlagshipContentReferenceV4;
  openingStudentUtterance: string;
  sourceWorldStateVersion: number;
  virtualMinute: number;
  challengeLevel: 3 | 4 | 5 | 6 | 7;
  submittedAt: string;
}

export interface DialogueRuleSelectorCandidateV4 {
  ruleRef: string;
  priority: number;
  outcome: DialogueSceneDefinitionV4["rules"][number]["outcome"];
  npcAct: DialogueSceneDefinitionV4["rules"][number]["response"]["act"];
  npcStance: DialogueSceneDefinitionV4["rules"][number]["response"]["stance"];
  publicText: string;
  nextPrompt: string | null;
  routeRef: string | null;
}

export interface DialogueRuleSelectorInputV4 {
  episodeId: string;
  definitionRef: string;
  turnNumber: number;
  utterance: string;
  intent: DialogueIntentV4;
  matchedSignalRefs: string[];
  issues: DialogueEpisodeV4["issues"];
  publicHistory: Array<{
    sequence: number;
    studentUtterance: string;
    npcPublicText: string;
    outcome: DialogueEpisodeV4["turns"][number]["outcome"];
  }>;
  candidates: DialogueRuleSelectorCandidateV4[];
}

export interface DialogueRuleSelectorResultV4 {
  selectedRuleRef: string;
  modelRunRef: string;
  costMicros: number;
}

export interface DialogueRuleSelectorV4 {
  select(input: Readonly<DialogueRuleSelectorInputV4>): Promise<DialogueRuleSelectorResultV4>;
}

export interface DialogueEpisodeEngineV4Options {
  store: DialogueEpisodeStoreV4;
  definitions: DialogueSceneDefinitionV4[];
  npcDisplayNames: Record<string, string>;
  selector?: DialogueRuleSelectorV4;
  selectorTimeoutMs?: number;
}

interface TurnExecutionInputV4 {
  request: DialogueTurnRequestV4;
  learnerSubjectHash: string;
  actualWorldStateVersion: number;
  actualVirtualMinute: number;
}

interface CommitResolutionInputV4 {
  episodeId: string;
  expectedRevision: number;
  worldRequestId: string;
  worldEventRef: string;
  resultingWorldStateVersion: number | null;
  consequenceRef: string | null;
  committedAt: string;
}

interface SelectorDecision {
  rule: DialogueSceneDefinitionV4["rules"][number];
  mode: "live_model" | "deterministic_rule" | "deterministic_fallback";
  modelRunRef: string | null;
  failureCode: string | null;
  latencyMs: number;
  costMicros: number;
  inputHash: string;
  outputHash: string;
}

const ACTIVE_STATUSES = new Set<DialogueEpisodeV4["status"]>([
  "active",
  "resolution_pending",
]);

function deterministicId(prefix: string, ...parts: string[]): string {
  return `${prefix}-${createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 32)}`;
}

function normalize(text: string): string {
  return text.normalize("NFKC").toLocaleLowerCase("zh-CN").replace(/\s+/gu, "");
}

function literalPattern(value: string): RegExp {
  return new RegExp(
    normalize(value).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"),
    "u",
  );
}

function includesScopedAny(text: string, values: string[]): boolean {
  return values.some((value) => hasAffirmedNaturalLanguageMatchV4(
    text,
    literalPattern(value),
  ));
}

function includesIntentAny(text: string, values: string[]): boolean {
  return values.some((value) => hasNaturalLanguageIntentMatchV4(
    text,
    literalPattern(value),
  ));
}

export function classifyDialogueIntentV4(utterance: string): DialogueIntentV4 {
  const text = normalize(utterance);
  if (includesScopedAny(text, ["结束对话", "先离开", "先去查", "不谈了", "到此为止"])) {
    return "exit_conversation";
  }
  if (includesScopedAny(text, ["抱歉", "道歉", "重新说明", "重新提问", "收回", "删除越界"])) {
    return "repair_breach";
  }
  if (includesScopedAny(text, [
    "交换", "合作", "换素材", "套餐", "期限", "限定平台", "联系", "引荐",
    "永久", "全部权利", "保证版权", "水印就能发",
  ])) {
    return "negotiate_terms";
  }
  if (includesScopedAny(text, [
    "不拍", "隐私", "撤回", "不代表", "编辑独立", "标题独立", "边界",
  ]) || includesIntentAny(text, [
    "不想说明身份", "不谈来源", "不想交换素材", "不谈合作", "不接受这个条件",
    "不提开放问题",
  ])) {
    return "set_boundary";
  }
  if (includesScopedAny(text, ["来源", "证据", "原件", "回执", "作者", "授权证明"])) {
    return "request_evidence";
  }
  if (includesScopedAny(text, ["我接受", "我同意", "按这个条件", "可以这样"])) {
    return "accept_condition";
  }
  if (includesScopedAny(text, ["你的意思", "也就是说", "我理解", "我复述"])) {
    return "reflect_back";
  }
  if (includesScopedAny(text, [
    "怎么看", "为什么", "能否讲讲", "对你来说", "怎样看待", "问问你的看法",
  ])) {
    return "ask_open_question";
  }
  if (includesScopedAny(text, [
    "我是", "学生记者", "课程实训", "来采访", "报道目的", "说明身份", "报道用途",
  ])) {
    return "introduce_scope";
  }
  return "probe_detail";
}

export function matchDialogueSignalsV4(
  definition: DialogueSceneDefinitionV4,
  utterance: string,
): string[] {
  return definition.signals
    .filter((signal) => signal.keywordGroups.every((group) => (
      group.some((keyword) => hasAffirmedNaturalLanguageMatchV4(
        utterance,
        literalPattern(keyword),
      ))
    )))
    .map((signal) => signal.signalRef);
}

function eligibleRules(
  definition: DialogueSceneDefinitionV4,
  episode: DialogueEpisodeV4,
  intent: DialogueIntentV4,
  matchedSignalRefs: string[],
): DialogueSceneDefinitionV4["rules"] {
  const signalSet = new Set(matchedSignalRefs);
  const issueStatuses = new Map(episode.issues.map((issue) => [issue.issueRef, issue.status]));
  const turnNumber = episode.turnCount + 1;
  return definition.rules
    .filter((candidate) => (
      turnNumber >= candidate.minTurn
      && turnNumber <= candidate.maxTurn
      && candidate.allowedIntents.includes(intent)
      && candidate.requiredAllSignalRefs.every((ref) => signalSet.has(ref))
      && (candidate.requiredAnySignalRefs.length === 0
        || candidate.requiredAnySignalRefs.some((ref) => signalSet.has(ref)))
      && candidate.forbiddenSignalRefs.every((ref) => !signalSet.has(ref))
      && candidate.issueRequirements.every((requirement) => (
        requirement.allowedStatuses.includes(issueStatuses.get(requirement.issueRef) ?? "open")
      ))
    ))
    .sort((left, right) => right.priority - left.priority
      || left.ruleRef.localeCompare(right.ruleRef));
}

function clampRelationship(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function relationshipBand(value: number): "closed" | "guarded" | "working" | "open" {
  if (value < 25) return "closed";
  if (value < 50) return "guarded";
  if (value < 75) return "working";
  return "open";
}

export class DialogueEpisodeEngineV4 {
  readonly #store: DialogueEpisodeStoreV4;
  readonly #definitions = new Map<string, DialogueSceneDefinitionV4>();
  readonly #definitionsByNpc = new Map<string, DialogueSceneDefinitionV4>();
  readonly #npcDisplayNames: Record<string, string>;
  readonly #selector: DialogueRuleSelectorV4 | undefined;
  readonly #selectorTimeoutMs: number;
  readonly #locks = new Map<string, Promise<void>>();

  constructor(options: DialogueEpisodeEngineV4Options) {
    this.#store = options.store;
    this.#npcDisplayNames = { ...options.npcDisplayNames };
    this.#selector = options.selector;
    this.#selectorTimeoutMs = options.selectorTimeoutMs ?? 1_500;
    for (const input of options.definitions) {
      const definition = DialogueSceneDefinitionV4Schema.parse(input);
      if (this.#definitions.has(definition.definitionId)
        || this.#definitionsByNpc.has(definition.npcRef)) {
        throw new Error("V4 对话场景 ID 与 NPC 映射必须唯一");
      }
      if (!this.#npcDisplayNames[definition.npcRef]) {
        throw new Error(`V4 对话场景缺少 NPC 显示名：${definition.npcRef}`);
      }
      this.#definitions.set(definition.definitionId, definition);
      this.#definitionsByNpc.set(definition.npcRef, definition);
    }
  }

  async beginDialogue(input: BeginDialogueInputV4): Promise<DialogueEpisodeV4> {
    V2IdentifierSchema.parse(input.requestId);
    V2IdentifierSchema.parse(input.sessionId);
    V2IdentifierSchema.parse(input.studentActorRef);
    const definition = this.#definitionsByNpc.get(input.npcRef);
    if (!definition) throw new DialogueDefinitionNotFoundError(input.npcRef);
    const episodeId = deterministicId(
      "dialogue",
      input.sessionId,
      input.learnerSubjectHash,
      input.requestId,
    );
    const requestHash = hashCanonical(input);
    const { openingStudentUtterance: _openingStudentUtterance, ...legacyInput } = input;
    const legacyRequestHash = hashCanonical(legacyInput);

    return this.#withLock(
      `session:${input.sessionId}:${input.learnerSubjectHash}`,
      async () => {
        const replay = await this.#store.load(episodeId);
        if (replay) {
          const receipt = replay.requestReceipts.find((item) => item.requestId === input.requestId);
          const requestMatches = receipt?.requestHash === requestHash
            || (receipt?.requestHash === legacyRequestHash
              && replay.openingStudentUtterance === undefined);
          if (!requestMatches) {
            throw new DialogueIdempotencyConflictError(input.requestId);
          }
          this.#definitionForEpisode(replay);
          return replay;
        }
        const active = (await this.#store.listBySession(input.sessionId)).find((episode) => (
          episode.learnerSubjectHash === input.learnerSubjectHash
          && ACTIVE_STATUSES.has(episode.status)
        ));
        if (active) throw new DialogueAlreadyActiveError(active.episodeId);

        const levelKey = `level${input.challengeLevel}` as const;
        const maximumTurns = definition.maximumTurnsByChallenge[levelKey];
        const expiresAtVirtualMinute = input.virtualMinute
          + definition.responseWindowMinutesByChallenge[levelKey];
        const episode = DialogueEpisodeV4Schema.parse({
          schemaVersion: DialogueEpisodeV4SchemaVersion,
          episodeId,
          definitionRef: definition.definitionId,
          definitionHash: definition.definitionHash,
          flagshipContentRef: input.flagshipContentRef,
          sessionId: input.sessionId,
          learnerSubjectHash: input.learnerSubjectHash,
          studentActorRef: input.studentActorRef,
          studentBindingRef: input.studentBindingRef,
          npcRef: definition.npcRef,
          npcRoleRef: definition.npcRoleRef,
          npcDisplayName: this.#npcDisplayNames[definition.npcRef],
          topicRef: definition.topicRef,
          title: definition.title,
          objective: definition.objective,
          privateBoundaryHash: definition.privateBoundaryHash,
          openingStudentUtterance: input.openingStudentUtterance,
          sourceWorldStateVersion: input.sourceWorldStateVersion,
          challengeLevel: input.challengeLevel,
          startedAtVirtualMinute: input.virtualMinute,
          expiresAtVirtualMinute,
          elapsedDialogueMinutes: 0,
          status: "active",
          revision: 0,
          turnCount: 0,
          maximumTurns,
          currentPrompt: definition.openingPrompt,
          allowedIntents: definition.allowedIntents,
          issues: definition.issues.map((issue) => ({
            issueRef: issue.issueRef,
            publicLabel: issue.publicLabel,
            status: issue.initialStatus,
            lastReason: null,
          })),
          disclosedFactRefs: [],
          relationship: definition.initialRelationship,
          commitments: [],
          turns: [],
          runtimeReceipts: [],
          requestReceipts: [{
            requestId: input.requestId,
            requestHash,
            resultRevision: 0,
            resultTurnRef: episodeId,
          }],
          pendingResolution: null,
          worldCommit: null,
          exitOptions: definition.exitOptions,
          startedAt: input.submittedAt,
          updatedAt: input.submittedAt,
          closedAt: null,
        });
        await this.#store.create(episode);
        return episode;
      },
    );
  }

  async submitTurn(input: TurnExecutionInputV4): Promise<DialogueEpisodeV4> {
    const request = DialogueTurnRequestV4Schema.parse(input.request);
    return this.#withLock(`episode:${request.episodeId}`, async () => {
      const episode = await this.#requiredEpisode(request.episodeId);
      if (episode.sessionId !== request.sessionId
        || episode.learnerSubjectHash !== input.learnerSubjectHash
        || episode.studentBindingRef !== request.bindingId) {
        throw new DialogueAudienceMismatchError();
      }
      const requestHash = hashCanonical(request);
      const replay = episode.requestReceipts.find((item) => item.requestId === request.requestId);
      if (replay) {
        if (replay.requestHash !== requestHash) {
          throw new DialogueIdempotencyConflictError(request.requestId);
        }
        return episode;
      }
      if (episode.status !== "active") throw new DialogueClosedError(episode.status);
      if (episode.revision !== request.expectedEpisodeRevision) {
        throw new DialogueRevisionConflictError(request.expectedEpisodeRevision, episode.revision);
      }
      if (request.expectedWorldStateVersion !== input.actualWorldStateVersion
        || episode.sourceWorldStateVersion !== input.actualWorldStateVersion) {
        await this.#closeAs(episode, "stale", request.submittedAt);
        throw new DialogueWorldStateConflictError(
          request.expectedWorldStateVersion,
          input.actualWorldStateVersion,
        );
      }
      const effectiveVirtualMinute = input.actualVirtualMinute
        + episode.elapsedDialogueMinutes;
      if (effectiveVirtualMinute >= episode.expiresAtVirtualMinute) {
        await this.#closeAs(episode, "expired", request.submittedAt);
        throw new DialogueClosedError("expired");
      }

      const definition = this.#definition(episode.definitionRef);
      const intent = classifyDialogueIntentV4(request.utterance);
      const matchedSignalRefs = matchDialogueSignalsV4(definition, request.utterance);
      const candidates = eligibleRules(definition, episode, intent, matchedSignalRefs);
      if (candidates.length === 0) {
        throw new Error(`对话内容缺少 ${intent} 的安全兜底规则`);
      }
      const decision = await this.#selectRule({
        definition,
        episode,
        request,
        intent,
        matchedSignalRefs,
        candidates,
      });
      const selected = decision.rule;
      const sequence = episode.turnCount + 1;
      const turnId = deterministicId("dialogue-turn", episode.episodeId, request.requestId);
      const commitmentId = selected.commitment
        ? deterministicId("dialogue-commitment", turnId, selected.ruleRef)
        : null;
      const issueUpdates = new Map(selected.issueUpdates.map((update) => [update.issueRef, update]));
      const nextIssues = episode.issues.map((issue) => {
        const update = issueUpdates.get(issue.issueRef);
        return update ? {
          ...issue,
          status: update.nextStatus,
          lastReason: update.publicReason,
        } : issue;
      });
      const nextRelationship = {
        trust: clampRelationship(episode.relationship.trust + selected.relationshipDelta.trust),
        cooperation: clampRelationship(episode.relationship.cooperation + selected.relationshipDelta.cooperation),
        alertness: clampRelationship(episode.relationship.alertness + selected.relationshipDelta.alertness),
      };
      const nextCommitments = selected.commitment && commitmentId ? [
        ...episode.commitments,
        {
          commitmentId,
          madeBy: selected.commitment.madeBy,
          summary: selected.commitment.summary,
          condition: selected.commitment.condition,
          dueAtVirtualMinute: selected.commitment.dueAfterVirtualMinutes === null
            ? null
            : input.actualVirtualMinute + selected.commitment.dueAfterVirtualMinutes,
          status: "active" as const,
          sourceTurnRef: turnId,
        },
      ] : episode.commitments;
      const turn = {
        turnId,
        sequence,
        requestId: request.requestId,
        requestHash,
        studentUtterance: request.utterance,
        intent,
        matchedSignalRefs,
        selectedRuleRef: selected.ruleRef,
        npcAct: selected.response.act,
        npcStance: selected.response.stance,
        npcPublicText: selected.response.publicText,
        nextPrompt: selected.response.nextPrompt,
        issueUpdates: selected.issueUpdates,
        disclosedFactRefs: selected.disclosedFactRefs,
        relationshipDelta: selected.relationshipDelta,
        commitmentRef: commitmentId,
        timeCostMinutes: selected.timeCostMinutes,
        outcome: selected.outcome,
        decidedAt: request.submittedAt,
      };
      const terminalByLimit = sequence >= episode.maximumTurns
        && !["resolved", "exited"].includes(selected.outcome);
      const status: DialogueEpisodeV4["status"] = selected.outcome === "resolved"
        ? "resolution_pending"
        : selected.outcome === "exited"
          ? "exited"
          : terminalByLimit
            ? "expired"
            : "active";
      const closedAt = ["exited", "expired"].includes(status)
        ? request.submittedAt
        : null;
      const pendingResolution = status === "resolution_pending" ? {
        routeRef: selected.routeRef!,
        eventTemplateRef: selected.eventTemplateRef!,
        resolutionSummary: selected.resolutionSummary!,
        combinedStudentUtterance: [
          episode.openingStudentUtterance,
          ...episode.turns.map((item) => item.studentUtterance),
          turn.studentUtterance,
        ]
          .filter((item): item is string => Boolean(item))
          .join("\n"),
        worldRequestId: deterministicId(
          "dialogue-world-request",
          episode.episodeId,
          selected.routeRef!,
        ),
        preparedAt: request.submittedAt,
      } : null;
      const next = DialogueEpisodeV4Schema.parse({
        ...episode,
        revision: episode.revision + 1,
        turnCount: sequence,
        elapsedDialogueMinutes: episode.elapsedDialogueMinutes + selected.timeCostMinutes,
        status,
        currentPrompt: status === "active"
          ? selected.response.nextPrompt ?? definition.openingPrompt
          : null,
        issues: nextIssues,
        disclosedFactRefs: [...new Set([
          ...episode.disclosedFactRefs,
          ...selected.disclosedFactRefs,
        ])],
        relationship: nextRelationship,
        commitments: nextCommitments,
        turns: [...episode.turns, turn],
        runtimeReceipts: [...episode.runtimeReceipts, {
          receiptId: deterministicId("dialogue-runtime", turnId),
          turnRef: turnId,
          decisionMode: decision.mode,
          candidateRuleRefs: candidates.map((candidate) => candidate.ruleRef),
          selectedRuleRef: selected.ruleRef,
          inputHash: decision.inputHash,
          outputHash: decision.outputHash,
          modelRunRef: decision.modelRunRef,
          failureCode: decision.failureCode,
          latencyMs: decision.latencyMs,
          costMicros: decision.costMicros,
        }],
        requestReceipts: [...episode.requestReceipts, {
          requestId: request.requestId,
          requestHash,
          resultRevision: episode.revision + 1,
          resultTurnRef: turnId,
        }],
        pendingResolution,
        updatedAt: request.submittedAt,
        closedAt,
      });
      await this.#store.compareAndSet(episode.episodeId, episode.revision, next);
      return next;
    });
  }

  async commitResolution(input: CommitResolutionInputV4): Promise<DialogueEpisodeV4> {
    return this.#withLock(`episode:${input.episodeId}`, async () => {
      const episode = await this.#requiredEpisode(input.episodeId);
      if (episode.revision !== input.expectedRevision) {
        throw new DialogueRevisionConflictError(input.expectedRevision, episode.revision);
      }
      if (episode.status !== "resolution_pending" || !episode.pendingResolution) {
        if (episode.status === "resolved"
          && episode.worldCommit?.worldEventRef === input.worldEventRef) {
          return episode;
        }
        throw new DialogueClosedError(episode.status);
      }
      if (episode.pendingResolution.worldRequestId !== input.worldRequestId) {
        throw new DialogueIdempotencyConflictError(input.worldRequestId);
      }
      const pending = episode.pendingResolution;
      const next = DialogueEpisodeV4Schema.parse({
        ...episode,
        revision: episode.revision + 1,
        status: "resolved",
        pendingResolution: null,
        worldCommit: {
          routeRef: pending.routeRef,
          resolutionSummary: pending.resolutionSummary,
          worldEventRef: input.worldEventRef,
          resultingWorldStateVersion: input.resultingWorldStateVersion,
          consequenceRef: input.consequenceRef,
          committedAt: input.committedAt,
        },
        updatedAt: input.committedAt,
        closedAt: input.committedAt,
      });
      await this.#store.compareAndSet(episode.episodeId, episode.revision, next);
      return next;
    });
  }

  async attachWorldConsequence(input: {
    episodeId: string;
    expectedRevision: number;
    resultingWorldStateVersion: number;
    consequenceRef: string;
    updatedAt: string;
  }): Promise<DialogueEpisodeV4> {
    return this.#withLock(`episode:${input.episodeId}`, async () => {
      const episode = await this.#requiredEpisode(input.episodeId);
      if (episode.revision !== input.expectedRevision) {
        throw new DialogueRevisionConflictError(input.expectedRevision, episode.revision);
      }
      if (episode.status !== "resolved" || !episode.worldCommit) {
        throw new DialogueClosedError(episode.status);
      }
      const next = DialogueEpisodeV4Schema.parse({
        ...episode,
        revision: episode.revision + 1,
        worldCommit: {
          ...episode.worldCommit,
          resultingWorldStateVersion: input.resultingWorldStateVersion,
          consequenceRef: input.consequenceRef,
        },
        updatedAt: input.updatedAt,
      });
      await this.#store.compareAndSet(episode.episodeId, episode.revision, next);
      return next;
    });
  }

  async markPendingStale(input: {
    episodeId: string;
    expectedRevision: number;
    closedAt: string;
  }): Promise<DialogueEpisodeV4> {
    return this.#withLock(`episode:${input.episodeId}`, async () => {
      const episode = await this.#requiredEpisode(input.episodeId);
      if (episode.revision !== input.expectedRevision) {
        throw new DialogueRevisionConflictError(input.expectedRevision, episode.revision);
      }
      if (episode.status !== "resolution_pending") {
        throw new DialogueClosedError(episode.status);
      }
      const next = DialogueEpisodeV4Schema.parse({
        ...episode,
        revision: episode.revision + 1,
        status: "stale",
        pendingResolution: null,
        currentPrompt: null,
        updatedAt: input.closedAt,
        closedAt: input.closedAt,
      });
      await this.#store.compareAndSet(episode.episodeId, episode.revision, next);
      return next;
    });
  }

  async loadEpisode(episodeId: string): Promise<DialogueEpisodeV4 | null> {
    const episode = await this.#store.load(episodeId);
    if (episode) this.#definitionForEpisode(episode);
    return episode;
  }

  async getCurrentEpisode(
    sessionId: string,
    learnerSubjectHash: string,
  ): Promise<DialogueEpisodeV4 | null> {
    const episodes = (await this.#store.listBySession(sessionId))
      .filter((episode) => episode.learnerSubjectHash === learnerSubjectHash)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    const episode = episodes.find((candidate) => ACTIVE_STATUSES.has(candidate.status))
      ?? episodes[0]
      ?? null;
    if (episode) this.#definitionForEpisode(episode);
    return episode;
  }

  async getCurrentEpisodeForSession(sessionId: string): Promise<DialogueEpisodeV4 | null> {
    const episodes = (await this.#store.listBySession(sessionId))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    const episode = episodes.find((candidate) => ACTIVE_STATUSES.has(candidate.status))
      ?? episodes[0]
      ?? null;
    if (episode) this.#definitionForEpisode(episode);
    return episode;
  }

  async listEpisodesForSession(sessionId: string): Promise<DialogueEpisodeV4[]> {
    const episodes = await this.#store.listBySession(sessionId);
    episodes.forEach((episode) => this.#definitionForEpisode(episode));
    return episodes;
  }

  async listPendingEpisodes(): Promise<DialogueEpisodeV4[]> {
    const episodes = (await this.#store.listAll())
      .filter((episode) => episode.status === "resolution_pending")
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
    episodes.forEach((episode) => this.#definitionForEpisode(episode));
    return episodes;
  }

  project(
    episode: DialogueEpisodeV4,
    audience: "student" | "teacher" | "admin",
  ): DialogueEpisodeViewV4 {
    const definition = this.#definitionForEpisode(episode);
    const publicTurns = episode.turns.map((turn) => ({
      turnId: turn.turnId,
      sequence: turn.sequence,
      studentUtterance: turn.studentUtterance,
      intent: turn.intent,
      npcAct: turn.npcAct,
      npcStance: turn.npcStance,
      npcPublicText: turn.npcPublicText,
      disclosedFactRefs: turn.disclosedFactRefs,
      commitmentRef: turn.commitmentRef,
      outcome: turn.outcome,
      decidedAt: turn.decidedAt,
    }));
    const resolution = episode.pendingResolution ? {
      routeRef: episode.pendingResolution.routeRef,
      summary: episode.pendingResolution.resolutionSummary,
      worldEventRef: null,
      resultingWorldStateVersion: null,
      consequenceRef: null,
    } : episode.worldCommit ? {
      routeRef: episode.worldCommit.routeRef,
      summary: episode.worldCommit.resolutionSummary,
      worldEventRef: episode.worldCommit.worldEventRef,
      resultingWorldStateVersion: episode.worldCommit.resultingWorldStateVersion,
      consequenceRef: episode.worldCommit.consequenceRef,
    } : null;
    const common = {
      schemaVersion: DialogueEpisodeViewV4SchemaVersion,
      episodeId: episode.episodeId,
      sessionId: episode.sessionId,
      status: episode.status,
      npc: {
        npcRef: episode.npcRef,
        displayName: episode.npcDisplayName,
        roleRef: episode.npcRoleRef,
      },
      topicRef: episode.topicRef,
      title: episode.title,
      objective: episode.objective,
      ...(episode.openingStudentUtterance
        ? { openingStudentUtterance: episode.openingStudentUtterance }
        : {}),
      currentPrompt: episode.currentPrompt,
      allowedIntents: episode.allowedIntents,
      turnCount: episode.turnCount,
      maximumTurns: episode.maximumTurns,
      expiresAtVirtualMinute: episode.expiresAtVirtualMinute,
      relationship: {
        trust: relationshipBand(episode.relationship.trust),
        cooperation: relationshipBand(episode.relationship.cooperation),
        alertness: relationshipBand(episode.relationship.alertness),
        recentChanges: episode.turns.slice(-6).map((turn) => turn.relationshipDelta.publicReason),
      },
      issues: episode.issues,
      commitments: episode.commitments,
      disclosedFacts: definition.facts
        .filter((fact) => episode.disclosedFactRefs.includes(fact.factRef))
        .map((fact) => ({
          factRef: fact.factRef,
          publicText: fact.publicText,
          knowledgeRefs: fact.knowledgeRefs,
        })),
      turns: publicTurns,
      exitOptions: episode.exitOptions,
      resolution,
    };
    if (audience === "student") {
      return DialogueEpisodeViewV4Schema.parse({ ...common, audience });
    }
    const causalSummary = {
      sourceWorldStateVersion: episode.sourceWorldStateVersion,
      elapsedDialogueMinutes: episode.elapsedDialogueMinutes,
      exactRelationship: episode.relationship,
      unresolvedIssueRefs: episode.issues
        .filter((issue) => issue.status !== "satisfied")
        .map((issue) => issue.issueRef),
    };
    if (audience === "teacher") {
      return DialogueEpisodeViewV4Schema.parse({ ...common, audience, causalSummary });
    }
    return DialogueEpisodeViewV4Schema.parse({
      ...common,
      audience,
      causalSummary,
      runtime: {
        definitionRef: episode.definitionRef,
        definitionHash: episode.definitionHash,
        learnerSubjectHash: episode.learnerSubjectHash,
        privateBoundaryHash: episode.privateBoundaryHash,
        receipts: episode.runtimeReceipts,
      },
    });
  }

  async #selectRule(input: {
    definition: DialogueSceneDefinitionV4;
    episode: DialogueEpisodeV4;
    request: DialogueTurnRequestV4;
    intent: DialogueIntentV4;
    matchedSignalRefs: string[];
    candidates: DialogueSceneDefinitionV4["rules"];
  }): Promise<SelectorDecision> {
    const selectorInput: DialogueRuleSelectorInputV4 = {
      episodeId: input.episode.episodeId,
      definitionRef: input.definition.definitionId,
      turnNumber: input.episode.turnCount + 1,
      utterance: input.request.utterance,
      intent: input.intent,
      matchedSignalRefs: input.matchedSignalRefs,
      issues: input.episode.issues,
      publicHistory: input.episode.turns.map((turn) => ({
        sequence: turn.sequence,
        studentUtterance: turn.studentUtterance,
        npcPublicText: turn.npcPublicText,
        outcome: turn.outcome,
      })),
      candidates: input.candidates.map((candidate) => ({
        ruleRef: candidate.ruleRef,
        priority: candidate.priority,
        outcome: candidate.outcome,
        npcAct: candidate.response.act,
        npcStance: candidate.response.stance,
        publicText: candidate.response.publicText,
        nextPrompt: candidate.response.nextPrompt,
        routeRef: candidate.routeRef,
      })),
    };
    const inputHash = hashCanonical(selectorInput);
    const fallback = (
      mode: SelectorDecision["mode"],
      failureCode: string | null,
      latencyMs: number,
    ): SelectorDecision => {
      const selected = input.candidates[0]!;
      return {
        rule: selected,
        mode,
        modelRunRef: null,
        failureCode,
        latencyMs,
        costMicros: 0,
        inputHash,
        outputHash: hashCanonical({ selectedRuleRef: selected.ruleRef, mode, failureCode }),
      };
    };
    if (!this.#selector) return fallback("deterministic_rule", null, 0);

    const startedAt = Date.now();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        this.#selector.select(structuredClone(selectorInput)),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error("dialogue_model_timeout")), this.#selectorTimeoutMs);
        }),
      ]);
      const latencyMs = Math.min(120_000, Math.max(0, Date.now() - startedAt));
      const selected = input.candidates.find((candidate) => (
        candidate.ruleRef === result.selectedRuleRef
      ));
      if (!selected) return fallback("deterministic_fallback", "model_invalid_rule", latencyMs);
      if (!V2IdentifierSchema.safeParse(result.modelRunRef).success
        || !Number.isInteger(result.costMicros)
        || result.costMicros < 0
        || result.costMicros > 10_000_000) {
        return fallback("deterministic_fallback", "model_invalid_receipt", latencyMs);
      }
      return {
        rule: selected,
        mode: "live_model",
        modelRunRef: result.modelRunRef,
        failureCode: null,
        latencyMs,
        costMicros: result.costMicros,
        inputHash,
        outputHash: hashCanonical(result),
      };
    } catch (error) {
      const latencyMs = Math.min(120_000, Math.max(0, Date.now() - startedAt));
      return fallback(
        "deterministic_fallback",
        error instanceof Error && error.message === "dialogue_model_timeout"
          ? "model_timeout"
          : "model_error",
        latencyMs,
      );
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  async #closeAs(
    episode: DialogueEpisodeV4,
    status: "expired" | "stale",
    timestamp: string,
  ): Promise<void> {
    const next = DialogueEpisodeV4Schema.parse({
      ...episode,
      revision: episode.revision + 1,
      status,
      currentPrompt: null,
      updatedAt: timestamp,
      closedAt: timestamp,
    });
    await this.#store.compareAndSet(episode.episodeId, episode.revision, next);
  }

  async #requiredEpisode(episodeId: string): Promise<DialogueEpisodeV4> {
    const episode = await this.#store.load(episodeId);
    if (!episode) throw new DialogueEpisodeNotFoundError(episodeId);
    this.#definitionForEpisode(episode);
    return episode;
  }

  #definition(definitionRef: string): DialogueSceneDefinitionV4 {
    const definition = this.#definitions.get(definitionRef);
    if (!definition) throw new Error(`对话 Episode 引用了未发布定义：${definitionRef}`);
    return definition;
  }

  #definitionForEpisode(episode: DialogueEpisodeV4): DialogueSceneDefinitionV4 {
    const definition = this.#definition(episode.definitionRef);
    if (definition.definitionHash !== episode.definitionHash) {
      throw new DialogueDefinitionDriftError(
        episode.definitionRef,
        episode.definitionHash,
        definition.definitionHash,
      );
    }
    return definition;
  }

  async #withLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.#locks.set(key, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.#locks.get(key) === tail) this.#locks.delete(key);
    }
  }
}
