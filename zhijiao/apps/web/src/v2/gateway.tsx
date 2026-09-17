import {
  DemoLoginCatalogSchema,
  type DemoLoginAccount,
  CourseSubmissionRequestSchema,
  FieldExplorationResponseV4Schema,
  FieldInterviewReadResponseV1Schema,
  FieldInterviewActionResponseV1Schema,
  type FieldInterviewViewV1,
  type FieldInterviewActionRequestV1,
  type FieldExplorationViewV4,
  ExperienceChoiceCommandPayloadSchema,
  StudentAdviceDecisionRequestSchema,
  type CourseEnrollment,
  type CourseOutcomeMutationReceipt,
  type CourseProgressList,
  type CourseReviewWorkspace,
  type LearningActivity,
  type SessionExperienceDescriptor,
  type StudentPortfolio,
  type StudentTrainingContext,
  type StudentCollaborationEpisode,
} from "@ronggang/contracts";
import { createContext, useContext, type ReactNode } from "react";
import { StudentNotebookV1Schema, type StudentNotebookV1, type StudentNotebookMutationV1 } from "@ronggang/contracts";
import { StudentCourseArchiveV3Schema, type StudentCourseArchiveV3 } from "@ronggang/contracts";
import { StudentStudyV3Schema, StartStudyResultV3Schema, TeacherSubmittedWorksV3Schema, type StudentStudyV3, type StartStudyV3, type CancelStudyV3, type StartStudyResultV3 } from "@ronggang/contracts";
import type {
  CourseReleaseSummary,
  CourseReleaseDetailView,
  CourseSubmissionInput,
  DemoAuthContext,
  ExperienceActionInput,
  StudentAdviceDecisionInput,
} from "./models";
import {
  parseClaimResponse,
  parseCourseOutcomeMutationReceipt,
  parseCourseProgressResponse,
  parseCourseResponse,
  parseCourseReviewResponse,
  parseCoursesResponse,
  parseDemoAuthContext,
  parseEnrollmentsResponse,
  parseLearningActivityResponse,
  parseSessionExperienceDescriptorResponse,
  parseStudentEpisodeResponse,
  parseStudentPortfolioResponse,
  parseStudentTrainingMutationReceipt,
  parseStudentTrainingContextResponse,
} from "./wire";
import {
  parseFlagshipAdvanceResponse,
  parseFlagshipActionResponse,
  parseFlagshipEpisodeResponse,
  parseFlagshipWorkspaceResponse,
  parseFlagshipWorldResponse,
  type DecideFlagshipEpisodeInput,
  type FlagshipAdvanceResult,
  type FlagshipWorldView,
  type FlagshipWorkspaceView,
  type SaveFlagshipWorkRevisionInput,
  type SubmitFlagshipWorkRevisionInput,
  type SubmitFlagshipWorldActionInput,
} from "./world-v3";
import type { StudentAgentCollaborationEpisodeV3 } from "@ronggang/contracts";
import {
  parseFlagshipCompetencyEvidenceResponse,
  type FlagshipCompetencyEvidenceViewV3,
} from "./assessment-v3";
import {
  parseFlagshipEvidenceAssessmentResponseV4,
  type FlagshipEvidenceAssessmentViewV4,
} from "./assessment-v4";
import {
  parseLearnerGrowthResponse,
  type LearnerGrowthViewV3,
  type RequestLearnerAppealInputV3,
} from "./learner-adaptation-v3";
import {
  parseLearnerAdaptationResponseV4,
  type LearnerAdaptationViewV4,
  type RecordLearnerConsentInputV4,
  type RequestLearnerAdaptationAppealInputV4,
} from "./learner-adaptation-v4";
import {
  parseFlagshipExperienceResponseV4,
  parseFlagshipGroundedDecisionResponseV4,
  parseFlagshipMediaWorkspaceResponseV4,
  parseFlagshipSemanticActionReceiptV4,
  type CreateFlagshipMediaRevisionInputV4,
  type DecideGroundedSuggestionInputV4,
  type FlagshipExperienceViewV4,
  type GroundedCollaborationStudentEnvelopeV4,
  type FlagshipMediaWorkspaceV4,
  type FlagshipSemanticActionReceiptV4,
  type SubmitSemanticActionInputV4,
} from "./flagship-v4";
import {
  parseFlagshipDialogueResponseV4,
  parseFlagshipDialogueStartResponseV4,
  type StartFlagshipDialogueInputV4,
  type StudentDialogueEpisodeEnvelopeV4,
  type SubmitFlagshipDialogueTurnInputV4,
} from "./dialogue-v4";
import type { DialogueStartResponseV4 } from "@ronggang/contracts";

export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface ExperienceGateway {
  getStudy?(signal?: AbortSignal): Promise<StudentStudyV3>;
  startStudy?(input: StartStudyV3): Promise<StartStudyResultV3>;
  cancelStudy?(input: CancelStudyV3): Promise<StudentStudyV3>;
  completeStudy?(input: import("@ronggang/contracts").CompleteStudyV3): Promise<StudentStudyV3>;
  enterPreparedStudy?(input:import('@ronggang/contracts').EnterPreparedStudyV3):Promise<StartStudyResultV3>;
  getStudyWorks?(sessionId:string,signal?:AbortSignal):Promise<import('@ronggang/contracts').TeacherSubmittedWorksV3>;
  getCourseArchive?(signal?: AbortSignal): Promise<StudentCourseArchiveV3>;
  getStudentNotebook?(sessionId: string, bindingId: string, signal?: AbortSignal): Promise<StudentNotebookV1>;
  updateStudentNotebook?(sessionId: string, input: StudentNotebookMutationV1): Promise<StudentNotebookV1>;
  authorizeSession(
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<string>;
  getCourses(signal?: AbortSignal): Promise<CourseReleaseSummary[]>;
  getCourse(courseId: string, signal?: AbortSignal): Promise<CourseReleaseDetailView>;
  getEnrollments(signal?: AbortSignal): Promise<CourseEnrollment[]>;
  getCourseProgress(signal?: AbortSignal): Promise<CourseProgressList>;
  getPortfolio(signal?: AbortSignal): Promise<StudentPortfolio>;
  claimCourse(
    courseReleaseId: string,
    signal?: AbortSignal,
  ): Promise<CourseEnrollment>;
  getLearningActivity(
    sessionId: string,
    bindingId: string,
    signal?: AbortSignal,
  ): Promise<LearningActivity>;
  getSessionExperienceDescriptor(
    sessionId: string,
    bindingId: string,
    signal?: AbortSignal,
  ): Promise<SessionExperienceDescriptor>;
  getStudentTrainingContext(
    sessionId: string,
    bindingId: string,
    signal?: AbortSignal,
  ): Promise<StudentTrainingContext>;
  getStudentEpisode(
    sessionId: string,
    bindingId: string,
    signal?: AbortSignal,
  ): Promise<StudentCollaborationEpisode>;
  getCourseReview(
    sessionId: string,
    bindingId: string,
    signal?: AbortSignal,
  ): Promise<CourseReviewWorkspace>;
  submitCourseForReview(
    input: CourseSubmissionInput,
    signal?: AbortSignal,
  ): Promise<CourseOutcomeMutationReceipt>;
  recordAdviceDecision(
    input: StudentAdviceDecisionInput,
    signal?: AbortSignal,
  ): Promise<void>;
  recordExperienceAction(
    input: ExperienceActionInput,
    signal?: AbortSignal,
  ): Promise<void>;
  getFlagshipWorld?(
    sessionId: string,
    bindingId: string,
    signal?: AbortSignal,
  ): Promise<FlagshipWorldView>;
  getFlagshipEpisode?(
    sessionId: string,
    bindingId: string,
    signal?: AbortSignal,
  ): Promise<StudentAgentCollaborationEpisodeV3>;
  submitFlagshipAction?(
    input: SubmitFlagshipWorldActionInput,
    signal?: AbortSignal,
  ): Promise<StudentAgentCollaborationEpisodeV3>;
  decideFlagshipEpisode?(
    input: DecideFlagshipEpisodeInput,
    signal?: AbortSignal,
  ): Promise<StudentAgentCollaborationEpisodeV3>;
  advanceFlagshipWorld?(
    sessionId: string,
    bindingId: string,
    signal?: AbortSignal,
  ): Promise<FlagshipAdvanceResult>;
  getFlagshipWorkspace?(
    sessionId: string,
    bindingId: string,
    signal?: AbortSignal,
  ): Promise<FlagshipWorkspaceView>;
  saveFlagshipWorkRevision?(
    input: SaveFlagshipWorkRevisionInput,
    signal?: AbortSignal,
  ): Promise<FlagshipWorkspaceView>;
  submitFlagshipWorkRevision?(
    input: SubmitFlagshipWorkRevisionInput,
    signal?: AbortSignal,
  ): Promise<FlagshipWorkspaceView>;
  getFlagshipCompetencyEvidence?(
    sessionId: string,
    bindingId: string,
    signal?: AbortSignal,
  ): Promise<FlagshipCompetencyEvidenceViewV3>;
  getFlagshipEvidenceAssessmentV4?(
    sessionId: string,
    bindingId: string,
    signal?: AbortSignal,
  ): Promise<FlagshipEvidenceAssessmentViewV4>;
  retryFlagshipEvidenceAssessmentV4?(sessionId:string,bindingId:string,requestId:string):Promise<FlagshipEvidenceAssessmentViewV4>;
  getLearnerGrowth?(
    sessionId: string,
    bindingId: string,
    signal?: AbortSignal,
  ): Promise<LearnerGrowthViewV3>;
  requestLearnerAppeal?(
    input: RequestLearnerAppealInputV3,
    signal?: AbortSignal,
  ): Promise<LearnerGrowthViewV3>;
  getLearnerAdaptationV4?(
    sessionId: string,
    bindingId: string,
    signal?: AbortSignal,
  ): Promise<LearnerAdaptationViewV4>;
  recordLearnerConsentV4?(
    input: RecordLearnerConsentInputV4,
    signal?: AbortSignal,
  ): Promise<LearnerAdaptationViewV4>;
  requestLearnerAdaptationAppealV4?(
    input: RequestLearnerAdaptationAppealInputV4,
    signal?: AbortSignal,
  ): Promise<LearnerAdaptationViewV4>;
  getFlagshipExperienceV4?(
    sessionId: string,
    bindingId: string,
    signal?: AbortSignal,
  ): Promise<FlagshipExperienceViewV4>;
  getExplorationFieldV4?(
    sessionId: string,
    bindingId: string,
    signal?: AbortSignal,
  ): Promise<FieldExplorationViewV4>;
  getFieldInterviewV1?(sessionId: string, bindingId: string, signal?: AbortSignal): Promise<FieldInterviewViewV1 | null>;
  submitFieldInterviewV1?(input: FieldInterviewActionRequestV1, signal?: AbortSignal): Promise<FieldInterviewViewV1>;
  startFlagshipDialogueV4?(
    input: StartFlagshipDialogueInputV4,
    signal?: AbortSignal,
  ): Promise<DialogueStartResponseV4>;
  getFlagshipDialogueV4?(
    sessionId: string,
    bindingId: string,
    signal?: AbortSignal,
  ): Promise<StudentDialogueEpisodeEnvelopeV4 | null>;
  submitFlagshipDialogueTurnV4?(
    input: SubmitFlagshipDialogueTurnInputV4,
    signal?: AbortSignal,
  ): Promise<StudentDialogueEpisodeEnvelopeV4 | null>;
  submitSemanticActionV4?(
    input: SubmitSemanticActionInputV4,
    signal?: AbortSignal,
  ): Promise<FlagshipSemanticActionReceiptV4>;
  decideGroundedSuggestionV4?(
    input: DecideGroundedSuggestionInputV4,
    signal?: AbortSignal,
  ): Promise<GroundedCollaborationStudentEnvelopeV4>;
  refreshGroundedEvidenceV4?(
    input: { sessionId: string; episodeId: string; bindingId: string },
    signal?: AbortSignal,
  ): Promise<GroundedCollaborationStudentEnvelopeV4>;
  getFlagshipMediaWorkspaceV4?(
    sessionId: string,
    bindingId: string,
    artifactRef?: string,
    signal?: AbortSignal,
  ): Promise<FlagshipMediaWorkspaceV4>;
  createFlagshipMediaRevisionV4?(
    input: CreateFlagshipMediaRevisionInputV4,
    signal?: AbortSignal,
  ): Promise<FlagshipMediaWorkspaceV4>;
  flagshipMediaAssetUrlV4?(
    sessionId: string,
    bindingId: string,
    assetRef: string,
  ): string;
}

export interface DemoAuthInput {
  profileId: string;
  sessionId?: string;
  signal?: AbortSignal;
}

export interface GatewayRuntimeOptions {
  apiBase?: string;
  fetchImpl?: FetchLike;
}

export class GatewayHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string | null,
  ) {
    super(message);
    this.name = "GatewayHttpError";
  }
}

function defaultApiBase(): string {
  return (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/u, "");
}

function requestRuntime(options: GatewayRuntimeOptions): {
  apiBase: string;
  fetchImpl: FetchLike;
} {
  return {
    apiBase: (options.apiBase ?? defaultApiBase()).replace(/\/$/u, ""),
    fetchImpl: options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init)),
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

async function fetchUnknown(
  path: string,
  init: RequestInit,
  options: GatewayRuntimeOptions,
): Promise<unknown> {
  const runtime = requestRuntime(options);
  const response = await runtime.fetchImpl(`${runtime.apiBase}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    const failure = errorMessage(body, response.status);
    throw new GatewayHttpError(response.status, failure.message, failure.code);
  }
  return body;
}

export async function establishDemoAuth(
  input: DemoAuthInput,
  options: GatewayRuntimeOptions = {},
): Promise<DemoAuthContext> {
  const body = await fetchUnknown("/api/auth/demo-session", {
    method: "POST",
    ...(input.signal ? { signal: input.signal } : {}),
    body: JSON.stringify({
      profileId: input.profileId,
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    }),
  }, options);
  return parseDemoAuthContext(body, {
    profileId: input.profileId,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
  });
}

export async function readDemoLoginAccounts(signal?:AbortSignal,options:GatewayRuntimeOptions={}):Promise<DemoLoginAccount[]>{
  return DemoLoginCatalogSchema.parse(await fetchUnknown('/api/auth/demo-accounts',signal?{signal}:{},options)).accounts;
}
export async function loginDemoAccount(input:{username:string;password:string;role:'student'|'teacher'},options:GatewayRuntimeOptions={}):Promise<DemoAuthContext>{
  return parseDemoAuthContext(await fetchUnknown('/api/auth/login',{method:'POST',body:JSON.stringify(input)},options),{});
}
export async function restoreAuthenticatedAuth(input:{sessionId?:string;signal?:AbortSignal;profileId?:string;role?:'student'|'teacher'},options:GatewayRuntimeOptions={}):Promise<DemoAuthContext>{
  const current=parseDemoAuthContext(await fetchUnknown('/api/auth/session',input.signal?{signal:input.signal}:{},options),{});
  if((input.profileId&&current.profileId!==input.profileId)||(input.role&&!current.profileId.startsWith(input.role+'-')))throw new GatewayHttpError(401,'请选择对应账号登录','identity_mismatch');
  if(!input.sessionId||current.bindings.some(binding=>binding.sessionId===input.sessionId))return current;
  return parseDemoAuthContext(await fetchUnknown('/api/auth/session-context',{
    method:'POST',...(input.signal?{signal:input.signal}:{}),headers:{'X-CSRF-Token':current.csrfToken},body:JSON.stringify({sessionId:input.sessionId}),
  },options),{profileId:current.profileId,sessionId:input.sessionId});
}
export async function logoutDemoAccount(csrfToken:string,options:GatewayRuntimeOptions={}):Promise<void>{
  await fetchUnknown('/api/auth/logout',{method:'POST',headers:{'X-CSRF-Token':csrfToken}},options);
}

export function createHttpExperienceGateway(
  auth: DemoAuthContext,
  options: GatewayRuntimeOptions = {},
): ExperienceGateway {
  let activeAuth = auth;
  const read = (path: string, signal?: AbortSignal) => fetchUnknown(
    path,
    signal ? { signal } : {},
    options,
  );
  const mutate = (path: string, body: unknown, signal?: AbortSignal) => (
    fetchUnknown(path, {
      method: "POST",
      ...(signal ? { signal } : {}),
      headers: { "X-CSRF-Token": activeAuth.csrfToken },
      body: JSON.stringify(body),
    }, options)
  );

  return {
    async getStudy(signal) { return StudentStudyV3Schema.parse(await read("/api/v3/me/study", signal)); },
    async startStudy(input) { return StartStudyResultV3Schema.parse(await mutate("/api/v3/me/study/start", input)); },
    async cancelStudy(input) { return StudentStudyV3Schema.parse(await mutate("/api/v3/me/study/cancel", input)); },
    async completeStudy(input) { return StudentStudyV3Schema.parse(await mutate("/api/v3/me/study/complete", input)); },
    async enterPreparedStudy(input) {return StartStudyResultV3Schema.parse(await mutate('/api/v3/me/study/enter-prepared',input));},
    async getStudyWorks(sessionId,signal){return TeacherSubmittedWorksV3Schema.parse(await read(`/api/v3/me/study/${encodeURIComponent(sessionId)}/works`,signal));},
    async getCourseArchive(signal) { return StudentCourseArchiveV3Schema.parse(await read("/api/v3/course-archive", signal)); },
    async getStudentNotebook(sessionId, bindingId, signal) {
      return StudentNotebookV1Schema.parse(await read(`/api/v3/sessions/${encodeURIComponent(sessionId)}/notebook?bindingId=${encodeURIComponent(bindingId)}`, signal));
    },
    async updateStudentNotebook(sessionId, input) {
      return StudentNotebookV1Schema.parse(await mutate(`/api/v3/sessions/${encodeURIComponent(sessionId)}/notebook`, input));
    },
    async authorizeSession(sessionId, signal) {
      const nextAuth = await restoreAuthenticatedAuth({
        profileId:activeAuth.profileId,
        sessionId,
        ...(signal ? { signal } : {}),
      }, options);
      const reporterBindings = nextAuth.bindings.filter((binding) => (
        binding.sessionId === sessionId
        && binding.actorKind === "student"
        && binding.roleId === "reporter"
      ));
      if (reporterBindings.length !== 1) {
        throw new Error("当前训练会话没有唯一有效的记者岗位绑定。");
      }
      activeAuth = nextAuth;
      return reporterBindings[0]!.bindingId;
    },
    async getCourses(signal) {
      return parseCoursesResponse(await read("/api/courses", signal));
    },
    async getCourse(courseId, signal) {
      return parseCourseResponse(await read(
        `/api/courses/${encodeURIComponent(courseId)}`,
        signal,
      ));
    },
    async getEnrollments(signal) {
      return parseEnrollmentsResponse(
        await read("/api/me/course-enrollments", signal),
      );
    },
    async getCourseProgress(signal) {
      return parseCourseProgressResponse(await read(
        "/api/me/course-progress",
        signal,
      ));
    },
    async getPortfolio(signal) {
      return parseStudentPortfolioResponse(await read(
        "/api/me/portfolio",
        signal,
      ));
    },
    async claimCourse(courseReleaseId, signal) {
      return parseClaimResponse(await mutate(
        "/api/course-enrollments",
        { courseReleaseId },
        signal,
      ));
    },
    async getLearningActivity(sessionId, bindingId, signal) {
      return parseLearningActivityResponse(await read(
        `/api/sessions/${encodeURIComponent(sessionId)}/learning-activity?bindingId=${encodeURIComponent(bindingId)}`,
        signal,
      ));
    },
    async getSessionExperienceDescriptor(sessionId, bindingId, signal) {
      return parseSessionExperienceDescriptorResponse(await read(
        `/api/sessions/${encodeURIComponent(sessionId)}/experience-descriptor?bindingId=${encodeURIComponent(bindingId)}`,
        signal,
      ));
    },
    async getStudentTrainingContext(sessionId, bindingId, signal) {
      return parseStudentTrainingContextResponse(await read(
        `/api/sessions/${encodeURIComponent(sessionId)}/student-training-context?bindingId=${encodeURIComponent(bindingId)}`,
        signal,
      ));
    },
    async getStudentEpisode(sessionId, bindingId, signal) {
      return parseStudentEpisodeResponse(await read(
        `/api/sessions/${encodeURIComponent(sessionId)}/collaboration-episode?bindingId=${encodeURIComponent(bindingId)}`,
        signal,
      ));
    },
    async getCourseReview(sessionId, bindingId, signal) {
      return parseCourseReviewResponse(await read(
        `/api/sessions/${encodeURIComponent(sessionId)}/course-review?bindingId=${encodeURIComponent(bindingId)}`,
        signal,
      ));
    },
    async submitCourseForReview(input, signal) {
      const request = CourseSubmissionRequestSchema.parse({
        bindingId: input.bindingId,
        expectedEnrollmentStateVersion: input.expectedEnrollmentStateVersion,
        requestId: input.requestId,
      });
      return parseCourseOutcomeMutationReceipt(await mutate(
        `/api/sessions/${encodeURIComponent(input.sessionId)}/course-submissions`,
        request,
        signal,
      ));
    },
    async recordAdviceDecision(input, signal) {
      const payload = StudentAdviceDecisionRequestSchema.parse({
        suggestionId: input.suggestionId,
        decision: input.decision,
      });
      const receipt = parseStudentTrainingMutationReceipt(await mutate(
        `/api/sessions/${encodeURIComponent(input.sessionId)}/commands`,
        {
          bindingId: input.bindingId,
          name: "record_experience_choice",
          expectedStateVersion: input.expectedStateVersion,
          sourceMode: "course_platform",
          surfaceId: "student-v2-current-advice",
          interactionId: input.suggestionId,
          payload,
        },
        signal,
      ));
      if (receipt.sessionId !== input.sessionId) {
        throw new Error("建议决定回执与当前训练会话不一致");
      }
    },
    async recordExperienceAction(input, signal) {
      const payload = ExperienceChoiceCommandPayloadSchema.parse({
        choiceRef: input.actionRef,
      });
      const receipt = parseStudentTrainingMutationReceipt(await mutate(
        `/api/sessions/${encodeURIComponent(input.sessionId)}/commands`,
        {
          bindingId: input.bindingId,
          name: "record_experience_choice",
          expectedStateVersion: input.expectedStateVersion,
          sourceMode: "world_interaction",
          surfaceId: "student-v2-training",
          interactionId: input.actionRef,
          payload,
        },
        signal,
      ));
      if (receipt.sessionId !== input.sessionId) {
        throw new Error("主行动回执与当前训练会话不一致");
      }
    },
    async getFlagshipWorld(sessionId, bindingId, signal) {
      return parseFlagshipWorldResponse(await read(
        `/api/v3/sessions/${encodeURIComponent(sessionId)}/world?bindingId=${encodeURIComponent(bindingId)}`,
        signal,
      ));
    },
    async getFlagshipEpisode(sessionId, bindingId, signal) {
      return parseFlagshipEpisodeResponse(await read(
        `/api/v3/sessions/${encodeURIComponent(sessionId)}/collaboration-episode?bindingId=${encodeURIComponent(bindingId)}`,
        signal,
      ));
    },
    async getFlagshipCompetencyEvidence(sessionId, bindingId, signal) {
      return parseFlagshipCompetencyEvidenceResponse(await read(
        `/api/v3/sessions/${encodeURIComponent(sessionId)}/competency-evidence?bindingId=${encodeURIComponent(bindingId)}`,
        signal,
      ), "student");
    },
    async getFlagshipEvidenceAssessmentV4(sessionId, bindingId, signal) {
      return parseFlagshipEvidenceAssessmentResponseV4(await read(
        `/api/v4/sessions/${encodeURIComponent(sessionId)}/evidence-assessment?bindingId=${encodeURIComponent(bindingId)}`,
        signal,
      ), "student");
    },
    async retryFlagshipEvidenceAssessmentV4(sessionId,bindingId,requestId){return parseFlagshipEvidenceAssessmentResponseV4(await mutate(`/api/v4/sessions/${encodeURIComponent(sessionId)}/evidence-assessment/retry`,{bindingId,requestId}),'student');},
    async getLearnerGrowth(sessionId, bindingId, signal) {
      return parseLearnerGrowthResponse(await read(
        `/api/v3/sessions/${encodeURIComponent(sessionId)}/learner-growth?bindingId=${encodeURIComponent(bindingId)}`,
        signal,
      ), "student");
    },
    async requestLearnerAppeal(input, signal) {
      return parseLearnerGrowthResponse(await mutate(
        `/api/v3/sessions/${encodeURIComponent(input.sessionId)}/learner-growth/appeals`,
        {
          bindingId: input.bindingId,
          requestId: input.requestId,
          reason: input.reason,
        },
        signal,
      ), "student");
    },
    async getLearnerAdaptationV4(sessionId, bindingId, signal) {
      return parseLearnerAdaptationResponseV4(await read(
        `/api/v4/sessions/${encodeURIComponent(sessionId)}/learner-adaptation?bindingId=${encodeURIComponent(bindingId)}`,
        signal,
      ), "student");
    },
    async recordLearnerConsentV4(input, signal) {
      return parseLearnerAdaptationResponseV4(await mutate(
        `/api/v4/sessions/${encodeURIComponent(input.sessionId)}/learner-adaptation-consents`,
        {
          bindingId: input.bindingId,
          requestId: input.requestId,
          accepted: input.accepted,
        },
        signal,
      ), "student");
    },
    async requestLearnerAdaptationAppealV4(input, signal) {
      return parseLearnerAdaptationResponseV4(await mutate(
        `/api/v4/sessions/${encodeURIComponent(input.sessionId)}/learner-adaptation-appeals`,
        {
          bindingId: input.bindingId,
          requestId: input.requestId,
          reason: input.reason,
        },
        signal,
      ), "student");
    },
    async getFlagshipExperienceV4(sessionId, bindingId, signal) {
      return parseFlagshipExperienceResponseV4(await read(
        `/api/v4/sessions/${encodeURIComponent(sessionId)}/experience?bindingId=${encodeURIComponent(bindingId)}`,
        signal,
      ), "student");
    },
    async getExplorationFieldV4(sessionId, bindingId, signal) {
      const field = FieldExplorationResponseV4Schema.parse(await read(
        `/api/v4/sessions/${encodeURIComponent(sessionId)}/field?bindingId=${encodeURIComponent(bindingId)}`,
        signal,
      )).field;
      if (field.sessionId !== sessionId || field.bindingId !== bindingId) {
        throw new Error("现场投影与当前课程或学生绑定不一致，已停止加载。");
      }
      return field;
    },
    async getFieldInterviewV1(sessionId, bindingId, signal) {
      const { view } = FieldInterviewReadResponseV1Schema.parse(await read(`/api/v4/sessions/${encodeURIComponent(sessionId)}/interview?bindingId=${encodeURIComponent(bindingId)}`, signal));
      if (view && (view.sessionId !== sessionId || view.bindingId !== bindingId)) throw new Error("采访视图不属于当前学生场次，已停止加载。");
      return view;
    },
    async submitFieldInterviewV1(input, signal) {
      const { view } = FieldInterviewActionResponseV1Schema.parse(await mutate(`/api/v4/sessions/${encodeURIComponent(input.sessionId)}/interview/actions`, input, signal));
      if (view.sessionId !== input.sessionId || view.bindingId !== input.bindingId) throw new Error("采访结果不属于当前学生场次。");
      return view;
    },
    async startFlagshipDialogueV4(input, signal) {
      return parseFlagshipDialogueStartResponseV4(await mutate(
        `/api/v4/sessions/${encodeURIComponent(input.sessionId)}/dialogues`,
        input,
        signal,
      ));
    },
    async getFlagshipDialogueV4(sessionId, bindingId, signal) {
      return parseFlagshipDialogueResponseV4(await read(
        `/api/v4/sessions/${encodeURIComponent(sessionId)}/dialogue?bindingId=${encodeURIComponent(bindingId)}`,
        signal,
      ));
    },
    async submitFlagshipDialogueTurnV4(input, signal) {
      return parseFlagshipDialogueResponseV4(await mutate(
        `/api/v4/sessions/${encodeURIComponent(input.sessionId)}/dialogues/${encodeURIComponent(input.episodeId)}/turns`,
        input,
        signal,
      ));
    },
    async submitSemanticActionV4(input, signal) {
      return parseFlagshipSemanticActionReceiptV4(await mutate(
        `/api/v4/sessions/${encodeURIComponent(input.sessionId)}/semantic-actions`,
        input,
        signal,
      ));
    },
    async decideGroundedSuggestionV4(input, signal) {
      return parseFlagshipGroundedDecisionResponseV4(await mutate(
        `/api/v4/sessions/${encodeURIComponent(input.sessionId)}/grounded-episodes/${encodeURIComponent(input.episodeId)}/decisions`,
        {
          bindingId: input.bindingId,
          decisionToken: input.decisionToken,
          decisionRef: input.decisionRef,
          decision: input.decision,
          rationale: input.rationale,
        },
        signal,
      ));
    },
    async refreshGroundedEvidenceV4(input, signal) {
      return parseFlagshipGroundedDecisionResponseV4(await mutate(
        `/api/v4/sessions/${encodeURIComponent(input.sessionId)}/grounded-episodes/${encodeURIComponent(input.episodeId)}/refresh`,
        { bindingId: input.bindingId }, signal,
      ));
    },
    async getFlagshipMediaWorkspaceV4(
      sessionId,
      bindingId,
      artifactRef,
      signal,
    ) {
      const query = new URLSearchParams({ bindingId });
      if (artifactRef) query.set("artifactRef", artifactRef);
      return parseFlagshipMediaWorkspaceResponseV4(await read(
        `/api/v4/sessions/${encodeURIComponent(sessionId)}/media-workspace?${query.toString()}`,
        signal,
      ));
    },
    async createFlagshipMediaRevisionV4(input, signal) {
      return parseFlagshipMediaWorkspaceResponseV4(await mutate(
        `/api/v4/sessions/${encodeURIComponent(input.sessionId)}/media-revisions`,
        {
          bindingId: input.bindingId,
          artifactRef: input.artifactRef,
          requestId: input.requestId,
          expectedRevisionNumber: input.expectedRevisionNumber,
          status: input.status,
          sourceAssetRefs: input.sourceAssetRefs,
          operations: input.operations,
          supportingEvidenceRefs: input.supportingEvidenceRefs,
          studentEditorialRationale: input.studentEditorialRationale,
        },
        signal,
      ));
    },
    flagshipMediaAssetUrlV4(sessionId, bindingId, assetRef) {
      const base = requestRuntime(options).apiBase;
      return `${base}/api/v4/sessions/${encodeURIComponent(sessionId)}/media-assets/${encodeURIComponent(assetRef)}?bindingId=${encodeURIComponent(bindingId)}`;
    },
    async submitFlagshipAction(input, signal) {
      return parseFlagshipActionResponse(await mutate(
        `/api/v3/sessions/${encodeURIComponent(input.sessionId)}/student-actions`,
        {
          bindingId: input.bindingId,
          requestId: input.requestId,
          eventTemplateId: input.eventTemplateId,
          serverIssuedActionRef: input.serverIssuedActionRef,
          expectedWorldStateVersion: input.expectedWorldStateVersion,
          action: input.action,
          sourceWorldEventIds: input.sourceWorldEventIds,
          reflectionNote: input.reflectionNote,
        },
        signal,
      ));
    },
    async decideFlagshipEpisode(input, signal) {
      return parseFlagshipEpisodeResponse(await mutate(
        `/api/v3/sessions/${encodeURIComponent(input.sessionId)}/episodes/${encodeURIComponent(input.episodeId)}/decisions`,
        {
          bindingId: input.bindingId,
          decisionRef: input.decisionRef,
          decision: input.decision,
          rationale: input.rationale,
        },
        signal,
      ));
    },
    async advanceFlagshipWorld(sessionId, bindingId, signal) {
      return parseFlagshipAdvanceResponse(await mutate(
        `/api/v3/sessions/${encodeURIComponent(sessionId)}/advance`,
        { bindingId },
        signal,
      ));
    },
    async getFlagshipWorkspace(sessionId, bindingId, signal) {
      return parseFlagshipWorkspaceResponse(await read(
        `/api/v3/sessions/${encodeURIComponent(sessionId)}/workspace?bindingId=${encodeURIComponent(bindingId)}`,
        signal,
      ));
    },
    async saveFlagshipWorkRevision(input, signal) {
      return parseFlagshipWorkspaceResponse(await mutate(
        `/api/v3/sessions/${encodeURIComponent(input.sessionId)}/workspace/artifacts/${encodeURIComponent(input.artifactId)}/revisions`,
        {
          bindingId: input.bindingId,
          requestId: input.requestId,
          expectedRevisionNumber: input.expectedRevisionNumber,
          fields: input.fields,
          evidenceRefs: input.evidenceRefs,
          revisionNote: input.revisionNote,
        },
        signal,
      ));
    },
    async submitFlagshipWorkRevision(input, signal) {
      return parseFlagshipWorkspaceResponse(await mutate(
        `/api/v3/sessions/${encodeURIComponent(input.sessionId)}/workspace/artifacts/${encodeURIComponent(input.artifactId)}/submit`,
        {
          bindingId: input.bindingId,
          requestId: input.requestId,
          revisionId: input.revisionId,
          contentHash: input.contentHash,
          ...(input.supplement ? { supplement: input.supplement } : {}),
        },
        signal,
      ));
    },
  };
}

const GatewayContext = createContext<ExperienceGateway | null>(null);

export function ExperienceGatewayProvider({
  gateway,
  children,
}: {
  gateway: ExperienceGateway;
  children: ReactNode;
}) {
  return (
    <GatewayContext.Provider value={gateway}>
      {children}
    </GatewayContext.Provider>
  );
}

export function useExperienceGateway(): ExperienceGateway {
  const gateway = useContext(GatewayContext);
  if (!gateway) throw new Error("ExperienceGatewayProvider 未配置");
  return gateway;
}
