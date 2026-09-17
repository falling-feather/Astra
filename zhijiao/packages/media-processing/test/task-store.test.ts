import {
  appendFile,
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  InMemoryMediaProcessingWorkStore,
  JsonlMediaProcessingWorkStore,
  MediaProcessingWorkItemSchema,
} from "../src/index.js";

function workItem() {
  return MediaProcessingWorkItemSchema.parse({
    workItemId: "work-1",
    idempotencyKey: "task-1:step-1:attempt:1",
    sessionId: "session-1",
    sessionEpoch: "epoch-1",
    taskId: "task-1",
    stepId: "step-1",
    capability: "ocr",
    attemptNumber: 1,
    inputRef: "object://session-1/hash",
    inputContentHash: "a".repeat(64),
    mediaType: "document",
    status: "queued",
    claimCount: 0,
    lease: null,
    createdAt: "2026-07-25T06:00:00.000Z",
    updatedAt: "2026-07-25T06:00:00.000Z",
    completedAt: null,
    lastErrorCode: null,
  });
}

describe("media processing work stores", () => {
  it("recovers an expired lease and keeps a complete attempt trail", async () => {
    const store = new InMemoryMediaProcessingWorkStore();
    await store.enqueue([workItem()]);
    const first = await store.claimNext({
      sessionId: "session-1",
      sessionEpoch: "epoch-1",
      workerId: "worker-a",
      now: "2026-07-25T06:00:01.000Z",
      leaseDurationMs: 1_000,
      leaseToken: "lease-a",
    });
    expect(first?.status).toBe("running");

    const recovered = await store.claimNext({
      sessionId: "session-1",
      sessionEpoch: "epoch-1",
      workerId: "worker-b",
      now: "2026-07-25T06:00:03.000Z",
      leaseDurationMs: 1_000,
      leaseToken: "lease-b",
    });
    expect(recovered).toMatchObject({
      status: "running",
      claimCount: 2,
      lease: { ownerId: "worker-b" },
    });
    await store.complete({
      workItemId: recovered!.workItemId,
      leaseToken: recovered!.lease!.token,
      workerId: "worker-b",
      finishedAt: "2026-07-25T06:00:03.500Z",
      attemptId: "attempt-complete",
      duplicateSuppressed: false,
    });
    expect((await store.list("session-1"))[0]?.status).toBe("completed");
    expect((await store.listAttempts("session-1")).map((attempt) => (
      attempt.outcome
    ))).toEqual(["lease_expired", "completed"]);
  });

  it("fails closed when one idempotency key is reused for different fixed input", async () => {
    const store = new InMemoryMediaProcessingWorkStore();
    const original = workItem();
    await store.enqueue([original]);
    const collision = MediaProcessingWorkItemSchema.parse({
      ...original,
      inputContentHash: "b".repeat(64),
    });
    await expect(store.enqueue([collision])).rejects.toThrow(
      "固定载荷不一致",
    );
  });

  it("rejects an expired fencing token before a worker can commit authority", async () => {
    const store = new InMemoryMediaProcessingWorkStore();
    await store.enqueue([workItem()]);
    const claimed = await store.claimNext({
      sessionId: "session-1",
      sessionEpoch: "epoch-1",
      workerId: "worker-a",
      now: "2026-07-25T06:00:01.000Z",
      leaseDurationMs: 1_000,
      leaseToken: "lease-a",
    });
    await expect(store.assertCurrentLease({
      workItemId: claimed!.workItemId,
      leaseToken: claimed!.lease!.token,
      workerId: "worker-a",
      now: "2026-07-25T06:00:02.001Z",
    })).rejects.toThrow("租约已过期");
  });

  it("repairs a torn JSONL tail while rejecting no valid snapshot data", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ronggang-media-store-"));
    const path = join(directory, "work.jsonl");
    try {
      const store = new JsonlMediaProcessingWorkStore(path);
      await store.enqueue([workItem()]);
      await appendFile(path, "{\"broken-tail\"", "utf8");

      const reopened = new JsonlMediaProcessingWorkStore(path);
      expect(await reopened.list("session-1")).toHaveLength(1);
      const content = await readFile(path, "utf8");
      expect(content).not.toContain("broken-tail");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
