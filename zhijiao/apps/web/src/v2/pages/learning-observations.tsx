import type { LearningObservationV4 } from "@ronggang/contracts";
import "./learning-observations.css";

const labels = { observed: "已有依据", needs_review: "请复核", gap: "待补证", conflict: "发现不一致" };
export function LearningObservations({ observations }: { observations: LearningObservationV4[] }) {
  if (!observations.length) return null;
  const priority = { conflict: 0, gap: 1, needs_review: 2, observed: 3 };
  const ordered = [...observations].sort((left, right) => priority[left.status] - priority[right.status]);
  return <section className="learning-observations" aria-label="本场过程与作品反馈">
    <header><h2>本场过程与作品反馈</h2><p>对照本场已发生的安排、已取得资料和送审表述。以下是有限范围的证据核对，不能替代教师判断。</p></header>
    <div className="learning-observation-list">{ordered.map(item => <article key={item.observationId} className={`status-${item.status}`}>
      <header><span>{labels[item.status]}</span><h3>{item.title}</h3></header><p>{item.detail}</p>
      {item.workExcerpt ? <blockquote><small>本次送审原文</small><p>{item.workExcerpt}</p></blockquote> : null}
      {item.sourceExcerpt ? <details><summary>对照实际来源</summary><blockquote>{item.sourceExcerpt}</blockquote></details> : null}
      {item.evidenceRefs.length ? <details><summary>追溯本场证据</summary><ul>{item.evidenceRefs.map(ref => <li key={ref}>{ref}</li>)}</ul></details> : null}
    </article>)}</div>
  </section>;
}
