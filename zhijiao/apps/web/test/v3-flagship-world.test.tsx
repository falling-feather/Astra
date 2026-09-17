import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { StudentAgentCollaborationEpisodeV3 } from "@ronggang/contracts";
import { describe, expect, it, vi } from "vitest";
import { ExperienceGatewayProvider } from "../src/v2/gateway";
import { StudentFlagshipWorldSurface } from "../src/v2/pages/student-flagship-world-page";
import { FlagshipWorkbenchV3 } from "../src/v2/pages/flagship-workbench-v3";
import {
  parseFlagshipActionResponse,
  parseFlagshipAdvanceResponse,
  parseFlagshipEpisodeResponse,
  parseFlagshipWorkspaceResponse,
  parseFlagshipWorldResponse,
  type FlagshipWorkspaceView,
  type FlagshipWorldView,
} from "../src/v2/world-v3";
import { gatewayFixture } from "./v2-student.fixture";

const hash = "a".repeat(64);
const courseReleaseRef = {
  courseId: "course-xunpu-intangible-media",
  releaseId: "course-xunpu-intangible-media-r1",
  version: 1,
  contentHash: hash,
};
const simulationReleaseRef = {
  simulationId: "simulation-xunpu-living-world",
  releaseId: "simulation-xunpu-living-world-r1",
  version: 1,
  contentHash: "b".repeat(64),
};

function worldFixture(): FlagshipWorldView {
  return {
    schemaVersion: "simulation-world-view/3.0.0",
    audience: "student",
    sessionId: "demo-xunpu-v2",
    title: "泉州蟳埔簪花围融媒体采访持续世界",
    summary: "在持续变化的现场完成真实记者工作。",
    worldStateVersion: 0,
    virtualTime: {
      startedAt: "2026-08-26T03:30:00.000Z",
      currentAt: "2026-08-26T03:30:00.000Z",
      deadlineAt: "2026-08-26T04:25:00.000Z",
      elapsedMinutes: 0,
      remainingMinutes: 55,
      paused: false,
    },
    challenge: { level: 5, scoreCeiling: 90, scaffoldingLevel: 1 },
    entities: [
      ["entity-gatekeeper", "林师傅", "社区门卫"],
      ["entity-inheritor", "黄老师", "簪花围传承人"],
      ["entity-shopkeeper", "吴姐", "旅拍商户"],
    ].map(([entityId, title, professionalRole]) => ({
      entityId: entityId!,
      title: title!,
      kind: "person",
      professionalRole: professionalRole!,
      status: "available" as const,
      publicSummary: `${title}正在观察学生记者的现场行动。`,
      revision: 0,
    })),
    indicators: [{
      variableId: "community_trust",
      title: "社区信任",
      band: "medium",
      studentProjection: "社区保持观察",
    }],
    facts: [],
    relationships: [],
    resources: [],
    endingState: { status: "active", endingRef: null },
    availableActions: [{
      eventTemplateId: "event-template-gatekeeper",
      eventType: "student_asks_gatekeeper",
      serverIssuedActionRef: "server-action-event-template-gatekeeper-0",
      title: "门卫回应采访准入请求",
      cue: "先说明身份、范围与隐私边界。",
      affectedObjectRefs: [{ objectType: "entity", objectId: "entity-gatekeeper" }],
    }, {
      eventTemplateId: "event-template-inheritor",
      eventType: "student_asks_inheritor",
      serverIssuedActionRef: "server-action-event-template-inheritor-0",
      title: "传承人回应文化提问",
      cue: "避免把文化主体压缩成视觉符号。",
      affectedObjectRefs: [{ objectType: "entity", objectId: "entity-inheritor" }],
    }, {
      eventTemplateId: "event-template-source-check",
      eventType: "student_inspects_source",
      serverIssuedActionRef: "server-action-event-template-source-check-0",
      title: "两个年份主张发生冲突",
      cue: "追溯原始出处。",
      affectedObjectRefs: [{ objectType: "entity", objectId: "entity-inheritor" }],
    }],
  };
}

function waitingEpisode(): StudentAgentCollaborationEpisodeV3 {
  return {
    schemaVersion: "agent-collaboration-episode/3.0.0",
    episodeId: "waiting-demo-xunpu-v2",
    sessionId: "demo-xunpu-v2",
    scenarioId: "scenario-xunpu-living-world",
    courseReleaseRef,
    simulationReleaseRef,
    sourceWorldStateVersion: 0,
    generatedAt: "2026-08-26T03:30:00.000Z",
    audience: "student",
    status: "waiting",
    triggerEvent: null,
    suggestion: null,
    studentDecision: null,
    teacherGate: null,
    consequence: null,
    failure: null,
  };
}

function workspaceFixture(): FlagshipWorkspaceView {
  const artifacts = [
    ["artifact-topic-brief", "选题简报"],
    ["artifact-interview-plan-log", "采访计划与记录"],
    ["artifact-source-matrix", "信源矩阵"],
    ["artifact-fact-check-sheet", "事实核查表"],
    ["artifact-rights-ledger", "素材权利台账"],
    ["artifact-multiplatform-script", "多平台脚本"],
    ["artifact-feature-story", "专题报道成稿"],
    ["artifact-publication-correction-decision", "发布与更正决定"],
    ["artifact-transfer-reflection", "岗位迁移反思"],
  ].map(([artifactId, title]) => ({
    artifactId: artifactId!,
    title: title!,
    artifactKind: "professional_work",
    required: true,
    conflictDomainRefs: ["conflict-source"],
    editableFields: [{
      fieldId: "field-core-content",
      label: "核心内容",
      minimumLength: 12,
      maximumLength: 1_000,
    }],
    completionChecks: ["内容必须来自学生的真实岗位判断"],
    evidenceRequirements: ["至少绑定一条公开来源或现场证据"],
    status: "empty" as const,
    revisionCount: 0,
    latestRevision: null,
    submittedSupplement: null,
    mechanicalCompletion: {
      mechanicalReady: false,
      missingFields: ["核心内容"],
      evidenceReady: false,
      minimumEvidenceCount: 1,
      revisionReady: artifactId !== "artifact-feature-story",
    },
    updatedAt: "2026-08-26T03:30:00.000Z",
  }));
  return {
    schemaVersion: "flagship-student-workspace/3.0.0",
    sessionId: "demo-xunpu-v2",
    challengeLevel: 5,
    manifest: {
      manifestId: "manifest-xunpu-r2",
      contentHash: "c".repeat(64),
      title: "泉州蟳埔真实岗位作品清单",
      expectedDurationMinutes: 55,
    },
    completion: {
      requiredArtifactCount: 9,
      submittedRequiredCount: 0,
      readyForPublication: false,
      blockingArtifactTitles: artifacts.map((artifact) => artifact.title),
    },
    evidenceCatalog: [{
      evidenceRef: "knowledge-source-one",
      kind: "knowledge",
      label: "公开来源｜国家级非遗名录",
      detail: "发布机关、发布日期与文件定位",
      eventType: null,
    }],
    artifacts,
    updatedAt: "2026-08-26T03:30:00.000Z",
  };
}

function suggestionEpisode(
  status: "suggestion_ready" | "completed" = "suggestion_ready",
): StudentAgentCollaborationEpisodeV3 {
  const decided = status === "completed";
  return {
    ...waitingEpisode(),
    episodeId: "episode-gatekeeper-1",
    status,
    triggerEvent: {
      eventId: "world-event-gatekeeper-1",
      eventType: "student_asks_gatekeeper",
      title: "门卫回应采访准入请求",
      occurredAt: "2026-08-26T03:31:00.000Z",
      sourceKind: "student_action",
    },
    suggestion: {
      suggestionId: "suggestion-gatekeeper-1",
      sourceContributionId: "contribution-gatekeeper-1",
      provenanceVerified: true,
      professionalRole: "community_gatekeeper",
      displayName: "林师傅·社区门卫",
      summary: "林师傅认可学生说明身份与边界，给予条件准入。",
      rationale: "职业身份、目的和隐私承诺降低了社区风险。",
      evidenceRefs: ["evidence-access-dialogue"],
      riskLevel: "low",
      allowedDecisions: ["accept", "request_evidence", "reject"],
    },
    studentDecision: decided ? {
      decisionRef: "student-decision-accept-1",
      decision: "accept",
      rationale: "接受条件准入。",
      decidedAt: "2026-08-26T03:32:00.000Z",
    } : null,
    consequence: decided ? {
      resolutionId: "resolution-gatekeeper-1",
      status: "committed",
      publicSummary: "条件准入已经生效，社区信任发生变化。",
      worldEventIds: ["consequence-gatekeeper-1"],
      evidenceIds: ["evidence-access-dialogue"],
      resultingStateVersion: 1,
    } : null,
  };
}

function surface(
  episode: StudentAgentCollaborationEpisodeV3,
  world: FlagshipWorldView = worldFixture(),
): string {
  const workspace = workspaceFixture();
  const gateway = gatewayFixture({
    getFlagshipWorld: async () => world,
    getFlagshipEpisode: async () => episode,
    getFlagshipWorkspace: async () => workspace,
    saveFlagshipWorkRevision: async () => workspace,
    submitFlagshipWorkRevision: async () => workspace,
    submitFlagshipAction: async () => suggestionEpisode(),
    decideFlagshipEpisode: async () => suggestionEpisode("completed"),
    advanceFlagshipWorld: async () => ({
      advance: { scheduled: true, reason: "现场继续变化。", eventId: "event-next" },
      episode: suggestionEpisode(),
    }),
  });
  return renderToStaticMarkup(createElement(
    ExperienceGatewayProvider,
    { gateway },
    createElement(StudentFlagshipWorldSurface, {
      snapshot: { world, episode, workspace },
      reporterBindingId: "binding-student-xunpu",
      navigate: vi.fn(),
      onSnapshot: vi.fn(),
    }),
  ));
}

describe("V3 flagship student world", () => {
  it("renders one scene, three explorable NPCs and one primary action without logs", () => {
    const markup = surface(waitingEpisode());
    expect(markup).toContain("巷口的人不会按脚本等待你");
    expect(markup).toContain("林师傅");
    expect(markup).toContain("黄老师");
    expect(markup).toContain("吴姐");
    expect(markup.match(/执行行动/g)).toHaveLength(1);
    expect(markup.match(/class="primary"/g)).toHaveLength(1);
    expect(markup).toContain('aria-label="打开编辑部，已锁定 0 / 9 项必交成果"');
    for (const forbidden of ["Trace", "Prompt", "providerId", "agentRunId", "stateVersion"]) {
      expect(markup).not.toContain(forbidden);
    }
  });

  it("shows the single relevant suggestion only when the world responds", () => {
    const markup = surface(suggestionEpisode());
    expect(markup).toContain("你的行动引发了现场回应");
    expect(markup).toContain("林师傅认可学生说明身份与边界");
    expect(markup).toContain("采纳并执行");
    expect(markup).toContain("要求补充依据");
    expect(markup).toContain("拒绝，自己处理");
    expect(markup).not.toContain(">执行行动<");
  });

  it("turns a committed consequence into one continue-world action", () => {
    const markup = surface(suggestionEpisode("completed"));
    expect(markup).toContain("现场已回应");
    expect(markup).toContain("条件准入已经生效");
    expect(markup.match(/让世界继续演进/g)).toHaveLength(1);
    expect(markup).not.toContain("采纳并执行");
  });

  it("requires the student's own rationale before every legacy suggestion decision", () => {
    const markup = surface(suggestionEpisode());
    expect(markup).toContain("写下你的判断（必填）");
    expect(markup).not.toContain("写下你的判断（可选）");
    for (const label of ["采纳并执行", "要求补充依据", "拒绝，自己处理"]) {
      const button = markup.match(new RegExp(`<button[^>]*>[^]*?${label}</button>`, "u"))?.[0];
      expect(button?.split("<button").at(-1)).toContain('disabled=""');
    }
  });

  it.each([
    ["ending-trusted-collaboration", "completed", "可信合作", "事实、文化主体、素材权利与未知项"],
    ["ending-prudent-delay", "recoverable_failure", "审慎延误", "主动错过第一发布窗口"],
    ["ending-traffic-backlash", "recoverable_failure", "流量反噬", "短期触达"],
    ["ending-governance-failure", "recoverable_failure", "治理失败", "作品被阻断"],
  ] as const)(
    "renders outcome-specific reflection for %s",
    (endingRef, status, title, consequence) => {
      const world = worldFixture();
      world.endingState = { status, endingRef };
      const markup = surface(waitingEpisode(), world);
      expect(markup).toContain(title);
      expect(markup).toContain(consequence);
      expect(markup).toContain("进入评价复盘");
      if (endingRef !== "ending-trusted-collaboration") {
        expect(markup).not.toContain("可信报道已形成");
      }
    },
  );

  it("strictly parses each distinct V3 response envelope", () => {
    const world = worldFixture();
    const episode = suggestionEpisode();
    const workspace = workspaceFixture();
    expect(parseFlagshipWorldResponse({ world }).audience).toBe("student");
    expect(parseFlagshipEpisodeResponse({ episode }).status).toBe("suggestion_ready");
    expect(parseFlagshipActionResponse({
      receipt: {
        eventId: "world-event-1",
        replayed: false,
        worldStateVersion: 0,
      },
      episode,
    }).episodeId).toBe(episode.episodeId);
    expect(parseFlagshipAdvanceResponse({
      advance: { scheduled: true, reason: "NPC 主动进入现场。", eventId: "world-event-2" },
      episode,
    }).advance.scheduled).toBe(true);
    expect(parseFlagshipWorkspaceResponse({ workspace }).artifacts).toHaveLength(9);
    expect(() => parseFlagshipWorldResponse({
      world: { ...world, queue: [{ traceRef: "forged" }] },
    })).toThrow("字段不符合冻结接口");
  });

  it("renders a real nine-artifact newsroom instead of completion cards", () => {
    const markup = renderToStaticMarkup(createElement(FlagshipWorkbenchV3, {
      workspace: workspaceFixture(),
      busy: null,
      message: null,
      onClose: vi.fn(),
      onSave: vi.fn(),
      onSubmit: vi.fn(),
      onReviewDraft: vi.fn(),
      onPublish: vi.fn(),
    }));
    expect(markup).toContain("学生编辑部真实工作台");
    expect(markup).toContain('aria-label="返回采访现场"');
    expect(markup).toContain('aria-label="进入发布门"');
    expect(markup).toContain("专题报道成稿");
    expect(markup).toContain("素材权利台账");
    expect(markup).toContain("写下你的具体观察与判断");
    expect(markup).toContain("<textarea");
    expect(markup).not.toContain("Trace");
    expect(markup).not.toContain("Prompt");
  });
});
