import {
  AdapterCapabilitySchema,
  GovernanceDomainSchema,
  GovernanceNodeSnapshotSchema,
  MaterialSchema,
} from "@ronggang/contracts";
import { z } from "zod";

export const MediaProcessingWorkItemStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
]);
export type MediaProcessingWorkItemStatus = z.infer<
  typeof MediaProcessingWorkItemStatusSchema
>;

export const MediaProcessingWorkLeaseSchema = z.object({
  ownerId: z.string().min(1),
  token: z.string().min(1),
  acquiredAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
}).strict();

export const MediaProcessingWorkItemSchema = z.object({
  workItemId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  sessionId: z.string().min(1),
  sessionEpoch: z.string().min(1),
  taskId: z.string().min(1),
  stepId: z.string().min(1),
  capability: AdapterCapabilitySchema,
  governanceDomain: GovernanceDomainSchema.nullable().default(null),
  governanceNode: GovernanceNodeSnapshotSchema.nullable().default(null),
  branchPriority: z.number().int().nullable().default(null),
  timeoutMs: z.number().int().positive().max(300_000).default(120_000),
  attemptNumber: z.number().int().positive(),
  inputRef: z.string().min(1),
  inputContentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  mediaType: MaterialSchema.shape.mediaType,
  status: MediaProcessingWorkItemStatusSchema,
  claimCount: z.number().int().nonnegative(),
  lease: MediaProcessingWorkLeaseSchema.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  lastErrorCode: z.string().min(1).nullable(),
}).strict();
export type MediaProcessingWorkItem = z.infer<
  typeof MediaProcessingWorkItemSchema
>;

export const MediaProcessingWorkAttemptSchema = z.object({
  attemptId: z.string().min(1),
  workItemId: z.string().min(1),
  sessionId: z.string().min(1),
  taskId: z.string().min(1),
  stepId: z.string().min(1),
  claimNumber: z.number().int().positive(),
  workerId: z.string().min(1),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  outcome: z.enum([
    "completed",
    "failed",
    "lease_expired",
    "released",
    "duplicate_suppressed",
  ]),
  errorCode: z.string().min(1).nullable(),
}).strict();
export type MediaProcessingWorkAttempt = z.infer<
  typeof MediaProcessingWorkAttemptSchema
>;
