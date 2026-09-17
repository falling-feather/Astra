import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Settings2 } from "lucide-react";
import { BrandMark } from "./brand-mark";
import type { V2Route } from "./router";
import { ExperienceSettings } from "./experience-settings";
import "./experience-shell.css";
import "./teacher-theme.css";
import "./student-theme.css";

interface V2RoleShellProps { route: V2Route; contextSessionId?: string; onLogout?():void; navigate(path: string): void; children: ReactNode }
export function V2RoleShell({ route, navigate, children,onLogout }: V2RoleShellProps) {
  const [settings, setSettings] = useState(false);
  const shell=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const update=(event?:Event)=>{
      const target=event?.target;
      if(target instanceof HTMLElement&&target!==document.documentElement&&target!==document.body&&!target.matches('.teacher-workspace,.v3-shell-body'))return;
      const top=Math.max(window.scrollY,document.documentElement.scrollTop,target instanceof HTMLElement?target.scrollTop:0);
      shell.current?.classList.toggle('is-scrolled',top>24);
    };
    update();document.addEventListener('scroll',update,{capture:true,passive:true});
    return()=>document.removeEventListener('scroll',update,true);
  },[route.kind,route.kind==='teacher'?route.page:'']);
  useEffect(() => { document.documentElement.dataset.reducedMotion = String(localStorage.getItem("ganglian.motion") === "reduced"); }, []);
  if (route.kind === "student-training") return <div className="v2-immersive-shell v3-role-student">{children}</div>;
  if(route.kind==='admin')return <main className="v2-route-loading"><h1>管理页面已禁用</h1><button type="button" onClick={()=>navigate('/login')}>返回登录</button></main>;
  const teacher = route.kind === "teacher";
  const page = teacher ? route.page : route.kind;
  const navigation = teacher ? [
    { label: "学生档案", path: "/teacher/classes", active: ["classes", "director", "reviews"].includes(page) },
    { label: "课程导演", path: "/teacher/courses", active: page === "courses" },
    { label: "教学资料", path: "/teacher/materials", active: page === "materials" },
  ] : [
    { label: "我的课程", path: "/student/courses", active: ["student-courses", "student-course-detail"].includes(page) },
    { label: "我的作品", path: "/student/portfolio", active: ["student-portfolio", "student-review"].includes(page) },
    { label: "数字资料", path: "/student/materials", active: page === "student-materials" },
  ];
  return <div ref={shell} className={"v3-shell "+(teacher?"v3-role-teacher":"v3-role-student")}>
    <header className="v3-topbar"><button type="button" className="v3-brand" onClick={() => navigate(teacher ? "/teacher/classes" : "/student/courses")}><BrandMark /><span>职教星云</span></button>
      <nav aria-label={teacher ? "教师端页面" : "学生端页面"}>{navigation.map(item => <button type="button" key={item.path} className={item.active ? "active" : ""} aria-label={item.label} aria-current={item.active ? "page" : undefined} onClick={() => navigate(item.path)}><span className="v3-nav-full">{item.label}</span><span className="v3-nav-compact" aria-hidden="true">{teacher ? item.label === "教学资料" ? "资料" : item.label : item.label === "我的课程" ? "课程" : item.label === "我的作品" ? "作品" : "资料"}</span></button>)}</nav>
      <div className="v3-account"><details><summary>{teacher ? "教师" : "学生"}<ChevronDown /></summary><div className="v3-role-menu">
        {[{label:"学生登录",path:"/login?role=student"},{label:"教师登录",path:"/login?role=teacher"}].map(item => <button type="button" key={item.path} onClick={event => { event.currentTarget.closest("details")?.removeAttribute("open"); navigate(item.path); }}>{item.label}</button>)}
        {onLogout?<button type="button" onClick={onLogout}>退出登录</button>:null}
      </div></details><button type="button" aria-label="体验设置" onClick={() => setSettings(true)}><Settings2 /></button></div>
    </header>
    <div className="v3-shell-body">{children}</div>
    {settings ? <ExperienceSettings onClose={() => setSettings(false)} /> : null}
  </div>;
}
