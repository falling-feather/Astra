import {
  ActionAuditContextSchema,
  ActionEnvelopeSchema,
  AgentAssistanceProposalSchema,
  AgentContributionDecisionEventPayloadSchema,
  AgentContributionProfilesByTemplateId,
  AgentRunResultSchema,
  AgentTaskSchema,
  AssessmentSchema,
  ArtifactRevisionSchema,
  CandidateEventSchema,
  CommandSchema,
  CreateProductionArtifactPayloadSchema,
  EvidenceSchema,
  EvaluationArbitrationSchema,
  EvaluationCaseSchema,
  EvaluationDimensionProposalSchema,
  EvaluationEvidenceBundleSchema,
  EvaluationProposalSchema,
  ExperienceChoiceCommandPayloadSchema,
  GovernanceExecutionTraceSchema,
  GovernanceFindingSchema,
  GovernanceModelDecisionSchema,
  GovernanceRecommendationSchema,
  GovernanceReviewSchema,
  LearningCandidateSchema,
  LearningCandidateReviewSchema,
  LearningArtifactReleaseSchema,
  LearningReleaseRollbackSchema,
  LearningReplayReportSchema,
  MaterialSchema,
  MediaProcessingOutputSchema,
  MediaProcessingTaskSchema,
  ObservationSchema,
  OutboxRecordSchema,
  ProductionArtifactSchema,
  ProductionSubmissionSchema,
  RequestMediaProcessingPayloadSchema,
  RequestGovernanceReviewPayloadSchema,
  PublishLearningReleasePayloadSchema,
  ReviewAssessmentPayloadSchema,
  ReviewLearningCandidatePayloadSchema,
  RetryEvaluationBranchPayloadSchema,
  RetryLearningCandidateGenerationPayloadSchema,
  RetryMediaProcessingPayloadSchema,
  RollbackLearningReleasePayloadSchema,
  ReviewGovernancePayloadSchema,
  RoleInteractionCommandPayloadSchema,
  RoleInteractionRequestSchema,
  RoleInteractionResponseSchema,
  RoleInteractionSchemaVersion,
  RoleMessageSchema,
  RoleResponseIntentSchema,
  SceneDirectorDecisionSchema,
  ScenarioInterventionSchema,
  SaveArtifactRevisionPayloadSchema,
  StateProjectionSchema,
  StudentAssessmentFeedbackSchema,
  SubmitForReviewPayloadSchema,
  SupplyMediaProcessingResultPayloadSchema,
  TeachingDirectiveSchema,
  TeacherAssessmentReviewSchema,
  WorldEventSchema,
  WorldFactSchema,
  createMessageMeta,
  type ActionDefinition,
  type ActionAuditContext,
  type ActionActorContext,
  type ActionEnvelope,
  type AgentAssistanceProposal,
  type AgentRunResult,
  type AgentTask,
  type Assessment,
  type ArtifactCitation,
  type ArtifactCitationInput,
  type ArtifactRevision,
  type CandidateEvent,
  type Command,
  type Evidence,
  type EvaluationArbitration,
  type EvaluationCase,
  type EvaluationEvaluatorKind,
  type EvaluationProposal,
  type GovernanceFinding,
  type GovernanceRecommendation,
  type GovernanceReview,
  type GovernanceSeverity,
  type Material,
  type MediaProcessingOutput,
  type MediaProcessingTask,
  type Observation,
  type PublishedScenarioPackage,
  type RoleContract,
  type RoleInteractionOption,
  type RoleInteractionRequest,
  type RoleCommitment,
  type RoleResponseAct,
  type RoleResponseIntent,
  type RoleStance,
  type ResourceAudience,
  type ProductionArtifact,
  type ProductionArtifactTemplate,
  type ProductionSubmission,
  type SceneDirectorDecision,
  type ScenarioDirectorEventTemplate,
  type ScenarioIntervention,
  type ScenarioPackage,
  type ScenarioPackageRef,
  type ScenarioRoleInteraction,
  type StateProjection,
  type StudentAssessmentFeedback,
  type TeachingDirective,
  type TeacherAssessmentReview,
  type VisibilityScope,
  type WorldEvent,
  type WorldFact,
} from "@ronggang/contracts";
import {
  authorizeResource,
  createScopedAgentInstanceBinding,
  createAccessSubject,
  createResourceAudience,
  hashValue,
  roleBindingConfigHash,
  roleMemoryNamespace,
} from "@ronggang/context-engine";
import { demoScenario } from "./scenario.js";
import {
  arbitrateGovernanceFindings,
  governancePolicyVersion,
  isGovernanceVerdictReleasable,
  recommendationFromExtracted,
  recommendationFromOutput,
} from "./governance.js";
import {
  buildGovernanceExecutionContext,
  compileGovernanceModelPrompt,
  evaluateGovernanceExecution,
} from "./governance-execution.js";
import {
  arbitrateEvaluationProposals,
  createEvaluationCase,
  createRuleEvaluationProposal,
  createSemanticEvaluationProposal,
  createUnavailableEvaluationProposal,
} from "./evaluation.js";
import {
  createLearningArtifactRelease,
  createLearningCandidate,
  createLearningCandidateReview,
  createLearningReleaseRollback,
  runLearningCandidateReplay,
} from "./learning.js";
import {
  StaticScenarioReleaseResolver,
  createStaticScenarioRelease,
  scenarioRefFromSessionStarted,
  type ScenarioReleaseResolver,
} from "./scenario-resolver.js";
import {
  buildStructuredWorldStage,
  deriveCurrentTaskAnchor,
} from "./structured-world.js";
import { deriveAuthoredExperienceSequence } from "./experience-sequencing.js";
import {
  InMemoryEventStore,
  InProcessMessageBus,
  StateVersionConflictError,
  type EventStore,
  type MessageBus,
} from "./store.js";
import {
  randomIds,
  systemClock,
  type Clock,
  type EventDraft,
  type IdGenerator,
  type WorldState,
} from "./types.js";

export class SessionNotFoundError extends Error {
  constructor(sessionId: string) {
    super(`实训会话不存在：${sessionId}`);
    this.name = "SessionNotFoundError";
  }
}

export class PermissionDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermissionDeniedError";
  }
}

export class InvalidWorldActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidWorldActionError";
  }
}

export class DomainRevisionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainRevisionConflictError";
  }
}

export class ScenarioVersionMismatchError extends Error {
  constructor(
    public readonly expected: string,
    public readonly actual: string,
  ) {
    super(`情境版本不匹配：当前 ${expected}，事件日志 ${actual}`);
    this.name = "ScenarioVersionMismatchError";
  }
}

export interface EngineOptions {
  scenario?: ScenarioPackage;
  scenarioResolver?: ScenarioReleaseResolver;
  defaultRelease?: PublishedScenarioPackage;
  store?: EventStore;
  bus?: MessageBus;
  clock?: Clock;
  ids?: IdGenerator;
}

const assignedVisibility: VisibilityScope[] = ["assigned_team", "audit_only"];
const teacherVisibility: VisibilityScope[] = ["teacher_only", "audit_only"];

const teachingDirectorObservableEventTypes = new Set<WorldEvent["eventType"]>([
  "session_started",
  "node_activated",
  "world_fact_confirmed",
  "world_fact_updated",
  "evidence_recorded",
  "copyright_risk_flagged",
  "publication_paused",
]);

const sceneDirectorObservableEventTypes = new Set<WorldEvent["eventType"]>([
  "session_started",
  "node_activated",
  "world_fact_confirmed",
  "world_fact_updated",
  "evidence_recorded",
  "director_recovery_requested",
]);

const evaluatorKindByAgentId: Readonly<Record<string, Exclude<EvaluationEvaluatorKind, "rule">>> = {
  "agent-assessor": "evidence_sufficiency",
  "agent-evidence-assessor": "evidence_sufficiency",
  "agent-work-quality-assessor": "work_quality",
  "agent-collaboration-assessor": "professional_collaboration",
};

const maximumManualAgentRetries = 3;

function roleCanExecuteCommand(
  role: RoleContract,
  commandName: Command["name"],
): boolean {
  if (role.allowedIntents.includes(commandName)) return true;
  // GAME-002 compatibility bridge: this command only selects a task already
  // exposed by the role-safe experience projection. The authoritative handler
  // rechecks the current node and task roleIds, so existing immutable scenario
  // releases do not need a role-contract hash change.
  if (
    commandName === "record_experience_choice"
    && role.actorKind === "student"
  ) {
    return true;
  }
  if (
    commandName === "record_agent_contribution_decision"
    && role.actorKind === "student"
  ) {
    return true;
  }
  if (role.actorKind !== "teacher") return false;
  // V0.7.0 compatibility bridge: retry is a narrower compensation action
  // under the already-versioned review capability, so active scenario releases
  // keep their immutable content hash.
  return (
    (
      commandName === "retry_evaluation_branch"
      && role.toolPolicy.includes("evaluation.court.review")
    )
    || (
      commandName === "retry_learning_candidate_generation"
      && role.toolPolicy.includes("learning.candidate.review")
    )
  );
}

function agentInstanceBindingKind(
  role: RoleContract,
): AgentTask["instanceContext"]["bindingKind"] {
  if (role.actorKind === "student") return "student_role";
  if (role.actorKind === "system" || role.roleId === "system") return "system";
  if (
    role.roleId === "interviewee"
    || role.roleId === "copyright_owner"
    || role.roleId === "editor_in_chief"
    || role.roleId === "platform_operator"
  ) {
    return "npc";
  }
  return "teacher_assistant";
}

function evaluatorKindForRole(
  role: RoleContract,
): Exclude<EvaluationEvaluatorKind, "rule"> | null {
  return evaluatorKindByAgentId[role.agentId] ?? null;
}

function evaluatorAgentIdForKind(
  state: WorldState,
  evaluatorKind: Exclude<EvaluationEvaluatorKind, "rule">,
): string | null {
  return state.scenario.roles.find((role) => (
    role.actorKind === "agent"
    && role.roleId === "assessor"
    && evaluatorKindForRole(role) === evaluatorKind
    && role.allowedIntents.includes("record_evaluation_proposal")
  ))?.agentId ?? null;
}

function latestEvaluationProposal(
  state: WorldState,
  evaluationCaseId: string,
  evaluatorKind: Exclude<EvaluationEvaluatorKind, "rule">,
): EvaluationProposal | null {
  return state.evaluationProposals.findLast((proposal) => (
    proposal.evaluationCaseId === evaluationCaseId
    && proposal.evaluatorKind === evaluatorKind
  )) ?? null;
}

function canAppendEvaluationRetryResult(input: {
  state: WorldState;
  triggerEvent: WorldEvent;
  evaluationCase: EvaluationCase;
  evaluatorKind: Exclude<EvaluationEvaluatorKind, "rule">;
}): boolean {
  const latest = latestEvaluationProposal(
    input.state,
    input.evaluationCase.evaluationCaseId,
    input.evaluatorKind,
  );
  if (input.triggerEvent.eventType === "evaluation_case_opened") {
    return latest === null;
  }
  if (input.triggerEvent.eventType !== "evaluation_branch_retry_requested") {
    return false;
  }
  return Boolean(
    latest
    && latest.status === "unavailable"
    && input.triggerEvent.payload.evaluationCaseId
      === input.evaluationCase.evaluationCaseId
    && input.triggerEvent.payload.evaluatorKind === input.evaluatorKind
    && input.triggerEvent.payload.expectedUnavailableProposalId
      === latest.proposalId
    && input.triggerEvent.payload.expectedUnavailableProposalHash
      === latest.proposalHash
    && input.triggerEvent.payload.expectedCaseHash
      === input.evaluationCase.caseHash
    && input.triggerEvent.payload.expectedEvidenceBundleHash
      === input.evaluationCase.evidenceBundleHash
    && !input.state.teacherAssessmentReviews.some((review) => (
      review.evaluationCaseId === input.evaluationCase.evaluationCaseId
    )),
  );
}

type CandidateDraftInput = Pick<
  CandidateEvent,
  | "eventType"
  | "title"
  | "triggerReason"
  | "competencyTarget"
  | "expectedImpact"
  | "payload"
  | "proposedBy"
  | "approvalPolicyId"
> & Partial<Omit<
  CandidateEvent,
  | "candidateId"
  | "status"
  | "proposedAt"
  | "eventType"
  | "title"
  | "triggerReason"
  | "competencyTarget"
  | "expectedImpact"
  | "payload"
  | "proposedBy"
  | "approvalPolicyId"
>> & { now: string };

function upsert<T>(items: T[], item: T, key: (value: T) => string): T[] {
  const index = items.findIndex((candidate) => key(candidate) === key(item));
  if (index === -1) return [...items, item];
  return items.map((candidate, candidateIndex) => candidateIndex === index ? item : candidate);
}

function compareSemanticVersions(left: string, right: string): number {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const delta = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function hasEvent(state: WorldState, eventType: WorldEvent["eventType"]): boolean {
  return state.events.some((event) => event.eventType === eventType);
}

function projectionRiskLevel(
  state: WorldState,
  role: RoleContract,
): "low" | "medium" | "high" {
  if (hasEvent(state, "copyright_risk_flagged")) return "high";
  const relevantInterventions = state.activeInterventions.filter(
    (intervention) => {
      if (
        role.actorKind !== "teacher"
        && !intervention.affectedRoleIds.includes(role.roleId)
      ) {
        return false;
      }
      const template = state.scenario.directorEventTemplates?.find(
        (candidate) => candidate.routeId === intervention.routeId,
      );
      return !template || template.applicableNodeIds.includes(
        state.currentNodeId,
      );
    },
  );
  if (relevantInterventions.some((item) => item.riskLevel === "high")) {
    return "high";
  }
  if (
    relevantInterventions.some((item) => item.riskLevel === "medium")
    || currentPendingCandidates(state).length > 0
  ) {
    return "medium";
  }
  return "low";
}

function hasEvidenceAction(state: WorldState, action: string): boolean {
  return state.evidence.some((evidence) => evidence.action === action);
}

function settledProcessingStatus(task: MediaProcessingTask): "partially_succeeded" | "succeeded" | "failed" {
  const succeeded = task.steps.filter((step) => (
    step.status === "succeeded" || step.status === "manually_completed"
  )).length;
  if (succeeded === task.steps.length) return "succeeded";
  return succeeded > 0 ? "partially_succeeded" : "failed";
}

function governanceSeverity(
  recommendation: GovernanceRecommendation,
): GovernanceSeverity {
  switch (recommendation) {
    case "block":
      return "blocking";
    case "unavailable":
      return "high";
    case "revise":
      return "high";
    case "review":
      return "warning";
    case "allow":
      return "info";
  }
}

function governanceRiskLabels(
  output: MediaProcessingOutput | null,
): string[] {
  const labels = output?.extracted.riskLabels;
  if (!Array.isArray(labels)) return [];
  return [...new Set(
    labels
      .filter((label): label is string => typeof label === "string")
      .map((label) => label.trim().slice(0, 120))
      .filter(Boolean),
  )].slice(0, 40);
}

function hasUsableProcessingOutput(state: WorldState): boolean {
  return state.mediaProcessingTasks.some((task) => task.steps.some((step) => (
    step.status === "succeeded" || step.status === "manually_completed"
  )));
}

function artifactTemplate(
  state: WorldState,
  templateId: string,
): ProductionArtifactTemplate {
  const template = state.scenario.productionConfig?.artifactTemplates.find(
    (item) => item.templateId === templateId,
  );
  if (!template) throw new InvalidWorldActionError(`成果模板不存在：${templateId}`);
  return template;
}

function hasMinimumArtifactRevisions(state: WorldState): boolean {
  return state.productionArtifacts.some((artifact) => {
    const template = state.scenario.productionConfig?.artifactTemplates.find(
      (item) => item.templateId === artifact.templateId,
    );
    return Boolean(template && artifact.revisionCount >= template.minimumRevisions);
  });
}

function latestEventId(state: WorldState, eventType: WorldEvent["eventType"]): string[] {
  const event = state.events.findLast((candidate) => candidate.eventType === eventType);
  return event ? [event.eventId] : [];
}

function directorPreconditionHash(state: WorldState): string {
  return hashValue({
    nodeId: state.currentNodeId,
    difficulty: state.scenario.directorConfig?.difficulty ?? null,
    facts: state.facts.map((fact) => ({
      factId: fact.factId,
      status: fact.status,
      version: fact.version,
    })).sort((left, right) => left.factId.localeCompare(right.factId)),
    evidenceIds: state.evidence.map((item) => item.evidenceId).sort(),
  });
}

function isCurrentPendingCandidate(
  state: WorldState,
  candidate: CandidateEvent,
): boolean {
  if (candidate.status !== "pending") return false;
  if (candidate.candidateKind !== "director_intervention") return true;
  return Boolean(
    candidate.preconditionHash
    && candidate.preconditionHash === directorPreconditionHash(state),
  );
}

function currentPendingCandidates(state: WorldState): CandidateEvent[] {
  return state.candidates.filter((candidate) => (
    isCurrentPendingCandidate(state, candidate)
  ));
}

function staleDirectorCandidateDrafts(state: WorldState): EventDraft[] {
  const currentHash = directorPreconditionHash(state);
  return state.candidates
    .filter((candidate) => (
      candidate.status === "pending"
      && candidate.candidateKind === "director_intervention"
      && candidate.preconditionHash !== currentHash
    ))
    .map((candidate) => ({
      eventType: "candidate_event_rejected" as const,
      actorId: "system",
      summary: `世界内核自动关闭失效导演候选：${candidate.title}`,
      visibility: teacherVisibility,
      payload: {
        candidateId: candidate.candidateId,
        reason: "审批前置状态已变化，候选由世界内核自动关闭",
        reviewedBy: "system",
        previousPreconditionHash: candidate.preconditionHash,
        currentPreconditionHash: currentHash,
        reasonCode: "director_precondition_changed",
      },
    }));
}

function directorDedupKey(
  state: WorldState,
  template: ScenarioDirectorEventTemplate,
  recoveryOfCandidateId: string | null,
): string {
  return [
    template.routeId,
    state.currentNodeId,
    state.scenario.directorConfig?.difficulty ?? "standard",
    directorPreconditionHash(state),
    recoveryOfCandidateId ?? "primary",
  ].join(":");
}

function sameActorSet(actual: readonly string[], expected: readonly string[]): boolean {
  const normalize = (items: readonly string[]) => [...new Set(items)].sort();
  return JSON.stringify(normalize(actual)) === JSON.stringify(normalize(expected));
}

export function createInitialState(sessionId: string, scenario: ScenarioPackage): WorldState {
  return {
    sessionId,
    sessionEpoch: `legacy-${sessionId}`,
    scenario,
    stateVersion: 0,
    status: "ready",
    currentNodeId: scenario.nodes[0]?.nodeId ?? "brief",
    virtualMinute: 0,
    nodes: structuredClone(scenario.nodes),
    materials: [],
    facts: [],
    observations: [],
    mediaProcessingTasks: [],
    governanceReviews: [],
    governanceFindings: [],
    productionArtifacts: [],
    artifactRevisions: [],
    productionSubmissions: [],
    agentAssistance: [],
    evidence: [],
    candidates: [],
    teachingDirectives: [],
    sceneDirectorDecisions: [],
    activeInterventions: [],
    assessments: [],
    evaluationEvidenceBundles: [],
    evaluationCases: [],
    evaluationProposals: [],
    evaluationArbitrations: [],
    teacherAssessmentReviews: [],
    learningCandidates: [],
    learningReplayReports: [],
    learningCandidateReviews: [],
    learningReleases: [],
    learningReleaseRollbacks: [],
    activeLearningReleaseId: null,
    messages: [],
    roleInteractions: [],
    events: [],
  };
}

export function reduceWorldState(sessionId: string, scenario: ScenarioPackage, events: WorldEvent[]): WorldState {
  if (events.length > 0) {
    const sessionStarted = events.find((event) => event.eventType === "session_started");
    const persistedVersion = typeof sessionStarted?.payload.scenarioVersion === "string"
      ? sessionStarted.payload.scenarioVersion
      : "missing";
    if (persistedVersion !== scenario.version) {
      throw new ScenarioVersionMismatchError(scenario.version, persistedVersion);
    }
    const persistedScenarioId = typeof sessionStarted?.payload.scenarioId === "string"
      ? sessionStarted.payload.scenarioId
      : scenario.scenarioId;
    if (persistedScenarioId !== scenario.scenarioId) {
      throw new ScenarioVersionMismatchError(scenario.scenarioId, persistedScenarioId);
    }
    const persistedRef = sessionStarted?.payload.scenarioRef;
    if (persistedRef && typeof persistedRef === "object") {
      const contentHash = (persistedRef as { contentHash?: unknown }).contentHash;
      if (typeof contentHash !== "string" || contentHash !== hashValue(scenario)) {
        throw new ScenarioVersionMismatchError(hashValue(scenario), String(contentHash ?? "missing"));
      }
    }
  }
  return events.reduce((state, event) => {
    const next: WorldState = {
      ...state,
      stateVersion: event.stateVersion,
      virtualMinute: typeof event.payload.virtualMinute === "number" ? event.payload.virtualMinute : state.virtualMinute,
      events: [...state.events, event],
    };

    switch (event.eventType) {
      case "session_started":
        next.status = "running";
        if (typeof event.payload.sessionEpoch === "string") {
          next.sessionEpoch = event.payload.sessionEpoch;
        }
        break;
      case "node_activated": {
        const nodeId = String(event.payload.nodeId ?? state.currentNodeId);
        const target = state.nodes.find((node) => node.nodeId === nodeId);
        if (target) {
          next.currentNodeId = nodeId;
          next.nodes = state.nodes.map((node) => {
            if (node.order < target.order) return { ...node, status: "completed" as const };
            if (node.nodeId === nodeId) return { ...node, status: "active" as const };
            if (node.order === target.order + 1) return { ...node, status: "available" as const };
            return { ...node, status: "locked" as const };
          });
        }
        break;
      }
      case "material_registered": {
        const material = MaterialSchema.parse(event.payload.material);
        next.materials = upsert(state.materials, material, (item) => item.materialId);
        break;
      }
      case "material_observed": {
        const observation = ObservationSchema.parse(event.payload.observation);
        next.observations = upsert(state.observations, observation, (item) => item.observationId);
        break;
      }
      case "media_processing_requested": {
        const task = MediaProcessingTaskSchema.parse(event.payload.task);
        next.mediaProcessingTasks = upsert(
          state.mediaProcessingTasks,
          task,
          (item) => item.taskId,
        );
        break;
      }
      case "governance_review_requested":
      case "governance_review_reopened": {
        const review = GovernanceReviewSchema.parse(event.payload.review);
        next.governanceReviews = upsert(
          state.governanceReviews,
          review,
          (item) => item.reviewId,
        );
        break;
      }
      case "media_processing_started": {
        const taskId = String(event.payload.taskId ?? "");
        const stepId = String(event.payload.stepId ?? "");
        next.mediaProcessingTasks = state.mediaProcessingTasks.map((task) => {
          if (task.taskId !== taskId) return task;
          const steps = task.steps.map((step) => step.stepId === stepId
            ? {
                ...step,
                status: "running" as const,
                attempts: step.attempts + 1,
                requestedProviderMode:
                  event.payload.providerMode === "mock"
                  || event.payload.providerMode === "live"
                    ? event.payload.providerMode
                    : step.requestedProviderMode,
                startedAt: event.timestamp,
                completedAt: null,
                lastErrorCode: null,
              }
            : step);
          return MediaProcessingTaskSchema.parse({
            ...task,
            status: "running",
            steps,
            startedAt: task.startedAt ?? event.timestamp,
            completedAt: null,
            updatedAt: event.timestamp,
          });
        });
        break;
      }
      case "media_processing_step_completed":
      case "media_processing_manual_supplied": {
        const taskId = String(event.payload.taskId ?? "");
        const stepId = String(event.payload.stepId ?? "");
        const output = MediaProcessingOutputSchema.parse(event.payload.output);
        const status = event.eventType === "media_processing_manual_supplied"
          ? "manually_completed" as const
          : "succeeded" as const;
        next.mediaProcessingTasks = state.mediaProcessingTasks.map((task) => {
          if (task.taskId !== taskId) return task;
          const steps = task.steps.map((step) => step.stepId === stepId
            ? {
                ...step,
                status,
                output,
                effectiveProviderMode: output.providerMode,
                completedAt: event.timestamp,
                lastErrorCode: null,
              }
            : step);
          return MediaProcessingTaskSchema.parse({
            ...task,
            steps,
            updatedAt: event.timestamp,
          });
        });
        break;
      }
      case "media_processing_step_failed": {
        const taskId = String(event.payload.taskId ?? "");
        const stepId = String(event.payload.stepId ?? "");
        const errorCode = String(event.payload.errorCode ?? "MEDIA_PROCESSING_FAILED");
        next.mediaProcessingTasks = state.mediaProcessingTasks.map((task) => {
          if (task.taskId !== taskId) return task;
          const steps = task.steps.map((step) => step.stepId === stepId
            ? {
                ...step,
                status: "failed" as const,
                output: null,
                effectiveProviderMode:
                  event.payload.providerMode === "mock"
                  || event.payload.providerMode === "live"
                    ? event.payload.providerMode
                    : step.requestedProviderMode,
                completedAt: event.timestamp,
                lastErrorCode: errorCode,
              }
            : step);
          return MediaProcessingTaskSchema.parse({
            ...task,
            steps,
            updatedAt: event.timestamp,
          });
        });
        break;
      }
      case "media_processing_retry_requested": {
        const taskId = String(event.payload.taskId ?? "");
        const retryStepIds = Array.isArray(event.payload.stepIds)
          ? new Set(event.payload.stepIds.map(String))
          : new Set<string>();
        next.mediaProcessingTasks = state.mediaProcessingTasks.map((task) => {
          if (task.taskId !== taskId) return task;
          return MediaProcessingTaskSchema.parse({
            ...task,
            status: "queued",
            steps: task.steps.map((step) => (
              step.status === "failed" && retryStepIds.has(step.stepId)
            )
              ? {
                  ...step,
                  status: "queued",
                  lastErrorCode: null,
                  startedAt: null,
                  completedAt: null,
                }
              : step),
            completedAt: null,
            updatedAt: event.timestamp,
          });
        });
        break;
      }
      case "media_processing_completed": {
        const taskId = String(event.payload.taskId ?? "");
        const status = String(event.payload.status ?? "");
        next.mediaProcessingTasks = state.mediaProcessingTasks.map((task) => task.taskId === taskId
          ? MediaProcessingTaskSchema.parse({
              ...task,
              status,
              completedAt: event.timestamp,
              updatedAt: event.timestamp,
            })
          : task);
        break;
      }
      case "governance_review_arbitrated": {
        const review = GovernanceReviewSchema.parse(event.payload.review);
        const findings = Array.isArray(event.payload.findings)
          ? event.payload.findings.map((finding) => (
              GovernanceFindingSchema.parse(finding)
            ))
          : [];
        for (const finding of findings) {
          const existing = state.governanceFindings.find(
            (candidate) => candidate.findingId === finding.findingId,
          );
          if (existing && hashValue(existing) !== hashValue(finding)) {
            throw new Error(
              `不可变治理 Finding 标识发生载荷碰撞：${finding.findingId}`,
            );
          }
        }
        next.governanceReviews = upsert(
          state.governanceReviews,
          review,
          (item) => item.reviewId,
        );
        next.governanceFindings = findings.reduce(
          (items, finding) => upsert(
            items,
            finding,
            (item) => item.findingId,
          ),
          state.governanceFindings,
        );
        break;
      }
      case "governance_reviewed": {
        const review = GovernanceReviewSchema.parse(event.payload.review);
        next.governanceReviews = upsert(
          state.governanceReviews,
          review,
          (item) => item.reviewId,
        );
        break;
      }
      case "production_artifact_created": {
        const artifact = ProductionArtifactSchema.parse(event.payload.artifact);
        const revision = ArtifactRevisionSchema.parse(event.payload.revision);
        next.productionArtifacts = upsert(
          state.productionArtifacts,
          artifact,
          (item) => item.artifactId,
        );
        next.artifactRevisions = upsert(
          state.artifactRevisions,
          revision,
          (item) => item.revisionId,
        );
        break;
      }
      case "artifact_revision_saved": {
        const artifact = ProductionArtifactSchema.parse(event.payload.artifact);
        const revision = ArtifactRevisionSchema.parse(event.payload.revision);
        next.productionArtifacts = upsert(
          state.productionArtifacts,
          artifact,
          (item) => item.artifactId,
        );
        next.artifactRevisions = upsert(
          state.artifactRevisions,
          revision,
          (item) => item.revisionId,
        );
        break;
      }
      case "world_fact_confirmed":
      case "world_fact_updated": {
        const fact = WorldFactSchema.parse(event.payload.fact);
        const supersedesFactId = typeof event.payload.supersedesFactId === "string" ? event.payload.supersedesFactId : null;
        const facts = supersedesFactId
          ? state.facts.map((item) => item.factId === supersedesFactId ? { ...item, status: "superseded" as const } : item)
          : state.facts;
        next.facts = upsert(facts, fact, (item) => item.factId);
        break;
      }
      case "agent_message_posted":
      case "role_message_posted": {
        const message = RoleMessageSchema.parse(event.payload.message);
        next.messages = upsert(state.messages, message, (item) => item.messageId);
        break;
      }
      case "role_interaction_requested": {
        const request = RoleInteractionRequestSchema.parse(event.payload.interaction);
        next.roleInteractions = upsert(
          state.roleInteractions,
          { request, response: null, status: "pending" as const },
          (item) => item.request.interactionId,
        );
        break;
      }
      case "role_interaction_responded": {
        const response = RoleInteractionResponseSchema.parse(event.payload.response);
        const existing = state.roleInteractions.find(
          (item) => item.request.interactionId === response.interactionId,
        );
        if (!existing) {
          throw new InvalidWorldActionError(`角色响应缺少对应请求：${response.interactionId}`);
        }
        next.roleInteractions = upsert(
          state.roleInteractions,
          { request: existing.request, response, status: "responded" as const },
          (item) => item.request.interactionId,
        );
        break;
      }
      case "candidate_event_proposed": {
        const candidate = CandidateEventSchema.parse(event.payload.candidate);
        next.candidates = upsert(state.candidates, candidate, (item) => item.candidateId);
        break;
      }
      case "candidate_event_approved":
      case "candidate_event_rejected": {
        const candidateId = String(event.payload.candidateId ?? "");
        const status = event.eventType === "candidate_event_approved" ? "approved" as const : "rejected" as const;
        next.candidates = state.candidates.map((candidate) => candidate.candidateId === candidateId
          ? {
              ...candidate,
              status,
              reviewedBy: typeof event.payload.reviewedBy === "string"
                ? event.payload.reviewedBy
                : event.actorId,
              reviewedAt: event.timestamp,
              reviewReason: typeof event.payload.reason === "string"
                ? event.payload.reason
                : status === "approved"
                  ? "教师批准"
                  : "教师驳回",
            }
          : candidate);
        break;
      }
      case "teaching_directive_recorded": {
        const directive = TeachingDirectiveSchema.parse(event.payload.directive);
        next.teachingDirectives = upsert(
          state.teachingDirectives,
          directive,
          (item) => item.directiveId,
        );
        break;
      }
      case "scene_director_decision_recorded": {
        const decision = SceneDirectorDecisionSchema.parse(event.payload.decision);
        next.sceneDirectorDecisions = upsert(
          state.sceneDirectorDecisions,
          decision,
          (item) => item.decisionId,
        );
        break;
      }
      case "scenario_intervention_applied": {
        const intervention = ScenarioInterventionSchema.parse(event.payload.intervention);
        next.activeInterventions = upsert(
          state.activeInterventions,
          intervention,
          (item) => item.interventionId,
        );
        break;
      }
      case "evidence_recorded": {
        const evidence = EvidenceSchema.parse(event.payload.evidence);
        next.evidence = upsert(state.evidence, evidence, (item) => item.evidenceId);
        break;
      }
      case "agent_assistance_recorded": {
        const proposal = AgentAssistanceProposalSchema.parse(
          event.payload.proposal,
        );
        const existing = state.agentAssistance.find(
          (item) => item.proposalId === proposal.proposalId,
        );
        if (
          existing
          && hashValue(existing) !== hashValue(proposal)
        ) {
          throw new Error(
            `不可变辅助建议标识发生载荷碰撞：${proposal.proposalId}`,
          );
        }
        next.agentAssistance = upsert(
          state.agentAssistance,
          proposal,
          (item) => item.proposalId,
        );
        break;
      }
      case "publication_paused":
        next.status = "paused";
        break;
      case "submission_created": {
        next.status = "review";
        const submission = ProductionSubmissionSchema.safeParse(event.payload.submission);
        if (submission.success) {
          next.productionSubmissions = upsert(
            state.productionSubmissions,
            submission.data,
            (item) => item.submissionId,
          );
          next.productionArtifacts = state.productionArtifacts.map((artifact) => (
            artifact.artifactId === submission.data.artifactId
              ? ProductionArtifactSchema.parse({
                  ...artifact,
                  status: "submitted",
                  updatedAt: event.timestamp,
                })
              : artifact
          ));
        }
        break;
      }
      case "evaluation_case_opened": {
        const evidenceBundle = EvaluationEvidenceBundleSchema.parse(
          event.payload.evidenceBundle,
        );
        const evaluationCase = EvaluationCaseSchema.parse(
          event.payload.evaluationCase,
        );
        const existingBundle = state.evaluationEvidenceBundles.find(
          (item) => item.bundleId === evidenceBundle.bundleId,
        );
        const existingCase = state.evaluationCases.find(
          (item) => item.evaluationCaseId === evaluationCase.evaluationCaseId,
        );
        if (
          (existingBundle && existingBundle.bundleHash !== evidenceBundle.bundleHash)
          || (existingCase && existingCase.caseHash !== evaluationCase.caseHash)
        ) {
          throw new Error("不可变评价案件或证据包标识发生载荷碰撞");
        }
        next.evaluationEvidenceBundles = upsert(
          state.evaluationEvidenceBundles,
          evidenceBundle,
          (item) => item.bundleId,
        );
        next.evaluationCases = upsert(
          state.evaluationCases,
          evaluationCase,
          (item) => item.evaluationCaseId,
        );
        break;
      }
      case "evaluation_proposal_recorded": {
        const proposal = EvaluationProposalSchema.parse(event.payload.proposal);
        const existing = state.evaluationProposals.find(
          (item) => item.proposalId === proposal.proposalId,
        );
        if (existing && existing.proposalHash !== proposal.proposalHash) {
          throw new Error(
            `不可变评价意见标识发生载荷碰撞：${proposal.proposalId}`,
          );
        }
        next.evaluationProposals = upsert(
          state.evaluationProposals,
          proposal,
          (item) => item.proposalId,
        );
        break;
      }
      case "evaluation_arbitrated": {
        const arbitration = EvaluationArbitrationSchema.parse(
          event.payload.arbitration,
        );
        const existing = state.evaluationArbitrations.find(
          (item) => item.arbitrationId === arbitration.arbitrationId,
        );
        if (existing && existing.decisionHash !== arbitration.decisionHash) {
          throw new Error(
            `不可变评价仲裁标识发生载荷碰撞：${arbitration.arbitrationId}`,
          );
        }
        next.evaluationArbitrations = upsert(
          state.evaluationArbitrations,
          arbitration,
          (item) => item.arbitrationId,
        );
        break;
      }
      case "assessment_created": {
        const assessment = AssessmentSchema.parse(event.payload.assessment);
        next.assessments = upsert(state.assessments, assessment, (item) => item.assessmentId);
        break;
      }
      case "teacher_reviewed": {
        const review = TeacherAssessmentReviewSchema.safeParse(
          event.payload.review,
        );
        if (review.success) {
          const existing = state.teacherAssessmentReviews.find(
            (item) => item.reviewId === review.data.reviewId,
          );
          if (existing && existing.finalHash !== review.data.finalHash) {
            throw new Error(
              `不可变教师终评标识发生载荷碰撞：${review.data.reviewId}`,
            );
          }
          next.teacherAssessmentReviews = upsert(
            state.teacherAssessmentReviews,
            review.data,
            (item) => item.reviewId,
          );
        }
        break;
      }
      case "learning_candidate_created": {
        const candidate = LearningCandidateSchema.parse(event.payload.learningCandidate);
        const existing = state.learningCandidates.find(
          (item) => item.candidateId === candidate.candidateId,
        );
        if (
          existing
          && hashValue(existing) !== hashValue(candidate)
        ) {
          throw new Error(
            `不可变学习候选标识发生载荷碰撞：${candidate.candidateId}`,
          );
        }
        next.learningCandidates = upsert(state.learningCandidates, candidate, (item) => item.candidateId);
        break;
      }
      case "learning_candidate_replay_completed": {
        const report = LearningReplayReportSchema.parse(
          event.payload.replayReport,
        );
        const existing = state.learningReplayReports.find(
          (item) => item.reportId === report.reportId,
        );
        if (existing && existing.reportHash !== report.reportHash) {
          throw new Error(
            `不可变学习回放报告标识发生载荷碰撞：${report.reportId}`,
          );
        }
        next.learningReplayReports = upsert(
          state.learningReplayReports,
          report,
          (item) => item.reportId,
        );
        break;
      }
      case "learning_candidate_reviewed": {
        const review = LearningCandidateReviewSchema.parse(
          event.payload.candidateReview,
        );
        const existing = state.learningCandidateReviews.find(
          (item) => item.reviewId === review.reviewId,
        );
        if (existing && existing.reviewHash !== review.reviewHash) {
          throw new Error(
            `不可变学习候选审核标识发生载荷碰撞：${review.reviewId}`,
          );
        }
        next.learningCandidateReviews = upsert(
          state.learningCandidateReviews,
          review,
          (item) => item.reviewId,
        );
        break;
      }
      case "learning_release_published": {
        const release = LearningArtifactReleaseSchema.parse(
          event.payload.release,
        );
        const existing = state.learningReleases.find(
          (item) => item.releaseId === release.releaseId,
        );
        if (existing && hashValue(existing) !== hashValue(release)) {
          throw new Error(
            `不可变学习发布标识发生载荷碰撞：${release.releaseId}`,
          );
        }
        next.learningReleases = upsert(
          state.learningReleases,
          release,
          (item) => item.releaseId,
        );
        next.activeLearningReleaseId = release.releaseId;
        break;
      }
      case "learning_release_rolled_back": {
        const rollback = LearningReleaseRollbackSchema.parse(
          event.payload.rollback,
        );
        const existing = state.learningReleaseRollbacks.find(
          (item) => item.rollbackId === rollback.rollbackId,
        );
        if (existing && existing.rollbackHash !== rollback.rollbackHash) {
          throw new Error(
            `不可变学习回滚标识发生载荷碰撞：${rollback.rollbackId}`,
          );
        }
        next.learningReleaseRollbacks = upsert(
          state.learningReleaseRollbacks,
          rollback,
          (item) => item.rollbackId,
        );
        next.activeLearningReleaseId = rollback.targetReleaseId;
        break;
      }
      case "scene_completed":
        next.status = "completed";
        next.nodes = state.nodes.map((node) => (
          node.nodeId === state.currentNodeId
            ? { ...node, status: "completed" as const }
            : node
        ));
        break;
    }
    return next;
  }, createInitialState(sessionId, scenario));
}

function action(
  command: ActionDefinition["command"],
  label: string,
  description: string,
  tone: ActionDefinition["tone"],
  enabled = true,
  disabledReason: string | null = null,
): ActionDefinition {
  return { command, label, description, tone, enabled, disabledReason };
}

function interactionByOption(state: WorldState, optionId: string) {
  return state.roleInteractions.find((item) => item.request.optionId === optionId);
}

function hasRespondedInteraction(state: WorldState, optionId: string): boolean {
  return interactionByOption(state, optionId)?.status === "responded";
}

function unmetInteractionGateOptions(
  state: WorldState,
  commandName: ActionDefinition["command"],
): string[] {
  const gate = state.scenario.interactionGates.find((item) => item.command === commandName);
  return (gate?.requiredOptionIds ?? []).filter(
    (optionId) => !hasRespondedInteraction(state, optionId),
  );
}

function roleInteractionDisabledReason(
  state: WorldState,
  interaction: ScenarioRoleInteraction,
  role: RoleContract,
): string | null {
  const existing = interactionByOption(state, interaction.optionId);
  if (existing?.status === "pending") return "等待对方智能体响应";
  if (existing?.status === "responded") return "本轮岗位沟通已完成";
  for (const prerequisite of interaction.prerequisites) {
    const met = prerequisite.kind === "interaction_responded"
      ? hasRespondedInteraction(state, prerequisite.optionId)
      : prerequisite.kind === "event_recorded"
        ? hasEvent(state, prerequisite.eventType)
        : hasEvidenceAction(state, prerequisite.action);
    if (!met) return prerequisite.disabledReason;
  }
  const policy = role.communicationPolicy;
  if (!policy?.canInitiate || !policy.allowedTargetRoleIds.includes(interaction.targetRoleId)) {
    return "岗位通信契约未授权此目标";
  }
  const usedTurns = state.roleInteractions.filter((item) => (
    item.request.fromActorId === role.agentId
    && item.request.toActorId === interaction.targetActorId
  )).length;
  if (usedTurns >= policy.maxTurnsPerTarget) return "已达到该目标的最大沟通轮次";
  return null;
}

function availableRoleInteractions(state: WorldState, role: RoleContract): RoleInteractionOption[] {
  return state.scenario.roleInteractions
    .filter((interaction) => interaction.initiatorActorId === role.agentId)
    .map((interaction) => {
      const target = state.scenario.roles.find(
        (candidate) => candidate.agentId === interaction.targetActorId,
      );
      if (!target) throw new Error(`角色互动目标不存在：${interaction.targetActorId}`);
      const disabledReason = roleInteractionDisabledReason(state, interaction, role);
      return {
        optionId: interaction.optionId,
        targetActorId: interaction.targetActorId,
        targetRoleId: interaction.targetRoleId,
        kind: interaction.kind,
        topic: interaction.topic,
        label: interaction.label,
        description: interaction.description,
        targetDisplayName: target.displayName,
        enabled: disabledReason === null,
        disabledReason,
      };
    });
}

function learningReviewForFailure(
  state: WorldState,
  failureEvent: WorldEvent,
): TeacherAssessmentReview | null {
  if (failureEvent.eventType !== "learning_candidate_generation_failed") {
    return null;
  }
  const triggerEventId = typeof failureEvent.payload.triggerEventId === "string"
    ? failureEvent.payload.triggerEventId
    : null;
  const triggerEvent = triggerEventId
    ? state.events.find((event) => event.eventId === triggerEventId)
    : null;
  if (
    !triggerEvent
    || (
      triggerEvent.eventType !== "teacher_reviewed"
      && triggerEvent.eventType
        !== "learning_candidate_generation_retry_requested"
    )
  ) {
    return null;
  }
  const review = TeacherAssessmentReviewSchema.safeParse(
    triggerEvent.payload.review,
  );
  return review.success ? review.data : null;
}

function learningFailureContext(
  triggerEvent: WorldEvent,
): Record<string, unknown> {
  const review = TeacherAssessmentReviewSchema.safeParse(
    triggerEvent.payload.review,
  );
  if (!review.success) return {};
  return {
    evaluationCaseId: review.data.evaluationCaseId,
    teacherReviewId: review.data.reviewId,
    finalHash: review.data.finalHash,
    finalAssessmentId: typeof triggerEvent.payload.finalAssessmentId
      === "string"
      ? triggerEvent.payload.finalAssessmentId
      : null,
  };
}

function hasTerminalAgentResultForTrigger(
  state: WorldState,
  triggerEventId: string,
): boolean {
  return state.events.some((event) => (
    (
      event.eventType === "agent_run_recorded"
      || event.eventType === "agent_task_failed"
    )
    && event.payload.triggerEventId === triggerEventId
  ));
}

const nonChargeableManualRetryErrorCodes = new Set([
  "agent_projection_identity_mismatch",
  "evaluation_case_bundle_mismatch",
  "evaluation_case_snapshot_invalid",
  "evaluation_definition_missing",
  "evaluation_evidence_bundle_snapshot_invalid",
  "evaluation_evidence_projection_missing",
  "evaluation_revision_hash_mismatch",
  "evaluation_revision_identity_mismatch",
  "evaluation_revision_missing",
  "handler_not_found",
  "invalid_world_action",
  "learning_evaluation_case_missing",
  "learning_evidence_missing",
  "learning_evidence_projection_missing",
  "learning_input_snapshot_invalid",
  "permission_denied",
  "session_not_found",
  "state_version_conflict",
  "trigger_denied",
]);

function manualRetryEventConsumesBudget(
  state: WorldState,
  retryEvent: WorldEvent,
): boolean {
  const runEvent = state.events.find((event) => (
    event.eventType === "agent_run_recorded"
    && event.payload.triggerEventId === retryEvent.eventId
  ));
  if (runEvent) {
    const trace = runEvent.payload.trace;
    if (!trace || typeof trace !== "object") return true;
    const modelCalls = "modelCalls" in trace
      && typeof trace.modelCalls === "number"
      ? trace.modelCalls
      : 0;
    const modelInvocations = "modelInvocations" in trace
      && Array.isArray(trace.modelInvocations)
      ? trace.modelInvocations.length
      : 0;
    return modelCalls > 0 || modelInvocations > 0;
  }
  const failureEvent = state.events.find((event) => (
    event.eventType === "agent_task_failed"
    && event.payload.triggerEventId === retryEvent.eventId
  ));
  if (!failureEvent) return true;
  const errorCode = typeof failureEvent.payload.errorCode === "string"
    ? failureEvent.payload.errorCode
    : "unknown_error";
  return !nonChargeableManualRetryErrorCodes.has(errorCode);
}

function manualRetryBudgetCount(
  state: WorldState,
  retryEvents: readonly WorldEvent[],
): number {
  return retryEvents.filter(
    (event) => manualRetryEventConsumesBudget(state, event),
  ).length;
}

function recoveryStatus(input: {
  retryCount: number;
  inFlight: boolean;
}): "ready" | "in_flight" | "exhausted" {
  if (input.inFlight) return "in_flight";
  return input.retryCount >= maximumManualAgentRetries
    ? "exhausted"
    : "ready";
}

function retryableEvaluationBranches(state: WorldState) {
  return state.evaluationCases.flatMap((evaluationCase) => {
    if (state.teacherAssessmentReviews.some((review) => (
      review.evaluationCaseId === evaluationCase.evaluationCaseId
    ))) return [];
    const evidenceBundle = state.evaluationEvidenceBundles.find((item) => (
      item.bundleId === evaluationCase.evidenceBundleId
      && item.bundleHash === evaluationCase.evidenceBundleHash
    ));
    const arbitration = state.evaluationArbitrations
      .filter((item) => (
        item.evaluationCaseId === evaluationCase.evaluationCaseId
      ))
      .sort((left, right) => right.revision - left.revision)[0];
    if (!evidenceBundle || !arbitration) return [];

    return evaluationCase.requiredEvaluatorKinds.flatMap((evaluatorKind) => {
      if (evaluatorKind === "rule") return [];
      const proposal = latestEvaluationProposal(
        state,
        evaluationCase.evaluationCaseId,
        evaluatorKind,
      );
      if (!proposal || proposal.status !== "unavailable") return [];
      const retries = state.events.filter((event) => (
        event.eventType === "evaluation_branch_retry_requested"
        && event.payload.evaluationCaseId === evaluationCase.evaluationCaseId
        && event.payload.evaluatorKind === evaluatorKind
      ));
      const latestRetry = retries.at(-1) ?? null;
      const inFlight = Boolean(
        latestRetry
        && !hasTerminalAgentResultForTrigger(state, latestRetry.eventId),
      );
      const retryBudgetCount = manualRetryBudgetCount(state, retries);
      return [{
        evaluationCaseId: evaluationCase.evaluationCaseId,
        evaluatorKind,
        unavailableProposalId: proposal.proposalId,
        unavailableProposalHash: proposal.proposalHash,
        errorCode: proposal.errorCode ?? "evaluation_unavailable",
        expectedCaseHash: evaluationCase.caseHash,
        expectedEvidenceBundleHash: evidenceBundle.bundleHash,
        expectedArbitrationRevision: arbitration.revision,
        expectedDecisionHash: arbitration.decisionHash,
        manualRetryCount: retryBudgetCount,
        maximumManualRetries: maximumManualAgentRetries,
        status: recoveryStatus({
          retryCount: retryBudgetCount,
          inFlight,
        }),
        latestRetryEventId: latestRetry?.eventId ?? null,
      }];
    });
  });
}

function retryableLearningGenerationFailures(state: WorldState) {
  const latestByReview = new Map<string, {
    event: WorldEvent;
    review: TeacherAssessmentReview;
  }>();
  for (const event of state.events) {
    const review = learningReviewForFailure(state, event);
    if (review) {
      latestByReview.set(review.reviewId, { event, review });
    }
  }
  return [...latestByReview.values()].flatMap(({ event, review }) => {
    if (state.learningCandidates.some((candidate) => (
      candidate.evaluationCaseId === review.evaluationCaseId
    ))) return [];
    const failedTaskId = typeof event.payload.taskId === "string"
      ? event.payload.taskId
      : null;
    const errorCode = typeof event.payload.errorCode === "string"
      ? event.payload.errorCode
      : null;
    if (!failedTaskId || !errorCode) return [];
    const retries = state.events.filter((candidate) => (
      candidate.eventType
        === "learning_candidate_generation_retry_requested"
      && candidate.payload.teacherReviewId === review.reviewId
    ));
    const latestRetry = retries.at(-1) ?? null;
    const inFlight = Boolean(
      latestRetry
      && !hasTerminalAgentResultForTrigger(state, latestRetry.eventId),
    );
    const retryBudgetCount = manualRetryBudgetCount(state, retries);
    return [{
      evaluationCaseId: review.evaluationCaseId,
      teacherReviewId: review.reviewId,
      expectedFinalHash: review.finalHash,
      failureEventId: event.eventId,
      failedTaskId,
      errorCode,
      failedAt: event.timestamp,
      manualRetryCount: retryBudgetCount,
      maximumManualRetries: maximumManualAgentRetries,
      status: recoveryStatus({
        retryCount: retryBudgetCount,
        inFlight,
      }),
      latestRetryEventId: latestRetry?.eventId ?? null,
    }];
  });
}

function availableActions(state: WorldState, role: RoleContract): ActionDefinition[] {
  if (role.actorKind === "teacher") {
    const pending = currentPendingCandidates(state);
    const evaluationCase = state.evaluationCases.at(-1) ?? null;
    const arbitration = evaluationCase
      ? state.evaluationArbitrations
          .filter((item) => item.evaluationCaseId === evaluationCase.evaluationCaseId)
          .sort((left, right) => right.revision - left.revision)[0] ?? null
      : null;
    const hasTeacherReview = evaluationCase
      ? state.teacherAssessmentReviews.some(
          (review) => review.evaluationCaseId === evaluationCase.evaluationCaseId,
        )
      : state.assessments.some((assessment) => assessment.stage === "teacher");
    const legacyReviewReady = !evaluationCase
      && state.assessments.some((assessment) => assessment.stage === "rule")
      && state.assessments.some((assessment) => assessment.stage === "model")
      && !hasTeacherReview;
    const pendingLearningCandidate = state.learningCandidates.find((candidate) => (
      !state.learningCandidateReviews.some(
        (review) => review.candidateId === candidate.candidateId,
      )
    ));
    const approvedLearningReview = state.learningCandidateReviews.findLast(
      (review) => (
        review.decision === "approve"
        && !state.learningReleases.some(
          (release) => release.reviewId === review.reviewId,
        )
      ),
    );
    const activeLearningRelease = state.activeLearningReleaseId
      ? state.learningReleases.find(
          (release) => release.releaseId === state.activeLearningReleaseId,
        ) ?? null
      : null;
    const evaluationRetryEvents = evaluationCase
      ? state.events.filter((event) => (
          event.eventType === "evaluation_branch_retry_requested"
          && event.payload.evaluationCaseId
            === evaluationCase.evaluationCaseId
        ))
      : [];
    const evaluationRetryInFlight = evaluationRetryEvents.some((event) => (
      !hasTerminalAgentResultForTrigger(state, event.eventId)
    ));
    const retryableEvaluationProposal = evaluationCase && !hasTeacherReview
      ? evaluationCase.requiredEvaluatorKinds
          .filter((kind): kind is Exclude<EvaluationEvaluatorKind, "rule"> => (
            kind !== "rule"
          ))
          .map((kind) => latestEvaluationProposal(
            state,
            evaluationCase.evaluationCaseId,
            kind,
          ))
          .find((proposal) => {
            if (!proposal || proposal.status !== "unavailable") return false;
            const retries = evaluationRetryEvents.filter((event) => (
              event.payload.evaluatorKind === proposal.evaluatorKind
            ));
            return (
              manualRetryBudgetCount(state, retries)
                < maximumManualAgentRetries
              && !retries.some((event) => (
                !hasTerminalAgentResultForTrigger(state, event.eventId)
              ))
            );
          }) ?? null
      : null;
    const latestLearningFailure = state.events.findLast((event) => {
      const review = learningReviewForFailure(state, event);
      return Boolean(
        review
        && !state.learningCandidates.some((candidate) => (
          candidate.evaluationCaseId === review.evaluationCaseId
        )),
      );
    }) ?? null;
    const latestLearningFailureReview = latestLearningFailure
      ? learningReviewForFailure(state, latestLearningFailure)
      : null;
    const learningRetryEvents = latestLearningFailureReview
      ? state.events.filter((event) => (
          event.eventType
            === "learning_candidate_generation_retry_requested"
          && event.payload.teacherReviewId
            === latestLearningFailureReview.reviewId
        ))
      : [];
    const learningRetryInFlight = learningRetryEvents.some((event) => (
      !hasTerminalAgentResultForTrigger(state, event.eventId)
    ));
    const retryableLearningFailure = (
      latestLearningFailure
      && manualRetryBudgetCount(state, learningRetryEvents)
        < maximumManualAgentRetries
      && !learningRetryInFlight
    )
      ? latestLearningFailure
      : null;
    const teacherActions = [
      action("approve_candidate_event", "批准投放", pending.length ? `审批 ${pending.length} 个待投放世界事件` : "当前没有待投放事件", "primary", pending.length > 0, pending.length ? null : "无待审批事件"),
      action("reject_candidate_event", "驳回", "保留候选记录但不改变世界状态", "neutral", pending.length > 0, pending.length ? null : "无待审批事件"),
      action(
        "retry_evaluation_branch",
        "重跑评价分支",
        "从固定案件与证据包创建新的单分支任务，旧意见与死信保持不可变",
        "warning",
        Boolean(retryableEvaluationProposal),
        retryableEvaluationProposal ? null : "当前没有可重跑的降级评价分支",
      ),
      action(
        "review_assessment",
        "逐维终评",
        "核对固定证据包、评价分歧与精确仲裁后形成教师终评",
        "warning",
        Boolean(
          legacyReviewReady
          || (
            arbitration
            && arbitration.status !== "collecting"
            && !hasTeacherReview
            && !evaluationRetryInFlight
          ),
        ),
        hasTeacherReview
          ? "教师已完成复核"
          : evaluationRetryInFlight
            ? "等待评价分支重跑完成"
          : legacyReviewReady
            ? null
          : arbitration?.status === "collecting"
            ? "等待评价节点完成"
            : arbitration
              ? null
              : "等待学生提交与评价案件",
      ),
      action(
        "retry_learning_candidate_generation",
        "重跑学习策展",
        "从精确教师终评重新生成待审核候选，不自动发布",
        "warning",
        Boolean(retryableLearningFailure),
        retryableLearningFailure ? null : "当前没有可重跑的学习策展失败",
      ),
      action(
        "review_learning_candidate",
        "审核学习候选",
        "批准或驳回已完成离线回放的不可变候选",
        "warning",
        Boolean(pendingLearningCandidate),
        pendingLearningCandidate ? null : "当前没有待审核学习候选",
      ),
      action(
        "publish_learning_release",
        "发布学习版本",
        "把已批准候选发布为独立版本，不回写历史评价",
        "primary",
        Boolean(approvedLearningReview),
        approvedLearningReview ? null : "等待候选通过人工审核",
      ),
      action(
        "rollback_learning_release",
        "回滚学习版本",
        "追加回滚事件并恢复上一稳定版本或系统基线",
        "neutral",
        Boolean(activeLearningRelease),
        activeLearningRelease ? null : "当前没有活动学习版本",
      ),
    ];
    return teacherActions.filter((item) => (
      roleCanExecuteCommand(role, item.command)
    ));
  }

  if (state.status === "completed") return [];
  if (role.roleId !== "responsible_editor") return [];
  if (!hasEvent(state, "material_observed")) {
    const unmet = unmetInteractionGateOptions(state, "inspect_material");
    const reporterReady = !unmet.some((optionId) => optionId.startsWith("reporter-"));
    const chiefReady = !unmet.some((optionId) => optionId.startsWith("editor-chief-"));
    const disabledReason = !reporterReady
      ? "等待记者岗完成两轮采访与交接"
      : !chiefReady
        ? "等待完成总编两轮发布门禁沟通"
        : null;
    return [action(
      "inspect_material",
      "接收采访交接并核验素材",
      "汇合记者交接与总编门禁，再调用统一多模态适配层形成带来源观察",
      "primary",
      disabledReason === null,
      disabledReason,
    )];
  }
  if (!hasEvent(state, "world_fact_updated")) {
    return [action("request_second_verification", "请求二次核验", "等待教师批准客流数据更正后再继续", "neutral", false, "客流更正候选尚未获批")];
  }
  if (!hasEvidenceAction(state, "请求二次核验")) {
    return [action("request_second_verification", "请求二次核验", "向事实核查岗发起带依据的复核请求", "primary")];
  }
  if (!hasEvent(state, "copyright_risk_flagged")) {
    return [action("mark_copyright_risk", "标记版权风险", "等待教师批准版权方申诉事件", "neutral", false, "版权申诉候选尚未获批")];
  }
  if (!hasEvidenceAction(state, "标记版权风险")) {
    return [action("mark_copyright_risk", "标记版权风险", "冻结争议图片并关联授权说明", "warning")];
  }
  const platformApproved = state.candidates.some((candidate) => candidate.eventType === "node_activated" && candidate.status === "approved");
  if (!platformApproved) {
    return [action("pause_publication", "暂缓发布", "等待平台审核升级候选获批", "neutral", false, "平台审核升级尚未投放")];
  }
  if (!hasEvent(state, "publication_paused")) {
    return [action("pause_publication", "暂缓发布", "冻结待发布版本并保留审核回执", "danger")];
  }
  if (state.scenario.productionConfig && !hasMinimumArtifactRevisions(state)) {
    return [];
  }
  if (!hasEvent(state, "submission_created")) {
    return [action("submit_for_review", "提交审核", "提交过程证据，触发规则与模型初评", "primary")];
  }
  return [];
}

function scenarioTeamIds(scenario: ScenarioPackage): string[] {
  return [...new Set(scenario.roles.map((role) => role.teamId))];
}

function resourceAudience(input: {
  scenario: ScenarioPackage;
  sessionId: string;
  sessionEpoch: string;
  visibility: VisibilityScope[];
  actorId?: string;
  visibleToActorIds?: string[];
  payload?: Record<string, unknown>;
}): ResourceAudience {
  const payloadTeamId = typeof input.payload?.teamId === "string" ? input.payload.teamId : null;
  const actorTeamId = input.actorId
    ? input.scenario.roles.find((role) => role.agentId === input.actorId)?.teamId ?? null
    : null;
  const material = MaterialSchema.safeParse(input.payload?.material);
  const materialTeamIds = material.success
    ? scenarioTeamIds(input.scenario).filter((teamId) => (
      input.scenario.roles.some((role) => role.teamId === teamId && material.data.visibleToRoles.includes(role.roleId))
    ))
    : [];
  const inferredTeams = payloadTeamId
    ? [payloadTeamId]
    : actorTeamId
      ? [actorTeamId]
      : materialTeamIds.length > 0
        ? materialTeamIds
        : scenarioTeamIds(input.scenario).length === 1
          ? scenarioTeamIds(input.scenario)
          : [];
  const privateActors = input.visibleToActorIds ?? [];
  return createResourceAudience({
    scopes: input.visibility,
    courseId: input.scenario.courseId,
    sessionId: input.sessionId,
    sessionEpoch: input.sessionEpoch,
    teamIds: input.visibility.includes("assigned_team") || input.visibility.includes("role_private")
      ? inferredTeams
      : [],
    actorIds: privateActors,
    privateNamespaces: input.visibility.includes("role_private")
      ? privateActors.map((actorId) => `actor:${actorId}`)
      : [],
    auditReadable: input.visibility.includes("audit_only"),
  });
}

function materialDerivedAudience(input: {
  state: WorldState;
  role: RoleContract;
  material: Material;
}): ResourceAudience {
  return createResourceAudience({
    scopes: assignedVisibility,
    courseId: input.state.scenario.courseId,
    sessionId: input.state.sessionId,
    sessionEpoch: input.state.sessionEpoch,
    teamIds: [input.role.teamId],
    roleIds: input.material.visibleToRoles,
    auditReadable: true,
  });
}

function directorObservableAudience(input: {
  scenario: ScenarioPackage;
  eventType: WorldEvent["eventType"];
  visibility: VisibilityScope[];
  audience: ResourceAudience;
}): ResourceAudience {
  if (
    !input.visibility.includes("assigned_team")
    || input.audience.roleIds.length === 0
    || input.audience.actorIds.length > 0
  ) {
    return input.audience;
  }
  const observerRoleIds = input.scenario.roles
    .filter((role) => (
      (
        role.roleId === "teaching_director"
        && teachingDirectorObservableEventTypes.has(input.eventType)
      )
      || (
        role.roleId === "scene_director"
        && sceneDirectorObservableEventTypes.has(input.eventType)
      )
    ))
    .map((role) => role.roleId);
  if (observerRoleIds.length === 0) return input.audience;
  return createResourceAudience({
    scopes: input.audience.scopes,
    courseId: input.audience.courseId,
    sessionId: input.audience.sessionId,
    sessionEpoch: input.audience.sessionEpoch,
    teamIds: input.audience.teamIds,
    roleIds: [...new Set([
      ...input.audience.roleIds,
      ...observerRoleIds,
    ])],
    actorIds: input.audience.actorIds,
    privateNamespaces: input.audience.privateNamespaces,
    auditReadable: input.audience.auditReadable,
  });
}

function canSeeEvent(
  role: RoleContract,
  event: WorldEvent,
  scenario: ScenarioPackage,
  sessionEpoch: string,
): boolean {
  const subject = createAccessSubject({
    role,
    sessionId: event.sessionId,
    sessionEpoch,
    courseId: scenario.courseId,
    purpose: role.actorKind === "teacher" ? "audit" : "runtime",
  });
  const audience = event.audience ?? resourceAudience({
    scenario,
    sessionId: event.sessionId,
    sessionEpoch,
    visibility: event.visibility,
    actorId: event.actorId,
    visibleToActorIds: event.visibleToActorIds,
    payload: event.payload,
  });
  if (!authorizeResource(subject, audience).allowed) return false;
  if (role.actorKind === "teacher" && subject.capabilities.includes("audit.read")) return true;

  const material = MaterialSchema.safeParse(event.payload.material);
  if (material.success && !material.data.visibleToRoles.includes(role.roleId)) return false;
  const fact = WorldFactSchema.safeParse(event.payload.fact);
  if (fact.success) {
    const factAudience = fact.data.audience ?? audience;
    if (!authorizeResource(subject, factAudience).allowed) return false;
  }
  const evidence = EvidenceSchema.safeParse(event.payload.evidence);
  if (evidence.success) {
    const evidenceAudience = evidence.data.audience ?? audience;
    if (!authorizeResource(subject, evidenceAudience).allowed) return false;
  }
  const message = RoleMessageSchema.safeParse(event.payload.message);
  if (message.success) {
    const messageAudience = message.data.audience ?? audience;
    if (!authorizeResource(subject, messageAudience).allowed) return false;
  }
  const task = MediaProcessingTaskSchema.safeParse(event.payload.task);
  if (task.success && !authorizeResource(subject, task.data.audience).allowed) return false;
  const review = GovernanceReviewSchema.safeParse(event.payload.review);
  if (
    review.success
    && !authorizeResource(subject, review.data.audience).allowed
  ) return false;
  if (Array.isArray(event.payload.findings)) {
    for (const rawFinding of event.payload.findings) {
      const finding = GovernanceFindingSchema.safeParse(rawFinding);
      if (
        finding.success
        && !authorizeResource(subject, finding.data.audience).allowed
      ) return false;
    }
  }
  const artifact = ProductionArtifactSchema.safeParse(event.payload.artifact);
  if (artifact.success && !authorizeResource(subject, artifact.data.audience).allowed) return false;
  const revision = ArtifactRevisionSchema.safeParse(event.payload.revision);
  if (revision.success && !authorizeResource(subject, revision.data.audience).allowed) return false;
  return true;
}

function visibleEvidenceForRole(
  state: WorldState,
  role: RoleContract,
): Evidence[] {
  const evaluatorKind = evaluatorKindByAgentId[role.agentId];
  const frozenEvaluationEvidenceIds = evaluatorKind
    && role.actorKind === "agent"
    && role.toolPolicy.includes("evaluation.evidence.read")
    ? new Set(
        state.evaluationCases
          .filter((evaluationCase) => (
            evaluationCase.sessionEpoch === state.sessionEpoch
            && evaluationCase.requiredEvaluatorKinds.includes(evaluatorKind)
          ))
          .flatMap((evaluationCase) => {
            const bundle = state.evaluationEvidenceBundles.find((candidate) => (
              candidate.bundleId === evaluationCase.evidenceBundleId
              && candidate.bundleHash === evaluationCase.evidenceBundleHash
              && candidate.sessionEpoch === state.sessionEpoch
            ));
            return bundle?.evidenceRefs.map((reference) => reference.evidenceId) ?? [];
          }),
      )
    : null;
  const subject = createAccessSubject({
    role,
    sessionId: state.sessionId,
    sessionEpoch: state.sessionEpoch,
    courseId: state.scenario.courseId,
    purpose: role.actorKind === "teacher" ? "audit" : "runtime",
  });
  return state.evidence.filter((evidence) => {
    const fallbackEvent = state.events.findLast((event) => (
      event.eventType === "evidence_recorded"
      && (event.payload.evidence as { evidenceId?: string } | undefined)?.evidenceId
        === evidence.evidenceId
    ));
    const audience = evidence.audience
      ?? fallbackEvent?.audience
      ?? resourceAudience({
        scenario: state.scenario,
        sessionId: state.sessionId,
        sessionEpoch: state.sessionEpoch,
        visibility: evidence.visibility,
        ...(fallbackEvent ? {
          actorId: fallbackEvent.actorId,
          visibleToActorIds: fallbackEvent.visibleToActorIds,
          payload: fallbackEvent.payload,
        } : {}),
      });
    return (
      authorizeResource(subject, audience).allowed
      || frozenEvaluationEvidenceIds?.has(evidence.evidenceId) === true
    );
  });
}

function buildLearningCuratorInput(
  state: WorldState,
  review: TeacherAssessmentReview,
  learningCuratorRole: RoleContract,
) {
  const learningEvidenceIds = new Set(
    visibleEvidenceForRole(state, learningCuratorRole).map(
      (item) => item.evidenceId,
    ),
  );
  const dimensions = review.dimensions.map((dimension) => ({
    dimensionId: dimension.dimensionId,
    finalScore: dimension.finalScore,
    maxScore: dimension.maxScore,
    publicFeedback: dimension.publicFeedback,
    evidenceRefs: dimension.evidenceRefs.filter((evidenceRef) => (
      learningEvidenceIds.has(evidenceRef)
    )),
  }));
  if (!dimensions.some((dimension) => dimension.evidenceRefs.length > 0)) {
    throw new InvalidWorldActionError(
      "教师终评没有可授权给学习策展节点的证据，不能生成监督学习候选",
    );
  }
  return {
    reviewId: review.reviewId,
    evaluationCaseId: review.evaluationCaseId,
    finalScore: review.finalScore,
    publicSummary: review.publicSummary,
    dimensions,
    finalHash: review.finalHash,
  };
}

function studentSafeMediaOutput(
  output: MediaProcessingOutput,
): MediaProcessingOutput {
  const extracted = studentSafeUnknown(output.extracted) as Record<string, unknown>;
  const toolObservation = extracted.toolObservation;
  if (
    toolObservation
    && typeof toolObservation === "object"
    && !Array.isArray(toolObservation)
  ) {
    extracted.toolObservation = {
      ...(toolObservation as Record<string, unknown>),
      providerRequestId: null,
    };
  }
  const execution = GovernanceExecutionTraceSchema.safeParse(
    extracted.governanceExecution,
  );
  if (execution.success) {
    extracted.governanceExecution = {
      ...execution.data,
      modelRequestId: null,
    };
  }
  return MediaProcessingOutputSchema.parse({
    ...output,
    extracted,
    providerRequestId: null,
  });
}

const studentRedactedId = "redacted";

function studentSafeUnknown(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => studentSafeUnknown(item));
  }
  if (!value || typeof value !== "object") return value;
  const safe: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (/^(?:requestId|idempotencyKey)$/iu.test(key)) {
      safe[key] = studentRedactedId;
      continue;
    }
    if (/^(?:providerRequestId|modelRequestId)$/iu.test(key)) {
      safe[key] = null;
      continue;
    }
    if (/^(?:reviewedBy|reviewNote|internalNote|teacherNote|reviewer)$/iu.test(key)) {
      safe[key] = null;
      continue;
    }
    if (
      /^(?:rawError|providerError|errorMessage|stack|authorization|credential|apiKey|apiSecret|signature|headers|leaseToken|claimToken|lockToken)$/iu
        .test(key)
    ) {
      safe[key] = null;
      continue;
    }
    if (/^(?:errorCode|lastErrorCode)$/iu.test(key)) {
      safe[key] = child ? "OPERATION_FAILED" : null;
      continue;
    }
    safe[key] = studentSafeUnknown(child);
  }
  return safe;
}

function studentSafeMediaTask(
  task: MediaProcessingTask,
): MediaProcessingTask {
  return MediaProcessingTaskSchema.parse({
    ...task,
    requestId: studentRedactedId,
    idempotencyKey: studentRedactedId,
    steps: task.steps.map((step) => ({
      ...step,
      idempotencyKey: studentRedactedId,
      output: step.output
        ? studentSafeMediaOutput(step.output)
        : null,
      lastErrorCode: step.lastErrorCode ? "PROCESSING_STEP_FAILED" : null,
    })),
  });
}

function studentSafeGovernanceReview(
  review: GovernanceReview,
): GovernanceReview {
  return GovernanceReviewSchema.parse({
    ...review,
    requestId: studentRedactedId,
    reviewedBy: null,
    reviewNote: null,
  });
}

function studentSafeGovernanceFinding(
  finding: GovernanceFinding,
): GovernanceFinding {
  return GovernanceFindingSchema.parse({
    ...finding,
    executionTrace: finding.executionTrace
      ? {
          ...finding.executionTrace,
          modelRequestId: null,
        }
      : null,
    providerRequestId: null,
    errorCode: finding.errorCode
      ? "GOVERNANCE_BRANCH_DEGRADED"
      : null,
  });
}

function studentAssessmentFeedback(
  state: WorldState,
  role: RoleContract,
  visibleEvidenceIds: ReadonlySet<string>,
): StudentAssessmentFeedback | null {
  if (role.actorKind !== "student") return null;
  const review = state.teacherAssessmentReviews.at(-1);
  if (!review) return null;
  const evaluationCase = state.evaluationCases.find(
    (item) => item.evaluationCaseId === review.evaluationCaseId,
  );
  if (!evaluationCase) return null;
  const dimensions = review.dimensions.map((decision) => {
    const dimension = evaluationCase.dimensions.find(
      (item) => item.dimensionId === decision.dimensionId,
    );
    if (!dimension) {
      throw new Error(`教师终评引用未知评价维度：${decision.dimensionId}`);
    }
    return {
      dimensionId: decision.dimensionId,
      label: dimension.label,
      score: decision.finalScore,
      maxScore: decision.maxScore,
      feedback: decision.publicFeedback,
      evidenceRefs: decision.evidenceRefs.filter((evidenceRef) => (
        visibleEvidenceIds.has(evidenceRef)
      )),
    };
  });
  return StudentAssessmentFeedbackSchema.parse({
    evaluationCaseId: review.evaluationCaseId,
    finalScore: review.finalScore,
    dimensions,
    publicSummary: review.publicSummary,
    finalizedAt: review.reviewedAt,
  });
}

function projectEventForRole(
  event: WorldEvent,
  role: RoleContract,
): WorldEvent {
  if (role.actorKind === "teacher") return event;
  const payload = structuredClone(event.payload);
  if (
    event.eventType === "media_processing_step_completed"
    || event.eventType === "media_processing_manual_supplied"
  ) {
    const output = MediaProcessingOutputSchema.safeParse(payload.output);
    if (output.success) {
      payload.output = studentSafeMediaOutput(output.data);
    }
  }
  if (
    event.eventType === "governance_review_requested"
    || event.eventType === "governance_review_reopened"
    || event.eventType === "governance_review_arbitrated"
    || event.eventType === "governance_reviewed"
  ) {
    const review = GovernanceReviewSchema.safeParse(payload.review);
    if (review.success) {
      payload.review = studentSafeGovernanceReview(review.data);
    }
  }
  if (Array.isArray(payload.findings)) {
    payload.findings = payload.findings.map((rawFinding) => {
      const finding = GovernanceFindingSchema.safeParse(rawFinding);
      return finding.success
        ? studentSafeGovernanceFinding(finding.data)
        : rawFinding;
    });
  }
  if (event.eventType === "teacher_reviewed") {
    delete payload.review;
    delete payload.requestId;
    delete payload.requestPayloadHash;
  }
  return WorldEventSchema.parse({
    ...event,
    correlationId: studentRedactedId,
    payload: studentSafeUnknown(payload) as Record<string, unknown>,
  });
}

function currentVirtualTime(start: string, elapsedMinutes: number): string {
  const [hours = 0, minutes = 0] = start.split(":").map(Number);
  const total = hours * 60 + minutes + elapsedMinutes;
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export class WorldEngine {
  readonly scenario: ScenarioPackage;
  readonly store: EventStore;
  readonly bus: MessageBus;
  readonly #clock: Clock;
  readonly #ids: IdGenerator;
  readonly #scenarioResolver: ScenarioReleaseResolver;
  readonly #defaultRelease: PublishedScenarioPackage;
  readonly #registeredReleases = new Map<string, PublishedScenarioPackage>();
  readonly #sessionReleases = new Map<string, PublishedScenarioPackage>();

  constructor(options: EngineOptions = {}) {
    const fallbackScenario = options.scenario ?? demoScenario;
    this.#defaultRelease = options.defaultRelease ?? createStaticScenarioRelease({
      releaseId: `release-${fallbackScenario.scenarioId}-${fallbackScenario.version}-baseline`,
      package: fallbackScenario,
    });
    this.scenario = this.#defaultRelease.package;
    this.#scenarioResolver = options.scenarioResolver
      ?? new StaticScenarioReleaseResolver([this.#defaultRelease]);
    this.store = options.store ?? new InMemoryEventStore();
    this.bus = options.bus ?? new InProcessMessageBus();
    this.#clock = options.clock ?? systemClock;
    this.#ids = options.ids ?? randomIds;
  }

  registerScenarioRelease(release: PublishedScenarioPackage): void {
    if (release.ref.contentHash !== hashValue(release.package)) {
      throw new Error(`情境发布快照哈希不匹配：${release.ref.releaseId}`);
    }
    const current = this.#registeredReleases.get(release.ref.releaseId);
    if (current && current.ref.contentHash !== release.ref.contentHash) {
      throw new Error(`情境发布标识已绑定不同内容：${release.ref.releaseId}`);
    }
    this.#registeredReleases.set(release.ref.releaseId, structuredClone(release));
  }

  async createSession(
    sessionId: string,
    reset = false,
    requestedRef?: ScenarioPackageRef,
  ): Promise<StateProjection> {
    const existing = await this.store.load(sessionId);
    if (existing.length > 0 && !reset) {
      const release = this.releaseForEvents(existing);
      reduceWorldState(sessionId, release.package, existing);
      const teacher = release.package.roles.find((role) => role.actorKind === "teacher");
      if (!teacher) throw new Error("情境缺少教师角色");
      return this.getProjection(sessionId, teacher.agentId);
    }
    const release = requestedRef
      ? this.resolveRelease(requestedRef)
      : existing.length > 0
        ? this.releaseForEvents(existing)
        : this.#defaultRelease;
    if (reset) await this.store.reset(sessionId);
    this.#sessionReleases.set(sessionId, release);
    const scenario = release.package;

    const now = this.#clock.now();
    const sessionEpoch = this.#ids.next("session-epoch");
    const teacher = scenario.roles.find((role) => role.actorKind === "teacher");
    if (!teacher) throw new Error("情境缺少教师角色");

    const drafts: EventDraft[] = [
      {
        eventType: "session_started",
        actorId: teacher.agentId,
        summary: `${scenario.title}实训会话已启动`,
        visibility: ["public_world", "audit_only"],
        payload: {
          scenarioId: scenario.scenarioId,
          scenarioVersion: scenario.version,
          scenarioRef: release.ref,
          compilerVersion: release.compilerVersion,
          sessionEpoch,
          virtualMinute: 0,
        },
      },
      ...scenario.roles.map<EventDraft>((role) => ({
        eventType: "role_assigned",
        actorId: "system",
        summary: `${role.displayName}进入岗位`,
        visibility: role.actorKind === "teacher" ? teacherVisibility : assignedVisibility,
        payload: { agentId: role.agentId, roleId: role.roleId, teamId: role.teamId },
      })),
      ...scenario.materials.map<EventDraft>((material) => ({
        eventType: "material_registered",
        actorId: "system",
        summary: `素材已登记：${material.title}`,
        visibility: assignedVisibility,
        payload: { material },
      })),
      {
        eventType: "node_activated",
        actorId: "system",
        summary: `进入${scenario.nodes.find((node) => node.nodeId === scenario.bootstrap.entryNodeId)?.title ?? "情境入口"}节点`,
        visibility: ["public_world", "audit_only"],
        payload: { nodeId: scenario.bootstrap.entryNodeId, virtualMinute: 0 },
      },
      ...scenario.bootstrap.initialFacts.map<EventDraft>((fact) => ({
        eventType: "world_fact_confirmed",
        actorId: "system",
        summary: `权威事实已确认：${fact.statement}`,
        visibility: [fact.visibility, "audit_only"],
        payload: { fact },
      })),
      ...scenario.bootstrap.openingMessages.map<EventDraft>((message) => this.messageDraft({
        ...message,
        now,
      })),
    ];
    await this.commit(sessionId, 0, drafts, this.#ids.next("bootstrap"), sessionEpoch, 0);
    return this.getProjection(sessionId, teacher.agentId);
  }

  async execute(rawCommand: Command): Promise<StateProjection> {
    const command = CommandSchema.parse(rawCommand);
    return this.executeCommand(command, null, null);
  }

  async executeAction(rawEnvelope: ActionEnvelope): Promise<StateProjection> {
    const envelope = ActionEnvelopeSchema.parse(rawEnvelope);
    if (hashValue(envelope.command.payload) !== envelope.payloadHash) {
      throw new InvalidWorldActionError("ActionEnvelope payloadHash 与命令载荷不一致");
    }
    const actionContext = ActionAuditContextSchema.parse({
      schemaVersion: envelope.envelopeVersion,
      actionId: envelope.actionId,
      rootActionId: envelope.causality.rootActionId,
      causationId: envelope.causality.causationId,
      commandName: envelope.command.name,
      sourceMode: envelope.source.mode,
      sourceAssertion: envelope.source.assertion,
      payloadHash: envelope.payloadHash,
      idempotencyHash: hashValue(envelope.idempotencyKey),
      actorBindingHash: hashValue(envelope.actor),
      causalDepth: envelope.causality.causalDepth,
      objectRefCount: envelope.objectRefs.length,
      evidenceRefCount: (
        envelope.evidence.evidenceRefs.length
        + envelope.evidence.citationRefs.length
        + envelope.evidence.toolResultRefs.length
      ),
    });
    return this.executeCommand(envelope.command, actionContext, envelope.actor);
  }

  private async executeCommand(
    command: Command,
    actionContext: ActionAuditContext | null,
    actorContext: ActionActorContext | null,
  ): Promise<StateProjection> {
    const events = await this.store.load(command.sessionId);
    if (events.length === 0) throw new SessionNotFoundError(command.sessionId);
    const release = this.releaseForEvents(events);
    const state = reduceWorldState(command.sessionId, release.package, events);
    const role = this.requireRole(command.actorId, release.package);
    if (
      actorContext
      && (
        actorContext.sessionEpoch !== state.sessionEpoch
        || actorContext.actorId !== role.agentId
        || actorContext.actorKind !== role.actorKind
        || actorContext.roleId !== role.roleId
        || actorContext.teamId !== role.teamId
      )
    ) {
      throw new PermissionDeniedError("ActionEnvelope 服务端主体快照与当前岗位绑定不一致");
    }
    if (!roleCanExecuteCommand(role, command.name)) {
      throw new PermissionDeniedError(`${role.displayName}无权执行 ${command.name}`);
    }
    if (actionContext) {
      const duplicate = events.find((event) => (
        event.actionContext?.idempotencyHash === actionContext.idempotencyHash
      ))?.actionContext;
      if (duplicate) {
        if (
          duplicate.payloadHash !== actionContext.payloadHash
          || duplicate.commandName !== actionContext.commandName
          || duplicate.actorBindingHash !== actionContext.actorBindingHash
        ) {
          throw new InvalidWorldActionError(
            "ActionEnvelope 幂等键已绑定其他主体、命令或载荷",
          );
        }
        return this.getProjection(command.sessionId, command.actorId);
      }
    }
    if (command.expectedStateVersion !== state.stateVersion) {
      throw new StateVersionConflictError(command.expectedStateVersion, state.stateVersion);
    }

    const drafts = await this.decide(state, role, command);
    if (drafts.length > 0) {
      await this.commit(
        command.sessionId,
        state.stateVersion,
        drafts,
        command.correlationId,
        state.sessionEpoch,
        0,
        actionContext,
      );
    }
    return this.getProjection(command.sessionId, command.actorId);
  }

  async preflightMaterialInspection(
    rawCommand: Command,
  ): Promise<Material> {
    const command = CommandSchema.parse(rawCommand);
    if (command.name !== "inspect_material") {
      throw new InvalidWorldActionError(
        "素材检查预检只接受 inspect_material 命令",
      );
    }
    const events = await this.store.load(command.sessionId);
    if (events.length === 0) {
      throw new SessionNotFoundError(command.sessionId);
    }
    const release = this.releaseForEvents(events);
    const state = reduceWorldState(
      command.sessionId,
      release.package,
      events,
    );
    const role = this.requireRole(command.actorId, release.package);
    if (!role.allowedIntents.includes(command.name)) {
      throw new PermissionDeniedError(
        `${role.displayName}无权执行 ${command.name}`,
      );
    }
    if (command.expectedStateVersion !== state.stateVersion) {
      throw new StateVersionConflictError(
        command.expectedStateVersion,
        state.stateVersion,
      );
    }
    return structuredClone(
      this.requireInspectableMaterial(state, role, command),
    );
  }

  async registerUploadedMaterial(input: {
    sessionId: string;
    actorId: string;
    expectedStateVersion: number;
    correlationId: string;
    material: Material;
  }): Promise<StateProjection> {
    const events = await this.store.load(input.sessionId);
    if (events.length === 0) throw new SessionNotFoundError(input.sessionId);
    const release = this.releaseForEvents(events);
    const state = reduceWorldState(input.sessionId, release.package, events);
    const role = this.requireRole(input.actorId, release.package);
    if (state.stateVersion !== input.expectedStateVersion) {
      throw new StateVersionConflictError(input.expectedStateVersion, state.stateVersion);
    }
    if (!role.toolPolicy.includes("upload_material")) {
      throw new PermissionDeniedError("当前岗位没有素材上传能力");
    }
    const material = MaterialSchema.parse(input.material);
    const config = state.scenario.productionConfig;
    if (!config) throw new InvalidWorldActionError("当前固定情境包没有启用素材上传");
    if (
      material.origin !== "upload"
      || material.uploadedBy !== role.agentId
      || !material.mimeType
      || material.sizeBytes === undefined
      || !material.contentHash
      || !material.createdAt
      || !material.sourceRef.startsWith(`object://${state.sessionId}/`)
    ) {
      throw new InvalidWorldActionError("上传素材缺少服务端生成的来源、摘要或归属信息");
    }
    if (
      material.sizeBytes > config.maximumUploadBytes
      || !config.allowedUploadMimeTypes.includes(material.mimeType)
    ) {
      throw new InvalidWorldActionError("上传素材类型或大小超出固定情境包限制");
    }
    if (!material.visibleToRoles.includes(role.roleId)) {
      throw new InvalidWorldActionError("上传素材必须对上传岗位可见");
    }
    const existingByHash = state.materials.find((item) => (
      item.origin === "upload" && item.contentHash === material.contentHash
    ));
    if (existingByHash) return this.getProjection(input.sessionId, role.agentId);
    if (state.materials.some((item) => item.materialId === material.materialId)) {
      throw new InvalidWorldActionError("素材标识已经绑定其他内容");
    }
    await this.commit(
      input.sessionId,
      state.stateVersion,
      [{
        eventType: "material_registered",
        actorId: role.agentId,
        summary: `岗位上传素材已登记：${material.title}`,
        visibility: assignedVisibility,
        payload: { material, teamId: role.teamId },
      }],
      input.correlationId,
      state.sessionEpoch,
      0,
    );
    return this.getProjection(input.sessionId, role.agentId);
  }

  async startMediaProcessingStep(input: {
    sessionId: string;
    sessionEpoch: string;
    taskId: string;
    stepId: string;
    expectedStateVersion: number;
    workerId: string;
    providerMode?: "mock" | "live";
    correlationId: string;
  }): Promise<WorldEvent[]> {
    const state = await this.getStateSnapshot(input.sessionId);
    if (state.stateVersion !== input.expectedStateVersion) {
      throw new StateVersionConflictError(input.expectedStateVersion, state.stateVersion);
    }
    if (state.sessionEpoch !== input.sessionEpoch) {
      throw new InvalidWorldActionError("处理任务所属会话世代已经失效");
    }
    const task = state.mediaProcessingTasks.find((item) => item.taskId === input.taskId);
    if (!task || task.sessionEpoch !== state.sessionEpoch) {
      throw new InvalidWorldActionError("处理任务不存在或会话世代不匹配");
    }
    const material = state.materials.find((item) => item.materialId === task.materialId);
    const currentHash = material?.contentHash ?? (material
      ? hashValue({
          sourceRef: material.sourceRef,
          mediaType: material.mediaType,
          version: material.version,
        })
      : null);
    if (
      !material
      || material.version !== task.materialVersion
      || material.sourceRef !== task.inputRef
      || currentHash !== task.inputContentHash
    ) {
      throw new InvalidWorldActionError("处理任务固定的素材版本、引用或内容哈希已经失效");
    }
    const step = task.steps.find((item) => item.stepId === input.stepId);
    if (!step) throw new InvalidWorldActionError("处理步骤不存在");
    if (step.status === "succeeded" || step.status === "manually_completed") return [];
    if (step.status === "failed") {
      throw new InvalidWorldActionError("失败步骤必须先由授权命令请求重试");
    }
    if (step.attempts >= step.maxAttempts) {
      throw new InvalidWorldActionError("处理步骤已经达到最大尝试次数");
    }
    return this.commit(
      input.sessionId,
      state.stateVersion,
      [{
        eventType: "media_processing_started",
        actorId: "system",
        summary: `开始处理步骤：${step.capability}`,
        visibility: assignedVisibility,
        audience: task.audience,
        payload: {
          taskId: task.taskId,
          stepId: step.stepId,
          capability: step.capability,
          workerId: input.workerId,
          providerMode: input.providerMode ?? "mock",
          attempt: step.attempts + 1,
          inputContentHash: task.inputContentHash,
        },
      }],
      input.correlationId,
      state.sessionEpoch,
      0,
    );
  }

  async completeMediaProcessingStep(input: {
    sessionId: string;
    sessionEpoch: string;
    taskId: string;
    stepId: string;
    expectedStateVersion: number;
    output: MediaProcessingOutput;
    correlationId: string;
  }): Promise<WorldEvent[]> {
    const state = await this.getStateSnapshot(input.sessionId);
    if (state.stateVersion !== input.expectedStateVersion) {
      throw new StateVersionConflictError(input.expectedStateVersion, state.stateVersion);
    }
    if (state.sessionEpoch !== input.sessionEpoch) {
      throw new InvalidWorldActionError("处理结果所属会话世代已经失效");
    }
    const task = state.mediaProcessingTasks.find((item) => item.taskId === input.taskId);
    const step = task?.steps.find((item) => item.stepId === input.stepId);
    if (!task || !step) throw new InvalidWorldActionError("处理任务或步骤不存在");
    const output = MediaProcessingOutputSchema.parse(input.output);
    if (
      output.capability !== step.capability
      || output.providerMode === "manual"
      || output.trust !== "observation_only"
      || output.verificationStatus !== "unverified"
      || output.sourceRef !== task.inputRef
    ) {
      throw new InvalidWorldActionError("工具处理输出试图改变能力、来源或核验状态");
    }
    if (step.status === "succeeded") {
      if (step.output?.outputId === output.outputId) return [];
      throw new InvalidWorldActionError("处理步骤已经绑定不同的成功输出");
    }
    if (step.status !== "running") {
      throw new InvalidWorldActionError("只有运行中的步骤可以提交工具输出");
    }
    return this.commit(
      input.sessionId,
      state.stateVersion,
      [{
        eventType: "media_processing_step_completed",
        actorId: "system",
        summary: `处理步骤完成：${step.capability}；结果仍是待核验观察`,
        visibility: assignedVisibility,
        audience: task.audience,
        payload: {
          taskId: task.taskId,
          stepId: step.stepId,
          inputContentHash: task.inputContentHash,
          output,
        },
      }],
      input.correlationId,
      state.sessionEpoch,
      0,
    );
  }

  async failMediaProcessingStep(input: {
    sessionId: string;
    sessionEpoch: string;
    taskId: string;
    stepId: string;
    expectedStateVersion: number;
    errorCode: string;
    providerMode?: "mock" | "live";
    correlationId: string;
  }): Promise<WorldEvent[]> {
    const state = await this.getStateSnapshot(input.sessionId);
    if (state.stateVersion !== input.expectedStateVersion) {
      throw new StateVersionConflictError(input.expectedStateVersion, state.stateVersion);
    }
    if (state.sessionEpoch !== input.sessionEpoch) {
      throw new InvalidWorldActionError("处理失败结果所属会话世代已经失效");
    }
    const task = state.mediaProcessingTasks.find((item) => item.taskId === input.taskId);
    const step = task?.steps.find((item) => item.stepId === input.stepId);
    if (!task || !step) throw new InvalidWorldActionError("处理任务或步骤不存在");
    if (step.status === "failed") return [];
    if (step.status !== "running") {
      throw new InvalidWorldActionError("只有运行中的步骤可以记录处理失败");
    }
    const errorCode = input.errorCode.trim().slice(0, 120);
    if (!errorCode) throw new InvalidWorldActionError("处理失败必须提供安全错误码");
    return this.commit(
      input.sessionId,
      state.stateVersion,
      [{
        eventType: "media_processing_step_failed",
        actorId: "system",
        summary: `处理步骤失败：${step.capability}`,
        visibility: assignedVisibility,
        audience: task.audience,
        payload: {
          taskId: task.taskId,
          stepId: step.stepId,
          capability: step.capability,
          inputContentHash: task.inputContentHash,
          errorCode,
          providerMode: input.providerMode ?? "mock",
        },
      }],
      input.correlationId,
      state.sessionEpoch,
      0,
    );
  }

  async finalizeMediaProcessingTask(input: {
    sessionId: string;
    sessionEpoch: string;
    taskId: string;
    expectedStateVersion: number;
    correlationId: string;
  }): Promise<WorldEvent[]> {
    const state = await this.getStateSnapshot(input.sessionId);
    if (state.stateVersion !== input.expectedStateVersion) {
      throw new StateVersionConflictError(input.expectedStateVersion, state.stateVersion);
    }
    if (state.sessionEpoch !== input.sessionEpoch) {
      throw new InvalidWorldActionError("处理任务所属会话世代已经失效");
    }
    const task = state.mediaProcessingTasks.find((item) => item.taskId === input.taskId);
    if (!task) throw new InvalidWorldActionError("处理任务不存在");
    if (task.steps.some((step) => step.status === "queued" || step.status === "running")) {
      throw new InvalidWorldActionError("处理任务仍有未结束步骤");
    }
    const status = settledProcessingStatus(task);
    if (task.status === status && task.completedAt) return [];
    if (task.governanceReviewId) {
      const review = state.governanceReviews.find(
        (item) => item.reviewId === task.governanceReviewId,
      );
      if (
        !review
        || review.mediaTaskId !== task.taskId
        || review.inputContentHash !== task.inputContentHash
        || review.materialId !== task.materialId
        || review.materialVersion !== task.materialVersion
      ) {
        throw new InvalidWorldActionError(
          "治理复核与固定媒体任务输入不一致",
        );
      }
      if (review.status !== "running") {
        throw new InvalidWorldActionError(
          "只有运行中的治理复核可以进入仲裁",
        );
      }
      const now = this.#clock.now();
      const arbitrationRevision = review.arbitrationRevision + 1;
      const findings = task.steps
        .map((step): GovernanceFinding => {
          if (
            !step.governanceDomain
            || !step.governanceNode
            || step.branchPriority === null
          ) {
            throw new InvalidWorldActionError(
              "治理任务步骤缺少领域或确定性优先级",
            );
          }
          let execution: ReturnType<
            typeof evaluateGovernanceExecution
          > | null = null;
          let toolRecommendation: GovernanceRecommendation = "unavailable";
          let modelRecommendation: GovernanceRecommendation = "unavailable";
          if (step.status === "succeeded") {
            const toolObservationValue =
              step.output?.extracted.toolObservation;
            if (
              !toolObservationValue
              || typeof toolObservationValue !== "object"
              || Array.isArray(toolObservationValue)
            ) {
              throw new InvalidWorldActionError(
                "治理输出缺少固定工具观察",
              );
            }
            const toolObservation =
              toolObservationValue as Record<string, unknown>;
            const toolExtractedValue = toolObservation.extracted;
            if (
              !toolExtractedValue
              || typeof toolExtractedValue !== "object"
              || Array.isArray(toolExtractedValue)
            ) {
              throw new InvalidWorldActionError(
                "治理工具观察缺少结构化输出",
              );
            }
            const modelDecision = GovernanceModelDecisionSchema.parse(
              step.output?.extracted.modelDecision,
            );
            const suppliedTrace = GovernanceExecutionTraceSchema.parse(
              step.output?.extracted.governanceExecution,
            );
            toolRecommendation = GovernanceRecommendationSchema.parse(
              step.output?.extracted.toolRecommendation,
            );
            modelRecommendation = GovernanceRecommendationSchema.parse(
              step.output?.extracted.modelRecommendation,
            );
            if (
              recommendationFromExtracted(
                toolExtractedValue as Record<string, unknown>,
              ) !== toolRecommendation
              || modelDecision.recommendation !== modelRecommendation
            ) {
              throw new InvalidWorldActionError(
                "治理工具或模型建议与固定执行记录不一致",
              );
            }
            const executionContext = buildGovernanceExecutionContext(
              state,
              task,
              step,
            );
            const compiledPrompt = compileGovernanceModelPrompt(
              executionContext,
              toolObservation,
            );
            execution = evaluateGovernanceExecution(
              executionContext,
              {
                toolRecommendation,
                modelDecision,
                compiledPrompt,
                modelTrace: {
                  status: "completed",
                  profileId: suppliedTrace.modelProfileId,
                  provider: suppliedTrace.modelProvider,
                  mode: suppliedTrace.modelMode,
                  model: suppliedTrace.modelName,
                  requestId: suppliedTrace.modelRequestId,
                },
              },
            );
            if (
              hashValue(suppliedTrace) !== hashValue(execution.trace)
              || recommendationFromExtracted(
                step.output?.extracted ?? {},
              ) !== execution.recommendation
            ) {
              throw new InvalidWorldActionError(
                "治理提供方输出未绑定实际提示词、规则集或知识快照",
              );
            }
          } else if (step.status === "manually_completed") {
            toolRecommendation = "review";
            modelRecommendation = "review";
          }
          const recommendation = execution?.recommendation
            ?? (step.status === "failed"
              ? "unavailable" as const
              : "review" as const);
          const providerMode = step.output?.providerMode
            ?? step.effectiveProviderMode
            ?? step.requestedProviderMode
            ?? "mock";
          const errorCode = step.status === "failed"
            ? step.lastErrorCode ?? "provider_execution_failed"
            : null;
          return GovernanceFindingSchema.parse({
            findingId: [
              "governance-finding",
              review.reviewId,
              `r${arbitrationRevision}`,
              step.governanceDomain,
            ].join(":"),
            reviewId: review.reviewId,
            arbitrationRevision,
            domain: step.governanceDomain,
            node: step.governanceNode,
            executionTrace: execution?.trace ?? null,
            toolRecommendation,
            modelRecommendation,
            branchPriority: step.branchPriority,
            materialId: task.materialId,
            materialVersion: task.materialVersion,
            mediaTaskId: task.taskId,
            stepId: step.stepId,
            capability: step.capability,
            executionStatus: step.status === "manually_completed"
              ? "manual"
              : step.status === "failed"
                ? "degraded"
                : "completed",
            provider: step.output?.provider ?? "iflytek",
            providerMode,
            recommendation,
            severity: governanceSeverity(recommendation),
            summary: step.output?.summary
              ?? `治理分支不可用（${errorCode ?? "provider_execution_failed"}）；该分支不得视为通过。`,
            riskLabels: [...new Set([
              ...governanceRiskLabels(step.output),
              ...(execution?.riskLabels ?? []),
            ])],
            confidence: step.output?.confidence ?? 0,
            sourceRef: step.output?.sourceRef ?? task.inputRef,
            providerRequestId: step.output?.providerRequestId ?? null,
            errorCode,
            verificationStatus: "pending_teacher",
            createdAt: now,
            audience: task.audience,
          });
        })
        .sort((left, right) => (
          left.domain.localeCompare(right.domain)
          || left.findingId.localeCompare(right.findingId)
        ));
      if (findings.length !== review.branchDomains.length) {
        throw new InvalidWorldActionError(
          "治理仲裁必须等待全部固定专业分支进入终态",
        );
      }
      const domainSet = new Set(findings.map((finding) => finding.domain));
      if (
        review.branchDomains.some((domain) => !domainSet.has(domain))
        || domainSet.size !== review.branchDomains.length
      ) {
        throw new InvalidWorldActionError(
          "治理 Finding 领域集合与复核快照不一致",
        );
      }
      const arbitration = arbitrateGovernanceFindings(findings);
      const arbitratedReview = GovernanceReviewSchema.parse({
        ...review,
        status: "awaiting_teacher",
        arbitrationRevision,
        policyVersion: governancePolicyVersion,
        verdict: arbitration.verdict,
        conflict: arbitration.conflict,
        latestFindingIds: findings.map((finding) => finding.findingId),
        winningFindingId: arbitration.winningFindingId,
        findingSetHash: arbitration.findingSetHash,
        decisionHash: arbitration.decisionHash,
        arbitratedAt: now,
        reviewDecision: null,
        reviewedBy: null,
        reviewedAt: null,
        reviewNote: null,
      });
      return this.commit(
        input.sessionId,
        state.stateVersion,
        [
          {
            eventType: "media_processing_completed",
            actorId: "system",
            summary: status === "succeeded"
              ? "四域治理专业分支已全部结束"
              : "四域治理专业分支已结束，失败分支按降级保守处理",
            visibility: assignedVisibility,
            audience: task.audience,
            payload: { taskId: task.taskId, status },
          },
          {
            eventType: "governance_review_arbitrated",
            actorId: "system",
            summary: `治理仲裁完成：${arbitratedReview.verdict}；等待教师复核`,
            visibility: assignedVisibility,
            audience: task.audience,
            payload: {
              review: arbitratedReview,
              findings,
              policyVersion: governancePolicyVersion,
              findingSetHash: arbitration.findingSetHash,
              decisionHash: arbitration.decisionHash,
            },
          },
        ],
        input.correlationId,
        state.sessionEpoch,
        0,
      );
    }
    return this.commit(
      input.sessionId,
      state.stateVersion,
      [{
        eventType: "media_processing_completed",
        actorId: "system",
        summary: status === "succeeded"
          ? "多模态处理档案已完成；输出保持待核验观察"
          : status === "partially_succeeded"
            ? "多模态处理档案部分成功；失败步骤可单独重试或人工补录"
            : "多模态处理档案失败；原素材与失败证据均已保留",
        visibility: assignedVisibility,
        audience: task.audience,
        payload: { taskId: task.taskId, status },
      }],
      input.correlationId,
      state.sessionEpoch,
      0,
    );
  }

  async getProjection(sessionId: string, actorId: string): Promise<StateProjection> {
    const events = await this.store.load(sessionId);
    if (events.length === 0) throw new SessionNotFoundError(sessionId);
    const release = this.releaseForEvents(events);
    const scenario = release.package;
    const state = reduceWorldState(sessionId, scenario, events);
    const role = this.requireRole(actorId, scenario);
    const subject = createAccessSubject({
      role,
      sessionId,
      sessionEpoch: state.sessionEpoch,
      courseId: scenario.courseId,
      purpose: role.actorKind === "teacher" ? "audit" : "runtime",
    });
    const visibleEvents = state.events
      .filter((event) => (
        canSeeEvent(role, event, scenario, state.sessionEpoch)
      ))
      .map((event) => projectEventForRole(event, role));
    const canSeeEntity = (
      visibility: VisibilityScope[],
      explicitAudience: ResourceAudience | undefined,
      fallbackEvent: WorldEvent | undefined,
    ): boolean => {
      const audience = explicitAudience
        ?? fallbackEvent?.audience
        ?? resourceAudience({
          scenario,
          sessionId,
          sessionEpoch: state.sessionEpoch,
          visibility,
          ...(fallbackEvent ? {
            actorId: fallbackEvent.actorId,
            visibleToActorIds: fallbackEvent.visibleToActorIds,
            payload: fallbackEvent.payload,
          } : {}),
        });
      return authorizeResource(subject, audience).allowed;
    };
    const currentNode = state.nodes.find((node) => node.nodeId === state.currentNodeId) ?? state.nodes[0];
    if (!currentNode) throw new Error("情境至少需要一个节点");
    const visibleEvidence = visibleEvidenceForRole(state, role);
    const visibleEvidenceIds = new Set(
      visibleEvidence.map((item) => item.evidenceId),
    );
    const visibleMaterials = state.materials.filter((material) => (
      role.actorKind === "teacher" || material.visibleToRoles.includes(role.roleId)
    ));
    const visibleMaterialIds = new Set(
      visibleMaterials.map((material) => material.materialId),
    );
    const configuredNodeGuide = scenario.courseGuide?.nodeGuides.find(
      (guide) => guide.nodeId === currentNode.nodeId,
    );
    const currentNodeGuide = configuredNodeGuide
      ? {
          nodeId: configuredNodeGuide.nodeId,
          situation: configuredNodeGuide.situation,
          studentGoal: configuredNodeGuide.studentGoal,
          requiredOutputs: [...configuredNodeGuide.requiredOutputs],
          requiredMaterialIds: configuredNodeGuide.requiredMaterialIds.filter(
            (materialId) => visibleMaterialIds.has(materialId),
          ),
          suggestedArtifactTemplateIds: [
            ...configuredNodeGuide.suggestedArtifactTemplateIds,
          ],
          decisionQuestions: [...configuredNodeGuide.decisionQuestions],
        }
      : null;
    const courseGuide = scenario.courseGuide
      ? {
          contentVersion: scenario.courseGuide.contentVersion,
          finalDeliverable: scenario.courseGuide.finalDeliverable,
          learningObjectives: structuredClone(
            scenario.courseGuide.learningObjectives,
          ),
          activeRoleBrief: structuredClone(
            scenario.courseGuide.roleBriefs.find(
              (brief) => brief.roleId === role.roleId,
            ) ?? null,
          ),
          currentNodeGuide,
          debrief: structuredClone(scenario.courseGuide.debrief),
        }
      : null;
    const configuredExperienceMapping =
      scenario.experienceDesign?.nodeMappings.find(
        (mapping) => mapping.nodeId === currentNode.nodeId,
      ) ?? null;
    const currentExperienceSceneIds = new Set(
      scenario.experienceDesign?.scenes
        .filter((scene) => scene.nodeIds.includes(currentNode.nodeId))
        .map((scene) => scene.sceneId) ?? [],
    );
    const authoredExperienceSequence = role.actorKind === "student"
      ? deriveAuthoredExperienceSequence({
          scenario,
          nodeId: currentNode.nodeId,
          events: state.events,
        })
      : null;
    const visibleAuthoredTaskIds = authoredExperienceSequence
      ? new Set(authoredExperienceSequence.visibleTaskIds)
      : null;
    const visibleExperienceTasks = configuredExperienceMapping
      ?.operationTasks.filter((task) => (
        (role.actorKind === "teacher" || task.roleIds.includes(role.roleId))
        && (
          !visibleAuthoredTaskIds
          || visibleAuthoredTaskIds.has(task.taskId)
        )
      )) ?? [];
    const visibleExperienceChoiceRefs = new Set([
      ...visibleExperienceTasks.map((task) => task.taskId),
      ...scenario.roleInteractions
        .filter((interaction) => (
          role.actorKind === "teacher"
          || interaction.initiatorActorId === role.agentId
        ))
        .map((interaction) => interaction.optionId),
    ]);
    const visibleExperienceHotspots =
      scenario.experienceDesign?.hotspots
        .filter((hotspot) => (
          currentExperienceSceneIds.has(hotspot.sceneId)
          && (
            role.actorKind === "teacher"
            || hotspot.visibleToRoleIds.includes(role.roleId)
          )
        ))
        .map((hotspot) => ({
          ...structuredClone(hotspot),
          interactionOptionIds: hotspot.interactionOptionIds.filter(
            (optionId) => visibleExperienceChoiceRefs.has(optionId),
          ),
        })) ?? [];
    const visibleExperienceHotspotIds = new Set(
      visibleExperienceHotspots.map((hotspot) => hotspot.hotspotId),
    );
    const visibleWorldOpportunities = configuredExperienceMapping
      ?.worldOpportunities
        .filter((opportunity) => (
          currentExperienceSceneIds.has(opportunity.sceneId)
          && visibleExperienceHotspotIds.has(opportunity.hotspotId)
        ))
        .map((opportunity) => ({
          ...structuredClone(opportunity),
          choiceRefs: opportunity.choiceRefs.filter(
            (choiceRef) => visibleExperienceChoiceRefs.has(choiceRef),
          ),
        }))
        .filter((opportunity) => opportunity.choiceRefs.length > 0) ?? [];
    const visibleExperienceEvidenceSourceRefs = new Set([
      ...visibleExperienceTasks.map((task) => task.taskId),
      ...visibleWorldOpportunities.flatMap((opportunity) => [
        opportunity.opportunityId,
        ...opportunity.choiceRefs,
      ]),
      ...(
        configuredExperienceMapping?.stageDeliverables.map(
          (deliverable) => deliverable.deliverableId,
        ) ?? []
      ),
      ...visibleMaterials.map((material) => material.materialId),
    ]);
    const visibleExperienceCapabilityEvidence =
      configuredExperienceMapping?.capabilityEvidence
        .map((evidence) => ({
          ...structuredClone(evidence),
          sourceRefs: evidence.sourceRefs.filter(
            (sourceRef) => visibleExperienceEvidenceSourceRefs.has(sourceRef),
          ),
        }))
        .filter((evidence) => evidence.sourceRefs.length > 0) ?? [];
    const visibleExperienceEvidenceRequirementIds = new Set(
      visibleExperienceCapabilityEvidence.map(
        (evidence) => evidence.evidenceRequirementId,
      ),
    );
    const experienceGuide = scenario.experienceDesign
      ? {
          schemaVersion: scenario.experienceDesign.schemaVersion,
          contentVersion: scenario.experienceDesign.contentVersion,
          kind: scenario.experienceDesign.kind,
          summary: scenario.experienceDesign.summary,
          currentScenes: structuredClone(
            scenario.experienceDesign.scenes.filter(
              (scene) => currentExperienceSceneIds.has(scene.sceneId),
            ),
          ),
          currentHotspots: visibleExperienceHotspots,
          currentNodeMapping: configuredExperienceMapping
            ? {
                nodeId: configuredExperienceMapping.nodeId,
                operationTasks: structuredClone(visibleExperienceTasks),
                worldOpportunities: visibleWorldOpportunities,
                stageDeliverables: structuredClone(
                  configuredExperienceMapping.stageDeliverables,
                ),
                capabilityEvidence: visibleExperienceCapabilityEvidence,
              }
            : null,
          fixedEvaluation: {
            ...structuredClone(scenario.experienceDesign.fixedEvaluation),
            evidenceRequirementIds:
              scenario.experienceDesign.fixedEvaluation.evidenceRequirementIds
                .filter(
                  (evidenceRequirementId) => (
                    visibleExperienceEvidenceRequirementIds.has(
                      evidenceRequirementId,
                    )
                  ),
                ),
          },
        }
      : null;
    const riskLevel = projectionRiskLevel(state, role);

    const projection = {
      ...createMessageMeta({
        sessionId,
        sceneId: scenario.scenarioId,
        actorId,
        correlationId: `projection-${state.stateVersion}`,
        timestamp: this.#clock.now(),
      }),
      kind: "StateProjection" as const,
      actorKind: role.actorKind,
      role,
      sessionEpoch: state.sessionEpoch,
      stateVersion: state.stateVersion,
      scenario: {
        scenarioId: scenario.scenarioId,
        version: scenario.version,
        releaseId: release.ref.releaseId,
        contentHash: release.ref.contentHash,
        title: scenario.title,
        courseId: scenario.courseId,
        virtualTime: currentVirtualTime(scenario.startVirtualTime, state.virtualMinute),
        remainingMinutes: Math.max(0, scenario.durationMinutes - state.virtualMinute),
        status: state.status,
        roles: scenario.roles.map((item) => ({
          agentId: item.agentId,
          actorKind: item.actorKind,
          roleId: item.roleId,
          displayName: item.displayName,
          purpose: item.purpose,
        })),
      },
      currentNode,
      nodes: state.nodes,
      courseGuide,
      experienceGuide,
      materials: visibleMaterials,
      productionConfig: scenario.productionConfig
        ? structuredClone(scenario.productionConfig)
        : null,
      mediaProcessingTasks: state.mediaProcessingTasks
        .filter((task) => authorizeResource(subject, task.audience).allowed)
        .map((task) => role.actorKind === "teacher"
          ? task
          : studentSafeMediaTask(task)),
      governanceReviews: state.governanceReviews
        .filter((review) => authorizeResource(subject, review.audience).allowed)
        .map((review) => role.actorKind === "teacher"
          ? review
          : studentSafeGovernanceReview(review)),
      governanceFindings: state.governanceFindings
        .filter((finding) => (
          authorizeResource(subject, finding.audience).allowed
        ))
        .map((finding) => role.actorKind === "teacher"
          ? finding
          : studentSafeGovernanceFinding(finding)),
      productionArtifacts: state.productionArtifacts.filter((artifact) => (
        authorizeResource(subject, artifact.audience).allowed
      )),
      artifactRevisions: state.artifactRevisions.filter((revision) => (
        authorizeResource(subject, revision.audience).allowed
      )),
      productionSubmissions: state.productionSubmissions.filter((submission) => {
        const artifact = state.productionArtifacts.find(
          (item) => item.artifactId === submission.artifactId,
        );
        return Boolean(artifact && authorizeResource(subject, artifact.audience).allowed);
      }),
      facts: state.facts.filter((fact) => canSeeEntity(
        [fact.visibility],
        fact.audience,
        state.events.findLast((event) => (
          (event.eventType === "world_fact_confirmed" || event.eventType === "world_fact_updated")
          && (event.payload.fact as { factId?: string } | undefined)?.factId === fact.factId
        )),
      )),
      recentEvents: visibleEvents.slice(-30),
      roleMessages: state.messages.filter((message) => {
        const latestMessageEvent = state.events.findLast((event) => (
          (event.eventType === "agent_message_posted" || event.eventType === "role_message_posted")
          && (event.payload.message as { messageId?: string } | undefined)?.messageId === message.messageId
        ));
        return canSeeEntity(message.visibility, message.audience, latestMessageEvent);
      }).slice(-20),
      roleInteractions: state.roleInteractions.filter((interaction) => {
        const responseEvent = interaction.response
          ? state.events.findLast((event) => (
            event.eventType === "role_interaction_responded"
            && (event.payload.response as { interactionId?: string } | undefined)?.interactionId
              === interaction.request.interactionId
          ))
          : undefined;
        const requestEvent = state.events.findLast((event) => (
          event.eventType === "role_interaction_requested"
          && (event.payload.interaction as { interactionId?: string } | undefined)?.interactionId
            === interaction.request.interactionId
        ));
        const carrier = responseEvent ?? requestEvent;
        return carrier ? canSeeEntity(carrier.visibility, carrier.audience, carrier) : false;
      }),
      availableRoleInteractions: availableRoleInteractions(state, role),
      agentAssistance: state.agentAssistance.filter((proposal) => {
        const carrier = state.events.findLast((event) => (
          event.eventType === "agent_assistance_recorded"
          && (
            event.payload.proposal as {
              proposalId?: string;
            } | undefined
          )?.proposalId === proposal.proposalId
        ));
        return Boolean(
          carrier
          && canSeeEntity(
            proposal.visibility,
            carrier.audience,
            carrier,
          ),
        );
      }),
      evidence: visibleEvidence,
      pendingCandidates: role.actorKind === "teacher" || role.roleId === "scene_director"
        ? currentPendingCandidates(state)
        : [],
      candidateHistory: role.actorKind === "teacher"
        ? state.candidates
        : role.roleId === "scene_director"
          ? state.candidates.map((candidate) => ({
              ...candidate,
              reviewedBy: null,
              reviewReason: null,
            }))
          : [],
      teachingDirectives: role.actorKind === "teacher" || role.roleId === "scene_director"
        ? state.teachingDirectives
        : [],
      sceneDirectorDecisions: role.actorKind === "teacher" || role.roleId === "scene_director"
        ? state.sceneDirectorDecisions
        : [],
      activeInterventions: role.actorKind === "teacher"
        ? state.activeInterventions
        : state.activeInterventions.filter((intervention) => (
          intervention.affectedRoleIds.includes(role.roleId)
        )),
      assessments: role.actorKind === "teacher"
        ? state.assessments
        : state.evaluationCases.length === 0 && role.roleId === "responsible_editor"
          ? state.assessments.map((assessment) => AssessmentSchema.parse({
              ...assessment,
              reviewedBy: null,
              reviewNote: null,
            }))
          : [],
      evaluationEvidenceBundles: role.actorKind === "teacher"
        ? state.evaluationEvidenceBundles
        : [],
      evaluationCases: role.actorKind === "teacher"
        || role.roleId === "learning_curator"
        ? state.evaluationCases
        : [],
      evaluationProposals: role.actorKind === "teacher"
        ? state.evaluationProposals
        : [],
      evaluationArbitrations: role.actorKind === "teacher"
        ? state.evaluationArbitrations
        : [],
      teacherAssessmentReviews: role.actorKind === "teacher"
        ? state.teacherAssessmentReviews
        : [],
      retryableEvaluationBranches: role.actorKind === "teacher"
        ? retryableEvaluationBranches(state)
        : [],
      assessmentFeedback: studentAssessmentFeedback(
        state,
        role,
        visibleEvidenceIds,
      ),
      learningCandidates: role.actorKind === "teacher" ? state.learningCandidates : [],
      learningReplayReports: role.actorKind === "teacher"
        ? state.learningReplayReports
        : [],
      learningCandidateReviews: role.actorKind === "teacher"
        ? state.learningCandidateReviews
        : [],
      learningReleases: role.actorKind === "teacher"
        ? state.learningReleases
        : [],
      learningReleaseRollbacks: role.actorKind === "teacher"
        ? state.learningReleaseRollbacks
        : [],
      activeLearningReleaseId: role.actorKind === "teacher"
        ? state.activeLearningReleaseId
        : null,
      retryableLearningGenerationFailures: role.actorKind === "teacher"
        ? retryableLearningGenerationFailures(state)
        : [],
      availableActions: availableActions(state, role),
      riskLevel,
    };
    const fixedVisibleEvidenceIds =
      state.evaluationEvidenceBundles.at(-1)?.evidenceRefs
        .map((reference) => reference.evidenceId)
        .filter((evidenceId) => visibleEvidenceIds.has(evidenceId)) ?? [];
    const structuredWorld = buildStructuredWorldStage({
      scenario,
      role,
      experienceGuide,
      scenarioStatus: projection.scenario.status,
      virtualTime: projection.scenario.virtualTime,
      remainingMinutes: projection.scenario.remainingMinutes,
      riskLevel,
      availableRoleInteractions: projection.availableRoleInteractions,
      roleInteractions: projection.roleInteractions,
      events: visibleEvents,
      evidence: visibleEvidence,
      materials: visibleMaterials,
      activeInterventions: projection.activeInterventions,
      fixedVisibleEvidenceIds,
      teacherFinalized: state.teacherAssessmentReviews.length > 0,
      currentExperienceTaskId:
        authoredExperienceSequence?.currentActionTaskId ?? null,
    });
    const currentTaskAnchor = deriveCurrentTaskAnchor({
      structuredWorld,
      stateVersion: projection.stateVersion,
      events: visibleEvents,
    });
    return StateProjectionSchema.parse({
      ...projection,
      structuredWorld,
      currentTaskAnchor,
    });
  }

  async getAgentTaskProjection(rawTask: AgentTask): Promise<StateProjection> {
    const task = AgentTaskSchema.parse(rawTask);
    const events = await this.store.load(task.sessionId);
    if (events.length === 0) throw new SessionNotFoundError(task.sessionId);
    const release = this.releaseForEvents(events);
    const state = reduceWorldState(task.sessionId, release.package, events);
    const role = this.requireAgentTaskRole(task, release.package);
    if (state.sessionEpoch !== task.sessionEpoch) {
      throw new PermissionDeniedError(
        "智能体任务会话世代与权威世界不一致",
      );
    }
    if (
      !task.roleSnapshot
      && (
        task.instanceRef.instanceId
          !== `${task.sessionId}:${task.sessionEpoch}:${task.agentId}`
        || task.instanceRef.instanceVersion !== task.definitionVersion
      )
    ) {
      throw new PermissionDeniedError(
        "智能体任务身份或实例版本与固定角色契约不一致",
      );
    }
    if (
      !task.roleSnapshot
      && task.instanceContext.bindingKind !== "legacy_derived"
    ) {
      const expectedBindingId = [
        "role-binding",
        release.package.courseId,
        role.roleId,
        role.agentId,
      ].join(":");
      const expectedNamespace = roleMemoryNamespace({
        sessionId: task.sessionId,
        sessionEpoch: task.sessionEpoch,
        teamId: role.teamId,
        actorId: role.agentId,
      });
      const expectedConfigHash = roleBindingConfigHash({
        scenarioId: release.package.scenarioId,
        scenarioVersion: release.package.version,
        role,
      });
      if (
        task.instanceContext.lifecycle !== "active"
        || task.instanceContext.bindingKind !== agentInstanceBindingKind(role)
        || task.instanceContext.bindingId !== expectedBindingId
        || task.instanceContext.actorId !== role.agentId
        || task.instanceContext.actorKind !== role.actorKind
        || task.instanceContext.courseId !== release.package.courseId
        || task.instanceContext.teamId !== role.teamId
        || task.instanceContext.privateMemoryNamespaceRef !== expectedNamespace
        || task.instanceContext.configHash !== expectedConfigHash
      ) {
        throw new PermissionDeniedError(
          "智能体实例绑定、私有记忆命名空间或配置哈希不一致",
        );
      }
    }
    const triggerEvent = events.find(
      (event) => event.eventId === task.triggerEventId,
    );
    const visibilityRole = task.roleSnapshot
      ? this.requireRole(
          task.instanceContext.subjectActorId ?? "",
          release.package,
        )
      : role;
    if (
      !triggerEvent
      || triggerEvent.eventType !== task.triggerEventType
      || !canSeeEvent(
        visibilityRole,
        triggerEvent,
        release.package,
        state.sessionEpoch,
      )
    ) {
      throw new PermissionDeniedError(
        "智能体任务无法读取其声明的触发事件",
      );
    }
    const projection = await this.getProjection(
      task.sessionId,
      visibilityRole.agentId,
    );

    if (task.roleSnapshot) {
      const base = {
        ...projection,
        actorId: role.agentId,
        actorKind: role.actorKind,
        role,
        availableActions: [],
        recentEvents: projection.recentEvents.filter(
          (event) => event.eventId === triggerEvent.eventId,
        ),
      };
      if (role.roleId === "student_assistant") {
        const evidence = EvidenceSchema.safeParse(
          triggerEvent.payload.evidence,
        );
        if (
          !evidence.success
          || evidence.data.actorId !== visibilityRole.agentId
        ) {
          throw new PermissionDeniedError(
            "学生辅助任务没有固定到目标学生本人的证据",
          );
        }
        return StateProjectionSchema.parse({
          ...base,
          evidence: projection.evidence.filter(
            (item) => item.evidenceId === evidence.data.evidenceId,
          ),
        });
      }
      if (role.roleId === "content_assistant") {
        const mediaTaskId = String(triggerEvent.payload.taskId ?? "");
        const mediaTask = projection.mediaProcessingTasks.find(
          (item) => item.taskId === mediaTaskId,
        );
        if (
          !mediaTask
          || mediaTask.requestedBy !== visibilityRole.agentId
          || task.instanceContext.resourceRef?.objectType
            !== "media_processing_task"
          || task.instanceContext.resourceRef.objectId !== mediaTask.taskId
          || task.instanceContext.resourceRef.version
            !== mediaTask.inputContentHash
        ) {
          throw new PermissionDeniedError(
            "材料辅助任务没有固定到目标学生的精确处理档案",
          );
        }
        return StateProjectionSchema.parse({
          ...base,
          materials: projection.materials.filter((item) => (
            item.materialId === mediaTask.materialId
            && item.version === mediaTask.materialVersion
          )),
          mediaProcessingTasks: [mediaTask],
        });
      }
      if (role.roleId === "teacher_assistant") {
        const arbitration = EvaluationArbitrationSchema.safeParse(
          triggerEvent.payload.arbitration,
        );
        if (
          !arbitration.success
          || visibilityRole.actorKind !== "teacher"
          || task.instanceContext.resourceRef?.objectType
            !== "evaluation_arbitration"
          || task.instanceContext.resourceRef.objectId
            !== arbitration.data.arbitrationId
          || task.instanceContext.resourceRef.version
            !== arbitration.data.decisionHash
        ) {
          throw new PermissionDeniedError(
            "教师辅助任务没有固定到可管理的精确评价仲裁",
          );
        }
        const proposalIds = new Set(arbitration.data.proposalIds);
        return StateProjectionSchema.parse({
          ...base,
          evaluationCases: projection.evaluationCases.filter((item) => (
            item.evaluationCaseId === arbitration.data.evaluationCaseId
          )),
          evaluationProposals: projection.evaluationProposals.filter(
            (item) => proposalIds.has(item.proposalId),
          ),
          evaluationArbitrations: [arbitration.data],
        });
      }
      throw new PermissionDeniedError("未知按需辅助角色");
    }

    if (role.roleId === "assessor") {
      const evaluationCase = EvaluationCaseSchema.safeParse(
        triggerEvent.payload.evaluationCase,
      );
      const evidenceBundle = EvaluationEvidenceBundleSchema.safeParse(
        triggerEvent.payload.evidenceBundle,
      );
      if (!evaluationCase.success || !evidenceBundle.success) {
        throw new InvalidWorldActionError(
          "评价任务触发事件缺少固定案件或证据包",
        );
      }
      if (
        evaluationCase.data.evidenceBundleId !== evidenceBundle.data.bundleId
        || evaluationCase.data.evidenceBundleHash
          !== evidenceBundle.data.bundleHash
        || evaluationCase.data.sessionEpoch !== task.sessionEpoch
        || evidenceBundle.data.sessionEpoch !== task.sessionEpoch
      ) {
        throw new PermissionDeniedError(
          "评价任务固定案件与证据包身份不一致",
        );
      }
      const allowedEvidenceIds = new Set(
        evidenceBundle.data.evidenceRefs.map((reference) => (
          reference.evidenceId
        )),
      );
      const evidence = projection.evidence.filter((item) => (
        allowedEvidenceIds.has(item.evidenceId)
      ));
      if (evidence.length !== allowedEvidenceIds.size) {
        throw new PermissionDeniedError(
          "评价任务投影没有完整命中固定证据包",
        );
      }
      return StateProjectionSchema.parse({
        ...projection,
        evidence,
        evaluationCases: [evaluationCase.data],
      });
    }

    if (role.roleId === "learning_curator") {
      const review = TeacherAssessmentReviewSchema.safeParse(
        triggerEvent.payload.review,
      );
      const learningInput = triggerEvent.payload.learningInput;
      if (
        !review.success
        || !learningInput
        || typeof learningInput !== "object"
        || Array.isArray(learningInput)
      ) {
        throw new InvalidWorldActionError(
          "学习策展任务缺少精确教师终评或脱敏学习输入",
        );
      }
      const dimensions = (
        learningInput as {
          dimensions?: Array<{ evidenceRefs?: string[] }>;
        }
      ).dimensions ?? [];
      const allowedEvidenceIds = new Set(
        dimensions.flatMap((dimension) => dimension.evidenceRefs ?? []),
      );
      return StateProjectionSchema.parse({
        ...projection,
        evidence: projection.evidence.filter((item) => (
          allowedEvidenceIds.has(item.evidenceId)
        )),
        evaluationCases: projection.evaluationCases.filter((item) => (
          item.evaluationCaseId === review.data.evaluationCaseId
        )),
      });
    }

    return projection;
  }

  async getTimeline(sessionId: string, actorId: string): Promise<WorldEvent[]> {
    const events = await this.store.load(sessionId);
    if (events.length === 0) throw new SessionNotFoundError(sessionId);
    const release = this.releaseForEvents(events);
    const state = reduceWorldState(sessionId, release.package, events);
    const role = this.requireRole(actorId, release.package);
    return events
      .filter((event) => (
        canSeeEvent(role, event, release.package, state.sessionEpoch)
      ))
      .map((event) => projectEventForRole(event, role));
  }

  async getStateSnapshot(sessionId: string): Promise<WorldState> {
    const events = await this.store.load(sessionId);
    if (events.length === 0) throw new SessionNotFoundError(sessionId);
    const release = this.releaseForEvents(events);
    return structuredClone(reduceWorldState(sessionId, release.package, events));
  }

  async getScenarioRelease(sessionId: string): Promise<PublishedScenarioPackage> {
    const events = await this.store.load(sessionId);
    if (events.length === 0) throw new SessionNotFoundError(sessionId);
    return structuredClone(this.releaseForEvents(events));
  }

  async getScenarioPackage(sessionId: string): Promise<ScenarioPackage> {
    return (await this.getScenarioRelease(sessionId)).package;
  }

  async hasAgentTaskResult(sessionId: string, idempotencyKey: string): Promise<boolean> {
    return (await this.getAgentTaskResultStatus(sessionId, idempotencyKey)) !== null;
  }

  async getAgentTaskResultStatus(
    sessionId: string,
    idempotencyKey: string,
  ): Promise<"completed" | "degraded" | "failed" | null> {
    const events = await this.store.load(sessionId);
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (!event || (event.eventType !== "agent_run_recorded" && event.eventType !== "agent_task_failed")) {
        continue;
      }
      const task = AgentTaskSchema.safeParse(event.payload.task);
      if (!task.success || task.data.idempotencyKey !== idempotencyKey) continue;
      if (task.data.status === "degraded" || task.data.status === "failed") return task.data.status;
      return "completed";
    }
    return null;
  }

  private resolveRelease(ref: ScenarioPackageRef): PublishedScenarioPackage {
    if (ref.releaseId === this.#defaultRelease.ref.releaseId) {
      if (ref.contentHash !== this.#defaultRelease.ref.contentHash) {
        throw new ScenarioVersionMismatchError(
          this.#defaultRelease.ref.contentHash,
          ref.contentHash,
        );
      }
      return structuredClone(this.#defaultRelease);
    }
    const registered = this.#registeredReleases.get(ref.releaseId);
    if (registered) {
      if (registered.ref.contentHash !== ref.contentHash) {
        throw new Error(`情境发布引用哈希不匹配：${ref.releaseId}`);
      }
      return structuredClone(registered);
    }
    return this.#scenarioResolver.resolve(ref);
  }

  private releaseForEvents(events: readonly WorldEvent[]): PublishedScenarioPackage {
    const sessionId = events[0]?.sessionId;
    if (!sessionId) throw new Error("无法从空事件序列解析情境发布版");
    const cached = this.#sessionReleases.get(sessionId);
    if (cached) {
      reduceWorldState(sessionId, cached.package, [...events]);
      return cached;
    }
    const ref = scenarioRefFromSessionStarted(events, this.#scenarioResolver);
    const release = this.resolveRelease(ref);
    this.#sessionReleases.set(sessionId, release);
    return release;
  }

  private releaseForState(state: WorldState): PublishedScenarioPackage {
    const release = this.#sessionReleases.get(state.sessionId);
    if (!release) {
      throw new Error(`会话尚未固定情境发布版：${state.sessionId}`);
    }
    if (
      release.package.scenarioId !== state.scenario.scenarioId
      || release.package.version !== state.scenario.version
    ) {
      throw new ScenarioVersionMismatchError(
        `${state.scenario.scenarioId}@${state.scenario.version}`,
        `${release.package.scenarioId}@${release.package.version}`,
      );
    }
    return release;
  }

  private requireRole(actorId: string, scenario: ScenarioPackage): RoleContract {
    const role = scenario.roles.find((candidate) => candidate.agentId === actorId);
    if (!role) throw new PermissionDeniedError(`未知行动者：${actorId}`);
    return role;
  }

  private requireAgentTaskRole(
    task: AgentTask,
    scenario: ScenarioPackage,
  ): RoleContract {
    if (!task.roleSnapshot) {
      const role = this.requireRole(task.agentId, scenario);
      if (role.roleId !== task.roleId) {
        throw new PermissionDeniedError("智能体任务与固定角色契约不一致");
      }
      return role;
    }
    const role = task.roleSnapshot;
    if (
      role.actorKind !== "agent"
      || role.agentId !== task.agentId
      || role.roleId !== task.roleId
      || (
        role.roleId !== "student_assistant"
        && role.roleId !== "content_assistant"
        && role.roleId !== "teacher_assistant"
      )
      || task.instanceContext.lifecycle !== "active"
      || task.instanceContext.bindingKind === "legacy_derived"
      || task.instanceContext.bindingKind === "npc"
      || task.instanceRef.instanceVersion !== task.definitionVersion
    ) {
      throw new PermissionDeniedError(
        "按需辅助实例的角色、生命周期或版本无效",
      );
    }
    const subjectActorId = task.instanceContext.subjectActorId;
    if (!subjectActorId) {
      throw new PermissionDeniedError("按需辅助实例没有固定授权主体");
    }
    const subjectRole = this.requireRole(subjectActorId, scenario);
    if (
      task.instanceContext.subjectRoleId !== subjectRole.roleId
      || task.instanceContext.teamId !== subjectRole.teamId
      || role.teamId !== subjectRole.teamId
    ) {
      throw new PermissionDeniedError(
        "按需辅助实例的主体岗位或团队快照不一致",
      );
    }
    const expected = createScopedAgentInstanceBinding({
      templateRef: task.templateRef,
      definitionVersion: task.definitionVersion,
      roleSnapshot: role,
      scenarioId: scenario.scenarioId,
      scenarioVersion: scenario.version,
      courseId: scenario.courseId,
      sessionId: task.sessionId,
      sessionEpoch: task.sessionEpoch,
      bindingKind: task.instanceContext.bindingKind,
      subjectRole,
      resourceRef: task.instanceContext.resourceRef,
      lifecycle: task.instanceContext.lifecycle,
    });
    if (
      hashValue(expected.instanceRef) !== hashValue(task.instanceRef)
      || hashValue(expected.instanceContext)
        !== hashValue(task.instanceContext)
      || hashValue(expected.roleSnapshot) !== hashValue(role)
    ) {
      throw new PermissionDeniedError(
        "按需辅助实例的绑定、资源、命名空间或配置哈希不一致",
      );
    }
    return role;
  }

  private async decide(state: WorldState, role: RoleContract, command: Command): Promise<EventDraft[]> {
    switch (command.name) {
      case "inspect_material":
        return this.inspectMaterial(state, role, command);
      case "request_second_verification":
        return this.requestVerification(state, command);
      case "request_media_processing":
        return this.requestMediaProcessing(state, role, command);
      case "request_governance_review":
        return this.requestGovernanceReview(state, role, command);
      case "retry_media_processing":
        return this.retryMediaProcessing(state, role, command);
      case "supply_media_processing_result":
        return this.supplyMediaProcessingResult(state, role, command);
      case "create_production_artifact":
        return this.createProductionArtifact(state, role, command);
      case "save_artifact_revision":
        return this.saveArtifactRevision(state, role, command);
      case "mark_copyright_risk":
        return this.markCopyrightRisk(state, command);
      case "pause_publication":
        return this.pausePublication(state, command);
      case "submit_for_review":
        return this.submitForReview(state, role, command);
      case "record_experience_choice":
        return this.recordExperienceChoice(state, role, command);
      case "record_agent_contribution_decision":
        return this.recordAgentContributionDecision(state, role, command);
      case "send_role_interaction":
        return this.sendRoleInteraction(state, role, command);
      case "approve_candidate_event":
        return this.approveCandidate(state, command);
      case "reject_candidate_event":
        return this.rejectCandidate(state, command);
      case "review_governance":
        return this.reviewGovernance(state, role, command);
      case "review_assessment":
        return this.reviewAssessment(state, command);
      case "retry_evaluation_branch":
        return this.retryEvaluationBranch(state, role, command);
      case "create_learning_candidate":
        throw new InvalidWorldActionError("自学习内容只能在教师完成证据复核后由内核生成待审核候选");
      case "retry_learning_candidate_generation":
        return this.retryLearningCandidateGeneration(state, role, command);
      case "review_learning_candidate":
        return this.reviewLearningCandidate(state, command);
      case "publish_learning_release":
        return this.publishLearningRelease(state, command);
      case "rollback_learning_release":
        return this.rollbackLearningRelease(state, command);
    }
  }

  private async inspectMaterial(state: WorldState, role: RoleContract, command: Command): Promise<EventDraft[]> {
    const material = this.requireInspectableMaterial(state, role, command);
    const materialId = material.materialId;
    const now = this.#clock.now();
    const suppliedObservation = command.payload.observation;
    const observation: Observation = suppliedObservation
      ? ObservationSchema.parse(suppliedObservation)
      : ObservationSchema.parse({
          ...createMessageMeta({ sessionId: state.sessionId, sceneId: state.scenario.scenarioId, actorId: command.actorId, correlationId: command.correlationId, timestamp: now }),
          kind: "Observation",
          observationId: this.#ids.next("observation"),
          materialId,
          mediaType: material.mediaType,
          provider: "iflytek-unified-adapter",
          providerMode: "mock",
          summary: "现场图显示水乡非遗市集人群密集，但图像本身不能证明18,000人次客流；EXIF与授权范围需另行核验。",
          extracted: { scene: "江南水乡非遗市集", crowdDensity: "high", readableBranding: false, copyrightSignal: "unknown" },
          sourceRef: material.sourceRef,
          confidence: 0.88,
        });
    const evidence = this.evidence(state, command, {
      nodeId: "source",
      action: "检查多模态素材",
      basis: "图片观察与客流快报属于不同证据类型，不能相互替代",
      materialRefs: [materialId, "material-visitor-sheet"],
      observationRefs: [observation.observationId],
    });
    return [
      {
        eventType: "material_observed",
        actorId: command.actorId,
        summary: `已通过统一多模态适配层检查：${material.title}`,
        visibility: assignedVisibility,
        payload: { observation, materialId, virtualMinute: 4 },
      },
      { eventType: "evidence_recorded", actorId: "system", summary: "素材检查形成过程证据", visibility: assignedVisibility, payload: { evidence } },
      { eventType: "node_activated", actorId: "system", summary: "进入汇聚现场线索节点", visibility: assignedVisibility, payload: { nodeId: "source", virtualMinute: 4 } },
    ];
  }

  private requireInspectableMaterial(
    state: WorldState,
    role: RoleContract,
    command: Command,
  ): Material {
    if (hasEvent(state, "material_observed")) throw new InvalidWorldActionError("材料已经完成首轮观察");
    const unmetGateOptions = unmetInteractionGateOptions(state, "inspect_material");
    if (unmetGateOptions.some((optionId) => optionId.startsWith("reporter-"))) {
      throw new InvalidWorldActionError("记者岗尚未完成两轮采访与交接");
    }
    if (unmetGateOptions.some((optionId) => optionId.startsWith("editor-chief-"))) {
      throw new InvalidWorldActionError("责任编辑尚未完成总编两轮发布门禁沟通");
    }
    if (unmetGateOptions.length > 0) {
      throw new InvalidWorldActionError(`尚未完成前置岗位互动：${unmetGateOptions.join("、")}`);
    }
    const materialId = String(command.payload.materialId ?? "material-festival-photo");
    const material = state.materials.find((item) => item.materialId === materialId);
    if (!material || (role.actorKind !== "teacher" && !material.visibleToRoles.includes(role.roleId))) {
      throw new PermissionDeniedError("该岗位无权查看此素材");
    }
    return material;
  }

  private recordExperienceChoice(
    state: WorldState,
    role: RoleContract,
    command: Command,
  ): EventDraft[] {
    const payload = ExperienceChoiceCommandPayloadSchema.parse(
      command.payload,
    );
    const design = state.scenario.experienceDesign;
    const mapping = design?.nodeMappings.find(
      (candidate) => candidate.nodeId === state.currentNodeId,
    );
    const task = mapping?.operationTasks.find(
      (candidate) => candidate.taskId === payload.choiceRef,
    );
    if (
      !design
      || !mapping
      || !task
      || (
        role.actorKind !== "teacher"
        && !task.roleIds.includes(role.roleId)
      )
    ) {
      throw new PermissionDeniedError(
        "当前岗位无权记录该节点的情境任务选择",
      );
    }
    if (
      payload.choiceRef.includes(":agent-decision:")
      && state.events.some((event) => (
        event.eventType === "experience_choice_recorded"
        && event.payload.nodeId === mapping.nodeId
        && typeof event.payload.choiceRef === "string"
        && event.payload.choiceRef.includes(":agent-decision:")
      ))
    ) {
      throw new InvalidWorldActionError(
        "本节点的智能体建议处理决定已经写入权威事件流，不可改写",
      );
    }
    if (state.events.some((event) => (
      event.eventType === "experience_choice_recorded"
      && event.payload.choiceRef === payload.choiceRef
    ))) {
      throw new InvalidWorldActionError(
        "该共享情境任务选择已经写入权威事件流",
      );
    }
    const authoredExperienceSequence = deriveAuthoredExperienceSequence({
      scenario: state.scenario,
      nodeId: mapping.nodeId,
      events: state.events,
    });
    if (
      authoredExperienceSequence
      && !authoredExperienceSequence.visibleTaskIds.includes(payload.choiceRef)
    ) {
      throw new InvalidWorldActionError(
        authoredExperienceSequence.phase === "advice_decision"
          ? "请先完成本节智能体建议的采纳、补证或拒绝决定，再提交完成动作"
          : "请按课程编排顺序完成当前步骤，不可跳过前置动作或教师门",
      );
    }
    const dynamicEvent = mapping.dynamicEvents.find((candidate) => (
      candidate.triggerKind === "student_action"
      && candidate.triggerRef === payload.choiceRef
    )) ?? null;
    const evidence = this.evidence(state, command, {
      nodeId: mapping.nodeId,
      action: `完成情境任务选择：${task.label}`,
      basis: `${task.description}；预期产出：${task.expectedOutput}`,
    });
    const nextVirtualMinute = Math.min(
      state.scenario.durationMinutes,
      state.virtualMinute + 1,
    );
    const drafts: EventDraft[] = [
      {
        eventType: "experience_choice_recorded",
        actorId: command.actorId,
        summary: `${role.displayName}已确认情境任务：${task.label}`,
        visibility: assignedVisibility,
        payload: {
          choiceRef: payload.choiceRef,
          taskId: task.taskId,
          nodeId: mapping.nodeId,
          expectedOutput: task.expectedOutput,
          dynamicEventId: dynamicEvent?.dynamicEventId ?? null,
          approvalPolicyId: dynamicEvent?.approvalPolicyId ?? null,
          virtualMinute: nextVirtualMinute,
        },
      },
      {
        eventType: "evidence_recorded",
        actorId: "system",
        summary: "情境任务选择已形成能力过程证据",
        visibility: assignedVisibility,
        payload: { evidence },
      },
    ];
    if (!dynamicEvent) return drafts;

    const nextNode = state.nodes
      .filter((node) => (
        node.order > (
          state.nodes.find(
            (candidate) => candidate.nodeId === state.currentNodeId,
          )?.order ?? -1
        )
      ))
      .toSorted((left, right) => left.order - right.order)[0] ?? null;
    const consequencePayload = {
      dynamicEventId: dynamicEvent.dynamicEventId,
      declaredEventType: dynamicEvent.eventType,
      triggerRef: dynamicEvent.triggerRef,
      worldChanges: dynamicEvent.worldChanges,
      affectedTaskIds: dynamicEvent.affectedTaskIds,
      nextNodeId: dynamicEvent.eventType === "node_activated"
        ? nextNode?.nodeId ?? state.currentNodeId
        : null,
      nodeId: dynamicEvent.eventType === "node_activated"
        ? nextNode?.nodeId ?? state.currentNodeId
        : null,
      virtualMinute: Math.min(
        state.scenario.durationMinutes,
        nextVirtualMinute + 1,
      ),
    };
    if (dynamicEvent.approvalPolicyId) {
      const policy = state.scenario.approvalPolicies.find(
        (candidate) => (
          candidate.approvalPolicyId === dynamicEvent.approvalPolicyId
          && candidate.reviewMode === "teacher_required"
        ),
      );
      if (!policy) {
        throw new InvalidWorldActionError(
          "情境任务声明了教师门，但发布包缺少对应审批策略",
        );
      }
      const capabilityEvidence = mapping.capabilityEvidence.find(
        (requirement) => requirement.sourceRefs.includes(task.taskId),
      ) ?? mapping.capabilityEvidence[0];
      const candidateEvidenceRefs = [...new Set([
        ...state.evidence
          .filter((item) => item.nodeId === mapping.nodeId)
          .map((item) => item.evidenceId),
        evidence.evidenceId,
      ])];
      const appliedBusinessEventRefs = mapping.dynamicEvents
        .filter((event) => (
          event.dynamicEventId !== dynamicEvent.dynamicEventId
          && event.eventType === "experience_consequence_applied"
          && state.events.some((record) => (
            record.eventType === "experience_consequence_applied"
            && record.payload.dynamicEventId === event.dynamicEventId
          ))
        ))
        .map((event) => event.dynamicEventId);
      const candidate = this.candidate({
        eventType: dynamicEvent.eventType,
        title: `${task.label}的世界后果`,
        triggerReason: task.description,
        competencyTarget:
          capabilityEvidence?.competencyId ?? "职业情境判断",
        expectedImpact: dynamicEvent.worldChanges.join("；"),
        payload: consequencePayload,
        proposedBy: command.actorId,
        approvalPolicyId: policy.approvalPolicyId,
        evidenceRefs: candidateEvidenceRefs,
        sourceRefs: [task.taskId, ...appliedBusinessEventRefs],
        affectedRoleIds: task.roleIds,
        riskLevel: "medium",
        now: this.#clock.now(),
      });
      drafts.push({
        eventType: "candidate_event_proposed",
        actorId: "system",
        summary: `高风险情境后果等待教师决定：${candidate.title}`,
        visibility: teacherVisibility,
        payload: {
          candidate,
          sourceChoiceRef: task.taskId,
          sourceEvidenceId: evidence.evidenceId,
        },
      });
      return drafts;
    }

    if (dynamicEvent.eventType === "node_activated" && nextNode) {
      drafts.push({
        eventType: "node_activated",
        actorId: "system",
        summary: dynamicEvent.worldChanges[0]!,
        visibility: assignedVisibility,
        payload: consequencePayload,
      });
    } else {
      drafts.push({
        eventType: "experience_consequence_applied",
        actorId: "system",
        summary: dynamicEvent.worldChanges[0]!,
        visibility: assignedVisibility,
        payload: consequencePayload,
      });
    }
    return drafts;
  }

  private recordAgentContributionDecision(
    state: WorldState,
    role: RoleContract,
    command: Command,
  ): EventDraft[] {
    if (role.actorKind !== "student") {
      throw new PermissionDeniedError(
        "只有建议所绑定的学生可以记录采纳或拒绝",
      );
    }
    const payload = AgentContributionDecisionEventPayloadSchema.parse(
      command.payload,
    );
    const proposal = state.agentAssistance.find(
      (candidate) => candidate.proposalId === payload.proposalId,
    );
    if (
      !proposal
      || proposal.subjectActorId !== role.agentId
      || !proposal.visibleToActorIds.includes(role.agentId)
      || proposal.authority !== "advisory_only"
      || !proposal.requiresHumanAction
    ) {
      throw new PermissionDeniedError(
        "当前学生无权处理该辅助建议，或建议已不满足人工选择边界",
      );
    }
    const profile = AgentContributionProfilesByTemplateId.get(
      proposal.templateRef.templateId,
    );
    if (
      !profile
      || !profile.studentDecision
      || proposal.templateRef.templateVersion !== profile.templateVersion
      || proposal.instanceRef.instanceVersion !== profile.instanceVersion
      || hashValue(payload.decision.templateRef)
        !== hashValue(proposal.templateRef)
      || hashValue(payload.decision.instanceRef)
        !== hashValue(proposal.instanceRef)
      || payload.decision.rolePerspective !== profile.rolePerspective
      || payload.decision.permissionSummary !== profile.permissionSummary
    ) {
      throw new PermissionDeniedError(
        "贡献决策与冻结模板、实例或权限边界不一致",
      );
    }
    const expectedBasisRefs = [
      ...proposal.evidenceRefs.map((refId) => ({
        kind: "evidence" as const,
        refId,
      })),
      ...proposal.citationRefs.map((refId) => ({
        kind: "citation" as const,
        refId,
      })),
      ...proposal.causationEventIds.map((refId) => ({
        kind: "event" as const,
        refId,
      })),
    ];
    const uniqueExpectedBasisRefs = [...new Map(
      expectedBasisRefs.map((reference) => [
        `${reference.kind}:${reference.refId}`,
        reference,
      ]),
    ).values()];
    const expectedIdempotencyKey = `agent-contribution:${hashValue({
      proposalId: proposal.proposalId,
      studentActorId: role.agentId,
    })}`;
    if (
      hashValue(payload.decision.basisRefs)
        !== hashValue(uniqueExpectedBasisRefs)
      || payload.decision.idempotencyKey !== expectedIdempotencyKey
    ) {
      throw new InvalidWorldActionError(
        "贡献决策的依据引用或幂等键与权威建议不一致",
      );
    }
    const existing = state.events
      .filter((event) => event.eventType === "agent_contribution_decided")
      .map((event) => (
        AgentContributionDecisionEventPayloadSchema.safeParse(event.payload)
      ))
      .find((candidate) => (
        candidate.success
        && candidate.data.decision.idempotencyKey === expectedIdempotencyKey
      ));
    if (existing?.success) {
      if (hashValue(existing.data) !== hashValue(payload)) {
        throw new InvalidWorldActionError(
          "同一贡献决策幂等键不能改写采纳/拒绝或学生原因",
        );
      }
      return [];
    }
    return [{
      eventType: "agent_contribution_decided",
      actorId: role.agentId,
      summary: payload.decision.decision === "accepted"
        ? "学生已采纳关键辅助建议并记录原因"
        : "学生已拒绝关键辅助建议并记录原因，主流程保持可继续",
      visibility: proposal.visibility,
      visibleToActorIds: proposal.visibleToActorIds,
      payload,
    }];
  }

  private sendRoleInteraction(
    state: WorldState,
    role: RoleContract,
    command: Command,
  ): EventDraft[] {
    const payload = RoleInteractionCommandPayloadSchema.parse(command.payload);
    const configured = state.scenario.roleInteractions.find((interaction) => (
      interaction.initiatorActorId === role.agentId
      && interaction.optionId === payload.optionId
    ));
    if (!configured) {
      throw new PermissionDeniedError("该岗位无权发起指定角色互动");
    }
    const disabledReason = roleInteractionDisabledReason(state, configured, role);
    if (disabledReason) throw new InvalidWorldActionError(disabledReason);
    const target = this.requireRole(configured.targetActorId, state.scenario);
    if (
      target.actorKind !== "agent"
      || target.roleId !== configured.targetRoleId
      || !target.communicationPolicy?.canRespond
    ) {
      throw new PermissionDeniedError("互动目标不是获准响应的岗位智能体");
    }
    const priorTurns = state.roleInteractions.filter((item) => (
      item.request.fromActorId === role.agentId
      && item.request.toActorId === target.agentId
    ));
    const previous = priorTurns.at(-1) ?? null;
    const previousResponseEvent = previous
      ? state.events.findLast((event) => (
        event.eventType === "role_interaction_responded"
        && (event.payload.response as { interactionId?: string } | undefined)?.interactionId
          === previous.request.interactionId
      ))
      : undefined;
    const now = this.#clock.now();
    const interactionId = this.#ids.next("role-interaction");
    const threadId = [
      "role-thread",
      state.sessionEpoch,
      role.agentId,
      target.agentId,
    ].join(":");
    const request: RoleInteractionRequest = RoleInteractionRequestSchema.parse({
      schemaVersion: RoleInteractionSchemaVersion,
      interactionId,
      threadId,
      replyToInteractionId: previous?.request.interactionId ?? null,
      optionId: configured.optionId,
      fromActorId: role.agentId,
      fromRoleId: role.roleId,
      toActorId: target.agentId,
      toRoleId: target.roleId,
      kind: configured.kind,
      topic: configured.topic,
      content: configured.content,
      turn: priorTurns.length + 1,
      relatedEventIds: previousResponseEvent ? [previousResponseEvent.eventId] : [],
      createdAt: now,
    });
    const visibleToActorIds = [role.agentId, target.agentId];
    const previousResponseMessage = previous
      ? state.messages.findLast((message) => (
        message.interactionId === previous.request.interactionId
        && message.actorId === target.agentId
      ))
      : undefined;
    return [
      {
        eventType: "role_interaction_requested",
        actorId: role.agentId,
        summary: `${role.displayName}向${target.displayName}发起第${request.turn}轮岗位互动`,
        visibility: ["role_private", "audit_only"],
        visibleToActorIds,
        payload: { interaction: request },
      },
      this.messageDraft({
        eventType: "role_message_posted",
        actorId: role.agentId,
        roleId: role.roleId,
        displayName: role.displayName,
        content: request.content,
        visibility: ["role_private", "audit_only"],
        visibleToActorIds,
        channel: "role_interaction",
        threadId,
        replyToMessageId: previousResponseMessage?.messageId ?? null,
        interactionId,
        interactionKind: request.kind,
        topic: request.topic,
        turn: request.turn,
        recipientActorIds: [target.agentId],
        sourceRefs: request.relatedEventIds,
        now,
      }),
    ];
  }

  private completedAgentTaskKeys(events: WorldEvent[]): Set<string> {
    const completed = new Set<string>();
    for (const event of events) {
      if (event.eventType !== "agent_run_recorded" && event.eventType !== "agent_task_failed") continue;
      const task = event.payload.task as { idempotencyKey?: unknown } | undefined;
      if (typeof task?.idempotencyKey === "string") completed.add(task.idempotencyKey);
    }
    return completed;
  }

  async recordAgentTaskFailure(
    rawTask: AgentTask,
    errorCode: string,
    deadLetter: Record<string, unknown> | null = null,
  ): Promise<WorldEvent[]> {
    const task = AgentTaskSchema.parse(rawTask);
    const history = await this.store.load(task.sessionId);
    if (history.length === 0) throw new SessionNotFoundError(task.sessionId);
    if (this.completedAgentTaskKeys(history).has(task.idempotencyKey)) return [];
    const release = this.releaseForEvents(history);
    const state = reduceWorldState(task.sessionId, release.package, history);
    if (state.sessionEpoch !== task.sessionEpoch) {
      throw new InvalidWorldActionError("智能体任务属于已结束的会话世代");
    }
    const completedAt = this.#clock.now();
    const failedTask = AgentTaskSchema.parse({
      ...task,
      status: "failed",
      lease: null,
      lastErrorCode: errorCode,
      updatedAt: completedAt,
      completedAt,
    });
    const role = this.requireAgentTaskRole(task, state.scenario);
    const drafts: EventDraft[] = [{
      eventType: "agent_task_failed",
      actorId: "system",
      summary: `智能体任务重试耗尽并进入死信：${task.agentId}`,
      visibility: teacherVisibility,
      payload: {
        task: failedTask,
        errorCode,
        triggerEventId: task.triggerEventId,
        deadLetter,
      },
    }];
    const triggerEvent = history.find(
      (event) => event.eventId === task.triggerEventId,
    );
    if (
      role.roleId === "assessor"
      && triggerEvent
      && (
        triggerEvent.eventType === "evaluation_case_opened"
        || triggerEvent.eventType === "evaluation_branch_retry_requested"
      )
    ) {
      const evaluatorKind = evaluatorKindForRole(role);
      const evaluationCase = EvaluationCaseSchema.parse(
        triggerEvent.payload.evaluationCase,
      );
      const evidenceBundle = EvaluationEvidenceBundleSchema.parse(
        triggerEvent.payload.evidenceBundle,
      );
      const mayAppend = evaluatorKind
        ? canAppendEvaluationRetryResult({
            state,
            triggerEvent,
            evaluationCase,
            evaluatorKind,
          })
        : false;
      if (evaluatorKind && mayAppend) {
        const proposal = createUnavailableEvaluationProposal({
          nextId: this.#ids.next.bind(this.#ids),
          now: completedAt,
          evaluationCase,
          evidenceBundle,
          evaluatorKind,
          definitionVersion: task.definitionVersion,
          promptVersion: task.promptVersion,
          errorCode,
        });
        const previousRevision = Math.max(
          0,
          ...state.evaluationArbitrations
            .filter((item) => item.evaluationCaseId === evaluationCase.evaluationCaseId)
            .map((item) => item.revision),
        );
        const arbitration = arbitrateEvaluationProposals({
          nextId: this.#ids.next.bind(this.#ids),
          now: completedAt,
          evaluationCase,
          proposals: [
            ...state.evaluationProposals.filter(
              (item) => item.evaluationCaseId === evaluationCase.evaluationCaseId,
            ),
            proposal,
          ],
          previousRevision,
        });
        drafts.push(
          {
            eventType: "evaluation_proposal_recorded",
            actorId: role.agentId,
            summary: `${role.displayName}重试耗尽；已固定无分数 unavailable 意见`,
            visibility: teacherVisibility,
            payload: { proposal, taskId: task.taskId },
          },
          {
            eventType: "evaluation_arbitrated",
            actorId: "system",
            summary: `评价仲裁已按失败关闭策略更新：${arbitration.status}`,
            visibility: teacherVisibility,
            payload: { arbitration },
          },
        );
      }
    }
    if (
      role.roleId === "learning_curator"
      && triggerEvent
      && (
        triggerEvent.eventType === "teacher_reviewed"
        || triggerEvent.eventType
          === "learning_candidate_generation_retry_requested"
      )
    ) {
      drafts.push({
        eventType: "learning_candidate_generation_failed",
        actorId: role.agentId,
        summary: "学习候选生成重试耗尽；未写入候选或正式学习版本",
        visibility: teacherVisibility,
        payload: {
          taskId: task.taskId,
          triggerEventId: task.triggerEventId,
          errorCode,
          ...learningFailureContext(triggerEvent),
        },
      });
    }
    return this.commit(
      task.sessionId,
      state.stateVersion,
      drafts,
      task.correlationId,
      state.sessionEpoch,
      task.causalDepth + 1,
      task.actionContext,
    );
  }

  private assertAgentIntentForWorld(
    intent: NonNullable<AgentRunResult["intent"]>,
    task: AgentTask,
    role: RoleContract,
    triggerEvent: WorldEvent,
  ): void {
    if (intent.actorId !== task.agentId || intent.roleId !== task.roleId) {
      throw new PermissionDeniedError("智能体意图身份与调度任务不一致");
    }
    if (!role.allowedIntents.includes(intent.intentType)) {
      throw new PermissionDeniedError(`角色契约未授权智能体意图：${intent.intentType}`);
    }
    if (intent.expectedStateVersion !== task.expectedStateVersion) {
      throw new InvalidWorldActionError("智能体意图基于陈旧世界状态，已拒绝转换候选");
    }
    if (!intent.causationEventIds.includes(triggerEvent.eventId)) {
      throw new InvalidWorldActionError("智能体意图没有引用实际触发事件");
    }
    if (intent.expiresAt && Date.parse(intent.expiresAt) <= Date.parse(this.#clock.now())) {
      throw new InvalidWorldActionError("智能体意图已经过期");
    }
    if (intent.intentType === "propose_data_correction") {
      if (!intent.requiresTeacherReview) {
        throw new InvalidWorldActionError("事实更正意图必须进入教师复核");
      }
      if (intent.citationRefs.length === 0) {
        throw new InvalidWorldActionError("事实更正意图缺少可追溯检索引用");
      }
      if (intent.visibility.includes("public_world")) {
        throw new InvalidWorldActionError("未审批事实更正意图不得公开广播");
      }
    }
    if (
      (intent.intentType === "propose_copyright_dispute"
        || intent.intentType === "propose_platform_escalation")
      && (
        triggerEvent.eventType !== "role_interaction_requested"
        || !intent.requiresTeacherReview
        || intent.visibility.includes("public_world")
      )
    ) {
      throw new InvalidWorldActionError("角色行动意图必须由岗位请求触发，并作为非公开待审候选");
    }
    if (role.roleId === "assessor") {
      if (
        intent.intentType !== "record_evaluation_proposal"
        || (
          triggerEvent.eventType !== "evaluation_case_opened"
          && triggerEvent.eventType !== "evaluation_branch_retry_requested"
        )
        || !intent.requiresTeacherReview
        || intent.visibility.includes("public_world")
        || !intent.visibility.includes("teacher_only")
      ) {
        throw new InvalidWorldActionError(
          "评价节点只能针对固定案件提交非公开、非终评的结构化意见",
        );
      }
    }
    if (role.roleId === "learning_curator") {
      if (
        intent.intentType !== "propose_learning_candidate"
        || (
          triggerEvent.eventType !== "teacher_reviewed"
          && triggerEvent.eventType
            !== "learning_candidate_generation_retry_requested"
        )
        || !intent.requiresTeacherReview
        || intent.visibility.includes("public_world")
        || !intent.visibility.includes("teacher_only")
      ) {
        throw new InvalidWorldActionError(
          "学习策展节点只能在教师终评后生成非公开待审核候选",
        );
      }
    }
    if (role.roleId === "teaching_director") {
      if (
        intent.intentType !== "record_teaching_directive"
        || intent.requiresTeacherReview
        || intent.visibility.includes("public_world")
      ) {
        throw new InvalidWorldActionError("教学导演只能提交非公开、无世界写入的结构化教学指令");
      }
    }
    if (role.roleId === "scene_director") {
      const isProposal = intent.intentType === "propose_scenario_intervention";
      const isNoOp = intent.intentType === "record_scene_no_op";
      if (
        (!isProposal && !isNoOp)
        || (isProposal && !intent.requiresTeacherReview)
        || (isNoOp && intent.requiresTeacherReview)
        || intent.visibility.includes("public_world")
      ) {
        throw new InvalidWorldActionError("情境导演只能提交待审候选或显式 no_op");
      }
    }
  }

  private assertAssistanceProposalForWorld(input: {
    proposal: AgentAssistanceProposal;
    task: AgentTask;
    role: RoleContract;
    triggerEvent: WorldEvent;
    state: WorldState;
    agentRunId: string;
  }): void {
    const proposal = AgentAssistanceProposalSchema.parse(input.proposal);
    const expectedTriggerByKind: Partial<Record<
      AgentAssistanceProposal["output"]["kind"],
      WorldEvent["eventType"]
    >> = {
      evidence_coaching: "evidence_recorded",
      material_understanding: "media_processing_completed",
      evaluation_review: "evaluation_arbitrated",
    };
    if (
      !input.task.roleSnapshot
      || proposal.actorId !== input.task.agentId
      || proposal.roleId !== input.task.roleId
      || proposal.agentRunId !== input.agentRunId
      || !input.role.allowedIntents.includes("provide_assistance")
    ) {
      throw new PermissionDeniedError(
        "辅助建议身份、运行或角色能力与持久任务不一致",
      );
    }
    if (
      hashValue(proposal.templateRef) !== hashValue(input.task.templateRef)
      || hashValue(proposal.instanceRef) !== hashValue(input.task.instanceRef)
      || proposal.expectedStateVersion !== input.task.expectedStateVersion
      || !proposal.causationEventIds.includes(input.triggerEvent.eventId)
      || expectedTriggerByKind[proposal.output.kind]
        !== input.triggerEvent.eventType
    ) {
      throw new InvalidWorldActionError(
        "辅助建议没有固定到本次模板、实例、状态或触发事件",
      );
    }
    if (
      proposal.subjectActorId !== input.task.instanceContext.subjectActorId
      || hashValue(proposal.resourceRef)
        !== hashValue(input.task.instanceContext.resourceRef)
      || !proposal.subjectActorId
      || !sameActorSet(
        proposal.visibleToActorIds,
        [proposal.subjectActorId],
      )
    ) {
      throw new PermissionDeniedError(
        "辅助建议的目标主体、资源或可见白名单与实例绑定不一致",
      );
    }
    if (proposal.evidenceRefs.some((evidenceId) => (
      !input.state.evidence.some((item) => item.evidenceId === evidenceId)
    ))) {
      throw new InvalidWorldActionError("辅助建议引用未知过程证据");
    }
    const scopeValid = input.role.roleId === "student_assistant"
      ? (
          proposal.output.kind === "evidence_coaching"
          && proposal.visibility.includes("role_private")
          && proposal.visibility.includes("audit_only")
          && !proposal.visibility.includes("assigned_team")
          && !proposal.visibility.includes("teacher_only")
        )
      : input.role.roleId === "content_assistant"
        ? (
            proposal.output.kind === "material_understanding"
            && proposal.visibility.includes("assigned_team")
            && proposal.visibility.includes("audit_only")
            && !proposal.visibility.includes("role_private")
            && !proposal.visibility.includes("teacher_only")
          )
        : input.role.roleId === "teacher_assistant"
          ? (
              proposal.output.kind === "evaluation_review"
              && proposal.visibility.includes("teacher_only")
              && proposal.visibility.includes("audit_only")
              && !proposal.visibility.includes("role_private")
              && !proposal.visibility.includes("assigned_team")
            )
          : false;
    if (
      !scopeValid
      || proposal.visibility.includes("public_world")
      || proposal.authority !== "advisory_only"
      || !proposal.requiresHumanAction
    ) {
      throw new PermissionDeniedError(
        "辅助建议输出类型、可见范围或非权威边界无效",
      );
    }
  }

  private assertRoleResponseIntentForWorld(
    rawIntent: RoleResponseIntent,
    task: AgentTask,
    role: RoleContract,
    triggerEvent: WorldEvent,
  ): ReturnType<typeof RoleInteractionResponseSchema.parse> {
    const intent = RoleResponseIntentSchema.parse(rawIntent);
    if (triggerEvent.eventType !== "role_interaction_requested") {
      throw new InvalidWorldActionError("岗位响应意图只能由角色互动请求触发");
    }
    if (
      intent.actorId !== task.agentId
      || intent.roleId !== task.roleId
      || intent.expectedStateVersion !== task.expectedStateVersion
    ) {
      throw new PermissionDeniedError("岗位响应意图身份或状态版本与调度任务不一致");
    }
    if (
      !role.allowedIntents.includes("post_role_response")
      || !intent.causationEventIds.includes(triggerEvent.eventId)
    ) {
      throw new PermissionDeniedError("岗位响应缺少角色授权或实际触发因果");
    }
    const request = RoleInteractionRequestSchema.parse(triggerEvent.payload.interaction);
    const response = RoleInteractionResponseSchema.parse(intent.proposedResponse);
    if (
      request.toActorId !== task.agentId
      || request.toRoleId !== task.roleId
      || response.fromActorId !== task.agentId
      || response.fromRoleId !== task.roleId
      || response.toActorId !== request.fromActorId
      || response.toRoleId !== request.fromRoleId
    ) {
      throw new PermissionDeniedError("岗位响应的发送者、收件人或角色与触发请求不一致");
    }
    if (
      response.interactionId !== request.interactionId
      || response.threadId !== request.threadId
      || response.topic !== request.topic
    ) {
      throw new InvalidWorldActionError("岗位响应未正确引用请求线程、互动或主题");
    }
    const privateActors = [request.fromActorId, request.toActorId];
    if (
      !intent.visibility.includes("role_private")
      || !intent.visibility.includes("audit_only")
      || intent.visibility.includes("public_world")
      || !sameActorSet(intent.visibleToActorIds, privateActors)
    ) {
      throw new PermissionDeniedError("岗位响应必须仅对互动双方与审计教师可见");
    }
    if ((response.act === "commit") !== Boolean(response.commitment)) {
      throw new InvalidWorldActionError("commit 言语行为必须且只能携带一个结构化承诺");
    }
    if (response.commitment) {
      const commitment = response.commitment;
      if (
        commitment.ownerActorId !== response.fromActorId
        || commitment.granteeActorId !== response.toActorId
        || commitment.sourceInteractionId !== response.interactionId
        || !sameActorSet(commitment.visibleToActorIds, privateActors)
      ) {
        throw new PermissionDeniedError("私有承诺的主体、受益人、来源或可见白名单不一致");
      }
    }
    return response;
  }

  async applyAgentResult(
    rawTask: AgentTask,
    rawAgentRun: AgentRunResult,
  ): Promise<WorldEvent[]> {
    const task = AgentTaskSchema.parse(rawTask);
    const agentRun = AgentRunResultSchema.parse(rawAgentRun);
    const history = await this.store.load(task.sessionId);
    if (history.length === 0) throw new SessionNotFoundError(task.sessionId);
    if (this.completedAgentTaskKeys(history).has(task.idempotencyKey)) return [];
    const release = this.releaseForEvents(history);
    const state = reduceWorldState(task.sessionId, release.package, history);
    if (state.sessionEpoch !== task.sessionEpoch) {
      throw new InvalidWorldActionError("智能体结果属于已结束的会话世代");
    }
    const agentRole = this.requireAgentTaskRole(task, state.scenario);
    const appendOnlyResult = (
      agentRole.roleId === "assessor"
      || agentRole.roleId === "learning_curator"
      || agentRole.roleId === "student_assistant"
      || agentRole.roleId === "content_assistant"
      || agentRole.roleId === "teacher_assistant"
    );
    if (
      state.stateVersion < task.expectedStateVersion
      || (!appendOnlyResult && state.stateVersion !== task.expectedStateVersion)
    ) {
      throw new StateVersionConflictError(task.expectedStateVersion, state.stateVersion);
    }
    const triggerEvent = history.find((event) => event.eventId === task.triggerEventId);
    if (!triggerEvent || triggerEvent.eventType !== task.triggerEventType) {
      throw new InvalidWorldActionError("智能体任务引用的触发事件不存在或类型不一致");
    }
    if (
      agentRun.trace.taskId !== task.taskId
      || agentRun.trace.agentId !== task.agentId
      || !agentRun.trace.triggerRefs.includes(task.triggerEventId)
    ) {
      throw new PermissionDeniedError("智能体运行轨迹与持久任务身份或因果链不一致");
    }
    const now = this.#clock.now();
    const finalTask = AgentTaskSchema.parse({
      ...task,
      status: agentRun.trace.status,
      lease: null,
      lastErrorCode: agentRun.trace.errorCode,
      updatedAt: now,
      completedAt: now,
    });
    const traceDraft: EventDraft = {
      eventType: "agent_run_recorded",
      actorId: "system",
      summary: `${agentRole.displayName}完成独立智能体事件波：${agentRun.trace.status}`,
      visibility: teacherVisibility,
      payload: {
        task: finalTask,
        trace: agentRun.trace,
        contextHash: agentRun.signals.promptContextHash ?? null,
        triggerEventId: triggerEvent.eventId,
      },
    };
    const intent = agentRun.intent;
    const responseIntent = agentRun.roleResponseIntent;
    const assistanceProposal = agentRun.assistanceProposal;
    if (
      assistanceProposal
      && (intent || responseIntent)
    ) {
      throw new InvalidWorldActionError(
        "辅助建议不得与世界行动或岗位响应共同提交",
      );
    }
    if (assistanceProposal) {
      this.assertAssistanceProposalForWorld({
        proposal: assistanceProposal,
        task,
        role: agentRole,
        triggerEvent,
        state,
        agentRunId: agentRun.trace.agentRunId,
      });
      const audience = createResourceAudience({
        scopes: assistanceProposal.visibility,
        courseId: state.scenario.courseId,
        sessionId: state.sessionId,
        sessionEpoch: state.sessionEpoch,
        teamIds: assistanceProposal.visibility.includes("assigned_team")
          || assistanceProposal.visibility.includes("role_private")
          ? [task.instanceContext.teamId]
          : [],
        actorIds: assistanceProposal.visibleToActorIds,
        privateNamespaces: assistanceProposal.visibility.includes("role_private")
          ? assistanceProposal.visibleToActorIds.map(
              (actorId) => `actor:${actorId}`,
            )
          : [],
        auditReadable: true,
      });
      return this.commit(
        task.sessionId,
        state.stateVersion,
        [
          traceDraft,
          {
            eventType: "agent_assistance_recorded",
            actorId: agentRole.agentId,
            summary: `${agentRole.displayName}已形成非权威结构化建议，等待人类选择`,
            visibility: assistanceProposal.visibility,
            visibleToActorIds: assistanceProposal.visibleToActorIds,
            audience,
            payload: {
              proposal: assistanceProposal,
              taskId: task.taskId,
              templateRef: task.templateRef,
              instanceRef: task.instanceRef,
              authority: assistanceProposal.authority,
            },
          },
        ],
        task.correlationId,
        state.sessionEpoch,
        task.causalDepth + 1,
        task.actionContext,
      );
    }
    if (!intent && !responseIntent) {
      if (agentRole.roleId === "assessor") {
        const evaluatorKind = evaluatorKindForRole(agentRole);
        const evaluationCase = EvaluationCaseSchema.parse(
          triggerEvent.payload.evaluationCase,
        );
        const evidenceBundle = EvaluationEvidenceBundleSchema.parse(
          triggerEvent.payload.evidenceBundle,
        );
        if (!evaluatorKind) {
          throw new InvalidWorldActionError(
            `评价节点未绑定固定评价器类别：${agentRole.agentId}`,
          );
        }
        if (!canAppendEvaluationRetryResult({
          state,
          triggerEvent,
          evaluationCase,
          evaluatorKind,
        })) {
          throw new InvalidWorldActionError(
            "评价结果没有命中可追加的原始分支或精确重跑分支",
          );
        }
        const proposal = createUnavailableEvaluationProposal({
          nextId: this.#ids.next.bind(this.#ids),
          now,
          evaluationCase,
          evidenceBundle,
          evaluatorKind,
          definitionVersion: agentRun.trace.definitionVersion,
          promptVersion: agentRun.trace.promptVersion,
          errorCode: agentRun.trace.errorCode ?? "evaluation_result_missing",
        });
        const existingProposals = state.evaluationProposals.filter(
          (item) => item.evaluationCaseId === evaluationCase.evaluationCaseId,
        );
        const previousRevision = Math.max(
          0,
          ...state.evaluationArbitrations
            .filter((item) => item.evaluationCaseId === evaluationCase.evaluationCaseId)
            .map((item) => item.revision),
        );
        const arbitration = arbitrateEvaluationProposals({
          nextId: this.#ids.next.bind(this.#ids),
          now,
          evaluationCase,
          proposals: [...existingProposals, proposal],
          previousRevision,
        });
        return this.commit(
          task.sessionId,
          state.stateVersion,
          [
            traceDraft,
            {
              eventType: "evaluation_proposal_recorded",
              actorId: agentRole.agentId,
              summary: `${agentRole.displayName}不可用；已记录无分数降级意见`,
              visibility: teacherVisibility,
              payload: { proposal, taskId: task.taskId },
            },
            {
              eventType: "evaluation_arbitrated",
              actorId: "system",
              summary: `评价仲裁已更新：${arbitration.status}`,
              visibility: teacherVisibility,
              payload: { arbitration },
            },
          ],
          task.correlationId,
          state.sessionEpoch,
          task.causalDepth + 1,
          task.actionContext,
        );
      }
      if (agentRole.roleId === "learning_curator") {
        return this.commit(
          task.sessionId,
          state.stateVersion,
          [
            traceDraft,
            {
              eventType: "learning_candidate_generation_failed",
              actorId: agentRole.agentId,
              summary: "学习候选生成失败；终评保持有效且未写入任何候选内容",
              visibility: teacherVisibility,
              payload: {
                taskId: task.taskId,
                triggerEventId: triggerEvent.eventId,
                errorCode: agentRun.trace.errorCode
                  ?? "learning_candidate_result_missing",
                ...learningFailureContext(triggerEvent),
              },
            },
          ],
          task.correlationId,
          state.sessionEpoch,
          task.causalDepth + 1,
          task.actionContext,
        );
      }
      return this.commit(
        task.sessionId,
        state.stateVersion,
        [traceDraft],
        task.correlationId,
        state.sessionEpoch,
        task.causalDepth + 1,
        task.actionContext,
      );
    }
    if (intent) {
      if (intent.agentRunId !== agentRun.trace.agentRunId) {
        throw new PermissionDeniedError("行动意图与智能体运行轨迹不属于同一运行");
      }
      this.assertAgentIntentForWorld(intent, task, agentRole, triggerEvent);
    }
    if (responseIntent) {
      if (responseIntent.agentRunId !== agentRun.trace.agentRunId) {
        throw new PermissionDeniedError("岗位响应意图与智能体运行轨迹不属于同一运行");
      }
      const request = RoleInteractionRequestSchema.parse(triggerEvent.payload.interaction);
      const response = this.assertRoleResponseIntentForWorld(
        responseIntent,
        task,
        agentRole,
        triggerEvent,
      );
      for (const factId of response.citedFactIds) {
        if (!state.facts.some((fact) => fact.factId === factId)) {
          throw new InvalidWorldActionError(`岗位响应引用未知世界事实：${factId}`);
        }
      }
      const visibleToActorIds = [request.fromActorId, request.toActorId];
      const requestMessage = state.messages.findLast((message) => (
        message.interactionId === request.interactionId
        && message.actorId === request.fromActorId
      ));
      const nodeByTopic: Record<RoleInteractionRequest["topic"], string> = {
        heritage_process: "source",
        visitor_count: "source",
        copyright_scope: "copyright",
        release_decision: "brief",
        platform_review: "release",
      };
      const evidence = EvidenceSchema.parse({
        evidenceId: this.#ids.next("evidence"),
        sessionId: state.sessionId,
        nodeId: nodeByTopic[request.topic],
        actorId: request.fromActorId,
        action: `完成岗位互动：${request.topic}`,
        basis: `${agentRole.displayName}已对第${request.turn}轮结构化岗位请求作出可追溯响应`,
        materialRefs: request.topic === "copyright_scope"
          ? ["material-festival-photo", "material-license-note"]
          : request.topic === "visitor_count"
            ? ["material-visitor-sheet"]
            : [],
        eventRefs: [triggerEvent.eventId],
        observationRefs: [],
        createdAt: now,
        visibility: assignedVisibility,
      });
      const responseDrafts: EventDraft[] = [
        traceDraft,
        {
          eventType: "role_response_intent_recorded",
          actorId: responseIntent.actorId,
          summary: `${agentRole.displayName}提出受控岗位响应意图`,
          visibility: ["role_private", "audit_only"],
          visibleToActorIds,
          payload: { taskId: task.taskId, roleResponseIntent: responseIntent },
        },
        {
          eventType: "role_interaction_responded",
          actorId: agentRole.agentId,
          summary: `${agentRole.displayName}完成第${request.turn}轮岗位响应`,
          visibility: ["role_private", "audit_only"],
          visibleToActorIds,
          payload: { response },
        },
        this.messageDraft({
          eventType: "role_message_posted",
          actorId: agentRole.agentId,
          roleId: agentRole.roleId,
          displayName: agentRole.displayName,
          content: response.content,
          visibility: ["role_private", "audit_only"],
          visibleToActorIds,
          channel: "role_interaction",
          threadId: request.threadId,
          replyToMessageId: requestMessage?.messageId ?? null,
          interactionId: request.interactionId,
          responseAct: response.act,
          topic: response.topic,
          stance: response.stance,
          commitment: response.commitment,
          turn: request.turn,
          recipientActorIds: [request.fromActorId],
          sourceRefs: [
            triggerEvent.eventId,
            ...response.citedFactIds,
          ],
          now,
        }),
        {
          eventType: "evidence_recorded",
          actorId: "system",
          summary: `${request.fromRoleId} 与 ${request.toRoleId} 的岗位协作形成过程证据`,
          visibility: assignedVisibility,
          payload: { evidence },
        },
      ];
      if (intent) {
        responseDrafts.push({
          eventType: "agent_intent_recorded",
          actorId: intent.actorId,
          summary: `${agentRole.displayName}另行提出待教师复核的世界行动意图`,
          visibility: intent.visibility,
          visibleToActorIds: intent.visibleToActorIds,
          payload: { taskId: task.taskId, intent, candidateId: null },
        });
      }
      if (intent?.intentType === "propose_copyright_dispute") {
        const policy = this.eventPolicy(state, intent.intentType, agentRole, request.optionId);
        if (policy.effectHandlerId !== "copyright_dispute_v1") {
          throw new InvalidWorldActionError("版权争议事件策略处理器不受支持");
        }
        if (state.candidates.some((candidate) => (
          candidate.eventType === "copyright_risk_flagged"
          && candidate.status !== "rejected"
        ))) {
          throw new InvalidWorldActionError("版权争议候选已经存在");
        }
        const copyrightFact: WorldFact = {
          factId: "fact-copyright-dispute",
          domain: "copyright",
          statement: "苏禾影像确认现场图仅授权课程内展示，尚未授权商业信息流平台发布。",
          status: "disputed",
          sourceRefs: ["material-license-note", "material-festival-photo"],
          version: "1.0",
          visibility: "assigned_team",
        };
        const candidate = this.candidate({
          eventType: policy.eventType,
          title: policy.title,
          triggerReason: intent.rationaleSummary,
          competencyTarget: policy.competencyTarget,
          expectedImpact: policy.expectedImpact,
          payload: { fact: copyrightFact, materialId: "material-festival-photo", nextNodeId: "copyright" },
          proposedBy: intent.actorId,
          approvalPolicyId: policy.approvalPolicyId,
          now,
        });
        const actionDraft = responseDrafts.find((draft) => (
          draft.eventType === "agent_intent_recorded"
          && (draft.payload as { intent?: { intentId?: string } } | undefined)?.intent?.intentId
            === intent.intentId
        ));
        if (actionDraft?.payload) actionDraft.payload.candidateId = candidate.candidateId;
        responseDrafts.push({
          eventType: "candidate_event_proposed",
          actorId: "system",
          summary: `世界内核将版权方响应转换为待审批候选：${candidate.title}`,
          visibility: teacherVisibility,
          payload: { candidate, sourceIntentId: intent.intentId, taskId: task.taskId },
        });
      }
      if (intent?.intentType === "propose_platform_escalation") {
        const policy = this.eventPolicy(state, intent.intentType, agentRole, request.optionId);
        if (policy.effectHandlerId !== "platform_escalation_v1") {
          throw new InvalidWorldActionError("平台升级事件策略处理器不受支持");
        }
        if (state.candidates.some((candidate) => (
          candidate.eventType === "node_activated"
          && candidate.status !== "rejected"
        ))) {
          throw new InvalidWorldActionError("平台升级候选已经存在");
        }
        const candidate = this.candidate({
          eventType: policy.eventType,
          title: policy.title,
          triggerReason: intent.rationaleSummary,
          competencyTarget: policy.competencyTarget,
          expectedImpact: policy.expectedImpact,
          payload: { nodeId: "release", virtualMinute: 24 },
          proposedBy: intent.actorId,
          approvalPolicyId: policy.approvalPolicyId,
          now,
        });
        const actionDraft = responseDrafts.find((draft) => (
          draft.eventType === "agent_intent_recorded"
          && (draft.payload as { intent?: { intentId?: string } } | undefined)?.intent?.intentId
            === intent.intentId
        ));
        if (actionDraft?.payload) actionDraft.payload.candidateId = candidate.candidateId;
        responseDrafts.push({
          eventType: "candidate_event_proposed",
          actorId: "system",
          summary: `世界内核将平台响应转换为待审批候选：${candidate.title}`,
          visibility: teacherVisibility,
          payload: { candidate, sourceIntentId: intent.intentId, taskId: task.taskId },
        });
      }
      if (
        intent
        && intent.intentType !== "propose_copyright_dispute"
        && intent.intentType !== "propose_platform_escalation"
      ) {
        throw new InvalidWorldActionError(`岗位响应伴随未支持行动意图：${intent.intentType}`);
      }
      return this.commit(
        task.sessionId,
        state.stateVersion,
        responseDrafts,
        task.correlationId,
        state.sessionEpoch,
        task.causalDepth + 1,
        task.actionContext,
      );
    }

    if (agentRole.roleId === "assessor") {
      if (!intent || intent.intentType !== "record_evaluation_proposal") {
        throw new InvalidWorldActionError("评价节点没有返回结构化评价意见");
      }
      const evaluatorKind = evaluatorKindForRole(agentRole);
      if (!evaluatorKind) {
        throw new InvalidWorldActionError(
          `评价节点未绑定固定评价器类别：${agentRole.agentId}`,
        );
      }
      const evaluationCase = EvaluationCaseSchema.parse(
        triggerEvent.payload.evaluationCase,
      );
      const evidenceBundle = EvaluationEvidenceBundleSchema.parse(
        triggerEvent.payload.evidenceBundle,
      );
      const persistedCase = state.evaluationCases.find(
        (item) => item.evaluationCaseId === evaluationCase.evaluationCaseId,
      );
      const persistedBundle = state.evaluationEvidenceBundles.find(
        (item) => item.bundleId === evidenceBundle.bundleId,
      );
      if (
        !persistedCase
        || persistedCase.caseHash !== evaluationCase.caseHash
        || !persistedBundle
        || persistedBundle.bundleHash !== evidenceBundle.bundleHash
      ) {
        throw new InvalidWorldActionError(
          "评价结果没有命中当前世界中固定的案件与证据包",
        );
      }
      if (
        intent.proposedPayload.evaluatorKind !== evaluatorKind
        || (
          intent.proposedPayload.evaluationCaseId !== undefined
          && intent.proposedPayload.evaluationCaseId !== evaluationCase.evaluationCaseId
        )
        || (
          intent.proposedPayload.caseHash !== undefined
          && intent.proposedPayload.caseHash !== evaluationCase.caseHash
        )
        || (
          intent.proposedPayload.evidenceBundleHash !== undefined
          && intent.proposedPayload.evidenceBundleHash !== evidenceBundle.bundleHash
        )
      ) {
        throw new PermissionDeniedError(
          "评价节点类别或固定案件哈希与角色任务不一致",
        );
      }
      if (!canAppendEvaluationRetryResult({
        state,
        triggerEvent,
        evaluationCase,
        evaluatorKind,
      })) {
        throw new InvalidWorldActionError(
          `评价案件不允许追加 ${evaluatorKind} 意见；仅可从精确的 unavailable 意见发起重跑`,
        );
      }
      const status = intent.proposedPayload.status === "unavailable"
        ? "unavailable" as const
        : intent.proposedPayload.status === "completed"
          ? "completed" as const
          : null;
      if (!status) {
        throw new InvalidWorldActionError("评价节点返回未知执行状态");
      }
      const dimensions = EvaluationDimensionProposalSchema.array().parse(
        intent.proposedPayload.dimensions ?? [],
      );
      const errorCode = typeof intent.proposedPayload.errorCode === "string"
        ? intent.proposedPayload.errorCode
        : null;
      const proposal = createSemanticEvaluationProposal({
        nextId: this.#ids.next.bind(this.#ids),
        now,
        evaluationCase,
        evidenceBundle,
        evaluatorKind,
        status,
        dimensions,
        errorCode,
        trace: agentRun.trace,
      });
      const existingProposals = state.evaluationProposals.filter(
        (item) => item.evaluationCaseId === evaluationCase.evaluationCaseId,
      );
      const previousRevision = Math.max(
        0,
        ...state.evaluationArbitrations
          .filter((item) => item.evaluationCaseId === evaluationCase.evaluationCaseId)
          .map((item) => item.revision),
      );
      const arbitration = arbitrateEvaluationProposals({
        nextId: this.#ids.next.bind(this.#ids),
        now,
        evaluationCase,
        proposals: [...existingProposals, proposal],
        previousRevision,
      });
      return this.commit(
        task.sessionId,
        state.stateVersion,
        [
          traceDraft,
          {
            eventType: "agent_intent_recorded",
            actorId: intent.actorId,
            summary: `${agentRole.displayName}提交逐维评价意见`,
            visibility: teacherVisibility,
            payload: {
              taskId: task.taskId,
              intent,
              evaluationCaseId: evaluationCase.evaluationCaseId,
              proposalId: proposal.proposalId,
            },
          },
          {
            eventType: "evaluation_proposal_recorded",
            actorId: agentRole.agentId,
            summary: status === "completed"
              ? `${agentRole.displayName}逐维评价已固定`
              : `${agentRole.displayName}不可用；未伪造任何分数`,
            visibility: teacherVisibility,
            payload: { proposal, taskId: task.taskId },
          },
          {
            eventType: "evaluation_arbitrated",
            actorId: "system",
            summary: `评价仲裁已更新：${arbitration.status}`,
            visibility: teacherVisibility,
            payload: { arbitration },
          },
        ],
        task.correlationId,
        state.sessionEpoch,
        task.causalDepth + 1,
        task.actionContext,
      );
    }

    if (agentRole.roleId === "learning_curator") {
      if (!intent || intent.intentType !== "propose_learning_candidate") {
        throw new InvalidWorldActionError("学习策展节点没有返回结构化待审候选");
      }
      if (intent.proposedPayload.status === "unavailable") {
        return this.commit(
          task.sessionId,
          state.stateVersion,
          [
            traceDraft,
            {
              eventType: "agent_intent_recorded",
              actorId: intent.actorId,
              summary: "学习策展节点显式报告不可用；未生成候选",
              visibility: teacherVisibility,
              payload: { taskId: task.taskId, intent, candidateId: null },
            },
            {
              eventType: "learning_candidate_generation_failed",
              actorId: agentRole.agentId,
              summary: "学习候选生成失败；终评保持有效且正式学习版本未变化",
              visibility: teacherVisibility,
              payload: {
                taskId: task.taskId,
                triggerEventId: triggerEvent.eventId,
                errorCode: typeof intent.proposedPayload.errorCode === "string"
                  ? intent.proposedPayload.errorCode
                  : agentRun.trace.errorCode
                    ?? "learning_candidate_unavailable",
                ...learningFailureContext(triggerEvent),
              },
            },
          ],
          task.correlationId,
          state.sessionEpoch,
          task.causalDepth + 1,
          task.actionContext,
        );
      }
      if (intent.proposedPayload.status !== "completed") {
        throw new InvalidWorldActionError(
          "学习策展节点返回未知执行状态",
        );
      }
      const teacherReview = TeacherAssessmentReviewSchema.parse(
        triggerEvent.payload.review,
      );
      const persistedReview = state.teacherAssessmentReviews.find(
        (item) => item.reviewId === teacherReview.reviewId,
      );
      if (
        !persistedReview
        || persistedReview.finalHash !== teacherReview.finalHash
      ) {
        throw new InvalidWorldActionError(
          "学习候选没有命中当前世界中的精确教师终评",
        );
      }
      if (state.learningCandidates.some((candidate) => (
        candidate.evaluationCaseId === teacherReview.evaluationCaseId
        && candidate.sourceFinalAssessmentId
          === String(triggerEvent.payload.finalAssessmentId ?? "")
      ))) {
        throw new InvalidWorldActionError("该教师终评已经生成学习候选");
      }
      const finalAssessmentId = String(
        triggerEvent.payload.finalAssessmentId ?? "",
      );
      const finalAssessment = state.assessments.find(
        (item) => item.assessmentId === finalAssessmentId && item.stage === "teacher",
      );
      const evaluationCase = state.evaluationCases.find(
        (item) => item.evaluationCaseId === teacherReview.evaluationCaseId,
      );
      const evidenceBundle = evaluationCase
        ? state.evaluationEvidenceBundles.find(
            (item) => item.bundleId === evaluationCase.evidenceBundleId,
          )
        : null;
      if (!finalAssessment || !evaluationCase || !evidenceBundle) {
        throw new InvalidWorldActionError(
          "学习候选缺少终评、评价案件或固定证据包",
        );
      }
      const allowedEvidenceRefs = new Set(
        evidenceBundle.evidenceRefs.map((item) => item.evidenceId),
      );
      const requestedEvidenceRefs = Array.isArray(
        intent.proposedPayload.sourceEvidenceRefs,
      )
        ? intent.proposedPayload.sourceEvidenceRefs.filter(
            (item): item is string => typeof item === "string",
          )
        : [];
      const sourceEvidenceRefs = requestedEvidenceRefs.length > 0
        ? [...new Set(requestedEvidenceRefs)]
        : [...new Set(
            teacherReview.dimensions.flatMap((item) => item.evidenceRefs),
          )];
      if (
        sourceEvidenceRefs.length === 0
        || sourceEvidenceRefs.some((item) => !allowedEvidenceRefs.has(item))
      ) {
        throw new InvalidWorldActionError(
          "学习候选只能引用固定评价证据包内的可追溯证据",
        );
      }
      const rawProposedContent = (
        intent.proposedPayload.proposedContent
        && typeof intent.proposedPayload.proposedContent === "object"
        && !Array.isArray(intent.proposedPayload.proposedContent)
      )
        ? intent.proposedPayload.proposedContent as Record<string, unknown>
        : {};
      const exemplarSummary = String(
        rawProposedContent.exemplarSummary
        ?? rawProposedContent.summary
        ?? intent.rationaleSummary,
      ).trim().slice(0, 1_200);
      const rawFocus = Array.isArray(rawProposedContent.improvementFocus)
        ? rawProposedContent.improvementFocus
        : [];
      const improvementFocus = rawFocus
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 8);
      const proposedContent: Record<string, unknown> = {
        finalScore: teacherReview.finalScore,
        publicSummary: teacherReview.publicSummary,
        exemplarSummary: exemplarSummary || teacherReview.publicSummary,
        improvementFocus,
        dimensions: teacherReview.dimensions.map((dimension) => ({
          dimensionId: dimension.dimensionId,
          finalScore: dimension.finalScore,
          maxScore: dimension.maxScore,
          publicFeedback: dimension.publicFeedback,
          evidenceRefs: [...dimension.evidenceRefs].sort(),
        })),
      };
      const knownRisks = Array.isArray(intent.proposedPayload.knownRisks)
        ? intent.proposedPayload.knownRisks
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.trim())
            .filter(Boolean)
        : [];
      const conflictRefs = Array.isArray(intent.proposedPayload.conflictRefs)
        ? intent.proposedPayload.conflictRefs
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.trim())
            .filter(Boolean)
        : [];
      const candidate = createLearningCandidate({
        nextId: this.#ids.next.bind(this.#ids),
        now,
        title: String(
          intent.proposedPayload.title
          ?? "地方文旅融媒体岗位终评证据样例",
        ).trim().slice(0, 240),
        proposedContent,
        sourceEvidenceRefs,
        sourceFinalAssessmentId: finalAssessment.assessmentId,
        evaluationCaseId: evaluationCase.evaluationCaseId,
        courseId: state.scenario.courseId,
        scenarioId: state.scenario.scenarioId,
        rubricId: state.scenario.rubricId,
        expectedBenefit: String(
          intent.proposedPayload.expectedBenefit
          ?? "沉淀经教师审核的逐维评价样例，供后续离线检索与课程校准使用",
        ).trim().slice(0, 1_200),
        knownRisks,
        conflictRefs,
        generatedBy: agentRole.agentId,
        generatorTraceId: agentRun.trace.agentRunId,
      });
      const release = this.releaseForState(state);
      const replayReport = runLearningCandidateReplay({
        nextId: this.#ids.next.bind(this.#ids),
        now,
        candidate,
        finalAssessment: teacherReview,
        allowedEvidenceRefs: [...allowedEvidenceRefs],
        scenarioReleaseId: release.ref.releaseId,
        scenarioContentHash: release.ref.contentHash,
        rubricHash: evaluationCase.rubricHash,
        activeReleaseId: state.activeLearningReleaseId,
      });
      return this.commit(
        task.sessionId,
        state.stateVersion,
        [
          traceDraft,
          {
            eventType: "agent_intent_recorded",
            actorId: intent.actorId,
            summary: "学习策展节点提出不可变待审核候选",
            visibility: teacherVisibility,
            payload: {
              taskId: task.taskId,
              intent,
              candidateId: candidate.candidateId,
            },
          },
          {
            eventType: "learning_candidate_created",
            actorId: agentRole.agentId,
            summary: "学习候选已生成；尚未写入任何正式知识或技能版本",
            visibility: teacherVisibility,
            payload: { learningCandidate: candidate },
          },
          {
            eventType: "learning_candidate_replay_completed",
            actorId: "system",
            summary: replayReport.status === "passed"
              ? "学习候选离线回放通过，等待课程负责人审核"
              : "学习候选离线回放失败，发布门保持关闭",
            visibility: teacherVisibility,
            payload: { replayReport },
          },
        ],
        task.correlationId,
        state.sessionEpoch,
        task.causalDepth + 1,
        task.actionContext,
      );
    }

    if (agentRole.roleId === "teaching_director") {
      if (!intent || intent.intentType !== "record_teaching_directive") {
        throw new InvalidWorldActionError("教学导演没有返回结构化教学指令");
      }
      for (const evidenceRef of intent.evidenceRefs) {
        if (!state.evidence.some((evidence) => evidence.evidenceId === evidenceRef)) {
          throw new InvalidWorldActionError(`教学导演引用未知证据：${evidenceRef}`);
        }
      }
      const directive = TeachingDirectiveSchema.parse({
        directiveId: this.#ids.next("teaching-directive"),
        strategy: intent.proposedPayload.strategy,
        reasonCode: intent.proposedPayload.reasonCode,
        rationaleSummary: intent.rationaleSummary,
        targetCompetency: intent.proposedPayload.targetCompetency,
        recommendedDifficulty: intent.proposedPayload.recommendedDifficulty,
        targetRoleIds: intent.proposedPayload.targetRoleIds,
        triggerEventIds: [triggerEvent.eventId],
        evidenceRefs: intent.evidenceRefs,
        confidence: intent.confidence,
        handoffToSceneDirector: intent.proposedPayload.handoffToSceneDirector,
        proposedBy: intent.actorId,
        proposedAt: now,
      });
      return this.commit(
        task.sessionId,
        state.stateVersion,
        [
          traceDraft,
          {
            eventType: "agent_intent_recorded",
            actorId: intent.actorId,
            summary: `教学导演形成策略：${directive.strategy}`,
            visibility: teacherVisibility,
            payload: { taskId: task.taskId, intent, directiveId: directive.directiveId },
          },
          {
            eventType: "teaching_directive_recorded",
            actorId: intent.actorId,
            summary: `教学指令已记录：${directive.reasonCode}`,
            visibility: teacherVisibility,
            payload: { directive, taskId: task.taskId },
          },
        ],
        task.correlationId,
        state.sessionEpoch,
        task.causalDepth + 1,
        task.actionContext,
      );
    }

    if (agentRole.roleId === "scene_director") {
      if (!intent) throw new InvalidWorldActionError("情境导演没有返回结构化决策");
      const config = state.scenario.directorConfig;
      const difficulty = config?.difficulty ?? "standard";
      const staleCandidateDrafts = staleDirectorCandidateDrafts(state);
      const teachingDirectiveId = typeof intent.proposedPayload.teachingDirectiveId === "string"
        ? intent.proposedPayload.teachingDirectiveId
        : null;
      const recoveryOfCandidateId = typeof intent.proposedPayload.recoveryOfCandidateId === "string"
        ? intent.proposedPayload.recoveryOfCandidateId
        : null;
      if (intent.intentType === "record_scene_no_op") {
        const decision = SceneDirectorDecisionSchema.parse({
          decisionId: this.#ids.next("scene-decision"),
          outcome: "no_op",
          reasonCode: String(intent.proposedPayload.reasonCode ?? "no_matching_route"),
          rationaleSummary: intent.rationaleSummary,
          routeId: null,
          alternativeRouteIds: [],
          candidateId: null,
          triggerEventIds: [triggerEvent.eventId],
          teachingDirectiveId,
          recoveryOfCandidateId,
          difficulty,
          cooldownKey: null,
          cooldownUntilStateVersion: null,
          confidence: intent.confidence,
          proposedBy: intent.actorId,
          proposedAt: now,
        });
        return this.commit(
          task.sessionId,
          state.stateVersion,
          [
            ...staleCandidateDrafts,
            traceDraft,
            {
              eventType: "agent_intent_recorded",
              actorId: intent.actorId,
              summary: `情境导演明确保持世界不变：${decision.reasonCode}`,
              visibility: teacherVisibility,
              payload: { taskId: task.taskId, intent, decisionId: decision.decisionId },
            },
            {
              eventType: "scene_director_decision_recorded",
              actorId: intent.actorId,
              summary: `情境导演 no_op：${decision.reasonCode}`,
              visibility: teacherVisibility,
              payload: { decision, taskId: task.taskId },
            },
          ],
          task.correlationId,
          state.sessionEpoch,
          task.causalDepth + 1,
          task.actionContext,
        );
      }
      if (intent.intentType !== "propose_scenario_intervention") {
        throw new InvalidWorldActionError(`情境导演输出未支持意图：${intent.intentType}`);
      }
      if (!config || !state.scenario.directorEventTemplates) {
        throw new InvalidWorldActionError("固定情境版本未启用双导演路线");
      }
      const routeId = String(intent.proposedPayload.routeId ?? "");
      const template = state.scenario.directorEventTemplates.find((item) => item.routeId === routeId);
      if (!template || !config.allowedRouteIds.includes(routeId)) {
        throw new PermissionDeniedError(`情境包未授权导演路线：${routeId}`);
      }
      if (
        !template.applicableNodeIds.includes(state.currentNodeId)
        || !template.triggerEventTypes.includes(triggerEvent.eventType)
        || !template.difficultyLevels.includes(config.difficulty)
        || state.evidence.length < template.minimumEvidenceCount
        || (
          template.maximumEvidenceCount !== null
          && state.evidence.length > template.maximumEvidenceCount
        )
      ) {
        throw new InvalidWorldActionError("导演路线已不满足当前节点、触发、证据或难度前置条件");
      }
      if (currentPendingCandidates(state).some((candidate) => (
        candidate.candidateKind === "director_intervention"
      ))) {
        throw new InvalidWorldActionError("已有情境导演候选等待教师处理");
      }
      if (template.kind === "recovery") {
        const original = recoveryOfCandidateId
          ? state.candidates.find((candidate) => candidate.candidateId === recoveryOfCandidateId)
          : null;
        if (
          !original
          || original.status !== "rejected"
          || !original.alternativeRouteIds.includes(template.routeId)
          || triggerEvent.eventType !== "director_recovery_requested"
        ) {
          throw new InvalidWorldActionError("恢复路线没有引用可恢复的已驳回候选");
        }
      } else {
        const directive = teachingDirectiveId
          ? state.teachingDirectives.find((item) => item.directiveId === teachingDirectiveId)
          : null;
        if (
          !directive
          || !directive.triggerEventIds.includes(triggerEvent.eventId)
          || !directive.handoffToSceneDirector
          || !template.teachingStrategies.includes(directive.strategy)
        ) {
          throw new InvalidWorldActionError("导演候选缺少同因果、可交接的教学指令");
        }
      }
      const cooldownActive = state.sceneDirectorDecisions.some((decision) => (
        decision.cooldownKey === template.cooldownKey
        && decision.cooldownUntilStateVersion !== null
        && decision.cooldownUntilStateVersion >= state.stateVersion
      ));
      if (cooldownActive) throw new InvalidWorldActionError("导演路线仍处于可回放冷却窗口");
      for (const evidenceRef of intent.evidenceRefs) {
        if (!state.evidence.some((evidence) => evidence.evidenceId === evidenceRef)) {
          throw new InvalidWorldActionError(`情境导演引用未知证据：${evidenceRef}`);
        }
      }
      const dedupKey = directorDedupKey(state, template, recoveryOfCandidateId);
      if (state.candidates.some((candidate) => (
        candidate.dedupKey === dedupKey
        && candidate.status !== "rejected"
      ))) {
        throw new InvalidWorldActionError("相同语义的导演候选已经存在");
      }
      const decisionId = this.#ids.next("scene-decision");
      const cooldownUntilStateVersion = state.stateVersion + Math.max(
        config.cooldownEvents,
        template.cooldownEvents,
      );
      const candidate = this.candidate({
        eventType: template.eventType,
        title: template.title,
        triggerReason: intent.rationaleSummary,
        competencyTarget: template.competencyTarget,
        expectedImpact: template.expectedImpact,
        payload: { routeId: template.routeId },
        proposedBy: intent.actorId,
        approvalPolicyId: template.approvalPolicyId,
        candidateKind: "director_intervention",
        routeId: template.routeId,
        triggerEventIds: [triggerEvent.eventId],
        evidenceRefs: intent.evidenceRefs,
        sourceRefs: template.sourceRefs,
        affectedRoleIds: template.affectedRoleIds,
        riskLevel: template.riskLevel,
        confidence: intent.confidence,
        difficulty: config.difficulty,
        cooldownKey: template.cooldownKey,
        cooldownUntilStateVersion,
        alternativeRouteIds: template.alternativeRouteIds,
        recoveryOfCandidateId,
        teachingDirectiveId,
        directorDecisionId: decisionId,
        agentRunId: intent.agentRunId,
        policyId: `director:${template.routeId}`,
        proposedStateVersion: state.stateVersion,
        preconditionHash: directorPreconditionHash(state),
        dedupKey,
        now,
      });
      const outcome = intent.proposedPayload.selectionOutcome === "fallback"
        ? "fallback" as const
        : "candidate" as const;
      const decision = SceneDirectorDecisionSchema.parse({
        decisionId,
        outcome,
        reasonCode: String(intent.proposedPayload.reasonCode ?? "eligible_route_selected"),
        rationaleSummary: intent.rationaleSummary,
        routeId: template.routeId,
        alternativeRouteIds: template.alternativeRouteIds,
        candidateId: candidate.candidateId,
        triggerEventIds: [triggerEvent.eventId],
        teachingDirectiveId,
        recoveryOfCandidateId,
        difficulty: config.difficulty,
        cooldownKey: template.cooldownKey,
        cooldownUntilStateVersion,
        confidence: intent.confidence,
        proposedBy: intent.actorId,
        proposedAt: now,
      });
      return this.commit(
        task.sessionId,
        state.stateVersion,
        [
          ...staleCandidateDrafts,
          traceDraft,
          {
            eventType: "agent_intent_recorded",
            actorId: intent.actorId,
            summary: `情境导演提出受控路线：${template.routeId}`,
            visibility: teacherVisibility,
            payload: {
              taskId: task.taskId,
              intent,
              candidateId: candidate.candidateId,
              decisionId,
            },
          },
          {
            eventType: "scene_director_decision_recorded",
            actorId: intent.actorId,
            summary: `情境导演选择路线：${template.title}`,
            visibility: teacherVisibility,
            payload: { decision, taskId: task.taskId },
          },
          {
            eventType: "candidate_event_proposed",
            actorId: "system",
            summary: `世界内核将导演路线转换为待审批候选：${template.title}`,
            visibility: teacherVisibility,
            payload: {
              candidate,
              sourceIntentId: intent.intentId,
              taskId: task.taskId,
              decisionId,
            },
          },
        ],
        task.correlationId,
        state.sessionEpoch,
        task.causalDepth + 1,
        task.actionContext,
      );
    }

    if (!intent) {
      throw new InvalidWorldActionError("智能体运行没有可提交的行动或岗位响应");
    }
    const intentDraft: EventDraft = {
      eventType: "agent_intent_recorded",
      actorId: intent.actorId,
      summary: intent.intentType === "propose_data_correction"
        ? "事实核查智能体提出客流更正意图，等待教师审批"
        : "事实核查智能体请求补充核验证据",
      visibility: intent.visibility,
      visibleToActorIds: intent.visibleToActorIds,
      payload: { taskId: task.taskId, intent, candidateId: null },
    };
    if (intent.intentType === "ask_for_evidence") {
      return this.commit(
        task.sessionId,
        state.stateVersion,
        [
          traceDraft,
          intentDraft,
          this.messageDraft({
            actorId: agentRole.agentId,
            roleId: agentRole.roleId,
            displayName: agentRole.displayName,
            content: intent.rationaleSummary,
            visibility: ["role_private", "audit_only"],
            visibleToActorIds: ["student-editor"],
            now,
          }),
        ],
        task.correlationId,
        state.sessionEpoch,
        task.causalDepth + 1,
        task.actionContext,
      );
    }
    if (intent.intentType !== "propose_data_correction") {
      throw new InvalidWorldActionError(`事实核查智能体输出未支持意图：${intent.intentType}`);
    }

    const correctedFact = WorldFactSchema.parse(intent.proposedPayload.fact);
    const supersedesFactId = String(intent.proposedPayload.supersedesFactId ?? "fact-visitors-v1");
    const nextNodeId = String(intent.proposedPayload.nextNodeId ?? "verification");
    const correctedValue = correctedFact.statement.match(/有效客流为([\d,]+)人次/u)?.[1] ?? "经核验值";
    const policy = this.eventPolicy(state, intent.intentType, agentRole, null);
    if (policy.effectHandlerId !== "visitor_correction_v1") {
      throw new InvalidWorldActionError("事实更正事件策略处理器不受支持");
    }
    const candidate = this.candidate({
      eventType: policy.eventType,
      title: policy.title,
      triggerReason: intent.rationaleSummary,
      competencyTarget: policy.competencyTarget,
      expectedImpact: policy.expectedImpact.replace("经去重值", correctedValue),
      payload: { fact: correctedFact, supersedesFactId, nextNodeId },
      proposedBy: intent.actorId,
      approvalPolicyId: policy.approvalPolicyId,
      now,
    });
    intentDraft.payload = { taskId: task.taskId, intent, candidateId: candidate.candidateId };
    return this.commit(
      task.sessionId,
      state.stateVersion,
      [
        traceDraft,
        intentDraft,
        {
          eventType: "candidate_event_proposed",
          actorId: "system",
          summary: `世界内核已将智能体意图转换为候选：${candidate.title}`,
          visibility: teacherVisibility,
          payload: { candidate, sourceIntentId: intent.intentId, taskId: task.taskId },
        },
        this.messageDraft({
          actorId: agentRole.agentId,
          roleId: agentRole.roleId,
          displayName: agentRole.displayName,
          content: `${intent.rationaleSummary} 更正候选已提交，请等待教师投放后发起二次核验。`,
          visibility: ["role_private", "audit_only"],
          visibleToActorIds: ["student-editor"],
          now,
        }),
      ],
      task.correlationId,
      state.sessionEpoch,
      task.causalDepth + 1,
      task.actionContext,
    );
  }

  private requestVerification(state: WorldState, command: Command): EventDraft[] {
    if (!hasEvent(state, "world_fact_updated")) throw new InvalidWorldActionError("客流更正尚未获批，不能发起二次核验");
    if (hasEvidenceAction(state, "请求二次核验")) throw new InvalidWorldActionError("二次核验已请求");
    const evidence = this.evidence(state, command, {
      nodeId: "verification",
      action: "请求二次核验",
      basis: "客流数据从18,000更正为12,600，需以原始去重表和独立信源复核",
      materialRefs: ["material-visitor-sheet"],
      eventRefs: latestEventId(state, "world_fact_updated"),
    });
    return [
      { eventType: "verification_requested", actorId: command.actorId, summary: "责任编辑已请求对更正客流进行二次核验", visibility: assignedVisibility, payload: { factId: "fact-visitors-v2", virtualMinute: 10 } },
      { eventType: "evidence_recorded", actorId: "system", summary: "二次核验请求已形成过程证据", visibility: assignedVisibility, payload: { evidence } },
    ];
  }

  private requestMediaProcessing(
    state: WorldState,
    role: RoleContract,
    command: Command,
  ): EventDraft[] {
    const payload = RequestMediaProcessingPayloadSchema.parse(command.payload);
    const config = state.scenario.productionConfig;
    if (!config) throw new InvalidWorldActionError("当前固定情境包没有启用内容生产配置");
    const repeated = state.mediaProcessingTasks.find((task) => task.requestId === payload.requestId);
    if (repeated) {
      if (repeated.materialId !== payload.materialId || repeated.planId !== payload.planId) {
        throw new InvalidWorldActionError("同一请求标识已经绑定不同的多模态处理输入");
      }
      return [];
    }
    const material = state.materials.find((item) => item.materialId === payload.materialId);
    if (!material || (role.actorKind !== "teacher" && !material.visibleToRoles.includes(role.roleId))) {
      throw new PermissionDeniedError("该岗位无权处理指定素材");
    }
    const plan = config.processingPlans.find((item) => item.planId === payload.planId);
    if (!plan || !plan.allowedMediaTypes.includes(material.mediaType)) {
      throw new InvalidWorldActionError("处理档案不存在或不支持该素材类型");
    }
    const duplicate = state.mediaProcessingTasks.find((task) => (
      task.sessionEpoch === state.sessionEpoch
      && task.materialId === material.materialId
      && task.materialVersion === material.version
      && task.planId === plan.planId
    ));
    if (duplicate) {
      throw new InvalidWorldActionError(`该素材版本已经存在处理任务：${duplicate.taskId}`);
    }
    const now = this.#clock.now();
    const taskId = this.#ids.next("media-task");
    const inputContentHash = material.contentHash ?? hashValue({
      sourceRef: material.sourceRef,
      mediaType: material.mediaType,
      version: material.version,
    });
    const audience = materialDerivedAudience({
      state,
      role,
      material,
    });
    const task = MediaProcessingTaskSchema.parse({
      taskId,
      sessionId: state.sessionId,
      sessionEpoch: state.sessionEpoch,
      materialId: material.materialId,
      materialVersion: material.version,
      inputRef: material.sourceRef,
      inputContentHash,
      planId: plan.planId,
      requestId: payload.requestId,
      status: "queued",
      steps: plan.capabilities.map((capability, index) => ({
        stepId: `${taskId}:step:${index + 1}:${capability}`,
        capability,
        status: "queued",
        attempts: 0,
        maxAttempts: plan.maxAttemptsPerStep,
        idempotencyKey: `${state.sessionEpoch}:${inputContentHash}:${plan.planId}:${capability}`,
        output: null,
        lastErrorCode: null,
        startedAt: null,
        completedAt: null,
      })),
      requestedBy: role.agentId,
      requestedAt: now,
      idempotencyKey: `${state.sessionEpoch}:${inputContentHash}:${plan.planId}`,
      startedAt: null,
      completedAt: null,
      updatedAt: now,
      audience,
    });
    const evidence = this.evidence(state, command, {
      nodeId: "production",
      action: "发起异步多模态处理",
      basis: `按固定处理档案“${plan.label}”执行；技术成功只形成待核验观察，不直接形成世界事实`,
      materialRefs: [material.materialId],
      processingTaskRefs: [task.taskId],
    });
    return [
      {
        eventType: "media_processing_requested",
        actorId: role.agentId,
        summary: `异步处理任务已排队：${material.title} · ${plan.label}`,
        visibility: assignedVisibility,
        audience,
        payload: { task, planId: plan.planId, inputContentHash },
      },
      {
        eventType: "evidence_recorded",
        actorId: "system",
        summary: "多模态处理请求已形成过程证据",
        visibility: assignedVisibility,
        audience,
        payload: { evidence },
      },
      {
        eventType: "node_activated",
        actorId: "system",
        summary: "进入组织融媒内容节点",
        visibility: assignedVisibility,
        audience,
        payload: { nodeId: "production", virtualMinute: Math.max(state.virtualMinute, 12) },
      },
    ];
  }

  private requestGovernanceReview(
    state: WorldState,
    role: RoleContract,
    command: Command,
  ): EventDraft[] {
    const payload = RequestGovernanceReviewPayloadSchema.parse(command.payload);
    const plan = state.scenario.productionConfig?.governancePlan;
    if (!plan) {
      throw new InvalidWorldActionError(
        "当前固定情境包没有启用并行治理计划",
      );
    }
    const repeated = state.governanceReviews.find(
      (review) => review.requestId === payload.requestId,
    );
    if (repeated) {
      if (repeated.materialId !== payload.materialId) {
        throw new InvalidWorldActionError(
          "同一请求标识已经绑定不同的治理材料",
        );
      }
      return [];
    }
    const material = state.materials.find(
      (item) => item.materialId === payload.materialId,
    );
    if (
      !material
      || (
        role.actorKind !== "teacher"
        && !material.visibleToRoles.includes(role.roleId)
      )
    ) {
      throw new PermissionDeniedError("该岗位无权治理指定素材");
    }
    const duplicate = state.governanceReviews.find((review) => (
      review.sessionEpoch === state.sessionEpoch
      && review.materialId === material.materialId
      && review.materialVersion === material.version
    ));
    if (duplicate) {
      throw new InvalidWorldActionError(
        `该素材版本已经存在治理复核：${duplicate.reviewId}`,
      );
    }
    const now = this.#clock.now();
    const inputContentHash = material.contentHash ?? hashValue({
      sourceRef: material.sourceRef,
      mediaType: material.mediaType,
      version: material.version,
    });
    const reviewId = this.#ids.next("governance-review");
    const taskId = this.#ids.next("media-task");
    const audience = materialDerivedAudience({
      state,
      role,
      material,
    });
    const task = MediaProcessingTaskSchema.parse({
      taskId,
      sessionId: state.sessionId,
      sessionEpoch: state.sessionEpoch,
      materialId: material.materialId,
      materialVersion: material.version,
      inputRef: material.sourceRef,
      inputContentHash,
      planId: plan.planId,
      governanceReviewId: reviewId,
      requestId: payload.requestId,
      status: "queued",
      steps: plan.branches.map((branch, index) => {
        const capability = branch.capabilityByMediaType[material.mediaType];
        return {
          stepId: [
            taskId,
            "governance",
            index + 1,
            branch.domain,
            capability,
          ].join(":"),
          capability,
          governanceDomain: branch.domain,
          governanceNode: branch.node,
          branchPriority: branch.priority,
          timeoutMs: plan.timeoutMsPerBranch,
          requestedProviderMode: null,
          effectiveProviderMode: null,
          status: "queued",
          attempts: 0,
          maxAttempts: plan.maxAttemptsPerBranch,
          idempotencyKey: [
            state.sessionEpoch,
            inputContentHash,
            plan.planId,
            branch.domain,
            capability,
          ].join(":"),
          output: null,
          lastErrorCode: null,
          startedAt: null,
          completedAt: null,
        };
      }),
      requestedBy: role.agentId,
      requestedAt: now,
      idempotencyKey: [
        state.sessionEpoch,
        inputContentHash,
        plan.planId,
        reviewId,
      ].join(":"),
      startedAt: null,
      completedAt: null,
      updatedAt: now,
      audience,
    });
    const review = GovernanceReviewSchema.parse({
      reviewId,
      sessionId: state.sessionId,
      sessionEpoch: state.sessionEpoch,
      materialId: material.materialId,
      materialVersion: material.version,
      inputContentHash,
      mediaTaskId: task.taskId,
      requestId: payload.requestId,
      requestedBy: role.agentId,
      requestedAt: now,
      status: "running",
      arbitrationRevision: 0,
      policyVersion: governancePolicyVersion,
      verdict: "pending",
      conflict: false,
      branchDomains: plan.branches.map((branch) => branch.domain),
      latestFindingIds: [],
      winningFindingId: null,
      findingSetHash: null,
      decisionHash: null,
      arbitratedAt: null,
      reviewDecision: null,
      reviewedBy: null,
      reviewedAt: null,
      reviewNote: null,
      audience,
    });
    const evidence = this.evidence(state, command, {
      nodeId: "copyright",
      action: "发起四域并行治理",
      basis: `固定材料版本与哈希，由事实、版权、内容安全、平台规则 ${plan.branches.length} 个独立专业分支并行发现；仲裁仅形成待教师复核建议`,
      materialRefs: [material.materialId],
      processingTaskRefs: [task.taskId],
    });
    return [
      {
        eventType: "governance_review_requested",
        actorId: role.agentId,
        summary: `已固定材料并发起四域治理：${material.title}`,
        visibility: assignedVisibility,
        audience,
        payload: { review, planId: plan.planId, inputContentHash },
      },
      {
        eventType: "media_processing_requested",
        actorId: role.agentId,
        summary: `治理专业分支已全部持久化：${plan.label}`,
        visibility: assignedVisibility,
        audience,
        payload: { task, planId: plan.planId, inputContentHash },
      },
      {
        eventType: "evidence_recorded",
        actorId: "system",
        summary: "并行治理请求已形成过程证据",
        visibility: assignedVisibility,
        audience,
        payload: { evidence },
      },
    ];
  }

  private reviewGovernance(
    state: WorldState,
    role: RoleContract,
    command: Command,
  ): EventDraft[] {
    if (role.actorKind !== "teacher") {
      throw new PermissionDeniedError("只有教师可以复核治理仲裁");
    }
    const payload = ReviewGovernancePayloadSchema.parse(command.payload);
    const repeated = state.events.find((event) => (
      event.eventType === "governance_reviewed"
      && event.payload.requestId === payload.requestId
    ));
    if (repeated) {
      const prior = GovernanceReviewSchema.parse(repeated.payload.review);
      if (
        prior.reviewId !== payload.reviewId
        || prior.reviewDecision !== payload.decision
        || prior.arbitrationRevision
          !== payload.expectedArbitrationRevision
        || prior.decisionHash !== payload.expectedDecisionHash
        || prior.reviewNote !== payload.reviewNote
      ) {
        throw new InvalidWorldActionError(
          "同一请求标识已经绑定不同的治理复核决定",
        );
      }
      return [];
    }
    const review = state.governanceReviews.find(
      (item) => item.reviewId === payload.reviewId,
    );
    if (!review) throw new InvalidWorldActionError("治理复核不存在");
    if (
      review.status !== "awaiting_teacher"
      || review.arbitrationRevision !== payload.expectedArbitrationRevision
      || !review.decisionHash
      || review.decisionHash !== payload.expectedDecisionHash
    ) {
      throw new InvalidWorldActionError(
        "治理仲裁版本或决策哈希已经变化，请刷新后复核最新结果",
      );
    }
    if (
      payload.decision === "approve"
      && !isGovernanceVerdictReleasable(review.verdict)
    ) {
      throw new InvalidWorldActionError(
        "阻断或降级治理结论不能批准放行；请驳回、重试失败分支或形成新的材料版本",
      );
    }
    const now = this.#clock.now();
    const reviewed = GovernanceReviewSchema.parse({
      ...review,
      status: payload.decision === "approve" ? "approved" : "rejected",
      reviewDecision: payload.decision,
      reviewedBy: role.agentId,
      reviewedAt: now,
      reviewNote: payload.reviewNote,
    });
    const evidence = this.evidence(state, command, {
      nodeId: "copyright",
      action: payload.decision === "approve"
        ? "教师批准治理仲裁"
        : "教师驳回治理仲裁",
      basis: `固定治理复核 ${review.reviewId} · R${review.arbitrationRevision} · ${review.decisionHash.slice(0, 12)}；教师复核说明保留在教师审计视野`,
      materialRefs: [review.materialId],
      processingTaskRefs: [review.mediaTaskId],
    });
    return [
      {
        eventType: "governance_reviewed",
        actorId: role.agentId,
        summary: payload.decision === "approve"
          ? "教师已批准精确治理仲裁"
          : "教师已驳回精确治理仲裁",
        visibility: assignedVisibility,
        audience: review.audience,
        payload: {
          review: reviewed,
          requestId: payload.requestId,
          decisionHash: review.decisionHash,
        },
      },
      {
        eventType: "evidence_recorded",
        actorId: role.agentId,
        summary: "治理教师门决定已形成过程证据",
        visibility: assignedVisibility,
        audience: review.audience,
        payload: { evidence },
      },
    ];
  }

  private retryMediaProcessing(
    state: WorldState,
    role: RoleContract,
    command: Command,
  ): EventDraft[] {
    const payload = RetryMediaProcessingPayloadSchema.parse(command.payload);
    const repeated = state.events.find((event) => (
      event.eventType === "media_processing_retry_requested"
      && event.payload.requestId === payload.requestId
    ));
    if (repeated) {
      if (repeated.payload.taskId !== payload.taskId) {
        throw new InvalidWorldActionError("同一请求标识已经绑定不同的处理任务");
      }
      return [];
    }
    const task = state.mediaProcessingTasks.find((item) => item.taskId === payload.taskId);
    if (!task) throw new InvalidWorldActionError("多模态处理任务不存在");
    if (!authorizeResource(
      createAccessSubject({
        role,
        sessionId: state.sessionId,
        sessionEpoch: state.sessionEpoch,
        courseId: state.scenario.courseId,
        purpose: role.actorKind === "teacher" ? "audit" : "runtime",
      }),
      task.audience,
    ).allowed) {
      throw new PermissionDeniedError("该岗位无权重试此处理任务");
    }
    if (task.status !== "failed" && task.status !== "partially_succeeded") {
      throw new InvalidWorldActionError("只有失败或部分成功的任务可以重试");
    }
    const retryable = task.steps.filter((step) => (
      step.status === "failed" && step.attempts < step.maxAttempts
    ));
    if (retryable.length === 0) {
      throw new InvalidWorldActionError("没有仍可自动重试的失败步骤，请人工补录并保留未核验标记");
    }
    const governanceReview = task.governanceReviewId
      ? state.governanceReviews.find(
          (review) => review.reviewId === task.governanceReviewId,
        )
      : null;
    if (
      governanceReview
      && (
        governanceReview.status === "approved"
        || governanceReview.status === "rejected"
      )
    ) {
      throw new InvalidWorldActionError(
        "教师已经完成该治理版本复核，不能原地重试；请创建新的材料版本",
      );
    }
    const reopenedReview = governanceReview
      ? GovernanceReviewSchema.parse({
          ...governanceReview,
          status: "running",
          verdict: "pending",
          conflict: false,
          latestFindingIds: [],
          winningFindingId: null,
          findingSetHash: null,
          decisionHash: null,
          arbitratedAt: null,
          reviewDecision: null,
          reviewedBy: null,
          reviewedAt: null,
          reviewNote: null,
        })
      : null;
    return [
      ...(reopenedReview ? [{
        eventType: "governance_review_reopened" as const,
        actorId: role.agentId,
        summary: `治理复核已重新打开，仅重试 ${retryable.length} 个失败分支`,
        visibility: assignedVisibility,
        audience: task.audience,
        payload: {
          review: reopenedReview,
          requestId: payload.requestId,
          priorArbitrationRevision: governanceReview?.arbitrationRevision,
        },
      }] : []),
      {
        eventType: "media_processing_retry_requested",
        actorId: role.agentId,
        summary: `仅重试 ${retryable.length} 个失败处理步骤`,
        visibility: assignedVisibility,
        audience: task.audience,
        payload: {
          taskId: task.taskId,
          stepIds: retryable.map((step) => step.stepId),
          requestId: payload.requestId,
        },
      },
    ];
  }

  private supplyMediaProcessingResult(
    state: WorldState,
    role: RoleContract,
    command: Command,
  ): EventDraft[] {
    const payload = SupplyMediaProcessingResultPayloadSchema.parse(command.payload);
    const repeated = state.events.find((event) => (
      event.eventType === "media_processing_manual_supplied"
      && event.payload.requestId === payload.requestId
    ));
    if (repeated) {
      if (
        repeated.payload.taskId !== payload.taskId
        || repeated.payload.stepId !== payload.stepId
      ) {
        throw new InvalidWorldActionError("同一请求标识已经绑定不同的人工补录步骤");
      }
      return [];
    }
    const task = state.mediaProcessingTasks.find((item) => item.taskId === payload.taskId);
    if (!task) throw new InvalidWorldActionError("多模态处理任务不存在");
    const subject = createAccessSubject({
      role,
      sessionId: state.sessionId,
      sessionEpoch: state.sessionEpoch,
      courseId: state.scenario.courseId,
      purpose: role.actorKind === "teacher" ? "audit" : "runtime",
    });
    if (!authorizeResource(subject, task.audience).allowed) {
      throw new PermissionDeniedError("该岗位无权补录此处理任务");
    }
    const governanceReview = task.governanceReviewId
      ? state.governanceReviews.find(
          (review) => review.reviewId === task.governanceReviewId,
        )
      : null;
    if (task.governanceReviewId && !governanceReview) {
      throw new InvalidWorldActionError("治理任务缺少对应复核对象");
    }
    if (
      governanceReview
      && (
        governanceReview.status === "approved"
        || governanceReview.status === "rejected"
      )
    ) {
      throw new InvalidWorldActionError(
        "教师已经完成该治理版本复核，不能原地人工补录",
      );
    }
    const step = task.steps.find((item) => item.stepId === payload.stepId);
    if (!step || step.status !== "failed") {
      throw new InvalidWorldActionError("人工补录只能附加到明确失败的步骤，不能覆盖成功输出");
    }
    const now = this.#clock.now();
    const output = MediaProcessingOutputSchema.parse({
      outputId: this.#ids.next("media-output"),
      capability: step.capability,
      provider: "human-supplement",
      providerMode: "manual",
      summary: payload.summary,
      extracted: {
        provenance: "human",
        suppliedBy: role.agentId,
      },
      sourceRef: `manual://${task.taskId}/${step.stepId}/${payload.requestId}`,
      confidence: 0,
      trust: "manual_unverified",
      verificationStatus: "pending_review",
      providerRequestId: null,
      createdAt: now,
    });
    const nextTask: MediaProcessingTask = {
      ...task,
      steps: task.steps.map((item) => item.stepId === step.stepId
        ? { ...item, status: "manually_completed", output }
        : item),
    };
    const status = settledProcessingStatus(nextTask);
    const evidence = this.evidence(state, command, {
      nodeId: "production",
      action: "人工补录处理结果",
      basis: "工具步骤失败后追加人工来源；该结果保持待复核，不冒充讯飞输出或经核验事实",
      materialRefs: [task.materialId],
      processingTaskRefs: [task.taskId],
    });
    if (governanceReview) {
      const reopenedReview = GovernanceReviewSchema.parse({
        ...governanceReview,
        status: "running",
        verdict: "pending",
        conflict: false,
        latestFindingIds: [],
        winningFindingId: null,
        findingSetHash: null,
        decisionHash: null,
        arbitratedAt: null,
        reviewDecision: null,
        reviewedBy: null,
        reviewedAt: null,
        reviewNote: null,
      });
      return [
        {
          eventType: "governance_review_reopened",
          actorId: role.agentId,
          summary: "治理复核因人工补录重新打开",
          visibility: assignedVisibility,
          audience: task.audience,
          payload: {
            review: reopenedReview,
            requestId: payload.requestId,
            priorArbitrationRevision: governanceReview.arbitrationRevision,
          },
        },
        {
          eventType: "media_processing_retry_requested",
          actorId: role.agentId,
          summary: "失败治理分支已转入人工补录",
          visibility: assignedVisibility,
          audience: task.audience,
          payload: {
            taskId: task.taskId,
            stepIds: [step.stepId],
            requestId: `${payload.requestId}:manual-reopen`,
          },
        },
        {
          eventType: "media_processing_manual_supplied",
          actorId: role.agentId,
          summary: `人工补录已附加到失败治理分支：${step.governanceDomain ?? step.capability}`,
          visibility: assignedVisibility,
          audience: task.audience,
          payload: {
            taskId: task.taskId,
            stepId: step.stepId,
            requestId: payload.requestId,
            output,
          },
        },
        {
          eventType: "evidence_recorded",
          actorId: "system",
          summary: "治理人工补录已形成独立过程证据",
          visibility: assignedVisibility,
          audience: task.audience,
          payload: { evidence },
        },
      ];
    }
    return [
      {
        eventType: "media_processing_manual_supplied",
        actorId: role.agentId,
        summary: `人工补录已附加到失败步骤：${step.capability}`,
        visibility: assignedVisibility,
        audience: task.audience,
        payload: {
          taskId: task.taskId,
          stepId: step.stepId,
          requestId: payload.requestId,
          output,
        },
      },
      {
        eventType: "media_processing_completed",
        actorId: "system",
        summary: status === "succeeded"
          ? "处理档案已结束；其中人工补录仍待复核"
          : "处理档案保留部分成功与失败状态",
        visibility: assignedVisibility,
        audience: task.audience,
        payload: { taskId: task.taskId, status },
      },
      {
        eventType: "evidence_recorded",
        actorId: "system",
        summary: "人工补录已形成独立过程证据",
        visibility: assignedVisibility,
        audience: task.audience,
        payload: { evidence },
      },
    ];
  }

  private artifactSections(
    template: ProductionArtifactTemplate,
    inputSections: Array<{ sectionId: string; content: string }>,
  ): ArtifactRevision["sections"] {
    const supplied = new Map<string, string>();
    for (const section of inputSections) {
      if (supplied.has(section.sectionId)) {
        throw new InvalidWorldActionError(`成果章节重复：${section.sectionId}`);
      }
      supplied.set(section.sectionId, section.content);
    }
    for (const sectionId of supplied.keys()) {
      if (!template.sections.some((section) => section.sectionId === sectionId)) {
        throw new InvalidWorldActionError(`成果模板不允许章节：${sectionId}`);
      }
    }
    return template.sections.map((definition) => {
      const content = supplied.get(definition.sectionId) ?? "";
      if (definition.required && content.trim().length === 0) {
        throw new InvalidWorldActionError(`成果必填章节为空：${definition.label}`);
      }
      if (content.length > definition.maxLength) {
        throw new InvalidWorldActionError(`成果章节超出长度上限：${definition.label}`);
      }
      return {
        sectionId: definition.sectionId,
        label: definition.label,
        content,
      };
    });
  }

  private artifactCitations(
    state: WorldState,
    role: RoleContract,
    inputs: ArtifactCitationInput[],
  ): ArtifactCitation[] {
    const subject = createAccessSubject({
      role,
      sessionId: state.sessionId,
      sessionEpoch: state.sessionEpoch,
      courseId: state.scenario.courseId,
      purpose: role.actorKind === "teacher" ? "audit" : "runtime",
    });
    const seen = new Set<string>();
    return inputs.map((input) => {
      const key = `${input.sourceKind}:${input.sourceId}`;
      if (seen.has(key)) throw new InvalidWorldActionError(`成果引用重复：${key}`);
      seen.add(key);
      if (input.sourceKind === "material") {
        const material = state.materials.find((item) => item.materialId === input.sourceId);
        if (!material || (role.actorKind !== "teacher" && !material.visibleToRoles.includes(role.roleId))) {
          throw new PermissionDeniedError("成果引用了当前岗位不可见的素材");
        }
        return {
          citationId: this.#ids.next("citation"),
          sourceKind: input.sourceKind,
          sourceId: material.materialId,
          label: material.title,
          version: material.version,
          locator: input.locator,
          trust: material.copyrightStatus === "disputed" ? "disputed" as const : "source_material" as const,
        };
      }
      if (input.sourceKind === "fact") {
        const fact = state.facts.find((item) => item.factId === input.sourceId);
        if (!fact) throw new InvalidWorldActionError("成果引用的世界事实不存在");
        const audience = fact.audience ?? resourceAudience({
          scenario: state.scenario,
          sessionId: state.sessionId,
          sessionEpoch: state.sessionEpoch,
          visibility: [fact.visibility, "audit_only"],
          actorId: "system",
        });
        if (!authorizeResource(subject, audience).allowed) {
          throw new PermissionDeniedError("成果引用了当前岗位不可见的世界事实");
        }
        return {
          citationId: this.#ids.next("citation"),
          sourceKind: input.sourceKind,
          sourceId: fact.factId,
          label: fact.statement,
          version: fact.version,
          locator: input.locator,
          trust: fact.status === "verified"
            ? "verified_world_fact" as const
            : fact.status === "disputed"
              ? "disputed" as const
              : "source_material" as const,
        };
      }
      if (input.sourceKind === "observation") {
        const observation = state.observations.find(
          (item) => item.observationId === input.sourceId,
        );
        const material = observation
          ? state.materials.find((item) => item.materialId === observation.materialId)
          : null;
        if (
          !observation
          || !material
          || (role.actorKind !== "teacher" && !material.visibleToRoles.includes(role.roleId))
        ) {
          throw new PermissionDeniedError("成果引用了当前岗位不可见的机器观察");
        }
        return {
          citationId: this.#ids.next("citation"),
          sourceKind: input.sourceKind,
          sourceId: observation.observationId,
          label: observation.summary,
          version: `${observation.provider}@${observation.timestamp}`,
          locator: input.locator,
          trust: "machine_observation" as const,
        };
      }
      if (input.sourceKind === "processing_output") {
        const task = state.mediaProcessingTasks.find((item) => (
          item.steps.some((step) => step.output?.outputId === input.sourceId)
        ));
        const output = task?.steps.find(
          (step) => step.output?.outputId === input.sourceId,
        )?.output;
        if (!task || !output || !authorizeResource(subject, task.audience).allowed) {
          throw new PermissionDeniedError("成果引用了当前岗位不可见或不存在的处理输出");
        }
        return {
          citationId: this.#ids.next("citation"),
          sourceKind: input.sourceKind,
          sourceId: output.outputId,
          label: output.summary,
          version: `${task.materialVersion}/${output.capability}/${output.providerMode}`,
          locator: input.locator,
          trust: output.trust === "manual_unverified"
            ? "manual_unverified" as const
            : "machine_observation" as const,
        };
      }
      const chunk = state.scenario.knowledgeChunks.find(
        (item) => item.chunkId === input.sourceId && item.status === "active",
      );
      if (!chunk || !authorizeResource(subject, chunk.audience).allowed) {
        throw new PermissionDeniedError("成果引用了当前岗位不可见或已撤销的知识片段");
      }
      return {
        citationId: this.#ids.next("citation"),
        sourceKind: input.sourceKind,
        sourceId: chunk.chunkId,
        label: chunk.title,
        version: chunk.version,
        locator: input.locator,
        trust: "reviewed_reference" as const,
      };
    });
  }

  private validateArtifactRevision(
    template: ProductionArtifactTemplate,
    sections: ArtifactRevision["sections"],
    citations: ArtifactCitation[],
  ): void {
    if (citations.length < template.minimumCitations) {
      throw new InvalidWorldActionError(
        `成果至少需要 ${template.minimumCitations} 个有效引用`,
      );
    }
    if (
      template.requiresVerifiedFact
      && !citations.some((citation) => citation.trust === "verified_world_fact")
    ) {
      throw new InvalidWorldActionError("该成果必须引用至少一条经审核世界事实");
    }
    for (const definition of template.sections) {
      const section = sections.find((item) => item.sectionId === definition.sectionId);
      if (definition.required && !section?.content.trim()) {
        throw new InvalidWorldActionError(`成果必填章节为空：${definition.label}`);
      }
    }
  }

  private createProductionArtifact(
    state: WorldState,
    role: RoleContract,
    command: Command,
  ): EventDraft[] {
    const payload = CreateProductionArtifactPayloadSchema.parse(command.payload);
    const template = artifactTemplate(state, payload.templateId);
    if (!template.allowedRoleIds.includes(role.roleId)) {
      throw new PermissionDeniedError("当前岗位无权创建此类成果");
    }
    const sections = this.artifactSections(template, payload.sections);
    const canonicalContent = {
      templateId: payload.templateId,
      title: payload.title,
      summary: payload.summary,
      sections: payload.sections,
      citations: payload.citations,
      revisionNote: payload.revisionNote,
    };
    const contentHash = hashValue(canonicalContent);
    const repeated = state.productionArtifacts.find(
      (artifact) => artifact.creationRequestId === payload.requestId,
    );
    if (repeated) {
      const revision = state.artifactRevisions.find(
        (item) => item.revisionId === repeated.latestRevisionId,
      );
      if (
        repeated.templateId !== payload.templateId
        || revision?.contentHash !== contentHash
      ) {
        throw new InvalidWorldActionError("同一请求标识已经绑定不同的成果内容");
      }
      return [];
    }
    if (template.kind !== "interview_record" && !hasUsableProcessingOutput(state)) {
      throw new InvalidWorldActionError("至少需要一个已完成或人工补录的多模态处理输出");
    }
    const citations = this.artifactCitations(state, role, payload.citations);
    this.validateArtifactRevision(template, sections, citations);
    const now = this.#clock.now();
    const artifactId = this.#ids.next("artifact");
    const revisionId = this.#ids.next("artifact-revision");
    const audience = resourceAudience({
      scenario: state.scenario,
      sessionId: state.sessionId,
      sessionEpoch: state.sessionEpoch,
      visibility: assignedVisibility,
      actorId: role.agentId,
      payload: { teamId: role.teamId },
    });
    const artifact = ProductionArtifactSchema.parse({
      artifactId,
      templateId: template.templateId,
      creationRequestId: payload.requestId,
      kind: template.kind,
      title: payload.title,
      channel: template.channel,
      ownerActorId: role.agentId,
      ownerRoleId: role.roleId,
      teamId: role.teamId,
      status: "draft",
      latestRevisionId: revisionId,
      revisionCount: 1,
      createdAt: now,
      updatedAt: now,
      audience,
    });
    const revision = ArtifactRevisionSchema.parse({
      revisionId,
      artifactId,
      revisionNumber: 1,
      previousRevisionId: null,
      title: payload.title,
      summary: payload.summary,
      sections,
      citations,
      revisionNote: payload.revisionNote,
      contentHash,
      authorActorId: role.agentId,
      requestId: payload.requestId,
      createdAt: now,
      audience,
    });
    const evidence = this.evidence(state, command, {
      nodeId: "production",
      action: "创建融媒体成果初稿",
      basis: `按固定模板“${template.label}”保存不可变修订 R1，并关联可追溯引用`,
      materialRefs: citations
        .filter((citation) => citation.sourceKind === "material")
        .map((citation) => citation.sourceId),
      observationRefs: citations
        .filter((citation) => citation.sourceKind === "observation")
        .map((citation) => citation.sourceId),
      artifactRevisionRefs: [revision.revisionId],
      processingTaskRefs: state.mediaProcessingTasks
        .filter((task) => task.steps.some((step) => (
          step.output && citations.some((citation) => citation.sourceId === step.output?.outputId)
        )))
        .map((task) => task.taskId),
    });
    return [
      {
        eventType: "production_artifact_created",
        actorId: role.agentId,
        summary: `已创建${template.label}：${artifact.title} · R1`,
        visibility: assignedVisibility,
        audience,
        payload: { artifact, revision },
      },
      {
        eventType: "evidence_recorded",
        actorId: "system",
        summary: "成果初稿与引用已形成过程证据",
        visibility: assignedVisibility,
        audience,
        payload: { evidence },
      },
    ];
  }

  private saveArtifactRevision(
    state: WorldState,
    role: RoleContract,
    command: Command,
  ): EventDraft[] {
    const payload = SaveArtifactRevisionPayloadSchema.parse(command.payload);
    const artifact = state.productionArtifacts.find(
      (item) => item.artifactId === payload.artifactId,
    );
    if (!artifact) throw new InvalidWorldActionError("成果对象不存在");
    if (artifact.ownerActorId !== role.agentId || artifact.ownerRoleId !== role.roleId) {
      throw new PermissionDeniedError("只有成果所属岗位可以保存新修订");
    }
    if (artifact.status !== "draft") throw new InvalidWorldActionError("已提交成果不能覆盖或追加修订");
    const template = artifactTemplate(state, artifact.templateId);
    const sections = this.artifactSections(template, payload.sections);
    const canonicalContent = {
      artifactId: payload.artifactId,
      title: payload.title,
      summary: payload.summary,
      sections: payload.sections,
      citations: payload.citations,
      revisionNote: payload.revisionNote,
    };
    const contentHash = hashValue(canonicalContent);
    const repeated = state.artifactRevisions.find(
      (revision) => revision.requestId === payload.requestId,
    );
    if (repeated) {
      if (repeated.artifactId !== artifact.artifactId || repeated.contentHash !== contentHash) {
        throw new InvalidWorldActionError("同一请求标识已经绑定不同的成果修订");
      }
      return [];
    }
    if (payload.expectedRevisionNumber !== artifact.revisionCount) {
      throw new InvalidWorldActionError(
        `成果修订冲突：当前 R${artifact.revisionCount}，请求基于 R${payload.expectedRevisionNumber}`,
      );
    }
    const citations = this.artifactCitations(state, role, payload.citations);
    this.validateArtifactRevision(template, sections, citations);
    const now = this.#clock.now();
    const revisionId = this.#ids.next("artifact-revision");
    const revision = ArtifactRevisionSchema.parse({
      revisionId,
      artifactId: artifact.artifactId,
      revisionNumber: artifact.revisionCount + 1,
      previousRevisionId: artifact.latestRevisionId,
      title: payload.title,
      summary: payload.summary,
      sections,
      citations,
      revisionNote: payload.revisionNote,
      contentHash,
      authorActorId: role.agentId,
      requestId: payload.requestId,
      createdAt: now,
      audience: artifact.audience,
    });
    const updatedArtifact = ProductionArtifactSchema.parse({
      ...artifact,
      title: payload.title,
      latestRevisionId: revisionId,
      revisionCount: revision.revisionNumber,
      updatedAt: now,
    });
    const evidence = this.evidence(state, command, {
      nodeId: "production",
      action: "保存成果新修订",
      basis: `基于 R${artifact.revisionCount} 保存 R${revision.revisionNumber}，旧版本保持不可变并可比较`,
      materialRefs: citations
        .filter((citation) => citation.sourceKind === "material")
        .map((citation) => citation.sourceId),
      observationRefs: citations
        .filter((citation) => citation.sourceKind === "observation")
        .map((citation) => citation.sourceId),
      artifactRevisionRefs: [revision.revisionId, artifact.latestRevisionId],
      processingTaskRefs: state.mediaProcessingTasks
        .filter((task) => task.steps.some((step) => (
          step.output && citations.some((citation) => citation.sourceId === step.output?.outputId)
        )))
        .map((task) => task.taskId),
    });
    return [
      {
        eventType: "artifact_revision_saved",
        actorId: role.agentId,
        summary: `成果已保存为不可变修订 R${revision.revisionNumber}`,
        visibility: assignedVisibility,
        audience: artifact.audience,
        payload: { artifact: updatedArtifact, revision },
      },
      {
        eventType: "evidence_recorded",
        actorId: "system",
        summary: `成果 R${revision.revisionNumber} 与差异说明已入证据链`,
        visibility: assignedVisibility,
        audience: artifact.audience,
        payload: { evidence },
      },
    ];
  }

  private markCopyrightRisk(state: WorldState, command: Command): EventDraft[] {
    if (!hasEvent(state, "copyright_risk_flagged")) throw new InvalidWorldActionError("版权申诉事件尚未获批");
    if (hasEvidenceAction(state, "标记版权风险")) throw new InvalidWorldActionError("版权风险已经标记");
    const evidence = this.evidence(state, command, {
      nodeId: "copyright",
      action: "标记版权风险",
      basis: "授权说明未覆盖商业信息流渠道，按最小充分授权原则冻结图片",
      materialRefs: ["material-festival-photo", "material-license-note"],
      eventRefs: latestEventId(state, "copyright_risk_flagged"),
    });
    return [
      { eventType: "evidence_recorded", actorId: "system", summary: "版权风险处置形成过程证据", visibility: assignedVisibility, payload: { evidence, virtualMinute: 18 } },
    ];
  }

  private pausePublication(state: WorldState, command: Command): EventDraft[] {
    const platformApproved = state.candidates.some((candidate) => candidate.eventType === "node_activated" && candidate.status === "approved");
    if (!platformApproved) throw new InvalidWorldActionError("平台审核升级尚未获批");
    if (hasEvent(state, "publication_paused")) throw new InvalidWorldActionError("发布已经暂停");
    const evidence = this.evidence(state, command, {
      nodeId: "release",
      action: "暂缓发布",
      basis: "平台已转人工审核且图片授权存在争议，先冻结版本可避免不可逆发布",
      materialRefs: ["material-festival-photo", "material-license-note"],
      eventRefs: latestEventId(state, "node_activated"),
    });
    return [
      { eventType: "publication_paused", actorId: command.actorId, summary: "责任编辑暂缓发布并冻结待审版本", visibility: assignedVisibility, payload: { releaseVersion: "draft-0.3", virtualMinute: 29 } },
      { eventType: "evidence_recorded", actorId: "system", summary: "发布决策形成过程证据", visibility: assignedVisibility, payload: { evidence } },
    ];
  }

  private submitForReview(
    state: WorldState,
    role: RoleContract,
    command: Command,
  ): EventDraft[] {
    if (!hasEvent(state, "publication_paused")) throw new InvalidWorldActionError("必须先完成风险发布决策");
    let submission: ProductionSubmission | null = null;
    let submissionEvidence: Evidence | null = null;
    let submittedRevision: ArtifactRevision | null = null;
    let artifactRevisionRefs: string[] = [];
    if (state.scenario.productionConfig) {
      const payload = SubmitForReviewPayloadSchema.parse(command.payload);
      const repeated = state.productionSubmissions.find(
        (item) => item.requestId === payload.requestId,
      );
      if (repeated) {
        if (
          repeated.artifactId !== payload.artifactId
          || repeated.revisionId !== payload.revisionId
        ) {
          throw new InvalidWorldActionError("同一请求标识已经绑定不同的成果提交");
        }
        return [];
      }
      if (state.productionSubmissions.length > 0 || hasEvent(state, "submission_created")) {
        throw new InvalidWorldActionError("成果已经提交");
      }
      const artifact = state.productionArtifacts.find(
        (item) => item.artifactId === payload.artifactId,
      );
      const revision = state.artifactRevisions.find(
        (item) => item.revisionId === payload.revisionId,
      );
      if (!artifact || !revision || revision.artifactId !== artifact.artifactId) {
        throw new InvalidWorldActionError("提交成果或精确修订不存在");
      }
      if (artifact.ownerActorId !== role.agentId || artifact.ownerRoleId !== role.roleId) {
        throw new PermissionDeniedError("只有成果所属岗位可以提交该修订");
      }
      if (
        artifact.status !== "draft"
        || artifact.latestRevisionId !== revision.revisionId
        || artifact.revisionCount !== revision.revisionNumber
      ) {
        throw new InvalidWorldActionError("只能提交当前成果的最新不可变修订");
      }
      const template = artifactTemplate(state, artifact.templateId);
      if (revision.revisionNumber < template.minimumRevisions) {
        throw new InvalidWorldActionError(
          `成果至少需要 ${template.minimumRevisions} 个不可变修订后才能提交`,
        );
      }
      this.validateArtifactRevision(template, revision.sections, revision.citations);
      const citedMaterialIds = [...new Set(
        revision.citations
          .filter((citation) => citation.sourceKind === "material")
          .map((citation) => citation.sourceId),
      )];
      for (const materialId of citedMaterialIds) {
        const material = state.materials.find(
          (item) => item.materialId === materialId,
        );
        if (!material) {
          throw new InvalidWorldActionError(
            `引用材料不存在：${materialId}`,
          );
        }
        const approvedReview = state.governanceReviews.find((review) => (
          review.materialId === material.materialId
          && review.materialVersion === material.version
          && review.inputContentHash === (
            material.contentHash ?? hashValue({
              sourceRef: material.sourceRef,
              mediaType: material.mediaType,
              version: material.version,
            })
          )
          && review.status === "approved"
          && isGovernanceVerdictReleasable(review.verdict)
        ));
        if (!approvedReview) {
          throw new InvalidWorldActionError(
            `材料 ${material.title} 的当前版本尚未通过精确治理教师门`,
          );
        }
      }
      const unfinishedTasks = state.mediaProcessingTasks.filter((task) => (
        authorizeResource(
          createAccessSubject({
            role,
            sessionId: state.sessionId,
            sessionEpoch: state.sessionEpoch,
            courseId: state.scenario.courseId,
            purpose: "runtime",
          }),
          task.audience,
        ).allowed
        && citedMaterialIds.includes(task.materialId)
        && task.status !== "succeeded"
      ));
      if (unfinishedTasks.length > 0) {
        throw new InvalidWorldActionError("仍有排队、处理中、部分成功或失败的多模态任务");
      }
      const now = this.#clock.now();
      submissionEvidence = this.evidence(state, command, {
        nodeId: "release",
        action: "提交精确成果修订",
        basis: `提交 ${artifact.title} · R${revision.revisionNumber}，固定内容哈希 ${revision.contentHash.slice(0, 12)}`,
        materialRefs: revision.citations
          .filter((citation) => citation.sourceKind === "material")
          .map((citation) => citation.sourceId),
        artifactRevisionRefs: [revision.revisionId],
        processingTaskRefs: state.mediaProcessingTasks
          .filter((task) => citedMaterialIds.includes(task.materialId))
          .map((task) => task.taskId),
      });
      const evidenceRefs = [...state.evidence.map((item) => item.evidenceId), submissionEvidence.evidenceId];
      submission = ProductionSubmissionSchema.parse({
        submissionId: this.#ids.next("submission"),
        artifactId: artifact.artifactId,
        revisionId: revision.revisionId,
        revisionNumber: revision.revisionNumber,
        evidenceRefs,
        citationIds: revision.citations.map((citation) => citation.citationId),
        submittedBy: role.agentId,
        requestId: payload.requestId,
        submittedAt: now,
      });
      submittedRevision = revision;
      artifactRevisionRefs = [revision.revisionId];
    } else if (hasEvent(state, "submission_created")) {
      throw new InvalidWorldActionError("成果已经提交");
    }
    const evaluatorActorIds = state.scenario.roles
      .filter((candidate) => (
        candidate.roleId === "assessor"
        && candidate.allowedIntents.includes("record_evaluation_proposal")
      ))
      .map((candidate) => candidate.agentId);
    if (evaluatorActorIds.length !== 3) {
      return this.submitForLegacyAssessment(
        state,
        command,
        submission,
        submissionEvidence,
        artifactRevisionRefs,
      );
    }
    if (!submission || !submittedRevision || !submissionEvidence) {
      throw new InvalidWorldActionError(
        "V0.7.0 评价案件只接受精确成果提交、不可变修订与提交证据",
      );
    }
    const evidenceForBundle = [
      ...state.evidence.filter((item) => submission.evidenceRefs.includes(item.evidenceId)),
      submissionEvidence,
    ];
    const release = this.releaseForState(state);
    const { evidenceBundle, evaluationCase } = createEvaluationCase({
      nextId: this.#ids.next.bind(this.#ids),
      now: this.#clock.now(),
      sessionEpoch: state.sessionEpoch,
      openedFromMessageId: command.messageId,
      submission,
      revision: submittedRevision,
      rubricId: state.scenario.rubricId,
      rubricVersion: state.scenario.rubricVersion,
      rubric: state.scenario.rubric,
      evidence: evidenceForBundle,
      events: state.events,
      scenarioReleaseId: release.ref.releaseId,
      scenarioContentHash: release.ref.contentHash,
    });
    const ruleProposal = createRuleEvaluationProposal({
      nextId: this.#ids.next.bind(this.#ids),
      now: this.#clock.now(),
      evaluationCase,
      evidenceBundle,
      rubric: state.scenario.rubric,
      evidence: evidenceForBundle,
      events: state.events,
    });
    const arbitration = arbitrateEvaluationProposals({
      nextId: this.#ids.next.bind(this.#ids),
      now: this.#clock.now(),
      evaluationCase,
      proposals: [ruleProposal],
    });
    return [
      ...(submissionEvidence ? [{
        eventType: "evidence_recorded" as const,
        actorId: "system",
        summary: "精确成果修订提交已形成过程证据",
        visibility: assignedVisibility,
        payload: { evidence: submissionEvidence },
      }] : []),
      {
        eventType: "submission_created",
        actorId: command.actorId,
        summary: submission
          ? `责任编辑提交融媒体成果 R${submission.revisionNumber} 与过程证据`
          : "责任编辑提交融媒体报道方案与过程证据",
        visibility: assignedVisibility,
        payload: {
          submission,
          evidenceRefs: submission.evidenceRefs,
          artifactRevisionRefs,
          virtualMinute: 34,
        },
      },
      {
        eventType: "evaluation_case_opened",
        actorId: "system",
        summary: "已固定成果修订、量规与只读证据包，评价法庭开始收集意见",
        visibility: ["role_private", "audit_only"],
        visibleToActorIds: evaluatorActorIds,
        payload: { evidenceBundle, evaluationCase },
      },
      {
        eventType: "evaluation_proposal_recorded",
        actorId: "system",
        summary: "确定性规则评分已逐维记录",
        visibility: teacherVisibility,
        payload: { proposal: ruleProposal },
      },
      {
        eventType: "evaluation_arbitrated",
        actorId: "system",
        summary: "评价仲裁等待三个语义评价节点",
        visibility: teacherVisibility,
        payload: { arbitration },
      },
      { eventType: "node_activated", actorId: "system", summary: "进入岗位表现复盘节点", visibility: assignedVisibility, payload: { nodeId: "review", virtualMinute: 34 } },
    ];
  }

  private submitForLegacyAssessment(
    state: WorldState,
    command: Command,
    submission: ProductionSubmission | null,
    submissionEvidence: Evidence | null,
    artifactRevisionRefs: string[],
  ): EventDraft[] {
    const evidenceRefs = submission?.evidenceRefs
      ?? state.evidence.map((item) => item.evidenceId);
    const criterionScores = state.scenario.rubric.map((criterion) => {
      const maximum = criterion.weight * 100;
      const evaluation = criterion.evaluation;
      const achieved = evaluation.kind === "evidence_action"
        ? hasEvidenceAction(state, evaluation.action)
        : evaluation.kind === "event_exists"
          ? hasEvent(state, evaluation.eventType)
          : state.evidence.length >= evaluation.minimum;
      const points = evaluation.kind === "evidence_count" && !achieved
        ? maximum * Math.min(1, state.evidence.length / evaluation.minimum)
        : achieved ? maximum : 0;
      return {
        label: criterion.label,
        points: Math.round(points * 100) / 100,
        maximum: Math.round(maximum * 100) / 100,
      };
    });
    const ruleScore = Math.round(
      criterionScores.reduce((total, criterion) => total + criterion.points, 0)
      * 100,
    ) / 100;
    const ruleAssessment = AssessmentSchema.parse({
      assessmentId: this.#ids.next("assessment-rule"),
      stage: "rule",
      status: "proposed",
      score: ruleScore,
      rubricVersion: `${state.scenario.rubricId}@${state.scenario.rubricVersion}`,
      modelVersion: null,
      reasons: criterionScores.map((criterion) => (
        `${criterion.label} ${criterion.points}/${criterion.maximum}`
      )),
      evidenceRefs,
      artifactRevisionRefs,
      confidence: 1,
      reviewedBy: null,
      reviewNote: null,
    });
    const modelAssessment = AssessmentSchema.parse({
      assessmentId: this.#ids.next("assessment-model"),
      stage: "model",
      status: "proposed",
      score: Math.max(0, ruleScore - 2),
      rubricVersion: `${state.scenario.rubricId}@${state.scenario.rubricVersion}`,
      modelVersion: "iflytek-adapter/mock-assessor-0.1",
      reasons: [
        "旧版固定会话按当时发布的兼容评价逻辑回放",
        "升级后的新会话不会把确定性规则分伪装成模型评价",
      ],
      evidenceRefs,
      artifactRevisionRefs,
      confidence: 0.82,
      reviewedBy: null,
      reviewNote: null,
    });
    return [
      ...(submissionEvidence
        ? [{
            eventType: "evidence_recorded" as const,
            actorId: "system",
            summary: "精确成果修订提交已形成过程证据",
            visibility: assignedVisibility,
            payload: { evidence: submissionEvidence },
          }]
        : []),
      {
        eventType: "submission_created",
        actorId: command.actorId,
        summary: submission
          ? `责任编辑提交融媒体成果 R${submission.revisionNumber} 与过程证据`
          : "责任编辑提交融媒体报道方案与过程证据",
        visibility: assignedVisibility,
        payload: {
          submission,
          evidenceRefs,
          artifactRevisionRefs,
          virtualMinute: 34,
        },
      },
      {
        eventType: "assessment_created",
        actorId: "system",
        summary: `旧版确定性规则初评完成：${ruleScore} 分`,
        visibility: ["assigned_team", "teacher_only", "audit_only"],
        payload: { assessment: ruleAssessment },
      },
      {
        eventType: "assessment_created",
        actorId: "agent-assessor",
        summary: "旧版兼容模型初评已生成，等待教师复核",
        visibility: ["assigned_team", "teacher_only", "audit_only"],
        payload: { assessment: modelAssessment },
      },
      {
        eventType: "node_activated",
        actorId: "system",
        summary: "进入岗位表现复盘节点",
        visibility: assignedVisibility,
        payload: { nodeId: "review", virtualMinute: 34 },
      },
    ];
  }

  private approveCandidate(state: WorldState, command: Command): EventDraft[] {
    const candidate = this.pendingCandidate(state, command);
    const reviewReason = String(command.payload.reason ?? "").trim()
      || "教师批准";
    const approvalPolicy = state.scenario.approvalPolicies.find(
      (policy) => policy.approvalPolicyId === candidate.approvalPolicyId,
    );
    if (!approvalPolicy || approvalPolicy.reviewMode !== "teacher_required") {
      throw new InvalidWorldActionError("候选事件缺少有效的教师复核策略");
    }
    if (candidate.evidenceRefs.length < approvalPolicy.minimumEvidenceCount) {
      throw new InvalidWorldActionError(
        `该候选自身至少需要 ${approvalPolicy.minimumEvidenceCount} 条过程证据`,
      );
    }
    for (const evidenceRef of candidate.evidenceRefs) {
      if (!state.evidence.some((evidence) => evidence.evidenceId === evidenceRef)) {
        throw new InvalidWorldActionError(`候选引用的过程证据不存在：${evidenceRef}`);
      }
    }
    const drafts: EventDraft[] = [
      { eventType: "candidate_event_approved", actorId: command.actorId, summary: `教师批准投放：${candidate.title}`, visibility: teacherVisibility, payload: { candidateId: candidate.candidateId, approvedBy: command.actorId, reviewedBy: command.actorId, reason: reviewReason } },
    ];
    if (candidate.candidateKind === "director_intervention") {
      if (
        candidate.eventType !== "scenario_intervention_applied"
        || !candidate.routeId
        || !candidate.preconditionHash
        || candidate.preconditionHash !== directorPreconditionHash(state)
      ) {
        throw new InvalidWorldActionError("导演候选的事件类型、路线或审批前置状态已经失效");
      }
      const template = state.scenario.directorEventTemplates?.find(
        (item) => item.routeId === candidate.routeId,
      );
      if (
        !template
        || template.effectHandlerId !== "director_intervention_v1"
        || template.eventType !== candidate.eventType
        || template.approvalPolicyId !== candidate.approvalPolicyId
      ) {
        throw new InvalidWorldActionError("固定情境包无法解析该导演候选的受信效果");
      }
      const affectedActorIds = state.scenario.roles
        .filter((role) => template.affectedRoleIds.includes(role.roleId))
        .map((role) => role.agentId);
      const intervention = ScenarioInterventionSchema.parse({
        interventionId: this.#ids.next("scenario-intervention"),
        routeId: template.routeId,
        kind: template.kind,
        title: template.title,
        studentBrief: template.studentBrief,
        competencyTarget: template.competencyTarget,
        difficulty: candidate.difficulty ?? state.scenario.directorConfig?.difficulty ?? "standard",
        expectedImpact: template.expectedImpact,
        affectedRoleIds: template.affectedRoleIds,
        riskLevel: template.riskLevel,
        sourceCandidateId: candidate.candidateId,
        recoveryOfCandidateId: candidate.recoveryOfCandidateId,
        approvedBy: command.actorId,
        appliedAt: this.#clock.now(),
      });
      drafts.push({
        eventType: "scenario_intervention_applied",
        actorId: "system",
        summary: `新的岗位情境已生效：${template.title}`,
        visibility: assignedVisibility,
        visibleToActorIds: affectedActorIds,
        payload: {
          intervention,
          virtualMinute: Math.min(
            state.scenario.durationMinutes,
            state.virtualMinute + 3,
          ),
        },
      });
      drafts.push(this.messageDraft({
        actorId: "system",
        roleId: "system",
        displayName: "融媒任务台",
        content: template.studentBrief,
        visibility: assignedVisibility,
        visibleToActorIds: affectedActorIds,
        recipientActorIds: affectedActorIds,
        sourceRefs: [candidate.candidateId, ...template.sourceRefs],
        now: this.#clock.now(),
      }));
    } else if (candidate.eventType === "world_fact_updated") {
      drafts.push({ eventType: "world_fact_updated", actorId: "system", summary: "权威客流事实已按审批结果更正为12,600人次", visibility: assignedVisibility, payload: { ...candidate.payload, virtualMinute: 7 } });
      drafts.push({ eventType: "node_activated", actorId: "system", summary: "进入核验关键事实节点", visibility: assignedVisibility, payload: { nodeId: String(candidate.payload.nextNodeId ?? "verification"), virtualMinute: 7 } });
    } else if (candidate.eventType === "copyright_risk_flagged") {
      drafts.push({ eventType: "copyright_risk_flagged", actorId: "system", summary: "版权方申诉生效，现场图进入争议状态", visibility: assignedVisibility, payload: { ...candidate.payload, virtualMinute: 15 } });
      const fact = candidate.payload.fact;
      if (fact) drafts.push({ eventType: "world_fact_confirmed", actorId: "system", summary: "图片授权边界已纳入共享世界事实", visibility: assignedVisibility, payload: { fact } });
      drafts.push({ eventType: "node_activated", actorId: "system", summary: "进入治理版权风险节点", visibility: assignedVisibility, payload: { nodeId: String(candidate.payload.nextNodeId ?? "copyright"), virtualMinute: 15 } });
    } else if (candidate.eventType === "node_activated") {
      const configuredWorldChanges = Array.isArray(
        candidate.payload.worldChanges,
      )
        ? candidate.payload.worldChanges
        : [];
      const configuredSummary = configuredWorldChanges.find(
        (change): change is string => (
          typeof change === "string" && change.trim().length > 0
        ),
      );
      drafts.push({
        eventType: "node_activated",
        actorId: "system",
        summary: configuredSummary
          ?? "平台审核升级：稿件转入人工复核",
        visibility: assignedVisibility,
        payload: candidate.payload,
      });
    } else if (candidate.eventType === "experience_consequence_applied") {
      drafts.push({
        eventType: "experience_consequence_applied",
        actorId: "system",
        summary: "教师已批准写入本节动态业务后果",
        visibility: assignedVisibility,
        payload: candidate.payload,
      });
    } else if (candidate.eventType === "scene_completed") {
      drafts.push({
        eventType: "scene_completed",
        actorId: "system",
        summary: "教师终门已批准，课程情境完成",
        visibility: assignedVisibility,
        payload: candidate.payload,
      });
    } else {
      throw new InvalidWorldActionError(`不支持投放候选事件类型：${candidate.eventType}`);
    }
    return drafts;
  }

  private rejectCandidate(state: WorldState, command: Command): EventDraft[] {
    const candidate = this.pendingCandidate(state, command);
    const approvalPolicy = state.scenario.approvalPolicies.find(
      (policy) => policy.approvalPolicyId === candidate.approvalPolicyId,
    );
    if (!approvalPolicy?.allowReject) throw new InvalidWorldActionError("当前审批策略不允许驳回");
    const reason = String(command.payload.reason ?? "").trim();
    if (approvalPolicy.reasonRequired && reason.length === 0) {
      throw new InvalidWorldActionError("当前审批策略要求填写驳回原因");
    }
    const sceneDirector = state.scenario.roles.find((role) => role.roleId === "scene_director");
    return [
      {
        eventType: "candidate_event_rejected",
        actorId: command.actorId,
        summary: `教师驳回候选事件：${candidate.title}`,
        visibility: teacherVisibility,
        payload: {
          candidateId: candidate.candidateId,
          reason: reason || "不符合当前教学节奏",
          reviewedBy: command.actorId,
        },
      },
      ...(sceneDirector ? [{
        eventType: "director_recovery_requested" as const,
        actorId: "system",
        summary: "教师驳回已转换为脱敏的导演恢复请求",
        visibility: ["assigned_team", "audit_only"] as VisibilityScope[],
        visibleToActorIds: [sceneDirector.agentId],
        payload: {
          candidateId: candidate.candidateId,
          routeId: candidate.routeId,
          policyId: candidate.policyId,
          reasonCode: "teacher_rejected",
        },
      }] : []),
    ];
  }

  private retryEvaluationBranch(
    state: WorldState,
    role: RoleContract,
    command: Command,
  ): EventDraft[] {
    if (
      role.actorKind !== "teacher"
      || !roleCanExecuteCommand(role, "retry_evaluation_branch")
    ) {
      throw new PermissionDeniedError(
        "只有具备评价复核能力的教师可以重跑评价分支",
      );
    }
    const payload = RetryEvaluationBranchPayloadSchema.parse(command.payload);
    const requestPayloadHash = hashValue(payload);
    const repeated = state.events.find((event) => (
      event.eventType === "evaluation_branch_retry_requested"
      && event.payload.requestId === payload.requestId
    ));
    if (repeated) {
      if (repeated.payload.requestPayloadHash !== requestPayloadHash) {
        throw new DomainRevisionConflictError(
          "同一请求标识已经绑定不同的评价分支重跑请求",
        );
      }
      return [];
    }

    const evaluationCase = state.evaluationCases.find(
      (item) => item.evaluationCaseId === payload.evaluationCaseId,
    );
    if (!evaluationCase) {
      throw new InvalidWorldActionError("待重跑的评价案件不存在");
    }
    if (state.teacherAssessmentReviews.some((review) => (
      review.evaluationCaseId === evaluationCase.evaluationCaseId
    ))) {
      throw new InvalidWorldActionError(
        "教师终评已经固定；不能再重跑其上游评价分支",
      );
    }
    const evidenceBundle = state.evaluationEvidenceBundles.find(
      (item) => item.bundleId === evaluationCase.evidenceBundleId,
    );
    if (
      evaluationCase.caseHash !== payload.expectedCaseHash
      || !evidenceBundle
      || evidenceBundle.bundleHash !== payload.expectedEvidenceBundleHash
      || evaluationCase.evidenceBundleHash !== evidenceBundle.bundleHash
    ) {
      throw new DomainRevisionConflictError(
        "评价案件或固定证据包已经变化，请刷新后再重跑",
      );
    }
    const arbitration = state.evaluationArbitrations
      .filter((item) => (
        item.evaluationCaseId === evaluationCase.evaluationCaseId
      ))
      .sort((left, right) => right.revision - left.revision)[0];
    if (
      !arbitration
      || arbitration.revision !== payload.expectedArbitrationRevision
      || arbitration.decisionHash !== payload.expectedDecisionHash
    ) {
      throw new DomainRevisionConflictError(
        "评价仲裁版本或决策哈希已经变化，请刷新后再重跑",
      );
    }
    const unavailableProposal = latestEvaluationProposal(
      state,
      evaluationCase.evaluationCaseId,
      payload.evaluatorKind,
    );
    if (
      !unavailableProposal
      || unavailableProposal.status !== "unavailable"
      || unavailableProposal.proposalId
        !== payload.expectedUnavailableProposalId
      || unavailableProposal.proposalHash
        !== payload.expectedUnavailableProposalHash
    ) {
      throw new DomainRevisionConflictError(
        "指定的不可用意见已经不是该评价器的最新意见",
      );
    }
    const targetAgentId = evaluatorAgentIdForKind(
      state,
      payload.evaluatorKind,
    );
    if (!targetAgentId) {
      throw new InvalidWorldActionError(
        `固定情境没有配置 ${payload.evaluatorKind} 评价节点`,
      );
    }
    const priorRetries = state.events.filter((event) => (
      event.eventType === "evaluation_branch_retry_requested"
      && event.payload.evaluationCaseId === evaluationCase.evaluationCaseId
      && event.payload.evaluatorKind === payload.evaluatorKind
    ));
    const retryBudgetCount = manualRetryBudgetCount(state, priorRetries);
    if (retryBudgetCount >= maximumManualAgentRetries) {
      throw new InvalidWorldActionError(
        `该评价分支已达到 ${maximumManualAgentRetries} 次人工重跑上限`,
      );
    }
    const inFlight = priorRetries.findLast((event) => (
      !hasTerminalAgentResultForTrigger(state, event.eventId)
    ));
    if (inFlight) {
      throw new InvalidWorldActionError(
        "该评价分支已有重跑任务在途，请等待本轮结果",
      );
    }

    return [{
      eventType: "evaluation_branch_retry_requested",
      actorId: command.actorId,
      summary: `教师请求仅重跑 ${payload.evaluatorKind} 评价分支`,
      visibility: ["role_private", "teacher_only", "audit_only"],
      visibleToActorIds: [targetAgentId],
      payload: {
        ...payload,
        evaluationCase,
        evidenceBundle,
        targetAgentId,
        sourceArbitrationId: arbitration.arbitrationId,
        manualRetryAttempt: retryBudgetCount + 1,
        manualRetryRequestSequence: priorRetries.length + 1,
        requestPayloadHash,
      },
    }];
  }

  private retryLearningCandidateGeneration(
    state: WorldState,
    role: RoleContract,
    command: Command,
  ): EventDraft[] {
    if (
      role.actorKind !== "teacher"
      || !roleCanExecuteCommand(
        role,
        "retry_learning_candidate_generation",
      )
    ) {
      throw new PermissionDeniedError(
        "只有具备学习候选复核能力的教师可以重跑学习策展",
      );
    }
    const payload = RetryLearningCandidateGenerationPayloadSchema.parse(
      command.payload,
    );
    const requestPayloadHash = hashValue(payload);
    const repeated = state.events.find((event) => (
      event.eventType === "learning_candidate_generation_retry_requested"
      && event.payload.requestId === payload.requestId
    ));
    if (repeated) {
      if (repeated.payload.requestPayloadHash !== requestPayloadHash) {
        throw new DomainRevisionConflictError(
          "同一请求标识已经绑定不同的学习策展重跑请求",
        );
      }
      return [];
    }

    const review = state.teacherAssessmentReviews.find(
      (item) => item.reviewId === payload.teacherReviewId,
    );
    if (
      !review
      || review.evaluationCaseId !== payload.evaluationCaseId
      || review.finalHash !== payload.expectedFinalHash
    ) {
      throw new DomainRevisionConflictError(
        "教师终评或终评哈希已经变化，请刷新后再重跑",
      );
    }
    const failureEvent = state.events.find(
      (event) => event.eventId === payload.failureEventId,
    );
    const failureReview = failureEvent
      ? learningReviewForFailure(state, failureEvent)
      : null;
    if (
      !failureEvent
      || failureEvent.eventType !== "learning_candidate_generation_failed"
      || failureEvent.payload.taskId !== payload.expectedFailedTaskId
      || failureReview?.reviewId !== review.reviewId
      || failureReview.finalHash !== review.finalHash
    ) {
      throw new DomainRevisionConflictError(
        "指定失败事件与教师终评不匹配",
      );
    }
    const latestFailure = state.events.findLast((event) => (
      learningReviewForFailure(state, event)?.reviewId === review.reviewId
    ));
    if (latestFailure?.eventId !== failureEvent.eventId) {
      throw new DomainRevisionConflictError(
        "指定失败事件已经不是该教师终评的最新学习策展失败",
      );
    }
    const failureTriggerEventId = typeof failureEvent.payload.triggerEventId
      === "string"
      ? failureEvent.payload.triggerEventId
      : null;
    const failureTrigger = failureTriggerEventId
      ? state.events.find((event) => event.eventId === failureTriggerEventId)
      : null;
    const finalAssessmentId = typeof failureTrigger?.payload.finalAssessmentId
      === "string"
      ? failureTrigger.payload.finalAssessmentId
      : "";
    const finalAssessment = state.assessments.find((assessment) => (
      assessment.assessmentId === finalAssessmentId
      && assessment.stage === "teacher"
    ));
    if (!finalAssessment) {
      throw new InvalidWorldActionError(
        "学习策展失败记录缺少对应的教师终评对象",
      );
    }
    if (state.learningCandidates.some((candidate) => (
      candidate.sourceFinalAssessmentId === finalAssessmentId
      || candidate.evaluationCaseId === review.evaluationCaseId
    ))) {
      throw new InvalidWorldActionError(
        "该教师终评已经生成学习候选，不能重复重跑",
      );
    }
    const learningCuratorRoles = state.scenario.roles.filter((candidate) => (
      candidate.roleId === "learning_curator"
      && candidate.allowedIntents.includes("propose_learning_candidate")
    ));
    if (learningCuratorRoles.length !== 1) {
      throw new InvalidWorldActionError(
        "固定情境版本必须配置且只能配置一个学习策展节点",
      );
    }
    const learningCuratorRole = learningCuratorRoles[0]!;
    const priorRetries = state.events.filter((event) => (
      event.eventType === "learning_candidate_generation_retry_requested"
      && event.payload.teacherReviewId === review.reviewId
    ));
    const retryBudgetCount = manualRetryBudgetCount(state, priorRetries);
    if (retryBudgetCount >= maximumManualAgentRetries) {
      throw new InvalidWorldActionError(
        `学习策展已达到 ${maximumManualAgentRetries} 次人工重跑上限`,
      );
    }
    const inFlight = priorRetries.findLast((event) => (
      !hasTerminalAgentResultForTrigger(state, event.eventId)
    ));
    if (inFlight) {
      throw new InvalidWorldActionError(
        "学习策展已有重跑任务在途，请等待本轮结果",
      );
    }
    const learningInput = buildLearningCuratorInput(
      state,
      review,
      learningCuratorRole,
    );

    return [{
      eventType: "learning_candidate_generation_retry_requested",
      actorId: command.actorId,
      summary: "教师请求基于精确终评重新运行学习策展",
      visibility: ["role_private", "teacher_only", "audit_only"],
      visibleToActorIds: [learningCuratorRole.agentId],
      payload: {
        ...payload,
        review,
        finalAssessmentId,
        learningInput,
        targetAgentId: learningCuratorRole.agentId,
        sourceFailureEventId: failureEvent.eventId,
        sourceFailedTaskId: payload.expectedFailedTaskId,
        manualRetryAttempt: retryBudgetCount + 1,
        manualRetryRequestSequence: priorRetries.length + 1,
        requestPayloadHash,
      },
    }];
  }

  private reviewAssessment(state: WorldState, command: Command): EventDraft[] {
    if (state.evaluationCases.length === 0) {
      return this.reviewLegacyAssessment(state, command);
    }
    const role = this.requireRole(command.actorId, state.scenario);
    if (role.actorKind !== "teacher") {
      throw new PermissionDeniedError("只有教师可以形成最终评价");
    }
    const payload = ReviewAssessmentPayloadSchema.parse(command.payload);
    const requestPayloadHash = hashValue(payload);
    const repeated = state.events.find((event) => (
      event.eventType === "teacher_reviewed"
      && event.payload.requestId === payload.requestId
    ));
    if (repeated) {
      if (repeated.payload.requestPayloadHash !== requestPayloadHash) {
        throw new DomainRevisionConflictError(
          "同一请求标识已经绑定不同的教师终评决定",
        );
      }
      return [];
    }
    const evaluationCase = state.evaluationCases.find(
      (item) => item.evaluationCaseId === payload.evaluationCaseId,
    );
    if (!evaluationCase) throw new InvalidWorldActionError("评价案件不存在");
    if (state.teacherAssessmentReviews.some((review) => (
      review.evaluationCaseId === evaluationCase.evaluationCaseId
    ))) {
      throw new InvalidWorldActionError("该评价案件已经完成教师终评");
    }
    const retryInFlight = state.events.some((event) => (
      event.eventType === "evaluation_branch_retry_requested"
      && event.payload.evaluationCaseId === evaluationCase.evaluationCaseId
      && !hasTerminalAgentResultForTrigger(state, event.eventId)
    ));
    if (retryInFlight) {
      throw new InvalidWorldActionError(
        "评价分支重跑尚未完成，不能在结果返回前固定教师终评",
      );
    }
    const evidenceBundle = state.evaluationEvidenceBundles.find(
      (item) => item.bundleId === evaluationCase.evidenceBundleId,
    );
    const arbitration = state.evaluationArbitrations
      .filter((item) => item.evaluationCaseId === evaluationCase.evaluationCaseId)
      .sort((left, right) => right.revision - left.revision)[0];
    if (
      !evidenceBundle
      || !arbitration
      || arbitration.status === "collecting"
      || arbitration.revision !== payload.expectedArbitrationRevision
      || arbitration.decisionHash !== payload.expectedDecisionHash
      || evidenceBundle.bundleHash !== payload.expectedEvidenceBundleHash
      || evaluationCase.evidenceBundleHash !== evidenceBundle.bundleHash
    ) {
      throw new DomainRevisionConflictError(
        "评价仲裁版本、决策哈希或证据包已经变化，请刷新后复核最新案件",
      );
    }
    const inputByDimension = new Map(
      payload.dimensions.map((item) => [item.dimensionId, item]),
    );
    if (
      inputByDimension.size !== payload.dimensions.length
      || inputByDimension.size !== evaluationCase.dimensions.length
    ) {
      throw new InvalidWorldActionError(
        "教师终评必须且只能逐一覆盖全部量规维度",
      );
    }
    const decisions = evaluationCase.dimensions.map((dimension) => {
      const input = inputByDimension.get(dimension.dimensionId);
      const recommendation = arbitration.recommendations.find(
        (item) => item.dimensionId === dimension.dimensionId,
      );
      if (!input || !recommendation) {
        throw new InvalidWorldActionError(
          `教师终评缺少量规维度：${dimension.dimensionId}`,
        );
      }
      if (input.finalScore > dimension.maxScore || input.finalScore < 0) {
        throw new InvalidWorldActionError(
          `教师终评分数超出维度上限：${dimension.dimensionId}`,
        );
      }
      const delta = Math.round(
        (input.finalScore - recommendation.suggestedScore) * 100,
      ) / 100;
      if (Math.abs(delta) > 0.001 && !input.overrideReason?.trim()) {
        throw new InvalidWorldActionError(
          `修改 ${dimension.label} 建议分时必须填写逐维覆盖理由`,
        );
      }
      return {
        ...input,
        overrideReason: input.overrideReason?.trim() || null,
        proposedScore: recommendation.suggestedScore,
        maxScore: dimension.maxScore,
        delta,
        evidenceRefs: [...recommendation.evidenceRefs].sort(),
      };
    });
    const finalScore = Math.round(
      decisions.reduce((total, item) => total + item.finalScore, 0) * 100,
    ) / 100;
    if (finalScore > 100) {
      throw new InvalidWorldActionError("教师终评分项合计不得超过 100 分");
    }
    const now = this.#clock.now();
    const reviewBase = {
      schemaVersion: "evaluation/1.0.0" as const,
      reviewId: this.#ids.next("teacher-assessment-review"),
      evaluationCaseId: evaluationCase.evaluationCaseId,
      arbitrationId: arbitration.arbitrationId,
      arbitrationRevision: arbitration.revision,
      decisionHash: arbitration.decisionHash,
      evidenceBundleHash: evidenceBundle.bundleHash,
      dimensions: decisions,
      finalScore,
      publicSummary: payload.publicSummary,
      internalNote: payload.internalNote,
      reviewedBy: command.actorId,
      reviewedAt: now,
      requestId: payload.requestId,
    };
    const review = TeacherAssessmentReviewSchema.parse({
      ...reviewBase,
      finalHash: hashValue(reviewBase),
    });
    const finalAssessmentId = this.#ids.next("assessment-teacher");
    const evidenceRefs = [...new Set(
      review.dimensions.flatMap((item) => item.evidenceRefs),
    )].sort();
    const teacherAssessment: Assessment = AssessmentSchema.parse({
      assessmentId: finalAssessmentId,
      stage: "teacher",
      status: "final",
      score: review.finalScore,
      rubricVersion: `${state.scenario.rubricId}@${state.scenario.rubricVersion}`,
      modelVersion: null,
      reasons: [
        "教师基于固定证据包与精确仲裁逐维形成最终评价",
        review.publicSummary,
      ],
      evidenceRefs,
      confidence: 1,
      reviewedBy: command.actorId,
      reviewNote: review.internalNote,
    });
    const learningCuratorRoles = state.scenario.roles
      .filter((candidate) => (
        candidate.roleId === "learning_curator"
        && candidate.allowedIntents.includes("propose_learning_candidate")
      ));
    if (learningCuratorRoles.length !== 1) {
      throw new InvalidWorldActionError(
        "固定情境版本必须配置且只能配置一个学习策展节点",
      );
    }
    const learningCuratorRole = learningCuratorRoles[0]!;
    const learningCuratorActorIds = [learningCuratorRole.agentId];
    const learningInput = buildLearningCuratorInput(
      state,
      review,
      learningCuratorRole,
    );
    return [
      {
        eventType: "teacher_reviewed",
        actorId: command.actorId,
        summary: `教师完成精确逐维终评：${review.finalScore} 分`,
        visibility: ["role_private", "teacher_only", "audit_only"],
        visibleToActorIds: learningCuratorActorIds,
        payload: {
          review,
          finalAssessmentId,
          learningInput,
          requestId: payload.requestId,
          requestPayloadHash,
        },
      },
      {
        eventType: "assessment_created",
        actorId: "system",
        summary: "教师终评已固定；学生端仅投影公开反馈",
        visibility: teacherVisibility,
        payload: { assessment: teacherAssessment },
      },
    ];
  }

  private reviewLegacyAssessment(
    state: WorldState,
    command: Command,
  ): EventDraft[] {
    const rule = state.assessments.find(
      (assessment) => assessment.stage === "rule",
    );
    const model = state.assessments.find(
      (assessment) => assessment.stage === "model",
    );
    if (!rule || !model) {
      throw new InvalidWorldActionError("规则与模型初评尚未完成");
    }
    if (state.assessments.some((assessment) => assessment.stage === "teacher")) {
      throw new InvalidWorldActionError("教师已经完成复核");
    }
    const requestedScore = typeof command.payload.score === "number"
      ? command.payload.score
      : Math.round((rule.score + model.score) / 2);
    const score = Math.max(0, Math.min(100, requestedScore));
    const note = String(
      command.payload.reviewNote
      ?? "证据链完整，风险判断与岗位责任一致；同意终评。",
    ).trim();
    const evidenceRefs = [...new Set([
      ...rule.evidenceRefs,
      ...model.evidenceRefs,
    ])];
    if (evidenceRefs.length === 0) {
      throw new InvalidWorldActionError("没有过程证据，不能完成教师复核");
    }
    const teacherAssessment = AssessmentSchema.parse({
      assessmentId: this.#ids.next("assessment-teacher"),
      stage: "teacher",
      status: "final",
      score,
      rubricVersion: `${state.scenario.rubricId}@${state.scenario.rubricVersion}`,
      modelVersion: null,
      reasons: ["教师已核对旧版规则初评、模型解释与完整时间线", note],
      evidenceRefs,
      confidence: 1,
      reviewedBy: command.actorId,
      reviewNote: note,
    });
    const learningCandidate = LearningCandidateSchema.parse({
      candidateId: this.#ids.next("learning-candidate"),
      candidateType: "assessment_example",
      status: "pending_review",
      title: "旧版会话终评证据样例",
      proposedContent: {
        score,
        summary: "旧版兼容候选保持待审核，不进入 V0.7 学习发布链。",
      },
      sourceEvidenceRefs: evidenceRefs,
      createdAt: this.#clock.now(),
    });
    return [
      {
        eventType: "teacher_reviewed",
        actorId: command.actorId,
        summary: `教师完成旧版终评复核：${score} 分`,
        visibility: ["assigned_team", "teacher_only", "audit_only"],
        payload: {
          ruleAssessmentId: rule.assessmentId,
          modelAssessmentId: model.assessmentId,
          reviewNote: note,
        },
      },
      {
        eventType: "assessment_created",
        actorId: "system",
        summary: "教师终评已成为旧版会话最终评价",
        visibility: ["assigned_team", "teacher_only", "audit_only"],
        payload: { assessment: teacherAssessment },
      },
      {
        eventType: "learning_candidate_created",
        actorId: "agent-learning",
        summary: "已保留旧版待审核学习候选，未写入正式知识库",
        visibility: teacherVisibility,
        payload: { learningCandidate },
      },
      {
        eventType: "scene_completed",
        actorId: "system",
        summary: "旧版实训闭环已完成，可按时间线回放",
        visibility: ["public_world", "audit_only"],
        payload: { finalScore: score, virtualMinute: 38 },
      },
    ];
  }

  private reviewLearningCandidate(
    state: WorldState,
    command: Command,
  ): EventDraft[] {
    const role = this.requireRole(command.actorId, state.scenario);
    if (role.actorKind !== "teacher") {
      throw new PermissionDeniedError("只有课程负责人可以审核学习候选");
    }
    const payload = ReviewLearningCandidatePayloadSchema.parse(command.payload);
    const requestPayloadHash = hashValue(payload);
    const repeated = state.events.find((event) => (
      event.eventType === "learning_candidate_reviewed"
      && event.payload.requestId === payload.requestId
    ));
    if (repeated) {
      if (repeated.payload.requestPayloadHash !== requestPayloadHash) {
        throw new DomainRevisionConflictError(
          "同一请求标识已经绑定不同的学习候选审核决定",
        );
      }
      return [];
    }
    const candidate = state.learningCandidates.find(
      (item) => item.candidateId === payload.candidateId,
    );
    if (!candidate || !candidate.candidateHash) {
      throw new InvalidWorldActionError("学习候选不存在或尚未固定内容哈希");
    }
    if (candidate.candidateHash !== payload.expectedCandidateHash) {
      throw new DomainRevisionConflictError(
        "学习候选内容哈希已经变化，请刷新后审核",
      );
    }
    if (state.learningCandidateReviews.some((review) => (
      review.candidateId === candidate.candidateId
    ))) {
      throw new InvalidWorldActionError("该学习候选已经完成审核");
    }
    const replayReport = state.learningReplayReports.find((report) => (
      report.candidateId === candidate.candidateId
      && report.reportHash === payload.expectedReplayReportHash
    ));
    if (
      !replayReport
      || replayReport.candidateHash !== candidate.candidateHash
    ) {
      throw new DomainRevisionConflictError(
        "学习候选离线回放报告不存在或哈希已经变化",
      );
    }
    if (payload.decision === "approve" && replayReport.status !== "passed") {
      throw new InvalidWorldActionError(
        "离线回放未通过的学习候选不能批准",
      );
    }
    const review = createLearningCandidateReview({
      nextId: this.#ids.next.bind(this.#ids),
      now: this.#clock.now(),
      candidate,
      replayReport,
      decision: payload.decision,
      reason: payload.reason,
      reviewedBy: command.actorId,
      requestId: payload.requestId,
    });
    return [
      {
        eventType: "learning_candidate_reviewed",
        actorId: command.actorId,
        summary: payload.decision === "approve"
          ? "课程负责人批准学习候选；仍需单独发布"
          : "课程负责人驳回学习候选；候选本体与回放记录保持不可变",
        visibility: teacherVisibility,
        payload: {
          candidateReview: review,
          requestId: payload.requestId,
          requestPayloadHash,
        },
      },
      ...(payload.decision === "reject" && state.status !== "completed"
        ? [{
            eventType: "scene_completed" as const,
            actorId: "system",
            summary: "实训与监督式学习审核闭环完成；候选未发布",
            visibility: ["public_world", "audit_only"] as VisibilityScope[],
            payload: {
              finalScore: state.teacherAssessmentReviews.at(-1)?.finalScore,
              learningOutcome: "candidate_rejected",
              virtualMinute: 38,
            },
          }]
        : []),
    ];
  }

  private publishLearningRelease(
    state: WorldState,
    command: Command,
  ): EventDraft[] {
    const role = this.requireRole(command.actorId, state.scenario);
    if (role.actorKind !== "teacher") {
      throw new PermissionDeniedError("只有课程负责人可以发布学习版本");
    }
    const payload = PublishLearningReleasePayloadSchema.parse(command.payload);
    const requestPayloadHash = hashValue(payload);
    const repeated = state.events.find((event) => (
      event.eventType === "learning_release_published"
      && event.payload.requestId === payload.requestId
    ));
    if (repeated) {
      if (repeated.payload.requestPayloadHash !== requestPayloadHash) {
        throw new DomainRevisionConflictError(
          "同一请求标识已经绑定不同的学习版本发布",
        );
      }
      return [];
    }
    if (state.activeLearningReleaseId !== payload.expectedActiveReleaseId) {
      throw new DomainRevisionConflictError(
        "活动学习版本已经变化，请刷新后重新发布",
      );
    }
    const candidate = state.learningCandidates.find(
      (item) => item.candidateId === payload.candidateId,
    );
    const review = state.learningCandidateReviews.find(
      (item) => item.reviewId === payload.reviewId,
    );
    const replayReport = state.learningReplayReports.find(
      (item) => item.reportId === payload.replayReportId,
    );
    if (
      !candidate
      || !review
      || !replayReport
      || review.candidateId !== candidate.candidateId
      || replayReport.candidateId !== candidate.candidateId
      || review.replayReportId !== replayReport.reportId
    ) {
      throw new InvalidWorldActionError(
        "发布请求没有命中同一候选、审核与离线回放链",
      );
    }
    const artifactKey = [
      "assessment-example",
      state.scenario.courseId,
      state.scenario.rubricId,
    ].join(":");
    if (state.learningReleases.some((release) => (
      release.artifactKey === artifactKey
      && release.version === payload.version
    ))) {
      throw new InvalidWorldActionError(
        `学习制品版本 ${payload.version} 已经发布`,
      );
    }
    const latestVersion = state.learningReleases
      .filter((release) => release.artifactKey === artifactKey)
      .map((release) => release.version)
      .sort(compareSemanticVersions)
      .at(-1);
    if (
      latestVersion
      && compareSemanticVersions(payload.version, latestVersion) <= 0
    ) {
      throw new InvalidWorldActionError(
        `新学习制品版本必须高于历史最高版本 ${latestVersion}`,
      );
    }
    const release = createLearningArtifactRelease({
      nextId: this.#ids.next.bind(this.#ids),
      now: this.#clock.now(),
      artifactKey,
      courseId: state.scenario.courseId,
      version: payload.version,
      parentReleaseId: state.activeLearningReleaseId,
      candidate,
      review,
      replayReport,
      publishedBy: command.actorId,
      requestId: payload.requestId,
    });
    return [
      {
        eventType: "learning_release_published",
        actorId: command.actorId,
        summary: `学习候选已显式发布为版本 ${release.version}`,
        visibility: teacherVisibility,
        payload: {
          release,
          requestId: payload.requestId,
          requestPayloadHash,
        },
      },
      ...(state.status !== "completed"
        ? [{
            eventType: "scene_completed" as const,
            actorId: "system",
            summary: "实训、评价、监督式学习审核与版本发布闭环完成",
            visibility: ["public_world", "audit_only"] as VisibilityScope[],
            payload: {
              finalScore: state.teacherAssessmentReviews.at(-1)?.finalScore,
              learningOutcome: "release_published",
              learningReleaseId: release.releaseId,
              virtualMinute: 38,
            },
          }]
        : []),
    ];
  }

  private rollbackLearningRelease(
    state: WorldState,
    command: Command,
  ): EventDraft[] {
    const role = this.requireRole(command.actorId, state.scenario);
    if (role.actorKind !== "teacher") {
      throw new PermissionDeniedError("只有课程负责人可以回滚学习版本");
    }
    const payload = RollbackLearningReleasePayloadSchema.parse(command.payload);
    const requestPayloadHash = hashValue(payload);
    const repeated = state.events.find((event) => (
      event.eventType === "learning_release_rolled_back"
      && event.payload.requestId === payload.requestId
    ));
    if (repeated) {
      if (repeated.payload.requestPayloadHash !== requestPayloadHash) {
        throw new DomainRevisionConflictError(
          "同一请求标识已经绑定不同的学习版本回滚",
        );
      }
      return [];
    }
    const activeRelease = state.learningReleases.find(
      (item) => item.releaseId === payload.activeReleaseId,
    );
    if (
      !activeRelease
      || state.activeLearningReleaseId !== activeRelease.releaseId
      || activeRelease.contentHash !== payload.expectedActiveContentHash
    ) {
      throw new DomainRevisionConflictError(
        "活动学习版本或内容哈希已经变化，请刷新后回滚",
      );
    }
    if (payload.targetReleaseId === activeRelease.releaseId) {
      throw new InvalidWorldActionError("回滚目标不能是当前活动版本");
    }
    if (payload.targetReleaseId !== null) {
      const target = state.learningReleases.find(
        (item) => item.releaseId === payload.targetReleaseId,
      );
      if (!target || target.artifactKey !== activeRelease.artifactKey) {
        throw new InvalidWorldActionError(
          "回滚目标不存在或不属于同一学习制品",
        );
      }
    }
    const rollback = createLearningReleaseRollback({
      nextId: this.#ids.next.bind(this.#ids),
      now: this.#clock.now(),
      activeRelease,
      targetReleaseId: payload.targetReleaseId,
      reason: payload.reason,
      rolledBackBy: command.actorId,
      requestId: payload.requestId,
    });
    return [{
      eventType: "learning_release_rolled_back",
      actorId: command.actorId,
      summary: payload.targetReleaseId
        ? "学习版本已通过追加事件回滚到历史稳定版"
        : "学习版本已通过追加事件回滚到系统基线",
      visibility: teacherVisibility,
      payload: {
        rollback,
        requestId: payload.requestId,
        requestPayloadHash,
      },
    }];
  }

  private pendingCandidate(state: WorldState, command: Command): CandidateEvent {
    const requestedId = typeof command.payload.candidateId === "string" ? command.payload.candidateId : null;
    if (!requestedId) {
      throw new InvalidWorldActionError("多候选审批必须明确指定 candidateId");
    }
    const candidate = state.candidates.find((item) => item.candidateId === requestedId);
    if (!candidate) throw new InvalidWorldActionError("没有匹配的候选事件");
    if (candidate.status !== "pending") throw new InvalidWorldActionError(`候选事件已${candidate.status === "approved" ? "批准" : "驳回"}`);
    return candidate;
  }

  private eventPolicy(
    state: WorldState,
    intentType: string,
    role: RoleContract,
    optionId: string | null,
  ) {
    const policy = state.scenario.eventPolicies.find((candidate) => (
      candidate.sourceIntentType === intentType
      && candidate.sourceRoleId === role.roleId
      && candidate.requiredOptionId === optionId
    ));
    if (!policy) {
      throw new PermissionDeniedError(`情境包未授权该岗位事件策略：${role.roleId}/${intentType}`);
    }
    if (!state.scenario.approvalPolicies.some((item) => (
      item.approvalPolicyId === policy.approvalPolicyId
      && item.reviewMode === "teacher_required"
    ))) {
      throw new InvalidWorldActionError(`事件策略缺少强制教师复核门：${policy.policyId}`);
    }
    return policy;
  }

  private candidate(input: CandidateDraftInput): CandidateEvent {
    const { now, ...candidate } = input;
    return CandidateEventSchema.parse({ ...candidate, candidateId: this.#ids.next("candidate"), status: "pending", proposedAt: now });
  }

  private evidence(state: WorldState, command: Command, input: {
    nodeId: string;
    action: string;
    basis: string;
    materialRefs?: string[];
    eventRefs?: string[];
    observationRefs?: string[];
    artifactRevisionRefs?: string[];
    processingTaskRefs?: string[];
  }): Evidence {
    return EvidenceSchema.parse({
      evidenceId: this.#ids.next("evidence"),
      sessionId: state.sessionId,
      nodeId: input.nodeId,
      actorId: command.actorId,
      action: input.action,
      basis: input.basis,
      materialRefs: input.materialRefs ?? [],
      eventRefs: input.eventRefs ?? [],
      observationRefs: input.observationRefs ?? [],
      artifactRevisionRefs: input.artifactRevisionRefs ?? [],
      processingTaskRefs: input.processingTaskRefs ?? [],
      createdAt: this.#clock.now(),
      visibility: assignedVisibility,
    });
  }

  private messageDraft(input: {
    eventType?: "agent_message_posted" | "role_message_posted";
    actorId: string;
    roleId: RoleContract["roleId"];
    displayName: string;
    content: string;
    visibility: VisibilityScope[];
    visibleToActorIds?: string[];
    channel?: "announcement" | "role_interaction";
    threadId?: string | null;
    replyToMessageId?: string | null;
    interactionId?: string | null;
    interactionKind?: RoleInteractionRequest["kind"] | null;
    responseAct?: RoleResponseAct | null;
    topic?: RoleInteractionRequest["topic"] | null;
    stance?: RoleStance | null;
    commitment?: RoleCommitment | null;
    turn?: number | null;
    recipientActorIds?: string[];
    sourceRefs?: string[];
    now: string;
  }): EventDraft {
    const visibleToActorIds = input.visibility.includes("role_private")
      ? [...new Set([input.actorId, ...(input.visibleToActorIds ?? [])])]
      : input.visibleToActorIds;
    const message = RoleMessageSchema.parse({
      messageId: this.#ids.next("role-message"),
      actorId: input.actorId,
      roleId: input.roleId,
      displayName: input.displayName,
      content: input.content,
      timestamp: input.now,
      relatedEventId: null,
      visibility: input.visibility,
      channel: input.channel ?? "announcement",
      threadId: input.threadId ?? null,
      replyToMessageId: input.replyToMessageId ?? null,
      interactionId: input.interactionId ?? null,
      interactionKind: input.interactionKind ?? null,
      responseAct: input.responseAct ?? null,
      topic: input.topic ?? null,
      stance: input.stance ?? null,
      commitment: input.commitment ?? null,
      turn: input.turn ?? null,
      recipientActorIds: input.recipientActorIds ?? [],
      sourceRefs: input.sourceRefs ?? [],
    });
    return {
      eventType: input.eventType ?? "agent_message_posted",
      actorId: input.actorId,
      summary: `${input.displayName}发送岗位消息`,
      visibility: input.visibility,
      ...(visibleToActorIds ? { visibleToActorIds } : {}),
      payload: { message },
    };
  }

  private async commit(
    sessionId: string,
    expectedVersion: number,
    drafts: EventDraft[],
    correlationId: string,
    sessionEpoch: string,
    causalDepth: number,
    actionContext: ActionAuditContext | null = null,
  ): Promise<WorldEvent[]> {
    const release = this.#sessionReleases.get(sessionId);
    if (!release) throw new Error(`会话尚未固定情境发布版：${sessionId}`);
    const scenario = release.package;
    const events = drafts.map((draft, index) => {
      const visibleToActorIds = draft.visibleToActorIds ?? [];
      if (draft.visibility.includes("role_private") && visibleToActorIds.length === 0) {
        throw new InvalidWorldActionError("role_private 世界事件必须声明非空角色实例白名单");
      }
      const baseAudience = draft.audience ?? resourceAudience({
        scenario,
        sessionId,
        sessionEpoch,
        visibility: draft.visibility,
        actorId: draft.actorId,
        visibleToActorIds,
        ...(draft.payload ? { payload: draft.payload } : {}),
      });
      const audience = directorObservableAudience({
        scenario,
        eventType: draft.eventType,
        visibility: draft.visibility,
        audience: baseAudience,
      });
      const payload: Record<string, unknown> = { ...(draft.payload ?? {}) };
      for (const key of ["fact", "evidence", "message"] as const) {
        const value = payload[key];
        if (value && typeof value === "object" && !Array.isArray(value) && !("audience" in value)) {
          payload[key] = { ...value, audience };
        }
      }
      return WorldEventSchema.parse({
        ...createMessageMeta({
          sessionId,
          sceneId: scenario.scenarioId,
          actorId: draft.actorId,
          correlationId,
          timestamp: this.#clock.now(),
        }),
        kind: "WorldEvent",
        eventId: this.#ids.next("event"),
        eventType: draft.eventType,
        stateVersion: expectedVersion + index + 1,
        visibility: draft.visibility,
        visibleToActorIds,
        audience,
        summary: draft.summary,
        payload,
        actionContext,
      });
    });
    const outboxRecords = events.map((event) => OutboxRecordSchema.parse({
      outboxId: this.#ids.next("outbox"),
      sessionId,
      sessionEpoch,
      sceneId: event.sceneId,
      eventId: event.eventId,
      eventType: event.eventType,
      stateVersion: event.stateVersion,
      correlationId: event.correlationId,
      topic: "world_event",
      causalDepth,
      status: "pending",
      attempts: 0,
      availableAt: event.timestamp,
      createdAt: event.timestamp,
      deliveredAt: null,
      lastErrorCode: null,
    }));
    await this.store.append(sessionId, expectedVersion, events, outboxRecords);
    for (const event of events) await this.bus.publish(event);
    return events;
  }
}
