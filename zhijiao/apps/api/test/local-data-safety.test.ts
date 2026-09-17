import { spawn } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  rmdir,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openPGliteContentStore } from "@ronggang/content-store";
import { afterEach, describe, expect, it } from "vitest";
import {
  LocalDataBackupError,
  assertRestorableBackupProductVersion,
  createVerifiedLocalDataBackup,
  prepareVerifiedCheckpointRebaseline,
  restoreVerifiedLocalDataBackup,
  verifyLocalDataBackup,
} from "../src/local-data-backup.js";
import {
  LocalDataDirectoryLeaseError,
  acquireLocalDataDirectoryLease,
  inspectLocalDataDirectoryLease,
  recoverStaleLocalDataDirectoryLease,
} from "../src/local-data-directory-lease.js";
import {
  LocalContentAddressedObjectStore,
  collectRecoveryObjectSourceRefs,
  inspectReferencedObjectIntegrity,
  sha256,
} from "../src/local-object-store.js";
import {
  createMessageMeta,
  type StateProjection,
  type WorldEvent,
} from "@ronggang/contracts";
import { demoScenario } from "@ronggang/world-core";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const path of temporaryDirectories.splice(0)) {
    await rm(path, { recursive: true, force: true });
  }
});

async function childLeaseAttempt(dataDir: string): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}> {
  const moduleUrl = pathToFileURL(
    resolve("src/local-data-directory-lease.ts"),
  ).href;
  const script = [
    `const module = await import(${JSON.stringify(moduleUrl)});`,
    "try {",
    "  const lease = await module.acquireLocalDataDirectoryLease({",
    "    dataDir: process.env.TEST_DATA_DIR,",
    "    purpose: 'api-runtime',",
    "  });",
    "  await lease.release();",
    "  process.stdout.write('acquired');",
    "} catch (error) {",
    "  process.stdout.write(String(error.code ?? error.name));",
    "  process.exitCode = 23;",
    "}",
  ].join("\n");
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "--eval", script],
    {
      cwd: resolve("."),
      env: {
        ...process.env,
        TEST_DATA_DIR: dataDir,
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const code = await new Promise<number | null>((resolvePromise, reject) => {
    child.once("error", reject);
    child.once("exit", resolvePromise);
  });
  return { code, stdout, stderr };
}

async function leaveCrashedChildLease(dataDir: string): Promise<number | null> {
  const moduleUrl = pathToFileURL(
    resolve("src/local-data-directory-lease.ts"),
  ).href;
  const script = [
    `const module = await import(${JSON.stringify(moduleUrl)});`,
    "await module.acquireLocalDataDirectoryLease({",
    "  dataDir: process.env.TEST_DATA_DIR,",
    "  purpose: 'api-runtime',",
    "});",
    "process.exit(0);",
  ].join("\n");
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "--eval", script],
    {
      cwd: resolve("."),
      env: {
        ...process.env,
        TEST_DATA_DIR: dataDir,
      },
      stdio: "ignore",
      windowsHide: true,
    },
  );
  return new Promise<number | null>((resolvePromise, reject) => {
    child.once("error", reject);
    child.once("exit", resolvePromise);
  });
}

describe("local single-writer lease and offline backup", () => {
  it("preserves empty database directories through a verified offline backup", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "ronggang-empty-dirs-"));
    temporaryDirectories.push(root);
    const source = resolve(root, "source");
    await mkdir(resolve(source, "content-library", "pg_subtrans"), { recursive: true });
    await mkdir(resolve(source, "content-library", "pg_tblspc"), { recursive: true });
    await writeFile(resolve(source, "content-library", "PG_VERSION"), "17\n");
    const backup = await createVerifiedLocalDataBackup({ dataDir: source, backupRoot: resolve(root, "backups") });
    const restored = resolve(root, "restored");
    await restoreVerifiedLocalDataBackup({ backupPath: backup.backupPath, targetDataDir: restored });
    expect((await stat(resolve(restored, "content-library", "pg_subtrans"))).isDirectory()).toBe(true);
    expect((await stat(resolve(restored, "content-library", "pg_tblspc"))).isDirectory()).toBe(true);
    await rmdir(resolve(backup.backupPath, "payload", "content-library", "pg_subtrans"));
    await expect(verifyLocalDataBackup(backup.backupPath)).rejects.toMatchObject({ code: "backup_invalid" });
  });
  it("reopens real SQL and reads its records after offline backup and restore", async () => {
    const temporaryRoot = fileURLToPath(new URL("../../../.local/", import.meta.url));
    await mkdir(temporaryRoot, { recursive: true });
    const root = await mkdtemp(resolve(temporaryRoot, "sql-backup-"));
    temporaryDirectories.push(root);
    const source = resolve(root, "source");
    await mkdir(source, { recursive: true });
    const store = await openPGliteContentStore(resolve(source, "content-library"));
    try {
      await store.upsertSourceDocument({ sourceId: "sql-backup-proof", kind: "official", title: "真实SQL恢复回归", publisher: "工程测试" });
    } finally { await store.close(); }
    const backup = await createVerifiedLocalDataBackup({ dataDir: source, backupRoot: resolve(root, "backups") });
    expect(backup.manifest.formatVersion).toBe(2);
    const restored = resolve(root, "restored");
    await restoreVerifiedLocalDataBackup({ backupPath: backup.backupPath, targetDataDir: restored });
    const reopened = await openPGliteContentStore(resolve(restored, "content-library"));
    try { expect((await reopened.getSourceDocument("sql-backup-proof"))?.title).toBe("真实SQL恢复回归"); }
    finally { await reopened.close(); }
  }, 60_000);
  it("accepts only the declared backward restore window", () => {
    expect(() => assertRestorableBackupProductVersion("1.0.0", "2.6.0")).not.toThrow();
    expect(() => assertRestorableBackupProductVersion("2.6.0", "1.0.0")).toThrow(/恢复窗口/u);
    expect(() => assertRestorableBackupProductVersion("0.9.3", "1.0.0"))
      .not.toThrow();
    expect(() => assertRestorableBackupProductVersion("0.9.4", "1.0.0"))
      .not.toThrow();
    expect(() => assertRestorableBackupProductVersion("1.0.0", "1.0.0"))
      .not.toThrow();
    expect(() => assertRestorableBackupProductVersion("0.9.2", "1.0.0"))
      .toThrow(/恢复窗口/u);
    expect(() => assertRestorableBackupProductVersion("0.9.5", "1.0.0"))
      .toThrow(/恢复窗口/u);
    expect(() => assertRestorableBackupProductVersion("0.9.99", "1.0.0"))
      .toThrow(/恢复窗口/u);
    expect(() => assertRestorableBackupProductVersion("1.0.1", "1.0.0"))
      .toThrow(/恢复窗口/u);
    expect(() => assertRestorableBackupProductVersion("not-semver", "1.0.0"))
      .toThrow(/语义版本/u);
  });

  it("rejects a second real Node process for the same DATA_DIR", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "ronggang-lease-"));
    temporaryDirectories.push(root);
    const dataDir = resolve(root, "data");
    const lease = await acquireLocalDataDirectoryLease({
      dataDir,
      purpose: "api-runtime",
    });
    try {
      const child = await childLeaseAttempt(dataDir);
      expect(child.code).toBe(23);
      expect(child.stdout).toBe("lease_active");
      expect(child.stderr).toBe("");
      await expect(inspectLocalDataDirectoryLease(dataDir)).resolves
        .toMatchObject({
          status: "held",
          owner: {
            pid: process.pid,
            purpose: "api-runtime",
            processAlive: true,
          },
        });
    } finally {
      await lease.release();
    }
    await expect(inspectLocalDataDirectoryLease(dataDir)).resolves
      .toMatchObject({ status: "available" });
  }, 15_000);

  it("keeps a crashed writer fenced until explicit stale-lease recovery", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "ronggang-stale-lease-"));
    temporaryDirectories.push(root);
    const dataDir = resolve(root, "data");
    expect(await leaveCrashedChildLease(dataDir)).toBe(0);
    await expect(inspectLocalDataDirectoryLease(dataDir)).resolves
      .toMatchObject({
        status: "held",
        owner: {
          processAlive: false,
        },
      });
    await expect(acquireLocalDataDirectoryLease({
      dataDir,
      purpose: "api-runtime",
    })).rejects.toMatchObject({ code: "lease_active" });

    await recoverStaleLocalDataDirectoryLease(dataDir);
    const lease = await acquireLocalDataDirectoryLease({
      dataDir,
      purpose: "api-runtime",
    });
    await lease.release();
  }, 15_000);

  it("treats a junction or symlink alias as the same leased DATA_DIR", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "ronggang-lease-alias-"));
    temporaryDirectories.push(root);
    const dataDir = resolve(root, "data");
    const alias = resolve(root, "data-alias");
    await mkdir(dataDir, { recursive: true });
    try {
      await symlink(
        dataDir,
        alias,
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") return;
      throw error;
    }
    const lease = await acquireLocalDataDirectoryLease({
      dataDir,
      purpose: "api-runtime",
    });
    try {
      const child = await childLeaseAttempt(alias);
      expect(child.code).toBe(23);
      expect(child.stdout).toBe("lease_active");
    } finally {
      await lease.release();
    }
  }, 15_000);

  it("creates, verifies, and restores an exact offline backup without secrets or temp files", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "ronggang-backup-"));
    temporaryDirectories.push(root);
    const dataDir = resolve(root, "data");
    const backupRoot = resolve(root, "backups");
    const targetDataDir = resolve(root, "restored");
    await mkdir(resolve(dataDir, "objects", "session-a"), {
      recursive: true,
    });
    await Promise.all([
      writeFile(
        resolve(dataDir, "session-control.jsonl"),
        "{\"sequence\":1}\n",
        "utf8",
      ),
      writeFile(
        resolve(dataDir, "role-memory.jsonl"),
        "{\"kind\":\"role_memory_delta\"}\n",
        "utf8",
      ),
      writeFile(
        resolve(dataDir, "objects", "session-a", "blob.blob"),
        Buffer.from("object-body"),
      ),
      writeFile(resolve(dataDir, ".env.local"), "SECRET=canary\n", "utf8"),
      writeFile(resolve(dataDir, ".tmp-orphan"), "partial", "utf8"),
    ]);

    const backup = await createVerifiedLocalDataBackup({
      dataDir,
      backupRoot,
      now: () => "2026-07-26T08:00:00.000Z",
    });
    expect(backup.manifest.files.map((file) => file.path)).toEqual([
      "objects/session-a/blob.blob",
      "role-memory.jsonl",
      "session-control.jsonl",
    ]);
    expect(JSON.stringify(backup.manifest)).not.toContain("SECRET=canary");
    await expect(verifyLocalDataBackup(backup.backupPath)).resolves
      .toMatchObject({ manifestHash: backup.manifestHash });

    await restoreVerifiedLocalDataBackup({
      backupPath: backup.backupPath,
      targetDataDir,
    });
    await expect(readFile(
      resolve(targetDataDir, "objects", "session-a", "blob.blob"),
      "utf8",
    )).resolves.toBe("object-body");
    await expect(readFile(
      resolve(targetDataDir, "role-memory.jsonl"),
      "utf8",
    )).resolves.toBe("{\"kind\":\"role_memory_delta\"}\n");
    await expect(readFile(
      resolve(targetDataDir, ".env.local"),
      "utf8",
    )).rejects.toMatchObject({ code: "ENOENT" });

    await expect(restoreVerifiedLocalDataBackup({
      backupPath: backup.backupPath,
      targetDataDir,
    })).rejects.toBeInstanceOf(LocalDataBackupError);

    const racedTarget = resolve(root, "restored-race");
    const raced = await Promise.allSettled([
      restoreVerifiedLocalDataBackup({
        backupPath: backup.backupPath,
        targetDataDir: racedTarget,
      }),
      restoreVerifiedLocalDataBackup({
        backupPath: backup.backupPath,
        targetDataDir: racedTarget,
      }),
    ]);
    expect(raced.filter((result) => result.status === "fulfilled"))
      .toHaveLength(1);
    expect(raced.filter((result) => result.status === "rejected"))
      .toHaveLength(1);
    await expect(readFile(
      resolve(racedTarget, "role-memory.jsonl"),
      "utf8",
    )).resolves.toBe("{\"kind\":\"role_memory_delta\"}\n");
  });

  it("refuses offline backup while the API lease is active and detects payload tampering", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "ronggang-backup-fault-"));
    temporaryDirectories.push(root);
    const dataDir = resolve(root, "data");
    const backupRoot = resolve(root, "backups");
    await mkdir(dataDir, { recursive: true });
    await writeFile(resolve(dataDir, "world.jsonl"), "stable\n", "utf8");
    const lease = await acquireLocalDataDirectoryLease({
      dataDir,
      purpose: "api-runtime",
    });
    try {
      await expect(createVerifiedLocalDataBackup({
        dataDir,
        backupRoot,
      })).rejects.toMatchObject({
        code: "lease_active",
      } satisfies Partial<LocalDataDirectoryLeaseError>);
    } finally {
      await lease.release();
    }

    const backup = await createVerifiedLocalDataBackup({
      dataDir,
      backupRoot,
      now: () => "2026-07-26T08:01:00.000Z",
    });
    await writeFile(
      resolve(backup.backupPath, "payload", "world.jsonl"),
      "tampered\n",
      "utf8",
    );
    await expect(verifyLocalDataBackup(backup.backupPath)).rejects
      .toMatchObject({ code: "backup_invalid" });
  });

  it("rebaselines versioned recovery projections only after an exact verified backup match", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "ronggang-checkpoint-upgrade-"));
    temporaryDirectories.push(root);
    const dataDir = resolve(root, "data");
    const backupRoot = resolve(root, "backups");
    await mkdir(resolve(dataDir, "recovery-checkpoints"), { recursive: true });
    await Promise.all([
      writeFile(resolve(dataDir, "world.jsonl"), "stable-world\n", "utf8"),
      writeFile(
        resolve(dataDir, "recovery-checkpoints", "session-a.checkpoint.json"),
        "{\"payloadHash\":\"legacy\"}\n",
        "utf8",
      ),
    ]);
    const backup = await createVerifiedLocalDataBackup({
      dataDir,
      backupRoot,
      now: () => "2026-09-01T08:00:00.000Z",
    });
    const prepared = await prepareVerifiedCheckpointRebaseline({
      dataDir,
      backupPath: backup.backupPath,
      now: () => "2026-09-01T08:01:00.000Z",
    });
    expect(prepared).toMatchObject({
      status: "prepared",
      fromProductVersion: backup.manifest.productVersion,
      backupManifestHash: backup.manifestHash,
      checkpointFileCount: 1,
    });
    await expect(readFile(
      resolve(dataDir, "recovery-checkpoints", "session-a.checkpoint.json"),
      "utf8",
    )).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(
      resolve(prepared.archivedDirectory, "session-a.checkpoint.json"),
      "utf8",
    )).resolves.toContain("legacy");
    await expect(readFile(prepared.markerPath, "utf8")).resolves
      .toContain(backup.manifestHash);

    const mismatchedData = resolve(root, "mismatched-data");
    await mkdir(resolve(mismatchedData, "recovery-checkpoints"), {
      recursive: true,
    });
    await Promise.all([
      writeFile(resolve(mismatchedData, "world.jsonl"), "tampered-world\n"),
      writeFile(
        resolve(
          mismatchedData,
          "recovery-checkpoints",
          "session-a.checkpoint.json",
        ),
        "{\"payloadHash\":\"legacy\"}\n",
      ),
    ]);
    await expect(prepareVerifiedCheckpointRebaseline({
      dataDir: mismatchedData,
      backupPath: backup.backupPath,
    })).rejects.toMatchObject({ code: "backup_invalid" });
    await expect(readFile(
      resolve(
        mismatchedData,
        "recovery-checkpoints",
        "session-a.checkpoint.json",
      ),
      "utf8",
    )).resolves.toContain("legacy");
  });

  it("rejects a DATA_DIR containing the reserved restore-owner marker", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "ronggang-backup-owner-"));
    temporaryDirectories.push(root);
    const dataDir = resolve(root, "data");
    await mkdir(dataDir, { recursive: true });
    await Promise.all([
      writeFile(resolve(dataDir, "world.jsonl"), "stable\n", "utf8"),
      writeFile(
        resolve(dataDir, ".ronggang-restore-owner.json"),
        "{\"schema\":\"forged\"}\n",
        "utf8",
      ),
    ]);

    await expect(createVerifiedLocalDataBackup({
      dataDir,
      backupRoot: resolve(root, "backups"),
    })).rejects.toMatchObject({ code: "backup_invalid" });
  });

  it("rejects a backup-root alias that physically resolves inside DATA_DIR", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "ronggang-backup-alias-"));
    temporaryDirectories.push(root);
    const dataDir = resolve(root, "data");
    const nestedBackupRoot = resolve(dataDir, "nested-backups");
    const alias = resolve(root, "backup-alias");
    await mkdir(nestedBackupRoot, { recursive: true });
    await writeFile(resolve(dataDir, "world.jsonl"), "stable\n", "utf8");
    try {
      await symlink(
        nestedBackupRoot,
        alias,
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") return;
      throw error;
    }

    await expect(createVerifiedLocalDataBackup({
      dataDir,
      backupRoot: alias,
    })).rejects.toMatchObject({ code: "backup_invalid" });
  });

  it("verifies referenced object bodies and rejects same-size local corruption", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "ronggang-object-integrity-"));
    temporaryDirectories.push(root);
    const objectRoot = resolve(root, "objects");
    const store = new LocalContentAddressedObjectStore(objectRoot);
    const bytes = Buffer.from("original-object");
    const contentHash = sha256(bytes);
    const stored = await store.put({
      sessionId: "session-a",
      bytes,
      contentHash,
    });
    await expect(inspectReferencedObjectIntegrity({
      objectStore: store,
      sessionId: "session-a",
      sourceRefs: [stored.sourceRef],
    })).resolves.toMatchObject({
      count: 1,
    });
    if (process.platform !== "win32") {
      const blobPath = resolve(
        objectRoot,
        "session-a",
        `${contentHash}.blob`,
      );
      await chmod(blobPath, 0o644);
      await expect(store.get(stored.sourceRef)).resolves.toEqual(bytes);
      expect((await stat(blobPath)).mode & 0o777).toBe(0o600);
    }

    await writeFile(
      resolve(objectRoot, "session-a", `${contentHash}.blob`),
      Buffer.from("tampered-object"),
    );
    expect(Buffer.byteLength("tampered-object")).toBe(bytes.length);
    await expect(store.get(stored.sourceRef)).rejects
      .toThrow(/哈希不匹配/u);
    await expect(store.put({
      sessionId: "session-a",
      bytes,
      contentHash,
    })).rejects.toThrow(/不同对象正文/u);
  });

  it("extracts only typed object-reference fields and rejects typed cross-session refs", async () => {
    const freeTextCrossSession = `object://session-b/${"a".repeat(64)}`;
    const projection = {
      materials: [],
      mediaProcessingTasks: [],
      governanceFindings: [],
      facts: [],
      roleMessages: [{
        content: freeTextCrossSession,
        sourceRefs: [],
      }],
      pendingCandidates: [],
      candidateHistory: [],
    } as unknown as StateProjection;
    expect(collectRecoveryObjectSourceRefs({
      scenario: structuredClone(demoScenario),
      projection,
      mediaWorkItems: [],
      events: [],
    })).toEqual([]);

    const historicalRef = `object://session-a/${"b".repeat(64)}`;
    const historicalObservation = {
      ...createMessageMeta({
        sessionId: "session-a",
        sceneId: demoScenario.scenarioId,
        actorId: "agent-fact-a",
        correlationId: "corr-history",
        timestamp: "2026-07-26T08:10:00.000Z",
      }),
      kind: "Observation" as const,
      observationId: "observation-history",
      materialId: "material-history",
      mediaType: "image" as const,
      provider: "iflytek-unified-adapter",
      providerMode: "mock" as const,
      summary: "历史观察",
      extracted: {},
      sourceRef: historicalRef,
      confidence: 0.9,
    };
    expect(collectRecoveryObjectSourceRefs({
      scenario: structuredClone(demoScenario),
      projection,
      mediaWorkItems: [],
      events: [{
        eventType: "material_observed",
        payload: { observation: historicalObservation },
      } as unknown as WorldEvent],
    })).toContain(historicalRef);
    expect(collectRecoveryObjectSourceRefs({
      scenario: structuredClone(demoScenario),
      projection,
      mediaWorkItems: [],
      events: [{
        eventType: "governance_review_arbitrated",
        payload: {},
      } as unknown as WorldEvent],
    })).toEqual([]);

    projection.roleMessages[0]!.content = "object://not-a-valid-reference";
    projection.roleMessages[0]!.sourceRefs = ["object://not-a-valid-reference"];
    const malformedTyped = collectRecoveryObjectSourceRefs({
      scenario: structuredClone(demoScenario),
      projection,
      mediaWorkItems: [],
      events: [],
    });
    await expect(inspectReferencedObjectIntegrity({
      objectStore: new LocalContentAddressedObjectStore(
        resolve(tmpdir(), "unused-object-store"),
      ),
      sessionId: "session-a",
      sourceRefs: malformedTyped,
    })).rejects.toThrow(/引用无效/u);

    projection.roleMessages[0]!.sourceRefs = [freeTextCrossSession];
    await expect(inspectReferencedObjectIntegrity({
      objectStore: new LocalContentAddressedObjectStore(
        resolve(tmpdir(), "unused-object-store"),
      ),
      sessionId: "session-a",
      sourceRefs: collectRecoveryObjectSourceRefs({
        scenario: structuredClone(demoScenario),
        projection,
        mediaWorkItems: [],
        events: [],
      }),
    })).rejects.toThrow(/跨会话/u);
  });

  it("rejects a junction or symlink used as an object-session directory", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "ronggang-object-link-"));
    temporaryDirectories.push(root);
    const objectRoot = resolve(root, "objects");
    const external = resolve(root, "external");
    await Promise.all([
      mkdir(objectRoot, { recursive: true }),
      mkdir(external, { recursive: true }),
    ]);
    const bytes = Buffer.from("linked-object");
    const contentHash = sha256(bytes);
    await writeFile(resolve(external, `${contentHash}.blob`), bytes);
    try {
      await symlink(
        external,
        resolve(objectRoot, "session-a"),
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") return;
      throw error;
    }
    const store = new LocalContentAddressedObjectStore(objectRoot);

    await expect(store.get(
      `object://session-a/${contentHash}`,
    )).rejects.toThrow(/符号链接/u);
  });

  it("keeps backup and restored plaintext private on POSIX", async () => {
    if (process.platform === "win32") return;
    const root = await mkdtemp(resolve(tmpdir(), "ronggang-private-backup-"));
    temporaryDirectories.push(root);
    const dataDir = resolve(root, "data");
    const backupRoot = resolve(root, "backups");
    const restored = resolve(root, "restored");
    await mkdir(dataDir, { recursive: true });
    await writeFile(resolve(dataDir, "role-memory.jsonl"), "private\n");

    const backup = await createVerifiedLocalDataBackup({
      dataDir,
      backupRoot,
    });
    await restoreVerifiedLocalDataBackup({
      backupPath: backup.backupPath,
      targetDataDir: restored,
    });

    expect((await stat(restored)).mode & 0o777).toBe(0o700);
    expect(
      (await stat(resolve(restored, "role-memory.jsonl"))).mode & 0o777,
    ).toBe(0o600);
    expect(
      (
        await stat(resolve(
          backup.backupPath,
          "payload",
          "role-memory.jsonl",
        ))
      ).mode & 0o777,
    ).toBe(0o600);
  });
});
