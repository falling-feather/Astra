import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import {
  courseContentKnowledgeRecordCount,
  courseContentReleases,
  courseContentSectionCount,
} from "@ronggang/course-content";
import type { DemoAuthContext } from "../src/identity.js";
import {
  aiCopyrightRuntimeSectionMappings,
  rainEmergencyRuntimeSectionMappings,
  villageSuperRuntimeSectionMappings,
  type MigrationRuntimeSectionMapping,
} from "@ronggang/world-core";
import {
  createApp,
  DEMO_AI_COPYRIGHT_SESSION_ID,
  DEMO_RAIN_EMERGENCY_SESSION_ID,
  DEMO_VILLAGE_SUPER_SESSION_ID,
} from "../src/server.js";

const localOrigin = "http://localhost:5173";
const fullMigrationJourneyTimeoutMs = 900_000;
let app: FastifyInstance | null = null;
let dataDir: string | null = null;

afterEach(async () => {
  await app?.close();
  app = null;
  if (dataDir && process.env.QA_PRESERVE_TEMP !== "1") {
    await rm(dataDir, { recursive: true, force: true });
  }
  if (dataDir && process.env.QA_PRESERVE_TEMP === "1") {
    console.info(`[QA-006] preserved dataDir=${dataDir}`);
  }
  dataDir = null;
});

interface LoginContext {
  auth: DemoAuthContext;
  cookie: string;
}

interface StudentContextDto {
  sessionId: string;
  bindingId: string;
  stateVersion: number;
  scene: { sceneId: string };
  currentAction: { actionRef: string } | null;
}

interface StudentEpisodeDto {
  audience: "student";
  status: string;
  stateVersion: number;
  suggestion: null | {
    suggestionId: string;
    allowedDecisions: ["accept", "request_evidence", "reject"];
  };
  studentDecision: null | { decision: "accept" | "request_evidence" | "reject" };
  teacherGate: unknown;
}

interface TeacherEpisodeDto {
  audience: "teacher";
  status: string;
  stateVersion: number;
  teacherGate: null | { gateId: string; status: string };
}

interface RuntimeCase {
  courseId: string;
  sessionId: string;
  mappings: readonly MigrationRuntimeSectionMapping[];
}

const runtimeCases: readonly RuntimeCase[] = [
  {
    courseId: "course-village-super-multiplatform",
    sessionId: DEMO_VILLAGE_SUPER_SESSION_ID,
    mappings: villageSuperRuntimeSectionMappings,
  },
  {
    courseId: "course-ai-tourism-copyright-governance",
    sessionId: DEMO_AI_COPYRIGHT_SESSION_ID,
    mappings: aiCopyrightRuntimeSectionMappings,
  },
  {
    courseId: "course-scenic-rain-emergency-reporting",
    sessionId: DEMO_RAIN_EMERGENCY_SESSION_ID,
    mappings: rainEmergencyRuntimeSectionMappings,
  },
];

const forbiddenOrdinaryFields = [
  "candidateId",
  "sourceChoiceRef",
  "technicalTrace",
  "traceRefs",
  "providerId",
  "providerRequestId",
  "prompt",
  "privateMemory",
  "tokenBudget",
  "conditionKey",
] as const;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function eventually<T>(
  read: () => Promise<T>,
  predicate: (value: T) => boolean,
  label: string,
  attempts = 120,
): Promise<T> {
  let latest: T | undefined;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    latest = await read();
    if (predicate(latest)) return latest;
    await delay(50);
  }
  throw new Error(`QA-006 timed out waiting for ${label}: ${JSON.stringify(latest)}`);
}

async function createDefaultApp(): Promise<FastifyInstance> {
  dataDir = await mkdtemp(join(tmpdir(), "ronggang-qa-v2-cycle-"));
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
  return app;
}

async function loginAs(
  target: FastifyInstance,
  profileId: string,
  sessionId?: string,
): Promise<LoginContext> {
  const response = await target.inject({
    method: "POST",
    url: "/api/auth/demo-session",
    headers: { origin: localOrigin },
    payload: { profileId, ...(sessionId ? { sessionId } : {}) },
  });
  expect(response.statusCode).toBe(200);
  const rawCookie = Array.isArray(response.headers["set-cookie"])
    ? response.headers["set-cookie"][0]
    : response.headers["set-cookie"];
  if (!rawCookie) throw new Error(`QA-006 ${profileId} login cookie missing`);
  return {
    auth: response.json() as DemoAuthContext,
    cookie: rawCookie.split(";")[0]!,
  };
}

function sessionBinding(
  login: LoginContext,
  sessionId: string,
  actorKind: "student" | "teacher",
): string {
  const binding = login.auth.bindings.find((candidate) => (
    candidate.sessionId === sessionId && candidate.actorKind === actorKind
  ));
  if (!binding) throw new Error(`QA-006 ${actorKind} binding missing for ${sessionId}`);
  return binding.bindingId;
}

describe("QA-006 second-cycle quality gates", () => {
  it("freezes five courses, 30 chapters, 70 review-pending sources and honest admin evidence", async () => {
    const target = await createDefaultApp();
    const catalog = await target.inject({ method: "GET", url: "/api/courses" });
    expect(catalog.statusCode).toBe(200);
    const summaries = catalog.json().courses as Array<{
      courseId: string;
      chapterCount: number;
      courseReleaseId: string;
    }>;
    expect(summaries.map(({ courseId, chapterCount }) => ({ courseId, chapterCount })))
      .toEqual([
        { courseId: "course-ai-tourism-copyright-governance", chapterCount: 6 },
        { courseId: "course-scenic-rain-emergency-reporting", chapterCount: 6 },
        { courseId: "course-village-super-multiplatform", chapterCount: 6 },
        { courseId: "course-village-super-postpublication-context", chapterCount: 5 },
        { courseId: "course-xunpu-intangible-media", chapterCount: 7 },
      ]);
    expect(courseContentReleases).toHaveLength(5);
    expect(courseContentSectionCount).toBe(30);
    expect(courseContentKnowledgeRecordCount).toBe(70);

    const details = await Promise.all(summaries.map(async ({ courseId }) => {
      const response = await target.inject({
        method: "GET",
        url: `/api/courses/${courseId}`,
      });
      expect(response.statusCode).toBe(200);
      return response.json().course as {
        courseId: string;
        sources: Array<{
          url: string;
          locator: string;
          reviewStatus: string;
          excerpt: string | null;
        }>;
        chapters: Array<{ chapterId: string }>;
      };
    }));
    expect(details.flatMap((detail) => detail.chapters)).toHaveLength(30);
    expect(details.flatMap((detail) => detail.sources)).toHaveLength(70);
    for (const source of details.flatMap((detail) => detail.sources)) {
      expect(source.url).toMatch(/^https:\/\//u);
      expect(source.locator.trim().length).toBeGreaterThan(0);
      expect(source.reviewStatus).toBe("pending_expert_review");
      expect(source.excerpt).toBeNull();
    }

    const learner = await loginAs(target, "student-unassigned");
    const teacher = await loginAs(
      target,
      "teacher-class-a",
      DEMO_VILLAGE_SUPER_SESSION_ID,
    );
    const operator = await loginAs(
      target,
      "operator-demo",
      DEMO_VILLAGE_SUPER_SESSION_ID,
    );
    for (const ordinary of [learner, teacher]) {
      for (const url of [
        "/api/admin/agent-rule-manifest",
        "/api/admin/agent-ablation-evidence",
      ]) {
        const denied = await target.inject({
          method: "GET",
          url,
          headers: { cookie: ordinary.cookie },
        });
        expect(denied.statusCode).toBe(403);
      }
    }

    const [manifestResponse, evidenceResponse, topologyResponse] = await Promise.all([
      target.inject({
        method: "GET",
        url: "/api/admin/agent-rule-manifest",
        headers: { cookie: operator.cookie },
      }),
      target.inject({
        method: "GET",
        url: "/api/admin/agent-ablation-evidence",
        headers: { cookie: operator.cookie },
      }),
      target.inject({
        method: "GET",
        url: "/api/admin/agent-topology",
        headers: { cookie: operator.cookie },
      }),
    ]);
    expect([manifestResponse.statusCode, evidenceResponse.statusCode, topologyResponse.statusCode])
      .toEqual([200, 200, 200]);
    const manifest = manifestResponse.json();
    const evidence = evidenceResponse.json();
    const topology = topologyResponse.json();
    expect(manifest.courses).toHaveLength(5);
    expect(manifest.courses.flatMap((course: { chapters: unknown[] }) => course.chapters))
      .toHaveLength(30);
    expect(manifest.baselineTopologyAgentIds).toHaveLength(14);
    const supportingIds = new Set<string>(manifest.courses.flatMap((course: {
      chapters: Array<{ agentResolutions: Array<{
        targetKind: string;
        sourceAgentId: string;
      }> }>;
    }) => course.chapters.flatMap((chapter) => chapter.agentResolutions
      .filter((resolution) => resolution.targetKind === "supporting_capability")
      .map((resolution) => resolution.sourceAgentId))));
    expect(supportingIds.size).toBe(5);
    expect([...supportingIds].some((id) => (
      manifest.baselineTopologyAgentIds.includes(id)
    ))).toBe(false);
    expect(topology.groups).toHaveLength(6);
    expect(topology.agents).toHaveLength(14);
    expect(evidence).toMatchObject({
      observationCount: 0,
      conclusion: "insufficient_evidence",
      blindReviewStatus: "not_configured",
      controls: { conditionLabelsHidden: false },
      groups: [
        { groupId: "group-1", conditionCode: "A", runCount: 0 },
        { groupId: "group-2", conditionCode: "B", runCount: 0 },
        { groupId: "group-3", conditionCode: "C", runCount: 0 },
      ],
    });
    expect(JSON.stringify({ manifest, evidence })).not.toMatch(
      /prompt|privateMemory|rawTrace|providerRequestId|conditionKey/u,
    );
  }, 90_000);

  it("runs all 18 migration chapters through HTTP, review and restart recovery", async () => {
    let target = await createDefaultApp();
    const learner = await loginAs(target, "student-unassigned");
    const catalog = await target.inject({ method: "GET", url: "/api/courses" });
    const summaries = catalog.json().courses as Array<{
      courseId: string;
      courseReleaseId: string;
    }>;
    const studentBindings = new Map<string, string>();
    const teacherLogins = new Map<string, LoginContext>();

    const claimRuntime=async(runtime:RuntimeCase)=>{
      const summary = summaries.find((candidate) => candidate.courseId === runtime.courseId);
      if (!summary) throw new Error(`QA-006 course missing: ${runtime.courseId}`);
      const claim = await target.inject({
        method: "POST",
        url: "/api/course-enrollments",
        headers: {
          origin: localOrigin,
          cookie: learner.cookie,
          "x-csrf-token": learner.auth.csrfToken,
        },
        payload: { courseReleaseId: summary.courseReleaseId },
      });
      expect(claim.statusCode,claim.body).toBe(200);
      expect(claim.json().enrollment).toMatchObject({
        status: "in_progress",
        activeSessionId: runtime.sessionId,
        primaryRoleId: "reporter",
      });
      studentBindings.set(runtime.sessionId, claim.json().enrollment.bindingId as string);
      teacherLogins.set(
        runtime.sessionId,
        await loginAs(target, "teacher-class-a", runtime.sessionId),
      );
    };

    const readStudent = async (runtime: RuntimeCase) => {
      const bindingId = studentBindings.get(runtime.sessionId)!;
      const [context, episode] = await Promise.all([
        target.inject({
          method: "GET",
          url: `/api/sessions/${runtime.sessionId}/student-training-context?bindingId=${bindingId}`,
          headers: { cookie: learner.cookie },
        }),
        target.inject({
          method: "GET",
          url: `/api/sessions/${runtime.sessionId}/collaboration-episode?bindingId=${bindingId}`,
          headers: { cookie: learner.cookie },
        }),
      ]);
      expect(context.statusCode).toBe(200);
      expect(episode.statusCode).toBe(200);
      const serialized = JSON.stringify({ context: context.json(), episode: episode.json() });
      for (const forbidden of forbiddenOrdinaryFields) {
        expect(serialized).not.toContain(`\"${forbidden}\"`);
      }
      return {
        context: context.json() as StudentContextDto,
        episode: episode.json() as StudentEpisodeDto,
      };
    };

    const readTeacher = async (runtime: RuntimeCase) => {
      const teacher = teacherLogins.get(runtime.sessionId)!;
      const bindingId = sessionBinding(teacher, runtime.sessionId, "teacher");
      const response = await target.inject({
        method: "GET",
        url: `/api/sessions/${runtime.sessionId}/collaboration-episode?bindingId=${bindingId}`,
        headers: { cookie: teacher.cookie },
      });
      expect(response.statusCode).toBe(200);
      const serialized = JSON.stringify(response.json());
      for (const forbidden of forbiddenOrdinaryFields) {
        expect(serialized).not.toContain(`\"${forbidden}\"`);
      }
      return response.json() as TeacherEpisodeDto;
    };

    const submitAction = async (runtime: RuntimeCase, actionRef: string) => {
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const snapshot = await eventually(
          () => readStudent(runtime),
          (value) => value.context.currentAction?.actionRef === actionRef,
          `${runtime.courseId}:${actionRef}`,
        );
        const response = await target.inject({
          method: "POST",
          url: `/api/sessions/${runtime.sessionId}/commands`,
          headers: {
            origin: localOrigin,
            cookie: learner.cookie,
            "x-csrf-token": learner.auth.csrfToken,
          },
          payload: {
            bindingId: studentBindings.get(runtime.sessionId),
            name: "record_experience_choice",
            expectedStateVersion: snapshot.context.stateVersion,
            sourceMode: "world_interaction",
            surfaceId: "student-v2-training",
            interactionId: actionRef,
            payload: { choiceRef: actionRef },
          },
        });
        expect([200, 409]).toContain(response.statusCode);
        if (response.statusCode === 200) {
          expect(response.json()).not.toHaveProperty("candidateId");
          return;
        }
        await delay(50);
      }
      throw new Error(`QA-006 action CAS did not settle: ${actionRef}`);
    };

    const submitAdvice = async (
      runtime: RuntimeCase,
      decision: "accept" | "request_evidence" | "reject",
    ) => {
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const snapshot = await eventually(
          () => readStudent(runtime),
          (value) => (
            value.context.currentAction === null
            && value.episode.status === "suggestion_ready"
            && value.episode.suggestion !== null
          ),
          `${runtime.courseId}:suggestion_ready`,
        );
        const suggestion = snapshot.episode.suggestion!;
        expect(suggestion.allowedDecisions).toEqual([
          "accept",
          "request_evidence",
          "reject",
        ]);
        const response = await target.inject({
          method: "POST",
          url: `/api/sessions/${runtime.sessionId}/commands`,
          headers: {
            origin: localOrigin,
            cookie: learner.cookie,
            "x-csrf-token": learner.auth.csrfToken,
          },
          payload: {
            bindingId: studentBindings.get(runtime.sessionId),
            name: "record_experience_choice",
            expectedStateVersion: snapshot.episode.stateVersion,
            sourceMode: "course_platform",
            surfaceId: "student-v2-current-advice",
            interactionId: suggestion.suggestionId,
            payload: { suggestionId: suggestion.suggestionId, decision },
          },
        });
        expect([200, 409]).toContain(response.statusCode);
        if (response.statusCode === 200) return;
        await delay(50);
      }
      throw new Error(`QA-006 advice CAS did not settle: ${runtime.courseId}`);
    };

    const approveGate = async (runtime: RuntimeCase, gateId: string) => {
      const teacher = teacherLogins.get(runtime.sessionId)!;
      const bindingId = sessionBinding(teacher, runtime.sessionId, "teacher");
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const pending = await eventually(
          () => readTeacher(runtime),
          (episode) => (
            episode.status === "awaiting_gate"
            && episode.teacherGate?.gateId === gateId
            && episode.teacherGate.status === "pending"
          ),
          `${runtime.courseId}:${gateId}`,
        );
        const response = await target.inject({
          method: "POST",
          url: `/api/sessions/${runtime.sessionId}/teacher-gates/${gateId}/decisions`,
          headers: {
            origin: localOrigin,
            cookie: teacher.cookie,
            "x-csrf-token": teacher.auth.csrfToken,
          },
          payload: {
            bindingId,
            expectedStateVersion: pending.stateVersion,
            decision: "approve",
            reason: "QA-006 verifies the frozen evidence set before authoritative progression.",
          },
        });
        expect([200, 409]).toContain(response.statusCode);
        if (response.statusCode === 200) {
          expect(response.json()).not.toHaveProperty("candidateId");
          return;
        }
        await delay(50);
      }
      throw new Error(`QA-006 teacher gate CAS did not settle: ${gateId}`);
    };

    let chapterOrdinal = 0;
    for (const runtime of runtimeCases) {
      await claimRuntime(runtime);
      expect(runtime.mappings).toHaveLength(6);
      for (const [index, mapping] of runtime.mappings.entries()) {
        const opening = await eventually(
          () => readStudent(runtime),
          (value) => value.context.currentAction?.actionRef === mapping.actionIds[0],
          `${mapping.sectionId}:opening`,
        );
        expect(opening.context.scene.sceneId).toBe(`scene-${mapping.sectionId}`);
        expect(opening.episode).toMatchObject({
          audience: "student",
          status: "waiting",
          suggestion: null,
          teacherGate: null,
        });

        await submitAction(runtime, mapping.actionIds[0]);
        const afterFirst = await eventually(
          () => readStudent(runtime),
          (value) => value.context.currentAction?.actionRef === mapping.actionIds[1],
          `${mapping.sectionId}:second-action`,
        );
        expect(afterFirst.context.scene.sceneId).toBe(`scene-${mapping.sectionId}`);
        expect((await readTeacher(runtime)).status).not.toBe("awaiting_gate");

        await submitAction(runtime, mapping.actionIds[1]);
        const adviceReady = await eventually(
          () => readStudent(runtime),
          (value) => value.episode.status === "suggestion_ready",
          `${mapping.sectionId}:advice`,
        );
        expect(adviceReady.context.scene.sceneId).toBe(`scene-${mapping.sectionId}`);
        expect(adviceReady.context.currentAction).toBeNull();
        expect((await readTeacher(runtime)).status).not.toBe("awaiting_gate");

        const decisions = ["accept", "request_evidence", "reject"] as const;
        const decision = decisions[chapterOrdinal % decisions.length]!;
        chapterOrdinal += 1;
        await submitAdvice(runtime, decision);
        const completionReady = await eventually(
          () => readStudent(runtime),
          (value) => value.context.currentAction?.actionRef === mapping.primaryActionId,
          `${mapping.sectionId}:completion-action`,
        );
        expect(completionReady.episode.studentDecision).toMatchObject({ decision });
        expect(completionReady.context.scene.sceneId).toBe(`scene-${mapping.sectionId}`);

        await submitAction(runtime, mapping.primaryActionId);
        const beforeApproval = await eventually(
          () => readStudent(runtime),
          (value) => value.context.currentAction === null,
          `${mapping.sectionId}:pending-gate`,
        );
        expect(beforeApproval.context.scene.sceneId).toBe(`scene-${mapping.sectionId}`);
        await approveGate(runtime, mapping.teacherGateId);

        if (index < runtime.mappings.length - 1) {
          const next = runtime.mappings[index + 1]!;
          const advanced = await eventually(
            () => readStudent(runtime),
            (value) => value.context.currentAction?.actionRef === next.actionIds[0],
            `${mapping.sectionId}:authoritative-advance`,
          );
          expect(advanced.context.scene.sceneId).toBe(`scene-${next.sectionId}`);
        }
      }
      const completedTeacher=await loginAs(target,'operator-demo',runtime.sessionId);
      await eventually(async()=>{
        const response=await target.inject({method:'GET',url:`/api/sessions/${runtime.sessionId}/projection?bindingId=${sessionBinding(completedTeacher,runtime.sessionId,'teacher')}`,headers:{cookie:completedTeacher.cookie}});
        expect(response.statusCode,response.body).toBe(200);return response.json();
      },value=>value.scenario.status==='completed',`${runtime.courseId}:completed-before-next-course`);
    }

    const operatorLogins = new Map<string, LoginContext>();
    for (const runtime of runtimeCases) {
      const operator = await loginAs(target, "operator-demo", runtime.sessionId);
      operatorLogins.set(runtime.sessionId, operator);
      const response = await target.inject({
        method: "GET",
        url: `/api/sessions/${runtime.sessionId}/projection?bindingId=${sessionBinding(operator, runtime.sessionId, "teacher")}`,
        headers: { cookie: operator.cookie },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        scenario: { status: "completed" },
        currentNode: {
          nodeId: runtime.mappings.at(-1)!.sectionId,
          status: "completed",
        },
      });
    }

    const progressResponse = await target.inject({
      method: "GET",
      url: "/api/me/course-progress",
      headers: { cookie: learner.cookie },
    });
    const portfolioResponse = await target.inject({
      method: "GET",
      url: "/api/me/portfolio",
      headers: { cookie: learner.cookie },
    });
    expect(progressResponse.statusCode).toBe(200);
    expect(portfolioResponse.statusCode).toBe(200);
    const progressItems = progressResponse.json().progress.items as Array<{
      enrollment: {
        courseReleaseRef: { courseId: string };
        bindingId: string;
        activeSessionId: string;
        stateVersion: number;
      };
      chapterCount: number;
      completedChapterIds: string[];
      currentChapterId: string | null;
      portfolioItemCount: number;
      evidenceCount: number;
    }>;
    const frozenReviews = new Map<string, unknown>();
    for (const runtime of runtimeCases) {
      const item = progressItems.find((candidate) => (
        candidate.enrollment.courseReleaseRef.courseId === runtime.courseId
      ));
      expect(item).toMatchObject({
        chapterCount: 6,
        currentChapterId: null,
      });
      expect(item!.completedChapterIds).toHaveLength(6);
      expect(item!.portfolioItemCount).toBeGreaterThan(0);
      expect(item!.evidenceCount).toBeGreaterThan(0);

      const requestId = `qa006-submit-${runtime.courseId}`;
      const submit = () => target.inject({
        method: "POST",
        url: `/api/sessions/${runtime.sessionId}/course-submissions`,
        headers: {
          origin: localOrigin,
          cookie: learner.cookie,
          "x-csrf-token": learner.auth.csrfToken,
        },
        payload: {
          bindingId: item!.enrollment.bindingId,
          expectedEnrollmentStateVersion: item!.enrollment.stateVersion,
          requestId,
        },
      });
      const firstReceipt = await submit();
      const retryReceipt = await submit();
      expect(firstReceipt.statusCode).toBe(200);
      expect(retryReceipt.statusCode).toBe(200);
      expect(retryReceipt.json()).toEqual(firstReceipt.json());

      const teacher = teacherLogins.get(runtime.sessionId)!;
      const teacherBindingId = sessionBinding(teacher, runtime.sessionId, "teacher");
      const tasks = await target.inject({
        method: "GET",
        url: `/api/sessions/${runtime.sessionId}/course-review-tasks?bindingId=${teacherBindingId}`,
        headers: { cookie: teacher.cookie },
      });
      expect(tasks.statusCode).toBe(200);
      const reviewTask = tasks.json().tasks.items.find((candidate: {
        enrollmentId: string;
      }) => candidate.enrollmentId === firstReceipt.json().receipt.enrollmentId);
      expect(reviewTask).toBeTruthy();
      const operator = operatorLogins.get(runtime.sessionId)!;
      const operatorBindingId = sessionBinding(
        operator,
        runtime.sessionId,
        "teacher",
      );
      const readWorldAudit = async () => {
        const [timeline, projection] = await Promise.all([
          target.inject({
            method: "GET",
            url: `/api/sessions/${runtime.sessionId}/timeline?bindingId=${operatorBindingId}`,
            headers: { cookie: operator.cookie },
          }),
          target.inject({
            method: "GET",
            url: `/api/sessions/${runtime.sessionId}/projection?bindingId=${operatorBindingId}`,
            headers: { cookie: operator.cookie },
          }),
        ]);
        expect(timeline.statusCode).toBe(200);
        expect(projection.statusCode).toBe(200);
        return {
          stateVersion: projection.json().stateVersion as number,
          currentNode: projection.json().currentNode as unknown,
          timelineEvents: (timeline.json().events as Array<{
            eventId: string;
            eventType: string;
          }>).map(({ eventId, eventType }) => ({ eventId, eventType })),
          recentEvents: (projection.json().recentEvents as Array<{
            eventId: string;
            eventType: string;
          }>).map(({ eventId, eventType }) => ({ eventId, eventType })),
        };
      };
      const readQuiescentWorldAudit = async () => {
        let previous = await readWorldAudit();
        let stableReads = 0;
        let latestCurrentPendingCount = -1;
        for (let attempt = 0; attempt < 120; attempt += 1) {
          const trace = await target.inject({
            method: "GET",
            url: `/api/sessions/${runtime.sessionId}/trace?bindingId=${operatorBindingId}`,
            headers: { cookie: operator.cookie },
          });
          expect(trace.statusCode).toBe(200);
          const authority = trace.json() as {
            stateVersion: number;
            summary: { pendingCount: number };
            records: Array<{
              kind: string;
              status: string;
            }>;
          };
          latestCurrentPendingCount = authority.records.filter((record) => (
            (record.kind === "outbox" && record.status === "pending")
            || (
              record.kind === "agent_task"
              && ["pending", "queued", "running"].includes(record.status)
            )
          )).length;
          await delay(250);
          const current = await readWorldAudit();
          if (
            latestCurrentPendingCount === 0
            && authority.stateVersion === current.stateVersion
            && current.stateVersion === previous.stateVersion
          ) {
            stableReads += 1;
            if (stableReads >= 3) return current;
          } else {
            stableReads = 0;
          }
          previous = current;
        }
        throw new Error(
          `QA-006 world did not quiesce before review: ${runtime.sessionId}`
          + ` currentPending=${latestCurrentPendingCount} state=${previous.stateVersion}`,
        );
      };
      const worldBeforeFinalize = await readQuiescentWorldAudit();
      const finalized = await target.inject({
        method: "POST",
        url: `/api/sessions/${runtime.sessionId}/course-reviews`,
        headers: {
          origin: localOrigin,
          cookie: teacher.cookie,
          "x-csrf-token": teacher.auth.csrfToken,
        },
        payload: {
          bindingId: teacherBindingId,
          reviewTaskId: reviewTask.reviewTaskId,
          expectedEnrollmentStateVersion: reviewTask.stateVersion,
          requestId: `qa006-review-${runtime.courseId}`,
        },
      });
      expect(finalized.statusCode, finalized.body).toBe(200);
      expect(finalized.json().receipt).toMatchObject({
        status: "completed",
        stateVersion: reviewTask.stateVersion + 1,
      });
      const worldAfterFinalize = await readQuiescentWorldAudit();
      expect(worldAfterFinalize).toEqual(worldBeforeFinalize);

      const reviewWorkspace = await target.inject({
        method: "GET",
        url: `/api/sessions/${runtime.sessionId}/course-review?bindingId=${item!.enrollment.bindingId}`,
        headers: { cookie: learner.cookie },
      });
      expect(reviewWorkspace.statusCode).toBe(200);
      expect(reviewWorkspace.json().review.status).toBe("completed");
      const review = reviewWorkspace.json().review.review as {
        reviewId: string;
        finalizedAt: string;
        publicSummary: string;
      };
      expect(review.reviewId).toMatch(/^course-process-review:/u);
      expect(review.finalizedAt).toBe(reviewTask.submittedAt);
      expect(review.publicSummary).toContain("\u4e0d\u662f\u6559\u5e08\u6216\u4e13\u5bb6");
      expect(review.publicSummary).toContain("\u5f85\u590d\u6838");
      frozenReviews.set(runtime.sessionId, structuredClone(review));
    }

    const portfolio = portfolioResponse.json().portfolio as {
      items: Array<{ sessionId: string; evidenceIds: string[] }>;
      evidence: Array<{ sessionId: string; evidenceId: string }>;
    };
    const visibleEvidenceIds = new Set(portfolio.items.flatMap((item) => item.evidenceIds));
    expect(portfolio.evidence.every((item) => visibleEvidenceIds.has(item.evidenceId)))
      .toBe(true);
    expect(JSON.stringify(portfolio)).not.toMatch(
      /actorId|principalId|prompt|privateMemory|rawTrace|providerRequestId/u,
    );

    const agentTaskJournalPath = join(dataDir!, "agent-tasks.jsonl");
    const [agentTaskJournalStat, agentTaskJournalBody] = await Promise.all([
      stat(agentTaskJournalPath),
      readFile(agentTaskJournalPath, "utf8"),
    ]);
    const agentTaskJournalLines = agentTaskJournalBody.trim().length === 0
      ? 0
      : agentTaskJournalBody.trimEnd().split(/\r?\n/u).length;
    expect(agentTaskJournalStat.size).toBeLessThanOrEqual(64 * 1024 * 1024);
    expect(agentTaskJournalLines).toBeLessThan(16);
    console.info(
      `[QA-006] bounded agent-tasks bytes=${agentTaskJournalStat.size}`
      + ` lines=${agentTaskJournalLines}`,
    );

    await target.close();
    app = null;
    target = await createApp({
      dataDir: dataDir!,
      logger: false,
      initializeSecondaryDemo: false,
      awaitStartupRecovery: true,
      environment: {
        NODE_ENV: "test",
        IFLYTEK_MODE: "mock",
        DEEPSEEK_MODE: "mock",
      },
    });
    app = target;
    const restored = await loginAs(target, "student-unassigned");
    const restoredEnrollments = await target.inject({
      method: "GET",
      url: "/api/me/course-enrollments",
      headers: { cookie: restored.cookie },
    });
    expect(restoredEnrollments.statusCode).toBe(200);
    const restoredEnrollmentItems = restoredEnrollments.json().enrollments as Array<{
      bindingId: string;
      status: string;
      courseReleaseRef: { courseId: string };
    }>;
    expect(restoredEnrollmentItems).toHaveLength(3);
    expect(restoredEnrollmentItems.every((enrollment) => (
      enrollment.status === "completed"
    ))).toBe(true);
    for (const runtime of runtimeCases) {
      const principalEnrollment = restoredEnrollmentItems.find((candidate) => (
        candidate.courseReleaseRef.courseId === runtime.courseId
      ));
      if (!principalEnrollment) {
        throw new Error(`QA-006 restored enrollment missing: ${runtime.courseId}`);
      }
      const staleBindingDenied = await target.inject({
        method: "GET",
        url: `/api/sessions/${runtime.sessionId}/course-review?bindingId=${principalEnrollment.bindingId}`,
        headers: { cookie: restored.cookie },
      });
      expect(staleBindingDenied.statusCode).toBe(403);

      const sessionLogin = await loginAs(
        target,
        "student-unassigned",
        runtime.sessionId,
      );
      const reporterBinding = sessionLogin.auth.bindings.find((candidate) => (
        candidate.sessionId === runtime.sessionId
        && candidate.actorKind === "student"
        && candidate.roleId === "reporter"
      ));
      if (!reporterBinding) {
        throw new Error(`QA-006 session reporter binding missing: ${runtime.sessionId}`);
      }
      const sessionEnrollmentResponse = await target.inject({
        method: "GET",
        url: "/api/me/course-enrollments",
        headers: { cookie: sessionLogin.cookie },
      });
      expect(sessionEnrollmentResponse.statusCode).toBe(200);
      const sessionEnrollment = (sessionEnrollmentResponse.json().enrollments as Array<{
        bindingId: string;
        activeSessionId: string | null;
        status: string;
        courseReleaseRef: { courseId: string };
      }>).find((candidate) => (
        candidate.courseReleaseRef.courseId === runtime.courseId
      ));
      expect(sessionEnrollment).toMatchObject({
        bindingId: reporterBinding.bindingId,
        activeSessionId: runtime.sessionId,
        status: "completed",
        courseReleaseRef: { courseId: runtime.courseId },
      });
      const restoredReview = await target.inject({
        method: "GET",
        url: `/api/sessions/${runtime.sessionId}/course-review?bindingId=${reporterBinding.bindingId}`,
        headers: { cookie: sessionLogin.cookie },
      });
      expect(restoredReview.statusCode).toBe(200);
      expect(restoredReview.json().review).toMatchObject({ status: "completed" });
      expect(restoredReview.json().review.review).toEqual(
        frozenReviews.get(runtime.sessionId),
      );
    }
  }, fullMigrationJourneyTimeoutMs);
});
