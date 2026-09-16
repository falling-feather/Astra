import type {
  ContextActivityConfigRead,
  LearningActivityRuntimeEventCreate,
  StudyGateway,
} from '../portal/study-types';

export interface ParameterObservation {
  block_id: string;
  parameter: string;
  value: number;
}
export interface ActivityRecordState {
  status: 'loading' | 'ready' | 'saving' | 'error';
  message: string;
}
interface PendingObservation {
  observation: ParameterObservation | null;
  key: string;
  time: string;
  command?: LearningActivityRuntimeEventCreate;
}

/** Serial, memory-only observations; retries keep the exact command and learner cursor. */
export class ActivitySession {
  config?: ContextActivityConfigRead;
  private active = true;
  private loading?: Promise<ContextActivityConfigRead>;
  private sending = false;
  private failed = false;
  private sequence = 0;
  private queue: PendingObservation[] = [];
  private run = crypto.randomUUID();
  private group = crypto.randomUUID();
  private api: StudyGateway;
  private contextKey: string;
  private state: (state: ActivityRecordState) => void;
  private completed: () => Promise<void>;

  constructor(
    api: StudyGateway,
    contextKey: string,
    state: (state: ActivityRecordState) => void,
    completed: () => Promise<void>,
  ) {
    this.api = api;
    this.contextKey = contextKey;
    this.state = state;
    this.completed = completed;
  }

  hasPending(): boolean {
    return this.sending || this.queue.length > 0;
  }
  destroy(): void {
    this.active = false;
    this.queue = [];
  }
  async initialize(): Promise<ContextActivityConfigRead> {
    if (this.config) return this.config;
    if (this.loading) return this.loading;
    this.state({ status: 'loading', message: '正在确认本次实验的发布版本…' });
    this.loading = this.api
      .activityConfig(this.contextKey)
      .then(async (config) => {
        if (!this.active) return config;
        this.config = config;
        if (config.blocks.length) {
          this.queue.push({ observation: null, key: crypto.randomUUID(), time: new Date().toISOString() });
          await this.flush();
        } else
          this.state({
            status: 'ready',
            message: '此资源用于自由观察，完成方式以课程检查点或教师评阅为准。',
          });
        return config;
      })
      .catch((error) => {
        this.loading = undefined;
        if (this.active) this.report(error);
        throw error;
      });
    return this.loading;
  }
  async observe(observation: ParameterObservation): Promise<void> {
    const config = await this.initialize();
    if (!this.active) return;
    const control = config.blocks
      .find((block) => block.block_id === observation.block_id)
      ?.controls.find((item) => item.key === observation.parameter);
    if (
      !control ||
      !Number.isFinite(observation.value) ||
      observation.value < control.minimum ||
      observation.value > control.maximum
    )
      throw new Error('这项参数不在本次发布允许的记录范围内。');
    if (this.failed || this.queue.length >= 16) throw new Error('请先确认或重试尚未保存的操作记录。');
    this.queue.push({
      observation: structuredClone(observation),
      key: crypto.randomUUID(),
      time: new Date().toISOString(),
    });
    await this.flush();
  }
  async retry(): Promise<void> {
    this.failed = false;
    if (!this.config) await this.initialize();
    else await this.flush();
    if (this.active && !this.failed && !this.hasPending())
      this.state({ status: 'ready', message: '记录入口已确认，可以继续调整允许的参数。' });
  }
  private command(pending: PendingObservation): LearningActivityRuntimeEventCreate {
    const config = this.config!,
      sequence = this.sequence + 1;
    return {
      schema_version: 'astra-learning-activity-evidence-sidecar-v1',
      command: {
        schema_version: 'astra-learning-activity-event-v1',
        scope: config.scope,
        run: { run_id: this.run, group_id: this.group, sequence },
        versions: {
          manifest_version: config.manifest_version,
          content_version: config.content_version,
          event_schema_version: config.event_schema_version,
          rule_version: config.rule_version,
          generation: config.generation,
        },
        client_event_id: pending.key,
        event_type: pending.observation ? 'attempted' : 'started',
        evidence: pending.observation ? { operation: 'parameter-change', cursor: pending.observation } : {},
        occurred_at: pending.time,
      },
      snapshot: {
        state_schema_version: config.state_schema_version,
        applied_through_learner_sequence: sequence,
        data: { last_observation: pending.observation },
      },
    };
  }
  private report(error: unknown): void {
    this.failed = true;
    this.state({
      status: 'error',
      message: `${error instanceof Error ? error.message : '操作记录尚未确认'} ${this.queue.length ? '原请求仍保留，可重试；离页后不会保存在浏览器中。' : '请重新确认记录入口。'}`,
    });
  }
  private async flush(): Promise<void> {
    if (!this.active || this.sending || this.failed) return;
    this.sending = true;
    try {
      while (this.active && this.queue.length) {
        const pending = this.queue[0];
        pending.command ||= this.command(pending);
        this.state({ status: 'saving', message: '正在保存这次参数观察…' });
        const result = await this.api.activityEvent(this.contextKey, pending.command);
        if (!this.active) return;
        if (
          !['confirmed', 'reconciled'].includes(result.status) ||
          result.run_id !== this.run ||
          result.group_id !== this.group ||
          result.client_event_id !== pending.key ||
          result.learner_sequence !== pending.command.command.run.sequence
        )
          throw new Error('服务端回执与本次操作不一致，请先重试核对。');
        this.sequence = result.learner_sequence;
        this.queue.shift();
        const parameter =
          pending.observation &&
          this.config!.blocks.find(
            (block) => block.block_id === pending.observation!.block_id,
          )?.controls.find((control) => control.key === pending.observation!.parameter);
        this.state({
          status: 'ready',
          message: pending.observation
            ? `已记录 ${parameter?.label || pending.observation.parameter} = ${pending.observation.value}。操作记录不等同于掌握评价。`
            : '已绑定本次发布版本；改变允许的参数后记录观察。',
        });
        if (result.server_last_sequence! > result.server_sequence!) await this.completed();
      }
    } catch (error) {
      if (this.active) this.report(error);
    } finally {
      this.sending = false;
    }
  }
}
