import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { V2IdentifierSchema } from "@ronggang/contracts";
import { PermissionDeniedError } from "@ronggang/world-core";
import {
  type LearnerAdaptationServiceV3,
} from "./learner-adaptation-v3.js";
import type {
  AuthorizedSimulationWorldActorV3,
} from "./world-simulation-v3-routes.js";

const sessionParamsSchema = z.object({
  sessionId: V2IdentifierSchema,
}).strict();
const bindingQuerySchema = z.object({
  bindingId: V2IdentifierSchema,
}).strict();
const emptyQuerySchema = z.object({}).strict();
const appealBodySchema = z.object({
  bindingId: V2IdentifierSchema,
  requestId: V2IdentifierSchema,
  reason: z.string().trim().min(8).max(1_000),
}).strict();
const teacherDecisionBodySchema = z.object({
  bindingId: V2IdentifierSchema,
  requestId: V2IdentifierSchema,
  expectedProfileRevision: z.number().int().positive(),
  action: z.enum([
    "confirm_plan",
    "override_challenge",
    "begin_appeal_review",
    "resolve_appeal",
  ]),
  reason: z.string().trim().min(8).max(1_000),
  challengeLevel: z.union([
    z.literal(3), z.literal(4), z.literal(5), z.literal(6), z.literal(7),
  ]).optional(),
}).strict().superRefine((body, context) => {
  if ((body.action === "override_challenge")
    !== (body.challengeLevel !== undefined)) {
    context.addIssue({
      code: "custom",
      path: ["challengeLevel"],
      message: "只有挑战覆写必须且仅可携带挑战等级",
    });
  }
});

export interface LearnerAdaptationV3RouteDependencies {
  adaptation: Pick<
    LearnerAdaptationServiceV3,
    | "getOrRefresh"
    | "requestAppeal"
    | "reviewAdaptation"
    | "projectGrowth"
    | "projectAdminCase"
  >;
  authorize(input: {
    request: FastifyRequest;
    sessionId: string;
    bindingId: string;
    mutation: boolean;
  }): AuthorizedSimulationWorldActorV3 | Promise<AuthorizedSimulationWorldActorV3>;
}

function assertStudentOwnsAssessment(
  authorized: AuthorizedSimulationWorldActorV3,
  learnerActorId: string,
): void {
  if (authorized.audience === "student"
    && authorized.actorId !== learnerActorId) {
    throw new PermissionDeniedError("学生只能查看和申诉自己的成长模型");
  }
}

export async function registerLearnerAdaptationV3Routes(
  app: FastifyInstance,
  dependencies: LearnerAdaptationV3RouteDependencies,
): Promise<void> {
  app.get<{ Params: { sessionId: string } }>(
    "/api/v3/sessions/:sessionId/learner-growth",
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
        throw new PermissionDeniedError(
          "管理员请从审计案例端点读取学习者数字分身",
        );
      }
      const snapshot = await dependencies.adaptation.getOrRefresh({
        sessionId: params.sessionId,
        ...(authorized.audience === "student" ? {
          fallbackLearner: {
            bindingId: authorized.bindingId,
            actorId: authorized.actorId,
          },
        } : {}),
      });
      assertStudentOwnsAssessment(
        authorized,
        snapshot.assessment.learnerActorId,
      );
      return {
        growth: dependencies.adaptation.projectGrowth(
          snapshot,
          authorized.audience,
        ),
      };
    },
  );

  app.post<{ Params: { sessionId: string } }>(
    "/api/v3/sessions/:sessionId/learner-growth/appeals",
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
        throw new PermissionDeniedError("只有学生本人可以发起画像申诉");
      }
      const snapshot = await dependencies.adaptation.requestAppeal({
        sessionId: params.sessionId,
        learnerBindingId: authorized.bindingId,
        learnerActorId: authorized.actorId,
        requestId: body.requestId,
        reason: body.reason,
      });
      return {
        growth: dependencies.adaptation.projectGrowth(snapshot, "student"),
      };
    },
  );

  app.post<{ Params: { sessionId: string } }>(
    "/api/v3/sessions/:sessionId/learner-adaptation-decisions",
    async (request) => {
      emptyQuerySchema.parse(request.query);
      const params = sessionParamsSchema.parse(request.params);
      const body = teacherDecisionBodySchema.parse(request.body);
      const authorized = await dependencies.authorize({
        request,
        sessionId: params.sessionId,
        bindingId: body.bindingId,
        mutation: true,
      });
      if (authorized.audience !== "teacher"
        && authorized.audience !== "admin") {
        throw new PermissionDeniedError(
          "只有课程教师或管理员可以确认成长方案、覆写压力或处理申诉",
        );
      }
      const snapshot = await dependencies.adaptation.reviewAdaptation({
        sessionId: params.sessionId,
        requestId: body.requestId,
        teacherActorId: authorized.actorId,
        expectedProfileRevision: body.expectedProfileRevision,
        action: body.action,
        reason: body.reason,
        ...(body.challengeLevel === undefined
          ? {}
          : { challengeLevel: body.challengeLevel }),
      });
      return {
        growth: dependencies.adaptation.projectGrowth(
          snapshot,
          authorized.audience === "admin" ? "teacher" : authorized.audience,
        ),
      };
    },
  );

  app.get<{ Params: { sessionId: string } }>(
    "/api/v3/admin/sessions/:sessionId/learner-adaptation-case",
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
        throw new PermissionDeniedError(
          "只有管理员可以查看学习者数字分身审计案例",
        );
      }
      const snapshot = await dependencies.adaptation.getOrRefresh({
        sessionId: params.sessionId,
      });
      return {
        adaptationCase: dependencies.adaptation.projectAdminCase(snapshot),
      };
    },
  );
}
