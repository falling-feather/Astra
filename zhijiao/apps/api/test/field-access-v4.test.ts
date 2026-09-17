import { describe, expect, it } from "vitest";
import { deriveFieldAccessV4, type FieldAccessEvidenceV4 } from "../src/field-access-v4.js";

function evidence() {
  return { actorId: "student-a", bindingId: "binding-a",
    actions: [] as FieldAccessEvidenceV4["actions"][number][],
    events: [] as FieldAccessEvidenceV4["events"][number][],
    resolutions: [] as FieldAccessEvidenceV4["resolutions"][number][],
    intents: [] as FieldAccessEvidenceV4["intents"][number][],
    dialogues: [] as FieldAccessEvidenceV4["dialogues"][number][],
  };
}
function grant(input: ReturnType<typeof evidence>, route: string | null, status: "committed" | "awaiting_gate" = "committed") {
  input.actions.push({ workActionId: "action-gate", actorId: "student-a", bindingId: "binding-a" });
  input.events.push({ eventId: "event-gate", sourceRef: "action-gate", eventType: "student_asks_gatekeeper", status });
  input.intents.push({ intentId: "grant-intent", proposedAction: { actionType: "grant_conditional_access" } });
  if (status === "committed") input.resolutions.push({ sourceWorldEventId: "event-gate", status: "committed", acceptedIntents: [{ intentId: "grant-intent" }] });
  if (route) input.dialogues.push({ studentActorRef: "student-a", studentBindingRef: "binding-a", worldCommit: { worldEventRef: "event-gate", routeRef: route } });
  return input;
}

describe("field access from settled course evidence", () => {
  it("keeps the entrance and public research desk open but closes deeper locations", () => {
    const access = deriveFieldAccessV4(evidence());
    expect(access.node("loc-oyster-alley-gate").allowed).toBe(true);
    expect(access.node("loc-waterfront-service-point").allowed).toBe(true);
    expect(access.node("loc-community-courtyard")).toMatchObject({ allowed: false, personRef: "entity-gatekeeper" });
    expect(access.person("entity-community-source").visible).toBe(false);
    expect(access.person("entity-researcher").visible).toBe(false);
  });
  it("does not treat sending, awaiting approval or another student's admission as permission", () => {
    expect(deriveFieldAccessV4(grant(evidence(), "dialogue-route-assisted-contact", "awaiting_gate")).node("loc-community-courtyard").allowed).toBe(false);
    const foreign = grant(evidence(), "dialogue-route-assisted-contact");
    foreign.actions[0]!.bindingId = "binding-b";
    expect(deriveFieldAccessV4(foreign).person("entity-community-source").visible).toBe(false);
  });
  it("preserves the difference between public observation and an arranged introduction", () => {
    const edge = deriveFieldAccessV4(grant(evidence(), "dialogue-route-public-edge"));
    expect(edge.node("loc-community-courtyard").allowed).toBe(true);
    expect(edge.node("loc-zanhuawei-workshop").allowed).toBe(false);
    expect(edge.person("entity-community-source")).toMatchObject({ visible: false, canContact: false });
    const guided = deriveFieldAccessV4(grant(evidence(), "dialogue-route-assisted-contact"));
    expect(guided.node("loc-zanhuawei-workshop").allowed).toBe(true);
    expect(guided.person("entity-community-source").visible).toBe(true);
    expect(deriveFieldAccessV4(grant(evidence(), "dialogue-route-background-briefing")).node("loc-community-courtyard").allowed).toBe(false);
  });
  it("requires a settled source task before showing the expert and respects a later refusal", () => {
    const input = grant(evidence(), "dialogue-route-assisted-contact");
    input.actions.push({ workActionId: "source-action", actorId: "student-a", bindingId: "binding-a" });
    input.events.push({ eventId: "source-event", sourceRef: "source-action", eventType: "student_compares_sources", status: "committed" });
    input.resolutions.push({ sourceWorldEventId: "source-event", status: "committed", acceptedIntents: [] });
    expect(deriveFieldAccessV4(input).person("entity-researcher").visible).toBe(true);
    input.actions.push({ workActionId: "denied-action", actorId: "student-a", bindingId: "binding-a" });
    input.events.push({ eventId: "denied-event", sourceRef: "denied-action", eventType: "student_asks_gatekeeper", status: "committed" });
    input.resolutions.push({ sourceWorldEventId: "denied-event", status: "committed", acceptedIntents: [{ intentId: "refusal-intent" }] });
    expect(deriveFieldAccessV4(input).node("loc-community-courtyard").allowed).toBe(false);
    expect(deriveFieldAccessV4(input).person("entity-community-source").visible).toBe(false);
  });
});
