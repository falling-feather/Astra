import type { DataChartConfig, FunctionGraphConfig, ResourcePreviewRead, ResourceVersionRead } from '../portal/api-v2.generated';
import { compileExpression, evaluateExpression } from './template-expression.ts';

function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !keys.includes(key))) throw new Error('模板包含未知或错误的配置字段');
  return value as Record<string, unknown>;
}
function number(data: Record<string, unknown>, key: string, minimum: number, maximum: number, fallback?: number): number {
  const value = Object.hasOwn(data, key) ? data[key] : fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) throw new Error(`${key} 超出允许范围`);
  return value;
}
function text(value: unknown, maximum: number, fallback?: string): string {
  const input = value === undefined ? fallback : value;
  if (typeof input !== 'string' || !input.trim() || Array.from(input.trim()).length > maximum) throw new Error('模板文字长度不符合要求');
  return input.trim();
}

export function previewTemplate(version: Pick<ResourceVersionRead, 'id' | 'renderer' | 'definition'>, input: unknown): ResourcePreviewRead {
  if (version.renderer === 'legacy' || version.renderer === 'bundle') {
    object(input, []);
    return { resource_version_id: version.id, renderer: version.renderer, configuration: {}, view: { entry: version.definition.entry, runtime_pin: 'legacy-compatibility' } };
  }
  if (version.renderer === 'function-graph-v1') {
    const data = object(input, ['formula', 'parameters', 'x_min', 'x_max', 'y_min', 'y_max', 'samples']);
    const raw = data.parameters === undefined ? [] : data.parameters;
    if (!Array.isArray(raw) || raw.length > 8) throw new Error('参数数量超出范围');
    const parameters = raw.map((value) => {
      const parameter = object(value, ['key', 'label', 'value', 'minimum', 'maximum', 'step']);
      const key = text(parameter.key, 16);
      if (!/^[a-z][a-z0-9_]{0,15}$/.test(key) || ['x', 'pi', 'e', 'sin', 'cos', 'abs', 'sqrt', 'log', 'exp'].includes(key)) throw new Error('参数名无效或与保留变量冲突');
      const minimum = number(parameter, 'minimum', -1000, 1000), maximum = number(parameter, 'maximum', -1000, 1000);
      const current = number(parameter, 'value', minimum, maximum), step = number(parameter, 'step', 0, 1000);
      if (minimum >= maximum || step <= 0 || step > maximum - minimum) throw new Error('参数范围或步长无效');
      return { key, label: text(parameter.label, 80), minimum, maximum, value: current, step };
    });
    if (new Set(parameters.map((parameter) => parameter.key)).size !== parameters.length) throw new Error('参数名不能重复');
    const config: Required<FunctionGraphConfig> = {
      formula: text(data.formula, 240), parameters,
      x_min: number(data, 'x_min', -1000, 1000, -5), x_max: number(data, 'x_max', -1000, 1000, 5),
      y_min: number(data, 'y_min', -1e6, 1e6, -10), y_max: number(data, 'y_max', -1e6, 1e6, 10),
      samples: number(data, 'samples', 21, 301, 121),
    };
    if (config.x_min >= config.x_max || config.y_min >= config.y_max || !Number.isInteger(config.samples)) throw new Error('坐标范围或采样数量无效');
    const ast = compileExpression(config.formula, new Set(['x', ...parameters.map((parameter) => parameter.key)]));
    const variables = Object.fromEntries(parameters.map((parameter) => [parameter.key, parameter.value]));
    const points = Array.from({ length: config.samples }, (_, index) => {
      const x = config.x_min + (config.x_max - config.x_min) * index / (config.samples - 1);
      return { x, y: evaluateExpression(ast, { ...variables, x }) };
    });
    return { resource_version_id: version.id, renderer: version.renderer, configuration: config, view: { ast, points, undefined_count: points.filter((point) => point.y === null).length } };
  }
  if (version.renderer === 'data-chart-v1') {
    const data = object(input, ['kind', 'title', 'labels', 'series', 'y_label']);
    if (!Array.isArray(data.labels) || data.labels.length < 1 || data.labels.length > 48 || !Array.isArray(data.series) || data.series.length < 1 || data.series.length > 4) throw new Error('图表数据数量无效');
    const labels = data.labels.map((label) => text(label, 80));
    const series = data.series.map((value) => {
      const item = object(value, ['name', 'values']);
      if (!Array.isArray(item.values) || item.values.length !== labels.length || item.values.some((n) => typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > 1e9)) throw new Error('每组数值须与标签一一对应');
      return { name: text(item.name, 80), values: item.values as number[] };
    });
    if (data.kind !== undefined && data.kind !== 'bar' && data.kind !== 'line') throw new Error('图表类型无效');
    const config: DataChartConfig = { kind: data.kind as 'bar' | 'line' || 'bar', title: text(data.title, 160), labels, series, y_label: data.y_label === '' ? '' : text(data.y_label, 80, '数值') };
    const values = series.flatMap((item) => item.values);
    return { resource_version_id: version.id, renderer: version.renderer, configuration: config, view: { minimum: Math.min(0, ...values), maximum: Math.max(0, ...values) } };
  }
  throw new Error('当前客户端不支持这个资源版本');
}
