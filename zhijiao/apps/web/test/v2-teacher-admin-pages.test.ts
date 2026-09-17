import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { TeacherGateway } from "../src/v2/teacher-gateway";
import { loadTeacherReviewSelection } from "../src/v2/teacher-outcome-loaders";
import {
  teacherClassViews,
  teacherCourseView,
  trainingExperienceGeneration,
} from "../src/v2/teacher-models";
import { AdminTopologySurface } from "../src/v2/pages/admin-topology-page";
import {
  TeacherDirectorSurface,
  TeacherWaitingState,
  recentApprovedOutcome,
  resolveTeacherDirectorEntry,
  resolveTeacherDirectorLoad,
} from "../src/v2/pages/teacher-director-page";
import { TeacherReviewWorkspaceSurface } from "../src/v2/pages/teacher-reviews-page";
import {
  courseReleaseSummaryFixture,
  sessionExperienceDescriptorFixture,
} from "./v2-student.fixture";
import {
  adminTopologyFixture,
  teacherClassFixture,
  teacherEpisodeFixture,
  teacherOutcomeReceiptFixture,
  teacherReviewTasksFixture,
  teacherReviewWorkspaceFixture,
  teacherSessionOverviewFixture,
} from "./v2-teacher-admin.fixture";

function gatewayFixture(overrides: Partial<TeacherGateway> = {}): TeacherGateway {
  return {
    getSessionOverview: async () => teacherSessionOverviewFixture(),
    getSessionExperienceDescriptor: async () => sessionExperienceDescriptorFixture(),
    getCourses: async () => [],
    getEpisode: async () => teacherEpisodeFixture(),
    getReviewTasks: async () => teacherReviewTasksFixture(),
    getCourseReview: async () => teacherReviewWorkspaceFixture(),
    finalizeReview: async () => teacherOutcomeReceiptFixture(),
    decideGate: async () => undefined,
    ...overrides,
  };
}

describe("V2 teacher and administrator isolation", () => {
  it("gives each visible training session a human, distinguishable world title", () => {
    const overview = teacherSessionOverviewFixture();
    const base = overview.sessions[0]!;
    const sessions = [
      ["demo-xunpu-v2", "release-xunpu", "泉州蟳埔非遗采编旗舰世界"],
      ["demo-village-super-v2", "release-village-super", "贵州村超多平台视听报道"],
      ["demo-village-postpublication-v2", "release-village-postpublication", "村超短视频语境回应与多平台更正"],
      ["demo-ai-copyright-v2", "release-ai-copyright", "AI 文旅视觉版权与内容治理"],
      ["demo-rain-emergency-v2", "release-rain-emergency", "景区暴雨闭园与复开应急报道"],
    ].map(([sessionId, releaseId, experienceTitle], index) => ({
      ...base,
      sessionId,
      releaseId,
      experienceTitle,
      statusVersion: index + 1,
    }));
    const classes = teacherClassViews({ ...overview, sessions });
    expect(new Set(classes.map((item) => item.experienceTitle)).size).toBe(5);
    const changedTitle = "本次教师委托：社区公共服务调查";
    expect(teacherClassViews({ ...overview, sessions: [{ ...sessions[0]!, experienceTitle: changedTitle }] })[0]!.experienceTitle).toBe(changedTitle);
  });

  it("selects the director generation from a stable session descriptor instead of 404 probing", () => {
    expect(trainingExperienceGeneration(
      sessionExperienceDescriptorFixture("flagship_v3"),
    )).toBe("flagship_v3");
    expect(trainingExperienceGeneration(
      sessionExperienceDescriptorFixture("flagship_v4"),
    )).toBe("flagship_v4");
    expect(trainingExperienceGeneration(
      sessionExperienceDescriptorFixture("standard_v2"),
    )).toBe("standard");
  });

  it("resolves the director from the authorized session overview without probing a world endpoint", async () => {
    const overview = teacherSessionOverviewFixture();
    const flagshipSession = {
      ...overview.sessions[0]!,
      sessionId: "opaque-training-session",
      releaseId: "release-xunpu-v4-r2",
    };
    const getFlagshipWorld = vi.fn();
    const getSessionExperienceDescriptor = vi.fn(async () => (
      sessionExperienceDescriptorFixture("flagship_v4", {
        sessionId: flagshipSession.sessionId,
      })
    ));
    const entry = await resolveTeacherDirectorEntry(gatewayFixture({
      getSessionOverview: async () => ({
        ...overview,
        sessions: [flagshipSession],
      }),
      getSessionExperienceDescriptor,
      getFlagshipWorld,
    }), flagshipSession.sessionId, "binding-teacher-a");
    expect(entry).toMatchObject({
      state: "flagship_v4",
      classroom: { session: { sessionId: flagshipSession.sessionId } },
    });
    expect(getSessionExperienceDescriptor).toHaveBeenCalledOnce();
    expect(getFlagshipWorld).not.toHaveBeenCalled();
  });

  it("renders one compact teacher waiting state instead of empty stage cards", () => {
    const markup = renderToStaticMarkup(createElement(TeacherWaitingState, {
      onOpenClasses: vi.fn(),
    }));
    expect(markup).toContain("等待下一项课堂事件");
    expect(markup).toContain("查看课程与班级");
    expect(markup).not.toContain("未发生阶段");
    expect(markup).not.toContain("Trace");
  });

  it("renders only real business causal stages and no teacher technical details", () => {
    const markup = renderToStaticMarkup(createElement(TeacherDirectorSurface, {
      classroom: teacherClassFixture(),
      episode: teacherEpisodeFixture(),
      bindingId: "binding-teacher-a",
      onDecide: async () => undefined,
    }));
    for (const label of ["世界事件", "受影响集合", "智能体调度", "学生选择", "教师门"]) {
      expect(markup).toContain(label);
    }
    expect(markup).not.toContain("世界后果");
    expect(markup).toContain("当前尚未进入素材理解与生产阶段");
    expect(markup).toContain("批准");
    expect(markup).toContain("要求补证");
    expect(markup).toContain("退回");
    expect(markup).not.toContain("Prompt");
    expect(markup).not.toContain("私有记忆");
    expect(markup).not.toContain("供应方：");
    expect(markup).not.toContain("trace-");
    expect(markup).not.toContain("STATE #");
    expect(markup).not.toContain("session-xunpu-a");
    expect(markup).toContain("世界状态");
    expect(markup).not.toContain(">world ·");
  });

  it("renders a signed teacher review without learner ids, state or technical logs", async () => {
    const selection = await loadTeacherReviewSelection(gatewayFixture({
      getCourses: async () => [teacherCourseView(courseReleaseSummaryFixture())],
    }), "session-xunpu-001", "binding-teacher-a", null);
    if (!selection.workspace) throw new Error("fixture did not load");
    const markup = renderToStaticMarkup(createElement(TeacherReviewWorkspaceSurface, {
      workspace: selection.workspace,
      onFinalize: vi.fn(),
    }));
    expect(markup).toContain("学员 01");
    expect(markup).toContain("确认过程评估并归档");
    expect(markup).toContain("该结果不替代教师或专家内容评分");
    expect(markup).not.toContain("生成权威结果");
    expect(markup).not.toContain("principal-student");
    expect(markup).not.toContain("learner:");
    expect(markup).not.toContain("review-task-");
    expect(markup).not.toContain("session-xunpu");
    expect(markup).not.toContain("STATE #");
    expect(markup).not.toContain("Trace");
    expect(markup).not.toContain("provider");
  });

  it("keeps an authoritative human completed review labelled as teacher review", async () => {
    const selection = await loadTeacherReviewSelection(gatewayFixture({
      getCourses: async () => [teacherCourseView(courseReleaseSummaryFixture())],
      getReviewTasks: async () => teacherReviewTasksFixture("completed"),
      getCourseReview: async () => teacherReviewWorkspaceFixture("completed"),
    }), "session-xunpu-001", "binding-teacher-a", null);
    if (!selection.workspace) throw new Error("fixture did not load");
    const markup = renderToStaticMarkup(createElement(TeacherReviewWorkspaceSurface, {
      workspace: selection.workspace,
      onFinalize: vi.fn(),
    }));
    expect(markup).toContain("教师复核结果");
    expect(markup).toContain("公开来源与过程证据对应清楚");
    expect(markup).not.toContain("系统过程达成评估");
    expect(markup).not.toContain("权威复核结果");
  });

  it("labels a fallback completed teacher workspace as system process attainment", async () => {
    const workspace = teacherReviewWorkspaceFixture("completed");
    if (!workspace.review) throw new Error("fixture review is missing");
    const processWorkspace = {
      ...workspace,
      review: {
        ...workspace.review,
        reviewId: "course-process-review:enrollment-xunpu-001:20",
        publicSummary: "本结果为系统过程达成评估，非教师或专家内容评分。",
      },
    };
    const selection = await loadTeacherReviewSelection(gatewayFixture({
      getCourses: async () => [teacherCourseView(courseReleaseSummaryFixture())],
      getReviewTasks: async () => teacherReviewTasksFixture("completed"),
      getCourseReview: async () => processWorkspace,
    }), "session-xunpu-001", "binding-teacher-a", null);
    if (!selection.workspace) throw new Error("fixture did not load");
    const markup = renderToStaticMarkup(createElement(TeacherReviewWorkspaceSurface, {
      workspace: selection.workspace,
      onFinalize: vi.fn(),
    }));
    expect(markup).toContain("系统过程达成评估（专业复核待完成）");
    expect(markup).toContain("分值仅表示量规项和冻结过程证据覆盖，不是内容专业评分");
    expect(markup).toContain("本结果为系统过程达成评估，非教师或专家内容评分");
    expect(markup).not.toContain("教师复核结果");
    expect(markup).not.toContain("权威复核结果");
  });

  it("does not request an episode before the session overview proves visibility", async () => {
    const getEpisode = vi.fn();
    await expect(resolveTeacherDirectorLoad(
      gatewayFixture({
        getSessionOverview: async () => teacherSessionOverviewFixture(false),
        getEpisode,
      }),
      "session-xunpu-a",
      "binding-teacher-a",
    )).resolves.toEqual({ state: "unbound" });
    expect(getEpisode).not.toHaveBeenCalled();
  });

  it("keeps the just-approved teacher gate and authoritative consequence visible after chapter advance", () => {
    const before = teacherEpisodeFixture();
    const after = {
      ...before,
      status: "in_progress" as const,
      stateVersion: 24,
      triggerEvent: {
        ...before.triggerEvent!,
        eventId: "event-xunpu-next-chapter",
        title: "选题卡完成审核后，专题进入信源分级阶段",
      },
      studentDecision: null,
      teacherGate: null,
      authorityWriteback: null,
    };
    const recentOutcome = recentApprovedOutcome(before, after, {
      sessionId: before.sessionId,
      bindingId: "binding-teacher-a",
      gateId: before.teacherGate!.gateId,
      expectedTriggerEventId: before.triggerEvent!.eventId,
      expectedStateVersion: before.stateVersion,
      decision: "approve",
      reason: "信源边界和选题依据完整。",
    });
    expect(recentOutcome).toEqual({
      gateSummary: "已批准“游客量数据出现来源冲突”。",
      consequenceSummary: "权威状态已推进至“选题卡完成审核后，专题进入信源分级阶段”。",
    });

    const markup = renderToStaticMarkup(createElement(TeacherDirectorSurface, {
      classroom: teacherClassFixture(),
      episode: after,
      bindingId: "binding-teacher-a",
      recentOutcome,
      onDecide: async () => undefined,
    }));
    expect(markup).toContain("刚刚确认的教师门与世界后果");
    expect(markup).toContain("教师门");
    expect(markup).toContain("世界后果");
    expect(markup).toContain("已发生权威写回");
    expect(markup).toContain("专题进入信源分级阶段");
    expect(markup).not.toContain("STATE #");
    expect(markup).not.toContain("Trace");
  });

  it("presents a no-writeback evidence return without failure wording", () => {
    const episode = {
      ...teacherEpisodeFixture(),
      status: "failed" as const,
      stateVersion: 20,
      teacherGate: {
        gateId: "gate-xunpu-source-conflict",
        status: "rejected" as const,
        summary: "退回补证：补齐统计口径。",
        reviewedAt: "2026-08-09T02:06:00.000Z",
      },
      authorityWriteback: null,
      failureCode: "teacher_rejected" as const,
    };
    const markup = renderToStaticMarkup(createElement(TeacherDirectorSurface, {
      classroom: teacherClassFixture(),
      episode,
      bindingId: "binding-teacher-a",
      onDecide: async () => undefined,
    }));
    expect(markup).toContain("已退回补证；学生补证入口尚待接通");
    expect(markup).toContain("本轮没有权威世界写回");
    expect(markup).toContain("补证入口待接通");
    expect(markup).not.toContain("失败关闭");

    const rejectedMarkup = renderToStaticMarkup(createElement(TeacherDirectorSurface, {
      classroom: teacherClassFixture(),
      episode: {
        ...episode,
        teacherGate: {
          ...episode.teacherGate,
          summary: "教师退回：当前方案不符合发布要求。",
        },
      },
      bindingId: "binding-teacher-a",
      onDecide: async () => undefined,
    }));
    expect(rejectedMarkup).toContain("教师已退回本次方案");
    expect(rejectedMarkup).not.toContain("失败关闭");
  });

  it("renders six groups, fourteen nodes and admin-only execution details", () => {
    const markup = renderToStaticMarkup(createElement(AdminTopologySurface, {
      topology: adminTopologyFixture(),
    }));
    expect(markup).toContain("6 组");
    expect(markup).toContain("14 个");
    expect(markup.match(/<section class="group-/g)).toHaveLength(6);
    expect(markup.match(/class="(?:selected|skipped|idle|degraded|failed) (?:active)?"/g)).toHaveLength(14);
    expect(markup).toContain("供应方：iflytek-spark");
    expect(markup).toContain("安全 Trace 引用");
    expect(markup).toContain("trace-xunpu-dispatch-001");
    expect(markup).toContain("write_world_directly");
  });
});
