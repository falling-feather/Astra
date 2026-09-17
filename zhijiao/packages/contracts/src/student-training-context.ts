import { z } from "zod";
import {
  CourseReleaseReferenceSchema,
  ScenarioReleaseReferenceSchema,
  V2IdentifierSchema,
} from "./course-learning.js";

export const StudentTrainingContextSchemaVersion =
  "student-training-context/2.0.0" as const;
export const StudentTrainingMutationReceiptSchemaVersion =
  "student-training-mutation-receipt/2.0.0" as const;

export const StudentAdviceDecisionSchema = z.enum([
  "accept",
  "request_evidence",
  "reject",
]);
export type StudentAdviceDecision = z.infer<
  typeof StudentAdviceDecisionSchema
>;

/**
 * Browser request for a collaboration decision. The browser returns the
 * server-issued suggestion ID and a frozen enum only; it never constructs a
 * WorldEngine task/action reference.
 */
export const StudentAdviceDecisionRequestSchema = z.object({
  suggestionId: V2IdentifierSchema,
  decision: StudentAdviceDecisionSchema,
}).strict();
export type StudentAdviceDecisionRequest = z.infer<
  typeof StudentAdviceDecisionRequestSchema
>;

export const StudentTrainingMutationReceiptSchema = z.object({
  schemaVersion: z.literal(StudentTrainingMutationReceiptSchemaVersion),
  accepted: z.literal(true),
  sessionId: V2IdentifierSchema,
  stateVersion: z.number().int().nonnegative(),
}).strict();
export type StudentTrainingMutationReceipt = z.infer<
  typeof StudentTrainingMutationReceiptSchema
>;

export const StudentTrainingSceneSchema = z.object({
  sceneId: V2IdentifierSchema,
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().min(1).max(1_200),
  phase: z.enum(["active", "incident", "paused", "review", "completed"]),
  riskLevel: z.enum(["low", "medium", "high"]),
  stateTags: z.array(z.string().trim().min(1).max(120)).max(12),
}).strict();
export type StudentTrainingScene = z.infer<
  typeof StudentTrainingSceneSchema
>;

export const StudentTrainingHotspotSchema = z.object({
  hotspotId: V2IdentifierSchema,
  label: z.string().trim().min(1).max(240),
  description: z.string().trim().min(1).max(1_000),
  status: z.enum(["available", "awaiting", "responded", "locked", "observed"]),
  relationship: z.enum([
    "unknown",
    "cooperative",
    "cautious",
    "restricted",
    "committed",
  ]),
  consequencePreview: z.string().trim().min(1).max(1_000).nullable(),
}).strict();
export type StudentTrainingHotspot = z.infer<
  typeof StudentTrainingHotspotSchema
>;

export const StudentTrainingEventCardSchema = z.object({
  eventRef: V2IdentifierSchema,
  title: z.string().trim().min(1).max(240),
  changes: z.array(z.string().trim().min(1).max(1_000)).min(1).max(16),
  tone: z.enum(["info", "warning", "critical", "success"]),
}).strict();
export type StudentTrainingEventCard = z.infer<
  typeof StudentTrainingEventCardSchema
>;

export const StudentTrainingActionSchema = z.object({
  actionRef: V2IdentifierSchema,
  sceneId: V2IdentifierSchema,
  label: z.string().trim().min(1).max(240),
  description: z.string().trim().min(1).max(1_000),
  expectedOutput: z.string().trim().min(1).max(1_000),
  status: z.enum(["ready", "in_progress"]),
  priority: z.enum(["normal", "urgent"]),
  sourceEventRefs: z.array(V2IdentifierSchema).max(32),
}).strict();
export type StudentTrainingAction = z.infer<
  typeof StudentTrainingActionSchema
>;

/**
 * Minimal student-safe world projection. It deliberately excludes RoleContract,
 * the scenario role table, prompts, private memory, provider/runtime details,
 * traces, raw payloads, command names and action audit identifiers.
 */
export const StudentTrainingContextSchema = z.object({
  schemaVersion: z.literal(StudentTrainingContextSchemaVersion),
  sessionId: V2IdentifierSchema,
  bindingId: V2IdentifierSchema,
  courseReleaseRef: CourseReleaseReferenceSchema,
  scenarioReleaseRef: ScenarioReleaseReferenceSchema,
  stateVersion: z.number().int().nonnegative(),
  generatedAt: z.string().datetime(),
  actor: z.object({
    roleId: z.literal("reporter"),
    displayName: z.string().trim().min(1).max(160),
  }).strict(),
  remainingMinutes: z.number().int().nonnegative(),
  scene: StudentTrainingSceneSchema,
  hotspots: z.array(StudentTrainingHotspotSchema).max(32),
  eventCards: z.array(StudentTrainingEventCardSchema).max(16),
  currentAction: StudentTrainingActionSchema.nullable(),
  evidenceRefs: z.array(V2IdentifierSchema).max(256),
}).strict().superRefine((context, refinement) => {
  if (
    context.currentAction
    && context.currentAction.sceneId !== context.scene.sceneId
  ) {
    refinement.addIssue({
      code: "custom",
      path: ["currentAction", "sceneId"],
      message: "学生当前行动必须属于当前安全场景",
    });
  }
});
export type StudentTrainingContext = z.infer<
  typeof StudentTrainingContextSchema
>;
