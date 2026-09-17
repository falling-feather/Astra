import type { AppState, Course } from '../domain/models';
import { weekdays } from '../domain/calendar';
import { courseArt, escapeHtml as e } from './html';
import { icon } from './icons';
import { frontendAsset } from '../services/environment';

export function courseInspector(course: Course): string {
  const enter = course.backendId
    ? `<button class="course-enter" data-course-detail="${course.id}">进入课程 ${icon('arrow')}</button>`
    : course.resourceEntry && course.resourceEntry.startsWith('labs/')
      ? `<a class="course-enter" href="${e(frontendAsset(course.resourceEntry))}" target="_blank" rel="noopener">进入实验 ${icon('arrow')}</a>`
      : '<p class="course-preview-note">管理员预览 · 系统资源</p>';
  return `<div class="course-inspector-inner" style="--course-color:${course.color}"><div class="course-cover">${courseArt(course.color, course.secondary)}</div><span class="course-subject">${e(course.subject)}</span><div class="course-inspector-heading"><h2>${e(course.title)}</h2></div><p class="course-description">${e(course.description)}</p><dl class="course-facts"><div><dt>${icon('user')}<span class="sr-only">授课教师</span></dt><dd>${e(course.teacher)}</dd></div><div><dt>${icon('clock')}<span class="sr-only">上课时间</span></dt><dd>${e(course.scheduleText || `${weekdays[course.schedule.weekday]} ${course.schedule.start}—${course.schedule.end}`)}</dd></div><div><dt>${icon('location')}<span class="sr-only">上课地点</span></dt><dd>${e(course.schedule.room)}</dd></div></dl><div class="course-progress-label"><span>课程进度</span><strong>${course.completed}<small> / ${course.lessons}</small></strong></div><div class="progress-track" role="progressbar" aria-label="课程进度" aria-valuemin="0" aria-valuemax="${course.lessons}" aria-valuenow="${course.completed}"><span style="width:${course.lessons ? (course.completed / course.lessons) * 100 : 0}%"></span></div>${enter}</div>`;
}

export function courses(state: AppState): string {
  if (state.session?.role === 'admin') return adminCourses(state);
  const selected = state.courses.find((course) => course.id === state.selectedCourse) || state.courses[0];
  if (!selected)
    return '<div class="courses-view"><header class="view-heading"><h1>我的课程</h1></header><p class="empty-course-message">暂时还没有课程。</p></div>';
  const disabled = state.courses.length < 2 ? 'disabled' : '';
  return `<div class="courses-view view-enter"><header class="view-heading"><h1>我的课程</h1></header>
    <div class="course-universe"><div class="orbit-stage" id="orbit-stage" tabindex="0" role="group" aria-label="课程星系，向内或向外拨动浏览课程"><div class="galaxy-labels"></div></div>
    <aside class="course-inspector" id="course-inspector" aria-label="课程信息">${courseInspector(selected)}</aside>
    <div class="orbit-controls"><button class="orbit-arrow" data-orbit-step="-1" aria-label="向外浏览，上一门课程" ${disabled}>${icon('arrow')}<span>向外浏览</span></button><button class="orbit-arrow" data-orbit-step="1" aria-label="向内浏览，下一门课程" ${disabled}><span>向内浏览</span>${icon('arrow')}</button></div></div>
    <p class="sr-only" id="course-announcement" role="status" aria-live="polite">当前课程：${e(selected.title)}</p></div>`;
}

const adminGalaxyNames: Record<string, string> = {
  englab: '工科实验室',
  'code-space': '代码空间',
  'future-galaxy': '未来星系',
};

function adminCourses(state: AppState): string {
  const system = state.courses.filter((course) => !course.backendId);
  const teacher = state.courses.filter((course) => Boolean(course.backendId));
  const selected = state.courses.find((course) => course.id === state.selectedCourse) || state.courses[0];
  const selectedGroup = selected?.backendId ? 'teacher' : `space:${selected?.galaxyKey || 'englab'}`;
  const branch = (key: string, title: string, items: Course[]) =>
    `<details class="admin-course-tree__branch" ${selectedGroup === key ? 'open' : ''}><summary>${e(title)}<small>${items.length}</small></summary><div class="admin-course-tree__children">${items.map((course) => `<button type="button" class="admin-course-tree__course ${course.id === selected?.id ? 'is-selected' : ''}" data-admin-course="${e(course.id)}"><span>${e(course.title)}</span><small>${e(course.subject)}</small></button>`).join('')}</div></details>`;
  const currentItems = selectedGroup === 'teacher' ? teacher : system.filter((course) => `space:${course.galaxyKey}` === selectedGroup);
  const currentTitle = selectedGroup === 'teacher' ? '教师课程' : adminGalaxyNames[selected?.galaxyKey || ''] || '星序合集';
  return `<div class="admin-course-browser view-enter"><header class="view-heading"><div><h1>课程预览</h1><p class="course-preview-summary">后端目录 · ${state.courses.length} 门课程 · 选择分支查看课程清单</p></div></header><div class="admin-course-browser__layout"><aside class="admin-course-tree" aria-label="课程树"><div class="admin-course-tree__root"><span>星序合集</span><small>${system.length}</small></div>${(['englab', 'code-space', 'future-galaxy'] as const).map((key) => branch(`space:${key}`, adminGalaxyNames[key], system.filter((course) => course.galaxyKey === key))).join('')}<div class="admin-course-tree__root admin-course-tree__root--teacher"><span>教师课程</span><small>${teacher.length}</small></div>${branch('teacher', '教师课程分支', teacher)}</aside><section class="admin-course-browser__main"><header class="admin-course-list__heading"><div><span>当前分支</span><h2>${e(currentTitle)}</h2></div><small>${currentItems.length} 门课程</small></header><div class="admin-course-list" role="list">${currentItems.map((course) => `<button type="button" class="admin-course-list__row ${course.id === selected?.id ? 'is-selected' : ''}" data-admin-course="${e(course.id)}"><span class="admin-course-list__index">${String(currentItems.indexOf(course) + 1).padStart(2, '0')}</span><span class="admin-course-list__body"><strong>${e(course.title)}</strong><small>${e(course.subject)} · ${e(course.teacher)}</small></span><span class="admin-course-list__source">${course.backendId ? '教师创建' : '星序合集'}</span></button>`).join('') || '<p class="empty-course-message">当前分支暂无课程。</p>'}</div><aside class="admin-course-browser__preview" id="course-inspector" aria-label="课程预览">${selected ? courseInspector(selected) : '<p class="empty-course-message">请选择一门课程。</p>'}</aside></section></div></div>`;
}
