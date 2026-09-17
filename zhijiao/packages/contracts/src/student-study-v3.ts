import { z } from "zod";
import { CourseReleaseReferenceSchema, V2IdentifierSchema } from "./course-learning.js";

export const StudyRunV3Schema = z.object({
  sessionId: V2IdentifierSchema, bindingId: V2IdentifierSchema,
  courseRef: CourseReleaseReferenceSchema, title: z.string().min(1),
  taskReleaseId: V2IdentifierSchema.optional(),
  runtimeKind:z.enum(['field','legacy_course']).optional(),
  status: z.enum(["active", "completed", "cancelled", "legacy"]),
  startedAt: z.string().datetime(), endedAt: z.string().datetime().nullable(),
}).strict();
export type StudyRunV3 = z.infer<typeof StudyRunV3Schema>;
export const StudentStudyV3Schema = z.object({
  schemaVersion: z.literal("student-study/3.0.0"), revision: z.number().int().nonnegative(),
  currentSessionId: V2IdentifierSchema.nullable(), runs: z.array(StudyRunV3Schema),
}).strict().superRefine((value, context) => {
  const active = value.runs.filter(run => run.status === "active");
  if (active.length > 1 || (active[0]?.sessionId ?? null) !== value.currentSessionId
    || new Set(value.runs.map(run => run.sessionId)).size !== value.runs.length) {
    context.addIssue({ code: "custom", path: ["currentSessionId"], message: "当前学习记录必须对应唯一活动场次" });
  }
});
export type StudentStudyV3 = z.infer<typeof StudentStudyV3Schema>;
export const StartStudyV3Schema = z.object({
  requestId: V2IdentifierSchema, courseReleaseId: V2IdentifierSchema,
  taskReleaseId: V2IdentifierSchema.optional(),
  replace: z.object({ sessionId: V2IdentifierSchema, expectedRevision: z.number().int().nonnegative(), confirmation: z.literal("abandon-and-start") }).strict().optional(),
}).strict();
export type StartStudyV3 = z.infer<typeof StartStudyV3Schema>;
export const CancelStudyV3Schema = z.object({
  requestId: V2IdentifierSchema, sessionId: V2IdentifierSchema, expectedRevision: z.number().int().nonnegative(), confirmation: z.literal("abandon") ,
}).strict();
export type CancelStudyV3 = z.infer<typeof CancelStudyV3Schema>;
export const CompleteStudyV3Schema = CancelStudyV3Schema.extend({ confirmation: z.literal("complete") }).strict();
export type CompleteStudyV3 = z.infer<typeof CompleteStudyV3Schema>;
export const EnterPreparedStudyV3Schema = z.object({requestId:V2IdentifierSchema,sourceSessionId:V2IdentifierSchema,sessionId:V2IdentifierSchema,expectedRevision:z.number().int().nonnegative()}).strict();
export type EnterPreparedStudyV3=z.infer<typeof EnterPreparedStudyV3Schema>;
export const StartStudyResultV3Schema = z.object({ state: StudentStudyV3Schema, run: StudyRunV3Schema }).strict();
export type StartStudyResultV3 = z.infer<typeof StartStudyResultV3Schema>;
