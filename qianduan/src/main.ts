import './styles.css';
import type { AppState, Course, Destination, LearningGateway, View } from './domain/models';
import { dayLabel, moveMonth, parseDate } from './domain/calendar';
import { createDemoGateway } from './services/demo-gateway';
import { SpaceRenderer } from './render/space-renderer';
import { login, shell, welcome } from './ui/shell';
import { overview } from './ui/overview';
import { courseDialog, courseInspector, courses } from './ui/courses';
import { account, classes, destination, notes } from './ui/secondary';
import { escapeHtml as e } from './ui/html';
import { icon } from './ui/icons';
import { inviteDialog, invitePreview, searchResults } from './ui/navigation-dialogs';

const INTRO_KEY='astra.qianduan.intro-seen';
const validViews=new Set<View>(['overview','courses','classes','notes','account','manage','lab','code','future']);
function routeView():View|null { const value=location.hash.replace(/^#\/?/,'') as View;return validViews.has(value)?value:null; }
function sawIntro():boolean {try{return sessionStorage.getItem(INTRO_KEY)==='true';}catch{return false;}}

class AstraApp {
  private root=document.querySelector<HTMLDivElement>('#app')!;
  private modalRoot=document.querySelector<HTMLDivElement>('#modal-root')!;
  private toastElement=document.querySelector<HTMLDivElement>('#toast')!;
  private abort=new AbortController();
  private renderer:SpaceRenderer;
  private introTimer=0;
  private toastTimer=0;
  private authRequest=0;
  private lastFocus:HTMLElement|null=null;
  private inspectorId='';
  private pendingView:View=routeView()||'overview';
  private state:AppState={
    phase:'welcome',view:'overview',session:null,sidebarCollapsed:innerWidth<=900,
    courses:[],tasks:[],selectedCourse:'functions',calendarMonth:new Date(new Date().getFullYear(),new Date().getMonth(),1,12),selectedDate:new Date(),weekOffset:0,
    notes:[{id:'first-thought',title:'一个值得追问的问题',content:'同样的参数变化，为什么会带来不同的结果？\n\n先记录猜想，再用实验寻找证据。',modified:dayLabel(new Date())}],activeNote:'first-thought',
    reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,
  };

  constructor(private gateway:LearningGateway){
    this.renderer=new SpaceRenderer(document.querySelector<HTMLCanvasElement>('#universe')!,{
      reducedMotion:this.state.reducedMotion,
      onSelect:id=>this.selectCourse(id,false),
    });
    this.renderer.attachWelcome(this.root);
    const {signal}=this.abort;
    this.root.addEventListener('click',this.click,{signal});
    this.root.addEventListener('submit',this.submit,{signal});
    this.root.addEventListener('input',this.input,{signal});
    this.modalRoot.addEventListener('click',this.click,{signal});
    this.modalRoot.addEventListener('submit',this.submit,{signal});
    document.addEventListener('click',event=>{if(!(event.target as Element).closest('.brand-switcher'))this.closeSpaces();},{signal});
    window.addEventListener('hashchange',()=>{const view=routeView();if(view){this.pendingView=view;if(this.state.phase==='workspace')this.showView(view);}else if(this.state.phase==='workspace')this.showWelcome();},{signal});
    document.addEventListener('keydown',event=>{
      if(event.key==='Escape')this.closeSpaces();
      if(event.key==='Escape'&&this.state.phase==='intro')this.finishIntro();
      if(event.key==='Escape'&&innerWidth<=900&&!this.state.sidebarCollapsed&&this.state.phase==='workspace')this.toggleSidebar(true);
    },{signal});
    matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',event=>{this.applyMotion(event.matches);if(event.matches&&this.state.phase==='intro')this.finishIntro();},{signal});
    matchMedia('(max-width: 900px)').addEventListener('change',event=>{if(event.matches)this.toggleSidebar(true);else this.syncSidebarAccessibility();},{signal});
    window.addEventListener('beforeunload',()=>this.dispose(),{signal});
    document.documentElement.classList.toggle('reduced-motion',this.state.reducedMotion);
    void this.start();
  }

  private async start():Promise<void>{
    try {
      const [session,courseData,tasks]=await Promise.all([this.gateway.getSession(),this.gateway.getCourses(),this.gateway.getTasks()]);
      this.state.session=session;this.state.courses=courseData;this.state.tasks=tasks;this.renderer.setCourses(courseData);
      if(session&&routeView()){this.state.phase='workspace';this.state.view=routeView()!;this.render();}
      else if(!sawIntro())this.startIntro();
      else this.render();
    }catch(error){this.root.innerHTML='<section class="startup-error"><h1>星序</h1><p>页面暂时没有准备好，请刷新重试。</p><button class="quiet-button" data-action="reload">重新加载</button></section>';console.error(error);}
  }

  private startIntro():void {
    clearTimeout(this.introTimer);this.state.phase='intro';this.renderer.setMode('welcome');this.render();
    const duration=this.renderer.playIntro();
    this.introTimer=window.setTimeout(()=>this.finishIntro(),duration);
  }

  private finishIntro():void {
    clearTimeout(this.introTimer);this.renderer.finishIntro();
    try{sessionStorage.setItem(INTRO_KEY,'true');}catch{ /* Session storage is optional. */ }
    this.state.phase='welcome';this.render();
  }

  private render(focus?:string):void {
    const previousWorkspace=this.root.querySelector<HTMLElement>('.workspace');
    const scrollTop=previousWorkspace?.dataset.workspaceView===this.state.view?previousWorkspace.scrollTop:0;
    this.renderer.attachOrbit(null);
    document.body.dataset.phase=this.state.phase;
    document.body.dataset.view=this.state.view;
    if(this.state.phase==='intro'||this.state.phase==='welcome'){
      this.root.innerHTML=welcome(this.state.phase==='intro');this.renderer.setMode('welcome');return;
    }
    if(this.state.phase==='login'){
      this.root.innerHTML=login();this.renderer.setMode('login');
      if(innerWidth>=900)this.root.querySelector<HTMLInputElement>('#account-name')?.focus({preventScroll:true});
      return;
    }
    let content:string;
    switch(this.state.view){
      case 'overview':content=overview(this.state);break;
      case 'courses':content=courses(this.state);break;
      case 'classes':content=classes(this.state);break;
      case 'notes':content=notes(this.state);break;
      case 'account':content=account(this.state);break;
      default:content=destination(this.state.view as Destination);
    }
    this.root.innerHTML=shell(this.state,content);
    const workspace=this.root.querySelector<HTMLElement>('.workspace');if(workspace)workspace.scrollTop=scrollTop;
    this.syncSidebarAccessibility();
    this.renderer.setMode(this.state.view==='courses'?'courses':'ambient');
    if(this.state.view==='courses'){
      this.renderer.attachOrbit(this.root.querySelector('#orbit-stage'));
      this.renderer.select(this.state.selectedCourse,true);this.inspectorId=this.state.selectedCourse;
    }
    if(focus)this.root.querySelector<HTMLElement>(focus)?.focus({preventScroll:true});
  }

  private showView(view:View):void {
    if(!this.state.session)return;
    this.state.view=view;this.state.phase='workspace';this.pendingView=view;
    if(innerWidth<=900)this.state.sidebarCollapsed=true;
    if(routeView()!==view)history.pushState(null,'',`#/${view}`);
    this.render();this.root.querySelector<HTMLElement>('#workspace')?.focus({preventScroll:true});
  }

  private showWelcome():void {
    this.authRequest++;this.closeDialog();clearTimeout(this.introTimer);this.renderer.finishIntro();this.state.phase='welcome';history.replaceState(null,'',location.pathname+location.search);this.render();
  }

  private toggleSidebar(collapsed=!this.state.sidebarCollapsed):void {
    this.state.sidebarCollapsed=collapsed;
    const shell=this.root.querySelector('.app-shell');shell?.classList.toggle('is-collapsed',collapsed);
    this.root.querySelectorAll('[data-action="sidebar"]').forEach(button=>button.setAttribute('aria-expanded',String(!collapsed)));
    const button=this.root.querySelector('.collapse-button');button?.setAttribute('aria-label',collapsed?'展开侧栏':'收起侧栏');
    this.syncSidebarAccessibility();
  }

  private syncSidebarAccessibility():void {
    const mobile=innerWidth<=900,hidden=mobile&&this.state.sidebarCollapsed;
    const sidebar=this.root.querySelector<HTMLElement>('.sidebar');
    if(sidebar){sidebar.inert=hidden;if(hidden)sidebar.setAttribute('aria-hidden','true');else sidebar.removeAttribute('aria-hidden');}
    const scrim=this.root.querySelector<HTMLButtonElement>('.sidebar-scrim');
    if(scrim){scrim.tabIndex=mobile&&!hidden?0:-1;scrim.setAttribute('aria-hidden',String(!mobile||hidden));}
    const workspace=this.root.querySelector<HTMLElement>('.workspace');if(workspace)workspace.inert=mobile&&!hidden;
  }

  private applyMotion(reduced:boolean):void {
    this.state.reducedMotion=reduced;this.renderer.setReducedMotion(reduced);
    document.documentElement.classList.toggle('reduced-motion',reduced);
    this.root.querySelectorAll<HTMLElement>('[data-action="motion"]').forEach(button=>{
      if(button.getAttribute('role')==='switch'){button.setAttribute('aria-checked',String(reduced));button.classList.toggle('is-on',reduced);}
      else{button.setAttribute('aria-pressed',String(reduced));button.setAttribute('aria-label',reduced?'恢复星空动效':'减少星空动效');button.title=reduced?'恢复星空动效':'减少星空动效';button.classList.toggle('is-muted',reduced);}
    });
  }

  private selectCourse(id:string,move=true):void {
    if(!this.state.courses.some(course=>course.id===id))return;
    if(move){this.renderer.select(id);return;}
    this.state.selectedCourse=id;this.updateInspector(id);
    const announcement=this.root.querySelector('#course-announcement');if(announcement)announcement.textContent=`当前课程：${this.course(id)?.title}`;
    this.root.querySelectorAll<HTMLButtonElement>('[data-galaxy]').forEach(button=>{button.classList.toggle('is-selected',button.dataset.galaxy===id);button.setAttribute('aria-pressed',String(button.dataset.galaxy===id));});
  }

  private updateInspector(id:string):void {
    const course=this.course(id),inspector=this.root.querySelector('#course-inspector');
    if(!course||!inspector||id===this.inspectorId)return;
    inspector.innerHTML=courseInspector(course);this.inspectorId=id;
    inspector.animate([{opacity:.6,transform:'translateY(4px)'},{opacity:1,transform:'translateY(0)'}],{duration:this.state.reducedMotion?0:200,easing:'ease-out'});
  }

  private course(id:string):Course|undefined{return this.state.courses.find(course=>course.id===id);}

  private openDialog(content:string):void {
    this.lastFocus=document.activeElement as HTMLElement;
    this.modalRoot.innerHTML=`<dialog class="detail-dialog" aria-labelledby="dialog-title"><button class="dialog-close icon-button" data-action="dialog-close" aria-label="关闭窗口">${icon('close')}</button>${content}</dialog>`;
    const dialog=this.modalRoot.querySelector('dialog')!;
    dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)this.closeDialog();}});
    const restoreFocus=this.lastFocus;
    dialog.addEventListener('close',()=>{dialog.remove();if(restoreFocus?.isConnected&&!this.modalRoot.querySelector('dialog[open]'))restoreFocus.focus({preventScroll:true});},{once:true});
    dialog.showModal();
  }

  private closeDialog():void {this.modalRoot.querySelector('dialog')?.close();}
  private closeSpaces():void {const menu=this.root.querySelector<HTMLElement>('.space-menu');if(menu)menu.hidden=true;this.root.querySelector('[data-action="spaces"]')?.setAttribute('aria-expanded','false');}
  private notify(message:string):void {clearTimeout(this.toastTimer);this.toastElement.textContent=message;this.toastElement.classList.add('is-visible');this.toastTimer=window.setTimeout(()=>this.toastElement.classList.remove('is-visible'),2800);}

  private async authenticate(guest:boolean,form?:HTMLFormElement):Promise<void>{
    const request=++this.authRequest;
    const button=form?.querySelector<HTMLButtonElement>('[type="submit"]');
    const error=this.root.querySelector('#login-error');if(error)error.textContent='';
    if(button){button.disabled=true;button.classList.add('is-loading');}
    try{
      const data=form?new FormData(form):null;
      const session=guest?await this.gateway.enterAsGuest():await this.gateway.signIn(String(data?.get('account')||''),String(data?.get('password')||''));
      if(request!==this.authRequest)return;
      this.state.session=session;this.state.tasks=await this.gateway.getTasks();
      if(request!==this.authRequest)return;
      this.showView(this.pendingView);
    }catch(cause){if(request===this.authRequest&&error)error.textContent=cause instanceof Error?cause.message:'暂时无法进入，请重试。';}
    finally{if(button?.isConnected){button.disabled=false;button.classList.remove('is-loading');}}
  }

  private click=(event:MouseEvent):void=>{
    const target=(event.target as Element).closest<HTMLElement>('button,[data-view]');if(!target||target instanceof HTMLButtonElement&&target.disabled)return;
    if(target.dataset.view){this.closeDialog();this.showView(target.dataset.view as View);return;}
    if(target.dataset.galaxy){this.selectCourse(target.dataset.galaxy);return;}
    if(target.dataset.nebula!==undefined){this.renderer.selectNebula(Number(target.dataset.nebula));return;}
    if(target.dataset.searchCourse){this.closeDialog();this.state.selectedCourse=target.dataset.searchCourse;this.showView('courses');return;}
    if(target.dataset.orbitStep){this.renderer.step(Number(target.dataset.orbitStep));return;}
    if(target.dataset.courseDetail){const course=this.course(target.dataset.courseDetail);if(course)this.openDialog(courseDialog(course));return;}
    if(target.dataset.task){
      const task=this.state.tasks.find(item=>item.id===target.dataset.task);if(!task)return;
      const course=this.course(task.courseId)!;
      this.openDialog(`<span class="dialog-subject" style="color:${course.color}">${e(course.title)} · 学习任务</span><h2 id="dialog-title">${e(task.title)}</h2><p class="dialog-description">${e(task.description)}</p><div class="task-detail-hint">${icon('sparkles')}先观察，再记录你的发现。</div><p class="dialog-note">当前为演示任务，用于体验任务与总览之间的状态更新。</p><button class="primary-button" data-complete-task="${task.id}">标记完成 ${icon('check')}</button>`);return;
    }
    if(target.dataset.completeTask){void this.gateway.completeTask(target.dataset.completeTask).then(async()=>{this.state.tasks=await this.gateway.getTasks();this.closeDialog();this.render();this.notify('任务已完成，继续下一段探索吧。');}).catch(error=>this.notify(error.message));return;}
    if(target.dataset.month){const month=moveMonth(this.state.calendarMonth,Number(target.dataset.month));const lastDay=new Date(month.getFullYear(),month.getMonth()+1,0).getDate();this.state.calendarMonth=month;this.state.selectedDate=new Date(month.getFullYear(),month.getMonth(),Math.min(this.state.selectedDate.getDate(),lastDay),12);this.render(`[data-month="${target.dataset.month}"]`);return;}
    if(target.dataset.week){this.state.weekOffset+=Number(target.dataset.week);this.render(`[data-week="${target.dataset.week}"]`);return;}
    if(target.dataset.date){this.state.selectedDate=parseDate(target.dataset.date);this.state.calendarMonth=new Date(this.state.selectedDate.getFullYear(),this.state.selectedDate.getMonth(),1,12);this.render(`[data-date="${target.dataset.date}"]`);return;}
    if(target.dataset.note){this.state.activeNote=target.dataset.note;this.render();return;}
    switch(target.dataset.action){
      case 'explore':if(this.state.session)this.showView(this.pendingView);else{this.state.phase='login';this.render();}break;
      case 'welcome':this.showWelcome();break;
      case 'guest':void this.authenticate(true);break;
      case 'sidebar':this.toggleSidebar();break;
      case 'spaces':{const menu=this.root.querySelector<HTMLElement>('.space-menu');if(menu){menu.hidden=!menu.hidden;target.setAttribute('aria-expanded',String(!menu.hidden));}break;}
      case 'invite':this.openDialog(inviteDialog());break;
      case 'sidebar-close':this.toggleSidebar(true);break;
      case 'dialog-close':this.closeDialog();break;
      case 'password':{const input=this.root.querySelector<HTMLInputElement>('#account-password')!;input.type=input.type==='password'?'text':'password';target.setAttribute('aria-label',input.type==='password'?'显示密码':'隐藏密码');target.setAttribute('aria-pressed',String(input.type==='text'));break;}
      case 'today':this.state.selectedDate=new Date();this.state.calendarMonth=new Date(new Date().getFullYear(),new Date().getMonth(),1,12);this.render('[data-action="today"]');break;
      case 'motion':this.applyMotion(!this.state.reducedMotion);this.notify(this.state.reducedMotion?'已减弱持续动画。':'星空动效已恢复。');break;
      case 'logout':void this.gateway.signOut().then(()=>{this.state.session=null;this.showWelcome();});break;
      case 'replay':history.replaceState(null,'',location.pathname+location.search);this.startIntro();break;
      case 'new-note':{const id=crypto.randomUUID();this.state.notes.unshift({id,title:'',content:'',modified:dayLabel(new Date())});this.state.activeNote=id;this.render('#note-title');break;}
      case 'export-note':{const note=this.state.notes.find(item=>item.id===this.state.activeNote)!;const blob=new Blob([`${note.title||'未命名笔记'}\n\n${note.content}`],{type:'text/plain;charset=utf-8'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`${(note.title||'星序笔记').replace(/[<>:"/\\|?*]/g,'_')}.txt`;a.click();window.setTimeout(()=>URL.revokeObjectURL(url),500);this.notify('笔记已导出。');break;}
      case 'reload':location.reload();break;
    }
  };

  private submit=(event:SubmitEvent):void=>{
    event.preventDefault();const form=event.target as HTMLFormElement;
    if(form.id==='login-form')void this.authenticate(false,form);
    if(form.id==='course-search')this.openDialog(searchResults(String(new FormData(form).get('query')||''),this.state.courses));
    if(form.id==='invite-form'){
      const error=invitePreview(String(new FormData(form).get('code')||''));
      if(error){const feedback=form.querySelector('#invite-feedback');if(feedback)feedback.textContent=error;}
      else this.openDialog(`<h2 id="dialog-title">探索一班</h2><p class="dialog-description">陈老师 · 星序演示班级</p><p class="dialog-note">这是邀请预览原型，尚未连接学校服务，不会实际加入班级。</p><button class="primary-button" data-view="classes">查看演示班级 ${icon('arrow')}</button>`);
    }
    if(form.id==='profile-form')void this.gateway.updateDisplayName(this.root.querySelector<HTMLInputElement>('#display-name')!.value).then(session=>{this.state.session=session;this.render();this.notify('显示名称已更新。');}).catch(error=>this.notify(error.message));
  };

  private input=(event:Event):void=>{
    const target=event.target as HTMLInputElement|HTMLTextAreaElement;
    if(target.id!=='note-title'&&target.id!=='note-content')return;
    const note=this.state.notes.find(item=>item.id===this.state.activeNote);if(!note)return;
    if(target.id==='note-title')note.title=target.value;else note.content=target.value;
    note.modified=dayLabel(new Date());
    const preview=this.root.querySelector(`[data-note="${note.id}"]`);
    const title=preview?.querySelector('strong'),body=preview?.querySelector('span');
    if(title)title.textContent=note.title||'未命名笔记';if(body)body.textContent=note.content.slice(0,45)||'等待你的第一个想法。';
  };

  dispose():void {clearTimeout(this.introTimer);clearTimeout(this.toastTimer);this.authRequest++;this.closeDialog();this.abort.abort();this.renderer.dispose();}
}

const app=new AstraApp(createDemoGateway());
if(import.meta.hot)import.meta.hot.dispose(()=>app.dispose());
