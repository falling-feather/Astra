import { z } from "zod";
import { V2IdentifierSchema } from "./course-learning.js";
import { StudentDialogueEpisodeViewV4Schema } from "./dialogue-episode-v4.js";

export const FieldAccessGateV4Schema = z.object({
  allowed: z.boolean(),
  reason: z.string().min(1).nullable(),
  sceneRef: V2IdentifierSchema.nullable(),
  personRef: V2IdentifierSchema.nullable(),
}).strict().superRefine((gate, context) => {
  if (!gate.allowed && !gate.reason) context.addIssue({ code: "custom", path: ["reason"], message: "未开放的入口必须说明前导条件" });
});
export type FieldAccessGateV4 = z.infer<typeof FieldAccessGateV4Schema>;

const PublicPersonSchema = z.object({
  entityId: V2IdentifierSchema,
  displayName: z.string().min(1),
  professionalRole: z.string().min(1),
  publicGoal: z.string().min(1),
  portrait: z.string().min(1),
  status: z.enum(["available", "busy", "withheld", "left", "closed"]),
  supportsDialogue: z.boolean(),
  presence: z.object({
    visible: z.boolean(),
    canContact: z.boolean(),
    prerequisite: FieldAccessGateV4Schema,
  }).strict(),
}).strict();

export const FieldExplorationViewV4Schema = z.object({
  schemaVersion: z.literal("field-exploration-view/4.1.0"),
  audience: z.literal("student"),
  sessionId: V2IdentifierSchema,
  bindingId: V2IdentifierSchema,
  worldStateVersion: z.number().int().nonnegative(),
  actionWindowRef: V2IdentifierSchema,
  nodes: z.array(z.object({
    sceneRef: V2IdentifierSchema,
    title: z.string().min(1),
    publicDescription: z.string().min(1),
    environmentImage: z.string().min(1),
    access: FieldAccessGateV4Schema,
    people: z.array(PublicPersonSchema),
    objectRefs: z.array(V2IdentifierSchema),
  }).strict()).min(1),
  selectionBindings: z.array(z.object({
    objectId: V2IdentifierSchema,
    selectionToken: z.string().min(24),
  }).strict()),
  dialogues: z.array(StudentDialogueEpisodeViewV4Schema),
  actionConversations: z.array(z.object({
    workActionId: V2IdentifierSchema,
    eventId: V2IdentifierSchema,
    targetEntityId: V2IdentifierSchema,
    utterance: z.string().min(1),
    createdAt: z.string().datetime(),
    status: z.enum(["queued", "awaiting_gate", "committed", "rejected", "failed"]),
    responseSummary: z.string().nullable(),
  }).strict()),
}).strict().superRefine((view, context) => {
  if (!view.nodes.some(node => node.access.allowed)) {
    context.addIssue({ code: "custom", path: ["nodes"], message: "节点现场至少保留一个可查看的入口" });
  }
  if (new Set(view.nodes.map(node => node.sceneRef)).size !== view.nodes.length) {
    context.addIssue({ code: "custom", path: ["nodes"], message: "节点引用不得重复" });
  }
  if (new Set(view.selectionBindings.map(binding => binding.objectId)).size !== view.selectionBindings.length) {
    context.addIssue({ code: "custom", path: ["selectionBindings"], message: "对象与选择令牌必须一一对应" });
  }
  if (view.dialogues.some(episode => episode.sessionId !== view.sessionId)) {
    context.addIssue({ code: "custom", path: ["dialogues"], message: "对话历史必须属于当前会话" });
  }
});
export type FieldExplorationViewV4 = z.infer<typeof FieldExplorationViewV4Schema>;
export const FieldExplorationResponseV4Schema = z.object({ field: FieldExplorationViewV4Schema }).strict();
