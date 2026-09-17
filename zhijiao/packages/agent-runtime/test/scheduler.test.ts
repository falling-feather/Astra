import { describe, expect, it } from "vitest";
import {
  AgentSubscriptionSchema,
  RoleInteractionSchemaVersion,
  SchemaVersion,
  WorldEventSchema,
} from "@ronggang/contracts";
import {
  AgentScheduler,
  AgentSchedulerConfigurationError,
  agentDebounceKey,
  createAgentArchitectureProfile,
  factCheckerSubscription,
  learningCuratorSubscription,
  roleAgentSubscriptions,
  semanticEvaluatorRetrySubscriptions,
  semanticEvaluatorSubscriptions,
} from "../src/index.js";

const materialObserved = WorldEventSchema.parse({
  kind: "WorldEvent",
  sessionId: "session-scheduler",
  sceneId: "scenario-local-tourism-media-v0.1",
  actorId: "student-editor",
  messageId: "message-material-observed",
  correlationId: "correlation-material-observed",
  timestamp: "2026-07-24T08:00:00.000Z",
  schemaVersion: SchemaVersion,
  eventId: "event-material-observed",
  eventType: "material_observed",
  stateVersion: 12,
  visibility: ["assigned_team", "audit_only"],
  visibleToActorIds: [],
  summary: "素材观察已提交",
  payload: {},
});

const interviewRequest = WorldEventSchema.parse({
  ...materialObserved,
  messageId: "message-role-request",
  eventId: "event-role-request",
  eventType: "role_interaction_requested",
  actorId: "student-reporter",
  stateVersion: 13,
  visibility: ["role_private", "audit_only"],
  visibleToActorIds: ["student-reporter", "agent-interviewee"],
  summary: "记者向采访对象发起岗位互动",
  payload: {
    interaction: {
      schemaVersion: RoleInteractionSchemaVersion,
      interactionId: "interaction-interview-1",
      threadId: "thread-reporter-interviewee",
      replyToInteractionId: null,
      optionId: "reporter-interview-process",
      fromActorId: "student-reporter",
      fromRoleId: "reporter",
      toActorId: "agent-interviewee",
      toRoleId: "interviewee",
      kind: "question",
      topic: "heritage_process",
      content: "请介绍非遗制作流程。",
      turn: 1,
      relatedEventIds: [],
      createdAt: "2026-07-24T08:00:00.000Z",
    },
  },
});

const evaluationCaseOpened = WorldEventSchema.parse({
  ...materialObserved,
  messageId: "message-evaluation-case-opened",
  eventId: "event-evaluation-case-opened",
  eventType: "evaluation_case_opened",
  stateVersion: 20,
  summary: "固定评价案件已打开",
  payload: {},
});

const teacherReviewed = WorldEventSchema.parse({
  ...materialObserved,
  messageId: "message-teacher-reviewed",
  eventId: "event-teacher-reviewed",
  eventType: "teacher_reviewed",
  stateVersion: 24,
  summary: "教师终评已固定",
  payload: {},
});

const evaluationBranchRetryRequested = WorldEventSchema.parse({
  ...materialObserved,
  messageId: "message-evaluation-branch-retry",
  eventId: "event-evaluation-branch-retry",
  eventType: "evaluation_branch_retry_requested",
  actorId: "teacher-main",
  stateVersion: 26,
  visibility: ["role_private", "teacher_only", "audit_only"],
  visibleToActorIds: ["agent-work-quality-assessor"],
  summary: "教师仅重跑作品质量评价节点",
  payload: {
    targetAgentId: "agent-work-quality-assessor",
  },
});

describe("AgentScheduler", () => {
  it("creates deterministic post-commit tasks ordered by priority", () => {
    const lowerPriority = AgentSubscriptionSchema.parse({
      subscriptionId: "teaching/material-observed/v1",
      agentId: "agent-teaching",
      roleId: "teaching_director",
      definitionVersion: "teaching-director/1.0.0",
      promptVersion: "1.0.0",
      eventTypes: ["material_observed"],
      priority: 10,
      enabled: true,
    });
    const scheduler = new AgentScheduler([lowerPriority, factCheckerSubscription]);
    let taskSequence = 0;
    const tasks = scheduler.createTasks({
      event: materialObserved,
      outboxId: "outbox-material-observed",
      sessionEpoch: "epoch-1",
      causalDepth: 0,
      expectedStateVersion: 14,
      createdAt: "2026-07-24T08:00:01.000Z",
      nextTaskId: () => `task-${++taskSequence}`,
    });

    expect(tasks.map((task) => task.agentId)).toEqual(["agent-fact-checker", "agent-teaching"]);
    expect(tasks[0]).toMatchObject({
      triggerEventId: materialObserved.eventId,
      expectedStateVersion: 14,
      status: "queued",
      templateRef: {
        templateId: "template:agent-fact-checker",
        templateVersion: "fact-checker/1.2.0",
      },
      instanceRef: {
        instanceId: "session-scheduler:epoch-1:agent-fact-checker",
        instanceVersion: "fact-checker/1.2.0",
      },
    });
  });

  it("records every budget decision while creating tasks for selected instances only", () => {
    const lowerPriority = AgentSubscriptionSchema.parse({
      subscriptionId: "teaching/material-observed/v1",
      agentId: "agent-teaching",
      roleId: "teaching_director",
      definitionVersion: "teaching-director/1.0.0",
      promptVersion: "1.0.0",
      eventTypes: ["material_observed"],
      priority: 10,
      enabled: true,
    });
    let taskSequence = 0;
    const plan = new AgentScheduler(
      [lowerPriority, factCheckerSubscription],
      { waveBudget: 1 },
    ).createDispatchPlan({
      event: materialObserved,
      outboxId: "outbox-budget",
      sessionEpoch: "epoch-1",
      causalDepth: 0,
      expectedStateVersion: 14,
      createdAt: "2026-07-24T08:00:01.000Z",
      nextTaskId: () => `task-budget-${++taskSequence}`,
    });

    expect(plan.affectedInstanceIds).toHaveLength(2);
    expect(plan.budget).toEqual({
      limit: 1,
      affected: 2,
      selected: 1,
      filtered: 1,
      consumed: 1,
      remaining: 0,
      exhausted: true,
    });
    expect(plan.tasks.map((task) => ({
      agentId: task.agentId,
      status: task.status,
      reason: task.dispatchDecision.reason,
    }))).toEqual([
      {
        agentId: "agent-fact-checker",
        status: "queued",
        reason: "selected",
      },
    ]);
    expect(plan.decisions.find(
      (decision) => decision.agentId === "agent-teaching",
    )?.decision).toMatchObject({
      affected: true,
      decision: "filtered",
      reason: "wave_budget_exhausted",
    });
  });

  it("applies per-subscription debounce only after trigger and target matching", () => {
    const debounced = AgentSubscriptionSchema.parse({
      ...factCheckerSubscription,
      subscriptionId: "fact-checker/material-observed/debounced",
      debounceMs: 60_000,
    });
    const unrelated = AgentSubscriptionSchema.parse({
      ...factCheckerSubscription,
      subscriptionId: "fact-checker/teacher-reviewed/unrelated",
      eventTypes: ["teacher_reviewed"],
    });
    let taskSequence = 0;
    const instanceId = "session-scheduler:epoch-1:agent-fact-checker";
    const plan = new AgentScheduler([debounced, unrelated]).createDispatchPlan({
      event: materialObserved,
      outboxId: "outbox-debounce",
      sessionEpoch: "epoch-1",
      causalDepth: 0,
      expectedStateVersion: 14,
      createdAt: "2026-07-24T08:00:30.000Z",
      recentlyScheduledAtByInstanceSubscription: new Map([
        [
          agentDebounceKey(instanceId, debounced.subscriptionId),
          "2026-07-24T08:00:00.000Z",
        ],
      ]),
      nextTaskId: () => `task-debounce-${++taskSequence}`,
    });

    expect(plan.tasks).toEqual([]);
    expect(plan.decisions.find(
      (decision) => decision.subscriptionId === debounced.subscriptionId,
    )?.decision).toMatchObject({
      affected: true,
      decision: "filtered",
      reason: "debounce_active",
    });
    expect(plan.decisions.some(
      (decision) => decision.subscriptionId === unrelated.subscriptionId,
    )).toBe(false);
  });

  it("uses a frozen architecture profile for routing and keeps experiment observation inert", () => {
    const scheduler = new AgentScheduler([factCheckerSubscription]);
    const plan = scheduler.createDispatchPlan({
      event: materialObserved,
      outboxId: "outbox-experiment",
      sessionEpoch: "epoch-1",
      causalDepth: 0,
      expectedStateVersion: 14,
      createdAt: "2026-07-24T08:00:01.000Z",
      architectureProfile: createAgentArchitectureProfile({
        profileId: "architecture-single-generalist",
        profileVersion: "1.0.0",
        enabledTemplateIds: [],
        disabledTemplateIds: [],
      }),
      experimentObservation: {
        schemaVersion: "experiment-observation/1.0.0",
        experimentId: "ablation-002",
        condition: "single_generalist",
        runBatchId: "batch-002",
        caseId: "case-002",
        repetition: 1,
        controlVariablesHash: "b".repeat(64),
      },
      nextTaskId: () => "task-experiment-filtered",
    });

    expect(plan.tasks).toEqual([]);
    expect(plan.experimentObservation).toMatchObject({
      condition: "single_generalist",
      runBatchId: "batch-002",
    });
    expect(plan.decisions[0]?.decision).toMatchObject({
      reason: "architecture_profile_excluded",
    });
  });

  it("does not let experiment observations change routing, instance context or permission inputs", () => {
    const scheduler = new AgentScheduler([factCheckerSubscription]);
    const baseInput = {
      event: materialObserved,
      outboxId: "outbox-observation-blind",
      sessionEpoch: "epoch-1",
      causalDepth: 0,
      expectedStateVersion: 14,
      createdAt: "2026-07-24T08:00:01.000Z",
      architectureProfile: createAgentArchitectureProfile({
        profileId: "architecture-standard",
        profileVersion: "1.0.0",
        enabledTemplateIds: null,
        disabledTemplateIds: [],
      }),
      instanceContextsByAgentId: new Map([[
        "agent-fact-checker",
        {
          bindingKind: "teacher_assistant" as const,
          bindingId:
            "role-binding:course-001:fact_checker:agent-fact-checker",
          actorId: "agent-fact-checker",
          actorKind: "agent" as const,
          courseId: "course-001",
          teamId: "team-001",
          privateMemoryNamespaceRef:
            "session:session-scheduler/epoch:epoch-1/team:team-001/actor:agent-fact-checker",
          configHash: "d".repeat(64),
          lifecycle: "active" as const,
          subjectActorId: null,
          subjectRoleId: null,
          resourceRef: null,
        },
      ]]),
    };
    const planA = scheduler.createDispatchPlan({
      ...baseInput,
      experimentObservation: {
        schemaVersion: "experiment-observation/1.0.0",
        experimentId: "ablation-003",
        condition: "standard",
        runBatchId: "batch-a",
        caseId: "case-003",
        repetition: 1,
        controlVariablesHash: "e".repeat(64),
      },
      nextTaskId: () => "task-observation-blind",
    });
    const planB = scheduler.createDispatchPlan({
      ...baseInput,
      experimentObservation: {
        schemaVersion: "experiment-observation/1.0.0",
        experimentId: "ablation-003",
        condition: "private_view_event_group",
        runBatchId: "batch-b",
        caseId: "case-003",
        repetition: 2,
        controlVariablesHash: "f".repeat(64),
      },
      nextTaskId: () => "task-observation-blind",
    });

    expect(planA.planId).toBe(planB.planId);
    expect(planA.decisions).toEqual(planB.decisions);
    expect(planA.tasks.map((task) => ({
      agentId: task.agentId,
      instanceContext: task.instanceContext,
      decision: task.dispatchDecision,
    }))).toEqual(planB.tasks.map((task) => ({
      agentId: task.agentId,
      instanceContext: task.instanceContext,
      decision: task.dispatchDecision,
    })));
    expect(planA.experimentObservation).not.toEqual(
      planB.experimentObservation,
    );
  });

  it("skips a task whose idempotency key is already completed", () => {
    const scheduler = new AgentScheduler([factCheckerSubscription]);
    const first = scheduler.createTasks({
      event: materialObserved,
      outboxId: "outbox-material-observed",
      sessionEpoch: "epoch-1",
      causalDepth: 0,
      expectedStateVersion: 14,
      createdAt: "2026-07-24T08:00:01.000Z",
      nextTaskId: () => "task-first",
    });
    const completed = new Set([first[0]!.idempotencyKey]);
    const repeated = scheduler.createTasks({
      event: materialObserved,
      outboxId: "outbox-material-observed",
      sessionEpoch: "epoch-1",
      causalDepth: 0,
      expectedStateVersion: 15,
      createdAt: "2026-07-24T08:00:02.000Z",
      completedIdempotencyKeys: completed,
      nextTaskId: () => "task-should-not-exist",
    });

    expect(repeated).toEqual([]);
  });

  it("rejects duplicate subscription identifiers", () => {
    expect(() => new AgentScheduler([
      factCheckerSubscription,
      { ...factCheckerSubscription },
    ])).toThrow(AgentSchedulerConfigurationError);
  });

  it("routes a private interaction only to its declared recipient and enforces causal depth", () => {
    const scheduler = new AgentScheduler(roleAgentSubscriptions);
    const makeTasks = (causalDepth: number) => scheduler.createTasks({
      event: interviewRequest,
      outboxId: "outbox-role-request",
      sessionEpoch: "epoch-1",
      causalDepth,
      expectedStateVersion: 14,
      createdAt: "2026-07-24T08:00:01.000Z",
      nextTaskId: () => `task-role-${causalDepth}`,
    });

    expect(makeTasks(0).map((task) => task.agentId)).toEqual(["agent-interviewee"]);
    expect(makeTasks(5)).toEqual([]);
    const depthPlan = scheduler.createDispatchPlan({
      event: interviewRequest,
      outboxId: "outbox-role-request-depth",
      sessionEpoch: "epoch-1",
      causalDepth: 5,
      expectedStateVersion: 14,
      createdAt: "2026-07-24T08:00:01.000Z",
      nextTaskId: () => "task-role-depth-filtered",
    });
    expect(depthPlan.tasks).toEqual([]);
    expect(depthPlan.decisions.find(
      (decision) => decision.agentId === "agent-interviewee",
    )?.decision).toMatchObject({
      reason: "causal_depth_exceeded",
    });
  });

  it("fans one fixed evaluation case out to exactly three semantic evaluators", () => {
    let taskSequence = 0;
    const tasks = new AgentScheduler(semanticEvaluatorSubscriptions).createTasks({
      event: evaluationCaseOpened,
      outboxId: "outbox-evaluation-case-opened",
      sessionEpoch: "epoch-1",
      causalDepth: 0,
      expectedStateVersion: 21,
      createdAt: "2026-07-24T08:00:01.000Z",
      nextTaskId: () => `task-evaluation-${++taskSequence}`,
    });

    expect(tasks).toHaveLength(3);
    expect(tasks.map((task) => task.agentId).sort()).toEqual([
      "agent-collaboration-assessor",
      "agent-evidence-assessor",
      "agent-work-quality-assessor",
    ]);
    expect(tasks.every((task) => task.roleId === "assessor")).toBe(true);
  });

  it("routes a retry event to exactly the server-selected evaluator", () => {
    let taskSequence = 0;
    const tasks = new AgentScheduler(
      semanticEvaluatorRetrySubscriptions,
    ).createTasks({
      event: evaluationBranchRetryRequested,
      outboxId: "outbox-evaluation-branch-retry",
      sessionEpoch: "epoch-1",
      causalDepth: 1,
      expectedStateVersion: 27,
      createdAt: "2026-07-24T08:00:01.000Z",
      nextTaskId: () => `task-evaluation-retry-${++taskSequence}`,
    });

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      agentId: "agent-work-quality-assessor",
      roleId: "assessor",
      triggerEventType: "evaluation_branch_retry_requested",
    });
  });

  it("routes a teacher-reviewed event only to the learning curator", () => {
    const tasks = new AgentScheduler([learningCuratorSubscription]).createTasks({
      event: teacherReviewed,
      outboxId: "outbox-teacher-reviewed",
      sessionEpoch: "epoch-1",
      causalDepth: 0,
      expectedStateVersion: 25,
      createdAt: "2026-07-24T08:00:01.000Z",
      nextTaskId: () => "task-learning-curator",
    });

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      agentId: "agent-learning",
      roleId: "learning_curator",
      triggerEventType: "teacher_reviewed",
    });
  });
});
