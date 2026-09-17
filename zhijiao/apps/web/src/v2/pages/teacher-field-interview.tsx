import { useEffect, useState } from "react";
import { BookOpen, Clock3, MessageCircle, Route, UserRound } from "lucide-react";
import type { FieldInterviewViewV1 } from "@ronggang/contracts";
import type { TeacherGateway } from "../teacher-gateway";
import "./teacher-field-interview.css";

export function TeacherFieldInterview({ gateway, sessionId, bindingId, enabled }: { gateway: TeacherGateway; sessionId: string; bindingId: string; enabled: boolean }) {
  const [view, setView] = useState<FieldInterviewViewV1 | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!enabled || !gateway.getFieldInterviewV1) return;
    const controller = new AbortController();
    let running = false;
    const refresh = async () => {
      if (running || controller.signal.aborted || document.hidden) return;
      running = true;
      try {
        const next = await gateway.getFieldInterviewV1!(sessionId, bindingId, controller.signal);
        if (!controller.signal.aborted) { setView(next); setError(null); setLoaded(true); }
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "采访过程暂时无法同步");
      } finally { running = false; }
    };
    void refresh();
    const interval = setInterval(() => void refresh(), 5000);
    const visible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", visible);
    return () => { controller.abort(); clearInterval(interval); document.removeEventListener("visibilitychange", visible); };
  }, [gateway, sessionId, bindingId, enabled]);
  if (!enabled || !gateway.getFieldInterviewV1 || (loaded && !view && !error)) return null;
  if (!view) return error ? <p className="teacher-field-message" role="status">采访过程暂未同步：{error}</p> : null;
  const overdue = view.promises.filter(promise => promise.status === "overdue");
  const missed = view.appointments.filter(appointment => appointment.status === "missed");
  const visited = view.nodes.filter(node => node.visited);
  const sources = view.materials.filter(material => material.discovered && material.kind === "public_source");
  const name = (id: string) => view.people.find(person => person.id === id)?.name ?? "现场人物";
  return <section className="teacher-field-interview" aria-label="学生开放采访过程">
    <header><div><small>持续同步 · 本场学生的实际经历</small><h2>开放采访过程</h2></div><span><Clock3 />现场剩余 {view.remainingMinutes} 分钟</span></header>
    <div className="teacher-field-facts"><span><Route />{visited.length} 处已到访</span><span><UserRound />{view.progress.interviewedPeople} 人有实质问答</span><span><BookOpen />{view.progress.discoveredMaterials} 份资料已取得</span><span>{sources.length} 份公开来源已取得</span></div>
    <article className="teacher-field-topic"><small>学生当前的调查问题</small><p>{view.topic || "尚未记录明确的调查问题；可以先观察其探索过程。"}</p><span>当前位置：{view.nodes.find(node => node.id === view.nodeId)?.title}</span></article>
    {overdue.length || missed.length ? <div className="teacher-field-attention">{overdue.map(promise => <p key={promise.npcId}>资料跟进：{name(promise.npcId)}的邮件未按时送达，学生仍可催办或寻找替代来源。</p>)}{missed.map(appointment => <p key={`${appointment.npcId}:${appointment.atMinute}`}>时间安排：已错过与{name(appointment.npcId)}的一次约见，观察学生后续如何调整。</p>)}</div> : null}
    <details><summary><MessageCircle />查看人物交谈与实际选择</summary><div className="teacher-field-transcript">{view.turns.map(turn => <article key={turn.id}><header><strong>{name(turn.npcId)}</strong><small>第 {turn.minute} 分钟 · {turn.choiceConfirmed ? "确认安排" : turn.topicId ? "人物问答" : "日常交谈"}</small></header><p><b>学生：</b>{turn.studentText}</p><p><b>{name(turn.npcId)}：</b>{turn.npcText}</p>{turn.materialIds.length ? <small>关联资料：{turn.materialIds.map(id => view.materials.find(material => material.id === id)?.title ?? id).join("、")}</small> : null}</article>)}</div></details>
    <details><summary>查看最近的探索与材料记录</summary><div className="teacher-field-events">{view.recentEvents.map(event => <p key={event.id}><time>{event.minute} 分钟</time>{event.summary}</p>)}</div></details>
    <footer>这些记录描述本次任务中的行为与条件。查阅数量和路线不直接等于能力分数；作品评价与教师终裁仍在原评价流程中完成。</footer>
    {error ? <p className="teacher-field-message">正在显示上次成功同步的记录：{error}</p> : null}
  </section>;
}
