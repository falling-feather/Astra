import type * as T from '../portal/contracts';
import { HttpClient } from './http-client';

export function createSchoolApi(client: HttpClient): T.SchoolGateway {
  const get = <V>(path: string) => client.request<V>(path);
  const post = <V>(path: string, value?: unknown) => client.request<V>(path, 'POST', value);
  const patch = <V>(path: string, value: unknown) => client.request<V>(path, 'PATCH', value);
  return {
    myTeacherApplication: () => get('/v1/teacher-applications/me'),
    authoringOptions: (id) => get(`/v1/courses/authoring-options?school_id=${id}`),
    courseClasses: (id) => get(`/courses/${id}/classes`),
    workbench: () => get('/v1/workbench?limit=20'),
    schools: () => get('/schools'),
    createSchool: (name) => post('/schools', { name }),
    classes: () => get('/classes'),
    createClass: (school_id, name, grade, term) => post('/classes', { school_id, name, grade, term }),
    members: (id, offset = 0) => get(`/classes/${id}/members/page?limit=100&offset=${offset}`),
    classRequests: (id) => get(`/classes/${id}/join-requests`),
    requestClass: (id, role, message) =>
      post(`/classes/${id}/join-requests`, { role: role === 'admin' ? 'teacher' : role, message }),
    reviewClass: (id, request, status) => patch(`/classes/${id}/join-requests/${request}`, { status }),
    teacherCourses: () => get('/v1/courses'),
    course: (id) => get(`/v1/courses/${id}`),
    createCourse: (input) => post('/v1/courses', input),
    reviseCourse: (id, input) => post(`/v1/courses/${id}/information-revisions`, input),
    submitInformation: (id, revision) => post(`/v1/courses/${id}/information-revisions/${revision}/submit`),
    editInformation: (id, revision, expected_revision, input) =>
      patch(`/v1/courses/${id}/information-revisions/${revision}`, { ...input, expected_revision }),
    draft: (id) => get(`/v1/courses/${id}/draft`),
    saveDraft: (id, draft) =>
      patch(`/v1/courses/${id}/draft`, {
        expected_revision: draft.revision,
        units: draft.units.map((unit) => ({
          ...(unit.id ? { id: unit.id } : {}),
          activity_key: unit.activity_key,
          title: unit.title,
          position: unit.position,
          content: unit.content,
        })),
      }),
    releases: (id) => get(`/v1/courses/${id}/releases`),
    publish: (id, expected_revision, note) => post(`/v1/courses/${id}/releases`, { expected_revision, note }),
    currentRelease: (id) => get(`/v1/courses/${id}/releases/current`),
    enrollments: (id, offset = 0) => get(`/v1/courses/${id}/enrollments?limit=100&offset=${offset}`),
    joinRequests: (id, offset = 0) => get(`/v1/courses/${id}/join-requests?limit=100&offset=${offset}`),
    reviewJoin: (id, request, status) => patch(`/v1/courses/${id}/join-requests/${request}`, { status }),
    removeEnrollment: (id, enrollment) =>
      patch(`/v1/courses/${id}/enrollments/${enrollment}`, { status: 'left' }),
    discover: (code) => get(`/v1/courses/by-code/${encodeURIComponent(code.trim())}`),
    requestCourse: (id, source_class_id, message) =>
      post(`/v1/courses/${id}/join-requests`, { source_class_id, message }),
    assignments: (id) => get(`/courses/${id}/assignments`),
    createAssignment: (id, unit, input) => post(`/courses/${id}/units/${unit}/assignments`, input),
    studentAssignments: (filter, offset = 0) =>
      get(`/assignments/me?filter=${encodeURIComponent(filter)}&offset=${offset}&limit=50`),
    submitAssignment: (id, class_id, answer) =>
      post(`/assignments/${id}/submissions`, { class_id, content: { answer } }),
    submissions: (id, classId, offset = 0) =>
      get(
        `/assignments/${id}/submissions/page?limit=100&offset=${offset}${classId ? `&class_id=${classId}` : ''}`,
      ),
    grade: (id, score, feedback, status) => patch(`/submissions/${id}/grade`, { score, feedback, status }),
    releasePlan: (course, group) => get(`/courses/${course}/classes/${group}/release-plan`),
    saveReleasePlan: (plan) =>
      patch(`/courses/${plan.course_id}/classes/${plan.class_id}/release-plan`, {
        expected_version: plan.plan_version,
        items: plan.items.map(
          ({ course_unit_id, position, release_mode, open_at, prerequisite_unit_id }) => ({
            course_unit_id,
            position,
            release_mode,
            open_at,
            prerequisite_unit_id,
          }),
        ),
      }),
    teacherApplications: (offset = 0) =>
      get(`/v1/admin/teacher-applications?status=pending&limit=50&offset=${offset}`),
    applyTeacher: (message) => post('/v1/teacher-applications', { message }),
    reviewTeacher: (id, status, note) => patch(`/v1/admin/teacher-applications/${id}`, { status, note }),
    courseReviews: (offset = 0) =>
      get(`/v1/admin/course-information-revisions?status=submitted&limit=50&offset=${offset}`),
    reviewCourse: (id, status, note) =>
      patch(`/v1/admin/course-information-revisions/${id}`, { status, note }),
    adminUsers: (offset = 0) => get(`/admin/users?limit=100&offset=${offset}`),
    updateUser: (id, value) => patch(`/admin/users/${id}`, value),
    checkpoint: (course, unit, key, payload) =>
      post(`/v1/courses/${course}/units/${unit}/checkpoints/${encodeURIComponent(key)}/attempts`, payload),
  };
}
