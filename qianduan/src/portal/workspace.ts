import type * as T from './contracts';
import type { View } from '../domain/models';
import * as views from './views';
import {
  area,
  button,
  e,
  empty,
  field,
  human,
  pagination,
  selectField,
} from './presentation';
import { serverTime } from '../domain/time';
import { CoursePlayer } from './course-player';
import type { ResourceGateway } from './resource-types';
import type { WorkflowGateway } from './workflow-types';

interface Options {
  resources: ResourceGateway;
  workflow: WorkflowGateway;
  courseSectionsOnly?: boolean;
  demo: boolean;
  role: T.Role;
  userId: number;
  activities: T.Activity[];
  notify(message: string): void;
  navigate(view: View, courseId?: number): void;
  changed(): Promise<void>;
}

/** A mounted workspace owns its requests and unsaved forms; transport lives in the gateway. */
export class PortalWorkspace {
  private abort = new AbortController();
  private active = true;
  private busy = false;
  private formDirty = false;
  private view: View = 'overview';
  private courseId?: number;
  private course?: T.CourseInfo;
  private draft?: T.SharedDraft;
  private tab = 'assignments';
  private unit = 0;
  private learningRelease?: T.Release;
  private pageOffsets: Record<string, number> = {};
  private filter = 'active';
  private offset = 0;
  private assignmentKey = '';
  private studentPage?: T.Page<T.StudentAssignment>;
  private classId?: number;
  private plan?: T.ReleasePlan;
  private schools: T.School[] = [];
  private classes: T.Classroom[] = [];
  private assignment?: T.Assignment;
  private returnFromExperiment: DocumentFragment | null = null;
  private player?: CoursePlayer;
  private suspendedFormDirty = false;
  private retry: () => Promise<void> = async () => {};

  constructor(
    private root: HTMLElement,
    private api: T.SchoolGateway,
    private options: Options,
  ) {
    const { signal } = this.abort;
    root.addEventListener('click', this.click, { signal });
    root.addEventListener('submit', this.submit, { signal });
    root.addEventListener('input', this.input, { signal });
    root.addEventListener('change', this.change, { signal });
  }

  mount(view: View, courseId?: number, assignmentKey = '', tab?: string): void {
    this.view = view;
    this.courseId = courseId;
    this.assignmentKey = assignmentKey;
    if (tab) this.tab = tab;
    void this.run(() => this.load());
  }

  canLeave(): boolean {
    if (this.busy) {
      this.options.notify('正在处理请求，请稍候。');
      return false;
    }
    return !this.hasChanges() || confirm('这里有未保存的修改。确定离开并放弃这些修改吗？');
  }

  hasChanges(): boolean {
    return this.formDirty || this.suspendedFormDirty;
  }
  destroy(): void {
    this.player?.destroy();
    this.active = false;
    this.abort.abort();
  }
  private paint(html: string): void {
    if (!this.active) return;
    this.player?.destroy(); this.player = undefined;
    this.root.innerHTML = `<div class="portal-view">${html}</div>`;
    this.formDirty = false;
    const unit = this.learningRelease?.units[this.unit];
    if (this.learningRelease && unit && unit.access_state !== 'locked' && this.root.querySelector('[data-course-resource], [data-course-media]')) {
      this.player = new CoursePlayer(this.root, this.options.resources, this.options.workflow, this.learningRelease, unit);
      this.player.mount();
    }
  }

  private async run(action: () => Promise<void>, mutation = false): Promise<void> {
    if (!this.active || this.busy) return;
    this.busy = true;
    if (!mutation) this.retry = action;
    this.root.setAttribute('aria-busy', 'true');
    this.root.querySelectorAll<HTMLButtonElement>('button').forEach((item) => {
      item.dataset.wasDisabled = String(item.disabled);
      item.disabled = true;
    });
    try {
      await action();
    } catch (error) {
      if (!this.active) return;
      const message = error instanceof Error ? error.message : '读取失败，请重试。';
      let feedback = this.root.querySelector<HTMLElement>('#portal-error');
      if (!feedback) {
        this.root.insertAdjacentHTML(
          'afterbegin',
          '<div id="portal-error" class="portal-error" role="alert"></div>',
        );
        feedback = this.root.querySelector('#portal-error');
      }
      if (feedback)
        feedback.innerHTML = `${e(message)} ${mutation ? '<span>你的页面内容仍保留，请核对服务器状态后再操作。</span>' : button('重新读取', 'retry')}`;
    } finally {
      this.busy = false;
      this.root.removeAttribute('aria-busy');
      this.root.querySelectorAll<HTMLButtonElement>('button[data-was-disabled]').forEach((item) => {
        item.disabled = item.dataset.wasDisabled === 'true';
        delete item.dataset.wasDisabled;
      });
    }
  }

  private async directories(): Promise<void> {
    [this.schools, this.classes] = await Promise.all([this.api.schools(), this.api.classes()]);
  }

  private async load(): Promise<void> {
    if (this.view === 'course') {
      if (!this.courseId) throw new Error('请先选择一门课程。');
      if (this.options.role === 'student') {
        this.learningRelease = (await this.api.currentRelease(this.courseId)).release;
        this.paint(
          views.learning(this.learningRelease, this.unit, this.options.activities, this.options.role),
        );
      } else await this.loadCourse();
      return;
    }
    if (this.view === 'classes') {
      await this.loadClasses();
      return;
    }
    if (this.view === 'assignments' && this.options.role === 'student') {
      await this.loadAssignments();
      return;
    }
    if (this.view === 'manage' || this.options.role === 'admin') {
      await this.loadAdministration();
      return;
    }
    if (['courses', 'assignments', 'teaching'].includes(this.view)) {
      this.paint(views.teacherCourses(await this.api.teacherCourses()));
      return;
    }
    const [workbench, authored] = await Promise.all([this.api.workbench(), this.api.teacherCourses()]);
    const authoredIds = new Set(authored.map((course) => course.id));
    const previousCount = workbench.courses?.total || 0;
    if (workbench.courses) {
      workbench.courses.items = workbench.courses.items.filter((course) => authoredIds.has(course.course_id));
      workbench.courses.total = authored.length;
    }
    const legacyCount = Math.max(0, previousCount - authored.length);
    this.paint(
      views.teacherDashboard(workbench) +
        this.sectionErrors(workbench) +
        (legacyCount
          ? `<p class="portal-note">另保留 ${legacyCount} 项早期资源课程记录。实验从三个学习空间进入；已有教学数据会在课程迁移时继续保留。</p>`
          : ''),
    );
  }

  private sectionErrors(data: T.Workbench): string {
    return data.section_errors.length
      ? `<p class="portal-error">部分区域读取失败：${data.section_errors.map((item) => e(item.message)).join('；')} ${button('重新读取', 'retry')}</p>`
      : '';
  }

  private async loadCourse(): Promise<void> {
    const [course, draft] = await Promise.all([
      this.api.course(this.courseId!),
      this.api.draft(this.courseId!),
    ]);
    this.course = course;
    this.draft = draft;
    this.unit = Math.min(this.unit, Math.max(0, draft.units.length - 1));
    await this.loadTab();
  }

  private async loadTab(): Promise<void> {
    if (!this.course || !this.draft) return;
    let body = '';
    if (this.tab === 'students') {
      const [enrollments, requests] = await Promise.all([
        this.api.enrollments(this.courseId!, this.pageOffsets.enrollments),
        this.api.joinRequests(this.courseId!, this.pageOffsets.joins),
      ]);
      body =
        views.courseStudents(enrollments, requests) +
        pagination(enrollments, 'enrollments', '课程学生') +
        pagination(requests, 'joins', '入课申请');
    }
    if (this.tab === 'assignments')
      body = views.teacherAssignments(await this.api.assignments(this.courseId!), this.draft.units);
    if (this.tab === 'plan') {
      const groups = await this.api.courseClasses(this.courseId!);
      if (!groups.some((item) => item.id === this.classId)) this.classId = groups[0]?.id;
      this.plan = this.classId ? await this.api.releasePlan(this.courseId!, this.classId) : undefined;
      body = this.plan
        ? this.planView(groups)
        : empty('资料通过学校审核、建立教学范围后，可以设置单元开放计划。');
    }
    this.paint((this.options.courseSectionsOnly ? '' : views.heading(this.course.title, '', button('进入课程编辑', 'open-course', `data-id="${this.course.id}"`)) + `<nav class="portal-tabs">${[['students', '学生'], ['assignments', '作业'], ['plan', '开放计划']].map(([key, label]) => button(label, 'course-tab', `data-tab="${key}"`)).join('')}</nav>`) + body);
  }

  private planView(groups: T.Classroom[]): string {
    const plan = this.plan!;
    const names = new Map(this.draft!.units.map((unit) => [unit.id, unit.title]));
    return `<section class="portal-surface">${selectField(
      '教学范围',
      'plan_class',
      groups.map((item) => ({ value: item.id, label: item.name })),
      this.classId,
    )}<form id="portal-plan-form"><div class="portal-table-wrap"><table class="portal-table"><thead><tr><th>学习单元</th><th>开放状态</th><th>开始时间（可选）</th><th>先完成（可选）</th></tr></thead><tbody>${plan.items
      .map(
        (item, index) =>
          `<tr><td>${e(names.get(item.course_unit_id) || item.activity_key)}</td><td>${selectField(
            '状态',
            `mode_${index}`,
            [
              { value: 'open', label: '开放' },
              { value: 'locked', label: '锁定' },
              { value: 'hidden', label: '隐藏' },
            ],
            item.release_mode,
          )}</td><td>${field('开始时间', `time_${index}`, localDateTime(item.open_at), { type: 'datetime-local' })}</td><td>${selectField('前置单元', `pre_${index}`, [{ value: '', label: '无需前置' }, ...plan.items.slice(0, index).map((unit) => ({ value: String(unit.course_unit_id), label: names.get(unit.course_unit_id) || unit.activity_key }))], item.prerequisite_unit_id || '')}</td></tr>`,
      )
      .join(
        '',
      )}</tbody></table></div><button class="primary-button" type="submit">保存开放计划</button></form></section>`;
  }

  private async loadAssignments(): Promise<void> {
    this.studentPage = await this.api.studentAssignments(this.filter, this.offset);
    this.paint(
      views.studentAssignments(this.studentPage, this.filter, this.assignmentKey, this.options.activities),
    );
  }

  private async loadClasses(): Promise<void> {
    await this.directories();
    this.classes = this.classes.filter((item) => item.kind === 'homeroom');
    const selected = this.classes.find((item) => item.id === this.classId) || this.classes[0];
    this.classId = selected?.id;
    const [members, requests] = selected
      ? await Promise.all([
          this.api.members(selected.id, this.pageOffsets.members),
          this.options.role === 'student' ? Promise.resolve([]) : this.api.classRequests(selected.id),
        ])
      : [null, []];
    this.paint(
      views.classroomList(
        this.classes,
        this.schools,
        this.options.role,
        selected,
        members?.items || [],
        requests.filter((item) => item.status === 'pending'),
      ) + (members ? pagination(members, 'members', '班级成员') : ''),
    );
  }

  private async loadAdministration(): Promise<void> {
    if (this.options.role !== 'admin') {
      this.paint(empty('学校管理由管理员处理。'));
      return;
    }
    const [data, teachers, reviews, users, schools] = await Promise.all([
      this.api.workbench(),
      this.api.teacherApplications(this.pageOffsets.teachers),
      this.api.courseReviews(this.pageOffsets.reviews),
      this.api.adminUsers(this.pageOffsets.users),
      this.api.schools(),
    ]);
    this.paint(
      views.administration(data, teachers.items, reviews.items, users.items, schools) +
        this.sectionErrors(data) +
        pagination(teachers, 'teachers', '教师申请') +
        pagination(reviews, 'reviews', '课程审核') +
        pagination(users, 'users', '账号'),
    );
  }

  private async openGrading(id: number, courseId?: number): Promise<void> {
    if (this.assignment?.id !== id) this.pageOffsets.submissions = 0;
    if (courseId && courseId !== this.courseId) {
      this.courseId = courseId;
      [this.course, this.draft] = await Promise.all([this.api.course(courseId), this.api.draft(courseId)]);
    }
    const [assignments, submissions, enrollments] = await Promise.all([
      this.api.assignments(this.courseId!),
      this.api.submissions(id, undefined, this.pageOffsets.submissions),
      this.api.enrollments(this.courseId!),
    ]);
    this.assignment = assignments.find((item) => item.id === id);
    if (!this.assignment) throw new Error('这项作业已不可用，请重新读取课程。');
    this.paint(
      views.grading(
        this.assignment,
        submissions,
        new Map(enrollments.items.map((item) => [item.student_id, item.display_name])),
      ) + pagination(submissions, 'submissions', '作业提交'),
    );
  }

  private click = (event: MouseEvent): void => {
    const target = (event.target as Element).closest<HTMLElement>('[data-portal]');
    if (!target) return;
    event.stopPropagation();
    const action = target.dataset.portal!;
    if (action === 'retry') {
      void this.run(this.retry);
      return;
    }
    const navigate = (view: View, id?: number) => {
      if (this.canLeave()) this.options.navigate(view, id);
    };
    if (action === 'open-course' || action === 'learn-course') {
      navigate('course', Number(target.dataset.id));
      return;
    }
    if (action === 'course-list') {
      navigate('courses');
      return;
    }
    if (action === 'new-course') {
      navigate('course', 0);
      return;
    }
    void this.run(async () => {
      const id = Number(target.dataset.id),
        status = target.dataset.status || '';
      if (action === 'paginate') {
        if (this.formDirty && !confirm('放弃尚未保存的表单内容？')) return;
        this.pageOffsets[target.dataset.collection!] = Number(target.dataset.offset);
        if (target.dataset.collection === 'members') await this.loadClasses();
        else if (['teachers', 'reviews', 'users'].includes(target.dataset.collection!))
          await this.loadAdministration();
        else if (target.dataset.collection === 'submissions') await this.openGrading(this.assignment!.id);
        else await this.loadTab();
      } else if (action === 'course-tab') {
        if (this.formDirty && !confirm('放弃当前表单中未保存的修改？')) return;
        this.tab = target.dataset.tab!;
        await this.loadTab();
      } else if (action === 'review-join') {
        await this.api.reviewJoin(this.courseId!, id, status);
        await this.loadTab();
      } else if (action === 'remove-enrollment') {
        if (confirm('移出这名学生？已有提交和成绩仍将保留。')) {
          await this.api.removeEnrollment(this.courseId!, id);
          await this.loadTab();
        }
      } else if (action === 'grade-assignment')
        await this.openGrading(id, Number(target.dataset.course) || undefined);
      else if (action === 'assignment-filter') {
        if (this.formDirty && !confirm('放弃尚未提交的回答？')) return;
        this.filter = target.dataset.filter!;
        this.offset = 0;
        await this.loadAssignments();
      } else if (action === 'assignment-page') {
        if (this.formDirty && !confirm('放弃尚未提交的回答？')) return;
        this.offset = Number(target.dataset.offset);
        await this.loadAssignments();
      } else if (action === 'select-assignment') {
        if (this.formDirty && !confirm('放弃尚未提交的回答？')) return;
        this.assignmentKey = target.dataset.key!;
        this.paint(
          views.studentAssignments(
            this.studentPage!,
            this.filter,
            this.assignmentKey,
            this.options.activities,
          ),
        );
      } else if (action === 'select-class') {
        this.pageOffsets.members = 0;
        this.classId = id;
        await this.loadClasses();
      } else if (action === 'review-class') {
        await this.api.reviewClass(this.classId!, id, status);
        await this.loadClasses();
      } else if (['review-course', 'review-teacher'].includes(action)) {
        const subject = target.closest('.portal-request')?.querySelector('h3')?.textContent?.trim();
        if (!subject) throw new Error('审核对象已变化，请重新读取列表。');
        this.paint(
          views.heading(
            '审核意见',
            `${subject} · ${status === 'approved' ? '确认通过本次申请。' : '说明需要补充或调整的内容。'}`,
            button('返回管理', 'admin-back'),
          ) +
            `<form id="portal-review-form" class="portal-surface" data-kind="${action}" data-id="${id}" data-status="${status}">${area('审核说明', 'note', '', status === 'rejected')}<button type="submit" class="primary-button">${status === 'approved' ? '确认通过' : '退回修改'}</button></form>`,
        );
      } else if (action === 'admin-back') await this.loadAdministration();
      else if (action === 'user-status') {
        if (confirm(`确认${status === 'active' ? '恢复' : '停用'}这个账号？`)) {
          await this.api.updateUser(id, { status });
          await this.loadAdministration();
        }
      } else if (action === 'learn-unit') {
        this.unit = Number(target.dataset.index);
        this.paint(
          views.learning(this.learningRelease!, this.unit, this.options.activities, this.options.role),
        );
      } else if (action === 'open-activity') {
        const activity = this.options.activities.find((item) => item.key === target.dataset.key);
        if (!activity) throw new Error('没有找到这个实验。');
        this.returnFromExperiment = document.createDocumentFragment();
        this.suspendedFormDirty = this.formDirty;
        while (this.root.firstChild) this.returnFromExperiment.append(this.root.firstChild);
        this.paint(views.experimentFrame(activity.title, activity.href));
      } else if (action === 'back-from-experiment') {
        if (this.returnFromExperiment) this.root.replaceChildren(this.returnFromExperiment);
        this.returnFromExperiment = null;
        this.formDirty = this.suspendedFormDirty;
        this.suspendedFormDirty = false;
      }
    }, !['select-unit', 'select-release', 'learn-unit', 'open-activity', 'back-from-experiment', 'select-class', 'course-tab'].includes(action));
  };

  private submit = (event: SubmitEvent): void => {
    const form = event.target as HTMLFormElement;
    if (!form.id.startsWith('portal-') && !form.className.includes('portal-')) return;
    event.preventDefault();
    event.stopPropagation();
    if (!form.reportValidity()) return;
    const data = new FormData(form),
      value = (name: string) => String(data.get(name) || '').trim();
    void this.run(async () => {
      if (form.id === 'portal-assignment-form') {
        await this.api.createAssignment(this.courseId!, Number(value('unit_id')), {
          title: value('title'),
          description: value('description'),
          due_at: value('due_at') ? new Date(value('due_at')).toISOString() : null,
          max_score: Number(value('max_score')),
          status: 'active',
          audience_mode: 'all_attached_classes',
        });
        await this.loadTab();
        this.options.notify('作业已布置。');
      } else if (form.classList.contains('portal-grade-form')) {
        const score = Number(value('score'));
        if (score > this.assignment!.max_score) throw new Error('分数不能超过作业满分。');
        await this.api.grade(
          Number(form.dataset.id),
          score,
          value('feedback'),
          value('status') as 'graded' | 'returned',
        );
        await this.openGrading(this.assignment!.id);
        this.options.notify('批改结果已保存。');
      } else if (form.id === 'portal-submission-form') {
        await this.api.submitAssignment(Number(form.dataset.id), Number(form.dataset.class), value('answer'));
        await this.loadAssignments();
        await this.options.changed();
        this.options.notify('回答已提交，等待教师反馈。');
      } else if (form.id === 'portal-plan-form') {
        const plan = structuredClone(this.plan!);
        plan.items.forEach((item, index) => {
          item.release_mode = value(`mode_${index}`) as T.ReleasePlan['items'][number]['release_mode'];
          item.open_at = value(`time_${index}`) ? new Date(value(`time_${index}`)).toISOString() : null;
          item.prerequisite_unit_id = Number(value(`pre_${index}`)) || null;
        });
        this.plan = await this.api.saveReleasePlan(plan);
        await this.loadTab();
        this.options.notify('开放计划已保存。');
      } else if (form.id === 'portal-class-form') {
        await this.api.createClass(Number(value('school_id')), value('name'), value('grade'), value('term'));
        await this.loadClasses();
      } else if (form.id === 'portal-class-join-form') {
        await this.api.requestClass(Number(value('class_id')), this.options.role, value('message'));
        await this.loadClasses();
        this.options.notify('加入申请已提交。');
      } else if (form.id === 'portal-school-form') {
        await this.api.createSchool(value('name'));
        await this.loadAdministration();
      } else if (form.id === 'portal-review-form') {
        if (form.dataset.kind === 'review-course')
          await this.api.reviewCourse(Number(form.dataset.id), form.dataset.status!, value('note'));
        else await this.api.reviewTeacher(Number(form.dataset.id), form.dataset.status!, value('note'));
        await this.loadAdministration();
        this.options.notify('审核结果已保存。');
      } else if (form.classList.contains('portal-checkpoint-form')) {
        const selected = data.getAll('answer').map(String);
        if (!selected.length) throw new Error('请先填写你的回答。');
        const payload: Record<string, unknown> = {
          client_attempt_id: crypto.randomUUID(),
          course_release_id: Number(form.dataset.release),
        };
        if (form.dataset.response === 'numeric') payload.numeric_answer = Number(value('answer'));
        else if (form.dataset.response === 'short-text') payload.text_answer = value('answer');
        else payload.selected_choice_ids = selected;
        const result = await this.api.checkpoint(
          Number(form.dataset.course),
          Number(form.dataset.unit),
          form.dataset.key!,
          payload,
        );
        form.querySelector('output')!.textContent = result.is_correct
          ? result.completed
            ? this.options.demo
              ? '演示回答正确，演示进度已更新。'
              : '回答正确，服务端已认定完成。'
            : '回答正确。'
          : `还需要再想一想。${result.remaining_attempts === null ? '' : `剩余 ${result.remaining_attempts} 次机会。`}`;
        this.formDirty = false;
        await this.options.changed();
      }
    }, true);
  };

  private input = (event: Event): void => {
    const form = (event.target as Element).closest('form');
    if (form?.classList.contains('portal-checkpoint-form') && this.options.role !== 'student') return;
    if (form) this.formDirty = true;
  };
  private change = (event: Event): void => {
    const target = event.target as HTMLSelectElement;
    if (target.name === 'plan_class') {
      if (this.formDirty && !confirm('放弃未保存的开放计划修改？')) {
        target.value = String(this.classId);
        return;
      }
      this.classId = Number(target.value);
      void this.run(() => this.loadTab());
    }
  };
}

function localDateTime(value: string | null): string {
  if (!value) return '';
  const date = serverTime(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
