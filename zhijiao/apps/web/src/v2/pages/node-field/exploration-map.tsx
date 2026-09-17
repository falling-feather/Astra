import { Compass, LockKeyhole, MapPin } from "lucide-react";
import type { FieldInterviewViewV1 } from "@ronggang/contracts";
import "./exploration-map.css";

export function ExplorationMap({ view, compact = false, busy, onNavigate, onExpand }: {
  view: FieldInterviewViewV1; compact?: boolean; busy?: boolean;
  onNavigate(id: string): void; onExpand?(): void;
}) {
  const known = view.nodes.filter(node => node.discovered !== false);
  const nearby=new Set([view.nodeId,...(known.find(node=>node.id===view.nodeId)?.exits??[]).map(exit=>exit.targetId)]);
  const positioned = known.filter(node=>!compact||nearby.has(node.id)).map((node, index) => ({ ...node, point: node.map ?? { x: .16 + index % 3 * .33, y: .2 + Math.floor(index / 3) * .28 } }));
  const edges = new Map<string, { from: typeof positioned[number]; to: typeof positioned[number] }>();
  for (const node of positioned) for (const exit of node.exits ?? []) {
    const target = positioned.find(value => value.id === exit.targetId);
    if (target) edges.set([node.id, target.id].sort().join(":"), { from: node, to: target });
  }
  const current = known.find(node => node.id === view.nodeId);
  const minX=Math.min(...positioned.map(node=>node.point.x*540+30))-65,maxX=Math.max(...positioned.map(node=>node.point.x*540+30))+65;
  const minY=Math.min(...positioned.map(node=>node.point.y*330+25))-35,maxY=Math.max(...positioned.map(node=>node.point.y*330+25))+72;
  const box=compact&&positioned.length?`${minX} ${minY} ${Math.max(220,maxX-minX)} ${Math.max(145,maxY-minY)}`:'0 0 600 400';
  const graph = <svg viewBox={box} role="img" aria-label={`探索地图，当前位置${current?.title ?? "现场"}`}>
    <defs><pattern id={compact ? "map-grid-small" : "map-grid-large"} width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0V24" fill="none" stroke="currentColor" strokeOpacity=".08" /></pattern></defs>
    <rect width="600" height="400" fill={`url(#${compact ? "map-grid-small" : "map-grid-large"})`} />
    {[...edges].map(([key, { from, to }]) => <path key={key} d={`M${from.point.x * 540 + 30} ${from.point.y * 330 + 25} L${to.point.x * 540 + 30} ${to.point.y * 330 + 25}`} className={from.visited && to.visited ? "walked" : "unwalked"} />)}
    {positioned.map(node => {
      const active = node.id === view.nodeId;
      return <g key={node.id} transform={`translate(${node.point.x * 540 + 30},${node.point.y * 330 + 25})`} className={`map-location ${active ? "current" : node.visited ? "visited" : "known"} ${node.allowed ? "" : "locked"}`}
        {...(!compact ? { role: "button", tabIndex: busy ? -1 : 0, "aria-label": `${active ? "当前位置：" : node.allowed ? "前往" : "尚未开放："}${node.title}`,
          onClick: () => { if (!busy) onNavigate(node.id); }, onKeyDown: (event: React.KeyboardEvent) => { if (!busy && ["Enter", " "].includes(event.key)) { event.preventDefault(); onNavigate(node.id); } } } : {})}>
        {active ? <circle r="22" className="map-current-ring" /> : null}<circle r={active ? 10 : 7}/>
        {!node.allowed ? <text y="-15" textAnchor="middle">◇</text> : null}
        <text y="25" textAnchor="middle">{Array.from({length:Math.ceil(node.title.length/5)},(_,index)=><tspan x="0" dy={index===0?0:17} key={index}>{node.title.slice(index*5,index*5+5)}</tspan>)}</text>
      </g>;
    })}
  </svg>;
  return compact ? <button type="button" className="field-mini-map" onClick={onExpand} aria-label="打开探索地图">
    <span><Compass />{view.region?.title ?? "社区地图"}</span>{graph}<small><MapPin />{current?.title} · 已到访 {known.filter(node => node.visited).length} 处</small>
  </button> : <section className="field-full-map">
    <p>当前位置：<strong>{current?.title}</strong>。沿相邻道路探索，新的地点和线索会逐步出现。</p>{graph}
    <footer><span><MapPin/>当前位置</span><span>● 已到访 {known.filter(node => node.visited).length} 处</span><span>○ 已知 {known.length} 处</span><span><LockKeyhole/>须先取得进入条件</span></footer>
  </section>;
}
