import { describe, expect, it } from "vitest";
import {
  AgentObservationSchemaVersion,
  AgentStateSchemaVersion,
  type AgentObservation,
  type AgentState,
} from "@ronggang/contracts";
import {
  SimulationAgentTaskV3SchemaVersion,
  SimulationAgentTemplateV3SchemaVersion,
  createSimulationDispatchPlanV3,
  hashSimulationRuntimeValueV3,
  runSimulationAgentTaskV3,
  type SimulationAgentTaskV3,
  type SimulationAgentTemplateV3,
} from "../src/index.js";

const hash = "a".repeat(64);
const simulationReleaseRef = {
  simulationId: "simulation-test",
  releaseId: "simulation-test-r1",
  version: 1,
  contentHash: hash,
};

function template(
  index: number,
  overrides: Partial<SimulationAgentTemplateV3> = {},
): SimulationAgentTemplateV3 {
  return {
    schemaVersion: SimulationAgentTemplateV3SchemaVersion,
    agentTemplateId: `agent-template-${index}`,
    agentId: `agent-${index}`,
    professionalRoleId: `role-${index}`,
    displayName: `智能体 ${index}`,
    responsibility: "只对受影响对象提出最小必要响应。",
    groupId: "group-test",
    contributionKind: "professional_advisor",
    subscribedEventTypes: ["event-source-change"],
    affectedObjectSelectors: [{
      objectType: "world_variable",
      objectId: "evidence_confidence",
    }],
    disclosurePolicyRef: "disclosure-test",
    toolCapabilityRefs: ["tool-observe"],
    initialGoals: [{
      goalId: `goal-${index}`,
      description: "提升证据可信度。",
      priority: 80,
    }],
    initialActionBudget: 3,
    dispatchPriority: 100 - index,
    enabled: true,
    available: true,
    ...overrides,
  };
}

function state(): AgentState {
  return {
    schemaVersion: AgentStateSchemaVersion,
    agentStateId: "agent-state-1",
    sessionId: "session-runtime-v3",
    simulationReleaseRef,
    agentId: "agent-1",
    agentTemplateId: "agent-template-1",
    professionalRoleId: "role-1",
    stateVersion: 0,
    visibility: "server_private",
    currentGoals: [{
      goalId: "goal-1",
      description: "提升证据可信度。",
      priority: 80,
      status: "active",
    }],
    beliefs: [],
    privateMemory: [],
    relationshipModel: [],
    activePlan: [],
    disclosurePolicyRef: "disclosure-test",
    toolCapabilityRefs: ["tool-observe"],
    remainingActionBudget: 3,
    lastObservedWorldStateVersion: 0,
    updatedAt: "2026-08-26T02:00:00.000Z",
  };
}

function observation(): AgentObservation {
  return {
    schemaVersion: AgentObservationSchemaVersion,
    observationId: "observation-1",
    agentStateId: "agent-state-1",
    agentId: "agent-1",
    sessionId: "session-runtime-v3",
    worldStateVersion: 0,
    sourceWorldEventIds: ["world-event-1"],
    authorizedScopes: ["public_world", "assigned_task"],
    visibleObjects: [{
      objectType: "world_variable",
      objectId: "evidence_confidence",
    }],
    visibleFacts: [],
    visibleRelationships: [],
    taskInstruction: "核对冲突信源。",
    contextHash: hash,
    generatedAt: "2026-08-26T02:00:00.000Z",
  };
}

function task(): SimulationAgentTaskV3 {
  return {
    schemaVersion: SimulationAgentTaskV3SchemaVersion,
    agentTaskId: "agent-task-1",
    sessionId: "session-runtime-v3",
    sourceWorldEventId: "world-event-1",
    eventType: "event-source-change",
    affectedObjectRefs: [{
      objectType: "world_variable",
      objectId: "evidence_confidence",
    }],
    dispatchPlanId: "dispatch-plan-1",
    agentId: "agent-1",
    agentTemplateId: "agent-template-1",
    professionalRoleId: "role-1",
    agentStateId: "agent-state-1",
    observationId: "observation-1",
    expectedWorldStateVersion: 0,
    taskInstructionHash: hashSimulationRuntimeValueV3("核对冲突信源。"),
    status: "pending",
    attempt: 1,
    createdAt: "2026-08-26T02:00:00.000Z",
    startedAt: null,
    completedAt: null,
    failureCode: null,
  };
}

describe("V3 affected-agent runtime", () => {
  it("records selected and skipped reasons for the full catalog and obeys budget", () => {
    const templates = Array.from({ length: 14 }, (_, index) => template(index + 1));
    templates[3] = template(4, { enabled: false });
    templates[4] = template(5, { available: false });
    templates[5] = template(6, {
      affectedObjectSelectors: [{ objectType: "entity", objectId: "other" }],
    });
    const plan = createSimulationDispatchPlanV3({
      sessionId: "session-runtime-v3",
      sourceWorldEventId: "world-event-1",
      sourceWorldStateVersion: 0,
      eventType: "event-source-change",
      affectedObjectRefs: [{
        objectType: "world_variable",
        objectId: "evidence_confidence",
      }],
      candidateAgentTemplateIds: templates.map((item) => item.agentTemplateId),
      templates,
      maxSelected: 2,
      createdAt: "2026-08-26T02:00:00.000Z",
      dispatchPlanId: "dispatch-plan-1",
    });

    expect(plan.decisions).toHaveLength(14);
    expect(plan.selectedCount).toBe(2);
    expect(plan.skippedCount).toBe(12);
    expect(plan.decisions.find((item) => item.agentId === "agent-4")?.reasonCode)
      .toBe("disabled");
    expect(plan.decisions.find((item) => item.agentId === "agent-5")?.reasonCode)
      .toBe("unavailable");
    expect(plan.decisions.find((item) => item.agentId === "agent-6")?.reasonCode)
      .toBe("not_affected");
    expect(plan.decisions.filter((item) => item.reasonCode === "budget_limit").length)
      .toBeGreaterThan(0);
  });

  it("creates a real Task -> Run -> Intent identity chain without pretending demo is Live", async () => {
    let id = 0;
    const result = await runSimulationAgentTaskV3({
      template: template(1),
      state: state(),
      observation: observation(),
      task: task(),
      now: () => "2026-08-26T02:00:01.000Z",
      monotonicNowMs: (() => {
        let time = 100;
        return () => time += 7;
      })(),
      idFactory: (prefix) => `${prefix}-${++id}`,
      executor: async () => ({
        intentType: "fact_checker_assesses",
        targetObjectRefs: [{
          objectType: "world_variable",
          objectId: "evidence_confidence",
        }],
        actionType: "request_second_source",
        actionPayload: { minimumSources: 2 },
        summary: "需要第二个独立来源。",
        rationale: "当前来源互相转引。",
        evidenceRefs: ["evidence-source-1"],
        confidence: 0.9,
        riskLevel: "low",
        requiresTeacherGate: false,
        effects: { variableId: "evidence_confidence", delta: 5 },
        executionMode: "deterministic_demo",
        providerId: null,
        modelId: null,
        traceRef: "trace-agent-task-1",
        promptTemplateRef: "prompt-fact-check-v3",
        estimatedCostMicrounits: 0,
      }),
    });

    expect(result.task.status).toBe("completed");
    expect(result.run).toMatchObject({
      status: "succeeded",
      agentTaskId: "agent-task-1",
      executionMode: "deterministic_demo",
      providerId: null,
      modelId: null,
    });
    expect(result.intent).toMatchObject({
      agentTaskId: "agent-task-1",
      agentRunId: result.run.agentRunId,
      observationId: "observation-1",
      authority: "proposal_only",
    });
    expect(result.run.outputHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("fails closed when execution has no evidence and never emits an intent", async () => {
    const result = await runSimulationAgentTaskV3({
      template: template(1),
      state: state(),
      observation: observation(),
      task: task(),
      idFactory: (prefix) => `${prefix}-failed`,
      executor: async () => ({
        intentType: "fact_checker_assesses",
        targetObjectRefs: [{
          objectType: "world_variable",
          objectId: "evidence_confidence",
        }],
        actionType: "guess",
        actionPayload: {},
        summary: "无依据猜测。",
        rationale: "没有依据。",
        evidenceRefs: [],
        confidence: 0.5,
        riskLevel: "low",
        requiresTeacherGate: false,
        effects: {},
        executionMode: "live",
        providerId: "provider-forged",
        modelId: "model-forged",
        traceRef: null,
        promptTemplateRef: null,
        estimatedCostMicrounits: 1,
      }),
    });

    expect(result.task.status).toBe("failed");
    expect(result.run).toMatchObject({
      status: "failed",
      executionMode: "degraded",
      failureCode: "evidence_missing",
      providerId: null,
      modelId: null,
      outputHash: null,
    });
    expect(result.intent).toBeNull();
    expect(result.effects).toBeNull();
  });
});
