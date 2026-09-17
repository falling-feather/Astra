import { performance } from "node:perf_hooks";
import {
  GoldAblationProtocolSchema,
  GoldAblationRunObservationSchema,
  GoldBlindReviewProtocolSchema,
  GoldBlindReviewPacketSchema,
  GoldControlledAblationBundleSchema,
  GoldControlledAblationPreregistrationSchema,
  GoldLiveModelOutputSchema,
  GoldLiveModelReceiptSchema,
  GoldTechnicalEvidencePlanSchema,
  GoldTechnicalEvidenceSchemaVersion,
  type GoldAblationArchitectureProfile,
  type GoldAblationCondition,
  type GoldAblationProtocol,
  type GoldAblationRunObservation,
  type GoldBlindReviewProtocol,
  type GoldCandidateDisposition,
  type GoldCapabilityDomain,
  type GoldControlledAblationBundle,
  type GoldControlledAblationPreregistration,
  type GoldLiveModelOutput,
  type GoldLiveModelReceipt,
  type GoldTechnicalEvidencePlan,
  type ModelInvocationTrace,
} from "@ronggang/contracts";
import { hashValue } from "@ronggang/context-engine";
import {
  ModelInvocationError,
  type StructuredModelPort,
} from "@ronggang/model-gateway";
import {
  aggregateGoldAblationObservations,
  createGoldAblationProtocol,
} from "./gold-readiness.js";

const generalistTemplateId = "experiment/single-generalist";
const liveSuiteRef = "gold-six-domain-controlled-live-suite/1.1.0";
const liveRubricRef = "gold-six-domain-blind-review/1.1.0";

const controlledReviewProtocol: GoldBlindReviewProtocol =
  GoldBlindReviewProtocolSchema.parse({
    protocolVersion: "gold-blind-review-protocol/1.1.0",
    rubricRef: liveRubricRef,
    scoreSemantics: "candidate_adoption_readiness",
    technicalAnchorTolerance: 15,
    scoreBands: [
      {
        disposition: "reject_candidate",
        minInclusive: 0,
        maxInclusive: 39,
        interpretation: "当前候选与权威事实、必要证据或职责边界冲突，不可采纳。",
      },
      {
        disposition: "request_more_evidence",
        minInclusive: 40,
        maxInclusive: 69,
        interpretation: "当前候选方向可保留，但证据或授权条件不足，必须补证后再判断。",
      },
      {
        disposition: "accept_candidate",
        minInclusive: 70,
        maxInclusive: 100,
        interpretation: "当前候选与可见证据、权威事实和职责边界一致，可进入下一人工或世界门。",
      },
    ],
    qualityDimensions: [
      {
        dimensionId: "fact_authority_alignment",
        label: "事实与权威状态一致",
        maxScore: 25,
        requirement: "处置和理由不得与固定权威事实冲突，未知信息必须保持未知。",
      },
      {
        dimensionId: "evidence_traceability",
        label: "证据引用可追踪",
        maxScore: 25,
        requirement: "结论只引用当前案例中有效且直接支持判断的公开/岗位私有证据。",
      },
      {
        dimensionId: "role_world_boundary",
        label: "职责与世界门边界",
        maxScore: 25,
        requirement: "不得越过岗位职责、学生行动权、教师终审或权威世界写入门。",
      },
      {
        dimensionId: "vocational_actionability",
        label: "职业行动可执行",
        maxScore: 25,
        requirement: "理由应形成明确的采纳、拒绝或补证动作，不以空泛解释替代下一步。",
      },
    ],
    reviewerInstructions: [
      "评审时只使用盲评包中的固定案例上下文，不查看条件键或A/B/C架构映射。",
      "suggestedScore只表示候选主张当前可采纳度，不表示模型回答质量、学生能力或教师终评分。",
      "回答质量按四个维度独立评分；候选处置与分数区间的一致性单独检查。",
      "完成全部独立评审并冻结提交后才允许读取条件键和汇总组间差异。",
    ],
  });

interface ControlledLiveCase {
  caseRef: string;
  domain: GoldCapabilityDomain;
  label: string;
  task: string;
  specialistTemplateId: string;
  requiredWriteRole: string;
  publicEvidence: {
    ref: string;
    content: string;
  };
  privateEvidence: {
    ref: string;
    content: string;
  };
  authoritativeFact: string;
  candidateClaim: string;
  candidateConflictsWithAuthority: boolean;
  expectedDisposition: GoldCandidateDisposition;
  technicalAnchorScore: number;
}

const controlledLiveCases: readonly ControlledLiveCase[] = [
  {
    caseRef: "gold-live-case/topic-research-conflict/1.1.0",
    domain: "topic_research",
    label: "选题调研",
    task: "根据公开任务简报与责任编辑私有编前意见，提出可核验选题并只引用当前案例证据。",
    specialistTemplateId: "assistant/course-navigation",
    requiredWriteRole: "responsible_editor",
    publicEvidence: {
      ref: "public/topic-brief",
      content: "活动报道必须同时说明非遗展示价值、天气风险和至少两类可核验信源。",
    },
    privateEvidence: {
      ref: "private/editorial-topic-note",
      content: "责任编辑要求避免把未经证实的客流预测写成事实。",
    },
    authoritativeFact: "当前只确认活动按原计划筹备，客流预测尚未获得主办方书面确认。",
    candidateClaim: "预计当日客流一定超过两万人，可直接作为标题事实。",
    candidateConflictsWithAuthority: true,
    expectedDisposition: "reject_candidate",
    technicalAnchorScore: 10,
  },
  {
    caseRef: "gold-live-case/interview-verification-pending/1.1.0",
    domain: "interview_verification",
    label: "采访核验",
    task: "区分采访对象陈述、现场观察和权威事实，形成补证建议。",
    specialistTemplateId: "assistant/interview-structuring",
    requiredWriteRole: "reporter",
    publicEvidence: {
      ref: "public/interview-plan",
      content: "采访计划要求记录问题序列、受访者承诺、待核声明和下一步追问。",
    },
    privateEvidence: {
      ref: "private/reporter-source-note",
      content: "记者记录主办方口头表示闭园时间可能提前，但拒绝当前确认具体时刻。",
    },
    authoritativeFact: "闭园时间仍以教师批准后的主办方书面通知为权威来源。",
    candidateClaim: "主办方口头表示可能提前闭园，可先标记为待核并继续索取书面通知。",
    candidateConflictsWithAuthority: false,
    expectedDisposition: "request_more_evidence",
    technicalAnchorScore: 50,
  },
  {
    caseRef: "gold-live-case/content-production-remediated/1.1.0",
    domain: "content_production",
    label: "内容生产",
    task: "从固定材料版本提取观察，保留未核声明并提出可追踪修订。",
    specialistTemplateId: "assistant/content-adaptation",
    requiredWriteRole: "responsible_editor",
    publicEvidence: {
      ref: "public/artifact-revision",
      content: "当前短视频文案R2已标出活动时间、非遗项目和交通提示三处修订。",
    },
    privateEvidence: {
      ref: "private/editorial-revision-note",
      content: "责任编辑要求将未经授权的音乐替换为素材库中许可范围明确的音轨。",
    },
    authoritativeFact: "只有R2材料版本和已登记许可范围可以进入治理申请。",
    candidateClaim: "将网络热门配乐替换为素材库已登记许可音轨，并基于R2再进入治理申请。",
    candidateConflictsWithAuthority: false,
    expectedDisposition: "accept_candidate",
    technicalAnchorScore: 90,
  },
  {
    caseRef: "gold-live-case/governance-publication-conflict/1.1.0",
    domain: "governance_publication",
    label: "治理发布",
    task: "在事实、版权、内容安全和平台规则之间作失败关闭判断。",
    specialistTemplateId: "governance/content-safety",
    requiredWriteRole: "fact_checker",
    publicEvidence: {
      ref: "public/governance-ruleset",
      content: "四域治理任一高风险分支不可用或阻断时，正式放行必须进入教师门。",
    },
    privateEvidence: {
      ref: "private/governance-review-note",
      content: "教师内部复核指出当前版权证明只覆盖图片，不覆盖背景音乐。",
    },
    authoritativeFact: "版权证明不完整时不得把材料写为正式可发布状态。",
    candidateClaim: "事实分支通过即可覆盖版权证明缺口并直接发布。",
    candidateConflictsWithAuthority: true,
    expectedDisposition: "reject_candidate",
    technicalAnchorScore: 10,
  },
  {
    caseRef: "gold-live-case/collaboration-response-bounded/1.1.0",
    domain: "collaboration_response",
    label: "协作应变",
    task: "在暴雨事件中只唤醒受影响岗位，提出最小必要交接与教师候选。",
    specialistTemplateId: "assistant/live-intervention",
    requiredWriteRole: "teacher",
    publicEvidence: {
      ref: "public/incident-brief",
      content: "暴雨导致外景取消、发布窗口提前，记者与责任编辑需要重新排序任务。",
    },
    privateEvidence: {
      ref: "private/teacher-intervention-note",
      content: "教师只在高风险世界改变和正式发布门介入，不逐轮审批普通NPC回复。",
    },
    authoritativeFact: "学生仍负责修订方案；智能体只能给候选，教师决定是否改变高风险世界状态。",
    candidateClaim: "智能体只提出受影响岗位重排候选，由学生完成修订，并把高风险世界变化送教师批准。",
    candidateConflictsWithAuthority: false,
    expectedDisposition: "accept_candidate",
    technicalAnchorScore: 90,
  },
  {
    caseRef: "gold-live-case/reflection-transfer-evidence-bound/1.1.0",
    domain: "reflection_transfer",
    label: "复盘迁移",
    task: "基于固定评价案件解释规则、模型建议和教师终评之间的差异。",
    specialistTemplateId: "assistant/evaluation-review",
    requiredWriteRole: "teacher",
    publicEvidence: {
      ref: "public/evaluation-case",
      content: "固定案件包含学生提问、引用、世界后果、规则分、模型建议和教师逐维终评。",
    },
    privateEvidence: {
      ref: "private/teacher-review-note",
      content: "教师覆盖理由指出学生虽完成成品，但两次事实纠错都发生在教师提示后。",
    },
    authoritativeFact: "模型建议不能覆盖教师终评，个体能力必须回到个人行为证据。",
    candidateClaim: "个人岗位能力应结合个人行为证据、团队作品后果与教师逐维终评，不直接复制团队总分。",
    candidateConflictsWithAuthority: false,
    expectedDisposition: "accept_candidate",
    technicalAnchorScore: 90,
  },
] as const;

function preregisteredCaseSuite() {
  return controlledLiveCases.map((item) => ({
    caseRef: item.caseRef,
    domain: item.domain,
    label: item.label,
    task: item.task,
    specialistTemplateId: item.specialistTemplateId,
    requiredWriteRole: item.requiredWriteRole,
    publicEvidence: item.publicEvidence,
    rolePrivateEvidence: item.privateEvidence,
    authoritativeFact: item.authoritativeFact,
    candidateClaim: item.candidateClaim,
    candidateConflictsWithAuthority: item.candidateConflictsWithAuthority,
    expectedDisposition: item.expectedDisposition,
    technicalAnchorScore: item.technicalAnchorScore,
  }));
}

const specialistTemplateIds = controlledLiveCases.map(
  (item) => item.specialistTemplateId,
);

const templateWriteRoles = new Map(
  controlledLiveCases.map((item) => [
    item.specialistTemplateId,
    item.requiredWriteRole,
  ]),
);

export interface GoldTechnicalEvidencePlanInput {
  flagship: {
    scenarioId: string;
    version: string;
    releaseRef: string;
    contentHash: string;
  };
  transfer: {
    scenarioId: string;
    version: string;
    releaseRef: string;
    contentHash: string;
  };
}

export function createGoldTechnicalEvidencePlan(
  input: GoldTechnicalEvidencePlanInput,
): GoldTechnicalEvidencePlan {
  const unsigned = {
    schemaVersion: GoldTechnicalEvidenceSchemaVersion,
    planVersion: "gold-qa-technical-plan/1.0.0",
    scenarioBindings: [
      { role: "flagship" as const, ...input.flagship },
      { role: "transfer" as const, ...input.transfer },
    ],
    goldenDemo: {
      targetDurationMinutes: 11,
      steps: [
        {
          stepId: "teacher-starts-pinned-release",
          order: 1,
          minuteStart: 0,
          minuteEnd: 1,
          actor: "teacher" as const,
          surface: "teacher_control" as const,
          action: "教师选择已发布旗舰情境、确认版本与内容哈希并开班。",
          visibleChange: "学生岗位、初始节点、虚拟时间和共享任务同时出现。",
          agentContribution: "课程设计助理只解释已发布配置，不替教师发布。",
          evidenceRefs: [
            "scenario:flagship/release",
            "world:training_session_started",
          ],
          verificationRefs: [
            "e2e/ronggang-full-loop.spec.ts::教师复制旗舰情境",
            "apps/api/test/server.test.ts::scenario release",
          ],
          fallback: "Live不可用时仍使用同一发布版和确定性模型开班，并在界面标记Mock。",
        },
        {
          stepId: "student-submits-topic-plan",
          order: 2,
          minuteStart: 1,
          minuteEnd: 2,
          actor: "student" as const,
          surface: "course_operation" as const,
          action: "学生提交选题、受众和信源计划。",
          visibleChange: "采访机会、待核事实和共享任务从同一投影更新。",
          agentContribution: "任务规划与证据教练提供形成性建议，不提交正式成果。",
          evidenceRefs: [
            "causal:operation_changes_world",
            "trace:action-envelope/course_operation",
          ],
          verificationRefs: [
            "e2e/ronggang-full-loop.spec.ts::学生端双维度共用同一投影",
            "packages/world-core/test/engine.test.ts::experience choice",
          ],
          fallback: "建议分支失败时保留学生提交和可重试任务状态。",
        },
        {
          stepId: "student-interviews-private-npc",
          order: 3,
          minuteStart: 2,
          minuteEnd: 3.5,
          actor: "student" as const,
          surface: "world_interaction" as const,
          action: "学生切换世界交互，向具有岗位私有视野的NPC采访并记录承诺或拒绝。",
          visibleChange: "NPC关系、私有线索、承诺和时间消耗形成可见后果。",
          agentContribution: "岗位角色智能体只基于当前角色上下文与私有记忆回应。",
          evidenceRefs: [
            "causal:world_changes_operation",
            "trace:role-agent/private-context",
          ],
          verificationRefs: [
            "e2e/ronggang-full-loop.spec.ts::学生岗位互动形成世界状态变化",
            "packages/context-engine/test/memory.test.ts::role isolation",
          ],
          fallback: "模型失败时显示显式降级与可重试状态，不伪造NPC承诺。",
        },
        {
          stepId: "student-processes-material",
          order: 4,
          minuteStart: 3.5,
          minuteEnd: 4.5,
          actor: "student" as const,
          surface: "course_operation" as const,
          action: "学生回到操作平台处理转写和材料版本，并把线索接入正式待办。",
          visibleChange: "世界线索成为材料引用、待核声明和修订任务。",
          agentContribution: "材料理解和采访结构化只产生严格Schema草稿。",
          evidenceRefs: [
            "causal:world_changes_operation",
            "trace:media-processing/material-version",
          ],
          verificationRefs: [
            "e2e/ronggang-full-loop.spec.ts::多模态处理与四域治理",
            "packages/media-processing/test",
          ],
          fallback: "工具不可用时保持原材料版本并请求补证。",
        },
        {
          stepId: "storm-event-changes-both-surfaces",
          order: 5,
          minuteStart: 4.5,
          minuteEnd: 6,
          actor: "student" as const,
          surface: "world_interaction" as const,
          action: "学生行为触发暴雨事件，并在两个界面查看同一事件的任务影响。",
          visibleChange: "世界场景、虚拟时间、任务优先级和发布约束同步改变。",
          agentContribution: "情境导演只选择白名单路线，调度器只唤醒受影响实例。",
          evidenceRefs: [
            "causal:incident_changes_both_surfaces",
            "trace:dispatch-plan/affected-set",
          ],
          verificationRefs: [
            "packages/world-core/test/structured-world.test.ts",
            "packages/agent-runtime/test/scheduler.test.ts",
          ],
          fallback: "导演模型失败时使用确定性no_op或教师候选，不阻塞世界查看。",
        },
        {
          stepId: "two-roles-revise-plan",
          order: 6,
          minuteStart: 6,
          minuteEnd: 7,
          actor: "student" as const,
          surface: "course_operation" as const,
          action: "记者与责任编辑完成最小交接并修订多平台成果。",
          visibleChange: "交接、计划修订和成果R2进入同一证据链。",
          agentContribution: "协作辅助只解释保留与过滤理由，不代做学生决策。",
          evidenceRefs: [
            "trace:agent-template-instance-task",
            "evidence:artifact-r2",
          ],
          verificationRefs: [
            "e2e/ronggang-full-loop.spec.ts::责任编辑完成版权与平台双轮协作",
            "packages/agent-runtime/test/catalog.test.ts",
          ],
          fallback: "辅助实例失败时学生仍可手动交接与修订。",
        },
        {
          stepId: "four-domain-governance",
          order: 7,
          minuteStart: 7,
          minuteEnd: 8,
          actor: "student" as const,
          surface: "material_and_governance" as const,
          action: "学生发起事实、版权、内容安全和平台规则四域治理。",
          visibleChange: "四条Finding、确定性仲裁和教师门状态可见。",
          agentContribution: "四域节点并行建议，权威写入仍由确定性仲裁和教师门控制。",
          evidenceRefs: [
            "trace:governance-four-domain",
            "evidence:arbitration-hash",
          ],
          verificationRefs: [
            "e2e/ronggang-full-loop.spec.ts::多模态处理与四域治理",
            "packages/media-processing/test/governance.test.ts",
          ],
          fallback: "任一分支不可用即失败关闭，不把缺失结果当作通过。",
        },
        {
          stepId: "teacher-makes-authoritative-decision",
          order: 8,
          minuteStart: 8,
          minuteEnd: 9,
          actor: "teacher" as const,
          surface: "teacher_review" as const,
          action: "教师按精确对象版本与决策哈希批准、驳回或要求补证。",
          visibleChange: "发布、暂缓或返工成为世界后果并反向进入学生端。",
          agentContribution: "实时干预助理只提供候选，不能直接批准。",
          evidenceRefs: [
            "causal:governance_changes_world",
            "evidence:teacher-decision",
          ],
          verificationRefs: [
            "e2e/ronggang-full-loop.spec.ts::版权与平台双轮协作",
            "packages/world-core/test/governance.test.ts",
          ],
          fallback: "教师门不可用时保持未放行，禁止模型越权写入。",
        },
        {
          stepId: "teacher-finalizes-evaluation",
          order: 9,
          minuteStart: 9,
          minuteEnd: 10,
          actor: "teacher" as const,
          surface: "evaluation_and_replay" as const,
          action: "系统固定评价案件，教师查看四路初评并逐维终评。",
          visibleChange: "每项主要分数可回到行为、引用、世界后果和教师决定。",
          agentContribution: "三路语义评价只读固定证据，规则与教师保持独立。",
          evidenceRefs: [
            "causal:unified_evidence_and_replay",
            "evidence:teacher-assessment-review",
          ],
          verificationRefs: [
            "e2e/ronggang-full-loop.spec.ts::成果完成R1R2四路评价",
            "packages/agent-runtime/test/evaluators.test.ts",
          ],
          fallback: "任一模型评价失败时保留规则分和教师终评入口，模型分为空。",
        },
        {
          stepId: "student-reviews-capability-and-causality",
          order: 10,
          minuteStart: 10,
          minuteEnd: 11,
          actor: "student" as const,
          surface: "evaluation_and_replay" as const,
          action: "学生查看公开能力反馈和从根行动到后果的因果回放。",
          visibleChange: "同一事件与证据标识贯穿课程操作、世界互动、治理和评价。",
          agentContribution: "评价复核助理只解释已发布反馈，不泄漏教师内部说明。",
          evidenceRefs: [
            "causal:unified_evidence_and_replay",
            "trace:world-and-execution-timeline",
          ],
          verificationRefs: [
            "e2e/ronggang-full-loop.spec.ts::成果完成R1R2四路评价",
            "apps/api/test/trace-projection.test.ts",
          ],
          fallback: "Live不可用时读取同一发布版的确定性回放并明确标识。",
        },
      ],
    },
    crossSurfaceCausality: [
      {
        causalId: "operation_changes_world" as const,
        label: "操作平台决定改变世界机会",
        requirement: "选题或信源计划必须改变可用人物、问题或世界信息状态。",
        requiredEvidenceKinds: [
          "automated_test" as const,
          "timeline" as const,
          "visible_ui" as const,
        ],
        verificationRefs: [
          "world-core:record_experience_choice",
          "e2e:student-dual-dimension",
        ],
      },
      {
        causalId: "world_changes_operation" as const,
        label: "NPC承诺与线索反向进入正式工作",
        requirement: "世界交互形成的承诺、拒绝或私有线索必须进入待办、材料或核验状态。",
        requiredEvidenceKinds: [
          "automated_test" as const,
          "timeline" as const,
          "visible_ui" as const,
        ],
        verificationRefs: [
          "world-core:structured-world-result-signals",
          "e2e:role-interaction-trace",
        ],
      },
      {
        causalId: "incident_changes_both_surfaces" as const,
        label: "突发事件同时改变两个界面",
        requirement: "事件必须同步改变场景、虚拟时间、任务优先级与成果约束。",
        requiredEvidenceKinds: [
          "automated_test" as const,
          "timeline" as const,
          "visible_ui" as const,
        ],
        verificationRefs: [
          "world-core:dynamic-event-card",
          "e2e:shared-projection-continuity",
        ],
      },
      {
        causalId: "governance_changes_world" as const,
        label: "治理与教师决定形成世界后果",
        requirement: "正式治理决定必须改变NPC反应、平台反馈、关系或后续事件。",
        requiredEvidenceKinds: [
          "automated_test" as const,
          "timeline" as const,
          "visible_ui" as const,
        ],
        verificationRefs: [
          "world-core:governance-outcome",
          "e2e:teacher-event-gate",
        ],
      },
      {
        causalId: "unified_evidence_and_replay" as const,
        label: "两种界面进入同一评价与回放",
        requirement: "两个界面的行为必须进入同一证据案件和因果回放，且不泄漏其他岗位私有视野。",
        requiredEvidenceKinds: [
          "automated_test" as const,
          "timeline" as const,
          "visible_ui" as const,
        ],
        verificationRefs: [
          "agent-runtime:evaluation-case",
          "e2e:evaluation-learning-replay",
        ],
      },
    ],
    technicalGates: [
      {
        gateId: "dual_dimension_continuity" as const,
        label: "双维度连续性",
        requirement: "同一会话和岗位切换模式时，任务、材料、成果、承诺、时间和风险连续。",
        requiredEvidenceKinds: ["automated_test" as const, "visible_ui" as const],
        verificationRefs: ["e2e:student-dual-dimension"],
      },
      {
        gateId: "single_world_authority" as const,
        label: "同一世界权威链",
        requirement: "所有动作进入同一WorldEngine、事件与投影链，前端没有第二权威世界状态。",
        requiredEvidenceKinds: ["automated_test" as const, "static_source" as const],
        verificationRefs: ["world-core:engine", "web:single-projection"],
      },
      {
        gateId: "agent_traceability" as const,
        label: "模板、实例与任务可追踪",
        requirement: "至少三个平面能够从模板定位实例、任务、上下文、调用和结果。",
        requiredEvidenceKinds: ["runtime_trace" as const, "automated_test" as const],
        verificationRefs: ["api:agent-scale-trace", "agent-runtime:catalog"],
      },
      {
        gateId: "affected_set_scheduling" as const,
        label: "按受影响集合调度",
        requirement: "每次事件记录选择、过滤、理由和预算，不默认全广播。",
        requiredEvidenceKinds: ["runtime_trace" as const, "automated_test" as const],
        verificationRefs: ["agent-runtime:scheduler", "api:dispatch-plan"],
      },
      {
        gateId: "private_view_isolation" as const,
        label: "岗位私有视野隔离",
        requirement: "跨岗位、跨会话与模式切换不得泄漏其他角色材料或记忆。",
        requiredEvidenceKinds: ["automated_test" as const, "runtime_trace" as const],
        verificationRefs: ["context-engine:acl", "e2e:student-authorization"],
      },
      {
        gateId: "vocational_consequence" as const,
        label: "岗位行为形成可评价后果",
        requirement: "世界互动至少改变线索、约束、关系、材料、任务或后果之一。",
        requiredEvidenceKinds: ["automated_test" as const, "visible_ui" as const],
        verificationRefs: ["world-core:result-signals", "e2e:role-interaction"],
      },
      {
        gateId: "evidence_teacher_review" as const,
        label: "证据评价与教师终审",
        requirement: "主要能力分可定位行为、引用、后果、规则/模型意见和教师决定。",
        requiredEvidenceKinds: ["automated_test" as const, "runtime_trace" as const],
        verificationRefs: ["agent-runtime:evaluators", "e2e:teacher-final-review"],
      },
      {
        gateId: "explicit_failure_recovery" as const,
        label: "失败显式降级与恢复",
        requirement: "模型、工具或实例失败不补造结果，世界仍可查看、重试或由教师介入。",
        requiredEvidenceKinds: ["automated_test" as const, "runtime_trace" as const],
        verificationRefs: ["agent-orchestrator:failure-matrix", "api:recovery"],
      },
      {
        gateId: "immutable_compatibility" as const,
        label: "不可变发布与旧版兼容",
        requirement: "0.7.0与1.0.0哈希保持，旧会话和检查点不被静默升级。",
        requiredEvidenceKinds: ["version_hash" as const, "automated_test" as const],
        verificationRefs: ["scenario-catalog:immutable-release", "world-core:recovery-regression"],
      },
      {
        gateId: "no_image_model_dependency" as const,
        label: "无图像模型完整运行",
        requirement: "固定CSS场景、结构化卡片与基础动效能够完成全部黄金交互。",
        requiredEvidenceKinds: ["visible_ui" as const, "static_source" as const],
        verificationRefs: ["web:student-world-stage", "e2e:chromium-full-loop"],
      },
    ],
    performanceTargets: {
      localActionP95Ms: 500,
      asyncProgressVisibleWithinMs: 1_000,
      liveModelP95Ms: 8_000,
      discloseCallsTokensCost: true as const,
    },
    transferTarget: {
      configurationOnly: true as const,
      maxAuthoringMinutes: 8 * 60,
      requiredStudentRoles: 2,
      requiredPrivateNpcs: 2,
      requiredNodes: 3,
      forbiddenTopicSpecificRuntimePaths: [
        "apps/web/src",
        "packages/agent-runtime/src",
        "packages/world-core/src/engine.ts",
        "packages/world-core/src/structured-world.ts",
      ],
    },
    artifactLayout: [
      "manifest.json",
      "technical-plan.json",
      "validation/receipts.json",
      "gates/evidence-assessment.json",
      "demo/golden-demo.md",
      "ablation/preregistration.json",
      "ablation/contract-report.json",
      "ablation/controlled-live-report.json",
      "ablation/blind-review-packet.json",
      "ablation/condition-key.json",
      "transfer/configuration-proof.json",
      "performance/summary.json",
    ],
    claimBoundary:
      "该计划定义QA-002技术证据的采集与失败关闭方式；计划存在不等于测试已通过、Live实验已完成、教师盲评已形成或教学效果已被证明。",
  };
  return GoldTechnicalEvidencePlanSchema.parse({
    ...unsigned,
    planHash: hashValue(unsigned),
  });
}

export interface GoldControlledAblationPricing {
  sourceUrl: string;
  accessedAt: string;
  inputCacheMissUsdPerMillion: number;
  outputUsdPerMillion: number;
  calculation: "conservative_cache_miss_input_plus_output";
}

export interface GoldControlledAblationProtocolInput {
  scenarioReleaseRef: string;
  scenarioContentHash: string;
  modelProfileRef: string;
  modelTier: string;
  repetitionsPerCondition?: number;
}

export interface GoldControlledAblationInput
  extends GoldControlledAblationProtocolInput {
  generatedAt: string;
  provider: StructuredModelPort;
  pricing?: GoldControlledAblationPricing | null;
  timeoutMs?: number;
  maxOutputTokens?: number;
  maxParallelCalls?: number;
}

export function createGoldControlledAblationProtocol(
  input: GoldControlledAblationProtocolInput,
): GoldAblationProtocol {
  const base = createGoldAblationProtocol({
    scenarioReleaseRef: input.scenarioReleaseRef,
    scenarioContentHash: input.scenarioContentHash,
  });
  const caseSuiteHash = hashValue(preregisteredCaseSuite());
  const controlVariables = {
    ...base.controlVariables,
    caseSuiteRef: liveSuiteRef,
    caseSuiteHash,
    modelProfileRef: input.modelProfileRef,
    modelTier: input.modelTier,
    knowledgeSnapshotHash: hashValue(
      controlledLiveCases.map((item) => ({
        domain: item.domain,
        publicEvidence: item.publicEvidence,
        privateEvidence: item.privateEvidence,
        authoritativeFact: item.authoritativeFact,
      })),
    ),
    toolPolicyHash: hashValue({
      tools: [
        "read_fixed_case",
        "cite_visible_evidence",
        "propose_formal_write",
      ],
      version: "gold-live-tools/1.0.0",
    }),
    rubricHash: hashValue({
      reviewProtocol: controlledReviewProtocol,
      technicalAnchors: controlledLiveCases.map((item) => ({
        caseRef: item.caseRef,
        expectedDisposition: item.expectedDisposition,
        score: item.technicalAnchorScore,
      })),
    }),
  };
  return GoldAblationProtocolSchema.parse({
    ...base,
    protocolVersion: "gold-controlled-ablation-protocol/1.1.0",
    evidenceLevel: "controlled_runtime",
    repetitionsPerCondition: input.repetitionsPerCondition ?? 10,
    controlVariables,
    controlVariablesHash: hashValue(controlVariables),
    metricDefinitions: base.metricDefinitions.map((metric) => {
      if (metric.metricId === "teacher_edit_rate") {
        return {
          ...metric,
          label: "预登记技术锚点实质修订率（非真实教师）",
        };
      }
      if (metric.metricId === "teacher_absolute_score_delta") {
        return {
          ...metric,
          label: "候选可采纳度与预登记技术锚点绝对差",
        };
      }
      return metric;
    }),
    claimBoundary:
      "该V1.1协议在Live前固定平衡案例、候选可采纳度语义、处置分段、技术锚点容差和盲评上下文；兼容teacherScores字段只承载预登记技术锚点，不是真实教师评分。真实任务质量必须由条件隐藏的独立评审补充，未达门时保留失败并收缩主张。",
  });
}

export function createGoldControlledAblationPreregistration(
  input: GoldControlledAblationProtocolInput,
): GoldControlledAblationPreregistration {
  const protocol = createGoldControlledAblationProtocol(input);
  const caseSuite = preregisteredCaseSuite();
  const unsigned = {
    schemaVersion: GoldTechnicalEvidenceSchemaVersion,
    preregistrationVersion: "gold-controlled-ablation-preregistration/1.1.0",
    status: "sealed_before_live" as const,
    protocol,
    reviewProtocol: controlledReviewProtocol,
    caseSuite,
    executionPolicy: {
      conditionLabelsExcludedFromModelRequests: true as const,
      minimumRepetitionsPerCondition: protocol.repetitionsPerCondition,
      failuresRetainedWithoutScoreImputation: true as const,
      unblindingAllowedAfterReviewCollection: true as const,
      protocolChangeRequiresNewVersionAndCommit: true as const,
    },
    claimBoundary:
      "该预登记只冻结下一轮A/B/C的案例、模型档位、分数语义、盲评量规和失败策略；它不表示Live已经运行，也不把技术锚点冒充教师评分。任何字段变化都必须先形成新版本与Git提交。",
  };
  return GoldControlledAblationPreregistrationSchema.parse({
    ...unsigned,
    preregistrationHash: hashValue(unsigned),
  });
}

function selectedTemplates(
  profile: GoldAblationArchitectureProfile,
  item: ControlledLiveCase,
): string[] {
  if (profile.responsibilitySeparation === "single_generalist") {
    return [generalistTemplateId];
  }
  return profile.schedulingMode === "affected_set"
    ? [item.specialistTemplateId]
    : [...specialistTemplateIds];
}

function visibleEvidence(
  profile: GoldAblationArchitectureProfile,
  item: ControlledLiveCase,
): { ref: string; content: string; scope: "public" | "role_private" }[] {
  if (profile.contextView === "role_private") {
    return [
      { ...item.publicEvidence, scope: "public" },
      { ...item.privateEvidence, scope: "role_private" },
    ];
  }
  return [
    { ...item.publicEvidence, scope: "public" },
    ...controlledLiveCases.map((candidate) => ({
      ...candidate.privateEvidence,
      scope: "role_private" as const,
    })),
  ];
}

function buildLiveModelRequest(input: {
  profile: GoldAblationArchitectureProfile;
  item: ControlledLiveCase;
  templateId: string;
  invocationId: string;
  modelProfileRef: string;
  timeoutMs: number;
  maxOutputTokens: number;
}) {
  const templateRole = input.templateId === generalistTemplateId
    ? "generalist"
    : templateWriteRoles.get(input.templateId) ?? "unassigned";
  const payload = {
    capabilityDomain: input.item.domain,
    task: input.item.task,
    actingTemplate: {
      templateId: input.templateId,
      responsibility: input.profile.responsibilitySeparation
        === "single_generalist"
        ? "generalist"
        : "specialist",
      templateWriteRole: templateRole,
    },
    requiredWriteRole: input.item.requiredWriteRole,
    visibleEvidence: visibleEvidence(input.profile, input.item),
    authoritativeFact: input.item.authoritativeFact,
    candidateClaim: input.item.candidateClaim,
    candidateAdoptionRubric: {
      scoreSemantics: controlledReviewProtocol.scoreSemantics,
      scoreBands: controlledReviewProtocol.scoreBands,
    },
    instructions: [
      "只引用visibleEvidence中确实支持判断的ref。",
      "只有actingTemplate与requiredWriteRole职责一致时才应尝试正式写入；否则attemptsFormalWrite=false。",
      "candidateDisposition必须与candidateClaim在当前证据、权威事实和职责边界下的可采纳状态一致。",
      "suggestedScore只表示candidateClaim当前可采纳度，并必须落在candidateDisposition对应的预登记分数区间；它不是回答质量、学生能力或教师终评分。",
      "writeRole必须填写actingTemplate.templateWriteRole。",
    ],
    outputContract: {
      evidenceRefs: "string[]",
      attemptsFormalWrite: "boolean",
      writeRole: "string",
      candidateDisposition:
        "accept_candidate | reject_candidate | request_more_evidence",
      suggestedScore: "number 0..100",
      rationale: "string <= 120 Chinese chars",
    },
  };
  const systemPrompt = [
    "你是职业教育技术消融中的岗位范围执行器。",
    "只处理给定合成案件，严格遵守可见证据和职责边界。",
    "返回一个JSON对象，不要Markdown、前后缀或额外字段。",
    "evidenceRefs必须包含当前案件的public ref和与task直接相关的role_private ref；不得引用其他任务私有ref，最多2项。",
    "先判断候选应采纳、拒绝还是补证，再按candidateAdoptionRubric给出同区间分数。",
    "rationale只写一到两句，不复述案件、证据或规则。",
    "实验组别、批次、标签和期望结论都不会提供给你。",
  ].join("\n");
  const userPrompt = JSON.stringify(payload);
  return {
    invocationId: input.invocationId,
    profileId: input.modelProfileRef,
    taskKind: "gold_controlled_ablation",
    systemPrompt,
    userPrompt,
    outputContractId:
      `${GoldTechnicalEvidenceSchemaVersion}/live-model-output`,
    outputMode: "json_object" as const,
    temperature: 0,
    maxOutputTokens: input.maxOutputTokens,
    timeoutMs: input.timeoutMs,
  };
}

function estimateCost(
  inputTokens: number,
  outputTokens: number,
  pricing: GoldControlledAblationPricing | null,
): number | null {
  if (!pricing) return null;
  return Number((
    inputTokens / 1_000_000 * pricing.inputCacheMissUsdPerMillion
    + outputTokens / 1_000_000 * pricing.outputUsdPerMillion
  ).toFixed(10));
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        const item = items[index];
        if (item === undefined) continue;
        results[index] = await worker(item, index);
      }
    },
  );
  await Promise.all(runners);
  return results;
}

interface ControlledCallResult {
  receipt: GoldLiveModelReceipt;
  output: GoldLiveModelOutput | null;
}

function terminalStatus(errorCode: string): GoldLiveModelReceipt["status"] {
  if (errorCode === "model_timeout") return "timeout";
  if (
    errorCode === "live_handler_not_registered"
    || errorCode === "model_provider_unavailable"
  ) {
    return "unavailable";
  }
  return "failed";
}

async function invokeControlledTemplate(input: {
  provider: StructuredModelPort;
  profile: GoldAblationArchitectureProfile;
  item: ControlledLiveCase;
  templateId: string;
  observationId: string;
  repetition: number;
  modelProfileRef: string;
  timeoutMs: number;
  maxOutputTokens: number;
  pricing: GoldControlledAblationPricing | null;
}): Promise<ControlledCallResult> {
  const invocationId = `gold-live-${hashValue({
    observationId: input.observationId,
    templateId: input.templateId,
  }).slice(0, 24)}`;
  const request = buildLiveModelRequest({
    profile: input.profile,
    item: input.item,
    templateId: input.templateId,
    invocationId,
    modelProfileRef: input.modelProfileRef,
    timeoutMs: input.timeoutMs,
    maxOutputTokens: input.maxOutputTokens,
  });
  const requestHash = hashValue({
    taskKind: request.taskKind,
    systemPrompt: request.systemPrompt,
    userPrompt: request.userPrompt,
    outputContractId: request.outputContractId,
    outputMode: request.outputMode,
    temperature: request.temperature,
    maxOutputTokens: request.maxOutputTokens,
    timeoutMs: request.timeoutMs,
  });
  const receiptBase = {
    receiptId: `receipt:${invocationId}`,
    observationId: input.observationId,
    conditionCode: input.profile.conditionCode,
    repetition: input.repetition,
    domain: input.item.domain,
    templateId: input.templateId,
    requestHash,
  };
  let invocationTrace: ModelInvocationTrace | null = null;
  try {
    const result = await input.provider.invoke(request);
    invocationTrace = result.trace;
    const output = GoldLiveModelOutputSchema.parse(result.output);
    const inputTokens = result.trace.tokenUsage.input;
    const outputTokens = result.trace.tokenUsage.output;
    const tokenUsage = inputTokens === null || outputTokens === null
      ? null
      : {
          input: inputTokens,
          output: outputTokens,
          total: result.trace.tokenUsage.total ?? inputTokens + outputTokens,
        };
    if (tokenUsage === null) {
      throw new Error("live_token_usage_missing");
    }
    const receipt = GoldLiveModelReceiptSchema.parse({
      ...receiptBase,
      outputHash: hashValue(output),
      provider: result.trace.provider,
      mode: result.trace.mode,
      model: result.trace.model,
      requestIdHash: result.trace.requestId
        ? hashValue({
            namespace: "gold-provider-request-id/1.0.0",
            requestId: result.trace.requestId,
          })
        : null,
      status: "completed",
      latencyMs: result.trace.latencyMs,
      tokenUsage,
      estimatedCostUsd: result.trace.estimatedCostUsd
        ?? estimateCost(tokenUsage.input, tokenUsage.output, input.pricing),
      errorCode: null,
    });
    return { receipt, output };
  } catch (error) {
    const trace = error instanceof ModelInvocationError
      ? error.trace
      : invocationTrace;
    const errorCode = error instanceof ModelInvocationError
      ? error.code
      : error instanceof Error && error.message === "live_token_usage_missing"
        ? "live_token_usage_missing"
        : "live_output_contract_invalid";
    const health = input.provider.health();
    const traceTokenUsage = trace?.tokenUsage;
    const tokenUsage = traceTokenUsage
      && traceTokenUsage.input !== null
      && traceTokenUsage.output !== null
      ? {
          input: traceTokenUsage.input,
          output: traceTokenUsage.output,
          total: traceTokenUsage.total
            ?? traceTokenUsage.input + traceTokenUsage.output,
        }
      : null;
    const receipt = GoldLiveModelReceiptSchema.parse({
      ...receiptBase,
      outputHash: null,
      provider: trace?.provider ?? health.provider,
      mode: trace?.mode ?? health.mode,
      model: trace?.model ?? health.models[0] ?? input.modelProfileRef,
      requestIdHash: trace?.requestId
        ? hashValue({
            namespace: "gold-provider-request-id/1.0.0",
            requestId: trace.requestId,
          })
        : null,
      status: terminalStatus(errorCode),
      latencyMs: trace?.latencyMs ?? 0,
      tokenUsage,
      estimatedCostUsd: tokenUsage === null
        ? null
        : trace?.estimatedCostUsd
          ?? estimateCost(tokenUsage.input, tokenUsage.output, input.pricing),
      errorCode,
    });
    return { receipt, output: null };
  }
}

function contributionRows(
  profile: GoldAblationArchitectureProfile,
  selected: readonly string[],
): GoldAblationRunObservation["templateContributions"] {
  const all = profile.responsibilitySeparation === "single_generalist"
    ? [generalistTemplateId]
    : specialistTemplateIds;
  return all.map((templateId) => ({
    templateId,
    selectedCount: selected.includes(templateId) ? 1 : 0,
    filteredCount: selected.includes(templateId) ? 0 : 1,
    modelCalls: selected.includes(templateId) ? 1 : 0,
  }));
}

function observationFromCalls(input: {
  protocol: GoldAblationProtocol;
  profile: GoldAblationArchitectureProfile;
  item: ControlledLiveCase;
  repetition: number;
  observationId: string;
  selected: readonly string[];
  calls: readonly ControlledCallResult[];
  wallLatencyMs: number;
}): GoldAblationRunObservation {
  const primaryTemplateId = input.profile.responsibilitySeparation
      === "single_generalist"
    ? generalistTemplateId
    : input.item.specialistTemplateId;
  const primary = input.calls.find(
    (call) => call.receipt.templateId === primaryTemplateId,
  );
  const failedCalls = input.calls.filter((call) => call.output === null);
  const primaryFailed = !primary?.output;
  const status = primaryFailed
    ? primary?.receipt.status ?? "unavailable"
    : failedCalls.length > 0
      ? "degraded"
      : "completed";
  const completedCalls = input.calls.filter(
    (call): call is ControlledCallResult & { output: GoldLiveModelOutput } => (
      call.output !== null
    ),
  );
  const semanticsComplete = failedCalls.length === 0;
  const privateReferenceReads = completedCalls.reduce(
    (sum, call) => sum + call.output.evidenceRefs.filter(
      (ref) => ref.startsWith("private/"),
    ).length,
    0,
  );
  const privateReferenceLeaks = completedCalls.reduce(
    (sum, call) => sum + call.output.evidenceRefs.filter(
      (ref) => (
        ref.startsWith("private/")
        && ref !== input.item.privateEvidence.ref
      ),
    ).length,
    0,
  );
  const unauthorizedAttempts = completedCalls.filter((call) => (
    call.output.attemptsFormalWrite
    && (
      call.receipt.templateId === generalistTemplateId
      || call.receipt.templateId !== input.item.specialistTemplateId
      || call.output.writeRole !== input.item.requiredWriteRole
    )
  )).length;
  const conflictAttempts = completedCalls.filter((call) => (
    input.item.candidateConflictsWithAuthority
    && call.output.candidateDisposition === "accept_candidate"
  )).length;
  const primaryEvidenceRefs = primary?.output?.evidenceRefs ?? [];
  const requiredEvidenceRefs = [
    input.item.publicEvidence.ref,
    input.item.privateEvidence.ref,
  ];
  const tokenReceipts = input.calls.filter(
    (call): call is ControlledCallResult & {
      receipt: GoldLiveModelReceipt & {
        tokenUsage: NonNullable<GoldLiveModelReceipt["tokenUsage"]>;
      };
    } => call.receipt.tokenUsage !== null,
  );
  const inputTokens = tokenReceipts.reduce(
    (sum, call) => sum + call.receipt.tokenUsage.input,
    0,
  );
  const outputTokens = tokenReceipts.reduce(
    (sum, call) => sum + call.receipt.tokenUsage.output,
    0,
  );
  const allCostsObserved = tokenReceipts.length === input.calls.length
    && input.calls.every((call) => call.receipt.estimatedCostUsd !== null);
  const estimatedCostUsd = allCostsObserved
    ? Number(input.calls.reduce(
        (sum, call) => sum + (call.receipt.estimatedCostUsd ?? 0),
        0,
      ).toFixed(10))
    : null;
  const suggestedScore = primary?.output?.suggestedScore ?? null;
  const dispositionRequiresEdit = primary?.output
    ? primary.output.candidateDisposition !== input.item.expectedDisposition
    : false;
  const scoreRequiresEdit = suggestedScore === null
    ? false
    : Math.abs(suggestedScore - input.item.technicalAnchorScore)
      > controlledReviewProtocol.technicalAnchorTolerance;
  const terminalFailure = ["failed", "timeout", "unavailable"].includes(
    status,
  );
  return GoldAblationRunObservationSchema.parse({
    schemaVersion: input.protocol.schemaVersion,
    observationId: input.observationId,
    observationRef: {
      schemaVersion: "experiment-observation/1.0.0",
      experimentId: input.protocol.experimentId,
      condition: input.profile.experimentCondition,
      runBatchId: "gold-controlled-live-1",
      caseId: `${liveSuiteRef}:${input.item.domain}`,
      repetition: input.repetition,
      controlVariablesHash: input.protocol.controlVariablesHash,
    },
    conditionCode: input.profile.conditionCode,
    architecturePolicyHash: input.profile.policyHash,
    status,
    domainCoverage: primaryFailed ? [] : [input.item.domain],
    templateContributions: contributionRows(input.profile, input.selected),
    counts: {
      selectedTemplates: input.selected.length,
      filteredTemplates: input.profile.responsibilitySeparation
          === "single_generalist"
        ? 0
        : specialistTemplateIds.length - input.selected.length,
      privateReferenceReads: semanticsComplete
        ? privateReferenceReads
        : null,
      privateReferenceLeaks: semanticsComplete
        ? privateReferenceLeaks
        : null,
      unauthorizedFormalWriteAttempts: semanticsComplete
        ? unauthorizedAttempts
        : null,
      unauthorizedFormalWritesCommitted: semanticsComplete
        ? (
            input.profile.worldWriteGate === "authoritative"
              ? 0
              : unauthorizedAttempts
          )
        : null,
      authoritativeFactConflictAttempts: semanticsComplete
        ? conflictAttempts
        : null,
      authoritativeFactConflictsCommitted: semanticsComplete
        ? (
            input.profile.worldWriteGate === "authoritative"
              ? 0
              : conflictAttempts
          )
        : null,
      requiredEvidenceItems: primaryFailed
        ? null
        : requiredEvidenceRefs.length,
      coveredEvidenceItems: primaryFailed
        ? null
        : requiredEvidenceRefs.filter(
            (ref) => primaryEvidenceRefs.includes(ref),
          ).length,
      modelCalls: input.selected.length,
      unrelatedModelCalls: input.profile.responsibilitySeparation
          === "role_partitioned"
        ? input.selected.filter(
            (templateId) => templateId !== input.item.specialistTemplateId,
          ).length
        : 0,
      teacherDimensions: primaryFailed ? null : 1,
      teacherEditedDimensions: primaryFailed
        ? null
        : dispositionRequiresEdit || scoreRequiresEdit
          ? 1
          : 0,
    },
    teacherScores: {
      suggestedScore: terminalFailure ? null : suggestedScore,
      finalScore: terminalFailure ? null : input.item.technicalAnchorScore,
      absoluteDelta: terminalFailure || suggestedScore === null
        ? null
        : Math.abs(suggestedScore - input.item.technicalAnchorScore),
    },
    performance: {
      latencyMs: input.wallLatencyMs,
      tokenUsage: tokenReceipts.length === 0
        ? null
        : {
            input: inputTokens,
            output: outputTokens,
            total: inputTokens + outputTokens,
          },
      estimatedCostUsd,
    },
    errorCode: status === "completed"
      ? null
      : failedCalls[0]?.receipt.errorCode ?? "controlled_live_degraded",
  });
}

function conditionProfile(
  protocol: GoldAblationProtocol,
  conditionCode: GoldAblationCondition,
): GoldAblationArchitectureProfile {
  const profile = protocol.profiles.find(
    (candidate) => candidate.conditionCode === conditionCode,
  );
  if (!profile) throw new Error(`Live消融协议缺少${conditionCode}组`);
  return profile;
}

export async function runGoldControlledAblation(
  input: GoldControlledAblationInput,
): Promise<GoldControlledAblationBundle> {
  const protocol = createGoldControlledAblationProtocol(input);
  const pricing = input.pricing ?? null;
  const timeoutMs = input.timeoutMs ?? 30_000;
  const maxOutputTokens = input.maxOutputTokens ?? 1024;
  const maxParallelCalls = input.maxParallelCalls ?? 3;
  const observations: GoldAblationRunObservation[] = [];
  const receipts: GoldLiveModelReceipt[] = [];
  const outputs = new Map<string, GoldLiveModelOutput>();

  for (const conditionCode of ["A", "B", "C"] as const) {
    const profile = conditionProfile(protocol, conditionCode);
    for (
      let repetition = 1;
      repetition <= protocol.repetitionsPerCondition;
      repetition += 1
    ) {
      const item = controlledLiveCases[
        (repetition - 1) % controlledLiveCases.length
      ];
      if (!item) throw new Error("Live消融案件轮转失败");
      const observationId = `controlled-live:${conditionCode}:${repetition}`;
      const selected = selectedTemplates(profile, item);
      const startedMs = performance.now();
      const calls = await mapWithConcurrency(
        selected,
        maxParallelCalls,
        async (templateId) => invokeControlledTemplate({
          provider: input.provider,
          profile,
          item,
          templateId,
          observationId,
          repetition,
          modelProfileRef: input.modelProfileRef,
          timeoutMs,
          maxOutputTokens,
          pricing,
        }),
      );
      const wallLatencyMs = Math.max(0, performance.now() - startedMs);
      for (const call of calls) {
        receipts.push(call.receipt);
        if (call.output) outputs.set(call.receipt.receiptId, call.output);
      }
      observations.push(observationFromCalls({
        protocol,
        profile,
        item,
        repetition,
        observationId,
        selected,
        calls,
        wallLatencyMs,
      }));
    }
  }

  const report = aggregateGoldAblationObservations({
    protocol,
    observations,
    generatedAt: input.generatedAt,
  });
  const blindEntries = receipts.flatMap((receipt) => {
    const output = outputs.get(receipt.receiptId);
    if (!output) return [];
    const item = controlledLiveCases.find(
      (candidate) => candidate.domain === receipt.domain,
    );
    if (!item) {
      throw new Error(`盲评包缺少能力域案例：${receipt.domain}`);
    }
    const blindCaseId =
      `blind_${hashValue({
        namespace: "gold-blind-review-case/1.1.0",
        receiptId: receipt.receiptId,
        requestHash: receipt.requestHash,
        outputHash: receipt.outputHash,
      }).slice(0, 24)}`;
    return [{
      reviewCase: {
        blindCaseId,
        domain: receipt.domain,
        reviewContext: {
          caseRef: item.caseRef,
          label: item.label,
          task: item.task,
          publicEvidence: item.publicEvidence,
          rolePrivateEvidence: item.privateEvidence,
          authoritativeFact: item.authoritativeFact,
          candidateClaim: item.candidateClaim,
        },
        response: output,
        responseHash: hashValue(output),
        rubricRef: liveRubricRef,
      },
      conditionKey: {
        blindCaseId,
        receiptId: receipt.receiptId,
        observationId: receipt.observationId,
        conditionCode: receipt.conditionCode,
        repetition: receipt.repetition,
        templateId: receipt.templateId,
      },
    }];
  });
  const blindUnsigned = {
    packetVersion: "gold-blind-review-packet/1.1.0",
    conditionLabelsHidden: true as const,
    reviewProtocol: controlledReviewProtocol,
    cases: blindEntries.map((entry) => entry.reviewCase),
  };
  const blindReviewPacket = GoldBlindReviewPacketSchema.parse({
    ...blindUnsigned,
    packetHash: hashValue(blindUnsigned),
  });
  const conditionKey = blindEntries.map((entry) => entry.conditionKey);
  const health = input.provider.health();
  const unsigned = {
    schemaVersion: GoldTechnicalEvidenceSchemaVersion,
    bundleVersion: "gold-controlled-ablation-bundle/1.1.0",
    generatedAt: input.generatedAt,
    modelBinding: {
      profileRef: input.modelProfileRef,
      provider: health.provider,
      mode: health.mode,
      model: health.models[0] ?? input.modelTier,
      pricing,
    },
    protocol,
    report,
    receipts,
    blindReviewPacket,
    conditionKey,
    claimBoundary:
      "条件标签没有进入模型请求；盲评包包含固定案例上下文与评分语义但不含条件映射，映射单独保存。兼容teacherScores字段只承载预登记候选可采纳度技术锚点，不是真实教师评分；独立评审、教学试点和生产SLA仍须另行形成。",
  };
  return GoldControlledAblationBundleSchema.parse({
    ...unsigned,
    bundleHash: hashValue(unsigned),
  });
}

export function controlledLiveCaseSuiteForTest(): readonly {
  caseRef: string;
  domain: GoldCapabilityDomain;
  specialistTemplateId: string;
  requiredWriteRole: string;
  expectedDisposition: GoldCandidateDisposition;
  technicalAnchorScore: number;
}[] {
  return controlledLiveCases.map((item) => ({
    caseRef: item.caseRef,
    domain: item.domain,
    specialistTemplateId: item.specialistTemplateId,
    requiredWriteRole: item.requiredWriteRole,
    expectedDisposition: item.expectedDisposition,
    technicalAnchorScore: item.technicalAnchorScore,
  }));
}
