import { describe, expect, it, vi } from "vitest";
import { GatewayHttpError } from "../src/v2/gateway";
import {
  AuthorityConflictError,
  claimStudentCourse,
  deriveStudentCourseDetail,
  loadStudentCourseLanding,
  loadStudentCourseDetail,
  resolveTrainingLoad,
  submitAdviceDecision,
  submitPrimaryTask,
} from "../src/v2/loaders";
import type { AdviceDecision, TrainingSnapshot } from "../src/v2/models";
import {
  courseReleaseSummaryFixture,
  courseReleaseFixture,
  courseProgressItemFixture,
  courseProgressListFixture,
  enrollmentFixture,
  gatewayFixture,
  learningActivityFixture,
  studentEpisodeFixture,
  studentTrainingContextFixture,
} from "./v2-student.fixture";

function snapshotFixture(
  stateVersion = 18,
): TrainingSnapshot {
  return {
    enrollment: enrollmentFixture({ stateVersion }),
    course: courseReleaseSummaryFixture(),
    activity: learningActivityFixture({ stateVersion }),
    context: studentTrainingContextFixture(stateVersion),
    episode: studentEpisodeFixture(null, stateVersion),
  };
}

describe("V2 student load plan", () => {
  it("stops after empty enrollments with zero catalog/session-scoped reads", async () => {
    const authorizeSession = vi.fn();
    const getCourses = vi.fn();
    const getCourse = vi.fn();
    const getCourseProgress = vi.fn();
    const getLearningActivity = vi.fn();
    const getStudentTrainingContext = vi.fn();
    const getStudentEpisode = vi.fn();
    const gateway = gatewayFixture({
      authorizeSession,
      getEnrollments: vi.fn(async () => []),
      getCourses,
      getCourse,
      getCourseProgress,
      getLearningActivity,
      getStudentTrainingContext,
      getStudentEpisode,
    });
    await expect(loadStudentCourseLanding(gateway)).resolves.toEqual({
      state: "empty",
    });
    expect(getCourses).not.toHaveBeenCalled();
    expect(authorizeSession).not.toHaveBeenCalled();
    expect(getCourse).not.toHaveBeenCalled();
    expect(getCourseProgress).not.toHaveBeenCalled();
    expect(getLearningActivity).not.toHaveBeenCalled();
    expect(getStudentTrainingContext).not.toHaveBeenCalled();
    expect(getStudentEpisode).not.toHaveBeenCalled();
  });

  it("reads principal-owned aggregate progress without minting a session binding", async () => {
    const order: string[] = [];
    const enrollment = enrollmentFixture({ bindingId: "binding-before" });
    const authorizeSession = vi.fn();
    const gateway = gatewayFixture({
      getEnrollments: async () => {
        order.push("enrollments");
        return [enrollment];
      },
      authorizeSession,
      getCourses: async () => {
        order.push("courses");
        return [courseReleaseSummaryFixture()];
      },
      getCourseProgress: async () => {
        order.push("progress");
        return courseProgressListFixture([
          courseProgressItemFixture(enrollment),
        ]);
      },
    });
    await expect(loadStudentCourseLanding(gateway)).resolves.toMatchObject({
      state: "enrolled",
    });
    expect(order[0]).toBe("enrollments");
    expect(new Set(order.slice(1))).toEqual(new Set(["courses", "progress"]));
    expect(authorizeSession).not.toHaveBeenCalled();
  });

  it("renders multiple principal-owned active courses without guessing a session", async () => {
    const authorizeSession = vi.fn();
    const otherCourse = courseReleaseSummaryFixture({
      courseId: "course-village-super-multiplatform",
      courseReleaseId: "course-village-super-multiplatform-r1",
      releaseId: "course-village-super-multiplatform-r1",
      contentHash: "b".repeat(64),
      title: "贵州村超多平台视听报道",
      chapterCount: 6,
    });
    const other = enrollmentFixture({
      enrollmentId: "enrollment-other",
      activeSessionId: "session-other",
      bindingId: "binding-other",
      courseReleaseRef: {
        courseId: otherCourse.courseId,
        releaseId: otherCourse.releaseId,
        version: otherCourse.version,
        contentHash: otherCourse.contentHash,
      },
    });
    await expect(loadStudentCourseLanding(gatewayFixture({
      getEnrollments: async () => [enrollmentFixture(), other],
      authorizeSession,
      getCourses: async () => [courseReleaseSummaryFixture(), otherCourse],
      getCourseProgress: async () => courseProgressListFixture([
        courseProgressItemFixture(enrollmentFixture()),
        courseProgressItemFixture(other),
      ]),
    }))).resolves.toMatchObject({
      state: "enrolled",
      courses: [{}, {}],
    });
    expect(authorizeSession).not.toHaveBeenCalled();
  });

  it("reads enrollment first, catalog once, then the bound activity/context/episode", async () => {
    const order: string[] = [];
    const gateway = gatewayFixture({
      getEnrollments: async () => {
        order.push("enrollments");
        return [enrollmentFixture()];
      },
      getCourses: async () => {
        order.push("courses");
        return [courseReleaseSummaryFixture()];
      },
      getLearningActivity: async () => {
        order.push("activity");
        return learningActivityFixture();
      },
      getStudentTrainingContext: async () => {
        order.push("context");
        return studentTrainingContextFixture();
      },
      getStudentEpisode: async () => {
        order.push("episode");
        return studentEpisodeFixture();
      },
    });
    const result = await resolveTrainingLoad(
      gateway,
      "session-xunpu-001",
      "binding-student-xunpu",
    );
    expect(result.state).toBe("ready");
    expect(order.slice(0, 2)).toEqual(["enrollments", "courses"]);
    expect(new Set(order.slice(2))).toEqual(new Set([
      "activity", "context", "episode",
    ]));
  });

  it("retries a torn state triplet at most three times without refetching catalog", async () => {
    let contextRead = 0;
    const getCourses = vi.fn(async () => [courseReleaseSummaryFixture()]);
    const getLearningActivity = vi.fn(async () => learningActivityFixture());
    const getStudentEpisode = vi.fn(async () => studentEpisodeFixture());
    const getStudentTrainingContext = vi.fn(async () => {
      contextRead += 1;
      return studentTrainingContextFixture(contextRead < 3 ? 19 : 18);
    });
    await expect(resolveTrainingLoad(
      gatewayFixture({
        getCourses,
        getLearningActivity,
        getStudentTrainingContext,
        getStudentEpisode,
      }),
      "session-xunpu-001",
      "binding-student-xunpu",
    )).resolves.toMatchObject({ state: "ready" });
    expect(getCourses).toHaveBeenCalledOnce();
    expect(getLearningActivity).toHaveBeenCalledTimes(3);
    expect(getStudentTrainingContext).toHaveBeenCalledTimes(3);
    expect(getStudentEpisode).toHaveBeenCalledTimes(3);
  });

  it("fails closed after three inconsistent state-version reads", async () => {
    const getStudentTrainingContext = vi.fn(
      async () => studentTrainingContextFixture(19),
    );
    await expect(resolveTrainingLoad(
      gatewayFixture({ getStudentTrainingContext }),
      "session-xunpu-001",
      "binding-student-xunpu",
    )).rejects.toThrow(/重读 3 次并失败关闭/u);
    expect(getStudentTrainingContext).toHaveBeenCalledTimes(3);
  });

  it("fails closed when release, scenario or scene coherence drifts", async () => {
    const releaseDrift = studentEpisodeFixture();
    releaseDrift.courseReleaseRef.contentHash = "f".repeat(64);
    await expect(resolveTrainingLoad(
      gatewayFixture({ getStudentEpisode: async () => releaseDrift }),
      "session-xunpu-001",
      "binding-student-xunpu",
    )).rejects.toThrow(/重读 3 次并失败关闭/u);

    const scenarioDrift = studentTrainingContextFixture();
    scenarioDrift.scenarioReleaseRef.scenarioId = "scenario-other";
    await expect(resolveTrainingLoad(
      gatewayFixture({ getStudentTrainingContext: async () => scenarioDrift }),
      "session-xunpu-001",
      "binding-student-xunpu",
    )).rejects.toThrow(/重读 3 次并失败关闭/u);

    const sceneDrift = studentTrainingContextFixture();
    sceneDrift.scene.sceneId = "scene-other";
    sceneDrift.currentAction = null;
    await expect(resolveTrainingLoad(
      gatewayFixture({ getStudentTrainingContext: async () => sceneDrift }),
      "session-xunpu-001",
      "binding-student-xunpu",
    )).rejects.toThrow(/重读 3 次并失败关闭/u);
  }, 10_000);
});

describe("V2 multi-course detail and claim authority", () => {
  it("loads only strict course detail and enrollments with zero session reads", async () => {
    const getLearningActivity = vi.fn();
    const getStudentTrainingContext = vi.fn();
    const getStudentEpisode = vi.fn();
    const getCourseProgress = vi.fn(async () => courseProgressListFixture());
    const gateway = gatewayFixture({
      getCourse: vi.fn(async () => courseReleaseFixture()),
      getEnrollments: vi.fn(async () => []),
      getLearningActivity,
      getStudentTrainingContext,
      getStudentEpisode,
      getCourseProgress,
    });
    await expect(loadStudentCourseDetail(
      gateway,
      "course-xunpu-intangible-media",
    )).resolves.toMatchObject({
      courseId: "course-xunpu-intangible-media",
      enrollment: null,
      chapters: expect.arrayContaining([
        expect.objectContaining({ order: 1 }),
      ]),
    });
    expect(getLearningActivity).not.toHaveBeenCalled();
    expect(getStudentTrainingContext).not.toHaveBeenCalled();
    expect(getStudentEpisode).not.toHaveBeenCalled();
    expect(getCourseProgress).not.toHaveBeenCalled();
  });

  it("projects only public course fields and strips hidden runtime identifiers", () => {
    const release = courseReleaseFixture();
    const detail = deriveStudentCourseDetail(release, []);
    const serialized = JSON.stringify(detail);
    expect(serialized).toContain("公开来源");
    expect(serialized).toContain("事实与证据");
    expect(serialized).not.toContain("hidden-");
    expect(serialized).not.toContain(":agent-");
    expect(serialized).not.toContain(":gate-");
    expect(serialized).not.toContain(":action-");
    expect(detail).not.toHaveProperty("contentHash");
  });

  it("confirms a claim only after the authoritative enrollment list reread", async () => {
    let claimed = false;
    const enrollment = enrollmentFixture();
    const gateway = gatewayFixture({
      getCourse: async () => courseReleaseFixture(),
      getEnrollments: async () => claimed ? [enrollment] : [],
      claimCourse: vi.fn(async () => {
        claimed = true;
        return enrollment;
      }),
    });
    const detail = await loadStudentCourseDetail(
      gateway,
      "course-xunpu-intangible-media",
    );
    const confirmed = await claimStudentCourse(gateway, detail);
    expect(confirmed.enrollment).toEqual(enrollment);
    expect(gateway.claimCourse).toHaveBeenCalledWith(
      "course-xunpu-intangible-media-r1",
      undefined,
    );
  });

  it("confirms and opens the selected course when another course is already active", async () => {
    const villageSummary = courseReleaseSummaryFixture({
      courseId: "course-village-super-multiplatform",
      courseReleaseId: "course-village-super-multiplatform-r1",
      releaseId: "course-village-super-multiplatform-r1",
      contentHash: "b".repeat(64),
      title: "贵州村超多平台视听报道",
      chapterCount: 6,
    });
    const xunpu = enrollmentFixture();
    const villageBeforeAuthorization = enrollmentFixture({
      enrollmentId: "enrollment-village-001",
      bindingId: "binding-village-before",
      courseReleaseRef: {
        courseId: villageSummary.courseId,
        releaseId: villageSummary.releaseId,
        version: villageSummary.version,
        contentHash: villageSummary.contentHash,
      },
      activeSessionId: "session-village-001",
    });
    const villageAfterAuthorization = {
      ...villageBeforeAuthorization,
      bindingId: "binding-village-current",
    };
    let claimed = false;
    let authorized = false;
    const authorizeSession = vi.fn(async (sessionId: string) => {
      expect(sessionId).toBe("session-village-001");
      authorized = true;
      return villageAfterAuthorization.bindingId;
    });
    const gateway = gatewayFixture({
      getCourse: async () => courseReleaseFixture(villageSummary),
      getEnrollments: async () => claimed
        ? [
            xunpu,
            authorized
              ? villageAfterAuthorization
              : villageBeforeAuthorization,
          ]
        : [xunpu],
      authorizeSession,
      getCourseProgress: async () => courseProgressListFixture([
        courseProgressItemFixture(xunpu),
        courseProgressItemFixture(villageAfterAuthorization),
      ]),
      claimCourse: vi.fn(async () => {
        claimed = true;
        return villageBeforeAuthorization;
      }),
    });
    const detail = await loadStudentCourseDetail(gateway, villageSummary.courseId);
    const confirmed = await claimStudentCourse(gateway, detail);
    expect(confirmed.courseId).toBe(villageSummary.courseId);
    expect(confirmed.enrollment).toEqual(villageAfterAuthorization);
    expect(authorizeSession).toHaveBeenCalledTimes(1);
  });

  it("does not show a successful claim when the enrollment reread stays empty", async () => {
    const detail = deriveStudentCourseDetail(courseReleaseFixture(), []);
    await expect(claimStudentCourse(gatewayFixture({
      getCourse: async () => courseReleaseFixture(),
      getEnrollments: async () => [],
      claimCourse: async () => enrollmentFixture(),
    }), detail)).rejects.toThrow(/尚未确认课程认领/u);
  });

  it("fails closed when an enrolled immutable release differs from detail", () => {
    const release = courseReleaseFixture();
    release.contentHash = "f".repeat(64);
    const enrollment = enrollmentFixture();
    expect(() => deriveStudentCourseDetail(
      release,
      [enrollment],
      courseProgressItemFixture(enrollment),
    ))
      .toThrow(/发布引用不一致/u);
  });
});

describe("V2 authoritative student actions", () => {
  for (const decision of ["accept", "request_evidence", "reject"] as const) {
    it(`records ${decision} with suggestion identity only and confirms it by Episode reload`, async () => {
      let decided: AdviceDecision | null = null;
      const recordAdviceDecision = vi.fn(async (input) => {
        decided = input.decision;
      });
      const gateway = gatewayFixture({
        recordAdviceDecision,
        getLearningActivity: async () => learningActivityFixture({ stateVersion: 19 }),
        getStudentTrainingContext: async () => studentTrainingContextFixture(19),
        getStudentEpisode: async () => studentEpisodeFixture(decided, 19),
      });
      const refreshed = await submitAdviceDecision({
        gateway,
        snapshot: snapshotFixture(),
        reporterBindingId: "binding-student-xunpu",
        decision,
      });
      expect(recordAdviceDecision).toHaveBeenCalledWith(
        {
          sessionId: "session-xunpu-001",
          bindingId: "binding-student-xunpu",
          expectedStateVersion: 18,
          suggestionId: "suggestion-source-conflict",
          decision,
        },
        undefined,
      );
      expect(recordAdviceDecision.mock.calls[0]?.[0]).not.toHaveProperty("choiceRef");
      expect(refreshed.episode.studentDecision?.decision).toBe(decision);
    });
  }

  it("uses only the server-issued current action ref and confirms an authority change", async () => {
    const recordExperienceAction = vi.fn(async () => undefined);
    const gateway = gatewayFixture({
      recordExperienceAction,
      getLearningActivity: async () => learningActivityFixture({ stateVersion: 19 }),
      getStudentTrainingContext: async () => studentTrainingContextFixture(19, "completed"),
      getStudentEpisode: async () => studentEpisodeFixture(null, 19),
    });
    const refreshed = await submitPrimaryTask({
      gateway,
      snapshot: snapshotFixture(),
      reporterBindingId: "binding-student-xunpu",
    });
    expect(recordExperienceAction).toHaveBeenCalledWith(
      {
        sessionId: "session-xunpu-001",
        bindingId: "binding-student-xunpu",
        expectedStateVersion: 18,
        actionRef: "xunpu-topic-compare-angles",
      },
      undefined,
    );
    expect(refreshed.context.stateVersion).toBe(19);
  });

  it("does not claim success when POST succeeds but authority does not change", async () => {
    await expect(submitAdviceDecision({
      gateway: gatewayFixture({
        recordAdviceDecision: async () => undefined,
      }),
      snapshot: snapshotFixture(),
      reporterBindingId: "binding-student-xunpu",
      decision: "accept",
    })).rejects.toThrow(/尚未确认/u);
  });

  it("refreshes after a 409 async advance and uses the latest context version next", async () => {
    const staleRecord = vi.fn(async () => {
      throw new GatewayHttpError(409, "状态版本冲突", "version_hash_drift");
    });
    const staleGateway = gatewayFixture({
      recordExperienceAction: staleRecord,
      getLearningActivity: async () => learningActivityFixture({ stateVersion: 58 }),
      getStudentTrainingContext: async () => studentTrainingContextFixture(58),
      getStudentEpisode: async () => studentEpisodeFixture(null, 58),
    });
    let conflict: AuthorityConflictError | null = null;
    try {
      await submitPrimaryTask({
        gateway: staleGateway,
        snapshot: snapshotFixture(53),
        reporterBindingId: "binding-student-xunpu",
      });
    } catch (cause) {
      if (cause instanceof AuthorityConflictError) conflict = cause;
      else throw cause;
    }
    expect(conflict?.snapshot.context.stateVersion).toBe(58);
    expect(staleRecord).toHaveBeenCalledWith(
      expect.objectContaining({ expectedStateVersion: 53 }),
      undefined,
    );

    const latestRecord = vi.fn(async () => undefined);
    const latestGateway = gatewayFixture({
      recordExperienceAction: latestRecord,
      getLearningActivity: async () => learningActivityFixture({ stateVersion: 59 }),
      getStudentTrainingContext: async () => studentTrainingContextFixture(59, "completed"),
      getStudentEpisode: async () => studentEpisodeFixture(null, 59),
    });
    await submitPrimaryTask({
      gateway: latestGateway,
      snapshot: conflict!.snapshot,
      reporterBindingId: "binding-student-xunpu",
    });
    expect(latestRecord).toHaveBeenCalledWith(
      expect.objectContaining({ expectedStateVersion: 58 }),
      undefined,
    );
  });
});
