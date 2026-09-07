import type { AppState, View } from '../domain/models';
import { brandMark, icon } from './icons';
import { escapeHtml as e } from './html';
import { demoRoles } from './secondary';

export const destinations: { view: View; label: string }[] = [
  { view: 'overview', label: '星序总览' },
  { view: 'manage', label: '管理页面' },
  { view: 'lab', label: '工科实验室' },
  { view: 'code', label: '代码空间' },
  { view: 'future', label: '未来星系' },
];
const navigation = [
  { view: 'overview', label: '星序总览', icon: 'orbit' },
  { view: 'courses', label: '课程', icon: 'book' },
  { view: 'classes', label: '班级', icon: 'users' },
  { view: 'notes', label: '笔记', icon: 'note' },
];

export function nebulaControls(): string {
  return `<div class="nebula-controls" role="group" aria-label="星云轮播">${['苍蓝星云', '紫色星云', '琥珀星云'].map((name, index) => `<button data-nebula="${index}" aria-label="${name}" aria-pressed="${index === 0}"><span></span></button>`).join('')}</div>`;
}

export function welcome(intro: boolean): string {
  return `<section class="welcome ${intro ? 'is-assembling' : ''}" aria-label="星序探索入口">
    <div class="welcome-mist" aria-hidden="true"></div>
    <div class="welcome-copy">
      <div class="welcome-brand"><h1>星序</h1><p class="welcome-latin">ASTRA</p></div>
      <button class="explore-button" data-action="explore" ${intro ? 'disabled' : ''}><span>点击以探索星序</span><span class="explore-rule" aria-hidden="true"><i></i>${icon('star')}<i></i></span></button>
    </div>
    ${nebulaControls()}
    <span class="sr-only" role="status">${intro ? '众星归位，正在展开星系。' : '星系已展开，可以探索。'}</span>
  </section>`;
}

export function login(demo: boolean, register = false): string {
  return `<section class="login-screen view-enter"><button class="back-link login-back" data-action="welcome">${icon('left')}<span>返回星空</span></button><div class="login-scene" aria-label="可交互星云"><div class="login-brand">${brandMark()}<h1>星序</h1><p>ASTRA</p></div>${nebulaControls()}</div><div class="login-panel"><div class="login-form-wrap"><span class="small-orbit" aria-hidden="true">${brandMark()}</span><h2>${demo ? '探索不同的视角' : register ? '加入星序' : '欢迎回到星序'}</h2><p class="login-intro">${demo ? '从学习、教学到管理。' : '让探索，从这里继续。'}</p>${demo ? demoRoles() : `<form id="login-form"><label class="field-label" for="account-name">账号</label><div class="input-wrap">${icon('user')}<input id="account-name" name="account" autocomplete="username" maxlength="64" placeholder="输入你的账号" required/></div>${register ? '<label class="field-label" for="register-name">显示名称</label><div class="input-wrap"><input id="register-name" name="displayName" maxlength="120" required placeholder="你希望如何被称呼"/></div>' : ''}<label class="field-label" for="account-password">密码</label><div class="input-wrap">${icon('lock')}<input id="account-password" name="password" type="password" autocomplete="${register ? 'new-password' : 'current-password'}" minlength="8" maxlength="128" placeholder="输入密码" required/><button type="button" class="password-toggle icon-button" data-action="password" aria-label="显示密码" aria-pressed="false">${icon('eye')}</button></div><button class="primary-button login-submit" type="submit"><span>${register ? '创建学生账号' : '进入星序'}</span>${icon('arrow')}</button></form><button class="guest-button" data-action="register">${register ? '已有账号，返回登录' : '创建学生账号'}</button>`}<p id="login-error" class="form-error" role="alert"></p>${demo ? '<p class="demo-note">静态演示 · 不连接真实账号和数据库<br>演示操作仅在当前页面内有效，刷新后重置。</p>' : ''}</div></div></section>`;
}

export function shell(state: AppState, content: string): string {
  const role = state.session?.role || 'student';
  const items =
    role === 'admin'
      ? [
          { view: 'manage', label: '学校管理', icon: 'shield' },
          { view: 'classes', label: '班级', icon: 'users' },
          { view: 'notes', label: '笔记', icon: 'note' },
        ]
      : navigation
          .map((item) =>
            item.view === 'overview' && role === 'teacher' ? { ...item, label: '教学工作台' } : item,
          )
          .flatMap((item) =>
            item.view === 'courses'
              ? [
                  item,
                  { view: 'assignments', label: role === 'teacher' ? '作业与批改' : '作业', icon: 'list' },
                ]
              : [item],
          );
  const spaces = destinations.filter((item) => item.view !== 'manage' || role === 'admin');
  const current =
    [...items, ...destinations, { view: 'account', label: '账号' }, { view: 'course', label: '课程' }].find(
      (item) => item.view === state.view,
    )?.label || '总览';
  return `<div class="app-shell ${state.sidebarCollapsed ? 'is-collapsed' : ''}">
    <header class="topbar">
      <div class="brand-switcher"><button class="topbar-brand" data-action="spaces" aria-label="星序，切换空间" aria-expanded="false">${brandMark()}<span class="brand-name">星序</span></button><nav class="space-menu" aria-label="主要空间" hidden>${spaces.map((item) => `<a href="#/${item.view}">${item.label}</a>`).join('')}<button data-action="welcome">返回星空</button></nav></div>
      <button class="mobile-menu icon-button" data-action="sidebar" aria-label="切换侧边栏" aria-expanded="${!state.sidebarCollapsed}">${icon('menu')}</button>
      <span class="current-page">${e(current.replace('星序总览', '总览').replace('管理页面', '管理'))}</span>
      <div class="topbar-actions"><form id="course-search" role="search">${icon('search')}<input name="query" type="search" placeholder="搜索课程" aria-label="搜索课程" autocomplete="off" maxlength="80"/><button type="submit" class="search-submit" aria-label="开始搜索">${icon('arrow')}</button></form>${role === 'student' ? `<button class="invite-button" data-action="invite">输入邀请码 ${icon('plus')}</button>` : ''}${state.session?.source === 'demo' ? '<span class="demo-indicator">静态演示</span>' : ''}</div>
    </header>
    <button class="sidebar-scrim" data-action="sidebar-close" aria-label="收起菜单" tabindex="${state.sidebarCollapsed ? -1 : 0}"></button>
    <aside class="sidebar" aria-label="个人学习导航">
      <div class="sidebar-tools"><button class="collapse-button icon-button" data-action="sidebar" aria-label="${state.sidebarCollapsed ? '展开侧栏' : '收起侧栏'}" aria-expanded="${!state.sidebarCollapsed}">${icon('chevrons')}</button></div>
      <nav class="side-navigation">${items.map((item) => `<a class="side-link ${state.view === item.view ? 'is-active' : ''}" href="#/${item.view}" title="${item.label}" ${state.view === item.view ? 'aria-current="page"' : ''}>${icon(item.icon)}<span>${item.label}</span><i class="nav-glint" aria-hidden="true"></i></a>`).join('')}</nav>
      <a class="sidebar-account ${state.view === 'account' ? 'is-active' : ''}" href="#/account" title="账号信息"><span class="avatar">${e(state.session?.displayName.slice(0, 1) || '星')}</span><span class="account-label"><strong>账号信息</strong><small>${e(state.session?.displayName)}</small></span>${icon('right')}</a>
    </aside>
    <main class="workspace ${state.view === 'courses' && role === 'student' ? 'workspace--courses' : ''}" id="workspace" data-workspace-view="${state.view}" tabindex="-1">${content}</main>
  </div>`;
}
