import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  createHttpExperienceGateway,
  type FetchLike,
} from "../src/v2/gateway";
import {
  parseFlagshipDialogueResponseV4,
  parseFlagshipDialogueStartResponseV4,
} from "../src/v2/dialogue-v4";
import { StudentFlagshipDialogueV4Panel } from "../src/v2/pages/student-flagship-dialogue-v4";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function authFixture() {
  return {
    profileId: "student-unassigned",
    principal: {
      principalId: "principal-student",
      kind: "human",
      displayName: "学生记者",
      status: "active",
      createdAt: "2026-09-01T00:00:00.000Z",
    },
    bindings: [],
    csrfToken: "csrf-dialogue-test",
    expiresAt: "2099-09-01T00:00:00.000Z",
  } as const;
}

function dialogueEnvelope() {
  return {
    audience: "student",
    turnToken: `dialogueturn_${"t".repeat(48)}`,
    episode: {
      schemaVersion: "dialogue-episode-view/4.0.0",
      audience: "student",
      episodeId: "dialogue-episode-web",
      sessionId: "session-dialogue-web",
      status: "active",
      npc: {
        npcRef: "entity-gatekeeper",
        displayName: "林师傅",
        roleRef: "role-gatekeeper",
      },
      topicRef: "topic-community-access",
      title: "采访准入与公共边界",
      objective: "在不越过居民边界的前提下取得可核验采访入口。",
      currentPrompt: "请说明你接下来怎样取得本人同意。",
      allowedIntents: [
        "introduce_scope",
        "ask_open_question",
        "probe_detail",
        "set_boundary",
        "exit_conversation",
      ],
      turnCount: 1,
      maximumTurns: 5,
      expiresAtVirtualMinute: 20,
      relationship: {
        trust: "working",
        cooperation: "open",
        alertness: "guarded",
        recentChanges: ["学生明确了公共拍摄范围。"],
      },
      issues: [{
        issueRef: "issue-gatekeeper-privacy",
        publicLabel: "拍摄范围与撤回",
        status: "satisfied",
        lastReason: "拍摄范围和撤回机制明确。",
      }],
      commitments: [{
        commitmentId: "dialogue-commitment-web",
        madeBy: "student",
        summary: "接触每位居民前重新说明采访用途并取得本人同意。",
        condition: "不拍门牌、私人空间和未明确同意的人物。",
        dueAtVirtualMinute: 14,
        status: "active",
        sourceTurnRef: "dialogue-turn-web-1",
      }],
      disclosedFacts: [{
        factRef: "fact-gatekeeper-contact-window",
        publicText: "林师傅可以协助联系愿意受访的居民。",
        knowledgeRefs: ["xunpu-k016-interview-consent-and-custom"],
      }],
      turns: [{
        turnId: "dialogue-turn-web-1",
        sequence: 1,
        studentUtterance: "我是学生记者，只在公共巷道采访。",
        intent: "introduce_scope",
        npcAct: "acknowledge",
        npcStance: "cooperative",
        npcPublicText: "身份和范围说清楚了。",
        disclosedFactRefs: ["fact-gatekeeper-contact-window"],
        commitmentRef: "dialogue-commitment-web",
        outcome: "continue",
        decidedAt: "2026-09-01T08:01:00.000Z",
      }],
      exitOptions: ["结束对话并回到公共区域继续观察。"],
      resolution: null,
    },
  } as const;
}

const startRequest = {
  schemaVersion: "semantic-action-request/4.0.0",
  requestId: "dialogue-start-web",
  sessionId: "session-dialogue-web",
  bindingId: "binding-student",
  actionWindowRef: "action-window-web",
  actionWindowHash: "a".repeat(64),
  expectedWorldStateVersion: 3,
  utterance: "我想先说明身份，再向林师傅申请采访。",
  selections: [{
    selectionToken: `selection_token_${"s".repeat(40)}`,
    displayKind: "npc",
  }],
  submittedAt: "2026-09-01T08:00:00.000Z",
} as const;

const turnRequest = {
  schemaVersion: "dialogue-turn-request/4.0.0",
  requestId: "dialogue-turn-web-2",
  sessionId: "session-dialogue-web",
  bindingId: "binding-student",
  episodeId: "dialogue-episode-web",
  expectedEpisodeRevision: 1,
  expectedWorldStateVersion: 3,
  turnToken: `dialogueturn_${"t".repeat(48)}`,
  utterance: "我会再次说明用途，并由居民本人决定是否接受采访。",
  submittedAt: "2026-09-01T08:02:00.000Z",
} as const;

describe("V4 dialogue browser wire", () => {
  it("strictly parses a student dialogue envelope and rejects another audience", () => {
    const parsed = parseFlagshipDialogueResponseV4({ dialogue: dialogueEnvelope() });
    expect(parsed?.episode.currentPrompt).toContain("本人同意");
    const forged = structuredClone(dialogueEnvelope()) as Record<string, any>;
    forged.audience = "teacher";
    forged.turnToken = null;
    forged.episode.audience = "teacher";
    forged.episode.causalSummary = {
      sourceWorldStateVersion: 3,
      elapsedDialogueMinutes: 2,
      exactRelationship: { trust: 50, cooperation: 50, alertness: 40 },
      unresolvedIssueRefs: [],
    };
    expect(() => parseFlagshipDialogueResponseV4({ dialogue: forged }))
      .toThrow(/学生对话投影/u);
  });

  it("wires start, recover/read, and turn endpoints with CSRF and strict response parsing", async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    const responses = [
      {
        schemaVersion: "dialogue-start-response/4.0.0",
        status: "opened",
        safeMessage: "林师傅已回应。",
        dialogue: dialogueEnvelope(),
      },
      { dialogue: dialogueEnvelope() },
      { dialogue: dialogueEnvelope() },
    ];
    const fetchImpl: FetchLike = async (input, init) => {
      calls.push({
        url: String(input),
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      return jsonResponse(responses.shift());
    };
    const gateway = createHttpExperienceGateway(authFixture(), {
      apiBase: "http://api.local",
      fetchImpl,
    });
    const opened = await gateway.startFlagshipDialogueV4!(startRequest);
    expect(opened.status).toBe("opened");
    await gateway.getFlagshipDialogueV4!("session-dialogue-web", "binding-student");
    await gateway.submitFlagshipDialogueTurnV4!(turnRequest);
    expect(calls.map((call) => [call.method, call.url])).toEqual([
      ["POST", "http://api.local/api/v4/sessions/session-dialogue-web/dialogues"],
      ["GET", "http://api.local/api/v4/sessions/session-dialogue-web/dialogue?bindingId=binding-student"],
      ["POST", "http://api.local/api/v4/sessions/session-dialogue-web/dialogues/dialogue-episode-web/turns"],
    ]);
    expect(calls[0]?.body).toEqual(startRequest);
    expect(calls[2]?.body).toEqual(turnRequest);
  });

  it("parses a clarification start response without inventing a dialogue", () => {
    const parsed = parseFlagshipDialogueStartResponseV4({
      schemaVersion: "dialogue-start-response/4.0.0",
      status: "clarification_required",
      safeMessage: "请先选择一位人物。",
      dialogue: null,
    });
    expect(parsed).toMatchObject({ status: "clarification_required", dialogue: null });
  });

  it("renders the current prompt, transcript, commitments and a single dialogue action", () => {
    const dialogue = parseFlagshipDialogueResponseV4({ dialogue: dialogueEnvelope() });
    if (!dialogue) throw new Error("fixture dialogue missing");
    const markup = renderToStaticMarkup(createElement(StudentFlagshipDialogueV4Panel, {
      dialogue,
      busy: false,
      onSubmit: () => undefined,
      onExit: () => undefined,
    }));
    expect(markup).toContain('aria-label="与林师傅的人物对话"');
    expect(markup).toContain("请说明你接下来怎样取得本人同意");
    expect(markup).toContain("重新说明采访用途并取得本人同意");
    expect(markup).toContain("当前约定与已披露的讲述");
    expect(markup.match(/data-primary-action="true"/gu)).toHaveLength(1);
    expect(markup).not.toContain("turnToken");
  });
});
