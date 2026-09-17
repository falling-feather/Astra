import type {
  CourseEnrollment,
  CourseProgressItem,
  CourseProgressList,
  CourseReleaseReference,
  LearningActivity,
  StudentCollaborationEpisode,
  StudentTrainingContext,
} from "@ronggang/contracts";
import { GatewayHttpError, type ExperienceGateway } from "./gateway";
import type {
  ActiveTrainingView,
  AdviceDecision,
  CourseReleaseSummary,
  CourseReleaseDetailView,
  EnrolledCourseView,
  StudentCourseDetailView,
  StudentCourseLanding,
  StudentCourseProgressView,
  TrainingLoad,
  TrainingSnapshot,
} from "./models";
import { sameCourseReleaseReference } from "./models";

export class ExperienceDriftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExperienceDriftError";
  }
}

export class TrainingConsistencyError extends ExperienceDriftError {
  constructor(message: string) {
    super(message);
    this.name = "TrainingConsistencyError";
  }
}

export class AuthorityConfirmationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthorityConfirmationError";
  }
}

export class AuthorityConflictError extends AuthorityConfirmationError {
  constructor(
    message: string,
    readonly snapshot: TrainingSnapshot,
  ) {
    super(message);
    this.name = "AuthorityConflictError";
  }
}

function releaseReferenceOf(
  course: CourseReleaseSummary,
): CourseReleaseReference {
  return {
    courseId: course.courseId,
    releaseId: course.releaseId,
    version: course.version,
    contentHash: course.contentHash,
  };
}

function findFrozenCourse(
  courses: readonly CourseReleaseSummary[],
  ref: CourseReleaseReference,
): CourseReleaseSummary {
  const course = courses.find((candidate) => (
    sameCourseReleaseReference(releaseReferenceOf(candidate), ref)
  ));
  if (!course) {
    throw new ExperienceDriftError(
      "课程认领记录与当前发布目录不一致，已停止加载。",
    );
  }
  return course;
}

function sameEnrollmentSnapshot(
  left: CourseEnrollment,
  right: CourseEnrollment,
  compareBinding = true,
): boolean {
  return left.enrollmentId === right.enrollmentId
    && (!compareBinding || left.bindingId === right.bindingId)
    && sameCourseReleaseReference(left.courseReleaseRef, right.courseReleaseRef)
    && left.primaryJobId === right.primaryJobId
    && left.primaryRoleId === right.primaryRoleId
    && left.status === right.status
    && left.activeSessionId === right.activeSessionId
    && left.claimedAt === right.claimedAt
    && left.startedAt === right.startedAt
    && left.submittedAt === right.submittedAt
    && left.completedAt === right.completedAt
    && left.stateVersion === right.stateVersion
    && left.updatedAt === right.updatedAt;
}

export function studentCourseProgressView(
  progress: CourseProgressItem,
): StudentCourseProgressView {
  const completedChapterCount = progress.completedChapterIds.length;
  return {
    chapterCount: progress.chapterCount,
    completedChapterCount,
    currentChapterId: progress.currentChapterId,
    submittedDeliverableCount: progress.submittedDeliverableCount,
    portfolioItemCount: progress.portfolioItemCount,
    evidenceCount: progress.evidenceCount,
    reviewStatus: progress.reviewStatus,
    readyForSubmission: progress.enrollment.status === "in_progress"
      && completedChapterCount === progress.chapterCount
      && progress.currentChapterId === null
      && progress.submittedDeliverableCount > 0
      && progress.portfolioItemCount > 0
      && progress.evidenceCount > 0,
  };
}

export function findEnrollmentProgress(
  enrollment: CourseEnrollment,
  progress: CourseProgressList,
): CourseProgressItem {
  const matches = progress.items.filter((item) => (
    item.enrollment.enrollmentId === enrollment.enrollmentId
  ));
  if (matches.length !== 1 || !sameEnrollmentSnapshot(matches[0]!.enrollment, enrollment)) {
    throw new ExperienceDriftError(
      "课程进度与认领权威快照不一致，已停止加载。",
    );
  }
  return matches[0]!;
}

export function joinEnrollmentsWithCourses(
  enrollments: readonly CourseEnrollment[],
  courses: readonly CourseReleaseSummary[],
  progress: CourseProgressList,
): EnrolledCourseView[] {
  if (progress.items.length !== enrollments.length) {
    throw new ExperienceDriftError("课程进度数量与认领记录不一致，已停止加载。");
  }
  return enrollments.map((enrollment) => ({
    enrollment,
    course: findFrozenCourse(courses, enrollment.courseReleaseRef),
    progress: studentCourseProgressView(findEnrollmentProgress(enrollment, progress)),
  }));
}

async function authorizeEnrollmentSession(
  gateway: ExperienceGateway,
  enrollments: readonly CourseEnrollment[],
  target: CourseEnrollment,
  signal?: AbortSignal,
): Promise<{
  sessionId: string | null;
  enrollments: readonly CourseEnrollment[];
}> {
  const sessionId = target.activeSessionId;
  if (sessionId === null) return { sessionId, enrollments };
  const bindingId = await gateway.authorizeSession(sessionId, signal);
  const refreshed = await gateway.getEnrollments(signal);
  const sameAuthority = refreshed.length === enrollments.length
    && enrollments.every((before) => {
      const matches = refreshed.filter((after) => (
        after.enrollmentId === before.enrollmentId
      ));
      return matches.length === 1
        && sameEnrollmentSnapshot(before, matches[0]!, false);
    });
  const activeEnrollment = refreshed.filter((enrollment) => (
    enrollment.enrollmentId === target.enrollmentId
    && enrollment.activeSessionId === sessionId
    && sameCourseReleaseReference(
      enrollment.courseReleaseRef,
      target.courseReleaseRef,
    )
  ));
  if (
    !sameAuthority
    || activeEnrollment.length !== 1
    || activeEnrollment[0]!.bindingId !== bindingId
  ) {
    throw new ExperienceDriftError(
      "会话授权后的课程认领快照发生漂移，成果读取已停止。",
    );
  }
  return { sessionId, enrollments: refreshed };
}

/**
 * A course detail page already supplies the authority selector: its immutable
 * course id. Re-authorize only that enrollment even when the learner has
 * other active courses. Account-wide progress and portfolio reads use the
 * principal-owned `/api/me/*` surfaces and therefore do not mint a session
 * binding at all.
 */
export async function authorizeStudentCourseSession(
  gateway: ExperienceGateway,
  enrollments: readonly CourseEnrollment[],
  courseId: string,
  signal?: AbortSignal,
): Promise<{
  sessionId: string | null;
  enrollments: readonly CourseEnrollment[];
}> {
  const matches = enrollments.filter((enrollment) => (
    enrollment.courseReleaseRef.courseId === courseId
  ));
  if (matches.length !== 1) {
    throw new ExperienceDriftError(
      "当前课程认领记录不唯一，已停止加载。",
    );
  }
  return authorizeEnrollmentSession(
    gateway,
    enrollments,
    matches[0]!,
    signal,
  );
}

/** Empty enrollments stop before catalog or any session-scoped read. */
export async function loadStudentCourseLanding(
  gateway: ExperienceGateway,
  signal?: AbortSignal,
): Promise<StudentCourseLanding> {
  const enrollments = await gateway.getEnrollments(signal);
  if (enrollments.length === 0) return { state: "empty" };
  const [courses, progress] = await Promise.all([
    gateway.getCourses(signal),
    gateway.getCourseProgress(signal),
  ]);
  return {
    state: "enrolled",
    courses: joinEnrollmentsWithCourses(
      enrollments,
      courses,
      progress,
    ),
  };
}

function sourceView(
  source: CourseReleaseDetailView["sources"][number],
): StudentCourseDetailView["sources"][number] {
  return {
    sourceId: source.sourceId,
    title: source.title,
    publisher: source.publisher,
    url: source.url,
    locator: source.locator,
    sourceVersion: source.sourceVersion,
    reviewStatus: source.reviewStatus,
  };
}

export function deriveStudentCourseDetail(
  release: CourseReleaseDetailView,
  enrollments: readonly CourseEnrollment[],
  progress: CourseProgressItem | null = null,
): StudentCourseDetailView {
  const matches = enrollments.filter((enrollment) => (
    enrollment.courseReleaseRef.courseId === release.courseId
  ));
  if (matches.length > 1) {
    throw new ExperienceDriftError("同一课程存在多条认领记录，已停止加载。");
  }
  const enrollment = matches[0] ?? null;
  if ((enrollment === null) !== (progress === null)) {
    throw new ExperienceDriftError("课程详情与进度认领状态不一致，已停止加载。");
  }
  if (enrollment) {
    assertRelease(
      enrollment.courseReleaseRef,
      {
        courseId: release.courseId,
        releaseId: release.releaseId,
        version: release.version,
        contentHash: release.contentHash,
      },
      "课程详情",
    );
    if (!sameEnrollmentSnapshot(progress!.enrollment, enrollment)) {
      throw new ExperienceDriftError("课程详情进度与认领快照不一致，已停止加载。");
    }
  }
  const sources = release.sources.map(sourceView);
  const sourceById = new Map(sources.map((source) => [source.sourceId, source]));
  return {
    courseId: release.courseId,
    courseReleaseId: release.courseReleaseId,
    version: release.version,
    title: release.title,
    summary: release.summary,
    primaryJob: release.primaryJob,
    publishedAt: release.publishedAt,
    sources,
    chapters: release.chapters.map((chapter) => ({
      chapterId: chapter.chapterId,
      order: chapter.order,
      title: chapter.title,
      objective: chapter.objective,
      taskBrief: chapter.taskBrief,
      publicSources: chapter.publicSourceRefs.map((sourceId) => {
        const source = sourceById.get(sourceId);
        if (!source) {
          throw new ExperienceDriftError("课程章节引用了未登记的公开来源。");
        }
        return source;
      }),
      evidenceRequirements: [...chapter.evidenceRequirements],
      rubricCriteria: chapter.rubricCriteria.map((criterion) => ({
        criterionId: criterion.criterionId,
        title: criterion.title,
        description: criterion.description,
        weight: criterion.weight,
      })),
      transferReflection: chapter.transferReflection,
      finalChapter: chapter.finalChapter,
    })),
    enrollment,
    progress: progress ? studentCourseProgressView(progress) : null,
  };
}

export async function loadStudentCourseDetail(
  gateway: ExperienceGateway,
  courseId: string,
  signal?: AbortSignal,
): Promise<StudentCourseDetailView> {
  const [release, enrollments] = await Promise.all([
    gateway.getCourse(courseId, signal),
    gateway.getEnrollments(signal),
  ]);
  if (release.courseId !== courseId) {
    throw new ExperienceDriftError("课程详情与请求课程不一致，已停止加载。");
  }
  const enrollment = enrollments.find((candidate) => (
    candidate.courseReleaseRef.courseId === release.courseId
  ));
  if (!enrollment) return deriveStudentCourseDetail(release, enrollments);
  const authorized = await authorizeStudentCourseSession(
    gateway,
    enrollments,
    release.courseId,
    signal,
  );
  const progress = await gateway.getCourseProgress(signal);
  const authorizedEnrollment = authorized.enrollments.find((candidate) => (
    candidate.courseReleaseRef.courseId === release.courseId
  ));
  if (!authorizedEnrollment) {
    throw new ExperienceDriftError(
      "会话授权后课程认领记录消失，已停止加载。",
    );
  }
  return deriveStudentCourseDetail(
    release,
    authorized.enrollments,
    findEnrollmentProgress(authorizedEnrollment, progress),
  );
}

const enrollmentStatusRank: Record<CourseEnrollment["status"], number> = {
  claimed: 0,
  in_progress: 1,
  awaiting_review: 2,
  completed: 3,
};

export async function claimStudentCourse(
  gateway: ExperienceGateway,
  detail: StudentCourseDetailView,
  signal?: AbortSignal,
): Promise<StudentCourseDetailView> {
  if (detail.enrollment) return detail;
  const receipt = await gateway.claimCourse(detail.courseReleaseId, signal);
  const refreshed = await loadStudentCourseDetail(
    gateway,
    detail.courseId,
    signal,
  );
  const enrollment = refreshed.enrollment;
  if (
    !enrollment
    || enrollment.enrollmentId !== receipt.enrollmentId
    || !sameCourseReleaseReference(
      enrollment.courseReleaseRef,
      receipt.courseReleaseRef,
    )
    || enrollment.stateVersion < receipt.stateVersion
    || enrollmentStatusRank[enrollment.status] < enrollmentStatusRank[receipt.status]
  ) {
    throw new AuthorityConfirmationError(
      "服务端尚未确认课程认领，页面未显示成功。",
    );
  }
  return refreshed;
}

function assertRelease(
  actual: CourseReleaseReference,
  expected: CourseReleaseReference,
  label: string,
): void {
  if (!sameCourseReleaseReference(actual, expected)) {
    throw new TrainingConsistencyError(`${label}与认领课程发布引用不一致。`);
  }
}

function assertTrainingTriplet(input: {
  activity: LearningActivity;
  context: StudentTrainingContext;
  episode: StudentCollaborationEpisode;
  enrollment: CourseEnrollment;
  sessionId: string;
  bindingId: string;
}): void {
  const { activity, context, episode, enrollment, sessionId, bindingId } = input;
  if (activity.status === "empty" || activity.status === "ready") {
    throw new TrainingConsistencyError(
      "活动会话返回了不可进入训练现场的状态。",
    );
  }
  if (
    activity.bindingId !== bindingId
    || activity.enrollment.bindingId !== bindingId
    || context.bindingId !== bindingId
  ) {
    throw new TrainingConsistencyError("训练三联响应岗位绑定不一致。");
  }
  if (
    activity.sessionId !== sessionId
    || context.sessionId !== sessionId
    || episode.sessionId !== sessionId
    || enrollment.activeSessionId !== sessionId
  ) {
    throw new TrainingConsistencyError("训练三联响应会话不一致。");
  }
  if (
    activity.enrollment.enrollmentId !== enrollment.enrollmentId
    || activity.enrollment.status !== enrollment.status
    || activity.enrollment.activeSessionId !== enrollment.activeSessionId
  ) {
    throw new TrainingConsistencyError("学习活动与认领生命周期不一致。");
  }
  assertRelease(activity.courseReleaseRef, enrollment.courseReleaseRef, "学习活动");
  assertRelease(context.courseReleaseRef, enrollment.courseReleaseRef, "训练现场");
  assertRelease(episode.courseReleaseRef, enrollment.courseReleaseRef, "协作建议");
  if (
    activity.stateVersion !== context.stateVersion
    || episode.stateVersion !== context.stateVersion
  ) {
    throw new TrainingConsistencyError("活动、现场与建议不在同一状态版本。");
  }
  if (episode.scenarioId !== context.scenarioReleaseRef.scenarioId) {
    throw new TrainingConsistencyError("训练现场与建议情境发布引用不一致。");
  }
  if (
    activity.status === "active"
    && activity.currentTask.sceneId !== context.scene.sceneId
  ) {
    throw new TrainingConsistencyError("当前任务与训练现场场景不一致。");
  }
  if (episode.status === "failed") {
    throw new ExperienceDriftError(
      episode.failure?.message ?? "协作建议读取失败，已停止交互。",
    );
  }
}

async function readConsistentTrainingTriplet(input: {
  gateway: ExperienceGateway;
  enrollment: CourseEnrollment;
  sessionId: string;
  bindingId: string;
  signal?: AbortSignal;
}): Promise<Pick<TrainingSnapshot, "activity" | "context" | "episode">> {
  let lastDrift: TrainingConsistencyError | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const [activity, context, episode] = await Promise.all([
      input.gateway.getLearningActivity(
        input.sessionId,
        input.bindingId,
        input.signal,
      ),
      input.gateway.getStudentTrainingContext(
        input.sessionId,
        input.bindingId,
        input.signal,
      ),
      input.gateway.getStudentEpisode(
        input.sessionId,
        input.bindingId,
        input.signal,
      ),
    ]);
    try {
      assertTrainingTriplet({
        activity,
        context,
        episode,
        enrollment: input.enrollment,
        sessionId: input.sessionId,
        bindingId: input.bindingId,
      });
      return { activity, context, episode };
    } catch (cause) {
      if (!(cause instanceof TrainingConsistencyError)) throw cause;
      lastDrift = cause;
      // Event-wave handlers can legitimately advance the WorldEngine for about
      // one second after a student mutation. Keep the read bound at three
      // snapshots, but space retries so the final read observes the settled
      // authoritative version instead of burning all attempts immediately.
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 750 * (attempt + 1)));
      }
    }
  }
  throw new ExperienceDriftError(
    `${lastDrift?.message ?? "训练响应不一致"} 已重读 3 次并失败关闭。`,
  );
}

export async function resolveTrainingLoad(
  gateway: ExperienceGateway,
  sessionId: string,
  reporterBindingId: string,
  signal?: AbortSignal,
): Promise<TrainingLoad> {
  const enrollments = await gateway.getEnrollments(signal);
  const enrollment = enrollments.find((candidate) => (
    candidate.activeSessionId === sessionId
  ));
  if (!enrollment) return { state: "not-enrolled" };
  if (
    enrollment.status === "claimed"
    || enrollment.bindingId !== reporterBindingId
  ) {
    throw new ExperienceDriftError(
      "当前登录岗位与课程认领绑定不一致，已停止加载。",
    );
  }

  const courses = await gateway.getCourses(signal);
  const course = findFrozenCourse(courses, enrollment.courseReleaseRef);
  const triplet = await readConsistentTrainingTriplet({
    gateway,
    enrollment,
    sessionId,
    bindingId: reporterBindingId,
    ...(signal ? { signal } : {}),
  });
  return {
    state: "ready",
    snapshot: { enrollment, course, ...triplet },
  };
}

export function deriveActiveTrainingView(
  snapshot: TrainingSnapshot,
): ActiveTrainingView {
  const { activity, context, episode } = snapshot;
  if (activity.status !== "active") {
    throw new ExperienceDriftError("当前学习活动不是可交互状态。");
  }
  return {
    sessionId: activity.sessionId,
    bindingId: activity.bindingId,
    stateVersion: context.stateVersion,
    courseTitle: snapshot.course.title,
    chapterCount: snapshot.course.chapterCount,
    remainingMinutes: context.remainingMinutes,
    task: {
      ...activity.currentTask,
      guideSteps: activity.guideSteps,
    },
    scene: {
      ...context.scene,
      hotspots: context.hotspots,
    },
    worldEvents: context.eventCards.map((event) => ({
      eventId: event.eventRef,
      title: event.title,
      detail: event.changes.join("；"),
      tone: event.tone,
    })),
    advice: episode.suggestion ? {
      suggestionId: episode.suggestion.suggestionId,
      agentName: episode.suggestion.agent.title,
      summary: episode.suggestion.summary,
      rationale: episode.suggestion.rationale,
      evidenceRefs: episode.suggestion.evidenceRefs,
      riskLevel: episode.suggestion.riskLevel,
      allowedDecisions: episode.suggestion.allowedDecisions,
      decided: episode.studentDecision?.decision ?? null,
    } : null,
    primaryAction: context.currentAction,
  };
}

export interface ReloadTrainingInput {
  gateway: ExperienceGateway;
  snapshot: TrainingSnapshot;
  reporterBindingId: string;
  signal?: AbortSignal;
}

async function reloadReadyTraining(
  input: ReloadTrainingInput,
): Promise<TrainingSnapshot> {
  const result = await resolveTrainingLoad(
    input.gateway,
    input.snapshot.context.sessionId,
    input.reporterBindingId,
    input.signal,
  );
  if (result.state !== "ready") {
    throw new AuthorityConfirmationError(
      "操作后无法重新读取当前课程，未显示成功。",
    );
  }
  return result.snapshot;
}

async function mutateThenReload(
  input: ReloadTrainingInput,
  mutation: () => Promise<void>,
): Promise<TrainingSnapshot> {
  try {
    await mutation();
    // A successful WorldEngine write can enqueue a short, deterministic agent
    // event wave. Read after that wave has had time to settle so the next
    // student action does not inherit the mutation receipt's transient version.
    await new Promise((resolve) => setTimeout(resolve, 1_600));
  } catch (cause) {
    if (cause instanceof GatewayHttpError && cause.status === 409) {
      await new Promise((resolve) => setTimeout(resolve, 1_600));
      const refreshed = await reloadReadyTraining(input);
      throw new AuthorityConflictError(
        "状态已在后台前移，本次操作未生效；页面已刷新到最新状态。",
        refreshed,
      );
    }
    throw cause;
  }
  return reloadReadyTraining(input);
}

export async function submitAdviceDecision(
  input: ReloadTrainingInput & { decision: AdviceDecision },
): Promise<TrainingSnapshot> {
  const view = deriveActiveTrainingView(input.snapshot);
  const advice = view.advice;
  if (!advice || !advice.allowedDecisions.includes(input.decision)) {
    throw new AuthorityConfirmationError("当前建议不允许该决定。");
  }
  if (input.snapshot.episode.studentDecision) {
    throw new AuthorityConfirmationError("本章建议已经作出决定，不能改写。");
  }
  const refreshed = await mutateThenReload(input, () => (
    input.gateway.recordAdviceDecision({
      sessionId: view.sessionId,
      bindingId: view.bindingId,
      expectedStateVersion: view.stateVersion,
      suggestionId: advice.suggestionId,
      decision: input.decision,
    }, input.signal)
  ));
  if (
    refreshed.context.stateVersion <= input.snapshot.context.stateVersion
    || refreshed.episode.suggestion?.suggestionId !== advice.suggestionId
    || refreshed.episode.studentDecision?.decision !== input.decision
  ) {
    throw new AuthorityConfirmationError(
      "服务端尚未确认这次建议决定，未显示成功。",
    );
  }
  return refreshed;
}

export async function submitPrimaryTask(
  input: ReloadTrainingInput,
): Promise<TrainingSnapshot> {
  const view = deriveActiveTrainingView(input.snapshot);
  const action = view.primaryAction;
  if (!action) {
    throw new AuthorityConfirmationError("当前没有可执行的权威主行动。");
  }
  const previousEvidence = new Set(input.snapshot.context.evidenceRefs);
  const refreshed = await mutateThenReload(input, () => (
    input.gateway.recordExperienceAction({
      sessionId: view.sessionId,
      bindingId: view.bindingId,
      expectedStateVersion: view.stateVersion,
      actionRef: action.actionRef,
    }, input.signal)
  ));
  const actionChanged = refreshed.context.currentAction?.actionRef
    !== action.actionRef
    || refreshed.context.currentAction?.status !== action.status;
  const evidenceAdded = refreshed.context.evidenceRefs.some(
    (reference) => !previousEvidence.has(reference),
  );
  if (
    refreshed.context.stateVersion <= input.snapshot.context.stateVersion
    || (!actionChanged && !evidenceAdded)
  ) {
    throw new AuthorityConfirmationError(
      "服务端尚未确认主行动结果，未显示成功。",
    );
  }
  return refreshed;
}
