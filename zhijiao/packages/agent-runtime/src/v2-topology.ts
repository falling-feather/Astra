import {
  AgentTopologyManifestSchema,
  AgentTopologyManifestSchemaVersion,
  type AgentGroupId,
  type AgentTopologyEdge,
  type AgentTopologyManifest,
  type AgentTopologyNode,
} from "@ronggang/contracts";
import { productionAgentTemplateCatalog } from "./catalog.js";

interface BaselineTopologyProfile {
  agentId: string;
  title: string;
  groupId: AgentGroupId;
  teacherGateRequired: boolean;
}

const baselineProfiles = new Map<string, BaselineTopologyProfile>([
  ["template:agent-teaching", {
    agentId: "agent-teaching",
    title: "教学导演智能体",
    groupId: "teaching_direction",
    teacherGateRequired: false,
  }],
  ["template:agent-scene-director", {
    agentId: "agent-scene-director",
    title: "情境导演智能体",
    groupId: "teaching_direction",
    teacherGateRequired: true,
  }],
  ["template:agent-interviewee", {
    agentId: "agent-interviewee",
    title: "采访对象智能体",
    groupId: "editorial_production",
    teacherGateRequired: false,
  }],
  ["template:agent-chief", {
    agentId: "agent-chief",
    title: "责任编辑智能体",
    groupId: "editorial_production",
    teacherGateRequired: false,
  }],
  ["template:agent-fact-checker", {
    agentId: "agent-fact-checker",
    title: "事实核查智能体",
    groupId: "fact_verification",
    teacherGateRequired: false,
  }],
  ["template:agent-copyright", {
    agentId: "agent-copyright",
    title: "版权方智能体",
    groupId: "content_governance",
    teacherGateRequired: true,
  }],
  ["governance/copyright", {
    agentId: "agent-governance-copyright",
    title: "版权治理智能体",
    groupId: "content_governance",
    teacherGateRequired: true,
  }],
  ["governance/content-safety", {
    agentId: "agent-governance-content-safety",
    title: "内容安全治理智能体",
    groupId: "content_governance",
    teacherGateRequired: true,
  }],
  ["governance/platform-rule", {
    agentId: "agent-governance-platform-rule",
    title: "平台规则治理智能体",
    groupId: "content_governance",
    teacherGateRequired: true,
  }],
  ["template:agent-platform", {
    agentId: "agent-platform",
    title: "平台运营智能体",
    groupId: "operations_distribution",
    teacherGateRequired: true,
  }],
  ["template:agent-evidence-assessor", {
    agentId: "agent-evidence-assessor",
    title: "证据充分性评价智能体",
    groupId: "evaluation_learning",
    teacherGateRequired: true,
  }],
  ["template:agent-work-quality-assessor", {
    agentId: "agent-work-quality-assessor",
    title: "作品质量评价智能体",
    groupId: "evaluation_learning",
    teacherGateRequired: true,
  }],
  ["template:agent-collaboration-assessor", {
    agentId: "agent-collaboration-assessor",
    title: "职业协作评价智能体",
    groupId: "evaluation_learning",
    teacherGateRequired: true,
  }],
  ["template:agent-learning", {
    agentId: "agent-learning",
    title: "学习迁移策展智能体",
    groupId: "evaluation_learning",
    teacherGateRequired: true,
  }],
]);

const groups: AgentTopologyManifest["groups"] = [
  {
    groupId: "teaching_direction",
    title: "教学与情境导演",
    responsibility: "判断教学节奏，并把教师策略转换为受控情境候选。",
    order: 1,
  },
  {
    groupId: "editorial_production",
    title: "采编与协作",
    responsibility: "模拟采访对象与责任编辑，提供岗位化、可追溯的业务协作。",
    order: 2,
  },
  {
    groupId: "fact_verification",
    title: "事实核查",
    responsibility: "核验固定来源、主张与证据边界，只给出更正或补证建议。",
    order: 3,
  },
  {
    groupId: "content_governance",
    title: "内容治理",
    responsibility: "分别处理版权、内容安全与平台规则，不替代教师批准。",
    order: 4,
  },
  {
    groupId: "operations_distribution",
    title: "运营与分发",
    responsibility: "模拟平台发布要求、渠道适配、互动与升级回执。",
    order: 5,
  },
  {
    groupId: "evaluation_learning",
    title: "评价与学习迁移",
    responsibility: "形成逐维评价建议，并从教师终评提炼待审核迁移候选。",
    order: 6,
  },
];

const rawEdges: ReadonlyArray<readonly [
  string,
  string,
  string,
  AgentTopologyEdge["relation"],
]> = [
  ["agent-teaching", "agent-scene-director", "teaching_directive_recorded", "notifies"],
  ["agent-scene-director", "agent-chief", "scenario_intervention_applied", "supports"],
  ["agent-interviewee", "agent-fact-checker", "role_interaction_responded", "supports"],
  ["agent-fact-checker", "agent-chief", "evidence_recorded", "reviews"],
  ["agent-chief", "agent-copyright", "role_interaction_requested", "notifies"],
  ["agent-copyright", "agent-governance-copyright", "governance_review_requested", "supports"],
  ["agent-governance-copyright", "agent-governance-content-safety", "governance_review_requested", "supports"],
  ["agent-governance-content-safety", "agent-governance-platform-rule", "governance_review_requested", "supports"],
  ["agent-governance-platform-rule", "agent-platform", "governance_reviewed", "gates"],
  ["agent-platform", "agent-evidence-assessor", "submission_created", "notifies"],
  ["agent-evidence-assessor", "agent-work-quality-assessor", "evaluation_case_opened", "supports"],
  ["agent-work-quality-assessor", "agent-collaboration-assessor", "evaluation_case_opened", "supports"],
  ["agent-collaboration-assessor", "agent-learning", "teacher_reviewed", "gates"],
];

const edges: AgentTopologyEdge[] = rawEdges.map(([
  sourceAgentId,
  targetAgentId,
  eventType,
  relation,
], index) => ({
  edgeId: `topology-edge-${index + 1}`,
  sourceAgentId,
  targetAgentId,
  eventType,
  relation,
}));

function nodeOf(
  entry: ReturnType<typeof productionAgentTemplateCatalog.list>[number],
): AgentTopologyNode {
  const profile = baselineProfiles.get(entry.template.templateId);
  if (!profile) {
    throw new Error(`十四智能体拓扑缺少基线模板映射：${entry.template.templateId}`);
  }
  return {
    agentId: profile.agentId,
    templateId: entry.template.templateId,
    title: profile.title,
    groupId: profile.groupId,
    responsibility: entry.template.responsibility,
    subscribedEventTypes: [...entry.template.allowedTriggers],
    inputTypes: [...entry.template.allowedTriggers],
    outputTypes: [entry.template.outputSchemaRef],
    allowedActions: [...entry.template.allowedIntents],
    forbiddenActions: [
      "authoritative_world_write",
      "teacher_gate_bypass",
      "private_context_export",
    ],
    teacherGateRequired: profile.teacherGateRequired,
    status: entry.template.enabled ? "active" : "disabled",
  };
}

/**
 * Builds the frozen six-group/fourteen-agent product topology from the actual
 * production catalog. Candidate and assistance templates are intentionally
 * excluded so the administrator view cannot inflate the baseline count.
 */
export function buildAgentTopologyManifest(
  generatedAt = new Date().toISOString(),
): AgentTopologyManifest {
  const baseline = productionAgentTemplateCatalog.list()
    .filter((entry) => entry.lifecycle === "baseline");
  if (baseline.length !== baselineProfiles.size) {
    throw new Error(
      `生产基线应为 ${baselineProfiles.size} 个智能体，实际为 ${baseline.length}`,
    );
  }
  const templateIds = new Set(baseline.map((entry) => entry.template.templateId));
  for (const templateId of baselineProfiles.keys()) {
    if (!templateIds.has(templateId)) {
      throw new Error(`生产目录缺少冻结基线模板：${templateId}`);
    }
  }
  return AgentTopologyManifestSchema.parse({
    schemaVersion: AgentTopologyManifestSchemaVersion,
    generatedAt,
    groups,
    agents: baseline.map(nodeOf),
    edges,
  });
}
