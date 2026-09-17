import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  DialogueEpisodeResponseV4Schema,
  DialogueTurnRequestV4Schema,
  FieldExplorationResponseV4Schema,
  SemanticActionRequestV4Schema,
  V2IdentifierSchema,
} from "@ronggang/contracts";
import { PermissionDeniedError } from "@ronggang/world-core";
import type { AuthorizedSimulationWorldActorV3 } from "./world-simulation-v3-routes.js";
import type { FlagshipExperienceServiceV4 } from "./flagship-experience-v4.js";

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

const groundedDecisionBodySchema = z.object({
  bindingId: V2IdentifierSchema,
  decisionToken: z.string().regex(/^groundeddecision_[A-Za-z0-9_-]{32,192}$/u),
  decisionRef: V2IdentifierSchema,
  decision: z.enum(["accept", "request_evidence", "reject"]),
  rationale: z.string().trim().min(1).max(800),
}).strict();

export interface FlagshipExperienceV4RouteDependencies {
  experience: Pick<
    FlagshipExperienceServiceV4,
    | "getExperience"
    | "decideSemanticAction"
    | "decideGroundedSuggestion"
    | "getCurrentGroundedForAudience"
    | "refreshGroundedEvidence"
    | "startDialogue"
    | "submitDialogueTurn"
    | "getCurrentDialogueForAudience"
    | "getExplorationField"
  >;
  authorize(input: {
    request: FastifyRequest;
    sessionId: string;
    bindingId: string;
    mutation: boolean;
  }): AuthorizedSimulationWorldActorV3 | Promise<AuthorizedSimulationWorldActorV3>;
}

/**
 * Public V4 role surface. The browser may submit only a signed action window,
 * free-text utterance and opaque object tokens. Actor, audience, agent, model,
 * trace, world effect and authoritative consequence fields are server-owned.
 */
export async function registerFlagshipExperienceV4Routes(
  app: FastifyInstance,
  dependencies: FlagshipExperienceV4RouteDependencies,
): Promise<void> {
  app.get<{ Params: { sessionId: string } }>(
    "/api/v4/sessions/:sessionId/field",
    async request => {
      const params = sessionParamsSchema.parse(request.params);
      const query = bindingQuerySchema.parse(request.query);
      const authorized = await dependencies.authorize({
        request, sessionId: params.sessionId, bindingId: query.bindingId, mutation: false,
      });
      return FieldExplorationResponseV4Schema.parse({
        field: await dependencies.experience.getExplorationField({
          sessionId: params.sessionId, bindingId: authorized.bindingId,
          audience: authorized.audience, actorId: authorized.actorId,
          principalId: authorized.principalId,
        }),
      });
    },
  );

  app.get<{ Params: { sessionId: string } }>(
    "/api/v4/sessions/:sessionId/experience",
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
        experience: await dependencies.experience.getExperience({
          sessionId: params.sessionId,
          bindingId: authorized.bindingId,
          audience: authorized.audience,
          actorId: authorized.actorId,
          principalId: authorized.principalId,
        }),
      };
    },
  );

  app.get<{ Params: { sessionId: string } }>(
    "/api/v4/sessions/:sessionId/grounded-collaboration",
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
        collaboration: await dependencies.experience.getCurrentGroundedForAudience({
          sessionId: params.sessionId,
          bindingId: authorized.bindingId,
          audience: authorized.audience,
        }),
      };
    },
  );

  app.post<{ Params: { sessionId: string } }>(
    "/api/v4/sessions/:sessionId/dialogues",
    async (request) => {
      emptyQuerySchema.parse(request.query);
      const params = sessionParamsSchema.parse(request.params);
      const body = SemanticActionRequestV4Schema.parse(request.body);
      if (body.sessionId !== params.sessionId) {
        throw new PermissionDeniedError("人物对话会话引用与路径不一致");
      }
      const authorized = await dependencies.authorize({
        request,
        sessionId: params.sessionId,
        bindingId: body.bindingId,
        mutation: true,
      });
      if (authorized.audience !== "student") {
        throw new PermissionDeniedError("只有学生记者可以开始人物对话");
      }
      return dependencies.experience.startDialogue({
        request: body,
        actorId: authorized.actorId,
        principalId: authorized.principalId,
      });
    },
  );

  app.get<{ Params: { sessionId: string } }>(
    "/api/v4/sessions/:sessionId/dialogue",
    async (request) => {
      const params = sessionParamsSchema.parse(request.params);
      const query = bindingQuerySchema.parse(request.query);
      const authorized = await dependencies.authorize({
        request,
        sessionId: params.sessionId,
        bindingId: query.bindingId,
        mutation: false,
      });
      return DialogueEpisodeResponseV4Schema.parse({
        dialogue: await dependencies.experience.getCurrentDialogueForAudience({
          sessionId: params.sessionId,
          bindingId: authorized.bindingId,
          audience: authorized.audience,
          actorId: authorized.actorId,
          principalId: authorized.principalId,
        }),
      });
    },
  );

  app.post<{ Params: { sessionId: string; episodeId: string } }>(
    "/api/v4/sessions/:sessionId/grounded-episodes/:episodeId/refresh",
    async (request) => {
      emptyQuerySchema.parse(request.query);
      const params = episodeParamsSchema.parse(request.params);
      const body = bindingQuerySchema.parse(request.body);
      const authorized = await dependencies.authorize({ request, sessionId: params.sessionId, bindingId: body.bindingId, mutation: true });
      if (authorized.audience !== "student") throw new PermissionDeniedError("只有学生记者可以继续当前证据协作");
      return { collaboration: await dependencies.experience.refreshGroundedEvidence({
        sessionId: params.sessionId, episodeId: params.episodeId, bindingId: authorized.bindingId,
      }) };
    },
  );

  app.post<{ Params: { sessionId: string; episodeId: string } }>(
    "/api/v4/sessions/:sessionId/dialogues/:episodeId/turns",
    async (request) => {
      emptyQuerySchema.parse(request.query);
      const params = episodeParamsSchema.parse(request.params);
      const body = DialogueTurnRequestV4Schema.parse(request.body);
      if (body.sessionId !== params.sessionId || body.episodeId !== params.episodeId) {
        throw new PermissionDeniedError("人物对话回合引用与路径不一致");
      }
      const authorized = await dependencies.authorize({
        request,
        sessionId: params.sessionId,
        bindingId: body.bindingId,
        mutation: true,
      });
      if (authorized.audience !== "student") {
        throw new PermissionDeniedError("只有学生记者可以推进人物对话");
      }
      return DialogueEpisodeResponseV4Schema.parse({
        dialogue: await dependencies.experience.submitDialogueTurn({
          request: body,
          actorId: authorized.actorId,
          principalId: authorized.principalId,
        }),
      });
    },
  );

  app.post<{ Params: { sessionId: string } }>(
    "/api/v4/sessions/:sessionId/semantic-actions",
    async (request) => {
      emptyQuerySchema.parse(request.query);
      const params = sessionParamsSchema.parse(request.params);
      const body = SemanticActionRequestV4Schema.parse(request.body);
      if (body.sessionId !== params.sessionId) {
        throw new PermissionDeniedError("语义行动会话引用与路径不一致");
      }
      const authorized = await dependencies.authorize({
        request,
        sessionId: params.sessionId,
        bindingId: body.bindingId,
        mutation: true,
      });
      if (authorized.audience !== "student") {
        throw new PermissionDeniedError("只有学生记者可以提交自由岗位行动");
      }
      return dependencies.experience.decideSemanticAction({
        request: body,
        actorId: authorized.actorId,
        principalId: authorized.principalId,
      });
    },
  );

  app.post<{ Params: { sessionId: string; episodeId: string } }>(
    "/api/v4/sessions/:sessionId/grounded-episodes/:episodeId/decisions",
    async (request) => {
      emptyQuerySchema.parse(request.query);
      const params = episodeParamsSchema.parse(request.params);
      const body = groundedDecisionBodySchema.parse(request.body);
      const authorized = await dependencies.authorize({
        request,
        sessionId: params.sessionId,
        bindingId: body.bindingId,
        mutation: true,
      });
      if (authorized.audience !== "student") {
        throw new PermissionDeniedError("只有学生记者可以决定如何处理当前专业建议");
      }
      return {
        collaboration: await dependencies.experience.decideGroundedSuggestion({
          sessionId: params.sessionId,
          bindingId: authorized.bindingId,
          episodeId: params.episodeId,
          decisionToken: body.decisionToken,
          decisionRef: body.decisionRef,
          decision: body.decision,
          rationale: body.rationale,
        }),
      };
    },
  );
}
