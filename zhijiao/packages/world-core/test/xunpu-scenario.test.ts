import { describe, expect, it } from "vitest";
import {
  ScenarioPackageSchema,
  createMessageMeta,
  type Command,
} from "@ronggang/contracts";
import {
  WorldEngine,
  createStaticScenarioRelease,
  xunpuScenarioV200,
  xunpuScenarioV201,
  xunpuScenarioV201ContentHash,
} from "../src/index.js";

function choiceCommand(input: {
  sessionId: string;
  stateVersion: number;
  choiceRef: string;
  sequence: number;
}): Command {
  return {
    ...createMessageMeta({
      sessionId: input.sessionId,
      sceneId: xunpuScenarioV201.scenarioId,
      actorId: "student-reporter",
      correlationId: `xunpu-choice-${input.sequence}`,
      timestamp: `2026-08-09T09:${String(input.sequence).padStart(2, "0")}:00.000Z`,
    }),
    kind: "Command",
    name: "record_experience_choice",
    expectedStateVersion: input.stateVersion,
    payload: { choiceRef: input.choiceRef },
  };
}

function approveCommand(input: {
  sessionId: string;
  stateVersion: number;
  candidateId: string;
}): Command {
  return {
    ...createMessageMeta({
      sessionId: input.sessionId,
      sceneId: xunpuScenarioV201.scenarioId,
      actorId: "teacher-main",
      correlationId: "xunpu-teacher-gate-1",
      timestamp: "2026-08-09T09:10:00.000Z",
    }),
    kind: "Command",
    name: "approve_candidate_event",
    expectedStateVersion: input.stateVersion,
    payload: { candidateId: input.candidateId },
  };
}

describe("Xunpu V2 reporter-only scenario", () => {
  it("publishes seven Xunpu nodes with one and only one student reporter", () => {
    expect(ScenarioPackageSchema.parse(xunpuScenarioV200)).toEqual(
      xunpuScenarioV200,
    );
    expect(xunpuScenarioV200.nodes).toHaveLength(7);
    expect(xunpuScenarioV200.roles.filter((role) => (
      role.actorKind === "student"
    ))).toEqual([
      expect.objectContaining({
        agentId: "student-reporter",
        roleId: "reporter",
      }),
    ]);
    expect(JSON.stringify(xunpuScenarioV200)).not.toContain("水乡非遗市集");
    expect(JSON.stringify(xunpuScenarioV200)).not.toContain("暴雨闭园");
    expect(JSON.stringify(xunpuScenarioV200)).not.toContain("student-editor");
  });

  it("keeps public metadata and simulated facts separate from copied media", () => {
    expect(xunpuScenarioV200.materials.every((material) => (
      material.sourceRef.startsWith("demo://xunpu/")
    ))).toBe(true);
    expect(xunpuScenarioV200.materials.some((material) => (
      material.sourceRef.startsWith("/assets/")
    ))).toBe(false);
    expect(xunpuScenarioV200.bootstrap.initialFacts.some((fact) => (
      fact.factId === "xunpu-fact-viral-claims-unverified"
      && fact.status === "unverified"
    ))).toBe(true);
  });

  it("publishes an immutable seven-scene interactive successor without rewriting V2.0.0", () => {
    expect(ScenarioPackageSchema.parse(xunpuScenarioV201)).toEqual(
      xunpuScenarioV201,
    );
    expect(xunpuScenarioV201.version).toBe("2.0.1");
    expect(xunpuScenarioV200.version).toBe("2.0.0");
    expect(xunpuScenarioV201.experienceDesign).toMatchObject({
      contentVersion: "2.0.1",
      kind: "flagship",
    });
    expect(xunpuScenarioV201.experienceDesign?.scenes).toHaveLength(7);
    expect(xunpuScenarioV201.experienceDesign?.nodeMappings).toHaveLength(7);
    expect(xunpuScenarioV201.experienceDesign?.nodeMappings.every(
      (mapping) => mapping.operationTasks.length === 6,
    )).toBe(true);
    expect(xunpuScenarioV201.roles.filter((role) => (
      role.actorKind === "agent"
    ))).toHaveLength(14);
    expect(new Set(xunpuScenarioV201.roles.filter((role) => (
      role.actorKind === "agent"
    )).map((role) => role.agentId)).size).toBe(14);
    expect(JSON.stringify(xunpuScenarioV201)).not.toContain("水乡非遗市集");
    expect(JSON.stringify(xunpuScenarioV201)).not.toContain("暴雨闭园");
    expect(createStaticScenarioRelease({
      releaseId: "release-scenario-xunpu-media-2.0.1-test",
      package: xunpuScenarioV201,
    }).ref.contentHash).toBe(xunpuScenarioV201ContentHash);
  });

  it("records one immutable advice decision and advances only after the teacher gate", async () => {
    const engine = new WorldEngine({ scenario: xunpuScenarioV201 });
    const sessionId = "session-xunpu-v201-interactive";
    await engine.createSession(sessionId, true);

    let reporter = await engine.getProjection(sessionId, "student-reporter");
    expect(reporter.currentNode.nodeId).toBe("xunpu-topic-brief");
    expect(reporter.structuredWorld?.tasks.map((task) => task.taskId)).toEqual([
      "xunpu-topic-compare-angles",
      "xunpu-topic-request-basis",
      "xunpu-topic-submit-card",
    ]);
    expect(JSON.stringify(reporter.structuredWorld)).not.toContain(
      ":agent-decision:",
    );

    reporter = await engine.execute(choiceCommand({
      sessionId,
      stateVersion: reporter.stateVersion,
      choiceRef: "xunpu-topic-brief:agent-decision:request_evidence",
      sequence: 1,
    }));
    await expect(engine.execute(choiceCommand({
      sessionId,
      stateVersion: reporter.stateVersion,
      choiceRef: "xunpu-topic-brief:agent-decision:accept",
      sequence: 2,
    }))).rejects.toThrow("不可改写");

    for (const [index, choiceRef] of [
      "xunpu-topic-compare-angles",
      "xunpu-topic-request-basis",
      "xunpu-topic-submit-card",
    ].entries()) {
      reporter = await engine.execute(choiceCommand({
        sessionId,
        stateVersion: reporter.stateVersion,
        choiceRef,
        sequence: index + 3,
      }));
    }
    expect(reporter.currentNode.nodeId).toBe("xunpu-topic-brief");
    expect(reporter.structuredWorld?.tasks.at(-1)).toMatchObject({
      taskId: "xunpu-topic-submit-card",
      status: "waiting",
    });
    expect(reporter.evidence).toHaveLength(4);

    const teacher = await engine.getProjection(sessionId, "teacher-main");
    const candidate = teacher.pendingCandidates.find((item) => (
      item.payload.dynamicEventId === "xunpu-topic-brief:advance-event"
    ));
    expect(candidate).toBeDefined();
    if (!candidate) throw new Error("泉州选题任务未形成教师门候选");
    await engine.execute(approveCommand({
      sessionId,
      stateVersion: teacher.stateVersion,
      candidateId: candidate.candidateId,
    }));

    const next = await engine.getProjection(sessionId, "student-reporter");
    expect(next.currentNode.nodeId).toBe("xunpu-source-map");
    expect(next.structuredWorld?.scene.sceneId).toBe(
      "xunpu-scene-source-lab",
    );
    const serialized = JSON.stringify(next);
    expect(serialized).not.toContain("水乡非遗市集");
    expect(serialized).not.toContain("暴雨闭园");
    expect(serialized).not.toContain("student-editor");
  });
});
