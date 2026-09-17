import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  DialogueTurnRequestV4SchemaVersion,
  SemanticActionRequestV4SchemaVersion,
} from "@ronggang/contracts";
import type { DemoAuthContext } from "../src/identity.js";
import { createApp, DEMO_XUNPU_SESSION_ID } from "../src/server.js";

const origin = "http://localhost:5173";
let app: FastifyInstance | null = null;
let dataDirectory: string | null = null;
let opening: Promise<FastifyInstance> | null = null;

afterEach(async () => {
  await (app ?? await opening?.catch(() => null))?.close();
  app = null;
  if (dataDirectory) {
    await rm(dataDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
  dataDirectory = null;
  opening = null;
});

function options(directory: string) {
  return {
    dataDir: directory,
    logger: false,
    initializeSecondaryDemo: false,
    awaitStartupRecovery: true,
    environment: {
      NODE_ENV: "test",
      IFLYTEK_MODE: "mock",
      DEEPSEEK_MODE: "mock",
    },
  } as const;
}

async function login(target: FastifyInstance, profileId: string) {
  const response = await target.inject({
    method: "POST",
    url: "/api/auth/demo-session",
    headers: { origin },
    payload: { profileId, sessionId: DEMO_XUNPU_SESSION_ID },
  });
  expect(response.statusCode).toBe(200);
  const auth = response.json() as DemoAuthContext;
  const rawCookie = Array.isArray(response.headers["set-cookie"])
    ? response.headers["set-cookie"][0]
    : response.headers["set-cookie"];
  if (!rawCookie) throw new Error("dialogue integration cookie missing");
  return { auth, cookie: rawCookie.split(";")[0]! };
}

describe("V4 dialogue public server integration", () => {
  beforeAll(async () => {
    dataDirectory = await mkdtemp(join(tmpdir(), "ronggang-dialogue-api-v4-"));
    opening = createApp(options(dataDirectory));
    app = await opening;
  }, 60_000);
  it("persists a student-only dialogue across restart and exposes role-safe causal views", async () => {
    if (!app || !dataDirectory) throw new Error("Dialogue fixture did not initialize");
    let student = await login(app, "student-team-a");
    const studentBinding = student.auth.bindings.find((binding) => (
      binding.sessionId === DEMO_XUNPU_SESSION_ID && binding.actorKind === "student"
    ));
    expect(studentBinding).toBeTruthy();
    const experienceResponse = await app.inject({
      method: "GET",
      url: `/api/v4/sessions/${DEMO_XUNPU_SESSION_ID}/experience?bindingId=${studentBinding!.bindingId}`,
      headers: { cookie: student.cookie },
    });
    expect(experienceResponse.statusCode).toBe(200);
    const experience = experienceResponse.json().experience;
    const gatekeeper = experience.actionWindow.selections.find(
      (selection: { label: string }) => selection.label.includes("林师傅"),
    );
    expect(gatekeeper).toBeTruthy();
    const opened = await app.inject({
      method: "POST",
      url: `/api/v4/sessions/${DEMO_XUNPU_SESSION_ID}/dialogues`,
      headers: {
        origin,
        cookie: student.cookie,
        "x-csrf-token": student.auth.csrfToken,
      },
      payload: {
        schemaVersion: SemanticActionRequestV4SchemaVersion,
        requestId: "dialogue-integration-open",
        sessionId: DEMO_XUNPU_SESSION_ID,
        bindingId: studentBinding!.bindingId,
        actionWindowRef: experience.actionWindow.actionWindowRef,
        actionWindowHash: experience.actionWindow.actionWindowHash,
        expectedWorldStateVersion: experience.actionWindow.worldStateVersion,
        utterance: "您好，我是融媒体中心实训记者，只在公共巷道取景，想先确认哪些地方不能进入。",
        selections: [{
          selectionToken: gatekeeper.selectionToken,
          displayKind: gatekeeper.displayKind,
        }],
        submittedAt: new Date().toISOString(),
      },
    });
    expect(opened.statusCode, opened.body).toBe(200);
    const dialogue = opened.json().dialogue;
    const first = await app.inject({
      method: "POST",
      url: `/api/v4/sessions/${DEMO_XUNPU_SESSION_ID}/dialogues/${dialogue.episode.episodeId}/turns`,
      headers: {
        origin,
        cookie: student.cookie,
        "x-csrf-token": student.auth.csrfToken,
      },
      payload: {
        schemaVersion: DialogueTurnRequestV4SchemaVersion,
        requestId: "dialogue-integration-turn-1",
        sessionId: DEMO_XUNPU_SESSION_ID,
        bindingId: studentBinding!.bindingId,
        episodeId: dialogue.episode.episodeId,
        expectedEpisodeRevision: 0,
        expectedWorldStateVersion: 0,
        turnToken: dialogue.turnToken,
        utterance: "我是参加课程实训的学生记者，来采访社区日常。我会先征得同意，不拍门牌，居民可以撤回。",
        submittedAt: new Date().toISOString(),
      },
    });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json().dialogue.episode).toMatchObject({ status: "active", turnCount: 1 });

    await app.close();
    app = await createApp(options(dataDirectory));
    student = await login(app, "student-team-a");
    const recovered = await app.inject({
      method: "GET",
      url: `/api/v4/sessions/${DEMO_XUNPU_SESSION_ID}/dialogue?bindingId=${studentBinding!.bindingId}`,
      headers: { cookie: student.cookie },
    });
    expect(recovered.statusCode, recovered.body).toBe(200);
    expect(recovered.json().dialogue).toMatchObject({
      audience: "student",
      episode: { status: "active", turnCount: 1 },
    });
    expect(recovered.json().dialogue.turnToken).toMatch(/^dialogueturn_/u);

    const second = await app.inject({
      method: "POST",
      url: `/api/v4/sessions/${DEMO_XUNPU_SESSION_ID}/dialogues/${dialogue.episode.episodeId}/turns`,
      headers: {
        origin,
        cookie: student.cookie,
        "x-csrf-token": student.auth.csrfToken,
      },
      payload: {
        schemaVersion: DialogueTurnRequestV4SchemaVersion,
        requestId: "dialogue-integration-turn-2",
        sessionId: DEMO_XUNPU_SESSION_ID,
        bindingId: studentBinding!.bindingId,
        episodeId: dialogue.episode.episodeId,
        expectedEpisodeRevision: 1,
        expectedWorldStateVersion: 0,
        turnToken: recovered.json().dialogue.turnToken,
        utterance: "请帮我联系一位愿意受访的居民，我会再次征得同意。",
        submittedAt: new Date().toISOString(),
      },
    });
    expect(second.statusCode, second.body).toBe(200);
    expect(second.json().dialogue.episode).toMatchObject({
      status: "resolved",
      resolution: { routeRef: "dialogue-route-assisted-contact" },
    });

    const teacher = await login(app, "teacher-class-a");
    const teacherBinding = teacher.auth.bindings.find((binding) => (
      binding.sessionId === DEMO_XUNPU_SESSION_ID && binding.actorKind === "teacher"
    ));
    expect(teacherBinding).toBeTruthy();
    const teacherView = await app.inject({
      method: "GET",
      url: `/api/v4/sessions/${DEMO_XUNPU_SESSION_ID}/dialogue?bindingId=${teacherBinding!.bindingId}`,
      headers: { cookie: teacher.cookie },
    });
    expect(teacherView.statusCode, teacherView.body).toBe(200);
    expect(teacherView.json().dialogue).toMatchObject({
      audience: "teacher",
      turnToken: null,
      episode: { causalSummary: { elapsedDialogueMinutes: 4 } },
    });
    expect(JSON.stringify(teacherView.json())).not.toMatch(
      /learnerSubjectHash|privateBoundaryHash|candidateRuleRefs|selectedRuleRef|modelRunRef/u,
    );
  }, 30_000);
});
