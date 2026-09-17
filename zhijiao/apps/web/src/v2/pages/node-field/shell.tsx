import type { FieldAccessGateV4, FieldExplorationViewV4 } from "@ronggang/contracts";
import { ArrowLeft, BookOpenCheck, CheckCircle2, Clock3, FileImage, FileText, LockKeyhole, Mail, MessageCircle, Monitor, RefreshCw, Send, Settings2, Smartphone, UserRound, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { FlagshipExperienceViewV4, FlagshipMediaWorkspaceV4 } from "../../flagship-v4";
import type { FlagshipWorkspaceView, FlagshipWorldView } from "../../world-v3";
import { NodeFieldStage } from "./stage";
import { nodeName, orderNodes, sceneActors, type FieldPerson } from "./visuals";
import "./style.css";

type Panel = "interaction" | "guidance" | "phone" | "notebook" | "brief" | "settings" | null;
export function NodeFieldDialog({ title, onClose, children, phone = false }: { title: string; onClose(): void; children: ReactNode; phone?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current!; dialog.showModal(); return () => dialog.close(); }, []);
  return <dialog ref={ref} className={`node-field-dialog${phone ? " node-phone-dialog" : ""}`} aria-label={title} onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><h2>{title}</h2><button type="button" onClick={onClose} aria-label={`关闭${title}`}><X /></button></header>
    <div className="node-dialog-body">{children}</div>
  </dialog>;
}
export interface NodeFieldShellProps {
  field: FieldExplorationViewV4;
  experience: FlagshipExperienceViewV4;
  world: FlagshipWorldView;
  workspace: FlagshipWorkspaceView;
  media: FlagshipMediaWorkspaceV4;
  viewpoint: string | null;
  selectedPerson: FieldPerson | null;
  activeDialogueNpc: string | null;
  busy: string | null;
  message: string | null;
  guidance: ReactNode;
  guidanceKey: string | null;
  guidanceRequired: boolean;
  requiresReauth?: boolean;
  interaction: ReactNode;
  onViewpoint(id: string): void;
  onPerson(id: string): void;
  onObject(id: string): void;
  onMessage(personId: string, text: string): Promise<boolean>;
  onRefresh(): Promise<void>;
  onWork(kind: "story" | "media", assetRef?: string): void;
  onReview(): void;
  onExit(): void;
}
export function NodeFieldShell(props: NodeFieldShellProps) {
  const { field, experience, world, workspace } = props;
  const [panel, setPanel] = useState<Panel>(props.activeDialogueNpc ? "interaction" : props.guidanceRequired ? "guidance" : null);
  const [phoneTab, setPhoneTab] = useState<"messages" | "materials">("messages");
  const [contactId, setContactId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [accessHint, setAccessHint] = useState<FieldAccessGateV4 | null>(null);
  const nodes = useMemo(() => orderNodes(field.nodes), [field.nodes]);
  const requestedNode = nodes.find(item => item.sceneRef === props.viewpoint) ?? nodes.find(item => item.sceneRef === experience.scene.sceneRef);
  const node = requestedNode?.access.allowed ? requestedNode : nodes.find(item => item.sceneRef === "loc-oyster-alley-gate" && item.access.allowed) ?? nodes.find(item => item.access.allowed)!;
  const nextNode = nodes[(nodes.findIndex(item => item.sceneRef === node.sceneRef) + 1) % nodes.length];
  const people = useMemo(() => [...new Map(field.nodes.flatMap(item => item.people).map(person => [person.entityId, person])).values()], [field.nodes]);
  const bindingMap = useMemo(() => new Map(field.selectionBindings.map(binding => [binding.objectId, binding.selectionToken])), [field.selectionBindings]);
  const selections = experience.actionWindow?.selections ?? [];
  const objects = node.objectRefs.flatMap(objectId => {
    const selection = selections.find(item => item.selectionToken === bindingMap.get(objectId));
    return selection ? [{ objectId, label: selection.label, hint: selection.consequenceHint }] : [];
  });
  const localActors = sceneActors(node);
  const associatedPeople = node.people.filter(person => person.presence.visible && !localActors.some(actor => actor.entityId === person.entityId));
  const selectedContact = people.find(person => person.entityId === contactId) ?? null;
  const contactEpisodes = field.dialogues.filter(episode => episode.npc.npcRef === contactId);
  const latestContactEpisode = contactEpisodes.at(-1);
  const contactActions = field.actionConversations.filter(entry => entry.targetEntityId === contactId);
  const hasActiveConflict = !!props.activeDialogueNpc && props.activeDialogueNpc !== contactId;
  const maySend = !!selectedContact && selectedContact.presence.canContact && selectedContact.status === "available" && !props.guidanceRequired && !hasActiveConflict && bindingMap.has(selectedContact.entityId) && world.endingState.status === "active";
  const fieldNotes = workspace.evidenceCatalog.filter(item => item.kind === "world_evidence");
  const fieldEvents = workspace.evidenceCatalog.filter(item => item.kind === "world_event");
  const activeSpeaker = people.find(person => person.entityId === props.activeDialogueNpc)?.displayName;
  const knowledge = workspace.evidenceCatalog.filter(item => item.kind === "knowledge");
  const clock = new Date(world.virtualTime.currentAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  const close = () => setPanel(null);
  useEffect(() => {
    if (requestedNode && !requestedNode.access.allowed) {
      setAccessHint(requestedNode.access); props.onViewpoint(node.sceneRef);
    }
  }, [requestedNode?.sceneRef, requestedNode?.access.allowed, node.sceneRef]);
  const previousMessage = useRef<string | null>(null);
  useEffect(() => {
    if (!props.message || props.message === previousMessage.current) return;
    previousMessage.current = props.message; setNotice(props.message);
  }, [props.message]);
  useEffect(() => {
    if (!notice) return;
    const id = globalThis.setTimeout(() => setNotice(null), 6000); return () => globalThis.clearTimeout(id);
  }, [notice]);
  const unlocked = useRef(new Set(nodes.filter(item => item.access.allowed).map(item => item.sceneRef)));
  useEffect(() => {
    const newlyOpen = nodes.find(item => item.access.allowed && !unlocked.current.has(item.sceneRef));
    unlocked.current = new Set(nodes.filter(item => item.access.allowed).map(item => item.sceneRef));
    if (newlyOpen) { setNotice(`${nodeName(newlyOpen)}已经开放，可以继续探索。`); setAccessHint(null); }
  }, [nodes]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement || event.isComposing) return;
      if (event.key === "Escape" && panel === "interaction") setPanel(null);
      if (!panel && event.key.toLowerCase() === "p") setPanel("phone");
      if (!panel && event.key.toLowerCase() === "n") setPanel("notebook");
    };
    document.addEventListener("keydown", listener); return () => document.removeEventListener("keydown", listener);
  }, [panel]);
  const selectPerson = (id: string) => {
    if (props.guidanceRequired) { setPanel("guidance"); return; }
    const person = people.find(candidate => candidate.entityId === id);
    if (person && !person.presence.canContact) { setAccessHint(person.presence.prerequisite); return; }
    if (person && person.status !== "available") { openContact(id); return; }
    if (props.activeDialogueNpc && props.activeDialogueNpc !== id) { openContact(props.activeDialogueNpc); return; }
    props.onPerson(id); setPanel("interaction");
  };
  const openContact = (id: string) => { setContactId(id); setPhoneTab("messages"); setPanel("phone"); };
  const navigateToScene = (id: string) => {
    const target = nodes.find(item => item.sceneRef === id);
    if (!target || props.busy) return;
    if (!target.access.allowed) { setAccessHint(target.access); return; }
    setAccessHint(null); props.onViewpoint(id); close();
  };
  const followPrerequisite = (gate: FieldAccessGateV4) => {
    if (gate.sceneRef) navigateToScene(gate.sceneRef);
    if (gate.personRef) selectPerson(gate.personRef);
    setAccessHint(null);
  };
  const sendMessage = async () => {
    if (!contactId || props.busy) return;
    const text = (drafts[contactId] ?? "").trim(); if (text.length < 2) return;
    if (await props.onMessage(contactId, text)) setDrafts(current => ({ ...current, [contactId]: "" }));
  };
  return <main className="node-field" aria-label="泉州蟳埔旗舰真实岗位世界" data-world-version={experience.worldStateVersion}>
    <NodeFieldStage node={node} objects={objects} focusedPerson={panel === "interaction" ? props.selectedPerson?.entityId ?? props.activeDialogueNpc : null} blocked={panel !== null || props.busy !== null} onPerson={selectPerson} onObject={id => { props.onObject(id); setPanel("interaction"); }} destinations={nextNode && nextNode.sceneRef !== node.sceneRef ? [{ sceneRef: nextNode.sceneRef, title: nodeName(nextNode), locked: !nextNode.access.allowed, x: .72, y: .74 }] : []} onNavigate={navigateToScene} />
    <header className="node-identity"><button className="node-brand" type="button" onClick={() => setPanel("brief")} aria-label="职教星云，查看采访任务"><svg viewBox="0 0 30 30" aria-hidden="true"><path d="m15 1 7 7-7 7-7-7 7-7ZM1 15l7-7 7 7-7 7-7-7Zm14 0 7-7 7 7-7 7-7-7Zm-7 7 7-7 7 7-7 7-7-7Z"/></svg><strong>职教星云</strong></button><div className="node-location">蟳埔 · {nodeName(node)}</div><button className="node-objective" type="button" onClick={() => setPanel("brief")}><i />{world.endingState.status === "active" ? "完成一场有依据的社区采访" : "回看本次采访与作品"}</button></header>
    <div className="node-clock"><div><time>{clock}</time><button type="button" onClick={() => void props.onRefresh()} disabled={props.busy !== null} aria-label="刷新现场"><RefreshCw /></button><button type="button" onClick={() => setPanel("settings")} aria-label="现场设置"><Settings2 /></button></div><small>剩余{experience.remainingMinutes}分钟 · 教学仿真{world.virtualTime.paused ? " · 已暂停" : ""}</small></div>
    <nav className="node-tool-dock" aria-label="采访工具"><button type="button" aria-label="打开手机" onClick={() => setPanel("phone")}><Smartphone /><span>手机</span>{props.guidanceKey ? <b>1</b> : null}</button><button type="button" aria-label="打开采访本" onClick={() => setPanel("notebook")}><BookOpenCheck /><span>采访本</span>{fieldNotes.length ? <em>{fieldNotes.length}</em> : null}</button><button type="button" aria-label="打开报道作品台" onClick={() => props.onWork("story")}><Monitor /><span>工作台</span><em>{workspace.completion.submittedRequiredCount}/{workspace.completion.requiredArtifactCount}</em></button></nav>
    {!panel && !localActors.some(actor => actor.visible) && associatedPeople.length > 0 ? <div className="node-associated"><small>相关联系人</small>{associatedPeople.map(person => <button type="button" key={person.entityId} onClick={() => openContact(person.entityId)}><img src={person.portrait} alt=""/><span>{person.displayName}<small>{person.professionalRole}</small></span><MessageCircle /></button>)}</div> : null}
    <nav className="node-scene-nav" aria-label="采访区域">{nodes.map(item => <button type="button" className={`${item.sceneRef === node.sceneRef ? "active" : ""}${item.access.allowed ? "" : " locked"}`} title={item.access.reason ?? undefined} data-locked={!item.access.allowed} aria-current={item.sceneRef === node.sceneRef ? "location" : undefined} key={item.sceneRef} aria-label={`前往${nodeName(item)}`} onClick={() => navigateToScene(item.sceneRef)}><img src={item.sceneRef === "loc-oyster-alley-gate" ? "/assets/node-world/alley.png" : item.environmentImage} alt=""/><span>{!item.access.allowed ? <LockKeyhole /> : null}{nodeName(item)}</span></button>)}</nav>
    <div className="node-help">拖动观察 · 点击人物或物件 · 滚轮放大</div>
    {accessHint && !panel ? <section className="node-access-hint" role="status"><LockKeyhole /><div><strong>这里还未开放</strong><p>{accessHint.reason}</p><button type="button" onClick={() => followPrerequisite(accessHint)}>{accessHint.personRef ? "去找林师傅" : "查看前导任务"}</button></div><button type="button" aria-label="关闭进入提示" onClick={() => setAccessHint(null)}><X /></button></section> : null}
    {props.requiresReauth ? <div className="node-connection-warning" role="alert"><p>当前登录状态需要更新，已暂停同步。训练记录仍保存在服务端。</p><button type="button" onClick={() => void props.onRefresh()}>重新进入学生端</button></div> : null}
    {notice && panel === null ? <button className="node-notice" type="button" onClick={() => setPanel(props.guidanceKey ? "guidance" : "brief")}>{notice}</button> : null}
    {props.guidanceKey && panel !== "guidance" ? <button className="node-guidance-cue" type="button" onClick={() => setPanel("guidance")}><MessageCircle /><span>{props.guidanceRequired ? "有一条岗位决定待处理" : "查看协作与现场反馈"}</span></button> : null}
    {panel === "interaction" ? <section className="node-live-conversation" aria-label="现场交谈"><button className="node-close-conversation" type="button" aria-label="返回场景" onClick={close}><X /></button>{props.interaction}{props.message ? <p className="node-response-note" role="status">{props.message}</p> : null}</section> : null}
    {panel === "guidance" ? <NodeFieldDialog title="岗位协作与现场反馈" onClose={close}>{props.guidance ?? <p>当前没有待处理的协作建议，你可以继续采访与核验。</p>}{props.message ? <p className="node-response-note" role="status">{props.message}</p> : null}</NodeFieldDialog> : null}
    {panel === "brief" ? <NodeFieldDialog title="本次采访" onClose={close}><article className="node-brief"><small>{workspace.manifest.title}</small><h2>{experience.scene.title}</h2><p>{experience.actionWindow?.prompt ?? experience.scene.publicDescription}</p><div className="node-brief-meta"><span><Clock3 />剩余{experience.remainingMinutes}分钟</span><span><CheckCircle2 />已锁定{workspace.completion.submittedRequiredCount}/{workspace.completion.requiredArtifactCount}项成果</span></div><h3>本区域可查看的对象</h3><div className="node-brief-objects">{objects.map(object => <button type="button" className="node-secondary" key={object.objectId} onClick={() => { props.onObject(object.objectId); setPanel("interaction"); }}>{object.label}</button>)}{!objects.length ? <p>当前区域没有已开放的物件线索。</p> : null}</div><h3>本局需要完成的作品</h3><ul>{workspace.artifacts.filter(item => item.required).map(item => <li key={item.artifactId}>{item.title}<span>{item.status === "submitted" ? "已锁定" : item.status === "draft" ? "已有草稿" : "待完成"}</span></li>)}</ul><button type="button" className="node-primary" onClick={() => props.onWork("story")}>进入工作台</button>{world.endingState.status !== "active" ? <button type="button" className="node-primary" onClick={props.onReview}>进入评价复盘</button> : null}</article></NodeFieldDialog> : null}
    {panel === "notebook" ? <NodeFieldDialog title="采访本" onClose={close}><p className="node-intro">由本次实际交流、现场行动与资料形成。记录的范围和状态随服务端更新。</p><div className="node-notes">{fieldNotes.map(note => <article key={note.evidenceRef}><small>本次现场记录</small><h3>{note.label}</h3><p>{note.detail}</p></article>)}{field.dialogues.flatMap(episode => episode.disclosedFacts.map(fact => <article key={`${episode.episodeId}:${fact.factRef}`}><small>{episode.npc.displayName} · 已披露的讲述</small><p>{fact.publicText}</p></article>))}{!fieldNotes.length && !field.dialogues.some(episode => episode.disclosedFacts.length) ? <p>尚无本次采访记录。可以先与人物交谈，或选择现场对象进行观察和核验。</p> : null}</div><details className="node-knowledge"><summary>现场经过 · {fieldEvents.length}条</summary>{fieldEvents.map(event => <article key={event.evidenceRef}><h3>{event.label}</h3><p>{event.detail}</p></article>)}</details><details className="node-knowledge"><summary>课程参考资料 · {knowledge.length}条</summary>{knowledge.map(note => <article key={note.evidenceRef}><h3>{note.label}</h3><p>{note.detail}</p></article>)}</details><button type="button" className="node-secondary" onClick={() => props.onWork("media")}><FileImage />打开图片、音频与视频素材台</button></NodeFieldDialog> : null}
    {panel === "phone" ? <NodeFieldDialog title={selectedContact?.displayName ?? (phoneTab === "materials" ? "资料收件箱" : "工作消息")} phone onClose={close}>
      <div className="node-phone-top"><time>{clock}</time><small>本次课程工作联系</small></div>
      <nav className="node-phone-tabs"><button type="button" className={phoneTab === "messages" ? "active" : ""} onClick={() => { setPhoneTab("messages"); setContactId(null); }}><MessageCircle />消息</button><button type="button" className={phoneTab === "materials" ? "active" : ""} onClick={() => { setPhoneTab("materials"); setContactId(null); }}><Mail />资料</button></nav>
      {phoneTab === "materials" ? <div className="node-phone-materials"><p>当前课程向你提供的资料与素材。文件是否可用、用途与权利范围以当前记录为准。</p>{props.media.catalog.map(asset => <article key={asset.assetRef}><FileText /><div><h3>{asset.title}</h3><p>{asset.sourceFactBoundary}</p><small>{asset.rightsStatus === "withdrawn" ? "授权已撤回" : asset.rightsStatus === "limited" ? "限范围使用" : "查看使用范围"}</small></div><button type="button" aria-label={`查看${asset.title}`} onClick={() => props.onWork("media", asset.assetRef)}>查看</button></article>)}{!props.media.catalog.length ? <p>当前课程没有向你提供资料文件。</p> : null}</div> : selectedContact ? <div className="node-phone-thread"><button className="node-thread-back" type="button" onClick={() => setContactId(null)}><ArrowLeft />返回消息列表</button><div className="node-thread-messages" aria-label={`与${selectedContact.displayName}的交流记录`}>{contactEpisodes.map(episode => <section key={episode.episodeId}>{episode.openingStudentUtterance ? <p className="mine"><small>你的开场</small>{episode.openingStudentUtterance}</p> : null}{episode.turns.map(turn => <div key={turn.turnId}><p className="mine">{turn.studentUtterance}</p><p>{turn.npcPublicText}</p></div>)}{episode.currentPrompt && episode.currentPrompt !== episode.turns.at(-1)?.npcPublicText ? <p>{episode.currentPrompt}</p> : null}{episode.commitments.length ? <details><summary>这次交流中的约定</summary>{episode.commitments.map(commitment => <p key={commitment.commitmentId}>{commitment.summary}<small>{commitment.status === "active" ? "进行中" : commitment.status === "fulfilled" ? "已履行" : commitment.status === "breached" ? "未兑现" : "已撤回"}</small></p>)}</details> : null}</section>)}{contactActions.map(entry => <section key={entry.workActionId} className="node-action-conversation"><small>岗位交流</small><p className="mine">{entry.utterance}</p>{entry.responseSummary ? <p><small>岗位反馈</small>{entry.responseSummary}</p> : <small>{entry.status === "awaiting_gate" ? "等待教师处理" : entry.status === "failed" || entry.status === "rejected" ? "本轮未形成已采纳结果" : "问题已记录，请查看岗位协作结果"}</small>}</section>)}{!contactEpisodes.length && !contactActions.length ? <p className="node-intro">{selectedContact.presence.canContact ? selectedContact.publicGoal : "对方尚未进入本次采访现场。完成前导事件后才会开放见面与交流。"}</p> : null}</div>{props.guidanceRequired ? <button type="button" className="node-secondary" onClick={() => setPanel("guidance")}>先处理当前岗位决定</button> : hasActiveConflict ? <button type="button" className="node-secondary" onClick={() => { if (props.activeDialogueNpc) setContactId(props.activeDialogueNpc); }}>继续当前尚未结束的交谈</button> : !maySend ? <p className="node-intro">{!selectedContact.presence.canContact ? selectedContact.presence.prerequisite.reason : selectedContact.status === "left" ? "对方已经离场，已形成的交流记录仍保留。" : "当前任务尚未开放这位人物的交流，可以先完成现场已开放的行动。"}</p> : null}{!selectedContact.presence.canContact ? <button type="button" className="node-secondary" onClick={() => followPrerequisite(selectedContact.presence.prerequisite)}>去完成前导事件</button> : null}<form className="node-message-form" onSubmit={event => { event.preventDefault(); void sendMessage(); }}><textarea rows={2} aria-label={`给${selectedContact.displayName}的工作消息`} value={drafts[contactId!] ?? ""} onChange={event => setDrafts(current => ({ ...current, [contactId!]: event.target.value }))} placeholder={latestContactEpisode?.status === "active" ? "继续回应对方的问题…" : "先说明来意与具体问题…"} maxLength={2000} disabled={props.busy !== null || !maySend}/><button type="submit" className="node-primary" disabled={props.busy !== null || !maySend || (drafts[contactId!] ?? "").trim().length < 2}><Send />发送</button></form>{props.message ? <p className="node-response-note" role="status">{props.message}</p> : null}</div> : <div className="node-contact-list">{props.guidanceKey ? <button type="button" className="node-editor-message" onClick={() => setPanel("guidance")}><MessageCircle /><span><strong>岗位协作</strong><small>{props.guidanceRequired ? "有一个决定需要你处理" : "查看协作与现场反馈"}</small></span></button> : null}{experience.worldPulse.status === "npc_action_pending" && experience.worldPulse.speaker !== activeSpeaker ? <article className="node-pulse"><strong>{experience.worldPulse.speaker}主动开口</strong><p>{experience.worldPulse.message}</p></article> : null}{people.map(person => { const last = field.dialogues.filter(episode => episode.npc.npcRef === person.entityId).at(-1); const action = field.actionConversations.filter(entry => entry.targetEntityId === person.entityId).at(-1); return <button type="button" key={person.entityId} onClick={() => setContactId(person.entityId)}>{person.presence.visible ? <img src={person.portrait} alt=""/> : <UserRound className="node-contact-locked" />}<span><strong>{person.displayName}{!person.presence.visible ? " · 尚未约见" : ""}</strong><small>{!person.presence.canContact ? person.presence.prerequisite.reason : last?.turns.at(-1)?.npcPublicText ?? last?.currentPrompt ?? action?.responseSummary ?? action?.utterance ?? person.professionalRole}</small></span></button>; })}</div>}
    </NodeFieldDialog> : null}
    {panel === "settings" ? <NodeFieldDialog title="现场设置" onClose={close}><p className="node-intro">拖动观察，点击人物与物件进入交互。节点切换只改变查看区域；采访、核验与作品操作由正式服务处理。</p><button className="node-secondary" type="button" onClick={() => void props.onRefresh()} disabled={props.busy !== null}><RefreshCw />重新同步现场</button><p className="node-intro">{experience.scene.simulationNotice}</p><details><summary>运行状态</summary><p>当前现场时间与人物状态来自训练会话。当前协作模式：{experience.runtimeDisclosure.collaboration === "live" ? "模型协作" : experience.runtimeDisclosure.collaboration === "mixed" ? "模型与规则共同执行" : experience.runtimeDisclosure.collaboration === "not_run" ? "尚未运行" : "确定性演示"}。</p></details><button className="node-secondary" type="button" onClick={props.onExit}><ArrowLeft />离开现场，返回课程</button></NodeFieldDialog> : null}
  </main>;
}
