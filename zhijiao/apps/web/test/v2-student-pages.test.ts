import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { LearningActivity } from "@ronggang/contracts";
import { describe, expect, it, vi } from "vitest";
import { ExperienceGatewayProvider } from "../src/v2/gateway";
import { deriveStudentCourseDetail } from "../src/v2/loaders";
import {
  deriveStudentPortfolio,
  loadStudentReview,
} from "../src/v2/outcome-loaders";
import {
  courseDetailPrimaryAction,
  StudentCourseDetailSurface,
} from "../src/v2/pages/student-course-detail-page";
import { StudentPortfolioSurface } from "../src/v2/pages/student-portfolio-page";
import { StudentReviewSurface } from "../src/v2/pages/student-review-page";
import {
  ActiveTrainingSurface,
  activityStateCopy,
  resolveTrainingEntry,
} from "../src/v2/pages/student-training-page";
import {
  enrollmentFixture,
  gatewayFixture,
  learningActivityFixture,
  studentTrainingContextFixture,
  studentEpisodeFixture,
  courseReleaseSummaryFixture,
  courseReleaseFixture,
  courseProgressItemFixture,
  courseProgressListFixture,
  courseReviewWorkspaceFixture,
  fourCourseSummaryFixtures,
  studentPortfolioFixture,
  sessionExperienceDescriptorFixture,
} from "./v2-student.fixture";

describe("V2 student experience", () => {
  it("routes by authoritative enrollment before reading any session runtime", async () => {
    const getLearningActivity = vi.fn(async () => learningActivityFixture());
    const getStudentTrainingContext = vi.fn(async () => studentTrainingContextFixture());
    const getStudentEpisode = vi.fn(async () => studentEpisodeFixture());
    const getSessionExperienceDescriptor = vi.fn(async () => (
      sessionExperienceDescriptorFixture()
    ));
    const empty = gatewayFixture({
      getEnrollments: async () => [],
      getSessionExperienceDescriptor,
      getLearningActivity,
      getStudentTrainingContext,
      getStudentEpisode,
    });
    await expect(resolveTrainingEntry(
      empty,
      "demo-local-tourism",
      "",
    )).resolves.toEqual({ state: "not-enrolled" });
    expect(getSessionExperienceDescriptor).not.toHaveBeenCalled();
    expect(getLearningActivity).not.toHaveBeenCalled();
    expect(getStudentTrainingContext).not.toHaveBeenCalled();
    expect(getStudentEpisode).not.toHaveBeenCalled();

    await expect(resolveTrainingEntry(
      gatewayFixture({
        getEnrollments: async () => [],
        getSessionExperienceDescriptor: async () => sessionExperienceDescriptorFixture(
          "flagship_v4",
          { sessionId: "training-adaptive-v4-e8e2bdbce75d938ab68935cb" },
        ),
      }),
      "training-adaptive-v4-e8e2bdbce75d938ab68935cb",
      "binding-second-session",
    )).resolves.toMatchObject({
      state: "flagship_v4",
      enrollment: null,
    });

    const flagship = enrollmentFixture({ activeSessionId: "demo-xunpu-v2" });
    await expect(resolveTrainingEntry(
      gatewayFixture({
        getEnrollments: async () => [flagship],
        getSessionExperienceDescriptor: async () => sessionExperienceDescriptorFixture(
          "flagship_v4",
          { sessionId: "demo-xunpu-v2", courseReleaseRef: flagship.courseReleaseRef },
        ),
      }),
      "demo-xunpu-v2",
      flagship.bindingId,
    )).resolves.toMatchObject({ state: "flagship_v4" });

    const standard = enrollmentFixture({
      activeSessionId: "demo-village-super-v2",
      courseReleaseRef: {
        courseId: "course-village-super-multiplatform",
        releaseId: "release-course-village-super-multiplatform-runtime.2",
        version: 2,
        contentHash: "b".repeat(64),
      },
    });
    await expect(resolveTrainingEntry(
      gatewayFixture({
        getEnrollments: async () => [standard],
        getSessionExperienceDescriptor: async () => sessionExperienceDescriptorFixture(
          "standard_v2",
          {
            sessionId: "demo-village-super-v2",
            courseReleaseRef: standard.courseReleaseRef,
          },
        ),
      }),
      "demo-village-super-v2",
      standard.bindingId,
    )).resolves.toMatchObject({ state: "standard" });
  });

  it("renders one task, exactly three guide steps, one suggestion and one main action", () => {
    const snapshot = {
      enrollment: enrollmentFixture(),
      course: courseReleaseSummaryFixture(),
      activity: learningActivityFixture(),
      context: studentTrainingContextFixture(),
      episode: studentEpisodeFixture(),
    };
    const markup = renderToStaticMarkup(createElement(
      ExperienceGatewayProvider,
      { gateway: gatewayFixture() },
      createElement(ActiveTrainingSurface, {
        snapshot,
        reporterBindingId: "binding-student-xunpu",
        navigate: vi.fn(),
        onSnapshot: vi.fn(),
      }),
    ));
    expect(markup.match(/当前任务（唯一）/g)).toHaveLength(1);
    expect(markup).toContain("读清任务");
    expect(markup).toContain("核验证据");
    expect(markup).toContain("完成成果");
    expect(markup.match(/当前 AI 协作建议/g)).toHaveLength(1);
    expect(markup).toContain("事实核查智能体");
    expect(markup).toContain("采纳");
    expect(markup).toContain("补证");
    expect(markup).toContain("拒绝");
    expect(markup.match(/提交报道角度判断/g)).toHaveLength(1);
    expect(markup).not.toContain("STATE #");
    expect(markup).not.toContain("Prompt");
    expect(markup).not.toContain("Trace");
    expect(markup).not.toContain("provider");
  });

  it("renders one safe detail action and never exposes hidden course controls", () => {
    const detail = deriveStudentCourseDetail(courseReleaseFixture(), []);
    const markup = renderToStaticMarkup(createElement(
      StudentCourseDetailSurface,
      {
        detail,
        navigate: vi.fn(),
        onClaim: vi.fn(),
      },
    ));
    expect(markup).toContain("实训路径");
    expect(markup).toContain("公开来源");
    expect(markup).toContain("待专家复核");
    expect(markup.match(/v2-primary-cta/g)).toHaveLength(1);
    expect(markup).toContain("认领课程");
    expect(markup).not.toContain("hidden-");
    expect(markup).not.toContain(":agent-");
    expect(markup).not.toContain(":gate-");
    expect(markup).not.toContain("contentHash");
    expect(markup).not.toContain("Trace");
  });

  it("maps claimed, in-progress, awaiting-review and completed to mutually exclusive next steps", () => {
    const release = courseReleaseFixture();
    const statuses = [
      enrollmentFixture({
        status: "claimed",
        activeSessionId: null,
        startedAt: null,
      }),
      enrollmentFixture(),
      enrollmentFixture({
        status: "awaiting_review",
        submittedAt: "2026-08-09T02:06:00.000Z",
      }),
      enrollmentFixture({
        status: "completed",
        submittedAt: "2026-08-09T02:06:00.000Z",
        completedAt: "2026-08-09T02:08:00.000Z",
      }),
    ];
    expect(statuses.map((enrollment) => courseDetailPrimaryAction(
      deriveStudentCourseDetail(
        release,
        [enrollment],
        courseProgressItemFixture(enrollment),
      ),
    ).label)).toEqual([
      "返回我的课程",
      "继续当前实训",
      "查看复核状态",
      "查看评价复盘",
    ]);
  });

  it("renders only real portfolio and evidence fields without technical identifiers", () => {
    const enrollment = enrollmentFixture();
    const portfolio = deriveStudentPortfolio([{
      enrollment,
      course: courseReleaseSummaryFixture(),
      progress: {
        chapterCount: 7,
        completedChapterCount: 1,
        currentChapterId: "course-xunpu-intangible-media:chapter-2",
        submittedDeliverableCount: 1,
        portfolioItemCount: 1,
        evidenceCount: 1,
        reviewStatus: "not_submitted",
        readyForSubmission: false,
      },
    }], studentPortfolioFixture());
    const markup = renderToStaticMarkup(createElement(StudentPortfolioSurface, {
      portfolio,
      navigate: vi.fn(),
    }));
    expect(markup).toContain("簪花围专题选题与信源图");
    expect(markup).toContain("公开来源核验记录");
    expect(markup).not.toContain("contentHash");
    expect(markup).not.toContain("artifact-xunpu");
    expect(markup).not.toContain("session-xunpu");
    expect(markup).not.toContain("Trace");
    expect(markup).not.toContain("provider");
  });

  it("renders the completed review from authoritative score and no browser placeholder", async () => {
    const enrollment = enrollmentFixture({
      status: "completed",
      submittedAt: "2026-08-09T02:10:00.000Z",
      completedAt: "2026-08-09T02:15:00.000Z",
      stateVersion: 20,
      updatedAt: "2026-08-09T02:15:00.000Z",
    });
    const loaded = await loadStudentReview(gatewayFixture({
      getEnrollments: async () => [enrollment],
      getCourseProgress: async () => courseProgressListFixture([
        courseProgressItemFixture(enrollment),
      ]),
      getCourseReview: async () => courseReviewWorkspaceFixture("completed"),
    }), "session-xunpu-001", "binding-student-xunpu", undefined, async () => undefined);
    if (loaded.state !== "ready") throw new Error("fixture did not load");
    const markup = renderToStaticMarkup(createElement(StudentReviewSurface, {
      review: loaded.review,
      onSubmit: vi.fn(),
      navigate: vi.fn(),
    }));
    expect(markup).toContain("教师复核结果");
    expect(markup).toContain("88");
    expect(markup).toContain("公开来源与过程证据对应清楚");
    expect(markup).not.toContain("系统过程达成评估");
    expect(markup).not.toContain("不是内容专业评分");
    expect(markup).not.toContain("模拟评分");
    expect(markup).not.toContain("review-task-xunpu");
    expect(markup).not.toContain("STATE #");
    expect(markup).not.toContain("Trace");
  });

  it("labels a fallback completed review as system process attainment, not teacher scoring", async () => {
    const enrollment = enrollmentFixture({
      status: "completed",
      submittedAt: "2026-08-09T02:10:00.000Z",
      completedAt: "2026-08-09T02:15:00.000Z",
      stateVersion: 20,
      updatedAt: "2026-08-09T02:15:00.000Z",
    });
    const workspace = courseReviewWorkspaceFixture("completed");
    if (!workspace.review) throw new Error("fixture review is missing");
    const processWorkspace = {
      ...workspace,
      review: {
        ...workspace.review,
        reviewId: "course-process-review:enrollment-xunpu-001:20",
        publicSummary: "本结果为系统过程达成评估，非教师或专家内容评分。",
      },
    };
    const loaded = await loadStudentReview(gatewayFixture({
      getEnrollments: async () => [enrollment],
      getCourseProgress: async () => courseProgressListFixture([
        courseProgressItemFixture(enrollment),
      ]),
      getCourseReview: async () => processWorkspace,
    }), "session-xunpu-001", "binding-student-xunpu", undefined, async () => undefined);
    if (loaded.state !== "ready") throw new Error("fixture did not load");
    const markup = renderToStaticMarkup(createElement(StudentReviewSurface, {
      review: loaded.review,
      onSubmit: vi.fn(),
      navigate: vi.fn(),
    }));
    expect(markup).toContain("系统过程达成评估（专业复核待完成）");
    expect(markup).toContain("分值仅表示量规项和冻结过程证据覆盖，不是内容专业评分");
    expect(markup).toContain("本结果为系统过程达成评估，非教师或专家内容评分");
    expect(markup).not.toContain("教师复核结果");
    expect(markup).not.toContain("权威复核结果");
  });

  it("keeps every learning activity status mutually exclusive", () => {
    const active = learningActivityFixture();
    const states: LearningActivity[] = [
      {
        ...active,
        status: "empty",
        enrollment: null,
        courseReleaseRef: null,
        sessionId: null,
        currentTask: null,
        guideSteps: [],
        primaryAction: {
          actionId: "browse_courses",
          label: "浏览课程大厅",
          description: "先认领课程。",
        },
      } as unknown as LearningActivity,
      {
        ...active,
        status: "ready",
        enrollment: enrollmentFixture({
          status: "claimed",
          activeSessionId: null,
          startedAt: null,
        }),
        sessionId: null,
        currentTask: null,
        guideSteps: [],
        primaryAction: {
          actionId: "start_training",
          label: "开始实训",
          description: "等待教师开始本节。",
        },
      } as unknown as LearningActivity,
      active,
      {
        ...active,
        status: "awaiting_review",
        currentTask: null,
        guideSteps: [],
        primaryAction: {
          actionId: "view_submission",
          label: "查看提交",
          description: "等待教师复核。",
        },
      } as unknown as LearningActivity,
      {
        ...active,
        status: "completed",
        currentTask: null,
        guideSteps: [],
        primaryAction: {
          actionId: "review_learning",
          label: "查看评价复盘",
          description: "回看真实评价。",
        },
      } as unknown as LearningActivity,
    ];
    expect(states.map((state) => activityStateCopy(state).title)).toEqual([
      "当前没有学习任务",
      "课程已认领，等待开课",
      "核实现场变化并修订报道计划",
      "成果已提交，等待复核",
      "本节实训已完成",
    ]);
  });
});
