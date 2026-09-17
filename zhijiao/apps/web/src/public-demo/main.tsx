import {StrictMode,useEffect,useRef,useState,type CSSProperties,type ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import {ArrowLeft,ArrowRight,BookOpen,Download,FileText,Map,MessageCircle,NotebookPen,X} from 'lucide-react';
import {ArchiveStage,type ArchiveDossier} from '../v2/pages/archive-stage';
import {BrandMark} from '../v2/brand-mark';
import {publicAsset} from '../public-asset';
import type {ExplorationLesson,ExplorationPerson} from '../../../../packages/course-content/src/xunpu-exploration-lesson';
import './style.css';

type Person=Pick<ExplorationPerson,'id'|'name'|'role'|'nodeId'|'activity'|'goal'|'greeting'|'topics'|'appearance'>;
type PublicLesson=Pick<ExplorationLesson,'title'|'assignment'|'initialNodeId'|'nodes'|'materials'|'strategies'|'workPlan'>&{people:Person[]};
type CourseSummary={courseId:string;regionId:string;regionTitle:string;shortTitle:string;summary:string;coverIndex:number;assignment:string;initialNodeId:string;sceneCount:number;personCount:number;pathCount:number;lessonFile:string};
type Course=CourseSummary&{lesson:PublicLesson};
declare const __PUBLIC_CATALOG_URL__:string|undefined;
type Draft={nodeId?:string;visited:string[];note:string;works:Record<string,string>};
type Saved={version:1;courses:Record<string,Draft>};
const storageKey='ganglian-public-student-v1';
const emptyDraft=():Draft=>({visited:[],note:'',works:{}});
const emptySaved=():Saved=>({version:1,courses:{}});
function loadSaved():Saved {
  try {
    const value=JSON.parse(localStorage.getItem(storageKey)??'null') as Saved|null;
    if(value?.version!==1||!value.courses)return emptySaved();
    const courses:Saved['courses']={};
    for(const [id,draft] of Object.entries(value.courses))if(draft&&Array.isArray(draft.visited)&&draft.visited.every(item=>typeof item==='string')&&typeof draft.note==='string'&&draft.works&&Object.values(draft.works).every(item=>typeof item==='string'))courses[id]=draft;
    return {version:1,courses};
  } catch {return emptySaved();}
}
function Atlas({image,atlas,className='',style={},children}:{image:string;atlas?:{columns:number;rows:number;index:number}|undefined;className?:string;style?:CSSProperties;children?:ReactNode}) {
  const columns=atlas?.columns??1,rows=atlas?.rows??1,index=atlas?.index??0;
  const ref=useRef<HTMLDivElement>(null),[bounds,setBounds]=useState({width:0,height:0}),[aspect,setAspect]=useState(0),[failed,setFailed]=useState(false);
  useEffect(()=>{const element=ref.current!;const measure=()=>setBounds({width:element.clientWidth,height:element.clientHeight});const observer=new ResizeObserver(measure);observer.observe(element);measure();return()=>observer.disconnect();},[]);
  useEffect(()=>{let cancelled=false;const source=new Image();setAspect(0);setFailed(false);source.decoding='async';source.onload=()=>{if(!cancelled)setAspect(source.naturalWidth*rows/(source.naturalHeight*columns));};source.onerror=()=>{if(!cancelled)setFailed(true);};source.src=publicAsset(image);return()=>{cancelled=true;source.onload=null;source.onerror=null;};},[image,columns,rows]);
  const cellWidth=aspect?(className==='tour-person-art'?Math.min(bounds.width,bounds.height*aspect):Math.max(bounds.width,bounds.height*aspect)):0;
  const cellHeight=aspect?cellWidth/aspect:0;
  return <div ref={ref} className={className} data-loaded={aspect>0?'true':'false'} style={{backgroundImage:aspect?`url("${publicAsset(image)}")`:undefined,backgroundSize:`${cellWidth*columns}px ${cellHeight*rows}px`,backgroundPosition:`${(bounds.width-cellWidth)/2-(index%columns)*cellWidth}px ${(bounds.height-cellHeight)/2-Math.floor(index/columns)*cellHeight}px`,clipPath:className==='tour-person-art'?`inset(${Math.max(0,(bounds.height-cellHeight)/2)}px ${Math.max(0,(bounds.width-cellWidth)/2)}px)`:undefined,...style}}>{children}{className==='tour-scene'&&!aspect?<span className="tour-image-state" role="status">{failed?'场景图片暂时无法载入，地图和资料仍可使用。':'正在载入场景…'}</span>:null}</div>;
}
function Panel({title,children,close}:{title:string;children:ReactNode;close():void}) {
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{ref.current?.showModal();return()=>ref.current?.close();},[]);
  return <dialog ref={ref} className="tour-panel" aria-label={title} onCancel={event=>{event.preventDefault();close();}}><header><h2>{title}</h2><button aria-label="关闭" onClick={close}><X/></button></header><section>{children}</section></dialog>;
}
function download(course:Course,draft:Draft,withNote:boolean) {
  const plan=course.lesson.workPlan;
  const body=['# '+course.shortTitle,'',...((plan?.artifacts??[]).flatMap(artifact=>['## '+artifact.title,'',...artifact.editableFields.flatMap(field=>['### '+field.label,'',draft.works[artifact.artifactId+'/'+field.fieldId]??'（尚未填写）',''])])),...(withNote?['## 我的采访笔记','',draft.note]:[])].join('\n');
  const url=URL.createObjectURL(new Blob([body],{type:'text/markdown;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download=course.shortTitle+'-作品草稿.md';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function Tour({course,draft,update,exit,saveError}:{course:Course;draft:Draft;update(next:Draft):void;exit():void;saveError:boolean}) {
  const [panel,setPanel]=useState<'map'|'materials'|'notes'|'works'|'paths'|null>(null),[person,setPerson]=useState<Person|null>(null),[includeNote,setIncludeNote]=useState(false);
  const lesson=course.lesson,node=lesson.nodes.find(item=>item.id===draft.nodeId)??lesson.nodes.find(item=>item.id===lesson.initialNodeId)??lesson.nodes[0]!;
  const people=lesson.people.filter(item=>item.nodeId===node.id);
  const go=(id:string)=>{update({...draft,nodeId:id,visited:[...new Set([...draft.visited,id])]});setPanel(null);setPerson(null);};
  const mapContent=<><p>公开导览可浏览全部场景。当前位置：{node.title} · 已浏览 {draft.visited.length}/{lesson.nodes.length}</p><div className="tour-map"><svg viewBox="0 0 100 100" aria-hidden="true">{lesson.nodes.flatMap(from=>(from.exits??[]).map(edge=>{const to=lesson.nodes.find(item=>item.id===edge.targetId);return from.map&&to?.map?<line key={from.id+to.id} x1={from.map.x*100} y1={from.map.y*100} x2={to.map.x*100} y2={to.map.y*100}/>:null;}))}</svg>{lesson.nodes.map(item=><button key={item.id} className={(item.id===node.id?'current ':'')+(draft.visited.includes(item.id)?'visited':'')} style={{left:(item.map?.x??.5)*100+'%',top:(item.map?.y??.5)*100+'%'}} onClick={()=>go(item.id)}><span/>{item.title}</button>)}</div></>;
  return <main className="tour-shell"><Atlas className="tour-scene" image={node.image??''} atlas={node.imageAtlas}/><div className="tour-shade"/>
    <header className="tour-header"><button onClick={exit}><ArrowLeft/>课程档案</button><div><strong>{course.regionTitle} · {node.title}</strong><span>{course.shortTitle}</span></div><span className="demo-mode">公开导览</span></header>
    <aside className="tour-brief"><span>现场观察</span><h1>{node.title}</h1><p>{node.description}</p><button onClick={()=>setPanel('paths')}>查看调查路径<ArrowRight size={17}/></button></aside>
    <div className="tour-people">{people.map((item,index)=><button key={item.id} className="tour-person" style={{left:((index+1)/(people.length+1))*100+'%'}} onClick={()=>setPerson(item)}>{item.appearance?<Atlas className="tour-person-art" image={item.appearance.image} atlas={item.appearance.atlas}/>:<MessageCircle/>}<span><strong>{item.name}</strong><small>{item.role}</small></span></button>)}</div>
    <nav className="tour-exits" aria-label="周边地点">{(node.exits??[]).map(edge=>{const target=lesson.nodes.find(item=>item.id===edge.targetId);return target?<button key={target.id} onClick={()=>go(target.id)}>{target.title}<ArrowRight size={16}/></button>:null;})}</nav>
    <nav className="tour-dock" aria-label="学习工具"><button onClick={()=>setPanel('map')}><Map/>地图</button><button onClick={()=>setPanel('materials')}><BookOpen/>资料</button><button onClick={()=>setPanel('notes')}><NotebookPen/>采访本</button><button onClick={()=>setPanel('works')}><FileText/>作品草稿</button></nav>
    <footer className="tour-status">{saveError?'浏览器未能保存，请及时导出草稿。':'笔记和草稿仅保存在当前浏览器。'}<span>实时 AI 与教师评分尚未接入公开站点</span></footer>
    {person?<Panel title={person.name+' · '+person.role} close={()=>setPerson(null)}><p>{person.activity}</p><h3>人物关切</h3><p>{person.goal}</p><h3>预设访谈片段</h3><p>{person.greeting}</p>{person.topics.map(topic=><details key={topic.id} className="tour-reading"><summary>{topic.title}</summary><p>{topic.response}</p></details>)}<p className="tour-muted">以上为课程中已编写的教学片段，不是实时生成的回答。</p></Panel>:null}
    {panel?<Panel title={{map:'探索地图',materials:'课程资料',notes:'我的采访本',works:'作品草稿',paths:'调查路径'}[panel]} close={()=>setPanel(null)}>
      {panel==='map'?mapContent:null}
      {panel==='paths'?<><p>{lesson.assignment}</p>{lesson.strategies.map(path=><article className="tour-reading" key={path.id}><h3>{path.title}</h3><p>{path.question}</p><div className="tour-links">{path.evidenceNpcIds.flatMap(id=>{const actor=lesson.people.find(item=>item.id===id);return actor?[<button key={id} onClick={()=>go(actor.nodeId)}>前往{lesson.nodes.find(item=>item.id===actor.nodeId)?.title} · {actor.name}</button>]:[];})}</div></article>)}</>:null}
      {panel==='materials'?<>{[...lesson.materials].sort((a,b)=>Number(b.nodeId===node.id)-Number(a.nodeId===node.id)).map(material=><details key={material.id} className="tour-reading"><summary>{material.title}<small>{material.kind==='public_source'?'公开来源':'教学仿真材料'}</small></summary><p>{material.description}</p><p className="tour-material-body">{material.body}</p><p className="tour-muted">{material.locator}</p>{material.sourceUrl&&/^https?:\/\//.test(material.sourceUrl)?<a href={material.sourceUrl} target="_blank" rel="noreferrer">查阅来源<ArrowRight size={15}/></a>:null}</details>)}</>:null}
      {panel==='notes'?<><p>随时记录观察、原话和待核实的问题。导出作品时，你可以选择是否附上这些笔记。</p><textarea className="tour-note" aria-label="采访笔记" placeholder="我看到了什么？还需要向谁核实？" value={draft.note} onChange={event=>update({...draft,note:event.target.value})}/><p className="tour-muted">{saveError?'未能写入浏览器存储，请导出。':'自动保存到当前浏览器，不上传服务器。'}</p></>:null}
      {panel==='works'?<><p>{lesson.workPlan?.title}</p>{lesson.workPlan?.artifacts.map(artifact=><section className="tour-reading" key={artifact.artifactId}><h3>{artifact.title}</h3>{artifact.editableFields.map(field=><label className="tour-field" key={field.fieldId}>{field.label}<textarea rows={5} maxLength={field.maximumLength} value={draft.works[artifact.artifactId+'/'+field.fieldId]??''} onChange={event=>update({...draft,works:{...draft.works,[artifact.artifactId+'/'+field.fieldId]:event.target.value}})}/></label>)}</section>)}<div className="tour-export"><label><input type="checkbox" checked={includeNote} onChange={event=>setIncludeNote(event.target.checked)}/>导出时附上我的采访笔记</label><button onClick={()=>download(course,draft,includeNote)}><Download/>导出作品草稿</button><small>下载为 Markdown 文件，本次操作不会向教师提交或生成评分。</small></div></>:null}
    </Panel>:null}
  </main>;
}
function PublicDemo() {
  const [courses,setCourses]=useState<CourseSummary[]>([]),[error,setError]=useState(''),[selected,setSelected]=useState<string|null>(null),[saved,setSaved]=useState<Saved>(loadSaved),[saveError,setSaveError]=useState(false),[about,setAbout]=useState(false);
  const [lessons,setLessons]=useState<Record<string,PublicLesson>>({}),[lessonError,setLessonError]=useState(''),[retry,setRetry]=useState(0);
  useEffect(()=>{const controller=new AbortController();const url=typeof __PUBLIC_CATALOG_URL__==='undefined'?'./catalog.json':__PUBLIC_CATALOG_URL__!;void fetch(url,{signal:controller.signal}).then(response=>{if(!response.ok)throw new Error('课程资料暂时无法读取');return response.json() as Promise<CourseSummary[]>;}).then(setCourses).catch(cause=>{if(!controller.signal.aborted)setError(String(cause));});return()=>controller.abort();},[]);
  useEffect(()=>{const save=()=>{try{localStorage.setItem(storageKey,JSON.stringify(saved));setSaveError(false);}catch{setSaveError(true);}};const timer=setTimeout(save,250);window.addEventListener('pagehide',save);return()=>{clearTimeout(timer);window.removeEventListener('pagehide',save);};},[saved]);
  useEffect(()=>{const change=()=>setSelected(new URLSearchParams(location.hash.slice(1)).get('course'));window.addEventListener('hashchange',change);change();return()=>window.removeEventListener('hashchange',change);},[]);
  const summary=courses.find(item=>item.courseId===selected),lesson=summary?lessons[summary.courseId]:undefined;
  useEffect(()=>{
    setLessonError('');
    if(!summary||lesson)return;
    const controller=new AbortController();
    void fetch('./'+summary.lessonFile,{signal:controller.signal}).then(response=>{if(!response.ok)throw new Error('本课资料暂时无法读取，请重试。');return response.json() as Promise<PublicLesson>;}).then(value=>{if(!controller.signal.aborted)setLessons(current=>({...current,[summary.courseId]:value}));}).catch(cause=>{if(!controller.signal.aborted)setLessonError(cause instanceof Error?cause.message:'本课资料暂时无法读取');});
    return()=>controller.abort();
  },[summary,lesson,retry]);
  const open=async(dossier:ArchiveDossier)=>{const target=courses.find(item=>item.courseId===dossier.id)!;setSaved(current=>({...current,courses:{...current.courses,[target.courseId]:current.courses[target.courseId]??{...emptyDraft(),nodeId:target.initialNodeId,visited:[target.initialNodeId]}}}));location.hash=new URLSearchParams({course:target.courseId}).toString();};
  if(summary&&lesson){const course={...summary,lesson};return <Tour key={course.courseId} course={course} draft={saved.courses[course.courseId]??emptyDraft()} update={draft=>setSaved(current=>({...current,courses:{...current.courses,[course.courseId]:draft}}))} exit={()=>{location.hash='';}} saveError={saveError}/>;}
  if(summary)return <main className="tour-course-loading"><h1>{summary.shortTitle}</h1><p role={lessonError?'alert':'status'}>{lessonError||'正在打开本课资料…'}</p>{lessonError?<button onClick={()=>setRetry(value=>value+1)}>重新载入</button>:null}<button onClick={()=>{location.hash='';}}>返回课程档案</button></main>;
  return <div className="v3-shell"><header className="v3-topbar"><button className="v3-brand" onClick={()=>{location.hash='';}}><BrandMark/><span>职教星云</span></button><nav><button className="active">课程</button><button onClick={()=>setAbout(true)}>使用说明</button><a href="https://github.com/falling-feather/ganglian-zhixun" target="_blank" rel="noreferrer">项目源码</a></nav><span className="demo-mode">学生端 · 公开导览</span></header><div className="v3-shell-body"><ArchiveStage title="我的课程档案" loading={!courses.length&&!error} error={error} dossiers={courses.map(item=>({id:item.courseId,title:item.shortTitle,region:item.regionTitle,subtitle:item.summary,coverIndex:item.coverIndex,duration:'完整课程约45–60分钟',actionLabel:'进入课程导览',details:[{title:'课程任务',text:item.assignment},{title:'可以探索',items:[item.sceneCount+'个场景 · '+item.personCount+'名课程人物',item.pathCount+'条调查路径','课程资料、私人笔记与作品草稿']}]}))} onOpen={open} /></div>{about?<Panel title="公开导览使用说明" close={()=>setAbout(false)}><p>你可以浏览课程档案，自由探索三地区的场景与人物，阅读课程资料、查看预设访谈片段，并整理和导出自己的笔记、作品草稿。</p><p>这是无需登录的公开导览。完整系统的实时人物智能体、关系学习、教师评分与云端提交需要后端服务，目前没有接入这两个公开站点。</p><p>记录仅保存在当前浏览器，清除浏览器数据会移除这些记录。导出作品时默认不附带私人笔记。</p><p>场景、人物和事件为教学仿真；资料中标明的公开来源可另行查阅。</p></Panel>:null}</div>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><PublicDemo/></StrictMode>);
