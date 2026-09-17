import { createHash } from "node:crypto";
import {
  ScenarioExperienceSchemaVersion,
  ScenarioPackageSchema,
  ScenarioPackageSchemaVersion,
  type RoleContract,
  type ScenarioDynamicEvent,
  type ScenarioPackage,
} from "@ronggang/contracts";
import type {
  CourseContentRelease,
  CourseSection,
  KnowledgeRecord,
} from "@ronggang/course-content";
import { xunpuScenarioV201 } from "./xunpu-scenario.js";

const reporterDecisionLabels = {
  accept: ["采纳建议", "依据当前任务与证据边界采纳本轮唯一建议。"],
  request_evidence: ["请求补证", "建议方向可能有效，但需要先补齐来源、版本或现场证据。"],
  reject: ["拒绝建议", "建议与当前证据、岗位边界或任务目标不匹配。"],
} as const;

const npcActorIds = new Set([
  "agent-chief",
  "agent-interviewee",
  "agent-copyright",
  "agent-platform",
]);

export interface MigrationRuntimeScenarioProfile {
  scenarioId: string;
  version: string;
  teamId: string;
  startVirtualTime: string;
  openingBrief: string;
  simulationDomain: string;
  intermediateBusinessReviewMode?:
    | "separate_teacher_gate"
    | "completion_teacher_gate";
}

export interface MigrationRuntimeSectionMapping {
  sectionId: string;
  actionIds: readonly [string, string, string];
  primaryActionId: string;
  businessEventId: string;
  completionEventId: string;
  teacherGateId: string;
  businessApprovalPolicyId: string | null;
  businessReviewDeferredToCompletion: boolean;
  mergedBusinessAndCompletion: boolean;
  terminal: boolean;
  affectedAgentIds: readonly string[];
  candidateAgentIds: readonly string[];
  maximumSelectedAgents: number;
}

export interface MigrationRuntimeScenarioBuildResult {
  scenario: ScenarioPackage;
  sectionMappings: readonly MigrationRuntimeSectionMapping[];
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function materialIdOf(knowledgeId: string): string {
  return `material-${knowledgeId}`;
}

function sceneIdOf(sectionId: string): string {
  return `scene-${sectionId}`;
}

function hotspotIdOf(sectionId: string): string {
  return `hotspot-${sectionId}`;
}

function contributionIdOf(sectionId: string): string {
  return `${sectionId}:agent-contribution`;
}

function evidenceRequirementIdOf(sectionId: string): string {
  return `${sectionId}:capability-evidence`;
}

function npcActorIdOf(section: CourseSection): string {
  const candidates = [
    ...section.dynamicEvents.flatMap((event) => event.affectedAgentIds),
    ...section.agentSelectionRules.flatMap((rule) => rule.candidateAgentIds),
  ];
  return candidates.find((candidate) => npcActorIds.has(candidate))
    ?? "agent-chief";
}

function runtimeRoles(
  course: CourseContentRelease,
  profile: MigrationRuntimeScenarioProfile,
): RoleContract[] {
  return xunpuScenarioV201.roles.map((source) => {
    const role = structuredClone(source);
    role.teamId = profile.teamId;
    if (role.agentId === "teacher-main") {
      role.purpose = `组织“${course.title}”实训、审批世界后果并完成教学复核。`;
    } else if (role.agentId === "student-reporter") {
      role.purpose = `以融媒体记者主岗位完成“${course.title}”全部连续任务。`;
    } else if (role.agentId === "system") {
      role.purpose = "保存唯一权威事件流，并且只执行通过教师门的世界后果。";
    }
    return role;
  });
}

function materialOf(
  record: KnowledgeRecord,
  courseId: string,
): ScenarioPackage["materials"][number] {
  return {
    materialId: materialIdOf(record.knowledgeId),
    title: `${record.topic}（公开来源索引）`,
    mediaType: "document",
    source: [
      record.source.publisher,
      record.source.title,
      record.source.url,
      record.source.locator,
    ].join("｜"),
    sourceRef: `demo://${courseId}/knowledge/${record.knowledgeId}`,
    version: record.source.sourceVersion,
    copyrightStatus: "restricted",
    visibleToRoles: [
      "teacher",
      "reporter",
      "editor_in_chief",
      "fact_checker",
    ],
  };
}

function knowledgeChunkOf(
  record: KnowledgeRecord,
  course: CourseContentRelease,
  profile: MigrationRuntimeScenarioProfile,
): ScenarioPackage["knowledgeChunks"][number] {
  const nodeId = record.applicableSectionIds.find((candidate) => (
    course.sections.some((section) => section.sectionId === candidate)
  )) ?? course.sections[0]!.sectionId;
  const section = course.sections.find((candidate) => (
    candidate.sectionId === nodeId
  )) ?? course.sections[0]!;
  return {
    chunkId: `chunk-${record.knowledgeId}`,
    domain: "course",
    title: record.topic,
    content: record.teachingSummary,
    courseId: course.releaseRef.courseId,
    nodeId,
    roleId: "reporter",
    competencyId: section.objectives[0]?.competencyRef ?? "integrated-media-reporting",
    ruleDomain: "source-grounded-course-content",
    mediaType: "text",
    source: `${record.source.publisher}｜${record.source.url}｜${record.source.locator}`,
    version: profile.version,
    visibility: "assigned_team",
    contentHash: sha256(record.teachingSummary),
    corpusVersion: `${course.releaseRef.courseId}/${profile.version}`,
    status: "active",
    audience: {
      policyVersion: "acl/1.0.0",
      courseId: course.releaseRef.courseId,
      sessionId: null,
      sessionEpoch: null,
      scopes: ["assigned_team"],
      teamIds: [profile.teamId],
      roleIds: ["reporter"],
      actorIds: [],
      privateNamespaces: [],
      auditReadable: true,
    },
  };
}

function buildSectionMapping(
  section: CourseSection,
  terminal: boolean,
  intermediateBusinessReviewMode: NonNullable<
    MigrationRuntimeScenarioProfile["intermediateBusinessReviewMode"]
  >,
): MigrationRuntimeSectionMapping {
  if (section.actions.length !== 3) {
    throw new Error(`${section.sectionId} runtime 只接受三步迁移课程章节`);
  }
  const actionIds = section.actions.map((action) => action.actionId) as [
    string,
    string,
    string,
  ];
  const primaryActions = section.actions.filter((action) => action.primary);
  if (primaryActions.length !== 1) {
    throw new Error(`${section.sectionId} runtime 必须且只能声明一个主行动`);
  }
  const businessEvents = section.dynamicEvents;
  if (businessEvents.length !== 1) {
    throw new Error(`${section.sectionId} runtime 必须且只能声明一个内容业务事件`);
  }
  const businessEvent = businessEvents[0]!;
  if (businessEvent.trigger.kind !== "on_action") {
    throw new Error(`${section.sectionId} runtime 当前只接受 on_action 动态事件`);
  }
  const primaryActionId = primaryActions[0]!.actionId;
  const mergedBusinessAndCompletion = businessEvent.trigger.ref === primaryActionId;
  const businessReviewDeferredToCompletion = Boolean(
    businessEvent.teacherApprovalRequired
    && !mergedBusinessAndCompletion
    && intermediateBusinessReviewMode === "completion_teacher_gate",
  );
  const rule = section.agentSelectionRules[0];
  if (!rule) throw new Error(`${section.sectionId} 缺少智能体选择规则`);
  return {
    sectionId: section.sectionId,
    actionIds,
    primaryActionId,
    businessEventId: businessEvent.eventId,
    completionEventId: mergedBusinessAndCompletion
      ? businessEvent.eventId
      : `${section.sectionId}:${terminal ? "complete-event" : "advance-event"}`,
    teacherGateId: section.teacherGate.gateId,
    businessApprovalPolicyId:
      businessEvent.teacherApprovalRequired
        && !mergedBusinessAndCompletion
        && !businessReviewDeferredToCompletion
        ? `${businessEvent.eventId}:teacher-review`
        : null,
    businessReviewDeferredToCompletion,
    mergedBusinessAndCompletion,
    terminal,
    affectedAgentIds: [...rule.affectedAgentIds],
    candidateAgentIds: [...rule.candidateAgentIds],
    maximumSelectedAgents: rule.maximumSelectedAgents,
  };
}

function dynamicEventsOf(
  section: CourseSection,
  mapping: MigrationRuntimeSectionMapping,
): ScenarioDynamicEvent[] {
  const event = section.dynamicEvents[0]!;
  const common = {
    triggerKind: "student_action" as const,
    affectedTaskIds: [...mapping.actionIds],
  };
  if (mapping.mergedBusinessAndCompletion) {
    return [{
      dynamicEventId: mapping.businessEventId,
      eventType: mapping.terminal ? "scene_completed" : "node_activated",
      triggerRef: mapping.primaryActionId,
      worldChanges: [
        event.studentBrief,
        `“${section.title}”完成教师门后进入下一节。`,
      ],
      approvalPolicyId: mapping.teacherGateId,
      ...common,
    }];
  }
  return [
    {
      dynamicEventId: mapping.businessEventId,
      eventType: "experience_consequence_applied",
      triggerRef: event.trigger.ref,
      worldChanges: [event.studentBrief],
      approvalPolicyId: mapping.businessApprovalPolicyId,
      ...common,
    },
    {
      dynamicEventId: mapping.completionEventId,
      eventType: mapping.terminal ? "scene_completed" : "node_activated",
      triggerRef: mapping.primaryActionId,
      worldChanges: [
        mapping.terminal
          ? `“${section.title}”完成教师终门，课程情境进入完成态。`
          : `“${section.title}”完成教师门，下一节任务开放。`,
      ],
      approvalPolicyId: mapping.teacherGateId,
      ...common,
    },
  ];
}

function approvalPoliciesOf(
  course: CourseContentRelease,
  mappings: readonly MigrationRuntimeSectionMapping[],
): ScenarioPackage["approvalPolicies"] {
  return mappings.flatMap((mapping, index) => {
    const section = course.sections[index]!;
    const completionPolicy = {
      approvalPolicyId: mapping.teacherGateId,
      label: section.teacherGate.label,
      reviewMode: "teacher_required" as const,
      allowReject: true,
      reasonRequired: true,
      minimumEvidenceCount: section.teacherGate.minimumEvidenceCount,
    };
    return mapping.businessApprovalPolicyId
      ? [{
          approvalPolicyId: mapping.businessApprovalPolicyId,
          label: `${section.title}动态业务事件复核`,
          reviewMode: "teacher_required" as const,
          allowReject: true,
          reasonRequired: true,
          minimumEvidenceCount: 1,
        }, completionPolicy]
      : [completionPolicy];
  });
}

function courseRubricOf(
  course: CourseContentRelease,
): ScenarioPackage["rubric"] {
  return [
    {
      criterionId: `${course.releaseRef.courseId}:source-quality`,
      label: "来源与事实准确",
      weight: 0.3,
      rule: "关键判断必须能够回指公开来源定位与本节过程证据。",
      evaluation: { kind: "evidence_count", minimum: 3 },
    },
    {
      criterionId: `${course.releaseRef.courseId}:collaboration-decision`,
      label: "智能体协作决定",
      weight: 0.25,
      rule: "每节记录一次采纳、补证或拒绝决定，并保留依据。",
      evaluation: { kind: "event_exists", eventType: "experience_choice_recorded" },
    },
    {
      criterionId: `${course.releaseRef.courseId}:deliverable`,
      label: "岗位成果可用性",
      weight: 0.3,
      rule: "三步行动形成可追溯成果并经章节教师门复核。",
      evaluation: { kind: "event_exists", eventType: "candidate_event_approved" },
    },
    {
      criterionId: `${course.releaseRef.courseId}:transfer`,
      label: "迁移与复盘",
      weight: 0.15,
      rule: "完成终章作品、连续更新记录与迁移反思。",
      evaluation: { kind: "event_exists", eventType: "scene_completed" },
    },
  ];
}

/**
 * Converts an immutable migration-course content release into an executable
 * reporter-only ScenarioPackage without moving authority out of WorldEngine.
 * Content business events (B) and section completion events (X) remain
 * causally separate unless they intentionally share the primary action. A
 * runtime successor may defer intermediate B review to the reachable X gate.
 */
export function buildMigrationRuntimeScenario(
  course: CourseContentRelease,
  profile: MigrationRuntimeScenarioProfile,
): MigrationRuntimeScenarioBuildResult {
  if (course.sections.length === 0 || course.knowledgeRecords.length === 0) {
    throw new Error("迁移课程 runtime 需要章节与来源知识记录");
  }
  const expectedOrders = course.sections.map((_, index) => index + 1);
  if (course.sections.some((section, index) => (
    section.order !== expectedOrders[index]
  ))) {
    throw new Error("迁移课程章节顺序必须从 1 连续递增");
  }
  const mappings = course.sections.map((section, index) => (
    buildSectionMapping(
      section,
      index === course.sections.length - 1,
      profile.intermediateBusinessReviewMode ?? "separate_teacher_gate",
    )
  ));
  const roles = runtimeRoles(course, profile);
  const materials = course.knowledgeRecords.map((record) => (
    materialOf(record, course.releaseRef.courseId)
  ));
  const mappingsBySectionId = new Map(
    mappings.map((mapping) => [mapping.sectionId, mapping]),
  );
  const npcIds = [...new Set(course.sections.map(npcActorIdOf))];
  const npcInstances = npcIds.map((actorId) => {
    const role = roles.find((candidate) => candidate.agentId === actorId);
    if (!role || role.actorKind !== "agent") {
      throw new Error(`迁移课程引用未知 NPC：${actorId}`);
    }
    return {
      actorId,
      roleId: role.roleId,
      displayName: role.displayName,
      sceneIds: course.sections
        .filter((section) => npcActorIdOf(section) === actorId)
        .map((section) => sceneIdOf(section.sectionId)),
      privatePerspective: {
        knownInformation: ["只说明当前岗位边界、公开来源缺口和可执行补证方向。"],
        withheldInformation: ["仿真隐藏事实只在声明的触发条件满足后按最小必要范围披露。"],
        disclosureRules: ["不替学生完成行动", "不把仿真事实改写成真实案例事实"],
      },
    };
  });
  const nodeMappings = course.sections.map((section) => {
    const mapping = mappingsBySectionId.get(section.sectionId)!;
    const npcActorId = npcActorIdOf(section);
    const contributionId = contributionIdOf(section.sectionId);
    const deliverableId = section.artifact.artifactId;
    const capabilityEvidenceId = evidenceRequirementIdOf(section.sectionId);
    const operationTasks = [
      ...section.actions.map((action) => ({
        taskId: action.actionId,
        label: action.label,
        description: action.guidance,
        roleIds: ["reporter" as const],
        expectedOutput: action.producesEvidenceIds.join("、"),
        completionSignal: action.primary
          ? "形成章节完成候选，经教师门批准后才推进世界状态"
          : "行动写入权威事件流并形成过程证据",
      })),
      ...(Object.keys(reporterDecisionLabels) as Array<
        keyof typeof reporterDecisionLabels
      >).map((decision) => ({
        taskId: `${section.sectionId}:agent-decision:${decision}`,
        label: reporterDecisionLabels[decision][0],
        description: reporterDecisionLabels[decision][1],
        roleIds: ["reporter" as const],
        expectedOutput: "本节唯一智能体建议处理决定",
        completionSignal: "三选一决定写入权威事件流，且同一章节不可改写",
      })),
    ];
    const dynamicEvents = dynamicEventsOf(section, mapping);
    return {
      nodeId: section.sectionId,
      operationTasks,
      worldOpportunities: [{
        opportunityId: `${section.sectionId}:world-opportunity`,
        sceneId: sceneIdOf(section.sectionId),
        hotspotId: hotspotIdOf(section.sectionId),
        label: `完成“${section.title}”三步现场任务`,
        choiceRefs: [...mapping.actionIds],
        studentVisibleConsequence: dynamicEvents.at(-1)!.worldChanges[0]!,
      }],
      npcInformationGaps: [{
        gapId: `${section.sectionId}:npc-information-gap`,
        npcActorId,
        knownInformation: section.taskBrief,
        withheldInformation: "本节含仿真隐藏事实；未满足披露条件前，NPC 不提供结论。",
        revealCondition: section.hiddenFacts[0]?.revealCondition
          ?? "学生先提交来源或行动证据。",
        resultingObjectKinds: ["evidence", "teacher_gate_candidate"],
      }],
      agentContributions: [{
        contributionId,
        templateId: "assistant/evidence-coach",
        plane: "student_assistance" as const,
        trigger: section.agentSelectionRules[0]!.selectWhen,
        outputKind: "基于受影响集合生成的单条证据建议",
        authority: "advisory_only" as const,
      }],
      dynamicEvents,
      stageDeliverables: [{
        deliverableId,
        label: section.artifact.label,
        objectKind: "course_stage_deliverable",
        templateId: null,
        required: true,
      }],
      capabilityEvidence: [{
        evidenceRequirementId: capabilityEvidenceId,
        competencyId: section.objectives[0]?.competencyRef
          ?? "integrated-media-reporting",
        behavior: `完成“${section.title}”三步行动，说明来源、建议决定、教师门与世界后果之间的因果关系。`,
        evidenceKind: section.evidenceRequirements.map((item) => item.label).join("、"),
        sourceRefs: [
          ...mapping.actionIds,
          contributionId,
          ...dynamicEvents.map((event) => event.dynamicEventId),
          deliverableId,
        ],
        successCriterion: "行动、证据、建议决定、教师审批和世界写回可追溯，且智能体无权威写入。",
      }],
    };
  });
  const firstMaterialId = materials[0]!.materialId;
  const rubricId = `rubric-${course.releaseRef.courseId}`;
  const scenario = ScenarioPackageSchema.parse({
    schemaVersion: ScenarioPackageSchemaVersion,
    runtimeProfileId: "local-tourism-media/1.0.0",
    scenarioId: profile.scenarioId,
    courseId: course.releaseRef.courseId,
    version: profile.version,
    title: course.title,
    description: `${course.summary} 普通学生固定承担记者主岗位，其余岗位由受控智能体/NPC 协作。`,
    startVirtualTime: profile.startVirtualTime,
    durationMinutes: course.durationMinutes,
    nodes: course.sections.map((section, index) => ({
      nodeId: section.sectionId,
      title: section.title,
      objective: section.typicalWorkTask,
      order: index,
      status: index === 0 ? "active" : index === 1 ? "available" : "locked",
      requiredEvidenceKinds: section.evidenceRequirements.map((item) => item.label),
      completionEvent: index === course.sections.length - 1
        ? "scene_completed"
        : "node_activated",
    })),
    roles,
    materials,
    bootstrap: {
      entryNodeId: course.sections[0]!.sectionId,
      initialFacts: [
        {
          factId: `${profile.scenarioId}:public-sources-registered`,
          domain: profile.simulationDomain,
          statement: "本课程公开来源已按发布者、日期、定位、版本和复核状态登记。",
          status: "verified",
          sourceRefs: [firstMaterialId],
          version: profile.version,
          visibility: "assigned_team",
        },
        {
          factId: `${profile.scenarioId}:simulation-not-public-fact`,
          domain: "simulation-boundary",
          statement: "动态事件与隐藏事实均为教学仿真，不得反写为真实案例事实。",
          status: "verified",
          sourceRefs: [firstMaterialId],
          version: profile.version,
          visibility: "assigned_team",
        },
      ],
      openingMessages: [{
        actorId: "agent-chief",
        roleId: "editor_in_chief",
        displayName: roles.find((role) => role.agentId === "agent-chief")!.displayName,
        content: profile.openingBrief,
        visibility: ["role_private", "audit_only"],
        visibleToActorIds: ["student-reporter"],
      }],
      memorySeeds: [{
        actorId: "agent-chief",
        kind: "working",
        content: "只提供任务边界、证据缺口与修订建议；不替学生行动，不直接写入世界后果。",
      }],
    },
    roleInteractions: [{
      optionId: `${profile.scenarioId}:chief-review`,
      initiatorActorId: "student-reporter",
      targetActorId: "agent-chief",
      targetRoleId: "editor_in_chief",
      kind: "request_commitment",
      topic: "release_decision",
      label: "请求责任编辑核对任务与事实边界",
      description: "提交本节来源、行动与版本差异，请责任编辑只指出问题和补证边界。",
      content: "请核对当前来源、事实边界、版本与发布风险，不代写成果，不直接推进节点。",
      prerequisites: [],
    }],
    rubricId,
    rubricVersion: profile.version,
    rubric: courseRubricOf(course),
    interactionGates: [],
    eventPolicies: [{
      policyId: `${profile.scenarioId}:platform-escalation-policy`,
      sourceIntentType: "propose_platform_escalation",
      sourceRoleId: "platform_operator",
      requiredOptionId: null,
      effectHandlerId: "platform_escalation_v1",
      eventType: "node_activated",
      title: "平台规则变化候选",
      competencyTarget: "多平台发布与更正边界",
      expectedImpact: "仅在教师批准后形成受控世界后果。",
      approvalPolicyId: mappings[0]!.teacherGateId,
    }],
    approvalPolicies: approvalPoliciesOf(course, mappings),
    courseGuide: {
      contentVersion: profile.version,
      finalDeliverable: course.sections.at(-1)!.artifact.label,
      learningObjectives: course.sections.flatMap((section) => (
        section.objectives.map((objective) => ({
          objectiveId: objective.objectiveId,
          label: section.title,
          competencyId: objective.competencyRef,
          description: objective.description,
          evidenceKinds: section.evidenceRequirements.map((item) => item.label),
        }))
      )),
      roleBriefs: [{
        roleId: "reporter",
        mission: `以记者主岗位连续完成“${course.title}”，对来源、行动、建议决定与成果版本负责。`,
        responsibilities: ["核验公开来源", "完成三步现场任务", "处理单条智能体建议", "提交教师门", "完成迁移复盘"],
        collaborationRoleIds: ["editor_in_chief", "fact_checker", "copyright_owner", "platform_operator"],
        primaryNodeIds: course.sections.map((section) => section.sectionId),
        deliverableTemplateIds: [],
        successSignals: ["每节三步行动均有过程证据", "业务事件与完成门不混写", "最终作品和迁移反思可回放"],
        decisionBoundaries: ["智能体建议不得自动成为事实", "仿真隐藏事实不得写成真实案例事实", "教师门批准前不得推进权威世界状态"],
      }],
      nodeGuides: course.sections.map((section) => ({
        nodeId: section.sectionId,
        situation: section.taskBrief,
        studentGoal: section.typicalWorkTask,
        requiredOutputs: [...section.artifact.completionCriteria],
        requiredMaterialIds: section.publicSourceKnowledgeIds.map(materialIdOf),
        suggestedArtifactTemplateIds: [],
        decisionQuestions: ["当前结论能否回指来源定位？", "为什么采纳、补证或拒绝本轮建议？"],
        teacherFocus: [...section.teacherGate.checks],
      })),
      debrief: {
        completionChecklist: ["全部章节完成教师门", "最终作品与证据连续", "动态事件和更正记录可回放"],
        reflectionPrompts: course.sections.map((section) => section.migrationReflection.prompt),
        transferPrompt: course.courseOutcomes.join("；"),
      },
    },
    experienceDesign: {
      schemaVersion: ScenarioExperienceSchemaVersion,
      contentVersion: profile.version,
      kind: "standard",
      summary: "六个连续现场把三步记者任务、单条智能体建议、动态业务事件、教师完成门与权威世界后果串成可回放链路。",
      scenes: course.sections.map((section) => ({
        sceneId: sceneIdOf(section.sectionId),
        title: section.title,
        description: section.taskBrief,
        visualMode: "structured_cards",
        nodeIds: [section.sectionId],
      })),
      npcInstances,
      hotspots: course.sections.map((section) => ({
        hotspotId: hotspotIdOf(section.sectionId),
        sceneId: sceneIdOf(section.sectionId),
        label: `${section.title}任务台`,
        description: section.typicalWorkTask,
        targetActorId: npcActorIdOf(section),
        visibleToRoleIds: ["reporter"],
        interactionOptionIds: [],
      })),
      nodeMappings,
      causalBranches: course.sections.map((section) => {
        const mapping = mappingsBySectionId.get(section.sectionId)!;
        return {
          branchId: `${section.sectionId}:causal-branch`,
          nodeId: section.sectionId,
          label: `${section.title}主因果分支`,
          studentChoiceRef: mapping.primaryActionId,
          agentContributionRef: contributionIdOf(section.sectionId),
          worldConsequenceRef: mapping.completionEventId,
          capabilityEvidenceRef: evidenceRequirementIdOf(section.sectionId),
        };
      }),
      fixedEvaluation: {
        evaluationId: `${profile.scenarioId}:fixed-evaluation`,
        rubricId,
        rubricVersion: profile.version,
        evidenceRequirementIds: course.sections.map((section) => (
          evidenceRequirementIdOf(section.sectionId)
        )),
        teacherFinalRequired: true,
      },
    },
    knowledgeChunks: course.knowledgeRecords.map((record) => (
      knowledgeChunkOf(record, course, profile)
    )),
  });
  return {
    scenario,
    sectionMappings: mappings.map((mapping) => ({
      ...mapping,
      actionIds: [...mapping.actionIds] as [string, string, string],
      affectedAgentIds: [...mapping.affectedAgentIds],
      candidateAgentIds: [...mapping.candidateAgentIds],
    })),
  };
}
