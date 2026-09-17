import { z } from "zod";
import { V2IdentifierSchema } from "./course-learning.js";

export const StudentNoteV1Schema = z.object({
  noteId: V2IdentifierSchema,
  title: z.string().max(120),
  body: z.string().max(20_000),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();
export type StudentNoteV1 = z.infer<typeof StudentNoteV1Schema>;

export const StudentNotebookV1Schema = z.object({
  schemaVersion: z.literal("student-notebook/1.0.0"),
  courseId: V2IdentifierSchema,
  revision: z.number().int().nonnegative(),
  notes: z.array(StudentNoteV1Schema).max(120),
}).strict();
export type StudentNotebookV1 = z.infer<typeof StudentNotebookV1Schema>;

export const StudentNotebookMutationV1Schema = z.object({
  bindingId: V2IdentifierSchema,
  requestId: V2IdentifierSchema,
  expectedRevision: z.number().int().nonnegative(),
  action: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("save"), noteId: V2IdentifierSchema,
      title: z.string().max(120), body: z.string().max(20_000) }).strict(),
    z.object({ kind: z.literal("remove"), noteId: V2IdentifierSchema }).strict(),
  ]),
}).strict();
export type StudentNotebookMutationV1 = z.infer<typeof StudentNotebookMutationV1Schema>;

/** A selected note becomes an immutable supplement to a submitted revision, never a live private-note link. */
export const SubmittedStudentNoteV1Schema = StudentNoteV1Schema.extend({
  submittedAt: z.string().datetime(),
}).strict();
export type SubmittedStudentNoteV1 = z.infer<typeof SubmittedStudentNoteV1Schema>;
