import { describe, expect, it } from "vitest";
import { FieldExplorationViewV4Schema } from "@ronggang/contracts";
import { createHttpExperienceGateway } from "../src/v2/gateway";
import { currentInteractionText, resolveFieldSelection } from "../src/v2/field-exploration-v4";
import type { PublicSemanticActionWindowV4 } from "../src/v2/flagship-v4";
import { placeFieldMarker } from "../src/v2/pages/node-field/visuals";

const tokenA = `selection_${"a".repeat(40)}`, tokenB = `selection_${"b".repeat(40)}`;
const field = () => FieldExplorationViewV4Schema.parse({
  schemaVersion: "field-exploration-view/4.1.0", audience: "student", sessionId: "session-field-test", bindingId: "binding-field-student", worldStateVersion: 3, actionWindowRef: "window-field-test",
  nodes: [{ sceneRef: "loc-oyster-alley-gate", title: "巷口", publicDescription: "公共采访区域", environmentImage: "/assets/node-world/alley.png", access: { allowed: true, reason: null, sceneRef: null, personRef: null }, people: [], objectRefs: [] }],
  selectionBindings: [{ objectId: "entity-researcher", selectionToken: tokenA }, { objectId: "entity-editor", selectionToken: tokenB }], dialogues: [], actionConversations: [],
});
const window = (): PublicSemanticActionWindowV4 => ({
  actionWindowRef: "window-field-test", actionWindowHash: "a".repeat(64), worldStateVersion: 3, worldStateRef: "state-field", expiresAt: "2026-09-10T07:00:00.000Z", prompt: "请选择采访对象。",
  selections: [tokenA, tokenB].map(selectionToken => ({ selectionToken, displayKind: "npc", label: "陈老师", consequenceHint: "只代表本人职责", selectionRole: "target" })),
});

describe("formal field projection boundary", () => {
  it("keeps offscreen targets from stacking at the edge of a narrow camera", () => {
    const viewport = { width: 390, height: 844 };
    const label = { width: 44, height: 36 };
    expect(placeFieldMarker({ x: 600, y: 450 }, viewport, label)).toBeNull();
    expect(placeFieldMarker({ x: 700, y: 450 }, viewport, label)).toBeNull();
    expect(placeFieldMarker({ x: -80, y: 450 }, viewport, label)).toBeNull();
    expect(placeFieldMarker({ x: 100, y: 780 }, viewport, label)).toBeNull();
    expect(placeFieldMarker({ x: 100, y: 450 }, viewport, label)).toEqual({ x: 100, y: 432 });
    expect(placeFieldMarker({ x: 190, y: 450 }, viewport, label)).toEqual({ x: 190, y: 432 });
  });
  it("never displays another person's old reply after a new field question", () => {
    const previous = { npc: { npcRef: "entity-gatekeeper" }, turns: [{ npcPublicText: "我替你联系居民。", decidedAt: "2026-09-10T06:00:00.000Z" }] };
    const pending = [{ targetEntityId: "entity-community-source", createdAt: "2026-09-10T06:02:00.000Z", responseSummary: null }];
    expect(currentInteractionText("entity-community-source", previous, pending)).toBeNull();
    expect(currentInteractionText("entity-gatekeeper", previous, pending)).toBe("我替你联系居民。");
    expect(currentInteractionText("entity-community-source", previous, [{ ...pending[0]!, responseSummary: "社区采访范围已经说明。" }])).toBe("社区采访范围已经说明。");
    expect(currentInteractionText("entity-gatekeeper", previous, [{ ...pending[0]!, targetEntityId: "entity-gatekeeper" }])).toBeNull();
  });
  it("binds same-name people by issued object identity and rejects stale windows", () => {
    const experience = { sessionId: "session-field-test", worldStateVersion: 3, actionWindow: window() };
    expect(resolveFieldSelection(field(), experience, "entity-editor")?.selectionToken).toBe(tokenB);
    expect(resolveFieldSelection(field(), experience, "entity-researcher")?.selectionToken).toBe(tokenA);
    expect(resolveFieldSelection(field(), { ...experience, worldStateVersion: 4 }, "entity-editor")).toBeNull();
    expect(resolveFieldSelection(field(), { ...experience, sessionId: "another-session" }, "entity-editor")).toBeNull();
    expect(resolveFieldSelection(field(), { ...experience, actionWindow: { ...window(), actionWindowRef: "new-window" } }, "entity-editor")).toBeNull();
  });
  it("requests the bound field over the real gateway and rejects another binding in the response", async () => {
    let url = ""; let wrongBinding = false;
    const gateway = createHttpExperienceGateway({ profileId: "student-unassigned", principal: { principalId: "principal-student", kind: "human", displayName: "学生记者", status: "active", createdAt: "2026-09-10T00:00:00.000Z" }, bindings: [], csrfToken: "csrf-field-test", expiresAt: "2099-09-10T00:00:00.000Z" }, { fetchImpl: async input => {
      url = String(input); const value = field(); if (wrongBinding) value.bindingId = "binding-another-student";
      return new Response(JSON.stringify({ field: value }), { status: 200, headers: { "Content-Type": "application/json" } });
    } });
    expect((await gateway.getExplorationFieldV4!("session-field-test", "binding-field-student")).nodes).toHaveLength(1);
    expect(url).toContain("/api/v4/sessions/session-field-test/field?bindingId=binding-field-student");
    wrongBinding = true;
    await expect(gateway.getExplorationFieldV4!("session-field-test", "binding-field-student")).rejects.toThrow("绑定不一致");
  });
});
