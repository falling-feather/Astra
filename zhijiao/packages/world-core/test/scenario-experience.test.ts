import { describe, expect, it } from "vitest";
import {
  ActionEnvelopeSchema,
  ActionEnvelopeSchemaVersion,
  createMessageMeta,
  type Command,
} from "@ronggang/contracts";
import { hashValue } from "@ronggang/context-engine";
import {
  WorldEngine,
  createStaticScenarioRelease,
  demoScenario,
  demoScenarioV100ContentHash,
  flagshipScenarioV110,
  flagshipScenarioV110ContentHash,
  flagshipScenarioV111,
  flagshipScenarioV111ContentHash,
  heritageNightTourScenarioV100,
  heritageNightTourScenarioV100ContentHash,
  transferScenarioV100,
  transferScenarioV100ContentHash,
} from "../src/index.js";

function experienceAction(input: {
  sessionId: string;
  sessionEpoch: string;
  stateVersion: number;
  teamId: string;
  choiceRef: string;
}) {
  const command: Command = {
    ...createMessageMeta({
      sessionId: input.sessionId,
      sceneId: transferScenarioV100.scenarioId,
      actorId: "student-editor",
      correlationId: "game-002-choice",
      timestamp: "2026-07-29T08:00:00.000Z",
    }),
    kind: "Command",
    name: "record_experience_choice",
    expectedStateVersion: input.stateVersion,
    payload: { choiceRef: input.choiceRef },
  };
  return ActionEnvelopeSchema.parse({
    kind: "ActionEnvelope",
    envelopeVersion: ActionEnvelopeSchemaVersion,
    actionId: "action-transfer-risk-plan",
    idempotencyKey: "idempotency-transfer-risk-plan",
    payloadHash: hashValue(command.payload),
    source: {
      mode: "world_interaction",
      assertion: "service_verified",
      surfaceId: "student-world-stage",
      interactionId: input.choiceRef,
    },
    actor: {
      principalId: "principal-student-editor",
      bindingId: "binding-student-editor",
      actorId: "student-editor",
      actorKind: "student",
      roleId: "responsible_editor",
      teamId: input.teamId,
      sessionEpoch: input.sessionEpoch,
    },
    objectRefs: [{
      objectType: "world_state",
      objectId: input.sessionId,
      version: String(input.stateVersion),
    }],
    causality: {
      rootActionId: "action-transfer-risk-plan",
      causationId: "transfer-hotspot-brief-board",
      parentActionId: null,
      causationEventIds: [],
      causalDepth: 0,
    },
    evidence: {
      evidenceRefs: [],
      citationRefs: [],
      toolResultRefs: [],
    },
    command,
  });
}

function teacherCommand(input: {
  sessionId: string;
  stateVersion: number;
  candidateId: string;
}): Command {
  return {
    ...createMessageMeta({
      sessionId: input.sessionId,
      sceneId: transferScenarioV100.scenarioId,
      actorId: "teacher-main",
      correlationId: "game-002-teacher-gate",
      timestamp: "2026-07-29T08:01:00.000Z",
    }),
    kind: "Command",
    name: "approve_candidate_event",
    expectedStateVersion: input.stateVersion,
    payload: { candidateId: input.candidateId },
  };
}

describe("CONTENT-003 scenario experience packages", () => {
  it("keeps published snapshots immutable and pins every content hash", () => {
    const releases = [
      [demoScenario, demoScenarioV100ContentHash],
      [flagshipScenarioV110, flagshipScenarioV110ContentHash],
      [flagshipScenarioV111, flagshipScenarioV111ContentHash],
      [transferScenarioV100, transferScenarioV100ContentHash],
      [
        heritageNightTourScenarioV100,
        heritageNightTourScenarioV100ContentHash,
      ],
    ] as const;

    for (const [scenario, expectedHash] of releases) {
      const release = createStaticScenarioRelease({
        releaseId: `release-${scenario.scenarioId}-${scenario.version}-test`,
        package: scenario,
      });
      expect(release.ref.contentHash).toBe(expectedHash);
    }
  });

  it("publishes the prospective heritage-night-tour transfer as a reusable three-node release", async () => {
    const release = createStaticScenarioRelease({
      releaseId:
        "release-scenario-heritage-night-tour-capacity-v1-1.0.0-test",
      package: heritageNightTourScenarioV100,
    });
    expect(release.ref.contentHash)
      .toBe(heritageNightTourScenarioV100ContentHash);
    expect(heritageNightTourScenarioV100.nodes.map((node) => node.nodeId))
      .toEqual(["brief", "source", "release"]);
    expect(
      heritageNightTourScenarioV100.roles.filter(
        (role) => role.actorKind === "student",
      ),
    ).toHaveLength(2);
    expect(
      heritageNightTourScenarioV100.experienceDesign?.npcInstances,
    ).toHaveLength(2);
    expect(
      heritageNightTourScenarioV100.approvalPolicies.some(
        (policy) => policy.reviewMode === "teacher_required",
      ),
    ).toBe(true);

    const serialized = JSON.stringify(heritageNightTourScenarioV100);
    expect(serialized).not.toMatch(
      /scenario-rain-closure|rain-warning|shelter-map|emergency-journalism/u,
    );

    const engine = new WorldEngine({ defaultRelease: release });
    const sessionId = "session-heritage-night-tour-content";
    await engine.createSession(sessionId, true);
    const projection = await engine.getProjection(
      sessionId,
      "student-editor",
    );
    expect(projection.scenario).toMatchObject({
      scenarioId: heritageNightTourScenarioV100.scenarioId,
      version: "1.0.0",
      contentHash: heritageNightTourScenarioV100ContentHash,
    });
    expect(projection.nodes).toHaveLength(3);
    expect(projection.experienceGuide).toMatchObject({
      kind: "micro_transfer",
      currentNodeMapping: {
        nodeId: "brief",
      },
    });
  });

  it("maps all seven flagship nodes to a complete causal branch", () => {
    const design = flagshipScenarioV111.experienceDesign;
    expect(design?.kind).toBe("flagship");
    expect(flagshipScenarioV111.nodes).toHaveLength(7);
    expect(design?.nodeMappings).toHaveLength(7);
    expect(design?.causalBranches).toHaveLength(7);
    expect(new Set(design?.nodeMappings.map((mapping) => mapping.nodeId)))
      .toEqual(new Set(flagshipScenarioV111.nodes.map((node) => node.nodeId)));

    for (const mapping of design?.nodeMappings ?? []) {
      expect(mapping.operationTasks.length).toBeGreaterThan(0);
      expect(mapping.worldOpportunities.length).toBeGreaterThan(0);
      expect(mapping.npcInformationGaps.length).toBeGreaterThan(0);
      expect(mapping.agentContributions.length).toBeGreaterThan(0);
      expect(mapping.dynamicEvents.length).toBeGreaterThan(0);
      expect(mapping.stageDeliverables.length).toBeGreaterThan(0);
      expect(mapping.capabilityEvidence.length).toBeGreaterThan(0);
      expect(design?.causalBranches.some((branch) => (
        branch.nodeId === mapping.nodeId
      ))).toBe(true);
    }
    expect(flagshipScenarioV111.directorEventTemplates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          routeId: "route-rain-escalation",
          applicableNodeIds: ["production"],
          alternativeRouteIds: ["route-recovery-rain-brief"],
        }),
        expect.objectContaining({
          routeId: "route-recovery-rain-brief",
          kind: "recovery",
        }),
      ]),
    );
  });

  it("starts the three-node transfer package for both student roles without projecting NPC private perspectives", async () => {
    const engine = new WorldEngine({ scenario: transferScenarioV100 });
    const sessionId = "session-transfer-content";
    await engine.createSession(sessionId, true);

    const [editor, reporter] = await Promise.all([
      engine.getProjection(sessionId, "student-editor"),
      engine.getProjection(sessionId, "student-reporter"),
    ]);
    expect(editor.scenario).toMatchObject({
      scenarioId: transferScenarioV100.scenarioId,
      version: "1.0.0",
      title: "古镇暴雨闭园应急融媒通报",
    });
    expect(editor.nodes).toHaveLength(3);
    expect(reporter.nodes).toHaveLength(3);
    expect(editor.courseGuide?.activeRoleBrief?.roleId)
      .toBe("responsible_editor");
    expect(reporter.courseGuide?.activeRoleBrief?.roleId).toBe("reporter");
    expect(editor.experienceGuide).toMatchObject({
      kind: "micro_transfer",
      contentVersion: "1.0.0",
      currentNodeMapping: {
        nodeId: "brief",
      },
    });
    expect(
      editor.experienceGuide?.currentNodeMapping?.operationTasks.map(
        (task) => task.taskId,
      ),
    ).toContain("transfer-task-risk-plan");
    expect(reporter.availableRoleInteractions.map((option) => option.optionId))
      .toContain("transfer-reporter-shelter-interview");
    expect(editor.availableRoleInteractions.map((option) => option.optionId))
      .toContain("editor-platform-escalation");

    const serializedStudentProjection = JSON.stringify({
      editor,
      reporter,
    });
    expect(serializedStudentProjection).not.toContain(
      "16:08北门开始关闭",
    );
    expect(serializedStudentProjection).not.toContain(
      "人工复核要求精确版本号",
    );
    expect(serializedStudentProjection).not.toContain("privatePerspective");
    expect(serializedStudentProjection).not.toContain("npcInformationGaps");
    expect(serializedStudentProjection).not.toContain("agentContributions");
    expect(serializedStudentProjection).not.toContain("dynamicEvents");
    expect(serializedStudentProjection).not.toContain(
      "transfer-event-rain-warning",
    );
    expect(serializedStudentProjection).not.toContain(
      "transfer-contribution-course-navigation",
    );
  });

  it("records a configured task choice, waits at the teacher gate, and rebuilds the next scene from events", async () => {
    const engine = new WorldEngine({ scenario: transferScenarioV100 });
    const sessionId = "session-transfer-structured-world";
    await engine.createSession(sessionId, true);

    const initial = await engine.getProjection(sessionId, "student-editor");
    expect(initial.structuredWorld).toMatchObject({
      schemaVersion: "structured-world-stage/1.0.0",
      scene: {
        sceneId: "transfer-scene-command",
        visualMode: "structured_cards",
        phase: "active",
      },
      evidenceContinuity: {
        caseState: "collecting",
        teacherFinalRequired: true,
      },
    });
    expect(
      initial.structuredWorld?.hotspots[0]?.choices[0],
    ).toMatchObject({
      choiceRef: "transfer-task-risk-plan",
      kind: "course_task",
      command: "record_experience_choice",
      enabled: true,
    });

    const chosen = await engine.executeAction(experienceAction({
      sessionId,
      sessionEpoch: initial.sessionEpoch,
      stateVersion: initial.stateVersion,
      teamId: initial.role.teamId,
      choiceRef: "transfer-task-risk-plan",
    }));
    expect(chosen.currentNode.nodeId).toBe("brief");
    expect(chosen.structuredWorld?.tasks[0]).toMatchObject({
      taskId: "transfer-task-risk-plan",
      status: "waiting",
      priority: "normal",
    });
    expect(chosen.structuredWorld?.causalReplay[0]).toMatchObject({
      rootActionId: "action-transfer-risk-plan",
      sourceMode: "world_interaction",
      commandName: "record_experience_choice",
    });
    expect(chosen.structuredWorld?.causalReplay[0]?.evidenceIds)
      .toHaveLength(1);
    expect(chosen.evidence.at(-1)?.action).toContain(
      "完成情境任务选择",
    );

    const teacher = await engine.getProjection(sessionId, "teacher-main");
    const candidate = teacher.pendingCandidates.find((item) => (
      item.payload.dynamicEventId === "transfer-event-rain-warning"
    ));
    expect(candidate).toMatchObject({
      eventType: "node_activated",
      approvalPolicyId: "teacher-transfer-event-review",
      evidenceRefs: [chosen.evidence.at(-1)?.evidenceId],
    });
    if (!candidate) throw new Error("迁移任务未形成教师门候选");

    await engine.execute(teacherCommand({
      sessionId,
      stateVersion: teacher.stateVersion,
      candidateId: candidate.candidateId,
    }));
    const reporter = await engine.getProjection(
      sessionId,
      "student-reporter",
    );
    expect(reporter.currentNode.nodeId).toBe("source");
    expect(reporter.structuredWorld?.scene).toMatchObject({
      sceneId: "transfer-scene-shelter",
      phase: "active",
    });
    expect(reporter.structuredWorld?.eventCards[0]).toMatchObject({
      dynamicEventId: "transfer-event-rain-warning",
      eventType: "node_activated",
      title: transferScenarioV100.experienceDesign
        ?.nodeMappings[0]?.dynamicEvents[0]?.worldChanges[0],
      tone: "success",
    });
    expect(
      reporter.structuredWorld?.hotspots.flatMap(
        (hotspot) => hotspot.choices.map((choice) => choice.choiceRef),
      ),
    ).toContain("transfer-reporter-shelter-interview");

    const rebuilt = await engine.getProjection(
      sessionId,
      "student-reporter",
    );
    expect(rebuilt.structuredWorld).toEqual(reporter.structuredWorld);
    const serialized = JSON.stringify(rebuilt.structuredWorld);
    expect(serialized).not.toContain("privatePerspective");
    expect(serialized).not.toContain("withheldInformation");
    expect(serialized).not.toContain("16:08北门开始关门");
  });
});
