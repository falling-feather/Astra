import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Check,
  Clock3,
  CloudRain,
  FileCheck2,
  LoaderCircle,
  RefreshCw,
  Scale,
  Send,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import {
  submitTeacherGateDecision,
  TeacherGateConflictError,
  type TeacherGateway,
} from "../teacher-gateway";
import {
  teacherClassViews,
  trainingExperienceGeneration,
  type TeacherClassView,
  type TeacherEpisode,
  type TeacherGateDecision,
  type TeacherGateDecisionInput,
} from "../teacher-models";
import TeacherFlagshipDirectorV3Page from "./teacher-flagship-director-v3";

type DirectorLoad =
  | { state: "loading" }
  | { state: "unbound" }
  | { state: "error"; message: string }
  | { state: "ready"; classroom: TeacherClassView; episode: TeacherEpisode };

export interface RecentTeacherOutcome {
  gateSummary: string;
  consequenceSummary: string;
}

export function recentApprovedOutcome(
  before: TeacherEpisode,
  after: TeacherEpisode,
  input: TeacherGateDecisionInput,
): RecentTeacherOutcome | null {
  if (
    input.decision !== "approve"
    || before.stateVersion !== input.expectedStateVersion
    || before.teacherGate?.gateId !== input.gateId
    || before.teacherGate.status !== "pending"
    || after.stateVersion <= input.expectedStateVersion
  ) return null;

  const sameGateWriteback = after.teacherGate?.gateId === input.gateId
    && after.teacherGate.status === "approved"
    && after.authorityWriteback?.occurred === true;
  const advancedTrigger = after.status === "in_progress"
    && after.triggerEvent !== null
    && after.triggerEvent.eventId !== input.expectedTriggerEventId;
  if (!sameGateWriteback && !advancedTrigger) return null;

  const subject = before.triggerEvent?.title ?? before.teacherGate.summary;
  const consequenceSummary = sameGateWriteback
    ? after.authorityWriteback!.summary
    : `权威状态已推进至“${after.triggerEvent!.title}”。`;
  return {
    gateSummary: `已批准“${subject}”。`,
    consequenceSummary,
  };
}

export async function resolveTeacherDirectorLoad(
  gateway: TeacherGateway,
  sessionId: string,
  bindingId: string,
  signal?: AbortSignal,
): Promise<Exclude<DirectorLoad, { state: "loading" } | { state: "error" }>> {
  const overview = await gateway.getSessionOverview(bindingId, sessionId, signal);
  const classroom = teacherClassViews(overview).find(
    (item) => item.session.sessionId === sessionId,
  );
  if (!classroom) return { state: "unbound" };
  return {
    state: "ready",
    classroom,
    episode: await gateway.getEpisode(sessionId, bindingId, signal),
  };
}

export function TeacherWaitingState({
  onOpenClasses,
}: {
  onOpenClasses(): void;
}) {
  return (
    <main className="v2-director-wait">
      <section>
        <Clock3 />
        <h1>等待下一项课堂事件</h1>
        <p>当前没有需要教师介入的协作节点。学生产生真实事件后，业务因果链才会出现。</p>
        <button type="button" onClick={onOpenClasses}>
          查看课程与班级<ArrowRight size={16} />
        </button>
      </section>
    </main>
  );
}

const decisionLabels = {
  approve: "批准",
  request_evidence: "要求补证",
  reject: "退回",
} as const;

function gateStatusLabel(gate: TeacherEpisode["teacherGate"]): string {
  if (!gate) return "无需介入";
  switch (gate.status) {
    case "not_required": return "无需介入";
    case "pending": return "待决策";
    case "approved": return "已批准";
    case "rejected": return gate.summary.includes("退回补证")
      ? "已退回补证"
      : "已退回";
  }
}

function teacherRejectionNotice(
  episode: TeacherEpisode,
): { tone: "return" | "failure"; message: string } | null {
  if (!episode.failureCode) return null;
  if (episode.failureCode === "teacher_rejected") {
    if (
      episode.teacherGate?.status === "rejected"
      && episode.teacherGate.summary.includes("退回补证")
    ) {
      return {
        tone: "return",
        message: "已退回补证；学生补证入口尚待接通，本轮没有权威世界写回。",
      };
    }
    return {
      tone: "return",
      message: "教师已退回本次方案；本轮没有权威世界写回。",
    };
  }
  return {
    tone: "failure",
    message: `协作 Episode 已失败关闭：${episode.failureCode}`,
  };
}

function eventSourceLabel(
  source: NonNullable<TeacherEpisode["triggerEvent"]>["source"],
): string {
  switch (source) {
    case "student_action": return "学生行动";
    case "teacher_action": return "教师行动";
    case "world": return "世界状态";
    case "system_time": return "情境时钟";
  }
}

function episodeStatusLabel(episode: TeacherEpisode): string {
  if (episode.status === "awaiting_gate") return "等待教师决策";
  if (episode.status === "completed") return "本轮已完成";
  if (episode.status === "failed") {
    if (
      episode.failureCode === "teacher_rejected"
      && episode.teacherGate?.summary.includes("退回补证")
    ) return "补证入口待接通";
    if (episode.failureCode === "teacher_rejected") return "本轮已退回";
    return "协作已停止";
  }
  return "协作进行中";
}

function TeacherDecisionPanel({
  episode,
  bindingId,
  onDecide,
}: {
  episode: TeacherEpisode;
  bindingId: string;
  onDecide(input: TeacherGateDecisionInput): Promise<void>;
}) {
  const [choice, setChoice] = useState<TeacherGateDecision | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const gate = episode.teacherGate;
  const pending = gate?.status === "pending";

  const decide = async () => {
    if (!choice || !gate || reason.trim().length === 0) {
      setMessage("请写明本次教学决定依据");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await onDecide({
        sessionId: episode.sessionId,
        bindingId,
        gateId: gate.gateId,
        expectedTriggerEventId: episode.triggerEvent?.eventId ?? null,
        expectedStateVersion: episode.stateVersion,
        decision: choice,
        reason: reason.trim(),
      });
      setMessage(`${decisionLabels[choice]}已由服务端权威 Episode 确认`);
      setChoice(null);
      setReason("");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "教师决定记录失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="v2-teacher-decision">
      <header>
        <h2>本次教师决策</h2>
        <span>{gateStatusLabel(gate)}</span>
      </header>
      <dl>
        <div>
          <dt>决策对象</dt>
          <dd>{episode.triggerEvent?.title ?? "当前协作节点"}</dd>
        </div>
        <div>
          <dt>教师门说明</dt>
          <dd>{gate?.summary ?? "当前事件不需要教师门"}</dd>
        </div>
      </dl>
      {episode.contributions.length > 0 ? (
        <section>
          <h3>决策依据</h3>
          {episode.contributions.slice(0, 3).map((item) => (
            <p key={item.contributionId}>• {item.rationale}</p>
          ))}
        </section>
      ) : null}
      {pending ? (
        <>
          <section>
            <h3>责任边界</h3>
            <p>• 批准后仍由服务端决定是否形成权威写回。</p>
            <p>• 要求补证只退回补证，不写入世界结果。</p>
          </section>
          <div className="v2-teacher-decision-actions">
            <button className="approve" type="button" onClick={() => setChoice("approve")}>
              <Check />批准
            </button>
            <button type="button" onClick={() => setChoice("request_evidence")}>
              <FileCheck2 />要求补证
            </button>
            <button className="reject" type="button" onClick={() => setChoice("reject")}>
              <X />退回
            </button>
          </div>
        </>
      ) : null}
      {choice ? (
        <div className="v2-teacher-reason">
          <label htmlFor="teacher-decision-reason">{decisionLabels[choice]}依据</label>
          <textarea
            id="teacher-decision-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="说明教学判断与后续要求"
            maxLength={500}
          />
          <button type="button" disabled={busy} onClick={() => void decide()}>
            {busy ? "正在等待权威回读" : `确认${decisionLabels[choice]}`}
          </button>
        </div>
      ) : null}
      {message ? <p className="v2-decision-message" role="status">{message}</p> : null}
    </aside>
  );
}

function ClassRail({ classroom }: { classroom: TeacherClassView }) {
  return (
    <aside className="v2-director-classrail">
      <h2>当前课堂</h2>
      <section className="v2-current-class">
        <strong>{classroom.experienceTitle}</strong>
        <span>{classroom.classroomName} · {classroom.teamName}</span>
      </section>
      <section>
        <header>
          <strong>训练会话</strong>
          <span>{classroom.session.status === "active" ? "● 进行中" : classroom.session.status}</span>
        </header>
        <p>{classroom.teamName}</p>
        <small>更新于 {new Date(classroom.session.updatedAt).toLocaleString("zh-CN")}</small>
      </section>
      <section>
        <header><strong>教学提示</strong></header>
        <p>只处理当前事件所需的教学决定</p>
        <small>技术运行详情仅管理员可见</small>
      </section>
    </aside>
  );
}

interface CausalStage {
  key: string;
  step: number;
  title: string;
  icon: ReactNode;
  body: ReactNode;
}

function causalStages(episode: TeacherEpisode): CausalStage[] {
  const stages: Array<Omit<CausalStage, "step">> = [];
  if (episode.triggerEvent) {
    stages.push({
      key: "event",
      title: "世界事件",
      icon: <CloudRain />,
      body: (
        <>
          <strong>{episode.triggerEvent.title}</strong>
          <p>{eventSourceLabel(episode.triggerEvent.source)} · {new Date(episode.triggerEvent.occurredAt).toLocaleTimeString("zh-CN")}</p>
        </>
      ),
    });
  }
  if (episode.affectedAgents.length > 0) {
    const selected = episode.affectedAgents.filter((item) => item.decision === "selected");
    const skipped = episode.affectedAgents.filter((item) => item.decision === "skipped");
    stages.push({
      key: "affected",
      title: "受影响集合",
      icon: <UsersRound />,
      body: (
        <>
          <strong>{selected.length} 个选中 · {skipped.length} 个跳过</strong>
          <details>
            <summary>查看筛选理由</summary>
            {episode.affectedAgents.map((item) => (
              <p key={item.agent.agentId}>
                {item.decision === "selected" ? "选中" : "跳过"} {item.agent.title}：{item.reason}
              </p>
            ))}
          </details>
        </>
      ),
    });
  }
  if (episode.contributions.length > 0) {
    stages.push({
      key: "agents",
      title: "智能体调度",
      icon: <Bot />,
      body: (
        <div className="v2-selected-agents">
          {episode.contributions.map((item) => (
            <span key={item.contributionId}>{item.agent.title}：{item.summary}</span>
          ))}
        </div>
      ),
    });
  }
  if (episode.studentDecision) {
    const label = episode.studentDecision.decision === "accept"
      ? "采纳建议"
      : episode.studentDecision.decision === "request_evidence"
        ? "请求补证"
        : "拒绝建议";
    stages.push({
      key: "student",
      title: "学生选择",
      icon: <UserRound />,
      body: <><strong>{label}</strong><p>{episode.studentDecision.reason}</p></>,
    });
  }
  if (episode.teacherGate) {
    stages.push({
      key: "gate",
      title: "教师门",
      icon: <Scale />,
      body: <><strong>{gateStatusLabel(episode.teacherGate)}</strong><p>{episode.teacherGate.summary}</p></>,
    });
  }
  if (episode.authorityWriteback) {
    stages.push({
      key: "writeback",
      title: "世界后果",
      icon: <Send />,
      body: (
        <>
          <strong>{episode.authorityWriteback.occurred ? "已发生权威写回" : "未写入世界"}</strong>
          <p>{episode.authorityWriteback.summary}</p>
          {episode.authorityWriteback.consequences.map((item) => <p key={item}>• {item}</p>)}
        </>
      ),
    });
  }
  return stages.map((stage, index) => ({ ...stage, step: index + 1 }));
}

export function TeacherDirectorSurface({
  classroom,
  episode,
  bindingId,
  recentOutcome = null,
  onDecide,
}: {
  classroom: TeacherClassView;
  episode: TeacherEpisode;
  bindingId: string;
  recentOutcome?: RecentTeacherOutcome | null;
  onDecide(input: TeacherGateDecisionInput): Promise<void>;
}) {
  const stages = causalStages(episode);
  const rejectionNotice = teacherRejectionNotice(episode);
  return (
    <main className="v2-director-page">
      {rejectionNotice ? (
        <div
          className={rejectionNotice.tone === "failure"
            ? "v2-director-failure"
            : "v2-director-return"}
          role={rejectionNotice.tone === "failure" ? "alert" : "status"}
        >
          {rejectionNotice.message}
        </div>
      ) : null}
      {recentOutcome ? (
        <section
          className="v2-recent-teacher-outcome"
          aria-label="刚刚确认的教师门与世界后果"
          role="status"
        >
          <header><Check /><span>刚刚确认</span></header>
          <article>
            <b>教师门</b>
            <strong>已批准</strong>
            <p>{recentOutcome.gateSummary}</p>
          </article>
          <article>
            <b>世界后果</b>
            <strong>已发生权威写回</strong>
            <p>{recentOutcome.consequenceSummary}</p>
          </article>
        </section>
      ) : null}
      <div className="v2-director-body">
        <ClassRail classroom={classroom} />
        <section className="v2-causal-workspace">
          <header>
            <div>
              <h1>课堂因果协作链</h1>
              <p>只展示当前事件已真实发生的业务阶段</p>
            </div>
            <span>{episodeStatusLabel(episode)}</span>
          </header>
          <div className="v2-causal-chain" style={{ "--stage-count": stages.length } as CSSProperties}>
            {stages.map((stage, index) => (
              <article key={stage.key} className={`v2-causal-${stage.key}`}>
                <header><span>{stage.step}</span><b>{stage.title}</b></header>
                <div className="v2-causal-icon">{stage.icon}</div>
                <div>{stage.body}</div>
                {index < stages.length - 1 ? <ArrowRight className="v2-chain-arrow" /> : null}
              </article>
            ))}
          </div>
        </section>
        <TeacherDecisionPanel
          episode={episode}
          bindingId={bindingId}
          onDecide={onDecide}
        />
      </div>
    </main>
  );
}

export function LegacyTeacherDirectorPage({
  gateway,
  sessionId,
  bindingId,
  navigate,
}: {
  gateway: TeacherGateway;
  sessionId: string;
  bindingId: string;
  navigate(path: string): void;
}) {
  const [load, setLoad] = useState<DirectorLoad>({ state: "loading" });
  const [revision, setRevision] = useState(0);
  const [recentOutcome, setRecentOutcome] = useState<RecentTeacherOutcome | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setRecentOutcome(null);
    setLoad((current) => current.state === "ready" ? current : { state: "loading" });
    resolveTeacherDirectorLoad(gateway, sessionId, bindingId, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setLoad(result);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setLoad({
            state: "error",
            message: cause instanceof Error ? cause.message : "无法读取课堂导演",
          });
        }
      });
    return () => controller.abort();
  }, [bindingId, gateway, revision, sessionId]);

  if (load.state === "ready" && load.episode.status === "waiting") {
    return <TeacherWaitingState onOpenClasses={() => navigate("/teacher/classes")} />;
  }
  if (load.state === "ready") {
    return (
      <TeacherDirectorSurface
        classroom={load.classroom}
        episode={load.episode}
        bindingId={bindingId}
        recentOutcome={recentOutcome}
        onDecide={async (input) => {
          try {
            const episode = await submitTeacherGateDecision(gateway, input);
            setRecentOutcome(recentApprovedOutcome(load.episode, episode, input));
            setLoad((current) => current.state === "ready"
              ? { ...current, episode }
              : current);
          } catch (cause) {
            setRecentOutcome(null);
            if (cause instanceof TeacherGateConflictError) {
              setLoad((current) => current.state === "ready"
                ? { ...current, episode: cause.episode }
                : current);
            }
            throw cause;
          }
        }}
      />
    );
  }
  if (load.state === "unbound") {
    return (
      <main className="v2-director-wait">
        <section>
          <AlertTriangle />
          <h1>无法进入该课堂</h1>
          <p>当前教师绑定看不到目标训练会话，已停止读取协作 Episode。</p>
          <button type="button" onClick={() => navigate("/teacher/classes")}>返回班级列表</button>
        </section>
      </main>
    );
  }
  if (load.state === "error") {
    return (
      <main className="v2-director-wait">
        <section>
          <AlertTriangle />
          <h1>课堂导演暂时不可用</h1>
          <p>{load.message}</p>
          <button type="button" onClick={() => setRevision((value) => value + 1)}>
            <RefreshCw size={16} />重试
          </button>
        </section>
      </main>
    );
  }
  return (
    <main className="v2-director-wait">
      <section>
        <LoaderCircle className="spin" />
        <h1>正在进入课堂导演</h1>
        <p>正在读取当前事件与教学责任边界。</p>
      </section>
    </main>
  );
}

export type TeacherDirectorEntry =
  | { state: "flagship_v3" | "flagship_v4"; classroom: TeacherClassView }
  | { state: "standard"; classroom: TeacherClassView }
  | { state: "unbound" };

export async function resolveTeacherDirectorEntry(
  gateway: TeacherGateway,
  sessionId: string,
  bindingId: string,
  signal?: AbortSignal,
): Promise<TeacherDirectorEntry> {
  const [overview, descriptor] = await Promise.all([
    gateway.getSessionOverview(bindingId, sessionId, signal),
    gateway.getSessionExperienceDescriptor(sessionId, bindingId, signal),
  ]);
  const classroom = teacherClassViews(overview).find(
    (candidate) => candidate.session.sessionId === sessionId,
  );
  if (!classroom) return { state: "unbound" };
  return {
    state: trainingExperienceGeneration(descriptor),
    classroom,
  };
}

export default function TeacherDirectorPage(props: {
  gateway: TeacherGateway;
  sessionId: string;
  bindingId: string;
  navigate(path: string): void;
}) {
  const [entry, setEntry] = useState<
    TeacherDirectorEntry
    | { state: "loading" }
    | { state: "error"; message: string }
  >({ state: "loading" });
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setEntry({ state: "loading" });
    resolveTeacherDirectorEntry(
      props.gateway,
      props.sessionId,
      props.bindingId,
      controller.signal,
    ).then((value) => {
      if (!controller.signal.aborted) setEntry(value);
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) {
        setEntry({
          state: "error",
          message: cause instanceof Error ? cause.message : "无法读取课堂会话描述",
        });
      }
    });
    return () => controller.abort();
  }, [props.bindingId, props.gateway, props.sessionId, revision]);

  if (
    (entry.state === "flagship_v3" || entry.state === "flagship_v4")
    && props.gateway.getFlagshipWorld
  ) {
    return <TeacherFlagshipDirectorV3Page
      {...props}
      experienceGeneration={entry.state}
    />;
  }
  if (entry.state === "standard") return <LegacyTeacherDirectorPage {...props} />;
  if (entry.state === "loading") {
    return (
      <main className="v2-director-wait">
        <section>
          <LoaderCircle className="spin" />
          <h1>正在读取课堂会话</h1>
          <p>系统将依据已授权会话的冻结发布信息进入对应导演台。</p>
        </section>
      </main>
    );
  }
  if (entry.state === "flagship_v3" || entry.state === "flagship_v4") {
    return (
      <main className="v2-director-wait">
        <section>
          <AlertTriangle />
          <h1>旗舰导演能力未接入</h1>
          <p>当前客户端没有可用的旗舰世界读取端口，系统已停止回退旧导演台。</p>
          <button type="button" onClick={() => props.navigate("/teacher/classes")}>
            返回课程与班级
          </button>
        </section>
      </main>
    );
  }
  if (entry.state === "unbound") {
    return (
      <main className="v2-director-wait">
        <section>
          <AlertTriangle />
          <h1>当前教师未绑定此课堂</h1>
          <p>请从课程与班级列表进入本人有权管理的训练世界。</p>
          <button type="button" onClick={() => props.navigate("/teacher/classes")}>
            返回课程与班级
          </button>
        </section>
      </main>
    );
  }
  if (entry.state !== "error") return null;
  return (
    <main className="v2-director-wait">
      <section>
        <AlertTriangle />
        <h1>无法读取课堂会话</h1>
        <p>{entry.message}</p>
        <button
          type="button"
          onClick={() => setRevision((value) => value + 1)}
        >
          重试
        </button>
      </section>
    </main>
  );
}
