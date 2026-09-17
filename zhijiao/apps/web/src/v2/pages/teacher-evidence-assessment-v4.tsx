import { useEffect, useMemo, useState } from "react";
import { LearningObservations } from "./learning-observations";
import {
  CheckCircle2,
  ClipboardCheck,
  FileWarning,
  ShieldCheck,
} from "lucide-react";
import type { AssessmentCriterionIdV4 } from "@ronggang/contracts";
import type {
  FlagshipEvidenceAssessmentViewV4,
  ReviewFlagshipAssessmentInputV4,
} from "../assessment-v4";

type ReviewDraft = Omit<
  ReviewFlagshipAssessmentInputV4,
  "sessionId" | "bindingId" | "expectedAssessmentDecisionId" | "requestId"
>;

type CriterionDraft = {
  band: "low" | "medium" | "high";
  score: string;
  rationale: string;
};

function defaultDrafts(view: FlagshipEvidenceAssessmentViewV4) {
  return Object.fromEntries(view.criteria.map((criterion) => [
    criterion.criterionId,
    {
      band: criterion.band ?? "medium",
      score: criterion.score===null?'':String(criterion.score),
      rationale: "",
    },
  ])) as Record<AssessmentCriterionIdV4, CriterionDraft>;
}

function scoreMatchesBand(score: number, band: CriterionDraft["band"]): boolean {
  if (band === "low") return score < 60;
  if (band === "medium") return score >= 60 && score < 80;
  return score >= 80;
}

export function TeacherEvidenceAssessmentSurfaceV4({
  view,
  busy,
  error,
  onReview,
}: {
  view: FlagshipEvidenceAssessmentViewV4;
  busy: boolean;
  error: string | null;
  onReview(review: ReviewDraft): void;
}) {
  const workPending=view.assessmentBasis==='submitted_work'&&view.status==='insufficient_evidence';
  const [mode, setMode] = useState<"confirmed" | "revised">(workPending?'revised':'confirmed');
  const [applicabilityConfirmed, setApplicabilityConfirmed] = useState(false);
  const [reason, setReason] = useState("");
  const [selected, setSelected] = useState<AssessmentCriterionIdV4[]>(workPending?view.criteria.map(item=>item.criterionId):[]);
  const [drafts, setDrafts] = useState(() => defaultDrafts(view));
  const decisionId = view.decision?.assessmentDecisionId ?? "not-ready";

  useEffect(() => {
    setMode(workPending?'revised':'confirmed');
    setApplicabilityConfirmed(false);
    setReason("");
    setSelected(workPending?view.criteria.map(item=>item.criterionId):[]);
    setDrafts(defaultDrafts(view));
  }, [decisionId, view,workPending]);

  const revisions = useMemo(() => selected.map((criterionId) => {
    const draft = drafts[criterionId];
    return {
      criterionId,
      band: draft.band,
      score: Number(draft.score),
      rationale: draft.rationale.trim(),
    };
  }), [drafts, selected]);
  const revisionsValid = mode === "confirmed" || (
    revisions.length > 0 && (!workPending||revisions.length===6) && revisions.every((revision) => (
      drafts[revision.criterionId].score.trim()!==''
      &&
      Number.isFinite(revision.score)
      && revision.score >= 0
      && revision.score <= 100
      && revision.rationale.length >= 8
      && scoreMatchesBand(revision.score, revision.band)
    ))
  );
  const canSubmit = view.teacherReviewAllowed
    && applicabilityConfirmed
    && reason.trim().length >= 8
    && revisionsValid
    && !busy;

  if (view.status === "not_ready") {
    return (
      <main className="v2-teacher-page v4-assessment-page">
        <LearningObservations observations={view.learningObservations ?? []} />
        <section className="v2-teacher-compact-empty">
          <FileWarning />
          <h1>还没有可终裁的岗位证据</h1>
          <p>{view.safeMessage}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="v2-teacher-page v4-assessment-page">
      <header className="v2-teacher-page-heading v4-teacher-assessment-heading">
        <div>
          <span>六维岗位证据终裁</span>
          <h1>{view.status === "final" ? "本班终裁已固定" : "请核对证据，不要核对文风"}</h1>
          <p>{view.safeMessage}</p>
        </div>
        <div className={`v4-assessment-score status-${view.status}`}>
          <strong>{view.decision?.sessionScore ?? "—"}</strong>
          <span>{view.decision?.sessionScore === null ? "证据不足" : "/ 100"}</span>
        </div>
      </header>

      <section className="v4-assessment-principle" role="note">
        <ShieldCheck />
        <div>
          <strong>教师只能在同一证据集合上终裁</strong>
          <p>可以确认或逐维修订，但不能从浏览器新增证据、补造分数或让 AI 建议给自己打分。挑战等级只在盲评完成后施加分数上限。</p>
        </div>
      </section>

      {error ? <div className="v2-inline-error" role="alert">{error}</div> : null}

      <LearningObservations observations={view.learningObservations ?? []} />
      <section className="v4-criterion-grid v4-teacher-criterion-grid">
        {view.criteria.map((criterion) => {
          const isSelected = selected.includes(criterion.criterionId);
          const draft = drafts[criterion.criterionId];
          return (
            <article key={criterion.criterionId} className={`v4-criterion-card status-${criterion.evidenceStatus}`}>
              <header>
                <ClipboardCheck />
                <div><h2>{criterion.title}</h2><span>{criterion.evidenceStatus}</span></div>
                <b>{criterion.score ?? "—"}</b>
              </header>
              <p>{criterion.rationale}</p>
              {view.teacherReviewAllowed && mode === "revised" && (criterion.score !== null||workPending) ? (
                <div className="v4-criterion-revision">
                  <label className="v4-review-checkbox">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={workPending}
                      onChange={(event) => setSelected((current) => event.target.checked
                        ? [...current, criterion.criterionId]
                        : current.filter((item) => item !== criterion.criterionId))}
                    />
                    修订此维度
                  </label>
                  {isSelected ? (
                    <div className="v4-revision-fields">
                      <label>能力档位
                        <select
                          value={draft.band}
                          onChange={(event) => setDrafts((current) => ({
                            ...current,
                            [criterion.criterionId]: {
                              ...current[criterion.criterionId],
                              band: event.target.value as CriterionDraft["band"],
                            },
                          }))}
                        >
                          <option value="low">需重点改进</option>
                          <option value="medium">岗位基础</option>
                          <option value="high">较强能力</option>
                        </select>
                      </label>
                      <label>分数
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={draft.score}
                          onChange={(event) => setDrafts((current) => ({
                            ...current,
                            [criterion.criterionId]: {
                              ...current[criterion.criterionId],
                              score: event.target.value,
                            },
                          }))}
                        />
                      </label>
                      <label className="wide">修订依据
                        <textarea
                          value={draft.rationale}
                          onChange={(event) => setDrafts((current) => ({
                            ...current,
                            [criterion.criterionId]: {
                              ...current[criterion.criterionId],
                              rationale: event.target.value,
                            },
                          }))}
                          placeholder="只能引用卡片中的同一组岗位证据，至少 8 个字"
                        />
                      </label>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </article>
          );
        })}
      </section>

      {view.teacherReviewAllowed ? (
        <section className="v4-teacher-review-panel">
          <header>
            <div>
              <h2>课程教师终裁</h2>
              <p>这一步确认本班、本次课程的量规适用性，不等于外部专业教师或专家效度认证。</p>
            </div>
            {view.status !== "insufficient_evidence" || workPending ? (
              <div className="v4-review-mode" role="group" aria-label="终裁方式">
                {!workPending?<button type="button" className={mode === "confirmed" ? "active" : ""} onClick={() => setMode("confirmed")}>确认原判</button>:null}
                <button type="button" className={mode === "revised" ? "active" : ""} onClick={() => setMode("revised")}>{workPending?'逐维评阅':'逐维修订'}</button>
              </div>
            ) : null}
          </header>
          <label className="v4-review-checkbox important">
            <input
              type="checkbox"
              checked={applicabilityConfirmed}
              onChange={(event) => setApplicabilityConfirmed(event.target.checked)}
            />
            我已逐维核对同一组盲化证据，并确认该量规适用于本班本次训练；我知晓这不代表外部专家效度已经建立。
          </label>
          <label className="v4-review-reason">终裁理由
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="说明你核对了哪些岗位证据，以及为什么维持或修订判断（至少 8 个字）"
            />
          </label>
          <button
            type="button"
            className="v2-primary-cta"
            disabled={!canSubmit}
            onClick={() => onReview({
              status: view.status === "insufficient_evidence" && !workPending ? "confirmed" : mode,
              rubricApplicabilityConfirmed: true,
              reason: reason.trim(),
              criterionRevisions: mode === "revised" ? revisions : [],
            })}
          >
            {busy ? "正在固定终裁" : "固定本班终裁"}
          </button>
        </section>
      ) : (
        <section className="v4-assessment-footer">
          <div><strong><CheckCircle2 />终裁已固定</strong><p>{view.decision?.teacherReview.rationale}</p></div>
          <span>外部专家效度：尚未建立</span>
        </section>
      )}
    </main>
  );
}
