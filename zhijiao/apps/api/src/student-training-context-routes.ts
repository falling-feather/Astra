import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  StudentTrainingContextSchema,
  V2IdentifierSchema,
  type StudentTrainingContext,
} from "@ronggang/contracts";

const sessionParamsSchema = z.object({
  sessionId: V2IdentifierSchema,
}).strict();

const bindingQuerySchema = z.object({
  bindingId: V2IdentifierSchema,
}).strict();

export interface StudentTrainingContextRouteDependencies {
  loadAuthorizedContext(input: {
    request: FastifyRequest;
    sessionId: string;
    bindingId: string;
  }): StudentTrainingContext | Promise<StudentTrainingContext>;
}

export async function registerStudentTrainingContextRoutes(
  app: FastifyInstance,
  dependencies: StudentTrainingContextRouteDependencies,
): Promise<void> {
  app.get<{ Params: { sessionId: string } }>(
    "/api/sessions/:sessionId/student-training-context",
    async (request) => {
      const params = sessionParamsSchema.parse(request.params);
      const query = bindingQuerySchema.parse(request.query);
      return StudentTrainingContextSchema.parse(
        await dependencies.loadAuthorizedContext({
          request,
          sessionId: params.sessionId,
          bindingId: query.bindingId,
        }),
      );
    },
  );
}
