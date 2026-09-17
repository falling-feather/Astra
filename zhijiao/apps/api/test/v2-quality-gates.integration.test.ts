import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CourseReleaseSchema,
  type RoleBinding,
} from "@ronggang/contracts";
import {
  hashCanonical,
  xunpuContractCourseRelease,
} from "@ronggang/course-content";
import {
  InMemoryEventStore,
  InProcessMessageBus,
  WorldEngine,
  demoScenario,
  demoScenarioV100ContentHash,
} from "@ronggang/world-core";
import type { DemoAuthContext } from "../src/identity.js";
import {
  createApp,
  createMemoryTestApp,
  DEMO_SESSION_ID,
  DEMO_XUNPU_SESSION_ID,
} from "../src/server.js";

const localOrigin = "http://localhost:5173";
const openedApps: FastifyInstance[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(openedApps.splice(0).map((app) => app.close()));
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

function boundCourseRelease(input: {
  scenarioVersion?: string;
  scenarioHash?: string;
} = {}) {
  const { contentHash: _contentHash, ...courseDraft } = structuredClone(
    xunpuContractCourseRelease,
  );
  const reboundDraft = {
    ...courseDraft,
    scenarioReleaseRef: {
      scenarioId: demoScenario.scenarioId,
      version: input.scenarioVersion ?? demoScenario.version,
      contentHash: input.scenarioHash ?? demoScenarioV100ContentHash,
    },
  };
  return CourseReleaseSchema.parse({
    ...reboundDraft,
    contentHash: hashCanonical(reboundDraft),
  });
}

async function createBoundMemoryApp(release = boundCourseRelease()) {
  const engine = new WorldEngine({
    store: new InMemoryEventStore(),
    bus: new InProcessMessageBus(),
    scenario: structuredClone(demoScenario),
  });
  const app = await createMemoryTestApp({
    engine,
    initializeSecondaryDemo: false,
    courseReleases: [release],
    courseLaunches: [{
      releaseId: release.releaseId,
      sessionId: DEMO_SESSION_ID,
      reporterActorId: "student-reporter",
    }],
  });
  openedApps.push(app);
  return { app, engine, release };
}

async function createDefaultApp() {
  const dataDir = await mkdtemp(join(tmpdir(), "ronggang-qa-v2-api-"));
  temporaryDirectories.push(dataDir);
  const app = await createApp({
    dataDir,
    logger: false,
    initializeSecondaryDemo: false,
    awaitStartupRecovery: true,
    environment: {
      NODE_ENV: "test",
      IFLYTEK_MODE: "mock",
      DEEPSEEK_MODE: "mock",
    },
  });
  openedApps.push(app);
  return app;
}

async function login(
  app: FastifyInstance,
  profileId: string,
  sessionId?: string,
): Promise<{
  auth: DemoAuthContext;
  cookie: string;
}> {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/demo-session",
    headers: { origin: localOrigin },
    payload: { profileId, ...(sessionId ? { sessionId } : {}) },
  });
  expect(response.statusCode).toBe(200);
  const setCookie = Array.isArray(response.headers["set-cookie"])
    ? response.headers["set-cookie"][0]
    : response.headers["set-cookie"];
  if (!setCookie) throw new Error("QA V2 login did not set a cookie");
  return {
    auth: response.json() as DemoAuthContext,
    cookie: setCookie.split(";")[0]!,
  };
}

function bindingFor(
  bindings: readonly RoleBinding[],
  actorKind: "student" | "teacher",
  sessionId: string,
  roleId?: string,
): RoleBinding {
  const binding = bindings.find((candidate) => (
    candidate.actorKind === actorKind
      && candidate.sessionId === sessionId
      && (roleId === undefined || candidate.roleId === roleId)
  ));
  if (!binding) throw new Error(`QA V2 ${actorKind} binding missing`);
  return binding;
}

describe("QA-005 V2 API quality gates", () => {
  it("returns an empty activity without projection work for an unenrolled reporter", async () => {
    const { app, engine } = await createBoundMemoryApp();
    const learner = await login(app, "student-team-a", DEMO_SESSION_ID);
    const reporter = bindingFor(
      learner.auth.bindings,
      "student",
      DEMO_SESSION_ID,
      "reporter",
    );
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
      enrollment: null,
      currentTask: null,
    });
    expect(projectionSpy).not.toHaveBeenCalled();
  });

  it.each([
    ["scenario version", { scenarioVersion: "9.9.9" }],
    ["scenario hash", { scenarioHash: "f".repeat(64) }],
  ] as const)("fails closed on %s drift before creating a reporter enrollment", async (_label, drift) => {
    const { app, release } = await createBoundMemoryApp(
      boundCourseRelease(drift),
    );
    const learner = await login(app, "student-unassigned");
    const response = await app.inject({
      method: "POST",
      url: "/api/course-enrollments",
      headers: {
        origin: localOrigin,
        cookie: learner.cookie,
        "x-csrf-token": learner.auth.csrfToken,
      },
      payload: { courseReleaseId: release.releaseId },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "version_hash_drift" });
    const enrollments = await app.inject({
      method: "GET",
      url: "/api/me/course-enrollments",
      headers: { cookie: learner.cookie },
    });
    expect(enrollments.json()).toEqual({ enrollments: [] });
  });

  it("enforces strict role surfaces, safe audience DTOs and read-only Episodes", async () => {
    const app = await createDefaultApp();
    const learner = await login(app, "student-unassigned");
    expect(learner.auth.bindings).toEqual([]);
    expect(Date.parse(learner.auth.expiresAt)).toBeGreaterThan(Date.now());

    const empty = await app.inject({
      method: "GET",
      url: "/api/me/course-enrollments",
      headers: { cookie: learner.cookie },
    });
    expect(empty.json()).toEqual({ enrollments: [] });

    const catalog = await app.inject({ method: "GET", url: "/api/courses" });
    const course = catalog.json().courses.find((candidate: {
      courseId: string;
    }) => candidate.courseId === "course-xunpu-intangible-media");
    expect(course).toBeTruthy();

    const forgedBody = await app.inject({
      method: "POST",
      url: "/api/course-enrollments",
      headers: {
        origin: localOrigin,
        cookie: learner.cookie,
        "x-csrf-token": learner.auth.csrfToken,
      },
      payload: {
        courseReleaseId: course.courseReleaseId,
        requestedRoleId: "responsible_editor",
      },
    });
    expect(forgedBody.statusCode).toBe(400);
    const forgedQuery = await app.inject({
      method: "POST",
      url: "/api/course-enrollments?actorKind=student",
      headers: {
        origin: localOrigin,
        cookie: learner.cookie,
        "x-csrf-token": learner.auth.csrfToken,
      },
      payload: { courseReleaseId: course.courseReleaseId },
    });
    expect(forgedQuery.statusCode).toBe(400);

    const teacher = await login(
      app,
      "teacher-class-a",
      DEMO_XUNPU_SESSION_ID,
    );
    const teacherClaim = await app.inject({
      method: "POST",
      url: "/api/course-enrollments",
      headers: {
        origin: localOrigin,
        cookie: teacher.cookie,
        "x-csrf-token": teacher.auth.csrfToken,
      },
      payload: { courseReleaseId: course.courseReleaseId },
    });
    expect(teacherClaim.statusCode).toBe(403);

    const claim = await app.inject({
      method: "POST",
      url: "/api/course-enrollments",
      headers: {
        origin: localOrigin,
        cookie: learner.cookie,
        "x-csrf-token": learner.auth.csrfToken,
      },
      payload: { courseReleaseId: course.courseReleaseId },
    });
    expect(claim.statusCode).toBe(200);
    expect(claim.json().enrollment).toMatchObject({
      primaryRoleId: "reporter",
      activeSessionId: DEMO_XUNPU_SESSION_ID,
    });
    const reporterBindingId = claim.json().enrollment.bindingId as string;
    const teacherBinding = bindingFor(
      teacher.auth.bindings,
      "teacher",
      DEMO_XUNPU_SESSION_ID,
    );
    const operator = await login(
      app,
      "operator-demo",
      DEMO_XUNPU_SESSION_ID,
    );
    const operatorBinding = bindingFor(
      operator.auth.bindings,
      "teacher",
      DEMO_XUNPU_SESSION_ID,
    );

    const forgedContext = await app.inject({
      method: "GET",
      url: `/api/sessions/${DEMO_XUNPU_SESSION_ID}/student-training-context?bindingId=${reporterBindingId}&actorKind=student`,
      headers: { cookie: learner.cookie },
    });
    expect(forgedContext.statusCode).toBe(400);
    const broadStudentProjection = await app.inject({
      method: "GET",
      url: `/api/sessions/${DEMO_XUNPU_SESSION_ID}/projection?bindingId=${reporterBindingId}`,
      headers: { cookie: learner.cookie },
    });
    expect(broadStudentProjection.statusCode).toBe(403);

    for (const denied of [learner, teacher]) {
      const response = await app.inject({
        method: "GET",
        url: "/api/admin/agent-topology",
        headers: { cookie: denied.cookie },
      });
      expect(response.statusCode).toBe(403);
    }
    const topology = await app.inject({
      method: "GET",
      url: "/api/admin/agent-topology",
      headers: { cookie: operator.cookie },
    });
    expect(topology.statusCode).toBe(200);
    expect(topology.json().groups).toHaveLength(6);
    expect(topology.json().agents).toHaveLength(14);

    const projectionBefore = await app.inject({
      method: "GET",
      url: `/api/sessions/${DEMO_XUNPU_SESSION_ID}/projection?bindingId=${operatorBinding.bindingId}`,
      headers: { cookie: operator.cookie },
    });
    const traceBefore = await app.inject({
      method: "GET",
      url: `/api/sessions/${DEMO_XUNPU_SESSION_ID}/trace-page?bindingId=${operatorBinding.bindingId}&limit=200`,
      headers: { cookie: operator.cookie },
    });
    expect(projectionBefore.statusCode).toBe(200);
    expect(traceBefore.statusCode).toBe(200);

    const studentEpisode = await app.inject({
      method: "GET",
      url: `/api/sessions/${DEMO_XUNPU_SESSION_ID}/collaboration-episode?bindingId=${reporterBindingId}`,
      headers: { cookie: learner.cookie },
    });
    const teacherEpisode = await app.inject({
      method: "GET",
      url: `/api/sessions/${DEMO_XUNPU_SESSION_ID}/collaboration-episode?bindingId=${teacherBinding.bindingId}`,
      headers: { cookie: teacher.cookie },
    });
    const adminEpisode = await app.inject({
      method: "GET",
      url: `/api/sessions/${DEMO_XUNPU_SESSION_ID}/collaboration-episode?bindingId=${operatorBinding.bindingId}`,
      headers: { cookie: operator.cookie },
    });
    expect(studentEpisode.json().audience).toBe("student");
    expect(teacherEpisode.json().audience).toBe("teacher");
    expect(adminEpisode.json().audience).toBe("admin");

    const ordinaryDto = JSON.stringify({
      student: studentEpisode.json(),
      teacher: teacherEpisode.json(),
    });
    for (const forbidden of [
      "candidateId",
      "sourceChoiceRef",
      "technicalTrace",
      "traceRefs",
      "providerId",
      "prompt",
      "privateMemory",
      "tokenBudget",
    ]) {
      expect(ordinaryDto).not.toContain(`\"${forbidden}\"`);
    }

    const projectionAfter = await app.inject({
      method: "GET",
      url: `/api/sessions/${DEMO_XUNPU_SESSION_ID}/projection?bindingId=${operatorBinding.bindingId}`,
      headers: { cookie: operator.cookie },
    });
    const traceAfter = await app.inject({
      method: "GET",
      url: `/api/sessions/${DEMO_XUNPU_SESSION_ID}/trace-page?bindingId=${operatorBinding.bindingId}&limit=200`,
      headers: { cookie: operator.cookie },
    });
    expect(projectionAfter.json().stateVersion)
      .toBe(projectionBefore.json().stateVersion);
    expect(traceAfter.json().records).toEqual(traceBefore.json().records);
    expect(traceAfter.json().links).toEqual(traceBefore.json().links);
  }, 60_000);
});
