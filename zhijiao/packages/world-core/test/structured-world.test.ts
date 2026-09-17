import { describe, expect, it } from "vitest";
import {
  ScenarioExperienceSchemaVersion,
  type ActionSourceMode,
  type CommandName,
  type Evidence,
  type RoleContract,
  type RoleInteractionOption,
  type RoleInteractionRecord,
  type StudentScenarioExperienceGuide,
  type VisibilityScope,
  type WorldEvent,
} from "@ronggang/contracts";
import {
  buildStructuredWorldStage,
  deriveCurrentTaskAnchor,
  flagshipScenarioV110,
} from "../src/index.js";

function role(actorId: string): RoleContract {
  const result = flagshipScenarioV110.roles.find(
    (candidate) => candidate.agentId === actorId,
  );
  if (!result) throw new Error(`测试缺少角色：${actorId}`);
  return result;
}

function guideFor(
  nodeId: string,
  activeRole: RoleContract,
): StudentScenarioExperienceGuide {
  const design = flagshipScenarioV110.experienceDesign;
  if (!design) throw new Error("旗舰情境缺少体验设计");
  const mapping = design.nodeMappings.find(
    (candidate) => candidate.nodeId === nodeId,
  );
  if (!mapping) throw new Error(`旗舰情境缺少节点映射：${nodeId}`);
  const scenes = design.scenes.filter(
    (scene) => scene.nodeIds.includes(nodeId),
  );
  const sceneIds = new Set(scenes.map((scene) => scene.sceneId));
  const hotspots = design.hotspots.filter((hotspot) => (
    sceneIds.has(hotspot.sceneId)
    && hotspot.visibleToRoleIds.includes(activeRole.roleId)
  ));
  const hotspotIds = new Set(hotspots.map((hotspot) => hotspot.hotspotId));
  return {
    schemaVersion: ScenarioExperienceSchemaVersion,
    contentVersion: design.contentVersion,
    kind: design.kind,
    summary: design.summary,
    currentScenes: scenes,
    currentHotspots: hotspots,
    currentNodeMapping: {
      nodeId,
      operationTasks: mapping.operationTasks.filter(
        (task) => task.roleIds.includes(activeRole.roleId),
      ),
      worldOpportunities: mapping.worldOpportunities.filter(
        (opportunity) => hotspotIds.has(opportunity.hotspotId),
      ),
      stageDeliverables: mapping.stageDeliverables,
      capabilityEvidence: mapping.capabilityEvidence,
    },
    fixedEvaluation: design.fixedEvaluation,
  };
}

function auditContext(input: {
  actionId: string;
  sourceMode: ActionSourceMode;
  commandName: CommandName;
}) {
  return {
    schemaVersion: "action-envelope/1.0.0" as const,
    actionId: input.actionId,
    rootActionId: input.actionId,
    causationId: input.actionId,
    commandName: input.commandName,
    sourceMode: input.sourceMode,
    sourceAssertion: "service_verified" as const,
    payloadHash: "a".repeat(64),
    idempotencyHash: "b".repeat(64),
    actorBindingHash: "c".repeat(64),
    causalDepth: 0,
    objectRefCount: 1,
    evidenceRefCount: 0,
  };
}

function event(input: {
  eventId: string;
  eventType: WorldEvent["eventType"];
  stateVersion: number;
  summary: string;
  payload?: Record<string, unknown>;
  actionId?: string;
  sourceMode?: ActionSourceMode;
  commandName?: CommandName;
}): WorldEvent {
  return {
    kind: "WorldEvent",
    sessionId: "session-structured-world",
    sceneId: flagshipScenarioV110.scenarioId,
    actorId: "system",
    messageId: `message-${input.eventId}`,
    correlationId: `correlation-${input.eventId}`,
    timestamp: new Date(
      Date.parse("2026-07-29T07:00:00.000Z")
      + input.stateVersion * 1_000,
    ).toISOString(),
    schemaVersion: "0.1.0",
    eventId: input.eventId,
    eventType: input.eventType,
    stateVersion: input.stateVersion,
    visibility: ["assigned_team", "audit_only"] as VisibilityScope[],
    visibleToActorIds: [],
    summary: input.summary,
    payload: input.payload ?? {},
    actionContext: input.actionId
      ? auditContext({
          actionId: input.actionId,
          sourceMode: input.sourceMode ?? "world_interaction",
          commandName: input.commandName ?? "send_role_interaction",
        })
      : null,
  };
}

function interaction(input: {
  optionId: string;
  interactionId: string;
  targetActorId: string;
  responseId: string;
  act: "answer" | "clarify" | "refuse" | "commit" | "tool_request";
  stance: "cooperative" | "cautious" | "restricted" | "committed";
  content: string;
  commitmentSummary?: string;
}): RoleInteractionRecord {
  return {
    request: {
      schemaVersion: "role-interaction/1.0.0",
      interactionId: input.interactionId,
      threadId: "thread-structured-world",
      replyToInteractionId: null,
      optionId: input.optionId,
      fromActorId: "student-reporter",
      fromRoleId: "reporter",
      toActorId: input.targetActorId,
      toRoleId: input.targetActorId === "agent-platform"
        ? "platform_operator"
        : "interviewee",
      kind: "question",
      topic: input.targetActorId === "agent-platform"
        ? "platform_review"
        : "heritage_process",
      content: "结构化岗位问题",
      turn: 1,
      relatedEventIds: [],
      createdAt: "2026-07-29T07:00:00.000Z",
    },
    response: {
      schemaVersion: "role-interaction/1.0.0",
      responseId: input.responseId,
      interactionId: input.interactionId,
      threadId: "thread-structured-world",
      fromActorId: input.targetActorId,
      fromRoleId: input.targetActorId === "agent-platform"
        ? "platform_operator"
        : "interviewee",
      toActorId: "student-reporter",
      toRoleId: "reporter",
      act: input.act,
      topic: input.targetActorId === "agent-platform"
        ? "platform_review"
        : "heritage_process",
      content: input.content,
      stance: input.stance,
      commitment: input.commitmentSummary
        ? {
            commitmentId: `commitment-${input.responseId}`,
            ownerActorId: input.targetActorId,
            granteeActorId: "student-reporter",
            sourceInteractionId: input.interactionId,
            summary: input.commitmentSummary,
            dueWhen: "下一节点前",
            status: "active",
            revision: 1,
            expiresAt: null,
            visibleToActorIds: [
              input.targetActorId,
              "student-reporter",
            ],
          }
        : null,
      citedFactIds: [],
      confidence: 0.9,
      createdAt: "2026-07-29T07:00:01.000Z",
    },
    status: "responded",
  };
}

function evidence(input: {
  evidenceId: string;
  action: string;
  eventRef: string;
}): Evidence {
  return {
    evidenceId: input.evidenceId,
    sessionId: "session-structured-world",
    nodeId: "source",
    actorId: "student-reporter",
    action: input.action,
    basis: "岗位响应、世界事件与学生选择可回指同一行动根。",
    materialRefs: [],
    eventRefs: [input.eventRef],
    observationRefs: [],
    artifactRevisionRefs: [],
    processingTaskRefs: [],
    createdAt: "2026-07-29T07:00:02.000Z",
    visibility: ["assigned_team"],
  };
}

function option(
  optionId: string,
  enabled: boolean,
): RoleInteractionOption {
  const configured = flagshipScenarioV110.roleInteractions.find(
    (candidate) => candidate.optionId === optionId,
  );
  if (!configured) throw new Error(`测试缺少互动配置：${optionId}`);
  const target = role(configured.targetActorId);
  return {
    optionId,
    targetActorId: configured.targetActorId,
    targetRoleId: configured.targetRoleId,
    targetDisplayName: target.displayName,
    kind: configured.kind,
    topic: configured.topic,
    label: configured.label,
    description: configured.description,
    enabled,
    disabledReason: enabled ? null : "前置问题尚未完成",
  };
}

describe("GAME-002 structured world projection", () => {
  it("turns source-plan questions and NPC outcomes into role-safe hotspot, todo and evidence state", () => {
    const reporter = role("student-reporter");
    const first = interaction({
      optionId: "reporter-interview-process",
      interactionId: "interaction-process",
      targetActorId: "agent-interviewee",
      responseId: "response-process",
      act: "answer",
      stance: "cooperative",
      content: "我可以确认现场制作流程，但不能确认精确客流。",
    });
    const followup = interaction({
      optionId: "reporter-followup-visitors",
      interactionId: "interaction-visitors",
      targetActorId: "agent-interviewee",
      responseId: "response-visitors",
      act: "commit",
      stance: "committed",
      content: "精确数字需由活动方核验，我承诺补充流程记录。",
      commitmentSummary: "补交可核验的活动流程记录",
    });
    const processEvent = event({
      eventId: "event-process-response",
      eventType: "role_interaction_responded",
      stateVersion: 10,
      summary: "采访对象完成流程回答",
      payload: { response: { interactionId: "interaction-process" } },
      actionId: "action-process",
      sourceMode: "world_interaction",
    });
    const followupEvent = event({
      eventId: "event-followup-response",
      eventType: "role_interaction_responded",
      stateVersion: 14,
      summary: "采访对象明确拒绝边界并作出交接承诺",
      payload: { response: { interactionId: "interaction-visitors" } },
      actionId: "action-followup",
      sourceMode: "world_interaction",
    });
    const processEvidence = evidence({
      evidenceId: "evidence-process",
      action: "完成第一轮信源采访",
      eventRef: processEvent.eventId,
    });
    const followupEvidence = evidence({
      evidenceId: "evidence-followup",
      action: "保留拒绝边界与 NPC 承诺",
      eventRef: followupEvent.eventId,
    });

    const firstProjection = buildStructuredWorldStage({
      scenario: flagshipScenarioV110,
      role: reporter,
      experienceGuide: guideFor("source", reporter),
      scenarioStatus: "running",
      virtualTime: "14:14",
      remainingMinutes: 24,
      riskLevel: "low",
      availableRoleInteractions: [
        option("reporter-interview-process", false),
        option("reporter-followup-visitors", true),
      ],
      roleInteractions: [first],
      events: [processEvent],
      evidence: [processEvidence],
      materials: [],
      activeInterventions: [],
      fixedVisibleEvidenceIds: [],
      teacherFinalized: false,
    });

    expect(firstProjection?.hotspots[0]).toMatchObject({
      targetActorId: "agent-interviewee",
      relationship: "cooperative",
      latestResponse: first.response?.content,
    });
    expect(
      firstProjection?.hotspots[0]?.choices.find(
        (choice) => choice.choiceRef === "reporter-followup-visitors",
      ),
    ).toMatchObject({
      enabled: true,
      command: "send_role_interaction",
    });
    expect(firstProjection?.tasks[0]?.status).toBe("in_progress");
    expect(firstProjection?.signals.map((signal) => signal.kind)).toEqual(
      expect.arrayContaining(["clue", "capability_evidence"]),
    );

    const completedProjection = buildStructuredWorldStage({
      scenario: flagshipScenarioV110,
      role: reporter,
      experienceGuide: guideFor("source", reporter),
      scenarioStatus: "running",
      virtualTime: "14:16",
      remainingMinutes: 22,
      riskLevel: "low",
      availableRoleInteractions: [
        option("reporter-interview-process", false),
        option("reporter-followup-visitors", false),
      ],
      roleInteractions: [first, followup],
      events: [processEvent, followupEvent],
      evidence: [processEvidence, followupEvidence],
      materials: [],
      activeInterventions: [],
      fixedVisibleEvidenceIds: [],
      teacherFinalized: false,
    });
    expect(completedProjection?.hotspots[0]).toMatchObject({
      relationship: "committed",
      latestResponse: followup.response?.content,
    });
    expect(completedProjection?.signals.map((signal) => signal.kind)).toEqual(
      expect.arrayContaining([
        "clue",
        "commitment",
        "capability_evidence",
      ]),
    );
    expect(completedProjection?.tasks[0]?.status).toBe("completed");
    expect(JSON.stringify(completedProjection)).not.toContain(
      "withheldInformation",
    );
  });

  it("uses an applied incident to change scene phase, virtual time, task priority and delivery constraints", () => {
    const editor = role("student-editor");
    const incidentEvent = event({
      eventId: "event-rain-incident",
      eventType: "scenario_intervention_applied",
      stateVersion: 22,
      summary: "暴雨应急情境已生效",
      payload: {
        intervention: { interventionId: "intervention-rain" },
        virtualMinute: 17,
      },
      actionId: "action-teacher-rain",
      sourceMode: "course_platform",
      commandName: "approve_candidate_event",
    });
    const projection = buildStructuredWorldStage({
      scenario: flagshipScenarioV110,
      role: editor,
      experienceGuide: guideFor("production", editor),
      scenarioStatus: "running",
      virtualTime: "14:17",
      remainingMinutes: 21,
      riskLevel: "high",
      availableRoleInteractions: [],
      roleInteractions: [],
      events: [incidentEvent],
      evidence: [],
      materials: [],
      activeInterventions: [{
        interventionId: "intervention-rain",
        riskLevel: "high",
      }] as never,
      fixedVisibleEvidenceIds: [],
      teacherFinalized: false,
    });

    expect(projection?.scene).toMatchObject({
      sceneId: "scene-rain-transition",
      phase: "incident",
      riskLevel: "high",
    });
    expect(projection?.scene.stateTags[0]).toContain("14:17");
    expect(projection?.tasks[0]).toMatchObject({
      taskId: "flagship-task-rain-collaboration",
      priority: "urgent",
    });
    expect(projection?.eventCards[0]?.worldChanges).toEqual(
      expect.arrayContaining([
        expect.stringContaining("任务优先级"),
      ]),
    );
    expect(deriveCurrentTaskAnchor({
      structuredWorld: projection,
      stateVersion: incidentEvent.stateVersion,
      events: [incidentEvent],
    })).toMatchObject({
      taskId: "flagship-task-rain-collaboration",
      phase: "completed",
      stateVersion: 22,
      sourceEventId: incidentEvent.eventId,
      priority: "urgent",
      worldTarget: {
        mode: "world_interaction",
        sceneId: "scene-rain-transition",
        taskId: "flagship-task-rain-collaboration",
      },
      latestFeedbackReason: expect.stringContaining("暴雨应急情境已生效"),
    });
  });

  it("derives explicit no-task and pre-incident anchor states without mutable shadow state", () => {
    expect(deriveCurrentTaskAnchor({
      structuredWorld: null,
      stateVersion: 0,
      events: [],
    })).toEqual({
      taskId: null,
      phase: "no_task",
      stateVersion: 0,
      sourceEventId: null,
      priority: "none",
      worldTarget: null,
      latestFeedbackReason: "当前投影没有可锚定的岗位任务",
    });

    const editor = role("student-editor");
    const projection = buildStructuredWorldStage({
      scenario: flagshipScenarioV110,
      role: editor,
      experienceGuide: guideFor("production", editor),
      scenarioStatus: "running",
      virtualTime: "14:12",
      remainingMinutes: 26,
      riskLevel: "low",
      availableRoleInteractions: [],
      roleInteractions: [],
      events: [],
      evidence: [],
      materials: [],
      activeInterventions: [],
      fixedVisibleEvidenceIds: [],
      teacherFinalized: false,
    });

    expect(deriveCurrentTaskAnchor({
      structuredWorld: projection,
      stateVersion: 18,
      events: [],
    })).toEqual({
      taskId: "flagship-task-rain-collaboration",
      phase: "not_triggered",
      stateVersion: 18,
      sourceEventId: null,
      priority: "normal",
      worldTarget: {
        mode: "world_interaction",
        sceneId: "scene-rain-transition",
        taskId: "flagship-task-rain-collaboration",
      },
      latestFeedbackReason: "当前节点任务已开放",
    });
  });

  it("joins publication reaction, platform consequence and both surfaces into one fixed evidence continuity view", () => {
    const editor = role("student-editor");
    const platform = interaction({
      optionId: "editor-platform-escalation",
      interactionId: "interaction-platform",
      targetActorId: "agent-platform",
      responseId: "response-platform",
      act: "commit",
      stance: "committed",
      content: "平台承诺转人工复核，但不承诺审核通过。",
      commitmentSummary: "保留人工复核回执",
    });
    const responseEvent = event({
      eventId: "event-platform-response",
      eventType: "role_interaction_responded",
      stateVersion: 30,
      summary: "平台形成受控回执",
      payload: { response: { interactionId: "interaction-platform" } },
      actionId: "action-platform",
      sourceMode: "world_interaction",
    });
    const releaseEvent = event({
      eventId: "event-platform-release",
      eventType: "node_activated",
      stateVersion: 34,
      summary: "教师批准平台人工复核后果",
      payload: { nodeId: "release", virtualMinute: 29 },
      actionId: "action-platform-gate",
      sourceMode: "course_platform",
      commandName: "approve_candidate_event",
    });
    const platformEvidence = evidence({
      evidenceId: "evidence-platform",
      action: "完成平台发布治理选择",
      eventRef: responseEvent.eventId,
    });
    const projection = buildStructuredWorldStage({
      scenario: flagshipScenarioV110,
      role: editor,
      experienceGuide: guideFor("release", editor),
      scenarioStatus: "paused",
      virtualTime: "14:29",
      remainingMinutes: 9,
      riskLevel: "high",
      availableRoleInteractions: [
        option("editor-platform-escalation", false),
      ],
      roleInteractions: [platform],
      events: [responseEvent, releaseEvent],
      evidence: [platformEvidence],
      materials: [],
      activeInterventions: [],
      fixedVisibleEvidenceIds: [platformEvidence.evidenceId],
      teacherFinalized: false,
    });

    expect(projection?.scene.phase).toBe("paused");
    expect(projection?.hotspots[0]).toMatchObject({
      targetActorId: "agent-platform",
      relationship: "committed",
    });
    expect(projection?.eventCards[0]).toMatchObject({
      dynamicEventId: "flagship-event-platform-escalation",
      eventType: "node_activated",
      sourceMode: "course_platform",
    });
    expect(projection?.causalReplay).toEqual(expect.arrayContaining([
      expect.objectContaining({
        rootActionId: "action-platform",
        sourceMode: "world_interaction",
        evidenceIds: ["evidence-platform"],
      }),
      expect.objectContaining({
        rootActionId: "action-platform-gate",
        sourceMode: "course_platform",
      }),
    ]));
    expect(projection?.evidenceContinuity).toMatchObject({
      caseState: "fixed",
      visibleEvidenceCount: 1,
      fixedVisibleEvidenceCount: 1,
      sourceModes: expect.arrayContaining([
        "world_interaction",
        "course_platform",
      ]),
    });
  });
});
