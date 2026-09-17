import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, LoaderCircle, X } from "lucide-react";
import type { CourseArchiveItemV3, StartStudyV3, StudentCourseArchiveV3, StudentStudyV3, StudyRunV3 } from "@ronggang/contracts";
import { useExperienceGateway } from "../gateway";
import { ArchiveStage, type ArchiveDossier } from "./archive-stage";

function ChangeCourseDialog({ current, target, phase, busy, error, onContinue, onNext, onConfirm, onClose }: {
  current: StudyRunV3; target: CourseArchiveItemV3 | null; phase: "choose" | "confirm"; busy: boolean; error: string | null;
  onContinue(): void; onNext(): void; onConfirm(): void; onClose(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="v3-settings v3-course-switch" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header><h2>{phase === "choose" ? "还有一门课程未完成" : "确认放弃本次课程？"}</h2><button type="button" aria-label="关闭课程切换提示" disabled={busy} onClick={onClose}><X /></button></header>
    <section><p className="v3-switch-current">{current.title}</p><p>{phase === "choose" ? "可以返回继续，也可以放弃本次练习后打开新课程。" : "放弃后，本次练习将结束，已经保存的作品和笔记仍保留在历史记录中。"}</p>
      {target ? <p>准备打开：<strong>{target.regionTitle} · {target.shortTitle}</strong></p> : null}{error ? <p role="alert" className="v3-switch-error">{error}</p> : null}</section>
    <footer>{phase === "choose" ? <><button type="button" className="v3-settings-exit" onClick={onContinue}><ArrowLeft />返回继续旧课程</button><button type="button" onClick={onNext}>{target ? "放弃旧课程，开新课" : "放弃本次课程"}<ArrowRight /></button></> : <><button type="button" className="v3-abandon-confirm" disabled={busy} onClick={onConfirm}>{busy ? <LoaderCircle className="spin" /> : <ArrowRight />}{target ? "确认放弃并开新课" : "确认放弃本次课程"}</button><button type="button" disabled={busy} onClick={onClose}>先不放弃</button></>}</footer>
  </dialog>;
}

export default function StudentCourseArchive({ navigate }: { navigate(path: string): void }) {
  const gateway = useExperienceGateway();
  const [data, setData] = useState<StudentCourseArchiveV3 | null>(null), [study, setStudy] = useState<StudentStudyV3 | null>(null);
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ target: CourseArchiveItemV3 | null; current: StudyRunV3; phase: "choose" | "confirm" } | null>(null);
  const command = useRef<StartStudyV3 | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    if (!gateway.getCourseArchive || !gateway.getStudy) { setError("当前连接未提供课程档案服务"); return; }
    Promise.all([gateway.getCourseArchive(controller.signal), gateway.getStudy(controller.signal)]).then(([catalog, state]) => {
      if (!controller.signal.aborted) { setData(catalog); setStudy(state); }
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "课程档案暂时无法读取"); });
    return () => controller.abort();
  }, [gateway]);
  const current = study?.runs.find(run => run.sessionId === study.currentSessionId) ?? null;
  const dossiers: ArchiveDossier[] = (data?.courses ?? []).map(course => {
    const active = current?.courseRef.courseId === course.courseRef.courseId && current.taskReleaseId === course.taskReleaseId;
    const prior = study?.runs.find(run => run.courseRef.courseId === course.courseRef.courseId && run.taskReleaseId === course.taskReleaseId);
    return { id: course.entryId, title: course.shortTitle, region: course.regionTitle, collection: course.taskReleaseId ? "教师委托" : "课程",
      subtitle: course.summary, duration: course.durationLabel, coverIndex: course.coverIndex,
      ...(active ? {status:"正在进行"} : prior?.status === "completed" ? {status:"已有完成记录"} : {}),
      actionLabel: active ? "继续实训" : prior ? "再练一次" : "开始实训",
      details:[{title:"课程任务",text:course.summary},{title:"体验内容",items:["现场探索与人物交流","材料核验与记录整理","作品交付与复盘"]}] };
  });
  const enter = async (run: StudyRunV3) => {
    await gateway.authorizeSession(run.sessionId);
    navigate("/student/training/" + encodeURIComponent(run.sessionId));
  };
  const start = async (target: CourseArchiveItemV3, replace?: NonNullable<StartStudyV3["replace"]>) => {
    if (!gateway.startStudy) { setError("当前连接未提供开课服务"); return; }
    if (!command.current || command.current.courseReleaseId !== target.courseRef.releaseId || command.current.taskReleaseId !== target.taskReleaseId
      || command.current.replace?.sessionId !== replace?.sessionId || command.current.replace?.expectedRevision !== replace?.expectedRevision) {
      command.current = { requestId: "study-" + crypto.randomUUID(), courseReleaseId: target.courseRef.releaseId, ...(target.taskReleaseId ? { taskReleaseId: target.taskReleaseId } : {}), ...(replace ? { replace } : {}) };
    }
    setBusy(true); setError(null);
    try {
      const result = await gateway.startStudy(command.current);
      setStudy(result.state); command.current = null;
      if (result.run.status !== "active" || result.state.currentSessionId !== result.run.sessionId) throw new Error("这次开课请求对应的课程已结束，请重新选择课程。");
      setPending(null); await enter(result.run);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "课程暂时无法打开");
      if (gateway.getStudy) {
        try {
          const state = await gateway.getStudy(); setStudy(state);
          const active = state.runs.find(run => run.sessionId === state.currentSessionId);
          if (active && (active.courseRef.courseId !== target.courseRef.courseId || active.taskReleaseId !== target.taskReleaseId)) setPending({ target, current: active, phase: "choose" });
        } catch (syncError) { setError(`${cause instanceof Error ? cause.message : "开课未完成"}；当前状态也未能同步：${syncError instanceof Error ? syncError.message : "连接失败"}`); }
      }
    } finally { setBusy(false); }
  };
  const open = async (dossier: ArchiveDossier) => {
    const target = data!.courses.find(item => item.entryId === dossier.id)!;
    setError(null);
    if (current && (current.courseRef.courseId !== target.courseRef.courseId || current.taskReleaseId !== target.taskReleaseId)) { command.current = null; setPending({ target, current, phase: "choose" }); return; }
    await start(target);
  };
  const cancelCommand = useRef<import("@ronggang/contracts").CancelStudyV3 | null>(null);
  const abandon = async () => {
    if(!current||!study||!gateway.cancelStudy)return;
    if(!cancelCommand.current || cancelCommand.current.sessionId!==current.sessionId || cancelCommand.current.expectedRevision!==study.revision)cancelCommand.current={requestId:'cancel-'+crypto.randomUUID(),sessionId:current.sessionId,expectedRevision:study.revision,confirmation:'abandon'};
    setBusy(true);setError(null);
    try{setStudy(await gateway.cancelStudy(cancelCommand.current));cancelCommand.current=null;setPending(null);}
    catch(cause){setError(cause instanceof Error?cause.message:'未能放弃课程，原记录仍保留');}
    finally{setBusy(false);}
  };
  return <>
    <ArchiveStage title="我的课程档案" dossiers={dossiers} onOpen={open} error={pending ? null : error} loading={(!data || !study) && !error}
      footer={current ? <div className="v3-current-course"><span title={current.title}>当前在学：{current.title}</span><button type="button" disabled={busy} onClick={() => void enter(current).catch(cause => setError(cause instanceof Error ? cause.message : "暂时无法进入课程"))}>继续实训<ArrowRight/></button><button type="button" disabled={busy} onClick={() => setPending({ target: null, current, phase: "choose" })}>管理当前课程</button></div> : null}/>
    {pending ? <ChangeCourseDialog current={pending.current} target={pending.target} phase={pending.phase} busy={busy} error={error}
      onContinue={() => void enter(pending.current).catch(cause => setError(cause instanceof Error ? cause.message : "暂时无法进入课程"))}
      onNext={() => setPending({ ...pending, phase: "confirm" })}
      onConfirm={() => pending.target ? void start(pending.target, { sessionId: pending.current.sessionId, expectedRevision: study!.revision, confirmation: "abandon-and-start" }) : void abandon()}
      onClose={() => { setPending(null); command.current = null; setError(null); }} /> : null}
  </>;
}
