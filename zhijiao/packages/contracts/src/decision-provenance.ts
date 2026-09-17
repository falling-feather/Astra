import { z } from "zod";

/** Describes how the rationale reached the system, not proof of its authorship. */
export const DecisionRationaleSourceSchema = z.enum([
  "student_submitted",
  "legacy_unspecified",
]);
export type DecisionRationaleSource = z.infer<typeof DecisionRationaleSourceSchema>;
