import Fastify from "fastify";
import { ZodError } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CourseReleaseSchema } from "@ronggang/contracts";
import { xunpuContractCourseRelease } from "@ronggang/course-content";
import {
  CourseLearningError,
  CourseLearningService,
  type CourseLearningBinding,
  type CourseLearningSubject,
} from "../src/course-learning.js";
import { registerCourseLearningRoutes } from "../src/course-learning-routes.js";

const release = CourseReleaseSchema.parse(xunpuContractCourseRelease);
const subject: CourseLearningSubject = {
  principalId: "principal-route-student",
  profileId: "student-unassigned",
  role: "student",
};
const binding: CourseLearningBinding = {
  bindingId: "binding-route-reporter",
  sessionId: "session-route-xunpu",
  actorId: "student-reporter",
  actorKind: "student",
  roleId: "reporter",
};
const teacherSubject: CourseLearningSubject = {
  principalId: "principal-route-teacher",
  profileId: "teacher-class-a",
  role: "teacher",
};
const teacherBinding: CourseLearningBinding = {
  bindingId: "binding-route-teacher",
  sessionId: binding.sessionId,
  actorId: "teacher-main",
  actorKind: "teacher",
  roleId: "teacher-director",
};

function routeOutcomeSnapshot(review = false) {
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
    evidenceIds: [`evidence-route-xunpu-${index + 1}`],
    updatedAt: "2026-08-09T03:58:00.000Z",
  }));
  return {
    stateVersion: review ? 41 : 40,
    scenarioStatus: review ? "completed" as const : "review" as const,
    currentChapterId: null,
    completedChapterIds: release.chapters.map((chapter) => chapter.chapterId),
    submittedDeliverableIds: release.chapters.flatMap((chapter) => (
      chapter.deliverableIds
    )),
    portfolioItems,
    evidence: portfolioItems.map((item, index) => ({
      evidenceId: item.evidenceIds[0]!,
      title: `${release.chapters[index]!.title}成果证据`,
      basis: "由服务端世界状态生成。",
      artifactRevisionRefs: [item.revisionId],
      createdAt: "2026-08-09T03:59:00.000Z",
    })),
    review: review
      ? {
          reviewId: "review-route-xunpu",
          finalScore: 90,
          dimensions: [{
            dimensionId: "dimension-route-evidence",
            label: "证据",
            score: 45,
            maxScore: 50,
            feedback: "证据充分。",
            evidenceRefs: ["evidence-route-xunpu-1"],
          }],
          publicSummary: "完成权威复核。",
          finalizedAt: "2026-08-09T03:59:30.000Z",
        }
      : null,
  };
}

async function createRouteApp() {
  const app = Fastify({ logger: false });
  const outcomeRead = vi.fn().mockResolvedValue(routeOutcomeSnapshot());
  const service = new CourseLearningService({
    releases: [release],
    launches: [{
      releaseId: release.releaseId,
      sessionId: binding.sessionId,
      reporterActorId: binding.actorId,
    }],
    projectionReader: {
      read: vi.fn().mockResolvedValue({
        stateVersion: 7,
        sceneId: "scene-route-xunpu",
        sourceEventId: "event-route-xunpu",
        chapterId: "xunpu-topic-brief",
      }),
    },
    outcomeProjectionReader: { read: outcomeRead },
    now: () => "2026-08-09T04:00:00.000Z",
  });
  const authorizePrincipal = vi.fn().mockResolvedValue({
    subject,
    bindings: [binding],
  });
  const authorizeLearning = vi.fn().mockImplementation(
    ({ bindingId }: { bindingId: string }) => Promise.resolve(
      bindingId === teacherBinding.bindingId
        ? { subject: teacherSubject, binding: teacherBinding }
        : { subject, binding },
    ),
  );
  const provisionReporterBinding = vi.fn().mockResolvedValue({
    bindingId: binding.bindingId,
    activeSessionId: binding.sessionId,
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      reply.status(400).send({ error: error.name });
      return;
    }
    if (error instanceof CourseLearningError) {
      const status = error.code === "course_not_found"
        ? 404
        : error.code === "access_denied"
          ? 403
          : 409;
      reply.status(status).send({ error: error.name, code: error.code });
      return;
    }
    reply.status(500).send({
      error: error instanceof Error ? error.name : "UnknownError",
    });
  });
  await registerCourseLearningRoutes(app, {
    service,
    authorizePrincipal,
    authorizeLearning,
    provisionReporterBinding,
  });
  return {
    app,
    authorizePrincipal,
    authorizeLearning,
    provisionReporterBinding,
    outcomeRead,
  };
}

const openedApps: Awaited<ReturnType<typeof createRouteApp>>["app"][] = [];

afterEach(async () => {
  await Promise.all(openedApps.splice(0).map((app) => app.close()));
});

describe("V2 course learning routes", () => {
  it("exposes a public compact catalog and strict full course detail", async () => {
    const context = await createRouteApp();
    openedApps.push(context.app);

    const catalog = await context.app.inject({
      method: "GET",
      url: "/api/courses",
    });
    const detail = await context.app.inject({
      method: "GET",
      url: `/api/courses/${release.courseId}`,
    });

    expect(catalog.statusCode).toBe(200);
    expect(catalog.json().courses).toEqual([expect.objectContaining({
      courseId: release.courseId,
      courseReleaseId: release.releaseId,
      chapterCount: 7,
    })]);
    expect(detail.statusCode).toBe(200);
    expect(detail.json().course).toMatchObject({
      schemaVersion: "course-release-detail/2.0.0",
      courseId: release.courseId,
      contentHash: release.contentHash,
    });
    expect(JSON.stringify(detail.json())).not.toMatch(
      /hiddenFactRefs|availableActionIds|dynamicEventIds|candidateAgentIds|teacherGateIds|scenarioReleaseRef/iu,
    );
    expect(context.authorizePrincipal).not.toHaveBeenCalled();
  });

  it("lists only the authorized principal enrollments", async () => {
    const context = await createRouteApp();
    openedApps.push(context.app);

    const response = await context.app.inject({
      method: "GET",
      url: "/api/me/course-enrollments",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ enrollments: [] });
    expect(context.authorizePrincipal).toHaveBeenCalledWith(
      expect.objectContaining({ mutation: false }),
    );
  });

  it("provisions one reporter binding and keeps duplicate claims idempotent", async () => {
    const context = await createRouteApp();
    openedApps.push(context.app);

    const first = await context.app.inject({
      method: "POST",
      url: "/api/course-enrollments",
      payload: { courseReleaseId: release.releaseId },
    });
    const second = await context.app.inject({
      method: "POST",
      url: "/api/course-enrollments",
      payload: { courseReleaseId: release.releaseId },
    });

    expect(first.statusCode).toBe(200);
    expect(first.json().enrollment).toMatchObject({
      status: "in_progress",
      bindingId: binding.bindingId,
      activeSessionId: binding.sessionId,
      primaryRoleId: "reporter",
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().enrollment.enrollmentId)
      .toBe(first.json().enrollment.enrollmentId);
    expect(context.provisionReporterBinding).toHaveBeenCalledTimes(1);
  });

  it("returns the active DTO and rejects forged query data before authorization", async () => {
    const context = await createRouteApp();
    openedApps.push(context.app);
    await context.app.inject({
      method: "POST",
      url: "/api/course-enrollments",
      payload: { courseReleaseId: release.releaseId },
    });

    const active = await context.app.inject({
      method: "GET",
      url: `/api/sessions/${binding.sessionId}/learning-activity?bindingId=${binding.bindingId}`,
    });
    context.authorizeLearning.mockClear();
    const forged = await context.app.inject({
      method: "GET",
      url: `/api/sessions/${binding.sessionId}/learning-activity?bindingId=${binding.bindingId}&actorId=teacher-main`,
    });

    expect(active.statusCode).toBe(200);
    expect(active.json().activity).toMatchObject({
      status: "active",
      currentTask: { chapterId: "xunpu-topic-brief" },
      primaryAction: { actionId: "continue_task" },
    });
    expect(forged.statusCode).toBe(400);
    expect(context.authorizeLearning).not.toHaveBeenCalled();
  });

  it("rejects actor claims in the enrollment body before authorization", async () => {
    const context = await createRouteApp();
    openedApps.push(context.app);

    const forged = await context.app.inject({
      method: "POST",
      url: "/api/course-enrollments",
      payload: {
        courseReleaseId: release.releaseId,
        actorId: "student-editor",
      },
    });

    expect(forged.statusCode).toBe(400);
    expect(context.authorizePrincipal).not.toHaveBeenCalled();
    expect(context.provisionReporterBinding).not.toHaveBeenCalled();
  });

  it("exposes strict progress, portfolio and authoritative review lifecycle routes", async () => {
    const context = await createRouteApp();
    openedApps.push(context.app);
    await context.app.inject({
      method: "POST",
      url: "/api/course-enrollments",
      payload: { courseReleaseId: release.releaseId },
    });

    const progress = await context.app.inject({
      method: "GET",
      url: "/api/me/course-progress",
    });
    const portfolio = await context.app.inject({
      method: "GET",
      url: "/api/me/portfolio",
    });
    const before = await context.app.inject({
      method: "GET",
      url: `/api/sessions/${binding.sessionId}/course-review?bindingId=${binding.bindingId}`,
    });
    expect(progress.statusCode).toBe(200);
    expect(progress.json().progress.items[0]).toMatchObject({
      reviewStatus: "not_submitted",
      portfolioItemCount: release.chapters.length,
      evidenceCount: release.chapters.length,
    });
    expect(portfolio.statusCode).toBe(200);
    expect(portfolio.json().portfolio.items).toHaveLength(
      release.chapters.length,
    );
    expect(before.json().review).toMatchObject({
      viewer: "student",
      status: "not_submitted",
    });

    const submitted = await context.app.inject({
      method: "POST",
      url: `/api/sessions/${binding.sessionId}/course-submissions`,
      payload: {
        bindingId: binding.bindingId,
        expectedEnrollmentStateVersion: 0,
        requestId: "request-route-submit",
      },
    });
    expect(submitted.statusCode).toBe(200);
    expect(submitted.json().receipt).toEqual(expect.objectContaining({
      status: "awaiting_review",
      stateVersion: 1,
    }));
    expect(context.authorizeLearning).toHaveBeenLastCalledWith(
      expect.objectContaining({ mutation: true }),
    );

    const reviewTasks = await context.app.inject({
      method: "GET",
      url: `/api/sessions/${binding.sessionId}/course-review-tasks?bindingId=${teacherBinding.bindingId}`,
    });
    expect(reviewTasks.statusCode).toBe(200);
    expect(reviewTasks.json().tasks.items).toHaveLength(1);
    expect(reviewTasks.json().tasks.items[0]).not.toHaveProperty("principalId");
    const reviewWorkspace = await context.app.inject({
      method: "GET",
      url: `/api/sessions/${binding.sessionId}/course-review?bindingId=${binding.bindingId}`,
    });
    expect(reviewWorkspace.statusCode).toBe(200);
    const reviewTaskId = reviewTasks.json().tasks.items[0].reviewTaskId;
    context.outcomeRead.mockResolvedValueOnce(routeOutcomeSnapshot(true));
    const finalized = await context.app.inject({
      method: "POST",
      url: `/api/sessions/${binding.sessionId}/course-reviews`,
      payload: {
        bindingId: teacherBinding.bindingId,
        reviewTaskId,
        expectedEnrollmentStateVersion: 1,
        requestId: "request-route-review",
      },
    });
    expect(finalized.statusCode).toBe(200);
    expect(finalized.json().receipt).toEqual(expect.objectContaining({
      status: "completed",
      stateVersion: 2,
    }));
    expect(JSON.stringify(finalized.json())).not.toMatch(
      /artifactId|evidenceId|finalScore|actorId|trace|provider|prompt/iu,
    );
  });

  it("rejects forged outcome fields before authorization or projection reads", async () => {
    const context = await createRouteApp();
    openedApps.push(context.app);
    context.authorizeLearning.mockClear();
    context.outcomeRead.mockClear();

    const forged = await context.app.inject({
      method: "POST",
      url: `/api/sessions/${binding.sessionId}/course-submissions`,
      payload: {
        bindingId: binding.bindingId,
        expectedEnrollmentStateVersion: 0,
        requestId: "request-route-forged",
        artifactIds: ["artifact-browser"],
        evidenceIds: ["evidence-browser"],
        finalScore: 100,
      },
    });

    expect(forged.statusCode).toBe(400);
    expect(context.authorizeLearning).not.toHaveBeenCalled();
    expect(context.outcomeRead).not.toHaveBeenCalled();
  });
});
