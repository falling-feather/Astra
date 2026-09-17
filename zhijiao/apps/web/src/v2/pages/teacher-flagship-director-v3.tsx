import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Check,
  Clock3,
  FilePenLine,
  Gauge,
  LoaderCircle,
  RefreshCw,
  Scale,
  Send,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import type { TeacherAgentCollaborationEpisodeV3 } from "@ronggang/contracts";
import { GatewayHttpError } from "../gateway";
import { TeacherFieldInterview } from "./teacher-field-interview";
import type { TeacherGateway } from "../teacher-gateway";
import type { TeacherClassView } from "../teacher-models";
import { teacherClassViews } from "../teacher-models";
import type {
  FlagshipBusinessWorldView,
  FlagshipWorkReviewView,
} from "../world-v3-business";
import {
  groundedCitationStanceLabelV4,
  type FlagshipExperienceViewV4,
} from "../flagship-v4";

type FlagshipTeacherGateway = TeacherGateway & Required<Pick<TeacherGateway,
  | "getFlagshipWorld"
  | "getFlagshipEpisode"
  | "getFlagshipWorkReview"
  | "decideFlagshipTeacherGate"
>>;

interface ReadyLoad {
  classroom: TeacherClassView;
  world: FlagshipBusinessWorldView;
  episode: TeacherAgentCollaborationEpisodeV3;
  review: FlagshipWorkReviewView;
  groundedExperience?: FlagshipExperienceViewV4 | null;
}

type LoadState =
  | { state: "loading" }
  | { state: "unbound" }
  | { state: "error"; message: string }
  | { state: "ready"; value: ReadyLoad };

function hasFlagshipTeacherGateway(gateway: TeacherGateway): gateway is FlagshipTeacherGateway {
  return Boolean(
    gateway.getFlagshipWorld
    && gateway.getFlagshipEpisode
    && gateway.getFlagshipWorkReview
    && gateway.decideFlagshipTeacherGate,
  );
}

export async function loadFlagshipTeacherDirector(
  gateway: FlagshipTeacherGateway,
  sessionId: string,
  bindingId: string,
  experienceGeneration: "flagship_v3" | "flagship_v4",
  signal?: AbortSignal,
): Promise<ReadyLoad | null> {
  const overview = await gateway.getSessionOverview(bindingId, sessionId, signal);
  const classroom = teacherClassViews(overview).find(
    (item) => item.session.sessionId === sessionId,
  );
  if (!classroom) return null;
  const [world, episode, review, groundedExperience] = await Promise.all([
    gateway.getFlagshipWorld(sessionId, bindingId, signal),
    gateway.getFlagshipEpisode(sessionId, bindingId, signal),
    gateway.getFlagshipWorkReview(sessionId, bindingId, signal),
    experienceGeneration === "flagship_v4"
      ? gateway.getFlagshipExperienceV4
        ? gateway.getFlagshipExperienceV4(sessionId, bindingId, signal)
        : Promise.reject(new Error("客户端缺少描述符要求的 V4 教师体验端口"))
      : Promise.resolve(null),
  ]);
  return { classroom, world, episode, review, groundedExperience };
}

function statusLabel(status: TeacherAgentCollaborationEpisodeV3["status"]): string {
  switch (status) {
    case "waiting": return "等待世界事件";
    case "in_progress": return "协作处理中";
    case "awaiting_gate": return "等待教师门";
    case "completed": return "本轮已写回";
    case "failed": return "本轮失败关闭";
  }
}

function sourceLabel(source: NonNullable<TeacherAgentCollaborationEpisodeV3["triggerEvent"]>["sourceKind"]): string {
  switch (source) {
    case "student_action": return "学生岗位行动";
    case "npc_intent": return "现场人物主动行动";
    case "system_clock": return "世界时钟事件";
    case "teacher_intervention": return "教师介入";
  }
}

function decisionLabel(decision: NonNullable<TeacherAgentCollaborationEpisodeV3["studentDecision"]>["decision"]): string {
  if (decision === "accept") return "采纳协作建议";
  if (decision === "request_evidence") return "要求补充依据";
  return "拒绝协作建议";
}

function gateLabel(gate: TeacherAgentCollaborationEpisodeV3["teacherGate"]): string {
  if (!gate) return "无需教师门";
  const labels = {
    not_required: "无需教师门",
    pending: "等待教师判断",
    approved: "教师已批准",
    revised: "教师已收窄后果",
    rejected: "教师已拒绝",
  } as const;
  return labels[gate.status];
}

function FlagshipTeacherGate({
  gateway,
  episode,
  bindingId,
  onResolved,
}: {
  gateway: FlagshipTeacherGateway;
  episode: TeacherAgentCollaborationEpisodeV3;
  bindingId: string;
  onResolved(episode: TeacherAgentCollaborationEpisodeV3): void;
}) {
  const [choice, setChoice] = useState<"approved" | "revised" | "rejected" | null>(null);
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const pending = episode.status === "awaiting_gate" && episode.teacherGate?.status === "pending";

  const submit = async () => {
    if (!choice) return;
    if (choice === "revised" && summary.trim().length < 8) {
      setMessage("请说明收窄后的可执行世界后果（至少 8 个字）");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const updated = await gateway.decideFlagshipTeacherGate({
        sessionId: episode.sessionId,
        bindingId,
        episodeId: episode.episodeId,
        decision: choice,
        teacherDecisionRef: `teacher-decision-${Date.now().toString(36)}`,
        revisionPolicy: choice === "revised" ? "reduce_effects" : null,
        revisedConsequenceSummary: choice === "revised" ? summary.trim() : null,
      });
      setMessage(choice === "approved"
        ? "教师门已批准，世界后果由服务端权威结算"
        : choice === "revised"
          ? "教师已收窄后果，服务端已按新边界结算"
          : "教师已拒绝，本轮保持零世界写入");
      setChoice(null);
      setSummary("");
      onResolved(updated);
    } catch (cause) {
      if (cause instanceof GatewayHttpError && cause.status === 409) {
        try {
          const latest = await gateway.getFlagshipEpisode(
            episode.sessionId,
            bindingId,
          );
          onResolved(latest);
          setMessage("课堂状态已经前移，本次旧决定未生效；页面已读取最新教师门。");
          return;
        } catch (refreshCause) {
          setMessage(refreshCause instanceof Error
            ? refreshCause.message
            : "课堂状态已前移，但最新教师门读取失败");
          return;
        }
      }
      setMessage(cause instanceof Error ? cause.message : "教师门决定失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="v21-teacher-gate">
      <header>
        <div><Scale /><span>风险教师门</span></div>
        <b>{gateLabel(episode.teacherGate)}</b>
      </header>
      <p>{episode.teacherGate?.safeSummary ?? "当前行动不需要教师介入，世界会按冻结规则自行演进。"}</p>
      <div className="v21-gate-boundary">
        <strong>教师责任边界</strong>
        <span>批准或收窄的是世界后果，不替学生完成采访、核查或写稿。</span>
      </div>
      {pending ? (
        <>
          <div className="v21-gate-actions" aria-label="教师门决定">
            <button type="button" className="approve" onClick={() => setChoice("approved")}><Check />批准</button>
            <button type="button" onClick={() => setChoice("revised")}><FilePenLine />收窄后果</button>
            <button type="button" className="reject" onClick={() => setChoice("rejected")}><X />拒绝写回</button>
          </div>
          {choice ? (
            <section className="v21-gate-confirm">
              {choice === "revised" ? (
                <label>
                  收窄后的世界后果
                  <textarea
                    value={summary}
                    onChange={(event) => setSummary(event.target.value)}
                    maxLength={1_000}
                    placeholder="例如：只保留风险提示，不公开未核实身份与具体住址。"
                  />
                </label>
              ) : (
                <p>确认“{choice === "approved" ? "批准" : "拒绝"}”本轮世界后果？</p>
              )}
              <button type="button" disabled={busy} onClick={() => void submit()}>
                {busy ? "正在由服务端结算…" : "确认教师决定"}
              </button>
            </section>
          ) : null}
        </>
      ) : null}
      {message ? <p className="v21-gate-message" role="status">{message}</p> : null}
    </aside>
  );
}

export function FlagshipTeacherDirectorSurface({
  value,
  gateway,
  bindingId,
  onEpisodeChanged,
}: {
  value: ReadyLoad;
  gateway: FlagshipTeacherGateway;
  bindingId: string;
  onEpisodeChanged(episode: TeacherAgentCollaborationEpisodeV3): void;
}) {
  const { classroom, world, episode, review, groundedExperience } = value;
  if (episode.status === "waiting") {
    return (
      <main className="v21-teacher-director v21-teacher-director-waiting">
        <header className="v21-director-hero">
          <div>
            <span>真实世界导演台 · {classroom.classroomName}</span>
            <h1>{world.title}</h1>
            <p>教师只在真实事件或风险门出现时介入；后台技术运行细节由管理员查看。</p>
          </div>
          <div className="v21-director-status">
            <b>课堂正常运行</b>
            <span>挑战 {world.challenge.level} 级</span>
            <span>剩余 {world.virtualTime.remainingMinutes} 分钟</span>
          </div>
        </header>
        <TeacherFieldInterview key={`${world.sessionId}:${bindingId}`} gateway={gateway} sessionId={world.sessionId} bindingId={bindingId} enabled={groundedExperience?.fieldInterviewEnabled === true} />
        <section className="v21-teacher-quiet" role="status">
          <Clock3 />
          <h2>当前没有需要教师处理的岗位决定</h2>
          <p>当前没有需要教师处理的风险与教学决定。事件发生后，这里会展开完整业务因果链。</p>
        </section>
      </main>
    );
  }
  const selected = episode.dispatchPlan?.decisions.filter((item) => item.decision === "selected") ?? [];
  const skipped = episode.dispatchPlan?.decisions.filter((item) => item.decision === "skipped") ?? [];
  const grounded = groundedExperience?.collaboration
    && groundedExperience.collaboration.episode.audience === "teacher"
    ? groundedExperience.collaboration.episode
    : null;
  const changedIndicators = world.indicators
    .filter((indicator) => indicator.delta !== 0)
    .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta))
    .slice(0, 4);
  const visibleIndicators = changedIndicators.length > 0
    ? changedIndicators
    : world.indicators.slice(0, 3);
  const people = world.entities.filter((entity) => entity.kind === "person");
  const activeArtifacts = review.artifacts.filter((artifact) => (
    artifact.status !== "empty" || artifact.revisionCount > 0
  ));
  const stages = [
    episode.triggerEvent ? {
      key: "event",
      title: "世界事件",
      icon: <Clock3 />,
      content: <><strong>{episode.triggerEvent.title}</strong><p>{sourceLabel(episode.triggerEvent.sourceKind)}</p></>,
    } : null,
    episode.dispatchPlan ? {
      key: "dispatch",
      title: "必要协作集合",
      icon: <UsersRound />,
      content: <><strong>{selected.length} 个参与 · {skipped.length} 个未唤醒</strong><p>{skipped.length > 0 ? "未受影响或不具备必要权限的智能体保持沉默。" : "本轮候选均与事件直接相关。"}</p></>,
    } : null,
    episode.contributions.length > 0 ? {
      key: "agents",
      title: "岗位协作",
      icon: <Bot />,
      content: <div>{episode.contributions.map((item) => <p key={item.contributionId}>• {item.summary}</p>)}</div>,
    } : null,
    episode.studentDecision ? {
      key: "student",
      title: "学生选择",
      icon: <UserRound />,
      content: <><strong>{decisionLabel(episode.studentDecision.decision)}</strong><p>{episode.studentDecision.rationale}</p></>,
    } : null,
    episode.teacherGate ? {
      key: "gate",
      title: "教师门",
      icon: <Scale />,
      content: <><strong>{gateLabel(episode.teacherGate)}</strong><p>{episode.teacherGate.safeSummary}</p></>,
    } : null,
    episode.consequence ? {
      key: "consequence",
      title: "世界后果",
      icon: <Send />,
      content: <><strong>{episode.consequence.status === "committed" ? "已权威写回" : "尚未写入"}</strong><p>{episode.consequence.publicSummary}</p></>,
    } : null,
  ].filter((stage): stage is NonNullable<typeof stage> => stage !== null);

  return (
    <main className="v21-teacher-director">
      <header className="v21-director-hero">
        <div>
          <span>真实世界导演台 · {classroom.classroomName}</span>
          <h1>{world.title}</h1>
          <p>{world.summary}</p>
        </div>
        <div className="v21-director-status">
          <b>{statusLabel(episode.status)}</b>
          <span>挑战 {world.challenge.level} 级</span>
          <span>剩余 {world.virtualTime.remainingMinutes} 分钟</span>
        </div>
      </header>

      <div className="v21-director-grid">
        <TeacherFieldInterview key={`${world.sessionId}:${bindingId}`} gateway={gateway} sessionId={world.sessionId} bindingId={bindingId} enabled={groundedExperience?.fieldInterviewEnabled === true} />
        <details className="v21-world-context-detail">
          <summary><Gauge /><span><strong>展开本轮世界变化与人物状态</strong><small>{changedIndicators.length > 0 ? `${changedIndicators.length} 项指标发生变化` : "当前只保留核心基线"}</small></span></summary>
          <aside className="v21-world-pulse">
            {visibleIndicators.map((indicator) => (
              <section key={indicator.variableId}>
                <div><strong>{indicator.title}</strong><b>{indicator.value}</b></div>
                <progress value={indicator.value - indicator.minimum} max={indicator.maximum - indicator.minimum} />
                <small>{indicator.delta === 0 ? "本轮无变化" : `本轮 ${indicator.delta > 0 ? "+" : ""}${indicator.delta}`}</small>
              </section>
            ))}
            <details className="v21-world-roster">
              <summary>查看当前可交互人物（{people.length}）</summary>
              <section>{people.slice(0, 7).map((entity) => (
                <span key={entity.entityId}><i className={entity.status} />{entity.title}<small>{entity.status === "available" ? "可接触" : "状态变化"}</small></span>
              ))}</section>
            </details>
          </aside>
        </details>

        <section className="v21-causal-stage">
          <header>
            <div><h2>当前业务因果链</h2><p>只展示已经发生的真实阶段，不用空卡补齐流程。</p></div>
            <span>{stages.length} 个已发生阶段</span>
          </header>
          {stages.length === 0 ? (
            <div className="v21-causal-wait"><Clock3 /><strong>等待学生或世界产生下一项事件</strong><p>没有事件时不虚构协作、不展示后台日志。</p></div>
          ) : (
            <div className="v21-causal-flow">
              {stages.map((stage, index) => (
                <article key={stage.key}>
                  <header><span>{index + 1}</span>{stage.icon}<b>{stage.title}</b></header>
                  <div>{stage.content}</div>
                  {index < stages.length - 1 ? <ArrowRight aria-hidden="true" /> : null}
                </article>
              ))}
            </div>
          )}

          {grounded && grounded.moves.length > 0 ? (
            <details className="v21-supporting-detail">
              <summary><UsersRound /><span><strong>展开智能体质疑、补证与修订依据</strong><small>{grounded.moves.length} 个已发生协作动作 · {grounded.dispatchDecisions.filter((item) => item.decision === "selected").length} 个必要角色</small></span></summary>
              <section className="v22-grounded-teacher" aria-label="知识接地的五步专业协作">
              <header>
                <div><UsersRound /><span><small>高水平智能体群</small><h2>知识接地的专业质疑与修订</h2></span></div>
                <b>{grounded.dispatchDecisions.filter((item) => item.decision === "selected").length} 个必要角色参与</b>
              </header>
              <div className="v22-grounded-moves">
                {grounded.moves.map((move, index) => (
                  <article key={move.moveId}>
                    <span>{index + 1}</span>
                    <small>{({
                      proposal: "提出方案",
                      challenge: "专业质疑",
                      evidence_request: "索取证据",
                      revision: "修订方案",
                      joint_proposal: "联合建议",
                    } as const)[move.moveKind]}</small>
                    <strong>{move.safeSummary}</strong>
                    <p>{move.rationale}</p>
                    <details><summary>{move.knowledgeCitations.length} 条知识依据</summary>{move.knowledgeCitations.map((citation) => citation.sourceUrl
                      ? <a key={`${citation.knowledgeRef}:${citation.fragmentRef ?? citation.sourceContentHash}`} href={citation.sourceUrl} target="_blank" rel="noreferrer">{citation.sourceTitle} · {groundedCitationStanceLabelV4(citation.stance)} · {citation.locator}</a>
                      : <span key={`${citation.knowledgeRef}:${citation.fragmentRef ?? citation.sourceContentHash}`}>{citation.sourceTitle} · {groundedCitationStanceLabelV4(citation.stance)} · 本地资料 · {citation.locator}</span>)}</details>
                  </article>
                ))}
              </div>
              <footer>
                <strong>未唤醒的智能体为什么保持沉默</strong>
                <p>{grounded.dispatchDecisions.filter((item) => item.decision === "skipped").slice(0, 4).map((item) => item.businessReason).join("；") || "本轮十四个智能体均与事件直接相关。"}</p>
              </footer>
              </section>
            </details>
          ) : null}

          <details className="v21-supporting-detail">
            <summary><FilePenLine /><span><strong>展开学生真实作品状态</strong><small>{activeArtifacts.length} 项已产生 · {review.completion.submittedRequiredCount} 项送审</small></span></summary>
            <section className="v21-work-review">
              {activeArtifacts.length > 0 ? (
                <div>
                {activeArtifacts.map((artifact) => (
                  <article key={artifact.artifactId} className={artifact.status}>
                    <span>{artifact.status === "submitted" ? "已送审" : artifact.status === "draft" ? "编辑中" : "未开始"}</span>
                    <strong>{artifact.title}</strong>
                    <small>{artifact.revisionCount > 0 ? `${artifact.revisionCount} 个真实版本` : "尚无学生内容"}</small>
                    {artifact.latestRevision ? <p>{artifact.latestRevision.revisionNote}</p> : null}
                  </article>
                ))}
                </div>
              ) : (
                <div className="v21-work-review-empty">
                  <FilePenLine />
                  <span><strong>学生尚未创建作品版本</strong><small>形成真实草稿或媒体修订后，这里才展开对应作品；不以空模板占据导演台。</small></span>
                </div>
              )}
            </section>
          </details>
        </section>

        <FlagshipTeacherGate
          gateway={gateway}
          episode={episode}
          bindingId={bindingId}
          onResolved={onEpisodeChanged}
        />
      </div>
    </main>
  );
}

export default function TeacherFlagshipDirectorV3Page({
  gateway,
  sessionId,
  bindingId,
  navigate,
  experienceGeneration,
}: {
  gateway: TeacherGateway;
  sessionId: string;
  bindingId: string;
  navigate(path: string): void;
  experienceGeneration: "flagship_v3" | "flagship_v4";
}) {
  const [load, setLoad] = useState<LoadState>({ state: "loading" });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!hasFlagshipTeacherGateway(gateway)) {
      setLoad({ state: "error", message: "当前教师数据通道不支持旗舰世界" });
      return;
    }
    const controller = new AbortController();
    setLoad((current) => current.state === "ready" ? current : { state: "loading" });
    loadFlagshipTeacherDirector(
      gateway,
      sessionId,
      bindingId,
      experienceGeneration,
      controller.signal,
    )
      .then((result) => {
        if (!controller.signal.aborted) setLoad(result
          ? { state: "ready", value: result }
          : { state: "unbound" });
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setLoad({
          state: "error",
          message: cause instanceof Error ? cause.message : "无法读取旗舰课堂",
        });
      });
    return () => controller.abort();
  }, [bindingId, experienceGeneration, gateway, revision, sessionId]);

  if (load.state === "ready" && hasFlagshipTeacherGateway(gateway)) {
    return <FlagshipTeacherDirectorSurface
      value={load.value}
      gateway={gateway}
      bindingId={bindingId}
      onEpisodeChanged={(episode) => {
        setLoad((current) => current.state === "ready"
          ? { ...current, value: { ...current.value, episode } }
          : current);
        setRevision((value) => value + 1);
      }}
    />;
  }
  if (load.state === "unbound") {
    return <main className="v2-director-wait"><section><AlertTriangle /><h1>无法进入该课堂</h1><p>当前教师绑定不属于该训练会话。</p><button type="button" onClick={() => navigate("/teacher/classes")}>返回班级列表</button></section></main>;
  }
  if (load.state === "error") {
    return <main className="v2-director-wait"><section><AlertTriangle /><h1>旗舰导演台暂时不可用</h1><p>{load.message}</p><button type="button" onClick={() => setRevision((value) => value + 1)}><RefreshCw />重试</button></section></main>;
  }
  return <main className="v2-director-wait"><section><LoaderCircle className="spin" /><h1>正在读取真实世界</h1><p>同步世界状态、协作因果与学生作品。</p></section></main>;
}
