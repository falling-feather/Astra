import { z } from "zod";
import { V2IdentifierSchema } from "./course-learning.js";
import { SubmittedStudentNoteV1Schema } from "./student-notebook-v1.js";

/** Photos are sent only with an explicit work submission; private drafts never enter this packet. */
export const SubmittedNotebookPhotoV3Schema = z.object({
  name: z.string().trim().min(1).max(120),
  dataUrl: z.string().max(2_800_000).regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/u),
}).strict();
export const WorkSupplementSelectionV3Schema = z.object({
  noteIds: z.array(V2IdentifierSchema).max(30).refine(ids => new Set(ids).size === ids.length, "笔记不能重复选择"),
  photos: z.array(SubmittedNotebookPhotoV3Schema).max(2),
  notebookRevision: z.number().int().nonnegative().optional(),
}).strict().superRefine((value, context) => {
  if (value.noteIds.length && value.notebookRevision === undefined) context.addIssue({ code: "custom", path: ["notebookRevision"], message: "请选择已读取版本中的笔记" });
});
export const WorkSupplementV3Schema = z.object({
  revisionId: V2IdentifierSchema,
  notes: z.array(SubmittedStudentNoteV1Schema).max(30),
  photos: z.array(SubmittedNotebookPhotoV3Schema).max(2),
  submittedAt: z.string().datetime(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
}).strict();
export type WorkSupplementSelectionV3 = z.infer<typeof WorkSupplementSelectionV3Schema>;
export type WorkSupplementV3 = z.infer<typeof WorkSupplementV3Schema>;
