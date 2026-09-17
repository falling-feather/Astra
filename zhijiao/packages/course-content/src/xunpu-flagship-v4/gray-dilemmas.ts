import type {
  XunpuGrayDilemmaV4,
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

/**
 * These dilemmas intentionally have no globally correct option. The engine
 * evaluates whether the learner names the trade-off, gathers the required
 * evidence and keeps the resulting promise—not whether one button was chosen.
 */
export const xunpuV4GrayDilemmas: XunpuGrayDilemmaV4[] = [
  {
    dilemmaId: "dilemma-commercial-access-vs-independence",
    title: "高质量商业素材与编辑独立",
    activationRules: [
      "merchant_material_inspected",
      "first_publication_window_remaining <= 35",
      "commercial_relationship_disclosure_status != complete",
    ],
    actorRefs: ["entity-shopkeeper", "entity-rights-contact", "entity-editor"],
    competingValues: ["作品完成度与现场时效", "编辑独立、许可完整和商业透明"],
    legitimateChoices: [
      {
        choiceRef: "choice-limited-license-with-disclosure",
        label: "限定许可后使用原片",
        professionalRationale: "核对作者、平台、期限和用途，公开素材提供关系，同时拒绝标题与首图交换。",
        requiredEvidenceKinds: ["authorization_record", "commercial_disclosure", "editorial_decision"],
        opportunityCosts: ["维护台账和到期处理", "商户仍可能对最终呈现提出异议"],
        stateDeltas: [
          delta("reach_potential", 7, "高质量素材提高视觉完成度"),
          delta("source_access", 4, "有限合作开放素材入口"),
          delta("deadline_pressure", 3, "核权和披露占用制作时间"),
        ],
      },
      {
        choiceRef: "choice-reference-only-self-shoot",
        label: "只把样片当线索并自行采集",
        professionalRationale: "现场查看样片以理解拍摄点，但不复制文件；另采公共环境和已同意人物素材。",
        requiredEvidenceKinds: ["field_observation", "asset_metadata", "decision_receipt"],
        opportunityCosts: ["画面质量与镜头数量可能下降", "自行采集增加时间压力"],
        stateDeltas: [
          delta("editorial_independence", 6, "报道资源不绑定商业条件"),
          delta("copyright_risk", -6, "未把商户原片带入公开时间线"),
          delta("deadline_pressure", 6, "重新采集压缩制作窗口"),
        ],
      },
      {
        choiceRef: "choice-decline-assets-interview-position",
        label: "拒绝素材，只保留有立场的商户采访",
        professionalRationale: "把吴姐作为具有商业利益的受访者呈现，使用项目自采安全画面并明确其观点边界。",
        requiredEvidenceKinds: ["confirmed_quote", "conflict_of_interest_note", "source_matrix"],
        opportunityCosts: ["失去现成高清近景", "必须用其他人物与来源平衡商业观点"],
        stateDeltas: [
          delta("editorial_independence", 9, "拒绝素材与标题交换"),
          delta("reach_potential", -3, "视觉吸引力可能下降"),
          delta("community_trust", 4, "商业立场被透明标注"),
        ],
      },
    ],
    prohibitedShortcuts: [
      "口头承诺标题或首图曝光但不留回执",
      "把水印、下载链接或商户自述当作完整许可",
      "隐藏素材提供关系后继续公开",
    ],
    artifactRefs: ["artifact-rights-ledger", "artifact-feature-story", "artifact-multiplatform-package"],
    noSingleCorrectAnswer: true,
  },
  {
    dilemmaId: "dilemma-postpublication-context-vs-stability",
    title: "发布后语境质疑与作品稳定性",
    activationRules: [
      "story_published",
      "community_context_challenge_received",
      "factual_error_status != confirmed",
    ],
    actorRefs: ["entity-community-source", "entity-inheritor", "entity-platform-duty", "entity-editor"],
    competingValues: ["尊重文化主体并降低持续伤害", "避免把有证据的编辑判断随意改成事实错误"],
    legitimateChoices: [
      {
        choiceRef: "choice-context-note-and-recut",
        label: "增加语境说明并调整剪辑",
        professionalRationale: "事实未错但剪辑造成误读时，保留原版、公开变更原因并补足劳动与社区语境。",
        requiredEvidenceKinds: ["community_feedback", "revision_diff", "editorial_rationale"],
        opportunityCosts: ["承认表达不足会降低短期传播稳定性", "重新剪辑占用更正窗口"],
        stateDeltas: [
          delta("community_trust", 10, "回应主体对语境呈现的合理质疑"),
          delta("reach_potential", -4, "克制重剪可能降低短期点击"),
          delta("correction_debt", -7, "表达债务被公开处理"),
        ],
      },
      {
        choiceRef: "choice-maintain-with-source-note",
        label: "维持判断并公开证据与回应",
        professionalRationale: "质疑与原始记录不符时，不迎合删改；公开引语确认、观察范围和判断理由，并保留申诉入口。",
        requiredEvidenceKinds: ["confirmed_quote", "source_comparison", "publication_receipt"],
        opportunityCosts: ["关系可能暂时紧张", "必须承担更高的证据说明责任"],
        stateDeltas: [
          delta("evidence_confidence", 7, "公开证据使判断可复核"),
          delta("public_trust", 5, "透明说明而非压制质疑"),
          delta("community_trust", -2, "不同主体对呈现仍可能保留分歧"),
        ],
      },
      {
        choiceRef: "choice-takedown-for-rights-or-harm",
        label: "权利或持续伤害成立时下架重建",
        professionalRationale: "若质疑同时暴露撤回、可识别私人信息或重大语境伤害，先阻断传播再重新进入教师门。",
        requiredEvidenceKinds: ["withdrawal_receipt", "harm_assessment", "revision_diff"],
        opportunityCosts: ["失去当前传播窗口", "需要重新完成权利和审核链"],
        stateDeltas: [
          delta("platform_risk", -12, "阻断高风险内容继续扩散"),
          delta("reach_potential", -12, "作品暂时下线"),
          delta("correction_debt", -12, "以重建处理重大债务"),
        ],
      },
    ],
    prohibitedShortcuts: [
      "删除评论或让智能体替学生承担责任",
      "不区分事实错误、语境争议与权利撤回而机械道歉",
      "静默覆盖公开版本或销毁原始质疑证据",
    ],
    artifactRefs: ["artifact-publication-correction-decision", "artifact-transfer-reflection"],
    noSingleCorrectAnswer: true,
  },
];
