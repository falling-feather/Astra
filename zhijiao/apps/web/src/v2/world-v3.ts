import {
  StudentAgentCollaborationEpisodeV3Schema,
  WorkSupplementV3Schema,
  type StudentAgentCollaborationEpisodeV3,
  type StudentWorkAction,
} from "@ronggang/contracts";
import { WireFormatError } from "./wire";

export type FlagshipWorldBand = "low" | "medium" | "high";

export interface FlagshipWorldView {
  schemaVersion: "simulation-world-view/3.0.0";
  audience: "student";
  sessionId: string;
  title: string;
  summary: string;
  worldStateVersion: number;
  virtualTime: {
    startedAt: string;
    currentAt: string;
    deadlineAt: string;
    elapsedMinutes: number;
    remainingMinutes: number;
    paused: boolean;
  };
  challenge: {
    level: 3 | 4 | 5 | 6 | 7;
    scoreCeiling: 80 | 85 | 90 | 95 | 100;
    scaffoldingLevel: number;
  };
  entities: Array<{
    entityId: string;
    title: string;
    kind: string;
    professionalRole: string | null;
    status: "available" | "busy" | "withheld" | "left" | "closed";
    publicSummary: string;
    revision: number;
  }>;
  indicators: Array<{
    variableId: string;
    title: string;
    band: FlagshipWorldBand;
    studentProjection: string;
  }>;
  facts: Array<{
    factId: string;
    status: "unknown" | "rumor" | "corroborated" | "confirmed" | "refuted";
    confidenceBand: FlagshipWorldBand;
  }>;
  relationships: Array<{
    relationshipId: string;
    sourceEntityId: string;
    targetEntityId: string;
    trustBand: FlagshipWorldBand;
    tensionBand: FlagshipWorldBand;
  }>;
  resources: Array<{
    resourceId: string;
    resourceKind: string;
    amount: number;
    unit: string;
  }>;
  endingState: {
    status: "active" | "recoverable_failure" | "completed";
    endingRef: string | null;
  };
  availableActions: FlagshipAvailableAction[];
}

export interface FlagshipAvailableAction {
  eventTemplateId: string;
  eventType: string;
  serverIssuedActionRef: string;
  title: string;
  cue: string;
  affectedObjectRefs: Array<{
    objectType: string;
    objectId: string;
  }>;
}

export interface SubmitFlagshipWorldActionInput {
  sessionId: string;
  bindingId: string;
  requestId: string;
  eventTemplateId: string;
  serverIssuedActionRef: string;
  expectedWorldStateVersion: number;
  action: StudentWorkAction["action"];
  sourceWorldEventIds: string[];
  reflectionNote: string;
}

export interface DecideFlagshipEpisodeInput {
  sessionId: string;
  bindingId: string;
  episodeId: string;
  decisionRef: string;
  decision: "accept" | "request_evidence" | "reject";
  rationale: string;
}

export interface FlagshipAdvanceResult {
  advance: {
    scheduled: boolean;
    reason: string;
    eventId: string | null;
  };
  episode: StudentAgentCollaborationEpisodeV3;
}

export interface FlagshipEvidenceOption {
  evidenceRef: string;
  kind: "knowledge" | "world_event" | "world_evidence";
  label: string;
  detail: string;
  eventType: string | null;
}

export interface FlagshipWorkRevision {
  revisionId: string;
  artifactId: string;
  revisionNumber: number;
  parentRevisionId: string | null;
  fields: Array<{ fieldId: string; content: string }>;
  evidenceRefs: string[];
  revisionNote: string;
  contentHash: string;
  createdAt: string;
}

export interface FlagshipWorkspaceArtifact {
  artifactId: string;
  title: string;
  artifactKind: string;
  required: boolean;
  conflictDomainRefs: string[];
  editableFields: Array<{
    fieldId: string;
    label: string;
    minimumLength: number;
    maximumLength: number;
  }>;
  completionChecks: string[];
  evidenceRequirements: string[];
  status: "empty" | "draft" | "submitted";
  revisionCount: number;
  latestRevision: FlagshipWorkRevision | null;
  submittedSupplement?: import("@ronggang/contracts").WorkSupplementV3 | null;
  mechanicalCompletion: {
    mechanicalReady: boolean;
    missingFields: string[];
    evidenceReady: boolean;
    minimumEvidenceCount: number;
    revisionReady: boolean;
  };
  updatedAt: string;
}

export interface FlagshipWorkspaceView {
  schemaVersion: "flagship-student-workspace/3.0.0";
  sessionId: string;
  challengeLevel: 3 | 4 | 5 | 6 | 7;
  manifest: {
    manifestId: string;
    contentHash: string;
    title: string;
    expectedDurationMinutes: number;
  };
  completion: {
    requiredArtifactCount: number;
    submittedRequiredCount: number;
    readyForPublication: boolean;
    blockingArtifactTitles: string[];
  };
  evidenceCatalog: FlagshipEvidenceOption[];
  artifacts: FlagshipWorkspaceArtifact[];
  updatedAt: string;
}

export interface SaveFlagshipWorkRevisionInput {
  sessionId: string;
  bindingId: string;
  artifactId: string;
  requestId: string;
  expectedRevisionNumber: number;
  fields: Array<{ fieldId: string; content: string }>;
  evidenceRefs: string[];
  revisionNote: string;
}

export interface SubmitFlagshipWorkRevisionInput {
  sessionId: string;
  bindingId: string;
  artifactId: string;
  requestId: string;
  revisionId: string;
  contentHash: string;
  supplement?: import("@ronggang/contracts").WorkSupplementSelectionV3;
}

export function recordOf(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WireFormatError(`${label} 必须是对象`);
  }
  return value as Record<string, unknown>;
}

export function exactRecord(
  value: unknown,
  keys: readonly string[],
  label: string,
): Record<string, unknown> {
  const record = recordOf(value, label);
  if (Object.keys(record).sort().join("\u0000") !== [...keys].sort().join("\u0000")) {
    throw new WireFormatError(`${label} 字段不符合冻结接口`);
  }
  return record;
}

export function textOf(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new WireFormatError(`${label} 必须是非空字符串`);
  }
  return value;
}

export function contentHashOf(value: unknown, label: string): string {
  const hash = textOf(value, label);
  if (!/^[a-f0-9]{64}$/u.test(hash)) {
    throw new WireFormatError(`${label} 必须是 64 位小写十六进制内容哈希`);
  }
  return hash;
}

export function stringOf(value: unknown, label: string): string {
  if (typeof value !== "string") throw new WireFormatError(`${label} 必须是字符串`);
  return value;
}

export function integerOf(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new WireFormatError(`${label} 必须是非负整数`);
  }
  return value as number;
}

export function numberOf(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new WireFormatError(`${label} 必须是有限数字`);
  }
  return value;
}

export function booleanOf(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new WireFormatError(`${label} 必须是布尔值`);
  return value;
}

export function oneOf<T extends string | number>(
  value: unknown,
  values: readonly T[],
  label: string,
): T {
  if (!values.includes(value as T)) {
    throw new WireFormatError(`${label} 枚举值非法`);
  }
  return value as T;
}

export function listOf(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new WireFormatError(`${label} 必须是数组`);
  return value;
}

export function nullableTextOf(value: unknown, label: string): string | null {
  return value === null ? null : textOf(value, label);
}

export function parseFlagshipWorldResponse(value: unknown): FlagshipWorldView {
  const root = exactRecord(value, ["world"], "FlagshipWorldResponse");
  const world = exactRecord(root.world, [
    "schemaVersion", "audience", "sessionId", "title", "summary",
    "worldStateVersion", "virtualTime", "challenge", "entities", "indicators",
    "facts", "relationships", "resources", "endingState", "availableActions",
  ], "FlagshipWorldView");
  if (world.schemaVersion !== "simulation-world-view/3.0.0"
    || world.audience !== "student") {
    throw new WireFormatError("旗舰世界响应不是学生安全投影");
  }
  const virtualTime = exactRecord(world.virtualTime, [
    "startedAt", "currentAt", "deadlineAt", "elapsedMinutes", "remainingMinutes", "paused",
  ], "FlagshipWorldView.virtualTime");
  const challenge = exactRecord(world.challenge, [
    "level", "scoreCeiling", "scaffoldingLevel",
  ], "FlagshipWorldView.challenge");
  const challengeLevel = oneOf(challenge.level, [3, 4, 5, 6, 7] as const,
    "FlagshipWorldView.challenge.level");
  const scoreCeiling = oneOf(challenge.scoreCeiling, [80, 85, 90, 95, 100] as const,
    "FlagshipWorldView.challenge.scoreCeiling");
  return {
    schemaVersion: "simulation-world-view/3.0.0",
    audience: "student",
    sessionId: textOf(world.sessionId, "FlagshipWorldView.sessionId"),
    title: textOf(world.title, "FlagshipWorldView.title"),
    summary: textOf(world.summary, "FlagshipWorldView.summary"),
    worldStateVersion: integerOf(world.worldStateVersion, "FlagshipWorldView.worldStateVersion"),
    virtualTime: {
      startedAt: textOf(virtualTime.startedAt, "virtualTime.startedAt"),
      currentAt: textOf(virtualTime.currentAt, "virtualTime.currentAt"),
      deadlineAt: textOf(virtualTime.deadlineAt, "virtualTime.deadlineAt"),
      elapsedMinutes: integerOf(virtualTime.elapsedMinutes, "virtualTime.elapsedMinutes"),
      remainingMinutes: integerOf(virtualTime.remainingMinutes, "virtualTime.remainingMinutes"),
      paused: booleanOf(virtualTime.paused, "virtualTime.paused"),
    },
    challenge: {
      level: challengeLevel,
      scoreCeiling,
      scaffoldingLevel: integerOf(challenge.scaffoldingLevel, "challenge.scaffoldingLevel"),
    },
    entities: listOf(world.entities, "entities").map((value, index) => {
      const entity = exactRecord(value, [
        "entityId", "title", "kind", "professionalRole", "status", "publicSummary", "revision",
      ], `entities[${index}]`);
      return {
        entityId: textOf(entity.entityId, `entities[${index}].entityId`),
        title: textOf(entity.title, `entities[${index}].title`),
        kind: textOf(entity.kind, `entities[${index}].kind`),
        professionalRole: nullableTextOf(entity.professionalRole, `entities[${index}].professionalRole`),
        status: oneOf(entity.status, ["available", "busy", "withheld", "left", "closed"] as const,
          `entities[${index}].status`),
        publicSummary: textOf(entity.publicSummary, `entities[${index}].publicSummary`),
        revision: integerOf(entity.revision, `entities[${index}].revision`),
      };
    }),
    indicators: listOf(world.indicators, "indicators").map((value, index) => {
      const indicator = exactRecord(value, [
        "variableId", "title", "band", "studentProjection",
      ], `indicators[${index}]`);
      return {
        variableId: textOf(indicator.variableId, `indicators[${index}].variableId`),
        title: textOf(indicator.title, `indicators[${index}].title`),
        band: oneOf(indicator.band, ["low", "medium", "high"] as const,
          `indicators[${index}].band`),
        studentProjection: textOf(indicator.studentProjection,
          `indicators[${index}].studentProjection`),
      };
    }),
    facts: listOf(world.facts, "facts").map((value, index) => {
      const fact = exactRecord(value, ["factId", "status", "confidenceBand"], `facts[${index}]`);
      return {
        factId: textOf(fact.factId, `facts[${index}].factId`),
        status: oneOf(fact.status, ["unknown", "rumor", "corroborated", "confirmed", "refuted"] as const,
          `facts[${index}].status`),
        confidenceBand: oneOf(fact.confidenceBand, ["low", "medium", "high"] as const,
          `facts[${index}].confidenceBand`),
      };
    }),
    relationships: listOf(world.relationships, "relationships").map((value, index) => {
      const relationship = exactRecord(value, [
        "relationshipId", "sourceEntityId", "targetEntityId", "trustBand", "tensionBand",
      ], `relationships[${index}]`);
      return {
        relationshipId: textOf(relationship.relationshipId, `relationships[${index}].relationshipId`),
        sourceEntityId: textOf(relationship.sourceEntityId, `relationships[${index}].sourceEntityId`),
        targetEntityId: textOf(relationship.targetEntityId, `relationships[${index}].targetEntityId`),
        trustBand: oneOf(relationship.trustBand, ["low", "medium", "high"] as const,
          `relationships[${index}].trustBand`),
        tensionBand: oneOf(relationship.tensionBand, ["low", "medium", "high"] as const,
          `relationships[${index}].tensionBand`),
      };
    }),
    resources: listOf(world.resources, "resources").map((value, index) => {
      const resource = exactRecord(value, ["resourceId", "resourceKind", "amount", "unit"],
        `resources[${index}]`);
      return {
        resourceId: textOf(resource.resourceId, `resources[${index}].resourceId`),
        resourceKind: textOf(resource.resourceKind, `resources[${index}].resourceKind`),
        amount: numberOf(resource.amount, `resources[${index}].amount`),
        unit: textOf(resource.unit, `resources[${index}].unit`),
      };
    }),
    endingState: (() => {
      const ending = exactRecord(world.endingState, ["status", "endingRef"], "endingState");
      return {
        status: oneOf(ending.status, ["active", "recoverable_failure", "completed"] as const,
          "endingState.status"),
        endingRef: nullableTextOf(ending.endingRef, "endingState.endingRef"),
      };
    })(),
    availableActions: listOf(world.availableActions, "availableActions").map((value, index) => {
      const action = exactRecord(value, [
        "eventTemplateId", "eventType", "serverIssuedActionRef", "title", "cue", "affectedObjectRefs",
      ], `availableActions[${index}]`);
      return {
        eventTemplateId: textOf(action.eventTemplateId, `availableActions[${index}].eventTemplateId`),
        eventType: textOf(action.eventType, `availableActions[${index}].eventType`),
        serverIssuedActionRef: textOf(action.serverIssuedActionRef,
          `availableActions[${index}].serverIssuedActionRef`),
        title: textOf(action.title, `availableActions[${index}].title`),
        cue: textOf(action.cue, `availableActions[${index}].cue`),
        affectedObjectRefs: listOf(action.affectedObjectRefs,
          `availableActions[${index}].affectedObjectRefs`).map((value, refIndex) => {
          const reference = exactRecord(value, ["objectType", "objectId"],
            `availableActions[${index}].affectedObjectRefs[${refIndex}]`);
          return {
            objectType: textOf(reference.objectType, "affectedObjectRef.objectType"),
            objectId: textOf(reference.objectId, "affectedObjectRef.objectId"),
          };
        }),
      };
    }),
  };
}

export function parseFlagshipEpisodeResponse(
  value: unknown,
): StudentAgentCollaborationEpisodeV3 {
  const root = exactRecord(value, ["episode"], "FlagshipEpisodeResponse");
  return StudentAgentCollaborationEpisodeV3Schema.parse(root.episode);
}

export function parseFlagshipActionResponse(
  value: unknown,
): StudentAgentCollaborationEpisodeV3 {
  const root = exactRecord(value, ["receipt", "episode"], "FlagshipActionResponse");
  const receipt = exactRecord(root.receipt, [
    "eventId", "replayed", "worldStateVersion",
  ], "FlagshipActionResponse.receipt");
  textOf(receipt.eventId, "FlagshipActionResponse.receipt.eventId");
  booleanOf(receipt.replayed, "FlagshipActionResponse.receipt.replayed");
  integerOf(receipt.worldStateVersion, "FlagshipActionResponse.receipt.worldStateVersion");
  return StudentAgentCollaborationEpisodeV3Schema.parse(root.episode);
}

export function parseFlagshipAdvanceResponse(value: unknown): FlagshipAdvanceResult {
  const root = exactRecord(value, ["advance", "episode"], "FlagshipAdvanceResponse");
  const advance = exactRecord(root.advance, ["scheduled", "reason", "eventId"],
    "FlagshipAdvanceResponse.advance");
  return {
    advance: {
      scheduled: booleanOf(advance.scheduled, "advance.scheduled"),
      reason: textOf(advance.reason, "advance.reason"),
      eventId: nullableTextOf(advance.eventId, "advance.eventId"),
    },
    episode: StudentAgentCollaborationEpisodeV3Schema.parse(root.episode),
  };
}

export function parseFlagshipWorkspaceResponse(value: unknown): FlagshipWorkspaceView {
  const root = exactRecord(value, ["workspace"], "FlagshipWorkspaceResponse");
  const workspace = exactRecord(root.workspace, [
    "schemaVersion", "sessionId", "challengeLevel", "manifest", "completion",
    "evidenceCatalog", "artifacts", "updatedAt",
  ], "FlagshipWorkspaceView");
  if (workspace.schemaVersion !== "flagship-student-workspace/3.0.0") {
    throw new WireFormatError("旗舰作品工作台版本不受支持");
  }
  const manifest = exactRecord(workspace.manifest, [
    "manifestId", "contentHash", "title", "expectedDurationMinutes",
  ], "FlagshipWorkspaceView.manifest");
  const completion = exactRecord(workspace.completion, [
    "requiredArtifactCount", "submittedRequiredCount", "readyForPublication",
    "blockingArtifactTitles",
  ], "FlagshipWorkspaceView.completion");
  const parseTextList = (input: unknown, label: string) => listOf(input, label)
    .map((item, index) => textOf(item, `${label}[${index}]`));
  const parseRevision = (input: unknown, label: string): FlagshipWorkRevision => {
    const revision = exactRecord(input, [
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
      evidenceRefs: parseTextList(revision.evidenceRefs, `${label}.evidenceRefs`),
      revisionNote: textOf(revision.revisionNote, `${label}.revisionNote`),
      contentHash: contentHashOf(revision.contentHash, `${label}.contentHash`),
      createdAt: textOf(revision.createdAt, `${label}.createdAt`),
    };
  };
  return {
    schemaVersion: "flagship-student-workspace/3.0.0",
    sessionId: textOf(workspace.sessionId, "FlagshipWorkspaceView.sessionId"),
    challengeLevel: oneOf(workspace.challengeLevel, [3, 4, 5, 6, 7] as const,
      "FlagshipWorkspaceView.challengeLevel"),
    manifest: {
      manifestId: textOf(manifest.manifestId, "manifest.manifestId"),
      contentHash: contentHashOf(manifest.contentHash, "manifest.contentHash"),
      title: textOf(manifest.title, "manifest.title"),
      expectedDurationMinutes: integerOf(
        manifest.expectedDurationMinutes,
        "manifest.expectedDurationMinutes",
      ),
    },
    completion: {
      requiredArtifactCount: integerOf(completion.requiredArtifactCount,
        "completion.requiredArtifactCount"),
      submittedRequiredCount: integerOf(completion.submittedRequiredCount,
        "completion.submittedRequiredCount"),
      readyForPublication: booleanOf(completion.readyForPublication,
        "completion.readyForPublication"),
      blockingArtifactTitles: parseTextList(completion.blockingArtifactTitles,
        "completion.blockingArtifactTitles"),
    },
    evidenceCatalog: listOf(workspace.evidenceCatalog, "evidenceCatalog")
      .map((item, index) => {
        const evidence = exactRecord(item, [
          "evidenceRef", "kind", "label", "detail", "eventType",
        ], `evidenceCatalog[${index}]`);
        return {
          evidenceRef: textOf(evidence.evidenceRef, `evidenceCatalog[${index}].evidenceRef`),
          kind: oneOf(evidence.kind, ["knowledge", "world_event", "world_evidence"] as const,
            `evidenceCatalog[${index}].kind`),
          label: textOf(evidence.label, `evidenceCatalog[${index}].label`),
          detail: textOf(evidence.detail, `evidenceCatalog[${index}].detail`),
          eventType: nullableTextOf(evidence.eventType, `evidenceCatalog[${index}].eventType`),
        };
      }),
    artifacts: listOf(workspace.artifacts, "artifacts").map((item, index) => {
      const artifact = exactRecord(item, [
        "artifactId", "title", "artifactKind", "required", "conflictDomainRefs",
        "editableFields", "completionChecks", "evidenceRequirements", "status",
        "revisionCount", "latestRevision", "mechanicalCompletion", "updatedAt", "submittedSupplement",
      ], `artifacts[${index}]`);
      const mechanical = exactRecord(artifact.mechanicalCompletion, [
        "mechanicalReady", "missingFields", "evidenceReady", "minimumEvidenceCount",
        "revisionReady",
      ], `artifacts[${index}].mechanicalCompletion`);
      return {
        artifactId: textOf(artifact.artifactId, `artifacts[${index}].artifactId`),
        title: textOf(artifact.title, `artifacts[${index}].title`),
        artifactKind: textOf(artifact.artifactKind, `artifacts[${index}].artifactKind`),
        required: booleanOf(artifact.required, `artifacts[${index}].required`),
        conflictDomainRefs: parseTextList(artifact.conflictDomainRefs,
          `artifacts[${index}].conflictDomainRefs`),
        editableFields: listOf(artifact.editableFields, `artifacts[${index}].editableFields`)
          .map((fieldValue, fieldIndex) => {
            const field = exactRecord(fieldValue, [
              "fieldId", "label", "minimumLength", "maximumLength",
            ], `artifacts[${index}].editableFields[${fieldIndex}]`);
            return {
              fieldId: textOf(field.fieldId, "editableField.fieldId"),
              label: textOf(field.label, "editableField.label"),
              minimumLength: integerOf(field.minimumLength, "editableField.minimumLength"),
              maximumLength: integerOf(field.maximumLength, "editableField.maximumLength"),
            };
          }),
        completionChecks: parseTextList(artifact.completionChecks,
          `artifacts[${index}].completionChecks`),
        evidenceRequirements: parseTextList(artifact.evidenceRequirements,
          `artifacts[${index}].evidenceRequirements`),
        status: oneOf(artifact.status, ["empty", "draft", "submitted"] as const,
          `artifacts[${index}].status`),
        revisionCount: integerOf(artifact.revisionCount, `artifacts[${index}].revisionCount`),
        latestRevision: artifact.latestRevision === null
          ? null
          : parseRevision(artifact.latestRevision, `artifacts[${index}].latestRevision`),
        submittedSupplement: artifact.submittedSupplement == null ? null : WorkSupplementV3Schema.parse(artifact.submittedSupplement),
        mechanicalCompletion: {
          mechanicalReady: booleanOf(mechanical.mechanicalReady, "mechanical.mechanicalReady"),
          missingFields: parseTextList(mechanical.missingFields, "mechanical.missingFields"),
          evidenceReady: booleanOf(mechanical.evidenceReady, "mechanical.evidenceReady"),
          minimumEvidenceCount: integerOf(mechanical.minimumEvidenceCount,
            "mechanical.minimumEvidenceCount"),
          revisionReady: booleanOf(mechanical.revisionReady, "mechanical.revisionReady"),
        },
        updatedAt: textOf(artifact.updatedAt, `artifacts[${index}].updatedAt`),
      };
    }),
    updatedAt: textOf(workspace.updatedAt, "FlagshipWorkspaceView.updatedAt"),
  };
}
