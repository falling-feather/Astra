import { describe, expect, it } from "vitest";
import {
  ActionEnvelopeSchema,
  ActionEnvelopeSchemaVersion,
  AgentTaskSchema,
  WorldEventSchema,
  createMessageMeta,
  type ArtifactRevision,
  type Command,
  type CommandName,
  type Evidence,
  type OutboxRecord,
  type ProductionSubmission,
  type WorldEvent,
} from "@ronggang/contracts";
import {
  hashValue,
  roleBindingConfigHash,
  roleMemoryNamespace,
} from "@ronggang/context-engine";
import {
  InMemoryEventStore,
  InProcessMessageBus,
  DomainRevisionConflictError,
  InvalidWorldActionError,
  PermissionDeniedError,
  ScenarioVersionMismatchError,
  StaticScenarioReleaseResolver,
  WorldEngine,
  arbitrateEvaluationProposals,
  createEvaluationCase,
  createRuleEvaluationProposal,
  createStaticScenarioRelease,
  createUnavailableEvaluationProposal,
  demoScenario,
  demoScenarioV041LegacyContentHash,
  demoScenarioV051ContentHash,
  demoScenarioV060ContentHash,
  demoScenarioV061ContentHash,
  demoScenarioV070ContentHash,
  demoScenarioV100ContentHash,
  legacyDemoScenarioV041,
  legacyDemoScenarioV051,
  legacyDemoScenarioV060,
  legacyDemoScenarioV061,
  legacyDemoScenarioV070,
} from "../src/index.js";

class RecordingEventStore extends InMemoryEventStore {
  readonly batches: WorldEvent[][] = [];

  override async append(
    sessionId: string,
    expectedVersion: number,
    events: WorldEvent[],
    outboxRecords: OutboxRecord[] = [],
  ): Promise<void> {
    await super.append(sessionId, expectedVersion, events, outboxRecords);
    this.batches.push(structuredClone(events));
  }
}

function sequenceIds() {
  let value = 0;
  return { next: (prefix: string) => `${prefix}-${++value}` };
}

function fixedClock() {
  let second = 0;
  const base = Date.parse("2026-07-22T06:35:00.000Z");
  return { now: () => new Date(base + second++ * 1_000).toISOString() };
}

function command(
  sessionId: string,
  actorId: string,
  name: CommandName,
  version: number,
  payload: Record<string, unknown> = {},
): Command {
  return {
    ...createMessageMeta({
      sessionId,
      sceneId: "scenario-local-tourism-media-v0.1",
      actorId,
      correlationId: `test-${name}`,
      timestamp: "2026-07-22T06:35:00.000Z",
    }),
    kind: "Command",
    name,
    expectedStateVersion: version,
    payload,
  };
}

describe("WorldEngine", () => {
  it("atomically commits a world command with its outbox and can replay the result", async () => {
    const store = new RecordingEventStore();
    const engine = new WorldEngine({
      store,
      bus: new InProcessMessageBus(),
      ids: sequenceIds(),
      clock: fixedClock(),
    });
    const sessionId = "session-test-loop";
    await engine.createSession(sessionId, true);
    const reporter = await engine.getProjection(sessionId, "student-reporter");
    const batchesBeforeInteraction = store.batches.length;

    const afterInteraction = await engine.execute(
      command(
        sessionId,
        "student-reporter",
        "send_role_interaction",
        reporter.stateVersion,
        { optionId: "reporter-interview-process" },
      ),
    );
    const interactionBatches = store.batches.slice(batchesBeforeInteraction);
    expect(interactionBatches).toHaveLength(1);
    expect(interactionBatches[0]?.map((event) => event.eventType)).toEqual([
      "role_interaction_requested",
      "role_message_posted",
    ]);
    expect(afterInteraction.roleInteractions).toHaveLength(1);
    expect(afterInteraction.roleInteractions[0]).toMatchObject({
      status: "pending",
      request: {
        optionId: "reporter-interview-process",
        turn: 1,
      },
    });

    const interactionIds = new Set(interactionBatches[0]?.map((event) => event.eventId));
    const outbox = await store.loadOutbox(sessionId);
    expect(outbox.filter((record) => interactionIds.has(record.eventId))).toHaveLength(2);
    expect(outbox.every((record) => record.status === "pending")).toBe(true);

    const replayEngine = new WorldEngine({
      store,
      ids: sequenceIds(),
      clock: fixedClock(),
    });
    const replayed = await replayEngine.getProjection(sessionId, "student-reporter");
    expect(replayed.stateVersion).toBe((await store.load(sessionId)).length);
    expect(replayed.roleInteractions[0]?.request.threadId).toBe(
      afterInteraction.roleInteractions[0]?.request.threadId,
    );
  });

  it("routes course-platform and world-interaction actions through the same command authority", async () => {
    const store = new RecordingEventStore();
    const engine = new WorldEngine({
      store,
      bus: new InProcessMessageBus(),
      ids: sequenceIds(),
      clock: fixedClock(),
    });
    const sessions = [
      {
        sessionId: "session-course-surface",
        mode: "course_platform" as const,
        surfaceId: "student-course-platform",
      },
      {
        sessionId: "session-world-surface",
        mode: "world_interaction" as const,
        surfaceId: "student-world",
      },
    ];

    for (const source of sessions) {
      await engine.createSession(source.sessionId, true);
      const projection = await engine.getProjection(
        source.sessionId,
        "student-reporter",
      );
      const worldCommand = command(
        source.sessionId,
        "student-reporter",
        "send_role_interaction",
        projection.stateVersion,
        { optionId: "reporter-interview-process" },
      );
      const actionId = `action-${source.mode}`;
      const envelope = ActionEnvelopeSchema.parse({
        kind: "ActionEnvelope",
        envelopeVersion: ActionEnvelopeSchemaVersion,
        actionId,
        idempotencyKey: `idempotency-${source.sessionId}`,
        payloadHash: hashValue(worldCommand.payload),
        source: {
          mode: source.mode,
          assertion: "client_declared",
          surfaceId: source.surfaceId,
          interactionId: source.mode === "world_interaction"
            ? "hotspot-interviewee"
            : null,
        },
        actor: {
          principalId: "principal-student-reporter",
          bindingId: "binding-student-reporter",
          actorId: projection.role.agentId,
          actorKind: projection.role.actorKind,
          roleId: projection.role.roleId,
          teamId: projection.role.teamId,
          sessionEpoch: projection.sessionEpoch,
        },
        objectRefs: [{
          objectType: "world_state",
          objectId: source.sessionId,
          version: String(projection.stateVersion),
        }],
        causality: {
          rootActionId: actionId,
          causationId: actionId,
          parentActionId: null,
          causationEventIds: [],
          causalDepth: 0,
        },
        evidence: {
          evidenceRefs: [],
          citationRefs: [],
          toolResultRefs: [],
        },
        command: worldCommand,
      });
      await engine.executeAction(envelope);
      await engine.executeAction({
        ...envelope,
        source: {
          ...envelope.source,
          mode: source.mode === "world_interaction"
            ? "course_platform"
            : "world_interaction",
          surfaceId: "second-student-surface",
        },
      });
      await expect(engine.executeAction({
        ...envelope,
        payloadHash: "0".repeat(64),
      })).rejects.toBeInstanceOf(InvalidWorldActionError);
      await expect(engine.executeAction({
        ...envelope,
        actor: {
          ...envelope.actor,
          teamId: "team-forged",
        },
      })).rejects.toBeInstanceOf(PermissionDeniedError);
    }

    const actionEvents = await Promise.all(sessions.map(async (source) => (
      (await store.load(source.sessionId)).filter(
        (event) => event.actionContext?.actionId === `action-${source.mode}`,
      )
    )));
    expect(actionEvents.map((events) => events.map((event) => event.eventType))).toEqual([
      ["role_interaction_requested", "role_message_posted"],
      ["role_interaction_requested", "role_message_posted"],
    ]);
    expect(actionEvents.map((events) => events[0]?.actionContext?.sourceMode)).toEqual([
      "course_platform",
      "world_interaction",
    ]);
    expect(actionEvents.every((events) => (
      events.every((event) => (
        event.actionContext?.commandName === "send_role_interaction"
        && !JSON.stringify(event.actionContext).includes("reporter-interview-process")
      ))
    ))).toBe(true);
  });

  it("fails closed when an agent task crosses its pinned instance boundary", async () => {
    const scenario = structuredClone(demoScenario);
    scenario.interactionGates = [];
    const engine = new WorldEngine({
      ids: sequenceIds(),
      clock: fixedClock(),
      scenario,
    });
    const sessionId = "session-instance-boundary";
    await engine.createSession(sessionId, true);
    const student = await engine.getProjection(sessionId, "student-editor");
    await engine.execute(command(
      sessionId,
      "student-editor",
      "inspect_material",
      student.stateVersion,
    ));
    const state = await engine.getStateSnapshot(sessionId);
    const activeScenario = state.scenario;
    const role = activeScenario.roles.find(
      (candidate) => candidate.agentId === "agent-fact-checker",
    )!;
    const trigger = (await engine.store.load(sessionId)).findLast(
      (event) => event.eventType === "material_observed",
    )!;
    const task = AgentTaskSchema.parse({
      taskId: "task-instance-boundary",
      outboxId: "outbox-instance-boundary",
      subscriptionId: "fact-checker/material-observed/v1",
      agentId: role.agentId,
      roleId: role.roleId,
      templateRef: {
        templateId: "template:agent-fact-checker",
        templateVersion: "fact-checker/1.2.0",
      },
      instanceRef: {
        instanceId: `${sessionId}:${state.sessionEpoch}:${role.agentId}`,
        instanceVersion: "fact-checker/1.2.0",
      },
      instanceContext: {
        bindingKind: "teacher_assistant",
        bindingId:
          `role-binding:${activeScenario.courseId}:${role.roleId}:${role.agentId}`,
        actorId: role.agentId,
        actorKind: role.actorKind,
        courseId: activeScenario.courseId,
        teamId: role.teamId,
        privateMemoryNamespaceRef: roleMemoryNamespace({
          sessionId,
          sessionEpoch: state.sessionEpoch,
          teamId: role.teamId,
          actorId: role.agentId,
        }),
        configHash: roleBindingConfigHash({
          scenarioId: activeScenario.scenarioId,
          scenarioVersion: activeScenario.version,
          role,
        }),
        lifecycle: "active",
      },
      definitionVersion: "fact-checker/1.2.0",
      promptVersion: "1.2.0",
      sessionId,
      sessionEpoch: state.sessionEpoch,
      sceneId: activeScenario.scenarioId,
      triggerEventId: trigger.eventId,
      triggerEventType: trigger.eventType,
      expectedStateVersion: state.stateVersion,
      priority: 100,
      correlationId: trigger.correlationId,
      causalDepth: 0,
      actionContext: trigger.actionContext,
      experimentObservation: null,
      dispatchDecision: {
        decisionId: "decision-instance-boundary",
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
      idempotencyKey: "instance-boundary-idempotency",
      status: "queued",
      attempts: 0,
      maxAttempts: 3,
      availableAt: trigger.timestamp,
      lease: null,
      lastErrorCode: null,
      createdAt: trigger.timestamp,
      updatedAt: trigger.timestamp,
      completedAt: null,
    });

    await expect(engine.getAgentTaskProjection(task)).resolves.toMatchObject({
      actorId: role.agentId,
      role: { roleId: role.roleId },
    });
    await expect(engine.getAgentTaskProjection({
      ...task,
      instanceContext: {
        ...task.instanceContext,
        privateMemoryNamespaceRef: "forged-private-namespace",
      },
    })).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("enforces role permissions and private event visibility", async () => {
    const engine = new WorldEngine({ ids: sequenceIds(), clock: fixedClock() });
    const sessionId = "session-test-permission";
    await engine.createSession(sessionId, true);
    const student = await engine.getProjection(sessionId, "student-editor");
    const reporter = await engine.getProjection(sessionId, "student-reporter");
    const sceneDirector = await engine.getProjection(sessionId, "agent-scene-director");
    expect(student.roleMessages.some((item) => item.content.includes("等待责任编辑"))).toBe(true);
    expect(reporter.roleMessages.some((item) => item.content.includes("等待责任编辑"))).toBe(false);
    expect(reporter.recentEvents.some((event) => (
      event.eventType === "material_registered"
      && (event.payload.material as { materialId?: string } | undefined)?.materialId === "material-license-note"
    ))).toBe(false);
    expect(sceneDirector.recentEvents.some((event) => (
      event.eventType === "role_assigned"
      && (event.payload as { agentId?: string }).agentId === "teacher-main"
    ))).toBe(false);
    expect((await engine.store.load(sessionId)).every((event) => event.audience)).toBe(true);

    await expect(
      engine.execute(command(sessionId, "student-editor", "approve_candidate_event", student.stateVersion)),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("enforces assigned-team audience for role events in a multi-team scenario fixture", async () => {
    const scenario = structuredClone(demoScenario);
    const reporter = scenario.roles.find((role) => role.agentId === "student-reporter");
    if (!reporter) throw new Error("测试情境缺少记者角色");
    reporter.teamId = "team-river-02";
    const engine = new WorldEngine({
      scenario,
      ids: sequenceIds(),
      clock: fixedClock(),
    });
    const sessionId = "session-team-boundary";
    await engine.createSession(sessionId, true);

    const studentProjection = await engine.getProjection(sessionId, "student-editor");
    const reporterProjection = await engine.getProjection(sessionId, "student-reporter");
    const hasReporterAssignment = (events: WorldEvent[]) => events.some((event) => (
      event.eventType === "role_assigned"
      && (event.payload as { agentId?: string }).agentId === "student-reporter"
    ));
    expect(hasReporterAssignment(studentProjection.recentEvents)).toBe(false);
    expect(hasReporterAssignment(reporterProjection.recentEvents)).toBe(true);
  });

  it("publishes only after durable append", async () => {
    const bus = new InProcessMessageBus();
    const received: number[] = [];
    bus.subscribe("session-test-bus", (event) => {
      received.push(event.stateVersion);
    });
    const engine = new WorldEngine({ bus, ids: sequenceIds(), clock: fixedClock() });
    await engine.createSession("session-test-bus", true);
    expect(received.length).toBeGreaterThan(10);
    expect(received).toEqual([...received].sort((left, right) => left - right));
  });

  it("refuses same-version scenario content mutation by its pinned release hash", async () => {
    const store = new InMemoryEventStore();
    const source = new WorldEngine({
      store,
      ids: sequenceIds(),
      clock: fixedClock(),
    });
    const sessionId = "session-scenario-version";
    await source.createSession(sessionId, true);
    const changedScenario = structuredClone(demoScenario);
    changedScenario.title = "同版本被篡改的标题";
    const replay = new WorldEngine({ store, scenario: changedScenario });

    await expect(replay.getProjection(sessionId, "student-editor"))
      .rejects.toBeInstanceOf(ScenarioVersionMismatchError);
  });

  it("restores pre-hash sessions only through an explicitly registered legacy snapshot", async () => {
    const sourceStore = new InMemoryEventStore();
    const source = new WorldEngine({
      store: sourceStore,
      scenario: legacyDemoScenarioV041,
      ids: sequenceIds(),
      clock: fixedClock(),
    });
    const sessionId = "session-legacy-scenario-ref";
    await source.createSession(sessionId, true);
    const legacyEvents = structuredClone(await sourceStore.load(sessionId));
    const started = legacyEvents.find((event) => event.eventType === "session_started");
    if (!started) throw new Error("测试会话缺少 session_started");
    delete started.payload.scenarioRef;
    delete started.payload.compilerVersion;

    const legacyStore = new InMemoryEventStore();
    await legacyStore.append(
      sessionId,
      0,
      legacyEvents,
      await sourceStore.loadOutbox(sessionId),
    );

    const release = createStaticScenarioRelease({
      releaseId: "release-scenario-local-tourism-media-v0.1-0.4.1-baseline",
      package: legacyDemoScenarioV041,
    });
    expect(release.ref.contentHash).toBe(demoScenarioV041LegacyContentHash);

    const unregistered = new WorldEngine({
      store: legacyStore,
      defaultRelease: release,
    });
    await expect(unregistered.getProjection(sessionId, "student-editor"))
      .rejects.toThrow("旧会话情境版本无法解析");

    const registered = new WorldEngine({
      store: legacyStore,
      defaultRelease: release,
      scenarioResolver: new StaticScenarioReleaseResolver([release], [release.ref]),
    });
    const projection = await registered.getProjection(sessionId, "student-editor");
    expect(projection.scenario.contentHash).toBe(demoScenarioV041LegacyContentHash);
  });

  it("keeps the V0.5.1 release hash stable and replays its sessions through the registered snapshot", async () => {
    const store = new InMemoryEventStore();
    const legacyRelease = createStaticScenarioRelease({
      releaseId: "release-scenario-local-tourism-media-v0.1-0.5.1-baseline",
      package: legacyDemoScenarioV051,
    });
    const currentRelease = createStaticScenarioRelease({
      releaseId: "release-scenario-local-tourism-media-v0.1-1.0.0-current",
      package: demoScenario,
    });
    expect(legacyRelease.ref.contentHash).toBe(demoScenarioV051ContentHash);

    const source = new WorldEngine({
      store,
      defaultRelease: legacyRelease,
      scenarioResolver: new StaticScenarioReleaseResolver(
        [legacyRelease, currentRelease],
        [legacyRelease.ref, currentRelease.ref],
      ),
      ids: sequenceIds(),
      clock: fixedClock(),
    });
    const sessionId = "session-v0-5-1-snapshot";
    await source.createSession(sessionId, true);

    const replay = new WorldEngine({
      store,
      defaultRelease: currentRelease,
      scenarioResolver: new StaticScenarioReleaseResolver(
        [legacyRelease, currentRelease],
        [legacyRelease.ref, currentRelease.ref],
      ),
    });
    const projection = await replay.getProjection(sessionId, "student-editor");
    expect(projection.scenario.version).toBe("0.5.1");
    expect(projection.scenario.contentHash).toBe(demoScenarioV051ContentHash);
  });

  it("keeps the V0.6.0 production release hash stable while V0.7.0 adds evaluation", async () => {
    const store = new InMemoryEventStore();
    const productionRelease = createStaticScenarioRelease({
      releaseId: "release-scenario-local-tourism-media-v0.1-0.6.0-baseline",
      package: legacyDemoScenarioV060,
    });
    const currentRelease = createStaticScenarioRelease({
      releaseId: "release-scenario-local-tourism-media-v0.1-0.7.0-current",
      package: legacyDemoScenarioV070,
    });
    expect(productionRelease.ref.contentHash).toBe(
      demoScenarioV060ContentHash,
    );
    expect(currentRelease.ref.contentHash).not.toBe(
      productionRelease.ref.contentHash,
    );
    const source = new WorldEngine({
      store,
      defaultRelease: productionRelease,
      scenarioResolver: new StaticScenarioReleaseResolver(
        [productionRelease, currentRelease],
        [productionRelease.ref, currentRelease.ref],
      ),
      ids: sequenceIds(),
      clock: fixedClock(),
    });
    const sessionId = "session-v0-6-0-snapshot";
    await source.createSession(sessionId, true);
    const replay = new WorldEngine({
      store,
      defaultRelease: currentRelease,
      scenarioResolver: new StaticScenarioReleaseResolver(
        [productionRelease, currentRelease],
        [productionRelease.ref, currentRelease.ref],
      ),
    });
    const projection = await replay.getProjection(
      sessionId,
      "student-editor",
    );
    expect(projection.scenario.version).toBe("0.6.0");
    expect(projection.scenario.contentHash).toBe(
      demoScenarioV060ContentHash,
    );
    expect(projection.productionConfig?.governancePlan).toBeUndefined();
  });

  it("keeps the V0.6.1 governance snapshot immutable when V0.7.0 becomes current", async () => {
    const legacyRelease = createStaticScenarioRelease({
      releaseId: "release-scenario-local-tourism-media-v0.1-0.6.1-baseline",
      package: legacyDemoScenarioV061,
    });
    const currentRelease = createStaticScenarioRelease({
      releaseId: "release-scenario-local-tourism-media-v0.1-0.7.0-current",
      package: legacyDemoScenarioV070,
    });
    expect(legacyRelease.ref.contentHash).toBe(demoScenarioV061ContentHash);
    expect(currentRelease.ref.contentHash).toBe(demoScenarioV070ContentHash);
    expect(currentRelease.ref.contentHash).not.toBe(legacyRelease.ref.contentHash);
  });

  it("keeps V0.7.0 immutable while V1.0.0 adds a role-filtered course guide", async () => {
    const legacyRelease = createStaticScenarioRelease({
      releaseId: "release-scenario-local-tourism-media-v0.1-0.7.0-baseline",
      package: legacyDemoScenarioV070,
    });
    const currentRelease = createStaticScenarioRelease({
      releaseId: "release-scenario-local-tourism-media-v0.1-1.0.0-current",
      package: demoScenario,
    });
    expect(legacyRelease.ref.contentHash).toBe(demoScenarioV070ContentHash);
    expect(currentRelease.ref.contentHash).toBe(demoScenarioV100ContentHash);
    expect(currentRelease.ref.contentHash).not.toBe(legacyRelease.ref.contentHash);

    const engine = new WorldEngine({
      store: new InMemoryEventStore(),
      defaultRelease: currentRelease,
      scenarioResolver: new StaticScenarioReleaseResolver(
        [legacyRelease, currentRelease],
        [legacyRelease.ref, currentRelease.ref],
      ),
      ids: sequenceIds(),
      clock: fixedClock(),
    });
    const sessionId = "session-v1-course-guide";
    await engine.createSession(sessionId, true);

    const editorProjection = await engine.getProjection(
      sessionId,
      "student-editor",
    );
    expect(editorProjection.scenario.version).toBe("1.0.0");
    expect(editorProjection.courseGuide?.activeRoleBrief?.roleId).toBe(
      "responsible_editor",
    );
    expect(editorProjection.courseGuide?.currentNodeGuide?.nodeId).toBe("brief");
    expect(
      editorProjection.courseGuide?.currentNodeGuide?.requiredMaterialIds,
    ).toContain("material-license-note");
    expect(JSON.stringify(editorProjection.courseGuide)).not.toContain(
      "teacherFocus",
    );
    expect(JSON.stringify(editorProjection.courseGuide)).not.toContain(
      "你是现场记者",
    );

    const reporterProjection = await engine.getProjection(
      sessionId,
      "student-reporter",
    );
    expect(reporterProjection.courseGuide?.activeRoleBrief?.roleId).toBe(
      "reporter",
    );
    expect(JSON.stringify(reporterProjection.courseGuide)).not.toContain(
      "你是本次融媒体报道的责任编辑",
    );
    expect(
      reporterProjection.courseGuide?.currentNodeGuide?.requiredMaterialIds,
    ).not.toContain("material-license-note");
  });

  it("appends an audited single-evaluator retry without mutating the failed proposal", async () => {
    const store = new InMemoryEventStore();
    const engine = new WorldEngine({
      store,
      bus: new InProcessMessageBus(),
      ids: sequenceIds(),
      clock: fixedClock(),
    });
    const sessionId = "session-evaluation-manual-retry";
    const now = "2026-07-25T10:00:00.000Z";
    const contentHash = "a".repeat(64);
    await engine.createSession(sessionId, true);
    const history = await store.load(sessionId);
    const state = await engine.getStateSnapshot(sessionId);
    const teacher = await engine.getProjection(sessionId, "teacher-main");
    let fixtureId = 0;
    const nextFixtureId = (prefix: string) => `${prefix}-fixture-${++fixtureId}`;
    const evidence: Evidence = {
      evidenceId: "evidence-retry-fixture",
      sessionId,
      nodeId: "review",
      actorId: "student-editor",
      action: "完成精确成果提交",
      basis: "固定成果修订及来源链已提交。",
      materialRefs: ["material-festival-photo"],
      eventRefs: [history.at(-1)!.eventId],
      observationRefs: [],
      artifactRevisionRefs: ["revision-retry-fixture"],
      processingTaskRefs: [],
      createdAt: now,
      visibility: ["assigned_team", "audit_only"],
    };
    const revision: ArtifactRevision = {
      revisionId: "revision-retry-fixture",
      artifactId: "artifact-retry-fixture",
      revisionNumber: 2,
      previousRevisionId: "revision-retry-fixture-r1",
      title: "地方文旅活动融媒体报道",
      summary: "用于验证单评价分支追加式重跑。",
      sections: [{
        sectionId: "lead",
        label: "导语",
        content: "经核验的报道正文。",
      }],
      citations: [],
      revisionNote: "固定 R2 评价修订。",
      contentHash,
      authorActorId: "student-editor",
      requestId: "revision-retry-request",
      createdAt: now,
      audience: {
        policyVersion: "acl/1.0.0",
        courseId: state.scenario.courseId,
        sessionId,
        sessionEpoch: state.sessionEpoch,
        scopes: ["assigned_team"],
        teamIds: ["team-editorial-01"],
        roleIds: ["responsible_editor"],
        actorIds: ["student-editor"],
        privateNamespaces: [],
        auditReadable: true,
      },
    };
    const submission: ProductionSubmission = {
      submissionId: "submission-retry-fixture",
      artifactId: revision.artifactId,
      revisionId: revision.revisionId,
      revisionNumber: revision.revisionNumber,
      evidenceRefs: [evidence.evidenceId],
      citationIds: [],
      submittedBy: "student-editor",
      requestId: "submission-retry-request",
      submittedAt: now,
    };
    const { evidenceBundle, evaluationCase } = createEvaluationCase({
      nextId: nextFixtureId,
      now,
      sessionEpoch: state.sessionEpoch,
      openedFromMessageId: "message-retry-fixture",
      submission,
      revision,
      rubricId: state.scenario.rubricId,
      rubricVersion: state.scenario.rubricVersion,
      rubric: state.scenario.rubric,
      evidence: [evidence],
      events: history,
      scenarioReleaseId: teacher.scenario.releaseId,
      scenarioContentHash: teacher.scenario.contentHash,
    });
    const ruleProposal = createRuleEvaluationProposal({
      nextId: nextFixtureId,
      now,
      evaluationCase,
      evidenceBundle,
      rubric: state.scenario.rubric,
      evidence: [evidence],
      events: history,
    });
    const unavailableProposal = createUnavailableEvaluationProposal({
      nextId: nextFixtureId,
      now,
      evaluationCase,
      evidenceBundle,
      evaluatorKind: "work_quality",
      definitionVersion: "evaluation-semantic/1.0.0",
      promptVersion: "evaluation-semantic/1.0.0",
      errorCode: "fixture_model_unavailable",
    });
    const arbitration = arbitrateEvaluationProposals({
      nextId: nextFixtureId,
      now,
      evaluationCase,
      proposals: [ruleProposal, unavailableProposal],
    });
    const fixtureEvents = [
      {
        eventType: "evaluation_case_opened" as const,
        actorId: "system",
        summary: "测试固定评价案件",
        visibility: ["role_private", "audit_only"] as const,
        visibleToActorIds: ["agent-work-quality-assessor"],
        payload: { evaluationCase, evidenceBundle },
      },
      {
        eventType: "evaluation_proposal_recorded" as const,
        actorId: "system",
        summary: "测试规则意见",
        visibility: ["teacher_only", "audit_only"] as const,
        visibleToActorIds: [],
        payload: { proposal: ruleProposal },
      },
      {
        eventType: "evaluation_proposal_recorded" as const,
        actorId: "agent-work-quality-assessor",
        summary: "测试不可用意见",
        visibility: ["teacher_only", "audit_only"] as const,
        visibleToActorIds: [],
        payload: { proposal: unavailableProposal },
      },
      {
        eventType: "evaluation_arbitrated" as const,
        actorId: "system",
        summary: "测试降级仲裁",
        visibility: ["teacher_only", "audit_only"] as const,
        visibleToActorIds: [],
        payload: { arbitration },
      },
    ].map((draft, index) => {
      const timestamp = new Date(Date.parse(now) + index * 1_000).toISOString();
      return WorldEventSchema.parse({
        ...createMessageMeta({
          sessionId,
          sceneId: state.scenario.scenarioId,
          actorId: draft.actorId,
          correlationId: "fixture-evaluation-retry",
          timestamp,
        }),
        kind: "WorldEvent",
        eventId: `event-evaluation-retry-fixture-${index + 1}`,
        eventType: draft.eventType,
        stateVersion: state.stateVersion + index + 1,
        visibility: [...draft.visibility],
        visibleToActorIds: draft.visibleToActorIds,
        summary: draft.summary,
        payload: draft.payload,
      });
    });
    const fixtureOutbox = fixtureEvents.map<OutboxRecord>((event, index) => ({
      outboxId: `outbox-evaluation-retry-fixture-${index + 1}`,
      sessionId,
      sessionEpoch: state.sessionEpoch,
      sceneId: event.sceneId,
      eventId: event.eventId,
      eventType: event.eventType,
      stateVersion: event.stateVersion,
      correlationId: event.correlationId,
      topic: "world_event",
      causalDepth: 0,
      status: "pending",
      attempts: 0,
      availableAt: event.timestamp,
      createdAt: event.timestamp,
      deliveredAt: null,
      lastErrorCode: null,
    }));
    await store.append(
      sessionId,
      state.stateVersion,
      fixtureEvents,
      fixtureOutbox,
    );

    const beforeRetry = await engine.getProjection(sessionId, "teacher-main");
    expect(beforeRetry.retryableEvaluationBranches).toEqual([
      expect.objectContaining({
        evaluationCaseId: evaluationCase.evaluationCaseId,
        evaluatorKind: "work_quality",
        unavailableProposalId: unavailableProposal.proposalId,
        status: "ready",
        manualRetryCount: 0,
        maximumManualRetries: 3,
        latestRetryEventId: null,
      }),
    ]);
    await expect(
      engine.getProjection(sessionId, "student-editor"),
    ).resolves.toMatchObject({
      retryableEvaluationBranches: [],
      retryableLearningGenerationFailures: [],
    });
    const payload = {
      evaluationCaseId: evaluationCase.evaluationCaseId,
      evaluatorKind: "work_quality",
      expectedCaseHash: evaluationCase.caseHash,
      expectedEvidenceBundleHash: evidenceBundle.bundleHash,
      expectedUnavailableProposalId: unavailableProposal.proposalId,
      expectedUnavailableProposalHash: unavailableProposal.proposalHash,
      expectedArbitrationRevision: arbitration.revision,
      expectedDecisionHash: arbitration.decisionHash,
      requestId: "manual-evaluation-retry-1",
    };
    await expect(engine.execute(command(
      sessionId,
      "teacher-main",
      "retry_evaluation_branch",
      beforeRetry.stateVersion,
      { ...payload, expectedCaseHash: "0".repeat(64) },
    ))).rejects.toBeInstanceOf(DomainRevisionConflictError);
    await expect(engine.execute(command(
      sessionId,
      "student-editor",
      "retry_evaluation_branch",
      beforeRetry.stateVersion,
      payload,
    ))).rejects.toBeInstanceOf(PermissionDeniedError);

    const afterRetry = await engine.execute(command(
      sessionId,
      "teacher-main",
      "retry_evaluation_branch",
      beforeRetry.stateVersion,
      payload,
    ));
    const retryEvent = (await store.load(sessionId)).findLast((event) => (
      event.eventType === "evaluation_branch_retry_requested"
    ));
    expect(retryEvent).toMatchObject({
      actorId: "teacher-main",
      visibleToActorIds: ["agent-work-quality-assessor"],
      payload: {
        evaluatorKind: "work_quality",
        targetAgentId: "agent-work-quality-assessor",
        expectedUnavailableProposalId: unavailableProposal.proposalId,
        manualRetryAttempt: 1,
      },
    });
    expect(retryEvent?.payload.evaluationCase).toEqual(evaluationCase);
    expect(retryEvent?.payload.evidenceBundle).toEqual(evidenceBundle);
    expect(afterRetry.evaluationProposals).toContainEqual(
      unavailableProposal,
    );
    expect(afterRetry.retryableEvaluationBranches).toEqual([
      expect.objectContaining({
        unavailableProposalId: unavailableProposal.proposalId,
        status: "in_flight",
        manualRetryCount: 1,
        latestRetryEventId: retryEvent?.eventId,
      }),
    ]);

    const eventsAfterFirstRetry = (await store.load(sessionId)).length;
    await engine.execute(command(
      sessionId,
      "teacher-main",
      "retry_evaluation_branch",
      afterRetry.stateVersion,
      payload,
    ));
    expect((await store.load(sessionId))).toHaveLength(eventsAfterFirstRetry);
    await expect(engine.execute(command(
      sessionId,
      "teacher-main",
      "retry_evaluation_branch",
      afterRetry.stateVersion,
      { ...payload, requestId: "manual-evaluation-retry-2" },
    ))).rejects.toBeInstanceOf(InvalidWorldActionError);
  });
});
