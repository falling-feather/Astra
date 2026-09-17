import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  BusinessOperationReceiptListResponseSchema,
  V2IdentifierSchema,
} from "@ronggang/contracts";
import { PermissionDeniedError } from "@ronggang/world-core";
import type { BusinessOperationCoordinator } from "./business-operation-receipt.js";
import type {
  AuthorizedSimulationWorldActorV3,
} from "./world-simulation-v3-routes.js";

const paramsSchema = z.object({
  sessionId: V2IdentifierSchema,
}).strict();
const querySchema = z.object({
  bindingId: V2IdentifierSchema,
}).strict();

export interface BusinessOperationRouteDependencies {
  operations: Pick<BusinessOperationCoordinator, "list">;
  authorize(input: {
    request: FastifyRequest;
    sessionId: string;
    bindingId: string;
    mutation: false;
  }): AuthorizedSimulationWorldActorV3 | Promise<AuthorizedSimulationWorldActorV3>;
}

export async function registerBusinessOperationRoutes(
  app: FastifyInstance,
  dependencies: BusinessOperationRouteDependencies,
): Promise<void> {
  app.get<{ Params: { sessionId: string } }>(
    "/api/v4/admin/sessions/:sessionId/business-operations",
    async (request) => {
      const params = paramsSchema.parse(request.params);
      const query = querySchema.parse(request.query);
      const authorized = await dependencies.authorize({
        request,
        sessionId: params.sessionId,
        bindingId: query.bindingId,
        mutation: false,
      });
      if (authorized.audience !== "admin") {
        throw new PermissionDeniedError("只有管理员可以查看跨 Store 业务恢复收据");
      }
      const operations = (await dependencies.operations.list()).filter(
        (receipt) => (
          receipt.scope.sourceSessionId === params.sessionId
          || receipt.scope.targetSessionId === params.sessionId
        ),
      );
      return BusinessOperationReceiptListResponseSchema.parse({ operations });
    },
  );
}
