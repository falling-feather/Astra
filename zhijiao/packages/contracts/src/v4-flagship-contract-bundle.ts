import { z } from "zod";
import {
  AdminGroundedCollaborationEpisodeV4Schema,
  StudentGroundedCollaborationEpisodeV4Schema,
  TeacherGroundedCollaborationEpisodeV4Schema,
} from "./grounded-collaboration-v4.js";
import {
  AutonomousWorldDecisionV4Schema,
  FlagshipContentReferenceV4Schema,
  SemanticActionDecisionV4Schema,
  SemanticActionRequestV4Schema,
} from "./flagship-world-v4.js";
import {
  BlindEvidenceAssessmentInputV4Schema,
  EvidenceAssessmentDecisionV4Schema,
  MediaWorkRevisionV4Schema,
  SecondSessionHandoffV4Schema,
} from "./media-assessment-adaptation-v4.js";

export const V4FlagshipContractBundleSchemaVersion =
  "v4-flagship-contract-bundle/4.0.0" as const;

function equivalent(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export const V4FlagshipContractBundleSchema = z.object({
  schemaVersion: z.literal(V4FlagshipContractBundleSchemaVersion),
  flagshipContentRef: FlagshipContentReferenceV4Schema,
  semanticActionRequest: SemanticActionRequestV4Schema,
  semanticActionDecision: SemanticActionDecisionV4Schema,
  autonomousWorldDecision: AutonomousWorldDecisionV4Schema,
  studentCollaborationEpisode: StudentGroundedCollaborationEpisodeV4Schema,
  teacherCollaborationEpisode: TeacherGroundedCollaborationEpisodeV4Schema,
  adminCollaborationEpisode: AdminGroundedCollaborationEpisodeV4Schema,
  mediaWorkRevision: MediaWorkRevisionV4Schema,
  blindAssessmentInput: BlindEvidenceAssessmentInputV4Schema,
  assessmentDecision: EvidenceAssessmentDecisionV4Schema,
  secondSessionHandoff: SecondSessionHandoffV4Schema,
}).strict().superRefine((bundle, context) => {
  const contentRefs = [
    bundle.semanticActionDecision.flagshipContentRef,
    bundle.autonomousWorldDecision.flagshipContentRef,
    bundle.studentCollaborationEpisode.flagshipContentRef,
    bundle.teacherCollaborationEpisode.flagshipContentRef,
    bundle.adminCollaborationEpisode.flagshipContentRef,
    bundle.mediaWorkRevision.flagshipContentRef,
    bundle.secondSessionHandoff.flagshipContentRef,
  ];
  if (contentRefs.some((reference) => !equivalent(reference, bundle.flagshipContentRef))) {
    context.addIssue({
      code: "custom",
      path: ["flagshipContentRef"],
      message: "V4 闭环的课程、情境、世界发布和内容哈希必须完全一致",
    });
  }

  const sourceSessionId = bundle.semanticActionRequest.sessionId;
  const sessionIds = [
    bundle.semanticActionDecision.sessionId,
    bundle.autonomousWorldDecision.sessionId,
    bundle.studentCollaborationEpisode.sessionId,
    bundle.teacherCollaborationEpisode.sessionId,
    bundle.adminCollaborationEpisode.sessionId,
    bundle.mediaWorkRevision.sessionId,
    bundle.secondSessionHandoff.sourceSessionId,
  ];
  if (sessionIds.some((sessionId) => sessionId !== sourceSessionId)) {
    context.addIssue({
      code: "custom",
      path: ["semanticActionRequest", "sessionId"],
      message: "语义行动、世界、协作、作品、评价与第二场来源必须属于同一首场会话",
    });
  }
  if (bundle.semanticActionRequest.bindingId !== bundle.semanticActionDecision.bindingId
    || bundle.semanticActionRequest.bindingId !== bundle.mediaWorkRevision.bindingId) {
    context.addIssue({
      code: "custom",
      path: ["semanticActionRequest", "bindingId"],
      message: "首场学生行动与媒体作品必须属于同一服务端授权绑定",
    });
  }
  if (bundle.semanticActionRequest.requestId !== bundle.semanticActionDecision.requestId
    || bundle.semanticActionRequest.expectedWorldStateVersion
      !== bundle.semanticActionDecision.sourceWorldStateVersion) {
    context.addIssue({
      code: "custom",
      path: ["semanticActionDecision"],
      message: "语义决定必须消费当前请求及其冻结世界版本",
    });
  }
  if (bundle.semanticActionDecision.status !== "accepted") {
    context.addIssue({
      code: "custom",
      path: ["semanticActionDecision", "status"],
      message: "完整 V4 成功闭环只能从已接受语义行动开始",
    });
  }
  if (bundle.autonomousWorldDecision.status !== "scheduled"
    || bundle.autonomousWorldDecision.sourceWorldStateVersion
      !== bundle.semanticActionDecision.sourceWorldStateVersion) {
    context.addIssue({
      code: "custom",
      path: ["autonomousWorldDecision"],
      message: "成功闭环必须保留同一世界版本上的服务端自主事件候选",
    });
  }

  const businessEpisodes = [
    bundle.teacherCollaborationEpisode,
    bundle.adminCollaborationEpisode,
  ];
  if (businessEpisodes.some((episode) => (
    episode.episodeId !== bundle.studentCollaborationEpisode.episodeId
    || episode.triggerEventRef !== bundle.studentCollaborationEpisode.triggerEventRef
    || episode.sourceWorldStateVersion
      !== bundle.studentCollaborationEpisode.sourceWorldStateVersion
  ))) {
    context.addIssue({
      code: "custom",
      path: ["studentCollaborationEpisode"],
      message: "学生、教师与管理员必须投影同一个真实协作 Episode",
    });
  }
  if (bundle.teacherCollaborationEpisode.status !== "joint_proposal_ready"
    || bundle.adminCollaborationEpisode.status !== "joint_proposal_ready"
    || bundle.studentCollaborationEpisode.suggestion === null
    || bundle.teacherCollaborationEpisode.jointProposal === null
    || bundle.adminCollaborationEpisode.jointProposal === null
    || bundle.studentCollaborationEpisode.suggestion.sourceJointProposalRef
      !== bundle.teacherCollaborationEpisode.jointProposal.jointProposalId
    || bundle.teacherCollaborationEpisode.jointProposal.jointProposalId
      !== bundle.adminCollaborationEpisode.jointProposal.jointProposalId
    || bundle.teacherCollaborationEpisode.jointProposal.contentHash
      !== bundle.adminCollaborationEpisode.jointProposal.contentHash) {
    context.addIssue({
      code: "custom",
      path: ["teacherCollaborationEpisode", "jointProposal"],
      message: "三角色投影必须引用同一份完整知识接地联合提案",
    });
  }

  const mediaArtifact = bundle.blindAssessmentInput.artifactRevisions.find(
    (artifact) => artifact.revisionRef === bundle.mediaWorkRevision.mediaRevisionId,
  );
  if (mediaArtifact === undefined
    || mediaArtifact.artifactRef !== bundle.mediaWorkRevision.artifactRef
    || mediaArtifact.contentHash !== bundle.mediaWorkRevision.contentHash) {
    context.addIssue({
      code: "custom",
      path: ["blindAssessmentInput", "artifactRevisions"],
      message: "盲评必须读取学生实际提交的媒体修订及其内容哈希",
    });
  }
  if (bundle.assessmentDecision.blindCaseRef !== bundle.blindAssessmentInput.blindCaseId
    || bundle.assessmentDecision.blindInputHash !== bundle.blindAssessmentInput.inputHash) {
    context.addIssue({
      code: "custom",
      path: ["assessmentDecision"],
      message: "评价决定必须绑定精确盲评输入，不能换案或重算身份信息",
    });
  }
  if (bundle.assessmentDecision.status !== "final"
    || bundle.secondSessionHandoff.sourceAssessmentDecisionRef
      !== bundle.assessmentDecision.assessmentDecisionId) {
    context.addIssue({
      code: "custom",
      path: ["secondSessionHandoff"],
      message: "只有专业量规和教师终裁后的最终评价可驱动第二场",
    });
  }
  if (bundle.secondSessionHandoff.status !== "provisioned"
    && bundle.secondSessionHandoff.status !== "calibration_completed") {
    context.addIssue({
      code: "custom",
      path: ["secondSessionHandoff", "status"],
      message: "成功闭环必须创建真实 membership、binding、release 与 session",
    });
  } else if (bundle.secondSessionHandoff.provision.sessionRef === sourceSessionId) {
    context.addIssue({
      code: "custom",
      path: ["secondSessionHandoff", "provision", "sessionRef"],
      message: "第二场必须是新的授权会话，不得把首场重新命名",
    });
  }
});
export type V4FlagshipContractBundle = z.infer<
  typeof V4FlagshipContractBundleSchema
>;
