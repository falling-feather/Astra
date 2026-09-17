import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock3,
  FileCheck2,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
} from "lucide-react";
import { useExperienceGateway } from "../gateway";
import {
  loadStudentReview,
  OutcomeConflictError,
  submitStudentCourseForReview,
} from "../outcome-loaders";
import type { StudentReviewLoad, StudentReviewView } from "../models";
import type { FlagshipCompetencyEvidenceViewV3 } from "../assessment-v3";
import type { FlagshipEvidenceAssessmentViewV4 } from "../assessment-v4";
import { StudentFlagshipAssessmentSurface } from "./student-flagship-assessment-v3";
import { StudentEvidenceAssessmentSurfaceV4 } from "./student-evidence-assessment-v4";
import { StudentLearnerAdaptationPanelV4 } from "./student-learner-adaptation-v4";

type ReviewPageLoad =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; value: StudentReviewLoad };

type FlagshipStudentReviewLoad =
  | { state: "loading" }
  | { state: "unavailable" }
  | { state: "error"; message: string }
  | { state: "ready_v3"; view: FlagshipCompetencyEvidenceViewV3 }
  | { state: "ready_v4"; view: FlagshipEvidenceAssessmentViewV4 };

export function StudentReviewSurface({
  review,
  busy = false,
  error = null,
  onSubmit,
  navigate,
}: {
  review: StudentReviewView;
  busy?: boolean;
  error?: string | null;
  onSubmit(): void;
  navigate(path: string): void;
}) {
  const trainingPath = `/student/training/${encodeURIComponent(review.sessionId)}`;
  const isProcessAttainment = review.result?.kind === "system_process_attainment";
  return (
    <main className="v2-simple-page v2-review-page">
      <button type="button" className="v2-page-back" onClick={() => navigate("/student/portfolio")}>
        <ArrowLeft size={16} />作品与证据
      </button>
      <header>
        <div>
          <span className="v2-page-kicker">课程成果闭环</span>
          <h1>评价复盘</h1>
          <p>提交、复核与评价均来自服务端权威状态，不在浏览器生成分数。</p>
        </div>
      </header>

      <section className="v2-review-course">
        <RotateCcw />
        <div>
          <span>记者主岗</span>
          <h2>{review.course.title}</h2>
          <p>{review.course.summary}</p>
        </div>
      </section>

      {error ? <div className="v2-inline-error" role="alert">{error}</div> : null}

      {review.status === "not_submitted" ? (
        <section className="v2-review-workspace">
          <div className={`v2-review-status ${review.canSubmit ? "success" : "waiting"}`}>
            {review.canSubmit ? <FileCheck2 /> : <Clock3 />}
            <div>
              <strong>{review.canSubmit ? "成果已满足提交条件" : "课程成果尚未齐备"}</strong>
              <p>{review.canSubmit
                ? "全部小节、成果版本与证据已由服务端冻结，可提交教师复核。"
                : "继续完成当前真实任务；未达到服务端门槛前不会显示伪提交成功。"}</p>
            </div>
          </div>
          <dl className="v2-review-metrics">
            <div><dt>完成小节</dt><dd>{review.progress.completedChapterCount} / {review.progress.chapterCount}</dd></div>
            <div><dt>成果条目</dt><dd>{review.progress.portfolioItemCount}</dd></div>
            <div><dt>证据条目</dt><dd>{review.progress.evidenceCount}</dd></div>
          </dl>
          <button
            type="button"
            className="v2-primary-cta"
            disabled={busy}
            onClick={review.canSubmit ? onSubmit : () => navigate(trainingPath)}
          >
            {busy ? "正在等待权威确认" : review.canSubmit ? "提交教师复核" : "返回当前实训"}
            <ArrowRight size={17} />
          </button>
        </section>
      ) : null}

      {review.status === "awaiting_review" && review.submission ? (
        <section className="v2-review-workspace">
          <div className="v2-review-status waiting">
            <Clock3 />
            <div>
              <strong>等待教师复核</strong>
              <p>本次提交已经冻结；教师完成复核前，页面不会预估成绩。</p>
            </div>
          </div>
          <dl className="v2-review-metrics">
            <div><dt>提交成果</dt><dd>{review.submission.deliverableCount}</dd></div>
            <div><dt>作品版本</dt><dd>{review.submission.portfolioItemCount}</dd></div>
            <div><dt>冻结证据</dt><dd>{review.submission.evidenceCount}</dd></div>
            <div><dt>量规章节</dt><dd>{review.submission.rubricChapterCount}</dd></div>
          </dl>
          <button type="button" className="v2-secondary-cta" onClick={() => navigate("/student/courses")}>
            返回我的课程
          </button>
        </section>
      ) : null}

      {review.status === "completed" && review.submission && review.result ? (
        <section className="v2-review-workspace v2-review-completed">
          <div className="v2-review-score">
            {isProcessAttainment ? <ShieldAlert /> : <CheckCircle2 />}
            <div>
              <span>{isProcessAttainment
                ? "系统过程达成评估（专业复核待完成）"
                : "教师复核结果"}</span>
              <strong>{review.result.finalScore}</strong><small>/ 100</small>
            </div>
            <p>{review.result.publicSummary}</p>
          </div>
          {isProcessAttainment ? (
            <p className="v2-inline-notice" role="note">
              分值仅表示量规项和冻结过程证据覆盖，不是内容专业评分
            </p>
          ) : null}
          <div className="v2-review-dimensions">
            {review.result.dimensions.map((dimension) => (
              <article key={dimension.key}>
                <header><h3>{dimension.label}</h3><b>{dimension.score} / {dimension.maxScore}</b></header>
                <p>{dimension.feedback}</p>
                <span>{dimension.evidenceCount} 条冻结证据支撑</span>
              </article>
            ))}
          </div>
          <button type="button" className="v2-secondary-cta" onClick={() => navigate("/student/portfolio")}>
            返回作品与证据
          </button>
        </section>
      ) : null}
    </main>
  );
}

export default function StudentReviewPage({
  sessionId,
  bindingId,
  navigate,
}: {
  sessionId: string;
  bindingId: string;
  navigate(path: string): void;
}) {
  const gateway = useExperienceGateway();
  const [load, setLoad] = useState<ReviewPageLoad>({ state: "loading" });
  const [flagshipLoad, setFlagshipLoad] = useState<FlagshipStudentReviewLoad>(
    gateway.getFlagshipEvidenceAssessmentV4 || gateway.getFlagshipCompetencyEvidence
      ? { state: "loading" }
      : { state: "unavailable" },
  );
  const [flagshipRevision, setFlagshipRevision] = useState(0);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const requestIdRef = useRef<string | null>(null);
  const mutationControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const loaderV4 = gateway.getFlagshipEvidenceAssessmentV4;
    const loaderV3 = gateway.getFlagshipCompetencyEvidence;
    if (!loaderV4 && !loaderV3) {
      setFlagshipLoad({ state: "unavailable" });
      return undefined;
    }
    const controller = new AbortController();
    setFlagshipLoad({ state: "loading" });
    const load = async () => {
      const descriptor = await gateway.getSessionExperienceDescriptor(
        sessionId,
        bindingId,
        controller.signal,
      );
      if (descriptor.experienceGeneration === "standard_v2") {
        return { state: "unavailable" as const };
      }
      if (descriptor.experienceGeneration === "flagship_v4") {
        if (!loaderV4) throw new Error("客户端缺少描述符要求的 V4 评价端口");
        return {
          state: "ready_v4" as const,
          view: await loaderV4(sessionId, bindingId, controller.signal),
        };
      }
      if (!loaderV3) throw new Error("客户端缺少描述符要求的 V3 评价端口");
      return {
        state: "ready_v3" as const,
        view: await loaderV3(sessionId, bindingId, controller.signal),
      };
    };
    load().then((next) => {
      if (!controller.signal.aborted) setFlagshipLoad(next);
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      setFlagshipLoad({
        state: "error",
        message: cause instanceof Error ? cause.message : "无法读取岗位能力证据",
      });
    });
    return () => controller.abort();
  }, [bindingId, flagshipRevision, gateway, sessionId]);

  useEffect(() => {
    if (flagshipLoad.state !== "unavailable") return undefined;
    const controller = new AbortController();
    setLoad({ state: "loading" });
    setMutationError(null);
    loadStudentReview(gateway, sessionId, bindingId, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setLoad({ state: "ready", value });
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setLoad({
            state: "error",
            message: cause instanceof Error ? cause.message : "无法读取评价复盘",
          });
        }
      });
    return () => {
      controller.abort();
      mutationControllerRef.current?.abort();
    };
  }, [bindingId, flagshipLoad.state, gateway, revision, sessionId]);

  if (flagshipLoad.state === "loading") {
    return <div className="v2-centered-state v2-full-state"><LoaderCircle className="spin" />正在汇集你的真实能力证据</div>;
  }
  if (flagshipLoad.state === "error") {
    return (
      <div className="v2-centered-state v2-full-state" role="alert">
        <p>{flagshipLoad.message}</p>
        <button type="button" onClick={() => setFlagshipRevision((value) => value + 1)}>
          <RefreshCw size={16} />重试
        </button>
      </div>
    );
  }
  if (flagshipLoad.state === "ready_v4") {
    return (
      <div className="v4-review-stack">
        <StudentEvidenceAssessmentSurfaceV4
          view={flagshipLoad.view}
          sessionId={sessionId}
          navigate={navigate}
          onRetry={gateway.retryFlagshipEvidenceAssessmentV4?async()=>setFlagshipLoad({state:'ready_v4',view:await gateway.retryFlagshipEvidenceAssessmentV4!(sessionId,bindingId,globalThis.crypto.randomUUID())}):undefined}
        />
        {flagshipLoad.view.status === "final" ? (
          <StudentLearnerAdaptationPanelV4
            sessionId={sessionId}
            bindingId={bindingId}
            navigate={navigate}
          />
        ) : null}
      </div>
    );
  }
  if (flagshipLoad.state === "ready_v3") {
    return (
      <StudentFlagshipAssessmentSurface
        view={flagshipLoad.view}
        bindingId={bindingId}
        navigate={navigate}
      />
    );
  }

  if (load.state === "loading") {
    return <div className="v2-centered-state v2-full-state"><LoaderCircle className="spin" />正在确认复盘权限</div>;
  }
  if (load.state === "error") {
    return (
      <div className="v2-centered-state v2-full-state" role="alert">
        <p>{load.message}</p>
        <button type="button" onClick={() => setRevision((value) => value + 1)}>
          <RefreshCw size={16} />重试
        </button>
      </div>
    );
  }
  if (load.value.state === "unavailable") {
    return (
      <main className="v2-simple-page">
        <section className="v2-light-empty v2-outcome-empty">
          <ShieldAlert size={48} />
          <h1>无法查看该复盘</h1>
          <p>当前账号没有认领对应课程，因此页面没有请求或显示复核内容。</p>
          <button type="button" className="v2-primary-cta" onClick={() => navigate("/student/courses")}>
            返回我的课程
          </button>
        </section>
      </main>
    );
  }

  const review = load.value.review;
  return (
    <StudentReviewSurface
      review={review}
      busy={busy}
      error={mutationError}
      navigate={navigate}
      onSubmit={() => {
        if (busy) return;
        const requestId = requestIdRef.current ?? globalThis.crypto.randomUUID();
        requestIdRef.current = requestId;
        const controller = new AbortController();
        mutationControllerRef.current = controller;
        setBusy(true);
        setMutationError(null);
        void submitStudentCourseForReview(
          gateway,
          review,
          requestId,
          controller.signal,
        ).then((confirmed) => {
          requestIdRef.current = null;
          setLoad({ state: "ready", value: { state: "ready", review: confirmed } });
        }).catch((cause: unknown) => {
          if (cause instanceof OutcomeConflictError) {
            setLoad({ state: "ready", value: cause.latest });
          }
          if (!controller.signal.aborted) {
            setMutationError(cause instanceof Error ? cause.message : "成果提交失败");
          }
        }).finally(() => {
          if (!controller.signal.aborted) setBusy(false);
          if (mutationControllerRef.current === controller) {
            mutationControllerRef.current = null;
          }
        });
      }}
    />
  );
}
