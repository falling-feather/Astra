import type {
  XunpuFlagshipRouteV4,
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

export const xunpuV4FlagshipRoutes: XunpuFlagshipRouteV4[] = [
  {
    routeId: "route-flagship-community-story",
    routeKind: "community_story",
    title: "社区主体深描",
    openingAction: "先到巷口说明身份、用途和公共空间边界。",
    requiredBeatRefs: ["beat-access", "beat-purpose", "beat-source-conflict", "beat-rights", "beat-publication", "beat-consequence"],
    requiredArtifactRefs: ["artifact-topic-brief", "artifact-interview-plan-log", "artifact-rights-ledger", "artifact-feature-story", "artifact-multiplatform-package"],
    requiredEvidenceKinds: ["npc_dialogue", "consent_receipt", "knowledge_locator", "media_derivation", "revision_diff"],
    opportunityCosts: ["官方当日数据可能来不及", "标题较克制", "现场采访消耗更多时间"],
    expectedStateDeltas: [
      delta("community_trust", 22, "多轮采访和范围确认"),
      delta("source_access", 18, "承诺履行开放更多材料"),
      delta("evidence_confidence", 12, "公开来源补足背景"),
      delta("reach_potential", 6, "人物叙事形成有限传播增益"),
      delta("deadline_pressure", 18, "深度采访和媒体制作耗时"),
      delta("copyright_risk", -8, "使用获准或替代素材"),
    ],
    successConditions: ["至少两轮开放追问", "每条引语有公开范围", "人物叙事与来源事实不混淆", "媒体素材权利清楚"],
    preservesInitialFailureEvidence: false,
  },
  {
    routeId: "route-flagship-evidence-explainer",
    routeKind: "evidence_explainer",
    title: "证据解释型报道",
    openingAction: "先建立 claim board 并比较原始来源和转引链。",
    requiredBeatRefs: ["beat-source-conflict", "beat-data-wait", "beat-purpose", "beat-precheck", "beat-publication", "beat-consequence"],
    requiredArtifactRefs: ["artifact-source-matrix", "artifact-fact-check-sheet", "artifact-feature-story", "artifact-multiplatform-package"],
    requiredEvidenceKinds: ["knowledge_locator", "source_comparison", "claim_status_change", "expert_dialogue", "revision_diff"],
    opportunityCosts: ["人物沉浸感较弱", "只查资料会造成采访维度不足", "回溯原始来源消耗时间"],
    expectedStateDeltas: [
      delta("evidence_confidence", 30, "关键主张回到原始定位"),
      delta("public_trust", 12, "作品透明说明证据边界"),
      delta("community_trust", 8, "避免起源和文化绝对化"),
      delta("reach_potential", 4, "解释型内容传播增益有限"),
      delta("deadline_pressure", 14, "来源回溯和事实卡制作耗时"),
    ],
    successConditions: ["关键 claim 都有来源定位", "冲突来源没有被平均", "舍弃内容有理由", "至少一段现场采访补充"],
    preservesInitialFailureEvidence: false,
  },
  {
    routeId: "route-flagship-service-update",
    routeKind: "service_update",
    title: "现场服务与连续更新",
    openingAction: "先观察公共服务问题并建立联络员通道。",
    requiredBeatRefs: ["beat-access", "beat-data-wait", "beat-rumor", "beat-deadline", "beat-publication", "beat-consequence"],
    requiredArtifactRefs: ["artifact-source-matrix", "artifact-fact-check-sheet", "artifact-multiplatform-package", "artifact-publication-correction-decision"],
    requiredEvidenceKinds: ["official_receipt", "rumor_gap_record", "timestamped_update", "publication_receipt", "version_diff"],
    opportunityCosts: ["首篇专题深度较低", "多版本管理压力高", "画面精致度可能受限"],
    expectedStateDeltas: [
      delta("public_safety_risk", -18, "传言未被写成事实"),
      delta("public_trust", 18, "已知、未知和更新时间明确"),
      delta("reach_potential", 14, "服务信息具有即时价值"),
      delta("evidence_confidence", 15, "联络员回执支持限定表达"),
      delta("deadline_pressure", 24, "连续更新与专题并行"),
    ],
    successConditions: ["每次更新有时点", "已知与未知分开", "传言状态可追踪", "深度专题和快讯不互相污染"],
    preservesInitialFailureEvidence: false,
  },
  {
    routeId: "route-flagship-traffic-recovery",
    routeKind: "traffic_recovery",
    title: "流量捷径后的专业恢复",
    openingAction: "接受高吸引素材和标题交换，并把未核主张放入 R1。",
    requiredBeatRefs: ["beat-commercial", "beat-source-conflict", "beat-rights", "beat-precheck", "beat-recovery", "beat-transfer"],
    requiredArtifactRefs: ["artifact-rights-ledger", "artifact-fact-check-sheet", "artifact-feature-story", "artifact-publication-correction-decision", "artifact-transfer-reflection"],
    requiredEvidenceKinds: ["initial_error_trace", "platform_rejection", "consent_withdrawal", "revision_diff", "correction_receipt"],
    opportunityCosts: ["失去首轮窗口", "初始判断永久进入评价证据", "社区信任不能完全恢复"],
    expectedStateDeltas: [
      delta("editorial_independence", -22, "初始接受标题交换"),
      delta("copyright_risk", 25, "初始素材许可不足"),
      delta("correction_debt", 24, "R1 含事实和权利债务"),
      delta("platform_risk", 18, "平台预检退回"),
      delta("community_trust", -12, "社区质疑猎奇框架"),
      delta("reach_potential", 24, "高吸引素材带来短期传播潜力"),
    ],
    successConditions: ["保留 R1 和初始错误", "披露商业交换", "移除无来源数字", "替换近景", "形成 R2 或公开更正"],
    preservesInitialFailureEvidence: true,
  },
];
