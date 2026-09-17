import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  FileClock,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import type { TeacherGateway } from "../teacher-gateway";
import { GatewayHttpError } from "../gateway";
import {
  finalizeTeacherReview,
  loadTeacherReviewSelection,
  TeacherOutcomeConflictError,
  type TeacherReviewSelection,
} from "../teacher-outcome-loaders";
import type { TeacherReviewWorkspaceView } from "../teacher-models";
import type { FlagshipCompetencyEvidenceViewV3 } from "../assessment-v3";
import type { FlagshipEvidenceAssessmentViewV4 } from "../assessment-v4";
import { TeacherFlagshipAssessmentSurface } from "./teacher-flagship-assessment-v3";
import { TeacherEvidenceAssessmentSurfaceV4 } from "./teacher-evidence-assessment-v4";
import { TeacherLearnerAdaptationPanelV4 } from "./teacher-learner-adaptation-v4";

type TeacherReviewLoad =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; selection: TeacherReviewSelection };

type FlagshipReviewLoad =
  | { state: "loading" }
  | { state: "unavailable" }
  | { state: "error"; message: string }
  | { state: "ready_v3"; view: FlagshipCompetencyEvidenceViewV3 }
  | { state: "ready_v4"; view: FlagshipEvidenceAssessmentViewV4 };

export function TeacherReviewWorkspaceSurface({
  workspace,
  busy = false,
  error = null,
  onFinalize,
}: {
  workspace: TeacherReviewWorkspaceView;
  busy?: boolean;
  error?: string | null;
  onFinalize(): void;
}) {
  const isProcessAttainment = workspace.result?.kind === "system_process_attainment";
  return (
    <section className="v2-teacher-review-workspace">
      <header>
        <div>
          <span>{workspace.task.learnerLabel}</span>
          <h2>{workspace.task.courseTitle}</h2>
          <p>依据冻结成果、作品版本与证据完成课程复核。</p>
        </div>
        <b className={workspace.status === "completed" ? "done" : "waiting"}>
          {workspace.status === "completed" ? "已完成复核" : "等待复核"}
        </b>
      </header>
      {error ? <div className="v2-inline-error" role="alert">{error}</div> : null}
      <dl className="v2-review-metrics">
        <div><dt>提交成果</dt><dd>{workspace.submission.deliverableCount}</dd></div>
        <div><dt>作品版本</dt><dd>{workspace.submission.portfolioItemCount}</dd></div>
        <div><dt>冻结证据</dt><dd>{workspace.submission.evidenceCount}</dd></div>
        <div><dt>量规章节</dt><dd>{workspace.submission.rubricChapterCount}</dd></div>
      </dl>

      {workspace.status === "awaiting_review" ? (
        <div className="v2-teacher-review-decision">
          <ClipboardCheck size={30} />
          <div>
            <h3>确认过程评估并归档</h3>
            <p>平台将按冻结量规与证据归档系统过程达成评估；该结果不替代教师或专家内容评分。浏览器不传分数、评语或学员身份。</p>
          </div>
          <button
            type="button"
            className="v2-primary-cta"
            disabled={busy}
            onClick={onFinalize}
          >
            {busy ? "正在确认过程评估" : "确认过程评估并归档"}<ArrowRight size={17} />
          </button>
        </div>
      ) : null}

      {workspace.status === "completed" && workspace.result ? (
        <div className="v2-teacher-review-result">
          <div className="v2-review-score">
            {isProcessAttainment ? <FileClock /> : <CheckCircle2 />}
            <div>
              <span>{isProcessAttainment
                ? "系统过程达成评估（专业复核待完成）"
                : "教师复核结果"}</span>
              <strong>{workspace.result.finalScore}</strong><small>/ 100</small>
            </div>
            <p>{workspace.result.publicSummary}</p>
          </div>
          {isProcessAttainment ? (
            <p className="v2-inline-notice" role="note">
              分值仅表示量规项和冻结过程证据覆盖，不是内容专业评分
            </p>
          ) : null}
          <div className="v2-review-dimensions">
            {workspace.result.dimensions.map((dimension) => (
              <article key={dimension.key}>
                <header><h3>{dimension.label}</h3><b>{dimension.score} / {dimension.maxScore}</b></header>
                <p>{dimension.feedback}</p>
                <span>{dimension.evidenceCount} 条冻结证据支撑</span>
              </article>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

export default function TeacherReviewsPage({
  gateway,
  sessionId,
  bindingId,
  navigate,
}: {
  gateway: TeacherGateway;
  sessionId: string;
  bindingId: string;
  navigate(path: string): void;
}) {
  const [load, setLoad] = useState<TeacherReviewLoad>({ state: "loading" });
  const [flagshipLoad, setFlagshipLoad] = useState<FlagshipReviewLoad>(
    gateway.getFlagshipEvidenceAssessmentV4 || gateway.getFlagshipCompetencyEvidence
      ? { state: "loading" }
      : { state: "unavailable" },
  );
  const [flagshipRevision, setFlagshipRevision] = useState(0);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
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
    loadTeacherReviewSelection(
      gateway,
      sessionId,
      bindingId,
      selectedTaskId,
      controller.signal,
    ).then((selection) => {
      if (!controller.signal.aborted) setLoad({ state: "ready", selection });
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) {
        setLoad({
          state: "error",
          message: cause instanceof Error ? cause.message : "无法读取课程复核任务",
        });
      }
    });
    return () => {
      controller.abort();
      mutationControllerRef.current?.abort();
    };
  }, [bindingId, flagshipLoad.state, gateway, revision, selectedTaskId, sessionId]);

  if (flagshipLoad.state === "loading") {
    return <div className="v2-centered-state v2-full-state"><LoaderCircle className="spin" />正在汇集岗位能力证据</div>;
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
        <TeacherEvidenceAssessmentSurfaceV4
          view={flagshipLoad.view}
          busy={busy}
          error={mutationError}
          onReview={(review) => {
            const mutate = gateway.reviewFlagshipEvidenceAssessmentV4;
            const decision = flagshipLoad.view.decision;
            if (!mutate || !decision || busy) return;
            const requestId = requestIdRef.current ?? globalThis.crypto.randomUUID();
            requestIdRef.current = requestId;
            const controller = new AbortController();
            mutationControllerRef.current = controller;
            setBusy(true);
            setMutationError(null);
            void mutate({
              sessionId,
              bindingId,
              expectedAssessmentDecisionId: decision.assessmentDecisionId,
              requestId,
              ...review,
            }, controller.signal).then((view) => {
              requestIdRef.current = null;
              setFlagshipLoad({ state: "ready_v4", view });
            }).catch((cause: unknown) => {
              if (!controller.signal.aborted) {
                setMutationError(cause instanceof Error
                  ? cause.message
                  : "教师证据评价终裁失败");
                if (cause instanceof GatewayHttpError && cause.status === 409) {
                  setFlagshipRevision((value) => value + 1);
                }
              }
            }).finally(() => {
              if (!controller.signal.aborted) setBusy(false);
              if (mutationControllerRef.current === controller) {
                mutationControllerRef.current = null;
              }
            });
          }}
        />
        {flagshipLoad.view.status === "final" ? (
          <TeacherLearnerAdaptationPanelV4
            gateway={gateway}
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
      <TeacherFlagshipAssessmentSurface
        view={flagshipLoad.view}
        gateway={gateway}
        bindingId={bindingId}
        busy={busy}
        error={mutationError}
        onReview={(review) => {
          const mutate = gateway.reviewFlagshipAssessment;
          if (!mutate || busy) return;
          const requestId = requestIdRef.current ?? globalThis.crypto.randomUUID();
          requestIdRef.current = requestId;
          const controller = new AbortController();
          mutationControllerRef.current = controller;
          setBusy(true);
          setMutationError(null);
          void mutate({
            sessionId,
            bindingId,
            expectedAssessmentDecisionId:
              flagshipLoad.view.assessment.assessmentDecisionId,
            requestId,
            ...review,
          }, controller.signal).then((view) => {
            requestIdRef.current = null;
            setFlagshipLoad({ state: "ready_v3", view });
          }).catch((cause: unknown) => {
            if (!controller.signal.aborted) {
              setMutationError(cause instanceof Error
                ? cause.message
                : "教师能力评价复核失败");
              if (cause instanceof GatewayHttpError && cause.status === 409) {
                setFlagshipRevision((value) => value + 1);
              }
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

  return (
    <main className="v2-teacher-page v2-teacher-review-page">
      <header className="v2-teacher-page-heading">
        <div>
          <h1>评价复盘</h1>
          <p>从服务端签发任务选择学员，以冻结成果与证据完成权威复核。</p>
        </div>
      </header>

      {load.state === "loading" ? (
        <div className="v2-centered-state"><LoaderCircle className="spin" />正在读取复核任务</div>
      ) : null}
      {load.state === "error" ? (
        <div className="v2-centered-state" role="alert">
          <p>{load.message}</p>
          <button type="button" onClick={() => setRevision((value) => value + 1)}>
            <RefreshCw size={16} />重试
          </button>
        </div>
      ) : null}
      {load.state === "ready" && load.selection.queue.tasks.length === 0 ? (
        <section className="v2-teacher-compact-empty">
          <FileClock />
          <h2>暂时没有待复核成果</h2>
          <p>学生提交成果后，服务端会在这里签发匿名复核任务。</p>
          <button
            type="button"
            onClick={() => navigate(`/teacher/director/${encodeURIComponent(sessionId)}`)}
          >
            返回课堂导演<ArrowRight size={16} />
          </button>
        </section>
      ) : null}
      {load.state === "ready" && load.selection.queue.tasks.length > 0 ? (
        <div className="v2-teacher-review-layout">
          <aside className="v2-teacher-review-queue" aria-label="课程复核任务">
            <header><h2>复核队列</h2><span>{load.selection.queue.tasks.length} 项</span></header>
            {load.selection.queue.tasks.map((task) => (
              <button
                key={task.reviewTaskId}
                type="button"
                className={load.selection.workspace?.task.reviewTaskId === task.reviewTaskId ? "active" : ""}
                onClick={() => setSelectedTaskId(task.reviewTaskId)}
              >
                {task.status === "completed" ? <CheckCircle2 /> : <Clock3 />}
                <span><strong>{task.learnerLabel}</strong><small>{task.courseTitle}</small></span>
                <b>{task.status === "completed" ? "已完成" : "待复核"}</b>
              </button>
            ))}
          </aside>
          {load.selection.workspace ? (
            <TeacherReviewWorkspaceSurface
              workspace={load.selection.workspace}
              busy={busy}
              error={mutationError}
              onFinalize={() => {
                if (busy || !load.selection.workspace) return;
                const requestId = requestIdRef.current ?? globalThis.crypto.randomUUID();
                requestIdRef.current = requestId;
                const controller = new AbortController();
                mutationControllerRef.current = controller;
                setBusy(true);
                setMutationError(null);
                void finalizeTeacherReview(
                  gateway,
                  sessionId,
                  bindingId,
                  load.selection.workspace,
                  requestId,
                  controller.signal,
                ).then((selection) => {
                  requestIdRef.current = null;
                  setLoad({ state: "ready", selection });
                }).catch((cause: unknown) => {
                  if (cause instanceof TeacherOutcomeConflictError) {
                    setLoad({ state: "ready", selection: cause.latest });
                  }
                  if (!controller.signal.aborted) {
                    setMutationError(cause instanceof Error ? cause.message : "课程复核失败");
                  }
                }).finally(() => {
                  if (!controller.signal.aborted) setBusy(false);
                  if (mutationControllerRef.current === controller) {
                    mutationControllerRef.current = null;
                  }
                });
              }}
            />
          ) : null}
        </div>
      ) : null}
    </main>
  );
}
