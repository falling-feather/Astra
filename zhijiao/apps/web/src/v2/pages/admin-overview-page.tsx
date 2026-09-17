import { useCallback } from "react";
import {
  ArrowRight,
  Bot,
  Gauge,
  GraduationCap,
  LoaderCircle,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import type { AdminCollaborationEpisode, OperationsHealthSnapshot } from "@ronggang/contracts";
import type { AdminGateway } from "../admin-gateway";
import { operationsNotices } from "../admin-models";
import { useAdminResource } from "./use-admin-resource";

export interface AdminOverviewLoad {
  health: OperationsHealthSnapshot;
  episode: AdminCollaborationEpisode | null;
  episodeError: string | null;
}

export async function loadAdminOverview(
  gateway: AdminGateway,
  sessionId: string,
  bindingId: string,
  signal?: AbortSignal,
): Promise<AdminOverviewLoad> {
  const health = await gateway.getOperationsHealth(
    bindingId,
    sessionId,
    signal,
  );
  try {
    return {
      health,
      episode: await gateway.getEpisode(sessionId, bindingId, signal),
      episodeError: null,
    };
  } catch (cause) {
    return {
      health,
      episode: null,
      episodeError: cause instanceof Error ? cause.message : "协作 Episode 暂不可用",
    };
  }
}

export default function AdminOverviewPage({
  gateway,
  sessionId,
  bindingId,
  navigate,
}: {
  gateway: AdminGateway;
  sessionId: string;
  bindingId: string;
  navigate(path: string): void;
}) {
  const loader = useCallback(
    (signal: AbortSignal) => loadAdminOverview(
      gateway,
      sessionId,
      bindingId,
      signal,
    ),
    [bindingId, gateway, sessionId],
  );
  const { data, error } = useAdminResource(loader);
  const executionLabel = data?.episode
    ? data.episode.execution.mode === "live"
      ? "Live"
      : data.episode.execution.mode === "degraded"
        ? "降级运行"
        : "确定性演示"
    : "无协作运行";
  const failedTasks = data
    ? data.health.agentTasks.failed + data.health.agentTasks.deadLettered
    : 0;
  return (
    <main className="v2-admin-page">
      <header className="v2-admin-heading">
        <div>
          <h1>管理总览</h1>
          <p>基于真实运行健康与管理员协作 Episode 汇总，不使用演示占位计数。</p>
        </div>
        <span>{executionLabel}</span>
      </header>
      {error ? <div className="v2-inline-error" role="alert">{error}</div> : null}
      {!data && !error ? (
        <div className="v2-centered-state">
          <LoaderCircle className="spin" />正在读取系统状态
        </div>
      ) : null}
      {data ? (
        <>
          <section className="v2-admin-metrics">
            <article><Gauge /><strong>{data.health.sessions.statuses.active}</strong><span>活动会话</span></article>
            <article><Bot /><strong>{data.health.agentTasks.running}</strong><span>运行任务</span></article>
            <article><ShieldCheck /><strong>{data.episode?.teacherGate?.status === "pending" ? 1 : 0}</strong><span>待教师门</span></article>
            <article><GraduationCap /><strong>{failedTasks}</strong><span>失败或死信</span></article>
          </section>
          {data.episodeError ? (
            <div className="v2-inline-notice">协作 Episode 未并入总览：{data.episodeError}</div>
          ) : null}
          <section className="v2-admin-role-entry">
            <header>
              <h2>角色体验入口</h2>
              <p>切换体验时重新建立匹配的师生身份，不用管理员绑定绕过岗位边界。</p>
            </header>
            <div>
              <button type="button" onClick={() => navigate("/student/courses?profileId=student-unassigned")}>
                <UserRound />体验学生端<ArrowRight />
              </button>
              <button type="button" onClick={() => navigate("/teacher/classes?profileId=teacher-class-a")}>
                <GraduationCap />体验教师端<ArrowRight />
              </button>
              <button type="button" onClick={() => navigate("/admin/agents")}>
                <Bot />查看智能体全景<ArrowRight />
              </button>
            </div>
          </section>
          <section className="v2-admin-notices">
            <h2>运行提示</h2>
            {operationsNotices(data.health, data.episode).map((notice) => (
              <p key={notice}>• {notice}</p>
            ))}
          </section>
        </>
      ) : null}
    </main>
  );
}
