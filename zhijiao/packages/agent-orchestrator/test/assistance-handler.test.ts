import { describe, expect, it } from "vitest";
import {
  AgentTaskSchema,
  EvidenceSchema,
  FlagshipCollaborationEventId,
  FlagshipCollaborationTaskAnchorId,
  SchemaVersion,
  StructuredWorldStageSchemaVersion,
  WorldEventSchema,
  type AgentRunRequest,
  type CurrentTaskAnchor,
} from "@ronggang/contracts";
import { createScopedAgentInstanceBinding } from "@ronggang/context-engine";
import {
  AgentRuntime,
  assistanceAgentDefinitions,
  assistanceProfilesByAgentId,
  createAssistanceHandlers,
  createAssistanceRoleSnapshot,
  deterministicAssistanceModelDraft,
} from "@ronggang/agent-runtime";
import {
  InMemoryEventStore,
  InProcessMessageBus,
  WorldEngine,
  demoScenario,
} from "@ronggang/world-core";
import { AssistanceTaskHandler } from "../src/index.js";

const sessionId = "session-assistance-anchor";
const triggerEventId = "event-evidence-trigger";

function ids() {
  let value = 0;
  return {
    next: (prefix: string) => `${prefix}-${++value}`,
  };
}

describe("AssistanceTaskHandler flagship task anchor", () => {
  it("preserves the current or historical rain source when the anchor advances to evaluation", async () => {
    const profile = assistanceProfilesByAgentId.get("agent-evidence-coach");
    const definition = assistanceAgentDefinitions.get("agent-evidence-coach");
    const studentRole = demoScenario.roles.find(
      (role) => role.agentId === "student-editor",
    );
    if (!profile || !definition || !studentRole) {
      throw new Error("测试缺少证据教练、定义或目标学生");
    }

    const idSequence = ids();
    const world = new WorldEngine({
      store: new InMemoryEventStore(),
      bus: new InProcessMessageBus(),
      ids: idSequence,
      clock: { now: () => "2026-07-31T00:00:00.000Z" },
      scenario: structuredClone(demoScenario),
    });
    await world.createSession(sessionId, true);
    const state = await world.getStateSnapshot(sessionId);
    const roleSnapshot = createAssistanceRoleSnapshot(
      profile,
      studentRole.teamId,
    );
    const binding = createScopedAgentInstanceBinding({
      templateRef: definition.templateRef,
      definitionVersion: definition.definitionVersion,
      roleSnapshot,
      scenarioId: demoScenario.scenarioId,
      scenarioVersion: demoScenario.version,
      courseId: demoScenario.courseId,
      sessionId,
      sessionEpoch: state.sessionEpoch,
      bindingKind: "student_role",
      subjectRole: studentRole,
    });
    const task = AgentTaskSchema.parse({
      taskId: "task-evidence-assistance",
      outboxId: "outbox-evidence-assistance",
      subscriptionId: "agent-evidence-coach/evidence_recorded/v1",
      agentId: profile.agentId,
      roleId: profile.roleId,
      templateRef: definition.templateRef,
      instanceRef: binding.instanceRef,
      instanceContext: binding.instanceContext,
      roleSnapshot: binding.roleSnapshot,
      definitionVersion: definition.definitionVersion,
      promptVersion: definition.promptVersion,
      sessionId,
      sessionEpoch: state.sessionEpoch,
      sceneId: demoScenario.scenarioId,
      triggerEventId,
      triggerEventType: "evidence_recorded",
      expectedStateVersion: state.stateVersion,
      priority: 65,
      correlationId: "correlation-evidence-assistance",
      causalDepth: 0,
      actionContext: null,
      experimentObservation: null,
      dispatchDecision: {
        decisionId: "decision-evidence-assistance",
        affected: true,
        decision: "selected",
        reason: "selected",
        selectedOrder: 0,
        budget: {
          limit: 4,
          affected: 1,
          selected: 1,
          filtered: 0,
          consumed: 1,
          remaining: 3,
          exhausted: false,
        },
      },
      idempotencyKey: "evidence-assistance-anchor",
      status: "queued",
      attempts: 0,
      maxAttempts: 3,
      availableAt: "2026-07-31T00:00:00.000Z",
      lease: null,
      lastErrorCode: null,
      createdAt: "2026-07-31T00:00:00.000Z",
      updatedAt: "2026-07-31T00:00:00.000Z",
      completedAt: null,
    });
    const evidence = EvidenceSchema.parse({
      evidenceId: "evidence-student-anchor",
      sessionId,
      nodeId: "verify",
      actorId: studentRole.agentId,
      action: "核对暴雨后补证顺序",
      basis: "学生记录了可核验来源与观察边界",
      materialRefs: ["material-visitor-sheet"],
      eventRefs: [triggerEventId],
      observationRefs: [],
      artifactRevisionRefs: [],
      processingTaskRefs: [],
      createdAt: "2026-07-31T00:00:01.000Z",
      visibility: ["assigned_team", "role_private", "audit_only"],
    });
    const triggerEvent = WorldEventSchema.parse({
      kind: "WorldEvent",
      sessionId,
      sceneId: demoScenario.scenarioId,
      actorId: studentRole.agentId,
      messageId: "message-evidence-assistance",
      correlationId: task.correlationId,
      timestamp: evidence.createdAt,
      schemaVersion: SchemaVersion,
      eventId: triggerEventId,
      eventType: "evidence_recorded",
      stateVersion: state.stateVersion,
      visibility: ["assigned_team", "role_private", "audit_only"],
      visibleToActorIds: [studentRole.agentId],
      summary: "学生证据进入世界",
      payload: { evidence },
    });
    const baseProjection = await world.getProjection(
      sessionId,
      studentRole.agentId,
    );
    const emptyStructuredWorld = {
      schemaVersion: StructuredWorldStageSchemaVersion,
      scene: {
        sceneId: "scene-rain-transition",
        title: "暴雨应急现场",
        description: "测试结构化世界历史事件卡",
        visualMode: "structured_cards" as const,
        phase: "incident" as const,
        riskLevel: "high" as const,
        stateTags: [],
      },
      hotspots: [],
      tasks: [],
      eventCards: [],
      signals: [],
      causalReplay: [],
      evidenceContinuity: {
        caseState: "collecting" as const,
        visibleEvidenceCount: 0,
        fixedVisibleEvidenceCount: 0,
        sourceModes: [],
        teacherFinalRequired: true as const,
      },
    };
    const requests: AgentRunRequest[] = [];
    const runtime = new AgentRuntime({
      handlers: createAssistanceHandlers({
        invoke: async ({ request, profile: selectedProfile }) => {
          requests.push(request);
          const output = deterministicAssistanceModelDraft(
            `assistance.${selectedProfile.kind}`,
          );
          if (!output) throw new Error("测试辅助模型缺少确定性输出");
          return output;
        },
      }),
      clock: () => "2026-07-31T00:00:02.000Z",
    });
    const handler = new AssistanceTaskHandler({
      runtime,
      now: () => "2026-07-31T00:00:02.000Z",
      nextId: idSequence.next,
    });

    const runWithAnchor = async (
      anchor: CurrentTaskAnchor,
      historicalRainEventId?: string,
    ) => handler.run({
      task,
      triggerEvent,
      projection: {
        ...structuredClone(baseProjection),
        role: binding.roleSnapshot,
        evidence: [evidence],
        currentTaskAnchor: anchor,
        structuredWorld: historicalRainEventId
          ? {
              ...structuredClone(emptyStructuredWorld),
              eventCards: [{
                dynamicEventId: FlagshipCollaborationEventId,
                eventType: "scenario_intervention_applied",
                triggerKind: "agent_candidate",
                title: "暴雨突发下的双岗应变已生效",
                worldChanges: ["任务优先级与现场路线已经改变"],
                affectedTaskIds: [FlagshipCollaborationTaskAnchorId],
                sourceEventId: historicalRainEventId,
                rootActionId: null,
                sourceMode: null,
                tone: "critical",
              }],
            }
          : null,
      },
      scenario: demoScenario,
    });
    const anchor = (
      taskId: string | null,
      sourceEventId: string | null,
    ): CurrentTaskAnchor => ({
      taskId,
      phase: taskId ? "in_progress" : "no_task",
      stateVersion: state.stateVersion,
      sourceEventId,
      priority: taskId ? "urgent" : "none",
      worldTarget: null,
      latestFeedbackReason: "",
    });

    const flagship = await runWithAnchor(anchor(
      FlagshipCollaborationTaskAnchorId,
      "event-rain-anchor",
    ));
    const nonFlagship = await runWithAnchor(anchor(
      "task-unrelated",
      "event-unrelated-anchor",
    ));
    const sourceMissing = await runWithAnchor(anchor(
      FlagshipCollaborationTaskAnchorId,
      null,
    ));
    const historical = await runWithAnchor(
      anchor("flagship-task-evaluation-review", "event-evaluation-anchor"),
      "event-rain-historical",
    );

    expect(requests).toHaveLength(4);
    expect(requests[0]?.signals.currentTaskAnchorEventId).toBe(
      "event-rain-anchor",
    );
    expect(flagship.assistanceProposal?.causationEventIds).toEqual([
      triggerEventId,
      "event-rain-anchor",
    ]);
    expect(requests[1]?.signals).not.toHaveProperty(
      "currentTaskAnchorEventId",
    );
    expect(nonFlagship.assistanceProposal?.causationEventIds).toEqual([
      triggerEventId,
    ]);
    expect(requests[2]?.signals).not.toHaveProperty(
      "currentTaskAnchorEventId",
    );
    expect(sourceMissing.assistanceProposal?.causationEventIds).toEqual([
      triggerEventId,
    ]);
    expect(requests[3]?.signals.currentTaskAnchorEventId).toBe(
      "event-rain-historical",
    );
    expect(historical.assistanceProposal?.causationEventIds).toEqual([
      triggerEventId,
      "event-rain-historical",
    ]);
  });
});
