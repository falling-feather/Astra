import { describe, expect, it } from "vitest";
import {
  ActionEnvelopeSchema,
  ActionEnvelopeSchemaVersion,
  AgentAssistanceProposalSchema,
  AgentContributionDecisionEventPayloadSchema,
  OutboxRecordSchema,
  SchemaVersion,
  WorldEventSchema,
  createMessageMeta,
  type ActionEnvelope,
  type AgentAssistanceProposal,
} from "@ronggang/contracts";
import { hashValue } from "@ronggang/context-engine";
import {
  InMemoryEventStore,
  InvalidWorldActionError,
  PermissionDeniedError,
  WorldEngine,
} from "../src/index.js";

function sequenceIds() {
  let value = 0;
  return { next: (prefix: string) => `${prefix}-${++value}` };
}

function fixedClock() {
  let second = 0;
  const base = Date.parse("2026-07-31T00:30:00.000Z");
  return { now: () => new Date(base + second++ * 1_000).toISOString() };
}

function proposal(
  sessionId: string,
  expectedStateVersion: number,
): AgentAssistanceProposal {
  return AgentAssistanceProposalSchema.parse({
    kind: "AgentAssistanceProposal",
    assistanceSchemaVersion: "agent-assistance/1.0.0",
    sessionId,
    sceneId: "scenario-local-tourism-media-v0.1",
    actorId: "agent-evidence-coach",
    messageId: "message-proposal-rain-evidence",
    correlationId: "correlation-rain-escalation",
    timestamp: "2026-07-31T00:30:00.000Z",
    schemaVersion: SchemaVersion,
    proposalId: "proposal-rain-evidence",
    agentRunId: "run-rain-evidence",
    roleId: "student_assistant",
    templateRef: {
      templateId: "assistant/evidence-coach",
      templateVersion: "1.0.0",
    },
    instanceRef: {
      instanceId: "instance:assistant/evidence-coach",
      instanceVersion: "assistant-evidence-coach/1.0.0",
    },
    outputSchemaRef: "agent-assistance/evidence-coaching/1.0.0",
    output: {
      kind: "evidence_coaching",
      summary: "请补充第二个独立来源，再形成自己的判断。",
      questions: ["该判断依据哪个材料版本？"],
      evidenceGaps: ["缺少第二来源"],
      verificationPath: ["核对原始材料"],
    },
    subjectActorId: "student-editor",
    resourceRef: null,
    expectedStateVersion,
    causationEventIds: ["flagship-event-rain-escalation"],
    evidenceRefs: ["evidence-rain-warning"],
    citationRefs: ["citation-weather-alert"],
    authority: "advisory_only",
    requiresHumanAction: true,
    visibility: ["role_private", "audit_only"],
    visibleToActorIds: ["student-editor"],
    idempotencyKey: "task:assistant/evidence-coach:assistance",
    expiresAt: null,
  });
}

function decisionPayload(proposalId: string, actorId: string) {
  return AgentContributionDecisionEventPayloadSchema.parse({
    proposalId,
    decision: {
      templateRef: {
        templateId: "assistant/evidence-coach",
        templateVersion: "1.0.0",
      },
      instanceRef: {
        instanceId: "instance:assistant/evidence-coach",
        instanceVersion: "assistant-evidence-coach/1.0.0",
      },
      rolePerspective: "目标学生岗位的证据核验视角",
      basisRefs: [
        { kind: "evidence", refId: "evidence-rain-warning" },
        { kind: "citation", refId: "citation-weather-alert" },
        { kind: "event", refId: "flagship-event-rain-escalation" },
      ],
      permissionSummary:
        "只读目标学生本人可见证据与授权事实；不得确认事实、提交成果或推进节点。",
      decision: "accepted",
      studentReason: "先补第二来源再提交判断。",
      idempotencyKey: `agent-contribution:${hashValue({
        proposalId,
        studentActorId: actorId,
      })}`,
    },
  });
}

function action(
  projection: Awaited<ReturnType<WorldEngine["getProjection"]>>,
  payload: ReturnType<typeof decisionPayload>,
  input: {
    actionId?: string;
    idempotencyKey?: string;
    actorId?: string;
  } = {},
): ActionEnvelope {
  const actorId = input.actorId ?? projection.role.agentId;
  const command = {
    ...createMessageMeta({
      sessionId: projection.sessionId,
      sceneId: projection.scenario.scenarioId,
      actorId,
      correlationId: "correlation-student-decision",
      timestamp: "2026-07-31T00:31:00.000Z",
    }),
    kind: "Command" as const,
    name: "record_agent_contribution_decision" as const,
    expectedStateVersion: projection.stateVersion,
    payload,
  };
  const actionId = input.actionId ?? "action-agent-contribution";
  return ActionEnvelopeSchema.parse({
    kind: "ActionEnvelope",
    envelopeVersion: ActionEnvelopeSchemaVersion,
    actionId,
    idempotencyKey:
      input.idempotencyKey ?? payload.decision.idempotencyKey,
    payloadHash: hashValue(payload),
    source: {
      mode: "course_platform",
      assertion: "client_declared",
      surfaceId: "student-agent-contribution",
      interactionId: payload.proposalId,
    },
    actor: {
      principalId: `principal-${actorId}`,
      bindingId: `binding-${actorId}`,
      actorId,
      actorKind: projection.role.actorKind,
      roleId: projection.role.roleId,
      teamId: projection.role.teamId,
      sessionEpoch: projection.sessionEpoch,
    },
    objectRefs: [{
      objectType: "world_state",
      objectId: projection.sessionId,
      version: String(projection.stateVersion),
    }],
    causality: {
      rootActionId: actionId,
      causationId: actionId,
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

async function fixture() {
  const store = new InMemoryEventStore();
  const engine = new WorldEngine({
    store,
    ids: sequenceIds(),
    clock: fixedClock(),
  });
  const sessionId = "session-agent-contribution-decision";
  await engine.createSession(sessionId, true);
  const beforeProposal = await engine.getProjection(sessionId, "student-editor");
  const assistance = proposal(sessionId, beforeProposal.stateVersion);
  const assistanceEvent = WorldEventSchema.parse({
      ...createMessageMeta({
        sessionId,
        sceneId: beforeProposal.scenario.scenarioId,
        actorId: assistance.actorId,
        correlationId: assistance.correlationId,
        timestamp: assistance.timestamp,
      }),
      kind: "WorldEvent",
      eventId: "event-agent-assistance-recorded",
      eventType: "agent_assistance_recorded",
      stateVersion: beforeProposal.stateVersion + 1,
      visibility: assistance.visibility,
      visibleToActorIds: assistance.visibleToActorIds,
      summary: "证据教练已形成非权威建议",
      payload: { proposal: assistance },
      actionContext: null,
    });
  await store.append(
    sessionId,
    beforeProposal.stateVersion,
    [assistanceEvent],
    [OutboxRecordSchema.parse({
      outboxId: "outbox-agent-assistance-recorded",
      sessionId,
      sessionEpoch: beforeProposal.sessionEpoch,
      sceneId: assistanceEvent.sceneId,
      eventId: assistanceEvent.eventId,
      eventType: assistanceEvent.eventType,
      stateVersion: assistanceEvent.stateVersion,
      correlationId: assistanceEvent.correlationId,
      topic: "world_event",
      causalDepth: 1,
      status: "pending",
      attempts: 0,
      availableAt: assistanceEvent.timestamp,
      createdAt: assistanceEvent.timestamp,
      deliveredAt: null,
      lastErrorCode: null,
    })],
  );
  return { engine, store, sessionId };
}

describe("WorldEngine agent contribution decisions", () => {
  it("persists accepted advice as a non-authoritative student event", async () => {
    const { engine, store, sessionId } = await fixture();
    const student = await engine.getProjection(sessionId, "student-editor");
    const factsBefore = student.facts.length;
    const payload = decisionPayload("proposal-rain-evidence", "student-editor");

    const after = await engine.executeAction(action(student, payload));
    const events = await store.load(sessionId);
    const decisionEvent = events.findLast(
      (event) => event.eventType === "agent_contribution_decided",
    );

    expect(decisionEvent).toMatchObject({
      actorId: "student-editor",
      eventType: "agent_contribution_decided",
      payload,
    });
    expect(after.facts).toHaveLength(factsBefore);
    expect(after.currentNode).toEqual(student.currentNode);
  });

  it("replays an identical key and rejects decision drift", async () => {
    const { engine, store, sessionId } = await fixture();
    const student = await engine.getProjection(sessionId, "student-editor");
    const payload = decisionPayload("proposal-rain-evidence", "student-editor");
    const envelope = action(student, payload);

    await engine.executeAction(envelope);
    await engine.executeAction(envelope);
    expect((await store.load(sessionId)).filter(
      (event) => event.eventType === "agent_contribution_decided",
    )).toHaveLength(1);

    const current = await engine.getProjection(sessionId, "student-editor");
    const changedPayload = {
      ...payload,
      decision: {
        ...payload.decision,
        decision: "rejected" as const,
        studentReason: "改为拒绝。",
      },
    };
    await expect(engine.executeAction(action(current, changedPayload, {
      actionId: "action-agent-contribution-drift",
      idempotencyKey: "different-envelope-key",
    }))).rejects.toBeInstanceOf(InvalidWorldActionError);
  });

  it("denies a different student or a teacher", async () => {
    const { engine, sessionId } = await fixture();
    const reporter = await engine.getProjection(sessionId, "student-reporter");
    const reporterPayload = decisionPayload(
      "proposal-rain-evidence",
      "student-reporter",
    );
    await expect(engine.executeAction(action(reporter, reporterPayload, {
      actorId: "student-reporter",
    }))).rejects.toBeInstanceOf(PermissionDeniedError);

    const teacher = await engine.getProjection(sessionId, "teacher-main");
    const teacherPayload = decisionPayload(
      "proposal-rain-evidence",
      "teacher-main",
    );
    await expect(engine.executeAction(action(teacher, teacherPayload, {
      actorId: "teacher-main",
    }))).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});
