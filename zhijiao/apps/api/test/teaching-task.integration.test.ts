import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { TeachingTaskDraftV1, TeachingTaskReleaseV1, TeachingTaskSessionV1 } from "@ronggang/contracts";
import { createApp, DEMO_XUNPU_SESSION_ID } from "../src/server.js";
import type { DemoAuthContext } from "../src/identity.js";

const temporaryRoot = fileURLToPath(new URL("../../../.local/", import.meta.url));
const origin = "http://localhost:5173";
let app: FastifyInstance | undefined, opening: Promise<FastifyInstance> | undefined, directory: string | undefined, closing = false;
const serverErrors: string[] = [];
const config = () => ({ dataDir: directory!, logger: false, initializeSecondaryDemo: false, awaitStartupRecovery: true,
  environment: { NODE_ENV: "test", MODEL_PROVIDER: "deterministic", IFLYTEK_MODE: "mock", DEEPSEEK_MODE: "mock" } } as const);
async function openApp() {
  opening = createApp(config()); app = await opening; if (closing) throw new Error("test fixture is closing");
  app.addHook("onError", (_request, _reply, error, done) => { serverErrors.push(`${error.stack}\n${error.cause instanceof Error ? error.cause.stack : ""}`); done(); });
}
afterEach(async () => {
  closing = true;
  await (app ?? await opening?.catch(() => undefined))?.close();
  app = undefined; opening = undefined;
  if (directory) {
    const child = relative(temporaryRoot, resolve(directory));
    if (!child || child.startsWith("..") || isAbsolute(child)) throw new Error("test cleanup outside workspace");
    await rm(directory, { recursive: true, force: true });
  }
  directory = undefined;
});
async function login(profileId: string, sessionId?: string) {
  const response = await app!.inject({ method: "POST", url: "/api/auth/demo-session", headers: { origin }, payload: { profileId, ...(sessionId ? { sessionId } : {}) } });
  expect(response.statusCode, response.body).toBe(200);
  const auth = response.json() as DemoAuthContext;
  const cookies = response.headers["set-cookie"];
  const cookie = (Array.isArray(cookies) ? cookies[0]! : cookies!).split(";")[0]!;
  return { auth, headers: { origin, cookie, "x-csrf-token": auth.csrfToken } };
}

describe("teacher publication to independent student worlds", () => {
  it("generates, revises, publishes, separates two students and reopens the same frozen task after restart", async () => {
    closing = false;
    serverErrors.length = 0;
    await mkdir(temporaryRoot, { recursive: true });
    directory = await mkdtemp(resolve(temporaryRoot, "teaching-task-api-"));
    await openApp();
    let teacher = await login("teacher-class-a", DEMO_XUNPU_SESSION_ID);
    const teacherBody = () => ({ authorizationSessionId: DEMO_XUNPU_SESSION_ID,
      bindingId: teacher.auth.bindings.find(binding => binding.sessionId === DEMO_XUNPU_SESSION_ID && binding.actorKind === "teacher")!.bindingId });
    const generated = await app!.inject({ method: "POST", url: "/api/teaching-tasks/generate", headers: teacher.headers,
      payload: { ...teacherBody(), requestId: "http-task-generation", input: { title: "本班公共服务信息核对", brief: "为初次来访游客制作公共服务信息和交通出行的核对说明", audience: "初次来访的游客",
        learnerContext: "能提出基本采访问题，重点练习来源、时段和公开范围", learnerLevel: "beginner", durationMinutes: 45,
        sourceKind: "teaching_example", sourceStatement: "本轮工程验证的自拟教学委托", templateId: null } } });
    expect(generated.statusCode, generated.body).toBe(200);
    const draft = generated.json().draft as TeachingTaskDraftV1;
    expect(draft.templateId).toBe("public-service");
    const edited = await app!.inject({ method: "POST", url: `/api/teaching-tasks/${draft.taskId}/revisions`, headers: teacher.headers,
      payload: { ...teacherBody(), requestId: "http-task-edit", expectedRevision: draft.revision,
        changes: { title: "先确认服务范围，再写游客指引", assignment: draft.plan.assignment, audience: draft.plan.audience, objectives: draft.plan.objectives,
          durationMinutes: 45, scaffoldingLevel: 2, challengeLevel: 4, steps: draft.plan.steps.map(step => ({ taskRef: step.taskRef, instruction: step.instruction })) } } });
    expect(edited.statusCode, edited.body).toBe(200);
    const reviewed = edited.json().draft as TeachingTaskDraftV1;
    const published = await app!.inject({ method: "POST", url: `/api/teaching-tasks/${draft.taskId}/publish`, headers: teacher.headers,
      payload: { ...teacherBody(), requestId: "http-task-publish", expectedRevision: reviewed.revision, contentHash: reviewed.contentHash,
        confirmation: "已核对任务要求、课堂条件与素材边界，确认用于本班仿真练习。" } });
    expect(published.statusCode, published.body).toBe(200);
    const release = published.json().release as TeachingTaskReleaseV1;
    let studentA = await login("student-unassigned");
    const startA = await app!.inject({ method: "PUT", url: `/api/teaching-tasks/releases/${release.ref.releaseId}/my-session`, headers: studentA.headers, payload: {} });
    expect(startA.statusCode, `${startA.body}\n${serverErrors.join("\n")}`).toBe(200);
    const sessionA = startA.json().session as TeachingTaskSessionV1;
    const studentB = await login("student-team-a");
    const startB = await app!.inject({ method: "PUT", url: `/api/teaching-tasks/releases/${release.ref.releaseId}/my-session`, headers: studentB.headers, payload: {} });
    expect(startB.statusCode, startB.body).toBe(200);
    const sessionB = startB.json().session as TeachingTaskSessionV1;
    expect(sessionB.sessionId).not.toBe(sessionA.sessionId);
    const read = async (session: TeachingTaskSessionV1, headers: typeof studentA.headers) => {
      const response = await app!.inject({ method: "GET", url: `/api/v4/sessions/${session.sessionId}/interview?bindingId=${session.bindingId}`, headers });
      expect(response.statusCode, response.body).toBe(200);
      return response.json().view;
    };
    const aBefore = await read(sessionA, studentA.headers);
    expect(aBefore.title).toBe(reviewed.plan.title);
    expect(aBefore.remainingMinutes).toBe(45);
    const talk = await app!.inject({ method: "POST", url: `/api/v4/sessions/${sessionA.sessionId}/interview/actions`, headers: studentA.headers,
      payload: { schemaVersion: "field-interview-action/1.0.0", requestId: "task-student-question", sessionId: sessionA.sessionId, bindingId: sessionA.bindingId,
        expectedWorldStateVersion: aBefore.worldStateVersion, action: { kind: "talk", npcId: "entity-gatekeeper", channel: "scene", text: "我是来做采访的学生，想了解巷口的公示范围。" } } });
    expect(talk.statusCode, talk.body).toBe(200);
    expect((await read(sessionB, studentB.headers)).turns).toEqual([]);
    const denied = await app!.inject({ method: "POST", url: "/api/auth/demo-session", headers: { origin }, payload: { profileId: "student-team-a", sessionId: sessionA.sessionId } });
    expect(denied.statusCode).toBe(403);
    const republishEdit = await app!.inject({ method: "POST", url: `/api/teaching-tasks/${draft.taskId}/revisions`, headers: teacher.headers,
      payload: { ...teacherBody(), requestId: "http-task-advanced", expectedRevision: reviewed.revision,
        changes: { title: "公共服务进阶核验", assignment: reviewed.plan.assignment, audience: reviewed.plan.audience, objectives: reviewed.plan.objectives,
          durationMinutes: 60, scaffoldingLevel: 0, challengeLevel: 5, steps: reviewed.plan.steps.map(step => ({ taskRef: step.taskRef, instruction: step.instruction })) } } });
    expect(republishEdit.statusCode, republishEdit.body).toBe(200);
    const advanced = republishEdit.json().draft as TeachingTaskDraftV1;
    const publishAdvanced = await app!.inject({ method: "POST", url: `/api/teaching-tasks/${draft.taskId}/publish`, headers: teacher.headers,
      payload: { ...teacherBody(), requestId: "http-publish-advanced", expectedRevision: advanced.revision, contentHash: advanced.contentHash,
        confirmation: "已核对进阶任务的课堂时限和自主完成条件。" } });
    expect(publishAdvanced.statusCode, publishAdvanced.body).toBe(200);
    const parallelStart = await app!.inject({ method: "PUT", url: `/api/teaching-tasks/releases/${publishAdvanced.json().release.ref.releaseId}/my-session`, headers: studentA.headers, payload: {} });
    expect(parallelStart.statusCode,parallelStart.body).toBe(409);
    const aStudy=(await app!.inject({method:"GET",url:"/api/v3/me/study",headers:studentA.headers})).json();
    const cancelledA=await app!.inject({method:"POST",url:"/api/v3/me/study/cancel",headers:studentA.headers,payload:{requestId:"cancel-before-advanced",sessionId:sessionA.sessionId,expectedRevision:aStudy.revision,confirmation:"abandon"}});
    expect(cancelledA.statusCode,cancelledA.body).toBe(200);
    const startAdvanced = await app!.inject({ method: "PUT", url: `/api/teaching-tasks/releases/${publishAdvanced.json().release.ref.releaseId}/my-session`, headers: studentA.headers, payload: {} });
    expect(startAdvanced.statusCode, startAdvanced.body).toBe(200);
    expect((await read(startAdvanced.json().session, studentA.headers)).remainingMinutes).toBe(60);
    expect((await read(sessionA, studentA.headers)).title).toBe(reviewed.plan.title);

    const community = await app!.inject({ method: "POST", url: "/api/teaching-tasks/generate", headers: teacher.headers,
      payload: { ...teacherBody(), requestId: "http-community-generation", input: { title: "日常劳动人物报道", brief: "为初次了解蟳埔的读者做社区人物与日常劳动报道",
        audience: "初次了解社区生活的读者", learnerContext: "练习知情同意与有范围的人物叙述", learnerLevel: "beginner", durationMinutes: 55,
        sourceKind: "teaching_example", sourceStatement: "工程验证自拟教学委托", templateId: "community-story" } } });
    expect(community.statusCode, community.body).toBe(200);
    const communityDraft = community.json().draft as TeachingTaskDraftV1;
    const publishCommunity = await app!.inject({ method: "POST", url: `/api/teaching-tasks/${communityDraft.taskId}/publish`, headers: teacher.headers,
      payload: { ...teacherBody(), requestId: "http-publish-community", expectedRevision: communityDraft.revision, contentHash: communityDraft.contentHash,
        confirmation: "已核对人物报道委托与居民记录边界。" } });
    expect(publishCommunity.statusCode, publishCommunity.body).toBe(200);
    const bStudy=(await app!.inject({method:"GET",url:"/api/v3/me/study",headers:studentB.headers})).json();
    const cancelledB=await app!.inject({method:"POST",url:"/api/v3/me/study/cancel",headers:studentB.headers,payload:{requestId:"cancel-before-community",sessionId:sessionB.sessionId,expectedRevision:bStudy.revision,confirmation:"abandon"}});
    expect(cancelledB.statusCode,cancelledB.body).toBe(200);
    const startCommunity = await app!.inject({ method: "PUT", url: `/api/teaching-tasks/releases/${publishCommunity.json().release.ref.releaseId}/my-session`, headers: studentB.headers, payload: {} });
    expect(startCommunity.statusCode, startCommunity.body).toBe(200);
    const communityView = await read(startCommunity.json().session, studentB.headers);
    expect(communityView.title).toBe(communityDraft.plan.title);
    expect(communityView.remainingMinutes).toBe(55);
    expect(communityView.assignment).not.toBe(aBefore.assignment);
    await app!.close(); app = undefined;
    await openApp();
    studentA = await login("student-unassigned", sessionA.sessionId);
    const recovered = await read(sessionA, studentA.headers);
    expect(recovered.turns).toHaveLength(1);
    expect(recovered.title).toBe(reviewed.plan.title);
    const retry = await app!.inject({ method: "PUT", url: `/api/teaching-tasks/releases/${release.ref.releaseId}/my-session`, headers: studentA.headers, payload: {} });
    expect(retry.statusCode, retry.body).toBe(409);
    const currentRetry = await app!.inject({method:"PUT",url:`/api/teaching-tasks/releases/${publishAdvanced.json().release.ref.releaseId}/my-session`,headers:studentA.headers,payload:{}});
    expect(currentRetry.statusCode,currentRetry.body).toBe(200);
    expect(currentRetry.json().session.sessionId).toBe(startAdvanced.json().session.sessionId);
    teacher = await login("teacher-class-a", sessionA.sessionId);
    const teacherWorkspace = await app!.inject({ method: "GET", url: "/api/teaching-tasks", headers: teacher.headers });
    expect(teacherWorkspace.statusCode, teacherWorkspace.body).toBe(200);
    expect(teacherWorkspace.json().sessions).toHaveLength(4);
    await login("operator-demo", sessionA.sessionId);
  }, 60_000);
});
