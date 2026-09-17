import { describe, expect, it } from "vitest";
import type { FieldInterviewActionV1, FieldInterviewActionRequestV1 } from "@ronggang/contracts";
import { xunpuExplorationLesson } from "@ronggang/course-content";
import { applyFieldInterviewAction, createFieldInterview, projectFieldInterview, resolveFieldSpeech } from "../src/field-interview-v1.js";
import { WorldSimulationEngineV3 } from "../src/simulation-v3.js";
import { InMemorySimulationSessionStore } from "../src/simulation-v3-store.js";
import { challengeAssignmentFixture, livingWorldReleaseFixture } from "./simulation-v3.fixture.js";

function play() {
  let record = createFieldInterview(xunpuExplorationLesson, "student-a", "binding-a", "session-a");
  let minute = 0, version = 0, sequence = 0;
  const act = (action: FieldInterviewActionV1) => {
    const result = applyFieldInterviewAction({ lesson: xunpuExplorationLesson, record,
      request: { schemaVersion: "field-interview-action/1.0.0", requestId: `request-${++sequence}`, sessionId: "session-a", bindingId: "binding-a", expectedWorldStateVersion: version, action },
      actorId: "student-a", worldStateVersion: version, virtualMinute: minute, remainingMinutes: 55 - minute, now: "2026-09-11T00:00:00.000Z" });
    record = result.record; minute = result.event.afterMinute; version = result.event.resultingWorldStateVersion;
    return result;
  };
  return { act, get state() { return record; }, get view() { return projectFieldInterview({ lesson: xunpuExplorationLesson, record, worldStateVersion: version, virtualMinute: minute, remainingMinutes: 55 - minute }); } };
}
const talk = (npcId: string, text: string, channel: "scene" | "chat" = "chat"): FieldInterviewActionV1 => ({ kind: "talk", npcId, text, channel });
const choose = (npcId: string, choiceId: string): FieldInterviewActionV1 => ({ kind: "choose", npcId, choiceId, rationale: "我选择这个安排，并保留未核实的问题。" });

describe("an interview with open exploration and persistent commitments", () => {
  it("issues a resident-specific scope receipt only after that person's agreement", () => {
    const p = play();
    expect(() => p.act({ kind: "inspect", materialId: "material-resident-consent" })).toThrow();
    p.act(choose("entity-gatekeeper", "lin-introduction"));
    p.act({ kind: "travel", nodeId: "loc-community-courtyard" });
    p.act(choose("entity-community-source", "ahuan-scope"));
    expect(p.state.materialIds).toContain("material-resident-consent");
    expect(p.state.materialIds).not.toContain("material-license-note");
    const receipt = p.view.materials.find(item => item.id === "material-resident-consent")!;
    expect(receipt.body).toContain("阿环");
    expect(receipt.body).toContain("不包括");
    expect(receipt.evidenceStatus).toBe("scenario_record");
  });
  it("understands a natural mail request and overdue reminder without treating a proposal as completed delivery", () => {
    const p = play();
    p.act(talk("entity-researcher", "请您把原文资料稍后通过邮件发给我，我先继续调查。"));
    expect(p.state.pendingOffers).toContainEqual({ npcId: "entity-researcher", choiceId: "chen-mail" });
    expect(p.state.promises).toEqual([]);
    p.act(talk("entity-researcher", "好的"));
    p.act({ kind: "wait", minutes: 6 });
    expect(p.state.promises[0]!.status).toBe("overdue");
    p.act(talk("entity-researcher", "约定的资料还没收到，请补发邮件。"));
    expect(p.state.pendingOffers).toContainEqual({ npcId: "entity-researcher", choiceId: "chen-remind" });
    expect(p.state.messages.some(item => item.channel === "email")).toBe(false);
    p.act(talk("entity-researcher", "按这个安排"));
    p.act({ kind: "wait", minutes: 2 });
    expect(p.state.messages.filter(item => item.channel === "email" && item.direction === "incoming")).toHaveLength(1);
  });

  it("distinguishes discussing a refused intrusion from a new active plan to intrude", () => {
    const record = play().state;
    const decide = (text: string) => resolveFieldSpeech(xunpuExplorationLesson, record, "entity-gatekeeper", text);
    expect(decide("有人说要偷拍居民，我想问怎样拒绝这种做法。").kind).not.toBe("refuse");
    expect(decide("我拒绝冒充游客，我会先说明学生记者身份并申请采访。").kind).not.toBe("refuse");
    expect(decide("我不会偷拍，但我要冒充游客进去。").kind).toBe("refuse");
  });

  it("keeps future, negated and quoted arrangements distinct from a current request", () => {
    const record = play().state;
    const decide = (text: string) => resolveFieldSpeech(xunpuExplorationLesson, record, "entity-researcher", text);
    for (const text of ["以后有机会我可能请您把资料发给我。", "请您不要给我发邮件。", "材料中写着‘请发送资料’，这是案例里的话。"])
      expect(decide(text).kind, text).not.toBe("offer");
    expect(decide("以后我再考虑见面，现在请把原文资料发到邮箱。")).toMatchObject({ kind: "offer", choiceId: "chen-mail" });
  });
  it("lets a passer-by be busy without fabricating an agent interview or evidence", () => {
    const p = play();
    p.act(talk("entity-passing-worker", "您好，方便聊一下吗？", "scene"));
    expect(p.state.turns.at(-1)?.npcText).toContain("手上腾不开");
    expect(p.view.progress.interviewedPeople).toBe(0);
    expect(p.state.turns.at(-1)?.modelReceipt.costMicros).toBe(0);
  });
  it("accepts a greeting and uncertainty without granting access or consuming interview time", () => {
    const p = play();
    p.act(talk("entity-gatekeeper", "林师傅你好", "scene"));
    expect(p.state.turns.at(-1)?.npcText).toContain("你好");
    expect(p.view.virtualMinute).toBe(0);
    expect(p.state.flags).not.toContain("courtyard-access");
    p.act(talk("entity-gatekeeper", "我是学校来的，选题还没想好"));
    expect(p.state.turns.at(-1)?.npcText).not.toMatch(/无法稳定确定|岗位意图/);
  });

  it("lets a student investigate the notice and shop without meeting the gatekeeper", () => {
    const p = play();
    p.act({ kind: "inspect", materialId: "material-notice-board" });
    p.act({ kind: "travel", nodeId: "loc-merchant-storefront" });
    p.act(talk("entity-shopkeeper", "平时顾客最想了解什么服务？", "scene"));
    p.act(talk("entity-tourist", "这次出行有什么体验？", "scene"));
    expect(p.state.materialIds).toEqual(expect.arrayContaining(["material-notice-board", "material-shop-service", "material-tourist-account"]));
    expect(p.view.progress.interviewedPeople).toBe(2);
    expect(p.state.flags).not.toContain("resident-introduced");
    expect(() => p.act({ kind: "travel", nodeId: "loc-community-courtyard" })).toThrow(/小院|协商|林师傅/);
  });

  it("separates a proposed arrangement, a future intention and actual confirmation", () => {
    const p = play();
    p.act(talk("entity-gatekeeper", "以后有机会我可能请您引荐"));
    expect(p.state.flags).not.toContain("resident-introduced");
    p.act(talk("entity-gatekeeper", "请你引荐一位居民"));
    expect(p.state.pendingOffers).toContainEqual({ npcId: "entity-gatekeeper", choiceId: "lin-introduction" });
    p.act(talk("entity-gatekeeper", "谢谢"));
    expect(p.state.flags).not.toContain("resident-introduced");
    p.act(talk("entity-gatekeeper", "好"));
    expect(p.state.flags).toContain("resident-introduced");
  });
  it("does not turn an acknowledgement of a different topic into consent to an old offer", () => {
    const p = play();
    p.act(talk("entity-gatekeeper", "请帮我引荐居民"));
    p.act(talk("entity-gatekeeper", "我先问一下公示栏在哪里？"));
    p.act(talk("entity-gatekeeper", "好"));
    expect(p.state.flags).not.toContain("resident-introduced");
    p.act(talk("entity-gatekeeper", "请帮我引荐居民"));
    p.act(talk("entity-gatekeeper", "先不用，谢谢"));
    expect(p.state.pendingOffers).toEqual([]);
    expect(p.state.turns.at(-1)?.npcText).toContain("先不安排");
  });
  it("does not answer a topic the student explicitly declined when the actual question uses material vocabulary", () => {
    const p = play();
    p.act(talk("entity-shopkeeper", "吴姐你好，我先不谈样片合作。今天预约表上有几组客人？预约和实际成交有什么区别？"));
    expect(p.state.turns.at(-1)?.topicId).toBe("wu-business");
    expect(p.state.turns.at(-1)?.npcText).toContain("预约表");
  });

  it("keeps a promised file absent when overdue, then delivers only after a reminder and time", () => {
    const p = play();
    p.act(choose("entity-researcher", "chen-mail"));
    expect(p.state.materialIds).not.toContain("material-expert-mail");
    p.act({ kind: "wait", minutes: 6 });
    expect(p.view.promises[0]?.status).toBe("overdue");
    expect(p.view.messages.some(message => message.channel === "email")).toBe(false);
    expect(() => p.act({ kind: "inspect", materialId: "material-expert-mail" })).toThrow(/尚未|未到|未取得/);
    p.act(choose("entity-researcher", "chen-remind"));
    p.act({ kind: "wait", minutes: 2 });
    const email = p.view.messages.find(message => message.channel === "email")!;
    expect(email.attachmentMaterialIds).toEqual(["material-expert-mail"]);
    p.act({ kind: "read_message", messageId: email.id });
    p.act({ kind: "inspect", materialId: "material-expert-mail" });
    expect(p.state.materialIds).toContain("material-expert-mail");
  });
  it("also supports an on-time follow-up, keeping the earlier notice distinct from the later receipt", () => {
    const p = play();
    p.act({ kind: "inspect", materialId: "material-notice-board" });
    p.act(talk("entity-public-liaison", "想核对这份公示的版本和日期"));
    expect(p.state.materialIds).not.toContain("material-service-update");
    p.act({ kind: "wait", minutes: 4 });
    const message = p.view.messages.find(message => message.attachmentMaterialIds.includes("material-service-update"))!;
    expect(message.channel).toBe("chat");
    expect(p.view.promises[0]?.status).toBe("delivered");
    p.act({ kind: "inspect", materialId: "material-service-update" });
    expect(p.state.materialIds).toEqual(expect.arrayContaining(["material-notice-board", "material-service-update"]));
  });
  it("switches the public liaison to work messages after the documented on-site window", () => {
    const p = play();
    p.act({ kind: "travel", nodeId: "loc-waterfront-service-point" });
    p.act({ kind: "wait", minutes: 10 });
    p.act({ kind: "wait", minutes: 9 });
    expect(p.view.people.find(person => person.id === "entity-public-liaison")?.presence).toBe("away");
    expect(() => p.act(talk("entity-public-liaison", "现在还能当面咨询吗？", "scene"))).toThrow(/不在|离开/);
    p.act(talk("entity-public-liaison", "我通过消息问一下公共交通和服务安排。"));
    expect(p.state.turns.at(-1)?.materialIds).toContain("material-public-service");
  });

  it("retains an interview across a departure, a follow-up arrangement and return", () => {
    const p = play();
    p.act(choose("entity-gatekeeper", "lin-introduction"));
    p.act({ kind: "travel", nodeId: "loc-community-courtyard" });
    p.act(talk("entity-community-source", "你的日常生活是什么样？", "scene"));
    p.act(choose("entity-community-source", "ahuan-story"));
    p.act({ kind: "wait", minutes: 1 });
    expect(p.view.people.find(person => person.id === "entity-community-source")?.presence).toBe("away");
    expect(() => p.act(talk("entity-community-source", "继续问个问题", "scene"))).toThrow(/离开|不在/);
    p.act(choose("entity-community-source", "ahuan-followup"));
    p.act({ kind: "wait", minutes: 6 });
    expect(p.view.people.find(person => person.id === "entity-community-source")?.presence).toBe("present");
    p.act(talk("entity-community-source", "我想核对刚才那句原话的意思", "scene"));
    expect(p.state.turns.some(turn => turn.topicId === "ahuan-daily")).toBe(true);
    expect(p.state.turns.at(-1)?.topicId).toBe("ahuan-quote");
  });

  it("does not reveal another learner's transcript or permit a decision for another character", () => {
    const p = play();
    expect(() => p.act(choose("entity-tourist", "lin-introduction"))).toThrow(/人物/);
    expect(() => applyFieldInterviewAction({ lesson: xunpuExplorationLesson, record: p.state,
      request: { schemaVersion: "field-interview-action/1.0.0", requestId: "other", sessionId: "session-a", bindingId: "binding-b", expectedWorldStateVersion: 0, action: talk("entity-gatekeeper", "你好") },
      actorId: "student-b", worldStateVersion: 0, virtualMinute: 0, remainingMinutes: 55, now: "2026-09-11T00:00:00.000Z" })).toThrow(/本人|归属/);
  });
  it("keeps revised decisions in history while applying only the current material policy", () => {
    const p = play();
    p.act(choose("entity-shopkeeper", "wu-limited"));
    p.act(choose("entity-shopkeeper", "wu-interview-only"));
    expect(p.state.flags).toContain("commercial-interview-only");
    expect(p.state.flags).not.toContain("commercial-limited-use");
    expect(p.state.turns.filter(turn => turn.choiceConfirmed)).toHaveLength(2);
  });
  it("allows a missed meeting to be rearranged rather than permanently locking the expert", () => {
    const p = play();
    p.act(choose("entity-researcher", "chen-appointment"));
    p.act({ kind: "wait", minutes: 10 });
    p.act({ kind: "wait", minutes: 1 });
    expect(p.view.appointments[0]?.status).toBe("missed");
    expect(p.view.people.find(person => person.id === "entity-researcher")?.choices.some(choice => choice.id === "chen-appointment")).toBe(true);
    p.act(choose("entity-researcher", "chen-appointment"));
    expect(p.view.appointments.at(-1)?.status).toBe("confirmed");
  });
});

const travel = (nodeId: string): FieldInterviewActionV1 => ({ kind: "travel", nodeId });
const inspect = (materialId: string): FieldInterviewActionV1 => ({ kind: "inspect", materialId });
const wait = (minutes: number): FieldInterviewActionV1 => ({ kind: "wait", minutes });
const strategies: Array<[string, FieldInterviewActionV1[]]> = [
  ["community-life", [choose("entity-gatekeeper", "lin-introduction"), travel("loc-community-courtyard"), talk("entity-community-source", "你平时的日常生活是什么样？", "scene"), travel("loc-waterfront-service-point"), inspect("material-local-standard")]],
  ["craft-process", [choose("entity-inheritor", "huang-invitation"), travel("loc-zanhuawei-workshop"), talk("entity-inheritor", "这个技艺的工序怎么安排？", "scene"), talk("entity-inheritor", "平时怎样带学员练习？", "scene")]],
  ["culture-explainer", [travel("loc-waterfront-service-point"), inspect("material-local-standard"), inspect("material-conflicting-claim"), talk("entity-researcher", "原始来源和转引该怎么比较？")]],
  ["visitor-service", [travel("loc-merchant-storefront"), talk("entity-tourist", "这次出行的体验如何？", "scene"), travel("loc-waterfront-service-point"), talk("entity-public-liaison", "公交出行有什么需要核实的？", "scene")]],
  ["shared-street", [talk("entity-gatekeeper", "你在这里平时忙些什么？", "scene"), travel("loc-merchant-storefront"), talk("entity-tourist", "这次出行的体验如何？", "scene"), travel("loc-waterfront-service-point"), inspect("material-public-service")]],
  ["business-voice", [travel("loc-merchant-storefront"), talk("entity-shopkeeper", "平时给顾客提供哪些服务？", "scene"), choose("entity-shopkeeper", "wu-interview-only"), talk("entity-tourist", "这次出行有什么体验？", "scene")]],
  ["transparent-cooperation", [travel("loc-merchant-storefront"), talk("entity-shopkeeper", "样片合作具体是怎么回事？", "scene"), choose("entity-shopkeeper", "wu-limited"), talk("entity-rights-contact", "怎样核对作者和授权范围？")]],
  ["alternative-framing", [travel("loc-merchant-storefront"), talk("entity-tourist", "这次出行有什么体验？", "scene"), choose("entity-tourist", "zhou-no-closeup"), talk("entity-rights-contact", "有什么替代的镜头方案？")]],
  ["parallel-research", [choose("entity-researcher", "chen-appointment"), travel("loc-waterfront-service-point"), inspect("material-local-standard"), inspect("material-source-method"), wait(2), talk("entity-researcher", "原文中哪一部分支持这个判断？", "scene")]],
  ["missed-mail", [choose("entity-researcher", "chen-mail"), wait(6), travel("loc-waterfront-service-point"), inspect("material-local-standard"), inspect("material-source-method"), talk("entity-researcher", "我想自己核对原文中的来源。")]],
  ["topic-pivot", [{ kind: "topic", strategyId: "community-life", text: "我最初想写一个居民生活故事。" }, inspect("material-notice-board"), talk("entity-editor", "我的选题还需要调整方向。"), { kind: "topic", strategyId: "topic-pivot", text: "我准备改问公共指引与游客理解之间的差异。" }, talk("entity-public-liaison", "这份公告的日期和范围该怎样核对？"), wait(4), inspect("material-service-update")]],
  ["context-recovery", [choose("entity-gatekeeper", "lin-introduction"), travel("loc-community-courtyard"), talk("entity-community-source", "我想核对准备引用的原话和语境。", "scene"), talk("entity-platform-duty", "怎样处理这个语境反馈案例？")]],
];

describe("different reporters can develop different usable investigations", () => {
  it.each(strategies)("%s reaches its evidence conditions within the same lesson window", (id, actions) => {
    const p = play();
    for (const action of actions) p.act(action);
    p.act({ kind: "topic", strategyId: id, text: `我选择${id}方向，根据刚才取得的材料继续完成自己的报道。` });
    const strategy = p.view.strategies.find(strategy => strategy.id === id)!;
    expect(strategy.missing, id).toEqual([]);
    expect(strategy.evidenceReady).toBe(true);
    expect(p.view.remainingMinutes).toBeGreaterThan(0);
  });
});

describe("field interviews inside the authoritative world record", () => {
  it("uses one clock and atomic version, survives a new engine, and replays without another turn", async () => {
    const store = new InMemorySimulationSessionStore();
    const options = { store, fieldLessons: [xunpuExplorationLesson] };
    let engine = new WorldSimulationEngineV3(options);
    await engine.startSession({ sessionId: "field-persist", release: livingWorldReleaseFixture(), challengeAssignment: challengeAssignmentFixture("field-persist"), targetCompetencyRefs: ["competency-source-verification"], scaffoldingLevel: 1 });
    const request: FieldInterviewActionRequestV1 = { schemaVersion: "field-interview-action/1.0.0", requestId: "mail-persist", sessionId: "field-persist", bindingId: "binding-a", expectedWorldStateVersion: 0, action: choose("entity-researcher", "chen-mail") };
    const command = { request, actorId: "student-a", lessonHash: xunpuExplorationLesson.contentHash };
    await engine.commitFieldInterview(command);
    engine = new WorldSimulationEngineV3(options);
    expect((await engine.commitFieldInterview(command)).replayed).toBe(true);
    const world = await engine.getRecord(request.sessionId);
    expect(world.currentSnapshot.stateVersion).toBe(1);
    expect(world.currentSnapshot.virtualTime.elapsedMinutes).toBe(1);
    expect(world.fieldInterview?.turns).toHaveLength(1);
    expect(world.resolutions).toHaveLength(0); // Programmed arrangements do not invent AgentRuns.
    await expect(engine.commitFieldInterview({ ...command, request: { ...request, action: { kind: "wait", minutes: 2 } } })).rejects.toThrow(/请求编号/);
  });

  it("serializes competing inputs and preserves the first writer's ownership", async () => {
    const engine = new WorldSimulationEngineV3({ store: new InMemorySimulationSessionStore(), fieldLessons: [xunpuExplorationLesson] });
    await engine.startSession({ sessionId: "field-concurrent", release: livingWorldReleaseFixture(), challengeAssignment: challengeAssignmentFixture("field-concurrent"), targetCompetencyRefs: ["competency-source-verification"], scaffoldingLevel: 1 });
    const first: FieldInterviewActionRequestV1 = { schemaVersion: "field-interview-action/1.0.0", requestId: "concurrent-a", sessionId: "field-concurrent", bindingId: "binding-a", expectedWorldStateVersion: 0, action: { kind: "inspect", materialId: "material-notice-board" } };
    const results = await Promise.allSettled([engine.commitFieldInterview({ request: first, actorId: "student-a", lessonHash: xunpuExplorationLesson.contentHash }), engine.commitFieldInterview({ request: { ...first, requestId: "concurrent-b" }, actorId: "student-a", lessonHash: xunpuExplorationLesson.contentHash })]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect((await engine.getRecord(first.sessionId)).currentSnapshot.stateVersion).toBe(1);
    await expect(engine.getFieldInterview({ sessionId: first.sessionId, actorId: "student-b", bindingId: "binding-b", lessonHash: xunpuExplorationLesson.contentHash })).rejects.toThrow(/本人|其他学生/);
  });
});
