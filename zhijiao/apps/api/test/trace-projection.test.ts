import { describe, expect, it } from "vitest";
import {
  AgentDispatchPlanSchema,
  AgentRunTraceSchema,
  AgentScaleSchemaVersion,
  AgentTaskSchema,
  WorldEventSchema,
  type DispatchAttempt,
  type AgentDispatchPlan,
  type MediaProcessingTask,
  type OutboxRecord,
  type StateProjection,
} from "@ronggang/contracts";
import { buildSessionTraceProjection } from "../src/trace-projection.js";

const sessionId = "trace-session";
const now = "2026-07-26T01:00:00.000Z";
const hash = "a".repeat(64);

const event = WorldEventSchema.parse({
  kind: "WorldEvent",
  eventId: "event-1",
  eventType: "material_observed",
  stateVersion: 7,
  visibility: ["teacher_only"],
  visibleToActorIds: ["teacher-main"],
  summary: "材料观察已经进入权威世界。",
  payload: {
    mediaTaskId: "media-task-1",
    privatePrompt: "PRIVATE_PROMPT_MUST_NOT_LEAK",
  },
  sessionId,
  sceneId: "scene-1",
  actorId: "agent-fact-checker",
  messageId: "message-1",
  correlationId: "correlation-1",
  timestamp: now,
  schemaVersion: "0.1.0",
  actionContext: {
    schemaVersion: "action-envelope/1.0.0",
    actionId: "action-1",
    rootActionId: "action-1",
    causationId: "hotspot-material-1",
    commandName: "inspect_material",
    sourceMode: "world_interaction",
    sourceAssertion: "client_declared",
    payloadHash: "b".repeat(64),
    idempotencyHash: "c".repeat(64),
    actorBindingHash: "d".repeat(64),
    causalDepth: 0,
    objectRefCount: 1,
    evidenceRefCount: 0,
  },
});

const outbox = {
  outboxId: "outbox-1",
  sessionId,
  sessionEpoch: "epoch-1",
  sceneId: "scene-1",
  eventId: event.eventId,
  eventType: event.eventType,
  stateVersion: event.stateVersion,
  correlationId: event.correlationId,
  topic: "world_event",
  causalDepth: 1,
  status: "delivered",
  attempts: 1,
  availableAt: now,
  createdAt: now,
  deliveredAt: "2026-07-26T01:00:00.010Z",
  lastErrorCode: null,
} satisfies OutboxRecord;

const task = AgentTaskSchema.parse({
  taskId: "task-1",
  outboxId: outbox.outboxId,
  subscriptionId: "subscription-1",
  agentId: "agent-fact-checker",
  roleId: "fact_checker",
  templateRef: {
    templateId: "template:agent-fact-checker",
    templateVersion: "fact-checker/1.0.0",
  },
  instanceRef: {
    instanceId: "trace-session:epoch-1:agent-fact-checker",
    instanceVersion: "fact-checker/1.0.0",
  },
  instanceContext: {
    bindingKind: "teacher_assistant",
    bindingId:
      "role-binding:course-1:fact_checker:agent-fact-checker",
    actorId: "agent-fact-checker",
    actorKind: "agent",
    courseId: "course-1",
    teamId: "team-1",
    privateMemoryNamespaceRef: "PRIVATE_MEMORY_NAMESPACE",
    configHash: "e".repeat(64),
    lifecycle: "active",
  },
  definitionVersion: "fact-checker/1.0.0",
  promptVersion: "fact-checker/prompt/1.0.0",
  sessionId,
  sessionEpoch: "epoch-1",
  sceneId: "scene-1",
  triggerEventId: event.eventId,
  triggerEventType: event.eventType,
  expectedStateVersion: 7,
  priority: 10,
  correlationId: event.correlationId,
  causalDepth: 1,
  actionContext: event.actionContext,
  experimentObservation: {
    schemaVersion: "experiment-observation/1.0.0",
    experimentId: "ablation-1",
    condition: "private_view_event_group",
    runBatchId: "batch-1",
    caseId: "case-1",
    repetition: 1,
    controlVariablesHash: "f".repeat(64),
  },
  dispatchDecision: {
    decisionId: "decision-selected",
    affected: true,
    decision: "selected",
    reason: "selected",
    selectedOrder: 0,
    budget: {
      limit: 2,
      affected: 2,
      selected: 1,
      filtered: 1,
      consumed: 1,
      remaining: 1,
      exhausted: false,
    },
  },
  idempotencyKey: "PRIVATE_IDEMPOTENCY_KEY",
  status: "completed",
  attempts: 1,
  maxAttempts: 3,
  availableAt: now,
  lease: {
    ownerId: "worker-1",
    token: "PRIVATE_LEASE_TOKEN",
    acquiredAt: now,
    expiresAt: "2026-07-26T01:01:00.000Z",
  },
  lastErrorCode: null,
  createdAt: now,
  updatedAt: "2026-07-26T01:00:00.100Z",
  completedAt: "2026-07-26T01:00:00.100Z",
});

const dispatchPlan: AgentDispatchPlan = AgentDispatchPlanSchema.parse({
  planId: "plan-dispatch-1",
  waveId: "wave-1",
  policyVersion: AgentScaleSchemaVersion,
  sessionId,
  sessionEpoch: "epoch-1",
  eventId: event.eventId,
  outboxId: outbox.outboxId,
  createdAt: now,
  architectureProfile: {
    profileId: "architecture-standard",
    profileVersion: "1.0.0",
    enabledTemplateIds: null,
    disabledTemplateIds: [],
    policyHash: "1".repeat(64),
  },
  experimentObservation: task.experimentObservation,
  affectedInstanceIds: [
    task.instanceRef.instanceId,
    "trace-session:epoch-1:agent-filtered",
  ],
  budget: task.dispatchDecision.budget!,
  decisions: [
    {
      subscriptionId: task.subscriptionId,
      agentId: task.agentId,
      roleId: task.roleId,
      templateRef: task.templateRef,
      instanceRef: task.instanceRef,
      instanceContext: task.instanceContext,
      decision: task.dispatchDecision,
    },
    {
      subscriptionId: "subscription-filtered",
      agentId: "agent-filtered",
      roleId: "teaching_director",
      templateRef: {
        templateId: "template:agent-filtered",
        templateVersion: "1.0.0",
      },
      instanceRef: {
        instanceId: "trace-session:epoch-1:agent-filtered",
        instanceVersion: "1.0.0",
      },
      instanceContext: {
        bindingKind: "teacher_assistant",
        bindingId: "binding-filtered",
        actorId: "agent-filtered",
        actorKind: "agent",
        courseId: "course-1",
        teamId: "team-1",
        privateMemoryNamespaceRef: "PRIVATE_FILTERED_NAMESPACE",
        configHash: "2".repeat(64),
        lifecycle: "active",
      },
      decision: {
        decisionId: "decision-filtered",
        affected: true,
        decision: "filtered",
        reason: "architecture_profile_excluded",
        selectedOrder: null,
        budget: task.dispatchDecision.budget,
      },
    },
  ],
  tasks: [task],
});

const attempt = {
  attemptId: "attempt-1",
  taskId: task.taskId,
  sessionId,
  attemptNumber: 1,
  workerId: "worker-1",
  startedAt: now,
  completedAt: "2026-07-26T01:00:00.100Z",
  outcome: "completed",
  errorCode: null,
} satisfies DispatchAttempt;

const run = AgentRunTraceSchema.parse({
  taskId: task.taskId,
  agentRunId: "run-1",
  correlationId: event.correlationId,
  agentId: task.agentId,
  roleId: task.roleId,
  templateRef: task.templateRef,
  instanceRef: task.instanceRef,
  experimentObservation: task.experimentObservation,
  dispatchDecision: task.dispatchDecision,
  definitionVersion: task.definitionVersion,
  promptVersion: task.promptVersion,
  inputStateVersion: 7,
  triggerRefs: [event.eventId],
  contextManifest: null,
  promptHash: hash,
  status: "completed",
  nodes: [{
    nodeId: "route",
    kind: "router",
    status: "success",
    startedAt: now,
    completedAt: "2026-07-26T01:00:00.020Z",
    durationMs: 20,
    selectedEdgeId: "model",
    errorCode: null,
  }],
  modelCalls: 1,
  modelInvocations: [{
    invocationId: "invocation-1",
    profileId: "deepseek-v4-flash",
    provider: "deepseek",
    mode: "live",
    model: "deepseek-v4-flash",
    requestId: "provider-request-1",
    status: "completed",
    outputMode: "json_object",
    finishReason: "stop",
    tokenUsage: { input: 80, output: 20, total: 100 },
    latencyMs: 70,
    attempts: 1,
    estimatedCostUsd: null,
    errorCode: null,
    startedAt: "2026-07-26T01:00:00.020Z",
    completedAt: "2026-07-26T01:00:00.090Z",
  }],
  toolCalls: 0,
  tokenUsage: { input: 80, output: 20 },
  fallbackUsed: false,
  errorCode: null,
  startedAt: now,
  completedAt: "2026-07-26T01:00:00.100Z",
  durationMs: 100,
});

const mediaTask = {
  taskId: "media-task-1",
  sessionId,
  sessionEpoch: "epoch-1",
  materialId: "material-1",
  materialVersion: "1.0.0",
  inputRef: "object://material-1",
  inputContentHash: hash,
  planId: "plan-1",
  governanceReviewId: null,
  requestId: "PRIVATE_MEDIA_REQUEST",
  status: "succeeded",
  steps: [{
    stepId: "step-1",
    capability: "image_understanding",
    governanceDomain: null,
    governanceNode: null,
    branchPriority: null,
    timeoutMs: 30_000,
    requestedProviderMode: "mock",
    effectiveProviderMode: "mock",
    status: "succeeded",
    attempts: 1,
    maxAttempts: 3,
    idempotencyKey: "PRIVATE_STEP_IDEMPOTENCY",
    output: {
      outputId: "output-1",
      capability: "image_understanding",
      provider: "iflytek",
      providerMode: "mock",
      summary: "图片中包含活动现场。",
      extracted: { privateRaw: "PRIVATE_RAW_TOOL_OUTPUT" },
      sourceRef: "object://material-1",
      confidence: 0.9,
      trust: "observation_only",
      verificationStatus: "unverified",
      providerRequestId: null,
      createdAt: "2026-07-26T01:00:00.050Z",
    },
    lastErrorCode: null,
    startedAt: now,
    completedAt: "2026-07-26T01:00:00.050Z",
  }],
  requestedBy: "student-editor",
  requestedAt: now,
  idempotencyKey: "PRIVATE_MEDIA_IDEMPOTENCY",
  startedAt: now,
  completedAt: "2026-07-26T01:00:00.050Z",
  updatedAt: "2026-07-26T01:00:00.050Z",
  audience: {
    policyVersion: "acl/1.0.0",
    courseId: "course-1",
    sessionId,
    sessionEpoch: "epoch-1",
    scopes: ["teacher_only"],
    teamIds: [],
    roleIds: ["teacher"],
    actorIds: ["teacher-main"],
    privateNamespaces: [],
    auditReadable: true,
  },
} satisfies MediaProcessingTask;

function projection(): StateProjection {
  return {
    stateVersion: 7,
    mediaProcessingTasks: [mediaTask],
    governanceFindings: [],
  } as unknown as StateProjection;
}

describe("session trace projection", () => {
  it("normalizes the full causal chain and excludes raw private fields", () => {
    const snapshot = buildSessionTraceProjection({
      sessionId,
      generatedAt: "2026-07-26T01:02:00.000Z",
      projection: projection(),
      events: [event],
      outboxRecords: [outbox],
      dispatchPlans: [dispatchPlan],
      tasks: [task],
      attempts: [attempt],
      deadLetters: [],
      runs: [run],
    });

    expect(snapshot.records.map((item) => item.kind)).toEqual([
      "world_event",
      "outbox",
      "dispatch_plan",
      "dispatch_decision",
      "dispatch_decision",
      "agent_task",
      "dispatch_attempt",
      "agent_run",
      "agent_node",
      "tool_step",
      "model_invocation",
    ]);
    expect(snapshot.links).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fromTraceId: "event:event-1",
        toTraceId: "outbox:outbox-1",
        relation: "emits",
      }),
      expect.objectContaining({
        fromTraceId: "outbox:outbox-1",
        toTraceId: "dispatch-plan:plan-dispatch-1",
        relation: "plans",
      }),
      expect.objectContaining({
        fromTraceId: "dispatch-decision:decision-selected",
        toTraceId: "task:task-1",
        relation: "selects",
      }),
      expect.objectContaining({
        fromTraceId: "task:task-1",
        toTraceId: "run:run-1",
        relation: "executes",
      }),
    ]));
    expect(snapshot.summary).toMatchObject({
      eventCount: 1,
      outboxCount: 1,
      taskCount: 1,
      runCount: 1,
      modelInvocationCount: 1,
      toolStepCount: 1,
      totalTokens: 100,
    });
    expect(snapshot.records.find(
      (item) => item.traceId === "event:event-1",
    )?.details).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: "界面来源",
        value: "world_interaction",
      }),
    ]));
    expect(snapshot.records.find(
      (item) => item.traceId === "task:task-1",
    )?.details).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: "模板",
        value: "template:agent-fact-checker@fact-checker/1.0.0",
      }),
      expect.objectContaining({
        label: "实例",
        value: "trace-session:epoch-1:agent-fact-checker@fact-checker/1.0.0",
      }),
    ]));
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain("PRIVATE_PROMPT_MUST_NOT_LEAK");
    expect(serialized).not.toContain("PRIVATE_IDEMPOTENCY_KEY");
    expect(serialized).not.toContain("PRIVATE_LEASE_TOKEN");
    expect(serialized).not.toContain("PRIVATE_RAW_TOOL_OUTPUT");
    expect(serialized).not.toContain("PRIVATE_MEDIA_REQUEST");
    expect(serialized).not.toContain("PRIVATE_MEMORY_NAMESPACE");
    expect(serialized).not.toContain("PRIVATE_FILTERED_NAMESPACE");
  });

  it("keeps failure records explicit instead of converting them to success", () => {
    const failedRun = AgentRunTraceSchema.parse({
      ...run,
      status: "failed",
      errorCode: "model_timeout",
      fallbackUsed: true,
      modelInvocations: [{
        ...run.modelInvocations[0]!,
        status: "failed",
        errorCode: "provider_timeout",
        tokenUsage: { input: null, output: null, total: null },
      }],
    });
    const snapshot = buildSessionTraceProjection({
      sessionId,
      generatedAt: "2026-07-26T01:02:00.000Z",
      projection: projection(),
      events: [event],
      outboxRecords: [outbox],
      dispatchPlans: [dispatchPlan],
      tasks: [{ ...task, status: "failed", lastErrorCode: "model_timeout" }],
      attempts: [{
        ...attempt,
        outcome: "dead_lettered",
        errorCode: "model_timeout",
      }],
      deadLetters: [{
        deadLetterId: "dead-letter-1",
        taskId: task.taskId,
        sessionId,
        idempotencyKey: "PRIVATE_DEADLETTER_IDEMPOTENCY",
        reasonCode: "model_timeout",
        attempts: 1,
        createdAt: "2026-07-26T01:00:00.100Z",
      }],
      runs: [failedRun],
    });

    expect(snapshot.summary.failedCount).toBeGreaterThanOrEqual(4);
    expect(snapshot.records.find(
      (item) => item.traceId === "run:run-1",
    )?.status).toBe("failed");
    expect(JSON.stringify(snapshot)).not.toContain(
      "PRIVATE_DEADLETTER_IDEMPOTENCY",
    );
  });
});
