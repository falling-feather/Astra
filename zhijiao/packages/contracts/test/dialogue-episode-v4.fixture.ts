import {
  DialogueEpisodeV4Schema,
  DialogueEpisodeV4SchemaVersion,
  DialogueEpisodeViewV4Schema,
  DialogueEpisodeViewV4SchemaVersion,
  DialogueSceneDefinitionV4Schema,
  DialogueSceneDefinitionV4SchemaVersion,
  DialogueTurnRequestV4Schema,
  DialogueTurnRequestV4SchemaVersion,
  type DialogueEpisodeV4,
  type DialogueEpisodeViewV4,
  type DialogueSceneDefinitionV4,
  type DialogueTurnRequestV4,
} from "../src/index.js";
import { flagshipContentReferenceV4Fixture } from "./v4-flagship.fixture.js";

const hashA = "a".repeat(64);
const hashB = "b".repeat(64);

export function dialogueSceneDefinitionV4Fixture(): DialogueSceneDefinitionV4 {
  return DialogueSceneDefinitionV4Schema.parse({
    schemaVersion: DialogueSceneDefinitionV4SchemaVersion,
    definitionId: "dialogue-scene-gatekeeper-v4",
    definitionHash: hashA,
    npcRef: "npc-gatekeeper-lin",
    npcRoleRef: "role-community-gatekeeper",
    topicRef: "topic-entry-and-interview-boundary",
    title: "先说明来意，再争取进入社区",
    objective: "在不越过居民隐私边界的前提下获得采访许可。",
    openingMessage: "我是这里的门卫林师傅。今天游客多，你先说清楚来做什么。",
    openingPrompt: "你代表谁来、准备采访什么，又如何保护居民隐私？",
    privateBoundaryHash: hashB,
    localKnowledgeRefs: ["knowledge-community-entry", "knowledge-interview-consent"],
    allowedIntents: [
      "introduce_scope",
      "ask_open_question",
      "probe_detail",
      "negotiate_terms",
      "set_boundary",
      "accept_condition",
      "repair_breach",
      "exit_conversation",
    ],
    maximumTurnsByChallenge: {
      level3: 6,
      level4: 6,
      level5: 5,
      level6: 5,
      level7: 4,
    },
    responseWindowMinutesByChallenge: {
      level3: 12,
      level4: 11,
      level5: 10,
      level6: 9,
      level7: 8,
    },
    initialRelationship: { trust: 35, cooperation: 30, alertness: 65 },
    issues: [
      {
        issueRef: "issue-identity",
        publicLabel: "采访身份与目的",
        initialStatus: "open",
        requiredForResolution: true,
      },
      {
        issueRef: "issue-privacy",
        publicLabel: "居民隐私和拍摄边界",
        initialStatus: "open",
        requiredForResolution: true,
      },
    ],
    facts: [
      {
        factRef: "fact-entry-window",
        publicText: "林师傅可以在十分钟内带你联系一位愿意受访的居民。",
        knowledgeRefs: ["knowledge-community-entry"],
        disclosureRuleRefs: ["rule-resolve-entry"],
      },
    ],
    signals: [
      { signalRef: "signal-identity", keywordGroups: [["记者", "学生"], ["课程", "采访"]] },
      { signalRef: "signal-privacy", keywordGroups: [["隐私", "同意"], ["不拍", "边界"]] },
      { signalRef: "signal-demand-entry", keywordGroups: [["必须", "让我进去"]] },
      { signalRef: "signal-apology", keywordGroups: [["抱歉", "道歉"], ["重新", "说明"]] },
    ],
    rules: [
      {
        ruleRef: "rule-refuse-demand",
        priority: 100,
        minTurn: 1,
        maxTurn: 6,
        allowedIntents: ["probe_detail", "negotiate_terms"],
        requiredAllSignalRefs: ["signal-demand-entry"],
        requiredAnySignalRefs: [],
        forbiddenSignalRefs: [],
        issueRequirements: [],
        response: {
          act: "refuse",
          stance: "withdrawn",
          publicText: "不能凭一句要求就放行。这里首先是居民生活区。",
          nextPrompt: "如果你愿意重新说明身份、用途和隐私边界，我可以再听一次。",
        },
        issueUpdates: [{
          issueRef: "issue-privacy",
          nextStatus: "contested",
          publicReason: "学生试图跳过居民同意。",
        }],
        disclosedFactRefs: [],
        relationshipDelta: {
          trust: -12,
          cooperation: -10,
          alertness: 18,
          publicReason: "强行进入触发了社区边界。",
        },
        commitment: null,
        timeCostMinutes: 2,
        outcome: "refusal",
        routeRef: null,
        eventTemplateRef: null,
        resolutionSummary: null,
      },
      {
        ruleRef: "rule-repair-boundary",
        priority: 80,
        minTurn: 1,
        maxTurn: 6,
        allowedIntents: ["repair_breach", "set_boundary", "introduce_scope"],
        requiredAllSignalRefs: ["signal-apology"],
        requiredAnySignalRefs: ["signal-identity", "signal-privacy"],
        forbiddenSignalRefs: ["signal-demand-entry"],
        issueRequirements: [],
        response: {
          act: "acknowledge",
          stance: "cautious",
          publicText: "愿意重来就好。你先把不拍什么、如何征得同意说具体。",
          nextPrompt: "你会怎样向居民说明拍摄范围，并允许对方随时撤回？",
        },
        issueUpdates: [{
          issueRef: "issue-identity",
          nextStatus: "satisfied",
          publicReason: "学生重新说明了采访身份与目的。",
        }],
        disclosedFactRefs: [],
        relationshipDelta: {
          trust: 8,
          cooperation: 6,
          alertness: -8,
          publicReason: "主动修复使对话恢复。",
        },
        commitment: null,
        timeCostMinutes: 2,
        outcome: "recovery",
        routeRef: null,
        eventTemplateRef: null,
        resolutionSummary: null,
      },
      {
        ruleRef: "rule-resolve-entry",
        priority: 70,
        minTurn: 2,
        maxTurn: 6,
        allowedIntents: ["set_boundary", "accept_condition", "introduce_scope"],
        requiredAllSignalRefs: ["signal-identity", "signal-privacy"],
        requiredAnySignalRefs: [],
        forbiddenSignalRefs: ["signal-demand-entry"],
        issueRequirements: [{
          issueRef: "issue-identity",
          allowedStatuses: ["satisfied"],
        }],
        response: {
          act: "commit",
          stance: "committed",
          publicText: "边界说清楚了。我联系一位愿意受访的居民，先在门口确认同意。",
          nextPrompt: null,
        },
        issueUpdates: [{
          issueRef: "issue-privacy",
          nextStatus: "satisfied",
          publicReason: "学生承诺先征得同意并尊重撤回。",
        }],
        disclosedFactRefs: ["fact-entry-window"],
        relationshipDelta: {
          trust: 12,
          cooperation: 15,
          alertness: -12,
          publicReason: "采访方案尊重了社区边界。",
        },
        commitment: {
          madeBy: "student",
          summary: "拍摄前逐一取得可撤回的明确同意。",
          condition: "不得拍摄未授权居民和私人空间。",
          dueAfterVirtualMinutes: 10,
        },
        timeCostMinutes: 2,
        outcome: "resolved",
        routeRef: "route-entry-with-consent",
        eventTemplateRef: "event-template-gatekeeper",
        resolutionSummary: "林师傅同意在明确隐私边界后协助联系受访者。",
      },
      {
        ruleRef: "rule-clarify-boundary",
        priority: -100,
        minTurn: 1,
        maxTurn: 6,
        allowedIntents: [
          "introduce_scope",
          "ask_open_question",
          "probe_detail",
          "negotiate_terms",
          "set_boundary",
          "accept_condition",
          "repair_breach",
        ],
        requiredAllSignalRefs: [],
        requiredAnySignalRefs: [],
        forbiddenSignalRefs: [],
        issueRequirements: [],
        response: {
          act: "challenge",
          stance: "guarded",
          publicText: "我还需要你把采访目的和隐私边界说具体。",
          nextPrompt: "你代表谁来，准备拍什么，又怎样处理不同意或撤回？",
        },
        issueUpdates: [],
        disclosedFactRefs: [],
        relationshipDelta: {
          trust: 0,
          cooperation: -1,
          alertness: 1,
          publicReason: "当前说明不足以形成可执行边界。",
        },
        commitment: null,
        timeCostMinutes: 2,
        outcome: "continue",
        routeRef: null,
        eventTemplateRef: null,
        resolutionSummary: null,
      },
      {
        ruleRef: "rule-exit-boundary",
        priority: 300,
        minTurn: 1,
        maxTurn: 6,
        allowedIntents: ["exit_conversation"],
        requiredAllSignalRefs: [],
        requiredAnySignalRefs: [],
        forbiddenSignalRefs: [],
        issueRequirements: [],
        response: {
          act: "close",
          stance: "cautious",
          publicText: "可以，你准备好后再回来说明。",
          nextPrompt: null,
        },
        issueUpdates: [],
        disclosedFactRefs: [],
        relationshipDelta: {
          trust: 0,
          cooperation: 0,
          alertness: 0,
          publicReason: "学生主动结束本轮对话。",
        },
        commitment: null,
        timeCostMinutes: 1,
        outcome: "exited",
        routeRef: null,
        eventTemplateRef: null,
        resolutionSummary: null,
      },
    ],
    exitOptions: ["礼貌结束对话并返回街口继续观察。"],
  });
}

function turn(sequence: 1 | 2) {
  const resolved = sequence === 2;
  return {
    turnId: `dialogue-turn-${sequence}`,
    sequence,
    requestId: `dialogue-turn-request-${sequence}`,
    requestHash: sequence === 1 ? hashA : hashB,
    studentUtterance: resolved
      ? "我会先征得每位居民同意，不拍私人空间，并允许随时撤回。"
      : "抱歉，我是参与课程实训的学生记者，想重新说明采访目的。",
    intent: resolved ? "set_boundary" as const : "repair_breach" as const,
    matchedSignalRefs: resolved
      ? ["signal-identity", "signal-privacy"]
      : ["signal-apology", "signal-identity"],
    selectedRuleRef: resolved ? "rule-resolve-entry" : "rule-repair-boundary",
    npcAct: resolved ? "commit" as const : "acknowledge" as const,
    npcStance: resolved ? "committed" as const : "cautious" as const,
    npcPublicText: resolved
      ? "边界说清楚了。我联系一位愿意受访的居民。"
      : "愿意重来就好，请把隐私边界说具体。",
    nextPrompt: resolved ? null : "你会怎样取得居民同意？",
    issueUpdates: [{
      issueRef: resolved ? "issue-privacy" : "issue-identity",
      nextStatus: "satisfied" as const,
      publicReason: resolved ? "明确了隐私边界。" : "重新说明身份。",
    }],
    disclosedFactRefs: resolved ? ["fact-entry-window"] : [],
    relationshipDelta: {
      trust: resolved ? 12 : 8,
      cooperation: resolved ? 15 : 6,
      alertness: resolved ? -12 : -8,
      publicReason: resolved ? "尊重边界。" : "主动修复。",
    },
    commitmentRef: resolved ? "commitment-consent" : null,
    timeCostMinutes: 2,
    outcome: resolved ? "resolved" as const : "recovery" as const,
    decidedAt: `2026-09-01T00:0${sequence}:00.000Z`,
  };
}

export function dialogueEpisodeV4Fixture(
  status: "active" | "resolved" = "active",
): DialogueEpisodeV4 {
  const resolved = status === "resolved";
  const turns = resolved ? [turn(1), turn(2)] : [];
  return DialogueEpisodeV4Schema.parse({
    schemaVersion: DialogueEpisodeV4SchemaVersion,
    episodeId: "dialogue-episode-gatekeeper-1",
    definitionRef: "dialogue-scene-gatekeeper-v4",
    definitionHash: hashA,
    flagshipContentRef: flagshipContentReferenceV4Fixture(),
    sessionId: "session-xunpu-v4",
    learnerSubjectHash: hashB,
    studentActorRef: "actor-student-reporter",
    studentBindingRef: "binding-student-xunpu",
    npcRef: "npc-gatekeeper-lin",
    npcRoleRef: "role-community-gatekeeper",
    npcDisplayName: "林师傅",
    topicRef: "topic-entry-and-interview-boundary",
    title: "先说明来意，再争取进入社区",
    objective: "在不越过居民隐私边界的前提下获得采访许可。",
    privateBoundaryHash: hashB,
    sourceWorldStateVersion: 8,
    challengeLevel: 5,
    startedAtVirtualMinute: 4,
    expiresAtVirtualMinute: 14,
    elapsedDialogueMinutes: resolved ? 4 : 0,
    status,
    revision: resolved ? 3 : 0,
    turnCount: turns.length,
    maximumTurns: 5,
    currentPrompt: resolved ? null : "你代表谁来，又如何保护居民隐私？",
    allowedIntents: ["introduce_scope", "set_boundary", "repair_breach"],
    issues: [
      {
        issueRef: "issue-identity",
        publicLabel: "采访身份与目的",
        status: resolved ? "satisfied" : "open",
        lastReason: resolved ? "重新说明身份。" : null,
      },
      {
        issueRef: "issue-privacy",
        publicLabel: "居民隐私和拍摄边界",
        status: resolved ? "satisfied" : "open",
        lastReason: resolved ? "明确了隐私边界。" : null,
      },
    ],
    disclosedFactRefs: resolved ? ["fact-entry-window"] : [],
    relationship: resolved
      ? { trust: 55, cooperation: 51, alertness: 45 }
      : { trust: 35, cooperation: 30, alertness: 65 },
    commitments: resolved ? [{
      commitmentId: "commitment-consent",
      madeBy: "student",
      summary: "拍摄前逐一取得明确同意。",
      condition: "不得拍摄未授权居民和私人空间。",
      dueAtVirtualMinute: 14,
      status: "active",
      sourceTurnRef: "dialogue-turn-2",
    }] : [],
    turns,
    runtimeReceipts: turns.map((item) => ({
      receiptId: `dialogue-runtime-${item.sequence}`,
      turnRef: item.turnId,
      decisionMode: "deterministic_rule",
      candidateRuleRefs: [item.selectedRuleRef],
      selectedRuleRef: item.selectedRuleRef,
      inputHash: item.requestHash,
      outputHash: item.requestHash,
      modelRunRef: null,
      failureCode: null,
      latencyMs: 2,
      costMicros: 0,
    })),
    requestReceipts: [
      {
        requestId: "dialogue-start-request",
        requestHash: hashA,
        resultRevision: 0,
        resultTurnRef: "dialogue-episode-gatekeeper-1",
      },
      ...turns.map((item) => ({
        requestId: item.requestId,
        requestHash: item.requestHash,
        resultRevision: item.sequence,
        resultTurnRef: item.turnId,
      })),
    ],
    pendingResolution: null,
    worldCommit: resolved ? {
      routeRef: "route-entry-with-consent",
      resolutionSummary: "林师傅同意在明确隐私边界后协助联系受访者。",
      worldEventRef: "event-gatekeeper-resolved",
      resultingWorldStateVersion: 9,
      consequenceRef: "consequence-gatekeeper-entry",
      committedAt: "2026-09-01T00:03:00.000Z",
    } : null,
    exitOptions: ["礼貌结束对话并返回街口继续观察。"],
    startedAt: "2026-09-01T00:00:00.000Z",
    updatedAt: resolved ? "2026-09-01T00:03:00.000Z" : "2026-09-01T00:00:00.000Z",
    closedAt: resolved ? "2026-09-01T00:03:00.000Z" : null,
  });
}

export function dialogueTurnRequestV4Fixture(): DialogueTurnRequestV4 {
  return DialogueTurnRequestV4Schema.parse({
    schemaVersion: DialogueTurnRequestV4SchemaVersion,
    requestId: "dialogue-turn-request-1",
    sessionId: "session-xunpu-v4",
    bindingId: "binding-student-xunpu",
    episodeId: "dialogue-episode-gatekeeper-1",
    expectedEpisodeRevision: 0,
    expectedWorldStateVersion: 8,
    turnToken: `dialogueturn_${"x".repeat(48)}`,
    utterance: "我是学生记者，想说明采访目的并确认居民隐私边界。",
    submittedAt: "2026-09-01T00:01:00.000Z",
  });
}

export function dialogueEpisodeViewV4Fixture(
  audience: "student" | "teacher" | "admin" = "student",
): DialogueEpisodeViewV4 {
  const common = {
    schemaVersion: DialogueEpisodeViewV4SchemaVersion,
    episodeId: "dialogue-episode-gatekeeper-1",
    sessionId: "session-xunpu-v4",
    status: "active" as const,
    npc: {
      npcRef: "npc-gatekeeper-lin",
      displayName: "林师傅",
      roleRef: "role-community-gatekeeper",
    },
    topicRef: "topic-entry-and-interview-boundary",
    title: "先说明来意，再争取进入社区",
    objective: "在不越过居民隐私边界的前提下获得采访许可。",
    currentPrompt: "你代表谁来，又如何保护居民隐私？",
    allowedIntents: ["introduce_scope", "set_boundary", "repair_breach"],
    turnCount: 0,
    maximumTurns: 5,
    expiresAtVirtualMinute: 14,
    relationship: {
      trust: "guarded" as const,
      cooperation: "guarded" as const,
      alertness: "working" as const,
      recentChanges: [],
    },
    issues: [
      {
        issueRef: "issue-identity",
        publicLabel: "采访身份与目的",
        status: "open" as const,
        lastReason: null,
      },
      {
        issueRef: "issue-privacy",
        publicLabel: "居民隐私和拍摄边界",
        status: "open" as const,
        lastReason: null,
      },
    ],
    commitments: [],
    disclosedFacts: [],
    turns: [],
    exitOptions: ["礼貌结束对话并返回街口继续观察。"],
    resolution: null,
  };
  if (audience === "student") {
    return DialogueEpisodeViewV4Schema.parse({ ...common, audience });
  }
  const causalSummary = {
    sourceWorldStateVersion: 8,
    elapsedDialogueMinutes: 0,
    exactRelationship: { trust: 35, cooperation: 30, alertness: 65 },
    unresolvedIssueRefs: ["issue-identity", "issue-privacy"],
  };
  if (audience === "teacher") {
    return DialogueEpisodeViewV4Schema.parse({ ...common, audience, causalSummary });
  }
  return DialogueEpisodeViewV4Schema.parse({
    ...common,
    audience,
    causalSummary,
    runtime: {
      definitionRef: "dialogue-scene-gatekeeper-v4",
      definitionHash: hashA,
      learnerSubjectHash: hashB,
      privateBoundaryHash: hashB,
      receipts: [],
    },
  });
}
