import { z } from "zod";
import { StudyRunV3Schema } from "./student-study-v3.js";
import { WorkSupplementV3Schema } from "./work-supplement-v3.js";
export const TeacherSubmittedWorksV3Schema = z.object({
  sessionId: z.string(), works: z.array(z.object({ artifactId: z.string(), title: z.string(), revisionNumber: z.number().int().positive(),
    fields: z.array(z.object({ label: z.string(), content: z.string() }).strict()),
    supplement: WorkSupplementV3Schema.nullable(), submittedAt: z.string(),
  }).strict()),
}).strict();
export type TeacherSubmittedWorksV3 = z.infer<typeof TeacherSubmittedWorksV3Schema>;
export const TeacherClassroomsV3Schema = z.object({ classrooms: z.array(z.object({ classroomId: z.string(), name: z.string() }).strict()) }).strict();
export const TeacherStudentArchiveV3Schema = z.object({
  classrooms: TeacherClassroomsV3Schema.shape.classrooms.optional(),
  students: z.array(z.object({
    studentId: z.string(), displayName: z.string(), classroomId: z.string().optional(), currentSessionId: z.string().nullable(),
    runs: z.array(StudyRunV3Schema.omit({ bindingId: true }).extend({
      region: z.string(), coverIndex: z.number().int().min(0).max(5),
      visitedScenes: z.number().int().nonnegative(), conversations: z.number().int().nonnegative(),
      submittedWorks: z.number().int().nonnegative(), requiredWorks: z.number().int().nonnegative(),
      relationships: z.array(z.object({ name: z.string(), met: z.boolean(), friend: z.boolean(), introductions: z.number().int().nonnegative() }).strict()),
      assessment: z.object({ status: z.string(), message: z.string(), criteria: z.array(z.object({ id: z.string(), title: z.string(), score: z.number().nullable(), rationale: z.string() }).strict()) }).strict(),
    }).strict()),
  }).strict()),
}).strict();
export type TeacherStudentArchiveV3 = z.infer<typeof TeacherStudentArchiveV3Schema>;
