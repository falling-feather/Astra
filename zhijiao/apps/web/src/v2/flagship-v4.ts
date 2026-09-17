import {
  AdminGroundedCollaborationEpisodeV4Schema,
  FlagshipContentReferenceV4Schema,
  MediaWorkRevisionV4Schema,
  SemanticActionDecisionV4Schema,
  StudentGroundedCollaborationEpisodeV4Schema,
  TeacherGroundedCollaborationEpisodeV4Schema,
  type AdminGroundedCollaborationEpisodeV4,
  type FlagshipContentReferenceV4,
  type GroundedKnowledgeCitationV4,
  type MediaWorkRevisionV4,
  type SemanticActionDecisionV4,
  type SemanticActionRequestV4,
  type StudentGroundedCollaborationEpisodeV4,
  type TeacherGroundedCollaborationEpisodeV4,
} from "@ronggang/contracts";
import { WireFormatError } from "./wire";

export type FlagshipExperienceAudienceV4 = "student" | "teacher" | "admin";

export function groundedCitationStanceLabelV4(
  stance: GroundedKnowledgeCitationV4["stance"],
): string {
  switch (stance) {
    case "supports": return "支持当前判断";
    case "refutes": return "提示相反材料";
    case "context": return "补充背景";
  }
}

export interface PublicSemanticSelectionV4 {
  selectionToken: string;
  displayKind: "world_object" | "npc" | "material" | "artifact";
  label: string;
  consequenceHint: string;
  selectionRole: "target" | "material";
}

export interface PublicSemanticActionWindowV4 {
  actionWindowRef: string;
  actionWindowHash: string;
  worldStateVersion: number;
  worldStateRef: string;
  expiresAt: string;
  prompt: string;
  selections: PublicSemanticSelectionV4[];
}

export interface FlagshipSceneV4 {
  sceneRef: string;
  title: string;
  publicDescription: string;
  environmentImage: string;
  simulationNotice: string;
  people: Array<{
    entityId: string;
    displayName: string;
    professionalRole: string;
    publicGoal: string;
    portrait: string;
  }>;
}

export interface FlagshipWorldPulseV4 {
  status: "npc_action_pending" | "quiet";
  speaker: string | null;
  message: string;
  expiresAtVirtualMinute: number | null;
}

export interface GroundedCollaborationStudentEnvelopeV4 {
  episode: StudentGroundedCollaborationEpisodeV4;
  decisionToken: string | null;
}

export interface GroundedCollaborationAblationV4 {
  policy: "single_agent" | "fixed_team" | "affected_set";
  requestHash: string;
  maximumSelectedAgents: number;
  executionBudgetMicros: number;
  status: "joint_proposal_ready" | "failed";
  selectedCount: number;
  moveCount: number;
  knowledgeCitationCount: number;
  evidenceCoverage: number;
  unauthorizedWorldWriteCount: 0;
  totalLatencyMs: number;
  totalEstimatedCostMicros: number;
  failureReasonCode:
    | "no_applicable_agent"
    | "knowledge_not_grounded"
    | "move_sequence_incomplete"
    | "agent_execution_failed"
    | "version_hash_drift"
    | null;
}

export type GroundedCollaborationAudienceViewV4 =
  | GroundedCollaborationStudentEnvelopeV4
  | { episode: TeacherGroundedCollaborationEpisodeV4 }
  | {
      episode: AdminGroundedCollaborationEpisodeV4;
      ablation: GroundedCollaborationAblationV4;
    };

export interface FlagshipExperienceViewV4 {
  schemaVersion: "flagship-experience-view/4.1.0" | "flagship-experience-view/4.2.0";
  fieldInterviewEnabled?: boolean;
  audience: FlagshipExperienceAudienceV4;
  sessionId: string;
  flagshipContentRef: FlagshipContentReferenceV4;
  worldStateVersion: number;
  virtualMinute: number;
  remainingMinutes: number;
  challengeLevel: 3 | 4 | 5 | 6 | 7;
  scene: FlagshipSceneV4;
  worldPulse: FlagshipWorldPulseV4;
  actionWindow: PublicSemanticActionWindowV4 | null;
  collaboration: GroundedCollaborationAudienceViewV4 | null;
  runtimeDisclosure: {
    semanticParser: "live_model" | "deterministic_fallback" | "not_run";
    collaboration: "live" | "deterministic_demo" | "mixed" | "not_run";
    authority: "world_engine_only";
    simulationContent: true;
  };
}

export interface FlagshipSemanticActionReceiptV4 {
  schemaVersion: "flagship-semantic-action-receipt/4.0.0";
  decision: SemanticActionDecisionV4;
  execution: {
    status: "world_event_created" | "workspace_required" | "zero_write";
    eventId: string | null;
    eventTemplateId: string | null;
    worldStateVersion: number;
    safeMessage: string;
  };
  collaboration: GroundedCollaborationStudentEnvelopeV4 | null;
}

export interface FlagshipMediaCatalogItemV4 {
  assetRef: string;
  title: string;
  mediaKind: "image" | "audio" | "video" | "synthetic_capture";
  publicPath: string;
  contentHash: string;
  rightsReceiptRef: string;
  rightsStatus: "cleared" | "limited" | "withdrawn";
  permittedUse: "teaching_preview" | "classroom_submission" | "simulated_publication";
  personConsentMode: "not_applicable" | "simulated_character" | "explicit_receipt";
  aiDisclosure: {
    explicitLabel: true;
    implicitMetadata: true;
    disclosureText: string;
  };
  sourceFactBoundary: string;
  transformable: boolean;
}

export interface FlagshipMediaWorkspaceV4 {
  schemaVersion: "flagship-media-workspace/4.0.0";
  sessionId: string;
  bindingId: string;
  processingMode: "actual_file_transform";
  catalog: FlagshipMediaCatalogItemV4[];
  revisions: MediaWorkRevisionV4[];
}

export type FlagshipMediaOperationInputV4 =
  | {
      operationKind: "crop";
      inputAssetRef: string;
      region: { x: number; y: number; width: number; height: number };
      rationale: string;
    }
  | {
      operationKind: "trim";
      inputAssetRef: string;
      startMs: number;
      endMs: number;
      rationale: string;
    }
  | {
      operationKind: "redact";
      inputAssetRef: string;
      region: { x: number; y: number; width: number; height: number };
      redactionKind: "mask" | "mute" | "remove_metadata";
      rationale: string;
    }
  | {
      operationKind: "replace";
      inputAssetRef: string;
      replacementAssetRef: string;
      replacementReason:
        | "consent_withdrawn"
        | "rights_scope_mismatch"
        | "fact_risk"
        | "editorial_choice";
      rationale: string;
    };

export interface CreateFlagshipMediaRevisionInputV4 {
  sessionId: string;
  bindingId: string;
  artifactRef: string;
  requestId: string;
  expectedRevisionNumber: number;
  status: "draft" | "locked" | "submitted";
  sourceAssetRefs: string[];
  operations: FlagshipMediaOperationInputV4[];
  supportingEvidenceRefs: string[];
  studentEditorialRationale: string;
}

export type SubmitSemanticActionInputV4 = SemanticActionRequestV4;

export interface DecideGroundedSuggestionInputV4 {
  sessionId: string;
  bindingId: string;
  episodeId: string;
  decisionToken: string;
  decisionRef: string;
  decision: "accept" | "request_evidence" | "reject";
  rationale: string;
}

function recordOf(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WireFormatError(`${label} 必须是对象`);
  }
  return value as Record<string, unknown>;
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  label: string,
): Record<string, unknown> {
  const record = recordOf(value, label);
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.join("\u0000") !== expected.join("\u0000")) {
    throw new WireFormatError(`${label} 字段不符合冻结接口`);
  }
  return record;
}

function textOf(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new WireFormatError(`${label} 必须是非空字符串`);
  }
  return value;
}

function integerOf(value: unknown, label: string, minimum = 0): number {
  if (!Number.isInteger(value) || (value as number) < minimum) {
    throw new WireFormatError(`${label} 必须是大于等于 ${minimum} 的整数`);
  }
  return value as number;
}

function numberOf(value: unknown, label: string, minimum = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum) {
    throw new WireFormatError(`${label} 必须是大于等于 ${minimum} 的有限数值`);
  }
  return value;
}

function booleanOf(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new WireFormatError(`${label} 必须是布尔值`);
  return value;
}

function oneOf<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
  label: string,
): Values[number] {
  if (typeof value !== "string" || !values.includes(value)) {
    throw new WireFormatError(`${label} 不在冻结枚举中`);
  }
  return value as Values[number];
}

function nullableTextOf(value: unknown, label: string): string | null {
  return value === null ? null : textOf(value, label);
}

function listOf(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new WireFormatError(`${label} 必须是数组`);
  return value;
}

function contentHashOf(value: unknown, label: string): string {
  const hash = textOf(value, label);
  if (!/^[a-f0-9]{64}$/u.test(hash)) {
    throw new WireFormatError(`${label} 必须是 64 位小写十六进制`);
  }
  return hash;
}

function parseScene(value: unknown): FlagshipSceneV4 {
  const scene = exactRecord(value, [
    "sceneRef", "title", "publicDescription", "environmentImage",
    "simulationNotice", "people",
  ], "FlagshipSceneV4");
  const people = listOf(scene.people, "FlagshipSceneV4.people").map((item, index) => {
    const person = exactRecord(item, [
      "entityId", "displayName", "professionalRole", "publicGoal", "portrait",
    ], `FlagshipSceneV4.people[${index}]`);
    return {
      entityId: textOf(person.entityId, "entityId"),
      displayName: textOf(person.displayName, "displayName"),
      professionalRole: textOf(person.professionalRole, "professionalRole"),
      publicGoal: textOf(person.publicGoal, "publicGoal"),
      portrait: textOf(person.portrait, "portrait"),
    };
  });
  return {
    sceneRef: textOf(scene.sceneRef, "sceneRef"),
    title: textOf(scene.title, "title"),
    publicDescription: textOf(scene.publicDescription, "publicDescription"),
    environmentImage: textOf(scene.environmentImage, "environmentImage"),
    simulationNotice: textOf(scene.simulationNotice, "simulationNotice"),
    people,
  };
}

function parseActionWindow(value: unknown): PublicSemanticActionWindowV4 | null {
  if (value === null) return null;
  const window = exactRecord(value, [
    "actionWindowRef", "actionWindowHash", "worldStateVersion", "worldStateRef",
    "expiresAt", "prompt", "selections",
  ], "PublicSemanticActionWindowV4");
  const selections = listOf(window.selections, "actionWindow.selections")
    .map((item, index) => {
      const selection = exactRecord(item, [
        "selectionToken", "displayKind", "label", "consequenceHint", "selectionRole",
      ], `actionWindow.selections[${index}]`);
      return {
        selectionToken: textOf(selection.selectionToken, "selectionToken"),
        displayKind: oneOf(selection.displayKind, [
          "world_object", "npc", "material", "artifact",
        ] as const, "displayKind"),
        label: textOf(selection.label, "label"),
        consequenceHint: textOf(selection.consequenceHint, "consequenceHint"),
        selectionRole: oneOf(selection.selectionRole, ["target", "material"] as const, "selectionRole"),
      } satisfies PublicSemanticSelectionV4;
    });
  return {
    actionWindowRef: textOf(window.actionWindowRef, "actionWindowRef"),
    actionWindowHash: contentHashOf(window.actionWindowHash, "actionWindowHash"),
    worldStateVersion: integerOf(window.worldStateVersion, "worldStateVersion"),
    worldStateRef: textOf(window.worldStateRef, "worldStateRef"),
    expiresAt: textOf(window.expiresAt, "expiresAt"),
    prompt: textOf(window.prompt, "prompt"),
    selections,
  };
}

function parseWorldPulse(value: unknown): FlagshipWorldPulseV4 {
  const pulse = exactRecord(value, [
    "status", "speaker", "message", "expiresAtVirtualMinute",
  ], "FlagshipWorldPulseV4");
  return {
    status: oneOf(pulse.status, ["npc_action_pending", "quiet"] as const, "worldPulse.status"),
    speaker: nullableTextOf(pulse.speaker, "worldPulse.speaker"),
    message: textOf(pulse.message, "worldPulse.message"),
    expiresAtVirtualMinute: pulse.expiresAtVirtualMinute === null
      ? null
      : integerOf(pulse.expiresAtVirtualMinute, "worldPulse.expiresAtVirtualMinute"),
  };
}

function parseStudentEnvelope(value: unknown): GroundedCollaborationStudentEnvelopeV4 {
  const envelope = exactRecord(value, ["episode", "decisionToken"], "StudentGroundedEnvelopeV4");
  return {
    episode: StudentGroundedCollaborationEpisodeV4Schema.parse(envelope.episode),
    decisionToken: nullableTextOf(envelope.decisionToken, "decisionToken"),
  };
}

export function parseFlagshipGroundedDecisionResponseV4(
  value: unknown,
): GroundedCollaborationStudentEnvelopeV4 {
  const root = exactRecord(
    value,
    ["collaboration"],
    "FlagshipGroundedDecisionResponseV4",
  );
  return parseStudentEnvelope(root.collaboration);
}

function parseAblation(value: unknown): GroundedCollaborationAblationV4 {
  const ablation = exactRecord(value, [
    "policy", "requestHash", "maximumSelectedAgents", "executionBudgetMicros",
    "status", "selectedCount", "moveCount", "knowledgeCitationCount",
    "evidenceCoverage", "unauthorizedWorldWriteCount", "totalLatencyMs",
    "totalEstimatedCostMicros", "failureReasonCode",
  ], "GroundedCollaborationAblationV4");
  const unauthorizedWorldWriteCount = integerOf(
    ablation.unauthorizedWorldWriteCount,
    "unauthorizedWorldWriteCount",
  );
  if (unauthorizedWorldWriteCount !== 0) {
    throw new WireFormatError("V4 消融记录出现越权世界写入");
  }
  const failureReasonCode = ablation.failureReasonCode === null
    ? null
    : oneOf(ablation.failureReasonCode, [
        "no_applicable_agent", "knowledge_not_grounded", "move_sequence_incomplete",
        "agent_execution_failed", "version_hash_drift",
      ] as const, "failureReasonCode");
  return {
    policy: oneOf(ablation.policy, ["single_agent", "fixed_team", "affected_set"] as const, "policy"),
    requestHash: contentHashOf(ablation.requestHash, "requestHash"),
    maximumSelectedAgents: integerOf(ablation.maximumSelectedAgents, "maximumSelectedAgents"),
    executionBudgetMicros: integerOf(ablation.executionBudgetMicros, "executionBudgetMicros"),
    status: oneOf(ablation.status, ["joint_proposal_ready", "failed"] as const, "status"),
    selectedCount: integerOf(ablation.selectedCount, "selectedCount"),
    moveCount: integerOf(ablation.moveCount, "moveCount"),
    knowledgeCitationCount: integerOf(ablation.knowledgeCitationCount, "knowledgeCitationCount"),
    evidenceCoverage: numberOf(ablation.evidenceCoverage, "evidenceCoverage"),
    unauthorizedWorldWriteCount: 0,
    totalLatencyMs: integerOf(ablation.totalLatencyMs, "totalLatencyMs"),
    totalEstimatedCostMicros: integerOf(ablation.totalEstimatedCostMicros, "totalEstimatedCostMicros"),
    failureReasonCode,
  };
}

function parseCollaboration(
  value: unknown,
  audience: FlagshipExperienceAudienceV4,
): GroundedCollaborationAudienceViewV4 | null {
  if (value === null) return null;
  if (audience === "student") return parseStudentEnvelope(value);
  if (audience === "teacher") {
    const envelope = exactRecord(value, ["episode"], "TeacherGroundedEnvelopeV4");
    return { episode: TeacherGroundedCollaborationEpisodeV4Schema.parse(envelope.episode) };
  }
  const envelope = exactRecord(value, ["episode", "ablation"], "AdminGroundedEnvelopeV4");
  return {
    episode: AdminGroundedCollaborationEpisodeV4Schema.parse(envelope.episode),
    ablation: parseAblation(envelope.ablation),
  };
}

export function parseFlagshipExperienceResponseV4(
  value: unknown,
  audience: FlagshipExperienceAudienceV4,
): FlagshipExperienceViewV4 {
  const root = exactRecord(value, ["experience"], "FlagshipExperienceResponseV4");
  const protocol = recordOf(root.experience, "FlagshipExperienceViewV4").schemaVersion;
  const experience = exactRecord(root.experience, [
    "schemaVersion", "audience", "sessionId", "flagshipContentRef",
    "worldStateVersion", "virtualMinute", "remainingMinutes", "challengeLevel",
    "scene", "worldPulse", "actionWindow", "collaboration", "runtimeDisclosure",
    ...(protocol === "flagship-experience-view/4.2.0" ? ["fieldInterviewEnabled"] : []),
  ], "FlagshipExperienceViewV4");
  if (experience.schemaVersion !== "flagship-experience-view/4.1.0" && experience.schemaVersion !== "flagship-experience-view/4.2.0") {
    throw new WireFormatError("FlagshipExperienceViewV4 版本不受支持");
  }
  if (experience.audience !== audience) {
    throw new WireFormatError("FlagshipExperienceViewV4 角色投影不一致");
  }
  const challengeLevel = integerOf(experience.challengeLevel, "challengeLevel", 3);
  if (challengeLevel > 7) throw new WireFormatError("challengeLevel 必须介于 3—7");
  const disclosure = exactRecord(experience.runtimeDisclosure, [
    "semanticParser", "collaboration", "authority", "simulationContent",
  ], "runtimeDisclosure");
  if (disclosure.authority !== "world_engine_only"
    || booleanOf(disclosure.simulationContent, "simulationContent") !== true) {
    throw new WireFormatError("V4 权威与仿真披露不符合冻结边界");
  }
  const actionWindow = parseActionWindow(experience.actionWindow);
  if ((audience === "student") !== (actionWindow !== null)) {
    throw new WireFormatError("只有学生投影可以获得语义行动窗口");
  }
  return {
    schemaVersion: experience.schemaVersion,
    ...(experience.schemaVersion === "flagship-experience-view/4.2.0" ? { fieldInterviewEnabled: booleanOf(experience.fieldInterviewEnabled, "fieldInterviewEnabled") } : {}),
    audience,
    sessionId: textOf(experience.sessionId, "sessionId"),
    flagshipContentRef: FlagshipContentReferenceV4Schema.parse(experience.flagshipContentRef),
    worldStateVersion: integerOf(experience.worldStateVersion, "worldStateVersion"),
    virtualMinute: integerOf(experience.virtualMinute, "virtualMinute"),
    remainingMinutes: integerOf(experience.remainingMinutes, "remainingMinutes"),
    challengeLevel: challengeLevel as 3 | 4 | 5 | 6 | 7,
    scene: parseScene(experience.scene),
    worldPulse: parseWorldPulse(experience.worldPulse),
    actionWindow,
    collaboration: parseCollaboration(experience.collaboration, audience),
    runtimeDisclosure: {
      semanticParser: oneOf(disclosure.semanticParser, [
        "live_model", "deterministic_fallback", "not_run",
      ] as const, "semanticParser"),
      collaboration: oneOf(disclosure.collaboration, [
        "live", "deterministic_demo", "mixed", "not_run",
      ] as const, "collaboration"),
      authority: "world_engine_only",
      simulationContent: true,
    },
  };
}

export function parseFlagshipSemanticActionReceiptV4(
  value: unknown,
): FlagshipSemanticActionReceiptV4 {
  const receipt = exactRecord(value, [
    "schemaVersion", "decision", "execution", "collaboration",
  ], "FlagshipSemanticActionReceiptV4");
  if (receipt.schemaVersion !== "flagship-semantic-action-receipt/4.0.0") {
    throw new WireFormatError("FlagshipSemanticActionReceiptV4 版本不受支持");
  }
  const execution = exactRecord(receipt.execution, [
    "status", "eventId", "eventTemplateId", "worldStateVersion", "safeMessage",
  ], "FlagshipSemanticActionReceiptV4.execution");
  return {
    schemaVersion: "flagship-semantic-action-receipt/4.0.0",
    decision: SemanticActionDecisionV4Schema.parse(receipt.decision),
    execution: {
      status: oneOf(execution.status, [
        "world_event_created", "workspace_required", "zero_write",
      ] as const, "execution.status"),
      eventId: nullableTextOf(execution.eventId, "execution.eventId"),
      eventTemplateId: nullableTextOf(execution.eventTemplateId, "execution.eventTemplateId"),
      worldStateVersion: integerOf(execution.worldStateVersion, "execution.worldStateVersion"),
      safeMessage: textOf(execution.safeMessage, "execution.safeMessage"),
    },
    collaboration: receipt.collaboration === null
      ? null
      : parseStudentEnvelope(receipt.collaboration),
  };
}

function parseCatalogItem(value: unknown, index: number): FlagshipMediaCatalogItemV4 {
  const item = exactRecord(value, [
    "assetRef", "title", "mediaKind", "publicPath", "contentHash",
    "rightsReceiptRef", "rightsStatus", "permittedUse", "personConsentMode",
    "aiDisclosure", "sourceFactBoundary", "transformable",
  ], `FlagshipMediaCatalogItemV4[${index}]`);
  const disclosure = exactRecord(item.aiDisclosure, [
    "explicitLabel", "implicitMetadata", "disclosureText",
  ], `FlagshipMediaCatalogItemV4[${index}].aiDisclosure`);
  if (booleanOf(disclosure.explicitLabel, "explicitLabel") !== true
    || booleanOf(disclosure.implicitMetadata, "implicitMetadata") !== true) {
    throw new WireFormatError("V4 媒体必须同时保留显式与隐式 AI 披露");
  }
  return {
    assetRef: textOf(item.assetRef, "assetRef"),
    title: textOf(item.title, "title"),
    mediaKind: oneOf(item.mediaKind, ["image", "audio", "video", "synthetic_capture"] as const, "mediaKind"),
    publicPath: textOf(item.publicPath, "publicPath"),
    contentHash: contentHashOf(item.contentHash, "contentHash"),
    rightsReceiptRef: textOf(item.rightsReceiptRef, "rightsReceiptRef"),
    rightsStatus: oneOf(item.rightsStatus, ["cleared", "limited", "withdrawn"] as const, "rightsStatus"),
    permittedUse: oneOf(item.permittedUse, [
      "teaching_preview", "classroom_submission", "simulated_publication",
    ] as const, "permittedUse"),
    personConsentMode: oneOf(item.personConsentMode, [
      "not_applicable", "simulated_character", "explicit_receipt",
    ] as const, "personConsentMode"),
    aiDisclosure: {
      explicitLabel: true,
      implicitMetadata: true,
      disclosureText: textOf(disclosure.disclosureText, "disclosureText"),
    },
    sourceFactBoundary: textOf(item.sourceFactBoundary, "sourceFactBoundary"),
    transformable: booleanOf(item.transformable, "transformable"),
  };
}

export function parseFlagshipMediaWorkspaceResponseV4(
  value: unknown,
): FlagshipMediaWorkspaceV4 {
  const root = exactRecord(value, ["workspace"], "FlagshipMediaWorkspaceResponseV4");
  const workspace = exactRecord(root.workspace, [
    "schemaVersion", "sessionId", "bindingId", "processingMode", "catalog", "revisions",
  ], "FlagshipMediaWorkspaceV4");
  if (workspace.schemaVersion !== "flagship-media-workspace/4.0.0"
    || workspace.processingMode !== "actual_file_transform") {
    throw new WireFormatError("媒体工作台版本或处理模式不受支持");
  }
  return {
    schemaVersion: "flagship-media-workspace/4.0.0",
    sessionId: textOf(workspace.sessionId, "sessionId"),
    bindingId: textOf(workspace.bindingId, "bindingId"),
    processingMode: "actual_file_transform",
    catalog: listOf(workspace.catalog, "catalog").map(parseCatalogItem),
    revisions: listOf(workspace.revisions, "revisions").map((revision) => (
      MediaWorkRevisionV4Schema.parse(revision)
    )),
  };
}
