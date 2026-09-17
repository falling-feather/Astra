import {useEffect,useRef,useState} from 'react';
import {ArrowUpRight,LoaderCircle,X} from 'lucide-react';
import {ArchiveCover} from './cover';
import type {ArchiveDossier} from './types';
import type {ArchiveAnchor} from './renderer';

export function ArchiveReader({dossier,index,audience,origin,reduced,error,onClose,onEnter}:{
  dossier:ArchiveDossier;index:number;audience:'student'|'teacher';origin:ArchiveAnchor|null;
  reduced:boolean;error?:string|null;onClose():void;onEnter(dossier:ArchiveDossier):Promise<void>;
}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const animation=useRef<Animation|null>(null);
  const starting=useRef('translate3d(-240px,0,0) scale(.42) rotateY(-40deg)');
  const [busy,setBusy]=useState(false),[closing,setClosing]=useState(false),[entryError,setEntryError]=useState<string|null>(null);
  useEffect(()=>{
    const element=dialog.current!;element.showModal();element.focus({preventScroll:true});
    const finishTransform=getComputedStyle(element).transform;
    const bounds=element.getBoundingClientRect();
    if(origin&&window.innerWidth>700) {
      const dx=origin.x-(bounds.left+bounds.width/2);
      const dy=Math.max(-90,Math.min(90,origin.y-(bounds.top+bounds.height/2)));
      starting.current='perspective(1800px) translate3d('+dx+'px,'+dy+'px,0) scale('+Math.max(.22,origin.width/bounds.width)+','+Math.max(.28,origin.height/bounds.height)+') rotateY(-38deg) rotateZ(0deg)';
    }
    animation.current=element.animate([
      {transform:starting.current,opacity:.5},
      {transform:finishTransform,opacity:1},
    ],{duration:reduced?0:650,easing:'cubic-bezier(.2,.75,.15,1)'});
    void animation.current.finished.then(()=>{element.dataset.settled='true';}).catch(()=>{});
    return()=>{animation.current?.cancel();element.close();};
  },[]);
  const close=()=>{
    if(busy||closing)return;
    setClosing(true);
    const element=dialog.current!;
    const current=getComputedStyle(element).transform;
    animation.current?.cancel();
    animation.current=element.animate([{transform:current,opacity:1},{transform:starting.current,opacity:0}],
      {duration:reduced?0:420,easing:'cubic-bezier(.35,0,.65,1)',fill:'both'});
    void animation.current.finished.then(onClose).catch(()=>{});
  };
  const enter=async()=>{
    if(busy)return;setBusy(true);setEntryError(null);
    try{await onEnter(dossier);}catch(cause){setEntryError(cause instanceof Error?cause.message:'暂时无法打开，请重试。');}
    finally{setBusy(false);}
  };
  const sections=dossier.details??[{title:audience==='teacher'?'当前课程':'课程任务',text:dossier.subtitle}];
  return <dialog ref={dialog} className={"archive-reader"+(audience==='teacher'?' is-teacher':'')} tabIndex={-1} aria-label={dossier.title+'档案详情'} aria-busy={busy}
    onCancel={event=>{event.preventDefault();close();}}>
    <span className="archive-reader-back" aria-hidden="true"/>
    <span className="archive-reader-pages" aria-hidden="true"/>
    <span className="archive-reader-flap" aria-hidden="true"><i/><i/></span>
    <article className="archive-reader-sheet">
      <span className="archive-reader-tab" aria-hidden="true">{String(index+1).padStart(2,'0')}</span>
      <header><span>{audience==='teacher'?'学生档案':'课程档案'} / {String(index+1).padStart(2,'0')}</span>
        <button type="button" onClick={close} disabled={busy||closing} aria-label="收回档案">收回档案<X size={17}/></button></header>
      <div className="archive-reader-scroll">
        <h2>{dossier.title}</h2><p className="archive-reader-meta">{dossier.region}{dossier.duration?' · '+dossier.duration:''}</p>
        {audience==='student'?<ArchiveCover dossier={dossier}/>:null}
        {sections.map(section=><section className="archive-reader-section" key={section.title}><h3>{section.title}</h3>
          {section.text?<p>{section.text}</p>:null}
          {section.items?<ul>{section.items.map(item=><li key={item}>{item}</li>)}</ul>:null}
        </section>)}
        {dossier.status?<p className="archive-reader-status">{dossier.status}</p>:null}
        {error||entryError?<p className="archive-reader-error" role="alert">{error||entryError}</p>:null}
      </div>
      <footer><button type="button" className="archive-reader-enter" disabled={busy||closing} onClick={()=>void enter()}>
        {busy?<LoaderCircle className="spin" size={19}/>:null}{busy?'正在打开':dossier.actionLabel}{!busy?<ArrowUpRight size={22}/>:null}
      </button></footer>
    </article>
  </dialog>;
}
