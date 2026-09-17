import { describe, expect, it } from "vitest";
import {
  DefaultV2SessionId,
  authPlanForRoute,
  pathWithRoleContext,
  reporterBindingIdFor,
} from "../src/App";
import type { DemoAuthContext } from "../src/v2/models";

describe("V2 App auth plan", () => {
  it("uses an unassigned student without a world session for the course empty state", () => {
    expect(authPlanForRoute({ kind: "student-courses" }, null)).toEqual({
      profileId: "student-unassigned",
    });
  });

  it("keeps an explicit course detail outside world-session authentication", () => {
    expect(authPlanForRoute({
      kind: "student-course-detail",
      courseId: "course-village-super-multiplatform",
    }, "student-unassigned")).toEqual({
      profileId: "student-unassigned",
    });
  });

  it("preserves an explicit profile and binds a training reload to its route session", () => {
    expect(authPlanForRoute(
      { kind: "student-training", sessionId: "session-xunpu-001" },
      "student-demo-a",
    )).toEqual({
      profileId: "student-demo-a",
      sessionId: "session-xunpu-001",
    });
  });

  it("produces no auth/business plan for an unknown route", () => {
    expect(authPlanForRoute({ kind: "not-found" }, "student-demo-a"))
      .toBeNull();
  });

  it("uses default V2 identities only when the URL does not specify a profile", () => {
    expect(authPlanForRoute(
      { kind: "teacher", page: "classes", sessionId: null },
      null,
    )).toEqual({ profileId: "teacher-class-a", sessionId: DefaultV2SessionId });
    expect(authPlanForRoute(
      { kind: "admin", page: "agents" },
      null,
      "session-xunpu-a",
    )).toBeNull();
  });

  it("fails closed instead of silently replacing an explicit cross-role profile", () => {
    expect(authPlanForRoute(
      { kind: "teacher", page: "classes", sessionId: null },
      "student-team-a",
      "demo-local-tourism",
    )).toBeNull();
    expect(authPlanForRoute(
      { kind: "admin", page: "agents" },
      "teacher-class-a",
      "demo-local-tourism",
    )).toBeNull();
    expect(authPlanForRoute(
      { kind: "student-courses" },
      "operator-demo",
    )).toBeNull();
  });

  it("keeps administrator context inside admin navigation but switches to real role profiles", () => {
    expect(pathWithRoleContext(
      "/admin/agents",
      "?profileId=operator-demo&sessionId=session-xunpu-a",
    )).toBe("/admin/agents?profileId=operator-demo&sessionId=session-xunpu-a");
    expect(pathWithRoleContext(
      "/teacher/classes?profileId=teacher-class-a",
      "?profileId=operator-demo&sessionId=session-xunpu-a",
    )).toBe("/teacher/classes?profileId=teacher-class-a&sessionId=session-xunpu-a");
    expect(pathWithRoleContext(
      "/student/courses?profileId=student-unassigned",
      "?profileId=operator-demo&sessionId=session-xunpu-a",
    )).toBe("/student/courses?profileId=student-unassigned");
    expect(pathWithRoleContext(
      "/teacher/director/session-adaptive-v4",
      "?profileId=teacher-class-a&sessionId=session-xunpu-a",
    )).toBe(
      "/teacher/director/session-adaptive-v4?profileId=teacher-class-a&sessionId=session-adaptive-v4",
    );
  });

  it("selects only the current session reporter binding", () => {
    const auth = {
      profileId: "student-demo-a",
      principal: {
        principalId: "principal-student-demo-a",
        kind: "human",
        displayName: "学生记者",
        status: "active",
        createdAt: "2026-08-09T02:00:00.000Z",
      },
      csrfToken: "csrf",
      expiresAt: "2099-08-09T10:00:00.000Z",
      bindings: [
        {
          bindingId: "binding-teacher",
          principalId: "principal-student-demo-a",
          sessionId: "session-xunpu-001",
          actorId: "teacher-main",
          actorKind: "teacher",
          roleId: "teacher",
          status: "active",
          createdAt: "2026-08-09T02:00:00.000Z",
          expiresAt: "2099-08-09T10:00:00.000Z",
        },
        {
          bindingId: "binding-reporter",
          principalId: "principal-student-demo-a",
          sessionId: "session-xunpu-001",
          actorId: "student-reporter",
          actorKind: "student",
          roleId: "reporter",
          status: "active",
          createdAt: "2026-08-09T02:00:00.000Z",
          expiresAt: "2099-08-09T10:00:00.000Z",
        },
      ],
    } satisfies DemoAuthContext;
    expect(reporterBindingIdFor(auth, "session-xunpu-001"))
      .toBe("binding-reporter");
    expect(reporterBindingIdFor(auth, "another-session")).toBeNull();
  });
});
