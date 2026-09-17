import { useEffect, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Check,
  Clock3,
  FileText,
  LoaderCircle,
  MapPinned,
  Mic2,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
} from "lucide-react";
import {
  type CourseEnrollment,
  type LearningActivity,
  type SessionExperienceDescriptor,
} from "@ronggang/contracts";
import { BrandMark } from "../brand-mark";
import { useExperienceGateway, type ExperienceGateway } from "../gateway";
import {
  AuthorityConflictError,
  deriveActiveTrainingView,
  ExperienceDriftError,
  resolveTrainingLoad,
  submitAdviceDecision,
  submitPrimaryTask,
} from "../loaders";
import type {
  ActiveTrainingView,
  AdviceDecision,
  TrainingLoad,
  TrainingSnapshot,
} from "../models";
import StudentFlagshipWorldPage, {
  StudentFlagshipWorldV3Page,
} from "./student-flagship-world-page";

interface StudentTrainingPageProps {
  sessionId: string;
  reporterBindingId: string;
  navigate(path: string): void;
}

export { resolveTrainingLoad } from "../loaders";

function sameCourseRelease(
  left: CourseEnrollment["courseReleaseRef"],
  right: SessionExperienceDescriptor["courseReleaseRef"],
): boolean {
  return right !== null
    && left.courseId === right.courseId
    && left.releaseId === right.releaseId
    && left.version === right.version
    && left.contentHash === right.contentHash;
}

export type TrainingEntryDecision =
  | { state: "not-enrolled" }
  | {
      state: "flagship_v4" | "flagship_v3" | "standard";
      descriptor: SessionExperienceDescriptor;
      enrollment: CourseEnrollment | null;
    };

/**
 * Route from an authoritative enrollment before touching any session runtime.
 * This keeps the no-enrollment state genuinely empty and prevents 404-based
 * capability probing from becoming part of normal product navigation.
 */
export async function resolveTrainingEntry(
  gateway: ExperienceGateway,
  sessionId: string,
  reporterBindingId: string,
  signal?: AbortSignal,
): Promise<TrainingEntryDecision> {
  const enrollments = await gateway.getEnrollments(signal);
  const enrollment = enrollments.find((candidate) => (
    candidate.activeSessionId === sessionId
  ));
  if (enrollment && enrollment.bindingId !== reporterBindingId) {
    throw new ExperienceDriftError(
      "当前登录岗位与课程认领绑定不一致，已停止加载。",
    );
  }
  if (!enrollment && reporterBindingId.length === 0) return { state: "not-enrolled" };
  const descriptor = await gateway.getSessionExperienceDescriptor(
    sessionId,
    reporterBindingId,
    signal,
  );
  if (descriptor.sessionId !== sessionId) {
    throw new ExperienceDriftError(
      "服务端会话描述与当前训练地址不一致，已停止加载。",
    );
  }
  if (enrollment && !sameCourseRelease(
    enrollment.courseReleaseRef,
    descriptor.courseReleaseRef,
  )) {
    throw new ExperienceDriftError(
      "课程认领与服务端冻结的会话发布引用不一致，已停止加载。",
    );
  }
  return {
    state: descriptor.experienceGeneration === "standard_v2"
      ? "standard"
      : descriptor.experienceGeneration,
    descriptor,
    enrollment: enrollment ?? null,
  };
}

export function activityStateCopy(activity: LearningActivity): {
  title: string;
  description: string;
  action: "courses" | "review" | null;
} {
  switch (activity.status) {
    case "empty":
      return {
        title: "当前没有学习任务",
        description: activity.primaryAction.description,
        action: "courses",
      };
    case "ready":
      return {
        title: "课程已认领，等待开课",
        description: activity.primaryAction.description,
        action: null,
      };
    case "active":
      return {
        title: activity.currentTask.title,
        description: activity.currentTask.objective,
        action: null,
      };
    case "awaiting_review":
      return {
        title: "成果已提交，等待复核",
        description: activity.primaryAction.description,
        action: null,
      };
    case "completed":
      return {
        title: "本节实训已完成",
        description: activity.primaryAction.description,
        action: "review",
      };
  }
}

function useTrainingSnapshot(
  gateway: ExperienceGateway,
  sessionId: string,
  reporterBindingId: string,
  revision: number,
): [TrainingLoad | { state: "loading" }, (snapshot: TrainingSnapshot) => void] {
  const [load, setLoad] = useState<TrainingLoad | { state: "loading" }>({
    state: "loading",
  });

  useEffect(() => {
    const controller = new AbortController();
    setLoad({ state: "loading" });
    resolveTrainingLoad(
      gateway,
      sessionId,
      reporterBindingId,
      controller.signal,
    )
      .then((result) => {
        if (!controller.signal.aborted) setLoad(result);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setLoad({
            state: "error",
            message: cause instanceof Error ? cause.message : "无法读取当前实训",
          });
        }
      });
    return () => controller.abort();
  }, [gateway, reporterBindingId, revision, sessionId]);

  return [load, (snapshot) => setLoad({ state: "ready", snapshot })];
}

function TrainingHeader({
  view,
  navigate,
}: {
  view: ActiveTrainingView;
  navigate(path: string): void;
}) {
  return (
    <header className="v2-training-header">
      <button
        type="button"
        className="v2-training-brand"
        onClick={() => navigate("/student/courses")}
      >
        <BrandMark /><strong>职教星云</strong><span>学生端</span><b>当前实训</b>
      </button>
      <div className="v2-training-context">
        <strong>{view.courseTitle}</strong>
        <span>共 {view.chapterCount} 节</span>
        <span>{view.task.title}</span>
      </div>
      <div className="v2-training-time">
        <span>剩余</span><strong>{view.remainingMinutes}</strong><span>分钟</span>
        <Clock3 size={22} />
      </div>
    </header>
  );
}

const decisionCopy: Record<AdviceDecision, string> = {
  accept: "采纳",
  request_evidence: "补证",
  reject: "拒绝",
};

function AdvicePanel({
  snapshot,
  view,
  reporterBindingId,
  onSnapshot,
}: {
  snapshot: TrainingSnapshot;
  view: ActiveTrainingView;
  reporterBindingId: string;
  onSnapshot(snapshot: TrainingSnapshot): void;
}) {
  const gateway = useExperienceGateway();
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState<AdviceDecision | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const advice = view.advice;

  if (!advice) {
    return (
      <div className="v2-advice-empty">
        <Bot size={22} /><span>本轮没有需要打断你的协作建议</span>
      </div>
    );
  }
  if (advice.decided) {
    return (
      <div className="v2-advice-settled" role="status">
        <Check size={22} />
        <strong>服务端已记录：{decisionCopy[advice.decided]}</strong>
        <span>本章决定不可改写，后续变化以权威 Episode 为准。</span>
      </div>
    );
  }

  const decide = async (decision: AdviceDecision) => {
    setBusy(decision);
    setMessage(null);
    try {
      const refreshed = await submitAdviceDecision({
        gateway,
        snapshot,
        reporterBindingId,
        decision,
      });
      onSnapshot(refreshed);
    } catch (cause) {
      if (cause instanceof AuthorityConflictError) onSnapshot(cause.snapshot);
      setMessage(cause instanceof Error ? cause.message : "决定记录失败，请重试");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="v2-advice-card">
      <div className="v2-advice-title">
        <div><strong>{advice.agentName}</strong><span>{advice.riskLevel} 风险</span></div>
        <p>{advice.summary}</p>
        <small>{advice.rationale}</small>
      </div>
      {expanded ? (
        <ul className="v2-advice-basis">
          {advice.evidenceRefs.map((reference) => <li key={reference}>{reference}</li>)}
        </ul>
      ) : null}
      {message ? <p className="v2-advice-error" role="alert">{message}</p> : null}
      <div className="v2-advice-actions">
        <button type="button" onClick={() => setExpanded((value) => !value)}>
          <Search size={17} />{expanded ? "收起依据" : "查看依据"}
        </button>
        {advice.allowedDecisions.map((decision) => (
          <button
            type="button"
            key={decision}
            className={decision}
            disabled={busy !== null}
            onClick={() => void decide(decision)}
          >
            {busy === decision ? "正在确认" : decisionCopy[decision]}
          </button>
        ))}
      </div>
    </div>
  );
}

function StructuredScene({ view }: { view: ActiveTrainingView }) {
  const [selectedHotspotId, setSelectedHotspotId] = useState<string | null>(null);
  if (!view.scene) {
    return (
      <section className="v2-scene-stage v2-scene-empty" aria-label="任务现场">
        <MapPinned size={52} />
        <h2>现场结构正在同步</h2>
        <p>不会使用示例图片或虚构热点填充。</p>
      </section>
    );
  }
  return (
    <section className="v2-scene-stage" aria-label="任务现场">
      <header>
        <div><span>任务现场</span><h2>{view.scene.title}</h2></div>
        <b className={`risk-${view.scene.riskLevel}`}>{view.scene.riskLevel} 风险</b>
      </header>
      <p>{view.scene.description}</p>
      <div className="v2-scene-tags">
        {view.scene.stateTags.map((tag) => <span key={tag}>{tag}</span>)}
      </div>
      <div className="v2-hotspot-list">
        {view.scene.hotspots.map((hotspot) => (
          <button
            type="button"
            key={hotspot.hotspotId}
            className={selectedHotspotId === hotspot.hotspotId ? "active" : ""}
            onClick={() => setSelectedHotspotId(hotspot.hotspotId)}
          >
            <span>{hotspot.status}</span>
            <strong>{hotspot.label}</strong>
            <small>{hotspot.description}</small>
            {selectedHotspotId === hotspot.hotspotId && hotspot.consequencePreview
              ? <em>{hotspot.consequencePreview}</em>
              : null}
          </button>
        ))}
      </div>
      {view.worldEvents.length > 0 ? (
        <div className="v2-world-change">
          <strong>最新现场变化</strong>
          <p>{view.worldEvents.at(-1)?.title}：{view.worldEvents.at(-1)?.detail}</p>
        </div>
      ) : null}
    </section>
  );
}

export function ActiveTrainingSurface({
  snapshot,
  reporterBindingId,
  navigate,
  onSnapshot,
}: {
  snapshot: TrainingSnapshot;
  reporterBindingId: string;
  navigate(path: string): void;
  onSnapshot(snapshot: TrainingSnapshot): void;
}) {
  const gateway = useExperienceGateway();
  const view = deriveActiveTrainingView(snapshot);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const performPrimary = async () => {
    setActionBusy(true);
    setActionMessage(null);
    try {
      const refreshed = await submitPrimaryTask({
        gateway,
        snapshot,
        reporterBindingId,
      });
      onSnapshot(refreshed);
      setActionMessage("服务端已确认主行动，现场状态已刷新。");
    } catch (cause) {
      if (cause instanceof AuthorityConflictError) onSnapshot(cause.snapshot);
      setActionMessage(cause instanceof Error ? cause.message : "任务提交失败，请重试");
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <main className="v2-training-page">
      <TrainingHeader view={view} navigate={navigate} />
      <div className="v2-training-grid">
        <aside className="v2-task-rail">
          <section className="v2-role-summary">
            <h2>我的主岗位</h2>
            <div><Mic2 /><span><strong>记者</strong><small>观察、核验并完成当前报道任务</small></span></div>
          </section>
          <section className="v2-task-summary">
            <h2>当前任务（唯一）</h2>
            <div><FileText /><strong>{view.task.title}</strong></div>
            <p>{view.task.objective}</p>
          </section>
          <section className="v2-task-steps">
            <h2>三步完成任务</h2>
            <ol>
              {view.task.guideSteps.map((step) => (
                <li key={step.stepId} className={step.status}>
                  <span>{step.order}</span>
                  <div><strong>{step.title}</strong><small>{step.instruction}</small></div>
                </li>
              ))}
            </ol>
          </section>
        </aside>

        <StructuredScene view={view} />

        <aside className="v2-collaboration-rail">
          <section className="v2-advice-panel">
            <h2>当前 AI 协作建议</h2>
            <AdvicePanel
              snapshot={snapshot}
              view={view}
              reporterBindingId={reporterBindingId}
              onSnapshot={onSnapshot}
            />
          </section>
          <section className="v2-student-guidance">
            <ShieldAlert size={20} />
            <p>先判断建议，再完成页面底部唯一主行动。系统只在服务端确认后更新状态。</p>
          </section>
        </aside>
      </div>

      <footer className="v2-training-actions">
        <div aria-live="polite">{actionMessage}</div>
        <button
          type="button"
          className="primary"
          disabled={actionBusy || !view.primaryAction}
          onClick={() => void performPrimary()}
        >
          <Send />
          {actionBusy
            ? "正在等待服务端确认"
            : view.primaryAction?.label ?? "等待主行动开放"}
        </button>
      </footer>
    </main>
  );
}

function TrainingState({
  load,
  sessionId,
  navigate,
  onRetry,
}: {
  load: TrainingLoad | { state: "loading" };
  sessionId: string;
  navigate(path: string): void;
  onRetry(): void;
}) {
  let title = "正在进入实训";
  let description = "正在确认课程认领与记者岗位。";
  let icon = <LoaderCircle className="spin" />;
  let action: ReactNode = null;
  if (load.state === "not-enrolled") {
    title = "你尚未认领这门课程";
    description = "认领前不会加载课程任务、训练现场或智能体建议。";
    icon = <ShieldAlert />;
    action = <button type="button" onClick={() => navigate("/student/courses")}>返回我的课程</button>;
  } else if (load.state === "error") {
    title = "暂时无法进入实训";
    description = load.message;
    icon = <AlertTriangle />;
    action = <button type="button" onClick={onRetry}><RefreshCw size={16} />重试</button>;
  } else if (load.state === "ready") {
    const copy = activityStateCopy(load.snapshot.activity);
    title = copy.title;
    description = copy.description;
    icon = load.snapshot.activity.status === "completed" ? <Check /> : <Clock3 />;
    if (copy.action === "courses") {
      action = <button type="button" onClick={() => navigate("/student/courses")}>返回我的课程</button>;
    }
    if (copy.action === "review") {
      action = (
        <button
          type="button"
          onClick={() => navigate(`/student/reviews/${encodeURIComponent(sessionId)}`)}
        >
          查看评价复盘
        </button>
      );
    }
  }
  return (
    <main className="v2-standalone-state">
      <button className="v2-back-link" type="button" onClick={() => navigate("/student/courses")}>
        <ArrowLeft size={17} />我的课程
      </button>
      <div>{icon}<h1>{title}</h1><p>{description}</p>{action}</div>
    </main>
  );
}

function LegacyStudentTrainingPage({
  sessionId,
  reporterBindingId,
  navigate,
}: StudentTrainingPageProps) {
  const gateway = useExperienceGateway();
  const [revision, setRevision] = useState(0);
  const [load, setSnapshot] = useTrainingSnapshot(
    gateway,
    sessionId,
    reporterBindingId,
    revision,
  );
  if (load.state === "ready" && load.snapshot.activity.status === "active") {
    return (
      <ActiveTrainingSurface
        snapshot={load.snapshot}
        reporterBindingId={reporterBindingId}
        navigate={navigate}
        onSnapshot={setSnapshot}
      />
    );
  }
  return (
    <TrainingState
      load={load}
      sessionId={sessionId}
      navigate={navigate}
      onRetry={() => setRevision((value) => value + 1)}
    />
  );
}

export default function StudentTrainingPage(props: StudentTrainingPageProps) {
  const gateway = useExperienceGateway();
  const v3Available = Boolean(
    gateway.getFlagshipWorld
      && gateway.getFlagshipEpisode
      && gateway.submitFlagshipAction
      && gateway.decideFlagshipEpisode
      && gateway.advanceFlagshipWorld
      && gateway.getFlagshipWorkspace
      && gateway.saveFlagshipWorkRevision
      && gateway.submitFlagshipWorkRevision,
  );
  const [entry, setEntry] = useState<
    TrainingEntryDecision
    | { state: "loading" }
    | { state: "error"; message: string }
  >({ state: "loading" });
  const [entryRevision, setEntryRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setEntry({ state: "loading" });
    resolveTrainingEntry(
      gateway,
      props.sessionId,
      props.reporterBindingId,
      controller.signal,
    ).then((decision) => {
      if (!controller.signal.aborted) setEntry(decision);
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) {
        setEntry({
          state: "error",
          message: cause instanceof Error ? cause.message : "无法确认课程认领",
        });
      }
    });
    return () => controller.abort();
  }, [entryRevision, gateway, props.reporterBindingId, props.sessionId]);
  if (entry.state === "loading" || entry.state === "error" || entry.state === "not-enrolled") {
    return (
      <TrainingState
        load={entry}
        sessionId={props.sessionId}
        navigate={props.navigate}
        onRetry={() => setEntryRevision((value) => value + 1)}
      />
    );
  }
  if (entry.state === "standard") {
    return <LegacyStudentTrainingPage {...props} />;
  }
  if (entry.state === "flagship_v3") {
    return <StudentFlagshipWorldV3Page {...props} />;
  }
  if (entry.state === "flagship_v4") {
    if (!v3Available) {
      return (
        <TrainingState
          load={{ state: "error", message: "当前客户端缺少描述符要求的旗舰运行能力。" }}
          sessionId={props.sessionId}
          navigate={props.navigate}
          onRetry={() => setEntryRevision((value) => value + 1)}
        />
      );
    }
    return <StudentFlagshipWorldPage {...props} />;
  }
  return null;
}
