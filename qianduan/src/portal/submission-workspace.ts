import type * as D from './workflow-types';
import { area, e, selectField, when } from './presentation';
import { flowButton as button, WorkflowView } from './workflow-view';

const changeLabel = { ready: '可同步', conflict: '需要决定', skipped: '跳过', unchanged: '已是新值' };

/** A preview is a proposal. Only the final command creates review candidates. */
export class SubmissionWorkspace extends WorkflowView {
  private draft!: D.CourseDraftReadV2;
  private targets: D.CourseWorkflowRead[] = [];
  private revisions!: D.CourseRevisionPageRead;
  private shown?: D.SubmissionPreviewRead;
  private command?: D.SubmissionPreviewCommand;

  constructor(root: HTMLElement, private api: D.WorkflowGateway, private course: D.CourseWorkflowRead, private userId: number, notify: (text: string) => void, private submitted: () => Promise<void>, private initialBase?: number | null) {
    super(root, notify);
  }
  mount(): void { void this.run(() => this.load()); }

  private async load(): Promise<void> {
    const [draft, courses, revisions] = await Promise.all([this.api.draft(this.course.id), this.api.courses(), this.api.revisions(this.course.id)]);
    this.draft = draft; this.revisions = revisions;
    this.targets = this.course.creator_user_id === this.userId ? courses.filter((course) => course.id !== this.course.id && course.creator_user_id === this.userId && course.family_id !== null && course.family_id === this.course.family_id && course.status !== 'archived') : [];
    this.shown = undefined;
    const options = revisions.items.filter((revision) => revision.revision_number < draft.revision);
    this.paint(`<header class="portal-heading"><div><h1>提交课程审核</h1><p>当前草稿第 ${draft.revision} 次修订。先确认差异和旧结果处理方式，再提交。</p></div>${button('重新读取', 'reload')}</header><form data-flow-form="preview" class="portal-surface">${this.targets.length ? `<h2>同步本人名下的教学版本（可选）</h2><p class="portal-note">只更新已有公共内容；课程名称、章节增删、排序、名单与各课完成规则分别维护。</p>${selectField('这次公共内容修改之前的修订', 'base_revision_id', [{ value: '', label: '本次不进行跨课同步' }, ...options.map((revision) => ({ value: revision.id, label: `修订 ${revision.revision_number} · ${when(revision.created_at)}` }))], this.initialBase || options[0]?.id || '')}${revisions.next_offset !== null ? button('查看更早修订', 'more-revisions') : ''}<div class="portal-checks">${this.targets.map((course) => `<label class="portal-checkbox"><input type="checkbox" name="target" value="${course.id}"/>${e(course.draft_settings.title)}</label>`).join('')}</div>` : '<p>本次仅提交当前课程。派生出本人名下的其他教学版本后，可以在这里选择公共内容同步。</p>'}<button class="primary-button" type="submit">生成差异预览</button></form>`);
  }

  private paintPreview(): void {
    const shown = this.shown!;
    this.paint(`<header class="portal-heading"><div><h1>核对本次修改</h1><p>尚未修改其他课程，也未改变学生正在学习的版本。</p></div>${button('重新选择课程', 'back')}</header><form data-flow-form="submit"><section class="portal-surface">${shown.courses.map((course) => `<article class="workflow-course-impact"><h2>${e(course.title)}</h2>${course.pending_review_id ? '<p class="portal-error">这门课已有待审候选；请先处理或撤回。</p>' : ''}${course.course_id !== this.course.id ? `<p class="portal-note">这里只传播下面列出的公共内容；该课已存在的其他草稿修改也会一并送审。</p>${course.changes.map((change) => `<div class="workflow-change"><strong>${e(change.unit_title)} · ${changeLabel[change.status]}</strong><p>${e(change.reason || '')}</p>${change.status === 'conflict' ? selectField('如何处理这处差异', `conflict:${change.key}`, [{ value: '', label: '请选择' }, { value: 'keep', label: '保留目标课程的修改' }, { value: 'replace', label: '采用这次公共内容修改' }], this.command?.conflict_choices?.[change.key] || '') : ''}${change.after ? `<details><summary>查看具体差异</summary><div class="portal-columns"><div><h4>目标当前内容</h4><pre>${e(JSON.stringify(change.current ?? change.before, null, 2))}</pre></div><div><h4>这次公共修改</h4><pre>${e(JSON.stringify(change.after, null, 2))}</pre></div></div></details>` : ''}</div>`).join('') || '<p>没有公共内容差异；这门课会跳过。</p>'}` : ''}<h3>相对于本课发布版的影响</h3>${course.impact.units.map((unit) => `<div class="workflow-result-policy"><span>${e(unit.title)} · ${{ added: '新增', modified: '已修改', unchanged: '无变化' }[unit.change]}</span>${unit.decision_required ? selectField('旧结果如何处理', `result:${course.course_id}:${unit.unit_id}`, [{ value: '', label: '请明确选择' }, { value: 'keep', label: '认可已有结果' }, { value: 'redo', label: '要求学生补做' }], '') : `<small>${unit.default_policy === 'redo' ? '新版需要完成学习' : '保留已有结果'}</small>`}</div>`).join('')}${course.impact.removed_units.map((unit) => `<p>${e(unit.title)} · 本版移除，历史成绩保留。</p>`).join('')}</article>`).join('')}</section>${shown.courses.some((course) => course.changes.some((change) => change.status === 'conflict')) ? `<p class="portal-note">调整冲突选择后，请重新计算差异，核对学习结果影响。</p>${button('更新差异预览', 'resolve')}` : ''}<section class="portal-surface">${area('本次修改说明', 'note', '')}<button class="primary-button" type="submit">确认并一次提交</button></section></form>`);
  }

  private choices(form: HTMLFormElement): Record<string, 'keep' | 'replace'> {
    const result: Record<string, 'keep' | 'replace'> = {};
    for (const [key, value] of new FormData(form)) if (key.startsWith('conflict:') && (value === 'keep' || value === 'replace')) result[key.slice(9)] = value;
    return result;
  }

  protected async click(target: HTMLElement): Promise<void> {
    if (target.dataset.flow === 'back' || target.dataset.flow === 'reload') { if (this.allowReload()) await this.load(); return; }
    if (target.dataset.flow === 'more-revisions' && this.revisions.next_offset !== null) {
      this.revisions = await this.api.revisions(this.course.id, this.revisions.next_offset);
      this.root.querySelector('select[name="base_revision_id"]')?.insertAdjacentHTML('beforeend', this.revisions.items.filter((revision) => revision.revision_number < this.draft.revision).map((revision) => `<option value="${revision.id}">修订 ${revision.revision_number} · ${when(revision.created_at)}</option>`).join(''));
      if (this.revisions.next_offset === null) target.remove();
    }
    if (target.dataset.flow === 'resolve') {
      const form = this.root.querySelector<HTMLFormElement>('[data-flow-form="submit"]')!;
      this.command = { ...this.command!, conflict_choices: this.choices(form) };
      this.shown = await this.api.preview(this.course.id, this.command);
      this.paintPreview();
    }
  }

  protected async submit(form: HTMLFormElement, data: FormData): Promise<void> {
    if (form.dataset.flowForm === 'preview') {
      const targets = data.getAll('target').map(Number);
      this.command = { source_revision: this.draft.revision, source_state_token: this.draft.state_token, target_course_ids: targets, base_revision_id: targets.length ? Number(data.get('base_revision_id')) || null : null, conflict_choices: {} };
      this.shown = await this.api.preview(this.course.id, this.command);
      this.paintPreview(); return;
    }
    const choices = this.choices(form);
    const conflicts = this.shown!.courses.flatMap((course) => course.changes.filter((change) => change.status === 'conflict'));
    if (conflicts.some((change) => !choices[change.key])) throw new Error('请处理全部冲突，再更新差异预览。');
    if (Object.keys(choices).some((key) => choices[key] !== this.command?.conflict_choices?.[key])) throw new Error('冲突选择已变化，请先更新差异预览。');
    const policies: Record<string, Record<string, 'keep' | 'redo'>> = {};
    for (const [key, value] of data) if (key.startsWith('result:')) {
      if (value !== 'keep' && value !== 'redo') throw new Error('请明确选择认可旧结果还是要求补做。');
      const [, course, unit] = key.split(':'); (policies[course] ||= {})[unit] = value;
    }
    await this.write({ ...this.command!, preview_token: this.shown!.preview_token, result_policies: policies, note: String(data.get('note') || '').trim() || null }, (command) => this.api.submit(this.course.id, command), async (result) => { this.notify(`已提交 ${result.items.length} 门课程审核${result.skipped.length ? `，${result.skipped.length} 门无需同步` : ''}。`); await this.submitted(); });
  }
}
