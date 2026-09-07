import { serverTime } from '../domain/time';
import type { AppState, Course } from '../domain/models';
import { addDays, dateKey, dayLabel, monthCells, startOfWeek, weekdays } from '../domain/calendar';
import { escapeHtml as e } from './html';
import { icon } from './icons';

function courseFor(state: AppState, id: string): Course | undefined {
  return state.courses.find((course) => course.id === id);
}
const subjectIcon = (subject: string) =>
  subject === '代码' ? 'code' : subject === '物理' ? 'orbit' : 'flask';

function tasks(state: AppState): string {
  const pending = state.tasks.filter((task) => !task.completed).length;
  return `<section class="panel tasks-panel" aria-labelledby="tasks-title"><div class="panel-header"><h2 id="tasks-title">${icon('list')}待办与学习任务</h2><span class="panel-meta">${pending ? `${pending} 项待完成` : '暂无待提交任务'}</span></div>
    <div class="task-list">${[...state.tasks]
      .sort((a, b) => Number(a.completed) - Number(b.completed))
      .slice(0, 3)
      .map((task) => {
        const course = courseFor(state, task.courseId),
          due = serverTime(task.due);
        return `<article class="task-row ${task.completed ? 'is-completed' : ''}" style="--course-color:${course?.color || '#8ecbdc'}"><div class="task-subject"><span class="subject-symbol">${icon(subjectIcon(course?.subject || ''))}</span><span>${e(course?.title || '课程作业')}</span></div><h3>${e(task.title)}</h3><span class="task-deadline">${icon('clock')}${task.due ? `${due.getMonth() + 1}月${due.getDate()}日 ${String(due.getHours()).padStart(2, '0')}:${String(due.getMinutes()).padStart(2, '0')}` : '未设截止'}</span><button class="quiet-button task-button" data-task="${task.id}">${task.completed ? `${icon('check')}已提交` : `去完成 ${icon('right')}`}</button></article>`;
      })
      .join('')}</div></section>`;
}

function timetable(state: AppState): string {
  const monday = startOfWeek(new Date(), state.weekOffset),
    friday = addDays(monday, 4);
  const configured = state.courses.filter((course) => course.schedule.weekday >= 0);
  const slots = configured.length
    ? [
        ...new Map(
          configured.map((course) => [
            `${course.schedule.start}-${course.schedule.end}`,
            { start: course.schedule.start, end: course.schedule.end },
          ]),
        ).values(),
      ].sort((a, b) => a.start.localeCompare(b.start))
    : [
        { start: '09:00', end: '10:30' },
        { start: '14:00', end: '15:30' },
      ];
  return `<section class="panel timetable-panel" aria-labelledby="timetable-title"><div class="panel-header"><h2 id="timetable-title">${icon('book')}课程表</h2><div class="panel-actions"><button class="icon-button" data-week="-1" aria-label="上一周">${icon('left')}</button><button class="icon-button" data-week="1" aria-label="下一周">${icon('right')}</button></div></div><p class="week-range">${monday.getMonth() + 1}月${monday.getDate()}日 — ${friday.getMonth() + 1}月${friday.getDate()}日 <span>${state.weekOffset === 0 ? '本周' : state.weekOffset > 0 ? `${state.weekOffset} 周后` : `${-state.weekOffset} 周前`}</span></p>
    <div class="timetable-scroll"><table class="timetable"><thead><tr><th scope="col">时间</th>${Array.from({ length: 5 }, (_, i) => `<th scope="col">${weekdays[i]}<small>${addDays(monday, i).getDate()}</small></th>`).join('')}</tr></thead><tbody>${slots
      .map(
        (slot) =>
          `<tr><th scope="row">${slot.start}<small>${slot.end}</small></th>${Array.from(
            { length: 5 },
            (_, day) => {
              const scheduled = state.courses.filter(
                (c) =>
                  c.schedule.weekday === day &&
                  c.schedule.start === slot.start &&
                  c.schedule.end === slot.end,
              );
              return `<td>${scheduled.length ? scheduled.map((course) => `<button class="schedule-course" style="--course-color:${course?.color || '#8ecbdc'}" data-course-detail="${course.id}"><strong>${e(course?.title || '课程作业')}</strong><span>${e(course.schedule.room.split(' ').pop())}</span></button>`).join('') : '<span class="empty-slot" aria-label="暂无课程"></span>'}</td>`;
            },
          ).join('')}</tr>`,
      )
      .join('')}</tbody></table></div>
    <p class="panel-footnote">${icon('clock')}给每一次探索，留一点从容。</p></section>`;
}

function calendar(state: AppState): string {
  const today = new Date(),
    month = state.calendarMonth,
    selected = dateKey(state.selectedDate),
    cells = monthCells(month);
  const selectedCourses = state.courses.filter(
    (course) => course.schedule.weekday === (state.selectedDate.getDay() + 6) % 7,
  );
  return `<section class="panel calendar-panel" aria-labelledby="calendar-title"><div class="panel-header"><h2 id="calendar-title">${icon('calendar')}学习日历</h2><button class="text-button" data-action="today">今天</button></div><div class="month-navigation"><button class="icon-button" data-month="-1" aria-label="上个月">${icon('left')}</button><strong>${month.getFullYear()}年 ${month.getMonth() + 1}月</strong><button class="icon-button" data-month="1" aria-label="下个月">${icon('right')}</button></div>
    <div class="calendar-weekdays" aria-hidden="true">${['一', '二', '三', '四', '五', '六', '日'].map((day) => `<span>${day}</span>`).join('')}</div>
    <div class="calendar-grid" role="group" aria-label="选择日期">${cells
      .map((date) => {
        const key = dateKey(date),
          course = state.courses.find((c) => c.schedule.weekday === (date.getDay() + 6) % 7);
        return `<button class="calendar-day ${date.getMonth() !== month.getMonth() ? 'is-outside' : ''} ${key === dateKey(today) ? 'is-today' : ''} ${key === selected ? 'is-selected' : ''}" data-date="${key}" aria-label="${date.getFullYear()}年${dayLabel(date)}" aria-pressed="${key === selected}" ${key === dateKey(today) ? 'aria-current="date"' : ''}><span>${date.getDate()}</span>${course && date.getMonth() === month.getMonth() ? `<i style="background:${course?.color || '#8ecbdc'}" aria-hidden="true"></i>` : ''}</button>`;
      })
      .join('')}</div>
    <div class="calendar-agenda"><span>${dayLabel(state.selectedDate)}</span>${
      selectedCourses.length
        ? selectedCourses
            .slice(0, 2)
            .map(
              (course) =>
                `<button data-course-detail="${course.id}"><i style="background:${course?.color || '#8ecbdc'}"></i><strong>${e(course?.title || '课程作业')}</strong><small>${course.schedule.start}</small>${icon('right')}</button>`,
            )
            .join('')
        : '<p>今天没有课程，自由探索一下吧。</p>'
    }</div></section>`;
}

export function overview(state: AppState): string {
  const now = new Date(),
    hour = now.getHours(),
    greeting =
      hour < 5 ? '夜深了' : hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好';
  return `<div class="overview-view view-enter"><header class="view-heading"><div><h1>星序总览</h1><p>${greeting}，${e(state.session?.displayName)}<span class="heading-separator"></span><time datetime="${dateKey(now)}">${now.getFullYear()}年${dayLabel(now)}</time></p></div><span class="heading-ornament" aria-hidden="true">${icon('star')}</span></header>${tasks(state)}<div class="overview-bottom">${timetable(state)}${calendar(state)}</div></div>`;
}
