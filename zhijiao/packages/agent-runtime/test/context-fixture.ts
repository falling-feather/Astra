import {
  AccessPolicyVersion,
  ContextAssemblerVersion,
  ContextBudgetPolicyVersion,
  ContextSchemaVersion,
  RoleMemorySchemaVersion,
  type AgentContextItem,
  type AgentContextLayer,
  type AgentPromptContext,
  type ContextManifest,
  type RoleContract,
} from "@ronggang/contracts";
import {
  createAccessSubject,
  createResourceAudience,
  hashContent,
  hashValue,
  roleMemoryNamespace,
} from "@ronggang/context-engine";

interface LayerValue {
  itemId: string;
  content: string;
  source?: string;
  version?: string;
}

export function buildAgentContext(input: {
  role: RoleContract;
  sessionId: string;
  sessionEpoch?: string;
  courseId?: string;
  stateVersion: number;
  fixed?: LayerValue[];
  state?: LayerValue[];
  retrieved?: LayerValue[];
  evidence?: LayerValue[];
  privateMemory?: LayerValue[];
  transient?: LayerValue[];
}) {
  const sessionEpoch = input.sessionEpoch ?? "epoch-test";
  const courseId = input.courseId ?? "course-converged-media-practice";
  const access = createAccessSubject({
    role: input.role,
    sessionId: input.sessionId,
    sessionEpoch,
    courseId,
    purpose: "runtime",
  });
  const namespace = roleMemoryNamespace({
    sessionId: input.sessionId,
    sessionEpoch,
    teamId: input.role.teamId,
    actorId: input.role.agentId,
  });
  const audience = createResourceAudience({
    scopes: ["role_private", "audit_only"],
    courseId,
    sessionId: input.sessionId,
    sessionEpoch,
    teamIds: [input.role.teamId],
    roleIds: [input.role.roleId],
    actorIds: [input.role.agentId],
    privateNamespaces: [namespace],
    auditReadable: true,
  });
  const createItems = (layer: AgentContextLayer, values: LayerValue[] = []): AgentContextItem[] => (
    values.map((value, index) => {
      const contentHash = hashContent(value.content);
      return {
        itemId: value.itemId,
        layer,
        content: value.content,
        contentHash,
        sourceRefs: [{
          refId: value.itemId,
          kind: layer,
          source: value.source ?? `test:${layer}`,
          version: value.version ?? "1",
          contentHash,
        }],
        audience,
        priority: 100 - index,
        stableOrderKey: value.itemId,
      };
    })
  );
  const context: AgentPromptContext = {
    fixed: createItems("fixed", input.fixed),
    state: createItems("state", input.state),
    retrieved: createItems("retrieved", input.retrieved),
    evidence: createItems("evidence", input.evidence),
    privateMemory: createItems("privateMemory", input.privateMemory),
    transient: createItems("transient", input.transient),
  };
  const manifestItem = (item: AgentContextItem) => ({
    itemId: item.itemId,
    layer: item.layer,
    contentHash: item.contentHash,
    sourceRefs: item.sourceRefs,
    characters: item.content.length,
  });
  const contextManifest: ContextManifest = {
    contextSchemaVersion: ContextSchemaVersion,
    assemblerVersion: ContextAssemblerVersion,
    aclPolicyVersion: AccessPolicyVersion,
    retrieverVersion: "test-retriever/1",
    corpusVersion: "test-corpus/1",
    budgetPolicyVersion: ContextBudgetPolicyVersion,
    memoryPolicyVersion: RoleMemorySchemaVersion,
    scenarioVersion: "0.4.1",
    scenarioContentHash: null,
    sessionId: input.sessionId,
    sessionEpoch,
    actorId: input.role.agentId,
    roleId: input.role.roleId,
    teamId: input.role.teamId,
    stateVersion: input.stateVersion,
    queryHash: hashContent("test-query"),
    accessSubjectHash: hashValue(access),
    contextHash: hashValue(context),
    memorySnapshotHash: hashValue({ namespace, entries: context.privateMemory.map((item) => item.contentHash) }),
    layers: {
      fixed: context.fixed.map(manifestItem),
      state: context.state.map(manifestItem),
      retrieved: context.retrieved.map(manifestItem),
      evidence: context.evidence.map(manifestItem),
      privateMemory: context.privateMemory.map(manifestItem),
      transient: context.transient.map(manifestItem),
    },
    droppedItems: [],
    includedCitationRefs: context.retrieved.map((item) => item.itemId),
    acl: { preRejectedCount: 0, postRejectedCount: 0 },
    assembledAt: "2026-07-24T08:00:00.000Z",
  };
  return { access, context, contextManifest };
}
