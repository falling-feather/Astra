import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import type { RoleBinding } from "@ronggang/contracts";
import {
  InMemoryEventStore,
  InProcessMessageBus,
  WorldEngine,
  demoScenario,
} from "@ronggang/world-core";
import type { DemoAuthContext } from "../src/identity.js";
import { createMemoryTestApp, DEMO_SESSION_ID } from "../src/server.js";

const localOrigin = "http://localhost:5173";

async function login(
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
    payload: { profileId, ...(sessionId ? { sessionId } : {}) },
  });
  expect(response.statusCode).toBe(200);
  const context = response.json() as DemoAuthContext;
  const rawCookie = Array.isArray(response.headers["set-cookie"])
    ? response.headers["set-cookie"][0]
    : response.headers["set-cookie"];
  if (!rawCookie) throw new Error("login cookie missing");
  return {
    cookie: rawCookie.split(";")[0]!,
    csrfToken: context.csrfToken,
    bindings: context.bindings,
  };
}

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("V2 Xunpu collaboration public wiring", () => {
  it("starts the real reporter-only release and serves role-safe Episodes without writes", async () => {
    const engine = new WorldEngine({
      store: new InMemoryEventStore(),
      bus: new InProcessMessageBus(),
      scenario: structuredClone(demoScenario),
    });
    const app = await createMemoryTestApp({
      engine,
      initializeSecondaryDemo: false,
    });
    apps.push(app);
    const teacher = await login(app, "teacher-class-a", DEMO_SESSION_ID);
    const authorizationBinding = teacher.bindings.find((binding) => (
      binding.actorKind === "teacher"
    ));
    if (!authorizationBinding) throw new Error("teacher binding missing");

    const packages = await app.inject({
      method: "GET",
      url: `/api/scenario-packages?authorizationSessionId=${DEMO_SESSION_ID}&bindingId=${authorizationBinding.bindingId}`,
      headers: { cookie: teacher.cookie },
    });
    expect(packages.statusCode).toBe(200);
    const xunpuScenario = packages.json().releases.find((release: {
      ref: { scenarioId: string; version: string };
    }) => (
      release.ref.scenarioId === "scenario-xunpu-media"
      && release.ref.version === "2.0.1"
    ));
    expect(xunpuScenario).toBeDefined();
    expect(xunpuScenario.package.roles.filter((role: {
      actorKind: string;
    }) => role.actorKind === "student")).toEqual([
      expect.objectContaining({
        actorKind: "student",
        roleId: "reporter",
        agentId: "student-reporter",
      }),
    ]);
    expect(xunpuScenario.package.roles.filter((role: {
      actorKind: string;
    }) => role.actorKind === "agent")).toHaveLength(14);

    const catalog = await app.inject({ method: "GET", url: "/api/courses" });
    const course = catalog.json().courses.find((item: { courseId: string }) => (
      item.courseId === "course-xunpu-intangible-media"
    ));
    expect(course).toMatchObject({
      version: 3,
      releaseId: "release-course-xunpu-intangible-media-2.0.0-runtime.2",
    });
    const detail = await app.inject({
      method: "GET",
      url: "/api/courses/course-xunpu-intangible-media",
    });
    const courseReleaseRef = {
      courseId: detail.json().course.courseId,
      releaseId: detail.json().course.releaseId,
      version: detail.json().course.version,
      contentHash: detail.json().course.contentHash,
    };
    expect(detail.json().course).not.toHaveProperty("scenarioReleaseRef");

    const started = await app.inject({
      method: "POST",
      url: "/api/training-sessions",
      headers: {
        origin: localOrigin,
        cookie: teacher.cookie,
        "x-csrf-token": teacher.csrfToken,
      },
      payload: {
        authorizationSessionId: DEMO_SESSION_ID,
        bindingId: authorizationBinding.bindingId,
        requestId: "request-xunpu-v2-episode-001",
        classroomId: "classroom-local-tourism-a",
        teamId: "team-local-tourism-a",
        releaseId: xunpuScenario.ref.releaseId,
        courseReleaseRef,
      },
    });
    expect(started.statusCode).toBe(200);
    const sessionId = started.json().sessionId as string;
    const teacherBinding = (started.json().bindings as RoleBinding[]).find(
      (binding) => binding.actorKind === "teacher",
    );
    if (!teacherBinding) throw new Error("new teacher binding missing");

    const learner = await login(app, "student-unassigned");
    const claim = await app.inject({
      method: "POST",
      url: "/api/course-enrollments",
      headers: {
        origin: localOrigin,
        cookie: learner.cookie,
        "x-csrf-token": learner.csrfToken,
      },
      payload: { courseReleaseId: course.releaseId },
    });
    expect(claim.statusCode).toBe(200);
    const reporterBindingId = claim.json().enrollment.bindingId as string;
    expect(claim.json().enrollment).toMatchObject({
      activeSessionId: sessionId,
      primaryRoleId: "reporter",
      status: "in_progress",
    });

    const before = await engine.getTimeline(sessionId, "teacher-main");
    const studentEpisode = await app.inject({
      method: "GET",
      url: `/api/sessions/${sessionId}/collaboration-episode?bindingId=${reporterBindingId}`,
      headers: { cookie: learner.cookie },
    });
    const teacherEpisode = await app.inject({
      method: "GET",
      url: `/api/sessions/${sessionId}/collaboration-episode?bindingId=${teacherBinding.bindingId}`,
      headers: { cookie: teacher.cookie },
    });
    const after = await engine.getTimeline(sessionId, "teacher-main");

    expect(studentEpisode.statusCode).toBe(200);
    expect(studentEpisode.json()).toMatchObject({
      audience: "student",
      scenarioId: "scenario-xunpu-media",
      status: "suggestion_ready",
      suggestion: {
        allowedDecisions: ["accept", "request_evidence", "reject"],
      },
    });
    expect(teacherEpisode.statusCode).toBe(200);
    expect(teacherEpisode.json()).toMatchObject({
      audience: "teacher",
      scenarioId: "scenario-xunpu-media",
      status: "in_progress",
    });
    expect(teacherEpisode.json().affectedAgents).toHaveLength(14);
    expect("execution" in teacherEpisode.json()).toBe(false);
    expect(after).toEqual(before);

    const forgedDecisionRef = await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/commands`,
      headers: {
        origin: localOrigin,
        cookie: learner.cookie,
        "x-csrf-token": learner.csrfToken,
      },
      payload: {
        bindingId: reporterBindingId,
        name: "record_experience_choice",
        expectedStateVersion: studentEpisode.json().stateVersion,
        sourceMode: "course_platform",
        surfaceId: "student-v2-training",
        interactionId: "xunpu-topic-brief:agent-decision:request_evidence",
        payload: {
          choiceRef: "xunpu-topic-brief:agent-decision:request_evidence",
        },
      },
    });
    expect(forgedDecisionRef.statusCode).toBe(403);

    const suggestionId = studentEpisode.json().suggestion.suggestionId as string;
    const decision = await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/commands`,
      headers: {
        origin: localOrigin,
        cookie: learner.cookie,
        "x-csrf-token": learner.csrfToken,
      },
      payload: {
        bindingId: reporterBindingId,
        name: "record_experience_choice",
        expectedStateVersion: studentEpisode.json().stateVersion,
        sourceMode: "course_platform",
        surfaceId: "student-v2-current-advice",
        interactionId: suggestionId,
        payload: {
          suggestionId,
          decision: "request_evidence",
        },
      },
    });
    expect(decision.statusCode).toBe(200);
    expect(decision.json()).toMatchObject({
      schemaVersion: "student-training-mutation-receipt/2.0.0",
      accepted: true,
      sessionId,
    });
    expect(decision.json()).not.toHaveProperty("role");
    expect(decision.json()).not.toHaveProperty("structuredWorld");
    const decidedEpisode = await app.inject({
      method: "GET",
      url: `/api/sessions/${sessionId}/collaboration-episode?bindingId=${reporterBindingId}`,
      headers: { cookie: learner.cookie },
    });
    expect(decidedEpisode.json()).toMatchObject({
      audience: "student",
      status: "decided",
      studentDecision: {
        decision: "request_evidence",
      },
    });

    const staleTaskAction = await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/commands`,
      headers: {
        origin: localOrigin,
        cookie: learner.cookie,
        "x-csrf-token": learner.csrfToken,
      },
      payload: {
        bindingId: reporterBindingId,
        name: "record_experience_choice",
        expectedStateVersion: decidedEpisode.json().stateVersion,
        sourceMode: "world_interaction",
        surfaceId: "student-v2-training",
        interactionId: "xunpu-topic-compare-angles",
        payload: { choiceRef: "xunpu-topic-compare-angles" },
      },
    });
    expect(staleTaskAction.statusCode).toBe(409);
    expect(staleTaskAction.json()).toMatchObject({
      error: "StateVersionConflictError",
      expected: decidedEpisode.json().stateVersion,
    });

    const freshContext = await app.inject({
      method: "GET",
      url: `/api/sessions/${sessionId}/student-training-context?bindingId=${reporterBindingId}`,
      headers: { cookie: learner.cookie },
    });
    expect(freshContext.statusCode).toBe(200);
    expect(freshContext.json().stateVersion).toBeGreaterThan(
      decidedEpisode.json().stateVersion,
    );
    const taskAction = await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/commands`,
      headers: {
        origin: localOrigin,
        cookie: learner.cookie,
        "x-csrf-token": learner.csrfToken,
      },
      payload: {
        bindingId: reporterBindingId,
        name: "record_experience_choice",
        expectedStateVersion: freshContext.json().stateVersion,
        sourceMode: "world_interaction",
        surfaceId: "student-v2-training",
        interactionId: "xunpu-topic-compare-angles",
        payload: { choiceRef: "xunpu-topic-compare-angles" },
      },
    });
    expect(taskAction.statusCode).toBe(200);
    expect(taskAction.json()).toMatchObject({
      schemaVersion: "student-training-mutation-receipt/2.0.0",
      accepted: true,
      sessionId,
    });
    const internalProjection = await engine.getProjection(
      sessionId,
      "student-reporter",
    );
    expect(internalProjection.structuredWorld?.tasks).toContainEqual(
      expect.objectContaining({
        taskId: "xunpu-topic-compare-angles",
        status: "completed",
      }),
    );
    expect(JSON.stringify(taskAction.json())).not.toContain("水乡非遗市集");
    expect(JSON.stringify(taskAction.json())).not.toContain("student-editor");
  });

  it("keeps the fourteen-agent topology behind the operator principal", async () => {
    const app = await createMemoryTestApp({
      engine: new WorldEngine({
        store: new InMemoryEventStore(),
        bus: new InProcessMessageBus(),
        scenario: structuredClone(demoScenario),
      }),
      initializeSecondaryDemo: false,
    });
    apps.push(app);
    const teacher = await login(app, "teacher-class-a", DEMO_SESSION_ID);
    const denied = await app.inject({
      method: "GET",
      url: "/api/admin/agent-topology",
      headers: { cookie: teacher.cookie },
    });
    expect(denied.statusCode).toBe(403);

    const operator = await login(app, "operator-demo", DEMO_SESSION_ID);
    const allowed = await app.inject({
      method: "GET",
      url: "/api/admin/agent-topology",
      headers: { cookie: operator.cookie },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().groups).toHaveLength(6);
    expect(allowed.json().agents).toHaveLength(14);
    expect(allowed.json().agents.every((agent: { templateId: string }) => (
      !agent.templateId.startsWith("assistant/")
    ))).toBe(true);
  });
});
