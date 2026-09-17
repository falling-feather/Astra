import { deepFreeze, hashCanonical } from "../canonical.js";
import { villageSuperKnowledgeRecords } from "../migration-knowledge.js";
import { xunpuCourseRelease } from "../xunpu-course.js";
import { xunpuV4AdaptationVariants } from "./adaptation-variants.js";
import { xunpuV4Artifacts } from "./artifacts.js";
import { xunpuV4Cast } from "./cast.js";
import { xunpuV4ConflictDomains } from "./conflicts.js";
import {
  hashXunpuDialogueSceneDefinitionV4,
  xunpuV4DialogueScenes,
} from "./dialogues.js";
import { xunpuV4ExperienceActs } from "./experience-acts.js";
import { xunpuV4GrayDilemmas } from "./gray-dilemmas.js";
import {
  xunpuV4AddedKnowledgeRecords,
  xunpuV4GroundedClaims,
} from "./knowledge.js";
import { xunpuV4MediaAssets } from "./media-ledger.js";
import { xunpuV4MigrationSample } from "./migration-sample.js";
import { xunpuV4PostPublicationResponseArcs } from "./post-publication.js";
import { xunpuV4ProfessionalReviewPacket } from "./professional-review.js";
import { xunpuV4FlagshipRoutes } from "./routes.js";
import { xunpuV4SemanticSamples } from "./semantic-samples.js";
import {
  XunpuFlagshipContentV4SchemaVersion,
  type XunpuAgentEpisodeTemplateV4,
  type XunpuChallengeProfileV4,
  type XunpuContentIssueV4,
  type XunpuContentReadinessV4,
  type XunpuContentValidationV4,
  type XunpuEndingV4,
  type XunpuFlagshipContentV4,
  type XunpuFlagshipContentV4Draft,
} from "./types.js";
import {
  xunpuV4AdversarialPairs,
  xunpuV4AssessmentCriteria,
  xunpuV4WorkSamples,
} from "./work-samples.js";
import {
  xunpuV4Locations,
  xunpuV4TimelineBeats,
  xunpuV4Variables,
  xunpuV4WorldObjects,
} from "./world.js";

const agentEpisodes: XunpuAgentEpisodeTemplateV4[] = [
  {
    episodeTemplateId: "episode-source-year-challenge",
    title: "年份与来源层级质疑",
    triggerRule: "冲突年份由转引材料进入 claim board。",
    selectedAgentRefs: [
      "agent-fact-checker",
      "agent-knowledge-retriever",
      "agent-heritage-researcher",
      "agent-editor",
    ],
    requiredMoveSequence: [
      "proposal",
      "challenge",
      "evidence_request",
      "revision",
      "joint_proposal",
    ],
    groundedClaimRefs: ["claim-heritage-listing-2008", "claim-source-verification"],
    failureClosedWhen: ["原始 locator 缺失", "知识哈希漂移", "只得到转引而无原始材料"],
    studentProjection: "来源之间存在冲突；当前建议先比较原始定位，再决定删除或限定表达。",
  },
  {
    episodeTemplateId: "episode-media-rights-challenge",
    title: "近景素材与授权范围质疑",
    triggerRule: "人物近景或线下许可样片进入公开视频时间线。",
    selectedAgentRefs: [
      "agent-media-understanding",
      "agent-rights-governance",
      "agent-source-verifier",
      "agent-production",
    ],
    requiredMoveSequence: [
      "proposal",
      "challenge",
      "evidence_request",
      "revision",
      "joint_proposal",
    ],
    groundedClaimRefs: ["claim-photo-and-portrait", "claim-consent-withdrawal", "claim-ai-label"],
    failureClosedWhen: ["人物或作者不明", "授权回执缺失", "撤回版本晚于作品版本且未处理"],
    studentProjection: "当前素材的公开范围不足；可替换、裁切、限用途或补授权。",
  },
  {
    episodeTemplateId: "episode-breaking-rumor-challenge",
    title: "群聊传言与服务快讯质疑",
    triggerRule: "无主体群聊截图被用于快讯，或公共安全风险达到阈值。",
    selectedAgentRefs: [
      "agent-scene-director",
      "agent-breaking-news",
      "agent-fact-checker",
      "agent-public-liaison",
      "agent-editor",
    ],
    requiredMoveSequence: [
      "proposal",
      "challenge",
      "evidence_request",
      "revision",
      "joint_proposal",
    ],
    groundedClaimRefs: ["claim-source-verification", "claim-2024-visitor-data"],
    failureClosedWhen: ["截图主体、时间和位置均无法确认", "公共联络回执缺失且作品使用确定措辞"],
    studentProjection: "传言尚不能作为事实；请选择等待、限定性服务更新或拒绝公开。",
  },
];

const challengeProfiles: XunpuChallengeProfileV4[] = [
  {
    challengeLevel: 3,
    scoreCeiling: 80,
    concurrentConflictLimit: 1,
    scaffoldingBudget: 5,
    npcResistance: "NPC 主动说明关键缺口，有效提问即可继续。",
    deadlinePattern: "窗口宽松，一次只推进一个主冲突。",
    protectionRules: ["不触发复合危机", "允许多次补证", "始终开放明确恢复路径"],
  },
  {
    challengeLevel: 4,
    scoreCeiling: 85,
    concurrentConflictLimit: 2,
    scaffoldingBudget: 4,
    npcResistance: "NPC 保留部分信息，需要一次有效追问。",
    deadlinePattern: "出现轻度催办和一次并行等待。",
    protectionRules: ["至少两条合法来源路径", "拒绝商业交换不会封死课程"],
  },
  {
    challengeLevel: 5,
    scoreCeiling: 90,
    concurrentConflictLimit: 2,
    scaffoldingBudget: 3,
    npcResistance: "口径矛盾、回应等待和条件交换并存。",
    deadlinePattern: "两项工作并行，等待真实消耗窗口。",
    protectionRules: ["至少一条恢复路径开放", "高风险素材可替换或补授权"],
  },
  {
    challengeLevel: 6,
    scoreCeiling: 95,
    concurrentConflictLimit: 3,
    scaffoldingBudget: 2,
    npcResistance: "NPC 会拒绝或因学生承诺改变合作程度。",
    deadlinePattern: "平台反馈不等待学生完成当前操作。",
    protectionRules: ["教师可暂停高风险事件", "不制造无来源事实"],
  },
  {
    challengeLevel: 7,
    scoreCeiling: 100,
    concurrentConflictLimit: 4,
    scaffoldingBudget: 1,
    npcResistance: "在专业范围内施加事实、权利、安全和关系复合压力。",
    deadlinePattern: "强时限和发布后延迟后果并存。",
    protectionRules: ["禁止羞辱和违法诱导", "禁止无解陷阱", "失败保留纠错出口"],
  },
];

const endings: XunpuEndingV4[] = [
  {
    endingId: "ending-trusted-collaboration",
    title: "可信合作",
    conditionRule: "关键 claim 可追溯、权利清楚、社区信任较高且未知项透明。",
    learningMeaning: "准确、文化主体、权益和传播可通过专业取舍共同维护。",
  },
  {
    endingId: "ending-prudent-delay",
    title: "审慎延误",
    conditionRule: "作品可信，但等待核验或补授权错过首轮窗口。",
    learningMeaning: "延误不自动等于低能力，需评价取舍是否合理。",
  },
  {
    endingId: "ending-traffic-backlash",
    title: "流量反噬",
    conditionRule: "触达较高，但事实、权利或透明度债务在发布后爆发。",
    learningMeaning: "短期流量和长期公共信任形成可观察冲突。",
  },
  {
    endingId: "ending-governance-failure",
    title: "治理失败",
    conditionRule: "无视高风险门、撤回或公共安全边界，作品被阻断或下架。",
    learningMeaning: "失败仍可产生纠错证据，但不能包装成成功。",
  },
];

const baseKnowledgeRefs = xunpuCourseRelease.knowledgeRecords.map(
  (record) => record.knowledgeId,
);

const draft: XunpuFlagshipContentV4Draft = {
  schemaVersion: XunpuFlagshipContentV4SchemaVersion,
  manifestId: "manifest-xunpu-flagship-v4",
  version: 4,
  title: "泉州蟳埔簪花围融媒体采编旗舰世界 V4",
  premise: "学生以记者身份在持续运行的社区现场中自由采访、核验、协商、制作、发布和纠错；NPC、时钟、媒体、知识与必要智能体共同形成可恢复后果。",
  expectedDurationMinutes: 55,
  courseId: "course-xunpu-intangible-media",
  scenarioId: "scenario-xunpu-living-world",
  primaryJobId: "integrated_media_reporter",
  studentRoleId: "reporter",
  factBoundary: {
    allNamedPeopleAreSimulated: true,
    publicFactsRequireKnowledgeRefs: true,
    noExternalMediaCopied: true,
    expertReviewRequired: true,
  },
  locations: xunpuV4Locations,
  worldObjects: xunpuV4WorldObjects,
  variables: xunpuV4Variables,
  timelineBeats: xunpuV4TimelineBeats,
  experienceActs: xunpuV4ExperienceActs,
  cast: xunpuV4Cast,
  dialogueScenes: xunpuV4DialogueScenes,
  conflictDomains: xunpuV4ConflictDomains,
  grayDilemmas: xunpuV4GrayDilemmas,
  postPublicationResponseArcs: xunpuV4PostPublicationResponseArcs,
  flagshipRoutes: xunpuV4FlagshipRoutes,
  artifacts: xunpuV4Artifacts,
  challengeProfiles,
  endings,
  baseKnowledgeRefs,
  semanticSamples: xunpuV4SemanticSamples,
  addedKnowledgeRecords: xunpuV4AddedKnowledgeRecords,
  professionalReviewPacket: xunpuV4ProfessionalReviewPacket,
  groundedClaims: xunpuV4GroundedClaims,
  mediaAssets: xunpuV4MediaAssets,
  agentEpisodes,
  assessmentCriteria: xunpuV4AssessmentCriteria,
  workSamples: xunpuV4WorkSamples,
  adversarialPairs: xunpuV4AdversarialPairs,
  adaptationVariants: xunpuV4AdaptationVariants,
  migrationSample: xunpuV4MigrationSample,
};

export const xunpuFlagshipContentV4 = deepFreeze({
  ...draft,
  contentHash: hashCanonical(draft),
}) as XunpuFlagshipContentV4;

export function hashXunpuFlagshipContentV4(
  content: XunpuFlagshipContentV4,
): string {
  const { contentHash: _contentHash, ...withoutHash } = content;
  return hashCanonical(withoutHash);
}

function duplicates(values: string[]): boolean {
  return new Set(values).size !== values.length;
}

export function validateXunpuFlagshipContentV4(
  content: XunpuFlagshipContentV4,
): XunpuContentValidationV4 {
  const issues: XunpuContentIssueV4[] = [];
  const issue = (code: string, path: string, message: string): void => {
    issues.push({ code, path, message });
  };
  const exact = (actual: number, expected: number, path: string): void => {
    if (actual !== expected) issue("count", path, "期望 " + expected + "，实际 " + actual);
  };

  if (content.schemaVersion !== XunpuFlagshipContentV4SchemaVersion) {
    issue("schema_version", "schemaVersion", "内容版本不受支持");
  }
  if (content.contentHash !== hashXunpuFlagshipContentV4(content)) {
    issue("content_hash", "contentHash", "内容哈希与语义字段不一致");
  }

  exact(content.locations.length, 7, "locations");
  exact(content.worldObjects.length, 11, "worldObjects");
  exact(content.variables.length, 11, "variables");
  exact(content.timelineBeats.length, 14, "timelineBeats");
  exact(content.experienceActs.length, 5, "experienceActs");
  exact(content.cast.length, 10, "cast");
  exact(content.dialogueScenes.length, 3, "dialogueScenes");
  exact(content.conflictDomains.length, 6, "conflictDomains");
  exact(content.grayDilemmas.length, 2, "grayDilemmas");
  exact(content.postPublicationResponseArcs.length, 4, "postPublicationResponseArcs");
  exact(content.flagshipRoutes.length, 4, "flagshipRoutes");
  exact(content.artifacts.length, 9, "artifacts");
  exact(content.challengeProfiles.length, 5, "challengeProfiles");
  exact(content.endings.length, 4, "endings");
  exact(content.baseKnowledgeRefs.length, 24, "baseKnowledgeRefs");
  exact(content.addedKnowledgeRecords.length, 12, "addedKnowledgeRecords");
  exact(content.professionalReviewPacket.items.length, 36, "professionalReviewPacket.items");
  exact(content.groundedClaims.length, 12, "groundedClaims");
  exact(content.mediaAssets.length, 27, "mediaAssets");
  exact(content.semanticSamples.length, 120, "semanticSamples");
  exact(content.agentEpisodes.length, 3, "agentEpisodes");
  exact(content.assessmentCriteria.length, 6, "assessmentCriteria");
  exact(content.workSamples.length, 8, "workSamples");
  exact(content.adversarialPairs.length, 6, "adversarialPairs");
  exact(content.adaptationVariants.length, 4, "adaptationVariants");

  const identityGroups: Array<[string, string[]]> = [
    ["locations", content.locations.map((item) => item.locationId)],
    ["worldObjects", content.worldObjects.map((item) => item.objectId)],
    ["variables", content.variables.map((item) => item.variableId)],
    ["timelineBeats", content.timelineBeats.map((item) => item.beatId)],
    ["experienceActs", content.experienceActs.map((item) => item.actId)],
    ["cast.roles", content.cast.map((item) => item.roleId)],
    ["cast.entities", content.cast.map((item) => item.entityId)],
    ["dialogueScenes", content.dialogueScenes.map((item) => item.definitionId)],
    ["conflictDomains", content.conflictDomains.map((item) => item.conflictDomainId)],
    ["grayDilemmas", content.grayDilemmas.map((item) => item.dilemmaId)],
    ["postPublicationResponseArcs", content.postPublicationResponseArcs.map((item) => item.responseArcId)],
    ["flagshipRoutes", content.flagshipRoutes.map((item) => item.routeId)],
    ["artifacts", content.artifacts.map((item) => item.artifactId)],
    ["knowledge", [...content.baseKnowledgeRefs, ...content.addedKnowledgeRecords.map((item) => item.knowledgeId)]],
    ["claims", content.groundedClaims.map((item) => item.claimId)],
    ["mediaAssets", content.mediaAssets.map((item) => item.assetId)],
    ["semanticSamples", content.semanticSamples.map((item) => item.sampleId)],
    ["episodes", content.agentEpisodes.map((item) => item.episodeTemplateId)],
    ["workSamples", content.workSamples.map((item) => item.sampleId)],
    ["adaptationVariants", content.adaptationVariants.map((item) => item.variantId)],
    ["professionalReviewItems", content.professionalReviewPacket.items.map((item) => item.reviewItemId)],
  ];
  for (const [path, values] of identityGroups) {
    if (duplicates(values)) issue("duplicate_id", path, "ID 必须唯一");
  }

  const objectRefs = new Set(content.worldObjects.map((item) => item.objectId));
  const entityRefs = new Set(content.cast.map((item) => item.entityId));
  const variableRefs = new Set(content.variables.map((item) => item.variableId));
  const beatRefs = new Set(content.timelineBeats.map((item) => item.beatId));
  const artifactRefs = new Set(content.artifacts.map((item) => item.artifactId));
  const mediaRefs = new Set(content.mediaAssets.map((item) => item.assetId));
  const claimRefs = new Set(content.groundedClaims.map((item) => item.claimId));
  const knowledgeRefs = new Set([
    ...content.baseKnowledgeRefs,
    ...content.addedKnowledgeRecords.map((item) => item.knowledgeId),
  ]);
  const criterionRefs = new Set(content.assessmentCriteria.map((item) => item.criterionId));
  const workSampleRefs = new Set(content.workSamples.map((item) => item.sampleId));
  const targetRefs = new Set([
    ...objectRefs,
    ...entityRefs,
    ...variableRefs,
    ...artifactRefs,
    ...mediaRefs,
    ...content.locations.map((item) => item.locationId),
  ]);

  const orderedActs = [...content.experienceActs].sort((left, right) => (
    left.startMinute - right.startMinute
  ));
  if (
    orderedActs[0]?.startMinute !== 0
    || orderedActs.at(-1)?.endMinute !== content.expectedDurationMinutes
    || content.timelineBeats.at(-1)?.worldMinute !== content.expectedDurationMinutes
  ) {
    issue("experience_duration", "experienceActs", "旗舰节奏必须从第 0 分钟连续结束于第 55 分钟");
  }
  for (const [index, act] of orderedActs.entries()) {
    if (
      act.startMinute >= act.endMinute
      || (index > 0 && orderedActs[index - 1]?.endMinute !== act.startMinute)
    ) {
      issue("experience_continuity", "experienceActs." + act.actId, "体验幕次必须连续、无重叠且具有正时长");
    }
    if (act.requiredBeatRefs.some((ref) => !beatRefs.has(ref))) {
      issue("unknown_ref", "experienceActs." + act.actId + ".requiredBeatRefs", "幕次引用未知节拍");
    }
    if (act.requiredArtifactRefs.some((ref) => !artifactRefs.has(ref))) {
      issue("unknown_ref", "experienceActs." + act.actId + ".requiredArtifactRefs", "幕次引用未知成果");
    }
    if (!act.primaryObjective || !act.decisionPressure || !act.completionSignal) {
      issue("experience_depth", "experienceActs." + act.actId, "幕次必须具有职业目标、决策压力和可观察退出信号");
    }
  }

  for (const location of content.locations) {
    if (location.objectRefs.some((ref) => !objectRefs.has(ref))) {
      issue("unknown_ref", "locations." + location.locationId, "场所引用未知对象");
    }
    if (location.npcRefs.some((ref) => !entityRefs.has(ref))) {
      issue("unknown_ref", "locations." + location.locationId, "场所引用未知 NPC");
    }
  }
  for (const npc of content.cast) {
    if (!npc.privatePressure.startsWith("仿真：") || !npc.simulationNotice.includes("教学仿真")) {
      issue("simulation_boundary", "cast." + npc.roleId, "人物私有压力和声明必须明确为教学仿真");
    }
    if (npc.memoryKeys.length < 3 || npc.planSteps.length < 3) {
      issue("npc_persistence", "cast." + npc.roleId, "NPC 必须具有持续记忆和至少三种合法主动回应");
    }
    if (npc.localKnowledgeRefs.some((ref) => !knowledgeRefs.has(ref))) {
      issue("unknown_ref", "cast." + npc.roleId + ".localKnowledgeRefs", "NPC 引用未知知识");
    }
  }
  for (const keyNpcRef of ["entity-gatekeeper", "entity-inheritor", "entity-shopkeeper"]) {
    const npc = content.cast.find((item) => item.entityId === keyNpcRef);
    if (!npc?.planSteps.some((step) => step.trigger.includes("story_published"))) {
      issue("postpublication_gap", "cast." + keyNpcRef, "关键人物必须在发布后继续基于承诺回应");
    }
  }
  const allowedDialogueEventTemplates = new Set([
    "event-template-gatekeeper",
    "event-template-inheritor",
    "event-template-commercial-response",
  ]);
  for (const dialogue of content.dialogueScenes) {
    const npc = content.cast.find((item) => item.entityId === dialogue.npcRef);
    if (!npc || npc.roleId !== dialogue.npcRoleRef) {
      issue("unknown_ref", "dialogueScenes." + dialogue.definitionId, "对话引用未知或角色不匹配的 NPC");
    }
    if (dialogue.localKnowledgeRefs.some((ref) => !knowledgeRefs.has(ref))) {
      issue("unknown_ref", "dialogueScenes." + dialogue.definitionId + ".localKnowledgeRefs", "对话引用未知知识");
    }
    if (dialogue.definitionHash !== hashXunpuDialogueSceneDefinitionV4(dialogue)) {
      issue("dialogue_hash", "dialogueScenes." + dialogue.definitionId, "对话定义哈希与语义字段不一致");
    }
    const resolved = dialogue.rules.filter((item) => item.outcome === "resolved");
    if (new Set(resolved.map((item) => item.routeRef)).size < 3) {
      issue("dialogue_routes", "dialogueScenes." + dialogue.definitionId, "关键人物对话必须具有至少三条机会成本不同的合法结局");
    }
    if (
      dialogue.rules.filter((item) => item.outcome === "refusal").length < 2
      || dialogue.rules.filter((item) => item.outcome === "recovery").length < 2
    ) {
      issue("dialogue_recovery", "dialogueScenes." + dialogue.definitionId, "关键人物对话必须具有至少两种拒绝和两种可验证恢复");
    }
    if (resolved.some((item) => (
      item.eventTemplateRef === null
      || !allowedDialogueEventTemplates.has(item.eventTemplateRef)
    ))) {
      issue("unknown_ref", "dialogueScenes." + dialogue.definitionId + ".rules", "对话结局引用未知世界事件模板");
    }
  }
  for (const conflict of content.conflictDomains) {
    if (conflict.legalRoutes.length < 2 || conflict.recoveryConditions.length === 0) {
      issue("conflict_routes", "conflictDomains." + conflict.conflictDomainId, "冲突缺少多解或恢复");
    }
    if (conflict.proactiveTriggerKinds.length === 0) {
      issue("proactive_trigger", "conflictDomains." + conflict.conflictDomainId, "冲突必须具有主动触发");
    }
    if (conflict.actorRefs.some((ref) => !entityRefs.has(ref))) {
      issue("unknown_ref", "conflictDomains." + conflict.conflictDomainId + ".actorRefs", "引用未知 NPC");
    }
    if (conflict.objectRefs.some((ref) => !objectRefs.has(ref))) {
      issue("unknown_ref", "conflictDomains." + conflict.conflictDomainId + ".objectRefs", "引用未知对象");
    }
    if (conflict.artifactRefs.some((ref) => !artifactRefs.has(ref))) {
      issue("unknown_ref", "conflictDomains." + conflict.conflictDomainId + ".artifactRefs", "引用未知成果");
    }
    if (conflict.riskyActions.some((action) => action.formalWriteAllowed !== false)) {
      issue("unsafe_write", "conflictDomains." + conflict.conflictDomainId, "风险动作必须零正式写入");
    }
  }
  for (const dilemma of content.grayDilemmas) {
    if (
      dilemma.legitimateChoices.length < 3
      || dilemma.noSingleCorrectAnswer !== true
      || dilemma.competingValues.length !== 2
    ) {
      issue("gray_dilemma_depth", "grayDilemmas." + dilemma.dilemmaId, "灰度冲突必须至少有三种合法取舍且不得编码唯一答案");
    }
    if (dilemma.actorRefs.some((ref) => !entityRefs.has(ref))) {
      issue("unknown_ref", "grayDilemmas." + dilemma.dilemmaId + ".actorRefs", "灰度冲突引用未知人物");
    }
    if (dilemma.artifactRefs.some((ref) => !artifactRefs.has(ref))) {
      issue("unknown_ref", "grayDilemmas." + dilemma.dilemmaId + ".artifactRefs", "灰度冲突引用未知成果");
    }
    for (const choice of dilemma.legitimateChoices) {
      if (choice.requiredEvidenceKinds.length === 0 || choice.opportunityCosts.length === 0) {
        issue("gray_dilemma_evidence", "grayDilemmas." + dilemma.dilemmaId + "." + choice.choiceRef, "合法取舍必须说明证据和机会成本");
      }
    }
  }
  for (const arc of content.postPublicationResponseArcs) {
    if (arc.actorRefs.some((ref) => !entityRefs.has(ref))) {
      issue("unknown_ref", "postPublicationResponseArcs." + arc.responseArcId + ".actorRefs", "发布后回应引用未知人物");
    }
    if (arc.followUpArtifactRefs.some((ref) => !artifactRefs.has(ref))) {
      issue("unknown_ref", "postPublicationResponseArcs." + arc.responseArcId + ".followUpArtifactRefs", "发布后回应引用未知成果");
    }
    if (
      arc.outcomeVariants.length < 2
      || arc.outcomeVariants.some((variant) => (
        variant.studentResponseOptions.length < 3
        || variant.requiredEvidenceKinds.length === 0
      ))
    ) {
      issue("postpublication_depth", "postPublicationResponseArcs." + arc.responseArcId, "发布后回应必须按世界状态分歧并给出至少三种证据化响应");
    }
  }
  for (const route of content.flagshipRoutes) {
    if (route.requiredBeatRefs.some((ref) => !beatRefs.has(ref))) {
      issue("unknown_ref", "flagshipRoutes." + route.routeId + ".requiredBeatRefs", "路线引用未知节拍");
    }
    if (route.requiredArtifactRefs.some((ref) => !artifactRefs.has(ref))) {
      issue("unknown_ref", "flagshipRoutes." + route.routeId + ".requiredArtifactRefs", "路线引用未知成果");
    }
    if (route.opportunityCosts.length === 0 || route.successConditions.length < 3) {
      issue("route_depth", "flagshipRoutes." + route.routeId, "路线缺少机会成本或成功条件");
    }
  }
  if (content.flagshipRoutes.filter((route) => route.preservesInitialFailureEvidence).length !== 1) {
    issue("recovery_route", "flagshipRoutes", "必须且只能有一条保留初始错误证据的恢复路线");
  }

  const expectedGroups: Record<string, [number, number, number, number]> = {
    "semantic-access": [12, 8, 3, 1],
    "semantic-interview": [16, 12, 3, 1],
    "semantic-followup": [14, 10, 3, 1],
    "semantic-evidence": [16, 12, 3, 1],
    "semantic-rights": [14, 9, 3, 2],
    "semantic-negotiation": [12, 8, 2, 2],
    "semantic-drafting": [12, 9, 2, 1],
    "semantic-publication": [12, 7, 2, 3],
    "semantic-ambiguity-safety": [12, 3, 3, 6],
  };
  for (const [group, [total, accepted, clarified, refused]] of Object.entries(expectedGroups)) {
    const samples = content.semanticSamples.filter((sample) => sample.sampleGroup === group);
    if (
      samples.length !== total
      || samples.filter((sample) => sample.expectedOutcome === "accepted").length !== accepted
      || samples.filter((sample) => sample.expectedOutcome === "clarification_required").length !== clarified
      || samples.filter((sample) => sample.expectedOutcome === "refused").length !== refused
    ) {
      issue("semantic_distribution", "semanticSamples." + group, "样本结果分布与冻结设计不一致");
    }
  }
  if (duplicates(content.semanticSamples.map((sample) => sample.utterance))) {
    issue("duplicate_utterance", "semanticSamples", "语义样本表达必须唯一");
  }
  if (!content.semanticSamples.some((sample) => sample.blindSplit === "test")) {
    issue("blind_split", "semanticSamples", "必须保留盲测样本");
  }
  for (const sample of content.semanticSamples) {
    if (sample.expectedTargetRefs.some((ref) => !targetRefs.has(ref))) {
      issue("unknown_ref", "semanticSamples." + sample.sampleId, "语义样本引用未知目标");
    }
    if (sample.attachedAssetRefs.some((ref) => !mediaRefs.has(ref))) {
      issue("unknown_ref", "semanticSamples." + sample.sampleId, "语义样本引用未知媒体");
    }
    if (sample.expectedOutcome === "refused" && sample.riskRefs.length === 0) {
      issue("refusal_risk", "semanticSamples." + sample.sampleId, "拒绝样本必须说明风险");
    }
  }

  for (const knowledge of content.addedKnowledgeRecords) {
    if (
      !knowledge.url.startsWith("https://")
      || knowledge.locator.length < 5
      || knowledge.reviewStatus !== "pending_expert_review"
      || knowledge.storedExcerpt !== ""
    ) {
      issue("knowledge_metadata", "addedKnowledgeRecords." + knowledge.knowledgeId, "知识来源元数据或复核边界不合格");
    }
    const { contentHash: _contentHash, ...knowledgeDraft } = knowledge;
    if (knowledge.contentHash !== hashCanonical(knowledgeDraft)) {
      issue("knowledge_hash", "addedKnowledgeRecords." + knowledge.knowledgeId, "知识内容哈希不一致");
    }
  }
  const knowledgeHashByRef = new Map<string, string>([
    ...xunpuCourseRelease.knowledgeRecords.map((record) => (
      [record.knowledgeId, record.contentHash] as const
    )),
    ...content.addedKnowledgeRecords.map((record) => (
      [record.knowledgeId, record.contentHash] as const
    )),
  ]);
  if (
    content.professionalReviewPacket.reviewStatus !== "pending_expert_review"
    || content.professionalReviewPacket.reviewEvidenceMustBeExternal !== true
    || content.professionalReviewPacket.noAutomaticVerificationClaim !== true
  ) {
    issue("professional_review_boundary", "professionalReviewPacket", "专业复核包必须保持待外审且禁止自动声明已验证");
  }
  const reviewedKnowledgeRefs = content.professionalReviewPacket.items.map((item) => item.knowledgeRef);
  if (
    duplicates(reviewedKnowledgeRefs)
    || reviewedKnowledgeRefs.some((ref) => !knowledgeRefs.has(ref))
    || knowledgeRefs.size !== reviewedKnowledgeRefs.length
  ) {
    issue("professional_review_coverage", "professionalReviewPacket.items", "专业复核包必须逐条且仅覆盖全部 36 条旗舰知识");
  }
  for (const review of content.professionalReviewPacket.items) {
    if (
      review.reviewStatus !== "pending_expert_review"
      || review.requiredReviewerRoles.length < 2
      || review.reviewQuestion.length < 20
      || review.applicabilityBoundary.length < 20
      || review.disputeOrExpiryRisk.length < 20
      || review.sourceSnapshot.sourceContentHash !== knowledgeHashByRef.get(review.knowledgeRef)
      || !review.sourceSnapshot.url.startsWith("https://")
      || review.sourceSnapshot.locator.length < 5
    ) {
      issue("professional_review_item", "professionalReviewPacket.items." + review.reviewItemId, "专业复核项的边界、问题、角色或来源快照不完整");
    }
  }
  for (const claim of content.groundedClaims) {
    if (claim.knowledgeRefs.some((ref) => !knowledgeRefs.has(ref))) {
      issue("unknown_ref", "groundedClaims." + claim.claimId, "主张引用未知知识");
    }
    if (claim.minimumIndependentSupportCount < 2 || claim.knowledgeRefs.length < 2) {
      issue("claim_support", "groundedClaims." + claim.claimId, "多来源主张缺少独立支持");
    }
  }

  for (const asset of content.mediaAssets) {
    if (asset.productionStatus === "ready" && !asset.contentHash?.match(/^[a-f0-9]{64}$/u)) {
      issue("asset_hash", "mediaAssets." + asset.assetId, "就绪媒体必须具有 SHA-256");
    }
    if (asset.productionStatus === "planned" && asset.contentHash !== null) {
      issue("asset_status", "mediaAssets." + asset.assetId, "计划媒体不得伪造内容哈希");
    }
  }
  for (const episode of content.agentEpisodes) {
    if (episode.requiredMoveSequence.join(">") !== "proposal>challenge>evidence_request>revision>joint_proposal") {
      issue("episode_sequence", "agentEpisodes." + episode.episodeTemplateId, "Episode 必须包含完整质疑修订序列");
    }
    if (episode.groundedClaimRefs.some((ref) => !claimRefs.has(ref))) {
      issue("unknown_ref", "agentEpisodes." + episode.episodeTemplateId, "Episode 引用未知主张");
    }
  }

  if (content.assessmentCriteria.reduce((sum, criterion) => sum + criterion.weight, 0) !== 100) {
    issue("rubric_weight", "assessmentCriteria", "量规权重必须合计 100");
  }
  for (const criterion of content.assessmentCriteria) {
    if (
      criterion.minimumIndependentEvidenceCount < 2
      || criterion.artifactRefs.some((ref) => !artifactRefs.has(ref))
      || criterion.failClosedWhen.length === 0
    ) {
      issue("rubric_evidence", "assessmentCriteria." + criterion.criterionId, "量规证据或失败关闭不合格");
    }
  }
  for (const sample of content.workSamples) {
    if (sample.expectedJudgments.some((judgment) => !criterionRefs.has(judgment.criterionId))) {
      issue("unknown_ref", "workSamples." + sample.sampleId, "作品样例引用未知量规");
    }
    if (sample.artifactRefs.some((ref) => !artifactRefs.has(ref))) {
      issue("unknown_ref", "workSamples." + sample.sampleId, "作品样例引用未知成果");
    }
  }
  for (const pair of content.adversarialPairs) {
    if (!workSampleRefs.has(pair.leftSampleRef) || !workSampleRefs.has(pair.rightSampleRef)) {
      issue("unknown_ref", "adversarialPairs." + pair.pairId, "对照引用未知作品样例");
    }
  }
  for (const variant of content.adaptationVariants) {
    if (variant.triggerCriterionRefs.some((ref) => !criterionRefs.has(ref))) {
      issue("unknown_ref", "adaptationVariants." + variant.variantId, "第二场引用未知能力维度");
    }
    if (variant.mechanicalDifferenceCount < 2 || variant.changedEventTemplateRefs.length === 0) {
      issue("adaptation_difference", "adaptationVariants." + variant.variantId, "第二场机械差异不足");
    }
  }

  const migrationKnowledgeRefs = new Set(
    villageSuperKnowledgeRecords.map((record) => record.knowledgeId),
  );
  const migrationSection = content.migrationSample.section;
  if (
    content.migrationSample.sourcePatternRef !== content.manifestId
    || content.migrationSample.serviceCodeChangeRequired !== false
    || migrationSection.actions.length !== 3
    || migrationSection.evidenceRequirements.length !== 3
    || migrationSection.dynamicEvents.length !== 1
    || migrationSection.agentSelectionRules.length !== 1
    || migrationSection.rubric.reduce((sum, criterion) => sum + criterion.weight, 0) !== 100
  ) {
    issue("migration_sample_shape", "migrationSample", "最小迁移样本必须由既有内容工厂完整表达且不要求服务代码变化");
  }
  if (migrationSection.publicSourceKnowledgeIds.some((ref) => !migrationKnowledgeRefs.has(ref))) {
    issue("unknown_ref", "migrationSample.section.publicSourceKnowledgeIds", "迁移样本引用未知目标课程知识");
  }
  if (
    migrationSection.actions.filter((action) => action.primary).length !== 1
    || migrationSection.hiddenFacts.some((fact) => (
      fact.visibility !== "teacher_and_engine" || !fact.summary.startsWith("仿真情境：")
    ))
    || migrationSection.dynamicEvents[0]?.teacherApprovalRequired !== true
  ) {
    issue("migration_sample_boundary", "migrationSample.section", "迁移样本必须保留唯一主行动、隐藏仿真事实和教师门");
  }

  const expectedCeilings = [80, 85, 90, 95, 100];
  if (content.challengeProfiles.some((profile, index) => (
    profile.challengeLevel !== index + 3
    || profile.scoreCeiling !== expectedCeilings[index]
    || profile.protectionRules.length === 0
  ))) {
    issue("challenge_profiles", "challengeProfiles", "3—7 级压力与分数上限不一致");
  }
  if (content.timelineBeats.filter((beat) => beat.proactive).length < 10) {
    issue("autonomous_world", "timelineBeats", "主动节拍数量不足");
  }
  if (content.artifacts.some((artifact) => (
    artifact.editableFields.length === 0
    || artifact.completionChecks.length === 0
    || artifact.evidenceRequirements.length === 0
    || artifact.artifactCompletionIsNotCompetencyScore !== true
  ))) {
    issue("artifact_depth", "artifacts", "成果缺少真实字段、检查、证据或评价边界");
  }

  return { valid: issues.length === 0, issues };
}

export function assessXunpuFlagshipContentReadinessV4(
  content: XunpuFlagshipContentV4,
): XunpuContentReadinessV4 {
  const blockers: XunpuContentIssueV4[] = [];
  for (const asset of content.mediaAssets) {
    if (asset.productionStatus !== "ready") {
      blockers.push({
        code: "media_not_ready",
        path: "mediaAssets." + asset.assetId,
        message: "媒体资产仍是计划状态",
      });
    } else if (!asset.aiImplicitMetadata) {
      blockers.push({
        code: "implicit_label_missing",
        path: "mediaAssets." + asset.assetId,
        message: "既有生成资产尚未登记隐式标识元数据",
      });
    }
  }
  for (const knowledge of content.addedKnowledgeRecords) {
    blockers.push({
      code: "expert_review_pending",
      path: "addedKnowledgeRecords." + knowledge.knowledgeId,
      message: "新增知识仍待真实专业教师复核",
    });
  }
  return { ready: blockers.length === 0, blockers };
}
