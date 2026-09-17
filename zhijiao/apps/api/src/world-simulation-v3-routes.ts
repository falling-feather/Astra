import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  StudentWorkActionSchema,
  StudentWorkActionSchemaVersion,
  V2IdentifierSchema,
  type WorldSnapshot,
} from "@ronggang/contracts";
import type {
  SimulationAgentOrchestratorV3,
  SimulationEpisodeViewsV3,
} from "@ronggang/agent-orchestrator";
import {
  PermissionDeniedError,
  evaluateFlagshipRuntimeActionPolicyV4,
  type WorldSimulationEngineV3,
} from "@ronggang/world-core";
import type { FlagshipStudentWorkServiceV3 } from "./flagship-student-work-v3.js";

const sessionParamsSchema = z.object({
  sessionId: V2IdentifierSchema,
}).strict();
const episodeParamsSchema = sessionParamsSchema.extend({
  episodeId: V2IdentifierSchema,
}).strict();
const bindingQuerySchema = z.object({
  bindingId: V2IdentifierSchema,
}).strict();
const emptyQuerySchema = z.object({}).strict();
const challengeLevelSchema = z.union([
  z.literal(3), z.literal(4), z.literal(5), z.literal(6), z.literal(7),
]);
const studentActionBodySchema = z.object({
  bindingId: V2IdentifierSchema,
  requestId: V2IdentifierSchema,
  eventTemplateId: V2IdentifierSchema,
  serverIssuedActionRef: V2IdentifierSchema,
  expectedWorldStateVersion: z.number().int().nonnegative(),
  action: StudentWorkActionSchema.shape.action,
  sourceWorldEventIds: z.array(V2IdentifierSchema).max(24),
  reflectionNote: z.string().trim().min(1).max(1_000),
}).strict();
const studentDecisionBodySchema = z.object({
  bindingId: V2IdentifierSchema,
  decisionRef: V2IdentifierSchema,
  decision: z.enum(["accept", "request_evidence", "reject"]),
  rationale: z.string().trim().min(1).max(1_000),
}).strict();
const teacherGateBodySchema = z.object({
  bindingId: V2IdentifierSchema,
  decision: z.enum(["approved", "revised", "rejected"]),
  teacherDecisionRef: V2IdentifierSchema,
  revisionPolicy: z.literal("reduce_effects").nullable(),
  revisedConsequenceSummary: z.string().trim().min(1).max(1_000).nullable(),
}).strict();
const administratorEventBodySchema = z.object({
  bindingId: V2IdentifierSchema,
  requestId: V2IdentifierSchema,
  sourceKind: z.enum(["npc_intent", "system_clock"]),
  eventTemplateId: V2IdentifierSchema,
  sourceRef: V2IdentifierSchema,
  expectedWorldStateVersion: z.number().int().nonnegative(),
  notBeforeVirtualMinute: z.number().int().nonnegative().optional(),
}).strict();
const advanceWorldBodySchema = z.object({
  bindingId: V2IdentifierSchema,
}).strict();

export type SimulationWorldAudienceV3 = "student" | "teacher" | "admin";

export interface AuthorizedSimulationWorldActorV3 {
  audience: SimulationWorldAudienceV3;
  principalId: string;
  actorId: string;
  bindingId: string;
}

export interface WorldSimulationV3RouteDependencies {
  engine: Pick<
    WorldSimulationEngineV3,
    | "getRecord"
    | "getSnapshot"
    | "submitStudentAction"
    | "enqueueNpcEvent"
    | "enqueueSystemClockEvent"
  >;
  orchestrator: Pick<
    SimulationAgentOrchestratorV3,
    | "getCurrentEpisode"
    | "prepareNextEpisode"
    | "recordStudentDecision"
    | "resolveAcceptedEpisode"
    | "decideTeacherGate"
  >;
  director: {
    advance(sessionId: string): Promise<{
      scheduled: boolean;
      reason: string;
      receipt: { event: { eventId: string } } | null;
    }>;
  };
  afterWorldSettlement?: (sessionId: string) => Promise<void>;
  work?: Pick<FlagshipStudentWorkServiceV3, "assertWorldActionReference">;
  assertFieldAction?: (input: {
    sessionId: string; bindingId: string; actorId: string; principalId: string;
    requestId: string; action: z.infer<typeof studentActionBodySchema>["action"];
  }) => Promise<void>;
  authorize(input: {
    request: FastifyRequest;
    sessionId: string;
    bindingId: string;
    mutation: boolean;
  }): AuthorizedSimulationWorldActorV3 | Promise<AuthorizedSimulationWorldActorV3>;
}

function audienceView(
  views: SimulationEpisodeViewsV3,
  audience: SimulationWorldAudienceV3,
) {
  return audience === "student"
    ? views.student
    : audience === "teacher"
      ? views.teacher
      : views.admin;
}

function logicalActionTimestamp(snapshot: WorldSnapshot, stateVersion: number): string {
  return new Date(
    new Date(snapshot.virtualTime.startedAt).getTime() + stateVersion * 1_000,
  ).toISOString();
}

function stableWorkActionId(sessionId: string, requestId: string): string {
  const suffix = createHash("sha256")
    .update(`${sessionId}:${requestId}`)
    .digest("hex")
    .slice(0, 24);
  return `work-action-${suffix}`;
}

function serverIssuedActionRef(
  eventTemplateId: string,
  worldStateVersion: number,
): string {
  return `server-action-${eventTemplateId}-${worldStateVersion}`;
}

function qualitativeBand(
  value: number,
  minimum: number,
  maximum: number,
): "low" | "medium" | "high" {
  const ratio = (value - minimum) / (maximum - minimum);
  return ratio < 0.34 ? "low" : ratio < 0.67 ? "medium" : "high";
}

function projectWorld(
  record: Awaited<ReturnType<WorldSimulationV3RouteDependencies["engine"]["getRecord"]>>,
  audience: SimulationWorldAudienceV3,
) {
  const snapshot = record.currentSnapshot;
  const release = record.release;
  const visible = (scopes: string[]) => audience === "admin"
    || scopes.includes(audience);
  const entities = snapshot.entities
    .filter((entity) => visible(entity.visibleScopes))
    .map((entity) => {
      const definition = release.worldEntities.find(
        (candidate) => candidate.entityId === entity.entityId,
      );
      return {
        entityId: entity.entityId,
        title: definition?.title ?? entity.entityId,
        kind: definition?.entityKind ?? "person",
        professionalRole: definition?.professionalRole ?? null,
        status: entity.status,
        publicSummary: entity.publicSummary,
        revision: entity.revision,
      };
    });
  const indicators = snapshot.variables
    .filter((variable) => visible(variable.visibleScopes))
    .map((variable) => {
      const definition = release.variableDefinitions.find(
        (candidate) => candidate.variableId === variable.variableId,
      )!;
      return {
        variableId: variable.variableId,
        title: definition.title,
        band: qualitativeBand(variable.after, definition.minimum, definition.maximum),
        studentProjection: definition.studentProjection,
        ...(audience === "student" ? {} : {
          value: variable.after,
          delta: variable.delta,
          minimum: definition.minimum,
          maximum: definition.maximum,
        }),
      };
    });
  return {
    schemaVersion: "simulation-world-view/3.0.0",
    audience,
    sessionId: record.sessionId,
    title: release.title,
    summary: release.summary,
    worldStateVersion: snapshot.stateVersion,
    virtualTime: snapshot.virtualTime,
    challenge: {
      level: snapshot.learningContext.challengeLevel,
      scoreCeiling: snapshot.learningContext.scoreCeiling,
      scaffoldingLevel: snapshot.learningContext.scaffoldingLevel,
    },
    entities,
    indicators,
    facts: snapshot.facts
      .filter((fact) => visible(fact.visibleScopes))
      .map((fact) => ({
        factId: fact.factId,
        status: fact.status,
        confidenceBand: qualitativeBand(fact.confidence, 0, 1),
        ...(audience === "student" ? {} : {
          confidence: fact.confidence,
          sourceRefs: fact.sourceRefs,
        }),
      })),
    relationships: snapshot.relationships.map((relationship) => ({
      relationshipId: relationship.relationshipId,
      sourceEntityId: relationship.sourceEntityId,
      targetEntityId: relationship.targetEntityId,
      trustBand: qualitativeBand(relationship.trust, 0, 100),
      tensionBand: qualitativeBand(relationship.tension, 0, 100),
      ...(audience === "student" ? {} : {
        trust: relationship.trust,
        tension: relationship.tension,
        influence: relationship.influence,
      }),
    })),
    resources: snapshot.resources
      .filter((resource) => visible(resource.visibleScopes))
      .map((resource) => ({
        resourceId: resource.resourceId,
        resourceKind: resource.resourceKind,
        amount: resource.amount,
        unit: resource.unit,
      })),
    endingState: snapshot.endingState,
    availableActions: release.eventTemplates
      .filter((template) => template.sourceKind === "student_action")
      .filter((template) => template.challengeLevels.includes(
        snapshot.learningContext.challengeLevel,
      ))
      .filter((template) => evaluateFlagshipRuntimeActionPolicyV4(release.actionPolicy, template.eventTemplateId, record).allowed)
      .map((template) => ({
        eventTemplateId: template.eventTemplateId,
        eventType: template.eventType,
        serverIssuedActionRef: serverIssuedActionRef(
          template.eventTemplateId,
          snapshot.stateVersion,
        ),
        title: template.title,
        cue: template.publicCue,
        affectedObjectRefs: template.affectedObjectRefs,
      })),
    ...(audience === "admin" ? {
      queue: record.queue,
      resolutions: record.resolutions,
      consequences: record.consequences,
    } : {}),
  };
}

/**
 * Registers the V3 persistent-world surface. Browser payloads never carry an
 * actor, audience, agent reference, run, replay, provider or trace. Strict
 * parsing happens before authorization and all three projections are selected
 * exclusively from the authenticated server-side binding.
 */
export async function registerWorldSimulationV3Routes(
  app: FastifyInstance,
  dependencies: WorldSimulationV3RouteDependencies,
): Promise<void> {
  app.get<{ Params: { sessionId: string } }>(
    "/api/v3/sessions/:sessionId/world",
    async (request) => {
      const params = sessionParamsSchema.parse(request.params);
      const query = bindingQuerySchema.parse(request.query);
      const authorized = await dependencies.authorize({
        request,
        sessionId: params.sessionId,
        bindingId: query.bindingId,
        mutation: false,
      });
      return {
        world: projectWorld(
          await dependencies.engine.getRecord(params.sessionId),
          authorized.audience,
        ),
      };
    },
  );

  app.get<{ Params: { sessionId: string } }>(
    "/api/v3/sessions/:sessionId/collaboration-episode",
    async (request) => {
      const params = sessionParamsSchema.parse(request.params);
      const query = bindingQuerySchema.parse(request.query);
      const authorized = await dependencies.authorize({
        request,
        sessionId: params.sessionId,
        bindingId: query.bindingId,
        mutation: false,
      });
      const views = await dependencies.orchestrator.getCurrentEpisode(
        params.sessionId,
      );
      return { episode: audienceView(views, authorized.audience) };
    },
  );

  app.post<{ Params: { sessionId: string } }>(
    "/api/v3/sessions/:sessionId/student-actions",
    async (request) => {
      emptyQuerySchema.parse(request.query);
      const params = sessionParamsSchema.parse(request.params);
      const body = studentActionBodySchema.parse(request.body);
      const authorized = await dependencies.authorize({
        request,
        sessionId: params.sessionId,
        bindingId: body.bindingId,
        mutation: true,
      });
      if (authorized.audience !== "student") {
        throw new PermissionDeniedError("只有学生记者可以提交世界动作");
      }
      const world = await dependencies.engine.getRecord(params.sessionId);
      const snapshot = world.currentSnapshot;
      const availableTemplate = world.release.eventTemplates.find((template) => (
        template.eventTemplateId === body.eventTemplateId
          && template.sourceKind === "student_action"
          && template.challengeLevels.includes(world.challengeAssignment.challengeLevel)
      ));
      if (!availableTemplate
        || body.serverIssuedActionRef !== serverIssuedActionRef(
          availableTemplate.eventTemplateId,
          snapshot.stateVersion,
        )) {
        throw new PermissionDeniedError("当前行动入口已失效，请刷新现场后重试");
      }
      if (body.action.verb === "draft" || body.action.verb === "submit") {
        if (!dependencies.work) {
          throw new PermissionDeniedError("当前服务尚未接通真实作品存储，拒绝伪造作品行动");
        }
        await dependencies.work.assertWorldActionReference({
          sessionId: params.sessionId,
          bindingId: authorized.bindingId,
          principalId: authorized.principalId,
          actorId: authorized.actorId,
          challengeLevel: challengeLevelSchema.parse(
            world.challengeAssignment.challengeLevel,
          ),
          eventTemplateId: body.eventTemplateId,
          action: body.action,
        });
      }
      await dependencies.assertFieldAction?.({
        sessionId: params.sessionId, bindingId: authorized.bindingId,
        actorId: authorized.actorId, principalId: authorized.principalId,
        requestId: body.requestId, action: body.action,
      });
      const action = StudentWorkActionSchema.parse({
        schemaVersion: StudentWorkActionSchemaVersion,
        workActionId: stableWorkActionId(params.sessionId, body.requestId),
        serverIssuedActionRef: body.serverIssuedActionRef,
        sessionId: params.sessionId,
        bindingId: authorized.bindingId,
        actorId: authorized.actorId,
        primaryRoleId: "reporter",
        expectedWorldStateVersion: body.expectedWorldStateVersion,
        action: body.action,
        sourceWorldEventIds: body.sourceWorldEventIds,
        reflectionNote: body.reflectionNote,
        submissionStatus: body.action.verb === "draft" ? "draft" : "accepted",
        createdAt: logicalActionTimestamp(
          snapshot,
          body.expectedWorldStateVersion,
        ),
      });
      const receipt = await dependencies.engine.submitStudentAction({
        action,
        eventTemplateId: body.eventTemplateId,
        requestId: body.requestId,
      });
      const views = await dependencies.orchestrator.prepareNextEpisode(
        params.sessionId,
      );
      return {
        receipt: {
          eventId: receipt.event.eventId,
          replayed: receipt.replayed,
          worldStateVersion: snapshot.stateVersion,
        },
        episode: views.student,
      };
    },
  );

  app.post<{ Params: { sessionId: string; episodeId: string } }>(
    "/api/v3/sessions/:sessionId/episodes/:episodeId/decisions",
    async (request) => {
      emptyQuerySchema.parse(request.query);
      const params = episodeParamsSchema.parse(request.params);
      const body = studentDecisionBodySchema.parse(request.body);
      const authorized = await dependencies.authorize({
        request,
        sessionId: params.sessionId,
        bindingId: body.bindingId,
        mutation: true,
      });
      if (authorized.audience !== "student") {
        throw new PermissionDeniedError("只有学生记者可以决定如何处理当前建议");
      }
      let views = await dependencies.orchestrator.recordStudentDecision({
        sessionId: params.sessionId,
        episodeId: params.episodeId,
        decisionRef: body.decisionRef,
        decision: body.decision,
        rationale: body.rationale,
      });
      if (body.decision === "accept") {
        views = await dependencies.orchestrator.resolveAcceptedEpisode(
          params.sessionId,
          params.episodeId,
        );
        if (views.student.consequence?.status === "committed") {
          await dependencies.afterWorldSettlement?.(params.sessionId);
        }
      }
      return { episode: views.student };
    },
  );

  app.post<{ Params: { sessionId: string; episodeId: string } }>(
    "/api/v3/sessions/:sessionId/episodes/:episodeId/teacher-gate",
    async (request) => {
      emptyQuerySchema.parse(request.query);
      const params = episodeParamsSchema.parse(request.params);
      const body = teacherGateBodySchema.parse(request.body);
      const authorized = await dependencies.authorize({
        request,
        sessionId: params.sessionId,
        bindingId: body.bindingId,
        mutation: true,
      });
      if (authorized.audience !== "teacher" && authorized.audience !== "admin") {
        throw new PermissionDeniedError("只有教师或管理员可以处理世界教师门");
      }
      const views = await dependencies.orchestrator.decideTeacherGate({
        sessionId: params.sessionId,
        episodeId: params.episodeId,
        decision: body.decision,
        teacherDecisionRef: body.teacherDecisionRef,
        revisionPolicy: body.revisionPolicy,
        revisedConsequenceSummary: body.revisedConsequenceSummary,
      });
      if (views.student.consequence?.status === "committed") {
        await dependencies.afterWorldSettlement?.(params.sessionId);
      }
      return { episode: audienceView(views, authorized.audience) };
    },
  );

  app.post<{ Params: { sessionId: string } }>(
    "/api/v3/sessions/:sessionId/advance",
    async (request) => {
      emptyQuerySchema.parse(request.query);
      const params = sessionParamsSchema.parse(request.params);
      const body = advanceWorldBodySchema.parse(request.body);
      const authorized = await dependencies.authorize({
        request,
        sessionId: params.sessionId,
        bindingId: body.bindingId,
        mutation: true,
      });
      const advance = await dependencies.director.advance(params.sessionId);
      const views = await dependencies.orchestrator.prepareNextEpisode(
        params.sessionId,
      );
      return {
        advance: {
          scheduled: advance.scheduled,
          reason: advance.reason,
          eventId: advance.receipt?.event.eventId ?? null,
        },
        episode: audienceView(views, authorized.audience),
      };
    },
  );

  app.post<{ Params: { sessionId: string } }>(
    "/api/v3/admin/sessions/:sessionId/world-events",
    async (request) => {
      emptyQuerySchema.parse(request.query);
      const params = sessionParamsSchema.parse(request.params);
      const body = administratorEventBodySchema.parse(request.body);
      const authorized = await dependencies.authorize({
        request,
        sessionId: params.sessionId,
        bindingId: body.bindingId,
        mutation: true,
      });
      if (authorized.audience !== "admin") {
        throw new PermissionDeniedError("只有管理员可以注入受控 NPC 或虚拟时钟事件");
      }
      const eventInput = {
        sessionId: params.sessionId,
        eventTemplateId: body.eventTemplateId,
        sourceRef: body.sourceRef,
        requestId: body.requestId,
        expectedWorldStateVersion: body.expectedWorldStateVersion,
        ...(body.notBeforeVirtualMinute === undefined
          ? {}
          : { notBeforeVirtualMinute: body.notBeforeVirtualMinute }),
      };
      const receipt = body.sourceKind === "npc_intent"
        ? await dependencies.engine.enqueueNpcEvent(eventInput)
        : await dependencies.engine.enqueueSystemClockEvent(eventInput);
      const views = await dependencies.orchestrator.prepareNextEpisode(
        params.sessionId,
      );
      return {
        receipt: {
          eventId: receipt.event.eventId,
          replayed: receipt.replayed,
        },
        episode: views.admin,
      };
    },
  );
}
