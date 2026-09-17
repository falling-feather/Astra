import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { TeachingTaskInputV1Schema, TeachingTaskPlanV1Schema, TeachingTaskWorkspaceV1Schema, V2ContentHashSchema, V2IdentifierSchema } from "@ronggang/contracts";
import { mediaTeachingTaskTemplates } from "@ronggang/course-content";
import type { TeachingTaskService, TeachingTaskActor } from "./teaching-task-service.js";
import type { TeachingTaskRuntime } from "./teaching-task-runtime.js";

const id = V2IdentifierSchema;
const author = z.object({ bindingId: id, authorizationSessionId: id }).strict();
const taskParams = z.object({ taskId: id }).strict();
const noFields = z.object({}).strict();
const generation = author.extend({ requestId: id, input: TeachingTaskInputV1Schema }).strict();
const revision = author.extend({ requestId: id, expectedRevision: z.number().int().positive(),
  changes: TeachingTaskPlanV1Schema.pick({ title: true, assignment: true, audience: true, objectives: true, durationMinutes: true, scaffoldingLevel: true, challengeLevel: true })
    .extend({ steps: z.array(z.object({ taskRef: id, instruction: z.string().trim().min(1).max(2000) }).strict()).min(1).max(12) }).strict() }).strict();
const publication = author.extend({ requestId: id, expectedRevision: z.number().int().positive(), contentHash: V2ContentHashSchema,
  confirmation: z.string().trim().min(8).max(1000) }).strict();

export async function registerTeachingTaskRoutes(app: FastifyInstance, dependencies: {
  tasks: TeachingTaskService; runtime: TeachingTaskRuntime;
  start?: (actor: TeachingTaskActor & { profileId: string; teamId: string | null }, releaseId: string) => ReturnType<TeachingTaskRuntime["start"]>;
  authorize(request: FastifyRequest, mutation: boolean, context?: z.infer<typeof author>): Promise<TeachingTaskActor & { profileId: string; teamId: string | null }>;
}): Promise<void> {
  app.get("/api/teaching-tasks", async request => {
    noFields.parse(request.query);
    const actor = await dependencies.authorize(request, false);
    const [workspace, sessions] = await Promise.all([dependencies.tasks.workspace(actor), dependencies.runtime.sessions(actor)]);
    return TeachingTaskWorkspaceV1Schema.parse({ ...workspace, sessions,
      templates: mediaTeachingTaskTemplates.map(item => ({ templateId: item.templateId, title: item.title, purpose: item.purpose })) });
  });
  app.post("/api/teaching-tasks/generate", async request => {
    noFields.parse(request.query);
    const body = generation.parse(request.body);
    const actor = await dependencies.authorize(request, true, { bindingId: body.bindingId, authorizationSessionId: body.authorizationSessionId });
    return dependencies.tasks.generate(actor, body.requestId, body.input);
  });
  app.post("/api/teaching-tasks/:taskId/revisions", async request => {
    noFields.parse(request.query);
    const params = taskParams.parse(request.params), body = revision.parse(request.body);
    const actor = await dependencies.authorize(request, true, { bindingId: body.bindingId, authorizationSessionId: body.authorizationSessionId });
    return { draft: await dependencies.tasks.revise(actor, { taskId: params.taskId, requestId: body.requestId, expectedRevision: body.expectedRevision, changes: body.changes }) };
  });
  app.post("/api/teaching-tasks/:taskId/publish", async request => {
    noFields.parse(request.query);
    const params = taskParams.parse(request.params), body = publication.parse(request.body);
    const actor = await dependencies.authorize(request, true, { bindingId: body.bindingId, authorizationSessionId: body.authorizationSessionId });
    return { release: await dependencies.tasks.publish(actor, { taskId: params.taskId, requestId: body.requestId, expectedRevision: body.expectedRevision, contentHash: body.contentHash, confirmation: body.confirmation }) };
  });
  app.put("/api/teaching-tasks/releases/:releaseId/my-session", async request => {
    noFields.parse(request.query); noFields.parse(request.body);
    const params = z.object({ releaseId: id }).strict().parse(request.params);
    const actor = await dependencies.authorize(request, true);
    return { session: await (dependencies.start ? dependencies.start(actor, params.releaseId) : dependencies.runtime.start(actor, params.releaseId)) };
  });
}
