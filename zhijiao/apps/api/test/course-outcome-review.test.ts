import { describe, expect, it } from "vitest";
import {
  CourseReviewSubmissionSchema,
  StudentPortfolioEvidenceSchema,
  StudentPortfolioItemSchema,
  courseReleaseReferenceOf,
} from "@ronggang/contracts";
import { migrationRuntimeCourseReleases } from "@ronggang/world-core";
import { buildDeterministicProcessReview } from "../src/course-outcome-review.js";

const release = migrationRuntimeCourseReleases[0]!;
const submittedAt = "2026-08-10T12:00:00.000Z";
const portfolioItems = release.chapters.map((chapter) => (
  StudentPortfolioItemSchema.parse({
    portfolioItemId: `portfolio:${chapter.chapterId}`,
    enrollmentId: "enrollment:review-test",
    courseReleaseRef: courseReleaseReferenceOf(release),
    sessionId: "demo-village-super-v2",
    artifactId: `artifact:${chapter.chapterId}`,
    chapterId: chapter.chapterId,
    deliverableIds: chapter.deliverableIds,
    origin: "server_process_record",
    title: chapter.title,
    kind: "task_outcome",
    status: "submitted",
    revisionId: `revision:${chapter.chapterId}`,
    revisionNumber: 1,
    summary: `已冻结 ${chapter.title} 的过程记录`,
    contentHash: "a".repeat(64),
    evidenceIds: [`evidence:${chapter.chapterId}`],
    updatedAt: submittedAt,
  })
));
const evidence = release.chapters.map((chapter) => (
  StudentPortfolioEvidenceSchema.parse({
    evidenceId: `evidence:${chapter.chapterId}`,
    enrollmentId: "enrollment:review-test",
    courseReleaseRef: courseReleaseReferenceOf(release),
    sessionId: "demo-village-super-v2",
    title: `${chapter.title}过程证据`,
    basis: "服务端权威过程记录",
    artifactRevisionRefs: [`revision:${chapter.chapterId}`],
    createdAt: submittedAt,
  })
));
const submission = CourseReviewSubmissionSchema.parse({
  submissionId: "submission:review-test",
  reviewTaskId: "review-task:review-test",
  enrollmentId: "enrollment:review-test",
  courseReleaseRef: courseReleaseReferenceOf(release),
  sessionId: "demo-village-super-v2",
  submittedAt,
  deliverableIds: release.chapters.flatMap((chapter) => chapter.deliverableIds),
  portfolioItemIds: portfolioItems.map((item) => item.portfolioItemId),
  evidenceIds: evidence.map((item) => item.evidenceId),
  rubric: release.chapters.map((chapter) => ({
    chapterId: chapter.chapterId,
    title: chapter.title,
    criteria: chapter.rubricCriteria,
  })),
});

describe("deterministic V2 process review", () => {
  it("uses only the frozen submission, rubric, artifacts, and evidence", () => {
    const first = buildDeterministicProcessReview({
      release,
      submission,
      portfolioItems,
      evidence,
    });
    const reordered = buildDeterministicProcessReview({
      release,
      submission,
      portfolioItems: [...portfolioItems].reverse(),
      evidence: [...evidence].reverse(),
    });

    expect(first).toEqual(reordered);
    expect(first).toMatchObject({
      finalScore: 100,
      finalizedAt: submittedAt,
    });
    expect(first?.dimensions.reduce((total, item) => total + item.maxScore, 0))
      .toBe(100);
    expect(first?.dimensions).toHaveLength(
      release.chapters.reduce(
        (total, chapter) => total + chapter.rubricCriteria.length,
        0,
      ),
    );
    expect(first?.publicSummary).toContain("不是教师或专家");
    expect(JSON.stringify(first)).not.toContain("prompt");
    expect(JSON.stringify(first)).not.toContain("provider");
  });

  it("fails closed on rubric, deliverable, or evidence drift", () => {
    expect(buildDeterministicProcessReview({
      release,
      submission: {
        ...submission,
        rubric: submission.rubric.map((chapter, index) => index === 0
          ? { ...chapter, title: `${chapter.title}（伪造）` }
          : chapter),
      },
      portfolioItems,
      evidence,
    })).toBeNull();
    expect(buildDeterministicProcessReview({
      release,
      submission,
      portfolioItems: portfolioItems.slice(1),
      evidence,
    })).toBeNull();
    expect(buildDeterministicProcessReview({
      release,
      submission,
      portfolioItems,
      evidence: evidence.slice(1),
    })).toBeNull();
    expect(buildDeterministicProcessReview({
      release,
      submission,
      portfolioItems: portfolioItems.map((item, index) => index === 0
        ? { ...item, deliverableIds: release.chapters[1]!.deliverableIds }
        : item),
      evidence,
    })).toBeNull();
  });
});
