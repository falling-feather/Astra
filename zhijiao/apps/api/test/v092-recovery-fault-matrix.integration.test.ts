import {
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";
import type { RoleBinding } from "@ronggang/contracts";
import {
  JsonlAgentTaskStore,
  type AgentTaskStore,
  type ClaimAgentTaskInput,
} from "@ronggang/agent-orchestrator";
import { UnifiedIflytekAdapter } from "@ronggang/iflytek-adapter";
import {
  InMemorySessionControlStore,
  LocalRecoveryCheckpointCatalog,
  type RecoveryCheckpoint,
  type RecoveryCheckpointCatalog,
} from "@ronggang/session-control";
import {
  InMemoryEventStore,
  InProcessMessageBus,
  WorldEngine,
  demoScenario,
} from "@ronggang/world-core";
import type { DemoAuthContext } from "../src/identity.js";
import { JsonlSessionControlStore } from "../src/jsonl-session-control-store.js";
import {
  createVerifiedLocalDataBackup,
  restoreVerifiedLocalDataBackup,
} from "../src/local-data-backup.js";
import {
  DEMO_SECONDARY_SESSION_ID,
} from "../src/session-control-bootstrap.js";
import {
  createApp,
  createMemoryTestApp,
  DEMO_SESSION_ID,
} from "../src/server.js";

const localOrigin = "http://localhost:5173";
const testEnvironment = {
  MODEL_PROVIDER: "deterministic",
  IFLYTEK_MODE: "mock",
  NODE_ENV: "test",
};
const persistentRuntimeTestTimeoutMs = 90_000;
const backupRestoreTestTimeoutMs = 120_000;

interface Login {
  cookie: string;
  context: DemoAuthContext;
}

interface CheckpointFile {
  name: string;
  path: string;
  checkpoint: RecoveryCheckpoint;
}

interface DeniedCheckpointAttempt {
  method: "GET" | "POST";
  url: string;
  login: Login;
  payload?: {
    authorizationSessionId: string;
    bindingId: string;
  };
}

async function login(
  app: FastifyInstance,
  profileId: string,
  sessionId: string,
): Promise<Login> {
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
  if (!setCookie) throw new Error("登录响应缺少 Cookie");
  return {
    cookie: setCookie.split(";")[0]!,
    context,
  };
}

function binding(loginContext: Login, actorKind: "teacher" | "student"): RoleBinding {
  const found = loginContext.context.bindings.find((candidate) => (
    candidate.actorKind === actorKind
  ));
  if (!found) throw new Error(`登录缺少 ${actorKind} 岗位绑定`);
  return found;
}

function requestHeaders(loginContext: Login, write = false): Record<string, string> {
  return {
    cookie: loginContext.cookie,
    ...(write
      ? {
          origin: localOrigin,
          "x-csrf-token": loginContext.context.csrfToken,
        }
      : {}),
  };
}

function checkpointUrl(
  targetSessionId: string,
  authorizationSessionId: string,
  roleBinding: RoleBinding,
): string {
  return `/api/training-sessions/${encodeURIComponent(targetSessionId)}/recovery-checkpoint`
    + `?authorizationSessionId=${encodeURIComponent(authorizationSessionId)}`
    + `&bindingId=${encodeURIComponent(roleBinding.bindingId)}`;
}

async function createPersistentApp(
  dataDir: string,
  options: {
    taskStore?: AgentTaskStore;
  } = {},
): Promise<FastifyInstance> {
  return createApp({
    dataDir,
    environment: testEnvironment,
    awaitStartupRecovery: true,
    ...(options.taskStore ? { taskStore: options.taskStore } : {}),
  });
}

async function checkpointFiles(dataDir: string): Promise<CheckpointFile[]> {
  const directory = resolve(dataDir, "recovery-checkpoints");
  const names = (await readdir(directory))
    .filter((name) => name.endsWith(".checkpoint.json"));
  return Promise.all(names.map(async (name) => {
    const path = resolve(directory, name);
    return {
      name,
      path,
      checkpoint: JSON.parse(await readFile(path, "utf8")) as RecoveryCheckpoint,
    };
  }));
}

async function checkpointFile(
  dataDir: string,
  sessionId: string,
): Promise<CheckpointFile> {
  const found = (await checkpointFiles(dataDir))
    .filter((candidate) => candidate.checkpoint.sessionId === sessionId)
    .sort((left, right) => (
      right.checkpoint.sourceRevision - left.checkpoint.sourceRevision
      || right.checkpoint.sourceSequence - left.checkpoint.sourceSequence
    ))[0];
  if (!found) throw new Error(`检查点目录缺少会话：${sessionId}`);
  return found;
}

async function expectSessionStatuses(
  dataDir: string,
  expected: {
    a: "active" | "recovery_failed";
    b: "active" | "recovery_failed";
  },
): Promise<void> {
  const store = new JsonlSessionControlStore(
    resolve(dataDir, "session-control.jsonl"),
  );
  expect((await store.getSession(DEMO_SESSION_ID))?.status).toBe(expected.a);
  expect((await store.getSession(DEMO_SECONDARY_SESSION_ID))?.status).toBe(expected.b);
}

async function seedAndClose(dataDir: string): Promise<void> {
  let app: FastifyInstance | null = null;
  try {
    app = await createPersistentApp(dataDir);
  } finally {
    await app?.close();
  }
}

function failClaimsForSession(
  inner: AgentTaskStore,
  failedSessionId: string,
): AgentTaskStore {
  let injected = false;
  return new Proxy(inner, {
    get(target, property) {
      if (property === "claimNext") {
        return async (input: ClaimAgentTaskInput) => {
          if (!injected && input.sessionId === failedSessionId) {
            injected = true;
            throw new Error("InjectedSessionDrainFailure");
          }
          return target.claimNext(input);
        };
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

class RejectingBadWriteCatalog implements RecoveryCheckpointCatalog {
  rejectNext = false;

  constructor(readonly inner: LocalRecoveryCheckpointCatalog) {}

  async save(value: unknown): Promise<RecoveryCheckpoint> {
    if (!this.rejectNext) return this.inner.save(value);
    this.rejectNext = false;
    const checkpoint = structuredClone(value as RecoveryCheckpoint);
    return this.inner.save({
      ...checkpoint,
      payload: {
        schema: "injected-invalid-recovery-payload",
        sessionId: checkpoint.sessionId,
      },
    });
  }

  loadLatest(sessionId: string): Promise<RecoveryCheckpoint | null> {
    return this.inner.loadLatest(sessionId);
  }
}

describe("V0.9.2 recovery and authorization fault matrix", () => {
  it("isolates tampered private memory to A without exposing memory bodies through checkpoints", async () => {
    const dataDir = await mkdtemp(resolve(tmpdir(), "ronggang-v093-memory-"));
    let restarted: FastifyInstance | null = null;
    try {
      await seedAndClose(dataDir);
      const memoryPath = resolve(dataDir, "role-memory.jsonl");
      const frames = (await readFile(memoryPath, "utf8"))
        .split(/\r?\n/u)
        .filter(Boolean)
        .map((line) => JSON.parse(line) as {
          delta: { sessionId: string; content: string };
        });
      const target = frames.find((frame) => (
        frame.delta.sessionId === DEMO_SESSION_ID
      ));
      if (!target) throw new Error("测试数据缺少 A 会话角色记忆");
      const privateCanary = target.delta.content;
      target.delta.content = "被篡改但未更新 deltaHash 的角色记忆";
      await writeFile(
        memoryPath,
        `${frames.map((frame) => JSON.stringify(frame)).join("\n")}\n`,
        "utf8",
      );

      restarted = await createPersistentApp(dataDir);
      await expectSessionStatuses(dataDir, {
        a: "recovery_failed",
        b: "active",
      });
      const checkpointText = (
        await Promise.all((await checkpointFiles(dataDir)).map((file) => (
          readFile(file.path, "utf8")
        )))
      ).join("\n");
      expect(checkpointText).not.toContain(privateCanary);
      expect(checkpointText).not.toContain(target.delta.content);
      expect(checkpointText).not.toContain("role-private/");
    } finally {
      await restarted?.close();
      await rm(dataDir, { recursive: true, force: true });
    }
  }, persistentRuntimeTestTimeoutMs);

  it("isolates a tampered A checkpoint at startup while B remains active", async () => {
    const dataDir = await mkdtemp(resolve(tmpdir(), "ronggang-v092-tamper-"));
    let restarted: FastifyInstance | null = null;
    try {
      await seedAndClose(dataDir);
      const target = await checkpointFile(dataDir, DEMO_SESSION_ID);
      await writeFile(target.path, `${JSON.stringify({
        ...target.checkpoint,
        payload: {
          schema: "tampered-recovery-payload",
          sessionId: DEMO_SESSION_ID,
        },
      })}\n`, "utf8");

      restarted = await createPersistentApp(dataDir);
      await expectSessionStatuses(dataDir, {
        a: "recovery_failed",
        b: "active",
      });
      const teacherB = await login(
        restarted,
        "teacher-class-b",
        DEMO_SECONDARY_SESSION_ID,
      );
      expect(binding(teacherB, "teacher").sessionId).toBe(DEMO_SECONDARY_SESSION_ID);
    } finally {
      await restarted?.close();
      await rm(dataDir, { recursive: true, force: true });
    }
  }, persistentRuntimeTestTimeoutMs);

  it("rejects a checkpoint sourceRevision from the future before recovery starts", async () => {
    const dataDir = await mkdtemp(resolve(tmpdir(), "ronggang-v092-source-"));
    let restarted: FastifyInstance | null = null;
    try {
      await seedAndClose(dataDir);
      const target = await checkpointFile(dataDir, DEMO_SESSION_ID);
      const futureRevision = 99;
      const renamed = resolve(
        dataDir,
        "recovery-checkpoints",
        target.name.replace(
          /-r\d{16}-/u,
          `-r${String(futureRevision).padStart(16, "0")}-`,
        ),
      );
      await rename(target.path, renamed);
      await writeFile(renamed, `${JSON.stringify({
        ...target.checkpoint,
        sourceRevision: futureRevision,
      })}\n`, "utf8");

      restarted = await createPersistentApp(dataDir);
      await expectSessionStatuses(dataDir, {
        a: "recovery_failed",
        b: "active",
      });
    } finally {
      await restarted?.close();
      await rm(dataDir, { recursive: true, force: true });
    }
  }, persistentRuntimeTestTimeoutMs);

  it("contains a session-specific drain failure and continues draining B", async () => {
    const dataDir = await mkdtemp(resolve(tmpdir(), "ronggang-v092-drain-"));
    let restarted: FastifyInstance | null = null;
    try {
      await seedAndClose(dataDir);
      const persistentTasks = new JsonlAgentTaskStore(
        resolve(dataDir, "agent-tasks.jsonl"),
      );
      restarted = await createPersistentApp(dataDir, {
        taskStore: failClaimsForSession(persistentTasks, DEMO_SESSION_ID),
      });

      await expectSessionStatuses(dataDir, {
        a: "recovery_failed",
        b: "active",
      });
      const teacherB = await login(
        restarted,
        "teacher-class-b",
        DEMO_SECONDARY_SESSION_ID,
      );
      const teacherBBinding = binding(teacherB, "teacher");
      const checkpoint = await restarted.inject({
        method: "GET",
        url: checkpointUrl(
          DEMO_SECONDARY_SESSION_ID,
          DEMO_SECONDARY_SESSION_ID,
          teacherBBinding,
        ),
        headers: requestHeaders(teacherB),
      });
      expect(checkpoint.statusCode).toBe(200);
      expect(checkpoint.json()).toMatchObject({
        sessionId: DEMO_SECONDARY_SESSION_ID,
        status: "verified",
      });
    } finally {
      await restarted?.close();
      await rm(dataDir, { recursive: true, force: true });
    }
  }, persistentRuntimeTestTimeoutMs);

  it("denies checkpoint reads and writes to students and both cross-class directions", async () => {
    const checkpointDirectory = await mkdtemp(
      resolve(tmpdir(), "ronggang-v092-auth-"),
    );
    const engine = new WorldEngine({
      store: new InMemoryEventStore(),
      bus: new InProcessMessageBus(),
      scenario: structuredClone(demoScenario),
    });
    let app: FastifyInstance | null = null;
    try {
      app = await createMemoryTestApp({
        engine,
        sessionControlStore: new InMemorySessionControlStore(),
        recoveryCheckpointCatalog: new LocalRecoveryCheckpointCatalog(
          checkpointDirectory,
        ),
        initializeSecondaryDemo: true,
        adapter: new UnifiedIflytekAdapter({ mode: "mock", environment: {} }),
      });
      const teacherA = await login(app, "teacher-class-a", DEMO_SESSION_ID);
      const teacherB = await login(
        app,
        "teacher-class-b",
        DEMO_SECONDARY_SESSION_ID,
      );
      const studentA = await login(app, "student-team-a", DEMO_SESSION_ID);
      const teacherABinding = binding(teacherA, "teacher");
      const teacherBBinding = binding(teacherB, "teacher");
      const studentABinding = binding(studentA, "student");

      const attempts: DeniedCheckpointAttempt[] = [
        {
          method: "GET" as const,
          url: checkpointUrl(DEMO_SESSION_ID, DEMO_SESSION_ID, studentABinding),
          login: studentA,
        },
        {
          method: "POST" as const,
          url: `/api/training-sessions/${DEMO_SESSION_ID}/recovery-checkpoint`,
          login: studentA,
          payload: {
            authorizationSessionId: DEMO_SESSION_ID,
            bindingId: studentABinding.bindingId,
          },
        },
        {
          method: "GET" as const,
          url: checkpointUrl(
            DEMO_SECONDARY_SESSION_ID,
            DEMO_SESSION_ID,
            teacherABinding,
          ),
          login: teacherA,
        },
        {
          method: "POST" as const,
          url: `/api/training-sessions/${DEMO_SECONDARY_SESSION_ID}/recovery-checkpoint`,
          login: teacherA,
          payload: {
            authorizationSessionId: DEMO_SESSION_ID,
            bindingId: teacherABinding.bindingId,
          },
        },
        {
          method: "GET" as const,
          url: checkpointUrl(
            DEMO_SESSION_ID,
            DEMO_SECONDARY_SESSION_ID,
            teacherBBinding,
          ),
          login: teacherB,
        },
        {
          method: "POST" as const,
          url: `/api/training-sessions/${DEMO_SESSION_ID}/recovery-checkpoint`,
          login: teacherB,
          payload: {
            authorizationSessionId: DEMO_SECONDARY_SESSION_ID,
            bindingId: teacherBBinding.bindingId,
          },
        },
      ];

      for (const attempt of attempts) {
        const response = await app.inject({
          method: attempt.method,
          url: attempt.url,
          headers: requestHeaders(attempt.login, attempt.method === "POST"),
          ...(attempt.payload ? { payload: attempt.payload } : {}),
        });
        expect(response.statusCode).toBe(403);
      }
    } finally {
      await app?.close();
      await rm(checkpointDirectory, { recursive: true, force: true });
    }
  }, 20_000);

  it("keeps the last-good local checkpoint when an API write is malformed", async () => {
    const checkpointDirectory = await mkdtemp(
      resolve(tmpdir(), "ronggang-v092-last-good-"),
    );
    const engine = new WorldEngine({
      store: new InMemoryEventStore(),
      bus: new InProcessMessageBus(),
      scenario: structuredClone(demoScenario),
    });
    const sessionControlStore = new InMemorySessionControlStore();
    const localCatalog = new LocalRecoveryCheckpointCatalog(checkpointDirectory);
    const catalog = new RejectingBadWriteCatalog(localCatalog);
    let app: FastifyInstance | null = null;
    try {
      app = await createMemoryTestApp({
        engine,
        sessionControlStore,
        recoveryCheckpointCatalog: catalog,
        initializeSecondaryDemo: true,
        adapter: new UnifiedIflytekAdapter({ mode: "mock", environment: {} }),
      });
      const teacherA = await login(app, "teacher-class-a", DEMO_SESSION_ID);
      const teacherABinding = binding(teacherA, "teacher");
      const lastGood = await localCatalog.loadLatest(DEMO_SESSION_ID);
      expect(lastGood).not.toBeNull();
      const filesBefore = (await readdir(checkpointDirectory)).sort();

      const session = await sessionControlStore.getSession(DEMO_SESSION_ID);
      if (!session) throw new Error("缺少 A 会话控制记录");
      await sessionControlStore.compareAndSetSessionStatus({
        sessionId: session.sessionId,
        expectedStatus: "active",
        expectedStatusVersion: session.statusVersion,
        nextStatus: "paused",
        updatedAt: new Date().toISOString(),
      });
      catalog.rejectNext = true;

      const rejected = await app.inject({
        method: "POST",
        url: `/api/training-sessions/${DEMO_SESSION_ID}/recovery-checkpoint`,
        headers: requestHeaders(teacherA, true),
        payload: {
          authorizationSessionId: DEMO_SESSION_ID,
          bindingId: teacherABinding.bindingId,
        },
      });
      expect(rejected.statusCode).toBe(409);
      expect(rejected.json()).toMatchObject({
        code: "checkpoint_tampered",
      });

      const after = await localCatalog.loadLatest(DEMO_SESSION_ID);
      expect(after).toEqual(lastGood);
      expect((await readdir(checkpointDirectory)).sort()).toEqual(filesBefore);
    } finally {
      await app?.close();
      await rm(checkpointDirectory, { recursive: true, force: true });
    }
  }, 20_000);

  it("writes a final checkpoint for a session created after startup", async () => {
    const dataDir = await mkdtemp(resolve(tmpdir(), "ronggang-v093-dynamic-"));
    let app: FastifyInstance | null = null;
    try {
      app = await createPersistentApp(dataDir);
      const teacher = await login(app, "teacher-class-a", DEMO_SESSION_ID);
      const teacherBinding = binding(teacher, "teacher");
      const scenario = await app.inject({
        method: "GET",
        url: "/api/scenario/demo",
      });
      expect(scenario.statusCode).toBe(200);
      const created = await app.inject({
        method: "POST",
        url: "/api/training-sessions",
        headers: requestHeaders(teacher, true),
        payload: {
          authorizationSessionId: DEMO_SESSION_ID,
          bindingId: teacherBinding.bindingId,
          requestId: "v093-dynamic-shutdown-checkpoint",
          classroomId: "classroom-local-tourism-a",
          teamId: "team-local-tourism-a",
          releaseId: scenario.json().release.releaseId,
        },
      });
      expect(created.statusCode).toBe(200);
      const sessionId = created.json().sessionId as string;
      await app.close();
      app = null;

      const checkpoint = await new LocalRecoveryCheckpointCatalog(
        resolve(dataDir, "recovery-checkpoints"),
      ).loadLatest(sessionId);
      expect(checkpoint).toMatchObject({
        sessionId,
      });
      expect(checkpoint?.payload).toMatchObject({
        schema: "ronggang.session-recovery-integrity.v2",
      });
    } finally {
      await app?.close();
      await rm(dataDir, { recursive: true, force: true });
    }
  }, persistentRuntimeTestTimeoutMs);

  it("restores a verified full DATA_DIR backup into a fresh active runtime", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "ronggang-v093-restore-"));
    const sourceDataDir = resolve(root, "source-data");
    const backupRoot = resolve(root, "backups");
    const restoredDataDir = resolve(root, "restored-data");
    let restored: FastifyInstance | null = null;
    try {
      await seedAndClose(sourceDataDir);
      const backup = await createVerifiedLocalDataBackup({
        dataDir: sourceDataDir,
        backupRoot,
        now: () => "2026-07-26T09:00:00.000Z",
      });
      expect(backup.manifest.files.map((file) => file.path)).toEqual(
        expect.arrayContaining([
          "role-memory.jsonl",
          "scenario-catalog.jsonl",
          "session-control.jsonl",
        ]),
      );
      await restoreVerifiedLocalDataBackup({
        backupPath: backup.backupPath,
        targetDataDir: restoredDataDir,
      });

      restored = await createPersistentApp(restoredDataDir);
      await expectSessionStatuses(restoredDataDir, {
        a: "active",
        b: "active",
      });
      const latestA = await new LocalRecoveryCheckpointCatalog(
        resolve(restoredDataDir, "recovery-checkpoints"),
      ).loadLatest(DEMO_SESSION_ID);
      expect(latestA?.payload).toMatchObject({
        schema: "ronggang.session-recovery-integrity.v2",
      });
    } finally {
      await restored?.close();
      await rm(root, { recursive: true, force: true });
    }
  }, backupRestoreTestTimeoutMs);
});
