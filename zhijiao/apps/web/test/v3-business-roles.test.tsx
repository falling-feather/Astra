import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  adminCollaborationEpisodeV3Fixture,
  teacherCollaborationEpisodeV3Fixture,
} from "../../../packages/contracts/test/v3-simulation.fixture";
import { teacherGroundedCollaborationEpisodeV4Fixture } from "../../../packages/contracts/test/v4-flagship.fixture";
import { buildAdminTopologyViewV3 } from "../src/v2/admin-models";
import { createHttpAdminGateway } from "../src/v2/admin-gateway";
import { createHttpTeacherGateway, type TeacherGateway } from "../src/v2/teacher-gateway";
import { AdminTopologySurface } from "../src/v2/pages/admin-topology-page";
import { FlagshipTeacherDirectorSurface } from "../src/v2/pages/teacher-flagship-director-v3";
import {
  parseFlagshipAdminEpisodeResponse,
  parseFlagshipAgentTopologyResponse,
  parseFlagshipBusinessWorldResponse,
  parseFlagshipTeacherEpisodeResponse,
  parseFlagshipWorkReviewResponse,
  type FlagshipAgentTopologyV3,
  type FlagshipBusinessWorldView,
  type FlagshipWorkReviewView,
} from "../src/v2/world-v3-business";
import {
  teacherClassFixture,
  teacherEpisodeFixture,
  teacherOutcomeReceiptFixture,
  teacherReviewTasksFixture,
  teacherReviewWorkspaceFixture,
  teacherSessionOverviewFixture,
} from "./v2-teacher-admin.fixture";

const hash = "a".repeat(64);

function worldFixture(audience: "teacher" | "admin" = "teacher"): FlagshipBusinessWorldView {
  return {
    schemaVersion: "simulation-world-view/3.0.0",
    audience,
    sessionId: "session-xunpu-001",
    title: "泉州蟳埔簪花围融媒体采访持续世界",
    summary: "现场人物、时间、信任、事实与平台压力会持续变化。",
    worldStateVersion: 7,
    virtualTime: {
      startedAt: "2026-08-26T02:00:00.000Z",
      currentAt: "2026-08-26T02:17:00.000Z",
      deadlineAt: "2026-08-26T02:55:00.000Z",
      elapsedMinutes: 17,
      remainingMinutes: 38,
      paused: false,
    },
    challenge: { level: 5, scoreCeiling: 90, scaffoldingLevel: 1 },
    entities: [
      { entityId: "entity-gatekeeper-lin", title: "林师傅", professionalRole: "社区门卫" },
      { entityId: "entity-inheritor-huang", title: "黄老师", professionalRole: "簪花围传承人" },
      { entityId: "entity-shopkeeper-wu", title: "吴姐", professionalRole: "旅拍商户" },
    ].map((entity) => ({
      ...entity,
      kind: "person",
      status: "available" as const,
      publicSummary: `${entity.title}正在按自身目标观察记者。`,
      revision: 1,
    })),
    indicators: [{
      variableId: "community-trust",
      title: "社区信任",
      band: "medium",
      studentProjection: "社区保持观察",
      value: 61,
      delta: 4,
      minimum: 0,
      maximum: 100,
    }],
    facts: [{
      factId: "fact-access-boundary",
      status: "confirmed",
      confidenceBand: "high",
      confidence: 0.93,
      sourceRefs: ["evidence-professional-introduction-001"],
    }],
    relationships: [{
      relationshipId: "relationship-reporter-community",
      sourceEntityId: "entity-student-reporter",
      targetEntityId: "entity-gatekeeper-lin",
      trustBand: "medium",
      tensionBand: "low",
      trust: 61,
      tension: 18,
      influence: 40,
    }],
    resources: [{ resourceId: "resource-time", resourceKind: "time", amount: 38, unit: "minute" }],
    endingState: { status: "active", endingRef: null },
    availableActions: [],
    ...(audience === "admin" ? {
      queue: [{ eventId: "queued-event-1" }],
      resolutions: [{ resolutionId: "resolution-1" }],
      consequences: [{ eventId: "consequence-1" }],
    } : {}),
  };
}

function reviewFixture(): FlagshipWorkReviewView {
  return {
    schemaVersion: "flagship-work-review/3.0.0",
    sessionId: "session-xunpu-001",
    challengeLevel: 5,
    manifest: { manifestId: "manifest-xunpu-r2", contentHash: hash, title: "旗舰作品清单" },
    completion: { requiredArtifactCount: 9, submittedRequiredCount: 1, readyForPublication: false },
    artifacts: Array.from({ length: 9 }, (_, index) => ({
      artifactId: `artifact-${index + 1}`,
      title: index === 0 ? "选题简报" : `岗位作品 ${index + 1}`,
      artifactKind: "professional_work",
      required: true,
      status: index === 0 ? "submitted" as const : "empty" as const,
      revisionCount: index === 0 ? 2 : 0,
      submittedRevisionId: index === 0 ? "revision-topic-2" : null,
      submittedSupplement: null,
      latestRevision: index === 0 ? {
        revisionId: "revision-topic-2",
        artifactId: "artifact-1",
        revisionNumber: 2,
        parentRevisionId: "revision-topic-1",
        fields: [{ fieldId: "field-angle", content: "从文化主体与社区边界进入簪花围报道。" }],
        evidenceRefs: ["evidence-community-boundary"],
        revisionNote: "根据门卫反馈收窄拍摄边界",
        contentHash: "b".repeat(64),
        createdAt: "2026-08-26T02:16:00.000Z",
      } : null,
      mechanicalCompletion: {
        mechanicalReady: index === 0,
        missingFields: index === 0 ? [] : ["核心内容"],
        evidenceReady: index === 0,
        minimumEvidenceCount: 1,
        revisionReady: true,
      },
      updatedAt: index === 0 ? "2026-08-26T02:16:00.000Z" : null,
    })),
    updatedAt: "2026-08-26T02:16:00.000Z",
  };
}

function topologyFixture(): FlagshipAgentTopologyV3 {
  const groupData = [
    ["teaching_direction", "教学与情境导演", 2],
    ["field_npc", "现场人物与信源", 5],
    ["editorial_collaboration", "采编与编辑协作", 1],
    ["verification_governance", "核查与内容治理", 3],
    ["operations_distribution", "运营与平台分发", 1],
    ["assessment_growth", "评价与学习成长", 2],
  ] as const;
  const groups = groupData.map(([groupId, title], index) => ({
    groupId,
    title,
    responsibility: `${title}只在事件影响与权限边界内工作。`,
    order: index + 1,
  }));
  const agents = groupData.flatMap(([groupId, title, count], groupIndex) => (
    Array.from({ length: count }, (_, agentIndex) => {
      const first = groupIndex === 1 && agentIndex === 0;
      const second = groupIndex === 2 && agentIndex === 0;
      return {
        agentId: first ? "agent-gatekeeper-lin" : second ? "agent-responsible-editor" : `agent-${groupIndex}-${agentIndex}`,
        agentTemplateId: `template-${groupIndex}-${agentIndex}`,
        professionalRoleId: `role-${groupIndex}-${agentIndex}`,
        displayName: first ? "林师傅·社区门卫" : `${title} ${agentIndex + 1}`,
        responsibility: `${title}的受控岗位职责。`,
        groupId,
        contributionKind: first ? "world_actor" as const : "professional_advisor" as const,
        subscribedEventTypes: ["student-asks-source"],
        affectedObjectSelectors: [{ objectType: "entity", objectId: null }],
        toolCapabilityRefs: ["read-world-projection"],
        disclosurePolicyRef: "disclosure-admin-v3",
        actionBudget: 4,
        dispatchPriority: 70,
        enabled: true,
        available: true,
        authority: "proposal_only" as const,
        forbiddenActions: ["authoritative_world_write", "teacher_gate_bypass", "private_context_export"],
      };
    })
  ));
  return {
    schemaVersion: "simulation-agent-topology/3.0.0",
    sessionId: "session-xunpu-001",
    simulationReleaseRef: teacherCollaborationEpisodeV3Fixture().simulationReleaseRef,
    generatedAt: "2026-08-26T02:00:00.000Z",
    groups,
    agents,
  };
}

function teacherGatewayFixture(): TeacherGateway {
  return {
    getSessionOverview: async () => teacherSessionOverviewFixture(),
    getCourses: async () => [],
    getEpisode: async () => teacherEpisodeFixture(),
    getReviewTasks: async () => teacherReviewTasksFixture(),
    getCourseReview: async () => teacherReviewWorkspaceFixture(),
    finalizeReview: async () => teacherOutcomeReceiptFixture(),
    decideGate: async () => undefined,
    getFlagshipWorld: async () => worldFixture("teacher"),
    getFlagshipEpisode: async () => teacherCollaborationEpisodeV3Fixture(),
    getFlagshipWorkReview: async () => reviewFixture(),
    decideFlagshipTeacherGate: async () => teacherCollaborationEpisodeV3Fixture(),
  };
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("V3 flagship teacher and administrator experience", () => {
  it("keeps a no-event teacher session to one compact waiting state", () => {
    const episode = {
      ...teacherCollaborationEpisodeV3Fixture(),
      status: "waiting" as const,
      triggerEvent: null,
      dispatchPlan: null,
      contributions: [],
      studentDecision: null,
      teacherGate: null,
      resolutionProposalId: null,
      consequence: null,
      failureCode: null,
    };
    const markup = renderToStaticMarkup(createElement(FlagshipTeacherDirectorSurface, {
      value: {
        classroom: teacherClassFixture(),
        world: worldFixture("teacher"),
        episode,
        review: reviewFixture(),
      },
      gateway: teacherGatewayFixture(),
      bindingId: "binding-teacher-a",
      onEpisodeChanged: vi.fn(),
    }));
    expect(markup).toContain("当前没有需要教师处理的岗位决定");
    expect(markup).toContain("当前没有需要教师处理的风险与教学决定");
    expect(markup).not.toContain("世界脉搏");
    expect(markup).not.toContain("学生真实作品");
    expect(markup).not.toContain("风险教师门");
  });

  it("renders the teacher's business causal chain and real work without technical identifiers", () => {
    const markup = renderToStaticMarkup(createElement(FlagshipTeacherDirectorSurface, {
      value: {
        classroom: teacherClassFixture(),
        world: worldFixture("teacher"),
        episode: teacherCollaborationEpisodeV3Fixture(),
        review: reviewFixture(),
        groundedExperience: {
          collaboration: {
            episode: teacherGroundedCollaborationEpisodeV4Fixture(),
          },
        } as never,
      },
      gateway: teacherGatewayFixture(),
      bindingId: "binding-teacher-a",
      onEpisodeChanged: vi.fn(),
    }));
    for (const label of ["世界事件", "必要协作集合", "岗位协作", "学生选择", "教师门", "世界后果", "学生真实作品"]) {
      expect(markup).toContain(label);
    }
    expect(markup).toContain("只展示已经发生的真实阶段");
    expect(markup).toContain("展开本轮世界变化与人物状态");
    expect(markup).toContain("展开智能体质疑、补证与修订依据");
    expect(markup).toContain("支持当前判断");
    expect(markup).toContain("展开学生真实作品状态");
    expect(markup).toContain("v21-world-context-detail");
    expect(markup).toContain("v21-supporting-detail");
    expect(markup).toContain("1 项已产生 · 1 项送审");
    expect(markup).toContain("社区信任");
    for (const forbidden of ["agent-task-", "agent-run-", "observation-", "intent-", "trace-", "prompt-template-", "世界版本", "供应方", "微单位"]) {
      expect(markup).not.toContain(forbidden);
    }
  });

  it("renders exact six-group fourteen-agent execution truth only in administrator view", () => {
    const topology = buildAdminTopologyViewV3(
      topologyFixture(),
      adminCollaborationEpisodeV3Fixture(),
    );
    const markup = renderToStaticMarkup(createElement(AdminTopologySurface, {
      topology,
      world: worldFixture("admin"),
      review: reviewFixture(),
    }));
    expect(markup).toContain("6 组");
    expect(markup).toContain("14 个");
    expect(markup).toContain("DETERMINISTIC DEMO");
    expect(markup).toContain("已完成");
    expect(markup).toContain("trace-agent-run-gatekeeper-007");
    expect(markup).toContain("prompt-template-gatekeeper-v1");
    expect(markup).toContain("42 ms");
    expect(markup).toContain("0 微单位");
    expect(markup).toContain("1 条队列");
  });

  it("strictly parses teacher/admin world, episode, work and topology envelopes", () => {
    const teacherWorld = worldFixture("teacher");
    const adminWorld = worldFixture("admin");
    expect(parseFlagshipBusinessWorldResponse({ world: teacherWorld }, "teacher").indicators[0]?.value).toBe(61);
    expect(parseFlagshipBusinessWorldResponse({ world: adminWorld }, "admin").queue).toHaveLength(1);
    expect(parseFlagshipTeacherEpisodeResponse({ episode: teacherCollaborationEpisodeV3Fixture() }).audience).toBe("teacher");
    expect(parseFlagshipAdminEpisodeResponse({ episode: adminCollaborationEpisodeV3Fixture() }).execution.executionMode).toBe("deterministic_demo");
    expect(parseFlagshipWorkReviewResponse({ review: reviewFixture() }).artifacts).toHaveLength(9);
    expect(parseFlagshipAgentTopologyResponse({ topology: topologyFixture() }).agents).toHaveLength(14);
    expect(() => parseFlagshipBusinessWorldResponse({
      world: { ...teacherWorld, traceRefs: ["forged"] },
    }, "teacher")).toThrow("字段不符合冻结接口");
    expect(() => parseFlagshipAgentTopologyResponse({
      topology: { ...topologyFixture(), groups: topologyFixture().groups.slice(0, 5) },
    })).toThrow("六组十四个");
  });

  it("uses role-safe V3 endpoints and sends only the frozen teacher-gate body with CSRF", async () => {
    const teacherCalls: Array<{ url: string; init?: RequestInit }> = [];
    const auth = {
      profileId: "teacher-class-a",
      principal: {
        principalId: "principal-teacher-a",
        kind: "human" as const,
        displayName: "旗舰课教师",
        status: "active" as const,
        createdAt: "2026-08-26T02:00:00.000Z",
      },
      bindings: [],
      csrfToken: "csrf-flagship-teacher",
      expiresAt: "2026-08-27T02:00:00.000Z",
    };
    const teacherGateway = createHttpTeacherGateway(auth, {
      apiBase: "http://api.local",
      fetchImpl: async (input, init) => {
        const url = String(input);
        teacherCalls.push({ url, init });
        if (url.endsWith("/world?bindingId=binding-teacher-a")) return response({ world: worldFixture("teacher") });
        if (url.endsWith("/collaboration-episode?bindingId=binding-teacher-a")) return response({ episode: teacherCollaborationEpisodeV3Fixture() });
        if (url.endsWith("/work-review?bindingId=binding-teacher-a")) return response({ review: reviewFixture() });
        if (url.endsWith("/teacher-gate")) return response({ episode: teacherCollaborationEpisodeV3Fixture() });
        throw new Error(`unexpected ${url}`);
      },
    });
    await teacherGateway.getFlagshipWorld!("session-xunpu-001", "binding-teacher-a");
    await teacherGateway.getFlagshipEpisode!("session-xunpu-001", "binding-teacher-a");
    await teacherGateway.getFlagshipWorkReview!("session-xunpu-001", "binding-teacher-a");
    await teacherGateway.decideFlagshipTeacherGate!({
      sessionId: "session-xunpu-001",
      bindingId: "binding-teacher-a",
      episodeId: "collaboration-episode-v3-001",
      decision: "revised",
      teacherDecisionRef: "teacher-decision-safe-1",
      revisionPolicy: "reduce_effects",
      revisedConsequenceSummary: "只保留公共风险提示，不公开私人身份。",
    });
    expect(teacherCalls.map((call) => call.url)).toEqual([
      "http://api.local/api/v3/sessions/session-xunpu-001/world?bindingId=binding-teacher-a",
      "http://api.local/api/v3/sessions/session-xunpu-001/collaboration-episode?bindingId=binding-teacher-a",
      "http://api.local/api/v3/sessions/session-xunpu-001/work-review?bindingId=binding-teacher-a",
      "http://api.local/api/v3/sessions/session-xunpu-001/episodes/collaboration-episode-v3-001/teacher-gate",
    ]);
    const gateCall = teacherCalls.at(-1)!;
    expect(new Headers(gateCall.init?.headers).get("X-CSRF-Token")).toBe("csrf-flagship-teacher");
    expect(JSON.parse(String(gateCall.init?.body))).toEqual({
      bindingId: "binding-teacher-a",
      decision: "revised",
      teacherDecisionRef: "teacher-decision-safe-1",
      revisionPolicy: "reduce_effects",
      revisedConsequenceSummary: "只保留公共风险提示，不公开私人身份。",
    });

    const adminCalls: string[] = [];
    const adminGateway = createHttpAdminGateway({
      apiBase: "http://api.local",
      fetchImpl: async (input) => {
        const url = String(input);
        adminCalls.push(url);
        if (url.includes("/agent-topology?")) return response({ topology: topologyFixture() });
        if (url.includes("/collaboration-episode?")) return response({ episode: adminCollaborationEpisodeV3Fixture() });
        if (url.includes("/world?")) return response({ world: worldFixture("admin") });
        if (url.includes("/work-review?")) return response({ review: reviewFixture() });
        throw new Error(`unexpected ${url}`);
      },
    });
    await adminGateway.getFlagshipTopology!("session-xunpu-001", "binding-admin");
    await adminGateway.getFlagshipEpisode!("session-xunpu-001", "binding-admin");
    await adminGateway.getFlagshipWorld!("session-xunpu-001", "binding-admin");
    await adminGateway.getFlagshipWorkReview!("session-xunpu-001", "binding-admin");
    expect(adminCalls[0]).toContain("/api/v3/admin/sessions/session-xunpu-001/agent-topology");
    expect(adminCalls.join(" ")).not.toContain("actorId");
    expect(adminCalls.join(" ")).not.toContain("traceRef");
  });
});
