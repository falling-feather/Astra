import type {
  CourseReleaseReference,
  SessionControlOverview,
  SessionExperienceDescriptor,
  TeacherCollaborationEpisode,
  TrainingSessionSummary,
} from "@ronggang/contracts";
import type { CourseReleaseSummary } from "./models";
import type {
  CourseReviewResultKind,
  StudentReviewDimensionView,
  StudentReviewSubmissionView,
} from "./models";

export type TeacherGateDecision = "approve" | "request_evidence" | "reject";

export interface TeacherClassView {
  session: TrainingSessionSummary;
  classroomName: string;
  teamName: string;
  experienceTitle: string;
}

export type TrainingExperienceGeneration = "flagship_v3" | "flagship_v4" | "standard";

export function trainingExperienceGeneration(
  descriptor: Pick<SessionExperienceDescriptor, "experienceGeneration">,
): TrainingExperienceGeneration {
  return descriptor.experienceGeneration === "standard_v2"
    ? "standard"
    : descriptor.experienceGeneration;
}

/** A current server supplies the frozen course/scenario title; old summaries stay neutral. */
export function trainingExperienceTitle(session: TrainingSessionSummary): string {
  return session.experienceTitle ?? "岗位实训";
}

export interface TeacherCourseView {
  courseId: string;
  releaseId: string;
  courseReleaseRef: CourseReleaseReference;
  title: string;
  summary: string;
  chapterCount: number;
  sourceCount: number;
  publishedAt: string;
}

export interface TeacherGateDecisionInput {
  sessionId: string;
  bindingId: string;
  gateId: string;
  expectedTriggerEventId: string | null;
  expectedStateVersion: number;
  decision: TeacherGateDecision;
  reason: string;
}

export interface TeacherGateMutationReceipt {
  schemaVersion: "teacher-gate-mutation-receipt/2.0.0";
  accepted: true;
  sessionId: string;
  stateVersion: number;
  gateId: string;
  decision: TeacherGateDecision;
}

export interface TeacherReviewTaskView {
  reviewTaskId: string;
  enrollmentId: string;
  courseReleaseRef: CourseReleaseReference;
  courseTitle: string;
  learnerLabel: string;
  status: "awaiting_review" | "completed";
  stateVersion: number;
  submittedAt: string;
  completedAt: string | null;
}

export interface TeacherReviewQueueView {
  sessionId: string;
  tasks: TeacherReviewTaskView[];
}

export interface TeacherReviewWorkspaceView {
  task: TeacherReviewTaskView;
  enrollmentStateVersion: number;
  status: "awaiting_review" | "completed";
  submission: StudentReviewSubmissionView;
  result: null | {
    kind: CourseReviewResultKind;
    finalScore: number;
    publicSummary: string;
    finalizedAt: string;
    dimensions: StudentReviewDimensionView[];
  };
}

export interface TeacherReviewFinalizeInput {
  sessionId: string;
  bindingId: string;
  reviewTaskId: string;
  expectedEnrollmentStateVersion: number;
  requestId: string;
}

export type TeacherEpisode = TeacherCollaborationEpisode;

export function teacherClassViews(
  overview: SessionControlOverview,
): TeacherClassView[] {
  const classroomNames = new Map(
    overview.classrooms.map((item) => [item.classroomId, item.name]),
  );
  const teamNames = new Map(
    overview.teams.map((item) => [item.teamId, item.name]),
  );
  return overview.sessions.map((session) => ({
    session,
    classroomName: classroomNames.get(session.classroomId)
      ?? session.classroomId,
    teamName: teamNames.get(session.teamId) ?? session.teamId,
    experienceTitle: trainingExperienceTitle(session),
  }));
}

export function teacherCourseView(
  course: CourseReleaseSummary,
): TeacherCourseView {
  return {
    courseId: course.courseId,
    releaseId: course.releaseId,
    courseReleaseRef: {
      courseId: course.courseId,
      releaseId: course.releaseId,
      version: course.version,
      contentHash: course.contentHash,
    },
    title: course.title,
    summary: course.summary,
    chapterCount: course.chapterCount,
    sourceCount: course.sourceCount,
    publishedAt: course.publishedAt,
  };
}
