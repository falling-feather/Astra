import { ActivitySession, type ActivityRecordState } from './domain/activity-session';
import { matchingExperimentBlock } from './domain/experiment-entry';
import { createStudyApi } from './services/study-api';
import { HttpClient } from './services/http-client';
import { API_BASE, DEMO_MODE } from './services/environment';

/** The full-page labs entry reuses the portal protocol and keeps no browser ledger. */
if (!DEMO_MODE && new URL(location.href).searchParams.has('astra_context_key')) {
  const api = createStudyApi(new HttpClient(API_BASE));
  let generation = 0;
  let dispose = () => {};

  const mount = async () => {
    dispose();
    const currentGeneration = ++generation;
    const current = new URL(location.href);
    const contextKey = current.searchParams.get('astra_context_key');
    if (!contextKey) return;
    const base = new URL(import.meta.env.BASE_URL, location.origin);
    const panel = document.createElement('aside');
    panel.className = 'astra-course-recording';
    panel.setAttribute('aria-label', '课程实验记录');
    const output = document.createElement('output');
    output.setAttribute('role', 'status');
    output.textContent = '正在确认课程实验与发布版本…';
    const retry = document.createElement('button');
    retry.type = 'button'; retry.textContent = '重试原操作'; retry.hidden = true;
    const back = document.createElement('a');
    back.textContent = '返回课程'; back.hidden = true;
    panel.append(output, retry, back);
    document.body.append(panel);
    const life = new AbortController();
    let session: ActivitySession | undefined;
    const controls = new Map<HTMLInputElement, boolean>();
    dispose = () => {
      life.abort(); session?.destroy(); panel.remove();
      controls.forEach((disabled, input) => { input.disabled = disabled; });
      controls.clear();
    };
    const state = (value: ActivityRecordState) => {
      if (life.signal.aborted) return;
      output.textContent = value.message;
      retry.hidden = value.status !== 'error';
      controls.forEach((disabled, input) => { input.disabled = disabled || value.status === 'loading' || value.status === 'error'; });
    };
    const beforeLeave = (event: BeforeUnloadEvent) => {
      if (session?.hasPending()) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', beforeLeave, { signal: life.signal });
    retry.addEventListener('click', () => {
      if (session) void session.retry();
      else void mount();
    }, { signal: life.signal });
    try {
      const config = await api.activityConfig(contextKey);
      if (life.signal.aborted || generation !== currentGeneration) return;
      const block = matchingExperimentBlock(config.blocks, current, base, current.searchParams.get('astra_block_id'));
      back.href = new URL(`#/course/${config.scope.course_id}`, base).href;
      back.hidden = false;
      if (!block) {
        output.textContent = '当前页面没有唯一对应的可记录课程实验；请从课程入口重新进入。';
        return;
      }
      for (const control of block.controls) {
        if (!control.selector) continue;
        document.querySelectorAll<HTMLInputElement>(control.selector).forEach(input => {
          if (input instanceof HTMLInputElement) controls.set(input, input.disabled);
        });
      }
      // The permission-checked config is reused once for this mounted page only.
      session = new ActivitySession({ ...api, activityConfig: async () => config }, contextKey, state, async () => {});
      await session.initialize();
      if (life.signal.aborted) return;
      document.addEventListener('change', event => {
        const input = event.target;
        if (!(input instanceof HTMLInputElement)) return;
        const control = block.controls.find(item => item.selector && input.matches(item.selector));
        if (!control || (input.type !== 'range' && input.type !== 'number')) return;
        void session!.observe({ block_id: block.block_id, parameter: control.key, value: Number(input.value) }).catch(error => {
          state({ status: 'error', message: error instanceof Error ? error.message : '操作记录尚未确认，请重试。' });
        });
      }, { signal: life.signal });
    } catch (error) {
      state({ status: 'error', message: error instanceof Error ? error.message : '无法确认课程实验。' });
    }
  };

  window.addEventListener('hashchange', () => { void mount(); });
  window.addEventListener('pagehide', () => { generation++; dispose(); });
  window.addEventListener('pageshow', event => { if (event.persisted) void mount(); });
  void mount();
}
