import type { StudyGateway } from './study-types';
import type * as D from './workflow-types';
import type * as T from './contracts';
import type { ResourceGateway, ResourcePage, ResourceVersionRead, FunctionGraphConfig } from './resource-types';
import type { View } from '../domain/models';
import { learningLevels } from '../domain/learning-spaces';
import { frontendAsset } from '../services/environment';
import { stableJson } from '../domain/course-sync';
import { resourcePreviewMarkup } from './resource-preview';
import { e, empty, field, selectField, when } from './presentation';
import { readSettings, settingsForm, unitForm, type TeachingOptions } from './course-composer';
import { blankUnit, readUnit, toWriteUnit } from '../domain/course-unit-draft';
import { CandidateWorkspace, snapshotPage } from './candidate-workspace';
import { SubmissionWorkspace } from './submission-workspace';
import { PortalWorkspace } from './workspace';
import { flowButton as button, WorkflowView } from './workflow-view';

interface Options {
  study: StudyGateway;
  role: T.Role;
  userId: number;
  demo: boolean;
  activities: T.Activity[];
  notify(message: string): void;
  navigate(view: View, id?: number): void;
  changed(): Promise<void>;
}
const tabs = [['editor', '内容编排'], ['settings', '课程设置'], ['submit', '送审与同步'], ['candidates', '审核与发布'], ['versions', '历史版本'], ['students', '学生'], ['assignments', '作业'], ['plan', '开放计划']];

/** One authoring owner; the existing class/assignment modules are mounted by responsibility. */
export class CourseStudio extends WorkflowView {
  private course?: D.CourseWorkflowRead;
  private draft?: D.CourseDraftReadV2;
  private settings!: D.CourseSettings;
  private units: D.CourseUnitWrite[] = [];
  private selected = 0;
  private tab = 'editor';
  private schools: T.School[] = [];
  private teaching: TeachingOptions = { teachers: [], homerooms: [] };
  private assignments: T.Assignment[] = [];
  private versions: T.Release[] = [];
  private resourceVersions = new Map<number, ResourceVersionRead>();
  private resourcesPage?: ResourcePage;
  private mediaPage?: D.CourseMediaPage;
  private mediaOffset = 0;
  private resourceOffset = 0;
  private resourceKind = 'template';
  private syncBase?: number | null;
  private formChanged = false;
  private legacyUnits = 0;
  private child?: CandidateWorkspace | SubmissionWorkspace | PortalWorkspace;

  constructor(root: HTMLElement, private api: D.WorkflowGateway, private school: T.SchoolGateway, private resources: ResourceGateway, private options: Options, private courseId?: number) {
    super(root, options.notify);
    root.addEventListener('click', (event) => {
      const target = (event.target as Element).closest<HTMLElement>('[data-resource]');
      if (!target) return;
      event.preventDefault(); event.stopPropagation();
      void this.run(() => this.parameterAction(target));
    }, { signal: this.lifecycle.signal });
    root.addEventListener('input', (event) => {
      const input = event.target as HTMLInputElement;
      if (input.closest('[data-flow-form="unit"], [data-flow-form="settings"]')) this.formChanged = true;
      if (input.dataset.resourceParameter !== undefined) {
        const output = this.root.querySelector<HTMLInputElement>(`[name="value_${Number(input.dataset.resourceParameter)}"]`);
        if (output) output.value = input.value;
      }
    }, { signal: this.lifecycle.signal });
    root.addEventListener('change', (event) => {
      const target = event.target as HTMLInputElement;
      if (target.name === 'school_id' && !this.course) void this.run(async () => { this.settings = readSettings(new FormData(target.form!)); await this.loadTeaching(); this.paintSettings(); });
    }, { signal: this.lifecycle.signal });
  }
  mount(): void { void this.run(() => this.load()); }
  override hasChanges(): boolean { return super.hasChanges() || Boolean(this.child?.hasChanges()); }
  override canLeave(): boolean { return (!this.child || this.child.canLeave()) && super.canLeave(); }
  override destroy(): void { this.child?.destroy(); super.destroy(); }

  private async load(): Promise<void> {
    if (this.courseId) {
      [this.course, this.draft] = await Promise.all([this.api.course(this.courseId), this.api.draft(this.courseId)]);
      this.acceptDraft(this.draft);
      this.syncBase = this.draft.revision_id;
      this.assignments = await this.school.assignments(this.courseId);
      if (this.options.role === 'admin') this.tab = 'candidates';
      await this.showTab();
    } else {
      this.schools = await this.school.schools();
      const year = new Date().getFullYear();
      this.settings = { school_id: this.schools[0]?.id || 0, title: '', summary: '', academic_year: `${year}—${year + 1}`, schedule_text: '', total_hours: 24, galaxy_key: 'englab', subject_key: 'mathematics', admission_mode: 'open', level_key: null, collaborator_user_ids: [], admission_class_ids: [] };
      await this.loadTeaching(); this.paintSettings();
    }
  }

  private acceptDraft(draft: D.CourseDraftReadV2): void {
    this.draft = draft; this.settings = structuredClone(draft.settings);
    this.legacyUnits = draft.units.filter((unit) => !unit.content).length;
    this.units = draft.units.map((unit) => toWriteUnit(unit, draft.settings));
    draft.resources.forEach((resource) => this.resourceVersions.set(resource.id, resource));
    this.selected = Math.min(this.selected, Math.max(0, this.units.length - 1));
    this.dirty = false;
  }

  private header(): string {
    if (!this.course) return `<header class="portal-heading"><div><h1>创建课程</h1><p>先建立独立的教学课程，再组织单元与资源。</p></div>${button('返回课程', 'back')}</header>`;
    const teacher = this.options.role === 'teacher';
    return `<header class="portal-heading"><div><h1>${e(this.settings.title)}</h1><p>${this.course.course_code ? `邀请码 ${e(this.course.course_code)} · ` : ''}草稿修订 ${this.draft?.revision ?? 0}${this.dirty ? ' · 有未保存修改' : ''}</p></div><div class="portal-actions">${button('返回课程', 'back')}${teacher ? button('建立独立教学版本', 'fork') : ''}${button('重新读取', 'reload')}</div></header><nav class="portal-tabs" aria-label="课程管理">${tabs.filter(([key]) => teacher || ['candidates', 'versions'].includes(key)).map(([key, title]) => button(title, 'tab', `data-tab="${key}" aria-current="${this.tab === key ? 'page' : 'false'}"`)).join('')}</nav>`;
  }

  private clearChild(): void { this.child?.destroy(); this.child = undefined; }
  private paintBody(body: string): void { this.clearChild(); this.paint(this.header() + body); }
  private currentResource(): ResourceVersionRead | undefined {
    const block = this.units[this.selected]?.content.blocks.find((item) => item.type === 'resource');
    return block ? this.resourceVersions.get(block.resourceVersionId) : undefined;
  }
  private capture(): void {
    if (!this.formChanged) return;
    const settings = this.root.querySelector<HTMLFormElement>('[data-flow-form="settings"]');
    if (settings) { this.settings = readSettings(new FormData(settings)); this.formChanged = false; return; }
    const form = this.root.querySelector<HTMLFormElement>('[data-flow-form="unit"]');
    if (!form) return;
    const current = this.units[this.selected];
    const next = readUnit(current, new FormData(form), this.currentResource());
    if (JSON.stringify(current) !== JSON.stringify(next)) { this.units[this.selected] = next; this.dirty = true; }
    this.formChanged = false;
  }

  private async loadTeaching(): Promise<void> {
    if (!this.schools.length) this.schools = await this.school.schools();
    this.teaching = this.settings.school_id ? await this.school.authoringOptions(this.settings.school_id) : { teachers: [], homerooms: [] };
    this.teaching.teachers = this.teaching.teachers.filter((teacher) => teacher.user_id !== (this.course?.creator_user_id || this.options.userId));
  }
  private paintSettings(): void { this.formChanged = false; this.paintBody(settingsForm(this.settings, this.schools, this.teaching, Boolean(this.course), !this.course || this.course.creator_user_id === this.options.userId)); }
  private paintEditor(): void {
    this.formChanged = false;
    const unit = this.units[this.selected];
    this.paintBody(`${this.legacyUnits ? `<p class="portal-note">${this.legacyUnits} 个旧单元尚未编排正文。请补齐资源、讲解与完成条件；保存后才会更新草稿。</p>` : ''}<div class="portal-editor"><aside class="portal-unit-list">${this.units.map((item, index) => button(`${index + 1} · ${item.title}`, 'select-unit', `data-index="${index}" aria-current="${index === this.selected ? 'page' : 'false'}"`)).join('')}${button('＋ 添加单元', 'add-unit')}</aside><div>${unit ? `<div class="portal-actions">${button('上移', 'move-unit', 'data-step="-1"')}${button('下移', 'move-unit', 'data-step="1"')}${button('移除单元', 'remove-unit')}</div>${unitForm(unit, this.currentResource(), this.assignments)}` : `<section class="portal-surface">${empty('从一个问题开始，添加第一个学习单元。')}${button('添加单元', 'add-unit', '', true)}</section>`}</div></div>`);
  }

  private async showTab(): Promise<void> {
    if (this.tab === 'editor') { this.assignments = await this.school.assignments(this.course!.id); this.paintEditor(); return; }
    if (this.tab === 'settings') { await this.loadTeaching(); this.paintSettings(); return; }
    if (this.tab === 'versions') {
      this.versions = await this.school.releases(this.course!.id);
      this.paintBody(`<section class="portal-surface"><h2>不可变发布历史</h2>${this.versions.slice().sort((a, b) => b.release_number - a.release_number).map((release) => `<div class="portal-list-row"><span><strong>第 ${release.release_number} 版 · ${e(release.title)}</strong><small>${when(release.published_at)} · ${release.units.length} 个单元</small></span><div class="portal-actions">${button('查看内容', 'view-version', `data-id="${release.id}"`)}${button('与草稿比较', 'compare-version', `data-id="${release.id}"`)}${this.options.role === 'teacher' && this.course?.creator_user_id === this.options.userId ? button('从此版建立新修订', 'restore', `data-id="${release.id}"`) : ''}</div></div>`).join('') || empty('通过审核并发布后，这里会保存每一版内容。')}</section>`); return;
    }
    this.paintBody('<div data-course-section></div>');
    const host = this.root.querySelector<HTMLElement>('[data-course-section]')!;
    if (this.tab === 'candidates') {
      this.child = new CandidateWorkspace(host, this.api, this.options.role, this.options.notify, this.course!.id, async () => { this.course = await this.api.course(this.course!.id); this.acceptDraft(await this.api.draft(this.course.id)); await this.options.changed(); });
      this.child.mount();
    } else if (this.tab === 'submit') {
      this.child = new SubmissionWorkspace(host, this.api, this.course!, this.options.userId, this.options.notify, async () => { this.tab = 'candidates'; await this.showTab(); }, this.syncBase);
      this.child.mount();
    } else {
      this.child = new PortalWorkspace(host, this.school, { ...this.options, resources: this.resources, workflow: this.api, courseSectionsOnly: true });
      this.child.mount('course', this.course!.id, '', this.tab);
    }
  }

  private async save(after: () => Promise<void> = async () => {}): Promise<void> {
    this.capture();
    const payload = { expected_revision: this.draft!.revision, expected_state_token: this.draft!.state_token, settings: this.settings, units: this.units };
    await this.write(payload, (command) => this.api.save(this.course!.id, command), async (draft) => { this.acceptDraft(draft); this.options.notify('课程草稿已保存。'); await after(); });
  }

  private async gallery(): Promise<void> {
    this.resourcesPage = await this.resources.list('', this.resourceKind, this.resourceOffset);
    this.paintBody(`<header class="portal-heading"><h2>选择交互资源</h2>${button('返回单元', 'editor')}</header><form data-flow-form="resource-filter" class="resource-filters">${selectField('内容类型', 'kind', [{ value: 'template', label: '可配置模板' }, { value: 'activity', label: '原有交互活动' }], this.resourceKind)}<button type="submit" class="quiet-button">筛选</button></form><div class="resource-list">${this.resourcesPage.items.map((resource) => `<button type="button" class="resource-row" data-flow="use-resource" data-id="${resource.id}"><span>${resource.kind === 'template' ? '模板' : '活动'}</span><strong>${e(resource.title)}</strong><small>第 ${resource.version_number} 版</small></button>`).join('') || empty('尚未载入系统资源，请由管理员在资源目录初始化。')}</div><div class="portal-actions">${button('上一页', 'resource-previous', this.resourceOffset ? '' : 'disabled')}${button('下一页', 'resource-next', this.resourcesPage.next_offset === null ? 'disabled' : '')}</div>`);
  }

  private async previewUnit(): Promise<void> {
    const unit = this.units[this.selected], resource = this.currentResource();
    const block = unit.content.blocks.find((item) => item.type === 'resource');
    let interactive = '';
    if (resource && block) {
      const preview = await this.resources.preview(resource.id, block.configuration || {});
      const entry = String(preview.view.entry || '');
      if (resource.renderer === 'legacy' || resource.renderer === 'bundle') {
        if (!entry.startsWith('labs/') || /[\\\s]|(?:^|\/)\.\.(?:\/|$)/.test(entry)) throw new Error('资源入口不可用。');
        interactive = `<iframe class="portal-experiment-frame" src="${e(frontendAsset(entry))}" title="${e(resource.title)}"></iframe>`;
      } else interactive = resourcePreviewMarkup(preview);
    }
    this.paintBody(`<header class="portal-heading"><h2>教师预览 · ${e(unit.title)}</h2>${button('返回编辑', 'editor')}</header><p class="portal-note">预览不产生学生成绩。</p><section class="portal-surface">${interactive}${snapshotPage(unit.content, (key) => this.api.mediaUrl(this.course!.id, key))}</section>`);
  }

  private async mediaGallery(): Promise<void> {
    this.mediaPage = await this.api.media(this.course!.id, this.mediaOffset);
    this.paintBody(`<header class="portal-heading"><h2>本课程已上传素材</h2>${button('返回编辑', 'editor')}</header><section class="portal-surface"><form data-flow-form="attach-media">${selectField('选择文件', 'asset_key', this.mediaPage.items.map((item) => ({ value: item.asset_key, label: `${item.filename} · ${Math.ceil(item.size_bytes / 1024)} KiB` })), this.mediaPage.items[0]?.asset_key || '', true)}${field('在当前单元中的说明', 'alt', '', { required: true, max: 500 })}<button class="primary-button" type="submit" ${this.mediaPage.items.length ? '' : 'disabled'}>加入当前单元</button></form>${this.mediaPage.items.length ? '' : empty('还没有上传素材。')}</section><div class="portal-actions">${button('上一页', 'media-previous', this.mediaOffset ? '' : 'disabled')}${button('下一页', 'media-next', this.mediaPage.next_offset === null ? 'disabled' : '')}</div>`);
  }

  private showVersion(id: number, compare: boolean): void {
    const release = this.versions.find((release) => release.id === id);
    if (!release) throw new Error('请重新读取发布历史。');
    const original = new Map(release.units.map((unit) => [unit.source_course_unit_id, unit]));
    const current = new Map(this.units.filter((unit) => unit.id).map((unit) => [unit.id!, unit]));
    const keys = compare ? [...new Set([...original.keys(), ...current.keys()])] : [...original.keys()];
    const semantic = (page: object | null | undefined) => { if (!page) return ''; const { version: _version, status: _status, ...value } = page as D.ContentPageV2; return stableJson(value); };
    // The retained v1 release transport returns canonical v2 bodies to teachers.
    const render = (page: T.ContentPage | D.ContentPageV2 | null | undefined) => snapshotPage(page as D.ContentPageV2 | null || null, (key) => this.api.mediaUrl(this.course!.id, key));
    this.paintBody(`<header class="portal-heading"><h2>第 ${release.release_number} 版${compare ? '与当前草稿的比较' : ' · 只读预览'}</h2>${button('返回历史列表', 'tab', 'data-tab="versions"')}</header>${keys.map((key) => {
      const before = original.get(key), after = current.get(key);
      const status = !before ? '新增' : !after ? '当前草稿已移除' : before.title === after.title && before.position === after.position && semantic(before.content) === semantic(after.content) ? '无内容变化' : '内容或顺序已调整';
      return `<details class="portal-surface workflow-difference" ${compare ? '' : 'open'}><summary>${e(after?.title || before?.title || '')}${compare ? ` · ${status}` : ''}</summary>${compare ? `<div class="portal-columns"><section><h3>历史发布版</h3>${render(before?.content)}</section><section><h3>当前草稿</h3>${render(after?.content)}</section></div>` : render(before?.content)}</details>`;
    }).join('')}`);
  }

  protected async click(target: HTMLElement): Promise<void> {
    const action = target.dataset.flow;
    if (this.child && !this.child.canLeave()) return;
    if (action === 'back') { if (!super.hasChanges() || this.allowReload()) this.options.navigate('courses'); return; }
    if (action === 'reload') { if (this.allowReload()) await this.load(); return; }
    this.capture();
    if (action === 'tab') {
      const next = target.dataset.tab!;
      if (this.dirty) { if (!confirm('切换前保存当前课程草稿？')) return; await this.save(async () => { this.tab = next; await this.showTab(); }); }
      else { this.tab = next; await this.showTab(); }
    } else if (action === 'add-unit') { this.units.push(blankUnit(this.settings, this.units.length + 1)); this.selected = this.units.length - 1; this.dirty = true; this.paintEditor(); }
    else if (action === 'select-unit') { this.selected = Number(target.dataset.index); this.paintEditor(); }
    else if (action === 'editor') this.paintEditor();
    else if (action === 'choose-resource') { this.resourceOffset = 0; await this.gallery(); }
    else if (action === 'choose-media') { this.mediaOffset = 0; await this.mediaGallery(); }
    else if (action === 'media-previous' || action === 'media-next') { this.mediaOffset = action === 'media-previous' ? Math.max(0, this.mediaOffset - 25) : this.mediaPage?.next_offset ?? 0; await this.mediaGallery(); }
    else if (action === 'resource-previous' || action === 'resource-next') { this.resourceOffset = action === 'resource-previous' ? Math.max(0, this.resourceOffset - 24) : this.resourcesPage?.next_offset ?? 0; await this.gallery(); }
    else if (action === 'use-resource') {
      const resource = await this.resources.version(Number(target.dataset.id)); this.resourceVersions.set(resource.id, resource);
      const unit = this.units[this.selected], previous = unit.content.blocks.find((block) => block.type === 'resource');
      const block: D.ResourceBlock = { blockId: previous?.blockId || `resource-${crypto.randomUUID()}`, type: 'resource', title: resource.title, resourceVersionId: resource.id, configuration: structuredClone(resource.definition.configuration || {}) as D.ResourceBlock['configuration'], instructions: previous?.instructions || '改变条件，比较结果，并尝试解释。' };
      if (previous) unit.content.blocks[unit.content.blocks.indexOf(previous)] = block;
      else unit.content.blocks.push(block);
      unit.resource_version_id = resource.id; this.dirty = true; this.paintEditor();
    } else if (action === 'remove-resource') {
      const unit = this.units[this.selected], index = unit.content.blocks.findIndex((block) => block.type === 'resource');
      if (index >= 0) unit.content.blocks.splice(index, 1);
      unit.resource_version_id = unit.content.blocks.find((block) => block.type === 'resource')?.resourceVersionId || null;
      this.dirty = true; this.paintEditor();
    } else if (action === 'preview-unit') await this.previewUnit();
    else if (action === 'view-version' || action === 'compare-version') this.showVersion(Number(target.dataset.id), action === 'compare-version');
    else if (action === 'move-unit' || action === 'remove-unit') {
      if (action === 'remove-unit') { if (!confirm('移出当前草稿？发布历史和学习结果仍然保留。')) return; this.units.splice(this.selected, 1); this.selected = Math.max(0, this.selected - 1); }
      else { const index = this.selected + Number(target.dataset.step); if (index < 0 || index >= this.units.length) return; const [unit] = this.units.splice(this.selected, 1); this.units.splice(index, 0, unit); this.selected = index; }
      this.units.forEach((unit, index) => { unit.position = index + 1; if (unit.content.courseUnit) unit.content.courseUnit.order = index + 1; });
      this.dirty = true; this.paintEditor();
    } else if (action === 'remove-media') { this.units[this.selected].content.blocks = this.units[this.selected].content.blocks.filter((block) => block.blockId !== target.dataset.key); this.dirty = true; this.paintEditor(); }
    else if (action === 'fork') {
      if (this.dirty) { await this.save(async () => this.paintFork()); } else this.paintFork();
    } else if (action === 'restore') {
      if (!confirm('把选中发布版恢复为新的草稿修订？当前未保存修改将被替换，之后仍需送审。')) return;
      await this.write({ expected_revision: this.draft!.revision, expected_state_token: this.draft!.state_token, release_id: Number(target.dataset.id) }, (command) => this.api.restore(this.course!.id, command), async (draft) => { this.acceptDraft(draft); this.tab = 'editor'; this.paintEditor(); this.options.notify('已建立回滚草稿，原发布与成绩保持可追溯。'); });
    }
  }

  private async paintFork(): Promise<void> {
    this.paintBody(`<section class="portal-surface"><h2>建立独立教学版本</h2><p>共享内容来源，但拥有独立课程、授课对象和版本历史；学生与成绩不复制。</p><form data-flow-form="fork">${field('新教学版本名称', 'title', `${this.settings.title} · 新教学版本`, { required: true, max: 180 })}${selectField('学习层次', 'level_key', [{ value: '', label: '暂不限定' }, ...learningLevels.map((level) => ({ value: level.key, label: level.title }))], '')}<p class="portal-note">新课程先采用校内可申请设置，请在发布前配置自己的授课范围。</p><button class="primary-button" type="submit">创建独立版本</button></form></section>`);
  }

  private async parameterAction(target: HTMLElement): Promise<void> {
    this.capture();
    const block = this.units[this.selected].content.blocks.find((item) => item.type === 'resource');
    if (!block || this.currentResource()?.renderer !== 'function-graph-v1') return;
    const config = block.configuration as FunctionGraphConfig;
    const parameters = config.parameters ||= [];
    if (target.dataset.resource === 'remove-parameter') parameters.splice(Number(target.dataset.index), 1);
    if (target.dataset.resource === 'add-parameter') {
      if (parameters.length >= 8) throw new Error('最多定义 8 个参数。');
      const key = 'abcdfghijklmnopqrstuvwyz'.split('').find((key) => !parameters.some((parameter) => parameter.key === key))!;
      parameters.push({ key, label: `参数 ${key}`, value: 1, minimum: -5, maximum: 5, step: .1 });
    }
    this.dirty = true; this.paintEditor();
  }

  protected async submit(form: HTMLFormElement, data: FormData): Promise<void> {
    const kind = form.dataset.flowForm;
    if (kind === 'settings') {
      this.settings = readSettings(data);
      if (this.course) await this.save(async () => { this.paintSettings(); });
      else await this.write(this.settings, (command) => this.api.create(command), async (course) => { this.courseId = course.id; this.course = course; this.acceptDraft(await this.api.draft(course.id)); this.tab = 'editor'; await this.options.changed(); this.options.navigate('course', course.id); });
    } else if (kind === 'unit') await this.save(async () => this.paintEditor());
    else if (kind === 'resource-filter') { this.resourceKind = String(data.get('kind') || 'template'); this.resourceOffset = 0; await this.gallery(); }
    else if (kind === 'fork') {
      const settings = { ...this.settings, title: String(data.get('title') || '').trim(), level_key: String(data.get('level_key') || '') || null, collaborator_user_ids: [], admission_mode: 'open' as const, admission_class_ids: [] };
      await this.write({ settings, expected_source_revision: this.draft!.revision }, (command) => this.api.fork(this.course!.id, command), async (result) => { this.options.notify('独立教学版本已创建，请核对课程设置与完成条件。'); await this.options.changed(); this.options.navigate('course', result.course.id); });
    } else if (kind === 'upload') {
      this.capture();
      const file = data.get('file');
      if (!(file instanceof File) || !file.size || file.size > 12 * 1024 * 1024) throw new Error('请选择不超过 12 MiB 的素材文件。');
      const alt = String(data.get('alt') || '').trim();
      await this.write({ filename: file.name, alt }, (command) => this.api.upload(this.course!.id, file, command.client_request_id), async (asset) => { this.units[this.selected].content.blocks.push({ blockId: `media-${crypto.randomUUID()}`, type: 'media', mediaType: asset.media_type, assetKey: asset.asset_key, title: asset.filename, alt, caption: alt }); this.dirty = true; this.paintEditor(); this.options.notify('素材已上传，请保存草稿以保留单元编排。'); });
    } else if (kind === 'attach-media') {
      const asset = this.mediaPage?.items.find((item) => item.asset_key === data.get('asset_key'));
      if (!asset) throw new Error('请选择本页已登记的素材。');
      const alt = String(data.get('alt') || '').trim();
      this.units[this.selected].content.blocks.push({ blockId: `media-${crypto.randomUUID()}`, type: 'media', mediaType: asset.media_type, assetKey: asset.asset_key, title: asset.filename, alt, caption: alt });
      this.dirty = true; this.paintEditor();
    }
  }
}
