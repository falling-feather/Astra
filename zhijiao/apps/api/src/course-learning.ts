import { createHash } from "node:crypto";
import {
  CourseEnrollmentSchema,
  CourseEnrollmentSchemaVersion,
  CourseOutcomeMutationReceiptSchema,
  CourseOutcomeMutationReceiptSchemaVersion,
  CourseProgressListSchema,
  CourseProgressListSchemaVersion,
  CourseReleaseReferenceSchema,
  CourseReleaseSchema,
  CourseReviewWorkspaceSchema,
  CourseReviewWorkspaceSchemaVersion,
  CourseReviewResultSchema,
  CourseReviewSubmissionSchema,
  CourseReviewTaskListSchema,
  CourseReviewTaskListSchemaVersion,
  LearningActivitySchema,
  LearningActivitySchemaVersion,
  StudentPortfolioSchema,
  StudentPortfolioSchemaVersion,
  courseReleaseReferenceOf,
  type CourseEnrollment,
  type CourseOutcomeMutationReceipt,
  type CourseProgressItem,
  type CourseProgressList,
  type CourseRelease,
  type CourseReleaseReference,
  type CourseReviewResult,
  type CourseReviewSubmission,
  type CourseReviewTaskList,
  type CourseReviewWorkspace,
  type LearningActivity,
  type StudentPortfolio,
  type StudentPortfolioEvidence,
  type StudentPortfolioItem,
} from "@ronggang/contracts";
import { buildDeterministicProcessReview } from "./course-outcome-review.js";

export type CourseExperienceRole = "student" | "teacher" | "operator";

export interface CourseLearningSubject {
  principalId: string;
  profileId: string;
  role: CourseExperienceRole;
}

export interface CourseLearningBinding {
  bindingId: string;
  sessionId: string;
  actorId: string;
  actorKind: "teacher" | "student";
  roleId: string;
}

export interface CourseLaunchDefinition {
  releaseId: string;
  sessionId: string;
  reporterActorId: string;
}

export interface CourseReleaseSummaryView {
  schemaVersion: "course-release-summary/2.0.0";
  courseId: string;
  courseReleaseId: string;
  releaseId: string;
  version: number;
  contentHash: string;
  title: string;
  summary: string;
  primaryJob: CourseRelease["primaryJob"];
  chapterCount: number;
  sourceCount: number;
  publishedAt: string;
}

export interface CourseReleaseDetailView {
  schemaVersion: "course-release-detail/2.0.0";
  releaseStatus: "released";
  courseId: string;
  courseReleaseId: string;
  releaseId: string;
  version: number;
  contentHash: string;
  title: string;
  summary: string;
  primaryJob: CourseRelease["primaryJob"];
  sources: CourseRelease["sources"];
  chapters: Array<Pick<
    CourseRelease["chapters"][number],
    | "chapterId"
    | "order"
    | "title"
    | "objective"
    | "taskBrief"
    | "publicSourceRefs"
    | "deliverableIds"
    | "evidenceRequirements"
    | "rubricCriteria"
    | "transferReflection"
    | "finalChapter"
  >>;
  studentDecisionOptions: CourseRelease["studentDecisionOptions"];
  publishedAt: string;
}

export interface LearningActivityRuntimeSnapshot {
  stateVersion: number;
  sceneId: string;
  sourceEventId: string | null;
  chapterId?: string;
  priority?: "normal" | "high" | "urgent";
}

export interface LearningActivityProjectionReader {
  read(input: {
    principalId: string;
    sessionId: string;
    actorId: string;
    enrollment: CourseEnrollment;
    release: CourseRelease;
  }): Promise<LearningActivityRuntimeSnapshot>;
}

export interface CourseOutcomeArtifactSnapshot {
  artifactId: string;
  revisionId: string;
  chapterId: string;
  deliverableIds: string[];
  origin: StudentPortfolioItem["origin"];
  title: string;
  kind: StudentPortfolioItem["kind"];
  status: StudentPortfolioItem["status"];
  revisionNumber: number;
  summary: string;
  contentHash: string;
  evidenceIds: string[];
  updatedAt: string;
}

export interface CourseOutcomeEvidenceSnapshot {
  evidenceId: string;
  title: string;
  basis: string;
  artifactRevisionRefs: string[];
  createdAt: string;
}

export interface CourseOutcomeRuntimeSnapshot {
  /** Present only when a dedicated runtime owns submission and final review. */
  authoritativeCourseStatus?: "in_progress" | "awaiting_review" | "completed";
  updatedAt?: string;
  submittedAt?: string | null;
  stateVersion: number;
  scenarioStatus: "ready" | "running" | "paused" | "review" | "completed";
  currentChapterId: string | null;
  completedChapterIds: string[];
  submittedDeliverableIds: string[];
  portfolioItems: CourseOutcomeArtifactSnapshot[];
  evidence: CourseOutcomeEvidenceSnapshot[];
  review: CourseReviewResult | null;
}

export interface CourseOutcomeProjectionReader {
  isAuthoritative?(input: { sessionId: string; release: CourseRelease }): Promise<boolean> | boolean;
  read(input: {
    principalId: string;
    sessionId: string;
    actorId: string;
    enrollment: CourseEnrollment;
    release: CourseRelease;
  }): Promise<CourseOutcomeRuntimeSnapshot>;
}

export interface CompletedLearningSummary {
  portfolioItemIds: string[];
  evidenceIds: string[];
  reviewId: string;
}

export interface StoredCourseEnrollment {
  principalId: string;
  enrollment: CourseEnrollment;
  submittedDeliverableIds: string[];
  completion: CompletedLearningSummary | null;
  outcome?: StoredCourseOutcome | undefined;
}

export interface StoredCourseOutcome {
  submissionRequest: StoredOutcomeIdempotency | null;
  reviewRequest: StoredOutcomeIdempotency | null;
  submission: CourseReviewSubmission | null;
  portfolioItems: StudentPortfolioItem[];
  evidence: StudentPortfolioEvidence[];
  review: CourseReviewResult | null;
}

export interface StoredOutcomeIdempotency {
  requestId: string;
  requestHash: string;
  receipt: CourseOutcomeMutationReceipt;
}

export interface CourseEnrollmentStore {
  getByPrincipalAndCourse(
    principalId: string,
    courseId: string,
  ): Promise<StoredCourseEnrollment | null>;
  listByPrincipal(principalId: string): Promise<StoredCourseEnrollment[]>;
  getByPrincipalAndSession(
    principalId: string,
    sessionId: string,
  ): Promise<StoredCourseEnrollment | null>;
  listBySessionId(sessionId: string): Promise<StoredCourseEnrollment[]>;
  create(record: StoredCourseEnrollment): Promise<boolean>;
  compareAndSwap(input: {
    record: StoredCourseEnrollment;
    expectedStateVersion: number;
  }): Promise<boolean>;
  put(record: StoredCourseEnrollment): Promise<void>;
}

function sameStoredEnrollmentIdentity(
  left: StoredCourseEnrollment,
  right: StoredCourseEnrollment,
): boolean {
  return left.principalId === right.principalId
    && left.enrollment.enrollmentId === right.enrollment.enrollmentId
    && left.enrollment.courseReleaseRef.courseId
      === right.enrollment.courseReleaseRef.courseId
    && left.enrollment.courseReleaseRef.releaseId
      === right.enrollment.courseReleaseRef.releaseId
    && left.enrollment.courseReleaseRef.version
      === right.enrollment.courseReleaseRef.version
    && left.enrollment.courseReleaseRef.contentHash
      === right.enrollment.courseReleaseRef.contentHash
    && left.enrollment.claimedAt === right.enrollment.claimedAt
    && left.enrollment.primaryJobId === right.enrollment.primaryJobId
    && left.enrollment.primaryRoleId === right.enrollment.primaryRoleId;
}

export class InMemoryCourseEnrollmentStore implements CourseEnrollmentStore {
  readonly #records = new Map<string, StoredCourseEnrollment>();

  async getByPrincipalAndCourse(
    principalId: string,
    courseId: string,
  ): Promise<StoredCourseEnrollment | null> {
    const record = this.#records.get(`${principalId}:${courseId}`);
    return record ? structuredClone(record) : null;
  }

  async listByPrincipal(
    principalId: string,
  ): Promise<StoredCourseEnrollment[]> {
    return [...this.#records.values()]
      .filter((record) => record.principalId === principalId)
      .sort((left, right) => (
        left.enrollment.claimedAt.localeCompare(right.enrollment.claimedAt)
        || left.enrollment.enrollmentId.localeCompare(
          right.enrollment.enrollmentId,
        )
      ))
      .map((record) => structuredClone(record));
  }

  async getByPrincipalAndSession(
    principalId: string,
    sessionId: string,
  ): Promise<StoredCourseEnrollment | null> {
    const match = [...this.#records.values()].find((record) => (
      record.principalId === principalId
      && record.enrollment.activeSessionId === sessionId
    ));
    return match ? structuredClone(match) : null;
  }

  async listBySessionId(
    sessionId: string,
  ): Promise<StoredCourseEnrollment[]> {
    return [...this.#records.values()]
      .filter((record) => record.enrollment.activeSessionId === sessionId)
      .sort((left, right) => (
        left.enrollment.claimedAt.localeCompare(right.enrollment.claimedAt)
        || left.enrollment.enrollmentId.localeCompare(
          right.enrollment.enrollmentId,
        )
      ))
      .map((record) => structuredClone(record));
  }

  async create(record: StoredCourseEnrollment): Promise<boolean> {
    const key = `${record.principalId}:${record.enrollment.courseReleaseRef.courseId}`;
    if (this.#records.has(key)) return false;
    this.#records.set(key, structuredClone(record));
    return true;
  }

  async compareAndSwap(input: {
    record: StoredCourseEnrollment;
    expectedStateVersion: number;
  }): Promise<boolean> {
    const key = `${input.record.principalId}:${input.record.enrollment.courseReleaseRef.courseId}`;
    const current = this.#records.get(key);
    if (
      !current
      || current.enrollment.stateVersion !== input.expectedStateVersion
      || !sameStoredEnrollmentIdentity(current, input.record)
    ) {
      return false;
    }
    this.#records.set(key, structuredClone(input.record));
    return true;
  }

  async put(record: StoredCourseEnrollment): Promise<void> {
    this.#records.set(
      `${record.principalId}:${record.enrollment.courseReleaseRef.courseId}`,
      structuredClone(record),
    );
  }
}

export type CourseLearningErrorCode =
  | "course_not_found"
  | "enrollment_conflict"
  | "outcome_not_ready"
  | "version_hash_drift"
  | "access_denied"
  | "runtime_unavailable";

export class CourseLearningError extends Error {
  constructor(
    readonly code: CourseLearningErrorCode,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "CourseLearningError";
  }
}

export interface CourseLearningServiceOptions {
  releases: readonly CourseRelease[];
  launches?: readonly CourseLaunchDefinition[];
  enrollmentStore?: CourseEnrollmentStore;
  projectionReader?: LearningActivityProjectionReader;
  outcomeProjectionReader?: CourseOutcomeProjectionReader;
  now?: () => string;
}

function enrollmentIdFor(principalId: string, releaseId: string): string {
  return `enrollment:${createHash("sha256")
    .update(`${principalId}:${releaseId}`)
    .digest("hex")
    .slice(0, 24)}`;
}

function fallbackBindingId(enrollmentId: string): string {
  return `${enrollmentId}:pending`;
}

function reviewTaskIdFor(enrollmentId: string): string {
  return `review-task:${enrollmentId}`;
}

function learnerRefFor(principalId: string): string {
  return `learner:${createHash("sha256")
    .update(principalId)
    .digest("hex")
    .slice(0, 16)}`;
}

function requestHashFor(
  kind: "submission" | "review",
  value: Readonly<Record<string, string | number>>,
): string {
  return createHash("sha256")
    .update(JSON.stringify({ kind, ...value }))
    .digest("hex");
}

function sameReleaseRef(
  left: CourseReleaseReference,
  right: CourseReleaseReference,
): boolean {
  return left.courseId === right.courseId
    && left.releaseId === right.releaseId
    && left.version === right.version
    && left.contentHash === right.contentHash;
}

function sameStringSet(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return left.length === right.length
    && leftSet.size === left.length
    && rightSet.size === right.length
    && [...leftSet].every((value) => rightSet.has(value))
    && [...rightSet].every((value) => leftSet.has(value));
}

function toSummary(release: CourseRelease): CourseReleaseSummaryView {
  return {
    schemaVersion: "course-release-summary/2.0.0",
    courseId: release.courseId,
    courseReleaseId: release.releaseId,
    releaseId: release.releaseId,
    version: release.version,
    contentHash: release.contentHash,
    title: release.title,
    summary: release.summary,
    primaryJob: structuredClone(release.primaryJob),
    chapterCount: release.chapters.length,
    sourceCount: release.sources.length,
    publishedAt: release.publishedAt,
  };
}

function bindingForEnrollment(
  record: StoredCourseEnrollment,
  bindings: readonly CourseLearningBinding[],
): string {
  if (record.enrollment.activeSessionId === null) {
    return record.enrollment.bindingId;
  }
  return bindings.find((binding) => (
    binding.sessionId === record.enrollment.activeSessionId
    && binding.actorKind === "student"
    && binding.roleId === "reporter"
  ))?.bindingId ?? record.enrollment.bindingId;
}

function materializeEnrollment(
  record: StoredCourseEnrollment,
  bindings: readonly CourseLearningBinding[],
): CourseEnrollment {
  return CourseEnrollmentSchema.parse({
    ...record.enrollment,
    bindingId: bindingForEnrollment(record, bindings),
  });
}

function emptyStoredOutcome(): StoredCourseOutcome {
  return {
    submissionRequest: null,
    reviewRequest: null,
    submission: null,
    portfolioItems: [],
    evidence: [],
    review: null,
  };
}

function outcomeOf(record: StoredCourseEnrollment): StoredCourseOutcome {
  return record.outcome
    ? structuredClone(record.outcome)
    : emptyStoredOutcome();
}

function reporterBindingFor(
  record: StoredCourseEnrollment,
  bindings: readonly CourseLearningBinding[],
): CourseLearningBinding | null {
  const sessionId = record.enrollment.activeSessionId;
  if (!sessionId) return null;
  return bindings.find((binding) => (
    binding.sessionId === sessionId
    && binding.actorKind === "student"
    && binding.roleId === "reporter"
  )) ?? null;
}

function mapOutcomeSnapshot(input: {
  record: StoredCourseEnrollment;
  snapshot: CourseOutcomeRuntimeSnapshot;
}): Pick<StudentPortfolio, "items" | "evidence"> {
  const { enrollment } = input.record;
  const sessionId = enrollment.activeSessionId;
  if (!sessionId) {
    throw new CourseLearningError(
      "version_hash_drift",
      "课程成果不能绑定到尚未开班的认领记录",
    );
  }
  const evidence = input.snapshot.evidence.map((candidate) => ({
    evidenceId: candidate.evidenceId,
    enrollmentId: enrollment.enrollmentId,
    courseReleaseRef: enrollment.courseReleaseRef,
    sessionId,
    title: candidate.title,
    basis: candidate.basis,
    artifactRevisionRefs: [...candidate.artifactRevisionRefs],
    createdAt: candidate.createdAt,
  }));
  const items = input.snapshot.portfolioItems.map((candidate) => ({
    portfolioItemId: `portfolio:${candidate.artifactId}`,
    enrollmentId: enrollment.enrollmentId,
    courseReleaseRef: enrollment.courseReleaseRef,
    sessionId,
    artifactId: candidate.artifactId,
    revisionId: candidate.revisionId,
    chapterId: candidate.chapterId,
    deliverableIds: [...candidate.deliverableIds],
    origin: candidate.origin,
    title: candidate.title,
    kind: candidate.kind,
    status: candidate.status,
    revisionNumber: candidate.revisionNumber,
    summary: candidate.summary,
    contentHash: candidate.contentHash,
    evidenceIds: [...candidate.evidenceIds],
    updatedAt: candidate.updatedAt,
  }));
  return StudentPortfolioSchema.parse({
    schemaVersion: StudentPortfolioSchemaVersion,
    generatedAt: new Date(0).toISOString(),
    items,
    evidence,
  });
}

function receiptFor(input: {
  requestId: string;
  record: StoredCourseEnrollment;
}): CourseOutcomeMutationReceipt {
  const sessionId = input.record.enrollment.activeSessionId;
  if (
    !sessionId
    || !["awaiting_review", "completed"].includes(
      input.record.enrollment.status,
    )
  ) {
    throw new CourseLearningError(
      "version_hash_drift",
      "成果写回回执与课程生命周期不一致",
    );
  }
  return CourseOutcomeMutationReceiptSchema.parse({
    schemaVersion: CourseOutcomeMutationReceiptSchemaVersion,
    accepted: true,
    requestId: input.requestId,
    sessionId,
    enrollmentId: input.record.enrollment.enrollmentId,
    status: input.record.enrollment.status,
    stateVersion: input.record.enrollment.stateVersion,
  });
}

function ensureStudentExperience(subject: CourseLearningSubject): void {
  if (subject.role !== "student") {
    throw new CourseLearningError(
      "access_denied",
      "课程认领与学生旅程只能由显式学生体验身份访问",
    );
  }
}

export class CourseLearningService {
  readonly #releasesByCourseId = new Map<string, CourseRelease>();
  readonly #releasesByReleaseId = new Map<string, CourseRelease>();
  readonly #launchesByReleaseId = new Map<string, CourseLaunchDefinition>();
  readonly #store: CourseEnrollmentStore;
  readonly #projectionReader: LearningActivityProjectionReader | null;
  readonly #outcomeProjectionReader: CourseOutcomeProjectionReader | null;
  readonly #now: () => string;

  constructor(options: CourseLearningServiceOptions) {
    for (const candidate of options.releases) {
      const release = CourseReleaseSchema.parse(candidate);
      if (
        this.#releasesByCourseId.has(release.courseId)
        || this.#releasesByReleaseId.has(release.releaseId)
      ) {
        throw new CourseLearningError(
          "enrollment_conflict",
          "课程目录包含重复的课程或发布 ID",
          { courseId: release.courseId, releaseId: release.releaseId },
        );
      }
      this.#releasesByCourseId.set(release.courseId, release);
      this.#releasesByReleaseId.set(release.releaseId, release);
    }
    for (const launch of options.launches ?? []) {
      if (!this.#releasesByReleaseId.has(launch.releaseId)) {
        throw new CourseLearningError(
          "course_not_found",
          "课程启动映射引用了未登记的发布版",
          { releaseId: launch.releaseId },
        );
      }
      if (this.#launchesByReleaseId.has(launch.releaseId)) {
        throw new CourseLearningError(
          "enrollment_conflict",
          "同一课程发布版只能登记一个演示会话",
          { releaseId: launch.releaseId },
        );
      }
      this.#launchesByReleaseId.set(launch.releaseId, structuredClone(launch));
    }
    this.#store = options.enrollmentStore
      ?? new InMemoryCourseEnrollmentStore();
    this.#projectionReader = options.projectionReader ?? null;
    this.#outcomeProjectionReader = options.outcomeProjectionReader ?? null;
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  listCourses(): CourseReleaseSummaryView[] {
    return [...this.#releasesByCourseId.values()]
      .sort((left, right) => left.courseId.localeCompare(right.courseId))
      .map(toSummary);
  }

  getCourse(courseId: string): CourseRelease {
    const release = this.#releasesByCourseId.get(courseId);
    if (!release) {
      throw new CourseLearningError(
        "course_not_found",
        "课程不存在或尚未发布",
        { courseId },
      );
    }
    return structuredClone(release);
  }

  getCourseDetail(courseId: string): CourseReleaseDetailView {
    const release = this.getCourse(courseId);
    return {
      schemaVersion: "course-release-detail/2.0.0",
      releaseStatus: "released",
      courseId: release.courseId,
      courseReleaseId: release.releaseId,
      releaseId: release.releaseId,
      version: release.version,
      contentHash: release.contentHash,
      title: release.title,
      summary: release.summary,
      primaryJob: structuredClone(release.primaryJob),
      sources: structuredClone(release.sources),
      chapters: release.chapters.map((chapter) => ({
        chapterId: chapter.chapterId,
        order: chapter.order,
        title: chapter.title,
        objective: chapter.objective,
        taskBrief: chapter.taskBrief,
        publicSourceRefs: [...chapter.publicSourceRefs],
        deliverableIds: [...chapter.deliverableIds],
        evidenceRequirements: [...chapter.evidenceRequirements],
        rubricCriteria: structuredClone(chapter.rubricCriteria),
        transferReflection: chapter.transferReflection,
        finalChapter: chapter.finalChapter,
      })),
      studentDecisionOptions: structuredClone(release.studentDecisionOptions),
      publishedAt: release.publishedAt,
    };
  }

  getReleaseById(releaseId: string): CourseRelease {
    const release = this.#releasesByReleaseId.get(releaseId);
    if (!release) {
      throw new CourseLearningError(
        "course_not_found",
        "课程发布版不存在或尚未开放认领",
        { releaseId },
      );
    }
    return structuredClone(release);
  }

  getReleaseByReference(ref: CourseReleaseReference): CourseRelease {
    return structuredClone(this.#resolveFrozenRelease(ref));
  }

  getLaunch(releaseId: string): CourseLaunchDefinition | null {
    const launch = this.#launchesByReleaseId.get(releaseId);
    return launch ? structuredClone(launch) : null;
  }

  registerLaunch(
    courseReleaseRef: CourseReleaseReference,
    launch: CourseLaunchDefinition,
  ): CourseLaunchDefinition {
    const release = this.#resolveFrozenRelease(courseReleaseRef);
    if (launch.releaseId !== release.releaseId) {
      throw new CourseLearningError(
        "version_hash_drift",
        "课程启动映射与不可变课程发布引用不一致",
        {
          expectedReleaseId: release.releaseId,
          actualReleaseId: launch.releaseId,
        },
      );
    }
    const existing = this.#launchesByReleaseId.get(release.releaseId);
    if (existing) {
      if (
        existing.sessionId !== launch.sessionId
        || existing.reporterActorId !== launch.reporterActorId
      ) {
        throw new CourseLearningError(
          "enrollment_conflict",
          "同一课程发布版已绑定另一训练会话",
          { releaseId: release.releaseId, existing, requested: launch },
        );
      }
      return structuredClone(existing);
    }
    const frozen = structuredClone(launch);
    this.#launchesByReleaseId.set(release.releaseId, frozen);
    return structuredClone(frozen);
  }

  async findEnrollment(
    principalId: string,
    courseId: string,
  ): Promise<StoredCourseEnrollment | null> {
    return this.#store.getByPrincipalAndCourse(principalId, courseId);
  }

  async listEnrollments(input: {
    subject: CourseLearningSubject;
    bindings: readonly CourseLearningBinding[];
  }): Promise<CourseEnrollment[]> {
    ensureStudentExperience(input.subject);
    const records = await this.#store.listByPrincipal(
      input.subject.principalId,
    );
    return Promise.all(records.map(async (record) => {
      this.#assertOwnedRecord(record, input.subject.principalId);
      const runtime = await this.#readDedicatedOutcome(record, input.bindings);
      return runtime?.enrollment ?? materializeEnrollment(record, input.bindings);
    }));
  }

  async listProgress(input: {
    subject: CourseLearningSubject;
    bindings: readonly CourseLearningBinding[];
  }): Promise<CourseProgressList> {
    ensureStudentExperience(input.subject);
    const records = await this.#store.listByPrincipal(
      input.subject.principalId,
    );
    const items: CourseProgressItem[] = [];
    for (const record of records) {
      this.#assertOwnedRecord(record, input.subject.principalId);
      const enrollment = materializeEnrollment(record, input.bindings);
      const release = this.#resolveFrozenRelease(enrollment.courseReleaseRef);
      const runtime = await this.#readDedicatedOutcome(record, input.bindings);
      if (runtime) {
        items.push({
          enrollment: runtime.enrollment,
          chapterCount: release.chapters.length,
          completedChapterIds: runtime.snapshot.completedChapterIds,
          currentChapterId: runtime.snapshot.currentChapterId,
          submittedDeliverableCount: runtime.snapshot.submittedDeliverableIds.length,
          portfolioItemCount: runtime.portfolio.items.length,
          evidenceCount: runtime.portfolio.evidence.length,
          reviewStatus: runtime.enrollment.status === "in_progress" ? "not_submitted" : runtime.enrollment.status,
        });
        continue;
      }
      if (enrollment.status === "claimed") {
        items.push({
          enrollment,
          chapterCount: release.chapters.length,
          completedChapterIds: [],
          currentChapterId: null,
          submittedDeliverableCount: 0,
          portfolioItemCount: 0,
          evidenceCount: 0,
          reviewStatus: "not_submitted",
        });
        continue;
      }
      if (enrollment.status === "in_progress") {
        const actorId = this.#reporterActorIdForOwnedRead(
          record,
          release,
          input.bindings,
        );
        const snapshot = await this.#readOutcomeSnapshot({
          record,
          enrollment,
          release,
          actorId,
        });
        const portfolio = mapOutcomeSnapshot({ record, snapshot });
        items.push({
          enrollment,
          chapterCount: release.chapters.length,
          completedChapterIds: snapshot.completedChapterIds,
          currentChapterId: snapshot.currentChapterId,
          submittedDeliverableCount: snapshot.submittedDeliverableIds.length,
          portfolioItemCount: portfolio.items.length,
          evidenceCount: portfolio.evidence.length,
          reviewStatus: "not_submitted",
        });
        continue;
      }
      const outcome = this.#requireFrozenOutcome(record, release);
      items.push({
        enrollment,
        chapterCount: release.chapters.length,
        completedChapterIds: release.chapters.map((chapter) => chapter.chapterId),
        currentChapterId: null,
        submittedDeliverableCount: record.submittedDeliverableIds.length,
        portfolioItemCount: outcome.portfolioItems.length,
        evidenceCount: outcome.evidence.length,
        reviewStatus: enrollment.status === "awaiting_review"
          ? "awaiting_review"
          : "completed",
      });
    }
    return CourseProgressListSchema.parse({
      schemaVersion: CourseProgressListSchemaVersion,
      generatedAt: this.#now(),
      items,
    });
  }

  async getPortfolio(input: {
    subject: CourseLearningSubject;
    bindings: readonly CourseLearningBinding[];
  }): Promise<StudentPortfolio> {
    ensureStudentExperience(input.subject);
    const records = await this.#store.listByPrincipal(
      input.subject.principalId,
    );
    const items: StudentPortfolioItem[] = [];
    const evidence: StudentPortfolioEvidence[] = [];
    for (const record of records) {
      this.#assertOwnedRecord(record, input.subject.principalId);
      const enrollment = materializeEnrollment(record, input.bindings);
      if (enrollment.status === "claimed") continue;
      const release = this.#resolveFrozenRelease(enrollment.courseReleaseRef);
      const runtime = await this.#readDedicatedOutcome(record, input.bindings);
      if (runtime) {
        items.push(...runtime.portfolio.items);
        evidence.push(...runtime.portfolio.evidence);
        continue;
      }
      if (enrollment.status === "in_progress") {
        const actorId = this.#reporterActorIdForOwnedRead(
          record,
          release,
          input.bindings,
        );
        const snapshot = await this.#readOutcomeSnapshot({
          record,
          enrollment,
          release,
          actorId,
        });
        const mapped = mapOutcomeSnapshot({ record, snapshot });
        items.push(...mapped.items);
        evidence.push(...mapped.evidence);
        continue;
      }
      const outcome = this.#requireFrozenOutcome(record, release);
      items.push(...structuredClone(outcome.portfolioItems));
      evidence.push(...structuredClone(outcome.evidence));
    }
    return StudentPortfolioSchema.parse({
      schemaVersion: StudentPortfolioSchemaVersion,
      generatedAt: this.#now(),
      items,
      evidence,
    });
  }

  #assertOwnedRecord(
    record: StoredCourseEnrollment,
    principalId: string,
  ): void {
    if (record.principalId !== principalId) {
      throw new CourseLearningError(
        "access_denied",
        "课程聚合读取包含不属于当前主体的认领记录",
      );
    }
  }

  #reporterActorIdForOwnedRead(
    record: StoredCourseEnrollment,
    release: CourseRelease,
    bindings: readonly CourseLearningBinding[],
  ): string {
    const sessionId = record.enrollment.activeSessionId;
    if (!sessionId) {
      throw new CourseLearningError(
        "version_hash_drift",
        "进行中课程缺少冻结训练会话",
      );
    }
    const launch = this.#launchesByReleaseId.get(release.releaseId);
    const binding = reporterBindingFor(record, bindings);
    if (binding) {
      if (
        launch
        && (
          launch.sessionId !== sessionId
          || launch.reporterActorId !== binding.actorId
        )
      ) {
        throw new CourseLearningError(
          "version_hash_drift",
          "当前记者绑定与冻结课程启动映射不一致",
          { enrollmentId: record.enrollment.enrollmentId },
        );
      }
      return binding.actorId;
    }
    if (!launch) {
      throw new CourseLearningError(
        "runtime_unavailable",
        "课程发布版没有冻结的记者训练会话映射",
        { releaseId: release.releaseId },
      );
    }
    if (launch.sessionId !== sessionId) {
      throw new CourseLearningError(
        "version_hash_drift",
        "课程认领会话与冻结启动映射不一致",
        {
          enrollmentId: record.enrollment.enrollmentId,
          expectedSessionId: launch.sessionId,
          actualSessionId: sessionId,
        },
      );
    }
    return launch.reporterActorId;
  }

  async #readDedicatedOutcome(record: StoredCourseEnrollment, bindings: readonly CourseLearningBinding[]) {
    const enrollment = materializeEnrollment(record, bindings);
    const sessionId = enrollment.activeSessionId;
    if (!sessionId) return null;
    const release = this.#resolveFrozenRelease(enrollment.courseReleaseRef);
    if (!await this.#outcomeProjectionReader?.isAuthoritative?.({ sessionId, release })) return null;
    const actorId = this.#reporterActorIdForOwnedRead(record, release, bindings);
    const snapshot = await this.#readOutcomeSnapshot({ record, enrollment, release, actorId });
    const status = snapshot.authoritativeCourseStatus;
    if (!status || !snapshot.updatedAt
      || (status !== "in_progress" && !snapshot.submittedAt)
      || (status === "completed") !== (snapshot.review !== null)) {
      throw new CourseLearningError("version_hash_drift", "独立实训成果投影缺少权威生命周期依据");
    }
    const projectedEnrollment = CourseEnrollmentSchema.parse({
      ...enrollment,
      status,
      stateVersion: enrollment.stateVersion + snapshot.stateVersion,
      updatedAt: [enrollment.updatedAt, snapshot.updatedAt].sort().at(-1),
      submittedAt: status === "in_progress" ? null : snapshot.submittedAt,
      completedAt: snapshot.review?.finalizedAt ?? null,
    });
    if (projectedEnrollment.status === "claimed") {
      throw new CourseLearningError("version_hash_drift", "已运行成果不能回到未开班状态");
    }
    const portfolio = mapOutcomeSnapshot({ record, snapshot });
    const submission = status === "in_progress" ? null : CourseReviewSubmissionSchema.parse({
      submissionId: `runtime-submission:${enrollment.enrollmentId}:${createHash("sha256").update(JSON.stringify(
        snapshot.portfolioItems.filter((item) => item.status === "submitted").map((item) => item.revisionId),
      )).digest("hex").slice(0, 24)}`,
      reviewTaskId: `runtime-review:${enrollment.enrollmentId}`,
      enrollmentId: enrollment.enrollmentId,
      courseReleaseRef: enrollment.courseReleaseRef,
      sessionId,
      submittedAt: snapshot.submittedAt,
      deliverableIds: snapshot.submittedDeliverableIds,
      portfolioItemIds: portfolio.items.map((item) => item.portfolioItemId),
      evidenceIds: portfolio.evidence.map((item) => item.evidenceId),
      rubric: release.chapters.map((chapter) => ({ chapterId: chapter.chapterId, title: chapter.title, criteria: chapter.rubricCriteria })),
    });
    // This read model is rebuilt from the owning runtime; no synthetic write receipt or duplicate score is stored.
    return {
      enrollment: projectedEnrollment,
      snapshot,
      portfolio,
      submission,
      completion: snapshot.review ? {
        portfolioItemIds: portfolio.items.map((item) => item.portfolioItemId),
        evidenceIds: portfolio.evidence.map((item) => item.evidenceId),
        reviewId: snapshot.review.reviewId,
      } : null,
    };
  }

  async getReviewWorkspace(input: {
    subject: CourseLearningSubject;
    binding: CourseLearningBinding;
    sessionId: string;
    reviewTaskId?: string;
  }): Promise<CourseReviewWorkspace> {
    const viewer = input.binding.actorKind === "teacher" ? "teacher" : "student";
    const record = viewer === "student"
      ? await this.#store.getByPrincipalAndSession(
          input.subject.principalId,
          input.sessionId,
        )
      : (await this.#store.listBySessionId(input.sessionId)).find((candidate) => (
          outcomeOf(candidate).submission?.reviewTaskId === input.reviewTaskId
          || `runtime-review:${candidate.enrollment.enrollmentId}` === input.reviewTaskId
        )) ?? null;
    if (!record || record.enrollment.activeSessionId !== input.sessionId) {
      throw new CourseLearningError(
        "course_not_found",
        "训练会话没有对应的课程认领记录",
      );
    }
    if (
      input.binding.sessionId !== input.sessionId
      || (
        viewer === "student"
        && (
          input.binding.roleId !== "reporter"
          || record.principalId !== input.subject.principalId
        )
      )
      || (viewer === "teacher" && input.subject.role === "student")
    ) {
      throw new CourseLearningError(
        "access_denied",
        "复核工作区与当前课程会话或岗位不匹配",
      );
    }
    const enrollment = materializeEnrollment(
      record,
      viewer === "student" ? [input.binding] : [],
    );
    const release = this.#resolveFrozenRelease(enrollment.courseReleaseRef);
    const runtime = await this.#readDedicatedOutcome(record, viewer === "student" ? [input.binding] : []);
    if (runtime) {
      return CourseReviewWorkspaceSchema.parse({
        schemaVersion: CourseReviewWorkspaceSchemaVersion,
        viewer,
        generatedAt: this.#now(),
        enrollment: runtime.enrollment,
        status: runtime.enrollment.status === "in_progress" ? "not_submitted" : runtime.enrollment.status,
        submission: runtime.submission,
        review: runtime.snapshot.review,
      });
    }
    const shared = {
      schemaVersion: CourseReviewWorkspaceSchemaVersion,
      viewer,
      generatedAt: this.#now(),
      enrollment,
    } as const;
    if (enrollment.status === "in_progress") {
      return CourseReviewWorkspaceSchema.parse({
        ...shared,
        status: "not_submitted",
        submission: null,
        review: null,
      });
    }
    if (enrollment.status === "claimed") {
      throw new CourseLearningError(
        "course_not_found",
        "尚未开班的课程没有复核工作区",
      );
    }
    const outcome = this.#requireFrozenOutcome(record, release);
    if (!outcome.submission) {
      throw new CourseLearningError(
        "version_hash_drift",
        "待复核课程缺少服务端冻结的成果提交",
      );
    }
    if (enrollment.status === "awaiting_review") {
      return CourseReviewWorkspaceSchema.parse({
        ...shared,
        status: "awaiting_review",
        submission: outcome.submission,
        review: null,
      });
    }
    if (!outcome.review) {
      throw new CourseLearningError(
        "version_hash_drift",
        "已完成课程缺少权威评价结果",
      );
    }
    return CourseReviewWorkspaceSchema.parse({
      ...shared,
      status: "completed",
      submission: outcome.submission,
      review: outcome.review,
    });
  }

  async listReviewTasks(input: {
    subject: CourseLearningSubject;
    binding: CourseLearningBinding;
    sessionId: string;
  }): Promise<CourseReviewTaskList> {
    if (
      input.subject.role === "student"
      || input.binding.actorKind !== "teacher"
      || input.binding.sessionId !== input.sessionId
    ) {
      throw new CourseLearningError(
        "access_denied",
        "只有当前课程会话的教师或管理员体验身份可以读取复核任务",
      );
    }
    const records = await this.#store.listBySessionId(input.sessionId);
    return CourseReviewTaskListSchema.parse({
      schemaVersion: CourseReviewTaskListSchemaVersion,
      generatedAt: this.#now(),
      sessionId: input.sessionId,
      items: (await Promise.all(records.map(async (record) => {
        const runtime = await this.#readDedicatedOutcome(record, []);
        if (runtime) {
          if (!runtime.submission) return [];
          return [{
            reviewTaskId: runtime.submission.reviewTaskId,
            enrollmentId: runtime.enrollment.enrollmentId,
            learnerRef: learnerRefFor(record.principalId),
            courseReleaseRef: runtime.enrollment.courseReleaseRef,
            sessionId: input.sessionId,
            status: runtime.enrollment.status,
            stateVersion: runtime.enrollment.stateVersion,
            submittedAt: runtime.enrollment.submittedAt,
            completedAt: runtime.enrollment.completedAt,
          }];
        }
        if (![
          "awaiting_review",
          "completed",
        ].includes(record.enrollment.status)) return [];
        const release = this.#resolveFrozenRelease(
          record.enrollment.courseReleaseRef,
        );
        const outcome = this.#requireFrozenOutcome(record, release);
        const submission = outcome.submission;
        if (!submission) return [];
        return [{
          reviewTaskId: submission.reviewTaskId,
          enrollmentId: record.enrollment.enrollmentId,
          learnerRef: learnerRefFor(record.principalId),
          courseReleaseRef: record.enrollment.courseReleaseRef,
          sessionId: input.sessionId,
          status: record.enrollment.status,
          stateVersion: record.enrollment.stateVersion,
          submittedAt: record.enrollment.submittedAt,
          completedAt: record.enrollment.completedAt,
        }];
      }))).flat(),
    });
  }

  async submitForReview(input: {
    subject: CourseLearningSubject;
    binding: CourseLearningBinding;
    sessionId: string;
    expectedEnrollmentStateVersion: number;
    requestId: string;
  }): Promise<CourseOutcomeMutationReceipt> {
    ensureStudentExperience(input.subject);
    if (
      input.binding.actorKind !== "student"
      || input.binding.roleId !== "reporter"
      || input.binding.sessionId !== input.sessionId
    ) {
      throw new CourseLearningError(
        "access_denied",
        "只有当前会话的记者岗位可以提交课程成果",
      );
    }
    const requestHash = requestHashFor("submission", {
      bindingId: input.binding.bindingId,
      sessionId: input.sessionId,
      expectedEnrollmentStateVersion: input.expectedEnrollmentStateVersion,
      requestId: input.requestId,
    });
    const record = await this.#store.getByPrincipalAndSession(
      input.subject.principalId,
      input.sessionId,
    );
    if (!record) {
      throw new CourseLearningError(
        "access_denied",
        "当前记者岗位没有对应课程认领记录",
      );
    }
    const existingOutcome = outcomeOf(record);
    if (existingOutcome.submissionRequest?.requestId === input.requestId) {
      if (existingOutcome.submissionRequest.requestHash !== requestHash) {
        throw new CourseLearningError(
          "enrollment_conflict",
          "同一课程提交 requestId 不能改变请求语义",
        );
      }
      return structuredClone(existingOutcome.submissionRequest.receipt);
    }
    if (record.enrollment.status !== "in_progress") {
      throw new CourseLearningError(
        "enrollment_conflict",
        "课程成果已提交或当前状态不允许重复提交",
        { status: record.enrollment.status },
      );
    }
    if (record.enrollment.stateVersion !== input.expectedEnrollmentStateVersion) {
      throw new CourseLearningError(
        "version_hash_drift",
        "课程认领状态版本已前移，请刷新后重试",
        {
          expected: input.expectedEnrollmentStateVersion,
          actual: record.enrollment.stateVersion,
        },
      );
    }
    const release = this.#resolveFrozenRelease(
      record.enrollment.courseReleaseRef,
    );
    if (await this.#outcomeProjectionReader?.isAuthoritative?.({ sessionId: input.sessionId, release })) {
      throw new CourseLearningError("access_denied", "请在旗舰编辑部提交作品，并通过旗舰评价完成教师终裁");
    }
    const enrollment = materializeEnrollment(record, [input.binding]);
    const snapshot = await this.#readOutcomeSnapshot({
      record,
      enrollment,
      release,
      actorId: input.binding.actorId,
    });
    const completed = new Set(snapshot.completedChapterIds);
    if (
      !["review", "completed"].includes(snapshot.scenarioStatus)
      || release.chapters.some((chapter) => !completed.has(chapter.chapterId))
      || snapshot.submittedDeliverableIds.length < 1
    ) {
      throw new CourseLearningError(
        "outcome_not_ready",
        "课程章节、成果或世界状态尚未达到提交复核条件",
      );
    }
    const mapped = mapOutcomeSnapshot({ record, snapshot });
    if (mapped.items.length < 1 || mapped.evidence.length < 1) {
      throw new CourseLearningError(
        "outcome_not_ready",
        "课程成果必须具有服务端可复核的作品与证据",
      );
    }
    const requiredDeliverableIds = new Set(
      release.chapters.flatMap((chapter) => chapter.deliverableIds),
    );
    const submittedDeliverableIds = new Set(snapshot.submittedDeliverableIds);
    const coveredDeliverableIds = new Set(
      mapped.items.flatMap((item) => item.deliverableIds),
    );
    const chapterById = new Map(
      release.chapters.map((chapter) => [chapter.chapterId, chapter]),
    );
    if (
      requiredDeliverableIds.size !== submittedDeliverableIds.size
      || [...requiredDeliverableIds].some((id) => (
        !submittedDeliverableIds.has(id) || !coveredDeliverableIds.has(id)
      ))
      || mapped.items.some((item) => (
        !chapterById.has(item.chapterId)
        || item.evidenceIds.length === 0
        || item.deliverableIds.some((id) => (
          !chapterById.get(item.chapterId)!.deliverableIds.includes(id)
        ))
      ))
    ) {
      throw new CourseLearningError(
        "outcome_not_ready",
        "每项冻结课程成果都必须由同章服务端记录与因果证据完整覆盖",
      );
    }
    const now = this.#now();
    const updatedEnrollment = CourseEnrollmentSchema.parse({
      ...record.enrollment,
      bindingId: input.binding.bindingId,
      status: "awaiting_review",
      submittedAt: now,
      completedAt: null,
      stateVersion: record.enrollment.stateVersion + 1,
      updatedAt: now,
    });
    const submission: CourseReviewSubmission = {
      submissionId: `submission:${record.enrollment.enrollmentId}`,
      reviewTaskId: reviewTaskIdFor(record.enrollment.enrollmentId),
      enrollmentId: record.enrollment.enrollmentId,
      courseReleaseRef: record.enrollment.courseReleaseRef,
      sessionId: input.sessionId,
      submittedAt: now,
      deliverableIds: [...snapshot.submittedDeliverableIds],
      portfolioItemIds: mapped.items.map((item) => item.portfolioItemId),
      evidenceIds: mapped.evidence.map((item) => item.evidenceId),
      rubric: release.chapters.map((chapter) => ({
        chapterId: chapter.chapterId,
        title: chapter.title,
        criteria: structuredClone(chapter.rubricCriteria),
      })),
    };
    CourseReviewWorkspaceSchema.parse({
      schemaVersion: CourseReviewWorkspaceSchemaVersion,
      viewer: "student",
      generatedAt: now,
      status: "awaiting_review",
      enrollment: updatedEnrollment,
      submission,
      review: null,
    });
    const updatedWithoutRequest: StoredCourseEnrollment = {
      ...record,
      enrollment: updatedEnrollment,
      submittedDeliverableIds: [...snapshot.submittedDeliverableIds],
      completion: null,
      outcome: {
        submissionRequest: null,
        reviewRequest: null,
        submission,
        portfolioItems: mapped.items,
        evidence: mapped.evidence,
        review: null,
      },
    };
    const receipt = receiptFor({
      requestId: input.requestId,
      record: updatedWithoutRequest,
    });
    const updated: StoredCourseEnrollment = {
      ...updatedWithoutRequest,
      outcome: {
        ...updatedWithoutRequest.outcome!,
        submissionRequest: {
          requestId: input.requestId,
          requestHash,
          receipt,
        },
      },
    };
    if (!await this.#store.compareAndSwap({
      record: updated,
      expectedStateVersion: record.enrollment.stateVersion,
    })) {
      const raced = await this.#store.getByPrincipalAndSession(
        input.subject.principalId,
        input.sessionId,
      );
      const racedRequest = raced ? outcomeOf(raced).submissionRequest : null;
      if (
        racedRequest?.requestId === input.requestId
        && racedRequest.requestHash === requestHash
      ) {
        return structuredClone(racedRequest.receipt);
      }
      throw new CourseLearningError(
        "version_hash_drift",
        "课程提交期间状态已由另一权威请求前移",
      );
    }
    return structuredClone(receipt);
  }

  async finalizeReview(input: {
    subject: CourseLearningSubject;
    binding: CourseLearningBinding;
    sessionId: string;
    reviewTaskId: string;
    expectedEnrollmentStateVersion: number;
    requestId: string;
  }): Promise<CourseOutcomeMutationReceipt> {
    if (
      input.subject.role === "student"
      || input.binding.actorKind !== "teacher"
      || input.binding.sessionId !== input.sessionId
    ) {
      throw new CourseLearningError(
        "access_denied",
        "只有当前课程会话的教师或管理员体验身份可以确认评价",
      );
    }
    const requestHash = requestHashFor("review", {
      bindingId: input.binding.bindingId,
      sessionId: input.sessionId,
      reviewTaskId: input.reviewTaskId,
      expectedEnrollmentStateVersion: input.expectedEnrollmentStateVersion,
      requestId: input.requestId,
    });
    const record = (await this.#store.listBySessionId(input.sessionId)).find(
      (candidate) => (
        outcomeOf(candidate).submission?.reviewTaskId === input.reviewTaskId
      ),
    ) ?? null;
    if (!record) {
      throw new CourseLearningError(
        "course_not_found",
        "训练会话没有待复核的课程成果",
      );
    }
    const existingOutcome = outcomeOf(record);
    if (existingOutcome.reviewRequest?.requestId === input.requestId) {
      if (existingOutcome.reviewRequest.requestHash !== requestHash) {
        throw new CourseLearningError(
          "enrollment_conflict",
          "同一课程复核 requestId 不能改变请求语义",
        );
      }
      return structuredClone(existingOutcome.reviewRequest.receipt);
    }
    if (record.enrollment.status !== "awaiting_review") {
      throw new CourseLearningError(
        "enrollment_conflict",
        "课程当前不处于待复核状态",
        { status: record.enrollment.status },
      );
    }
    if (record.enrollment.stateVersion !== input.expectedEnrollmentStateVersion) {
      throw new CourseLearningError(
        "version_hash_drift",
        "课程认领状态版本已前移，请刷新后重试",
        {
          expected: input.expectedEnrollmentStateVersion,
          actual: record.enrollment.stateVersion,
        },
      );
    }
    const release = this.#resolveFrozenRelease(
      record.enrollment.courseReleaseRef,
    );
    const launch = this.#launchesByReleaseId.get(release.releaseId);
    if (!launch) {
      throw new CourseLearningError(
        "runtime_unavailable",
        "课程发布版没有冻结的记者训练会话映射",
      );
    }
    const snapshot = await this.#readOutcomeSnapshot({
      record,
      enrollment: record.enrollment,
      release,
      actorId: launch.reporterActorId,
    });
    if (snapshot.scenarioStatus !== "completed") {
      throw new CourseLearningError(
        "outcome_not_ready",
        "世界权威情境尚未完成，不能确认课程评价与归档",
      );
    }
    const frozen = this.#requireFrozenOutcome(record, release);
    if (!frozen.submission) {
      throw new CourseLearningError(
        "version_hash_drift",
        "待复核课程缺少冻结提交",
      );
    }
    const current = mapOutcomeSnapshot({ record, snapshot });
    const currentById = new Map(current.items.map((item) => [
      item.portfolioItemId,
      item,
    ]));
    if (frozen.portfolioItems.some((item) => {
      if (item.origin === "server_process_record") return false;
      const candidate = currentById.get(item.portfolioItemId);
      return !candidate
        || candidate.revisionId !== item.revisionId
        || candidate.contentHash !== item.contentHash;
    })) {
      throw new CourseLearningError(
        "version_hash_drift",
        "提交后的作品版本或内容哈希发生漂移",
      );
    }
    const currentEvidenceById = new Map(current.evidence.map((item) => [
      item.evidenceId,
      item,
    ]));
    const frozenStudentRevisionIds = new Set(
      frozen.portfolioItems
        .filter((item) => item.origin === "student_artifact")
        .map((item) => item.revisionId),
    );
    const frozenDeliverableIds = new Set(frozen.submission.deliverableIds);
    const currentDeliverableIds = new Set(snapshot.submittedDeliverableIds);
    const frozenEvidenceIds = new Set(frozen.submission.evidenceIds);
    if (
      [...frozenDeliverableIds].some((id) => !currentDeliverableIds.has(id))
      || frozen.evidence.some((item) => {
        const candidate = currentEvidenceById.get(item.evidenceId);
        return !candidate
          || candidate.basis !== item.basis
          || item.artifactRevisionRefs
            .filter((ref) => frozenStudentRevisionIds.has(ref))
            .some((ref) => !candidate.artifactRevisionRefs.includes(ref));
      })
      || snapshot.review?.dimensions.some((dimension) => (
        dimension.evidenceRefs.some((id) => !frozenEvidenceIds.has(id))
      ))
    ) {
      throw new CourseLearningError(
        "version_hash_drift",
        "冻结成果、证据或公开评价引用在复核前发生漂移",
      );
    }
    const deterministicProcessReview = buildDeterministicProcessReview({
      release,
      submission: frozen.submission,
      portfolioItems: frozen.portfolioItems,
      evidence: frozen.evidence,
    });
    if (!deterministicProcessReview) {
      throw new CourseLearningError(
        "version_hash_drift",
        "冻结课程量规、成果或证据无法形成确定性过程评价",
      );
    }
    const authoritativeReview = snapshot.review ?? deterministicProcessReview;
    const now = this.#now();
    const updatedEnrollment = CourseEnrollmentSchema.parse({
      ...record.enrollment,
      status: "completed",
      completedAt: now,
      stateVersion: record.enrollment.stateVersion + 1,
      updatedAt: now,
    });
    const completion: CompletedLearningSummary = {
      portfolioItemIds: frozen.portfolioItems.map((item) => item.portfolioItemId),
      evidenceIds: frozen.evidence.map((item) => item.evidenceId),
      reviewId: authoritativeReview.reviewId,
    };
    const updatedWithoutRequest: StoredCourseEnrollment = {
      ...record,
      enrollment: updatedEnrollment,
      completion,
      outcome: {
        ...frozen,
        reviewRequest: null,
        review: structuredClone(authoritativeReview),
      },
    };
    CourseReviewWorkspaceSchema.parse({
      schemaVersion: CourseReviewWorkspaceSchemaVersion,
      viewer: "teacher",
      generatedAt: now,
      status: "completed",
      enrollment: updatedEnrollment,
      submission: frozen.submission,
      review: authoritativeReview,
    });
    const receipt = receiptFor({
      requestId: input.requestId,
      record: updatedWithoutRequest,
    });
    const updated: StoredCourseEnrollment = {
      ...updatedWithoutRequest,
      outcome: {
        ...updatedWithoutRequest.outcome!,
        reviewRequest: {
          requestId: input.requestId,
          requestHash,
          receipt,
        },
      },
    };
    if (!await this.#store.compareAndSwap({
      record: updated,
      expectedStateVersion: record.enrollment.stateVersion,
    })) {
      const raced = (await this.#store.listBySessionId(input.sessionId)).find(
        (candidate) => (
          outcomeOf(candidate).submission?.reviewTaskId === input.reviewTaskId
        ),
      );
      const racedRequest = raced ? outcomeOf(raced).reviewRequest : null;
      if (
        racedRequest?.requestId === input.requestId
        && racedRequest.requestHash === requestHash
      ) {
        return structuredClone(racedRequest.receipt);
      }
      throw new CourseLearningError(
        "version_hash_drift",
        "课程复核期间状态已由另一权威请求前移",
      );
    }
    return structuredClone(receipt);
  }

  async claim(input: {
    subject: CourseLearningSubject;
    courseReleaseId: string;
    bindingId: string | null;
    activeSessionId: string | null;
  }): Promise<CourseEnrollment> {
    ensureStudentExperience(input.subject);
    const release = this.getReleaseById(input.courseReleaseId);
    const releaseRef = courseReleaseReferenceOf(release);
    if ((input.bindingId === null) !== (input.activeSessionId === null)) {
      throw new CourseLearningError(
        "enrollment_conflict",
        "课程认领的岗位绑定与活动会话必须同时存在或同时为空",
      );
    }
    const existing = await this.#store.getByPrincipalAndCourse(
      input.subject.principalId,
      release.courseId,
    );
    if (existing) {
      if (!sameReleaseRef(existing.enrollment.courseReleaseRef, releaseRef)) {
        throw new CourseLearningError(
          "version_hash_drift",
          "课程已按另一不可变发布版认领，拒绝静默漂移",
          {
            expected: existing.enrollment.courseReleaseRef,
            actual: releaseRef,
          },
        );
      }
      if (
        existing.enrollment.status === "claimed"
        && input.bindingId !== null
        && input.activeSessionId !== null
      ) {
        const now = this.#now();
        const activatedEnrollment = CourseEnrollmentSchema.parse({
          ...existing.enrollment,
          bindingId: input.bindingId,
          status: "in_progress",
          activeSessionId: input.activeSessionId,
          startedAt: now,
          submittedAt: null,
          completedAt: null,
          stateVersion: existing.enrollment.stateVersion + 1,
          updatedAt: now,
        });
        const activated: StoredCourseEnrollment = {
          ...existing,
          enrollment: activatedEnrollment,
        };
        if (await this.#store.compareAndSwap({
          record: activated,
          expectedStateVersion: existing.enrollment.stateVersion,
        })) {
          return structuredClone(activatedEnrollment);
        }
        const raced = await this.#store.getByPrincipalAndCourse(
          input.subject.principalId,
          release.courseId,
        );
        if (
          !raced
          || raced.enrollment.status !== "in_progress"
          || raced.enrollment.activeSessionId !== input.activeSessionId
        ) {
          throw new CourseLearningError(
            "enrollment_conflict",
            "课程开班激活未能收敛到同一训练会话",
          );
        }
        return materializeEnrollment(raced, [{
          bindingId: input.bindingId,
          sessionId: input.activeSessionId,
          actorId: "student-reporter",
          actorKind: "student",
          roleId: "reporter",
        }]);
      }
      if (
        existing.enrollment.status !== "claimed"
        && input.activeSessionId !== null
        && existing.enrollment.activeSessionId !== input.activeSessionId
      ) {
        throw new CourseLearningError(
          "enrollment_conflict",
          "已激活课程不得切换到另一训练会话",
        );
      }
      return materializeEnrollment(
        existing,
        input.bindingId && input.activeSessionId
          ? [{
              bindingId: input.bindingId,
              sessionId: input.activeSessionId,
              actorId: "student-reporter",
              actorKind: "student",
              roleId: "reporter",
            }]
          : [],
      );
    }
    const now = this.#now();
    const enrollmentId = enrollmentIdFor(
      input.subject.principalId,
      release.releaseId,
    );
    const enrollment = CourseEnrollmentSchema.parse({
      schemaVersion: CourseEnrollmentSchemaVersion,
      enrollmentId,
      bindingId: input.bindingId ?? fallbackBindingId(enrollmentId),
      courseReleaseRef: releaseRef,
      primaryJobId: "integrated_media_reporter",
      primaryRoleId: "reporter",
      status: input.activeSessionId ? "in_progress" : "claimed",
      activeSessionId: input.activeSessionId,
      claimedAt: now,
      startedAt: input.activeSessionId ? now : null,
      submittedAt: null,
      completedAt: null,
      stateVersion: 0,
      updatedAt: now,
    });
    const record: StoredCourseEnrollment = {
      principalId: input.subject.principalId,
      enrollment,
      submittedDeliverableIds: [],
      completion: null,
    };
    if (!await this.#store.create(record)) {
      const raced = await this.#store.getByPrincipalAndCourse(
        input.subject.principalId,
        release.courseId,
      );
      if (
        !raced
        || !sameReleaseRef(raced.enrollment.courseReleaseRef, releaseRef)
      ) {
        throw new CourseLearningError(
          "enrollment_conflict",
          "并发认领未能收敛到同一不可变课程发布版",
        );
      }
      return materializeEnrollment(
        raced,
        input.bindingId && input.activeSessionId
          ? [{
              bindingId: input.bindingId,
              sessionId: input.activeSessionId,
              actorId: "student-reporter",
              actorKind: "student",
              roleId: "reporter",
            }]
          : [],
      );
    }
    return structuredClone(enrollment);
  }

  async getLearningActivity(input: {
    subject: CourseLearningSubject;
    binding: CourseLearningBinding;
    sessionId: string;
  }): Promise<LearningActivity> {
    ensureStudentExperience(input.subject);
    if (
      input.binding.actorKind !== "student"
      || input.binding.roleId !== "reporter"
      || input.binding.sessionId !== input.sessionId
    ) {
      throw new CourseLearningError(
        "access_denied",
        "学习活动只向当前会话的记者岗位开放",
      );
    }
    const records = await this.#store.listByPrincipal(
      input.subject.principalId,
    );
    const record = records.find((candidate) => (
      candidate.enrollment.activeSessionId === input.sessionId
    ));
    const generatedAt = this.#now();
    if (!record) {
      return LearningActivitySchema.parse({
        schemaVersion: LearningActivitySchemaVersion,
        bindingId: input.binding.bindingId,
        stateVersion: 0,
        generatedAt,
        status: "empty",
        enrollment: null,
        courseReleaseRef: null,
        sessionId: null,
        currentTask: null,
        guideSteps: [],
        submittedDeliverableIds: [],
        completion: null,
        primaryAction: {
          actionId: "browse_courses",
          label: "浏览课程大厅",
          description: "认领一门课程后再进入实训现场。",
        },
      });
    }
    const runtime = await this.#readDedicatedOutcome(record, [input.binding]);
    const enrollment = runtime?.enrollment ?? materializeEnrollment(record, [input.binding]);
    const release = this.#resolveFrozenRelease(enrollment.courseReleaseRef);
    if (enrollment.status === "claimed") {
      return LearningActivitySchema.parse({
        schemaVersion: LearningActivitySchemaVersion,
        bindingId: input.binding.bindingId,
        stateVersion: enrollment.stateVersion,
        generatedAt,
        status: "ready",
        enrollment,
        courseReleaseRef: enrollment.courseReleaseRef,
        sessionId: null,
        currentTask: null,
        guideSteps: [],
        submittedDeliverableIds: [],
        completion: null,
        primaryAction: {
          actionId: "start_training",
          label: "开始实训",
          description: "进入已冻结课程版本对应的训练会话。",
        },
      });
    }
    if (enrollment.status === "awaiting_review") {
      if (!runtime) this.#requireFrozenOutcome(record, release);
      return LearningActivitySchema.parse({
        schemaVersion: LearningActivitySchemaVersion,
        bindingId: input.binding.bindingId,
        stateVersion: enrollment.stateVersion,
        generatedAt,
        status: "awaiting_review",
        enrollment,
        courseReleaseRef: enrollment.courseReleaseRef,
        sessionId: enrollment.activeSessionId,
        currentTask: null,
        guideSteps: [],
        submittedDeliverableIds: runtime?.snapshot.submittedDeliverableIds ?? record.submittedDeliverableIds,
        completion: null,
        primaryAction: {
          actionId: "view_submission",
          label: "查看提交",
          description: "作品已提交，等待教师完成复核。",
        },
      });
    }
    if (enrollment.status === "completed") {
      if (!runtime) this.#requireFrozenOutcome(record, release);
      const completion = runtime?.completion ?? record.completion;
      if (!completion) {
        throw new CourseLearningError(
          "version_hash_drift",
          "已完成认领缺少作品、证据或评价引用",
          { enrollmentId: enrollment.enrollmentId },
        );
      }
      return LearningActivitySchema.parse({
        schemaVersion: LearningActivitySchemaVersion,
        bindingId: input.binding.bindingId,
        stateVersion: enrollment.stateVersion,
        generatedAt,
        status: "completed",
        enrollment,
        courseReleaseRef: enrollment.courseReleaseRef,
        sessionId: enrollment.activeSessionId,
        currentTask: null,
        guideSteps: [],
        submittedDeliverableIds: runtime?.snapshot.submittedDeliverableIds ?? record.submittedDeliverableIds,
        completion,
        primaryAction: {
          actionId: "review_learning",
          label: "查看评价复盘",
          description: "回看作品证据、教师评价与迁移反思。",
        },
      });
    }
    if (!this.#projectionReader) {
      throw new CourseLearningError(
        "runtime_unavailable",
        "当前运行模式未接入学习活动投影读取器",
      );
    }
    const snapshot = await this.#projectionReader.read({
      principalId: record.principalId,
      sessionId: input.sessionId,
      actorId: input.binding.actorId,
      enrollment,
      release,
    });
    const chapter = release.chapters.find((candidate) => (
      candidate.chapterId === snapshot.chapterId
    )) ?? release.chapters[0];
    if (!chapter) {
      throw new CourseLearningError(
        "version_hash_drift",
        "课程发布版缺少可运行章节",
      );
    }
    return LearningActivitySchema.parse({
      schemaVersion: LearningActivitySchemaVersion,
      bindingId: input.binding.bindingId,
      stateVersion: snapshot.stateVersion,
      generatedAt,
      status: "active",
      enrollment,
      courseReleaseRef: enrollment.courseReleaseRef,
      sessionId: input.sessionId,
      currentTask: {
        taskId: `${input.sessionId}:${chapter.chapterId}:task`,
        chapterId: chapter.chapterId,
        title: chapter.title,
        objective: chapter.objective,
        sceneId: snapshot.sceneId,
        sourceEventId: snapshot.sourceEventId,
        priority: snapshot.priority ?? "normal",
      },
      guideSteps: [
        {
          stepId: `${chapter.chapterId}:understand`,
          order: 1,
          title: "读清任务",
          instruction: chapter.taskBrief,
          status: "current",
        },
        {
          stepId: `${chapter.chapterId}:verify`,
          order: 2,
          title: "核验证据",
          instruction: chapter.evidenceRequirements[0],
          status: "pending",
        },
        {
          stepId: `${chapter.chapterId}:deliver`,
          order: 3,
          title: "完成成果",
          instruction: "按量规提交本节成果并等待教师门反馈。",
          status: "pending",
        },
      ],
      submittedDeliverableIds: runtime?.snapshot.submittedDeliverableIds ?? record.submittedDeliverableIds,
      completion: null,
      primaryAction: {
        actionId: "continue_task",
        label: "继续当前任务",
        description: "回到任务现场，完成当前唯一主行动。",
      },
    });
  }

  async #readOutcomeSnapshot(input: {
    record: StoredCourseEnrollment;
    enrollment: CourseEnrollment;
    release: CourseRelease;
    actorId: string;
  }): Promise<CourseOutcomeRuntimeSnapshot> {
    if (!this.#outcomeProjectionReader) {
      throw new CourseLearningError(
        "runtime_unavailable",
        "当前运行模式未接入课程成果投影读取器",
      );
    }
    const sessionId = input.enrollment.activeSessionId;
    if (!sessionId) {
      throw new CourseLearningError(
        "version_hash_drift",
        "课程成果读取需要已冻结的训练会话",
      );
    }
    const snapshot = structuredClone(await this.#outcomeProjectionReader.read({
      principalId: input.record.principalId,
      sessionId,
      actorId: input.actorId,
      enrollment: input.enrollment,
      release: input.release,
    }));
    const chapterIds = new Set(
      input.release.chapters.map((chapter) => chapter.chapterId),
    );
    const completed = new Set(snapshot.completedChapterIds);
    const deliverablesByChapter = new Map(
      input.release.chapters.map((chapter) => [
        chapter.chapterId,
        new Set(chapter.deliverableIds),
      ]),
    );
    const requiredDeliverableIds = new Set(
      input.release.chapters.flatMap((chapter) => chapter.deliverableIds),
    );
    const invalidChapter = snapshot.completedChapterIds.find((chapterId) => (
      !chapterIds.has(chapterId)
    ));
    if (
      !Number.isInteger(snapshot.stateVersion)
      || snapshot.stateVersion < 0
      || completed.size !== snapshot.completedChapterIds.length
      || invalidChapter
      || (
        snapshot.currentChapterId !== null
        && !chapterIds.has(snapshot.currentChapterId)
      )
      || (
        snapshot.currentChapterId !== null
        && completed.has(snapshot.currentChapterId)
      )
      || (
        completed.size < chapterIds.size
        && snapshot.currentChapterId === null
      )
      || (
        completed.size === chapterIds.size
        && snapshot.currentChapterId !== null
      )
      || new Set(snapshot.submittedDeliverableIds).size
        !== snapshot.submittedDeliverableIds.length
      || snapshot.submittedDeliverableIds.some((id) => (
        !requiredDeliverableIds.has(id)
      ))
      || snapshot.portfolioItems.some((item) => (
        !deliverablesByChapter.has(item.chapterId)
        || item.deliverableIds.length === 0
        || item.deliverableIds.some((id) => (
          !deliverablesByChapter.get(item.chapterId)!.has(id)
        ))
      ))
    ) {
      throw new CourseLearningError(
        "version_hash_drift",
        "课程成果投影与冻结章节或状态版本不一致",
        { invalidChapter, currentChapterId: snapshot.currentChapterId },
      );
    }
    if (snapshot.review) {
      snapshot.review = CourseReviewResultSchema.parse(snapshot.review);
    }
    try {
      mapOutcomeSnapshot({ record: input.record, snapshot });
    } catch (error) {
      throw new CourseLearningError(
        "version_hash_drift",
        "课程作品或证据投影未通过严格成果契约",
        { cause: error instanceof Error ? error.message : "invalid_outcome" },
      );
    }
    return snapshot;
  }

  #requireFrozenOutcome(
    record: StoredCourseEnrollment,
    release: CourseRelease,
  ): StoredCourseOutcome {
    const outcome = outcomeOf(record);
    if (
      !outcome.submission
      || outcome.portfolioItems.length < 1
      || outcome.evidence.length < 1
      || record.submittedDeliverableIds.length < 1
    ) {
      throw new CourseLearningError(
        "version_hash_drift",
        "课程生命周期已前移但缺少服务端冻结的作品、证据或提交",
        { enrollmentId: record.enrollment.enrollmentId },
      );
    }
    const submission = outcome.submission;
    const submissionRequest = outcome.submissionRequest;
    const sessionId = record.enrollment.activeSessionId;
    const portfolioItemIds = outcome.portfolioItems.map((item) => (
      item.portfolioItemId
    ));
    const evidenceIds = outcome.evidence.map((item) => item.evidenceId);
    const invalidSharedIdentity = (
      submission.enrollmentId !== record.enrollment.enrollmentId
      || submission.sessionId !== sessionId
      || !sameReleaseRef(
        submission.courseReleaseRef,
        record.enrollment.courseReleaseRef,
      )
      || !sameStringSet(
        record.submittedDeliverableIds,
        submission.deliverableIds,
      )
      || !sameStringSet(submission.portfolioItemIds, portfolioItemIds)
      || !sameStringSet(submission.evidenceIds, evidenceIds)
      || outcome.portfolioItems.some((item) => (
        item.enrollmentId !== record.enrollment.enrollmentId
        || item.sessionId !== sessionId
        || !sameReleaseRef(
          item.courseReleaseRef,
          record.enrollment.courseReleaseRef,
        )
      ))
      || outcome.evidence.some((item) => (
        item.enrollmentId !== record.enrollment.enrollmentId
        || item.sessionId !== sessionId
        || !sameReleaseRef(
          item.courseReleaseRef,
          record.enrollment.courseReleaseRef,
        )
      ))
      || !submissionRequest
      || submissionRequest.receipt.requestId !== submissionRequest.requestId
      || submissionRequest.receipt.enrollmentId
        !== record.enrollment.enrollmentId
      || submissionRequest.receipt.sessionId !== sessionId
      || submissionRequest.receipt.status !== "awaiting_review"
    );
    const invalidAwaiting = record.enrollment.status === "awaiting_review" && (
      record.completion !== null
      || outcome.review !== null
      || outcome.reviewRequest !== null
      || submissionRequest?.receipt.stateVersion
        !== record.enrollment.stateVersion
    );
    const submittedEvidenceIds = new Set(submission.evidenceIds);
    const invalidCompleted = record.enrollment.status === "completed" && (
      !record.completion
      || !outcome.review
      || !outcome.reviewRequest
      || !sameStringSet(record.completion.portfolioItemIds, portfolioItemIds)
      || !sameStringSet(record.completion.evidenceIds, evidenceIds)
      || record.completion.reviewId !== outcome.review?.reviewId
      || outcome.review?.dimensions.some((dimension) => (
        dimension.evidenceRefs.some((ref) => !submittedEvidenceIds.has(ref))
      ))
      || outcome.reviewRequest?.receipt.requestId
        !== outcome.reviewRequest?.requestId
      || outcome.reviewRequest?.receipt.enrollmentId
        !== record.enrollment.enrollmentId
      || outcome.reviewRequest?.receipt.sessionId !== sessionId
      || outcome.reviewRequest?.receipt.status !== "completed"
      || outcome.reviewRequest?.receipt.stateVersion
        !== record.enrollment.stateVersion
      || submissionRequest?.receipt.stateVersion
        !== record.enrollment.stateVersion - 1
    );
    if (invalidSharedIdentity || invalidAwaiting || invalidCompleted) {
      throw new CourseLearningError(
        "version_hash_drift",
        "冻结课程成果、完成引用或幂等回执因果链不一致",
        { enrollmentId: record.enrollment.enrollmentId },
      );
    }
    try {
      StudentPortfolioSchema.parse({
        schemaVersion: StudentPortfolioSchemaVersion,
        generatedAt: this.#now(),
        items: outcome.portfolioItems,
        evidence: outcome.evidence,
      });
      if (!buildDeterministicProcessReview({
        release,
        submission,
        portfolioItems: outcome.portfolioItems,
        evidence: outcome.evidence,
      })) {
        throw new Error("frozen rubric, artifacts, or evidence are not coherent");
      }
    } catch (error) {
      throw new CourseLearningError(
        "version_hash_drift",
        "服务端冻结的课程成果无法通过严格契约",
        { cause: error instanceof Error ? error.message : "invalid_outcome" },
      );
    }
    return outcome;
  }

  #resolveFrozenRelease(ref: CourseReleaseReference): CourseRelease {
    const parsedRef = CourseReleaseReferenceSchema.parse(ref);
    const release = this.#releasesByReleaseId.get(parsedRef.releaseId);
    if (
      !release
      || !sameReleaseRef(courseReleaseReferenceOf(release), parsedRef)
    ) {
      throw new CourseLearningError(
        "version_hash_drift",
        "认领记录与服务端不可变课程发布版不一致",
        { expected: parsedRef },
      );
    }
    return release;
  }
}
