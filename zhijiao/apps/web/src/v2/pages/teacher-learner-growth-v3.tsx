import { useEffect, useRef, useState } from "react";
import {
  BrainCircuit,
  CheckCircle2,
  CircleAlert,
  Gauge,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import type { TeacherGateway } from "../teacher-gateway";
import type {
  LearnerGrowthViewV3,
  ReviewLearnerAdaptationInputV3,
} from "../learner-adaptation-v3";

type GrowthLoad =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; view: LearnerGrowthViewV3 };

export function TeacherLearnerGrowthPanelV3({
  gateway,
  sessionId,
  bindingId,
  assessmentDecisionId,
}: {
  gateway: TeacherGateway;
  sessionId: string;
  bindingId: string;
  assessmentDecisionId: string;
}) {
  const [load, setLoad] = useState<GrowthLoad>({ state: "loading" });
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState(
    "本轮真实证据与建议压力一致，确认该方案用于下一轮岗位训练。",
  );
  const [overrideLevel, setOverrideLevel] = useState<3 | 4 | 5 | 6 | 7>(5);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const loader = gateway.getLearnerGrowth;
    if (!loader) return undefined;
    const controller = new AbortController();
    setLoad({ state: "loading" });
    loader(sessionId, bindingId, controller.signal).then((view) => {
      if (!controller.signal.aborted) {
        setLoad({ state: "ready", view });
        if (view.nextChallenge) setOverrideLevel(view.nextChallenge.challengeLevel);
      }
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) {
        setLoad({
          state: "error",
          message: cause instanceof Error ? cause.message : "无法读取成长方案",
        });
      }
    });
    return () => {
      controller.abort();
      controllerRef.current?.abort();
    };
  }, [assessmentDecisionId, bindingId, gateway, revision, sessionId]);

  if (!gateway.getLearnerGrowth) return null;
  if (load.state === "loading") {
    return <section className="v3-teacher-growth compact"><LoaderCircle className="spin" />正在形成下一轮成长候选</section>;
  }
  if (load.state === "error") {
    return (
      <section className="v3-teacher-growth compact error" role="alert">
        <CircleAlert /><span>{load.message}</span>
        <button type="button" onClick={() => setRevision((value) => value + 1)}><RefreshCw size={15} />重试</button>
      </section>
    );
  }
  const view = load.view;
  if (!view.profile || !view.learningPlan || !view.nextChallenge) {
    return (
      <section className="v3-teacher-growth compact evidence-required">
        <ShieldCheck />
        <div><strong>尚不生成学习者画像</strong><p>{view.evidenceReadiness.message}</p></div>
      </section>
    );
  }

  const mutate = (
    action: ReviewLearnerAdaptationInputV3["action"],
    challengeLevel?: 3 | 4 | 5 | 6 | 7,
  ) => {
    const execute = gateway.reviewLearnerAdaptation;
    if (!execute || busy || reason.trim().length < 8) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(true);
    setError(null);
    void execute({
      sessionId,
      bindingId,
      requestId: globalThis.crypto.randomUUID(),
      expectedProfileRevision: view.profile!.revision,
      action,
      reason: reason.trim(),
      ...(challengeLevel === undefined ? {} : { challengeLevel }),
    }, controller.signal).then((next) => {
      setLoad({ state: "ready", view: next });
      if (next.nextChallenge) setOverrideLevel(next.nextChallenge.challengeLevel);
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : "成长决策保存失败");
      }
    }).finally(() => {
      if (!controller.signal.aborted) setBusy(false);
      if (controllerRef.current === controller) controllerRef.current = null;
    });
  };

  const appealStatus = view.profile.appeal.status;
  return (
    <section className="v3-teacher-growth" aria-labelledby="teacher-growth-title">
      <header>
        <div><BrainCircuit /><span><small>学习者数字分身 · R{view.profile.revision}</small><h2 id="teacher-growth-title">下一轮压力与成长方案</h2></span></div>
        <dl>
          <div><dt>当前建议</dt><dd>{view.nextChallenge.challengeLevel} 级</dd></div>
          <div><dt>分数上限</dt><dd>{view.nextChallenge.scoreCeiling}</dd></div>
          <div><dt>画像置信</dt><dd>{Math.round(view.profile.confidence * 100)}%</dd></div>
        </dl>
      </header>

      <div className="v3-teacher-growth-grid">
        <div className="targets">
          <h3>成长目标</h3>
          {view.learningPlan.targets.map((target) => (
            <article key={target.competencyClaimId}>
              <strong>{target.title}<span>L{target.currentLevel} → L{target.targetLevel}</span></strong>
              <p>{target.practiceIntent}</p>
            </article>
          ))}
        </div>
        <div className="decision">
          <h3>教师决策</h3>
          <label>
            <span>专业依据</span>
            <textarea value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>
          <label className="level-select">
            <span>如需覆写下一轮压力</span>
            <select
              value={overrideLevel}
              onChange={(event) => setOverrideLevel(Number(event.target.value) as 3 | 4 | 5 | 6 | 7)}
            >
              {[3, 4, 5, 6, 7].map((level) => <option key={level} value={level}>{level} 级</option>)}
            </select>
          </label>
          {error ? <p className="v2-inline-error" role="alert">{error}</p> : null}
          <div className="actions">
            {view.learningPlan.status === "proposed" ? (
              <button type="button" className="v2-primary-cta" disabled={busy} onClick={() => mutate("confirm_plan")}>
                <CheckCircle2 size={16} />{busy ? "正在保存" : "确认成长方案"}
              </button>
            ) : <span className="confirmed"><CheckCircle2 />方案已由教师确认</span>}
            <button type="button" disabled={busy} onClick={() => mutate("override_challenge", overrideLevel)}>
              <Gauge size={16} />覆写为 {overrideLevel} 级
            </button>
          </div>
        </div>
      </div>

      {appealStatus === "requested" || appealStatus === "under_review" ? (
        <div className="v3-teacher-appeal">
          <CircleAlert />
          <div><strong>学生已申请画像复核</strong><p>申诉期间自动更新与调压已经暂停。</p></div>
          <button
            type="button"
            disabled={busy}
            onClick={() => mutate(appealStatus === "requested"
              ? "begin_appeal_review"
              : "resolve_appeal")}
          >
            {appealStatus === "requested" ? "开始复核" : "记录结论并恢复更新"}
          </button>
        </div>
      ) : null}
      <footer><ShieldCheck />代理预测只比较候选冲突与过载，不代答、不造证据、不评分；方案进入执行链前必须由教师确认。</footer>
    </section>
  );
}
