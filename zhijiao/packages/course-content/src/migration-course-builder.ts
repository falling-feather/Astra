import { createCourseContentRelease } from "./canonical.js";
import {
  CourseContentSchemaVersion,
  CourseReleaseTargetSchemaVersion,
  type CourseContentRelease,
  type CourseSection,
  type EvidenceRequirement,
  type KnowledgeRecord,
} from "./types.js";

type EvidenceKind = EvidenceRequirement["acceptedSourceKinds"][number];

export interface MigrationActionBlueprint {
  key: string;
  label: string;
  intent: string;
  guidance: string;
  knowledgeIds: readonly string[];
  evidenceKeys: readonly string[];
}

export interface MigrationEvidenceBlueprint {
  key: string;
  label: string;
  description: string;
  minimumCount: number;
  acceptedSourceKinds: readonly EvidenceKind[];
}

export interface MigrationRubricBlueprint {
  key: string;
  label: string;
  weight: number;
  observable: string;
  failClosedWhen: string;
}

export interface MigrationSectionBlueprint {
  sectionId: string;
  title: string;
  typicalWorkTask: string;
  objectives: readonly [string, string, string];
  competencyRefs: readonly [string, string, string];
  taskBrief: string;
  sourceKnowledgeIds: readonly string[];
  hiddenFacts: readonly {
    key: string;
    summary: string;
    revealCondition: string;
    evidenceKeys: readonly string[];
  }[];
  actions: readonly [
    MigrationActionBlueprint,
    MigrationActionBlueprint,
    MigrationActionBlueprint,
  ];
  primaryActionKey: string;
  event: {
    key: string;
    triggerKind: "on_action" | "on_evidence_count" | "on_section_submit";
    triggerKey: string;
    studentBrief: string;
    hiddenPayload: string;
    affectedAgentIds: readonly string[];
    candidateAgentIds: readonly string[];
    teacherApprovalRequired: boolean;
  };
  agentSelection: {
    affectedAgentIds: readonly string[];
    candidateAgentIds: readonly string[];
    selectWhen: string;
    skipWhen: string;
    maximumSelectedAgents: number;
  };
  artifact: {
    label: string;
    format: CourseSection["artifact"]["format"];
    completionCriteria: readonly string[];
    finalCourseArtifact: boolean;
  };
  evidence: readonly MigrationEvidenceBlueprint[];
  rubric: readonly [
    MigrationRubricBlueprint,
    MigrationRubricBlueprint,
    MigrationRubricBlueprint,
    MigrationRubricBlueprint,
  ];
  teacherGate: {
    label: string;
    trigger: CourseSection["teacherGate"]["trigger"];
    checks: readonly string[];
    minimumEvidenceCount: number;
    rejectReturnsToActionKey: string;
  };
  reflection: {
    prompt: string;
    targetContext: string;
    comparisonDimensions: readonly string[];
  };
}

export interface MigrationCourseBlueprint {
  courseId: string;
  releaseId: string;
  version: string;
  title: string;
  summary: string;
  durationMinutes: number;
  courseOutcomes: readonly string[];
  sections: readonly MigrationSectionBlueprint[];
  knowledgeRecords: readonly KnowledgeRecord[];
}

const adviceDecisionPolicy = {
  allowedDecisions: ["accept", "request_more_evidence", "reject"],
  rationaleRequiredOnReject: true,
  onlyOneVisibleSuggestionAtATime: true,
} as const;

function actionId(sectionId: string, key: string): string {
  return `${sectionId}-action-${key}`;
}

function evidenceId(sectionId: string, key: string): string {
  return `${sectionId}-evidence-${key}`;
}

export function buildMigrationSection(
  blueprint: MigrationSectionBlueprint,
  order: number,
): CourseSection {
  const actionKeys = new Set(blueprint.actions.map((action) => action.key));
  const evidenceKeys = new Set(blueprint.evidence.map((item) => item.key));
  if (!actionKeys.has(blueprint.primaryActionKey)) {
    throw new Error(`${blueprint.sectionId} 缺少主要动作 ${blueprint.primaryActionKey}`);
  }
  if (!actionKeys.has(blueprint.teacherGate.rejectReturnsToActionKey)) {
    throw new Error(
      `${blueprint.sectionId} 教师门退回动作不存在：${blueprint.teacherGate.rejectReturnsToActionKey}`,
    );
  }
  for (const action of blueprint.actions) {
    for (const key of action.evidenceKeys) {
      if (!evidenceKeys.has(key)) {
        throw new Error(`${blueprint.sectionId} 动作引用未知证据 ${key}`);
      }
    }
  }

  const triggerRef = blueprint.event.triggerKind === "on_action"
    ? actionId(blueprint.sectionId, blueprint.event.triggerKey)
    : blueprint.event.triggerKind === "on_evidence_count"
      ? evidenceId(blueprint.sectionId, blueprint.event.triggerKey)
      : blueprint.event.triggerKey;

  return {
    sectionId: blueprint.sectionId,
    order,
    title: blueprint.title,
    typicalWorkTask: blueprint.typicalWorkTask,
    objectives: blueprint.objectives.map((description, index) => ({
      objectiveId: `${blueprint.sectionId}-objective-${index + 1}`,
      description,
      competencyRef: blueprint.competencyRefs[index]!,
    })),
    taskBrief: blueprint.taskBrief,
    publicSourceKnowledgeIds: [...blueprint.sourceKnowledgeIds],
    hiddenFacts: blueprint.hiddenFacts.map((fact) => ({
      factId: `${blueprint.sectionId}-sim-${fact.key}`,
      visibility: "teacher_and_engine" as const,
      summary: `仿真情境：${fact.summary}`,
      revealCondition: fact.revealCondition,
      requiredEvidenceIds: fact.evidenceKeys.map((key) => (
        evidenceId(blueprint.sectionId, key)
      )),
    })),
    actions: blueprint.actions.map((action) => ({
      actionId: actionId(blueprint.sectionId, action.key),
      label: action.label,
      intent: action.intent,
      guidance: action.guidance,
      requiredKnowledgeIds: [...action.knowledgeIds],
      producesEvidenceIds: action.evidenceKeys.map((key) => (
        evidenceId(blueprint.sectionId, key)
      )),
      primary: action.key === blueprint.primaryActionKey,
    })),
    dynamicEvents: [{
      eventId: `${blueprint.sectionId}-event-${blueprint.event.key}`,
      trigger: {
        kind: blueprint.event.triggerKind,
        ref: triggerRef,
      },
      studentBrief: blueprint.event.studentBrief,
      hiddenPayload: blueprint.event.hiddenPayload,
      affectedAgentIds: [...blueprint.event.affectedAgentIds],
      candidateAgentIds: [...blueprint.event.candidateAgentIds],
      teacherApprovalRequired: blueprint.event.teacherApprovalRequired,
    }],
    agentSelectionRules: [{
      ruleId: `${blueprint.sectionId}-agent-rule`,
      affectedAgentIds: [...blueprint.agentSelection.affectedAgentIds],
      candidateAgentIds: [...blueprint.agentSelection.candidateAgentIds],
      selectWhen: blueprint.agentSelection.selectWhen,
      skipWhen: blueprint.agentSelection.skipWhen,
      maximumSelectedAgents: blueprint.agentSelection.maximumSelectedAgents,
    }],
    adviceDecisionPolicy,
    artifact: {
      artifactId: `artifact-${blueprint.sectionId}`,
      label: blueprint.artifact.label,
      format: blueprint.artifact.format,
      completionCriteria: [...blueprint.artifact.completionCriteria],
      finalCourseArtifact: blueprint.artifact.finalCourseArtifact,
    },
    evidenceRequirements: blueprint.evidence.map((item) => ({
      evidenceId: evidenceId(blueprint.sectionId, item.key),
      label: item.label,
      description: item.description,
      minimumCount: item.minimumCount,
      acceptedSourceKinds: [...item.acceptedSourceKinds],
    })),
    rubric: blueprint.rubric.map((criterion) => ({
      criterionId: `${blueprint.sectionId}-rubric-${criterion.key}`,
      label: criterion.label,
      weight: criterion.weight,
      observable: criterion.observable,
      failClosedWhen: criterion.failClosedWhen,
    })),
    teacherGate: {
      gateId: `gate-${blueprint.sectionId}`,
      label: blueprint.teacherGate.label,
      trigger: blueprint.teacherGate.trigger,
      checks: [...blueprint.teacherGate.checks],
      minimumEvidenceCount: blueprint.teacherGate.minimumEvidenceCount,
      rejectReturnsToActionId: actionId(
        blueprint.sectionId,
        blueprint.teacherGate.rejectReturnsToActionKey,
      ),
    },
    migrationReflection: {
      prompt: blueprint.reflection.prompt,
      targetContext: blueprint.reflection.targetContext,
      requiredComparisonDimensions: [...blueprint.reflection.comparisonDimensions],
    },
  };
}

export function createMigrationCourse(
  blueprint: MigrationCourseBlueprint,
): Readonly<CourseContentRelease> {
  return createCourseContentRelease({
    schemaVersion: CourseContentSchemaVersion,
    targetContract: CourseReleaseTargetSchemaVersion,
    releaseRef: {
      courseId: blueprint.courseId,
      releaseId: blueprint.releaseId,
      version: blueprint.version,
    },
    releaseStatus: "content_frozen_pending_contract_integration",
    contentFrozenAt: "2026-08-09T16:30:00+08:00",
    sourceAccessCheckedAt: "2026-08-09",
    locale: "zh-CN",
    title: blueprint.title,
    summary: blueprint.summary,
    primaryJob: {
      jobId: "integrated-media-reporter",
      label: "融媒体采编岗",
      learnerRoleId: "reporter",
      learnerRoleLabel: "记者",
    },
    durationMinutes: blueprint.durationMinutes,
    courseOutcomes: [...blueprint.courseOutcomes],
    sections: blueprint.sections.map((section, index) => (
      buildMigrationSection(section, index + 1)
    )),
    knowledgeRecords: [...blueprint.knowledgeRecords],
    simulationPolicy: {
      hiddenFactsAreFictionalized: true,
      realPersonClaimsAllowed: false,
      description: "隐藏事实与动态事件均为不映射真实个人的教学仿真；公开事实只来自已登记来源，仿真结果不得反写为真实案例事实。",
    },
    mediaPolicy: {
      repositoryMediaAssets: [],
      rule: "no_unlicensed_image_audio_or_video",
      description: "只保存来源元数据、链接、定位和改写教学摘要；未获得明确授权的图片、音频、视频、标识或页面截图不进入仓库。",
    },
  });
}
