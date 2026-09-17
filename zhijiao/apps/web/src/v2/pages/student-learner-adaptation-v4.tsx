import { useEffect, useRef, useState } from "react";
import { LearnerCalibrationLegacyPolicyVersionV4 } from "@ronggang/contracts";
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
import { GatewayHttpError, useExperienceGateway } from "../gateway";
import type { LearnerAdaptationViewV4 } from "../learner-adaptation-v4";

type LoadState =
  | { state: "loading" }
  | { state: "unavailable" }
  | { state: "error"; message: string }
  | { state: "ready"; view: LearnerAdaptationViewV4 };

const mechanicLabels: Record<string, string> = {
  event_templates: "冲突事件",
  npc_resistance: "人物阻力",
  evidence_availability: "证据条件",
  deadline_pattern: "时间压力",
  scaffolding_budget: "支架预算",
};

const bandLabels = {
  low: "重点训练",
  medium: "岗位基础",
  high: "较强表现",
} as const;

export function StudentLearnerAdaptationSurfaceV4({
  view,
  busy,
  error,
  appealReason,
  onAppealReasonChange,
  onConsent,
  onAppeal,
  onEnterSecondSession,
}: {
  view: LearnerAdaptationViewV4;
  busy: boolean;
  error: string | null;
  appealReason: string;
  onAppealReasonChange(value: string): void;
  onConsent(accepted: boolean): void;
  onAppeal(): void;
  onEnterSecondSession(sessionId: string): void;
}) {
  if (view.state === "evidence_required") {
    return (
      <section className="v4-adaptation-panel compact" aria-label="第二场自适应训练">
        <CircleDashed />
        <div><h2>第二场暂未生成</h2><p>{view.safeMessage}</p></div>
      </section>
    );
  }

  const proposal = view.proposal;
  const canAppeal = proposal !== null
    && view.appeal?.status !== "open"
    && !["provisioned", "calibrated", "failed"].includes(view.state);
  const canConsent = proposal !== null
    && view.appeal?.status !== "open"
    && !["provisioned", "calibrated", "failed"].includes(view.state);
  const secondSessionId = view.handoff?.sessionRef ?? null;
  const calibration = view.handoff?.calibration ?? null;

  return (
    <section className="v4-adaptation-panel" aria-labelledby="student-adaptation-title">
      <header>
        <div>
          <span><Sparkles /> 第二场自适应训练</span>
          <h2 id="student-adaptation-title">不是给你贴标签，而是改变下一场</h2>
          <p>{view.safeMessage}</p>
        </div>
        {proposal ? (
          <div className="v4-adaptation-level">
            <Gauge />
            <strong>{proposal.sourceChallengeLevel} → {proposal.targetChallengeLevel}</strong>
            <small>挑战每次最多变化一级</small>
          </div>
        ) : null}
      </header>

      <div className="v4-adaptation-boundary" role="note">
        <ShieldCheck />
        <p><strong>能力模型只来自可复核行为证据。</strong>不做人格诊断，不使用敏感属性，也不会替你行动、造证据或给你评分。</p>
      </div>

      {proposal ? (
        <>
          <section className="v4-adaptation-focus">
            <div>
              <span>本轮成长靶点</span>
              <h3>{proposal.title}</h3>
              <div className="v4-adaptation-chips">
                {proposal.growthTargets.map((target) => <b key={target.criterionId}>{target.title}</b>)}
              </div>
            </div>
            <p>{view.nextAction}</p>
          </section>

          <section className="v4-mechanic-grid" aria-label="第二场真实机制变化">
            {proposal.changedMechanics.map((mechanic) => (
              <article key={mechanic.mechanicKind}>
                <span>{mechanicLabels[mechanic.mechanicKind] ?? mechanic.mechanicKind}</span>
                <p>{mechanic.safeSummary}</p>
              </article>
            ))}
          </section>

          <details className="v4-adaptation-details">
            <summary>查看六维证据依据与达成条件</summary>
            <div className="v4-adaptation-criteria">
              {view.learnerModel?.criteria.map((criterion) => (
                <article key={criterion.criterionId} className={criterion.growthTarget ? "target" : ""}>
                  <div><strong>{criterion.title}</strong><span>{bandLabels[criterion.band]}</span></div>
                  <b>{criterion.score}</b>
                  <small>{criterion.evidenceCount} 条独立证据 · 置信度 {Math.round(criterion.confidence * 100)}%</small>
                </article>
              ))}
            </div>
            <ul>{proposal.successEvidence.map((item) => <li key={item}>{item}</li>)}</ul>
          </details>
        </>
      ) : null}

      {error ? <div className="v2-inline-error" role="alert">{error}</div> : null}

      {view.state === "appeal_open" ? (
        <div className="v4-adaptation-status waiting">
          <CircleDashed /><div><strong>申诉已冻结第二场创建</strong><p>{view.appeal?.reason}</p></div>
        </div>
      ) : null}

      {view.state === "provisioned" || view.state === "calibrated" ? (
        <div className="v4-adaptation-status success">
          <CheckCircle2 />
          <div>
            <strong>第二场岗位世界已经创建</strong>
            <p>{view.state === "calibrated" && calibration?.outcome
              ? `冻结观察窗口已结束，第二场任务结果为${calibration.outcome === "success" ? "成功" : "未达成"}；过程覆盖度 ${Math.round((calibration.observedBehaviorAlignment ?? 0) * 100)}%。这些数据不计入上一场成绩。`
              : view.state === "calibrated"
                ? `已按旧版动作对齐口径保留 ${calibration?.actionCount ?? 0} 个真实行动的历史校准；这些数据不计入上一场成绩。`
              : "新场次拥有独立会话、记者岗位、冲突事件和证据条件。"}</p>
            {view.state === "calibrated" && calibration?.observationWindow ? (
              <small>校准策略 {calibration.policyVersion ?? LearnerCalibrationLegacyPolicyVersionV4}；观察窗口虚拟第 {calibration.observationWindow.startVirtualMinute}—{calibration.observationWindow.endVirtualMinute} 分钟。</small>
            ) : null}
            {view.state === "calibrated" && calibration?.unmetRequirements?.length ? (
              <small>仍未满足：{calibration.unmetRequirements.join("；")}</small>
            ) : null}
          </div>
          {secondSessionId ? (
            <button type="button" className="v2-primary-cta" onClick={() => onEnterSecondSession(secondSessionId)}>
              进入第二场 <ArrowRight size={17} />
            </button>
          ) : null}
        </div>
      ) : null}

      {view.state === "failed" ? (
        <div className="v4-adaptation-status failed">
          <RefreshCw /><div><strong>第二场创建已失败关闭</strong><p>候选方案没有被伪装成已开课，请由教师或管理员检查后重试。</p></div>
        </div>
      ) : null}

      {canConsent ? (
        <footer className="v4-adaptation-actions">
          <div>
            <strong>{view.consent?.status === "accepted" ? "你已同意，等待教师授权" : view.consent?.status === "declined" ? "你已暂不进入第二场" : "由你决定是否进入第二场"}</strong>
            <small>同意不会自动开课；教师仍需确认训练目标与班级适用性。</small>
          </div>
          <button type="button" className="v2-secondary-cta" disabled={busy} onClick={() => onConsent(false)}>暂不进入</button>
          <button type="button" className="v2-primary-cta" disabled={busy} onClick={() => onConsent(true)}>
            {busy ? "正在确认" : "同意进入第二场"}
          </button>
        </footer>
      ) : null}

      {canAppeal ? (
        <details className="v4-adaptation-appeal">
          <summary>认为证据遗漏或判断不准确？发起申诉</summary>
          <label>请指出需要复核的具体证据
            <textarea
              value={appealReason}
              onChange={(event) => onAppealReasonChange(event.target.value)}
              placeholder="例如：采访录音中的二次授权没有进入‘采访与同意’维度，请按原始证据重新核对。"
            />
          </label>
          <button type="button" className="v2-secondary-cta" disabled={busy || appealReason.trim().length < 8} onClick={onAppeal}>提交证据申诉</button>
        </details>
      ) : null}
    </section>
  );
}

export function StudentLearnerAdaptationPanelV4({
  sessionId,
  bindingId,
  navigate,
}: {
  sessionId: string;
  bindingId: string;
  navigate(path: string): void;
}) {
  const gateway = useExperienceGateway();
  const [load, setLoad] = useState<LoadState>(gateway.getLearnerAdaptationV4
    ? { state: "loading" }
    : { state: "unavailable" });
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appealReason, setAppealReason] = useState("");
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const read = gateway.getLearnerAdaptationV4;
    if (!read) {
      setLoad({ state: "unavailable" });
      return undefined;
    }
    const controller = new AbortController();
    setLoad({ state: "loading" });
    setError(null);
    read(sessionId, bindingId, controller.signal).then((view) => {
      if (!controller.signal.aborted) setLoad({ state: "ready", view });
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      if (cause instanceof GatewayHttpError && cause.status === 404) {
        setLoad({ state: "unavailable" });
      } else {
        setLoad({ state: "error", message: cause instanceof Error ? cause.message : "无法读取第二场方案" });
      }
    });
    return () => controller.abort();
  }, [bindingId, gateway, revision, sessionId]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  if (load.state === "unavailable") return null;
  if (load.state === "loading") {
    return <section className="v4-adaptation-panel compact"><LoaderCircle className="spin" /><div><h2>正在生成第二场解释</h2><p>核对终裁证据与可执行世界变化。</p></div></section>;
  }
  if (load.state === "error") {
    return <section className="v4-adaptation-panel compact error"><RefreshCw /><div><h2>第二场方案暂不可用</h2><p>{load.message}</p></div><button type="button" onClick={() => setRevision((value) => value + 1)}>重试</button></section>;
  }

  const mutate = async (operation: (signal: AbortSignal) => Promise<LearnerAdaptationViewV4>) => {
    if (busy) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(true);
    setError(null);
    try {
      const view = await operation(controller.signal);
      if (!controller.signal.aborted) setLoad({ state: "ready", view });
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : "第二场决定未被服务端确认");
        if (cause instanceof GatewayHttpError && cause.status === 409) {
          setRevision((value) => value + 1);
        }
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  };

  return (
    <StudentLearnerAdaptationSurfaceV4
      view={load.view}
      busy={busy}
      error={error}
      appealReason={appealReason}
      onAppealReasonChange={setAppealReason}
      onConsent={(accepted) => {
        const write = gateway.recordLearnerConsentV4;
        if (!write) return;
        void mutate((signal) => write({
          sessionId,
          bindingId,
          requestId: globalThis.crypto.randomUUID(),
          accepted,
        }, signal));
      }}
      onAppeal={() => {
        const write = gateway.requestLearnerAdaptationAppealV4;
        if (!write || appealReason.trim().length < 8) return;
        void mutate((signal) => write({
          sessionId,
          bindingId,
          requestId: globalThis.crypto.randomUUID(),
          reason: appealReason.trim(),
        }, signal).then((view) => {
          setAppealReason("");
          return view;
        }));
      }}
      onEnterSecondSession={(nextSessionId) => {
        if(busy)return;
        setBusy(true);setError(null);
        void(async()=>{
          if(!gateway.getStudy||!gateway.enterPreparedStudy)throw new Error('当前连接尚未提供后续训练开课服务');
          const state=await gateway.getStudy();
          const entered=await gateway.enterPreparedStudy({requestId:globalThis.crypto.randomUUID(),sourceSessionId:sessionId,sessionId:nextSessionId,expectedRevision:state.revision});
          navigate(`/student/training/${encodeURIComponent(entered.run.sessionId)}`);
        })().catch(cause=>setError(cause instanceof Error?cause.message:'后续训练尚未进入在学记录')).finally(()=>setBusy(false));
      }}
    />
  );
}
