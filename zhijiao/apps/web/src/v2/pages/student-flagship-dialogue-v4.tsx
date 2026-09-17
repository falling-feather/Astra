import {
  CheckCircle2,
  Clock3,
  LogOut,
  MessageCircle,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { StudentDialogueEpisodeEnvelopeV4 } from "../dialogue-v4";

const commitmentStatusLabels = {
  active: "进行中",
  fulfilled: "已履行",
  breached: "已违约",
  withdrawn: "已撤回",
} as const;

const dialogueStatusLabels = {
  resolution_pending: "正在写入世界结果",
  resolved: "已形成世界结果",
  exited: "已结束，可回到现场行动",
  expired: "已超时，可回到现场行动",
  stale: "世界已变化，需要回到现场刷新",
} as const;

export interface StudentFlagshipDialogueV4PanelProps {
  dialogue: StudentDialogueEpisodeEnvelopeV4;
  busy: boolean;
  onSubmit(utterance: string): void;
  onExit(): void;
}

export function StudentFlagshipDialogueV4Panel({
  dialogue,
  busy,
  onSubmit,
  onExit,
}: StudentFlagshipDialogueV4PanelProps) {
  const { episode } = dialogue;
  const [utterance, setUtterance] = useState("");
  const active = episode.status === "active" && dialogue.turnToken !== null;

  useEffect(() => {
    setUtterance("");
  }, [episode.episodeId, episode.turnCount]);

  const submit = () => {
    const value = utterance.trim();
    if (value.length < 2 || busy) return;
    onSubmit(value);
  };

  const transcript = episode.turns.map((turn) => (
    <li key={turn.turnId} className="flagship-v4-dialogue-turn">
      <div><UserRound /><small>你 · 第 {turn.sequence} 回合</small></div>
      <p>{turn.studentUtterance}</p>
      <div><MessageCircle /><small>{episode.npc.displayName} · {turn.npcStance}</small></div>
      <p>{turn.npcPublicText}</p>
    </li>
  ));
  const opening = episode.openingStudentUtterance ? (
    <div className="flagship-v4-dialogue-prompt">
      <strong>你的开场原话</strong>
      <p>{episode.openingStudentUtterance}</p>
    </div>
  ) : null;

  if (!active) {
    return (
      <details className="flagship-v4-history flagship-v4-dialogue-history" data-dialogue-status={episode.status}>
        <summary><MessageCircle />最近一次人物对话 · {episode.npc.displayName}</summary>
        <p>{dialogueStatusLabels[episode.status as keyof typeof dialogueStatusLabels] ?? "人物对话记录"}</p>
        {opening}
        {transcript.length > 0 ? <ol>{transcript}</ol> : null}
        {episode.commitments.length > 0 ? (
          <ul className="flagship-v4-dialogue-commitments">
            {episode.commitments.map((commitment) => (
              <li key={commitment.commitmentId}>
                <strong>{commitmentStatusLabels[commitment.status]}</strong>
                <span>{commitment.summary}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </details>
    );
  }

  const lastTurn = episode.turns.at(-1);
  return (
    <section className="flagship-v4-dialogue node-compact-dialogue" data-round-focus="dialogue" data-dialogue-status={episode.status} aria-label={`与${episode.npc.displayName}的人物对话`}>
      <header><h2>{episode.npc.displayName}<small>现场交谈</small></h2><details className="node-transcript"><summary>对话记录</summary>{opening}{transcript.length ? <ol>{transcript}</ol> : null}</details></header>
      {lastTurn ? <p className="node-last-utterance">你：{lastTurn.studentUtterance}</p> : null}
      <p className="node-current-reply">{lastTurn?.npcPublicText ?? episode.currentPrompt}</p>
      {episode.currentPrompt && lastTurn && episode.currentPrompt !== lastTurn.npcPublicText ? <p className="node-next-question">{episode.currentPrompt}</p> : null}
      <details className="node-dialogue-evidence"><summary>查看当前约定与已披露的讲述</summary>{episode.commitments.map(commitment => <p key={commitment.commitmentId}><strong>{commitmentStatusLabels[commitment.status]}</strong> {commitment.summary}<small>{commitment.condition}</small></p>)}{episode.disclosedFacts.map(fact => <p key={fact.factRef}>{fact.publicText}</p>)}{!episode.commitments.length && !episode.disclosedFacts.length ? <p>当前还没有形成约定或新的现场讲述。</p> : null}</details>
      <form className="node-dialogue-form" onSubmit={event => { event.preventDefault(); submit(); }}><textarea value={utterance} onChange={event => setUtterance(event.target.value)} onKeyDown={event => { if (!event.nativeEvent.isComposing && event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); } }} placeholder="用自己的话继续回应…" aria-label="继续回应人物" maxLength={2000} disabled={busy} rows={2}/><button className="node-primary" data-primary-action="true" type="submit" disabled={busy || utterance.trim().length < 2}>{busy ? "正在等待人物回应" : "提交这一回合"}</button></form>
      <footer><small>Enter提交，Shift+Enter换行</small><button type="button" onClick={onExit} disabled={busy}><LogOut />结束对话并返回现场</button></footer>
    </section>
  );
}
