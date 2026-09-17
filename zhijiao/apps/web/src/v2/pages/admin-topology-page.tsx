import { useCallback, useMemo, useState } from "react";
import {
  Activity,
  Bot,
  ChevronDown,
  CircleDot,
  LoaderCircle,
  Network,
  Radio,
  ShieldAlert,
  Workflow,
} from "lucide-react";
import type { AdminGateway } from "../admin-gateway";
import {
  buildAdminTopologyView,
  buildAdminTopologyViewV3,
  type AdminTopologyView,
  type AgentRuntimeState,
} from "../admin-models";
import { useAdminResource } from "./use-admin-resource";
import type {
  FlagshipBusinessWorldView,
  FlagshipWorkReviewView,
} from "../world-v3-business";
import type { FlagshipExperienceViewV4 } from "../flagship-v4";

const runtimeLabels: Record<AgentRuntimeState, string> = {
  idle: "空闲",
  selected: "已选中",
  completed: "已完成",
  skipped: "已跳过",
  degraded: "已降级",
  failed: "失败",
};

export interface AdminTopologyLoad {
  topology: AdminTopologyView;
  episodeError: string | null;
  world: FlagshipBusinessWorldView | null;
  review: FlagshipWorkReviewView | null;
  groundedExperience?: FlagshipExperienceViewV4 | null;
}

export async function loadAdminTopology(
  gateway: AdminGateway,
  sessionId: string,
  bindingId: string,
  signal?: AbortSignal,
): Promise<AdminTopologyLoad> {
  const descriptor = await gateway.getSessionExperienceDescriptor(
    sessionId,
    bindingId,
    signal,
  );
  if (
    descriptor.experienceGeneration !== "standard_v2"
    && gateway.getFlagshipTopology
    && gateway.getFlagshipEpisode
    && gateway.getFlagshipWorld
    && gateway.getFlagshipWorkReview
  ) {
    const [manifest, episode, world, review, groundedExperience] = await Promise.all([
        gateway.getFlagshipTopology(sessionId, bindingId, signal),
        gateway.getFlagshipEpisode(sessionId, bindingId, signal),
        gateway.getFlagshipWorld(sessionId, bindingId, signal),
        gateway.getFlagshipWorkReview(sessionId, bindingId, signal),
        descriptor.experienceGeneration === "flagship_v4"
          ? gateway.getFlagshipExperienceV4
            ? gateway.getFlagshipExperienceV4(sessionId, bindingId, signal)
            : Promise.reject(new Error("客户端缺少描述符要求的 V4 管理员体验端口"))
          : Promise.resolve(null),
      ]);
    return {
      topology: buildAdminTopologyViewV3(manifest, episode),
      episodeError: null,
      world,
      review,
      groundedExperience,
    };
  }
  if (descriptor.experienceGeneration !== "standard_v2") {
    throw new Error("客户端缺少描述符要求的旗舰管理员运行端口");
  }
  const manifest = await gateway.getTopology(signal);
  try {
    const episode = await gateway.getEpisode(sessionId, bindingId, signal);
    return {
      topology: buildAdminTopologyView(manifest, episode),
      episodeError: null,
      world: null,
      review: null,
      groundedExperience: null,
    };
  } catch (cause) {
    return {
      topology: buildAdminTopologyView(manifest, null),
      episodeError: cause instanceof Error ? cause.message : "当前会话运行状态不可用",
      world: null,
      review: null,
      groundedExperience: null,
    };
  }
}

export function AdminTopologySurface({
  topology,
  episodeError = null,
  world = null,
  review = null,
  groundedExperience = null,
}: {
  topology: AdminTopologyView;
  episodeError?: string | null;
  world?: FlagshipBusinessWorldView | null;
  review?: FlagshipWorkReviewView | null;
  groundedExperience?: FlagshipExperienceViewV4 | null;
}) {
  const orderedGroups = useMemo(
    () => topology.groups.toSorted((left, right) => left.order - right.order),
    [topology.groups],
  );
  const grounded = groundedExperience?.collaboration
    && groundedExperience.collaboration.episode.audience === "admin"
    && "ablation" in groundedExperience.collaboration
    ? groundedExperience.collaboration
    : null;
  const groundedDecisions = new Map(
    grounded?.episode.dispatchDecisions.map((decision) => [
      decision.agentTemplateRef,
      decision,
    ]) ?? [],
  );
  const groundedMoves = new Map<string, typeof grounded extends null ? never : NonNullable<typeof grounded>["episode"]["moves"]>();
  for (const move of grounded?.episode.moves ?? []) {
    const current = groundedMoves.get(move.agentTemplateRef) ?? [];
    groundedMoves.set(move.agentTemplateRef, [...current, move]);
  }
  const displayAgents = grounded ? topology.agents.map((agent) => {
    const decision = groundedDecisions.get(agent.agentId);
    const moves = groundedMoves.get(agent.agentId) ?? [];
    if (!decision) return agent;
    return {
      ...agent,
      runtimeState: decision.decision === "skipped"
        ? "skipped" as const
        : moves.length > 0
          ? "completed" as const
          : "selected" as const,
      runtimeReason: decision.businessReason,
      contributionSummary: moves.at(-1)?.safeSummary ?? null,
    };
  }) : topology.agents;
  const firstActive = displayAgents.find((agent) => (
    agent.runtimeState === "selected"
    || agent.runtimeState === "completed"
    || agent.runtimeState === "degraded"
    || agent.runtimeState === "failed"
  )) ?? displayAgents[0] ?? null;
  const [selectedId, setSelectedId] = useState(firstActive?.agentId ?? null);
  const selected = displayAgents.find((agent) => agent.agentId === selectedId)
    ?? firstActive;
  const participatingCount = displayAgents.filter((agent) => (
    agent.runtimeState === "selected"
    || agent.runtimeState === "completed"
    || agent.runtimeState === "degraded"
  )).length;
  const failedCount = displayAgents.filter((agent) => agent.runtimeState === "failed").length;

  return (
    <main className="v2-topology-page">
      <header className="v2-admin-heading">
        <div>
          <h1>高水平智能体群运行全景</h1>
          <p>{grounded
            ? "六组十四智能体来自旗舰发布清单；本轮人数、选择理由与五步运行明细取自当前知识接地协作。"
            : topology.source === "flagship_v3"
            ? "六组十四智能体来自旗舰世界发布版；本轮选择、贡献与执行账本来自同一权威 Episode。"
            : "拓扑来自服务端 Manifest，本轮选中、跳过与失败来自管理员 Episode。"}</p>
        </div>
        <span>{topology.execution ? `${participatingCount} 个本轮参与` : "等待运行上下文"}</span>
      </header>
      {episodeError ? (
        <div className="v2-inline-notice">当前仅显示权威拓扑，运行 Episode 不可用：{episodeError}</div>
      ) : null}
      <section className="v2-topology-summary">
        <div><Network /><span>{topology.groups.length} 组</span><strong>职责域</strong></div>
        <div><Bot /><span>{topology.agents.length} 个</span><strong>受控智能体</strong></div>
        <div><Radio /><span>{participatingCount} 个</span><strong>本轮参与</strong></div>
        <div><ShieldAlert /><span>{failedCount} 个</span><strong>执行失败</strong></div>
      </section>
      {world && review ? (
        <section className="v21-admin-world-context" aria-label="旗舰世界运行上下文">
          <article>
            <small>权威世界</small>
            <strong>STATE {world.worldStateVersion}</strong>
            <span>挑战 {world.challenge.level} 级 · 剩余 {world.virtualTime.remainingMinutes} 分钟</span>
          </article>
          <article>
            <small>事件管线</small>
            <strong>{world.queue?.length ?? 0} 条队列</strong>
            <span>{world.resolutions?.length ?? 0} 次解析 · {world.consequences?.length ?? 0} 次后果</span>
          </article>
          <article>
            <small>真实学生作品</small>
            <strong>{review.completion.submittedRequiredCount}/{review.completion.requiredArtifactCount} 已送审</strong>
            <span>{review.artifacts.filter((artifact) => artifact.status === "draft").length} 件编辑中</span>
          </article>
          <article>
            <small>执行声明</small>
            <strong>{topology.execution?.mode === "live" ? "LIVE" : topology.execution?.mode === "degraded" ? "DEGRADED" : "DETERMINISTIC DEMO"}</strong>
            <span>{topology.execution?.providerId ?? "无外部模型供应方"}</span>
          </article>
        </section>
      ) : null}
      {grounded ? (
        <section className="v22-admin-grounded" aria-label="V4 知识接地协作与消融观测">
          <header>
            <div><Workflow /><span><small>V4 GROUNDED COLLABORATION</small><h2>专业质疑—补证—修订运行账本</h2></span></div>
            <b>{grounded.episode.executionSummary.executionMode === "live" ? "LIVE" : grounded.episode.executionSummary.executionMode === "mixed" ? "MIXED" : "DETERMINISTIC DEMO"}</b>
          </header>
          <div className="v22-admin-grounded-metrics">
            <article><small>本轮策略</small><strong>{grounded.ablation.policy === "affected_set" ? "受影响集合" : grounded.ablation.policy === "fixed_team" ? "固定团队" : "单智能体"}</strong><span>{grounded.ablation.selectedCount}/14 被选中</span></article>
            <article><small>协作完整度</small><strong>{grounded.ablation.moveCount}/5 步</strong><span>{grounded.ablation.status === "failed" ? "失败已保留" : "联合提案就绪"}</span></article>
            <article><small>知识与证据</small><strong>{grounded.ablation.knowledgeCitationCount} 条引用</strong><span>证据覆盖 {Math.round(grounded.ablation.evidenceCoverage * 100)}%</span></article>
            <article><small>权威边界</small><strong>{grounded.ablation.unauthorizedWorldWriteCount} 次越权</strong><span>Agent 仅提议，WorldEngine 写回</span></article>
          </div>
          <div className="v22-admin-grounded-ledger">
            {grounded.episode.moves.map((move, index) => (
              <article key={move.moveId}>
                <header><span>{index + 1}</span><div><small>{move.moveKind}</small><strong>{move.professionalRoleId}</strong></div><b>{move.execution.executionMode}</b></header>
                <p>{move.safeSummary}</p>
                <dl>
                  <div><dt>模型</dt><dd>{move.execution.modelId ?? "确定性规则"}</dd></div>
                  <div><dt>延迟</dt><dd>{move.execution.latencyMs} ms</dd></div>
                  <div><dt>成本</dt><dd>{move.execution.estimatedCostMicros} μ</dd></div>
                  <div><dt>引用</dt><dd>{move.knowledgeCitations.length} 知识 / {move.evidenceRefs.length} 证据</dd></div>
                </dl>
                <details><summary>管理员运行引用</summary><code>{move.execution.agentRunRef}{"\n"}{move.execution.traceRef}{"\n"}{move.execution.promptTemplateRef}</code></details>
              </article>
            ))}
          </div>
          <footer>
            <strong>十四智能体调度决定</strong>
            <div>{grounded.episode.dispatchDecisions.map((decision) => <span key={decision.agentTemplateRef} className={decision.decision}>{decision.professionalRoleId}<small>{decision.decision === "selected" ? "参与" : decision.businessReason}</small></span>)}</div>
          </footer>
        </section>
      ) : null}
      <div className="v2-topology-layout">
        <section className="v2-topology-canvas" aria-label="六组十四智能体拓扑">
          <svg viewBox="0 0 1000 620" preserveAspectRatio="none" aria-hidden="true">
            <path d="M500 310 C390 310 350 120 160 120 M500 310 C610 310 650 120 840 120 M500 310 C340 310 300 310 160 310 M500 310 C660 310 700 310 840 310 M500 310 C390 310 350 500 160 500 M500 310 C610 310 650 500 840 500" />
          </svg>
          <div className="v2-topology-core">
            <Activity />
            <strong>WorldEngine</strong>
            <span>{topology.edgeCount} 条事件订阅边</span>
          </div>
          <div className="v2-topology-groups">
            {orderedGroups.map((group) => (
              <section key={group.groupId} className={`group-${group.order}`}>
                <header>
                  <Workflow />
                  <div><strong>{group.title}</strong><span>{group.responsibility}</span></div>
                </header>
                <div>
                  {displayAgents.filter((agent) => agent.groupId === group.groupId).map((agent) => (
                    <button
                      type="button"
                      key={agent.agentId}
                      aria-pressed={selected?.agentId === agent.agentId}
                      className={`${agent.runtimeState} ${selected?.agentId === agent.agentId ? "active" : ""}`}
                      onClick={() => setSelectedId(agent.agentId)}
                    >
                      <i />
                      <span><strong>{agent.title}</strong><small>{runtimeLabels[agent.runtimeState]}</small></span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </section>
        <aside className="v2-agent-inspector">
          {selected ? (
            <>
              <header>
                <span className={selected.runtimeState}><CircleDot /></span>
                <div>
                  <small>{runtimeLabels[selected.runtimeState]}</small>
                  <h2>{selected.title}</h2>
                  <p>{selected.responsibility}</p>
                </div>
              </header>
              <dl>
                <div><dt>本轮原因</dt><dd>{selected.runtimeReason}</dd></div>
                {selected.contributionSummary ? (
                  <div><dt>贡献摘要</dt><dd>{selected.contributionSummary}</dd></div>
                ) : null}
                <div><dt>订阅事件</dt><dd>{selected.subscribedEventTypes.join("、")}</dd></div>
                <div><dt>输入</dt><dd>{selected.inputTypes.join("、") || "仅按事件订阅观察，不声明额外对象选择器"}</dd></div>
                <div><dt>输出</dt><dd>{selected.outputTypes.join("、")}</dd></div>
                <div><dt>允许动作</dt><dd>{selected.allowedActions.length ? selected.allowedActions.join("、") : "仅建议，不执行动作"}</dd></div>
                <div><dt>禁止动作</dt><dd>{selected.forbiddenActions.join("、")}</dd></div>
                <div><dt>教师门</dt><dd>{selected.teacherGateRequired === null
                  ? "由本轮世界后果风险规则动态判定"
                  : selected.teacherGateRequired
                    ? "正式写回前必须经过教师确认"
                    : "本节点无额外教师门"}</dd></div>
              </dl>
              <section>
                <h3>管理员执行详情</h3>
                {topology.execution ? (
                  <>
                    <p>模式：{topology.execution.mode}</p>
                    <p>供应方：{topology.execution.providerId ?? "无外部供应方"}</p>
                    <p>模型：{topology.execution.modelId ?? "无外部模型"}</p>
                    <p>总延迟：{topology.execution.totalLatencyMs} ms</p>
                    <p>估算成本：{topology.execution.estimatedCostMicrounits} 微单位</p>
                    <p>失败智能体：{topology.execution.failedAgentIds.join("、") || "无"}</p>
                    <p>恢复动作：{topology.execution.recoveryActions.join("；") || "无"}</p>
                  </>
                ) : <p>当前没有可关联的管理员协作 Episode。</p>}
              </section>
              <details>
                <summary>安全 Trace 引用 <ChevronDown /></summary>
                <code>{topology.execution?.traceRefs.join("\n") || "本轮没有 Trace 引用"}</code>
              </details>
              <details>
                <summary>Prompt 模板引用 <ChevronDown /></summary>
                <code>{topology.execution?.promptTemplateRefs.join("\n") || "本轮没有 Prompt 模板引用"}</code>
              </details>
            </>
          ) : <div className="v2-centered-state">没有可查看的智能体节点</div>}
        </aside>
      </div>
    </main>
  );
}

export default function AdminTopologyPage({
  gateway,
  sessionId,
  bindingId,
}: {
  gateway: AdminGateway;
  sessionId: string;
  bindingId: string;
}) {
  const loader = useCallback(
    (signal: AbortSignal) => loadAdminTopology(
      gateway,
      sessionId,
      bindingId,
      signal,
    ),
    [bindingId, gateway, sessionId],
  );
  const { data, error } = useAdminResource(loader);
  if (error) {
    return <main className="v2-admin-page"><div className="v2-inline-error" role="alert">{error}</div></main>;
  }
  if (!data) {
    return (
      <main className="v2-admin-page">
        <div className="v2-centered-state"><LoaderCircle className="spin" />正在读取六组十四智能体</div>
      </main>
    );
  }
  return <AdminTopologySurface
    topology={data.topology}
    episodeError={data.episodeError}
    world={data.world}
    review={data.review}
    groundedExperience={data.groundedExperience ?? null}
  />;
}
