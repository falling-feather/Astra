import { describe, expect, it, vi } from "vitest";
import { GatewayHttpError } from "../src/v2/gateway";
import {
  deriveStudentPortfolio,
  loadStudentPortfolio,
  loadStudentReview,
  OutcomeConflictError,
  submitStudentCourseForReview,
} from "../src/v2/outcome-loaders";
import {
  joinEnrollmentsWithCourses,
} from "../src/v2/loaders";
import {
  courseOutcomeReceiptFixture,
  courseProgressItemFixture,
  courseProgressListFixture,
  courseReleaseSummaryFixture,
  courseReviewWorkspaceFixture,
  enrollmentFixture,
  gatewayFixture,
  studentPortfolioFixture,
} from "./v2-student.fixture";

function readyProgress() {
  const enrollment = enrollmentFixture();
  return courseProgressItemFixture(enrollment, {
    completedChapterIds: Array.from(
      { length: 7 },
      (_, index) => `course-xunpu-intangible-media:chapter-${index + 1}`,
    ),
    currentChapterId: null,
    submittedDeliverableCount: 7,
    portfolioItemCount: 7,
    evidenceCount: 12,
  });
}

describe("V2 student portfolio authority", () => {
  it("stops an unassigned learner before catalog, progress, portfolio or review reads", async () => {
    const authorizeSession = vi.fn();
    const getCourses = vi.fn();
    const getCourseProgress = vi.fn();
    const getPortfolio = vi.fn();
    const getCourseReview = vi.fn();
    await expect(loadStudentPortfolio(gatewayFixture({
      authorizeSession,
      getEnrollments: async () => [],
      getCourses,
      getCourseProgress,
      getPortfolio,
      getCourseReview,
    }))).resolves.toEqual({ state: "empty" });
    expect(getCourses).not.toHaveBeenCalled();
    expect(authorizeSession).not.toHaveBeenCalled();
    expect(getCourseProgress).not.toHaveBeenCalled();
    expect(getPortfolio).not.toHaveBeenCalled();
    expect(getCourseReview).not.toHaveBeenCalled();
  });

  it("keeps claimed-only courses honest without calling a session portfolio", async () => {
    const claimed = enrollmentFixture({
      status: "claimed",
      activeSessionId: null,
      startedAt: null,
      stateVersion: 0,
    });
    const authorizeSession = vi.fn();
    const getPortfolio = vi.fn();
    await expect(loadStudentPortfolio(gatewayFixture({
      getEnrollments: async () => [claimed],
      authorizeSession,
      getCourseProgress: async () => courseProgressListFixture([
        courseProgressItemFixture(claimed),
      ]),
      getPortfolio,
    }))).resolves.toMatchObject({
      state: "ready",
      items: [],
      evidence: [],
      courses: [expect.objectContaining({ status: "claimed" })],
    });
    expect(authorizeSession).not.toHaveBeenCalled();
    expect(getPortfolio).not.toHaveBeenCalled();
  });

  it("reads the principal-owned portfolio without minting a session binding", async () => {
    const order: string[] = [];
    const authorizeSession = vi.fn();
    await loadStudentPortfolio(gatewayFixture({
      getEnrollments: async () => {
        order.push("enrollments");
        return [enrollmentFixture()];
      },
      authorizeSession,
      getCourses: async () => {
        order.push("courses");
        return [courseReleaseSummaryFixture()];
      },
      getCourseProgress: async () => {
        order.push("progress");
        return courseProgressListFixture();
      },
      getPortfolio: async () => {
        order.push("portfolio");
        return studentPortfolioFixture();
      },
    }));
    expect(order[0]).toBe("enrollments");
    expect(new Set(order.slice(1))).toEqual(new Set([
      "courses",
      "progress",
      "portfolio",
    ]));
    expect(authorizeSession).not.toHaveBeenCalled();
  });

  it("maps only student-safe portfolio fields and keeps hashes out of the UI model", () => {
    const enrollment = enrollmentFixture();
    const courses = joinEnrollmentsWithCourses(
      [enrollment],
      [courseReleaseSummaryFixture()],
      courseProgressListFixture([courseProgressItemFixture(enrollment)]),
    );
    const portfolio = deriveStudentPortfolio(courses, studentPortfolioFixture());
    expect(portfolio).toMatchObject({
      state: "ready",
      items: [expect.objectContaining({
        title: "簪花围专题选题与信源图",
        evidenceCount: 1,
      })],
      evidence: [expect.objectContaining({
        title: "公开来源核验记录",
      })],
    });
    expect(JSON.stringify(portfolio)).not.toContain("contentHash");
    expect(JSON.stringify(portfolio)).not.toContain("artifactRevisionRefs");
  });

  it("fails closed when a portfolio item is bound to another session", () => {
    const enrollment = enrollmentFixture();
    const courses = joinEnrollmentsWithCourses(
      [enrollment],
      [courseReleaseSummaryFixture()],
      courseProgressListFixture([courseProgressItemFixture(enrollment)]),
    );
    const portfolio = studentPortfolioFixture();
    portfolio.items[0]!.sessionId = "session-forged";
    expect(() => deriveStudentPortfolio(courses, portfolio))
      .toThrow(/冻结课程会话/u);
  });
});

describe("V2 student review authority", () => {
  it("does not request progress, catalog or review without a matching enrollment", async () => {
    const getCourses = vi.fn();
    const getCourseProgress = vi.fn();
    const getCourseReview = vi.fn();
    await expect(loadStudentReview(
      gatewayFixture({
        getEnrollments: async () => [],
        getCourses,
        getCourseProgress,
        getCourseReview,
      }),
      "session-xunpu-001",
      "binding-student-xunpu",
    )).resolves.toEqual({ state: "unavailable" });
    expect(getCourses).not.toHaveBeenCalled();
    expect(getCourseProgress).not.toHaveBeenCalled();
    expect(getCourseReview).not.toHaveBeenCalled();
  });

  it.each([
    ["not_submitted", "in_progress"],
    ["awaiting_review", "awaiting_review"],
    ["completed", "completed"],
  ] as const)("maps only the authoritative %s branch", async (status, enrollmentStatus) => {
    const enrollment = enrollmentStatus === "in_progress"
      ? enrollmentFixture()
      : enrollmentStatus === "awaiting_review"
        ? enrollmentFixture({
          status: "awaiting_review",
          submittedAt: "2026-08-09T02:10:00.000Z",
          stateVersion: 19,
          updatedAt: "2026-08-09T02:10:00.000Z",
        })
        : enrollmentFixture({
          status: "completed",
          submittedAt: "2026-08-09T02:10:00.000Z",
          completedAt: "2026-08-09T02:15:00.000Z",
          stateVersion: 20,
          updatedAt: "2026-08-09T02:15:00.000Z",
        });
    const progress = status === "not_submitted"
      ? readyProgress()
      : courseProgressItemFixture(enrollment);
    const loaded = await loadStudentReview(
      gatewayFixture({
        getEnrollments: async () => [enrollment],
        getCourseProgress: async () => courseProgressListFixture([progress]),
        getCourseReview: async () => courseReviewWorkspaceFixture(status),
      }),
      "session-xunpu-001",
      "binding-student-xunpu",
      undefined,
      async () => undefined,
    );
    expect(loaded).toMatchObject({
      state: "ready",
      review: {
        status,
        canSubmit: status === "not_submitted",
      },
    });
  });

  it("posts with the current enrollment version and shows success only after authoritative reread", async () => {
    let submitted = false;
    const initialProgress = readyProgress();
    const awaiting = courseReviewWorkspaceFixture("awaiting_review");
    const submitCourseForReview = vi.fn(async () => {
      submitted = true;
      return courseOutcomeReceiptFixture("awaiting_review");
    });
    const gateway = gatewayFixture({
      getEnrollments: async () => [submitted ? awaiting.enrollment : enrollmentFixture()],
      getCourseProgress: async () => courseProgressListFixture([
        submitted
          ? courseProgressItemFixture(awaiting.enrollment)
          : initialProgress,
      ]),
      getCourseReview: async () => submitted
        ? awaiting
        : courseReviewWorkspaceFixture(),
      submitCourseForReview,
    });
    const initial = await loadStudentReview(
      gateway,
      "session-xunpu-001",
      "binding-student-xunpu",
      undefined,
      async () => undefined,
    );
    expect(initial.state).toBe("ready");
    if (initial.state !== "ready") throw new Error("fixture did not load");
    const confirmed = await submitStudentCourseForReview(
      gateway,
      initial.review,
      "request-course-outcome-001",
      undefined,
      async () => undefined,
    );
    expect(confirmed.status).toBe("awaiting_review");
    expect(submitCourseForReview).toHaveBeenCalledWith({
      sessionId: "session-xunpu-001",
      bindingId: "binding-student-xunpu",
      expectedEnrollmentStateVersion: 18,
      requestId: "request-course-outcome-001",
    }, undefined);
  });

  it("does not show a local success when a 200 receipt is not confirmed by reread", async () => {
    const gateway = gatewayFixture({
      getCourseProgress: async () => courseProgressListFixture([readyProgress()]),
      submitCourseForReview: async () => courseOutcomeReceiptFixture(),
    });
    const initial = await loadStudentReview(
      gateway,
      "session-xunpu-001",
      "binding-student-xunpu",
      undefined,
      async () => undefined,
    );
    if (initial.state !== "ready") throw new Error("fixture did not load");
    await expect(submitStudentCourseForReview(
      gateway,
      initial.review,
      "request-course-outcome-001",
      undefined,
      async () => undefined,
    )).rejects.toThrow(/尚未确认成果提交/u);
  });

  it("refreshes the authoritative review and fails closed on 409", async () => {
    const gateway = gatewayFixture({
      getCourseProgress: async () => courseProgressListFixture([readyProgress()]),
      submitCourseForReview: async () => {
        throw new GatewayHttpError(409, "state moved", "version_conflict");
      },
    });
    const initial = await loadStudentReview(
      gateway,
      "session-xunpu-001",
      "binding-student-xunpu",
      undefined,
      async () => undefined,
    );
    if (initial.state !== "ready") throw new Error("fixture did not load");
    const error = await submitStudentCourseForReview(
      gateway,
      initial.review,
      "request-course-outcome-001",
      undefined,
      async () => undefined,
    ).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(OutcomeConflictError);
    expect((error as OutcomeConflictError).latest).toMatchObject({ state: "ready" });
  });
});
