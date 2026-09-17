import { describe, expect, it } from "vitest";
import { StudentWorkActionSchema } from "@ronggang/contracts";
import type { SimulationQueuedEvent } from "@ronggang/world-core";
import { projectFieldActionConversations } from "../src/field-conversations-v4.js";

function setup() {
  const action = StudentWorkActionSchema.parse({ schemaVersion: "student-work-action/3.0.0", workActionId: "action-ask-editor", serverIssuedActionRef: "server-action-editor-0", sessionId: "session-field", bindingId: "binding-student", actorId: "student-reporter", primaryRoleId: "reporter", interactionTargetRef: "entity-editor", expectedWorldStateVersion: 0,
    action: { verb: "observe", targetRef: { objectType: "artifact", objectId: "obj-editor-brief" }, observationFocus: "编辑您好，请问这次报道需要覆盖哪些受众？" }, sourceWorldEventIds: [], reflectionNote: null, submissionStatus: "accepted", createdAt: "2026-09-10T06:00:00.000Z" });
  const event: SimulationQueuedEvent = { eventId: "event-editor", sessionId: "session-field", eventTemplateId: "event-template-topic-brief", eventType: "student_observes_editorial_brief", sourceKind: "student_action", sourceRef: action.workActionId, requestId: "request-editor", requestHash: "a".repeat(64), enqueuedAtStateVersion: 0, sequence: 1, notBeforeVirtualMinute: 0, affectedObjectRefs: [], status: "queued", resolutionId: null, occurredAt: action.createdAt };
  return { action, event, input: { record: { studentActions: [action], queue: [event], consequences: [] }, dialogues: [], actorId: "student-reporter", bindingId: "binding-student", visibleNpcRefs: new Set(["entity-editor"]) } };
}
describe("field action conversation projection", () => {
  it("retains the verified person when execution is normalized to a document observation", () => {
    const { input } = setup(); const entries = projectFieldActionConversations(input);
    expect(entries).toHaveLength(1); expect(entries[0]).toMatchObject({ targetEntityId: "entity-editor", utterance: "编辑您好，请问这次报道需要覆盖哪些受众？", responseSummary: null, status: "queued" });
  });
  it("does not attribute another student's message or an invisible person's interaction", () => {
    const { input } = setup();
    expect(projectFieldActionConversations({ ...input, bindingId: "other-binding" })).toEqual([]);
    expect(projectFieldActionConversations({ ...input, actorId: "other-student" })).toEqual([]);
    expect(projectFieldActionConversations({ ...input, visibleNpcRefs: new Set() })).toEqual([]);
  });
  it("does not duplicate dedicated dialogue actions, including an interrupted resolution", () => {
    const { input } = setup();
    expect(projectFieldActionConversations({ ...input, dialogues: [{ worldCommit: { worldEventRef: "event-editor" }, pendingResolution: null }] })).toEqual([]);
    expect(projectFieldActionConversations({ ...input, dialogues: [{ worldCommit: null, pendingResolution: { worldRequestId: "request-editor" } }] })).toEqual([]);
  });
  it("reads legacy entity actions without rewriting them or inventing responses", () => {
    const { action, event, input } = setup(); const { interactionTargetRef: _target, ...legacy } = action;
    const legacyAction = StudentWorkActionSchema.parse({ ...legacy, action: { verb: "ask", targetRef: { objectType: "entity", objectId: "entity-editor" }, utterance: "请问本次的采访范围是什么？" } });
    expect(projectFieldActionConversations({ ...input, record: { ...input.record, studentActions: [legacyAction], queue: [{ ...event, status: "committed" }], consequences: [{ eventId: "result-editor", sessionId: "session-field", resolutionId: "resolution-editor", sourceWorldEventId: "event-editor", publicSummary: "编辑工单范围已确认。", evidenceIds: [], resultingStateVersion: 1, occurredAt: "2026-09-10T06:01:00.000Z" }] } })[0]?.responseSummary).toBe("编辑工单范围已确认。");
    expect(legacyAction).not.toHaveProperty("interactionTargetRef");
  });
});
