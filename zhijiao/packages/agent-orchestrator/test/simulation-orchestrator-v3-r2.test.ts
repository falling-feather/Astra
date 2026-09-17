import { describe, expect, it } from "vitest";
import {
  ChallengeAssignmentSchemaVersion,
  StudentWorkActionSchemaVersion,
  type ChallengeAssignment,
  type StudentWorkAction,
} from "@ronggang/contracts";
import { buildXunpuFlagshipRuntimeReleaseV3R2 } from "@ronggang/course-content";
import {
  InMemorySimulationSessionStore,
  WorldSimulationEngineV3,
} from "@ronggang/world-core";
import {
  InMemorySimulationCollaborationStoreV3,
  SimulationAgentOrchestratorV3,
  buildXunpuSimulationAgentTemplatesV3R2,
  buildXunpuSimulationTaskInstructionV3,
  createXunpuDeterministicSimulationExecutorsV3R2,
} from "../src/index.js";

const now = () => "2026-08-26T08:30:00.000Z";

function sequentialIds(namespace: string) {
  let value = 0;
  return (prefix: string) => `${prefix}-${namespace}-${++value}`;
}

// Isolated R2 dispatch fixtures retain their frozen pre-policy release; current route ordering is verified by the API suite.
function assignment(sessionId: string): ChallengeAssignment {
  const release = buildXunpuFlagshipRuntimeReleaseV3R2(undefined, "runtime.3");
  return {
    schemaVersion: ChallengeAssignmentSchemaVersion,
    challengeAssignmentId: `challenge-${sessionId}`,
    learnerTwinRef: `learner-twin-${sessionId}`,
    sessionId,
    simulationReleaseRef: release.simulationReleaseRef,
    worldVariantRef: "world-variant-r2-level-5",
    previousChallengeLevel: 4,
    challengeLevel: 5,
    scoreCeiling: 90,
    pressureDimensions: [
      { dimensionId: "time", intensity: 5 },
      { dimensionId: "source_access", intensity: 5 },
      { dimensionId: "relationship_conflict", intensity: 5 },
    ],
    assignmentReason: "evidence_progression",
    basisEvidenceRefs: ["evidence-prior-performance"],
    forecastRef: `forecast-${sessionId}`,
    teacherOverride: null,
    policyVersion: "challenge-policy/1.0.0",
    policyContentHash: "d".repeat(64),
    assignedAt: "2026-08-26T08:29:00.000Z",
  };
}

describe("R2 six-group/fourteen-agent runtime", () => {
  it("binds every R2 world event to only the frozen fourteen-agent topology", () => {
    const release = buildXunpuFlagshipRuntimeReleaseV3R2(undefined, "runtime.3");
    const templates = buildXunpuSimulationAgentTemplatesV3R2();
    const templateIds = new Set(templates.map((template) => template.agentTemplateId));
    expect(templates).toHaveLength(14);
    expect(new Set(templates.map((template) => template.groupId))).toEqual(new Set([
      "teaching_direction",
      "field_npc",
      "editorial_collaboration",
      "verification_governance",
      "operations_distribution",
      "assessment_growth",
    ]));
    expect(release.eventTemplates.length).toBeGreaterThanOrEqual(23);
    for (const event of release.eventTemplates) {
      expect(event.candidateAgentTemplateIds.length).toBeGreaterThan(0);
      expect(event.candidateAgentTemplateIds.every((id) => templateIds.has(id))).toBe(true);
    }
    const eventTypes = new Set(release.eventTemplates.map((event) => event.eventType));
    for (const eventType of [
      "student_asks_community_source",
      "student_resolves_commercial_exchange",
      "student_probes_researcher",
      "student_inspects_rights",
      "safety_rumor_emerges",
      "student_drafts_story",
      "student_submits_correction",
    ]) expect(eventTypes.has(eventType)).toBe(true);
  });

  it("turns the student's commercial counteroffer into quality-sensitive world evidence", async () => {
    const release = buildXunpuFlagshipRuntimeReleaseV3R2(undefined, "runtime.3");
    const sessionId = "session-r2-commercial-response";
    const engine = new WorldSimulationEngineV3({
      store: new InMemorySimulationSessionStore(),
      now,
      idFactory: sequentialIds("r2-commercial-world"),
    });
    await engine.startSession({
      sessionId,
      release,
      challengeAssignment: assignment(sessionId),
      targetCompetencyRefs: ["competency-editorial-independence"],
      scaffoldingLevel: 1,
      startedAt: "2026-08-26T08:30:00.000Z",
    });
    const action: StudentWorkAction = {
      schemaVersion: StudentWorkActionSchemaVersion,
      workActionId: "work-action-r2-commercial-response",
      serverIssuedActionRef: "server-action-r2-commercial-response",
      sessionId,
      bindingId: "binding-r2-student",
      actorId: "actor-r2-reporter",
      primaryRoleId: "reporter",
      expectedWorldStateVersion: 0,
      action: {
        verb: "negotiate",
        targetRef: { objectType: "entity", objectId: "entity-shopkeeper" },
        utterance: "素材授权与曝光分开：我会标注素材提供方，但标题和首图由编辑判断，不承诺套餐植入；不合适就改用自采素材。",
      },
      sourceWorldEventIds: [],
      reflectionNote: "披露合作关系，同时保留编辑独立与合法替代路径。",
      submissionStatus: "accepted",
      createdAt: "2026-08-26T08:30:10.000Z",
    };
    await engine.submitStudentAction({
      action,
      eventTemplateId: "event-template-commercial-response",
      requestId: "request-r2-commercial-response",
    });
    const orchestrator = new SimulationAgentOrchestratorV3({
      engine,
      store: new InMemorySimulationCollaborationStoreV3(),
      templates: buildXunpuSimulationAgentTemplatesV3R2(),
      executors: createXunpuDeterministicSimulationExecutorsV3R2(),
      buildTaskInstruction: buildXunpuSimulationTaskInstructionV3,
      maxSelectedAgents: 5,
      now,
      idFactory: sequentialIds("r2-commercial-agents"),
    });
    const prepared = await orchestrator.prepareNextEpisode(sessionId);
    expect(new Set(prepared.teacher.contributions.map((item) => item.agentId)))
      .toEqual(new Set(["agent-shopkeeper", "agent-editor"]));
    await orchestrator.recordStudentDecision({
      sessionId,
      episodeId: prepared.student.episodeId,
      decisionRef: "decision-r2-commercial-accept",
      decision: "accept",
      rationale: "接受有限素材合作，但拒绝版面交换并公开来源。",
    });
    await orchestrator.resolveAcceptedEpisode(sessionId, prepared.student.episodeId);
    const snapshot = await engine.getSnapshot(sessionId);
    expect(snapshot.variables.find((item) => item.variableId === "editorial_independence")?.delta)
      .toBeGreaterThan(0);
    expect(snapshot.variables.find((item) => item.variableId === "source_access")?.delta)
      .toBeGreaterThan(0);
  });

  it("declares every deterministic variable effect in the selected intent targets", async () => {
    const release = buildXunpuFlagshipRuntimeReleaseV3R2(undefined, "runtime.3");
    const templates = buildXunpuSimulationAgentTemplatesV3R2();
    const executors = createXunpuDeterministicSimulationExecutorsV3R2();
    const missingTargets: string[] = [];
    for (const event of release.eventTemplates) {
      for (const agentTemplateId of event.candidateAgentTemplateIds) {
        const template = templates.find((candidate) => (
          candidate.agentTemplateId === agentTemplateId
        ));
        const executor = executors.get(agentTemplateId);
        expect(template, `${event.eventTemplateId} 缺少 ${agentTemplateId}`).toBeDefined();
        expect(executor, `${agentTemplateId} 缺少执行器`).toBeDefined();
        if (!template || !executor) continue;
        const draft = await executor({
          template,
          state: {} as never,
          observation: {} as never,
          task: {
            agentTaskId: `task-${event.eventTemplateId}-${agentTemplateId}`,
            eventType: event.eventType,
            affectedObjectRefs: event.affectedObjectRefs,
          } as never,
        });
        const targets = new Set(draft.targetObjectRefs.map((reference) => (
          `${reference.objectType}:${reference.objectId}`
        )));
        for (const effect of draft.effects.variables) {
          const key = `world_variable:${effect.variableId}`;
          if (!targets.has(key)) {
            missingTargets.push(`${event.eventTemplateId}:${agentTemplateId}:${key}`);
          }
        }
      }
    }
    expect(missingTargets).toEqual([]);
  });

  it("runs a source-conflict action through affected-set dispatch and commits its world effects", async () => {
    const release = buildXunpuFlagshipRuntimeReleaseV3R2(undefined, "runtime.3");
    const sessionId = "session-r2-researcher-conflict";
    const engine = new WorldSimulationEngineV3({
      store: new InMemorySimulationSessionStore(),
      now,
      idFactory: sequentialIds("r2-world"),
    });
    await engine.startSession({
      sessionId,
      release,
      challengeAssignment: assignment(sessionId),
      targetCompetencyRefs: ["competency-source-verification"],
      scaffoldingLevel: 1,
      startedAt: "2026-08-26T08:30:00.000Z",
    });
    const action: StudentWorkAction = {
      schemaVersion: StudentWorkActionSchemaVersion,
      workActionId: "work-action-r2-researcher",
      serverIssuedActionRef: "server-action-r2-researcher",
      sessionId,
      bindingId: "binding-r2-student",
      actorId: "actor-r2-reporter",
      primaryRoleId: "reporter",
      expectedWorldStateVersion: 0,
      action: {
        verb: "probe",
        targetRef: { objectType: "entity", objectId: "entity-researcher" },
        utterance: "请区分国家级名录、地方标准与单一起源说法各自能证明到哪一步。",
      },
      sourceWorldEventIds: [],
      reflectionNote: "把公开事实、专家解释和待核口述分开。",
      submissionStatus: "accepted",
      createdAt: "2026-08-26T08:30:10.000Z",
    };
    await engine.submitStudentAction({
      action,
      eventTemplateId: "event-template-researcher-probe",
      requestId: "request-r2-researcher",
    });
    const orchestrator = new SimulationAgentOrchestratorV3({
      engine,
      store: new InMemorySimulationCollaborationStoreV3(),
      templates: buildXunpuSimulationAgentTemplatesV3R2(),
      executors: createXunpuDeterministicSimulationExecutorsV3R2(),
      buildTaskInstruction: buildXunpuSimulationTaskInstructionV3,
      maxSelectedAgents: 5,
      now,
      monotonicNowMs: (() => {
        let value = 100;
        return () => value += 5;
      })(),
      idFactory: sequentialIds("r2-agents"),
    });
    const prepared = await orchestrator.prepareNextEpisode(sessionId);
    expect(prepared.student).toMatchObject({
      status: "suggestion_ready",
      suggestion: { provenanceVerified: true },
    });
    expect(prepared.teacher.dispatchPlan?.decisions).toHaveLength(14);
    expect(new Set(prepared.teacher.contributions.map((item) => item.agentId)))
      .toEqual(new Set(["agent-researcher", "agent-fact-checker"]));
    await orchestrator.recordStudentDecision({
      sessionId,
      episodeId: prepared.student.episodeId,
      decisionRef: "decision-r2-researcher-accept",
      decision: "accept",
      rationale: "采用证据分层，但仍由我完成最终写作判断。",
    });
    const completed = await orchestrator.resolveAcceptedEpisode(
      sessionId,
      prepared.student.episodeId,
    );
    expect(completed.student.status).toBe("completed");
    const snapshot = await engine.getSnapshot(sessionId);
    expect(snapshot.stateVersion).toBe(1);
    expect(snapshot.variables.find((item) => item.variableId === "evidence_confidence")?.delta)
      .toBeGreaterThan(0);
  });
});
