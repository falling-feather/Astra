import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  LearnerAdaptationAdminCaseResponseV4Schema,
  LearnerAdaptationResponseV4Schema,
  V2IdentifierSchema,
} from "@ronggang/contracts";
import { PermissionDeniedError } from "@ronggang/world-core";
import {
  type LearnerAdaptationRecordV4,
  type LearnerAdaptationServiceV4,
} from "./learner-adaptation-v4.js";
import type {
  AuthorizedSimulationWorldActorV3,
} from "./world-simulation-v3-routes.js";
import { parsePublicProjection } from "./public-projection-contract.js";

const sessionParamsSchema = z.object({
  sessionId: V2IdentifierSchema,
}).strict();
const bindingQuerySchema = z.object({
  bindingId: V2IdentifierSchema,
}).strict();
const emptyQuerySchema = z.object({}).strict();
const consentBodySchema = z.object({
  bindingId: V2IdentifierSchema,
  requestId: V2IdentifierSchema,
  accepted: z.boolean(),
}).strict();
const appealBodySchema = z.object({
  bindingId: V2IdentifierSchema,
  requestId: V2IdentifierSchema,
  reason: z.string().trim().min(8).max(1_000),
}).strict();
const appealReviewBodySchema = z.object({
  bindingId: V2IdentifierSchema,
  requestId: V2IdentifierSchema,
  expectedAppealRef: V2IdentifierSchema,
  resolution: z.enum(["confirmed", "reopen_assessment"]),
  reason: z.string().trim().min(8).max(1_000),
}).strict();
const authorizationBodySchema = z.object({
  bindingId: V2IdentifierSchema,
  requestId: V2IdentifierSchema,
  expectedHandoffId: V2IdentifierSchema,
}).strict();

export interface LearnerAdaptationV4RouteDependencies {
  adaptation: Pick<
    LearnerAdaptationServiceV4,
    | "getOrRefresh"
    | "recordConsent"
    | "requestAppeal"
    | "reviewAppeal"
    | "authorizeAndProvision"
    | "projectView"
    | "projectAdminCase"
  >;
  authorize(input: {
    request: FastifyRequest;
    sessionId: string;
    bindingId: string;
    mutation: boolean;
  }): AuthorizedSimulationWorldActorV3 | Promise<AuthorizedSimulationWorldActorV3>;
}

function assertStudentOwns(
  authorized: AuthorizedSimulationWorldActorV3,
  record: LearnerAdaptationRecordV4 | null,
): void {
  if (authorized.audience !== "student" || record === null) return;
  if (authorized.bindingId !== record.learnerBindingId
    || authorized.actorId !== record.learnerActorId) {
    throw new PermissionDeniedError("学生只能查看自己的第二场自适应方案");
  }
}

function publicAdaptationResponse(adaptation: unknown) {
  return parsePublicProjection(
    LearnerAdaptationResponseV4Schema,
    { adaptation },
    "LearnerAdaptationResponseV4",
  );
}

function adminAdaptationResponse(adaptationCase: unknown) {
  return parsePublicProjection(
    LearnerAdaptationAdminCaseResponseV4Schema,
    { adaptationCase },
    "LearnerAdaptationAdminCaseResponseV4",
  );
}

export async function registerLearnerAdaptationV4Routes(
  app: FastifyInstance,
  dependencies: LearnerAdaptationV4RouteDependencies,
): Promise<void> {
  app.get<{ Params: { sessionId: string } }>(
    "/api/v4/sessions/:sessionId/learner-adaptation",
    async (request) => {
      const params = sessionParamsSchema.parse(request.params);
      const query = bindingQuerySchema.parse(request.query);
      const authorized = await dependencies.authorize({
        request,
        sessionId: params.sessionId,
        bindingId: query.bindingId,
        mutation: false,
      });
      if (authorized.audience === "admin") {
        throw new PermissionDeniedError("管理员请从 V4 自适应审计案例端点读取完整记录");
      }
      const record = await dependencies.adaptation.getOrRefresh({
        sessionId: params.sessionId,
        ...(authorized.audience === "student" ? {
          fallbackLearner: {
            bindingId: authorized.bindingId,
            actorId: authorized.actorId,
          },
        } : {}),
      });
      assertStudentOwns(authorized, record);
      return publicAdaptationResponse(
        dependencies.adaptation.projectView(record, authorized.audience),
      );
    },
  );

  app.post<{ Params: { sessionId: string } }>(
    "/api/v4/sessions/:sessionId/learner-adaptation-consents",
    async (request) => {
      emptyQuerySchema.parse(request.query);
      const params = sessionParamsSchema.parse(request.params);
      const body = consentBodySchema.parse(request.body);
      const authorized = await dependencies.authorize({
        request,
        sessionId: params.sessionId,
        bindingId: body.bindingId,
        mutation: true,
      });
      if (authorized.audience !== "student") {
        throw new PermissionDeniedError("只有学生本人可以同意或拒绝第二场");
      }
      const record = await dependencies.adaptation.recordConsent({
        sessionId: params.sessionId,
        learnerBindingId: authorized.bindingId,
        learnerActorId: authorized.actorId,
        requestId: body.requestId,
        accepted: body.accepted,
      });
      return publicAdaptationResponse(
        dependencies.adaptation.projectView(record, "student"),
      );
    },
  );

  app.post<{ Params: { sessionId: string } }>(
    "/api/v4/sessions/:sessionId/learner-adaptation-appeals",
    async (request) => {
      emptyQuerySchema.parse(request.query);
      const params = sessionParamsSchema.parse(request.params);
      const body = appealBodySchema.parse(request.body);
      const authorized = await dependencies.authorize({
        request,
        sessionId: params.sessionId,
        bindingId: body.bindingId,
        mutation: true,
      });
      if (authorized.audience !== "student") {
        throw new PermissionDeniedError("只有学生本人可以发起能力模型申诉");
      }
      const record = await dependencies.adaptation.requestAppeal({
        sessionId: params.sessionId,
        learnerBindingId: authorized.bindingId,
        learnerActorId: authorized.actorId,
        requestId: body.requestId,
        reason: body.reason,
      });
      return publicAdaptationResponse(
        dependencies.adaptation.projectView(record, "student"),
      );
    },
  );

  app.post<{ Params: { sessionId: string } }>(
    "/api/v4/sessions/:sessionId/learner-adaptation-appeal-reviews",
    async (request) => {
      emptyQuerySchema.parse(request.query);
      const params = sessionParamsSchema.parse(request.params);
      const body = appealReviewBodySchema.parse(request.body);
      const authorized = await dependencies.authorize({
        request,
        sessionId: params.sessionId,
        bindingId: body.bindingId,
        mutation: true,
      });
      if (authorized.audience !== "teacher" && authorized.audience !== "admin") {
        throw new PermissionDeniedError("只有课程教师或管理员可以处理能力模型申诉");
      }
      const record = await dependencies.adaptation.reviewAppeal({
        sessionId: params.sessionId,
        teacherActorId: authorized.actorId,
        requestId: body.requestId,
        expectedAppealRef: body.expectedAppealRef,
        resolution: body.resolution,
        reason: body.reason,
      });
      return publicAdaptationResponse(
        dependencies.adaptation.projectView(
          record,
          authorized.audience === "admin" ? "teacher" : authorized.audience,
        ),
      );
    },
  );

  app.post<{ Params: { sessionId: string } }>(
    "/api/v4/sessions/:sessionId/second-session-authorizations",
    async (request) => {
      emptyQuerySchema.parse(request.query);
      const params = sessionParamsSchema.parse(request.params);
      const body = authorizationBodySchema.parse(request.body);
      const authorized = await dependencies.authorize({
        request,
        sessionId: params.sessionId,
        bindingId: body.bindingId,
        mutation: true,
      });
      if (authorized.audience !== "teacher" && authorized.audience !== "admin") {
        throw new PermissionDeniedError("只有课程教师或管理员可以授权创建第二场");
      }
      const record = await dependencies.adaptation.authorizeAndProvision({
        sessionId: params.sessionId,
        teacherActorId: authorized.actorId,
        teacherPrincipalId: authorized.principalId,
        requestId: body.requestId,
        expectedHandoffId: body.expectedHandoffId,
      });
      return publicAdaptationResponse(
        dependencies.adaptation.projectView(
          record,
          authorized.audience === "admin" ? "teacher" : authorized.audience,
        ),
      );
    },
  );

  app.get<{ Params: { sessionId: string } }>(
    "/api/v4/admin/sessions/:sessionId/learner-adaptation-case",
    async (request) => {
      const params = sessionParamsSchema.parse(request.params);
      const query = bindingQuerySchema.parse(request.query);
      const authorized = await dependencies.authorize({
        request,
        sessionId: params.sessionId,
        bindingId: query.bindingId,
        mutation: false,
      });
      if (authorized.audience !== "admin") {
        throw new PermissionDeniedError("只有管理员可以查看 V4 学习者自适应审计案例");
      }
      const record = await dependencies.adaptation.getOrRefresh({
        sessionId: params.sessionId,
      });
      if (!record) return adminAdaptationResponse(null);
      return adminAdaptationResponse(
        dependencies.adaptation.projectAdminCase(record),
      );
    },
  );
}
