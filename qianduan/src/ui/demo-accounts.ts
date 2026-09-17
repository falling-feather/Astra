import { escapeHtml as e } from './html';

type DemoAccount = {
  role: '管理员' | '教师' | '学生';
  username: string;
  password: string;
  state: string;
};

const accounts: DemoAccount[] = [
  {
    role: '管理员',
    username: 'astra_demo_admin',
    password: 'Astra-9+D$1kx3k&RAd*Nsx&inM2uHC8RaFKAt',
    state: '课程审核、班级与账号管理',
  },
  {
    role: '教师',
    username: 'astra_demo_teacher',
    password: 'Astra-VnX57gBx#reZUNN9LgOzaJ#-_JG50*&-',
    state: '3 门已发布演示课程与 3 个班级',
  },
  {
    role: '学生',
    username: 'astra_demo_student_a',
    password: 'Astra-Demo-A-2026!',
    state: '96 分已批改',
  },
  {
    role: '学生',
    username: 'astra_demo_student_b',
    password: 'Astra-Demo-B-2026!',
    state: '78 分已批改',
  },
  {
    role: '学生',
    username: 'astra_demo_student_c',
    password: 'Astra-Demo-C-2026!',
    state: '作业已退回，等待重交',
  },
  {
    role: '学生',
    username: 'astra_demo_student_d',
    password: 'Astra-Demo-D-2026!',
    state: '已加入课程，尚未提交',
  },
  {
    role: '学生',
    username: 'astra_demo_student',
    password: 'Astra-D%8$BBDP8&b&jG2FiFG=K3B1a%SvK!au',
    state: '历史记录中有 88 分成绩',
  },
];

export function demoAccountsDialog(): string {
  const groups = ['管理员', '教师', '学生'] as const;
  return `<h2 id="dialog-title">本机演示账号</h2><p class="dialog-description">这些账号只属于当前 9002 本机演示站。点击账号卡片即可填入登录表单。</p><div class="demo-account-groups">${groups
    .map(
      role =>
        `<section class="demo-account-group"><h3>${role}</h3><div class="demo-account-list">${accounts
          .filter(account => account.role === role)
          .map(
            account =>
              `<button type="button" class="demo-account-card" data-action="fill-demo-account" data-account="${e(account.username)}" data-password="${e(account.password)}" data-label="${e(account.username)}"><span class="demo-account-card__head"><strong>${e(account.username)}</strong><small>${e(account.state)}</small></span><span class="demo-account-card__password">${e(account.password)}</span><span class="demo-account-card__hint">点击填入 →</span></button>`,
          )
          .join('')}</div></section>`,
    )
    .join('')}</div><p class="demo-account-footnote">账号和成绩均为合成演示数据，不要用于生产环境。</p>`;
}
