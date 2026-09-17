import { z } from "zod";

export const CollaborationReplaySchemaVersion =
  "collaboration-replay/1.0.0" as const;

export const CollaborationReplayPhaseSchema = z.enum([
  "event_trigger",
  "candidate_screening",
  "agent_wakeup",
  "permission_check",
  "agent_contribution",
  "student_decision",
  "teacher_review",
  "world_writeback",
]);
export type CollaborationReplayPhase = z.infer<
  typeof CollaborationReplayPhaseSchema
>;

export const CollaborationReplayStageStatusSchema = z.enum([
  "completed",
  "rejected",
  "failed",
  "missing",
  "not_applicable",
]);
export type CollaborationReplayStageStatus = z.infer<
  typeof CollaborationReplayStageStatusSchema
>;

export const CollaborationReplayAgentRefSchema = z.object({
  agentId: z.string().min(1).max(240),
  templateId: z.string().min(1).max(240),
  instanceId: z.string().min(1).max(320),
}).strict();
export type CollaborationReplayAgentRef = z.infer<
  typeof CollaborationReplayAgentRefSchema
>;

export const CollaborationReplayStageSchema = z.object({
  phase: CollaborationReplayPhaseSchema,
  status: CollaborationReplayStageStatusSchema,
  occurredAt: z.string().datetime().nullable(),
  stateVersion: z.number().int().nonnegative().nullable(),
  title: z.string().min(1).max(240),
  summary: z.string().min(1).max(2_000),
  actorIds: z.array(z.string().min(1).max(240)).max(32),
  agentRefs: z.array(CollaborationReplayAgentRefSchema).max(8),
  eventIds: z.array(z.string().min(1).max(320)).max(64),
  taskIds: z.array(z.string().min(1).max(320)).max(64),
  evidenceIds: z.array(z.string().min(1).max(320)).max(128),
  technicalTraceRefs: z.array(z.string().min(1).max(512)).max(128),
}).strict();
export type CollaborationReplayStage = z.infer<
  typeof CollaborationReplayStageSchema
>;

export const CollaborationReplaySchema = z.object({
  schemaVersion: z.literal(CollaborationReplaySchemaVersion),
  sessionId: z.string().min(1).max(240),
  scenarioId: z.string().min(1).max(240),
  routeId: z.string().min(1).max(240),
  representativeEventId: z.string().min(1).max(240),
  representativeTaskId: z.string().min(1).max(240),
  stateVersion: z.number().int().nonnegative(),
  generatedAt: z.string().datetime(),
  status: z.enum([
    "not_triggered",
    "in_progress",
    "completed",
    "failed",
  ]),
  stages: z.array(CollaborationReplayStageSchema).length(8),
  technicalTraceRefs: z.array(z.string().min(1).max(512)).max(256),
}).strict().superRefine((replay, context) => {
  const expectedPhases = CollaborationReplayPhaseSchema.options;
  replay.stages.forEach((stage, index) => {
    if (stage.phase !== expectedPhases[index]) {
      context.addIssue({
        code: "custom",
        path: ["stages", index, "phase"],
        message: "协作回放阶段必须保持固定因果顺序",
      });
    }
  });
  if (
    replay.status === "not_triggered"
    && replay.stages[0]?.status !== "missing"
  ) {
    context.addIssue({
      code: "custom",
      path: ["status"],
      message: "未触发回放必须显式缺少事件触发阶段",
    });
  }
  if (
    replay.status === "failed"
    && !replay.stages.some((stage) => stage.status === "failed")
  ) {
    context.addIssue({
      code: "custom",
      path: ["status"],
      message: "失败回放必须保留至少一个失败阶段",
    });
  }
});
export type CollaborationReplay = z.infer<
  typeof CollaborationReplaySchema
>;
