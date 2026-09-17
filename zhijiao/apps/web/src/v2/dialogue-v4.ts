import {
  DialogueEpisodeResponseV4Schema,
  DialogueStartResponseV4Schema,
  type DialogueEpisodeEnvelopeV4,
  type DialogueStartResponseV4,
  type DialogueTurnRequestV4,
  type SemanticActionRequestV4,
} from "@ronggang/contracts";
import { WireFormatError } from "./wire";

export type StudentDialogueEpisodeEnvelopeV4 = Extract<
  DialogueEpisodeEnvelopeV4,
  { audience: "student" }
>;

export type StartFlagshipDialogueInputV4 = SemanticActionRequestV4;
export type SubmitFlagshipDialogueTurnInputV4 = DialogueTurnRequestV4;

export function parseFlagshipDialogueResponseV4(
  value: unknown,
): StudentDialogueEpisodeEnvelopeV4 | null {
  const parsed = DialogueEpisodeResponseV4Schema.parse(value);
  if (parsed.dialogue === null) return null;
  if (parsed.dialogue.audience !== "student") {
    throw new WireFormatError("V4 学生对话投影角色不一致");
  }
  return parsed.dialogue;
}

export function parseFlagshipDialogueStartResponseV4(
  value: unknown,
): DialogueStartResponseV4 {
  const parsed = DialogueStartResponseV4Schema.parse(value);
  if (parsed.status === "opened" && parsed.dialogue.audience !== "student") {
    throw new WireFormatError("V4 学生对话开始响应角色不一致");
  }
  return parsed;
}
