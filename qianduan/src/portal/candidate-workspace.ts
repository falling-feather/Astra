import type * as D from './workflow-types';
import type { Role } from './contracts';
import { area, badge, e, empty, human, selectField, when } from './presentation';
import { markdown } from '../ui/markdown';
import { learningLevels } from '../domain/learning-spaces';
import { flowButton as button, WorkflowView } from './workflow-view';

const settingNames: Record<string, string> = { collaborator_authority: '当前共同教师授权', current_admission_authority: '当前班级准入', title: '课程名称', summary: '课程简介', academic_year: '学年', schedule_text: '上课时间', total_hours: '课时', galaxy_key: '学习空间', subject_key: '学科', admission_mode: '加入方式', admission_class_ids: '允许加入的班级', collaborator_user_ids: '共同教师', level_key: '学习层次', school_id: '学校' };
const valueText = (value: unknown): string => value === null || value === undefined ? '未设置' : Array.isArray(value) ? value.map(valueText).join('、') || '无' : typeof value === 'object' ? JSON.stringify(value) : String(value);
const settingValue = (name: string, value: unknown, labels: Record<string, Record<string, string>> = {}): string => {
  if (name === 'school_id') return labels.schools?.[String(value)] || valueText(value);
  if (['collaborator_user_ids', 'admission_class_ids', 'current_admission_authority'].includes(name) && Array.isArray(value)) return value.map((id) => labels[name === 'collaborator_user_ids' ? 'users' : 'classes']?.[String(id)] || `编号 ${id}`).join('、') || '无';
  if (name === 'collaborator_authority' && Array.isArray(value)) return value.map((item) => `${labels.users?.[String(item.user_id)] || `教师 ${item.user_id}`}（${({ editor: '共同授课', content_editor: '内容编辑', assessment_editor: '评价', viewer: '只读' } as Record<string, string>)[item.role] || item.role}）`).join('、') || '无';
  if (typeof value !== 'string') return valueText(value);
  if (name === 'level_key') return learningLevels.find((level) => level.key === value)?.title || value;
  if (name === 'admission_mode') return value === 'open' ? '校内学生可申请' : '指定班级可申请';
  return ['galaxy_key', 'subject_key'].includes(name) ? human(value) : value;
};

export function snapshotPage(page: D.ContentPageV2 | null, mediaUrl?: (key: string) => string): string {
  if (!page) return empty('此版本没有内容');
  return page.blocks.map((block) => {
    const title = 'title' in block && block.title ? `<h4>${e(block.title)}</h4>` : '';
    switch (block.type) {
      case 'hero': return `${title}<p>${e(block.summary)}</p>`;
      case 'rich-text': return title + markdown(block.markdown);
      case 'learning-task': return `${title}<p>${e(block.prompt)}</p><ol>${(block.steps || []).map((step) => `<li>${e(step)}</li>`).join('')}</ol>`;
      case 'checkpoint': return `${title}<p>${e(block.prompt)}</p><ol>${(block.choices || []).map((choice) => `<li>${e(choice.label)}${block.correctChoiceIds?.includes(choice.choiceId) ? ' ✓' : ''}</li>`).join('')}</ol>${block.responseType === 'numeric' ? `<p>参考答案 ${block.numericAnswer} · 容差 ${block.tolerance ?? 0}</p>` : block.responseType === 'short-text' ? `<p>参考答案：${e((block.acceptedAnswers || []).join(' / '))}</p>` : ''}`;
      case 'resource': {
        const config = block.configuration || {};
        if ('formula' in config) return `${title}<p>函数：y = ${e(config.formula)}</p><p>${e(block.instructions)}</p>`;
        if ('series' in config) return `${title}<p>${e(config.title)}</p><table class="portal-table"><thead><tr><th>类别</th>${config.series.map((series) => `<th>${e(series.name)}</th>`).join('')}</tr></thead><tbody>${config.labels.map((label, index) => `<tr><td>${e(label)}</td>${config.series.map((series) => `<td>${series.values[index]}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
        return `${title}<p>引用第 ${block.resourceVersionId} 号资源版本</p><p>${e(block.instructions)}</p>`;
      }
      case 'media': {
        const url = mediaUrl ? e(mediaUrl(block.assetKey)) : '';
        const content = !url ? `<p>素材：${e(block.alt || block.caption || block.assetKey)}</p>` : block.mediaType === 'image' || block.mediaType === 'diagram' ? `<img class="course-media-image" src="${url}" alt="${e(block.alt || '')}" loading="lazy"/>` : block.mediaType === 'audio' ? `<audio controls preload="metadata" src="${url}"></audio>` : block.mediaType === 'video' ? `<video class="course-media-video" controls preload="metadata" src="${url}"></video>` : `<a class="quiet-button" href="${url}" target="_blank" rel="noopener">下载素材文档 ↗</a>`;
        return `${title}${content}<p>${e(block.caption || '')}</p><p>${e(block.transcript || '')}</p>`;
      }
      case 'official-simulation': return `${title}<p>${e(block.instructions)}</p>`;
      case 'sources': return `${title}<ul>${block.items.map((item) => `<li>${e(item.label)} · ${e(item.url)}</li>`).join('')}</ul>`;
    }
  }).join('');
}

/** The same frozen review page serves the teacher and the school reviewer. */
export class CandidateWorkspace extends WorkflowView {
  private page?: D.CandidatePageRead;
  private detail?: D.CandidateDetailRead;
  private status = '';
  private offset = 0;

  constructor(root: HTMLElement, private api: D.WorkflowGateway, private role: Role, notify: (message: string) => void, private courseId?: number, private changed: () => Promise<void> = async () => {}) {
    super(root, notify);
  }
  mount(): void { void this.run(() => this.load()); }

  private async load(): Promise<void> {
    this.page = await this.api.candidates({ course_id: this.courseId, status: this.status || undefined, offset: this.offset });
    this.detail = undefined; this.dirty = false;
    this.paint(`<header class="portal-heading"><div><h1>${this.role === 'admin' ? '课程审核' : '送审与发布'}</h1><p>每门课程保留独立结论。发布采用通过审核的快照。</p></div>${button('重新读取', 'reload')}</header><form data-flow-form="filter" class="resource-filters">${selectField('审核状态', 'status', [{ value: '', label: '全部状态' }, { value: 'submitted', label: '待审核' }, { value: 'approved', label: '已通过' }, { value: 'rejected', label: '已退回' }, { value: 'withdrawn', label: '已撤回' }], this.status)}<button class="quiet-button" type="submit">筛选</button></form><form data-flow-form="batch"><section class="portal-surface"><div class="portal-table-wrap"><table class="portal-table"><thead><tr><th>选择</th><th>课程</th><th>提交批次</th><th>审核结果</th><th>发布</th><th></th></tr></thead><tbody>${this.page.items.map((item) => `<tr><td><input type="checkbox" name="candidate" value="${item.candidate_id}" aria-label="选择 ${e(item.course_title)} 的候选 ${item.candidate_id}" ${this.eligible(item) ? '' : 'disabled'}/></td><td>${e(item.course_title)}<small> · ${when(item.created_at)}</small></td><td>${item.batch_id}</td><td>${badge(item.status, item.status === 'withdrawn' ? '已撤回' : human(item.status))}</td><td>${item.published_release_id ? '已发布' : '尚未发布'}</td><td>${button('查看差异', 'detail', `data-id="${item.candidate_id}"`)}</td></tr>`).join('')}</tbody></table>${this.page.items.length ? '' : empty('当前没有符合条件的候选。')}</div>${this.role === 'admin' ? area('审核意见', 'note', '') : area('发布说明', 'note', '')}<div class="portal-actions">${this.role === 'admin' ? '<button class="primary-button" type="submit" name="decision" value="approved">通过选中课程</button><button class="quiet-button" type="submit" name="decision" value="rejected">退回选中课程</button>' : '<button class="primary-button" type="submit">发布选中已通过课程</button>'}</div></section></form><div class="portal-actions"><span>共 ${this.page.total} 项</span>${button('上一页', 'previous', this.offset ? '' : 'disabled')}${button('下一页', 'next', this.page.next_offset === null ? 'disabled' : '')}</div>`);
  }

  private eligible(item: D.CandidateSummaryRead): boolean {
    return this.role === 'admin' ? item.status === 'submitted' : this.role === 'teacher' && item.status === 'approved' && item.published_release_id === null;
  }

  private async open(id: number): Promise<void> {
    const item = await this.api.candidate(id); this.detail = item;
    const before = new Map(item.baseline.units.map((unit) => [unit.origin_key, unit]));
    this.paint(`<header class="portal-heading"><div><h1>${e(String(item.snapshot.settings.title || item.course_title))}</h1><p>批次 ${item.batch_id} · 候选 ${item.candidate_id} · ${human(item.status)}${item.stale ? ' · 发布基线已变化，需要重新提交' : ''}</p></div>${button('返回列表', 'back')}</header><section class="portal-surface"><h2>修改来源与结果处理</h2><p>提交教师：${e(item.entity_labels?.users?.[String(item.submitted_by_user_id)] || `教师 ${item.submitted_by_user_id}`)}</p><p>${item.impact.sync && item.impact.sync.source_course_id !== item.course_id ? `来自课程 ${item.impact.sync.source_course_id} 的公共内容同步；以下同时展示目标课程自身的全部修改。` : '本课程草稿送审。'}</p><p>${e(item.note || '未填写提交说明')}</p>${item.review_note ? `<p>审核意见：${e(item.review_note)}</p>` : ''}<dl class="workflow-settings">${item.impact.settings.map((change) => `<dt>${e(settingNames[change.field] || change.field)}</dt><dd>${e(change.before_recorded ? settingValue(change.field, change.before, item.entity_labels) : item.base_release_id ? '旧版未记录' : '首次设置')} → ${e(settingValue(change.field, change.after, item.entity_labels))}</dd>`).join('')}</dl><ul>${item.impact.units.map((unit) => `<li>${e(unit.title)} · ${{ added: '新增', modified: '已修改', unchanged: '无变化' }[unit.change]} · ${item.result_policies[String(unit.unit_id)] === 'redo' ? '新版需要完成学习' : '沿用有效旧结果'}</li>`).join('')}${item.impact.removed_units.map((unit) => `<li>${e(unit.title)} · 本版移除，历史记录保留</li>`).join('')}</ul></section>${item.snapshot.units.map((unit) => `<details class="portal-surface workflow-difference"><summary>${e(unit.title)} · 查看发布前后内容</summary><div class="portal-columns"><section><h3>原发布版</h3>${snapshotPage(before.get(unit.origin_key)?.content || null, (key) => this.api.mediaUrl(item.course_id, key))}</section><section><h3>本次送审版</h3>${snapshotPage(unit.content, (key) => this.api.mediaUrl(item.course_id, key))}</section></div></details>`).join('')}<section class="portal-surface"><form data-flow-form="single" data-id="${item.candidate_id}">${area(this.role === 'admin' ? '审核意见' : '发布说明', 'note', '')}<div class="portal-actions">${this.eligible(item) && !item.stale ? this.role === 'admin' ? '<button class="primary-button" type="submit" name="decision" value="approved">通过这门课程</button><button class="quiet-button" type="submit" name="decision" value="rejected">退回修改</button>' : '<button class="primary-button" type="submit">发布这个候选</button>' : ''}${this.role === 'teacher' && ['submitted', 'approved'].includes(item.status) && !item.published_release_id ? button('撤回这个候选', 'withdraw', `data-id="${item.candidate_id}"`) : ''}</div></form></section>`);
  }

  protected async click(target: HTMLElement): Promise<void> {
    switch (target.dataset.flow) {
      case 'detail': await this.open(Number(target.dataset.id)); break;
      case 'back': await this.load(); break;
      case 'reload': if (this.allowReload()) await this.load(); break;
      case 'previous': this.offset = Math.max(0, this.offset - 25); await this.load(); break;
      case 'next': this.offset = this.page?.next_offset ?? 0; await this.load(); break;
      case 'withdraw': {
        const candidate = this.detail!;
        await this.write({ expected_version: candidate.review_version }, (command) => this.api.withdraw(candidate.candidate_id, command), async () => { this.notify('候选已撤回，可修改后重新送审。'); await this.load(); });
      }
    }
  }

  protected async submit(form: HTMLFormElement, data: FormData): Promise<void> {
    if (form.dataset.flowForm === 'filter') { this.status = String(data.get('status') || ''); this.offset = 0; await this.load(); return; }
    const items = form.dataset.flowForm === 'single' ? [this.detail!] : (this.page?.items || []).filter((item) => data.getAll('candidate').map(Number).includes(item.candidate_id));
    if (!items.length) throw new Error('请先选择要处理的课程。');
    const note = String(data.get('note') || '').trim() || null;
    if (this.role === 'admin') {
      const decision = String(data.get('decision') || 'approved') as 'approved' | 'rejected';
      await this.write({ items: items.map((item) => ({ review_item_id: item.review_item_id, expected_version: item.review_version })), decision, note }, (command) => this.api.review(command), async () => { this.notify(`已${decision === 'approved' ? '通过' : '退回'} ${items.length} 门课程。`); await this.load(); await this.changed(); });
    } else {
      await this.write({ items: items.map((item) => ({ candidate_id: item.candidate_id, expected_review_version: item.review_version })), note }, (command) => this.api.publish(command), async () => { this.notify(`已发布 ${items.length} 门课程。`); await this.load(); await this.changed(); });
    }
  }
}
