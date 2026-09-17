import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import {
  AgentObservationSchema,
  DecisionRationaleSourceSchema,
  AgentStateSchema,
  SimulationAgentIntentSchema,
  type AgentObservation,
  type AgentState,
  type SimulationAgentIntent,
  type DecisionRationaleSource,
} from "@ronggang/contracts";
import {
  SimulationAgentRunV3Schema,
  SimulationAgentTaskV3Schema,
  SimulationDispatchPlanV3Schema,
  hashSimulationRuntimeValueV3,
  type SimulationAgentRunV3,
  type SimulationAgentTaskV3,
  type SimulationDispatchPlanV3,
} from "@ronggang/agent-runtime";
import type {
  SimulationQueuedEvent,
  SimulationRunEffects,
} from "@ronggang/world-core";

export const SimulationCollaborationRecordV3Version =
  "simulation-collaboration-record/3.0.0" as const;

export interface SimulationContributionRecordV3 {
  contributionId: string;
  contributionKind: "world_actor" | "professional_advisor";
  agentId: string;
  agentTemplateId: string;
  professionalRoleId: string;
  displayName: string;
  agentTaskId: string;
  agentRunId: string;
  observationId: string;
  intentId: string;
  outputHash: string;
  summary: string;
  rationale: string;
  evidenceRefs: string[];
  riskLevel: "low" | "medium" | "high";
  effects: SimulationRunEffects;
}

export interface SimulationStudentDecisionRecordV3 {
  decisionRef: string;
  decision: "accept" | "request_evidence" | "reject";
  rationale: string;
  rationaleSource?: DecisionRationaleSource;
  decidedAt: string;
}

export type SimulationPreparedEpisodeStatusV3 =
  | "suggestion_ready"
  | "decided"
  | "awaiting_gate"
  | "completed"
  | "failed";

export interface SimulationPreparedEpisodeRecordV3 {
  episodeId: string;
  event: SimulationQueuedEvent;
  dispatchPlanId: string;
  selectedSuggestionContributionId: string | null;
  studentDecision: SimulationStudentDecisionRecordV3 | null;
  resolutionProposalId: string | null;
  resolutionId: string | null;
  status: SimulationPreparedEpisodeStatusV3;
  failureCode:
    | "no_applicable_agent"
    | "agent_execution_failed"
    | "version_hash_drift"
    | "resolution_failed"
    | "teacher_rejected"
    | null;
  createdAt: string;
  updatedAt: string;
}

export interface SimulationCollaborationSessionRecordV3 {
  recordVersion: typeof SimulationCollaborationRecordV3Version;
  recordRevision: number;
  sessionId: string;
  simulationReleaseRef: {
    simulationId: string;
    releaseId: string;
    version: number;
    contentHash: string;
  };
  agentStates: AgentState[];
  observations: AgentObservation[];
  dispatchPlans: SimulationDispatchPlanV3[];
  tasks: SimulationAgentTaskV3[];
  runs: SimulationAgentRunV3[];
  intents: SimulationAgentIntent[];
  contributions: SimulationContributionRecordV3[];
  episodes: SimulationPreparedEpisodeRecordV3[];
  createdAt: string;
  updatedAt: string;
}

const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const hashPattern = /^[a-f0-9]{64}$/u;

function assertRecord(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`V3 协作记录损坏：${message}`);
}

function unique(values: readonly string[], label: string): void {
  assertRecord(new Set(values).size === values.length, `${label} ID 重复`);
  assertRecord(values.every((value) => idPattern.test(value)), `${label} ID 非法`);
}

function validEffects(effects: SimulationRunEffects): boolean {
  return Array.isArray(effects.variables)
    && Array.isArray(effects.entities)
    && Array.isArray(effects.facts)
    && Array.isArray(effects.relationships)
    && Array.isArray(effects.resources)
    && Number.isInteger(effects.advanceMinutes)
    && effects.advanceMinutes >= 0
    && (effects.setPaused === null || typeof effects.setPaused === "boolean")
    && (effects.ending === null || typeof effects.ending === "object");
}

export function validateSimulationCollaborationRecordV3(
  value: SimulationCollaborationSessionRecordV3,
): SimulationCollaborationSessionRecordV3 {
  assertRecord(value.recordVersion === SimulationCollaborationRecordV3Version,
    "记录版本不支持");
  assertRecord(Number.isInteger(value.recordRevision) && value.recordRevision >= 0,
    "修订号非法");
  assertRecord(idPattern.test(value.sessionId), "会话 ID 非法");
  assertRecord(hashPattern.test(value.simulationReleaseRef.contentHash),
    "世界发布哈希非法");

  const agentStates = value.agentStates.map((item) => AgentStateSchema.parse(item));
  const observations = value.observations.map((item) => (
    AgentObservationSchema.parse(item)
  ));
  const dispatchPlans = value.dispatchPlans.map((item) => (
    SimulationDispatchPlanV3Schema.parse(item)
  ));
  const tasks = value.tasks.map((item) => SimulationAgentTaskV3Schema.parse(item));
  const runs = value.runs.map((item) => SimulationAgentRunV3Schema.parse(item));
  const intents = value.intents.map((item) => SimulationAgentIntentSchema.parse(item));

  unique(agentStates.map((item) => item.agentStateId), "智能体状态");
  unique(observations.map((item) => item.observationId), "观察");
  unique(dispatchPlans.map((item) => item.dispatchPlanId), "派发计划");
  unique(tasks.map((item) => item.agentTaskId), "任务");
  unique(runs.map((item) => item.agentRunId), "运行");
  unique(intents.map((item) => item.intentId), "意图");
  unique(value.contributions.map((item) => item.contributionId), "贡献");
  unique(value.episodes.map((item) => item.episodeId), "Episode");
  unique(value.episodes.map((item) => item.event.eventId), "Episode 世界事件");

  const stateById = new Map(agentStates.map((item) => [item.agentStateId, item]));
  const observationById = new Map(observations.map((item) => [item.observationId, item]));
  const planById = new Map(dispatchPlans.map((item) => [item.dispatchPlanId, item]));
  const taskById = new Map(tasks.map((item) => [item.agentTaskId, item]));
  const runById = new Map(runs.map((item) => [item.agentRunId, item]));
  const intentById = new Map(intents.map((item) => [item.intentId, item]));
  const contributionById = new Map(
    value.contributions.map((item) => [item.contributionId, item]),
  );

  for (const state of agentStates) {
    assertRecord(state.sessionId === value.sessionId, "智能体状态跨会话");
  }
  for (const observation of observations) {
    assertRecord(observation.sessionId === value.sessionId, "观察跨会话");
    const state = stateById.get(observation.agentStateId);
    assertRecord(state?.agentId === observation.agentId, "观察与智能体状态身份不一致");
  }
  for (const plan of dispatchPlans) {
    assertRecord(plan.sessionId === value.sessionId, "派发计划跨会话");
  }
  for (const task of tasks) {
    const plan = planById.get(task.dispatchPlanId);
    const state = stateById.get(task.agentStateId);
    const observation = observationById.get(task.observationId);
    assertRecord(task.sessionId === value.sessionId, "任务跨会话");
    assertRecord(plan?.sourceWorldEventId === task.sourceWorldEventId,
      "任务与派发计划来源不一致");
    assertRecord(state?.agentId === task.agentId, "任务与智能体状态身份不一致");
    assertRecord(observation?.agentId === task.agentId, "任务与观察身份不一致");
  }
  for (const run of runs) {
    const task = taskById.get(run.agentTaskId);
    assertRecord(run.sessionId === value.sessionId, "运行跨会话");
    assertRecord(task?.agentId === run.agentId, "运行与任务身份不一致");
    assertRecord(task?.observationId === run.observationId, "运行与任务观察不一致");
    if (run.status === "succeeded") {
      const intent = run.intentId ? intentById.get(run.intentId) : undefined;
      assertRecord(intent?.agentRunId === run.agentRunId, "成功运行缺少真实意图");
      assertRecord(intent.agentTaskId === run.agentTaskId, "意图与任务引用不一致");
    }
  }
  for (const contribution of value.contributions) {
    const task = taskById.get(contribution.agentTaskId);
    const run = runById.get(contribution.agentRunId);
    const observation = observationById.get(contribution.observationId);
    const intent = intentById.get(contribution.intentId);
    assertRecord(idPattern.test(contribution.contributionId), "贡献 ID 非法");
    assertRecord(task?.agentId === contribution.agentId, "贡献任务引用不存在");
    assertRecord(run?.status === "succeeded" && run.agentId === contribution.agentId,
      "贡献运行必须真实成功");
    assertRecord(observation?.agentId === contribution.agentId, "贡献观察引用不存在");
    assertRecord(intent?.agentRunId === contribution.agentRunId, "贡献意图引用不存在");
    assertRecord(run.outputHash === contribution.outputHash, "贡献输出哈希漂移");
    assertRecord(validEffects(contribution.effects), "贡献效果结构非法");
    assertRecord(run.effectPayloadHash
      === hashSimulationRuntimeValueV3(contribution.effects), "贡献效果哈希漂移");
    assertRecord(contribution.summary.trim().length > 0, "贡献摘要为空");
    assertRecord(contribution.rationale.trim().length > 0, "贡献依据为空");
    assertRecord(contribution.evidenceRefs.length > 0, "贡献缺少依据引用");
  }
  for (const episode of value.episodes) {
    if (episode.studentDecision?.rationaleSource !== undefined) {
      DecisionRationaleSourceSchema.parse(episode.studentDecision.rationaleSource);
    }
    const plan = planById.get(episode.dispatchPlanId);
    assertRecord(episode.event.sessionId === value.sessionId, "Episode 事件跨会话");
    assertRecord(plan?.sourceWorldEventId === episode.event.eventId,
      "Episode 与派发计划来源不一致");
    if (episode.selectedSuggestionContributionId !== null) {
      const contribution = contributionById.get(
        episode.selectedSuggestionContributionId,
      );
      assertRecord(contribution !== undefined, "Episode 建议贡献引用不存在");
      assertRecord(plan.decisions.some((decision) => (
        decision.agentId === contribution.agentId
          && decision.decision === "selected"
      )), "Episode 建议并非来自派发计划选中智能体");
    }
    if (episode.status === "suggestion_ready") {
      assertRecord(episode.studentDecision === null
        && episode.resolutionId === null
        && episode.failureCode === null, "建议就绪态提前产生决定或结果");
    }
    if (episode.status === "failed") {
      assertRecord(episode.failureCode !== null,
        "失败 Episode 必须显式记录失败原因");
      if (episode.failureCode !== "teacher_rejected") {
        assertRecord(episode.resolutionId === null
          || episode.resolutionProposalId !== null,
        "编排失败必须零写回，世界解析失败则须保留真实提案引用");
      }
    }
    if (episode.status === "completed" || episode.status === "awaiting_gate") {
      assertRecord(episode.resolutionId !== null
        && episode.resolutionProposalId !== null, "已解析 Episode 缺少真实解析引用");
    }
  }
  return structuredClone({
    ...value,
    agentStates,
    observations,
    dispatchPlans,
    tasks,
    runs,
    intents,
  });
}

export class SimulationCollaborationStoreConflictError extends Error {
  constructor(
    public readonly expectedRevision: number,
    public readonly actualRevision: number,
  ) {
    super(`V3 协作记录版本冲突：期望 ${expectedRevision}，实际 ${actualRevision}`);
    this.name = "SimulationCollaborationStoreConflictError";
  }
}

export interface SimulationCollaborationStoreV3 {
  create(record: SimulationCollaborationSessionRecordV3): Promise<void>;
  load(sessionId: string): Promise<SimulationCollaborationSessionRecordV3 | null>;
  compareAndSet(
    sessionId: string,
    expectedRevision: number,
    next: SimulationCollaborationSessionRecordV3,
  ): Promise<void>;
}

export class InMemorySimulationCollaborationStoreV3
implements SimulationCollaborationStoreV3 {
  readonly #records = new Map<string, SimulationCollaborationSessionRecordV3>();

  async create(record: SimulationCollaborationSessionRecordV3): Promise<void> {
    const parsed = validateSimulationCollaborationRecordV3(record);
    const current = this.#records.get(parsed.sessionId);
    if (current) {
      throw new SimulationCollaborationStoreConflictError(-1, current.recordRevision);
    }
    this.#records.set(parsed.sessionId, parsed);
  }

  async load(sessionId: string): Promise<SimulationCollaborationSessionRecordV3 | null> {
    const record = this.#records.get(sessionId);
    return record ? structuredClone(record) : null;
  }

  async compareAndSet(
    sessionId: string,
    expectedRevision: number,
    next: SimulationCollaborationSessionRecordV3,
  ): Promise<void> {
    const current = this.#records.get(sessionId);
    if (!current) throw new Error(`V3 协作会话不存在：${sessionId}`);
    if (current.recordRevision !== expectedRevision) {
      throw new SimulationCollaborationStoreConflictError(
        expectedRevision,
        current.recordRevision,
      );
    }
    const parsed = validateSimulationCollaborationRecordV3(next);
    assertRecord(parsed.sessionId === sessionId
      && parsed.recordRevision === expectedRevision + 1, "CAS 后继修订非法");
    this.#records.set(sessionId, parsed);
  }
}

function sessionFileName(sessionId: string): string {
  return `${createHash("sha256").update(sessionId).digest("hex")}.json`;
}

export class JsonFileSimulationCollaborationStoreV3
implements SimulationCollaborationStoreV3 {
  constructor(private readonly directory: string) {}

  async create(record: SimulationCollaborationSessionRecordV3): Promise<void> {
    const parsed = validateSimulationCollaborationRecordV3(record);
    const current = await this.load(parsed.sessionId);
    if (current) {
      throw new SimulationCollaborationStoreConflictError(-1, current.recordRevision);
    }
    await this.#write(parsed);
  }

  async load(sessionId: string): Promise<SimulationCollaborationSessionRecordV3 | null> {
    let text: string;
    try {
      text = await readFile(this.#pathFor(sessionId), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    const record = validateSimulationCollaborationRecordV3(
      JSON.parse(text) as SimulationCollaborationSessionRecordV3,
    );
    assertRecord(record.sessionId === sessionId, "记录文件与请求会话不一致");
    return record;
  }

  async compareAndSet(
    sessionId: string,
    expectedRevision: number,
    next: SimulationCollaborationSessionRecordV3,
  ): Promise<void> {
    const current = await this.load(sessionId);
    if (!current) throw new Error(`V3 协作会话不存在：${sessionId}`);
    if (current.recordRevision !== expectedRevision) {
      throw new SimulationCollaborationStoreConflictError(
        expectedRevision,
        current.recordRevision,
      );
    }
    const parsed = validateSimulationCollaborationRecordV3(next);
    assertRecord(parsed.sessionId === sessionId
      && parsed.recordRevision === expectedRevision + 1, "CAS 后继修订非法");
    await this.#write(parsed);
  }

  #pathFor(sessionId: string): string {
    return resolve(this.directory, sessionFileName(sessionId));
  }

  async #write(record: SimulationCollaborationSessionRecordV3): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const target = this.#pathFor(record.sessionId);
    const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
    const file = await open(temporary, "wx");
    let renamed = false;
    try {
      await file.writeFile(`${JSON.stringify(record)}\n`, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    try {
      await rename(temporary, target);
      renamed = true;
    } finally {
      if (!renamed) await unlink(temporary).catch(() => undefined);
    }
  }
}
