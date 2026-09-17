import type {
  CourseEnrollment,
  CourseProgressReviewStatus,
  CourseRelease,
  CourseReleaseReference,
  LearningActivity,
  Principal,
  RoleBinding,
  StudentTrainingAction,
  StudentTrainingContext,
  StudentCollaborationEpisode,
} from "@ronggang/contracts";

export interface CourseReleaseSummary {
  schemaVersion: "course-release-summary/2.0.0";
  courseId: string;
  courseReleaseId: string;
  releaseId: string;
  version: number;
  contentHash: string;
  title: string;
  summary: string;
  primaryJob: {
    jobId: "integrated_media_reporter";
    title: "融媒体采编岗";
    studentRoleId: "reporter";
  };
  chapterCount: number;
  sourceCount: number;
  publishedAt: string;
}

export type CourseReleaseDetailChapter = Pick<
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
>;

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
  chapters: CourseReleaseDetailChapter[];
  studentDecisionOptions: CourseRelease["studentDecisionOptions"];
  publishedAt: string;
}

export interface DemoAuthContext {
  profileId: string;
  principal: Principal;
  bindings: RoleBinding[];
  csrfToken: string;
  expiresAt: string;
}

export interface EnrolledCourseView {
  enrollment: CourseEnrollment;
  course: CourseReleaseSummary;
  progress: StudentCourseProgressView;
}

export interface StudentCourseProgressView {
  chapterCount: number;
  completedChapterCount: number;
  currentChapterId: string | null;
  submittedDeliverableCount: number;
  portfolioItemCount: number;
  evidenceCount: number;
  reviewStatus: CourseProgressReviewStatus;
  readyForSubmission: boolean;
}

export interface CourseDetailSourceView {
  sourceId: string;
  title: string;
  publisher: string;
  url: string;
  locator: string;
  sourceVersion: string;
  reviewStatus: CourseReleaseDetailView["sources"][number]["reviewStatus"];
}

export interface CourseDetailChapterView {
  chapterId: string;
  order: number;
  title: string;
  objective: string;
  taskBrief: string;
  publicSources: CourseDetailSourceView[];
  evidenceRequirements: string[];
  rubricCriteria: Array<{
    criterionId: string;
    title: string;
    description: string;
    weight: number;
  }>;
  transferReflection: string;
  finalChapter: boolean;
}

/** Student-safe projection of the dedicated immutable detail wire view. */
export interface StudentCourseDetailView {
  courseId: string;
  courseReleaseId: string;
  version: number;
  title: string;
  summary: string;
  primaryJob: CourseReleaseDetailView["primaryJob"];
  publishedAt: string;
  sources: CourseDetailSourceView[];
  chapters: CourseDetailChapterView[];
  enrollment: CourseEnrollment | null;
  progress: StudentCourseProgressView | null;
}

export interface StudentPortfolioEvidenceView {
  key: string;
  courseId: string;
  courseTitle: string;
  title: string;
  basis: string;
  createdAt: string;
}

export interface StudentPortfolioItemView {
  key: string;
  courseId: string;
  courseTitle: string;
  title: string;
  kind: "task_outcome" | "interview_record" | "article" | "short_video_plan" | "channel_variant";
  origin: "student_artifact" | "server_process_record";
  status: "draft" | "submitted";
  revisionNumber: number;
  summary: string;
  evidenceCount: number;
  updatedAt: string;
}

export interface StudentPortfolioCourseView {
  courseId: string;
  title: string;
  status: CourseEnrollment["status"];
  activeSessionId: string | null;
  readyForSubmission: boolean;
}

export type StudentPortfolioLoad =
  | { state: "empty" }
  | {
    state: "ready";
    courses: StudentPortfolioCourseView[];
    items: StudentPortfolioItemView[];
    evidence: StudentPortfolioEvidenceView[];
  };

export interface StudentReviewSubmissionView {
  submittedAt: string;
  deliverableCount: number;
  portfolioItemCount: number;
  evidenceCount: number;
  rubricChapterCount: number;
}

export interface StudentReviewDimensionView {
  key: string;
  label: string;
  score: number;
  maxScore: number;
  feedback: string;
  evidenceCount: number;
}

export type CourseReviewResultKind =
  | "system_process_attainment"
  | "teacher_review";

export function courseReviewResultKind(reviewId: string): CourseReviewResultKind {
  return reviewId.startsWith("course-process-review:")
    ? "system_process_attainment"
    : "teacher_review";
}

export interface StudentReviewView {
  sessionId: string;
  bindingId: string;
  course: CourseReleaseSummary;
  enrollment: CourseEnrollment;
  progress: StudentCourseProgressView;
  status: "not_submitted" | "awaiting_review" | "completed";
  canSubmit: boolean;
  submission: StudentReviewSubmissionView | null;
  result: null | {
    kind: CourseReviewResultKind;
    finalScore: number;
    publicSummary: string;
    finalizedAt: string;
    dimensions: StudentReviewDimensionView[];
  };
}

export type StudentReviewLoad =
  | { state: "unavailable" }
  | { state: "ready"; review: StudentReviewView };

export interface CourseSubmissionInput {
  sessionId: string;
  bindingId: string;
  expectedEnrollmentStateVersion: number;
  requestId: string;
}

export type StudentCourseLanding =
  | { state: "empty" }
  | { state: "enrolled"; courses: EnrolledCourseView[] };

export interface TrainingSnapshot {
  enrollment: CourseEnrollment;
  course: CourseReleaseSummary;
  activity: LearningActivity;
  context: StudentTrainingContext;
  episode: StudentCollaborationEpisode;
}

export type TrainingLoad =
  | { state: "not-enrolled" }
  | { state: "error"; message: string }
  | { state: "ready"; snapshot: TrainingSnapshot };

export type AdviceDecision = "accept" | "request_evidence" | "reject";

export interface AdviceView {
  suggestionId: string;
  agentName: string;
  summary: string;
  rationale: string;
  evidenceRefs: string[];
  riskLevel: "low" | "medium" | "high";
  allowedDecisions: readonly AdviceDecision[];
  decided: AdviceDecision | null;
}

export interface SceneView {
  sceneId: string;
  title: string;
  description: string;
  phase: "active" | "incident" | "paused" | "review" | "completed";
  riskLevel: "low" | "medium" | "high";
  stateTags: string[];
  hotspots: Array<{
    hotspotId: string;
    label: string;
    description: string;
    status: string;
    relationship: string;
    consequencePreview: string | null;
  }>;
}

export interface ActiveTrainingView {
  sessionId: string;
  bindingId: string;
  stateVersion: number;
  courseTitle: string;
  chapterCount: number;
  remainingMinutes: number;
  task: {
    taskId: string;
    chapterId: string;
    title: string;
    objective: string;
    priority: "normal" | "high" | "urgent";
    guideSteps: Array<{
      stepId: string;
      order: number;
      title: string;
      instruction: string;
      status: "completed" | "current" | "pending";
    }>;
  };
  scene: SceneView | null;
  worldEvents: Array<{
    eventId: string;
    title: string;
    detail: string;
    tone: "info" | "warning" | "critical" | "success";
  }>;
  advice: AdviceView | null;
  primaryAction: StudentTrainingAction | null;
}

export interface ExperienceActionInput {
  sessionId: string;
  bindingId: string;
  expectedStateVersion: number;
  actionRef: string;
}

export interface StudentAdviceDecisionInput {
  sessionId: string;
  bindingId: string;
  expectedStateVersion: number;
  suggestionId: string;
  decision: AdviceDecision;
}

export function sameCourseReleaseReference(
  left: CourseReleaseReference,
  right: CourseReleaseReference,
): boolean {
  return left.courseId === right.courseId
    && left.releaseId === right.releaseId
    && left.version === right.version
    && left.contentHash === right.contentHash;
}
