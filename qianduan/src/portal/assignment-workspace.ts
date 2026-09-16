import type * as D from './study-types';
import { area, badge, e, empty, field, selectField, when } from './presentation';
import { flowButton as button, WorkflowView } from './workflow-view';

const answer = (content: Record<string, unknown>) =>
  Object.values(content)
    .map((value) => (typeof value === 'string' ? value : JSON.stringify(value)))
    .join('\n');

/** A task body is the opened snapshot; the compatibility submission is only a list summary. */
export class AssignmentWorkspace extends WorkflowView {
  private opened?: D.AssignmentWorkspaceRead;
  private history?: D.AssignmentHistoryRead;
  private selected?: D.AssignmentAttemptRead;
  private showHistory = false;
  private offset = 0;
  private openingKey = crypto.randomUUID();

  constructor(
    root: HTMLElement,
    private api: D.StudyGateway,
    private options: {
      assignmentId?: number;
      classId?: number;
      submissionId?: number;
      teacher: boolean;
      changed(): Promise<void>;
      notify(message: string): void;
    },
  ) {
    super(root, options.notify);
  }
  mount(): void {
    void this.run(() => this.load());
  }
  private async load(): Promise<void> {
    if (this.options.teacher) {
      this.history = await this.api.submissionHistory(this.options.submissionId!, this.offset);
      this.selected =
        this.history.attempts.find((item) => item.id === this.selected?.id) ||
        this.history.attempts.find((item) => item.id === this.history!.current_attempt_id) ||
        this.history.attempts[0];
      this.showHistory = true;
    } else {
      this.opened = await this.api.openAssignment(this.options.assignmentId!, {
        client_request_id: this.openingKey,
        class_id: this.options.classId,
      });
      if (this.showHistory && this.opened.submission_id)
        this.history = await this.api.submissionHistory(this.opened.submission_id, this.offset);
    }
    this.draw();
  }
  private draw(): void {
    let body = '';
    if (this.opened && !this.options.teacher) {
      const row = this.opened,
        task = row.assignment,
        grade = row.grade;
      body = `<h2>${e(task.title)}</h2><p class="portal-note">${row.context ? `第 ${row.context.release_number} 个发布版本` : '原班级作业'} · 截止 ${when(typeof task.due_at === 'string' ? task.due_at : null)}</p>${row.context?.newer_release_available ? '<p class="portal-note">课程已有新版；这次回答继续使用打开时的要求，是否计入新版由教师的补做安排决定。</p>' : ''}<div class="assignment-instructions">${e(task.description || '根据课程要求完成回答。')}</div><form data-flow-form="answer" data-flow-dirty>${row.can_submit ? area(row.grade?.status === 'returned' ? '修改后的回答' : '我的回答', 'answer', row.attempt ? answer(row.attempt.content) : '', true) : `<h3>这次提交</h3><div class="submission-answer">${e(row.attempt ? answer(row.attempt.content) : '当前版本没有新提交；已沿用的结果可在学习记录中查看。')}</div>`}${row.can_submit ? '<button class="primary-button" type="submit">提交回答</button>' : `<p class="portal-note">${e(row.submit_block_reason)}</p>`}</form><section class="portal-feedback"><h3>教师反馈</h3>${grade ? `<p>${badge(grade.status)} · ${grade.score ?? '—'} / ${grade.max_score ?? '原满分未留存'}</p><p>${e(grade.feedback || '教师未填写文字反馈。')}</p>` : empty('尚未评阅。')}</section><div class="portal-actions">${button('重新读取作业', 'reload')}${row.submission_id ? button('历次回答与评分', 'history') : ''}</div>`;
    }
    if (this.showHistory && this.history) {
      const history = this.history;
      body += `<section class="portal-surface"><h2>提交与评分记录</h2>${
        history.attempts
          .map(
            (attempt) =>
              `<details ${this.options.teacher && this.selected?.id === attempt.id ? 'open' : ''}><summary>第 ${attempt.attempt_number} 次提交 · ${when(attempt.submitted_at)}${attempt.id === history.current_attempt_id ? ' · 当前稿' : ''}</summary><p class="portal-note">${attempt.release_number ? `课程第 ${attempt.release_number} 个发布版本` : '旧提交未记录发布版本'}</p><div class="submission-answer">${e(answer(attempt.content))}</div>${
                history.grades
                  .filter((grade) => grade.attempt_id === attempt.id)
                  .map(
                    (grade) =>
                      `<div class="portal-list-row"><span>${badge(grade.status)} · ${grade.score ?? '—'} / ${grade.max_score ?? '未知满分'}<small>${when(grade.graded_at)} · 第 ${grade.revision} 次评阅${grade.point_delta == null ? '' : ` · 积分变化 ${grade.point_delta > 0 ? '+' : ''}${grade.point_delta}`}</small><p>${e(grade.feedback_retained ? grade.feedback || '未填写文字反馈' : '旧反馈正文未留存')}</p></span></div>`,
                  )
                  .join('') || '<p>尚未评阅。</p>'
              }${this.options.teacher ? button(attempt.id === history.current_attempt_id ? '评阅这次提交' : '复核历史评分', 'select-attempt', `data-id="${attempt.id}"`) : ''}</details>`,
          )
          .join('') || empty('没有可回读的提交记录。')
      }<div class="portal-pagination">${history.offset ? button('上一页', 'history-page', `data-offset="${Math.max(0, history.offset - history.limit)}"`) : ''}${history.next_offset !== null ? button('下一页', 'history-page', `data-offset="${history.next_offset}"`) : ''}</div></section>`;
      if (this.options.teacher && this.selected) {
        const attempt = this.selected,
          latest = history.grades.find((grade) => grade.attempt_id === attempt.id),
          historical = attempt.id !== history.current_attempt_id;
        const max = attempt.assignment_snapshot.max_score;
        body += `<form data-flow-form="grade" data-flow-dirty class="portal-surface"><h2>${historical ? '复核历史稿' : '评阅当前稿'} · 第 ${attempt.attempt_number} 次提交</h2><p>${e(attempt.assignment_snapshot.title || '旧作业')}</p><p>${e(attempt.assignment_snapshot.description || '')}</p><p class="portal-note">本次提交的满分：${typeof max === 'number' ? max : '原记录未留存，无法重新给分'}。${historical ? '评分会追加到历史，不覆盖当前稿和当前稿积分。' : '重新评分会保留旧分数，积分仅按差额调整。'}</p>${selectField(
          '处理结果',
          'status',
          [
            { value: 'graded', label: '确认评分' },
            { value: 'returned', label: '退回修改' },
          ],
          latest?.status || 'graded',
        )}${field('分数（退回时可以留空）', 'score', latest?.score ?? '', { type: 'number', min: 0 })}${area('教师反馈（退回时必填）', 'feedback', latest?.feedback || '')}${historical ? '<label class="portal-checkbox"><input type="checkbox" name="historical" required/>我已核对这是历史提交，确定复核</label>' : ''}<button class="primary-button" type="submit" ${typeof max !== 'number' ? 'disabled' : ''}>保存评阅</button>${button('重新读取提交', 'reload')}</form>`;
      }
    }
    this.paint(body);
    this.dirty = false;
  }
  protected async click(target: HTMLElement): Promise<void> {
    if (target.dataset.flow === 'reload') {
      if (this.allowReload()) await this.load();
    } else if (target.dataset.flow === 'history' || target.dataset.flow === 'history-page') {
      if (!this.allowReload()) return;
      this.offset = Number(target.dataset.offset || 0);
      this.showHistory = true;
      await this.load();
    } else if (target.dataset.flow === 'select-attempt') {
      if (!this.allowReload()) return;
      this.selected = this.history?.attempts.find((item) => item.id === Number(target.dataset.id));
      this.draw();
    }
  }
  protected async submit(form: HTMLFormElement, data: FormData): Promise<void> {
    const value = (key: string) => String(data.get(key) || '').trim();
    if (form.dataset.flowForm === 'answer') {
      const row = this.opened!;
      if (!row.can_submit || !value('answer')) throw new Error('请确认作业开放，并填写回答。');
      await this.write(
        {
          context_key: row.context?.context_key,
          class_id: row.class_id,
          expected_submission_revision: row.submission_revision,
          expected_assignment_sha256: row.assignment_sha256,
          content: { answer: value('answer') },
        },
        (body) => this.api.submit(row.assignment_id, body),
        async () => {
          this.dirty = false;
          await this.load();
          await this.options.changed();
          this.notify('回答已提交，原记录继续保留。');
        },
      );
    } else if (form.dataset.flowForm === 'grade') {
      const row = this.selected!,
        state = this.history!,
        latest = state.grades.find((grade) => grade.attempt_id === row.id);
      const status = value('status') as 'graded' | 'returned',
        score = value('score') === '' ? null : Number(value('score'));
      if (
        (status === 'graded' && score === null) ||
        (score !== null &&
          (!Number.isInteger(score) || score < 0 || score > Number(row.assignment_snapshot.max_score)))
      )
        throw new Error('请按这次提交的满分填写有效整数分数。');
      if (status === 'returned' && !value('feedback')) throw new Error('请说明需要修改的内容。');
      await this.write(
        {
          expected_submission_revision: state.revision,
          expected_grade_revision: latest?.revision || 0,
          status,
          score,
          feedback: value('feedback'),
          allow_historical: data.has('historical'),
        },
        (body) => this.api.grade(row.id, body),
        async () => {
          this.dirty = false;
          await this.load();
          await this.options.changed();
          this.notify('评阅已留档。');
        },
      );
    }
  }
}
