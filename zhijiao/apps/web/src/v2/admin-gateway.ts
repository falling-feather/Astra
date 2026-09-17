import {
  SessionControlOverviewSchema,type SessionControlOverview,
  AdminCollaborationEpisodeSchema,
  AgentTopologyManifestSchema,
  BusinessOperationReceiptListResponseSchema,
  GoldCompetitionReadinessSnapshotSchema,
  OperationsHealthSnapshotSchema,
  SessionTracePageSchema,
  StateProjectionSchema,
  type AdminCollaborationEpisode,
  type AgentTopologyManifest,
  type BusinessOperationReceipt,
  type GoldCompetitionReadinessSnapshot,
  type OperationsHealthSnapshot,
  type SessionTracePage,
  type SessionExperienceDescriptor,
  type StateProjection,
} from "@ronggang/contracts";
import {
  GatewayHttpError,
  type FetchLike,
  type GatewayRuntimeOptions,
} from "./gateway";
import {
  parseAgentAblationEvidence,
  parseCrossCourseAgentRuleManifest,
  type AgentAblationEvidence,
  type CrossCourseAgentRuleManifest,
} from "./agent-ablation-models";
import {
  parseSessionExperienceDescriptorResponse,
  WireFormatError,
} from "./wire";
import {
  parseFlagshipAdminEpisodeResponse,
  parseFlagshipAgentTopologyResponse,
  parseFlagshipBusinessWorldResponse,
  parseFlagshipWorkReviewResponse,
  type FlagshipAgentTopologyV3,
  type FlagshipBusinessWorldView,
  type FlagshipWorkReviewView,
} from "./world-v3-business";
import type { AdminAgentCollaborationEpisodeV3 } from "@ronggang/contracts";
import {
  parseFlagshipAssessmentCaseResponse,
  type FlagshipAssessmentCaseV3,
} from "./assessment-v3";
import {
  parseFlagshipEvidenceAssessmentAdminCaseResponseV4,
  parseFlagshipEvidenceAssessmentResponseV4,
  type FlagshipEvidenceAssessmentAdminCaseV4,
  type FlagshipEvidenceAssessmentViewV4,
} from "./assessment-v4";
import {
  parseLearnerAdaptationCaseResponse,
  type LearnerAdaptationCaseV3,
} from "./learner-adaptation-v3";
import {
  parseLearnerAdaptationAdminCaseResponseV4,
  type LearnerAdaptationAdminCaseV4,
} from "./learner-adaptation-v4";
import {
  parseFlagshipExperienceResponseV4,
  type FlagshipExperienceViewV4,
} from "./flagship-v4";

export interface AdminGateway {
  getSessionOverview?(bindingId:string,authorizationSessionId:string,signal?:AbortSignal):Promise<SessionControlOverview>;
  getSessionExperienceDescriptor(
    sessionId: string,
    bindingId: string,
    signal?: AbortSignal,
  ): Promise<SessionExperienceDescriptor>;
  getTopology(signal?: AbortSignal): Promise<AgentTopologyManifest>;
  getEpisode(
    sessionId: string,
    bindingId: string,
    signal?: AbortSignal,
  ): Promise<AdminCollaborationEpisode>;
  getOperationsHealth(
    bindingId: string,
    authorizationSessionId: string,
    signal?: AbortSignal,
  ): Promise<OperationsHealthSnapshot>;
  getTracePage(
    sessionId: string,
    bindingId: string,
    signal?: AbortSignal,
  ): Promise<SessionTracePage>;
  getProjection(
    sessionId: string,
    bindingId: string,
    signal?: AbortSignal,
  ): Promise<StateProjection>;
  getReadiness(
    sessionId: string,
    bindingId: string,
    signal?: AbortSignal,
  ): Promise<GoldCompetitionReadinessSnapshot>;
  getAgentRuleManifest(signal?: AbortSignal): Promise<CrossCourseAgentRuleManifest>;
  getAgentAblationEvidence(signal?: AbortSignal): Promise<AgentAblationEvidence>;
  getFlagshipWorld?(
    sessionId: string,
    bindingId: string,
    signal?: AbortSignal,
  ): Promise<FlagshipBusinessWorldView>;
  getFlagshipEpisode?(
    sessionId: string,
    bindingId: string,
    signal?: AbortSignal,
  ): Promise<AdminAgentCollaborationEpisodeV3>;
  getFlagshipWorkReview?(
    sessionId: string,
    bindingId: string,
    signal?: AbortSignal,
  ): Promise<FlagshipWorkReviewView>;
  getFlagshipTopology?(
    sessionId: string,
    bindingId: string,
    signal?: AbortSignal,
  ): Promise<FlagshipAgentTopologyV3>;
  getFlagshipAssessmentCase?(
    sessionId: string,
    bindingId: string,
    signal?: AbortSignal,
  ): Promise<FlagshipAssessmentCaseV3>;
  getFlagshipEvidenceAssessmentCaseV4?(
    sessionId: string,
    bindingId: string,
    signal?: AbortSignal,
  ): Promise<FlagshipEvidenceAssessmentAdminCaseV4>;
  getFlagshipEvidenceAssessmentV4?(
    sessionId: string,
    bindingId: string,
    signal?: AbortSignal,
  ): Promise<FlagshipEvidenceAssessmentViewV4>;
  getLearnerAdaptationCase?(
    sessionId: string,
    bindingId: string,
    signal?: AbortSignal,
  ): Promise<LearnerAdaptationCaseV3>;
  getLearnerAdaptationCaseV4?(
    sessionId: string,
    bindingId: string,
    signal?: AbortSignal,
  ): Promise<LearnerAdaptationAdminCaseV4 | null>;
  getFlagshipExperienceV4?(
    sessionId: string,
    bindingId: string,
    signal?: AbortSignal,
  ): Promise<FlagshipExperienceViewV4>;
  getBusinessOperations?(
    sessionId: string,
    bindingId: string,
    signal?: AbortSignal,
  ): Promise<BusinessOperationReceipt[]>;
}

function runtime(options: GatewayRuntimeOptions): {
  apiBase: string;
  fetchImpl: FetchLike;
} {
  return {
    apiBase: (options.apiBase
      ?? import.meta.env.VITE_API_BASE_URL
      ?? "").replace(/\/$/u, ""),
    fetchImpl: options.fetchImpl
      ?? ((input, init) => globalThis.fetch(input, init)),
  };
}

function errorMessage(body: unknown, status: number): {
  code: string | null;
  message: string;
} {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const value = body as Record<string, unknown>;
    return {
      code: typeof value.code === "string" ? value.code : null,
      message: typeof value.message === "string"
        ? value.message
        : `请求失败（${status}）`,
    };
  }
  return { code: null, message: `请求失败（${status}）` };
}

async function requestUnknown(
  path: string,
  signal: AbortSignal | undefined,
  options: GatewayRuntimeOptions,
): Promise<unknown> {
  const requestRuntime = runtime(options);
  const response = await requestRuntime.fetchImpl(
    `${requestRuntime.apiBase}${path}`,
    {
      credentials: "include",
      headers: { Accept: "application/json" },
      ...(signal ? { signal } : {}),
    },
  );
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    const failure = errorMessage(body, response.status);
    throw new GatewayHttpError(response.status, failure.message, failure.code);
  }
  return body;
}

function objectOf(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WireFormatError(`${label} 必须是对象`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.join("\u0000") !== expected.join("\u0000")) {
    throw new WireFormatError(`${label} 字段不符合冻结接口`);
  }
}

const topologyAgentKeys = [
  "agentId",
  "templateId",
  "title",
  "groupId",
  "responsibility",
  "subscribedEventTypes",
  "inputTypes",
  "outputTypes",
  "allowedActions",
  "forbiddenActions",
  "teacherGateRequired",
  "status",
  "runtimeState",
  "latestRun",
] as const;

/** The runtime endpoint adds two frozen, read-only fields to each manifest node. */
export function parseAdminTopologyResponse(
  value: unknown,
): AgentTopologyManifest {
  const response = objectOf(value, "AgentTopologyManifest runtime response");
  exactKeys(
    response,
    ["schemaVersion", "generatedAt", "groups", "agents", "edges"],
    "AgentTopologyManifest runtime response",
  );
  if (!Array.isArray(response.agents)) {
    throw new WireFormatError("AgentTopologyManifest.agents 必须是数组");
  }
  const agents = response.agents.map((item, index) => {
    const agent = objectOf(item, `AgentTopologyManifest.agents[${index}]`);
    exactKeys(agent, topologyAgentKeys, `AgentTopologyManifest.agents[${index}]`);
    if (agent.runtimeState !== "idle" || agent.latestRun !== null) {
      throw new WireFormatError(
        "拓扑端点只能声明 idle/null；真实运行状态必须来自管理员 Episode",
      );
    }
    const { runtimeState: _runtimeState, latestRun: _latestRun, ...manifestNode } = agent;
    return manifestNode;
  });
  return AgentTopologyManifestSchema.parse({ ...response, agents });
}

export function createHttpAdminGateway(
  options: GatewayRuntimeOptions = {},
): AdminGateway {
  const read = (path: string, signal?: AbortSignal) => (
    requestUnknown(path, signal, options)
  );
  return {
    async getSessionOverview(bindingId,authorizationSessionId,signal){return SessionControlOverviewSchema.parse(await read('/api/training-sessions?'+new URLSearchParams({bindingId,authorizationSessionId}),signal));},

    async getSessionExperienceDescriptor(sessionId, bindingId, signal) {
      return parseSessionExperienceDescriptorResponse(await read(
        `/api/sessions/${encodeURIComponent(sessionId)}/experience-descriptor?bindingId=${encodeURIComponent(bindingId)}`,
        signal,
      ));
    },
    async getTopology(signal) {
      return parseAdminTopologyResponse(await read(
        "/api/admin/agent-topology",
        signal,
      ));
    },
    async getEpisode(sessionId, bindingId, signal) {
      return AdminCollaborationEpisodeSchema.parse(await read(
        `/api/sessions/${encodeURIComponent(sessionId)}/collaboration-episode?bindingId=${encodeURIComponent(bindingId)}`,
        signal,
      ));
    },
    async getOperationsHealth(bindingId, authorizationSessionId, signal) {
      const query = new URLSearchParams({ bindingId, authorizationSessionId });
      return OperationsHealthSnapshotSchema.parse(await read(
        `/api/operations/health?${query.toString()}`,
        signal,
      ));
    },
    async getTracePage(sessionId, bindingId, signal) {
      return SessionTracePageSchema.parse(await read(
        `/api/sessions/${encodeURIComponent(sessionId)}/trace-page?bindingId=${encodeURIComponent(bindingId)}&limit=200`,
        signal,
      ));
    },
    async getProjection(sessionId, bindingId, signal) {
      return StateProjectionSchema.parse(await read(
        `/api/sessions/${encodeURIComponent(sessionId)}/projection?bindingId=${encodeURIComponent(bindingId)}`,
        signal,
      ));
    },
    async getReadiness(sessionId, bindingId, signal) {
      return GoldCompetitionReadinessSnapshotSchema.parse(await read(
        `/api/sessions/${encodeURIComponent(sessionId)}/gold-competition-readiness?bindingId=${encodeURIComponent(bindingId)}`,
        signal,
      ));
    },
    async getAgentRuleManifest(signal) {
      return parseCrossCourseAgentRuleManifest(await read(
        "/api/admin/agent-rule-manifest",
        signal,
      ));
    },
    async getAgentAblationEvidence(signal) {
      return parseAgentAblationEvidence(await read(
        "/api/admin/agent-ablation-evidence",
        signal,
      ));
    },
    async getFlagshipWorld(sessionId, bindingId, signal) {
      return parseFlagshipBusinessWorldResponse(await read(
        `/api/v3/sessions/${encodeURIComponent(sessionId)}/world?bindingId=${encodeURIComponent(bindingId)}`,
        signal,
      ), "admin");
    },
    async getFlagshipExperienceV4(sessionId, bindingId, signal) {
      return parseFlagshipExperienceResponseV4(await read(
        `/api/v4/sessions/${encodeURIComponent(sessionId)}/experience?bindingId=${encodeURIComponent(bindingId)}`,
        signal,
      ), "admin");
    },
    async getBusinessOperations(sessionId, bindingId, signal) {
      const response = BusinessOperationReceiptListResponseSchema.parse(await read(
        `/api/v4/admin/sessions/${encodeURIComponent(sessionId)}/business-operations?bindingId=${encodeURIComponent(bindingId)}`,
        signal,
      ));
      return response.operations;
    },
    async getFlagshipEpisode(sessionId, bindingId, signal) {
      return parseFlagshipAdminEpisodeResponse(await read(
        `/api/v3/sessions/${encodeURIComponent(sessionId)}/collaboration-episode?bindingId=${encodeURIComponent(bindingId)}`,
        signal,
      ));
    },
    async getFlagshipWorkReview(sessionId, bindingId, signal) {
      return parseFlagshipWorkReviewResponse(await read(
        `/api/v3/sessions/${encodeURIComponent(sessionId)}/work-review?bindingId=${encodeURIComponent(bindingId)}`,
        signal,
      ));
    },
    async getFlagshipTopology(sessionId, bindingId, signal) {
      return parseFlagshipAgentTopologyResponse(await read(
        `/api/v3/admin/sessions/${encodeURIComponent(sessionId)}/agent-topology?bindingId=${encodeURIComponent(bindingId)}`,
        signal,
      ));
    },
    async getFlagshipAssessmentCase(sessionId, bindingId, signal) {
      return parseFlagshipAssessmentCaseResponse(await read(
        `/api/v3/admin/sessions/${encodeURIComponent(sessionId)}/assessment-case?bindingId=${encodeURIComponent(bindingId)}`,
        signal,
      ));
    },
    async getFlagshipEvidenceAssessmentCaseV4(sessionId, bindingId, signal) {
      return parseFlagshipEvidenceAssessmentAdminCaseResponseV4(await read(
        `/api/v4/admin/sessions/${encodeURIComponent(sessionId)}/evidence-assessment-case?bindingId=${encodeURIComponent(bindingId)}`,
        signal,
      ));
    },
    async getFlagshipEvidenceAssessmentV4(sessionId, bindingId, signal) {
      return parseFlagshipEvidenceAssessmentResponseV4(await read(
        `/api/v4/sessions/${encodeURIComponent(sessionId)}/evidence-assessment?bindingId=${encodeURIComponent(bindingId)}`,
        signal,
      ), "admin");
    },
    async getLearnerAdaptationCase(sessionId, bindingId, signal) {
      return parseLearnerAdaptationCaseResponse(await read(
        `/api/v3/admin/sessions/${encodeURIComponent(sessionId)}/learner-adaptation-case?bindingId=${encodeURIComponent(bindingId)}`,
        signal,
      ));
    },
    async getLearnerAdaptationCaseV4(sessionId, bindingId, signal) {
      return parseLearnerAdaptationAdminCaseResponseV4(await read(
        `/api/v4/admin/sessions/${encodeURIComponent(sessionId)}/learner-adaptation-case?bindingId=${encodeURIComponent(bindingId)}`,
        signal,
      ));
    },
  };
}
