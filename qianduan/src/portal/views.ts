import type * as T from './contracts';
import {
  area,
  badge,
  button,
  courseInput,
  e,
  empty,
  field,
  human,
  selectField,
  when,
  submissionText,
} from './presentation';
import { icon } from '../ui/icons';
import { simpleCheckpoint } from './unit-editor';
import { frontendAsset } from '../services/environment';
import { markdown } from '../ui/markdown';

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
    `<section class="portal-surface">${courseRows(courses.map((course) => ({ id: course.id, title: course.information_revision.status === 'draft' ? course.information_revision.information_snapshot.title : course.title, subject: human(course.subject_key), code: course.course_code || '审核通过后生成', status: course.information_revision.status === 'submitted' ? 'pending' : course.has_published_content ? 'published' : 'draft', release: course.has_published_content ? null : 0 })))}</section>`
  );
}

export function metadataForm(
  schools: T.School[],
  classes: T.Classroom[],
  activities: T.Activity[],
  course?: T.CourseInfo,
  teachers: { user_id: number; display_name: string }[] = [],
): string {
  const current: T.CourseInput = course
    ? courseInput(course)
    : {
        school_id: schools[0]?.id || 0,
        title: '',
        summary: '',
        academic_year: '2026—2027',
        schedule_text: '',
        total_hours: 16,
        galaxy_key: 'englab',
        subject_key: 'mathematics',
        admission_mode: 'open',
        admission_class_ids: [],
        collaborator_user_ids: [],
      };
  const subjects = [
    ...new Set(activities.filter((item) => item.galaxy === current.galaxy_key).map((item) => item.subject)),
  ];
  if (!subjects.includes(current.subject_key)) subjects.unshift(current.subject_key);
  const locked = course?.information_revision.status === 'submitted';
  return `${course ? '' : heading('新建课程', '先说明课程安排，再编排学习内容。', button('返回课程', 'course-list'))}<form id="portal-course-form" class="portal-form portal-surface"><fieldset ${locked ? 'disabled' : ''}><div class="portal-form-grid">${field('课程名称', 'title', current.title, { required: true, max: 180 })}${selectField(
    '学校',
    'school_id',
    schools.map((item) => ({ value: item.id, label: item.name })),
    current.school_id,
    true,
  )}${selectField(
    '学习空间',
    'galaxy_key',
    [
      { value: 'englab', label: '工科实验室' },
      { value: 'code-space', label: '代码空间' },
      { value: 'future-galaxy', label: '未来星系' },
      ...(['englab', 'code-space', 'future-galaxy'].includes(current.galaxy_key)
        ? []
        : [{ value: current.galaxy_key, label: human(current.galaxy_key) }]),
    ],
    current.galaxy_key,
  )}${selectField(
    '学科 / 方向',
    'subject_key',
    subjects.map((value) => ({ value, label: human(value) })),
    current.subject_key,
  )}${field('学年', 'academic_year', current.academic_year, { required: true, max: 32 })}${field('课时', 'total_hours', current.total_hours, { type: 'number', required: true, min: 1 })}${field('授课安排，例如 周一 09:00—10:30', 'schedule_text', current.schedule_text, { required: true, max: 240 })}${selectField(
    '加入范围',
    'admission_mode',
    [
      { value: 'open', label: '校内学生可申请加入' },
      { value: 'class_restricted', label: '限指定班级申请' },
    ],
    current.admission_mode,
  )}</div>${area('课程介绍', 'summary', current.summary)}<div class="portal-field"><span>允许申请的班级（选择“限指定班级”时生效）</span><div class="portal-checks">${
    classes
      .filter((item) => item.kind === 'homeroom' && item.school_id === Number(current.school_id))
      .map(
        (item) =>
          `<label><input name="admission_class_ids" type="checkbox" value="${item.id}" ${current.admission_class_ids.includes(item.id) ? 'checked' : ''}/>${e(item.name)}</label>`,
      )
      .join('') || '<span class="muted">暂无可选班级</span>'
  }</div></div><div class="portal-field"><span>共同授课教师</span><div id="co-teacher-options">${teachers.map((teacher) => `<label class="portal-checkbox"><input type="checkbox" name="collaborator_user_ids" value="${teacher.user_id}" ${current.collaborator_user_ids.includes(teacher.user_id) ? 'checked' : ''}/>${e(teacher.display_name)}</label>`).join('') || '<span class="muted">暂无其他可选教师</span>'}</div></div><div class="portal-actions"><button class="primary-button" type="submit">${course ? '保存资料草稿' : '创建课程草稿'}</button></div></fieldset></form>${course ? `<p class="portal-note">资料状态：${badge(course.information_revision.status, course.information_revision.status === 'submitted' ? '等待学校审核' : human(course.information_revision.status))}${course.information_revision.review_note ? ` · ${e(course.information_revision.review_note)}` : ''}</p>${course.information_revision.status === 'draft' ? button('提交学校审核', 'submit-information', '', true) : ''}` : ''}`;
}

export const courseTabs = [
  ['editor', '内容编排'],
  ['metadata', '课程资料'],
  ['releases', '发布版本'],
  ['students', '学生名单'],
  ['assignments', '作业'],
  ['plan', '开放计划'],
];
export function courseHeader(course: T.CourseInfo, tab: string, dirty: boolean): string {
  return (
    heading(
      course.title,
      `${course.course_code ? `邀请码 ${course.course_code} · ` : ''}${dirty ? '有未保存修改' : course.has_published_content ? '已有发布版本' : '尚未发布内容'}`,
      `${button('返回课程', 'course-list')}${tab === 'editor' ? button('保存草稿', 'save-draft', course.status !== 'published' ? 'disabled' : '') : ''}${button('发布课程', 'publish', course.information_revision.status !== 'approved' ? 'disabled' : '', true)}`,
    ) +
    `<nav class="portal-tabs" aria-label="课程管理">${courseTabs.map(([key, name]) => `<button data-portal="course-tab" data-tab="${key}" class="${tab === key ? 'active' : ''}" aria-current="${tab === key ? 'page' : 'false'}">${name}</button>`).join('')}</nav>`
  );
}

export function editor(
  course: T.CourseInfo,
  draft: T.SharedDraft,
  selected: number,
  activities: T.Activity[],
  assignments: T.Assignment[] = [],
): string {
  if (course.status !== 'published')
    return `<section class="portal-surface"><h2>等待课程资料通过审核</h2><p class="portal-note">先完善课程资料并提交学校审核，通过后即可编排内容和布置作业。</p>${button('查看课程资料', 'course-tab', 'data-tab="metadata"')}</section>`;
  const unit = draft.units[selected];
  if (!unit)
    return `<section class="portal-surface">${empty('为课程添加第一个学习单元。')}${button('添加单元', 'add-unit', '', true)}</section>`;
  const page = unit.content,
    goal = page?.blocks.find((block) => block.type === 'learning-task'),
    text = page?.blocks.find((block) => block.type === 'rich-text'),
    checkpoint = page?.blocks.find((block) => block.type === 'checkpoint');
  const options = activities
    .filter((item) => item.galaxy === course.galaxy_key && item.subject === course.subject_key)
    .map((item) => ({ value: item.key, label: item.title }));
  if (!options.some((item) => item.value === unit.activity_key))
    options.unshift({
      value: unit.activity_key,
      label: activities.find((item) => item.key === unit.activity_key)?.title || '保留原单元内容',
    });
  return `<div class="portal-editor"><aside class="portal-unit-list">${draft.units.map((item, index) => `<button class="${index === selected ? 'active' : ''}" data-portal="select-unit" data-index="${index}"><small>${String(index + 1).padStart(2, '0')}</small><span>${e(item.title)}</span></button>`).join('')}${button('+ 添加单元', 'add-unit')}</aside><section class="portal-surface"><form id="portal-unit-form">${field('单元名称', 'unit_title', unit.title, { required: true, max: 180 })}${area('学习目标', 'goal', goal?.prompt || page?.summary || '', true)}${area('教学说明', 'markdown', text?.markdown || '', true)}${selectField(
    '关联实验',
    'activity_key',
    options,
    unit.activity_key,
    true,
    Boolean(unit.id),
  )}<div class="portal-inline-actions">${button('上移单元', 'move-unit', 'data-step="-1"')}${button('下移单元', 'move-unit', 'data-step="1"')}${button('移除单元', 'remove-unit')}</div><div class="portal-rule"></div><h2>理解检查点</h2>${!simpleCheckpoint(checkpoint) ? '<p class="portal-note">现有题型与答案规则将完整保留，本表单仅支持新建两选一检查点。</p>' : ''}<fieldset ${simpleCheckpoint(checkpoint) ? '' : 'disabled'}><label class="portal-checkbox"><input type="checkbox" name="checkpoint_enabled" ${checkpoint ? 'checked' : ''}/>通过一道选择题检查理解</label>${field('题目', 'question', checkpoint?.prompt || '', { max: 4000 })}<div class="portal-form-grid">${field('选项 A', 'choice_a', checkpoint?.choices?.[0]?.label || '', { max: 500 })}${field('选项 B', 'choice_b', checkpoint?.choices?.[1]?.label || '', { max: 500 })}${selectField(
    '正确选项',
    'correct_choice',
    [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
    ],
    checkpoint?.correctChoiceIds?.[0] || 'a',
  )}</div></fieldset><div class="portal-form-grid">${selectField(
    '完成条件',
    'completion',
    [
      { value: 'preserve', label: '保留现有完成规则' },
      { value: 'none', label: '暂不自动认定完成' },
      { value: 'checkpoint_passed', label: '通过本单元检查点' },
      { value: 'assignment_reviewed', label: '完成本单元作业批改' },
    ],
    page?.courseUnit?.completion?.preset === 'experiment_operation'
      ? 'preserve'
      : page?.courseUnit?.completion?.preset || 'none',
  )}${selectField('用于完成认定的作业', 'completion_assignment', [{ value: '', label: '选择已布置的作业' }, ...assignments.filter((item) => item.unit_id === unit.id && item.status === 'active').map((item) => ({ value: String(item.id), label: item.title }))], page?.courseUnit?.completion?.assignmentId || '')}</div><p class="portal-note">发布前需要选择完成条件。已存在的实验操作认定规则会保留。</p>${page?.blocks.filter((block) => !['learning-task', 'rich-text', 'official-simulation', 'checkpoint'].includes(block.type)).length ? '<p class="portal-note">现有媒体、导语和参考资料会保留。</p>' : ''}</form><p class="portal-note">保存时校验草稿修订；发布版本保持不可变。</p></section></div>`;
}

export function versions(releases: T.Release[], selected: number | undefined): string {
  const current = releases.find((item) => item.id === selected) || releases.at(-1);
  return `<div class="portal-columns"><section class="portal-surface"><h2>发布历史</h2>${
    releases.length
      ? releases
          .slice()
          .reverse()
          .map(
            (item) =>
              `<button class="portal-list-row" data-portal="select-release" data-id="${item.id}"><span><strong>第 ${item.release_number} 版</strong><small>${when(item.published_at)} · ${item.units.length} 个单元</small></span>${badge('published')}</button>`,
          )
          .join('')
      : empty('首次发布后，这里会保留不可变版本。')
  }</section><section class="portal-surface"><h2>${current ? `第 ${current.release_number} 版内容` : '版本内容'}</h2>${current ? `<ol class="portal-chapters">${current.units.map((unit) => `<li>${e(unit.title)} <small>${unit.content.blocks.length} 个内容块</small></li>`).join('')}</ol>${button('预览此版本', 'preview-release', `data-id="${current.id}"`)} ${button('与当前草稿比较', 'compare-release', `data-id="${current.id}"`)} ${button('恢复为新的草稿', 'restore-release', `data-id="${current.id}"`)}<p class="portal-note">恢复只产生新的草稿，不改写发布记录或学生成绩。</p>` : empty('暂无版本')}</section></div><div id="release-comparison"></div>`;
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

export function grading(
  assignment: T.Assignment,
  submissions: T.Page<T.Submission>,
  names: Map<number, string>,
): string {
  return (
    heading(
      assignment.title,
      `满分 ${assignment.max_score} · ${submissions.total} 条提交记录`,
      button('返回作业', 'course-tab', 'data-tab="assignments"'),
    ) +
    `<div class="portal-grading">${
      submissions.items.length
        ? submissions.items
            .map(
              (item) =>
                `<section class="portal-surface"><div class="portal-section-heading"><h2>${e(names.get(item.student_id) || `学生 ${item.student_id}`)}</h2>${badge(item.status)}</div><p class="portal-note">提交于 ${when(item.submitted_at)}</p><div class="submission-answer">${e(submissionText(item.content))}</div><form class="portal-grade-form" data-id="${item.id}"><div class="portal-form-grid">${field('分数', 'score', item.score ?? 0, { type: 'number', required: true, min: 0 })}${selectField(
                  '处理结果',
                  'status',
                  [
                    { value: 'graded', label: '完成批改' },
                    { value: 'returned', label: '退回重交' },
                  ],
                  item.status === 'returned' ? 'returned' : 'graded',
                )}</div>${area('教师反馈', 'feedback', item.feedback || '')}<button class="primary-button" type="submit">保存批改</button></form></section>`,
            )
            .join('')
        : empty('还没有学生提交。')
    }</div>`
  );
}

export function studentAssignments(
  page: T.Page<T.StudentAssignment>,
  filter: string,
  selectedKey: string,
  activities: T.Activity[] = [],
): string {
  const item =
    page.items.find((item) => `${item.assignment.id}:${item.class.id}` === selectedKey) || page.items[0];
  return (
    heading('我的作业', '查看任务、提交记录和教师反馈。') +
    `<nav class="portal-tabs">${[
      ['active', '当前作业'],
      ['feedback', '批改反馈'],
      ['history', '历史作业'],
    ]
      .map(
        ([key, title]) =>
          `<button data-portal="assignment-filter" data-filter="${key}" class="${filter === key ? 'active' : ''}">${title}</button>`,
      )
      .join(
        '',
      )}</nav><div class="portal-assignment-layout"><aside class="portal-assignment-list">${page.items.map((row) => `<button data-portal="select-assignment" data-key="${row.assignment.id}:${row.class.id}" class="${row === item ? 'active' : ''}"><strong>${e(row.assignment.title)}</strong><small>${e(row.course.title)}</small><span>${when(row.assignment.due_at)} ${badge(row.submission?.status || 'pending', row.submission ? human(row.submission.status) : '待提交')}</span></button>`).join('') || empty('这里暂时没有作业。')}<div class="portal-pagination">${page.offset > 0 ? button('上一页', 'assignment-page', `data-offset="${Math.max(0, page.offset - page.limit)}"`) : ''}${page.next_offset !== null ? button('下一页', 'assignment-page', `data-offset="${page.next_offset}"`) : ''}</div></aside><section class="portal-assignment-detail">${item ? `<h2>${e(item.assignment.title)}</h2><p class="portal-note">${e(item.course.title)} · 截止 ${when(item.assignment.due_at)}</p><div class="portal-rule"></div><div class="assignment-instructions">${e(item.assignment.description || '请根据课程内容完成本次作业。')}</div>${activities.some((activity) => activity.key === item.unit.activity_key) ? button('打开关联实验 →', 'open-activity', `data-key="${e(item.unit.activity_key)}"`) : ''}<form id="portal-submission-form" data-id="${item.assignment.id}" data-class="${item.class.id}">${item.can_submit ? area('我的回答', 'answer', item.submission ? submissionText(item.submission.content) : '', true) : `<h3>我的回答</h3><div class="submission-answer">${e(item.submission ? submissionText(item.submission.content) : '尚未提交回答。')}</div>`}${item.can_submit ? '<button type="submit" class="primary-button">提交作业</button>' : `<p class="portal-note">${item.submission?.status === 'graded' ? '本次作业已批改。' : item.submission ? '本次回答已提交，请等待教师批改。' : '当前作业暂不可提交，请核对单元开放安排。'}</p>`}</form><section class="portal-feedback"><h3>教师反馈</h3>${item.submission && ['graded', 'returned'].includes(item.submission.status) ? `<strong class="grade-score">${item.submission.score ?? '—'} <small>/ ${item.assignment.max_score}</small></strong><p>${e(item.submission.feedback || '教师未填写文字反馈。')}</p>` : '<p>提交后可在这里查看批改结果。</p>'}</section>` : empty('选择一项作业查看要求。')}</section></div>`
  );
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

export function learning(
  release: T.Release,
  selected: number,
  activities: T.Activity[],
  role: T.Role,
): string {
  const unit = release.units[selected] || release.units[0];
  return (
    heading(
      release.title,
      `${role === 'student' ? '正在学习' : '教师预览'}第 ${release.release_number} 个发布版本`,
      role === 'student' ? '' : button('返回发布历史', 'course-tab', 'data-tab="releases"'),
    ) +
    `<div class="portal-editor"><aside class="portal-unit-list">${release.units.map((item, index) => `<button data-portal="learn-unit" data-index="${index}" class="${item === unit ? 'active' : ''}"><small>${index + 1}</small><span>${e(item.title)}</span></button>`).join('')}</aside><article class="portal-lesson">${unit ? `<h2>${e(unit.title)}</h2>${unit.access_state === 'locked' ? '<p class="portal-note">这个单元尚未开放，请查看教师安排或先完成前置单元。</p>' : unit.content.blocks.map((block) => renderBlock(block, release, unit, activities, role)).join('')}` : empty('当前发布还没有学习单元。')}</article></div>`
  );
}

function renderBlock(
  block: T.Block,
  release: T.Release,
  unit: T.ReleaseUnit,
  activities: T.Activity[],
  role: T.Role,
): string {
  if (block.type === 'hero')
    return `<section class="lesson-block"><h2>${e(block.title)}</h2><p>${e(block.summary)}</p></section>`;
  if (block.type === 'rich-text')
    return `<section class="lesson-block"><h3>${e(block.title || '学习内容')}</h3><div class="lesson-prose">${markdown(block.markdown || '')}</div></section>`;
  if (block.type === 'learning-task')
    return `<section class="lesson-block"><h3>${e(block.title)}</h3><p>${e(block.prompt)}</p>${block.outcomes?.length ? `<ul>${block.outcomes.map((value) => `<li>${e(value)}</li>`).join('')}</ul>` : ''}${block.steps?.length ? `<ol>${block.steps.map((value) => `<li>${e(value)}</li>`).join('')}</ol>` : ''}</section>`;
  if (block.type === 'official-simulation') {
    const activity = activities.find((item) => item.key === block.simulationKey);
    return `<section class="lesson-block"><h3>${e(block.title)}</h3><p>${e(block.instructions)}</p>${activity ? button('打开交互实验 →', 'open-activity', `data-key="${e(activity.key)}"`) : '<p>该实验暂不可用。</p>'}</section>`;
  }
  if (block.type === 'sources')
    return `<section class="lesson-block"><h3>${e(block.title || '参考资料')}</h3>${(block.items || []).map((item) => (/^https?:\/\//.test(item.url) ? `<p><a href="${e(item.url)}" target="_blank" rel="noopener noreferrer">${e(item.label)}</a></p>` : '')).join('')}</section>`;
  if (block.type === 'checkpoint')
    return `<section class="lesson-block checkpoint-block"><h3>${e(block.title)}</h3><p>${e(block.prompt)}</p><form class="portal-checkpoint-form" data-course="${release.course_id}" data-unit="${unit.source_course_unit_id}" data-release="${release.id}" data-key="${e(block.checkpointKey)}" data-response="${e(block.responseType)}">${block.responseType?.endsWith('choice') ? (block.choices || []).map((item) => `<label class="checkpoint-choice"><input type="${block.responseType === 'multiple-choice' ? 'checkbox' : 'radio'}" name="answer" value="${e(item.choiceId)}"/>${e(item.label)}</label>`).join('') : field('你的回答', 'answer', '', { type: block.responseType === 'numeric' ? 'number' : 'text', required: true })}<button class="primary-button" type="submit" ${role === 'student' && block.mode !== 'question-set' ? '' : 'disabled'}>${role === 'student' ? '提交检查' : '教师预览'}</button><output class="checkpoint-result" role="status"></output></form></section>`;
  return `<section class="lesson-block"><h3>${e(block.title || '课程媒体')}</h3><p>${e(block.caption || block.alt || '该媒体资源由学校内容库管理。')}</p></section>`;
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
