import {
  ArrowRight,
  CheckCircle2,
  CircleDashed,
  FileCheck2,
  ShieldCheck,
} from "lucide-react";
import {useState} from 'react';
import type { FlagshipEvidenceAssessmentViewV4 } from "../assessment-v4";
import { LearningObservations } from "./learning-observations";

const statusLabels = {
  not_ready: "尚未形成评价",
  insufficient_evidence: "等待进一步审阅",
  provisional: "六维初判，等待教师终裁",
  final: "教师终裁已完成",
} as const;

const bandLabels = {
  low: "需重点改进",
  medium: "达到岗位基础要求",
  high: "表现出较强岗位能力",
} as const;

export function StudentEvidenceAssessmentSurfaceV4({
  view,
  sessionId,
  navigate,
  onRetry,
}: {
  view: FlagshipEvidenceAssessmentViewV4;
  sessionId: string;
  navigate(path: string): void;
  onRetry?:(()=>Promise<void>)|undefined;
}) {
  const [retrying,setRetrying]=useState(false),[error,setError]=useState<string|null>(null);
  const workPrimary=view.assessmentBasis==='submitted_work';
  const score = view.decision?.sessionScore ?? null;
  if (view.status === "not_ready") {
    return (
      <main className="v2-simple-page v4-assessment-page">
        <LearningObservations observations={view.learningObservations ?? []} />
        <section className="v2-light-empty v4-assessment-empty">
          <CircleDashed size={48} />
          <span>岗位证据评价</span>
          <h1>完成并提交作品后查看评价</h1>
          <p>{view.safeMessage}</p>
          <button
            type="button"
            className="v2-primary-cta"
            onClick={() => navigate(`/student/training/${encodeURIComponent(sessionId)}`)}
          >
            回到任务现场 <ArrowRight size={17} />
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="v2-simple-page v4-assessment-page">
      <header className="v4-assessment-hero">
        <div>
          <span>岗位证据评价</span>
          <h1>{statusLabels[view.status]}</h1>
          <p>{view.safeMessage}</p>
          {view.retryAvailable&&onRetry?<button type="button" className="v2-secondary-cta" disabled={retrying} onClick={()=>{setRetrying(true);setError(null);void onRetry().catch(cause=>setError(cause instanceof Error?cause.message:'本次重评未完成')).finally(()=>setRetrying(false));}}>{retrying?'正在重新评阅作品…':'重新评阅作品'}</button>:null}
          {error?<p role="alert">{error}</p>:null}
        </div>
        <div className={`v4-assessment-score status-${view.status}`}>
          {score === null ? (
            <><strong>—</strong><span>{workPrimary?'等待作品审阅':'尚未形成分数'}</span></>
          ) : (
            <><strong>{score}</strong><span>/ 100</span></>
          )}
        </div>
      </header>

      <section className="v4-assessment-principle" role="note">
        <ShieldCheck />
        <div>
          <strong>{workPrimary?'评价你交付的作品与具体判断':'系统只评价可追溯的岗位事实'}</strong>
          <p>依据作品内容与实际调查理解表现。篇幅、好友数量、点击次数和采纳建议的比例均不加分；私人笔记只由你自己查看。</p>
        </div>
      </section>

      {!workPrimary?<section className="v4-evidence-coverage" aria-label="本轮证据覆盖">
        <div><b>{view.evidenceCoverage.artifactRevisionCount}</b><span>送审版本</span></div>
        <div><b>{view.evidenceCoverage.claimLinkCount}</b><span>主张—证据关系</span></div>
        <div><b>{view.evidenceCoverage.behaviorCount}</b><span>真实岗位行为</span></div>
        <div><b>{view.evidenceCoverage.consequenceCount}</b><span>世界后果</span></div>
        <div><b>{view.evidenceCoverage.recoveryPairCount}</b><span>修订版本对</span></div>
      </section>:null}

      <LearningObservations observations={view.learningObservations ?? []} />
      <section className="v4-criterion-grid" aria-label="六维岗位能力">
        {view.criteria.map((criterion) => (
          <article
            key={criterion.criterionId}
            className={`v4-criterion-card status-${criterion.evidenceStatus}`}
          >
            <header>
              <FileCheck2 />
              <div>
                <h2>{criterion.title}</h2>
                <span>{criterion.band ? bandLabels[criterion.band] : "待审阅"}</span>
              </div>
              <b>{criterion.score === null ? "—" : criterion.score}</b>
            </header>
            <p>{criterion.rationale}</p>
            <footer>
              {criterion.evidenceStatus === "insufficient"
                ? <><CircleDashed />{workPrimary?'依据已提交作品继续审阅':'结合实际作品与来源继续核查'}</>
                : <><CheckCircle2 />证据状态：{criterion.evidenceStatus}</>}
            </footer>
          </article>
        ))}
      </section>

      <footer className="v4-assessment-footer">
        <div>
          <strong>{view.rubric.classroomApplicabilityConfirmed
            ? "本班量规适用性已由课程教师确认"
            : "仍需课程教师逐维终裁"}</strong>
          <p>外部专业教师/专家效度尚未建立，平台不会把本班确认包装成外部认证。</p>
        </div>
        <button
          type="button"
          className="v2-secondary-cta"
          onClick={() => navigate(`/student/training/${encodeURIComponent(sessionId)}`)}
        >
          回看任务现场
        </button>
      </footer>
    </main>
  );
}
