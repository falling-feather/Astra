import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { V2IdentifierSchema } from "@ronggang/contracts";
import {
  AgentCollaborationEpisodeService,
  isCollaborationEpisodeDrift,
  type BuildCollaborationEpisodeInput,
} from "./agent-collaboration-episode.js";

const sessionParamsSchema = z.object({
  sessionId: V2IdentifierSchema,
}).strict();
const bindingQuerySchema = z.object({
  bindingId: V2IdentifierSchema,
}).strict();
const emptyQuerySchema = z.object({}).strict();

export interface AgentCollaborationEpisodeRouteDependencies {
  service: AgentCollaborationEpisodeService;
  loadAuthorizedEpisode(input: {
    request: FastifyRequest;
    sessionId: string;
    bindingId: string;
  }): Promise<BuildCollaborationEpisodeInput>;
  authorizeAdministrator(request: FastifyRequest): void | Promise<void>;
}

/**
 * Registers the audience-inferred V2 collaboration read surface. The browser
 * cannot supply an audience, actor, replay, strategy reference, provider, or
 * trace. Every query is strictly parsed before authorization/readers run.
 */
export async function registerAgentCollaborationEpisodeRoutes(
  app: FastifyInstance,
  dependencies: AgentCollaborationEpisodeRouteDependencies,
): Promise<void> {
  app.get<{ Params: { sessionId: string } }>(
    "/api/sessions/:sessionId/collaboration-episode",
    async (request, reply) => {
      const params = sessionParamsSchema.parse(request.params);
      const query = bindingQuerySchema.parse(request.query);
      const context = await dependencies.loadAuthorizedEpisode({
        request,
        sessionId: params.sessionId,
        bindingId: query.bindingId,
      });
      const episode = dependencies.service.build(context);
      return reply
        .status(isCollaborationEpisodeDrift(episode) ? 409 : 200)
        .send(episode);
    },
  );

  app.get("/api/admin/agent-topology", async (request) => {
    emptyQuerySchema.parse(request.query);
    await dependencies.authorizeAdministrator(request);
    const manifest = dependencies.service.manifest();
    return {
      ...manifest,
      agents: manifest.agents.map((agent) => ({
        ...agent,
        runtimeState: "idle" as const,
        latestRun: null,
      })),
    };
  });
}
