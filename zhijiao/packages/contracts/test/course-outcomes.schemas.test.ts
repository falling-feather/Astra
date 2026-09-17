import { describe, expect, it } from "vitest";
import {
  CourseOutcomeMutationReceiptSchema,
  CourseProgressListSchema,
  CourseReviewFinalizeRequestSchema,
  CourseReviewTaskListSchema,
  CourseReviewWorkspaceSchema,
  CourseSubmissionRequestSchema,
  StudentPortfolioSchema,
} from "../src/index.js";
import {
  courseOutcomeReceiptFixture,
  courseProgressListFixture,
  courseReviewWorkspaceFixture,
  courseReviewTaskListFixture,
  studentPortfolioFixture,
} from "./course-outcomes.fixture.js";

describe("V2 course outcome contracts", () => {
  it("accepts the four enrollment progress states as mutually exclusive views", () => {
    for (const status of [
      "claimed",
      "in_progress",
      "awaiting_review",
      "completed",
    ] as const) {
      expect(CourseProgressListSchema.parse(courseProgressListFixture(status)))
        .toEqual(courseProgressListFixture(status));
    }
  });

  it("accepts a server-derived portfolio and all three review states", () => {
    expect(StudentPortfolioSchema.parse(studentPortfolioFixture()))
      .toEqual(studentPortfolioFixture());
    for (const status of [
      "not_submitted",
      "awaiting_review",
      "completed",
    ] as const) {
      expect(CourseReviewWorkspaceSchema.parse(
        courseReviewWorkspaceFixture(status),
      )).toEqual(courseReviewWorkspaceFixture(status));
    }
  });

  it("accepts only minimal lifecycle requests and receipts", () => {
    const request = {
      bindingId: "binding-student-xunpu",
      expectedEnrollmentStateVersion: 3,
      requestId: "request-submit-xunpu",
    };
    expect(CourseSubmissionRequestSchema.parse(request)).toEqual(request);
    const reviewRequest = {
      ...request,
      bindingId: "binding-teacher-xunpu",
      reviewTaskId: "review-task-xunpu-final",
      requestId: "request-review-xunpu",
    };
    expect(CourseReviewFinalizeRequestSchema.parse(reviewRequest))
      .toEqual(reviewRequest);
    expect(CourseOutcomeMutationReceiptSchema.parse(courseOutcomeReceiptFixture()))
      .toEqual(courseOutcomeReceiptFixture());
  });

  it("rejects progress claims that contradict the enrollment lifecycle", () => {
    const claimed = structuredClone(courseProgressListFixture("claimed"));
    claimed.items[0]!.currentChapterId = "xunpu-chapter-1";
    expect(CourseProgressListSchema.safeParse(claimed).success).toBe(false);

    const awaiting = structuredClone(courseProgressListFixture("awaiting_review"));
    awaiting.items[0]!.completedChapterIds.pop();
    expect(CourseProgressListSchema.safeParse(awaiting).success).toBe(false);
  });

  it("rejects cross-release portfolio evidence and dangling evidence refs", () => {
    const dangling = structuredClone(studentPortfolioFixture());
    dangling.items[0]!.evidenceIds = ["evidence-unknown"];
    expect(StudentPortfolioSchema.safeParse(dangling).success).toBe(false);

    const drifted = structuredClone(studentPortfolioFixture());
    drifted.evidence[0]!.courseReleaseRef = {
      ...drifted.evidence[0]!.courseReleaseRef,
      contentHash: "f".repeat(64),
    };
    expect(StudentPortfolioSchema.safeParse(drifted).success).toBe(false);

    const unrelated = structuredClone(studentPortfolioFixture());
    unrelated.evidence.push({
      ...unrelated.evidence[0]!,
      evidenceId: "evidence-unrelated",
    });
    expect(StudentPortfolioSchema.safeParse(unrelated).success).toBe(false);
  });

  it("rejects review workspaces with session or immutable release drift", () => {
    const sessionDrift = structuredClone(
      courseReviewWorkspaceFixture("awaiting_review"),
    );
    if (sessionDrift.status !== "awaiting_review") throw new Error("fixture");
    sessionDrift.submission.sessionId = "session-foreign";
    expect(CourseReviewWorkspaceSchema.safeParse(sessionDrift).success)
      .toBe(false);

    const releaseDrift = structuredClone(
      courseReviewWorkspaceFixture("completed"),
    );
    if (releaseDrift.status !== "completed") throw new Error("fixture");
    releaseDrift.submission.courseReleaseRef.contentHash = "f".repeat(64);
    expect(CourseReviewWorkspaceSchema.safeParse(releaseDrift).success)
      .toBe(false);
  });

  it("rejects browser-supplied artifacts, scores, actors and technical fields", () => {
    const forbiddenValues = [
      { artifactIds: ["artifact-browser"] },
      { evidenceIds: ["evidence-browser"] },
      { finalScore: 100 },
      { actorId: "student-reporter" },
      { prompt: "hidden" },
      { provider: "model-provider" },
      { trace: { runId: "trace-1" } },
    ];
    for (const extra of forbiddenValues) {
      expect(CourseSubmissionRequestSchema.safeParse({
        bindingId: "binding-student-xunpu",
        expectedEnrollmentStateVersion: 3,
        requestId: "request-submit-xunpu",
        ...extra,
      }).success).toBe(false);
      expect(CourseReviewFinalizeRequestSchema.safeParse({
        bindingId: "binding-teacher-xunpu",
        reviewTaskId: "review-task-xunpu-final",
        expectedEnrollmentStateVersion: 4,
        requestId: "request-review-xunpu",
        ...extra,
      }).success).toBe(false);
    }
  });

  it("accepts a pseudonymous teacher review task list", () => {
    expect(CourseReviewTaskListSchema.parse(courseReviewTaskListFixture()))
      .toEqual(courseReviewTaskListFixture());
    const drifted = structuredClone(courseReviewTaskListFixture());
    drifted.items[0]!.sessionId = "session-foreign";
    expect(CourseReviewTaskListSchema.safeParse(drifted).success).toBe(false);
  });

  it("rejects schema drift and unknown response fields", () => {
    expect(CourseProgressListSchema.safeParse({
      ...courseProgressListFixture(),
      schemaVersion: "course-progress-list/2.0.1",
    }).success).toBe(false);
    expect(StudentPortfolioSchema.safeParse({
      ...studentPortfolioFixture(),
      rawProjection: { privateMemory: "secret" },
    }).success).toBe(false);
    expect(CourseOutcomeMutationReceiptSchema.safeParse({
      ...courseOutcomeReceiptFixture(),
      candidateId: "candidate-browser",
    }).success).toBe(false);
  });
});
