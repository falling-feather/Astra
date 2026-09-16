import type { DataChartConfig, FunctionGraphConfig, TemplateConfiguration } from './resource-types';
import { area, e, field, selectField } from './presentation.ts';

export function templateFields(renderer: string, configuration: TemplateConfiguration): string {
    if (renderer === 'function-graph-v1') {
      const config = configuration as FunctionGraphConfig;
      return `${field('函数表达式', 'formula', config.formula, { required: true, max: 240 })}<p class="portal-note">支持 x、已定义参数、+ − * / ^，以及 sin、cos、abs、sqrt、log、exp。</p><div class="portal-form-grid">${field('横轴起点', 'x_min', config.x_min ?? -5, { type: 'number' })}${field('横轴终点', 'x_max', config.x_max ?? 5, { type: 'number' })}${field('纵轴下界', 'y_min', config.y_min ?? -10, { type: 'number' })}${field('纵轴上界', 'y_max', config.y_max ?? 10, { type: 'number' })}</div><h3>可调参数</h3><div class="resource-parameters">${(config.parameters || []).map((parameter, index) => `<fieldset><legend>${e(parameter.label)}</legend><div class="portal-form-grid">${field('符号', `key_${index}`, parameter.key)}${field('名称', `label_${index}`, parameter.label)}${field('当前值', `value_${index}`, parameter.value, { type: 'number' })}${field('最小值', `minimum_${index}`, parameter.minimum, { type: 'number' })}${field('最大值', `maximum_${index}`, parameter.maximum, { type: 'number' })}${field('步长', `step_${index}`, parameter.step, { type: 'number' })}</div><input type="range" data-resource-parameter="${index}" aria-label="${e(parameter.label)}" min="${parameter.minimum}" max="${parameter.maximum}" step="${parameter.step}" value="${parameter.value}"/><button type="button" class="quiet-button" data-resource="remove-parameter" data-index="${index}">移除参数</button></fieldset>`).join('')}</div><button type="button" class="quiet-button" data-resource="add-parameter">＋ 添加参数</button>`;
    }
    const config = configuration as DataChartConfig;
    const rows = [['类别', ...config.series.map((series) => series.name)], ...config.labels.map((label, index) => [label, ...config.series.map((series) => String(series.values[index]))])];
    return `${field('图表标题', 'title', config.title, { required: true })}${selectField('展示方式', 'kind', [{ value: 'bar', label: '柱状图' }, { value: 'line', label: '折线图' }], config.kind || 'bar')}${field('纵轴名称', 'y_label', config.y_label || '')}${area('数据表', 'chart_data', rows.map((row) => row.join('\t')).join('\n'), true)}<p class="portal-note">可以粘贴表格数据：第一行填写列名，第一列填写类别，其余列填写数值；最多 48 行数据、4 组数值。</p>`;
}

export function readTemplateForm(renderer: string, configuration: TemplateConfiguration, data: FormData): TemplateConfiguration {
    const value = (key: string) => String(data.get(key) || '').trim(), numeric = (key: string) => {
      if (!value(key)) throw new Error('请填写完整的数值。');
      return Number(value(key));
    };
    if (renderer === 'function-graph-v1') {
      const before = configuration as FunctionGraphConfig;
      return { formula: value('formula'), x_min: numeric('x_min'), x_max: numeric('x_max'), y_min: numeric('y_min'), y_max: numeric('y_max'), samples: before.samples ?? 121, parameters: (before.parameters || []).map((_, index) => ({ key: value(`key_${index}`), label: value(`label_${index}`), value: numeric(`value_${index}`), minimum: numeric(`minimum_${index}`), maximum: numeric(`maximum_${index}`), step: numeric(`step_${index}`) })) };
    }
    const lines = value('chart_data').split(/\r?\n/).filter((line) => line.trim());
    const separator = lines[0]?.includes('\t') ? '\t' : ',';
    const rows = lines.map((line) => line.split(separator).map((cell) => cell.trim()));
    if (rows.length < 2 || rows[0].length < 2 || rows.slice(1).some((row) => row.length !== rows[0].length || row.slice(1).some((cell) => !cell))) throw new Error('请提供表头和至少一行数据，各行列数保持一致。');
    return { title: value('title'), kind: value('kind') as 'bar' | 'line', y_label: value('y_label'), labels: rows.slice(1).map((row) => row[0]), series: rows[0].slice(1).map((name, index) => ({ name, values: rows.slice(1).map((row) => Number(row[index + 1])) })) };
}
