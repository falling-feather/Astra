import type {
  AdminCollaborationEpisode,
  AgentTopologyManifest,
  AdminAgentCollaborationEpisodeV3,
  Evidence,
  OperationsHealthSnapshot,
  SessionTracePage,
} from "@ronggang/contracts";
import type { FlagshipAgentTopologyV3 } from "./world-v3-business";

export type AgentRuntimeState =
  | "idle"
  | "selected"
  | "completed"
  | "skipped"
  | "degraded"
  | "failed";

export interface AdminTopologyAgentView {
  agentId: string;
  title: string;
  groupId: string;
  responsibility: string;
  subscribedEventTypes: string[];
  inputTypes: string[];
  outputTypes: string[];
  allowedActions: string[];
  forbiddenActions: string[];
  teacherGateRequired: boolean | null;
  runtimeState: AgentRuntimeState;
  runtimeReason: string;
  contributionSummary: string | null;
}

export interface AdminTopologyView {
  schemaVersion: string;
  generatedAt: string;
  groups: Array<{
    groupId: string;
    title: string;
    responsibility: string;
    order: number;
  }>;
  agents: AdminTopologyAgentView[];
  edgeCount: number;
  execution: {
    mode: "live" | "deterministic" | "deterministic_demo" | "degraded";
    providerId: string | null;
    modelId: string | null;
    traceRefs: string[];
    promptTemplateRefs: string[];
    failedAgentIds: string[];
    totalLatencyMs: number;
    estimatedCostMicrounits: number;
    recoveryActions: string[];
  } | null;
  episodeStatus: string | null;
  source: "v2" | "flagship_v3";
}

export interface AdminLogEntry {
  id: string;
  occurredAt: string;
  category: string;
  summary: string;
  level: "info" | "warning" | "error";
  technicalRef: string | null;
  provider: string | null;
}

export function buildAdminTopologyView(
  manifest: AgentTopologyManifest,
  episode: AdminCollaborationEpisode | null,
): AdminTopologyView {
  const decisions = new Map(
    episode?.affectedAgents.map((item) => [item.agent.agentId, item]) ?? [],
  );
  const contributions = new Map(
    episode?.contributions.map((item) => [item.agent.agentId, item]) ?? [],
  );
  const failedAgentIds = new Set(episode?.execution.failedAgentIds ?? []);
  return {
    schemaVersion: manifest.schemaVersion,
    generatedAt: manifest.generatedAt,
    groups: manifest.groups,
    edgeCount: manifest.edges.length,
    source: "v2",
    agents: manifest.agents.map((agent) => {
      const decision = decisions.get(agent.agentId);
      const contribution = contributions.get(agent.agentId);
      let runtimeState: AgentRuntimeState = "idle";
      let runtimeReason = "当前会话尚未调度该智能体";
      if (decision?.decision === "skipped") {
        runtimeState = "skipped";
        runtimeReason = decision.reason;
      }
      if (decision?.decision === "selected") {
        runtimeState = episode?.execution.mode === "degraded"
          ? "degraded"
          : "selected";
        runtimeReason = decision.reason;
      }
      if (failedAgentIds.has(agent.agentId) || contribution?.status === "failed") {
        runtimeState = "failed";
        runtimeReason = contribution?.rationale ?? "本轮执行失败";
      }
      return {
        ...agent,
        runtimeState,
        runtimeReason,
        contributionSummary: contribution?.summary ?? null,
      };
    }),
    execution: episode ? {
      mode: episode.execution.mode,
      providerId: episode.execution.providerId,
      modelId: null,
      traceRefs: episode.execution.traceRefs,
      promptTemplateRefs: [],
      failedAgentIds: episode.execution.failedAgentIds,
      totalLatencyMs: 0,
      estimatedCostMicrounits: 0,
      recoveryActions: [],
    } : null,
    episodeStatus: episode?.status ?? null,
  };
}

export function buildAdminTopologyViewV3(
  manifest: FlagshipAgentTopologyV3,
  episode: AdminAgentCollaborationEpisodeV3,
): AdminTopologyView {
  const decisions = new Map(
    episode.dispatchPlan?.decisions.map((item) => [item.agentId, item]) ?? [],
  );
  const contributions = new Map(
    episode.contributions.map((item) => [item.agentId, item]) ?? [],
  );
  const failedAgentIds = new Set(episode.execution.failedAgentIds);
  return {
    schemaVersion: manifest.schemaVersion,
    generatedAt: manifest.generatedAt,
    groups: manifest.groups,
    edgeCount: manifest.agents.reduce(
      (count, agent) => count + agent.subscribedEventTypes.length,
      0,
    ),
    source: "flagship_v3",
    agents: manifest.agents.map((agent) => {
      const decision = decisions.get(agent.agentId);
      const contribution = contributions.get(agent.agentId);
      let runtimeState: AgentRuntimeState = "idle";
      let runtimeReason = "当前世界事件尚未调度该智能体";
      if (decision?.decision === "skipped") {
        runtimeState = "skipped";
        runtimeReason = decision.reason;
      }
      if (decision?.decision === "selected") {
        runtimeState = episode.execution.executionMode === "degraded"
          ? "degraded"
          : "selected";
        runtimeReason = decision.reason;
      }
      if (contribution?.status === "ready") {
        runtimeState = episode.execution.executionMode === "degraded"
          ? "degraded"
          : "completed";
        runtimeReason = contribution.rationale;
      }
      if (contribution?.status === "rejected") {
        runtimeState = "completed";
        runtimeReason = `已完成运行，但贡献被后续规则拒绝：${contribution.rationale}`;
      }
      if (failedAgentIds.has(agent.agentId) || contribution?.status === "failed") {
        runtimeState = "failed";
        runtimeReason = contribution?.rationale ?? "本轮执行失败";
      }
      return {
        agentId: agent.agentId,
        title: agent.displayName,
        groupId: agent.groupId,
        responsibility: agent.responsibility,
        subscribedEventTypes: agent.subscribedEventTypes,
        inputTypes: agent.affectedObjectSelectors.map((selector) => (
          selector.objectId ? `${selector.objectType}:${selector.objectId}` : selector.objectType
        )),
        outputTypes: [agent.contributionKind],
        allowedActions: agent.toolCapabilityRefs,
        forbiddenActions: agent.forbiddenActions,
        teacherGateRequired: null,
        runtimeState,
        runtimeReason,
        contributionSummary: contribution?.summary ?? null,
      };
    }),
    execution: {
      mode: episode.execution.executionMode,
      providerId: episode.execution.providerId,
      modelId: episode.execution.modelId,
      traceRefs: episode.execution.traceRefs,
      promptTemplateRefs: episode.execution.promptTemplateRefs,
      failedAgentIds: episode.execution.failedAgentIds,
      totalLatencyMs: episode.execution.totalLatencyMs,
      estimatedCostMicrounits: episode.execution.estimatedCostMicrounits,
      recoveryActions: episode.execution.recoveryActions,
    },
    episodeStatus: episode.status,
  };
}

export function tracePageToAdminLogs(
  page: SessionTracePage,
): AdminLogEntry[] {
  return page.records.map((record) => ({
    id: record.traceId,
    occurredAt: record.timestamp,
    category: `${record.lane} · ${record.kind}`,
    summary: `${record.title}：${record.summary}`,
    level: record.status === "failed" || record.status === "dead_lettered"
      ? "error"
      : record.status === "degraded" || record.status === "retry_scheduled"
        ? "warning"
        : "info",
    technicalRef: record.traceId,
    provider: record.provider,
  }));
}

export function tracePageToAdminEvents(
  page: SessionTracePage,
): AdminLogEntry[] {
  return page.records.filter((record) => (
    record.lane === "world" && record.kind === "world_event"
  )).map((record) => ({
    id: record.eventId ?? record.traceId,
    occurredAt: record.timestamp,
    category: record.eventType ?? "world_event",
    summary: record.summary,
    level: record.status === "failed"
      ? "error"
      : record.status === "degraded"
        ? "warning"
        : "info",
    technicalRef: null,
    provider: null,
  }));
}

export function evidenceReferenceSummary(evidence: Evidence): string {
  const references = [
    ...evidence.materialRefs,
    ...evidence.eventRefs,
    ...evidence.observationRefs,
    ...evidence.artifactRevisionRefs,
    ...evidence.processingTaskRefs,
  ];
  return references.length > 0 ? references.join(" · ") : "无外部引用";
}

export function operationsNotices(
  health: OperationsHealthSnapshot,
  episode: AdminCollaborationEpisode | null,
): string[] {
  const notices: string[] = [];
  if (episode) {
    notices.push(
      episode.execution.mode === "live"
        ? "当前协作 Episode 使用 Live 执行层。"
        : episode.execution.mode === "degraded"
          ? "当前协作 Episode 已明确标记为降级运行。"
          : "当前协作 Episode 使用确定性演示执行，不伪装为 Live。",
    );
  } else {
    notices.push("当前会话尚无可读取的 V2 管理员协作 Episode。");
  }
  const failed = health.agentTasks.failed + health.agentTasks.deadLettered;
  if (failed > 0) notices.push(`智能体任务存在 ${failed} 项失败或死信，需查看运行追踪。`);
  if (health.sessions.recoveryFailed > 0) {
    notices.push(`有 ${health.sessions.recoveryFailed} 个会话处于恢复失败状态。`);
  }
  if (health.outbox.pending === 0 && failed === 0) {
    notices.push("当前没有待投递事件或失败智能体任务。 ");
  }
  return notices;
}
