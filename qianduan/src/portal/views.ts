import type * as T from './contracts';
import {
  area,
  badge,
  button,
  e,
  empty,
  field,
  human,
  selectField,
  when,
  submissionText,
} from './presentation';
import { icon } from '../ui/icons';
import { frontendAsset } from '../services/environment';

export function heading(title: string, description = '', actions = ''): string {
  return `<header class="portal-heading"><div><h1>${e(title)}</h1>${description ? `<p>${e(description)}</p>` : ''}</div><div class="portal-actions">${actions}</div></header>`;
}

export function teacherDashboard(data: T.Workbench): string {
  const courses = data.courses?.items || [],
    pending = data.pending_grading?.items || [],
    joins = data.pending_students?.items || [];
  return (
    heading('教学工作台', '把课程、任务与反馈连接起来。', button('新建课程', 'new-course', '', true)) +
    `<div class="portal-metrics"><div><strong>${data.courses?.total || 0}</strong><span>门课程</span></div><div><strong>${data.pending_grading?.total || 0}</strong><span>份待批改</span></div><div><strong>${data.pending_students?.total || 0}</strong><span>项入课申请</span></div></div><section class="portal-surface">${courseRows(courses.map((course) => ({ id: course.course_id, title: course.title, subject: human(course.subject_key), code: course.course_code || '待生成', status: course.status === 'published' && !course.current_release_number ? 'awaiting_release' : course.has_unpublished_changes ? 'draft' : course.status || 'draft', release: course.current_release_number || 0 })))}</section><div class="portal-columns"><section class="portal-surface"><h2>待批改作业</h2>${pending.length ? pending.map((item) => `<button class="portal-list-row" data-portal="grade-assignment" data-course="${item.course_id}" data-id="${item.assignment_id}"><span><strong>${e(item.assignment_title)}</strong><small>${e(item.course_title)} · ${e(item.student_display_name)}</small></span>${icon('arrow')}</button>`).join('') : empty('当前没有待批改作业。')}</section><section class="portal-surface"><h2>入课申请</h2>${joins.length ? joins.map((item) => `<div class="portal-list-row"><span><strong>${e(item.student_display_name)}</strong><small>${e(item.course_title)} · ${e(item.source_class_name)}</small></span>${button('查看', 'open-course', `data-id="${item.course_id}" data-tab="students"`)}</div>`).join('') : empty('暂时没有新的入课申请。')}</section></div>`
  );
}

function courseRows(
  courses: {
    id: number;
    title: string;
    subject: string;
    code: string;
    status: string;
    release: number | null;
  }[],
): string {
  if (!courses.length) return empty('还没有课程，可以从新建课程开始。');
  return `<div class="portal-table-wrap"><table class="portal-table"><thead><tr><th>课程名称</th><th>学科</th><th>邀请码</th><th>发布</th><th>状态</th><th></th></tr></thead><tbody>${courses.map((course) => `<tr><td><strong>${e(course.title)}</strong></td><td>${e(course.subject)}</td><td>${e(course.code)}</td><td>${course.release === null ? '已有发布' : course.release ? `第 ${course.release} 版` : '未发布'}</td><td>${badge(course.status)}</td><td>${button('编辑课程', 'open-course', `data-id="${course.id}"`)}</td></tr>`).join('')}</tbody></table></div>`;
}

export function teacherCourses(courses: T.CourseInfo[]): string {
  return (
    heading('我的课程', '保留每次发布，继续完善下一次教学。', button('新建课程', 'new-course', '', true)) +
    `<section class="portal-surface">${courseRows(courses.map((course) => ({ id: course.id, title: course.title, subject: human(course.subject_key), code: course.course_code || '首次发布后生成', status: course.information_revision.status === 'submitted' ? 'pending' : course.has_published_content ? 'published' : 'draft', release: course.has_published_content ? null : 0 })))}</section>`
  );
}

export function courseStudents(enrollments: T.Page<T.Enrollment>, requests: T.Page<T.JoinRequest>): string {
  return `<div class="portal-columns"><section class="portal-surface"><h2>课程学生 · ${enrollments.total}</h2>${enrollments.items.length ? enrollments.items.map((item) => `<div class="portal-list-row"><span><strong>${e(item.display_name)}</strong><small>${e(item.source_class_name)} · ${human(item.status)}</small></span>${item.status === 'active' ? button('移出课程', 'remove-enrollment', `data-id="${item.id}"`) : ''}</div>`).join('') : empty('还没有学生加入。')}</section><section class="portal-surface"><h2>入课申请 · ${requests.total}</h2>${requests.items.length ? requests.items.map((item) => `<div class="portal-request"><strong>${e(item.display_name)}</strong><p>${e(item.source_class_name)} · ${e(item.message || '申请加入课程')}</p><div>${button('通过', 'review-join', `data-id="${item.id}" data-status="approved"`)} ${button('拒绝', 'review-join', `data-id="${item.id}" data-status="rejected"`)}</div></div>`).join('') : empty('没有待处理申请。')}</section></div>`;
}

export function teacherAssignments(assignments: T.Assignment[], units: T.DraftUnit[]): string {
  return `<div class="portal-columns"><section class="portal-surface"><h2>课程作业</h2>${assignments.length ? assignments.map((item) => `<button class="portal-list-row" data-portal="grade-assignment" data-id="${item.id}"><span><strong>${e(item.title)}</strong><small>${when(item.due_at)} · 满分 ${item.max_score}</small></span>${icon('arrow')}</button>`).join('') : empty('还没有布置作业。')}</section><section class="portal-surface"><h2>布置新作业</h2><form id="portal-assignment-form">${selectField(
    '所属单元',
    'unit_id',
    units.filter((unit) => unit.id).map((unit) => ({ value: unit.id!, label: unit.title })),
    '',
    true,
  )}${field('作业名称', 'title', '', { required: true, max: 180 })}${area('作业要求', 'description', '', true)}<div class="portal-form-grid">${field('截止时间', 'due_at', '', { type: 'datetime-local' })}${field('满分', 'max_score', 100, { type: 'number', min: 0, required: true })}</div><button class="primary-button" type="submit" ${units.some((unit) => unit.id) ? '' : 'disabled'}>布置作业</button></form><p class="portal-note">作业面向本课程已关联的教学范围；请先保存所属单元。</p></section></div>`;
}

export function grading(assignment: T.Assignment, submissions: T.Page<T.Submission>, names: Map<number, string>): string {
  return heading(assignment.title, '选择一次提交，查看原作业要求、回答与评阅历史。', button('返回作业', 'course-tab', 'data-tab="assignments"')) + `<div class="portal-grading">${submissions.items.map((item) => `<section class="portal-surface"><div class="portal-section-heading"><h2>${e(names.get(item.student_id) || `学生 ${item.student_id}`)}</h2>${badge(item.status)}</div><p class="portal-note">提交于 ${when(item.submitted_at)}</p><div class="submission-answer">${e(submissionText(item.content))}</div>${button('查看与批改', 'grade-submission', `data-id="${item.id}"`)}</section>`).join('') || empty('还没有学生提交。')}</div>`;
}

export function studentAssignmentList(page: T.Page<T.StudentAssignment>, selectedKey: string): string {
  return `${page.items.map((row) => `<button data-portal="select-assignment" data-key="${row.assignment.id}:${row.class.id}" class="${`${row.assignment.id}:${row.class.id}` === selectedKey ? 'active' : ''}"><strong>${e(row.assignment.title)}</strong><small>${e(row.course.title)}</small><span>${when(row.assignment.due_at)} ${badge(row.submission?.status || 'pending', row.submission ? human(row.submission.status) : '待提交')}</span></button>`).join('') || empty('这里暂时没有作业。')}<div class="portal-pagination">${page.offset > 0 ? button('上一页', 'assignment-page', `data-offset="${Math.max(0, page.offset - page.limit)}"`) : ''}${page.next_offset !== null ? button('下一页', 'assignment-page', `data-offset="${page.next_offset}"`) : ''}</div>`;
}

export function studentAssignments(page: T.Page<T.StudentAssignment>, filter: string, selectedKey: string): string {
  return heading('我的作业', '查看任务、历次回答和教师反馈。') + `<nav class="portal-tabs">${[['active', '当前作业'], ['feedback', '批改反馈'], ['history', '历史作业']].map(([key, title]) => `<button data-portal="assignment-filter" data-filter="${key}" class="${filter === key ? 'active' : ''}">${title}</button>`).join('')}</nav><div class="portal-assignment-layout"><aside class="portal-assignment-list">${studentAssignmentList(page, selectedKey)}</aside><section class="portal-assignment-detail" data-assignment-detail>${empty(page.items.length ? '正在读取作业要求…' : '选择一项作业查看要求。')}</section></div>`;
}

export function classroomList(
  classes: T.Classroom[],
  schools: T.School[],
  role: T.Role,
  selected: T.Classroom | undefined,
  members: T.Member[],
  requests: T.ClassRequest[],
): string {
  return (
    heading(role === 'student' ? '我的班级' : '班级与学生') +
    `<div class="portal-columns"><section class="portal-surface"><h2>班级</h2>${classes.map((item) => `<button class="portal-list-row" data-portal="select-class" data-id="${item.id}"><span><strong>${e(item.name)}</strong><small>${e(item.grade || '')} ${e(item.term || '')} · 班级编号 ${item.id}</small></span>${icon('arrow')}</button>`).join('') || empty('暂无已加入的班级。')}<form id="portal-class-join-form"><h3>申请加入班级</h3>${field('班级编号', 'class_id', '', { type: 'number', required: true, min: 1 })}${field('申请说明', 'message', '', { max: 500 })}<button type="submit" class="quiet-button">提交申请</button></form></section><section class="portal-surface"><h2>${selected ? e(selected.name) : '班级成员'}</h2>${selected ? members.map((item) => `<div class="portal-list-row"><span>${e(item.display_name)} <small>${e(item.username)}</small></span>${badge(item.status, human(item.role))}</div>`).join('') || empty('暂无成员。') : empty('选择班级查看成员。')}${requests.length ? `<h3>加入申请</h3>${requests.map((item) => `<div class="portal-list-row"><span>账号 ${item.user_id}<small>${e(item.message || '申请加入班级')} · ${human(item.role)}</small></span>${button('通过', 'review-class', `data-id="${item.id}" data-status="approved"`)}${button('拒绝', 'review-class', `data-id="${item.id}" data-status="rejected"`)}</div>`).join('')}` : ''}</section></div>${
      role !== 'student'
        ? `<section class="portal-surface"><h2>创建班级</h2><form id="portal-class-form"><div class="portal-form-grid">${selectField(
            '学校',
            'school_id',
            schools.map((item) => ({ value: item.id, label: item.name })),
            '',
            true,
          )}${field('班级名称', 'name', '', { required: true, max: 160 })}${field('年级', 'grade', '', { max: 64 })}${field('学期', 'term', '2026—2027', { max: 64 })}</div><button type="submit" class="primary-button" ${schools.length ? '' : 'disabled'}>创建班级</button></form>${schools.length ? '' : '<p class="portal-note">尚未获得学校权限。可使用管理员提供的班级编号申请任课，审核后再创建课程。</p>'}</section>`
        : ''
    }`
  );
}

export function administration(
  data: T.Workbench,
  teachers: T.TeacherApplication[],
  reviews: T.CourseReview[],
  users: T.AdminUser[],
  schools: T.School[],
): string {
  return (
    heading('学校管理', '审核教学资料，维护账号和组织。') +
    `<div class="portal-metrics"><div><strong>${data.catalog_totals?.users || 0}</strong><span>个账号</span></div><div><strong>${data.catalog_totals?.courses || 0}</strong><span>门课程</span></div><div><strong>${(data.pending_teacher_applications?.total || 0) + (data.pending_course_revisions?.total || 0)}</strong><span>项待审核</span></div></div><div class="portal-columns"><section class="portal-surface"><h2>教师申请</h2>${teachers.map((item) => `<div class="portal-request"><h3>${e(item.applicant_display_name)} <small>${e(item.applicant_username)}</small></h3><p>${e(item.message || '申请成为教师')}</p>${button('通过', 'review-teacher', `data-id="${item.id}" data-status="approved"`)} ${button('退回', 'review-teacher', `data-id="${item.id}" data-status="rejected"`)}</div>`).join('') || empty('没有待处理的教师申请。')}</section><section class="portal-surface"><h2>课程资料审核</h2>${reviews.map((item) => `<div class="portal-request"><h3>${e(item.proposed_information.title)}</h3><p>${e(item.proposed_information.summary || '')}</p><p>${e(item.proposed_information.academic_year)} · ${e(item.proposed_information.schedule_text)}</p><small>修改项目：${e(item.changed_fields.map((key) => (({ title: '标题', summary: '介绍', schedule_text: '授课安排', academic_year: '学年', admission_mode: '加入范围', total_hours: '课时' }) as Record<string, string>)[key] || key).join('、'))}</small><div>${button('通过', 'review-course', `data-id="${item.revision.id}" data-status="approved"`)} ${button('退回', 'review-course', `data-id="${item.revision.id}" data-status="rejected"`)}</div></div>`).join('') || empty('没有待审核的课程资料。')}</section></div><section class="portal-surface"><h2>账号</h2><div class="portal-table-wrap"><table class="portal-table"><thead><tr><th>姓名</th><th>账号</th><th>身份</th><th>状态</th><th>操作</th></tr></thead><tbody>${users.map((user) => `<tr><td>${e(user.display_name)}</td><td>${e(user.username)}</td><td>${human(user.role)}</td><td>${badge(user.status)}</td><td>${user.role === 'admin' ? '—' : button(user.status === 'active' ? '停用' : '恢复', 'user-status', `data-id="${user.id}" data-status="${user.status === 'active' ? 'disabled' : 'active'}"`)}</td></tr>`).join('')}</tbody></table></div></section><section class="portal-surface"><h2>学校</h2>${schools.map((item) => `<p>${e(item.name)} · ${badge(item.status)}</p>`).join('')}<form id="portal-school-form" class="portal-inline-form">${field('学校名称', 'name', '', { required: true, max: 160 })}<button class="quiet-button" type="submit">创建学校</button></form></section>`
  );
}

export function experimentFrame(title: string, href: string): string {
  return (
    heading(
      title,
      '探索实验模型；作业和检查点请在对应课程中提交。',
      button('返回学习页面', 'back-from-experiment'),
    ) +
    `<iframe class="portal-experiment-frame" title="${e(title)}" src="${e(frontendAsset(href))}" allow="fullscreen" referrerpolicy="same-origin"></iframe>`
  );
}
