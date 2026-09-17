import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import { z } from "zod";
import {
  CollaborationStrategyDraftInputSchema,
  CollaborationStrategyGovernanceInputSchema,
  CollaborationStrategyQuerySchema,
} from "@ronggang/contracts";
import {
  CollaborationStrategyError,
  type CollaborationStrategyActor,
  type CollaborationStrategyService,
} from "./collaboration-strategy-store.js";

const AuthorizationFieldsSchema = z.object({
  bindingId: z.string().min(1).max(240),
  authorizationSessionId: z.string().min(1).max(240),
}).strict();

const ListQuerySchema = CollaborationStrategyQuerySchema.extend({
  bindingId: z.string().min(1).max(240),
  authorizationSessionId: z.string().min(1).max(240),
}).strict();

const StrategyParamsSchema = z.object({
  strategyId: CollaborationStrategyDraftInputSchema.shape.strategyId,
  version: z.coerce.number().pipe(
    CollaborationStrategyDraftInputSchema.shape.version,
  ),
}).strict();

const CreateStrategyBodySchema = AuthorizationFieldsSchema.extend({
  strategy: CollaborationStrategyDraftInputSchema,
}).strict();

const GovernanceBodySchema = AuthorizationFieldsSchema.extend({
  transition: CollaborationStrategyGovernanceInputSchema,
}).strict();

export interface CollaborationStrategyRouteAuthorizationInput {
  request: FastifyRequest;
  bindingId: string;
  authorizationSessionId: string;
  mutation: boolean;
}

export interface CollaborationStrategyRouteOptions {
  service: CollaborationStrategyService;
  authorizeTeacher: (
    input: CollaborationStrategyRouteAuthorizationInput,
  ) => Promise<CollaborationStrategyActor> | CollaborationStrategyActor;
}

async function authorizeTeacher(
  options: CollaborationStrategyRouteOptions,
  input: CollaborationStrategyRouteAuthorizationInput,
): Promise<CollaborationStrategyActor> {
  const actor = await options.authorizeTeacher(input);
  if (actor.actorKind !== "teacher") {
    throw new CollaborationStrategyError(
      "permission_denied",
      "只有教师岗位绑定可以访问协作策略治理 API",
      { actorId: actor.actorId, actorKind: actor.actorKind },
    );
  }
  return actor;
}

function statusFor(error: CollaborationStrategyError): number {
  switch (error.code) {
    case "permission_denied":
      return 403;
    case "strategy_not_found":
    case "version_not_found":
      return 404;
    case "corrupted_log":
      return 503;
    default:
      return 409;
  }
}

async function respond(
  reply: FastifyReply,
  operation: () => Promise<unknown>,
  successStatus = 200,
): Promise<FastifyReply> {
  try {
    return reply.status(successStatus).send(await operation());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return reply.status(400).send({
        error: "InvalidCollaborationStrategyRequest",
        code: "invalid_request",
        message: "协作策略请求格式无效",
        issues: error.issues,
      });
    }
    if (error instanceof CollaborationStrategyError) {
      return reply.status(statusFor(error)).send({
        error: error.name,
        code: error.code,
        message: error.message,
        details: error.details,
      });
    }
    throw error;
  }
}

/**
 * Registers the isolated ARCH-006 API surface.
 *
 * The server wiring adapter resolves the existing binding, asserts Origin and
 * CSRF for mutations, and returns only the server-bound actor identity;
 * client-supplied actor claims are intentionally absent here.
 */
export async function registerCollaborationStrategyRoutes(
  app: FastifyInstance,
  options: CollaborationStrategyRouteOptions,
): Promise<void> {
  app.get("/api/collaboration-strategies", async (request, reply) => respond(
    reply,
    async () => {
      const query = ListQuerySchema.parse(request.query);
      await authorizeTeacher(options, {
        request,
        bindingId: query.bindingId,
        authorizationSessionId: query.authorizationSessionId,
        mutation: false,
      });
      const strategyQuery = CollaborationStrategyQuerySchema.parse({
        ...(query.status ? { status: query.status } : {}),
        ...(query.triggerEventId
          ? { triggerEventId: query.triggerEventId }
          : {}),
      });
      return { strategies: await options.service.list(strategyQuery) };
    },
  ));

  app.get(
    "/api/collaboration-strategies/:strategyId/versions/:version",
    async (request, reply) => respond(reply, async () => {
      const query = AuthorizationFieldsSchema.parse(request.query);
      const params = StrategyParamsSchema.parse(request.params);
      await authorizeTeacher(options, {
        request,
        bindingId: query.bindingId,
        authorizationSessionId: query.authorizationSessionId,
        mutation: false,
      });
      const strategy = await options.service.get(
        params.strategyId,
        params.version,
      );
      if (!strategy) {
        throw new CollaborationStrategyError(
          "version_not_found",
          "协作策略版本不存在",
          params,
        );
      }
      return { strategy };
    }),
  );

  app.post("/api/collaboration-strategies", async (request, reply) => respond(
    reply,
    async () => {
      const body = CreateStrategyBodySchema.parse(request.body);
      const actor = await authorizeTeacher(options, {
        request,
        bindingId: body.bindingId,
        authorizationSessionId: body.authorizationSessionId,
        mutation: true,
      });
      return {
        strategy: await options.service.createDraft(body.strategy, actor),
      };
    },
    201,
  ));

  app.post(
    "/api/collaboration-strategies/:strategyId/versions/:version/governance",
    async (request, reply) => respond(reply, async () => {
      const params = StrategyParamsSchema.parse(request.params);
      const body = GovernanceBodySchema.parse(request.body);
      const actor = await authorizeTeacher(options, {
        request,
        bindingId: body.bindingId,
        authorizationSessionId: body.authorizationSessionId,
        mutation: true,
      });
      return {
        strategy: await options.service.transitionGovernance(
          params.strategyId,
          params.version,
          body.transition,
          actor,
        ),
      };
    }),
  );
}
