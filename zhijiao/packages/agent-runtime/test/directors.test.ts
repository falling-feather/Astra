import { describe, expect, it } from "vitest";
import {
  AgentRunRequestSchema,
  RoleContractSchema,
  createMessageMeta,
  type AgentRunRequest,
} from "@ronggang/contracts";
import {
  AgentRuntime,
  createSceneDirectorHandlers,
  createTeachingDirectorHandlers,
  sceneDirectorAgentDefinition,
  teachingDirectorAgentDefinition,
  type SceneDirectorModelPort,
} from "../src/index.js";
import { buildAgentContext } from "./context-fixture.js";

const sceneRole = RoleContractSchema.parse({
  agentId: "agent-scene-director",
  actorKind: "agent",
  roleId: "scene_director",
  displayName: "情境导演智能体",
  purpose: "依据教学节奏提出候选事件",
  teamId: "team-jiangnan-01",
  visibleScopes: ["public_world", "assigned_team", "role_private"],
  privateScopes: ["actor:agent-scene-director"],
  allowedIntents: ["propose_scenario_intervention", "record_scene_no_op"],
  deniedActions: ["直接改写世界事实"],
  toolPolicy: ["read_reviewed_facts"],
  tokenBudget: 4_000,
});

const teachingRole = RoleContractSchema.parse({
  ...sceneRole,
  agentId: "agent-teaching",
  roleId: "teaching_director",
  displayName: "教学导演智能体",
  allowedIntents: ["record_teaching_directive"],
  privateScopes: ["actor:agent-teaching"],
});

function request(input: {
  role: typeof sceneRole | typeof teachingRole;
  triggerType: string;
  signals: AgentRunRequest["signals"];
}): AgentRunRequest {
  const sessionId = "session-director-runtime";
  const stateVersion = 12;
  const context = buildAgentContext({
    role: input.role,
    sessionId,
    stateVersion,
    retrieved: [{
      itemId: "course-source-verification",
      content: "关键数据必须关联来源、口径与版本。",
    }],
    transient: [{
      itemId: "eligible-routes",
      content: "route-source-scaffold 与 route-source-challenge 均来自受审情境包。",
    }],
  });
  return AgentRunRequestSchema.parse({
    ...createMessageMeta({
      sessionId,
      sceneId: "scenario-local-tourism-media-v0.1",
      actorId: input.role.agentId,
      correlationId: "corr-director-runtime",
      timestamp: "2026-07-25T08:00:00.000Z",
    }),
    kind: "AgentRunRequest",
    taskId: "task-director-runtime",
    agentRunId: "run-director-runtime",
    role: input.role,
    trigger: { type: input.triggerType, sourceId: "event-trigger-1" },
    stateVersion,
    access: context.access,
    context: context.context,
    contextManifest: context.contextManifest,
    signals: input.signals,
  });
}

describe("director agent graphs", () => {
  it("records an explicit no_op through a named graph edge", async () => {
    const runtime = new AgentRuntime({ handlers: createSceneDirectorHandlers() });
    const result = await runtime.run(sceneDirectorAgentDefinition, request({
      role: sceneRole,
      triggerType: "session_started",
      signals: {
        directorAction: "no_op",
        selectionMode: "template",
        allowedRouteIds: "",
        reasonCode: "session_initializing",
        rationaleSummary: "会话刚启动，世界保持不变。",
        difficulty: "standard",
        evidenceRefs: "",
      },
    }));

    expect(result.trace.status).toBe("completed");
    expect(result.trace.nodes[0]?.selectedEdgeId).toBe("route-no-op");
    expect(result.intent).toMatchObject({
      intentType: "record_scene_no_op",
      proposedPayload: { reasonCode: "session_initializing" },
    });
  });

  it("uses a deterministic template when one route is eligible", async () => {
    const runtime = new AgentRuntime({ handlers: createSceneDirectorHandlers() });
    const result = await runtime.run(sceneDirectorAgentDefinition, request({
      role: sceneRole,
      triggerType: "node_activated",
      signals: {
        directorAction: "candidate",
        selectionMode: "template",
        allowedRouteIds: "route-source-scaffold",
        selectedRouteId: "route-source-scaffold",
        fallbackRouteId: "route-source-scaffold",
        selectedRiskLevel: "low",
        reasonCode: "single_route_eligible",
        rationaleSummary: "证据不足，采用支架路线。",
        teachingDirectiveId: "directive-1",
        recoveryOfCandidateId: "",
        difficulty: "supportive",
        evidenceRefs: "",
      },
    }));

    expect(result.trace.status).toBe("completed");
    expect(result.trace.nodes.map((node) => node.nodeId)).toEqual([
      "route-router",
      "safe-template",
      "route-guard",
      "done",
    ]);
    expect(result.intent).toMatchObject({
      intentType: "propose_scenario_intervention",
      proposedPayload: { routeId: "route-source-scaffold" },
    });
  });

  it("degrades an out-of-whitelist model choice to the trusted fallback route", async () => {
    const invalidModel: SceneDirectorModelPort = {
      invoke: async () => ({
        routeId: "route-forged-by-model",
        rationaleSummary: "尝试越过白名单。",
        confidence: 0.99,
      }),
    };
    const runtime = new AgentRuntime({
      handlers: createSceneDirectorHandlers(invalidModel),
    });
    const result = await runtime.run(sceneDirectorAgentDefinition, request({
      role: sceneRole,
      triggerType: "node_activated",
      signals: {
        directorAction: "candidate",
        selectionMode: "model",
        allowedRouteIds: "route-source-scaffold,route-source-challenge",
        selectedRouteId: "route-source-challenge",
        fallbackRouteId: "route-source-scaffold",
        selectedRiskLevel: "medium",
        reasonCode: "multiple_routes_eligible",
        rationaleSummary: "两条路线同时可用。",
        teachingDirectiveId: "directive-1",
        recoveryOfCandidateId: "",
        difficulty: "standard",
        evidenceRefs: "evidence-1",
      },
    }));

    expect(result.trace.status).toBe("degraded");
    expect(result.trace.fallbackUsed).toBe(true);
    expect(result.trace.nodes.find((node) => node.nodeId === "route-guard")).toMatchObject({
      status: "failure",
      errorCode: "director_route_not_allowed",
    });
    expect(result.intent?.proposedPayload.routeId).toBe("route-source-scaffold");
    expect(result.intent?.proposedPayload.selectionOutcome).toBe("fallback");
  });

  it("routes the teaching director to a visible challenge node", async () => {
    const runtime = new AgentRuntime({ handlers: createTeachingDirectorHandlers() });
    const result = await runtime.run(teachingDirectorAgentDefinition, request({
      role: teachingRole,
      triggerType: "node_activated",
      signals: {
        teachingStrategy: "challenge",
        reasonCode: "evidence_ready_for_pressure",
        rationaleSummary: "证据已达到挑战阈值。",
        targetCompetency: "C-ROLE-02",
        targetRoleIds: "responsible_editor,reporter",
        difficulty: "challenging",
        evidenceRefs: "evidence-1,evidence-2",
      },
    }));

    expect(result.trace.status).toBe("completed");
    expect(result.trace.nodes[0]?.selectedEdgeId).toBe("route-challenge");
    expect(result.intent).toMatchObject({
      intentType: "record_teaching_directive",
      proposedPayload: {
        strategy: "challenge",
        handoffToSceneDirector: true,
      },
    });
  });
});
