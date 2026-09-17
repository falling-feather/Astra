import { describe, expect, it, vi } from "vitest";
import type { FieldInterviewActionRequestV1, FieldInterviewActionV1 } from "@ronggang/contracts";
import { buildXunpuFlagshipRuntimeReleaseV3R2, hashCanonical, xunpuExplorationLesson, xunpuFlagshipContentV4 } from "@ronggang/course-content";
import { InMemorySimulationSessionStore, WorldSimulationEngineV3 } from "@ronggang/world-core";
import { FieldInterviewService, type FieldInterviewModel, type FieldInterviewModelInput } from "../src/field-interview-service.js";
import { FieldInterviewModelOutputSchema } from "../src/flagship-model-adapters-v4.js";
import { emptyFieldModelLedger, InMemoryFieldModelAttemptStore, type FieldModelAttemptStore } from "../src/field-model-attempt-store.js";
import { buildFlagshipTraceProjection } from "../src/trace-projection.js";

async function setup(model: FieldInterviewModel, retrieval?: (input: { principalId: string; query: string; knowledgeIds: string[] }) => Promise<FieldInterviewModelInput["evidence"]>, settings: Partial<ConstructorParameters<typeof FieldInterviewService>[0]> = {}) {
  const store = new InMemorySimulationSessionStore();
  const engine = new WorldSimulationEngineV3({ store, fieldLessons: [xunpuExplorationLesson] });
  const sessionId = "field-model-session";
  const release = buildXunpuFlagshipRuntimeReleaseV3R2({ courseId: "course-xunpu-intangible-media", releaseId: "release-field-test", version: 3, contentHash: "a".repeat(64) });
  await engine.startSession({ sessionId, release, challengeAssignment: {
    schemaVersion: "challenge-assignment/3.0.0", challengeAssignmentId: "challenge-field-test", learnerTwinRef: "learner-field-test", sessionId,
    simulationReleaseRef: release.simulationReleaseRef, worldVariantRef: release.challengeVariants.find(variant => variant.challengeLevel === 5)!.worldVariantId,
    previousChallengeLevel: 4, challengeLevel: 5, scoreCeiling: 90, pressureDimensions: [{ dimensionId: "time", intensity: 5 }],
    assignmentReason: "evidence_progression", basisEvidenceRefs: ["test-previous-evidence"], forecastRef: "test-forecast", teacherOverride: null,
    policyVersion: "test-policy/1.0.0", policyContentHash: "b".repeat(64), assignedAt: "2026-09-11T00:00:00.000Z",
  }, targetCompetencyRefs: ["competency-source-verification"], scaffoldingLevel: 1 });
  const service = new FieldInterviewService({ engine, lesson: xunpuExplorationLesson, courseId: release.courseReleaseRef.courseId,
    characterProfiles: xunpuFlagshipContentV4.cast, model, ...(retrieval ? { retrieveEvidence: retrieval } : {}), ...settings });
  let sequence = 0;
  const make = async (action: FieldInterviewActionV1): Promise<FieldInterviewActionRequestV1> => ({
    schemaVersion: "field-interview-action/1.0.0", requestId: `field-model-${++sequence}`, sessionId, bindingId: "binding-a",
    expectedWorldStateVersion: (await engine.getSnapshot(sessionId)).stateVersion, action,
  });
  const act = async (action: FieldInterviewActionV1) => service.perform({ request: await make(action), actorId: "student-a", principalId: "learner-test" });
  return { service, engine, store, sessionId, make, act };
}

describe("field character model boundary", () => {
  it("does not call a provider or write a fallback world when the reservation cannot be persisted", async () => {
    const memory = new InMemoryFieldModelAttemptStore();
    const decide = vi.fn<FieldInterviewModel["decide"]>();
    const s = await setup({ decide }, undefined, { attemptStore: {
      load: session => memory.load(session), list: () => memory.list(), save: async () => { throw new Error("reservation storage unavailable"); },
    } });
    await expect(s.act({ kind: "talk", npcId: "entity-researcher", channel: "chat", text: "怎么比较两份来源？" })).rejects.toThrow("reservation storage unavailable");
    expect(decide).not.toHaveBeenCalled();
    expect((await s.engine.getRecord(s.sessionId)).fieldInterview).toBeUndefined();
  });
  it("keeps a deterministic provider's receipt distinct from a real model call", async () => {
    const s = await setup({ decide: async () => ({ decision: { kind: "question", topicId: "chen-evidence", choiceId: null }, traceRef: "mock-provider", costMicros: 0,
      execution: { provider: "deterministic", model: "fixture-json", mode: "mock", attempts: 1 } }) });
    const result = await s.act({ kind: "talk", npcId: "entity-researcher", channel: "chat", text: "怎么比较两份来源？" });
    expect(result.view.executionMode).toBe("rules");
    expect((await s.service.readModelAttempts(s.sessionId))[0]).toMatchObject({ called: false, costMicros: 0, execution: { mode: "mock" } });
  });
  it("keeps a paid attempt when world commit fails, then reuses its settled result after service recreation", async () => {
    const attemptStore = new InMemoryFieldModelAttemptStore();
    const decide = vi.fn<FieldInterviewModel["decide"]>().mockResolvedValue({ decision: { kind: "question", topicId: "chen-evidence", choiceId: null }, traceRef: "paid-before-conflict", costMicros: 23 });
    const s = await setup({ decide }, undefined, { maximumModelCalls: 1, attemptStore });
    const request = await s.make({ kind: "talk", npcId: "entity-researcher", channel: "chat", text: "怎么比较两份来源？" });
    vi.spyOn(s.engine, "commitFieldInterview").mockRejectedValueOnce(new Error("injected disk write failure"));
    const input = { request, actorId: "student-a", principalId: "learner-test" };
    await expect(s.service.perform(input)).rejects.toThrow("disk write failure");
    const attempts = await s.service.readModelAttempts(s.sessionId);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ called: true, status: "succeeded", costMicros: 23, commitStatus: "rejected", eventId: null });
    const trace = buildFlagshipTraceProjection(await s.engine.getRecord(s.sessionId), null, attempts);
    expect(trace.records).toHaveLength(1);
    expect(trace.records[0]!.summary).toContain("世界提交未成功");
    expect(JSON.stringify(trace)).not.toContain("professionalContext");
    const restarted = new FieldInterviewService(s.service.options);
    await restarted.perform(input);
    expect(decide).toHaveBeenCalledTimes(1);
    expect((await restarted.readModelAttempts(s.sessionId))[0]).toMatchObject({ status: "succeeded", commitStatus: "committed", costMicros: 23 });
  });

  it("reconciles a committed world event after the final ledger write failed", async () => {
    const persisted = new InMemoryFieldModelAttemptStore();
    let fail = true;
    const attemptStore: FieldModelAttemptStore = { load: session => persisted.load(session), list: () => persisted.list(), save: async (ledger, revision) => {
      if (fail && ledger.attempts.some(attempt => attempt.commitStatus === "committed")) throw new Error("injected final receipt failure");
      await persisted.save(ledger, revision);
    } };
    const decide = vi.fn<FieldInterviewModel["decide"]>().mockResolvedValue({ decision: { kind: "question", topicId: "chen-evidence", choiceId: null }, traceRef: "paid-before-receipt-failure", costMicros: 13 });
    const s = await setup({ decide }, undefined, { attemptStore });
    const input = { request: await s.make({ kind: "talk", npcId: "entity-researcher", channel: "chat", text: "怎么比较两份来源？" }), actorId: "student-a", principalId: "learner-test" };
    await expect(s.service.perform(input)).rejects.toThrow("final receipt failure");
    expect((await s.engine.getRecord(s.sessionId)).fieldInterview!.turns).toHaveLength(1);
    fail = false;
    expect((await s.service.perform(input)).replayed).toBe(true);
    expect((await persisted.load(s.sessionId)).attempts[0]!.commitStatus).toBe("committed");
    expect(decide).toHaveBeenCalledTimes(1);
  });

  it("retains an interrupted reservation across restart instead of resetting its unknown cost", async () => {
    const attemptStore = new InMemoryFieldModelAttemptStore();
    const decide = vi.fn<FieldInterviewModel["decide"]>();
    const s = await setup({ decide }, undefined, { maximumModelCalls: 1, attemptStore });
    const request = await s.make({ kind: "talk", npcId: "entity-researcher", channel: "chat", text: "怎么比较两份来源？" });
    const now = new Date().toISOString();
    await attemptStore.save({ ...emptyFieldModelLedger(s.sessionId), revision: 1, attempts: [{
      attemptId: "interrupted-reservation", sessionId: s.sessionId, actorId: "student-a", bindingId: "binding-a", requestId: request.requestId,
      requestHash: hashCanonical({ actorId: "student-a", request }), lessonHash: xunpuExplorationLesson.contentHash, inputHash: "a".repeat(64), outputHash: null,
      status: "started", called: null, reservedCostMicros: 10_000, costMicros: null, traceRef: null, failureCode: null, decision: null,
      retrievedCitationIds: [], commitStatus: "pending", eventId: null, commitFailureCode: null, startedAt: now, settledAt: null, updatedAt: now,
    }] }, 0);
    await s.service.recoverInterruptedAttempts();
    await s.act(request.action);
    expect(decide).not.toHaveBeenCalled();
    expect((await s.service.readModelAttempts(s.sessionId))[0]).toMatchObject({ status: "interrupted", called: null, costMicros: null, reservedCostMicros: 10_000 });
    expect((await s.engine.getRecord(s.sessionId)).fieldInterview!.turns[0]!.modelReceipt.failureCode).toBe("lesson_model_budget_reached");
  });

  it("bounds slow retrieval and never starts a model from its late result", async () => {
    let resolveEvidence!: (value: FieldInterviewModelInput["evidence"]) => void;
    const retrieval = () => new Promise<FieldInterviewModelInput["evidence"]>(resolve => { resolveEvidence = resolve; });
    const decide = vi.fn<FieldInterviewModel["decide"]>();
    const s = await setup({ decide }, retrieval, { modelTimeoutMs: 15 });
    await s.act({ kind: "talk", npcId: "entity-researcher", channel: "chat", text: "怎么比较两份来源？" });
    resolveEvidence([]);
    await Promise.resolve();
    expect(decide).not.toHaveBeenCalled();
    expect(await s.service.readModelAttempts(s.sessionId)).toEqual([]);
    expect((await s.engine.getRecord(s.sessionId)).fieldInterview!.turns[0]!.modelReceipt).toMatchObject({ costMicros: 0, failureCode: "content_retrieval_timeout" });
  });

  it("aborts a timed-out model and retains the unknown bill independently of the committed fallback", async () => {
    let signal: AbortSignal | undefined;
    const s = await setup({ decide: (_input, control) => { signal = control!.signal; return new Promise(() => {}); } }, undefined, { modelTimeoutMs: 15 });
    await s.act({ kind: "talk", npcId: "entity-researcher", channel: "chat", text: "怎么比较两份来源？" });
    expect(signal!.aborted).toBe(true);
    expect((await s.service.readModelAttempts(s.sessionId))[0]).toMatchObject({ status: "failed", called: true, costMicros: null, failureCode: "model_timeout", commitStatus: "committed" });
  });

  it("requires enough budget for a whole reserved attempt and cancels work before shutdown", async () => {
    const decide = vi.fn<FieldInterviewModel["decide"]>().mockResolvedValue({ decision: { kind: "question", topicId: "chen-evidence", choiceId: null }, traceRef: "budgeted-call", costMicros: 6000 });
    const s = await setup({ decide }, undefined, { modelBudgetMicros: 15_000 });
    const action: FieldInterviewActionV1 = { kind: "talk", npcId: "entity-researcher", channel: "chat", text: "怎么比较两份来源？" };
    await s.act(action);
    await s.act(action);
    expect(decide).toHaveBeenCalledTimes(1);
    expect((await s.service.readModelAttempts(s.sessionId))).toHaveLength(1);
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const pending = await setup({ decide: () => { started(); return new Promise(() => {}); } });
    const outcome = pending.act(action).catch(error => error);
    await ready;
    await pending.service.close();
    expect(await outcome).toBeInstanceOf(Error);
    expect((await pending.service.readModelAttempts(pending.sessionId))[0]).toMatchObject({ failureCode: "service_shutdown", commitStatus: "rejected" });
    expect((await pending.engine.getRecord(pending.sessionId)).fieldInterview).toBeUndefined();
  });
  it("does not spend two model calls when distinct requests race for one session budget", async () => {
    const decide = vi.fn<FieldInterviewModel["decide"]>().mockResolvedValue({ decision: { kind: "question", topicId: "chen-evidence", choiceId: null }, traceRef: "bounded-model-call", costMicros: 12 });
    const s = await setup({ decide }, undefined, { maximumModelCalls: 1 });
    const action: FieldInterviewActionV1 = { kind: "talk", npcId: "entity-researcher", channel: "chat", text: "怎么比较两份来源？" };
    const first = await s.make(action), second = await s.make(action);
    const result = await Promise.allSettled([first, second].map(request => s.service.perform({ request, actorId: "student-a", principalId: "learner-test" })));
    expect(result.filter(item => item.status === "fulfilled")).toHaveLength(1);
    expect(decide).toHaveBeenCalledTimes(1);
  });

  it("checks a paused world before exposing context to retrieval or the model", async () => {
    const decide = vi.fn<FieldInterviewModel["decide"]>().mockResolvedValue({ decision: { kind: "question", topicId: "chen-evidence", choiceId: null }, traceRef: "should-not-call", costMicros: 12 });
    const retrieve = vi.fn().mockResolvedValue([]);
    const s = await setup({ decide }, retrieve);
    const world = await s.engine.getRecord(s.sessionId);
    await s.store.compareAndSet(s.sessionId, world.recordRevision, { ...world, recordRevision: world.recordRevision + 1,
      currentSnapshot: { ...world.currentSnapshot, virtualTime: { ...world.currentSnapshot.virtualTime, paused: true } } });
    await expect(s.act({ kind: "talk", npcId: "entity-researcher", channel: "chat", text: "怎么比较两份来源？" })).rejects.toThrow("暂停");
    expect(retrieve).not.toHaveBeenCalled();
    expect(decide).not.toHaveBeenCalled();
  });
  it("normalizes the observed JSON format marker without accepting extra business fields", () => {
    const decision = { kind: "question", topicId: "wu-business", choiceId: null, reply: "预约不等于已经成交。", citedTopicIds: ["wu-business"] };
    expect(FieldInterviewModelOutputSchema.parse({ type: "json_object", ...decision })).toEqual(decision);
    expect(FieldInterviewModelOutputSchema.parse(decision)).toEqual(decision);
    expect(() => FieldInterviewModelOutputSchema.parse({ ...decision, grantAccess: true })).toThrow();
    expect(() => FieldInterviewModelOutputSchema.parse({ ...decision, type: "other" })).toThrow();
  });
  it("treats an empty optional model reply as absent while retaining an arrangement proposal", () => {
    const decision = { kind: "offer", topicId: null, choiceId: "chen-mail", citedTopicIds: [] };
    for (const reply of ["", "   ", null]) {
      expect(FieldInterviewModelOutputSchema.parse({ ...decision, reply })).toEqual(decision);
    }
    expect(() => FieldInterviewModelOutputSchema.parse({ ...decision, reply: 123 })).toThrow();
    expect(() => FieldInterviewModelOutputSchema.parse({ ...decision, reply: "x".repeat(1001) })).toThrow();
  });
  it("uses the existing character context and scoped SQL evidence while leaving social greetings to programme responses", async () => {
    const decide = vi.fn<FieldInterviewModel["decide"]>().mockResolvedValue({
      decision: { kind: "question", topicId: "chen-evidence", choiceId: null, reply: "先把你准备引用的名称与原文对照，缺少原件的部分不要写成定论。", citedTopicIds: ["chen-evidence"] },
      traceRef: "model-test-sourced-answer", costMicros: 17,
    });
    const retrieval = vi.fn().mockResolvedValue([{ citationId: "citation-current", title: "已授权原文", locator: "PDF第5页", text: "原文的适用范围。", sourceRevisionId: "revision-original", fragmentId: "fragment-5", sourceByteHash: "a".repeat(64) }]);
    const s = await setup({ decide }, retrieval);
    await s.act({ kind: "talk", npcId: "entity-gatekeeper", channel: "scene", text: "林师傅你好" });
    expect(decide).not.toHaveBeenCalled();
    const result = await s.act({ kind: "talk", npcId: "entity-researcher", channel: "chat", text: "想请教原始来源与转引如何区分？" });
    expect(result.view.turns.at(-1)?.npcText).toContain("不要写成定论");
    expect(decide.mock.calls[0]![0].history).toEqual([]);
    expect(decide.mock.calls[0]![0].person.id).toBe("entity-researcher");
    expect(decide.mock.calls[0]![0].choices.find(choice => choice.id === "chen-mail")?.effect).toBe("promise");
    expect(decide.mock.calls[0]![0].professionalContext?.privatePressure).toBe(xunpuFlagshipContentV4.cast.find(person => person.entityId === "entity-researcher")!.privatePressure);
    expect(retrieval.mock.calls[0]![0].principalId).toBe("learner-test");
    expect((await s.engine.getRecord(s.sessionId)).fieldInterview!.turns.at(-1)?.modelReceipt).toMatchObject({ mode: "live_model", traceRef: "model-test-sourced-answer", retrievedCitationIds: ["citation-current"] });
    expect(result.view.turns.at(-1)).not.toHaveProperty("modelReceipt");
  });

  it("rejects a model's attempt to use another character's knowledge and retains the actual failed-call receipt", async () => {
    const s = await setup({ decide: async () => ({ decision: { kind: "question", topicId: "ahuan-daily", choiceId: null, reply: "这不是陈老师自己的经历。", citedTopicIds: ["ahuan-daily"] }, traceRef: "model-invalid-person", costMicros: 23 }) });
    const result = await s.act({ kind: "talk", npcId: "entity-researcher", channel: "chat", text: "请问该怎样核对原文来源？" });
    expect(result.view.turns.at(-1)?.npcText).not.toContain("这不是陈老师自己的经历");
    const receipt = (await s.engine.getRecord(s.sessionId)).fieldInterview!.turns.at(-1)!.modelReceipt;
    expect(receipt).toMatchObject({ mode: "deterministic_fallback", costMicros: 23, traceRef: "model-invalid-person", failureCode: "model_response_unavailable" });
  });

  it("coalesces identical retries into one model call and one authoritative action", async () => {
    const decide = vi.fn<FieldInterviewModel["decide"]>().mockResolvedValue({ decision: { kind: "question", topicId: "chen-evidence", choiceId: null }, traceRef: "model-one-call", costMicros: null });
    const s = await setup({ decide });
    const request = await s.make({ kind: "talk", npcId: "entity-researcher", channel: "chat", text: "怎么比较两份来源？" });
    const input = { request, actorId: "student-a", principalId: "learner-test" };
    await Promise.all([s.service.perform(input), s.service.perform(input)]);
    expect(decide).toHaveBeenCalledTimes(1);
    const replay = await s.service.perform(input);
    expect(replay.replayed).toBe(true);
    expect(decide).toHaveBeenCalledTimes(1);
    expect((await s.engine.getRecord(s.sessionId)).fieldInterview!.turns).toHaveLength(1);
  });
});
