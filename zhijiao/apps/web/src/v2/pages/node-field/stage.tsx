import { Eye, LoaderCircle, LockKeyhole, MessageCircle, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FieldRenderer } from "./renderer";
import { STAGE, cameraBounds, constrainCamera, objectPosition, placeFieldMarker, sceneActors, sceneImage, type CameraState, type FieldVisualNode } from "./visuals";
import { runFieldTransition, type FieldTransitionPhase } from "./transition";

export interface FieldObject { objectId: string; label: string; hint: string }
export function NodeFieldStage(props: {
  node: FieldVisualNode;
  objects: FieldObject[];
  focusedPerson: string | null;
  blocked: boolean;
  destinations: Array<{ sceneRef: string; title: string; locked: boolean; x: number; y: number }>;
  onNavigate(sceneRef: string): void;
  onPerson(entityId: string): void;
  onObject(objectId: string): void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const markerRef = useRef<HTMLDivElement>(null);
  const latest = useRef(props); latest.current = props;
  const displayed = useRef(props);
  const hasScene = useRef(false);
  if (hasScene.current && displayed.current.node.sceneRef === props.node.sceneRef) displayed.current = props;
  const rendererRef = useRef<FieldRenderer | null>(null);
  const cameraRef = useRef<CameraState>({ x: 0, y: 0, zoom: 1.02 });
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [engineRevision, setEngineRevision] = useState(0);
  const [transition, setTransition] = useState<FieldTransitionPhase>("initial");
  const phaseRef = useRef<FieldTransitionPhase>("initial");
  const snapCamera = useRef(false);
  const phase = (value: FieldTransitionPhase) => { phaseRef.current = value; setTransition(value); };

  useEffect(() => {
    let disposed = false, animation = 0, previous = performance.now();
    let current = { ...cameraRef.current };
    const canvas = canvasRef.current!;
    const controller = new AbortController();
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const pointers = new Map<number, { x: number; y: number }>();
    let distance = 0, pinching = false;
    const resetCamera = () => {
      const actor = sceneActors(latest.current.node).find(person => person.visible);
      cameraRef.current = { zoom: 1.02, x: canvas.clientWidth / canvas.clientHeight < .9 && actor ? (actor.x - .5) * STAGE.width : 0, y: 0 };
    };
    resetCamera(); setError(null); setReady(false); hasScene.current = false; phase("initial");
    let portrait = canvas.clientWidth / canvas.clientHeight < .9;
    const resizeObserver = new ResizeObserver(() => {
      const nextPortrait = canvas.clientWidth / canvas.clientHeight < .9;
      if (nextPortrait !== portrait) { portrait = nextPortrait; resetCamera(); }
    });
    resizeObserver.observe(canvas);
    const load = async () => {
      try {
        const { FieldRenderer } = await import("./renderer");
        const renderer = await FieldRenderer.create(canvas);
        if (disposed) { renderer.dispose(); return; }
        rendererRef.current = renderer;
        setEngineRevision(value => value + 1);
        const frame = (now: number) => {
          if (disposed) return;
          animation = requestAnimationFrame(frame);
          const dt = Math.min(.1, (now - previous) / 1000); previous = now;
          if (document.hidden) return;
          const state = displayed.current, actors = sceneActors(state.node);
          renderer.setActors(actors);
          let target = cameraRef.current;
          const focus = actors.find(actor => actor.entityId === state.focusedPerson && actor.visible);
          if (focus) {
            const zoom = canvas.clientWidth / canvas.clientHeight < .9 ? 1.08 : 1.6;
            const { scale } = cameraBounds(canvas.clientWidth, canvas.clientHeight, zoom);
            target = { x: (focus.x - .5) * STAGE.width, y: (.5 - focus.y + focus.height * .9) * STAGE.height - canvas.clientHeight / scale * .24, zoom };
          }
          target = constrainCamera(target, canvas.clientWidth, canvas.clientHeight);
          if (snapCamera.current) { current = { ...target }; snapCamera.current = false; }
          const blend = reduced.matches ? 1 : 1 - Math.exp(-dt * 12);
          for (const key of ["x", "y", "zoom"] as const) current[key] = Math.abs(current[key] - target[key]) < .001 ? target[key] : current[key] + (target[key] - current[key]) * blend;
          renderer.render(current);
          const occupied:Array<{x:number;y:number;width:number;height:number}>=[];
          for (const button of markerRef.current?.querySelectorAll<HTMLElement>("[data-field-point]") ?? []) {
            const actor = actors.find(item => item.entityId === button.dataset.person);
            const objectIndex = state.objects.findIndex(item => item.objectId === button.dataset.object);
            const entrance = state.destinations.find(item => item.sceneRef === button.dataset.entry);
            const point = entrance ?? (actor ? { x: actor.x + actor.height * .065, y: actor.y - actor.height * .63 } : objectPosition(state.node, objectIndex));
            const screen = renderer.project(point);
            const bounds={width:button.offsetWidth,height:button.offsetHeight+(entrance?36:0)};
            const position = placeFieldMarker(screen, { width: canvas.clientWidth, height: canvas.clientHeight }, bounds,occupied);
            if(position)occupied.push({...position,...bounds});
            button.style.visibility = position ? "visible" : "hidden";
            if (position) button.style.transform = `translate(${position.x.toFixed(1)}px,${position.y.toFixed(1)}px)`;
          }
        };
        animation = requestAnimationFrame(frame);
      } catch (cause) { if (!disposed) setError(cause instanceof Error ? cause.message : "场景图像未能加载"); }
    };
    void load();
    canvas.addEventListener("pointerdown", event => {
      if (latest.current.blocked || phaseRef.current !== "ready") return;
      canvas.setPointerCapture(event.pointerId); canvas.focus({ preventScroll: true }); pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 1) { distance = 0; pinching = false; } else pinching = true;
    }, { signal: controller.signal });
    canvas.addEventListener("pointermove", event => {
      if (latest.current.blocked || phaseRef.current !== "ready") return;
      const point = pointers.get(event.pointerId);
      if (!point) { canvas.style.cursor = rendererRef.current?.pick(event.clientX, event.clientY) ? "pointer" : "grab"; return; }
      const before = [...pointers.values()]; pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const state = cameraRef.current;
      if (pointers.size === 2) {
        const after = [...pointers.values()], a = Math.hypot(before[0]!.x - before[1]!.x, before[0]!.y - before[1]!.y), b = Math.hypot(after[0]!.x - after[1]!.x, after[0]!.y - after[1]!.y);
        if (a > 1) state.zoom *= b / a;
      } else {
        const { scale } = cameraBounds(canvas.clientWidth, canvas.clientHeight, state.zoom);
        state.x -= (event.clientX - point.x) / scale; state.y += (event.clientY - point.y) / scale;
        distance += Math.hypot(event.clientX - point.x, event.clientY - point.y);
      }
      cameraRef.current = constrainCamera(state, canvas.clientWidth, canvas.clientHeight);
    }, { signal: controller.signal });
    const finishPointer = (event: PointerEvent) => {
      if (!pointers.has(event.pointerId)) return;
      pointers.delete(event.pointerId);
      if (!latest.current.blocked && phaseRef.current === "ready" && !pinching && distance < 5 && event.type === "pointerup") {
        const entityId = rendererRef.current?.pick(event.clientX, event.clientY); if (entityId) latest.current.onPerson(entityId);
      }
    };
    canvas.addEventListener("pointerup", finishPointer, { signal: controller.signal }); canvas.addEventListener("pointercancel", finishPointer, { signal: controller.signal });
    canvas.addEventListener("wheel", event => {
      if (latest.current.blocked || phaseRef.current !== "ready") return; event.preventDefault();
      cameraRef.current = constrainCamera({ ...cameraRef.current, zoom: cameraRef.current.zoom * Math.exp(-event.deltaY * .001) }, canvas.clientWidth, canvas.clientHeight);
    }, { signal: controller.signal, passive: false });
    canvas.addEventListener("keydown", event => {
      if (latest.current.blocked || phaseRef.current !== "ready") return;
      const c = cameraRef.current;
      if (event.key === "ArrowLeft") c.x -= 28;
      else if (event.key === "ArrowRight") c.x += 28;
      else if (event.key === "ArrowUp") c.y += 20;
      else if (event.key === "ArrowDown") c.y -= 20;
      else if (["+", "="].includes(event.key)) c.zoom *= 1.08;
      else if (event.key === "-") c.zoom *= .92;
      else return;
      event.preventDefault(); cameraRef.current = constrainCamera(c, canvas.clientWidth, canvas.clientHeight);
    }, { signal: controller.signal });
    canvas.addEventListener("webglcontextlost", event => { event.preventDefault(); setError("画面渲染已中断，训练记录仍保存在服务端。请重新加载画面。"); }, { signal: controller.signal });
    return () => { disposed = true; controller.abort(); resizeObserver.disconnect(); cancelAnimationFrame(animation); rendererRef.current?.dispose(); rendererRef.current = null; };
  }, [attempt]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const controller = new AbortController();
    const target = latest.current;
    setReady(false); setError(null);
    void runFieldTransition({
      hasScene: hasScene.current, reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      signal: controller.signal, phase,
      load: async () => { const [loaded] = await Promise.all([renderer.loadScene(sceneImage(target.node),target.node.imageAtlas), renderer.loadActors(sceneActors(target.node))]); return loaded; },
      swap: () => {
        displayed.current = latest.current;
        const actor = sceneActors(target.node).find(person => person.visible), canvas = canvasRef.current!;
        cameraRef.current = { x: canvas.clientWidth / canvas.clientHeight < .9 && actor ? (actor.x - .5) * STAGE.width : 0, y: 0, zoom: 1.02 };
        snapCamera.current = true; hasScene.current = true; setReady(true);
      },
    }).catch(cause => {
      if (!controller.signal.aborted) { phase("failed"); setError(cause instanceof Error ? cause.message : "场景素材加载失败"); }
    });
    return () => controller.abort();
  }, [engineRevision, props.node.sceneRef, props.node.environmentImage, props.node.imageAtlas?.columns, props.node.imageAtlas?.rows, props.node.imageAtlas?.index]);

  useEffect(() => {
    let active = true;
    void rendererRef.current?.loadActors(sceneActors(props.node)).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "人物素材加载失败"); });
    return () => { active = false; };
  }, [engineRevision, props.node.people]);

  const actors = sceneActors(props.node);
  return <div className="node-field-stage" data-transition={transition} aria-busy={transition !== "ready" && transition !== "failed"}>
    <canvas key={attempt} ref={canvasRef} tabIndex={0} aria-label="采访现场，拖动观察、滚轮缩放、点击人物交流" />
    <div className="node-field-vignette" />
    <div className="node-transition-veil" aria-hidden="true"><span>前往{props.node.title}</span></div>
    {transition === "initial" || error ? <div className="node-stage-loading">{error ? <><p>{error}</p><button type="button" onClick={() => setAttempt(value => value + 1)}><RefreshCw />重新加载画面</button></> : <><LoaderCircle className="spin" /><span>正在进入{props.node.title}</span></>}</div> : null}
    <div ref={markerRef} className="node-field-markers" hidden={!ready || props.blocked || transition !== "ready"}>
      {actors.filter(actor => props.node.people.find(person => person.entityId === actor.entityId)?.presence.visible).map(actor => { const person = props.node.people.find(p => p.entityId === actor.entityId)!; return <button type="button" className="node-person-marker" data-field-point data-person={actor.entityId} key={actor.entityId} onClick={() => props.onPerson(actor.entityId)} aria-label={`与${person.displayName}交谈`}><MessageCircle /><span><strong>{person.displayName}</strong><small>{actor.visible ? person.status === "busy" ? "正在忙 · 查看联系" : "交谈　›" : "已离场 · 查看记录"}</small></span></button>; })}
      {props.objects.slice(0, 6).map(object => <button type="button" data-field-point data-object={object.objectId} className="node-object-marker" key={object.objectId} onClick={() => props.onObject(object.objectId)} title={object.hint} aria-label={`查看${object.label}`}><Eye /><span>{object.label}</span></button>)}
      {props.destinations.map(destination => <button type="button" key={destination.sceneRef} className={`node-entry-marker${destination.locked ? " locked" : ""}`} data-field-point data-entry={destination.sceneRef} onClick={() => props.onNavigate(destination.sceneRef)} aria-label={`${destination.locked ? "查看进入条件：" : "进入"}${destination.title}`}>{destination.locked ? <LockKeyhole /> : <span style={{ transform: `rotate(${destination.x < .3 ? 180 : destination.x > .7 ? 0 : -90}deg)` }}>➤</span>}<small>{destination.locked ? "尚未开放 · " : ""}{destination.title}</small></button>)}
    </div>
  </div>;
}
