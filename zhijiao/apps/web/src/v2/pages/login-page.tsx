import {useEffect,useRef,useState,type CSSProperties,type FormEvent} from 'react';
import {ArrowLeft,ArrowUpRight,ArrowRight,Eye,EyeOff,LoaderCircle,LockKeyhole,UserRound,X} from 'lucide-react';
import type {DemoLoginAccount} from '@ronggang/contracts';
import type {DemoAuthContext} from '../models';
import {BrandMark} from '../brand-mark';
import {loginDemoAccount,readDemoLoginAccounts} from '../gateway';
import './login-page.css';

type Role='student'|'teacher';
function requestedRole():Role|null{const role=new URLSearchParams(location.search).get('role');return role==='student'||role==='teacher'?role:null;}
function reducedMotion(){return matchMedia('(prefers-reduced-motion: reduce)').matches||document.documentElement.dataset.reducedMotion==='true';}
function FolderFace({role}:{role:Role}){return <><span className="login-folder-tab" aria-hidden="true"/><span className="login-folder-code">{role==='student'?'01 / STUDENT':'02 / TEACHER'}</span><BrandMark/><strong className="login-folder-title">{role==='student'?'学生登录':'教师登录'}</strong><span className="login-folder-caption">{role==='student'?'探索 · 记录 · 创作':'观察 · 编排 · 指导'}</span><span className="login-folder-enter">打开档案 <ArrowUpRight size={19}/></span><span className="login-folder-rule" aria-hidden="true"/></>;}
export default function LoginPage({onLogin}:{onLogin(auth:DemoAuthContext):void}){
  const [intro,setIntro]=useState(()=>!reducedMotion()),[role,setRole]=useState<Role|null>(requestedRole),[closing,setClosing]=useState(false);
  const [origin,setOrigin]=useState({x:0,y:30,sx:.55,sy:.7});
  const archives=useRef<Partial<Record<Role,HTMLButtonElement|null>>>({});
  const usernameInput=useRef<HTMLInputElement>(null);
  const [accounts,setAccounts]=useState<DemoLoginAccount[]>([]),[loadError,setLoadError]=useState<string|null>(null),[reload,setReload]=useState(0);
  const [username,setUsername]=useState(''),[password,setPassword]=useState(''),[showPassword,setShowPassword]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  useEffect(()=>{if(!intro)return;const timer=window.setTimeout(()=>setIntro(false),1600);return()=>clearTimeout(timer);},[intro]);
  useEffect(()=>{const controller=new AbortController();setLoadError(null);readDemoLoginAccounts(controller.signal).then(value=>{if(!controller.signal.aborted){setAccounts(value);const preset=value.find(account=>account.role===requestedRole());if(preset){setUsername(preset.username);setPassword(preset.password);}}}).catch(cause=>{if(!controller.signal.aborted)setLoadError(cause instanceof Error?cause.message:'演示账号暂时无法读取');});return()=>controller.abort();},[reload]);
  const measure=(value:Role)=>{const box=archives.current[value]?.getBoundingClientRect();if(box)setOrigin({x:box.left-innerWidth/2,y:box.top+box.height/2-innerHeight/2,sx:box.width*2/innerWidth,sy:box.height/innerHeight});};
  const select=(nextRole:Role)=>{measure(nextRole);setRole(nextRole);setClosing(false);setError(null);const account=accounts.find(item=>item.role===nextRole);setUsername(account?.username??'');setPassword(account?.password??'');setShowPassword(false);};
  const close=()=>{if(busy)return;if(role)measure(role);if(reducedMotion()){setRole(null);return;}setClosing(true);};
  useEffect(()=>{if(!role||intro)return;const timer=window.setTimeout(()=>usernameInput.current?.focus({preventScroll:true}),reducedMotion()?0:1050);const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!busy){event.preventDefault();close();}};document.addEventListener('keydown',escape);return()=>{clearTimeout(timer);document.removeEventListener('keydown',escape);};},[role,intro,busy]);
  const fill=(account:DemoLoginAccount)=>{setUsername(account.username);setPassword(account.password);setError(null);usernameInput.current?.focus({preventScroll:true});};
  const submit=async(event:FormEvent)=>{event.preventDefault();if(!role||busy)return;setBusy(true);setError(null);try{onLogin(await loginDemoAccount({role,username,password}));}catch(cause){setError(cause instanceof Error?cause.message:'登录未完成，请重试');}finally{setBusy(false);}};
  const bookStyle={'--book-x':origin.x+'px','--book-y':origin.y+'px','--book-sx':origin.sx,'--book-sy':origin.sy} as CSSProperties;
  return <main className={'login-world'+(intro?' is-intro':'')+(role?' is-selected role-'+role:'')}>
    <div className="login-horizon" aria-hidden="true"/>
    {intro?<div className="login-intro" aria-label="职教星云标识开场动画"><div className="login-intro-mark"><BrandMark/></div><button type="button" onClick={()=>setIntro(false)}>跳过动画 <ArrowRight size={15}/></button></div>:null}
    <div className="login-experience" inert={intro||!!role} aria-hidden={!!role}>
      <header className="login-header"><span><i aria-hidden="true"/>职教星云</span><span>进入你的学习现场</span></header>
      <section className="login-stage" aria-label="选择登录身份"><div className="login-archives">
        {(['student','teacher'] as const).map(value=><button ref={node=>{archives.current[value]=node;}} type="button" key={value} className={'login-archive '+value} aria-label={value==='student'?'学生登录':'教师登录'} onClick={()=>select(value)} disabled={busy}>
          <span className="login-archive-float"><span className="login-volume"><span className="login-folder-back" aria-hidden="true"/><span className="login-folder-paper" aria-hidden="true"/><span className="login-folder-spine" aria-hidden="true"/><span className="login-folder-front"><FolderFace role={value}/></span></span></span><span className="login-archive-shadow" aria-hidden="true"/>
        </button>)}
      </div></section>
      <footer className="login-footer"><span>选择档案，翻开你的学习现场。</span><span>DEMO ACCESS <i aria-hidden="true"/></span></footer>
    </div>
    {role&&!intro?<section key={role} className={'login-open-book '+role+(closing?' is-closing':'')} style={bookStyle} role="dialog" aria-modal="true" aria-label={role==='student'?'学生登录档案':'教师登录档案'} onAnimationEnd={event=>{if(event.target===event.currentTarget&&closing){const previous=role;setRole(null);setClosing(false);window.setTimeout(()=>archives.current[previous]?.focus({preventScroll:true}),0);}}}>
      <section className="login-book-right"><div className="login-book-content">
        <section className="login-form-panel" aria-label={role==='student'?'学生账号登录':'教师账号登录'}>
          <span className="login-page-number">02 / 账号登录</span><h2>{role==='student'?'学生登录':'教师登录'}</h2><p>{role==='student'?'打开你的课程、作品与私人笔记。':'进入班级档案与课程工作台。'}</p>
          <form onSubmit={submit}>
            <label>账号<div className="login-input"><UserRound size={18}/><input ref={usernameInput} name="username" aria-label="账号" autoComplete="username" required value={username} onChange={event=>setUsername(event.target.value)} disabled={busy||closing}/></div></label>
            <label>密码<div className="login-input"><LockKeyhole size={17}/><input name="password" aria-label="密码" autoComplete="current-password" required type={showPassword?'text':'password'} value={password} onChange={event=>setPassword(event.target.value)} disabled={busy||closing}/><button type="button" aria-label={showPassword?'隐藏密码':'显示密码'} onClick={()=>setShowPassword(value=>!value)}>{showPassword?<EyeOff size={18}/>:<Eye size={18}/>}</button></div></label>
            {error?<p className="login-error" role="alert">{error}</p>:null}<button className="login-submit" type="submit" disabled={busy||closing||!username.trim()||!password}>{busy?<><LoaderCircle size={18} className="spin"/>正在打开档案</>:<>登录 <ArrowRight size={19}/></>}</button>
          </form>
        </section>
        <section className="login-accounts" aria-label="公开演示账号"><header><h2>演示账号</h2><span>点击填入 · 密码 {accounts[0]?.password??'读取中'}</span></header>
          {loadError?<div className="login-error" role="alert">{loadError}<button type="button" onClick={()=>setReload(value=>value+1)}>重新读取</button></div>:accounts.length?<div className="login-account-list">{accounts.filter(account=>account.role===role).map(account=><button type="button" key={account.username} disabled={busy||closing} className={username===account.username?'active':''} onClick={()=>fill(account)}><span className={'login-account-marker '+account.role} aria-hidden="true"/><span><strong>{account.displayName}</strong><code>{account.username}</code><small>{account.role==='teacher'?'两个班级 · 每班10人':account.classrooms[0]}</small></span><ArrowUpRight size={16}/></button>)}</div>:<p role="status">正在读取演示账号…</p>}
        </section>
      </div></section>
      <div className="login-turning-leaf">
        <div className={'login-leaf-cover '+role} aria-hidden="true"><FolderFace role={role}/></div>
        <section className="login-book-info"><header><BrandMark/><span>职教星云</span><span className="login-page-number">01 / {role==='student'?'学习档案':'教学档案'}</span></header>
          <div className="login-book-introduction"><span className="login-book-square" aria-hidden="true"/><h2>{role==='student'?<>走进学习现场<br/>写下自己的判断</>:<>打开学生档案<br/>看见学习过程</>}</h2><p>{role==='student'?'在不同场景中交流、调查与创作。课程进度、作品和私人笔记，会随你的账号保存。':'切换班级，查看学生的课程与作品；在开课前，编排人物和教学任务。'}</p>
            <ul>{(role==='student'?['从多个地点开始，自由探索线索','随手记录观察，整理并提交作品','回看反馈，继续下一次练习']:['两个班级，每班10名测试学生','查看个人课程、已交作品与评价','配置人物，设计下一次课堂体验']).map((line,index)=><li key={line}><span>0{index+1}</span>{line}</li>)}</ul>
          </div><footer><span>{role==='student'?'探索 · 记录 · 创作':'观察 · 编排 · 指导'}</span><span>DEMO / {role==='student'?'STUDENT':'TEACHER'}</span></footer>
        </section>
      </div>
      <div className="login-book-binding" aria-hidden="true"/><button type="button" className="login-book-close" onClick={close} disabled={busy||closing}><ArrowLeft size={16}/><span>收回档案</span><X size={17}/></button>
    </section>:null}
  </main>;
}
