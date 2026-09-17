import { z } from "zod";
import { CourseReleaseReferenceSchema, V2ContentHashSchema, V2IdentifierSchema } from "./course-learning.js";
import { AssessmentCriterionIdV4Schema } from "./media-assessment-adaptation-v4.js";
import { WorldSimulationReleaseSchema } from "./world-simulation-v3.js";

const id = V2IdentifierSchema;
const text = z.string().trim().min(1).max(2000);
export const TeachingTaskDurationMinutesSchema = WorldSimulationReleaseSchema.shape.expectedDurationMinutes;
export const TeachingTaskInputV1Schema = z.object({
  title: z.string().trim().max(120).default(""),
  brief: z.string().trim().max(1200), audience: z.string().trim().max(160),
  learnerContext: z.string().trim().max(500), learnerLevel: z.enum(["beginner", "practiced"]),
  durationMinutes: TeachingTaskDurationMinutesSchema,
  sourceKind: z.enum(["teaching_example", "teacher_provided"]), sourceStatement: z.string().trim().max(600),
  templateId: z.enum(["community-story", "public-service"]).nullable().default(null),
  focusCriteria: z.array(AssessmentCriterionIdV4Schema).max(3).default([]),
}).strict();
export type TeachingTaskInputV1 = z.infer<typeof TeachingTaskInputV1Schema>;

export const TeachingTaskStepV1Schema = z.object({
  taskRef: id, title: text, instruction: text, observableResult: text,
  competencyRefs: z.array(id).min(1).max(16), knowledgeIds: z.array(id).min(1).max(16), artifactIds: z.array(id).min(1).max(16),
}).strict();
export const TeachingTaskBasisV1Schema = z.object({
  knowledgeId: id, knowledgeRevisionId: id, sourceRevisionId: id, title: text, sourceTitle: text, sourceUrl: z.string().url().nullable(), locator: text,
  contentHash: V2ContentHashSchema, reviewStatus: z.string().min(1).max(80),
  isFocus: z.boolean(),
}).strict();

export const TeachingTaskPlanV1Schema = z.object({
  title: z.string().trim().min(2).max(120), assignment: z.string().trim().min(20).max(1800), audience: z.string().trim().min(2).max(160),
  objectives: z.array(text).min(2).max(8), durationMinutes: TeachingTaskDurationMinutesSchema, scaffoldingLevel: z.number().int().min(0).max(2),
  challengeLevel: z.union([z.literal(3), z.literal(4), z.literal(5)]),
  focusCriteria: z.array(AssessmentCriterionIdV4Schema).min(1).max(6),
  steps: z.array(TeachingTaskStepV1Schema).min(1).max(12),
  basis: z.array(TeachingTaskBasisV1Schema).min(1).max(64),
  sourcePlan: z.array(z.object({ personId: id, materialIds: z.array(id).min(1).max(12), purpose: text }).strict()).min(1).max(10),
  recommendedStrategies: z.array(id).min(1).max(12), acceptableAlternatives: z.array(text).min(1).max(10), reflectionQuestion: text,
  reviewBoundary: text,
}).strict();
export type TeachingTaskPlanV1 = z.infer<typeof TeachingTaskPlanV1Schema>;

export const TeachingTaskDraftV1Schema = z.object({
  schemaVersion: z.literal("teaching-task-draft/1.0.0"), taskId: id, revision: z.number().int().positive(), contentHash: V2ContentHashSchema,
  input: TeachingTaskInputV1Schema, templateId: z.enum(["community-story", "public-service"]), plan: TeachingTaskPlanV1Schema,
  sourceCourseRef: CourseReleaseReferenceSchema, baseLessonHash: V2ContentHashSchema, templateContentHash: V2ContentHashSchema,
  generationMode: z.literal("knowledge_rules"), createdAt: z.string().datetime(),
}).strict();
export type TeachingTaskDraftV1 = z.infer<typeof TeachingTaskDraftV1Schema>;

export const TeachingTaskReleaseRefV1Schema = z.object({ taskId: id, revision: z.number().int().positive(), releaseId: id, contentHash: V2ContentHashSchema }).strict();
export type TeachingTaskReleaseRefV1 = z.infer<typeof TeachingTaskReleaseRefV1Schema>;
export const TeachingTaskReleaseV1Schema = z.object({
  schemaVersion: z.literal("teaching-task-release/1.0.0"), ref: TeachingTaskReleaseRefV1Schema, plan: TeachingTaskPlanV1Schema,
  sourceCourseRef: CourseReleaseReferenceSchema, lessonHash: V2ContentHashSchema,
  publishedAt: z.string().datetime(), teacherConfirmation: text,
}).strict();
export type TeachingTaskReleaseV1 = z.infer<typeof TeachingTaskReleaseV1Schema>;

export const TeachingTaskSessionV1Schema = z.object({
  taskReleaseRef: TeachingTaskReleaseRefV1Schema, sessionId: id, bindingId: id.nullable(), title: text,
  status: z.enum(["provisioning", "active", "paused", "completed", "recovery_failed"]), startedAt: z.string().datetime(),
}).strict();
export type TeachingTaskSessionV1 = z.infer<typeof TeachingTaskSessionV1Schema>;

export const TeachingTaskWorkspaceV1Schema = z.object({
  templates: z.array(z.object({ templateId: z.enum(["community-story", "public-service"]), title: text, purpose: text }).strict()),
  drafts: z.array(TeachingTaskDraftV1Schema), releases: z.array(TeachingTaskReleaseV1Schema), sessions: z.array(TeachingTaskSessionV1Schema),
}).strict();
export type TeachingTaskWorkspaceV1 = z.infer<typeof TeachingTaskWorkspaceV1Schema>;
export const TeachingTaskGenerationResultV1Schema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("needs_clarification"), questions: z.array(text).min(1), supportedTemplates: z.array(z.enum(["community-story", "public-service"])) }).strict(),
  z.object({ status: z.literal("draft_created"), draft: TeachingTaskDraftV1Schema }).strict(),
]);
export type TeachingTaskGenerationResultV1 = z.infer<typeof TeachingTaskGenerationResultV1Schema>;
