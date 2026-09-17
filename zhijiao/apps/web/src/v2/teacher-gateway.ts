import {
  TeacherStudentArchiveV3Schema, type TeacherStudentArchiveV3,
  TeacherSubmittedWorksV3Schema, type TeacherSubmittedWorksV3,
  CourseReviewFinalizeRequestSchema,
  SessionControlOverviewSchema,
  TeacherCollaborationEpisodeSchema,
  FieldInterviewReadResponseV1Schema,
  type FieldInterviewViewV1,
  type CourseOutcomeMutationReceipt,
  type CourseReviewTaskList,
  type CourseReviewWorkspace,
  type SessionControlOverview,
  type SessionExperienceDescriptor,
  type TeacherCollaborationEpisode,
} from "@ronggang/contracts";
import {
  GatewayHttpError,
  type FetchLike,
  type GatewayRuntimeOptions,
} from "./gateway";
import type { DemoAuthContext } from "./models";
import {
  teacherCourseView,
  type TeacherCourseView,
  type TeacherGateDecisionInput,
  type TeacherReviewFinalizeInput,
} from "./teacher-models";
import {
  parseCoursesResponse,
  parseCourseOutcomeMutationReceipt,
  parseCourseReviewResponse,
  parseCourseReviewTasksResponse,
  parseSessionExperienceDescriptorResponse,
  parseTeacherGateMutationReceipt,
} from "./wire";
import {
  parseFlagshipBusinessWorldResponse,
  parseFlagshipTeacherEpisodeResponse,
  parseFlagshipTeacherGateResponse,
  parseFlagshipWorkReviewResponse,
  type DecideFlagshipTeacherGateInput,
  type FlagshipBusinessWorldView,
  type FlagshipWorkReviewView,
} from "./world-v3-business";
import type { TeacherAgentCollaborationEpisodeV3 } from "@ronggang/contracts";
import {
  parseFlagshipCompetencyEvidenceResponse,
  type FlagshipCompetencyEvidenceViewV3,
  type ReviewFlagshipAssessmentInputV3,
} from "./assessment-v3";
import {
  parseFlagshipEvidenceAssessmentResponseV4,
  type FlagshipEvidenceAssessmentViewV4,
  type ReviewFlagshipAssessmentInputV4,
} from "./assessment-v4";
import {
  parseLearnerGrowthResponse,
  type LearnerGrowthViewV3,
  type ReviewLearnerAdaptationInputV3,
} from "./learner-adaptation-v3";
import {
  parseLearnerAdaptationResponseV4,
  type AuthorizeSecondSessionInputV4,
  type LearnerAdaptationViewV4,
  type ReviewLearnerAdaptationAppealInputV4,
} from "./learner-adaptation-v4";
import {
  parseFlagshipExperienceResponseV4,
  type FlagshipExperienceViewV4,
} from "./flagship-v4";

export interface TeacherGateway {
  getStudentArchive?(signal?: AbortSignal): Promise<TeacherStudentArchiveV3>;
  getSubmittedStudentWorks?(studentId: string, sessionId: string, signal?: AbortSignal): Promise<TeacherSubmittedWorksV3>;
  getFieldInterviewV1?(sessionId: string, bindingId: string, signal?: AbortSignal): Promise<FieldInterviewViewV1 | null>;
  getSessionExperienceDescriptor(
    sessionId: string,
    bindingId: string,
    signal?: AbortSignal,
  ): Promise<SessionExperienceDescriptor>;
  getSessionOverview(
    bindingId: string,
    authorizationSessionId: string,
    signal?: AbortSignal,
  ): Promise<SessionControlOverview>;
  getCourses(signal?: AbortSignal): Promise<TeacherCourseView[]>;
  getEpisode(
    sessionId: string,
    bindingId: string,
    signal?: AbortSignal,
  ): Promise<TeacherCollaborationEpisode>;
  getReviewTasks(
    sessionId: string,
    bindingId: string,
    signal?: AbortSignal,
  ): Promise<CourseReviewTaskList>;
  getCourseReview(
    sessionId: string,
    bindingId: string,
    reviewTaskId: string,
    signal?: AbortSignal,
  ): Promise<CourseReviewWorkspace>;
  finalizeReview(
    input: TeacherReviewFinalizeInput,
    signal?: AbortSignal,
  ): Promise<CourseOutcomeMutationReceipt>;
  decideGate(
    input: TeacherGateDecisionInput,
    signal?: AbortSignal,
  ): Promise<void>;
  getFlagshipWorld?(
    sessionId: string,
    bindingId: string,
    signal?: AbortSignal,
  ): Promise<FlagshipBusinessWorldView>;
  getFlagshipEpisode?(
    sessionId: string,
    bindingId: string,
    signal?: AbortSignal,
  ): Promise<TeacherAgentCollaborationEpisodeV3>;
  getFlagshipWorkReview?(
    sessionId: string,
    bindingId: string,
    signal?: AbortSignal,
  ): Promise<FlagshipWorkReviewView>;
  decideFlagshipTeacherGate?(
    input: DecideFlagshipTeacherGateInput,
    signal?: AbortSignal,
  ): Promise<TeacherAgentCollaborationEpisodeV3>;
  getFlagshipCompetencyEvidence?(
    sessionId: string,
    bindingId: string,
    signal?: AbortSignal,
  ): Promise<FlagshipCompetencyEvidenceViewV3>;
  reviewFlagshipAssessment?(
    input: ReviewFlagshipAssessmentInputV3,
    signal?: AbortSignal,
  ): Promise<FlagshipCompetencyEvidenceViewV3>;
  getFlagshipEvidenceAssessmentV4?(
    sessionId: string,
    bindingId: string,
    signal?: AbortSignal,
  ): Promise<FlagshipEvidenceAssessmentViewV4>;
  reviewFlagshipEvidenceAssessmentV4?(
    input: ReviewFlagshipAssessmentInputV4,
    signal?: AbortSignal,
  ): Promise<FlagshipEvidenceAssessmentViewV4>;
  getLearnerGrowth?(
    sessionId: string,
    bindingId: string,
    signal?: AbortSignal,
  ): Promise<LearnerGrowthViewV3>;
  reviewLearnerAdaptation?(
    input: ReviewLearnerAdaptationInputV3,
    signal?: AbortSignal,
  ): Promise<LearnerGrowthViewV3>;
  getLearnerAdaptationV4?(
    sessionId: string,
    bindingId: string,
    signal?: AbortSignal,
  ): Promise<LearnerAdaptationViewV4>;
  reviewLearnerAdaptationAppealV4?(
    input: ReviewLearnerAdaptationAppealInputV4,
    signal?: AbortSignal,
  ): Promise<LearnerAdaptationViewV4>;
  authorizeSecondSessionV4?(
    input: AuthorizeSecondSessionInputV4,
    signal?: AbortSignal,
  ): Promise<LearnerAdaptationViewV4>;
  getFlagshipExperienceV4?(
    sessionId: string,
    bindingId: string,
    signal?: AbortSignal,
  ): Promise<FlagshipExperienceViewV4>;
}

function runtime(options: GatewayRuntimeOptions): {
  apiBase: string;
  fetchImpl: FetchLike;
} {
  return {
    apiBase: (options.apiBase
      ?? import.meta.env.VITE_API_BASE_URL
      ?? "").replace(/\/$/u, ""),
    fetchImpl: options.fetchImpl
      ?? ((input, init) => globalThis.fetch(input, init)),
  };
}

function errorMessage(body: unknown, status: number): {
  code: string | null;
  message: string;
} {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const value = body as Record<string, unknown>;
    return {
      code: typeof value.code === "string" ? value.code : null,
      message: typeof value.message === "string"
        ? value.message
        : `请求失败（${status}）`,
    };
  }
  return { code: null, message: `请求失败（${status}）` };
}

async function requestUnknown(
  path: string,
  init: RequestInit,
  options: GatewayRuntimeOptions,
): Promise<unknown> {
  const requestRuntime = runtime(options);
  const response = await requestRuntime.fetchImpl(
    `${requestRuntime.apiBase}${path}`,
    {
      ...init,
      credentials: "include",
      headers: {
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    },
  );
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    const failure = errorMessage(body, response.status);
    throw new GatewayHttpError(response.status, failure.message, failure.code);
  }
  return body;
}

export function createHttpTeacherGateway(
  auth: DemoAuthContext,
  options: GatewayRuntimeOptions = {},
): TeacherGateway {
  const read = (path: string, signal?: AbortSignal) => requestUnknown(
    path,
    signal ? { signal } : {},
    options,
  );
  const mutate = (path: string, body: unknown, signal?: AbortSignal) => (
    requestUnknown(path, {
      method: "POST",
      ...(signal ? { signal } : {}),
      headers: { "X-CSRF-Token": auth.csrfToken },
      body: JSON.stringify(body),
    }, options)
  );
  return {
    async getSessionExperienceDescriptor(sessionId, bindingId, signal) {
      return parseSessionExperienceDescriptorResponse(await read(
        `/api/sessions/${encodeURIComponent(sessionId)}/experience-descriptor?bindingId=${encodeURIComponent(bindingId)}`,
        signal,
      ));
    },
    async getStudentArchive(signal) { return TeacherStudentArchiveV3Schema.parse(await read("/api/v3/teacher/student-archive", signal)); },
    async getSubmittedStudentWorks(studentId,sessionId,signal) { return TeacherSubmittedWorksV3Schema.parse(await read(`/api/v3/teacher/student-archive/${encodeURIComponent(studentId)}/sessions/${encodeURIComponent(sessionId)}/works`,signal)); },
    async getSessionOverview(bindingId, authorizationSessionId, signal) {
      const query = new URLSearchParams({
        bindingId,
        authorizationSessionId,
      });
      return SessionControlOverviewSchema.parse(await read(
        `/api/training-sessions?${query.toString()}`,
        signal,
      ));
    },
    async getCourses(signal) {
      return parseCoursesResponse(await read("/api/courses", signal))
        .map(teacherCourseView);
    },
    async getEpisode(sessionId, bindingId, signal) {
      return TeacherCollaborationEpisodeSchema.parse(await read(
        `/api/sessions/${encodeURIComponent(sessionId)}/collaboration-episode?bindingId=${encodeURIComponent(bindingId)}`,
        signal,
      ));
    },
    async getReviewTasks(sessionId, bindingId, signal) {
      return parseCourseReviewTasksResponse(await read(
        `/api/sessions/${encodeURIComponent(sessionId)}/course-review-tasks?bindingId=${encodeURIComponent(bindingId)}`,
        signal,
      ));
    },
    async getCourseReview(sessionId, bindingId, reviewTaskId, signal) {
      const query = new URLSearchParams({ bindingId, reviewTaskId });
      return parseCourseReviewResponse(await read(
        `/api/sessions/${encodeURIComponent(sessionId)}/course-review?${query.toString()}`,
        signal,
      ));
    },
    async finalizeReview(input, signal) {
      const request = CourseReviewFinalizeRequestSchema.parse({
        bindingId: input.bindingId,
        reviewTaskId: input.reviewTaskId,
        expectedEnrollmentStateVersion: input.expectedEnrollmentStateVersion,
        requestId: input.requestId,
      });
      return parseCourseOutcomeMutationReceipt(await mutate(
        `/api/sessions/${encodeURIComponent(input.sessionId)}/course-reviews`,
        request,
        signal,
      ));
    },
    async decideGate(input, signal) {
      const receipt = parseTeacherGateMutationReceipt(await mutate(
        `/api/sessions/${encodeURIComponent(input.sessionId)}/teacher-gates/${encodeURIComponent(input.gateId)}/decisions`,
        {
          bindingId: input.bindingId,
          expectedStateVersion: input.expectedStateVersion,
          decision: input.decision,
          reason: input.reason,
        },
        signal,
      ));
      if (
        receipt.sessionId !== input.sessionId
        || receipt.gateId !== input.gateId
        || receipt.decision !== input.decision
        || receipt.stateVersion <= input.expectedStateVersion
      ) {
        throw new Error("教师门回执与当前课堂决定不一致");
      }
    },
    async getFlagshipWorld(sessionId, bindingId, signal) {
      return parseFlagshipBusinessWorldResponse(await read(
        `/api/v3/sessions/${encodeURIComponent(sessionId)}/world?bindingId=${encodeURIComponent(bindingId)}`,
        signal,
      ), "teacher");
    },
    async getFlagshipExperienceV4(sessionId, bindingId, signal) {
      return parseFlagshipExperienceResponseV4(await read(
        `/api/v4/sessions/${encodeURIComponent(sessionId)}/experience?bindingId=${encodeURIComponent(bindingId)}`,
        signal,
      ), "teacher");
    },
    async getFieldInterviewV1(sessionId, bindingId, signal) {
      const response = FieldInterviewReadResponseV1Schema.parse(await read(`/api/v4/sessions/${encodeURIComponent(sessionId)}/interview?bindingId=${encodeURIComponent(bindingId)}`, signal));
      if (response.view && response.view.sessionId !== sessionId) throw new Error("学生采访记录不属于当前课堂。");
      return response.view;
    },
    async getFlagshipEpisode(sessionId, bindingId, signal) {
      return parseFlagshipTeacherEpisodeResponse(await read(
        `/api/v3/sessions/${encodeURIComponent(sessionId)}/collaboration-episode?bindingId=${encodeURIComponent(bindingId)}`,
        signal,
      ));
    },
    async getFlagshipWorkReview(sessionId, bindingId, signal) {
      return parseFlagshipWorkReviewResponse(await read(
        `/api/v3/sessions/${encodeURIComponent(sessionId)}/work-review?bindingId=${encodeURIComponent(bindingId)}`,
        signal,
      ));
    },
    async getFlagshipCompetencyEvidence(sessionId, bindingId, signal) {
      return parseFlagshipCompetencyEvidenceResponse(await read(
        `/api/v3/sessions/${encodeURIComponent(sessionId)}/competency-evidence?bindingId=${encodeURIComponent(bindingId)}`,
        signal,
      ), "teacher");
    },
    async reviewFlagshipAssessment(input, signal) {
      return parseFlagshipCompetencyEvidenceResponse(await mutate(
        `/api/v3/sessions/${encodeURIComponent(input.sessionId)}/assessment-decisions`,
        {
          bindingId: input.bindingId,
          expectedAssessmentDecisionId: input.expectedAssessmentDecisionId,
          requestId: input.requestId,
          status: input.status,
          reason: input.reason,
          competencyRevisions: input.competencyRevisions,
        },
        signal,
      ), "teacher");
    },
    async getFlagshipEvidenceAssessmentV4(sessionId, bindingId, signal) {
      return parseFlagshipEvidenceAssessmentResponseV4(await read(
        `/api/v4/sessions/${encodeURIComponent(sessionId)}/evidence-assessment?bindingId=${encodeURIComponent(bindingId)}`,
        signal,
      ), "teacher");
    },
    async reviewFlagshipEvidenceAssessmentV4(input, signal) {
      return parseFlagshipEvidenceAssessmentResponseV4(await mutate(
        `/api/v4/sessions/${encodeURIComponent(input.sessionId)}/evidence-assessment-reviews`,
        {
          bindingId: input.bindingId,
          expectedAssessmentDecisionId: input.expectedAssessmentDecisionId,
          requestId: input.requestId,
          status: input.status,
          rubricApplicabilityConfirmed: true,
          reason: input.reason,
          criterionRevisions: input.criterionRevisions,
        },
        signal,
      ), "teacher");
    },
    async getLearnerGrowth(sessionId, bindingId, signal) {
      return parseLearnerGrowthResponse(await read(
        `/api/v3/sessions/${encodeURIComponent(sessionId)}/learner-growth?bindingId=${encodeURIComponent(bindingId)}`,
        signal,
      ), "teacher");
    },
    async reviewLearnerAdaptation(input, signal) {
      return parseLearnerGrowthResponse(await mutate(
        `/api/v3/sessions/${encodeURIComponent(input.sessionId)}/learner-adaptation-decisions`,
        {
          bindingId: input.bindingId,
          requestId: input.requestId,
          expectedProfileRevision: input.expectedProfileRevision,
          action: input.action,
          reason: input.reason,
          ...(input.challengeLevel === undefined
            ? {}
            : { challengeLevel: input.challengeLevel }),
        },
        signal,
      ), "teacher");
    },
    async getLearnerAdaptationV4(sessionId, bindingId, signal) {
      return parseLearnerAdaptationResponseV4(await read(
        `/api/v4/sessions/${encodeURIComponent(sessionId)}/learner-adaptation?bindingId=${encodeURIComponent(bindingId)}`,
        signal,
      ), "teacher");
    },
    async reviewLearnerAdaptationAppealV4(input, signal) {
      return parseLearnerAdaptationResponseV4(await mutate(
        `/api/v4/sessions/${encodeURIComponent(input.sessionId)}/learner-adaptation-appeal-reviews`,
        {
          bindingId: input.bindingId,
          requestId: input.requestId,
          expectedAppealRef: input.expectedAppealRef,
          resolution: input.resolution,
          reason: input.reason,
        },
        signal,
      ), "teacher");
    },
    async authorizeSecondSessionV4(input, signal) {
      return parseLearnerAdaptationResponseV4(await mutate(
        `/api/v4/sessions/${encodeURIComponent(input.sessionId)}/second-session-authorizations`,
        {
          bindingId: input.bindingId,
          requestId: input.requestId,
          expectedHandoffId: input.expectedHandoffId,
        },
        signal,
      ), "teacher");
    },
    async decideFlagshipTeacherGate(input, signal) {
      return parseFlagshipTeacherGateResponse(await mutate(
        `/api/v3/sessions/${encodeURIComponent(input.sessionId)}/episodes/${encodeURIComponent(input.episodeId)}/teacher-gate`,
        {
          bindingId: input.bindingId,
          decision: input.decision,
          teacherDecisionRef: input.teacherDecisionRef,
          revisionPolicy: input.revisionPolicy,
          revisedConsequenceSummary: input.revisedConsequenceSummary,
        },
        signal,
      ), "teacher") as TeacherAgentCollaborationEpisodeV3;
    },
  };
}

export class TeacherGateConfirmationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TeacherGateConfirmationError";
  }
}

export class TeacherGateConflictError extends TeacherGateConfirmationError {
  constructor(
    message: string,
    readonly episode: TeacherCollaborationEpisode,
  ) {
    super(message);
    this.name = "TeacherGateConflictError";
  }
}

function gateDecisionConfirmed(
  episode: TeacherCollaborationEpisode,
  input: TeacherGateDecisionInput,
): boolean {
  if (
    episode.stateVersion <= input.expectedStateVersion
  ) return false;
  if (input.decision === "approve") {
    const sameGateApproved = episode.teacherGate?.gateId === input.gateId
      && episode.teacherGate.status === "approved";
    const chapterAdvanced = episode.status === "in_progress"
      && episode.teacherGate?.gateId !== input.gateId
      && episode.triggerEvent?.eventId !== input.expectedTriggerEventId;
    return sameGateApproved || chapterAdvanced;
  }
  return episode.teacherGate?.gateId === input.gateId
    && episode.teacherGate.status === "rejected"
    && episode.authorityWriteback?.occurred !== true;
}

async function rereadTeacherEpisode(
  gateway: TeacherGateway,
  input: TeacherGateDecisionInput,
  signal?: AbortSignal,
  wait: (milliseconds: number) => Promise<void> = (milliseconds) => (
    new Promise((resolve) => setTimeout(resolve, milliseconds))
  ),
): Promise<TeacherCollaborationEpisode> {
  let latest: TeacherCollaborationEpisode | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) await wait(500 * attempt);
    latest = await gateway.getEpisode(
      input.sessionId,
      input.bindingId,
      signal,
    );
    if (gateDecisionConfirmed(latest, input)) return latest;
  }
  throw new TeacherGateConfirmationError(
    "服务端尚未确认本次教师决定，页面未显示成功。",
  );
}

export async function submitTeacherGateDecision(
  gateway: TeacherGateway,
  input: TeacherGateDecisionInput,
  signal?: AbortSignal,
  wait?: (milliseconds: number) => Promise<void>,
): Promise<TeacherCollaborationEpisode> {
  try {
    await gateway.decideGate(input, signal);
  } catch (cause) {
    if (cause instanceof GatewayHttpError && cause.status === 409) {
      const episode = await gateway.getEpisode(
        input.sessionId,
        input.bindingId,
        signal,
      );
      throw new TeacherGateConflictError(
        "课堂状态已前移，本次教师决定未生效；页面已刷新。",
        episode,
      );
    }
    throw cause;
  }
  return rereadTeacherEpisode(gateway, input, signal, wait);
}
