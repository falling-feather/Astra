import type {
  XunpuPostPublicationResponseArcV4,
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

export const xunpuV4PostPublicationResponseArcs: XunpuPostPublicationResponseArcV4[] = [
  {
    responseArcId: "response-arc-community-context",
    title: "社区受访者核对引语与语境",
    triggerRule: "story_published && (confirmed_quote_used || community_subject_visible)",
    actorRefs: ["entity-community-source", "entity-inheritor"],
    publicOpening: "阿环和黄老师看过公开版本后，分别核对引语是否完整、技艺是否仍处于劳动与社区语境中。",
    outcomeVariants: [
      {
        variantRef: "community-recognizes-context",
        when: "quotes_confirmed && framing_not_exotic && demonstration_scope_respected",
        publicResponse: "受访者确认主要表达与约定一致，同时提醒不要把个人经验扩张成全社区结论。",
        studentResponseOptions: ["记录确认回执", "补一条代表性边界说明", "维持作品并开放后续反馈"],
        requiredEvidenceKinds: ["confirmed_quote", "publication_receipt"],
        stateDeltas: [
          delta("community_trust", 8, "公开版本兑现了采访承诺"),
          delta("public_trust", 4, "主体确认提高作品可追溯性"),
        ],
      },
      {
        variantRef: "community-challenges-context",
        when: "quote_words_accurate && edit_context_misleading",
        publicResponse: "引语文字没有捏造，但剪辑把劳动经验变成了单纯视觉奇观；受访者要求说明或重剪。",
        studentResponseOptions: ["公开补充语境并重剪", "用完整记录说明判断并邀请复核", "证实持续伤害时下架重建"],
        requiredEvidenceKinds: ["community_feedback", "confirmed_quote", "revision_diff"],
        stateDeltas: [
          delta("community_trust", -8, "表达语境与采访承诺出现偏差"),
          delta("correction_debt", 8, "作品产生待处理的语境债务"),
        ],
      },
    ],
    prohibitedShortcuts: ["截断反馈只保留表扬", "把语境争议伪装成已确认事实错误", "删除质疑后静默重剪"],
    followUpArtifactRefs: ["artifact-feature-story", "artifact-publication-correction-decision", "artifact-transfer-reflection"],
  },
  {
    responseArcId: "response-arc-rights-withdrawal",
    title: "公开范围与撤回在发布后生效",
    triggerRule: "story_published && identifiable_closeup_visible",
    actorRefs: ["entity-tourist", "entity-rights-contact", "entity-platform-duty"],
    publicOpening: "周女士发现课堂预览许可下的近景进入了公开视频，许老师和平台同时发出范围不一致提醒。",
    outcomeVariants: [
      {
        variantRef: "rights-scope-consistent",
        when: "public_scope_confirmed && consent_not_withdrawn && asset_lineage_complete",
        publicResponse: "人物、作者、平台、期限和派生版本均与回执一致，平台保留发布并记录到期检查。",
        studentResponseOptions: ["确认许可到期任务", "保留台账", "维持发布"],
        requiredEvidenceKinds: ["consent_receipt", "asset_metadata", "publication_receipt"],
        stateDeltas: [
          delta("copyright_risk", -8, "公开范围与回执一致"),
          delta("platform_risk", -4, "平台能够复算权利链"),
        ],
      },
      {
        variantRef: "rights-withdrawal-requires-version-response",
        when: "consent_withdrawn || public_scope_exceeds_receipt",
        publicResponse: "现有公开范围不能继续沿用；撤回时间、受影响版本和传播渠道必须进入处理单。",
        studentResponseOptions: ["替换镜头并公开版本说明", "裁掉可识别信息后重新送审", "下架并重新协商具体范围"],
        requiredEvidenceKinds: ["withdrawal_receipt", "revision_diff", "platform_receipt"],
        stateDeltas: [
          delta("copyright_risk", 18, "许可与公开版本不一致"),
          delta("platform_risk", 12, "平台需阻断或限流待处理版本"),
          delta("correction_debt", 10, "撤回产生可追溯版本债务"),
        ],
      },
    ],
    prohibitedShortcuts: ["删除撤回记录", "沿用旧口头同意覆盖新范围", "只换缩略图但保留公开视频近景"],
    followUpArtifactRefs: ["artifact-rights-ledger", "artifact-multiplatform-package", "artifact-publication-correction-decision"],
  },
  {
    responseArcId: "response-arc-source-challenge",
    title: "年份、统计时点与来源挑战",
    triggerRule: "story_published && (year_claim_used || visitor_statistic_used)",
    actorRefs: ["entity-researcher", "entity-public-liaison", "entity-platform-duty"],
    publicOpening: "研究者核对年份定位，公共联络员核对统计时点；平台要求学生解释哪些是历史材料、哪些是当日确认。",
    outcomeVariants: [
      {
        variantRef: "source-chain-holds",
        when: "primary_locator_present && wording_within_claim_boundary && statistic_time_window_visible",
        publicResponse: "公开表达与原始定位一致，平台保留作品并附加来源清单入口。",
        studentResponseOptions: ["公开来源清单", "维持判断并回应质疑", "补充统计时点说明"],
        requiredEvidenceKinds: ["source_comparison", "official_receipt", "publication_receipt"],
        stateDeltas: [
          delta("evidence_confidence", 8, "来源链经发布后复核仍成立"),
          delta("public_trust", 5, "判断理由可公开复算"),
        ],
      },
      {
        variantRef: "source-chain-breaks",
        when: "primary_locator_missing || wording_exceeds_claim_boundary || historical_stat_used_as_current",
        publicResponse: "现有表述超过来源可证明范围；平台要求在更正、删除主张或下架重建之间作出决定。",
        studentResponseOptions: ["公开更正并附新定位", "删除非必要主张", "事实基础不足时下架重建"],
        requiredEvidenceKinds: ["source_comparison", "revision_diff", "correction_receipt"],
        stateDeltas: [
          delta("evidence_confidence", -12, "核心主张缺少有效来源边界"),
          delta("correction_debt", 15, "已发布事实需要正式处理"),
          delta("platform_risk", 10, "平台命中事实可追溯风险"),
        ],
      },
    ],
    prohibitedShortcuts: ["让模型补造 locator", "把网页转引当原始来源", "用更新后的正确文本覆盖旧错误版本"],
    followUpArtifactRefs: ["artifact-source-matrix", "artifact-fact-check-sheet", "artifact-publication-correction-decision"],
  },
  {
    responseArcId: "response-arc-service-update",
    title: "传言澄清与连续服务更新",
    triggerRule: "story_published && closure_rumor_received",
    actorRefs: ["entity-public-liaison", "entity-editor", "entity-platform-duty"],
    publicOpening: "公共联络员返回新的限定口径，平台把首条快讯与更新时间线并排，要求处理前后信息差。",
    outcomeVariants: [
      {
        variantRef: "service-update-was-bounded",
        when: "known_unknown_separated && next_update_time_published && rumor_not_stated_as_fact",
        publicResponse: "首条服务信息没有越过证据边界；新回执作为连续更新追加，并保留原时间点。",
        studentResponseOptions: ["追加带时点的更新", "保留首条版本", "说明哪些信息仍待确认"],
        requiredEvidenceKinds: ["official_receipt", "publication_receipt", "update_log"],
        stateDeltas: [
          delta("public_safety_risk", -10, "连续更新没有传播未经确认的行动指令"),
          delta("public_trust", 8, "公众可以区分每个时间点的已知与未知"),
        ],
      },
      {
        variantRef: "service-update-overstated-rumor",
        when: "rumor_stated_as_fact || update_time_omitted",
        publicResponse: "旧快讯把传言写成确定事实，必须公开更正、给出确认时间线并继续发布已确认服务信息。",
        studentResponseOptions: ["公开更正并附时间线", "下架错误快讯并发布服务卡", "通知受影响渠道同步修订"],
        requiredEvidenceKinds: ["official_receipt", "correction_receipt", "channel_update_log"],
        stateDeltas: [
          delta("public_safety_risk", 20, "错误行动信息可能影响公众决策"),
          delta("correction_debt", 15, "跨渠道错误需要持续处理"),
          delta("public_trust", -10, "确定化传言损害公共可信"),
        ],
      },
    ],
    prohibitedShortcuts: ["只删除群聊截图而不更正文字", "使用未到达的官方口径", "把服务快讯的高触达当作事实准确"],
    followUpArtifactRefs: ["artifact-fact-check-sheet", "artifact-multiplatform-package", "artifact-publication-correction-decision"],
  },
];
