import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import type { DemoAuthContext } from "../src/identity.js";
import {
  buildSessionExperienceDescriptor,
  InMemorySessionExperienceDescriptorStore,
} from "../src/session-experience-descriptor.js";
import {
  createApp,
  DEMO_SESSION_ID,
  DEMO_AI_COPYRIGHT_SESSION_ID,
  DEMO_RAIN_EMERGENCY_SESSION_ID,
  DEMO_VILLAGE_SUPER_SESSION_ID,
  DEMO_XUNPU_SESSION_ID,
} from "../src/server.js";

const localOrigin = "http://localhost:5173";
let app: FastifyInstance | null = null;
let dataDir: string | null = null;

afterEach(async () => {
  await app?.close();
  app = null;
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
  dataDir = null;
});

describe("V2 default interactive demo", () => {
  it("keeps the learner empty until claim, then opens the real Xunpu activity", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "ronggang-v2-default-"));
    app = await createApp({
      dataDir,
      logger: false,
      initializeSecondaryDemo: false,
      awaitStartupRecovery: true,
      environment: {
        NODE_ENV: "test",
        IFLYTEK_MODE: "mock",
        DEEPSEEK_MODE: "mock",
      },
    });
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/demo-session",
      headers: { origin: localOrigin },
      payload: { profileId: "student-unassigned" },
    });
    expect(login.statusCode).toBe(200);
    const auth = login.json() as DemoAuthContext;
    expect(auth.bindings).toEqual([]);
    const rawCookie = Array.isArray(login.headers["set-cookie"])
      ? login.headers["set-cookie"][0]
      : login.headers["set-cookie"];
    if (!rawCookie) throw new Error("V2 default login cookie missing");
    const cookie = rawCookie.split(";")[0]!;

    const empty = await app.inject({
      method: "GET",
      url: "/api/me/course-enrollments",
      headers: { cookie },
    });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({ enrollments: [] });

    const catalog = await app.inject({ method: "GET", url: "/api/courses" });
    expect(catalog.json().courses.map((candidate: { courseId: string }) => (
      candidate.courseId
    )).sort()).toEqual([
      "course-ai-tourism-copyright-governance",
      "course-scenic-rain-emergency-reporting",
      "course-village-super-multiplatform",
      "course-village-super-postpublication-context",
      "course-xunpu-intangible-media",
    ]);
    const course = catalog.json().courses.find((candidate: {
      courseId: string;
    }) => candidate.courseId === "course-xunpu-intangible-media");
    expect(course).toMatchObject({
      version: 3,
      releaseId: "release-course-xunpu-intangible-media-2.0.0-runtime.2",
    });
    const claim = await app.inject({
      method: "POST",
      url: "/api/course-enrollments",
      headers: {
        origin: localOrigin,
        cookie,
        "x-csrf-token": auth.csrfToken,
      },
      payload: { courseReleaseId: course.courseReleaseId },
    });
    expect(claim.statusCode).toBe(200);
    expect(claim.json().enrollment).toMatchObject({
      status: "in_progress",
      activeSessionId: DEMO_XUNPU_SESSION_ID,
      primaryRoleId: "reporter",
    });
    const bindingId = claim.json().enrollment.bindingId as string;

    const [descriptor, activity, context, episode, progress, portfolio] = await Promise.all([
      app.inject({
        method: "GET",
        url: `/api/sessions/${DEMO_XUNPU_SESSION_ID}/experience-descriptor?bindingId=${bindingId}`,
        headers: { cookie },
      }),
      app.inject({
        method: "GET",
        url: `/api/sessions/${DEMO_XUNPU_SESSION_ID}/learning-activity?bindingId=${bindingId}`,
        headers: { cookie },
      }),
      app.inject({
        method: "GET",
        url: `/api/sessions/${DEMO_XUNPU_SESSION_ID}/student-training-context?bindingId=${bindingId}`,
        headers: { cookie },
      }),
      app.inject({
        method: "GET",
        url: `/api/sessions/${DEMO_XUNPU_SESSION_ID}/collaboration-episode?bindingId=${bindingId}`,
        headers: { cookie },
      }),
      app.inject({
        method: "GET",
        url: "/api/me/course-progress",
        headers: { cookie },
      }),
      app.inject({
        method: "GET",
        url: "/api/me/portfolio",
        headers: { cookie },
      }),
    ]);
    expect(descriptor.statusCode).toBe(200);
    expect(descriptor.json()).toMatchObject({
      descriptor: {
        schemaVersion: "session-experience-descriptor/4.0.0",
        sessionId: DEMO_XUNPU_SESSION_ID,
        experienceGeneration: "flagship_v4",
        courseReleaseRef: {
          courseId: "course-xunpu-intangible-media",
        },
        compatibility: "current",
      },
    });
    expect(activity.statusCode).toBe(200);
    expect(activity.json().activity).toMatchObject({
      status: "active",
      sessionId: DEMO_XUNPU_SESSION_ID,
      currentTask: { chapterId: "xunpu-topic-brief" },
    });
    expect(context.statusCode).toBe(200);
    expect(context.json()).toMatchObject({
      schemaVersion: "student-training-context/2.0.0",
      sessionId: DEMO_XUNPU_SESSION_ID,
      bindingId,
      actor: { roleId: "reporter" },
      scene: { sceneId: "xunpu-scene-topic-desk" },
      currentAction: { actionRef: "xunpu-topic-compare-angles" },
    });
    expect(activity.json().activity.currentTask.sceneId).toBe(
      context.json().scene.sceneId,
    );
    expect(progress.statusCode).toBe(200);
    expect(progress.json().progress.items).toEqual([
      expect.objectContaining({
        currentChapterId: "xunpu-topic-brief",
        completedChapterIds: [],
        portfolioItemCount: 0,
        evidenceCount: 0,
        reviewStatus: "not_submitted",
      }),
    ]);
    expect(portfolio.statusCode).toBe(200);
    expect(portfolio.json().portfolio).toMatchObject({
      items: [],
      evidence: [],
    });
    const forgedContextQuery = await app.inject({
      method: "GET",
      url: `/api/sessions/${DEMO_XUNPU_SESSION_ID}/student-training-context?bindingId=${bindingId}&actorKind=student`,
      headers: { cookie },
    });
    expect(forgedContextQuery.statusCode).toBe(400);
    const forgedDescriptorQuery = await app.inject({
      method: "GET",
      url: `/api/sessions/${DEMO_XUNPU_SESSION_ID}/experience-descriptor?bindingId=${bindingId}&experienceGeneration=standard_v2`,
      headers: { cookie },
    });
    expect(forgedDescriptorQuery.statusCode).toBe(400);
    const wrongDescriptorBinding = await app.inject({
      method: "GET",
      url: `/api/sessions/${DEMO_XUNPU_SESSION_ID}/experience-descriptor?bindingId=binding-forged`,
      headers: { cookie },
    });
    expect(wrongDescriptorBinding.statusCode).toBe(403);
    expect(episode.statusCode).toBe(200);
    expect(episode.json()).toMatchObject({
      audience: "student",
      status: "suggestion_ready",
      suggestion: {
        allowedDecisions: ["accept", "request_evidence", "reject"],
      },
    });
    const serialized = JSON.stringify({
      activity: activity.json(),
      context: context.json(),
      episode: episode.json(),
    });
    expect(serialized).not.toContain("水乡非遗市集");
    expect(serialized).not.toContain("student-editor");
    for (const forbidden of [
      "toolPolicy",
      "tokenBudget",
      "memoryPolicy",
      "communicationPolicy",
      "privateScopes",
      "allowedIntents",
      "deniedActions",
      "prompt",
      "privateMemory",
      "provider",
      "trace",
    ]) {
      expect(serialized).not.toContain(`\"${forbidden}\"`);
    }

    const broadProjection = await app.inject({
      method: "GET",
      url: `/api/sessions/${DEMO_XUNPU_SESSION_ID}/projection?bindingId=${bindingId}`,
      headers: { cookie },
    });
    expect(broadProjection.statusCode).toBe(403);
    const broadTimeline = await app.inject({
      method: "GET",
      url: `/api/sessions/${DEMO_XUNPU_SESSION_ID}/timeline?bindingId=${bindingId}`,
      headers: { cookie },
    });
    expect(broadTimeline.statusCode).toBe(403);
    for (const [profileId, expectedStatus] of [
      ["teacher-class-a", 403],
      ["operator-demo", 200],
    ] as const) {
      const roleLogin = await app.inject({
        method: "POST",
        url: "/api/auth/demo-session",
        headers: { origin: localOrigin },
        payload: { profileId, sessionId: DEMO_XUNPU_SESSION_ID },
      });
      expect(roleLogin.statusCode).toBe(200);
      const roleAuth = roleLogin.json() as DemoAuthContext;
      const roleBinding = roleAuth.bindings.find((candidate) => (
        candidate.sessionId === DEMO_XUNPU_SESSION_ID
      ));
      const roleCookieHeader = Array.isArray(roleLogin.headers["set-cookie"])
        ? roleLogin.headers["set-cookie"][0]
        : roleLogin.headers["set-cookie"];
      if (!roleBinding || !roleCookieHeader) {
        throw new Error(`missing ${profileId} session authorization`);
      }
      const roleTimeline = await app.inject({
        method: "GET",
        url: `/api/sessions/${DEMO_XUNPU_SESSION_ID}/timeline?bindingId=${roleBinding.bindingId}`,
        headers: { cookie: roleCookieHeader.split(";")[0]! },
      });
      expect(roleTimeline.statusCode).toBe(expectedStatus);
    }
    const standardLogin = await app.inject({
      method: "POST",
      url: "/api/auth/demo-session",
      headers: { origin: localOrigin },
      payload: { profileId: "teacher-class-a", sessionId: DEMO_SESSION_ID },
    });
    expect(standardLogin.statusCode).toBe(200);
    const standardAuth = standardLogin.json() as DemoAuthContext;
    const standardBinding = standardAuth.bindings.find((candidate) => (
      candidate.actorKind === "teacher"
      && candidate.sessionId === DEMO_SESSION_ID
    ));
    const standardCookieHeader = Array.isArray(standardLogin.headers["set-cookie"])
      ? standardLogin.headers["set-cookie"][0]
      : standardLogin.headers["set-cookie"];
    if (!standardBinding || !standardCookieHeader) {
      throw new Error("标准运行时缺少教师授权");
    }
    const standardDescriptor = await app.inject({
      method: "GET",
      url: `/api/sessions/${DEMO_SESSION_ID}/experience-descriptor?bindingId=${standardBinding.bindingId}`,
      headers: { cookie: standardCookieHeader.split(";")[0]! },
    });
    expect(standardDescriptor.statusCode).toBe(200);
    expect(standardDescriptor.json().descriptor).toMatchObject({
      sessionId: DEMO_SESSION_ID,
      experienceGeneration: "standard_v2",
      compatibility: "current",
    });
    let villageBindingId: string | null = null;
    for (const [courseId, activeSessionId] of [
      ["course-ai-tourism-copyright-governance", DEMO_AI_COPYRIGHT_SESSION_ID],
      ["course-scenic-rain-emergency-reporting", DEMO_RAIN_EMERGENCY_SESSION_ID],
      ["course-village-super-multiplatform", DEMO_VILLAGE_SUPER_SESSION_ID],
    ] as const) {
      const summary = catalog.json().courses.find((candidate: {
        courseId: string;
        courseReleaseId: string;
      }) => candidate.courseId === courseId);
      const currentStudy=(await app.inject({method:'GET',url:'/api/v3/me/study',headers:{cookie}})).json();
      if(currentStudy.currentSessionId){const cancelled=await app.inject({method:'POST',url:'/api/v3/me/study/cancel',headers:{origin:localOrigin,cookie,'x-csrf-token':auth.csrfToken},
        payload:{requestId:`cancel-before-${courseId}`,sessionId:currentStudy.currentSessionId,expectedRevision:currentStudy.revision,confirmation:'abandon'}});expect(cancelled.statusCode,cancelled.body).toBe(200);}
      const migrationClaim = await app.inject({
        method: "POST",
        url: "/api/course-enrollments",
        headers: {
          origin: localOrigin,
          cookie,
          "x-csrf-token": auth.csrfToken,
        },
        payload: { courseReleaseId: summary.courseReleaseId },
      });
      expect(migrationClaim.statusCode).toBe(200);
      expect(migrationClaim.json().enrollment).toMatchObject({
        status: "in_progress",
        activeSessionId,
        primaryRoleId: "reporter",
      });
      if (courseId === "course-village-super-multiplatform") {
        villageBindingId = migrationClaim.json().enrollment.bindingId as string;
      }
    }
    if (!villageBindingId) throw new Error("village reporter binding missing");

    const readVillage = async () => {
      const [trainingContext, collaborationEpisode] = await Promise.all([
        app!.inject({
          method: "GET",
          url: `/api/sessions/${DEMO_VILLAGE_SUPER_SESSION_ID}/student-training-context?bindingId=${villageBindingId}`,
          headers: { cookie },
        }),
        app!.inject({
          method: "GET",
          url: `/api/sessions/${DEMO_VILLAGE_SUPER_SESSION_ID}/collaboration-episode?bindingId=${villageBindingId}`,
          headers: { cookie },
        }),
      ]);
      expect(trainingContext.statusCode).toBe(200);
      expect(collaborationEpisode.statusCode).toBe(200);
      return {
        context: trainingContext.json(),
        episode: collaborationEpisode.json(),
      };
    };
    const submitVillageAction = async (snapshot: {
      stateVersion: number;
      currentAction: { actionRef: string };
    }) => app!.inject({
      method: "POST",
      url: `/api/sessions/${DEMO_VILLAGE_SUPER_SESSION_ID}/commands`,
      headers: {
        origin: localOrigin,
        cookie,
        "x-csrf-token": auth.csrfToken,
      },
      payload: {
        bindingId: villageBindingId,
        name: "record_experience_choice",
        expectedStateVersion: snapshot.stateVersion,
        sourceMode: "world_interaction",
        surfaceId: "student-v2-training",
        interactionId: snapshot.currentAction.actionRef,
        payload: { choiceRef: snapshot.currentAction.actionRef },
      },
    });

    const villageInitial = await readVillage();
    expect(villageInitial.context.currentAction).toMatchObject({
      actionRef: "village-super-platform-map-action-map",
    });
    expect(villageInitial.episode).toMatchObject({
      audience: "student",
      status: "waiting",
      suggestion: null,
    });
    expect((await submitVillageAction(villageInitial.context)).statusCode).toBe(200);

    const villageAfterFirst = await readVillage();
    expect(villageAfterFirst.context.currentAction).toMatchObject({
      actionRef: "village-super-platform-map-action-verify",
    });
    expect(villageAfterFirst.episode).toMatchObject({
      status: "waiting",
      suggestion: null,
    });
    expect((await submitVillageAction(villageAfterFirst.context)).statusCode).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 1_700));
    let villageAdviceReady = await readVillage();
    expect(villageAdviceReady.context.currentAction).toBeNull();
    expect(villageAdviceReady.episode).toMatchObject({
      status: "suggestion_ready",
      suggestion: {
        allowedDecisions: ["accept", "request_evidence", "reject"],
      },
    });
    let villageAdviceAccepted = false;
    for (let attempt = 0; attempt < 3 && !villageAdviceAccepted; attempt += 1) {
      const villageSuggestionId = villageAdviceReady.episode.suggestion
        .suggestionId as string;
      const villageAdvice = await app.inject({
        method: "POST",
        url: `/api/sessions/${DEMO_VILLAGE_SUPER_SESSION_ID}/commands`,
        headers: {
          origin: localOrigin,
          cookie,
          "x-csrf-token": auth.csrfToken,
        },
        payload: {
          bindingId: villageBindingId,
          name: "record_experience_choice",
          expectedStateVersion: villageAdviceReady.episode.stateVersion,
          sourceMode: "course_platform",
          surfaceId: "student-v2-current-advice",
          interactionId: villageSuggestionId,
          payload: { suggestionId: villageSuggestionId, decision: "accept" },
        },
      });
      expect([200, 409]).toContain(villageAdvice.statusCode);
      villageAdviceAccepted = villageAdvice.statusCode === 200;
      if (!villageAdviceAccepted) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        villageAdviceReady = await readVillage();
      }
    }
    expect(villageAdviceAccepted).toBe(true);
    const villageCompletionReady = await readVillage();
    expect(villageCompletionReady.context.currentAction).toMatchObject({
      actionRef: "village-super-platform-map-action-freeze",
    });

    await app.close();
    app = await createApp({
      dataDir,
      logger: false,
      initializeSecondaryDemo: false,
      awaitStartupRecovery: true,
      environment: {
        NODE_ENV: "test",
        IFLYTEK_MODE: "mock",
        DEEPSEEK_MODE: "mock",
      },
    });
    const restoredLogin = await app.inject({
      method: "POST",
      url: "/api/auth/demo-session",
      headers: { origin: localOrigin },
      payload: { profileId: "student-unassigned", sessionId: DEMO_XUNPU_SESSION_ID },
    });
    expect(restoredLogin.statusCode).toBe(200);
    const restoredAuth = restoredLogin.json() as DemoAuthContext;
    const restoredCookieHeader = Array.isArray(restoredLogin.headers["set-cookie"])
      ? restoredLogin.headers["set-cookie"][0]
      : restoredLogin.headers["set-cookie"];
    if (!restoredCookieHeader) throw new Error("restored login cookie missing");
    const restoredCookie = restoredCookieHeader.split(";")[0]!;
    const restoredEnrollments = await app.inject({
      method: "GET",
      url: "/api/me/course-enrollments",
      headers: { cookie: restoredCookie },
    });
    expect(restoredEnrollments.statusCode).toBe(200);
    expect(restoredEnrollments.json().enrollments).toHaveLength(4);
    const restoredBinding = restoredAuth.bindings.find((candidate) => (
      candidate.sessionId === DEMO_XUNPU_SESSION_ID
      && candidate.roleId === "reporter"
    ));
    if (!restoredBinding) throw new Error("restored reporter binding missing");
    const restoredTimeline = await app.inject({
      method: "GET",
      url: `/api/sessions/${DEMO_XUNPU_SESSION_ID}/timeline?bindingId=${restoredBinding.bindingId}`,
      headers: { cookie: restoredCookie },
    });
    expect(restoredTimeline.statusCode).toBe(403);
  }, 90_000);

  it("fails startup when a persisted session descriptor drifts from its runtime", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "ronggang-v2-descriptor-drift-"));
    const descriptors = new InMemorySessionExperienceDescriptorStore();
    await descriptors.create(buildSessionExperienceDescriptor({
      sessionId: DEMO_SESSION_ID,
      courseReleaseRef: null,
      scenarioReleaseRef: {
        scenarioId: "scenario-forged-runtime",
        version: "9.9.9",
        contentHash: "f".repeat(64),
      },
      experienceGeneration: "standard_v2",
      compatibility: "historical",
      frozenAt: "2026-09-01T00:00:00.000Z",
    }));
    await expect(createApp({
      dataDir,
      logger: false,
      initializeSecondaryDemo: false,
      awaitStartupRecovery: true,
      sessionExperienceDescriptorStore: descriptors,
      environment: {
        NODE_ENV: "test",
        IFLYTEK_MODE: "mock",
        DEEPSEEK_MODE: "mock",
      },
    })).rejects.toMatchObject({ code: "version_hash_drift" });
  }, 45_000);

  it("lets only the bound teacher resolve the server-selected chapter gate", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "ronggang-v2-gate-"));
    app = await createApp({
      dataDir,
      logger: false,
      initializeSecondaryDemo: false,
      awaitStartupRecovery: true,
      environment: {
        NODE_ENV: "test",
        IFLYTEK_MODE: "mock",
        DEEPSEEK_MODE: "mock",
      },
    });
    const loginAs = async (profileId: string, sessionId?: string) => {
      const response = await app!.inject({
        method: "POST",
        url: "/api/auth/demo-session",
        headers: { origin: localOrigin },
        payload: { profileId, ...(sessionId ? { sessionId } : {}) },
      });
      expect(response.statusCode).toBe(200);
      const context = response.json() as DemoAuthContext;
      const rawCookie = Array.isArray(response.headers["set-cookie"])
        ? response.headers["set-cookie"][0]
        : response.headers["set-cookie"];
      if (!rawCookie) throw new Error("V2 gate login cookie missing");
      return {
        auth: context,
        cookie: rawCookie.split(";")[0]!,
      };
    };
    const learner = await loginAs("student-unassigned");
    const catalog = await app.inject({ method: "GET", url: "/api/courses" });
    const course = catalog.json().courses.find((candidate: {
      courseId: string;
    }) => candidate.courseId === "course-xunpu-intangible-media");
    const claim = await app.inject({
      method: "POST",
      url: "/api/course-enrollments",
      headers: {
        origin: localOrigin,
        cookie: learner.cookie,
        "x-csrf-token": learner.auth.csrfToken,
      },
      payload: { courseReleaseId: course.courseReleaseId },
    });
    expect(claim.statusCode).toBe(200);
    const reporterBindingId = claim.json().enrollment.bindingId as string;
    const completeCurrentActions = async (stepCount: number) => {
      for (let step = 0; step < stepCount; step += 1) {
        let submitted = false;
        for (let attempt = 0; attempt < 12 && !submitted; attempt += 1) {
          const context = await app!.inject({
            method: "GET",
            url: `/api/sessions/${DEMO_XUNPU_SESSION_ID}/student-training-context?bindingId=${reporterBindingId}`,
            headers: { cookie: learner.cookie },
          });
          expect(context.statusCode).toBe(200);
          const actionRef = context.json().currentAction?.actionRef as string | undefined;
          if (!actionRef) {
            await new Promise((resolve) => setTimeout(resolve, 50));
            continue;
          }
          const action = await app!.inject({
            method: "POST",
            url: `/api/sessions/${DEMO_XUNPU_SESSION_ID}/commands`,
            headers: {
              origin: localOrigin,
              cookie: learner.cookie,
              "x-csrf-token": learner.auth.csrfToken,
            },
            payload: {
              bindingId: reporterBindingId,
              name: "record_experience_choice",
              expectedStateVersion: context.json().stateVersion,
              sourceMode: "world_interaction",
              surfaceId: "student-v2-training",
              interactionId: actionRef,
              payload: { choiceRef: actionRef },
            },
          });
          if (action.statusCode === 409) {
            await new Promise((resolve) => setTimeout(resolve, 50));
            continue;
          }
          expect(action.statusCode).toBe(200);
          submitted = true;
        }
        expect(submitted).toBe(true);
      }
    };
    const episode = await app.inject({
      method: "GET",
      url: `/api/sessions/${DEMO_XUNPU_SESSION_ID}/collaboration-episode?bindingId=${reporterBindingId}`,
      headers: { cookie: learner.cookie },
    });
    expect(episode.statusCode).toBe(200);
    expect(episode.json()).toMatchObject({
      audience: "student",
      status: "suggestion_ready",
      suggestion: {
        allowedDecisions: ["accept", "request_evidence", "reject"],
      },
    });
    const suggestionId = episode.json().suggestion.suggestionId as string;
    const advice = await app.inject({
      method: "POST",
      url: `/api/sessions/${DEMO_XUNPU_SESSION_ID}/commands`,
      headers: {
        origin: localOrigin,
        cookie: learner.cookie,
        "x-csrf-token": learner.auth.csrfToken,
      },
      payload: {
        bindingId: reporterBindingId,
        name: "record_experience_choice",
        expectedStateVersion: episode.json().stateVersion,
        sourceMode: "course_platform",
        surfaceId: "student-v2-current-advice",
        interactionId: suggestionId,
        payload: { suggestionId, decision: "request_evidence" },
      },
    });
    expect(advice.statusCode).toBe(200);
    await completeCurrentActions(3);

    const teacher = await loginAs("teacher-class-a", DEMO_XUNPU_SESSION_ID);
    const teacherBinding = teacher.auth.bindings.find((binding) => (
      binding.sessionId === DEMO_XUNPU_SESSION_ID
      && binding.actorKind === "teacher"
    ));
    if (!teacherBinding) throw new Error("V2 teacher binding missing");
    const pending = await app.inject({
      method: "GET",
      url: `/api/sessions/${DEMO_XUNPU_SESSION_ID}/collaboration-episode?bindingId=${teacherBinding.bindingId}`,
      headers: { cookie: teacher.cookie },
    });
    expect(pending.statusCode).toBe(200);
    expect(pending.json()).toMatchObject({
      audience: "teacher",
      status: "awaiting_gate",
      studentDecision: { decision: "request_evidence" },
      teacherGate: { gateId: "gate-xunpu-topic", status: "pending" },
    });

    const forgedCandidate = await app.inject({
      method: "POST",
      url: `/api/sessions/${DEMO_XUNPU_SESSION_ID}/teacher-gates/gate-xunpu-topic/decisions`,
      headers: {
        origin: localOrigin,
        cookie: teacher.cookie,
        "x-csrf-token": teacher.auth.csrfToken,
      },
      payload: {
        bindingId: teacherBinding.bindingId,
        expectedStateVersion: pending.json().stateVersion,
        decision: "approve",
        reason: "证据完整，可以推进。",
        candidateId: "candidate-browser-forged",
      },
    });
    expect(forgedCandidate.statusCode).toBe(400);
    const forgedQuery = await app.inject({
      method: "POST",
      url: `/api/sessions/${DEMO_XUNPU_SESSION_ID}/teacher-gates/gate-xunpu-topic/decisions?candidateId=candidate-browser-forged`,
      headers: {
        origin: localOrigin,
        cookie: teacher.cookie,
        "x-csrf-token": teacher.auth.csrfToken,
      },
      payload: {
        bindingId: teacherBinding.bindingId,
        expectedStateVersion: pending.json().stateVersion,
        decision: "approve",
        reason: "客户端查询参数不得选择候选。",
      },
    });
    expect(forgedQuery.statusCode).toBe(400);
    const missingCsrf = await app.inject({
      method: "POST",
      url: `/api/sessions/${DEMO_XUNPU_SESSION_ID}/teacher-gates/gate-xunpu-topic/decisions`,
      headers: {
        origin: localOrigin,
        cookie: teacher.cookie,
      },
      payload: {
        bindingId: teacherBinding.bindingId,
        expectedStateVersion: pending.json().stateVersion,
        decision: "approve",
        reason: "缺少 CSRF 不得审批。",
      },
    });
    expect(missingCsrf.statusCode).toBe(403);
    const learnerDenied = await app.inject({
      method: "POST",
      url: `/api/sessions/${DEMO_XUNPU_SESSION_ID}/teacher-gates/gate-xunpu-topic/decisions`,
      headers: {
        origin: localOrigin,
        cookie: learner.cookie,
        "x-csrf-token": learner.auth.csrfToken,
      },
      payload: {
        bindingId: reporterBindingId,
        expectedStateVersion: pending.json().stateVersion,
        decision: "approve",
        reason: "学生不得审批。",
      },
    });
    expect(learnerDenied.statusCode).toBe(403);
    const stale = await app.inject({
      method: "POST",
      url: `/api/sessions/${DEMO_XUNPU_SESSION_ID}/teacher-gates/gate-xunpu-topic/decisions`,
      headers: {
        origin: localOrigin,
        cookie: teacher.cookie,
        "x-csrf-token": teacher.auth.csrfToken,
      },
      payload: {
        bindingId: teacherBinding.bindingId,
        expectedStateVersion: pending.json().stateVersion - 1,
        decision: "approve",
        reason: "陈旧状态不得审批。",
      },
    });
    expect(stale.statusCode).toBe(409);
    // Re-read after the negative requests: background chapter evaluation may
    // legitimately advance the state while the permission checks are running.
    const currentPending = await app.inject({
      method: "GET",
      url: `/api/sessions/${DEMO_XUNPU_SESSION_ID}/collaboration-episode?bindingId=${teacherBinding.bindingId}`,
      headers: { cookie: teacher.cookie },
    });
    expect(currentPending.statusCode).toBe(200);
    expect(currentPending.json()).toMatchObject({
      status: "awaiting_gate",
      teacherGate: { gateId: "gate-xunpu-topic", status: "pending" },
    });
    const approved = await app.inject({
      method: "POST",
      url: `/api/sessions/${DEMO_XUNPU_SESSION_ID}/teacher-gates/gate-xunpu-topic/decisions`,
      headers: {
        origin: localOrigin,
        cookie: teacher.cookie,
        "x-csrf-token": teacher.auth.csrfToken,
      },
      payload: {
        bindingId: teacherBinding.bindingId,
        expectedStateVersion: currentPending.json().stateVersion,
        decision: "approve",
        reason: "证据引用与选题边界完整，可以推进。",
      },
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toEqual({
      schemaVersion: "teacher-gate-mutation-receipt/2.0.0",
      accepted: true,
      sessionId: DEMO_XUNPU_SESSION_ID,
      stateVersion: expect.any(Number),
      gateId: "gate-xunpu-topic",
      decision: "approve",
    });
    expect(approved.json()).not.toHaveProperty("candidateId");
    expect(approved.json()).not.toHaveProperty("role");
    const advanced = await app.inject({
      method: "GET",
      url: `/api/sessions/${DEMO_XUNPU_SESSION_ID}/student-training-context?bindingId=${reporterBindingId}`,
      headers: { cookie: learner.cookie },
    });
    expect(advanced.statusCode).toBe(200);
    expect(advanced.json()).toMatchObject({
      scene: { sceneId: "xunpu-scene-source-lab" },
      currentAction: { actionRef: "xunpu-source-check-version" },
    });

    const sourceEpisode = await app.inject({
      method: "GET",
      url: `/api/sessions/${DEMO_XUNPU_SESSION_ID}/collaboration-episode?bindingId=${reporterBindingId}`,
      headers: { cookie: learner.cookie },
    });
    expect(sourceEpisode.json()).toMatchObject({
      audience: "student",
      status: "suggestion_ready",
    });
    const sourceSuggestionId = sourceEpisode.json().suggestion.suggestionId as string;
    const sourceAdvice = await app.inject({
      method: "POST",
      url: `/api/sessions/${DEMO_XUNPU_SESSION_ID}/commands`,
      headers: {
        origin: localOrigin,
        cookie: learner.cookie,
        "x-csrf-token": learner.auth.csrfToken,
      },
      payload: {
        bindingId: reporterBindingId,
        name: "record_experience_choice",
        expectedStateVersion: sourceEpisode.json().stateVersion,
        sourceMode: "course_platform",
        surfaceId: "student-v2-current-advice",
        interactionId: sourceSuggestionId,
        payload: {
          suggestionId: sourceSuggestionId,
          decision: "request_evidence",
        },
      },
    });
    expect(sourceAdvice.statusCode).toBe(200);
    const [midProgress, midPortfolio] = await Promise.all([
      app.inject({
        method: "GET",
        url: "/api/me/course-progress",
        headers: { cookie: learner.cookie },
      }),
      app.inject({
        method: "GET",
        url: "/api/me/portfolio",
        headers: { cookie: learner.cookie },
      }),
    ]);
    expect(midProgress.statusCode).toBe(200);
    expect(midPortfolio.statusCode).toBe(200);
    const midItems = midPortfolio.json().portfolio.items as Array<{
      evidenceIds: string[];
    }>;
    const referencedEvidenceIds = new Set(
      midItems.flatMap((item) => item.evidenceIds),
    );
    expect((midPortfolio.json().portfolio.evidence as Array<{
      evidenceId: string;
    }>).every((item) => referencedEvidenceIds.has(item.evidenceId))).toBe(true);
    await completeCurrentActions(3);
    const sourcePending = await app.inject({
      method: "GET",
      url: `/api/sessions/${DEMO_XUNPU_SESSION_ID}/collaboration-episode?bindingId=${teacherBinding.bindingId}`,
      headers: { cookie: teacher.cookie },
    });
    expect(sourcePending.json()).toMatchObject({
      audience: "teacher",
      status: "awaiting_gate",
      teacherGate: {
        gateId: "gate-xunpu-source-map",
        status: "pending",
      },
    });
    let returned = sourcePending;
    let gateStateVersion = sourcePending.json().stateVersion as number;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      returned = await app.inject({
        method: "POST",
        url: `/api/sessions/${DEMO_XUNPU_SESSION_ID}/teacher-gates/gate-xunpu-source-map/decisions`,
        headers: {
          origin: localOrigin,
          cookie: teacher.cookie,
          "x-csrf-token": teacher.auth.csrfToken,
        },
        payload: {
          bindingId: teacherBinding.bindingId,
          expectedStateVersion: gateStateVersion,
          decision: "request_evidence",
          reason: "现行版本定位尚未补齐。",
        },
      });
      if (returned.statusCode !== 409) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
      const refreshed = await app.inject({
        method: "GET",
        url: `/api/sessions/${DEMO_XUNPU_SESSION_ID}/collaboration-episode?bindingId=${teacherBinding.bindingId}`,
        headers: { cookie: teacher.cookie },
      });
      expect(refreshed.json()).toMatchObject({
        audience: "teacher",
        status: "awaiting_gate",
        teacherGate: { status: "pending" },
      });
      gateStateVersion = refreshed.json().stateVersion as number;
    }
    expect(returned.statusCode).toBe(200);
    expect(returned.json()).toMatchObject({
      schemaVersion: "teacher-gate-mutation-receipt/2.0.0",
      gateId: "gate-xunpu-source-map",
      decision: "request_evidence",
    });
    const returnedEpisode = await app.inject({
      method: "GET",
      url: `/api/sessions/${DEMO_XUNPU_SESSION_ID}/collaboration-episode?bindingId=${teacherBinding.bindingId}`,
      headers: { cookie: teacher.cookie },
    });
    expect(returnedEpisode.json()).toMatchObject({
      audience: "teacher",
      status: "failed",
      teacherGate: {
        gateId: "gate-xunpu-source-map",
        status: "rejected",
      },
      authorityWriteback: null,
    });
    expect(returnedEpisode.json().teacherGate.summary).toContain("退回补证");
    const studentReturnedEpisode = await app.inject({
      method: "GET",
      url: `/api/sessions/${DEMO_XUNPU_SESSION_ID}/collaboration-episode?bindingId=${reporterBindingId}`,
      headers: { cookie: learner.cookie },
    });
    expect(studentReturnedEpisode.json()).toMatchObject({
      audience: "student",
      status: "completed",
      teacherGate: { status: "rejected" },
      authorityWriteback: {
        occurred: false,
        worldEventIds: [],
        taskIds: [],
        evidenceIds: [],
      },
    });
    expect(studentReturnedEpisode.body).not.toContain("candidateId");
    expect(studentReturnedEpisode.body).not.toContain("sourceChoiceRef");
    expect(studentReturnedEpisode.body).not.toContain("technicalTrace");
    expect(studentReturnedEpisode.body).not.toContain("provider");
    const stayed = await app.inject({
      method: "GET",
      url: `/api/sessions/${DEMO_XUNPU_SESSION_ID}/student-training-context?bindingId=${reporterBindingId}`,
      headers: { cookie: learner.cookie },
    });
    expect(stayed.json()).toMatchObject({
      scene: { sceneId: "xunpu-scene-source-lab" },
      currentAction: null,
    });
  }, 60_000);
});
