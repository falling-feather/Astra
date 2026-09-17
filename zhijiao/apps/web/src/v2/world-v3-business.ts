import { WorkSupplementV3Schema } from "@ronggang/contracts";
import {
  AdminAgentCollaborationEpisodeV3Schema,
  SimulationReleaseReferenceSchema,
  TeacherAgentCollaborationEpisodeV3Schema,
  type AdminAgentCollaborationEpisodeV3,
  type SimulationReleaseReference,
  type TeacherAgentCollaborationEpisodeV3,
} from "@ronggang/contracts";
import { WireFormatError } from "./wire";
import {
  booleanOf,
  contentHashOf,
  exactRecord,
  integerOf,
  listOf,
  nullableTextOf,
  numberOf,
  oneOf,
  parseFlagshipWorldResponse,
  stringOf,
  textOf,
  type FlagshipAvailableAction,
  type FlagshipWorkRevision,
  type FlagshipWorldBand,
  type FlagshipWorldView,
} from "./world-v3";

export type FlagshipBusinessAudience = "teacher" | "admin";

export interface FlagshipBusinessWorldView extends Omit<
  FlagshipWorldView,
  "audience" | "indicators" | "facts" | "relationships"
> {
  audience: FlagshipBusinessAudience;
  indicators: Array<{
    variableId: string;
    title: string;
    band: FlagshipWorldBand;
    studentProjection: string;
    value: number;
    delta: number;
    minimum: number;
    maximum: number;
  }>;
  facts: Array<{
    factId: string;
    status: "unknown" | "rumor" | "corroborated" | "confirmed" | "refuted";
    confidenceBand: FlagshipWorldBand;
    confidence: number;
    sourceRefs: string[];
  }>;
  relationships: Array<{
    relationshipId: string;
    sourceEntityId: string;
    targetEntityId: string;
    trustBand: FlagshipWorldBand;
    tensionBand: FlagshipWorldBand;
    trust: number;
    tension: number;
    influence: number;
  }>;
  queue?: unknown[];
  resolutions?: unknown[];
  consequences?: unknown[];
  availableActions: FlagshipAvailableAction[];
}

export interface FlagshipWorkReviewArtifact {
  artifactId: string;
  title: string;
  artifactKind: string;
  required: boolean;
  status: "empty" | "draft" | "submitted";
  revisionCount: number;
  submittedRevisionId: string | null;
  latestRevision: FlagshipWorkRevision | null;
  submittedSupplement?: import("@ronggang/contracts").WorkSupplementV3 | null;
  mechanicalCompletion: {
    mechanicalReady: boolean;
    missingFields: string[];
    evidenceReady: boolean;
    minimumEvidenceCount: number;
    revisionReady: boolean;
  };
  updatedAt: string | null;
}

export interface FlagshipWorkReviewView {
  schemaVersion: "flagship-work-review/3.0.0";
  sessionId: string;
  challengeLevel: 3 | 4 | 5 | 6 | 7;
  manifest: { manifestId: string; contentHash: string; title: string };
  completion: {
    requiredArtifactCount: number;
    submittedRequiredCount: number;
    readyForPublication: boolean;
  };
  artifacts: FlagshipWorkReviewArtifact[];
  updatedAt: string | null;
}

export interface FlagshipAgentTopologyGroupV3 {
  groupId: string;
  title: string;
  responsibility: string;
  order: number;
}

export interface FlagshipAgentTopologyNodeV3 {
  agentId: string;
  agentTemplateId: string;
  professionalRoleId: string;
  displayName: string;
  responsibility: string;
  groupId: string;
  contributionKind: "world_actor" | "professional_advisor";
  subscribedEventTypes: string[];
  affectedObjectSelectors: Array<{ objectType: string; objectId: string | null }>;
  toolCapabilityRefs: string[];
  disclosurePolicyRef: string;
  actionBudget: number;
  dispatchPriority: number;
  enabled: boolean;
  available: boolean;
  authority: "proposal_only";
  forbiddenActions: string[];
}

export interface FlagshipAgentTopologyV3 {
  schemaVersion: "simulation-agent-topology/3.0.0";
  sessionId: string;
  simulationReleaseRef: SimulationReleaseReference;
  generatedAt: string;
  groups: FlagshipAgentTopologyGroupV3[];
  agents: FlagshipAgentTopologyNodeV3[];
}

export interface DecideFlagshipTeacherGateInput {
  sessionId: string;
  bindingId: string;
  episodeId: string;
  decision: "approved" | "revised" | "rejected";
  teacherDecisionRef: string;
  revisionPolicy: "reduce_effects" | null;
  revisedConsequenceSummary: string | null;
}

function textList(value: unknown, label: string): string[] {
  return listOf(value, label).map((item, index) => textOf(item, `${label}[${index}]`));
}

function parseRevision(value: unknown, label: string): FlagshipWorkRevision {
  const revision = exactRecord(value, [
    "revisionId", "artifactId", "revisionNumber", "parentRevisionId", "fields",
    "evidenceRefs", "revisionNote", "contentHash", "createdAt",
  ], label);
  return {
    revisionId: textOf(revision.revisionId, `${label}.revisionId`),
    artifactId: textOf(revision.artifactId, `${label}.artifactId`),
    revisionNumber: integerOf(revision.revisionNumber, `${label}.revisionNumber`),
    parentRevisionId: nullableTextOf(revision.parentRevisionId, `${label}.parentRevisionId`),
    fields: listOf(revision.fields, `${label}.fields`).map((item, index) => {
      const field = exactRecord(item, ["fieldId", "content"], `${label}.fields[${index}]`);
      return {
        fieldId: textOf(field.fieldId, `${label}.fields[${index}].fieldId`),
        content: stringOf(field.content, `${label}.fields[${index}].content`),
      };
    }),
    evidenceRefs: textList(revision.evidenceRefs, `${label}.evidenceRefs`),
    revisionNote: textOf(revision.revisionNote, `${label}.revisionNote`),
    contentHash: contentHashOf(revision.contentHash, `${label}.contentHash`),
    createdAt: textOf(revision.createdAt, `${label}.createdAt`),
  };
}

export function parseFlagshipBusinessWorldResponse(
  value: unknown,
  expectedAudience: FlagshipBusinessAudience,
): FlagshipBusinessWorldView {
  const root = exactRecord(value, ["world"], "FlagshipBusinessWorldResponse");
  const baseKeys = [
    "schemaVersion", "audience", "sessionId", "title", "summary",
    "worldStateVersion", "virtualTime", "challenge", "entities", "indicators",
    "facts", "relationships", "resources", "endingState", "availableActions",
  ] as const;
  const world = exactRecord(
    root.world,
    expectedAudience === "admin"
      ? [...baseKeys, "queue", "resolutions", "consequences"]
      : baseKeys,
    "FlagshipBusinessWorldView",
  );
  if (world.audience !== expectedAudience) {
    throw new WireFormatError("旗舰世界响应与已认证角色不一致");
  }
  const rawIndicators = listOf(world.indicators, "indicators");
  const rawFacts = listOf(world.facts, "facts");
  const rawRelationships = listOf(world.relationships, "relationships");
  const {
    queue: _queue,
    resolutions: _resolutions,
    consequences: _consequences,
    ...baseWorld
  } = world;
  const studentProjection = parseFlagshipWorldResponse({
    world: {
      ...baseWorld,
      audience: "student",
      indicators: rawIndicators.map((item, index) => {
        const indicator = exactRecord(item, [
          "variableId", "title", "band", "studentProjection", "value", "delta", "minimum", "maximum",
        ], `indicators[${index}]`);
        const { value: _value, delta: _delta, minimum: _minimum, maximum: _maximum, ...safe } = indicator;
        return safe;
      }),
      facts: rawFacts.map((item, index) => {
        const fact = exactRecord(item, [
          "factId", "status", "confidenceBand", "confidence", "sourceRefs",
        ], `facts[${index}]`);
        const { confidence: _confidence, sourceRefs: _sourceRefs, ...safe } = fact;
        return safe;
      }),
      relationships: rawRelationships.map((item, index) => {
        const relationship = exactRecord(item, [
          "relationshipId", "sourceEntityId", "targetEntityId", "trustBand", "tensionBand",
          "trust", "tension", "influence",
        ], `relationships[${index}]`);
        const { trust: _trust, tension: _tension, influence: _influence, ...safe } = relationship;
        return safe;
      }),
    },
  });
  const safeWorld = { ...studentProjection } as Omit<FlagshipWorldView, "audience">;
  return {
    ...safeWorld,
    audience: expectedAudience,
    indicators: rawIndicators.map((item, index) => {
      const indicator = exactRecord(item, [
        "variableId", "title", "band", "studentProjection", "value", "delta", "minimum", "maximum",
      ], `indicators[${index}]`);
      return {
        variableId: textOf(indicator.variableId, `indicators[${index}].variableId`),
        title: textOf(indicator.title, `indicators[${index}].title`),
        band: oneOf(indicator.band, ["low", "medium", "high"] as const, `indicators[${index}].band`),
        studentProjection: textOf(indicator.studentProjection, `indicators[${index}].studentProjection`),
        value: numberOf(indicator.value, `indicators[${index}].value`),
        delta: numberOf(indicator.delta, `indicators[${index}].delta`),
        minimum: numberOf(indicator.minimum, `indicators[${index}].minimum`),
        maximum: numberOf(indicator.maximum, `indicators[${index}].maximum`),
      };
    }),
    facts: rawFacts.map((item, index) => {
      const fact = exactRecord(item, [
        "factId", "status", "confidenceBand", "confidence", "sourceRefs",
      ], `facts[${index}]`);
      return {
        factId: textOf(fact.factId, `facts[${index}].factId`),
        status: oneOf(fact.status, ["unknown", "rumor", "corroborated", "confirmed", "refuted"] as const, `facts[${index}].status`),
        confidenceBand: oneOf(fact.confidenceBand, ["low", "medium", "high"] as const, `facts[${index}].confidenceBand`),
        confidence: numberOf(fact.confidence, `facts[${index}].confidence`),
        sourceRefs: textList(fact.sourceRefs, `facts[${index}].sourceRefs`),
      };
    }),
    relationships: rawRelationships.map((item, index) => {
      const relationship = exactRecord(item, [
        "relationshipId", "sourceEntityId", "targetEntityId", "trustBand", "tensionBand",
        "trust", "tension", "influence",
      ], `relationships[${index}]`);
      return {
        relationshipId: textOf(relationship.relationshipId, `relationships[${index}].relationshipId`),
        sourceEntityId: textOf(relationship.sourceEntityId, `relationships[${index}].sourceEntityId`),
        targetEntityId: textOf(relationship.targetEntityId, `relationships[${index}].targetEntityId`),
        trustBand: oneOf(relationship.trustBand, ["low", "medium", "high"] as const, `relationships[${index}].trustBand`),
        tensionBand: oneOf(relationship.tensionBand, ["low", "medium", "high"] as const, `relationships[${index}].tensionBand`),
        trust: numberOf(relationship.trust, `relationships[${index}].trust`),
        tension: numberOf(relationship.tension, `relationships[${index}].tension`),
        influence: numberOf(relationship.influence, `relationships[${index}].influence`),
      };
    }),
    ...(expectedAudience === "admin" ? {
      queue: listOf(world.queue, "queue"),
      resolutions: listOf(world.resolutions, "resolutions"),
      consequences: listOf(world.consequences, "consequences"),
    } : {}),
  };
}

export function parseFlagshipTeacherEpisodeResponse(
  value: unknown,
): TeacherAgentCollaborationEpisodeV3 {
  const root = exactRecord(value, ["episode"], "FlagshipTeacherEpisodeResponse");
  return TeacherAgentCollaborationEpisodeV3Schema.parse(root.episode);
}

export function parseFlagshipAdminEpisodeResponse(
  value: unknown,
): AdminAgentCollaborationEpisodeV3 {
  const root = exactRecord(value, ["episode"], "FlagshipAdminEpisodeResponse");
  return AdminAgentCollaborationEpisodeV3Schema.parse(root.episode);
}

export function parseFlagshipTeacherGateResponse(
  value: unknown,
  expectedAudience: FlagshipBusinessAudience,
): TeacherAgentCollaborationEpisodeV3 | AdminAgentCollaborationEpisodeV3 {
  const root = exactRecord(value, ["episode"], "FlagshipTeacherGateResponse");
  return expectedAudience === "teacher"
    ? TeacherAgentCollaborationEpisodeV3Schema.parse(root.episode)
    : AdminAgentCollaborationEpisodeV3Schema.parse(root.episode);
}

export function parseFlagshipWorkReviewResponse(value: unknown): FlagshipWorkReviewView {
  const root = exactRecord(value, ["review"], "FlagshipWorkReviewResponse");
  const review = exactRecord(root.review, [
    "schemaVersion", "sessionId", "challengeLevel", "manifest", "completion", "artifacts", "updatedAt",
  ], "FlagshipWorkReviewView");
  if (review.schemaVersion !== "flagship-work-review/3.0.0") {
    throw new WireFormatError("旗舰作品送审视图版本不受支持");
  }
  const manifest = exactRecord(review.manifest, ["manifestId", "contentHash", "title"], "review.manifest");
  const completion = exactRecord(review.completion, [
    "requiredArtifactCount", "submittedRequiredCount", "readyForPublication",
  ], "review.completion");
  return {
    schemaVersion: "flagship-work-review/3.0.0",
    sessionId: textOf(review.sessionId, "review.sessionId"),
    challengeLevel: oneOf(review.challengeLevel, [3, 4, 5, 6, 7] as const, "review.challengeLevel"),
    manifest: {
      manifestId: textOf(manifest.manifestId, "manifest.manifestId"),
      contentHash: contentHashOf(manifest.contentHash, "manifest.contentHash"),
      title: textOf(manifest.title, "manifest.title"),
    },
    completion: {
      requiredArtifactCount: integerOf(completion.requiredArtifactCount, "completion.requiredArtifactCount"),
      submittedRequiredCount: integerOf(completion.submittedRequiredCount, "completion.submittedRequiredCount"),
      readyForPublication: booleanOf(completion.readyForPublication, "completion.readyForPublication"),
    },
    artifacts: listOf(review.artifacts, "review.artifacts").map((item, index) => {
      const artifact = exactRecord(item, [
        "artifactId", "title", "artifactKind", "required", "status", "revisionCount",
        "submittedRevisionId", "latestRevision", "mechanicalCompletion", "updatedAt", "submittedSupplement",
      ], `review.artifacts[${index}]`);
      const mechanical = exactRecord(artifact.mechanicalCompletion, [
        "mechanicalReady", "missingFields", "evidenceReady", "minimumEvidenceCount", "revisionReady",
      ], `review.artifacts[${index}].mechanicalCompletion`);
      return {
        artifactId: textOf(artifact.artifactId, `review.artifacts[${index}].artifactId`),
        title: textOf(artifact.title, `review.artifacts[${index}].title`),
        artifactKind: textOf(artifact.artifactKind, `review.artifacts[${index}].artifactKind`),
        required: booleanOf(artifact.required, `review.artifacts[${index}].required`),
        status: oneOf(artifact.status, ["empty", "draft", "submitted"] as const, `review.artifacts[${index}].status`),
        revisionCount: integerOf(artifact.revisionCount, `review.artifacts[${index}].revisionCount`),
        submittedRevisionId: nullableTextOf(artifact.submittedRevisionId, `review.artifacts[${index}].submittedRevisionId`),
        latestRevision: artifact.latestRevision === null
          ? null
          : parseRevision(artifact.latestRevision, `review.artifacts[${index}].latestRevision`),
        submittedSupplement: artifact.submittedSupplement == null ? null : WorkSupplementV3Schema.parse(artifact.submittedSupplement),
        mechanicalCompletion: {
          mechanicalReady: booleanOf(mechanical.mechanicalReady, `review.artifacts[${index}].mechanicalReady`),
          missingFields: textList(mechanical.missingFields, `review.artifacts[${index}].missingFields`),
          evidenceReady: booleanOf(mechanical.evidenceReady, `review.artifacts[${index}].evidenceReady`),
          minimumEvidenceCount: integerOf(mechanical.minimumEvidenceCount, `review.artifacts[${index}].minimumEvidenceCount`),
          revisionReady: booleanOf(mechanical.revisionReady, `review.artifacts[${index}].revisionReady`),
        },
        updatedAt: nullableTextOf(artifact.updatedAt, `review.artifacts[${index}].updatedAt`),
      };
    }),
    updatedAt: nullableTextOf(review.updatedAt, "review.updatedAt"),
  };
}

export function parseFlagshipAgentTopologyResponse(value: unknown): FlagshipAgentTopologyV3 {
  const root = exactRecord(value, ["topology"], "FlagshipAgentTopologyResponse");
  const topology = exactRecord(root.topology, [
    "schemaVersion", "sessionId", "simulationReleaseRef", "generatedAt", "groups", "agents",
  ], "FlagshipAgentTopologyV3");
  if (topology.schemaVersion !== "simulation-agent-topology/3.0.0") {
    throw new WireFormatError("旗舰智能体拓扑版本不受支持");
  }
  const groups = listOf(topology.groups, "topology.groups").map((item, index) => {
    const group = exactRecord(item, ["groupId", "title", "responsibility", "order"], `topology.groups[${index}]`);
    return {
      groupId: textOf(group.groupId, `topology.groups[${index}].groupId`),
      title: textOf(group.title, `topology.groups[${index}].title`),
      responsibility: textOf(group.responsibility, `topology.groups[${index}].responsibility`),
      order: integerOf(group.order, `topology.groups[${index}].order`),
    };
  });
  const agents = listOf(topology.agents, "topology.agents").map((item, index) => {
    const agent = exactRecord(item, [
      "agentId", "agentTemplateId", "professionalRoleId", "displayName", "responsibility", "groupId",
      "contributionKind", "subscribedEventTypes", "affectedObjectSelectors", "toolCapabilityRefs",
      "disclosurePolicyRef", "actionBudget", "dispatchPriority", "enabled", "available", "authority",
      "forbiddenActions",
    ], `topology.agents[${index}]`);
    return {
      agentId: textOf(agent.agentId, `topology.agents[${index}].agentId`),
      agentTemplateId: textOf(agent.agentTemplateId, `topology.agents[${index}].agentTemplateId`),
      professionalRoleId: textOf(agent.professionalRoleId, `topology.agents[${index}].professionalRoleId`),
      displayName: textOf(agent.displayName, `topology.agents[${index}].displayName`),
      responsibility: textOf(agent.responsibility, `topology.agents[${index}].responsibility`),
      groupId: textOf(agent.groupId, `topology.agents[${index}].groupId`),
      contributionKind: oneOf(agent.contributionKind, ["world_actor", "professional_advisor"] as const, `topology.agents[${index}].contributionKind`),
      subscribedEventTypes: textList(agent.subscribedEventTypes, `topology.agents[${index}].subscribedEventTypes`),
      affectedObjectSelectors: listOf(agent.affectedObjectSelectors, `topology.agents[${index}].affectedObjectSelectors`).map((selector, selectorIndex) => {
        const reference = exactRecord(selector, ["objectType", "objectId"], `topology.agents[${index}].affectedObjectSelectors[${selectorIndex}]`);
        return {
          objectType: textOf(reference.objectType, "selector.objectType"),
          objectId: nullableTextOf(reference.objectId, "selector.objectId"),
        };
      }),
      toolCapabilityRefs: textList(agent.toolCapabilityRefs, `topology.agents[${index}].toolCapabilityRefs`),
      disclosurePolicyRef: textOf(agent.disclosurePolicyRef, `topology.agents[${index}].disclosurePolicyRef`),
      actionBudget: integerOf(agent.actionBudget, `topology.agents[${index}].actionBudget`),
      dispatchPriority: integerOf(agent.dispatchPriority, `topology.agents[${index}].dispatchPriority`),
      enabled: booleanOf(agent.enabled, `topology.agents[${index}].enabled`),
      available: booleanOf(agent.available, `topology.agents[${index}].available`),
      authority: oneOf(agent.authority, ["proposal_only"] as const, `topology.agents[${index}].authority`),
      forbiddenActions: textList(agent.forbiddenActions, `topology.agents[${index}].forbiddenActions`),
    };
  });
  if (groups.length !== 6 || agents.length !== 14) {
    throw new WireFormatError("旗舰智能体拓扑必须保持六组十四个受控智能体");
  }
  const groupIds = new Set(groups.map((group) => group.groupId));
  if (groupIds.size !== 6 || agents.some((agent) => !groupIds.has(agent.groupId))) {
    throw new WireFormatError("旗舰智能体拓扑职责组引用不一致");
  }
  return {
    schemaVersion: "simulation-agent-topology/3.0.0",
    sessionId: textOf(topology.sessionId, "topology.sessionId"),
    simulationReleaseRef: SimulationReleaseReferenceSchema.parse(topology.simulationReleaseRef),
    generatedAt: textOf(topology.generatedAt, "topology.generatedAt"),
    groups,
    agents,
  };
}
