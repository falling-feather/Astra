import { describe, expect, it, vi } from "vitest";
import {
  createHttpExperienceGateway,
  establishDemoAuth,
  type FetchLike,
} from "../src/v2/gateway";
import {
  parseCourseResponse,
  parseCourseOutcomeMutationReceipt,
  parseCourseProgressResponse,
  parseCourseReviewResponse,
  parseCourseReleaseSummary,
  parseDemoAuthContext,
  parseStudentPortfolioResponse,
} from "../src/v2/wire";
import {
  courseReleaseSummaryFixture,
  courseReleaseFixture,
  courseOutcomeReceiptFixture,
  courseProgressListFixture,
  courseReviewWorkspaceFixture,
  enrollmentFixture,
  studentTrainingContextFixture,
  studentPortfolioFixture,
  sessionExperienceDescriptorFixture,
} from "./v2-student.fixture";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function reporterBinding(
  overrides: Record<string, unknown> = {},
) {
  return {
    bindingId: "binding-student-xunpu",
    principalId: "principal-student-demo-a",
    sessionId: "session-xunpu-001",
    actorId: "student-reporter",
    actorKind: "student",
    roleId: "reporter",
    status: "active",
    createdAt: "2026-08-09T02:00:00.000Z",
    expiresAt: "2099-08-09T10:00:00.000Z",
    ...overrides,
  } as const;
}

function authFixture(
  overrides: Record<string, unknown> = {},
) {
  return {
    profileId: "student-unassigned",
    principal: {
      principalId: "principal-student-demo-a",
      kind: "human",
      displayName: "学生记者",
      status: "active",
      createdAt: "2026-08-09T02:00:00.000Z",
    },
    bindings: [],
    csrfToken: "csrf-memory-only",
    expiresAt: "2099-08-09T10:00:00.000Z",
    ...overrides,
  } as const;
}

function mutationReceipt(sessionId = "session-xunpu-001") {
  return {
    schemaVersion: "student-training-mutation-receipt/2.0.0",
    accepted: true,
    sessionId,
    stateVersion: 19,
  } as const;
}

describe("V2 student HTTP wire", () => {
  it("reads the frozen experience descriptor and rejects extra response fields", async () => {
    const descriptor = sessionExperienceDescriptorFixture("flagship_v4");
    const calls: string[] = [];
    const gateway = createHttpExperienceGateway(authFixture(), {
      apiBase: "http://api.local",
      fetchImpl: async (input) => {
        calls.push(String(input));
        return jsonResponse({ descriptor });
      },
    });
    await expect(gateway.getSessionExperienceDescriptor(
      descriptor.sessionId,
      "binding-student-xunpu",
    )).resolves.toEqual(descriptor);
    expect(calls).toEqual([
      "http://api.local/api/sessions/session-xunpu-001/experience-descriptor?bindingId=binding-student-xunpu",
    ]);

    const invalidGateway = createHttpExperienceGateway(authFixture(), {
      fetchImpl: async () => jsonResponse({ descriptor, experienceGeneration: "forged" }),
    });
    await expect(invalidGateway.getSessionExperienceDescriptor(
      descriptor.sessionId,
      "binding-student-xunpu",
    )).rejects.toThrow();
  });

  it("keeps the native fetch receiver when no test adapter is injected", async () => {
    const originalFetch = globalThis.fetch;
    const nativeLikeFetch = vi.fn(function (this: unknown) {
      expect(this).toBe(globalThis);
      return Promise.resolve(jsonResponse(authFixture()));
    }) as unknown as typeof fetch;
    globalThis.fetch = nativeLikeFetch;
    try {
      await establishDemoAuth({ profileId: "student-unassigned" });
      expect(nativeLikeFetch).toHaveBeenCalledOnce();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("establishes demo auth with include credentials and keeps CSRF in memory", async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetchImpl: FetchLike = async (input, init) => {
      calls.push({ input, init });
      return jsonResponse(authFixture());
    };
    const auth = await establishDemoAuth(
      { profileId: "student-unassigned" },
      { apiBase: "http://api.local", fetchImpl },
    );
    expect(auth.csrfToken).toBe("csrf-memory-only");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toBe("http://api.local/api/auth/demo-session");
    expect(calls[0]?.init).toMatchObject({
      method: "POST",
      credentials: "include",
    });
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      profileId: "student-unassigned",
    });
  });

  it("retains the complete principal/binding and requires the requested session", async () => {
    const fetchImpl: FetchLike = async () => jsonResponse(authFixture({
      profileId: "student-demo-a",
      bindings: [
        reporterBinding(),
        reporterBinding({
          bindingId: "binding-other-session",
          sessionId: "session-other",
        }),
      ],
    }));
    const auth = await establishDemoAuth(
      { profileId: "student-demo-a", sessionId: "session-xunpu-001" },
      { fetchImpl },
    );
    expect(auth.principal.displayName).toBe("学生记者");
    expect(auth.bindings).toHaveLength(2);
    expect(auth.bindings[0]).toMatchObject({
      bindingId: "binding-student-xunpu",
      principalId: "principal-student-demo-a",
      status: "active",
    });
  });

  it.each([
    ["wrong profile", authFixture(), { profileId: "student-demo-a" }],
    ["inactive principal", authFixture({
      principal: {
        ...authFixture().principal,
        status: "disabled",
      },
    }), { profileId: "student-unassigned" }],
    ["foreign principal binding", authFixture({
      profileId: "student-demo-a",
      bindings: [reporterBinding({ principalId: "principal-foreign" })],
    }), { profileId: "student-demo-a", sessionId: "session-xunpu-001" }],
    ["revoked binding", authFixture({
      profileId: "student-demo-a",
      bindings: [reporterBinding({ status: "revoked" })],
    }), { profileId: "student-demo-a", sessionId: "session-xunpu-001" }],
    ["expired binding", authFixture({
      profileId: "student-demo-a",
      bindings: [reporterBinding({ expiresAt: "2026-08-09T01:00:00.000Z" })],
    }), { profileId: "student-demo-a", sessionId: "session-xunpu-001" }],
    ["wrong session", authFixture({
      profileId: "student-demo-a",
      bindings: [reporterBinding({ sessionId: "session-other" })],
    }), { profileId: "student-demo-a", sessionId: "session-xunpu-001" }],
  ])("fails closed on %s auth", (_label, value, expectation) => {
    expect(() => parseDemoAuthContext(value, {
      ...expectation,
      now: Date.parse("2026-08-09T03:00:00.000Z"),
    })).toThrow();
  });

  it("reads the direct strict student context endpoint and never calls broad projection", async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetchImpl: FetchLike = async (input, init) => {
      calls.push({ input, init });
      return jsonResponse(studentTrainingContextFixture());
    };
    const gateway = createHttpExperienceGateway(authFixture(), {
      apiBase: "http://api.local",
      fetchImpl,
    });
    await expect(gateway.getStudentTrainingContext(
      "session-xunpu-001",
      "binding-student-xunpu",
    )).resolves.toMatchObject({
      schemaVersion: "student-training-context/2.0.0",
      actor: { roleId: "reporter" },
    });
    expect(String(calls[0]?.input)).toBe(
      "http://api.local/api/sessions/session-xunpu-001/student-training-context?bindingId=binding-student-xunpu",
    );
    expect(String(calls[0]?.input)).not.toContain("/projection");
  });

  it("restores the logged-in identity before binding a discovered reporter session", async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetchImpl: FetchLike = async (input, init) => {
      calls.push({ input, init });
      const path = new URL(String(input)).pathname;
      if(path==='/api/auth/session')return jsonResponse(authFixture({bindings:[]}));
      if (path === "/api/auth/session-context") {
        return jsonResponse(authFixture({
          bindings: [reporterBinding()],
          csrfToken: "csrf-session-bound",
        }));
      }
      return jsonResponse({ enrollment: enrollmentFixture() });
    };
    const gateway = createHttpExperienceGateway(authFixture(), {
      apiBase: "http://api.local",
      fetchImpl,
    });
    await gateway.authorizeSession("session-xunpu-001");
    await gateway.claimCourse("course-xunpu-intangible-media-r1");
    expect(String(calls[0]?.input)).toBe('http://api.local/api/auth/session');
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({
      sessionId: "session-xunpu-001",
    });
    expect(new Headers(calls[2]?.init?.headers).get("X-CSRF-Token"))
      .toBe("csrf-session-bound");
  });

  it("reads a strict immutable course detail from the exact course route", async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetchImpl: FetchLike = async (input, init) => {
      calls.push({ input, init });
      return jsonResponse({ course: courseReleaseFixture() });
    };
    const gateway = createHttpExperienceGateway(authFixture(), {
      apiBase: "http://api.local",
      fetchImpl,
    });
    await expect(gateway.getCourse("course-xunpu-intangible-media"))
      .resolves.toMatchObject({
        schemaVersion: "course-release-detail/2.0.0",
        courseId: "course-xunpu-intangible-media",
        chapters: expect.arrayContaining([expect.objectContaining({ order: 1 })]),
      });
    expect(String(calls[0]?.input)).toBe(
      "http://api.local/api/courses/course-xunpu-intangible-media",
    );
    expect(calls[0]?.init?.credentials).toBe("include");
  });

  it("sends CSRF and exact frozen advice/main-action command bodies", async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const responses = [
      { enrollment: enrollmentFixture() },
      mutationReceipt(),
      mutationReceipt(),
    ];
    const fetchImpl: FetchLike = async (input, init) => {
      calls.push({ input, init });
      return jsonResponse(responses.shift());
    };
    const gateway = createHttpExperienceGateway(authFixture(), {
      apiBase: "http://api.local",
      fetchImpl,
    });
    await gateway.claimCourse("course-xunpu-intangible-media-r1");
    await gateway.recordAdviceDecision({
      sessionId: "session-xunpu-001",
      bindingId: "binding-student-xunpu",
      expectedStateVersion: 18,
      suggestionId: "suggestion-source-conflict",
      decision: "accept",
    });
    await gateway.recordExperienceAction({
      sessionId: "session-xunpu-001",
      bindingId: "binding-student-xunpu",
      expectedStateVersion: 19,
      actionRef: "xunpu-topic-compare-angles",
    });

    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(call.init?.credentials).toBe("include");
      expect(new Headers(call.init?.headers).get("X-CSRF-Token"))
        .toBe("csrf-memory-only");
    }
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({
      bindingId: "binding-student-xunpu",
      name: "record_experience_choice",
      expectedStateVersion: 18,
      sourceMode: "course_platform",
      surfaceId: "student-v2-current-advice",
      interactionId: "suggestion-source-conflict",
      payload: {
        suggestionId: "suggestion-source-conflict",
        decision: "accept",
      },
    });
    expect(String(calls[1]?.init?.body)).not.toContain("choiceRef");
    expect(String(calls[1]?.init?.body)).not.toContain("agent-decision");
    expect(JSON.parse(String(calls[2]?.init?.body))).toEqual({
      bindingId: "binding-student-xunpu",
      name: "record_experience_choice",
      expectedStateVersion: 19,
      sourceMode: "world_interaction",
      surfaceId: "student-v2-training",
      interactionId: "xunpu-topic-compare-angles",
      payload: { choiceRef: "xunpu-topic-compare-angles" },
    });
  });

  it("reads strict progress, portfolio and student review wrappers", async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const responses = [
      { progress: courseProgressListFixture() },
      { portfolio: studentPortfolioFixture() },
      { review: courseReviewWorkspaceFixture() },
    ];
    const gateway = createHttpExperienceGateway(authFixture(), {
      apiBase: "http://api.local",
      fetchImpl: async (input, init) => {
        calls.push({ input, init });
        return jsonResponse(responses.shift());
      },
    });
    await gateway.getCourseProgress();
    await gateway.getPortfolio();
    await gateway.getCourseReview(
      "session-xunpu-001",
      "binding-student-xunpu",
    );
    expect(calls.map(({ input }) => String(input))).toEqual([
      "http://api.local/api/me/course-progress",
      "http://api.local/api/me/portfolio",
      "http://api.local/api/sessions/session-xunpu-001/course-review?bindingId=binding-student-xunpu",
    ]);
    for (const call of calls) expect(call.init?.credentials).toBe("include");
  });

  it("posts only the frozen course submission body with CSRF", async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetchImpl: FetchLike = async (input, init) => {
      calls.push({ input, init });
      return jsonResponse({ receipt: courseOutcomeReceiptFixture() });
    };
    const gateway = createHttpExperienceGateway(authFixture(), {
      apiBase: "http://api.local",
      fetchImpl,
    });
    await gateway.submitCourseForReview({
      sessionId: "session-xunpu-001",
      bindingId: "binding-student-xunpu",
      expectedEnrollmentStateVersion: 18,
      requestId: "request-course-outcome-001",
    });
    expect(String(calls[0]?.input)).toBe(
      "http://api.local/api/sessions/session-xunpu-001/course-submissions",
    );
    expect(calls[0]?.init?.credentials).toBe("include");
    expect(new Headers(calls[0]?.init?.headers).get("X-CSRF-Token"))
      .toBe("csrf-memory-only");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      bindingId: "binding-student-xunpu",
      expectedEnrollmentStateVersion: 18,
      requestId: "request-course-outcome-001",
    });
  });

  it("rejects a mutation receipt for another session", async () => {
    const gateway = createHttpExperienceGateway(authFixture(), {
      fetchImpl: async () => jsonResponse(mutationReceipt("session-other")),
    });
    await expect(gateway.recordAdviceDecision({
      sessionId: "session-xunpu-001",
      bindingId: "binding-student-xunpu",
      expectedStateVersion: 18,
      suggestionId: "suggestion-source-conflict",
      decision: "reject",
    })).rejects.toThrow(/会话不一致/u);
  });

  it("fails closed on extra summary fields and immutable release-id drift", () => {
    const summary = courseReleaseSummaryFixture();
    expect(() => parseCourseReleaseSummary({ ...summary, coverUrl: "/fake.png" }))
      .toThrow(/字段不符合冻结接口/u);
    expect(() => parseCourseReleaseSummary({
      ...summary,
      courseReleaseId: "another-release",
    })).toThrow(/必须一致/u);
  });

  it("rejects extra course-detail wrapper and release fields", () => {
    const course = courseReleaseFixture();
    expect(() => parseCourseResponse({ course, traceId: "forged" }))
      .toThrow(/字段不符合冻结接口/u);
    expect(() => parseCourseResponse({
      course: { ...course, progressPercent: 83 },
    })).toThrow();
    expect(() => parseCourseResponse({
      course: {
        ...course,
        chapters: [{ ...course.chapters[0], hiddenFactRefs: ["hidden"] }],
      },
    })).toThrow();
  });

  it("rejects extra outcome wrappers and forged technical fields", () => {
    expect(() => parseCourseProgressResponse({
      progress: courseProgressListFixture(),
      trace: [],
    })).toThrow(/字段不符合冻结接口/u);
    expect(() => parseStudentPortfolioResponse({
      portfolio: { ...studentPortfolioFixture(), provider: "forged" },
    })).toThrow();
    expect(() => parseCourseReviewResponse({
      review: { ...courseReviewWorkspaceFixture(), prompt: "forged" },
    })).toThrow();
    expect(() => parseCourseOutcomeMutationReceipt({
      receipt: { ...courseOutcomeReceiptFixture(), score: 100 },
    })).toThrow();
  });
});
