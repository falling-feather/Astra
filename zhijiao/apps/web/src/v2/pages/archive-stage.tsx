import {useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {ArrowUpRight,ChevronDown,Grid2X2,LoaderCircle,MapPin,Mouse,Search,SlidersHorizontal} from 'lucide-react';
import {ArchiveCover} from './archive-field/cover';
import {ArchiveReader} from './archive-field/reader';
import type {ArchiveAnchor,ArchiveFieldRenderer} from './archive-field/renderer';
import type {ArchiveDossier} from './archive-field/types';
import './archive.css';
export type {ArchiveDossier} from './archive-field/types';

export function ArchiveStage({title,dossiers,onOpen,error,loading=false,audience='student',footer}:{
  title:string;dossiers:readonly ArchiveDossier[];onOpen(dossier:ArchiveDossier):Promise<void>;
  error?:string|null;loading?:boolean;audience?:'student'|'teacher';footer?:ReactNode;
}) {
  const canvas=useRef<HTMLCanvasElement>(null),engine=useRef<ArchiveFieldRenderer|null>(null);
  const line=useRef<SVGPathElement>(null),number=useRef<HTMLSpanElement>(null);
  const [hovered,setHovered]=useState<string|null>(null);
  const [reader,setReader]=useState<{id:string;origin:ArchiveAnchor|null}|null>(null);
  const [expanded,setExpanded]=useState(false),[query,setQuery]=useState(''),[region,setRegion]=useState('');
  const [collection,setCollection]=useState<string|null>(null),[reduced,setReduced]=useState(false);
  const [ready,setReady]=useState(false),[renderError,setRenderError]=useState<string|null>(null),[attempt,setAttempt]=useState(0);
  const regions=useMemo(()=>[...new Set(dossiers.map(item=>item.region))],[dossiers]);
  const collections=useMemo(()=>[...new Set(dossiers.flatMap(item=>item.collection?[item.collection]:[]))],[dossiers]);
  const activeCollection=collection??collections[0]??'';
  const visible=useMemo(()=>{
    const term=query.trim().toLocaleLowerCase();
    return dossiers.filter(item=>(!region||item.region===region)&&(!activeCollection||item.collection===activeCollection)
      &&(!term||(item.title+' '+item.region+' '+item.subtitle).toLocaleLowerCase().includes(term)));
  },[dossiers,region,activeCollection,query]);
  const idsKey=JSON.stringify(visible.map(item=>item.id));
  const ids=useRef<readonly string[]>([]);ids.current=visible.map(item=>item.id);
  const preferences=useRef({reduced,expanded});preferences.current={reduced,expanded};
  const hoveredRef=useRef<string|null>(null);
  const active=visible.find(item=>item.id===hovered);
  const selected=dossiers.find(item=>item.id===reader?.id);

  useEffect(()=>{
    const media=matchMedia('(prefers-reduced-motion: reduce)');
    const update=()=>setReduced(media.matches||document.documentElement.dataset.reducedMotion==='true');
    const observer=new MutationObserver(update);observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-reduced-motion']});
    media.addEventListener('change',update);update();
    return()=>{observer.disconnect();media.removeEventListener('change',update);};
  },[]);
  useEffect(()=>{
    let cancelled=false;setReady(false);setRenderError(null);
    const controller=new AbortController();
    const current=canvas.current!;
    void import('./archive-field/renderer').then(module=>module.ArchiveFieldRenderer.create(current,{
      hover(id){hoveredRef.current=id;setHovered(id);},
      anchor(anchor){
        if(!anchor)return;
        if(line.current){
          const width=current.clientWidth,height=current.clientHeight;
          const x=width*.052+Math.min(350,width*.23),y=height*.255+12;
          const path='M '+x+' '+y+' L '+(x+28)+' '+(y-20)+' L '+(anchor.tabX-12)+' '+(anchor.tabY-18)+' L '+anchor.tabX+' '+anchor.tabY;
          if(line.current.getAttribute('d')!==path)line.current.setAttribute('d',path);
        }
        if(number.current){number.current.style.left=anchor.tabX+'px';number.current.style.top=anchor.tabY+'px';}
      },
    },controller.signal)).then(value=>{
      if(cancelled){value.dispose();return;}
      engine.current=value;value.setDossiers(ids.current);
      value.setReducedMotion(preferences.current.reduced);value.setExpanded(preferences.current.expanded);setReady(true);
    }).catch(cause=>{
      if(!cancelled){setRenderError(cause instanceof Error?cause.message:'空间画面未能载入');setExpanded(true);}
    });
    return()=>{cancelled=true;controller.abort();engine.current?.dispose();engine.current=null;};
  },[attempt]);
  useEffect(()=>{engine.current?.setDossiers(ids.current);setHovered(null);hoveredRef.current=null;},[idsKey]);
  useEffect(()=>{engine.current?.setReducedMotion(reduced);},[reduced]);
  useEffect(()=>{engine.current?.setExpanded(expanded);},[expanded]);

  const focus=(id:string)=>{engine.current?.focusDossier(id);hoveredRef.current=id;setHovered(id);};
  const open=(id:string,preserve=false)=>{
    if(reader)return;
    if(!preserve||hoveredRef.current!==id)focus(id);
    const origin=engine.current?.getAnchor()??null;
    engine.current?.setExtracted(true);setReader({id,origin});
  };
  const close=()=>{engine.current?.setExtracted(false);engine.current?.clearPointer();setReader(null);};
  const state=reader?'detail':hovered?'hover':'idle';
  return <>
    <main className={'v3-archive '+(expanded?'is-expanded ':'')+(renderError?'has-render-error ':'')}
      data-state={state} data-ready={ready&&!loading&&!error?'true':'false'}
      onPointerMove={event=>{
        if(reader||event.pointerType==='touch')return;
        if(event.target!==canvas.current){
          if(event.target instanceof Element&&!event.target.closest('.archive-preview,.archive-index'))engine.current?.clearPointer();
          return;
        }
        const bounds=event.currentTarget.getBoundingClientRect();
        engine.current?.pointerAt(event.clientX-bounds.left,event.clientY-bounds.top);
      }}
      onPointerLeave={()=>{if(!reader)engine.current?.clearPointer();}}>
      <h1 className="archive-visually-hidden">{title}</h1>
      <canvas ref={canvas} className="archive-field-canvas" aria-hidden="true"
        onClick={event=>{
          if(reader)return;const bounds=event.currentTarget.getBoundingClientRect();
          const id=engine.current?.pointerAt(event.clientX-bounds.left,event.clientY-bounds.top);
          if(id)open(id,true);
        }}/>
      <div className="archive-focus-filter" aria-hidden="true"/>
      <div className="archive-atmosphere" aria-hidden="true"/>
      <header className="archive-tools">
        <label className="archive-search"><Search size={19}/><span className="archive-visually-hidden">{audience==='teacher'?'搜索学生或课程':'搜索课程、主题或关键词'}</span>
          <input type="search" value={query} onChange={event=>setQuery(event.target.value)}
            onFocus={()=>engine.current?.clearPointer()} placeholder={audience==='teacher'?'搜索学生、课程…':'搜索课程、主题或关键词'}/></label>
        <details className="archive-filters"><summary><MapPin size={18}/><span>{region||'全部地区'}</span><ChevronDown size={13}/></summary>
          <div className="archive-filter-menu">
            <label>地区<select aria-label="筛选地区" value={region} onChange={event=>setRegion(event.target.value)}>
              <option value="">全部地区</option>{regions.map(value=><option key={value}>{value}</option>)}</select></label>
            {collections.length>1?<label>档案类型<select aria-label="档案类型" value={activeCollection} onChange={event=>setCollection(event.target.value)}>
              {collections.map(value=><option key={value}>{value}</option>)}<option value="">全部档案</option></select></label>:null}
          </div>
        </details>
      </header>
      {(loading||!ready&&!renderError)?<div className="archive-loading" role="status"><LoaderCircle className="spin" size={20}/>正在展开档案室</div>:null}
      {error&&!reader?<p className="archive-message" role="alert">{error}</p>:null}
      {renderError?<div className="archive-render-message"><p>空间画面暂时无法显示，可以从档案目录继续。</p><button type="button" onClick={()=>setAttempt(value=>value+1)}>重新载入画面</button></div>:null}
      {!loading&&ready&&!visible.length?<p className="archive-empty">{dossiers.length?'没有符合筛选条件的档案。':'这里暂时没有档案。'}</p>:null}
      {active&&!reader&&!expanded?<aside className="archive-preview" aria-label={active.title+'预览'} key={active.id}>
        <h2>{active.title}</h2><p className="archive-preview-meta">{active.region}{active.duration?' · '+active.duration:''}</p>
        <ArchiveCover dossier={active}/>
        <p className="archive-preview-description">{active.subtitle.match(/^[^。！？]+[。！？]?/u)?.[0]??active.subtitle}</p>
        <button type="button" className="archive-preview-open" onClick={()=>open(active.id,true)}>点击抽出档案<ArrowUpRight size={20}/></button>
      </aside>:null}
      {active&&!reader&&!expanded?<><svg className="archive-connector" aria-hidden="true"><path ref={line}/></svg>
        <span ref={number} className="archive-focus-number" aria-hidden="true">{String(dossiers.findIndex(item=>item.id===active.id)+1).padStart(2,'0')}</span></>:null}
      <nav className={'archive-index '+(expanded||renderError?'is-visible':'')} aria-label={audience==='teacher'?'学生档案目录':'课程目录'}>
        {visible.map(item=><button type="button" className={'v3-dossier '+(hovered===item.id?'is-focused':'')} data-dossier-id={item.id}
          aria-label={'查看档案：'+item.region+' · '+item.title} key={item.id} onFocus={()=>focus(item.id)}
          onPointerEnter={()=>{if(expanded)focus(item.id);}} onClick={()=>open(item.id,true)}>
          <span className="archive-index-number">{String(dossiers.findIndex(dossier=>dossier.id===item.id)+1).padStart(2,'0')}</span><span><strong>{item.title}</strong><small>{item.region}{item.duration?' · '+item.duration:''}</small></span><ArrowUpRight size={18}/>
        </button>)}
      </nav>
      <footer className="archive-footer">
        <span className="archive-guide"><Mouse size={20}/><span>移动鼠标，探索{audience==='teacher'?'学生':'课程'}档案</span></span>
        {footer?<div className="archive-status-slot">{footer}</div>:null}
        <button type="button" className="v3-archive-expand" aria-expanded={expanded} onClick={()=>{setExpanded(value=>!value);engine.current?.clearPointer();}}>
          {expanded?<SlidersHorizontal size={19}/>:<Grid2X2 size={19}/>}<span>{audience==='student'?(expanded?'收拢课程':'展开课程'):(expanded?'收拢档案':'展开档案')}</span><ArrowUpRight size={17}/>
        </button>
      </footer>
    </main>
    {selected&&reader?<ArchiveReader key={reader.id} dossier={selected} index={dossiers.findIndex(item=>item.id===reader.id)}
      audience={audience} origin={reader.origin} reduced={reduced} error={error??null} onClose={close} onEnter={onOpen}/>:null}
  </>;
}
