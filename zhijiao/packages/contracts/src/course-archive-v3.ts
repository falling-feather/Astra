import { z } from "zod";
import { CourseEnrollmentSchema, CourseReleaseReferenceSchema, V2IdentifierSchema } from "./course-learning.js";

export const CourseArchiveItemV3Schema = z.object({
  entryId: V2IdentifierSchema,
  taskReleaseId: V2IdentifierSchema.optional(),
  courseRef: CourseReleaseReferenceSchema,
  title: z.string().min(1), shortTitle: z.string().min(1), summary: z.string(),
  regionId: V2IdentifierSchema, regionTitle: z.string().min(1), order: z.number().int(),
  coverIndex: z.number().int().min(0).max(5), durationLabel: z.string(),
  enrollment: CourseEnrollmentSchema.nullable(),
}).strict();
export type CourseArchiveItemV3 = z.infer<typeof CourseArchiveItemV3Schema>;
export const StudentCourseArchiveV3Schema = z.object({
  schemaVersion: z.literal("student-course-archive/3.0.0"),
  courses: z.array(CourseArchiveItemV3Schema),
}).strict();
export type StudentCourseArchiveV3 = z.infer<typeof StudentCourseArchiveV3Schema>;
