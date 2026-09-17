import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  LocalRecoveryCheckpointCatalog,
  RECOVERY_CHECKPOINT_SCHEMA,
  RECOVERY_CHECKPOINT_VERSION,
  SessionControlError,
  computeRecoveryCheckpointPayloadHash,
  createRecoveryCheckpoint,
  verifyRecoveryCheckpoint,
  type RecoveryCheckpoint,
} from "../src/index.js";

const createdAt = "2026-07-26T08:00:00.000Z";

function checkpoint(
  overrides: Partial<Parameters<typeof createRecoveryCheckpoint>[0]> = {},
): RecoveryCheckpoint {
  return createRecoveryCheckpoint({
    sessionId: "session-tourism-a",
    sourceRevision: 4,
    sourceSequence: 27,
    createdAt,
    payload: {
      world: { weather: "clear", location: "old-town" },
      roles: ["reporter", "editor"],
    },
    ...overrides,
  });
}

async function temporaryCatalog(): Promise<{
  directory: string;
  catalog: LocalRecoveryCheckpointCatalog;
}> {
  const directory = await mkdtemp(join(tmpdir(), "ronggang-checkpoint-"));
  return {
    directory,
    catalog: new LocalRecoveryCheckpointCatalog(directory),
  };
}

function isCheckpointError(code: SessionControlError["code"]) {
  return (error: unknown): boolean => (
    error instanceof SessionControlError && error.code === code
  );
}

describe("recovery checkpoint contract", () => {
  it("produces the same SHA-256 hash for canonically equivalent payloads", () => {
    const left = {
      z: [{ b: true, a: 1 }],
      a: { nested: "value", count: 2 },
    };
    const right = {
      a: { count: 2, nested: "value" },
      z: [{ a: 1, b: true }],
    };

    assert.equal(
      computeRecoveryCheckpointPayloadHash(left),
      computeRecoveryCheckpointPayloadHash(right),
    );
    assert.match(computeRecoveryCheckpointPayloadHash(left), /^[a-f0-9]{64}$/u);
  });

  it("creates a versioned envelope and returns a detached verified value", () => {
    const originalPayload = { nested: { value: 1 } };
    const created = checkpoint({ payload: originalPayload });
    originalPayload.nested.value = 99;

    assert.equal(created.schema, RECOVERY_CHECKPOINT_SCHEMA);
    assert.equal(created.version, RECOVERY_CHECKPOINT_VERSION);
    assert.equal(created.payloadHash, computeRecoveryCheckpointPayloadHash({
      nested: { value: 1 },
    }));

    const verified = verifyRecoveryCheckpoint(created, created.sessionId);
    (verified.payload as { nested: { value: number } }).nested.value = 2;
    assert.deepEqual(created.payload, { nested: { value: 1 } });
  });

  it("explicitly rejects tampering, cross-session use, and unsupported versions", () => {
    const created = checkpoint();

    assert.throws(
      () => verifyRecoveryCheckpoint({
        ...created,
        payload: { world: { location: "tampered" } },
      }),
      isCheckpointError("checkpoint_tampered"),
    );
    assert.throws(
      () => verifyRecoveryCheckpoint(created, "session-tourism-b"),
      isCheckpointError("checkpoint_session_mismatch"),
    );
    assert.throws(
      () => verifyRecoveryCheckpoint({ ...created, version: 2 }),
      isCheckpointError("checkpoint_version_unsupported"),
    );
  });

  it("rejects payloads that cannot be represented deterministically as JSON", () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;

    assert.throws(
      () => checkpoint({ payload: cyclic }),
      isCheckpointError("checkpoint_invalid"),
    );
    assert.throws(
      () => checkpoint({ payload: { invalid: Number.NaN } }),
      isCheckpointError("checkpoint_invalid"),
    );
    assert.throws(
      () => checkpoint({ payload: { invalid: undefined } }),
      isCheckpointError("checkpoint_invalid"),
    );
  });
});

describe("local recovery checkpoint catalog", () => {
  it("persists immutable checkpoints and loads the latest verified source", async () => {
    const { directory, catalog } = await temporaryCatalog();
    try {
      const first = await catalog.save(checkpoint());
      const second = await catalog.write({
        sessionId: first.sessionId,
        sourceRevision: first.sourceRevision,
        sourceSequence: first.sourceSequence + 1,
        createdAt: "2026-07-26T08:01:00.000Z",
        payload: { world: { location: "festival-square" } },
      });

      assert.deepEqual(await catalog.loadLatest(first.sessionId), second);
      assert.equal(
        (await readdir(directory)).filter((name) => name.endsWith(".checkpoint.json")).length,
        2,
      );
      assert.equal(
        (await readdir(directory)).some((name) => name.includes(first.sessionId)),
        false,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps the last verified checkpoint when a later save is rejected", async () => {
    const { directory, catalog } = await temporaryCatalog();
    try {
      const verified = await catalog.save(checkpoint());
      const tampered = {
        ...checkpoint({
          sourceSequence: verified.sourceSequence + 1,
          payload: { status: "candidate" },
        }),
        payload: { status: "changed-after-hash" },
      };

      await assert.rejects(
        catalog.save(tampered),
        isCheckpointError("checkpoint_tampered"),
      );
      assert.deepEqual(await catalog.loadLatest(verified.sessionId), verified);
      assert.equal(
        (await readdir(directory)).filter((name) => name.endsWith(".checkpoint.json")).length,
        1,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects stale or conflicting source positions without replacing the latest", async () => {
    const { directory, catalog } = await temporaryCatalog();
    try {
      const latest = await catalog.save(checkpoint());
      await assert.rejects(
        catalog.save(checkpoint({
          sourceSequence: latest.sourceSequence - 1,
          payload: { stale: true },
        })),
        isCheckpointError("checkpoint_source_conflict"),
      );
      await assert.rejects(
        catalog.save(checkpoint({
          payload: { sameSource: "different-content" },
        })),
        isCheckpointError("checkpoint_source_conflict"),
      );
      assert.deepEqual(await catalog.loadLatest(latest.sessionId), latest);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("detects on-disk content tampering instead of silently restoring it", async () => {
    const { directory, catalog } = await temporaryCatalog();
    try {
      const saved = await catalog.save(checkpoint());
      const fileName = (await readdir(directory))
        .find((name) => name.endsWith(".checkpoint.json"));
      assert.ok(fileName);
      const path = join(directory, fileName);
      const envelope = JSON.parse(await readFile(path, "utf8")) as RecoveryCheckpoint;
      await writeFile(path, JSON.stringify({
        ...envelope,
        payload: { externally: "tampered" },
      }), "utf8");

      await assert.rejects(
        catalog.loadLatest(saved.sessionId),
        isCheckpointError("checkpoint_tampered"),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("does not let a session identifier escape the configured directory", async () => {
    const { directory, catalog } = await temporaryCatalog();
    try {
      const unsafeSessionId = "../../another-session";
      await catalog.save(checkpoint({ sessionId: unsafeSessionId }));
      const names = await readdir(directory);

      assert.equal(names.length, 1);
      assert.match(
        names[0] ?? "",
        /^[a-f0-9]{64}-r\d{16}-s\d{16}-[a-f0-9]{64}\.checkpoint\.json$/u,
      );
      assert.equal((await catalog.loadLatest(unsafeSessionId))?.sessionId, unsafeSessionId);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
