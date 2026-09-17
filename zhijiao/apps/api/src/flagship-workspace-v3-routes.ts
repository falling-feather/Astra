import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { V2ContentHashSchema, V2IdentifierSchema, WorkSupplementSelectionV3Schema } from "@ronggang/contracts";
import {
  xunpuFlagshipContentManifestV3,
  xunpuCourseRelease,
  type ExplorationLesson,
} from "@ronggang/course-content";
import { PermissionDeniedError, type WorldSimulationEngineV3 } from "@ronggang/world-core";
import {
  FlagshipStudentWorkServiceV3,
  type FlagshipEvidenceOptionV3,
} from "./flagship-student-work-v3.js";
import type {
  AuthorizedSimulationWorldActorV3,
} from "./world-simulation-v3-routes.js";
import { resolveFieldEvidence } from "./field-evidence.js";

const sessionParamsSchema = z.object({ sessionId: V2IdentifierSchema }).strict();
const artifactParamsSchema = sessionParamsSchema.extend({
  artifactId: V2IdentifierSchema,
}).strict();
const bindingQuerySchema = z.object({ bindingId: V2IdentifierSchema }).strict();
const emptyQuerySchema = z.object({}).strict();
const challengeLevelSchema = z.union([
  z.literal(3), z.literal(4), z.literal(5), z.literal(6), z.literal(7),
]);
const saveRevisionBodySchema = z.object({
  bindingId: V2IdentifierSchema,
  requestId: V2IdentifierSchema,
  expectedRevisionNumber: z.number().int().nonnegative(),
  fields: z.array(z.object({
    fieldId: V2IdentifierSchema,
    content: z.string().max(20_000),
  }).strict()).min(1).max(24),
  evidenceRefs: z.array(V2IdentifierSchema).max(48),
  revisionNote: z.string().trim().min(1).max(600),
}).strict();
const submitRevisionBodySchema = z.object({
  bindingId: V2IdentifierSchema,
  requestId: V2IdentifierSchema,
  revisionId: V2IdentifierSchema,
  contentHash: V2ContentHashSchema,
  supplement: WorkSupplementSelectionV3Schema.optional(),
}).strict();

export interface FlagshipWorkspaceV3RouteDependencies {
  fieldLessons?: readonly ExplorationLesson[];
  planKnowledge?: (courseId: string, knowledgeIds: readonly string[]) => Promise<FlagshipEvidenceOptionV3[]>;
  engine: Pick<WorldSimulationEngineV3, "getRecord">;
  work: FlagshipStudentWorkServiceV3;
  authorize(input: {
    request: FastifyRequest;
    sessionId: string;
    bindingId: string;
    mutation: boolean;
  }): AuthorizedSimulationWorldActorV3 | Promise<AuthorizedSimulationWorldActorV3>;
}

function studentActor(actor: AuthorizedSimulationWorldActorV3) {
  if (actor.audience !== "student") {
    throw new PermissionDeniedError("只有学生记者可以编辑旗舰作品");
  }
  return actor;
}

async function evidenceCatalog(
  record: Awaited<ReturnType<FlagshipWorkspaceV3RouteDependencies["engine"]["getRecord"]>>,
  identity: Pick<AuthorizedSimulationWorldActorV3, "actorId" | "bindingId">,
  lessons?: readonly ExplorationLesson[],
  planKnowledge?: FlagshipWorkspaceV3RouteDependencies["planKnowledge"],
): Promise<FlagshipEvidenceOptionV3[]> {
  const plan=lessons?.find(lesson=>lesson.contentHash===record.fieldInterview?.lessonRef.contentHash)?.workPlan;
  if(plan&&!planKnowledge)throw new Error("课程成果计划缺少对应的资料读取入口");
  const catalog: FlagshipEvidenceOptionV3[] = plan ? await planKnowledge!(record.release.courseReleaseRef.courseId,plan.sourceKnowledgeIds) : xunpuFlagshipContentManifestV3
    .sourceKnowledgeRefs
    .filter((source) => source.reviewStatus !== "retired")
    .map((source) => {
      const knowledge = xunpuCourseRelease.knowledgeRecords.find(record => record.knowledgeId === source.knowledgeId);
      if (!knowledge) throw new Error(`作品引用的课程来源未发布：${source.knowledgeId}`);
      return {
        evidenceRef: source.knowledgeId,
        kind: "knowledge" as const,
        label: `公开来源｜${knowledge.topic}`,
        detail: source.locator,
        eventType: null,
      };
    });
  catalog.push(...resolveFieldEvidence(record, identity, lessons).map(source => source.option));
  const queuedById = new Map(record.queue.map((event) => [event.eventId, event]));
  const templateById = new Map(
    record.release.eventTemplates.map((template) => [template.eventTemplateId, template]),
  );
  for (const consequence of record.consequences) {
    const queued = queuedById.get(consequence.sourceWorldEventId);
    const template = queued ? templateById.get(queued.eventTemplateId) : null;
    catalog.push({
      evidenceRef: consequence.eventId,
      kind: "world_event",
      label: template?.title ?? "已结算的现场行动",
      detail: consequence.publicSummary,
      eventType: queued?.eventType ?? null,
    });
    for (const evidenceRef of consequence.evidenceIds) {
      catalog.push({
        evidenceRef,
        kind: "world_evidence",
        label: `世界证据｜${template?.title ?? queued?.eventType ?? "现场后果"}`,
        detail: consequence.publicSummary,
        eventType: queued?.eventType ?? null,
      });
    }
  }
  return [...new Map(catalog.map((item) => [item.evidenceRef, item])).values()];
}

export async function registerFlagshipWorkspaceV3Routes(
  app: FastifyInstance,
  dependencies: FlagshipWorkspaceV3RouteDependencies,
): Promise<void> {
  app.get<{ Params: { sessionId: string } }>(
    "/api/v3/sessions/:sessionId/workspace",
    async (request) => {
      const params = sessionParamsSchema.parse(request.params);
      const query = bindingQuerySchema.parse(request.query);
      const authorized = studentActor(await dependencies.authorize({
        request,
        sessionId: params.sessionId,
        bindingId: query.bindingId,
        mutation: false,
      }));
      const world = await dependencies.engine.getRecord(params.sessionId);
      return {
        workspace: await dependencies.work.getWorkspace({
          sessionId: params.sessionId,
          bindingId: authorized.bindingId,
          principalId: authorized.principalId,
          actorId: authorized.actorId,
          challengeLevel: challengeLevelSchema.parse(
            world.challengeAssignment.challengeLevel,
          ),
          evidenceCatalog: await evidenceCatalog(world, authorized, dependencies.fieldLessons, dependencies.planKnowledge),
        }),
      };
    },
  );

  app.post<{ Params: { sessionId: string; artifactId: string } }>(
    "/api/v3/sessions/:sessionId/workspace/artifacts/:artifactId/revisions",
    async (request) => {
      emptyQuerySchema.parse(request.query);
      const params = artifactParamsSchema.parse(request.params);
      const body = saveRevisionBodySchema.parse(request.body);
      const authorized = studentActor(await dependencies.authorize({
        request,
        sessionId: params.sessionId,
        bindingId: body.bindingId,
        mutation: true,
      }));
      const world = await dependencies.engine.getRecord(params.sessionId);
      const catalog = await evidenceCatalog(world, authorized, dependencies.fieldLessons, dependencies.planKnowledge);
      await dependencies.work.saveRevision({
        sessionId: params.sessionId,
        bindingId: authorized.bindingId,
        principalId: authorized.principalId,
        actorId: authorized.actorId,
        challengeLevel: challengeLevelSchema.parse(
          world.challengeAssignment.challengeLevel,
        ),
        artifactId: params.artifactId,
        expectedRevisionNumber: body.expectedRevisionNumber,
        requestId: body.requestId,
        fields: body.fields,
        evidenceRefs: body.evidenceRefs,
        revisionNote: body.revisionNote,
        allowedEvidenceRefs: new Set(catalog.map((item) => item.evidenceRef)),
      });
      return {
        workspace: await dependencies.work.getWorkspace({
          sessionId: params.sessionId,
          bindingId: authorized.bindingId,
          principalId: authorized.principalId,
          actorId: authorized.actorId,
          challengeLevel: challengeLevelSchema.parse(
            world.challengeAssignment.challengeLevel,
          ),
          evidenceCatalog: catalog,
        }),
      };
    },
  );

  app.post<{ Params: { sessionId: string; artifactId: string } }>(
    "/api/v3/sessions/:sessionId/workspace/artifacts/:artifactId/submit",
    { bodyLimit: 6_500_000 },
    async (request) => {
      emptyQuerySchema.parse(request.query);
      const params = artifactParamsSchema.parse(request.params);
      const body = submitRevisionBodySchema.parse(request.body);
      const authorized = studentActor(await dependencies.authorize({
        request,
        sessionId: params.sessionId,
        bindingId: body.bindingId,
        mutation: true,
      }));
      const world = await dependencies.engine.getRecord(params.sessionId);
      await dependencies.work.submitRevision({
        sessionId: params.sessionId,
        bindingId: authorized.bindingId,
        principalId: authorized.principalId,
        actorId: authorized.actorId,
        challengeLevel: challengeLevelSchema.parse(
          world.challengeAssignment.challengeLevel,
        ),
        artifactId: params.artifactId,
        revisionId: body.revisionId,
        contentHash: body.contentHash,
        requestId: body.requestId,
        ...(body.supplement ? { supplement: body.supplement } : {}),
      });
      return {
        workspace: await dependencies.work.getWorkspace({
          sessionId: params.sessionId,
          bindingId: authorized.bindingId,
          principalId: authorized.principalId,
          actorId: authorized.actorId,
          challengeLevel: challengeLevelSchema.parse(
            world.challengeAssignment.challengeLevel,
          ),
          evidenceCatalog: await evidenceCatalog(world, authorized, dependencies.fieldLessons, dependencies.planKnowledge),
        }),
      };
    },
  );
}
