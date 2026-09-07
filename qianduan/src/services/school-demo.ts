import type * as T from '../portal/contracts';
import { ApiError } from './http-client.ts';

const copy = <V>(value: V): V => structuredClone(value);
const page = <V>(items: V[], offset = 0, limit = 50): T.Page<V> => ({
  items: copy(items.slice(offset, offset + limit)),
  total: items.length,
  offset,
  limit,
  next_offset: offset + limit < items.length ? offset + limit : null,
});

export function createSchoolDemo(role: () => T.Role, activities: T.Activity[]): T.SchoolGateway {
  const schools: T.School[] = [{ id: 1, name: '星序示范学校', status: 'active', version: 1 }];
  const classes: T.Classroom[] = [
    {
      id: 1,
      school_id: 1,
      name: '探索一班',
      kind: 'homeroom',
      grade: '高一',
      term: '2026—2027',
      status: 'active',
      version: 1,
    },
  ];
  const users: T.AdminUser[] = [
    { id: 1, username: 'teacher', display_name: '陈老师', role: 'teacher', status: 'active' },
    { id: 2, username: 'student', display_name: '星序同学', role: 'student', status: 'active' },
    { id: 3, username: 'admin', display_name: '学校管理员', role: 'admin', status: 'active' },
  ];
  const courses: T.CourseInfo[] = [];
  const drafts = new Map<number, T.SharedDraft>();
  const releaseHistory = new Map<number, T.Release[]>();
  const unitRecords = new Map<number, { courseId: number; unit: T.DraftUnit }>();
  const plans = new Map<string, T.ReleasePlan>();
  const completed = new Set<string>();
  const assignments: T.Assignment[] = [];
  const submissions: T.Submission[] = [];
  const joins: T.JoinRequest[] = [];
  const classJoins: T.ClassRequest[] = [];
  const teacherRequests: T.TeacherApplication[] = [];
  let counter = 200;
  const configs = [
    ['函数与变化', 'englab', 'mathematics'],
    ['力与运动', 'englab', 'physics'],
    ['概率与决策', 'englab', 'mathematics'],
    ['算法入门', 'code-space', 'program-start'],
    ['生命系统', 'englab', 'biology'],
    ['化学反应', 'englab', 'chemistry'],
  ];
  const find = (id: number) => {
    const course = courses.find((item) => item.id === id);
    if (!course) throw new ApiError('没有找到课程。', 404);
    return course;
  };
  const requireRole = (...allowed: T.Role[]) => {
    if (!allowed.includes(role())) throw new ApiError('当前演示身份没有该操作权限。', 403);
  };
  const buildCourse = (id: number, input: T.CourseInput, status: T.Information['status']): T.CourseInfo => ({
    ...copy(input),
    id,
    creator_user_id: 1,
    course_code: status === 'approved' ? `ASTRA${String(id).padStart(3, '0')}` : null,
    status: status === 'approved' ? 'published' : 'draft',
    teachers: [{ user_id: 1, display_name: '陈老师', is_creator: true, role: 'teacher' }],
    admission_classes: input.admission_class_ids.map((class_id) => ({
      class_id,
      name: classes.find((item) => item.id === class_id)?.name || '班级',
    })),
    information_revision: {
      id: ++counter,
      revision_number: 1,
      edit_revision: 1,
      status,
      review_note: null,
      information_snapshot: copy(input),
      submitted_at: null,
    },
    has_published_content: status === 'approved',
    active_student_count: 1,
  });
  const release = (course: T.CourseInfo, draft: T.SharedDraft): T.Release => ({
    id: ++counter,
    course_id: course.id,
    release_number: (releaseHistory.get(course.id)?.length || 0) + 1,
    draft_revision: draft.revision,
    title: course.title,
    summary: course.summary,
    published_at: new Date().toISOString(),
    package_sha256: `demo-${counter}`,
    completion_rule_sha256: `demo-rule-${counter}`,
    units: draft.units.map((unit) => ({
      id: ++counter,
      source_course_unit_id: unit.id!,
      activity_key: unit.activity_key,
      title: unit.title,
      position: unit.position,
      content: copy(unit.content!),
      content_schema_sha256: `demo-content-${counter}`,
    })),
  });
  configs.forEach(([title, galaxy_key, subject_key], index) => {
    const id = index + 1,
      input: T.CourseInput = {
        school_id: 1,
        title,
        summary: '从观察与预测开始，用实验解释概念。',
        academic_year: '2026—2027',
        schedule_text: `周${'一三五二四五'[index]} 09:00—10:30`,
        total_hours: 16,
        galaxy_key,
        subject_key,
        admission_mode: 'open',
        admission_class_ids: [],
        collaborator_user_ids: [],
      };
    const course = buildCourse(id, input, 'approved');
    courses.push(course);
    const activity =
      activities.find((item) => item.galaxy === galaxy_key && item.subject === subject_key) || activities[0];
    const unitId = id * 10;
    const content: T.ContentPage = {
      schemaVersion: 'astra-content-page-v2',
      slug: `demo/${id}`,
      galaxy: galaxy_key,
      subject: subject_key,
      title: '观察与解释',
      summary: input.summary!,
      layout: 'course-page',
      status: 'published',
      version: 'demo',
      blocks: [
        {
          blockId: 'intro',
          type: 'rich-text',
          title: '学习说明',
          markdown: '先写下预测，再改变实验参数，比较结果与解释。',
        },
        {
          blockId: 'simulation',
          type: 'official-simulation',
          title: activity.title,
          simulationKey: activity.key,
          instructions: '进入实验，观察变量的变化。',
        },
        {
          blockId: 'question',
          type: 'checkpoint',
          checkpointKey: 'first-check',
          title: '检查理解',
          prompt: '要判断一个参数的影响，应该怎样进行比较？',
          mode: 'inline',
          responseType: 'single-choice',
          choices: [
            { choiceId: 'a', label: '一次只改变一个参数' },
            { choiceId: 'b', label: '同时改变所有参数' },
          ],
          correctChoiceIds: ['a'],
        },
      ],
      courseUnit: {
        courseId: `demo-${id}`,
        unitId: activity.key,
        order: 1,
        title: '观察与解释',
        completion: { preset: 'checkpoint_passed', checkpointKey: 'first-check' },
      },
    };
    const draft: T.SharedDraft = {
      course_id: id,
      revision: 1,
      status: 'published',
      title,
      summary: input.summary,
      units: [{ id: unitId, activity_key: activity.key, title: '观察与解释', position: 1, content }],
    };
    drafts.set(id, draft);
    unitRecords.set(unitId, { courseId: id, unit: copy(draft.units[0]) });
    releaseHistory.set(id, [release(course, draft)]);
    if (index < 3)
      assignments.push({
        id: id,
        unit_id: unitId,
        title: ['寻找曲线中的变化规律', '解释一次力的合成', '比较合作与竞争的选择'][index],
        description: '记录你的预测、操作过程和观察结果，并解释它们之间的关系。',
        due_at: new Date(Date.now() + (index + 1) * 86400000).toISOString(),
        max_score: 100,
        status: 'active',
        audience_mode: 'all_attached_classes',
      });
  });
  submissions.push({
    id: ++counter,
    assignment_id: 2,
    student_id: 2,
    class_id: 1,
    content: { answer: '我分别观察了两个力的方向，并比较合力变化。' },
    status: 'submitted',
    score: null,
    feedback: null,
    submitted_at: new Date().toISOString(),
    graded_at: null,
  });
  const assignmentCourse = (assignment: T.Assignment) => find(unitRecords.get(assignment.unit_id)!.courseId);
  const studentRows = (): T.StudentAssignment[] =>
    assignments.map((assignment) => {
      const course = assignmentCourse(assignment),
        unit = unitRecords.get(assignment.unit_id)!.unit,
        submission = [...submissions].reverse().find((item) => item.assignment_id === assignment.id) || null;
      return {
        class: classes[0],
        course: {
          id: course.id,
          title: course.title,
          galaxy_key: course.galaxy_key,
          subject_key: course.subject_key,
        },
        unit: { id: unit.id!, title: unit.title, activity_key: unit.activity_key },
        assignment: copy(assignment),
        submission: copy(submission),
        can_submit: assignment.status === 'active' && (!submission || submission.status === 'returned'),
        read_only: assignment.status !== 'active' || Boolean(submission && submission.status !== 'returned'),
        submit_block_reason: submission && submission.status !== 'returned' ? 'already_submitted' : null,
      };
    });
  const enrollmentRows = (id: number): T.Enrollment[] =>
    find(id).active_student_count
      ? [
          {
            id: id * 100,
            student_id: 2,
            display_name: '星序同学',
            source_class_name: '探索一班',
            status: 'active',
          },
        ]
      : [];
  return {
    async myTeacherApplication() {
      return copy(teacherRequests.at(-1) || null);
    },
    async authoringOptions(schoolId) {
      return {
        teachers: users
          .filter((user) => user.role === 'teacher')
          .map((user) => ({ user_id: user.id, display_name: user.display_name })),
        homerooms: classes
          .filter((group) => group.school_id === schoolId)
          .map((group) => ({ class_id: group.id, name: group.name, grade: group.grade, term: group.term })),
      };
    },
    async courseClasses(id) {
      requireRole('teacher', 'admin');
      return find(id).course_code ? copy(classes.slice(0, 1)) : [];
    },
    async workbench() {
      const base: T.Workbench = { role: role(), section_errors: [] };
      if (role() === 'admin')
        return {
          ...base,
          catalog_totals: {
            users: users.length,
            courses: courses.length,
            active_schools: schools.length,
            active_homerooms: classes.length,
          },
          pending_teacher_applications: page(
            teacherRequests
              .filter((item) => item.status === 'pending')
              .map((item) => ({
                application_id: item.id,
                user_id: item.user_id,
                username: item.applicant_username,
                display_name: item.applicant_display_name,
                message: item.message,
              })),
          ),
          pending_course_revisions: page(
            courses
              .filter((item) => item.information_revision.status === 'submitted')
              .map((item) => ({
                revision_id: item.information_revision.id,
                course_id: item.id,
                course_title: item.title,
              })),
          ),
        };
      return {
        ...base,
        courses: page(
          courses
            .filter(
              (course) =>
                role() !== 'student' || (course.active_student_count > 0 && course.has_published_content),
            )
            .map((course) => ({
              course_id: course.id,
              title: course.title,
              course_code: course.course_code,
              galaxy_key: course.galaxy_key,
              subject_key: course.subject_key,
              schedule_text: course.schedule_text,
              summary: course.summary,
              teacher_display_name: '陈老师',
              status: course.status,
              current_release_number: releaseHistory.get(course.id)?.length || 0,
              content_draft_revision: drafts.get(course.id)?.revision || 0,
              has_unpublished_changes:
                (drafts.get(course.id)?.revision || 0) !==
                (releaseHistory.get(course.id)?.at(-1)?.draft_revision || 0),
              published_unit_count: releaseHistory.get(course.id)?.at(-1)?.units.length || 0,
              completed_unit_count: (releaseHistory.get(course.id)?.at(-1)?.units || []).filter((unit) =>
                completed.has(`${course.id}:${unit.source_course_unit_id}`),
              ).length,
              active_student_count: course.active_student_count,
              pending_student_count: joins.filter(
                (item) => item.course_id === course.id && item.status === 'pending',
              ).length,
            })),
        ),
        homerooms: page(classes.map((item) => ({ class_id: item.id, name: item.name }))),
        pending_students: page(
          joins
            .filter((item) => item.status === 'pending')
            .map((item) => ({
              request_id: item.id,
              course_id: item.course_id,
              course_title: find(item.course_id).title,
              student_display_name: item.display_name,
              source_class_name: item.source_class_name,
            })),
        ),
        pending_grading: page(
          submissions
            .filter((item) => item.status === 'submitted')
            .map((item) => {
              const assignment = assignments.find((a) => a.id === item.assignment_id)!,
                course = assignmentCourse(assignment);
              return {
                submission_id: item.id,
                class_id: item.class_id,
                assignment_id: item.assignment_id,
                assignment_title: assignment.title,
                course_id: course.id,
                course_title: course.title,
                student_display_name: '星序同学',
              };
            }),
        ),
        unpublished_drafts: page(
          courses
            .filter(
              (course) =>
                (drafts.get(course.id)?.revision || 0) !==
                (releaseHistory.get(course.id)?.at(-1)?.draft_revision || 0),
            )
            .map((course) => ({
              course_id: course.id,
              course_title: course.title,
              content_draft_revision: drafts.get(course.id)?.revision || 0,
            })),
        ),
      };
    },
    async schools() {
      return copy(schools);
    },
    async createSchool(name) {
      requireRole('admin');
      const school = { id: ++counter, name, status: 'active', version: 1 };
      schools.push(school);
      return copy(school);
    },
    async classes() {
      return copy(classes);
    },
    async createClass(school_id, name, grade, term) {
      requireRole('teacher', 'admin');
      const item: T.Classroom = {
        id: ++counter,
        school_id,
        name,
        grade,
        term,
        status: 'active',
        version: 1,
        kind: 'homeroom',
      };
      classes.push(item);
      return copy(item);
    },
    async members(_classId, offset = 0) {
      return page(
        users
          .filter((user) => user.role !== 'admin')
          .map((user) => ({ ...user, user_id: user.id, id: user.id, role: user.role, status: 'active' })),
        offset,
        100,
      );
    },
    async classRequests(id) {
      return copy(classJoins.filter((item) => item.class_id === id));
    },
    async requestClass(class_id, memberRole, message) {
      const item = { id: ++counter, class_id, user_id: 2, role: memberRole, status: 'pending', message };
      classJoins.push(item);
      return copy(item);
    },
    async reviewClass(_, id, status) {
      requireRole('teacher', 'admin');
      const item = classJoins.find((item) => item.id === id);
      if (item) item.status = status;
      return copy(item);
    },
    async teacherCourses() {
      requireRole('teacher');
      return copy(courses);
    },
    async course(id) {
      requireRole('teacher', 'admin');
      return copy(find(id));
    },
    async createCourse(input) {
      requireRole('teacher');
      const item = buildCourse(++counter, input, 'draft');
      item.has_published_content = false;
      item.active_student_count = 0;
      courses.push(item);
      drafts.set(item.id, {
        course_id: item.id,
        revision: 0,
        status: 'draft',
        title: item.title,
        summary: item.summary,
        units: [],
      });
      return copy(item);
    },
    async reviseCourse(id, input) {
      requireRole('teacher');
      const item = find(id);
      if (['draft', 'submitted'].includes(item.information_revision.status))
        throw new ApiError('已有待处理的资料修订。', 409);
      item.information_revision = {
        id: ++counter,
        revision_number: item.information_revision.revision_number + 1,
        edit_revision: 1,
        status: 'draft',
        review_note: null,
        submitted_at: null,
        information_snapshot: copy(input),
      };
      return copy(item);
    },
    async submitInformation(id, revision) {
      requireRole('teacher');
      const item = find(id);
      if (item.information_revision.id !== revision) throw new ApiError('资料版本已变化。', 409);
      item.information_revision.status = 'submitted';
      return copy(item);
    },
    async editInformation(id, revision, expected, input) {
      requireRole('teacher');
      const course = find(id),
        info = course.information_revision;
      if (info.id !== revision || info.status !== 'draft' || info.edit_revision !== expected)
        throw new ApiError('资料草稿已改变或正在审核。', 409);
      info.information_snapshot = copy(input);
      info.edit_revision++;
      return copy(course);
    },
    async draft(id) {
      requireRole('teacher', 'admin');
      return copy(drafts.get(id)!);
    },
    async saveDraft(id, value) {
      requireRole('teacher', 'admin');
      const draft = drafts.get(id)!;
      if (draft.revision !== value.revision) throw new ApiError('草稿已变化，请重新读取。', 409);
      draft.units = copy(value.units).map((unit) => ({ ...unit, id: unit.id || ++counter }));
      for (const unit of draft.units) unitRecords.set(unit.id!, { courseId: id, unit: copy(unit) });
      draft.revision++;
      return copy(draft);
    },
    async releases(id) {
      requireRole('teacher', 'admin');
      return copy(releaseHistory.get(id) || []);
    },
    async publish(id, revision) {
      requireRole('teacher');
      const course = find(id),
        draft = drafts.get(id)!;
      if (course.information_revision.status !== 'approved' || !draft.units.length)
        throw new ApiError('课程资料须审核通过，且至少包含一个学习单元。', 409);
      if (revision !== draft.revision) throw new ApiError('草稿版本已改变。', 409);
      const versions = releaseHistory.get(id) || [];
      if (versions.at(-1)?.draft_revision === revision) throw new ApiError('当前草稿已经发布。', 409);
      const published = release(course, draft);
      versions.push(published);
      releaseHistory.set(id, versions);
      course.has_published_content = true;
      return { release: copy(published) };
    },
    async currentRelease(id) {
      const course = find(id),
        release = releaseHistory.get(id)?.at(-1);
      if (!release) throw new ApiError('课程尚未发布。', 404);
      if (role() === 'student' && !course.active_student_count) throw new ApiError('请先加入课程。', 403);
      const result = copy(release);
      if (role() === 'student') {
        const plan = plans.get(`${id}:1`);
        result.units = result.units.filter(
          (unit) =>
            plan?.items.find((item) => item.course_unit_id === unit.source_course_unit_id)?.release_mode !==
            'hidden',
        );
        for (const unit of result.units) {
          const item = plan?.items.find((item) => item.course_unit_id === unit.source_course_unit_id);
          const locked =
            item &&
            (item.release_mode === 'locked' ||
              (item.open_at && new Date(item.open_at) > new Date()) ||
              (item.prerequisite_unit_id && !completed.has(`${id}:${item.prerequisite_unit_id}`)));
          unit.access_state = locked ? 'locked' : 'open';
          if (locked) unit.content.blocks = [];
          for (const block of unit.content.blocks) {
            delete block.correctChoiceIds;
            delete block.acceptedAnswers;
            delete block.numericAnswer;
          }
        }
      }
      return { release: result };
    },
    async enrollments(id, offset = 0) {
      requireRole('teacher', 'admin');
      return page(enrollmentRows(id), offset, 100);
    },
    async joinRequests(id, offset = 0) {
      requireRole('teacher', 'admin');
      return page(
        joins.filter((item) => item.course_id === id && item.status === 'pending'),
        offset,
        100,
      );
    },
    async reviewJoin(id, request, status) {
      requireRole('teacher', 'admin');
      const item = joins.find((item) => item.id === request && item.course_id === id)!;
      item.status = status;
      if (status === 'approved') find(id).active_student_count++;
      return copy(item);
    },
    async removeEnrollment(id) {
      requireRole('teacher', 'admin');
      find(id).active_student_count = 0;
    },
    async discover(code) {
      const item = courses.find((item) => item.course_code === code.toUpperCase());
      if (!item) throw new ApiError('没有找到这个课程邀请码。', 404);
      return {
        course_id: item.id,
        course_code: item.course_code!,
        title: item.title,
        summary: item.summary,
        teachers: [{ display_name: '陈老师' }],
        can_request:
          item.active_student_count === 0 &&
          !joins.some((request) => request.course_id === item.id && request.status === 'pending'),
        eligibility_reason:
          item.active_student_count > 0
            ? 'already_enrolled'
            : joins.some((request) => request.course_id === item.id && request.status === 'pending')
              ? 'pending_request'
              : 'eligible',
        eligible_source_classes: classes.map((item) => ({ class_id: item.id, name: item.name })),
      };
    },
    async requestCourse(id, _, message) {
      const item: T.JoinRequest = {
        id: ++counter,
        course_id: id,
        student_id: 2,
        display_name: '星序同学',
        source_class_name: '探索一班',
        status: 'pending',
        message,
        created_at: new Date().toISOString(),
      };
      joins.push(item);
      return copy(item);
    },
    async assignments(id) {
      return copy(assignments.filter((item) => assignmentCourse(item).id === id));
    },
    async createAssignment(id, unit_id, input) {
      requireRole('teacher');
      find(id);
      const item = { ...input, id: ++counter, unit_id };
      assignments.push(item);
      return copy(item);
    },
    async studentAssignments(filter, offset = 0) {
      requireRole('student');
      let items = studentRows();
      if (filter === 'feedback')
        items = items.filter((item) => ['graded', 'returned'].includes(item.submission?.status || ''));
      if (filter === 'history') items = items.filter((item) => item.assignment.status !== 'active');
      if (filter === 'active') items = items.filter((item) => item.assignment.status === 'active');
      return page(items, offset);
    },
    async submitAssignment(id, class_id, answer) {
      requireRole('student');
      const row = studentRows().find((item) => item.assignment.id === id);
      if (!row || row.class.id !== class_id) throw new ApiError('没有找到本班的作业。', 404);
      if (!row.can_submit) throw new ApiError('当前提交不可修改。', 409);
      const item: T.Submission = {
        id: ++counter,
        assignment_id: id,
        student_id: 2,
        class_id,
        content: { answer },
        status: 'submitted',
        score: null,
        feedback: null,
        submitted_at: new Date().toISOString(),
        graded_at: null,
      };
      submissions.push(item);
      return copy(item);
    },
    async submissions(id, classId, offset = 0) {
      requireRole('teacher', 'admin');
      return page(
        submissions
          .filter((item) => item.assignment_id === id && (!classId || classId === item.class_id))
          .reverse(),
        offset,
        100,
      );
    },
    async grade(id, score, feedback, status) {
      requireRole('teacher', 'admin');
      const item = submissions.find((item) => item.id === id);
      if (!item) throw new ApiError('没有找到提交。', 404);
      const assignment = assignments.find((a) => a.id === item.assignment_id)!;
      if (score > assignment.max_score) throw new ApiError('分数不能超过满分。', 422);
      Object.assign(item, { score, feedback, status, graded_at: new Date().toISOString() });
      return copy(item);
    },
    async releasePlan(course_id, class_id) {
      const key = `${course_id}:${class_id}`;
      let value = plans.get(key);
      if (!value) {
        value = {
          course_id,
          class_id,
          plan_version: 1,
          items: drafts.get(course_id)!.units.map((unit) => ({
            course_unit_id: unit.id!,
            activity_key: unit.activity_key,
            position: unit.position,
            release_mode: 'open',
            open_at: null,
            prerequisite_unit_id: null,
          })),
        };
        plans.set(key, value);
      }
      return copy(value);
    },
    async saveReleasePlan(plan) {
      requireRole('teacher', 'admin');
      const key = `${plan.course_id}:${plan.class_id}`,
        current = plans.get(key);
      if (!current || current.plan_version !== plan.plan_version) throw new ApiError('开放计划已改变。', 409);
      const next = { ...copy(plan), plan_version: plan.plan_version + 1 };
      plans.set(key, next);
      return copy(next);
    },

    async teacherApplications(offset = 0) {
      requireRole('admin');
      return page(
        teacherRequests.filter((item) => item.status === 'pending'),
        offset,
      );
    },
    async applyTeacher(message) {
      const item: T.TeacherApplication = {
        id: ++counter,
        user_id: 2,
        applicant_username: 'student',
        applicant_display_name: '星序同学',
        applicant_role: 'student',
        status: 'pending',
        message,
        review_note: null,
      };
      teacherRequests.push(item);
      return copy(item);
    },
    async reviewTeacher(id, status, note) {
      requireRole('admin');
      const item = teacherRequests.find((item) => item.id === id)!;
      item.status = status;
      item.review_note = note;
      return copy(item);
    },
    async courseReviews(offset = 0) {
      requireRole('admin');
      return page(
        courses
          .filter((item) => item.information_revision.status === 'submitted')
          .map((item) => ({
            revision: copy(item.information_revision),
            course_id: item.id,
            proposed_information: {
              ...copy(item.information_revision.information_snapshot),
              school_id: item.school_id,
              collaborator_user_ids: [],
            },
            changed_fields: ['title', 'summary', 'schedule_text'],
            current_information: null,
          })),
        offset,
      );
    },
    async reviewCourse(id, status, note) {
      requireRole('admin');
      const course = courses.find((item) => item.information_revision.id === id)!;
      course.information_revision.status = status as T.Information['status'];
      course.information_revision.review_note = note;
      if (status === 'approved') {
        Object.assign(course, copy(course.information_revision.information_snapshot));
        course.status = 'published';
        course.course_code ||= `ASTRA${String(course.id).padStart(3, '0')}`;
      }
      return copy(course);
    },
    async adminUsers(offset = 0) {
      requireRole('admin');
      return page(users, offset, 100);
    },
    async updateUser(id, patch) {
      requireRole('admin');
      const user = users.find((item) => item.id === id)!;
      Object.assign(user, patch);
      return copy(user);
    },
    async checkpoint(courseId, unitId, key, payload) {
      requireRole('student');
      const release = releaseHistory.get(courseId)?.find((item) => item.id === payload.course_release_id);
      const block = release?.units
        .find((unit) => unit.source_course_unit_id === unitId)
        ?.content.blocks.find((item) => item.checkpointKey === key);
      if (!block) throw new ApiError('检查点版本不可用。', 409);
      const is_correct =
        block.responseType === 'numeric'
          ? Math.abs(Number(payload.numeric_answer) - Number(block.numericAnswer)) <= (block.tolerance || 0)
          : block.responseType === 'short-text'
            ? (block.acceptedAnswers || []).includes(String(payload.text_answer))
            : JSON.stringify([...((payload.selected_choice_ids as string[]) || [])].sort()) ===
              JSON.stringify([...(block.correctChoiceIds || [])].sort());
      if (is_correct) completed.add(`${courseId}:${unitId}`);
      return { is_correct, completed: is_correct, remaining_attempts: null };
    },
  };
}
