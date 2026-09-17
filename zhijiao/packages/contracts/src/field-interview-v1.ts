import { z } from "zod";
import { V2ContentHashSchema, V2IdentifierSchema } from "./course-learning.js";

const id = V2IdentifierSchema;
const text = z.string().trim().min(1).max(2_000);
export const FieldInterviewActionV1Schema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("travel"), nodeId: id }).strict(),
  z.object({ kind: z.literal("inspect"), materialId: id }).strict(),
  z.object({ kind: z.literal("talk"), npcId: id, channel: z.enum(["scene", "chat", "email"]), text }).strict(),
  z.object({ kind: z.literal("choose"), npcId: id, choiceId: id, rationale: z.string().trim().max(2_000), channel: z.enum(["scene", "chat", "email"]).optional() }).strict(),
  z.object({ kind: z.literal("wait"), minutes: z.number().int().min(1).max(10) }).strict(),
  z.object({ kind: z.literal("read_message"), messageId: id }).strict(),
  z.object({ kind: z.literal("read_thread"), npcId: id }).strict(),
  z.object({ kind: z.literal("topic"), strategyId: id, text }).strict(),
]);
export type FieldInterviewActionV1 = z.infer<typeof FieldInterviewActionV1Schema>;
export const FieldInterviewActionRequestV1Schema = z.object({
  schemaVersion: z.literal("field-interview-action/1.0.0"),
  requestId: id, sessionId: id, bindingId: id,
  expectedWorldStateVersion: z.number().int().nonnegative(),
  action: FieldInterviewActionV1Schema,
}).strict();
export type FieldInterviewActionRequestV1 = z.infer<typeof FieldInterviewActionRequestV1Schema>;

export const FieldInterviewModelReceiptV1Schema = z.object({
  attemptRef: id.optional(),
  mode: z.enum(["deterministic", "live_model", "deterministic_fallback"]),
  traceRef: id.nullable(), inputHash: V2ContentHashSchema, outputHash: V2ContentHashSchema,
  costMicros: z.number().int().nonnegative().nullable(),
  failureCode: z.string().max(100).nullable(),
  retrievedCitationIds: z.array(z.string().min(1).max(240)).max(12).optional(),
  toolCallRef: id.optional(),
  toolName: z.enum(["interview", "meet_person", "add_contact", "request_referral"]).optional(),
  toolTransport: z.literal("mcp-in-memory").optional(),
}).strict();
export type FieldInterviewModelReceiptV1 = z.infer<typeof FieldInterviewModelReceiptV1Schema>;
export const FieldInterviewSpeechDecisionV1Schema = z.object({
  kind: z.enum(["greeting", "acknowledge", "question", "offer", "clarify", "farewell", "refuse", "decline", "social"]),
  topicId: id.nullable(), choiceId: id.nullable(),
  reply: z.string().trim().min(1).max(1_000).optional(),
  citedTopicIds: z.array(id).max(6).optional(),
  socialAction: z.enum(["introduce_self", "request_contact", "request_referral"]).optional(),
  socialConsent: z.boolean().optional(),
}).strict();
export type FieldInterviewSpeechDecisionV1 = z.infer<typeof FieldInterviewSpeechDecisionV1Schema>;

const MessageSchema = z.object({
  id, npcId: id, channel: z.enum(["chat", "email"]), direction: z.enum(["incoming", "outgoing"]),
  subject: z.string().max(160).nullable(), text, minute: z.number().int().nonnegative(),
  attachmentMaterialIds: z.array(id), read: z.boolean(),
}).strict();
const TurnSchema = z.object({
  id, npcId: id, channel: z.enum(["scene", "chat", "email"]), studentText: text, npcText: text,
  topicId: id.nullable(), choiceId: id.nullable(), materialIds: z.array(id),
  choiceConfirmed: z.boolean(),
  minute: z.number().int().nonnegative(), modelReceipt: FieldInterviewModelReceiptV1Schema,
}).strict();
const EventSchema = z.object({
  id, requestId: id, requestHash: V2ContentHashSchema,
  actorId: id, bindingId: id,
  sourceWorldStateVersion: z.number().int().nonnegative(), resultingWorldStateVersion: z.number().int().positive(),
  beforeMinute: z.number().int().nonnegative(), afterMinute: z.number().int().nonnegative(),
  action: FieldInterviewActionV1Schema, summary: text, evidenceRefs: z.array(id),
  committedAt: z.string().datetime(),
}).strict();
export type FieldInterviewEventV1 = z.infer<typeof EventSchema>;

export const FieldContactMemoryV3Schema = z.object({
  npcId: id, met: z.boolean(), friend: z.boolean(), trust: z.number().int().min(0).max(100),
  evidenceRefs: z.array(id).max(80), topics: z.array(id).max(80), referredNpcIds: z.array(id).max(30),
  memories: z.array(z.object({ eventRef: id, summary: z.string().max(600), minute: z.number().int().nonnegative() }).strict()).max(32),
  origins: z.array(z.object({ sessionId: id, lessonHash: V2ContentHashSchema }).strict()).max(30),
}).strict();
export type FieldContactMemoryV3 = z.infer<typeof FieldContactMemoryV3Schema>;

export const FieldInterviewRecordV1Schema = z.object({
  schemaVersion: z.literal("field-interview-record/1.0.0"),
  lessonRef: z.object({ lessonId: id, version: z.string().min(1), contentHash: V2ContentHashSchema }).strict(),
  sessionId: id, actorId: id, bindingId: id, nodeId: id, visitedNodeIds: z.array(id),
  flags: z.array(id), materialIds: z.array(id), strategyId: id.nullable(), topic: z.string().max(2_000),
  pendingOffers: z.array(z.object({ npcId: id, choiceId: id }).strict()),
  appointments: z.array(z.object({ npcId: id, atMinute: z.number().int().nonnegative(), status: z.enum(["confirmed", "ready", "cancelled", "met", "missed"]) }).strict()),
  promises: z.array(z.object({ npcId: id, materialIds: z.array(id), dueMinute: z.number().int().nonnegative(), deliveryMinute: z.number().int().nonnegative().nullable(), status: z.enum(["pending", "overdue", "reminded", "delivered"]), channel: z.enum(["chat", "email"]).optional() }).strict()),
  absences: z.array(z.object({ npcId: id, startMinute: z.number().int().nonnegative(), returnMinute: z.number().int().nonnegative(), leftAnnounced: z.boolean(), returnedAnnounced: z.boolean() }).strict()),
  messages: z.array(MessageSchema), turns: z.array(TurnSchema), events: z.array(EventSchema),
  contacts: z.array(FieldContactMemoryV3Schema).max(120).optional(),
}).strict();
export type FieldInterviewRecordV1 = z.infer<typeof FieldInterviewRecordV1Schema>;

export const FieldInterviewViewV1Schema = z.object({
  schemaVersion: z.literal("field-interview-view/1.0.0"), sessionId: id, bindingId: id, lessonId: id, lessonVersion: z.string().min(1), title: text, assignment: text,
  worldStateVersion: z.number().int().nonnegative(), virtualMinute: z.number().int().nonnegative(),
  remainingMinutes: z.number().int().nonnegative(), nodeId: id,
  nodes: z.array(z.object({ id, title: text, description: text, allowed: z.boolean(), reason: text.nullable(), travelMinutes: z.number().int().nonnegative(), visited: z.boolean(),
    discovered: z.boolean().optional(), nearby: z.boolean().optional(), image: z.string().nullable().optional(), map: z.object({ x: z.number(), y: z.number() }).strict().optional(),
    imageAtlas: z.object({ columns: z.number().int().positive(), rows: z.number().int().positive(), index: z.number().int().nonnegative() }).strict().optional(),
    exits: z.array(z.object({ targetId: id, x: z.number(), y: z.number() }).strict()).optional() }).strict()),
  people: z.array(z.object({
    id, name: text, role: text, nodeId: id, activity: text,
    interactionKind: z.enum(["agent", "scripted"]),
    presence: z.enum(["present", "away", "not_arranged"]), canMessage: z.boolean(),
    statusText: text, topics: z.array(z.object({ id, title: text }).strict()),
    appearance: z.object({ image: z.string(), portrait: z.string().optional(), x: z.number(), y: z.number(), height: z.number(),
      atlas: z.object({ columns: z.number().int().positive(), rows: z.number().int().positive(), index: z.number().int().nonnegative() }).strict().optional() }).strict().optional(),
    relationship: z.object({ met: z.boolean(), friend: z.boolean(), description: text }).strict().optional(),
    choices: z.array(z.object({ id, label: text, minutes: z.number().int().nonnegative() }).strict()),
  }).strict()),
  materials: z.array(z.object({ id, title: text, nodeId: id.nullable(), discovered: z.boolean(), kind: z.enum(["public_source", "simulation"]), evidenceStatus: z.enum(["public_source", "scenario_record", "unverified_claim", "reference_guide", "case_example"]).optional(), description: text, body: text.nullable(), sourceUrl: z.string().url().nullable(), locator: text, knowledgeRefs: z.array(id) }).strict()),
  messages: z.array(MessageSchema),
  turns: z.array(TurnSchema.omit({ modelReceipt: true })),
  appointments: FieldInterviewRecordV1Schema.shape.appointments,
  promises: FieldInterviewRecordV1Schema.shape.promises,
  topic: z.string().max(2_000), strategyId: id.nullable(),
  strategies: z.array(z.object({ id, title: text, question: text, evidenceReady: z.boolean(), missing: z.array(text) }).strict()),
  progress: z.object({ interviewedPeople: z.number().int().nonnegative(), discoveredMaterials: z.number().int().nonnegative(), decisions: z.number().int().nonnegative() }).strict(),
  executionMode: z.enum(["not_run", "rules", "live", "mixed"]),
  recentEvents: z.array(z.object({ id, summary: text, minute: z.number().int().nonnegative(), evidenceRefs: z.array(id) }).strict()),
  region: z.object({ id, title: text }).strict().optional(),
  socialLearning: z.boolean().optional(),
}).strict();
export type FieldInterviewViewV1 = z.infer<typeof FieldInterviewViewV1Schema>;
export const FieldInterviewActionResponseV1Schema = z.object({ view: FieldInterviewViewV1Schema, eventId: id, replayed: z.boolean() }).strict();
export const FieldInterviewReadResponseV1Schema = z.object({ view: FieldInterviewViewV1Schema.nullable(), studentActorRef: id.nullable().optional() }).strict();
