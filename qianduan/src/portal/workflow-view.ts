import { ApiError } from '../services/http-client';
import { e } from './presentation';

export const flowButton = (label: string, action: string, attributes = '', primary = false): string =>
  `<button type="button" class="${primary ? 'primary-button' : 'quiet-button'}" data-flow="${action}" ${attributes}>${e(label)}</button>`;

/** A mounted workflow owns drafts and retry identities, never browser storage. */
export abstract class WorkflowView {
  protected active = true;
  protected busy = false;
  protected dirty = false;
  protected lifecycle = new AbortController();
  private pending?: () => Promise<void>;

  constructor(protected root: HTMLElement, protected notify: (message: string) => void) {
    const { signal } = this.lifecycle;
    root.addEventListener('click', (event) => {
      const target = (event.target as Element).closest<HTMLElement>('[data-flow]');
      if (!target) return;
      event.preventDefault(); event.stopPropagation();
      if (target.dataset.flow === 'retry-command') { if (this.pending) void this.run(this.pending); return; }
      void this.run(() => this.click(target));
    }, { signal });
    root.addEventListener('submit', (event) => {
      const form = event.target as HTMLFormElement;
      if (!form.hasAttribute('data-flow-form')) return;
      event.preventDefault(); event.stopPropagation();
      const data = new FormData(form);
      const submitter = (event as SubmitEvent).submitter;
      if (submitter instanceof HTMLButtonElement && submitter.name) data.set(submitter.name, submitter.value);
      if (form.reportValidity()) void this.run(() => this.submit(form, data));
    }, { signal });
    root.addEventListener('input', (event) => {
      if ((event.target as Element).closest('[data-flow-dirty]')) {
        this.dirty = true;
        // A nested module owns its form; do not leave its parent falsely dirty after saving.
        event.stopPropagation();
      }
    }, { signal });
  }

  protected abstract click(target: HTMLElement): Promise<void>;
  protected abstract submit(form: HTMLFormElement, data: FormData): Promise<void>;

  protected paint(html: string): void {
    if (this.active) this.root.innerHTML = `<div class="portal-view workflow-view">${html}</div>`;
  }

  protected async run(action: () => Promise<void>): Promise<void> {
    if (!this.active || this.busy) return;
    this.busy = true; this.root.inert = true; this.root.setAttribute('aria-busy', 'true');
    try { await action(); }
    catch (error) {
      if (!this.active) return;
      if (error instanceof ApiError && error.status !== 0 && error.status !== 409) this.pending = undefined;
      this.root.querySelector('[data-flow-error]')?.remove();
      this.root.insertAdjacentHTML('afterbegin', `<div class="portal-error" data-flow-error role="alert">${e(error instanceof Error ? error.message : '操作未完成，请重试。')}${this.pending ? `<p>保留本次操作，可以使用同一编号重试。</p>${flowButton('重试同一操作', 'retry-command')}` : ''}</div>`);
    } finally { this.busy = false; this.root.inert = false; this.root.removeAttribute('aria-busy'); }
  }

  protected async write<P extends object, T>(payload: P, send: (command: P & { client_request_id: string }) => Promise<T>, accept: (result: T) => Promise<void>): Promise<void> {
    if (this.pending) throw new Error('上次操作尚未确认，请先重试或重新读取服务器状态。');
    const command = { ...structuredClone(payload), client_request_id: crypto.randomUUID() };
    const operation = async () => {
      const result = await send(command);
      this.pending = undefined;
      if (this.active) await accept(result);
    };
    this.pending = operation;
    await operation();
  }

  protected allowReload(): boolean {
    if ((this.dirty || this.pending) && !confirm('重新读取会放弃未保存的页面输入；已成功提交的操作仍会保留。继续吗？')) return false;
    this.pending = undefined; this.dirty = false;
    return true;
  }

  hasChanges(): boolean { return this.dirty || Boolean(this.pending); }
  canLeave(): boolean {
    if (this.busy) { this.notify('正在处理，请稍候。'); return false; }
    return !(this.dirty || this.pending) || confirm('这里有未保存或尚未确认的操作，确定离开吗？');
  }
  destroy(): void { this.active = false; this.lifecycle.abort(); }
}
