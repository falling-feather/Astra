import { useEffect, useRef, useState } from "react";
import {
  BrainCircuit,
  ChevronRight,
  CircleAlert,
  Gauge,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useExperienceGateway } from "../gateway";
import type { LearnerGrowthViewV3 } from "../learner-adaptation-v3";

type GrowthLoad =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; view: LearnerGrowthViewV3 };

const challengeReason: Record<
  NonNullable<LearnerGrowthViewV3["nextChallenge"]>["assignmentReason"],
  string
> = {
  initial_diagnostic: "首次诊断",
  evidence_progression: "证据支持进阶",
  evidence_recovery: "稳态恢复",
  teacher_override: "教师专业覆写",
};

export function StudentLearnerGrowthPanelV3({
  sessionId,
  bindingId,
  assessmentDecisionId,
}: {
  sessionId: string;
  bindingId: string;
  assessmentDecisionId: string;
}) {
  const gateway = useExperienceGateway();
  const [revision, setRevision] = useState(0);
  const [load, setLoad] = useState<GrowthLoad>({ state: "loading" });
  const [appealOpen, setAppealOpen] = useState(false);
  const [appealReason, setAppealReason] = useState(
    "我认为部分真实作品或现场证据尚未被纳入成长模型，希望教师复核证据链。",
  );
  const [appealBusy, setAppealBusy] = useState(false);
  const [appealError, setAppealError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const loader = gateway.getLearnerGrowth;
    if (!loader) return undefined;
    const controller = new AbortController();
    setLoad({ state: "loading" });
    loader(sessionId, bindingId, controller.signal)
      .then((view) => {
        if (!controller.signal.aborted) setLoad({ state: "ready", view });
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setLoad({
            state: "error",
            message: cause instanceof Error ? cause.message : "无法读取成长模型",
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
    return (
      <section className="v3-growth-panel compact loading" aria-label="个性化成长方案">
        <LoaderCircle className="spin" />正在核对本轮证据是否足以形成成长方案
      </section>
    );
  }
  if (load.state === "error") {
    return (
      <section className="v3-growth-panel compact error" role="alert">
        <CircleAlert />
        <span>{load.message}</span>
        <button type="button" onClick={() => setRevision((value) => value + 1)}>
          <RefreshCw size={15} />重试
        </button>
      </section>
    );
  }

  const view = load.view;
  if (view.profile === null || view.learningPlan === null || view.nextChallenge === null) {
    return (
      <section className="v3-growth-panel compact evidence-required" aria-label="个性化成长方案">
        <ShieldCheck />
        <div>
          <strong>暂不建立学习者模型</strong>
          <p>{view.evidenceReadiness.message}</p>
        </div>
      </section>
    );
  }

  const appealPending = view.state === "appeal_pending";
  return (
    <section className="v3-growth-panel student" aria-labelledby="student-growth-title">
      <header>
        <div className="v3-growth-title">
          <BrainCircuit />
          <span>
            <small>证据化学习者数字分身 · 修订 {view.profile.revision}</small>
            <h2 id="student-growth-title">你的下一轮成长方案</h2>
          </span>
        </div>
        <div className="v3-next-challenge">
          <small>建议压力</small>
          <strong>{view.nextChallenge.challengeLevel}</strong>
          <span>级 · 上限 {view.nextChallenge.scoreCeiling}</span>
        </div>
      </header>

      <div className="v3-growth-explanation">
        <Sparkles />
        <p>
          {challengeReason[view.nextChallenge.assignmentReason]}：系统只依据你本轮真实作品、行动与教师复核，
          在相邻压力中选择过载风险可控且成长价值较高的一档。
        </p>
        <b>画像置信度 {Math.round(view.profile.confidence * 100)}%</b>
      </div>

      <div className="v3-growth-targets">
        {view.learningPlan.targets.map((target) => (
          <article key={target.competencyClaimId}>
            <div><strong>{target.title}</strong><span>L{target.currentLevel} → L{target.targetLevel}</span></div>
            <p>{target.practiceIntent}</p>
            <small>达成证据：{target.successEvidence}</small>
          </article>
        ))}
      </div>

      <div className="v3-growth-boundary" role="note">
        <Gauge />
        <p>{view.forecast?.explanation ?? "成长建议不会替你行动，也不会直接给你评分。"}</p>
      </div>

      {appealPending ? (
        <div className="v3-growth-appeal pending">
          <CircleAlert />
          <div><strong>画像复核中</strong><p>{view.evidenceReadiness.message}</p></div>
        </div>
      ) : appealOpen ? (
        <div className="v3-growth-appeal form">
          <label>
            <span>告诉教师哪条证据或判断需要复核</span>
            <textarea
              value={appealReason}
              onChange={(event) => setAppealReason(event.target.value)}
            />
          </label>
          {appealError ? <p role="alert">{appealError}</p> : null}
          <div>
            <button type="button" onClick={() => setAppealOpen(false)}>取消</button>
            <button
              type="button"
              className="v2-secondary-cta"
              disabled={appealBusy || appealReason.trim().length < 8}
              onClick={() => {
                const mutate = gateway.requestLearnerAppeal;
                if (!mutate || appealBusy) return;
                const controller = new AbortController();
                controllerRef.current = controller;
                setAppealBusy(true);
                setAppealError(null);
                void mutate({
                  sessionId,
                  bindingId,
                  requestId: globalThis.crypto.randomUUID(),
                  reason: appealReason.trim(),
                }, controller.signal).then((next) => {
                  setLoad({ state: "ready", view: next });
                  setAppealOpen(false);
                }).catch((cause: unknown) => {
                  if (!controller.signal.aborted) {
                    setAppealError(cause instanceof Error
                      ? cause.message
                      : "画像申诉提交失败");
                  }
                }).finally(() => {
                  if (!controller.signal.aborted) setAppealBusy(false);
                  if (controllerRef.current === controller) controllerRef.current = null;
                });
              }}
            >
              {appealBusy ? "正在提交" : "提交证据复核"}<ChevronRight size={15} />
            </button>
          </div>
        </div>
      ) : (
        <footer>
          <span>成长方案需教师确认后才会进入下一轮，不会在后台静默生效。</span>
          <button type="button" onClick={() => setAppealOpen(true)}>对画像或调级有异议</button>
        </footer>
      )}
    </section>
  );
}
