import { describe, expect, it } from "vitest";
import {
  AgentObservationSchema,
  AgentStateSchema,
  SimulationAgentIntentSchema,
  SimulationResolutionSchema,
  StudentWorkActionSchema,
  WorldSimulationReleaseSchema,
  WorldSnapshotSchema,
} from "../src/index.js";
import {
  agentObservationFixture,
  agentStateFixture,
  simulationAgentIntentFixture,
  simulationResolutionFixture,
  studentWorkActionFixture,
  worldSimulationReleaseFixture,
  worldSnapshotFixture,
} from "./v3-simulation.fixture.js";

describe("V3 living-world contracts", () => {
  it("accepts an immutable 45—60 minute world, state, agent loop and student action", () => {
    const release = WorldSimulationReleaseSchema.parse(
      worldSimulationReleaseFixture(),
    );
    expect(release.worldEntities).toHaveLength(7);
    expect(release.variableDefinitions).toHaveLength(9);
    expect(release.challengeVariants.map((variant) => variant.challengeLevel))
      .toEqual([3, 4, 5, 6, 7]);
    expect(WorldSnapshotSchema.parse(worldSnapshotFixture()).stateVersion).toBe(7);
    expect(AgentStateSchema.parse(agentStateFixture()).visibility)
      .toBe("server_private");
    expect(AgentObservationSchema.parse(agentObservationFixture()).worldStateVersion)
      .toBe(7);
    expect(SimulationAgentIntentSchema.parse(simulationAgentIntentFixture()).authority)
      .toBe("proposal_only");
    expect(SimulationResolutionSchema.parse(simulationResolutionFixture()).status)
      .toBe("committed");
    expect(StudentWorkActionSchema.parse(studentWorkActionFixture()).action.verb)
      .toBe("ask");
  });

  it("rejects duplicate and dangling release refs or a broken challenge ceiling", () => {
    const duplicateEntity = structuredClone(worldSimulationReleaseFixture());
    duplicateEntity.worldEntities[1]!.entityId = duplicateEntity.worldEntities[0]!.entityId;
    expect(() => WorldSimulationReleaseSchema.parse(duplicateEntity)).toThrow();

    const danglingRule = structuredClone(worldSimulationReleaseFixture());
    danglingRule.eventTemplates[0]!.ruleRefs = ["rule-does-not-exist"];
    expect(() => WorldSimulationReleaseSchema.parse(danglingRule)).toThrow();

    const danglingEntity = structuredClone(worldSimulationReleaseFixture());
    danglingEntity.eventTemplates[0]!.affectedObjectRefs = [
      { objectType: "entity", objectId: "entity-does-not-exist" },
    ];
    expect(() => WorldSimulationReleaseSchema.parse(danglingEntity)).toThrow();

    const badCeiling = structuredClone(worldSimulationReleaseFixture());
    badCeiling.challengeVariants[2]!.scoreCeiling = 100;
    expect(() => WorldSimulationReleaseSchema.parse(badCeiling)).toThrow();

    const duplicateVariant = structuredClone(worldSimulationReleaseFixture());
    duplicateVariant.challengeVariants[1]!.worldVariantId =
      duplicateVariant.challengeVariants[0]!.worldVariantId;
    expect(() => WorldSimulationReleaseSchema.parse(duplicateVariant)).toThrow();
  });

  it("preserves state arithmetic, relationship integrity and challenge context", () => {
    const brokenDelta = structuredClone(worldSnapshotFixture());
    brokenDelta.variables[0]!.after = 99;
    expect(() => WorldSnapshotSchema.parse(brokenDelta)).toThrow();

    const danglingRelationship = structuredClone(worldSnapshotFixture());
    danglingRelationship.relationships[0]!.targetEntityId = "entity-missing";
    expect(() => WorldSnapshotSchema.parse(danglingRelationship)).toThrow();

    const badCeiling = structuredClone(worldSnapshotFixture());
    badCeiling.learningContext.scoreCeiling = 100;
    expect(() => WorldSnapshotSchema.parse(badCeiling)).toThrow();

    const activeWithEnding = structuredClone(worldSnapshotFixture());
    activeWithEnding.endingState.endingRef = "ending-too-early";
    expect(() => WorldSnapshotSchema.parse(activeWithEnding)).toThrow();
  });

  it("keeps private state server-only and observations ACL-filtered", () => {
    expect(() => AgentStateSchema.parse({
      ...agentStateFixture(),
      visibility: "student",
    })).toThrow();

    const futureMemory = structuredClone(agentStateFixture());
    futureMemory.lastObservedWorldStateVersion = 8;
    expect(() => AgentStateSchema.parse(futureMemory)).toThrow();

    expect(() => AgentObservationSchema.parse({
      ...agentObservationFixture(),
      rawPrompt: "system instructions",
      privateMemory: "hidden state",
      accessToken: "secret",
    })).toThrow();
  });

  it("permits agents to propose only and gates high-risk intent", () => {
    const highRiskUngated = structuredClone(simulationAgentIntentFixture());
    highRiskUngated.riskLevel = "high";
    highRiskUngated.requiresTeacherGate = false;
    expect(() => SimulationAgentIntentSchema.parse(highRiskUngated)).toThrow();

    expect(() => SimulationAgentIntentSchema.parse({
      ...simulationAgentIntentFixture(),
      authority: "world_writer",
      worldDelta: { community_trust: 100 },
    })).toThrow();
  });

  it("keeps pending, rejected and failed resolutions write-free", () => {
    for (const status of ["pending_teacher_gate", "rejected", "failed"] as const) {
      expect(SimulationResolutionSchema.parse(
        simulationResolutionFixture(status),
      ).status).toBe(status);
    }

    const failedWrite = structuredClone(simulationResolutionFixture("failed"));
    failedWrite.emittedWorldEventIds = ["forged-event"];
    expect(() => SimulationResolutionSchema.parse(failedWrite)).toThrow();

    const pendingDelta = structuredClone(
      simulationResolutionFixture("pending_teacher_gate"),
    );
    pendingDelta.variableDeltas = [
      { variableId: "public_trust", before: 50, delta: 10, after: 60 },
    ];
    expect(() => SimulationResolutionSchema.parse(pendingDelta)).toThrow();

    const rejectedGateCommit = structuredClone(simulationResolutionFixture());
    rejectedGateCommit.teacherGate = {
      gateId: "gate-publication-review",
      status: "rejected",
      teacherDecisionRef: "teacher-decision-reject-001",
    };
    expect(() => SimulationResolutionSchema.parse(rejectedGateCommit)).toThrow();
  });

  it("rejects browser attempts to submit scores, agents or world writes", () => {
    expect(() => StudentWorkActionSchema.parse({
      ...studentWorkActionFixture(),
      agentId: "agent-forged-by-browser",
      score: 100,
      worldDelta: { public_trust: 100 },
      privateMemory: "forged",
    })).toThrow();

    const invalidDraft = structuredClone(studentWorkActionFixture());
    invalidDraft.action = {
      verb: "draft",
      artifactId: "artifact-story-001",
      revisionId: "revision-story-001",
      parentRevisionId: null,
      contentHash: "a".repeat(64),
    };
    invalidDraft.submissionStatus = "accepted";
    expect(() => StudentWorkActionSchema.parse(invalidDraft)).toThrow();
  });
});
