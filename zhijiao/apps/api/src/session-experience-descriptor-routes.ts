import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  SessionExperienceDescriptorResponseSchema,
  V2IdentifierSchema,
} from "@ronggang/contracts";
import type { SessionExperienceDescriptorService } from "./session-experience-descriptor.js";

const paramsSchema = z.object({ sessionId: V2IdentifierSchema }).strict();
const querySchema = z.object({ bindingId: V2IdentifierSchema }).strict();

export async function registerSessionExperienceDescriptorRoutes(
  app: FastifyInstance,
  dependencies: {
    descriptors: Pick<SessionExperienceDescriptorService, "get">;
    authorize(input: {
      request: FastifyRequest;
      sessionId: string;
      bindingId: string;
    }): void | Promise<void>;
  },
): Promise<void> {
  app.get<{ Params: { sessionId: string } }>(
    "/api/sessions/:sessionId/experience-descriptor",
    async (request) => {
      const params = paramsSchema.parse(request.params);
      const query = querySchema.parse(request.query);
      await dependencies.authorize({
        request,
        sessionId: params.sessionId,
        bindingId: query.bindingId,
      });
      return SessionExperienceDescriptorResponseSchema.parse({
        descriptor: await dependencies.descriptors.get(params.sessionId),
      });
    },
  );
}
