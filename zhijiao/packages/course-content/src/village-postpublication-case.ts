import { createKnowledgeRecord, deepFreeze } from "./canonical.js";
import { createMigrationCourse } from "./migration-course-builder.js";
import { defineMigrationSection } from "./migration-section-factory.js";
import {
  KnowledgeRecordSchemaVersion,
  type KnowledgeRecord,
} from "./types.js";
import { villageSuperKnowledgeRecords } from "./migration-knowledge.js";

const sectionIds = [
  "village-postpublication-context-triage",
  "village-postpublication-interview-audit",
  "village-postpublication-scope-negotiation",
  "village-postpublication-multiplatform-correction",
  "village-postpublication-impact-review",
] as const;

function sourceFromVillageKnowledge(
  knowledgeId: string,
  trainingLocator: string,
) {
  const sourceRecord = villageSuperKnowledgeRecords.find((record) => (
    record.knowledgeId === knowledgeId
  ));
  if (!sourceRecord) throw new Error(`CONTENT-013 缺少复用来源：${knowledgeId}`);
  return {
    ...sourceRecord.source,
    locator: `${sourceRecord.source.locator}；CONTENT-013 训练定位：${trainingLocator}`,
  };
}

function knowledge(input: {
  knowledgeId: string;
  sourceKnowledgeId: string;
  topic: string;
  teachingSummary: string;
  applicableSectionIds: readonly string[];
  trainingLocator: string;
}): KnowledgeRecord {
  return createKnowledgeRecord({
    schemaVersion: KnowledgeRecordSchemaVersion,
    knowledgeId: input.knowledgeId,
    topic: input.topic,
    teachingSummary: input.teachingSummary,
    applicableSectionIds: [...input.applicableSectionIds],
    source: sourceFromVillageKnowledge(input.sourceKnowledgeId, input.trainingLocator),
    reviewStatus: "pending_expert_review",
    reviewNote: "复用已登记公开来源；CONTENT-013 教学转译尚待融媒体专业教师复核。",
    reusePolicy: "metadata_link_and_paraphrase_only",
  });
}

export const villagePostpublicationKnowledgeRecords = deepFreeze([
  knowledge({
    knowledgeId: "village-postpublication-k001-context-triage",
    sourceKnowledgeId: "village-k009-community-centered-story",
    topic: "发布后质疑的事实、语境与主体边界",
    teachingSummary: "人物质疑可能针对引语事实、剪辑语境、主体呈现或公开范围。记者应先拆分质疑类型，再决定是否补证、更正、重剪或维持，不能用一句“内容真实”覆盖所有问题。",
    applicableSectionIds: [sectionIds[0], sectionIds[1]],
    trainingLocator: "群众主体与多视角人物选择；用于质疑类型拆分",
  }),
  knowledge({
    knowledgeId: "village-postpublication-k002-quote-context-boundary",
    sourceKnowledgeId: "village-k008-live-interview-and-short-video",
    topic: "原句准确不等于剪辑语境完整",
    teachingSummary: "直播访谈和短视频联合叙事需要同时标出人物观点、事实镜头和现场气氛。逐字准确的引语仍可能因删去前后语境而造成误读，核验应保留完整记录与公开版本差异。",
    applicableSectionIds: [sectionIds[0], sectionIds[1]],
    trainingLocator: "直播访谈与短视频联合叙事；用于原句与剪辑语境对照",
  }),
  knowledge({
    knowledgeId: "village-postpublication-k003-interview-version-audit",
    sourceKnowledgeId: "village-k011-audiovisual-production-workflow",
    topic: "完整采访、旧剪辑与修订版本的证据链",
    teachingSummary: "视听生产应把采集、编辑、发布与修订连成版本链。发布后复核至少要能定位完整采访、首发剪辑、被质疑片段和拟议修订，不以新版本覆盖旧版本。",
    applicableSectionIds: [sectionIds[1], sectionIds[3]],
    trainingLocator: "视听内容策划制作工作流；用于版本差异与修订依据",
  }),
  knowledge({
    knowledgeId: "village-postpublication-k004-source-time-version",
    sourceKnowledgeId: "village-k003-high-frequency-production",
    topic: "高频更新中的时间戳与来源责任",
    teachingSummary: "高频供给必须为每次更新保留时间、来源和更正状态。旧视频的互动增长只说明当时分发结果，不能证明新的语境判断或人物公开范围已经得到确认。",
    applicableSectionIds: [sectionIds[1], sectionIds[4]],
    trainingLocator: "高频更新与快速响应机制；用于旧版本和新证据时点",
  }),
  knowledge({
    knowledgeId: "village-postpublication-k005-scope-withdrawal-response",
    sourceKnowledgeId: "village-k005-collaborative-distribution-matrix",
    topic: "人物公开范围与跨账号传播责任",
    teachingSummary: "开放信号和协作分发不等于人物同意所有平台、用途和期限。收到公开范围变化时，应记录人物意见、受影响版本、通知渠道和替换或限用方案。",
    applicableSectionIds: [sectionIds[2], sectionIds[3]],
    trainingLocator: "主账号、自媒体与公共信号协同；用于公开范围与责任登记",
  }),
  knowledge({
    knowledgeId: "village-postpublication-k006-multiplatform-consistency",
    sourceKnowledgeId: "village-k010-cross-platform-streaming",
    topic: "跨平台版本的共同事实与有目的差异",
    teachingSummary: "不同平台可以改变篇幅、节奏和提示方式，但人物、时间、场次与质疑性质等共同事实必须一致。差异表应说明每个平台的删改、责任人和再次检查条件。",
    applicableSectionIds: [sectionIds[2], sectionIds[3]],
    trainingLocator: "乡村主播的跨平台传播边界；用于三端差异表",
  }),
  knowledge({
    knowledgeId: "village-postpublication-k007-correction-chain",
    sourceKnowledgeId: "village-k006-feedback-and-algorithm-boundary",
    topic: "互动反馈不能替代更正判断",
    teachingSummary: "算法和互动反馈只能说明分发结果，不能自动证明事实质量、文化表达或公共价值。更正、补充语境和维持原版都应回指采访、人物意见、版本差异和编辑理由。",
    applicableSectionIds: [sectionIds[2], sectionIds[3]],
    trainingLocator: "算法、互动反馈与内容判断；用于平台意见与编辑决定分离",
  }),
  knowledge({
    knowledgeId: "village-postpublication-k008-impact-metrics",
    sourceKnowledgeId: "village-k012-live-and-data-job-loop",
    topic: "发布后影响的多指标与口径复盘",
    teachingSummary: "发布后复盘应区分触达、观看、互动、转化、反馈质量和更正负担，写清统计时间窗、分母与异常来源。高播放量不等于语境呈现成功，也不等于人物关系未受损。",
    applicableSectionIds: [sectionIds[4]],
    trainingLocator: "直播运营与数据分析闭环；用于影响追踪与口径说明",
  }),
  knowledge({
    knowledgeId: "village-postpublication-k009-public-feedback-boundary",
    sourceKnowledgeId: "village-k007-official-multiplatform-showcase",
    topic: "公开传播反馈与事实底座分离",
    teachingSummary: "多平台展示能扩大公共信息触达，但传播渠道和展示案例不能替代采访事实、人物确认和版本回执。跨平台回应要保留同一事实底座，并分别记录渠道执行状态。",
    applicableSectionIds: [sectionIds[3], sectionIds[4]],
    trainingLocator: "多平台集中展示与直播分发；用于渠道回应与回执",
  }),
  knowledge({
    knowledgeId: "village-postpublication-k010-transfer-hypothesis",
    sourceKnowledgeId: "village-k002-five-story-pillars",
    topic: "从赛事短视频向公共文化报道迁移",
    teachingSummary: "竞技高光、文化主体、乡土生活和情感叙事可以组合成不同报道角度，但迁移时必须重新核对人物、时间、来源和平台责任，不能把原赛事叙事模板套成新事实。",
    applicableSectionIds: [sectionIds[0], sectionIds[4]],
    trainingLocator: "村超视听叙事的五类内容支柱；用于终章迁移反思",
  }),
]);

const sections = [
  defineMigrationSection({
    sectionId: sectionIds[0],
    title: "发布后质疑类型界定",
    typicalWorkTask: "把一条人物语境质疑拆成可核验的事实、语境、权利与平台问题",
    objectives: [
      "区分原句准确、剪辑语境偏移、人物公开范围变化和平台反馈",
      "为每一种质疑建立来源、主张和版本对照",
      "在没有完整证据时保持待核，不预设道歉或维持",
    ],
    competencyRefs: ["发布后事实核查", "问题界定", "编辑边界判断"],
    taskBrief: "一条仿真村超短视频已经发布。受访者说剪辑只保留比赛情绪，删去了社区互助语境；平台则提示互动正在上升。请先界定这是事实错误、语境失真、权利问题还是平台反馈，并写出还缺什么证据。",
    sourceKnowledgeIds: [
      "village-postpublication-k001-context-triage",
      "village-postpublication-k002-quote-context-boundary",
      "village-postpublication-k010-transfer-hypothesis",
    ],
    hiddenFacts: [
      {
        key: "quote-remains-accurate",
        summary: "首发视频中的一句引语与完整采访逐字一致，但剪辑删除了前后关于社区互助的说明。",
        revealCondition: "学生并排查看完整采访与首发剪辑后揭示。",
      },
      {
        key: "platform-feedback-is-not-proof",
        summary: "平台互动数据来自首发后的短窗口，只能说明传播反馈，不能证明语境已经准确。",
        revealCondition: "学生请求平台意见或把互动量作为结论时揭示。",
      },
    ],
    actions: [
      {
        key: "compare",
        label: "并排核对原句与剪辑语境",
        intent: "compare_quote_and_context",
        guidance: "标出原句、前后语境、删减点和首发时间，不先把语境争议写成事实错误。",
        knowledgeIds: ["village-postpublication-k001-context-triage", "village-postpublication-k002-quote-context-boundary"],
        evidenceKey: "source",
      },
      {
        key: "classify",
        label: "界定质疑类型与证据缺口",
        intent: "classify_postpublication_claim",
        guidance: "分别写出事实、语境、权利、平台数据四类判断，并为每类列出可回指材料。",
        knowledgeIds: ["village-postpublication-k001-context-triage", "village-postpublication-k010-transfer-hypothesis"],
        evidenceKey: "decision",
      },
      {
        key: "freeze",
        label: "提交质疑分诊单",
        intent: "submit_claim_triage",
        guidance: "保留待核项和不同合理处理路径，提交可让下一位记者接手的分诊版本。",
        knowledgeIds: ["village-postpublication-k002-quote-context-boundary"],
        evidenceKey: "output",
      },
    ],
    primaryActionKey: "freeze",
    event: {
      key: "context-challenge",
      triggerKind: "on_action",
      triggerKey: "compare",
      studentBrief: "仿真受访者确认原句没有捏造，但首发剪辑遗漏社区互助语境；平台互动仍在上升。请先区分事实错误与语境失真。",
      hiddenPayload: "仿真冲突：人物质疑指向剪辑选择而非引语逐字准确性，平台数据不能替代完整采访证据。",
      affectedAgentIds: ["agent-interviewee", "agent-platform", "agent-chief"],
      candidateAgentIds: ["agent-interviewee", "agent-platform", "agent-chief", "agent-fact-checker"],
      teacherApprovalRequired: false,
    },
    agentSelection: {
      affectedAgentIds: ["agent-interviewee", "agent-platform", "agent-chief"],
      candidateAgentIds: ["agent-interviewee", "agent-platform", "agent-chief", "agent-fact-checker"],
      selectWhen: "人物语境质疑、首发版本与传播反馈发生冲突时，仅选择能补充当前证据的智能体。",
      skipWhen: "候选只能复述热度或无法访问完整采访、版本和人物意见时跳过。",
      maximumSelectedAgents: 3,
    },
    artifact: {
      label: "发布后质疑分诊单",
      format: "evidence_bundle",
      completionCriteria: ["四类质疑分开记录", "每项判断有来源和版本定位", "待核项与替代处理路径明确"],
      finalCourseArtifact: false,
    },
    evidenceFocus: {
      source: "完整采访、首发剪辑、人物反馈和平台数据窗口的定位对照。",
      decision: "对质疑类型和证据缺口作出有依据的界定。",
      output: "可交接的分诊单，保留待核项和不同合理处理路径。",
    },
    rubricFocus: {
      accuracy: "不把语境失真、权利变化或平台互动误写成逐字事实错误。",
      reasoning: "分类回指具体采访、版本和数据窗口，而不是凭道德直觉选处理方式。",
      deliverable: "分诊单能指导后续核对、协商和更正，不掩盖证据缺口。",
      transfer: "能把质疑分诊方法迁移到其他赛事、人物或公共文化短视频。",
      failClosedWhen: "只因互动上涨就认定语境准确，或只因人物质疑就认定引语捏造",
    },
    teacherGate: {
      label: "质疑类型与证据缺口门",
      trigger: "before_section_complete",
      checks: ["事实与语境分开", "平台反馈未替代来源", "待核项可追踪", "没有预设唯一回应"],
      minimumEvidenceCount: 3,
      rejectReturnsToActionKey: "classify",
    },
    reflection: {
      prompt: "如果完整采访支持首发剪辑，而人物只质疑镜头顺序，你会如何调整分诊与后续回应？",
      targetContext: "其他赛事人物报道与公共文化短视频",
      comparisonDimensions: ["质疑主体", "事实与语境", "平台反馈", "证据缺口"],
    },
  }),
  defineMigrationSection({
    sectionId: sectionIds[1],
    title: "完整采访与旧剪辑核对",
    typicalWorkTask: "重建完整采访、首发版本与被质疑片段的可追溯差异",
    objectives: [
      "核对引语前后语境、删减点、时间戳和人物原始意见",
      "区分事实准确、叙事选择和遗漏造成的误导风险",
      "形成可供编辑、人物与平台共同复核的版本证据",
    ],
    competencyRefs: ["采访记录核验", "视听版本管理", "语境风险识别"],
    taskBrief: "你已将质疑分为语境问题，但还不能直接决定重剪。请核对完整采访记录、首发剪辑时间线和人物原始公开范围，找出删减如何改变观众理解，并把每个判断绑定到可定位材料。",
    sourceKnowledgeIds: [
      "village-postpublication-k002-quote-context-boundary",
      "village-postpublication-k003-interview-version-audit",
      "village-postpublication-k004-source-time-version",
    ],
    hiddenFacts: [
      {
        key: "deleted-community-context",
        summary: "被删的两段内容解释了球员、社区志愿者和观众的互助关系，恢复它们会改变叙事重心但不会改变比分事实。",
        revealCondition: "学生完成完整采访与首发时间线对照后揭示。",
      },
      {
        key: "original-scope-was-limited",
        summary: "人物原始意见只同意赛事现场和公开采访，不同意把私人家庭内容剪入跨平台版本。",
        revealCondition: "学生核对采访记录末尾的公开范围说明后揭示。",
      },
    ],
    actions: [
      {
        key: "audit",
        label: "重建采访与版本时间线",
        intent: "audit_interview_version_chain",
        guidance: "逐段标出完整采访、首发剪辑、删减点、发布时间和人物意见，不用新版本覆盖旧记录。",
        knowledgeIds: ["village-postpublication-k002-quote-context-boundary", "village-postpublication-k003-interview-version-audit"],
        evidenceKey: "source",
      },
      {
        key: "explain",
        label: "解释语境偏移与风险",
        intent: "explain_context_distortion",
        guidance: "说明观众可能如何误读，分别标记事实、语境和公开范围影响。",
        knowledgeIds: ["village-postpublication-k003-interview-version-audit", "village-postpublication-k004-source-time-version"],
        evidenceKey: "decision",
      },
      {
        key: "submit-ledger",
        label: "提交版本证据台账",
        intent: "submit_version_evidence_ledger",
        guidance: "提交包含片段定位、人物意见和待处理差异的台账，保留下一步协商入口。",
        knowledgeIds: ["village-postpublication-k004-source-time-version"],
        evidenceKey: "output",
      },
    ],
    primaryActionKey: "submit-ledger",
    event: {
      key: "version-audit-complete",
      triggerKind: "on_action",
      triggerKey: "audit",
      studentBrief: "完整采访显示删减改变了社区互助语境，但比分与引语本身没有改变；人物公开范围仍需单独协商。",
      hiddenPayload: "仿真证据：原句准确和剪辑语境失真可以同时成立，权利范围不能从事实准确自动推导。",
      affectedAgentIds: ["agent-interviewee", "agent-fact-checker", "agent-chief"],
      candidateAgentIds: ["agent-interviewee", "agent-fact-checker", "agent-chief", "agent-platform"],
      teacherApprovalRequired: false,
    },
    agentSelection: {
      affectedAgentIds: ["agent-interviewee", "agent-fact-checker", "agent-chief"],
      candidateAgentIds: ["agent-interviewee", "agent-fact-checker", "agent-chief", "agent-platform"],
      selectWhen: "完整采访、首发剪辑和人物原始范围需要逐项对照时，选择核查或人物沟通智能体。",
      skipWhen: "候选无法指出片段定位、版本差异或公开范围时跳过。",
      maximumSelectedAgents: 3,
    },
    artifact: {
      label: "采访与旧剪辑版本证据台账",
      format: "structured_form",
      completionCriteria: ["完整采访与首发版本可定位", "删减点及其语境影响有解释", "人物公开范围与待核项分开"],
      finalCourseArtifact: false,
    },
    evidenceFocus: {
      source: "完整采访记录、首发时间线、片段定位和人物原始范围说明。",
      decision: "对事实准确与语境偏移并存的判断及其风险作出说明。",
      output: "保留旧版、差异和后续协商入口的版本证据台账。",
    },
    rubricFocus: {
      accuracy: "能够同时保留原句准确和语境失真的双重判断，不互相覆盖。",
      reasoning: "删减与风险解释能回到具体时间线和人物范围，不靠平台热度推断。",
      deliverable: "台账可供人物、编辑和平台复核，版本责任链完整。",
      transfer: "能迁移到直播切片、完整录音与短视频摘要的核验。",
      failClosedWhen: "只保留支持现有判断的片段，或用新剪辑删除旧版本证据",
    },
    teacherGate: {
      label: "采访版本与语境核验门",
      trigger: "before_section_complete",
      checks: ["原句与语境分开", "版本差异有定位", "人物范围未被推断", "旧版证据保留"],
      minimumEvidenceCount: 3,
      rejectReturnsToActionKey: "explain",
    },
    reflection: {
      prompt: "如果删减没有改变语境，而是为了满足时长，你仍需要向受访者解释哪些版本信息？",
      targetContext: "直播切片、人物短访与长视频摘要",
      comparisonDimensions: ["删减目的", "语境完整性", "人物范围", "版本责任"],
    },
  }),
  defineMigrationSection({
    sectionId: sectionIds[2],
    title: "人物公开范围与平台意见协商",
    typicalWorkTask: "在人物反馈、平台建议和编辑独立之间形成可执行的公开范围方案",
    objectives: [
      "分别记录受访者同意范围、平台建议和编辑决定",
      "为补充语境、重剪、限平台或维持提供合法替代路径",
      "把通知、撤回、版本和责任人写入可执行处理单",
    ],
    competencyRefs: ["人物沟通与同意", "平台协商", "权利与编辑独立"],
    taskBrief: "受访者要求补回社区互助语境，并提醒不应扩大到家庭内容；平台建议保留高互动版本。请分别记录人物范围、平台意见和编辑底线，协商一套不强迫同意、也不让平台数据替代判断的处理方案。",
    sourceKnowledgeIds: [
      "village-postpublication-k005-scope-withdrawal-response",
      "village-postpublication-k006-multiplatform-consistency",
      "village-postpublication-k007-correction-chain",
    ],
    hiddenFacts: [
      {
        key: "participant-accepts-context-note",
        summary: "仿真受访者接受补充社区互助语境，但拒绝公开家庭住址和未成年人信息。",
        revealCondition: "学生明确询问公开范围、用途和撤回入口后揭示。",
      },
      {
        key: "platform-cannot-authorize-person",
        summary: "仿真平台建议只依据完播和互动保留首发版本，没有人物授权或编辑替代权。",
        revealCondition: "学生请求平台决定人物公开范围时揭示。",
      },
    ],
    actions: [
      {
        key: "scope",
        label: "核对人物公开范围",
        intent: "verify_participant_public_scope",
        guidance: "记录可以保留、需要补充说明、必须删除或不得扩张的内容，并保留撤回方式。",
        knowledgeIds: ["village-postpublication-k005-scope-withdrawal-response", "village-postpublication-k007-correction-chain"],
        evidenceKey: "source",
      },
      {
        key: "negotiate",
        label: "协商平台与编辑处理方案",
        intent: "negotiate_platform_editorial_response",
        guidance: "比较补充说明、重剪、限平台和维持等方案，写清各自证据、成本和责任。",
        knowledgeIds: ["village-postpublication-k006-multiplatform-consistency", "village-postpublication-k007-correction-chain"],
        evidenceKey: "decision",
      },
      {
        key: "submit-scope",
        label: "提交公开范围处理单",
        intent: "submit_scope_response_plan",
        guidance: "提交人物通知、平台动作、版本处置和下一次复核时间，不把口头同意当成全平台许可。",
        knowledgeIds: ["village-postpublication-k005-scope-withdrawal-response", "village-postpublication-k006-multiplatform-consistency"],
        evidenceKey: "output",
      },
    ],
    primaryActionKey: "submit-scope",
    event: {
      key: "scope-negotiation",
      triggerKind: "on_action",
      triggerKey: "negotiate",
      studentBrief: "仿真人物同意补回社区语境，但不授权家庭内容；平台意见仍只基于互动数据。请把人物范围和平台动作分开。",
      hiddenPayload: "仿真灰度冲突：平台可以提供分发建议，但不能替人物授权，也不能替编辑决定是否更正。",
      affectedAgentIds: ["agent-interviewee", "agent-platform", "agent-copyright"],
      candidateAgentIds: ["agent-interviewee", "agent-platform", "agent-copyright", "agent-chief"],
      teacherApprovalRequired: true,
    },
    agentSelection: {
      affectedAgentIds: ["agent-interviewee", "agent-platform", "agent-copyright"],
      candidateAgentIds: ["agent-interviewee", "agent-platform", "agent-copyright", "agent-chief"],
      selectWhen: "公开范围、跨平台传播和编辑独立发生冲突时，只选择能提供对应回执或边界的智能体。",
      skipWhen: "候选以互动数据或通用道歉替代人物意见、权利范围和版本责任时跳过。",
      maximumSelectedAgents: 3,
    },
    artifact: {
      label: "人物公开范围与平台处理单",
      format: "evidence_bundle",
      completionCriteria: ["人物范围逐项记录", "平台与编辑决定分开", "通知、版本、责任人与复核时间明确"],
      finalCourseArtifact: false,
    },
    evidenceFocus: {
      source: "人物公开范围、首发版本、平台反馈和既有协作分发记录。",
      decision: "对补充、重剪、限平台或维持方案作出取舍并说明成本。",
      output: "包含通知、版本动作、责任人和复核时间的处理单。",
    },
    rubricFocus: {
      accuracy: "不把平台互动、公开信号或口头同意扩大为人物全范围授权。",
      reasoning: "协商方案同时回应人物边界、编辑独立与平台传播成本。",
      deliverable: "处理单可直接执行并能回放人物通知与版本状态。",
      transfer: "能迁移到赛事运动员、志愿者和社区受访者的发布后协商。",
      failClosedWhen: "强迫人物接受高互动版本、隐藏利益关系或把平台建议当授权",
    },
    teacherGate: {
      label: "人物范围与平台意见复核门",
      trigger: "before_publish",
      checks: ["人物范围具体", "平台建议不越权", "方案具有合法替代路径", "通知与责任可执行"],
      minimumEvidenceCount: 3,
      rejectReturnsToActionKey: "negotiate",
    },
    reflection: {
      prompt: "如果人物只要求补充语境、不要求重剪，平台仍建议保留原版，你会如何说明两者可以同时被尊重？",
      targetContext: "公共文化人物报道与跨平台传播",
      comparisonDimensions: ["同意范围", "平台反馈", "编辑独立", "通知责任"],
    },
  }),
  defineMigrationSection({
    sectionId: sectionIds[3],
    title: "跨平台回应、重剪与更正送审",
    typicalWorkTask: "把公开范围方案落实为保留旧版的跨平台修订与更正包",
    objectives: [
      "为客户端、短视频和直播预告建立共同事实与差异表",
      "保留旧版、修订差异、人物通知和平台回执",
      "按教师门要求提交可执行的更正、重剪或有依据维持方案",
    ],
    competencyRefs: ["跨平台编辑", "版本更正治理", "教师门沟通"],
    taskBrief: "你已经取得人物范围处理方案。现在要把它落实为三端回应：补充语境说明、重剪短视频或有依据维持原版均可，但必须保留首发版本，写明各端变化、人物通知、平台回执和再次检查条件，并提交教师更正门。",
    sourceKnowledgeIds: [
      "village-postpublication-k003-interview-version-audit",
      "village-postpublication-k005-scope-withdrawal-response",
      "village-postpublication-k006-multiplatform-consistency",
      "village-postpublication-k009-public-feedback-boundary",
    ],
    hiddenFacts: [
      {
        key: "platform-version-differs",
        summary: "客户端允许追加语境说明，短视频需要重剪，直播预告仍可维持但必须带版本说明；三端不能使用同一套剪辑文件冒充一致。",
        revealCondition: "学生生成跨平台差异表后揭示。",
      },
      {
        key: "old-version-must-remain",
        summary: "教师门要求保留首发版本和原始质疑，以便复核修订是否回应真实问题。",
        revealCondition: "学生准备提交更正包时揭示。",
      },
    ],
    actions: [
      {
        key: "build-variants",
        label: "建立三端回应版本",
        intent: "build_cross_platform_response_variants",
        guidance: "冻结共同事实后，分别写出每端的语境补充、镜头变化、标题和时间线。",
        knowledgeIds: ["village-postpublication-k006-multiplatform-consistency", "village-postpublication-k009-public-feedback-boundary"],
        evidenceKey: "source",
      },
      {
        key: "preflight",
        label: "核对更正与权利回执",
        intent: "preflight_correction_and_rights",
        guidance: "检查旧版保留、人物通知、素材范围、平台状态、责任人和下一检查时间。",
        knowledgeIds: ["village-postpublication-k003-interview-version-audit", "village-postpublication-k005-scope-withdrawal-response"],
        evidenceKey: "decision",
      },
      {
        key: "submit-correction",
        label: "提交跨平台更正包",
        intent: "submit_cross_platform_correction",
        guidance: "将差异表、公开说明、通知记录和合理替代路径送入教师门，不能静默覆盖首发版本。",
        knowledgeIds: ["village-postpublication-k003-interview-version-audit", "village-postpublication-k006-multiplatform-consistency", "village-postpublication-k009-public-feedback-boundary"],
        evidenceKey: "output",
      },
    ],
    primaryActionKey: "submit-correction",
    event: {
      key: "correction-package",
      triggerKind: "on_action",
      triggerKey: "preflight",
      studentBrief: "三端处理不能复用同一个剪辑文件：客户端补语境、短视频重剪、直播预告保留但要附版本说明。请提交可审查的差异与回执。",
      hiddenPayload: "仿真版本事件：平台与人物要求不同端采用不同处理，但共同事实、旧版和责任链必须一致。",
      affectedAgentIds: ["agent-platform", "agent-copyright", "agent-chief"],
      candidateAgentIds: ["agent-platform", "agent-copyright", "agent-chief", "agent-fact-checker", "agent-governance-content-safety"],
      teacherApprovalRequired: true,
    },
    agentSelection: {
      affectedAgentIds: ["agent-platform", "agent-copyright", "agent-chief"],
      candidateAgentIds: ["agent-platform", "agent-copyright", "agent-chief", "agent-fact-checker", "agent-governance-content-safety"],
      selectWhen: "跨平台版本、人物范围、来源说明和更正责任发生可验证冲突时选择必要的复核智能体。",
      skipWhen: "候选只提出统一模板、抹平端差异或不能给出平台/权利回执时跳过。",
      maximumSelectedAgents: 3,
    },
    artifact: {
      label: "跨平台语境回应与更正包",
      format: "evidence_bundle",
      completionCriteria: ["三端共同事实与差异表完整", "首发版本、人物通知和平台回执保留", "更正或维持方案可由教师复核"],
      finalCourseArtifact: false,
    },
    evidenceFocus: {
      source: "三端版本、首发剪辑、人物范围记录和平台回执。",
      decision: "对重剪、更正、补充说明或维持方案作出证据化决定。",
      output: "包含差异表、通知、回执、责任人与检查时间的送审包。",
    },
    rubricFocus: {
      accuracy: "三端共同事实一致，语境、权利和平台状态没有被互相冒充。",
      reasoning: "每项删改都回指人物意见、版本差异或平台规则，不以一键同步代替判断。",
      deliverable: "更正包可执行、可审查、可恢复，首发版本不会被静默覆盖。",
      transfer: "能迁移到图文、播客、直播回放和多账号同步更正。",
      failClosedWhen: "删除首发版本、只换封面、未通知人物或以平台热度替代更正依据",
    },
    teacherGate: {
      label: "跨平台更正与重剪送审门",
      trigger: "before_publish",
      checks: ["共同事实一致", "版本差异可定位", "人物通知可回放", "不存在静默覆盖"],
      minimumEvidenceCount: 3,
      rejectReturnsToActionKey: "preflight",
    },
    reflection: {
      prompt: "如果教师门退回短视频重剪但同意客户端补充说明，你如何保留两项决定之间的因果和版本差异？",
      targetContext: "同一事件的图文、短视频和直播回放更正",
      comparisonDimensions: ["共同事实", "端内差异", "权利范围", "回执与版本"],
    },
  }),
  defineMigrationSection({
    sectionId: sectionIds[4],
    title: "影响跟踪与迁移复盘",
    typicalWorkTask: "跟踪回应后的影响、异常反馈与更正负担并提出下一轮验证假设",
    objectives: [
      "区分传播数据、人物反馈、版本稳定性与公共价值结果",
      "追踪更正后的影响和未解决风险，不把高触达当作成功",
      "形成可迁移、可验证的下一轮编辑改进假设",
    ],
    competencyRefs: ["传播影响分析", "作品质量复盘", "跨情境迁移"],
    taskBrief: "回应包已经送审并产生新的仿真数据：客户端阅读完成率上升，短视频播放量下降，人物反馈认为语境更完整，但一条旧链接仍在扩散。请对齐统计口径、追踪版本和反馈，提交最终复盘与下一轮验证假设。",
    sourceKnowledgeIds: [
      "village-postpublication-k004-source-time-version",
      "village-postpublication-k008-impact-metrics",
      "village-postpublication-k009-public-feedback-boundary",
      "village-postpublication-k010-transfer-hypothesis",
    ],
    hiddenFacts: [
      {
        key: "metrics-window-differs",
        summary: "客户端数据覆盖七天，短视频数据只覆盖修订后 24 小时；旧链接的扩散量未被计入新版本播放量。",
        revealCondition: "学生对齐三端统计口径后揭示。",
      },
      {
        key: "old-link-still-circulates",
        summary: "旧链接仍被少量账号转发，尚未形成新的事实错误，但需要记录通知与后续检查。",
        revealCondition: "学生检查版本传播和人物反馈后揭示。",
      },
    ],
    actions: [
      {
        key: "align",
        label: "对齐三端影响数据",
        intent: "align_response_impact_metrics",
        guidance: "记录统计窗口、分母、版本和异常传播链，再比较触达、留存、反馈和更正负担。",
        knowledgeIds: ["village-postpublication-k004-source-time-version", "village-postpublication-k008-impact-metrics"],
        evidenceKey: "source",
      },
      {
        key: "review",
        label: "复核回应质量与未解决项",
        intent: "review_response_quality_and_residual_risk",
        guidance: "综合人物反馈、平台回执、旧链接和版本差异，指出哪些问题已解决、哪些仍需跟踪。",
        knowledgeIds: ["village-postpublication-k007-correction-chain", "village-postpublication-k009-public-feedback-boundary"],
        evidenceKey: "decision",
      },
      {
        key: "submit-review",
        label: "提交迁移复盘包",
        intent: "submit_postpublication_transfer_review",
        guidance: "提交影响解释、责任链、残余风险和至少两项可验证的下一轮改进假设。",
        knowledgeIds: ["village-postpublication-k008-impact-metrics", "village-postpublication-k010-transfer-hypothesis"],
        evidenceKey: "output",
      },
    ],
    primaryActionKey: "submit-review",
    event: {
      key: "impact-anomaly",
      triggerKind: "on_action",
      triggerKey: "align",
      studentBrief: "修订后短视频播放量下降，但人物认为语境更完整；旧链接仍在少量扩散。请解释口径、影响和残余风险。",
      hiddenPayload: "仿真复盘事件：不同版本统计窗口不能直接排名，旧链接传播需要跟踪但不等于新版本事实错误。",
      affectedAgentIds: ["agent-platform", "agent-evidence-assessor", "agent-learning"],
      candidateAgentIds: ["agent-platform", "agent-evidence-assessor", "agent-learning", "agent-chief", "agent-work-quality-assessor"],
      teacherApprovalRequired: true,
    },
    agentSelection: {
      affectedAgentIds: ["agent-platform", "agent-evidence-assessor", "agent-learning"],
      candidateAgentIds: ["agent-platform", "agent-evidence-assessor", "agent-learning", "agent-chief", "agent-work-quality-assessor"],
      selectWhen: "统计口径、人物反馈、版本传播和下一轮改进假设需要联合核对时选择必要智能体。",
      skipWhen: "候选只按播放量排行、把平台反馈当能力评分或无法提供新增证据时跳过。",
      maximumSelectedAgents: 3,
    },
    artifact: {
      label: "村超短视频语境回应迁移复盘包",
      format: "evidence_bundle",
      completionCriteria: ["三端数据口径和版本关系完整", "已解决与残余风险分开", "至少两项下一轮假设可验证"],
      finalCourseArtifact: true,
    },
    evidenceFocus: {
      source: "三端统计窗口、版本传播、人物反馈和旧链接状态。",
      decision: "对回应质量、残余风险和智能体实际贡献作出复核决定。",
      output: "含影响解释、责任链、残余风险和迁移假设的最终复盘包。",
    },
    rubricFocus: {
      accuracy: "统计口径、版本状态和人物反馈分别有依据，异常传播不被夸大或忽略。",
      reasoning: "回应质量不由单一播放量替代，保留已解决、未解决和下一步证据。",
      deliverable: "复盘包能指导下一轮编辑行动并明确验证条件。",
      transfer: "能将方法迁移到其他赛事争议、人物报道或公共服务短视频。",
      failClosedWhen: "用高触达宣称语境回应成功，或忽略旧链接、版本责任和统计窗口",
    },
    teacherGate: {
      label: "影响复盘与迁移结案门",
      trigger: "before_section_complete",
      checks: ["数据口径一致", "版本与反馈可追溯", "残余风险明确", "改进假设可验证"],
      minimumEvidenceCount: 3,
      rejectReturnsToActionKey: "review",
    },
    reflection: {
      prompt: "如果下一次质疑来自观众而非受访者，且完整采访支持现有剪辑，你会如何调整证据门、通知方式和平台回应？",
      targetContext: "其他县域赛事、公共文化活动和人物短视频",
      comparisonDimensions: ["质疑主体", "语境证据", "版本责任", "影响口径", "迁移条件"],
    },
  }),
] as const;

export const villagePostpublicationCourseRelease = createMigrationCourse({
  courseId: "course-village-super-postpublication-context",
  releaseId: "release-course-village-super-postpublication-context-1.0.0-content.1",
  version: "1.0.0-content.1",
  title: "村超短视频语境回应与多平台更正",
  summary: "从已发布的仿真村超短视频收到语境质疑开始，训练记者完成问题界定、完整采访核对、人物范围协商、跨平台回应、更正送审、影响跟踪与迁移复盘；所有人物、数据和传播反馈均为教学仿真。",
  durationMinutes: 150,
  courseOutcomes: [
    "能区分原句事实、剪辑语境、人物公开范围与平台反馈",
    "能保留旧版本并形成可执行的跨平台回应与更正链",
    "能根据统计口径、人物意见和版本责任解释回应影响",
    "能把发布后语境处理方法迁移到其他公共文化报道",
  ],
  sections,
  knowledgeRecords: villagePostpublicationKnowledgeRecords,
});

export const villagePostpublicationSectionCount =
  villagePostpublicationCourseRelease.sections.length;
export const villagePostpublicationKnowledgeRecordCount =
  villagePostpublicationCourseRelease.knowledgeRecords.length;
