import { describe, expect, it } from "vitest";
import {
  AdminAgentCollaborationEpisodeV3Schema,
  AgentCollaborationEpisodeV3Schema,
  StudentAgentCollaborationEpisodeV3Schema,
  TeacherAgentCollaborationEpisodeV3Schema,
  V3SimulationContractBundleSchema,
} from "../src/index.js";
import {
  adminCollaborationEpisodeV3Fixture,
  studentCollaborationEpisodeV3Fixture,
  teacherCollaborationEpisodeV3Fixture,
  v3SimulationContractBundleFixture,
} from "./v3-simulation.fixture.js";

describe("V3 collaboration episode and end-to-end reference bundle", () => {
  it("accepts role-safe student, teacher and admin projections", () => {
    expect(StudentAgentCollaborationEpisodeV3Schema.parse(
      studentCollaborationEpisodeV3Fixture(),
    ).audience).toBe("student");
    expect(TeacherAgentCollaborationEpisodeV3Schema.parse(
      teacherCollaborationEpisodeV3Fixture(),
    ).audience).toBe("teacher");
    expect(AdminAgentCollaborationEpisodeV3Schema.parse(
      adminCollaborationEpisodeV3Fixture(),
    ).audience).toBe("admin");
    for (const fixture of [
      studentCollaborationEpisodeV3Fixture(),
      teacherCollaborationEpisodeV3Fixture(),
      adminCollaborationEpisodeV3Fixture(),
    ]) {
      expect(AgentCollaborationEpisodeV3Schema.parse(fixture).audience)
        .toBe(fixture.audience);
    }
  });

  it("does not expose traces, providers, prompts or private memory to students", () => {
    expect(() => StudentAgentCollaborationEpisodeV3Schema.parse({
      ...studentCollaborationEpisodeV3Fixture(),
      execution: { providerId: "vendor", traceRefs: ["trace-private"] },
      prompt: "system prompt",
      privateMemory: "npc hidden state",
      token: "secret",
    })).toThrow();
  });

  it("requires selected agents and truthful dispatch counts for contributions", () => {
    const unselectedContribution = structuredClone(
      teacherCollaborationEpisodeV3Fixture(),
    );
    unselectedContribution.contributions[0]!.agentId = "agent-not-selected";
    expect(() => TeacherAgentCollaborationEpisodeV3Schema.parse(
      unselectedContribution,
    )).toThrow();

    const falseCount = structuredClone(teacherCollaborationEpisodeV3Fixture());
    if (falseCount.dispatchPlan === null) throw new Error("fixture drift");
    falseCount.dispatchPlan.selectedCount = 12;
    expect(() => TeacherAgentCollaborationEpisodeV3Schema.parse(falseCount))
      .toThrow();
  });

  it("labels deterministic demo honestly and requires provider metadata for live", () => {
    const fakeDemoProvider = structuredClone(adminCollaborationEpisodeV3Fixture());
    fakeDemoProvider.execution.providerId = "provider-x";
    fakeDemoProvider.execution.modelId = "model-x";
    expect(() => AdminAgentCollaborationEpisodeV3Schema.parse(fakeDemoProvider))
      .toThrow();

    const liveWithoutProvider = structuredClone(adminCollaborationEpisodeV3Fixture());
    liveWithoutProvider.execution.executionMode = "live";
    expect(() => AdminAgentCollaborationEpisodeV3Schema.parse(liveWithoutProvider))
      .toThrow();
  });

  it("keeps failed collaboration write-free", () => {
    const failed = structuredClone(teacherCollaborationEpisodeV3Fixture());
    failed.status = "failed";
    failed.failureCode = "agent_execution_failed";
    failed.consequence = null;
    expect(TeacherAgentCollaborationEpisodeV3Schema.parse(failed).status)
      .toBe("failed");

    failed.consequence = teacherCollaborationEpisodeV3Fixture().consequence;
    expect(() => TeacherAgentCollaborationEpisodeV3Schema.parse(failed)).toThrow();

    const falseStudentCompletion = structuredClone(
      studentCollaborationEpisodeV3Fixture(),
    );
    if (falseStudentCompletion.consequence === null) throw new Error("fixture drift");
    falseStudentCompletion.consequence.status = "rejected";
    falseStudentCompletion.consequence.worldEventIds = [];
    falseStudentCompletion.consequence.evidenceIds = [];
    falseStudentCompletion.consequence.resultingStateVersion = null;
    expect(() => StudentAgentCollaborationEpisodeV3Schema.parse(
      falseStudentCompletion,
    )).toThrow();
  });

  it("accepts one closed V3 chain across all fourteen versioned contracts", () => {
    const bundle = V3SimulationContractBundleSchema.parse(
      v3SimulationContractBundleFixture(),
    );
    expect(bundle.resolution.status).toBe("committed");
    expect(bundle.competencyEvidenceEpisode.sourceKind).toBe("real_student_action");
    expect(bundle.learnerSimulationForecast.evidenceEligible).toBe(false);
  });

  it("fails closed on release, state, run, evidence or learner cross-reference drift", () => {
    const releaseDrift = structuredClone(v3SimulationContractBundleFixture());
    releaseDrift.worldSnapshot.simulationReleaseRef = {
      ...releaseDrift.worldSnapshot.simulationReleaseRef,
      contentHash: "f".repeat(64),
    };
    expect(() => V3SimulationContractBundleSchema.parse(releaseDrift)).toThrow();

    const stateDrift = structuredClone(v3SimulationContractBundleFixture());
    stateDrift.agentIntent.expectedWorldStateVersion = 99;
    expect(() => V3SimulationContractBundleSchema.parse(stateDrift)).toThrow();

    const runDrift = structuredClone(v3SimulationContractBundleFixture());
    runDrift.resolution.acceptedIntents[0]!.agentRunId = "agent-run-forged";
    expect(() => V3SimulationContractBundleSchema.parse(runDrift)).toThrow();

    const evidenceDrift = structuredClone(v3SimulationContractBundleFixture());
    evidenceDrift.assessmentDecision.evidenceEpisodeRefs = ["evidence-missing"];
    evidenceDrift.assessmentDecision.competencyEstimates[0]!.evidenceEpisodeRefs = [
      "evidence-missing",
    ];
    expect(() => V3SimulationContractBundleSchema.parse(evidenceDrift)).toThrow();

    const learnerDrift = structuredClone(v3SimulationContractBundleFixture());
    learnerDrift.personalizedLearningPlan.learnerTwinRef = "learner-twin-other";
    expect(() => V3SimulationContractBundleSchema.parse(learnerDrift)).toThrow();

    const variantDrift = structuredClone(v3SimulationContractBundleFixture());
    variantDrift.challengeAssignment.worldVariantRef = "world-variant-not-released";
    expect(() => V3SimulationContractBundleSchema.parse(variantDrift)).toThrow();

    const profileHashDrift = structuredClone(v3SimulationContractBundleFixture());
    profileHashDrift.learnerSimulationForecast.learnerTwinContentHash = "0".repeat(64);
    expect(() => V3SimulationContractBundleSchema.parse(profileHashDrift)).toThrow();
  });
});
