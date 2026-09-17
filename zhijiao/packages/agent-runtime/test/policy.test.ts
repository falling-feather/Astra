import { describe, expect, it } from "vitest";
import {
  AgentRunRequestSchema,
  ExecutableAgentIntentSchema,
  SchemaVersion,
  type RoleContract,
} from "@ronggang/contracts";
import {
  AgentPolicyError,
  assertDefinitionRequestPolicy,
  assertIntentPolicy,
  assertToolPolicy,
  factCheckerAgentDefinition,
} from "../src/index.js";
import {
  createResourceAudience,
  hashContent,
  hashValue,
} from "@ronggang/context-engine";
import { buildAgentContext } from "./context-fixture.js";

function baseRequest() {
  const role: RoleContract = {
    agentId: "agent-fact-checker",
    actorKind: "agent",
    roleId: "fact_checker",
    displayName: "事实核查员",
    purpose: "核验事实",
    teamId: "team-1",
    visibleScopes: ["assigned_team", "role_private"],
    privateScopes: ["actor:agent-fact-checker"],
    allowedIntents: ["propose_data_correction", "ask_for_evidence"],
    deniedActions: ["mutate_world_state"],
    toolPolicy: ["rag_search"],
    tokenBudget: 1_000,
  };
  return AgentRunRequestSchema.parse({
    kind: "AgentRunRequest",
    sessionId: "session-policy",
    sceneId: "scene-policy",
    actorId: "agent-fact-checker",
    messageId: "message-policy",
    correlationId: "correlation-policy",
    timestamp: "2026-07-24T08:00:00.000Z",
    schemaVersion: SchemaVersion,
    taskId: "task-policy",
    agentRunId: "run-policy",
    role,
    trigger: { type: "material_observed", sourceId: "observation-1" },
    stateVersion: 4,
    ...buildAgentContext({
      role,
      sessionId: "session-policy",
      stateVersion: 4,
    }),
    signals: {},
  });
}

describe("agent policy", () => {
  it("rejects an invocation that impersonates another agent", () => {
    const request = baseRequest();
    const impersonated = AgentRunRequestSchema.parse({
      ...request,
      actorId: "agent-scene-director",
    });
    expect(() => assertDefinitionRequestPolicy(factCheckerAgentDefinition, impersonated)).toThrow(AgentPolicyError);
  });

  it("requires teacher review for high-risk intents", () => {
    const request = baseRequest();
    const intent = ExecutableAgentIntentSchema.parse({
      kind: "AgentIntent",
      sessionId: request.sessionId,
      sceneId: request.sceneId,
      actorId: request.actorId,
      messageId: "intent-message",
      correlationId: request.correlationId,
      timestamp: request.timestamp,
      schemaVersion: SchemaVersion,
      intentId: "intent-policy",
      agentRunId: request.agentRunId,
      roleId: "fact_checker",
      intentType: "propose_data_correction",
      rationaleSummary: "检测到高风险事实冲突",
      proposedPayload: {},
      expectedStateVersion: request.stateVersion,
      causationEventIds: ["observation-1"],
      evidenceRefs: [],
      citationRefs: ["citation-1"],
      toolResultRefs: [],
      confidence: 0.8,
      riskLevel: "high",
      requiresTeacherReview: false,
      visibility: ["teacher_only"],
      visibleToActorIds: [],
      idempotencyKey: "policy-key",
      expiresAt: null,
    });
    expect(() => assertIntentPolicy(intent, factCheckerAgentDefinition, request)).toThrow(/必须进入教师复核/);
  });

  it("enforces toolPolicy before a tool node can execute", () => {
    const request = baseRequest();
    expect(() => assertToolPolicy({
      nodeId: "ocr-tool",
      kind: "tool",
      label: "OCR",
      executorKey: "tool/ocr",
      promptTemplateId: null,
      toolName: "iflytek_ocr",
    }, request)).toThrow(/无权调用工具/);
  });

  it("rejects a re-hashed context item whose resource audience belongs to another actor", () => {
    const request = baseRequest();
    const secret = "另一个角色的私密信息";
    const secretHash = hashContent(secret);
    const foreignAudience = createResourceAudience({
      scopes: ["role_private"],
      courseId: request.access.courseId,
      sessionId: request.sessionId,
      sessionEpoch: request.access.sessionEpoch,
      teamIds: [request.role.teamId],
      roleIds: [request.role.roleId],
      actorIds: ["agent-other"],
      privateNamespaces: ["actor:agent-other"],
    });
    const context = {
      ...request.context,
      fixed: [{
        itemId: "foreign-secret",
        layer: "fixed" as const,
        content: secret,
        contentHash: secretHash,
        sourceRefs: [{
          refId: "foreign-secret",
          kind: "fixed",
          source: "foreign",
          version: "1",
          contentHash: secretHash,
        }],
        audience: foreignAudience,
        priority: 1,
        stableOrderKey: "foreign-secret",
      }],
    };
    const malicious = AgentRunRequestSchema.parse({
      ...request,
      context,
      contextManifest: {
        ...request.contextManifest,
        contextHash: hashValue(context),
        layers: {
          ...request.contextManifest.layers,
          fixed: [{
            itemId: "foreign-secret",
            layer: "fixed",
            contentHash: secretHash,
            sourceRefs: [{
              refId: "foreign-secret",
              kind: "fixed",
              source: "foreign",
              version: "1",
              contentHash: secretHash,
            }],
            characters: 10,
          }],
        },
      },
    });
    expect(() => assertDefinitionRequestPolicy(factCheckerAgentDefinition, malicious))
      .toThrow(/上下文条目越权/);
  });
});
