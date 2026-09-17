import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FlagshipRuntimeActionPolicyV4Schema } from "@ronggang/contracts";
import {
  InMemorySimulationSessionStore,
  InvalidSimulationOperationError,
  JsonFileSimulationSessionStore,
  SimulationRequestReplayError,
  SimulationTeacherGatePendingError,
  SimulationWorldEndedError,
  WorldSimulationEngineV3,
  emptySimulationRunEffects,
  type SimulationRunEffects,
} from "../src/index.js";
import {
  challengeAssignmentFixture,
  intentRunFixture,
  livingWorldReleaseFixture,
  studentAskActionFixture,
} from "./simulation-v3.fixture.js";

function sequentialIds(namespace: string): (prefix: string) => string {
  let value = 0;
  return (prefix) => `${prefix}-${namespace}-${++value}`;
}

function engineWithMemory(namespace: string): WorldSimulationEngineV3 {
  return new WorldSimulationEngineV3({
    store: new InMemorySimulationSessionStore(),
    now: () => "2026-08-26T02:01:00.000Z",
    idFactory: sequentialIds(namespace),
  });
}

async function start(
  engine: WorldSimulationEngineV3,
  sessionId: string,
): Promise<void> {
  await engine.startSession({
    sessionId,
    release: livingWorldReleaseFixture(),
    challengeAssignment: challengeAssignmentFixture(sessionId),
    targetCompetencyRefs: [
      "competency-professional-access",
      "competency-source-verification",
    ],
    scaffoldingLevel: 1,
    startedAt: "2026-08-26T02:00:00.000Z",
  });
}

function worldEffects(
  changes: Partial<SimulationRunEffects>,
): SimulationRunEffects {
  return { ...emptySimulationRunEffects(), ...changes };
}

describe("WorldSimulationEngineV3", () => {
  it("starts one immutable challenge world and stores all continuous variables", async () => {
    const engine = engineWithMemory("start");
    await start(engine, "session-start-world");

    const snapshot = await engine.getSnapshot("session-start-world");
    const record = await engine.getRecord("session-start-world");
    expect(snapshot.stateVersion).toBe(0);
    expect(snapshot.entities).toHaveLength(7);
    expect(snapshot.variables).toHaveLength(9);
    expect(snapshot.virtualTime).toMatchObject({
      elapsedMinutes: 0,
      remainingMinutes: 55,
      currentAt: "2026-08-26T02:00:00.000Z",
      deadlineAt: "2026-08-26T02:55:00.000Z",
    });
    expect(snapshot.learningContext).toMatchObject({
      challengeLevel: 5,
      scoreCeiling: 90,
      scaffoldingLevel: 1,
    });
    expect(record.queue).toEqual([]);
    expect(record.consequences).toEqual([]);
    expect(record.recordRevision).toBe(0);
  });

  it("queues accepted student work idempotently without mutating the world", async () => {
    const engine = engineWithMemory("student");
    const sessionId = "session-student-event";
    await start(engine, sessionId);
    const action = studentAskActionFixture(sessionId);

    const first = await engine.submitStudentAction({
      action,
      eventTemplateId: "event-template-gatekeeper",
      requestId: "request-student-ask-1",
    });
    const replay = await engine.submitStudentAction({
      action,
      eventTemplateId: "event-template-gatekeeper",
      requestId: "request-student-ask-1",
    });

    expect(first.replayed).toBe(false);
    expect(replay).toEqual({ event: first.event, replayed: true });
    const record = await engine.getRecord(sessionId);
    expect(record.queue).toHaveLength(1);
    expect(record.studentActions).toHaveLength(1);
    expect(record.currentSnapshot.stateVersion).toBe(0);

    await expect(engine.submitStudentAction({
      action: {
        ...action,
        reflectionNote: "伪造为同一请求的不同内容",
      },
      eventTemplateId: "event-template-gatekeeper",
      requestId: "request-student-ask-1",
    })).rejects.toBeInstanceOf(SimulationRequestReplayError);
  });

  it("recomputes serialized action policy before a direct V3 student write", async () => {
    const engine = engineWithMemory("policy");
    const sessionId = "session-policy-gate";
    const release = livingWorldReleaseFixture();
    release.actionPolicy = FlagshipRuntimeActionPolicyV4Schema.parse({
      schemaVersion: "flagship-action-policy/4.0.0",
      policyId: "policy-direct-v3",
      actions: [{
        eventTemplateId: "event-template-gatekeeper",
        requirements: {
          all: [{
            kind: "event_status",
            eventType: "student_asks_gatekeeper",
            statuses: ["committed"],
          }],
          any: [],
          none: [],
        },
        unavailableReason: "必须先完成前置事件。",
      }],
    });
    await engine.startSession({
      sessionId,
      release,
      challengeAssignment: challengeAssignmentFixture(sessionId),
      targetCompetencyRefs: ["competency-professional-access"],
      scaffoldingLevel: 1,
      startedAt: "2026-08-26T02:00:00.000Z",
    });
    await expect(engine.submitStudentAction({
      action: studentAskActionFixture(sessionId),
      eventTemplateId: "event-template-gatekeeper",
      requestId: "request-policy-gate",
    })).rejects.toThrow(/不满足发布前置条件/u);
    await expect(engine.getRecord(sessionId)).resolves.toMatchObject({
      queue: [],
      studentActions: [],
    });
  });

  it("accepts NPC, system-clock and teacher entry points with one serialized sequence", async () => {
    const engine = engineWithMemory("sources");
    const sessionId = "session-four-sources";
    await start(engine, sessionId);

    await Promise.all([
      engine.enqueueNpcEvent({
        sessionId,
        eventTemplateId: "event-template-shopkeeper",
        sourceRef: "npc-intent-shopkeeper-1",
        requestId: "request-npc-1",
        expectedWorldStateVersion: 0,
      }),
      engine.enqueueSystemClockEvent({
        sessionId,
        eventTemplateId: "event-template-clock",
        sourceRef: "clock-tick-1",
        requestId: "request-clock-1",
        expectedWorldStateVersion: 0,
      }),
      engine.enqueueTeacherIntervention({
        sessionId,
        eventTemplateId: "event-template-teacher-pause",
        sourceRef: "teacher-decision-pause-1",
        requestId: "request-teacher-1",
        expectedWorldStateVersion: 0,
      }),
    ]);

    const record = await engine.getRecord(sessionId);
    expect(record.queue.map((event) => event.sequence)).toEqual([1, 2, 3]);
    expect(new Set(record.queue.map((event) => event.sourceKind))).toEqual(
      new Set(["npc_intent", "system_clock", "teacher_intervention"]),
    );
    expect(record.nextEventSequence).toBe(4);
    await expect(engine.enqueueNpcEvent({
      sessionId,
      eventTemplateId: "event-template-clock",
      sourceRef: "npc-forged-clock",
      requestId: "request-forged-source",
      expectedWorldStateVersion: 0,
    })).rejects.toBeInstanceOf(InvalidSimulationOperationError);

    const pauseEngine = engineWithMemory("teacher-pause");
    const pauseSessionId = "session-teacher-pause";
    await start(pauseEngine, pauseSessionId);
    await pauseEngine.enqueueTeacherIntervention({
      sessionId: pauseSessionId,
      eventTemplateId: "event-template-teacher-pause",
      sourceRef: "teacher-intervention-pause",
      requestId: "request-teacher-pause",
      expectedWorldStateVersion: 0,
    });
    await pauseEngine.resolveNextEvent({
      sessionId: pauseSessionId,
      dispatchPlanId: "dispatch-teacher-pause",
      resolutionProposalId: "proposal-teacher-pause",
      expectedWorldStateVersion: 0,
      runs: [intentRunFixture({
        suffix: "teacher-pause",
        stateVersion: 0,
        intentType: "teacher_pauses_world",
        targetObjectRefs: [{
          objectType: "world_variable",
          objectId: "deadline_pressure",
        }],
        effects: worldEffects({ setPaused: true }),
      })],
      consequenceSummary: "教师暂停虚拟时钟，留出现场复盘时间。",
      evidenceIds: [],
    });
    expect((await pauseEngine.getSnapshot(pauseSessionId)).virtualTime.paused)
      .toBe(true);

    await pauseEngine.enqueueSystemClockEvent({
      sessionId: pauseSessionId,
      eventTemplateId: "event-template-clock",
      sourceRef: "clock-while-paused",
      requestId: "request-clock-while-paused",
      expectedWorldStateVersion: 1,
    });
    const pausedClock = await pauseEngine.resolveNextEvent({
      sessionId: pauseSessionId,
      dispatchPlanId: "dispatch-clock-while-paused",
      resolutionProposalId: "proposal-clock-while-paused",
      expectedWorldStateVersion: 1,
      runs: [intentRunFixture({
        suffix: "clock-while-paused",
        stateVersion: 1,
        intentType: "editor_raises_deadline",
        targetObjectRefs: [{
          objectType: "world_variable",
          objectId: "deadline_pressure",
        }],
        effects: worldEffects({ advanceMinutes: 1 }),
      })],
      consequenceSummary: "暂停中不应推进时间。",
      evidenceIds: [],
    });
    expect(pausedClock).toMatchObject({
      status: "failed",
      failure: { code: "invalid_reference" },
    });
    expect((await pauseEngine.getSnapshot(pauseSessionId)).virtualTime)
      .toMatchObject({ paused: true, elapsedMinutes: 0 });
  });

  it("deterministically accepts the higher-ranked intent and commits every effect atomically", async () => {
    const engine = engineWithMemory("resolution");
    const sessionId = "session-resolution";
    await start(engine, sessionId);
    await engine.submitStudentAction({
      action: studentAskActionFixture(sessionId),
      eventTemplateId: "event-template-gatekeeper",
      requestId: "request-gatekeeper-resolution",
    });

    const targets = [
      { objectType: "entity", objectId: "entity-gatekeeper" },
      { objectType: "world_variable", objectId: "community_trust" },
      { objectType: "fact", objectId: "fact-access-condition" },
      { objectType: "relationship", objectId: "relationship-student-gatekeeper" },
      { objectType: "resource", objectId: "resource-community-access" },
    ] as const;
    const high = intentRunFixture({
      suffix: "gatekeeper-high",
      stateVersion: 0,
      intentType: "gatekeeper_responds",
      targetObjectRefs: [...targets],
      confidence: 0.92,
      effects: worldEffects({
        variables: [{ variableId: "community_trust", delta: 8 }],
        entities: [{
          entityId: "entity-gatekeeper",
          status: "busy",
          publicSummary: "林师傅正在核验记者身份，并准备给出有条件准入。",
        }],
        facts: [{
          factId: "fact-access-condition",
          status: "corroborated",
          confidence: 0.84,
          sourceRefs: ["work-action-session-resolution"],
          visibleScopes: ["student", "teacher", "admin"],
        }],
        relationships: [{
          relationshipId: "relationship-student-gatekeeper",
          sourceEntityId: "entity-gatekeeper",
          targetEntityId: "entity-inheritor",
          trustDelta: 8,
          tensionDelta: 3,
          influenceDelta: 2,
          commitmentRefs: ["commitment-no-private-filming"],
        }],
        resources: [{
          resourceId: "resource-community-access",
          resourceKind: "access",
          amountDelta: 1,
          unit: "permission",
          visibleScopes: ["student", "teacher", "admin"],
        }],
        advanceMinutes: 3,
      }),
    });
    const lower = intentRunFixture({
      suffix: "gatekeeper-lower",
      stateVersion: 0,
      intentType: "gatekeeper_responds",
      targetObjectRefs: [{
        objectType: "world_variable",
        objectId: "community_trust",
      }],
      confidence: 0.41,
      effects: worldEffects({
        variables: [{ variableId: "community_trust", delta: -12 }],
      }),
    });

    const resolution = await engine.resolveNextEvent({
      sessionId,
      dispatchPlanId: "dispatch-gatekeeper",
      resolutionProposalId: "proposal-gatekeeper",
      expectedWorldStateVersion: 0,
      runs: [lower, high],
      consequenceSummary: "林师傅认可学生的边界说明，给予有条件准入。",
      evidenceIds: ["evidence-professional-introduction"],
    });

    expect(resolution.status).toBe("committed");
    expect(resolution.acceptedIntents.map((intent) => intent.intentId)).toEqual([
      "intent-gatekeeper-high",
    ]);
    expect(resolution.skippedIntents).toEqual([{
      intentId: "intent-gatekeeper-lower",
      reasonCode: "lower_ranked",
    }]);
    const record = await engine.getRecord(sessionId);
    const snapshot = record.currentSnapshot;
    expect(snapshot.stateVersion).toBe(1);
    expect(snapshot.virtualTime.elapsedMinutes).toBe(3);
    expect(snapshot.variables.find(
      (variable) => variable.variableId === "community_trust",
    )?.after).toBe(58);
    expect(snapshot.entities.find(
      (entity) => entity.entityId === "entity-gatekeeper",
    )).toMatchObject({ revision: 1, status: "busy" });
    expect(snapshot.facts[0]).toMatchObject({
      factId: "fact-access-condition",
      status: "corroborated",
    });
    expect(snapshot.relationships[0]).toMatchObject({ trust: 58, tension: 3 });
    expect(snapshot.resources[0]).toMatchObject({ amount: 1, unit: "permission" });
    expect(record.consequences).toEqual([expect.objectContaining({
      publicSummary: "林师傅认可学生的边界说明，给予有条件准入。",
      resultingStateVersion: 1,
    })]);
    const replayAfterCommit = await engine.submitStudentAction({
      action: studentAskActionFixture(sessionId),
      eventTemplateId: "event-template-gatekeeper",
      requestId: "request-gatekeeper-resolution",
    });
    expect(replayAfterCommit).toMatchObject({ replayed: true });
    expect((await engine.getRecord(sessionId)).recordRevision).toBe(2);
  });

  it("fails closed on an unauthorized effect and preserves the authoritative snapshot", async () => {
    const engine = engineWithMemory("denied");
    const sessionId = "session-denied-effect";
    await start(engine, sessionId);
    await engine.submitStudentAction({
      action: studentAskActionFixture(sessionId),
      eventTemplateId: "event-template-gatekeeper",
      requestId: "request-denied-effect",
    });
    const unauthorized = intentRunFixture({
      suffix: "unauthorized",
      stateVersion: 0,
      intentType: "gatekeeper_responds",
      targetObjectRefs: [{
        objectType: "world_variable",
        objectId: "copyright_risk",
      }],
      effects: worldEffects({
        variables: [{ variableId: "copyright_risk", delta: 80 }],
      }),
    });

    const result = await engine.resolveNextEvent({
      sessionId,
      dispatchPlanId: "dispatch-denied",
      resolutionProposalId: "proposal-denied",
      expectedWorldStateVersion: 0,
      runs: [unauthorized],
      consequenceSummary: "这条后果不应发生。",
      evidenceIds: [],
    });
    expect(result).toMatchObject({
      status: "failed",
      failure: { code: "invalid_reference" },
    });
    const record = await engine.getRecord(sessionId);
    expect(record.currentSnapshot.stateVersion).toBe(0);
    expect(record.consequences).toEqual([]);
    expect(record.queue[0]?.status).toBe("failed");
  });

  it("records state-version drift as a zero-write failed resolution", async () => {
    const engine = engineWithMemory("drift");
    const sessionId = "session-state-drift";
    await start(engine, sessionId);
    await engine.submitStudentAction({
      action: studentAskActionFixture(sessionId),
      eventTemplateId: "event-template-gatekeeper",
      requestId: "request-state-drift",
    });

    const result = await engine.resolveNextEvent({
      sessionId,
      dispatchPlanId: "dispatch-state-drift",
      resolutionProposalId: "proposal-state-drift",
      expectedWorldStateVersion: 1,
      runs: [],
      consequenceSummary: "过期调度不得产生后果。",
      evidenceIds: [],
    });
    expect(result).toMatchObject({
      status: "failed",
      expectedWorldStateVersion: 1,
      failure: { code: "state_version_drift" },
    });
    const record = await engine.getRecord(sessionId);
    expect(record.currentSnapshot.stateVersion).toBe(0);
    expect(record.consequences).toEqual([]);
    expect(record.queue[0]?.status).toBe("failed");
  });

  it("holds high-risk publication at zero-write teacher gate, then supports approval, revision and rejection", async () => {
    const makePublicationAction = (sessionId: string) => ({
      ...studentAskActionFixture(sessionId),
      workActionId: `work-action-publication-${sessionId}`,
      serverIssuedActionRef: "server-action-submit-story",
      action: {
        verb: "submit" as const,
        artifactId: "artifact-xunpu-story",
        revisionId: "revision-xunpu-story-3",
        contentHash: "f".repeat(64),
        evidenceRefs: ["evidence-source-triangle"],
      },
      reflectionNote: "提交前已核验来源与授权。",
      submissionStatus: "accepted" as const,
    });
    const run = (suffix: string) => intentRunFixture({
      suffix,
      stateVersion: 0,
      intentType: "platform_publishes",
      targetObjectRefs: [{
        objectType: "world_variable",
        objectId: "public_trust",
      }],
      confidence: 0.9,
      riskLevel: "high",
      requiresTeacherGate: true,
      effects: worldEffects({
        variables: [{ variableId: "public_trust", delta: 10 }],
        ending: { status: "completed", endingRef: "ending-trusted-story" },
      }),
    });
    const resolvePending = async (
      engine: WorldSimulationEngineV3,
      sessionId: string,
      suffix: string,
    ) => {
      await start(engine, sessionId);
      await engine.submitStudentAction({
        action: makePublicationAction(sessionId),
        eventTemplateId: "event-template-publication",
        requestId: `request-publication-${suffix}`,
      });
      return engine.resolveNextEvent({
        sessionId,
        dispatchPlanId: `dispatch-publication-${suffix}`,
        resolutionProposalId: `proposal-publication-${suffix}`,
        expectedWorldStateVersion: 0,
        runs: [run(`publication-${suffix}`)],
        consequenceSummary: "经教师确认后，可信报道进入正式发布。",
        evidenceIds: ["evidence-source-triangle"],
      });
    };

    const approvalEngine = engineWithMemory("gate-approve");
    const pendingApproval = await resolvePending(
      approvalEngine,
      "session-gate-approve",
      "approve",
    );
    expect(pendingApproval.status).toBe("pending_teacher_gate");
    expect((await approvalEngine.getSnapshot("session-gate-approve")).stateVersion).toBe(0);
    await expect(approvalEngine.resolveNextEvent({
      sessionId: "session-gate-approve",
      dispatchPlanId: "dispatch-blocked",
      resolutionProposalId: "proposal-blocked",
      expectedWorldStateVersion: 0,
      runs: [run("blocked")],
      consequenceSummary: "不应越过教师门。",
      evidenceIds: [],
    })).rejects.toBeInstanceOf(SimulationTeacherGatePendingError);
    const approved = await approvalEngine.decideTeacherGate({
      sessionId: "session-gate-approve",
      resolutionId: pendingApproval.resolutionId,
      decision: "approved",
      teacherDecisionRef: "teacher-decision-approve",
      revisionPolicy: null,
      revisedConsequenceSummary: null,
    });
    expect(approved).toMatchObject({
      status: "committed",
      teacherGate: { status: "approved" },
    });
    expect((await approvalEngine.getSnapshot("session-gate-approve")).endingState)
      .toEqual({ status: "completed", endingRef: "ending-trusted-story" });

    const revisionEngine = engineWithMemory("gate-revise");
    const pendingRevision = await resolvePending(
      revisionEngine,
      "session-gate-revise",
      "revise",
    );
    const revised = await revisionEngine.decideTeacherGate({
      sessionId: "session-gate-revise",
      resolutionId: pendingRevision.resolutionId,
      decision: "revised",
      teacherDecisionRef: "teacher-decision-revise",
      revisionPolicy: "reduce_effects",
      revisedConsequenceSummary: "教师要求保留稿件但暂缓正式发布，先观察低风险反馈。",
    });
    expect(revised.variableDeltas[0]).toMatchObject({ delta: 5, after: 55 });
    expect((await revisionEngine.getSnapshot("session-gate-revise")).endingState)
      .toEqual({ status: "active", endingRef: null });

    const rejectionEngine = engineWithMemory("gate-reject");
    const pendingRejection = await resolvePending(
      rejectionEngine,
      "session-gate-reject",
      "reject",
    );
    const rejected = await rejectionEngine.decideTeacherGate({
      sessionId: "session-gate-reject",
      resolutionId: pendingRejection.resolutionId,
      decision: "rejected",
      teacherDecisionRef: "teacher-decision-reject",
      revisionPolicy: null,
      revisedConsequenceSummary: null,
    });
    expect(rejected.status).toBe("rejected");
    const rejectedRecord = await rejectionEngine.getRecord("session-gate-reject");
    expect(rejectedRecord.currentSnapshot.stateVersion).toBe(0);
    expect(rejectedRecord.consequences).toEqual([]);
  });

  it("accepts only the contract-valid draft status for a versioned draft action", async () => {
    const engine = engineWithMemory("draft-world");
    const sessionId = "session-versioned-draft";
    await start(engine, sessionId);
    const receipt = await engine.submitStudentAction({
      action: {
        ...studentAskActionFixture(sessionId),
        workActionId: "work-action-versioned-draft",
        action: {
          verb: "draft",
          artifactId: "artifact-xunpu-story",
          revisionId: "revision-xunpu-story-2",
          parentRevisionId: "revision-xunpu-story-1",
          contentHash: "e".repeat(64),
        },
        submissionStatus: "draft",
      },
      eventTemplateId: "event-template-publication",
      requestId: "request-versioned-draft",
    });
    expect(receipt.replayed).toBe(false);
    expect(receipt.event).toMatchObject({
      eventType: "student_submits_story",
      sourceKind: "student_action",
      status: "queued",
    });
  });

  it("advances virtual time to a declared deadline ending and closes further entry", async () => {
    const engine = engineWithMemory("clock");
    const sessionId = "session-deadline";
    await start(engine, sessionId);
    await engine.enqueueSystemClockEvent({
      sessionId,
      eventTemplateId: "event-template-clock",
      sourceRef: "clock-tick-deadline",
      requestId: "request-clock-deadline",
      expectedWorldStateVersion: 0,
    });
    const clockRun = intentRunFixture({
      suffix: "deadline",
      stateVersion: 0,
      intentType: "editor_raises_deadline",
      targetObjectRefs: [{
        objectType: "world_variable",
        objectId: "deadline_pressure",
      }],
      effects: worldEffects({
        variables: [{ variableId: "deadline_pressure", delta: 20 }],
        advanceMinutes: 55,
      }),
    });
    await engine.resolveNextEvent({
      sessionId,
      dispatchPlanId: "dispatch-deadline",
      resolutionProposalId: "proposal-deadline",
      expectedWorldStateVersion: 0,
      runs: [clockRun],
      consequenceSummary: "截稿窗口关闭，本轮进入可恢复的超时复盘。",
      evidenceIds: [],
    });
    const snapshot = await engine.getSnapshot(sessionId);
    expect(snapshot.virtualTime).toMatchObject({
      elapsedMinutes: 55,
      remainingMinutes: 0,
      currentAt: "2026-08-26T02:55:00.000Z",
    });
    expect(snapshot.endingState).toEqual({
      status: "recoverable_failure",
      endingRef: "ending-deadline-missed",
    });
    await expect(engine.enqueueSystemClockEvent({
      sessionId,
      eventTemplateId: "event-template-clock",
      sourceRef: "clock-after-ending",
      requestId: "request-clock-after-ending",
      expectedWorldStateVersion: 1,
    })).rejects.toBeInstanceOf(SimulationWorldEndedError);
  });

  it("restores a queued world from JSON and continues the same authority chain after restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ronggang-world-v3-"));
    const sessionId = "session-json-restart";
    try {
      const first = new WorldSimulationEngineV3({
        store: new JsonFileSimulationSessionStore(directory),
        now: () => "2026-08-26T02:01:00.000Z",
        idFactory: sequentialIds("json-first"),
      });
      await start(first, sessionId);
      await first.submitStudentAction({
        action: studentAskActionFixture(sessionId),
        eventTemplateId: "event-template-gatekeeper",
        requestId: "request-json-restart",
      });

      const second = new WorldSimulationEngineV3({
        store: new JsonFileSimulationSessionStore(directory),
        now: () => "2026-08-26T02:02:00.000Z",
        idFactory: sequentialIds("json-second"),
      });
      expect((await second.getRecord(sessionId)).queue[0]?.status).toBe("queued");
      await second.resolveNextEvent({
        sessionId,
        dispatchPlanId: "dispatch-json-restart",
        resolutionProposalId: "proposal-json-restart",
        expectedWorldStateVersion: 0,
        runs: [intentRunFixture({
          suffix: "json-restart",
          stateVersion: 0,
          intentType: "gatekeeper_responds",
          targetObjectRefs: [{
            objectType: "world_variable",
            objectId: "community_trust",
          }],
          effects: worldEffects({
            variables: [{ variableId: "community_trust", delta: 6 }],
          }),
        })],
        consequenceSummary: "重启后仍按同一队列顺序完成有条件准入。",
        evidenceIds: ["evidence-json-restart"],
      });

      const third = new WorldSimulationEngineV3({
        store: new JsonFileSimulationSessionStore(directory),
      });
      const restored = await third.getRecord(sessionId);
      expect(restored.recordRevision).toBe(2);
      expect(restored.queue[0]).toMatchObject({ status: "committed" });
      expect(restored.currentSnapshot.stateVersion).toBe(1);
      expect(restored.consequences[0]?.publicSummary).toContain("重启后");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
