import type { FieldAccessGateV4, FieldExplorationViewV4 } from "@ronggang/contracts";

export const fieldAccessPolicyVersionV4 = "field-access/4.0.0";
export interface FieldAccessEvidenceV4 {
  actorId: string;
  bindingId: string;
  actions: readonly { workActionId: string; actorId: string; bindingId: string }[];
  events: readonly { eventId: string; sourceRef: string; eventType: string; status: string }[];
  resolutions: readonly {
    sourceWorldEventId: string; status: string;
    acceptedIntents: readonly { intentId: string }[];
  }[];
  intents: readonly { intentId: string; proposedAction: { actionType: string } }[];
  dialogues: readonly {
    studentActorRef: string; studentBindingRef: string;
    worldCommit: { worldEventRef: string; routeRef: string } | null;
  }[];
}
const open = (): FieldAccessGateV4 => ({ allowed: true, reason: null, sceneRef: null, personRef: null });
const gatekeeper = (reason: string): FieldAccessGateV4 => ({ allowed: false, reason, sceneRef: "loc-oyster-alley-gate", personRef: "entity-gatekeeper" });

/** Read existing settled facts. Visiting a node or submitting a request grants nothing. */
export function deriveFieldAccessV4(input: FieldAccessEvidenceV4) {
  const actions = new Set(input.actions.filter(action => action.actorId === input.actorId && action.bindingId === input.bindingId).map(action => action.workActionId));
  const resolutions = new Map(input.resolutions.filter(resolution => resolution.status === "committed").map(resolution => [resolution.sourceWorldEventId, resolution]));
  const events = input.events.filter(event => actions.has(event.sourceRef) && event.status === "committed" && resolutions.has(event.eventId));
  const handled = new Set(events.map(event => event.eventType));
  const lastEntry = events.filter(event => event.eventType === "student_asks_gatekeeper").at(-1);
  const dialogue = lastEntry && input.dialogues.find(episode => episode.studentActorRef === input.actorId && episode.studentBindingRef === input.bindingId && episode.worldCommit?.worldEventRef === lastEntry.eventId);
  const route = dialogue?.worldCommit?.routeRef;
  const acceptedIds = new Set(lastEntry ? resolutions.get(lastEntry.eventId)?.acceptedIntents.map(intent => intent.intentId) : []);
  const positiveAccess = input.intents.some(intent => acceptedIds.has(intent.intentId) && intent.proposedAction.actionType === "grant_conditional_access");
  // Historical one-shot grants establish only the public perimeter, never an arranged introduction.
  const scope = !positiveAccess ? "none" : route === "dialogue-route-assisted-contact" ? "guided" : route === "dialogue-route-public-edge" || !route ? "public_edge" : "none";
  const sourcePrepared = handled.has("student_compares_sources") || handled.has("student_inspects_source");
  const admission = scope === "none" ? gatekeeper("林师傅尚未放行。请先说明身份、采访范围，并完成准入沟通。") : open();
  const introduction = scope === "guided" ? open() : gatekeeper("尚未安排人物见面。请先请林师傅联系愿意听采访说明的居民。仅获公共区域观察许可不能直接拜访。 ".trim());
  const research = sourcePrepared ? open() : { allowed: false, reason: "陈老师尚未到场。先核对一组原始来源，形成具体问题后再联系研究者。", sceneRef: "loc-waterfront-service-point", personRef: null };
  const node = (sceneRef: string): FieldAccessGateV4 => {
    if (sceneRef === "loc-community-courtyard") return admission;
    if (["loc-zanhuawei-workshop", "loc-merchant-storefront"].includes(sceneRef)) return introduction;
    return open();
  };
  const person = (entityId: string): FieldExplorationViewV4["nodes"][number]["people"][number]["presence"] => {
    let prerequisite = open();
    if (["entity-community-source", "entity-inheritor", "entity-shopkeeper"].includes(entityId)) prerequisite = introduction;
    else if (entityId === "entity-tourist") prerequisite = admission;
    else if (entityId === "entity-researcher") prerequisite = research;
    return { visible: prerequisite.allowed, canContact: prerequisite.allowed, prerequisite };
  };
  return { node, person };
}
