import { useCallback } from "react";
import { LearnerCalibrationLegacyPolicyVersionV4, type BusinessOperationReceipt } from "@ronggang/contracts";
import {
  Activity,
  BrainCircuit,
  DatabaseZap,
  GitCompareArrows,
  Hash,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
import { loadAdminEvidence } from "../admin-evidence-loader";
import type { AdminGateway } from "../admin-gateway";
import type { FlagshipAssessmentCaseV3 } from "../assessment-v3";
import type { FlagshipEvidenceAssessmentAdminCaseV4 } from "../assessment-v4";
import type { LearnerAdaptationCaseV3 } from "../learner-adaptation-v3";
import type { LearnerAdaptationAdminCaseV4 } from "../learner-adaptation-v4";
import { evidenceReferenceSummary } from "../admin-models";
import { useAdminResource } from "./use-admin-resource";

export function AdminLearnerAdaptationCaseSurface({
  value,
}: {
  value: LearnerAdaptationCaseV3;
}) {
  if (value.state === "evidence_required") {
    return (
      <section className="v3-admin-adaptation empty">
        <BrainCircuit />
        <div>
          <h2>学习者数字分身尚未建立</h2>
          <p>六维证据未全部达到失败关闭门，或教师尚未完成复核；系统没有制造画像、预测或调级。</p>
        </div>
      </section>
    );
  }
  const profile = value.profileHistory.at(-1)!;
  const forecast = value.forecasts.at(-1)!;
  const assignment = value.challengeAssignments.at(-1)!;
  const plan = value.learningPlans.at(-1)!;
  const policy = value.policyReceipts.at(-1)!;
  return (
    <section className="v3-admin-adaptation" aria-labelledby="admin-adaptation-title">
      <header>
        <div>
          <span>LEARNER TWIN / PROXY AUDIT</span>
          <h2 id="admin-adaptation-title">学习者数字分身与反事实候选</h2>
          <p>管理员可重放画像哈希、候选预测、校准误差和压力策略；原始学生身份不进入该记录。</p>
        </div>
        <b>R{profile.revision} · {Math.round(profile.confidence * 100)}%</b>
      </header>
      <div className="v3-admin-adaptation-boundaries">
        <article><ShieldCheck /><span><strong>零代答 / 零造证据 / 零评分</strong><small>三项代理权限固定为 false</small></span></article>
        <article><Hash /><span><strong>主体哈希</strong><code>{value.principalBindingHash?.slice(0, 16)}…</code></span></article>
        <article><DatabaseZap /><span><strong>画像哈希</strong><code>{profile.profileContentHash.slice(0, 16)}…</code></span></article>
        <article><Activity /><span><strong>下一轮</strong><small>{assignment.challengeLevel} 级 · 上限 {assignment.scoreCeiling}</small></span></article>
      </div>
      <div className="v3-admin-forecast-candidates">
        <header><h3>沙箱候选世界</h3><span>{forecast.candidates.length} 个 · {forecast.uncertainty.dataSufficiency} 数据充分度</span></header>
        <div>
          {forecast.candidates.map((candidate) => (
            <article key={candidate.candidateId} className={candidate.worldVariantRef === assignment.worldVariantRef ? "selected" : ""}>
              <header><strong>{candidate.challengeLevel} 级</strong>{candidate.worldVariantRef === assignment.worldVariantRef ? <b>已选</b> : null}</header>
              <dl>
                <div><dt>成功</dt><dd>{Math.round(candidate.predictedSuccessProbability * 100)}%</dd></div>
                <div><dt>过载</dt><dd>{Math.round(candidate.predictedOverloadProbability * 100)}%</dd></div>
                <div><dt>成长</dt><dd>{Math.round(candidate.predictedGrowthValue * 100)}%</dd></div>
              </dl>
              <p>{candidate.rationale}</p>
            </article>
          ))}
        </div>
      </div>
      <div className="v3-admin-adaptation-audit">
        <article>
          <h3>策略选择</h3>
          <p>{policy.explanation}</p>
          <code>{policy.selectedCandidateId}</code>
        </article>
        <article>
          <h3>预测校准</h3>
          <p>{forecast.calibration.status === "evaluated"
            ? `已由 ${forecast.calibration.actualStudentActionRefs.length} 个真实行动校准，误差 ${Math.round((forecast.calibration.predictionError ?? 0) * 100)}%。`
            : "等待下一轮真实学生行动；预测本身不进入能力证据。"}</p>
          <code>{forecast.forecastModelContentHash.slice(0, 16)}…</code>
        </article>
        <article>
          <h3>教师门</h3>
          <p>{plan.teacherConfirmation
            ? `已确认：${plan.teacherConfirmation.note}`
            : "成长方案仍为 proposed，不会自动进入执行链。"}</p>
          <code>{plan.learningPlanId}</code>
        </article>
      </div>
    </section>
  );
}

const adaptationCriterionLabels: Record<string, string> = {
  "criterion-fact-verification": "事实核验",
  "criterion-interview-consent": "采访与同意",
  "criterion-editorial-judgment": "编辑判断",
  "criterion-rights-governance": "权利与治理",
  "criterion-multiplatform-production": "多平台生产",
  "criterion-recovery-transfer": "纠错与迁移",
};

export function AdminLearnerAdaptationCaseSurfaceV4({
  value,
}: {
  value: LearnerAdaptationAdminCaseV4;
}) {
  const proposal = value.handoff.proposal;
  const calibration = value.handoff.calibration;
  const calibrationHistory = value.learnerTwin.calibrationHistory;
  return (
    <section className="v4-admin-adaptation" aria-labelledby="admin-adaptation-v4-title">
      <header>
        <div>
          <span>LEARNER TWIN V4 / SECOND WORLD AUDIT</span>
          <h2 id="admin-adaptation-v4-title">证据学习者模型与第二场机制审计</h2>
          <p>管理员可核对候选预测、同意、申诉、教师授权和真实会话写入；原始身份与学生原话不进入该记录。</p>
        </div>
        <b>{value.handoff.status}</b>
      </header>

      <div className="v3-admin-adaptation-boundaries">
        <article><ShieldCheck /><span><strong>代理权限固定为零</strong><small>不代答、不造证据、不评分</small></span></article>
        <article><Hash /><span><strong>学习者主体哈希</strong><code>{value.learnerSubjectHash.slice(0, 16)}…</code></span></article>
        <article><DatabaseZap /><span><strong>模型内容哈希</strong><code>{value.learnerTwin.contentHash.slice(0, 16)}…</code></span></article>
        <article><Activity /><span><strong>同意 / 申诉</strong><small>{value.consent?.status ?? "—"} · {value.appeal.status}</small></span></article>
      </div>

      <div className="v4-admin-twin-grid">
        {value.learnerTwin.criterionStates.map((criterion) => (
          <article key={criterion.criterionId} className={value.learnerTwin.growthTargetRefs.includes(criterion.criterionId) ? "target" : ""}>
            <header><strong>{adaptationCriterionLabels[criterion.criterionId] ?? criterion.criterionId}</strong><b>{criterion.score}</b></header>
            <p>{criterion.band} · {criterion.evidenceStatus}</p>
            <small>{criterion.evidenceRefs.length} 条证据 · confidence {Math.round(criterion.confidence * 100)}%</small>
          </article>
        ))}
      </div>

      <section className="v3-admin-forecast-candidates">
        <header><h3>四个反事实候选世界</h3><span>选中 {value.forecast.selectedVariantRef}</span></header>
        <div>
          {value.forecast.candidates.map((candidate) => (
            <article key={candidate.variantRef} className={candidate.variantRef === value.forecast.selectedVariantRef ? "selected" : ""}>
              <header><strong>{candidate.variantRef.replace("variant-xunpu-", "")}</strong>{candidate.variantRef === value.forecast.selectedVariantRef ? <b>已选</b> : null}</header>
              <dl>
                <div><dt>成功</dt><dd>{Math.round(candidate.predictedSuccessProbability * 100)}%</dd></div>
                <div><dt>过载</dt><dd>{Math.round(candidate.predictedOverloadProbability * 100)}%</dd></div>
                <div><dt>成长</dt><dd>{Math.round(candidate.predictedGrowthValue * 100)}%</dd></div>
              </dl>
              <p>{candidate.rationale}</p>
            </article>
          ))}
        </div>
      </section>

      {proposal ? (
        <section className="v4-admin-mechanics">
          <header><h3>不可变第二场机制差异</h3><span>{proposal.changedMechanics.length} 项</span></header>
          <div>{proposal.changedMechanics.map((mechanic) => (
            <article key={mechanic.mechanicKind}>
              <strong>{mechanic.mechanicKind}</strong>
              <p>{mechanic.safeSummary}</p>
              <code>{mechanic.beforeHash.slice(0, 10)} → {mechanic.afterHash.slice(0, 10)}</code>
            </article>
          ))}</div>
        </section>
      ) : null}

      <div className="v3-admin-adaptation-audit">
        <article><h3>学生控制权</h3><p>同意：{value.consent?.status ?? "未生成"}；申诉：{value.appeal.status}</p><code>{value.appeal.appealRef ?? "no-appeal"}</code></article>
        <article><h3>教师门与写回</h3><p>{value.handoff.status} · {value.handoff.writeDisposition}</p><code>{value.handoff.teacherAuthorizationRef ?? "not-authorized"}</code></article>
        <article><h3>幂等审计</h3><p>{value.requestReceipts.length} 个用户决定回执；预测与校准均不计分。</p><code>{value.forecast.forecastRef}</code></article>
        {calibration ? (
          <article>
            <h3>第二场任务结果</h3>
            <p>{calibration.outcome
              ? `${calibration.policyVersion ?? LearnerCalibrationLegacyPolicyVersionV4} · ${calibration.outcome === "success" ? "success" : "failure"} · 过程覆盖度 ${Math.round((calibration.observedBehaviorAlignment ?? 0) * 100)}%`
              : `${LearnerCalibrationLegacyPolicyVersionV4} · 旧版动作对齐报告`}</p>
            {calibration.observationWindow ? <small>窗口：虚拟第 {calibration.observationWindow.startVirtualMinute}—{calibration.observationWindow.endVirtualMinute} 分钟，{calibration.observationWindow.closedBy}。</small> : null}
            {calibration.unmetRequirements?.length ? <small>未满足：{calibration.unmetRequirements.join("；")}</small> : null}
          </article>
        ) : null}
        {calibrationHistory.length > 0 ? (
          <article>
            <h3>校准历史口径</h3>
            <p>{calibrationHistory.map((entry) => entry.policyVersion ?? LearnerCalibrationLegacyPolicyVersionV4).join("、")}</p>
            <small>历史 actionEvidenceHash 原样保留：{calibrationHistory.map((entry) => `${entry.actionEvidenceHash.slice(0, 10)}…`).join("、")}；新任务结果策略单独编号。</small>
          </article>
        ) : null}
      </div>
    </section>
  );
}

export function AdminAssessmentCaseSurface({ value }: { value: FlagshipAssessmentCaseV3 }) {
  const current = value.decisionHistory.at(-1)!;
  return (
    <>
      <header className="v2-admin-heading v3-admin-assessment-heading">
        <div>
          <h1>能力评价重算案例</h1>
          <p>管理员可验证证据来源、去身份盲评回执、后置挑战修正和教师差异；这些内部字段不进入师生普通页面。</p>
        </div>
        <span>{current.scoreStatus === "insufficient_evidence" ? "不出分" : `${current.sessionScore} / ${current.scoreCeiling}`}</span>
      </header>

      <section className="v3-admin-assessment-boundaries">
        <article><ShieldCheck /><div><strong>盲评隔离</strong><p>身份、挑战等级、智能体建议均不可见</p></div></article>
        <article><Hash /><div><strong>来源哈希</strong><code>{value.sourceHash.slice(0, 16)}…</code></div></article>
        <article><GitCompareArrows /><div><strong>挑战后置</strong><p>先盲评，再做 3—7 级透明修正</p></div></article>
        <article><DatabaseZap /><div><strong>可重算</strong><p>记录版本 #{value.recomputation.sourceRecordRevision}</p></div></article>
      </section>

      <section className="v3-admin-score-computations">
        <header><h2>六维计分路径</h2><span>{value.scoreComputations.length} 个冻结维度</span></header>
        <div>
          {value.scoreComputations.map((item) => (
            <article key={item.competencyClaimId}>
              <header><strong>{item.competencyClaimId.replace("criterion-", "")}</strong><b>{item.normalizedScore ?? "—"}</b></header>
              <dl>
                <div><dt>盲评原始</dt><dd>{item.rawSemanticScore ?? "—"}</dd></div>
                <div><dt>行为调整</dt><dd>{item.behaviorAdjustment >= 0 ? "+" : ""}{item.behaviorAdjustment}</dd></div>
                <div><dt>挑战后置</dt><dd>+{item.challengeAdjustment}</dd></div>
                <div><dt>独立证据</dt><dd>{item.eligibleIndependentEvidenceCount}/{item.minimumIndependentEvidenceCount}</dd></div>
              </dl>
              {item.failClosedReasons.length > 0 ? (
                <p className="blocked">失败关闭：{item.failClosedReasons.join("；")}</p>
              ) : <p className="ready">证据门已满足，等待或已完成教师复核。</p>}
            </article>
          ))}
        </div>
      </section>

      <section className="v3-admin-semantic-receipts">
        <header><h2>去身份语义回执</h2><span>{value.semanticReceipts.length} 条</span></header>
        {value.semanticReceipts.length === 0 ? (
          <div className="v2-admin-empty"><h2>尚无作品语义回执</h2><p>学生保存真实作品版本后才会生成。</p></div>
        ) : (
          <div>
            {value.semanticReceipts.slice(-12).reverse().map((receipt) => (
              <article key={receipt.semanticReceiptId}>
                <span className={receipt.direction}>{receipt.direction}</span>
                <div>
                  <strong>{receipt.competencyClaimId}</strong>
                  <p>{receipt.rationale}</p>
                  <small>{receipt.evaluatorMode} · confidence {Math.round(receipt.confidence * 100)}%</small>
                </div>
                <code>{receipt.inputHash.slice(0, 12)} → {receipt.outputHash.slice(0, 12)}</code>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="v3-admin-decision-history">
        <header><h2>评价与教师差异链</h2><span>{value.decisionHistory.length} 个版本</span></header>
        {value.decisionHistory.map((decision, index) => (
          <article key={decision.assessmentDecisionId}>
            <b>V{index + 1}</b>
            <div>
              <strong>{decision.scoreStatus} · {decision.sessionScore ?? "不出分"}</strong>
              <p>{decision.growthSummary}</p>
            </div>
            <span>{decision.teacherReview.status}</span>
          </article>
        ))}
      </section>
    </>
  );
}

export function AdminEvidenceAssessmentCaseSurfaceV4({
  value,
}: {
  value: FlagshipEvidenceAssessmentAdminCaseV4;
}) {
  const current = value.decisionHistory.at(-1)!.decision;
  const counts = Object.entries(value.evidenceFacts.reduce<Record<string, number>>(
    (result, fact) => ({ ...result, [fact.sourceKind]: (result[fact.sourceKind] ?? 0) + 1 }),
    {},
  ));
  return (
    <>
      <header className="v2-admin-heading v3-admin-assessment-heading">
        <div>
          <h1>抗取巧证据评价审计</h1>
          <p>这里展示去身份输入、结构化岗位事实、独立证据门、教师差异与后置挑战上限；原始学生文本、Prompt 和智能体建议不进入评分输入。</p>
        </div>
        <span>{current.sessionScore === null ? "不出分" : `${current.sessionScore} / ${value.scoreCeiling}`}</span>
      </header>

      <section className="v3-admin-assessment-boundaries">
        <article><ShieldCheck /><div><strong>盲化六项排除</strong><p>{value.blindInput.excludedContextFields.length} 类身份与技术上下文被移除</p></div></article>
        <article><Hash /><div><strong>输入 / 来源双哈希</strong><code>{value.blindInput.inputHash.slice(0, 10)} · {value.sourceHash.slice(0, 10)}</code></div></article>
        <article><GitCompareArrows /><div><strong>挑战后置</strong><p>盲评后再施加 {value.scoreCeiling} 分上限</p></div></article>
        <article><DatabaseZap /><div><strong>表面信号零使用</strong><p>篇幅、关键词、点击和结局只保留审计值</p></div></article>
      </section>

      <section className="v4-admin-evidence-facts">
        <header><h2>结构化岗位事实</h2><span>{value.evidenceFacts.length} 条 · 按独立键去重</span></header>
        <div className="v4-admin-source-counts">
          {counts.map(([sourceKind, count]) => (
            <article key={sourceKind}><b>{count}</b><span>{sourceKind}</span></article>
          ))}
        </div>
        <div className="v4-admin-fact-list">
          {value.evidenceFacts.slice(-24).reverse().map((fact) => (
            <article key={`${fact.evidenceRef}-${fact.evidenceCode}`}>
              <span>{fact.sourceKind}</span>
              <div><strong>{fact.evidenceCode}</strong><code>{fact.evidenceRef}</code></div>
              <code>{fact.sourceContentHash.slice(0, 12)}…</code>
            </article>
          ))}
        </div>
      </section>

      <section className="v3-admin-score-computations">
        <header><h2>六维盲化判断</h2><span>{value.blindJudgments.length} 个冻结维度</span></header>
        <div>
          {value.blindJudgments.map((judgment) => (
            <article key={judgment.criterionId}>
              <header><strong>{judgment.criterionId.replace("criterion-", "")}</strong><b>{judgment.score ?? "—"}</b></header>
              <dl>
                <div><dt>证据状态</dt><dd>{judgment.evidenceStatus}</dd></div>
                <div><dt>能力档位</dt><dd>{judgment.band ?? "—"}</dd></div>
                <div><dt>置信度</dt><dd>{Math.round(judgment.confidence * 100)}%</dd></div>
                <div><dt>证据引用</dt><dd>{judgment.evidenceRefs.length}</dd></div>
              </dl>
              <p className={judgment.score === null ? "blocked" : "ready"}>{judgment.rationale}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="v3-admin-decision-history">
        <header>
          <h2>独立质量判断运行收据</h2>
          <span>{value.qualityRuns.length} 次运行 · {value.reviewReceipts.length} 次教师终裁</span>
        </header>
        {value.qualityRuns.map((run, index) => (
          <article key={run.qualityRunRef}>
            <b>R{index + 1}</b>
            <div>
              <strong>
                {run.mode === "independent_live_agent" ? "独立 Live 智能体" : "确定性降级"}
              </strong>
              <p>
                {run.fallbackReason
                  ? `降级原因：${run.fallbackReason}`
                  : `${run.providerId} / ${run.modelId} · Trace ${run.traceRef}`}
              </p>
              <code>{run.inputHash.slice(0, 10)} → {run.outputHash.slice(0, 10)}</code>
            </div>
            <span>{run.latencyMs === null ? "0 μ成本" : `${run.latencyMs} ms`}</span>
          </article>
        ))}
      </section>

      <section className="v3-admin-decision-history">
        <header><h2>评价与教师差异链</h2><span>{value.decisionHistory.length} 个不可变决定</span></header>
        {value.decisionHistory.map((entry, index) => (
          <article key={entry.decision.assessmentDecisionId}>
            <b>V{index + 1}</b>
            <div>
              <strong>{entry.decision.status} · {entry.decision.sessionScore ?? "不出分"}</strong>
              <p>{entry.decision.teacherReview.rationale ?? "等待课程教师逐维终裁"}</p>
            </div>
            <span>{entry.decision.teacherReview.status}</span>
          </article>
        ))}
      </section>
    </>
  );
}

export function AdminEvidenceAssessmentNotReadySurfaceV4({
  message,
  operations = [],
  operationsError = null,
  unavailable = false,
}: {
  message: string;
  operationsError?: string | null;
  unavailable?: boolean;
  operations?: BusinessOperationReceipt[];
}) {
  return (
    <main className="v2-admin-page v4-admin-assessment-empty">
      <section className="v2-admin-empty">
        <ShieldCheck />
        <span>V4 抗取巧评价</span>
        <h1>{unavailable ? "评价读取失败，原业务收据仍可检查" : "尚无可审计的岗位证据案例"}</h1>
        <p>{message}</p>
        <small>系统不会用旧版结果、页面点击或漂亮文案冒充本轮评价。</small>
      </section>
      <AdminBusinessOperationTimeline operations={operations} error={operationsError} />
    </main>
  );
}

const operationKindLabels: Record<BusinessOperationReceipt["operationKind"], string> = {
  start_teaching_task: "创建独立委托场次",
  provision_second_session: "创建个性化第二场",
  submit_work_revision: "作品修订送审",
  finalize_assessment: "教师终裁",
};

const operationPhaseLabels: Record<BusinessOperationReceipt["phase"], string> = {
  requested: "请求已冻结",
  authority_committed: "权威事实已提交",
  projections_pending: "投影投递中",
  completed: "业务闭环完成",
  recovery_required: "需要恢复",
};

export function AdminBusinessOperationTimeline({
  operations,
  error = null,
}: {
  operations: BusinessOperationReceipt[];
  error?: string | null;
}) {
  const ordered = operations.toSorted((left, right) => (
    Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
  ));
  return (
    <section className="v4-admin-business-operations" aria-labelledby="admin-business-operations-title">
      <header>
        <div><DatabaseZap /><span><small>管理员独占 · 会话级</small><h2 id="admin-business-operations-title">权威提交与恢复时间线</h2></span></div>
        <b>{error ? "收据数量未知" : `${ordered.length} 项业务收据`}</b>
      </header>
      {error ? <div className="v2-inline-error" role="alert">恢复收据读取失败：{error}</div> : ordered.length === 0 ? (
        <div className="v4-admin-business-empty">
          <Activity />
          <span><strong>当前会话尚无跨存储业务收据</strong><small>作品送审、教师终裁或第二场创建发生后才会出现；不以模拟日志填充。</small></span>
        </div>
      ) : (
        <div className="v4-admin-business-list">
          {ordered.map((operation) => (
            <article key={operation.operationId} className={operation.phase}>
              <header>
                <span><small>{operationKindLabels[operation.operationKind]}</small><strong>{operationPhaseLabels[operation.phase]}</strong></span>
                <time dateTime={operation.updatedAt}>{new Date(operation.updatedAt).toLocaleString("zh-CN")}</time>
              </header>
              <code>{operation.operationId}</code>
              <div className="v4-admin-authority-state">
                <b>{operation.authorityCommitRef ? "权威提交已存在" : "尚未形成权威提交"}</b>
                <span>{operation.authorityCommitRef ?? "等待同一请求安全重试"}</span>
              </div>
              <ol aria-label={`${operationKindLabels[operation.operationKind]}投递步骤`}>
                {operation.outbox.map((item) => (
                  <li key={item.outboxId} className={item.status}>
                    <i aria-hidden="true" />
                    <span><strong>{item.step}</strong><small>{item.status === "delivered" ? `已投递 · ${item.attempts} 次尝试` : `待投递 · ${item.attempts} 次尝试`}</small></span>
                  </li>
                ))}
              </ol>
              {operation.recovery ? (
                <p className="v4-admin-recovery"><ShieldCheck />{operation.recovery.reasonCode} · 下一安全动作 {operation.recovery.nextSafeAction}</p>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export default function AdminEvidencePage({
  gateway,
  sessionId,
  bindingId,
}: {
  gateway: AdminGateway;
  sessionId: string;
  bindingId: string;
}) {
  const loader = useCallback((signal: AbortSignal) => loadAdminEvidence(gateway, sessionId, bindingId, signal), [bindingId, gateway, sessionId]);
  const { data, error } = useAdminResource(loader);
  if (data?.kind === "assessment_not_ready_v4" || data?.kind === "assessment_unavailable_v4") {
    return <AdminEvidenceAssessmentNotReadySurfaceV4 message={data.message} operations={data.operations} operationsError={data.operationsError} unavailable={data.kind === "assessment_unavailable_v4"} />;
  }
  if (data?.kind === "assessment_case_v4") {
    return (
      <main className="v2-admin-page v3-admin-assessment-page">
        {error ? <div className="v2-inline-error" role="alert">{error}</div> : null}
        <AdminBusinessOperationTimeline operations={data.operations} error={data.operationsError} />
        <AdminEvidenceAssessmentCaseSurfaceV4 value={data.value} />
        {data.adaptation ? (
          <AdminLearnerAdaptationCaseSurfaceV4 value={data.adaptation} />
        ) : null}
      </main>
    );
  }
  if (data?.kind === "assessment_case") {
    return (
      <main className="v2-admin-page v3-admin-assessment-page">
        {error ? <div className="v2-inline-error" role="alert">{error}</div> : null}
        <AdminAssessmentCaseSurface value={data.value} />
        {data.adaptation ? (
          <AdminLearnerAdaptationCaseSurface value={data.adaptation} />
        ) : null}
      </main>
    );
  }
  const evidence = data?.kind === "legacy" ? data.value : null;
  return (
    <main className="v2-admin-page">
      <header className="v2-admin-heading">
        <div>
          <h1>系统证据</h1>
          <p>从管理员最广投影读取真实过程证据；不合成“有效”或“已审核”状态。</p>
        </div>
        <span>{evidence?.length ?? 0} 条</span>
      </header>
      {error ? <div className="v2-inline-error" role="alert">{error}</div> : null}
      {!data && !error ? (
        <div className="v2-centered-state"><LoaderCircle className="spin" />正在读取系统证据</div>
      ) : null}
      {evidence?.length === 0 ? (
        <section className="v2-admin-empty">
          <h2>当前会话没有证据记录</h2>
          <p>只有权威投影实际形成证据后才会显示。</p>
        </section>
      ) : null}
      <section className="v2-admin-evidence-list">
        {evidence?.map((item) => (
          <article key={item.evidenceId}>
            <span className="observed">已记录</span>
            <div>
              <h2>{item.action}</h2>
              <p>{item.basis} · 节点 {item.nodeId}</p>
              <small>{new Date(item.createdAt).toLocaleString("zh-CN")}</small>
            </div>
            <code>{evidenceReferenceSummary(item)}</code>
          </article>
        ))}
      </section>
    </main>
  );
}
