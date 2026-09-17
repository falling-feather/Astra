import { z } from "zod";
import { V2IdentifierSchema, V2ContentHashSchema } from "./course-learning.js";
import { ChallengeLevelSchema } from "./world-simulation-v3.js";

export const FieldWorkArtifactV3Schema = z.object({
  artifactId: V2IdentifierSchema, title: z.string().min(1).max(160), artifactKind: z.string().min(1),
  conflictDomainRefs: z.array(V2IdentifierSchema).max(20),
  requiredAtChallengeLevels: z.array(ChallengeLevelSchema).max(5),
  editableFields: z.array(z.object({ fieldId: V2IdentifierSchema, label: z.string().min(1).max(120),
    minimumLength: z.number().int().min(0).max(2000), maximumLength: z.number().int().min(1).max(20_000),
  }).strict()).min(1).max(24),
  completionChecks: z.array(z.string().min(1)).max(20), evidenceRequirements: z.array(z.string().min(1)).max(20),
}).strict();
export const FieldWorkPlanV3Schema = z.object({
  schemaVersion: z.literal("field-work-plan/3.0.0"), manifestId: V2IdentifierSchema,
  courseId: V2IdentifierSchema, version: z.number().int().positive(), contentHash: V2ContentHashSchema,
  title: z.string().min(1).max(240), expectedDurationMinutes: z.number().int().min(40).max(90),
  artifacts: z.array(FieldWorkArtifactV3Schema).min(1).max(32),
  sourceKnowledgeIds: z.array(V2IdentifierSchema).max(200),
  learningObjectives: z.array(z.string().min(1)).min(1).max(20),
}).strict().superRefine((plan, context) => {
  if (new Set(plan.artifacts.map(artifact => artifact.artifactId)).size !== plan.artifacts.length)
    context.addIssue({ code: "custom", path: ["artifacts"], message: "成果编号不能重复" });
  for (const [index, artifact] of plan.artifacts.entries()) {
    if (new Set(artifact.editableFields.map(field => field.fieldId)).size !== artifact.editableFields.length)
      context.addIssue({ code: "custom", path: ["artifacts",index,"editableFields"], message: "作品字段不能重复" });
    if (artifact.editableFields.some(field => field.minimumLength > field.maximumLength))
      context.addIssue({ code: "custom", path: ["artifacts",index,"editableFields"], message: "作品字段长度范围不合法" });
  }
});
export type FieldWorkPlanV3 = z.infer<typeof FieldWorkPlanV3Schema>;
export type FieldWorkArtifactV3 = z.infer<typeof FieldWorkArtifactV3Schema>;
