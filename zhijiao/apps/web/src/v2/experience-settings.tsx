import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Monitor, RefreshCw, X } from "lucide-react";
import "./experience-shell.css";

const preferenceKey = "ganglian.motion";
export function ExperienceSettings({ onClose, onRefresh, onWork, onExit }: {
  onClose(): void; onRefresh?(): void; onWork?(): void; onExit?(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [reduced, setReduced] = useState(() => localStorage.getItem(preferenceKey) === "reduced" || matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const setMotion = (value: boolean) => {
    setReduced(value); localStorage.setItem(preferenceKey, value ? "reduced" : "standard");
    document.documentElement.dataset.reducedMotion = String(value);
  };
  return <dialog className="v3-settings" ref={dialog} onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><h2>{onExit ? "现场设置" : "体验设置"}</h2><button type="button" aria-label="关闭设置" onClick={onClose}><X /></button></header>
    <section><label><span><strong>减少动态效果</strong><small>保留全部交互，降低档案摆动与过渡动画。</small></span><input type="checkbox" checked={reduced} onChange={event => setMotion(event.target.checked)} /></label>
      {onExit ? <p>阅读、输入和记笔记不会按现实打字速度扣除采访时间。实际行动与约定使用同一个现场时钟。</p> : null}
    </section>
    {onRefresh || onWork || onExit ? <footer>
      {onRefresh ? <button type="button" onClick={onRefresh}><RefreshCw />重新同步现场</button> : null}
      {onWork ? <button type="button" onClick={onWork}><Monitor />打开工作台</button> : null}
      {onExit ? <button type="button" className="v3-settings-exit" onClick={onExit}><ArrowLeft />返回课程档案</button> : null}
    </footer> : null}
  </dialog>;
}
