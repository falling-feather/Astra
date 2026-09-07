import type { AppState } from '../domain/models';
import { escapeHtml as e } from './html';
import { icon } from './icons';
import { human } from '../portal/presentation';

export function notes(state: AppState): string {
  const current = state.notes.find((note) => note.id === state.activeNote) || state.notes[0];
  return `<div class="secondary-view notes-view view-enter"><header class="view-heading"><div><h1>我的笔记</h1><p>为一闪而过的灵感，留一个位置。</p></div><button class="quiet-button" data-action="new-note">${icon('plus')}新建笔记</button></header><section class="notes-layout"><div class="note-list">${state.notes.map((note) => `<button class="note-preview ${note.id === current?.id ? 'is-active' : ''}" data-note="${e(note.id)}"><strong>${e(note.title || '未命名笔记')}</strong><span>${e(note.content.slice(0, 45) || '等待你的第一个想法。')}</span><small>${e(note.modified)}</small></button>`).join('')}${state.moreNotes ? '<button class="quiet-button" data-action="more-notes">加载更多</button>' : ''}</div><div class="note-editor">${current ? `<label class="sr-only" for="note-title">笔记标题</label><input id="note-title" value="${e(current.title)}" maxlength="180" placeholder="给这个想法起个名字"/><div class="note-editor-rule"></div><label class="sr-only" for="note-content">笔记内容</label><textarea id="note-content" maxlength="16000" placeholder="今天，你发现了什么？">${e(current.content)}</textarea><div class="note-editor-footer"><span id="note-state">${state.noteDirty ? '有未保存的修改' : '已保存'}${state.session?.source === 'demo' ? ' · 演示笔记刷新后重置' : ''}</span><div class="portal-actions"><button class="quiet-button" data-action="delete-note">删除</button><button class="quiet-button" data-action="export-note">${icon('download')}导出</button><button class="primary-button" data-action="save-note">保存笔记</button></div></div>` : '<p class="portal-empty">从一条新笔记，开始记录你的发现。</p>'}</div></section></div>`;
}

export function demoRoles(): string {
  return `<div class="demo-role-options">${[
    ['student', '学生'],
    ['teacher', '教师'],
    ['admin', '管理员'],
  ]
    .map(
      ([role, label]) =>
        `<button class="quiet-button" data-demo-role="${role}">${label}视角 ${icon('arrow')}</button>`,
    )
    .join('')}</div>`;
}

export function account(state: AppState): string {
  const demo = state.session?.source === 'demo';
  return `<div class="secondary-view account-view view-enter"><header class="view-heading"><div><h1>账号信息</h1><p>这是属于你的探索空间。</p></div></header><section class="portal-surface profile-panel"><div class="profile-identity"><span class="avatar avatar-large">${e(state.session?.displayName.slice(0, 1))}</span><div><h2>${e(state.session?.displayName)}</h2><p>${human(state.session?.role)} · ${demo ? '静态演示' : '学校账号'}</p></div></div><form id="profile-form"><label class="field-label" for="display-name">显示名称</label><div class="profile-name-row"><input class="plain-input" id="display-name" value="${e(state.session?.displayName)}" maxlength="120" required/><button class="quiet-button" type="submit">保存</button></div></form>${demo ? `<div class="settings-row"><div><strong>切换演示身份</strong><p>同一页面内可体验提交、审核和批改。</p>${demoRoles()}</div></div>` : state.session?.role === 'student' ? (state.teacherApplication?.status === 'pending' ? '<section class="teacher-application"><h3>教师身份核验中</h3><p class="portal-note">学校正在核验你的申请，审核通过后重新登录即可使用教师工作台。</p></section>' : `<form id="teacher-application-form" class="teacher-application"><h3>申请成为教师</h3><label class="portal-field"><span>任教说明</span><textarea name="message" maxlength="500" required placeholder="说明你的任教学科与班级"></textarea></label><p class="portal-note">申请期间账号将等待学校核验，部分操作会暂时受限。</p><button class="quiet-button" type="submit">提交教师申请</button></form>`) : ''}<div class="settings-row"><div><strong>减少动态效果</strong><p>保留星盘选择，减弱持续动画。</p></div><button class="switch ${state.reducedMotion ? 'is-on' : ''}" role="switch" aria-checked="${state.reducedMotion}" aria-label="减少动态效果" data-action="motion"><span></span></button></div><div class="settings-row"><div><strong>众星归位</strong><p>重新观看星序开屏。</p></div><button class="quiet-button" data-action="replay">${icon('refresh')}重播</button></div><div class="profile-footer"><span>${demo ? '仅供体验，不创建真实账号或成绩。' : '学习记录由学校服务保存。'}</span><button class="text-button" data-action="logout">${icon('logout')}退出登录</button></div></section></div>`;
}
