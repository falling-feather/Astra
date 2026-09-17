import {
  ChallengeAssignmentSchemaVersion,
  type ChallengeAssignment,
} from "@ronggang/contracts";
import { getXunpuWorldSimulationReleaseV3 } from "@ronggang/course-content";
import {
  InMemorySimulationSessionStore,
  WorldSimulationEngineV3,
} from "@ronggang/world-core";
import {
  InMemorySimulationCollaborationStoreV3,
  SimulationAgentOrchestratorV3,
  buildXunpuSimulationAgentTemplatesV3,
  createXunpuDeterministicSimulationExecutorsV3,
} from "@ronggang/agent-orchestrator";

export const v3FixedNow = () => "2026-08-26T03:30:00.000Z";

export function v3SequentialIds(namespace: string): (prefix: string) => string {
  let value = 0;
  return (prefix) => `${prefix}-${namespace}-${++value}`;
}

export function v3ChallengeAssignment(sessionId: string): ChallengeAssignment {
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
    basisEvidenceRefs: ["evidence-prior-session"],
    forecastRef: `forecast-${sessionId}`,
    teacherOverride: null,
    policyVersion: "challenge-policy/1.0.0",
    policyContentHash: "d".repeat(64),
    assignedAt: "2026-08-26T03:29:00.000Z",
  };
}

export async function createV3WorldTestRuntime(sessionId: string) {
  const engine = new WorldSimulationEngineV3({
    store: new InMemorySimulationSessionStore(),
    now: v3FixedNow,
    idFactory: v3SequentialIds(`world-${sessionId}`),
  });
  await engine.startSession({
    sessionId,
    release: getXunpuWorldSimulationReleaseV3(),
    challengeAssignment: v3ChallengeAssignment(sessionId),
    targetCompetencyRefs: [
      "competency-professional-communication",
      "competency-source-verification",
    ],
    scaffoldingLevel: 1,
    startedAt: "2026-08-26T03:30:00.000Z",
  });
  const orchestrator = new SimulationAgentOrchestratorV3({
    engine,
    store: new InMemorySimulationCollaborationStoreV3(),
    templates: buildXunpuSimulationAgentTemplatesV3(),
    executors: createXunpuDeterministicSimulationExecutorsV3(),
    maxSelectedAgents: 5,
    now: v3FixedNow,
    monotonicNowMs: (() => {
      let value = 100;
      return () => value += 5;
    })(),
    idFactory: v3SequentialIds(`agent-${sessionId}`),
  });
  return { engine, orchestrator };
}

export function v3StudentAskBody(bindingId = "binding-student") {
  return {
    bindingId,
    requestId: "request-route-gatekeeper",
    eventTemplateId: "event-template-gatekeeper",
    serverIssuedActionRef: "server-action-event-template-gatekeeper-0",
    expectedWorldStateVersion: 0,
    action: {
      verb: "ask" as const,
      targetRef: { objectType: "entity" as const, objectId: "entity-gatekeeper" },
      utterance: "您好，我是学生记者。我不会进入私人住宅，想先了解可采访的公共区域。",
    },
    sourceWorldEventIds: [],
    reflectionNote: "先说明身份、采访目的和边界。",
  };
}
