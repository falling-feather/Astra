export const CourseContentSchemaVersion = "course-content/1.0.0" as const;
export const CourseReleaseTargetSchemaVersion = "course-release/2.0.0" as const;
export const KnowledgeRecordSchemaVersion = "course-knowledge/1.0.0" as const;

export type KnowledgeReviewStatus =
  | "verified"
  | "pending_expert_review"
  | "retired";

export type SourcePublicationStatus =
  | "current"
  | "historical_status_marker";

export interface PublicSource {
  sourceId: string;
  title: string;
  publisher: string;
  url: string;
  publicationDate: string;
  accessedAt: string;
  locator: string;
  sourceVersion: string;
  publicationStatus: SourcePublicationStatus;
  accessStatus: "reachable_on_check_date";
  storedExcerpt: null;
  rightsNote: string;
}

export interface KnowledgeRecordDraft {
  schemaVersion: typeof KnowledgeRecordSchemaVersion;
  knowledgeId: string;
  topic: string;
  teachingSummary: string;
  applicableSectionIds: readonly string[];
  source: PublicSource;
  reviewStatus: KnowledgeReviewStatus;
  reviewNote: string;
  reusePolicy: "metadata_link_and_paraphrase_only";
}

export interface KnowledgeRecord extends KnowledgeRecordDraft {
  contentHash: string;
}

export interface LearningObjective {
  objectiveId: string;
  description: string;
  competencyRef: string;
}

export interface HiddenFact {
  factId: string;
  visibility: "teacher_and_engine";
  summary: string;
  revealCondition: string;
  requiredEvidenceIds: readonly string[];
}

export interface ExecutableAction {
  actionId: string;
  label: string;
  intent: string;
  guidance: string;
  requiredKnowledgeIds: readonly string[];
  producesEvidenceIds: readonly string[];
  primary: boolean;
}

export interface DynamicEvent {
  eventId: string;
  trigger: {
    kind: "on_action" | "on_evidence_count" | "on_section_submit";
    ref: string;
  };
  studentBrief: string;
  hiddenPayload: string;
  affectedAgentIds: readonly string[];
  candidateAgentIds: readonly string[];
  teacherApprovalRequired: boolean;
}

export interface AgentSelectionRule {
  ruleId: string;
  affectedAgentIds: readonly string[];
  candidateAgentIds: readonly string[];
  selectWhen: string;
  skipWhen: string;
  maximumSelectedAgents: number;
}

export interface StageArtifact {
  artifactId: string;
  label: string;
  format: "structured_form" | "article" | "script" | "evidence_bundle";
  completionCriteria: readonly string[];
  finalCourseArtifact: boolean;
}

export interface EvidenceRequirement {
  evidenceId: string;
  label: string;
  description: string;
  minimumCount: number;
  acceptedSourceKinds: readonly (
    | "public_source"
    | "interview_note"
    | "field_observation"
    | "authorization_record"
    | "agent_decision"
    | "artifact_revision"
    | "teacher_decision"
  )[];
}

export interface RubricCriterion {
  criterionId: string;
  label: string;
  weight: number;
  observable: string;
  failClosedWhen: string;
}

export interface TeacherGate {
  gateId: string;
  label: string;
  trigger: "before_section_complete" | "before_publish";
  checks: readonly string[];
  minimumEvidenceCount: number;
  rejectReturnsToActionId: string;
}

export interface MigrationReflection {
  prompt: string;
  targetContext: string;
  requiredComparisonDimensions: readonly string[];
}

export interface CourseSection {
  sectionId: string;
  order: number;
  title: string;
  typicalWorkTask: string;
  objectives: readonly LearningObjective[];
  taskBrief: string;
  publicSourceKnowledgeIds: readonly string[];
  hiddenFacts: readonly HiddenFact[];
  actions: readonly ExecutableAction[];
  dynamicEvents: readonly DynamicEvent[];
  agentSelectionRules: readonly AgentSelectionRule[];
  adviceDecisionPolicy: {
    allowedDecisions: readonly ["accept", "request_more_evidence", "reject"];
    rationaleRequiredOnReject: true;
    onlyOneVisibleSuggestionAtATime: true;
  };
  artifact: StageArtifact;
  evidenceRequirements: readonly EvidenceRequirement[];
  rubric: readonly RubricCriterion[];
  teacherGate: TeacherGate;
  migrationReflection: MigrationReflection;
}

export interface CourseReleaseRefDraft {
  courseId: string;
  releaseId: string;
  version: string;
}

export interface CourseReleaseRef extends CourseReleaseRefDraft {
  contentHash: string;
}

export interface CourseContentReleaseDraft {
  schemaVersion: typeof CourseContentSchemaVersion;
  targetContract: typeof CourseReleaseTargetSchemaVersion;
  releaseRef: CourseReleaseRefDraft;
  releaseStatus: "content_frozen_pending_contract_integration";
  contentFrozenAt: string;
  sourceAccessCheckedAt: string;
  locale: "zh-CN";
  title: string;
  summary: string;
  primaryJob: {
    jobId: "integrated-media-reporter";
    label: "融媒体采编岗";
    learnerRoleId: "reporter";
    learnerRoleLabel: "记者";
  };
  durationMinutes: number;
  courseOutcomes: readonly string[];
  sections: readonly CourseSection[];
  knowledgeRecords: readonly KnowledgeRecord[];
  simulationPolicy: {
    hiddenFactsAreFictionalized: true;
    realPersonClaimsAllowed: false;
    description: string;
  };
  mediaPolicy: {
    repositoryMediaAssets: readonly [];
    rule: "no_unlicensed_image_audio_or_video";
    description: string;
  };
}

export interface CourseContentRelease
  extends Omit<CourseContentReleaseDraft, "releaseRef"> {
  releaseRef: CourseReleaseRef;
}

export interface CourseContentValidationIssue {
  code: string;
  path: string;
  message: string;
}

export interface CourseContentValidationReport {
  valid: boolean;
  sectionCount: number;
  knowledgeRecordCount: number;
  qualifiedKnowledgeRecordCount: number;
  referencedKnowledgeRecordCount: number;
  dynamicEventCount: number;
  issues: readonly CourseContentValidationIssue[];
}
