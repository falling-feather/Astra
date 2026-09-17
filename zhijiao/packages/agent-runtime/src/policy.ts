import {
  AgentAssistanceProposalSchema,
  ExecutableAgentIntentSchema,
  RoleResponseIntentSchema,
  type AgentDefinition,
  type AgentGraphNode,
  type AgentRunRequest,
  type AgentAssistanceProposal,
  type ExecutableAgentIntent,
  type RoleResponseIntent,
} from "@ronggang/contracts";
import {
  AgentContextIntegrityError,
  assertAgentContextIntegrity,
} from "./prompt.js";

export class AgentPolicyError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AgentPolicyError";
    this.code = code;
  }
}

export function assertDefinitionRequestPolicy(definition: AgentDefinition, request: AgentRunRequest): void {
  if (definition.agentId !== request.actorId || definition.agentId !== request.role.agentId) {
    throw new AgentPolicyError("agent_identity_mismatch", "智能体定义、调用者与角色契约不一致");
  }
  if (definition.roleId !== request.role.roleId) {
    throw new AgentPolicyError("role_mismatch", "智能体定义与角色类型不一致");
  }
  if (!definition.allowedTriggers.includes(request.trigger.type)) {
    throw new AgentPolicyError("trigger_denied", `未授权触发类型：${request.trigger.type}`);
  }
  try {
    assertAgentContextIntegrity(request);
  } catch (error) {
    if (error instanceof AgentContextIntegrityError) {
      throw new AgentPolicyError(error.code, error.message);
    }
    throw error;
  }
  const undeclared = definition.allowedIntents.filter((intentType) => !request.role.allowedIntents.includes(intentType));
  if (undeclared.length > 0) {
    throw new AgentPolicyError("intent_contract_mismatch", `角色契约未授权意图：${undeclared.join("、")}`);
  }
}

export function assertToolPolicy(node: AgentGraphNode, request: AgentRunRequest): void {
  if (node.kind !== "tool") return;
  if (!node.toolName || !request.role.toolPolicy.includes(node.toolName)) {
    throw new AgentPolicyError("tool_denied", `角色无权调用工具：${node.toolName ?? "unknown"}`);
  }
}

export function assertIntentPolicy(
  rawIntent: ExecutableAgentIntent,
  definition: AgentDefinition,
  request: AgentRunRequest,
): ExecutableAgentIntent {
  const intent = ExecutableAgentIntentSchema.parse(rawIntent);
  if (intent.actorId !== definition.agentId || intent.roleId !== definition.roleId) {
    throw new AgentPolicyError("intent_identity_mismatch", "意图行动者与智能体定义不一致");
  }
  if (intent.expectedStateVersion !== request.stateVersion) {
    throw new AgentPolicyError("stale_intent", "意图状态版本与调用快照不一致");
  }
  if (!definition.allowedIntents.includes(intent.intentType) || !request.role.allowedIntents.includes(intent.intentType)) {
    throw new AgentPolicyError("intent_denied", `智能体无权输出意图：${intent.intentType}`);
  }
  if (intent.riskLevel === "high" && !intent.requiresTeacherReview) {
    throw new AgentPolicyError("review_required", "高风险意图必须进入教师复核");
  }
  return intent;
}

export function assertRoleResponseIntentPolicy(
  rawIntent: RoleResponseIntent,
  definition: AgentDefinition,
  request: AgentRunRequest,
): RoleResponseIntent {
  const intent = RoleResponseIntentSchema.parse(rawIntent);
  if (intent.actorId !== definition.agentId || intent.roleId !== definition.roleId) {
    throw new AgentPolicyError("role_response_identity_mismatch", "岗位响应身份与智能体定义不一致");
  }
  if (intent.expectedStateVersion !== request.stateVersion) {
    throw new AgentPolicyError("stale_role_response", "岗位响应状态版本与调用快照不一致");
  }
  if (
    !definition.allowedIntents.includes("post_role_response")
    || !request.role.allowedIntents.includes("post_role_response")
  ) {
    throw new AgentPolicyError("role_response_denied", "角色契约未授权岗位响应");
  }
  if (
    !intent.causationEventIds.includes(request.trigger.sourceId)
    || !intent.visibility.includes("role_private")
    || !intent.visibility.includes("audit_only")
    || intent.visibility.includes("public_world")
  ) {
    throw new AgentPolicyError("role_response_scope_invalid", "岗位响应因果或可见范围不符合私密通信策略");
  }
  return intent;
}

export function assertAssistanceProposalPolicy(
  rawProposal: AgentAssistanceProposal,
  definition: AgentDefinition,
  request: AgentRunRequest,
): AgentAssistanceProposal {
  const proposal = AgentAssistanceProposalSchema.parse(rawProposal);
  if (
    proposal.actorId !== definition.agentId
    || proposal.roleId !== definition.roleId
  ) {
    throw new AgentPolicyError(
      "assistance_identity_mismatch",
      "辅助建议身份与智能体定义不一致",
    );
  }
  if (
    proposal.templateRef.templateId !== request.templateRef.templateId
    || proposal.templateRef.templateVersion
      !== request.templateRef.templateVersion
    || proposal.instanceRef.instanceId !== request.instanceRef.instanceId
    || proposal.instanceRef.instanceVersion
      !== request.instanceRef.instanceVersion
  ) {
    throw new AgentPolicyError(
      "assistance_instance_mismatch",
      "辅助建议没有固定到本次模板与实例",
    );
  }
  if (proposal.expectedStateVersion !== request.stateVersion) {
    throw new AgentPolicyError(
      "stale_assistance",
      "辅助建议状态版本与调用快照不一致",
    );
  }
  if (
    !definition.allowedIntents.includes("provide_assistance")
    || !request.role.allowedIntents.includes("provide_assistance")
  ) {
    throw new AgentPolicyError(
      "assistance_denied",
      "角色契约未授权生成辅助建议",
    );
  }
  if (
    !proposal.causationEventIds.includes(request.trigger.sourceId)
    || proposal.visibility.includes("public_world")
    || proposal.authority !== "advisory_only"
    || !proposal.requiresHumanAction
  ) {
    throw new AgentPolicyError(
      "assistance_authority_invalid",
      "辅助建议因果、可见范围或非权威边界不符合策略",
    );
  }
  return proposal;
}
