import {
  AgentRunRequestSchema,
  EvidenceSchema,
  EvaluationArbitrationSchema,
  FlagshipCollaborationEventId,
  FlagshipCollaborationTaskAnchorId,
  createMessageMeta,
  type AgentRunRequest,
  type AgentRunResult,
  type ResourceAudience,
} from "@ronggang/contracts";
import {
  VersionedContextAssembler,
  createAccessSubject,
  createResourceAudience,
} from "@ronggang/context-engine";
import {
  assistanceAgentDefinitions,
  assistanceProfilesByAgentId,
  type AgentRuntime,
} from "@ronggang/agent-runtime";
import type { IdGenerator } from "@ronggang/world-core";
import type {
  AgentTaskHandler,
  AgentTaskHandlerInput,
} from "./ports.js";

export interface AssistanceAgentRunner {
  run(
    definition: Parameters<AgentRuntime["run"]>[0],
    request: AgentRunRequest,
  ): Promise<AgentRunResult>;
}

export class AssistanceTaskInputError extends Error {
  readonly code: string;
  readonly retryable = false;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AssistanceTaskInputError";
    this.code = code;
  }
}

function helperAudience(input: AgentTaskHandlerInput): ResourceAudience {
  const role = input.projection.role;
  return createResourceAudience({
    scopes: ["role_private", "audit_only"],
    courseId: input.projection.scenario.courseId,
    sessionId: input.projection.sessionId,
    sessionEpoch: input.projection.sessionEpoch,
    teamIds: [role.teamId],
    roleIds: [role.roleId],
    actorIds: [role.agentId],
    privateNamespaces: [
      input.task.instanceContext.privateMemoryNamespaceRef,
    ],
    auditReadable: true,
  });
}

function evidenceRefsForTask(input: AgentTaskHandlerInput): string[] {
  return input.projection.evidence.map((evidence) => evidence.evidenceId);
}

function flagshipCollaborationCausationEventId(
  input: AgentTaskHandlerInput,
): string | null {
  if (
    input.projection.currentTaskAnchor.taskId
      === FlagshipCollaborationTaskAnchorId
    && input.projection.currentTaskAnchor.sourceEventId
  ) {
    return input.projection.currentTaskAnchor.sourceEventId;
  }
  return input.projection.structuredWorld?.eventCards.find((card) => (
    card.dynamicEventId === FlagshipCollaborationEventId
    && card.eventType === "scenario_intervention_applied"
    && card.affectedTaskIds.includes(FlagshipCollaborationTaskAnchorId)
  ))?.sourceEventId ?? null;
}

export class AssistanceTaskHandler implements AgentTaskHandler {
  readonly handlerId = "assistance/full-flow/v1";
  readonly #runtime: AssistanceAgentRunner;
  readonly #contextAssembler: VersionedContextAssembler;
  readonly #now: () => string;
  readonly #nextId: IdGenerator["next"];

  constructor(input: {
    runtime: AssistanceAgentRunner | AgentRuntime;
    contextAssembler?: VersionedContextAssembler;
    now?: () => string;
    nextId?: IdGenerator["next"];
  }) {
    this.#runtime = input.runtime;
    this.#contextAssembler = input.contextAssembler
      ?? new VersionedContextAssembler();
    this.#now = input.now ?? (() => new Date().toISOString());
    this.#nextId = input.nextId
      ?? ((prefix) => `${prefix}-${crypto.randomUUID()}`);
  }

  matches(
    task: AgentTaskHandlerInput["task"],
    triggerEvent: AgentTaskHandlerInput["triggerEvent"],
  ): boolean {
    const profile = assistanceProfilesByAgentId.get(task.agentId);
    const definition = assistanceAgentDefinitions.get(task.agentId);
    return Boolean(
      profile?.active
      && definition
      && task.roleSnapshot
      && task.roleId === definition.roleId
      && task.definitionVersion === definition.definitionVersion
      && task.promptVersion === definition.promptVersion
      && profile.triggerEvents.includes(triggerEvent.eventType),
    );
  }

  async run(input: AgentTaskHandlerInput): Promise<AgentRunResult> {
    const profile = assistanceProfilesByAgentId.get(input.task.agentId);
    const definition = assistanceAgentDefinitions.get(input.task.agentId);
    if (!profile?.active || !definition || !input.task.roleSnapshot) {
      throw new AssistanceTaskInputError(
        "assistance_definition_missing",
        "辅助任务没有命中活动模板、定义与固定角色快照",
      );
    }
    const role = input.projection.role;
    if (
      role.agentId !== input.task.agentId
      || role.roleId !== input.task.roleId
      || role.actorKind !== "agent"
      || role.teamId !== input.task.instanceContext.teamId
    ) {
      throw new AssistanceTaskInputError(
        "assistance_projection_identity_mismatch",
        "辅助任务与授权投影身份不一致",
      );
    }
    const subjectActorId = input.task.instanceContext.subjectActorId;
    if (!subjectActorId) {
      throw new AssistanceTaskInputError(
        "assistance_subject_missing",
        "辅助任务缺少固定目标主体",
      );
    }

    const fixed = [
      `模板：${profile.templateId}@${profile.templateVersion}`,
      `独立职责：${profile.responsibility}`,
      `权限边界：${profile.permissionBoundary}`,
      `上下文边界：${profile.contextBoundary}`,
      `输出契约：${profile.outputSchemaRef}`,
      "本轮只形成 advisory_only 建议；不得完成学生任务、改写成果、发布内容、推进世界或形成最终成绩。",
    ];
    const transient: Array<{
      itemId: string;
      content: string;
      source: string;
      version: string;
      audience: ResourceAudience;
    }> = [];
    const collaborationCausationEventId =
      flagshipCollaborationCausationEventId(input);
    const signals: AgentRunRequest["signals"] = {
      subjectActorId,
      evidenceRefs: JSON.stringify(evidenceRefsForTask(input)),
      ...(collaborationCausationEventId
        ? {
            currentTaskAnchorEventId: collaborationCausationEventId,
          }
        : {}),
    };
    let query = profile.responsibility;
    const audience = helperAudience(input);

    if (profile.kind === "evidence_coaching") {
      const evidence = EvidenceSchema.safeParse(
        input.triggerEvent.payload.evidence,
      );
      if (
        !evidence.success
        || evidence.data.actorId !== subjectActorId
        || !input.projection.evidence.some(
          (item) => item.evidenceId === evidence.data.evidenceId,
        )
      ) {
        throw new AssistanceTaskInputError(
          "assistance_evidence_binding_invalid",
          "证据教练没有命中目标学生本人可见的固定证据",
        );
      }
      query = "针对学生刚形成的判断指出证据缺口、追问和核验路径";
      transient.push({
        itemId: `assistance-evidence:${evidence.data.evidenceId}`,
        content: JSON.stringify({
          evidenceId: evidence.data.evidenceId,
          action: evidence.data.action,
          basis: evidence.data.basis,
          materialRefs: evidence.data.materialRefs,
          eventRefs: evidence.data.eventRefs,
          observationRefs: evidence.data.observationRefs,
          artifactRevisionRefs: evidence.data.artifactRevisionRefs,
          processingTaskRefs: evidence.data.processingTaskRefs,
        }),
        source: input.triggerEvent.eventId,
        version: evidence.data.createdAt,
        audience,
      });
    } else if (profile.kind === "material_understanding") {
      const mediaTaskId = String(input.triggerEvent.payload.taskId ?? "");
      const mediaTask = input.projection.mediaProcessingTasks.find(
        (item) => item.taskId === mediaTaskId,
      );
      const material = mediaTask
        ? input.projection.materials.find((item) => (
            item.materialId === mediaTask.materialId
            && item.version === mediaTask.materialVersion
          ))
        : null;
      if (
        !mediaTask
        || !material
        || mediaTask.requestedBy !== subjectActorId
        || input.task.instanceContext.resourceRef?.objectId
          !== mediaTask.taskId
      ) {
        throw new AssistanceTaskInputError(
          "assistance_material_binding_invalid",
          "材料理解任务没有命中目标学生可见的固定材料与处理档案",
        );
      }
      query = "把固定处理档案整理为观察、实体、待核声明、时间和来源片段";
      signals.resourceType = "media_processing_task";
      signals.resourceId = mediaTask.taskId;
      signals.resourceVersion = mediaTask.inputContentHash;
      signals.materialId = material.materialId;
      signals.materialVersion = material.version;
      transient.push({
        itemId: `assistance-media-task:${mediaTask.taskId}`,
        content: JSON.stringify({
          taskId: mediaTask.taskId,
          status: mediaTask.status,
          materialId: mediaTask.materialId,
          materialVersion: mediaTask.materialVersion,
          steps: mediaTask.steps.map((step) => ({
            stepId: step.stepId,
            capability: step.capability,
            status: step.status,
            output: step.output,
            errorCode: step.lastErrorCode,
          })),
        }),
        source: input.triggerEvent.eventId,
        version: mediaTask.inputContentHash,
        audience,
      });
    } else if (profile.kind === "evaluation_review") {
      const arbitration = EvaluationArbitrationSchema.safeParse(
        input.triggerEvent.payload.arbitration,
      );
      const evaluationCase = arbitration.success
        ? input.projection.evaluationCases.find((item) => (
            item.evaluationCaseId === arbitration.data.evaluationCaseId
          ))
        : null;
      if (
        !arbitration.success
        || !evaluationCase
        || input.task.instanceContext.resourceRef?.objectId
          !== arbitration.data.arbitrationId
      ) {
        throw new AssistanceTaskInputError(
          "assistance_evaluation_binding_invalid",
          "评价复核任务没有命中教师可管理的固定案件与仲裁",
        );
      }
      const proposals = input.projection.evaluationProposals.filter(
        (proposal) => arbitration.data.proposalIds.includes(
          proposal.proposalId,
        ),
      );
      const dimensionDifferences = evaluationCase.dimensions.map(
        (dimension) => {
          const proposalScores = proposals.flatMap((proposal) => (
            proposal.dimensions
              .filter((item) => item.dimensionId === dimension.dimensionId)
              .map((item) => item.scoreSuggestion)
          ));
          return {
            dimensionId: dimension.dimensionId,
            proposalScores,
            spread: proposalScores.length > 0
              ? Math.max(...proposalScores) - Math.min(...proposalScores)
              : 0,
          };
        },
      ).sort((left, right) => (
        right.spread - left.spread
        || left.dimensionId.localeCompare(right.dimensionId)
      ));
      query = "定位固定评价案件的逐维分歧、证据缺口和教师复核顺序";
      signals.resourceType = "evaluation_arbitration";
      signals.resourceId = arbitration.data.arbitrationId;
      signals.resourceVersion = arbitration.data.decisionHash;
      signals.evaluationCaseId = arbitration.data.evaluationCaseId;
      signals.arbitrationId = arbitration.data.arbitrationId;
      signals.dimensionDifferences = JSON.stringify(dimensionDifferences);
      transient.push({
        itemId: `assistance-arbitration:${arbitration.data.arbitrationId}`,
        content: JSON.stringify({
          evaluationCaseId: evaluationCase.evaluationCaseId,
          dimensions: evaluationCase.dimensions,
          arbitration: arbitration.data,
          proposals: proposals.map((proposal) => ({
            proposalId: proposal.proposalId,
            evaluatorKind: proposal.evaluatorKind,
            status: proposal.status,
            dimensions: proposal.dimensions,
          })),
        }),
        source: input.triggerEvent.eventId,
        version: arbitration.data.decisionHash,
        audience,
      });
    } else {
      throw new AssistanceTaskInputError(
        "assistance_template_not_activated",
        `模板尚未进入本切片的活动链：${profile.kind}`,
      );
    }

    const access = createAccessSubject({
      role,
      sessionId: input.projection.sessionId,
      sessionEpoch: input.projection.sessionEpoch,
      courseId: input.projection.scenario.courseId,
      purpose: "runtime",
    });
    const assembled = await this.#contextAssembler.assemble({
      query,
      subject: access,
      scenarioVersion: input.scenario.version,
      scenarioContentHash: input.projection.scenario.contentHash,
      nodeId: input.projection.currentNode.nodeId,
      stateVersion: input.projection.stateVersion,
      tokenBudget: role.tokenBudget,
      chunks: input.scenario.knowledgeChunks,
      facts: input.projection.facts,
      evidence: input.projection.evidence,
      fixed,
      transient,
      assembledAt: this.#now(),
    });
    const now = this.#now();
    const request = AgentRunRequestSchema.parse({
      ...createMessageMeta({
        sessionId: input.projection.sessionId,
        sceneId: input.scenario.scenarioId,
        actorId: role.agentId,
        correlationId: input.task.correlationId,
        timestamp: now,
      }),
      kind: "AgentRunRequest",
      taskId: input.task.taskId,
      agentRunId: this.#nextId("agent-run"),
      templateRef: input.task.templateRef,
      instanceRef: input.task.instanceRef,
      role,
      trigger: {
        type: input.task.triggerEventType,
        sourceId: input.task.triggerEventId,
      },
      stateVersion: input.task.expectedStateVersion,
      access,
      context: assembled.context,
      contextManifest: assembled.manifest,
      signals,
    });
    return this.#runtime.run(definition, request);
  }
}
