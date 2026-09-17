import { describe, expect, it, vi } from "vitest";
import {
  CourseEnrollmentSchema,
  CourseReleaseSchema,
  courseReleaseReferenceOf,
} from "@ronggang/contracts";
import { xunpuContractCourseRelease } from "@ronggang/course-content";
import { villageSuperRuntimeCourseRelease } from "@ronggang/world-core";
import {
  CourseLearningService,
  InMemoryCourseEnrollmentStore,
  type CourseLearningBinding,
  type CourseLearningSubject,
  type CourseOutcomeRuntimeSnapshot,
} from "../src/course-learning.js";

const release = CourseReleaseSchema.parse(xunpuContractCourseRelease);
const villageRelease = CourseReleaseSchema.parse(
  villageSuperRuntimeCourseRelease,
);
const student: CourseLearningSubject = {
  principalId: "principal-student-v2",
  profileId: "student-unassigned",
  role: "student",
};
const reporterBinding: CourseLearningBinding = {
  bindingId: "binding-student-v2-reporter",
  sessionId: "session-xunpu-v2",
  actorId: "student-reporter",
  actorKind: "student",
  roleId: "reporter",
};
const fixedNow = () => "2026-08-09T03:00:00.000Z";

function outcomeSnapshot(
  overrides: Partial<CourseOutcomeRuntimeSnapshot> = {},
): CourseOutcomeRuntimeSnapshot {
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
    evidenceIds: [`evidence-xunpu-${index + 1}`],
    updatedAt: "2026-08-09T02:58:00.000Z",
  }));
  const evidence = portfolioItems.map((item, index) => ({
    evidenceId: item.evidenceIds[0]!,
    title: `${release.chapters[index]!.title}过程证据`,
    basis: "世界状态记录了本章任务选择与完成结果。",
    artifactRevisionRefs: [item.revisionId],
    createdAt: "2026-08-09T02:59:00.000Z",
  }));
  return {
    stateVersion: 31,
    scenarioStatus: "review",
    currentChapterId: null,
    completedChapterIds: release.chapters.map((chapter) => chapter.chapterId),
    submittedDeliverableIds: release.chapters.flatMap((chapter) => (
      chapter.deliverableIds
    )),
    portfolioItems,
    evidence,
    review: null,
    ...overrides,
  };
}

const teacher: CourseLearningSubject = {
  principalId: "principal-teacher-v2",
  profileId: "teacher-class-a",
  role: "teacher",
};
const teacherBinding: CourseLearningBinding = {
  bindingId: "binding-teacher-v2",
  sessionId: reporterBinding.sessionId,
  actorId: "teacher-main",
  actorKind: "teacher",
  roleId: "teacher-director",
};

describe("CourseLearningService", () => {
  it("rebuilds dedicated runtime outcomes across all views without a second stored completion authority", async () => {
    const store = new InMemoryCourseEnrollmentStore();
    let snapshot = outcomeSnapshot({
      authoritativeCourseStatus: "awaiting_review",
      updatedAt: "2026-08-09T03:01:00.000Z",
      submittedAt: "2026-08-09T03:01:00.000Z",
    });
    const read = vi.fn(async () => structuredClone(snapshot));
    const createService = () => new CourseLearningService({
      releases: [release], enrollmentStore: store, now: fixedNow,
      launches: [{ releaseId: release.releaseId, sessionId: reporterBinding.sessionId, reporterActorId: reporterBinding.actorId }],
      outcomeProjectionReader: { isAuthoritative: () => true, read },
      projectionReader: { read: async () => ({ stateVersion: snapshot.stateVersion, sceneId: "field", sourceEventId: null, chapterId: snapshot.currentChapterId ?? release.chapters[0]!.chapterId }) },
    });
    const service = createService();
    await service.claim({ subject: student, courseReleaseId: release.releaseId, bindingId: reporterBinding.bindingId, activeSessionId: reporterBinding.sessionId });
    const original = await store.listByPrincipal(student.principalId);
    const studentInput = { subject: student, bindings: [reporterBinding] };
    const progress = await service.listProgress(studentInput);
    expect(progress.items[0]).toMatchObject({ enrollment: { status: "awaiting_review" }, completedChapterIds: snapshot.completedChapterIds, portfolioItemCount: 7 });
    expect((await service.listEnrollments(studentInput))[0]?.status).toBe("awaiting_review");
    expect((await service.getPortfolio(studentInput)).items).toHaveLength(7);
    expect((await service.getLearningActivity({ subject: student, binding: reporterBinding, sessionId: reporterBinding.sessionId })).status).toBe("awaiting_review");
    const tasks = await service.listReviewTasks({ subject: teacher, binding: teacherBinding, sessionId: reporterBinding.sessionId });
    expect(tasks.items).toHaveLength(1);
    expect((await service.getReviewWorkspace({ subject: teacher, binding: teacherBinding, sessionId: reporterBinding.sessionId, reviewTaskId: tasks.items[0]!.reviewTaskId })).status).toBe("awaiting_review");
    snapshot = {
      ...snapshot,
      authoritativeCourseStatus: "completed",
      updatedAt: "2026-08-09T03:02:00.000Z",
      review: { reviewId: "runtime-final-review", finalScore: 83, dimensions: [{ dimensionId: "actual-evidence", label: "证据核查", score: 83, maxScore: 100, feedback: "实际来源足以支撑限定结论。", evidenceRefs: [snapshot.evidence[0]!.evidenceId] }], publicSummary: "教师已复核本版成果。", finalizedAt: "2026-08-09T03:02:00.000Z" },
    };
    const restarted = createService();
    expect((await restarted.listProgress(studentInput)).items[0]?.reviewStatus).toBe("completed");
    expect((await restarted.getReviewWorkspace({ subject: student, binding: reporterBinding, sessionId: reporterBinding.sessionId })).review?.finalScore).toBe(83);
    expect((await restarted.getLearningActivity({ subject: student, binding: reporterBinding, sessionId: reporterBinding.sessionId })).completion?.reviewId).toBe("runtime-final-review");
    snapshot = {
      ...snapshot, authoritativeCourseStatus: "in_progress", submittedAt: null, review: null,
      currentChapterId: release.chapters[0]!.chapterId,
      completedChapterIds: snapshot.completedChapterIds.slice(1),
      portfolioItems: snapshot.portfolioItems.map((item, index) => index === 0 ? { ...item, status: "draft", revisionNumber: 2 } : item),
    };
    expect((await restarted.listProgress(studentInput)).items[0]?.enrollment.status).toBe("in_progress");
    expect((await restarted.getPortfolio(studentInput)).items[0]?.status).toBe("draft");
    expect((await restarted.listReviewTasks({ subject: teacher, binding: teacherBinding, sessionId: reporterBinding.sessionId })).items).toEqual([]);
    expect(await store.listByPrincipal(student.principalId)).toEqual(original);
    expect(read).toHaveBeenCalledWith(expect.objectContaining({ principalId: student.principalId, actorId: reporterBinding.actorId }));
    await expect(restarted.submitForReview({ subject: student, binding: reporterBinding, sessionId: reporterBinding.sessionId, expectedEnrollmentStateVersion: original[0]!.enrollment.stateVersion, requestId: "no-second-submission" })).rejects.toThrow("旗舰编辑部");
  });

  it("lists a compact immutable catalog and returns the full released course", () => {
    const service = new CourseLearningService({ releases: [release] });

    expect(service.listCourses()).toEqual([expect.objectContaining({
      schemaVersion: "course-release-summary/2.0.0",
      courseId: release.courseId,
      courseReleaseId: release.releaseId,
      chapterCount: 7,
      sourceCount: 24,
    })]);
    const first = service.getCourse(release.courseId);
    first.chapters[0]!.title = "客户端尝试改写";
    expect(service.getCourse(release.courseId).chapters[0]!.title)
      .toBe(release.chapters[0]!.title);
  });

  it("claims the frozen release idempotently with the reporter role only", async () => {
    const service = new CourseLearningService({
      releases: [release],
      now: fixedNow,
    });

    const first = await service.claim({
      subject: student,
      courseReleaseId: release.releaseId,
      bindingId: reporterBinding.bindingId,
      activeSessionId: reporterBinding.sessionId,
    });
    const second = await service.claim({
      subject: student,
      courseReleaseId: release.releaseId,
      bindingId: reporterBinding.bindingId,
      activeSessionId: reporterBinding.sessionId,
    });

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      status: "in_progress",
      bindingId: reporterBinding.bindingId,
      activeSessionId: reporterBinding.sessionId,
      primaryJobId: "integrated_media_reporter",
      primaryRoleId: "reporter",
    });
    expect(await service.listEnrollments({
      subject: student,
      bindings: [reporterBinding],
    })).toHaveLength(1);
  });

  it("registers a version-locked course launch idempotently", () => {
    const service = new CourseLearningService({ releases: [release] });
    const ref = courseReleaseReferenceOf(release);
    const launch = {
      releaseId: release.releaseId,
      sessionId: reporterBinding.sessionId,
      reporterActorId: reporterBinding.actorId,
    };

    expect(service.registerLaunch(ref, launch)).toEqual(launch);
    expect(service.registerLaunch(ref, launch)).toEqual(launch);
    expect(service.getLaunch(release.releaseId)).toEqual(launch);
    expect(() => service.registerLaunch(ref, {
      ...launch,
      sessionId: "session-xunpu-other",
    })).toThrow(expect.objectContaining({ code: "enrollment_conflict" }));
    expect(() => service.getReleaseByReference({
      ...ref,
      contentHash: "f".repeat(64),
    })).toThrow(expect.objectContaining({ code: "version_hash_drift" }));
  });

  it("activates an earlier claim when the frozen course launch becomes available", async () => {
    const service = new CourseLearningService({
      releases: [release],
      now: fixedNow,
    });
    const claimed = await service.claim({
      subject: student,
      courseReleaseId: release.releaseId,
      bindingId: null,
      activeSessionId: null,
    });
    expect(claimed.status).toBe("claimed");

    service.registerLaunch(courseReleaseReferenceOf(release), {
      releaseId: release.releaseId,
      sessionId: reporterBinding.sessionId,
      reporterActorId: reporterBinding.actorId,
    });
    const activated = await service.claim({
      subject: student,
      courseReleaseId: release.releaseId,
      bindingId: reporterBinding.bindingId,
      activeSessionId: reporterBinding.sessionId,
    });

    expect(activated).toMatchObject({
      status: "in_progress",
      activeSessionId: reporterBinding.sessionId,
      bindingId: reporterBinding.bindingId,
      stateVersion: 1,
    });
  });

  it("rejects teacher claims before any enrollment is stored", async () => {
    const service = new CourseLearningService({ releases: [release] });

    await expect(service.claim({
      subject: {
        principalId: "principal-teacher-v2",
        profileId: "teacher-class-a",
        role: "teacher",
      },
      courseReleaseId: release.releaseId,
      bindingId: reporterBinding.bindingId,
      activeSessionId: reporterBinding.sessionId,
    })).rejects.toMatchObject({ code: "access_denied" });
    expect(await service.listEnrollments({
      subject: student,
      bindings: [],
    })).toEqual([]);
  });

  it("returns a true empty activity without touching the projection reader", async () => {
    const read = vi.fn();
    const service = new CourseLearningService({
      releases: [release],
      projectionReader: { read },
      now: fixedNow,
    });

    const activity = await service.getLearningActivity({
      subject: student,
      binding: reporterBinding,
      sessionId: reporterBinding.sessionId,
    });

    expect(activity).toMatchObject({
      status: "empty",
      currentTask: null,
      enrollment: null,
      guideSteps: [],
      primaryAction: { actionId: "browse_courses" },
    });
    expect(read).not.toHaveBeenCalled();
  });

  it("keeps progress, portfolio and review reads free of enrollment writes", async () => {
    const store = new InMemoryCourseEnrollmentStore();
    const createSpy = vi.spyOn(store, "create");
    const casSpy = vi.spyOn(store, "compareAndSwap");
    const putSpy = vi.spyOn(store, "put");
    const service = new CourseLearningService({
      releases: [release],
      enrollmentStore: store,
      outcomeProjectionReader: {
        read: vi.fn().mockResolvedValue(outcomeSnapshot()),
      },
      now: fixedNow,
    });
    await service.claim({
      subject: student,
      courseReleaseId: release.releaseId,
      bindingId: reporterBinding.bindingId,
      activeSessionId: reporterBinding.sessionId,
    });
    createSpy.mockClear();
    casSpy.mockClear();
    putSpy.mockClear();

    await service.listProgress({ subject: student, bindings: [reporterBinding] });
    await service.getPortfolio({ subject: student, bindings: [reporterBinding] });
    await service.getReviewWorkspace({
      subject: student,
      binding: reporterBinding,
      sessionId: reporterBinding.sessionId,
    });

    expect(createSpy).not.toHaveBeenCalled();
    expect(casSpy).not.toHaveBeenCalled();
    expect(putSpy).not.toHaveBeenCalled();
  });

  it("builds one active task, three guide steps and one primary action", async () => {
    const read = vi.fn().mockResolvedValue({
      stateVersion: 12,
      sceneId: "scene-xunpu-field",
      sourceEventId: "event-xunpu-assignment",
      chapterId: "xunpu-field-reporting",
      priority: "high" as const,
    });
    const service = new CourseLearningService({
      releases: [release],
      projectionReader: { read },
      now: fixedNow,
    });
    await service.claim({
      subject: student,
      courseReleaseId: release.releaseId,
      bindingId: reporterBinding.bindingId,
      activeSessionId: reporterBinding.sessionId,
    });

    const activity = await service.getLearningActivity({
      subject: student,
      binding: reporterBinding,
      sessionId: reporterBinding.sessionId,
    });

    expect(activity.status).toBe("active");
    if (activity.status !== "active") throw new Error("expected active");
    expect(activity.currentTask).toMatchObject({
      chapterId: "xunpu-field-reporting",
      sceneId: "scene-xunpu-field",
      sourceEventId: "event-xunpu-assignment",
      priority: "high",
    });
    expect(activity.guideSteps).toHaveLength(3);
    expect(activity.guideSteps.filter((step) => step.status === "current"))
      .toHaveLength(1);
    expect(activity.primaryAction.actionId).toBe("continue_task");
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("fails closed before projection reads when the stored release hash drifts", async () => {
    const store = new InMemoryCourseEnrollmentStore();
    const read = vi.fn();
    const driftedEnrollment = CourseEnrollmentSchema.parse({
      schemaVersion: "course-enrollment/2.0.0",
      enrollmentId: "enrollment-drifted",
      bindingId: reporterBinding.bindingId,
      courseReleaseRef: {
        courseId: release.courseId,
        releaseId: release.releaseId,
        version: release.version,
        contentHash: "f".repeat(64),
      },
      primaryJobId: "integrated_media_reporter",
      primaryRoleId: "reporter",
      status: "in_progress",
      activeSessionId: reporterBinding.sessionId,
      claimedAt: fixedNow(),
      startedAt: fixedNow(),
      submittedAt: null,
      completedAt: null,
      stateVersion: 1,
      updatedAt: fixedNow(),
    });
    await store.put({
      principalId: student.principalId,
      enrollment: driftedEnrollment,
      submittedDeliverableIds: [],
      completion: null,
    });
    const service = new CourseLearningService({
      releases: [release],
      enrollmentStore: store,
      projectionReader: { read },
      now: fixedNow,
    });

    await expect(service.getLearningActivity({
      subject: student,
      binding: reporterBinding,
      sessionId: reporterBinding.sessionId,
    })).rejects.toMatchObject({
      code: "version_hash_drift",
    });
    expect(read).not.toHaveBeenCalled();
  });

  it("derives progress and portfolio only from the injected outcome projection", async () => {
    const read = vi.fn().mockResolvedValue(outcomeSnapshot({
      scenarioStatus: "running",
      currentChapterId: release.chapters[1]!.chapterId,
      completedChapterIds: [release.chapters[0]!.chapterId],
      submittedDeliverableIds: [],
      portfolioItems: [],
      evidence: [],
    }));
    const service = new CourseLearningService({
      releases: [release],
      outcomeProjectionReader: { read },
      now: fixedNow,
    });
    await service.claim({
      subject: student,
      courseReleaseId: release.releaseId,
      bindingId: reporterBinding.bindingId,
      activeSessionId: reporterBinding.sessionId,
    });

    const progress = await service.listProgress({
      subject: student,
      bindings: [reporterBinding],
    });
    const portfolio = await service.getPortfolio({
      subject: student,
      bindings: [reporterBinding],
    });

    expect(progress.items[0]).toMatchObject({
      currentChapterId: release.chapters[1]!.chapterId,
      completedChapterIds: [release.chapters[0]!.chapterId],
      portfolioItemCount: 0,
      evidenceCount: 0,
      reviewStatus: "not_submitted",
    });
    expect(portfolio).toMatchObject({ items: [], evidence: [] });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("aggregates multiple owned active courses from frozen launches without browser actor claims", async () => {
    const villageBinding: CourseLearningBinding = {
      bindingId: "binding-student-village-reporter",
      sessionId: "session-village-v2",
      actorId: "student-village-reporter",
      actorKind: "student",
      roleId: "reporter",
    };
    const read = vi.fn(async (input: {
      actorId: string;
      release: typeof release;
    }) => outcomeSnapshot({
      scenarioStatus: "running",
      currentChapterId: input.release.chapters[0]!.chapterId,
      completedChapterIds: [],
      submittedDeliverableIds: [],
      portfolioItems: [],
      evidence: [],
    }));
    const service = new CourseLearningService({
      releases: [release, villageRelease],
      launches: [{
        releaseId: release.releaseId,
        sessionId: reporterBinding.sessionId,
        reporterActorId: reporterBinding.actorId,
      }, {
        releaseId: villageRelease.releaseId,
        sessionId: villageBinding.sessionId,
        reporterActorId: villageBinding.actorId,
      }],
      outcomeProjectionReader: { read },
      now: fixedNow,
    });
    await service.claim({
      subject: student,
      courseReleaseId: release.releaseId,
      bindingId: reporterBinding.bindingId,
      activeSessionId: reporterBinding.sessionId,
    });
    await service.claim({
      subject: student,
      courseReleaseId: villageRelease.releaseId,
      bindingId: villageBinding.bindingId,
      activeSessionId: villageBinding.sessionId,
    });

    const progress = await service.listProgress({
      subject: student,
      bindings: [],
    });
    const portfolio = await service.getPortfolio({
      subject: student,
      bindings: [],
    });

    expect(progress.items).toHaveLength(2);
    expect(progress.items.map((item) => item.enrollment.courseReleaseRef.courseId))
      .toEqual([release.courseId, villageRelease.courseId]);
    expect(portfolio).toMatchObject({ items: [], evidence: [] });
    expect(read).toHaveBeenCalledTimes(4);
    expect(read.mock.calls.map(([input]) => input.actorId).sort()).toEqual([
      reporterBinding.actorId,
      reporterBinding.actorId,
      villageBinding.actorId,
      villageBinding.actorId,
    ].sort());
  });

  it("freezes server-derived outcomes, then completes only from authoritative review", async () => {
    const reviewed = outcomeSnapshot({
      stateVersion: 34,
      scenarioStatus: "completed",
      review: {
        reviewId: "review-xunpu-authoritative",
        finalScore: 91,
        dimensions: [{
          dimensionId: "dimension-evidence",
          label: "证据覆盖",
          score: 46,
          maxScore: 50,
          feedback: "主要事实与过程选择均可复核。",
          evidenceRefs: ["evidence-xunpu-1"],
        }],
        publicSummary: "作品达到课程发布与复盘要求。",
        finalizedAt: "2026-08-09T02:59:30.000Z",
      },
    });
    const read = vi.fn()
      .mockResolvedValueOnce(outcomeSnapshot())
      .mockResolvedValueOnce(reviewed);
    const store = new InMemoryCourseEnrollmentStore();
    const service = new CourseLearningService({
      releases: [release],
      enrollmentStore: store,
      launches: [{
        releaseId: release.releaseId,
        sessionId: reporterBinding.sessionId,
        reporterActorId: reporterBinding.actorId,
      }],
      outcomeProjectionReader: { read },
      now: fixedNow,
    });
    await service.claim({
      subject: student,
      courseReleaseId: release.releaseId,
      bindingId: reporterBinding.bindingId,
      activeSessionId: reporterBinding.sessionId,
    });

    const submitted = await service.submitForReview({
      subject: student,
      binding: reporterBinding,
      sessionId: reporterBinding.sessionId,
      expectedEnrollmentStateVersion: 0,
      requestId: "request-submit-xunpu",
    });
    const repeatedSubmission = await service.submitForReview({
      subject: student,
      binding: reporterBinding,
      sessionId: reporterBinding.sessionId,
      expectedEnrollmentStateVersion: 0,
      requestId: "request-submit-xunpu",
    });
    expect(submitted).toEqual(repeatedSubmission);
    expect(submitted).toMatchObject({
      status: "awaiting_review",
      stateVersion: 1,
    });
    const awaitingWorkspace = await service.getReviewWorkspace({
      subject: student,
      binding: reporterBinding,
      sessionId: reporterBinding.sessionId,
    });
    expect(awaitingWorkspace).toMatchObject({
      viewer: "student",
      status: "awaiting_review",
      submission: {
        portfolioItemIds: expect.arrayContaining([
          "portfolio:task-outcome:xunpu-topic-brief",
        ]),
        evidenceIds: expect.arrayContaining(["evidence-xunpu-1"]),
      },
      review: null,
    });
    if (awaitingWorkspace.status !== "awaiting_review") {
      throw new Error("expected awaiting review workspace");
    }
    const reviewTaskId = awaitingWorkspace.submission.reviewTaskId;

    const completed = await service.finalizeReview({
      subject: teacher,
      binding: teacherBinding,
      sessionId: reporterBinding.sessionId,
      reviewTaskId,
      expectedEnrollmentStateVersion: 1,
      requestId: "request-review-xunpu",
    });
    const repeatedReview = await service.finalizeReview({
      subject: teacher,
      binding: teacherBinding,
      sessionId: reporterBinding.sessionId,
      reviewTaskId,
      expectedEnrollmentStateVersion: 1,
      requestId: "request-review-xunpu",
    });
    expect(completed).toEqual(repeatedReview);
    expect(completed).toMatchObject({ status: "completed", stateVersion: 2 });
    expect(await service.submitForReview({
      subject: student,
      binding: reporterBinding,
      sessionId: reporterBinding.sessionId,
      expectedEnrollmentStateVersion: 0,
      requestId: "request-submit-xunpu",
    })).toEqual(submitted);
    await expect(service.submitForReview({
      subject: student,
      binding: reporterBinding,
      sessionId: reporterBinding.sessionId,
      expectedEnrollmentStateVersion: 99,
      requestId: "request-submit-xunpu",
    })).rejects.toMatchObject({ code: "enrollment_conflict" });
    expect(await service.getReviewWorkspace({
      subject: teacher,
      binding: teacherBinding,
      sessionId: reporterBinding.sessionId,
      reviewTaskId,
    })).toMatchObject({
      viewer: "teacher",
      status: "completed",
      review: {
        reviewId: "review-xunpu-authoritative",
        finalScore: 91,
      },
    });
    const activity = await service.getLearningActivity({
      subject: student,
      binding: reporterBinding,
      sessionId: reporterBinding.sessionId,
    });
    expect(activity).toMatchObject({
      status: "completed",
      completion: {
        reviewId: "review-xunpu-authoritative",
        portfolioItemIds: expect.arrayContaining([
          "portfolio:task-outcome:xunpu-topic-brief",
        ]),
      },
    });
    expect(read).toHaveBeenCalledTimes(2);

    const forged = await store.getByPrincipalAndSession(
      student.principalId,
      reporterBinding.sessionId,
    );
    if (!forged?.completion) throw new Error("expected completed stored outcome");
    forged.completion = {
      portfolioItemIds: forged.completion.portfolioItemIds.map(() => (
        forged.completion!.portfolioItemIds[0]!
      )),
      evidenceIds: forged.completion.evidenceIds.map(() => (
        forged.completion!.evidenceIds[0]!
      )),
      reviewId: forged.completion.reviewId,
    };
    await store.put(forged);
    await expect(service.getLearningActivity({
      subject: student,
      binding: reporterBinding,
      sessionId: reporterBinding.sessionId,
    })).rejects.toMatchObject({ code: "version_hash_drift" });
  });

  it("completes a terminal V2 journey with a deterministic process review when no world assessment exists", async () => {
    const read = vi.fn()
      .mockResolvedValueOnce(outcomeSnapshot())
      .mockResolvedValueOnce(outcomeSnapshot({
        stateVersion: 34,
        scenarioStatus: "completed",
        review: null,
      }));
    const store = new InMemoryCourseEnrollmentStore();
    const service = new CourseLearningService({
      releases: [release],
      enrollmentStore: store,
      launches: [{
        releaseId: release.releaseId,
        sessionId: reporterBinding.sessionId,
        reporterActorId: reporterBinding.actorId,
      }],
      outcomeProjectionReader: { read },
      now: fixedNow,
    });
    await service.claim({
      subject: student,
      courseReleaseId: release.releaseId,
      bindingId: reporterBinding.bindingId,
      activeSessionId: reporterBinding.sessionId,
    });
    await service.submitForReview({
      subject: student,
      binding: reporterBinding,
      sessionId: reporterBinding.sessionId,
      expectedEnrollmentStateVersion: 0,
      requestId: "request-submit-process-review",
    });
    const awaiting = await service.getReviewWorkspace({
      subject: student,
      binding: reporterBinding,
      sessionId: reporterBinding.sessionId,
    });
    if (awaiting.status !== "awaiting_review") {
      throw new Error("expected awaiting review workspace");
    }

    await expect(service.finalizeReview({
      subject: teacher,
      binding: teacherBinding,
      sessionId: reporterBinding.sessionId,
      reviewTaskId: awaiting.submission.reviewTaskId,
      expectedEnrollmentStateVersion: 1,
      requestId: "request-confirm-process-review",
    })).resolves.toMatchObject({ status: "completed", stateVersion: 2 });
    const completed = await service.getReviewWorkspace({
      subject: teacher,
      binding: teacherBinding,
      sessionId: reporterBinding.sessionId,
      reviewTaskId: awaiting.submission.reviewTaskId,
    });
    expect(completed).toMatchObject({
      status: "completed",
      review: {
        reviewId: expect.stringMatching(/^course-process-review:/u),
        finalScore: 100,
        finalizedAt: fixedNow(),
        publicSummary: expect.stringContaining("不是教师或专家"),
      },
    });
    expect(JSON.stringify(completed)).not.toMatch(
      /prompt|privateMemory|provider|token|actorId/u,
    );
    expect(read).toHaveBeenCalledTimes(2);

    const forged = await store.getByPrincipalAndSession(
      student.principalId,
      reporterBinding.sessionId,
    );
    if (!forged?.outcome?.submission) {
      throw new Error("expected completed stored outcome");
    }
    forged.outcome.submission.rubric[0]!.title = "客户端伪造量规标题";
    await store.put(forged);
    await expect(service.getReviewWorkspace({
      subject: student,
      binding: reporterBinding,
      sessionId: reporterBinding.sessionId,
    })).rejects.toMatchObject({ code: "version_hash_drift" });
  });

  it("allows only one concurrent outcome transition for the same state", async () => {
    let arrivals = 0;
    let releaseBarrier!: () => void;
    const barrier = new Promise<void>((resolve) => {
      releaseBarrier = resolve;
    });
    const read = vi.fn().mockImplementation(async () => {
      arrivals += 1;
      if (arrivals === 2) releaseBarrier();
      await barrier;
      return outcomeSnapshot();
    });
    const store = new InMemoryCourseEnrollmentStore();
    const service = new CourseLearningService({
      releases: [release],
      enrollmentStore: store,
      outcomeProjectionReader: { read },
      now: fixedNow,
    });
    await service.claim({
      subject: student,
      courseReleaseId: release.releaseId,
      bindingId: reporterBinding.bindingId,
      activeSessionId: reporterBinding.sessionId,
    });

    const settled = await Promise.allSettled([
      service.submitForReview({
        subject: student,
        binding: reporterBinding,
        sessionId: reporterBinding.sessionId,
        expectedEnrollmentStateVersion: 0,
        requestId: "request-concurrent-a",
      }),
      service.submitForReview({
        subject: student,
        binding: reporterBinding,
        sessionId: reporterBinding.sessionId,
        expectedEnrollmentStateVersion: 0,
        requestId: "request-concurrent-b",
      }),
    ]);

    expect(settled.filter((result) => result.status === "fulfilled"))
      .toHaveLength(1);
    expect(settled.filter((result) => result.status === "rejected"))
      .toHaveLength(1);
    expect((await store.getByPrincipalAndSession(
      student.principalId,
      reporterBinding.sessionId,
    ))?.enrollment).toMatchObject({
      status: "awaiting_review",
      stateVersion: 1,
    });
  });

  it("converges concurrent retries with the same idempotency request", async () => {
    let arrivals = 0;
    let releaseBarrier!: () => void;
    const barrier = new Promise<void>((resolve) => {
      releaseBarrier = resolve;
    });
    const service = new CourseLearningService({
      releases: [release],
      outcomeProjectionReader: {
        read: vi.fn().mockImplementation(async () => {
          arrivals += 1;
          if (arrivals === 2) releaseBarrier();
          await barrier;
          return outcomeSnapshot();
        }),
      },
      now: fixedNow,
    });
    await service.claim({
      subject: student,
      courseReleaseId: release.releaseId,
      bindingId: reporterBinding.bindingId,
      activeSessionId: reporterBinding.sessionId,
    });
    const input = {
      subject: student,
      binding: reporterBinding,
      sessionId: reporterBinding.sessionId,
      expectedEnrollmentStateVersion: 0,
      requestId: "request-concurrent-idempotent",
    } as const;

    const [first, second] = await Promise.all([
      service.submitForReview(input),
      service.submitForReview(input),
    ]);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      status: "awaiting_review",
      stateVersion: 1,
    });
  });

  it("rejects a course submission when one required deliverable lacks its own item and evidence", async () => {
    const incomplete = outcomeSnapshot();
    const removed = incomplete.portfolioItems.pop();
    if (!removed) throw new Error("expected a final chapter item");
    incomplete.evidence = incomplete.evidence.filter((candidate) => (
      !removed.evidenceIds.includes(candidate.evidenceId)
    ));
    const service = new CourseLearningService({
      releases: [release],
      outcomeProjectionReader: { read: vi.fn().mockResolvedValue(incomplete) },
      now: fixedNow,
    });
    await service.claim({
      subject: student,
      courseReleaseId: release.releaseId,
      bindingId: reporterBinding.bindingId,
      activeSessionId: reporterBinding.sessionId,
    });

    await expect(service.submitForReview({
      subject: student,
      binding: reporterBinding,
      sessionId: reporterBinding.sessionId,
      expectedEnrollmentStateVersion: 0,
      requestId: "request-incomplete-deliverable",
    })).rejects.toMatchObject({ code: "outcome_not_ready" });
  });

  it("rejects an authoritative review that cites evidence outside the frozen submission", async () => {
    const reviewed = outcomeSnapshot({
      stateVersion: 34,
      scenarioStatus: "completed",
      review: {
        reviewId: "review-xunpu-foreign-evidence",
        finalScore: 90,
        dimensions: [{
          dimensionId: "dimension-evidence",
          label: "证据覆盖",
          score: 45,
          maxScore: 50,
          feedback: "包含一个未在提交时冻结的证据引用。",
          evidenceRefs: ["evidence-foreign"],
        }],
        publicSummary: "等待因果引用校验。",
        finalizedAt: "2026-08-09T02:59:30.000Z",
      },
    });
    const read = vi.fn()
      .mockResolvedValueOnce(outcomeSnapshot())
      .mockResolvedValueOnce(reviewed);
    const service = new CourseLearningService({
      releases: [release],
      launches: [{
        releaseId: release.releaseId,
        sessionId: reporterBinding.sessionId,
        reporterActorId: reporterBinding.actorId,
      }],
      outcomeProjectionReader: { read },
      now: fixedNow,
    });
    await service.claim({
      subject: student,
      courseReleaseId: release.releaseId,
      bindingId: reporterBinding.bindingId,
      activeSessionId: reporterBinding.sessionId,
    });
    await service.submitForReview({
      subject: student,
      binding: reporterBinding,
      sessionId: reporterBinding.sessionId,
      expectedEnrollmentStateVersion: 0,
      requestId: "request-freeze-before-foreign-review",
    });
    const workspace = await service.getReviewWorkspace({
      subject: student,
      binding: reporterBinding,
      sessionId: reporterBinding.sessionId,
    });
    if (workspace.status !== "awaiting_review") {
      throw new Error("expected awaiting review workspace");
    }

    await expect(service.finalizeReview({
      subject: teacher,
      binding: teacherBinding,
      sessionId: reporterBinding.sessionId,
      reviewTaskId: workspace.submission.reviewTaskId,
      expectedEnrollmentStateVersion: 1,
      requestId: "request-foreign-review-evidence",
    })).rejects.toMatchObject({ code: "version_hash_drift" });
  });

  it("keeps two learners in one session independently selectable by server review task", async () => {
    const secondStudent: CourseLearningSubject = {
      principalId: "principal-student-v2-second",
      profileId: "student-team-a-second",
      role: "student",
    };
    const secondBinding: CourseLearningBinding = {
      ...reporterBinding,
      bindingId: "binding-student-v2-reporter-second",
    };
    let reviewed = false;
    const authoritativeReview = outcomeSnapshot({
      stateVersion: 35,
      scenarioStatus: "completed",
      review: {
        reviewId: "review-xunpu-multi-learner",
        finalScore: 92,
        dimensions: [{
          dimensionId: "dimension-evidence",
          label: "证据覆盖",
          score: 46,
          maxScore: 50,
          feedback: "冻结证据覆盖完整。",
          evidenceRefs: ["evidence-xunpu-1"],
        }],
        publicSummary: "完成指定学习者成果复核。",
        finalizedAt: "2026-08-09T02:59:30.000Z",
      },
    });
    const service = new CourseLearningService({
      releases: [release],
      launches: [{
        releaseId: release.releaseId,
        sessionId: reporterBinding.sessionId,
        reporterActorId: reporterBinding.actorId,
      }],
      outcomeProjectionReader: {
        read: vi.fn().mockImplementation(async () => (
          reviewed ? authoritativeReview : outcomeSnapshot()
        )),
      },
      now: fixedNow,
    });
    for (const [learner, learnerBinding] of [
      [student, reporterBinding],
      [secondStudent, secondBinding],
    ] as const) {
      await service.claim({
        subject: learner,
        courseReleaseId: release.releaseId,
        bindingId: learnerBinding.bindingId,
        activeSessionId: learnerBinding.sessionId,
      });
      await service.submitForReview({
        subject: learner,
        binding: learnerBinding,
        sessionId: learnerBinding.sessionId,
        expectedEnrollmentStateVersion: 0,
        requestId: `request-submit-${learner.principalId}`,
      });
    }

    const tasks = await service.listReviewTasks({
      subject: teacher,
      binding: teacherBinding,
      sessionId: reporterBinding.sessionId,
    });
    expect(tasks.items).toHaveLength(2);
    expect(new Set(tasks.items.map((item) => item.learnerRef)).size).toBe(2);
    reviewed = true;
    await service.finalizeReview({
      subject: teacher,
      binding: teacherBinding,
      sessionId: reporterBinding.sessionId,
      reviewTaskId: tasks.items[0]!.reviewTaskId,
      expectedEnrollmentStateVersion: 1,
      requestId: "request-review-first-learner",
    });

    const after = await service.listReviewTasks({
      subject: teacher,
      binding: teacherBinding,
      sessionId: reporterBinding.sessionId,
    });
    expect(after.items.map((item) => item.status).sort()).toEqual([
      "awaiting_review",
      "completed",
    ]);
    expect(await service.getReviewWorkspace({
      subject: teacher,
      binding: teacherBinding,
      sessionId: reporterBinding.sessionId,
      reviewTaskId: tasks.items[1]!.reviewTaskId,
    })).toMatchObject({ status: "awaiting_review" });
  });

  it("refuses premature, stale and non-teacher lifecycle writes", async () => {
    const read = vi.fn().mockResolvedValue(outcomeSnapshot({
      scenarioStatus: "running",
      currentChapterId: release.chapters[2]!.chapterId,
      completedChapterIds: release.chapters.slice(0, 2).map((chapter) => (
        chapter.chapterId
      )),
      submittedDeliverableIds: [],
      portfolioItems: [],
      evidence: [],
    }));
    const service = new CourseLearningService({
      releases: [release],
      outcomeProjectionReader: { read },
      now: fixedNow,
    });
    await service.claim({
      subject: student,
      courseReleaseId: release.releaseId,
      bindingId: reporterBinding.bindingId,
      activeSessionId: reporterBinding.sessionId,
    });

    await expect(service.submitForReview({
      subject: student,
      binding: reporterBinding,
      sessionId: reporterBinding.sessionId,
      expectedEnrollmentStateVersion: 9,
      requestId: "request-stale",
    })).rejects.toMatchObject({ code: "version_hash_drift" });
    await expect(service.submitForReview({
      subject: student,
      binding: reporterBinding,
      sessionId: reporterBinding.sessionId,
      expectedEnrollmentStateVersion: 0,
      requestId: "request-premature",
    })).rejects.toMatchObject({ code: "outcome_not_ready" });
    await expect(service.finalizeReview({
      subject: student,
      binding: reporterBinding,
      sessionId: reporterBinding.sessionId,
      reviewTaskId: "review-task-forbidden",
      expectedEnrollmentStateVersion: 0,
      requestId: "request-student-review",
    })).rejects.toMatchObject({ code: "access_denied" });
    expect((await service.listEnrollments({
      subject: student,
      bindings: [reporterBinding],
    }))[0]!.status).toBe("in_progress");
  });
});
