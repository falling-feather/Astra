import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FieldExplorationViewV4Schema, type StudentAgentCollaborationEpisodeV3 } from "@ronggang/contracts";
import {
  adminGroundedCollaborationEpisodeV4Fixture,
  flagshipContentReferenceV4Fixture,
  mediaWorkRevisionV4Fixture,
  studentGroundedCollaborationEpisodeV4Fixture,
  teacherGroundedCollaborationEpisodeV4Fixture,
} from "../../../packages/contracts/test/v4-flagship.fixture";
import type { ExperienceGateway } from "../src/v2/gateway";
import {
  parseFlagshipExperienceResponseV4,
  parseFlagshipMediaWorkspaceResponseV4,
  groundedCitationStanceLabelV4,
  type FlagshipExperienceAudienceV4,
  type FlagshipExperienceViewV4,
  type FlagshipMediaWorkspaceV4,
  type GroundedCollaborationStudentEnvelopeV4,
} from "../src/v2/flagship-v4";
import type {
  FlagshipWorkspaceView,
  FlagshipWorldView,
} from "../src/v2/world-v3";
import {
  MediaWorkbenchV4,
  StudentFlagshipWorldV4Surface,
  StudentEvidenceWaitV4,
} from "../src/v2/pages/student-flagship-world-v4";

function withField<T extends { experience: FlagshipExperienceViewV4; media: FlagshipMediaWorkspaceV4 }>(snapshot: T) {
  const { experience } = snapshot;
  const openAccess = { allowed: true, reason: null, sceneRef: null, personRef: null };
  const objectIds: Record<string, string> = { "陈老师": "entity-researcher", "林师傅": "entity-gatekeeper", "来源比对板": "obj-claim-board" };
  const bindings = (experience.actionWindow?.selections ?? []).map(selection => ({ objectId: objectIds[selection.label.split("·")[0]!] ?? "obj-fixture-other", selectionToken: selection.selectionToken }));
  return { dialogue: null, ...snapshot, field: FieldExplorationViewV4Schema.parse({
    schemaVersion: "field-exploration-view/4.1.0", audience: "student", sessionId: experience.sessionId,
    bindingId: snapshot.media.bindingId, worldStateVersion: experience.worldStateVersion,
    actionWindowRef: experience.actionWindow?.actionWindowRef ?? "no-active-window",
    nodes: [{ ...experience.scene, access: openAccess, simulationNotice: undefined, people: experience.scene.people.map(person => ({ ...person, status: "available", supportsDialogue: true, presence: { visible: true, canContact: true, prerequisite: openAccess } })), objectRefs: ["obj-claim-board"] }].map(({ simulationNotice: _notice, ...node }) => node),
    selectionBindings: bindings, dialogues: [], actionConversations: [],
  }) };
}

function actionWindow() {
  return {
    actionWindowRef: "action-window-fixture",
    actionWindowHash: "a".repeat(64),
    worldStateVersion: 3,
    worldStateRef: "state-source-conflict-active",
    expiresAt: "2026-08-28T09:30:00.000Z",
    prompt: "请比较来源并说明下一步核验行动。",
    selections: [
      {
        selectionToken: "selection_token_abcdefghijklmnopqrstuvwxyz123456",
        displayKind: "npc",
        label: "陈老师·文化研究者",
        consequenceHint: "帮助区分来源层级，不替学生下结论。",
        selectionRole: "target",
      },
      {
        selectionToken: "selection_token_abcdefghijklmnopqrstuvwxyz654321",
        displayKind: "world_object",
        label: "来源比对板",
        consequenceHint: "并列登记原始出处与转引链。",
        selectionRole: "target",
      },
    ],
  };
}

function rawExperience(audience: FlagshipExperienceAudienceV4) {
  const collaboration = audience === "student"
    ? {
        episode: {
          ...studentGroundedCollaborationEpisodeV4Fixture(),
          evidenceState: {
            status: "ready",
            gaps: [],
            conflicts: [],
            expired: [],
            revoked: [],
            reason: null,
            authorizationExpiresAt: null,
          },
        },
        decisionToken: "groundeddecision_abcdefghijklmnopqrstuvwxyz1234567890",
      }
    : audience === "teacher"
      ? { episode: teacherGroundedCollaborationEpisodeV4Fixture() }
      : {
          episode: adminGroundedCollaborationEpisodeV4Fixture(),
          ablation: {
            policy: "affected_set",
            requestHash: "b".repeat(64),
            maximumSelectedAgents: 5,
            executionBudgetMicros: 0,
            status: "joint_proposal_ready",
            selectedCount: 5,
            moveCount: 5,
            knowledgeCitationCount: 2,
            evidenceCoverage: 1,
            unauthorizedWorldWriteCount: 0,
            totalLatencyMs: 0,
            totalEstimatedCostMicros: 0,
            failureReasonCode: null,
          },
        };
  return {
    experience: {
      schemaVersion: "flagship-experience-view/4.1.0",
      audience,
      sessionId: "session-v4-fixture",
      flagshipContentRef: flagshipContentReferenceV4Fixture(),
      worldStateVersion: 3,
      virtualMinute: 17,
      remainingMinutes: 38,
      challengeLevel: 5,
      scene: {
        sceneRef: "loc-waterfront-service-point",
        title: "滨水服务点",
        publicDescription: "公开数据与网络转引出现冲突，需要记者核验。",
        environmentImage: "/assets/flagship-world/v4/env-service-point-01.png",
        simulationNotice: "人物与冲突为专业教学仿真。",
        people: [{
          entityId: "entity-researcher",
          displayName: "陈老师",
          professionalRole: "文化研究者",
          publicGoal: "帮助区分可证事实与文化传说。",
          portrait: "/assets/flagship-world/v4/npc-researcher-chen-01.png",
        }],
      },
      worldPulse: {
        status: "npc_action_pending",
        speaker: "陈老师",
        message: "来源说法出现冲突，请先说明两个来源的层级。",
        expiresAtVirtualMinute: 22,
      },
      actionWindow: audience === "student" ? actionWindow() : null,
      collaboration,
      runtimeDisclosure: {
        semanticParser: "deterministic_fallback",
        collaboration: "deterministic_demo",
        authority: "world_engine_only",
        simulationContent: true,
      },
    },
  };
}

function rawMediaWorkspace() {
  return {
    workspace: {
      schemaVersion: "flagship-media-workspace/4.0.0",
      sessionId: "session-v4-fixture",
      bindingId: "binding-student-v4",
      processingMode: "actual_file_transform",
      catalog: [{
        assetRef: "asset-source-photo-alley-overview-01",
        title: "巷口环境原始照片",
        mediaKind: "image",
        publicPath: "/assets/flagship-world/v4/source-photo-alley-overview-01.png",
        contentHash: "c".repeat(64),
        rightsReceiptRef: "rights-course-generated-image",
        rightsStatus: "cleared",
        permittedUse: "simulated_publication",
        personConsentMode: "not_applicable",
        aiDisclosure: {
          explicitLabel: true,
          implicitMetadata: true,
          disclosureText: "AI 生成教学仿真素材，不作为真实新闻事实。",
        },
        sourceFactBoundary: "只能用于场景构图，不证明真实人物或事件。",
        transformable: true,
      }],
      revisions: [mediaWorkRevisionV4Fixture()],
    },
  };
}

function worldFixture(): FlagshipWorldView {
  return {
    schemaVersion: "simulation-world-view/3.0.0",
    audience: "student",
    sessionId: "session-v4-fixture",
    title: "泉州蟳埔簪花围融媒体采访持续世界",
    summary: "在持续变化的现场完成真实记者工作。",
    worldStateVersion: 3,
    virtualTime: {
      startedAt: "2026-08-28T09:00:00.000Z",
      currentAt: "2026-08-28T09:17:00.000Z",
      deadlineAt: "2026-08-28T09:55:00.000Z",
      elapsedMinutes: 17,
      remainingMinutes: 38,
      paused: false,
    },
    challenge: { level: 5, scoreCeiling: 90, scaffoldingLevel: 1 },
    entities: [],
    indicators: [],
    facts: [],
    relationships: [],
    resources: [],
    endingState: { status: "active", endingRef: null },
    availableActions: [{
      eventTemplateId: "event-template-draft-story",
      eventType: "student_drafts_story",
      serverIssuedActionRef: "server-action-event-template-draft-story-3",
      title: "向编辑部提交报道草稿",
      cue: "必须引用服务端真实作品版本。",
      affectedObjectRefs: [{ objectType: "entity", objectId: "entity-editor" }],
    }],
  };
}

function workspaceFixture(): FlagshipWorkspaceView {
  const artifact = {
    artifactId: "artifact-feature-story",
    title: "专题报道成稿",
    artifactKind: "professional_work",
    required: true,
    conflictDomainRefs: ["conflict-source"],
    editableFields: [{
      fieldId: "field-core-content",
      label: "核心内容",
      minimumLength: 12,
      maximumLength: 1_000,
    }],
    completionChecks: ["事实、采访、授权和商业边界均可核验"],
    evidenceRequirements: ["至少绑定一条现场证据"],
    status: "empty" as const,
    revisionCount: 0,
    latestRevision: null,
    mechanicalCompletion: {
      mechanicalReady: false,
      missingFields: ["核心内容"],
      evidenceReady: false,
      minimumEvidenceCount: 1,
      revisionReady: false,
    },
    updatedAt: "2026-08-28T09:17:00.000Z",
  };
  return {
    schemaVersion: "flagship-student-workspace/3.0.0",
    sessionId: "session-v4-fixture",
    challengeLevel: 5,
    manifest: {
      manifestId: "manifest-xunpu-r2",
      contentHash: "f".repeat(64),
      title: "泉州蟳埔真实岗位作品清单",
      expectedDurationMinutes: 55,
    },
    completion: {
      requiredArtifactCount: 1,
      submittedRequiredCount: 0,
      readyForPublication: false,
      blockingArtifactTitles: [artifact.title],
    },
    evidenceCatalog: [{
      evidenceRef: "evidence-source-comparison",
      kind: "world_evidence",
      label: "现场证据｜来源比对",
      detail: "由世界行动生成的可追溯证据。",
      eventType: "student_compares_sources",
    }],
    artifacts: [artifact],
    updatedAt: "2026-08-28T09:17:00.000Z",
  };
}

function businessSuggestionEpisode(): StudentAgentCollaborationEpisodeV3 {
  return {
    schemaVersion: "agent-collaboration-episode/3.0.0",
    episodeId: "episode-gatekeeper-v4-bridge",
    sessionId: "session-v4-fixture",
    scenarioId: "scenario-xunpu-living-world",
    courseReleaseRef: {
      courseId: "course-xunpu-flagship-v2",
      releaseId: "release-xunpu-flagship-v2-r2",
      version: "2.0.0",
      contentHash: "d".repeat(64),
    },
    simulationReleaseRef: {
      releaseId: "simulation-xunpu-r2",
      version: "2.0.0",
      contentHash: "e".repeat(64),
    },
    sourceWorldStateVersion: 0,
    generatedAt: "2026-08-28T09:00:00.000Z",
    audience: "student",
    status: "suggestion_ready",
    triggerEvent: {
      eventId: "event-gatekeeper-v4-bridge",
      eventType: "student_asks_gatekeeper",
      title: "门卫回应采访准入请求",
      occurredAt: "2026-08-28T09:00:00.000Z",
      sourceKind: "student_action",
    },
    suggestion: {
      suggestionId: "suggestion-gatekeeper-v4-bridge",
      sourceContributionId: "contribution-gatekeeper-v4-bridge",
      provenanceVerified: true,
      professionalRole: "community_gatekeeper",
      displayName: "林师傅·社区门卫",
      summary: "先说明记者身份、公共拍摄边界和退出机制，再申请条件准入。",
      rationale: "清楚说明目的与隐私承诺可以降低社区准入风险。",
      evidenceRefs: ["evidence-gatekeeper-dialogue"],
      riskLevel: "low",
      allowedDecisions: ["accept", "request_evidence", "reject"],
    },
    studentDecision: null,
    teacherGate: null,
    consequence: null,
    failure: null,
  };
}

describe("V4 flagship browser wire and role surface", () => {
  it("uses an explicit server capability for the new interview and still accepts the older running site", () => {
    const legacy = rawExperience("student");
    expect(parseFlagshipExperienceResponseV4(legacy, "student").fieldInterviewEnabled).toBeUndefined();
    const current = { experience: { ...legacy.experience, schemaVersion: "flagship-experience-view/4.2.0", fieldInterviewEnabled: true } };
    expect(parseFlagshipExperienceResponseV4(current, "student").fieldInterviewEnabled).toBe(true);
    expect(() => parseFlagshipExperienceResponseV4({ experience: { ...current.experience, fieldInterviewEnabled: "yes" } }, "student")).toThrow();
  });
  it("strictly parses the three role projections and rejects cross-role disclosure", () => {
    expect(parseFlagshipExperienceResponseV4(rawExperience("student"), "student").actionWindow)
      .not.toBeNull();
    expect(parseFlagshipExperienceResponseV4(rawExperience("teacher"), "teacher").actionWindow)
      .toBeNull();
    const admin = parseFlagshipExperienceResponseV4(rawExperience("admin"), "admin");
    expect(admin.collaboration && "ablation" in admin.collaboration
      ? admin.collaboration.ablation.unauthorizedWorldWriteCount
      : -1).toBe(0);

    const forged = structuredClone(rawExperience("student"));
    Object.assign(forged.experience, { traceRef: "trace-browser-forgery" });
    expect(() => parseFlagshipExperienceResponseV4(forged, "student"))
      .toThrow("字段不符合冻结接口");
    expect(() => parseFlagshipExperienceResponseV4(rawExperience("admin"), "teacher"))
      .toThrow("角色投影不一致");
  });

  it("parses actual-file media revisions and rejects fake processing modes", () => {
    const workspace = parseFlagshipMediaWorkspaceResponseV4(rawMediaWorkspace());
    expect(workspace.processingMode).toBe("actual_file_transform");
    expect(workspace.revisions[0]?.derivedAssets[0]?.byteLength).toBeGreaterThan(0);

    const forged = structuredClone(rawMediaWorkspace());
    forged.workspace.processingMode = "metadata_only";
    expect(() => parseFlagshipMediaWorkspaceResponseV4(forged))
      .toThrow("处理模式不受支持");
  });

  it("renders one free-action workflow without administrator trace or canned action choices", () => {
    const actionExperienceRaw = rawExperience("student");
    actionExperienceRaw.experience.collaboration = null;
    const experience = parseFlagshipExperienceResponseV4(
      actionExperienceRaw,
      "student",
    );
    const media = parseFlagshipMediaWorkspaceResponseV4(
      rawMediaWorkspace(),
    );
    const world = worldFixture();
    const workspace = workspaceFixture();
    const gateway = {
      getFlagshipExperienceV4: async () => experience,
      startFlagshipDialogueV4: async () => { throw new Error("not invoked"); },
      getFlagshipDialogueV4: async () => null,
      submitFlagshipDialogueTurnV4: async () => null,
      submitSemanticActionV4: async () => { throw new Error("not invoked"); },
      decideGroundedSuggestionV4: async () => { throw new Error("not invoked"); },
      getFlagshipMediaWorkspaceV4: async () => media,
      createFlagshipMediaRevisionV4: async () => media,
      flagshipMediaAssetUrlV4: () => "/derived-media-fixture.png",
      getFlagshipWorld: async () => world,
      getFlagshipEpisode: async () => businessSuggestionEpisode(),
      submitFlagshipAction: async () => businessSuggestionEpisode(),
      decideFlagshipEpisode: async () => businessSuggestionEpisode(),
      getFlagshipWorkspace: async () => workspace,
      saveFlagshipWorkRevision: async () => workspace,
      submitFlagshipWorkRevision: async () => workspace,
      refreshGroundedEvidenceV4: async () => ({
        episode: studentGroundedCollaborationEpisodeV4Fixture(),
        decisionToken: null,
      }),
    } as unknown as ExperienceGateway & Required<Pick<ExperienceGateway,
      | "getFlagshipExperienceV4"
      | "submitSemanticActionV4"
      | "decideGroundedSuggestionV4"
      | "getFlagshipMediaWorkspaceV4"
      | "createFlagshipMediaRevisionV4"
      | "flagshipMediaAssetUrlV4"
      | "getFlagshipWorld"
      | "getFlagshipEpisode"
      | "submitFlagshipAction"
      | "decideFlagshipEpisode"
      | "getFlagshipWorkspace"
      | "saveFlagshipWorkRevision"
      | "submitFlagshipWorkRevision"
    >>;
    const markup = renderToStaticMarkup(createElement(StudentFlagshipWorldV4Surface, {
      gateway,
      snapshot: withField({
        experience,
        dialogue: null,
        media: media as FlagshipMediaWorkspaceV4,
        businessEpisode: null,
        world,
        workspace,
      }),
      reporterBindingId: "binding-student-v4",
      navigate: () => undefined,
      onSnapshot: () => undefined,
    }));
    expect(markup).toContain('class="node-field"');
    expect(markup).toContain("打开手机");
    expect(markup).toContain("打开采访本");
    expect(markup).toContain("打开报道作品台");
    expect(markup).toContain("与陈老师交谈");
    expect(markup).not.toContain("你准备怎么做？");
    expect(markup).not.toContain("node-live-conversation");
    const expandedRaw = rawExperience("student");
    expandedRaw.experience.collaboration = null;
    expandedRaw.experience.actionWindow?.selections.push({
      selectionToken: "selection_token_abcdefghijklmnopqrstuvwxyz999999",
      displayKind: "npc",
      label: "林师傅·社区门卫",
      consequenceHint: "已由当前行动窗口签发，可开始人物对话。",
      selectionRole: "target",
    });
    const expandedExperience = parseFlagshipExperienceResponseV4(expandedRaw, "student");
    const expandedMarkup = renderToStaticMarkup(createElement(StudentFlagshipWorldV4Surface, {
      gateway,
      snapshot: withField({
        experience: expandedExperience,
        dialogue: null,
        media,
        businessEpisode: null,
        world,
        workspace,
      }),
      reporterBindingId: "binding-student-v4",
      navigate: () => undefined,
      onSnapshot: () => undefined,
    }));
    expect(expandedMarkup).toContain("采访区域");
    expect(expandedMarkup).toContain("打开手机");
    expect(markup).not.toContain("三步完成任务");
    expect(markup).not.toContain("flagship-v4-task-rail");
    expect(markup).not.toContain("Trace");
    expect(markup).not.toContain("Prompt");
    expect(markup).not.toContain("STATE #");
    expect(markup).not.toContain("让世界继续演进");

    const mediaMarkup = renderToStaticMarkup(createElement(MediaWorkbenchV4, {
      gateway,
      sessionId: "demo-xunpu-v2",
      bindingId: "binding-student-v4",
      workspace: media,
      onWorkspace: () => undefined,
      onClose: () => undefined,
    }));
    expect(mediaMarkup).toContain("素材版本已锁定送审");
    expect(mediaMarkup).toContain("选择送审图像");
    expect(mediaMarkup).not.toContain("选择送审音频");
    expect(mediaMarkup).not.toContain("选择送审视频");
    expect(mediaMarkup).toContain("本次不使用");
    expect(mediaMarkup.match(/<textarea[^>]*>(.*?)<\/textarea>/su)?.[1]).toBe("");
    const selectedAssetMarkup = renderToStaticMarkup(createElement(MediaWorkbenchV4, {
      gateway, sessionId: "demo-xunpu-v2", bindingId: "binding-student-v4",
      workspace: { ...media, catalog: [...media.catalog, { ...media.catalog[0]!, assetRef: "asset-requested-photo", title: "从手机选择的第二张素材" }] },
      initialAssetRef: "asset-requested-photo", onWorkspace: () => undefined, onClose: () => undefined,
    }));
    expect(selectedAssetMarkup).toMatch(/<img[^>]+alt="从手机选择的第二张素材"/u);

    const suggestionExperience = parseFlagshipExperienceResponseV4(
      rawExperience("student"),
      "student",
    );
    const suggestionMarkup = renderToStaticMarkup(createElement(StudentFlagshipWorldV4Surface, {
      gateway,
      snapshot: withField({
        experience: suggestionExperience,
        dialogue: null,
        media,
        businessEpisode: null,
        world,
        workspace,
      }),
      reporterBindingId: "binding-student-v4",
      navigate: () => undefined,
      onSnapshot: () => undefined,
    }));
    expect(suggestionMarkup).toContain("当前唯一专业建议");
    expect(suggestionMarkup).toContain("支持当前判断");
    expect(groundedCitationStanceLabelV4("refutes")).toBe("提示相反材料");
    expect(groundedCitationStanceLabelV4("context")).toBe("补充背景");
    expect(suggestionMarkup.match(/data-round-focus=/gu)).toHaveLength(1);
    expect(suggestionMarkup.match(/data-primary-action="true"/gu)).toHaveLength(1);
    expect(suggestionMarkup).toContain('data-round-focus="suggestion"');
    expect(suggestionMarkup.match(/<button[^>]*data-primary-action="true"[^>]*>/u)?.[0]).toContain("disabled");
    expect(suggestionMarkup).not.toContain("flagship-v4-action-panel");
    expect(suggestionMarkup).not.toContain("你准备怎么做？");

    const localCitationExperience = structuredClone(suggestionExperience);
    const localCitationCollaboration = localCitationExperience.collaboration as GroundedCollaborationStudentEnvelopeV4;
    localCitationCollaboration.episode.suggestion!.knowledgeCitations[0]!.sourceUrl = null;
    const localCitationMarkup = renderToStaticMarkup(createElement(StudentFlagshipWorldV4Surface, {
      gateway,
      snapshot: withField({
        experience: localCitationExperience,
        media,
        businessEpisode: null,
        world,
        workspace,
      }),
      reporterBindingId: "binding-student-v4",
      navigate: () => undefined,
      onSnapshot: () => undefined,
    }));
    expect(localCitationMarkup).toContain("（本地材料）");
    expect(localCitationMarkup).not.toContain('href="null"');

    const waitingEvidenceRaw = rawExperience("student");
    const waitingEvidenceCollaboration = waitingEvidenceRaw.experience.collaboration!;
    waitingEvidenceRaw.experience.collaboration = {
      ...waitingEvidenceCollaboration,
      episode: {
        ...waitingEvidenceCollaboration.episode,
        status: "waiting",
        suggestion: null,
        studentDecision: null,
        worldConsequenceRef: null,
        failure: null,
        evidenceState: {
          status: "needs_evidence",
          gaps: ["claim-source-version"],
          conflicts: ["claim-community-practice-boundary"],
          expired: ["claim-expired-statistic"],
          revoked: ["claim-withdrawn-portrait"],
          reason: "当前授权片段已过期或不可用，请补充新的 source revision。",
          authorizationExpiresAt: "2026-08-28T09:15:00.000Z",
        },
      },
    } as typeof waitingEvidenceRaw.experience.collaboration;
    const waitingEvidenceExperience = parseFlagshipExperienceResponseV4(
      waitingEvidenceRaw,
      "student",
    );
    const waitingEvidenceMarkup = renderToStaticMarkup(createElement(StudentFlagshipWorldV4Surface, {
      gateway,
      snapshot: withField({
        experience: waitingEvidenceExperience,
        media,
        businessEpisode: null,
        world,
        workspace,
      }),
      reporterBindingId: "binding-student-v4",
      navigate: () => undefined,
      onSnapshot: () => undefined,
    }));
    expect(waitingEvidenceMarkup).toContain("查看协作与现场反馈");
    expect(waitingEvidenceMarkup).not.toContain("claim-source-version");
    const waitingPanel = renderToStaticMarkup(createElement(StudentEvidenceWaitV4, {
      collaboration: waitingEvidenceExperience.collaboration as GroundedCollaborationStudentEnvelopeV4,
      evidenceState: (waitingEvidenceExperience.collaboration as GroundedCollaborationStudentEnvelopeV4).episode.evidenceState!,
      busy: null, canContinueFieldAction: true, canRefreshEvidence: true, onRefreshEvidence: () => undefined,
    }));
    expect(waitingPanel).toContain('data-round-focus="waiting_evidence"');
    expect(waitingPanel).toContain("协作等待补充证据");
    expect(waitingPanel).toContain("claim-source-version");
    expect(waitingPanel).toContain("claim-community-practice-boundary");
    expect(waitingPanel).toContain("claim-expired-statistic");
    expect(waitingPanel).toContain("claim-withdrawn-portrait");
    expect(waitingPanel).toContain("当前授权片段已过期或不可用");
    expect(waitingPanel).toContain("授权有效期：2026-08-28T09:15:00.000Z");
    expect(waitingPanel).toContain("补充资料后重新协作");
    expect(waitingPanel).toContain("现场岗位行动仍可继续");
    expect(waitingPanel).not.toContain("当前唯一专业建议");
    expect(waitingPanel.match(/data-round-focus=/gu)).toHaveLength(1);
    expect(waitingPanel.match(/data-primary-action="true"/gu)).toHaveLength(1);

    const bridgeExperienceRaw = rawExperience("student");
    bridgeExperienceRaw.experience.collaboration = null;
    const bridgeExperience = parseFlagshipExperienceResponseV4(
      bridgeExperienceRaw,
      "student",
    );
    const bridgeMarkup = renderToStaticMarkup(createElement(StudentFlagshipWorldV4Surface, {
      gateway,
      snapshot: withField({
        experience: bridgeExperience,
        dialogue: null,
        media,
        businessEpisode: businessSuggestionEpisode(),
        world,
        workspace,
      }),
      reporterBindingId: "binding-student-v4",
      navigate: () => undefined,
      onSnapshot: () => undefined,
    }));
    expect(bridgeMarkup).toContain("林师傅·社区门卫");
    expect(bridgeMarkup).toContain("当前唯一专业建议");
    expect(bridgeMarkup.match(/data-round-focus=/gu)).toHaveLength(1);
    expect(bridgeMarkup.match(/data-primary-action="true"/gu)).toHaveLength(1);
    expect(bridgeMarkup).toContain('data-round-focus="suggestion"');
    expect(bridgeMarkup.match(/<button[^>]*data-primary-action="true"[^>]*>/u)?.[0]).toContain("disabled");
    expect(bridgeMarkup).not.toContain("flagship-v4-action-panel");
    expect(bridgeMarkup).not.toContain("你准备怎么做？");
  });
});
