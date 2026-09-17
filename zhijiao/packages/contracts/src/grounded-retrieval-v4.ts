import { z } from "zod";
import {
  CourseReleaseReferenceSchema,
  V2ContentHashSchema,
  V2IdentifierSchema,
} from "./course-learning.js";

export const GroundedRetrievalSchemaVersionV4 =
  "grounded-retrieval/4.0.0" as const;

const TimestampSchema = z.string().datetime();
const NonEmptyTextSchema = z.string().trim().min(1);

export const GroundedEvidenceAuthorizationFragmentV4Schema = z.object({
  knowledgeRef: V2IdentifierSchema,
  sourceDocumentRef: V2IdentifierSchema,
  sourceRevision: V2IdentifierSchema,
  fragmentRef: V2IdentifierSchema,
  fragmentHash: V2ContentHashSchema,
  sourceRef: V2IdentifierSchema,
  sourceKind: z.enum(["external_url", "app_document", "upload"]),
  sourceUrl: z.string().url().startsWith("https://").nullable(),
  sourceTitle: NonEmptyTextSchema.max(240),
  snippet: NonEmptyTextSchema.max(2_000),
  locator: NonEmptyTextSchema.max(500),
  objectRefs: z.array(V2IdentifierSchema).min(1).max(24),
  supportsClaimRefs: z.array(V2IdentifierSchema).min(1).max(16),
  evidenceKinds: z.array(V2IdentifierSchema).min(1).max(16),
  reviewStatus: z.enum(["pending_expert_review", "verified"]),
  effectiveAt: TimestampSchema,
  expiresAt: TimestampSchema.nullable(),
  revokedAt: TimestampSchema.nullable(),
}).strict();
export type GroundedEvidenceAuthorizationFragmentV4 = z.infer<
  typeof GroundedEvidenceAuthorizationFragmentV4Schema
>;

export const GroundedEvidenceAuthorizationV4Schema = z.object({
  schemaVersion: z.literal("grounded-evidence-authorization/4.0.0"),
  status: z.enum(["authorized", "empty", "forbidden"]),
  authorizationHash: V2ContentHashSchema,
  sessionId: V2IdentifierSchema,
  courseReleaseRef: CourseReleaseReferenceSchema,
  studentBindingHash: V2ContentHashSchema,
  purpose: z.literal("grounded_collaboration"),
  audience: z.literal("agent"),
  allowedObjectRefs: z.array(V2IdentifierSchema).min(1).max(24),
  allowedClaimRefs: z.array(V2IdentifierSchema).min(1).max(16),
  allowedKnowledgeRefs: z.array(V2IdentifierSchema).min(1).max(64),
  allowedSourceRevisionRefs: z.array(V2IdentifierSchema).max(64),
  allowedFragments: z.array(GroundedEvidenceAuthorizationFragmentV4Schema).max(64),
  expiredClaimRefs: z.array(V2IdentifierSchema).max(16),
  revokedClaimRefs: z.array(V2IdentifierSchema).max(16),
  grantedAt: TimestampSchema,
  expiresAt: TimestampSchema.nullable(),
  failureReason: NonEmptyTextSchema.max(500).nullable(),
}).strict().superRefine((scope, context) => {
  for (const [field, values] of [
    ["allowedObjectRefs", scope.allowedObjectRefs],
    ["allowedClaimRefs", scope.allowedClaimRefs],
    ["allowedKnowledgeRefs", scope.allowedKnowledgeRefs],
    ["allowedSourceRevisionRefs", scope.allowedSourceRevisionRefs],
  ] as const) {
    if (new Set(values).size !== values.length) {
      context.addIssue({
        code: "custom",
        path: [field],
        message: "授权引用不得重复",
      });
    }
  }
  if (scope.status === "authorized" && scope.allowedFragments.length === 0) {
    context.addIssue({
      code: "custom",
      path: ["allowedFragments"],
      message: "授权状态必须携带至少一个具体授权片段",
    });
  }
  if (scope.status !== "authorized" && scope.allowedFragments.length > 0) {
    context.addIssue({
      code: "custom",
      path: ["allowedFragments"],
      message: "未授权状态不得携带可用片段",
    });
  }
  if ((scope.status === "authorized") !== (scope.failureReason === null)) {
    context.addIssue({
      code: "custom",
      path: ["failureReason"],
      message: "授权成功不得有失败原因，失败授权必须保留原因",
    });
  }
});
export type GroundedEvidenceAuthorizationV4 = z.infer<
  typeof GroundedEvidenceAuthorizationV4Schema
>;
export const GroundedRetrievalAuthorizationScopeV4Schema =
  GroundedEvidenceAuthorizationV4Schema;
export type GroundedRetrievalAuthorizationScopeV4 = GroundedEvidenceAuthorizationV4;

export const GroundedRetrievalQueryV4Schema = z.object({
  queryId: V2IdentifierSchema,
  episodeTemplateRef: V2IdentifierSchema,
  moveKind: z.enum([
    "proposal",
    "challenge",
    "evidence_request",
    "revision",
    "joint_proposal",
  ]),
  queryText: NonEmptyTextSchema.max(2_000),
  claimRefs: z.array(V2IdentifierSchema).min(1).max(16),
  objectRefs: z.array(V2IdentifierSchema).min(1).max(24),
  evidenceKinds: z.array(V2IdentifierSchema).max(16),
  evidenceRefs: z.array(V2IdentifierSchema).max(32),
  evidenceSnapshotHash: V2ContentHashSchema,
  asOf: TimestampSchema,
  maxResults: z.number().int().min(1).max(32),
}).strict();
export type GroundedRetrievalQueryV4 = z.infer<
  typeof GroundedRetrievalQueryV4Schema
>;

export const GroundedRetrievalCitationV4Schema = z.object({
  knowledgeRef: V2IdentifierSchema,
  sourceDocumentRef: V2IdentifierSchema,
  sourceRevision: V2IdentifierSchema,
  fragmentRef: V2IdentifierSchema,
  fragmentHash: V2ContentHashSchema,
  sourceTitle: NonEmptyTextSchema.max(240),
  sourceRef: V2IdentifierSchema,
  sourceKind: z.enum(["external_url", "app_document", "upload"]),
  sourceUrl: z.string().url().startsWith("https://").nullable(),
  snippet: NonEmptyTextSchema.max(2_000),
  locator: NonEmptyTextSchema.max(500),
  objectRefs: z.array(V2IdentifierSchema).min(1).max(24),
  supportsClaimRefs: z.array(V2IdentifierSchema).min(1).max(16),
  evidenceKinds: z.array(V2IdentifierSchema).min(1).max(16),
  stance: z.enum(["supports", "refutes", "context"]),
  reviewStatus: z.enum(["pending_expert_review", "verified"]),
  effectiveAt: TimestampSchema,
  expiresAt: TimestampSchema.nullable(),
  revokedAt: TimestampSchema.nullable(),
}).strict();
export type GroundedRetrievalCitationV4 = z.infer<
  typeof GroundedRetrievalCitationV4Schema
>;

export const GroundedRetrievalResultV4Schema = z.object({
  schemaVersion: z.literal(GroundedRetrievalSchemaVersionV4),
  status: z.enum(["ok", "empty", "unavailable", "forbidden"]),
  queryHash: V2ContentHashSchema,
  resultHash: V2ContentHashSchema,
  authorizationHash: V2ContentHashSchema,
  citations: z.array(GroundedRetrievalCitationV4Schema).max(32),
  unresolvedClaimRefs: z.array(V2IdentifierSchema).max(16),
  conflictRefs: z.array(V2IdentifierSchema).max(16),
  expiredClaimRefs: z.array(V2IdentifierSchema).max(16),
  revokedClaimRefs: z.array(V2IdentifierSchema).max(16),
  retrievedAt: TimestampSchema,
  failureReason: NonEmptyTextSchema.max(500).nullable(),
}).strict().superRefine((result, context) => {
  if (new Set(result.citations.map((citation) => citation.fragmentRef)).size
    !== result.citations.length) {
    context.addIssue({
      code: "custom",
      path: ["citations"],
      message: "检索结果片段引用不得重复",
    });
  }
  const shouldBeEmpty = result.status === "empty"
    || result.status === "unavailable"
    || result.status === "forbidden";
  if (shouldBeEmpty && result.citations.length > 0) {
    context.addIssue({
      code: "custom",
      path: ["citations"],
      message: "无结果或失败检索不得携带可用片段",
    });
  }
  if (result.status === "ok" && result.citations.length === 0) {
    context.addIssue({
      code: "custom",
      path: ["citations"],
      message: "成功检索必须返回至少一个可复核片段",
    });
  }
  if ((result.status === "ok") !== (result.failureReason === null)) {
    context.addIssue({
      code: "custom",
      path: ["failureReason"],
      message: "成功检索不得有失败原因，失败检索必须保留原因",
    });
  }
});
export type GroundedRetrievalResultV4 = z.infer<
  typeof GroundedRetrievalResultV4Schema
>;

export const GroundedCollaborationPlanStepV4Schema = z.object({
  stepId: V2IdentifierSchema,
  moveKind: z.enum([
    "proposal",
    "challenge",
    "evidence_request",
    "revision",
    "joint_proposal",
  ]),
  agentTemplateRef: V2IdentifierSchema,
  position: z.enum(["propose", "challenge", "needs_evidence", "revise", "joint"]),
  safeSummary: NonEmptyTextSchema.max(900),
  rationale: NonEmptyTextSchema.max(1_200),
  stopCondition: z.enum(["continue", "request_evidence", "revise", "joint", "stop"]),
}).strict();
export type GroundedCollaborationPlanStepV4 = z.infer<
  typeof GroundedCollaborationPlanStepV4Schema
>;

export const GroundedCollaborationPlanV4Schema = z.object({
  schemaVersion: z.literal(GroundedRetrievalSchemaVersionV4),
  planId: V2IdentifierSchema,
  retrievalQueryHash: V2ContentHashSchema,
  retrievalResultHash: V2ContentHashSchema,
  steps: z.array(GroundedCollaborationPlanStepV4Schema).min(2).max(16),
  unresolvedClaimRefs: z.array(V2IdentifierSchema).max(16),
  conflictRefs: z.array(V2IdentifierSchema).max(16),
  plannerState: z.enum(["sufficient", "conflicted", "missing_evidence", "revoked_evidence"]),
  publicSummary: NonEmptyTextSchema.max(1_000),
  recommendedActionRefs: z.array(V2IdentifierSchema).min(1).max(8),
}).strict().superRefine((plan, context) => {
  if (new Set(plan.steps.map((step) => step.stepId)).size !== plan.steps.length) {
    context.addIssue({
      code: "custom",
      path: ["steps"],
      message: "计划步骤 ID 不得重复",
    });
  }
  if (plan.steps[0]?.moveKind !== "proposal"
    || plan.steps.at(-1)?.moveKind !== "joint_proposal") {
    context.addIssue({
      code: "custom",
      path: ["steps"],
      message: "计划必须从 proposal 开始并以 joint_proposal 收口",
    });
  }
});
export type GroundedCollaborationPlanV4 = z.infer<
  typeof GroundedCollaborationPlanV4Schema
>;

export const GroundedCollaborationRefreshRecordV4Schema = z.object({
  refreshId: V2IdentifierSchema,
  previousRequestHash: V2ContentHashSchema,
  previousRetrieval: GroundedRetrievalResultV4Schema.nullable(),
  previousAuthorization: GroundedEvidenceAuthorizationV4Schema.nullable(),
  previousPlan: GroundedCollaborationPlanV4Schema.nullable(),
  addedEvidenceRefs: z.array(V2IdentifierSchema).max(32),
  refreshedAt: TimestampSchema,
}).strict();
export type GroundedCollaborationRefreshRecordV4 = z.infer<
  typeof GroundedCollaborationRefreshRecordV4Schema
>;
