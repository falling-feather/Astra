import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  AssessmentCriterionIdV4Schema,
  FlagshipEvidenceAssessmentAdminCaseResponseV4Schema,
  FlagshipEvidenceAssessmentResponseV4Schema,
  V2IdentifierSchema,
} from "@ronggang/contracts";
import { PermissionDeniedError } from "@ronggang/world-core";
import {
  FlagshipAssessmentErrorV4,
  type FlagshipAssessmentRecordV4,
  type FlagshipEvidenceAssessmentServiceV4,
} from "./flagship-assessment-v4.js";
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

const teacherReviewBodySchema = z.object({
  bindingId: V2IdentifierSchema,
  expectedAssessmentDecisionId: V2IdentifierSchema,
  requestId: V2IdentifierSchema,
  status: z.enum(["confirmed", "revised"]),
  rubricApplicabilityConfirmed: z.literal(true),
  reason: z.string().trim().min(8).max(1_000),
  criterionRevisions: z.array(z.object({
    criterionId: AssessmentCriterionIdV4Schema,
    band: z.enum(["low", "medium", "high"]),
    score: z.number().min(0).max(100),
    rationale: z.string().trim().min(8).max(1_000),
  }).strict()).max(6),
}).strict();

export interface FlagshipAssessmentV4RouteDependencies {
  assessment: Pick<
    FlagshipEvidenceAssessmentServiceV4,
    "getAssessment" | "reviewAssessment" | "projectView" | "projectAdminCase" | "getLearningObservations"
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
  record: FlagshipAssessmentRecordV4 | null,
): void {
  if (authorized.audience !== "student" || record === null) return;
  if (authorized.actorId !== record.learnerActorId
    || authorized.bindingId !== record.learnerBindingId) {
    throw new PermissionDeniedError("学生只能查看自己的抗取巧证据评价");
  }
}

export async function registerFlagshipAssessmentV4Routes(
  app: FastifyInstance,
  dependencies: FlagshipAssessmentV4RouteDependencies,
): Promise<void> {
  app.post<{Params:{sessionId:string}}>('/api/v4/sessions/:sessionId/evidence-assessment/retry',async request=>{
    emptyQuerySchema.parse(request.query);const {sessionId}=sessionParamsSchema.parse(request.params);
    const body=z.object({bindingId:V2IdentifierSchema,requestId:V2IdentifierSchema}).strict().parse(request.body);
    const authorized=await dependencies.authorize({request,sessionId,bindingId:body.bindingId,mutation:true});
    const record=await dependencies.assessment.getAssessment({sessionId,retryRequestId:body.requestId,
      ...(authorized.audience==='student'?{fallbackLearner:{bindingId:authorized.bindingId,actorId:authorized.actorId}}:{})});
    assertLearnerAccess(authorized,record);
    return parsePublicProjection(FlagshipEvidenceAssessmentResponseV4Schema,{assessment:dependencies.assessment.projectView(record,authorized.audience)},'FlagshipEvidenceAssessmentResponseV4');
  });
  app.get<{ Params: { sessionId: string } }>(
    "/api/v4/sessions/:sessionId/evidence-assessment",
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
      return parsePublicProjection(
        FlagshipEvidenceAssessmentResponseV4Schema,
        {
          assessment: dependencies.assessment.projectView(record, authorized.audience, record ? record.learningObservations ?? [] : await dependencies.assessment.getLearningObservations({
            sessionId: params.sessionId,
            ...(authorized.audience === "student" ? { fallbackLearner: { actorId: authorized.actorId, bindingId: authorized.bindingId } } : {}),
          })),
        },
        "FlagshipEvidenceAssessmentResponseV4",
      );
    },
  );

  app.post<{ Params: { sessionId: string } }>(
    "/api/v4/sessions/:sessionId/evidence-assessment-reviews",
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
      if (authorized.audience !== "teacher" && authorized.audience !== "admin") {
        throw new PermissionDeniedError("只有课程教师或管理员可以终裁 V4 证据评价");
      }
      const current = await dependencies.assessment.getAssessment({
        sessionId: params.sessionId,
      });
      if (!current) {
        throw new FlagshipAssessmentErrorV4(
          "not_ready",
          "当前尚未形成可由教师终裁的六维证据评价",
        );
      }
      const reviewed = await dependencies.assessment.reviewAssessment({
        sessionId: params.sessionId,
        expectedAssessmentDecisionId: body.expectedAssessmentDecisionId,
        requestId: body.requestId,
        reviewerId: authorized.actorId,
        status: body.status,
        rubricApplicabilityConfirmed: true,
        reason: body.reason,
        criterionRevisions: body.criterionRevisions,
      });
      return parsePublicProjection(
        FlagshipEvidenceAssessmentResponseV4Schema,
        {
          assessment: dependencies.assessment.projectView(
            reviewed,
            authorized.audience,
          ),
        },
        "FlagshipEvidenceAssessmentResponseV4",
      );
    },
  );

  app.get<{ Params: { sessionId: string } }>(
    "/api/v4/admin/sessions/:sessionId/evidence-assessment-case",
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
        throw new PermissionDeniedError("只有管理员可以查看盲化评价审计案例");
      }
      const record = await dependencies.assessment.getAssessment({
        sessionId: params.sessionId,
      });
      if (!record) {
        throw new FlagshipAssessmentErrorV4(
          "not_ready",
          "当前尚未形成可审计的 V4 盲化评价案例",
        );
      }
      return parsePublicProjection(
        FlagshipEvidenceAssessmentAdminCaseResponseV4Schema,
        {
          assessmentCase: dependencies.assessment.projectAdminCase(record),
        },
        "FlagshipEvidenceAssessmentAdminCaseResponseV4",
      );
    },
  );
}
