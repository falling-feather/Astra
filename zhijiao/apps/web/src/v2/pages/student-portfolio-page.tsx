import { useEffect, useRef, useState } from "react";
import type {StudyRunV3,TeacherSubmittedWorksV3} from '@ronggang/contracts';
import {SubmittedWorkView} from './submitted-work-view';
import {
  ArrowRight,
  CheckCircle2,
  FileCheck2,
  FolderOpen,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useExperienceGateway } from "../gateway";
import { loadStudentPortfolio } from "../outcome-loaders";
import type {
  StudentPortfolioItemView,
  StudentPortfolioLoad,
} from "../models";

type PortfolioPageLoad =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; portfolio: StudentPortfolioLoad;fieldRuns:StudyRunV3[] };

function kindLabel(kind: StudentPortfolioItemView["kind"]): string {
  switch (kind) {
    case "task_outcome": return "任务成果";
    case "interview_record": return "采访记录";
    case "article": return "融媒体稿件";
    case "short_video_plan": return "短视频方案";
    case "channel_variant": return "平台适配版本";
  }
}

export function StudentPortfolioSurface({
  portfolio,
  navigate,
  embedded=false,
}: {
  portfolio: StudentPortfolioLoad;
  navigate(path: string): void;
  embedded?:boolean;
}) {
  const Container=embedded?'section':'main';
  if (portfolio.state === "empty") {
    return (
      <Container className="v2-simple-page">
        <section className="v2-light-empty v2-outcome-empty">
          <FolderOpen size={54} />
          <h1>尚无作品与证据</h1>
          <p>认领课程并进入真实实训后，这里才会读取服务端成果。</p>
          <button
            type="button"
            className="v2-primary-cta"
            onClick={() => navigate("/student/courses")}
          >
            浏览课程大厅<ArrowRight size={17} />
          </button>
        </section>
      </Container>
    );
  }

  const activeCourse = portfolio.courses.find((course) => (
    course.status === "in_progress" && course.activeSessionId !== null
  ));
  const nextPath = activeCourse
    ? activeCourse.readyForSubmission
      ? `/student/reviews/${encodeURIComponent(activeCourse.activeSessionId!)}`
      : `/student/training/${encodeURIComponent(activeCourse.activeSessionId!)}`
    : "/student/courses";
  const nextLabel = activeCourse
    ? activeCourse.readyForSubmission ? "提交成果复核" : "返回当前实训"
    : "查看我的课程";

  return (
    <Container className="v2-simple-page v2-outcome-page">
      <header>
        <div>
          <span className="v2-page-kicker">个人成果档案</span>
          <h1>作品与证据</h1>
          <p>只展示当前账号由服务端归档的作品修订与证据依据。</p>
        </div>
        {portfolio.items.length > 0 ? (
          <button type="button" className="v2-primary-cta" onClick={() => navigate(nextPath)}>
            {nextLabel}<ArrowRight size={16} />
          </button>
        ) : null}
      </header>

      {portfolio.items.length === 0 ? (
        <section className="v2-light-empty v2-outcome-empty">
          <FileCheck2 size={50} />
          <h2>尚未形成可展示作品</h2>
          <p>课程已经认领，但服务端还没有归档作品版本；页面不会生成示例成果。</p>
          <button type="button" className="v2-primary-cta" onClick={() => navigate(nextPath)}>
            {nextLabel}<ArrowRight size={17} />
          </button>
        </section>
      ) : (
        <section className="v2-outcome-grid" aria-label="真实作品列表">
          {portfolio.items.map((item) => (
            <article key={item.key} className="v2-outcome-card">
              <header>
                <span>{kindLabel(item.kind)}</span>
                <b>{item.status === "submitted" ? "已冻结提交" : "修订中"}</b>
              </header>
              <h2>{item.title}</h2>
              <p>{item.summary}</p>
              <dl>
                <div><dt>所属课程</dt><dd>{item.courseTitle}</dd></div>
                <div><dt>作品版本</dt><dd>R{item.revisionNumber}</dd></div>
                <div><dt>证据覆盖</dt><dd>{item.evidenceCount} 条</dd></div>
                <div><dt>更新时间</dt><dd>{new Date(item.updatedAt).toLocaleDateString("zh-CN")}</dd></div>
              </dl>
              <footer>
                {item.origin === "student_artifact" ? "学生作品" : "服务端过程记录"}
              </footer>
            </article>
          ))}
        </section>
      )}

      <section className="v2-evidence-register" aria-labelledby="student-evidence-title">
        <header>
          <div>
            <ShieldCheck size={21} />
            <div>
              <h2 id="student-evidence-title">证据登记</h2>
              <p>依据来自权威过程记录，不显示技术追踪或内容哈希。</p>
            </div>
          </div>
          <span><CheckCircle2 size={16} />{portfolio.evidence.length} 条</span>
        </header>
        {portfolio.evidence.length === 0 ? (
          <p className="v2-outcome-muted">当前尚无服务端证据记录。</p>
        ) : (
          <ol>
            {portfolio.evidence.map((item) => (
              <li key={item.key}>
                <div><strong>{item.title}</strong><span>{item.courseTitle}</span></div>
                <p>{item.basis}</p>
                <time dateTime={item.createdAt}>
                  {new Date(item.createdAt).toLocaleString("zh-CN")}
                </time>
              </li>
            ))}
          </ol>
        )}
      </section>
    </Container>
  );
}

export default function StudentPortfolioPage({
  navigate,
}: {
  navigate(path: string): void;
}) {
  const gateway = useExperienceGateway();
  const [load, setLoad] = useState<PortfolioPageLoad>({ state: "loading" });
  const [revision, setRevision] = useState(0);
  const [works,setWorks]=useState<TeacherSubmittedWorksV3|null>(null),[workError,setWorkError]=useState<string|null>(null),[workBusy,setWorkBusy]=useState(false);
  const workRequest=useRef<AbortController|null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoad({ state: "loading" });
    setWorks(null);setWorkError(null);workRequest.current?.abort();setWorkBusy(false);
    Promise.all([loadStudentPortfolio(gateway, controller.signal),gateway.getStudy?.(controller.signal)])
      .then(([portfolio,study]) => {
        if (!controller.signal.aborted) setLoad({ state: "ready", portfolio,fieldRuns:study?.runs.filter(run=>run.runtimeKind!=='legacy_course')??[] });
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setLoad({
            state: "error",
            message: cause instanceof Error ? cause.message : "无法读取作品与证据",
          });
        }
      });
    return () => {controller.abort();workRequest.current?.abort();};
  }, [gateway, revision]);

  if (load.state === "loading") {
    return <div className="v2-centered-state v2-full-state"><LoaderCircle className="spin" />正在读取作品与证据</div>;
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
  const openWorks=async(sessionId:string)=>{
    if(!gateway.getStudyWorks)return;workRequest.current?.abort();const controller=new AbortController();workRequest.current=controller;setWorkBusy(true);setWorkError(null);
    try{const value=await gateway.getStudyWorks(sessionId,controller.signal);if(!controller.signal.aborted)setWorks(value);}
    catch(error){if(!controller.signal.aborted)setWorkError(error instanceof Error?error.message:'作品读取失败');}
    finally{if(!controller.signal.aborted)setWorkBusy(false);}
  };
  return <>{load.fieldRuns.length?<main className="v2-simple-page personal-work-portfolio"><header><span className="v2-page-kicker">个人作品档案</span><h1>我的课程作品</h1><p>按课程保留已经提交的内容。私人笔记只有你主动附上时才出现在作品中。</p></header>
    {workError?<p role="alert">{workError}</p>:null}
    <section className="v2-outcome-grid">{load.fieldRuns.map(run=><article className="v2-outcome-card" key={run.sessionId}><span>{run.status==='completed'?'已完成':run.status==='cancelled'?'已放弃，原作品保留':'本次学习记录'}</span><h2>{run.title}</h2><p>{new Date(run.startedAt).toLocaleDateString('zh-CN')}</p>
      <button type="button" disabled={workBusy} onClick={()=>void openWorks(run.sessionId)}>查看已交作品<ArrowRight size={16}/></button><button type="button" onClick={()=>navigate(`/student/reviews/${encodeURIComponent(run.sessionId)}`)}>查看本次评价<ArrowRight size={16}/></button>
    </article>)}</section>{works?<SubmittedWorkView value={works} title={load.fieldRuns.find(run=>run.sessionId===works.sessionId)?.title??'本次课程'} onClose={()=>setWorks(null)}/>:null}</main>:null}
    {!load.fieldRuns.length||(load.portfolio.state==='ready'&&load.portfolio.items.length>0)?<StudentPortfolioSurface portfolio={load.portfolio} navigate={navigate} embedded={load.fieldRuns.length>0}/>:null}</>;
}
