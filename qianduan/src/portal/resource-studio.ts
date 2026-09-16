import type { Role } from './contracts';
import type { DataChartConfig, FunctionGraphConfig, ResourceGateway, ResourcePage, ResourcePreviewRead, ResourceVersionRead, TemplateConfiguration } from './resource-types';
import { learningSpaces } from '../domain/learning-spaces';
import { previewTemplate } from '../domain/template-preview';
import { frontendAsset } from '../services/environment';
import { area, e, field, selectField } from './presentation';
import { resourcePreviewMarkup } from './resource-preview';

/** A resource visit owns its listeners; previews never create course completion. */
export class ResourceStudio {
  private lifecycle = new AbortController();
  private active = true;
  private generation = 0;
  private busy = false;
  private space = '';
  private kind = 'template';
  private offset = 0;
  private page?: ResourcePage;
  private selected?: ResourceVersionRead;
  private lastPreview?: ResourcePreviewRead;
  private configuration: TemplateConfiguration = {};

  constructor(private root: HTMLElement, private api: ResourceGateway, private role: Role) {
    root.addEventListener('click', this.click, { signal: this.lifecycle.signal });
    root.addEventListener('submit', this.submit, { signal: this.lifecycle.signal });
    root.addEventListener('input', this.input, { signal: this.lifecycle.signal });
  }

  mount(): void { void this.list(); }
  destroy(): void { this.active = false; this.generation += 1; this.lifecycle.abort(); }

  private error(error: unknown): void {
    if (!this.active) return;
    let output = this.root.querySelector<HTMLElement>('[data-resource-error]');
    if (!output) {
      this.root.insertAdjacentHTML('afterbegin', '<p class="portal-error" data-resource-error role="alert"></p>');
      output = this.root.querySelector('[data-resource-error]');
    }
    output!.textContent = error instanceof Error ? error.message : '资源读取失败，请重试。';
  }

  private async list(): Promise<void> {
    if (!this.active) return;
    const generation = ++this.generation;
    try {
      const page = await this.api.list(this.space, this.kind, this.offset);
      if (!this.active || generation !== this.generation) return;
      this.page = page; this.selected = undefined;
      this.root.innerHTML = `<div class="portal-view resource-studio"><header class="portal-heading"><div><h1>资源与模板</h1><p>从已有内容出发，组织自己的探索。</p></div>${this.role === 'admin' ? '<button class="quiet-button" data-resource="install">载入系统预设</button>' : ''}</header><form data-resource-filter class="resource-filters">${selectField('学习空间', 'space', [{ value: '', label: '全部空间' }, ...learningSpaces.map((space) => ({ value: space.key, label: space.title }))], this.space)}${selectField('内容类型', 'kind', [{ value: '', label: '全部内容' }, { value: 'template', label: '可配置模板' }, { value: 'activity', label: '预置活动' }], this.kind)}<button class="quiet-button" type="submit">筛选</button></form><p class="portal-note">共 ${page.total} 项 · 自由预览不会产生课程成绩</p><div class="resource-list">${page.items.map((item) => `<button class="resource-row" data-resource="open" data-id="${item.id}"><span class="resource-kind">${item.kind === 'template' ? '模板' : '活动'}</span><span><strong>${e(item.title)}</strong><small>${e(learningSpaces.find((space) => space.key === item.space_key)?.title || item.space_key)} · 第 ${item.version_number} 版</small></span><span aria-hidden="true">↗</span></button>`).join('') || '<p class="portal-empty">暂无资源。首次使用请由管理员载入系统预设。</p>'}</div><div class="portal-actions"><button data-resource="previous" ${this.offset ? '' : 'disabled'}>上一页</button><button data-resource="next" ${page.next_offset === null ? 'disabled' : ''}>下一页</button></div></div>`;
    } catch (error) { if (generation === this.generation) this.error(error); }
  }

  private async open(id: number): Promise<void> {
    const generation = ++this.generation;
    try {
      const resource = await this.api.version(id);
      if (!this.active || generation !== this.generation) return;
      this.selected = resource;
      this.configuration = structuredClone(resource.definition.configuration || {}) as TemplateConfiguration;
      this.paintSelected(await this.api.preview(id, this.configuration));
    } catch (error) { if (generation === this.generation) this.error(error); }
  }

  private paintSelected(preview: ResourcePreviewRead): void {
    if (!this.active || !this.selected || preview.resource_version_id !== this.selected.id) return;
    const resource = this.selected;
    this.lastPreview = preview;
    const legacy = resource.renderer === 'legacy' || resource.renderer === 'bundle';
    const entry = String(preview.view.entry || '');
    if (legacy && (!entry.startsWith('labs/') || /[\\\s]|(?:^|\/)\.\.(?:\/|$)/.test(entry))) throw new Error('资源入口不在已登记的公开目录内。');
    this.root.innerHTML = `<div class="portal-view resource-studio"><button class="quiet-button" data-resource="back">← 返回资源目录</button><header class="portal-heading"><div><h1>${e(resource.title)}</h1><p>第 ${resource.version_number} 版 · 预览中的操作不计入课程成绩</p></div></header>${legacy ? `<a class="quiet-button" href="${e(frontendAsset(entry))}" target="_blank" rel="noopener">独立打开活动 ↗</a><iframe class="portal-experiment-frame" title="${e(resource.title)}" src="${e(frontendAsset(entry))}" allow="fullscreen"></iframe>` : `<div class="resource-editor"><section class="portal-surface"><h2>调整配置</h2><form data-resource-config>${this.fields()}<div class="portal-actions"><button class="primary-button" type="submit">更新预览</button><button type="button" class="quiet-button" data-resource="reset">恢复默认</button></div></form><p class="portal-note">调整配置，观察不同条件下的结果；预览不会修改系统原件。</p></section><section class="portal-surface resource-preview"><div data-resource-plot>${resourcePreviewMarkup(preview)}</div><p class="portal-note">${e(String(resource.provenance.model || '改变条件，比较结果，并尝试解释原因。'))}</p></section></div>`}</div>`;
  }

  private fields(): string {
    if (this.selected?.renderer === 'function-graph-v1') {
      const config = this.configuration as FunctionGraphConfig;
      return `${field('函数表达式', 'formula', config.formula, { required: true, max: 240 })}<p class="portal-note">支持 x、已定义参数、+ − * / ^，以及 sin、cos、abs、sqrt、log、exp。</p><div class="portal-form-grid">${field('横轴起点', 'x_min', config.x_min ?? -5, { type: 'number' })}${field('横轴终点', 'x_max', config.x_max ?? 5, { type: 'number' })}${field('纵轴下界', 'y_min', config.y_min ?? -10, { type: 'number' })}${field('纵轴上界', 'y_max', config.y_max ?? 10, { type: 'number' })}</div><h3>可调参数</h3><div class="resource-parameters">${(config.parameters || []).map((parameter, index) => `<fieldset><legend>${e(parameter.label)}</legend><div class="portal-form-grid">${field('符号', `key_${index}`, parameter.key)}${field('名称', `label_${index}`, parameter.label)}${field('当前值', `value_${index}`, parameter.value, { type: 'number' })}${field('最小值', `minimum_${index}`, parameter.minimum, { type: 'number' })}${field('最大值', `maximum_${index}`, parameter.maximum, { type: 'number' })}${field('步长', `step_${index}`, parameter.step, { type: 'number' })}</div><input type="range" data-resource-parameter="${index}" aria-label="${e(parameter.label)}" min="${parameter.minimum}" max="${parameter.maximum}" step="${parameter.step}" value="${parameter.value}"/><button type="button" class="quiet-button" data-resource="remove-parameter" data-index="${index}">移除参数</button></fieldset>`).join('')}</div><button type="button" class="quiet-button" data-resource="add-parameter">＋ 添加参数</button>`;
    }
    const config = this.configuration as DataChartConfig;
    const rows = [['类别', ...config.series.map((series) => series.name)], ...config.labels.map((label, index) => [label, ...config.series.map((series) => String(series.values[index]))])];
    return `${field('图表标题', 'title', config.title, { required: true })}${selectField('展示方式', 'kind', [{ value: 'bar', label: '柱状图' }, { value: 'line', label: '折线图' }], config.kind || 'bar')}${field('纵轴名称', 'y_label', config.y_label || '')}${area('数据表', 'chart_data', rows.map((row) => row.join('\t')).join('\n'), true)}<p class="portal-note">可以粘贴表格数据：第一行填写列名，第一列填写类别，其余列填写数值；最多 48 行数据、4 组数值。</p>`;
  }

  private readForm(): TemplateConfiguration {
    const form = this.root.querySelector<HTMLFormElement>('[data-resource-config]');
    if (!form || !this.selected) throw new Error('配置表单不可用。');
    const data = new FormData(form), value = (key: string) => String(data.get(key) || '').trim(), numeric = (key: string) => {
      if (!value(key)) throw new Error('请填写完整的数值。');
      return Number(value(key));
    };
    if (this.selected.renderer === 'function-graph-v1') {
      const before = this.configuration as FunctionGraphConfig;
      return { formula: value('formula'), x_min: numeric('x_min'), x_max: numeric('x_max'), y_min: numeric('y_min'), y_max: numeric('y_max'), samples: before.samples ?? 121, parameters: (before.parameters || []).map((_, index) => ({ key: value(`key_${index}`), label: value(`label_${index}`), value: numeric(`value_${index}`), minimum: numeric(`minimum_${index}`), maximum: numeric(`maximum_${index}`), step: numeric(`step_${index}`) })) };
    }
    const lines = value('chart_data').split(/\r?\n/).filter((line) => line.trim());
    const separator = lines[0]?.includes('\t') ? '\t' : ',';
    const rows = lines.map((line) => line.split(separator).map((cell) => cell.trim()));
    if (rows.length < 2 || rows[0].length < 2 || rows.slice(1).some((row) => row.length !== rows[0].length || row.slice(1).some((cell) => !cell))) throw new Error('请提供表头和至少一行数据，各行列数保持一致。');
    return { title: value('title'), kind: value('kind') as 'bar' | 'line', y_label: value('y_label'), labels: rows.slice(1).map((row) => row[0]), series: rows[0].slice(1).map((name, index) => ({ name, values: rows.slice(1).map((row) => Number(row[index + 1])) })) };
  }

  private click = (event: Event): void => {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-resource]');
    if (!target || this.busy) return;
    const action = target.dataset.resource;
    if (action === 'open') { void this.open(Number(target.dataset.id)); return; }
    if (action === 'back') { void this.list(); return; }
    if (action === 'previous' || action === 'next') { this.offset = action === 'previous' ? Math.max(0, this.offset - 24) : this.page?.next_offset ?? 0; void this.list(); return; }
    if (action === 'install') {
      this.busy = true;
      void this.api.install().then(() => this.list()).catch((error) => this.error(error)).finally(() => { this.busy = false; });
      return;
    }
    if (!this.selected) return;
    try {
      if (action === 'reset') this.configuration = structuredClone(this.selected.definition.configuration || {}) as TemplateConfiguration;
      else {
        this.configuration = this.readForm();
        const config = this.configuration as FunctionGraphConfig;
        if (action === 'remove-parameter') config.parameters?.splice(Number(target.dataset.index), 1);
        if (action === 'add-parameter') {
          const parameters = config.parameters ||= [];
          if (parameters.length >= 8) throw new Error('最多定义 8 个参数。');
          const key = 'abcdfghijklmnopqrstuvwyz'.split('').find((candidate) => !parameters.some((parameter) => parameter.key === candidate))!;
          parameters.push({ key, label: `参数 ${key}`, value: 1, minimum: -5, maximum: 5, step: .1 });
        }
      }
      this.paintSelected(previewTemplate(this.selected, this.configuration));
    } catch (error) {
      if (this.lastPreview && this.selected?.id === this.lastPreview.resource_version_id) this.paintSelected(this.lastPreview);
      this.error(new Error(`${error instanceof Error ? error.message : '配置尚未完整'}。画面保留上次有效预览，请修正后更新。`));
    }
  };

  private submit = (event: Event): void => {
    const form = event.target as HTMLFormElement;
    if (form.matches('[data-resource-filter]')) {
      event.preventDefault(); const data = new FormData(form);
      this.space = String(data.get('space') || ''); this.kind = String(data.get('kind') || ''); this.offset = 0; void this.list();
    }
    if (!form.matches('[data-resource-config]')) return;
    event.preventDefault();
    if (!this.selected || this.busy) return;
    try {
      const resource = this.selected, generation = this.generation;
      const configuration = this.readForm();
      this.busy = true;
      void this.api.preview(resource.id, configuration).then((preview) => {
        if (!this.active || generation !== this.generation) return;
        this.configuration = preview.configuration as TemplateConfiguration; this.paintSelected(preview);
      }).catch((error) => this.error(error)).finally(() => { this.busy = false; });
    } catch (error) { this.error(error); }
  };

  private input = (event: Event): void => {
    const input = event.target as HTMLInputElement;
    if (input.dataset.resourceParameter === undefined || !this.selected) return;
    const index = Number(input.dataset.resourceParameter);
    const config = this.configuration as FunctionGraphConfig;
    if (!config.parameters?.[index]) return;
    config.parameters[index].value = Number(input.value);
    const field = this.root.querySelector<HTMLInputElement>(`[name="value_${index}"]`);
    if (field) field.value = input.value;
    const preview = this.root.querySelector('[data-resource-plot]');
    try {
      if (preview) preview.innerHTML = resourcePreviewMarkup(previewTemplate(this.selected, config));
    } catch (error) { this.error(error); }
  };
}
