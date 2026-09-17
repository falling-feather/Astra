import { z } from "zod";
import { V2IdentifierSchema } from "./course-learning.js";

export const LearnerCalibrationPolicyVersionV4 =
  "learner-calibration-v4/task-outcome-v1" as const;
export const LearnerCalibrationFieldPolicyVersionV4 =
  "learner-calibration-v4/field-work-v1" as const;
export const LearnerCalibrationLegacyPolicyVersionV4 =
  "legacy/action-alignment/4.0.0" as const;

export const LearnerCalibrationPolicyVersionV4Schema = z.enum([
  LearnerCalibrationPolicyVersionV4, LearnerCalibrationFieldPolicyVersionV4,
]);
export const LearnerCalibrationDisplayPolicyVersionV4Schema = z.union([
  LearnerCalibrationPolicyVersionV4Schema,
  z.literal(LearnerCalibrationLegacyPolicyVersionV4),
]);
export const LearnerAdaptationVariantRefV4Schema = z.enum([
  "variant-xunpu-source-triangulation",
  "variant-xunpu-consent-negotiation",
  "variant-xunpu-deadline-service",
  "variant-xunpu-editorial-independence",
]);
export type LearnerAdaptationVariantRefV4 = z.infer<
  typeof LearnerAdaptationVariantRefV4Schema
>;

export const LearnerCalibrationOutcomeV4Schema = z.enum([
  "success",
  "failure",
]);
export type LearnerCalibrationOutcomeV4 = z.infer<
  typeof LearnerCalibrationOutcomeV4Schema
>;

export const LearnerCalibrationWindowClosedByV4Schema = z.enum([
  "world_terminal",
  "window_elapsed",
]);

export const LearnerCalibrationObservationWindowPlanV4Schema = z.object({
  policyVersion: LearnerCalibrationPolicyVersionV4Schema,
  startVirtualMinute: z.number().int().nonnegative(),
  endVirtualMinute: z.number().int().positive(),
  minimumCommittedWorldEvents: z.number().int().min(2).max(16),
}).strict().superRefine((window, context) => {
  if (window.endVirtualMinute <= window.startVirtualMinute) {
    context.addIssue({
      code: "custom",
      path: ["endVirtualMinute"],
      message: "校准观察窗口必须晚于开始分钟",
    });
  }
});
export type LearnerCalibrationObservationWindowPlanV4 = z.infer<
  typeof LearnerCalibrationObservationWindowPlanV4Schema
>;

export const LearnerCalibrationObservationWindowV4Schema = z.object({
  policyVersion: LearnerCalibrationPolicyVersionV4Schema,
  startVirtualMinute: z.number().int().nonnegative(),
  endVirtualMinute: z.number().int().nonnegative(),
  startWorldStateVersion: z.number().int().nonnegative(),
  endWorldStateVersion: z.number().int().nonnegative(),
  closedBy: LearnerCalibrationWindowClosedByV4Schema,
}).strict().superRefine((window, context) => {
  if (window.endVirtualMinute < window.startVirtualMinute) {
    context.addIssue({
      code: "custom",
      path: ["endVirtualMinute"],
      message: "实际校准观察窗口结束分钟不能早于开始分钟",
    });
  }
  if (window.endWorldStateVersion < window.startWorldStateVersion) {
    context.addIssue({
      code: "custom",
      path: ["endWorldStateVersion"],
      message: "实际校准观察窗口结束世界版本不能早于开始版本",
    });
  }
});
export type LearnerCalibrationObservationWindowV4 = z.infer<
  typeof LearnerCalibrationObservationWindowV4Schema
>;

const references = (max: number) => z.array(V2IdentifierSchema).max(max);

export const LearnerCalibrationEvidenceRefsV4Schema = z.object({
  committedWorldEventRefs: references(256),
  studentActionRefs: references(256),
  consequenceRefs: references(256),
  variableRefs: references(48),
  factRefs: references(48),
  workRefs: references(32),
  teacherGateRefs: references(24),
}).strict();
export type LearnerCalibrationEvidenceRefsV4 = z.infer<
  typeof LearnerCalibrationEvidenceRefsV4Schema
>;

const NonEmptyTextSchema = z.string().trim().min(1).max(500);

export const LearnerCalibrationResultV4Schema = z.object({
  policyVersion: LearnerCalibrationPolicyVersionV4Schema,
  outcome: LearnerCalibrationOutcomeV4Schema,
  observedBehaviorAlignment: z.number().min(0).max(1),
  observationWindow: LearnerCalibrationObservationWindowV4Schema,
  evidence: LearnerCalibrationEvidenceRefsV4Schema,
  completionBasis: z.array(NonEmptyTextSchema).min(1).max(8),
  unmetRequirements: z.array(NonEmptyTextSchema).max(8),
}).strict();
export type LearnerCalibrationResultV4 = z.infer<
  typeof LearnerCalibrationResultV4Schema
>;

export const LearnerCalibrationPublicSummaryV4Schema = z.object({
  policyVersion: LearnerCalibrationDisplayPolicyVersionV4Schema,
  outcome: LearnerCalibrationOutcomeV4Schema,
  observedBehaviorAlignment: z.number().min(0).max(1),
  observationWindow: LearnerCalibrationObservationWindowV4Schema,
  completionBasis: z.array(NonEmptyTextSchema).min(1).max(8),
  unmetRequirements: z.array(NonEmptyTextSchema).max(8),
}).strict();
export type LearnerCalibrationPublicSummaryV4 = z.infer<
  typeof LearnerCalibrationPublicSummaryV4Schema
>;
