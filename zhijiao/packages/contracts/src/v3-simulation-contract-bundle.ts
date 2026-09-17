import { z } from "zod";
import {
  AdminAgentCollaborationEpisodeV3Schema,
  AgentCollaborationEpisodeV3Schema,
  TeacherAgentCollaborationEpisodeV3Schema,
} from "./agent-collaboration-episode-v3.js";
import {
  AssessmentDecisionSchema,
  ChallengeAssignmentSchema,
  CompetencyEvidenceEpisodeSchema,
  LearnerSimulationForecastSchema,
  LearnerTwinProfileSchema,
  PersonalizedLearningPlanSchema,
} from "./learning-adaptation-v3.js";
import {
  AgentObservationSchema,
  AgentStateSchema,
  SimulationAgentIntentSchema,
  SimulationResolutionSchema,
  StudentWorkActionSchema,
  WorldSimulationReleaseSchema,
  WorldSnapshotSchema,
} from "./world-simulation-v3.js";

function sameReference(
  left: { releaseId: string; version: number; contentHash: string },
  right: { releaseId: string; version: number; contentHash: string },
): boolean {
  return left.releaseId === right.releaseId
    && left.version === right.version
    && left.contentHash === right.contentHash;
}

function sameCourseReference(
  left: { courseId: string; releaseId: string; version: number; contentHash: string },
  right: { courseId: string; releaseId: string; version: number; contentHash: string },
): boolean {
  return left.courseId === right.courseId && sameReference(left, right);
}

export const V3SimulationContractBundleSchema = z.object({
  simulationRelease: WorldSimulationReleaseSchema,
  worldSnapshot: WorldSnapshotSchema,
  agentState: AgentStateSchema,
  agentObservation: AgentObservationSchema,
  agentIntent: SimulationAgentIntentSchema,
  resolution: SimulationResolutionSchema,
  studentWorkAction: StudentWorkActionSchema,
  competencyEvidenceEpisode: CompetencyEvidenceEpisodeSchema,
  assessmentDecision: AssessmentDecisionSchema,
  learnerTwinProfile: LearnerTwinProfileSchema,
  learnerSimulationForecast: LearnerSimulationForecastSchema,
  challengeAssignment: ChallengeAssignmentSchema,
  personalizedLearningPlan: PersonalizedLearningPlanSchema,
  collaborationEpisode: AgentCollaborationEpisodeV3Schema,
}).strict().superRefine((bundle, context) => {
  const releaseRef = bundle.simulationRelease.simulationReleaseRef;
  const simulationConsumers = [
    ["worldSnapshot", bundle.worldSnapshot.simulationReleaseRef],
    ["agentState", bundle.agentState.simulationReleaseRef],
    ["competencyEvidenceEpisode", bundle.competencyEvidenceEpisode.simulationReleaseRef],
    ["assessmentDecision", bundle.assessmentDecision.simulationReleaseRef],
    ["learnerSimulationForecast", bundle.learnerSimulationForecast.simulationReleaseRef],
    ["challengeAssignment", bundle.challengeAssignment.simulationReleaseRef],
    ["collaborationEpisode", bundle.collaborationEpisode.simulationReleaseRef],
  ] as const;
  for (const [field, consumerRef] of simulationConsumers) {
    if (!sameReference(releaseRef, consumerRef)) {
      context.addIssue({
        code: "custom",
        path: [field, "simulationReleaseRef"],
        message: "V3 世界模拟版本或内容哈希漂移，必须失败关闭",
      });
    }
  }

  const courseRef = bundle.simulationRelease.courseReleaseRef;
  const courseConsumers = [
    ["competencyEvidenceEpisode", bundle.competencyEvidenceEpisode.courseReleaseRef],
    ["assessmentDecision", bundle.assessmentDecision.courseReleaseRef],
    ["collaborationEpisode", bundle.collaborationEpisode.courseReleaseRef],
  ] as const;
  for (const [field, consumerRef] of courseConsumers) {
    if (!sameCourseReference(courseRef, consumerRef)) {
      context.addIssue({
        code: "custom",
        path: [field, "courseReleaseRef"],
        message: "V3 课程发布版或内容哈希漂移，必须失败关闭",
      });
    }
  }

  const sessionId = bundle.worldSnapshot.sessionId;
  const sessionConsumers = [
    ["agentState", bundle.agentState.sessionId],
    ["agentObservation", bundle.agentObservation.sessionId],
    ["resolution", bundle.resolution.sessionId],
    ["studentWorkAction", bundle.studentWorkAction.sessionId],
    ["competencyEvidenceEpisode", bundle.competencyEvidenceEpisode.sessionId],
    ["assessmentDecision", bundle.assessmentDecision.sessionId],
    ["challengeAssignment", bundle.challengeAssignment.sessionId],
    ["collaborationEpisode", bundle.collaborationEpisode.sessionId],
  ] as const;
  for (const [field, consumerSessionId] of sessionConsumers) {
    if (consumerSessionId !== sessionId) {
      context.addIssue({
        code: "custom",
        path: [field, "sessionId"],
        message: "V3 运行链不得跨会话拼接引用",
      });
    }
  }

  const worldStateVersion = bundle.worldSnapshot.stateVersion;
  if (bundle.agentObservation.worldStateVersion !== worldStateVersion
    || bundle.agentIntent.expectedWorldStateVersion !== worldStateVersion
    || bundle.resolution.expectedWorldStateVersion !== worldStateVersion
    || bundle.studentWorkAction.expectedWorldStateVersion !== worldStateVersion
    || bundle.collaborationEpisode.sourceWorldStateVersion !== worldStateVersion) {
    context.addIssue({
      code: "custom",
      path: ["worldSnapshot", "stateVersion"],
      message: "观察、意图、学生动作、解析与 Episode 必须基于同一世界版本",
    });
  }

  if (bundle.agentObservation.agentStateId !== bundle.agentState.agentStateId
    || bundle.agentObservation.agentId !== bundle.agentState.agentId
    || bundle.agentIntent.agentStateId !== bundle.agentState.agentStateId
    || bundle.agentIntent.agentId !== bundle.agentState.agentId
    || bundle.agentIntent.observationId !== bundle.agentObservation.observationId) {
    context.addIssue({
      code: "custom",
      path: ["agentIntent"],
      message: "智能体观察、状态与意图必须来自同一真实运行链",
    });
  }

  if (bundle.collaborationEpisode.scenarioId
    !== bundle.simulationRelease.scenarioReleaseRef.scenarioId) {
    context.addIssue({
      code: "custom",
      path: ["collaborationEpisode", "scenarioId"],
      message: "协作 Episode 必须属于世界发布版冻结情境",
    });
  }

  const acceptedIntent = bundle.resolution.acceptedIntents.find(
    (intent) => intent.intentId === bundle.agentIntent.intentId,
  );
  if (bundle.resolution.status === "committed"
    && (acceptedIntent === undefined
      || acceptedIntent.agentTaskId !== bundle.agentIntent.agentTaskId
      || acceptedIntent.agentRunId !== bundle.agentIntent.agentRunId)) {
    context.addIssue({
      code: "custom",
      path: ["resolution", "acceptedIntents"],
      message: "正式解析必须引用当前真实 AgentTask、AgentRun 与意图",
    });
  }

  if (bundle.competencyEvidenceEpisode.challengeAssignmentRef
    !== bundle.challengeAssignment.challengeAssignmentId
    || bundle.assessmentDecision.challengeAssignmentRef
      !== bundle.challengeAssignment.challengeAssignmentId
    || bundle.personalizedLearningPlan.sourceChallengeAssignmentRef
      !== bundle.challengeAssignment.challengeAssignmentId) {
    context.addIssue({
      code: "custom",
      path: ["challengeAssignment"],
      message: "证据、评价与个性化方案必须引用当前挑战分配",
    });
  }

  if (bundle.worldSnapshot.learningContext.challengeAssignmentRef
    !== bundle.challengeAssignment.challengeAssignmentId
    || bundle.worldSnapshot.learningContext.challengeLevel
      !== bundle.challengeAssignment.challengeLevel
    || bundle.worldSnapshot.learningContext.scoreCeiling
      !== bundle.challengeAssignment.scoreCeiling
    || bundle.assessmentDecision.challengeLevel
      !== bundle.challengeAssignment.challengeLevel
    || bundle.assessmentDecision.scoreCeiling
      !== bundle.challengeAssignment.scoreCeiling) {
    context.addIssue({
      code: "custom",
      path: ["challengeAssignment"],
      message: "世界快照与评价必须使用同一挑战分配、等级和分数上限",
    });
  }
  const releaseVariant = bundle.simulationRelease.challengeVariants.find(
    (variant) => variant.worldVariantId === bundle.challengeAssignment.worldVariantRef,
  );
  const forecastVariant = bundle.learnerSimulationForecast.candidates.find(
    (candidate) => candidate.worldVariantRef
      === bundle.challengeAssignment.worldVariantRef,
  );
  if (releaseVariant?.challengeLevel !== bundle.challengeAssignment.challengeLevel
    || forecastVariant?.challengeLevel !== bundle.challengeAssignment.challengeLevel
    || bundle.challengeAssignment.forecastRef
      !== bundle.learnerSimulationForecast.forecastId) {
    context.addIssue({
      code: "custom",
      path: ["challengeAssignment", "worldVariantRef"],
      message: "挑战分配必须来自发布版真实变体与当前代理预测候选",
    });
  }

  if (!bundle.competencyEvidenceEpisode.sourceActionRefs.includes(
    bundle.studentWorkAction.workActionId,
  )) {
    context.addIssue({
      code: "custom",
      path: ["competencyEvidenceEpisode", "sourceActionRefs"],
      message: "能力证据必须能够回指学生真实工作动作",
    });
  }
  if (bundle.studentWorkAction.bindingId
    !== bundle.competencyEvidenceEpisode.bindingId
    || bundle.studentWorkAction.bindingId !== bundle.assessmentDecision.bindingId
    || bundle.studentWorkAction.actorId
      !== bundle.competencyEvidenceEpisode.actorId) {
    context.addIssue({
      code: "custom",
      path: ["studentWorkAction", "bindingId"],
      message: "学生行为、能力证据与评价不得跨主体拼接",
    });
  }
  if (!bundle.assessmentDecision.evidenceEpisodeRefs.includes(
    bundle.competencyEvidenceEpisode.evidenceEpisodeId,
  )) {
    context.addIssue({
      code: "custom",
      path: ["assessmentDecision", "evidenceEpisodeRefs"],
      message: "评价决定必须能够回指当前能力证据 Episode",
    });
  }

  const learnerTwinId = bundle.learnerTwinProfile.learnerTwinId;
  if (bundle.assessmentDecision.learnerTwinRef !== learnerTwinId
    || bundle.learnerSimulationForecast.learnerTwinRef !== learnerTwinId
    || bundle.challengeAssignment.learnerTwinRef !== learnerTwinId
    || bundle.personalizedLearningPlan.learnerTwinRef !== learnerTwinId
    || bundle.worldSnapshot.learningContext.learnerTwinRef !== learnerTwinId) {
    context.addIssue({
      code: "custom",
      path: ["learnerTwinProfile", "learnerTwinId"],
      message: "预测、分配、评价和成长方案不得跨学习者拼接",
    });
  }
  if (bundle.learnerSimulationForecast.learnerTwinRevision
    !== bundle.learnerTwinProfile.revision
    || bundle.learnerSimulationForecast.learnerTwinContentHash
      !== bundle.learnerTwinProfile.profileContentHash) {
    context.addIssue({
      code: "custom",
      path: ["learnerSimulationForecast", "learnerTwinRevision"],
      message: "学习者代理预测必须锁定画像版本与内容哈希",
    });
  }
  if (bundle.personalizedLearningPlan.sourceAssessmentDecisionRef
    !== bundle.assessmentDecision.assessmentDecisionId) {
    context.addIssue({
      code: "custom",
      path: ["personalizedLearningPlan", "sourceAssessmentDecisionRef"],
      message: "个性化方案必须回指当前真实评价决定",
    });
  }

  const episode = bundle.collaborationEpisode;
  if (TeacherAgentCollaborationEpisodeV3Schema.safeParse(episode).success
    || AdminAgentCollaborationEpisodeV3Schema.safeParse(episode).success) {
    const businessEpisode = episode as z.infer<
      typeof TeacherAgentCollaborationEpisodeV3Schema
    > | z.infer<typeof AdminAgentCollaborationEpisodeV3Schema>;
    const contribution = businessEpisode.contributions.find(
      (item) => item.intentId === bundle.agentIntent.intentId,
    );
    if (businessEpisode.status === "completed"
      && (contribution === undefined
        || contribution.agentTaskId !== bundle.agentIntent.agentTaskId
        || contribution.agentRunId !== bundle.agentIntent.agentRunId
        || businessEpisode.consequence?.resolutionId
          !== bundle.resolution.resolutionId)) {
      context.addIssue({
        code: "custom",
        path: ["collaborationEpisode", "contributions"],
        message: "完成协作 Episode 必须贯通真实任务、运行、意图与解析后果",
      });
    }
  }
});
export type V3SimulationContractBundle = z.infer<
  typeof V3SimulationContractBundleSchema
>;
