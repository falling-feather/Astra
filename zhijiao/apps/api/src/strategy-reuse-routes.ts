import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import { z } from "zod";
import {
  CollaborationReplaySchema,
  CollaborationStrategyReferenceSchema,
  type CollaborationReplay,
  type CollaborationStrategyReference,
} from "@ronggang/contracts";
import {
  type StrategyReuseService,
} from "./strategy-reuse.js";

const SessionParamsSchema = z.object({
  sessionId: z.string().min(1).max(240),
}).strict();

const BindingQuerySchema = z.object({
  bindingId: z.string().min(1).max(240),
}).strict();

export interface StrategyReuseAuthorizedContext {
  replay: CollaborationReplay;
  expectedStrategyRef: CollaborationStrategyReference;
}

export interface StrategyReuseRouteAuthorizationInput {
  request: FastifyRequest;
  sessionId: string;
  bindingId: string;
}

export interface StrategyReuseRouteOptions {
  service: StrategyReuseService;
  loadAuthorizedContext: (
    input: StrategyReuseRouteAuthorizationInput,
  ) => Promise<StrategyReuseAuthorizedContext>;
}

async function respond(
  reply: FastifyReply,
  operation: () => ReturnType<StrategyReuseService["explain"]>,
): Promise<FastifyReply> {
  try {
    const explanation = await operation();
    return reply
      .status(explanation.status === "error" ? 409 : 200)
      .send(explanation);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return reply.status(400).send({
        error: "InvalidStrategyReuseRequest",
        code: "invalid_request",
        message: "策略复用解释请求格式无效",
        issues: error.issues,
      });
    }
    throw error;
  }
}

/**
 * Registers the isolated, student-safe AI-008 read endpoint.
 *
 * `server.ts` owns Cookie/binding/session authorization and must construct the
 * replay plus frozen strategy reference server-side. Neither value is accepted
 * from the browser.
 */
export async function registerStrategyReuseRoutes(
  app: FastifyInstance,
  options: StrategyReuseRouteOptions,
): Promise<void> {
  app.get(
    "/api/sessions/:sessionId/strategy-reuse-explanation",
    async (request, reply) => respond(reply, async () => {
      const params = SessionParamsSchema.parse(request.params);
      const query = BindingQuerySchema.parse(request.query);
      const context = await options.loadAuthorizedContext({
        request,
        sessionId: params.sessionId,
        bindingId: query.bindingId,
      });
      const explanation = await options.service.explain({
        replay: CollaborationReplaySchema.parse(context.replay),
        expectedStrategyRef: CollaborationStrategyReferenceSchema.parse(
          context.expectedStrategyRef,
        ),
      });
      return explanation;
    }),
  );
}
