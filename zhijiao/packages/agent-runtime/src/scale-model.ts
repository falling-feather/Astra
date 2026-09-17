import {
  AgentArchitectureProfileSchema,
  AgentDefinitionSchema,
  AgentInstanceSchema,
  AgentScaleSchemaVersion,
  AgentTemplateSchema,
  type AgentArchitectureProfile,
  type AgentDefinition,
  type AgentInstance,
  type AgentInstanceContext,
  type AgentTemplate,
} from "@ronggang/contracts";
import { hashValue } from "@ronggang/context-engine";

export function createAgentArchitectureProfile(
  input: Omit<AgentArchitectureProfile, "policyHash">,
): AgentArchitectureProfile {
  return AgentArchitectureProfileSchema.parse({
    ...input,
    policyHash: hashValue(input),
  });
}

function allowedInstanceKinds(
  roleId: AgentDefinition["roleId"],
): AgentTemplate["allowedInstanceKinds"] {
  if (
    roleId === "interviewee"
    || roleId === "copyright_owner"
    || roleId === "editor_in_chief"
    || roleId === "platform_operator"
  ) {
    return ["npc"];
  }
  if (roleId === "system") return ["system"];
  if (roleId === "student_assistant") return ["student_role"];
  if (roleId === "content_assistant") return ["resource"];
  if (roleId === "teacher_assistant") return ["teacher_assistant"];
  return ["teacher_assistant"];
}

export function createAgentTemplate(
  rawDefinition: AgentDefinition,
  enabled = true,
): AgentTemplate {
  const definition = AgentDefinitionSchema.parse(rawDefinition);
  return AgentTemplateSchema.parse({
    schemaVersion: AgentScaleSchemaVersion,
    templateId: definition.templateRef.templateId,
    templateVersion: definition.templateRef.templateVersion,
    roleId: definition.roleId,
    definitionVersion: definition.definitionVersion,
    promptVersion: definition.promptVersion,
    allowedTriggers: definition.allowedTriggers,
    allowedIntents: definition.allowedIntents,
    responsibility: `承担 ${definition.roleId} 岗位职责，并只输出固定契约允许的智能体意图`,
    capabilityDomains: [
      definition.roleId,
      ...definition.allowedIntents,
    ],
    graphRef: `agent-graph:${definition.agentId}@${definition.definitionVersion}`,
    promptPolicyRef: `prompt-policy:${definition.agentId}@${definition.promptVersion}`,
    toolPolicyRef: `tool-policy:${definition.agentId}@${definition.definitionVersion}`,
    permissionPolicyRef: `role-contract:${definition.roleId}`,
    contextPolicyRef: `private-view:${definition.roleId}`,
    outputSchemaRef: `agent-intent:${definition.agentId}@${definition.definitionVersion}`,
    allowedInstanceKinds: allowedInstanceKinds(definition.roleId),
    failurePolicyRef: `failure-policy:${definition.agentId}@${definition.definitionVersion}`,
    budget: {
      maxSteps: definition.maxSteps,
      maxToolCalls: definition.maxToolCalls,
      timeoutMs: definition.timeoutMs,
    },
    enabled,
  });
}

export function createAgentInstance(input: {
  definition: AgentDefinition;
  sessionId: string;
  sessionEpoch: string;
  context: AgentInstanceContext;
  createdAt: string;
}): AgentInstance {
  const definition = AgentDefinitionSchema.parse(input.definition);
  return AgentInstanceSchema.parse({
    schemaVersion: AgentScaleSchemaVersion,
    instanceRef: {
      instanceId: `${input.sessionId}:${input.sessionEpoch}:${definition.agentId}`,
      instanceVersion: definition.definitionVersion,
    },
    templateRef: definition.templateRef,
    agentId: definition.agentId,
    roleId: definition.roleId,
    sessionId: input.sessionId,
    sessionEpoch: input.sessionEpoch,
    context: input.context,
    roleSnapshot: null,
    createdAt: input.createdAt,
  });
}
