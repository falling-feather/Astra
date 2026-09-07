import type { AppState, View } from '../domain/models';
import { brandMark, icon } from './icons';
import { escapeHtml as e } from './html';

export const destinations: {view:View;label:string}[] = [
  {view:'overview',label:'星序总览'},{view:'manage',label:'管理页面'},{view:'lab',label:'工科实验室'},{view:'code',label:'代码空间'},{view:'future',label:'未来星系'},
];
const navigation = [
  {view:'overview',label:'星序总览',icon:'orbit'},
  {view:'courses',label:'课程',icon:'book'},
  {view:'classes',label:'班级',icon:'users'},
  {view:'notes',label:'笔记',icon:'note'},
];

export function nebulaControls():string {
  return `<div class="nebula-controls" role="group" aria-label="星云轮播">${['苍蓝星云','紫色星云','琥珀星云'].map((name,index)=>`<button data-nebula="${index}" aria-label="${name}" aria-pressed="${index===0}"><span></span></button>`).join('')}</div>`;
}

export function welcome(intro:boolean): string {
  return `<section class="welcome ${intro?'is-assembling':''}" aria-label="星序探索入口">
    <div class="welcome-mist" aria-hidden="true"></div>
    <div class="welcome-copy">
      <div class="welcome-brand"><h1>星序</h1><p class="welcome-latin">ASTRA</p></div>
      <button class="explore-button" data-action="explore" ${intro?'disabled':''}><span>点击以探索星序</span><span class="explore-rule" aria-hidden="true"><i></i>${icon('star')}<i></i></span></button>
    </div>
    ${nebulaControls()}
    <span class="sr-only" role="status">${intro?'众星归位，正在展开星系。':'星系已展开，可以探索。'}</span>
  </section>`;
}

export function login():string {
  return `<section class="login-screen view-enter">
    <button class="back-link login-back" data-action="welcome">${icon('left')}<span>返回星空</span></button>
    <div class="login-scene" aria-label="可交互星云"><div class="login-brand">${brandMark()}<h1>星序</h1><p>ASTRA</p></div>${nebulaControls()}</div>
    <div class="login-panel"><div class="login-form-wrap">
      <span class="small-orbit" aria-hidden="true">${brandMark()}</span>
      <h2>欢迎回到星序</h2><p class="login-intro">让探索，从这里继续。</p>
      <form id="login-form" novalidate>
        <label class="field-label" for="account-name">账号</label>
        <div class="input-wrap">${icon('user')}<input id="account-name" name="account" autocomplete="off" maxlength="24" placeholder="输入你的账号或昵称" required /></div>
        <label class="field-label" for="account-password">密码</label>
        <div class="input-wrap">${icon('lock')}<input id="account-password" name="password" type="password" autocomplete="off" minlength="4" placeholder="输入演示密码" required /><button type="button" class="password-toggle icon-button" data-action="password" aria-label="显示密码" aria-pressed="false">${icon('eye')}</button></div>
        <p id="login-error" class="form-error" role="alert"></p>
        <button class="primary-button login-submit" type="submit"><span>进入星序</span>${icon('arrow')}</button>
      </form>
      <button class="guest-button" data-action="guest">以访客身份探索 ${icon('right')}</button>
      <p class="demo-note">前端演示 · 可填写任意账号与 4 位以上演示密码<br>不会发送或保存密码</p>
    </div></div>
  </section>`;
}

export function shell(state:AppState,content:string):string {
  const current=[...navigation,...destinations,{view:'account',label:'账号'}].find(item=>item.view===state.view)?.label||'总览';
  return `<div class="app-shell ${state.sidebarCollapsed?'is-collapsed':''}">
    <header class="topbar">
      <div class="brand-switcher"><button class="topbar-brand" data-action="spaces" aria-label="星序，切换空间" aria-expanded="false">${brandMark()}<span class="brand-name">星序</span></button><nav class="space-menu" aria-label="主要空间" hidden>${destinations.map(item=>`<a href="#/${item.view}">${item.label}</a>`).join('')}<button data-action="welcome">返回星空</button></nav></div>
      <button class="mobile-menu icon-button" data-action="sidebar" aria-label="切换侧边栏" aria-expanded="${!state.sidebarCollapsed}">${icon('menu')}</button>
      <span class="current-page">${e(current.replace('星序总览','总览').replace('管理页面','管理'))}</span>
      <div class="topbar-actions"><form id="course-search" role="search">${icon('search')}<input name="query" type="search" placeholder="搜索课程" aria-label="搜索课程" autocomplete="off" maxlength="80"/><button type="submit" class="search-submit" aria-label="开始搜索">${icon('arrow')}</button></form><button class="invite-button" data-action="invite">输入邀请码 ${icon('plus')}</button></div>
    </header>
    <button class="sidebar-scrim" data-action="sidebar-close" aria-label="收起菜单" tabindex="${state.sidebarCollapsed?-1:0}"></button>
    <aside class="sidebar" aria-label="个人学习导航">
      <div class="sidebar-tools"><button class="collapse-button icon-button" data-action="sidebar" aria-label="${state.sidebarCollapsed?'展开侧栏':'收起侧栏'}" aria-expanded="${!state.sidebarCollapsed}">${icon('chevrons')}</button></div>
      <nav class="side-navigation">${navigation.map(item=>`<a class="side-link ${state.view===item.view?'is-active':''}" href="#/${item.view}" title="${item.label}" ${state.view===item.view?'aria-current="page"':''}>${icon(item.icon)}<span>${item.label}</span><i class="nav-glint" aria-hidden="true"></i></a>`).join('')}</nav>
      <a class="sidebar-account ${state.view==='account'?'is-active':''}" href="#/account" title="账号信息"><span class="avatar">${e(state.session?.displayName.slice(0,1)||'星')}</span><span class="account-label"><strong>账号信息</strong><small>${e(state.session?.displayName)}</small></span>${icon('right')}</a>
    </aside>
    <main class="workspace ${state.view==='courses'?'workspace--courses':''}" id="workspace" data-workspace-view="${state.view}" tabindex="-1">${content}</main>
  </div>`;
}
