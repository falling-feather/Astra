import type { DataChartConfig, FunctionGraphConfig, ResourcePreviewRead } from './api-v2.generated';
import { escapeHtml as e } from '../ui/html';

let nextClip = 0;
const palette = ['#78ccdb', '#dac9a6', '#b7a6e2', '#8ecba9'];

/** SVG holds presentation only; resource configuration and completion remain separate. */
export function resourcePreviewMarkup(preview: ResourcePreviewRead): string {
  if (preview.renderer === 'legacy' || preview.renderer === 'bundle') return '';
  const left = 56, top = 24, width = 528, height = 246;
  const clip = `resource-plot-${++nextClip}`;
  let drawing = '', annotations = '', caption = '';
  if (preview.renderer === 'function-graph-v1') {
    const config = preview.configuration as Required<FunctionGraphConfig>;
    const x = (value: number) => left + (value - config.x_min) * width / (config.x_max - config.x_min);
    const y = (value: number) => top + height - (value - config.y_min) * height / (config.y_max - config.y_min);
    let pen = false;
    const path = (preview.view.points as { x: number; y: number | null }[]).map((point) => {
      if (point.y === null) { pen = false; return ''; }
      const command = `${pen ? 'L' : 'M'}${x(point.x).toFixed(2)},${y(point.y).toFixed(2)}`;
      pen = true; return command;
    }).join(' ');
    drawing = `<path d="${path}" fill="none" stroke="${palette[0]}" stroke-width="2.5"/>`;
    if (config.x_min <= 0 && config.x_max >= 0) drawing += `<path d="M${x(0)},${top} V${top + height}" stroke="currentColor" opacity=".35"/>`;
    if (config.y_min <= 0 && config.y_max >= 0) drawing += `<path d="M${left},${y(0)} H${left + width}" stroke="currentColor" opacity=".35"/>`;
    annotations = `<text x="${left}" y="292">${config.x_min}</text><text x="${left + width}" y="292" text-anchor="end">${config.x_max}</text><text x="46" y="${top + 5}" text-anchor="end">${config.y_max}</text><text x="46" y="${top + height}" text-anchor="end">${config.y_min}</text>`;
    caption = `y = ${config.formula}${preview.view.undefined_count ? ` · ${preview.view.undefined_count} 个采样位置无定义或超出计算范围，已留空` : ''}`;
  } else {
    const config = preview.configuration as DataChartConfig;
    const minimum = Number(preview.view.minimum), maximum = Number(preview.view.maximum);
    const range = maximum - minimum || 1;
    const y = (value: number) => top + height - (value - minimum) * height / range;
    const slot = width / config.labels.length;
    config.series.forEach((series, seriesIndex) => {
      const color = palette[seriesIndex % palette.length];
      if (config.kind === 'line') {
        drawing += `<polyline points="${series.values.map((value, index) => `${left + slot * (index + .5)},${y(value)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="2.5"/>`;
      } else {
        const barWidth = slot * .7 / config.series.length;
        drawing += series.values.map((value, index) => `<rect x="${left + slot * (index + .15) + seriesIndex * barWidth}" y="${Math.min(y(value), y(0))}" width="${barWidth}" height="${Math.max(1, Math.abs(y(value) - y(0)))}" fill="${color}" opacity=".8"/>`).join('');
      }
      annotations += `<text x="${left + seriesIndex * 135}" y="328" fill="${color}">${e(series.name)}</text>`;
    });
    annotations += config.labels.map((label, index) => `<text x="${left + slot * (index + .5)}" y="291" text-anchor="middle" font-size="${config.labels.length > 12 ? 8 : 11}">${e(label)}</text>`).join('');
    annotations += `<text x="46" y="${top + 5}" text-anchor="end">${maximum}</text><text x="46" y="${top + height}" text-anchor="end">${minimum}</text>`;
    caption = `${config.title} · ${config.y_label || '数值'}`;
  }
  return `<figure class="resource-plot"><svg viewBox="0 0 640 346" role="img" aria-label="${e(caption)}"><defs><clipPath id="${clip}"><rect x="${left}" y="${top}" width="${width}" height="${height}"/></clipPath></defs>${Array.from({ length: 6 }, (_, index) => `<path d="M${left},${top + index * height / 5} H${left + width}" stroke="currentColor" opacity=".09"/>`).join('')}<rect x="${left}" y="${top}" width="${width}" height="${height}" fill="none" stroke="currentColor" opacity=".2"/><g clip-path="url(#${clip})">${drawing}</g><g fill="currentColor" font-size="11">${annotations}</g></svg><figcaption>${e(caption)}</figcaption></figure>`;
}
