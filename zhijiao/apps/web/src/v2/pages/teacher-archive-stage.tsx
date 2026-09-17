import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, ChevronDown, Grid2X2, LoaderCircle, Mouse, RefreshCw, Search, SlidersHorizontal, Users } from 'lucide-react';
import { ArchiveReader } from './archive-field/reader';
import type { ArchiveDossier } from './archive-field/types';
import type { FolderAnchor, TeacherArchiveRenderer } from './teacher-archive-field/renderer';
import { createTeacherDossierSlots } from './teacher-archive-field/data';
import './archive.css';
import './teacher-archive-stage.css';

export function TeacherArchiveStage({ dossiers, classrooms, loading, error, onOpen, onRefresh }: {
  dossiers: readonly ArchiveDossier[]; classrooms: readonly { classroomId: string; name: string }[];
  loading: boolean; error: string | null; onOpen(dossier: ArchiveDossier): Promise<void>; onRefresh(): void;
}) {
  const canvas=useRef<HTMLCanvasElement>(null),engine=useRef<TeacherArchiveRenderer|null>(null),line=useRef<SVGPathElement>(null);
  const [classId,setClassId]=useState(''),[query,setQuery]=useState(''),[expanded,setExpanded]=useState(false);
  const [hover,setHover]=useState<string|null>(null),[moving,setMoving]=useState(false),[ready,setReady]=useState(false),[renderError,setRenderError]=useState<string|null>(null);
  const [reader,setReader]=useState<{id:string;origin:FolderAnchor|null}|null>(null),[reduced,setReduced]=useState(false);
  const currentClass=classrooms.find(item=>item.classroomId===classId)??classrooms[0];
  const [laneIds,setLaneIds]=useState<string[]>([]);
  const lanes=(laneIds.length?laneIds:classrooms.slice(0,4).map(item=>item.classroomId)).flatMap(id=>{
    const classroom=classrooms.find(item=>item.classroomId===id);return classroom?[classroom]:[];
  });
  const dataKey=JSON.stringify({lanes,dossiers:dossiers.filter(item=>lanes.some(lane=>lane.classroomId===item.collection))});
  const slots=useMemo(()=>createTeacherDossierSlots(lanes,dossiers),[dataKey]);
  const latest=useRef({slots,lanes,classId:currentClass?.classroomId,expanded,reduced});latest.current={slots,lanes,classId:currentClass?.classroomId,expanded,reduced};
  const pending=useRef<number|null>(null),hoveredSlot=useRef<number|null>(null);
  useEffect(()=>{
    const media=matchMedia('(prefers-reduced-motion: reduce)');
    const update=()=>setReduced(media.matches||document.documentElement.dataset.reducedMotion==='true');update();
    const observer=new MutationObserver(update);observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-reduced-motion']});media.addEventListener('change',update);
    return()=>{observer.disconnect();media.removeEventListener('change',update);};
  },[]);
  useEffect(()=>{
    if(loading||!classrooms.length)return;
    const controller=new AbortController();setReady(false);setRenderError(null);
    void import('./teacher-archive-field/renderer').then(module=>module.TeacherArchiveRenderer.create(canvas.current!,slots,{
      hover(id){hoveredSlot.current=id;setHover(id===null?null:latest.current.slots[id]?.recordId??null);},
      anchor(anchor){if(line.current&&anchor){const w=canvas.current!.clientWidth,h=canvas.current!.clientHeight,x=w*.05+Math.min(290,w*.23),y=h*.33;line.current.setAttribute('d',`M ${x} ${y} L ${x+30} ${y-18} L ${anchor.tabX} ${anchor.tabY}`);}},
      failure(message){setRenderError(message);setExpanded(true);},
      classProgress(value){setMoving(value.busy);},
      classSettled(row){const id=latest.current.lanes[row]?.classroomId;if(id)setClassId(id);if(pending.current!==null){const target=latest.current.slots[pending.current];pending.current=null;if(target?.recordId){const origin=engine.current?.focusStudent(target.id)??null;engine.current?.setExtracted(true);setReader({id:target.recordId,origin});}}},
    },controller.signal)).then(value=>{
      if(controller.signal.aborted){value.dispose();return;}engine.current=value;value.setReducedMotion(latest.current.reduced);value.setExpanded(latest.current.expanded);
      const row=latest.current.lanes.findIndex(item=>item.classroomId===latest.current.classId);if(row>0)value.requestClass(row);
      const first=latest.current.slots.find(item=>item.classId===Math.max(0,row)&&item.recordId);
      if(first){value.focusStudent(first.id);value.clearPointer();}setReady(true);
    }).catch(cause=>{if(!controller.signal.aborted){setRenderError(cause instanceof Error?cause.message:'档案画面未载入');setExpanded(true);}});
    return()=>{controller.abort();engine.current?.dispose();engine.current=null;};
  },[dataKey,loading]);
  useEffect(()=>{engine.current?.setReducedMotion(reduced);},[reduced]);
  useEffect(()=>{engine.current?.setExpanded(expanded);},[expanded]);
  const chooseClass=(id:string)=>{
    setClassId(id);setQuery('');setHover(null);setReader(null);pending.current=null;
    const row=lanes.findIndex(item=>item.classroomId===id);
    if(row>=0)engine.current?.requestClass(row);
    else {
      const front=lanes[engine.current?.classState.front??0]?.classroomId;
      const retained=[...new Set([...(front?[front]:[]),...lanes.map(item=>item.classroomId)])].filter(value=>value!==id).slice(0,3);
      setLaneIds([...retained,id]);
    }
  };
  const findSlot=(id:string,index=hoveredSlot.current)=>{
    const hovered=index===null?undefined:slots[index];
    return hovered?.recordId===id?hovered:slots.find(item=>item.recordId===id);
  };
  const focus=(id:string)=>{const slot=findSlot(id);if(slot){hoveredSlot.current=slot.id;engine.current?.focusStudent(slot.id);}setHover(id);};
  const open=(id:string,index=hoveredSlot.current)=>{
    const slot=findSlot(id,index);if(!slot)return;
    if(engine.current&&engine.current.classState.front!==slot.classId){pending.current=slot.id;engine.current.requestClass(slot.classId);return;}
    const origin=(slot.id===hoveredSlot.current?engine.current?.anchor():engine.current?.focusStudent(slot.id))??null;engine.current?.setExtracted(true);setReader({id,origin});
  };
  const close=()=>{engine.current?.setExtracted(false);engine.current?.clearPointer();setReader(null);};
  const filtered=dossiers.filter(item=>(!currentClass||item.collection===currentClass.classroomId)&&(!query.trim()||(item.title+' '+item.subtitle).includes(query.trim())));
  const selected=dossiers.find(item=>item.id===reader?.id),active=dossiers.find(item=>item.id===hover);
  return <><main className={'teacher-archive-home '+(expanded||query?'is-expanded':'')} data-state={reader?'detail':hover?'hover':'idle'}
    onPointerMove={event=>{if(reader||moving||event.pointerType==='touch')return;if(event.target===canvas.current){const bounds=event.currentTarget.getBoundingClientRect();engine.current?.pointerAt(event.clientX-bounds.left,event.clientY-bounds.top);}else if(!(event.target as Element).closest('.teacher-archive-preview,.teacher-directory'))engine.current?.clearPointer();}}
    onPointerLeave={()=>{if(!reader)engine.current?.clearPointer();}}>
    <h1 className="archive-visually-hidden">学生档案</h1><canvas ref={canvas} className="teacher-archive-canvas" aria-hidden="true" onClick={event=>{if(reader||moving)return;const rect=event.currentTarget.getBoundingClientRect();const index=engine.current?.pointerAt(event.clientX-rect.left,event.clientY-rect.top);const id=index===null||index===undefined?null:slots[index]?.recordId;if(id)open(id,index);}}/>
    <div className="teacher-archive-light" aria-hidden="true"/>
    <header className="archive-tools teacher-archive-tools"><label className="archive-search teacher-archive-search"><Search size={19}/><input type="search" aria-label="搜索学生姓名或课程" placeholder="搜索学生姓名或课程" value={query} onChange={event=>setQuery(event.target.value)}/></label>
      <label className="teacher-class-select"><Users size={18}/><span>班级</span><select aria-label="选择班级" value={currentClass?.classroomId??''} onChange={event=>chooseClass(event.target.value)} disabled={!classrooms.length}>{classrooms.length?classrooms.map(item=><option key={item.classroomId} value={item.classroomId}>{item.name}</option>):<option value="">暂无班级</option>}</select><ChevronDown size={14}/></label>
    </header>
    {(loading||!ready&&!renderError&&classrooms.length>0)?<p className="teacher-archive-message" role="status"><LoaderCircle className="spin"/>正在打开学生档案…</p>:null}
    {error||renderError?<p className="teacher-archive-message" role="alert">{error??renderError}</p>:null}
    {!loading&&!classrooms.length&&!error?<p className="teacher-archive-message">当前身份暂无可管理的班级。</p>:null}
    {active&&!reader&&!expanded&&!query?<><aside className="teacher-archive-preview"><span>STUDENT / 学生档案</span><h2>{active.title}</h2><p>{active.subtitle}</p><small>{active.status}</small><button type="button" onClick={()=>open(active.id)}>抽出学生档案<ArrowUpRight/></button></aside><svg className="teacher-archive-connector" aria-hidden="true"><path ref={line}/></svg></>:null}
    {(expanded||query||renderError)&&!reader?<nav className="teacher-directory" aria-label="学生档案目录"><header><h2>{currentClass?.name??'学生档案'}</h2><span>{filtered.length} 名学生</span></header><div>{filtered.map(item=><button type="button" key={item.id} onPointerEnter={()=>focus(item.id)} onFocus={()=>focus(item.id)} onClick={()=>open(item.id)}><span><strong>{item.title}</strong><small>{item.subtitle}</small></span><ArrowUpRight/></button>)}</div>{!filtered.length?<p>没有符合条件的学生。</p>:null}</nav>:null}
    <footer className="archive-footer teacher-archive-footer"><span className="archive-guide"><Mouse size={20}/><span>{moving?'正在调取班级档案…':'移动鼠标，探索学生档案'}</span></span><div className="archive-status-slot teacher-refresh-slot"><button type="button" className="teacher-refresh" aria-label="刷新学生档案" onClick={onRefresh}><RefreshCw size={18}/></button></div><button type="button" className="v3-archive-expand teacher-expand" aria-expanded={expanded} onClick={()=>{setExpanded(!expanded);engine.current?.clearPointer();}}>{expanded?<SlidersHorizontal size={19}/>:<Grid2X2 size={19}/>}<span>{expanded?'收拢档案':'展开档案'}</span><ArrowUpRight size={17}/></button></footer>
  </main>{selected&&reader?<ArchiveReader key={reader.id} dossier={selected} index={dossiers.findIndex(item=>item.id===selected.id)} audience="teacher" origin={reader.origin} reduced={reduced} onClose={close} onEnter={onOpen}/>:null}</>;
}
