import type { FastifyInstance } from "fastify";
import { describe, expect, it, vi } from "vitest";
import {
  DemoIdentityProfileSummarySchema,
  FlagshipCollaborationEventId,
  FlagshipCollaborationRouteId,
  FlagshipCollaborationScenarioReleaseId,
  ScenarioActiveAgentTemplateIds,
  ScenarioCollaborationFlagshipScenarioId,
  ScenarioCollaborationConfigSchemaVersion,
  type DemoIdentityProfileSummary,
  type RoleBinding,
} from "@ronggang/contracts";
import { ProductVersion } from "@ronggang/contracts/version";
import {
  InMemoryEventStore,
  InProcessMessageBus,
  WorldEngine,
  demoScenario,
} from "@ronggang/world-core";
import {
  UnifiedIflytekAdapter,
  type CapabilityExecutionInput,
} from "@ronggang/iflytek-adapter";
import { DemoAuthService, type DemoAuthContext } from "../src/identity.js";
import {
  InMemoryContentAddressedObjectStore,
  type ObjectStore,
} from "../src/local-object-store.js";
import {
  assertBundledScenarioMaterialIntegrity,
  createMemoryTestApp,
  DEMO_SESSION_ID,
} from "../src/server.js";
import { DEMO_SECONDARY_SESSION_ID } from "../src/session-control-bootstrap.js";
import { collaborationStrategyContent } from "./collaboration-strategy.fixture.js";

const localOrigin = "http://localhost:5173";

it("verifies the physical flagship asset against the scenario content hash", async () => {
  await expect(
    assertBundledScenarioMaterialIntegrity(demoScenario),
  ).resolves.toBeUndefined();
});

interface TestLogin {
  cookie: string;
  csrfToken: string;
  bindings: RoleBinding[];
}

async function testApp(
  authService?: DemoAuthService,
  strictInteractionGates = false,
  options: {
    adapter?: UnifiedIflytekAdapter;
    objectStore?: ObjectStore;
    initializeSecondaryDemo?: boolean;
    initializeGoldScenarioRelease?: boolean;
  } = {},
) {
  const scenario = structuredClone(demoScenario);
  if (!strictInteractionGates) scenario.interactionGates = [];
  const engine = new WorldEngine({
    store: new InMemoryEventStore(),
    bus: new InProcessMessageBus(),
    scenario,
  });
  const app = await createMemoryTestApp({
    engine,
    ...(authService ? { authService } : {}),
    adapter: options.adapter
      ?? new UnifiedIflytekAdapter({ mode: "mock", environment: {} }),
    ...(options.objectStore ? { objectStore: options.objectStore } : {}),
    ...(options.initializeSecondaryDemo !== undefined
      ? { initializeSecondaryDemo: options.initializeSecondaryDemo }
      : {}),
    ...(options.initializeGoldScenarioRelease !== undefined
      ? {
          initializeGoldScenarioRelease:
            options.initializeGoldScenarioRelease,
        }
      : {}),
  });
  return { app, engine };
}

async function loginOperator(app: FastifyInstance): Promise<TestLogin> {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/demo-session",
    headers: { origin: localOrigin },
    payload: {},
  });
  expect(response.statusCode).toBe(200);
  const context = response.json() as DemoAuthContext;
  const setCookie = Array.isArray(response.headers["set-cookie"])
    ? response.headers["set-cookie"][0]
    : response.headers["set-cookie"];
  if (!setCookie) throw new Error("测试登录没有返回 Cookie");
  return {
    cookie: setCookie.split(";")[0]!,
    csrfToken: context.csrfToken,
    bindings: context.bindings,
  };
}

async function loginProfile(
  app: FastifyInstance,
  profileId: string,
  sessionId = DEMO_SESSION_ID,
): Promise<TestLogin> {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/demo-session",
    headers: { origin: localOrigin },
    payload: { profileId, sessionId },
  });
  expect(response.statusCode).toBe(200);
  const context = response.json() as DemoAuthContext;
  const setCookie = Array.isArray(response.headers["set-cookie"])
    ? response.headers["set-cookie"][0]
    : response.headers["set-cookie"];
  if (!setCookie) throw new Error("成员身份登录没有返回 Cookie");
  return {
    cookie: setCookie.split(";")[0]!,
    csrfToken: context.csrfToken,
    bindings: context.bindings,
  };
}

function binding(login: TestLogin, actorKind: "student" | "teacher"): RoleBinding {
  const result = login.bindings.find((candidate) => candidate.actorKind === actorKind);
  if (!result) throw new Error(`测试登录缺少 ${actorKind} 绑定`);
  return result;
}

function actorBinding(login: TestLogin, actorId: string): RoleBinding {
  const result = login.bindings.find((candidate) => candidate.actorId === actorId);
  if (!result) throw new Error(`测试登录缺少 ${actorId} 绑定`);
  return result;
}

function authHeaders(login: TestLogin, write = false): Record<string, string> {
  return {
    cookie: login.cookie,
    ...(write ? { origin: localOrigin, "x-csrf-token": login.csrfToken } : {}),
  };
}

async function eventually<T>(
  read: () => Promise<T>,
  accept: (value: T) => boolean,
): Promise<T> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const value = await read();
    if (accept(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("异步智能体结果未在测试时限内到达");
}

describe("Fastify prototype API", { timeout: 15_000 }, () => {
  it("accepts an automatically assigned loopback development port and rejects external origins", async () => {
    const { app } = await testApp();
    const loopback = await app.inject({
      method: "POST",
      url: "/api/auth/demo-session",
      headers: { origin: "http://127.0.0.1:5174" },
      payload: {},
    });
    expect(loopback.statusCode).toBe(200);

    const external = await app.inject({
      method: "POST",
      url: "/api/auth/demo-session",
      headers: { origin: "https://untrusted.example" },
      payload: {},
    });
    expect(external.statusCode).toBe(403);
    await app.close();
  });

  it("returns role-safe contribution cards and rejects a decision without an authorized card", async () => {
    const { app, engine } = await testApp();
    const login = await loginOperator(app);
    const studentBinding = actorBinding(login, "student-editor");
    const cards = await app.inject({
      method: "GET",
      url: `/api/sessions/${DEMO_SESSION_ID}/agent-contributions?bindingId=${studentBinding.bindingId}`,
      headers: authHeaders(login),
    });
    expect(cards.statusCode).toBe(200);
    expect(cards.json()).toMatchObject({
      schemaVersion: "agent-contribution-cards/1.0.0",
      cards: [],
    });

    const projection = await engine.getProjection(
      DEMO_SESSION_ID,
      studentBinding.actorId,
    );
    const idempotencyKey = "agent-contribution:missing-proposal";
    const denied = await app.inject({
      method: "POST",
      url: `/api/sessions/${DEMO_SESSION_ID}/commands`,
      headers: authHeaders(login, true),
      payload: {
        bindingId: studentBinding.bindingId,
        name: "record_agent_contribution_decision",
        expectedStateVersion: projection.stateVersion,
        sourceMode: "course_platform",
        surfaceId: "student-agent-contribution",
        interactionId: "proposal-missing",
        idempotencyKey,
        payload: {
          proposalId: "proposal-missing",
          decision: "accepted",
          studentReason: "先核对第二来源。",
          idempotencyKey,
        },
      },
    });
    expect(denied.statusCode).toBe(403);
    expect((await engine.getTimeline(
      DEMO_SESSION_ID,
      studentBinding.actorId,
    )).some((event) => (
      event.eventType === "agent_contribution_decided"
    ))).toBe(false);
    await app.close();
  });

  it("exposes the safe collaboration replay to teachers and denies students", async () => {
    const { app } = await testApp();
    const login = await loginOperator(app);
    const teacherBinding = actorBinding(login, "teacher-main");
    const studentBinding = actorBinding(login, "student-editor");

    const teacher = await app.inject({
      method: "GET",
      url: `/api/sessions/${DEMO_SESSION_ID}/collaboration-replay?bindingId=${teacherBinding.bindingId}`,
      headers: authHeaders(login),
    });
    expect(teacher.statusCode).toBe(200);
    expect(teacher.json()).toMatchObject({
      schemaVersion: "collaboration-replay/1.0.0",
      sessionId: DEMO_SESSION_ID,
      routeId: "route-rain-escalation",
      representativeEventId: "flagship-event-rain-escalation",
      representativeTaskId: "flagship-task-rain-collaboration",
      status: "not_triggered",
      stages: expect.arrayContaining([
        expect.objectContaining({ phase: "event_trigger" }),
        expect.objectContaining({ phase: "world_writeback" }),
      ]),
    });
    expect(teacher.json().stages).toHaveLength(8);
    expect(JSON.stringify(teacher.json())).not.toContain("idempotencyKey");
    expect(JSON.stringify(teacher.json())).not.toContain(
      "privateMemoryNamespaceRef",
    );

    const student = await app.inject({
      method: "GET",
      url: `/api/sessions/${DEMO_SESSION_ID}/collaboration-replay?bindingId=${studentBinding.bindingId}`,
      headers: authHeaders(login),
    });
    expect(student.statusCode).toBe(403);
    await app.close();
  });

  it("exposes a read-only strategy reuse explanation only to the active student binding", async () => {
    const { app, engine } = await testApp();
    const login = await loginOperator(app);
    const teacherBinding = actorBinding(login, "teacher-main");
    const studentBinding = actorBinding(login, "student-editor");
    const before = await engine.getStateSnapshot(DEMO_SESSION_ID);
    const projectionSpy = vi.spyOn(engine, "getProjection");

    const student = await app.inject({
      method: "GET",
      url: `/api/sessions/${DEMO_SESSION_ID}/strategy-reuse-explanation`
        + `?bindingId=${studentBinding.bindingId}`,
      headers: authHeaders(login),
    });
    expect(student.statusCode).toBe(200);
    expect(student.json()).toMatchObject({
      schemaVersion: "strategy-reuse-explanation/1.0.0",
      sessionId: DEMO_SESSION_ID,
      routeId: "route-rain-escalation",
      sourceEventId: "flagship-event-rain-escalation",
      currentEventId: "flagship-event-rain-followup",
      taskId: "flagship-task-rain-collaboration",
      status: "not_reused",
      reasonCode: "no_match",
      strategyRef: null,
      strategyStatus: null,
      actualPath: null,
      alternativePath: null,
    });
    const serialized = JSON.stringify(student.json());
    for (const forbidden of [
      "actorId",
      "teacherActorId",
      "idempotencyKey",
      "privateMemory",
      "prompt",
      "lease",
      "provider",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect((await engine.getStateSnapshot(DEMO_SESSION_ID)).stateVersion)
      .toBe(before.stateVersion);
    expect(projectionSpy).toHaveBeenCalledWith(
      DEMO_SESSION_ID,
      "student-editor",
    );
    expect(projectionSpy).toHaveBeenCalledWith(
      DEMO_SESSION_ID,
      "teacher-main",
    );

    const teacher = await app.inject({
      method: "GET",
      url: `/api/sessions/${DEMO_SESSION_ID}/strategy-reuse-explanation`
        + `?bindingId=${teacherBinding.bindingId}`,
      headers: authHeaders(login),
    });
    expect(teacher.statusCode).toBe(403);

    const forged = await app.inject({
      method: "GET",
      url: `/api/sessions/${DEMO_SESSION_ID}/strategy-reuse-explanation`
        + `?bindingId=${studentBinding.bindingId}`
        + "&strategyId=forged&contentHash="
        + "0".repeat(64),
      headers: authHeaders(login),
    });
    expect(forged.statusCode).toBe(400);
    await app.close();
  });

  it("declares each demo identity's authorized sessions before attempting login", async () => {
    const { app } = await testApp(undefined, false, {
      initializeSecondaryDemo: true,
    });
    const response = await app.inject({
      method: "GET",
      url: "/api/auth/demo-profiles",
    });
    expect(response.statusCode).toBe(200);
    const profiles: DemoIdentityProfileSummary[] = response.json().profiles.map(
      (profile: unknown) => DemoIdentityProfileSummarySchema.parse(profile),
    );
    const authorizedSessions = (profileId: string) => profiles.find(
      (profile) => profile.profileId === profileId,
    )?.authorizedSessionIds;
    expect(authorizedSessions("teacher-class-a")).toEqual([DEMO_SESSION_ID]);
    expect(authorizedSessions("student-team-a")).toEqual([DEMO_SESSION_ID]);
    expect(authorizedSessions("student-unassigned")).toEqual([]);
    expect(profiles.find(
      (profile) => profile.profileId === "student-unassigned",
    )?.defaultSessionId).toBeNull();
    expect(authorizedSessions("teacher-class-b")).toEqual([
      DEMO_SECONDARY_SESSION_ID,
    ]);
    expect(authorizedSessions("student-team-b")).toEqual([
      DEMO_SECONDARY_SESSION_ID,
    ]);
    expect(profiles.every((profile) => (
      profile.defaultSessionId === null
      || profile.authorizedSessionIds.includes(profile.defaultSessionId)
    ))).toBe(true);
    await app.close();
  });

  it("keeps an unassigned student empty until a real course claim creates role memberships", async () => {
    const { app } = await testApp();
    const beforeLogin = await app.inject({
      method: "POST",
      url: "/api/auth/demo-session",
      headers: { origin: localOrigin },
      payload: {
        profileId: "student-unassigned",
        sessionId: DEMO_SESSION_ID,
      },
    });
    expect(beforeLogin.statusCode).toBe(403);

    const claim = await app.inject({
      method: "POST",
      url: "/api/auth/demo-course-claim",
      headers: { origin: localOrigin },
      payload: {
        profileId: "student-unassigned",
        sessionId: DEMO_SESSION_ID,
      },
    });
    expect(claim.statusCode).toBe(200);
    expect(claim.json()).toMatchObject({
      status: "claimed",
      profileId: "student-unassigned",
      sessionId: DEMO_SESSION_ID,
      roleCount: 2,
    });

    const duplicateClaim = await app.inject({
      method: "POST",
      url: "/api/auth/demo-course-claim",
      headers: { origin: localOrigin },
      payload: {
        profileId: "student-unassigned",
        sessionId: DEMO_SESSION_ID,
      },
    });
    expect(duplicateClaim.statusCode).toBe(200);

    const profilesResponse = await app.inject({
      method: "GET",
      url: "/api/auth/demo-profiles",
    });
    const claimedProfile = profilesResponse.json().profiles.find(
      (profile: DemoIdentityProfileSummary) => (
        profile.profileId === "student-unassigned"
      ),
    );
    expect(claimedProfile.authorizedSessionIds).toEqual([DEMO_SESSION_ID]);

    const login = await loginProfile(app, "student-unassigned");
    expect(login.bindings).toHaveLength(2);
    expect(login.bindings.every((item) => item.actorKind === "student")).toBe(true);
    await app.close();
  });

  it("allows a teacher to teach but reserves backend logs for the administrator profile", async () => {
    const { app } = await testApp();
    const teacher = await loginProfile(app, "teacher-class-a");
    const teacherBinding = binding(teacher, "teacher");

    const projection = await app.inject({
      method: "GET",
      url: `/api/sessions/${DEMO_SESSION_ID}/projection?bindingId=${teacherBinding.bindingId}`,
      headers: authHeaders(teacher),
    });
    expect(projection.statusCode).toBe(200);

    const protectedLogUrls = [
      `/api/sessions/${DEMO_SESSION_ID}/agent-runs?bindingId=${teacherBinding.bindingId}`,
      `/api/sessions/${DEMO_SESSION_ID}/trace?bindingId=${teacherBinding.bindingId}`,
      `/api/sessions/${DEMO_SESSION_ID}/context-debug?bindingId=${teacherBinding.bindingId}`
        + `&targetAgentId=agent-fact-checker&q=${encodeURIComponent("入口去重")}`,
      "/api/operations/health"
        + `?bindingId=${teacherBinding.bindingId}`
        + `&authorizationSessionId=${DEMO_SESSION_ID}`,
    ];
    for (const url of protectedLogUrls) {
      const response = await app.inject({
        method: "GET",
        url,
        headers: authHeaders(teacher),
      });
      expect(response.statusCode, url).toBe(403);
    }
    await app.close();
  });

  it("deduplicates one server-bound action across both student surfaces", async () => {
    const { app, engine } = await testApp(undefined, true);
    const login = await loginOperator(app);
    const reporterBinding = actorBinding(login, "student-reporter");
    const projection = await app.inject({
      method: "GET",
      url:
        `/api/sessions/${DEMO_SESSION_ID}/projection?bindingId=${reporterBinding.bindingId}`,
      headers: authHeaders(login),
    });
    const actionId = "action-cross-surface-1";
    const basePayload = {
      bindingId: reporterBinding.bindingId,
      name: "send_role_interaction",
      expectedStateVersion: projection.json().stateVersion,
      actionId,
      idempotencyKey: "idempotency-cross-surface-1",
      payload: { optionId: "reporter-interview-process" },
    };
    const coursePlatform = await app.inject({
      method: "POST",
      url: `/api/sessions/${DEMO_SESSION_ID}/commands`,
      headers: authHeaders(login, true),
      payload: {
        ...basePayload,
        sourceMode: "course_platform",
        surfaceId: "student-course-platform",
      },
    });
    const worldInteraction = await app.inject({
      method: "POST",
      url: `/api/sessions/${DEMO_SESSION_ID}/commands`,
      headers: authHeaders(login, true),
      payload: {
        ...basePayload,
        sourceMode: "world_interaction",
        surfaceId: "student-world",
        interactionId: "hotspot-interviewee",
      },
    });

    expect(coursePlatform.statusCode).toBe(200);
    expect(worldInteraction.statusCode).toBe(200);
    const actionEvents = (await engine.store.load(DEMO_SESSION_ID)).filter(
      (event) => (
        event.actionContext?.actionId === actionId
        && event.actorId === "student-reporter"
      ),
    );
    expect(actionEvents.map((event) => event.eventType)).toEqual([
      "role_interaction_requested",
      "role_message_posted",
    ]);
    expect(actionEvents.every((event) => (
      event.actionContext?.sourceAssertion === "client_declared"
      && event.actionContext?.actorBindingHash.length === 64
    ))).toBe(true);
    await app.close();
  });

  it("runs two student roles through targeted multi-turn NPC branches without leaking private commitments", async () => {
    const { app, engine } = await testApp(undefined, true);
    const login = await loginOperator(app);
    const reporterBinding = actorBinding(login, "student-reporter");
    const editorBinding = actorBinding(login, "student-editor");
    const teacherBinding = actorBinding(login, "teacher-main");

    const readProjection = (roleBinding: RoleBinding) => app.inject({
      method: "GET",
      url: `/api/sessions/${DEMO_SESSION_ID}/projection?bindingId=${roleBinding.bindingId}`,
      headers: authHeaders(login),
    });
    const reporterInitial = await readProjection(reporterBinding);
    expect(reporterInitial.statusCode).toBe(200);
    expect(reporterInitial.json().courseGuide.activeRoleBrief.roleId).toBe(
      "reporter",
    );
    expect(reporterInitial.json().courseGuide.currentNodeGuide.nodeId).toBe(
      "brief",
    );
    expect(JSON.stringify(reporterInitial.json().courseGuide)).not.toContain(
      "teacherFocus",
    );
    expect(JSON.stringify(reporterInitial.json().courseGuide)).not.toContain(
      "你是本次融媒体报道的责任编辑",
    );
    const sendInteraction = async (roleBinding: RoleBinding, optionId: string) => {
      let sent;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const before = await readProjection(roleBinding);
        sent = await app.inject({
          method: "POST",
          url: `/api/sessions/${DEMO_SESSION_ID}/commands`,
          headers: authHeaders(login, true),
          payload: {
            bindingId: roleBinding.bindingId,
            name: "send_role_interaction",
            expectedStateVersion: before.json().stateVersion,
            sourceMode: "world_interaction",
            surfaceId: "student-world",
            interactionId: `hotspot-${optionId}`,
            payload: { optionId },
          },
        });
        if (sent.statusCode !== 409) break;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      if (!sent) throw new Error("岗位互动请求未发出");
      expect(sent.statusCode).toBe(200);
      return eventually(
        () => readProjection(roleBinding),
        (response) => response.json().roleInteractions.some(
          (item: { status: string; request: { optionId: string } }) => (
            item.request.optionId === optionId && item.status === "responded"
          ),
        ),
      );
    };
    const issueCommand = async (
      roleBinding: RoleBinding,
      name: string,
      payload: Record<string, unknown> = {},
    ) => {
      let response;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const before = await readProjection(roleBinding);
        response = await app.inject({
          method: "POST",
          url: `/api/sessions/${DEMO_SESSION_ID}/commands`,
          headers: authHeaders(login, true),
          payload: {
            bindingId: roleBinding.bindingId,
            name,
            expectedStateVersion: before.json().stateVersion,
            payload,
          },
        });
        if (response.statusCode !== 409) break;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      if (!response) throw new Error(`命令未发出：${name}`);
      expect(response.statusCode).toBe(200);
      return response;
    };

    await sendInteraction(reporterBinding, "reporter-interview-process");
    const reporterAfterFollowup = await sendInteraction(
      reporterBinding,
      "reporter-followup-visitors",
    );
    const reporterThread = reporterAfterFollowup.json().roleInteractions.filter(
      (item: { request: { toActorId: string } }) => item.request.toActorId === "agent-interviewee",
    );
    expect(reporterThread.map((item: { request: { turn: number } }) => item.request.turn))
      .toEqual([1, 2]);
    expect(reporterThread[0].request.threadId).toBe(reporterThread[1].request.threadId);
    expect(reporterThread[1].request.replyToInteractionId)
      .toBe(reporterThread[0].request.interactionId);
    expect(reporterAfterFollowup.json().recentEvents.some(
      (event: {
        actionContext?: {
          sourceMode?: string;
          causationId?: string;
          commandName?: string;
        } | null;
      }) => (
        event.actionContext?.sourceMode === "world_interaction"
        && event.actionContext.causationId
          === "hotspot-reporter-followup-visitors"
        && event.actionContext.commandName === "send_role_interaction"
      ),
    )).toBe(true);
    expect(reporterThread[1].response).toMatchObject({
      act: "commit",
      stance: "committed",
      commitment: {
        ownerActorId: "agent-interviewee",
        granteeActorId: "student-reporter",
        status: "active",
        revision: 1,
      },
    });

    const editorBeforeChief = await readProjection(editorBinding);
    expect(editorBeforeChief.body).not.toContain("向记者岗提供当日非遗展演流程记录");
    expect(editorBeforeChief.json().roleInteractions).toEqual([]);

    await sendInteraction(editorBinding, "editor-chief-gate");
    const editorAfterChief = await sendInteraction(editorBinding, "editor-chief-commit");
    expect(editorAfterChief.json().availableActions[0]).toMatchObject({
      command: "inspect_material",
      enabled: true,
    });

    const teacher = await readProjection(teacherBinding);
    expect(teacher.json().roleInteractions).toHaveLength(4);
    expect(teacher.body).toContain("向记者岗提供当日非遗展演流程记录");
    const tasks = await app.inject({
      method: "GET",
      url: `/api/sessions/${DEMO_SESSION_ID}/agent-runs?bindingId=${teacherBinding.bindingId}`,
      headers: authHeaders(login),
    });
    const runAgentIds = tasks.json().runs.map((run: { agentId: string }) => run.agentId);
    expect(runAgentIds.filter((agentId: string) => (
      agentId === "agent-interviewee" || agentId === "agent-chief"
    ))).toEqual([
      "agent-interviewee",
      "agent-interviewee",
      "agent-chief",
      "agent-chief",
    ]);
    expect(runAgentIds).toEqual(expect.arrayContaining([
      "agent-teaching",
      "agent-scene-director",
    ]));
    expect(tasks.body).not.toContain("向记者岗提供当日非遗展演流程记录");

    await issueCommand(editorBinding, "inspect_material", {
      materialId: "material-festival-photo",
    });
    const factCandidateProjection = await eventually(
      () => readProjection(teacherBinding),
      (response) => response.json().pendingCandidates.some(
        (candidate: { eventType: string }) => candidate.eventType === "world_fact_updated",
      ),
    );
    const factCandidate = factCandidateProjection.json().pendingCandidates.find(
      (candidate: { eventType: string }) => candidate.eventType === "world_fact_updated",
    );
    await issueCommand(teacherBinding, "approve_candidate_event", {
      candidateId: factCandidate.candidateId,
    });
    await issueCommand(editorBinding, "request_second_verification");
    const evidenceAssistanceReady = await eventually(
      () => readProjection(editorBinding),
      (response) => response.json().agentAssistance.some(
        (proposal: { output: { kind: string } }) => (
          proposal.output.kind === "evidence_coaching"
        ),
      ),
    );
    const evidenceAssistance = evidenceAssistanceReady.json().agentAssistance
      .find(
        (proposal: { output: { kind: string } }) => (
          proposal.output.kind === "evidence_coaching"
        ),
      );
    expect(evidenceAssistance).toMatchObject({
      roleId: "student_assistant",
      templateRef: {
        templateId: "assistant/evidence-coach",
        templateVersion: "1.0.0",
      },
      subjectActorId: editorBinding.actorId,
      resourceRef: null,
      authority: "advisory_only",
      requiresHumanAction: true,
      output: {
        kind: "evidence_coaching",
      },
    });
    expect(evidenceAssistance.visibility).not.toContain("public_world");

    await sendInteraction(editorBinding, "editor-copyright-scope");
    const copyrightResponse = await sendInteraction(
      editorBinding,
      "editor-copyright-decision",
    );
    expect(copyrightResponse.json().roleInteractions.find(
      (item: { request: { optionId: string } }) => (
        item.request.optionId === "editor-copyright-decision"
      ),
    ).response).toMatchObject({
      act: "refuse",
      stance: "restricted",
      commitment: null,
    });
    const copyrightCandidateProjection = await eventually(
      () => readProjection(teacherBinding),
      (response) => response.json().pendingCandidates.some(
        (candidate: { eventType: string }) => candidate.eventType === "copyright_risk_flagged",
      ),
    );
    const copyrightCandidate = copyrightCandidateProjection.json().pendingCandidates.find(
      (candidate: { eventType: string }) => candidate.eventType === "copyright_risk_flagged",
    );
    await issueCommand(teacherBinding, "approve_candidate_event", {
      candidateId: copyrightCandidate.candidateId,
    });
    await issueCommand(editorBinding, "mark_copyright_risk");

    await sendInteraction(editorBinding, "editor-platform-precheck");
    await sendInteraction(editorBinding, "editor-platform-escalation");
    const platformCandidateProjection = await eventually(
      () => readProjection(teacherBinding),
      (response) => response.json().pendingCandidates.some(
        (candidate: { eventType: string }) => candidate.eventType === "node_activated",
      ),
    );
    const platformCandidate = platformCandidateProjection.json().pendingCandidates.find(
      (candidate: { eventType: string }) => candidate.eventType === "node_activated",
    );
    await issueCommand(teacherBinding, "approve_candidate_event", {
      candidateId: platformCandidate.candidateId,
    });
    await issueCommand(editorBinding, "pause_publication");
    await issueCommand(editorBinding, "request_media_processing", {
      materialId: "material-festival-photo",
      planId: "image-editorial-analysis",
      requestId: "api-content-processing-1",
    });
    const processed = await eventually(
      () => readProjection(editorBinding),
      (response) => response.json().mediaProcessingTasks.some(
        (task: { status: string }) => task.status === "succeeded",
      ),
    );
    const processingOutputId = processed.json().mediaProcessingTasks[0].steps.find(
      (step: { output: { outputId: string } | null }) => step.output,
    ).output.outputId;
    const materialAssistanceReady = await eventually(
      () => readProjection(editorBinding),
      (response) => response.json().agentAssistance.some(
        (proposal: { output: { kind: string } }) => (
          proposal.output.kind === "material_understanding"
        ),
      ),
    );
    const materialAssistance = materialAssistanceReady.json().agentAssistance
      .find(
        (proposal: { output: { kind: string } }) => (
          proposal.output.kind === "material_understanding"
        ),
      );
    expect(materialAssistance).toMatchObject({
      roleId: "content_assistant",
      templateRef: {
        templateId: "assistant/material-understanding",
        templateVersion: "1.0.0",
      },
      subjectActorId: editorBinding.actorId,
      authority: "advisory_only",
      requiresHumanAction: true,
      output: {
        kind: "material_understanding",
      },
    });
    expect(materialAssistance.resourceRef).toMatchObject({
      objectType: "media_processing_task",
      objectId: expect.any(String),
      version: expect.any(String),
    });
    expect(materialAssistance.output.materialRef).toEqual({
      objectType: "material",
      objectId: "material-festival-photo",
      version: "raw-1",
    });
    await issueCommand(editorBinding, "request_governance_review", {
      materialId: "material-festival-photo",
      requestId: "api-content-governance-1",
    });
    const governanceReady = await eventually(
      () => readProjection(teacherBinding),
      (response) => response.json().governanceReviews.some(
        (review: { status: string }) => review.status === "awaiting_teacher",
      ),
    );
    const governanceReview = governanceReady.json().governanceReviews.find(
      (review: { materialId: string }) => (
        review.materialId === "material-festival-photo"
      ),
    );
    await issueCommand(teacherBinding, "review_governance", {
      reviewId: governanceReview.reviewId,
      expectedArbitrationRevision: governanceReview.arbitrationRevision,
      expectedDecisionHash: governanceReview.decisionHash,
      decision: "approve",
      reviewNote: "已复核图片的四域 Finding 与确定性仲裁。",
      requestId: "api-content-governance-approve",
    });
    const citations = [
      {
        sourceKind: "fact",
        sourceId: "fact-visitors-v2",
        locator: null,
      },
      {
        sourceKind: "material",
        sourceId: "material-festival-photo",
        locator: null,
      },
      {
        sourceKind: "processing_output",
        sourceId: processingOutputId,
        locator: null,
      },
    ];
    const sections = [
      {
        sectionId: "lead",
        content: "水乡非遗市集以真实制作展演连接游客与传统技艺。",
      },
      {
        sectionId: "body",
        content: "入口去重表复核后的有效客流为 12,600 人次；图片只用于说明现场场景。",
      },
      {
        sectionId: "image-note",
        content: "现场图片不能独立证明客流总量，商业渠道暂不使用争议图片。",
      },
    ];
    const createdArtifact = await issueCommand(
      editorBinding,
      "create_production_artifact",
      {
        templateId: "article-main",
        requestId: "api-artifact-r1",
        title: "水乡非遗市集：真实技艺与经核验现场",
        summary: "以经审核客流事实、现场材料和机器观察组织主稿。",
        sections,
        citations,
        revisionNote: "建立主稿 R1 并固定三类来源。",
      },
    );
    const artifact = createdArtifact.json().productionArtifacts[0];
    const revisedArtifact = await issueCommand(
      editorBinding,
      "save_artifact_revision",
      {
        artifactId: artifact.artifactId,
        expectedRevisionNumber: 1,
        requestId: "api-artifact-r2",
        title: "水乡非遗市集：让真实技艺被看见",
        summary: "修订标题与发布表述，继续固定事实、素材和机器观察来源。",
        sections: sections.map((section) => (
          section.sectionId === "body"
            ? {
                ...section,
                content: `${section.content} 本稿明确区分统计事实与图像观察。`,
              }
            : section
        )),
        citations,
        revisionNote: "R2 收紧事实措辞并补充图片边界。",
      },
    );
    const latestArtifact = revisedArtifact.json().productionArtifacts[0];
    const latestRevision = revisedArtifact.json().artifactRevisions.find(
      (revision: { revisionId: string }) => (
        revision.revisionId === latestArtifact.latestRevisionId
      ),
    );
    await issueCommand(editorBinding, "submit_for_review", {
      artifactId: latestArtifact.artifactId,
      revisionId: latestRevision.revisionId,
      requestId: "api-submit-r2",
    });
    const evaluationReady = await eventually(
      () => readProjection(teacherBinding),
      (response) => {
        const arbitration = response.json().evaluationArbitrations.at(-1);
        return Boolean(
          arbitration
          && arbitration.status !== "collecting"
          && response.json().evaluationProposals.length === 4,
        );
      },
    );
    const evaluationCase = evaluationReady.json().evaluationCases.at(-1);
    const evidenceBundle = evaluationReady.json().evaluationEvidenceBundles.at(-1);
    const arbitration = evaluationReady.json().evaluationArbitrations.at(-1);
    const evaluationAssistanceReady = await eventually(
      () => readProjection(teacherBinding),
      (response) => response.json().agentAssistance.some(
        (proposal: {
          output: {
            kind: string;
            evaluationCaseId?: string;
            arbitrationId?: string;
          };
        }) => (
          proposal.output.kind === "evaluation_review"
          && proposal.output.evaluationCaseId
            === evaluationCase.evaluationCaseId
          && proposal.output.arbitrationId
            === arbitration.arbitrationId
        ),
      ),
    );
    const evaluationAssistance = evaluationAssistanceReady.json()
      .agentAssistance.find(
        (proposal: {
          output: {
            kind: string;
            evaluationCaseId?: string;
            arbitrationId?: string;
          };
        }) => (
          proposal.output.kind === "evaluation_review"
          && proposal.output.evaluationCaseId
            === evaluationCase.evaluationCaseId
          && proposal.output.arbitrationId
            === arbitration.arbitrationId
        ),
      );
    expect(evaluationAssistance).toMatchObject({
      roleId: "teacher_assistant",
      templateRef: {
        templateId: "assistant/evaluation-review",
        templateVersion: "1.0.0",
      },
      subjectActorId: teacherBinding.actorId,
      authority: "advisory_only",
      requiresHumanAction: true,
      output: {
        kind: "evaluation_review",
        evaluationCaseId: evaluationCase.evaluationCaseId,
        arbitrationId: arbitration.arbitrationId,
      },
    });
    expect(evaluationAssistance.resourceRef).toMatchObject({
      objectType: "evaluation_arbitration",
      objectId: arbitration.arbitrationId,
    });
    const evaluatorProjection = await engine.getProjection(
      DEMO_SESSION_ID,
      "agent-evidence-assessor",
    );
    expect(
      evaluatorProjection.evidence.map((evidence) => evidence.evidenceId).sort(),
    ).toEqual(
      evidenceBundle.evidenceRefs.map(
        (reference: { evidenceId: string }) => reference.evidenceId,
      ).sort(),
    );
    expect(
      evaluationReady.json().evaluationProposals.map(
        (proposal: { status: string }) => proposal.status,
      ),
    ).toEqual(["completed", "completed", "completed", "completed"]);
    const reviewDimensions = arbitration.recommendations.map(
      (recommendation: { dimensionId: string; suggestedScore: number }) => ({
        dimensionId: recommendation.dimensionId,
        finalScore: recommendation.suggestedScore,
        publicFeedback: "该维度已结合固定成果修订与过程证据完成复核。",
        overrideReason: null,
      }),
    );
    const staleReview = await app.inject({
      method: "POST",
      url: `/api/sessions/${DEMO_SESSION_ID}/commands`,
      headers: authHeaders(login, true),
      payload: {
        bindingId: teacherBinding.bindingId,
        name: "review_assessment",
        expectedStateVersion: evaluationReady.json().stateVersion,
        payload: {
          evaluationCaseId: evaluationCase.evaluationCaseId,
          expectedArbitrationRevision: arbitration.revision,
          expectedDecisionHash: "0".repeat(64),
          expectedEvidenceBundleHash: evidenceBundle.bundleHash,
          dimensions: reviewDimensions,
          publicSummary: "并发保护探针不应形成终评。",
          internalNote: "错误仲裁哈希必须被拒绝。",
          requestId: "api-assessment-stale-r2",
        },
      },
    });
    expect(staleReview.statusCode).toBe(409);
    await issueCommand(teacherBinding, "review_assessment", {
      evaluationCaseId: evaluationCase.evaluationCaseId,
      expectedArbitrationRevision: arbitration.revision,
      expectedDecisionHash: arbitration.decisionHash,
      expectedEvidenceBundleHash: evidenceBundle.bundleHash,
      dimensions: reviewDimensions,
      publicSummary: "已完成事实、版权、发布门禁和协作过程的逐维复核。",
      internalNote: "教师内部确认四路意见与固定证据包一致。",
      requestId: "api-assessment-final-r2",
    });
    let candidateReady;
    try {
      candidateReady = await eventually(
        () => readProjection(teacherBinding),
        (response) => Boolean(
          response.json().learningCandidates.at(-1)?.candidateHash
          && response.json().learningReplayReports.at(-1)?.reportHash,
        ),
      );
    } catch (cause) {
      const diagnosticTimeline = await app.inject({
        method: "GET",
        url: `/api/sessions/${DEMO_SESSION_ID}/timeline?bindingId=${teacherBinding.bindingId}`,
        headers: authHeaders(login),
      });
      const diagnosticRuns = await app.inject({
        method: "GET",
        url: `/api/sessions/${DEMO_SESSION_ID}/agent-runs?bindingId=${teacherBinding.bindingId}`,
        headers: authHeaders(login),
      });
      const learningProjection = await engine.getProjection(
        DEMO_SESSION_ID,
        "agent-learning",
      );
      const learningTimeline = await engine.getTimeline(
        DEMO_SESSION_ID,
        "agent-learning",
      );
      const learningTrigger = learningTimeline.findLast(
        (event) => event.eventType === "teacher_reviewed",
      );
      const learningInput = learningTrigger?.payload.learningInput as {
        dimensions?: Array<{ evidenceRefs?: string[] }>;
      } | undefined;
      const learningEvidenceRefs = learningInput?.dimensions?.flatMap(
        (dimension) => dimension.evidenceRefs ?? [],
      ) ?? [];
      throw new Error(JSON.stringify({
        cause: cause instanceof Error ? cause.message : String(cause),
        events: diagnosticTimeline.json().events.slice(-12).map(
          (event: { eventType: string; payload: Record<string, unknown> }) => ({
            eventType: event.eventType,
            errorCode: event.payload.errorCode ?? null,
          }),
        ),
        runs: diagnosticRuns.json().runs.slice(-6).map(
          (run: { agentId: string; status: string; errorCode: string | null }) => ({
            agentId: run.agentId,
            status: run.status,
            errorCode: run.errorCode,
          }),
        ),
        learning: {
          triggerVisible: Boolean(learningTrigger),
          inputKeys: learningTrigger
            ? Object.keys(learningTrigger.payload.learningInput as object)
            : [],
          evidenceRefs: [...new Set(learningEvidenceRefs)],
          visibleEvidenceIds: learningProjection.evidence.map(
            (evidence) => evidence.evidenceId,
          ),
          evaluationCaseIds: learningProjection.evaluationCases.map(
            (item) => item.evaluationCaseId,
          ),
        },
      }));
    }
    const learningCandidate = candidateReady.json().learningCandidates.at(-1);
    const replayReport = candidateReady.json().learningReplayReports.at(-1);
    expect(learningCandidate.status).toBe("pending_review");
    expect(replayReport.status).toBe("passed");
    const approvedCandidate = await issueCommand(
      teacherBinding,
      "review_learning_candidate",
      {
        candidateId: learningCandidate.candidateId,
        expectedCandidateHash: learningCandidate.candidateHash,
        expectedReplayReportHash: replayReport.reportHash,
        decision: "approve",
        reason: "候选内容已脱敏，来源完整，离线回放通过。",
        requestId: "api-learning-approve-r2",
      },
    );
    const candidateReview = approvedCandidate.json().learningCandidateReviews.at(-1);
    await issueCommand(teacherBinding, "publish_learning_release", {
      candidateId: learningCandidate.candidateId,
      reviewId: candidateReview.reviewId,
      replayReportId: replayReport.reportId,
      expectedActiveReleaseId: null,
      version: "1.0.0",
      requestId: "api-learning-publish-r2",
    });

    const completed = await readProjection(teacherBinding);
    expect(completed.json().scenario.status).toBe("completed");
    const finalAssessment = completed.json().assessments.find(
      (assessment: { stage: string }) => assessment.stage === "teacher",
    );
    expect(finalAssessment).toMatchObject({ status: "final" });
    expect(completed.json().learningReleases).toHaveLength(1);
    expect(completed.json().activeLearningReleaseId).toBe(
      completed.json().learningReleases[0].releaseId,
    );
    const studentCompleted = await readProjection(editorBinding);
    expect(studentCompleted.json().assessmentFeedback).toMatchObject({
      evaluationCaseId: evaluationCase.evaluationCaseId,
      finalScore: finalAssessment.score,
    });
    expect(studentCompleted.json().assessments).toEqual([]);
    expect(studentCompleted.json().learningCandidates).toEqual([]);
    expect(studentCompleted.json().learningReplayReports).toEqual([]);
    expect(studentCompleted.json().teacherAssessmentReviews).toEqual([]);
    const studentJson = studentCompleted.body;
    expect(studentJson).not.toContain("教师内部确认");
    expect(studentJson).not.toMatch(/"providerRequestId":"[^"]+"/u);
    expect(studentJson).not.toContain(learningCandidate.candidateId);
    const activeRelease = completed.json().learningReleases[0];
    const rolledBack = await issueCommand(
      teacherBinding,
      "rollback_learning_release",
      {
        activeReleaseId: activeRelease.releaseId,
        expectedActiveContentHash: activeRelease.contentHash,
        targetReleaseId: null,
        reason: "端到端验收：回滚到系统基线并保留不可变发布历史。",
        requestId: "api-learning-rollback-r2",
      },
    );
    expect(rolledBack.json().activeLearningReleaseId).toBeNull();
    expect(rolledBack.json().learningReleases).toHaveLength(1);
    expect(rolledBack.json().learningReleaseRollbacks).toHaveLength(1);
    const templatesResponse = await app.inject({
      method: "GET",
      url: `/api/sessions/${DEMO_SESSION_ID}/agent-templates?bindingId=${teacherBinding.bindingId}`,
      headers: authHeaders(login),
    });
    expect(templatesResponse.statusCode).toBe(200);
    const templates = templatesResponse.json().templates;
    const assistanceTemplates = templates.filter(
      (entry: { plane: string }) => (
        entry.plane === "student_assistance"
        || entry.plane === "material_production"
        || entry.plane === "teacher_assistance"
      ),
    );
    expect(templates).toHaveLength(23);
    expect(templates.filter(
      (entry: { lifecycle: string }) => entry.lifecycle === "baseline",
    )).toHaveLength(14);
    expect(assistanceTemplates).toHaveLength(9);
    expect(assistanceTemplates.filter(
      (entry: { lifecycle: string }) => entry.lifecycle === "active",
    )).toHaveLength(3);
    const studentTemplatesResponse = await app.inject({
      method: "GET",
      url: `/api/sessions/${DEMO_SESSION_ID}/agent-templates?bindingId=${editorBinding.bindingId}`,
      headers: authHeaders(login),
    });
    expect(studentTemplatesResponse.statusCode).toBe(403);

    const instancesResponse = await app.inject({
      method: "GET",
      url: `/api/sessions/${DEMO_SESSION_ID}/agent-instances?bindingId=${teacherBinding.bindingId}`,
      headers: authHeaders(login),
    });
    expect(instancesResponse.statusCode).toBe(200);
    const assistanceInstanceAgentIds = instancesResponse.json().instances
      .filter((instance: { roleId: string }) => (
        instance.roleId === "student_assistant"
        || instance.roleId === "content_assistant"
        || instance.roleId === "teacher_assistant"
      ))
      .map((instance: { agentId: string }) => instance.agentId);
    expect(assistanceInstanceAgentIds).toEqual(expect.arrayContaining([
      "agent-evidence-coach",
      "agent-material-understanding",
      "agent-evaluation-review",
    ]));

    const timeline = await app.inject({
      method: "GET",
      url: `/api/sessions/${DEMO_SESSION_ID}/timeline?bindingId=${teacherBinding.bindingId}`,
      headers: authHeaders(login),
    });
    const eventTypes = timeline.json().events.map(
      (event: { eventType: string }) => event.eventType,
    );
    expect(eventTypes).toContain("role_response_intent_recorded");
    expect(eventTypes).toContain("agent_intent_recorded");
    expect(eventTypes).toContain("evaluation_case_opened");
    expect(eventTypes.filter(
      (eventType: string) => eventType === "evaluation_proposal_recorded",
    )).toHaveLength(4);
    expect(eventTypes.filter(
      (eventType: string) => eventType === "agent_assistance_recorded",
    ).length).toBeGreaterThanOrEqual(3);
    expect(eventTypes).toContain("evaluation_arbitrated");
    expect(eventTypes).toContain("teacher_reviewed");
    expect(eventTypes).toContain("learning_candidate_created");
    expect(eventTypes).toContain("learning_candidate_replay_completed");
    expect(eventTypes).toContain("learning_candidate_reviewed");
    expect(eventTypes).toContain("learning_release_published");
    expect(eventTypes).toContain("scene_completed");
    expect(eventTypes.at(-1)).toBe("learning_release_rolled_back");

    const trace = await app.inject({
      method: "GET",
      url: `/api/sessions/${DEMO_SESSION_ID}/trace?bindingId=${teacherBinding.bindingId}`,
      headers: authHeaders(login),
    });
    expect(trace.statusCode).toBe(200);
    const assistanceTraceRecords = trace.json().records.filter(
      (record: { kind: string }) => record.kind === "agent_assistance",
    );
    const traceDetail = (
      record: {
        details: Array<{ label: string; value: string }>;
      },
      label: string,
    ) => record.details.find((detail) => detail.label === label)?.value;
    expect(assistanceTraceRecords.map(
      (record: { details: Array<{ label: string; value: string }> }) => (
        traceDetail(record, "建议类型")
      ),
    )).toEqual(expect.arrayContaining([
      "evidence_coaching",
      "material_understanding",
      "evaluation_review",
    ]));
    expect(assistanceTraceRecords.every(
      (record: { details: Array<{ label: string; value: string }> }) => (
        Boolean(traceDetail(record, "辅助模板"))
        && Boolean(traceDetail(record, "辅助实例"))
        && Boolean(traceDetail(record, "输出 Schema"))
        && traceDetail(record, "权威边界") === "advisory_only"
        && Boolean(traceDetail(record, "结构化输出"))
      ),
    )).toBe(true);
    expect(assistanceTraceRecords.every(
      (record: { traceId: string }) => trace.json().links.some(
        (link: { toTraceId: string; relation: string }) => (
          link.toTraceId === record.traceId
          && link.relation === "produces"
        ),
      ),
    )).toBe(true);
    await app.close();
  }, 120_000);

  it("issues an opaque operator session and executes a server-bound multimodal command", async () => {
    const { app } = await testApp();
    const serviceHealth = await app.inject({ method: "GET", url: "/health" });
    expect(serviceHealth.json().version).toBe(ProductVersion);
    const login = await loginOperator(app);
    expect(login.bindings.map((item) => item.actorKind).sort()).toEqual([
      "student",
      "student",
      "teacher",
    ]);
    expect(login.bindings.some((item) => ["agent", "system"].includes(item.actorKind))).toBe(false);

    const setCookieResponse = await app.inject({
      method: "POST",
      url: "/api/auth/demo-session",
      headers: { origin: localOrigin },
      payload: {},
    });
    const setCookie = String(setCookieResponse.headers["set-cookie"]);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).toContain("Path=/api");
    expect(setCookie).not.toContain("teacher-main");
    expect(setCookie).not.toContain("student-editor");

    const teacherBinding = binding(login, "teacher");
    const studentBinding = binding(login, "student");
    const reset = await app.inject({
      method: "POST",
      url: "/api/sessions/demo/reset",
      headers: authHeaders(login, true),
      payload: { bindingId: teacherBinding.bindingId },
    });
    expect(reset.statusCode).toBe(200);
    const initial = reset.json();

    const action = await app.inject({
      method: "POST",
      url: `/api/sessions/${DEMO_SESSION_ID}/commands`,
      headers: authHeaders(login, true),
      payload: {
        bindingId: studentBinding.bindingId,
        name: "inspect_material",
        expectedStateVersion: initial.stateVersion,
        payload: { materialId: "material-festival-photo" },
      },
    });
    expect(action.statusCode).toBe(200);
    expect(action.json().recentEvents.some((event: { eventType: string }) => event.eventType === "material_observed"))
      .toBe(true);
    expect(action.json().recentEvents.find((event: { eventType: string }) => event.eventType === "material_observed").actorId)
      .toBe("student-editor");

    const teacher = await eventually(
      () => app.inject({
        method: "GET",
        url: `/api/sessions/${DEMO_SESSION_ID}/projection?bindingId=${teacherBinding.bindingId}`,
        headers: authHeaders(login),
      }),
      (response) => response.json().pendingCandidates.some(
        (candidate: { title: string }) => candidate.title === "客流数据更正",
      ),
    );
    expect(teacher.json().pendingCandidates.some(
      (candidate: { title: string }) => candidate.title === "客流数据更正",
    )).toBe(true);
    await app.close();
  });

  it("runs four governance branches, exposes teacher audit details, and keeps the student projection private", async () => {
    const governanceHandler = (
      capability: "image_moderation" | "image_understanding" | "rag",
    ) => ({
      capability,
      async execute(input: CapabilityExecutionInput) {
        const domain = String(input.metadata.governanceDomain);
        return {
          summary: `${domain} API integration finding`,
          extracted: {
            recommendation: domain === "copyright" ? "revise" : "allow",
            riskLabels: domain === "copyright" ? ["copyright_scope"] : [],
          },
          confidence: 0.9,
          providerRequestId: `teacher-only-request-${domain}`,
        };
      },
    });
    const { app } = await testApp(undefined, false, {
      adapter: new UnifiedIflytekAdapter({
        mode: "mock",
        environment: {},
        mockHandlers: [
          governanceHandler("image_moderation"),
          governanceHandler("image_understanding"),
          governanceHandler("rag"),
        ],
      }),
    });
    const login = await loginOperator(app);
    const editor = actorBinding(login, "student-editor");
    const teacher = actorBinding(login, "teacher-main");
    const readProjection = (roleBinding: RoleBinding) => app.inject({
      method: "GET",
      url: `/api/sessions/${DEMO_SESSION_ID}/projection?bindingId=${roleBinding.bindingId}`,
      headers: authHeaders(login),
    });
    const before = await readProjection(editor);
    const requested = await app.inject({
      method: "POST",
      url: `/api/sessions/${DEMO_SESSION_ID}/commands`,
      headers: authHeaders(login, true),
      payload: {
        bindingId: editor.bindingId,
        name: "request_governance_review",
        expectedStateVersion: before.json().stateVersion,
        payload: {
          materialId: "material-festival-photo",
          requestId: "api-governance-1",
        },
      },
    });
    expect(requested.statusCode).toBe(200);

    const teacherProjection = await eventually(
      () => readProjection(teacher),
      (response) => response.json().governanceReviews.some(
        (review: { status: string }) => review.status === "awaiting_teacher",
      ),
    );
    const review = teacherProjection.json().governanceReviews[0];
    expect(teacherProjection.json().governanceFindings).toHaveLength(4);
    expect(teacherProjection.json().governanceFindings.every(
      (finding: { providerRequestId: string | null }) => (
        finding.providerRequestId?.startsWith("teacher-only-request-")
      ),
    )).toBe(true);

    const studentBeforeReview = await readProjection(editor);
    expect(studentBeforeReview.json().governanceFindings.every(
      (finding: { providerRequestId: string | null }) => (
        finding.providerRequestId === null
      ),
    )).toBe(true);
    expect(studentBeforeReview.json().governanceReviews[0].requestId).toBe(
      "redacted",
    );
    expect(studentBeforeReview.json().mediaProcessingTasks[0]).toMatchObject({
      requestId: "redacted",
      idempotencyKey: "redacted",
    });
    expect(studentBeforeReview.json().mediaProcessingTasks[0].steps.every(
      (step: { idempotencyKey: string }) => step.idempotencyKey === "redacted",
    )).toBe(true);
    expect(JSON.stringify(studentBeforeReview.json())).not.toContain(
      "teacher-only-request-",
    );
    expect(JSON.stringify(studentBeforeReview.json())).not.toContain(
      "api-governance-1",
    );
    const studentTimeline = await app.inject({
      method: "GET",
      url: `/api/sessions/${DEMO_SESSION_ID}/timeline?bindingId=${editor.bindingId}`,
      headers: authHeaders(login),
    });
    expect(studentTimeline.statusCode).toBe(200);
    expect(JSON.stringify(studentTimeline.json())).not.toContain(
      "teacher-only-request-",
    );
    expect(JSON.stringify(studentTimeline.json())).not.toContain(
      "api-governance-1",
    );
    expect(studentTimeline.json().events.every(
      (event: { correlationId: string }) => event.correlationId === "redacted",
    )).toBe(true);
    const forbidden = await app.inject({
      method: "POST",
      url: `/api/sessions/${DEMO_SESSION_ID}/commands`,
      headers: authHeaders(login, true),
      payload: {
        bindingId: editor.bindingId,
        name: "review_governance",
        expectedStateVersion: studentBeforeReview.json().stateVersion,
        payload: {
          reviewId: review.reviewId,
          expectedArbitrationRevision: review.arbitrationRevision,
          expectedDecisionHash: review.decisionHash,
          decision: "approve",
          reviewNote: "学生越权复核",
          requestId: "api-governance-forbidden",
        },
      },
    });
    expect(forbidden.statusCode).toBe(403);

    const teacherBeforeReview = await readProjection(teacher);
    const approved = await app.inject({
      method: "POST",
      url: `/api/sessions/${DEMO_SESSION_ID}/commands`,
      headers: authHeaders(login, true),
      payload: {
        bindingId: teacher.bindingId,
        name: "review_governance",
        expectedStateVersion: teacherBeforeReview.json().stateVersion,
        payload: {
          reviewId: review.reviewId,
          expectedArbitrationRevision: review.arbitrationRevision,
          expectedDecisionHash: review.decisionHash,
          decision: "approve",
          reviewNote: "teacher-private-note-canary",
          requestId: "api-governance-approve",
        },
      },
    });
    expect(approved.statusCode).toBe(200);
    const studentAfterReview = await readProjection(editor);
    expect(studentAfterReview.json().governanceReviews[0]).toMatchObject({
      status: "approved",
      requestId: "redacted",
      reviewedBy: null,
      reviewNote: null,
    });
    expect(JSON.stringify(studentAfterReview.json())).not.toContain(
      "teacher-private-note-canary",
    );
    expect(JSON.stringify(studentAfterReview.json())).not.toContain(
      "api-governance-approve",
    );
    await app.close();
  });

  it("preflights identity and state before any external capability call", async () => {
    let capabilityCalls = 0;
    const adapter = new UnifiedIflytekAdapter({
      mode: "mock",
      environment: {
        IFLYTEK_IMAGE_ENDPOINT: "https://secret.example/image?signature=canary",
        IFLYTEK_IMAGE_APP_ID: "test-app",
        IFLYTEK_IMAGE_API_KEY: "test-key",
        IFLYTEK_IMAGE_API_SECRET: "test-secret",
      },
      mockHandlers: [{
        capability: "image_understanding",
        async execute(_input: CapabilityExecutionInput) {
          capabilityCalls += 1;
          return {
            summary: "测试图片观察",
            extracted: { scene: "市集" },
            confidence: 0.88,
            providerRequestId: "safe-request-id",
          };
        },
      }],
    });
    const { app } = await testApp(undefined, false, { adapter });
    const login = await loginOperator(app);
    const reporter = actorBinding(login, "student-reporter");
    const editor = actorBinding(login, "student-editor");

    const denied = await app.inject({
      method: "POST",
      url: `/api/sessions/${DEMO_SESSION_ID}/commands`,
      headers: authHeaders(login, true),
      payload: {
        bindingId: reporter.bindingId,
        name: "inspect_material",
        expectedStateVersion: 0,
        payload: { materialId: "material-festival-photo" },
      },
    });
    expect(denied.statusCode).toBe(403);
    expect(capabilityCalls).toBe(0);

    const stale = await app.inject({
      method: "POST",
      url: `/api/sessions/${DEMO_SESSION_ID}/commands`,
      headers: authHeaders(login, true),
      payload: {
        bindingId: editor.bindingId,
        name: "inspect_material",
        expectedStateVersion: 0,
        payload: { materialId: "material-festival-photo" },
      },
    });
    expect(stale.statusCode).toBe(409);
    expect(capabilityCalls).toBe(0);

    const before = await app.inject({
      method: "GET",
      url: `/api/sessions/${DEMO_SESSION_ID}/projection?bindingId=${editor.bindingId}`,
      headers: authHeaders(login),
    });
    const allowed = await app.inject({
      method: "POST",
      url: `/api/sessions/${DEMO_SESSION_ID}/commands`,
      headers: authHeaders(login, true),
      payload: {
        bindingId: editor.bindingId,
        name: "inspect_material",
        expectedStateVersion: before.json().stateVersion,
        payload: { materialId: "material-festival-photo" },
      },
    });
    expect(allowed.statusCode).toBe(200);
    expect(capabilityCalls).toBe(1);

    const adapterHealth = await app.inject({
      method: "GET",
      url: "/api/adapters/iflytek/health",
    });
    expect(adapterHealth.body).not.toContain("secret.example");
    expect(adapterHealth.body).not.toContain("canary");
    expect(adapterHealth.json().health.capabilities.every(
      (item: { endpoint: string | null }) => item.endpoint === null,
    )).toBe(true);
    await app.close();
  });

  it("validates and registers a content-addressed upload without trusting its path or media type", async () => {
    const objectStore = new InMemoryContentAddressedObjectStore();
    const { app } = await testApp(undefined, false, { objectStore });
    const login = await loginOperator(app);
    const editor = actorBinding(login, "student-editor");
    const before = await app.inject({
      method: "GET",
      url: `/api/sessions/${DEMO_SESSION_ID}/projection?bindingId=${editor.bindingId}`,
      headers: authHeaders(login),
    });
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from("test-image"),
    ]);
    const query = new URLSearchParams({
      bindingId: editor.bindingId,
      expectedStateVersion: String(before.json().stateVersion),
      requestId: "upload-1",
      title: "采访现场补充图",
      mimeType: "image/png",
    });

    query.set("fileName", "../escape.png");
    const unsafe = await app.inject({
      method: "POST",
      url: `/api/sessions/${DEMO_SESSION_ID}/materials?${query}`,
      headers: {
        ...authHeaders(login, true),
        "content-type": "application/octet-stream",
      },
      payload: png,
    });
    expect(unsafe.statusCode).toBe(400);
    expect(objectStore.count()).toBe(0);

    query.set("fileName", "interview.png");
    const uploaded = await app.inject({
      method: "POST",
      url: `/api/sessions/${DEMO_SESSION_ID}/materials?${query}`,
      headers: {
        ...authHeaders(login, true),
        "content-type": "application/octet-stream",
      },
      payload: png,
    });
    expect(uploaded.statusCode).toBe(200);
    expect(uploaded.json().material).toMatchObject({
      origin: "upload",
      mediaType: "image",
      mimeType: "image/png",
      uploadedBy: "student-editor",
    });
    expect(uploaded.json().material.sourceRef).toMatch(
      /^object:\/\/demo-local-tourism\/[a-f0-9]{64}$/u,
    );
    expect(objectStore.count()).toBe(1);

    const forgedMime = new URLSearchParams({
      bindingId: editor.bindingId,
      expectedStateVersion: String(uploaded.json().projection.stateVersion),
      requestId: "upload-2",
      title: "伪造 PDF",
      mimeType: "application/pdf",
      fileName: "forged.pdf",
    });
    const rejectedMime = await app.inject({
      method: "POST",
      url: `/api/sessions/${DEMO_SESSION_ID}/materials?${forgedMime}`,
      headers: {
        ...authHeaders(login, true),
        "content-type": "application/octet-stream",
      },
      payload: png,
    });
    expect(rejectedMime.statusCode).toBe(400);
    expect(objectStore.count()).toBe(1);
    await app.close();
  });

  it("keeps dual-director audit private until a teacher approves the recovered world consequence", async () => {
    const { app } = await testApp();
    const login = await loginOperator(app);
    const teacherBinding = binding(login, "teacher");
    const studentBinding = binding(login, "student");
    const readProjection = (roleBinding: RoleBinding) => app.inject({
      method: "GET",
      url: `/api/sessions/${DEMO_SESSION_ID}/projection?bindingId=${roleBinding.bindingId}`,
      headers: authHeaders(login),
    });

    const teacherInitial = await readProjection(teacherBinding);
    const original = teacherInitial.json().pendingCandidates.find(
      (candidate: { candidateKind: string }) => (
        candidate.candidateKind === "director_intervention"
      ),
    );
    expect(original).toMatchObject({
      routeId: "route-source-scaffold",
      requiresTeacherReview: true,
    });
    expect(teacherInitial.json().teachingDirectives.length).toBeGreaterThan(0);
    expect(teacherInitial.json().sceneDirectorDecisions.length).toBeGreaterThan(0);

    const studentInitial = await readProjection(studentBinding);
    expect(studentInitial.json().pendingCandidates).toEqual([]);
    expect(studentInitial.json().candidateHistory).toEqual([]);
    expect(studentInitial.json().teachingDirectives).toEqual([]);
    expect(studentInitial.json().sceneDirectorDecisions).toEqual([]);

    const rejectionReason = "改用低风险补证任务，避免提前施加时效压力";
    const rejected = await app.inject({
      method: "POST",
      url: `/api/sessions/${DEMO_SESSION_ID}/commands`,
      headers: authHeaders(login, true),
      payload: {
        bindingId: teacherBinding.bindingId,
        name: "reject_candidate_event",
        expectedStateVersion: teacherInitial.json().stateVersion,
        payload: {
          candidateId: original.candidateId,
          reason: rejectionReason,
        },
      },
    });
    expect(rejected.statusCode).toBe(200);

    const recovered = await eventually(
      () => readProjection(teacherBinding),
      (response) => response.json().pendingCandidates.some(
        (candidate: { recoveryOfCandidateId: string | null }) => (
          candidate.recoveryOfCandidateId === original.candidateId
        ),
      ),
    );
    const recoveryCandidate = recovered.json().pendingCandidates.find(
      (candidate: { recoveryOfCandidateId: string | null }) => (
        candidate.recoveryOfCandidateId === original.candidateId
      ),
    );
    expect(recoveryCandidate.routeId).toBe("route-recovery-source-brief");
    expect(recovered.json().candidateHistory.find(
      (candidate: { candidateId: string }) => candidate.candidateId === original.candidateId,
    ).reviewReason).toBe(rejectionReason);

    const studentAfterRejection = await readProjection(studentBinding);
    expect(studentAfterRejection.body).not.toContain(rejectionReason);
    expect(studentAfterRejection.json().recentEvents.some(
      (event: { eventType: string }) => (
        event.eventType === "candidate_event_rejected"
        || event.eventType === "director_recovery_requested"
      ),
    )).toBe(false);

    const approved = await app.inject({
      method: "POST",
      url: `/api/sessions/${DEMO_SESSION_ID}/commands`,
      headers: authHeaders(login, true),
      payload: {
        bindingId: teacherBinding.bindingId,
        name: "approve_candidate_event",
        expectedStateVersion: recovered.json().stateVersion,
        payload: { candidateId: recoveryCandidate.candidateId },
      },
    });
    expect(approved.statusCode).toBe(200);
    const studentApplied = await readProjection(studentBinding);
    expect(studentApplied.json().activeInterventions[0]).toMatchObject({
      routeId: "route-recovery-source-brief",
      sourceCandidateId: recoveryCandidate.candidateId,
    });
    await app.close();
  });

  it("rejects missing sessions, forged actor claims, missing CSRF, and student teacher-actions without mutation", async () => {
    const authService = new DemoAuthService();
    const issued = authService.issueSession(DEMO_SESSION_ID, "student");
    const { app, engine } = await testApp(authService);
    const studentBinding = issued.context.bindings[0]!;
    const studentLogin: TestLogin = {
      cookie: authService.cookieHeader(issued.token).split(";")[0]!,
      csrfToken: issued.context.csrfToken,
      bindings: issued.context.bindings,
    };

    const unauthenticated = await app.inject({
      method: "GET",
      url: `/api/sessions/${DEMO_SESSION_ID}/projection?bindingId=${studentBinding.bindingId}&actorId=teacher-main`,
    });
    expect(unauthenticated.statusCode).toBe(401);

    const initial = await app.inject({
      method: "GET",
      url: `/api/sessions/${DEMO_SESSION_ID}/projection?bindingId=${studentBinding.bindingId}`,
      headers: authHeaders(studentLogin),
    });
    const version = initial.json().stateVersion;
    const beforeEvents = await engine.store.load(DEMO_SESSION_ID);

    const forged = await app.inject({
      method: "POST",
      url: `/api/sessions/${DEMO_SESSION_ID}/commands`,
      headers: authHeaders(studentLogin, true),
      payload: {
        bindingId: studentBinding.bindingId,
        actorId: "teacher-main",
        name: "approve_candidate_event",
        expectedStateVersion: version,
        payload: {},
      },
    });
    expect(forged.statusCode).toBe(403);

    const missingCsrf = await app.inject({
      method: "POST",
      url: `/api/sessions/${DEMO_SESSION_ID}/commands`,
      headers: authHeaders(studentLogin),
      payload: {
        bindingId: studentBinding.bindingId,
        name: "inspect_material",
        expectedStateVersion: version,
        payload: {},
      },
    });
    expect(missingCsrf.statusCode).toBe(403);

    const forbidden = await app.inject({
      method: "POST",
      url: `/api/sessions/${DEMO_SESSION_ID}/commands`,
      headers: authHeaders(studentLogin, true),
      payload: {
        bindingId: studentBinding.bindingId,
        name: "approve_candidate_event",
        expectedStateVersion: version,
        payload: {},
      },
    });
    expect(forbidden.statusCode).toBe(403);
    expect(await engine.store.load(DEMO_SESSION_ID)).toEqual(beforeEvents);
    await app.close();
  });

  it("returns conflict errors and preserves the world", async () => {
    const { app } = await testApp();
    const login = await loginOperator(app);
    const studentBinding = binding(login, "student");
    const projection = await app.inject({
      method: "GET",
      url: `/api/sessions/${DEMO_SESSION_ID}/projection?bindingId=${studentBinding.bindingId}`,
      headers: authHeaders(login),
    });
    const conflict = await app.inject({
      method: "POST",
      url: `/api/sessions/${DEMO_SESSION_ID}/commands`,
      headers: authHeaders(login, true),
      payload: {
        bindingId: studentBinding.bindingId,
        name: "inspect_material",
        expectedStateVersion: 0,
        payload: {},
      },
    });
    expect(projection.statusCode).toBe(200);
    expect(conflict.statusCode).toBe(409);
    await app.close();
  });

  it("exposes role-filtered RAG and credential-free adapter health", async () => {
    const { app } = await testApp();
    const login = await loginOperator(app);
    const studentBinding = binding(login, "student");
    const rag = await app.inject({
      method: "GET",
      url: `/api/sessions/${DEMO_SESSION_ID}/rag?bindingId=${studentBinding.bindingId}&q=${encodeURIComponent("图片版权授权")}`,
      headers: authHeaders(login),
    });
    expect(rag.statusCode).toBe(200);
    expect(rag.json().citations.length).toBeGreaterThan(0);
    const health = await app.inject({ method: "GET", url: "/api/adapters/iflytek/health" });
    expect(health.json().health.mode).toBe("mock");
    const modelHealth = await app.inject({ method: "GET", url: "/api/models/health" });
    expect(modelHealth.json().health.provider).toBe("deterministic");
    expect(modelHealth.json().health.baseUrl).toBeNull();
    await app.close();
  });

  it("keeps private memory out of public RAG and exposes it only through explicit teacher context audit", async () => {
    const { app } = await testApp();
    const login = await loginOperator(app);
    const studentBinding = binding(login, "student");
    const teacherBinding = binding(login, "teacher");

    const publicRag = await app.inject({
      method: "GET",
      url: `/api/sessions/${DEMO_SESSION_ID}/rag?bindingId=${studentBinding.bindingId}&q=${encodeURIComponent("入口去重")}`,
      headers: authHeaders(login),
    });
    expect(publicRag.statusCode).toBe(200);
    expect(publicRag.body).not.toContain("入口去重表仍需与活动执行方快报交叉核对");
    expect(publicRag.body).not.toContain("privateMemory");

    const teacherDebug = await app.inject({
      method: "GET",
      url: `/api/sessions/${DEMO_SESSION_ID}/context-debug?bindingId=${teacherBinding.bindingId}&targetAgentId=agent-fact-checker&q=${encodeURIComponent("入口去重")}`,
      headers: authHeaders(login),
    });
    expect(teacherDebug.statusCode).toBe(200);
    expect(teacherDebug.json().audit).toMatchObject({
      requesterActorId: "teacher-main",
      targetActorId: "agent-fact-checker",
      privateContentIncluded: true,
    });
    expect(teacherDebug.json().context.privateMemory[0].content).toContain("18,000");
    expect(teacherDebug.json().manifest.contextHash).toMatch(/^[a-f0-9]{64}$/u);

    const studentDebug = await app.inject({
      method: "GET",
      url: `/api/sessions/${DEMO_SESSION_ID}/context-debug?bindingId=${studentBinding.bindingId}&targetAgentId=agent-fact-checker&q=${encodeURIComponent("入口去重")}`,
      headers: authHeaders(login),
    });
    expect(studentDebug.statusCode).toBe(403);
    await app.close();
  });

  it("exposes sanitized AgentRun traces only through a teacher binding", async () => {
    const { app } = await testApp();
    const login = await loginOperator(app);
    const studentBinding = binding(login, "student");
    const teacherBinding = binding(login, "teacher");
    const projection = await app.inject({
      method: "GET",
      url: `/api/sessions/${DEMO_SESSION_ID}/projection?bindingId=${studentBinding.bindingId}`,
      headers: authHeaders(login),
    });
    const action = await app.inject({
      method: "POST",
      url: `/api/sessions/${DEMO_SESSION_ID}/commands`,
      headers: authHeaders(login, true),
      payload: {
        bindingId: studentBinding.bindingId,
        name: "inspect_material",
        expectedStateVersion: projection.json().stateVersion,
        payload: { materialId: "material-festival-photo" },
      },
    });
    expect(action.statusCode).toBe(200);

    const teacherRuns = await eventually(
      () => app.inject({
        method: "GET",
        url: `/api/sessions/${DEMO_SESSION_ID}/agent-runs?bindingId=${teacherBinding.bindingId}`,
        headers: authHeaders(login),
      }),
      (response) => response.json().runs.some((run: { agentId: string }) => (
        run.agentId === "agent-fact-checker"
      )),
    );
    expect(teacherRuns.statusCode).toBe(200);
    const factCheckerRun = teacherRuns.json().runs.find((run: { agentId: string }) => (
      run.agentId === "agent-fact-checker"
    ));
    expect(factCheckerRun.modelInvocations).toEqual([]);
    expect(factCheckerRun.contextManifest.includedCitationRefs).toContain(
      "scenario-visitor-dedup-source",
    );
    expect(factCheckerRun.promptHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(teacherRuns.body).not.toContain("入口去重表仍需与活动执行方快报交叉核对");

    const teacherTrace = await eventually(
      () => app.inject({
        method: "GET",
        url: `/api/sessions/${DEMO_SESSION_ID}/trace?bindingId=${teacherBinding.bindingId}`,
        headers: authHeaders(login),
      }),
      (response) => {
        const payload = response.json();
        return Array.isArray(payload.records) && payload.records.some(
          (record: { kind: string; agentId: string | null }) => (
            record.kind === "agent_run"
            && record.agentId === "agent-fact-checker"
          ),
        );
      },
    );
    expect(teacherTrace.statusCode).toBe(200);
    expect(teacherTrace.json().summary.runCount).toBeGreaterThan(0);
    expect(teacherTrace.json().records.some(
      (record: { kind: string }) => record.kind === "outbox",
    )).toBe(true);
    expect(teacherTrace.json().links.some(
      (link: { relation: string }) => link.relation === "executes",
    )).toBe(true);
    expect(teacherTrace.body).not.toContain("idempotencyKey");
    expect(teacherTrace.body).not.toContain("PRIVATE_LEASE_TOKEN");
    expect(teacherTrace.body).not.toContain(
      "入口去重表仍需与活动执行方快报交叉核对",
    );

    const studentRuns = await app.inject({
      method: "GET",
      url: `/api/sessions/${DEMO_SESSION_ID}/agent-runs?bindingId=${studentBinding.bindingId}`,
      headers: authHeaders(login),
    });
    expect(studentRuns.statusCode).toBe(403);

    const studentTrace = await app.inject({
      method: "GET",
      url: `/api/sessions/${DEMO_SESSION_ID}/trace?bindingId=${studentBinding.bindingId}`,
      headers: authHeaders(login),
    });
    expect(studentTrace.statusCode).toBe(403);
    await app.close();
  });

  it("copies, safely edits, validates, previews, publishes and starts a pinned scenario release", async () => {
    const { app } = await testApp();
    const login = await loginOperator(app);
    const teacher = actorBinding(login, "teacher-main");
    const student = actorBinding(login, "student-editor");
    const authorQuery = `authorizationSessionId=${DEMO_SESSION_ID}&bindingId=${teacher.bindingId}`;

    const studentDenied = await app.inject({
      method: "GET",
      url: `/api/scenario-packages?authorizationSessionId=${DEMO_SESSION_ID}&bindingId=${student.bindingId}`,
      headers: authHeaders(login),
    });
    expect(studentDenied.statusCode).toBe(403);

    const listed = await app.inject({
      method: "GET",
      url: `/api/scenario-packages?${authorQuery}`,
      headers: authHeaders(login),
    });
    expect(listed.statusCode).toBe(200);
    const sourceRelease = listed.json().releases.find(
      (release: { ref: { scenarioId: string; version: string } }) => (
        release.ref.scenarioId === demoScenario.scenarioId
        && release.ref.version === "1.0.0"
      ),
    );
    expect(sourceRelease).toBeTruthy();
    if (!sourceRelease) throw new Error("测试目录缺少 V1.0.0 旗舰发布版");

    const copied = await app.inject({
      method: "POST",
      url: `/api/scenario-releases/${sourceRelease.ref.releaseId}/copies`,
      headers: authHeaders(login, true),
      payload: {
        authorizationSessionId: DEMO_SESSION_ID,
        bindingId: teacher.bindingId,
      },
    });
    expect(copied.statusCode).toBe(200);
    expect(copied.json().draft.package.version).toBe("1.1.0");
    expect(copied.json().draft.package.courseGuide.contentVersion).toBe("1.1.0");
    const draftId = copied.json().draft.draftId as string;

    const saved = await app.inject({
      method: "PATCH",
      url: `/api/scenario-drafts/${draftId}`,
      headers: authHeaders(login, true),
      payload: {
        authorizationSessionId: DEMO_SESSION_ID,
        bindingId: teacher.bindingId,
        expectedRevision: 1,
        patch: {
          version: "1.1.2",
          title: "地方文旅活动融媒体报道·校内联调版",
          roles: [{
            agentId: "student-editor",
            displayName: "责任编辑·联调岗",
            purpose: "在版本化情境中完成事实、版权与发布决策联调",
          }],
          approvalPolicies: [{
            approvalPolicyId: "teacher-world-event-review",
            label: "教师复核并要求至少一条证据",
            allowReject: true,
            reasonRequired: true,
            minimumEvidenceCount: 1,
          }],
        },
      },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().draft.revision).toBe(2);
    expect(saved.json().draft.package.courseGuide.contentVersion).toBe("1.1.2");
    expect(saved.json().draft.package.roles.find(
      (role: { agentId: string }) => role.agentId === "student-editor",
    ).displayName).toBe("责任编辑·联调岗");

    const validated = await app.inject({
      method: "POST",
      url: `/api/scenario-drafts/${draftId}/validate`,
      headers: authHeaders(login, true),
      payload: {
        authorizationSessionId: DEMO_SESSION_ID,
        bindingId: teacher.bindingId,
        expectedRevision: 2,
      },
    });
    expect(validated.statusCode).toBe(200);
    expect(validated.json().report.valid).toBe(true);
    const validationStamp = validated.json().report.validationStamp as string;

    const previewed = await app.inject({
      method: "POST",
      url: `/api/scenario-drafts/${draftId}/preview`,
      headers: authHeaders(login, true),
      payload: {
        authorizationSessionId: DEMO_SESSION_ID,
        bindingId: teacher.bindingId,
        expectedRevision: 2,
      },
    });
    expect(previewed.statusCode).toBe(200);
    expect(previewed.json().preview.summary.changedFields).toEqual(
      expect.arrayContaining(["标题", "岗位", "审批策略"]),
    );

    const published = await app.inject({
      method: "POST",
      url: `/api/scenario-drafts/${draftId}/publish`,
      headers: authHeaders(login, true),
      payload: {
        authorizationSessionId: DEMO_SESSION_ID,
        bindingId: teacher.bindingId,
        expectedRevision: 2,
        validationStamp,
      },
    });
    expect(published.statusCode).toBe(200);
    expect(published.json().release.ref.contentHash).toMatch(/^[a-f0-9]{64}$/u);
    const releaseId = published.json().release.ref.releaseId as string;

    const started = await app.inject({
      method: "POST",
      url: "/api/training-sessions",
      headers: authHeaders(login, true),
      payload: {
        authorizationSessionId: DEMO_SESSION_ID,
        bindingId: teacher.bindingId,
        requestId: "request-start-published-scenario",
        classroomId: "classroom-local-tourism-a",
        teamId: "team-local-tourism-a",
        releaseId,
      },
    });
    expect(started.statusCode).toBe(200);
    expect(started.json().sessionId).not.toBe(DEMO_SESSION_ID);
    const newSessionId = started.json().sessionId as string;
    const newTeacher = (started.json().bindings as RoleBinding[]).find(
      (item) => item.actorKind === "teacher",
    );
    if (!newTeacher) throw new Error("新会话缺少教师绑定");

    const oldProjection = await app.inject({
      method: "GET",
      url: `/api/sessions/${DEMO_SESSION_ID}/projection?bindingId=${teacher.bindingId}`,
      headers: authHeaders(login),
    });
    const newProjection = await app.inject({
      method: "GET",
      url: `/api/sessions/${newSessionId}/projection?bindingId=${newTeacher.bindingId}`,
      headers: authHeaders(login),
    });
    expect(oldProjection.statusCode).toBe(200);
    expect(newProjection.statusCode).toBe(200);
    expect(oldProjection.json().scenario).toMatchObject({
      title: "地方文旅活动融媒体报道",
      version: "1.0.0",
    });
    expect(newProjection.json().scenario).toMatchObject({
      title: "地方文旅活动融媒体报道·校内联调版",
      version: "1.1.2",
      releaseId,
    });
    expect(newProjection.json().scenario.contentHash).not.toBe(
      oldProjection.json().scenario.contentHash,
    );
    await app.close();
  });

  it("publishes only a server-verified flagship collaboration config and reuses its frozen reference", async () => {
    const { app, engine } = await testApp(undefined, false, {
      initializeGoldScenarioRelease: true,
    });
    const login = await loginOperator(app);
    const teacher = actorBinding(login, "teacher-main");
    const authorIdentity = {
      authorizationSessionId: DEMO_SESSION_ID,
      bindingId: teacher.bindingId,
    };
    const authorQuery =
      `authorizationSessionId=${DEMO_SESSION_ID}`
      + `&bindingId=${teacher.bindingId}`;

    const created = await app.inject({
      method: "POST",
      url: "/api/collaboration-strategies",
      headers: authHeaders(login, true),
      payload: {
        ...authorIdentity,
        strategy: {
          strategyId: "strategy-rain-collaboration",
          version: 1,
          content: collaborationStrategyContent(),
        },
      },
    });
    expect(created.statusCode).toBe(201);
    const contentHash = created.json().strategy.contentHash as string;
    const govern = (
      expectedStatus: "draft" | "approved" | "disabled",
      expectedGovernanceRevision: number,
      action: "approve" | "disable",
    ) => app.inject({
      method: "POST",
      url: "/api/collaboration-strategies"
        + "/strategy-rain-collaboration/versions/1/governance",
      headers: authHeaders(login, true),
      payload: {
        ...authorIdentity,
        transition: {
          expectedStatus,
          expectedGovernanceRevision,
          expectedContentHash: contentHash,
          action,
          reason: `情境发布集成测试执行 ${action}。`,
        },
      },
    });
    expect((await govern("draft", 0, "approve")).statusCode).toBe(200);

    const listed = await app.inject({
      method: "GET",
      url: `/api/scenario-packages?${authorQuery}`,
      headers: authHeaders(login),
    });
    const sourceRelease = listed.json().releases.find(
      (release: { ref: { scenarioId: string; version: string } }) => (
        release.ref.scenarioId === ScenarioCollaborationFlagshipScenarioId
        && release.ref.version === "1.1.1"
      ),
    );
    expect(sourceRelease).toBeTruthy();
    if (!sourceRelease) {
      throw new Error("测试目录缺少 V1.1.1 旗舰发布版");
    }
    expect(
      `${sourceRelease.ref.scenarioId}@${sourceRelease.ref.version}`,
    ).toBe(FlagshipCollaborationScenarioReleaseId);

    const copied = await app.inject({
      method: "POST",
      url: `/api/scenario-releases/${sourceRelease.ref.releaseId}/copies`,
      headers: authHeaders(login, true),
      payload: authorIdentity,
    });
    expect(copied.statusCode).toBe(200);
    const draftId = copied.json().draft.draftId as string;
    const config = {
      schemaVersion: ScenarioCollaborationConfigSchemaVersion,
      routeId: FlagshipCollaborationRouteId,
      eventId: FlagshipCollaborationEventId,
      enabledAgentTemplateIds: [...ScenarioActiveAgentTemplateIds],
      strategyRef: {
        strategyId: "strategy-rain-collaboration",
        version: 1,
        contentHash,
      },
    };

    const forgedPatch = await app.inject({
      method: "PATCH",
      url: `/api/scenario-drafts/${draftId}`,
      headers: authHeaders(login, true),
      payload: {
        ...authorIdentity,
        expectedRevision: 1,
        patch: {
          collaborationConfig: config,
          governance: { status: "approved" },
        },
      },
    });
    expect(forgedPatch.statusCode).toBe(400);

    const saved = await app.inject({
      method: "PATCH",
      url: `/api/scenario-drafts/${draftId}`,
      headers: authHeaders(login, true),
      payload: {
        ...authorIdentity,
        expectedRevision: 1,
        patch: { collaborationConfig: config },
      },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().draft.package.collaborationConfig).toEqual(config);

    const forgedValidation = await app.inject({
      method: "POST",
      url: `/api/scenario-drafts/${draftId}/validate`,
      headers: authHeaders(login, true),
      payload: {
        ...authorIdentity,
        expectedRevision: 2,
        collaborationStrategySnapshot: [],
      },
    });
    expect(forgedValidation.statusCode).toBe(400);

    const validated = await app.inject({
      method: "POST",
      url: `/api/scenario-drafts/${draftId}/validate`,
      headers: authHeaders(login, true),
      payload: {
        ...authorIdentity,
        expectedRevision: 2,
      },
    });
    expect(validated.statusCode).toBe(200);
    expect(validated.json().report.valid).toBe(true);
    const validationStamp =
      validated.json().report.validationStamp as string;

    const previewed = await app.inject({
      method: "POST",
      url: `/api/scenario-drafts/${draftId}/preview`,
      headers: authHeaders(login, true),
      payload: {
        ...authorIdentity,
        expectedRevision: 2,
      },
    });
    expect(previewed.statusCode).toBe(200);
    expect(previewed.json().preview.report.valid).toBe(true);
    expect(previewed.json().preview.summary.changedFields).toContain(
      "协作配置",
    );

    expect((await govern("approved", 1, "disable")).statusCode).toBe(200);
    const blockedPublish = await app.inject({
      method: "POST",
      url: `/api/scenario-drafts/${draftId}/publish`,
      headers: authHeaders(login, true),
      payload: {
        ...authorIdentity,
        expectedRevision: 2,
        validationStamp,
      },
    });
    expect(blockedPublish.statusCode).toBe(409);
    expect((await govern("disabled", 2, "approve")).statusCode).toBe(200);

    const published = await app.inject({
      method: "POST",
      url: `/api/scenario-drafts/${draftId}/publish`,
      headers: authHeaders(login, true),
      payload: {
        ...authorIdentity,
        expectedRevision: 2,
        validationStamp,
      },
    });
    expect(published.statusCode).toBe(200);
    expect(published.json().release.package.collaborationConfig).toEqual(
      config,
    );
    const releaseId = published.json().release.ref.releaseId as string;

    const started = await app.inject({
      method: "POST",
      url: "/api/training-sessions",
      headers: authHeaders(login, true),
      payload: {
        ...authorIdentity,
        requestId: "request-start-collaboration-config",
        classroomId: "classroom-local-tourism-a",
        teamId: "team-local-tourism-a",
        releaseId,
      },
    });
    expect(started.statusCode).toBe(200);
    const newSessionId = started.json().sessionId as string;
    const student = (started.json().bindings as RoleBinding[]).find(
      (binding) => binding.actorId === "student-editor",
    );
    if (!student) throw new Error("受限配置会话缺少学生绑定");
    const before = await engine.getStateSnapshot(newSessionId);

    const explanation = await app.inject({
      method: "GET",
      url: `/api/sessions/${newSessionId}/strategy-reuse-explanation`
        + `?bindingId=${student.bindingId}`,
      headers: authHeaders(login),
    });
    expect(explanation.statusCode).toBe(200);
    expect(explanation.json()).toMatchObject({
      status: "not_reused",
      reasonCode: "no_match",
      scenarioId: ScenarioCollaborationFlagshipScenarioId,
    });
    expect((await engine.getStateSnapshot(newSessionId)).stateVersion).toBe(
      before.stateVersion,
    );
    await app.close();
  }, 60_000);

  it("preserves the flagship and starts both the template and prospective transfer releases", async () => {
    const { app } = await testApp(undefined, false, {
      initializeGoldScenarioRelease: true,
    });
    const login = await loginOperator(app);
    const teacher = actorBinding(login, "teacher-main");
    const authorQuery = `authorizationSessionId=${DEMO_SESSION_ID}&bindingId=${teacher.bindingId}`;

    const listed = await app.inject({
      method: "GET",
      url: `/api/scenario-packages?${authorQuery}`,
      headers: authHeaders(login),
    });
    expect(listed.statusCode).toBe(200);
    const releases = listed.json().releases as Array<{
      ref: {
        releaseId: string;
        scenarioId: string;
        version: string;
        contentHash: string;
      };
      package: {
        nodes: unknown[];
        directorEventTemplates?: Array<{
          routeId: string;
        }>;
        experienceDesign?: {
          kind: string;
          nodeMappings: unknown[];
          npcInstances: unknown[];
        };
      };
    }>;
    const flagship = releases.find((release) => (
      release.ref.scenarioId === demoScenario.scenarioId
      && release.ref.version === "1.1.0"
    ));
    const flagshipGold = releases.find((release) => (
      release.ref.scenarioId === demoScenario.scenarioId
      && release.ref.version === "1.1.1"
    ));
    const transfer = releases.find((release) => (
      release.ref.scenarioId === "scenario-rain-closure-briefing-v1"
      && release.ref.version === "1.0.0"
    ));
    const prospectiveTransfer = releases.find((release) => (
      release.ref.scenarioId === "scenario-heritage-night-tour-capacity-v1"
      && release.ref.version === "1.0.0"
    ));
    expect(flagship?.package.nodes).toHaveLength(7);
    expect(flagship?.package.experienceDesign).toMatchObject({
      kind: "flagship",
    });
    expect(flagship?.package.experienceDesign?.nodeMappings).toHaveLength(7);
    expect(flagshipGold?.package.nodes).toHaveLength(7);
    expect(flagshipGold?.package.directorEventTemplates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ routeId: "route-rain-escalation" }),
        expect.objectContaining({ routeId: "route-recovery-rain-brief" }),
      ]),
    );
    expect(transfer?.package.nodes).toHaveLength(3);
    expect(transfer?.package.experienceDesign).toMatchObject({
      kind: "micro_transfer",
    });
    expect(transfer?.package.experienceDesign?.npcInstances).toHaveLength(2);
    expect(prospectiveTransfer?.package.nodes).toHaveLength(3);
    expect(prospectiveTransfer?.package.experienceDesign).toMatchObject({
      kind: "micro_transfer",
    });
    expect(prospectiveTransfer?.package.experienceDesign?.npcInstances)
      .toHaveLength(2);
    if (!transfer) throw new Error("测试目录缺少第二微型迁移情境");

    const started = await app.inject({
      method: "POST",
      url: "/api/training-sessions",
      headers: authHeaders(login, true),
      payload: {
        authorizationSessionId: DEMO_SESSION_ID,
        bindingId: teacher.bindingId,
        requestId: "request-start-transfer-scenario",
        classroomId: "classroom-local-tourism-a",
        teamId: "team-local-tourism-a",
        releaseId: transfer.ref.releaseId,
      },
    });
    expect(started.statusCode).toBe(200);
    const transferSessionId = started.json().sessionId as string;
    const transferBindings = started.json().bindings as RoleBinding[];
    const editor = transferBindings.find(
      (binding) => binding.actorId === "student-editor",
    );
    const reporter = transferBindings.find(
      (binding) => binding.actorId === "student-reporter",
    );
    const transferTeacher = transferBindings.find(
      (binding) => binding.actorId === "teacher-main",
    );
    if (!editor || !reporter || !transferTeacher) {
      throw new Error("迁移情境缺少两个学生岗位绑定");
    }
    const [editorProjection, reporterProjection] = await Promise.all([
      app.inject({
        method: "GET",
        url: `/api/sessions/${transferSessionId}/projection?bindingId=${editor.bindingId}`,
        headers: authHeaders(login),
      }),
      app.inject({
        method: "GET",
        url: `/api/sessions/${transferSessionId}/projection?bindingId=${reporter.bindingId}`,
        headers: authHeaders(login),
      }),
    ]);
    expect(editorProjection.statusCode).toBe(200);
    expect(reporterProjection.statusCode).toBe(200);
    expect(editorProjection.json().scenario).toMatchObject({
      scenarioId: "scenario-rain-closure-briefing-v1",
      version: "1.0.0",
      releaseId: transfer.ref.releaseId,
    });
    expect(editorProjection.json().nodes).toHaveLength(3);
    expect(editorProjection.json().experienceGuide).toMatchObject({
      kind: "micro_transfer",
      currentNodeMapping: {
        nodeId: "brief",
      },
    });
    expect(editorProjection.json().structuredWorld).toMatchObject({
      schemaVersion: "structured-world-stage/1.0.0",
      scene: {
        sceneId: "transfer-scene-command",
      },
      hotspots: [{
        hotspotId: "transfer-hotspot-brief-board",
        choices: [{
          choiceRef: "transfer-task-risk-plan",
          command: "record_experience_choice",
        }],
      }],
    });
    expect(editorProjection.body).not.toContain("privatePerspective");
    expect(editorProjection.body).not.toContain("withheldInformation");
    expect(reporterProjection.json().courseGuide.activeRoleBrief.roleId)
      .toBe("reporter");

    const choice = await app.inject({
      method: "POST",
      url: `/api/sessions/${transferSessionId}/commands`,
      headers: authHeaders(login, true),
      payload: {
        bindingId: editor.bindingId,
        name: "record_experience_choice",
        expectedStateVersion: editorProjection.json().stateVersion,
        actionId: "action-api-transfer-risk-plan",
        idempotencyKey: "idempotency-api-transfer-risk-plan",
        sourceMode: "world_interaction",
        surfaceId: "student-world-stage",
        interactionId: "transfer-task-risk-plan",
        payload: { choiceRef: "transfer-task-risk-plan" },
      },
    });
    expect(choice.statusCode).toBe(200);
    expect(choice.json().structuredWorld.tasks[0]).toMatchObject({
      taskId: "transfer-task-risk-plan",
      status: "waiting",
    });
    expect(choice.json().structuredWorld.causalReplay[0]).toMatchObject({
      rootActionId: "action-api-transfer-risk-plan",
      sourceMode: "world_interaction",
      commandName: "record_experience_choice",
    });

    const teacherProjection = await app.inject({
      method: "GET",
      url: `/api/sessions/${transferSessionId}/projection?bindingId=${transferTeacher.bindingId}`,
      headers: authHeaders(login),
    });
    const gatedCandidate = teacherProjection.json().pendingCandidates.find(
      (candidate: { payload?: { dynamicEventId?: string } }) => (
        candidate.payload?.dynamicEventId
          === "transfer-event-rain-warning"
      ),
    );
    expect(gatedCandidate).toBeTruthy();
    const approved = await app.inject({
      method: "POST",
      url: `/api/sessions/${transferSessionId}/commands`,
      headers: authHeaders(login, true),
      payload: {
        bindingId: transferTeacher.bindingId,
        name: "approve_candidate_event",
        expectedStateVersion: teacherProjection.json().stateVersion,
        actionId: "action-api-transfer-teacher-gate",
        idempotencyKey: "idempotency-api-transfer-teacher-gate",
        sourceMode: "course_platform",
        surfaceId: "teacher-director",
        interactionId: gatedCandidate.candidateId,
        payload: { candidateId: gatedCandidate.candidateId },
      },
    });
    expect(approved.statusCode).toBe(200);
    const advanced = await app.inject({
      method: "GET",
      url: `/api/sessions/${transferSessionId}/projection?bindingId=${reporter.bindingId}`,
      headers: authHeaders(login),
    });
    expect(advanced.json().currentNode.nodeId).toBe("source");
    expect(advanced.json().structuredWorld).toMatchObject({
      scene: {
        sceneId: "transfer-scene-shelter",
      },
      eventCards: [{
        dynamicEventId: "transfer-event-rain-warning",
      }],
    });

    if (!prospectiveTransfer) {
      throw new Error("测试目录缺少非遗夜游前瞻迁移情境");
    }
    const prospectiveStarted = await app.inject({
      method: "POST",
      url: "/api/training-sessions",
      headers: authHeaders(login, true),
      payload: {
        authorizationSessionId: DEMO_SESSION_ID,
        bindingId: teacher.bindingId,
        requestId: "request-start-heritage-night-tour-transfer",
        classroomId: "classroom-local-tourism-a",
        teamId: "team-local-tourism-a",
        releaseId: prospectiveTransfer.ref.releaseId,
      },
    });
    expect(prospectiveStarted.statusCode, prospectiveStarted.body).toBe(200);
    const prospectiveEditor = (
      prospectiveStarted.json().bindings as RoleBinding[]
    ).find((binding) => binding.actorId === "student-editor");
    if (!prospectiveEditor) {
      throw new Error("非遗夜游情境缺少学生编辑岗位绑定");
    }
    const prospectiveProjection = await app.inject({
      method: "GET",
      url:
        `/api/sessions/${prospectiveStarted.json().sessionId}/projection`
        + `?bindingId=${prospectiveEditor.bindingId}`,
      headers: authHeaders(login),
    });
    expect(prospectiveProjection.statusCode).toBe(200);
    expect(prospectiveProjection.json().scenario).toMatchObject({
      scenarioId: "scenario-heritage-night-tour-capacity-v1",
      version: "1.0.0",
      releaseId: prospectiveTransfer.ref.releaseId,
    });
    expect(prospectiveProjection.json().nodes).toHaveLength(3);
    expect(prospectiveProjection.json().experienceGuide).toMatchObject({
      kind: "micro_transfer",
      currentNodeMapping: {
        nodeId: "brief",
      },
    });
    await app.close();
  });
});
