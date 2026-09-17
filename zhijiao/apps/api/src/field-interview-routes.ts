import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { FieldInterviewActionRequestV1Schema, FieldInterviewActionResponseV1Schema, V2IdentifierSchema } from "@ronggang/contracts";
import { FieldInterviewRuleError, PermissionDeniedError } from "@ronggang/world-core";
import type { FlagshipExperienceV4RouteDependencies } from "./flagship-experience-v4-routes.js";
import type { FieldInterviewService } from "./field-interview-service.js";

export async function registerFieldInterviewRoutes(app: FastifyInstance, dependencies: { service: FieldInterviewService; authorize: FlagshipExperienceV4RouteDependencies["authorize"] }) {
  const paramsSchema = z.object({ sessionId: V2IdentifierSchema }).strict();
  const bindingSchema = z.object({ bindingId: V2IdentifierSchema }).strict();
  app.get("/api/v4/sessions/:sessionId/interview", async (request, reply) => {
    const { sessionId } = paramsSchema.parse(request.params);
    const { bindingId } = bindingSchema.parse(request.query);
    const identity = await dependencies.authorize({ request, sessionId, bindingId, mutation: false });
    if (identity.audience !== "student") return dependencies.service.readForTeacher(sessionId);
    try { return { view: await dependencies.service.read({ sessionId, actorId: identity.actorId, bindingId: identity.bindingId }) }; }
    catch (error) { if (!(error instanceof FieldInterviewRuleError)) throw error; return reply.code(error.code === "ownership" ? 403 : 409).send({ error: error.message }); }
  });
  app.post("/api/v4/sessions/:sessionId/interview/actions", async (request, reply) => {
    z.object({}).strict().parse(request.query);
    const { sessionId } = paramsSchema.parse(request.params);
    const body = FieldInterviewActionRequestV1Schema.parse(request.body);
    if (body.sessionId !== sessionId) throw new PermissionDeniedError("采访请求与当前场次不一致");
    const identity = await dependencies.authorize({ request, sessionId, bindingId: body.bindingId, mutation: true });
    if (identity.audience !== "student") throw new PermissionDeniedError("只有当前学生可以提交自己的采访行动");
    try { return FieldInterviewActionResponseV1Schema.parse(await dependencies.service.perform({ request: body, actorId: identity.actorId, principalId: identity.principalId })); }
    catch (error) { if (!(error instanceof FieldInterviewRuleError)) throw error; return reply.code(error.code === "ownership" ? 403 : error.code === "invalid" ? 400 : 409).send({ error: error.message }); }
  });
}
