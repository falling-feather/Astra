import type { Activity, Release, ReleaseUnit } from './contracts';
import type {
  ResourceGateway,
  ResourceVersionRead,
  TemplateConfiguration,
  FunctionGraphConfig,
} from './resource-types';
import type { WorkflowGateway } from './workflow-types';
import { frontendAsset } from '../services/environment';
import { previewTemplate } from '../domain/template-preview';
import { resourcePreviewMarkup } from './resource-preview';
import { e } from './presentation';
import type { LearningContextRead, StudyGateway } from './study-types';
import { ActivitySession, type ActivityRecordState } from '../domain/activity-session';

/** Rendering stays local. Declared parameter observations use the pinned study session. */
export class CoursePlayer {
  private life = new AbortController();
  private active = true;
  private frameLife?: AbortController;
  private session?: ActivitySession;
  private recordState?: ActivityRecordState;
  private controls = new Set<HTMLInputElement>();
  private versions = new Map<
    string,
    { resource: ResourceVersionRead; configuration: TemplateConfiguration }
  >();
  constructor(
    private root: HTMLElement,
    private api: ResourceGateway,
    private workflow: WorkflowGateway,
    private release: Release,
    private unit: ReleaseUnit,
    private study: {
      api: StudyGateway;
      context: LearningContextRead;
      activities: Activity[];
      changed(): Promise<void>;
    },
  ) {
    root.addEventListener('input', this.input, { signal: this.life.signal });
    root.addEventListener('click', this.click, { signal: this.life.signal });
    root.addEventListener('change', this.change, { signal: this.life.signal });
  }
  mount(): void {
    const hasResource = this.unit.content.blocks.some((block) =>
      ['resource', 'official-simulation'].includes(block.type),
    );
    if (hasResource) {
      const lesson = this.root.querySelector('.portal-lesson');
      lesson?.insertAdjacentHTML(
        'afterbegin',
        '<div class="portal-note" data-recording-panel><output role="status" data-recording-message></output><button type="button" class="quiet-button" data-player-retry hidden>重试原操作</button></div>',
      );
      this.session = new ActivitySession(
        this.study.api,
        this.study.context.context_key,
        this.showRecordState,
        this.study.changed,
      );
      void this.session.initialize().catch(() => {});
    }
    void this.load();
  }
  hasPending(): boolean {
    return Boolean(this.session?.hasPending());
  }
  private showRecordState = (state: ActivityRecordState): void => {
    if (!this.active) return;
    this.recordState = state;
    const message = this.root.querySelector('[data-recording-message]');
    if (message) message.textContent = state.message;
    const retry = this.root.querySelector<HTMLButtonElement>('[data-player-retry]');
    if (retry) retry.hidden = state.status !== 'error';
    this.controls.forEach((control) => {
      control.disabled = state.status === 'error';
    });
  };
  destroy(): void {
    this.active = false;
    this.session?.destroy();
    this.frameLife?.abort();
    this.life.abort();
    this.versions.clear();
    this.controls.clear();
  }
  private async load(): Promise<void> {
    for (const block of this.unit.content.blocks) {
      if (!this.active) return;
      if (block.type === 'resource' || block.type === 'official-simulation') {
        const host = [...this.root.querySelectorAll<HTMLElement>('[data-course-resource]')].find(
          (item) => item.dataset.courseResource === block.blockId,
        );
        if (!host) continue;
        try {
          let resource = block.resourceVersionId
            ? this.study.context.resources.find((item) => item.id === block.resourceVersionId) ||
              (await this.api.version(block.resourceVersionId))
            : this.study.context.resources.find((item) => item.resource_key === block.simulationKey);
          if (!resource) {
            const activity = this.study.activities.find((item) => item.key === block.simulationKey);
            if (!activity) throw new Error('这个实验资源暂不可用。');
            resource = {
              id: 0,
              resource_key: activity.key,
              space_key: activity.galaxy,
              subject_key: activity.subject,
              kind: 'activity',
              version_number: 0,
              title: activity.title,
              renderer: 'legacy',
              definition: { entry: activity.href, configuration: {} },
              capabilities: { operation_recording: false },
              provenance: { mode: 'legacy-compatibility' },
              content_sha256: 'unversioned-legacy',
            };
          }
          if (!this.active) return;
          const configuration = structuredClone(block.configuration || {});
          this.versions.set(block.blockId, { resource, configuration });
          const legacy = resource.renderer === 'legacy' || resource.renderer === 'bundle';
          const parameters =
            resource.renderer === 'function-graph-v1'
              ? (configuration as FunctionGraphConfig).parameters || []
              : [];
          host.innerHTML = legacy
            ? `<button type="button" class="quiet-button" data-player-open="${e(block.blockId)}">开始探索 →</button><div data-player-frame></div>`
            : `<div data-player-plot>${resourcePreviewMarkup(previewTemplate(resource, configuration))}</div><div class="portal-form-grid">${parameters.map((parameter, index) => `<label class="portal-field"><span>${e(parameter.label)} <output data-parameter-value="${index}">${parameter.value}</output></span><input type="range" aria-label="${e(parameter.label)}" data-player-resource="${e(block.blockId)}" data-player-parameter="${index}" min="${parameter.minimum}" max="${parameter.maximum}" step="${parameter.step}" value="${parameter.value}"/></label>`).join('')}</div>`;
          if (resource.capabilities.operation_recording === true)
            host.querySelectorAll<HTMLInputElement>('[data-player-resource]').forEach((input) => {
              this.controls.add(input);
              input.disabled = this.recordState?.status === 'error';
            });
        } catch (error) {
          if (this.active) host.textContent = error instanceof Error ? error.message : '资源暂不可用';
        }
      }
      if (block.type === 'media' && block.assetKey) {
        const host = [...this.root.querySelectorAll<HTMLElement>('[data-course-media]')].find(
          (item) => item.dataset.courseMedia === block.blockId,
        );
        if (!host) continue;
        try {
          const url = e(
            this.workflow.mediaUrl(
              this.release.course_id,
              block.assetKey,
              this.release.id,
              this.unit.source_course_unit_id,
            ),
          );
          host.innerHTML =
            block.mediaType === 'image' || block.mediaType === 'diagram'
              ? `<img src="${url}" alt="${e(block.alt || '')}" loading="lazy" class="course-media-image"/>`
              : block.mediaType === 'audio'
                ? `<audio controls preload="metadata" src="${url}" aria-label="${e(block.title || '课程音频')}"></audio>`
                : block.mediaType === 'video'
                  ? `<video controls preload="metadata" src="${url}" class="course-media-video" aria-label="${e(block.title || '课程视频')}"></video>`
                  : `<a class="quiet-button" href="${url}" target="_blank" rel="noopener">下载课程文档 ↗</a>`;
        } catch (error) {
          host.textContent = error instanceof Error ? error.message : '素材暂不可用';
        }
      }
    }
  }
  private input = (event: Event): void => {
    const input = event.target as HTMLInputElement,
      key = input.dataset.playerResource;
    if (!key || input.dataset.playerParameter === undefined) return;
    const state = this.versions.get(key);
    if (!state || state.resource.renderer !== 'function-graph-v1') return;
    const config = state.configuration as FunctionGraphConfig,
      index = Number(input.dataset.playerParameter);
    const parameter = config.parameters?.[index];
    if (!parameter) return;
    parameter.value = Number(input.value);
    const host = input.closest('[data-course-resource]')!;
    host.querySelector(`[data-parameter-value="${index}"]`)!.textContent = input.value;
    try {
      host.querySelector('[data-player-plot]')!.innerHTML = resourcePreviewMarkup(
        previewTemplate(state.resource, config),
      );
    } catch {
      host.querySelector('[data-player-plot]')!.textContent = '当前条件下无法生成图像，请调整参数。';
    }
  };
  private change = (event: Event): void => {
    const input = event.target as HTMLInputElement,
      state = this.versions.get(input.dataset.playerResource || '');
    if (
      !state ||
      state.resource.capabilities.operation_recording !== true ||
      input.dataset.playerParameter === undefined
    )
      return;
    const parameter = (state.configuration as FunctionGraphConfig).parameters?.[
      Number(input.dataset.playerParameter)
    ];
    if (!parameter) return;
    void this.session
      ?.observe({
        block_id: input.dataset.playerResource!,
        parameter: parameter.key,
        value: Number(input.value),
      })
      .catch((error) =>
        this.showRecordState({
          status: 'error',
          message: error instanceof Error ? error.message : '操作记录未确认。',
        }),
      );
  };
  private observeFrame(frame: HTMLIFrameElement, blockId: string, entry: string): void {
    const life = (this.frameLife = new AbortController());
    let documentLife: AbortController | undefined;
    life.signal.addEventListener('abort', () => documentLife?.abort(), { once: true });
    frame.addEventListener(
      'load',
      () => {
        documentLife?.abort();
        documentLife = new AbortController();
        const signal = documentLife.signal;
        void this.session
          ?.initialize()
          .then((config) => {
            if (!this.active || life.signal.aborted || signal.aborted) return;
            const block = config.blocks.find(
              (item) => item.block_id === blockId && item.adapter === 'numeric-controls-v1',
            );
            if (!block) return;
            const expected = new URL(frontendAsset(entry), window.location.href),
              child = frame.contentWindow,
              doc = frame.contentDocument;
            if (!child || !doc || child.location.origin !== expected.origin) return;
            const frameControls: HTMLInputElement[] = [];
            signal.addEventListener(
              'abort',
              () => frameControls.forEach((input) => this.controls.delete(input)),
              { once: true },
            );
            for (const control of block.controls) {
              if (!control.selector || !/^#[A-Za-z][A-Za-z0-9_-]*$/.test(control.selector)) continue;
              const input = doc.querySelector<HTMLInputElement>(control.selector);
              if (input) {
                frameControls.push(input);
                this.controls.add(input);
                input.disabled = this.recordState?.status === 'error';
              }
            }
            doc.addEventListener(
              'change',
              (event) => {
                const input = event.target as HTMLInputElement;
                if (
                  child.location.pathname !== expected.pathname ||
                  child.location.hash !== expected.hash ||
                  !input.matches?.('input[type="range"], input[type="number"]') ||
                  !input.getClientRects().length
                )
                  return;
                const control = block.controls.find(
                  (control) => control.selector && input.matches(control.selector),
                );
                if (!control) return;
                void this.session
                  ?.observe({ block_id: blockId, parameter: control.key, value: Number(input.value) })
                  .catch((error) =>
                    this.showRecordState({
                      status: 'error',
                      message: error instanceof Error ? error.message : '操作记录未确认。',
                    }),
                  );
              },
              { signal },
            );
          })
          .catch(() => {});
      },
      { signal: life.signal },
    );
  }
  private click = (event: Event): void => {
    if ((event.target as Element).closest('[data-player-retry]')) {
      void this.session?.retry();
      return;
    }
    const button = (event.target as Element).closest<HTMLElement>('[data-player-open]');
    if (!button) return;
    const state = this.versions.get(button.dataset.playerOpen!);
    if (!state) return;
    const entry = String(state.resource.definition.entry || '');
    if (!entry.startsWith('labs/') || /[\\\s]|(?:^|\/)\.\.(?:\/|$)/.test(entry)) return;
    this.frameLife?.abort();
    this.root.querySelectorAll('[data-player-frame]').forEach((host) => host.replaceChildren());
    const frame = document.createElement('iframe');
    frame.className = 'portal-experiment-frame';
    frame.title = state.resource.title;
    frame.allow = 'fullscreen';
    this.observeFrame(frame, button.dataset.playerOpen!, entry);
    frame.src = frontendAsset(entry);
    button.parentElement!.querySelector('[data-player-frame]')!.append(frame);
  };
}
