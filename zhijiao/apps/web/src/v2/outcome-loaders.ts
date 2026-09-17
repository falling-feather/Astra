import type {
  CourseEnrollment,
  CourseReviewWorkspace,
  StudentPortfolio,
} from "@ronggang/contracts";
import {
  GatewayHttpError,
  type ExperienceGateway,
} from "./gateway";
import {
  AuthorityConfirmationError,
  ExperienceDriftError,
  findEnrollmentProgress,
  joinEnrollmentsWithCourses,
  studentCourseProgressView,
} from "./loaders";
import type {
  CourseReleaseSummary,
  CourseSubmissionInput,
  EnrolledCourseView,
  StudentPortfolioLoad,
  StudentReviewLoad,
  StudentReviewView,
} from "./models";
import {
  courseReviewResultKind,
  sameCourseReleaseReference,
} from "./models";

function releaseReferenceOf(course: CourseReleaseSummary) {
  return {
    courseId: course.courseId,
    releaseId: course.releaseId,
    version: course.version,
    contentHash: course.contentHash,
  };
}

function courseForEnrollment(
  courses: readonly EnrolledCourseView[],
  enrollmentId: string,
): EnrolledCourseView {
  const matches = courses.filter(({ enrollment }) => (
    enrollment.enrollmentId === enrollmentId
  ));
  if (matches.length !== 1) {
    throw new ExperienceDriftError("成果与课程认领关系不唯一，已停止加载。");
  }
  return matches[0]!;
}

function assertOutcomeOwnership(
  enrollment: CourseEnrollment,
  outcome: {
    courseReleaseRef: CourseEnrollment["courseReleaseRef"];
    sessionId: string;
  },
): void {
  if (
    enrollment.activeSessionId === null
    || enrollment.activeSessionId !== outcome.sessionId
    || !sameCourseReleaseReference(
      enrollment.courseReleaseRef,
      outcome.courseReleaseRef,
    )
  ) {
    throw new ExperienceDriftError("成果不属于当前账号的冻结课程会话，已停止加载。");
  }
}

export function deriveStudentPortfolio(
  enrolledCourses: readonly EnrolledCourseView[],
  portfolio: StudentPortfolio,
): StudentPortfolioLoad {
  const items = portfolio.items.map((item) => {
    const enrolled = courseForEnrollment(enrolledCourses, item.enrollmentId);
    assertOutcomeOwnership(enrolled.enrollment, item);
    return {
      key: item.portfolioItemId,
      courseId: enrolled.course.courseId,
      courseTitle: enrolled.course.title,
      title: item.title,
      kind: item.kind,
      origin: item.origin,
      status: item.status,
      revisionNumber: item.revisionNumber,
      summary: item.summary,
      evidenceCount: item.evidenceIds.length,
      updatedAt: item.updatedAt,
    };
  });
  const evidence = portfolio.evidence.map((item) => {
    const enrolled = courseForEnrollment(enrolledCourses, item.enrollmentId);
    assertOutcomeOwnership(enrolled.enrollment, item);
    return {
      key: item.evidenceId,
      courseId: enrolled.course.courseId,
      courseTitle: enrolled.course.title,
      title: item.title,
      basis: item.basis,
      createdAt: item.createdAt,
    };
  });
  return {
    state: "ready",
    courses: portfolioCourseViews(enrolledCourses),
    items,
    evidence,
  };
}

function portfolioCourseViews(enrolledCourses: readonly EnrolledCourseView[]) {
  return enrolledCourses.map(({ enrollment, course, progress }) => ({
    courseId: course.courseId,
    title: course.title,
    status: enrollment.status,
    activeSessionId: enrollment.activeSessionId,
    readyForSubmission: progress.readyForSubmission,
  }));
}

/** Empty enrollments stop before catalog, progress, portfolio, or session reads. */
export async function loadStudentPortfolio(
  gateway: ExperienceGateway,
  signal?: AbortSignal,
): Promise<StudentPortfolioLoad> {
  const enrollments = await gateway.getEnrollments(signal);
  if (enrollments.length === 0) return { state: "empty" };
  const hasOutcome = enrollments.some((enrollment) => (
    enrollment.status !== "claimed"
  ));
  const [courses, progress, portfolio] = await Promise.all([
    gateway.getCourses(signal),
    gateway.getCourseProgress(signal),
    hasOutcome ? gateway.getPortfolio(signal) : Promise.resolve(null),
  ]);
  const enrolledCourses = joinEnrollmentsWithCourses(
    enrollments,
    courses,
    progress,
  );
  if (portfolio === null) {
    return {
      state: "ready",
      courses: portfolioCourseViews(enrolledCourses),
      items: [],
      evidence: [],
    };
  }
  return deriveStudentPortfolio(enrolledCourses, portfolio);
}

function submissionView(
  workspace: CourseReviewWorkspace,
): StudentReviewView["submission"] {
  if (workspace.submission === null) return null;
  return {
    submittedAt: workspace.submission.submittedAt,
    deliverableCount: workspace.submission.deliverableIds.length,
    portfolioItemCount: workspace.submission.portfolioItemIds.length,
    evidenceCount: workspace.submission.evidenceIds.length,
    rubricChapterCount: workspace.submission.rubric.length,
  };
}

function reviewView(
  workspace: CourseReviewWorkspace,
): StudentReviewView["result"] {
  if (workspace.review === null) return null;
  return {
    kind: courseReviewResultKind(workspace.review.reviewId),
    finalScore: workspace.review.finalScore,
    publicSummary: workspace.review.publicSummary,
    finalizedAt: workspace.review.finalizedAt,
    dimensions: workspace.review.dimensions.map((dimension) => ({
      key: dimension.dimensionId,
      label: dimension.label,
      score: dimension.score,
      maxScore: dimension.maxScore,
      feedback: dimension.feedback,
      evidenceCount: dimension.evidenceRefs.length,
    })),
  };
}

function deriveStudentReview(
  sessionId: string,
  bindingId: string,
  enrollment: CourseEnrollment,
  course: CourseReleaseSummary,
  progressList: Awaited<ReturnType<ExperienceGateway["getCourseProgress"]>>,
  workspace: CourseReviewWorkspace,
): StudentReviewView {
  if (workspace.viewer !== "student") {
    throw new ExperienceDriftError("课程复核响应角色不属于学生，已停止加载。");
  }
  if (
    workspace.enrollment.enrollmentId !== enrollment.enrollmentId
    || workspace.enrollment.bindingId !== bindingId
    || workspace.enrollment.activeSessionId !== sessionId
    || !sameCourseReleaseReference(
      workspace.enrollment.courseReleaseRef,
      enrollment.courseReleaseRef,
    )
    || !sameCourseReleaseReference(
      releaseReferenceOf(course),
      enrollment.courseReleaseRef,
    )
  ) {
    throw new ExperienceDriftError("课程复核与当前认领会话不一致，已停止加载。");
  }
  const progress = studentCourseProgressView(
    findEnrollmentProgress(workspace.enrollment, progressList),
  );
  if (progress.reviewStatus !== workspace.status) {
    throw new ExperienceDriftError("课程进度与复核状态不一致，已停止加载。");
  }
  return {
    sessionId,
    bindingId,
    course,
    enrollment: workspace.enrollment,
    progress,
    status: workspace.status,
    canSubmit: workspace.status === "not_submitted"
      && progress.readyForSubmission,
    submission: submissionView(workspace),
    result: reviewView(workspace),
  };
}

async function loadStudentReviewOnce(
  gateway: ExperienceGateway,
  sessionId: string,
  bindingId: string,
  signal?: AbortSignal,
): Promise<StudentReviewLoad> {
  const enrollments = await gateway.getEnrollments(signal);
  const matches = enrollments.filter((enrollment) => (
    enrollment.bindingId === bindingId
    && enrollment.activeSessionId === sessionId
  ));
  if (matches.length === 0) return { state: "unavailable" };
  if (matches.length !== 1) {
    throw new ExperienceDriftError("当前复盘会话存在多条认领记录，已停止加载。");
  }
  const enrollment = matches[0]!;
  const [courses, progress, workspace] = await Promise.all([
    gateway.getCourses(signal),
    gateway.getCourseProgress(signal),
    gateway.getCourseReview(sessionId, bindingId, signal),
  ]);
  const enrolledCourses = joinEnrollmentsWithCourses(
    enrollments,
    courses,
    progress,
  );
  const course = courseForEnrollment(
    enrolledCourses,
    enrollment.enrollmentId,
  ).course;
  return {
    state: "ready",
    review: deriveStudentReview(
      sessionId,
      bindingId,
      enrollment,
      course,
      progress,
      workspace,
    ),
  };
}

export async function loadStudentReview(
  gateway: ExperienceGateway,
  sessionId: string,
  bindingId: string,
  signal?: AbortSignal,
  wait: (milliseconds: number) => Promise<void> = (milliseconds) => (
    new Promise((resolve) => setTimeout(resolve, milliseconds))
  ),
): Promise<StudentReviewLoad> {
  let lastDrift: ExperienceDriftError | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) await wait(250 * attempt);
    try {
      return await loadStudentReviewOnce(
        gateway,
        sessionId,
        bindingId,
        signal,
      );
    } catch (cause) {
      if (!(cause instanceof ExperienceDriftError)) throw cause;
      lastDrift = cause;
    }
  }
  throw lastDrift ?? new ExperienceDriftError("课程复核读取失败，已停止加载。");
}

export class OutcomeConflictError extends AuthorityConfirmationError {
  constructor(
    message: string,
    readonly latest: StudentReviewLoad,
  ) {
    super(message);
    this.name = "OutcomeConflictError";
  }
}

export async function submitStudentCourseForReview(
  gateway: ExperienceGateway,
  review: StudentReviewView,
  requestId: string,
  signal?: AbortSignal,
  wait?: (milliseconds: number) => Promise<void>,
): Promise<StudentReviewView> {
  if (!review.canSubmit || review.status !== "not_submitted") {
    throw new AuthorityConfirmationError("当前成果尚未满足服务端提交条件。");
  }
  const input: CourseSubmissionInput = {
    sessionId: review.sessionId,
    bindingId: review.bindingId,
    expectedEnrollmentStateVersion: review.enrollment.stateVersion,
    requestId,
  };
  let receipt: Awaited<ReturnType<ExperienceGateway["submitCourseForReview"]>>;
  try {
    receipt = await gateway.submitCourseForReview(input, signal);
  } catch (cause) {
    if (cause instanceof GatewayHttpError && cause.status === 409) {
      const latest = await loadStudentReview(
        gateway,
        review.sessionId,
        review.bindingId,
        signal,
        wait,
      );
      throw new OutcomeConflictError(
        "课程状态已更新，本次提交未生效；页面已刷新。",
        latest,
      );
    }
    throw cause;
  }
  if (
    receipt.requestId !== requestId
    || receipt.sessionId !== review.sessionId
    || receipt.enrollmentId !== review.enrollment.enrollmentId
    || receipt.status !== "awaiting_review"
    || receipt.stateVersion <= review.enrollment.stateVersion
  ) {
    throw new AuthorityConfirmationError("成果提交回执与当前课程不一致。");
  }
  const latest = await loadStudentReview(
    gateway,
    review.sessionId,
    review.bindingId,
    signal,
    wait,
  );
  if (
    latest.state !== "ready"
    || latest.review.status !== "awaiting_review"
    || latest.review.enrollment.stateVersion < receipt.stateVersion
  ) {
    throw new AuthorityConfirmationError(
      "服务端尚未确认成果提交，页面未显示成功。",
    );
  }
  return latest.review;
}
