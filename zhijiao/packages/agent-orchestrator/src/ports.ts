import type {
  AgentDispatchPlan,
  AgentRunResult,
  AgentTask,
  DeadLetterRecord,
  DispatchAttempt,
  ScenarioPackage,
  StateProjection,
  WorldEvent,
} from "@ronggang/contracts";

export interface AgentTaskHandlerInput {
  task: AgentTask;
  triggerEvent: WorldEvent;
  projection: StateProjection;
  scenario: ScenarioPackage;
}

export interface AgentTaskHandler {
  readonly handlerId: string;
  matches(task: AgentTask, triggerEvent: WorldEvent): boolean;
  run(input: AgentTaskHandlerInput): Promise<AgentRunResult>;
}

export interface ClaimAgentTaskInput {
  sessionId: string;
  sessionEpoch: string;
  workerId: string;
  now: string;
  leaseDurationMs: number;
  leaseToken: string;
}

export interface CompleteAgentTaskInput {
  taskId: string;
  leaseToken: string;
  workerId: string;
  completedAt: string;
  status: "completed" | "degraded";
  duplicateSuppressed: boolean;
  attemptId: string;
}

export interface AssertAgentTaskLeaseInput {
  taskId: string;
  leaseToken: string;
  workerId: string;
  now: string;
}

export interface ReconcileAgentTaskResultInput {
  taskId: string;
  status: "completed" | "degraded";
  reconciledAt: string;
  workerId: string;
  attemptId: string;
}

export interface FailAgentTaskInput {
  taskId: string;
  leaseToken: string;
  workerId: string;
  failedAt: string;
  errorCode: string;
  retryable: boolean;
  retryAt: string;
  attemptId: string;
  deadLetterId: string;
}

export interface FailAgentTaskResult {
  task: AgentTask;
  deadLetter: DeadLetterRecord | null;
}

export interface AgentTaskStore {
  enqueue(tasks: readonly AgentTask[]): Promise<AgentTask[]>;
  enqueuePlan(plan: AgentDispatchPlan): Promise<AgentDispatchPlan>;
  claimNext(input: ClaimAgentTaskInput): Promise<AgentTask | null>;
  assertCurrentLease(input: AssertAgentTaskLeaseInput): Promise<AgentTask>;
  reconcileWorldResult(input: ReconcileAgentTaskResultInput): Promise<AgentTask>;
  rebase(
    taskId: string,
    leaseToken: string,
    expectedStateVersion: number,
    updatedAt: string,
  ): Promise<AgentTask>;
  complete(input: CompleteAgentTaskInput): Promise<AgentTask>;
  fail(input: FailAgentTaskInput): Promise<FailAgentTaskResult>;
  list(sessionId: string): Promise<AgentTask[]>;
  listDispatchPlans(sessionId: string): Promise<AgentDispatchPlan[]>;
  listAttempts(sessionId: string): Promise<DispatchAttempt[]>;
  listDeadLetters(sessionId: string): Promise<DeadLetterRecord[]>;
  reset(sessionId: string): Promise<void>;
}

export class AgentTaskLeaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentTaskLeaseError";
  }
}

export class AgentTaskHandlerNotFoundError extends Error {
  constructor(task: AgentTask) {
    super(`没有注册智能体任务处理器：${task.agentId}/${task.triggerEventType}`);
    this.name = "AgentTaskHandlerNotFoundError";
  }
}
