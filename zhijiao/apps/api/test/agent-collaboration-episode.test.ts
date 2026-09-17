import { describe, expect, it } from "vitest";
import {
  AgentCollaborationEpisodeSchema,
  CandidateEventSchema,
  ModelProviderHealthSchema,
  WorldEventSchema,
  type ScenarioPackageRef,
} from "@ronggang/contracts";
import {
  buildAgentTopologyManifest,
  buildCrossCourseAgentRuleManifest,
} from "@ronggang/agent-runtime";
import {
  aiCopyrightContractCourseRelease,
  publishXunpuContractCourseRelease,
  rainEmergencyContractCourseRelease,
  villageSuperContractCourseRelease,
  xunpuContractCourseRelease,
} from "@ronggang/course-content";
import {
  migrationRuntimeCourseReleases,
  migrationRuntimeSeedReleases,
} from "@ronggang/world-core";
import {
  AgentCollaborationEpisodeService,
  type BuildCollaborationEpisodeInput,
} from "../src/agent-collaboration-episode.js";

const scenarioReleaseRef: ScenarioPackageRef = {
  releaseId: "release-scenario-xunpu-media-2.0.0-baseline",
  scenarioId: "scenario-xunpu-media",
  version: "2.0.0",
  schemaVersion: "scenario-package/1.0.0",
  contentHash: "f".repeat(64),
};
const courseRelease = publishXunpuContractCourseRelease(
  scenarioReleaseRef,
);
const completionCandidateRef = {
  actionId: "xunpu-topic-submit-card",
  dynamicEventId: "xunpu-topic-brief:advance-event",
  eventType: "node_activated" as const,
  approvalPolicyId: "teacher-xunpu-publication-review",
};
const modelHealth = ModelProviderHealthSchema.parse({
  profileId: "deterministic-v2",
  provider: "deterministic",
  mode: "mock",
  configured: true,
  available: true,
  baseUrl: null,
  models: ["deterministic-v2"],
  reason: null,
});
const service = new AgentCollaborationEpisodeService(
  buildAgentTopologyManifest("2026-08-09T09:00:00.000Z"),
);
const ruleTopology = buildAgentTopologyManifest("2026-08-09T09:00:00.000Z");
const ruleManifest = buildCrossCourseAgentRuleManifest({
  topology: ruleTopology,
  courseReleases: [
    courseRelease,
    villageSuperContractCourseRelease,
    aiCopyrightContractCourseRelease,
    rainEmergencyContractCourseRelease,
  ],
  publishedScenarioRefs: [scenarioReleaseRef],
  generatedAt: "2026-08-09T09:00:00.000Z",
});
const ruleService = new AgentCollaborationEpisodeService(
  ruleTopology,
  ruleManifest,
);
const migrationRuleManifest = buildCrossCourseAgentRuleManifest({
  topology: ruleTopology,
  courseReleases: [xunpuContractCourseRelease, ...migrationRuntimeCourseReleases],
  publishedScenarioRefs: migrationRuntimeSeedReleases.map((release) => release.ref),
  generatedAt: "2026-08-09T09:00:00.000Z",
});
const migrationRuleService = new AgentCollaborationEpisodeService(
  ruleTopology,
  migrationRuleManifest,
);
const trigger = WorldEventSchema.parse({
  schemaVersion: "0.1.0",
  kind: "WorldEvent",
  sessionId: "session-xunpu-v2",
  sceneId: "xunpu-topic-brief",
  actorId: "system",
  messageId: "message-node-xunpu",
  correlationId: "correlation-node-xunpu",
  timestamp: "2026-08-09T09:01:00.000Z",
  eventId: "event-xunpu-node-activated",
  eventType: "node_activated",
  stateVersion: 1,
  visibility: ["assigned_team"],
  visibleToActorIds: [],
  summary: "热榜压力进入选题现场，先核定受众、来源口径和暂缓表述。",
  payload: {
    prompt: "CANARY_PRIVATE_PROMPT",
    privateMemory: "CANARY_PRIVATE_MEMORY",
    providerToken: "CANARY_PROVIDER_TOKEN",
    unrelatedEventId: "event-unrelated-noise",
  },
  actionContext: null,
});

function buildInput(
  audience: BuildCollaborationEpisodeInput["audience"],
  overrides: Partial<BuildCollaborationEpisodeInput> = {},
): BuildCollaborationEpisodeInput {
  return {
    audience,
    projection: {
      sessionId: "session-xunpu-v2",
      scenarioId: "scenario-xunpu-media",
      stateVersion: 1,
      currentNodeId: "xunpu-topic-brief",
      currentSourceEventId: trigger.eventId,
      scenarioReleaseRef,
    },
    courseRelease,
    events: [trigger],
    adviceDecisionAvailable: true,
    completionCandidateRef,
    traceRecords: [],
    actorKinds: { system: "system" },
    modelHealth,
    generatedAt: "2026-08-09T09:02:00.000Z",
    ...overrides,
  };
}

describe("AgentCollaborationEpisodeService", () => {
  it("uses the frozen affected/candidate set and maximum instead of heuristic top-three", () => {
    const episode = ruleService.build(buildInput("teacher"));
    expect(episode.audience).toBe("teacher");
    if (episode.audience !== "teacher") throw new Error("teacher episode expected");
    const selected = episode.affectedAgents.filter((item) => (
      item.decision === "selected"
    ));
    expect(selected).toHaveLength(1);
    expect(selected[0]!.agent.agentId).toBe("agent-scene-director");
    expect(selected[0]!.reasonCode).toBe("event_subscription_match");
    expect(episode.affectedAgents).toHaveLength(14);
  });

  it("does not fill the maximum with candidates that are neither affected nor subscribed", () => {
    for (const courseRelease of migrationRuntimeCourseReleases) {
      const scenarioRelease = migrationRuntimeSeedReleases.find((release) => (
        release.ref.scenarioId === courseRelease.scenarioReleaseRef.scenarioId
      ));
      const ruleCourse = migrationRuleManifest.courses.find((course) => (
        course.courseReleaseRef.courseId === courseRelease.courseId
      ));
      if (!scenarioRelease || !ruleCourse) throw new Error("migration fixture missing");
      for (const chapter of courseRelease.chapters) {
        const ruleChapter = ruleCourse.chapters.find((candidate) => (
          candidate.chapterId === chapter.chapterId
        ));
        if (!ruleChapter) throw new Error("migration rule chapter missing");
        const chapterTrigger = WorldEventSchema.parse({
          ...trigger,
          sessionId: `session-${courseRelease.courseId}`,
          sceneId: chapter.chapterId,
          messageId: `message-${chapter.chapterId}`,
          correlationId: `correlation-${chapter.chapterId}`,
          eventId: `event-${chapter.chapterId}`,
          eventType: "node_activated",
          summary: `进入 ${chapter.title}`,
          payload: {},
        });
        const migrationInput = (
          audience: BuildCollaborationEpisodeInput["audience"],
        ): BuildCollaborationEpisodeInput => ({
          audience,
          projection: {
            sessionId: chapterTrigger.sessionId,
            scenarioId: courseRelease.scenarioReleaseRef.scenarioId,
            stateVersion: chapterTrigger.stateVersion,
            currentNodeId: chapter.chapterId,
            currentSourceEventId: chapterTrigger.eventId,
            scenarioReleaseRef: scenarioRelease.ref,
          },
          courseRelease,
          events: [chapterTrigger],
          adviceDecisionAvailable: true,
          pendingCandidateIds: [],
          traceRecords: [],
          actorKinds: { system: "system" },
          modelHealth,
          generatedAt: "2026-08-09T09:02:00.000Z",
        });
        const episode = migrationRuleService.build(migrationInput("teacher"));
        if (episode.audience !== "teacher") throw new Error("teacher expected");
        const affected = new Set(ruleChapter.resolvedAffectedAgentIds);
        const selected = episode.affectedAgents.filter((item) => (
          item.decision === "selected"
        ));
        expect(selected.length).toBeLessThanOrEqual(
          ruleChapter.maximumSelectedAgents,
        );
        for (const item of selected) {
          const topologyAgent = ruleTopology.agents.find((agent) => (
            agent.agentId === item.agent.agentId
          ));
          expect(
            affected.has(item.agent.agentId)
            || topologyAgent?.subscribedEventTypes.includes("node_activated"),
          ).toBe(true);
        }
        const expectedFirstAgent = ruleTopology.agents
          .filter((agent) => (
            ruleChapter.resolvedCandidateAgentIds.includes(agent.agentId)
            && agent.status === "active"
            && (
              affected.has(agent.agentId)
              || agent.subscribedEventTypes.includes("node_activated")
            )
          ))
          .toSorted((left, right) => (
            Number(affected.has(right.agentId)) - Number(affected.has(left.agentId))
            || Number(right.subscribedEventTypes.includes("node_activated"))
              - Number(left.subscribedEventTypes.includes("node_activated"))
            || left.agentId.localeCompare(right.agentId)
          ))[0];
        const studentEpisode = migrationRuleService.build(
          migrationInput("student"),
        );
        expect(studentEpisode.audience).toBe("student");
        if (studentEpisode.audience !== "student") {
          throw new Error("student expected");
        }
        expect(studentEpisode.suggestion?.agent.agentId).toBe(
          expectedFirstAgent?.agentId,
        );
      }
    }
  });

  it("shows a student exactly one evidence-backed advisory and no technical data", () => {
    const episode = service.build(buildInput("student"));
    expect(AgentCollaborationEpisodeSchema.parse(episode)).toEqual(episode);
    expect(episode).toMatchObject({
      audience: "student",
      status: "suggestion_ready",
      suggestion: {
        allowedDecisions: ["accept", "request_evidence", "reject"],
      },
      studentDecision: null,
      teacherGate: null,
      authorityWriteback: null,
    });
    expect("affectedAgents" in episode).toBe(false);
    expect("execution" in episode).toBe(false);
    const serialized = JSON.stringify(episode);
    expect(serialized).not.toContain("CANARY_PRIVATE_PROMPT");
    expect(serialized).not.toContain("CANARY_PRIVATE_MEMORY");
    expect(serialized).not.toContain("CANARY_PROVIDER_TOKEN");
    expect(serialized).not.toContain("event-unrelated-noise");
  });

  it("shows teachers the selected and skipped business causal set without Trace", () => {
    const episode = service.build(buildInput("teacher"));
    expect(episode.audience).toBe("teacher");
    if (episode.audience !== "teacher") throw new Error("teacher expected");
    expect(episode.status).toBe("in_progress");
    expect(episode.affectedAgents).toHaveLength(14);
    expect(episode.affectedAgents.filter((item) => (
      item.decision === "selected"
    )).length).toBeGreaterThan(0);
    expect(episode.affectedAgents.filter((item) => (
      item.decision === "skipped"
    )).length).toBeGreaterThan(0);
    expect(episode.contributions).toHaveLength(
      episode.affectedAgents.filter((item) => (
        item.decision === "selected"
      )).length,
    );
    expect("execution" in episode).toBe(false);
    expect(JSON.stringify(episode)).not.toContain("trace");
  });

  it("ignores an unrelated candidate review instead of fabricating a teacher gate", () => {
    const unrelatedCandidate = WorldEventSchema.parse({
      ...trigger,
      messageId: "message-unrelated-candidate",
      correlationId: "correlation-unrelated-candidate",
      timestamp: "2026-08-09T09:01:10.000Z",
      eventId: "event-unrelated-candidate",
      eventType: "candidate_event_proposed",
      stateVersion: 2,
      summary: "无关课程的候选事件。",
      payload: {
        candidate: {
          candidateId: "candidate-unrelated",
          eventType: "node_activated",
          title: "无关候选",
          triggerReason: "其他任务",
          competencyTarget: "其他能力",
          expectedImpact: "不应进入当前 Episode",
          payload: {},
          status: "pending",
          proposedBy: "agent-scene-director",
          proposedAt: "2026-08-09T09:01:10.000Z",
          triggerEventIds: ["event-from-another-task"],
        },
      },
      actionContext: null,
    });
    const unrelatedApproval = WorldEventSchema.parse({
      ...trigger,
      messageId: "message-unrelated-approval",
      correlationId: "correlation-unrelated-candidate",
      timestamp: "2026-08-09T09:01:20.000Z",
      eventId: "event-unrelated-approval",
      eventType: "candidate_event_approved",
      stateVersion: 3,
      summary: "其他任务候选已批准。",
      payload: { candidateId: "candidate-unrelated" },
      actionContext: null,
    });
    const episode = service.build(buildInput("teacher", {
      events: [trigger, unrelatedCandidate, unrelatedApproval],
    }));
    expect(episode).toMatchObject({
      audience: "teacher",
      status: "in_progress",
      teacherGate: null,
      authorityWriteback: null,
    });
    expect(JSON.stringify(episode)).not.toContain("candidate-unrelated");
  });

  it("does not expose a pending teacher gate before a real completion candidate exists", () => {
    const decision = WorldEventSchema.parse({
      ...trigger,
      messageId: "message-xunpu-decision-without-completion",
      timestamp: "2026-08-09T09:01:20.000Z",
      eventId: "event-xunpu-decision-without-completion",
      eventType: "experience_choice_recorded",
      stateVersion: 2,
      summary: "学生已处理建议，但尚未完成本节主行动。",
      payload: {
        choiceRef: "xunpu-topic-brief:agent-decision:request_evidence",
        nodeId: "xunpu-topic-brief",
      },
      actionContext: null,
    });
    const episode = service.build(buildInput("teacher", {
      events: [trigger, decision],
      pendingCandidateIds: [],
    }));
    expect(episode).toMatchObject({
      audience: "teacher",
      status: "in_progress",
      studentDecision: { decision: "request_evidence" },
      teacherGate: null,
      authorityWriteback: null,
    });
  });

  it("rejects a candidate with the completion action but the wrong scenario policy", () => {
    const wrongPolicyCandidate = CandidateEventSchema.parse({
      candidateId: "candidate-xunpu-wrong-policy",
      eventType: completionCandidateRef.eventType,
      title: "伪造完成策略候选",
      triggerReason: "完成动作相同但审批策略不属于冻结情境",
      competencyTarget: "选题策划",
      expectedImpact: "不应进入教师门",
      payload: { dynamicEventId: completionCandidateRef.dynamicEventId },
      status: "pending",
      approvalPolicyId: "teacher-wrong-policy",
      proposedBy: "student-reporter",
      proposedAt: "2026-08-09T09:01:30.000Z",
      sourceRefs: [completionCandidateRef.actionId],
    });
    const proposed = WorldEventSchema.parse({
      ...trigger,
      messageId: "message-xunpu-wrong-policy",
      correlationId: "correlation-xunpu-wrong-policy",
      eventId: "event-xunpu-wrong-policy",
      eventType: "candidate_event_proposed",
      stateVersion: 2,
      summary: "错误策略候选等待审批。",
      payload: {
        sourceChoiceRef: completionCandidateRef.actionId,
        candidate: wrongPolicyCandidate,
      },
    });
    const approved = WorldEventSchema.parse({
      ...trigger,
      messageId: "message-xunpu-wrong-policy-approved",
      correlationId: "correlation-xunpu-wrong-policy",
      eventId: "event-xunpu-wrong-policy-approved",
      eventType: "candidate_event_approved",
      stateVersion: 3,
      summary: "错误策略候选被其他内部流程批准。",
      payload: { candidateId: wrongPolicyCandidate.candidateId },
    });
    const episode = service.build(buildInput("teacher", {
      events: [trigger, proposed, approved],
      pendingCandidateIds: [wrongPolicyCandidate.candidateId],
    }));
    expect(episode).toMatchObject({
      audience: "teacher",
      status: "in_progress",
      teacherGate: null,
      authorityWriteback: null,
    });
  });

  it("exposes execution mode and counts only to the administrator audience", () => {
    const episode = service.build(buildInput("admin"));
    expect(episode.audience).toBe("admin");
    if (episode.audience !== "admin") throw new Error("admin expected");
    expect(episode.execution).toMatchObject({
      mode: "deterministic_demo",
      providerId: null,
      failedAgentIds: [],
      traceRefs: [],
    });
    expect(episode.execution.selectedCount + episode.execution.skippedCount)
      .toBe(14);
  });

  it("returns one compact waiting state when no business event exists", () => {
    const episode = service.build(buildInput("teacher", {
      events: [],
      projection: {
        ...buildInput("teacher").projection,
        currentSourceEventId: null,
      },
    }));
    expect(episode).toMatchObject({
      audience: "teacher",
      status: "waiting",
      triggerEvent: null,
      affectedAgents: [],
      contributions: [],
      studentDecision: null,
      teacherGate: null,
      authorityWriteback: null,
    });
  });

  it("does not carry an earlier chapter advice decision into the current chapter", () => {
    const previousDecision = WorldEventSchema.parse({
      ...trigger,
      messageId: "message-xunpu-previous-decision",
      timestamp: "2026-08-09T09:01:30.000Z",
      eventId: "event-xunpu-previous-decision",
      eventType: "experience_choice_recorded",
      stateVersion: 2,
      summary: "上一小节已请求补证。",
      payload: {
        choiceRef: "xunpu-topic-brief:agent-decision:request_evidence",
        nodeId: "xunpu-topic-brief",
      },
    });
    const currentDecision = WorldEventSchema.parse({
      ...previousDecision,
      messageId: "message-xunpu-current-decision",
      timestamp: "2026-08-09T09:01:40.000Z",
      eventId: "event-xunpu-current-decision",
      stateVersion: 3,
      summary: "当前小节已采纳建议。",
      payload: {
        choiceRef: "xunpu-source-map:agent-decision:accept",
        nodeId: "xunpu-source-map",
      },
    });
    const projection = {
      ...buildInput("student").projection,
      stateVersion: 3,
      currentNodeId: "xunpu-source-map",
    };
    expect(service.build(buildInput("student", {
      projection,
      events: [trigger, previousDecision],
    }))).toMatchObject({
      audience: "student",
      studentDecision: null,
    });
    expect(service.build(buildInput("student", {
      projection,
      events: [trigger, previousDecision, currentDecision],
    }))).toMatchObject({
      audience: "student",
      status: "decided",
      studentDecision: { decision: "accept" },
    });
  });

  it("preserves the server-issued suggestion after its decision records newer evidence", () => {
    const initial = service.build(buildInput("student"));
    if (initial.audience !== "student" || !initial.suggestion) {
      throw new Error("student suggestion fixture missing");
    }
    const decision = WorldEventSchema.parse({
      ...trigger,
      messageId: "message-xunpu-current-advice-decision",
      timestamp: "2026-08-09T09:01:30.000Z",
      eventId: "event-xunpu-current-advice-decision",
      eventType: "experience_choice_recorded",
      stateVersion: 2,
      summary: "当前小节已请求补证。",
      payload: {
        choiceRef: "xunpu-topic-brief:agent-decision:request_evidence",
        nodeId: "xunpu-topic-brief",
      },
      actionContext: {
        schemaVersion: "action-envelope/1.0.0",
        actionId: "action-xunpu-current-advice-decision",
        rootActionId: "action-xunpu-current-advice-decision",
        causationId: initial.suggestion.suggestionId,
        commandName: "record_experience_choice",
        sourceMode: "course_platform",
        sourceAssertion: "client_declared",
        payloadHash: "a".repeat(64),
        idempotencyHash: "b".repeat(64),
        actorBindingHash: "c".repeat(64),
        causalDepth: 0,
        objectRefCount: 1,
        evidenceRefCount: 0,
      },
    });
    const decisionEvidence = WorldEventSchema.parse({
      ...trigger,
      messageId: "message-xunpu-current-advice-evidence",
      timestamp: "2026-08-09T09:01:31.000Z",
      eventId: "event-xunpu-current-advice-evidence",
      eventType: "evidence_recorded",
      stateVersion: 3,
      summary: "建议决定已形成过程证据。",
      payload: {},
      actionContext: decision.actionContext,
    });
    const decided = service.build(buildInput("student", {
      projection: {
        ...buildInput("student").projection,
        stateVersion: 3,
        currentSourceEventId: decisionEvidence.eventId,
      },
      events: [trigger, decision, decisionEvidence],
    }));
    expect(decided).toMatchObject({
      audience: "student",
      status: "decided",
      triggerEvent: { eventId: trigger.eventId },
      suggestion: { suggestionId: initial.suggestion.suggestionId },
      studentDecision: { decision: "request_evidence" },
    });
  });

  it("correlates the later final-task candidate to the stable chapter suggestion", () => {
    const initial = service.build(buildInput("student"));
    if (initial.audience !== "student" || !initial.suggestion) {
      throw new Error("student suggestion fixture missing");
    }
    const decision = WorldEventSchema.parse({
      ...trigger,
      messageId: "message-xunpu-gate-advice-decision",
      timestamp: "2026-08-09T09:01:30.000Z",
      eventId: "event-xunpu-gate-advice-decision",
      eventType: "experience_choice_recorded",
      stateVersion: 2,
      summary: "当前小节已请求补证。",
      payload: {
        choiceRef: "xunpu-topic-brief:agent-decision:request_evidence",
        nodeId: "xunpu-topic-brief",
      },
      actionContext: {
        schemaVersion: "action-envelope/1.0.0",
        actionId: "action-xunpu-gate-advice-decision",
        rootActionId: "action-xunpu-gate-advice-decision",
        causationId: initial.suggestion.suggestionId,
        commandName: "record_experience_choice",
        sourceMode: "course_platform",
        sourceAssertion: "client_declared",
        payloadHash: "a".repeat(64),
        idempotencyHash: "b".repeat(64),
        actorBindingHash: "c".repeat(64),
        causalDepth: 0,
        objectRefCount: 1,
        evidenceRefCount: 0,
      },
    });
    const finalTaskContext = {
      ...decision.actionContext!,
      actionId: "action-xunpu-topic-submit-card",
      rootActionId: "action-xunpu-topic-submit-card",
      causationId: "xunpu-topic-submit-card",
    };
    const candidate = WorldEventSchema.parse({
      ...trigger,
      messageId: "message-xunpu-topic-candidate",
      correlationId: "correlation-xunpu-topic-candidate",
      timestamp: "2026-08-09T09:02:00.000Z",
      eventId: "event-xunpu-topic-candidate",
      eventType: "candidate_event_proposed",
      stateVersion: 3,
      summary: "选题卡世界后果等待教师决定。",
      payload: {
        sourceChoiceRef: "xunpu-topic-submit-card",
        candidate: {
          candidateId: "candidate-xunpu-topic",
          eventType: "node_activated",
          title: "提交专题选题卡的世界后果",
          triggerReason: "已完成选题卡",
          competencyTarget: "选题策划",
          expectedImpact: "进入信源地图",
          payload: {
            dynamicEventId: completionCandidateRef.dynamicEventId,
          },
          status: "pending",
          approvalPolicyId: completionCandidateRef.approvalPolicyId,
          proposedBy: "student-reporter",
          proposedAt: "2026-08-09T09:02:00.000Z",
          sourceRefs: ["xunpu-topic-submit-card"],
          triggerEventIds: [],
        },
      },
      actionContext: finalTaskContext,
    });
    const approval = WorldEventSchema.parse({
      ...trigger,
      messageId: "message-xunpu-topic-approved",
      correlationId: "correlation-xunpu-topic-candidate",
      timestamp: "2026-08-09T09:02:10.000Z",
      eventId: "event-xunpu-topic-approved",
      eventType: "candidate_event_approved",
      stateVersion: 4,
      summary: "教师批准选题卡世界后果。",
      payload: { candidateId: "candidate-xunpu-topic" },
      actionContext: {
        ...finalTaskContext,
        actionId: "action-xunpu-topic-approved",
        rootActionId: "action-xunpu-topic-approved",
        causationId: "gate-xunpu-topic",
      },
    });
    const episode = service.build(buildInput("teacher", {
      projection: {
        ...buildInput("teacher").projection,
        stateVersion: 4,
        currentSourceEventId: approval.eventId,
      },
      events: [trigger, decision, candidate, approval],
    }));
    expect(episode).toMatchObject({
      audience: "teacher",
      status: "completed",
      triggerEvent: { eventId: trigger.eventId },
      studentDecision: { decision: "request_evidence" },
      teacherGate: {
        gateId: "gate-xunpu-topic",
        status: "approved",
      },
    });
  });

  it("fails closed on exact scenario hash drift for every audience", () => {
    for (const audience of ["student", "teacher", "admin"] as const) {
      const episode = service.build(buildInput(audience, {
        projection: {
          ...buildInput(audience).projection,
          scenarioReleaseRef: {
            ...scenarioReleaseRef,
            contentHash: "0".repeat(64),
          },
        },
      }));
      expect(episode.status).toBe("failed");
      if (episode.audience === "student") {
        expect(episode.failure?.code).toBe("version_hash_drift");
      } else {
        expect(episode.failureCode).toBe("version_hash_drift");
      }
      expect(episode.authorityWriteback).toBeNull();
    }
  });
});
