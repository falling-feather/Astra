import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { V2IdentifierSchema } from "@ronggang/contracts";
import { PermissionDeniedError } from "@ronggang/world-core";
import {
  type FlagshipCompetencyAssessmentServiceV3,
} from "./flagship-assessment-v3.js";
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
const teacherReviewBodySchema = z.object({
  bindingId: V2IdentifierSchema,
  expectedAssessmentDecisionId: V2IdentifierSchema,
  requestId: V2IdentifierSchema,
  status: z.enum(["confirmed", "revised"]),
  reason: z.string().trim().min(8).max(1_000),
  competencyRevisions: z.array(z.object({
    competencyClaimId: V2IdentifierSchema,
    score: z.number().min(0).max(100),
    competencyLevel: z.number().int().min(1).max(5),
    rationale: z.string().trim().min(8).max(1_000),
  }).strict()).max(32),
}).strict();

export interface FlagshipAssessmentV3RouteDependencies {
  assessment: Pick<
    FlagshipCompetencyAssessmentServiceV3,
    "getAssessment" | "reviewAssessment" | "projectEvidence" | "projectAdminCase"
  >;
  authorize(input: {
    request: FastifyRequest;
    sessionId: string;
    bindingId: string;
    mutation: boolean;
  }): AuthorizedSimulationWorldActorV3 | Promise<AuthorizedSimulationWorldActorV3>;
}

function assertLearnerAccess(
  authorized: AuthorizedSimulationWorldActorV3,
  record: Awaited<ReturnType<
    FlagshipAssessmentV3RouteDependencies["assessment"]["getAssessment"]
  >>,
): void {
  if (authorized.audience === "student"
    && authorized.actorId !== record.learnerActorId) {
    throw new PermissionDeniedError("学生只能查看自己的岗位能力证据");
  }
}

export async function registerFlagshipAssessmentV3Routes(
  app: FastifyInstance,
  dependencies: FlagshipAssessmentV3RouteDependencies,
): Promise<void> {
  app.get<{ Params: { sessionId: string } }>(
    "/api/v3/sessions/:sessionId/competency-evidence",
    async (request) => {
      const params = sessionParamsSchema.parse(request.params);
      const query = bindingQuerySchema.parse(request.query);
      const authorized = await dependencies.authorize({
        request,
        sessionId: params.sessionId,
        bindingId: query.bindingId,
        mutation: false,
      });
      const record = await dependencies.assessment.getAssessment({
        sessionId: params.sessionId,
        ...(authorized.audience === "student" ? {
          fallbackLearner: {
            bindingId: authorized.bindingId,
            actorId: authorized.actorId,
          },
        } : {}),
      });
      assertLearnerAccess(authorized, record);
      return {
        evidence: dependencies.assessment.projectEvidence(
          record,
          authorized.audience,
        ),
      };
    },
  );

  app.post<{ Params: { sessionId: string } }>(
    "/api/v3/sessions/:sessionId/assessment-decisions",
    async (request) => {
      emptyQuerySchema.parse(request.query);
      const params = sessionParamsSchema.parse(request.params);
      const body = teacherReviewBodySchema.parse(request.body);
      const authorized = await dependencies.authorize({
        request,
        sessionId: params.sessionId,
        bindingId: body.bindingId,
        mutation: true,
      });
      if (authorized.audience !== "teacher"
        && authorized.audience !== "admin") {
        throw new PermissionDeniedError("只有课程教师或管理员可以复核岗位能力评价");
      }
      await dependencies.assessment.getAssessment({
        sessionId: params.sessionId,
      });
      const reviewed = await dependencies.assessment.reviewAssessment({
        sessionId: params.sessionId,
        expectedAssessmentDecisionId: body.expectedAssessmentDecisionId,
        requestId: body.requestId,
        reviewerId: authorized.actorId,
        status: body.status,
        reason: body.reason,
        competencyRevisions: body.competencyRevisions,
      });
      return {
        evidence: dependencies.assessment.projectEvidence(
          reviewed,
          authorized.audience,
        ),
      };
    },
  );

  app.get<{ Params: { sessionId: string } }>(
    "/api/v3/admin/sessions/:sessionId/assessment-case",
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
        throw new PermissionDeniedError("只有管理员可以查看可重算评价案例");
      }
      const record = await dependencies.assessment.getAssessment({
        sessionId: params.sessionId,
      });
      return { assessmentCase: dependencies.assessment.projectAdminCase(record) };
    },
  );
}
