import { serverTime } from '../domain/time';
import type { Course, LearningGateway, LearningTask, Note, Session } from '../domain/models';
import type { Role, Workbench } from '../portal/contracts';
import { HttpClient, ApiError } from './http-client';
import { createSchoolApi } from './school-api';
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

export function createApiGateway(base = '/api'): LearningGateway {
  const client = new HttpClient(base),
    school = createSchoolApi(client);
  let session: Session | null = null;
  return {
    mode: 'api',
    school,
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
        const courses =
          await client.request<
            { id: number; title: string; galaxy_key: string; subject_key: string; summary: string | null }[]
          >('/courses');
        return courses.map((course) => presentCourse({ ...course, course_id: course.id }));
      }
      const courses: Course[] = [];
      let offset: number | null = 0;
      while (offset !== null) {
        const response: Workbench = await client.request(`/v1/workbench?limit=20&offset=${offset}`);
        if (response.section_errors.some((issue) => issue.section === 'courses'))
          throw new ApiError('课程目录暂时不可用，请稍后重试。');
        if (!response.courses) throw new ApiError('课程目录返回格式不正确。');
        courses.push(...response.courses.items.map(presentCourse));
        offset = response.courses.next_offset;
      }
      return courses;
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
