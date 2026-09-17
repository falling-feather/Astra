import { z } from "zod";
import {
  CollaborationStrategyReferenceSchema,
  FlagshipCollaborationEventId,
  FlagshipCollaborationRouteId,
} from "./collaboration-strategy.js";

export const ScenarioCollaborationConfigSchemaVersion =
  "scenario-collaboration-config/1.0.0" as const;
export const ScenarioCollaborationFlagshipScenarioId =
  "scenario-local-tourism-media-v0.1" as const;

export const ScenarioActiveAgentTemplateIds = [
  "assistant/evidence-coach",
  "assistant/material-understanding",
  "assistant/evaluation-review",
] as const;

export const ScenarioActiveAgentTemplateIdSchema = z.enum(
  ScenarioActiveAgentTemplateIds,
);
export type ScenarioActiveAgentTemplateId = z.infer<
  typeof ScenarioActiveAgentTemplateIdSchema
>;

const activeTemplateIdSet = new Set<string>(
  ScenarioActiveAgentTemplateIds,
);

export const ScenarioCollaborationConfigSchema = z.object({
  schemaVersion: z.literal(ScenarioCollaborationConfigSchemaVersion),
  routeId: z.literal(FlagshipCollaborationRouteId),
  eventId: z.literal(FlagshipCollaborationEventId),
  enabledAgentTemplateIds: z.array(ScenarioActiveAgentTemplateIdSchema)
    .length(ScenarioActiveAgentTemplateIds.length),
  strategyRef: CollaborationStrategyReferenceSchema,
}).strict().superRefine((config, context) => {
  const selected = new Set(config.enabledAgentTemplateIds);
  if (
    selected.size !== ScenarioActiveAgentTemplateIds.length
    || ScenarioActiveAgentTemplateIds.some((templateId) => !selected.has(templateId))
    || [...selected].some((templateId) => !activeTemplateIdSet.has(templateId))
  ) {
    context.addIssue({
      code: "custom",
      path: ["enabledAgentTemplateIds"],
      message: "旗舰事件必须且只能启用三个既有 active 核心智能体模板",
    });
  }
});
export type ScenarioCollaborationConfig = z.infer<
  typeof ScenarioCollaborationConfigSchema
>;

export const ScenarioCollaborationConfigPatchSchema = z.object({
  collaborationConfig: ScenarioCollaborationConfigSchema,
}).strict();
export type ScenarioCollaborationConfigPatch = z.infer<
  typeof ScenarioCollaborationConfigPatchSchema
>;
