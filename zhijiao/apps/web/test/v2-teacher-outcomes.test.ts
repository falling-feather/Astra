import { describe, expect, it, vi } from "vitest";
import { GatewayHttpError } from "../src/v2/gateway";
import type { TeacherGateway } from "../src/v2/teacher-gateway";
import {
  finalizeTeacherReview,
  loadTeacherReviewQueue,
  loadTeacherReviewSelection,
  TeacherOutcomeConflictError,
} from "../src/v2/teacher-outcome-loaders";
import { teacherCourseView } from "../src/v2/teacher-models";
import { courseReleaseSummaryFixture } from "./v2-student.fixture";
import {
  teacherEpisodeFixture,
  teacherOutcomeReceiptFixture,
  teacherReviewTasksFixture,
  teacherReviewWorkspaceFixture,
  teacherSessionOverviewFixture,
} from "./v2-teacher-admin.fixture";

function gatewayFixture(overrides: Partial<TeacherGateway> = {}): TeacherGateway {
  return {
    getSessionOverview: async () => teacherSessionOverviewFixture(),
    getCourses: async () => [teacherCourseView(courseReleaseSummaryFixture())],
    getEpisode: async () => teacherEpisodeFixture(),
    getReviewTasks: async () => teacherReviewTasksFixture(),
    getCourseReview: async () => teacherReviewWorkspaceFixture(),
    finalizeReview: async () => teacherOutcomeReceiptFixture(),
    decideGate: async () => undefined,
    ...overrides,
  };
}

describe("V2 teacher course review authority", () => {
  it("maps learner references to anonymous labels and keeps the signed task internal", async () => {
    const queue = await loadTeacherReviewQueue(
      gatewayFixture(),
      "session-xunpu-001",
      "binding-teacher-a",
    );
    expect(queue.tasks).toEqual([
      expect.objectContaining({
        learnerLabel: "学员 01",
        courseTitle: "泉州蟳埔簪花围非遗专题采编实战",
        status: "awaiting_review",
      }),
    ]);
    expect(queue.tasks[0]?.learnerLabel).not.toContain("principal-");
  });

  it("never reads a workspace for a task id absent from the server list", async () => {
    const getCourseReview = vi.fn();
    await expect(loadTeacherReviewSelection(
      gatewayFixture({ getCourseReview }),
      "session-xunpu-001",
      "binding-teacher-a",
      "forged-review-task",
    )).rejects.toThrow(/不在服务端任务列表/u);
    expect(getCourseReview).not.toHaveBeenCalled();
  });

  it("fails closed when the workspace enrollment version drifts from the signed task", async () => {
    const workspace = teacherReviewWorkspaceFixture();
    workspace.enrollment.stateVersion += 1;
    await expect(loadTeacherReviewSelection(
      gatewayFixture({ getCourseReview: async () => workspace }),
      "session-xunpu-001",
      "binding-teacher-a",
      null,
    )).rejects.toThrow(/签发任务不一致/u);
  });

  it("finalizes without client score and confirms only after task/workspace reread", async () => {
    let completed = false;
    const finalizeReview = vi.fn(async () => {
      completed = true;
      return teacherOutcomeReceiptFixture();
    });
    const gateway = gatewayFixture({
      getReviewTasks: async () => teacherReviewTasksFixture(
        completed ? "completed" : "awaiting_review",
      ),
      getCourseReview: async () => teacherReviewWorkspaceFixture(
        completed ? "completed" : "awaiting_review",
      ),
      finalizeReview,
    });
    const initial = await loadTeacherReviewSelection(
      gateway,
      "session-xunpu-001",
      "binding-teacher-a",
      null,
    );
    if (!initial.workspace) throw new Error("fixture did not load");
    const confirmed = await finalizeTeacherReview(
      gateway,
      "session-xunpu-001",
      "binding-teacher-a",
      initial.workspace,
      "request-teacher-review-001",
      undefined,
      async () => undefined,
    );
    expect(confirmed.workspace?.status).toBe("completed");
    expect(finalizeReview).toHaveBeenCalledWith({
      sessionId: "session-xunpu-001",
      bindingId: "binding-teacher-a",
      reviewTaskId: "review-task-xunpu-001",
      expectedEnrollmentStateVersion: 19,
      requestId: "request-teacher-review-001",
    }, undefined);
  });

  it("fails closed on 409 and returns the latest signed selection", async () => {
    const gateway = gatewayFixture({
      finalizeReview: async () => {
        throw new GatewayHttpError(409, "state moved", "version_conflict");
      },
    });
    const initial = await loadTeacherReviewSelection(
      gateway,
      "session-xunpu-001",
      "binding-teacher-a",
      null,
    );
    if (!initial.workspace) throw new Error("fixture did not load");
    const error = await finalizeTeacherReview(
      gateway,
      "session-xunpu-001",
      "binding-teacher-a",
      initial.workspace,
      "request-teacher-review-001",
    ).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(TeacherOutcomeConflictError);
    expect((error as TeacherOutcomeConflictError).latest.workspace?.status)
      .toBe("awaiting_review");
  });
});
