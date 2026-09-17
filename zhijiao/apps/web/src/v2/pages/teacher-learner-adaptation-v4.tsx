import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  CircleDashed,
  Gauge,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { GatewayHttpError } from "../gateway";
import type { LearnerAdaptationViewV4 } from "../learner-adaptation-v4";
import type { TeacherGateway } from "../teacher-gateway";

type LoadState =
  | { state: "loading" }
  | { state: "unavailable" }
  | { state: "error"; message: string }
  | { state: "ready"; view: LearnerAdaptationViewV4 };

export function TeacherLearnerAdaptationSurfaceV4({
  view,
  busy,
  error,
  reviewReason,
  onReviewReasonChange,
  onReviewAppeal,
  onAuthorize,
  onOpenSecondSession,
}: {
  view: LearnerAdaptationViewV4;
  busy: boolean;
  error: string | null;
  reviewReason: string;
  onReviewReasonChange(value: string): void;
  onReviewAppeal(resolution: "confirmed" | "reopen_assessment"): void;
  onAuthorize(): void;
  onOpenSecondSession(sessionId: string): void;
}) {
  if (view.state === "evidence_required") return null;
  const proposal = view.proposal;
  const isAppealOpen = view.appeal?.status === "open";
  const canAuthorize = proposal !== null
    && view.consent?.status === "accepted"
    && !isAppealOpen
    && (view.handoff?.status === "proposed" || view.handoff?.status === "authorized");
  const nextSessionId = view.handoff?.sessionRef ?? null;
  const calibration = view.handoff?.calibration ?? null;
  return (
    <section className="v4-adaptation-panel teacher" aria-labelledby="teacher-adaptation-title">
      <header>
        <div>
          <span><Sparkles /> 第二场课程决策</span>
          <h2 id="teacher-adaptation-title">确认机制是否适合这名学生，而不是批准一段文案</h2>
          <p>{view.safeMessage}</p>
        </div>
        {proposal ? <div className="v4-adaptation-level"><Gauge /><strong>{proposal.sourceChallengeLevel} → {proposal.targetChallengeLevel}</strong><small>每次最多变化一级</small></div> : null}
      </header>
      <div className="v4-adaptation-boundary"><ShieldCheck /><p><strong>教师门边界：</strong>学生同意前不可创建；申诉未结前不可创建；候选预测不参与上一场评分。</p></div>

      {proposal ? (
        <div className="v4-teacher-adaptation-grid">
          <article>
            <span>成长靶点</span>
            <h3>{proposal.title}</h3>
            <ul>{proposal.growthTargets.map((target) => <li key={target.criterionId}>{target.title}</li>)}</ul>
          </article>
          <article>
            <span>真实运行变化</span>
            <ul>{proposal.changedMechanics.map((mechanic) => <li key={mechanic.mechanicKind}>{mechanic.safeSummary}</li>)}</ul>
          </article>
          <article>
            <span>成功证据</span>
            <ul>{proposal.successEvidence.map((item) => <li key={item}>{item}</li>)}</ul>
          </article>
        </div>
      ) : null}

      {error ? <div className="v2-inline-error" role="alert">{error}</div> : null}

      {isAppealOpen ? (
        <section className="v4-teacher-appeal-review">
          <header><CircleDashed /><div><h3>学生申请按原始证据复核</h3><p>{view.appeal?.reason}</p></div></header>
          <label>处理理由
            <textarea value={reviewReason} onChange={(event) => onReviewReasonChange(event.target.value)} placeholder="说明核对了哪些原始证据，以及维持或重新评价的理由。" />
          </label>
          <div>
            <button type="button" className="v2-secondary-cta" disabled={busy || reviewReason.trim().length < 8} onClick={() => onReviewAppeal("reopen_assessment")}>退回重新评价</button>
            <button type="button" className="v2-primary-cta" disabled={busy || reviewReason.trim().length < 8} onClick={() => onReviewAppeal("confirmed")}>维持并关闭申诉</button>
          </div>
        </section>
      ) : null}

      {view.consent?.status !== "accepted" && !isAppealOpen && !nextSessionId ? (
        <div className="v4-adaptation-status waiting"><CircleDashed /><div><strong>等待学生决定</strong><p>学生可以同意、拒绝或申诉；教师不能代替学生勾选同意。</p></div></div>
      ) : null}

      {canAuthorize ? (
        <footer className="v4-adaptation-actions">
          <div><strong>学生已明确同意</strong><small>授权后将创建独立会话、成员关系、记者岗位与不可变世界发布版。</small></div>
          <button type="button" className="v2-primary-cta" disabled={busy} onClick={onAuthorize}>{busy ? "正在创建第二场" : view.handoff?.status === "authorized" ? "继续完成第二场创建" : "授权并创建真实第二场"}<ArrowRight size={17} /></button>
        </footer>
      ) : null}

      {nextSessionId ? (
        <div className="v4-adaptation-status success"><CheckCircle2 /><div><strong>第二场已经进入可体验状态</strong><p>{calibration?.outcome
          ? `第二场任务结果：${calibration.outcome === "success" ? "成功" : "未达成"}；过程覆盖度 ${Math.round((calibration.observedBehaviorAlignment ?? 0) * 100)}%。教师仍可进入导演台复核真实事件与后果。`
          : "教师可进入导演台观察新冲突、NPC 阻力和证据条件。"}</p></div><button type="button" className="v2-primary-cta" onClick={() => onOpenSecondSession(nextSessionId)}>进入第二场导演台</button></div>
      ) : null}
    </section>
  );
}

export function TeacherLearnerAdaptationPanelV4({
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
  const [load, setLoad] = useState<LoadState>(gateway.getLearnerAdaptationV4 ? { state: "loading" } : { state: "unavailable" });
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewReason, setReviewReason] = useState("");
  const controllerRef = useRef<AbortController | null>(null);
  const authorizationRequestIdRef = useRef<string | null>(null);

  useEffect(() => {
    const read = gateway.getLearnerAdaptationV4;
    if (!read) { setLoad({ state: "unavailable" }); return undefined; }
    const controller = new AbortController();
    setLoad({ state: "loading" });
    read(sessionId, bindingId, controller.signal).then((view) => {
      if (!controller.signal.aborted) setLoad({ state: "ready", view });
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      if (cause instanceof GatewayHttpError && cause.status === 404) setLoad({ state: "unavailable" });
      else setLoad({ state: "error", message: cause instanceof Error ? cause.message : "无法读取第二场课程决策" });
    });
    return () => controller.abort();
  }, [bindingId, gateway, revision, sessionId]);

  useEffect(() => () => controllerRef.current?.abort(), []);
  useEffect(() => {
    authorizationRequestIdRef.current = null;
  }, [sessionId]);
  if (load.state === "unavailable") return null;
  if (load.state === "loading") return <section className="v4-adaptation-panel compact"><LoaderCircle className="spin" /><div><h2>正在核对第二场机制</h2><p>读取学生同意、申诉和可执行发布版。</p></div></section>;
  if (load.state === "error") return <section className="v4-adaptation-panel compact error"><RefreshCw /><div><h2>第二场决策暂不可用</h2><p>{load.message}</p></div><button type="button" onClick={() => setRevision((value) => value + 1)}>重试</button></section>;

  const mutate = async (operation: (signal: AbortSignal) => Promise<LearnerAdaptationViewV4>) => {
    if (busy) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(true); setError(null);
    try {
      const view = await operation(controller.signal);
      if (!controller.signal.aborted) setLoad({ state: "ready", view });
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : "教师决定未被服务端确认");
        if (cause instanceof GatewayHttpError && cause.status === 409) setRevision((value) => value + 1);
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  };

  return <TeacherLearnerAdaptationSurfaceV4
    view={load.view}
    busy={busy}
    error={error}
    reviewReason={reviewReason}
    onReviewReasonChange={setReviewReason}
    onReviewAppeal={(resolution) => {
      const write = gateway.reviewLearnerAdaptationAppealV4;
      const appealRef = load.view.appeal?.appealRef;
      if (!write || !appealRef || reviewReason.trim().length < 8) return;
      void mutate((signal) => write({
        sessionId, bindingId, requestId: globalThis.crypto.randomUUID(),
        expectedAppealRef: appealRef, resolution, reason: reviewReason.trim(),
      }, signal).then((view) => { setReviewReason(""); return view; }));
    }}
    onAuthorize={() => {
      const write = gateway.authorizeSecondSessionV4;
      const handoffId = load.view.proposal?.handoffId;
      if (!write || !handoffId) return;
      const requestId = authorizationRequestIdRef.current
        ?? globalThis.crypto.randomUUID();
      authorizationRequestIdRef.current = requestId;
      void mutate((signal) => write({
        sessionId, bindingId, requestId, expectedHandoffId: handoffId,
      }, signal).then((view) => {
        if (view.handoff?.status === "provisioned"
          || view.handoff?.status === "calibration_completed") {
          authorizationRequestIdRef.current = null;
        }
        return view;
      }));
    }}
    onOpenSecondSession={(nextSessionId) => navigate(`/teacher/director/${encodeURIComponent(nextSessionId)}`)}
  />;
}
