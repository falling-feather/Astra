import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { learningActivityFixture as canonicalLearningActivityFixture } from "../../../packages/contracts/test/v2-learning.fixture.js";
import {
  createHttpExperienceGateway,
  type FetchLike,
} from "../src/v2/gateway";
import {
  loadStudentCourseLanding,
  resolveTrainingLoad,
} from "../src/v2/loaders";
import type { DemoAuthContext } from "../src/v2/models";
import { AdminTopologySurface } from "../src/v2/pages/admin-topology-page";
import { activityStateCopy } from "../src/v2/pages/student-training-page";
import {
  TeacherDirectorSurface,
  TeacherWaitingState,
} from "../src/v2/pages/teacher-director-page";
import {
  parseDemoAuthContext,
  parseLearningActivityResponse,
} from "../src/v2/wire";
import {
  gatewayFixture,
  learningActivityFixture,
  studentEpisodeFixture,
  studentTrainingContextFixture,
} from "./v2-student.fixture";
import {
  adminTopologyFixture,
  teacherClassFixture,
  teacherEpisodeFixture,
} from "./v2-teacher-admin.fixture";

function authFixture(overrides: Record<string, unknown> = {}) {
  return {
    profileId: "student-demo-a",
    principal: {
      principalId: "principal-student-demo-a",
      kind: "human",
      displayName: "学生记者",
      status: "active",
      createdAt: "2026-08-09T02:00:00.000Z",
    },
    bindings: [{
      bindingId: "binding-student-xunpu",
      principalId: "principal-student-demo-a",
      sessionId: "session-xunpu-001",
      actorId: "student-reporter",
      actorKind: "student",
      roleId: "reporter",
      status: "active",
      createdAt: "2026-08-09T02:00:00.000Z",
      expiresAt: "2099-08-09T10:00:00.000Z",
    }],
    csrfToken: "csrf-memory-only",
    expiresAt: "2099-08-09T10:00:00.000Z",
    ...overrides,
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("QA-005 V2 Web quality gates", () => {
  it("fails closed on a missing or expired top-level auth expiry", () => {
    expect(parseDemoAuthContext(authFixture(), {
      profileId: "student-demo-a",
      sessionId: "session-xunpu-001",
      now: Date.parse("2026-08-09T03:00:00.000Z"),
    }).expiresAt).toBe("2099-08-09T10:00:00.000Z");

    const missing = authFixture();
    delete (missing as { expiresAt?: unknown }).expiresAt;
    expect(() => parseDemoAuthContext(missing, {
      profileId: "student-demo-a",
      sessionId: "session-xunpu-001",
    })).toThrow();
    expect(() => parseDemoAuthContext(authFixture({
      expiresAt: "2026-08-09T02:59:59.000Z",
    }), {
      profileId: "student-demo-a",
      sessionId: "session-xunpu-001",
      now: Date.parse("2026-08-09T03:00:00.000Z"),
    })).toThrow();
  });

  it("stops the plain course loader after empty enrollments", async () => {
    const getCourses = vi.fn();
    const getCourseProgress = vi.fn();
    const getLearningActivity = vi.fn();
    const getStudentTrainingContext = vi.fn();
    const getStudentEpisode = vi.fn();
    await expect(loadStudentCourseLanding(gatewayFixture({
      getEnrollments: async () => [],
      getCourses,
      getCourseProgress,
      getLearningActivity,
      getStudentTrainingContext,
      getStudentEpisode,
    }))).resolves.toEqual({ state: "empty" });
    expect(getCourses).not.toHaveBeenCalled();
    expect(getCourseProgress).not.toHaveBeenCalled();
    expect(getLearningActivity).not.toHaveBeenCalled();
    expect(getStudentTrainingContext).not.toHaveBeenCalled();
    expect(getStudentEpisode).not.toHaveBeenCalled();
  });

  it.each(["empty", "ready", "active", "awaiting_review", "completed"] as const)(
    "parses and presents only the frozen %s activity branch",
    (status) => {
      const activity = parseLearningActivityResponse({
        activity: canonicalLearningActivityFixture(status),
      });
      expect(activity.status).toBe(status);
      expect(activity.currentTask === null).toBe(status !== "active");
      expect(activityStateCopy(activity).title.trim().length).toBeGreaterThan(0);
      expect(() => parseLearningActivityResponse({
        activity: { ...activity, rawProjection: { stateVersion: 999 } },
      })).toThrow();
    },
  );

  it.each(["session", "binding"] as const)(
    "retries a persistent %s drift three times and then fails closed",
    async (kind) => {
      vi.useFakeTimers();
      try {
        const getLearningActivity = vi.fn(async () => (
          learningActivityFixture("active")
        ));
        const getStudentTrainingContext = vi.fn(async () => {
          const context = studentTrainingContextFixture();
          if (kind === "session") context.sessionId = "session-other";
          else context.bindingId = "binding-other";
          return context;
        });
        const getStudentEpisode = vi.fn(async () => studentEpisodeFixture());
        const outcome = resolveTrainingLoad(gatewayFixture({
          getLearningActivity,
          getStudentTrainingContext,
          getStudentEpisode,
        }), "session-xunpu-001", "binding-student-xunpu");
        const rejected = expect(outcome).rejects.toThrow();
        await vi.runAllTimersAsync();
        await rejected;
        expect(getLearningActivity).toHaveBeenCalledTimes(3);
        expect(getStudentTrainingContext).toHaveBeenCalledTimes(3);
        expect(getStudentEpisode).toHaveBeenCalledTimes(3);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("uses the strict student context wire and never falls back to broad projection", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: FetchLike = async (input, init) => {
      calls.push({ url: String(input), ...(init ? { init } : {}) });
      return jsonResponse(studentTrainingContextFixture());
    };
    const gateway = createHttpExperienceGateway(
      parseDemoAuthContext(authFixture(), {
        profileId: "student-demo-a",
        sessionId: "session-xunpu-001",
      }) as DemoAuthContext,
      { apiBase: "http://api.local", fetchImpl },
    );
    await gateway.getStudentTrainingContext(
      "session-xunpu-001",
      "binding-student-xunpu",
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      "http://api.local/api/sessions/session-xunpu-001/student-training-context?bindingId=binding-student-xunpu",
    );
    expect(calls[0]?.init?.credentials).toBe("include");
    expect(calls[0]?.url).not.toContain("/projection");
  });

  it("keeps teacher waiting and administrator topology surfaces isolated", () => {
    const waitingMarkup = renderToStaticMarkup(createElement(
      TeacherWaitingState,
      { onOpenClasses: vi.fn() },
    ));
    expect(waitingMarkup).not.toContain("v2-causal-stage");
    expect(waitingMarkup).not.toContain("Trace");

    const teacherMarkup = renderToStaticMarkup(createElement(
      TeacherDirectorSurface,
      {
        classroom: teacherClassFixture(),
        episode: teacherEpisodeFixture(),
        bindingId: "binding-teacher-a",
        onDecide: async () => undefined,
      },
    ));
    for (const forbidden of ["STATE #", "Prompt", "trace-", "provider"] as const) {
      expect(teacherMarkup).not.toContain(forbidden);
    }

    const adminMarkup = renderToStaticMarkup(createElement(
      AdminTopologySurface,
      { topology: adminTopologyFixture() },
    ));
    expect(adminMarkup.match(/<section class="group-/g)).toHaveLength(6);
    expect(adminMarkup.match(/aria-pressed=/g)).toHaveLength(14);
    expect(adminMarkup).toContain("Trace");
    expect(adminMarkup).toContain("iflytek-spark");
  });
});
