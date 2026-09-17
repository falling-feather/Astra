import { useEffect, useMemo, useState } from "react";
import {
  BadgeCheck,
  CircleAlert,
  ClipboardCheck,
  Gauge,
  ShieldCheck,
} from "lucide-react";
import type {
  FlagshipCompetencyEvidenceViewV3,
  ReviewFlagshipAssessmentInputV3,
} from "../assessment-v3";
import type { TeacherGateway } from "../teacher-gateway";
import { TeacherLearnerGrowthPanelV3 } from "./teacher-learner-growth-v3";

type CriterionDraft = {
  mode: "confirm" | "revise";
  score: string;
  competencyLevel: string;
  rationale: string;
};

function draftsFor(
  estimates: FlagshipCompetencyEvidenceViewV3["assessment"]["competencyEstimates"],
): Record<string, CriterionDraft> {
  return Object.fromEntries(estimates.map((estimate) => [
    estimate.competencyClaimId,
    {
      mode: "confirm" as const,
      score: estimate.score?.toString() ?? "",
      competencyLevel: estimate.competencyLevel?.toString() ?? "",
      rationale: estimate.rationale,
    },
  ]));
}

function evidenceCount(
  view: FlagshipCompetencyEvidenceViewV3,
  competencyClaimId: string,
): number {
  return view.evidenceEpisodes.filter((episode) => (
    episode.observations.some((observation) => (
      observation.competencyClaimId === competencyClaimId
        && observation.direction !== "insufficient"
    ))
  )).length;
}

function scoreStatusLabel(
  status: FlagshipCompetencyEvidenceViewV3["assessment"]["scoreStatus"],
): string {
  if (status === "final") return "教师最终评价";
  if (status === "provisional") return "系统暂定 · 等待教师复核";
  return "证据不足 · 不出分";
}

export function TeacherFlagshipAssessmentSurface({
  view,
  gateway,
  bindingId,
  busy,
  error,
  onReview,
}: {
  view: FlagshipCompetencyEvidenceViewV3;
  gateway?: TeacherGateway;
  bindingId?: string;
  busy: boolean;
  error: string | null;
  onReview(input: Omit<
    ReviewFlagshipAssessmentInputV3,
    "sessionId" | "bindingId" | "expectedAssessmentDecisionId" | "requestId"
  >): void;
}) {
  const decision = view.assessment;
  const criteriaById = useMemo(() => new Map(
    view.criteria.map((criterion) => [criterion.competencyClaimId, criterion]),
  ), [view.criteria]);
  const [reason, setReason] = useState(
    "已逐项核对真实作品、现场行动与世界后果，确认本轮岗位能力评价。",
  );
  const [drafts, setDrafts] = useState<Record<string, CriterionDraft>>(
    () => draftsFor(decision.competencyEstimates),
  );
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    setDrafts(draftsFor(decision.competencyEstimates));
    setLocalError(null);
  }, [decision.assessmentDecisionId, decision.competencyEstimates]);

  const reviewed = decision.teacherReview.status !== "pending";
  const submit = () => {
    const competencyRevisions = decision.competencyEstimates.flatMap((estimate) => {
      const draft = drafts[estimate.competencyClaimId];
      if (!draft || draft.mode !== "revise") return [];
      const score = Number(draft.score);
      const competencyLevel = Number(draft.competencyLevel);
      if (!Number.isFinite(score) || score < 0 || score > 100
        || !Number.isInteger(competencyLevel)
        || competencyLevel < 1 || competencyLevel > 5
        || draft.rationale.trim().length < 8) {
        setLocalError("每个修订维度都必须填写 0—100 分、1—5 级和至少 8 字依据。");
        return null;
      }
      return [{
        competencyClaimId: estimate.competencyClaimId,
        score,
        competencyLevel,
        rationale: draft.rationale.trim(),
      }];
    });
    if (competencyRevisions.includes(null)) return;
    if (reason.trim().length < 8) {
      setLocalError("请填写至少 8 字的本轮复核总理由。");
      return;
    }
    setLocalError(null);
    const revisions = competencyRevisions.filter(
      (item): item is NonNullable<typeof item> => item !== null,
    );
    onReview({
      status: revisions.length > 0 ? "revised" : "confirmed",
      reason: reason.trim(),
      competencyRevisions: revisions,
    });
  };

  return (
    <main className="v2-teacher-page v3-assessment-page">
      <header className="v2-teacher-page-heading v3-assessment-heading">
        <div>
          <span>岗位能力证据中心</span>
          <h1>教师逐维复核</h1>
          <p>完成任务与能力得分严格分离；只依据作品版本、学生决定、教师门和世界后果作判断。</p>
        </div>
        <div className={`v3-assessment-score status-${decision.scoreStatus}`}>
          <span>{scoreStatusLabel(decision.scoreStatus)}</span>
          <strong>{decision.sessionScore ?? "—"}</strong>
          <small>本局上限 {decision.scoreCeiling}</small>
        </div>
      </header>

      <section className="v3-assessment-boundary" role="note">
        <ShieldCheck />
        <div>
          <strong>评价边界已冻结</strong>
          <p>盲评端口看不到学生身份、挑战等级或智能体建议；挑战修正发生在盲评之后，量规仍标记为“待专家复核”。</p>
        </div>
        <b>挑战 {decision.challengeLevel} 级</b>
      </section>

      {(error || localError) ? (
        <div className="v2-inline-error" role="alert">{localError ?? error}</div>
      ) : null}

      <section className="v3-assessment-grid">
        {decision.competencyEstimates.map((estimate) => {
          const criterion = criteriaById.get(estimate.competencyClaimId);
          const count = evidenceCount(view, estimate.competencyClaimId);
          const draft = drafts[estimate.competencyClaimId];
          const insufficient = estimate.evidenceStatus === "insufficient";
          return (
            <article
              key={estimate.competencyClaimId}
              className={`v3-assessment-dimension ${insufficient ? "insufficient" : "scored"}`}
            >
              <header>
                <div>
                  {insufficient ? <CircleAlert /> : <Gauge />}
                  <span>
                    <small>{criterion?.weight ?? 0}% 权重</small>
                    <h2>{criterion?.title ?? estimate.competencyClaimId}</h2>
                  </span>
                </div>
                <b>{estimate.score === null ? "不出分" : `${estimate.score} 分 · L${estimate.competencyLevel}`}</b>
              </header>
              <p>{estimate.rationale}</p>
              <dl>
                <div><dt>有效独立证据</dt><dd>{count} / {criterion?.minimumIndependentEvidenceCount ?? 0}</dd></div>
                <div><dt>判断置信度</dt><dd>{Math.round(estimate.confidence * 100)}%</dd></div>
              </dl>
              {!reviewed && !insufficient && draft ? (
                <fieldset>
                  <legend>本维度教师决定</legend>
                  <select
                    aria-label={`${criterion?.title ?? estimate.competencyClaimId}教师决定`}
                    value={draft.mode}
                    onChange={(event) => setDrafts((current) => ({
                      ...current,
                      [estimate.competencyClaimId]: {
                        ...draft,
                        mode: event.target.value as CriterionDraft["mode"],
                      },
                    }))}
                  >
                    <option value="confirm">确认系统暂定判断</option>
                    <option value="revise">依据证据修订</option>
                  </select>
                  {draft.mode === "revise" ? (
                    <div className="v3-assessment-revision-fields">
                      <label>分数<input value={draft.score} inputMode="numeric" onChange={(event) => setDrafts((current) => ({ ...current, [estimate.competencyClaimId]: { ...draft, score: event.target.value } }))} /></label>
                      <label>等级<input value={draft.competencyLevel} inputMode="numeric" onChange={(event) => setDrafts((current) => ({ ...current, [estimate.competencyClaimId]: { ...draft, competencyLevel: event.target.value } }))} /></label>
                      <label>修订依据<textarea value={draft.rationale} onChange={(event) => setDrafts((current) => ({ ...current, [estimate.competencyClaimId]: { ...draft, rationale: event.target.value } }))} /></label>
                    </div>
                  ) : null}
                </fieldset>
              ) : null}
            </article>
          );
        })}
      </section>

      {!reviewed ? (
        <section className="v3-assessment-review-bar">
          <ClipboardCheck />
          <label>
            <span>本轮复核总理由</span>
            <textarea value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>
          <button type="button" className="v2-primary-cta" disabled={busy} onClick={submit}>
            {busy ? "正在保存教师决定" : decision.scoreStatus === "insufficient_evidence"
              ? "确认证据不足（不出分）"
              : "逐维确认并形成最终评价"}
          </button>
        </section>
      ) : (
        <section className="v3-assessment-reviewed">
          <BadgeCheck />
          <div><strong>教师复核已固定</strong><p>{decision.teacherReview.reason}</p></div>
        </section>
      )}

      {gateway && bindingId ? (
        <TeacherLearnerGrowthPanelV3
          gateway={gateway}
          sessionId={decision.sessionId}
          bindingId={bindingId}
          assessmentDecisionId={decision.assessmentDecisionId}
        />
      ) : null}
    </main>
  );
}
