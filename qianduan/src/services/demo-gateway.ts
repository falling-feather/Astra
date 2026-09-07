import type { LearningGateway, Note, Session } from '../domain/models';
import type { Role } from '../portal/contracts';
import activities from 'virtual:astra-catalog';
import { createSchoolDemo } from './school-demo';
import { presentCourse } from './course-presentation';
import { ApiError } from './http-client';

const SESSION_KEY = 'astra.qianduan.demo-session';

export function createDemoGateway(): LearningGateway {
  let session: Session | null = null;
  const noteStore = new Map<Role, Note[]>();
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    const saved = raw ? JSON.parse(raw) : null;
    if (saved?.source === 'demo' && typeof saved.displayName === 'string')
      session = {
        displayName: saved.displayName.slice(0, 120),
        role: ['student', 'teacher', 'admin'].includes(saved.role) ? saved.role : 'student',
        source: 'demo',
        kind: 'guest',
        userId: saved.role === 'teacher' ? 1 : saved.role === 'admin' ? 3 : 2,
      };
  } catch {
    /* Storage can be unavailable; the demonstration still runs in memory. */
  }
  const role = (): Role => session?.role || 'student';
  const school = createSchoolDemo(role, activities);
  function save(value: Session | null) {
    session = value;
    try {
      if (value) sessionStorage.setItem(SESSION_KEY, JSON.stringify(value));
      else sessionStorage.removeItem(SESSION_KEY);
    } catch {
      /* No credentials or learning bodies are persisted. */
    }
  }
  function notes() {
    let result = noteStore.get(role());
    if (!result) {
      result = [];
      noteStore.set(role(), result);
    }
    return result;
  }
  const enter = async (selected: Role = 'student') => {
    const value: Session = {
      displayName: selected === 'teacher' ? '陈老师' : selected === 'admin' ? '学校管理员' : '星序同学',
      role: selected,
      kind: 'guest',
      source: 'demo',
      userId: selected === 'teacher' ? 1 : selected === 'admin' ? 3 : 2,
    };
    save(value);
    return { ...value };
  };
  return {
    mode: 'demo',
    school,
    async getSession() {
      return session ? { ...session } : null;
    },
    async signIn(name, password) {
      if (!name.trim() || !password) throw new ApiError('请填写演示账号和密码。');
      const value = await enter('student');
      value.displayName = name.trim().slice(0, 120);
      save(value);
      return { ...value };
    },
    enterAsGuest: enter,
    async register() {
      throw new ApiError('静态演示不创建真实账号，请选择演示身份。');
    },
    async signOut() {
      save(null);
    },
    async updateDisplayName(name) {
      if (!session || !name.trim()) throw new ApiError('请填写显示名称。');
      save({ ...session, displayName: name.trim().slice(0, 120) });
      return { ...session! };
    },
    async getCourses() {
      const result = await school.workbench();
      return (result.courses?.items || []).map(presentCourse);
    },
    async getTasks() {
      if (role() !== 'student') return [];
      const result = await school.studentAssignments('active');
      return result.items.map((item) => ({
        id: `${item.assignment.id}:${item.class.id}`,
        assignmentId: item.assignment.id,
        classId: item.class.id,
        courseId: String(item.course.id),
        title: item.assignment.title,
        description: item.assignment.description || '',
        due: item.assignment.due_at || '',
        completed: Boolean(item.submission && item.submission.status !== 'returned'),
      }));
    },
    async getNotes(offset = 0) {
      return structuredClone(notes().slice(offset, offset + 50));
    },
    async createNote() {
      const note: Note = {
        id: crypto.randomUUID(),
        title: '未命名笔记',
        content: '',
        revision: 1,
        modified: new Date().toISOString().slice(0, 10),
      };
      notes().unshift(note);
      return { ...note };
    },
    async saveNote(note) {
      const existing = notes().find((item) => item.id === note.id);
      if (!existing) throw new ApiError('笔记不存在。', 404);
      if (existing.revision !== note.revision) throw new ApiError('笔记已变化，请重新读取。', 409);
      Object.assign(existing, {
        ...note,
        title: note.title.trim() || '未命名笔记',
        revision: existing.revision! + 1,
        modified: new Date().toISOString().slice(0, 10),
      });
      return { ...existing };
    },
    async deleteNote(note) {
      const list = notes(),
        index = list.findIndex((item) => item.id === note.id);
      if (index < 0) throw new ApiError('笔记不存在。', 404);
      if (list[index].revision !== note.revision) throw new ApiError('笔记已变化，请重新读取。', 409);
      list.splice(index, 1);
    },
  };
}
