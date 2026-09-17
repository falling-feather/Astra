import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileCheck2,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useExperienceGateway } from "../gateway";
import {
  claimStudentCourse,
  loadStudentCourseDetail,
} from "../loaders";
import type { StudentCourseDetailView } from "../models";

type DetailLoad =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; detail: StudentCourseDetailView };

export type CourseDetailPrimaryAction =
  | { kind: "claim"; label: "认领课程" }
  | { kind: "navigate"; label: string; path: string };

export function courseDetailPrimaryAction(
  detail: StudentCourseDetailView,
): CourseDetailPrimaryAction {
  const enrollment = detail.enrollment;
  if (!enrollment) return { kind: "claim", label: "认领课程" };
  if (enrollment.status === "claimed") {
    return { kind: "navigate", label: "返回我的课程", path: "/student/courses" };
  }
  if (enrollment.status === "in_progress") {
    if (detail.progress?.readyForSubmission) {
      return {
        kind: "navigate",
        label: "提交成果复核",
        path: `/student/reviews/${encodeURIComponent(enrollment.activeSessionId)}`,
      };
    }
    return {
      kind: "navigate",
      label: "继续当前实训",
      path: `/student/training/${encodeURIComponent(enrollment.activeSessionId)}`,
    };
  }
  return {
    kind: "navigate",
    label: enrollment.status === "completed" ? "查看评价复盘" : "查看复核状态",
    path: `/student/reviews/${encodeURIComponent(enrollment.activeSessionId)}`,
  };
}

export function courseDetailStatus(
  detail: StudentCourseDetailView,
): { title: string; description: string; tone: string } {
  switch (detail.enrollment?.status) {
    case undefined:
      return {
        title: "尚未认领",
        description: "认领后，平台才会建立记者主岗和对应实训会话。",
        tone: "available",
      };
    case "claimed":
      return {
        title: "已认领 · 等待开班",
        description: "课程已进入你的课程列表；教师开班前不会生成虚假任务。",
        tone: "waiting",
      };
    case "in_progress":
      if (detail.progress?.readyForSubmission) {
        return {
          title: "全部小节已完成",
          description: "成果与证据已由服务端冻结，可进入复盘页提交教师复核。",
          tone: "active",
        };
      }
      return {
        title: "实训进行中",
        description: "继续进入当前权威会话，完成唯一当前任务。",
        tone: "active",
      };
    case "awaiting_review":
      return {
        title: "成果待复核",
        description: "成果已提交；评价内容以服务端复盘投影为准。",
        tone: "waiting",
      };
    case "completed":
      return {
        title: "课程已完成",
        description: "课程生命周期已经完成，可进入评价复盘查看真实结果。",
        tone: "completed",
      };
  }
}

function reviewStatusLabel(
  status: StudentCourseDetailView["sources"][number]["reviewStatus"],
): string {
  if (status === "verified") return "来源已校验";
  if (status === "pending_expert_review") return "待专家复核";
  return "来源已停用";
}

export function StudentCourseDetailSurface({
  detail,
  busy = false,
  error = null,
  onClaim,
  navigate,
}: {
  detail: StudentCourseDetailView;
  busy?: boolean;
  error?: string | null;
  onClaim(): void;
  navigate(path: string): void;
}) {
  const status = courseDetailStatus(detail);
  const action = courseDetailPrimaryAction(detail);
  return (
    <main className="v2-course-detail">
      <button
        type="button"
        className="v2-page-back"
        onClick={() => navigate("/student/courses")}
      >
        <ArrowLeft size={16} />我的课程
      </button>

      <header className="v2-course-detail-hero">
        <div className="v2-course-detail-mark" aria-hidden="true">
          <BookOpen size={38} />
        </div>
        <div>
          <h1>{detail.title}</h1>
          <p>{detail.summary}</p>
          <dl>
            <div><dt>主岗位</dt><dd>{detail.primaryJob.title} · 记者</dd></div>
            <div><dt>课程结构</dt><dd>{detail.chapters.length} 个实训小节</dd></div>
            <div><dt>公开依据</dt><dd>{detail.sources.length} 条登记来源</dd></div>
            <div><dt>发布版本</dt><dd>V{detail.version}</dd></div>
            {detail.progress ? (
              <div>
                <dt>课程进度</dt>
                <dd>{detail.progress.completedChapterCount} / {detail.progress.chapterCount} 小节</dd>
              </div>
            ) : null}
          </dl>
        </div>
        <aside className={`v2-course-detail-action ${status.tone}`}>
          <span>{status.title}</span>
          <p>{status.description}</p>
          {error ? <div className="v2-inline-error" role="alert">{error}</div> : null}
          <button
            type="button"
            className="v2-primary-cta"
            disabled={busy}
            onClick={() => {
              if (action.kind === "claim") onClaim();
              else navigate(action.path);
            }}
          >
            {busy ? "正在确认认领" : action.label}<ArrowRight size={17} />
          </button>
        </aside>
      </header>

      <section className="v2-course-detail-section" aria-labelledby="course-chapters-title">
        <header>
          <div>
            <h2 id="course-chapters-title">实训路径</h2>
            <p>按真实工作任务递进；每节均说明目标、成果证据与评价依据。</p>
          </div>
        </header>
        <ol className="v2-course-chapter-list">
          {detail.chapters.map((chapter, index) => (
            <li key={chapter.chapterId}>
              <div className="v2-course-chapter-index">
                <span>{String(chapter.order).padStart(2, "0")}</span>
                {chapter.finalChapter ? <b>最终成果</b> : null}
              </div>
              <details open={index === 0}>
                <summary>
                  <div>
                    <h3>{chapter.title}</h3>
                    <p>{chapter.objective}</p>
                  </div>
                  <span>{index === 0 ? "当前展开" : "查看详情"}</span>
                </summary>
                <div className="v2-course-chapter-body">
                  <section>
                    <h4>任务说明</h4>
                    <p>{chapter.taskBrief}</p>
                  </section>
                  <section>
                    <h4><FileCheck2 size={16} />成果与证据</h4>
                    <ul>{chapter.evidenceRequirements.map((item) => <li key={item}>{item}</li>)}</ul>
                  </section>
                  <section>
                    <h4><ShieldCheck size={16} />评价依据</h4>
                    <ul>{chapter.rubricCriteria.map((criterion) => (
                      <li key={criterion.criterionId}>
                        <strong>{criterion.title} · {criterion.weight}%</strong>
                        <span>{criterion.description}</span>
                      </li>
                    ))}</ul>
                  </section>
                  <section>
                    <h4>公开来源</h4>
                    <ul>{chapter.publicSources.map((source) => (
                      <li key={source.sourceId}>
                        <a href={source.url} target="_blank" rel="noreferrer">
                          {source.title}<ExternalLink size={13} />
                        </a>
                        <span>{source.publisher} · {reviewStatusLabel(source.reviewStatus)}</span>
                      </li>
                    ))}</ul>
                  </section>
                  <section className="v2-course-transfer">
                    <h4>迁移反思</h4>
                    <p>{chapter.transferReflection}</p>
                  </section>
                </div>
              </details>
            </li>
          ))}
        </ol>
      </section>

      <section className="v2-course-source-register" aria-labelledby="course-source-title">
        <div>
          <Clock3 size={20} />
          <div>
            <h2 id="course-source-title">课程来源登记</h2>
            <p>页面只展示公开来源元数据；不复制未授权图片、视频或隐藏事实。</p>
          </div>
        </div>
        <span><CheckCircle2 size={16} />{detail.sources.length} 条来源已登记</span>
      </section>
    </main>
  );
}

export default function StudentCourseDetailPage({
  courseId,
  navigate,
}: {
  courseId: string;
  navigate(path: string): void;
}) {
  const gateway = useExperienceGateway();
  const [load, setLoad] = useState<DetailLoad>({ state: "loading" });
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoad({ state: "loading" });
    loadStudentCourseDetail(gateway, courseId, controller.signal)
      .then((detail) => {
        if (!controller.signal.aborted) setLoad({ state: "ready", detail });
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setLoad({
            state: "error",
            message: cause instanceof Error ? cause.message : "无法读取课程详情",
          });
        }
      });
    return () => controller.abort();
  }, [courseId, gateway, revision]);

  if (load.state === "loading") {
    return <div className="v2-centered-state v2-full-state"><LoaderCircle className="spin" />正在读取课程详情</div>;
  }
  if (load.state === "error") {
    return (
      <div className="v2-centered-state v2-full-state">
        <p>{load.message}</p>
        <button type="button" onClick={() => setRevision((value) => value + 1)}>
          <RefreshCw size={16} />重试
        </button>
      </div>
    );
  }

  return (
    <StudentCourseDetailSurface
      detail={load.detail}
      busy={busy}
      error={mutationError}
      navigate={navigate}
      onClaim={() => {
        setBusy(true);
        setMutationError(null);
        void claimStudentCourse(gateway, load.detail)
          .then((detail) => {
            setLoad({ state: "ready", detail });
            const enrollment = detail.enrollment;
            if (enrollment?.status === "in_progress") {
              navigate(`/student/training/${encodeURIComponent(enrollment.activeSessionId)}`);
            }
          })
          .catch((cause: unknown) => {
            setMutationError(cause instanceof Error ? cause.message : "课程认领失败");
          })
          .finally(() => setBusy(false));
      }}
    />
  );
}
