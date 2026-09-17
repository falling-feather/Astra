import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ChallengeAssignmentSchemaVersion,
  DialogueTurnRequestV4SchemaVersion,
  SemanticActionRequestV4SchemaVersion,
  type FlagshipWorldRuntimeDefinitionV4,
  type StudentAgentCollaborationEpisodeV3,
} from "@ronggang/contracts";
import {
  InMemoryGroundedCollaborationStoreV4,
  InMemorySimulationCollaborationStoreV3,
  SimulationAgentOrchestratorV3,
  buildXunpuSimulationAgentTemplatesV3R2,
  buildXunpuSimulationTaskInstructionV3,
  createXunpuDeterministicSimulationExecutorsV3R2,
  type GroundedCollaborationModelInputV4,
  type GroundedCollaborationModelV4,
  type SemanticActionParserModelV4,
} from "@ronggang/agent-orchestrator";
import {
  buildXunpuFlagshipRuntimeReleaseV3R2,
  createXunpuFlagshipRuntimeDefinitionV4,
  getXunpuWorldSimulationReleaseV3,
  xunpuFlagshipContentV4,
} from "@ronggang/course-content";
import {
  InMemoryAutonomousWorldStoreV4,
  InMemorySimulationSessionStore,
  WorldSimulationEngineV3,
  XunpuAutonomousWorldDirectorV4,
  type AutonomousNpcDecisionObservationV4,
  type AutonomousNpcDecisionModelV4,
} from "@ronggang/world-core";
import {
  FlagshipExperienceServiceV4,
  flagshipContentReferenceV4Of,
} from "../src/flagship-experience-v4.js";
import { registerFlagshipExperienceV4Routes } from "../src/flagship-experience-v4-routes.js";
import { XunpuWorldDirectorV3 } from "../src/xunpu-world-director-v3.js";
import {
  v3FixedNow,
  v3SequentialIds,
} from "./world-simulation-v3.fixture.js";

const apps: FastifyInstance[] = [];
const fixedDate = new Date("2026-08-28T12:00:00.000Z");

class FailOnceDialogueWorldEngine extends WorldSimulationEngineV3 {
  #failNextDialogueWrite = true;

  releaseDialogueWorldWrite(): void {
    this.#failNextDialogueWrite = false;
  }

  override async submitStudentAction(
    input: Parameters<WorldSimulationEngineV3["submitStudentAction"]>[0],
  ) {
    if (this.#failNextDialogueWrite
      && input.requestId.startsWith("dialogue-world-request-")) {
      throw new Error("injected_interruption_before_dialogue_world_write");
    }
    return super.submitStudentAction(input);
  }
}

async function setup(
  sessionId: string,
  customizeRuntime?: (
    definition: FlagshipWorldRuntimeDefinitionV4,
  ) => FlagshipWorldRuntimeDefinitionV4,
  models?: {
    semanticModel?: SemanticActionParserModelV4;
    groundedModel?: GroundedCollaborationModelV4;
    groundedExecutionBudgetMicros?: number;
    failFirstDialogueWorldWrite?: boolean;
    autonomousDecisionModel?: AutonomousNpcDecisionModelV4;
  },
) {
  const release = buildXunpuFlagshipRuntimeReleaseV3R2(
    getXunpuWorldSimulationReleaseV3().courseReleaseRef,
  );
  const engineOptions = {
    store: new InMemorySimulationSessionStore(),
    now: v3FixedNow,
    idFactory: v3SequentialIds(`world-${sessionId}`),
  };
  const engine = models?.failFirstDialogueWorldWrite
    ? new FailOnceDialogueWorldEngine(engineOptions)
    : new WorldSimulationEngineV3(engineOptions);
  const variant = release.challengeVariants.find((item) => item.challengeLevel === 5)!;
  await engine.startSession({
    sessionId,
    release,
    challengeAssignment: {
      schemaVersion: ChallengeAssignmentSchemaVersion,
      challengeAssignmentId: `challenge-${sessionId}`,
      learnerTwinRef: `learner-twin-${sessionId}`,
      sessionId,
      simulationReleaseRef: release.simulationReleaseRef,
      worldVariantRef: variant.worldVariantId,
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
    },
    targetCompetencyRefs: [
      "competency-professional-communication",
      "competency-source-verification",
    ],
    scaffoldingLevel: 1,
    startedAt: "2026-08-26T03:30:00.000Z",
  });
  const templates = buildXunpuSimulationAgentTemplatesV3R2();
  const orchestrator = new SimulationAgentOrchestratorV3({
    engine,
    store: new InMemorySimulationCollaborationStoreV3(),
    templates,
    executors: createXunpuDeterministicSimulationExecutorsV3R2(templates),
    buildTaskInstruction: buildXunpuSimulationTaskInstructionV3,
    maxSelectedAgents: 5,
    now: v3FixedNow,
    monotonicNowMs: (() => {
      let value = 100;
      return () => value += 5;
    })(),
    idFactory: v3SequentialIds(`agent-${sessionId}`),
  });
  const runtime = { engine, orchestrator };
  const autonomousWorldAuthoritySecret = "autonomous-world-secret-v4-route-tests";
  const autonomy = new XunpuAutonomousWorldDirectorV4({
    store: new InMemoryAutonomousWorldStoreV4(),
    content: xunpuFlagshipContentV4,
    authoritySecret: autonomousWorldAuthoritySecret,
    ...(models?.autonomousDecisionModel
      ? { npcDecisionModel: models.autonomousDecisionModel }
      : {}),
    now: () => fixedDate.toISOString(),
  });
  const worldDirector = new XunpuWorldDirectorV3(engine);
  const flagshipContentRef = flagshipContentReferenceV4Of(release);
  const runtimeDefinition = createXunpuFlagshipRuntimeDefinitionV4(
    flagshipContentRef,
  );
  const experience = new FlagshipExperienceServiceV4({
    engine: runtime.engine,
    orchestrator: runtime.orchestrator,
    groundedStore: new InMemoryGroundedCollaborationStoreV4(),
    selectionSecret: "semantic-selection-secret-v4-route-tests",
    groundedDecisionSecret: "grounded-decision-secret-v4-route-tests",
    groundedWorldAuthoritySecret: "grounded-world-secret-v4-route-tests",
    autonomousDirector: autonomy,
    autonomousWorldAuthoritySecret,
    advanceWorld: (targetSessionId) => worldDirector.advance(targetSessionId),
    flagshipContentRef,
    runtimeDefinition: customizeRuntime
      ? customizeRuntime(structuredClone(runtimeDefinition))
      : runtimeDefinition,
    ...(models?.semanticModel ? { semanticModel: models.semanticModel } : {}),
    ...(models?.groundedModel ? { groundedModel: models.groundedModel } : {}),
    ...(models?.groundedExecutionBudgetMicros === undefined
      ? {}
      : { groundedExecutionBudgetMicros: models.groundedExecutionBudgetMicros }),
    now: () => fixedDate,
  });
  const app = Fastify({ logger: false });
  apps.push(app);
  let authorizeCalls = 0;
  await registerFlagshipExperienceV4Routes(app, {
    experience,
    authorize: ({ bindingId }) => {
      authorizeCalls += 1;
      const audience = bindingId === "binding-admin"
        ? "admin" as const
        : bindingId === "binding-teacher"
          ? "teacher" as const
          : "student" as const;
      return {
        audience,
        principalId: audience === "student" ? "principal-student" : "principal-staff",
        actorId: audience === "student" ? "student-reporter" : "teacher-main",
        bindingId,
      };
    },
  });
  app.setErrorHandler((error, _request, reply) => {
    void reply.status(error instanceof z.ZodError ? 400 : 409).send({
      error: error instanceof Error ? error.message : "unknown",
    });
  });
  return { app, runtime, experience, autonomy, authorizeCalls: () => authorizeCalls };
}

function semanticPayload(input: {
  sessionId: string;
  experience: Record<string, any>;
  objectLabel: string;
  utterance: string;
  requestId: string;
}) {
  const window = input.experience.actionWindow;
  const selection = window.selections.find((item: Record<string, unknown>) => (
    String(item.label).includes(input.objectLabel)
  ));
  if (!selection) throw new Error(`测试选择不存在：${input.objectLabel}`);
  return {
    schemaVersion: SemanticActionRequestV4SchemaVersion,
    requestId: input.requestId,
    sessionId: input.sessionId,
    bindingId: "binding-student",
    actionWindowRef: window.actionWindowRef,
    actionWindowHash: window.actionWindowHash,
    expectedWorldStateVersion: window.worldStateVersion,
    utterance: input.utterance,
    selections: [{
      selectionToken: selection.selectionToken,
      displayKind: selection.displayKind,
    }],
    submittedAt: fixedDate.toISOString(),
  };
}

async function getStudentExperience(app: FastifyInstance, sessionId: string) {
  const response = await app.inject({
    method: "GET",
    url: `/api/v4/sessions/${sessionId}/experience?bindingId=binding-student`,
  });
  expect(response.statusCode).toBe(200);
  return response.json().experience as Record<string, any>;
}

async function acceptCurrent(
  runtime: {
    engine: WorldSimulationEngineV3;
    orchestrator: SimulationAgentOrchestratorV3;
  },
  sessionId: string,
  suffix: string,
): Promise<StudentAgentCollaborationEpisodeV3> {
  const current = await runtime.orchestrator.getCurrentEpisode(sessionId);
  const decided = await runtime.orchestrator.recordStudentDecision({
    sessionId,
    episodeId: current.student.episodeId,
    decisionRef: `decision-${suffix}`,
    decision: "accept",
    rationale: `接受当前专业建议，继续真实岗位行动 ${suffix}。`,
  });
  expect(decided.student.status).toBe("decided");
  return (await runtime.orchestrator.resolveAcceptedEpisode(
    sessionId,
    current.student.episodeId,
  )).student;
}

async function submitSemantic(input: {
  app: FastifyInstance;
  sessionId: string;
  objectLabel: string;
  utterance: string;
  requestId: string;
}) {
  const experience = await getStudentExperience(input.app, input.sessionId);
  return input.app.inject({
    method: "POST",
    url: `/api/v4/sessions/${input.sessionId}/semantic-actions`,
    payload: semanticPayload({ ...input, experience }),
  });
}

async function arrangeResidentMeeting(app: FastifyInstance, runtime: Awaited<ReturnType<typeof setup>>["runtime"], sessionId: string, suffix: string) {
  const view = await getStudentExperience(app, sessionId);
  const start = await app.inject({ method: "POST", url: `/api/v4/sessions/${sessionId}/dialogues`, payload: semanticPayload({ sessionId, experience: view, objectLabel: "林师傅", utterance: "我是融媒体实训记者，只在公共区域采访，我想请您联系愿意交流的居民。", requestId: `${suffix}-open` }) });
  expect(start.statusCode, start.body).toBe(200); expect(start.json().status).toBe("opened");
  let dialogue = start.json().dialogue;
  const lines = ["我是融媒体实训记者，来采访社区日常。我会先征得同意，不拍门牌，居民可以撤回。", "请帮我联系一位愿意受访的居民，我会再次征得同意，不拍私人空间。"];
  for (const [index, utterance] of lines.entries()) {
    const result = await app.inject({ method: "POST", url: `/api/v4/sessions/${sessionId}/dialogues/${dialogue.episode.episodeId}/turns`, payload: {
      schemaVersion: DialogueTurnRequestV4SchemaVersion, requestId: `${suffix}-turn-${index}`, sessionId,
      bindingId: "binding-student", episodeId: dialogue.episode.episodeId, expectedEpisodeRevision: dialogue.episode.turnCount,
      expectedWorldStateVersion: view.worldStateVersion, turnToken: dialogue.turnToken, utterance, submittedAt: fixedDate.toISOString(),
    } });
    expect(result.statusCode, result.body).toBe(200); dialogue = result.json().dialogue;
  }
  expect(dialogue.episode.resolution.routeRef).toBe("dialogue-route-assisted-contact");
  const before = await app.inject({ method: "GET", url: `/api/v4/sessions/${sessionId}/field?bindingId=binding-student` });
  expect(before.json().field.nodes.flatMap((node: any) => node.people).find((person: any) => person.entityId === "entity-community-source").presence.visible).toBe(false);
  expect((await acceptCurrent(runtime, sessionId, suffix)).status).toBe("completed");
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("V4 flagship public experience routes", () => {
  it("retains the issued interaction person and original message when a generic action is normalized", async () => {
    const sessionId = "session-field-generic-message";
    const { app, runtime } = await setup(sessionId);
    const initial = await getStudentExperience(app, sessionId);
    const utterance = "请问本次编辑工单对报道受众、采访范围和事实核查有哪些要求？";
    const payload = semanticPayload({ sessionId, experience: initial, objectLabel: "陈编辑", utterance, requestId: "generic-editor-message" });
    const rejectedContext = await app.inject({ method: "POST", url: `/api/v4/sessions/${sessionId}/semantic-actions`, payload: { ...payload, interactionTargetRef: "entity-community-source" } });
    expect(rejectedContext.statusCode).toBe(400);
    const submitted = await app.inject({ method: "POST", url: `/api/v4/sessions/${sessionId}/semantic-actions`, payload });
    expect(submitted.statusCode, submitted.body).toBe(200);
    expect(submitted.json().execution.status, submitted.body).toBe("world_event_created");
    expect((await runtime.engine.getRecord(sessionId)).studentActions[0]?.interactionTargetRef).toBe("entity-editor");
    const own = await app.inject({ method: "GET", url: `/api/v4/sessions/${sessionId}/field?bindingId=binding-student` });
    expect(own.json().field.actionConversations).toMatchObject([{ targetEntityId: "entity-editor", utterance }]);
    const other = await app.inject({ method: "GET", url: `/api/v4/sessions/${sessionId}/field?bindingId=binding-other-student` });
    expect(other.json().field.actionConversations).toEqual([]);
  });

  it("projects scene nodes and all of the current student's dialogue history without private state or foreign bindings", async () => {
    const sessionId = "session-node-field-projection";
    const { app, runtime } = await setup(sessionId);
    const experience = await getStudentExperience(app, sessionId);
    const before = (await runtime.engine.getRecord(sessionId)).currentSnapshot.stateVersion;
    const empty = await app.inject({ method: "GET", url: `/api/v4/sessions/${sessionId}/field?bindingId=binding-student` });
    expect(empty.statusCode, empty.body).toBe(200);
    const field = empty.json().field;
    expect(field.actionConversations).toEqual([]);
    expect(field.nodes.some((node: { sceneRef: string }) => node.sceneRef === "loc-community-courtyard")).toBe(true);
    expect(new Set(field.nodes.map((node: { sceneRef: string }) => node.sceneRef)).size).toBe(field.nodes.length);
    const gatekeeper = field.selectionBindings.find((binding: { objectId: string }) => binding.objectId === "entity-gatekeeper");
    expect(experience.actionWindow.selections.some((selection: { selectionToken: string }) => selection.selectionToken === gatekeeper.selectionToken)).toBe(true);
    expect(field.dialogues).toEqual([]);
    expect((await runtime.engine.getRecord(sessionId)).currentSnapshot.stateVersion).toBe(before);
    const opened = await app.inject({ method: "POST", url: `/api/v4/sessions/${sessionId}/dialogues`, payload: semanticPayload({ sessionId, experience, objectLabel: "林师傅", utterance: "您好，我是融媒体中心实训记者，只在公共巷道取景，想先确认哪些地方不能进入。", requestId: "node-dialogue-open" }) });
    expect(opened.statusCode, opened.body).toBe(200);
    expect(opened.json().status, opened.body).toBe("opened");
    const own = await app.inject({ method: "GET", url: `/api/v4/sessions/${sessionId}/field?bindingId=binding-student` });
    expect(own.json().field.dialogues).toHaveLength(1);
    expect(own.json().field.dialogues[0].npc.npcRef).toBe("entity-gatekeeper");
    expect(own.body).not.toMatch(/learnerSubjectHash|privateMemory|runtimeReceipts|turnToken/);
    const otherBinding = await app.inject({ method: "GET", url: `/api/v4/sessions/${sessionId}/field?bindingId=binding-other-student` });
    expect(otherBinding.statusCode, otherBinding.body).toBe(200);
    expect(otherBinding.json().field.dialogues).toEqual([]);
    const staff = await app.inject({ method: "GET", url: `/api/v4/sessions/${sessionId}/field?bindingId=binding-teacher` });
    expect(staff.statusCode).not.toBe(200);
  });

  it("returns a concrete unmet prerequisite without redirecting an interview into the workspace", async () => {
    const sessionId = "session-v4-blocked-interview";
    const { app, runtime, experience } = await setup(sessionId, (definition) => {
      definition.phases.find((phase) => !phase.activation.terminal && phase.activation.allHandledEventTypes.length === 0 && phase.activation.anyHandledEventTypes.length === 0)!.npcRefs.push("entity-inheritor");
      return definition;
    });
    const initial = await getStudentExperience(app, sessionId);
    expect(initial.actionWindow.selections.some((item: any) => item.label.includes("黄老师"))).toBe(false);
    const field = (await app.inject({ method: "GET", url: `/api/v4/sessions/${sessionId}/field?bindingId=binding-student` })).json().field;
    expect(field.nodes.flatMap((node: any) => node.people).find((person: any) => person.entityId === "entity-inheritor").presence).toMatchObject({ visible: false, canContact: false, prerequisite: { personRef: "entity-gatekeeper" } });
    await expect(experience.assertFieldAction({ sessionId, bindingId: "binding-student", actorId: "student-reporter", principalId: "principal-student", requestId: "raw-bypass", action: { verb: "ask", targetRef: { objectType: "entity", objectId: "entity-inheritor" }, utterance: "请告诉我技艺细节。" } })).rejects.toThrow("尚未安排人物见面");
    expect((await runtime.engine.getRecord(sessionId)).studentActions).toEqual([]);
  });

  it("allows source verification before the first community interview through real signed action windows", async () => {
    const sessionId = "session-v4-source-first-path";
    const { app, runtime } = await setup(sessionId);
    const source = await submitSemantic({ app, sessionId, objectLabel: "原始来源包", utterance: "把国家级名录、地方标准和网络转引并列比较，标出原始发布机关、年份、定位和仍待核的起源主张。", requestId: "source-first-compare" });
    expect(source.statusCode, source.body).toBe(200);
    expect(source.json().execution).toMatchObject({ status: "world_event_created", eventTemplateId: "event-template-compare-sources" });
    expect((await acceptCurrent(runtime, sessionId, "source-first-compare")).status).toBe("completed");
    expect((await getStudentExperience(app, sessionId)).actionWindow.selections.some((item: any) => item.label.includes("阿环"))).toBe(false);
    await arrangeResidentMeeting(app, runtime, sessionId, "source-first-introduction");
    const community = await submitSemantic({ app, sessionId, objectLabel: "阿环", utterance: "如果涉及家人，您可以匿名、删题、拒答或撤回；请告诉我哪些内容可以公开。", requestId: "source-first-community" });
    expect(community.statusCode, community.body).toBe(200);
    expect(community.json().execution).toMatchObject({ status: "world_event_created", eventTemplateId: "event-template-community-source" });
    const pending = await acceptCurrent(runtime, sessionId, "source-first-community");
    expect(pending.teacherGate?.status).toBe("pending");
    const approved = await runtime.orchestrator.decideTeacherGate({ sessionId, episodeId: pending.episodeId, decision: "approved", teacherDecisionRef: "teacher-source-first-community", revisionPolicy: null, revisedConsequenceSummary: null });
    expect(approved.student.status).toBe("completed");
    const record = await runtime.engine.getRecord(sessionId);
    expect(record.queue.filter((event) => event.sourceKind === "student_action").map((event) => [event.eventType, event.status])).toEqual([
      ["student_compares_sources", "committed"], ["student_asks_gatekeeper", "committed"], ["student_asks_community_source", "committed"],
    ]);
  });

  it("runs a two-turn gatekeeper dialogue before creating exactly one authoritative event", async () => {
    const sessionId = "session-v4-dialogue-gatekeeper";
    const observations: AutonomousNpcDecisionObservationV4[] = [];
    const autonomousDecisionModel: AutonomousNpcDecisionModelV4 = {
      async decide(input) {
        observations.push(structuredClone(input));
        return {
          output: {
            disposition: "no_action",
            selectedPlanRef: null,
            deferUntilVirtualMinute: null,
            rationale: "当前仅记录公开承诺和已披露事实，不主动创造额外行动。",
          },
          providerId: "test-autonomy-provider",
          modelId: "test-autonomy-model",
          traceRef: "test-autonomy-trace",
          latencyMs: 0,
          estimatedCostMicros: 0,
        };
      },
    };
    const { app, runtime, experience, autonomy } = await setup(sessionId, undefined, {
      autonomousDecisionModel,
    });
    const initial = await getStudentExperience(app, sessionId);
    const openingUtterance = "您好，我是融媒体中心实训记者，只在公共巷道取景，想先确认哪些地方不能进入。";
    const opened = await app.inject({
      method: "POST",
      url: `/api/v4/sessions/${sessionId}/dialogues`,
      payload: semanticPayload({
        sessionId,
        experience: initial,
        objectLabel: "林师傅",
        utterance: openingUtterance,
        requestId: "request-dialogue-gatekeeper-open",
      }),
    });
    expect(opened.statusCode, opened.body).toBe(200);
    expect(opened.json().status, opened.body).toBe("opened");
    expect(opened.json()).toMatchObject({
      schemaVersion: "dialogue-start-response/4.0.0",
      status: "opened",
      dialogue: {
        audience: "student",
        episode: {
          status: "active",
          npc: { displayName: "林师傅" },
          turnCount: 0,
          openingStudentUtterance: openingUtterance,
        },
      },
    });
    const openedDialogue = opened.json().dialogue;
    expect(openedDialogue.turnToken).toMatch(/^dialogueturn_/u);
    expect((await runtime.engine.getRecord(sessionId)).studentActions).toHaveLength(0);

    const firstPayload = {
      schemaVersion: DialogueTurnRequestV4SchemaVersion,
      requestId: "request-dialogue-gatekeeper-turn-1",
      sessionId,
      bindingId: "binding-student",
      episodeId: openedDialogue.episode.episodeId,
      expectedEpisodeRevision: 0,
      expectedWorldStateVersion: 0,
      turnToken: openedDialogue.turnToken,
      utterance: "我是参加课程实训的学生记者，来采访社区日常。我会先征得同意，不拍门牌，居民可以撤回。",
      submittedAt: fixedDate.toISOString(),
    };
    const first = await app.inject({
      method: "POST",
      url: `/api/v4/sessions/${sessionId}/dialogues/${openedDialogue.episode.episodeId}/turns`,
      payload: firstPayload,
    });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json().dialogue.episode).toMatchObject({
      status: "active",
      turnCount: 1,
      openingStudentUtterance: openingUtterance,
      issues: [
        { status: "satisfied" },
        { status: "satisfied" },
      ],
    });
    expect((await runtime.engine.getRecord(sessionId)).studentActions).toHaveLength(0);

    const secondPayload = {
      schemaVersion: DialogueTurnRequestV4SchemaVersion,
      requestId: "request-dialogue-gatekeeper-turn-2",
      sessionId,
      bindingId: "binding-student",
      episodeId: openedDialogue.episode.episodeId,
      expectedEpisodeRevision: 1,
      expectedWorldStateVersion: 0,
      turnToken: first.json().dialogue.turnToken,
      utterance: "请帮我联系一位愿意受访的居民，我会再次征得同意。",
      submittedAt: fixedDate.toISOString(),
    };
    const second = await app.inject({
      method: "POST",
      url: `/api/v4/sessions/${sessionId}/dialogues/${openedDialogue.episode.episodeId}/turns`,
      payload: secondPayload,
    });
    expect(second.statusCode, second.body).toBe(200);
    expect(second.json().dialogue).toMatchObject({
      audience: "student",
      turnToken: null,
      episode: {
        status: "resolved",
        turnCount: 2,
        resolution: {
          routeRef: "dialogue-route-assisted-contact",
          worldEventRef: expect.any(String),
        },
      },
    });
    const record = await runtime.engine.getRecord(sessionId);
    expect(record.studentActions).toHaveLength(1);
    expect(record.studentActions[0]).toMatchObject({
      action: { verb: "ask", targetRef: { objectId: "entity-gatekeeper" } },
      reflectionNote: expect.stringContaining(openingUtterance),
    });
    expect(record.queue).toHaveLength(1);

    const replay = await app.inject({
      method: "POST",
      url: `/api/v4/sessions/${sessionId}/dialogues/${openedDialogue.episode.episodeId}/turns`,
      payload: secondPayload,
    });
    expect(replay.statusCode, replay.body).toBe(200);
    expect((await runtime.engine.getRecord(sessionId)).studentActions).toHaveLength(1);

    const teacher = await app.inject({
      method: "GET",
      url: `/api/v4/sessions/${sessionId}/dialogue?bindingId=binding-teacher`,
    });
    expect(teacher.statusCode).toBe(200);
    expect(teacher.json().dialogue).toMatchObject({
      audience: "teacher",
      turnToken: null,
      episode: {
        causalSummary: {
          elapsedDialogueMinutes: 4,
          unresolvedIssueRefs: [],
        },
      },
    });
    const admin = await app.inject({
      method: "GET",
      url: `/api/v4/sessions/${sessionId}/dialogue?bindingId=binding-admin`,
    });
    expect(admin.statusCode).toBe(200);
    expect(admin.json().dialogue.episode.runtime.receipts).toHaveLength(2);
    const completed = await acceptCurrent(runtime, sessionId, "dialogue-gatekeeper");
    expect(completed.consequence).toMatchObject({ status: "committed" });
    await experience.onWorldSettled(sessionId);
    const fieldHistory = await app.inject({ method: "GET", url: `/api/v4/sessions/${sessionId}/field?bindingId=binding-student` });
    expect(fieldHistory.json().field.dialogues).toHaveLength(1);
    expect(fieldHistory.json().field.actionConversations).toEqual([]);
    const synchronized = await app.inject({
      method: "GET",
      url: `/api/v4/sessions/${sessionId}/dialogue?bindingId=binding-student`,
    });
    expect(synchronized.json().dialogue.episode.resolution).toMatchObject({
      resultingWorldStateVersion: 1,
      consequenceRef: completed.consequence?.resolutionId,
    });
    const worldRecord = await runtime.engine.getRecord(sessionId);
    const autonomous = await autonomy.getRecord(sessionId);
    const gatekeeper = autonomous.npcStates.find(
      (npc) => npc.entityId === "entity-gatekeeper",
    );
    expect(gatekeeper?.commitments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        publicSummary: expect.stringContaining("重新说明采访用途"),
        status: "active",
        sourceWorldEventRef: worldRecord.queue[0]!.eventId,
      }),
    ]));
    expect(gatekeeper?.localFacts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        factRef: "fact-gatekeeper-contact-window",
        visibility: "student_public",
        confidence: 0.55,
        knowledgeRefs: expect.arrayContaining(["xunpu-k016-interview-consent-and-custom"]),
        sourceWorldEventRef: worldRecord.queue[0]!.eventId,
      }),
    ]));
    expect(observations.some((observation) => observation.candidates.some((candidate) => (
      candidate.actorEntityRef === "entity-gatekeeper"
        && candidate.localObservation.commitments.some((commitment) => (
          commitment.publicSummary.includes("重新说明采访用途")
        ))
        && candidate.localObservation.localFacts.some((fact) => (
          fact.factRef === "fact-gatekeeper-contact-window"
            && fact.confidence === 0.55
        ))
    )))).toBe(true);
    expect(JSON.stringify(second.json())).not.toMatch(/learnerSubjectHash|privateBoundaryHash|candidateRuleRefs/u);
    expect(JSON.stringify(teacher.json())).not.toMatch(
      /learnerSubjectHash|privateBoundaryHash|candidateRuleRefs|selectedRuleRef/u,
    );
  });

  it("保留开场原话，跨 guarded 回合后用完整边界依据完成公共观察世界结算", async () => {
    const sessionId = "session-v4-dialogue-opening-basis";
    const { app, runtime } = await setup(sessionId);
    const initial = await getStudentExperience(app, sessionId);
    const opening = "您好，我是融媒体中心实训记者，想采访公共区域里的游客体验，可以先确认哪些地方不能进吗？";
    const opened = await app.inject({
      method: "POST",
      url: `/api/v4/sessions/${sessionId}/dialogues`,
      payload: semanticPayload({
        sessionId,
        experience: initial,
        objectLabel: "林师傅",
        utterance: opening,
        requestId: "request-dialogue-opening-basis-open",
      }),
    });
    expect(opened.statusCode, opened.body).toBe(200);
    const openedDialogue = opened.json().dialogue;
    expect(openedDialogue.episode.openingStudentUtterance).toBe(opening);
    let turnToken = openedDialogue.turnToken;
    const firstUtterance = "我代表学校融媒体实训小组，想采访愿意交流的社区居民和游客，只在公共区域记录，不进入民居，也不拍摄门牌和未同意的人。"
      + "保留时间、对象、未知项；".repeat(60);
    const thirdUtterance = "我代表学校融媒体实训小组，先在公共区域观察游客体验，不进入私人空间、不拍门牌和未授权居民。有人不同意或撤回，我就停止记录并删除对应素材，保留匿名替代方式。"
      + "保留匿名替代方式和更正入口；".repeat(90);

    const turn = async (requestId: string, revision: number, utterance: string) => {
      const response = await app.inject({
        method: "POST",
        url: `/api/v4/sessions/${sessionId}/dialogues/${openedDialogue.episode.episodeId}/turns`,
        payload: {
          schemaVersion: DialogueTurnRequestV4SchemaVersion,
          requestId,
          sessionId,
          bindingId: "binding-student",
          episodeId: openedDialogue.episode.episodeId,
          expectedEpisodeRevision: revision,
          expectedWorldStateVersion: 0,
          turnToken,
          utterance,
          submittedAt: fixedDate.toISOString(),
        },
      });
      if (response.statusCode === 200) turnToken = response.json().dialogue.turnToken;
      return response;
    };
    const first = await turn(
      "request-dialogue-opening-basis-turn-1",
      0,
      firstUtterance,
    );
    expect(first.statusCode, first.body).toBe(200);
    const second = await turn(
      "request-dialogue-opening-basis-turn-2",
      1,
      "我选择先观察核对，再决定下一步。",
    );
    expect(second.statusCode, second.body).toBe(200);
    expect(second.json().dialogue.episode.status).toBe("active");
    const third = await turn(
      "request-dialogue-opening-basis-turn-3",
      2,
      thirdUtterance,
    );
    expect(third.statusCode, third.body).toBe(200);
    expect(third.json().dialogue.episode).toMatchObject({
      status: "resolved",
      resolution: { routeRef: "dialogue-route-public-edge" },
    });
    const record = await runtime.engine.getRecord(sessionId);
    expect(record.studentActions).toHaveLength(1);
    expect(record.studentActions[0]?.reflectionNote?.length).toBeGreaterThan(2_000);
    expect(record.studentActions[0]?.reflectionNote).toContain(opening);
    expect(record.studentActions[0]?.reflectionNote).toContain("删除对应素材");
    expect(record.queue[0]?.eventType).toBe("student_asks_gatekeeper");
  });

  it("在累计原话超过总边界时先拒绝，不形成不可恢复的 pending 世界写入", async () => {
    const sessionId = "session-v4-dialogue-overall-boundary";
    const { app, runtime } = await setup(sessionId);
    const initial = await getStudentExperience(app, sessionId);
    const fitTurnLimit = (prefix: string) => (
      `${prefix}${"补充可核验记录。".repeat(500)}`.slice(0, 2_000)
    );
    const opened = await app.inject({
      method: "POST",
      url: `/api/v4/sessions/${sessionId}/dialogues`,
      payload: semanticPayload({
        sessionId,
        experience: initial,
        objectLabel: "林师傅",
        utterance: "您好，我是融媒体中心实训记者，想采访公共区域里的游客体验，可以先确认哪些地方不能进吗？",
        requestId: "request-dialogue-overall-boundary-open",
      }),
    });
    expect(opened.statusCode, opened.body).toBe(200);
    const openedDialogue = opened.json().dialogue;
    let turnToken = openedDialogue.turnToken;
    const submitTurn = async (requestId: string, revision: number, utterance: string) => {
      const response = await app.inject({
        method: "POST",
        url: `/api/v4/sessions/${sessionId}/dialogues/${openedDialogue.episode.episodeId}/turns`,
        payload: {
          schemaVersion: DialogueTurnRequestV4SchemaVersion,
          requestId,
          sessionId,
          bindingId: "binding-student",
          episodeId: openedDialogue.episode.episodeId,
          expectedEpisodeRevision: revision,
          expectedWorldStateVersion: 0,
          turnToken,
          utterance,
          submittedAt: fixedDate.toISOString(),
        },
      });
      if (response.statusCode === 200) turnToken = response.json().dialogue.turnToken;
      return response;
    };
    expect((await submitTurn(
      "request-dialogue-overall-boundary-turn-1",
      0,
      fitTurnLimit("我代表学校融媒体实训小组，想采访愿意交流的社区居民和游客，只在公共区域记录，不进入民居，也不拍摄门牌和未同意的人。"),
    )).statusCode).toBe(200);
    expect((await submitTurn(
      "request-dialogue-overall-boundary-turn-2",
      1,
      fitTurnLimit("我选择先观察核对，再决定下一步。"),
    )).statusCode).toBe(200);
    expect((await submitTurn(
      "request-dialogue-overall-boundary-turn-3",
      2,
      fitTurnLimit("我继续核对当前边界，不急着进入。"),
    )).statusCode).toBe(200);
    const rejected = await submitTurn(
      "request-dialogue-overall-boundary-turn-4",
      3,
      fitTurnLimit("我代表学校融媒体实训小组，先在公共区域观察游客体验，不进入私人空间、不拍门牌和未授权居民。有人不同意或撤回，我就停止记录并删除对应素材，保留匿名替代方式。"),
    );
    expect(rejected.statusCode, rejected.body).not.toBe(200);
    expect((await runtime.engine.getRecord(sessionId)).studentActions).toHaveLength(0);
    const current = await app.inject({
      method: "GET",
      url: `/api/v4/sessions/${sessionId}/dialogue?bindingId=binding-student`,
    });
    expect(current.statusCode).toBe(200);
    expect(current.json().dialogue.episode).toMatchObject({ status: "active", turnCount: 3 });
  });

  it("supports an explicit exit without world writes and allows a fresh field window after replay", async () => {
    const sessionId = "session-v4-dialogue-exit";
    const { app, runtime, experience } = await setup(sessionId);
    const initial = await getStudentExperience(app, sessionId);
    const opened = await app.inject({
      method: "POST",
      url: `/api/v4/sessions/${sessionId}/dialogues`,
      payload: semanticPayload({
        sessionId,
        experience: initial,
        objectLabel: "林师傅",
        utterance: "您好，我是融媒体中心实训记者，只在公共巷道取景，想先确认哪些地方不能进入。",
        requestId: "request-dialogue-exit-open",
      }),
    });
    expect(opened.statusCode, opened.body).toBe(200);
    const dialogue = opened.json().dialogue;
    const exitPayload = {
      schemaVersion: DialogueTurnRequestV4SchemaVersion,
      requestId: "request-dialogue-exit-turn",
      sessionId,
      bindingId: "binding-student",
      episodeId: dialogue.episode.episodeId,
      expectedEpisodeRevision: 0,
      expectedWorldStateVersion: 0,
      turnToken: dialogue.turnToken,
      utterance: "我先结束对话，谢谢。",
      submittedAt: fixedDate.toISOString(),
    };
    const exited = await app.inject({
      method: "POST",
      url: `/api/v4/sessions/${sessionId}/dialogues/${dialogue.episode.episodeId}/turns`,
      payload: exitPayload,
    });
    expect(exited.statusCode, exited.body).toBe(200);
    expect(exited.json().dialogue).toMatchObject({
      audience: "student",
      turnToken: null,
      episode: { status: "exited", turnCount: 1 },
    });
    expect((await runtime.engine.getRecord(sessionId)).studentActions).toHaveLength(0);

    const replay = await app.inject({
      method: "POST",
      url: `/api/v4/sessions/${sessionId}/dialogues/${dialogue.episode.episodeId}/turns`,
      payload: exitPayload,
    });
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json().dialogue.episode.turnCount).toBe(1);
    expect((await runtime.engine.getRecord(sessionId)).studentActions).toHaveLength(0);

    const refreshed = await getStudentExperience(app, sessionId);
    expect(refreshed.actionWindow).not.toBeNull();
    const current = await experience.getCurrentDialogueForAudience({
      sessionId,
      bindingId: "binding-student",
      audience: "student",
      actorId: "student-reporter",
      principalId: "principal-student",
    });
    expect(current?.episode.status).toBe("exited");
  });

  it("resumes a durably prepared dialogue resolution after an interrupted world write", async () => {
    const sessionId = "session-v4-dialogue-recovery";
    const { app, runtime, experience } = await setup(sessionId, undefined, {
      failFirstDialogueWorldWrite: true,
    });
    const initial = await getStudentExperience(app, sessionId);
    const opened = await app.inject({
      method: "POST",
      url: `/api/v4/sessions/${sessionId}/dialogues`,
      payload: semanticPayload({
        sessionId,
        experience: initial,
        objectLabel: "林师傅",
        utterance: "您好，我是课程实训记者，想先说明采访范围并确认居民边界。",
        requestId: "request-dialogue-recovery-open",
      }),
    });
    const dialogue = opened.json().dialogue;
    const first = await app.inject({
      method: "POST",
      url: `/api/v4/sessions/${sessionId}/dialogues/${dialogue.episode.episodeId}/turns`,
      payload: {
        schemaVersion: DialogueTurnRequestV4SchemaVersion,
        requestId: "request-dialogue-recovery-turn-1",
        sessionId,
        bindingId: "binding-student",
        episodeId: dialogue.episode.episodeId,
        expectedEpisodeRevision: 0,
        expectedWorldStateVersion: 0,
        turnToken: dialogue.turnToken,
        utterance: "我是课程实训学生记者，来采访社区日常。我会先征得同意，不拍门牌，居民可以撤回。",
        submittedAt: fixedDate.toISOString(),
      },
    });
    const interrupted = await app.inject({
      method: "POST",
      url: `/api/v4/sessions/${sessionId}/dialogues/${dialogue.episode.episodeId}/turns`,
      payload: {
        schemaVersion: DialogueTurnRequestV4SchemaVersion,
        requestId: "request-dialogue-recovery-turn-2",
        sessionId,
        bindingId: "binding-student",
        episodeId: dialogue.episode.episodeId,
        expectedEpisodeRevision: 1,
        expectedWorldStateVersion: 0,
        turnToken: first.json().dialogue.turnToken,
        utterance: "请联系一位愿意受访的居民，我会再次说明用途并征得同意。",
        submittedAt: fixedDate.toISOString(),
      },
    });
    expect(interrupted.statusCode, interrupted.body).toBe(409);
    expect((await runtime.engine.getRecord(sessionId)).studentActions).toHaveLength(0);
    const pending = await experience.getCurrentDialogueForAudience({
      sessionId,
      bindingId: "binding-admin",
      audience: "admin",
      actorId: "teacher-main",
      principalId: "principal-staff",
    });
    expect(pending?.episode.status).toBe("resolution_pending");
    expect(runtime.engine).toBeInstanceOf(FailOnceDialogueWorldEngine);
    if (!(runtime.engine instanceof FailOnceDialogueWorldEngine)) {
      throw new Error("test engine must support controlled recovery");
    }
    runtime.engine.releaseDialogueWorldWrite();
    await expect(experience.recoverPendingDialogues()).resolves.toEqual({ recovered: 1 });
    await expect(experience.recoverPendingDialogues()).resolves.toEqual({ recovered: 0 });
    expect((await runtime.engine.getRecord(sessionId)).studentActions).toHaveLength(1);
    const recovered = await experience.getCurrentDialogueForAudience({
      sessionId,
      bindingId: "binding-student",
      audience: "student",
      actorId: "student-reporter",
      principalId: "principal-student",
    });
    expect(recovered?.episode.status).toBe("resolved");
    expect(recovered?.episode.resolution?.worldEventRef).toEqual(expect.any(String));
  });

  it("fails forged dialogue tokens and teacher mutations before any world write", async () => {
    const sessionId = "session-v4-dialogue-security";
    const { app, runtime } = await setup(sessionId);
    const initial = await getStudentExperience(app, sessionId);
    const opened = await app.inject({
      method: "POST",
      url: `/api/v4/sessions/${sessionId}/dialogues`,
      payload: semanticPayload({
        sessionId,
        experience: initial,
        objectLabel: "林师傅",
        utterance: "您好，我是融媒体中心实训记者，只在公共巷道取景，想先确认哪些地方不能进入。",
        requestId: "request-dialogue-security-open",
      }),
    });
    const dialogue = opened.json().dialogue;
    const base = {
      schemaVersion: DialogueTurnRequestV4SchemaVersion,
      requestId: "request-dialogue-security-turn",
      sessionId,
      bindingId: "binding-student",
      episodeId: dialogue.episode.episodeId,
      expectedEpisodeRevision: 0,
      expectedWorldStateVersion: 0,
      turnToken: `dialogueturn_${"f".repeat(48)}`,
      utterance: "我是学生记者，会先征得同意，不拍门牌并允许撤回。",
      submittedAt: fixedDate.toISOString(),
    };
    const forged = await app.inject({
      method: "POST",
      url: `/api/v4/sessions/${sessionId}/dialogues/${dialogue.episode.episodeId}/turns`,
      payload: base,
    });
    expect(forged.statusCode).toBe(409);
    expect((await runtime.engine.getRecord(sessionId)).studentActions).toHaveLength(0);

    const teacher = await app.inject({
      method: "POST",
      url: `/api/v4/sessions/${sessionId}/dialogues/${dialogue.episode.episodeId}/turns`,
      payload: { ...base, bindingId: "binding-teacher", turnToken: dialogue.turnToken },
    });
    expect(teacher.statusCode).toBe(409);
    expect((await runtime.engine.getRecord(sessionId)).studentActions).toHaveLength(0);
  });

  it("uses an injected compiled world definition instead of an API hard-coded phase prompt", async () => {
    const sessionId = "session-v4-runtime-definition";
    const { app, experience } = await setup(sessionId, (definition) => {
      definition.definitionId = "xunpu-alternate-runtime-v4";
      const opening = definition.phases.find((phase) => phase.priority === 0)!;
      opening.prompt = "替代运行时定义：先确认当前地点与采访边界。";
      return definition;
    });
    const view = await getStudentExperience(app, sessionId);
    expect(view.actionWindow.prompt).toBe(
      "替代运行时定义：先确认当前地点与采访边界。",
    );
    expect(experience.runtimeDefinition).toMatchObject({
      definitionId: "xunpu-alternate-runtime-v4",
      definitionHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
  });

  it("turns free text plus signed objects into one authoritative world event", async () => {
    const sessionId = "session-v4-free-action";
    const { app, runtime } = await setup(sessionId);
    const initial = await getStudentExperience(app, sessionId);
    expect(initial).toMatchObject({
      schemaVersion: "flagship-experience-view/4.2.0",
      audience: "student",
      worldStateVersion: 0,
      scene: { sceneRef: "loc-oyster-alley-gate" },
      runtimeDisclosure: { authority: "world_engine_only" },
      worldPulse: {
        status: "npc_action_pending",
        speaker: "林师傅",
      },
    });
    expect(initial.actionWindow.selections.map((selection: { label: string }) => selection.label)).toEqual(expect.arrayContaining([
      expect.stringContaining("原始来源包"), expect.stringContaining("冲突来源包"), expect.stringContaining("主张—证据板"),
    ]));
    expect(initial.scene.environmentImage).toContain("/assets/flagship-world/v4/");

    const action = await app.inject({
      method: "POST",
      url: `/api/v4/sessions/${sessionId}/semantic-actions`,
      payload: semanticPayload({
        sessionId,
        experience: initial,
        objectLabel: "林师傅",
        utterance: "您好，我是融媒体中心实训记者，只在公共巷道取景，想先确认哪些地方不能进入。",
        requestId: "request-v4-free-gatekeeper",
      }),
    });
    expect(action.statusCode).toBe(200);
    expect(action.json()).toMatchObject({
      schemaVersion: "flagship-semantic-action-receipt/4.0.0",
      decision: {
        status: "accepted",
        writeDisposition: "candidate_only",
        canonicalAction: { authorizationCheck: "service_verified" },
      },
      execution: {
        status: "world_event_created",
        eventTemplateId: "event-template-gatekeeper",
        worldStateVersion: 0,
      },
      collaboration: null,
    });
    const record = await runtime.engine.getRecord(sessionId);
    expect(record.studentActions).toHaveLength(1);
    expect(record.studentActions[0]?.action).toMatchObject({ verb: "ask" });
    expect(JSON.stringify(action.json())).not.toMatch(/trace|prompt|provider|private/i);
  });

  it("synchronizes V4 NPC memory from a WorldEngine receipt and opens the next conflict without a browser continue command", async () => {
    const sessionId = "session-v4-autonomous-public";
    const { app, runtime, experience, autonomy } = await setup(sessionId);
    const brief = await submitSemantic({
      app,
      sessionId,
      objectLabel: "陈编辑",
      utterance: "我先观察现场与入口标识，再按编辑工单确定边界：核心受众是关心非遗活态传承的公众；公共价值是呈现蟳埔女作为文化主体的劳动与生活。采访时间预算五分钟，缺少主体同意或原始来源就是放弃条件。",
      requestId: "request-v4-autonomy-topic-brief",
    });
    expect(brief.statusCode, brief.body).toBe(200);
    expect(brief.json()).toMatchObject({
      execution: { eventTemplateId: "event-template-topic-brief" },
    });
    await acceptCurrent(runtime, sessionId, "v4-autonomy-topic-brief");
    expect((await getStudentExperience(app, sessionId)).scene.sceneRef)
      .toBe("loc-oyster-alley-gate");

    const action = await submitSemantic({
      app,
      sessionId,
      objectLabel: "林师傅",
      utterance: "您好，我是融媒体中心实训记者，只拍公共巷道，也会先确认居民是否愿意接受采访。",
      requestId: "request-v4-autonomy-gatekeeper",
    });
    expect(action.statusCode, action.body).toBe(200);
    const completed = await acceptCurrent(runtime, sessionId, "v4-autonomy-gatekeeper");
    expect(completed.consequence?.status).toBe("committed");

    const afterGatekeeper = await experience.onWorldSettled(sessionId);
    expect(afterGatekeeper).toMatchObject({ scheduled: false });
    await arrangeResidentMeeting(app, runtime, sessionId, "autonomy-introduction");

    const communityAction = await submitSemantic({
      app,
      sessionId,
      objectLabel: "阿环",
      utterance: "如果涉及家人，您希望匿名、删掉还是只保留概括？我会把公开范围和撤回方式记入采访记录。",
      requestId: "request-v4-autonomy-community-source",
    });
    expect(communityAction.statusCode, communityAction.body).toBe(200);
    expect(communityAction.json()).toMatchObject({
      decision: { status: "accepted", canonicalAction: { verb: "negotiate" } },
      execution: { eventTemplateId: "event-template-community-source" },
    });
    expect((await runtime.orchestrator.getCurrentEpisode(sessionId)).student.triggerEvent)
      .toMatchObject({ eventType: "student_asks_community_source" });
    const communityCompleted = await acceptCurrent(
      runtime,
      sessionId,
      "v4-autonomy-community-source",
    );
    expect(communityCompleted).toMatchObject({
      status: "decided",
      teacherGate: { status: "pending" },
    });
    const communityApproved = await runtime.orchestrator.decideTeacherGate({
      sessionId,
      episodeId: communityCompleted.episodeId,
      decision: "approved",
      teacherDecisionRef: "teacher-decision-v4-community-boundary",
      revisionPolicy: null,
      revisedConsequenceSummary: null,
    });
    expect(communityApproved.student).toMatchObject({
      status: "completed",
      consequence: { status: "committed" },
    });
    expect(await experience.onWorldSettled(sessionId)).toMatchObject({ scheduled: false });

    const inheritorAction = await submitSemantic({
      app,
      sessionId,
      objectLabel: "黄老师",
      utterance: "黄老师，请您具体说说簪花围技艺在日常劳动和节庆中的不同经历与变化，哪些属于您的实践经验？",
      requestId: "request-v4-autonomy-inheritor",
    });
    expect(inheritorAction.statusCode, inheritorAction.body).toBe(200);
    expect(inheritorAction.json()).toMatchObject({
      execution: { eventTemplateId: "event-template-inheritor" },
    });
    expect((await runtime.orchestrator.getCurrentEpisode(sessionId)).student.triggerEvent)
      .toMatchObject({ eventType: "student_asks_inheritor" });
    await acceptCurrent(runtime, sessionId, "v4-autonomy-inheritor");
    expect(await experience.onWorldSettled(sessionId)).toMatchObject({ scheduled: false });

    const sourceAction = await submitSemantic({
      app,
      sessionId,
      objectLabel: "原始来源包",
      utterance: "把国家级名录、地方标准和网络转引并列比较，标出原始发布机关、年份、定位和仍待核的起源主张。",
      requestId: "request-v4-autonomy-source-comparison",
    });
    expect(sourceAction.statusCode, sourceAction.body).toBe(200);
    expect(sourceAction.json()).toMatchObject({
      execution: { eventTemplateId: "event-template-compare-sources" },
    });
    await acceptCurrent(runtime, sessionId, "v4-autonomy-source-comparison");

    const lifecycle = await experience.onWorldSettled(sessionId);
    expect(lifecycle).toMatchObject({ scheduled: true });
    const next = await runtime.orchestrator.getCurrentEpisode(sessionId);
    expect(next.student.triggerEvent?.eventType).toBe("shopkeeper_requests_placement");

    const autonomousRecord = await autonomy.getRecord(sessionId);
    expect(autonomousRecord.currentWorldStateVersion).toBe(6);
    expect(autonomousRecord.commitReceipts).toHaveLength(6);
    expect(autonomousRecord.npcStates.find(
      (npc) => npc.entityId === "entity-gatekeeper",
    )?.memories).toEqual(expect.arrayContaining([
      expect.objectContaining({ memoryKey: "reporter_identity" }),
    ]));
    const publicView = await getStudentExperience(app, sessionId);
    expect(publicView.worldPulse).toMatchObject({
      status: "npc_action_pending",
      speaker: "吴姐",
    });
    expect(JSON.stringify(publicView.worldPulse)).not.toMatch(/planRef|candidateEventId|memoryKey/u);

    const offered = await acceptCurrent(runtime, sessionId, "v4-autonomy-shopkeeper-offer");
    expect(offered.triggerEvent?.eventType).toBe("shopkeeper_requests_placement");
    expect(await experience.onWorldSettled(sessionId)).toMatchObject({
      scheduled: false,
      eventId: null,
    });
    const response = await submitSemantic({
      app,
      sessionId,
      objectLabel: "吴姐",
      utterance: "我希望协商素材授权与商业曝光分开：我会标注素材提供方，但标题和首图由编辑判断，不承诺套餐植入；不合适就使用自采素材。",
      requestId: "request-v4-commercial-counteroffer",
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      decision: { status: "accepted" },
      execution: {
        status: "world_event_created",
        eventTemplateId: "event-template-commercial-response",
      },
    });
    const commercial = await acceptCurrent(runtime, sessionId, "v4-commercial-counteroffer");
    expect(commercial.triggerEvent?.eventType).toBe("student_resolves_commercial_exchange");
    const commercialRecord = await runtime.engine.getRecord(sessionId);
    expect(commercialRecord.resolutions.at(-1)?.variableDeltas).toEqual(expect.arrayContaining([
      expect.objectContaining({ variableId: "editorial_independence", delta: 5 }),
      expect.objectContaining({ variableId: "source_access", delta: 2 }),
    ]));
    await experience.onWorldSettled(sessionId);
    const afterCounteroffer = await autonomy.getRecord(sessionId);
    expect(afterCounteroffer.signals).toMatchObject({
      merchant_offer_received: true,
      commercial_response_recorded: true,
      placement_rejected_professionally: true,
    });
    expect(afterCounteroffer.npcStates.find(
      (npc) => npc.entityId === "entity-shopkeeper",
    )?.memories).toEqual(expect.arrayContaining([
      expect.objectContaining({ memoryKey: "student_counteroffer" }),
    ]));

    const clock = await acceptCurrent(runtime, sessionId, "v4-clock-pressure");
    expect(clock.triggerEvent?.eventType).toBe("system_clock_tick");
    expect(await experience.onWorldSettled(sessionId)).toMatchObject({ scheduled: true });
    const withdrawal = await acceptCurrent(runtime, sessionId, "v4-tourist-withdrawal");
    expect(withdrawal).toMatchObject({
      triggerEvent: { eventType: "tourist_withdraws_consent" },
      teacherGate: { status: "pending" },
    });
    await runtime.orchestrator.decideTeacherGate({
      sessionId,
      episodeId: withdrawal.episodeId,
      decision: "approved",
      teacherDecisionRef: "teacher-decision-v4-tourist-withdrawal",
      revisionPolicy: null,
      revisedConsequenceSummary: null,
    });
    await experience.onWorldSettled(sessionId);
    const rightsScene = await getStudentExperience(app, sessionId);
    expect(rightsScene.scene.sceneRef).toBe("loc-mobile-edit-bay");
    const prudentWait = await submitSemantic({
      app,
      sessionId,
      objectLabel: "移动融媒体工作台",
      utterance: "我等待核验十分钟并暂缓发布；期间并行整理已确认事实，下一次更新时间写明为十分钟后。",
      requestId: "request-v4-prudent-verification-wait",
    });
    expect(prudentWait.statusCode, prudentWait.body).toBe(200);
    expect(prudentWait.json()).toMatchObject({
      decision: { status: "accepted", canonicalAction: { verb: "wait" } },
      execution: { eventTemplateId: "event-template-verification-wait" },
    });
    const waited = await acceptCurrent(runtime, sessionId, "v4-prudent-wait");
    expect(waited.consequence).toMatchObject({ status: "committed" });
    expect((await runtime.engine.getRecord(sessionId)).resolutions.at(-1)?.variableDeltas)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ variableId: "deadline_pressure", delta: 20 }),
        expect.objectContaining({ variableId: "evidence_confidence", delta: 2 }),
      ]));
  });

  it("rejects forged object tokens before world writes and parses strict input before auth", async () => {
    const sessionId = "session-v4-forged-action";
    const { app, runtime, authorizeCalls } = await setup(sessionId);
    const initial = await getStudentExperience(app, sessionId);
    const beforeForged = authorizeCalls();
    const payload = semanticPayload({
      sessionId,
      experience: initial,
      objectLabel: "林师傅",
      utterance: "您好，我先说明记者身份和公共拍摄范围。",
      requestId: "request-v4-forged-token",
    });
    payload.selections[0]!.selectionToken = "sel_forged_forged_forged_forged";
    const forged = await app.inject({
      method: "POST",
      url: `/api/v4/sessions/${sessionId}/semantic-actions`,
      payload,
    });
    expect(forged.statusCode).toBe(200);
    expect(forged.json()).toMatchObject({
      decision: { status: "refused", refusal: { reasonCode: "unauthorized_reference" } },
      execution: { status: "zero_write", eventId: null },
    });
    expect((await runtime.engine.getRecord(sessionId)).studentActions).toHaveLength(0);
    expect(authorizeCalls()).toBe(beforeForged + 1);

    const extra = await app.inject({
      method: "GET",
      url: `/api/v4/sessions/${sessionId}/experience?bindingId=binding-student&audience=admin`,
    });
    expect(extra.statusCode).toBe(400);
    expect(authorizeCalls()).toBe(beforeForged + 1);
  });

  it("runs an evidence-sufficient source challenge without artificial requests and projects it by role", async () => {
    const sessionId = "session-v4-grounded-source";
    const groundedModel: GroundedCollaborationModelV4 = {
      run: async (input: Readonly<GroundedCollaborationModelInputV4>) => ({
        output: {
          position: input.expectedPosition,
          safeSummary: `${input.approvedSafeSummary} 仅按本轮可定位证据推进。`,
          rationale: `${input.approvedRationale} 保留学生的最终编辑选择。`,
          groundedClaimRefs: input.allowedClaims.map((item) => item.claimRef),
          knowledgeRefs: input.allowedKnowledge.map((item) => item.knowledgeRef),
          evidenceRefs: input.evidenceRefs,
        },
        providerId: "provider-route-live",
        modelId: "model-route-live",
        traceRef: `trace-route-live-${input.moveKind}`,
        latencyMs: 3,
        estimatedCostMicros: 10,
      }),
    };
    const { app, runtime } = await setup(sessionId, undefined, {
      groundedModel,
      groundedExecutionBudgetMicros: 1_000,
    });
    const prerequisiteSteps = [
      {
        label: "陈编辑",
        utterance: "我先观察现场并明确报道受众、公共价值、时间预算和放弃条件。",
        suffix: "topic-brief",
      },
      {
        label: "林师傅",
        utterance: "您好，我是融媒体中心实训记者，想采访公共区域里的游客体验，可以先确认哪些地方不能进吗？",
        suffix: "gatekeeper",
      },
    ] as const;
    for (const step of prerequisiteSteps) {
      const action = await submitSemantic({
        app,
        sessionId,
        objectLabel: step.label,
        utterance: step.utterance,
        requestId: `request-v4-${step.suffix}`,
      });
      expect(action.statusCode, action.body).toBe(200);
      expect(action.json().execution.status).toBe("world_event_created");
      expect((await acceptCurrent(runtime, sessionId, step.suffix)).status).toBe("completed");
    }

    await arrangeResidentMeeting(app, runtime, sessionId, "grounded-introduction");
    const community = await submitSemantic({
      app,
      sessionId,
      objectLabel: "阿环",
      utterance: "如果涉及家人，您可以匿名、删题、拒答或撤回；请告诉我哪些内容可以公开。",
      requestId: "request-v4-community-before-source",
    });
    expect(community.statusCode, community.body).toBe(200);
    const communityPending = await acceptCurrent(runtime, sessionId, "community-before-source");
    expect(communityPending).toMatchObject({
      status: "decided",
      teacherGate: { status: "pending" },
    });
    const communityApproved = await runtime.orchestrator.decideTeacherGate({
      sessionId,
      episodeId: communityPending.episodeId,
      decision: "approved",
      teacherDecisionRef: "teacher-decision-grounded-source-community",
      revisionPolicy: null,
      revisedConsequenceSummary: null,
    });
    expect(communityApproved.student.status).toBe("completed");

    const inheritor = await submitSemantic({
      app,
      sessionId,
      objectLabel: "黄老师",
      utterance: "您觉得报道只拍花好看会漏掉什么？请区分亲历、口述与可公开事实。",
      requestId: "request-v4-inheritor-before-source",
    });
    expect(inheritor.statusCode, inheritor.body).toBe(200);
    expect((await acceptCurrent(runtime, sessionId, "inheritor-before-source")).status)
      .toBe("completed");

    const source = await submitSemantic({
      app,
      sessionId,
      objectLabel: "原始来源包",
      utterance: "把 A、B 两份材料里提到年份的原句、发布主体和原始定位并排比对给我。",
      requestId: "request-v4-source-grounded",
    });
    expect(source.statusCode, source.body).toBe(200);
    const body = source.json();
    expect(body.execution).toMatchObject({
      status: "world_event_created",
      eventTemplateId: "event-template-compare-sources",
    });
    expect(body.collaboration.episode, JSON.stringify(body.collaboration)).toMatchObject({
      audience: "student",
      status: "suggestion_ready",
      suggestion: {
        professionalRole: "责任编辑协作建议",
        allowedDecisions: ["accept", "request_evidence", "reject"],
      },
    });
    expect(body.collaboration.decisionToken).toMatch(/^groundeddecision_/u);

    const teacher = await app.inject({
      method: "GET",
      url: `/api/v4/sessions/${sessionId}/grounded-collaboration?bindingId=binding-teacher`,
    });
    expect(teacher.statusCode).toBe(200);
    expect(teacher.json().collaboration.episode).toMatchObject({
      audience: "teacher",
      status: "joint_proposal_ready",
    });
    expect(teacher.json().collaboration.episode.moves.map(
      (move: Record<string, unknown>) => move.moveKind,
    )).toEqual(["proposal", "challenge", "joint_proposal"]);
    expect(JSON.stringify(teacher.json())).not.toMatch(/traceRef|providerId|modelId|promptTemplateRef/u);

    const admin = await app.inject({
      method: "GET",
      url: `/api/v4/sessions/${sessionId}/grounded-collaboration?bindingId=binding-admin`,
    });
    expect(admin.statusCode).toBe(200);
    expect(admin.json().collaboration).toMatchObject({
      episode: {
        audience: "admin",
        executionSummary: { executionMode: "live" },
      },
      ablation: { policy: "affected_set", moveCount: 3 },
    });

    const deniedRefresh = await app.inject({ method: "POST",
      url: `/api/v4/sessions/${sessionId}/grounded-episodes/${body.collaboration.episode.episodeId}/refresh`,
      payload: { bindingId: "binding-teacher" } });
    expect(deniedRefresh.statusCode).toBe(409); // This isolated fixture maps non-schema errors to 409.
    expect(deniedRefresh.body).toContain("只有学生记者");
    const forgedRefresh = await app.inject({ method: "POST",
      url: `/api/v4/sessions/${sessionId}/grounded-episodes/${body.collaboration.episode.episodeId}/refresh`,
      payload: { bindingId: "binding-student", sourceRevisionId: "forged-version" } });
    expect(forgedRefresh.statusCode).toBe(400);
    const refreshed = await app.inject({ method: "POST",
      url: `/api/v4/sessions/${sessionId}/grounded-episodes/${body.collaboration.episode.episodeId}/refresh`,
      payload: { bindingId: "binding-student" } });
    expect(refreshed.statusCode, refreshed.body).toBe(200);
    expect(refreshed.json().collaboration.episode).toMatchObject({ episodeId: body.collaboration.episode.episodeId, evidenceState: { status: "ready" } });
    const decision = await app.inject({
      method: "POST",
      url: `/api/v4/sessions/${sessionId}/grounded-episodes/${body.collaboration.episode.episodeId}/decisions`,
      payload: {
        bindingId: "binding-student",
        decisionToken: body.collaboration.decisionToken,
        decisionRef: "decision-v4-grounded-accept",
        decision: "accept",
        rationale: "我采纳先比较原始定位的建议，但保留对最终表述的编辑决定。",
      },
    });
    expect(decision.statusCode).toBe(200);
    expect(decision.json().collaboration.episode).toMatchObject({
      audience: "student",
      status: "completed",
    });
    expect((await runtime.engine.getSnapshot(sessionId)).stateVersion).toBe(6);
  });
});
