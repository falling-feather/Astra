import {
  AgentContextItemSchema,
  AgentPromptContextSchema,
  ContextAssemblerVersion,
  ContextBudgetPolicyVersion,
  ContextManifestSchema,
  ContextSchemaVersion,
  RoleMemorySchemaVersion,
  type AccessSubject,
  type AgentContextItem,
  type AgentContextLayer,
  type AgentPromptContext,
  type ContextManifest,
  type Evidence,
  type RagChunk,
  type ResourceAudience,
  type RoleMemorySnapshot,
  type WorldFact,
} from "@ronggang/contracts";
import {
  authorizeResource,
  createResourceAudience,
  roleMemoryNamespace,
} from "./access.js";
import { hashContent, hashValue } from "./canonical.js";
import {
  AuthorizedRagRetriever,
  RetrieverVersion,
} from "./rag.js";
import type { RoleMemoryService } from "./memory.js";

const layerRatios: Record<AgentContextLayer, number> = {
  fixed: 0.16,
  state: 0.22,
  retrieved: 0.24,
  evidence: 0.14,
  privateMemory: 0.12,
  transient: 0.12,
};

export interface ContextAssemblyResult {
  context: AgentPromptContext;
  manifest: ContextManifest;
}

interface TransientContextInput {
  itemId: string;
  content: string;
  source: string;
  version: string;
  audience: ResourceAudience;
  priority?: number;
}

export interface ContextAssemblyInput {
  subject: AccessSubject;
  scenarioVersion: string;
  scenarioContentHash?: string;
  query: string;
  nodeId: string;
  stateVersion: number;
  tokenBudget: number;
  chunks: readonly RagChunk[];
  facts: readonly WorldFact[];
  evidence: readonly Evidence[];
  transient?: readonly TransientContextInput[];
  fixed?: readonly string[];
  assembledAt?: string;
}

function sourceRef(input: {
  refId: string;
  kind: string;
  source: string;
  version: string;
  content: string;
}) {
  return {
    refId: input.refId,
    kind: input.kind,
    source: input.source,
    version: input.version,
    contentHash: hashContent(input.content),
  };
}

function contextItem(input: {
  itemId: string;
  layer: AgentContextLayer;
  content: string;
  source: string;
  sourceKind: string;
  version: string;
  audience: ResourceAudience;
  priority: number;
  stableOrderKey?: string;
}): AgentContextItem {
  return AgentContextItemSchema.parse({
    itemId: input.itemId,
    layer: input.layer,
    content: input.content,
    contentHash: hashContent(input.content),
    sourceRefs: [sourceRef({
      refId: input.itemId,
      kind: input.sourceKind,
      source: input.source,
      version: input.version,
      content: input.content,
    })],
    audience: input.audience,
    priority: input.priority,
    stableOrderKey: input.stableOrderKey ?? input.itemId,
  });
}

function legacyEntityAudience(
  subject: AccessSubject,
  visibility: ResourceAudience["scopes"][number] | ResourceAudience["scopes"],
  explicit: ResourceAudience | undefined,
): ResourceAudience | null {
  if (explicit) return explicit;
  const scopes = Array.isArray(visibility) ? visibility : [visibility];
  if (scopes.includes("role_private")) return null;
  return createResourceAudience({
    scopes,
    courseId: subject.courseId,
    sessionId: subject.sessionId,
    sessionEpoch: subject.sessionEpoch,
    teamIds: scopes.includes("assigned_team") ? [subject.teamId] : [],
    auditReadable: scopes.includes("audit_only"),
  });
}

function renderedCharacters(item: AgentContextItem): number {
  if (item.layer !== "retrieved") return item.content.length;
  const source = item.sourceRefs[0];
  return `[${item.itemId}] ${source?.source ?? "unknown"}@${source?.version ?? "unknown"}\n${item.content}`.length;
}

function selectWholeItems(
  items: readonly AgentContextItem[],
  characterLimit: number,
): { selected: AgentContextItem[]; dropped: AgentContextItem[] } {
  let used = 0;
  const selected: AgentContextItem[] = [];
  const dropped: AgentContextItem[] = [];
  const ordered = [...items].sort((left, right) => (
    right.priority - left.priority
    || left.stableOrderKey.localeCompare(right.stableOrderKey)
    || left.itemId.localeCompare(right.itemId)
  ));
  for (const item of ordered) {
    const characters = renderedCharacters(item) + (selected.length > 0 ? 1 : 0);
    if (used + characters <= characterLimit) {
      selected.push(item);
      used += characters;
    } else {
      dropped.push(item);
    }
  }
  return { selected, dropped };
}

function manifestItem(item: AgentContextItem) {
  return {
    itemId: item.itemId,
    layer: item.layer,
    contentHash: item.contentHash,
    sourceRefs: item.sourceRefs,
    characters: renderedCharacters(item),
  };
}

export class VersionedContextAssembler {
  readonly #retriever: AuthorizedRagRetriever;
  readonly #memory: RoleMemoryService | null;

  constructor(input: {
    retriever?: AuthorizedRagRetriever;
    memory?: RoleMemoryService | null;
  } = {}) {
    this.#retriever = input.retriever ?? new AuthorizedRagRetriever();
    this.#memory = input.memory ?? null;
  }

  async assemble(input: ContextAssemblyInput): Promise<ContextAssemblyResult> {
    const rag = await this.#retriever.retrieve({
      query: input.query,
      subject: input.subject,
      nodeId: input.nodeId,
      stateVersion: input.stateVersion,
      chunks: input.chunks,
      facts: input.facts,
      evidence: input.evidence,
      ...(input.transient ? { transient: input.transient.map((item) => item.content) } : {}),
    });
    const ownAudience = createResourceAudience({
      scopes: ["role_private", "audit_only"],
      courseId: input.subject.courseId,
      sessionId: input.subject.sessionId,
      sessionEpoch: input.subject.sessionEpoch,
      teamIds: [input.subject.teamId],
      roleIds: [input.subject.roleId],
      actorIds: [input.subject.actorId],
      privateNamespaces: [roleMemoryNamespace({
        sessionId: input.subject.sessionId,
        sessionEpoch: input.subject.sessionEpoch,
        teamId: input.subject.teamId,
        actorId: input.subject.actorId,
      })],
      auditReadable: true,
    });
    const fixedItems = [
      ...(input.fixed ?? []),
      ...rag.layers.fixed,
    ].map((content, index) => contextItem({
      itemId: `fixed:${index + 1}`,
      layer: "fixed",
      content,
      source: "runtime-policy",
      sourceKind: "policy",
      version: ContextSchemaVersion,
      audience: ownAudience,
      priority: 1_000 - index,
    }));

    let postRejectedCount = rag.acl.postRejectedCount;
    const stateItems = input.facts.flatMap((fact) => {
      const audience = legacyEntityAudience(input.subject, fact.visibility, fact.audience);
      if (!audience || !authorizeResource(input.subject, audience).allowed) {
        postRejectedCount += 1;
        return [];
      }
      return [contextItem({
        itemId: `fact:${fact.factId}`,
        layer: "state",
        content: `${fact.factId}: ${fact.statement}`,
        source: fact.sourceRefs.join(",") || "world-fact",
        sourceKind: "world_fact",
        version: fact.version,
        audience,
        priority: fact.status === "verified" ? 900 : 700,
      })];
    });
    const retrievedItems = rag.layers.retrieved.map((chunk) => contextItem({
      itemId: chunk.chunkId,
      layer: "retrieved",
      content: chunk.content,
      source: chunk.source,
      sourceKind: "rag_chunk",
      version: chunk.version,
      audience: chunk.audience,
      priority: 800,
    }));
    const evidenceItems = input.evidence.flatMap((evidence) => {
      const audience = legacyEntityAudience(input.subject, evidence.visibility, evidence.audience);
      if (!audience || !authorizeResource(input.subject, audience).allowed) {
        postRejectedCount += 1;
        return [];
      }
      return [contextItem({
        itemId: `evidence:${evidence.evidenceId}`,
        layer: "evidence",
        content: `${evidence.evidenceId}: ${evidence.action}｜${evidence.basis}`,
        source: evidence.materialRefs.join(",") || evidence.eventRefs.join(",") || "world-evidence",
        sourceKind: "evidence",
        version: evidence.createdAt,
        audience,
        priority: 700,
      })];
    });

    let memorySnapshot: RoleMemorySnapshot | null = null;
    if (this.#memory && input.subject.capabilities.includes("memory.read.own")) {
      memorySnapshot = await this.#memory.read(input.subject);
    }
    const privateMemoryItems = (memorySnapshot?.entries ?? [])
      .filter((entry) => entry.status === "active")
      .map((entry) => contextItem({
        itemId: `memory:${entry.memoryId}`,
        layer: "privateMemory",
        content: entry.content,
        source: entry.lastDeltaId,
        sourceKind: "role_memory",
        version: String(entry.revision),
        audience: createResourceAudience({
          scopes: ["role_private", "audit_only"],
          courseId: input.subject.courseId,
          sessionId: input.subject.sessionId,
          sessionEpoch: input.subject.sessionEpoch,
          teamIds: [entry.ownerTeamId],
          roleIds: [entry.ownerRoleId],
          actorIds: [entry.ownerActorId],
          privateNamespaces: [entry.namespace],
          auditReadable: entry.auditReadable,
        }),
        priority: 750,
      }));
    const transientItems = (input.transient ?? []).map((item) => contextItem({
      itemId: item.itemId,
      layer: "transient",
      content: item.content,
      source: item.source,
      sourceKind: "trigger",
      version: item.version,
      audience: item.audience,
      priority: item.priority ?? 850,
    }));

    const candidates: AgentPromptContext = {
      fixed: fixedItems,
      state: stateItems,
      retrieved: retrievedItems,
      evidence: evidenceItems,
      privateMemory: privateMemoryItems,
      transient: transientItems,
    };
    const totalCharacters = Math.max(800, input.tokenBudget * 4);
    const selected: AgentPromptContext = {
      fixed: [],
      state: [],
      retrieved: [],
      evidence: [],
      privateMemory: [],
      transient: [],
    };
    const dropped: AgentContextItem[] = [];
    for (const layer of Object.keys(layerRatios) as AgentContextLayer[]) {
      const layerCandidates = candidates[layer] as AgentContextItem[];
      const authorized = layerCandidates.filter((item) => {
        const allowed = (
          item.layer === layer
          && hashContent(item.content) === item.contentHash
          && authorizeResource(input.subject, item.audience).allowed
        );
        if (!allowed) postRejectedCount += 1;
        return allowed;
      });
      const selection = selectWholeItems(authorized, Math.floor(totalCharacters * layerRatios[layer]));
      (selected[layer] as AgentContextItem[]).push(...selection.selected);
      dropped.push(...selection.dropped);
    }
    const context = AgentPromptContextSchema.parse(selected);
    const emptyMemoryBase = {
      schemaVersion: RoleMemorySchemaVersion,
      sessionId: input.subject.sessionId,
      sessionEpoch: input.subject.sessionEpoch,
      namespace: roleMemoryNamespace({
        sessionId: input.subject.sessionId,
        sessionEpoch: input.subject.sessionEpoch,
        teamId: input.subject.teamId,
        actorId: input.subject.actorId,
      }),
      projectionVersion: 0,
      entries: [],
    };
    const manifest = ContextManifestSchema.parse({
      contextSchemaVersion: ContextSchemaVersion,
      assemblerVersion: ContextAssemblerVersion,
      aclPolicyVersion: rag.policyVersion,
      retrieverVersion: rag.retrieverVersion ?? RetrieverVersion,
      corpusVersion: rag.corpusVersion,
      budgetPolicyVersion: ContextBudgetPolicyVersion,
      memoryPolicyVersion: RoleMemorySchemaVersion,
      scenarioVersion: input.scenarioVersion,
      scenarioContentHash: input.scenarioContentHash ?? null,
      sessionId: input.subject.sessionId,
      sessionEpoch: input.subject.sessionEpoch,
      actorId: input.subject.actorId,
      roleId: input.subject.roleId,
      teamId: input.subject.teamId,
      stateVersion: input.stateVersion,
      queryHash: hashContent(input.query),
      accessSubjectHash: hashValue(input.subject),
      contextHash: hashValue(context),
      memorySnapshotHash: memorySnapshot?.snapshotHash ?? hashValue(emptyMemoryBase),
      layers: {
        fixed: context.fixed.map(manifestItem),
        state: context.state.map(manifestItem),
        retrieved: context.retrieved.map(manifestItem),
        evidence: context.evidence.map(manifestItem),
        privateMemory: context.privateMemory.map(manifestItem),
        transient: context.transient.map(manifestItem),
      },
      droppedItems: dropped.map(manifestItem),
      includedCitationRefs: context.retrieved.map((item) => item.itemId),
      acl: {
        preRejectedCount: rag.acl.preRejectedCount,
        postRejectedCount,
      },
      assembledAt: input.assembledAt ?? new Date().toISOString(),
    });
    return { context, manifest };
  }
}
