import { useEffect, useRef, useState } from 'react';
import { Plus, Minus, Maximize2, Undo2, Redo2, Trash2, Network, MousePointer2 } from 'lucide-react';
import { characterWorkflowEdges, CharacterWorkflowV3Schema, type CharacterWorkflowV3 } from '@ronggang/contracts';
import './character-workflow-canvas.css';

type Point = { x: number; y: number };
type Flow = CharacterWorkflowV3;
const position = (flow: Flow, id: string): Point => flow.nodes.find(node => node.id === id)?.position ?? {
  x: (flow.nodes.findIndex(node => node.id === id) % 3) * 260 + 60,
  y: Math.floor(flow.nodes.findIndex(node => node.id === id) / 3) * 164 + 70,
};
const edgeKey = (edge: {source: string; target: string}) => edge.source + ':' + edge.target;
export function CharacterWorkflowCanvas({ flow, selected, onSelect, onChange, disabled = false }: {
  flow: Flow; selected: string; onSelect(id: string): void; onChange(flow: Flow): void; disabled?: boolean;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 25, y: 30, zoom: .75 });
  useEffect(()=>{
    const element=viewport.current!;
    const zoomAtPointer=(event:WheelEvent)=>{
      event.preventDefault();
      const rect=element.getBoundingClientRect(),x=event.clientX-rect.left,y=event.clientY-rect.top;
      setView(current=>{const zoom=Math.max(.2,Math.min(2,current.zoom*Math.exp(-event.deltaY*.0015)));return {zoom,x:x-(x-current.x)*zoom/current.zoom,y:y-(y-current.y)*zoom/current.zoom};});
    };
    element.addEventListener('wheel',zoomAtPointer,{passive:false});
    return()=>element.removeEventListener('wheel',zoomAtPointer);
  },[]);
  const [drag, setDrag] = useState<{ id: string; point: Point } | null>(null);
  const [link, setLink] = useState<string | null>(null), [edge, setEdge] = useState<string | null>(null);
  const history = useRef<{ past: Flow[]; future: Flow[] }>({ past: [], future: [] });
  const [, refresh] = useState(0);
  const gesture = useRef<{ id: string | null; start: Point; origin: Point; latest: Point } | null>(null);
  const edges = characterWorkflowEdges(flow), validation = CharacterWorkflowV3Schema.safeParse(flow);
  const commit = (next: Flow) => {
    if (disabled || JSON.stringify(next) === JSON.stringify(flow)) return;
    history.current.past = [...history.current.past.slice(-29), structuredClone(flow)];
    history.current.future = []; onChange(next); refresh(value => value + 1);
  };
  const undo = (redo = false) => {
    if (disabled) return;
    const from = redo ? history.current.future : history.current.past;
    const next = from.pop(); if (!next) return;
    (redo ? history.current.past : history.current.future).push(structuredClone(flow));
    onChange(next); setLink(null); setEdge(null); refresh(value => value + 1);
  };
  const fit = () => {
    const points = flow.nodes.map(node => position(flow, node.id));
    const left = Math.min(...points.map(point => point.x)), top = Math.min(...points.map(point => point.y));
    const width = Math.max(...points.map(point => point.x)) - left + 220, height = Math.max(...points.map(point => point.y)) - top + 124;
    const zoom = Math.min(1, Math.max(.2, Math.min(((viewport.current?.clientWidth ?? 900) - 64) / width, ((viewport.current?.clientHeight ?? 600) - 88) / height)));
    setView({ x: 32 - left * zoom, y: 24 - top * zoom, zoom });
  };
  const connect = (target: string) => {
    if (!link || disabled) return;
    if (link !== target && !edges.some(item => item.source === link && item.target === target)) commit({ ...flow, edges: [...edges, { source: link, target }] });
    setLink(null);
  };
  const add = () => {
    const after = flow.nodes.find(node => node.id === selected && node.kind !== 'reply') ?? flow.nodes.find(node => node.kind === 'decide')!;
    const id = 'instruction-' + crypto.randomUUID().slice(0, 8), point = position(flow, after.id);
    const outgoing = edges.filter(item => item.source === after.id);
    commit({ ...flow, nodes: [...flow.nodes, { id, kind: 'instruction', label: '补充要求', instruction: '结合当前课程目标，补充本阶段的具体要求。', enabled: true, position: { x: point.x + 100, y: point.y + 190 } }],
      edges: [...edges.filter(item => item.source !== after.id), { source: after.id, target: id }, ...outgoing.map(item => ({ source: id, target: item.target }))] });
    onSelect(id);
  };
  const remove = () => {
    if (edge) { commit({ ...flow, edges: edges.filter(item => edgeKey(item) !== edge) }); setEdge(null); return; }
    if (flow.nodes.find(node => node.id === selected)?.kind !== 'instruction') return;
    const joined = edges.filter(item => item.target === selected).flatMap(input => edges.filter(item => item.source === selected).map(output => ({ source: input.source, target: output.target })));
    const nextEdges = [...edges.filter(item => item.source !== selected && item.target !== selected), ...joined];
    commit({ ...flow, nodes: flow.nodes.filter(node => node.id !== selected), edges: [...new Map(nextEdges.map(item => [edgeKey(item), item])).values()] });
    onSelect(flow.nodes[0]!.id);
  };
  // Fit once on entry; subsequent pan and zoom remain under the teacher's control.
  useEffect(()=>{fit();},[]);
  return <section className="workflow-editor" aria-label="专业模式工作流画布">
    <div className="workflow-toolbar"><span><Network/>人物工作流</span><div>
      <button type="button" onClick={add} disabled={disabled || flow.nodes.length >= 24}><Plus/>补充节点</button>
      <button type="button" aria-label="撤销画布操作" disabled={disabled || !history.current.past.length} onClick={() => undo()}><Undo2/></button>
      <button type="button" aria-label="重做画布操作" disabled={disabled || !history.current.future.length} onClick={() => undo(true)}><Redo2/></button>
      <button type="button" aria-label="删除选中连线或补充节点" disabled={disabled || (!edge && flow.nodes.find(node => node.id === selected)?.kind !== 'instruction')} onClick={remove}><Trash2/></button>
    </div></div>
    <div ref={viewport} className={'workflow-viewport' + (link ? ' is-linking' : '')} tabIndex={0}
      onKeyDown={event => { if (event.target !== event.currentTarget) return; if (event.key === 'Escape') {setLink(null);setEdge(null);} if (event.key === 'Delete') remove(); if ((event.ctrlKey || event.metaKey) && event.key === 'z') { event.preventDefault(); undo(event.shiftKey); } }}
      onPointerDown={event => {
        if (event.button !== 0 || (event.target as Element).closest('button,.workflow-edge')) return;
        const node = (event.target as Element).closest<HTMLElement>('[data-flow-node]')?.dataset.flowNode ?? null;
        if (node && disabled) return;
        const origin = node ? position(flow, node) : {x:view.x,y:view.y};
        gesture.current = {id:node,start:{x:event.clientX,y:event.clientY},origin,latest:origin};
        if (node) onSelect(node); setEdge(null); event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.focus();
      }}
      onPointerMove={event => {
        const active = gesture.current; if (!active) return;
        const scale = active.id ? view.zoom : 1;
        active.latest = {x:active.origin.x+(event.clientX-active.start.x)/scale,y:active.origin.y+(event.clientY-active.start.y)/scale};
        if (active.id) setDrag({id:active.id,point:active.latest}); else setView({...view,...active.latest});
      }}
      onPointerUp={event => {
        const active = gesture.current; gesture.current = null; setDrag(null);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        if (active?.id) commit({...flow,nodes:flow.nodes.map(node=>node.id===active.id?{...node,position:active.latest}:node)});
      }} onPointerCancel={() => {gesture.current=null;setDrag(null);}}>
      <div className="workflow-world" style={{transform:`translate(${view.x}px,${view.y}px) scale(${view.zoom})`}}>
        <svg className="workflow-wires" aria-label="工作流连线">
          {edges.map(item => {
            const a=drag?.id===item.source?drag.point:position(flow,item.source),b=drag?.id===item.target?drag.point:position(flow,item.target);
            const x=a.x+220,y=a.y+60,tx=b.x,ty=b.y+60,bend=Math.max(65,Math.abs(tx-x)*.45);
            return <g key={edgeKey(item)} className={'workflow-edge '+(edge===edgeKey(item)?'selected':'')} onClick={()=>{setEdge(edgeKey(item));setLink(null);}}>
              <path d={`M ${x} ${y} C ${x+bend} ${y}, ${tx-bend} ${ty}, ${tx} ${ty}`}/><path className="wire-hit" d={`M ${x} ${y} C ${x+bend} ${y}, ${tx-bend} ${ty}, ${tx} ${ty}`}/>
            </g>;
          })}
        </svg>
        {flow.nodes.map((node,index)=>{
          const point=drag?.id===node.id?drag.point:position(flow,node.id);
          return <div key={node.id} data-flow-node={node.id} className={'workflow-node '+(selected===node.id?'selected ':'')+(!node.enabled?'disabled':'')} style={{left:point.x,top:point.y}}>
            {node.kind!=='understand'?<button type="button" className="node-port input" aria-label={'连入'+node.label} onClick={()=>connect(node.id)}/>:null}
            <button type="button" className="node-select" onClick={()=>{onSelect(node.id);setEdge(null);}}><span>{String(index+1).padStart(2,'0')}<i/></span><strong>{node.label}</strong><small>{node.enabled?'已启用':'已跳过'} · {node.kind==='instruction'?'补充要求':'核心阶段'}</small></button>
            <div className="node-drag-handle" aria-hidden="true">⠿</div>
            {node.kind!=='reply'?<button type="button" className={'node-port output '+(link===node.id?'active':'')} aria-label={'从'+node.label+'连线'} disabled={disabled} onClick={()=>{setLink(link===node.id?null:node.id);setEdge(null);}}/>:null}
          </div>;
        })}
      </div>
      <div className="workflow-view-controls"><button type="button" aria-label="缩小画布" onClick={()=>setView({...view,zoom:Math.max(.2,view.zoom-.1)})}><Minus/></button><span>{Math.round(view.zoom*100)}%</span><button type="button" aria-label="放大画布" onClick={()=>setView({...view,zoom:Math.min(2,view.zoom+.1)})}><Plus/></button><button type="button" aria-label="适应全部节点" onClick={fit}><Maximize2/></button></div>
    </div>
    <footer className={'workflow-caption '+(!validation.success?'invalid':'')} role="status"><MousePointer2/>{link?'选择另一个节点左侧端口完成连线，Esc 取消。':!validation.success?validation.error.issues[0]?.message:'拖动节点边缘或右上角移动 · 空白处平移 · 滚轮缩放 · 点击端口连线'}</footer>
    <p className="workflow-execution-note">各分支的要求按连线顺序汇入回应。知识、记忆和人物行动沿用课程运行内核；发布后用于新开课程。</p>
  </section>;
}
