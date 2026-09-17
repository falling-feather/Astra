import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import type { FieldInterviewActionV1, FieldInterviewViewV1 } from "@ronggang/contracts";
import type { DemoAuthContext } from "../src/identity.js";
import { createApp, DEMO_XUNPU_SESSION_ID } from "../src/server.js";

const temporaryRoot = fileURLToPath(new URL("../../../.local/", import.meta.url));
const origin = "http://localhost:5173";
let app: FastifyInstance | null = null, directory: string | null = null;
const config = (dataDir: string) => ({ dataDir, logger: false, initializeSecondaryDemo: false, awaitStartupRecovery: true,
  environment: { NODE_ENV: "test", IFLYTEK_MODE: "mock", DEEPSEEK_MODE: "mock" } } as const);
afterEach(async () => {
  await app?.close(); app = null;
  if (directory) {
    const child = relative(temporaryRoot, resolve(directory));
    if (!child || child.startsWith("..") || isAbsolute(child)) throw new Error("test cleanup outside workspace temporary root");
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
  directory = null;
});
async function login(profileId: string) {
  const response = await app!.inject({ method: "POST", url: "/api/auth/demo-session", headers: { origin }, payload: { profileId, sessionId: DEMO_XUNPU_SESSION_ID } });
  expect(response.statusCode, response.body).toBe(200);
  const auth = response.json() as DemoAuthContext;
  const binding = auth.bindings.find(binding => binding.sessionId === DEMO_XUNPU_SESSION_ID)!;
  const cookieHeader = response.headers["set-cookie"];
  const cookie = (Array.isArray(cookieHeader) ? cookieHeader[0]! : cookieHeader!).split(";")[0]!;
  return { auth, bindingId: binding.bindingId, cookie };
}

describe("open interview public flow", () => {
  it("connects ordinary speech, public investigation, delayed mail and teacher process to the same persisted world", async () => {
    await mkdir(temporaryRoot, { recursive: true });
    directory = await mkdtemp(resolve(temporaryRoot, "field-interview-api-"));
    app = await createApp(config(directory));
    const serverErrors: string[] = [];
    app.addHook("onError", (_request, _reply, error, done) => { serverErrors.push(error.stack ?? error.message); done(); });
    let student = await login("student-team-a");
    const endpoint = `/api/v4/sessions/${DEMO_XUNPU_SESSION_ID}/interview`;
    const read = async () => {
      const response = await app!.inject({ method: "GET", url: `${endpoint}?bindingId=${student.bindingId}`, headers: { cookie: student.cookie } });
      expect(response.statusCode, response.body).toBe(200);
      return response.json().view as FieldInterviewViewV1;
    };
    // Start the existing director before the new field commits, exercising both event kinds.
    const initial = await app.inject({ method: "GET", url: `/api/v4/sessions/${DEMO_XUNPU_SESSION_ID}/experience?bindingId=${student.bindingId}`, headers: { cookie: student.cookie } });
    expect(initial.statusCode, initial.body).toBe(200);
    let view = await read(), sequence = 0;
    const act = async (action: FieldInterviewActionV1) => {
      const response = await app!.inject({ method: "POST", url: `${endpoint}/actions`, headers: { origin, cookie: student.cookie, "x-csrf-token": student.auth.csrfToken },
        payload: { schemaVersion: "field-interview-action/1.0.0", requestId: `field-api-${++sequence}`, sessionId: DEMO_XUNPU_SESSION_ID, bindingId: student.bindingId, expectedWorldStateVersion: view.worldStateVersion, action } });
      expect(response.statusCode, response.body).toBe(200);
      view = response.json().view;
      return response;
    };
    await act({ kind: "talk", npcId: "entity-gatekeeper", channel: "scene", text: "林师傅你好" });
    expect(view.turns.at(-1)?.npcText).toContain("你好");
    expect(view.nodes.find(node => node.id === "loc-community-courtyard")?.allowed).toBe(false);
    await act({ kind: "inspect", materialId: "material-notice-board" });
    await act({ kind: "travel", nodeId: "loc-merchant-storefront" });
    await act({ kind: "talk", npcId: "entity-shopkeeper", channel: "scene", text: "你们平时给顾客提供什么服务？" });
    await act({ kind: "talk", npcId: "entity-researcher", channel: "chat", text: "请您把原文资料稍后通过邮件发给我，我先继续调查。" });
    expect(view.promises).toHaveLength(0);
    await act({ kind: "talk", npcId: "entity-researcher", channel: "chat", text: "好的" });
    await act({ kind: "wait", minutes: 6 });
    expect(view.promises[0]?.status).toBe("overdue");
    expect(view.messages.some(message => message.channel === "email")).toBe(false);
    await app.close();
    app = await createApp(config(directory));
    app.addHook("onError", (_request, _reply, error, done) => { serverErrors.push(error.stack ?? error.message); done(); });
    student = await login("student-team-a");
    view = await read();
    expect(view.promises[0]?.status).toBe("overdue");
    expect(view.turns.some(turn => turn.studentText === "林师傅你好")).toBe(true);
    await act({ kind: "talk", npcId: "entity-researcher", channel: "chat", text: "约定的资料还没收到，请补发邮件。" });
    await act({ kind: "talk", npcId: "entity-researcher", channel: "chat", text: "按这个安排" });
    await act({ kind: "wait", minutes: 2 });
    expect(view.messages.filter(message => message.channel === "email")).toHaveLength(1);
    const experience = await app.inject({ method: "GET", url: `/api/v4/sessions/${DEMO_XUNPU_SESSION_ID}/experience?bindingId=${student.bindingId}`, headers: { cookie: student.cookie } });
    expect(experience.statusCode, `${experience.body}\n${serverErrors.join("\n")}`).toBe(200);
    expect(experience.json().experience.virtualMinute).toBe(view.virtualMinute);
    const workspace = await app.inject({ method: "GET", url: `/api/v3/sessions/${DEMO_XUNPU_SESSION_ID}/workspace?bindingId=${student.bindingId}`, headers: { cookie: student.cookie } });
    expect(workspace.statusCode, workspace.body).toBe(200);
    const promiseTurn = view.turns.find(turn => turn.choiceId === "chen-mail" && turn.choiceConfirmed)!;
    expect(workspace.json().workspace.evidenceCatalog.find((item: { evidenceRef: string }) => item.evidenceRef === promiseTurn.id)).toMatchObject({
      label: expect.stringContaining("请陈老师稍后发送资料"), detail: expect.stringContaining(promiseTurn.npcText),
    });
    const administrator = await login("operator-demo");
    const trace = await app.inject({ method: "GET", url: `/api/sessions/${DEMO_XUNPU_SESSION_ID}/trace-page?bindingId=${administrator.bindingId}&limit=200`, headers: { cookie: administrator.cookie } });
    expect(trace.statusCode, trace.body).toBe(200);
    expect(trace.json().stateVersion).toBe((await read()).worldStateVersion);
    expect(trace.json().records.some((item: { eventId: string }) => item.eventId === view.recentEvents.at(-1)!.id)).toBe(true);
    const deniedTrace = await app.inject({ method: "GET", url: `/api/sessions/${DEMO_XUNPU_SESSION_ID}/trace-page?bindingId=${student.bindingId}`, headers: { cookie: student.cookie } });
    expect(deniedTrace.statusCode).toBe(403);
    const teacher = await login("teacher-class-a");
    const classes = await app.inject({ method: "GET", url: `/api/training-sessions?bindingId=${teacher.bindingId}&authorizationSessionId=${DEMO_XUNPU_SESSION_ID}`, headers: { cookie: teacher.cookie } });
    expect(classes.statusCode, classes.body).toBe(200);
    const governanceCourse = classes.json().sessions.find((item: { sessionId: string }) => item.sessionId === "demo-village-postpublication-v2");
    expect(governanceCourse.experienceTitle).toBe("村超短视频语境回应与多平台更正");
    const response = await app.inject({ method: "GET", url: `${endpoint}?bindingId=${teacher.bindingId}`, headers: { cookie: teacher.cookie } });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().view.turns).toHaveLength(view.turns.length);
    expect(JSON.stringify(response.json())).not.toMatch(/modelReceipt|inputHash|privateBoundary|csrfToken/);
    const prohibited = await app.inject({ method: "POST", url: `${endpoint}/actions`, headers: { origin, cookie: teacher.cookie, "x-csrf-token": teacher.auth.csrfToken },
      payload: { schemaVersion: "field-interview-action/1.0.0", requestId: "teacher-cannot-act", sessionId: DEMO_XUNPU_SESSION_ID, bindingId: teacher.bindingId, expectedWorldStateVersion: view.worldStateVersion, action: { kind: "wait", minutes: 1 } } });
    expect(prohibited.statusCode).toBe(403);
  }, 60_000);
});
