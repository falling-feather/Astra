import { DemoLoginRequestSchema } from '@ronggang/contracts';
import { demoLoginAccounts } from './demo-login-accounts.js';
import { readFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { isAbsolute, relative, resolve } from "node:path";
import cors from "@fastify/cors";
import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyRequest,
} from "fastify";
import { z } from "zod";
import {
  ActionEnvelopeSchemaVersion,
  ChallengeAssignmentSchemaVersion,
  AgentContributionDecisionCommandPayloadSchema,
  AgentContributionDecisionEventPayloadSchema,
  AgentRunTraceSchema,
  CollaborationStrategyReferenceSchema,
  CommandNameSchema,
  CourseReleaseReferenceSchema,
  ExperienceChoiceCommandPayloadSchema,
  GoldBlindReviewConditionKeyEntrySchema,
  GoldBlindReviewPacketSchema,
  GoldBlindReviewSubmissionInputSchema,
  GoldControlledAblationPreregistrationSchema,
  GoldPilotConsentInputSchema,
  GoldPilotParticipantAssignmentSchema,
  GoldPilotReadinessIdSchema,
  GoldPilotReadinessPlanInputSchema,
  GoldPilotRubricResolutionInputSchema,
  GoldPilotRubricReviewInputSchema,
  GoldPilotRunFinalizeInputSchema,
  GoldPilotWorkloadPhaseSchema,
  MaterialSchema,
  OperationsHealthSchemaVersion,
  OperationsHealthSnapshotSchema,
  RecoveryCheckpointObservationSchema,
  RecoveryCheckpointSchemaVersion,
  ScenarioCollaborationConfigSchema,
  SessionControlOverviewSchema,
  SessionControlSchemaVersion,
  SessionTracePageSchema,
  SessionTracePageSchemaVersion,
  StudentAdviceDecisionRequestSchema,
  StudentTrainingMutationReceiptSchema,
  StudentTrainingMutationReceiptSchemaVersion,
  TrainingSessionSummarySchema,
  courseReleaseReferenceOf,
  createMessageMeta,
  type AgentArchitectureProfile,
  type ActionEnvelope,
  type AgentAblationEvidence,
  type CollaborationStrategyReference,
  type Command,
  type CourseRelease,
  type CourseReleaseReference,
  type CrossCourseAgentRuleManifest,
  type ExperimentObservationRef,
  type ScenarioPackage,
  type SessionExperienceDescriptor,
} from "@ronggang/contracts";
import { ProductVersion } from "@ronggang/contracts/version";
import {
  buildXunpuFlagshipRuntimeReleaseV3R2,
  hashCanonical,
  publishInteractiveXunpuContractCourseRelease,
  xunpuV4AssessmentCriteria,
  xunpuFlagshipContentV4,
  xunpuExplorationLesson,
  courseFieldLessonsV3,
  createFieldLessonVariantV3,
  xunpuFlagshipContentManifestV3,
  xunpuFlagshipCourseProjection,
} from "@ronggang/course-content";
import {
  InMemoryScenarioCatalogStore,
  ScenarioCatalog,
  ScenarioCatalogNotFoundError,
  ScenarioPublishConflictError,
  ScenarioRevisionConflictError,
  createSeedRelease,
} from "@ronggang/scenario-catalog";
import {
  AuthorizedRagRetriever,
  InMemoryRoleMemoryStore,
  JsonlRoleMemoryStore,
  RoleMemoryService,
  VersionedContextAssembler,
  buildRoleMemoryIntegrityManifest,
  createAccessSubject,
  createResourceAudience,
  createRoleMemoryDelta,
  hashValue,
  roleMemoryNamespace,
  type RoleMemoryStore,
} from "@ronggang/context-engine";
import {
  GoldBlindReviewCoordinator,
  GoldBlindReviewWorkflowError,
  GoldPilotReadinessCoordinator,
  GoldPilotReadinessError,
  GoldPilotStudyCoordinator,
  GoldPilotStudyError,
  InMemoryGoldBlindReviewBatchStore,
  InMemoryGoldPilotReadinessStore,
  InMemoryGoldPilotStudyStore,
  createAgentContributionDecisionEventPayload,
  createGoldCompetitionReadinessSnapshot,
  createGoldReadinessWorkbench,
  createGoldControlledAblationPreregistration,
  createGoldTechnicalEvidencePlan,
  buildCrossCourseAgentRuleManifest,
  buildInsufficientAgentAblationEvidence,
  buildAgentTopologyManifest,
  selectKeyAgentContributionCards,
  type GoldBlindReviewBatchStore,
  type GoldPilotReadinessStore,
  type GoldPilotStudyStore,
} from "@ronggang/agent-runtime";
import {
  AssistanceTaskHandler,
  EvidenceAssessmentRubricV4Schema,
  FactCheckerTaskHandler,
  InMemoryAgentTaskStore,
  InMemorySimulationCollaborationStoreV3,
  InMemoryGroundedCollaborationStoreV4,
  GroundedEvidenceAuthorizationChangedError,
  JsonFileSimulationCollaborationStoreV3,
  JsonFileGroundedCollaborationStoreV4,
  JsonlAgentTaskStore,
  LearningCuratorTaskHandler,
  RoleAgentTaskHandler,
  SceneDirectorTaskHandler,
  SemanticEvaluationTaskHandler,
  TeachingDirectorTaskHandler,
  TrainingSessionOrchestrator,
  SimulationAgentOrchestratorV3,
  buildXunpuSimulationAgentTemplatesV3R2,
  buildXunpuGroundedCollaborationRuntimeContentV4,
  createXunpuDeterministicSimulationExecutorsV3R2,
  buildXunpuSimulationTaskInstructionV3,
  type AgentTaskStore,
  type GroundedCollaborationStoreV4,
} from "@ronggang/agent-orchestrator";
import {
  UnifiedIflytekAdapter,
  createIflytekLiveHandlers,
  createXingchenModelInvocationHandler,
} from "@ronggang/iflytek-adapter";
import {
  InMemoryMediaProcessingWorkStore,
  JsonlMediaProcessingWorkStore,
  MediaProcessingOrchestrator,
  type MediaProcessingWorkStore,
} from "@ronggang/media-processing";
import {
  DomainRevisionConflictError,
  DialogueAlreadyActiveError,
  DialogueAudienceMismatchError,
  DialogueClosedError,
  DialogueDefinitionDriftError,
  DialogueEpisodeNotFoundError,
  DialogueEpisodeStoreConflictError,
  DialogueIdempotencyConflictError,
  DialogueRevisionConflictError,
  DialogueWorldStateConflictError,
  InvalidWorldActionError,
  InvalidSimulationOperationError,
  InMemorySimulationSessionStore,
  InMemoryAutonomousWorldStoreV4,
  AutonomousWorldRecordNotFoundError,
  InMemoryDialogueEpisodeStoreV4,
  JsonFileAutonomousWorldStoreV4,
  JsonFileDialogueEpisodeStoreV4,
  JsonFileSimulationSessionStore,
  PermissionDeniedError,
  SessionNotFoundError,
  SimulationNoReadyEventError,
  SimulationRequestReplayError,
  SimulationSessionNotFoundError,
  SimulationTeacherGatePendingError,
  SimulationWorldEndedError,
  StateVersionConflictError,
  WorldEngine,
  WorldSimulationEngineV3,
  XunpuAutonomousWorldDirectorV4,
  type AutonomousWorldStoreV4,
  type DialogueEpisodeStoreV4,
  type DialogueRuleSelectorV4,
  demoScenario,
  demoScenarioV041LegacyContentHash,
  demoScenarioV051ContentHash,
  demoScenarioV060ContentHash,
  demoScenarioV061ContentHash,
  demoScenarioV070ContentHash,
  demoScenarioV100ContentHash,
  deriveAuthoredExperienceSequence,
  flagshipScenarioV110,
  flagshipScenarioV110ContentHash,
  flagshipScenarioV111,
  flagshipScenarioV111ContentHash,
  heritageNightTourScenarioV100,
  heritageNightTourScenarioV100ContentHash,
  legacyDemoScenarioV041,
  legacyDemoScenarioV051,
  legacyDemoScenarioV060,
  legacyDemoScenarioV061,
  legacyDemoScenarioV070,
  migrationRuntimeCourseReleases,
  migrationRuntimeScenarios,
  migrationRuntimeSeedReleases,
  transferScenarioV100,
  transferScenarioV100ContentHash,
  xunpuScenarioV200,
  xunpuScenarioV200ContentHash,
  xunpuScenarioV201,
  xunpuScenarioV201ContentHash,
} from "@ronggang/world-core";
import {
  InMemorySessionControlStore,
  LocalRecoveryCheckpointCatalog,
  SessionControlError,
  SessionControlService,
  type RecoveryCheckpointCatalog,
  type SessionMembership,
  type SessionControlStore,
  type TrainingSessionRecord,
} from "@ronggang/session-control";
import { JsonlEventStore } from "./file-event-store.js";
import { JsonlGoldBlindReviewBatchStore } from "./jsonl-gold-blind-review-store.js";
import { JsonlGoldPilotReadinessStore } from "./jsonl-gold-pilot-readiness-store.js";
import { JsonlGoldPilotStudyStore } from "./jsonl-gold-pilot-study-store.js";
import { JsonlScenarioCatalogStore } from "./file-scenario-catalog.js";
import { JsonlSessionControlStore } from "./jsonl-session-control-store.js";
import {
  createModelIntegration,
  type ModelIntegration,
} from "./model-integration.js";
import { createFlagshipGatewayModelsV4 } from "./flagship-model-adapters-v4.js";
import {
  AuthenticationRequiredError,
  DEMO_AUTH_COOKIE,
  DemoAuthService,
  RoleBindingDeniedError,
  readCookie,
  stableMembershipBindingId,
  type MembershipRoleAssignment,
} from "./identity.js";
import {
  InMemoryContentAddressedObjectStore,
  LocalContentAddressedObjectStore,
  assertSafeUpload,
  collectRecoveryObjectSourceRefs,
  inspectReferencedObjectIntegrity,
  mediaTypeForMime,
  sha256,
  type ObjectStore,
} from "./local-object-store.js";
import { buildFlagshipTraceProjection, buildSessionTraceProjection } from "./trace-projection.js";
import { buildCollaborationReplay } from "./collaboration-replay.js";
import {
  CollaborationStrategyService,
  InMemoryCollaborationStrategyStore,
  type CollaborationStrategyStore,
} from "./collaboration-strategy-store.js";
import { JsonlCollaborationStrategyStore } from "./jsonl-collaboration-strategy-store.js";
import { registerCollaborationStrategyRoutes } from "./collaboration-strategy-routes.js";
import { registerStrategyReuseRoutes } from "./strategy-reuse-routes.js";
import { StrategyReuseService } from "./strategy-reuse.js";
import {
  CourseLearningError,
  CourseLearningService,
  InMemoryCourseEnrollmentStore,
  type CourseEnrollmentStore,
  type CourseLaunchDefinition,
  type CourseLearningBinding,
  type CourseOutcomeProjectionReader,
  type LearningActivityProjectionReader,
} from "./course-learning.js";
import { JsonlCourseEnrollmentStore } from "./jsonl-course-enrollment-store.js";
import { ContentLibraryRuntime } from "./content-library-runtime.js";
import { xunpuCourseRelease } from "@ronggang/course-content";
import { SqlGroundedEvidencePorts } from "./content-grounded-retrieval.js";
import { registerContentLibraryRoutes } from "./content-library-routes.js";
import { ContentLibraryAuthorizationError } from "./content-library.js";
import { ContentIngestionError, type ContentIngestionProcessor } from "./content-ingestion.js";
import { ContentRetrievalDeniedError } from "./content-retrieval.js";
import { ContentStoreConflictError, ContentStoreValidationError } from "@ronggang/content-store";
import { LocalEmbeddingUnavailableError, type TextEmbeddingProvider } from "@ronggang/context-engine";
import { collectFlagshipWorldOutcomeSource, projectFlagshipCourseOutcome } from "./flagship-course-outcome-projection.js";
import { FieldEvidenceSourceError } from "./field-evidence.js";
import { registerCourseLearningRoutes, type CourseLearningRouteDependencies } from "./course-learning-routes.js";
import { registerCourseArchiveRoutes } from "./course-archive-routes.js";
import { StudentStudyStore, StudyConflictError } from "./student-study.js";
import { PublishedCourseRuntime, type PublishedStudyActor } from "./published-course-runtime.js";
import { registerStudentStudyRoutes } from "./student-study-routes.js";
import {
  AgentCollaborationEpisodeService,
  findPendingTeacherGateCandidate,
  type BuildCollaborationEpisodeInput,
} from "./agent-collaboration-episode.js";
import { registerAgentCollaborationEpisodeRoutes } from "./agent-collaboration-episode-routes.js";
import {
  AgentAblationIntegrityError,
  registerAgentAblationRoutes,
} from "./agent-ablation-routes.js";
import {
  buildStudentTrainingContext,
  StudentTrainingContextError,
} from "./student-training-context.js";
import { registerStudentTrainingContextRoutes } from "./student-training-context-routes.js";
import {
  buildSessionExperienceDescriptor,
  InMemorySessionExperienceDescriptorStore,
  JsonlSessionExperienceDescriptorStore,
  SessionExperienceDescriptorError,
  SessionExperienceDescriptorService,
  type SessionExperienceDescriptorStore,
} from "./session-experience-descriptor.js";
import { registerSessionExperienceDescriptorRoutes } from "./session-experience-descriptor-routes.js";
import {
  BusinessOperationCoordinator,
  BusinessOperationError,
  InMemoryBusinessOperationReceiptStore,
  JsonlBusinessOperationReceiptStore,
  computeBusinessOperationRequestHash,
  type BusinessOperationReceiptStore,
} from "./business-operation-receipt.js";
import { registerBusinessOperationRoutes } from "./business-operation-routes.js";
import { createPlatformCompositionRoots } from "./platform-composition-roots.js";
import { registerWorldSimulationV3Routes } from "./world-simulation-v3-routes.js";
import { XunpuWorldDirectorV3 } from "./xunpu-world-director-v3.js";
import {
  FlagshipExperienceServiceV4,
  flagshipContentReferenceV4Of,
} from "./flagship-experience-v4.js";
import { registerFlagshipExperienceV4Routes } from "./flagship-experience-v4-routes.js";
import { FieldInterviewService } from "./field-interview-service.js";
import { provisionFlagshipSession, membershipAssignment } from "./flagship-session-provision.js";
import { TeachingTaskError, TeachingTaskService } from "./teaching-task-service.js";
import { CharacterStudio } from "./character-studio.js";
import { registerCharacterStudioRoutes, type TeachingAuthorizer } from "./character-studio-routes.js";
import { registerTeacherArchiveRoutes } from "./teacher-archive-routes.js";
import { TeachingTaskRuntime } from "./teaching-task-runtime.js";
import { registerTeachingTaskRoutes } from "./teaching-task-routes.js";
import { JsonFileFieldModelAttemptStore } from "./field-model-attempt-store.js";
import { registerFieldInterviewRoutes } from "./field-interview-routes.js";
import { StudentNotebookStore, NotebookConflictError } from "./student-notebook.js";
import { registerStudentNotebookRoutes } from "./student-notebook-routes.js";
import { loadFieldLessonCatalog } from "./field-lesson-catalog.js";
import { deriveAdaptiveFieldLesson } from "./adaptive-field-lesson.js";
import {
  FlagshipMediaServiceV4,
  InMemoryFlagshipMediaRevisionStoreV4,
  JsonFileFlagshipMediaRevisionStoreV4,
  type FlagshipMediaRevisionStoreV4,
} from "./flagship-media-v4.js";
import { registerFlagshipMediaV4Routes } from "./flagship-media-v4-routes.js";
import { FfmpegMultimodalQualityPreparerV4 } from "./flagship-multimodal-quality-v4.js";
import {
  FlagshipStudentWorkErrorV3,
  FlagshipStudentWorkServiceV3,
  InMemoryFlagshipStudentWorkStoreV3,
  JsonFileFlagshipStudentWorkStoreV3,
  type FlagshipStudentWorkStoreV3,
} from "./flagship-student-work-v3.js";
import { registerFlagshipWorkspaceV3Routes } from "./flagship-workspace-v3-routes.js";
import { registerFlagshipRoleViewsV3Routes } from "./flagship-role-views-v3-routes.js";
import {
  FlagshipAssessmentErrorV3,
  FlagshipCompetencyAssessmentServiceV3,
  InMemoryFlagshipAssessmentStoreV3,
  JsonFileFlagshipAssessmentStoreV3,
  type BlindSemanticAssessmentPortV3,
  type FlagshipAssessmentStoreV3,
} from "./flagship-assessment-v3.js";
import { registerFlagshipAssessmentV3Routes } from "./flagship-assessment-v3-routes.js";
import {
  currentFlagshipAssessmentDecisionV4,
  FlagshipAssessmentErrorV4,
  FlagshipEvidenceAssessmentServiceV4,
  InMemoryFlagshipAssessmentStoreV4,
  JsonFileFlagshipAssessmentStoreV4,
  type FlagshipAssessmentStoreV4,
} from "./flagship-assessment-v4.js";
import { registerFlagshipAssessmentV4Routes } from "./flagship-assessment-v4-routes.js";
import {
  InMemoryLearnerAdaptationStoreV3,
  JsonFileLearnerAdaptationStoreV3,
  LearnerAdaptationErrorV3,
  LearnerAdaptationServiceV3,
  type LearnerAdaptationStoreV3,
  type LearnerProxyAgentPortV3,
} from "./learner-adaptation-v3.js";
import { registerLearnerAdaptationV3Routes } from "./learner-adaptation-v3-routes.js";
import {
  InMemoryLearnerAdaptationStoreV4,
  JsonFileLearnerAdaptationStoreV4,
  LearnerAdaptationErrorV4,
  LearnerAdaptationServiceV4,
  type LearnerAdaptationStoreV4,
  type ProvisionSecondSessionV4,
} from "./learner-adaptation-v4.js";
import { registerLearnerAdaptationV4Routes } from "./learner-adaptation-v4-routes.js";
import { buildOperationsHealthSnapshot } from "./operations-health.js";
import {
  createGoldCompetitionEvidenceLoader,
  type GoldCompetitionEvidenceLoader,
} from "./gold-competition-evidence-loader.js";
import {
  createGoldCompetitionOfficialEvidenceLoader,
  type GoldCompetitionOfficialEvidenceLoader,
} from "./gold-competition-official-loader.js";
import {
  createGoldCompetitionScorecardEvidenceLoader,
  type GoldCompetitionScorecardEvidenceLoader,
} from "./gold-competition-scorecard-loader.js";
import {
  TracePaginationCursorError,
  paginateSessionTrace,
} from "./trace-pagination.js";
import {
  SessionRecoveryCheckpointCoordinator,
  buildSessionRecoveryIntegrityPayload,
} from "./recovery-checkpoint-coordinator.js";
import {
  LOCAL_DATA_RESTORE_OWNER_FILE,
  acquireLocalDataDirectoryLease,
  type LocalDataDirectoryLease,
} from "./local-data-directory-lease.js";
import {
  DEMO_CLASSROOM_A_ID,
  DEMO_CLASSROOM_B_ID,
  DEMO_SECONDARY_SESSION_ID,
  DEMO_TEAM_A_ID,
  DEMO_TEAM_B_ID,
  assertTeacherScope,
  demoProfileDefinitions,
  getDemoProfile,
  materializeProfileAssignments,
  seedDemoOrganization,
} from "./session-control-bootstrap.js";

export const DEMO_SESSION_ID = "demo-local-tourism";
export const DEMO_XUNPU_SESSION_ID = "demo-xunpu-v2";
export const DEMO_VILLAGE_SUPER_SESSION_ID = "demo-village-super-v2";
export const DEMO_VILLAGE_POSTPUBLICATION_SESSION_ID = "demo-village-postpublication-v2";
export const DEMO_AI_COPYRIGHT_SESSION_ID = "demo-ai-copyright-v2";
export const DEMO_RAIN_EMERGENCY_SESSION_ID = "demo-rain-emergency-v2";

type CompletionCandidateRef = NonNullable<
  BuildCollaborationEpisodeInput["completionCandidateRef"]
>;

function completionCandidateRefOf(
  scenario: ScenarioPackage,
  nodeId: string,
): CompletionCandidateRef | null {
  const design = scenario.experienceDesign;
  const branch = design?.causalBranches.find((candidate) => (
    candidate.nodeId === nodeId
  ));
  const mapping = design?.nodeMappings.find((candidate) => (
    candidate.nodeId === nodeId
  ));
  if (!branch || !mapping) return null;
  const dynamicEvent = mapping.dynamicEvents.find((candidate) => (
    candidate.dynamicEventId === branch.worldConsequenceRef
    && candidate.triggerKind === "student_action"
    && candidate.triggerRef === branch.studentChoiceRef
    && candidate.approvalPolicyId !== null
  ));
  if (
    !dynamicEvent?.approvalPolicyId
    || !mapping.operationTasks.some((task) => (
      task.taskId === branch.studentChoiceRef
    ))
    || !scenario.approvalPolicies.some((policy) => (
      policy.approvalPolicyId === dynamicEvent.approvalPolicyId
      && policy.reviewMode === "teacher_required"
    ))
  ) return null;
  return {
    actionId: branch.studentChoiceRef,
    dynamicEventId: dynamicEvent.dynamicEventId,
    eventType: dynamicEvent.eventType,
    approvalPolicyId: dynamicEvent.approvalPolicyId,
  };
}

const bundledWebPublicRoot = fileURLToPath(
  new URL("../../web/public/", import.meta.url),
);
const bundledGoldCompetitionEvidenceRoot = fileURLToPath(
  new URL("../../../artifacts/gold-readiness/", import.meta.url),
);

export async function assertBundledScenarioMaterialIntegrity(
  scenario: ScenarioPackage,
  publicRoot = bundledWebPublicRoot,
): Promise<void> {
  const root = resolve(publicRoot);
  for (const material of scenario.materials) {
    if (
      material.origin === "upload"
      || !material.sourceRef.startsWith("/assets/")
    ) {
      continue;
    }
    if (!material.contentHash) {
      throw new Error(
        `内置材料缺少内容哈希，拒绝启动：${material.materialId}`,
      );
    }
    const assetPath = resolve(
      root,
      material.sourceRef.replace(/^\/+/u, ""),
    );
    const pathFromRoot = relative(root, assetPath);
    if (
      !pathFromRoot
      || pathFromRoot.startsWith("..")
      || isAbsolute(pathFromRoot)
    ) {
      throw new Error(
        `内置材料路径越界，拒绝启动：${material.materialId}`,
      );
    }
    const bytes = await readFile(assetPath);
    const actualHash = sha256(bytes);
    if (actualHash !== material.contentHash) {
      throw new Error(
        `内置材料内容哈希不匹配，拒绝启动：${material.materialId}`,
      );
    }
  }
}

const bindingQuerySchema = z.object({ bindingId: z.string().min(1) });
const goldBlindReviewBatchCreateBodySchema = z.object({
  bindingId: z.string().min(1),
  packet: GoldBlindReviewPacketSchema,
  conditionKey: z.array(GoldBlindReviewConditionKeyEntrySchema).min(1),
  preregistration: GoldControlledAblationPreregistrationSchema,
  reviewerAliases: z.array(
    z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,39}$/u),
  ).min(2).max(10),
}).strict();
const goldBlindReviewTeacherActionSchema = z.object({
  bindingId: z.string().min(1),
}).strict();
const goldBlindReviewAccessCodeSchema = z.string().regex(
  /^[a-zA-Z0-9_-]{24,120}$/u,
);
const goldPilotStudyCreateBodySchema = z.object({
  bindingId: z.string().min(1),
  readinessId: GoldPilotReadinessIdSchema,
  freezeReceiptHash: z.string().regex(/^[a-f0-9]{64}$/u),
  participantAssignments: z.array(
    GoldPilotParticipantAssignmentSchema,
  ).min(1),
}).strict();
const goldPilotReadinessPlanCreateBodySchema =
  GoldPilotReadinessPlanInputSchema.extend({
    bindingId: z.string().min(1),
  }).strict();
const goldPilotReadinessReviewBodySchema = z.object({
  bindingId: z.string().min(1),
  reviewerAlias: z.string().regex(
    /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,39}$/u,
  ),
  review: GoldPilotRubricReviewInputSchema,
}).strict();
const goldPilotReadinessResolutionBodySchema = z.object({
  bindingId: z.string().min(1),
  resolution: GoldPilotRubricResolutionInputSchema,
}).strict();
const goldPilotReadinessConsentBodySchema = z.object({
  bindingId: z.string().min(1),
  consent: GoldPilotConsentInputSchema,
}).strict();
const goldPilotWorkloadStartBodySchema = z.object({
  bindingId: z.string().min(1),
  phase: GoldPilotWorkloadPhaseSchema,
}).strict();
const goldPilotTeacherActionSchema = z.object({
  bindingId: z.string().min(1),
}).strict();
const goldPilotRunFinalizeBodySchema = z.object({
  bindingId: z.string().min(1),
  finalization: GoldPilotRunFinalizeInputSchema,
}).strict();
const commandBodySchema = z.object({
  bindingId: z.string().min(1),
  name: CommandNameSchema,
  expectedStateVersion: z.number().int().nonnegative(),
  sourceMode: z.enum(["course_platform", "world_interaction"])
    .default("course_platform"),
  surfaceId: z.string().min(1).max(120).optional(),
  interactionId: z.string().min(1).max(240).nullable().default(null),
  actionId: z.string().min(1).max(240).optional(),
  idempotencyKey: z.string().min(1).max(320).optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
}).strict();
const teacherGateDecisionBodySchema = z.object({
  bindingId: z.string().min(1),
  expectedStateVersion: z.number().int().nonnegative(),
  decision: z.enum(["approve", "request_evidence", "reject"]),
  reason: z.string().trim().min(1).max(1_000),
}).strict();
const teacherGateDecisionParamsSchema = z.object({
  sessionId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/u),
  gateId: z.string().regex(/^[a-zA-Z0-9_.:-]{1,160}$/u),
}).strict();
const emptyStrictQuerySchema = z.object({}).strict();
const teacherGateMutationReceiptSchema = z.object({
  schemaVersion: z.literal("teacher-gate-mutation-receipt/2.0.0"),
  accepted: z.literal(true),
  sessionId: z.string().min(1),
  stateVersion: z.number().int().nonnegative(),
  gateId: z.string().min(1),
  decision: z.enum(["approve", "request_evidence", "reject"]),
}).strict();
const resetBodySchema = z.object({
  bindingId: z.string().min(1),
});
const demoSessionBodySchema = z.object({
  sessionId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/u).optional(),
  profileId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/u).optional(),
}).strict();
const demoCourseClaimBodySchema = z.object({
  sessionId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/u),
  profileId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/u),
}).strict();
const scenarioAuthorQuerySchema = z.object({
  bindingId: z.string().min(1),
  authorizationSessionId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/u),
});
const scenarioAuthorBodySchema = z.object({
  bindingId: z.string().min(1),
  authorizationSessionId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/u),
}).strict();
const scenarioDraftUpdateSchema = scenarioAuthorBodySchema.extend({
  expectedRevision: z.number().int().positive(),
  patch: z.object({
    version: z.string().optional(),
    title: z.string().min(1).max(160).optional(),
    description: z.string().min(1).max(2_000).optional(),
    roles: z.array(z.object({
      agentId: z.string().min(1),
      displayName: z.string().min(1).max(80),
      purpose: z.string().min(1).max(500),
    }).strict()).optional(),
    approvalPolicies: z.array(z.object({
      approvalPolicyId: z.string().min(1),
      label: z.string().min(1).max(120),
      allowReject: z.boolean(),
      reasonRequired: z.boolean(),
      minimumEvidenceCount: z.number().int().min(0).max(100),
    }).strict()).optional(),
    directorConfig: z.object({
      difficulty: z.enum(["supportive", "standard", "challenging"]),
      cadence: z.enum(["conservative", "balanced", "dynamic"]),
      cooldownEvents: z.number().int().min(0).max(100),
      allowedRouteIds: z.array(z.string().min(1)).min(1),
    }).strict().optional(),
    collaborationConfig: ScenarioCollaborationConfigSchema.optional(),
  }).strict(),
}).strict();
const scenarioDraftActionSchema = scenarioAuthorBodySchema.extend({
  expectedRevision: z.number().int().positive(),
}).strict();
const scenarioPublishSchema = scenarioDraftActionSchema.extend({
  validationStamp: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();
const sessionStartSchema = scenarioAuthorBodySchema.extend({
  requestId: z.string().min(1).max(160),
  classroomId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/u),
  teamId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/u),
  releaseId: z.string().min(1),
  courseReleaseRef: CourseReleaseReferenceSchema.optional(),
}).strict();
const sessionListQuerySchema = scenarioAuthorQuerySchema;
const sessionRecoverSchema = scenarioAuthorBodySchema.strict();
const tracePageQuerySchema = bindingQuerySchema.extend({
  cursor: z.string().min(1).max(4_096).optional(),
  limit: z.coerce.number().finite().optional(),
});
const ragQuerySchema = z.object({ bindingId: z.string().min(1), q: z.string().min(1).max(300) });
const contextDebugQuerySchema = z.object({
  bindingId: z.string().min(1),
  targetAgentId: z.string().min(1),
  q: z.string().min(1).max(300),
});
const uploadMaterialQuerySchema = z.object({
  bindingId: z.string().min(1),
  expectedStateVersion: z.coerce.number().int().nonnegative(),
  requestId: z.string().min(1).max(160),
  fileName: z.string().min(1).max(160),
  title: z.string().min(1).max(160),
  mimeType: z.enum([
    "text/plain",
    "application/pdf",
    "image/jpeg",
    "image/png",
    "audio/mpeg",
    "audio/wav",
    "video/mp4",
  ]),
}).strict();
const defaultDevelopmentOrigins = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);
const maximumParsedUploadBytes = 6 * 1024 * 1024;
const nonBlockingConcurrentEventTypes = new Set([
  "agent_run_recorded",
  "agent_intent_recorded",
  "teaching_directive_recorded",
  "scene_director_decision_recorded",
]);

export interface CreateAppOptions {
  contentProcessor?: ContentIngestionProcessor;
  contentEmbeddings?: TextEmbeddingProvider;
  engine?: WorldEngine;
  orchestrator?: TrainingSessionOrchestrator;
  taskStore?: AgentTaskStore;
  mediaOrchestrator?: MediaProcessingOrchestrator;
  mediaWorkStore?: MediaProcessingWorkStore;
  adapter?: UnifiedIflytekAdapter;
  objectStore?: ObjectStore;
  dataDir?: string;
  logger?: boolean;
  initializeDemo?: boolean;
  environment?: NodeJS.ProcessEnv;
  modelIntegration?: ModelIntegration;
  authService?: DemoAuthService;
  scenarioCatalog?: ScenarioCatalog;
  roleMemoryStore?: RoleMemoryStore;
  contextAssembler?: VersionedContextAssembler;
  sessionControlStore?: SessionControlStore;
  recoveryCheckpointCatalog?: RecoveryCheckpointCatalog | null;
  initializeSecondaryDemo?: boolean;
  initializeGoldScenarioRelease?: boolean;
  awaitStartupRecovery?: boolean;
  beforeTrainingSessionActivation?: (sessionId: string) => void | Promise<void>;
  architectureProfile?: AgentArchitectureProfile | null;
  experimentObservation?: ExperimentObservationRef | null;
  goldBlindReviewStore?: GoldBlindReviewBatchStore;
  goldPilotReadinessStore?: GoldPilotReadinessStore;
  goldPilotStudyStore?: GoldPilotStudyStore;
  goldCompetitionEvidenceDir?: string;
  goldCompetitionEvidenceLoader?: GoldCompetitionEvidenceLoader;
  goldCompetitionOfficialEvidenceLoader?:
    GoldCompetitionOfficialEvidenceLoader;
  goldCompetitionScorecardEvidenceLoader?:
    GoldCompetitionScorecardEvidenceLoader;
  collaborationStrategyStore?: CollaborationStrategyStore;
  strategyReuseReference?: CollaborationStrategyReference;
  courseReleases?: readonly CourseRelease[];
  courseLaunches?: readonly CourseLaunchDefinition[];
  courseEnrollmentStore?: CourseEnrollmentStore;
  learningActivityProjectionReader?: LearningActivityProjectionReader;
  courseOutcomeProjectionReader?: CourseOutcomeProjectionReader;
  agentRuleManifestReader?: () => CrossCourseAgentRuleManifest | Promise<CrossCourseAgentRuleManifest>;
  agentAblationEvidenceReader?: () => AgentAblationEvidence | Promise<AgentAblationEvidence>;
  worldSimulationV3Engine?: WorldSimulationEngineV3;
  simulationAgentOrchestratorV3?: SimulationAgentOrchestratorV3;
  flagshipStudentWorkStoreV3?: FlagshipStudentWorkStoreV3;
  flagshipAssessmentStoreV3?: FlagshipAssessmentStoreV3;
  flagshipAssessmentEvaluatorV3?: BlindSemanticAssessmentPortV3;
  flagshipAssessmentStoreV4?: FlagshipAssessmentStoreV4;
  learnerAdaptationStoreV4?: LearnerAdaptationStoreV4;
  secondSessionProvisionerV4?: ProvisionSecondSessionV4;
  learnerAdaptationStoreV3?: LearnerAdaptationStoreV3;
  learnerProxyAgentV3?: LearnerProxyAgentPortV3;
  groundedCollaborationStoreV4?: GroundedCollaborationStoreV4;
  autonomousWorldStoreV4?: AutonomousWorldStoreV4;
  dialogueEpisodeStoreV4?: DialogueEpisodeStoreV4;
  dialogueRuleSelectorV4?: DialogueRuleSelectorV4;
  flagshipMediaRevisionStoreV4?: FlagshipMediaRevisionStoreV4;
  flagshipMediaOutputDirectoryV4?: string;
  sessionExperienceDescriptorStore?: SessionExperienceDescriptorStore;
  businessOperationReceiptStore?: BusinessOperationReceiptStore;
  flagshipV4RuntimeSecrets?: {
    selectionSecret: string;
    groundedDecisionSecret: string;
    groundedWorldAuthoritySecret: string;
    autonomousWorldAuthoritySecret: string;
    dialogueTurnSecret?: string;
  };
}

/**
 * Creates the resumable server-side handoff from an authorized adaptation
 * proposal to a real second world. A partially completed attempt remains in
 * `provisioning` and is safe to resume with the same authorization receipt;
 * only a fully linked world plus both memberships becomes `active`.
 */
export function createDefaultSecondSessionProvisionerV4(dependencies: {
  sessionControl: SessionControlService;
  auth: DemoAuthService;
  worldSimulationV3: WorldSimulationEngineV3;
  businessOperations: BusinessOperationCoordinator;
  registerFieldLesson: (lesson: typeof xunpuExplorationLesson) => Promise<void>;
  freezeExperienceDescriptor: (input: {
    sessionId: string;
    frozenAt: string;
  }) => Promise<SessionExperienceDescriptor>;
}): ProvisionSecondSessionV4 {
  const { sessionControl, auth, worldSimulationV3 } = dependencies;
  return async (input) => {
    const sourceControlSession = await sessionControl.getSession(
      input.sourceSessionId,
    );
    if (!sourceControlSession) {
      throw new LearnerAdaptationErrorV4(
        "source_drift",
        "第一场缺少会话控制记录，拒绝创建无归属的第二场",
      );
    }
    await assertTeacherScope({
      control: sessionControl,
      principalId: input.teacherPrincipalId,
      classroomId: sourceControlSession.classroomId,
      teamId: sourceControlSession.teamId,
    });
    const learnerMemberships = await sessionControl.listMemberships({
      classroomId: sourceControlSession.classroomId,
      roles: ["student"],
      statuses: ["active"],
    });
    const learnerMembership = learnerMemberships.find((membership) => {
      if (membership.actorId !== input.learnerActorId
        || membership.teamId !== sourceControlSession.teamId
        || (membership.sessionId !== null
          && membership.sessionId !== input.sourceSessionId)) return false;
      const assignment = {
        membershipId: membership.membershipId,
        principalId: membership.principalId,
        sessionId: input.sourceSessionId,
        actorId: input.learnerActorId,
        actorKind: "student" as const,
        roleId: "reporter" as const,
        status: "active" as const,
      };
      return stableMembershipBindingId(membership.principalId, assignment)
        === input.learnerBindingId;
    });
    if (!learnerMembership) {
      throw new LearnerAdaptationErrorV4(
        "access_denied",
        "最终评价无法唯一回溯到同一学生成员关系",
      );
    }
    const sessionId = input.challengeAssignment.sessionId;
    const releaseId = input.release.simulationReleaseRef.releaseId;
    const sourceWorld = await worldSimulationV3.getRecord(input.sourceSessionId);
    const sourceLesson=sourceWorld.fieldInterview?worldSimulationV3.getFieldLesson(sourceWorld.fieldInterview.lessonRef.contentHash):null;
    const followupLesson = sourceLesson
      ? deriveAdaptiveFieldLesson(sourceLesson.adaptedFromLessonHash?worldSimulationV3.getFieldLesson(sourceLesson.adaptedFromLessonHash):sourceLesson, input.forecast.selectedVariantRef)
      : null;
    if (followupLesson) await dependencies.registerFieldLesson(followupLesson);
    const learnerSecondMembership: SessionMembership = {
      membershipId: `membership-adaptive-v4-${input.challengeAssignment.challengeAssignmentId}-student`,
      principalId: learnerMembership.principalId,
      classroomId: sourceControlSession.classroomId,
      teamId: sourceControlSession.teamId,
      sessionId,
      role: "student",
      actorId: input.learnerActorId,
      status: "active",
      createdAt: input.requestedAt,
      updatedAt: input.requestedAt,
      revokedAt: null,
    };
    const teacherSecondMembership: SessionMembership = {
      membershipId: `membership-adaptive-v4-${input.challengeAssignment.challengeAssignmentId}-teacher`,
      principalId: input.teacherPrincipalId,
      classroomId: sourceControlSession.classroomId,
      teamId: null,
      sessionId,
      role: "teacher",
      actorId: input.teacherActorId,
      status: "active",
      createdAt: input.requestedAt,
      updatedAt: input.requestedAt,
      revokedAt: null,
    };
    const operationInput = {
      operationKind: "provision_second_session" as const,
      requestId: input.teacherAuthorizationRef,
      requestHash: computeBusinessOperationRequestHash({
        sourceSessionId: input.sourceSessionId,
        learnerBindingId: input.learnerBindingId,
        learnerActorId: input.learnerActorId,
        learnerSubjectHash: input.learnerSubjectHash,
        teacherActorId: input.teacherActorId,
        teacherPrincipalId: input.teacherPrincipalId,
        teacherAuthorizationRef: input.teacherAuthorizationRef,
        release: input.release.simulationReleaseRef,
        challengeAssignment: input.challengeAssignment,
        targetCompetencyRefs: input.targetCompetencyRefs,
        scaffoldingLevel: input.scaffoldingLevel,
        ...(followupLesson ? { fieldLessonHash: followupLesson.contentHash } : {}),
      }),
      scope: {
        sourceSessionId: input.sourceSessionId,
        targetSessionId: sessionId,
        artifactId: null,
      },
      outboxSteps: [
        "start_second_world" as const,
        "freeze_experience_descriptor" as const,
        "create_learner_membership" as const,
        "create_teacher_membership" as const,
        "activate_control_session" as const,
        "materialize_runtime_bindings" as const,
      ],
      requestedAt: input.requestedAt,
    };
    const provisioned = await provisionFlagshipSession({
      operation: operationInput,
      controlRecord: { sessionId, classroomId: sourceControlSession.classroomId, teamId: sourceControlSession.teamId, releaseId,
        status: "provisioning", statusVersion: 0, requestedBy: input.teacherPrincipalId, createdAt: input.requestedAt, updatedAt: input.requestedAt,
        activatedAt: null, completedAt: null, lastRecoveryErrorCode: null, requiresExplicitStudentMembership: true },
      learnerMembership: learnerSecondMembership, teacherMembership: teacherSecondMembership,
      release: input.release, challengeAssignment: input.challengeAssignment, targetCompetencyRefs: input.targetCompetencyRefs,
      scaffoldingLevel: input.scaffoldingLevel, startStep: "start_second_world",
      ...(followupLesson ? { fieldLessonHash: followupLesson.contentHash } : {}),
      ...(sourceWorld.fieldInterview?.contacts?{inheritedContacts:sourceWorld.fieldInterview.contacts}:{}),
    }, { ...dependencies, failure: (code, message) => new LearnerAdaptationErrorV4(code, message) });
    return {
      learnerSubjectHash: input.learnerSubjectHash,
      membershipRef: learnerSecondMembership.membershipId,
      bindingRef: provisioned.learnerBindingId,
      courseReleaseRef: input.release.courseReleaseRef,
      scenarioReleaseRef: input.release.scenarioReleaseRef,
      simulationReleaseRef: input.release.simulationReleaseRef,
      sessionRef: sessionId,
      challengeAssignmentRef: input.challengeAssignment.challengeAssignmentId,
      provisionedAt: input.requestedAt,
    };
  };
}

function configuredAllowedOrigins(environment: NodeJS.ProcessEnv): Set<string> {
  const configured = (environment.WEB_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return new Set([
    ...(environment.NODE_ENV === "production" ? [] : defaultDevelopmentOrigins),
    ...configured,
  ]);
}

function isAllowedOrigin(
  origin: string | undefined,
  environment: NodeJS.ProcessEnv,
  configuredOrigins: Set<string>,
): boolean {
  if (!origin || configuredOrigins.has(origin)) return true;
  if (environment.NODE_ENV === "production") return false;
  try {
    const url = new URL(origin);
    const port = Number(url.port);
    return url.protocol === "http:"
      && (url.hostname === "localhost" || url.hostname === "127.0.0.1")
      && Number.isInteger(port)
      && port >= 1
      && port <= 65_535
      && url.pathname === "/"
      && !url.username
      && !url.password
      && !url.search
      && !url.hash;
  } catch {
    return false;
  }
}

function errorStatus(error: Error): number {
  if (error instanceof AuthenticationRequiredError) return 401;
  if (error instanceof RoleBindingDeniedError) return 403;
  if (error instanceof StateVersionConflictError) return 409;
  if (error instanceof DomainRevisionConflictError) return 409;
  if (error instanceof ScenarioRevisionConflictError) return 409;
  if (error instanceof ScenarioPublishConflictError) return 409;
  if (error instanceof PermissionDeniedError) return 403;
  if (error instanceof DialogueAudienceMismatchError) return 403;
  if (error instanceof DialogueEpisodeNotFoundError) return 404;
  if (
    error instanceof DialogueAlreadyActiveError
    || error instanceof DialogueClosedError
    || error instanceof DialogueDefinitionDriftError
    || error instanceof DialogueEpisodeStoreConflictError
    || error instanceof DialogueIdempotencyConflictError
    || error instanceof DialogueRevisionConflictError
    || error instanceof DialogueWorldStateConflictError
  ) return 409;
  if (error instanceof SimulationSessionNotFoundError) return 404;
  if (error instanceof SimulationRequestReplayError) return 409;
  if (
    error instanceof SimulationTeacherGatePendingError
    || error instanceof SimulationWorldEndedError
    || error instanceof SimulationNoReadyEventError
  ) return 409;
  if (error instanceof InvalidSimulationOperationError) return 400;
  if (error instanceof FlagshipStudentWorkErrorV3) {
    if (error.code === "not_found") return 404;
    if (error.code === "access_denied") return 403;
    if (error.code === "invalid_revision") return 400;
    return 409;
  }
  if (error instanceof FlagshipAssessmentErrorV3) {
    if (error.code === "not_found") return 404;
    if (error.code === "access_denied") return 403;
    if (error.code === "invalid_review") return 400;
    return 409;
  }
  if (error instanceof FlagshipAssessmentErrorV4) {
    if (error.code === "access_denied") return 403;
    if (error.code === "invalid_review") return 400;
    return 409;
  }
  if (error instanceof FieldEvidenceSourceError) return 409;
  if (error instanceof StudyConflictError || error instanceof NotebookConflictError) return 409;
  if (error instanceof TeachingTaskError) return error.code === "not_found" ? 404 : error.code === "access_denied" ? 403 : error.code === "invalid_task" ? 400 : 409;
  if (error instanceof LearnerAdaptationErrorV3) {
    if (error.code === "not_found") return 404;
    if (error.code === "access_denied") return 403;
    if (error.code === "invalid_decision") return 400;
    return 409;
  }
  if (error instanceof LearnerAdaptationErrorV4) {
    if (error.code === "not_ready") return 404;
    if (error.code === "access_denied") return 403;
    if (error.code === "consent_required" || error.code === "appeal_open") return 409;
    return 409;
  }
  if (error instanceof SessionExperienceDescriptorError) {
    if (error.code === "not_found") return 404;
    return 409;
  }
  if (error instanceof BusinessOperationError) {
    if (error.code === "not_found") return 404;
    if (error.code === "recovery_required") return 503;
    return 409;
  }
  if (error instanceof SessionNotFoundError) return 404;
  if (error instanceof ScenarioCatalogNotFoundError) return 404;
  if (error instanceof GoldBlindReviewWorkflowError) {
    if (error.code === "batch_not_found") return 404;
    if (error.code === "reviewer_access_denied") return 403;
    if (["invalid_batch_input", "invalid_review"].includes(error.code)) {
      return 400;
    }
    return 409;
  }
  if (error instanceof GoldPilotStudyError) {
    if (
      error.code === "study_not_found"
      || error.code === "session_not_registered"
      || error.code === "timer_not_found"
    ) return 404;
    if (
      error.code === "invalid_study_input"
      || error.code === "invalid_run_snapshot"
    ) return 400;
    return 409;
  }
  if (error instanceof GoldPilotReadinessError) {
    if (
      error.code === "plan_not_found"
      || error.code === "session_not_registered"
    ) return 404;
    if (error.code === "invalid_plan_input") return 400;
    if (
      error.code === "consent_required"
      || error.code === "consent_withdrawn"
    ) return 403;
    return 409;
  }
  if (error instanceof SessionControlError) {
    if (error.code === "not_found") return 404;
    if ([
      "resource_conflict",
      "idempotency_conflict",
      "status_conflict",
      "invalid_status_transition",
      "checkpoint_tampered",
      "checkpoint_source_conflict",
      "checkpoint_version_unsupported",
    ].includes(error.code)) return 409;
    if (error.code === "checkpoint_io_error") return 503;
    if (error.code === "scope_mismatch" || error.code === "inactive_resource") return 403;
    return 400;
  }
  if (error instanceof TracePaginationCursorError) return error.statusCode;
  if (error instanceof GroundedEvidenceAuthorizationChangedError) return 409;
  if (error instanceof CourseLearningError) {
    if (error.code === "course_not_found") return 404;
    if (error.code === "access_denied") return 403;
    if (error.code === "runtime_unavailable") return 503;
    return 409;
  }
  if (error instanceof ContentLibraryAuthorizationError || error instanceof ContentRetrievalDeniedError) return 403;
  if (error instanceof ContentStoreConflictError) return 409;
  if (error instanceof ContentStoreValidationError) return 400;
  if (error instanceof LocalEmbeddingUnavailableError) return 503;
  if (error instanceof ContentIngestionError) {
    if (error.code === "authorization_denied") return 403;
    return error.retryable ? 503 : 400;
  }
  if (error instanceof AgentAblationIntegrityError) return 409;
  if (error instanceof InvalidWorldActionError || error instanceof z.ZodError) return 400;
  return 500;
}

async function ensureScenarioRoleMemory(
  engine: WorldEngine,
  memory: RoleMemoryService,
  sessionId: string,
): Promise<void> {
  const state = await engine.getStateSnapshot(sessionId);
  const scenario = state.scenario;
  const systemRole = scenario.roles.find((role) => role.agentId === "system");
  if (!systemRole) throw new Error("情境缺少系统角色契约");
  const teacher = scenario.roles.find((role) => role.actorKind === "teacher");
  if (!teacher) throw new Error("情境缺少教师角色契约");
  const timeline = await engine.getTimeline(sessionId, teacher.agentId);
  const sessionStarted = timeline.find((event) => event.eventType === "session_started");
  if (!sessionStarted) throw new Error("情境缺少 session_started 事件");
  const seedSubject = createAccessSubject({
    role: systemRole,
    sessionId,
    sessionEpoch: state.sessionEpoch,
    courseId: scenario.courseId,
    purpose: "runtime",
    capabilities: ["memory.seed"],
  });
  for (const seed of scenario.bootstrap.memorySeeds) {
    const owner = scenario.roles.find((role) => role.agentId === seed.actorId);
    if (!owner) throw new Error(`情境记忆引用未知角色：${seed.actorId}`);
    await memory.append(seedSubject, createRoleMemoryDelta({
      deltaId: `seed:${state.sessionEpoch}:${owner.agentId}:1`,
      idempotencyKey: `seed:${sessionId}:${state.sessionEpoch}:${owner.agentId}:1`,
      sessionId,
      sessionEpoch: state.sessionEpoch,
      sceneId: scenario.scenarioId,
      namespace: roleMemoryNamespace({
        sessionId,
        sessionEpoch: state.sessionEpoch,
        teamId: owner.teamId,
        actorId: owner.agentId,
      }),
      ownerActorId: owner.agentId,
      ownerRoleId: owner.roleId,
      ownerTeamId: owner.teamId,
      authorActorId: systemRole.agentId,
      operation: "remember",
      memoryId: "scenario-seed",
      kind: seed.kind,
      content: seed.content,
      sourceEventIds: [sessionStarted.eventId],
      revision: 1,
      previousDeltaHash: null,
      createdAt: sessionStarted.timestamp,
      auditReadable: owner.memoryPolicy?.auditReadable ?? true,
    }));
  }
}

async function createAppWithLease(
  options: CreateAppOptions,
  dataDir: string,
  dataDirectoryLease: LocalDataDirectoryLease | null,
): Promise<FastifyInstance> {
  const environment = options.environment ?? process.env;
  const allowedOrigins = configuredAllowedOrigins(environment);
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: maximumParsedUploadBytes,
  });
  app.addContentTypeParser(
    "application/octet-stream",
    {
      parseAs: "buffer",
      bodyLimit: maximumParsedUploadBytes,
    },
    (_request, body, done) => {
      done(null, body);
    },
  );
  await app.register(cors, {
    origin: (origin, callback) => {
      callback(null, isAllowedOrigin(origin, environment, allowedOrigins));
    },
    credentials: true,
  });

  const runtimeEnvironment = options.environment
    ?? (options.engine ? {} : process.env);
  const modelIntegration = options.modelIntegration ?? createModelIntegration({
    environment: runtimeEnvironment,
    iflytekHandler: createXingchenModelInvocationHandler({
      environment: runtimeEnvironment,
    }),
  });
  const seedPackage = options.engine?.scenario ?? demoScenario;
  if (!options.engine) {
    await Promise.all([
      assertBundledScenarioMaterialIntegrity(seedPackage),
      assertBundledScenarioMaterialIntegrity(flagshipScenarioV110),
      assertBundledScenarioMaterialIntegrity(flagshipScenarioV111),
      assertBundledScenarioMaterialIntegrity(transferScenarioV100),
      assertBundledScenarioMaterialIntegrity(heritageNightTourScenarioV100),
      assertBundledScenarioMaterialIntegrity(xunpuScenarioV200),
      assertBundledScenarioMaterialIntegrity(xunpuScenarioV201),
      ...migrationRuntimeScenarios.map((scenario) => (
        assertBundledScenarioMaterialIntegrity(scenario)
      )),
    ]);
  }
  const seedRelease = createSeedRelease({
    releaseId: `release-${seedPackage.scenarioId}-${seedPackage.version}-baseline`,
    package: seedPackage,
  });
  if (!options.engine && seedRelease.ref.contentHash !== demoScenarioV100ContentHash) {
    throw new Error(
      "V1.0.0 旗舰情境快照哈希不匹配，拒绝启动以避免当前发布版静默漂移",
    );
  }
  const flagshipExperienceSeedRelease = createSeedRelease({
    releaseId: `release-${flagshipScenarioV110.scenarioId}-${flagshipScenarioV110.version}-baseline`,
    package: flagshipScenarioV110,
  });
  const flagshipGoldSeedRelease = createSeedRelease({
    releaseId: `release-${flagshipScenarioV111.scenarioId}-${flagshipScenarioV111.version}-baseline`,
    package: flagshipScenarioV111,
  });
  const transferSeedRelease = createSeedRelease({
    releaseId: `release-${transferScenarioV100.scenarioId}-${transferScenarioV100.version}-baseline`,
    package: transferScenarioV100,
  });
  const heritageNightTourSeedRelease = createSeedRelease({
    releaseId:
      `release-${heritageNightTourScenarioV100.scenarioId}-${heritageNightTourScenarioV100.version}-baseline`,
    package: heritageNightTourScenarioV100,
  });
  const xunpuSeedRelease = createSeedRelease({
    releaseId: `release-${xunpuScenarioV200.scenarioId}-${xunpuScenarioV200.version}-baseline`,
    package: xunpuScenarioV200,
  });
  const xunpuInteractiveSeedRelease = createSeedRelease({
    releaseId: `release-${xunpuScenarioV201.scenarioId}-${xunpuScenarioV201.version}-baseline`,
    package: xunpuScenarioV201,
  });
  if (
    !options.engine
    && (
      flagshipExperienceSeedRelease.ref.contentHash
      !== flagshipScenarioV110ContentHash
    )
  ) {
    throw new Error(
      "V1.1.0 双维度旗舰情境快照哈希不匹配，拒绝启动以避免黄金路径静默漂移",
    );
  }
  if (
    !options.engine
    && flagshipGoldSeedRelease.ref.contentHash
      !== flagshipScenarioV111ContentHash
  ) {
    throw new Error(
      "V1.1.1 国金旗舰情境快照哈希不匹配，拒绝启动以避免暴雨路线静默漂移",
    );
  }
  if (
    !options.engine
    && transferSeedRelease.ref.contentHash !== transferScenarioV100ContentHash
  ) {
    throw new Error(
      "第二微型迁移情境快照哈希不匹配，拒绝启动以避免迁移样例静默漂移",
    );
  }
  if (
    !options.engine
    && heritageNightTourSeedRelease.ref.contentHash
      !== heritageNightTourScenarioV100ContentHash
  ) {
    throw new Error(
      "非遗夜游迁移情境快照哈希不匹配，拒绝启动以避免正式迁移样例静默漂移",
    );
  }
  if (
    !options.engine
    && xunpuSeedRelease.ref.contentHash !== xunpuScenarioV200ContentHash
  ) {
    throw new Error(
      "V2.0 泉州蟳埔记者单岗情境快照哈希不匹配，拒绝启动以避免课程静默漂移",
    );
  }
  if (
    !options.engine
    && xunpuInteractiveSeedRelease.ref.contentHash
      !== xunpuScenarioV201ContentHash
  ) {
    throw new Error(
      "V2.0.1 泉州蟳埔交互情境快照哈希不匹配，拒绝启动以避免黄金链静默漂移",
    );
  }
  const legacySeedRelease = createSeedRelease({
    releaseId: `release-${legacyDemoScenarioV041.scenarioId}-${legacyDemoScenarioV041.version}-baseline`,
    package: legacyDemoScenarioV041,
  });
  const directorSeedRelease = createSeedRelease({
    releaseId: `release-${legacyDemoScenarioV051.scenarioId}-${legacyDemoScenarioV051.version}-baseline`,
    package: legacyDemoScenarioV051,
  });
  const productionSeedRelease = createSeedRelease({
    releaseId: `release-${legacyDemoScenarioV060.scenarioId}-${legacyDemoScenarioV060.version}-baseline`,
    package: legacyDemoScenarioV060,
  });
  const productionEvaluationSeedRelease = createSeedRelease({
    releaseId: `release-${legacyDemoScenarioV061.scenarioId}-${legacyDemoScenarioV061.version}-baseline`,
    package: legacyDemoScenarioV061,
  });
  const evaluationSeedRelease = createSeedRelease({
    releaseId: `release-${legacyDemoScenarioV070.scenarioId}-${legacyDemoScenarioV070.version}-baseline`,
    package: legacyDemoScenarioV070,
  });
  const scenarioCatalog = options.scenarioCatalog ?? new ScenarioCatalog(
    options.engine
      ? new InMemoryScenarioCatalogStore()
      : new JsonlScenarioCatalogStore(resolve(dataDir, "scenario-catalog.jsonl")),
  );
  const initialSeedReleases = [
    legacySeedRelease,
    directorSeedRelease,
    productionSeedRelease,
    productionEvaluationSeedRelease,
    evaluationSeedRelease,
    seedRelease,
    flagshipExperienceSeedRelease,
    ...((options.initializeGoldScenarioRelease ?? !options.engine)
      ? [flagshipGoldSeedRelease]
      : []),
    transferSeedRelease,
    heritageNightTourSeedRelease,
    xunpuSeedRelease,
    xunpuInteractiveSeedRelease,
    ...migrationRuntimeSeedReleases,
  ].filter((release, index, releases) => (
    releases.findIndex((candidate) => (
      candidate.ref.releaseId === release.ref.releaseId
    )) === index
  ));
  await scenarioCatalog.initialize(initialSeedReleases);
  if (!options.engine) {
    if (legacySeedRelease.ref.contentHash !== demoScenarioV041LegacyContentHash) {
      throw new Error("V0.4.1 遗留情境快照哈希不匹配，拒绝启动以避免旧会话静默漂移");
    }
    const legacyRelease = scenarioCatalog.list().releases.find((release) => (
      release.ref.scenarioId === legacyDemoScenarioV041.scenarioId
      && release.ref.version === legacyDemoScenarioV041.version
      && release.ref.contentHash === demoScenarioV041LegacyContentHash
    ));
    if (!legacyRelease) {
      throw new Error("V0.4.1 遗留情境快照未登记，拒绝恢复旧会话");
    }
    scenarioCatalog.registerLegacySessionRelease(legacyRelease.ref);
    if (directorSeedRelease.ref.contentHash !== demoScenarioV051ContentHash) {
      throw new Error("V0.5.1 遗留情境快照哈希不匹配，拒绝启动以避免旧会话静默漂移");
    }
    const directorRelease = scenarioCatalog.list().releases.find((release) => (
      release.ref.scenarioId === legacyDemoScenarioV051.scenarioId
      && release.ref.version === legacyDemoScenarioV051.version
      && release.ref.contentHash === demoScenarioV051ContentHash
    ));
    if (!directorRelease) {
      throw new Error("V0.5.1 遗留情境快照未登记，拒绝恢复旧会话");
    }
    scenarioCatalog.registerLegacySessionRelease(directorRelease.ref);
    if (
      productionSeedRelease.ref.contentHash
      !== demoScenarioV060ContentHash
    ) {
      throw new Error(
        "V0.6.0 遗留情境快照哈希不匹配，拒绝启动以避免旧会话静默漂移",
      );
    }
    const productionRelease = scenarioCatalog.list().releases.find(
      (release) => (
        release.ref.scenarioId === legacyDemoScenarioV060.scenarioId
        && release.ref.version === legacyDemoScenarioV060.version
        && release.ref.contentHash === demoScenarioV060ContentHash
      ),
    );
    if (!productionRelease) {
      throw new Error("V0.6.0 遗留情境快照未登记，拒绝恢复旧会话");
    }
    scenarioCatalog.registerLegacySessionRelease(productionRelease.ref);
    if (
      productionEvaluationSeedRelease.ref.contentHash
      !== demoScenarioV061ContentHash
    ) {
      throw new Error(
        "V0.6.1 遗留情境快照哈希不匹配，拒绝启动以避免旧会话静默漂移",
      );
    }
    const productionEvaluationRelease = scenarioCatalog.list().releases.find(
      (release) => (
        release.ref.scenarioId === legacyDemoScenarioV061.scenarioId
        && release.ref.version === legacyDemoScenarioV061.version
        && release.ref.contentHash === demoScenarioV061ContentHash
      ),
    );
    if (!productionEvaluationRelease) {
      throw new Error("V0.6.1 遗留情境快照未登记，拒绝恢复旧会话");
    }
    scenarioCatalog.registerLegacySessionRelease(
      productionEvaluationRelease.ref,
    );
    if (
      evaluationSeedRelease.ref.contentHash
      !== demoScenarioV070ContentHash
    ) {
      throw new Error(
        "V0.7.0 遗留情境快照哈希不匹配，拒绝启动以避免旧会话静默漂移",
      );
    }
    const evaluationRelease = scenarioCatalog.list().releases.find(
      (release) => (
        release.ref.scenarioId === legacyDemoScenarioV070.scenarioId
        && release.ref.version === legacyDemoScenarioV070.version
        && release.ref.contentHash === demoScenarioV070ContentHash
      ),
    );
    if (!evaluationRelease) {
      throw new Error("V0.7.0 遗留情境快照未登记，拒绝恢复旧会话");
    }
    scenarioCatalog.registerLegacySessionRelease(evaluationRelease.ref);
  }
  const engine = options.engine ?? new WorldEngine({
    store: new JsonlEventStore(dataDir),
    scenarioResolver: scenarioCatalog,
    defaultRelease: seedRelease,
  });
  for (const release of scenarioCatalog.list().releases) engine.registerScenarioRelease(release);
  const objectStore = options.objectStore
    ?? (
      options.engine
        ? new InMemoryContentAddressedObjectStore()
        : new LocalContentAddressedObjectStore(resolve(dataDir, "objects"))
    );
  const adapter = options.adapter ?? new UnifiedIflytekAdapter({
    environment: runtimeEnvironment,
    handlers: createIflytekLiveHandlers({
      environment: runtimeEnvironment,
      resolveSourceText: async (input) => {
        const inline = input.metadata.sourceText;
        if (typeof inline === "string") return inline;
        if (
          input.mediaType !== "text"
          || !input.sourceRef.startsWith("object://")
          || !objectStore.get
        ) return "";
        const bytes = await objectStore.get(input.sourceRef);
        try {
          return new TextDecoder(
            "utf-8",
            { fatal: true },
          ).decode(bytes);
        } catch {
          throw new Error("固定文本材料不是有效 UTF-8");
        }
      },
    }),
  });
  const auth = options.authService ?? new DemoAuthService();
  const collaborationStrategyStore =
    options.collaborationStrategyStore
    ?? (
      dataDirectoryLease === null
        ? new InMemoryCollaborationStrategyStore()
        : new JsonlCollaborationStrategyStore(
            resolve(dataDir, "collaboration-strategies.jsonl"),
          )
    );
  const collaborationStrategy = new CollaborationStrategyService(
    collaborationStrategyStore,
  );
  const strategyReuse = new StrategyReuseService(
    collaborationStrategy,
  );
  const strategyReuseReference = CollaborationStrategyReferenceSchema.parse(
    options.strategyReuseReference ?? {
      strategyId: "strategy-rain-collaboration",
      version: 1,
      contentHash: "0".repeat(64),
    },
  );
  const sessionControl = new SessionControlService(
    options.sessionControlStore
      ?? (
        options.engine
          ? new InMemorySessionControlStore()
          : new JsonlSessionControlStore(resolve(dataDir, "session-control.jsonl"))
      ),
  );
  await seedDemoOrganization(sessionControl);
  const trainingSessionCourseReleaseRefs = new Map<
    string,
    CourseReleaseReference | null
  >();
  const sessionExperienceTitles = new Map<string, string>();
  let sessionExperienceDescriptors: SessionExperienceDescriptorService | null = null;
  const xunpuPublishedCourseRelease = publishInteractiveXunpuContractCourseRelease(
    xunpuInteractiveSeedRelease.ref,
  );
  const xunpuPublishedCourseReleaseRef = CourseReleaseReferenceSchema.parse({
    courseId: xunpuPublishedCourseRelease.courseId,
    releaseId: xunpuPublishedCourseRelease.releaseId,
    version: xunpuPublishedCourseRelease.version,
    contentHash: xunpuPublishedCourseRelease.contentHash,
  });
  const migrationSessionIdsByCourseId = new Map<string, string>([
    ["course-village-super-multiplatform", DEMO_VILLAGE_SUPER_SESSION_ID],
    ["course-village-super-postpublication-context", DEMO_VILLAGE_POSTPUBLICATION_SESSION_ID],
    ["course-ai-tourism-copyright-governance", DEMO_AI_COPYRIGHT_SESSION_ID],
    ["course-scenic-rain-emergency-reporting", DEMO_RAIN_EMERGENCY_SESSION_ID],
  ]);
  const migrationDemoDefinitions = migrationRuntimeCourseReleases.map((release) => {
    const sessionId = migrationSessionIdsByCourseId.get(release.courseId);
    const scenarioRelease = migrationRuntimeSeedReleases.find((candidate) => (
      candidate.ref.scenarioId === release.scenarioReleaseRef.scenarioId
      && candidate.ref.version === release.scenarioReleaseRef.version
      && candidate.ref.contentHash === release.scenarioReleaseRef.contentHash
    ));
    if (!sessionId || !scenarioRelease) {
      throw new Error(`迁移课程缺少精确演示会话或情境发布版：${release.courseId}`);
    }
    return {
      sessionId,
      scenarioRelease,
      courseReleaseRef: courseReleaseReferenceOf(release),
    };
  });
  const activeCourseReleases = options.courseReleases ?? [
    xunpuPublishedCourseRelease,
    ...migrationRuntimeCourseReleases,
  ];
  const isFlagshipCourseRuntime = async (sessionId: string) => (
    (await sessionExperienceDescriptors?.get(sessionId))?.experienceGeneration === "flagship_v4"
  );
  const readFlagshipCourseOutcome: CourseOutcomeProjectionReader["read"] = async (input) => {
    const [world, work, assessment, media] = await Promise.all([
      worldSimulationV3.getRecord(input.sessionId),
      flagshipStudentWorkV3.loadRecord(input.sessionId),
      flagshipAssessmentV4.loadCurrentAssessment({ sessionId: input.sessionId, fallbackLearner: { bindingId: input.enrollment.bindingId, actorId: input.actorId } }),
      flagshipMediaV4.getWorkspace({ sessionId: input.sessionId, bindingId: input.enrollment.bindingId, artifactRef: "artifact-multiplatform-package" }),
    ]);
    const publicAssessment = flagshipAssessmentV4.projectView(assessment, "student");
    const decision = publicAssessment.decision;
    const review = decision?.status === "final" && decision.sessionScore !== null && decision.teacherReview.reviewedAt ? {
      reviewId: decision.assessmentDecisionId,
      finalScore: decision.sessionScore,
      dimensions: publicAssessment.criteria.map((criterion) => ({
        dimensionId: criterion.criterionId,
        label: criterion.title,
        score: criterion.score!,
        maxScore: 100,
        feedback: `${criterion.rationale}\n原评价引用：${decision.criterionAssessments.find((item) => item.criterionId === criterion.criterionId)!.evidenceRefs.join("、")}`.slice(0, 1_200),
        evidenceRefs: [`assessment-evidence:${decision.assessmentDecisionId}:${criterion.criterionId}`],
      })),
      publicSummary: decision.teacherReview.rationale!,
      finalizedAt: decision.teacherReview.reviewedAt,
    } : null;
    return projectFlagshipCourseOutcome({
      principalId: input.principalId, actorId: input.actorId, bindingId: input.enrollment.bindingId, sessionId: input.sessionId, release: input.release,
      definition: xunpuFlagshipCourseProjection, manifest: xunpuFlagshipContentManifestV3,
      world: collectFlagshipWorldOutcomeSource(world, input.actorId, xunpuFlagshipCourseProjection, fieldLessonCatalog), work, media, review,
    });
  };
  const courseLearning = new CourseLearningService({
    releases: activeCourseReleases,
    launches: options.courseLaunches ?? [],
    enrollmentStore: options.courseEnrollmentStore
      ?? (
        options.engine
          ? new InMemoryCourseEnrollmentStore()
          : new JsonlCourseEnrollmentStore(
              resolve(dataDir, "course-enrollments.jsonl"),
            )
      ),
    projectionReader: options.learningActivityProjectionReader ?? {
      read: async (input) => {
        const { sessionId, actorId } = input;
        if (await isFlagshipCourseRuntime(sessionId)) {
          const outcome = await readFlagshipCourseOutcome(input);
          const chapterId = outcome.currentChapterId ?? input.release.chapters.at(-1)!.chapterId;
          const scenario = await engine.getScenarioPackage(sessionId);
          const scene = scenario.experienceDesign?.scenes.find((candidate) => candidate.nodeIds.includes(chapterId));
          if (!scene) throw new CourseLearningError("version_hash_drift", "当前课程章节缺少发布场景映射");
          return {
            stateVersion: outcome.stateVersion,
            sceneId: scene.sceneId,
            chapterId,
            sourceEventId: null,
          };
        }
        const projection = await engine.getProjection(sessionId, actorId);
        return {
          stateVersion: projection.stateVersion,
          sceneId: projection.structuredWorld?.scene.sceneId
            ?? projection.currentNode.nodeId,
          chapterId: projection.currentNode.nodeId,
          sourceEventId: projection.currentTaskAnchor.sourceEventId,
        };
      },
    },
    outcomeProjectionReader: options.courseOutcomeProjectionReader ?? {
      isAuthoritative: ({ sessionId }) => isFlagshipCourseRuntime(sessionId),
      read: async (input) => {
        const { sessionId, actorId, release } = input;
        if (await isFlagshipCourseRuntime(sessionId)) return readFlagshipCourseOutcome(input);
        const projection = await engine.getProjection(sessionId, actorId);
        const chapterById = new Map(
          release.chapters.map((chapter) => [chapter.chapterId, chapter]),
        );
        const completedChapterIds = release.chapters
          .filter((chapter) => projection.nodes.some((node) => (
            node.nodeId === chapter.chapterId && node.status === "completed"
          )))
          .map((chapter) => chapter.chapterId);
        const allCompleted = completedChapterIds.length
          === release.chapters.length;
        const currentChapterId = allCompleted
          ? null
          : chapterById.has(projection.currentNode.nodeId)
            ? projection.currentNode.nodeId
            : null;
        const artifactItems = projection.productionArtifacts.flatMap((artifact) => {
          if (artifact.ownerActorId !== actorId) return [];
          const revision = projection.artifactRevisions.find((candidate) => (
            candidate.revisionId === artifact.latestRevisionId
            && candidate.artifactId === artifact.artifactId
          ));
          if (!revision) return [];
          const relatedEvidence = projection.evidence.filter((evidence) => (
            evidence.artifactRevisionRefs.includes(revision.revisionId)
          ));
          const chapter = relatedEvidence
            .map((evidence) => chapterById.get(evidence.nodeId))
            .find((candidate) => candidate !== undefined);
          if (!chapter) return [];
          return [{
            artifactId: artifact.artifactId,
            revisionId: revision.revisionId,
            chapterId: chapter.chapterId,
            deliverableIds: [...chapter.deliverableIds],
            origin: "student_artifact" as const,
            title: artifact.title,
            kind: artifact.kind,
            status: artifact.status,
            revisionNumber: revision.revisionNumber,
            summary: revision.summary,
            contentHash: revision.contentHash,
            evidenceIds: relatedEvidence.map((evidence) => evidence.evidenceId),
            updatedAt: artifact.updatedAt,
          }];
        });
        const taskOutcomeItems = completedChapterIds.flatMap((chapterId) => {
          const chapter = chapterById.get(chapterId);
          if (!chapter) return [];
          const relatedEvidence = projection.evidence.filter((evidence) => (
            evidence.actorId === actorId && evidence.nodeId === chapterId
          ));
          if (relatedEvidence.length === 0) return [];
          const evidenceIds = relatedEvidence
            .map((evidence) => evidence.evidenceId)
            .sort();
          const contentHash = createHash("sha256")
            .update(JSON.stringify({
              chapterId,
              courseContentHash: release.contentHash,
              evidenceIds,
            }))
            .digest("hex");
          return [{
            artifactId: `task-outcome:${chapterId}`,
            revisionId: `task-outcome-revision:${chapterId}:${contentHash.slice(0, 16)}`,
            chapterId,
            deliverableIds: [...chapter.deliverableIds],
            origin: "server_process_record" as const,
            title: `过程记录｜${chapter.title}`,
            kind: "task_outcome" as const,
            status: "submitted" as const,
            revisionNumber: 1,
            summary: `已完成${chapter.title}，服务端冻结了 ${relatedEvidence.length} 条可复核过程证据。`,
            contentHash,
            evidenceIds,
            updatedAt: relatedEvidence
              .map((evidence) => evidence.createdAt)
              .sort()
              .at(-1) ?? projection.scenario.virtualTime,
          }];
        });
        const taskRevisionIdsByChapter = new Map(
          taskOutcomeItems.map((item) => [
            item.artifactId.slice("task-outcome:".length),
            item.revisionId,
          ]),
        );
        const visibleRevisionIds = new Set([
          ...artifactItems.map((item) => item.revisionId),
          ...taskOutcomeItems.map((item) => item.revisionId),
        ]);
        const visibleEvidenceIds = new Set(
          [...artifactItems, ...taskOutcomeItems].flatMap((item) => (
            item.evidenceIds
          )),
        );
        const evidence = projection.evidence
          .filter((candidate) => (
            chapterById.has(candidate.nodeId)
            && visibleEvidenceIds.has(candidate.evidenceId)
          ))
          .map((candidate) => ({
            evidenceId: candidate.evidenceId,
            title: `${chapterById.get(candidate.nodeId)?.title ?? "课程"}过程证据`,
            basis: `服务端已记录“${chapterById.get(candidate.nodeId)?.title ?? "课程"}”的任务过程与权威状态变化。`,
            artifactRevisionRefs: [
              ...new Set([
                ...candidate.artifactRevisionRefs.filter((ref) => (
                  visibleRevisionIds.has(ref)
                )),
                ...(taskRevisionIdsByChapter.has(candidate.nodeId)
                  ? [taskRevisionIdsByChapter.get(candidate.nodeId)!]
                  : []),
              ]),
            ],
            createdAt: candidate.createdAt,
          }));
        return {
          stateVersion: projection.stateVersion,
          scenarioStatus: projection.scenario.status,
          currentChapterId,
          completedChapterIds,
          submittedDeliverableIds: [
            ...new Set([...artifactItems, ...taskOutcomeItems].flatMap((item) => (
              item.deliverableIds
            ))),
          ],
          portfolioItems: [...artifactItems, ...taskOutcomeItems],
          evidence,
          review: projection.assessmentFeedback
            ? {
                reviewId: projection.assessmentFeedback.evaluationCaseId,
                finalScore: projection.assessmentFeedback.finalScore,
                dimensions: structuredClone(
                  projection.assessmentFeedback.dimensions,
                ),
                publicSummary: projection.assessmentFeedback.publicSummary,
                finalizedAt: projection.assessmentFeedback.finalizedAt,
              }
            : null,
        };
      },
    },
  });
  const agentTopology = buildAgentTopologyManifest();
  const crossCourseAgentRuleManifest = buildCrossCourseAgentRuleManifest({
    topology: agentTopology,
    courseReleases: activeCourseReleases,
    publishedScenarioRefs: initialSeedReleases.map((release) => release.ref),
  });
  const agentAblationEvidence = buildInsufficientAgentAblationEvidence({
    manifest: crossCourseAgentRuleManifest,
  });
  const collaborationEpisode = new AgentCollaborationEpisodeService(
    agentTopology,
    crossCourseAgentRuleManifest,
  );
  const flagshipWorldReleaseV3 = buildXunpuFlagshipRuntimeReleaseV3R2(
    xunpuPublishedCourseReleaseRef,
  );
  const legacyFlagshipWorldReleaseV3 = buildXunpuFlagshipRuntimeReleaseV3R2(xunpuPublishedCourseReleaseRef, "runtime.3");
  const knownFlagshipRelease = (ref: typeof flagshipWorldReleaseV3.simulationReleaseRef) => (
    [flagshipWorldReleaseV3, legacyFlagshipWorldReleaseV3].some((candidate) => (
      candidate.simulationReleaseRef.releaseId === ref.releaseId
      && candidate.simulationReleaseRef.version === ref.version
      && candidate.simulationReleaseRef.contentHash === ref.contentHash
    ))
  );
  // Keep the complete V3 causal chain on one runtime generation. Runtime 1
  // contained a pre-AI-014 fixed challenge assignment, runtime 2 predates
  // action-quality outcomes and runtime 3 predates the student's authoritative
  // commercial-counteroffer event. Runtime 4 preserves all older histories.
  const flagshipV3RuntimeDataVersion = "r2-runtime-4";
  const fieldLessonCatalog = dataDirectoryLease === null ? [xunpuExplorationLesson]
    : await loadFieldLessonCatalog(resolve(dataDir, "field-lesson-releases"), xunpuExplorationLesson);
  const worldSimulationV3 = options.worldSimulationV3Engine
    ?? new WorldSimulationEngineV3({
      fieldLessons: fieldLessonCatalog,
      store: dataDirectoryLease === null
        ? new InMemorySimulationSessionStore()
        : new JsonFileSimulationSessionStore(
            resolve(
              dataDir,
              `world-simulation-v3-${flagshipV3RuntimeDataVersion}`,
            ),
          ),
    });
  const flagshipAgentTemplatesV3 = buildXunpuSimulationAgentTemplatesV3R2();
  const registerFieldLesson = async (lesson: typeof xunpuExplorationLesson) => {
    if (dataDirectoryLease !== null) await loadFieldLessonCatalog(resolve(dataDir, "field-lesson-releases"), lesson);
    worldSimulationV3.registerFieldLesson(lesson);
    if (!fieldLessonCatalog.some(item => item.contentHash === lesson.contentHash)) fieldLessonCatalog.push(lesson);
  };
  for (const { lesson } of courseFieldLessonsV3) await registerFieldLesson(lesson);
  const simulationAgentOrchestratorV3 = options.simulationAgentOrchestratorV3
    ?? new SimulationAgentOrchestratorV3({
      engine: worldSimulationV3,
      store: dataDirectoryLease === null
        ? new InMemorySimulationCollaborationStoreV3()
        : new JsonFileSimulationCollaborationStoreV3(
            resolve(
              dataDir,
              `agent-collaboration-v3-${flagshipV3RuntimeDataVersion}`,
            ),
          ),
      templates: flagshipAgentTemplatesV3,
      executors: createXunpuDeterministicSimulationExecutorsV3R2(
        flagshipAgentTemplatesV3,
      ),
      buildTaskInstruction: buildXunpuSimulationTaskInstructionV3,
      maxSelectedAgents: 5,
    });
  const businessOperations = new BusinessOperationCoordinator(
    options.businessOperationReceiptStore
      ?? (dataDirectoryLease === null
        ? new InMemoryBusinessOperationReceiptStore()
        : new JsonlBusinessOperationReceiptStore(
            resolve(dataDir, "business-operation-receipts.jsonl"),
          )),
  );
  let refreshAssessmentProjectionV4: (input: {
    sessionId: string;
    artifactId: string;
    revisionId: string;
  }) => Promise<string> = async () => {
    throw new BusinessOperationError(
      "definition_drift",
      "V4 评价投影处理器尚未完成组合根装配",
    );
  };
  let refreshLearnerAdaptationV4: (input: {
    sessionId: string;
    assessmentDecisionId: string;
  }) => Promise<string> = async () => {
    throw new BusinessOperationError(
      "definition_drift",
      "V4 学习者投影处理器尚未完成组合根装配",
    );
  };
  const studentNotebooks = new StudentNotebookStore(dataDirectoryLease === null ? {} : { directory: resolve(dataDir, "student-notebooks-v1") });
  const flagshipStudentWorkV3 = new FlagshipStudentWorkServiceV3({
    store: options.flagshipStudentWorkStoreV3
      ?? (dataDirectoryLease === null
        ? new InMemoryFlagshipStudentWorkStoreV3()
        : new JsonFileFlagshipStudentWorkStoreV3(
            resolve(
              dataDir,
              `flagship-student-work-v3-${flagshipV3RuntimeDataVersion}`,
            ),
          )),
    manifest: xunpuFlagshipContentManifestV3,
    resolveManifest: async sessionId => {
      const world = await worldSimulationV3.getRecord(sessionId);
      const lesson = fieldLessonCatalog.find(lesson => lesson.contentHash === world.fieldInterview?.lessonRef.contentHash);
      if (lesson?.workPlan && lesson.workPlan.courseId !== world.release.courseReleaseRef.courseId) throw new TeachingTaskError("source_drift","成果计划不属于本场课程");
      return lesson?.workPlan ?? xunpuFlagshipContentManifestV3;
    },
    selectedNotes: async ({ sessionId, principalId, noteIds, notebookRevision }) => studentNotebooks.selectedCopies(principalId,
      (await worldSimulationV3.getRecord(sessionId)).release.courseReleaseRef.courseId, noteIds, notebookRevision),
    businessOperations,
    afterSubmissionCommitted: (input) => refreshAssessmentProjectionV4(input),
  });
  const flagshipAssessmentV3 = new FlagshipCompetencyAssessmentServiceV3({
    engine: worldSimulationV3,
    orchestrator: simulationAgentOrchestratorV3,
    work: flagshipStudentWorkV3,
    manifest: xunpuFlagshipContentManifestV3,
    store: options.flagshipAssessmentStoreV3
      ?? (dataDirectoryLease === null
        ? new InMemoryFlagshipAssessmentStoreV3()
        : new JsonFileFlagshipAssessmentStoreV3(
            resolve(
              dataDir,
              `flagship-assessment-v3-${flagshipV3RuntimeDataVersion}`,
            ),
          )),
    ...(options.flagshipAssessmentEvaluatorV3
      ? { evaluator: options.flagshipAssessmentEvaluatorV3 }
      : {}),
  });
  const learnerAdaptationV3 = new LearnerAdaptationServiceV3({
    assessment: flagshipAssessmentV3,
    engine: worldSimulationV3,
    orchestrator: simulationAgentOrchestratorV3,
    store: options.learnerAdaptationStoreV3
      ?? (dataDirectoryLease === null
        ? new InMemoryLearnerAdaptationStoreV3()
        : new JsonFileLearnerAdaptationStoreV3(
            resolve(
              dataDir,
              `learner-adaptation-v3-${flagshipV3RuntimeDataVersion}`,
            ),
          )),
    ...(options.learnerProxyAgentV3
      ? { proxy: options.learnerProxyAgentV3 }
      : {}),
  });
  const xunpuWorldDirectorV3 = new XunpuWorldDirectorV3(worldSimulationV3);
  const flagshipV4RuntimeSecrets = options.flagshipV4RuntimeSecrets ?? {
    selectionSecret: randomBytes(32).toString("hex"),
    groundedDecisionSecret: randomBytes(32).toString("hex"),
    groundedWorldAuthoritySecret: randomBytes(32).toString("hex"),
    autonomousWorldAuthoritySecret: randomBytes(32).toString("hex"),
    dialogueTurnSecret: randomBytes(32).toString("hex"),
  };
  const flagshipGatewayModelsV4 = modelIntegration.health().mode === "live"
    ? createFlagshipGatewayModelsV4({
        provider: modelIntegration.provider,
        ...(modelIntegration.visionProvider
          ? { visionProvider: modelIntegration.visionProvider }
          : {}),
      })
    : null;
  const autonomousWorldV4 = new XunpuAutonomousWorldDirectorV4({
    store: options.autonomousWorldStoreV4
      ?? (dataDirectoryLease === null
        ? new InMemoryAutonomousWorldStoreV4()
        : new JsonFileAutonomousWorldStoreV4(
            resolve(
              dataDir,
              `autonomous-world-v4-${flagshipV3RuntimeDataVersion}`,
            ),
          )),
    content: xunpuFlagshipContentV4,
    authoritySecret: flagshipV4RuntimeSecrets.autonomousWorldAuthoritySecret,
    ...(flagshipGatewayModelsV4
      ? { npcDecisionModel: flagshipGatewayModelsV4.npcDecisionModel }
      : {}),
  });
  const contentLibraryRuntime = new ContentLibraryRuntime({
    ...(dataDirectoryLease === null ? {} : { dataDir: resolve(dataDir, "content-library") }),
    objectStore,
    environment,
    assertCourse: (courseId) => { courseLearning.getCourse(courseId); },
    ...(options.contentProcessor ? { processor: options.contentProcessor } : {}),
    ...(options.contentEmbeddings ? { embeddings: options.contentEmbeddings } : {}),
  });
  app.addHook("onClose", () => contentLibraryRuntime.close());
  // A fresh workspace cannot contain previously published tasks. Keep SQL lazy
  // until a real content request; an existing database is always recovered.
  const recoverTeachingTasks = dataDirectoryLease !== null && contentLibraryRuntime.hasPersistedStore();
  const groundedEvidencePorts = new SqlGroundedEvidencePorts({
    runtime: contentLibraryRuntime,
    content: buildXunpuGroundedCollaborationRuntimeContentV4({ content: xunpuFlagshipContentV4,
      baseKnowledge: xunpuCourseRelease.knowledgeRecords, addedKnowledge: xunpuFlagshipContentV4.addedKnowledgeRecords }),
    loadCourseReference: async (sessionId) => (await worldSimulationV3.getRecord(sessionId)).release.courseReleaseRef,
  });
  const fieldModelCallLimit = Number(environment.FIELD_DIALOGUE_MAX_MODEL_CALLS ?? "100");
  const fieldModelBudgetMicros = Number(environment.FIELD_DIALOGUE_BUDGET_MICROUSD ?? "1000000");
  if (!Number.isInteger(fieldModelCallLimit) || fieldModelCallLimit < 1 || fieldModelCallLimit > 1000
    || !Number.isInteger(fieldModelBudgetMicros) || fieldModelBudgetMicros < 0 || fieldModelBudgetMicros > 5_000_000) {
    throw new Error("现场模型调用上限或预算配置无效");
  }
  const flagshipExperienceV4 = new FlagshipExperienceServiceV4({
    ...(!options.worldSimulationV3Engine ? { fieldInterview: new FieldInterviewService({
      engine: worldSimulationV3, lesson: xunpuExplorationLesson, courseId: xunpuPublishedCourseReleaseRef.courseId,
      maximumModelCalls: fieldModelCallLimit, modelBudgetMicros: fieldModelBudgetMicros,
      ...(dataDirectoryLease !== null ? { attemptStore: new JsonFileFieldModelAttemptStore(resolve(dataDir, "field-model-attempts-v1")) } : {}),
      characterProfiles: xunpuFlagshipContentV4.cast,
      publishedLessons: fieldLessonCatalog,
      ...(flagshipGatewayModelsV4 ? { model: flagshipGatewayModelsV4.fieldInterviewModel } : {}),
      readProactiveCue: async (sessionId, npcId) => {
        let record: Awaited<ReturnType<typeof autonomousWorldV4.getRecord>>;
        try { record = await autonomousWorldV4.getRecord(sessionId); }
        catch (error) { if (error instanceof AutonomousWorldRecordNotFoundError) return null; throw error; }
        const window = record.responseWindows.find(window => window.status === "open" && window.actorEntityRef === npcId);
        if (!window) return null;
        const decision = record.decisions.find(decision => decision.status === "scheduled" && decision.candidateEvent.candidateEventId === window.candidateEventId);
        return decision?.status === "scheduled" ? decision.candidateEvent.publicCue : null;
      },
      retrieveEvidence: async ({ principalId, query, knowledgeIds }) => {
        const enrollment = await courseLearning.findEnrollment(principalId, xunpuPublishedCourseReleaseRef.courseId);
        if (!enrollment) return [];
        const store = await contentLibraryRuntime.store();
        const knowledge = await Promise.all(knowledgeIds.map(id => store.getKnowledge(id)));
        const revisionIds = [...new Set(knowledge.flatMap(record => record?.sourceRevisionId ? [record.sourceRevisionId] : []))];
        const fragments = (await Promise.all(revisionIds.map(id => store.listSourceFragments(id)))).flat();
        if (!fragments.length) return [];
        const result = await contentLibraryRuntime.retrieve({ principalId, role: "student", enrolledCourseIds: new Set([enrollment.enrollment.courseReleaseRef.courseId]) }, {
          courseId: xunpuPublishedCourseReleaseRef.courseId, query, subjectRef: principalId, purpose: "model_context", limit: 6,
          allowedFragmentIds: new Set(fragments.map(fragment => fragment.fragmentId)),
        });
        return result.citations.map(citation => ({ citationId: citation.citationId, title: citation.title,
          locator: JSON.stringify(citation.locator), text: citation.text.slice(0, 1_200), sourceRevisionId: citation.sourceRevisionId,
          fragmentId: citation.fragmentId, sourceByteHash: citation.sourceByteHash }));
      },
    }) } : {}),
    engine: worldSimulationV3,
    orchestrator: simulationAgentOrchestratorV3,
    groundedAuthorizationResolver: groundedEvidencePorts,
    groundedRetrieval: groundedEvidencePorts,
    groundedStore: options.groundedCollaborationStoreV4
      ?? (dataDirectoryLease === null
        ? new InMemoryGroundedCollaborationStoreV4()
        : new JsonFileGroundedCollaborationStoreV4(
            resolve(
              dataDir,
              `grounded-collaboration-v4-${flagshipV3RuntimeDataVersion}`,
            ),
          )),
    dialogueStore: options.dialogueEpisodeStoreV4
      ?? (dataDirectoryLease === null
        ? new InMemoryDialogueEpisodeStoreV4()
        : new JsonFileDialogueEpisodeStoreV4(
            resolve(
              dataDir,
              `dialogue-episodes-v4-${flagshipV3RuntimeDataVersion}`,
            ),
          )),
    flagshipContentRef: flagshipContentReferenceV4Of(flagshipWorldReleaseV3),
    autonomousDirector: autonomousWorldV4,
    advanceWorld: (sessionId) => xunpuWorldDirectorV3.advance(sessionId),
    ...(flagshipGatewayModelsV4
      ? {
          semanticModel: flagshipGatewayModelsV4.semanticModel,
          groundedModel: flagshipGatewayModelsV4.groundedModel,
        }
      : {}),
    ...(options.dialogueRuleSelectorV4
      ? { dialogueSelector: options.dialogueRuleSelectorV4 }
      : flagshipGatewayModelsV4
        ? { dialogueSelector: flagshipGatewayModelsV4.dialogueSelector }
        : {}),
    ...flagshipV4RuntimeSecrets,
  });
  const flagshipMediaOutputDirectoryV4 = options.flagshipMediaOutputDirectoryV4
    ?? resolve(dataDir, `flagship-media-v4-${flagshipV3RuntimeDataVersion}`);
  const flagshipMediaV4 = new FlagshipMediaServiceV4({
    store: options.flagshipMediaRevisionStoreV4
      ?? (dataDirectoryLease === null
        ? new InMemoryFlagshipMediaRevisionStoreV4()
        : new JsonFileFlagshipMediaRevisionStoreV4(
            resolve(
              dataDir,
              `flagship-media-records-v4-${flagshipV3RuntimeDataVersion}`,
            ),
          )),
    flagshipContentRef: flagshipExperienceV4.flagshipContentRef,
    assetDirectory: fileURLToPath(new URL(
      "../../web/public/assets/flagship-world/v4/",
      import.meta.url,
    )),
    outputDirectory: flagshipMediaOutputDirectoryV4,
    resolvePublishedAssets: async sessionId => {
      const world=await worldSimulationV3.getRecord(sessionId);
      if(!world.fieldInterview)return null;
      const lesson=fieldLessonCatalog.find(item=>item.contentHash===world.fieldInterview!.lessonRef.contentHash);
      if(!lesson)throw new TeachingTaskError('source_drift','媒体引用的课程版本未装载');
      if(!lesson.mediaAssets)return null;
      return lesson.mediaAssets.map(asset=>({sourcePath:fileURLToPath(new URL(`../../web/public${asset.publicPath}`,import.meta.url)),item:{
        assetRef:asset.assetId,title:asset.title,mediaKind:'image' as const,publicPath:asset.publicPath,contentHash:asset.contentHash,
        rightsReceiptRef:`rights-${asset.assetId}`,rightsStatus:'cleared' as const,permittedUse:'classroom_submission' as const,
        personConsentMode:'not_applicable' as const,aiDisclosure:{explicitLabel:true as const,implicitMetadata:true as const,disclosureText:'项目生成的教学素材；原件生成属性与课程说明一并保留。'},
        sourceFactBoundary:asset.sourceFactBoundary,transformable:true,
      }}));
    },
  });
  const flagshipAssessmentRubricV4 = EvidenceAssessmentRubricV4Schema.parse({
    rubricVersion: "xunpu-evidence-rubric-v4-r1",
    rubricContentHash: hashCanonical(xunpuV4AssessmentCriteria),
    reviewStatus: "pending_expert_review",
    criteria: xunpuV4AssessmentCriteria.map((criterion) => ({
      criterionId: criterion.criterionId,
      weight: criterion.weight,
      minimumIndependentEvidenceCount: criterion.minimumIndependentEvidenceCount,
    })),
  });
  const flagshipAssessmentV4 = new FlagshipEvidenceAssessmentServiceV4({
    fieldLessons: fieldLessonCatalog,
    engine: worldSimulationV3,
    orchestrator: simulationAgentOrchestratorV3,
    work: flagshipStudentWorkV3,
    media: flagshipMediaV4,
    store: options.flagshipAssessmentStoreV4
      ?? (dataDirectoryLease === null
        ? new InMemoryFlagshipAssessmentStoreV4()
        : new JsonFileFlagshipAssessmentStoreV4(
            resolve(
              dataDir,
              `flagship-assessment-v4-${flagshipV3RuntimeDataVersion}`,
            ),
          )),
    rubric: flagshipAssessmentRubricV4,
    flagshipContentHash: xunpuFlagshipContentV4.contentHash,
    studentWorkManifestContentHash: xunpuFlagshipContentManifestV3.contentHash,
    publicKnowledgeEvidenceRefs: xunpuFlagshipContentManifestV3.sourceKnowledgeRefs
      .filter((source) => source.reviewStatus !== "retired")
      .map((source) => source.knowledgeId),
    businessOperations,
    afterAssessmentFinalized: (input) => refreshLearnerAdaptationV4(input),
    ...(flagshipGatewayModelsV4
      ? {
          workQualityModel: flagshipGatewayModelsV4.workQualityModel,
          workQualityTimeoutMs:30_000,
          onWorkQualityFailure:(error:unknown)=>{
            const failure=error as {name?:unknown;code?:unknown;issues?:Array<{path?:unknown;code?:unknown}>};
            app.log.error({failureName:typeof failure?.name==='string'?failure.name:'unknown',failureCode:typeof failure?.code==='string'?failure.code:undefined,
              validationIssues:failure?.issues?.map(issue=>({path:issue.path,code:issue.code}))},'work quality assessment could not be issued');
          },
          ...(flagshipGatewayModelsV4.workQualitySupportsVision ? {multimodalQualityPreparer:new FfmpegMultimodalQualityPreparerV4()} : {}),
        }
      : {}),
  });
  refreshAssessmentProjectionV4 = async ({ sessionId, revisionId }) => {
    const assessment = await flagshipAssessmentV4.getAssessment({ sessionId });
    return assessment
      ? currentFlagshipAssessmentDecisionV4(assessment).assessmentDecisionId
      : `assessment-not-ready-${createHash("sha256")
          .update(`${sessionId}:${revisionId}`)
          .digest("hex")
          .slice(0, 20)}`;
  };
  const provisionSecondSessionV4: ProvisionSecondSessionV4 =
    options.secondSessionProvisionerV4
    ?? createDefaultSecondSessionProvisionerV4({
      sessionControl,
      auth,
      worldSimulationV3,
      businessOperations,
      registerFieldLesson,
      freezeExperienceDescriptor: async ({ sessionId, frozenAt }) => {
        if (!sessionExperienceDescriptors) {
          throw new SessionExperienceDescriptorError(
            "not_found",
            "会话体验组合根尚未完成初始化",
            { sessionId },
          );
        }
        const snapshot = await sessionExperienceDescriptors.readRuntimeSnapshot(
          sessionId,
        );
        return sessionExperienceDescriptors.freeze(
          buildSessionExperienceDescriptor({
            ...snapshot,
            compatibility: "current",
            frozenAt,
          }),
        );
      },
    });
  const learnerAdaptationV4 = new LearnerAdaptationServiceV4({
    assessment: flagshipAssessmentV4,
    engine: worldSimulationV3,
    store: options.learnerAdaptationStoreV4
      ?? (dataDirectoryLease === null
        ? new InMemoryLearnerAdaptationStoreV4()
        : new JsonFileLearnerAdaptationStoreV4(
            resolve(
              dataDir,
              `learner-adaptation-v4-${flagshipV3RuntimeDataVersion}`,
            ),
          )),
    provisionSecondSession: provisionSecondSessionV4,
    ...(flagshipGatewayModelsV4
      ? { learnerProxyModel: flagshipGatewayModelsV4.learnerProxyModel }
      : {}),
  });
  refreshLearnerAdaptationV4 = async ({ sessionId, assessmentDecisionId }) => {
    const adaptation = await learnerAdaptationV4.getOrRefresh({ sessionId });
    if (!adaptation
      || adaptation.sourceAssessmentDecisionRef !== assessmentDecisionId) {
      throw new BusinessOperationError(
        "definition_drift",
        "教师终裁已提交，但学习者投影没有消费同一评价决定",
        { operationId: assessmentDecisionId },
      );
    }
    return adaptation.handoff.handoffId;
  };
  if ((options.initializeDemo ?? true) && !options.worldSimulationV3Engine) {
    try {
      const existing = await worldSimulationV3.getRecord(DEMO_XUNPU_SESSION_ID);
      if (!knownFlagshipRelease(existing.release.simulationReleaseRef)) {
        throw new InvalidSimulationOperationError(
          "已存在的旗舰世界会话与当前不可变发布版不一致",
        );
      }
    } catch (error) {
      if (!(error instanceof SimulationSessionNotFoundError)) throw error;
      await worldSimulationV3.startSession({
        sessionId: DEMO_XUNPU_SESSION_ID,
        release: flagshipWorldReleaseV3,
        challengeAssignment: {
          schemaVersion: ChallengeAssignmentSchemaVersion,
          challengeAssignmentId: "challenge-demo-xunpu-v3",
          learnerTwinRef: "learner-twin-pending-evidence",
          sessionId: DEMO_XUNPU_SESSION_ID,
          simulationReleaseRef: flagshipWorldReleaseV3.simulationReleaseRef,
          worldVariantRef: flagshipWorldReleaseV3.challengeVariants.find(
            (variant) => variant.challengeLevel === 4,
          )!.worldVariantId,
          previousChallengeLevel: null,
          challengeLevel: 4,
          scoreCeiling: 85,
          pressureDimensions: [
            { dimensionId: "time", intensity: 4 },
            { dimensionId: "source_access", intensity: 4 },
            { dimensionId: "relationship_conflict", intensity: 3 },
          ],
          assignmentReason: "initial_diagnostic",
          basisEvidenceRefs: [],
          forecastRef: null,
          teacherOverride: null,
          policyVersion: "challenge-initial-diagnostic/1.0.0",
          policyContentHash: createHash("sha256")
            .update("challenge-initial-diagnostic/1.0.0")
            .digest("hex"),
          assignedAt: flagshipWorldReleaseV3.publishedAt,
        },
        targetCompetencyRefs: [
          "competency-professional-communication",
          "competency-source-verification",
          "competency-editorial-independence",
          "competency-rights-governance",
        ],
        scaffoldingLevel: 1,
        startedAt: new Date().toISOString(),
      });
    }
  }
  const ensureFlagshipV4RuntimeSession = async (
    sessionId: string,
    startedAt: string,
  ): Promise<void> => {
    try {
      const existing = await worldSimulationV3.getRecord(sessionId);
      if (!knownFlagshipRelease(existing.release.simulationReleaseRef)) {
        throw new InvalidSimulationOperationError(
          "既有会话与当前旗舰组合根发布版不一致",
        );
      }
      return;
    } catch (error) {
      if (!(error instanceof SimulationSessionNotFoundError)) throw error;
    }
    await worldSimulationV3.startSession({
      sessionId,
      release: flagshipWorldReleaseV3,
      challengeAssignment: {
        schemaVersion: ChallengeAssignmentSchemaVersion,
        challengeAssignmentId: `challenge-${createHash("sha256")
          .update(sessionId)
          .digest("hex")
          .slice(0, 24)}`,
        learnerTwinRef: "learner-twin-pending-evidence",
        sessionId,
        simulationReleaseRef: flagshipWorldReleaseV3.simulationReleaseRef,
        worldVariantRef: flagshipWorldReleaseV3.challengeVariants.find(
          (variant) => variant.challengeLevel === 4,
        )!.worldVariantId,
        previousChallengeLevel: null,
        challengeLevel: 4,
        scoreCeiling: 85,
        pressureDimensions: [
          { dimensionId: "time", intensity: 4 },
          { dimensionId: "source_access", intensity: 4 },
          { dimensionId: "relationship_conflict", intensity: 3 },
        ],
        assignmentReason: "initial_diagnostic",
        basisEvidenceRefs: [],
        forecastRef: null,
        teacherOverride: null,
        policyVersion: "challenge-initial-diagnostic/1.0.0",
        policyContentHash: createHash("sha256")
          .update("challenge-initial-diagnostic/1.0.0")
          .digest("hex"),
        assignedAt: startedAt,
      },
      targetCompetencyRefs: [
        "competency-professional-communication",
        "competency-source-verification",
        "competency-editorial-independence",
        "competency-rights-governance",
      ],
      scaffoldingLevel: 1,
      startedAt,
    });
  };
  const sessionExperienceDescriptorStore =
    options.sessionExperienceDescriptorStore
    ?? (dataDirectoryLease === null
      ? new InMemorySessionExperienceDescriptorStore()
      : new JsonlSessionExperienceDescriptorStore(
          resolve(dataDir, "session-experience-descriptors.jsonl"),
        ));
  const sessionExperienceDescriptorService = new SessionExperienceDescriptorService(
    sessionExperienceDescriptorStore,
    async (sessionId) => {
      try {
        const flagship = await worldSimulationV3.getRecord(sessionId);
        trainingSessionCourseReleaseRefs.set(sessionId, flagship.release.courseReleaseRef);
        if (!knownFlagshipRelease(flagship.release.simulationReleaseRef)) sessionExperienceTitles.set(sessionId, flagship.release.title);
        return {
          sessionId,
          courseReleaseRef: flagship.release.courseReleaseRef,
          scenarioReleaseRef: flagship.release.scenarioReleaseRef,
          experienceGeneration: "flagship_v4" as const,
        };
      } catch (error) {
        if (!(error instanceof SimulationSessionNotFoundError)) throw error;
      }
      const scenario = await engine.getScenarioRelease(sessionId);
      return {
        sessionId,
        courseReleaseRef: trainingSessionCourseReleaseRefs.get(sessionId) ?? null,
        scenarioReleaseRef: {
          scenarioId: scenario.ref.scenarioId,
          version: scenario.ref.version,
          contentHash: scenario.ref.contentHash,
        },
        experienceGeneration: "standard_v2" as const,
      };
    },
  );
  sessionExperienceDescriptors = sessionExperienceDescriptorService;
  const ensureSessionExperienceDescriptor = async (input: {
    sessionId: string;
    frozenAt: string;
    compatibility: "current" | "historical";
  }) => {
    const existing = await sessionExperienceDescriptorStore.get(input.sessionId);
    if (existing) return sessionExperienceDescriptorService.get(input.sessionId);
    const snapshot = await sessionExperienceDescriptorService.readRuntimeSnapshot(
      input.sessionId,
    );
    return sessionExperienceDescriptorService.freeze(
      buildSessionExperienceDescriptor({
        ...snapshot,
        compatibility: input.compatibility,
        frozenAt: input.frozenAt,
      }),
    );
  };
  const sameCourseReleaseRef = (
    left: CourseReleaseReference | null,
    right: CourseReleaseReference | null,
  ): boolean => (
    left === null
      ? right === null
      : right !== null
        && left.courseId === right.courseId
        && left.releaseId === right.releaseId
        && left.version === right.version
        && left.contentHash === right.contentHash
  );
  const resolveCourseLaunchReporter = (
    courseReleaseRef: CourseReleaseReference,
    scenarioReleaseId: string,
  ): string => {
    const courseRelease = courseLearning.getReleaseByReference(
      courseReleaseRef,
    );
    const scenarioRelease = scenarioCatalog.getRelease(scenarioReleaseId);
    const expected = courseRelease.scenarioReleaseRef;
    if (
      scenarioRelease.ref.scenarioId !== expected.scenarioId
      || scenarioRelease.ref.version !== expected.version
      || scenarioRelease.ref.contentHash !== expected.contentHash
    ) {
      throw new CourseLearningError(
        "version_hash_drift",
        "课程发布版与开班情境发布版不一致",
        { expected, actual: scenarioRelease.ref },
      );
    }
    const reporters = scenarioRelease.package.roles.filter((role) => (
      role.actorKind === "student" && role.roleId === "reporter"
    ));
    if (reporters.length !== 1) {
      throw new CourseLearningError(
        "version_hash_drift",
        "课程开班情境必须且只能声明一个记者主岗位",
        {
          courseReleaseRef,
          reporterActorIds: reporters.map((role) => role.agentId),
        },
      );
    }
    return reporters[0]!.agentId;
  };
  const registerCourseLaunchForSession = (
    sessionId: string,
    scenarioReleaseId: string,
    courseReleaseRef: CourseReleaseReference | null,
  ): void => {
    if (!courseReleaseRef) return;
    courseLearning.registerLaunch(courseReleaseRef, {
      releaseId: courseReleaseRef.releaseId,
      sessionId,
      reporterActorId: resolveCourseLaunchReporter(
        courseReleaseRef,
        scenarioReleaseId,
      ),
    });
  };
  for (const existingSession of await sessionControl.listSessions()) {
    try {
      const world = await worldSimulationV3.getRecord(existingSession.sessionId);
      trainingSessionCourseReleaseRefs.set(existingSession.sessionId, world.release.courseReleaseRef);
      if (!knownFlagshipRelease(world.release.simulationReleaseRef)) sessionExperienceTitles.set(existingSession.sessionId, world.release.title);
      continue;
    } catch (error) { if (!(error instanceof SimulationSessionNotFoundError)) throw error; }
    let publishedScenario: ReturnType<ScenarioCatalog["getRelease"]>;
    try {
      publishedScenario = scenarioCatalog.getRelease(existingSession.releaseId);
    } catch {
      // Unknown historical releases stay unclassified. Business endpoints below
      // treat an absent classification as V2-sensitive and fail closed.
      continue;
    }
    const matchingCourseRefs = courseLearning.listCourses().flatMap((summary) => {
      const release = courseLearning.getCourse(summary.courseId);
      const scenarioRef = release.scenarioReleaseRef;
      return scenarioRef.scenarioId === publishedScenario.ref.scenarioId
        && scenarioRef.version === publishedScenario.ref.version
        && scenarioRef.contentHash === publishedScenario.ref.contentHash
        ? [courseReleaseReferenceOf(release)]
        : [];
    });
    if (matchingCourseRefs.length > 1) {
      throw new CourseLearningError(
        "version_hash_drift",
        "既有训练会话同时匹配多个不可变课程发布版",
        {
          sessionId: existingSession.sessionId,
          courseReleaseRefs: matchingCourseRefs,
        },
      );
    }
    const restoredRef = matchingCourseRefs[0] ?? null;
    trainingSessionCourseReleaseRefs.set(existingSession.sessionId, restoredRef);
    registerCourseLaunchForSession(
      existingSession.sessionId,
      existingSession.releaseId,
      restoredRef,
    );
  }
  const isV2CourseSession = (sessionId: string): boolean => (
    trainingSessionCourseReleaseRefs.get(sessionId) !== null
  );
  const secureCookies = (options.environment ?? process.env).NODE_ENV === "production";
  const taskStore = options.taskStore ?? (
    options.engine
      ? new InMemoryAgentTaskStore()
      : new JsonlAgentTaskStore(resolve(dataDir, "agent-tasks.jsonl"))
  );
  const mediaWorkStore = options.mediaWorkStore ?? (
    options.engine
      ? new InMemoryMediaProcessingWorkStore()
      : new JsonlMediaProcessingWorkStore(
          resolve(dataDir, "media-processing-work.jsonl"),
        )
  );
  const roleMemoryStore = options.roleMemoryStore ?? (
    options.engine
      ? new InMemoryRoleMemoryStore()
      : new JsonlRoleMemoryStore(resolve(dataDir, "role-memory.jsonl"))
  );
  const goldBlindReviewStore = options.goldBlindReviewStore ?? (
    options.engine
      ? new InMemoryGoldBlindReviewBatchStore()
      : new JsonlGoldBlindReviewBatchStore(
          resolve(dataDir, "gold-blind-review.jsonl"),
        )
  );
  const goldBlindReview = new GoldBlindReviewCoordinator(
    goldBlindReviewStore,
  );
  const goldPilotReadinessStore = options.goldPilotReadinessStore ?? (
    options.engine
      ? new InMemoryGoldPilotReadinessStore()
      : new JsonlGoldPilotReadinessStore(
          resolve(dataDir, "gold-pilot-readiness.jsonl"),
        )
  );
  const goldPilotReadiness = new GoldPilotReadinessCoordinator(
    goldPilotReadinessStore,
  );
  const goldPilotStudyStore = options.goldPilotStudyStore ?? (
    options.engine
      ? new InMemoryGoldPilotStudyStore()
      : new JsonlGoldPilotStudyStore(
          resolve(dataDir, "gold-pilot-study.jsonl"),
        )
  );
  const goldPilotStudy = new GoldPilotStudyCoordinator(
    goldPilotStudyStore,
  );
  const goldCompetitionEvidenceLoader =
    options.goldCompetitionEvidenceLoader
    ?? createGoldCompetitionEvidenceLoader(
      options.goldCompetitionEvidenceDir
        ?? bundledGoldCompetitionEvidenceRoot,
    );
  const goldCompetitionOfficialEvidenceLoader =
    options.goldCompetitionOfficialEvidenceLoader
    ?? createGoldCompetitionOfficialEvidenceLoader(
      options.goldCompetitionEvidenceDir
        ?? bundledGoldCompetitionEvidenceRoot,
    );
  const goldCompetitionScorecardEvidenceLoader =
    options.goldCompetitionScorecardEvidenceLoader
    ?? createGoldCompetitionScorecardEvidenceLoader(
      options.goldCompetitionEvidenceDir
        ?? bundledGoldCompetitionEvidenceRoot,
    );
  const roleMemory = new RoleMemoryService(roleMemoryStore);
  const contextAssembler = options.contextAssembler ?? new VersionedContextAssembler({
    memory: roleMemory,
  });
  const ragRetriever = new AuthorizedRagRetriever();
  const initializeWorld = async (
    sessionId: string,
    reset: boolean,
    releaseId?: string,
  ) => {
    const release = releaseId ? scenarioCatalog.getRelease(releaseId) : null;
    if (release) engine.registerScenarioRelease(release);
    const projection = await engine.createSession(
      sessionId,
      reset,
      release?.ref,
    );
    await ensureScenarioRoleMemory(engine, roleMemory, sessionId);
    return projection;
  };
  const orchestrator = options.orchestrator ?? new TrainingSessionOrchestrator({
    world: engine,
    taskStore,
    handlers: [
      new FactCheckerTaskHandler({
        runtime: modelIntegration.runtime,
        contextAssembler,
      }),
      new RoleAgentTaskHandler({
        runtime: modelIntegration.runtime,
        contextAssembler,
      }),
      new TeachingDirectorTaskHandler({
        runtime: modelIntegration.runtime,
        contextAssembler,
      }),
      new SceneDirectorTaskHandler({
        runtime: modelIntegration.runtime,
        contextAssembler,
      }),
      new SemanticEvaluationTaskHandler({
        runtime: modelIntegration.runtime,
        contextAssembler,
      }),
      new LearningCuratorTaskHandler({
        runtime: modelIntegration.runtime,
        contextAssembler,
      }),
      new AssistanceTaskHandler({
        runtime: modelIntegration.runtime,
        contextAssembler,
      }),
    ],
    ...(options.architectureProfile
      ? { architectureProfile: options.architectureProfile }
      : {}),
    ...(options.experimentObservation
      ? { experimentObservation: options.experimentObservation }
      : {}),
  });
  const mediaOrchestrator = options.mediaOrchestrator
    ?? new MediaProcessingOrchestrator({
      world: engine,
      workStore: mediaWorkStore,
      executor: adapter,
      governanceModel: modelIntegration.provider,
    });
  const roots = createPlatformCompositionRoots({
    course: {
      learning: courseLearning,
      sessionExperienceDescriptors: sessionExperienceDescriptorService,
    },
    world: {
      authoritativeWorld: engine,
      simulationWorld: worldSimulationV3,
      collaboration: simulationAgentOrchestratorV3,
      director: xunpuWorldDirectorV3,
      flagshipExperience: flagshipExperienceV4,
    },
    work: {
      legacyMedia: mediaOrchestrator,
      flagshipStudentWork: flagshipStudentWorkV3,
      flagshipMedia: flagshipMediaV4,
    },
    assessment: {
      flagshipV3: flagshipAssessmentV3,
      flagshipV4: flagshipAssessmentV4,
    },
    adaptation: {
      flagshipV3: learnerAdaptationV3,
      flagshipV4: learnerAdaptationV4,
    },
    operations: {
      auth,
      sessionControl,
      businessOperations,
      modelIntegration,
      legacyAgentOrchestrator: orchestrator,
    },
  });
  const sessionSummary = (record: TrainingSessionRecord) => {
    const courseRef = trainingSessionCourseReleaseRefs.get(record.sessionId);
    const experienceTitle = sessionExperienceTitles.get(record.sessionId) ?? (courseRef ? courseLearning.getReleaseByReference(courseRef).title
      : scenarioCatalog.getRelease(record.releaseId).package.title);
    return TrainingSessionSummarySchema.parse({
      schemaVersion: SessionControlSchemaVersion,
      ...record,
      experienceTitle,
    });
  };
  const deterministicTrainingSessionId = (
    principalId: string,
    requestId: string,
  ): string => (
    `training-${createHash("sha256")
      .update(`${principalId}:${requestId}`)
      .digest("hex")
      .slice(0, 20)}`
  );
  const recoveryErrorCode = (error: unknown): string => {
    if (error instanceof SessionControlError) return `session_control_${error.code}`;
    if (
      error instanceof Error
      && error.name !== "Error"
      && /^[a-zA-Z][a-zA-Z0-9_]{0,79}$/u.test(error.name)
    ) {
      return error.name.toLowerCase();
    }
    return "session_provision_failed";
  };
  const transitionToRecoveryFailed = async (
    record: TrainingSessionRecord,
    error: unknown,
  ): Promise<TrainingSessionRecord> => {
    const current = await sessionControl.getSession(record.sessionId);
    if (!current) throw error;
    if (current.status === "recovery_failed") return current;
    if (!["provisioning", "active", "paused"].includes(current.status)) throw error;
    return sessionControl.transitionSessionStatus({
      sessionId: current.sessionId,
      expectedStatus: current.status,
      expectedStatusVersion: current.statusVersion,
      nextStatus: "recovery_failed",
      updatedAt: new Date().toISOString(),
      recoveryErrorCode: recoveryErrorCode(error),
    });
  };
  const activateTrainingSession = async (
    record: TrainingSessionRecord,
  ): Promise<TrainingSessionRecord> => {
    if (record.status === "active") return record;
    const release = scenarioCatalog.getRelease(record.releaseId);
    engine.registerScenarioRelease(release);
    await initializeWorld(record.sessionId, false, record.releaseId);
    orchestrator.start([record.sessionId]);
    mediaOrchestrator.start([record.sessionId]);
    // Session provisioning owns the immutable release, initial world and
    // control-plane transition. Agent and media drains belong to the running
    // session and continue through their subscribed background workers; a
    // large ambient backlog must not hold the teacher's start request open.
    // Persisted sessions still use the blocking startup-recovery path below.
    await options.beforeTrainingSessionActivation?.(record.sessionId);
    const current = await sessionControl.getSession(record.sessionId);
    if (!current) {
      throw new SessionControlError("not_found", "会话控制记录在激活前丢失", {
        sessionId: record.sessionId,
      });
    }
    if (current.status === "active") return current;
    if (current.status !== "provisioning") {
      throw new SessionControlError("status_conflict", "会话不处于可激活状态", {
        sessionId: current.sessionId,
        status: current.status,
      });
    }
    return sessionControl.transitionSessionStatus({
      sessionId: current.sessionId,
      expectedStatus: current.status,
      expectedStatusVersion: current.statusVersion,
      nextStatus: "active",
      updatedAt: new Date().toISOString(),
    });
  };
  const ensureControlSession = async (input: {
    sessionId: string;
    classroomId: string;
    teamId: string;
    releaseId: string;
    requestedBy: string;
    requestId: string;
  }): Promise<TrainingSessionRecord> => {
    const existing = await sessionControl.getSession(input.sessionId);
    if (existing) return existing;
    const createdAt = new Date().toISOString();
    return sessionControl.createSession({
      sessionId: input.sessionId,
      classroomId: input.classroomId,
      teamId: input.teamId,
      releaseId: input.releaseId,
      status: "provisioning",
      statusVersion: 0,
      requestedBy: input.requestedBy,
      createdAt,
      updatedAt: createdAt,
      activatedAt: null,
      completedAt: null,
      lastRecoveryErrorCode: null,
    }, input.requestId);
  };

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const statusCode = errorStatus(error);
    if (statusCode >= 500) request.log.error({ failure: { name: error.name, message: error.message, code: error.code }, route: request.routeOptions.url }, "业务请求未完成");
    reply.status(statusCode).send({
      error: error.name,
      message: statusCode === 500 ? "服务暂时无法处理请求" : error.message,
      ...(error instanceof StateVersionConflictError ? { expected: error.expected, actual: error.actual } : {}),
      ...(error instanceof SessionControlError ? { code: error.code } : {}),
      ...(error instanceof TracePaginationCursorError ? { code: error.code } : {}),
      ...(error instanceof CourseLearningError
        ? { code: error.code, details: error.details }
        : {}),
      ...(error instanceof LearnerAdaptationErrorV3
        ? { code: error.code }
        : {}),
      ...(error instanceof LearnerAdaptationErrorV4
        ? { code: error.code }
        : {}),
      ...(error instanceof FlagshipAssessmentErrorV4 || error instanceof FieldEvidenceSourceError
        ? { code: error.code }
        : {}),
      ...(error instanceof TeachingTaskError ? { code: error.code } : {}),
      ...(error instanceof SessionExperienceDescriptorError
        ? { code: error.code, details: error.details }
        : {}),
      ...(error instanceof BusinessOperationError
        ? { code: error.code }
        : {}),
      ...(error instanceof AgentAblationIntegrityError
        ? { code: error.code }
        : {}),
      ...(error instanceof GoldBlindReviewWorkflowError
        ? { code: error.code, details: error.details }
        : {}),
      ...(error instanceof GoldPilotStudyError
        ? { code: error.code, details: error.details }
        : {}),
      ...(error instanceof GoldPilotReadinessError
        ? { code: error.code, details: error.details }
        : {}),
    });
  });

  const assertAllowedOrigin = (origin: string | undefined): void => {
    if (!isAllowedOrigin(origin, environment, allowedOrigins)) {
      throw new RoleBindingDeniedError("请求来源不在本地演示白名单");
    }
  };
  const requireToken = (cookieHeader: string | undefined): string => {
    const token = readCookie(cookieHeader, DEMO_AUTH_COOKIE);
    if (!token) throw new AuthenticationRequiredError();
    return token;
  };
  const assertNoClientActorClaim = (body: unknown): void => {
    if (
      body
      && typeof body === "object"
      && ("actorId" in body || "actorKind" in body || "roleId" in body)
    ) {
      throw new RoleBindingDeniedError("客户端不得自行声明 actorId、actorKind 或 roleId");
    }
  };
  const requireTeacherAuthor = (
    token: string,
    bindingId: string,
    authorizationSessionId: string,
  ) => {
    const identity = auth.resolveBinding(token, bindingId, authorizationSessionId);
    if (identity.binding.actorKind !== "teacher") {
      throw new RoleBindingDeniedError("只有教师岗位绑定可以管理课程情境");
    }
    return identity;
  };
  const requireAdministrator = (
    identity: ReturnType<typeof auth.resolveBinding>,
  ) => {
    if (!["operator", "operator-demo"].includes(identity.profileId)) {
      throw new RoleBindingDeniedError("只有管理员身份可以查看后台运行日志");
    }
    return identity;
  };
  const courseSubjectForProfile = (profileId: string) => {
    const profile = getDemoProfile(profileId);
    return {
      principalId: profile.principalId,
      profileId: profile.profileId,
      role: profile.role,
    } as const;
  };
  const teachingTasks = new TeachingTaskService({
    store: () => contentLibraryRuntime.store(), courseRef: xunpuPublishedCourseReleaseRef, lessons: fieldLessonCatalog,
    registerLesson: registerFieldLesson, baseLessonFor: actor => characterStudio.lessonFor(xunpuPublishedCourseReleaseRef.courseId, actor.classroomId),
  });
  if (recoverTeachingTasks) await teachingTasks.restorePublications();
  const teachingTaskRuntime = new TeachingTaskRuntime({ tasks: teachingTasks, baseRelease: flagshipWorldReleaseV3,
    sessionControl, auth, worldSimulationV3, businessOperations,
    freezeExperienceDescriptor: ({ sessionId, frozenAt }) => ensureSessionExperienceDescriptor({ sessionId, frozenAt, compatibility: "current" }),
    claimEnrollment: async ({ profileId, principalId, courseReleaseId }) => {
      const subject = courseSubjectForProfile(profileId);
      if (subject.principalId !== principalId || subject.role !== "student") throw new TeachingTaskError("access_denied", "课程认领主体不一致");
      return (await courseLearning.claim({ subject, courseReleaseId, bindingId: null, activeSessionId: null })).enrollmentId;
    },
  });
  const teacherClassrooms = async (principalId: string) => {
    const memberships = await sessionControl.listMemberships({principalId,roles:['teacher'],statuses:['active']});
    const ids = new Set(memberships.filter(item=>item.teamId===null&&item.sessionId===null).map(item=>item.classroomId));
    return (await sessionControl.listClassrooms()).filter(item=>ids.has(item.classroomId)&&item.status==='active').map(item=>({classroomId:item.classroomId,name:item.name}));
  };
  const authorizeTeaching: TeachingAuthorizer = async (request, mutation, authorContext) => {
      if (mutation) { assertAllowedOrigin(request.headers.origin); assertNoClientActorClaim(request.body); }
      const token = requireToken(request.headers.cookie);
      if (mutation) auth.assertCsrf(token, request.headers["x-csrf-token"] as string | undefined);
      const identity = auth.resolvePrincipal(token), profile = getDemoProfile(identity.profileId);
      let actorId = profile.role === "student" ? "student-reporter" : "teacher-main";
      let sourceSessionId = profile.defaultSessionId ?? DEMO_XUNPU_SESSION_ID;
      if (authorContext) {
        const authorized = auth.resolveBinding(token, authorContext.bindingId, authorContext.authorizationSessionId);
        const sourceSession = await sessionControl.getSession(authorContext.authorizationSessionId);
        if (profile.role !== "teacher" || authorized.binding.actorKind !== "teacher" || !sourceSession || sourceSession.classroomId !== profile.classroomId) throw new TeachingTaskError("access_denied", "只有本班课程教师可以修改或发布任务");
        await assertTeacherScope({ control: sessionControl, principalId: profile.principalId, classroomId: sourceSession.classroomId, teamId: sourceSession.teamId });
        actorId = authorized.binding.actorId; sourceSessionId = sourceSession.sessionId;
      }
      const requestedClass = authorContext?.classroomId ?? (request.query as {classroomId?:unknown}).classroomId;
      const classroomId = requestedClass === undefined ? profile.classroomId : z.string().min(1).max(240).parse(requestedClass);
      if (classroomId !== profile.classroomId && (profile.role !== 'teacher' || !(await teacherClassrooms(profile.principalId)).some(item=>item.classroomId===classroomId))) throw new TeachingTaskError('access_denied','没有所选班级的课程管理权限');
      return { principalId: profile.principalId, actorId, role: profile.role, classroomId,
        sourceSessionId, teamId: profile.teamId, profileId: profile.profileId };
    };
  await registerTeachingTaskRoutes(app, { tasks: teachingTasks, runtime: teachingTaskRuntime, authorize: authorizeTeaching,
    start: async (actor, taskReleaseId) => {
      const publication = await teachingTasks.publication(taskReleaseId, actor), course = publication.release.sourceCourseRef;
      const owner = studyActorForProfile(actor.profileId), state = await studentStudy.read(owner);
      const input = { requestId: 'task-launch-'+hashCanonical({ principalId: actor.principalId, taskReleaseId, revision: state.revision }).slice(0,30), courseReleaseId: course.releaseId, taskReleaseId };
      const result = await studentStudy.start(owner, input, course.courseId, ({practiceOrdinal}) => publishedCourseRuntime.prepare(owner,course.releaseId,input.requestId,taskReleaseId,practiceOrdinal));
      if(result.run.status!=='active')throw new TeachingTaskError('invalid_task','该场次已经结束，请从课程档案重新开课');
      return {taskReleaseRef:publication.release.ref,sessionId:result.run.sessionId,bindingId:result.run.bindingId,title:result.run.title,status:'active',startedAt:result.run.startedAt};
    } });
  const characterStudio = new CharacterStudio({ store: () => contentLibraryRuntime.store(), registerLesson: registerFieldLesson, lessons: fieldLessonCatalog });
  await registerCharacterStudioRoutes(app, { studio: characterStudio, authorize: authorizeTeaching, store: () => contentLibraryRuntime.store(),
    ...(dataDirectoryLease === null ? {} : { artDirectory: resolve(dataDir, "character-art") }) });
  await registerContentLibraryRoutes(app, {
    authorize: async (request, mutation, courseId) => {
      if (mutation) {
        assertAllowedOrigin(request.headers.origin);
        assertNoClientActorClaim(request.body);
      }
      const token = requireToken(request.headers.cookie);
      if (mutation) auth.assertCsrf(token, request.headers["x-csrf-token"] as string | undefined);
      const identity = auth.resolvePrincipal(token);
      const subject = courseSubjectForProfile(identity.profileId);
      const principalId = identity.principal.principalId;
      const enrolled = subject.role === "student" && courseId
        ? await courseLearning.findEnrollment(principalId, courseId) : null;
      return { principalId, role: subject.role,
        ...(subject.role === "student" ? { enrolledCourseIds: new Set(enrolled ? [enrolled.enrollment.courseReleaseRef.courseId] : []) } : {}),
      };
    },
    assertCourse: (courseId) => { courseLearning.getCourse(courseId); },
    library: (identity) => contentLibraryRuntime.library(identity),
    store: () => contentLibraryRuntime.store(),
    ingestion: (identity) => contentLibraryRuntime.ingestion(identity),
    indexRevision: (revisionId, identity, courseId) => contentLibraryRuntime.indexRevision(revisionId, identity, courseId),
    indexCourse: (courseId, identity) => contentLibraryRuntime.indexCourse(courseId, identity),
    assertRevisionCourse: async (revisionId, identity, courseId) => { await contentLibraryRuntime.authorizedRevision(revisionId, identity, courseId); },
  });
  const courseBindingsOf = (
    bindings: ReturnType<typeof auth.resolvePrincipal>["bindings"],
  ): CourseLearningBinding[] => bindings.flatMap((binding) => (
    binding.actorKind === "teacher" || binding.actorKind === "student"
      ? [{
          bindingId: binding.bindingId,
          sessionId: binding.sessionId,
          actorId: binding.actorId,
          actorKind: binding.actorKind,
          roleId: binding.roleId,
        }]
      : []
  ));
  const authorizeCoursePrincipal: CourseLearningRouteDependencies["authorizePrincipal"] = ({ request, mutation }) => {
      if (mutation) {
        assertAllowedOrigin(request.headers.origin);
        assertNoClientActorClaim(request.body);
      }
      const token = requireToken(request.headers.cookie);
      if (mutation) {
        auth.assertCsrf(
          token,
          request.headers["x-csrf-token"] as string | undefined,
        );
      }
      const identity = auth.resolvePrincipal(token);
      const subject = courseSubjectForProfile(identity.profileId);
      if (mutation && subject.role === "teacher") {
        throw new CourseLearningError(
          "access_denied",
          "教师身份不能代替学生认领课程",
        );
      }
      return {
        subject,
        bindings: courseBindingsOf(identity.bindings),
      };
    };
  const studyActorForProfile = (profileId: string): PublishedStudyActor => {
    const profile = getDemoProfile(profileId);
    if (profile.role !== "student") throw new PermissionDeniedError("只有学生身份拥有个人课程记录");
    return { principalId: profile.principalId, profileId, classroomId: profile.classroomId, displayName: profile.displayName,
      teamId: profile.teamId, subject: courseSubjectForProfile(profileId) };
  };
  const studentStudy = new StudentStudyStore({
    ...(dataDirectoryLease === null ? {} : { directory: resolve(dataDir, "student-study-v3") }),
    legacyRuns: async owner => {
      const runs: import("@ronggang/contracts").StudyRunV3[] = [];
      const sessions = await sessionControl.listSessions({ principalId: owner.principalId });
      const taskSessions=sessions.filter(session=>session.sessionId.startsWith('task-session-')&&session.requestedBy===owner.principalId&&['active','paused','completed'].includes(session.status));
      const taskPublications = taskSessions.length?await teachingTasks.publications():[];
      for (const session of taskSessions) {
        const world = await roots.world.simulationWorld.getRecord(session.sessionId);
        if (!world.fieldInterview) continue;
        const completed = world.currentSnapshot.endingState.status === "completed" || session.status === "completed";
        runs.push({ sessionId: session.sessionId, bindingId: world.fieldInterview.bindingId, courseRef: world.release.courseReleaseRef,
          ...(taskPublications.find(item => item.release.lessonHash === world.fieldInterview!.lessonRef.contentHash) ? { taskReleaseId: taskPublications.find(item => item.release.lessonHash === world.fieldInterview!.lessonRef.contentHash)!.release.ref.releaseId } : {}),
          title: world.release.title, status: completed ? "completed" : "active", startedAt: session.createdAt, endedAt: completed ? world.updatedAt : null });
      }
      for (const course of roots.course.learning.listCourses()) {
        const stored = await roots.course.learning.findEnrollment(owner.principalId, course.courseId);
        const enrollment = stored?.enrollment;
        if (!enrollment?.activeSessionId || runs.some(run => run.sessionId === enrollment.activeSessionId)) continue;
        runs.push({ sessionId: enrollment.activeSessionId, bindingId: enrollment.bindingId, courseRef: enrollment.courseReleaseRef,
          runtimeKind:'legacy_course',
          title: course.title, status: enrollment.status === "completed" ? "completed" : "active", startedAt: enrollment.startedAt!, endedAt: enrollment.completedAt });
      }
      return runs;
    },
    isCompleted: async (run, owner) => {
      if(run.runtimeKind==='legacy_course'){
        const enrolled=await roots.course.learning.findEnrollment(owner.principalId,run.courseRef.courseId);
        if(enrolled?.enrollment.activeSessionId!==run.sessionId)return false;
        return enrolled.enrollment.status==='completed'||(await engine.getStateSnapshot(run.sessionId)).status==='completed';
      }
      try { return (await roots.world.simulationWorld.getRecord(run.sessionId)).currentSnapshot.endingState.status === "completed"; }
      catch (error) {
        if (!(error instanceof SimulationSessionNotFoundError)) throw error;
        await engine.getScenarioRelease(run.sessionId);
        const prior = await roots.course.learning.findEnrollment(owner.principalId, run.courseRef.courseId);
        if (!prior || prior.enrollment.activeSessionId !== run.sessionId) throw error;
        return prior.enrollment.status === "completed";
      }
    },
    canComplete: async (run,owner) => {
      if(run.runtimeKind==='legacy_course'){
        const prior=await roots.course.learning.findEnrollment(owner.principalId,run.courseRef.courseId);
        return prior?.enrollment.activeSessionId===run.sessionId&&['awaiting_review','completed'].includes(prior.enrollment.status);
      }
      const world = await roots.world.simulationWorld.getRecord(run.sessionId);
      return (await flagshipStudentWorkV3.getReviewWorkspace({ sessionId: run.sessionId,
        challengeLevel: z.union([z.literal(3),z.literal(4),z.literal(5),z.literal(6),z.literal(7)]).parse(world.challengeAssignment.challengeLevel) })).completion.readyForPublication;
    },
  });
  const publishedCourseRuntime = new PublishedCourseRuntime({ courses: roots.course.learning,
    worldSimulationV3: roots.world.simulationWorld, sessionControl, auth, businessOperations,
    kernelTemplateSessionId: DEMO_XUNPU_SESSION_ID,
    lessonByHash: hash => { const lesson = fieldLessonCatalog.find(lesson => lesson.contentHash === hash); if (!lesson) throw new TeachingTaskError("source_drift","课程现场版本未装载"); return lesson; },
    freezeExperienceDescriptor: ({ sessionId, frozenAt }) => ensureSessionExperienceDescriptor({ sessionId, frozenAt, compatibility: "current" }),
    teacherFor: classroomId => {
      const profile = demoProfileDefinitions.find(profile => profile.role === "teacher" && profile.classroomId === classroomId);
      if (!profile) throw new PermissionDeniedError("当前班级没有已配置的课程教师");
      return { principalId: profile.principalId, actorId: "teacher-main" };
    },
    fieldLessonFor: async (courseId, classroomId, practiceOrdinal) => {
      const baseHash=await characterStudio.lessonFor(courseId,classroomId);
      const base=fieldLessonCatalog.find(lesson=>lesson.contentHash===baseHash);
      if (!base) throw new TeachingTaskError('source_drift','本课已发布的现场版本未装载');
      const variant=createFieldLessonVariantV3(base,courseId,practiceOrdinal);
      await registerFieldLesson(variant);
      return variant.contentHash;
    },
    teachingTask: async (actor, courseReleaseId, taskReleaseId, requestId) => {
      const taskActor = { principalId: actor.principalId, profileId: actor.profileId, role: 'student' as const, actorId: 'student-reporter', classroomId: actor.classroomId, teamId: actor.teamId, sourceSessionId: DEMO_XUNPU_SESSION_ID };
      const publication = await teachingTasks.publication(taskReleaseId, taskActor);
      if (publication.release.sourceCourseRef.releaseId !== courseReleaseId) throw new TeachingTaskError('source_drift','委托与基础课程的发布引用不一致');
      const session = await teachingTaskRuntime.start(taskActor, taskReleaseId, requestId);
      if (!session.bindingId || session.status !== "active") throw new TeachingTaskError("invalid_task", "本次委托尚未形成有效的学生场次绑定");
      return {sessionId:session.sessionId,bindingId:session.bindingId,courseRef:publication.release.sourceCourseRef,title:session.title,status:'active',startedAt:session.startedAt,endedAt:null,taskReleaseId};
    },
    inheritedContacts: async (actor, courseId) => {
      const region = courseFieldLessonsV3.find(course => course.courseId === courseId)?.lesson.region?.id;
      const sessions = (await sessionControl.listSessions({ principalId: actor.principalId }))
        .filter(session => session.requestedBy === actor.principalId && session.classroomId === actor.classroomId && ["active", "paused", "completed"].includes(session.status));
      const worlds = await Promise.all(sessions.map(async session => {
        try { return await worldSimulationV3.getRecord(session.sessionId); }
        catch (error) { if (error instanceof SimulationSessionNotFoundError) return null; throw error; }
      }));
      const contacts = new Map<string, import("@ronggang/contracts").FieldContactMemoryV3>();
      for (const world of worlds.filter(world => world !== null).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
        const field = world.fieldInterview, lesson = fieldLessonCatalog.find(lesson => lesson.contentHash === field?.lessonRef.contentHash);
        if (!field || !region || lesson?.region?.id !== region) continue;
        for (const contact of field.contacts ?? []) if (!contacts.has(contact.npcId)) contacts.set(contact.npcId, { ...structuredClone(contact),
          origins: [...contact.origins.filter(origin => origin.sessionId !== world.sessionId), { sessionId: world.sessionId, lessonHash: field.lessonRef.contentHash }].slice(-30) });
      }
      return [...contacts.values()];
    },
  });
  await registerStudentStudyRoutes(app, { store: studentStudy, runtime: publishedCourseRuntime, authorize: authorizeCoursePrincipal,
    actorFor: principal => studyActorForProfile(principal.subject.profileId),
    submittedWorks:async(actor,sessionId)=>{
      const record=await flagshipStudentWorkV3.loadRecord(sessionId);
      if(record&&record.ownerPrincipalId!==actor.principalId)throw new PermissionDeniedError('作品的学生归属不一致');
      return flagshipStudentWorkV3.submittedWorks(sessionId);
    },
    preparedRun:async(actor,input)=>{
      const source=await worldSimulationV3.getRecord(input.sourceSessionId);
      const memberships=await sessionControl.listMemberships({classroomId:actor.classroomId,roles:['student'],statuses:['active']});
      const membership=memberships.find(item=>item.principalId===actor.principalId&&(item.sessionId===null||item.sessionId===input.sourceSessionId)
        && (!source.fieldInterview || (item.actorId===source.fieldInterview.actorId&&stableMembershipBindingId(actor.principalId,membershipAssignment(item,input.sourceSessionId))===source.fieldInterview.bindingId)));
      if(!membership)throw new PermissionDeniedError('当前学生没有来源课程的有效成员关系');
      const bindingId=stableMembershipBindingId(actor.principalId,membershipAssignment(membership,input.sourceSessionId));
      const record=await learnerAdaptationV4.getOrRefresh({sessionId:input.sourceSessionId,fallbackLearner:{actorId:membership.actorId,bindingId}});
      if(!record||(record.handoff.status!=='provisioned'&&record.handoff.status!=='calibration_completed'))throw new PermissionDeniedError('后续训练尚未完成学生同意与教师授权');
      const provision=record.handoff.provision;
      if(provision.sessionRef!==input.sessionId)throw new PermissionDeniedError('目标场次不属于本次后续训练授权');
      const target=await worldSimulationV3.getRecord(input.sessionId),control=await sessionControl.getSession(input.sessionId);
      const own=memberships.find(item=>item.principalId===actor.principalId&&item.sessionId===input.sessionId
        && stableMembershipBindingId(actor.principalId,membershipAssignment(item,input.sessionId))===provision.bindingRef);
      if(!own||!control||control.classroomId!==actor.classroomId||target.currentSnapshot.endingState.status!=='active')throw new PermissionDeniedError('后续训练的成员关系或运行状态已失效');
      return {sessionId:input.sessionId,bindingId:provision.bindingRef,courseRef:target.release.courseReleaseRef,title:target.release.title,
        status:'active',startedAt:control.createdAt,endedAt:null};
    },
  });
  await registerTeacherArchiveRoutes(app, { study: studentStudy, authorize: authorizeTeaching, engine: worldSimulationV3,
    lessons: fieldLessonCatalog, work: flagshipStudentWorkV3, assessment: flagshipAssessmentV4, classrooms: teacherClassrooms, studentName: profileId => getDemoProfile(profileId).displayName,
    roster:async classroomId=>{
      const memberships=await sessionControl.listMemberships({classroomId,roles:['student'],statuses:['active']});
      const principals=new Set(memberships.map(item=>item.principalId));
      return demoProfileDefinitions.filter(profile=>profile.role==='student'&&profile.classroomId===classroomId&&principals.has(profile.principalId))
        .map(profile=>({principalId:profile.principalId,profileId:profile.profileId,classroomId,displayName:profile.displayName}));
    } });
  await registerCourseArchiveRoutes(app, { service: roots.course.learning, authorize: authorizeCoursePrincipal, teaching: { tasks: teachingTasks, authorize: authorizeTeaching } });
  await registerCourseLearningRoutes(app, {
    service: roots.course.learning,
    authorizePrincipal: authorizeCoursePrincipal,
    authorizeLearning: async ({ request, sessionId, bindingId, mutation, purpose }) => {
      if (mutation) {
        assertAllowedOrigin(request.headers.origin);
        assertNoClientActorClaim(request.body);
      }
      const token = requireToken(request.headers.cookie);
      if (mutation) {
        auth.assertCsrf(
          token,
          request.headers["x-csrf-token"] as string | undefined,
        );
      }
      const identity = auth.resolveBinding(token, bindingId, sessionId);
      if (mutation && purpose!=='review' && identity.binding.actorKind === "student") await studentStudy.assertWritable(studyActorForProfile(identity.profileId), sessionId);
      return {
        subject: courseSubjectForProfile(identity.profileId),
        binding: {
          bindingId: identity.binding.bindingId,
          sessionId: identity.binding.sessionId,
          actorId: identity.binding.actorId,
          actorKind: identity.binding.actorKind as "teacher" | "student",
          roleId: identity.binding.roleId,
        },
      };
    },
    provisionReporterBinding: async ({ request, principal, release, launch }) => {
      const actor = studyActorForProfile(principal.subject.profileId), state = await studentStudy.read(actor);
      const input = { requestId: 'course-launch-'+hashCanonical({ principalId: actor.principalId, releaseId: release.releaseId, revision: state.revision }).slice(0,30), courseReleaseId: release.releaseId };
      const session=await sessionControl.getSession(launch.sessionId),profile=getDemoProfile(principal.subject.profileId);
      if(!session||!['active','paused'].includes(session.status))throw new CourseLearningError('course_not_found','课程对应的训练会话尚未开放');
      if(session.classroomId!==profile.classroomId||!profile.teamId||session.teamId!==profile.teamId)throw new CourseLearningError('access_denied','课程训练会话不在当前学生的班级与小组范围内');
      const scenarioRelease=await engine.getScenarioRelease(launch.sessionId),expected=release.scenarioReleaseRef;
      if(scenarioRelease.ref.scenarioId!==expected.scenarioId||scenarioRelease.ref.version!==expected.version||scenarioRelease.ref.contentHash!==expected.contentHash)
        throw new CourseLearningError('version_hash_drift','课程发布版与训练会话的不可变情境引用不一致');
      const scenario=await engine.getScenarioPackage(launch.sessionId),reporter=scenario.roles.find(role=>role.agentId===launch.reporterActorId&&role.actorKind==='student'&&role.roleId==='reporter');
      if(!reporter)throw new CourseLearningError('version_hash_drift','课程训练会话缺少冻结的记者岗位');
      const now=new Date().toISOString(),membership:SessionMembership={membershipId:['membership-v2',profile.profileId,release.courseId,reporter.agentId].join('-'),
        principalId:profile.principalId,classroomId:profile.classroomId,teamId:profile.teamId,sessionId:session.sessionId,role:'student',actorId:reporter.agentId,status:'active',createdAt:now,updatedAt:now,revokedAt:null};
      const assignment=membershipAssignment(membership,session.sessionId),bindingId=stableMembershipBindingId(profile.principalId,assignment);
      const result = await studentStudy.start(actor,input,release.courseId,async()=>{
        const existing=await sessionControl.getMembership(membership.membershipId);
        if(existing&&existing.status!=='active')throw new CourseLearningError('access_denied','原记者成员关系已经撤销');
        if(!existing)await sessionControl.putMembership(membership);
        await roots.course.learning.claim({subject:principal.subject,courseReleaseId:release.releaseId,bindingId,activeSessionId:session.sessionId});
        return {sessionId:session.sessionId,bindingId,courseRef:{courseId:release.courseId,releaseId:release.releaseId,version:release.version,contentHash:release.contentHash},
          title:release.title,status:'active',startedAt:now,endedAt:null,runtimeKind:'legacy_course'};
      });
      if(result.run.status!=='active')throw new CourseLearningError('enrollment_conflict','原课程已结束，请从档案重新开课');
      if(result.run.sessionId!==session.sessionId)throw new CourseLearningError('enrollment_conflict','本课已在个人场次中开始，请从课程档案继续');
      auth.addMembershipBindings(requireToken(request.headers.cookie),[assignment]);
      return {bindingId:result.run.bindingId,activeSessionId:result.run.sessionId};
    },
  });
  const loadAuthorizedStudentTrainingContext = async (
    request: FastifyRequest,
    sessionId: string,
    bindingId: string,
  ) => {
    const token = requireToken(request.headers.cookie);
    const identity = auth.resolveBinding(token, bindingId, sessionId);
    if (
      identity.binding.actorKind !== "student"
      || identity.binding.roleId !== "reporter"
    ) {
      throw new PermissionDeniedError(
        "学生训练现场只向当前会话记者岗位开放",
      );
    }
    const principal = auth.resolvePrincipal(token);
    const subject = courseSubjectForProfile(principal.profileId);
    const enrollments = await courseLearning.listEnrollments({
      subject,
      bindings: courseBindingsOf(principal.bindings),
    });
    const enrollment = enrollments.find((candidate) => (
      candidate.activeSessionId === sessionId
      && candidate.bindingId === bindingId
      && candidate.primaryRoleId === "reporter"
    ));
    if (!enrollment) {
      throw new CourseLearningError(
        "access_denied",
        "当前记者绑定没有对应的课程认领记录",
      );
    }
    const frozenSessionRef = trainingSessionCourseReleaseRefs.get(sessionId)
      ?? null;
    if (!sameCourseReleaseRef(frozenSessionRef, enrollment.courseReleaseRef)) {
      throw new CourseLearningError(
        "version_hash_drift",
        "课程认领与训练会话的不可变发布引用不一致",
        {
          expected: enrollment.courseReleaseRef,
          actual: frozenSessionRef,
        },
      );
    }
    const courseRelease = courseLearning.getReleaseByReference(
      enrollment.courseReleaseRef,
    );
    const [projection, publishedScenario] = await Promise.all([
      engine.getProjection(sessionId, identity.binding.actorId),
      engine.getScenarioRelease(sessionId),
    ]);
    const scenarioReleaseRef = {
      scenarioId: publishedScenario.ref.scenarioId,
      version: publishedScenario.ref.version,
      contentHash: publishedScenario.ref.contentHash,
    };
    if (
      scenarioReleaseRef.scenarioId
        !== courseRelease.scenarioReleaseRef.scenarioId
      || scenarioReleaseRef.version
        !== courseRelease.scenarioReleaseRef.version
      || scenarioReleaseRef.contentHash
        !== courseRelease.scenarioReleaseRef.contentHash
    ) {
      throw new CourseLearningError(
        "version_hash_drift",
        "学生训练现场与课程冻结的情境发布引用不一致",
        {
          expected: courseRelease.scenarioReleaseRef,
          actual: scenarioReleaseRef,
        },
      );
    }
    try {
      return buildStudentTrainingContext({
        projection,
        bindingId,
        courseReleaseRef: enrollment.courseReleaseRef,
        scenarioReleaseRef,
      });
    } catch (error) {
      if (error instanceof StudentTrainingContextError) {
        throw new CourseLearningError(
          "version_hash_drift",
          error.message,
        );
      }
      throw error;
    }
  };
  await registerStudentTrainingContextRoutes(app, {
    loadAuthorizedContext: ({ request, sessionId, bindingId }) => (
      loadAuthorizedStudentTrainingContext(request, sessionId, bindingId)
    ),
  });
  const requireSessionTeacher = async (
    token: string,
    bindingId: string,
    sessionId: string,
  ) => {
    const identity = auth.resolveBinding(token, bindingId, sessionId);
    const projection = await engine.getProjection(
      sessionId,
      identity.binding.actorId,
    );
    if (projection.actorKind !== "teacher") {
      throw new PermissionDeniedError(
        "只有教师视野可以协调国金证据工作流",
      );
    }
    return identity;
  };
  await registerCollaborationStrategyRoutes(app, {
    service: collaborationStrategy,
    authorizeTeacher: ({
      request,
      bindingId,
      authorizationSessionId,
      mutation,
    }) => {
      if (mutation) {
        assertAllowedOrigin(request.headers.origin);
        assertNoClientActorClaim(request.body);
      }
      const token = requireToken(request.headers.cookie);
      if (mutation) {
        auth.assertCsrf(
          token,
          request.headers["x-csrf-token"] as string | undefined,
        );
      }
      const identity = requireTeacherAuthor(
        token,
        bindingId,
        authorizationSessionId,
      );
      return {
        actorId: identity.binding.actorId,
        actorKind: "teacher",
      };
    },
  });
  const requireBlindReviewBatchInSession = async (
    sessionId: string,
    batchId: string,
  ) => {
    const workflow = await goldBlindReview.getWorkflowView(sessionId);
    if (!workflow.batches.some((batch) => batch.batchId === batchId)) {
      throw new GoldBlindReviewWorkflowError(
        "batch_not_found",
        "当前训练会话不存在该盲评批次",
        { sessionId, batchId },
      );
    }
  };
  const requireReadinessPlanInSession = async (
    sessionId: string,
    readinessId: string,
  ) => {
    const workflow = await goldPilotReadiness.getWorkflowView(sessionId);
    if (!workflow.plans.some((plan) => (
      plan.readinessId === readinessId
    ))) {
      throw new GoldPilotReadinessError(
        "plan_not_found",
        "当前训练会话不存在该采集前计划",
        { sessionId, readinessId },
      );
    }
  };
  const loadSessionTraceContextForActor = async (
    sessionId: string,
    actorId: string,
  ) => {
    const projection = await engine.getProjection(
      sessionId,
      actorId,
    );
    const [
      events,
      outboxRecords,
      dispatchPlans,
      tasks,
      attempts,
      deadLetters,
    ] = await Promise.all([
      engine.getTimeline(sessionId, actorId),
      engine.store.loadOutbox(sessionId),
      taskStore.listDispatchPlans(sessionId),
      taskStore.list(sessionId),
      taskStore.listAttempts(sessionId),
      taskStore.listDeadLetters(sessionId),
    ]);
    const runs = events.flatMap((event) => {
      if (event.eventType !== "agent_run_recorded") return [];
      const parsed = AgentRunTraceSchema.safeParse(event.payload.trace);
      return parsed.success ? [parsed.data] : [];
    });
    const trace = buildSessionTraceProjection({
      sessionId,
      projection,
      events,
      outboxRecords,
      dispatchPlans,
      tasks,
      attempts,
      deadLetters,
      runs,
    });
    return { projection, events, trace };
  };
  const loadAuthorizedSessionTraceContext = async (
    sessionId: string,
    bindingId: string,
    token: string,
  ) => {
    const identity = auth.resolveBinding(token, bindingId, sessionId);
    const context = await loadSessionTraceContextForActor(
      sessionId,
      identity.binding.actorId,
    );
    if (context.projection.actorKind !== "teacher") {
      throw new PermissionDeniedError(
        "只有教师视野可以查看全链路运行调试投影",
      );
    }
    return context;
  };
  const buildAuthorizedSessionTrace = async (
    sessionId: string,
    bindingId: string,
    token: string,
  ) => {
    const context = await loadAuthorizedSessionTraceContext(
      sessionId,
      bindingId,
      token,
    );
    return context.trace;
  };
  const loadAuthorizedEpisodeContext = async ({
    request,
    sessionId,
    bindingId,
  }: {
    request: FastifyRequest;
    sessionId: string;
    bindingId: string;
  }) => {
      const token = requireToken(request.headers.cookie);
      const identity = auth.resolveBinding(token, bindingId, sessionId);
      const administrator = ["operator", "operator-demo"].includes(
        identity.profileId,
      );
      const audience = administrator
        ? "admin" as const
        : identity.binding.actorKind === "student"
          ? "student" as const
          : identity.binding.actorKind === "teacher"
            ? "teacher" as const
            : null;
      if (!audience) {
        throw new PermissionDeniedError(
          "协作 Episode 只向学生、教师或管理员主体开放",
        );
      }
      const courseReleaseRef = trainingSessionCourseReleaseRefs.get(
        sessionId,
      );
      if (!courseReleaseRef) {
        throw new CourseLearningError(
          "version_hash_drift",
          "当前会话没有可验证的 V2 课程发布引用",
          { sessionId },
        );
      }
      const courseRelease = courseLearning.getReleaseByReference(
        courseReleaseRef,
      );
      const [scenario, scenarioRelease] = await Promise.all([
        engine.getScenarioPackage(sessionId),
        engine.getScenarioRelease(sessionId),
      ]);
      const viewingActorId = administrator
        ? scenario.roles.find((role) => role.actorKind === "teacher")?.agentId
          ?? identity.binding.actorId
        : identity.binding.actorId;
      const context = await loadSessionTraceContextForActor(
        sessionId,
        viewingActorId,
      );
      let episodeEvents = context.events;
      let pendingCandidateIds = context.projection.pendingCandidates.map(
        (candidate) => candidate.candidateId,
      );
      if (audience === "student") {
        const teacherActorId = scenario.roles.find((role) => (
          role.actorKind === "teacher"
        ))?.agentId ?? null;
        if (teacherActorId && teacherActorId !== viewingActorId) {
          const teacherContext = await loadSessionTraceContextForActor(
            sessionId,
            teacherActorId,
          );
          const safeGateEvents = teacherContext.events.filter((event) => (
            event.eventType === "candidate_event_proposed"
            || event.eventType === "candidate_event_approved"
            || event.eventType === "candidate_event_rejected"
          ));
          pendingCandidateIds = teacherContext.projection.pendingCandidates.map(
            (candidate) => candidate.candidateId,
          );
          episodeEvents = [...new Map([
            ...context.events,
            ...safeGateEvents,
          ].map((event) => [event.eventId, event])).values()].toSorted(
            (left, right) => left.stateVersion - right.stateVersion,
          );
        }
      }
      return {
        audience,
        projection: {
          sessionId,
          scenarioId: context.projection.scenario.scenarioId,
          stateVersion: context.projection.stateVersion,
          currentNodeId: context.projection.currentNode.nodeId,
          currentSourceEventId:
            context.projection.currentTaskAnchor.sourceEventId,
          scenarioReleaseRef: scenarioRelease.ref,
        },
        courseRelease,
        events: episodeEvents,
        adviceDecisionAvailable: (() => {
          const sequence = deriveAuthoredExperienceSequence({
            scenario,
            nodeId: context.projection.currentNode.nodeId,
            events: episodeEvents,
          });
          return sequence === null || sequence.phase === "advice_decision";
        })(),
        completionCandidateRef: completionCandidateRefOf(
          scenario,
          context.projection.currentNode.nodeId,
        ),
        pendingCandidateIds,
        traceRecords: context.trace.records,
        actorKinds: Object.fromEntries(scenario.roles.map((role) => [
          role.agentId,
          role.actorKind,
        ])),
        modelHealth: modelIntegration.health(),
      };
  };
  await registerAgentCollaborationEpisodeRoutes(app, {
    service: collaborationEpisode,
    loadAuthorizedEpisode: loadAuthorizedEpisodeContext,
    authorizeAdministrator: (request) => {
      const token = requireToken(request.headers.cookie);
      const identity = auth.resolvePrincipal(token);
      if (!["operator", "operator-demo"].includes(identity.profileId)) {
        throw new RoleBindingDeniedError(
          "只有管理员身份可以查看十四智能体运行全景",
        );
      }
    },
  });
  const authorizeSimulationWorldV3 = async ({
    request,
    sessionId,
    bindingId,
    mutation,
    purpose,
  }: {
    request: FastifyRequest;
    sessionId: string;
    bindingId: string;
    mutation: boolean;
    purpose?: "private-note" | "learning-review";
  }) => {
      if (mutation) {
        assertAllowedOrigin(request.headers.origin);
        assertNoClientActorClaim(request.body);
      }
      const token = requireToken(request.headers.cookie);
      if (mutation) {
        auth.assertCsrf(
          token,
          request.headers["x-csrf-token"] as string | undefined,
        );
      }
      const identity = auth.resolveBinding(token, bindingId, sessionId);
      const administrator = ["operator", "operator-demo"].includes(
        identity.profileId,
      );
      if (administrator) {
        return {
          audience: "admin" as const,
          principalId: identity.principal.principalId,
          actorId: identity.binding.actorId,
          bindingId: identity.binding.bindingId,
        };
      }
      if (
        identity.binding.actorKind === "student"
        && identity.binding.roleId === "reporter"
      ) {
        if (mutation && purpose !== "private-note" && purpose !== "learning-review") await studentStudy.assertWritable(studyActorForProfile(identity.profileId), sessionId);
        return {
          audience: "student" as const,
          principalId: identity.principal.principalId,
          actorId: identity.binding.actorId,
          bindingId: identity.binding.bindingId,
        };
      }
      if (identity.binding.actorKind === "teacher") {
        return {
          audience: "teacher" as const,
          principalId: identity.principal.principalId,
          actorId: identity.binding.actorId,
          bindingId: identity.binding.bindingId,
        };
      }
      throw new PermissionDeniedError(
        "旗舰世界只向学生记者、课程教师或管理员开放",
      );
  };
  await registerSessionExperienceDescriptorRoutes(app, {
    descriptors: roots.course.sessionExperienceDescriptors,
    authorize: ({ request, sessionId, bindingId }) => {
      const token = requireToken(request.headers.cookie);
      auth.resolveBinding(token, bindingId, sessionId);
    },
  });
  await registerBusinessOperationRoutes(app, {
    operations: roots.operations.businessOperations,
    authorize: authorizeSimulationWorldV3,
  });
  await registerWorldSimulationV3Routes(app, {
    engine: roots.world.simulationWorld,
    orchestrator: roots.world.collaboration,
    director: roots.world.director,
    work: roots.work.flagshipStudentWork,
    afterWorldSettlement: async (sessionId) => {
      await roots.world.flagshipExperience.onWorldSettled(sessionId);
    },
    assertFieldAction: (input) => roots.world.flagshipExperience.assertFieldAction(input),
    authorize: authorizeSimulationWorldV3,
  });
  await registerFlagshipExperienceV4Routes(app, {
    experience: roots.world.flagshipExperience,
    authorize: authorizeSimulationWorldV3,
  });
  if (roots.world.flagshipExperience.fieldInterview) {
    await registerFieldInterviewRoutes(app, { service: roots.world.flagshipExperience.fieldInterview, authorize: authorizeSimulationWorldV3 });
  }
  await registerStudentNotebookRoutes(app, { notebooks: studentNotebooks, engine: roots.world.simulationWorld, authorize: authorizeSimulationWorldV3 });
  await registerFlagshipMediaV4Routes(app, {
    media: roots.work.flagshipMedia,
    authorize: authorizeSimulationWorldV3,
  });
  await registerFlagshipWorkspaceV3Routes(app, {
    engine: roots.world.simulationWorld,
    work: roots.work.flagshipStudentWork,
    fieldLessons: fieldLessonCatalog,
    planKnowledge: async (courseId, knowledgeIds) => (await (await contentLibraryRuntime.store()).listKnowledge({ courseId, limit: 200 }))
      .filter(record => knowledgeIds.includes(record.knowledgeId) && record.reviewStatus !== "retired")
      .map(record => ({ evidenceRef: record.knowledgeId, kind: "knowledge" as const, label: record.title,
        detail: record.teachingSummary, eventType: null })),
    authorize: authorizeSimulationWorldV3,
  });
  await registerFlagshipRoleViewsV3Routes(app, {
    engine: roots.world.simulationWorld,
    work: roots.work.flagshipStudentWork,
    templates: flagshipAgentTemplatesV3,
    authorize: authorizeSimulationWorldV3,
  });
  await registerFlagshipAssessmentV3Routes(app, {
    assessment: roots.assessment.flagshipV3,
    authorize: authorizeSimulationWorldV3,
  });
  await registerFlagshipAssessmentV4Routes(app, {
    assessment: roots.assessment.flagshipV4,
    authorize: input=>authorizeSimulationWorldV3({...input,purpose:'learning-review'}),
  });
  await registerLearnerAdaptationV4Routes(app, {
    adaptation: roots.adaptation.flagshipV4,
    authorize: input=>authorizeSimulationWorldV3({...input,purpose:'learning-review'}),
  });
  await registerLearnerAdaptationV3Routes(app, {
    adaptation: roots.adaptation.flagshipV3,
    authorize: authorizeSimulationWorldV3,
  });
  await registerAgentAblationRoutes(app, {
    authorizeAdministrator: (request) => {
      const token = requireToken(request.headers.cookie);
      const identity = auth.resolvePrincipal(token);
      if (!["operator", "operator-demo"].includes(identity.profileId)) {
        throw new RoleBindingDeniedError(
          "只有管理员身份可以查看跨课程智能体规则与消融证据",
        );
      }
    },
    readRuleManifest: options.agentRuleManifestReader
      ?? (() => crossCourseAgentRuleManifest),
    readAblationEvidence: options.agentAblationEvidenceReader
      ?? (() => agentAblationEvidence),
  });
  app.post<{
    Params: { sessionId: string; gateId: string };
  }>(
    "/api/sessions/:sessionId/teacher-gates/:gateId/decisions",
    async (request) => {
      assertAllowedOrigin(request.headers.origin);
      assertNoClientActorClaim(request.body);
      const params = teacherGateDecisionParamsSchema.parse(request.params);
      emptyStrictQuerySchema.parse(request.query);
      const input = teacherGateDecisionBodySchema.parse(request.body);
      const token = requireToken(request.headers.cookie);
      auth.assertCsrf(
        token,
        request.headers["x-csrf-token"] as string | undefined,
      );
      const identity = await requireSessionTeacher(
        token,
        input.bindingId,
        params.sessionId,
      );
      const episodeContext = await loadAuthorizedEpisodeContext({
        request,
        sessionId: params.sessionId,
        bindingId: input.bindingId,
      });
      const episode = collaborationEpisode.build(episodeContext);
      if (
        episode.audience !== "teacher"
        || episode.status !== "awaiting_gate"
        || episode.teacherGate?.status !== "pending"
        || episode.teacherGate.gateId !== params.gateId
      ) {
        throw new InvalidWorldActionError(
          "当前权威协作 Episode 没有可处理的教师门",
        );
      }
      if (episode.stateVersion !== input.expectedStateVersion) {
        throw new StateVersionConflictError(
          input.expectedStateVersion,
          episode.stateVersion,
        );
      }
      const chapter = episodeContext.courseRelease.chapters.find(
        (candidate) => (
          candidate.chapterId === episodeContext.projection.currentNodeId
        ),
      );
      const trigger = episode.triggerEvent
        ? episodeContext.events.find((event) => (
            event.eventId === episode.triggerEvent!.eventId
          ))
        : null;
      if (!chapter || !trigger) {
        throw new InvalidWorldActionError(
          "当前教师门缺少冻结章节或业务触发引用",
        );
      }
      const teacherProjection = await engine.getProjection(
        params.sessionId,
        identity.binding.actorId,
      );
      const candidate = findPendingTeacherGateCandidate({
        events: episodeContext.events,
        chapter,
        trigger,
        completionCandidateRef: episodeContext.completionCandidateRef ?? null,
        pendingCandidateIds: new Set(
          teacherProjection.pendingCandidates.map((item) => item.candidateId),
        ),
      });
      if (!candidate) {
        throw new InvalidWorldActionError(
          "当前教师门没有命中冻结章节的待审候选",
        );
      }
      const scenario = await engine.getScenarioPackage(params.sessionId);
      const meta = createMessageMeta({
        sessionId: params.sessionId,
        sceneId: scenario.scenarioId,
        actorId: identity.binding.actorId,
      });
      const commandName = input.decision === "approve"
        ? "approve_candidate_event" as const
        : "reject_candidate_event" as const;
      const commandPayload = input.decision === "approve"
        ? { candidateId: candidate.candidateId, reason: input.reason }
        : {
            candidateId: candidate.candidateId,
            reason: input.decision === "request_evidence"
              ? `退回补证：${input.reason}`
              : input.reason,
          };
      const projection = await orchestrator.runSessionOperation(
        params.sessionId,
        async () => {
          const current = await engine.getProjection(
            params.sessionId,
            identity.binding.actorId,
          );
          if (current.stateVersion !== input.expectedStateVersion) {
            throw new StateVersionConflictError(
              input.expectedStateVersion,
              current.stateVersion,
            );
          }
          const command: Command = {
            ...meta,
            kind: "Command",
            name: commandName,
            expectedStateVersion: input.expectedStateVersion,
            payload: commandPayload,
          };
          const actionId = meta.messageId;
          const envelope: ActionEnvelope = {
            kind: "ActionEnvelope",
            envelopeVersion: ActionEnvelopeSchemaVersion,
            actionId,
            idempotencyKey: [
              "teacher-gate",
              candidate.candidateId,
              input.decision,
              input.expectedStateVersion,
            ].join(":"),
            payloadHash: hashValue(command.payload),
            source: {
              mode: "course_platform",
              assertion: "client_declared",
              surfaceId: "teacher-v2-director",
              interactionId: params.gateId,
            },
            actor: {
              principalId: identity.principal.principalId,
              bindingId: identity.binding.bindingId,
              actorId: current.role.agentId,
              actorKind: current.role.actorKind,
              roleId: current.role.roleId,
              teamId: current.role.teamId,
              sessionEpoch: current.sessionEpoch,
            },
            objectRefs: [
              {
                objectType: "world_state",
                objectId: params.sessionId,
                version: String(input.expectedStateVersion),
              },
              {
                objectType: "candidate_event",
                objectId: candidate.candidateId,
                version: String(input.expectedStateVersion),
              },
            ],
            causality: {
              rootActionId: actionId,
              causationId: params.gateId,
              parentActionId: null,
              causationEventIds: [trigger.eventId],
              causalDepth: 0,
            },
            evidence: {
              evidenceRefs: candidate.evidenceRefs,
              citationRefs: [],
              toolResultRefs: [],
            },
            command,
          };
          return engine.executeAction(envelope);
        },
      );
      return teacherGateMutationReceiptSchema.parse({
        schemaVersion: "teacher-gate-mutation-receipt/2.0.0",
        accepted: true,
        sessionId: params.sessionId,
        stateVersion: projection.stateVersion,
        gateId: params.gateId,
        decision: input.decision,
      });
    },
  );
  await registerStrategyReuseRoutes(app, {
    service: strategyReuse,
    loadAuthorizedContext: async ({
      request,
      sessionId,
      bindingId,
    }) => {
      const token = requireToken(request.headers.cookie);
      const identity = auth.resolveBinding(token, bindingId, sessionId);
      const [studentContext, scenario] = await Promise.all([
        loadSessionTraceContextForActor(
          sessionId,
          identity.binding.actorId,
        ),
        engine.getScenarioPackage(sessionId),
      ]);
      if (studentContext.projection.actorKind !== "student") {
        throw new PermissionDeniedError(
          "只有当前学生岗位可以查看策略复用解释",
        );
      }
      const teacherRole = scenario.roles.find((role) => (
        role.actorKind === "teacher"
      ));
      if (!teacherRole) {
        throw new Error("情境缺少教师角色契约");
      }
      const internalReplayContext = await loadSessionTraceContextForActor(
        sessionId,
        teacherRole.agentId,
      );
      const replay = buildCollaborationReplay(internalReplayContext);
      return {
        replay,
        expectedStrategyRef:
          scenario.collaborationConfig?.strategyRef
          ?? strategyReuseReference,
      };
    },
  });
  const captureSessionRecoveryIntegrity = async (sessionId: string) => {
    const [session, scenario, publishedRelease] = await Promise.all([
      sessionControl.getSession(sessionId),
      engine.getScenarioPackage(sessionId),
      engine.getScenarioRelease(sessionId),
    ]);
    if (!session) {
      throw new SessionControlError(
        "not_found",
        "恢复检查点找不到训练会话控制记录",
        { sessionId },
      );
    }
    const teacherRole = scenario.roles.find((role) => (
      role.actorKind === "teacher"
    ));
    if (!teacherRole) {
      throw new SessionControlError(
        "checkpoint_invalid",
        "情境没有可用于恢复核验的教师角色",
        { sessionId },
      );
    }
    const [
      projection,
      journal,
      tasks,
      attempts,
      deadLetters,
      mediaWorkItems,
      mediaAttempts,
      roleMemoryDeltas,
    ] = await Promise.all([
      engine.getProjection(sessionId, teacherRole.agentId),
      engine.store.loadJournalSnapshot(sessionId),
      taskStore.list(sessionId),
      taskStore.listAttempts(sessionId),
      taskStore.listDeadLetters(sessionId),
      mediaWorkStore.list(sessionId),
      mediaWorkStore.listAttempts(sessionId),
      roleMemoryStore.load(sessionId),
    ]);
    const roleMemoryIntegrity = buildRoleMemoryIntegrityManifest(
      sessionId,
      roleMemoryDeltas,
    );
    const referencedObjectIntegrity = await inspectReferencedObjectIntegrity({
      objectStore,
      sessionId,
      sourceRefs: collectRecoveryObjectSourceRefs({
        scenario,
        projection,
        mediaWorkItems,
        events: journal.events,
      }),
    });
    const runs = journal.events.flatMap((event) => {
      if (event.eventType !== "agent_run_recorded") return [];
      const parsed = AgentRunTraceSchema.safeParse(event.payload.trace);
      return parsed.success ? [parsed.data] : [];
    });
    const trace = buildSessionTraceProjection({
      sessionId,
      generatedAt: "1970-01-01T00:00:00.000Z",
      projection,
      events: journal.events,
      outboxRecords: journal.outbox,
      tasks,
      attempts,
      deadLetters,
      runs,
    });
    return buildSessionRecoveryIntegrityPayload({
      session,
      scenarioRelease: publishedRelease.ref,
      projection,
      events: journal.events,
      outboxRecords: journal.outbox,
      tasks,
      attempts,
      deadLetters,
      mediaWorkItems,
      mediaAttempts,
      trace,
      roleMemoryIntegrity,
      referencedObjectIntegrity,
    });
  };
  const recoveryCheckpointCatalog = options.recoveryCheckpointCatalog
    !== undefined
    ? options.recoveryCheckpointCatalog
    : (
      dataDirectoryLease
        ? new LocalRecoveryCheckpointCatalog(
            resolve(dataDir, "recovery-checkpoints"),
          )
        : null
    );
  const recoveryCheckpointCoordinator = recoveryCheckpointCatalog
    ? new SessionRecoveryCheckpointCoordinator({
        catalog: recoveryCheckpointCatalog,
        capture: captureSessionRecoveryIntegrity,
      })
    : null;

  app.get("/health", async () => ({
    status: "ok",
    service: "ronggang-api",
    version: ProductVersion,
  }));

  app.get("/api/operations/health", async (request) => {
    const input = sessionListQuerySchema.parse(request.query);
    const token = requireToken(request.headers.cookie);
    const identity = requireTeacherAuthor(
      token,
      input.bindingId,
      input.authorizationSessionId,
    );
    requireAdministrator(identity);
    const sessions = await sessionControl.listSessions({
      principalId: identity.principal.principalId,
    });
    const snapshot = await buildOperationsHealthSnapshot({
      eventStore: engine.store,
      agentTaskStore: taskStore,
      mediaProcessingWorkStore: mediaWorkStore,
      sessionControlStore: sessionControl,
      ...(recoveryCheckpointCoordinator
        ? {
            getRecoveryCheckpointHealth: (visibleSessionIds: readonly string[]) => (
              recoveryCheckpointCoordinator.summarize(visibleSessionIds)
            ),
          }
        : {}),
    }, {
      generatedAt: new Date().toISOString(),
      productVersion: ProductVersion,
      visibleSessionIds: sessions.map((session) => session.sessionId),
    });
    return OperationsHealthSnapshotSchema.parse({
      schemaVersion: OperationsHealthSchemaVersion,
      ...snapshot,
    });
  });

  app.get<{ Params: { sessionId: string } }>(
    "/api/training-sessions/:sessionId/recovery-checkpoint",
    async (request) => {
      const input = scenarioAuthorQuerySchema.parse(request.query);
      const token = requireToken(request.headers.cookie);
      const identity = requireTeacherAuthor(
        token,
        input.bindingId,
        input.authorizationSessionId,
      );
      const session = await sessionControl.getSession(request.params.sessionId);
      if (!session) {
        throw new SessionControlError("not_found", "训练会话不存在", {
          sessionId: request.params.sessionId,
        });
      }
      await assertTeacherScope({
        control: sessionControl,
        principalId: identity.principal.principalId,
        classroomId: session.classroomId,
        teamId: session.teamId,
      });
      if (!recoveryCheckpointCoordinator) {
        throw new SessionControlError(
          "checkpoint_io_error",
          "当前运行模式没有启用恢复检查点目录",
          { sessionId: session.sessionId },
        );
      }
      return RecoveryCheckpointObservationSchema.parse({
        schemaVersion: RecoveryCheckpointSchemaVersion,
        ...await recoveryCheckpointCoordinator.inspect(session.sessionId),
      });
    },
  );

  app.post<{ Params: { sessionId: string } }>(
    "/api/training-sessions/:sessionId/recovery-checkpoint",
    async (request) => {
      assertAllowedOrigin(request.headers.origin);
      assertNoClientActorClaim(request.body);
      const input = scenarioAuthorBodySchema.parse(request.body);
      const token = requireToken(request.headers.cookie);
      auth.assertCsrf(token, request.headers["x-csrf-token"] as string | undefined);
      const identity = requireTeacherAuthor(
        token,
        input.bindingId,
        input.authorizationSessionId,
      );
      const session = await sessionControl.getSession(request.params.sessionId);
      if (!session) {
        throw new SessionControlError("not_found", "训练会话不存在", {
          sessionId: request.params.sessionId,
        });
      }
      await assertTeacherScope({
        control: sessionControl,
        principalId: identity.principal.principalId,
        classroomId: session.classroomId,
        teamId: session.teamId,
      });
      if (!recoveryCheckpointCoordinator) {
        throw new SessionControlError(
          "checkpoint_io_error",
          "当前运行模式没有启用恢复检查点目录",
          { sessionId: session.sessionId },
        );
      }
      return RecoveryCheckpointObservationSchema.parse({
        schemaVersion: RecoveryCheckpointSchemaVersion,
        ...await recoveryCheckpointCoordinator.record(session.sessionId),
      });
    },
  );

  app.get("/api/auth/demo-profiles", async () => ({
    profiles: await Promise.all(demoProfileDefinitions.map(async (profile) => {
      const authorizedSessions = await sessionControl.listSessions({
        principalId: profile.principalId,
        statuses: ["active", "paused"],
      });
      return {
        profileId: profile.profileId,
        displayName: profile.displayName,
        defaultSessionId: profile.defaultSessionId,
        authorizedSessionIds: authorizedSessions.map((session) => session.sessionId),
        classroomId: profile.classroomId,
        teamId: profile.teamId,
        role: profile.role,
      };
    })),
  }));

  app.post("/api/auth/demo-course-claim", async (request) => {
    assertAllowedOrigin(request.headers.origin);
    assertNoClientActorClaim(request.body);
    const input = demoCourseClaimBodySchema.parse(request.body);
    const profile = getDemoProfile(input.profileId);
    if (profile.role !== "student" || profile.defaultSessionId !== null) {
      throw new RoleBindingDeniedError("当前演示身份不支持自主认领课程");
    }
    const session = await sessionControl.getSession(input.sessionId);
    if (!session || !["active", "paused"].includes(session.status)) {
      throw new RoleBindingDeniedError("目标课程尚未开放认领");
    }
    if (
      session.classroomId !== profile.classroomId
      || session.teamId !== profile.teamId
    ) {
      throw new RoleBindingDeniedError("目标课程不属于当前学生班级与小组");
    }
    const scenario = await engine.getScenarioPackage(session.sessionId);
    const studentRoles = scenario.roles.filter((role) => (
      role.actorKind === "student"
      && ["responsible_editor", "reporter"].includes(role.roleId)
    ));
    if (studentRoles.length === 0) {
      throw new RoleBindingDeniedError("目标课程没有可认领的学生岗位");
    }
    const now = new Date().toISOString();
    const memberships: SessionMembership[] = studentRoles.map((role) => ({
      membershipId: [
        "membership",
        profile.profileId,
        session.sessionId,
        role.agentId,
      ].join("-"),
      principalId: profile.principalId,
      classroomId: profile.classroomId,
      teamId: profile.teamId,
      sessionId: session.sessionId,
      role: "student",
      actorId: role.agentId,
      status: "active",
      createdAt: now,
      updatedAt: now,
      revokedAt: null,
    }));
    for (const membership of memberships) {
      if (!await sessionControl.getMembership(membership.membershipId)) {
        await sessionControl.putMembership(membership);
      }
    }
    return {
      status: "claimed",
      profileId: profile.profileId,
      sessionId: session.sessionId,
      roleCount: memberships.length,
    };
  });

  const profileMemberships = async (profile:ReturnType<typeof getDemoProfile>,sessionId:string):Promise<MembershipRoleAssignment[]> => {
    const session = await sessionControl.getSession(sessionId);
    if (!session || !["active", "paused"].includes(session.status)) {
      throw new RoleBindingDeniedError("目标训练会话尚未激活或不存在");
    }
    let memberships: MembershipRoleAssignment[];
    try {
      const scenario = await engine.getScenarioPackage(sessionId);
      memberships = await materializeProfileAssignments({
        control: sessionControl,
        profile,
        session,
        roles: scenario.roles,
      });
    } catch (error) {
      if (!(error instanceof SessionNotFoundError)) throw error;
      try {
        await worldSimulationV3.getRecord(sessionId);
      } catch {
        throw error;
      }
      const adaptiveMemberships = await sessionControl.listMemberships({
        principalId: profile.principalId,
        classroomId: session.classroomId,
        statuses: ["active"],
      });
      memberships = adaptiveMemberships.flatMap<MembershipRoleAssignment>((membership) => {
        if (membership.role === "student"
          && membership.sessionId === sessionId
          && membership.teamId === session.teamId) {
          return [{
            membershipId: membership.membershipId,
            principalId: membership.principalId,
            sessionId,
            actorId: membership.actorId,
            actorKind: "student" as const,
            roleId: "reporter" as const,
            status: "active" as const,
          }];
        }
        if (membership.role === "teacher"
          && (membership.sessionId === null || membership.sessionId === sessionId)
          && (membership.teamId === null || membership.teamId === session.teamId)) {
          return [{
            membershipId: membership.membershipId,
            principalId: membership.principalId,
            sessionId,
            actorId: membership.actorId,
            actorKind: "teacher" as const,
            roleId: "teacher" as const,
            status: "active" as const,
          }];
        }
        return [];
      });
      if (memberships.length === 0) {
        throw new RoleBindingDeniedError("该身份不是目标第二场的有效成员");
      }
    }
    return memberships;
  };
  const issueProfileLogin = async (profileId:string,sessionId:string|null) => {
    const profile=getDemoProfile(profileId);
    return sessionId===null?auth.issuePrincipalSession(profile):auth.issueMembershipSession(profile,await profileMemberships(profile,sessionId));
  };
  app.get('/api/auth/demo-accounts',async()=>({accounts:demoLoginAccounts()}));
  app.post('/api/auth/login',async(request,reply)=>{
    assertAllowedOrigin(request.headers.origin);
    const input=DemoLoginRequestSchema.parse(request.body);
    const account=demoLoginAccounts().find(item=>item.username===input.username.toLowerCase()&&item.password===input.password&&item.role===input.role);
    if(!account)throw new AuthenticationRequiredError('账号、密码或登录身份不正确');
    const profile=getDemoProfile(account.profileId);
    const issued=await issueProfileLogin(profile.profileId,profile.role==='student'?null:profile.defaultSessionId);
    reply.header('Set-Cookie',auth.cookieHeader(issued.token,secureCookies));
    reply.header('Cache-Control','no-store');
    return issued.context;
  });
  app.get('/api/auth/session',async(request,reply)=>{
    reply.header('Cache-Control','no-store');
    return auth.context(requireToken(request.headers.cookie));
  });
  app.post('/api/auth/session-context',async(request,reply)=>{
    assertAllowedOrigin(request.headers.origin);
    const token=requireToken(request.headers.cookie);
    auth.assertCsrf(token,request.headers['x-csrf-token'] as string|undefined);
    const input=z.object({sessionId:z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/u)}).strict().parse(request.body);
    const current=auth.resolvePrincipal(token);
    const memberships=await profileMemberships(getDemoProfile(current.profileId),input.sessionId);
    auth.addMembershipBindings(token,memberships);
    reply.header('Cache-Control','no-store');
    return auth.context(token);
  });
  // Retained for internal engineering fixtures. The public UI uses credential
  // login and restores only the identity held by its HttpOnly session cookie.
  app.post("/api/auth/demo-session", async (request, reply) => {
    assertAllowedOrigin(request.headers.origin);
    assertNoClientActorClaim(request.body);
    const input = demoSessionBodySchema.parse(request.body ?? {});
    const profile = getDemoProfile(input.profileId ?? "operator-demo");
    const issued=await issueProfileLogin(profile.profileId,input.sessionId??profile.defaultSessionId);
    reply.header("Set-Cookie", auth.cookieHeader(issued.token, secureCookies));
    return issued.context;
  });

  app.post("/api/auth/logout", async (request, reply) => {
    assertAllowedOrigin(request.headers.origin);
    const token = requireToken(request.headers.cookie);
    auth.assertCsrf(token, request.headers["x-csrf-token"] as string | undefined);
    auth.revoke(token);
    reply.header("Set-Cookie", auth.clearCookieHeader(secureCookies));
    return { status: "logged_out" };
  });

  app.get("/api/training-sessions", async (request) => {
    const input = sessionListQuerySchema.parse(request.query);
    const token = requireToken(request.headers.cookie);
    const identity = auth.resolveBinding(
      token,
      input.bindingId,
      input.authorizationSessionId,
    );
    const sessions = await sessionControl.listSessions({
      principalId: identity.principal.principalId,
    });
    const classroomIds = new Set(sessions.map((session) => session.classroomId));
    const teamIds = new Set(sessions.map((session) => session.teamId));
    const classrooms = (await sessionControl.listClassrooms())
      .filter((classroom) => classroomIds.has(classroom.classroomId))
      .map(({ createdAt: _createdAt, updatedAt: _updatedAt, ...classroom }) => classroom);
    const teams = (await sessionControl.listTeams())
      .filter((team) => teamIds.has(team.teamId))
      .map(({ createdAt: _createdAt, updatedAt: _updatedAt, ...team }) => team);
    return SessionControlOverviewSchema.parse({
      schemaVersion: SessionControlSchemaVersion,
      classrooms,
      teams,
      sessions: sessions.map(sessionSummary),
    });
  });

  app.get<{ Params: { sessionId: string } }>("/api/training-sessions/:sessionId", async (request) => {
    const input = sessionListQuerySchema.parse(request.query);
    const token = requireToken(request.headers.cookie);
    const identity = auth.resolveBinding(
      token,
      input.bindingId,
      input.authorizationSessionId,
    );
    const visible = await sessionControl.listSessions({
      principalId: identity.principal.principalId,
    });
    const session = visible.find((candidate) => (
      candidate.sessionId === request.params.sessionId
    ));
    if (!session) {
      throw new RoleBindingDeniedError("当前成员无权读取目标训练会话");
    }
    return { session: sessionSummary(session) };
  });

  app.get("/api/scenario/demo", async () => ({
    scenario: engine.scenario,
    release: seedRelease.ref,
    demoSessionId: DEMO_SESSION_ID,
    mode: "multi-role-single-session",
  }));

  app.get("/api/scenario-packages", async (request) => {
    const input = scenarioAuthorQuerySchema.parse(request.query);
    const token = requireToken(request.headers.cookie);
    requireTeacherAuthor(token, input.bindingId, input.authorizationSessionId);
    return scenarioCatalog.list();
  });

  app.get<{ Params: { draftId: string } }>("/api/scenario-drafts/:draftId", async (request) => {
    const input = scenarioAuthorQuerySchema.parse(request.query);
    const token = requireToken(request.headers.cookie);
    requireTeacherAuthor(token, input.bindingId, input.authorizationSessionId);
    return { draft: scenarioCatalog.getDraft(request.params.draftId) };
  });

  app.post<{ Params: { releaseId: string } }>("/api/scenario-releases/:releaseId/copies", async (request) => {
    assertAllowedOrigin(request.headers.origin);
    assertNoClientActorClaim(request.body);
    const input = scenarioAuthorBodySchema.parse(request.body);
    const token = requireToken(request.headers.cookie);
    auth.assertCsrf(token, request.headers["x-csrf-token"] as string | undefined);
    const identity = requireTeacherAuthor(token, input.bindingId, input.authorizationSessionId);
    return {
      draft: await scenarioCatalog.copyRelease({
        releaseId: request.params.releaseId,
        actorId: identity.binding.actorId,
      }),
    };
  });

  app.patch<{ Params: { draftId: string } }>("/api/scenario-drafts/:draftId", async (request) => {
    assertAllowedOrigin(request.headers.origin);
    assertNoClientActorClaim(request.body);
    const input = scenarioDraftUpdateSchema.parse(request.body);
    const token = requireToken(request.headers.cookie);
    auth.assertCsrf(token, request.headers["x-csrf-token"] as string | undefined);
    const identity = requireTeacherAuthor(token, input.bindingId, input.authorizationSessionId);
    return {
      draft: await scenarioCatalog.updateDraft({
        draftId: request.params.draftId,
        expectedRevision: input.expectedRevision,
        actorId: identity.binding.actorId,
        patch: {
          ...(input.patch.version !== undefined ? { version: input.patch.version } : {}),
          ...(input.patch.title !== undefined ? { title: input.patch.title } : {}),
          ...(input.patch.description !== undefined ? { description: input.patch.description } : {}),
          ...(input.patch.roles !== undefined ? { roles: input.patch.roles } : {}),
          ...(input.patch.approvalPolicies !== undefined
            ? { approvalPolicies: input.patch.approvalPolicies }
            : {}),
          ...(input.patch.directorConfig !== undefined
            ? { directorConfig: input.patch.directorConfig }
            : {}),
          ...(input.patch.collaborationConfig !== undefined
            ? { collaborationConfig: input.patch.collaborationConfig }
            : {}),
        },
      }),
    };
  });

  app.post<{ Params: { draftId: string } }>("/api/scenario-drafts/:draftId/validate", async (request) => {
    assertAllowedOrigin(request.headers.origin);
    assertNoClientActorClaim(request.body);
    const input = scenarioDraftActionSchema.parse(request.body);
    const token = requireToken(request.headers.cookie);
    auth.assertCsrf(token, request.headers["x-csrf-token"] as string | undefined);
    requireTeacherAuthor(token, input.bindingId, input.authorizationSessionId);
    const collaborationStrategySnapshot =
      await collaborationStrategy.list();
    return {
      report: await scenarioCatalog.validateDraft({
        draftId: request.params.draftId,
        expectedRevision: input.expectedRevision,
        collaborationStrategySnapshot,
      }),
    };
  });

  app.post<{ Params: { draftId: string } }>("/api/scenario-drafts/:draftId/preview", async (request) => {
    assertAllowedOrigin(request.headers.origin);
    assertNoClientActorClaim(request.body);
    const input = scenarioDraftActionSchema.parse(request.body);
    const token = requireToken(request.headers.cookie);
    auth.assertCsrf(token, request.headers["x-csrf-token"] as string | undefined);
    requireTeacherAuthor(token, input.bindingId, input.authorizationSessionId);
    const collaborationStrategySnapshot =
      await collaborationStrategy.list();
    return {
      preview: scenarioCatalog.previewDraft({
        draftId: request.params.draftId,
        expectedRevision: input.expectedRevision,
        collaborationStrategySnapshot,
      }),
    };
  });

  app.post<{ Params: { draftId: string } }>("/api/scenario-drafts/:draftId/publish", async (request) => {
    assertAllowedOrigin(request.headers.origin);
    assertNoClientActorClaim(request.body);
    const input = scenarioPublishSchema.parse(request.body);
    const token = requireToken(request.headers.cookie);
    auth.assertCsrf(token, request.headers["x-csrf-token"] as string | undefined);
    const identity = requireTeacherAuthor(token, input.bindingId, input.authorizationSessionId);
    const collaborationStrategySnapshot =
      await collaborationStrategy.list();
    const release = await scenarioCatalog.publishDraft({
      draftId: request.params.draftId,
      expectedRevision: input.expectedRevision,
      validationStamp: input.validationStamp,
      actorId: identity.binding.actorId,
      collaborationStrategySnapshot,
    });
    engine.registerScenarioRelease(release);
    return { release };
  });

  app.post("/api/training-sessions", async (request, reply) => {
    assertAllowedOrigin(request.headers.origin);
    assertNoClientActorClaim(request.body);
    const input = sessionStartSchema.parse(request.body);
    const token = requireToken(request.headers.cookie);
    auth.assertCsrf(token, request.headers["x-csrf-token"] as string | undefined);
    const identity = requireTeacherAuthor(
      token,
      input.bindingId,
      input.authorizationSessionId,
    );
    await assertTeacherScope({
      control: sessionControl,
      principalId: identity.principal.principalId,
      classroomId: input.classroomId,
      teamId: input.teamId,
    });
    const release = scenarioCatalog.getRelease(input.releaseId);
    const sessionId = deterministicTrainingSessionId(
      identity.principal.principalId,
      input.requestId,
    );
    const courseReleaseRef = input.courseReleaseRef ?? null;
    if (courseReleaseRef) {
      resolveCourseLaunchReporter(courseReleaseRef, input.releaseId);
      const existingLaunch = courseLearning.getLaunch(
        courseReleaseRef.releaseId,
      );
      if (existingLaunch && existingLaunch.sessionId !== sessionId) {
        throw new CourseLearningError(
          "enrollment_conflict",
          "同一课程发布版已绑定另一训练会话",
          { existing: existingLaunch, requestedSessionId: sessionId },
        );
      }
    }
    engine.registerScenarioRelease(release);
    const existing = await sessionControl.getSession(sessionId);
    const hasRecordedCourseRef = trainingSessionCourseReleaseRefs.has(
      sessionId,
    );
    const recordedCourseRef = trainingSessionCourseReleaseRefs.get(
      sessionId,
    ) ?? null;
    if (
      hasRecordedCourseRef
      && !sameCourseReleaseRef(recordedCourseRef, courseReleaseRef)
    ) {
      throw new SessionControlError(
        "idempotency_conflict",
        "同一 requestId 已用于不同的课程发布引用",
        { sessionId },
      );
    }
    if (existing && !hasRecordedCourseRef && courseReleaseRef !== null) {
      throw new SessionControlError(
        "idempotency_conflict",
        "既有训练会话缺少可验证的课程发布引用",
        { sessionId },
      );
    }
    if (
      existing
      && (
        existing.classroomId !== input.classroomId
        || existing.teamId !== input.teamId
        || existing.releaseId !== input.releaseId
        || existing.requestedBy !== identity.principal.principalId
      )
    ) {
      throw new SessionControlError(
        "idempotency_conflict",
        "同一 requestId 已用于不同的训练会话参数",
        { sessionId },
      );
    }
    let record = existing ?? await ensureControlSession({
      sessionId,
      classroomId: input.classroomId,
      teamId: input.teamId,
      releaseId: input.releaseId,
      requestedBy: identity.principal.principalId,
      requestId: `${identity.principal.principalId}:${input.requestId}`,
    });
    if (!hasRecordedCourseRef) {
      trainingSessionCourseReleaseRefs.set(sessionId, courseReleaseRef);
    }
    if (record.status === "recovery_failed") {
      return reply.status(409).send({
        sessionId,
        status: record.status,
        session: sessionSummary(record),
        courseReleaseRef,
        recoverUrl: `/api/training-sessions/${sessionId}/recover`,
      });
    }
    try {
      record = await activateTrainingSession(record);
      if (sameCourseReleaseRef(courseReleaseRef, xunpuPublishedCourseReleaseRef)) {
        await ensureFlagshipV4RuntimeSession(sessionId, record.createdAt);
      }
      await ensureSessionExperienceDescriptor({
        sessionId,
        frozenAt: record.createdAt,
        compatibility: "current",
      });
    } catch (error) {
      const failed = await transitionToRecoveryFailed(record, error);
      return reply.status(503).send({
        sessionId,
        status: failed.status,
        session: sessionSummary(failed),
        courseReleaseRef,
        recoveryErrorCode: failed.lastRecoveryErrorCode,
        recoverUrl: `/api/training-sessions/${sessionId}/recover`,
      });
    }
    registerCourseLaunchForSession(
      sessionId,
      input.releaseId,
      courseReleaseRef,
    );
    const profile = demoProfileDefinitions.find((candidate) => (
      candidate.principalId === identity.principal.principalId
    ));
    if (!profile) {
      throw new RoleBindingDeniedError("当前本地身份不在演示成员目录中");
    }
    const memberships = await materializeProfileAssignments({
      control: sessionControl,
      profile,
      session: record,
      roles: release.package.roles,
    });
    const bindings = auth.addMembershipBindings(token, memberships);
    const projectionActor = bindings.find((binding) => binding.actorKind === "teacher")
      ?? bindings[0];
    if (!projectionActor) {
      throw new RoleBindingDeniedError("新会话没有可用的岗位绑定");
    }
    const projection = await engine.getProjection(sessionId, projectionActor.actorId);
    return {
      sessionId,
      status: record.status,
      session: sessionSummary(record),
      release: release.ref,
      courseReleaseRef,
      bindings,
      projection,
    };
  });

  app.post<{ Params: { sessionId: string } }>(
    "/api/training-sessions/:sessionId/recover",
    async (request, reply) => {
      assertAllowedOrigin(request.headers.origin);
      assertNoClientActorClaim(request.body);
      const input = sessionRecoverSchema.parse(request.body);
      const token = requireToken(request.headers.cookie);
      auth.assertCsrf(token, request.headers["x-csrf-token"] as string | undefined);
      const identity = requireTeacherAuthor(
        token,
        input.bindingId,
        input.authorizationSessionId,
      );
      let record = await sessionControl.getSession(request.params.sessionId);
      if (!record) {
        throw new SessionControlError("not_found", "训练会话不存在", {
          sessionId: request.params.sessionId,
        });
      }
      const courseReleaseRef = trainingSessionCourseReleaseRefs.get(
        record.sessionId,
      ) ?? null;
      await assertTeacherScope({
        control: sessionControl,
        principalId: identity.principal.principalId,
        classroomId: record.classroomId,
        teamId: record.teamId,
      });
      if (record.status === "completed") {
        throw new SessionControlError(
          "invalid_status_transition",
          "已完成会话不能重新激活",
          { sessionId: record.sessionId },
        );
      }
      if (record.status === "recovery_failed") {
        record = await sessionControl.transitionSessionStatus({
          sessionId: record.sessionId,
          expectedStatus: record.status,
          expectedStatusVersion: record.statusVersion,
          nextStatus: "provisioning",
          updatedAt: new Date().toISOString(),
        });
      }
      try {
        record = await activateTrainingSession(record);
        if (sameCourseReleaseRef(courseReleaseRef, xunpuPublishedCourseReleaseRef)) {
          await ensureFlagshipV4RuntimeSession(record.sessionId, record.createdAt);
        }
        await ensureSessionExperienceDescriptor({
          sessionId: record.sessionId,
          frozenAt: record.createdAt,
          compatibility: "current",
        });
      } catch (error) {
        const failed = await transitionToRecoveryFailed(record, error);
        return reply.status(503).send({
          sessionId: failed.sessionId,
          status: failed.status,
          session: sessionSummary(failed),
          courseReleaseRef,
          recoveryErrorCode: failed.lastRecoveryErrorCode,
        });
      }
      const release = scenarioCatalog.getRelease(record.releaseId);
      registerCourseLaunchForSession(
        record.sessionId,
        record.releaseId,
        courseReleaseRef,
      );
      const profile = demoProfileDefinitions.find((candidate) => (
        candidate.principalId === identity.principal.principalId
      ));
      if (!profile) {
        throw new RoleBindingDeniedError("当前本地身份不在演示成员目录中");
      }
      const memberships = await materializeProfileAssignments({
        control: sessionControl,
        profile,
        session: record,
        roles: release.package.roles,
      });
      const bindings = auth.addMembershipBindings(token, memberships);
      return {
        sessionId: record.sessionId,
        status: record.status,
        session: sessionSummary(record),
        courseReleaseRef,
        bindings,
      };
    },
  );

  app.post("/api/sessions/demo/reset", async (request) => {
    assertAllowedOrigin(request.headers.origin);
    assertNoClientActorClaim(request.body);
    const input = resetBodySchema.parse(request.body);
    const token = requireToken(request.headers.cookie);
    auth.assertCsrf(token, request.headers["x-csrf-token"] as string | undefined);
    const identity = auth.resolveBinding(token, input.bindingId, DEMO_SESSION_ID);
    if (identity.binding.actorKind !== "teacher") {
      throw new RoleBindingDeniedError("只有教师岗位绑定可以重置演示情境");
    }
    await mediaOrchestrator.pauseSession(DEMO_SESSION_ID);
    try {
      const initialProjection = await orchestrator.resetSession(
        DEMO_SESSION_ID,
        async () => {
          await mediaOrchestrator.resetSessionWork(DEMO_SESSION_ID);
          return initializeWorld(DEMO_SESSION_ID, true);
        },
      );
      await orchestrator.drainUntilIdle(DEMO_SESSION_ID);
      return engine.getProjection(
        DEMO_SESSION_ID,
        initialProjection.role.agentId,
      );
    } finally {
      mediaOrchestrator.resumeSession(DEMO_SESSION_ID);
    }
  });

  app.get<{ Params: { sessionId: string } }>("/api/sessions/:sessionId/projection", async (request) => {
    const { bindingId } = bindingQuerySchema.parse(request.query);
    const token = requireToken(request.headers.cookie);
    const identity = auth.resolveBinding(token, bindingId, request.params.sessionId);
    if (
      isV2CourseSession(request.params.sessionId)
      && !["operator", "operator-demo"].includes(identity.profileId)
    ) {
      throw new PermissionDeniedError(
        "V2 课程会话只向普通角色提供最小化业务投影",
      );
    }
    return engine.getProjection(request.params.sessionId, identity.binding.actorId);
  });

  app.get<{ Params: { sessionId: string } }>(
    "/api/sessions/:sessionId/agent-contributions",
    async (request) => {
      const { bindingId } = bindingQuerySchema.parse(request.query);
      const token = requireToken(request.headers.cookie);
      const identity = auth.resolveBinding(
        token,
        bindingId,
        request.params.sessionId,
      );
      const [projection, timeline] = await Promise.all([
        engine.getProjection(
          request.params.sessionId,
          identity.binding.actorId,
        ),
        engine.getTimeline(
          request.params.sessionId,
          identity.binding.actorId,
        ),
      ]);
      const decidedProposalIds = new Set<string>();
      for (const event of timeline) {
        if (event.eventType !== "agent_contribution_decided") continue;
        const parsed = AgentContributionDecisionEventPayloadSchema.safeParse(
          event.payload,
        );
        if (parsed.success) decidedProposalIds.add(parsed.data.proposalId);
      }
      const cards = selectKeyAgentContributionCards({
        proposals: projection.agentAssistance,
        viewerActorId: projection.role.agentId,
        currentTaskAnchor: projection.currentTaskAnchor,
      }).filter((card) => !decidedProposalIds.has(card.proposalId));
      return {
        schemaVersion: "agent-contribution-cards/1.0.0",
        stateVersion: projection.stateVersion,
        cards,
      };
    },
  );

  app.post<{
    Params: { sessionId: string };
    Body: Buffer;
  }>("/api/sessions/:sessionId/materials", async (request) => {
    assertAllowedOrigin(request.headers.origin);
    const input = uploadMaterialQuerySchema.parse(request.query);
    const token = requireToken(request.headers.cookie);
    auth.assertCsrf(
      token,
      request.headers["x-csrf-token"] as string | undefined,
    );
    const identity = auth.resolveBinding(
      token,
      input.bindingId,
      request.params.sessionId,
    );
    const bytes = request.body;
    if (!Buffer.isBuffer(bytes)) {
      throw new InvalidWorldActionError(
        "素材上传必须使用 application/octet-stream",
      );
    }
    const state = await engine.getStateSnapshot(request.params.sessionId);
    if (state.stateVersion !== input.expectedStateVersion) {
      throw new StateVersionConflictError(
        input.expectedStateVersion,
        state.stateVersion,
      );
    }
    const role = state.scenario.roles.find((candidate) => (
      candidate.agentId === identity.binding.actorId
    ));
    if (!role || !role.toolPolicy.includes("upload_material")) {
      throw new PermissionDeniedError("当前岗位没有素材上传能力");
    }
    const config = state.scenario.productionConfig;
    if (!config) {
      throw new InvalidWorldActionError("当前情境没有启用内容生产");
    }
    if (
      bytes.length > config.maximumUploadBytes
      || !config.allowedUploadMimeTypes.includes(input.mimeType)
    ) {
      throw new InvalidWorldActionError(
        "上传素材类型或大小超出固定情境配置",
      );
    }
    try {
      assertSafeUpload(bytes, input.mimeType, input.fileName);
    } catch (error) {
      throw new InvalidWorldActionError(
        error instanceof Error ? error.message : "上传素材不安全",
      );
    }
    const mediaType = mediaTypeForMime(input.mimeType);
    if (!mediaType) {
      throw new InvalidWorldActionError("无法映射上传素材媒体类型");
    }
    const contentHash = sha256(bytes);
    const stored = await objectStore.put({
      sessionId: request.params.sessionId,
      bytes,
      contentHash,
    });
    const visibleToRoles = state.scenario.roles
      .filter((candidate) => (
        candidate.teamId === role.teamId
        && candidate.actorKind === "student"
      ))
      .map((candidate) => candidate.roleId);
    const material = MaterialSchema.parse({
      materialId: `upload-${contentHash.slice(0, 20)}`,
      title: input.title.trim(),
      mediaType,
      source: "岗位用户上传",
      sourceRef: stored.sourceRef,
      version: contentHash.slice(0, 12),
      copyrightStatus: "unknown",
      visibleToRoles,
      origin: "upload",
      mimeType: input.mimeType,
      sizeBytes: stored.sizeBytes,
      contentHash,
      uploadedBy: role.agentId,
      createdAt: new Date().toISOString(),
    });
    const projection = await engine.registerUploadedMaterial({
      sessionId: request.params.sessionId,
      actorId: role.agentId,
      expectedStateVersion: input.expectedStateVersion,
      correlationId: input.requestId,
      material,
    });
    const canonicalMaterial = projection.materials.find((candidate) => (
      candidate.contentHash === contentHash
    )) ?? material;
    return { material: canonicalMaterial, projection };
  });

  app.get<{ Params: { sessionId: string } }>("/api/sessions/:sessionId/timeline", async (request) => {
    const { bindingId } = bindingQuerySchema.parse(request.query);
    const token = requireToken(request.headers.cookie);
    const identity = auth.resolveBinding(token, bindingId, request.params.sessionId);
    if (
      isV2CourseSession(request.params.sessionId)
      && !["operator", "operator-demo"].includes(identity.profileId)
    ) {
      throw new PermissionDeniedError(
        "V2 课程会话的原始事件时间线仅向管理员开放",
      );
    }
    return { events: await engine.getTimeline(request.params.sessionId, identity.binding.actorId) };
  });

  app.get<{ Params: { sessionId: string } }>("/api/sessions/:sessionId/rag", async (request) => {
    const { bindingId, q } = ragQuerySchema.parse(request.query);
    const token = requireToken(request.headers.cookie);
    const identity = auth.resolveBinding(token, bindingId, request.params.sessionId);
    const projection = await engine.getProjection(request.params.sessionId, identity.binding.actorId);
    const scenario = await engine.getScenarioPackage(request.params.sessionId);
    const access = createAccessSubject({
      role: projection.role,
      sessionId: request.params.sessionId,
      sessionEpoch: projection.sessionEpoch,
      courseId: projection.scenario.courseId,
      purpose: "api_rag",
    });
    return ragRetriever.retrieve({
      query: q,
      subject: access,
      nodeId: projection.currentNode.nodeId,
      stateVersion: projection.stateVersion,
      chunks: scenario.knowledgeChunks,
      facts: projection.facts,
      evidence: projection.evidence,
      transient: projection.roleMessages.slice(-2).map((message) => message.content),
    });
  });

  app.get<{ Params: { sessionId: string } }>("/api/sessions/:sessionId/context-debug", async (request) => {
    const { bindingId, targetAgentId, q } = contextDebugQuerySchema.parse(request.query);
    const token = requireToken(request.headers.cookie);
    const identity = auth.resolveBinding(token, bindingId, request.params.sessionId);
    requireAdministrator(identity);
    const requesterProjection = await engine.getProjection(
      request.params.sessionId,
      identity.binding.actorId,
    );
    if (
      requesterProjection.actorKind !== "teacher"
      || !requesterProjection.role.toolPolicy.includes("read_all")
    ) {
      throw new PermissionDeniedError("只有具备显式审计能力的教师岗位可以查看上下文调试快照");
    }
    const scenario = await engine.getScenarioPackage(request.params.sessionId);
    const targetRole = scenario.roles.find((role) => role.agentId === targetAgentId);
    if (!targetRole) throw new InvalidWorldActionError(`上下文调试目标不存在：${targetAgentId}`);
    const targetProjection = await engine.getProjection(request.params.sessionId, targetAgentId);
    const targetAccess = createAccessSubject({
      role: targetRole,
      sessionId: request.params.sessionId,
      sessionEpoch: targetProjection.sessionEpoch,
      courseId: targetProjection.scenario.courseId,
      purpose: "runtime",
    });
    const debugAudience = createResourceAudience({
      scopes: ["role_private", "audit_only"],
      courseId: targetProjection.scenario.courseId,
      sessionId: request.params.sessionId,
      sessionEpoch: targetProjection.sessionEpoch,
      teamIds: [targetRole.teamId],
      roleIds: [targetRole.roleId],
      actorIds: [targetRole.agentId],
      privateNamespaces: targetAccess.privateNamespaces,
      auditReadable: true,
    });
    const snapshot = await contextAssembler.assemble({
      subject: targetAccess,
      scenarioVersion: scenario.version,
      scenarioContentHash: targetProjection.scenario.contentHash,
      query: q,
      nodeId: targetProjection.currentNode.nodeId,
      stateVersion: targetProjection.stateVersion,
      tokenBudget: targetRole.tokenBudget,
      chunks: scenario.knowledgeChunks,
      facts: targetProjection.facts,
      evidence: targetProjection.evidence,
      fixed: [
        `岗位目的：${targetRole.purpose}`,
        `允许意图：${targetRole.allowedIntents.join("、") || "无"}`,
      ],
      transient: targetProjection.roleMessages.slice(-2).map((message) => ({
        itemId: `debug-message:${message.messageId}`,
        content: message.content,
        source: message.messageId,
        version: message.timestamp,
        audience: debugAudience,
      })),
    });
    return {
      audit: {
        requesterActorId: requesterProjection.role.agentId,
        targetActorId: targetRole.agentId,
        targetRoleId: targetRole.roleId,
        privateContentIncluded: snapshot.context.privateMemory.length > 0,
      },
      manifest: snapshot.manifest,
      context: snapshot.context,
    };
  });

  app.post<{ Params: { sessionId: string } }>("/api/sessions/:sessionId/commands", async (request) => {
    assertAllowedOrigin(request.headers.origin);
    assertNoClientActorClaim(request.body);
    const input = commandBodySchema.parse(request.body);
    const token = requireToken(request.headers.cookie);
    auth.assertCsrf(token, request.headers["x-csrf-token"] as string | undefined);
    const identity = auth.resolveBinding(token, input.bindingId, request.params.sessionId);
    const scenario = await engine.getScenarioPackage(request.params.sessionId);
    const meta = createMessageMeta({
      sessionId: request.params.sessionId,
      sceneId: scenario.scenarioId,
      actorId: identity.binding.actorId,
    });
    const actionId = input.actionId ?? meta.messageId;
    const idempotencyKey = input.idempotencyKey ?? actionId;
    const projection = await orchestrator.runSessionOperation(
      request.params.sessionId,
      async () => {
      if(identity.binding.actorKind==='student'&&getDemoProfile(identity.profileId).role==='student')
        await studentStudy.assertWritable(studyActorForProfile(identity.profileId),request.params.sessionId);
      const actorProjection = await engine.getProjection(
        request.params.sessionId,
        identity.binding.actorId,
      );
      await goldPilotReadiness.assertSessionAccessAllowed({
        sessionId: request.params.sessionId,
        actorKind: actorProjection.role.actorKind,
        roleId: actorProjection.role.roleId,
      });
      await goldPilotStudy.assertSourceModeAllowed({
        sessionId: request.params.sessionId,
        actorKind: actorProjection.role.actorKind,
        roleId: actorProjection.role.roleId,
        sourceMode: input.sourceMode,
      });
      let payload = { ...input.payload };
      if (input.name === "record_experience_choice") {
        if (input.surfaceId === "student-v2-current-advice") {
          const requestedAdvice = StudentAdviceDecisionRequestSchema.parse(
            payload,
          );
          if (input.interactionId !== requestedAdvice.suggestionId) {
            throw new InvalidWorldActionError(
              "协作建议决定必须绑定服务端签发的 suggestionId",
            );
          }
          const episodeContext = await loadAuthorizedEpisodeContext({
            request,
            sessionId: request.params.sessionId,
            bindingId: input.bindingId,
          });
          const episode = collaborationEpisode.build(episodeContext);
          if (
            episode.audience !== "student"
            || episode.status !== "suggestion_ready"
            || !episode.suggestion
            || episode.suggestion.suggestionId
              !== requestedAdvice.suggestionId
            || !episode.suggestion.allowedDecisions.includes(
              requestedAdvice.decision,
            )
            || episode.studentDecision !== null
          ) {
            throw new InvalidWorldActionError(
              "当前权威 Episode 不允许这次协作建议决定",
            );
          }
          if (episode.stateVersion !== input.expectedStateVersion) {
            throw new StateVersionConflictError(
              input.expectedStateVersion,
              episode.stateVersion,
            );
          }
          const nodeId = episodeContext.projection.currentNodeId;
          const expectedTaskId = [
            nodeId,
            "agent-decision",
            requestedAdvice.decision,
          ].join(":");
          const decisionTask = scenario.experienceDesign?.nodeMappings
            .find((mapping) => mapping.nodeId === nodeId)
            ?.operationTasks.find((task) => (
              task.taskId === expectedTaskId
              && task.roleIds.includes("reporter")
            ));
          if (!decisionTask) {
            throw new InvalidWorldActionError(
              "不可变情境没有为当前建议决定签发可执行引用",
            );
          }
          payload = ExperienceChoiceCommandPayloadSchema.parse({
            choiceRef: decisionTask.taskId,
          });
        } else {
          const requestedChoice = ExperienceChoiceCommandPayloadSchema.parse(
            payload,
          );
          if (requestedChoice.choiceRef.includes(":agent-decision:")) {
            throw new PermissionDeniedError(
              "协作建议引用只能由服务端根据当前 Episode 解析",
            );
          }
          payload = requestedChoice;
        }
      }
      if (input.name === "record_agent_contribution_decision") {
        const requestedDecision =
          AgentContributionDecisionCommandPayloadSchema.parse(payload);
        if (
          !input.idempotencyKey
          || input.idempotencyKey !== requestedDecision.idempotencyKey
        ) {
          throw new InvalidWorldActionError(
            "贡献决策必须使用卡片绑定的同一幂等键",
          );
        }
        const card = selectKeyAgentContributionCards({
          proposals: actorProjection.agentAssistance,
          viewerActorId: actorProjection.role.agentId,
          currentTaskAnchor: actorProjection.currentTaskAnchor,
        }).find((candidate) => (
          candidate.proposalId === requestedDecision.proposalId
          && candidate.decisionIdempotencyKey
            === requestedDecision.idempotencyKey
        ));
        if (!card) {
          throw new PermissionDeniedError(
            "当前学生投影中没有可处理的关键贡献卡",
          );
        }
        payload = createAgentContributionDecisionEventPayload({
          card,
          studentActorId: actorProjection.role.agentId,
          decision: requestedDecision.decision,
          studentReason: requestedDecision.studentReason,
        });
      }
      if (input.name === "inspect_material") {
        const preflightCommand: Command = {
          ...meta,
          kind: "Command",
          name: input.name,
          expectedStateVersion: input.expectedStateVersion,
          payload,
        };
        const material = await engine.preflightMaterialInspection(
          preflightCommand,
        );
        payload.observation = await adapter.observeMaterial({
          sessionId: request.params.sessionId,
          sceneId: scenario.scenarioId,
          actorId: identity.binding.actorId,
          correlationId: meta.correlationId,
          material,
        });
      }
      let expectedStateVersion = input.expectedStateVersion;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const command: Command = {
          ...meta,
          kind: "Command",
          name: input.name,
          expectedStateVersion,
          payload,
        };
        const envelope: ActionEnvelope = {
          kind: "ActionEnvelope",
          envelopeVersion: ActionEnvelopeSchemaVersion,
          actionId,
          idempotencyKey,
          payloadHash: hashValue(command.payload),
          source: {
            mode: input.sourceMode,
            assertion: "client_declared",
            surfaceId: input.surfaceId ?? (
              input.sourceMode === "world_interaction"
                ? "student-world"
                : "student-course-platform"
            ),
            interactionId: input.interactionId,
          },
          actor: {
            principalId: identity.principal.principalId,
            bindingId: identity.binding.bindingId,
            actorId: actorProjection.role.agentId,
            actorKind: actorProjection.role.actorKind,
            roleId: actorProjection.role.roleId,
            teamId: actorProjection.role.teamId,
            sessionEpoch: actorProjection.sessionEpoch,
          },
          objectRefs: [{
            objectType: "world_state",
            objectId: request.params.sessionId,
            version: String(expectedStateVersion),
          }],
          causality: {
            rootActionId: actionId,
            causationId: input.interactionId ?? actionId,
            parentActionId: null,
            causationEventIds: [],
            causalDepth: 0,
          },
          evidence: {
            evidenceRefs: [],
            citationRefs: [],
            toolResultRefs: [],
          },
          command,
        };
        try {
          return await engine.executeAction(envelope);
        } catch (error) {
          if (!(error instanceof StateVersionConflictError) || attempt === 2) throw error;
          const blockingVisibleChanges = (await engine.getTimeline(
            request.params.sessionId,
            identity.binding.actorId,
          )).some((event) => (
            event.stateVersion > input.expectedStateVersion
            && !nonBlockingConcurrentEventTypes.has(event.eventType)
          ));
          if (blockingVisibleChanges) throw error;
          expectedStateVersion = error.actual;
        }
      }
        throw new Error("命令重基循环异常终止");
      },
    );
    if (
      isV2CourseSession(request.params.sessionId)
      && identity.binding.actorKind === "student"
    ) {
      return StudentTrainingMutationReceiptSchema.parse({
        schemaVersion: StudentTrainingMutationReceiptSchemaVersion,
        accepted: true,
        sessionId: request.params.sessionId,
        stateVersion: projection.stateVersion,
      });
    }
    return projection;
  });

  app.get("/api/adapters/iflytek/health", async () => {
    const health = adapter.health();
    return {
      health: {
        ...health,
        capabilities: health.capabilities.map((capability) => ({
          ...capability,
          endpoint: null,
        })),
      },
      catalog: adapter.catalog().map((item) => ({
        capability: item.capability,
        label: item.label,
        authStrategy: item.authStrategy,
        officialDocUrl: item.officialDocUrl,
      })),
    };
  });

  app.get("/api/models/health", async () => {
    const health = modelIntegration.health();
    return {
      health: {
        ...health,
        baseUrl: null,
      },
    };
  });

  app.get<{ Params: { sessionId: string } }>(
    "/api/sessions/:sessionId/agent-templates",
    async (request) => {
      const { bindingId } = bindingQuerySchema.parse(request.query);
      const token = requireToken(request.headers.cookie);
      const identity = auth.resolveBinding(
        token,
        bindingId,
        request.params.sessionId,
      );
      const projection = await engine.getProjection(
        request.params.sessionId,
        identity.binding.actorId,
      );
      if (projection.actorKind !== "teacher") {
        throw new PermissionDeniedError(
          "只有教师视野可以查看智能体模板目录",
        );
      }
      return { templates: orchestrator.listAgentTemplates() };
    },
  );

  app.get<{ Params: { sessionId: string } }>(
    "/api/sessions/:sessionId/agent-instances",
    async (request) => {
      const { bindingId } = bindingQuerySchema.parse(request.query);
      const token = requireToken(request.headers.cookie);
      const identity = auth.resolveBinding(
        token,
        bindingId,
        request.params.sessionId,
      );
      const projection = await engine.getProjection(
        request.params.sessionId,
        identity.binding.actorId,
      );
      if (projection.actorKind !== "teacher") {
        throw new PermissionDeniedError(
          "只有教师视野可以查看智能体实例目录",
        );
      }
      return {
        instances: await orchestrator.listAgentInstances(
          request.params.sessionId,
        ),
      };
    },
  );

  app.get<{ Params: { sessionId: string } }>("/api/sessions/:sessionId/agent-runs", async (request) => {
    const { bindingId } = bindingQuerySchema.parse(request.query);
    const token = requireToken(request.headers.cookie);
    const identity = auth.resolveBinding(token, bindingId, request.params.sessionId);
    requireAdministrator(identity);
    const projection = await engine.getProjection(request.params.sessionId, identity.binding.actorId);
    if (projection.actorKind !== "teacher") {
      throw new PermissionDeniedError("只有教师视野可以查看智能体运行轨迹");
    }
    const events = await engine.getTimeline(request.params.sessionId, identity.binding.actorId);
    const runs = events.flatMap((event) => {
      if (event.eventType !== "agent_run_recorded") return [];
      const parsed = AgentRunTraceSchema.safeParse(event.payload.trace);
      return parsed.success ? [parsed.data] : [];
    });
    return { runs };
  });

  app.get<{ Params: { sessionId: string } }>(
    "/api/sessions/:sessionId/gold-readiness",
    async (request) => {
      const { bindingId } = bindingQuerySchema.parse(request.query);
      const token = requireToken(request.headers.cookie);
      const identity = auth.resolveBinding(
        token,
        bindingId,
        request.params.sessionId,
      );
      const projection = await engine.getProjection(
        request.params.sessionId,
        identity.binding.actorId,
      );
      if (projection.actorKind !== "teacher") {
        throw new PermissionDeniedError(
          "只有教师视野可以查看国金证据实验台",
        );
      }
      const [events, plans] = await Promise.all([
        engine.getTimeline(
          request.params.sessionId,
          identity.binding.actorId,
        ),
        taskStore.listDispatchPlans(request.params.sessionId),
      ]);
      const runs = events.flatMap((event) => {
        if (event.eventType !== "agent_run_recorded") return [];
        const parsed = AgentRunTraceSchema.safeParse(event.payload.trace);
        return parsed.success ? [parsed.data] : [];
      });
      const configuredGitCommit = (
        environment.BUILD_GIT_COMMIT
        ?? environment.GIT_COMMIT_SHA
        ?? ""
      ).trim().toLowerCase();
      return createGoldReadinessWorkbench({
        generatedAt: new Date().toISOString(),
        productVersion: ProductVersion,
        gitCommit: /^[a-f0-9]{40}$/u.test(configuredGitCommit)
          ? configuredGitCommit
          : null,
        technicalEvidencePlan: createGoldTechnicalEvidencePlan({
          flagship: {
            scenarioId: flagshipScenarioV111.scenarioId,
            version: flagshipScenarioV111.version,
            releaseRef:
              `release-${flagshipScenarioV111.scenarioId}-${flagshipScenarioV111.version}-baseline`,
            contentHash: flagshipScenarioV111ContentHash,
          },
          transfer: {
            scenarioId: heritageNightTourScenarioV100.scenarioId,
            version: heritageNightTourScenarioV100.version,
            releaseRef:
              `release-${heritageNightTourScenarioV100.scenarioId}-${heritageNightTourScenarioV100.version}-baseline`,
            contentHash: heritageNightTourScenarioV100ContentHash,
          },
        }),
        controlledAblationPreregistration:
          createGoldControlledAblationPreregistration({
            scenarioReleaseRef:
              `release-${flagshipScenarioV111.scenarioId}-${flagshipScenarioV111.version}-baseline`,
            scenarioContentHash: flagshipScenarioV111ContentHash,
            modelProfileRef: "gold-controlled-live/deepseek-v4-flash",
            modelTier: "deepseek-v4-flash",
            repetitionsPerCondition: 10,
          }),
        scenarioReleaseRef:
          `${projection.scenario.releaseId}@${projection.scenario.version}`,
        scenarioContentHash: projection.scenario.contentHash,
        plans,
        runs,
        evaluationCases: projection.evaluationCases,
        evaluationProposals: projection.evaluationProposals,
        evaluationArbitrations: projection.evaluationArbitrations,
        teacherReviews: projection.teacherAssessmentReviews,
      });
    },
  );

  app.get<{ Params: { sessionId: string } }>(
    "/api/sessions/:sessionId/gold-competition-readiness",
    async (request) => {
      const { bindingId } = bindingQuerySchema.parse(request.query);
      const token = requireToken(request.headers.cookie);
      await requireSessionTeacher(
        token,
        bindingId,
        request.params.sessionId,
      );
      const [
        evidence,
        officialEvidence,
        scorecardEvidence,
        blindReview,
        pilotReadiness,
        pilotStudy,
      ] =
        await Promise.all([
          goldCompetitionEvidenceLoader(),
          goldCompetitionOfficialEvidenceLoader(),
          goldCompetitionScorecardEvidenceLoader(),
          goldBlindReview.getWorkflowView(request.params.sessionId),
          goldPilotReadiness.getWorkflowView(request.params.sessionId),
          goldPilotStudy.getWorkflowView(request.params.sessionId),
        ]);
      return createGoldCompetitionReadinessSnapshot({
        generatedAt: new Date().toISOString(),
        productVersion: ProductVersion,
        evidence,
        blindReview,
        pilotReadiness,
        pilotStudy,
        iflytekHealth: adapter.health(),
        officialEvidence,
        scorecardEvidence,
      });
    },
  );

  app.get<{ Params: { sessionId: string } }>(
    "/api/sessions/:sessionId/gold-blind-review",
    async (request) => {
      const { bindingId } = bindingQuerySchema.parse(request.query);
      const token = requireToken(request.headers.cookie);
      await requireSessionTeacher(
        token,
        bindingId,
        request.params.sessionId,
      );
      return goldBlindReview.getWorkflowView(request.params.sessionId);
    },
  );

  app.post<{ Params: { sessionId: string } }>(
    "/api/sessions/:sessionId/gold-blind-review/batches",
    async (request, reply) => {
      assertAllowedOrigin(request.headers.origin);
      assertNoClientActorClaim(request.body);
      const input = goldBlindReviewBatchCreateBodySchema.parse(request.body);
      const token = requireToken(request.headers.cookie);
      auth.assertCsrf(
        token,
        request.headers["x-csrf-token"] as string | undefined,
      );
      const identity = await requireSessionTeacher(
        token,
        input.bindingId,
        request.params.sessionId,
      );
      const result = await goldBlindReview.createBatch({
        sessionId: request.params.sessionId,
        createdByActorId: identity.binding.actorId,
        packet: input.packet,
        conditionKey: input.conditionKey,
        preregistration: input.preregistration,
        reviewerAliases: input.reviewerAliases,
      });
      return reply.status(201).send(result);
    },
  );

  app.get<{ Params: { batchId: string } }>(
    "/api/gold-blind-review/batches/:batchId/reviewer",
    async (request) => {
      const rawAccessCode = request.headers["x-reviewer-access-code"];
      const accessCode = goldBlindReviewAccessCodeSchema.parse(
        Array.isArray(rawAccessCode) ? rawAccessCode[0] : rawAccessCode,
      );
      return goldBlindReview.getReviewerView(
        request.params.batchId,
        accessCode,
      );
    },
  );

  app.post<{ Params: { batchId: string } }>(
    "/api/gold-blind-review/batches/:batchId/reviews",
    async (request, reply) => {
      assertAllowedOrigin(request.headers.origin);
      const rawAccessCode = request.headers["x-reviewer-access-code"];
      const accessCode = goldBlindReviewAccessCodeSchema.parse(
        Array.isArray(rawAccessCode) ? rawAccessCode[0] : rawAccessCode,
      );
      const input = GoldBlindReviewSubmissionInputSchema.parse(request.body);
      const result = await goldBlindReview.submitReview(
        request.params.batchId,
        accessCode,
        input,
      );
      return reply.status(201).send(result);
    },
  );

  app.post<{
    Params: { sessionId: string; batchId: string };
  }>(
    "/api/sessions/:sessionId/gold-blind-review/batches/:batchId/freeze",
    async (request) => {
      assertAllowedOrigin(request.headers.origin);
      assertNoClientActorClaim(request.body);
      const input = goldBlindReviewTeacherActionSchema.parse(request.body);
      const token = requireToken(request.headers.cookie);
      auth.assertCsrf(
        token,
        request.headers["x-csrf-token"] as string | undefined,
      );
      await requireSessionTeacher(
        token,
        input.bindingId,
        request.params.sessionId,
      );
      await requireBlindReviewBatchInSession(
        request.params.sessionId,
        request.params.batchId,
      );
      return goldBlindReview.freezeBatch(request.params.batchId);
    },
  );

  app.post<{
    Params: { sessionId: string; batchId: string };
  }>(
    "/api/sessions/:sessionId/gold-blind-review/batches/:batchId/unblind",
    async (request) => {
      assertAllowedOrigin(request.headers.origin);
      assertNoClientActorClaim(request.body);
      const input = goldBlindReviewTeacherActionSchema.parse(request.body);
      const token = requireToken(request.headers.cookie);
      auth.assertCsrf(
        token,
        request.headers["x-csrf-token"] as string | undefined,
      );
      await requireSessionTeacher(
        token,
        input.bindingId,
        request.params.sessionId,
      );
      await requireBlindReviewBatchInSession(
        request.params.sessionId,
        request.params.batchId,
      );
      return goldBlindReview.unblindBatch(request.params.batchId);
    },
  );

  app.get<{ Params: { sessionId: string } }>(
    "/api/sessions/:sessionId/gold-pilot-readiness",
    async (request) => {
      const { bindingId } = bindingQuerySchema.parse(request.query);
      const token = requireToken(request.headers.cookie);
      await requireSessionTeacher(
        token,
        bindingId,
        request.params.sessionId,
      );
      return goldPilotReadiness.getWorkflowView(request.params.sessionId);
    },
  );

  app.post<{ Params: { sessionId: string } }>(
    "/api/sessions/:sessionId/gold-pilot-readiness/plans",
    async (request, reply) => {
      assertAllowedOrigin(request.headers.origin);
      assertNoClientActorClaim(request.body);
      const input = goldPilotReadinessPlanCreateBodySchema.parse(
        request.body,
      );
      const token = requireToken(request.headers.cookie);
      auth.assertCsrf(
        token,
        request.headers["x-csrf-token"] as string | undefined,
      );
      const identity = await requireSessionTeacher(
        token,
        input.bindingId,
        request.params.sessionId,
      );
      const visibleSessions = await sessionControl.listSessions({
        principalId: identity.principal.principalId,
      });
      const visibleSessionIds = new Set(
        visibleSessions
          .filter((session) => session.status === "active")
          .map((session) => session.sessionId),
      );
      const allocationBySession = new Map(
        input.taskAllocations.flatMap((allocation) => (
          allocation.runs.map((run) => [run.sessionId, run] as const)
        )),
      );
      const variantById = new Map(
        input.equivalentTasks.variants.map((variant) => [
          variant.taskVariantId,
          variant,
        ]),
      );
      for (const run of input.participantAssignments.flatMap(
        (assignment) => assignment.runs,
      )) {
        if (!visibleSessionIds.has(run.sessionId)) {
          throw new RoleBindingDeniedError(
            "采集前计划包含当前教师不可见或未激活的训练会话",
          );
        }
        const scenario = await engine.getScenarioPackage(run.sessionId);
        const role = scenario.roles.find((candidate) => (
          candidate.roleId === run.roleId
          && candidate.actorKind === "student"
        ));
        if (!role) {
          throw new GoldPilotReadinessError(
            "invalid_plan_input",
            "采集前计划登记的学生岗位不存在",
            { sessionId: run.sessionId, roleId: run.roleId },
          );
        }
        const allocation = allocationBySession.get(run.sessionId);
        const variant = allocation
          ? variantById.get(allocation.taskVariantId)
          : null;
        if (!variant) {
          throw new GoldPilotReadinessError(
            "invalid_plan_input",
            "采集前计划缺少训练会话的等价任务分配",
            { sessionId: run.sessionId },
          );
        }
        const release = await engine.getScenarioRelease(run.sessionId);
        if (
          release.ref.scenarioId !== variant.scenarioId
          || release.ref.version !== variant.scenarioVersion
          || release.ref.contentHash !== variant.scenarioContentHash
        ) {
          throw new GoldPilotReadinessError(
            "invalid_plan_input",
            "等价任务引用与训练会话固定情境发布不一致",
            {
              sessionId: run.sessionId,
              taskVariantId: variant.taskVariantId,
            },
          );
        }
      }
      const {
        bindingId: _bindingId,
        ...planInput
      } = input;
      const plan = await goldPilotReadiness.createPlan({
        anchorSessionId: request.params.sessionId,
        createdByActorId: identity.binding.actorId,
        ...planInput,
      });
      return reply.status(201).send(plan);
    },
  );

  app.post<{
    Params: { sessionId: string; readinessId: string };
  }>(
    "/api/sessions/:sessionId/gold-pilot-readiness/plans/:readinessId/reviews",
    async (request) => {
      assertAllowedOrigin(request.headers.origin);
      assertNoClientActorClaim(request.body);
      const input = goldPilotReadinessReviewBodySchema.parse(request.body);
      const token = requireToken(request.headers.cookie);
      auth.assertCsrf(
        token,
        request.headers["x-csrf-token"] as string | undefined,
      );
      await requireSessionTeacher(
        token,
        input.bindingId,
        request.params.sessionId,
      );
      await requireReadinessPlanInSession(
        request.params.sessionId,
        request.params.readinessId,
      );
      return goldPilotReadiness.submitRubricReview(
        request.params.readinessId,
        input.reviewerAlias,
        input.review,
      );
    },
  );

  app.post<{
    Params: { sessionId: string; readinessId: string };
  }>(
    "/api/sessions/:sessionId/gold-pilot-readiness/plans/:readinessId/resolutions",
    async (request) => {
      assertAllowedOrigin(request.headers.origin);
      assertNoClientActorClaim(request.body);
      const input = goldPilotReadinessResolutionBodySchema.parse(
        request.body,
      );
      const token = requireToken(request.headers.cookie);
      auth.assertCsrf(
        token,
        request.headers["x-csrf-token"] as string | undefined,
      );
      await requireSessionTeacher(
        token,
        input.bindingId,
        request.params.sessionId,
      );
      await requireReadinessPlanInSession(
        request.params.sessionId,
        request.params.readinessId,
      );
      return goldPilotReadiness.resolveRubricDimension(
        request.params.readinessId,
        input.resolution,
      );
    },
  );

  app.post<{
    Params: { sessionId: string; readinessId: string };
  }>(
    "/api/sessions/:sessionId/gold-pilot-readiness/plans/:readinessId/consents",
    async (request) => {
      assertAllowedOrigin(request.headers.origin);
      assertNoClientActorClaim(request.body);
      const input = goldPilotReadinessConsentBodySchema.parse(request.body);
      const token = requireToken(request.headers.cookie);
      auth.assertCsrf(
        token,
        request.headers["x-csrf-token"] as string | undefined,
      );
      await requireSessionTeacher(
        token,
        input.bindingId,
        request.params.sessionId,
      );
      await requireReadinessPlanInSession(
        request.params.sessionId,
        request.params.readinessId,
      );
      return goldPilotReadiness.confirmConsent(
        request.params.readinessId,
        input.consent,
      );
    },
  );

  app.post<{
    Params: { sessionId: string; readinessId: string };
  }>(
    "/api/sessions/:sessionId/gold-pilot-readiness/plans/:readinessId/withdrawals",
    async (request) => {
      assertAllowedOrigin(request.headers.origin);
      assertNoClientActorClaim(request.body);
      const input = goldPilotReadinessConsentBodySchema.parse(request.body);
      const token = requireToken(request.headers.cookie);
      auth.assertCsrf(
        token,
        request.headers["x-csrf-token"] as string | undefined,
      );
      await requireSessionTeacher(
        token,
        input.bindingId,
        request.params.sessionId,
      );
      await requireReadinessPlanInSession(
        request.params.sessionId,
        request.params.readinessId,
      );
      return goldPilotReadiness.withdrawConsent(
        request.params.readinessId,
        input.consent,
      );
    },
  );

  app.post<{
    Params: { sessionId: string; readinessId: string };
  }>(
    "/api/sessions/:sessionId/gold-pilot-readiness/plans/:readinessId/freeze",
    async (request) => {
      assertAllowedOrigin(request.headers.origin);
      assertNoClientActorClaim(request.body);
      const input = goldPilotTeacherActionSchema.parse(request.body);
      const token = requireToken(request.headers.cookie);
      auth.assertCsrf(
        token,
        request.headers["x-csrf-token"] as string | undefined,
      );
      await requireSessionTeacher(
        token,
        input.bindingId,
        request.params.sessionId,
      );
      await requireReadinessPlanInSession(
        request.params.sessionId,
        request.params.readinessId,
      );
      return goldPilotReadiness.freezePlan(request.params.readinessId);
    },
  );

  app.get<{ Params: { sessionId: string } }>(
    "/api/sessions/:sessionId/gold-pilot-study",
    async (request) => {
      const { bindingId } = bindingQuerySchema.parse(request.query);
      const token = requireToken(request.headers.cookie);
      await requireSessionTeacher(
        token,
        bindingId,
        request.params.sessionId,
      );
      return goldPilotStudy.getWorkflowView(request.params.sessionId);
    },
  );

  app.post<{ Params: { sessionId: string } }>(
    "/api/sessions/:sessionId/gold-pilot-study/studies",
    async (request, reply) => {
      assertAllowedOrigin(request.headers.origin);
      assertNoClientActorClaim(request.body);
      const input = goldPilotStudyCreateBodySchema.parse(request.body);
      const token = requireToken(request.headers.cookie);
      auth.assertCsrf(
        token,
        request.headers["x-csrf-token"] as string | undefined,
      );
      const identity = await requireSessionTeacher(
        token,
        input.bindingId,
        request.params.sessionId,
      );
      const visibleSessions = await sessionControl.listSessions({
        principalId: identity.principal.principalId,
      });
      const visibleSessionIds = new Set(
        visibleSessions
          .filter((session) => session.status === "active")
          .map((session) => session.sessionId),
      );
      const registeredRuns = input.participantAssignments.flatMap(
        (assignment) => assignment.runs,
      );
      for (const run of registeredRuns) {
        if (!visibleSessionIds.has(run.sessionId)) {
          throw new RoleBindingDeniedError(
            "试点分组包含当前教师不可见或未激活的训练会话",
          );
        }
        const scenario = await engine.getScenarioPackage(run.sessionId);
        const role = scenario.roles.find((candidate) => (
          candidate.roleId === run.roleId
          && candidate.actorKind === "student"
        ));
        if (!role) {
          throw new GoldPilotStudyError(
            "invalid_study_input",
            "试点运行登记的学生岗位不存在",
            { sessionId: run.sessionId, roleId: run.roleId },
          );
        }
      }
      const readinessFreezeReceipt =
        await goldPilotReadiness.assertStudyLaunchAllowed({
        readinessId: input.readinessId,
        freezeReceiptHash: input.freezeReceiptHash,
        anchorSessionId: request.params.sessionId,
        participantAssignments: input.participantAssignments,
      });
      const readinessPlan = await goldPilotReadiness.getPlan(
        input.readinessId,
      );
      const study = await goldPilotStudy.createStudy({
        anchorSessionId: request.params.sessionId,
        createdByActorId: identity.binding.actorId,
        participantAssignments: input.participantAssignments,
        taskAllocations: readinessPlan.taskAllocations,
        readinessFreezeReceipt,
      });
      return reply.status(201).send(study);
    },
  );

  app.post<{ Params: { sessionId: string } }>(
    "/api/sessions/:sessionId/gold-pilot-study/workload/start",
    async (request) => {
      assertAllowedOrigin(request.headers.origin);
      assertNoClientActorClaim(request.body);
      const input = goldPilotWorkloadStartBodySchema.parse(request.body);
      const token = requireToken(request.headers.cookie);
      auth.assertCsrf(
        token,
        request.headers["x-csrf-token"] as string | undefined,
      );
      await requireSessionTeacher(
        token,
        input.bindingId,
        request.params.sessionId,
      );
      await goldPilotReadiness.assertSessionAccessAllowed({
        sessionId: request.params.sessionId,
        actorKind: "teacher",
        roleId: "teacher",
      });
      return goldPilotStudy.startWorkloadPhase(
        request.params.sessionId,
        input.phase,
      );
    },
  );

  app.post<{
    Params: { sessionId: string; segmentId: string };
  }>(
    "/api/sessions/:sessionId/gold-pilot-study/workload/:segmentId/finish",
    async (request) => {
      assertAllowedOrigin(request.headers.origin);
      assertNoClientActorClaim(request.body);
      const input = goldPilotTeacherActionSchema.parse(request.body);
      const token = requireToken(request.headers.cookie);
      auth.assertCsrf(
        token,
        request.headers["x-csrf-token"] as string | undefined,
      );
      await requireSessionTeacher(
        token,
        input.bindingId,
        request.params.sessionId,
      );
      return goldPilotStudy.finishWorkloadSegment(
        request.params.sessionId,
        request.params.segmentId,
      );
    },
  );

  app.post<{ Params: { sessionId: string } }>(
    "/api/sessions/:sessionId/gold-pilot-study/runs/finalize",
    async (request) => {
      assertAllowedOrigin(request.headers.origin);
      assertNoClientActorClaim(request.body);
      const input = goldPilotRunFinalizeBodySchema.parse(request.body);
      const token = requireToken(request.headers.cookie);
      auth.assertCsrf(
        token,
        request.headers["x-csrf-token"] as string | undefined,
      );
      await requireSessionTeacher(
        token,
        input.bindingId,
        request.params.sessionId,
      );
      const workflow = await goldPilotStudy.getWorkflowView(
        request.params.sessionId,
      );
      if (!workflow.currentRun) {
        throw new GoldPilotStudyError(
          "session_not_registered",
          "当前会话没有预登记试点运行",
          { sessionId: request.params.sessionId },
        );
      }
      const scenario = await engine.getScenarioPackage(
        request.params.sessionId,
      );
      const participantRole = scenario.roles.find((role) => (
        role.actorKind === "student"
        && role.roleId === workflow.currentRun!.roleId
      ));
      if (!participantRole) {
        throw new GoldPilotStudyError(
          "invalid_study_input",
          "预登记学生岗位与当前情境不一致",
          {
            sessionId: request.params.sessionId,
            roleId: workflow.currentRun.roleId,
          },
        );
      }
      await goldPilotReadiness.assertFinalizationAllowed(
        request.params.sessionId,
        input.finalization.disposition,
      );
      return goldPilotStudy.finalizeRun({
        sessionId: request.params.sessionId,
        participantActorId: participantRole.agentId,
        finalization: input.finalization,
        events: await engine.store.load(request.params.sessionId),
      });
    },
  );

  app.post<{ Params: { sessionId: string } }>(
    "/api/sessions/:sessionId/gold-pilot-study/analysis/freeze",
    async (request) => {
      assertAllowedOrigin(request.headers.origin);
      assertNoClientActorClaim(request.body);
      const input = goldPilotTeacherActionSchema.parse(request.body);
      const token = requireToken(request.headers.cookie);
      auth.assertCsrf(
        token,
        request.headers["x-csrf-token"] as string | undefined,
      );
      await requireSessionTeacher(
        token,
        input.bindingId,
        request.params.sessionId,
      );
      return goldPilotStudy.freezeAnalysisReport(
        request.params.sessionId,
      );
    },
  );

  app.get<{ Params: { sessionId: string } }>("/api/sessions/:sessionId/trace", async (request) => {
    const { bindingId } = bindingQuerySchema.parse(request.query);
    const token = requireToken(request.headers.cookie);
    requireAdministrator(
      auth.resolveBinding(token, bindingId, request.params.sessionId),
    );
    return buildAuthorizedSessionTrace(
      request.params.sessionId,
      bindingId,
      token,
    );
  });

  app.get<{ Params: { sessionId: string } }>(
    "/api/sessions/:sessionId/collaboration-replay",
    async (request) => {
      const { bindingId } = bindingQuerySchema.parse(request.query);
      const token = requireToken(request.headers.cookie);
      const context = await loadAuthorizedSessionTraceContext(
        request.params.sessionId,
        bindingId,
        token,
      );
      return buildCollaborationReplay(context);
    },
  );

  app.get<{ Params: { sessionId: string } }>("/api/sessions/:sessionId/trace-page", async (request) => {
    const { bindingId, cursor, limit } = tracePageQuerySchema.parse(request.query);
    const token = requireToken(request.headers.cookie);
    requireAdministrator(
      auth.resolveBinding(token, bindingId, request.params.sessionId),
    );
    const descriptor = await roots.course.sessionExperienceDescriptors.get(request.params.sessionId);
    const snapshot = descriptor.experienceGeneration === "standard_v2"
      ? (await loadSessionTraceContextForActor(request.params.sessionId,
          (await engine.getScenarioPackage(request.params.sessionId)).roles.find(role => role.actorKind === "teacher")!.agentId)).trace
      : buildFlagshipTraceProjection(
          await worldSimulationV3.getRecord(request.params.sessionId),
          await simulationAgentOrchestratorV3.loadRecord(request.params.sessionId),
          await flagshipExperienceV4.fieldInterview?.readModelAttempts(request.params.sessionId),
        );
    const page = paginateSessionTrace(snapshot, {
      ...(cursor ? { cursor } : {}),
      ...(limit !== undefined ? { limit } : {}),
    });
    return SessionTracePageSchema.parse({
      schemaVersion: SessionTracePageSchemaVersion,
      ...page,
    });
  });

  app.get<{ Params: { sessionId: string } }>("/api/sessions/:sessionId/events", async (request, reply) => {
    const { bindingId } = bindingQuerySchema.parse(request.query);
    const token = requireToken(request.headers.cookie);
    const initialIdentity = auth.resolveBinding(token, bindingId, request.params.sessionId);
    await engine.getProjection(request.params.sessionId, initialIdentity.binding.actorId);
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const sendProjection = async () => {
      try {
        const identity = auth.resolveBinding(token, bindingId, request.params.sessionId);
        const projection = await engine.getProjection(request.params.sessionId, identity.binding.actorId);
        reply.raw.write(`event: projection\ndata: ${JSON.stringify(projection)}\n\n`);
      } catch {
        reply.raw.write("event: auth-expired\ndata: {}\n\n");
        reply.raw.end();
      }
    };
    await sendProjection();
    const unsubscribe = engine.bus.subscribe(request.params.sessionId, () => { void sendProjection(); });
    const heartbeat = setInterval(() => {
      try {
        auth.resolveBinding(token, bindingId, request.params.sessionId);
        reply.raw.write(": heartbeat\n\n");
      } catch {
        reply.raw.write("event: auth-expired\ndata: {}\n\n");
        reply.raw.end();
      }
    }, 15_000);
    request.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  let startupRecoveryPromise: Promise<void> | null = null;
  if (options.initializeDemo ?? true) {
    const seedSessions = [
      {
        sessionId: DEMO_SESSION_ID,
        classroomId: DEMO_CLASSROOM_A_ID,
        teamId: DEMO_TEAM_A_ID,
        releaseId: seedRelease.ref.releaseId,
        courseReleaseRef: null,
      },
      ...((options.initializeSecondaryDemo ?? !options.engine)
        ? [{
            sessionId: DEMO_SECONDARY_SESSION_ID,
            classroomId: DEMO_CLASSROOM_B_ID,
            teamId: DEMO_TEAM_B_ID,
            releaseId: seedRelease.ref.releaseId,
            courseReleaseRef: null,
          }]
        : []),
      ...(!options.engine
        ? [{
            sessionId: DEMO_XUNPU_SESSION_ID,
            classroomId: DEMO_CLASSROOM_A_ID,
            teamId: DEMO_TEAM_A_ID,
            releaseId: xunpuInteractiveSeedRelease.ref.releaseId,
            courseReleaseRef: xunpuPublishedCourseReleaseRef,
          },
          ...((options.courseReleases === undefined)
            ? migrationDemoDefinitions.map((definition) => ({
                sessionId: definition.sessionId,
                classroomId: DEMO_CLASSROOM_A_ID,
                teamId: DEMO_TEAM_A_ID,
                releaseId: definition.scenarioRelease.ref.releaseId,
                courseReleaseRef: definition.courseReleaseRef,
              }))
            : [])]
        : []),
    ];
    for (const seedSession of seedSessions) {
      const record = await ensureControlSession({
        ...seedSession,
        requestedBy: "system-demo-bootstrap",
        requestId: `bootstrap:${seedSession.sessionId}`,
      });
      trainingSessionCourseReleaseRefs.set(
        seedSession.sessionId,
        seedSession.courseReleaseRef,
      );
      try {
        await initializeWorld(
          seedSession.sessionId,
          false,
          seedSession.releaseId,
        );
        await ensureSessionExperienceDescriptor({
          sessionId: seedSession.sessionId,
          frozenAt: record.createdAt,
          compatibility: "current",
        });
      } catch (error) {
        await transitionToRecoveryFailed(record, error);
      }
    }
    const activeSessionIds: string[] = [];
    for (const sessionId of await engine.store.listSessionIds()) {
      let record = await sessionControl.getSession(sessionId);
      try {
        if ((await engine.store.load(sessionId)).length === 0) continue;
        const release = await engine.getScenarioRelease(sessionId);
        record ??= await ensureControlSession({
          sessionId,
          classroomId: sessionId === DEMO_SECONDARY_SESSION_ID
            ? DEMO_CLASSROOM_B_ID
            : DEMO_CLASSROOM_A_ID,
          teamId: sessionId === DEMO_SECONDARY_SESSION_ID
            ? DEMO_TEAM_B_ID
            : DEMO_TEAM_A_ID,
          releaseId: release.ref.releaseId,
          requestedBy: "system-legacy-migration",
          requestId: `legacy-migration:${sessionId}`,
        });
        await ensureScenarioRoleMemory(engine, roleMemory, sessionId);
        if (record.status === "recovery_failed") {
          record = await sessionControl.transitionSessionStatus({
            sessionId,
            expectedStatus: record.status,
            expectedStatusVersion: record.statusVersion,
            nextStatus: "provisioning",
            updatedAt: new Date().toISOString(),
          });
        }
        if (record.status === "provisioning") {
          record = await sessionControl.transitionSessionStatus({
            sessionId,
            expectedStatus: record.status,
            expectedStatusVersion: record.statusVersion,
            nextStatus: "active",
            updatedAt: new Date().toISOString(),
          });
        }
        if (record.status === "active") {
          if (recoveryCheckpointCoordinator) {
            const checkpoint = await recoveryCheckpointCoordinator.inspect(
              sessionId,
            );
            if (checkpoint.status === "mismatch") {
              throw new SessionControlError(
                "checkpoint_tampered",
                "恢复检查点锚点未变化，但持久数据哈希不一致",
                {
                  sessionId,
                  checkpointPayloadHash: checkpoint.checkpointPayloadHash,
                  currentPayloadHash: checkpoint.payloadHash,
                },
              );
            }
          }
          activeSessionIds.push(sessionId);
        }
      } catch (error) {
        if (record) await transitionToRecoveryFailed(record, error);
      }
    }
    for (const record of await sessionControl.listSessions()) {
      try {
        await ensureSessionExperienceDescriptor({
          sessionId: record.sessionId,
          frozenAt: record.createdAt,
          compatibility: "historical",
        });
      } catch (error) {
        const hasFrozenDescriptor = await sessionExperienceDescriptorStore.get(
          record.sessionId,
        );
        if (hasFrozenDescriptor) throw error;
        if (
          !(error instanceof SessionNotFoundError)
          && !(error instanceof SimulationSessionNotFoundError)
        ) throw error;
      }
    }
    for (const seedSession of seedSessions) {
      registerCourseLaunchForSession(
        seedSession.sessionId,
        seedSession.releaseId,
        seedSession.courseReleaseRef,
      );
    }
    orchestrator.start(activeSessionIds);
    mediaOrchestrator.start(activeSessionIds);
    const recoverActiveSessions = async (): Promise<void> => {
      await Promise.all(activeSessionIds.map(async (sessionId) => {
        try {
          await orchestrator.drainUntilIdle(sessionId);
          await mediaOrchestrator.drainUntilIdle(sessionId);
          if (recoveryCheckpointCoordinator) {
            await recoveryCheckpointCoordinator.record(sessionId);
          }
        } catch (error) {
          const record = await sessionControl.getSession(sessionId);
          if (record) await transitionToRecoveryFailed(record, error);
        }
      }));
    };
    if (options.awaitStartupRecovery ?? Boolean(options.engine)) {
      await recoverActiveSessions();
    } else {
      startupRecoveryPromise = recoverActiveSessions();
    }
  }
  await flagshipExperienceV4.recoverPendingDialogues();
  if (recoverTeachingTasks) await teachingTaskRuntime.recoverPending(principalId => {
    const profile = demoProfileDefinitions.find(item => item.principalId === principalId && item.role === "student");
    return profile ? { principalId, actorId: "student-reporter", role: "student", classroomId: profile.classroomId,
      sourceSessionId: profile.defaultSessionId ?? DEMO_XUNPU_SESSION_ID, teamId: profile.teamId, profileId: profile.profileId } : null;
  }, (sessionId, error) => app.log.warn({ sessionId, err: error }, "委托场次创建仍待恢复，原权威收据已保留"));
  await flagshipExperienceV4.fieldInterview?.recoverInterruptedAttempts();
  app.addHook("preClose", async () => { await flagshipExperienceV4.fieldInterview?.close(); });
  for (const operation of await businessOperations.list()) {
    if (operation.operationKind !== "submit_work_revision" || operation.phase === "completed" || !operation.authorityCommitRef) continue;
    try {
      await flagshipStudentWorkV3.recoverSubmissionProjection(operation);
    } catch (error) {
      // A projection failure must remain visible without taking the diagnostic UI offline.
      app.log.warn({ operationId: operation.operationId, err: error }, "作品权威提交已保留，投影恢复仍待处理");
    }
  }
  await businessOperations.audit();
  await sessionExperienceDescriptorService.audit();
  app.addHook("onClose", async () => {
    try {
      await Promise.all([
        orchestrator.stop(),
        mediaOrchestrator.stop(),
      ]);
      await startupRecoveryPromise;
      if (recoveryCheckpointCoordinator) {
        const activeControlSessionIds = (await sessionControl.listSessions())
          .filter((record) => record.status === "active")
          .map((record) => record.sessionId);
        // SessionControl also owns V3 simulation-only sessions such as the
        // adaptive second world. The legacy recovery coordinator captures a
        // WorldEngine journal and must not be asked to checkpoint those
        // independently persisted V3 records.
        const closingSessionIds = (await Promise.all(
          activeControlSessionIds.map(async (sessionId) => {
            try {
              await engine.getScenarioPackage(sessionId);
              return sessionId;
            } catch (error) {
              if (error instanceof SessionNotFoundError) return null;
              throw error;
            }
          }),
        )).filter((sessionId): sessionId is string => sessionId !== null);
        await Promise.all(closingSessionIds.map(async (sessionId) => {
          try {
            await recoveryCheckpointCoordinator.record(sessionId);
          } catch (error) {
            app.log.error(
              { error, sessionId },
              "failed to write shutdown recovery checkpoint",
            );
          }
        }));
      }
    } finally {
      await dataDirectoryLease?.release();
    }
  });
  return app;
}

async function createAppInternal(
  options: CreateAppOptions,
  storageMode: "persistent" | "memory-test",
): Promise<FastifyInstance> {
  const requestedDataDir = resolve(
    options.dataDir ?? resolve(process.cwd(), ".data"),
  );
  const dataDirectoryLease = storageMode === "memory-test"
    ? null
    : await acquireLocalDataDirectoryLease({
        dataDir: requestedDataDir,
        purpose: "api-runtime",
      });
  const dataDir = dataDirectoryLease?.dataDir ?? requestedDataDir;
  try {
    if (dataDirectoryLease) {
      try {
        await readFile(
          resolve(dataDir, LOCAL_DATA_RESTORE_OWNER_FILE),
          "utf8",
        );
        throw new Error(
          "DATA_DIR 含有未完成恢复标记；请先核验或清理该恢复目标",
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    return await createAppWithLease(options, dataDir, dataDirectoryLease);
  } catch (error) {
    try {
      await dataDirectoryLease?.release();
    } catch (releaseError) {
      throw new AggregateError(
        [error, releaseError],
        "API 初始化失败且数据目录租约释放失败",
      );
    }
    throw error;
  }
}

/**
 * Production-facing construction always uses persistent local storage and
 * acquires the canonical DATA_DIR lease before any store can be initialized.
 */
export async function createApp(
  options: CreateAppOptions = {},
): Promise<FastifyInstance> {
  return createAppInternal(options, "persistent");
}

/**
 * Test-only construction for isolated in-memory WorldEngine fixtures.
 *
 * The guard deliberately reads the real process environment instead of the
 * caller-supplied application environment, so production callers cannot forge
 * NODE_ENV through CreateAppOptions to bypass the DATA_DIR lease.
 */
export async function createMemoryTestApp(
  options: CreateAppOptions & { engine: WorldEngine },
): Promise<FastifyInstance> {
  if (process.env.NODE_ENV !== "test") {
    throw new Error(
      "内存测试应用仅允许由 NODE_ENV=test 的测试进程创建",
    );
  }
  return createAppInternal(options, "memory-test");
}
