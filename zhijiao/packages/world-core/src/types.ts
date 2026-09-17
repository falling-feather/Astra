import type {
  AgentAssistanceProposal,
  Assessment,
  ArtifactRevision,
  CandidateEvent,
  Evidence,
  EvaluationArbitration,
  EvaluationCase,
  EvaluationEvidenceBundle,
  EvaluationProposal,
  GovernanceFinding,
  GovernanceReview,
  LearningArtifactRelease,
  LearningCandidate,
  LearningCandidateReview,
  LearningReleaseRollback,
  LearningReplayReport,
  Material,
  MediaProcessingTask,
  Observation,
  ProductionArtifact,
  ProductionSubmission,
  RoleInteractionRecord,
  RoleMessage,
  ResourceAudience,
  SceneDirectorDecision,
  ScenarioIntervention,
  ScenarioNode,
  ScenarioPackage,
  TeachingDirective,
  TeacherAssessmentReview,
  WorldEvent,
  WorldFact,
} from "@ronggang/contracts";

export interface WorldState {
  sessionId: string;
  sessionEpoch: string;
  scenario: ScenarioPackage;
  stateVersion: number;
  status: "ready" | "running" | "paused" | "review" | "completed";
  currentNodeId: string;
  virtualMinute: number;
  nodes: ScenarioNode[];
  materials: Material[];
  facts: WorldFact[];
  observations: Observation[];
  mediaProcessingTasks: MediaProcessingTask[];
  governanceReviews: GovernanceReview[];
  governanceFindings: GovernanceFinding[];
  productionArtifacts: ProductionArtifact[];
  artifactRevisions: ArtifactRevision[];
  productionSubmissions: ProductionSubmission[];
  agentAssistance: AgentAssistanceProposal[];
  evidence: Evidence[];
  candidates: CandidateEvent[];
  teachingDirectives: TeachingDirective[];
  sceneDirectorDecisions: SceneDirectorDecision[];
  activeInterventions: ScenarioIntervention[];
  assessments: Assessment[];
  evaluationEvidenceBundles: EvaluationEvidenceBundle[];
  evaluationCases: EvaluationCase[];
  evaluationProposals: EvaluationProposal[];
  evaluationArbitrations: EvaluationArbitration[];
  teacherAssessmentReviews: TeacherAssessmentReview[];
  learningCandidates: LearningCandidate[];
  learningReplayReports: LearningReplayReport[];
  learningCandidateReviews: LearningCandidateReview[];
  learningReleases: LearningArtifactRelease[];
  learningReleaseRollbacks: LearningReleaseRollback[];
  activeLearningReleaseId: string | null;
  messages: RoleMessage[];
  roleInteractions: RoleInteractionRecord[];
  events: WorldEvent[];
}

export interface EventDraft {
  eventType: WorldEvent["eventType"];
  actorId: string;
  summary: string;
  visibility: WorldEvent["visibility"];
  visibleToActorIds?: string[];
  audience?: ResourceAudience;
  payload?: Record<string, unknown>;
}

export interface IdGenerator {
  next(prefix: string): string;
}

export interface Clock {
  now(): string;
}

export const systemClock: Clock = {
  now: () => new Date().toISOString(),
};

export const randomIds: IdGenerator = {
  next: (prefix) => `${prefix}-${crypto.randomUUID()}`,
};
