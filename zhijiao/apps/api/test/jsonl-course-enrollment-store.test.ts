import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CourseReleaseSchema } from "@ronggang/contracts";
import { xunpuContractCourseRelease } from "@ronggang/course-content";
import {
  CourseLearningService,
  type CourseLearningBinding,
  type CourseLearningSubject,
  type CourseOutcomeRuntimeSnapshot,
} from "../src/course-learning.js";
import { JsonlCourseEnrollmentStore } from "../src/jsonl-course-enrollment-store.js";

const release = CourseReleaseSchema.parse(xunpuContractCourseRelease);
const subject: CourseLearningSubject = {
  principalId: "principal-jsonl-student",
  profileId: "student-unassigned",
  role: "student",
};
const binding: CourseLearningBinding = {
  bindingId: "binding-jsonl-reporter",
  sessionId: "session-jsonl-xunpu",
  actorId: "student-reporter",
  actorKind: "student",
  roleId: "reporter",
};
const directories: string[] = [];

function outcomeSnapshot(review = false): CourseOutcomeRuntimeSnapshot {
  const portfolioItems = release.chapters.map((chapter, index) => ({
    artifactId: `task-outcome:${chapter.chapterId}`,
    revisionId: `task-outcome-revision:${chapter.chapterId}:${index + 1}`,
    chapterId: chapter.chapterId,
    deliverableIds: [...chapter.deliverableIds],
    origin: "server_process_record" as const,
    title: `过程记录｜${chapter.title}`,
    kind: "task_outcome" as const,
    status: "submitted" as const,
    revisionNumber: 1,
    summary: `已完成${chapter.title}并形成可复核过程记录。`,
    contentHash: (index + 1).toString(16).repeat(64),
    evidenceIds: [`evidence-jsonl-${index + 1}`],
    updatedAt: "2026-08-09T08:02:00.000Z",
  }));
  return {
    stateVersion: review ? 40 : 39,
    scenarioStatus: review ? "completed" : "review",
    currentChapterId: null,
    completedChapterIds: release.chapters.map((chapter) => chapter.chapterId),
    submittedDeliverableIds: release.chapters.flatMap((chapter) => (
      chapter.deliverableIds
    )),
    portfolioItems,
    evidence: portfolioItems.map((item, index) => ({
      evidenceId: item.evidenceIds[0]!,
      title: `${release.chapters[index]!.title}过程证据`,
      basis: "服务端世界事件确认本章任务已经完成。",
      artifactRevisionRefs: [item.revisionId],
      createdAt: "2026-08-09T08:02:30.000Z",
    })),
    review: review
      ? {
          reviewId: "review-jsonl-authoritative",
          finalScore: 90,
          dimensions: [{
            dimensionId: "dimension-evidence",
            label: "证据覆盖",
            score: 45,
            maxScore: 50,
            feedback: "提交时冻结的过程证据覆盖完整。",
            evidenceRefs: ["evidence-jsonl-1"],
          }],
          publicSummary: "权威评价已完成并可在重启后恢复。",
          finalizedAt: "2026-08-09T08:03:00.000Z",
        }
      : null,
  };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

describe("JsonlCourseEnrollmentStore", () => {
  it("restores immutable enrollments after restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ronggang-course-store-"));
    directories.push(directory);
    const path = join(directory, "course-enrollments.jsonl");
    const firstService = new CourseLearningService({
      releases: [release],
      enrollmentStore: new JsonlCourseEnrollmentStore(path),
      now: () => "2026-08-09T08:00:00.000Z",
    });

    const claimed = await firstService.claim({
      subject,
      courseReleaseId: release.releaseId,
      bindingId: binding.bindingId,
      activeSessionId: binding.sessionId,
    });

    const reopenedService = new CourseLearningService({
      releases: [release],
      enrollmentStore: new JsonlCourseEnrollmentStore(path),
      now: () => "2026-08-09T08:01:00.000Z",
    });
    expect(await reopenedService.listEnrollments({
      subject,
      bindings: [binding],
    })).toEqual([claimed]);
  });

  it("serializes compare-and-swap so one concurrent writer wins", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ronggang-course-cas-"));
    directories.push(directory);
    const path = join(directory, "course-enrollments.jsonl");
    const store = new JsonlCourseEnrollmentStore(path);
    const service = new CourseLearningService({
      releases: [release],
      enrollmentStore: store,
      now: () => "2026-08-09T08:00:00.000Z",
    });
    await service.claim({
      subject,
      courseReleaseId: release.releaseId,
      bindingId: binding.bindingId,
      activeSessionId: binding.sessionId,
    });
    const record = await store.getByPrincipalAndCourse(
      subject.principalId,
      release.courseId,
    );
    if (!record) throw new Error("expected persisted enrollment");
    const first = structuredClone(record);
    first.enrollment = {
      ...first.enrollment,
      bindingId: "binding-jsonl-winner-a",
      stateVersion: 1,
      updatedAt: "2026-08-09T08:02:00.000Z",
    };
    const second = structuredClone(record);
    second.enrollment = {
      ...second.enrollment,
      bindingId: "binding-jsonl-winner-b",
      stateVersion: 1,
      updatedAt: "2026-08-09T08:02:00.000Z",
    };

    const results = await Promise.all([
      store.compareAndSwap({ record: first, expectedStateVersion: 0 }),
      new JsonlCourseEnrollmentStore(path).compareAndSwap({
        record: second,
        expectedStateVersion: 0,
      }),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    const reopened = await new JsonlCourseEnrollmentStore(path)
      .getByPrincipalAndCourse(subject.principalId, release.courseId);
    expect(reopened?.enrollment.stateVersion).toBe(1);
    expect([
      "binding-jsonl-winner-a",
      "binding-jsonl-winner-b",
    ]).toContain(reopened?.enrollment.bindingId);
  });

  it("restores frozen submission, review and idempotent receipts across restarts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ronggang-course-journey-"));
    directories.push(directory);
    const path = join(directory, "course-enrollments.jsonl");
    const teacher: CourseLearningSubject = {
      principalId: "principal-jsonl-teacher",
      profileId: "teacher-class-a",
      role: "teacher",
    };
    const teacherBinding: CourseLearningBinding = {
      bindingId: "binding-jsonl-teacher",
      sessionId: binding.sessionId,
      actorId: "teacher-main",
      actorKind: "teacher",
      roleId: "teacher-director",
    };
    const first = new CourseLearningService({
      releases: [release],
      launches: [{
        releaseId: release.releaseId,
        sessionId: binding.sessionId,
        reporterActorId: binding.actorId,
      }],
      enrollmentStore: new JsonlCourseEnrollmentStore(path),
      outcomeProjectionReader: {
        read: async () => outcomeSnapshot(false),
      },
      now: () => "2026-08-09T08:04:00.000Z",
    });
    await first.claim({
      subject,
      courseReleaseId: release.releaseId,
      bindingId: binding.bindingId,
      activeSessionId: binding.sessionId,
    });
    const submitted = await first.submitForReview({
      subject,
      binding,
      sessionId: binding.sessionId,
      expectedEnrollmentStateVersion: 0,
      requestId: "request-jsonl-submit",
    });

    const second = new CourseLearningService({
      releases: [release],
      launches: [{
        releaseId: release.releaseId,
        sessionId: binding.sessionId,
        reporterActorId: binding.actorId,
      }],
      enrollmentStore: new JsonlCourseEnrollmentStore(path),
      outcomeProjectionReader: {
        read: async () => outcomeSnapshot(true),
      },
      now: () => "2026-08-09T08:05:00.000Z",
    });
    expect(await second.submitForReview({
      subject,
      binding,
      sessionId: binding.sessionId,
      expectedEnrollmentStateVersion: 0,
      requestId: "request-jsonl-submit",
    })).toEqual(submitted);
    const awaiting = await second.getReviewWorkspace({
      subject,
      binding,
      sessionId: binding.sessionId,
    });
    if (awaiting.status !== "awaiting_review") {
      throw new Error("expected persisted awaiting review workspace");
    }
    await second.finalizeReview({
      subject: teacher,
      binding: teacherBinding,
      sessionId: binding.sessionId,
      reviewTaskId: awaiting.submission.reviewTaskId,
      expectedEnrollmentStateVersion: 1,
      requestId: "request-jsonl-review",
    });

    const third = new CourseLearningService({
      releases: [release],
      enrollmentStore: new JsonlCourseEnrollmentStore(path),
      now: () => "2026-08-09T08:06:00.000Z",
    });
    expect((await third.listEnrollments({
      subject,
      bindings: [binding],
    }))[0]).toMatchObject({ status: "completed", stateVersion: 2 });
    expect(await third.getReviewWorkspace({
      subject,
      binding,
      sessionId: binding.sessionId,
    })).toMatchObject({
      status: "completed",
      review: { reviewId: "review-jsonl-authoritative" },
    });

    const lines = (await readFile(path, "utf8")).trimEnd().split("\n");
    const forged = JSON.parse(lines.at(-1)!) as {
      sequence: number;
      writtenAt: string;
      records: Array<{
        completion: {
          portfolioItemIds: string[];
          evidenceIds: string[];
          reviewId: string;
        } | null;
      }>;
    };
    const completion = forged.records[0]?.completion;
    if (!completion) throw new Error("expected completed persisted record");
    completion.portfolioItemIds = completion.portfolioItemIds.map(() => (
      completion.portfolioItemIds[0]!
    ));
    completion.evidenceIds = completion.evidenceIds.map(() => (
      completion.evidenceIds[0]!
    ));
    forged.sequence += 1;
    forged.writtenAt = "2026-08-09T08:07:00.000Z";
    await appendFile(path, `${JSON.stringify(forged)}\n`, "utf8");

    await expect(new JsonlCourseEnrollmentStore(path).listByPrincipal(
      subject.principalId,
    )).rejects.toThrow(/课程认领日志第/u);
  });
});
