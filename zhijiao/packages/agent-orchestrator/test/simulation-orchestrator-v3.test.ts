import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ChallengeAssignmentSchemaVersion,
  StudentWorkActionSchemaVersion,
  type ChallengeAssignment,
  type StudentWorkAction,
} from "@ronggang/contracts";
import { getXunpuWorldSimulationReleaseV3 } from "@ronggang/course-content";
import {
  InMemorySimulationSessionStore,
  JsonFileSimulationSessionStore,
  WorldSimulationEngineV3,
} from "@ronggang/world-core";
import {
  InMemorySimulationCollaborationStoreV3,
  JsonFileSimulationCollaborationStoreV3,
  SimulationAgentOrchestratorV3,
  buildXunpuSimulationAgentTemplatesV3,
  createXunpuDeterministicSimulationExecutorsV3,
  type SimulationCollaborationStoreV3,
} from "../src/index.js";

function sequentialIds(namespace: string): (prefix: string) => string {
  let value = 0;
  return (prefix) => `${prefix}-${namespace}-${++value}`;
}

const now = () => "2026-08-26T03:01:00.000Z";

function assignment(sessionId: string): ChallengeAssignment {
  const release = getXunpuWorldSimulationReleaseV3();
  return {
    schemaVersion: ChallengeAssignmentSchemaVersion,
    challengeAssignmentId: `challenge-${sessionId}`,
    learnerTwinRef: `learner-twin-${sessionId}`,
    sessionId,
    simulationReleaseRef: release.simulationReleaseRef,
    worldVariantRef: "world-variant-level-5",
    previousChallengeLevel: 4,
    challengeLevel: 5,
    scoreCeiling: 90,
    pressureDimensions: [
      { dimensionId: "time", intensity: 5 },
      { dimensionId: "source_access", intensity: 5 },
      { dimensionId: "relationship_conflict", intensity: 4 },
    ],
    assignmentReason: "evidence_progression",
    basisEvidenceRefs: ["evidence-prior-performance"],
    forecastRef: `forecast-${sessionId}`,
    teacherOverride: null,
    policyVersion: "challenge-policy/1.0.0",
    policyContentHash: "d".repeat(64),
    assignedAt: "2026-08-26T03:00:00.000Z",
  };
}

function studentAsk(sessionId: string): StudentWorkAction {
  return {
    schemaVersion: StudentWorkActionSchemaVersion,
    workActionId: `work-action-${sessionId}`,
    serverIssuedActionRef: "server-action-ask-gatekeeper",
    sessionId,
    bindingId: "binding-student-reporter",
    actorId: "actor-student-reporter",
    primaryRoleId: "reporter",
    expectedWorldStateVersion: 0,
    action: {
      verb: "ask",
      targetRef: { objectType: "entity", objectId: "entity-gatekeeper" },
      utterance: "您好，我是学生记者。我不会进入私人住宅，想先了解今天可采访的公共区域。",
    },
    sourceWorldEventIds: [],
    reflectionNote: "先说明职业身份、采访目的与边界。",
    submissionStatus: "accepted",
    createdAt: "2026-08-26T03:00:10.000Z",
  };
}

async function start(
  engine: WorldSimulationEngineV3,
  sessionId: string,
): Promise<void> {
  await engine.startSession({
    sessionId,
    release: getXunpuWorldSimulationReleaseV3(),
    challengeAssignment: assignment(sessionId),
    targetCompetencyRefs: [
      "competency-professional-communication",
      "competency-source-verification",
    ],
    scaffoldingLevel: 1,
    startedAt: "2026-08-26T03:00:00.000Z",
  });
}

function orchestrator(
  engine: WorldSimulationEngineV3,
  store: SimulationCollaborationStoreV3 =
    new InMemorySimulationCollaborationStoreV3(),
  namespace = "orchestrator",
  executors = createXunpuDeterministicSimulationExecutorsV3(),
): SimulationAgentOrchestratorV3 {
  return new SimulationAgentOrchestratorV3({
    engine,
    store,
    templates: buildXunpuSimulationAgentTemplatesV3(),
    executors,
    maxSelectedAgents: 5,
    now,
    monotonicNowMs: (() => {
      let value = 100;
      return () => value += 5;
    })(),
    idFactory: sequentialIds(namespace),
  });
}

describe("SimulationAgentOrchestratorV3", () => {
  it("returns one compact waiting state when the world has no event", async () => {
    const engine = new WorldSimulationEngineV3({
      store: new InMemorySimulationSessionStore(),
      now,
      idFactory: sequentialIds("waiting-world"),
    });
    const sessionId = "session-waiting-v3";
    await start(engine, sessionId);

    const views = await orchestrator(engine).prepareNextEpisode(sessionId);

    expect(views.student.status).toBe("waiting");
    expect(views.teacher).toMatchObject({
      status: "waiting",
      dispatchPlan: null,
      contributions: [],
    });
    expect(views.admin.execution.executionMode).toBe("deterministic_demo");
  });

  it("materializes a real affected-set Task -> Run -> Intent chain and commits accepted student choice", async () => {
    const engine = new WorldSimulationEngineV3({
      store: new InMemorySimulationSessionStore(),
      now,
      idFactory: sequentialIds("accepted-world"),
    });
    const sessionId = "session-accepted-v3";
    await start(engine, sessionId);
    await engine.submitStudentAction({
      action: studentAsk(sessionId),
      eventTemplateId: "event-template-gatekeeper",
      requestId: "request-ask-gatekeeper",
    });
    const service = orchestrator(engine, undefined, "accepted-agent");

    const prepared = await service.prepareNextEpisode(sessionId);
    expect(prepared.student).toMatchObject({
      status: "suggestion_ready",
      suggestion: {
        displayName: "林师傅·社区门卫",
        provenanceVerified: true,
      },
    });
    expect(prepared.teacher.dispatchPlan?.decisions).toHaveLength(14);
    expect(prepared.teacher.dispatchPlan).toMatchObject({
      selectedCount: 1,
      skippedCount: 13,
    });
    expect(prepared.teacher.contributions).toHaveLength(1);
    const contribution = prepared.teacher.contributions[0]!;
    const record = await service.getRecord(sessionId);
    expect(record.tasks.some((task) => task.agentTaskId === contribution.agentTaskId))
      .toBe(true);
    expect(record.runs.some((run) => run.agentRunId === contribution.agentRunId))
      .toBe(true);
    expect(record.observations.some(
      (observation) => observation.observationId === contribution.observationId,
    )).toBe(true);
    expect(record.intents.some((intent) => intent.intentId === contribution.intentId))
      .toBe(true);
    expect(record.agentStates[0]).toMatchObject({
      visibility: "server_private",
      remainingActionBudget: 11,
    });

    const studentJson = JSON.stringify(prepared.student);
    const teacherJson = JSON.stringify(prepared.teacher);
    for (const forbidden of [
      "privateMemory",
      "promptTemplateRefs",
      "traceRefs",
      "providerId",
      "modelId",
    ]) {
      expect(studentJson).not.toContain(forbidden);
      expect(teacherJson).not.toContain(forbidden);
    }
    expect(prepared.admin.execution).toMatchObject({
      executionMode: "deterministic_demo",
      providerId: null,
      modelId: null,
      failedAgentIds: [],
    });
    expect(prepared.admin.execution.traceRefs).toHaveLength(1);

    await service.recordStudentDecision({
      sessionId,
      episodeId: prepared.student.episodeId,
      decisionRef: "student-decision-accept-gatekeeper",
      decision: "accept",
      rationale: "接受条件准入，先在公共巷口采访并继续尊重居民隐私。",
    });
    const completed = await service.resolveAcceptedEpisode(
      sessionId,
      prepared.student.episodeId,
    );
    expect(completed.student.status).toBe("completed");
    expect(completed.student.studentDecision?.rationaleSource).toBe("student_submitted");
    const legacyRecord = await service.getRecord(sessionId);
    const legacyDecision = legacyRecord.episodes.find(
      (item) => item.episodeId === prepared.student.episodeId,
    )!.studentDecision!;
    delete legacyDecision.rationaleSource;
    const legacyStore = new InMemorySimulationCollaborationStoreV3();
    await legacyStore.create(legacyRecord);
    const legacyService = orchestrator(engine, legacyStore, "legacy-provenance");
    const legacyView = await legacyService.getCurrentEpisode(sessionId);
    expect(legacyView.student.studentDecision?.rationaleSource).toBe("legacy_unspecified");
    expect(legacyView.student.studentDecision?.rationale).toBe(legacyDecision.rationale);
    expect((await legacyStore.load(sessionId))?.episodes[0]?.studentDecision?.rationaleSource)
      .toBeUndefined();

    expect(completed.student.consequence).toMatchObject({
      status: "committed",
      resultingStateVersion: 1,
    });
    const world = await engine.getRecord(sessionId);
    expect(world.currentSnapshot.stateVersion).toBe(1);
    expect(world.currentSnapshot.variables.find(
      (variable) => variable.variableId === "community_trust",
    )?.after).toBe(52);
    expect(world.currentSnapshot.facts.find(
      (fact) => fact.factId === "fact-access-condition",
    )?.status).toBe("confirmed");
  });

  it.each(["request_evidence", "reject"] as const)(
    "keeps the world unchanged after a %s decision",
    async (decision) => {
      const engine = new WorldSimulationEngineV3({
        store: new InMemorySimulationSessionStore(),
        now,
        idFactory: sequentialIds(`zero-world-${decision}`),
      });
      const sessionId = `session-zero-${decision}`;
      await start(engine, sessionId);
      await engine.submitStudentAction({
        action: studentAsk(sessionId),
        eventTemplateId: "event-template-gatekeeper",
        requestId: `request-${decision}`,
      });
      const service = orchestrator(engine, undefined, `zero-agent-${decision}`);
      const prepared = await service.prepareNextEpisode(sessionId);
      const decided = await service.recordStudentDecision({
        sessionId,
        episodeId: prepared.student.episodeId,
        decisionRef: `student-decision-${decision}`,
        decision,
        rationale: decision === "reject"
          ? "拒绝该处理方式，准备重新组织沟通方案。"
          : "先请求更具体的准入边界依据。",
      });

      expect(decided.student.status).toBe("decided");
      expect(decided.student.consequence).toBeNull();
      await expect(service.resolveAcceptedEpisode(
        sessionId,
        prepared.student.episodeId,
      )).rejects.toThrow("保持零世界写回");
      const world = await engine.getRecord(sessionId);
      expect(world.currentSnapshot.stateVersion).toBe(0);
      expect(world.queue[0]?.status).toBe("rejected");
      expect(world.consequences).toEqual([]);

      await engine.submitStudentAction({
        action: {
          ...studentAsk(sessionId),
          workActionId: `work-action-followup-${decision}`,
          serverIssuedActionRef: `server-action-followup-${decision}`,
        },
        eventTemplateId: "event-template-gatekeeper",
        requestId: `request-followup-${decision}`,
      });
      const followup = await service.prepareNextEpisode(sessionId);
      expect(followup.student.status).toBe("suggestion_ready");
      expect(followup.student.episodeId).not.toBe(prepared.student.episodeId);
    },
  );

  it("dispatches a proactive NPC conflict to only the affected world actor and editor", async () => {
    const engine = new WorldSimulationEngineV3({
      store: new InMemorySimulationSessionStore(),
      now,
      idFactory: sequentialIds("npc-world"),
    });
    const sessionId = "session-proactive-npc";
    await start(engine, sessionId);
    await engine.enqueueNpcEvent({
      sessionId,
      eventTemplateId: "event-template-shopkeeper",
      sourceRef: "npc-intent-shopkeeper-placement",
      requestId: "request-npc-shopkeeper",
      expectedWorldStateVersion: 0,
    });
    const service = orchestrator(engine, undefined, "npc-agent");
    const prepared = await service.prepareNextEpisode(sessionId);

    expect(prepared.student.triggerEvent?.sourceKind).toBe("npc_intent");
    expect(prepared.student.suggestion?.displayName).toBe("陈编辑·责任编辑");
    expect(prepared.teacher.dispatchPlan).toMatchObject({ selectedCount: 2 });
    expect(new Set(prepared.teacher.contributions.map(
      (contribution) => contribution.agentId,
    ))).toEqual(new Set(["agent-shopkeeper", "agent-editor"]));
    expect(prepared.teacher.dispatchPlan?.decisions.filter(
      (item) => item.decision === "skipped",
    ).every((item) => item.reason.length > 0)).toBe(true);
  });

  it("keeps high-risk NPC effects behind a real teacher gate", async () => {
    const engine = new WorldSimulationEngineV3({
      store: new InMemorySimulationSessionStore(),
      now,
      idFactory: sequentialIds("gate-world"),
    });
    const sessionId = "session-high-risk-gate";
    await start(engine, sessionId);
    await engine.enqueueNpcEvent({
      sessionId,
      eventTemplateId: "event-template-visual-consent",
      sourceRef: "npc-intent-withdraw-consent",
      requestId: "request-withdraw-consent",
      expectedWorldStateVersion: 0,
    });
    const service = orchestrator(engine, undefined, "gate-agent");
    const prepared = await service.prepareNextEpisode(sessionId);
    await service.recordStudentDecision({
      sessionId,
      episodeId: prepared.student.episodeId,
      decisionRef: "student-decision-withhold-visual",
      decision: "accept",
      rationale: "接受停用近景并改用远景或重新授权。",
    });
    const pending = await service.resolveAcceptedEpisode(
      sessionId,
      prepared.student.episodeId,
    );

    expect(pending.teacher.status).toBe("awaiting_gate");
    expect(pending.teacher.teacherGate?.status).toBe("pending");
    expect(pending.student.status).toBe("decided");
    expect((await engine.getSnapshot(sessionId)).stateVersion).toBe(0);

    const approved = await service.decideTeacherGate({
      sessionId,
      episodeId: prepared.student.episodeId,
      decision: "approved",
      teacherDecisionRef: "teacher-decision-withhold-approved",
      revisionPolicy: null,
      revisedConsequenceSummary: null,
    });
    expect(approved.teacher.status).toBe("completed");
    expect(approved.teacher.teacherGate?.status).toBe("approved");
    expect(approved.student.consequence?.resultingStateVersion).toBe(1);
  });

  it("degrades explicitly on executor failure and never mutates the world", async () => {
    const engine = new WorldSimulationEngineV3({
      store: new InMemorySimulationSessionStore(),
      now,
      idFactory: sequentialIds("failed-world"),
    });
    const sessionId = "session-agent-failure";
    await start(engine, sessionId);
    await engine.submitStudentAction({
      action: studentAsk(sessionId),
      eventTemplateId: "event-template-gatekeeper",
      requestId: "request-agent-failure",
    });
    const service = orchestrator(
      engine,
      undefined,
      "failed-agent",
      new Map(),
    );
    const views = await service.prepareNextEpisode(sessionId);

    expect(views.student).toMatchObject({
      status: "failed",
      failure: { code: "agent_execution_failed" },
      consequence: null,
    });
    expect(views.teacher).toMatchObject({
      status: "failed",
      contributions: [],
      failureCode: "agent_execution_failed",
    });
    expect(views.admin.execution).toMatchObject({
      executionMode: "degraded",
      failedAgentIds: ["agent-gatekeeper"],
    });
    expect((await engine.getSnapshot(sessionId)).stateVersion).toBe(0);
  });

  it("continues an unfinished collaboration after both stores restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ronggang-v3-orchestrator-"));
    try {
      const worldDirectory = join(directory, "world");
      const agentDirectory = join(directory, "agents");
      const firstEngine = new WorldSimulationEngineV3({
        store: new JsonFileSimulationSessionStore(worldDirectory),
        now,
        idFactory: sequentialIds("restart-world-first"),
      });
      const sessionId = "session-restart-chain";
      await start(firstEngine, sessionId);
      await firstEngine.submitStudentAction({
        action: studentAsk(sessionId),
        eventTemplateId: "event-template-gatekeeper",
        requestId: "request-restart-chain",
      });
      const first = orchestrator(
        firstEngine,
        new JsonFileSimulationCollaborationStoreV3(agentDirectory),
        "restart-agent-first",
      );
      const prepared = await first.prepareNextEpisode(sessionId);

      const secondEngine = new WorldSimulationEngineV3({
        store: new JsonFileSimulationSessionStore(worldDirectory),
        now,
        idFactory: sequentialIds("restart-world-second"),
      });
      const second = orchestrator(
        secondEngine,
        new JsonFileSimulationCollaborationStoreV3(agentDirectory),
        "restart-agent-second",
      );
      await second.recordStudentDecision({
        sessionId,
        episodeId: prepared.student.episodeId,
        decisionRef: "student-decision-after-restart",
        decision: "accept",
        rationale: "重启后继续接受条件准入。",
      });
      const completed = await second.resolveAcceptedEpisode(
        sessionId,
        prepared.student.episodeId,
      );

      expect(completed.student.status).toBe("completed");
      expect((await secondEngine.getSnapshot(sessionId)).stateVersion).toBe(1);
      const stored = await second.getRecord(sessionId);
      expect(stored.tasks).toHaveLength(1);
      expect(stored.runs).toHaveLength(1);
      expect(stored.intents).toHaveLength(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
