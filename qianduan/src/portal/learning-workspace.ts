import { frontendAsset } from '../services/environment';
import type * as D from './study-types';
import type * as T from './contracts';
import type { ResourceGateway } from './resource-types';
import type { WorkflowGateway } from './workflow-types';
import { CoursePlayer } from './course-player';
import { renderLearningBlock } from './learning-views';
import { e, empty, when } from './presentation';
import { flowButton as button, WorkflowView } from './workflow-view';

/** Starts at unit entry, so later publication cannot silently replace a running attempt. */
export class LearningWorkspace extends WorkflowView {
  private release?: T.Release;
  private context?: D.LearningContextRead;
  private selected = 0;
  private contexts = new Map<number, D.LearningContextRead>();
  private starts = new Map<number, string>();
  private player?: CoursePlayer;
  private offset = 0;

  constructor(
    root: HTMLElement,
    private api: D.StudyGateway,
    private school: T.SchoolGateway,
    private resources: ResourceGateway,
    private workflow: WorkflowGateway,
    private courseId: number,
    private options: {
      activities: T.Activity[];
      demo: boolean;
      notify(message: string): void;
      changed(): Promise<void>;
    },
  ) {
    super(root, options.notify);
  }
  mount(): void {
    void this.run(() => this.load());
  }
  destroy(): void {
    this.player?.destroy();
    super.destroy();
  }
  protected paint(html: string): void {
    this.player?.destroy();
    this.player = undefined;
    super.paint(html);
  }
  private async load(): Promise<void> {
    this.release = (await this.school.currentRelease(this.courseId)).release;
    this.contexts.clear();
    this.starts.clear();
    this.selected = 0;
    await this.openUnit();
  }
  private async openUnit(): Promise<void> {
    const unit = this.release?.units[this.selected];
    this.context = undefined;
    if (unit && unit.access_state !== 'locked') {
      let context = this.contexts.get(unit.source_course_unit_id);
      if (!context) {
        const key = this.starts.get(unit.source_course_unit_id) || crypto.randomUUID();
        this.starts.set(unit.source_course_unit_id, key);
        context = await this.api.start({
          client_request_id: key,
          mode: 'formal',
          course_id: this.courseId,
          course_unit_id: unit.source_course_unit_id,
          expected_release_id: this.release!.id,
        });
        this.contexts.set(unit.source_course_unit_id, context);
      }
      this.context = context;
    }
    this.draw();
  }
  private pinned(): { release: T.Release; unit: T.ReleaseUnit } | undefined {
    const context = this.context;
    if (!context?.content || !context.course_release_id || !context.course_unit_id) return;
    const unit: T.ReleaseUnit = {
      id: context.release_unit_id!,
      source_course_unit_id: context.course_unit_id,
      activity_key: context.activity_key!,
      title: context.unit_title!,
      position: 1,
      content: context.content as unknown as T.ContentPage,
      content_schema_sha256: context.content_schema_sha256!,
      access_state: 'open',
    };
    return {
      unit,
      release: {
        ...this.release!,
        id: context.course_release_id,
        release_number: context.release_number!,
        title: context.course_title!,
        published_at: context.published_at!,
        units: [unit],
      },
    };
  }
  private draw(): void {
    const pinned = this.pinned(),
      context = this.context;
    this.paint(
      `<div class="portal-section-heading"><div><h1>${e(context?.course_title || this.release?.title)}</h1><p>正在学习第 ${context?.release_number || this.release?.release_number} 个发布版本</p></div><div class="portal-actions">${button('学习记录', 'history')}${button('读取当前版本', 'current')}</div></div>${context?.newer_release_available ? '<p class="portal-note">你正在继续先前打开的版本。旧结果会保留，是否计入当前版本取决于教师的补做安排。</p>' : ''}<div class="portal-editor"><aside class="portal-unit-list">${this.release?.units.map((unit, index) => button(unit.title, 'unit', `data-index="${index}" aria-current="${unit.source_course_unit_id === context?.course_unit_id ? 'step' : 'false'}"`)).join('')}</aside><article class="portal-lesson">${pinned ? `<h2>${e(pinned.unit.title)}</h2>${pinned.unit.content.blocks.map((block) => renderLearningBlock(block, this.options.activities)).join('')}` : empty('这个单元尚未开放，请先完成前置学习或查看教师安排。')}</article></div>`,
    );
    if (pinned) {
      this.player = new CoursePlayer(this.root, this.resources, this.workflow, pinned.release, pinned.unit);
      this.player.mount();
    }
    this.dirty = false;
  }
  private async history(): Promise<void> {
    const [page, contexts] = await Promise.all([
      this.api.history(this.courseId, this.offset),
      this.api.contexts(this.courseId),
    ]);
    this.paint(
      `<div class="portal-section-heading"><h1>学习与结果记录</h1>${button('返回学习', 'back')}</div><p class="portal-note">当前第 ${page.current_release_number ?? '—'} 个发布版本，已完成 ${page.current_completed_units.length} 个单元。历史记录保留原题、原回答与原评价。</p><section class="portal-surface"><h2>继续先前的学习</h2>${
        contexts
          .filter((row) => !row.is_current)
          .map((row) =>
            button(
              `${row.unit_title} · 第 ${row.release_number} 版`,
              'resume',
              `data-key="${e(row.context_key)}"`,
            ),
          )
          .join('') || empty('暂无旧版本学习入口。')
      }</section><section class="portal-surface"><h2>我的结果</h2>${
        page.items
          .map(
            (row) =>
              `<details><summary>${e(row.title)} · ${row.source_release_number ? `第 ${row.source_release_number} 版` : '旧记录未绑定版本'} · ${row.current_credit ? (row.recognized ? '旧结果已被当前版认可' : '计入当前版完成') : row.valid ? (row.source_release_id === page.current_release_id ? '本版评价（不作为单元完成条件）' : '保留为历史结果') : '已有后续评价或更正'}</summary><p class="portal-note">${when(row.occurred_at)}</p>${row.prompt ? `<p>${e(row.prompt)}</p>` : ''}${row.choices.length ? `<ul>${row.choices.map((choice) => `<li>${e(choice.label)}</li>`).join('')}</ul>` : ''}<div class="submission-answer">${e(
                Object.values(row.response)
                  .map((value) =>
                    Array.isArray(value)
                      ? value
                          .map(
                            (id) => row.choices.find((choice) => choice.choiceId === id)?.label || String(id),
                          )
                          .join('、')
                      : typeof value === 'object'
                        ? JSON.stringify(value)
                        : String(value),
                  )
                  .join('\n'),
              )}</div><p>${row.score === null ? (row.is_correct === null ? '操作结果' : row.is_correct ? '回答正确' : '继续思考') : `评分 ${row.score} / ${row.max_score ?? '未知满分'}`}</p><p>${e(row.feedback_retained ? row.feedback || '' : '旧反馈正文未留存')}</p></details>`,
          )
          .join('') || empty('尚无完成评价；开始探索本身不会自动变成完成成绩。')
      }<div class="portal-pagination">${page.offset ? button('上一页', 'history-page', `data-offset="${Math.max(0, page.offset - page.limit)}"`) : ''}${page.next_offset !== null ? button('下一页', 'history-page', `data-offset="${page.next_offset}"`) : ''}</div></section>`,
    );
  }
  protected async click(target: HTMLElement): Promise<void> {
    const action = target.dataset.flow;
    if (action === 'unit') {
      if (this.allowReload()) {
        this.selected = Number(target.dataset.index);
        await this.openUnit();
      }
    } else if (action === 'current') {
      if (this.allowReload()) await this.load();
    } else if (action === 'back') this.draw();
    else if (action === 'history' || action === 'history-page') {
      if (this.allowReload()) {
        this.offset = Number(target.dataset.offset || 0);
        await this.history();
      }
    } else if (action === 'resume') {
      this.context = await this.api.context(target.dataset.key!);
      this.draw();
    } else if (action === 'open-activity') {
      const activity = this.options.activities.find((item) => item.key === target.dataset.key);
      if (!activity || !this.allowReload()) return;
      this.paint(
        `${button('返回学习', 'back')}<iframe class="portal-experiment-frame" title="${e(activity.title)}" src="${e(frontendAsset(activity.href))}" allow="fullscreen"></iframe>`,
      );
    }
  }
  protected async submit(form: HTMLFormElement, data: FormData): Promise<void> {
    if (form.dataset.flowForm !== 'checkpoint' || !this.context) return;
    const answers = data.getAll('answer').map(String);
    if (!answers.length || answers.every((value) => !value.trim())) throw new Error('请先填写回答。');
    const body =
      form.dataset.response === 'numeric'
        ? { numeric_answer: Number(answers[0]) }
        : form.dataset.response === 'short-text'
          ? { text_answer: answers[0].trim() }
          : { selected_choice_ids: answers };
    const key = this.context.context_key;
    await this.write(
      body,
      ({ client_request_id, ...value }) =>
        this.api.checkpoint(key, form.dataset.key!, { ...value, client_attempt_id: client_request_id }),
      async (result) => {
        this.dirty = false;
        if (!this.active) return;
        form.querySelector('output')!.textContent = result.is_correct
          ? result.completed
            ? result.current_version_completed
              ? '回答正确，已计入当前版本完成。'
              : '回答正确，已记入这次学习的版本；当前版仍需按教师安排完成。'
            : '回答正确，已记录本题结果。'
          : `还需要再想一想。${result.remaining_attempts === null ? '' : `剩余 ${result.remaining_attempts} 次机会。`}`;
        await this.options.changed();
      },
    );
  }
}
