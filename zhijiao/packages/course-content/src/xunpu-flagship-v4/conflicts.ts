import type {
  XunpuConflictDomainV4,
  XunpuWorldStateDeltaV4,
  XunpuWorldVariableId,
} from "./types.js";

function delta(
  variableId: XunpuWorldVariableId,
  value: number,
  rationale: string,
): XunpuWorldStateDeltaV4 {
  return { variableId, delta: value, rationale };
}

export const xunpuV4ConflictDomains: XunpuConflictDomainV4[] = [
  {
    conflictDomainId: "conflict-editorial-framing",
    title: "选题、公共价值与流量压力",
    activationRules: ["session_started", "headline_contains_unverifiable_absolute_claim"],
    proactiveTriggerKinds: ["npc"],
    actorRefs: ["entity-editor", "entity-community-source", "entity-inheritor"],
    objectRefs: ["obj-editor-brief", "obj-story-workbench"],
    availableIntents: ["observe", "ask", "probe", "inspect", "draft", "save_revision", "request_advice"],
    legalRoutes: [
      {
        routeId: "route-frame-community-value",
        label: "社区主体与劳动",
        steps: ["说明公共价值", "采访社区主体", "用公开来源补背景"],
        tradeoff: "关系与主体性更强，时间成本更高。",
        stateDeltas: [
          delta("community_trust", 8, "报道角度不把社区简化为视觉对象"),
          delta("reach_potential", 2, "人物叙事带来有限传播增益"),
          delta("deadline_pressure", 2, "现场采访消耗时间"),
        ],
      },
      {
        routeId: "route-frame-evidence-explainer",
        label: "事实边界解释",
        steps: ["列出争议主张", "比较原始来源", "设计解释型结构"],
        tradeoff: "事实稳定，但人物沉浸感较弱。",
        stateDeltas: [
          delta("evidence_confidence", 6, "先确定可证明内容"),
          delta("reach_potential", 1, "解释型内容传播潜力中性"),
        ],
      },
      {
        routeId: "route-frame-service-use",
        label: "游客服务与拍摄边界",
        steps: ["观察现场问题", "确认公共服务信息", "形成可执行指引"],
        tradeoff: "公共用途明确，但文化深描需要后续补充。",
        stateDeltas: [
          delta("public_trust", 5, "作品回应具体公共问题"),
          delta("reach_potential", 3, "服务信息具有即时传播价值"),
        ],
      },
    ],
    riskyActions: [{
      riskyActionId: "risk-frame-unverifiable-spectacle",
      description: "使用全网最神秘、千年不变等无法核验的绝对化框架。",
      stateDeltas: [
        delta("platform_risk", 10, "绝对化标题触发平台预检"),
        delta("correction_debt", 8, "作品积累无法证明的主张"),
        delta("community_trust", -8, "社区感到被猎奇化"),
      ],
      formalWriteAllowed: false,
    }],
    recoveryConditions: ["发布前重写角度", "发布后保留旧版并说明修订理由"],
    artifactRefs: ["artifact-topic-brief", "artifact-feature-story"],
  },
  {
    conflictDomainId: "conflict-interview-interest",
    title: "采访、私人边界与商业利益",
    activationRules: ["student_enters_gate", "first_interview_started", "merchant_material_inspected"],
    proactiveTriggerKinds: ["npc"],
    actorRefs: ["entity-gatekeeper", "entity-community-source", "entity-shopkeeper"],
    objectRefs: ["obj-camera-roll", "obj-audio-recorder", "obj-consent-ledger"],
    availableIntents: ["observe", "ask", "probe", "negotiate", "record", "annotate", "replace"],
    legalRoutes: [
      {
        routeId: "route-interview-consent-first",
        label: "先确认身份、用途与公开范围",
        steps: ["说明记者身份", "说明作品和平台", "取得同意后录制", "复述确认引语"],
        tradeoff: "耗时增加，但可获得更深采访。",
        stateDeltas: [
          delta("source_access", 10, "专业沟通开放更多采访入口"),
          delta("community_trust", 10, "受访者能够控制公开边界"),
          delta("deadline_pressure", 2, "确认过程消耗时间"),
        ],
      },
      {
        routeId: "route-interview-public-space",
        label: "只采公共空间与非识别信息",
        steps: ["限定拍摄区域", "使用环境和手部画面", "不进入家庭信息"],
        tradeoff: "风险低，但人物深度和近景吸引力较弱。",
        stateDeltas: [
          delta("copyright_risk", -6, "减少可识别人物素材"),
          delta("reach_potential", -2, "缺少高吸引近景"),
        ],
      },
      {
        routeId: "route-commercial-disclosure",
        label: "有限素材合作并披露",
        steps: ["核对素材作者", "拒绝标题交换", "约定平台和期限", "披露提供方"],
        tradeoff: "获得高质量素材，但需持续维护编辑独立。",
        stateDeltas: [
          delta("source_access", 6, "获得有限范围素材"),
          delta("editorial_independence", 4, "明确拒绝标题交换"),
          delta("copyright_risk", -4, "许可范围进入台账"),
        ],
      },
    ],
    riskyActions: [{
      riskyActionId: "risk-interview-deception",
      description: "假装游客、偷录、进入私人空间或接受标题植入。",
      stateDeltas: [
        delta("community_trust", -18, "身份和边界承诺被破坏"),
        delta("source_access", -12, "采访入口关闭"),
        delta("editorial_independence", -20, "商业条件改变编辑选择"),
      ],
      formalWriteAllowed: false,
    }],
    recoveryConditions: ["道歉并删除越界素材", "重新说明用途和边界", "披露或拒绝商业交换"],
    artifactRefs: ["artifact-interview-plan-log", "artifact-rights-ledger", "artifact-topic-brief"],
  },
  {
    conflictDomainId: "conflict-fact-source",
    title: "年份、统计时点与来源层级",
    activationRules: ["year_claim_added", "visitor_number_added", "origin_claim_added"],
    proactiveTriggerKinds: ["threshold", "npc"],
    actorRefs: ["entity-researcher", "entity-public-liaison", "entity-editor"],
    objectRefs: ["obj-source-packet-a", "obj-source-packet-b", "obj-claim-board"],
    availableIntents: ["inspect", "compare", "cite", "ask", "probe", "request_evidence", "wait", "draft"],
    legalRoutes: [
      {
        routeId: "route-primary-source",
        label: "回到原始来源",
        steps: ["区分转引", "定位地方标准和官方名录", "记录冲突", "修订主张"],
        tradeoff: "置信度高，但消耗核验时间。",
        stateDeltas: [
          delta("evidence_confidence", 14, "主张由原始定位支持"),
          delta("deadline_pressure", 4, "回溯来源消耗时间"),
        ],
      },
      {
        routeId: "route-bounded-wording",
        label: "限定来源和时点",
        steps: ["标记无法完全核验", "写明发布方与年份", "避免外推"],
        tradeoff: "保住时效，但作品表达更谨慎。",
        stateDeltas: [
          delta("evidence_confidence", 6, "未知被透明表达"),
          delta("deadline_pressure", 1, "限定措辞返工较少"),
        ],
      },
      {
        routeId: "route-remove-claim",
        label: "删除非必要高风险主张",
        steps: ["判断主张是否必要", "移除无来源数字", "调整叙事结构"],
        tradeoff: "传播吸引力略降，但减少债务。",
        stateDeltas: [
          delta("reach_potential", -2, "删除吸引眼球数字"),
          delta("correction_debt", -6, "移除无法证明内容"),
        ],
      },
    ],
    riskyActions: [{
      riskyActionId: "risk-source-fabrication",
      description: "把转引当原始来源、拼接不同年份或让 AI 补齐缺失事实。",
      stateDeltas: [
        delta("correction_debt", 15, "作品产生虚构或失真的核心主张"),
        delta("evidence_confidence", -14, "证据链失效"),
        delta("platform_risk", 10, "事实风险进入发布预检"),
      ],
      formalWriteAllowed: false,
    }],
    recoveryConditions: ["补齐原始定位并保存修订差异", "已发布时公开更正"],
    artifactRefs: ["artifact-source-matrix", "artifact-fact-check-sheet", "artifact-feature-story"],
  },
  {
    conflictDomainId: "conflict-material-rights",
    title: "素材、肖像、声音与生成标识",
    activationRules: ["closeup_added_to_public_cut", "shop_asset_added", "ai_derivative_added", "consent_withdrawn"],
    proactiveTriggerKinds: ["npc", "threshold"],
    actorRefs: ["entity-tourist", "entity-shopkeeper", "entity-rights-contact", "entity-platform-duty"],
    objectRefs: ["obj-camera-roll", "obj-audio-recorder", "obj-video-bin", "obj-consent-ledger"],
    availableIntents: ["inspect", "compare", "negotiate", "annotate", "replace", "request_evidence", "save_revision"],
    legalRoutes: [
      {
        routeId: "route-replace-media",
        label: "替换为安全环境或手部素材",
        steps: ["定位受影响镜头", "选择替代素材", "更新字幕和台账", "保存新版本"],
        tradeoff: "损失近景吸引力并消耗返工时间。",
        stateDeltas: [
          delta("copyright_risk", -12, "移除权利范围不明素材"),
          delta("reach_potential", -3, "替代画面吸引力较弱"),
          delta("deadline_pressure", 4, "媒体返工消耗时间"),
        ],
      },
      {
        routeId: "route-narrow-license",
        label: "缩小用途和平台",
        steps: ["核对现有许可", "只保留许可内渠道", "披露使用范围"],
        tradeoff: "作品形态和分发范围受限。",
        stateDeltas: [
          delta("copyright_risk", -8, "作品回到已有许可范围"),
          delta("reach_potential", -5, "减少发布渠道"),
        ],
      },
      {
        routeId: "route-renegotiate-consent",
        label: "展示最终语境后重新协商",
        steps: ["发送成片预览", "说明平台和期限", "记录同意或拒绝", "同步作品"],
        tradeoff: "存在失败和错过窗口的可能。",
        stateDeltas: [
          delta("copyright_risk", -10, "成功时获得具体回执"),
          delta("deadline_pressure", 5, "等待回复消耗时间"),
        ],
      },
    ],
    riskyActions: [{
      riskyActionId: "risk-rights-assumption",
      description: "以水印、下载链接或新闻用途代替作者和人物许可。",
      stateDeltas: [
        delta("copyright_risk", 20, "权利范围没有证明"),
        delta("platform_risk", 12, "平台可能退回或受理投诉"),
        delta("correction_debt", 10, "作品发布后需要替换"),
      ],
      formalWriteAllowed: false,
    }],
    recoveryConditions: ["立即下线或阻断发布", "替换素材", "更新台账并保留撤回时间"],
    artifactRefs: ["artifact-rights-ledger", "artifact-multiplatform-package", "artifact-publication-correction-decision"],
  },
  {
    conflictDomainId: "conflict-breaking-safety",
    title: "突发传言、公共安全与时效",
    activationRules: ["world_minute >= 29", "rumor_used_in_draft", "public_safety_risk >= 35"],
    proactiveTriggerKinds: ["clock", "threshold", "npc"],
    actorRefs: ["entity-public-liaison", "entity-editor", "entity-platform-duty"],
    objectRefs: ["obj-groupchat-rumor", "obj-source-packet-b", "obj-publication-window"],
    availableIntents: ["inspect", "compare", "ask", "wait", "escalate", "draft", "submit_gate"],
    legalRoutes: [
      {
        routeId: "route-verify-breaking",
        label: "等待官方回执",
        steps: ["记录传言缺口", "联系联络员", "等待确认", "更新事实卡"],
        tradeoff: "降低风险但可能错过服务窗口。",
        stateDeltas: [
          delta("public_safety_risk", -10, "正式回执替代传言"),
          delta("deadline_pressure", 5, "等待核验消耗时间"),
        ],
      },
      {
        routeId: "route-limited-service-update",
        label: "只发布已确认服务信息",
        steps: ["分开已知与未知", "标明时点", "给下次更新时间", "继续核验"],
        tradeoff: "快速服务公众，但不能使用高吸引未核消息。",
        stateDeltas: [
          delta("public_trust", 5, "不确定性被透明表达"),
          delta("reach_potential", 3, "服务信息具有即时价值"),
          delta("public_safety_risk", -5, "未传播传言结论"),
        ],
      },
      {
        routeId: "route-refuse-rumor",
        label: "拒绝公开传言",
        steps: ["说明证据缺口", "保留内部核验", "转向深度内容"],
        tradeoff: "公共风险最低，短期触达较弱。",
        stateDeltas: [
          delta("public_safety_risk", -12, "传言未进入公开传播"),
          delta("reach_potential", -4, "失去突发流量"),
        ],
      },
    ],
    riskyActions: [{
      riskyActionId: "risk-publish-rumor-as-fact",
      description: "把无主体群聊截图直接写成巷口已经封闭。",
      stateDeltas: [
        delta("public_safety_risk", 25, "未核消息可能误导公众行动"),
        delta("correction_debt", 18, "安全事实需要公开更正"),
        delta("platform_risk", 14, "平台触发事实风险"),
      ],
      formalWriteAllowed: false,
    }],
    recoveryConditions: ["公开更正并给确认时间线", "保留旧版本", "继续发布已确认服务信息"],
    artifactRefs: ["artifact-fact-check-sheet", "artifact-multiplatform-package", "artifact-publication-correction-decision"],
  },
  {
    conflictDomainId: "conflict-post-publication",
    title: "发布后反馈、更正与责任",
    activationRules: ["story_published", "platform_flag_created", "community_challenge_received", "rights_complaint_received"],
    proactiveTriggerKinds: ["npc", "threshold"],
    actorRefs: ["entity-platform-duty", "entity-community-source", "entity-tourist", "entity-editor"],
    objectRefs: ["obj-story-workbench", "obj-consent-ledger", "obj-claim-board"],
    availableIntents: ["inspect", "compare", "ask", "draft", "save_revision", "correct", "publish", "escalate"],
    legalRoutes: [
      {
        routeId: "route-public-correction",
        label: "公开更正并解释",
        steps: ["定位错误版本", "补充证据", "发布更正", "通知受影响人物"],
        tradeoff: "短期暴露失误，但有机会恢复长期信任。",
        stateDeltas: [
          delta("reach_potential", -4, "更正影响短期传播"),
          delta("public_trust", 10, "透明承担责任恢复信任"),
          delta("correction_debt", -15, "完成主要债务处理"),
        ],
      },
      {
        routeId: "route-takedown-rebuild",
        label: "下架并重建",
        steps: ["阻断传播", "通知相关人物", "重做作品", "重新进入发布门"],
        tradeoff: "损失时效和触达，但适用于不可逆高风险。",
        stateDeltas: [
          delta("reach_potential", -12, "作品暂时下架"),
          delta("platform_risk", -12, "阻断继续传播"),
          delta("correction_debt", -20, "重建解决主要债务"),
        ],
      },
      {
        routeId: "route-defend-with-evidence",
        label: "保留作品并公开证据",
        steps: ["核对质疑", "发布来源清单", "解释不修改理由"],
        tradeoff: "证据充分可维护判断；证据不足会放大反噬。",
        stateDeltas: [
          delta("public_trust", 6, "充分证据支持透明回应"),
          delta("evidence_confidence", 5, "公开来源强化可核验性"),
        ],
      },
    ],
    riskyActions: [{
      riskyActionId: "risk-silent-edit-or-blame-ai",
      description: "删除评论、静默覆盖或把错误归因给 AI。",
      stateDeltas: [
        delta("platform_risk", 18, "版本责任链被破坏"),
        delta("public_trust", -15, "公众无法识别真实修订"),
        delta("correction_debt", 12, "原错误未被正式处理"),
      ],
      formalWriteAllowed: false,
    }],
    recoveryConditions: ["保留版本链", "说明责任和再次发布条件", "公开更正或下架重建"],
    artifactRefs: ["artifact-feature-story", "artifact-publication-correction-decision", "artifact-transfer-reflection"],
  },
];
