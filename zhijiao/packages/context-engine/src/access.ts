import {
  AccessPolicyVersion,
  AccessSubjectSchema,
  AgentInstanceContextSchema,
  AgentInstanceRefSchema,
  ResourceAudienceSchema,
  type AccessPurpose,
  type AccessSubject,
  type AgentInstanceContext,
  type AgentInstanceRef,
  type AgentTemplateRef,
  type ResourceAudience,
  type RoleContract,
  type VersionedObjectRef,
  type VisibilityScope,
} from "@ronggang/contracts";
import { hashValue } from "./canonical.js";

export interface AccessDecision {
  allowed: boolean;
  reason:
    | "allowed"
    | "course_mismatch"
    | "session_mismatch"
    | "epoch_mismatch"
    | "scope_denied"
    | "team_denied"
    | "role_denied"
    | "actor_denied"
    | "private_namespace_denied"
    | "audit_denied";
}

function hasCapability(subject: AccessSubject, capability: string): boolean {
  return subject.capabilities.includes(capability) || subject.capabilities.includes("read_all");
}

export function authorizeResource(
  rawSubject: AccessSubject,
  rawAudience: ResourceAudience,
): AccessDecision {
  const subject = AccessSubjectSchema.parse(rawSubject);
  const audience = ResourceAudienceSchema.parse(rawAudience);
  if (audience.courseId !== null && audience.courseId !== subject.courseId) {
    return { allowed: false, reason: "course_mismatch" };
  }
  if (audience.sessionId !== null && audience.sessionId !== subject.sessionId) {
    return { allowed: false, reason: "session_mismatch" };
  }
  if (audience.sessionEpoch !== null && audience.sessionEpoch !== subject.sessionEpoch) {
    return { allowed: false, reason: "epoch_mismatch" };
  }

  const explicitAudit = (
    subject.purpose === "audit"
    && audience.auditReadable
    && audience.scopes.includes("audit_only")
    && hasCapability(subject, "audit.read")
  );
  if (explicitAudit) return { allowed: true, reason: "allowed" };

  if (audience.roleIds.length > 0 && !audience.roleIds.includes(subject.roleId)) {
    return { allowed: false, reason: "role_denied" };
  }

  const publicAllowed = (
    audience.scopes.includes("public_world")
    && subject.visibleScopes.includes("public_world")
    && (audience.teamIds.length === 0 || audience.teamIds.includes(subject.teamId))
    && (audience.actorIds.length === 0 || audience.actorIds.includes(subject.actorId))
  );
  if (publicAllowed) return { allowed: true, reason: "allowed" };

  const teamAllowed = (
    audience.scopes.includes("assigned_team")
    && subject.visibleScopes.includes("assigned_team")
    && audience.teamIds.length > 0
    && audience.teamIds.includes(subject.teamId)
    && (audience.actorIds.length === 0 || audience.actorIds.includes(subject.actorId))
  );
  if (teamAllowed) return { allowed: true, reason: "allowed" };

  if (audience.scopes.includes("role_private")) {
    const actorMatch = audience.actorIds.length > 0 && audience.actorIds.includes(subject.actorId);
    const namespaceMatch = (
      audience.privateNamespaces.length > 0
      && audience.privateNamespaces.some((namespace) => subject.privateNamespaces.includes(namespace))
    );
    if (
      subject.visibleScopes.includes("role_private")
      && (actorMatch || namespaceMatch)
    ) {
      return { allowed: true, reason: "allowed" };
    }
    if (audience.actorIds.length === 0 && audience.privateNamespaces.length === 0) {
      return { allowed: false, reason: "private_namespace_denied" };
    }
    if (!actorMatch && audience.actorIds.length > 0) return { allowed: false, reason: "actor_denied" };
    return { allowed: false, reason: "private_namespace_denied" };
  }

  const teacherAllowed = (
    audience.scopes.includes("teacher_only")
    && subject.actorKind === "teacher"
    && hasCapability(subject, "teacher.read")
  );
  if (teacherAllowed) return { allowed: true, reason: "allowed" };

  if (audience.scopes.includes("audit_only")) {
    return { allowed: false, reason: "audit_denied" };
  }
  if (audience.scopes.includes("assigned_team") && audience.teamIds.length === 0) {
    return { allowed: false, reason: "team_denied" };
  }
  return { allowed: false, reason: "scope_denied" };
}

export function createResourceAudience(input: {
  scopes: VisibilityScope[];
  courseId?: string | null;
  sessionId?: string | null;
  sessionEpoch?: string | null;
  teamIds?: string[];
  roleIds?: ResourceAudience["roleIds"];
  actorIds?: string[];
  privateNamespaces?: string[];
  auditReadable?: boolean;
}): ResourceAudience {
  return ResourceAudienceSchema.parse({
    policyVersion: AccessPolicyVersion,
    courseId: input.courseId ?? null,
    sessionId: input.sessionId ?? null,
    sessionEpoch: input.sessionEpoch ?? null,
    scopes: input.scopes,
    teamIds: input.teamIds ?? [],
    roleIds: input.roleIds ?? [],
    actorIds: input.actorIds ?? [],
    privateNamespaces: input.privateNamespaces ?? [],
    auditReadable: input.auditReadable ?? false,
  });
}

export function roleMemoryNamespace(input: {
  sessionId: string;
  sessionEpoch: string;
  teamId: string;
  actorId: string;
}): string {
  return [
    `session:${input.sessionId}`,
    `epoch:${input.sessionEpoch}`,
    `team:${input.teamId}`,
    `actor:${input.actorId}`,
  ].join("/");
}

export function roleBindingConfigHash(input: {
  scenarioId: string;
  scenarioVersion: string;
  role: RoleContract;
}): string {
  return hashValue({
    scenarioId: input.scenarioId,
    scenarioVersion: input.scenarioVersion,
    agentId: input.role.agentId,
    actorKind: input.role.actorKind,
    roleId: input.role.roleId,
    teamId: input.role.teamId,
    visibleScopes: input.role.visibleScopes,
    privateScopes: input.role.privateScopes,
    allowedIntents: input.role.allowedIntents,
    deniedActions: input.role.deniedActions,
    toolPolicy: input.role.toolPolicy,
    memoryPolicy: input.role.memoryPolicy ?? null,
    communicationPolicy: input.role.communicationPolicy ?? null,
  });
}

export interface ScopedAgentInstanceBinding {
  instanceRef: AgentInstanceRef;
  instanceContext: AgentInstanceContext;
  roleSnapshot: RoleContract;
}

export function createScopedAgentInstanceBinding(input: {
  templateRef: AgentTemplateRef;
  definitionVersion: string;
  roleSnapshot: RoleContract;
  scenarioId: string;
  scenarioVersion: string;
  courseId: string;
  sessionId: string;
  sessionEpoch: string;
  bindingKind: Extract<
    AgentInstanceContext["bindingKind"],
    "student_role" | "teacher_assistant" | "resource" | "system"
  >;
  subjectRole?: RoleContract | null;
  resourceRef?: VersionedObjectRef | null;
  lifecycle?: Extract<AgentInstanceContext["lifecycle"], "active" | "paused" | "retired">;
}): ScopedAgentInstanceBinding {
  const subjectRole = input.subjectRole ?? null;
  const resourceRef = input.resourceRef ?? null;
  const bindingIdentity = {
    templateRef: input.templateRef,
    scenarioId: input.scenarioId,
    scenarioVersion: input.scenarioVersion,
    courseId: input.courseId,
    sessionId: input.sessionId,
    sessionEpoch: input.sessionEpoch,
    agentId: input.roleSnapshot.agentId,
    bindingKind: input.bindingKind,
    subjectActorId: subjectRole?.agentId ?? null,
    subjectRoleId: subjectRole?.roleId ?? null,
    resourceRef,
  };
  const bindingHash = hashValue(bindingIdentity);
  const teamId = subjectRole?.teamId ?? input.roleSnapshot.teamId;
  const roleSnapshot = {
    ...input.roleSnapshot,
    teamId,
  };
  const instanceRef = AgentInstanceRefSchema.parse({
    instanceId: `agent-instance:${bindingHash}`,
    instanceVersion: input.definitionVersion,
  });
  const instanceContext = AgentInstanceContextSchema.parse({
    bindingKind: input.bindingKind,
    bindingId: `agent-binding:${bindingHash}`,
    actorId: roleSnapshot.agentId,
    actorKind: roleSnapshot.actorKind,
    courseId: input.courseId,
    teamId,
    privateMemoryNamespaceRef: roleMemoryNamespace({
      sessionId: input.sessionId,
      sessionEpoch: input.sessionEpoch,
      teamId,
      actorId: `${roleSnapshot.agentId}:${bindingHash.slice(0, 24)}`,
    }),
    configHash: hashValue({
      roleConfigHash: roleBindingConfigHash({
        scenarioId: input.scenarioId,
        scenarioVersion: input.scenarioVersion,
        role: roleSnapshot,
      }),
      bindingIdentity,
    }),
    lifecycle: input.lifecycle ?? "active",
    subjectActorId: subjectRole?.agentId ?? null,
    subjectRoleId: subjectRole?.roleId ?? null,
    resourceRef,
  });
  return {
    instanceRef,
    instanceContext,
    roleSnapshot,
  };
}

export function createAccessSubject(input: {
  role: RoleContract;
  sessionId: string;
  sessionEpoch: string;
  courseId: string;
  purpose: AccessPurpose;
  capabilities?: string[];
}): AccessSubject {
  const namespace = roleMemoryNamespace({
    sessionId: input.sessionId,
    sessionEpoch: input.sessionEpoch,
    teamId: input.role.teamId,
    actorId: input.role.agentId,
  });
  const capabilities = new Set([
    ...input.role.toolPolicy,
    ...(input.capabilities ?? []),
  ]);
  if (input.role.actorKind === "teacher" && input.role.toolPolicy.includes("read_all")) {
    capabilities.add("teacher.read");
    capabilities.add("audit.read");
  }
  return AccessSubjectSchema.parse({
    sessionId: input.sessionId,
    sessionEpoch: input.sessionEpoch,
    courseId: input.courseId,
    actorId: input.role.agentId,
    actorKind: input.role.actorKind,
    roleId: input.role.roleId,
    teamId: input.role.teamId,
    visibleScopes: input.role.visibleScopes,
    privateNamespaces: [...new Set([...input.role.privateScopes, namespace])],
    capabilities: [...capabilities],
    purpose: input.purpose,
  });
}
