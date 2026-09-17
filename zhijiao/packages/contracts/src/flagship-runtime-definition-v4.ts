import { z } from "zod";
import {
  FlagshipContentReferenceV4Schema,
  SemanticActionVerbV4Schema,
} from "./flagship-world-v4.js";

export const FlagshipWorldRuntimeDefinitionV4SchemaVersion =
  "flagship-world-runtime-definition/4.0.0" as const;

export {
  FlagshipRuntimeActionConditionV4Schema,
  FlagshipRuntimeActionPolicyV4Schema,
  FlagshipRuntimeActionPolicyV4SchemaVersion,
  FlagshipRuntimeActionRequirementsV4Schema,
  FlagshipRuntimeActionRuleV4Schema,
} from "./flagship-action-policy-v4.js";
export type {
  FlagshipRuntimeActionConditionV4,
  FlagshipRuntimeActionPolicyV4,
  FlagshipRuntimeActionRequirementsV4,
  FlagshipRuntimeActionRuleV4,
} from "./flagship-action-policy-v4.js";

const RuntimeIdSchema = z.string().regex(/^[a-z][a-z0-9_-]{1,127}$/u);
const RuntimeTextSchema = z.string().trim().min(1).max(1_200);

const RuntimePhaseActivationV4Schema = z.object({
  terminal: z.boolean(),
  allHandledEventTypes: z.array(RuntimeIdSchema).max(32),
  anyHandledEventTypes: z.array(RuntimeIdSchema).max(32),
}).strict();

export const FlagshipRuntimePhaseV4Schema = z.object({
  phaseId: RuntimeIdSchema,
  priority: z.number().int().nonnegative(),
  worldStateRef: RuntimeIdSchema,
  locationId: RuntimeIdSchema,
  environmentAssetId: RuntimeIdSchema,
  npcRefs: z.array(RuntimeIdSchema).max(16),
  objectRefs: z.array(RuntimeIdSchema).max(24),
  prompt: RuntimeTextSchema,
  activation: RuntimePhaseActivationV4Schema,
}).strict();
export type FlagshipRuntimePhaseV4 = z.infer<
  typeof FlagshipRuntimePhaseV4Schema
>;

export const FlagshipRuntimeIntentBindingV4Schema = z.object({
  bindingId: RuntimeIdSchema,
  priority: z.number().int().nonnegative(),
  verbs: z.array(SemanticActionVerbV4Schema).min(1).max(10),
  targetRefs: z.array(RuntimeIdSchema).max(24),
  eventTemplateCandidates: z.array(RuntimeIdSchema).max(8),
  workspaceOnly: z.boolean(),
}).strict().superRefine((binding, context) => {
  if (binding.workspaceOnly === (binding.eventTemplateCandidates.length > 0)) {
    context.addIssue({
      code: "custom",
      path: ["eventTemplateCandidates"],
      message: "工作台意图不得绑定世界事件，世界意图必须至少有一个候选事件模板",
    });
  }
});
export type FlagshipRuntimeIntentBindingV4 = z.infer<
  typeof FlagshipRuntimeIntentBindingV4Schema
>;

const RuntimeObjectReferenceV4Schema = z.object({
  objectType: z.enum([
    "agent",
    "event",
    "artifact",
    "relationship",
    "entity",
    "world_variable",
    "fact",
    "resource",
  ]),
  objectId: RuntimeIdSchema,
}).strict();

const RuntimeActionTemplateV4Schema = z.discriminatedUnion("verb", [
  z.object({
    verb: z.literal("observe"),
    targetRef: RuntimeObjectReferenceV4Schema,
  }).strict(),
  z.object({
    verb: z.enum(["ask", "probe", "negotiate"]),
    targetRef: RuntimeObjectReferenceV4Schema,
  }).strict(),
  z.object({
    verb: z.enum(["compare", "inspect"]),
    targetRefs: z.array(RuntimeObjectReferenceV4Schema).min(1).max(8),
  }).strict(),
  z.object({
    verb: z.literal("wait"),
    durationMinutes: z.number().int().positive().max(120),
  }).strict(),
]);
export type RuntimeActionTemplateV4 = z.infer<
  typeof RuntimeActionTemplateV4Schema
>;

export const FlagshipRuntimeEventActionV4Schema = z.object({
  eventTemplateId: RuntimeIdSchema,
  action: RuntimeActionTemplateV4Schema,
}).strict();
export type FlagshipRuntimeEventActionV4 = z.infer<
  typeof FlagshipRuntimeEventActionV4Schema
>;

export const FlagshipRuntimeGroundedBindingV4Schema = z.object({
  episodeTemplateRef: RuntimeIdSchema,
  eventTemplateIds: z.array(RuntimeIdSchema).min(1).max(12),
  affectedObjectRefs: z.array(RuntimeIdSchema).min(1).max(24),
  evidenceKinds: z.array(RuntimeIdSchema).min(1).max(16),
}).strict();
export type FlagshipRuntimeGroundedBindingV4 = z.infer<
  typeof FlagshipRuntimeGroundedBindingV4Schema
>;

const RuntimeDeltaSignalV4Schema = z.object({
  variableId: RuntimeIdSchema,
  positiveSignal: RuntimeIdSchema,
}).strict();

export const FlagshipRuntimeAutonomyBindingV4Schema = z.object({
  eventType: RuntimeIdSchema,
  actorRef: RuntimeIdSchema.nullable(),
  memoryKey: RuntimeIdSchema.nullable(),
  staticSignals: z.record(
    RuntimeIdSchema,
    z.union([z.boolean(), z.number(), z.string().max(300)]),
  ),
  positiveDeltaSignal: RuntimeDeltaSignalV4Schema.nullable(),
}).strict();
export type FlagshipRuntimeAutonomyBindingV4 = z.infer<
  typeof FlagshipRuntimeAutonomyBindingV4Schema
>;

export const FlagshipRuntimePortraitV4Schema = z.object({
  entityId: RuntimeIdSchema,
  assetId: RuntimeIdSchema,
}).strict();

export const FlagshipWorldRuntimeDefinitionV4Schema = z.object({
  schemaVersion: z.literal(FlagshipWorldRuntimeDefinitionV4SchemaVersion),
  definitionId: RuntimeIdSchema,
  contentRef: FlagshipContentReferenceV4Schema,
  externalObjectRefs: z.array(RuntimeIdSchema).max(64),
  phases: z.array(FlagshipRuntimePhaseV4Schema).min(1).max(64),
  intentBindings: z.array(FlagshipRuntimeIntentBindingV4Schema).min(1).max(128),
  eventActions: z.array(FlagshipRuntimeEventActionV4Schema).min(1).max(128),
  groundedBindings: z.array(FlagshipRuntimeGroundedBindingV4Schema).max(32),
  autonomyBindings: z.array(FlagshipRuntimeAutonomyBindingV4Schema).max(128),
  portraits: z.array(FlagshipRuntimePortraitV4Schema).max(64),
}).strict();
export type FlagshipWorldRuntimeDefinitionV4 = z.infer<
  typeof FlagshipWorldRuntimeDefinitionV4Schema
>;
