import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { emptyFieldModelLedger, InMemoryFieldModelAttemptStore, JsonFileFieldModelAttemptStore, type FieldModelAttempt } from "../src/field-model-attempt-store.js";

const temporaryRoot = fileURLToPath(new URL("../../../.local/", import.meta.url));
const directories: string[] = [];
afterEach(async () => {
  for (const path of directories.splice(0)) {
    const child = relative(temporaryRoot, resolve(path));
    if (!child || child.startsWith("..") || isAbsolute(child)) throw new Error("test cleanup outside workspace temporary root");
    await rm(path, { recursive: true, force: true });
  }
});
const now = "2026-09-11T00:00:00.000Z";
const started = (): FieldModelAttempt => ({
  attemptId: "attempt-first", sessionId: "attempt-session", actorId: "student-a", bindingId: "binding-a", requestId: "request-first",
  requestHash: "1".repeat(64), lessonHash: "2".repeat(64), inputHash: "3".repeat(64), outputHash: null, status: "started", called: null,
  reservedCostMicros: 10_000, costMicros: null, traceRef: null, failureCode: null, decision: null, retrievedCitationIds: [],
  commitStatus: "pending", eventId: null, commitFailureCode: null, startedAt: now, settledAt: null, updatedAt: now,
});

describe("durable field model attempt ledger", () => {
  it("keeps an unresolved reservation on disk, then settles and links it without creating a second attempt", async () => {
    await mkdir(temporaryRoot, { recursive: true });
    const path = await mkdtemp(resolve(temporaryRoot, "field-attempt-store-"));
    directories.push(path);
    const first = new JsonFileFieldModelAttemptStore(path), attempt = started();
    const reserved = { ...emptyFieldModelLedger(attempt.sessionId), revision: 1, attempts: [attempt] };
    await first.save(reserved, 0);
    const restarted = new JsonFileFieldModelAttemptStore(path);
    expect(await restarted.load(attempt.sessionId)).toEqual(reserved);
    expect(await restarted.list()).toEqual([reserved]);
    const settled = { ...reserved, revision: 2, attempts: [{ ...attempt, status: "succeeded" as const, called: true, costMicros: 19, traceRef: "paid-trace", outputHash: "4".repeat(64), settledAt: now,
      decision: { kind: "question" as const, topicId: "chen-evidence", choiceId: null } }] };
    await restarted.save(settled, 1);
    const committed = { ...settled, revision: 3, attempts: [{ ...settled.attempts[0]!, commitStatus: "committed" as const, eventId: "field-world-event" }] };
    await restarted.save(committed, 2);
    expect((await new JsonFileFieldModelAttemptStore(path).load(attempt.sessionId)).attempts).toEqual(committed.attempts);
  });

  it("rejects a stale write, erased attempt, changed owner or rewritten settled bill", async () => {
    const store = new InMemoryFieldModelAttemptStore(), attempt = started();
    const first = { ...emptyFieldModelLedger(attempt.sessionId), revision: 1, attempts: [attempt] };
    await store.save(first, 0);
    await expect(store.save({ ...first, revision: 2 }, 0)).rejects.toThrow("修订冲突");
    await expect(store.save({ ...first, revision: 2, attempts: [] }, 1)).rejects.toThrow("不能删除");
    await expect(store.save({ ...first, revision: 2, attempts: [{ ...attempt, actorId: "other-student" }] }, 1)).rejects.toThrow("来源");
    const settled = { ...first, revision: 2, attempts: [{ ...attempt, status: "failed" as const, called: true, costMicros: 12, failureCode: "model_failed", settledAt: now }] };
    await store.save(settled, 1);
    await expect(store.save({ ...settled, revision: 3, attempts: [{ ...settled.attempts[0]!, costMicros: 0 }] }, 2)).rejects.toThrow("已结算");
  });
});
