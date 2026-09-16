import type { Page } from './contracts';
import { escapeHtml as e } from '../ui/html.ts';
import { serverTime } from '../domain/time.ts';

export { e };
export const label: Record<string, string> = {
  awaiting_release: '待首次发布',
  disabled: '已停用',
  student: '学生',
  teacher: '教师',
  admin: '管理员',
  draft: '草稿',
  submitted: '已提交',
  published: '已发布',
  approved: '已通过',
  rejected: '已退回',
  pending: '待处理',
  active: '正常',
  inactive: '已停用',
  archived: '已归档',
  graded: '已批改',
  returned: '需重交',
  open: '开放',
  locked: '锁定',
  hidden: '隐藏',
  englab: '工科实验室',
  'code-space': '代码空间',
  'future-galaxy': '未来星系',
  mathematics: '数学',
  physics: '物理',
  chemistry: '化学',
  algorithms: '算法',
  biology: '生物',
  'program-start': '程序起步',
  'control-flow': '控制流程',
  'data-functions': '数据与函数',
  'algorithm-thinking': '算法思维',
  'debugging-testing': '调试与测试',
  'challenge-submission': '挑战与提交',
  'earth-space': '地球与宇宙',
  'engineering-systems': '工程应用',
  'data-ai': '数据与 AI',
  'information-technology': '信息技术',
  'materials-science': '材料科学',
  'humanities-futures': '人文探索',
};
export const human = (value: string | undefined) => label[value || ''] || value || '—';
export const when = (value: string | null | undefined) =>
  value
    ? serverTime(value).toLocaleString('zh-CN', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '未设截止';
export const badge = (value: string, text = human(value)) =>
  `<span class="status-text status-${e(value)}">${e(text)}</span>`;
export const button = (text: string, action: string, extra = '', primary = false) =>
  `<button type="button" class="${primary ? 'primary-button' : 'quiet-button'}" data-portal="${action}" ${extra}>${text}</button>`;
export function field(
  title: string,
  name: string,
  value: unknown = '',
  options: { type?: string; required?: boolean; max?: number; min?: number } = {},
): string {
  return `<label class="portal-field"><span>${e(title)}</span><input name="${name}" type="${options.type || 'text'}" value="${e(value ?? '')}" ${options.required ? 'required' : ''} ${options.type === 'number' ? 'step="any"' : ''} ${options.max ? `maxlength="${options.max}"` : ''} ${options.min !== undefined ? `min="${options.min}"` : ''}/></label>`;
}
export function area(title: string, name: string, value: unknown = '', required = false): string {
  return `<label class="portal-field"><span>${e(title)}</span><textarea name="${name}" rows="5" ${required ? 'required' : ''} maxlength="16000">${e(value ?? '')}</textarea></label>`;
}
export function selectField(
  title: string,
  name: string,
  items: { value: string | number; label: string }[],
  value: unknown = '',
  required = false,
  disabled = false,
): string {
  return `<label class="portal-field"><span>${e(title)}</span><select name="${name}" ${required ? 'required' : ''} ${disabled ? 'disabled' : ''}>${items.map((item) => `<option value="${e(item.value)}" ${String(item.value) === String(value) ? 'selected' : ''}>${e(item.label)}</option>`).join('')}</select>${disabled ? `<input type="hidden" name="${name}" value="${e(value)}"/>` : ''}</label>`;
}
export const empty = (text: string) => `<div class="portal-empty">${e(text)}</div>`;
export function submissionText(content: Record<string, unknown>): string {
  for (const key of ['answer', 'report', 'text'])
    if (typeof content[key] === 'string') return content[key] as string;
  return Object.keys(content).length ? JSON.stringify(content, null, 2) : '本次提交没有文字回答。';
}
export function pagination(page: Page<unknown>, collection: string, title: string): string {
  if (page.offset === 0 && page.next_offset === null) return '';
  return `<div class="portal-pagination"><span>${e(title)} · 共 ${page.total} 项</span><div>${page.offset > 0 ? button('上一页', 'paginate', `data-collection="${collection}" data-offset="${Math.max(0, page.offset - page.limit)}"`) : ''}${page.next_offset !== null ? button('下一页', 'paginate', `data-collection="${collection}" data-offset="${page.next_offset}"`) : ''}</div></div>`;
}
