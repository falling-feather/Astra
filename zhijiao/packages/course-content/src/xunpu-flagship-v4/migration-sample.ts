import { deepFreeze } from "../canonical.js";
import { buildMigrationSection } from "../migration-course-builder.js";
import { defineMigrationSection } from "../migration-section-factory.js";
import type { XunpuMigrationSampleV4 } from "./types.js";

const sectionBlueprint = defineMigrationSection({
  sectionId: "sample-village-super-postpublication-context",
  title: "村超短视频发布后语境回应",
  typicalWorkTask: "核对公开视频语境质疑并形成可追溯回应版本",
  objectives: [
    "区分事实错误、剪辑语境争议与人物公开范围变化",
    "在更正、补充说明和有依据维持之间作出专业选择",
    "保留平台版本、人物反馈与编辑决定的完整证据链",
  ],
  competencyRefs: ["发布后事实核查", "受访者沟通与编辑判断", "多平台更正治理"],
  taskBrief: "一段仿真村超球员采访短视频已发布。受访者认为剪辑只保留了胜负情绪、遗漏社区互助语境，但原句没有被篡改。请核对完整采访、平台版本和公开范围，决定补充说明、重剪、更正或有依据维持，并给出跨平台处理单。",
  sourceKnowledgeIds: [
    "village-k005-collaborative-distribution-matrix",
    "village-k006-feedback-and-algorithm-boundary",
    "village-k009-community-centered-story",
    "village-k011-audiovisual-production-workflow",
  ],
  hiddenFacts: [
    {
      key: "accurate-quote-misleading-cut",
      summary: "引语逐字准确，但前后两段关于社区互助的说明未进入首发剪辑，造成语境偏移。",
      revealCondition: "学生并排查看完整采访记录与首发时间线后触发。",
    },
    {
      key: "platform-window-not-editorial-proof",
      summary: "平台建议趁热维持原剪辑，但建议只基于互动数据，不掌握完整采访与人物约定。",
      revealCondition: "学生请求平台建议或查看传播数据时触发。",
    },
  ],
  actions: [
    {
      key: "compare",
      label: "并排核对采访与公开版本",
      intent: "compare_interview_and_public_cut",
      guidance: "标出原句、前后语境、人物公开范围、各平台版本和质疑指向，不先假定必须道歉或必须维持。",
      knowledgeIds: ["village-k009-community-centered-story", "village-k011-audiovisual-production-workflow"],
      evidenceKey: "source",
    },
    {
      key: "decide",
      label: "回应人物与智能体质疑",
      intent: "decide_postpublication_response",
      guidance: "对采纳、补证或拒绝建议作出决定，区分事实、语境、权利和平台数据的证据地位。",
      knowledgeIds: ["village-k006-feedback-and-algorithm-boundary", "village-k009-community-centered-story"],
      evidenceKey: "decision",
    },
    {
      key: "publish-response",
      label: "提交跨平台回应版本",
      intent: "submit_traceable_response",
      guidance: "保留首发版本，生成补充说明、重剪或维持理由，并列出每个平台的同步动作与下一次检查时间。",
      knowledgeIds: ["village-k005-collaborative-distribution-matrix", "village-k011-audiovisual-production-workflow"],
      evidenceKey: "output",
    },
  ],
  primaryActionKey: "publish-response",
  event: {
    key: "participant-context-challenge",
    triggerKind: "on_action",
    triggerKey: "compare",
    studentBrief: "仿真受访者确认原句没有捏造，但认为首发剪辑遗漏了社区互助语境；平台同时提示当前互动仍在上升。",
    hiddenPayload: "仿真灰度冲突：人物质疑指向语境而非逐字事实错误，平台建议只掌握互动数据；必须由学生基于完整证据决定。",
    affectedAgentIds: ["agent-interviewee", "agent-platform", "agent-chief"],
    candidateAgentIds: ["agent-interviewee", "agent-platform", "agent-chief", "agent-fact-checker", "agent-governance-content-safety"],
    teacherApprovalRequired: true,
  },
  agentSelection: {
    affectedAgentIds: ["agent-interviewee", "agent-platform", "agent-chief"],
    candidateAgentIds: ["agent-interviewee", "agent-platform", "agent-chief", "agent-fact-checker", "agent-governance-content-safety"],
    selectWhen: "人物语境质疑、公开版本和平台数据相互冲突时，只选择能够提供当前证据或专业挑战的智能体。",
    skipWhen: "候选无法访问完整采访、人物回执或对应平台版本时跳过，不以通用写作建议占用主建议位。",
    maximumSelectedAgents: 3,
  },
  artifact: {
    label: "发布后语境回应与版本处理单",
    format: "evidence_bundle",
    completionCriteria: [
      "首发版本、完整采访与人物反馈可追溯",
      "明确判断属于事实更正、语境补充、权利响应或有依据维持",
      "至少列出两个平台的同步动作和下一检查时间",
    ],
    finalCourseArtifact: false,
  },
  evidenceFocus: {
    source: "完整采访、首发版本、人物反馈与平台版本时间戳。",
    decision: "学生对人物、平台、核查和治理建议的采纳、补证或拒绝理由。",
    output: "带版本差异、公开说明、跨平台动作和责任人的回应处理单。",
  },
  rubricFocus: {
    accuracy: "能够区分原句准确、语境偏移、授权范围与平台互动数据，不虚构事实错误。",
    reasoning: "取舍回指具体采访、反馈和版本证据，不以热度或单一智能体意见替代判断。",
    deliverable: "回应版本可执行、可追溯，跨平台同步与再次检查条件明确。",
    transfer: "能把发布后回应方法迁移到其他人物报道、赛事争议或公共服务更新。",
    failClosedWhen: "删除质疑、静默覆盖、让模型代责，或没有完整采访证据就宣称人物表述错误",
  },
  teacherGate: {
    label: "发布后回应与版本门",
    trigger: "before_section_complete",
    checks: ["问题类型判断有证据", "原版与新版本同时保留", "跨平台动作和人物通知可执行", "不存在静默覆盖或责任转移"],
    minimumEvidenceCount: 3,
    rejectReturnsToActionKey: "decide",
  },
  reflection: {
    prompt: "如果质疑来自观众而非受访者，且完整采访支持现有剪辑，你会如何调整回应、证据公开和平台动作？",
    targetContext: "其他人物报道或公共议题中的发布后语境争议",
    comparisonDimensions: ["质疑主体", "事实与语境", "权利范围", "传播伤害", "版本策略"],
  },
});

export const xunpuV4MigrationSample = deepFreeze({
  sampleId: "migration-sample-xunpu-pattern-to-village-super-v1",
  sourcePatternRef: "manifest-xunpu-flagship-v4",
  targetCourseId: "course-village-super-multiplatform",
  transferHypothesis: "发布后人物回应、灰度判断、证据门和版本恢复可由通用内容工厂表达，无需增加课程 ID 特判或服务端状态机。",
  section: buildMigrationSection(sectionBlueprint, 7),
  serviceCodeChangeRequired: false,
}) as XunpuMigrationSampleV4;
