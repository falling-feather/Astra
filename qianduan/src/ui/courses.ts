import type { AppState, Course } from '../domain/models';
import { weekdays } from '../domain/calendar';
import { courseArt, escapeHtml as e } from './html';
import { icon } from './icons';

export function courseInspector(course: Course): string {
  return `<div class="course-inspector-inner" style="--course-color:${course.color}"><div class="course-cover">${courseArt(course.color, course.secondary)}</div><span class="course-subject">${e(course.subject)}</span><div class="course-inspector-heading"><h2>${e(course.title)}</h2></div><p class="course-description">${e(course.description)}</p><dl class="course-facts"><div><dt>${icon('user')}<span class="sr-only">授课教师</span></dt><dd>${e(course.teacher)}</dd></div><div><dt>${icon('clock')}<span class="sr-only">上课时间</span></dt><dd>${e(course.scheduleText || `${weekdays[course.schedule.weekday]} ${course.schedule.start}—${course.schedule.end}`)}</dd></div><div><dt>${icon('location')}<span class="sr-only">上课地点</span></dt><dd>${e(course.schedule.room)}</dd></div></dl><div class="course-progress-label"><span>课程进度</span><strong>${course.completed}<small> / ${course.lessons}</small></strong></div><div class="progress-track" role="progressbar" aria-label="课程进度" aria-valuemin="0" aria-valuemax="${course.lessons}" aria-valuenow="${course.completed}"><span style="width:${course.lessons ? (course.completed / course.lessons) * 100 : 0}%"></span></div><button class="course-enter" data-course-detail="${course.id}">进入课程 ${icon('arrow')}</button></div>`;
}

export function courses(state: AppState): string {
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
