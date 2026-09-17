import { z } from "zod";

export const FlagshipRuntimeActionPolicyV4SchemaVersion =
  "flagship-action-policy/4.0.0" as const;

const RuntimeIdSchema = z.string().regex(/^[a-z][a-z0-9_-]{1,127}$/u);
const RuntimeTextSchema = z.string().trim().min(1).max(1_200);

const FlagshipRuntimeEventStatusV4Schema = z.enum([
  "queued",
  "awaiting_gate",
  "committed",
  "rejected",
  "failed",
]);

const FlagshipRuntimeEntityStatusV4Schema = z.enum([
  "available",
  "busy",
  "withheld",
  "left",
  "closed",
]);

const FlagshipRuntimeFactStatusV4Schema = z.enum([
  "unknown",
  "rumor",
  "corroborated",
  "confirmed",
  "refuted",
]);

const FlagshipRuntimeThresholdOperatorV4Schema = z.enum([
  "gte",
  "lte",
  "eq",
]);

export const FlagshipRuntimeActionConditionV4Schema = z.discriminatedUnion(
  "kind",
  [
    z.object({
      kind: z.literal("event_status"),
      eventType: RuntimeIdSchema,
      statuses: z.array(FlagshipRuntimeEventStatusV4Schema).min(1).max(4),
    }).strict(),
    z.object({
      kind: z.literal("entity_status"),
      entityId: RuntimeIdSchema,
      statuses: z.array(FlagshipRuntimeEntityStatusV4Schema).min(1).max(5),
    }).strict(),
    z.object({
      kind: z.literal("fact_status"),
      factId: RuntimeIdSchema,
      statuses: z.array(FlagshipRuntimeFactStatusV4Schema).min(1).max(5),
    }).strict(),
    z.object({
      kind: z.literal("variable_threshold"),
      variableId: RuntimeIdSchema,
      operator: FlagshipRuntimeThresholdOperatorV4Schema,
      value: z.number().finite(),
    }).strict(),
    z.object({
      kind: z.literal("resource_threshold"),
      resourceId: RuntimeIdSchema,
      operator: FlagshipRuntimeThresholdOperatorV4Schema,
      value: z.number().nonnegative().finite(),
    }).strict(),
    z.object({
      kind: z.literal("time_threshold"),
      metric: z.enum(["elapsed_minutes", "remaining_minutes"]),
      operator: z.enum(["gte", "lte"]),
      value: z.number().int().nonnegative(),
    }).strict(),
  ],
);
export type FlagshipRuntimeActionConditionV4 = z.infer<
  typeof FlagshipRuntimeActionConditionV4Schema
>;

export const FlagshipRuntimeActionRequirementsV4Schema = z.object({
  all: z.array(FlagshipRuntimeActionConditionV4Schema).max(16),
  any: z.array(FlagshipRuntimeActionConditionV4Schema).max(16),
  none: z.array(FlagshipRuntimeActionConditionV4Schema).max(16),
}).strict();
export type FlagshipRuntimeActionRequirementsV4 = z.infer<
  typeof FlagshipRuntimeActionRequirementsV4Schema
>;

export const FlagshipRuntimeActionRuleV4Schema = z.object({
  eventTemplateId: RuntimeIdSchema,
  requirements: FlagshipRuntimeActionRequirementsV4Schema,
  unavailableReason: RuntimeTextSchema.max(500),
}).strict();
export type FlagshipRuntimeActionRuleV4 = z.infer<
  typeof FlagshipRuntimeActionRuleV4Schema
>;

export const FlagshipRuntimeActionPolicyV4Schema = z.object({
  schemaVersion: z.literal(FlagshipRuntimeActionPolicyV4SchemaVersion),
  policyId: RuntimeIdSchema,
  actions: z.array(FlagshipRuntimeActionRuleV4Schema).min(1).max(128),
}).strict().superRefine((policy, context) => {
  const eventTemplateIds = policy.actions.map((action) => action.eventTemplateId);
  if (new Set(eventTemplateIds).size !== eventTemplateIds.length) {
    context.addIssue({
      code: "custom",
      path: ["actions"],
      message: "动作策略不得重复声明事件模板",
    });
  }
});
export type FlagshipRuntimeActionPolicyV4 = z.infer<
  typeof FlagshipRuntimeActionPolicyV4Schema
>;
