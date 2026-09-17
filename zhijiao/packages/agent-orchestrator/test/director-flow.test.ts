import { describe, expect, it } from "vitest";
import {
  EvidenceSchema,
  OutboxRecordSchema,
  WorldEventSchema,
  createMessageMeta,
  type Command,
  type CommandName,
  type Evidence,
  type EventType,
  type AgentRunRequest,
  type ScenarioPackage,
} from "@ronggang/contracts";
import {
  AgentRuntime,
  createSceneDirectorHandlers,
  createTeachingDirectorHandlers,
} from "@ronggang/agent-runtime";
import {
  InMemoryEventStore,
  InProcessMessageBus,
  WorldEngine,
  demoScenario,
  flagshipScenarioV111,
} from "@ronggang/world-core";
import {
  InMemoryAgentTaskStore,
  SceneDirectorTaskHandler,
  TeachingDirectorTaskHandler,
  TrainingSessionOrchestrator,
} from "../src/index.js";

function sequenceIds() {
  let value = 0;
  return { next: (prefix: string) => `${prefix}-${++value}` };
}

const timestamp = "2026-07-25T08:00:00.000Z";
const clock = { now: () => timestamp };

function command(
  sessionId: string,
  actorId: string,
  name: CommandName,
  expectedStateVersion: number,
  payload: Record<string, unknown>,
): Command {
  return {
    ...createMessageMeta({
      sessionId,
      sceneId: demoScenario.scenarioId,
      actorId,
      correlationId: `test-${name}`,
      timestamp,
    }),
    kind: "Command",
    name,
    expectedStateVersion,
    payload,
  };
}

function createDirectorHarness(input: {
  difficulty?: "supportive" | "standard" | "challenging";
  cadence?: "conservative" | "balanced" | "dynamic";
  memoryCanary?: string;
  scenario?: ScenarioPackage;
} = {}) {
  const ids = sequenceIds();
  const store = new InMemoryEventStore();
  const scenario = structuredClone(input.scenario ?? demoScenario);
  if (!scenario.directorConfig) throw new Error("测试情境缺少导演策略");
  scenario.directorConfig.difficulty = input.difficulty ?? "standard";
  scenario.directorConfig.cadence = input.cadence ?? "balanced";
  scenario.directorConfig.cooldownEvents = 100;
  if (input.memoryCanary && scenario.bootstrap.memorySeeds[0]) {
    scenario.bootstrap.memorySeeds[0].content = input.memoryCanary;
  }
  const world = new WorldEngine({
    scenario,
    store,
    bus: new InProcessMessageBus(),
    ids,
    clock,
  });
  const runtime = new AgentRuntime({
    handlers: new Map([
      ...createTeachingDirectorHandlers(),
      ...createSceneDirectorHandlers(),
    ]),
    clock: clock.now,
  });
  const capturedRequests: AgentRunRequest[] = [];
  const capturingRuntime = {
    async run(
      definition: Parameters<AgentRuntime["run"]>[0],
      request: AgentRunRequest,
    ) {
      capturedRequests.push(structuredClone(request));
      return runtime.run(definition, request);
    },
  };
  const taskStore = new InMemoryAgentTaskStore();
  const orchestrator = new TrainingSessionOrchestrator({
    world,
    taskStore,
    handlers: [
      new TeachingDirectorTaskHandler({
        runtime: capturingRuntime,
        now: clock.now,
        nextId: ids.next,
      }),
      new SceneDirectorTaskHandler({
        runtime: capturingRuntime,
        now: clock.now,
        nextId: ids.next,
      }),
    ],
    now: clock.now,
    nextId: ids.next,
    retryDelayMs: 0,
    maxTasksPerDrain: 64,
  });
  return { world, store, taskStore, orchestrator, capturedRequests };
}

async function appendTrigger(input: {
  world: WorldEngine;
  store: InMemoryEventStore;
  sessionId: string;
  eventType: EventType;
  summary: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  const state = await input.world.getStateSnapshot(input.sessionId);
  const stateVersion = state.stateVersion + 1;
  const eventId = `manual-event-${stateVersion}`;
  const correlationId = `manual-correlation-${stateVersion}`;
  const event = WorldEventSchema.parse({
    ...createMessageMeta({
      sessionId: input.sessionId,
      sceneId: state.scenario.scenarioId,
      actorId: "system",
      correlationId,
      timestamp,
    }),
    kind: "WorldEvent",
    eventId,
    eventType: input.eventType,
    stateVersion,
    visibility: ["assigned_team", "audit_only"],
    visibleToActorIds: [],
    summary: input.summary,
    payload: input.payload ?? {},
  });
  const outbox = OutboxRecordSchema.parse({
    outboxId: `manual-outbox-${stateVersion}`,
    sessionId: input.sessionId,
    sessionEpoch: state.sessionEpoch,
    sceneId: state.scenario.scenarioId,
    eventId,
    eventType: input.eventType,
    stateVersion,
    correlationId,
    topic: "world_event",
    causalDepth: 0,
    status: "pending",
    attempts: 0,
    availableAt: timestamp,
    createdAt: timestamp,
    deliveredAt: null,
    lastErrorCode: null,
  });
  await input.store.append(input.sessionId, state.stateVersion, [event], [outbox]);
}

function evidence(sessionId: string, index: number): Evidence {
  return EvidenceSchema.parse({
    evidenceId: `manual-evidence-${index}`,
    sessionId,
    nodeId: "brief",
    actorId: "student-editor",
    action: `补充来源证据 ${index}`,
    basis: `第 ${index} 条授权来源摘要`,
    materialRefs: ["material-visitor-sheet"],
    eventRefs: [],
    observationRefs: [],
    createdAt: timestamp,
    visibility: ["assigned_team", "audit_only"],
  });
}

async function drain(orchestrator: TrainingSessionOrchestrator, sessionId: string): Promise<void> {
  await orchestrator.drain(sessionId);
  await orchestrator.drain(sessionId);
}

describe("dual-director durable flow", () => {
  it("proposes, rejects, recovers, approves and records cooldown no_op without leaking candidates", async () => {
    const { world, store, orchestrator } = createDirectorHarness();
    const sessionId = "session-director-recovery";
    await world.createSession(sessionId, true);
    await drain(orchestrator, sessionId);

    let teacher = await world.getProjection(sessionId, "teacher-main");
    const original = teacher.pendingCandidates.find((candidate) => (
      candidate.candidateKind === "director_intervention"
    ));
    expect(original).toMatchObject({
      routeId: "route-source-scaffold",
      difficulty: "standard",
      alternativeRouteIds: ["route-recovery-source-brief"],
      requiresTeacherReview: true,
    });
    expect(original?.triggerEventIds).toHaveLength(1);
    expect(original?.preconditionHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(teacher.sceneDirectorDecisions.some((decision) => decision.outcome === "no_op")).toBe(true);

    const studentBefore = await world.getProjection(sessionId, "student-editor");
    expect(studentBefore.pendingCandidates).toEqual([]);
    expect(studentBefore.candidateHistory).toEqual([]);
    expect(studentBefore.sceneDirectorDecisions).toEqual([]);
    expect(studentBefore.activeInterventions).toEqual([]);

    if (!original) throw new Error("测试缺少首个导演候选");
    await world.execute(command(
      sessionId,
      "teacher-main",
      "reject_candidate_event",
      teacher.stateVersion,
      { candidateId: original.candidateId, reason: "请改用低风险补证路线" },
    ));
    await drain(orchestrator, sessionId);

    teacher = await world.getProjection(sessionId, "teacher-main");
    const recovery = teacher.pendingCandidates.find((candidate) => (
      candidate.recoveryOfCandidateId === original.candidateId
    ));
    expect(recovery).toMatchObject({
      routeId: "route-recovery-source-brief",
      candidateKind: "director_intervention",
      recoveryOfCandidateId: original.candidateId,
    });
    const scene = await world.getProjection(sessionId, "agent-scene-director");
    expect(scene.candidateHistory.find((item) => item.candidateId === original.candidateId))
      .toMatchObject({ reviewReason: null, reviewedBy: null });
    expect(scene.recentEvents.some((event) => (
      event.eventType === "candidate_event_rejected"
    ))).toBe(false);
    expect(scene.recentEvents.some((event) => (
      event.eventType === "director_recovery_requested"
    ))).toBe(true);

    if (!recovery) throw new Error("测试缺少恢复候选");
    await world.execute(command(
      sessionId,
      "teacher-main",
      "approve_candidate_event",
      teacher.stateVersion,
      { candidateId: recovery.candidateId },
    ));

    const editor = await world.getProjection(sessionId, "student-editor");
    const reporter = await world.getProjection(sessionId, "student-reporter");
    expect(editor.activeInterventions[0]).toMatchObject({
      routeId: "route-recovery-source-brief",
      sourceCandidateId: recovery.candidateId,
    });
    expect(reporter.activeInterventions[0]?.routeId).toBe("route-recovery-source-brief");
    expect(editor.roleMessages.some((message) => (
      message.content.includes("证据缺口说明")
    ))).toBe(true);
    expect(editor.recentEvents.some((event) => (
      event.eventType === "candidate_event_rejected"
      || event.eventType === "director_recovery_requested"
    ))).toBe(false);

    await appendTrigger({
      world,
      store,
      sessionId,
      eventType: "node_activated",
      summary: "重新评估当前任务节点",
      payload: { nodeId: "brief", virtualMinute: 1 },
    });
    await drain(orchestrator, sessionId);
    teacher = await world.getProjection(sessionId, "teacher-main");
    expect(teacher.pendingCandidates).toEqual([]);
    expect(teacher.sceneDirectorDecisions.some((decision) => (
      decision.reasonCode === "cooldown_active"
    ))).toBe(true);
  }, 15_000);

  it("selects a different route at the same node when evidence and difficulty change", async () => {
    const { world, store, orchestrator } = createDirectorHarness({
      difficulty: "challenging",
    });
    const sessionId = "session-director-challenge";
    await world.createSession(sessionId, true);
    await drain(orchestrator, sessionId);
    expect((await world.getProjection(sessionId, "teacher-main")).pendingCandidates).toEqual([]);

    for (const index of [1, 2]) {
      const item = evidence(sessionId, index);
      await appendTrigger({
        world,
        store,
        sessionId,
        eventType: "evidence_recorded",
        summary: `补充第 ${index} 条来源证据`,
        payload: { evidence: item },
      });
    }
    await appendTrigger({
      world,
      store,
      sessionId,
      eventType: "node_activated",
      summary: "在同一任务节点重新评估难度",
      payload: { nodeId: "brief", virtualMinute: 1 },
    });
    await drain(orchestrator, sessionId);

    const teacher = await world.getProjection(sessionId, "teacher-main");
    expect(teacher.pendingCandidates).toHaveLength(1);
    expect(teacher.pendingCandidates[0]).toMatchObject({
      routeId: "route-source-challenge",
      difficulty: "challenging",
      evidenceRefs: ["manual-evidence-1", "manual-evidence-2"],
    });
    expect(teacher.teachingDirectives.findLast((directive) => (
      directive.strategy === "challenge"
    ))).toBeTruthy();
  });

  it("closes a stale director candidate and proposes the configured rain route in the same session", async () => {
    const { world, store, taskStore, orchestrator } = createDirectorHarness({
      scenario: flagshipScenarioV111,
    });
    const sessionId = "session-director-rain-lifecycle";
    await world.createSession(sessionId, true);
    await drain(orchestrator, sessionId);

    let teacher = await world.getProjection(sessionId, "teacher-main");
    const staleCandidate = teacher.pendingCandidates.find((candidate) => (
      candidate.routeId === "route-source-scaffold"
    ));
    expect(staleCandidate).toBeTruthy();

    await appendTrigger({
      world,
      store,
      sessionId,
      eventType: "evidence_recorded",
      summary: "补入第一条暴雨前置证据",
      payload: { evidence: evidence(sessionId, 1) },
    });
    teacher = await world.getProjection(sessionId, "teacher-main");
    expect(teacher.pendingCandidates).toEqual([]);
    expect(teacher.candidateHistory.find((candidate) => (
      candidate.candidateId === staleCandidate?.candidateId
    ))).toMatchObject({
      status: "pending",
    });

    await drain(orchestrator, sessionId);
    const processingPlan = flagshipScenarioV111.productionConfig?.processingPlans.find(
      (plan) => plan.allowedMediaTypes.includes("image"),
    );
    if (!processingPlan) throw new Error("测试情境缺少图片处理档案");
    const editorBeforeProcessing = await world.getProjection(
      sessionId,
      "student-editor",
    );
    await world.execute(command(
      sessionId,
      "student-editor",
      "request_media_processing",
      editorBeforeProcessing.stateVersion,
      {
        materialId: "material-festival-photo",
        planId: processingPlan.planId,
        requestId: "request-rain-media-processing",
      },
    ));
    await drain(orchestrator, sessionId);

    teacher = await world.getProjection(sessionId, "teacher-main");
    const rainCandidate = teacher.pendingCandidates.find((candidate) => (
      candidate.routeId === "route-rain-escalation"
    ));
    expect(teacher.candidateHistory.find((candidate) => (
      candidate.candidateId === staleCandidate?.candidateId
    ))).toMatchObject({
      status: "rejected",
      reviewedBy: "system",
      reviewReason: "审批前置状态已变化，候选由世界内核自动关闭",
    });
    expect(rainCandidate, JSON.stringify({
      directives: teacher.teachingDirectives.slice(-4),
      decisions: teacher.sceneDirectorDecisions.slice(-4),
      pendingCandidates: teacher.pendingCandidates,
    }, null, 2)).toMatchObject({
      candidateKind: "director_intervention",
      riskLevel: "high",
      alternativeRouteIds: ["route-recovery-rain-brief"],
      requiresTeacherReview: true,
    });
    expect(teacher.teachingDirectives.findLast((directive) => (
      directive.reasonCode === "configured_scene_event_ready"
    ))).toMatchObject({
      strategy: "challenge",
      handoffToSceneDirector: true,
    });
    expect(teacher.sceneDirectorDecisions.at(-1)).toMatchObject({
      outcome: "candidate",
      routeId: "route-rain-escalation",
    });
    const requestEvents = (await store.load(sessionId)).filter((event) => (
      event.correlationId === "test-request_media_processing"
    ));
    const directorTriggerIds = new Set(
      requestEvents
        .filter((event) => (
          event.eventType === "evidence_recorded"
          || event.eventType === "node_activated"
        ))
        .map((event) => event.eventId),
    );
    const directorTasks = (await taskStore.list(sessionId)).filter((task) => (
      directorTriggerIds.has(task.triggerEventId)
    ));
    expect(directorTasks).toHaveLength(3);
    expect(directorTasks.every((task) => task.status === "completed")).toBe(true);
    expect(directorTasks.every((task) => task.lastErrorCode === null)).toBe(true);
    const teachingTimeline = await world.getTimeline(sessionId, "agent-teaching");
    const sceneTimeline = await world.getTimeline(sessionId, "agent-scene-director");
    expect(teachingTimeline.some((event) => (
      event.eventType === "evidence_recorded"
      && directorTriggerIds.has(event.eventId)
    ))).toBe(true);
    expect(sceneTimeline.some((event) => (
      event.eventType === "node_activated"
      && directorTriggerIds.has(event.eventId)
    ))).toBe(true);
    expect(teachingTimeline.some((event) => (
      event.eventType === "media_processing_requested"
      && event.correlationId === "test-request_media_processing"
    ))).toBe(false);
    expect(sceneTimeline.some((event) => (
      event.eventType === "media_processing_requested"
      && event.correlationId === "test-request_media_processing"
    ))).toBe(false);

    if (!rainCandidate) throw new Error("测试缺少暴雨导演候选");
    await world.execute(command(
      sessionId,
      "teacher-main",
      "approve_candidate_event",
      teacher.stateVersion,
      { candidateId: rainCandidate.candidateId },
    ));
    const editor = await world.getProjection(sessionId, "student-editor");
    expect(editor.activeInterventions.at(-1)).toMatchObject({
      routeId: "route-rain-escalation",
      riskLevel: "high",
    });
    expect(editor.structuredWorld?.eventCards.find((card) => (
      card.dynamicEventId === "flagship-event-rain-escalation"
    ))).toMatchObject({
      eventType: "scenario_intervention_applied",
      tone: "critical",
    });
    expect(editor.structuredWorld?.scene).toMatchObject({
      sceneId: "scene-rain-transition",
      phase: "incident",
    });
  }, 15_000);

  it("uses the pinned cadence to control whether a teaching scaffold becomes a scene event", async () => {
    const conservative = createDirectorHarness({ cadence: "conservative" });
    await conservative.world.createSession("session-director-conservative", true);
    await drain(conservative.orchestrator, "session-director-conservative");
    const conservativeTeacher = await conservative.world.getProjection(
      "session-director-conservative",
      "teacher-main",
    );
    expect(conservativeTeacher.teachingDirectives.some((directive) => (
      directive.strategy === "scaffold" && !directive.handoffToSceneDirector
    ))).toBe(true);
    expect(conservativeTeacher.pendingCandidates).toEqual([]);

    const balanced = createDirectorHarness({ cadence: "balanced" });
    await balanced.world.createSession("session-director-balanced", true);
    await drain(balanced.orchestrator, "session-director-balanced");
    const balancedTeacher = await balanced.world.getProjection(
      "session-director-balanced",
      "teacher-main",
    );
    expect(balancedTeacher.teachingDirectives.some((directive) => (
      directive.strategy === "scaffold" && directive.handoffToSceneDirector
    ))).toBe(true);
    expect(balancedTeacher.pendingCandidates[0]?.routeId).toBe("route-source-scaffold");
  });

  it("keeps private memory seeds and assessment drafts out of director requests", async () => {
    const memoryCanary = "PRIVATE_MEMORY_CANARY_DIRECTOR_MUST_NOT_SEE";
    const assessmentCanary = "ASSESSMENT_DRAFT_CANARY_DIRECTOR_MUST_NOT_SEE";
    const {
      world,
      store,
      orchestrator,
      capturedRequests,
    } = createDirectorHarness({ memoryCanary });
    const sessionId = "session-director-privacy";
    await world.createSession(sessionId, true);
    await drain(orchestrator, sessionId);

    await appendTrigger({
      world,
      store,
      sessionId,
      eventType: "assessment_created",
      summary: "学生私有评分草稿",
      payload: {
        assessment: {
          assessmentId: "assessment-private-canary",
          stage: "model",
          status: "proposed",
          score: 61,
          rubricVersion: "privacy-test/1.0.0",
          modelVersion: "privacy-canary-model",
          reasons: [assessmentCanary],
          evidenceRefs: [],
          confidence: 0.5,
          reviewedBy: null,
          reviewNote: null,
        },
      },
    });
    await appendTrigger({
      world,
      store,
      sessionId,
      eventType: "node_activated",
      summary: "评分草稿后重新评估当前节点",
      payload: { nodeId: "brief", virtualMinute: 1 },
    });
    await drain(orchestrator, sessionId);

    const serializedRequests = JSON.stringify(capturedRequests);
    expect(serializedRequests).not.toContain(memoryCanary);
    expect(serializedRequests).not.toContain(assessmentCanary);
    expect((await world.getProjection(sessionId, "agent-scene-director")).assessments).toEqual([]);
  });

  it("requires an exact candidate id when several decisions may coexist", async () => {
    const { world, orchestrator } = createDirectorHarness();
    const sessionId = "session-director-exact-approval";
    await world.createSession(sessionId, true);
    await drain(orchestrator, sessionId);
    const teacher = await world.getProjection(sessionId, "teacher-main");

    await expect(world.execute(command(
      sessionId,
      "teacher-main",
      "approve_candidate_event",
      teacher.stateVersion,
      {},
    ))).rejects.toThrow("必须明确指定 candidateId");
  });
});
