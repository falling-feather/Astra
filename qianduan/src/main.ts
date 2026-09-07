import './styles.css';
import './portal/styles.css';
import activities from 'virtual:astra-catalog';
import { PortalWorkspace } from './portal/workspace';
import { createApiGateway } from './services/api-gateway';
import { API_BASE, DEMO_MODE, frontendAsset } from './services/environment';
import type { Discovery, Role } from './portal/contracts';
import type { Note } from './domain/models';
import { area, selectField } from './portal/presentation';
import type { AppState, Course, LearningGateway, View } from './domain/models';
import { dayLabel, moveMonth, parseDate } from './domain/calendar';
import { createDemoGateway } from './services/demo-gateway';
import { SpaceRenderer } from './render/space-renderer';
import { login, shell, welcome } from './ui/shell';
import { overview } from './ui/overview';
import { courseInspector, courses } from './ui/courses';
import { account, notes } from './ui/secondary';
import { escapeHtml as e } from './ui/html';
import { icon } from './ui/icons';
import { inviteDialog, searchResults } from './ui/navigation-dialogs';

const INTRO_KEY = 'astra.qianduan.intro-seen';
const validViews = new Set<View>([
  'overview',
  'courses',
  'classes',
  'notes',
  'account',
  'manage',
  'lab',
  'code',
  'future',
  'assignments',
  'teaching',
  'course',
]);
function routeView(): View | null {
  const value = location.hash.replace(/^#\/?/, '').split('/')[0] as View;
  return validViews.has(value) ? value : null;
}
function sawIntro(): boolean {
  try {
    return sessionStorage.getItem(INTRO_KEY) === 'true';
  } catch {
    return false;
  }
}

class AstraApp {
  private root = document.querySelector<HTMLDivElement>('#app')!;
  private modalRoot = document.querySelector<HTMLDivElement>('#modal-root')!;
  private toastElement = document.querySelector<HTMLDivElement>('#toast')!;
  private abort = new AbortController();
  private renderer: SpaceRenderer;
  private introTimer = 0;
  private toastTimer = 0;
  private authRequest = 0;
  private lastFocus: HTMLElement | null = null;
  private inspectorId = '';
  private portal?: PortalWorkspace;
  private registering = false;
  private noteOriginal: Note | null = null;
  private noteBusy = false;
  private discovery?: Discovery;
  private pendingView: View = routeView() || 'overview';
  private state: AppState = {
    phase: 'welcome',
    view: 'overview',
    session: null,
    sidebarCollapsed: innerWidth <= 900,
    courses: [],
    tasks: [],
    selectedCourse: 'functions',
    calendarMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1, 12),
    selectedDate: new Date(),
    weekOffset: 0,
    notes: [],
    activeNote: '',
    noteDirty: false,
    moreNotes: false,
    openCourseId: Number(location.hash.split('/')[2]) || undefined,
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
  };

  constructor(private gateway: LearningGateway) {
    this.renderer = new SpaceRenderer(document.querySelector<HTMLCanvasElement>('#universe')!, {
      reducedMotion: this.state.reducedMotion,
      onSelect: (id) => this.selectCourse(id, false),
    });
    this.renderer.attachWelcome(this.root);
    const { signal } = this.abort;
    this.root.addEventListener('click', this.click, { signal });
    this.root.addEventListener('submit', this.submit, { signal });
    this.root.addEventListener('input', this.input, { signal });
    this.modalRoot.addEventListener('click', this.click, { signal });
    this.modalRoot.addEventListener('submit', this.submit, { signal });
    document.addEventListener(
      'click',
      (event) => {
        if (!(event.target as Element).closest('.brand-switcher')) this.closeSpaces();
      },
      { signal },
    );
    window.addEventListener(
      'hashchange',
      () => {
        const view = routeView();
        if (view) {
          this.pendingView = view;
          if (this.state.phase === 'workspace')
            this.showView(view, Number(location.hash.split('/')[2]) || undefined);
        } else if (this.state.phase === 'workspace') this.showWelcome();
      },
      { signal },
    );
    document.addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'Escape') this.closeSpaces();
        if (event.key === 'Escape' && this.state.phase === 'intro') this.finishIntro();
        if (
          event.key === 'Escape' &&
          innerWidth <= 900 &&
          !this.state.sidebarCollapsed &&
          this.state.phase === 'workspace'
        )
          this.toggleSidebar(true);
      },
      { signal },
    );
    matchMedia('(prefers-reduced-motion: reduce)').addEventListener(
      'change',
      (event) => {
        this.applyMotion(event.matches);
        if (event.matches && this.state.phase === 'intro') this.finishIntro();
      },
      { signal },
    );
    matchMedia('(max-width: 900px)').addEventListener(
      'change',
      (event) => {
        if (event.matches) this.toggleSidebar(true);
        else this.syncSidebarAccessibility();
      },
      { signal },
    );
    window.addEventListener(
      'beforeunload',
      (event) => {
        if (this.state.noteDirty || this.portal?.hasChanges()) {
          event.preventDefault();
          event.returnValue = '';
        }
      },
      { signal },
    );
    window.addEventListener('pagehide', () => this.dispose(), { signal });
    document.documentElement.classList.toggle('reduced-motion', this.state.reducedMotion);
    void this.start();
  }

  private async start(): Promise<void> {
    this.root.innerHTML =
      '<section class="startup-error"><h1>星序</h1><p role="status">正在连接学习空间…</p></section>';
    try {
      const session = await this.gateway.getSession();
      this.state.session = session;
      if (session) await this.refreshData();
      if (session && routeView()) {
        this.state.phase = 'workspace';
        this.state.view = routeView()!;
        if (this.state.view === 'notes') await this.loadNotes();
        this.render();
      } else if (!sawIntro()) this.startIntro();
      else this.render();
    } catch (error) {
      this.root.innerHTML =
        '<section class="startup-error"><h1>星序</h1><p>页面暂时没有准备好，请刷新重试。</p><button class="quiet-button" data-action="reload">重新加载</button></section>';
      console.error(error);
    }
  }

  private startIntro(): void {
    clearTimeout(this.introTimer);
    this.state.phase = 'intro';
    this.renderer.setMode('welcome');
    this.render();
    const duration = this.renderer.playIntro();
    this.introTimer = window.setTimeout(() => this.finishIntro(), duration);
  }

  private finishIntro(): void {
    clearTimeout(this.introTimer);
    this.renderer.finishIntro();
    try {
      sessionStorage.setItem(INTRO_KEY, 'true');
    } catch {
      /* Session storage is optional. */
    }
    this.state.phase = 'welcome';
    this.render();
  }

  private render(focus?: string): void {
    const previousWorkspace = this.root.querySelector<HTMLElement>('.workspace');
    const scrollTop =
      previousWorkspace?.dataset.workspaceView === this.state.view ? previousWorkspace.scrollTop : 0;
    this.portal?.destroy();
    this.portal = undefined;
    this.renderer.attachOrbit(null);
    document.body.dataset.phase = this.state.phase;
    document.body.dataset.view = this.state.view;
    if (this.state.phase === 'intro' || this.state.phase === 'welcome') {
      this.root.innerHTML = welcome(this.state.phase === 'intro');
      this.renderer.setMode('welcome');
      return;
    }
    if (this.state.phase === 'login') {
      this.root.innerHTML = login(this.gateway.mode === 'demo', this.registering);
      this.renderer.setMode('login');
      if (innerWidth >= 900)
        this.root.querySelector<HTMLInputElement>('#account-name')?.focus({ preventScroll: true });
      return;
    }
    const role = this.state.session?.role || 'student';
    const usePortal =
      ['course', 'classes', 'manage', 'assignments', 'teaching'].includes(this.state.view) ||
      (role !== 'student' && ['overview', 'courses'].includes(this.state.view));
    let content = '<div class="portal-loading" role="status">正在读取…</div>';
    if (!usePortal)
      switch (this.state.view) {
        case 'overview':
          content = overview(this.state);
          break;
        case 'courses':
          content = courses(this.state);
          break;
        case 'notes':
          content = notes(this.state);
          break;
        case 'account':
          content = account(this.state);
          break;
        default: {
          const destinations = {
            lab: ['工科实验室', 'labs/index.html#home'],
            code: ['代码空间', 'labs/codevis/index.html'],
            future: ['未来星系', 'labs/index.html#frontier'],
          } as const;
          const entry = destinations[this.state.view as keyof typeof destinations];
          content = entry
            ? `<div class="laboratory-view"><header class="portal-heading"><h1>${entry[0]}</h1><a class="quiet-button" href="${e(frontendAsset(entry[1]))}" target="_blank" rel="noopener">独立窗口打开 ${icon('arrow')}</a></header><iframe class="portal-experiment-frame" title="${entry[0]}" src="${e(frontendAsset(entry[1]))}" allow="fullscreen"></iframe></div>`
            : '';
        }
      }
    this.root.innerHTML = shell(this.state, content);
    const workspace = this.root.querySelector<HTMLElement>('.workspace')!;
    workspace.scrollTop = scrollTop;
    this.syncSidebarAccessibility();
    const orbit = this.state.view === 'courses' && role === 'student';
    this.renderer.setMode(orbit ? 'courses' : 'ambient');
    if (orbit) {
      this.renderer.attachOrbit(this.root.querySelector('#orbit-stage'));
      this.renderer.select(this.state.selectedCourse, true);
      this.inspectorId = this.state.selectedCourse;
    }
    if (usePortal) {
      this.portal = new PortalWorkspace(workspace, this.gateway.school, {
        role,
        userId: Number(this.state.session?.userId),
        demo: this.gateway.mode === 'demo',
        activities,
        notify: (message) => this.notify(message),
        navigate: (view, id) => this.showView(view, id, false),
        changed: () => this.refreshData(),
      });
      this.portal.mount(
        this.state.view,
        this.state.openCourseId,
        this.state.openAssignmentId
          ? `${this.state.openAssignmentId}:${this.state.openAssignmentClassId}`
          : '',
      );
    }
    if (focus) this.root.querySelector<HTMLElement>(focus)?.focus({ preventScroll: true });
  }

  private canLeave(): boolean {
    if (this.noteBusy) {
      this.notify('正在保存笔记，请稍候。');
      return false;
    }
    if (this.portal && !this.portal.canLeave()) return false;
    if (this.state.noteDirty) {
      if (!confirm('笔记尚未保存，确定放弃本次修改吗？')) return false;
      if (this.noteOriginal) {
        const index = this.state.notes.findIndex((note) => note.id === this.noteOriginal!.id);
        if (index >= 0) this.state.notes[index] = this.noteOriginal;
      }
      this.state.noteDirty = false;
      this.noteOriginal = null;
    }
    return true;
  }
  private routeHash(): string {
    return `#/${this.state.view}${this.state.view === 'course' && this.state.openCourseId ? '/' + this.state.openCourseId : ''}`;
  }
  private showView(view: View, courseId?: number, guard = true): void {
    if (!this.state.session) return;
    if (guard && !this.canLeave()) {
      history.replaceState(null, '', this.routeHash());
      return;
    }
    this.state.view = view;
    this.state.phase = 'workspace';
    this.pendingView = view;
    if (courseId) this.state.openCourseId = courseId;
    if (innerWidth <= 900) this.state.sidebarCollapsed = true;
    if (location.hash !== this.routeHash()) history.pushState(null, '', this.routeHash());
    this.render();
    if (view === 'notes')
      void this.loadNotes()
        .then(() => {
          if (this.state.view === 'notes' && !this.state.noteDirty) this.render();
        })
        .catch((error) => this.notify(error.message));
    this.root.querySelector<HTMLElement>('#workspace')?.focus({ preventScroll: true });
  }
  private async refreshData(): Promise<void> {
    const request = this.authRequest;
    const [courseData, tasks, application] = await Promise.all([
      this.gateway.getCourses(),
      this.gateway.getTasks(),
      this.state.session?.role === 'student'
        ? this.gateway.school.myTeacherApplication()
        : Promise.resolve(null),
    ]);
    if (request !== this.authRequest) return;
    this.state.courses = courseData;
    this.state.tasks = tasks;
    this.state.teacherApplication = application;
    if (!courseData.some((course) => course.id === this.state.selectedCourse))
      this.state.selectedCourse = courseData[0]?.id || '';
    this.renderer.setCourses(courseData);
  }
  private async loadNotes(more = false): Promise<void> {
    const request = this.authRequest;
    const data = await this.gateway.getNotes(more ? this.state.notes.length : 0);
    if (request !== this.authRequest || this.state.noteDirty) return;
    this.state.notes = more
      ? [...this.state.notes, ...data.filter((note) => !this.state.notes.some((old) => old.id === note.id))]
      : data;
    this.state.moreNotes = data.length === 50;
    if (!this.state.notes.some((note) => note.id === this.state.activeNote))
      this.state.activeNote = this.state.notes[0]?.id || '';
  }
  private async noteAction(action: string): Promise<void> {
    if (this.noteBusy) return;
    if (action === 'new-note' && !this.canLeave()) return;
    this.noteBusy = true;
    try {
      const note = this.state.notes.find((item) => item.id === this.state.activeNote);
      if (action === 'new-note') {
        const created = await this.gateway.createNote();
        this.state.notes.unshift(created);
        this.state.activeNote = created.id;
      }
      if (action === 'save-note' && note) {
        const saved = await this.gateway.saveNote(note);
        this.state.notes[this.state.notes.indexOf(note)] = saved;
        this.state.noteDirty = false;
        this.noteOriginal = null;
        this.notify('笔记已保存。');
      }
      if (action === 'delete-note' && note && confirm('删除这条笔记？')) {
        await this.gateway.deleteNote(note);
        this.state.notes = this.state.notes.filter((item) => item.id !== note.id);
        this.state.activeNote = this.state.notes[0]?.id || '';
        this.state.noteDirty = false;
        this.noteOriginal = null;
      }
      if (action === 'more-notes') await this.loadNotes(true);
      this.render(action === 'new-note' ? '#note-title' : undefined);
    } catch (error) {
      this.notify(error instanceof Error ? error.message : '笔记操作失败。');
    } finally {
      this.noteBusy = false;
    }
  }

  private showWelcome(): void {
    if (!this.canLeave()) return;
    this.authRequest++;
    this.closeDialog();
    clearTimeout(this.introTimer);
    this.renderer.finishIntro();
    this.state.phase = 'welcome';
    history.replaceState(null, '', location.pathname + location.search);
    this.render();
  }

  private toggleSidebar(collapsed = !this.state.sidebarCollapsed): void {
    this.state.sidebarCollapsed = collapsed;
    const shell = this.root.querySelector('.app-shell');
    shell?.classList.toggle('is-collapsed', collapsed);
    this.root
      .querySelectorAll('[data-action="sidebar"]')
      .forEach((button) => button.setAttribute('aria-expanded', String(!collapsed)));
    const button = this.root.querySelector('.collapse-button');
    button?.setAttribute('aria-label', collapsed ? '展开侧栏' : '收起侧栏');
    this.syncSidebarAccessibility();
  }

  private syncSidebarAccessibility(): void {
    const mobile = innerWidth <= 900,
      hidden = mobile && this.state.sidebarCollapsed;
    const sidebar = this.root.querySelector<HTMLElement>('.sidebar');
    if (sidebar) {
      sidebar.inert = hidden;
      if (hidden) sidebar.setAttribute('aria-hidden', 'true');
      else sidebar.removeAttribute('aria-hidden');
    }
    const scrim = this.root.querySelector<HTMLButtonElement>('.sidebar-scrim');
    if (scrim) {
      scrim.tabIndex = mobile && !hidden ? 0 : -1;
      scrim.setAttribute('aria-hidden', String(!mobile || hidden));
    }
    const workspace = this.root.querySelector<HTMLElement>('.workspace');
    if (workspace) workspace.inert = mobile && !hidden;
  }

  private applyMotion(reduced: boolean): void {
    this.state.reducedMotion = reduced;
    this.renderer.setReducedMotion(reduced);
    document.documentElement.classList.toggle('reduced-motion', reduced);
    this.root.querySelectorAll<HTMLElement>('[data-action="motion"]').forEach((button) => {
      if (button.getAttribute('role') === 'switch') {
        button.setAttribute('aria-checked', String(reduced));
        button.classList.toggle('is-on', reduced);
      } else {
        button.setAttribute('aria-pressed', String(reduced));
        button.setAttribute('aria-label', reduced ? '恢复星空动效' : '减少星空动效');
        button.title = reduced ? '恢复星空动效' : '减少星空动效';
        button.classList.toggle('is-muted', reduced);
      }
    });
  }

  private selectCourse(id: string, move = true): void {
    if (!this.state.courses.some((course) => course.id === id)) return;
    if (move) {
      this.renderer.select(id);
      return;
    }
    this.state.selectedCourse = id;
    this.updateInspector(id);
    const announcement = this.root.querySelector('#course-announcement');
    if (announcement) announcement.textContent = `当前课程：${this.course(id)?.title}`;
    this.root.querySelectorAll<HTMLButtonElement>('[data-galaxy]').forEach((button) => {
      button.classList.toggle('is-selected', button.dataset.galaxy === id);
      button.setAttribute('aria-pressed', String(button.dataset.galaxy === id));
    });
  }

  private updateInspector(id: string): void {
    const course = this.course(id),
      inspector = this.root.querySelector('#course-inspector');
    if (!course || !inspector || id === this.inspectorId) return;
    inspector.innerHTML = courseInspector(course);
    this.inspectorId = id;
    inspector.animate(
      [
        { opacity: 0.6, transform: 'translateY(4px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ],
      { duration: this.state.reducedMotion ? 0 : 200, easing: 'ease-out' },
    );
  }

  private course(id: string): Course | undefined {
    return this.state.courses.find((course) => course.id === id);
  }

  private openDialog(content: string): void {
    this.lastFocus = document.activeElement as HTMLElement;
    this.modalRoot.innerHTML = `<dialog class="detail-dialog" aria-labelledby="dialog-title"><button class="dialog-close icon-button" data-action="dialog-close" aria-label="关闭窗口">${icon('close')}</button>${content}</dialog>`;
    const dialog = this.modalRoot.querySelector('dialog')!;
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) {
        const r = dialog.getBoundingClientRect();
        if (
          event.clientX < r.left ||
          event.clientX > r.right ||
          event.clientY < r.top ||
          event.clientY > r.bottom
        )
          this.closeDialog();
      }
    });
    const restoreFocus = this.lastFocus;
    dialog.addEventListener(
      'close',
      () => {
        dialog.remove();
        if (restoreFocus?.isConnected && !this.modalRoot.querySelector('dialog[open]'))
          restoreFocus.focus({ preventScroll: true });
      },
      { once: true },
    );
    dialog.showModal();
  }

  private closeDialog(): void {
    this.modalRoot.querySelector('dialog')?.close();
  }
  private closeSpaces(): void {
    const menu = this.root.querySelector<HTMLElement>('.space-menu');
    if (menu) menu.hidden = true;
    this.root.querySelector('[data-action="spaces"]')?.setAttribute('aria-expanded', 'false');
  }
  private notify(message: string): void {
    clearTimeout(this.toastTimer);
    this.toastElement.textContent = message;
    this.toastElement.classList.add('is-visible');
    this.toastTimer = window.setTimeout(() => this.toastElement.classList.remove('is-visible'), 2800);
  }

  private async authenticate(guest: boolean, form?: HTMLFormElement, role?: Role): Promise<void> {
    const request = ++this.authRequest;
    const button = form?.querySelector<HTMLButtonElement>('[type="submit"]');
    const error = this.root.querySelector('#login-error');
    if (error) error.textContent = '';
    if (button) {
      button.disabled = true;
      button.classList.add('is-loading');
    }
    try {
      const data = form ? new FormData(form) : null;
      if (this.registering && !guest) {
        await this.gateway.register(
          String(data?.get('account') || ''),
          String(data?.get('displayName') || ''),
          String(data?.get('password') || ''),
        );
        this.registering = false;
      }
      const session = guest
        ? await this.gateway.enterAsGuest(role)
        : await this.gateway.signIn(String(data?.get('account') || ''), String(data?.get('password') || ''));
      if (request !== this.authRequest) return;
      this.state.session = session;
      this.state.notes = [];
      this.state.activeNote = '';
      this.state.noteDirty = false;
      await this.refreshData();
      if (request !== this.authRequest) return;
      this.showView(guest ? 'overview' : this.pendingView, undefined, false);
    } catch (cause) {
      if (request === this.authRequest && error)
        error.textContent = cause instanceof Error ? cause.message : '暂时无法进入，请重试。';
    } finally {
      if (button?.isConnected) {
        button.disabled = false;
        button.classList.remove('is-loading');
      }
    }
  }

  private click = (event: MouseEvent): void => {
    if ((event.target as Element).closest('[data-portal]')) return;
    const anchor = (event.target as Element).closest<HTMLAnchorElement>('a[href^="#/"]');
    if (anchor) {
      event.preventDefault();
      const parts = anchor.hash.slice(2).split('/');
      this.showView(parts[0] as View, Number(parts[1]) || undefined);
      return;
    }
    const target = (event.target as Element).closest<HTMLElement>('button');
    if (!target || (target instanceof HTMLButtonElement && target.disabled)) return;
    if (target.dataset.demoRole) {
      if (this.canLeave()) void this.authenticate(true, undefined, target.dataset.demoRole as Role);
      return;
    }
    if (target.dataset.view) {
      this.closeDialog();
      this.showView(target.dataset.view as View);
      return;
    }
    if (target.dataset.galaxy) {
      this.selectCourse(target.dataset.galaxy);
      return;
    }
    if (target.dataset.nebula !== undefined) {
      this.renderer.selectNebula(Number(target.dataset.nebula));
      return;
    }
    if (target.dataset.searchCourse) {
      this.closeDialog();
      this.state.selectedCourse = target.dataset.searchCourse;
      this.showView('courses');
      return;
    }
    if (target.dataset.orbitStep) {
      this.renderer.step(Number(target.dataset.orbitStep));
      return;
    }
    if (target.dataset.courseDetail) {
      const course = this.course(target.dataset.courseDetail);
      if (course) this.showView('course', course.backendId || Number(course.id));
      return;
    }
    if (target.dataset.task) {
      const task = this.state.tasks.find((item) => item.id === target.dataset.task);
      if (task) {
        this.state.openAssignmentId = task.assignmentId;
        this.state.openAssignmentClassId = task.classId;
        this.showView('assignments');
      }
      return;
    }
    if (target.dataset.month) {
      const month = moveMonth(this.state.calendarMonth, Number(target.dataset.month));
      const lastDay = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
      this.state.calendarMonth = month;
      this.state.selectedDate = new Date(
        month.getFullYear(),
        month.getMonth(),
        Math.min(this.state.selectedDate.getDate(), lastDay),
        12,
      );
      this.render(`[data-month="${target.dataset.month}"]`);
      return;
    }
    if (target.dataset.week) {
      this.state.weekOffset += Number(target.dataset.week);
      this.render(`[data-week="${target.dataset.week}"]`);
      return;
    }
    if (target.dataset.date) {
      this.state.selectedDate = parseDate(target.dataset.date);
      this.state.calendarMonth = new Date(
        this.state.selectedDate.getFullYear(),
        this.state.selectedDate.getMonth(),
        1,
        12,
      );
      this.render(`[data-date="${target.dataset.date}"]`);
      return;
    }
    if (target.dataset.note) {
      if (!this.canLeave()) return;
      this.state.activeNote = target.dataset.note;
      this.render();
      return;
    }
    switch (target.dataset.action) {
      case 'explore':
        if (this.state.session) this.showView(this.pendingView);
        else {
          this.state.phase = 'login';
          this.render();
        }
        break;
      case 'welcome':
        this.showWelcome();
        break;
      case 'register':
        this.registering = !this.registering;
        this.render();
        break;
      case 'sidebar':
        this.toggleSidebar();
        break;
      case 'spaces': {
        const menu = this.root.querySelector<HTMLElement>('.space-menu');
        if (menu) {
          menu.hidden = !menu.hidden;
          target.setAttribute('aria-expanded', String(!menu.hidden));
        }
        break;
      }
      case 'invite':
        this.openDialog(inviteDialog());
        break;
      case 'sidebar-close':
        this.toggleSidebar(true);
        break;
      case 'dialog-close':
        this.closeDialog();
        break;
      case 'password': {
        const input = this.root.querySelector<HTMLInputElement>('#account-password')!;
        input.type = input.type === 'password' ? 'text' : 'password';
        target.setAttribute('aria-label', input.type === 'password' ? '显示密码' : '隐藏密码');
        target.setAttribute('aria-pressed', String(input.type === 'text'));
        break;
      }
      case 'today':
        this.state.selectedDate = new Date();
        this.state.calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1, 12);
        this.render('[data-action="today"]');
        break;
      case 'motion':
        this.applyMotion(!this.state.reducedMotion);
        this.notify(this.state.reducedMotion ? '已减弱持续动画。' : '星空动效已恢复。');
        break;
      case 'logout':
        if (this.canLeave())
          void this.gateway
            .signOut()
            .then(() => {
              this.state.session = null;
              this.state.notes = [];
              this.state.courses = [];
              this.state.tasks = [];
              this.showWelcome();
            })
            .catch((error) => this.notify(error.message));
        break;
      case 'replay':
        history.replaceState(null, '', location.pathname + location.search);
        this.startIntro();
        break;
      case 'new-note':
      case 'save-note':
      case 'delete-note':
      case 'more-notes':
        void this.noteAction(target.dataset.action);
        break;
      case 'export-note': {
        const note = this.state.notes.find((item) => item.id === this.state.activeNote)!;
        const blob = new Blob([`${note.title || '未命名笔记'}\n\n${note.content}`], {
          type: 'text/plain;charset=utf-8',
        });
        const url = URL.createObjectURL(blob),
          a = document.createElement('a');
        a.href = url;
        a.download = `${(note.title || '星序笔记').replace(/[<>:"/\\|?*]/g, '_')}.txt`;
        a.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 500);
        this.notify('笔记已导出。');
        break;
      }
      case 'reload':
        location.reload();
        break;
    }
  };

  private submit = (event: SubmitEvent): void => {
    const form = event.target as HTMLFormElement;
    if (form.id.startsWith('portal-') || form.className.includes('portal-')) return;
    event.preventDefault();
    if (!form.reportValidity()) return;
    if (form.id === 'login-form') void this.authenticate(false, form);
    if (form.id === 'course-search')
      this.openDialog(searchResults(String(new FormData(form).get('query') || ''), this.state.courses));
    if (form.id === 'invite-form')
      void this.formRequest(form, async () => {
        this.discovery = await this.gateway.school.discover(String(new FormData(form).get('code') || ''));
        const item = this.discovery;
        this.openDialog(
          `<h2 id="dialog-title">${e(item.title)}</h2><p class="dialog-description">${e(item.summary)}</p><p>${e(item.teachers.map((teacher) => teacher.display_name).join('、'))}</p>${
            item.can_request
              ? `<form id="course-join-form">${
                  item.eligible_source_classes.length
                    ? selectField(
                        '所在班级',
                        'class_id',
                        item.eligible_source_classes.map((group) => ({
                          value: group.class_id,
                          label: group.name,
                        })),
                      )
                    : ''
                }${area('申请说明', 'message', '')}<button class="primary-button" type="submit">申请加入课程</button></form>`
              : `<p class="dialog-note">${e(({ already_enrolled: '你已加入这门课程。', pending_request: '你已提交申请，请等待教师处理。', not_in_school: '请先加入本校班级。', no_eligible_class: '当前班级不在课程允许范围内。' } as Record<string, string>)[item.eligibility_reason] || '当前账号暂不可申请，请核对学校与班级范围。')}</p>`
          }`,
        );
      });
    if (form.id === 'course-join-form')
      void this.formRequest(form, async () => {
        const data = new FormData(form);
        await this.gateway.school.requestCourse(
          this.discovery!.course_id,
          Number(data.get('class_id')) || null,
          String(data.get('message') || ''),
        );
        this.closeDialog();
        this.notify('申请已提交，等待教师处理。');
      });
    if (form.id === 'teacher-application-form')
      void this.formRequest(form, async () => {
        this.state.teacherApplication = await this.gateway.school.applyTeacher(
          String(new FormData(form).get('message') || ''),
        );
        form.innerHTML =
          '<p class="portal-note">教师申请已提交，请等待学校核验。审核通过后重新登录即可使用教师工作台。</p>';
      });
    if (form.id === 'profile-form')
      void this.formRequest(form, async () => {
        this.state.session = await this.gateway.updateDisplayName(
          this.root.querySelector<HTMLInputElement>('#display-name')!.value,
        );
        this.render();
        this.notify('显示名称已更新。');
      });
  };

  private input = (event: Event): void => {
    const target = event.target as HTMLInputElement | HTMLTextAreaElement;
    if (target.id !== 'note-title' && target.id !== 'note-content') return;
    const note = this.state.notes.find((item) => item.id === this.state.activeNote);
    if (!note) return;
    if (!this.state.noteDirty) this.noteOriginal = { ...note };
    this.state.noteDirty = true;
    const status = this.root.querySelector('#note-state');
    if (status) status.textContent = '有未保存的修改';
    if (target.id === 'note-title') note.title = target.value;
    else note.content = target.value;
    note.modified = dayLabel(new Date());
    const preview = this.root.querySelector(`[data-note="${note.id}"]`);
    const title = preview?.querySelector('strong'),
      body = preview?.querySelector('span');
    if (title) title.textContent = note.title || '未命名笔记';
    if (body) body.textContent = note.content.slice(0, 45) || '等待你的第一个想法。';
  };

  private async formRequest(form: HTMLFormElement, action: () => Promise<void>): Promise<void> {
    if (form.dataset.pending) return;
    form.dataset.pending = 'true';
    const submit = form.querySelector<HTMLButtonElement>('[type=submit]');
    if (submit) submit.disabled = true;
    try {
      await action();
    } catch (error) {
      const message = error instanceof Error ? error.message : '操作失败。';
      this.notify(message);
      let feedback = form.querySelector('.form-error');
      if (!feedback) {
        form.insertAdjacentHTML('beforeend', '<p class="form-error" role="alert"></p>');
        feedback = form.querySelector('.form-error');
      }
      if (feedback) feedback.textContent = message;
    } finally {
      delete form.dataset.pending;
      if (submit) submit.disabled = false;
    }
  }

  dispose(): void {
    clearTimeout(this.introTimer);
    clearTimeout(this.toastTimer);
    this.authRequest++;
    this.closeDialog();
    this.abort.abort();
    this.portal?.destroy();
    this.portal = undefined;
    this.renderer.dispose();
    this.root.replaceChildren();
  }
}

const app = new AstraApp(DEMO_MODE ? createDemoGateway() : createApiGateway(API_BASE));
const reloadRestoredPage = (event: PageTransitionEvent) => {
  if (event.persisted) location.reload();
};
window.addEventListener('pageshow', reloadRestoredPage);
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    app.dispose();
    window.removeEventListener('pageshow', reloadRestoredPage);
  });
