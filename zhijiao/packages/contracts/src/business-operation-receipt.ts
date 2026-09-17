import { z } from "zod";
import {
  V2ContentHashSchema,
  V2IdentifierSchema,
} from "./course-learning.js";

export const BusinessOperationReceiptSchemaVersion =
  "business-operation-receipt/4.0.0" as const;

export const BusinessOperationKindSchema = z.enum([
  "provision_second_session",
  "start_teaching_task",
  "submit_work_revision",
  "finalize_assessment",
]);
export type BusinessOperationKind = z.infer<
  typeof BusinessOperationKindSchema
>;

export const BusinessOperationPhaseSchema = z.enum([
  "requested",
  "authority_committed",
  "projections_pending",
  "completed",
  "recovery_required",
]);
export type BusinessOperationPhase = z.infer<
  typeof BusinessOperationPhaseSchema
>;

export const BusinessOperationOutboxStepSchema = z.enum([
  "start_second_world",
  "start_training_world",
  "claim_course_enrollment",
  "freeze_experience_descriptor",
  "create_learner_membership",
  "create_teacher_membership",
  "activate_control_session",
  "materialize_runtime_bindings",
  "refresh_assessment_projection",
  "refresh_learner_adaptation",
]);
export type BusinessOperationOutboxStep = z.infer<
  typeof BusinessOperationOutboxStepSchema
>;

export const BusinessOperationScopeSchema = z.object({
  sourceSessionId: V2IdentifierSchema,
  targetSessionId: V2IdentifierSchema.nullable(),
  artifactId: V2IdentifierSchema.nullable(),
}).strict();
export type BusinessOperationScope = z.infer<
  typeof BusinessOperationScopeSchema
>;

export const BusinessOperationOutboxItemSchema = z.object({
  outboxId: V2IdentifierSchema,
  step: BusinessOperationOutboxStepSchema,
  status: z.enum(["pending", "delivered"]),
  attempts: z.number().int().nonnegative().max(1_000),
  resultRef: V2IdentifierSchema.nullable(),
  lastErrorCode: z.string().regex(/^[a-z][a-z0-9_]{0,79}$/u).nullable(),
  deliveredAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime(),
}).strict().superRefine((item, context) => {
  if (item.status === "pending" && (
    item.resultRef !== null || item.deliveredAt !== null
  )) {
    context.addIssue({
      code: "custom",
      path: ["status"],
      message: "待投递 Outbox 不得提前携带投递结果",
    });
  }
  if (item.status === "delivered" && (
    item.attempts < 1
    || item.resultRef === null
    || item.lastErrorCode !== null
    || item.deliveredAt === null
  )) {
    context.addIssue({
      code: "custom",
      path: ["status"],
      message: "已投递 Outbox 必须携带一次以上尝试、结果引用和时间",
    });
  }
});
export type BusinessOperationOutboxItem = z.infer<
  typeof BusinessOperationOutboxItemSchema
>;

export const BusinessOperationRecoverySchema = z.object({
  reasonCode: z.string().regex(/^[a-z][a-z0-9_]{0,79}$/u),
  failedAt: z.string().datetime(),
  nextSafeAction: z.enum([
    "retry_authority",
    "resume_outbox",
    "manual_investigation",
  ]),
}).strict();
export type BusinessOperationRecovery = z.infer<
  typeof BusinessOperationRecoverySchema
>;

export const BusinessOperationReceiptSchema = z.object({
  schemaVersion: z.literal(BusinessOperationReceiptSchemaVersion),
  operationId: V2IdentifierSchema,
  operationKind: BusinessOperationKindSchema,
  requestId: V2IdentifierSchema,
  requestHash: V2ContentHashSchema,
  scope: BusinessOperationScopeSchema,
  phase: BusinessOperationPhaseSchema,
  revision: z.number().int().nonnegative(),
  authorityCommitRef: V2IdentifierSchema.nullable(),
  authorityCommittedAt: z.string().datetime().nullable(),
  outbox: z.array(BusinessOperationOutboxItemSchema).min(1).max(12),
  recovery: BusinessOperationRecoverySchema.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
}).strict().superRefine((receipt, context) => {
  const outboxIds = receipt.outbox.map((item) => item.outboxId);
  const steps = receipt.outbox.map((item) => item.step);
  if (new Set(outboxIds).size !== outboxIds.length) {
    context.addIssue({
      code: "custom",
      path: ["outbox"],
      message: "业务 Outbox ID 不得重复",
    });
  }
  if (new Set(steps).size !== steps.length) {
    context.addIssue({
      code: "custom",
      path: ["outbox"],
      message: "同一业务操作的 Outbox 步骤不得重复",
    });
  }
  if (Date.parse(receipt.updatedAt) < Date.parse(receipt.createdAt)) {
    context.addIssue({
      code: "custom",
      path: ["updatedAt"],
      message: "业务收据更新时间不得早于创建时间",
    });
  }
  const hasAuthority = receipt.authorityCommitRef !== null
    && receipt.authorityCommittedAt !== null;
  if ((receipt.authorityCommitRef === null)
    !== (receipt.authorityCommittedAt === null)) {
    context.addIssue({
      code: "custom",
      path: ["authorityCommitRef"],
      message: "权威提交引用与时间必须同时出现",
    });
  }
  const delivered = receipt.outbox.filter(
    (item) => item.status === "delivered",
  ).length;
  const pending = receipt.outbox.length - delivered;
  if (receipt.phase === "requested" && (
    hasAuthority
    || delivered !== 0
    || receipt.recovery !== null
    || receipt.completedAt !== null
  )) {
    context.addIssue({
      code: "custom",
      path: ["phase"],
      message: "requested 只能包含尚未权威提交的冻结请求",
    });
  }
  if (receipt.phase === "authority_committed" && (
    !hasAuthority
    || delivered !== 0
    || receipt.recovery !== null
    || receipt.completedAt !== null
  )) {
    context.addIssue({
      code: "custom",
      path: ["phase"],
      message: "authority_committed 必须已完成权威提交且尚未投递投影",
    });
  }
  if (receipt.phase === "projections_pending" && (
    !hasAuthority
    || delivered === 0
    || pending === 0
    || receipt.recovery !== null
    || receipt.completedAt !== null
  )) {
    context.addIssue({
      code: "custom",
      path: ["phase"],
      message: "projections_pending 必须存在已投递与待投递步骤",
    });
  }
  if (receipt.phase === "completed" && (
    !hasAuthority
    || pending !== 0
    || receipt.recovery !== null
    || receipt.completedAt === null
  )) {
    context.addIssue({
      code: "custom",
      path: ["phase"],
      message: "completed 必须完成权威提交和全部 Outbox",
    });
  }
  if (receipt.phase === "recovery_required" && (
    receipt.recovery === null || receipt.completedAt !== null
  )) {
    context.addIssue({
      code: "custom",
      path: ["phase"],
      message: "recovery_required 必须说明失败和下一安全动作",
    });
  }
  if (!hasAuthority && delivered > 0) {
    context.addIssue({
      code: "custom",
      path: ["outbox"],
      message: "权威提交前不得投递非权威投影",
    });
  }
});
export type BusinessOperationReceipt = z.infer<
  typeof BusinessOperationReceiptSchema
>;

export const BusinessOperationReceiptListResponseSchema = z.object({
  operations: z.array(BusinessOperationReceiptSchema).max(1_000),
}).strict();
export type BusinessOperationReceiptListResponse = z.infer<
  typeof BusinessOperationReceiptListResponseSchema
>;
