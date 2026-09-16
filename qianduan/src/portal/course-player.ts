import type { Release, ReleaseUnit } from './contracts';
import type { ResourceGateway, ResourceVersionRead, TemplateConfiguration, FunctionGraphConfig } from './resource-types';
import type { WorkflowGateway } from './workflow-types';
import { frontendAsset } from '../services/environment';
import { previewTemplate } from '../domain/template-preview';
import { resourcePreviewMarkup } from './resource-preview';
import { e } from './presentation';

/** Template exploration remains local; completion is submitted separately. */
export class CoursePlayer {
  private life = new AbortController();
  private active = true;
  private versions = new Map<string, { resource: ResourceVersionRead; configuration: TemplateConfiguration }>();
  constructor(private root: HTMLElement, private api: ResourceGateway, private workflow: WorkflowGateway, private release: Release, private unit: ReleaseUnit) {
    root.addEventListener('input', this.input, { signal: this.life.signal });
    root.addEventListener('click', this.click, { signal: this.life.signal });
  }
  mount(): void { void this.load(); }
  destroy(): void { this.active = false; this.life.abort(); this.versions.clear(); }
  private async load(): Promise<void> {
    for (const block of this.unit.content.blocks) {
      if (!this.active) return;
      if (block.type === 'resource' && block.resourceVersionId) {
        const host = [...this.root.querySelectorAll<HTMLElement>('[data-course-resource]')].find((item) => item.dataset.courseResource === block.blockId);
        if (!host) continue;
        try {
          const resource = await this.api.version(block.resourceVersionId);
          if (!this.active) return;
          const configuration = structuredClone(block.configuration || {});
          this.versions.set(block.blockId, { resource, configuration });
          const legacy = resource.renderer === 'legacy' || resource.renderer === 'bundle';
          const parameters = resource.renderer === 'function-graph-v1' ? (configuration as FunctionGraphConfig).parameters || [] : [];
          host.innerHTML = legacy ? `<button type="button" class="quiet-button" data-player-open="${e(block.blockId)}">开始探索 →</button><div data-player-frame></div>` : `<div data-player-plot>${resourcePreviewMarkup(previewTemplate(resource, configuration))}</div><div class="portal-form-grid">${parameters.map((parameter, index) => `<label class="portal-field"><span>${e(parameter.label)} <output data-parameter-value="${index}">${parameter.value}</output></span><input type="range" aria-label="${e(parameter.label)}" data-player-resource="${e(block.blockId)}" data-player-parameter="${index}" min="${parameter.minimum}" max="${parameter.maximum}" step="${parameter.step}" value="${parameter.value}"/></label>`).join('')}</div>`;
        } catch (error) { if (this.active) host.textContent = error instanceof Error ? error.message : '资源暂不可用'; }
      }
      if (block.type === 'media' && block.assetKey) {
        const host = [...this.root.querySelectorAll<HTMLElement>('[data-course-media]')].find((item) => item.dataset.courseMedia === block.blockId);
        if (!host) continue;
        try {
          const url = e(this.workflow.mediaUrl(this.release.course_id, block.assetKey, this.release.id, this.unit.source_course_unit_id));
          host.innerHTML = block.mediaType === 'image' || block.mediaType === 'diagram' ? `<img src="${url}" alt="${e(block.alt || '')}" loading="lazy" class="course-media-image"/>` : block.mediaType === 'audio' ? `<audio controls preload="metadata" src="${url}" aria-label="${e(block.title || '课程音频')}"></audio>` : block.mediaType === 'video' ? `<video controls preload="metadata" src="${url}" class="course-media-video" aria-label="${e(block.title || '课程视频')}"></video>` : `<a class="quiet-button" href="${url}" target="_blank" rel="noopener">下载课程文档 ↗</a>`;
        } catch (error) { host.textContent = error instanceof Error ? error.message : '素材暂不可用'; }
      }
    }
  }
  private input = (event: Event): void => {
    const input = event.target as HTMLInputElement, key = input.dataset.playerResource;
    if (!key || input.dataset.playerParameter === undefined) return;
    const state = this.versions.get(key);
    if (!state || state.resource.renderer !== 'function-graph-v1') return;
    const config = state.configuration as FunctionGraphConfig, index = Number(input.dataset.playerParameter);
    const parameter = config.parameters?.[index]; if (!parameter) return;
    parameter.value = Number(input.value);
    const host = input.closest('[data-course-resource]')!;
    host.querySelector(`[data-parameter-value="${index}"]`)!.textContent = input.value;
    try { host.querySelector('[data-player-plot]')!.innerHTML = resourcePreviewMarkup(previewTemplate(state.resource, config)); }
    catch { host.querySelector('[data-player-plot]')!.textContent = '当前条件下无法生成图像，请调整参数。'; }
  };
  private click = (event: Event): void => {
    const button = (event.target as Element).closest<HTMLElement>('[data-player-open]');
    if (!button) return;
    const state = this.versions.get(button.dataset.playerOpen!); if (!state) return;
    const entry = String(state.resource.definition.entry || '');
    if (!entry.startsWith('labs/') || /[\\\s]|(?:^|\/)\.\.(?:\/|$)/.test(entry)) return;
    this.root.querySelectorAll('[data-player-frame]').forEach((host) => host.replaceChildren());
    button.parentElement!.querySelector('[data-player-frame]')!.innerHTML = `<iframe class="portal-experiment-frame" title="${e(state.resource.title)}" src="${e(frontendAsset(entry))}" allow="fullscreen"></iframe>`;
  };
}
