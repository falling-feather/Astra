import { z } from "zod";
import {
  CollaborationStrategyReferenceSchema,
  CollaborationStrategyStatusSchema,
  FlagshipCollaborationEventId,
  FlagshipCollaborationRouteId,
  FlagshipCollaborationTaskAnchorId,
} from "./collaboration-strategy.js";

export const StrategyReuseExplanationSchemaVersion =
  "strategy-reuse-explanation/1.0.0" as const;
export const FlagshipStrategyReuseCurrentEventId =
  "flagship-event-rain-followup" as const;

const IdentifierSchema = z.string()
  .min(1)
  .max(320)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/@-]*$/u);

export const StrategyReuseStatusSchema = z.enum([
  "reused",
  "not_reused",
  "error",
]);
export type StrategyReuseStatus = z.infer<
  typeof StrategyReuseStatusSchema
>;

export const StrategyReuseReasonCodeSchema = z.enum([
  "approved_match",
  "no_match",
  "strategy_draft",
  "strategy_disabled",
  "strategy_retired",
  "version_hash_drift",
]);
export type StrategyReuseReasonCode = z.infer<
  typeof StrategyReuseReasonCodeSchema
>;

export const StrategyReuseApplicabilitySchema = z.object({
  reason: z.string().trim().min(1).max(1_000),
  notApplicableWhen: z.array(
    z.string().trim().min(1).max(1_000),
  ).min(1).max(8),
  currentDifferences: z.array(
    z.string().trim().min(1).max(1_000),
  ).max(8),
}).strict();
export type StrategyReuseApplicability = z.infer<
  typeof StrategyReuseApplicabilitySchema
>;

export const StrategyReuseActualPathSchema = z.object({
  source: z.literal("collaboration_replay"),
  occurred: z.literal(true),
  summary: z.string().trim().min(1).max(2_000),
  eventIds: z.array(IdentifierSchema).min(1).max(256),
  taskIds: z.array(IdentifierSchema).min(1).max(128),
  evidenceIds: z.array(IdentifierSchema).min(1).max(256),
  consequences: z.array(
    z.string().trim().min(1).max(1_000),
  ).min(1).max(8),
}).strict();
export type StrategyReuseActualPath = z.infer<
  typeof StrategyReuseActualPathSchema
>;

export const StrategyReuseAlternativePathSchema = z.object({
  occurred: z.literal(false),
  writesWorldEvents: z.literal(false),
  writesTasks: z.literal(false),
  writesEvidence: z.literal(false),
  summary: z.string().trim().min(1).max(2_000),
  possibleConsequences: z.array(
    z.string().trim().min(1).max(1_000),
  ).min(1).max(8),
}).strict();
export type StrategyReuseAlternativePath = z.infer<
  typeof StrategyReuseAlternativePathSchema
>;

const StrategyReuseExplanationSharedShape = {
  schemaVersion: z.literal(StrategyReuseExplanationSchemaVersion),
  sessionId: IdentifierSchema,
  scenarioId: IdentifierSchema,
  routeId: z.literal(FlagshipCollaborationRouteId),
  sourceEventId: z.literal(FlagshipCollaborationEventId),
  currentEventId: z.literal(FlagshipStrategyReuseCurrentEventId),
  taskId: z.literal(FlagshipCollaborationTaskAnchorId),
  stateVersion: z.number().int().nonnegative(),
  generatedAt: z.string().datetime(),
  applicability: StrategyReuseApplicabilitySchema,
};

export const StrategyReuseAppliedExplanationSchema = z.object({
  ...StrategyReuseExplanationSharedShape,
  status: z.literal("reused"),
  reasonCode: z.literal("approved_match"),
  strategyRef: CollaborationStrategyReferenceSchema,
  strategyStatus: z.literal("approved"),
  actualPath: StrategyReuseActualPathSchema,
  alternativePath: StrategyReuseAlternativePathSchema,
}).strict().superRefine((explanation, context) => {
  if (explanation.applicability.currentDifferences.length === 0) {
    context.addIssue({
      code: "custom",
      path: ["applicability", "currentDifferences"],
      message: "复用解释必须明确本次相似事件与原事件的差异",
    });
  }
  if (!explanation.actualPath.eventIds.includes(
    explanation.sourceEventId,
  )) {
    context.addIssue({
      code: "custom",
      path: ["actualPath", "eventIds"],
      message: "实际路径必须回指策略来源事件",
    });
  }
  if (!explanation.actualPath.taskIds.includes(explanation.taskId)) {
    context.addIssue({
      code: "custom",
      path: ["actualPath", "taskIds"],
      message: "实际路径必须回指固定任务锚点",
    });
  }
});
export type StrategyReuseAppliedExplanation = z.infer<
  typeof StrategyReuseAppliedExplanationSchema
>;

const NotReusedReasonCodeSchema = StrategyReuseReasonCodeSchema.exclude([
  "approved_match",
  "version_hash_drift",
]);

export const StrategyReuseNotAppliedExplanationSchema = z.object({
  ...StrategyReuseExplanationSharedShape,
  status: z.literal("not_reused"),
  reasonCode: NotReusedReasonCodeSchema,
  strategyRef: CollaborationStrategyReferenceSchema.nullable(),
  strategyStatus: CollaborationStrategyStatusSchema.nullable(),
  actualPath: z.null(),
  alternativePath: z.null(),
}).strict().superRefine((explanation, context) => {
  const expectedStatusByReason = {
    strategy_draft: "draft",
    strategy_disabled: "disabled",
    strategy_retired: "retired",
  } as const;
  if (explanation.reasonCode === "no_match") {
    if (
      explanation.strategyRef !== null
      || explanation.strategyStatus !== null
    ) {
      context.addIssue({
        code: "custom",
        path: ["strategyRef"],
        message: "无匹配结果不得伪造策略引用或治理状态",
      });
    }
    return;
  }
  if (
    explanation.strategyRef === null
    || explanation.strategyStatus
      !== expectedStatusByReason[explanation.reasonCode]
  ) {
    context.addIssue({
      code: "custom",
      path: ["strategyStatus"],
      message: "不复用原因必须与被冻结策略的治理状态一致",
    });
  }
});
export type StrategyReuseNotAppliedExplanation = z.infer<
  typeof StrategyReuseNotAppliedExplanationSchema
>;

export const StrategyReuseErrorExplanationSchema = z.object({
  ...StrategyReuseExplanationSharedShape,
  status: z.literal("error"),
  reasonCode: z.literal("version_hash_drift"),
  strategyRef: CollaborationStrategyReferenceSchema.nullable(),
  strategyStatus: z.null(),
  actualPath: z.null(),
  alternativePath: z.null(),
}).strict();
export type StrategyReuseErrorExplanation = z.infer<
  typeof StrategyReuseErrorExplanationSchema
>;

export const StrategyReuseExplanationSchema = z.discriminatedUnion(
  "status",
  [
    StrategyReuseAppliedExplanationSchema,
    StrategyReuseNotAppliedExplanationSchema,
    StrategyReuseErrorExplanationSchema,
  ],
);
export type StrategyReuseExplanation = z.infer<
  typeof StrategyReuseExplanationSchema
>;
