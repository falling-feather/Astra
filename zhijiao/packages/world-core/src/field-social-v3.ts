import type { FieldContactMemoryV3, FieldInterviewRecordV1, FieldInterviewSpeechDecisionV1 } from "@ronggang/contracts";
import type { ExplorationLesson, ExplorationPerson } from "@ronggang/course-content";
import { hasCurrentNaturalLanguageRequestMatchV4 } from "./natural-language-scope-v4.js";

const unique = <T>(items: T[]) => [...new Set(items)];
export function fieldContact(person: ExplorationPerson, record: FieldInterviewRecordV1): FieldContactMemoryV3 {
  return record.contacts?.find(contact => contact.npcId === person.id) ?? {
    npcId: person.id, met: false, friend: false, trust: person.social?.initialTrust ?? 30,
    topics: [], referredNpcIds: [], memories: [], evidenceRefs: [], origins: [],
  };
}
function writableContact(person: ExplorationPerson, record: FieldInterviewRecordV1) {
  record.contacts ??= [];
  let contact = record.contacts.find(contact => contact.npcId === person.id);
  if (!contact) { contact = fieldContact(person, record); record.contacts.push(contact); }
  return contact;
}
export function canApproachFieldPerson(person: ExplorationPerson, record: FieldInterviewRecordV1) {
  return !person.requiresFlag || record.flags.includes(person.requiresFlag);
}
export function canMessageFieldPerson(person: ExplorationPerson, record: FieldInterviewRecordV1) {
  return person.social ? person.social.supportsContact && fieldContact(person, record).friend : canApproachFieldPerson(person, record);
}
export function fieldSocialRequest(text: string): FieldInterviewSpeechDecisionV1["socialAction"] | null {
  if (hasCurrentNaturalLanguageRequestMatchV4(text, /加.{0,5}(?:好友|微信)|(?:留|交换|给).{0,8}(?:联系方式|微信|联络方式)|以后.{0,8}(?:联系|发消息)|互加/u)) return "request_contact";
  if (hasCurrentNaturalLanguageRequestMatchV4(text, /引荐|帮.{0,5}联系|介绍.{0,8}(?:其他人|一位|个人|受访者|专家)|推荐.{0,8}(?:信源|受访者|专家)/u)) return "request_referral";
  if (hasCurrentNaturalLanguageRequestMatchV4(text, /我是.{0,30}(?:记者|学生|实习)|我.{0,12}(?:来做|来进行).{0,15}(?:采访|报道)|这次.{0,12}(?:采访|报道).{0,12}(?:想|希望|为了)/u)) return "introduce_self";
  return null;
}
function remember(contact: FieldContactMemoryV3, eventRef: string, minute: number, summary: string) {
  contact.evidenceRefs = unique([...contact.evidenceRefs, eventRef]).slice(-80);
  if (!contact.memories.some(memory => memory.eventRef === eventRef)) contact.memories = [...contact.memories, { eventRef, minute, summary: summary.slice(0, 600) }].slice(-32);
}

/** Simulation willingness is not a student grade; only distinct, substantive encounters change it. */
export function observeFieldConversation(person: ExplorationPerson, record: FieldInterviewRecordV1, input: {
  eventRef: string; minute: number; topicId: string | null; studentText: string; npcText: string; choiceConfirmed: boolean;
}) {
  if (!person.social) return;
  const contact = writableContact(person, record);
  if (input.topicId) {
    if (!contact.met) { contact.met = true; contact.trust = Math.min(100, contact.trust + 8); }
    if (!contact.topics.includes(input.topicId)) { contact.topics = [...contact.topics, input.topicId].slice(-80); contact.trust = Math.min(100, contact.trust + 6); }
  }
  if (input.topicId || input.choiceConfirmed) remember(contact, input.eventRef, input.minute,
    `学生：${input.studentText.slice(0, 180)}；${person.name}：${input.npcText.slice(0, 300)}`);
}

export function applyFieldSocialRequest(lesson: ExplorationLesson, person: ExplorationPerson, record: FieldInterviewRecordV1, input: {
  action: NonNullable<FieldInterviewSpeechDecisionV1["socialAction"]>; consent?: boolean; text: string; eventRef: string; minute: number;
}): { reply: string; applied: boolean } {
  if (!person.social) return { reply: "我们先把当前的采访问题说清楚。", applied: false };
  const contact = writableContact(person, record), policy = person.social;
  if (fieldSocialRequest(input.text) !== input.action) return { reply: "你是想了解我的工作，还是希望留下联络方式？可以再具体说一下。", applied: false };
  const toolsEnabled = person.workflow?.nodes.find(node => node.kind === "tools")?.enabled ?? true;
  let reply: string, applied = false;
  if (input.action === "introduce_self") {
    if (!contact.met) { contact.met = true; contact.trust = Math.min(100, contact.trust + 8); }
    reply = `${person.greeting} 我了解你的采访目的了，有具体问题我们接着聊。`; applied = true;
  } else if (input.action === "request_contact") {
    if (!contact.met) reply = "我们还没正式认识。先聊聊你来做什么、想了解哪些事情，再商量后续联系吧。";
    else if (!policy.supportsContact || !toolsEnabled) reply = policy.refusal;
    else if (contact.friend) reply = "我们已经互留过工作联系方式了，手机里可以找到我。不用重复添加。";
    else if (contact.trust < policy.contactThreshold || input.consent === false) reply = "这次先在现场聊吧。我还想了解你打算怎样使用采访内容，熟悉一些再谈后续联系。";
    else { contact.friend = true; reply = "可以，我们留一个工作联络方式。你离开现场后，也能在手机里接着联系我；我忙的时候可能晚一点回复。"; applied = true; }
  } else {
    const target = policy.referralTargets.map(id => lesson.people.find(candidate => candidate.id === id)).find(candidate => candidate && !contact.referredNpcIds.includes(candidate.id));
    if (!contact.met || contact.trust < policy.referralThreshold || input.consent === false || !toolsEnabled) reply = "我希望先把你的采访目标和已经做过的准备聊清楚，再向合适的人引荐。你也可以先从公开资料寻找线索。";
    else if (!target) reply = contact.referredNpcIds.length ? "之前介绍过的人和线索还可以继续跟进。有新的具体问题，我们再商量找谁。" : "这个问题我没有合适的人可以引荐；你可以换一条公开调查路径，不必一直等我。";
    else {
      contact.referredNpcIds.push(target.id);
      record.flags = unique([...record.flags, `known-node:${target.nodeId}`, `referred:${target.id}`]);
      const receiver = writableContact(target, record);
      remember(receiver, input.eventRef, input.minute, `${person.name}介绍这位学生前来了解${target.role}的工作；尚未当面认识，也未添加好友。`);
      reply = `我可以介绍${target.name}，${target.role}。我已说明你的采访来意，地图上标出了相关地点。到了以后还要由对方自己决定交流和记录的范围。`;
      applied = true;
    }
  }
  remember(contact, input.eventRef, input.minute, reply);
  return { reply, applied };
}

export function fieldMemoryContext(person: ExplorationPerson, record: FieldInterviewRecordV1, text: string) {
  const contact = fieldContact(person, record);
  const memoryEnabled = person.workflow?.nodes.find(node => node.kind === "memory")?.enabled ?? true;
  const common=new Set(['我们','你们','可以','这个','那个','一下','请问','想问','什么','怎么']);
  const terms=unique([
    ...person.topics.flatMap(topic=>topic.keywords).filter(term=>text.includes(term)),
    ...(text.match(/[a-zA-Z]{3,}/gu) ?? []),
    ...(text.match(/[\p{Script=Han}]{2,}/gu) ?? []).flatMap(part=>Array.from({length:part.length-1},(_,index)=>part.slice(index,index+2))).filter(term=>!common.has(term)),
  ]).slice(0,120);
  const recentTurns=new Set(record.turns.filter(turn=>turn.npcId===person.id).slice(-Math.max(1,Math.min(16,person.workflow?.memoryWindow??8))).map(turn=>turn.id));
  const memories = memoryEnabled ? contact.memories.filter(memory=>!recentTurns.has(memory.eventRef)).map((memory, index) => ({ memory, score: terms.reduce((total, term) => total + (memory.summary.includes(term) ? term.length : 0), 0) + index / Math.max(1, contact.memories.length) }))
    .sort((a, b) => b.score - a.score).slice(0, Math.min(8, person.workflow?.memoryWindow ?? 5)).map(item => `此前交流记忆（不能代替本场当前事实）：${item.memory.summary}`) : [];
  return { met: contact.met, friend: contact.friend, willingness: contact.trust, memories };
}
