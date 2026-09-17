import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { StudentNotebookMutationV1Schema, StudentNotebookV1Schema, V2IdentifierSchema } from "@ronggang/contracts";
import { PermissionDeniedError, type WorldSimulationEngineV3 } from "@ronggang/world-core";
import type { FlagshipExperienceV4RouteDependencies } from "./flagship-experience-v4-routes.js";
import { NotebookConflictError, type StudentNotebookStore } from "./student-notebook.js";

export async function registerStudentNotebookRoutes(app: FastifyInstance, dependencies: {
  notebooks: StudentNotebookStore;
  engine: Pick<WorldSimulationEngineV3, "getRecord">;
  authorize: (input: Parameters<FlagshipExperienceV4RouteDependencies["authorize"]>[0] & { purpose?: "private-note" }) => ReturnType<FlagshipExperienceV4RouteDependencies["authorize"]>;
}) {
  const paramsSchema = z.object({ sessionId: V2IdentifierSchema }).strict();
  const querySchema = z.object({ bindingId: V2IdentifierSchema }).strict();
  app.get("/api/v3/sessions/:sessionId/notebook", async request => {
    const { sessionId } = paramsSchema.parse(request.params), { bindingId } = querySchema.parse(request.query);
    const identity = await dependencies.authorize({ request, sessionId, bindingId, mutation: false });
    if (identity.audience !== "student") throw new PermissionDeniedError("私人笔记仅学生本人可查看；已提交副本请从作品中查看");
    const world = await dependencies.engine.getRecord(sessionId);
    return StudentNotebookV1Schema.parse(await dependencies.notebooks.read(identity.principalId, world.release.courseReleaseRef.courseId));
  });
  app.post("/api/v3/sessions/:sessionId/notebook", async (request, reply) => {
    z.object({}).strict().parse(request.query);
    const { sessionId } = paramsSchema.parse(request.params), body = StudentNotebookMutationV1Schema.parse(request.body);
    const identity = await dependencies.authorize({ request, sessionId, bindingId: body.bindingId, mutation: true, purpose: "private-note" });
    if (identity.audience !== "student") throw new PermissionDeniedError("只有学生本人可以编辑私人笔记");
    const world = await dependencies.engine.getRecord(sessionId);
    try { return StudentNotebookV1Schema.parse(await dependencies.notebooks.mutate(identity.principalId, world.release.courseReleaseRef.courseId, body)); }
    catch (error) { if (!(error instanceof NotebookConflictError)) throw error; return reply.code(409).send({ error: error.message }); }
  });
}
