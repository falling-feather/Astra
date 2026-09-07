import type { Course } from '../domain/models';
import { escapeHtml as e } from './html';
import { icon } from './icons';

export function searchResults(query:string,courses:Course[]):string {
  const term=query.trim().toLocaleLowerCase();
  const matches=courses.filter(course=>`${course.title} ${course.subject} ${course.teacher}`.toLocaleLowerCase().includes(term));
  return `<h2 id="dialog-title">${term?'搜索结果':'全部课程'}</h2><p class="dialog-note">${term?`“${e(query)}” · `:''}${matches.length} 门课程</p><div class="search-results">${matches.map(course=>`<button data-search-course="${course.id}"><span><strong>${e(course.title)}</strong><small>${e(course.subject)} · ${e(course.teacher)}</small></span>${icon('arrow')}</button>`).join('')||'<p class="dialog-description">暂未找到课程，可以试试课程名、学科或教师姓名。</p>'}</div>`;
}

export function inviteDialog():string {
  return `<h2 id="dialog-title">输入邀请码</h2><p class="dialog-description">通过老师分享的邀请码，找到你的班级。</p><form id="invite-form"><label class="field-label" for="invite-code">邀请码</label><input class="plain-input invite-input" id="invite-code" name="code" maxlength="24" autocomplete="off" placeholder="例如 ASTRA26" required/><p class="dialog-note">当前可使用 ASTRA26 预览演示班级。</p><p id="invite-feedback" class="form-error" role="status"></p><button class="primary-button" type="submit">查看邀请 ${icon('arrow')}</button></form>`;
}

export function invitePreview(code:string):string {
  if(code.trim().toUpperCase()!=='ASTRA26')return '未找到该演示邀请码，请使用 ASTRA26。';
  return '';
}
