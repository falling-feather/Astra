import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  BookOpenCheck,
  CircleAlert,
  Footprints,
  ShieldCheck,
} from "lucide-react";
import type { FlagshipCompetencyEvidenceViewV3 } from "../assessment-v3";
import { StudentLearnerGrowthPanelV3 } from "./student-learner-growth-v3";

function sourceKindLabel(
  kind: FlagshipCompetencyEvidenceViewV3["evidenceEpisodes"][number]["sourceKind"],
): string {
  if (kind === "artifact_revision") return "作品版本";
  if (kind === "real_student_action") return "你的现场行动";
  if (kind === "teacher_decision") return "教师决定";
  return "世界后果";
}

export function StudentFlagshipAssessmentSurface({
  view,
  bindingId,
  navigate,
}: {
  view: FlagshipCompetencyEvidenceViewV3;
  bindingId?: string;
  navigate(path: string): void;
}) {
  const decision = view.assessment;
  const criteria = new Map(view.criteria.map(
    (criterion) => [criterion.competencyClaimId, criterion],
  ));
  const insufficient = decision.scoreStatus === "insufficient_evidence";
  const final = decision.scoreStatus === "final";
  const scaffoldedEpisodes = view.evidenceEpisodes.filter((episode) => (
    episode.observations.some((observation) => observation.scaffoldingLevel > 0)
  )).length;
  return (
    <main className="v2-simple-page v3-student-assessment-page">
      <button type="button" className="v2-page-back" onClick={() => navigate("/student/portfolio")}>
        <ArrowLeft size={16} />作品与证据
      </button>
      <header className="v3-student-assessment-hero">
        <div>
          <span className="v2-page-kicker">泉州蟳埔旗舰世界 · 岗位成长回放</span>
          <h1>{final ? "本轮岗位能力评价" : "你的能力证据正在形成"}</h1>
          <p>系统只记录你真正写过、问过、核查过和修订过的内容；完成进度不会自动换算成能力分。</p>
        </div>
        {insufficient ? (
          <div className="v3-student-score blocked"><CircleAlert /><strong>暂不出分</strong><small>证据不足</small></div>
        ) : (
          <div className={`v3-student-score ${final ? "final" : "provisional"}`}>
            {final ? <BadgeCheck /> : <BookOpenCheck />}
            <strong>{decision.sessionScore}</strong>
            <small>{final ? "教师最终评价" : "系统暂定，等待教师"}</small>
          </div>
        )}
      </header>

      <section className="v3-student-assessment-notice" role="note">
        <ShieldCheck />
        <p>{decision.growthSummary}</p>
        <b>挑战 {decision.challengeLevel} 级 · 本局上限 {decision.scoreCeiling}</b>
      </section>

      <section className="v3-student-dimensions">
        {decision.competencyEstimates.map((estimate) => {
          const criterion = criteria.get(estimate.competencyClaimId);
          return (
            <article key={estimate.competencyClaimId} className={estimate.evidenceStatus}>
              <header>
                <div><span>{criterion?.weight ?? 0}%</span><h2>{criterion?.title ?? estimate.competencyClaimId}</h2></div>
                <b>{estimate.score === null ? "继续积累证据" : `${estimate.score} · L${estimate.competencyLevel}`}</b>
              </header>
              <p>{estimate.rationale}</p>
              <small>{estimate.evidenceEpisodeRefs.length} 个已采用证据 Episode</small>
            </article>
          );
        })}
      </section>

      <section className="v3-student-evidence-story">
        <header>
          <div><Footprints /><span><strong>你的真实成长轨迹</strong><small>共 {view.evidenceEpisodes.length} 个证据 Episode，{scaffoldedEpisodes} 个记录了支架强度</small></span></div>
        </header>
        {view.evidenceEpisodes.length === 0 ? (
          <div className="v3-student-evidence-empty">
            <p>还没有可评价的真实行动。返回现场完成一次采访、核查或作品修订后，这里才会出现记录。</p>
          </div>
        ) : (
          <div className="v3-student-evidence-list">
            {view.evidenceEpisodes.slice(-6).reverse().map((episode) => (
              <article key={episode.evidenceEpisodeId}>
                <span>{sourceKindLabel(episode.sourceKind)}</span>
                <div>
                  <strong>{episode.observations[0]?.observableBehavior}</strong>
                  <small>{new Date(episode.collectedAt).toLocaleString("zh-CN")}</small>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {bindingId ? (
        <StudentLearnerGrowthPanelV3
          sessionId={decision.sessionId}
          bindingId={bindingId}
          assessmentDecisionId={decision.assessmentDecisionId}
        />
      ) : null}

      <footer className="v3-student-assessment-next">
        <div>
          <strong>{final ? "把本轮方法带到下一场" : "下一步：补齐最薄弱的真实证据"}</strong>
          <p>{decision.nextGrowthTargets.map((claimId) => (
            criteria.get(claimId)?.title ?? claimId
          )).join("、") || "继续保持当前专业判断"}</p>
        </div>
        <button
          type="button"
          className="v2-primary-cta"
          onClick={() => navigate(final
            ? "/student/portfolio"
            : `/student/training/${encodeURIComponent(decision.sessionId)}`)}
        >
          {final ? "查看作品证据" : "返回任务现场"}<ArrowRight size={17} />
        </button>
      </footer>
    </main>
  );
}
