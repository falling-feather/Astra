import type { DialogueSceneDefinitionV4 } from "@ronggang/contracts";
import type { CourseSection } from "../types.js";

export const XunpuFlagshipContentV4SchemaVersion =
  "xunpu-flagship-content/4.0.0" as const;

export type XunpuWorldVariableId =
  | "community_trust"
  | "source_access"
  | "evidence_confidence"
  | "editorial_independence"
  | "copyright_risk"
  | "public_safety_risk"
  | "deadline_pressure"
  | "public_trust"
  | "reach_potential"
  | "correction_debt"
  | "platform_risk";

export type XunpuStudentIntentV4 =
  | "observe"
  | "ask"
  | "probe"
  | "inspect"
  | "compare"
  | "cite"
  | "negotiate"
  | "record"
  | "import_media"
  | "transcribe"
  | "annotate"
  | "replace"
  | "draft"
  | "save_revision"
  | "request_advice"
  | "request_evidence"
  | "accept_advice"
  | "reject_advice"
  | "wait"
  | "escalate"
  | "submit_gate"
  | "publish"
  | "correct"
  | "request_pause";

export type XunpuSemanticOutcomeV4 =
  | "accepted"
  | "clarification_required"
  | "refused";

export interface XunpuWorldStateDeltaV4 {
  variableId: XunpuWorldVariableId;
  delta: number;
  rationale: string;
}

export interface XunpuLocationV4 {
  locationId: string;
  title: string;
  publicDescription: string;
  objectRefs: string[];
  npcRefs: string[];
  allowedIntents: XunpuStudentIntentV4[];
}

export interface XunpuWorldObjectV4 {
  objectId: string;
  objectKind:
    | "document"
    | "source_packet"
    | "message_capture"
    | "media_collection"
    | "rights_record"
    | "claim_graph"
    | "world_clock"
    | "artifact_workspace";
  title: string;
  initialState: string;
  allowedIntents: XunpuStudentIntentV4[];
  evidenceBearing: boolean;
}

export interface XunpuWorldVariableV4 {
  variableId: XunpuWorldVariableId;
  title: string;
  initialValue: number;
  minimum: 0;
  maximum: 100;
  higherMeans: string;
  studentProjection: string;
}

export interface XunpuTimelineBeatV4 {
  beatId: string;
  eventId: string;
  worldMinute: number;
  title: string;
  triggerKinds: Array<"session" | "student_action" | "npc_plan" | "clock" | "threshold">;
  triggerRule: string;
  proactive: boolean;
  canBePreempted: boolean;
  affectedObjectRefs: string[];
}

export interface XunpuExperienceActV4 {
  actId: string;
  title: string;
  startMinute: number;
  endMinute: number;
  primaryObjective: string;
  requiredBeatRefs: string[];
  requiredArtifactRefs: string[];
  decisionPressure: string;
  completionSignal: string;
}

export interface XunpuNpcV4 {
  roleId: string;
  entityId: string;
  displayName: string;
  professionalRole: string;
  publicGoal: string;
  privatePressure: string;
  localKnowledgeRefs: string[];
  memoryKeys: string[];
  planSteps: Array<{
    planStepId: string;
    trigger: string;
    intent: string;
  }>;
  refusalConditions: string[];
  recoveryConditions: string[];
  disclosureRules: string[];
  simulationNotice: string;
}

export interface XunpuConflictRouteV4 {
  routeId: string;
  label: string;
  steps: string[];
  tradeoff: string;
  stateDeltas: XunpuWorldStateDeltaV4[];
}

export interface XunpuConflictDomainV4 {
  conflictDomainId: string;
  title: string;
  activationRules: string[];
  proactiveTriggerKinds: Array<"npc" | "clock" | "threshold">;
  actorRefs: string[];
  objectRefs: string[];
  availableIntents: XunpuStudentIntentV4[];
  legalRoutes: XunpuConflictRouteV4[];
  riskyActions: Array<{
    riskyActionId: string;
    description: string;
    stateDeltas: XunpuWorldStateDeltaV4[];
    formalWriteAllowed: false;
  }>;
  recoveryConditions: string[];
  artifactRefs: string[];
}

export interface XunpuGrayDilemmaV4 {
  dilemmaId: string;
  title: string;
  activationRules: string[];
  actorRefs: string[];
  competingValues: [string, string];
  legitimateChoices: Array<{
    choiceRef: string;
    label: string;
    professionalRationale: string;
    requiredEvidenceKinds: string[];
    opportunityCosts: string[];
    stateDeltas: XunpuWorldStateDeltaV4[];
  }>;
  prohibitedShortcuts: string[];
  artifactRefs: string[];
  noSingleCorrectAnswer: true;
}

export interface XunpuPostPublicationResponseArcV4 {
  responseArcId: string;
  title: string;
  triggerRule: string;
  actorRefs: string[];
  publicOpening: string;
  outcomeVariants: Array<{
    variantRef: string;
    when: string;
    publicResponse: string;
    studentResponseOptions: string[];
    requiredEvidenceKinds: string[];
    stateDeltas: XunpuWorldStateDeltaV4[];
  }>;
  prohibitedShortcuts: string[];
  followUpArtifactRefs: string[];
}

export interface XunpuFlagshipRouteV4 {
  routeId: string;
  routeKind:
    | "community_story"
    | "evidence_explainer"
    | "service_update"
    | "traffic_recovery";
  title: string;
  openingAction: string;
  requiredBeatRefs: string[];
  requiredArtifactRefs: string[];
  requiredEvidenceKinds: string[];
  opportunityCosts: string[];
  expectedStateDeltas: XunpuWorldStateDeltaV4[];
  successConditions: string[];
  preservesInitialFailureEvidence: boolean;
}

export interface XunpuSemanticSampleV4 {
  sampleId: string;
  sampleGroup: string;
  worldStateRef: string;
  utterance: string;
  selectedObjectRefs: string[];
  attachedAssetRefs: string[];
  expectedIntent: XunpuStudentIntentV4 | null;
  expectedTargetRefs: string[];
  expectedOutcome: XunpuSemanticOutcomeV4;
  riskRefs: string[];
  allowedRuleRefs: string[];
  rationale: string;
  blindSplit: "train" | "validation" | "test";
}

export interface XunpuKnowledgeRecordV4 {
  knowledgeId: string;
  title: string;
  teachingSummary: string;
  sourceTitle: string;
  publisher: string;
  url: string;
  publishedAt: string;
  accessedAt: string;
  locator: string;
  sourceVersion: string;
  reviewStatus: "pending_expert_review";
  copyrightNote: string;
  storedExcerpt: "";
  contentHash: string;
}

export interface XunpuProfessionalReviewItemV4 {
  reviewItemId: string;
  knowledgeRef: string;
  reviewFocus:
    | "cultural_context"
    | "fact_and_source"
    | "rights_and_privacy"
    | "content_governance"
    | "occupational_pedagogy";
  teachingUse: string;
  applicabilityBoundary: string;
  disputeOrExpiryRisk: string;
  reviewQuestion: string;
  requiredReviewerRoles: string[];
  freshnessPolicy:
    | "verify_on_each_release"
    | "verify_annually"
    | "verify_on_rule_change";
  sourceSnapshot: {
    sourceTitle: string;
    publisher: string;
    url: string;
    publishedAt: string;
    locator: string;
    sourceVersion: string;
    sourceContentHash: string;
  };
  reviewStatus: "pending_expert_review";
}

export interface XunpuProfessionalReviewPacketV4 {
  packetId: string;
  preparedAt: string;
  reviewStatus: "pending_expert_review";
  items: XunpuProfessionalReviewItemV4[];
  signoffRequirements: string[];
  reviewEvidenceMustBeExternal: true;
  noAutomaticVerificationClaim: true;
}

export interface XunpuMigrationSampleV4 {
  sampleId: string;
  sourcePatternRef: "manifest-xunpu-flagship-v4";
  targetCourseId: "course-village-super-multiplatform";
  transferHypothesis: string;
  section: CourseSection;
  serviceCodeChangeRequired: false;
}

export interface XunpuGroundedClaimV4 {
  claimId: string;
  allowedWording: string;
  knowledgeRefs: string[];
  runtimeEvidenceKinds: string[];
  prohibitedExpansion: string;
  minimumIndependentSupportCount: number;
}

export interface XunpuMediaAssetV4 {
  assetId: string;
  assetKind:
    | "environment_image"
    | "npc_portrait"
    | "source_image"
    | "audio"
    | "video"
    | "synthetic_capture";
  title: string;
  plannedRelativePath: string;
  creatorMode: "project_generated" | "project_produced";
  productionStatus: "planned" | "ready";
  usageScope: "teaching_simulation_only";
  personConsentMode: "not_applicable" | "simulated_character";
  aiExplicitLabel: boolean;
  aiImplicitMetadata: boolean;
  sourceFactBoundary: string;
  contentHash: string | null;
}

export interface XunpuAgentEpisodeTemplateV4 {
  episodeTemplateId: string;
  title: string;
  triggerRule: string;
  selectedAgentRefs: string[];
  requiredMoveSequence: Array<
    "proposal" | "challenge" | "evidence_request" | "revision" | "joint_proposal"
  >;
  groundedClaimRefs: string[];
  failureClosedWhen: string[];
  studentProjection: string;
}

export interface XunpuArtifactBlueprintV4 {
  artifactId: string;
  title: string;
  artifactKind:
    | "topic_brief"
    | "source_matrix"
    | "interview_plan_and_log"
    | "fact_check_sheet"
    | "rights_ledger"
    | "feature_story"
    | "multiplatform_package"
    | "publication_and_correction_decision"
    | "transfer_reflection";
  editableFields: Array<{
    fieldId: string;
    label: string;
    valueKind: "text" | "claim_graph" | "media_timeline" | "rights_table";
    minimumLength: number;
    maximumLength: number;
  }>;
  completionChecks: string[];
  evidenceRequirements: string[];
  artifactCompletionIsNotCompetencyScore: true;
}

export interface XunpuChallengeProfileV4 {
  challengeLevel: 3 | 4 | 5 | 6 | 7;
  scoreCeiling: 80 | 85 | 90 | 95 | 100;
  concurrentConflictLimit: number;
  scaffoldingBudget: number;
  npcResistance: string;
  deadlinePattern: string;
  protectionRules: string[];
}

export interface XunpuEndingV4 {
  endingId:
    | "ending-trusted-collaboration"
    | "ending-prudent-delay"
    | "ending-traffic-backlash"
    | "ending-governance-failure";
  title: string;
  conditionRule: string;
  learningMeaning: string;
}

export interface XunpuAssessmentCriterionV4 {
  criterionId: string;
  title: string;
  weight: number;
  minimumIndependentEvidenceCount: number;
  artifactRefs: string[];
  observableEvidence: string[];
  failClosedWhen: string[];
}

export interface XunpuWorkSampleV4 {
  sampleId: string;
  title: string;
  synopsis: string;
  traceRefs: string[];
  artifactRefs: string[];
  expectedJudgments: Array<{
    criterionId: string;
    band: "high" | "medium" | "low" | "insufficient_evidence";
    rationale: string;
  }>;
  expectedOverallConstraint: string;
}

export interface XunpuAdversarialPairV4 {
  pairId: string;
  leftSampleRef: string;
  rightSampleRef: string;
  invariant: string;
}

export interface XunpuAdaptationVariantV4 {
  variantId: string;
  title: string;
  triggerCriterionRefs: string[];
  triggerEvidenceRule: string;
  changedEventTemplateRefs: string[];
  npcResistance: string;
  evidenceAvailability: string;
  deadlinePattern: string;
  scaffoldingBudget: number;
  mechanicalDifferenceCount: number;
  successEvidence: string[];
}

export interface XunpuFlagshipContentV4Draft {
  schemaVersion: typeof XunpuFlagshipContentV4SchemaVersion;
  manifestId: string;
  version: number;
  title: string;
  premise: string;
  expectedDurationMinutes: 55;
  courseId: "course-xunpu-intangible-media";
  scenarioId: "scenario-xunpu-living-world";
  primaryJobId: "integrated_media_reporter";
  studentRoleId: "reporter";
  factBoundary: {
    allNamedPeopleAreSimulated: true;
    publicFactsRequireKnowledgeRefs: true;
    noExternalMediaCopied: true;
    expertReviewRequired: true;
  };
  locations: XunpuLocationV4[];
  worldObjects: XunpuWorldObjectV4[];
  variables: XunpuWorldVariableV4[];
  timelineBeats: XunpuTimelineBeatV4[];
  experienceActs: XunpuExperienceActV4[];
  cast: XunpuNpcV4[];
  dialogueScenes: DialogueSceneDefinitionV4[];
  conflictDomains: XunpuConflictDomainV4[];
  grayDilemmas: XunpuGrayDilemmaV4[];
  postPublicationResponseArcs: XunpuPostPublicationResponseArcV4[];
  flagshipRoutes: XunpuFlagshipRouteV4[];
  artifacts: XunpuArtifactBlueprintV4[];
  challengeProfiles: XunpuChallengeProfileV4[];
  endings: XunpuEndingV4[];
  baseKnowledgeRefs: string[];
  semanticSamples: XunpuSemanticSampleV4[];
  addedKnowledgeRecords: XunpuKnowledgeRecordV4[];
  professionalReviewPacket: XunpuProfessionalReviewPacketV4;
  groundedClaims: XunpuGroundedClaimV4[];
  mediaAssets: XunpuMediaAssetV4[];
  agentEpisodes: XunpuAgentEpisodeTemplateV4[];
  assessmentCriteria: XunpuAssessmentCriterionV4[];
  workSamples: XunpuWorkSampleV4[];
  adversarialPairs: XunpuAdversarialPairV4[];
  adaptationVariants: XunpuAdaptationVariantV4[];
  migrationSample: XunpuMigrationSampleV4;
}

export type XunpuFlagshipContentV4 = Readonly<
  XunpuFlagshipContentV4Draft & { contentHash: string }
>;

export interface XunpuContentIssueV4 {
  code: string;
  path: string;
  message: string;
}

export interface XunpuContentValidationV4 {
  valid: boolean;
  issues: XunpuContentIssueV4[];
}

export interface XunpuContentReadinessV4 {
  ready: boolean;
  blockers: XunpuContentIssueV4[];
}
