import {
  SimulationAgentTemplateV3Schema,
  SimulationAgentTemplateV3SchemaVersion,
  type SimulationAgentExecutorV3,
  type SimulationAgentTemplateV3,
} from "@ronggang/agent-runtime";
import {
  emptySimulationRunEffects,
  type SimulationRunEffects,
} from "@ronggang/world-core";
import {
  parseXunpuSafeActionSignalV3,
  type XunpuActionQualityV3,
  type XunpuSafeActionSignalV3,
} from "./xunpu-action-policy-v3.js";

type ObjectType = SimulationAgentTemplateV3["affectedObjectSelectors"][number]["objectType"];

function template(input: {
  id: string;
  agentId?: string;
  role: string;
  displayName: string;
  responsibility: string;
  groupId: string;
  contributionKind: SimulationAgentTemplateV3["contributionKind"];
  eventTypes: string[];
  selectors?: Array<{ objectType: ObjectType; objectId?: string }>;
  priority: number;
}): SimulationAgentTemplateV3 {
  return SimulationAgentTemplateV3Schema.parse({
    schemaVersion: SimulationAgentTemplateV3SchemaVersion,
    agentTemplateId: input.id,
    agentId: input.agentId ?? input.id.replace("agent-template-", "agent-"),
    professionalRoleId: input.role,
    displayName: input.displayName,
    responsibility: input.responsibility,
    groupId: input.groupId,
    contributionKind: input.contributionKind,
    subscribedEventTypes: input.eventTypes,
    affectedObjectSelectors: (input.selectors ?? []).map((selector) => ({
      objectType: selector.objectType,
      objectId: selector.objectId ?? null,
    })),
    disclosurePolicyRef: `disclosure-${input.role}`,
    toolCapabilityRefs: [`tool-${input.role}-observe`, `tool-${input.role}-propose`],
    initialGoals: [{
      goalId: `goal-${input.role}`,
      description: input.responsibility,
      priority: input.priority,
    }],
    initialActionBudget: 12,
    dispatchPriority: input.priority,
    enabled: true,
    available: true,
  });
}

/**
 * The six-group/fourteen-agent cast for the Xunpu flagship world. Only the
 * templates named by a released event can be dispatched; the rest still
 * receive an explicit skipped reason in the administrator/teacher projection.
 */
export function buildXunpuSimulationAgentTemplatesV3(): SimulationAgentTemplateV3[] {
  const studentEvents = [
    "student_asks_gatekeeper",
    "student_inspects_source",
    "student_submits_story",
  ];
  const pressureEvents = [
    "shopkeeper_requests_placement",
    "tourist_withdraws_consent",
    "system_clock_tick",
  ];
  return [
    template({
      id: "agent-template-teaching-director",
      role: "teaching_director",
      displayName: "教学导演",
      responsibility: "依据挑战等级与学生成长证据控制教学压力，不直接改写世界。",
      groupId: "teaching_direction",
      contributionKind: "professional_advisor",
      eventTypes: ["teacher_adjusts_pressure", ...studentEvents],
      priority: 62,
    }),
    template({
      id: "agent-template-scene-director",
      role: "scene_director",
      displayName: "情境导演",
      responsibility: "监测现场节奏并提出下一波冲突候选，不绕过世界规则。",
      groupId: "teaching_direction",
      contributionKind: "world_actor",
      eventTypes: pressureEvents,
      priority: 64,
    }),
    template({
      id: "agent-template-gatekeeper",
      role: "community_gatekeeper",
      displayName: "林师傅·社区门卫",
      responsibility: "维护社区准入、居民隐私与现场秩序，并按学生沟通质量作出回应。",
      groupId: "field_npc",
      contributionKind: "world_actor",
      eventTypes: ["student_asks_gatekeeper"],
      selectors: [{ objectType: "entity", objectId: "entity-gatekeeper" }],
      priority: 92,
    }),
    template({
      id: "agent-template-inheritor",
      role: "heritage_inheritor",
      displayName: "黄老师·簪花围传承人",
      responsibility: "以传承人立场回答采访、保留文化语境并纠正猎奇叙事。",
      groupId: "field_npc",
      contributionKind: "world_actor",
      eventTypes: ["student_asks_inheritor", "student_inspects_source"],
      selectors: [{ objectType: "entity", objectId: "entity-inheritor" }],
      priority: 84,
    }),
    template({
      id: "agent-template-tourist",
      role: "tourist_source",
      displayName: "周女士·游客",
      responsibility: "根据肖像授权、体验与安全感动态调整是否接受采访和素材使用。",
      groupId: "field_npc",
      contributionKind: "world_actor",
      eventTypes: ["tourist_withdraws_consent"],
      selectors: [{ objectType: "entity", objectId: "entity-tourist" }],
      priority: 88,
    }),
    template({
      id: "agent-template-shopkeeper",
      role: "travel_photo_shopkeeper",
      displayName: "吴姐·旅拍商户",
      responsibility: "追求商业曝光并与记者协商素材、采访和植入边界。",
      groupId: "field_npc",
      contributionKind: "world_actor",
      eventTypes: ["shopkeeper_requests_placement"],
      selectors: [{ objectType: "entity", objectId: "entity-shopkeeper" }],
      priority: 82,
    }),
    template({
      id: "agent-template-editor",
      role: "responsible_editor",
      displayName: "陈编辑·责任编辑",
      responsibility: "平衡截稿、证据、叙事与商业边界，只提出专业建议。",
      groupId: "editorial_collaboration",
      contributionKind: "professional_advisor",
      eventTypes: [
        "shopkeeper_requests_placement",
        "system_clock_tick",
        "teacher_adjusts_pressure",
      ],
      selectors: [{ objectType: "world_variable" }],
      priority: 94,
    }),
    template({
      id: "agent-template-fact-checker",
      role: "fact_checker",
      displayName: "事实核查员",
      responsibility: "对冲突主张执行最小必要核验，并要求可定位的公开依据。",
      groupId: "verification_governance",
      contributionKind: "professional_advisor",
      eventTypes: ["student_inspects_source"],
      selectors: [{ objectType: "world_variable", objectId: "evidence_confidence" }],
      priority: 96,
    }),
    template({
      id: "agent-template-governance",
      role: "copyright_governance",
      displayName: "版权与肖像治理员",
      responsibility: "识别授权撤回、版权与肖像风险，必要时触发教师门。",
      groupId: "verification_governance",
      contributionKind: "professional_advisor",
      eventTypes: ["tourist_withdraws_consent", "student_submits_story"],
      selectors: [{ objectType: "world_variable", objectId: "copyright_risk" }],
      priority: 98,
    }),
    template({
      id: "agent-template-content-safety",
      role: "content_safety",
      displayName: "内容安全审核员",
      responsibility: "审查隐私、歧视、误导与公共安全风险，不替代教师批准。",
      groupId: "verification_governance",
      contributionKind: "professional_advisor",
      eventTypes: ["student_submits_story"],
      selectors: [{ objectType: "world_variable", objectId: "public_trust" }],
      priority: 91,
    }),
    template({
      id: "agent-template-platform-rule",
      role: "platform_rule_governance",
      displayName: "平台规则审核员",
      responsibility: "核对标题、标识、素材授权和分发规则，输出可追溯风险建议。",
      groupId: "operations_distribution",
      contributionKind: "professional_advisor",
      eventTypes: ["student_submits_story"],
      selectors: [{ objectType: "entity", objectId: "entity-platform" }],
      priority: 89,
    }),
    template({
      id: "agent-template-platform",
      role: "platform_operator",
      displayName: "融媒体平台值班员",
      responsibility: "模拟真实发布窗口、退回和多端分发回执。",
      groupId: "operations_distribution",
      contributionKind: "world_actor",
      eventTypes: ["student_submits_story"],
      selectors: [{ objectType: "entity", objectId: "entity-platform" }],
      priority: 93,
    }),
    template({
      id: "agent-template-competency-assessor",
      role: "competency_assessor",
      displayName: "岗位能力评估员",
      responsibility: "从真实行为证据中提取能力表现，不使用最终印象代替过程证据。",
      groupId: "assessment_growth",
      contributionKind: "professional_advisor",
      eventTypes: studentEvents,
      priority: 54,
    }),
    template({
      id: "agent-template-learner-twin",
      role: "learner_twin_modeler",
      displayName: "学习者孪生建模员",
      responsibility: "更新学生策略、压力反应与成长假设，只为后续难度分配提供候选。",
      groupId: "assessment_growth",
      contributionKind: "professional_advisor",
      eventTypes: [...studentEvents, ...pressureEvents],
      priority: 52,
    }),
  ];
}

/**
 * R2 keeps the architecture at six groups and fourteen agents while changing
 * the field cast from the R1 proof slice to the complete newsroom world. NPC
 * entities remain world objects; these templates are the authorized cognitive
 * and professional roles that may observe them and propose consequences.
 */
export function buildXunpuSimulationAgentTemplatesV3R2(): SimulationAgentTemplateV3[] {
  const editorialEvents = [
    "student_observes_editorial_brief",
    "student_resolves_commercial_exchange",
    "student_drafts_story",
    "student_submits_story",
    "platform_flags_story",
    "community_challenges_framing",
    "student_submits_correction",
    "system_clock_tick",
    "student_waits_for_verification",
  ];
  const assessmentEvents = [
    "student_observes_editorial_brief",
    "student_asks_community_source",
    "student_drafts_story",
    "student_submits_correction",
    "teacher_records_final_assessment",
  ];
  return [
    template({
      id: "agent-template-teaching-director",
      role: "teaching_director",
      displayName: "教学导演",
      responsibility: "依据挑战等级、当前支架和真实行为轨迹控制教学压力，不替学生完成岗位工作。",
      groupId: "teaching_direction",
      contributionKind: "professional_advisor",
      eventTypes: ["teacher_reviews_privacy", ...assessmentEvents],
      priority: 62,
    }),
    template({
      id: "agent-template-scene-director",
      role: "scene_director",
      displayName: "情境导演",
      responsibility: "根据虚拟时间、冲突阈值和人物目标提出下一波世界事件候选。",
      groupId: "teaching_direction",
      contributionKind: "world_actor",
      eventTypes: ["system_clock_tick", "safety_rumor_emerges"],
      priority: 64,
    }),
    template({
      id: "agent-template-community-source",
      role: "community_source",
      displayName: "阿环·社区信源",
      responsibility: "维护社区主体、公开范围和私人边界，并依据学生沟通行为调整信任。",
      groupId: "field_npc",
      contributionKind: "world_actor",
      eventTypes: [
        "student_asks_gatekeeper",
        "student_asks_community_source",
        "community_challenges_framing",
      ],
      priority: 92,
    }),
    template({
      id: "agent-template-researcher",
      role: "heritage_researcher",
      displayName: "陈老师·非遗研究者",
      responsibility: "区分名录、标准、口述和推测，只把可定位材料提升为确定事实。",
      groupId: "field_npc",
      contributionKind: "world_actor",
      eventTypes: [
        "student_asks_inheritor",
        "student_inspects_source",
        "student_probes_researcher",
        "student_compares_sources",
      ],
      priority: 88,
    }),
    template({
      id: "agent-template-shopkeeper",
      role: "merchant_partner",
      displayName: "吴姐·旅拍商户",
      responsibility: "以商业主体目标协商素材和曝光条件，并保留自身利益立场。",
      groupId: "field_npc",
      contributionKind: "world_actor",
      eventTypes: [
        "shopkeeper_requests_placement",
        "student_resolves_commercial_exchange",
      ],
      priority: 86,
    }),
    template({
      id: "agent-template-public-liaison",
      role: "public_liaison",
      displayName: "蔡主任·公共联络人",
      responsibility: "只确认公开材料、统计时点和下一更新窗口，不提前泄露未完成汇总。",
      groupId: "field_npc",
      contributionKind: "world_actor",
      eventTypes: ["student_requests_official_data", "student_submits_limited_alert"],
      priority: 87,
    }),
    template({
      id: "agent-template-rights-contact",
      role: "rights_contact",
      displayName: "许老师·权利联络人",
      responsibility: "核对作者、肖像、用途、期限和平台许可范围，并主动报告撤回或缺口。",
      groupId: "field_npc",
      contributionKind: "world_actor",
      eventTypes: [
        "tourist_withdraws_consent",
        "student_inspects_rights",
        "rights_contact_flags_scope",
      ],
      priority: 90,
    }),
    template({
      id: "agent-template-editor",
      role: "responsible_editor",
      displayName: "陈编辑·责任编辑",
      responsibility: "平衡截稿、事实、叙事和独立性，只审稿与设门，不替学生写稿。",
      groupId: "editorial_collaboration",
      contributionKind: "professional_advisor",
      eventTypes: editorialEvents,
      priority: 96,
    }),
    template({
      id: "agent-template-fact-checker",
      role: "fact_checker",
      displayName: "事实核查员",
      responsibility: "比较原始来源、转引、时点和限定措辞，要求每项关键主张可定位。",
      groupId: "verification_governance",
      contributionKind: "professional_advisor",
      eventTypes: [
        "student_inspects_source",
        "student_probes_researcher",
        "student_compares_sources",
        "student_requests_official_data",
        "safety_rumor_emerges",
      ],
      priority: 98,
    }),
    template({
      id: "agent-template-governance",
      role: "copyright_governance",
      displayName: "版权与肖像治理员",
      responsibility: "校验素材权利、身份隐私、撤回和替代方案，高风险只提出教师门候选。",
      groupId: "verification_governance",
      contributionKind: "professional_advisor",
      eventTypes: [
        "tourist_withdraws_consent",
        "student_inspects_rights",
        "rights_contact_flags_scope",
        "teacher_reviews_privacy",
        "student_submits_story",
      ],
      priority: 99,
    }),
    template({
      id: "agent-template-content-safety",
      role: "content_safety",
      displayName: "内容安全审核员",
      responsibility: "审查公共安全、误导、污名化和未经确认的高风险表述。",
      groupId: "verification_governance",
      contributionKind: "professional_advisor",
      eventTypes: ["safety_rumor_emerges", "student_submits_limited_alert", "student_submits_story"],
      priority: 94,
    }),
    template({
      id: "agent-template-platform",
      role: "platform_operator",
      displayName: "乔安·融媒体平台值守",
      responsibility: "合并执行平台规则检查、受控发布、退回和公开更正回执。",
      groupId: "operations_distribution",
      contributionKind: "world_actor",
      eventTypes: [
        "student_submits_limited_alert",
        "student_submits_story",
        "platform_flags_story",
        "student_submits_correction",
      ],
      priority: 95,
    }),
    template({
      id: "agent-template-competency-assessor",
      role: "competency_assessor",
      displayName: "岗位能力证据员",
      responsibility: "只从真实行为、作品版本、教师决定与世界后果提取能力证据候选。",
      groupId: "assessment_growth",
      contributionKind: "professional_advisor",
      eventTypes: assessmentEvents,
      priority: 56,
    }),
    template({
      id: "agent-template-learner-twin",
      role: "learner_twin_modeler",
      displayName: "学习者孪生建模员",
      responsibility: "维护可证、可变、可申诉的学习状态候选，不代答、不造证据、不直接评分。",
      groupId: "assessment_growth",
      contributionKind: "professional_advisor",
      eventTypes: [...assessmentEvents, "system_clock_tick", "safety_rumor_emerges"],
      priority: 52,
    }),
  ];
}

function effects(
  changes: Partial<SimulationRunEffects>,
): SimulationRunEffects {
  return { ...emptySimulationRunEffects(), ...changes };
}

function deterministicExecutor(
  template: SimulationAgentTemplateV3,
): SimulationAgentExecutorV3<SimulationRunEffects> {
  return async ({ task }) => {
    const base = {
      executionMode: "deterministic_demo" as const,
      providerId: null,
      modelId: null,
      traceRef: `trace-${task.agentTaskId}`,
      promptTemplateRef: `prompt-${template.professionalRoleId}-v3`,
      estimatedCostMicrounits: 0,
    };
    switch (task.eventType) {
      case "student_asks_gatekeeper":
        return {
          ...base,
          intentType: "gatekeeper_responds",
          targetObjectRefs: task.affectedObjectRefs,
          actionType: "grant_conditional_access",
          actionPayload: { access: "conditional", boundary: "no_private_home_entry" },
          summary: "林师傅认可学生先说明身份与采访边界，给予巷口条件准入。",
          rationale: "清晰说明职业身份、目的与不进入私人空间的承诺，降低了社区风险。",
          evidenceRefs: ["evidence-access-dialogue"],
          confidence: 0.92,
          riskLevel: "low" as const,
          requiresTeacherGate: false,
          effects: effects({
            variables: [{ variableId: "community_trust", delta: 4 }],
            facts: [{
              factId: "fact-access-condition",
              status: "confirmed",
              confidence: 0.95,
              sourceRefs: ["evidence-access-dialogue"],
              visibleScopes: ["student", "teacher", "admin"],
            }],
          }),
        };
      case "student_asks_inheritor":
        return {
          ...base,
          intentType: "inheritor_responds",
          targetObjectRefs: task.affectedObjectRefs,
          actionType: "answer_with_cultural_boundary",
          actionPayload: { framing: "community_subject_not_visual_symbol" },
          summary: "黄老师愿意继续受访，但要求报道把蟳埔女性作为文化主体，而非只展示可消费的视觉符号。",
          rationale: "学生的问题承认了传承人的主体性，并给出了可继续追问的文化语境。",
          evidenceRefs: ["evidence-inheritor-interview"],
          confidence: 0.93,
          riskLevel: "low" as const,
          requiresTeacherGate: false,
          effects: effects({
            variables: [
              { variableId: "community_trust", delta: 3 },
              { variableId: "source_access", delta: 5 },
            ],
          }),
        };
      case "student_inspects_source":
        return {
          ...base,
          intentType: "fact_checker_assesses",
          targetObjectRefs: task.affectedObjectRefs,
          actionType: "request_primary_source_comparison",
          actionPayload: { minimumIndependentSources: 2 },
          summary: "年份主张仍有冲突，应并列记录原始出处并向传承人口述材料交叉核验。",
          rationale: "当前只有互相转引的公开材料，尚不足以把单一年份写成确定事实。",
          evidenceRefs: ["evidence-source-conflict"],
          confidence: template.agentTemplateId === "agent-template-fact-checker" ? 0.96 : 0.78,
          riskLevel: "low" as const,
          requiresTeacherGate: false,
          effects: effects({
            variables: [{ variableId: "evidence_confidence", delta: 6 }],
          }),
        };
      case "shopkeeper_requests_placement":
        if (template.agentTemplateId === "agent-template-shopkeeper") {
          return {
            ...base,
            intentType: "editor_advises_boundary",
            targetObjectRefs: task.affectedObjectRefs,
            actionType: "offer_material_with_placement_request",
            actionPayload: { request: "feature_travel_photo_package" },
            summary: "吴姐愿意开放部分素材，但希望报道突出她的旅拍套餐。",
            rationale: "商户以素材可得性换取商业曝光，构成需要记者明确处理的利益冲突。",
            evidenceRefs: ["evidence-shopkeeper-request"],
            confidence: 0.86,
            riskLevel: "medium" as const,
            requiresTeacherGate: false,
            effects: effects({
              entities: [{
                entityId: "entity-shopkeeper",
                status: "busy",
                publicSummary: "吴姐等待学生回应素材与商业植入边界。",
              }],
            }),
          };
        }
        return {
          ...base,
          intentType: "editor_advises_boundary",
          targetObjectRefs: task.affectedObjectRefs,
          actionType: "separate_editorial_and_commercial_terms",
          actionPayload: { discloseInterest: true, noGuaranteedPlacement: true },
          summary: "可继续协商素材授权，但必须明确不承诺植入，并在成稿中披露商业关系。",
          rationale: "把素材授权与编辑承诺拆开，才能维持报道独立性并保留可用信源。",
          evidenceRefs: ["evidence-editorial-independence-rule"],
          confidence: 0.94,
          riskLevel: "medium" as const,
          requiresTeacherGate: false,
          effects: effects({
            variables: [{ variableId: "editorial_independence", delta: 5 }],
          }),
        };
      case "tourist_withdraws_consent":
        return {
          ...base,
          intentType: "governance_withholds_visual",
          targetObjectRefs: task.affectedObjectRefs,
          actionType: "withhold_closeup_and_request_replacement",
          actionPayload: { withholdCloseup: true, replacement: "wide_shot_or_blur" },
          summary: "立即停用周女士近景素材，改用远景、打码或重新取得可验证授权。",
          rationale: "明确撤回的肖像授权高于成片完整性，继续使用会造成不可逆公开风险。",
          evidenceRefs: ["evidence-consent-withdrawal"],
          confidence: 0.99,
          riskLevel: "high" as const,
          requiresTeacherGate: true,
          effects: effects({
            variables: [{ variableId: "copyright_risk", delta: -8 }],
          }),
        };
      case "system_clock_tick":
        return {
          ...base,
          intentType: "editor_raises_deadline",
          targetObjectRefs: task.affectedObjectRefs,
          actionType: "advance_deadline_window",
          actionPayload: { minutes: 5 },
          summary: "发布窗口缩短五分钟，责任编辑要求先锁定已核验事实再补充叙事。",
          rationale: "时间变化是世界自身推进，不因学生停留在页面而暂停。",
          evidenceRefs: ["evidence-virtual-clock-tick"],
          confidence: 0.95,
          riskLevel: "low" as const,
          requiresTeacherGate: false,
          effects: effects({
            variables: [{ variableId: "deadline_pressure", delta: 6 }],
            advanceMinutes: 5,
          }),
        };
      case "student_submits_story":
        return {
          ...base,
          intentType: "platform_publishes",
          targetObjectRefs: [
            ...task.affectedObjectRefs,
            { objectType: "world_variable" as const, objectId: "reach_potential" },
            { objectType: "world_variable" as const, objectId: "correction_debt" },
          ],
          actionType: "publish_verified_story",
          actionPayload: { channels: ["web", "short_video"], correctionPlan: true },
          summary: "稿件具备进入受控发布门的基础，发布后保留更正入口与证据清单。",
          rationale: "发布会改变公众信任且难以完全撤回，因此必须由教师确认最终风险。",
          evidenceRefs: ["evidence-final-story-revision"],
          confidence: 0.9,
          riskLevel: "high" as const,
          requiresTeacherGate: true,
          effects: effects({
            variables: [
              { variableId: "public_trust", delta: 8 },
              { variableId: "reach_potential", delta: 10 },
              { variableId: "correction_debt", delta: 1 },
            ],
            ending: {
              status: "completed",
              endingRef: "ending-trusted-story",
            },
          }),
        };
      case "teacher_adjusts_pressure":
        return {
          ...base,
          intentType: "teacher_pauses_world",
          targetObjectRefs: task.affectedObjectRefs,
          actionType: "pause_for_reflection",
          actionPayload: { paused: true },
          summary: "教师暂停虚拟时钟，保留当前世界状态供学生复盘关键判断。",
          rationale: "教学干预只改变节奏，不替学生完成岗位判断。",
          evidenceRefs: ["evidence-teacher-pause-decision"],
          confidence: 1,
          riskLevel: "low" as const,
          requiresTeacherGate: false,
          effects: effects({
            variables: [{ variableId: "deadline_pressure", delta: -4 }],
            setPaused: true,
          }),
        };
      default:
        throw Object.assign(new Error(`未覆盖世界事件：${task.eventType}`), {
          code: "event_not_supported",
        });
    }
  };
}

export function createXunpuDeterministicSimulationExecutorsV3(
  templates = buildXunpuSimulationAgentTemplatesV3(),
): ReadonlyMap<string, SimulationAgentExecutorV3<SimulationRunEffects>> {
  return new Map(templates.map((item) => [
    item.agentTemplateId,
    deterministicExecutor(item),
  ]));
}

interface PublicationPolicyV3 {
  endingRef: string;
  actionType: string;
  summary: string;
  rationale: string;
  evidenceRef: string;
  variableEffects: SimulationRunEffects["variables"];
}

function publicationPolicyV3(
  signal: XunpuSafeActionSignalV3 | null,
  trustedEndingRef: string,
): PublicationPolicyV3 {
  if (!signal) {
    return {
      endingRef: trustedEndingRef,
      actionType: "publish_versioned_story_with_correction_entry",
      summary: "作品版本、事实依据和更正入口已绑定，可进入教师发布风险门。",
      rationale: "正式发布会改变公众信任，必须冻结作品哈希和证据后再由教师裁决。",
      evidenceRef: "evidence-final-story-revision",
      variableEffects: [
        { variableId: "public_trust", delta: 8 },
        { variableId: "reach_potential", delta: 10 },
        { variableId: "correction_debt", delta: 1 },
        { variableId: "platform_risk", delta: -2 },
      ],
    };
  }
  const indicator = (id: string, fallback: number): number => (
    signal.worldIndicators[id] ?? fallback
  );
  const copyrightRisk = indicator("copyright_risk", 18);
  const platformRisk = indicator("platform_risk", 16);
  const safetyRisk = indicator("public_safety_risk", 12);
  const communityTrust = indicator("community_trust", 48);
  const evidenceConfidence = indicator("evidence_confidence", 24);
  const editorialIndependence = indicator("editorial_independence", 62);
  const correctionDebt = indicator("correction_debt", 0);
  const deadlinePressure = indicator("deadline_pressure", 28);

  if (copyrightRisk >= 40 || platformRisk >= 48 || safetyRisk >= 55) {
    return {
      endingRef: "ending-governance-failure",
      actionType: "block_or_withdraw_after_governance_failure",
      summary: "发布审查发现权利、平台或公共安全风险已越过治理红线；作品被阻断并形成治理失败终局。",
      rationale: "教师门可以阻止继续扩散，但不能抹掉此前已累积的越界行动与治理责任。",
      evidenceRef: "evidence-governance-failure-boundary",
      variableEffects: [
        { variableId: "public_trust", delta: -12 },
        { variableId: "reach_potential", delta: 3 },
        { variableId: "correction_debt", delta: 15 },
        { variableId: "platform_risk", delta: 18 },
      ],
    };
  }
  if (correctionDebt >= 10
    || communityTrust <= 35
    || evidenceConfidence < 30
    || editorialIndependence <= 35) {
    return {
      endingRef: "ending-traffic-backlash",
      actionType: "publish_then_receive_traceable_backlash",
      summary: "作品获得短期触达，但证据、社区主体或编辑独立性债务立即触发质疑与退回，形成流量反噬终局。",
      rationale: "高触达不会抵消低证据或低信任；平台和社区反馈继续保留在责任链中。",
      evidenceRef: "evidence-traffic-backlash-response",
      variableEffects: [
        { variableId: "public_trust", delta: -8 },
        { variableId: "reach_potential", delta: 16 },
        { variableId: "correction_debt", delta: 10 },
        { variableId: "platform_risk", delta: 7 },
      ],
    };
  }
  if (deadlinePressure >= 65 || signal.remainingMinutes <= 8) {
    return {
      endingRef: "ending-prudent-delay",
      actionType: "hold_story_after_prudent_delay",
      summary: "核验与关系边界基本可信，但团队主动错过第一窗口以等待必要确认，形成审慎延误终局。",
      rationale: "延误不是自动失败；本局保留了为何等待、等待什么以及如何改进并行流程的证据。",
      evidenceRef: "evidence-prudent-delay-decision",
      variableEffects: [
        { variableId: "public_trust", delta: 3 },
        { variableId: "reach_potential", delta: -8 },
        { variableId: "correction_debt", delta: 0 },
        { variableId: "platform_risk", delta: -2 },
      ],
    };
  }
  return {
    endingRef: trustedEndingRef,
    actionType: "publish_versioned_story_with_correction_entry",
    summary: "事实、文化主体、素材权利和未知项已经形成可追溯闭环，可进入教师门完成可信发布。",
    rationale: "可信终局来自多轮真实行动与作品证据，而不是点击发布按钮时临时生成。",
    evidenceRef: "evidence-trusted-collaboration-publication",
    variableEffects: [
      { variableId: "public_trust", delta: 8 },
      { variableId: "reach_potential", delta: 10 },
      { variableId: "correction_debt", delta: 1 },
      { variableId: "platform_risk", delta: -2 },
    ],
  };
}

function deterministicExecutorR2(
  template: SimulationAgentTemplateV3,
  publicationEndingRef: string,
): SimulationAgentExecutorV3<SimulationRunEffects> {
  return async ({ task, observation }) => {
    const safeSignal = parseXunpuSafeActionSignalV3(
      observation?.taskInstruction ?? "",
    );
    const actionQuality: Exclude<XunpuActionQualityV3, "not_applicable"> =
      safeSignal?.quality === "incomplete" || safeSignal?.quality === "risky"
        ? safeSignal.quality
        : "professional";
    const chooseByQuality = <T>(professional: T, incomplete: T, risky: T): T => (
      actionQuality === "risky"
        ? risky
        : actionQuality === "incomplete"
          ? incomplete
          : professional
    );
    const publication = publicationPolicyV3(safeSignal, publicationEndingRef);
    const base = {
      executionMode: "deterministic_demo" as const,
      providerId: null,
      modelId: null,
      traceRef: `trace-${task.agentTaskId}`,
      promptTemplateRef: `prompt-${template.professionalRoleId}-v3-r2`,
      estimatedCostMicrounits: 0,
    };
    const result = (input: {
      intentType: string;
      actionType: string;
      summary: string;
      rationale: string;
      evidenceRefs: string[];
      confidence: number;
      riskLevel: "low" | "medium" | "high";
      effects: Partial<SimulationRunEffects>;
      extraTargets?: Array<{ objectType: ObjectType; objectId: string }>;
    }) => ({
      ...base,
      intentType: input.intentType,
      targetObjectRefs: [
        ...new Map(
          [...task.affectedObjectRefs, ...(input.extraTargets ?? [])].map((reference) => [
            `${reference.objectType}:${reference.objectId}`,
            reference,
          ]),
        ).values(),
      ],
      actionType: input.actionType,
      actionPayload: {
        professionalRoleId: template.professionalRoleId,
        actionQuality,
        matchedCriteria: safeSignal?.matchedCriteria ?? [],
        riskFlags: safeSignal?.riskFlags ?? [],
      },
      summary: input.summary,
      rationale: input.rationale,
      evidenceRefs: input.evidenceRefs,
      confidence: input.confidence,
      riskLevel: input.riskLevel,
      requiresTeacherGate: input.riskLevel === "high",
      effects: effects(input.effects),
    });
    switch (task.eventType) {
      case "student_asks_gatekeeper":
        return result({
          intentType: "gatekeeper_responds",
          actionType: chooseByQuality(
            "grant_conditional_access",
            "request_identity_and_scope_clarification",
            "deny_access_after_boundary_breach",
          ),
          summary: chooseByQuality(
            "林师傅确认学生说明了采访身份、公共区域和隐私边界，给予条件准入。",
            "林师傅没有放行：来意已经表达，但采访身份、拍摄范围或私人空间边界仍不完整。",
            "林师傅拒绝准入并通知社区联络人：学生试图隐瞒身份、越过私人边界或跳过同意。",
          ),
          rationale: chooseByQuality(
            "先说明用途和不进入私人空间的承诺，降低了社区不可逆风险。",
            "职业沟通必须同时说明身份、目的、范围与退出权；缺一项就不能默认进入。",
            "真实现场会对越界行为产生关系后果，不能把高风险表达修饰成一次成功采访。",
          ),
          evidenceRefs: [chooseByQuality(
            "evidence-access-dialogue",
            "evidence-access-boundary-incomplete",
            "evidence-access-boundary-breach",
          )],
          confidence: actionQuality === "professional" ? 0.93 : 0.98,
          riskLevel: actionQuality === "risky" ? "medium" : "low",
          effects: { variables: chooseByQuality(
            [
              { variableId: "community_trust", delta: 4 },
              { variableId: "source_access", delta: 3 },
            ],
            [
              { variableId: "community_trust", delta: -1 },
              { variableId: "source_access", delta: -2 },
            ],
            [
              { variableId: "community_trust", delta: -10 },
              { variableId: "source_access", delta: -8 },
            ],
          ) },
        });
      case "student_asks_inheritor":
        return result({
          intentType: "inheritor_responds",
          actionType: chooseByQuality(
            "answer_with_cultural_boundary",
            "answer_briefly_and_request_better_question",
            "end_interview_after_exoticizing_question",
          ),
          summary: chooseByQuality(
            "研究者与传承人口述都要求把蟳埔女性写作文化主体，而不是可消费的视觉符号。",
            "黄老师只给出简短回应，并要求学生先说明想理解的文化与劳动问题。",
            "黄老师结束了采访：把蟳埔女性当作流量符号的提问伤害了文化主体与合作信任。",
          ),
          rationale: chooseByQuality(
            "学生主动追问文化语境，打开了超越猎奇画面的事实入口。",
            "开放问题需要连接人物、劳动和文化语境，否则只能得到表层信息。",
            "NPC 不是答案按钮；猎奇化提问会真实关闭信源并留下关系后果。",
          ),
          evidenceRefs: [chooseByQuality(
            "evidence-cultural-context-dialogue",
            "evidence-cultural-question-incomplete",
            "evidence-cultural-exoticization-breach",
          )],
          confidence: 0.95,
          riskLevel: actionQuality === "risky" ? "medium" : "low",
          effects: { variables: chooseByQuality(
            [
              { variableId: "community_trust", delta: 3 },
              { variableId: "source_access", delta: 4 },
            ],
            [
              { variableId: "community_trust", delta: 0 },
              { variableId: "source_access", delta: 1 },
            ],
            [
              { variableId: "community_trust", delta: -8 },
              { variableId: "source_access", delta: -5 },
            ],
          ) },
        });
      case "student_inspects_source":
        return result({
          intentType: "fact_checker_assesses",
          actionType: chooseByQuality(
            "request_primary_source_comparison",
            "request_missing_source_locator",
            "reject_unverified_claim_as_fact",
          ),
          summary: chooseByQuality(
            "年份主张仍有冲突，必须并列记录原始名录、地方标准和转引链。",
            "核查问题已指向冲突，但还缺发布主体、原始定位或独立印证，不能提升为确定事实。",
            "核查智能体发现学生准备跳过溯源；该年份主张被降回待核状态。",
          ),
          rationale: chooseByQuality(
            "主题相关不等于来源有效，两条互相转引的材料不能算独立核验。",
            "指出冲突只是起点，必须记录谁在何时何处发布以及材料之间是否独立。",
            "把网传内容直接当事实会降低整篇报道的证据可信度。",
          ),
          evidenceRefs: [chooseByQuality(
            "evidence-source-conflict",
            "evidence-source-locator-missing",
            "evidence-source-verification-skipped",
          )],
          confidence: template.agentTemplateId === "agent-template-fact-checker" ? 0.98 : 0.9,
          riskLevel: actionQuality === "risky" ? "medium" : "low",
          effects: { variables: [{
            variableId: "evidence_confidence",
            delta: chooseByQuality(5, 1, -6),
          }] },
        });
      case "shopkeeper_requests_placement":
        return result({
          intentType: "editor_advises_boundary",
          actionType: template.agentTemplateId === "agent-template-shopkeeper"
            ? "offer_material_with_placement_request"
            : "separate_editorial_and_commercial_terms",
          summary: template.agentTemplateId === "agent-template-shopkeeper"
            ? "吴姐愿意提供素材，但希望标题、首图和链接突出旅拍套餐。"
            : "责任编辑要求把素材授权与编辑承诺拆开，拒绝保证植入并披露利益关系。",
          rationale: "商业主体可以表达利益，但记者不能用版面承诺交换信源或素材。",
          evidenceRefs: ["evidence-merchant-editorial-conflict"],
          confidence: template.agentTemplateId === "agent-template-editor" ? 0.96 : 0.88,
          riskLevel: "medium",
          effects: { variables: [{ variableId: "editorial_independence", delta: 4 }] },
        });
      case "student_resolves_commercial_exchange":
        return result({
          intentType: "editor_advises_boundary",
          actionType: template.agentTemplateId === "agent-template-shopkeeper"
            ? chooseByQuality(
                "accept_limited_material_terms",
                "request_clearer_material_terms",
                "condition_material_on_placement",
              )
            : chooseByQuality(
                "verify_editorial_independence",
                "return_ambiguous_commercial_boundary",
                "flag_compromised_editorial_independence",
              ),
          summary: template.agentTemplateId === "agent-template-shopkeeper"
            ? chooseByQuality(
                "吴姐接受有限合作：可以如实标注素材提供方，但标题、首图和报道角度仍由编辑判断。",
                "吴姐要求继续确认：当前回应尚未说清授权与曝光是否分开，也没有明确合作披露方式。",
                "吴姐把学生的回应理解为同意用标题或首图换取素材，商业条件开始支配报道。",
              )
            : chooseByQuality(
                "责任编辑确认学生拆开了素材授权与版面承诺，并保留合作披露和替代素材路径。",
                "责任编辑暂不确认独立性：需要补充拒绝保证植入、披露关系或替代素材中的至少一项。",
                "责任编辑记录编辑独立性受损：学生用报道呈现换取了素材可得性。",
              ),
          rationale: chooseByQuality(
            "商业主体可以提供素材，但授权、来源披露与编辑决定必须分别记录，不能以报道承诺交换信源。",
            "模糊的‘可以合作’无法约束标题、首图、链接和素材用途，真实编辑部会要求把条件逐项写清。",
            "用版面承诺换素材会污染选题和公众知情，获得素材访问也不能抵消编辑独立性损害。",
          ),
          evidenceRefs: [chooseByQuality(
            "evidence-commercial-boundary-resolved",
            "evidence-commercial-boundary-incomplete",
            "evidence-commercial-exchange-accepted",
          )],
          confidence: template.agentTemplateId === "agent-template-editor" ? 0.97 : 0.91,
          riskLevel: actionQuality === "risky" ? "medium" : "low",
          effects: { variables: chooseByQuality(
            [
              { variableId: "editorial_independence", delta: 5 },
              { variableId: "source_access", delta: 2 },
            ],
            [
              { variableId: "editorial_independence", delta: 0 },
              { variableId: "source_access", delta: 0 },
            ],
            [
              { variableId: "editorial_independence", delta: -10 },
              { variableId: "source_access", delta: 4 },
            ],
          ) },
        });
      case "tourist_withdraws_consent":
        return result({
          intentType: "governance_withholds_visual",
          actionType: "withhold_closeup_and_request_replacement",
          summary: "近景肖像授权已经撤回，必须停用、替换或重新取得可验证许可。",
          rationale: "授权撤回高于成片完整性，静默继续使用会制造不可逆公开伤害。",
          evidenceRefs: ["evidence-consent-withdrawal"],
          confidence: 0.99,
          riskLevel: "high",
          effects: { variables: [
            { variableId: "copyright_risk", delta: -8 },
            { variableId: "public_trust", delta: 2 },
          ] },
        });
      case "system_clock_tick":
        return result({
          intentType: "editor_raises_deadline",
          actionType: "advance_deadline_window",
          summary: "世界时间推进五分钟，责任编辑要求先锁定已核事实，再决定放弃哪些素材。",
          rationale: "截稿压力来自持续世界，不因学生停留在页面而暂停。",
          evidenceRefs: ["evidence-virtual-clock-tick"],
          confidence: 0.96,
          riskLevel: "low",
          effects: {
            variables: [{ variableId: "deadline_pressure", delta: 6 }],
            advanceMinutes: 5,
          },
        });
      case "student_submits_story":
        return result({
          intentType: "platform_publishes",
          actionType: publication.actionType,
          summary: publication.summary,
          rationale: publication.rationale,
          evidenceRefs: [publication.evidenceRef],
          confidence: template.agentTemplateId === "agent-template-platform" ? 0.96 : 0.88,
          riskLevel: "high",
          extraTargets: [
            { objectType: "world_variable", objectId: "reach_potential" },
            { objectType: "world_variable", objectId: "correction_debt" },
          ],
          effects: {
            variables: publication.variableEffects,
            ending: {
              status: publication.endingRef === publicationEndingRef
                ? "completed"
                : "recoverable_failure",
              endingRef: publication.endingRef,
            },
          },
        });
      case "teacher_adjusts_pressure":
        return result({
          intentType: "teacher_pauses_world",
          actionType: "pause_for_reflection",
          summary: "教师暂停虚拟时钟，保留当前世界状态供学生复盘关键判断。",
          rationale: "教学干预只改变节奏，不替学生完成岗位判断。",
          evidenceRefs: ["evidence-teacher-pause-decision"],
          confidence: 1,
          riskLevel: "low",
          effects: {
            variables: [{ variableId: "deadline_pressure", delta: -4 }],
            setPaused: true,
          },
        });
      case "student_observes_editorial_brief":
        return result({
          intentType: "editor_sets_brief",
          actionType: chooseByQuality(
            "set_public_value_and_abandonment_boundary",
            "return_brief_for_missing_boundary",
            "reject_traffic_only_brief",
          ),
          summary: chooseByQuality(
            "陈编辑确认首轮任务：说明公共价值、核心受众、时间预算和放弃条件，但不替学生决定角度。",
            "陈编辑退回了选题：受众或公共价值已经出现，但缺少文化主体、时间预算或放弃条件。",
            "陈编辑拒绝把猎奇流量当作选题目标，并要求学生重新说明公共价值与编辑边界。",
          ),
          rationale: chooseByQuality(
            "选题必须同时回应文化主体与公众问题，不能只追逐视觉热点。",
            "真实选题工单需要能指导后续取舍，而不是一句主题口号。",
            "流量优先且隐藏不确定性的选题会侵蚀编辑独立性。",
          ),
          evidenceRefs: [chooseByQuality(
            "evidence-editorial-brief",
            "evidence-editorial-brief-incomplete",
            "evidence-editorial-brief-risky",
          )],
          confidence: template.agentTemplateId === "agent-template-editor" ? 0.97 : 0.82,
          riskLevel: actionQuality === "risky" ? "medium" : "low",
          effects: { variables: [{
            variableId: "editorial_independence",
            delta: chooseByQuality(3, -1, -8),
          }] },
        });
      case "student_asks_community_source":
        return result({
          intentType: "community_source_responds",
          actionType: chooseByQuality(
            "negotiate_public_scope",
            "withhold_private_topics_until_scope_is_clear",
            "withdraw_interview_after_privacy_breach",
          ),
          summary: chooseByQuality(
            "阿环愿意谈公开习俗与劳动，但要求排除家庭住址、未成年人和私人空间。",
            "阿环只同意谈公开习俗；匿名、删题、住址和撤回边界未说清前，她不会进入家庭话题。",
            "阿环终止采访并要求删除现场记录：学生忽视了隐私、同意或撤回边界。",
          ),
          rationale: chooseByQuality(
            "学生必须把用途、匿名、删题和撤回边界记录进采访作品。",
            "知情同意必须具体到内容和公开方式，笼统承诺不足以打开私人信源。",
            "受访者拥有拒答与撤回权，越界会直接降低信任与后续可达性。",
          ),
          evidenceRefs: [chooseByQuality(
            "evidence-community-disclosure-boundary",
            "evidence-community-boundary-incomplete",
            "evidence-community-privacy-breach",
          )],
          confidence: template.agentTemplateId === "agent-template-community-source" ? 0.97 : 0.8,
          riskLevel: "high",
          effects: { variables: chooseByQuality(
            [
              { variableId: "community_trust", delta: 5 },
              { variableId: "source_access", delta: 4 },
            ],
            [
              { variableId: "community_trust", delta: -2 },
              { variableId: "source_access", delta: -1 },
            ],
            [
              { variableId: "community_trust", delta: -12 },
              { variableId: "source_access", delta: -8 },
            ],
          ) },
        });
      case "student_probes_researcher":
      case "student_compares_sources":
        return result({
          intentType: template.agentTemplateId === "agent-template-fact-checker"
            ? "fact_checker_compares"
            : "researcher_clarifies",
          actionType: chooseByQuality(
            "separate_primary_record_from_origin_claim",
            "request_missing_evidence_layer",
            "refute_unlocated_origin_claim",
          ),
          summary: chooseByQuality(
            "国家级名录和地方标准可定位；单一起源传说仍只能作为待核口述，不能写成定论。",
            "材料类别已经列出，但发布主体、原始定位或口述边界仍缺失，暂不提升证据置信度。",
            "学生试图把未定位的起源说法直接写成事实；核查智能体将其标记为不可采用。",
          ),
          rationale: chooseByQuality(
            "证据层级与来源时点必须在事实核查表中分开记录。",
            "列举材料不等于完成比对，必须说明每类材料究竟能证明到哪一步。",
            "跳过来源层级会把传说、解释和公开事实混为一谈。",
          ),
          evidenceRefs: [chooseByQuality(
            "evidence-primary-source-comparison",
            "evidence-source-layer-incomplete",
            "evidence-origin-claim-unverified",
          )],
          confidence: template.agentTemplateId === "agent-template-fact-checker" ? 0.98 : 0.95,
          riskLevel: actionQuality === "risky" ? "medium" : "low",
          effects: { variables: [{
            variableId: "evidence_confidence",
            delta: chooseByQuality(6, 1, -7),
          }] },
        });
      case "student_requests_official_data":
        return result({
          intentType: "public_liaison_updates",
          actionType: chooseByQuality(
            "provide_timestamped_public_data_status",
            "request_scope_and_timestamp_clarification",
            "refuse_to_invent_unreleased_number",
          ),
          summary: chooseByQuality(
            "蔡主任只能确认上次公开值、统计口径和下一更新时间，最新客流仍在汇总。",
            "蔡主任要求补充统计范围和需要的时点；当前只能提供一条带限制的公开状态。",
            "蔡主任拒绝提前给出或编造未完成汇总的数据，并记录了不当请求。",
          ),
          rationale: chooseByQuality(
            "带时点的旧公开值可以引用，未完成汇总不能提前写成最终数字。",
            "数据请求必须明确主体、时点、口径和未知项，才能进入作品。",
            "为了速度隐藏未知项会同时伤害证据可信度并增加截稿返工。",
          ),
          evidenceRefs: [chooseByQuality(
            "evidence-official-data-window",
            "evidence-official-data-request-incomplete",
            "evidence-unreleased-data-pressure",
          )],
          confidence: template.agentTemplateId === "agent-template-public-liaison" ? 0.97 : 0.9,
          riskLevel: actionQuality === "risky" ? "high" : "medium",
          extraTargets: [{ objectType: "world_variable", objectId: "evidence_confidence" }],
          effects: { variables: chooseByQuality(
            [
              { variableId: "evidence_confidence", delta: 3 },
              { variableId: "deadline_pressure", delta: 2 },
            ],
            [
              { variableId: "evidence_confidence", delta: 1 },
              { variableId: "deadline_pressure", delta: 5 },
            ],
            [
              { variableId: "evidence_confidence", delta: -5 },
              { variableId: "deadline_pressure", delta: 8 },
            ],
          ) },
        });
      case "student_inspects_rights":
      case "rights_contact_flags_scope":
        return result({
          intentType: template.agentTemplateId === "agent-template-governance"
            ? "governance_requests_replacement"
            : "rights_contact_assesses",
          actionType: task.eventType === "rights_contact_flags_scope"
            ? "record_license_scope_and_replacement"
            : chooseByQuality(
                "record_license_scope_and_replacement",
                "hold_material_for_missing_license_fields",
                "flag_planned_unauthorized_use",
              ),
          summary: task.eventType === "rights_contact_flags_scope"
            ? "许老师主动确认：热门近景素材只有线下展示许可，不包含商业短视频、二次剪辑或跨平台投放。"
            : chooseByQuality(
                "热门近景素材只有线下展示许可，不包含商业短视频、二次剪辑或跨平台投放。",
                "权利核对只覆盖了部分字段；作者、肖像、用途、期限或平台任一缺失都会继续冻结素材。",
                "治理智能体发现学生准备无授权使用截图或先用再说，版权与平台风险显著上升。",
              ),
          rationale: task.eventType === "rights_contact_flags_scope"
            ? "NPC 的主动反馈与学生自报相互独立，权利缺口必须进入真实台账。"
            : chooseByQuality(
                "权利台账必须区分作者、肖像、用途、期限与平台；缺口需要替换或限用途。",
                "权利不是一个勾选框，缺失字段必须停用、补授权或替换。",
                "无权利依据的素材会把可控缺口累积成治理失败风险。",
              ),
          evidenceRefs: [task.eventType === "rights_contact_flags_scope"
            ? "evidence-license-scope-mismatch"
            : chooseByQuality(
                "evidence-license-scope-mismatch",
                "evidence-license-fields-incomplete",
                "evidence-unauthorized-use-planned",
              )],
          confidence: template.agentTemplateId === "agent-template-governance" ? 0.99 : 0.97,
          riskLevel: "high",
          extraTargets: [{ objectType: "world_variable", objectId: "platform_risk" }],
          effects: { variables: task.eventType === "rights_contact_flags_scope"
            ? [
                { variableId: "copyright_risk", delta: -6 },
                { variableId: "platform_risk", delta: -3 },
              ]
            : chooseByQuality(
                [
                  { variableId: "copyright_risk", delta: -6 },
                  { variableId: "platform_risk", delta: -3 },
                ],
                [
                  { variableId: "copyright_risk", delta: 4 },
                  { variableId: "platform_risk", delta: 2 },
                ],
                [
                  { variableId: "copyright_risk", delta: 24 },
                  { variableId: "platform_risk", delta: 18 },
                ],
              ) },
        });
      case "safety_rumor_emerges":
      case "student_submits_limited_alert":
        return result({
          intentType: template.agentTemplateId === "agent-template-platform"
            || template.agentTemplateId === "agent-template-public-liaison"
            ? "platform_holds_or_publishes_alert"
            : "safety_checker_assesses",
          actionType: task.eventType === "safety_rumor_emerges"
            ? "flag_unverified_safety_rumor"
            : chooseByQuality(
                "publish_timestamped_limited_alert",
                "hold_alert_for_missing_time_or_unknowns",
                "block_unverified_safety_claim",
              ),
          summary: task.eventType === "safety_rumor_emerges"
            ? "群聊截图缺少主体、时间和位置，只能登记为传闻并立即请求权威确认。"
            : chooseByQuality(
                "限定性快讯说明了确认主体、时点和未知项，可进入发布风险门。",
                "安全提醒缺少确认主体、时点、位置或未知项之一，平台继续暂缓发布。",
                "学生试图把未确认截图直接写成定论；平台阻断快讯并提高公共安全风险等级。",
              ),
          rationale: task.eventType === "safety_rumor_emerges"
            ? "公共安全信息的速度不能取消来源、时点和未知项边界。"
            : chooseByQuality(
                "速度与准确可以通过限定表达同时维护。",
                "缺少一个关键限定都可能把局部状态误报成全域事实。",
                "先发再核会把时间压力转化为公共安全误导。",
              ),
          evidenceRefs: [task.eventType === "safety_rumor_emerges"
            ? "evidence-safety-status-check"
            : chooseByQuality(
                "evidence-limited-alert-grounded",
                "evidence-limited-alert-incomplete",
                "evidence-safety-claim-unverified",
              )],
          confidence: 0.96,
          riskLevel: "high",
          extraTargets: [
            { objectType: "world_variable", objectId: "deadline_pressure" },
            { objectType: "world_variable", objectId: "public_trust" },
            { objectType: "world_variable", objectId: "public_safety_risk" },
          ],
          effects: { variables: task.eventType === "safety_rumor_emerges"
            ? [
                { variableId: "public_safety_risk", delta: 10 },
                { variableId: "deadline_pressure", delta: 5 },
              ]
            : chooseByQuality(
                [
                  { variableId: "public_safety_risk", delta: -7 },
                  { variableId: "public_trust", delta: 4 },
                ],
                [
                  { variableId: "public_safety_risk", delta: 4 },
                  { variableId: "public_trust", delta: -2 },
                ],
                [
                  { variableId: "public_safety_risk", delta: 22 },
                  { variableId: "public_trust", delta: -10 },
                ],
              ) },
        });
      case "student_waits_for_verification":
        return result({
          intentType: "editor_records_prudent_delay",
          actionType: chooseByQuality(
            "wait_with_bounded_parallel_plan",
            "wait_without_complete_parallel_plan",
            "delay_without_professional_reason",
          ),
          summary: chooseByQuality(
            "编辑部同意用十分钟等待必要核验，同时并行整理已确认事实与限定发布方案。",
            "等待理由可以成立，但缺少明确时限或并行任务，截稿压力继续上升。",
            "无边界等待没有形成可核验的专业取舍，只消耗了发布窗口。",
          ),
          rationale: chooseByQuality(
            "审慎延误必须说明等待什么、等多久以及等待期间继续完成什么。",
            "等待本身不是能力证据；可解释的时间预算和并行安排才是。",
            "世界时间不会因为学生没有形成方案而停止。",
          ),
          evidenceRefs: [chooseByQuality(
            "evidence-bounded-verification-delay",
            "evidence-delay-plan-incomplete",
            "evidence-unbounded-delay",
          )],
          confidence: template.agentTemplateId === "agent-template-editor" ? 0.98 : 0.9,
          riskLevel: actionQuality === "risky" ? "medium" : "low",
          extraTargets: [
            { objectType: "world_variable", objectId: "evidence_confidence" },
          ],
          effects: {
            variables: chooseByQuality(
              [
                { variableId: "deadline_pressure", delta: 20 },
                { variableId: "evidence_confidence", delta: 2 },
              ],
              [
                { variableId: "deadline_pressure", delta: 24 },
                { variableId: "evidence_confidence", delta: 0 },
              ],
              [
                { variableId: "deadline_pressure", delta: 30 },
                { variableId: "evidence_confidence", delta: -4 },
              ],
            ),
            advanceMinutes: 10,
          },
        });
      case "student_drafts_story":
        return result({
          intentType: "editor_reviews_revision",
          actionType: "review_versioned_story_without_rewriting",
          summary: "陈编辑已收到带父版本和内容哈希的专题稿，只指出事实、结构和披露缺口，不替学生改写。",
          rationale: "只有真实版本差异才能证明学生如何根据证据和建议修订。",
          evidenceRefs: ["evidence-story-revision-chain"],
          confidence: template.agentTemplateId === "agent-template-editor" ? 0.97 : 0.78,
          riskLevel: "low",
          extraTargets: [{ objectType: "world_variable", objectId: "deadline_pressure" }],
          effects: { variables: [
            { variableId: "evidence_confidence", delta: 3 },
            { variableId: "deadline_pressure", delta: 1 },
          ] },
        });
      case "platform_flags_story":
        return result({
          intentType: "platform_returns_feedback",
          actionType: "return_story_with_traceable_reasons",
          summary: "乔安退回夸张标题和许可不明的近景素材，并保留命中规则与更正入口。",
          rationale: "退回是发布后的世界反馈，不能被静默覆盖成一次普通未通过。",
          evidenceRefs: ["evidence-platform-return"],
          confidence: 0.98,
          riskLevel: "high",
          extraTargets: [
            { objectType: "world_variable", objectId: "correction_debt" },
            { objectType: "world_variable", objectId: "public_trust" },
          ],
          effects: { variables: [
            { variableId: "platform_risk", delta: 8 },
            { variableId: "correction_debt", delta: 5 },
            { variableId: "public_trust", delta: -4 },
          ] },
        });
      case "community_challenges_framing":
        return result({
          intentType: "community_requests_correction",
          actionType: "challenge_exoticized_framing",
          summary: "阿环指出成稿删掉了劳动和社区主体，只留下网红头饰与游客镜头，要求公开回应。",
          rationale: "受访者反馈会继续改变信任与更正债务，不是一次性剧情台词。",
          evidenceRefs: ["evidence-community-framing-challenge"],
          confidence: template.agentTemplateId === "agent-template-community-source" ? 0.98 : 0.9,
          riskLevel: "high",
          extraTargets: [{ objectType: "world_variable", objectId: "correction_debt" }],
          effects: { variables: [
            { variableId: "community_trust", delta: -8 },
            { variableId: "correction_debt", delta: 6 },
          ] },
        });
      case "student_submits_correction":
        return result({
          intentType: "editor_reviews_correction",
          actionType: "publish_correction_or_hold_with_evidence",
          summary: "更正决定保留原版本、差异、依据和公开说明，可进入教师发布风险门。",
          rationale: "公开更正必须可追溯，不能用静默覆盖抹去学生与平台的责任链。",
          evidenceRefs: ["evidence-public-correction-decision"],
          confidence: template.agentTemplateId === "agent-template-editor" ? 0.97 : 0.88,
          riskLevel: "high",
          extraTargets: [{ objectType: "world_variable", objectId: "public_trust" }],
          effects: { variables: [
            { variableId: "correction_debt", delta: -6 },
            { variableId: "public_trust", delta: 6 },
          ] },
        });
      case "teacher_reviews_privacy":
        return result({
          intentType: "teacher_bounds_disclosure",
          actionType: "review_privacy_scope_without_rewriting",
          summary: "教师只裁决公开、匿名、删题和撤回边界，不替学生改写采访记录。",
          rationale: "高风险伦理门必须保留教师责任与学生再次提交空间。",
          evidenceRefs: ["evidence-teacher-privacy-boundary"],
          confidence: 1,
          riskLevel: "high",
          effects: { variables: [{ variableId: "community_trust", delta: 2 }] },
        });
      case "teacher_records_final_assessment":
        return result({
          intentType: "assessor_records_evidence_decision",
          actionType: "record_sufficient_or_insufficient_evidence",
          summary: "能力证据员只归档真实轨迹与教师逐维裁决；缺证据的维度保持不足。",
          rationale: "课程完成、作品交齐和安全终局都不能自动换算为岗位能力满分。",
          evidenceRefs: ["evidence-final-assessment-boundary"],
          confidence: 1,
          riskLevel: "high",
          effects: {},
        });
      default:
        throw Object.assign(new Error(`R2 未覆盖世界事件：${task.eventType}`), {
          code: "event_not_supported",
        });
    }
  };
}

export function createXunpuDeterministicSimulationExecutorsV3R2(
  templates = buildXunpuSimulationAgentTemplatesV3R2(),
  publicationEndingRef = "ending-trusted-collaboration",
): ReadonlyMap<string, SimulationAgentExecutorV3<SimulationRunEffects>> {
  return new Map(templates.map((item) => [
    item.agentTemplateId,
    deterministicExecutorR2(item, publicationEndingRef),
  ]));
}
