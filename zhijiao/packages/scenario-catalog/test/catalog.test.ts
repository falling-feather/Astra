import { describe, expect, it } from "vitest";
import {
  AccessPolicyVersion,
  CollaborationStrategySchema,
  CollaborationStrategySchemaVersion,
  FlagshipCollaborationEventId,
  FlagshipCollaborationRouteId,
  FlagshipCollaborationScenarioReleaseId,
  ScenarioActiveAgentTemplateIds,
  ScenarioCollaborationConfigSchemaVersion,
  ScenarioPackageSchema,
  ScenarioPackageSchemaVersion,
  type CollaborationStrategy,
  type CollaborationStrategyStatus,
  type RoleContract,
  type ScenarioCollaborationConfig,
  type ScenarioPackage,
} from "@ronggang/contracts";
import { createHash } from "node:crypto";
import {
  InMemoryScenarioCatalogStore,
  ScenarioCatalog,
  ScenarioPublishConflictError,
  ScenarioRevisionConflictError,
  canonicalJson,
  compareTransferScenarioReuse,
  createSeedRelease,
  hashScenarioPackage,
  inspectTransferScenario,
  inspectTransferScenarioStructure,
  validateScenarioPackage,
} from "../src/index.js";

function role(input: Pick<
  RoleContract,
  "agentId" | "actorKind" | "roleId" | "displayName" | "purpose"
> & Partial<RoleContract>): RoleContract {
  return {
    teamId: "team-test",
    visibleScopes: ["public_world", "assigned_team", "role_private"],
    privateScopes: [`actor:${input.agentId}`],
    allowedIntents: [],
    deniedActions: ["直接改写权威世界事实"],
    toolPolicy: ["read_reviewed_facts"],
    tokenBudget: 2_000,
    ...input,
  };
}

function scenarioFixture(): ScenarioPackage {
  const roles: RoleContract[] = [
    role({
      agentId: "teacher",
      actorKind: "teacher",
      roleId: "teacher",
      displayName: "教师",
      purpose: "复核",
      allowedIntents: ["approve_candidate_event"],
    }),
    role({
      agentId: "student-a",
      actorKind: "student",
      roleId: "responsible_editor",
      displayName: "学生甲",
      purpose: "编辑",
      communicationPolicy: {
        canInitiate: true,
        canRespond: false,
        allowedTargetRoleIds: ["fact_checker"],
        maxTurnsPerTarget: 2,
      },
    }),
    role({
      agentId: "student-b",
      actorKind: "student",
      roleId: "reporter",
      displayName: "学生乙",
      purpose: "采访",
    }),
    role({
      agentId: "fact-agent",
      actorKind: "agent",
      roleId: "fact_checker",
      displayName: "核查员",
      purpose: "核查",
      allowedIntents: ["propose_data_correction", "post_role_response"],
      communicationPolicy: {
        canInitiate: false,
        canRespond: true,
        allowedTargetRoleIds: [],
        maxTurnsPerTarget: 2,
      },
    }),
    role({
      agentId: "system",
      actorKind: "system",
      roleId: "system",
      displayName: "世界内核",
      purpose: "权威提交",
    }),
  ];
  return ScenarioPackageSchema.parse({
    schemaVersion: ScenarioPackageSchemaVersion,
    runtimeProfileId: "local-tourism-media/1.0.0",
    scenarioId: "scenario-test",
    courseId: "course-test",
    version: "1.0.0",
    title: "测试情境",
    description: "用于验证版本化情境目录",
    startVirtualTime: "09:00",
    durationMinutes: 30,
    nodes: [{
      nodeId: "brief",
      title: "任务",
      objective: "完成任务",
      order: 0,
      status: "active",
      requiredEvidenceKinds: [],
      completionEvent: "submission_created",
    }],
    roles,
    materials: [{
      materialId: "material-1",
      title: "登记材料",
      mediaType: "document",
      source: "测试",
      sourceRef: "demo://material-1",
      version: "1.0",
      copyrightStatus: "authorized",
      visibleToRoles: ["teacher", "responsible_editor", "reporter", "fact_checker"],
    }],
    bootstrap: {
      entryNodeId: "brief",
      initialFacts: [{
        factId: "fact-1",
        domain: "test",
        statement: "登记事实",
        status: "verified",
        sourceRefs: ["material-1"],
        version: "1.0",
        visibility: "assigned_team",
      }],
      openingMessages: [{
        actorId: "fact-agent",
        roleId: "fact_checker",
        displayName: "核查员",
        content: "开始核查",
        visibility: ["assigned_team"],
        visibleToActorIds: [],
      }],
      memorySeeds: [{
        actorId: "fact-agent",
        kind: "working",
        content: "仅供本角色读取",
      }],
    },
    roleInteractions: [{
      optionId: "ask-fact",
      initiatorActorId: "student-a",
      targetActorId: "fact-agent",
      targetRoleId: "fact_checker",
      kind: "question",
      topic: "visitor_count",
      label: "请求核查",
      description: "请求核查材料",
      content: "请核查材料。",
      prerequisites: [],
    }],
    rubricId: "rubric-test",
    rubricVersion: "1.0.0",
    rubric: [{
      criterionId: "trace",
      label: "追溯",
      weight: 1,
      rule: "保留事件",
      evaluation: { kind: "event_exists", eventType: "submission_created" },
    }],
    interactionGates: [{
      command: "inspect_material",
      requiredOptionIds: ["ask-fact"],
    }],
    eventPolicies: [{
      policyId: "correct",
      sourceIntentType: "propose_data_correction",
      sourceRoleId: "fact_checker",
      requiredOptionId: null,
      effectHandlerId: "visitor_correction_v1",
      eventType: "world_fact_updated",
      title: "事实更正",
      competencyTarget: "核查",
      expectedImpact: "更新事实",
      approvalPolicyId: "teacher-review",
    }],
    approvalPolicies: [{
      approvalPolicyId: "teacher-review",
      label: "教师复核",
      reviewMode: "teacher_required",
      allowReject: true,
      reasonRequired: true,
      minimumEvidenceCount: 0,
    }],
    knowledgeChunks: [{
      chunkId: "chunk-1",
      domain: "course",
      title: "课程知识",
      content: "核查知识",
      courseId: "course-test",
      nodeId: "brief",
      roleId: null,
      competencyId: "C-1",
      ruleDomain: "test",
      mediaType: "text",
      source: "测试库",
      version: "1.0",
      visibility: "assigned_team",
      contentHash: createHash("sha256")
        .update("核查知识", "utf8")
        .digest("hex"),
      corpusVersion: "test/1.0.0",
      status: "active",
      audience: {
        policyVersion: AccessPolicyVersion,
        courseId: "course-test",
        sessionId: null,
        sessionEpoch: null,
        scopes: ["assigned_team"],
        teamIds: ["team-test"],
        roleIds: [],
        actorIds: [],
        privateNamespaces: [],
        auditReadable: true,
      },
    }],
  });
}

const strategyContentHash = "a".repeat(64);

function collaborationConfig(
  contentHash = strategyContentHash,
): ScenarioCollaborationConfig {
  return {
    schemaVersion: ScenarioCollaborationConfigSchemaVersion,
    routeId: FlagshipCollaborationRouteId,
    eventId: FlagshipCollaborationEventId,
    enabledAgentTemplateIds: [...ScenarioActiveAgentTemplateIds],
    strategyRef: {
      strategyId: "strategy-rain-collaboration",
      version: 1,
      contentHash,
    },
  };
}

function collaborationStrategy(
  status: CollaborationStrategyStatus = "approved",
  input: {
    contentHash?: string;
    agentIds?: CollaborationStrategy["content"]["agentSet"];
    strategyId?: string;
    version?: number;
  } = {},
): CollaborationStrategy {
  const agentIds = input.agentIds ?? [
    "agent-evidence-coach",
    "agent-material-understanding",
  ];
  const latestAction = {
    approved: "approve",
    disabled: "disable",
    retired: "retire",
  } as const;
  return CollaborationStrategySchema.parse({
    kind: "CollaborationStrategy",
    schemaVersion: CollaborationStrategySchemaVersion,
    strategyId: input.strategyId ?? "strategy-rain-collaboration",
    version: input.version ?? 1,
    contentHash: input.contentHash ?? strategyContentHash,
    content: {
      eventConditions: {
        scenarioReleaseId: FlagshipCollaborationScenarioReleaseId,
        routeId: FlagshipCollaborationRouteId,
        triggerEventId: FlagshipCollaborationEventId,
        taskAnchorId: "flagship-task-rain-collaboration",
        requiredEventRefs: ["event-rain-entered"],
      },
      agentSet: agentIds,
      permissions: agentIds.map((agentId) => ({
        agentId,
        visibleScopes: ["assigned_team"],
        capabilities: ["read_fixed_evidence"],
        privateDataPolicy: "none",
        authoritativeWorldWrite: false,
      })),
      basisRefs: [{
        refType: "world_event",
        refId: "event-rain-entered",
        version: "1",
      }],
      recommendationSummary: "按岗位边界汇总暴雨事件中的协作建议。",
      studentChoice: {
        decision: "accepted",
        selectedAgentIds: ["agent-evidence-coach"],
        reason: "需要补足证据依据。",
        actionRef: "student-choice-rain",
        decidedAt: "2026-07-31T00:00:00.000Z",
      },
      consequenceRefs: ["consequence-rain"],
      evidenceRefs: ["evidence-rain"],
    },
    governance: status === "draft"
      ? {
        status,
        revision: 0,
        latestReview: null,
      }
      : {
        status,
        revision: 1,
        latestReview: {
          action: latestAction[status],
          teacherActorId: "teacher-content",
          reason: "确认仅服务固定旗舰暴雨事件。",
          reviewedAt: "2026-07-31T00:10:00.000Z",
        },
      },
    createdBy: "teacher-content",
    createdAt: "2026-07-31T00:00:00.000Z",
  });
}

async function flagshipDraftCatalog(): Promise<{
  catalog: ScenarioCatalog;
  draftId: string;
}> {
  const scenario = scenarioFixture();
  const [scenarioId, version] =
    FlagshipCollaborationScenarioReleaseId.split("@");
  scenario.scenarioId = scenarioId!;
  scenario.version = version!;
  const source = createSeedRelease({
    releaseId: "release-flagship-content-authoring-source",
    package: scenario,
  });
  const catalog = new ScenarioCatalog(new InMemoryScenarioCatalogStore());
  await catalog.initialize([source]);
  const draft = await catalog.copyRelease({
    releaseId: source.ref.releaseId,
    actorId: "teacher-content",
    draftId: "draft-flagship-content-authoring",
    now: "2026-07-31T01:00:00.000Z",
  });
  return { catalog, draftId: draft.draftId };
}

describe("ScenarioCatalog", () => {
  it("reports forward-transfer reuse from a fixed target leaf universe", () => {
    const template = scenarioFixture();
    const target = structuredClone(template);
    target.scenarioId = "scenario-forward-transfer-test";
    target.title = "前瞻迁移测试情境";

    const reuse = compareTransferScenarioReuse({ template, target });
    expect(reuse.method)
      .toBe("canonical-json-pointer-leaf-equality/target-pointer-universe");
    expect(reuse.changedJsonPointers).toEqual(
      expect.arrayContaining(["/scenarioId", "/title"]),
    );
    expect(
      reuse.reusedLeafCount + reuse.changedJsonPointers.length,
    ).toBe(reuse.comparableLeafCount);
    expect(reuse.ratio)
      .toBe(reuse.reusedLeafCount / reuse.comparableLeafCount);

    expect(inspectTransferScenarioStructure(target).status).toBe("failed");
    expect(() => inspectTransferScenario({
      template,
      target: template,
    })).toThrow(/全新scenarioId/u);
  });

  it("produces stable canonical hashes and structured validation issues", () => {
    const scenario = scenarioFixture();
    expect(validateScenarioPackage(scenario).valid).toBe(true);
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    expect(hashScenarioPackage(scenario)).toMatch(/^[a-f0-9]{64}$/u);

    const invalid = structuredClone(scenario);
    invalid.nodes.push({ ...invalid.nodes[0]!, title: "重复节点" });
    const report = validateScenarioPackage(invalid);
    expect(report.valid).toBe(false);
    expect(report.issues.some((item) => item.code === "duplicate_id")).toBe(true);
  });

  it("cross-validates course objectives and keeps their version aligned in safe drafts", async () => {
    const scenario = scenarioFixture();
    scenario.courseGuide = {
      contentVersion: "1.0.0",
      finalDeliverable: "形成可追溯的测试成果并完成复盘。",
      learningObjectives: [{
        objectiveId: "objective-trace",
        label: "过程追溯",
        competencyId: "C-1",
        description: "把岗位动作与世界证据关联。",
        evidenceKinds: ["世界事件", "成果修订"],
      }],
      roleBriefs: [
        {
          roleId: "responsible_editor",
          mission: "负责测试成果终审。",
          responsibilities: ["确认事实版本"],
          collaborationRoleIds: ["reporter", "fact_checker"],
          primaryNodeIds: ["brief"],
          deliverableTemplateIds: [],
          successSignals: ["结论可回指证据"],
          decisionBoundaries: ["不得越过教师门"],
        },
        {
          roleId: "reporter",
          mission: "负责采集和交接测试信源。",
          responsibilities: ["说明来源边界"],
          collaborationRoleIds: ["responsible_editor", "fact_checker"],
          primaryNodeIds: ["brief"],
          deliverableTemplateIds: [],
          successSignals: ["交接包含来源"],
          decisionBoundaries: ["不得替来源补充结论"],
        },
      ],
      nodeGuides: [{
        nodeId: "brief",
        situation: "测试材料已经登记，岗位需要完成分工。",
        studentGoal: "形成任务与证据清单。",
        requiredOutputs: ["岗位分工"],
        requiredMaterialIds: ["material-1"],
        suggestedArtifactTemplateIds: [],
        decisionQuestions: ["谁负责核查？"],
        teacherFocus: ["观察岗位是否分工"],
      }],
      debrief: {
        completionChecklist: ["任务与证据已经关联"],
        reflectionPrompts: ["哪条证据最关键？"],
        transferPrompt: "将同一方法迁移到另一项测试任务。",
      },
    };
    scenario.experienceDesign = {
      schemaVersion: "scenario-experience/1.0.0",
      contentVersion: "1.0.0",
      kind: "standard",
      summary: "用一个节点验证课程任务、NPC信息差、智能体贡献、世界后果和能力证据的交叉引用。",
      scenes: [{
        sceneId: "scene-brief",
        title: "测试任务台",
        description: "在一个结构化场景中完成核查任务。",
        visualMode: "structured_cards",
        nodeIds: ["brief"],
      }],
      npcInstances: [{
        actorId: "fact-agent",
        roleId: "fact_checker",
        displayName: "核查员",
        sceneIds: ["scene-brief"],
        privatePerspective: {
          knownInformation: ["登记材料来源"],
          withheldInformation: ["未经核查的结论"],
          disclosureRules: ["学生提出来源问题后再披露边界"],
        },
      }],
      hotspots: [{
        hotspotId: "hotspot-fact-agent",
        sceneId: "scene-brief",
        label: "核查席",
        description: "向核查员询问登记材料。",
        targetActorId: "fact-agent",
        visibleToRoleIds: ["responsible_editor"],
        interactionOptionIds: ["ask-fact"],
      }],
      nodeMappings: [{
        nodeId: "brief",
        operationTasks: [{
          taskId: "task-brief",
          label: "提交核查计划",
          description: "说明来源、问题和预期产出。",
          roleIds: ["responsible_editor"],
          expectedOutput: "核查计划",
          completionSignal: "计划形成固定版本",
        }],
        worldOpportunities: [{
          opportunityId: "opportunity-ask-fact",
          sceneId: "scene-brief",
          hotspotId: "hotspot-fact-agent",
          label: "向核查员提问",
          choiceRefs: ["ask-fact"],
          studentVisibleConsequence: "核查员的边界进入任务。",
        }],
        npcInformationGaps: [{
          gapId: "gap-fact",
          npcActorId: "fact-agent",
          knownInformation: "核查员知道登记材料来源。",
          withheldInformation: "核查员不会直接确认未经核查的结论。",
          revealCondition: "学生明确提出来源与边界问题。",
          resultingObjectKinds: ["线索", "待核声明"],
        }],
        agentContributions: [{
          contributionId: "contribution-fact",
          templateId: "template:fact-agent",
          plane: "professional_governance",
          trigger: "材料观察完成后运行。",
          outputKind: "事实更正候选",
          authority: "candidate_requires_teacher",
        }],
        dynamicEvents: [{
          dynamicEventId: "event-fact-updated",
          eventType: "world_fact_updated",
          triggerKind: "agent_candidate",
          triggerRef: "contribution-fact",
          worldChanges: ["核查事实进入世界"],
          affectedTaskIds: ["task-brief"],
          approvalPolicyId: "teacher-review",
        }],
        stageDeliverables: [{
          deliverableId: "deliverable-plan",
          label: "核查计划",
          objectKind: "course_task_revision",
          templateId: null,
          required: true,
        }],
        capabilityEvidence: [{
          evidenceRequirementId: "evidence-trace",
          competencyId: "C-1",
          behavior: "学生把问题、智能体候选和世界后果串联。",
          evidenceKind: "因果证据",
          sourceRefs: [
            "ask-fact",
            "event-fact-updated",
            "deliverable-plan",
          ],
          successCriterion: "所有结论都可回到来源。",
        }],
      }],
      causalBranches: [{
        branchId: "branch-brief",
        nodeId: "brief",
        label: "核查主分支",
        studentChoiceRef: "ask-fact",
        agentContributionRef: "contribution-fact",
        worldConsequenceRef: "event-fact-updated",
        capabilityEvidenceRef: "evidence-trace",
      }],
      fixedEvaluation: {
        evaluationId: "evaluation-test",
        rubricId: "rubric-test",
        rubricVersion: "1.0.0",
        evidenceRequirementIds: ["evidence-trace"],
        teacherFinalRequired: true,
      },
    };
    expect(validateScenarioPackage(scenario).valid).toBe(true);

    const missingRole = structuredClone(scenario);
    missingRole.courseGuide!.roleBriefs = missingRole.courseGuide!.roleBriefs
      .filter((brief) => brief.roleId !== "reporter");
    expect(validateScenarioPackage(missingRole).issues.some((item) => (
      item.code === "missing_student_role_brief"
    ))).toBe(true);

    const unknownMaterial = structuredClone(scenario);
    unknownMaterial.courseGuide!.nodeGuides[0]!.requiredMaterialIds = [
      "missing-material",
    ];
    expect(validateScenarioPackage(unknownMaterial).issues.some((item) => (
      item.code === "unknown_course_guide_material"
    ))).toBe(true);

    const mismatchedVersion = structuredClone(scenario);
    mismatchedVersion.courseGuide!.contentVersion = "1.1.0";
    expect(validateScenarioPackage(mismatchedVersion).issues.some((item) => (
      item.code === "course_guide_version_mismatch"
    ))).toBe(true);

    const unknownChoice = structuredClone(scenario);
    unknownChoice.experienceDesign!.nodeMappings[0]!
      .worldOpportunities[0]!.choiceRefs = ["missing-choice"];
    expect(validateScenarioPackage(unknownChoice).issues.some((item) => (
      item.code === "unknown_experience_choice_ref"
    ))).toBe(true);

    const choiceOutsideHotspot = structuredClone(scenario);
    choiceOutsideHotspot.experienceDesign!.hotspots[0]!.interactionOptionIds = [];
    expect(validateScenarioPackage(choiceOutsideHotspot).issues.some((item) => (
      item.code === "experience_opportunity_choice_hotspot_mismatch"
    ))).toBe(true);

    const sceneOutsideNode = structuredClone(scenario);
    sceneOutsideNode.experienceDesign!.scenes[0]!.nodeIds = ["missing-node"];
    expect(validateScenarioPackage(sceneOutsideNode).issues.some((item) => (
      item.code === "invalid_experience_opportunity_location"
    ))).toBe(true);

    const source = createSeedRelease({
      releaseId: "release-course-guide",
      package: scenario,
    });
    const catalog = new ScenarioCatalog(new InMemoryScenarioCatalogStore());
    await catalog.initialize([source]);
    const copied = await catalog.copyRelease({
      releaseId: source.ref.releaseId,
      actorId: "teacher",
      draftId: "draft-course-guide",
    });
    expect(copied.package.version).toBe("1.1.0");
    expect(copied.package.courseGuide?.contentVersion).toBe("1.1.0");
    expect(copied.package.experienceDesign?.contentVersion).toBe("1.1.0");
    expect(validateScenarioPackage(copied.package).valid).toBe(true);

    const versioned = await catalog.updateDraft({
      draftId: copied.draftId,
      expectedRevision: copied.revision,
      actorId: "teacher",
      patch: { version: "2.4.0" },
    });
    expect(versioned.package.version).toBe("2.4.0");
    expect(versioned.package.courseGuide?.contentVersion).toBe("2.4.0");
    expect(versioned.package.experienceDesign?.contentVersion).toBe("2.4.0");
    expect(validateScenarioPackage(versioned.package).valid).toBe(true);
  });

  it("validates production templates, role capabilities, and processing thresholds", () => {
    const scenario = scenarioFixture();
    const editor = scenario.roles.find((item) => (
      item.roleId === "responsible_editor"
    ))!;
    editor.allowedIntents.push(
      "create_production_artifact",
      "save_artifact_revision",
    );
    editor.toolPolicy.push("edit_artifact");
    scenario.productionConfig = {
      maximumUploadBytes: 5 * 1024 * 1024,
      allowedUploadMimeTypes: ["application/pdf"],
      processingPlans: [{
        planId: "document-source-extraction",
        label: "文档识别",
        description: "固定执行 OCR 与文本合规检查",
        allowedMediaTypes: ["document"],
        capabilities: ["ocr", "text_moderation"],
        maxAttemptsPerStep: 3,
        minimumSuccessfulSteps: 2,
      }],
      artifactTemplates: [{
        templateId: "article-main",
        kind: "article",
        label: "融媒体主稿",
        description: "形成至少两个可追溯修订",
        channel: "融媒体主稿",
        allowedRoleIds: ["responsible_editor"],
        minimumRevisions: 2,
        minimumCitations: 2,
        requiresVerifiedFact: true,
        sections: [{
          sectionId: "body",
          label: "正文",
          required: true,
          maxLength: 8_000,
          starterContent: "待编辑",
        }],
      }],
    };
    expect(validateScenarioPackage(scenario).valid).toBe(true);

    const invalidThreshold = structuredClone(scenario);
    invalidThreshold.productionConfig!.processingPlans[0]!.minimumSuccessfulSteps = 3;
    expect(validateScenarioPackage(invalidThreshold).issues.some((item) => (
      item.code === "processing_success_threshold_invalid"
    ))).toBe(true);

    const missingIntent = structuredClone(scenario);
    missingIntent.roles.find((item) => (
      item.roleId === "responsible_editor"
    ))!.allowedIntents = [];
    expect(validateScenarioPackage(missingIntent).issues.some((item) => (
      item.code === "production_role_intent_missing"
    ))).toBe(true);

    const duplicateSection = structuredClone(scenario);
    duplicateSection.productionConfig!.artifactTemplates[0]!.sections.push({
      ...duplicateSection.productionConfig!.artifactTemplates[0]!.sections[0]!,
    });
    expect(validateScenarioPackage(duplicateSection).issues.some((item) => (
      item.code === "duplicate_id"
    ))).toBe(true);
  });

  it("cross-validates the four governance node snapshots and role contracts", () => {
    const scenario = scenarioFixture();
    const editor = scenario.roles.find((item) => (
      item.roleId === "responsible_editor"
    ))!;
    editor.allowedIntents.push(
      "create_production_artifact",
      "save_artifact_revision",
      "request_governance_review",
    );
    editor.toolPolicy.push(
      "edit_artifact",
      "governance.review.request",
    );
    const teacher = scenario.roles.find((item) => (
      item.roleId === "teacher"
    ))!;
    teacher.allowedIntents.push("review_governance");
    teacher.toolPolicy.push("governance.review");

    const capabilityByMediaType = {
      text: "xingchen_agent",
      audio: "asr",
      image: "image_understanding",
      document: "ocr",
      video: "video_moderation",
    } as const;
    scenario.productionConfig = {
      maximumUploadBytes: 5 * 1024 * 1024,
      allowedUploadMimeTypes: ["application/pdf"],
      processingPlans: [{
        planId: "document-source-extraction",
        label: "文档识别",
        description: "固定执行 OCR",
        allowedMediaTypes: ["document"],
        capabilities: ["ocr"],
        maxAttemptsPerStep: 3,
        minimumSuccessfulSteps: 1,
      }],
      artifactTemplates: [{
        templateId: "article-main",
        kind: "article",
        label: "融媒体主稿",
        description: "形成至少两个可追溯修订",
        channel: "融媒体主稿",
        allowedRoleIds: ["responsible_editor"],
        minimumRevisions: 2,
        minimumCitations: 2,
        requiresVerifiedFact: true,
        sections: [{
          sectionId: "body",
          label: "正文",
          required: true,
          maxLength: 8_000,
          starterContent: "待编辑",
        }],
      }],
      governancePlan: {
        planId: "governance-v1",
        label: "四域治理",
        description: "固定材料版本上的并行专业发现",
        teacherApprovalRequired: true,
        maxAttemptsPerBranch: 3,
        timeoutMsPerBranch: 20_000,
        branches: ([
          [
            "fact",
            200,
            "governance-fact-consistency",
            "governance-fact/1.0.1",
            "source-consistency/2026.1",
          ],
          [
            "copyright",
            300,
            "governance-copyright-scope",
            "governance-copyright/1.0.1",
            "copyright-scope/2026.1",
          ],
          [
            "content_safety",
            400,
            "governance-content-safety",
            "governance-content-safety/1.0.1",
            "content-safety-cn/2026.1",
          ],
          [
            "platform_rule",
            100,
            "governance-platform-rules",
            "governance-platform/1.0.1",
            "platform-publication/2026.1",
          ],
        ] as const).map(([
          domain,
          priority,
          nodeId,
          promptVersion,
          rulesetId,
        ]) => ({
          domain,
          label: String(domain),
          priority,
          node: {
            nodeId,
            nodeType: "rule_tool_model",
            definitionVersion: "governance-specialist/1.0.1",
            promptVersion,
            rulesetId,
            knowledgeChunkIds: ["chunk-1"],
          },
          capabilityByMediaType,
        })),
      },
    };

    expect(validateScenarioPackage(scenario).valid).toBe(true);

    const unknownKnowledge = structuredClone(scenario);
    unknownKnowledge.productionConfig!.governancePlan!
      .branches[0]!.node.knowledgeChunkIds = ["unknown-chunk"];
    expect(validateScenarioPackage(unknownKnowledge).issues.some((item) => (
      item.code === "unknown_governance_knowledge"
    ))).toBe(true);

    const missingDomain = structuredClone(scenario);
    missingDomain.productionConfig!.governancePlan!.branches =
      missingDomain.productionConfig!.governancePlan!.branches.slice(0, 3);
    expect(validateScenarioPackage(missingDomain).issues.some((item) => (
      item.code === "governance_domains_incomplete"
    ))).toBe(true);

    const duplicateNode = structuredClone(scenario);
    duplicateNode.productionConfig!.governancePlan!
      .branches[1]!.node.nodeId = duplicateNode.productionConfig!
        .governancePlan!.branches[0]!.node.nodeId;
    expect(validateScenarioPackage(duplicateNode).issues.some((item) => (
      item.code === "duplicate_id"
    ))).toBe(true);
  });

  it("invalidates stale validation, uses optimistic revisions and keeps releases immutable", async () => {
    const source = createSeedRelease({
      releaseId: "release-test-1",
      package: scenarioFixture(),
    });
    const catalog = new ScenarioCatalog(new InMemoryScenarioCatalogStore());
    await catalog.initialize([source]);
    const draft = await catalog.copyRelease({
      releaseId: source.ref.releaseId,
      actorId: "teacher",
      draftId: "draft-test",
      now: "2026-07-25T00:00:00.000Z",
    });
    const firstReport = await catalog.validateDraft({
      draftId: draft.draftId,
      expectedRevision: 1,
      now: "2026-07-25T00:01:00.000Z",
    });
    const updated = await catalog.updateDraft({
      draftId: draft.draftId,
      expectedRevision: 1,
      actorId: "teacher",
      patch: { title: "修订情境" },
      now: "2026-07-25T00:02:00.000Z",
    });
    expect(updated.revision).toBe(2);
    await expect(catalog.updateDraft({
      draftId: draft.draftId,
      expectedRevision: 1,
      actorId: "teacher",
      patch: { title: "并发覆盖" },
    })).rejects.toBeInstanceOf(ScenarioRevisionConflictError);

    const concurrentSource = await catalog.copyRelease({
      releaseId: source.ref.releaseId,
      actorId: "teacher",
      draftId: "draft-concurrent",
    });
    const concurrent = await Promise.allSettled([
      catalog.updateDraft({
        draftId: concurrentSource.draftId,
        expectedRevision: 1,
        actorId: "teacher-a",
        patch: { title: "并发修订 A" },
      }),
      catalog.updateDraft({
        draftId: concurrentSource.draftId,
        expectedRevision: 1,
        actorId: "teacher-b",
        patch: { title: "并发修订 B" },
      }),
    ]);
    expect(concurrent.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(concurrent.filter((result) => result.status === "rejected")).toHaveLength(1);
    await expect(catalog.publishDraft({
      draftId: draft.draftId,
      expectedRevision: 2,
      validationStamp: firstReport.validationStamp!,
      actorId: "teacher",
    })).rejects.toBeInstanceOf(ScenarioPublishConflictError);

    const report = await catalog.validateDraft({
      draftId: draft.draftId,
      expectedRevision: 2,
      now: "2026-07-25T00:03:00.000Z",
    });
    const release = await catalog.publishDraft({
      draftId: draft.draftId,
      expectedRevision: 2,
      validationStamp: report.validationStamp!,
      actorId: "teacher",
      now: "2026-07-25T00:04:00.000Z",
      releaseId: "release-test-2",
    });
    release.package.title = "调用方试图篡改";
    expect(catalog.getRelease("release-test-2").package.title).toBe("修订情境");
    expect(catalog.resolve(catalog.getRelease("release-test-2").ref).package.version).toBe("1.1.0");
  });

  it("validates director route references, acyclic recovery and effect compatibility", () => {
    const scenario = scenarioFixture();
    scenario.roles.splice(-1, 0,
      role({
        agentId: "agent-scene-director",
        actorKind: "agent",
        roleId: "scene_director",
        displayName: "情境导演",
        purpose: "提出受控候选",
        allowedIntents: ["propose_scenario_intervention", "record_scene_no_op"],
      }),
      role({
        agentId: "agent-teaching",
        actorKind: "agent",
        roleId: "teaching_director",
        displayName: "教学导演",
        purpose: "形成教学指令",
        allowedIntents: ["record_teaching_directive"],
      }),
    );
    scenario.directorConfig = {
      difficulty: "standard",
      cadence: "balanced",
      cooldownEvents: 8,
      allowedRouteIds: ["route-a", "route-recovery"],
      teacherApprovalRequired: true,
    };
    scenario.directorEventTemplates = [
      {
        routeId: "route-a",
        kind: "challenge",
        title: "受控挑战",
        studentBrief: "请依据证据说明当前可以发布的边界。",
        competencyTarget: "C-1",
        expectedImpact: "检验岗位判断",
        affectedRoleIds: ["responsible_editor"],
        applicableNodeIds: ["brief"],
        triggerEventTypes: ["node_activated"],
        teachingStrategies: ["challenge"],
        difficultyLevels: ["standard"],
        minimumEvidenceCount: 0,
        maximumEvidenceCount: null,
        riskLevel: "medium",
        cooldownKey: "route-a",
        cooldownEvents: 8,
        alternativeRouteIds: ["route-recovery"],
        sourceRefs: ["chunk-1"],
        priority: 100,
        effectHandlerId: "director_intervention_v1",
        eventType: "scenario_intervention_applied",
        approvalPolicyId: "teacher-review",
      },
      {
        routeId: "route-recovery",
        kind: "recovery",
        title: "安全恢复",
        studentBrief: "请先列出证据缺口。",
        competencyTarget: "C-1",
        expectedImpact: "避免流程停滞",
        affectedRoleIds: ["responsible_editor"],
        applicableNodeIds: ["brief"],
        triggerEventTypes: ["director_recovery_requested"],
        teachingStrategies: ["no_intervention"],
        difficultyLevels: ["standard"],
        minimumEvidenceCount: 0,
        maximumEvidenceCount: null,
        riskLevel: "low",
        cooldownKey: "route-recovery",
        cooldownEvents: 4,
        alternativeRouteIds: [],
        sourceRefs: ["chunk-1"],
        priority: 120,
        effectHandlerId: "director_intervention_v1",
        eventType: "scenario_intervention_applied",
        approvalPolicyId: "teacher-review",
      },
    ];

    expect(validateScenarioPackage(scenario).valid).toBe(true);

    const cycle = structuredClone(scenario);
    cycle.directorEventTemplates![1]!.alternativeRouteIds = ["route-a"];
    expect(validateScenarioPackage(cycle).issues.some((item) => (
      item.code === "director_route_cycle"
    ))).toBe(true);

    const forgedEffect = structuredClone(scenario);
    forgedEffect.eventPolicies[0]!.eventType = "scene_completed";
    expect(validateScenarioPackage(forgedEffect).issues.some((item) => (
      item.code === "effect_event_mismatch"
    ))).toBe(true);

    const unsafeSource = structuredClone(scenario);
    unsafeSource.directorEventTemplates![0]!.sourceRefs = ["private-memory-seed"];
    expect(validateScenarioPackage(unsafeSource).issues.some((item) => (
      item.code === "unknown_director_source"
    ))).toBe(true);
  });

  it("keeps the flagship copy-edit-validate-preview-publish chain restricted and immutable", async () => {
    const { catalog, draftId } = await flagshipDraftCatalog();
    const copied = catalog.getDraft(draftId);
    expect(copied.package.collaborationConfig).toBeUndefined();

    const configured = await catalog.updateDraft({
      draftId,
      expectedRevision: copied.revision,
      actorId: "teacher-content",
      patch: {
        collaborationConfig: collaborationConfig(),
      },
      now: "2026-07-31T01:01:00.000Z",
    });
    const approved = collaborationStrategy();
    const report = await catalog.validateDraft({
      draftId,
      expectedRevision: configured.revision,
      collaborationStrategySnapshot: [approved],
      now: "2026-07-31T01:02:00.000Z",
    });
    expect(report.valid).toBe(true);
    expect(report.validationStamp).toMatch(/^[a-f0-9]{64}$/u);

    const beforePreview = catalog.getDraft(draftId);
    const preview = catalog.previewDraft({
      draftId,
      expectedRevision: configured.revision,
      collaborationStrategySnapshot: [approved],
      now: "2026-07-31T01:03:00.000Z",
    });
    expect(preview.report.valid).toBe(true);
    expect(preview.summary.changedFields).toContain("协作配置");
    expect(catalog.getDraft(draftId)).toEqual(beforePreview);

    const release = await catalog.publishDraft({
      draftId,
      expectedRevision: configured.revision,
      validationStamp: report.validationStamp!,
      actorId: "teacher-content",
      collaborationStrategySnapshot: [approved],
      releaseId: "release-flagship-content-authoring-published",
      now: "2026-07-31T01:04:00.000Z",
    });
    expect(release.package.collaborationConfig).toEqual(
      collaborationConfig(),
    );

    release.package.collaborationConfig!.strategyRef.contentHash =
      "f".repeat(64);
    expect(
      catalog.getRelease(release.ref.releaseId)
        .package.collaborationConfig?.strategyRef.contentHash,
    ).toBe(strategyContentHash);
  });

  it("requires the three restricted inputs on flagship 1.1.1 copies", async () => {
    const { catalog, draftId } = await flagshipDraftCatalog();
    const draft = catalog.getDraft(draftId);
    const report = await catalog.validateDraft({
      draftId,
      expectedRevision: draft.revision,
      collaborationStrategySnapshot: [collaborationStrategy()],
    });
    expect(report.valid).toBe(false);
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "collaboration_config_required" }),
    ]));
  });

  it("does not attach the flagship collaboration config to another scenario", async () => {
    const source = createSeedRelease({
      releaseId: "release-non-flagship-content-source",
      package: scenarioFixture(),
    });
    const catalog = new ScenarioCatalog(new InMemoryScenarioCatalogStore());
    await catalog.initialize([source]);
    const draft = await catalog.copyRelease({
      releaseId: source.ref.releaseId,
      actorId: "teacher-content",
      draftId: "draft-non-flagship-content",
    });
    const configured = await catalog.updateDraft({
      draftId: draft.draftId,
      expectedRevision: draft.revision,
      actorId: "teacher-content",
      patch: { collaborationConfig: collaborationConfig() },
    });
    const report = await catalog.validateDraft({
      draftId: configured.draftId,
      expectedRevision: configured.revision,
      collaborationStrategySnapshot: [collaborationStrategy()],
    });
    expect(report.valid).toBe(false);
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "collaboration_config_non_flagship_scenario",
      }),
    ]));
  });

  it.each(["draft", "disabled", "retired"] as const)(
    "blocks a %s strategy during validation",
    async (status) => {
      const { catalog, draftId } = await flagshipDraftCatalog();
      const draft = catalog.getDraft(draftId);
      const configured = await catalog.updateDraft({
        draftId,
        expectedRevision: draft.revision,
        actorId: "teacher-content",
        patch: { collaborationConfig: collaborationConfig() },
      });
      const report = await catalog.validateDraft({
        draftId,
        expectedRevision: configured.revision,
        collaborationStrategySnapshot: [collaborationStrategy(status)],
      });
      expect(report.valid).toBe(false);
      expect(report.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({
          code: "collaboration_strategy_not_approved",
        }),
      ]));
    },
  );

  it.each([
    [
      "missing strategy",
      [] as CollaborationStrategy[],
      collaborationConfig(),
      "collaboration_strategy_missing",
    ],
    [
      "content hash drift",
      [collaborationStrategy()],
      collaborationConfig("b".repeat(64)),
      "collaboration_strategy_hash_drift",
    ],
  ])("blocks %s", async (_label, strategies, config, expectedCode) => {
    const { catalog, draftId } = await flagshipDraftCatalog();
    const draft = catalog.getDraft(draftId);
    const configured = await catalog.updateDraft({
      draftId,
      expectedRevision: draft.revision,
      actorId: "teacher-content",
      patch: { collaborationConfig: config },
    });
    const report = await catalog.validateDraft({
      draftId,
      expectedRevision: configured.revision,
      collaborationStrategySnapshot: strategies,
    });
    expect(report.valid).toBe(false);
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: expectedCode }),
    ]));
  });

  it("rejects a snapshot with multiple approved strategies for the fixed trigger", async () => {
    const { catalog, draftId } = await flagshipDraftCatalog();
    const draft = catalog.getDraft(draftId);
    const configured = await catalog.updateDraft({
      draftId,
      expectedRevision: draft.revision,
      actorId: "teacher-content",
      patch: { collaborationConfig: collaborationConfig() },
    });
    const report = await catalog.validateDraft({
      draftId,
      expectedRevision: configured.revision,
      collaborationStrategySnapshot: [
        collaborationStrategy(),
        collaborationStrategy("approved", {
          contentHash: "c".repeat(64),
          strategyId: "strategy-rain-collaboration-duplicate",
        }),
      ],
    });

    expect(report.valid).toBe(false);
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "collaboration_strategy_approved_ambiguous",
        message:
          "同一代表性事件必须且只能有一个与冻结引用完全一致的 approved 协作策略",
      }),
    ]));
    expect(JSON.stringify(report.issues)).not.toMatch(
      /鍚|浠|绛|鐣|闃|锛/u,
    );
  });

  it.each([
    [
      "disabled",
      collaborationStrategy("disabled"),
    ],
    [
      "retired",
      collaborationStrategy("retired"),
    ],
    [
      "content hash drift",
      collaborationStrategy("approved", {
        contentHash: "b".repeat(64),
      }),
    ],
  ])(
    "rechecks %s immediately before publishing",
    async (_label, currentStrategy) => {
      const { catalog, draftId } = await flagshipDraftCatalog();
      const draft = catalog.getDraft(draftId);
      const configured = await catalog.updateDraft({
        draftId,
        expectedRevision: draft.revision,
        actorId: "teacher-content",
        patch: { collaborationConfig: collaborationConfig() },
      });
      const report = await catalog.validateDraft({
        draftId,
        expectedRevision: configured.revision,
        collaborationStrategySnapshot: [collaborationStrategy()],
      });
      expect(report.valid).toBe(true);
      await expect(catalog.publishDraft({
        draftId,
        expectedRevision: configured.revision,
        validationStamp: report.validationStamp!,
        actorId: "teacher-content",
        collaborationStrategySnapshot: [currentStrategy],
      })).rejects.toBeInstanceOf(ScenarioPublishConflictError);
      expect(catalog.list().releases).toHaveLength(1);
    },
  );
});
