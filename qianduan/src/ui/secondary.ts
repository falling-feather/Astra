import type { AppState, Destination } from '../domain/models';
import { courseArt, escapeHtml as e } from './html';
import { brandMark, icon } from './icons';

export function classes(state:AppState):string {
  return `<div class="secondary-view view-enter"><header class="view-heading"><div><h1>我的班级</h1><p>一起发现，也一起成长。</p></div></header><section class="panel class-panel"><div class="class-emblem">${icon('users')}</div><div><span class="muted">示例班级</span><h2>星序探索一班</h2><p>班主任 陈老师 · ${state.courses.length} 门课程</p></div><button class="quiet-button" data-view="courses">查看班级课程 ${icon('arrow')}</button></section><p class="section-hint">班级成员、加入与管理流程将在后续接入。</p></div>`;
}

export function notes(state:AppState):string {
  const current=state.notes.find(note=>note.id===state.activeNote)||state.notes[0];
  return `<div class="secondary-view notes-view view-enter"><header class="view-heading"><div><h1>我的笔记</h1><p>为一闪而过的灵感，留一个位置。</p></div><button class="quiet-button" data-action="new-note">${icon('plus')}新建笔记</button></header><section class="panel notes-layout"><div class="note-list">${state.notes.map(note=>`<button class="note-preview ${note.id===current.id?'is-active':''}" data-note="${note.id}"><strong>${e(note.title||'未命名笔记')}</strong><span>${e(note.content.slice(0,45)||'等待你的第一个想法。')}</span><small>${e(note.modified)}</small></button>`).join('')}</div><div class="note-editor"><label class="sr-only" for="note-title">笔记标题</label><input id="note-title" value="${e(current.title)}" maxlength="80" placeholder="给这个想法起个名字"/><div class="note-editor-rule"></div><label class="sr-only" for="note-content">笔记内容</label><textarea id="note-content" placeholder="今天，你发现了什么？">${e(current.content)}</textarea><div class="note-editor-footer"><span>仅在本次页面中暂存，刷新前可导出。</span><button class="quiet-button" data-action="export-note">${icon('download')}导出笔记</button></div></div></section></div>`;
}

export function account(state:AppState):string {
  return `<div class="secondary-view account-view view-enter"><header class="view-heading"><div><h1>账号信息</h1><p>这是属于你的探索空间。</p></div></header><section class="panel profile-panel"><div class="profile-identity"><span class="avatar avatar-large">${e(state.session?.displayName.slice(0,1))}</span><div><h2>${e(state.session?.displayName)}</h2><p>${state.session?.kind==='guest'?'访客体验':'演示账号'} · 星序探索者</p></div></div><form id="profile-form"><label class="field-label" for="display-name">显示名称</label><div class="profile-name-row"><input class="plain-input" id="display-name" value="${e(state.session?.displayName)}" maxlength="24" required/><button class="quiet-button" type="submit">保存</button></div></form><div class="settings-row"><div><strong>减少动态效果</strong><p>保留星盘选择，减弱持续动画。</p></div><button class="switch ${state.reducedMotion?'is-on':''}" role="switch" aria-checked="${state.reducedMotion}" aria-label="减少动态效果" data-action="motion"><span></span></button></div><div class="settings-row"><div><strong>众星归位</strong><p>重新观看星序开屏。</p></div><button class="quiet-button" data-action="replay">${icon('refresh')}重播</button></div><div class="profile-footer"><span>当前为独立前端演示，未连接正式账号。</span><button class="text-button" data-action="logout">${icon('logout')}退出登录</button></div></section></div>`;
}

const destinationInfo:Record<Destination,{title:string;description:string;icon:string;color:string}>={
  manage:{title:'管理页面',description:'为课程、教师与学生，建立有序的连接。',icon:'shield',color:'#d7bd88'},
  lab:{title:'工科实验室',description:'让每一个抽象概念，都有亲手探索的可能。',icon:'flask',color:'#75bbed'},
  code:{title:'代码空间',description:'从一次运行，看懂思考的过程。',icon:'code',color:'#83ceb7'},
  future:{title:'未来星系',description:'沿着好奇心，走向学科的交汇处。',icon:'orbit',color:'#c5afe8'},
};

export function destination(view:Destination):string {
  const entry=destinationInfo[view];
  return `<div class="destination-view view-enter" style="--destination-color:${entry.color}"><div class="destination-orbit" aria-hidden="true">${icon(entry.icon)}<i></i><i></i>${brandMark()}</div><h1>${entry.title}</h1><p>${entry.description}</p><div class="destination-status">这个页面的位置已经留好，具体布局将在下一步展开。</div><button class="quiet-button" data-view="overview">返回星序总览 ${icon('arrow')}</button></div>`;
}
