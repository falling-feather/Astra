import type { DialogueEpisodeViewV4, FieldExplorationViewV4 } from "@ronggang/contracts";
import type { FlagshipExperienceViewV4, PublicSemanticSelectionV4 } from "./flagship-v4";

export function resolveFieldSelection(
  field: FieldExplorationViewV4,
  experience: Pick<FlagshipExperienceViewV4, "sessionId" | "worldStateVersion" | "actionWindow">,
  objectId: string,
): PublicSemanticSelectionV4 | null {
  const window = experience.actionWindow;
  if (!window || field.sessionId !== experience.sessionId
    || field.worldStateVersion !== experience.worldStateVersion
    || field.actionWindowRef !== window.actionWindowRef) return null;
  const binding = field.selectionBindings.find(item => item.objectId === objectId);
  return binding ? window.selections.find(selection => selection.selectionToken === binding.selectionToken) ?? null : null;
}

export function currentInteractionText(
  targetId: string | null,
  dialogue: { npc: Pick<DialogueEpisodeViewV4["npc"], "npcRef">; turns: ReadonlyArray<Pick<DialogueEpisodeViewV4["turns"][number], "npcPublicText" | "decidedAt">> } | null,
  actions: ReadonlyArray<Pick<FieldExplorationViewV4["actionConversations"][number], "targetEntityId" | "createdAt" | "responseSummary">>,
): string | null {
  if (!targetId) return null;
  const turn = dialogue?.npc.npcRef === targetId ? dialogue.turns.at(-1) : undefined;
  const action = actions.filter(entry => entry.targetEntityId === targetId).at(-1);
  if (action && (!turn || action.createdAt >= turn.decidedAt)) return action.responseSummary;
  return turn?.npcPublicText ?? null;
}
