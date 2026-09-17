import type { CourseReviewWorkspace } from "@ronggang/contracts";
import { GatewayHttpError } from "./gateway";
import type { StudentReviewDimensionView } from "./models";
import { courseReviewResultKind } from "./models";
import {
  TeacherGateConfirmationError,
  type TeacherGateway,
} from "./teacher-gateway";
import type {
  TeacherCourseView,
  TeacherReviewFinalizeInput,
  TeacherReviewQueueView,
  TeacherReviewTaskView,
  TeacherReviewWorkspaceView,
} from "./teacher-models";
import { sameCourseReleaseReference } from "./models";

function courseForTask(
  courses: readonly TeacherCourseView[],
  task: { courseReleaseRef: TeacherReviewTaskView["courseReleaseRef"] },
): TeacherCourseView {
  const matches = courses.filter((course) => (
    sameCourseReleaseReference(course.courseReleaseRef, task.courseReleaseRef)
  ));
  if (matches.length !== 1) {
    throw new TeacherGateConfirmationError(
      "复核任务与冻结课程目录不一致，已停止加载。",
    );
  }
  return matches[0]!;
}

export async function loadTeacherReviewQueue(
  gateway: TeacherGateway,
  sessionId: string,
  bindingId: string,
  signal?: AbortSignal,
): Promise<TeacherReviewQueueView> {
  const [tasks, courses] = await Promise.all([
    gateway.getReviewTasks(sessionId, bindingId, signal),
    gateway.getCourses(signal),
  ]);
  if (tasks.sessionId !== sessionId) {
    throw new TeacherGateConfirmationError("复核任务列表与课堂会话不一致。");
  }
  const learnerLabels = new Map<string, string>();
  const labelFor = (learnerRef: string) => {
    const known = learnerLabels.get(learnerRef);
    if (known) return known;
    const label = `学员 ${String(learnerLabels.size + 1).padStart(2, "0")}`;
    learnerLabels.set(learnerRef, label);
    return label;
  };
  return {
    sessionId,
    tasks: tasks.items.map((task) => {
      const course = courseForTask(courses, task);
      return {
        reviewTaskId: task.reviewTaskId,
        enrollmentId: task.enrollmentId,
        courseReleaseRef: task.courseReleaseRef,
        courseTitle: course.title,
        learnerLabel: labelFor(task.learnerRef),
        status: task.status,
        stateVersion: task.stateVersion,
        submittedAt: task.submittedAt,
        completedAt: task.completedAt,
      };
    }),
  };
}

function submissionView(
  workspace: CourseReviewWorkspace,
): TeacherReviewWorkspaceView["submission"] {
  if (workspace.submission === null) {
    throw new TeacherGateConfirmationError("教师复核任务缺少冻结成果提交。");
  }
  return {
    submittedAt: workspace.submission.submittedAt,
    deliverableCount: workspace.submission.deliverableIds.length,
    portfolioItemCount: workspace.submission.portfolioItemIds.length,
    evidenceCount: workspace.submission.evidenceIds.length,
    rubricChapterCount: workspace.submission.rubric.length,
  };
}

function resultView(
  workspace: CourseReviewWorkspace,
): TeacherReviewWorkspaceView["result"] {
  if (workspace.review === null) return null;
  return {
    kind: courseReviewResultKind(workspace.review.reviewId),
    finalScore: workspace.review.finalScore,
    publicSummary: workspace.review.publicSummary,
    finalizedAt: workspace.review.finalizedAt,
    dimensions: workspace.review.dimensions.map((dimension): StudentReviewDimensionView => ({
      key: dimension.dimensionId,
      label: dimension.label,
      score: dimension.score,
      maxScore: dimension.maxScore,
      feedback: dimension.feedback,
      evidenceCount: dimension.evidenceRefs.length,
    })),
  };
}

export async function loadTeacherReviewWorkspace(
  gateway: TeacherGateway,
  sessionId: string,
  bindingId: string,
  task: TeacherReviewTaskView,
  signal?: AbortSignal,
): Promise<TeacherReviewWorkspaceView> {
  const workspace = await gateway.getCourseReview(
    sessionId,
    bindingId,
    task.reviewTaskId,
    signal,
  );
  if (
    workspace.viewer !== "teacher"
    || workspace.status === "not_submitted"
    || workspace.status !== task.status
    || workspace.enrollment.enrollmentId !== task.enrollmentId
    || workspace.enrollment.activeSessionId !== sessionId
    || workspace.enrollment.stateVersion !== task.stateVersion
    || !sameCourseReleaseReference(
      workspace.enrollment.courseReleaseRef,
      task.courseReleaseRef,
    )
    || workspace.submission.reviewTaskId !== task.reviewTaskId
  ) {
    throw new TeacherGateConfirmationError(
      "复核工作区与服务端签发任务不一致，已停止加载。",
    );
  }
  return {
    task,
    enrollmentStateVersion: workspace.enrollment.stateVersion,
    status: workspace.status,
    submission: submissionView(workspace),
    result: resultView(workspace),
  };
}

export interface TeacherReviewSelection {
  queue: TeacherReviewQueueView;
  workspace: TeacherReviewWorkspaceView | null;
}

export async function loadTeacherReviewSelection(
  gateway: TeacherGateway,
  sessionId: string,
  bindingId: string,
  selectedTaskId: string | null,
  signal?: AbortSignal,
): Promise<TeacherReviewSelection> {
  const queue = await loadTeacherReviewQueue(
    gateway,
    sessionId,
    bindingId,
    signal,
  );
  if (queue.tasks.length === 0) return { queue, workspace: null };
  const selected = selectedTaskId
    ? queue.tasks.find((task) => task.reviewTaskId === selectedTaskId)
    : queue.tasks.find((task) => task.status === "awaiting_review")
      ?? queue.tasks[0];
  if (!selected) {
    throw new TeacherGateConfirmationError(
      "所选复核任务已不在服务端任务列表中，已停止加载。",
    );
  }
  return {
    queue,
    workspace: await loadTeacherReviewWorkspace(
      gateway,
      sessionId,
      bindingId,
      selected,
      signal,
    ),
  };
}

export class TeacherOutcomeConflictError extends TeacherGateConfirmationError {
  constructor(
    message: string,
    readonly latest: TeacherReviewSelection,
  ) {
    super(message);
    this.name = "TeacherOutcomeConflictError";
  }
}

async function rereadFinalizedReview(
  gateway: TeacherGateway,
  input: TeacherReviewFinalizeInput,
  receiptStateVersion: number,
  signal?: AbortSignal,
  wait: (milliseconds: number) => Promise<void> = (milliseconds) => (
    new Promise((resolve) => setTimeout(resolve, milliseconds))
  ),
): Promise<TeacherReviewSelection> {
  let latest: TeacherReviewSelection | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) await wait(250 * attempt);
    latest = await loadTeacherReviewSelection(
      gateway,
      input.sessionId,
      input.bindingId,
      input.reviewTaskId,
      signal,
    );
    if (
      latest.workspace?.status === "completed"
      && latest.workspace.enrollmentStateVersion >= receiptStateVersion
    ) return latest;
  }
  throw new TeacherGateConfirmationError(
    "服务端尚未确认课程复核，页面未显示成功。",
  );
}

export async function finalizeTeacherReview(
  gateway: TeacherGateway,
  sessionId: string,
  bindingId: string,
  workspace: TeacherReviewWorkspaceView,
  requestId: string,
  signal?: AbortSignal,
  wait?: (milliseconds: number) => Promise<void>,
): Promise<TeacherReviewSelection> {
  if (workspace.status !== "awaiting_review") {
    throw new TeacherGateConfirmationError("当前复核任务已经完成，不能重复提交。");
  }
  const input: TeacherReviewFinalizeInput = {
    sessionId,
    bindingId,
    reviewTaskId: workspace.task.reviewTaskId,
    expectedEnrollmentStateVersion: workspace.enrollmentStateVersion,
    requestId,
  };
  let receipt: Awaited<ReturnType<TeacherGateway["finalizeReview"]>>;
  try {
    receipt = await gateway.finalizeReview(input, signal);
  } catch (cause) {
    if (cause instanceof GatewayHttpError && cause.status === 409) {
      const latest = await loadTeacherReviewSelection(
        gateway,
        sessionId,
        bindingId,
        workspace.task.reviewTaskId,
        signal,
      );
      throw new TeacherOutcomeConflictError(
        "复核任务状态已更新，本次操作未生效；页面已刷新。",
        latest,
      );
    }
    throw cause;
  }
  if (
    receipt.requestId !== requestId
    || receipt.sessionId !== sessionId
    || receipt.enrollmentId !== workspace.task.enrollmentId
    || receipt.status !== "completed"
    || receipt.stateVersion <= workspace.enrollmentStateVersion
  ) {
    throw new TeacherGateConfirmationError("复核回执与当前任务不一致。");
  }
  return rereadFinalizedReview(
    gateway,
    input,
    receipt.stateVersion,
    signal,
    wait,
  );
}
