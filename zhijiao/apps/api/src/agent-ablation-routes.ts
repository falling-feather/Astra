import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  AgentAblationEvidenceSchema,
  CrossCourseAgentRuleManifestSchema,
  type AgentAblationEvidence,
  type CrossCourseAgentRuleManifest,
} from "@ronggang/contracts";
import {
  verifyAgentAblationEvidenceIntegrity,
  verifyCrossCourseAgentRuleManifestIntegrity,
} from "@ronggang/agent-runtime";

const emptyQuerySchema = z.object({}).strict();

export interface AgentAblationRouteDependencies {
  authorizeAdministrator(request: FastifyRequest): void | Promise<void>;
  readRuleManifest(): CrossCourseAgentRuleManifest | Promise<CrossCourseAgentRuleManifest>;
  readAblationEvidence(): AgentAblationEvidence | Promise<AgentAblationEvidence>;
}

export class AgentAblationIntegrityError extends Error {
  readonly statusCode = 409;
  readonly code = "AGENT_ABLATION_VERSION_HASH_DRIFT";

  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "AgentAblationIntegrityError";
  }
}

function readVerifiedRuleManifest(value: unknown): CrossCourseAgentRuleManifest {
  try {
    return verifyCrossCourseAgentRuleManifestIntegrity(
      CrossCourseAgentRuleManifestSchema.parse(value),
    );
  } catch (error) {
    throw new AgentAblationIntegrityError(
      "跨课程智能体规则清单发生版本或哈希漂移",
      error,
    );
  }
}

function readVerifiedAblationEvidence(value: unknown): AgentAblationEvidence {
  try {
    return verifyAgentAblationEvidenceIntegrity(
      AgentAblationEvidenceSchema.parse(value),
    );
  } catch (error) {
    throw new AgentAblationIntegrityError(
      "智能体消融证据发生版本或哈希漂移",
      error,
    );
  }
}

/**
 * Exposes only frozen, aggregate, administrator-safe V2 evidence. The browser
 * cannot select a condition, course, agent, model, provider, observation, or
 * trace. Strict query parsing happens before authorization and readers.
 */
export async function registerAgentAblationRoutes(
  app: FastifyInstance,
  dependencies: AgentAblationRouteDependencies,
): Promise<void> {
  app.get("/api/admin/agent-rule-manifest", async (request) => {
    emptyQuerySchema.parse(request.query);
    await dependencies.authorizeAdministrator(request);
    return readVerifiedRuleManifest(await dependencies.readRuleManifest());
  });

  app.get("/api/admin/agent-ablation-evidence", async (request) => {
    emptyQuerySchema.parse(request.query);
    await dependencies.authorizeAdministrator(request);
    return readVerifiedAblationEvidence(await dependencies.readAblationEvidence());
  });
}
