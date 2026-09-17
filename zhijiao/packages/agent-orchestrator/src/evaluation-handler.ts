import {
  AgentRunRequestSchema,
  EvaluationCaseSchema,
  EvaluationEvidenceBundleSchema,
  createMessageMeta,
  type AgentDefinition,
  type AgentRunRequest,
  type AgentRunResult,
  type EvaluationEvaluatorKind,
} from "@ronggang/contracts";
import {
  VersionedContextAssembler,
  createAccessSubject,
  createResourceAudience,
  type ContextAssemblyResult,
} from "@ronggang/context-engine";
import {
  learningCuratorAgentDefinition,
  LearningCuratorInputSchema,
  semanticEvaluatorDefinitions,
  semanticEvaluatorProfiles,
  type AgentRuntime,
} from "@ronggang/agent-runtime";
import type { IdGenerator } from "@ronggang/world-core";
import type {
  AgentTaskHandler,
  AgentTaskHandlerInput,
} from "./ports.js";

const evaluatorDefinitions: ReadonlyMap<string, AgentDefinition> =
  semanticEvaluatorDefinitions;

export interface EvaluationAgentRunner {
  run(
    definition: AgentDefinition,
    request: AgentRunRequest,
  ): Promise<AgentRunResult>;
}

type AgentTaskDiagnosticValue = string | number | boolean | null;

export class AgentTaskInputError extends Error {
  readonly code: string;
  readonly retryable = false;
  readonly diagnostic: Readonly<Record<string, AgentTaskDiagnosticValue>>;

  constructor(
    code: string,
    message: string,
    diagnostic: Record<string, AgentTaskDiagnosticValue> = {},
  ) {
    super(message);
    this.name = "AgentTaskInputError";
    this.code = code;
    this.diagnostic = Object.freeze({ ...diagnostic });
  }
}

abstract class BaseEvaluationTaskHandler implements AgentTaskHandler {
  abstract readonly handlerId: string;
  abstract matches(
    task: AgentTaskHandlerInput["task"],
    triggerEvent: AgentTaskHandlerInput["triggerEvent"],
  ): boolean;
  abstract run(input: AgentTaskHandlerInput): Promise<AgentRunResult>;

  protected readonly runtime: EvaluationAgentRunner;
  protected readonly contextAssembler: VersionedContextAssembler;
  protected readonly now: () => string;
  protected readonly nextId: IdGenerator["next"];

  constructor(input: {
    runtime: EvaluationAgentRunner | AgentRuntime;
    contextAssembler?: VersionedContextAssembler;
    now?: () => string;
    nextId?: IdGenerator["next"];
  }) {
    this.runtime = input.runtime;
    this.contextAssembler = input.contextAssembler ?? new VersionedContextAssembler();
    this.now = input.now ?? (() => new Date().toISOString());
    this.nextId = input.nextId ?? ((prefix) => `${prefix}-${crypto.randomUUID()}`);
  }

  protected assertIdentity(input: AgentTaskHandlerInput): void {
    if (
      input.projection.role.agentId !== input.task.agentId
      || input.projection.role.roleId !== input.task.roleId
      || input.projection.role.actorKind !== "agent"
    ) {
      throw new AgentTaskInputError(
        "agent_projection_identity_mismatch",
        "评价或学习任务与授权投影身份不一致",
        {
          stage: "identity",
          agentMatched:
            input.projection.role.agentId === input.task.agentId,
          roleMatched: input.projection.role.roleId === input.task.roleId,
          actorKindMatched: input.projection.role.actorKind === "agent",
          stateVersion: input.projection.stateVersion,
        },
      );
    }
  }

  protected access(input: AgentTaskHandlerInput) {
    return createAccessSubject({
      role: input.projection.role,
      sessionId: input.projection.sessionId,
      sessionEpoch: input.projection.sessionEpoch,
      courseId: input.projection.scenario.courseId,
      purpose: "runtime",
    });
  }

  protected audience(input: AgentTaskHandlerInput) {
    return createResourceAudience({
      scopes: ["role_private", "audit_only"],
      courseId: input.projection.scenario.courseId,
      sessionId: input.projection.sessionId,
      sessionEpoch: input.projection.sessionEpoch,
      teamIds: [input.projection.role.teamId],
      roleIds: [input.projection.role.roleId],
      actorIds: [input.projection.role.agentId],
      auditReadable: true,
    });
  }

  protected async context(input: {
    taskInput: AgentTaskHandlerInput;
    query: string;
    fixed: string[];
    evidenceIds: readonly string[];
    missingEvidenceCode: string;
    transient: Array<{
      itemId: string;
      content: string;
      source: string;
      version: string;
    }>;
  }): Promise<ContextAssemblyResult> {
    const evidenceById = new Map(
      input.taskInput.projection.evidence.map((evidence) => [
        evidence.evidenceId,
        evidence,
      ]),
    );
    const missingEvidenceCount = input.evidenceIds.filter(
      (evidenceId) => !evidenceById.has(evidenceId),
    ).length;
    if (missingEvidenceCount > 0) {
      throw new AgentTaskInputError(
        input.missingEvidenceCode,
        "固定任务证据不在当前智能体授权投影中",
        {
          stage: "evidence_projection",
          projectedEvidenceCount: evidenceById.size,
          requiredEvidenceCount: input.evidenceIds.length,
          missingEvidenceCount,
          stateVersion: input.taskInput.projection.stateVersion,
        },
      );
    }
    const evidence = input.evidenceIds.map(
      (evidenceId) => evidenceById.get(evidenceId)!,
    );
    const audience = this.audience(input.taskInput);
    return this.contextAssembler.assemble({
      query: input.query,
      subject: this.access(input.taskInput),
      scenarioVersion: input.taskInput.scenario.version,
      scenarioContentHash: input.taskInput.projection.scenario.contentHash,
      nodeId: input.taskInput.projection.currentNode.nodeId,
      stateVersion: input.taskInput.projection.stateVersion,
      tokenBudget: input.taskInput.projection.role.tokenBudget,
      chunks: [],
      facts: [],
      evidence,
      fixed: input.fixed,
      transient: input.transient.map((item) => ({ ...item, audience })),
      assembledAt: this.now(),
    });
  }

  protected request(
    input: AgentTaskHandlerInput,
    context: ContextAssemblyResult,
    signals: AgentRunRequest["signals"],
  ): AgentRunRequest {
    const now = this.now();
    return AgentRunRequestSchema.parse({
      ...createMessageMeta({
        sessionId: input.projection.sessionId,
        sceneId: input.scenario.scenarioId,
        actorId: input.projection.role.agentId,
        correlationId: input.task.correlationId,
        timestamp: now,
      }),
      kind: "AgentRunRequest",
      taskId: input.task.taskId,
      agentRunId: this.nextId("agent-run"),
      templateRef: input.task.templateRef,
      instanceRef: input.task.instanceRef,
      role: input.projection.role,
      trigger: {
        type: input.task.triggerEventType,
        sourceId: input.task.triggerEventId,
      },
      stateVersion: input.task.expectedStateVersion,
      access: this.access(input),
      context: context.context,
      contextManifest: context.manifest,
      signals,
    });
  }
}

function profileForTask(input: AgentTaskHandlerInput) {
  return semanticEvaluatorProfiles.find(
    (profile) => profile.agentId === input.task.agentId,
  );
}

export class SemanticEvaluationTaskHandler
extends BaseEvaluationTaskHandler {
  readonly handlerId = "evaluation/semantic/v1";

  matches(
    task: AgentTaskHandlerInput["task"],
    triggerEvent: AgentTaskHandlerInput["triggerEvent"],
  ): boolean {
    const definition = evaluatorDefinitions.get(task.agentId);
    return Boolean(
      definition
      && task.roleId === definition.roleId
      && task.definitionVersion === definition.definitionVersion
      && task.promptVersion === definition.promptVersion
      && (
        triggerEvent.eventType === "evaluation_case_opened"
        || triggerEvent.eventType === "evaluation_branch_retry_requested"
      ),
    );
  }

  async run(input: AgentTaskHandlerInput): Promise<AgentRunResult> {
    this.assertIdentity(input);
    const definition = evaluatorDefinitions.get(input.task.agentId);
    const profile = profileForTask(input);
    if (!definition || !profile) {
      throw new AgentTaskInputError(
        "evaluation_definition_missing",
        "评价任务缺少固定智能体定义",
        {
          stage: "definition",
          definitionPresent: Boolean(definition),
          profilePresent: Boolean(profile),
        },
      );
    }
    const evaluationCaseResult = EvaluationCaseSchema.safeParse(
      input.triggerEvent.payload.evaluationCase,
    );
    if (!evaluationCaseResult.success) {
      throw new AgentTaskInputError(
        "evaluation_case_snapshot_invalid",
        "评价触发事件中的案件快照无效",
        {
          stage: "case_snapshot",
          issueCount: evaluationCaseResult.error.issues.length,
        },
      );
    }
    const evidenceBundleResult = EvaluationEvidenceBundleSchema.safeParse(
      input.triggerEvent.payload.evidenceBundle,
    );
    if (!evidenceBundleResult.success) {
      throw new AgentTaskInputError(
        "evaluation_evidence_bundle_snapshot_invalid",
        "评价触发事件中的证据包快照无效",
        {
          stage: "evidence_bundle_snapshot",
          issueCount: evidenceBundleResult.error.issues.length,
        },
      );
    }
    const evaluationCase = evaluationCaseResult.data;
    const evidenceBundle = evidenceBundleResult.data;
    if (
      evaluationCase.evidenceBundleId !== evidenceBundle.bundleId
      || evaluationCase.evidenceBundleHash !== evidenceBundle.bundleHash
      || evaluationCase.sessionEpoch !== input.projection.sessionEpoch
    ) {
      throw new AgentTaskInputError(
        "evaluation_case_bundle_mismatch",
        "评价案件、证据包或会话世代不一致",
        {
          stage: "case_bundle_binding",
          bundleIdMatched:
            evaluationCase.evidenceBundleId === evidenceBundle.bundleId,
          bundleHashMatched:
            evaluationCase.evidenceBundleHash === evidenceBundle.bundleHash,
          sessionEpochMatched:
            evaluationCase.sessionEpoch === input.projection.sessionEpoch,
        },
      );
    }
    const evidenceIds = evidenceBundle.evidenceRefs.map(
      (reference) => reference.evidenceId,
    );
    const artifactRevision = profile.evaluatorKind === "work_quality"
      ? input.projection.artifactRevisions.find(
          (revision) => revision.revisionId === evidenceBundle.revisionId,
        )
      : null;
    if (profile.evaluatorKind === "work_quality" && !artifactRevision) {
      throw new AgentTaskInputError(
        "evaluation_revision_missing",
        "作品质量评价引用的固定修订不在授权投影中",
        {
          stage: "artifact_revision",
          projectedRevisionCount: input.projection.artifactRevisions.length,
        },
      );
    }
    if (
      profile.evaluatorKind === "work_quality"
      && artifactRevision
      && artifactRevision.artifactId !== evidenceBundle.artifactId
    ) {
      throw new AgentTaskInputError(
        "evaluation_revision_identity_mismatch",
        "作品质量评价引用的成果与固定证据包不一致",
        {
          stage: "artifact_revision",
          revisionBytes: JSON.stringify(artifactRevision).length,
        },
      );
    }
    if (
      profile.evaluatorKind === "work_quality"
      && artifactRevision
      && artifactRevision.contentHash !== evidenceBundle.revisionContentHash
    ) {
      throw new AgentTaskInputError(
        "evaluation_revision_hash_mismatch",
        "作品质量评价引用的修订内容哈希与固定证据包不一致",
        {
          stage: "artifact_revision",
          revisionBytes: JSON.stringify(artifactRevision).length,
        },
      );
    }
    const context = await this.context({
      taskInput: input,
      query: `按 ${profile.evaluatorKind} 职责逐维评价固定成果修订`,
      fixed: [
        `评价器：${profile.label} (${profile.evaluatorKind})`,
        profile.focus,
        `案件：${evaluationCase.evaluationCaseId}@${evaluationCase.caseRevision}`,
        `案件哈希：${evaluationCase.caseHash}`,
        `证据包哈希：${evidenceBundle.bundleHash}`,
        `量规：${evaluationCase.rubricId}@${evaluationCase.rubricVersion} / ${evaluationCase.rubricHash}`,
        `allowedEvidenceRefs：${evidenceIds.join(",")}`,
        "模型只能形成 record_evaluation_proposal 意图；最终成绩由确定性仲裁和教师终评产生。",
      ],
      evidenceIds,
      missingEvidenceCode: "evaluation_evidence_projection_missing",
      transient: [
        {
          itemId: `evaluation-case:${evaluationCase.evaluationCaseId}`,
          content: JSON.stringify({
            evaluationCaseId: evaluationCase.evaluationCaseId,
            dimensions: evaluationCase.dimensions,
          }),
          source: input.triggerEvent.eventId,
          version: String(evaluationCase.caseRevision),
        },
        {
          itemId: `evidence-bundle:${evidenceBundle.bundleId}`,
          content: JSON.stringify({
            submissionId: evidenceBundle.submissionId,
            revisionId: evidenceBundle.revisionId,
            revisionContentHash: evidenceBundle.revisionContentHash,
            evidenceRefs: evidenceBundle.evidenceRefs,
          }),
          source: evidenceBundle.bundleId,
          version: evidenceBundle.bundleHash,
        },
        ...(artifactRevision ? [{
          itemId: `artifact-revision:${artifactRevision.revisionId}`,
          content: JSON.stringify({
            title: artifactRevision.title,
            summary: artifactRevision.summary,
            sections: artifactRevision.sections,
            citations: artifactRevision.citations,
            revisionNote: artifactRevision.revisionNote,
            contentHash: artifactRevision.contentHash,
          }),
          source: artifactRevision.revisionId,
          version: artifactRevision.contentHash,
        }] : []),
      ],
    });
    const request = this.request(input, context, {
      evaluatorKind: profile.evaluatorKind,
      evaluationCase: JSON.stringify(evaluationCase),
      evidenceBundle: JSON.stringify(evidenceBundle),
      allowedEvidenceRefs: evidenceIds.join(","),
    });
    return this.runtime.run(definition, request);
  }
}

function reviewFromInput(input: AgentTaskHandlerInput) {
  const parsed = LearningCuratorInputSchema.safeParse(
    input.triggerEvent.payload.learningInput,
  );
  if (!parsed.success) {
    throw new AgentTaskInputError(
      "learning_input_snapshot_invalid",
      "学习策展触发事件缺少严格、安全的 learningInput 快照",
      {
        stage: "learning_input_snapshot",
        issueCount: parsed.error.issues.length,
      },
    );
  }
  return parsed.data;
}

export class LearningCuratorTaskHandler extends BaseEvaluationTaskHandler {
  readonly handlerId = "learning-curator/teacher-reviewed/v1";

  matches(
    task: AgentTaskHandlerInput["task"],
    triggerEvent: AgentTaskHandlerInput["triggerEvent"],
  ): boolean {
    return (
      task.agentId === learningCuratorAgentDefinition.agentId
      && task.roleId === learningCuratorAgentDefinition.roleId
      && task.definitionVersion === learningCuratorAgentDefinition.definitionVersion
      && task.promptVersion === learningCuratorAgentDefinition.promptVersion
      && (
        triggerEvent.eventType === "teacher_reviewed"
        || triggerEvent.eventType
          === "learning_candidate_generation_retry_requested"
      )
    );
  }

  async run(input: AgentTaskHandlerInput): Promise<AgentRunResult> {
    this.assertIdentity(input);
    const review = reviewFromInput(input);
    const evidenceIds = [...new Set(
      review.dimensions.flatMap((dimension) => dimension.evidenceRefs),
    )].sort();
    if (evidenceIds.length === 0) {
      throw new AgentTaskInputError(
        "learning_evidence_missing",
        "教师终评没有可用于监督进化的授权证据",
        {
          stage: "learning_evidence",
          dimensionCount: review.dimensions.length,
        },
      );
    }
    const evaluationCase = input.projection.evaluationCases.find(
      (candidate) => candidate.evaluationCaseId === review.evaluationCaseId,
    );
    if (!evaluationCase) {
      throw new AgentTaskInputError(
        "learning_evaluation_case_missing",
        "教师终评引用的评价案件不在授权投影中",
        {
          stage: "learning_evaluation_case",
          projectedCaseCount: input.projection.evaluationCases.length,
        },
      );
    }
    const context = await this.context({
      taskInput: input,
      query: "从教师公开终评与固定证据中提炼待审核 assessment_example",
      fixed: [
        `终评：${review.reviewId} / ${review.finalHash}`,
        `评价案件：${review.evaluationCaseId}`,
        `公开总结：${review.publicSummary}`,
        `allowedEvidenceRefs：${evidenceIds.join(",")}`,
        "教师 internalNote、reviewedBy、请求 ID 和模型提供方细节不得进入策展上下文。",
        "候选必须保持 pending_review；模型不得批准、发布或回滚。",
      ],
      evidenceIds,
      missingEvidenceCode: "learning_evidence_projection_missing",
      transient: [{
        itemId: `teacher-review-public:${review.reviewId}`,
        content: JSON.stringify({
          evaluationCaseId: review.evaluationCaseId,
          finalScore: review.finalScore,
          publicSummary: review.publicSummary,
          dimensions: review.dimensions.map((dimension) => ({
            dimensionId: dimension.dimensionId,
            finalScore: dimension.finalScore,
            maxScore: dimension.maxScore,
            publicFeedback: dimension.publicFeedback,
            evidenceRefs: dimension.evidenceRefs,
          })),
        }),
        source: input.triggerEvent.eventId,
        version: review.finalHash,
      }],
    });
    const request = this.request(input, context, {
      teacherReview: JSON.stringify(review),
      evaluationCaseId: evaluationCase.evaluationCaseId,
      finalAssessmentId: review.reviewId,
      allowedEvidenceRefs: evidenceIds.join(","),
    });
    return this.runtime.run(learningCuratorAgentDefinition, request);
  }
}

export function evaluatorKindForAgent(
  agentId: string,
): Exclude<EvaluationEvaluatorKind, "rule"> | null {
  return semanticEvaluatorProfiles.find(
    (profile) => profile.agentId === agentId,
  )?.evaluatorKind ?? null;
}
