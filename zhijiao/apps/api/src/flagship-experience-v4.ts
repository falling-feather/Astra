import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  DialogueEpisodeEnvelopeV4Schema,
  DialogueStartResponseV4Schema,
  DialogueStartResponseV4SchemaVersion,
  DialogueTurnRequestV4Schema,
  FieldExplorationViewV4Schema,
  FlagshipContentReferenceV4Schema,
  FlagshipContentReferenceV4SchemaVersion,
  SemanticActionRequestV4Schema,
  StudentWorkActionSchema,
  StudentWorkActionSchemaVersion,
  type AdminGroundedCollaborationEpisodeV4,
  type DialogueEpisodeV4,
  type DialogueEpisodeEnvelopeV4,
  type DialogueStartResponseV4,
  type DialogueTurnRequestV4,
  type FlagshipContentReferenceV4,
  type FieldExplorationViewV4,
  type StudentWorkAction,
  type FlagshipRuntimeGroundedBindingV4,
  type FlagshipRuntimePhaseV4,
  type FlagshipWorldRuntimeDefinitionV4,
  type SemanticActionDecisionV4,
  type SemanticActionRequestV4,
  type StudentAgentCollaborationEpisodeV3,
  type StudentGroundedCollaborationEpisodeV4,
  type TeacherGroundedCollaborationEpisodeV4,
} from "@ronggang/contracts";
import {
  xunpuCourseRelease,
  createXunpuFlagshipRuntimeDefinitionV4,
  xunpuFlagshipContentV4,
  type XunpuFlagshipContentV4,
  type XunpuStudentIntentV4,
} from "@ronggang/course-content";
import {
  GroundedCollaborationRecordNotFoundError,
  GroundedEvidenceAuthorizationChangedError,
  XunpuGroundedCollaborationServiceV4,
  XunpuSemanticActionServiceV4,
  buildXunpuGroundedCollaborationRuntimeContentV4,
  createInMemoryGroundedEvidenceAuthorizationResolverV4,
  createInMemoryGroundedRetrievalPortV4,
  issueGroundedWorldConsequenceTokenV4,
  issueSemanticActionSelectionV4,
  observeGroundedCollaborationAblationV4,
  type GroundedCollaborationAblationObservationV4,
  type GroundedCollaborationModelV4,
  type GroundedCollaborationStoreV4,
  type GroundedEvidenceSnapshotV4,
  type GroundedEvidenceAuthorizationResolverV4,
  type GroundedRetrievalPortV4,
  type SemanticActionParserModelV4,
  type SemanticActionRuntimeDiagnosticsV4,
  type SemanticActionSelectionV4,
  type SemanticActionWindowV4,
  type SimulationAgentOrchestratorV3,
} from "@ronggang/agent-orchestrator";
import {
  AutonomousWorldRecordNotFoundError,
  AutonomousWorldStoreConflictError,
  DialogueEpisodeEngineV4,
  DialogueWorldStateConflictError,
  InMemoryDialogueEpisodeStoreV4,
  PermissionDeniedError,
  issueAuthoritativeWorldCommitTokenV4,
  type AuthoritativeWorldCommitPayloadV4,
  type AutonomousWorldRecordV4,
  type DialogueEpisodeStoreV4,
  type DialogueRuleSelectorV4,
  type XunpuAutonomousWorldDirectorV4,
  type SimulationSessionRecord,
  type WorldSimulationEngineV3,
} from "@ronggang/world-core";
import {
  compileFlagshipWorldRuntimeV4,
  type CompiledFlagshipWorldRuntimeV4,
} from "./flagship-world-runtime-v4.js";
import { projectFieldActionConversations } from "./field-conversations-v4.js";
import { deriveFieldAccessV4, fieldAccessPolicyVersionV4 } from "./field-access-v4.js";
import type { FieldInterviewService } from "./field-interview-service.js";

export const FlagshipExperienceV4SchemaVersion =
  "flagship-experience-view/4.2.0" as const;
export const FlagshipSemanticActionReceiptV4SchemaVersion =
  "flagship-semantic-action-receipt/4.0.0" as const;

type ExperienceAudienceV4 = "student" | "teacher" | "admin";

export interface PublicSemanticSelectionV4 {
  selectionToken: string;
  displayKind: SemanticActionSelectionV4["displayKind"];
  label: string;
  consequenceHint: string;
  selectionRole: SemanticActionSelectionV4["selectionRole"];
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

export interface GroundedCollaborationStudentEnvelopeV4 {
  episode: StudentGroundedCollaborationEpisodeV4;
  decisionToken: string | null;
}

export interface FlagshipWorldPulseV4 {
  status: "npc_action_pending" | "quiet";
  speaker: string | null;
  message: string;
  expiresAtVirtualMinute: number | null;
}

export type GroundedCollaborationAudienceViewV4 =
  | GroundedCollaborationStudentEnvelopeV4
  | { episode: TeacherGroundedCollaborationEpisodeV4 }
  | {
      episode: AdminGroundedCollaborationEpisodeV4;
      ablation: GroundedCollaborationAblationObservationV4;
    };

export interface FlagshipExperienceViewV4 {
  fieldInterviewEnabled: boolean;
  schemaVersion: typeof FlagshipExperienceV4SchemaVersion;
  audience: ExperienceAudienceV4;
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
  schemaVersion: typeof FlagshipSemanticActionReceiptV4SchemaVersion;
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

export interface FlagshipExperienceV4Options {
  fieldInterview?: FieldInterviewService;
  engine: Pick<
    WorldSimulationEngineV3,
    "getRecord" | "getSnapshot" | "submitStudentAction"
  >;
  orchestrator: Pick<
    SimulationAgentOrchestratorV3,
    | "getCurrentEpisode"
    | "prepareNextEpisode"
    | "recordStudentDecision"
    | "resolveAcceptedEpisode"
    | "loadRecord"
  >;
  groundedStore: GroundedCollaborationStoreV4;
  autonomousDirector?: Pick<
    XunpuAutonomousWorldDirectorV4,
    "start" | "getRecord" | "evaluate" | "recordWorldCommit"
  >;
  autonomousWorldAuthoritySecret?: string;
  advanceWorld?: (sessionId: string) => Promise<{
    scheduled: boolean;
    reason: string;
    receipt: { event: { eventId: string } } | null;
  }>;
  selectionSecret: string;
  groundedDecisionSecret: string;
  groundedWorldAuthoritySecret: string;
  flagshipContentRef: FlagshipContentReferenceV4;
  content?: XunpuFlagshipContentV4;
  runtimeDefinition?: FlagshipWorldRuntimeDefinitionV4;
  semanticModel?: SemanticActionParserModelV4;
  groundedModel?: GroundedCollaborationModelV4;
  groundedAuthorizationResolver?: GroundedEvidenceAuthorizationResolverV4;
  groundedRetrieval?: GroundedRetrievalPortV4;
  groundedExecutionBudgetMicros?: number;
  dialogueStore?: DialogueEpisodeStoreV4;
  dialogueSelector?: DialogueRuleSelectorV4;
  dialogueTurnSecret?: string;
  dialogueSelectorTimeoutMs?: number;
  now?: () => Date;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

function stableId(prefix: string, value: unknown): string {
  return `${prefix}-${hash(value).slice(0, 24)}`;
}

function learnerSubjectHash(input: {
  sessionId: string;
  principalId: string;
  actorId: string;
}): string {
  return hash({
    sessionId: input.sessionId, principalId: input.principalId, actorId: input.actorId,
    purpose: "flagship-dialogue-learner-v4",
  });
}

function dialogueTurnToken(
  secret: string,
  episode: Pick<
    DialogueEpisodeV4,
    "episodeId" | "sessionId" | "learnerSubjectHash" | "studentBindingRef"
  >,
  revision: number,
): string {
  const signature = createHmac("sha256", secret)
    .update(JSON.stringify(canonical({
      episodeId: episode.episodeId,
      sessionId: episode.sessionId,
      learnerSubjectHash: episode.learnerSubjectHash,
      studentBindingRef: episode.studentBindingRef,
      revision,
    })))
    .digest("base64url");
  return `dialogueturn_${signature}`;
}

function verifyDialogueTurnToken(
  secret: string,
  episode: Pick<
    DialogueEpisodeV4,
    "episodeId" | "sessionId" | "learnerSubjectHash" | "studentBindingRef"
  >,
  revision: number,
  token: string,
): boolean {
  const expected = Buffer.from(dialogueTurnToken(secret, episode, revision));
  const actual = Buffer.from(token);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function publicAssetPath(relativePath: string): string {
  const marker = "apps/web/public";
  const index = relativePath.indexOf(marker);
  if (index < 0) throw new Error(`V4 媒体路径未落在 Web 公开目录：${relativePath}`);
  return relativePath.slice(index + marker.length).replaceAll("\\", "/");
}

function selectionDisplayKind(
  content: XunpuFlagshipContentV4,
  objectId: string,
): SemanticActionSelectionV4["displayKind"] {
  if (content.cast.some((item) => item.entityId === objectId)) return "npc";
  if (content.locations.some((item) => item.locationId === objectId)) {
    return "world_object";
  }
  if (content.artifacts.some((item) => item.artifactId === objectId)) {
    return "artifact";
  }
  return "material";
}

function selectionObjectType(
  content: XunpuFlagshipContentV4,
  objectId: string,
): SemanticActionSelectionV4["objectType"] {
  if (content.cast.some((item) => item.entityId === objectId)) return "entity";
  if (content.locations.some((item) => item.locationId === objectId)) return "location";
  if (content.artifacts.some((item) => item.artifactId === objectId)) return "artifact";
  if (content.mediaAssets.some((item) => item.assetId === objectId)) return "source";
  return "material";
}

function selectionLabel(
  content: XunpuFlagshipContentV4,
  objectId: string,
): { label: string; consequenceHint: string; intents: XunpuStudentIntentV4[] } {
  const npc = content.cast.find((item) => item.entityId === objectId);
  if (npc) {
    return {
      label: `${npc.displayName}·${npc.professionalRole}`,
      consequenceHint: npc.publicGoal,
      intents: ["ask", "probe", "negotiate", "inspect"],
    };
  }
  const location = content.locations.find((item) => item.locationId === objectId);
  if (location) {
    return {
      label: location.title,
      consequenceHint: location.publicDescription,
      intents: [...location.allowedIntents],
    };
  }
  const object = content.worldObjects.find((item) => item.objectId === objectId);
  if (object) {
    return {
      label: object.title,
      consequenceHint: object.initialState,
      intents: [...object.allowedIntents],
    };
  }
  const artifact = content.artifacts.find((item) => item.artifactId === objectId);
  if (artifact) {
    return {
      label: artifact.title,
      consequenceHint: "保存真实修订版本并绑定证据，不覆盖原版。",
      intents: ["draft", "save_revision", "submit_gate"],
    };
  }
  const media = content.mediaAssets.find((item) => item.assetId === objectId);
  if (media) {
    return {
      label: media.title,
      consequenceHint: media.sourceFactBoundary,
      intents: ["import_media", "inspect", "annotate", "replace"],
    };
  }
  throw new Error(`V4 行动对象不存在：${objectId}`);
}

function sceneFor(
  content: XunpuFlagshipContentV4,
  phase: FlagshipRuntimePhaseV4,
  runtime: CompiledFlagshipWorldRuntimeV4,
): FlagshipSceneV4 {
  const location = content.locations.find((item) => item.locationId === phase.locationId)!;
  const environment = content.mediaAssets.find((item) => (
    item.assetId === phase.environmentAssetId && item.productionStatus === "ready"
  ));
  if (!environment) throw new Error(`V4 场景媒体未就绪：${phase.environmentAssetId}`);
  return {
    sceneRef: phase.locationId,
    title: location.title,
    publicDescription: location.publicDescription,
    environmentImage: publicAssetPath(environment.plannedRelativePath),
    simulationNotice: "人物、场景与冲突均为专业教学仿真；公开事实只能来自可定位知识条目。",
    people: phase.npcRefs.map((entityId) => {
      const npc = content.cast.find((item) => item.entityId === entityId);
      const portraitId = runtime.portraitAssetFor(entityId);
      const portrait = content.mediaAssets.find((item) => item.assetId === portraitId);
      if (!npc || !portrait || portrait.productionStatus !== "ready") {
        throw new Error(`V4 NPC 或肖像未就绪：${entityId}`);
      }
      return {
        entityId,
        displayName: npc.displayName,
        professionalRole: npc.professionalRole,
        publicGoal: npc.publicGoal,
        portrait: publicAssetPath(portrait.plannedRelativePath),
      };
    }),
  };
}

function publicWindow(window: SemanticActionWindowV4, prompt: string): PublicSemanticActionWindowV4 {
  return {
    actionWindowRef: window.actionWindowRef,
    actionWindowHash: window.actionWindowHash,
    worldStateVersion: window.worldStateVersion,
    worldStateRef: window.worldStateRef,
    expiresAt: window.expiresAt,
    prompt,
    selections: window.availableSelections.map((selection) => ({
      selectionToken: selection.selectionToken,
      displayKind: selection.displayKind,
      label: selection.label,
      consequenceHint: selection.consequenceHint,
      selectionRole: selection.selectionRole,
    })),
  };
}

function groundedEvidence(
  binding: FlagshipRuntimeGroundedBindingV4,
  event: StudentAgentCollaborationEpisodeV3["triggerEvent"],
  record: SimulationSessionRecord,
): GroundedEvidenceSnapshotV4[] {
  if (!event) throw new Error("V4 知识协作缺少真实触发事件");
  const objects = binding.affectedObjectRefs;
  const eventHash = hash({
    event,
    worldSnapshotHash: record.currentSnapshot.snapshotId,
    releaseHash: record.release.simulationReleaseRef.contentHash,
  });
  const evidence = (evidenceKind: string, index: number): GroundedEvidenceSnapshotV4 => ({
    evidenceRef: stableId("evidence", { eventId: event.eventId, evidenceKind, index }),
    evidenceKind,
    objectRefs: objects,
    contentHash: hash({ eventHash, evidenceKind, index }),
  });
  return binding.evidenceKinds.map((evidenceKind, index) => (
    evidence(evidenceKind, index + 1)
  ));
}

export class FlagshipExperienceServiceV4 {
  readonly #pulseTails = new Map<string, Promise<void>>();
  readonly fieldInterview: FieldInterviewService | null;
  readonly #engine: FlagshipExperienceV4Options["engine"];
  readonly #orchestrator: FlagshipExperienceV4Options["orchestrator"];
  readonly #content: XunpuFlagshipContentV4;
  readonly #contentRef: FlagshipContentReferenceV4;
  readonly #runtime: CompiledFlagshipWorldRuntimeV4;
  readonly #selectionSecret: string;
  readonly #groundedWorldAuthoritySecret: string;
  readonly #autonomousDirector: FlagshipExperienceV4Options["autonomousDirector"];
  readonly #autonomousWorldAuthoritySecret: string | null;
  readonly #advanceWorld: FlagshipExperienceV4Options["advanceWorld"];
  readonly #semantic: XunpuSemanticActionServiceV4;
  readonly #grounded: XunpuGroundedCollaborationServiceV4;
  readonly #groundedExecutionBudgetMicros: number;
  readonly #dialogue: DialogueEpisodeEngineV4;
  readonly #dialogueTurnSecret: string;
  readonly #now: () => Date;
  readonly #windows = new Map<string, { window: SemanticActionWindowV4; prompt: string }>();

  constructor(options: FlagshipExperienceV4Options) {
    this.fieldInterview = options.fieldInterview ?? null;
    this.#engine = options.engine;
    this.#orchestrator = options.orchestrator;
    this.#content = options.content ?? xunpuFlagshipContentV4;
    this.#contentRef = FlagshipContentReferenceV4Schema.parse(options.flagshipContentRef);
    if (this.#contentRef.contentHash !== this.#content.contentHash
      || this.#contentRef.contentSchemaVersion !== this.#content.schemaVersion) {
      throw new Error("V4 体验门面与旗舰内容引用漂移");
    }
    this.#runtime = compileFlagshipWorldRuntimeV4({
      definition: options.runtimeDefinition
        ?? createXunpuFlagshipRuntimeDefinitionV4(this.#contentRef),
      contentRef: this.#contentRef,
      content: this.#content,
    });
    if (options.selectionSecret.length < 32
      || options.groundedDecisionSecret.length < 32
      || options.groundedWorldAuthoritySecret.length < 32) {
      throw new Error("V4 体验运行密钥至少需要 32 个字符");
    }
    this.#selectionSecret = options.selectionSecret;
    this.#groundedWorldAuthoritySecret = options.groundedWorldAuthoritySecret;
    this.#autonomousDirector = options.autonomousDirector;
    this.#autonomousWorldAuthoritySecret = options.autonomousWorldAuthoritySecret ?? null;
    this.#advanceWorld = options.advanceWorld;
    if ((this.#autonomousDirector === undefined)
      !== (this.#autonomousWorldAuthoritySecret === null)) {
      throw new Error("V4 自主导演与权威同步密钥必须同时提供");
    }
    this.#now = options.now ?? (() => new Date());
    this.#dialogueTurnSecret = options.dialogueTurnSecret
      ?? options.selectionSecret;
    if (this.#dialogueTurnSecret.length < 32) {
      throw new Error("V4 对话回合密钥至少需要 32 个字符");
    }
    this.#dialogue = new DialogueEpisodeEngineV4({
      store: options.dialogueStore ?? new InMemoryDialogueEpisodeStoreV4(),
      definitions: this.#content.dialogueScenes,
      npcDisplayNames: Object.fromEntries(this.#content.cast.map((npc) => (
        [npc.entityId, npc.displayName]
      ))),
      ...(options.dialogueSelector ? { selector: options.dialogueSelector } : {}),
      ...(options.dialogueSelectorTimeoutMs === undefined
        ? {}
        : { selectorTimeoutMs: options.dialogueSelectorTimeoutMs }),
    });
    this.#semantic = new XunpuSemanticActionServiceV4({
      selectionSecret: options.selectionSecret,
      samples: this.#content.semanticSamples,
      ...(options.semanticModel ? { model: options.semanticModel } : {}),
      now: this.#now,
    });
    this.#groundedExecutionBudgetMicros = options.groundedModel
      ? (options.groundedExecutionBudgetMicros ?? 25_000)
      : 0;
    if (!Number.isInteger(this.#groundedExecutionBudgetMicros)
      || this.#groundedExecutionBudgetMicros < 0) {
      throw new Error("V4 知识协作模型预算必须是非负整数微美元");
    }
    const groundedContent = buildXunpuGroundedCollaborationRuntimeContentV4({
      content: this.#content,
      baseKnowledge: xunpuCourseRelease.knowledgeRecords,
      addedKnowledge: this.#content.addedKnowledgeRecords,
    });
    if (Boolean(options.groundedAuthorizationResolver) !== Boolean(options.groundedRetrieval)) {
      throw new Error("知识协作检索与授权解析器必须成对注入");
    }
    this.#grounded = new XunpuGroundedCollaborationServiceV4({
      store: options.groundedStore,
      content: groundedContent,
      flagshipContentRef: this.#contentRef,
      decisionSecret: options.groundedDecisionSecret,
      worldAuthoritySecret: options.groundedWorldAuthoritySecret,
      // Standalone component callers use an explicitly scoped teaching fixture; server.ts always injects SQL ports.
      authorizationResolver: options.groundedAuthorizationResolver ?? {
        authorize: (input) => createInMemoryGroundedEvidenceAuthorizationResolverV4({
          ...groundedContent, knownObjectRefs: input.allowedObjectRefs, courseReleaseRef: this.#contentRef.courseReleaseRef,
          claims: groundedContent.claims.filter((claim) => input.allowedClaimRefs.includes(claim.claimRef)),
        }, { now: () => this.#now().toISOString() }).authorize(input),
      },
      retrieval: options.groundedRetrieval ?? {
        retrieve: (input) => createInMemoryGroundedRetrievalPortV4({
          ...groundedContent, knownObjectRefs: input.authorization.allowedObjectRefs,
          claims: groundedContent.claims.filter((claim) => input.authorization.allowedClaimRefs.includes(claim.claimRef)),
        }, { now: () => this.#now().toISOString() }).retrieve(input),
      },
      getCurrentWorldStateVersion: async (sessionId) => (
        (await this.#engine.getSnapshot(sessionId)).stateVersion
      ),
      ...(options.groundedModel ? { model: options.groundedModel } : {}),
      now: () => this.#now().toISOString(),
    });
  }

  get flagshipContentRef(): FlagshipContentReferenceV4 {
    return structuredClone(this.#contentRef);
  }

  get runtimeDefinition(): {
    definitionId: string;
    definitionHash: string;
  } {
    return {
      definitionId: this.#runtime.definitionId,
      definitionHash: this.#runtime.definitionHash,
    };
  }

  async getExperience(input: {
    sessionId: string;
    bindingId: string;
    audience: ExperienceAudienceV4;
    actorId: string;
    principalId: string;
  }): Promise<FlagshipExperienceViewV4> {
    const record = await this.#engine.getRecord(input.sessionId);
    const autonomousPulse = await this.#prepareWorldPulse(record);
    const currentBusinessEpisode = await this.#orchestrator.getCurrentEpisode(
      input.sessionId,
    );
    const businessTrigger = currentBusinessEpisode.student.status === "suggestion_ready"
      ? currentBusinessEpisode.student.triggerEvent
      : null;
    const businessActorRef = businessTrigger
      && businessTrigger.sourceKind !== "student_action"
      ? this.#runtime.autonomyActorForEvent(businessTrigger.eventType)
      : null;
    const businessActor = businessActorRef
      ? this.#content.cast.find((candidate) => candidate.entityId === businessActorRef)
      : null;
    const worldPulse: FlagshipWorldPulseV4 = businessTrigger
      && businessTrigger.sourceKind !== "student_action"
      ? {
          status: "npc_action_pending",
          speaker: businessActor?.displayName ?? "现场角色",
          message: currentBusinessEpisode.student.suggestion?.summary
            ?? businessTrigger.title,
          expiresAtVirtualMinute: businessTrigger.sourceKind === "npc_intent"
            ? Math.min(60, record.currentSnapshot.virtualTime.elapsedMinutes + 6)
            : null,
        }
      : autonomousPulse;
    const phase = this.#runtime.phaseFor(record);
    const actionWindow = input.audience === "student"
      ? await this.#issueWindow(record, input.bindingId, phase, input)
      : null;
    const collaboration = await this.#currentGrounded(
      input.sessionId,
      input.bindingId,
      input.audience,
    );
    let collaborationMode: FlagshipExperienceViewV4["runtimeDisclosure"]["collaboration"] = "not_run";
    if (collaboration && "episode" in collaboration && collaboration.episode.audience === "admin") {
      collaborationMode = collaboration.episode.executionSummary.executionMode;
    } else if (collaboration) {
      collaborationMode = "deterministic_demo";
    }
    return {
      schemaVersion: FlagshipExperienceV4SchemaVersion,
      fieldInterviewEnabled: this.fieldInterview !== null && (Boolean(record.fieldInterview) || record.release.courseReleaseRef.courseId === this.fieldInterview.options.courseId),
      audience: input.audience,
      sessionId: input.sessionId,
      flagshipContentRef: structuredClone(this.#contentRef),
      worldStateVersion: record.currentSnapshot.stateVersion,
      virtualMinute: record.currentSnapshot.virtualTime.elapsedMinutes,
      remainingMinutes: record.currentSnapshot.virtualTime.remainingMinutes,
      challengeLevel: record.challengeAssignment.challengeLevel as 3 | 4 | 5 | 6 | 7,
      scene: sceneFor(this.#content, phase, this.#runtime),
      worldPulse,
      actionWindow: actionWindow ? publicWindow(actionWindow.window, actionWindow.prompt) : null,
      collaboration,
      runtimeDisclosure: {
        semanticParser: "not_run",
        collaboration: collaborationMode,
        authority: "world_engine_only",
        simulationContent: true,
      },
    };
  }

  async startDialogue(input: {
    request: SemanticActionRequestV4;
    actorId: string;
    principalId: string;
  }): Promise<DialogueStartResponseV4> {
    const request = SemanticActionRequestV4Schema.parse(input.request);
    const record = await this.#engine.getRecord(request.sessionId);
    const cached = this.#windows.get(request.actionWindowRef);
    const issued = await this.#issueWindow(record, request.bindingId, this.#runtime.phaseFor(record), input);
    const current = cached?.window ?? issued.window;
    const runtime = await this.#semantic.decide(request, current);
    if (runtime.decision.status !== "accepted") {
      return DialogueStartResponseV4Schema.parse({
        schemaVersion: DialogueStartResponseV4SchemaVersion,
        status: runtime.decision.status,
        safeMessage: runtime.decision.status === "refused"
          ? runtime.decision.refusal.safeMessage
          : runtime.decision.clarification.prompt,
        dialogue: null,
      });
    }
    if (!["ask", "probe", "negotiate"].includes(
      runtime.decision.canonicalAction.verb,
    )) {
      return DialogueStartResponseV4Schema.parse({
        schemaVersion: DialogueStartResponseV4SchemaVersion,
        status: "clarification_required",
        safeMessage: "请选择一位现场人物，并用采访、追问或协商的方式说明来意。",
        dialogue: null,
      });
    }
    const dialogueNpcRefs = new Set(
      this.#content.dialogueScenes.map((scene) => scene.npcRef),
    );
    const selectedNpcRefs = [...new Set(runtime.decision.canonicalAction.targetRefs
      .filter((reference) => (
        reference.objectType === "entity"
        && dialogueNpcRefs.has(reference.objectId)
      ))
      .map((reference) => reference.objectId))];
    if (selectedNpcRefs.length !== 1) {
      return DialogueStartResponseV4Schema.parse({
        schemaVersion: DialogueStartResponseV4SchemaVersion,
        status: "clarification_required",
        safeMessage: "一次只能与一位当前可交互人物开始对话，请重新选择。",
        dialogue: null,
      });
    }
    this.#assertFieldTargets(selectedNpcRefs, issued.access);
    const actionResolution = this.#runtime.resolveAction(record, runtime.decision);
    if (actionResolution.kind !== "event") {
      return DialogueStartResponseV4Schema.parse({
        schemaVersion: DialogueStartResponseV4SchemaVersion,
        status: "clarification_required",
        safeMessage: actionResolution.reasons.join("；").slice(0, 1_000),
        dialogue: null,
      });
    }
    const episode = await this.#dialogue.beginDialogue({
      requestId: request.requestId,
      sessionId: request.sessionId,
      learnerSubjectHash: learnerSubjectHash({
        sessionId: request.sessionId,
        principalId: input.principalId,
        actorId: input.actorId,
      }),
      studentActorRef: input.actorId,
      studentBindingRef: request.bindingId,
      npcRef: selectedNpcRefs[0]!,
      flagshipContentRef: this.#contentRef,
      openingStudentUtterance: request.utterance,
      sourceWorldStateVersion: record.currentSnapshot.stateVersion,
      virtualMinute: record.currentSnapshot.virtualTime.elapsedMinutes,
      challengeLevel: record.challengeAssignment.challengeLevel as 3 | 4 | 5 | 6 | 7,
      submittedAt: request.submittedAt,
    });
    this.#windows.delete(request.actionWindowRef);
    return DialogueStartResponseV4Schema.parse({
      schemaVersion: DialogueStartResponseV4SchemaVersion,
      status: "opened",
      safeMessage: `${episode.npcDisplayName}已回应；请根据现场问题继续对话。`,
      dialogue: this.#studentDialogueEnvelope(episode),
    });
  }

  async submitDialogueTurn(input: {
    request: DialogueTurnRequestV4;
    actorId: string;
    principalId: string;
  }): Promise<DialogueEpisodeEnvelopeV4> {
    const request = DialogueTurnRequestV4Schema.parse(input.request);
    const current = await this.#dialogue.loadEpisode(request.episodeId);
    if (!current
      || current.sessionId !== request.sessionId
      || current.studentActorRef !== input.actorId
      || current.studentBindingRef !== request.bindingId) {
      throw new PermissionDeniedError("当前学生身份无权推进这段人物对话");
    }
    const subjectHash = learnerSubjectHash({
      sessionId: request.sessionId,
      principalId: input.principalId,
      actorId: input.actorId,
    });
    if (current.learnerSubjectHash !== subjectHash
      || !verifyDialogueTurnToken(
        this.#dialogueTurnSecret,
        current,
        request.expectedEpisodeRevision,
        request.turnToken,
      )) {
      throw new PermissionDeniedError("人物对话回合令牌无效或不属于当前学生");
    }
    const world = await this.#engine.getRecord(request.sessionId);
    let episode = await this.#dialogue.submitTurn({
      request,
      learnerSubjectHash: subjectHash,
      actualWorldStateVersion: world.currentSnapshot.stateVersion,
      actualVirtualMinute: world.currentSnapshot.virtualTime.elapsedMinutes,
    });
    if (episode.status === "resolution_pending") {
      episode = await this.#commitPendingDialogue(episode);
    }
    return this.#studentDialogueEnvelope(episode);
  }

  async getCurrentDialogueForAudience(input: {
    sessionId: string;
    bindingId: string;
    audience: ExperienceAudienceV4;
    actorId: string;
    principalId: string;
  }): Promise<DialogueEpisodeEnvelopeV4 | null> {
    let episode: DialogueEpisodeV4 | null;
    if (input.audience === "student") {
      episode = await this.#dialogue.getCurrentEpisode(
        input.sessionId,
        learnerSubjectHash({
          sessionId: input.sessionId,
          principalId: input.principalId,
          actorId: input.actorId,
        }),
      );
      if (episode && (
        episode.studentActorRef !== input.actorId
        || episode.studentBindingRef !== input.bindingId
      )) {
        throw new PermissionDeniedError("当前学生身份无权读取这段人物对话");
      }
    } else {
      episode = await this.#dialogue.getCurrentEpisodeForSession(input.sessionId);
    }
    return episode ? this.#dialogueEnvelope(episode, input.audience) : null;
  }

  async getExplorationField(input: {
    sessionId: string;
    bindingId: string;
    audience: ExperienceAudienceV4;
    actorId: string;
    principalId: string;
  }): Promise<FieldExplorationViewV4> {
    if (input.audience !== "student") {
      throw new PermissionDeniedError("节点现场只向当前学生提供本人视野；教师使用教师过程投影");
    }
    const record = await this.#engine.getRecord(input.sessionId);
    const phase = this.#runtime.phaseFor(record);
    const { window, access, episodes } = await this.#issueWindow(record, input.bindingId, phase, input);
    const visibleEntities = new Map(record.currentSnapshot.entities
      .filter(entity => entity.visibleScopes.includes("student"))
      .map(entity => [entity.entityId, entity]));
    const nodes = new Map<string, FieldExplorationViewV4["nodes"][number]>();
    for (const candidate of [...this.#runtime.definition.phases].sort((a, b) => a.priority - b.priority)) {
      const scene = sceneFor(this.#content, candidate, this.#runtime);
      const node = nodes.get(scene.sceneRef) ?? {
        sceneRef: scene.sceneRef, title: scene.title,
        publicDescription: scene.publicDescription,
        environmentImage: scene.environmentImage, access: access.node(scene.sceneRef), people: [], objectRefs: [],
      };
      for (const person of scene.people) {
        const entity = visibleEntities.get(person.entityId);
        if (entity && !node.people.some(existing => existing.entityId === person.entityId)) {
          node.people.push({ ...person, status: entity.status,
            supportsDialogue: this.#content.dialogueScenes.some(definition => definition.npcRef === person.entityId),
            presence: access.person(person.entityId),
          });
        }
      }
      node.objectRefs = [...new Set([...node.objectRefs, ...candidate.objectRefs])];
      nodes.set(node.sceneRef, node);
    }
    return FieldExplorationViewV4Schema.parse({
      schemaVersion: "field-exploration-view/4.1.0", audience: "student",
      sessionId: input.sessionId, bindingId: input.bindingId,
      worldStateVersion: record.currentSnapshot.stateVersion,
      actionWindowRef: window.actionWindowRef,
      nodes: [...nodes.values()],
      selectionBindings: window.availableSelections.map(selection => ({
        objectId: selection.objectId, selectionToken: selection.selectionToken,
      })),
      dialogues: episodes.map(episode => this.#dialogue.project(episode, "student")),
      actionConversations: projectFieldActionConversations({
        record, dialogues: episodes, actorId: input.actorId, bindingId: input.bindingId,
        visibleNpcRefs: new Set(this.#content.cast.filter(npc => visibleEntities.has(npc.entityId)).map(npc => npc.entityId)),
      }),
    });
  }

  /**
   * Resumes only resolutions that were already durably prepared before an
   * interruption. It does not invent a new turn or bypass any dialogue rule;
   * the same stable world request is replayed through WorldSimulationEngine.
   */
  async recoverPendingDialogues(): Promise<{ recovered: number }> {
    const pending = await this.#dialogue.listPendingEpisodes();
    let recovered = 0;
    for (const episode of pending) {
      await this.#commitPendingDialogue(episode);
      recovered += 1;
    }
    return { recovered };
  }

  async decideSemanticAction(input: {
    request: SemanticActionRequestV4;
    actorId: string;
    principalId: string;
  }): Promise<FlagshipSemanticActionReceiptV4> {
    const request = SemanticActionRequestV4Schema.parse(input.request);
    const record = await this.#engine.getRecord(request.sessionId);
    const cached = this.#windows.get(request.actionWindowRef);
    const issued = await this.#issueWindow(record, request.bindingId, this.#runtime.phaseFor(record), input);
    const current = cached?.window ?? issued.window;
    const runtime = await this.#semantic.decide(request, current);
    if (runtime.decision.status !== "accepted") {
      return {
        schemaVersion: FlagshipSemanticActionReceiptV4SchemaVersion,
        decision: runtime.decision,
        execution: {
          status: "zero_write",
          eventId: null,
          eventTemplateId: null,
          worldStateVersion: record.currentSnapshot.stateVersion,
          safeMessage: runtime.decision.status === "refused"
            ? runtime.decision.refusal.safeMessage
            : runtime.decision.clarification.prompt,
        },
        collaboration: null,
      };
    }
    this.#assertFieldTargets(runtime.decision.canonicalAction.targetRefs.map(ref => ref.objectId), issued.access);
    const resolution = this.#runtime.resolveAction(record, runtime.decision);
    if (resolution.kind !== "event") {
      return {
        schemaVersion: FlagshipSemanticActionReceiptV4SchemaVersion,
        decision: runtime.decision,
        execution: {
          status: resolution.kind === "workspace" ? "workspace_required" : "zero_write",
          eventId: null,
          eventTemplateId: null,
          worldStateVersion: record.currentSnapshot.stateVersion,
          safeMessage: resolution.reasons.join("；").slice(0, 1_000),
        },
        collaboration: null,
      };
    }
    const eventTemplateId = resolution.eventTemplateId;
    const npcRefs = new Set(this.#content.cast.map(npc => npc.entityId));
    const requestedNpcRefs = [...new Set(request.selections.flatMap(selection => {
      const issued = current.availableSelections.find(candidate => candidate.selectionToken === selection.selectionToken);
      return issued && npcRefs.has(issued.objectId) ? [issued.objectId] : [];
    }))];
    const action = StudentWorkActionSchema.parse({
      schemaVersion: StudentWorkActionSchemaVersion,
      workActionId: stableId("work-action", {
        sessionId: request.sessionId,
        requestId: request.requestId,
      }),
      serverIssuedActionRef: `server-action-${eventTemplateId}-${record.currentSnapshot.stateVersion}`,
      sessionId: request.sessionId,
      bindingId: request.bindingId,
      actorId: input.actorId,
      primaryRoleId: "reporter",
      ...(requestedNpcRefs.length === 1 ? { interactionTargetRef: requestedNpcRefs[0] } : {}),
      expectedWorldStateVersion: request.expectedWorldStateVersion,
      action: this.#runtime.actionForEvent(eventTemplateId, request.utterance),
      sourceWorldEventIds: [],
      reflectionNote: request.utterance,
      submissionStatus: "accepted",
      createdAt: this.#now().toISOString(),
    });
    const worldReceipt = await this.#engine.submitStudentAction({
      action,
      eventTemplateId,
      requestId: request.requestId,
    });
    const episodeViews = await this.#orchestrator.prepareNextEpisode(request.sessionId);
    const collaboration = await this.#startGroundedIfNeeded({
      eventTemplateId,
      studentBindingId: request.bindingId,
      episode: episodeViews.student,
      record: await this.#engine.getRecord(request.sessionId),
    });
    this.#windows.delete(request.actionWindowRef);
    return {
      schemaVersion: FlagshipSemanticActionReceiptV4SchemaVersion,
      decision: runtime.decision,
      execution: {
        status: "world_event_created",
        eventId: worldReceipt.event.eventId,
        eventTemplateId,
        worldStateVersion: record.currentSnapshot.stateVersion,
        safeMessage: "行动已由服务端验证并进入权威世界事件队列。",
      },
      collaboration,
    };
  }

  async decideGroundedSuggestion(input: {
    sessionId: string;
    bindingId: string;
    episodeId: string;
    decisionToken: string;
    decisionRef: string;
    decision: "accept" | "request_evidence" | "reject";
    rationale: string;
  }): Promise<GroundedCollaborationStudentEnvelopeV4> {
    let episode = await this.#grounded.recordStudentDecision({
      episodeId: input.episodeId,
      bindingId: input.bindingId,
      decisionRef: input.decisionRef,
      decision: input.decision,
      rationale: input.rationale,
      decidedAt: this.#now().toISOString(),
      decisionToken: input.decisionToken,
    });
    const v3 = await this.#orchestrator.getCurrentEpisode(input.sessionId);
    if (v3.student.triggerEvent?.eventId !== episode.triggerEventRef) {
      throw new Error("V4 建议与当前权威世界事件不一致");
    }
    let views = await this.#orchestrator.recordStudentDecision({
      sessionId: input.sessionId,
      episodeId: v3.student.episodeId,
      decisionRef: input.decisionRef,
      decision: input.decision,
      rationale: input.rationale,
    });
    if (input.decision === "accept") {
      views = await this.#orchestrator.resolveAcceptedEpisode(
        input.sessionId,
        v3.student.episodeId,
      );
      if (views.student.consequence?.status === "committed") {
        episode = await this.#recordGroundedConsequence(
          input.episodeId,
          episode.sourceWorldStateVersion,
          views.student,
        );
        await this.onWorldSettled(input.sessionId);
      }
    }
    return { episode, decisionToken: null };
  }

  async refreshGroundedEvidence(input: {
    sessionId: string;
    bindingId: string;
    episodeId: string;
  }): Promise<GroundedCollaborationStudentEnvelopeV4> {
    const current = await this.#orchestrator.getCurrentEpisode(input.sessionId);
    const existing = await this.#grounded.getRecord(input.episodeId);
    if (existing.sessionId !== input.sessionId || current.student.triggerEvent?.eventId !== existing.request.triggerEventRef) {
      throw new Error("只能刷新当前会话正在处理的证据协作");
    }
    await this.#grounded.resumeEpisodeWithEvidence({
      episodeId: existing.episodeId, sessionId: input.sessionId, studentBindingId: input.bindingId,
      flagshipContentRef: existing.flagshipContentRef, episodeTemplateRef: existing.request.episodeTemplateRef,
      sourceWorldStateVersion: existing.request.sourceWorldStateVersion, triggerEventRef: existing.request.triggerEventRef,
      affectedObjectRefs: existing.request.affectedObjectRefs, claimRefs: existing.request.claimRefs,
      evidence: existing.request.evidence,
    });
    const episode = await this.#grounded.getStudentEpisode(input.episodeId);
    return { episode, decisionToken: episode.status === "suggestion_ready" && episode.suggestion
      ? await this.#grounded.issueStudentDecisionToken(input.episodeId, input.bindingId) : null };
  }

  async getCurrentGroundedForAudience(input: {
    sessionId: string;
    bindingId: string;
    audience: ExperienceAudienceV4;
  }): Promise<GroundedCollaborationAudienceViewV4 | null> {
    return this.#currentGrounded(input.sessionId, input.bindingId, input.audience);
  }

  async onWorldSettled(sessionId: string): Promise<{
    scheduled: boolean;
    reason: string;
    eventId: string | null;
  }> {
    const record = await this.#engine.getRecord(sessionId);
    await this.#synchronizeDialogueConsequences(record);
    await this.#prepareWorldPulse(record);
    if (!this.#advanceWorld) {
      return {
        scheduled: false,
        reason: "当前组合根未配置公开世界自动推进器。",
        eventId: null,
      };
    }
    const advance = await this.#advanceWorld(sessionId);
    if (advance.scheduled) {
      await this.#orchestrator.prepareNextEpisode(sessionId);
    }
    return {
      scheduled: advance.scheduled,
      reason: advance.reason,
      eventId: advance.receipt?.event.eventId ?? null,
    };
  }

  #studentDialogueEnvelope(
    episode: DialogueEpisodeV4,
  ): Extract<DialogueEpisodeEnvelopeV4, { audience: "student" }> {
    const envelope = this.#dialogueEnvelope(episode, "student");
    if (envelope.audience !== "student") {
      throw new Error("学生人物对话投影身份不一致");
    }
    return envelope;
  }

  #dialogueEnvelope(
    episode: DialogueEpisodeV4,
    audience: ExperienceAudienceV4,
  ): DialogueEpisodeEnvelopeV4 {
    return DialogueEpisodeEnvelopeV4Schema.parse({
      audience,
      episode: this.#dialogue.project(episode, audience),
      turnToken: audience === "student" && episode.status === "active"
        ? dialogueTurnToken(this.#dialogueTurnSecret, episode, episode.revision)
        : null,
    });
  }

  async #commitPendingDialogue(
    episode: DialogueEpisodeV4,
  ): Promise<DialogueEpisodeV4> {
    const pending = episode.pendingResolution;
    if (episode.status !== "resolution_pending" || !pending) return episode;
    const action = StudentWorkActionSchema.parse({
      schemaVersion: StudentWorkActionSchemaVersion,
      workActionId: stableId("dialogue-work-action", {
        episodeId: episode.episodeId,
        worldRequestId: pending.worldRequestId,
      }),
      serverIssuedActionRef:
        `server-action-${pending.eventTemplateRef}-${episode.sourceWorldStateVersion}`,
      sessionId: episode.sessionId,
      bindingId: episode.studentBindingRef,
      actorId: episode.studentActorRef,
      primaryRoleId: "reporter",
      expectedWorldStateVersion: episode.sourceWorldStateVersion,
      action: this.#runtime.actionForEvent(
        pending.eventTemplateRef,
        pending.combinedStudentUtterance,
      ),
      sourceWorldEventIds: [],
      reflectionNote: pending.combinedStudentUtterance,
      submissionStatus: "accepted",
      createdAt: pending.preparedAt,
    });
    let worldReceipt: Awaited<ReturnType<
      FlagshipExperienceV4Options["engine"]["submitStudentAction"]
    >>;
    try {
      worldReceipt = await this.#engine.submitStudentAction({
        action,
        eventTemplateId: pending.eventTemplateRef,
        requestId: pending.worldRequestId,
      });
    } catch (error) {
      const current = await this.#engine.getRecord(episode.sessionId);
      const existing = current.requestReceipts.find((receipt) => (
        receipt.requestId === pending.worldRequestId
      ));
      if (!existing
        && current.currentSnapshot.stateVersion !== episode.sourceWorldStateVersion) {
        await this.#dialogue.markPendingStale({
          episodeId: episode.episodeId,
          expectedRevision: episode.revision,
          closedAt: this.#now().toISOString(),
        });
        throw new DialogueWorldStateConflictError(
          episode.sourceWorldStateVersion,
          current.currentSnapshot.stateVersion,
        );
      }
      throw error;
    }
    const episodeViews = await this.#orchestrator.prepareNextEpisode(episode.sessionId);
    await this.#startGroundedIfNeeded({
      eventTemplateId: pending.eventTemplateRef,
      studentBindingId: episode.studentBindingRef,
      episode: episodeViews.student,
      record: await this.#engine.getRecord(episode.sessionId),
    });
    return this.#dialogue.commitResolution({
      episodeId: episode.episodeId,
      expectedRevision: episode.revision,
      worldRequestId: pending.worldRequestId,
      worldEventRef: worldReceipt.event.eventId,
      resultingWorldStateVersion: null,
      consequenceRef: null,
      committedAt: this.#now().toISOString(),
    });
  }

  async #synchronizeDialogueConsequences(
    world: SimulationSessionRecord,
  ): Promise<void> {
    const episodes = await this.#dialogue.listEpisodesForSession(world.sessionId);
    for (const episode of episodes) {
      if (episode.status !== "resolved"
        || !episode.worldCommit
        || episode.worldCommit.resultingWorldStateVersion !== null) continue;
      const consequence = world.consequences.find((candidate) => (
        candidate.sourceWorldEventId === episode.worldCommit?.worldEventRef
      ));
      if (!consequence) continue;
      await this.#dialogue.attachWorldConsequence({
        episodeId: episode.episodeId,
        expectedRevision: episode.revision,
        resultingWorldStateVersion: consequence.resultingStateVersion,
        consequenceRef: consequence.resolutionId,
        updatedAt: consequence.occurredAt,
      });
    }
  }

  async #prepareWorldPulse(record: SimulationSessionRecord): Promise<FlagshipWorldPulseV4> {
    const key = record.sessionId, previous = this.#pulseTails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolve => { release = resolve; }), tail = previous.then(() => current);
    this.#pulseTails.set(key, tail); await previous;
    try {
      // Public reads and post-action synchronization can arrive together. Settle one current snapshot at a time.
      return await this.#prepareCurrentWorldPulse(await this.#engine.getRecord(key));
    } finally { release(); if (this.#pulseTails.get(key) === tail) this.#pulseTails.delete(key); }
  }

  async #prepareCurrentWorldPulse(record: SimulationSessionRecord): Promise<FlagshipWorldPulseV4> {
    if (!this.#autonomousDirector || !this.#autonomousWorldAuthoritySecret) {
      return {
        status: "quiet",
        speaker: null,
        message: "当前没有新的现场变化，请继续完成眼前的采访、核验或制作。",
        expiresAtVirtualMinute: null,
      };
    }
    const autonomy = await this.#synchronizeAutonomy(record);
    const decision = await this.#autonomousDirector.evaluate({
      sessionId: record.sessionId,
      cycleRef: `public-cycle-${autonomy.currentWorldStateVersion}-${autonomy.virtualMinute}`,
      expectedWorldStateVersion: autonomy.currentWorldStateVersion,
      triggerKind: "state_threshold",
      triggerRef: `authoritative-world-${record.currentSnapshot.stateVersion}`,
    });
    if (decision.status !== "scheduled") {
      return {
        status: "quiet",
        speaker: null,
        message: "当前没有新的现场变化，请继续完成眼前的采访、核验或制作。",
        expiresAtVirtualMinute: null,
      };
    }
    const actor = this.#content.cast.find((candidate) => (
      candidate.entityId === decision.candidateEvent.actorEntityRef
    ));
    return {
      status: "npc_action_pending",
      speaker: actor?.displayName ?? "现场角色",
      message: decision.candidateEvent.publicCue.replace(/^【教学仿真】/u, ""),
      expiresAtVirtualMinute: decision.candidateEvent.expiresVirtualMinute,
    };
  }

  async #synchronizeAutonomy(
    world: SimulationSessionRecord,
  ): Promise<AutonomousWorldRecordV4> {
    if (!this.#autonomousDirector || !this.#autonomousWorldAuthoritySecret) {
      throw new Error("V4 自主导演尚未配置");
    }
    let autonomy: AutonomousWorldRecordV4;
    try {
      autonomy = await this.#autonomousDirector.getRecord(world.sessionId);
    } catch (error) {
      if (!(error instanceof AutonomousWorldRecordNotFoundError)) throw error;
      try {
        autonomy = await this.#autonomousDirector.start({
          sessionId: world.sessionId,
          flagshipContentRef: this.#contentRef,
          challengeLevel: world.challengeAssignment.challengeLevel as 3 | 4 | 5 | 6 | 7,
          seed: stableId("world-seed", {
            sessionId: world.sessionId,
            release: world.release.simulationReleaseRef,
          }),
          initialWorldStateVersion: 0,
          initialVirtualMinute: 0,
          initialVariableValues: Object.fromEntries(world.release.variableDefinitions
            .filter(variable => this.#content.variables.some(candidate => candidate.variableId === variable.variableId))
            .map(variable => [variable.variableId, variable.initialValue])),
          initialSignals: { student_enters_gate: true },
          startedAt: world.createdAt,
        });
      } catch (startError) {
        if (!(startError instanceof AutonomousWorldStoreConflictError)) throw startError;
        autonomy = await this.#autonomousDirector.getRecord(world.sessionId);
      }
    }
    if (autonomy.currentWorldStateVersion > world.currentSnapshot.stateVersion) {
      throw new Error("V4 自主世界版本领先于权威 WorldEngine");
    }
    const dialogueEpisodes = await this.#dialogue.listEpisodesForSession(world.sessionId);
    const changes = [
      ...world.consequences.map(consequence => ({ kind: "agent" as const, version: consequence.resultingStateVersion, consequence })),
      ...(world.fieldInterview?.events ?? []).map(event => ({ kind: "field" as const, version: event.resultingWorldStateVersion, event })),
    ].filter(change => change.version > autonomy.currentWorldStateVersion).sort((left, right) => left.version - right.version);
    for (const change of changes) {
      if (change.version !== autonomy.currentWorldStateVersion + 1) {
        throw new Error("V4 自主世界无法跨版本跳跃同步");
      }
      if (change.kind === "field") {
        const event = change.event;
        const field = world.fieldInterview!;
        const actorRef = "npcId" in event.action ? event.action.npcId : null;
        const pastEvents = field.events.filter(item => item.resultingWorldStateVersion <= event.resultingWorldStateVersion);
        const knownRefs = new Set(pastEvents.flatMap(item => item.evidenceRefs));
        const turns = field.turns.filter(turn => knownRefs.has(turn.id));
        const turn = field.turns.find(turn => event.evidenceRefs.includes(turn.id));
        const memoryKeys: Record<string, string> = {
          "entity-gatekeeper": "declared_scope", "entity-community-source": "questions_asked",
          "entity-inheritor": "framing_intent", "entity-researcher": "claims_received",
          "entity-shopkeeper": "student_counteroffer", "entity-public-liaison": "questions_received",
          "entity-rights-contact": "asset_queries", "entity-tourist": "consent_scope",
          "entity-editor": "student_angle", "entity-platform-duty": "flags",
        };
        const memoryKey = actorRef && turn && (turn.topicId || turn.choiceConfirmed) ? memoryKeys[actorRef] : undefined;
        const responseWindow = memoryKey ? autonomy.responseWindows.find(window => window.status === "open" && window.actorEntityRef === actorRef && event.afterMinute <= window.expiresAtVirtualMinute) : null;
        const activeLesson = this.fieldInterview?.lessonFor(world);
        const choiceEffect = (id: string | null) => activeLesson?.choices.find(choice => choice.id === id)?.effect;
        const payload: AuthoritativeWorldCommitPayloadV4 = {
          sessionId: world.sessionId, commitRef: stableId("field-autonomy-sync", event.id),
          sourceWorldStateVersion: autonomy.currentWorldStateVersion, resultingWorldStateVersion: event.resultingWorldStateVersion,
          sourceWorldEventRef: event.id, candidateEventId: responseWindow?.candidateEventId ?? null,
          virtualMinute: Math.max(autonomy.virtualMinute, Math.min(60, event.afterMinute)), paused: world.currentSnapshot.virtualTime.paused,
          endingStatus: world.currentSnapshot.endingState.status,
          signalUpdates: {
            field_interaction_count: pastEvents.length,
            first_contact: turns.some(turn => turn.npcId === "entity-community-source"),
            open_question_count: turns.filter(turn => /为什么|怎样|怎么|如何|能否讲讲/u.test(turn.studentText)).length,
            primary_locator_available: knownRefs.has("material-local-standard"),
            merchant_offer_received: knownRefs.has("material-commercial-offer"),
          },
          variableValues: { ...autonomy.variables },
          npcMemoryUpdates: actorRef && memoryKey
            ? [{ entityId: actorRef, memoryKey, valueHash: hash(event), publicSummary: event.summary.slice(0, 500) }] : [],
          npcCommitmentUpdates: field.promises.filter(promise => turns.some(turn => turn.npcId === promise.npcId
            && ((turn.choiceConfirmed && choiceEffect(turn.choiceId) === "promise") || (turn.topicId === "cai-notice" && promise.channel === "chat")))).map(promise => ({
            entityId: promise.npcId, commitmentId: stableId("field-mail-promise", [promise.npcId, promise.dueMinute]),
            publicSummary: `答应在第${promise.dueMinute}分钟发送资料；实际交付状态以本场消息与附件记录为准。`,
            status: promise.deliveryMinute !== null && event.afterMinute >= promise.deliveryMinute ? "kept" as const : event.afterMinute >= promise.dueMinute ? "breached" as const : "active" as const,
          })),
          npcLocalFactUpdates: [], committedAt: event.committedAt,
        };
        autonomy = (await this.#autonomousDirector.recordWorldCommit({ ...payload,
          authorityToken: issueAuthoritativeWorldCommitTokenV4(this.#autonomousWorldAuthoritySecret, payload) })).record;
        continue;
      }
      const consequence = change.consequence;
      const nextTimedChange = changes.find(candidate => candidate.version > change.version && (candidate.kind === "field" || candidate.consequence.virtualMinute !== undefined));
      const knownMinute = consequence.virtualMinute ?? (nextTimedChange?.kind === "field" ? nextTimedChange.event.beforeMinute
        : nextTimedChange?.consequence.virtualMinute ?? world.currentSnapshot.virtualTime.elapsedMinutes);
      const event = world.queue.find((candidate) => (
        candidate.eventId === consequence.sourceWorldEventId
      ));
      if (!event) throw new Error("V4 自主世界同步缺少来源事件");
      const actor = this.#runtime.autonomyActorForEvent(event.eventType);
      const committedResolution = world.resolutions.find(resolution => resolution.resolutionId === consequence.resolutionId);
      const openWindow = actor === null ? null : autonomy.responseWindows.find((window) => (
        window.status === "open" && window.actorEntityRef === actor
      )) ?? null;
      const payload: AuthoritativeWorldCommitPayloadV4 = {
        sessionId: world.sessionId,
        commitRef: stableId("autonomy-sync", consequence.resolutionId),
        sourceWorldStateVersion: autonomy.currentWorldStateVersion,
        resultingWorldStateVersion: consequence.resultingStateVersion,
        sourceWorldEventRef: consequence.sourceWorldEventId,
        candidateEventId: openWindow?.candidateEventId ?? null,
        virtualMinute: Math.max(autonomy.virtualMinute, Math.min(60, knownMinute)),
        paused: world.currentSnapshot.virtualTime.paused,
        endingStatus: world.currentSnapshot.endingState.status,
        signalUpdates: this.#runtime.autonomySignalsForEvent(
          event.eventType,
          world.resolutions.find((resolution) => resolution.resolutionId === event.resolutionId),
        ),
        variableValues: { ...autonomy.variables, ...Object.fromEntries((committedResolution?.variableDeltas ?? [])
          .filter(variable => Object.hasOwn(autonomy.variables, variable.variableId)).map(variable => [variable.variableId, variable.after])) },
        npcMemoryUpdates: this.#runtime.autonomyMemoryForEvent(
          event.eventType,
          event.eventId,
          consequence.publicSummary,
        ),
        ...this.#dialogueAutonomyUpdates(
          dialogueEpisodes,
          consequence.sourceWorldEventId,
        ),
        committedAt: consequence.occurredAt,
      };
      autonomy = (await this.#autonomousDirector.recordWorldCommit({
        ...payload,
        authorityToken: issueAuthoritativeWorldCommitTokenV4(
          this.#autonomousWorldAuthoritySecret,
          payload,
        ),
      })).record;
    }
    return autonomy;
  }

  #dialogueAutonomyUpdates(
    episodes: readonly DialogueEpisodeV4[],
    sourceWorldEventRef: string,
  ): Pick<AuthoritativeWorldCommitPayloadV4, "npcCommitmentUpdates" | "npcLocalFactUpdates"> {
    const episode = episodes.find((candidate) => (
      candidate.worldCommit?.worldEventRef === sourceWorldEventRef
    ));
    if (!episode) {
      return { npcCommitmentUpdates: [], npcLocalFactUpdates: [] };
    }
    const definition = this.#content.dialogueScenes.find((candidate) => (
      candidate.definitionId === episode.definitionRef
    ));
    if (!definition) {
      throw new Error(`对话 Episode 引用了未发布定义：${episode.definitionRef}`);
    }
    const facts = new Map(definition.facts.map((fact) => [fact.factRef, fact]));
    return {
      npcCommitmentUpdates: episode.commitments.map((commitment) => ({
        entityId: episode.npcRef,
        commitmentId: commitment.commitmentId,
        publicSummary: `${commitment.madeBy === "npc" ? "人物承诺" : "学生承诺"}：${commitment.summary} 条件：${commitment.condition}`,
        status: commitment.status === "fulfilled"
          ? "kept"
          : commitment.status === "withdrawn"
            ? "released"
            : commitment.status,
      })),
      npcLocalFactUpdates: episode.disclosedFactRefs.flatMap((factRef) => {
        const fact = facts.get(factRef);
        if (!fact) throw new Error(`对话 Episode 披露了未知事实：${factRef}`);
        return [{
          entityId: episode.npcRef,
          factRef: fact.factRef,
          confidence: this.#dialogueFactConfidence(fact),
          visibility: "student_public" as const,
          knowledgeRefs: [...fact.knowledgeRefs],
        }];
      }),
    };
  }

  #dialogueFactConfidence(
    fact: XunpuFlagshipContentV4["dialogueScenes"][number]["facts"][number],
  ): number {
    const sources = fact.knowledgeRefs.map((knowledgeRef) => {
      const base = xunpuCourseRelease.knowledgeRecords.find((record) => (
        record.knowledgeId === knowledgeRef
      ));
      if (base) {
        return {
          reviewStatus: base.reviewStatus,
          historical: base.source.publicationStatus === "historical_status_marker",
          context: `${base.teachingSummary} ${base.source.sourceVersion}`,
        };
      }
      const added = this.#content.addedKnowledgeRecords.find((record) => (
        record.knowledgeId === knowledgeRef
      ));
      if (added) {
        return {
          reviewStatus: added.reviewStatus,
          historical: /(?:废止|失效|历史)/u.test(added.sourceVersion),
          context: `${added.teachingSummary} ${added.sourceVersion}`,
        };
      }
      throw new Error(`对话事实引用了未知知识：${knowledgeRef}`);
    });
    const hasHistoricalSource = sources.some((source) => source.historical);
    const hasUnreviewedSource = sources.some((source) => source.reviewStatus !== "verified");
    const containsUncertainty = /(?:口述|自述|个人|据说|传言|待核|尚未|不代表|只能|线索|仿真)/u.test(
      `${fact.publicText} ${sources.map((source) => source.context).join(" ")}`,
    );
    const sourceConfidence = hasHistoricalSource
      ? 0.4
      : hasUnreviewedSource
        ? 0.6
        : 0.75;
    return Number(Math.min(
      sourceConfidence,
      containsUncertainty ? 0.55 : 0.75,
    ).toFixed(2));
  }

  async assertFieldAction(input: {
    sessionId: string; bindingId: string; actorId: string; principalId: string;
    requestId: string; action: StudentWorkAction["action"];
  }): Promise<void> {
    const record = await this.#engine.getRecord(input.sessionId);
    if (record.release.actionPolicy?.policyId !== "xunpu-flagship-action-policy-v4") return;
    // Exact replay validation remains with WorldEngine; a known request cannot acquire new effects.
    if (record.requestReceipts.some(receipt => receipt.requestId === input.requestId)) return;
    if (!["ask", "probe", "negotiate", "observe"].includes(input.action.verb) || !("targetRef" in input.action)) return;
    const { access } = await this.#issueWindow(record, input.bindingId, this.#runtime.phaseFor(record), input);
    this.#assertFieldTargets([input.action.targetRef.objectId], access);
  }

  #assertFieldTargets(objectIds: readonly string[], access: ReturnType<typeof deriveFieldAccessV4>): void {
    const npcIds = new Set(this.#content.cast.map(person => person.entityId));
    const locations = new Set(this.#content.locations.map(location => location.locationId));
    for (const id of objectIds) {
      const blocked = npcIds.has(id) ? access.person(id).prerequisite : locations.has(id) ? access.node(id) : null;
      if (blocked && !blocked.allowed) throw new PermissionDeniedError(blocked.reason!);
    }
  }

  async #issueWindow(
    record: SimulationSessionRecord,
    bindingId: string,
    phase: FlagshipRuntimePhaseV4,
    identity: { actorId: string; principalId: string },
  ) {
    const [allEpisodes, collaboration] = await Promise.all([
      this.#dialogue.listEpisodesForSession(record.sessionId),
      this.#orchestrator.loadRecord(record.sessionId),
    ]);
    const subjectHash = learnerSubjectHash({ sessionId: record.sessionId, ...identity });
    const episodes = allEpisodes.filter(episode => episode.studentBindingRef === bindingId && episode.studentActorRef === identity.actorId && episode.learnerSubjectHash === subjectHash);
    const access = deriveFieldAccessV4({
      actorId: identity.actorId, bindingId, actions: record.studentActions, events: record.queue,
      resolutions: record.resolutions, dialogues: episodes, intents: collaboration?.intents ?? [],
    });
    const existingRef = stableId("action-window", {
      sessionId: record.sessionId,
      bindingId,
      worldStateVersion: record.currentSnapshot.stateVersion,
      worldStateRef: phase.worldStateRef,
      runtimeDefinitionHash: this.#runtime.definitionHash,
      simulationReleaseHash: record.release.simulationReleaseRef.contentHash,
      fieldAccessPolicyVersion: fieldAccessPolicyVersionV4,
    });
    const existing = this.#windows.get(existingRef);
    if (existing && Date.parse(existing.window.expiresAt) > this.#now().getTime()) {
      return { ...existing, access, episodes };
    }
    const options = this.#runtime.actionWindowOptions(record, phase);
    const intents = [...options.allowedIntents];
    const npcIds = new Set(this.#content.cast.map(person => person.entityId));
    const locationIds = new Set(this.#content.locations.map(location => location.locationId));
    const objectIds = options.objectRefs.filter(id => npcIds.has(id) ? access.person(id).canContact : !locationIds.has(id) || access.node(id).allowed);
    const availableSelections = objectIds.map((objectId) => {
      const details = selectionLabel(this.#content, objectId);
      const allowedIntents = details.intents.filter((intent) => intents.includes(intent));
      return issueSemanticActionSelectionV4({
        secret: this.#selectionSecret,
        sessionId: record.sessionId,
        bindingId,
        actionWindowRef: existingRef,
        worldStateVersion: record.currentSnapshot.stateVersion,
        displayKind: selectionDisplayKind(this.#content, objectId),
        objectType: selectionObjectType(this.#content, objectId),
        objectId,
        label: details.label,
        consequenceHint: details.consequenceHint,
        // World objects (source packets, claim board, media collections and
        // clocks) are legitimate action targets. Only concrete attached media
        // assets are materials; treating every non-NPC as a material would let
        // a valid "compare these sources" intent pass classification without
        // any executable target.
        selectionRole: this.#content.mediaAssets.some(
          (item) => item.assetId === objectId,
        ) ? "material" : "target",
        allowedIntents: allowedIntents.length > 0 ? allowedIntents : intents,
      });
    });
    const actionWindowHash = hash({
      actionWindowRef: existingRef,
      sessionId: record.sessionId,
      bindingId,
      worldStateVersion: record.currentSnapshot.stateVersion,
      worldStateRef: phase.worldStateRef,
      selections: availableSelections.map((item) => ({
        selectionToken: item.selectionToken,
        displayKind: item.displayKind,
        objectType: item.objectType,
        objectId: item.objectId,
        selectionRole: item.selectionRole,
      })),
    });
    const window: SemanticActionWindowV4 = {
      sessionId: record.sessionId,
      bindingId,
      actionWindowRef: existingRef,
      actionWindowHash,
      worldStateVersion: record.currentSnapshot.stateVersion,
      worldStateRef: phase.worldStateRef,
      flagshipContentRef: structuredClone(this.#contentRef),
      availableSelections,
      implicitTargetSelections: [],
      allowedIntents: intents,
      expiresAt: new Date(this.#now().getTime() + 15 * 60_000).toISOString(),
    };
    const cached = { window, prompt: phase.prompt };
    this.#windows.set(existingRef, cached);
    return { ...cached, access, episodes };
  }

  async #startGroundedIfNeeded(input: {
    eventTemplateId: string;
    studentBindingId: string;
    episode: StudentAgentCollaborationEpisodeV3;
    record: SimulationSessionRecord;
  }): Promise<GroundedCollaborationStudentEnvelopeV4 | null> {
    const binding = this.#runtime.groundedBindingForEvent(input.eventTemplateId);
    if (!binding || !input.episode.triggerEvent) return null;
    const contentEpisode = this.#content.agentEpisodes.find((candidate) => (
      candidate.episodeTemplateId === binding.episodeTemplateRef
    ));
    if (!contentEpisode) {
      throw new Error(`V4 协作内容不存在：${binding.episodeTemplateRef}`);
    }
    const episodeId = stableId("grounded-episode", input.episode.triggerEvent.eventId);
    try {
      await this.#grounded.getRecord(episodeId);
      return this.refreshGroundedEvidence({ sessionId: input.episode.sessionId, bindingId: input.studentBindingId, episodeId });
    } catch (error) {
      if (!(error instanceof GroundedCollaborationRecordNotFoundError)) throw error;
    }
    const record = await this.#grounded.startEpisode({
      episodeId,
      sessionId: input.episode.sessionId,
      studentBindingId: input.studentBindingId,
      flagshipContentRef: this.#contentRef,
      episodeTemplateRef: binding.episodeTemplateRef,
      sourceWorldStateVersion: input.episode.sourceWorldStateVersion,
      triggerEventRef: input.episode.triggerEvent.eventId,
      affectedObjectRefs: binding.affectedObjectRefs,
      claimRefs: [...contentEpisode.groundedClaimRefs],
      evidence: groundedEvidence(binding, input.episode.triggerEvent, input.record),
      policy: "affected_set",
      maximumSelectedAgents: 5,
      executionBudgetMicros: this.#groundedExecutionBudgetMicros,
    });
    const episode = await this.#grounded.getStudentEpisode(record.episodeId);
    return {
      episode,
      decisionToken: episode.suggestion
        ? await this.#grounded.issueStudentDecisionToken(record.episodeId, input.studentBindingId)
        : null,
    };
  }

  async #currentGrounded(
    sessionId: string,
    bindingId: string,
    audience: ExperienceAudienceV4,
  ): Promise<GroundedCollaborationAudienceViewV4 | null> {
    const v3 = await this.#orchestrator.getCurrentEpisode(sessionId);
    const eventId = v3.student.triggerEvent?.eventId;
    if (!eventId) return null;
    const episodeId = stableId("grounded-episode", eventId);
    try {
      let record = await this.#grounded.getRecord(episodeId);
      if (record.status === "student_decided"
        && record.studentDecision?.decision === "accept"
        && record.worldConsequence === null
        && v3.student.consequence?.status === "committed") {
        await this.#recordGroundedConsequence(
          episodeId,
          record.request.sourceWorldStateVersion,
          v3.student,
        );
        record = await this.#grounded.getRecord(episodeId);
      }
      if (audience === "student") {
        if (record.status === "joint_proposal_ready" && !record.request.evidenceAuthorization) {
          return this.refreshGroundedEvidence({ sessionId, bindingId, episodeId });
        }
        const episode = await this.#grounded.getStudentEpisode(episodeId);
        let decisionToken: string | null = null;
        if (episode.status === "suggestion_ready" && episode.suggestion) {
          try { decisionToken = await this.#grounded.issueStudentDecisionToken(episodeId, bindingId); }
          catch (error) {
            if (!(error instanceof GroundedEvidenceAuthorizationChangedError)) throw error;
            return this.refreshGroundedEvidence({ sessionId, bindingId, episodeId });
          }
        }
        return {
          episode,
          decisionToken,
        };
      }
      if (audience === "teacher") {
        return { episode: await this.#grounded.getTeacherEpisode(episodeId) };
      }
      return {
        episode: await this.#grounded.getAdminEpisode(episodeId),
        ablation: observeGroundedCollaborationAblationV4(record),
      };
    } catch (error) {
      if (error instanceof GroundedCollaborationRecordNotFoundError) return null;
      throw error;
    }
  }

  async #recordGroundedConsequence(
    episodeId: string,
    sourceWorldStateVersion: number,
    v3Episode: StudentAgentCollaborationEpisodeV3,
  ): Promise<StudentGroundedCollaborationEpisodeV4> {
    const consequence = v3Episode.consequence;
    if (!consequence
      || consequence.status !== "committed"
      || consequence.resultingStateVersion === null) {
      throw new Error("V4 后果同步缺少权威世界收据");
    }
    const resultingWorldStateVersion = consequence.resultingStateVersion;
    const payload = {
      receiptRef: stableId("grounded-world-receipt", consequence.resolutionId),
      episodeId,
      sourceWorldStateVersion,
      resultingWorldStateVersion,
      worldConsequenceRef: consequence.resolutionId,
      worldEventContentHash: hash({
        resolutionId: consequence.resolutionId,
        publicSummary: consequence.publicSummary,
        worldEventIds: consequence.worldEventIds,
        evidenceIds: consequence.evidenceIds,
        resultingStateVersion: resultingWorldStateVersion,
      }),
      committedAt: this.#now().toISOString(),
    };
    return this.#grounded.recordWorldConsequence({
      ...payload,
      authorityToken: issueGroundedWorldConsequenceTokenV4(
        this.#groundedWorldAuthoritySecret,
        payload,
      ),
    });
  }
}

export function flagshipContentReferenceV4Of(
  release: SimulationSessionRecord["release"],
): FlagshipContentReferenceV4 {
  return FlagshipContentReferenceV4Schema.parse({
    schemaVersion: FlagshipContentReferenceV4SchemaVersion,
    contentSchemaVersion: xunpuFlagshipContentV4.schemaVersion,
    courseReleaseRef: release.courseReleaseRef,
    scenarioReleaseRef: release.scenarioReleaseRef,
    simulationReleaseRef: release.simulationReleaseRef,
    contentHash: xunpuFlagshipContentV4.contentHash,
  });
}

export type FlagshipSemanticActionDiagnosticsV4 = SemanticActionRuntimeDiagnosticsV4;
