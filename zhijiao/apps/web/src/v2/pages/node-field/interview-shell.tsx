import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft, ArrowRight, BookOpen, Check, Clock3, ExternalLink, FileText, Mail, Map as MapIcon, MessageCircle,
  Monitor, MoreHorizontal, Send, Settings2, Smartphone, X, LockKeyhole,
} from "lucide-react";
import type { FieldExplorationViewV4, FieldInterviewActionV1, FieldInterviewViewV1 } from "@ronggang/contracts";
import type { FlagshipWorkspaceView, FlagshipWorldView } from "../../world-v3";
import type { FlagshipWorldPulseV4 } from "../../flagship-v4";
import { NodeFieldStage } from "./stage";
import { NodeFieldDialog } from "./shell";
import { StudentNotebookDrawer } from "./notebook";
import { ExperienceSettings } from "../../experience-settings";
import { sceneActors, type FieldVisualNode } from "./visuals";
import { ExplorationMap } from "./exploration-map";
import "./interview-style.css";

type Person = FieldInterviewViewV1["people"][number];
type Panel = "phone" | "notebook" | "map" | "brief" | "settings" | "guidance" | "materials" | null;
type Conversation = { npcId: string; channel: "scene" | "chat" | "email" } | null;
export interface NodeInterviewShellProps {
  view: FieldInterviewViewV1; field: FieldExplorationViewV4; world: FlagshipWorldView; workspace: FlagshipWorkspaceView;
  busy: boolean; message: string | null; guidance: ReactNode; guidanceRequired: boolean;
  worldPulse: FlagshipWorldPulseV4;
  onAction(action: FieldInterviewActionV1): Promise<boolean>;
  onRefresh(): Promise<void>; onWork(kind: "story" | "media"): void; onExit(): void;
}

export function NodeInterviewShell(props: NodeInterviewShellProps) {
  const { view } = props;
  const [panel, setPanel] = useState<Panel>(null);
  const [notebookOpen, setNotebookOpen] = useState(false);
  const [conversation, setConversation] = useState<Conversation>(null);
  const [phoneTab, setPhoneTab] = useState<"messages" | "mail" | "appointments">("messages");
  const [materialId, setMaterialId] = useState<string | null>(null);
  const [messageId, setMessageId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [topicDraft, setTopicDraft] = useState(view.topic);
  const [strategyId, setStrategyId] = useState(view.strategyId ?? view.strategies[0]?.id ?? "");
  const [notice, setNotice] = useState<string | null>(null);
  const [dismissedError, setDismissedError] = useState(false);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const previousIncoming = useRef(new Set(view.messages.map(message => message.id)));
  const metadata = useMemo(() => new Map(props.field.nodes.flatMap(node => node.people).map(person => [person.entityId, person])), [props.field.nodes]);
  const nodes = useMemo(() => view.nodes.filter(node => node.discovered !== false).map(node => {
    const source = props.field.nodes.find(candidate => candidate.sceneRef === node.id);
    const result: FieldVisualNode = { sceneRef: node.id, title: node.title, environmentImage: node.image ?? source?.environmentImage ?? "",
      ...(node.imageAtlas ? { imageAtlas: node.imageAtlas } : {}),
      people: view.people.filter(person => person.nodeId === node.id).map(person => {
        const original = metadata.get(person.id);
        return { entityId: person.id, displayName: person.name, professionalRole: person.role,
          ...(original?.portrait ? { portrait: original.portrait } : {}), ...(person.appearance ? { appearance: person.appearance } : {}),
          status: person.presence === "away" ? "left" : "available",
          presence: { visible: person.presence === "present", canContact: person.canMessage } };
      }) };
    return result;
  }), [props.field.nodes, view.nodes, view.people, metadata]);
  const node = nodes.find(node => node.sceneRef === view.nodeId) ?? nodes[0]!;
  const person = conversation ? view.people.find(person => person.id === conversation.npcId) ?? null : null;
  const turnHistory = person ? view.turns.filter(turn => turn.npcId === person.id) : [];
  const scheduledMessages = person ? view.messages.filter(message => message.npcId === person.id && !message.id.startsWith("field-turn-") && message.channel === "chat") : [];
  const timeline = [...turnHistory.map(turn => ({ kind: "turn" as const, minute: turn.minute, turn })),
    ...scheduledMessages.map(message => ({ kind: "message" as const, minute: message.minute, message }))].sort((a, b) => a.minute - b.minute || a.kind.localeCompare(b.kind));
  const material = view.materials.find(material => material.id === materialId) ?? null;
  const selectedMail = view.messages.find(message => message.id === messageId) ?? null;
  const localMaterials = view.materials.filter(material => material.nodeId === view.nodeId);
  const draftKey = conversation ? `${conversation.npcId}:${conversation.channel}` : "";
  const draft = drafts[draftKey] ?? "";
  const physical = new Set(sceneActors(node).filter(actor => actor.visible).map(actor => actor.entityId));
  const localPeople = view.people.filter(person => person.nodeId === view.nodeId && person.presence === "present" && !physical.has(person.id));
  const currentNode = view.nodes.find(candidate => candidate.id === view.nodeId)!;
  const destinations = (currentNode.exits ?? []).flatMap(exit => {
    const target = view.nodes.find(candidate => candidate.id === exit.targetId);
    return target && target.discovered !== false ? [{ sceneRef: target.id, title: target.title, locked: !target.allowed, x: exit.x, y: exit.y }] : [];
  });
  const contacts = view.people.filter(person => person.interactionKind === "agent" && (!view.socialLearning || person.relationship?.friend));
  const unread = view.messages.filter(message => !message.read && message.direction === "incoming").length;
  const proactivePerson = props.worldPulse.status === "npc_action_pending" ? contacts.find(person => person.name === props.worldPulse.speaker) : null;
  const clockAt = (minute: number) => new Date(Date.parse(props.world.virtualTime.startedAt) + minute * 60_000).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });

  useEffect(() => {
    const incoming = view.messages.findLast(message => message.direction === "incoming" && !previousIncoming.current.has(message.id) && !message.id.startsWith("field-turn-"));
    previousIncoming.current = new Set(view.messages.map(message => message.id));
    if (incoming) setNotice(`${view.people.find(person => person.id === incoming.npcId)?.name ?? "联系人"}${incoming.channel === "email" ? "发来一封邮件" : "发来工作消息"}`);
  }, [view.messages, view.people]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(null), 5000); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => setDismissedError(false), [props.message]);
  useEffect(() => { if (transcriptRef.current) transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight; }, [turnHistory.length, conversation?.npcId, scheduledMessages.length]);
  useEffect(() => { if (conversation) inputRef.current?.focus(); }, [conversation?.npcId, conversation?.channel]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.isComposing || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
      if (event.key === "Escape") { setPanel(null); setConversation(null); setMaterialId(null); }
      if (event.key.toLowerCase() === "p") { setPanel("phone"); setConversation(null); }
      if (event.key.toLowerCase() === "n") setNotebookOpen(true);
    };
    document.addEventListener("keydown", key); return () => document.removeEventListener("keydown", key);
  }, []);
  const openPerson = (id: string, channel: "scene" | "chat" | "email" = "scene") => {
    const next = view.people.find(person => person.id === id);
    if (!next) return;
    if (!next.canMessage && (channel !== "scene" || next.presence !== "present")) { setNotice(next.statusText); return; }
    if (channel === "scene" && next.presence !== "present") channel = "chat";
    setConversation({ npcId: id, channel }); setMaterialId(null); setMessageId(null);
    setPanel(channel === "scene" ? null : "phone");
    if (channel === "chat" && !props.busy && view.messages.some(message => message.npcId === id && message.channel === "chat" && !message.read)) void props.onAction({ kind: "read_thread", npcId: id });
  };
  const go = async (id: string) => {
    const target = view.nodes.find(node => node.id === id);
    if (!target || props.busy) return;
    if (!target.allowed) { setNotice(target.reason); return; }
    if (await props.onAction({ kind: "travel", nodeId: id })) { setPanel(null); setConversation(null); setMaterialId(null); }
  };
  const inspect = async (id: string) => {
    const current = view.materials.find(material => material.id === id);
    if (!current) return;
    if (current.discovered || await props.onAction({ kind: "inspect", materialId: id })) setMaterialId(id);
  };
  const send = async () => {
    if (!conversation || !draft.trim() || props.busy) return;
    const key = draftKey;
    if (await props.onAction({ kind: "talk", npcId: conversation.npcId, channel: conversation.channel, text: draft.trim() })) setDrafts(current => ({ ...current, [key]: "" }));
  };
  const openTool = (next: Panel) => { if (next === "notebook") { setNotebookOpen(true); return; } setPanel(next); setConversation(null); setMaterialId(null); setMessageId(null); };
  const picture = (id: string) => view.people.find(person => person.id === id)?.appearance?.portrait ?? metadata.get(id)?.portrait;
  const personAvatar = (person: Person) => picture(person.id) ? <img src={picture(person.id)} alt="" /> : <MessageCircle />;
  const conversationBody = person && conversation ? <>
    <div className="interview-person-heading">{personAvatar(person)}<div><h2>{person.name}<small>{person.role}</small></h2><p>{person.statusText}</p></div></div>
    <div className="interview-transcript" ref={transcriptRef} aria-label={`与${person.name}的交流记录`}>
      {!turnHistory.length ? <p className="interview-empty">{person.activity}。可以先打个招呼，也可以直接说说你的问题。</p> : null}
      {timeline.map(entry => {
        if (entry.kind === "message") return <p className="interview-system-message" key={entry.message.id}><Clock3 />{clockAt(entry.minute)} · {entry.message.text}</p>;
        const turn = entry.turn;
        return <div className="interview-turn" key={turn.id}>
        <p className="student-line"><span>你 · {clockAt(turn.minute)}</span>{turn.studentText}</p>
        <p className="person-line"><span>{person.name}</span>{turn.npcText}</p>
        {turn.materialIds.length ? <div className="interview-inline-materials">{turn.materialIds.map(id => <button type="button" key={id} onClick={() => void inspect(id)}><FileText />{view.materials.find(material => material.id === id)?.title ?? "相关资料"}<ArrowRight /></button>)}</div> : null}
      </div>;
      })}
      {props.busy ? <p className="interview-typing" role="status"><span/><span/><span/>正在等待回应</p> : null}
    </div>
    {person.topics.length ? <details className="interview-topics"><summary>想从哪里问起？<MoreHorizontal /></summary><div>{person.topics.map(topic => <button type="button" key={topic.id} onClick={() => setDrafts(current => ({ ...current, [draftKey]: `我想了解${topic.title}，能讲讲吗？` }))}>{topic.title}</button>)}</div></details> : null}
    {person.choices.length ? <details className="interview-arrangements"><summary>可以协商的安排 <span>{person.choices.length}</span></summary><div>{person.choices.map(choice => <button type="button" key={choice.id} disabled={props.busy} onClick={() => void props.onAction({ kind: "choose", npcId: person.id, choiceId: choice.id, rationale: "", channel: conversation.channel })}><span>{choice.label}</span><small>{choice.minutes}分钟</small><ArrowRight /></button>)}</div></details> : null}
    <form className="interview-compose" onSubmit={event => { event.preventDefault(); void send(); }}>
      <textarea ref={inputRef} rows={2} value={draft} onChange={event => setDrafts(current => ({ ...current, [draftKey]: event.target.value }))}
        onKeyDown={event => { if (!event.nativeEvent.isComposing && event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }}
        aria-label={`对${person.name}说`} placeholder="用自己的话说，简短问候也可以…" maxLength={2000} disabled={props.busy}/>
      <button type="submit" aria-label="发送这句话" disabled={props.busy || !draft.trim()}><Send /></button>
    </form>
    <div className="interview-conversation-footer"><small>Enter 发送 · Shift+Enter 换行</small><button type="button" onClick={() => { setConversation(null); if (conversation.channel === "scene") setPanel(null); }}>先去调查别的线索 <ArrowRight /></button></div>
    {props.message ? <p className="interview-inline-error" role="alert">{props.message}</p> : null}
  </> : null;

  return <main className="node-field interview-field" data-lesson={view.lessonId}>
    <NodeFieldStage node={node} focusedPerson={conversation?.channel === "scene" ? conversation.npcId : null}
      blocked={props.busy || panel !== null || conversation !== null || materialId !== null}
      objects={localMaterials.map(material => ({ objectId: material.id, label: material.title, hint: material.discovered ? "已取得资料，可以再次查看" : material.description }))}
      destinations={destinations}
      onNavigate={id => void go(id)} onPerson={id => openPerson(id)} onObject={id => void inspect(id)}/>
    <header className="interview-hud"><div><div className="interview-brand"><span aria-hidden="true">◇</span>职教星云</div><p>{view.region?.title ?? "蟳埔"} · {node.title}</p><button type="button" className="interview-objective" onClick={() => openTool("brief")}><span/> {view.topic || view.title}</button></div>
      <div className="interview-clock"><div><time>{clockAt(view.virtualMinute)}</time><button type="button" onClick={() => openTool("settings")} aria-label="现场设置"><Settings2 /></button></div><small>剩余 {view.remainingMinutes} 分钟 · 教学仿真</small></div>
    </header>
    <aside className="interview-tools" aria-label="采访工具">
      <button type="button" onClick={() => openTool("phone")}><Smartphone /><span>手机</span>{unread ? <b>{unread > 9 ? "9+" : unread}</b> : null}</button>
      <button type="button" onClick={() => props.onWork("story")}><Monitor /><span>工作台</span><small>{props.workspace.completion.submittedRequiredCount}/{props.workspace.completion.requiredArtifactCount}</small></button>
    </aside>
    {!conversation && !panel && !material ? <>
      {localMaterials.length ? <aside className="interview-nearby" aria-label="附近可查看的线索"><small>附近可查看</small>{localMaterials.slice(0, 2).map(material => <button type="button" key={material.id} aria-label={`附近线索：${material.title}`} disabled={props.busy} onClick={() => void inspect(material.id)}><FileText /><span>{material.title}</span>{material.discovered ? <Check /> : <ArrowRight />}</button>)}{localMaterials.length > 2 ? <button type="button" onClick={() => openTool("materials")}><MoreHorizontal /><span>展开资料栏 · {localMaterials.length}份</span></button> : null}</aside> : null}
      {localPeople.length ? <div className="interview-local-people">{localPeople.map(person => <button type="button" key={person.id} onClick={() => openPerson(person.id)}>{personAvatar(person)}<span>{person.name}<small>{person.role}</small></span><MessageCircle /></button>)}</div> : null}
      <ExplorationMap view={view} compact onExpand={() => openTool("map")} onNavigate={id => void go(id)} />
      <p className="interview-controls">拖动环视 · 点击人物和物件 · 滚轮放大</p>
      {proactivePerson && !props.guidanceRequired ? <button type="button" className="interview-proactive-hint" onClick={() => openPerson(proactivePerson.id, "chat")}><MessageCircle /><span>{proactivePerson.name}想与你交流</span><ArrowRight /></button> : null}
    </> : null}
    {props.guidanceRequired && !panel && !conversation ? <button type="button" className="interview-pending-decision" onClick={() => openTool("guidance")}><MessageCircle />有一项岗位决定待处理</button> : null}
    {(notice || (props.message && !conversation && !dismissedError)) ? <div className="interview-toast" role="status"><MessageCircle /><span>{notice ?? props.message}</span><button type="button" aria-label="收起提示" onClick={() => { setNotice(null); setDismissedError(true); }}><X /></button></div> : null}
    {conversation?.channel === "scene" && person ? <section className="interview-conversation" role="dialog" aria-label={`与${person.name}交谈`}>
      <button type="button" className="interview-close" aria-label="收起交谈" onClick={() => setConversation(null)}><X /></button>{conversationBody}
    </section> : null}
    {material ? <NodeFieldDialog title={material.title} onClose={() => setMaterialId(null)}>
      <div className="interview-material"><span className="interview-source-badge">{material.evidenceStatus ? ({ public_source: "公开来源 · 教学摘编", scenario_record: "场景记录 · 仿真", unverified_claim: "待核线索 · 请核验", reference_guide: "方法提示 · 不作事实证据", case_example: "案例示例 · 不代表你的实际经历" } as const)[material.evidenceStatus] : material.kind === "public_source" ? "公开来源 · 教学摘编" : "教学仿真材料"}</span><p>{material.body ?? material.description}</p><small>{material.locator}</small>
        {material.sourceUrl ? <a href={material.sourceUrl} target="_blank" rel="noreferrer">查看原始来源 <ExternalLink /></a> : null}<div><Check />已取得这份资料，可用于整理作品</div></div>
    </NodeFieldDialog> : null}
    {panel === "phone" && !material ? <NodeFieldDialog title={person && conversation?.channel !== "scene" ? person.name : "工作手机"} phone onClose={() => { setPanel(null); setConversation(null); setMessageId(null); }}>
      {conversation && conversation.channel !== "scene" ? <><button type="button" className="interview-back" onClick={() => setConversation(null)}><ArrowLeft />联系人</button>{conversationBody}</> : <>
        <nav className="interview-phone-tabs">{([['messages', '消息'], ['mail', '邮箱'], ['appointments', '约定']] as const).map(([id, label]) => <button type="button" key={id} className={phoneTab === id ? "active" : ""} onClick={() => { setPhoneTab(id); setMessageId(null); }}>{label}</button>)}</nav>
        {phoneTab === "messages" && proactivePerson ? <article className="interview-proactive-message"><small>现场联络提醒 · {proactivePerson.name}</small><p>{props.worldPulse.message}</p><button type="button" onClick={() => props.guidanceRequired ? setPanel("guidance") : openPerson(proactivePerson.id, "chat")}>查看并回应 <ArrowRight /></button></article> : null}
        {phoneTab === "messages" ? <div className="interview-contact-list">{!contacts.length ? <p className="interview-empty">还没有工作联系人。先在现场认识对方，再征求添加好友的意愿；有些人会选择只在现场交流。</p> : null}{contacts.map(person => {
          const latest = view.turns.findLast(turn => turn.npcId === person.id)?.npcText;
          const incoming = view.messages.filter(message => message.npcId === person.id && !message.read && message.direction === "incoming").length;
          return <button type="button" key={person.id} onClick={() => openPerson(person.id, "chat")} disabled={!person.canMessage}>{personAvatar(person)}<span><strong>{person.name}<small>{person.presence === "away" ? "暂离" : person.presence === "not_arranged" ? "待约见" : "可联系"}</small></strong><p>{latest ?? person.statusText}</p></span>{incoming ? <b>{incoming}</b> : null}</button>;
        })}</div> : null}
        {phoneTab === "mail" ? selectedMail ? <article className="interview-mail"><button type="button" className="interview-back" onClick={() => setMessageId(null)}><ArrowLeft />邮箱</button><small>{selectedMail.direction === "outgoing" ? "我 → " : ""}{view.people.find(person => person.id === selectedMail.npcId)?.name} · {clockAt(selectedMail.minute)}</small><h3>{selectedMail.subject}</h3><p>{selectedMail.text}</p>
          {selectedMail.attachmentMaterialIds.map(id => <button type="button" className="interview-attachment" key={id} onClick={() => void inspect(id)}><FileText />{view.materials.find(material => material.id === id)?.title ?? "资料附件"}<ArrowRight /></button>)}<button type="button" className="node-primary" onClick={() => openPerson(selectedMail.npcId, "email")}><Send />回复邮件</button></article>
          : <div className="interview-mail-list">{view.messages.filter(message => message.channel === "email").map(message => <button type="button" key={message.id} onClick={() => { setMessageId(message.id); if (!message.read && !props.busy) void props.onAction({ kind: "read_message", messageId: message.id }); }}><Mail /><span><strong>{message.subject}</strong><small>{message.direction === "outgoing" ? "我 → " : ""}{view.people.find(person => person.id === message.npcId)?.name} · {clockAt(message.minute)}</small></span>{!message.read ? <i/> : null}</button>)}
          {!view.messages.some(message => message.channel === "email") ? <p className="interview-empty">邮箱里还没有邮件。对方答应发送，并不代表资料已经到达。</p> : null}
          {view.promises.filter(promise => promise.status !== "delivered" && (promise.channel ?? "email") === "email").map(promise => <article className={`interview-promise ${promise.status}`} key={`${promise.npcId}:${promise.dueMinute}`}><Clock3 /><div><strong>{promise.status === "overdue" ? "约定时间已过，资料尚未收到" : promise.status === "reminded" ? "已经催办，等待补发" : "等待约定的资料"}</strong><p>{view.people.find(person => person.id === promise.npcId)?.name} · 原约定 {clockAt(promise.dueMinute)}</p><button type="button" onClick={() => openPerson(promise.npcId, "chat")}>联系对方 <ArrowRight /></button></div></article>)}</div> : null}
        {phoneTab === "appointments" ? <div className="interview-appointments">{view.appointments.map(appointment => <article key={`${appointment.npcId}:${appointment.atMinute}`}><Clock3 /><div><strong>{view.people.find(person => person.id === appointment.npcId)?.name}</strong><p>{clockAt(appointment.atMinute)} · {({ confirmed: "约见已确认", ready: "已经到场", cancelled: "已取消", met: "已经见面", missed: "已错过时段，可以重新约见" } as const)[appointment.status]}</p><button type="button" onClick={() => openPerson(appointment.npcId, "chat")}>工作消息</button></div></article>)}{!view.appointments.length ? <p className="interview-empty">还没有约见。可以在交谈中向对方说明目的，商量见面时间。</p> : null}
          {view.promises.map(promise => <article key={`${promise.npcId}:${promise.dueMinute}`}><Mail /><div><strong>{view.people.find(person => person.id === promise.npcId)?.name} · 资料跟进</strong><p>{({ pending: "等待发送", overdue: "尚未按时收到", reminded: "已提醒，等待补发", delivered: "资料已送达" } as const)[promise.status]}</p></div></article>)}</div> : null}
        <div className="interview-wait"><small>可以继续调查，也可以在这里等一会儿。</small><div><button type="button" disabled={props.busy || view.remainingMinutes < 1} onClick={() => void props.onAction({ kind: "wait", minutes: 1 })}>等1分钟</button><button type="button" disabled={props.busy || view.remainingMinutes < 5} onClick={() => void props.onAction({ kind: "wait", minutes: 5 })}>等5分钟</button></div></div>
      </>}
    </NodeFieldDialog> : null}
    {notebookOpen ? <StudentNotebookDrawer sessionId={view.sessionId} bindingId={view.bindingId} onClose={() => setNotebookOpen(false)} /> : null}
    {panel === "map" ? <NodeFieldDialog title={`${view.region?.title ?? "社区"} · 探索地图`} onClose={() => setPanel(null)}><ExplorationMap view={view} busy={props.busy} onNavigate={id => void go(id)} /></NodeFieldDialog> : null}
    {panel === "materials" && !material ? <NodeFieldDialog title={`${node.title} · 资料栏`} onClose={() => setPanel(null)}><div className="interview-notebook"><p className="interview-empty">选择一份资料，核对内容、日期和来源；需要时可以在自己的笔记本中记录。</p>{localMaterials.map(material => <button className="interview-note-item" type="button" key={material.id} disabled={props.busy} onClick={() => void inspect(material.id)}><FileText /><span>{material.title}<small>{material.description}</small></span>{material.discovered ? <Check /> : <ArrowRight />}</button>)}</div></NodeFieldDialog> : null}
    {panel === "brief" ? <NodeFieldDialog title={view.title} onClose={() => setPanel(null)}><div className="interview-brief"><h3>本次岗位任务</h3><p>{view.assignment}</p>
      <label className="interview-topic-select">调查方向<select aria-label="报道方向" value={strategyId} onChange={event => setStrategyId(event.target.value)}>{view.strategies.map(strategy => <option key={strategy.id} value={strategy.id}>{strategy.title}</option>)}</select></label>
      <p>{view.strategies.find(strategy => strategy.id === strategyId)?.question}</p>
      <textarea aria-label="我的调查问题" rows={3} value={topicDraft} onChange={event => setTopicDraft(event.target.value)} placeholder="写下你想调查的具体问题，可以随时调整。" maxLength={2000}/>
      <button type="button" className="node-primary" disabled={props.busy || !topicDraft.trim()} onClick={() => void props.onAction({ kind: "topic", strategyId, text: topicDraft.trim() })}><Check />更新调查问题</button>
      <small>人物与现场经历为教学仿真；专业知识可按需查看出处。</small>
    </div></NodeFieldDialog> : null}
    {panel === "settings" ? <ExperienceSettings onClose={() => setPanel(null)} onRefresh={() => void props.onRefresh()} onWork={() => props.onWork("media")} onExit={props.onExit} /> : null}
    {panel === "guidance" ? <NodeFieldDialog title="岗位协作与当前决定" onClose={() => setPanel(null)}>{props.guidance}</NodeFieldDialog> : null}
    {!notebookOpen ? <button type="button" className="v3-note-launcher" onClick={() => setNotebookOpen(true)} aria-label="打开采访本"><BookOpen /><span>采访本</span></button> : null}
  </main>;
}
