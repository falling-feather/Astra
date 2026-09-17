import {
  FieldInterviewActionRequestV1Schema, FieldInterviewRecordV1Schema, FieldInterviewSpeechDecisionV1Schema,
  FieldInterviewViewV1Schema, type FieldInterviewActionRequestV1, type FieldInterviewRecordV1,
  type FieldInterviewSpeechDecisionV1, type FieldInterviewModelReceiptV1, type FieldInterviewViewV1, type FieldContactMemoryV3,
} from "@ronggang/contracts";
import { hashCanonical, type ExplorationLesson, type ExplorationPerson, type ExplorationChoice } from "@ronggang/course-content";
import { hasAffirmedNaturalLanguageMatchV4, hasCurrentNaturalLanguageRequestMatchV4 } from "./natural-language-scope-v4.js";
import { applyFieldSocialRequest, canApproachFieldPerson, canMessageFieldPerson, fieldContact, fieldSocialRequest, observeFieldConversation } from "./field-social-v3.js";
import { fieldTravelMinutes, knownFieldNodes } from "./field-map-v3.js";

export class FieldInterviewRuleError extends Error {
  constructor(message: string, readonly code: "unavailable" | "conflict" | "ownership" | "invalid" = "unavailable") {
    super(message); this.name = "FieldInterviewRuleError";
  }
}
const stableId = (prefix: string, value: unknown) => `${prefix}-${hashCanonical(value).slice(0, 28)}`;
const unique = <T>(items: T[]): T[] => [...new Set(items)];
const flag = (record: FieldInterviewRecordV1, name: string) => name.startsWith('acquired-material:')
  ? record.materialIds.includes(name.slice('acquired-material:'.length)) : record.flags.includes(name);
const allFlags = (record: FieldInterviewRecordV1, required: string[]) => required.every(name => flag(record, name));
const normalize = (text: string) => text.replace(/[\s，。！？、,.!?：:；;]/gu, "");
const literal = (value: string) => new RegExp(value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u");
const arrangementRequests: Partial<Record<ExplorationChoice["effect"], RegExp>> = {
  promise: /(?:发(?:送)?|寄)(?:给(?:我|我们)|到(?:我(?:的)?)?(?:邮箱|邮件)|资料|材料|原文|附件|邮件)/u,
  remind: /补(?:发|寄)|重发|再发一次|催(?:办|促|询|一下)|(?:还|尚)?(?:未|没(?:有)?)(?:收到|送达)/u,
};

export function createFieldInterview(lesson: ExplorationLesson, actorId: string, bindingId: string, sessionId: string, inherited: readonly FieldContactMemoryV3[] = []): FieldInterviewRecordV1 {
  const contacts = inherited.filter(contact => lesson.people.some(person => person.id === contact.npcId && person.social));
  return FieldInterviewRecordV1Schema.parse({
    schemaVersion: "field-interview-record/1.0.0",
    lessonRef: { lessonId: lesson.lessonId, version: lesson.version, contentHash: lesson.contentHash },
    sessionId, actorId, bindingId, nodeId: lesson.initialNodeId, visitedNodeIds: [lesson.initialNodeId],
    flags: [], materialIds: [], strategyId: null, topic: "", pendingOffers: [], appointments: [], promises: [], absences: [],
    messages: [], turns: [], events: [], ...(contacts.length ? { contacts: structuredClone(contacts) } : {}),
  });
}

function nodeAllowed(lesson: ExplorationLesson, record: FieldInterviewRecordV1, nodeId: string): boolean {
  const node = lesson.nodes.find(node => node.id === nodeId);
  return Boolean(node && (!node.requiresFlag || flag(record, node.requiresFlag)));
}
function canMessage(person: ExplorationPerson, record: FieldInterviewRecordV1): boolean {
  return canMessageFieldPerson(person, record);
}
function presence(person: ExplorationPerson, record: FieldInterviewRecordV1, minute: number): "present" | "away" | "not_arranged" {
  if (!canApproachFieldPerson(person, record)) return "not_arranged";
  if (person.onSiteUntilMinute != null && minute >= person.onSiteUntilMinute) return "away";
  const appointments = record.appointments.filter(item => item.npcId === person.id);
  if (!person.social && person.id === "entity-researcher" && !["ready", "met"].includes(appointments.at(-1)?.status ?? "")) return "not_arranged";
  if (record.absences.some(item => item.npcId === person.id && minute >= item.startMinute && minute < item.returnMinute)) return "away";
  return "present";
}

export function availableFieldChoices(lesson: ExplorationLesson, record: FieldInterviewRecordV1, npcId: string): ExplorationChoice[] {
  const person = lesson.people.find(person => person.id === npcId);
  if (!person || !canApproachFieldPerson(person, record)) return [];
  return lesson.choices.filter(choice => choice.npcId === npcId
    && (!person.social || canMessage(person, record) || !["promise", "remind"].includes(choice.effect))
    && allFlags(record, choice.requires) && choice.excludes.every(name => !flag(record, name))
    && !(choice.effect === "appointment" && record.appointments.some(item => item.npcId === npcId && ["confirmed", "ready"].includes(item.status)))
    && !(choice.effect === "promise" && record.promises.some(item => item.npcId === npcId)));
}

/** Speech proposes an arrangement. Only an explicit choice or an unambiguous reply to that offer enacts it. */
export function isFieldBoundaryRequest(utterance: string): boolean {
  return hasAffirmedNaturalLanguageMatchV4(utterance, /(?:偷偷|偷拍|闯进去|必须让我进去|冒充|给我家庭住址)/u);
}

export function resolveFieldSpeech(lesson: ExplorationLesson, record: FieldInterviewRecordV1, npcId: string, utterance: string): FieldInterviewSpeechDecisionV1 {
  const person = lesson.people.find(person => person.id === npcId);
  if (!person) throw new FieldInterviewRuleError("这位人物不在本节课的联系范围内。", "invalid");
  const text = normalize(utterance);
  const withoutName = text.replace(person.name, "");
  const social = person.social ? fieldSocialRequest(utterance) : null;
  if (social && social !== "introduce_self") return { kind: "social", socialAction: social, topicId: null, choiceId: null };
  if (/^(?:你好|您好|哈喽|嗨|早上好|下午好|晚上好|在吗|你好呀|您好啊)+$/u.test(withoutName)) return { kind: "greeting", topicId: null, choiceId: null };
  if (/^(?:不用了|不需要了|先不用|算了|不接受|不愿意|以后再说|先不安排)(?:谢谢|多谢|了)?$/u.test(withoutName)) return { kind: "decline", topicId: null, choiceId: null };
  if (/^(?:谢谢|谢谢你|谢谢您|多谢|辛苦了|明白了|了解了|好的|好|可以|行|同意|就这样|按这个安排)[呀啊吧了嘛呢]*$/u.test(withoutName)) return { kind: "acknowledge", topicId: null, choiceId: null };
  if (/(?:再见|先去看看|先走了|结束对话|我先离开|先不聊了)/u.test(text)) return { kind: "farewell", topicId: null, choiceId: null };
  if (isFieldBoundaryRequest(utterance)) return { kind: "refuse", topicId: null, choiceId: null };
  const availableChoices = availableFieldChoices(lesson, record, npcId);
  const choices = availableChoices
    .map(choice => {
      const requestPattern = arrangementRequests[choice.effect];
      const effectMatches = requestPattern && availableChoices.filter(item => item.effect === choice.effect).length === 1
        && hasCurrentNaturalLanguageRequestMatchV4(utterance, requestPattern);
      return { choice, score: (effectMatches ? 20 : 0) + choice.keywords.reduce((score, word) => score + (hasCurrentNaturalLanguageRequestMatchV4(utterance, literal(word)) ? word.length : 0), 0) };
    })
    .filter(item => item.score > 0).sort((a, b) => b.score - a.score);
  if (choices[0]) return { kind: "offer", topicId: null, choiceId: choices[0].choice.id };
  if (person.workflow?.nodes.find(node => node.kind === "knowledge")?.enabled === false) return social === "introduce_self"
    ? { kind: "social", socialAction: social, topicId: null, choiceId: null } : { kind: "clarify", topicId: null, choiceId: null };
  const common = new Set(["我想问", "请问一", "问一下", "有什么", "是什么", "为什么", "可以说", "能不能", "可不可", "想了解", "我想了", "你好我"]);
  const phrases = unique((utterance.match(/[\p{Script=Han}]{3,}/gu) ?? []).flatMap(part => Array.from({ length: part.length - 2 }, (_, index) => part.slice(index, index + 3))))
    .filter(phrase => !common.has(phrase) && hasAffirmedNaturalLanguageMatchV4(utterance, literal(phrase)));
  const topics = person.topics.map(topic => ({ topic, score:
    topic.keywords.reduce((score, word) => score + (hasAffirmedNaturalLanguageMatchV4(utterance, literal(word)) ? word.length : 0), 0)
    + phrases.filter(phrase => `${topic.title}${topic.response}`.includes(phrase)).length * 3 }))
    .filter(item => item.score > 0).sort((a, b) => b.score - a.score);
  if (topics[0]) return { kind: "question", topicId: topics[0].topic.id, choiceId: null };
  if (social === "introduce_self") return { kind: "social", socialAction: social, topicId: null, choiceId: null };
  return { kind: "clarify", topicId: null, choiceId: null };
}

function message(record: FieldInterviewRecordV1, input: Omit<FieldInterviewRecordV1["messages"][number], "read">) {
  if (!record.messages.some(item => item.id === input.id)) record.messages.push({ ...input, read: input.direction === "outgoing" });
}
function drainSchedule(record: FieldInterviewRecordV1, minute: number, remainingMinutes?: number, lesson?: ExplorationLesson) {
  const notify = (input: Omit<FieldInterviewRecordV1["messages"][number], "read">) => {
    const person = lesson?.people.find(person => person.id === input.npcId);
    if (person?.social && !canMessage(person, record)) return;
    message(record, input);
  };
  for (const appointment of record.appointments) {
    if (appointment.status === "confirmed" && minute >= appointment.atMinute) {
      appointment.status = "ready";
      notify({ id: stableId("appointment-ready", [appointment.npcId, appointment.atMinute]), npcId: appointment.npcId,
        channel: "chat", direction: "incoming", subject: null, text: "我已经到资料联络点了。你可以过来，把刚才准备的问题接着聊。", minute: appointment.atMinute, attachmentMaterialIds: [] });
    }
    if (appointment.status === "ready" && minute >= appointment.atMinute + 6) {
      appointment.status = "missed";
      notify({ id: stableId("appointment-missed", [appointment.npcId, appointment.atMinute]), npcId: appointment.npcId,
        channel: "chat", direction: "incoming", subject: null, text: "这次约好的时段没有等到你，我先去处理其他工作了。有需要可以再约，也可以先发一个具体问题。", minute: appointment.atMinute + 6, attachmentMaterialIds: [] });
    }
  }
  for (const absence of record.absences) {
    if (!absence.leftAnnounced && minute >= absence.startMinute) {
      absence.leftAnnounced = true;
      notify({ id: stableId("person-away", [absence.npcId, absence.startMinute]), npcId: absence.npcId, channel: "chat", direction: "incoming", subject: null,
        text: `我得先离开一下，大约第${absence.returnMinute}分钟回来。没聊完的话可以给我留言，我们回来继续。`, minute: absence.startMinute, attachmentMaterialIds: [] });
    }
    if (!absence.returnedAnnounced && minute >= absence.returnMinute) {
      absence.returnedAnnounced = true;
      notify({ id: stableId("person-return", [absence.npcId, absence.returnMinute]), npcId: absence.npcId, channel: "chat", direction: "incoming", subject: null,
        text: flag(record, "resident-followup") ? "我回到小院了，记着我们的约定。刚才没问完的问题接着说吧。" : "我回到小院了，没聊完的话现在可以继续。", minute: absence.returnMinute, attachmentMaterialIds: [] });
    }
  }
  for (const promise of record.promises) {
    const canDeliver = promise.status !== "delivered" && promise.deliveryMinute !== null && minute >= promise.deliveryMinute;
    if (!canDeliver && promise.status === "pending" && minute >= promise.dueMinute) {
      promise.status = "overdue";
      if (promise.materialIds.includes("material-expert-mail")) record.flags = unique([...record.flags, "expert-mail-overdue"]);
    }
    if (canDeliver) {
      const reminded = promise.status === "reminded";
      promise.status = "delivered";
      if (promise.materialIds.includes("material-expert-mail")) record.flags = unique([...record.flags, "expert-mail-delivered"]);
      notify({ id: stableId("expert-mail", [promise.npcId, promise.dueMinute]), npcId: promise.npcId, channel: promise.channel ?? "email", direction: "incoming",
        subject: (promise.channel ?? "email") === "email" ? "补发：采访资料与原文定位" : null,
        text: reminded ? "同学你好，抱歉刚才忘记发送。资料说明和原文链接在附件里，请核对内容、日期和使用范围，收到后也可以给我回一条消息。"
          : "刚才约好的核对回执已经准备好了，附在这条工作消息里。请把原公示与这次确认记录一起保留，区分原始线索和后来补到的依据。",
        minute: promise.deliveryMinute!, attachmentMaterialIds: promise.materialIds });
    }
  }
  if (!lesson?.socialLearning && remainingMinutes !== undefined && remainingMinutes <= 10) {
    message(record, { id: "field-interview-deadline-reminder", npcId: "entity-editor", channel: "chat", direction: "incoming", subject: null,
      text: `现场采访窗口还剩${remainingMinutes}分钟。优先整理已核实的材料；可以缩小选题或说明仍待核验的问题，不要为了填满作品补造内容。`, minute, attachmentMaterialIds: [] });
  }
  record.messages.sort((a, b) => a.minute - b.minute || a.id.localeCompare(b.id));
}

function applyChoice(lesson: ExplorationLesson, record: FieldInterviewRecordV1, selected: ExplorationChoice, atMinute: number): void {
  if (selected.exclusiveGroup) {
    const superseded = new Set(lesson.choices.filter(choice => choice.exclusiveGroup === selected.exclusiveGroup).flatMap(choice => choice.flags));
    record.flags = record.flags.filter(flag => !superseded.has(flag));
  }
  record.flags = unique([...record.flags, ...selected.flags]);
  record.pendingOffers = record.pendingOffers.filter(offer => offer.npcId !== selected.npcId);
  if (selected.id === "chen-cancel") {
    record.appointments.filter(item => item.npcId === selected.npcId && ["confirmed", "ready"].includes(item.status)).forEach(item => { item.status = "cancelled"; });
  }
  switch (selected.effect) {
    case "appointment":
      record.appointments.push({ npcId: selected.targetNpcId ?? selected.npcId, atMinute: atMinute + selected.delayMinutes, status: "confirmed" });
      break;
    case "promise":
      record.promises.push({ npcId: selected.npcId, materialIds: [...selected.materialIds], dueMinute: atMinute + selected.delayMinutes, deliveryMinute: null, status: "pending" });
      break;
    case "remind": {
      const promise = record.promises.find(item => item.npcId === selected.npcId && item.status === "overdue");
      if (!promise) throw new FieldInterviewRuleError("当前没有需要催办的逾期资料。");
      promise.status = "reminded"; promise.deliveryMinute = atMinute + selected.delayMinutes;
      break;
    }
    case "absence":
      record.absences.push({ npcId: selected.targetNpcId ?? selected.npcId, startMinute: atMinute + 1, returnMinute: atMinute + 1 + selected.delayMinutes, leftAnnounced: false, returnedAnnounced: false });
      break;
    case "flag": break;
  }
  if (selected.effect !== "promise") record.materialIds = unique([...record.materialIds, ...selected.materialIds.filter(id => {
    const material = lesson.materials.find(item => item.id === id);
    return material && allFlags(record, material.requires);
  })]);
}

export function applyFieldInterviewAction(input: {
  lesson: ExplorationLesson; record: FieldInterviewRecordV1; request: FieldInterviewActionRequestV1;
  actorId: string; worldStateVersion: number; virtualMinute: number; remainingMinutes: number; now: string;
  decision?: FieldInterviewSpeechDecisionV1; modelReceipt?: FieldInterviewModelReceiptV1;
}): { record: FieldInterviewRecordV1; event: FieldInterviewRecordV1["events"][number]; replayed: boolean } {
  const { lesson } = input;
  const request = FieldInterviewActionRequestV1Schema.parse(input.request);
  if (input.record.sessionId !== request.sessionId || input.record.actorId !== input.actorId || input.record.bindingId !== request.bindingId) throw new FieldInterviewRuleError("这场采访的记录归属其他学生，请进入本人的独立场次。", "ownership");
  if (input.record.lessonRef.contentHash !== lesson.contentHash || input.record.lessonRef.lessonId !== lesson.lessonId || input.record.lessonRef.version !== lesson.version) throw new FieldInterviewRuleError("本场课程的发布版本无法匹配，原记录已保留。", "conflict");
  const requestHash = hashCanonical({ actorId: input.actorId, request });
  const replay = input.record.events.find(event => event.requestId === request.requestId);
  if (replay) {
    if (replay.requestHash !== requestHash) throw new FieldInterviewRuleError("该请求编号已经用于另一项操作。", "conflict");
    return { record: input.record, event: replay, replayed: true };
  }
  if (request.expectedWorldStateVersion !== input.worldStateVersion) throw new FieldInterviewRuleError("现场已经变化，请同步后继续；你的输入没有丢失。", "conflict");
  const record = structuredClone(input.record);
  drainSchedule(record, input.virtualMinute, input.remainingMinutes, lesson);
  const action = request.action;
  let minutes = 0, summary = "", evidenceRefs: string[] = [];
  const eventId = stableId("field-event", [request.sessionId, request.requestId]);
  const ensurePerson = (npcId: string) => {
    const person = lesson.people.find(person => person.id === npcId);
    if (!person) throw new FieldInterviewRuleError("这位人物不在本课的联系范围内。", "invalid");
    if (!canApproachFieldPerson(person, record)) throw new FieldInterviewRuleError("还没有安排与这位人物见面，请先完成相应的引荐或约见。");
    return person;
  };
  const recordTurn = (npcId: string, channel: "scene" | "chat" | "email", studentText: string, npcText: string, decision: FieldInterviewSpeechDecisionV1, materialIds: string[], choiceConfirmed = false) => {
    const id = stableId("field-turn", [request.sessionId, request.requestId]);
    const modelReceipt = input.modelReceipt ?? { mode: "deterministic" as const, traceRef: null, inputHash: hashCanonical({ npcId, studentText, previousTurnIds: record.turns.map(turn => turn.id), lesson: lesson.contentHash }), outputHash: hashCanonical(decision), costMicros: 0, failureCode: null };
    record.turns.push({ id, npcId, channel, studentText, npcText, topicId: decision.topicId, choiceId: decision.choiceId, choiceConfirmed, materialIds, minute: input.virtualMinute + minutes, modelReceipt });
    const participant = lesson.people.find(person => person.id === npcId);
    if (participant) observeFieldConversation(participant, record, { eventRef: eventId, minute: input.virtualMinute + minutes,
      topicId: decision.topicId, studentText, npcText, choiceConfirmed });
    if (channel !== "scene") {
      const subject = channel === "email" ? "回复：采访资料" : null;
      message(record, { id: `${id}-out`, npcId, channel, direction: "outgoing", subject, text: studentText, minute: input.virtualMinute, attachmentMaterialIds: [] });
      message(record, { id: `${id}-in`, npcId, channel, direction: "incoming", subject, text: npcText, minute: input.virtualMinute + minutes, attachmentMaterialIds: materialIds });
    }
    evidenceRefs.push(id, ...materialIds);
  };
  switch (action.kind) {
    case "travel": {
      const node = lesson.nodes.find(node => node.id === action.nodeId);
      if (!node) throw new FieldInterviewRuleError("这条路不在本次采访的可探索范围内。", "invalid");
      if (!nodeAllowed(lesson, record, node.id)) throw new FieldInterviewRuleError(node.id === "loc-community-courtyard" ? "小院仍是生活空间。先与林师傅协商进入范围，或去公共街区和公示栏调查。" : "工坊正在安排教学，可以先用手机联系黄老师约观摩时间。");
      const travelTime = fieldTravelMinutes(lesson, record, node.id);
      if (travelTime === null) throw new FieldInterviewRuleError("这条路径还没有被发现或暂时不能通行，请沿附近的道路继续探索。");
      minutes = travelTime;
      record.nodeId = node.id; record.visitedNodeIds = unique([...record.visitedNodeIds, node.id]);
      summary = `前往${node.title}，继续调查。`;
      break;
    }
    case "inspect": {
      const material = lesson.materials.find(item => item.id === action.materialId);
      if (!material) throw new FieldInterviewRuleError("这份材料不在本课中。", "invalid");
      const attached = record.messages.some(message => message.attachmentMaterialIds.includes(material.id));
      const atSource = material.nodeId === record.nodeId && nodeAllowed(lesson, record, record.nodeId);
      if (!allFlags(record, material.requires) || (!atSource && !record.materialIds.includes(material.id) && !attached)) throw new FieldInterviewRuleError("这份资料尚未到达或尚未取得，请先到对应位置调查、询问人物或查看已收到的附件。");
      minutes = record.materialIds.includes(material.id) ? 0 : 1;
      record.materialIds = unique([...record.materialIds, material.id]);
      summary = `查看并记录《${material.title}》，保留来源与材料性质。`; evidenceRefs = [material.id];
      break;
    }
    case "choose": {
      const person = ensurePerson(action.npcId);
      const channel = action.channel ?? "chat";
      if (channel !== "scene" && !canMessage(person, record)) throw new FieldInterviewRuleError("尚未建立远程联络，请先在现场认识对方并征得添加好友的同意。");
      if (channel === "scene" && (record.nodeId !== person.nodeId || !nodeAllowed(lesson, record, person.nodeId) || presence(person, record, input.virtualMinute) !== "present")) throw new FieldInterviewRuleError("对方不在当前现场，可以改用工作消息协商。");
      const selected = availableFieldChoices(lesson, record, person.id).find(choice => choice.id === action.choiceId);
      if (!selected) throw new FieldInterviewRuleError("当前人物没有这个可确认的安排，或前面的条件还没有满足。");
      minutes = selected.minutes; applyChoice(lesson, record, selected, input.virtualMinute + minutes);
      recordTurn(person.id, channel, action.rationale ? `${selected.label}\n我的理由：${action.rationale}` : selected.label, selected.response, { kind: "offer", topicId: null, choiceId: selected.id }, selected.effect === "promise" ? [] : selected.materialIds, true);
      summary = `${person.name}：${selected.response}`;
      break;
    }
    case "talk": {
      const bystander = lesson.bystanders.find(person => person.id === action.npcId);
      if (bystander) {
        if (action.channel !== "scene" || bystander.nodeId !== record.nodeId) throw new FieldInterviewRuleError("这位路人只在当前现场短暂经过，不能远程联系。");
        recordTurn(bystander.id, "scene", action.text, bystander.response, { kind: "clarify", topicId: null, choiceId: null }, []);
        summary = `${bystander.name}：${bystander.response}`;
        break;
      }
      const person = ensurePerson(action.npcId);
      const status = presence(person, record, input.virtualMinute);
      if (action.channel !== "scene" && !canMessage(person, record)) throw new FieldInterviewRuleError("尚未建立远程联络，请先在现场认识对方并征得添加好友的同意。");
      if (action.channel === "scene" && (record.nodeId !== person.nodeId || !nodeAllowed(lesson, record, person.nodeId))) throw new FieldInterviewRuleError("你不在这位人物所在的现场，可以先过去，或通过手机联系。");
      if (action.channel === "scene" && status !== "present") throw new FieldInterviewRuleError(status === "away" ? "对方暂时离开了，可以通过手机留言，回来以后继续。" : "对方还不在现场，可以通过手机约时间或提出简短问题。");
      const decision = input.decision ? FieldInterviewSpeechDecisionV1Schema.parse(input.decision) : resolveFieldSpeech(lesson, record, person.id, action.text);
      const topic = person.topics.find(topic => topic.id === decision.topicId);
      if (decision.kind === "question" && person.workflow?.nodes.find(node => node.kind === "knowledge")?.enabled === false) throw new FieldInterviewRuleError("本角色当前未启用知识查询，不能输出未提供依据的专业结论。", "invalid");
      const selected = availableFieldChoices(lesson, record, person.id).find(choice => choice.id === decision.choiceId);
      if (decision.kind === "social" && (!person.social || !decision.socialAction)) throw new FieldInterviewRuleError("人物没有给出有效的联络决定。", "invalid");
      if ((decision.kind === "question" && !topic) || (decision.kind === "offer" && !selected)
        || (decision.kind !== "question" && decision.topicId !== null) || (decision.kind !== "offer" && decision.choiceId !== null)) throw new FieldInterviewRuleError("人物回应引用了当前不可用的话题或安排。", "invalid");
      if (decision.citedTopicIds?.some(id => !person.topics.some(topic => topic.id === id))
        || (decision.reply && decision.kind === "question" && !decision.citedTopicIds?.includes(decision.topicId!))) throw new FieldInterviewRuleError("人物回答缺少本人的已发布知识依据。", "invalid");
      let reply = person.clarification, materialIds: string[] = [], choiceConfirmed = false;
      if (["question", "clarify", "refuse", "decline"].includes(decision.kind)) record.pendingOffers = record.pendingOffers.filter(offer => offer.npcId !== person.id);
      if (decision.kind === "social" && decision.socialAction) {
        const social = applyFieldSocialRequest(lesson, person, record, { action: decision.socialAction,
          ...(decision.socialConsent !== undefined ? { consent: decision.socialConsent } : {}), text: action.text, eventRef: eventId, minute: input.virtualMinute + 1 });
        reply = social.reply; minutes = 1;
      }
      else if (decision.kind === "greeting") reply = person.greeting;
      else if (decision.kind === "decline") reply = "好的，这次先不安排。你可以继续自己的调查，需要时再联系我。";
      else if (decision.kind === "farewell") { reply = "好，你先去调查。我们刚才聊的内容保留着，有具体问题可以再联系。"; record.pendingOffers = record.pendingOffers.filter(offer => offer.npcId !== person.id); }
      else if (decision.kind === "refuse") reply = "这个做法不合适，我不能配合。你可以换一种尊重当事人安排的采访方式，或者先去公共区域调查。";
      else if (decision.kind === "question" && topic) {
        if (status === "away" && !person.remoteContact) reply = "我现在不在现场。问题我看到了，你可以先记着，约好回来后再继续聊。";
        else {
          const citedTopics = person.topics.filter(item => item.id === topic.id || decision.citedTopicIds?.includes(item.id));
          minutes = 2; materialIds = unique(citedTopics.flatMap(item => item.materialIds)).filter(id => allFlags(record, lesson.materials.find(material => material.id === id)!.requires));
          const repeated = record.turns.some(turn => turn.npcId === person.id && turn.topicId === topic.id);
          reply = decision.reply ?? `${repeated ? "接着刚才的话说。" : ""}${topic.response}`;
          if (!lesson.socialLearning && person.id === "entity-public-liaison" && topic.id === "cai-notice") {
            let pending = record.promises.find(promise => promise.npcId === person.id && promise.materialIds.includes("material-service-update"));
            if (!pending) {
              pending = { npcId: person.id, materialIds: ["material-service-update"], dueMinute: input.virtualMinute + minutes + 4,
                deliveryMinute: input.virtualMinute + minutes + 4, status: "pending", channel: "chat" };
              record.promises.push(pending);
            }
            if (pending.status !== "delivered") {
              materialIds = materialIds.filter(id => id !== "material-service-update");
              reply += "我再核对一下，稍后通过工作消息给你补一份回执，你可以先继续调查。";
            }
          }
          record.materialIds = unique([...record.materialIds, ...materialIds]);
          const appointment = record.appointments.find(item => item.npcId === person.id && item.status === "ready");
          if (appointment && action.channel === "scene") { appointment.status = "met"; record.flags = unique([...record.flags, "expert-met"]); }
        }
      } else if (decision.kind === "offer" && selected) {
        record.pendingOffers = [...record.pendingOffers.filter(offer => offer.npcId !== person.id), { npcId: person.id, choiceId: selected.id }];
        reply = `可以商量。${selected.label}，要按这个安排吗？你也可以先继续问。`;
      } else if (decision.kind === "acknowledge") {
        const pending = record.pendingOffers.find(offer => offer.npcId === person.id);
        const agreed = /^(?:好|好的|可以|行|同意|就这样|按这个安排)[呀啊吧了]*$/u.test(normalize(action.text));
        const confirmed = pending && agreed ? availableFieldChoices(lesson, record, person.id).find(choice => choice.id === pending.choiceId) : undefined;
        if (confirmed) {
          minutes = confirmed.minutes; applyChoice(lesson, record, confirmed, input.virtualMinute + minutes);
          reply = confirmed.response; materialIds = confirmed.effect === "promise" ? [] : confirmed.materialIds;
          decision.choiceId = confirmed.id;
          choiceConfirmed = true;
        } else reply = "不客气。你可以接着问，也可以先去看看别的线索。";
      }
      if (decision.kind === "clarify" && decision.reply) reply = decision.reply;
      recordTurn(person.id, action.channel, action.text, reply, decision, materialIds, choiceConfirmed);
      summary = `${person.name}：${reply}`;
      break;
    }
    case "wait": minutes = action.minutes; summary = `等待${minutes}分钟，同时留意工作消息。`; break;
    case "read_message": {
      const selected = record.messages.find(message => message.id === action.messageId);
      if (!selected) throw new FieldInterviewRuleError("这条消息尚未到达。", "invalid");
      selected.read = true; summary = selected.subject ? `阅读邮件《${selected.subject}》。` : "阅读收到的工作消息。"; evidenceRefs = [selected.id];
      break;
    }
    case "read_thread": {
      const person = ensurePerson(action.npcId);
      if (!canMessage(person, record)) throw new FieldInterviewRuleError("还未建立与这位人物的工作联络。");
      record.messages.filter(message => message.npcId === person.id && message.channel === "chat").forEach(message => { message.read = true; });
      summary = `查看与${person.name}的工作消息。`;
      break;
    }
    case "topic": {
      const strategy = lesson.strategies.find(strategy => strategy.id === action.strategyId);
      if (!strategy) throw new FieldInterviewRuleError("当前没有这个报道方向。", "invalid");
      if (record.topic && (record.topic !== action.text || record.strategyId !== strategy.id)) record.flags = unique([...record.flags, "topic-revised"]);
      record.topic = action.text; record.strategyId = strategy.id; summary = `把报道问题确定为：${action.text}`;
      break;
    }
  }
  if (minutes > input.remainingMinutes) throw new FieldInterviewRuleError(`当前只剩${input.remainingMinutes}分钟，这项安排需要${minutes}分钟。可以缩小问题或返回工作台整理已有材料。`);
  const afterMinute = input.virtualMinute + minutes;
  drainSchedule(record, afterMinute, input.remainingMinutes - minutes, lesson);
  const event = { id: eventId, requestId: request.requestId, requestHash, actorId: input.actorId, bindingId: request.bindingId,
    sourceWorldStateVersion: input.worldStateVersion, resultingWorldStateVersion: input.worldStateVersion + 1,
    beforeMinute: input.virtualMinute, afterMinute, action, summary, evidenceRefs: unique(evidenceRefs), committedAt: input.now };
  record.events.push(event);
  return { record: FieldInterviewRecordV1Schema.parse(record), event, replayed: false };
}

export function projectFieldInterview(input: { lesson: ExplorationLesson; record: FieldInterviewRecordV1; worldStateVersion: number; virtualMinute: number; remainingMinutes: number }): FieldInterviewViewV1 {
  const { lesson, virtualMinute } = input;
  const record = structuredClone(input.record);
  drainSchedule(record, virtualMinute, input.remainingMinutes, lesson);
  const knownNodes = knownFieldNodes(lesson, record);
  const nearbyNodes = new Set(lesson.nodes.find(node => node.id === record.nodeId)?.exits?.map(exit => exit.targetId) ?? []);
  const materialTitles = new Map(lesson.materials.map(material => [material.id, material.title]));
  const meaningfulPeople = new Set([
    ...record.turns.filter(turn => turn.topicId !== null && turn.materialIds.length > 0).map(turn => turn.npcId),
    ...record.messages.filter(message => message.direction === "incoming" && message.attachmentMaterialIds.some(id => record.materialIds.includes(id))).map(message => message.npcId),
  ]);
  const accessibleMaterials = lesson.materials.filter(material => record.materialIds.includes(material.id)
    || (material.nodeId && nodeAllowed(lesson, record, material.nodeId) && (!lesson.socialLearning || knownNodes.has(material.nodeId)))
    || record.messages.some(message => message.attachmentMaterialIds.includes(material.id)));
  return FieldInterviewViewV1Schema.parse({
    schemaVersion: "field-interview-view/1.0.0", sessionId: record.sessionId, bindingId: record.bindingId, lessonId: lesson.lessonId, lessonVersion: lesson.version, title: lesson.title, assignment: lesson.assignment,
    worldStateVersion: input.worldStateVersion, virtualMinute, remainingMinutes: input.remainingMinutes, nodeId: record.nodeId,
    nodes: lesson.nodes.map(node => ({ id: node.id, title: knownNodes.has(node.id) ? node.title : "未探索区域", description: knownNodes.has(node.id) ? node.description : "尚未探索", allowed: nodeAllowed(lesson, record, node.id),
      ...(lesson.socialLearning ? { discovered: knownNodes.has(node.id), nearby: nearbyNodes.has(node.id), image: knownNodes.has(node.id) && nodeAllowed(lesson, record, node.id) ? node.image ?? null : null,
        ...(knownNodes.has(node.id) && nodeAllowed(lesson, record, node.id) && node.imageAtlas ? { imageAtlas: node.imageAtlas } : {}),
        ...(node.map ? { map: node.map } : {}), exits: knownNodes.has(node.id) ? node.exits ?? [] : [] } : {}),
      reason: nodeAllowed(lesson, record, node.id) ? null : node.lockedHint ?? (lesson.socialLearning ? "这里暂未开放，请先了解进入条件，或沿其他公共路径探索。" : node.id === "loc-community-courtyard" ? "先与林师傅协商进入范围；公共路线可以自由调查。" : "先通过手机联系黄老师安排工坊观摩。"), travelMinutes: node.travelMinutes, visited: record.visitedNodeIds.includes(node.id) })),
    people: [...lesson.people.filter(person => !lesson.socialLearning || person.nodeId === record.nodeId || fieldContact(person, record).met || fieldContact(person, record).friend).map(person => {
      const status = presence(person, record, virtualMinute);
      return { id: person.id, name: person.name, role: person.role, nodeId: person.nodeId, activity: person.activity, interactionKind: "agent", presence: status, canMessage: canMessage(person, record),
        ...(person.appearance ? { appearance: person.appearance } : {}),
        ...(person.social ? { relationship: { met: fieldContact(person, record).met, friend: fieldContact(person, record).friend,
          description: fieldContact(person, record).friend ? "已互留工作联络方式" : fieldContact(person, record).met ? "已经认识，尚未建立远程联络" : "还未正式认识" } } : {}),
        statusText: status === "away" ? person.onSiteUntilMinute != null && virtualMinute >= person.onSiteUntilMinute ? "现场咨询时段已结束，可通过工作消息联系" : "暂时离场，可留言续访" : status === "not_arranged" ? canMessage(person, record) ? "尚未到场，可以先发消息约时间" : "尚未引荐，请先征求见面意愿" : person.activity,
        topics: canApproachFieldPerson(person, record) ? person.topics.map(topic => ({ id: topic.id, title: topic.title })) : [],
        choices: availableFieldChoices(lesson, record, person.id).map(choice => ({ id: choice.id, label: choice.label, minutes: choice.minutes })) };
    }), ...lesson.bystanders.filter(person => !lesson.socialLearning || person.nodeId === record.nodeId).map(person => ({ id: person.id, name: person.name, role: "路过的人", nodeId: person.nodeId, activity: person.activity,
      interactionKind: "scripted", presence: "present", canMessage: false, statusText: person.activity, topics: [], choices: [] }))],
    materials: accessibleMaterials.map(material => {
      const discovered = record.materialIds.includes(material.id);
      return { id: material.id, title: material.title, nodeId: material.nodeId, discovered, kind: material.kind, description: material.description,
        ...(material.evidenceStatus ? { evidenceStatus: material.evidenceStatus } : {}),
        body: discovered ? material.body : null, sourceUrl: discovered ? material.sourceUrl : null, locator: material.locator, knowledgeRefs: discovered ? material.knowledgeRefs : [] };
    }),
    messages: record.messages, turns: record.turns.map(({ modelReceipt: _receipt, ...turn }) => turn), appointments: record.appointments, promises: record.promises,
    topic: record.topic, strategyId: record.strategyId,
    strategies: lesson.strategies.map(strategy => {
      const missing = [...strategy.materialIds.filter(id => !record.materialIds.includes(id)).map(id => `尚缺：${materialTitles.get(id)}`),
        ...strategy.evidenceNpcIds.filter(id => !meaningfulPeople.has(id)).map(id => `尚未深入询问：${lesson.people.find(person => person.id === id)!.name}`),
        ...(strategy.flag && !flag(record, strategy.flag) ? ["还没有形成这条策略所需的实际取舍或经历"] : [])];
      return { id: strategy.id, title: strategy.title, question: strategy.question, evidenceReady: missing.length === 0, missing };
    }),
    progress: { interviewedPeople: meaningfulPeople.size, discoveredMaterials: record.materialIds.length, decisions: record.turns.filter(turn => turn.choiceConfirmed).length + record.events.filter(event => event.action.kind === "topic").length },
    executionMode: record.turns.length === 0 ? "not_run" : record.turns.every(turn => turn.modelReceipt.mode === "live_model") ? "live" : record.turns.some(turn => turn.modelReceipt.mode === "live_model") ? "mixed" : "rules",
    recentEvents: record.events.slice(-12).map(event => ({ id: event.id, summary: event.summary, minute: event.afterMinute, evidenceRefs: event.evidenceRefs })),
    ...(lesson.region ? { region: lesson.region } : {}), ...(lesson.socialLearning ? { socialLearning: true } : {}),
  });
}
