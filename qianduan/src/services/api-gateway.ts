import { serverTime } from '../domain/time';
import type { Course, LearningGateway, LearningTask, Note, Session } from '../domain/models';
import type { Role, Workbench } from '../portal/contracts';
import type { ResourceVersionRead } from '../portal/resource-types';
import { HttpClient, ApiError } from './http-client';
import { createSchoolApi } from './school-api';
import { createResourceApi } from './resource-api';
import { createStudyApi } from './study-api';
import { createWorkflowApi } from './workflow-api';
import { presentCourse } from './course-presentation';

interface UserDto {
  id: number;
  display_name: string;
  role: Role;
  status: string;
}
interface NoteDto {
  id: number;
  title: string;
  content: string;
  revision: number;
  updated_at: string;
}
const noteView = (note: NoteDto): Note => ({
  id: String(note.id),
  title: note.title,
  content: note.content,
  revision: note.revision,
  modified: serverTime(note.updated_at).toLocaleDateString('zh-CN'),
});
function sessionView(user: UserDto): Session {
  if (!user || !Number.isInteger(user.id) || !['student', 'teacher', 'admin'].includes(user.role))
    throw new ApiError('账号返回信息不完整，请重新登录。');
  return {
    userId: user.id,
    displayName: user.display_name,
    role: user.role,
    kind: 'member',
    source: 'server',
  };
}

const spaceAppearance: Record<string, { color: string; secondary: string }> = {
  englab: { color: '#70d5e4', secondary: '#20384f' },
  'code-space': { color: '#78ccb3', secondary: '#203f3c' },
  'future-galaxy': { color: '#b7b9ea', secondary: '#322d58' },
};

function systemResourceCourse(resource: ResourceVersionRead): Course {
  const appearance = spaceAppearance[resource.space_key] || { color: '#a6b3e9', secondary: '#2d315b' };
  const provenance = resource.provenance as { observation?: unknown; model?: unknown };
  return {
    id: `resource:${resource.id}`,
    title: resource.title,
    teacher: '系统资源',
    subject: resource.subject_key,
    color: appearance.color,
    secondary: appearance.secondary,
    galaxyKey: resource.space_key,
    subjectKey: resource.subject_key,
    scheduleText: '系统预设 · 可交互资源',
    schedule: { weekday: -1, start: '', end: '', room: '' },
    completed: 0,
    lessons: 1,
    description:
      (typeof provenance.observation === 'string' && provenance.observation) ||
      (typeof provenance.model === 'string' && provenance.model) ||
      '系统预设的可交互学习资源。',
    chapters: [],
  };
}

export function createApiGateway(base = '/api'): LearningGateway {
  const client = new HttpClient(base),
    school = createSchoolApi(client),
    resources = createResourceApi(client);
  let session: Session | null = null;
  return {
    mode: 'api',
    school,
    resources,
    workflow: createWorkflowApi(client),
    study: createStudyApi(client),
    async getSession() {
      try {
        session = sessionView(await client.request<UserDto>('/users/me'));
        return session;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    async signIn(username, password) {
      const response = await client.request<{ user: UserDto }>('/auth/login', 'POST', { username, password });
      session = sessionView(response.user);
      return session;
    },
    async register(username, display_name, password) {
      await client.request('/auth/register', 'POST', { username, display_name, password, role: 'student' });
    },
    async enterAsGuest() {
      throw new ApiError('真实服务模式请使用账号登录。');
    },
    async signOut() {
      await client.request('/auth/logout', 'POST');
      session = null;
    },
    async updateDisplayName(display_name) {
      session = sessionView(await client.request<UserDto>('/users/me', 'PATCH', { display_name }));
      return session;
    },
    async getCourses(): Promise<Course[]> {
      if (!session) return [];
      if (session.role === 'teacher') {
        const courses = await school.teacherCourses();
        return courses.map((course) =>
          presentCourse({
            course_id: course.id,
            title: course.title,
            galaxy_key: course.galaxy_key,
            subject_key: course.subject_key,
            schedule_text: course.schedule_text,
            summary: course.summary,
            teacher_display_name: course.teachers.map((teacher) => teacher.display_name).join('、'),
          }),
        );
      }
      if (session.role === 'admin') {
        const [catalogue, schoolCourses] = await Promise.all([
          client.request<{ items: ResourceVersionRead[] }>('/admin/catalogue/preview'),
          client.request<
            { id: number; title: string; galaxy_key: string; subject_key: string; summary: string | null }[]
          >('/courses'),
        ]);
        return [
          ...catalogue.items.map(systemResourceCourse),
          ...schoolCourses.map((course) => presentCourse({ ...course, course_id: course.id })),
        ];
      }
      const response: Workbench = await client.request('/v1/workbench?scope=current&limit=1&offset=0');
      if (response.section_errors.some((issue) => issue.section === 'courses'))
        throw new ApiError('课程目录暂时不可用，请稍后重试。');
      if (!response.courses) throw new ApiError('课程目录返回格式不正确。');
      return response.courses.items.map(presentCourse);
    },
    async getTasks(): Promise<LearningTask[]> {
      if (session?.role !== 'student') return [];
      const page = await school.studentAssignments('active');
      return page.items.map((item) => ({
        id: `${item.assignment.id}:${item.class.id}`,
        assignmentId: item.assignment.id,
        classId: item.class.id,
        courseId: String(item.course.id),
        title: item.assignment.title,
        description: item.assignment.description || '',
        due: item.assignment.due_at || '',
        completed: item.submission !== null && item.submission.status !== 'returned',
      }));
    },
    async getNotes(offset = 0) {
      return (await client.request<NoteDto[]>(`/users/me/notes?limit=50&offset=${offset}`)).map(noteView);
    },
    async createNote() {
      return noteView(
        await client.request<NoteDto>('/users/me/notes', 'POST', { title: '未命名笔记', content: '' }),
      );
    },
    async saveNote(note) {
      return noteView(
        await client.request<NoteDto>(`/users/me/notes/${encodeURIComponent(note.id)}`, 'PATCH', {
          title: note.title.trim() || '未命名笔记',
          content: note.content,
          expected_revision: note.revision,
        }),
      );
    },
    async deleteNote(note) {
      await client.request(
        `/users/me/notes/${encodeURIComponent(note.id)}?expected_revision=${note.revision}`,
        'DELETE',
      );
    },
  };
}
