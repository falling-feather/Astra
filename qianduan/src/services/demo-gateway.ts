import type { Course, DemoSession, LearningGateway, LearningTask } from '../domain/models';
import { addDays, dateKey } from '../domain/calendar';

const SESSION_KEY = 'astra.qianduan.demo-session';

export const DEMO_COURSES: Course[] = [
  { id: 'functions', title: '函数与变化', subject: '数学', teacher: '陈老师', color: '#70d5e4', secondary: '#193f75', schedule: { weekday: 0, start: '09:00', end: '10:30', room: '思学楼 A201' }, completed: 4, lessons: 12, description: '从一条曲线出发，理解变化背后的秩序。', chapters: ['观察函数的形状', '参数如何改变曲线', '从变化率走向导数'] },
  { id: 'mechanics', title: '力与运动', subject: '物理', teacher: '林老师', color: '#b7b9ea', secondary: '#44436e', schedule: { weekday: 2, start: '09:00', end: '10:30', room: '理学楼 B203' }, completed: 2, lessons: 10, description: '让看不见的力，在一次次实验中变得清晰。', chapters: ['运动的语言', '力的合成与分解', '寻找能量的去向'] },
  { id: 'decisions', title: '概率与决策', subject: '数学', teacher: '苏老师', color: '#ba9ce7', secondary: '#574375', schedule: { weekday: 4, start: '10:45', end: '12:00', room: '思学楼 A305' }, completed: 1, lessons: 8, description: '在不确定的世界里，练习有依据地作出选择。', chapters: ['随机并不意味着无序', '理解收益与风险', '合作与竞争的选择'] },
  { id: 'algorithms', title: '算法入门', subject: '代码', teacher: '周老师', color: '#78ccb3', secondary: '#235749', schedule: { weekday: 1, start: '10:45', end: '12:00', room: '信息楼 C302' }, completed: 3, lessons: 12, description: '把复杂的问题，拆成能够一步步理解的过程。', chapters: ['从问题到步骤', '看见数据的流动', '比较不同解法'] },
  { id: 'life', title: '生命系统', subject: '生物', teacher: '许老师', color: '#d7b57a', secondary: '#80603f', schedule: { weekday: 3, start: '14:00', end: '15:30', room: '理学楼 B105' }, completed: 0, lessons: 9, description: '从微小的细胞，走近彼此联系的生命世界。', chapters: ['细胞中的协作', '信息如何传递', '系统与环境'] },
  { id: 'chemistry', title: '化学反应', subject: '化学', teacher: '叶老师', color: '#83b6e1', secondary: '#315175', schedule: { weekday: 4, start: '14:00', end: '15:30', room: '实验楼 D206' }, completed: 2, lessons: 10, description: '在微观粒子的相遇中，发现物质变化的秘密。', chapters: ['粒子的相遇', '反应快慢的秘密', '观察可逆变化'] },
];

function cleanName(name: string): string {
  const result = name.trim().slice(0, 24);
  if (!result) throw new Error('请输入你的账号或昵称。');
  return result;
}

/** Only a presentation session is stored. No password, token, or learning body. */
export function createDemoGateway(): LearningGateway {
  let session: DemoSession | null = null;
  const done = new Set<string>();
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    const saved: unknown = raw ? JSON.parse(raw) : null;
    if (saved && typeof saved === 'object' && 'source' in saved && saved.source === 'demo' && 'displayName' in saved && typeof saved.displayName === 'string') {
      session = { displayName: cleanName(saved.displayName), kind: 'kind' in saved && saved.kind === 'guest' ? 'guest' : 'member', source: 'demo' };
    }
  } catch { /* Private browsing can deny storage; memory still supports the flow. */ }

  function save(value: DemoSession | null): void {
    session = value;
    try {
      if (value) sessionStorage.setItem(SESSION_KEY, JSON.stringify(value));
      else sessionStorage.removeItem(SESSION_KEY);
    } catch { /* Keep the current in-memory session. */ }
  }

  return {
    async getSession() { return session ? { ...session } : null; },
    async signIn(name, password) {
      if (password.length < 4) throw new Error('演示密码至少填写 4 个字符。');
      const value: DemoSession = { displayName: cleanName(name), kind: 'member', source: 'demo' };
      done.clear();
      save(value);
      return { ...value };
    },
    async enterAsGuest() {
      const value: DemoSession = { displayName: '星序同学', kind: 'guest', source: 'demo' };
      done.clear();
      save(value);
      return { ...value };
    },
    async signOut() { done.clear(); save(null); },
    async updateDisplayName(name) {
      if (!session) throw new Error('请先进入星序。');
      save({ ...session, displayName: cleanName(name) });
      return { ...session! };
    },
    async getCourses() { return structuredClone(DEMO_COURSES); },
    async getTasks() {
      const now = new Date();
      const tasks: LearningTask[] = [
        { id: 'task-curves', courseId: 'functions', title: '寻找曲线中的变化规律', description: '观察三组函数图像，记下参数变化时你发现的规律。', due: `${dateKey(addDays(now, 1))}T20:00:00`, completed: done.has('task-curves') },
        { id: 'task-force', courseId: 'mechanics', title: '完成一次力的合成实验', description: '调整两组力的方向与大小，比较你的预测和实验结果。', due: `${dateKey(addDays(now, 2))}T18:00:00`, completed: done.has('task-force') },
        { id: 'task-trace', courseId: 'algorithms', title: '追踪一次排序的过程', description: '从六个数字开始，解释每一步交换为什么发生。', due: `${dateKey(addDays(now, 4))}T21:00:00`, completed: done.has('task-trace') },
      ];
      return tasks;
    },
    async completeTask(id) {
      if (!['task-curves', 'task-force', 'task-trace'].includes(id)) throw new Error('没有找到这项任务。');
      done.add(id);
    },
  };
}
