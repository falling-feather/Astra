import type {
  CourseOutcomeMutationReceipt,
  CourseProgressList,
  CourseReviewTaskList,
  CourseReviewWorkspace,
  StudentPortfolio,
} from "../src/index.js";
import {
  CourseOutcomeMutationReceiptSchemaVersion,
  CourseProgressListSchemaVersion,
  CourseReviewWorkspaceSchemaVersion,
  CourseReviewTaskListSchemaVersion,
  StudentPortfolioSchemaVersion,
} from "../src/index.js";
import { courseEnrollmentFixture } from "./v2-learning.fixture.js";

const releaseRef = courseEnrollmentFixture().courseReleaseRef;

export function courseProgressListFixture(
  status: "claimed" | "in_progress" | "awaiting_review" | "completed" = "in_progress",
): CourseProgressList {
  const enrollment = courseEnrollmentFixture(status);
  const frozen = status === "awaiting_review" || status === "completed";
  return {
    schemaVersion: CourseProgressListSchemaVersion,
    generatedAt: "2026-08-09T06:00:00.000Z",
    items: [{
      enrollment,
      chapterCount: 5,
      completedChapterIds: status === "claimed"
        ? []
        : frozen
          ? Array.from({ length: 5 }, (_, index) => `xunpu-chapter-${index + 1}`)
          : ["xunpu-chapter-1"],
      currentChapterId: status === "in_progress" ? "xunpu-chapter-2" : null,
      submittedDeliverableCount: frozen ? 1 : 0,
      portfolioItemCount: frozen ? 1 : 0,
      evidenceCount: frozen ? 1 : 0,
      reviewStatus: status === "awaiting_review"
        ? "awaiting_review"
        : status === "completed"
          ? "completed"
          : "not_submitted",
    }],
  };
}

export function studentPortfolioFixture(): StudentPortfolio {
  return {
    schemaVersion: StudentPortfolioSchemaVersion,
    generatedAt: "2026-08-09T06:00:00.000Z",
    items: [{
      portfolioItemId: "portfolio-xunpu-article",
      enrollmentId: "enrollment-xunpu-001",
      courseReleaseRef: releaseRef,
      sessionId: "session-xunpu-001",
      artifactId: "artifact-xunpu-article",
      revisionId: "revision-xunpu-article-2",
      chapterId: "xunpu-chapter-5",
      deliverableIds: ["deliverable-xunpu-final"],
      origin: "student_artifact",
      title: "蟳埔簪花围专题稿",
      kind: "article",
      status: "submitted",
      revisionNumber: 2,
      summary: "完成信源核验、采访边界说明与发布版修订。",
      contentHash: "c".repeat(64),
      evidenceIds: ["evidence-xunpu-article"],
      updatedAt: "2026-08-09T05:55:00.000Z",
    }],
    evidence: [{
      evidenceId: "evidence-xunpu-article",
      enrollmentId: "enrollment-xunpu-001",
      courseReleaseRef: releaseRef,
      sessionId: "session-xunpu-001",
      title: "专题稿提交依据",
      basis: "包含已核验公开来源、现场采访记录与修改说明。",
      artifactRevisionRefs: ["revision-xunpu-article-2"],
      createdAt: "2026-08-09T05:56:00.000Z",
    }],
  };
}

function submission() {
  return {
    submissionId: "submission-xunpu-final",
    reviewTaskId: "review-task-xunpu-final",
    enrollmentId: "enrollment-xunpu-001",
    courseReleaseRef: releaseRef,
    sessionId: "session-xunpu-001",
    submittedAt: "2026-08-09T05:57:00.000Z",
    deliverableIds: ["deliverable-xunpu-final"],
    portfolioItemIds: ["portfolio-xunpu-article"],
    evidenceIds: ["evidence-xunpu-article"],
    rubric: Array.from({ length: 5 }, (_, index) => ({
      chapterId: `xunpu-chapter-${index + 1}`,
      title: `第 ${index + 1} 节量规`,
      criteria: [{
        criterionId: `criterion-xunpu-${index + 1}`,
        title: "事实与证据",
        description: "事实判断必须能够由冻结证据复核。",
        weight: 100,
        evidenceTypes: ["source_reference"],
      }],
    })),
  };
}

export function courseReviewWorkspaceFixture(
  status: "not_submitted" | "awaiting_review" | "completed" = "awaiting_review",
  viewer: "student" | "teacher" = "student",
): CourseReviewWorkspace {
  const shared = {
    schemaVersion: CourseReviewWorkspaceSchemaVersion,
    viewer,
    generatedAt: "2026-08-09T06:00:00.000Z",
  } as const;
  if (status === "not_submitted") {
    return {
      ...shared,
      status,
      enrollment: courseEnrollmentFixture("in_progress"),
      submission: null,
      review: null,
    };
  }
  if (status === "awaiting_review") {
    return {
      ...shared,
      status,
      enrollment: courseEnrollmentFixture("awaiting_review"),
      submission: submission(),
      review: null,
    };
  }
  return {
    ...shared,
    status,
    enrollment: courseEnrollmentFixture("completed"),
    submission: submission(),
    review: {
      reviewId: "review-xunpu-final",
      finalScore: 88,
      dimensions: [{
        dimensionId: "dimension-evidence",
        label: "证据覆盖",
        score: 44,
        maxScore: 50,
        feedback: "主要事实均有公开来源或过程证据支撑。",
        evidenceRefs: ["evidence-xunpu-article"],
      }],
      publicSummary: "作品已完成事实、版权与平台适配复核。",
      finalizedAt: "2026-08-09T05:59:00.000Z",
    },
  };
}

export function courseOutcomeReceiptFixture(
  status: "awaiting_review" | "completed" = "awaiting_review",
): CourseOutcomeMutationReceipt {
  return {
    schemaVersion: CourseOutcomeMutationReceiptSchemaVersion,
    accepted: true,
    requestId: status === "awaiting_review"
      ? "request-submit-xunpu"
      : "request-review-xunpu",
    sessionId: "session-xunpu-001",
    enrollmentId: "enrollment-xunpu-001",
    status,
    stateVersion: status === "awaiting_review" ? 4 : 5,
  };
}

export function courseReviewTaskListFixture(): CourseReviewTaskList {
  return {
    schemaVersion: CourseReviewTaskListSchemaVersion,
    generatedAt: "2026-08-09T06:00:00.000Z",
    sessionId: "session-xunpu-001",
    items: [{
      reviewTaskId: "review-task-xunpu-final",
      enrollmentId: "enrollment-xunpu-001",
      learnerRef: "learner-24f3978ab7d1",
      courseReleaseRef: releaseRef,
      sessionId: "session-xunpu-001",
      status: "awaiting_review",
      stateVersion: 4,
      submittedAt: "2026-08-09T05:57:00.000Z",
      completedAt: null,
    }],
  };
}
