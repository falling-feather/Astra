import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, BookOpen, RefreshCw, UserRound } from "lucide-react";
import type { TeacherStudentArchiveV3, TeacherSubmittedWorksV3 } from "@ronggang/contracts";
import type { TeacherGateway } from "../teacher-gateway";
import { TeacherArchiveStage } from './teacher-archive-stage';
import {SubmittedWorkView} from './submitted-work-view';
import "./teacher-student-archive.css";

const statusText = { active: "正在学习", completed: "已完成", cancelled: "已放弃", legacy: "历史记录" };
export default function TeacherStudentArchive({ gateway, navigate }: {
  gateway: TeacherGateway; bindingId: string; authorizationSessionId: string; navigate(path:string):void;
}) {
  const [works,setWorks] = useState<TeacherSubmittedWorksV3|null>(null), [worksBusy,setWorksBusy]=useState(false);
  const [archive,setArchive]=useState<TeacherStudentArchiveV3|null>(null),[selected,setSelected]=useState<string|null>(null),[revision,setRevision]=useState(0),[error,setError]=useState<string|null>(null);
  useEffect(()=>{const controller=new AbortController();setError(null);
    if(!gateway.getStudentArchive){setError("当前连接未提供学生档案。");return;}
    gateway.getStudentArchive(controller.signal).then(value=>{if(!controller.signal.aborted)setArchive(value);}).catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:"学生档案读取失败");});
    return()=>controller.abort();
  },[gateway,revision]);
  const student=archive?.students.find(student=>student.studentId===selected),current=student?.runs.find(run=>run.sessionId===student.currentSessionId)??student?.runs[0];
  const openWorks = async (sessionId: string) => {
    if(!student||!gateway.getSubmittedStudentWorks)return;
    if(student.runs.find(run=>run.sessionId===sessionId)?.runtimeKind==='legacy_course'){navigate(`/teacher/reviews/${encodeURIComponent(sessionId)}`);return;}
    setWorksBusy(true);setError(null);
    try{setWorks(await gateway.getSubmittedStudentWorks(student.studentId,sessionId));}
    catch(cause){setError(cause instanceof Error?cause.message:'作品读取失败');}
    finally{setWorksBusy(false);}
  };
  return student?<main className="teacher-student-dossier"><header><button type="button" onClick={()=>{setSelected(null);setWorks(null);}}><ArrowLeft/>档案室</button><div><span>STUDENT DOSSIER / 全部课程资料</span><h1>{student.displayName}</h1></div><button type="button" onClick={()=>setRevision(value=>value+1)}><RefreshCw/>刷新</button></header>
    {error?<p className="v3-archive-error" role="alert">{error}</p>:null}
    <div className="student-dossier-columns"><section><span className="dossier-label">当前课程</span>{current?<><h2>{current.title}</h2><p className="dossier-state">{current.region} · {statusText[current.status]}</p><div className="dossier-facts"><div><strong>{current.visitedScenes}</strong><span>到访场景</span></div><div><strong>{current.conversations}</strong><span>交流回合</span></div><div><strong>{current.submittedWorks}/{current.requiredWorks}</strong><span>成果送审</span></div></div>
      <button type="button" className="dossier-primary" disabled={worksBusy} onClick={()=>current.runtimeKind==='legacy_course'?navigate(`/teacher/reviews/${encodeURIComponent(current.sessionId)}`):void openWorks(current.sessionId)}>{current.runtimeKind==='legacy_course'?'查看原版作品与评价':worksBusy?'正在读取作品…':'查看已送审作品与附件'}<ArrowRight/></button>
      {works&&student.runs.some(run=>run.sessionId===works.sessionId)?<SubmittedWorkView value={works} title={student.runs.find(run=>run.sessionId===works.sessionId)!.title} onClose={()=>setWorks(null)}/>:null}
      <h3>职业行为画像</h3><button type="button" onClick={()=>navigate(`/teacher/reviews/${encodeURIComponent(current.sessionId)}`)}>评阅与后续练习<ArrowRight/></button><p className="dossier-explanation">以已提交的作品为主要评价对象，结合已经发生的交流与岗位行动理解学习过程。</p>
      <p className="dossier-assessment-status">{current.assessment.message}</p>
      <div className="dossier-criteria">{current.assessment.criteria.map(criterion=><article key={criterion.id}><header><strong>{criterion.title}</strong><span>{criterion.score===null?"待形成评价":`${criterion.score} / 100`}</span></header>{criterion.score!==null?<meter min={0} max={100} value={criterion.score}/>:null}<p>{criterion.rationale}</p></article>)}</div>
    </>:<div className="dossier-empty"><BookOpen/><p>这位学生尚未开始课程。</p></div>}</section>
    <aside><h2>课程记录</h2>{student.runs.map(run=><article className="dossier-course-record" key={run.sessionId}><span>{statusText[run.status]} · {new Date(run.startedAt).toLocaleDateString('zh-CN')}</span><h3>{run.title}</h3><p>已提交 {run.submittedWorks} 项成果 · 到访 {run.visitedScenes} 处场景</p><button type="button" onClick={()=>void openWorks(run.sessionId)}>查阅已交作品<ArrowRight/></button><button type="button" onClick={()=>navigate(`/teacher/reviews/${encodeURIComponent(run.sessionId)}`)}>查看本次评价<ArrowRight/></button></article>)}
      <h2>人物交往记录</h2><p className="dossier-explanation">这里展示已经发生的认识、联络与引荐。关系参数本身不会直接充当分数。</p>
      {current?.relationships.length?<div className="dossier-relationships">{current.relationships.map((person,index)=><article key={`${person.name}:${index}`}><UserRound/><div><strong>{person.name}</strong><small>{person.friend?'已建立工作联络':person.met?'已认识':'已获引荐线索'}{person.introductions?` · 引荐 ${person.introductions} 人`:''}</small></div></article>)}</div>:<p className="dossier-explanation">尚未形成交往记录。</p>}
    </aside></div>
  </main>:<TeacherArchiveStage classrooms={archive?.classrooms??[]}
    dossiers={(archive?.students??[]).map(student=>{
      const run=student.runs.find(run=>run.sessionId===student.currentSessionId)??student.runs[0];
      return {id:student.studentId,title:student.displayName,collection:student.classroomId??archive?.classrooms?.[0]?.classroomId??'',region:run?.region??'尚未开课',
        subtitle:run?run.title+'。'+statusText[run.status]+'，已提交 '+run.submittedWorks+' 项成果。':'这份档案将持续保留学生的课程、作品与学习评价。',
        coverIndex:run?.coverIndex??5,status:student.runs.length+' 次课程记录',actionLabel:'打开学生档案',
        details:[{title:'当前课程',text:run?run.title+' · '+statusText[run.status]:'尚未开始课程'},
          {title:'评价情况',text:run?.assessment.message??'开始学习并提交作品后，在这里查看评价。'},
          {title:'档案内容',items:['已提交作品与附件','职业行为与过程反馈','历史课程记录']}]};
    })}
    loading={!archive&&!error} error={error} onOpen={async dossier=>setSelected(dossier.id)}
    onRefresh={()=>setRevision(value=>value+1)}/>;
}
