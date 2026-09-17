import type { DialogueEpisodeV4, FieldExplorationViewV4, StudentWorkAction } from "@ronggang/contracts";
import type { SimulationSessionRecord } from "@ronggang/world-core";

function originalUtterance(action: StudentWorkAction): string | null {
  const payload = action.action;
  switch (payload.verb) {
    case "ask": case "probe": case "negotiate": return payload.utterance;
    case "observe": return payload.observationFocus;
    case "inspect": case "compare": return payload.evidenceQuestion;
    case "wait": return payload.reason;
    default: return action.reflectionNote;
  }
}

export function projectFieldActionConversations(input: {
  record: Pick<SimulationSessionRecord, "queue" | "studentActions" | "consequences">;
  dialogues: readonly {
    worldCommit: Pick<NonNullable<DialogueEpisodeV4["worldCommit"]>, "worldEventRef"> | null;
    pendingResolution: Pick<NonNullable<DialogueEpisodeV4["pendingResolution"]>, "worldRequestId"> | null;
  }[];
  actorId: string;
  bindingId: string;
  visibleNpcRefs: ReadonlySet<string>;
}): FieldExplorationViewV4["actionConversations"] {
  const events = new Map(input.record.queue.filter(event => event.sourceKind === "student_action").map(event => [event.sourceRef, event]));
  const consequences = new Map(input.record.consequences.map(item => [item.sourceWorldEventId, item]));
  const dialogueEvents = new Set(input.dialogues.flatMap(episode => episode.worldCommit ? [episode.worldCommit.worldEventRef] : []));
  const pendingDialogueRequests = new Set(input.dialogues.flatMap(episode => episode.pendingResolution ? [episode.pendingResolution.worldRequestId] : []));
  return input.record.studentActions.flatMap(action => {
    if (action.actorId !== input.actorId || action.bindingId !== input.bindingId) return [];
    const event = events.get(action.workActionId);
    if (!event || dialogueEvents.has(event.eventId) || pendingDialogueRequests.has(event.requestId)) return [];
    const payload = action.action;
    const targetEntityId = action.interactionTargetRef ?? ("targetRef" in payload && payload.targetRef.objectType === "entity" ? payload.targetRef.objectId : null);
    if (!targetEntityId || !input.visibleNpcRefs.has(targetEntityId)) return [];
    const utterance = originalUtterance(action)?.trim(); if (!utterance) return [];
    return [{ workActionId: action.workActionId, eventId: event.eventId, targetEntityId, utterance,
      createdAt: action.createdAt, status: event.status,
      responseSummary: consequences.get(event.eventId)?.publicSummary ?? null,
    }];
  });
}
