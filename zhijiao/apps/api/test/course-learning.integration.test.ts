import type { FastifyInstance } from "fastify";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CourseReleaseSchema, type RoleBinding } from "@ronggang/contracts";
import {
  hashCanonical,
  xunpuContractCourseRelease,
  xunpuFlagshipContentManifestV3,
} from "@ronggang/course-content";
import {
  InMemoryEventStore,
  InProcessMessageBus,
  WorldEngine,
  demoScenario,
  demoScenarioV100ContentHash,
} from "@ronggang/world-core";
import type { DemoAuthContext } from "../src/identity.js";
import { createApp, createMemoryTestApp, DEMO_SESSION_ID } from "../src/server.js";

const localOrigin = "http://localhost:5173";

function boundCourseRelease() {
  const { contentHash: _contentHash, ...courseDraft } = structuredClone(
    xunpuContractCourseRelease,
  );
  const reboundDraft = {
    ...courseDraft,
    scenarioReleaseRef: {
      scenarioId: demoScenario.scenarioId,
      version: demoScenario.version,
      contentHash: demoScenarioV100ContentHash,
    },
  };
  return CourseReleaseSchema.parse({
    ...reboundDraft,
    contentHash: hashCanonical(reboundDraft),
  });
}

async function createV2App(input: {
  release?: ReturnType<typeof boundCourseRelease>;
  launch?: boolean;
} = {}) {
  const release = input.release ?? boundCourseRelease();
  const engine = new WorldEngine({
    store: new InMemoryEventStore(),
    bus: new InProcessMessageBus(),
    scenario: structuredClone(demoScenario),
  });
  const opening = createMemoryTestApp({
    engine,
    initializeSecondaryDemo: false,
    courseReleases: [release],
    courseLaunches: input.launch === false
      ? []
      : [{
          releaseId: release.releaseId,
          sessionId: DEMO_SESSION_ID,
          reporterActorId: "student-reporter",
        }],
  });
  openingApps.add(opening);
  const app = await opening;
  return { app, engine, release };
}

async function loginProfile(
  app: FastifyInstance,
  profileId: string,
  sessionId?: string,
): Promise<{
  cookie: string;
  csrfToken: string;
  bindings: RoleBinding[];
}> {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/demo-session",
    headers: { origin: localOrigin },
    payload: {
      profileId,
      ...(sessionId ? { sessionId } : {}),
    },
  });
  expect(response.statusCode).toBe(200);
  const context = response.json() as DemoAuthContext;
  const setCookie = Array.isArray(response.headers["set-cookie"])
    ? response.headers["set-cookie"][0]
    : response.headers["set-cookie"];
  if (!setCookie) throw new Error("V2 test login did not set a cookie");
  return {
    cookie: setCookie.split(";")[0]!,
    csrfToken: context.csrfToken,
    bindings: context.bindings,
  };
}

const openedApps: FastifyInstance[] = [];
const openingApps = new Set<Promise<FastifyInstance>>();
const temporaryDataDirs: string[] = [];

afterEach(async () => {
  const started = await Promise.allSettled(openingApps);
  openingApps.clear();
  const opened = new Set([...openedApps.splice(0), ...started.flatMap(result => result.status === "fulfilled" ? [result.value] : [])]);
  await Promise.all([...opened].map((app) => app.close()));
  for (const dataDir of temporaryDataDirs.splice(0)) {
    if (!resolve(dataDir).startsWith(`${resolve(tmpdir())}${sep}ganglian-course-projection-`)) throw new Error("unexpected fixture path");
    await rm(dataDir, { recursive: true, force: true });
  }
});

describe("V2 course enrollment server integration", () => {
  it("projects actual flagship work into course progress and portfolio and follows a new draft", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "ganglian-course-projection-"));
    temporaryDataDirs.push(dataDir);
    const opening = createApp({ dataDir, initializeSecondaryDemo: true });
    openingApps.add(opening);
    const app = await opening;
    openedApps.push(app);
    const learner = await loginProfile(app, "student-unassigned");
    const catalog = (await app.inject({ method: "GET", url: "/api/courses" })).json().courses;
    const course = catalog.find((item: { courseId: string }) => item.courseId === "course-xunpu-intangible-media");
    const headers = { origin: localOrigin, cookie: learner.cookie, "x-csrf-token": learner.csrfToken };
    const claimed = await app.inject({ method: "POST", url: "/api/course-enrollments", headers, payload: { courseReleaseId: course.courseReleaseId } });
    expect(claimed.statusCode, claimed.body).toBe(200);
    const enrollment = claimed.json().enrollment;
    expect(enrollment.activeSessionId).toBe("demo-xunpu-v2");
    const initialProgress = await app.inject({ method: "GET", url: "/api/me/course-progress", headers });
    expect(initialProgress.statusCode, initialProgress.body).toBe(200);
    expect(initialProgress.json().progress.items[0].completedChapterIds).toEqual([]);
    const base = `/api/v3/sessions/${enrollment.activeSessionId}/workspace`;
    const workspaceResponse = await app.inject({ method: "GET", url: `${base}?bindingId=${enrollment.bindingId}`, headers });
    expect(workspaceResponse.statusCode, workspaceResponse.body).toBe(200);
    const workspace = workspaceResponse.json().workspace;
    const definition = xunpuFlagshipContentManifestV3.artifacts.find((item) => item.artifactId === "artifact-topic-brief")!;
    const payload = {
      bindingId: enrollment.bindingId, requestId: "portfolio-actual-save-1", expectedRevisionNumber: 0,
      fields: definition.editableFields.map((field) => ({ fieldId: field.fieldId, content: "本报道区分游客叙事与居民日常，逐项核验公开来源，保留受访者撤回同意的选择。".repeat(20).slice(0, field.minimumLength + 10) })),
      evidenceRefs: workspace.evidenceCatalog.slice(0, 2).map((item: { evidenceRef: string }) => item.evidenceRef), revisionNote: "第一版有依据的选题草稿。",
    };
    const saved = await app.inject({ method: "POST", url: `${base}/artifacts/${definition.artifactId}/revisions`, headers, payload });
    expect(saved.statusCode, saved.body).toBe(200);
    const revision = saved.json().workspace.artifacts.find((item: { artifactId: string }) => item.artifactId === definition.artifactId).latestRevision;
    const readPortfolio = async () => {
      const result = await app.inject({ method: "GET", url: "/api/me/portfolio", headers });
      expect(result.statusCode, result.body).toBe(200);
      return result.json().portfolio;
    };
    const draft = await readPortfolio();
    expect(draft.items).toHaveLength(1);
    expect(draft.items[0]).toMatchObject({ revisionId: revision.revisionId, contentHash: revision.contentHash, status: "draft" });
    const submitted = await app.inject({ method: "POST", url: `${base}/artifacts/${definition.artifactId}/submit`, headers, payload: { bindingId: enrollment.bindingId, requestId: "portfolio-actual-submit-1", revisionId: revision.revisionId, contentHash: revision.contentHash } });
    expect(submitted.statusCode, submitted.body).toBe(200);
    const progress = await app.inject({ method: "GET", url: "/api/me/course-progress", headers });
    expect(progress.statusCode, progress.body).toBe(200);
    expect(progress.json().progress.items[0]).toMatchObject({ completedChapterIds: ["xunpu-topic-brief"], portfolioItemCount: 1 });
    const activity = await app.inject({ method: "GET", url: `/api/sessions/${enrollment.activeSessionId}/learning-activity?bindingId=${enrollment.bindingId}`, headers });
    expect(activity.statusCode, activity.body).toBe(200);
    expect(activity.json().activity.currentTask.chapterId).toBe("xunpu-source-map");
    const second = await app.inject({ method: "POST", url: `${base}/artifacts/${definition.artifactId}/revisions`, headers, payload: { ...payload, fields: payload.fields.map((field) => ({ ...field, content: `${field.content}新增的社区居民视角需进一步核验。` })), requestId: "portfolio-actual-save-2", expectedRevisionNumber: 1 } });
    expect(second.statusCode, second.body).toBe(200);
    const revised = await readPortfolio();
    expect(revised.items).toHaveLength(1);
    expect(revised.items[0]).toMatchObject({ status: "draft", revisionNumber: 2 });
    expect((await app.inject({ method: "GET", url: "/api/me/course-progress", headers })).json().progress.items[0].completedChapterIds).toEqual([]);
    await app.close();
    openedApps.splice(openedApps.indexOf(app), 1);
    const reopening = createApp({ dataDir, initializeSecondaryDemo: true });
    openingApps.add(reopening);
    const restarted = await reopening;
    openedApps.push(restarted);
    const restoredLogin = await loginProfile(restarted, "student-unassigned");
    const restored = await restarted.inject({ method: "GET", url: "/api/me/portfolio", headers: { cookie: restoredLogin.cookie } });
    expect(restored.statusCode, restored.body).toBe(200);
    expect(restored.json().portfolio.items).toEqual(revised.items);
  }, 30_000);

  it("lets an unassigned learner authenticate with zero bindings before claim", async () => {
    const { app, release } = await createV2App({ launch: false });
    openedApps.push(app);
    const learner = await loginProfile(app, "student-unassigned");

    expect(learner.bindings).toEqual([]);
    const enrollments = await app.inject({
      method: "GET",
      url: "/api/me/course-enrollments",
      headers: { cookie: learner.cookie },
    });
    const catalog = await app.inject({ method: "GET", url: "/api/courses" });

    expect(enrollments.statusCode).toBe(200);
    expect(enrollments.json()).toEqual({ enrollments: [] });
    expect(catalog.statusCode).toBe(200);
    expect(catalog.json().courses).toEqual([expect.objectContaining({
      courseId: release.courseId,
      courseReleaseId: release.releaseId,
    })]);
  });

  it("keeps the bundled Xunpu course ready until its exact scenario release exists", async () => {
    const engine = new WorldEngine({
      store: new InMemoryEventStore(),
      bus: new InProcessMessageBus(),
      scenario: structuredClone(demoScenario),
    });
    const app = await createMemoryTestApp({
      engine,
      initializeSecondaryDemo: false,
    });
    openedApps.push(app);
    const learner = await loginProfile(app, "student-unassigned");
    const catalog = await app.inject({ method: "GET", url: "/api/courses" });
    const bundledRelease = catalog.json().courses.find((course: {
      courseId: string;
    }) => course.courseId === "course-xunpu-intangible-media");
    expect(bundledRelease).toBeDefined();

    const claim = await app.inject({
      method: "POST",
      url: "/api/course-enrollments",
      headers: {
        origin: localOrigin,
        cookie: learner.cookie,
        "x-csrf-token": learner.csrfToken,
      },
      payload: { courseReleaseId: bundledRelease.courseReleaseId },
    });

    expect(claim.statusCode).toBe(200);
    expect(claim.json().enrollment).toMatchObject({
      status: "claimed",
      activeSessionId: null,
      primaryRoleId: "reporter",
      courseReleaseRef: {
        courseId: "course-xunpu-intangible-media",
      },
    });
    expect(claim.json().enrollment.bindingId).toContain(":pending");
  });

  it("creates exactly one reporter binding and returns an active activity", async () => {
    const { app, release } = await createV2App();
    openedApps.push(app);
    const learner = await loginProfile(app, "student-unassigned");

    const first = await app.inject({
      method: "POST",
      url: "/api/course-enrollments",
      headers: {
        origin: localOrigin,
        cookie: learner.cookie,
        "x-csrf-token": learner.csrfToken,
      },
      payload: { courseReleaseId: release.releaseId },
    });
    const second = await app.inject({
      method: "POST",
      url: "/api/course-enrollments",
      headers: {
        origin: localOrigin,
        cookie: learner.cookie,
        "x-csrf-token": learner.csrfToken,
      },
      payload: { courseReleaseId: release.releaseId },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    const enrollment = first.json().enrollment;
    expect(enrollment).toMatchObject({
      status: "in_progress",
      primaryRoleId: "reporter",
      activeSessionId: DEMO_SESSION_ID,
    });
    expect(second.json().enrollment.enrollmentId).toBe(enrollment.enrollmentId);

    const activity = await app.inject({
      method: "GET",
      url: `/api/sessions/${DEMO_SESSION_ID}/learning-activity?bindingId=${enrollment.bindingId}`,
      headers: { cookie: learner.cookie },
    });
    expect(activity.statusCode).toBe(200);
    expect(activity.json().activity).toMatchObject({
      status: "active",
      currentTask: { chapterId: "xunpu-topic-brief" },
      primaryAction: { actionId: "continue_task" },
    });

    const relogin = await loginProfile(
      app,
      "student-unassigned",
      DEMO_SESSION_ID,
    );
    expect(relogin.bindings).toHaveLength(1);
    expect(relogin.bindings[0]).toMatchObject({
      actorKind: "student",
      roleId: "reporter",
      actorId: "student-reporter",
    });
  });

  it("starts a course session only with an exact immutable course release reference", async () => {
    const { app, release } = await createV2App({ launch: false });
    openedApps.push(app);
    const teacher = await loginProfile(
      app,
      "teacher-class-a",
      DEMO_SESSION_ID,
    );
    const teacherBinding = teacher.bindings.find((binding) => (
      binding.actorKind === "teacher"
    ));
    if (!teacherBinding) throw new Error("teacher login lacks binding");
    const scenario = await app.inject({
      method: "GET",
      url: "/api/scenario/demo",
    });
    expect(scenario.statusCode).toBe(200);
    const scenarioReleaseId = scenario.json().release.releaseId as string;
    const courseReleaseRef = {
      courseId: release.courseId,
      releaseId: release.releaseId,
      version: release.version,
      contentHash: release.contentHash,
    };
    const payload = {
      authorizationSessionId: DEMO_SESSION_ID,
      bindingId: teacherBinding.bindingId,
      requestId: "request-v2-course-start-001",
      classroomId: "classroom-local-tourism-a",
      teamId: "team-local-tourism-a",
      releaseId: scenarioReleaseId,
      courseReleaseRef,
    };

    const drift = await app.inject({
      method: "POST",
      url: "/api/training-sessions",
      headers: {
        origin: localOrigin,
        cookie: teacher.cookie,
        "x-csrf-token": teacher.csrfToken,
      },
      payload: {
        ...payload,
        requestId: "request-v2-course-start-drift",
        courseReleaseRef: {
          ...courseReleaseRef,
          contentHash: "f".repeat(64),
        },
      },
    });
    expect(drift.statusCode).toBe(409);
    expect(drift.json()).toMatchObject({ code: "version_hash_drift" });

    const started = await app.inject({
      method: "POST",
      url: "/api/training-sessions",
      headers: {
        origin: localOrigin,
        cookie: teacher.cookie,
        "x-csrf-token": teacher.csrfToken,
      },
      payload,
    });
    expect(started.statusCode).toBe(200);
    expect(started.json()).toMatchObject({
      status: "active",
      courseReleaseRef,
    });

    const incompatibleReplay = await app.inject({
      method: "POST",
      url: "/api/training-sessions",
      headers: {
        origin: localOrigin,
        cookie: teacher.cookie,
        "x-csrf-token": teacher.csrfToken,
      },
      payload: {
        authorizationSessionId: payload.authorizationSessionId,
        bindingId: payload.bindingId,
        requestId: payload.requestId,
        classroomId: payload.classroomId,
        teamId: payload.teamId,
        releaseId: payload.releaseId,
      },
    });
    expect(incompatibleReplay.statusCode).toBe(409);
    expect(incompatibleReplay.json()).toMatchObject({
      code: "idempotency_conflict",
    });

    const learner = await loginProfile(app, "student-unassigned");
    const claim = await app.inject({
      method: "POST",
      url: "/api/course-enrollments",
      headers: {
        origin: localOrigin,
        cookie: learner.cookie,
        "x-csrf-token": learner.csrfToken,
      },
      payload: { courseReleaseId: release.releaseId },
    });
    expect(claim.statusCode).toBe(200);
    expect(claim.json().enrollment).toMatchObject({
      status: "in_progress",
      activeSessionId: started.json().sessionId,
      primaryRoleId: "reporter",
    });
  });

  it("returns empty before projection/event work for a bound but unenrolled reporter", async () => {
    const { app, engine } = await createV2App();
    openedApps.push(app);
    const learner = await loginProfile(
      app,
      "student-team-a",
      DEMO_SESSION_ID,
    );
    const reporter = learner.bindings.find((binding) => (
      binding.actorKind === "student" && binding.roleId === "reporter"
    ));
    if (!reporter) throw new Error("seeded learner lacks reporter binding");
    const projectionSpy = vi.spyOn(engine, "getProjection");
    projectionSpy.mockClear();

    const response = await app.inject({
      method: "GET",
      url: `/api/sessions/${DEMO_SESSION_ID}/learning-activity?bindingId=${reporter.bindingId}`,
      headers: { cookie: learner.cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().activity).toMatchObject({
      status: "empty",
      currentTask: null,
      enrollment: null,
    });
    expect(projectionSpy).not.toHaveBeenCalled();
  });

  it("rejects teacher claims and scenario hash drift without creating a student binding", async () => {
    const drifted = boundCourseRelease();
    drifted.scenarioReleaseRef.contentHash = "f".repeat(64);
    const { contentHash: _oldHash, ...driftedDraft } = drifted;
    drifted.contentHash = hashCanonical(driftedDraft);
    const { app, release } = await createV2App({ release: drifted });
    openedApps.push(app);
    const teacher = await loginProfile(
      app,
      "teacher-class-a",
      DEMO_SESSION_ID,
    );
    const teacherClaim = await app.inject({
      method: "POST",
      url: "/api/course-enrollments",
      headers: {
        origin: localOrigin,
        cookie: teacher.cookie,
        "x-csrf-token": teacher.csrfToken,
      },
      payload: { courseReleaseId: release.releaseId },
    });
    expect(teacherClaim.statusCode).toBe(403);

    const learner = await loginProfile(app, "student-unassigned");
    const drift = await app.inject({
      method: "POST",
      url: "/api/course-enrollments",
      headers: {
        origin: localOrigin,
        cookie: learner.cookie,
        "x-csrf-token": learner.csrfToken,
      },
      payload: { courseReleaseId: release.releaseId },
    });
    expect(drift.statusCode).toBe(409);
    expect(drift.json()).toMatchObject({
      code: "version_hash_drift",
    });
  });
});
