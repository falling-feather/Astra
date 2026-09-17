import { useCallback } from "react";
import {
  BookOpen,
  Bot,
  CheckCircle2,
  Layers3,
  LoaderCircle,
  Network,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import type {
  GoldCompetitionEvidenceStatus,
  GoldCompetitionReadinessSnapshot,
} from "@ronggang/contracts";
import {
  buildAgentEvaluationView,
  type AgentAblationGateStatus,
  type AgentEvaluationView,
} from "../agent-ablation-models";
import type { AdminGateway } from "../admin-gateway";
import { useAdminResource } from "./use-admin-resource";

function statusLabel(status: GoldCompetitionEvidenceStatus): string {
  switch (status) {
    case "passed": return "通过";
    case "failed": return "未通过";
    case "insufficient": return "证据不足";
    case "unverified": return "待复核";
  }
}

function gateIcon(status: AgentAblationGateStatus) {
  if (status === "failed") return <XCircle aria-hidden="true" />;
  if (status === "passed") return <CheckCircle2 aria-hidden="true" />;
  return <ShieldAlert aria-hidden="true" />;
}

export interface AdminReadinessWorkspace {
  readiness: GoldCompetitionReadinessSnapshot;
  evaluation: AgentEvaluationView;
}

export async function loadAdminReadinessWorkspace(
  gateway: AdminGateway,
  sessionId: string,
  bindingId: string,
  signal?: AbortSignal,
): Promise<AdminReadinessWorkspace> {
  const [readiness, manifest, evidence] = await Promise.all([
    gateway.getReadiness(sessionId, bindingId, signal),
    gateway.getAgentRuleManifest(signal),
    gateway.getAgentAblationEvidence(signal),
  ]);
  return {
    readiness,
    evaluation: buildAgentEvaluationView(manifest, evidence),
  };
}

export function AgentEvaluationSurface({
  evaluation,
}: {
  evaluation: AgentEvaluationView;
}) {
  const { manifest, evidence } = evaluation;
  return (
    <div className="v2-agent-evaluation">
      <section className="v2-rule-manifest" aria-labelledby="v2-rule-manifest-title">
        <header className="v2-evaluation-section-heading">
          <div>
            <span>跨课程规则清单</span>
            <h2 id="v2-rule-manifest-title">五门课程共用一套受控智能体边界</h2>
            <p>每章只唤醒受事件影响的必要子集；未发布运行情境不会生成观察。</p>
          </div>
        </header>

        <div className="v2-rule-summary" aria-label="跨课程规则统计">
          <article>
            <BookOpen aria-hidden="true" />
            <strong>{manifest.courseCount}</strong>
            <span>门冻结课程</span>
          </article>
          <article>
            <Layers3 aria-hidden="true" />
            <strong>{manifest.chapterCount}</strong>
            <span>个章节规则</span>
          </article>
          <article>
            <Network aria-hidden="true" />
            <strong>{manifest.baselineAgentCount}</strong>
            <span>个基线智能体节点</span>
          </article>
          <article className="supporting">
            <Bot aria-hidden="true" />
            <strong>{manifest.supportingCapabilityIds.length}</strong>
            <span>项辅助能力引用</span>
          </article>
        </div>

        <div className="v2-rule-course-list">
          {manifest.courses.map((course) => (
            <article key={course.courseId} className={course.tone}>
              <div className="v2-rule-course-index" aria-hidden="true">
                {String(course.chapterCount).padStart(2, "0")}
              </div>
              <div>
                <header>
                  <h3>{course.title}</h3>
                  <span>{course.statusLabel}</span>
                </header>
                <p>{course.explanation}</p>
                <dl>
                  <div><dt>章节</dt><dd>{course.chapterCount}</dd></div>
                  <div><dt>候选引用</dt><dd>{course.candidateReferenceCount}</dd></div>
                  <div><dt>基线节点引用</dt><dd>{course.baselineReferenceCount}</dd></div>
                  <div><dt>辅助能力引用</dt><dd>{course.supportingCapabilityCount}</dd></div>
                </dl>
                <details className="v2-rule-guidance">
                  <summary>查看章节选择 / 跳过规则</summary>
                  <small>以下是冻结的调度条件说明，不代表本次运行已经选中或跳过任何智能体。</small>
                  <div>
                    {course.ruleGuidance.map((rule) => (
                      <section key={rule.chapterId}>
                        <b>第 {rule.order} 节</b>
                        <p><span>进入候选：</span>{rule.selectWhen}</p>
                        <p><span>跳过候选：</span>{rule.skipWhen}</p>
                      </section>
                    ))}
                  </div>
                </details>
              </div>
            </article>
          ))}
        </div>

        <aside className="v2-support-boundary">
          <Bot aria-hidden="true" />
          <div>
            <strong>辅助能力不计入十四节点基线</strong>
            <p>
              {manifest.supportingCapabilityIds.length > 0
                ? `当前登记 ${manifest.supportingCapabilityIds.length} 项课程辅助能力；它们单独解析、单独失败关闭。`
                : "当前规则没有已解析的额外辅助能力；后续即使登记，也不会改变十四节点基线计数。"}
            </p>
          </div>
        </aside>
      </section>

      <section className="v2-ablation-evidence" aria-labelledby="v2-ablation-title">
        <header className="v2-evaluation-section-heading">
          <div>
            <span>三组预登记消融</span>
            <h2 id="v2-ablation-title">过程与协作质量证据</h2>
            <p>当前公开展示 A / B / C 预登记条件；私有随机盲分配尚未建立，不宣称已经完成盲评。</p>
          </div>
          <div className="v2-ablation-count">
            <strong>{evidence.observationCount}</strong>
            <span>条真实观察</span>
          </div>
        </header>

        <div
          className={`v2-ablation-boundary ${evidence.insufficient ? "insufficient" : "reviewable"}`}
          role={evidence.insufficient ? "alert" : "status"}
        >
          <ShieldAlert aria-hidden="true" />
          <div>
            <strong>{evidence.warningTitle}</strong>
            <p>{evidence.warningDetail}</p>
            <small>运行状态：{evidence.runStatusLabel} · 当前结论：{evidence.conclusionLabel}</small>
          </div>
        </div>

        <div className="v2-ablation-groups" aria-label="消融预登记对照组">
          {evidence.groups.map((group) => (
            <article key={group.groupId}>
              <header>
                <span>{group.label}</span>
                <b>{group.runCount > 0 ? `${group.runCount} 次运行` : "等待真实运行"}</b>
              </header>
              <dl>
                <div><dt>有效运行</dt><dd>{group.runCount}</dd></div>
                <div><dt>保留失败</dt><dd>{group.failedRunCount}</dd></div>
                <div><dt>越权正式写入</dt><dd>{group.metrics.unauthorizedWriteCommitCount}</dd></div>
              </dl>
              <p>{group.runCount === 0 ? "零分母，比例、延迟与成本指标保持为空。" : "指标来自已冻结的真实运行观察。"}</p>
            </article>
          ))}
        </div>

        <div className="v2-ablation-gates">
          {evidence.gates.map((gate) => (
            <article key={gate.gateId} className={gate.status}>
              {gateIcon(gate.status)}
              <div>
                <header>
                  <h3>{gate.label}</h3>
                  <span>{gate.statusLabel}</span>
                </header>
                <p>{gate.actual}</p>
                <small>完成门：{gate.requirement}</small>
              </div>
            </article>
          ))}
        </div>

        <aside className="v2-evaluation-claim-boundary">
          <strong>结论边界</strong>
            <p>{evidence.claimBoundary}</p>
        </aside>
      </section>
    </div>
  );
}

export default function AdminReadinessPage({
  gateway,
  sessionId,
  bindingId,
}: {
  gateway: AdminGateway;
  sessionId: string;
  bindingId: string;
}) {
  const loader = useCallback(
    (signal: AbortSignal) => loadAdminReadinessWorkspace(
      gateway,
      sessionId,
      bindingId,
      signal,
    ),
    [bindingId, gateway, sessionId],
  );
  const { data, error } = useAdminResource(loader);
  return (
    <main className="v2-admin-page v2-readiness-page">
      <header className="v2-admin-heading">
        <div>
          <h1>交付状态与验证记录</h1>
          <p>分别查看可运行功能、提交材料与研究验证。真实用户反馈和专业复核按实际记录保留。</p>
        </div>
        <span>{data ? `工程证据与外部反馈分开核对` : "读取中"}</span>
      </header>
      {error ? (
        <div className="v2-inline-error" role="alert">
          管理员证据读取失败：{error}。当前页面已停止形成综合结论。
        </div>
      ) : null}
      {!data && !error ? (
        <div className="v2-centered-state"><LoaderCircle className="spin" />正在核对规则与证据</div>
      ) : null}
      {data ? (
        <>
          <section className="submission-readiness-summary"><h2>本机作品交付</h2><p>课程、场次与规则的发布状态可在下方核对。源代码封版、完整演示链路与真实用户反馈需要各自的验收记录。</p><p>高级盲评和大样本试点是额外研究目标，不自动作为本轮可运行Demo的完成门；项目记录的目标用户反馈要求仍须真实满足。</p></section>
          <details className="research-readiness-details"><summary>课程运行规则与高级研究验证</summary><AgentEvaluationSurface evaluation={data.evaluation} /></details>

          <section className="v2-competition-readiness" aria-labelledby="v2-competition-readiness-title">
            <header className="v2-evaluation-section-heading">
              <div>
                <span>证据与材料</span>
                <h2 id="v2-competition-readiness-title">提交材料与额外研究证据</h2>
                <p>工程验证不替代教师复核、真实师生反馈或赛事资格回执。</p>
              </div>
            </header>
            <div className="v2-readiness-boundary">
              <strong>{data.readiness.summary.readyForCompetitionClaim ? "当前证据满足这套完整研究门" : "部分外部反馈与研究证据尚未完成"}</strong>
              <details><summary>查看原始验证协议与结论边界</summary><p>{data.readiness.claimBoundary}</p></details>
            </div>
            <div className="v2-readiness-gates">
              {data.readiness.deliverables.map((gate) => (
                <article key={gate.deliverableId} className={gate.status}>
                  {gate.status === "passed" ? <CheckCircle2 /> : gate.status === "failed" ? <XCircle /> : <ShieldAlert />}
                  <div>
                    <h2>{gate.label}</h2>
                    <p>{gate.rationale}</p>
                    <small>下一步：{gate.nextAction}</small>
                  </div>
                  <span>{statusLabel(gate.status)}</span>
                </article>
              ))}
            </div>
          </section>
        </>
      ) : null}
    </main>
  );
}
