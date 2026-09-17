import { z } from "zod";
import {
  AwaitingReviewCourseEnrollmentSchema,
  ClaimedCourseEnrollmentSchema,
  CompletedCourseEnrollmentSchema,
  CourseReleaseReferenceSchema,
  InProgressCourseEnrollmentSchema,
  V2ContentHashSchema,
  V2IdentifierSchema,
} from "./course-learning.js";

export const CourseProgressListSchemaVersion =
  "course-progress-list/2.0.0" as const;
export const StudentPortfolioSchemaVersion =
  "student-portfolio/2.0.0" as const;
export const CourseReviewWorkspaceSchemaVersion =
  "course-review-workspace/2.0.0" as const;
export const CourseOutcomeMutationReceiptSchemaVersion =
  "course-outcome-receipt/2.0.0" as const;
export const CourseReviewTaskListSchemaVersion =
  "course-review-task-list/2.0.0" as const;

export const CourseProgressReviewStatusSchema = z.enum([
  "not_submitted",
  "awaiting_review",
  "completed",
]);
export type CourseProgressReviewStatus = z.infer<
  typeof CourseProgressReviewStatusSchema
>;

export const CourseProgressItemSchema = z.object({
  enrollment: z.union([
    ClaimedCourseEnrollmentSchema,
    InProgressCourseEnrollmentSchema,
    AwaitingReviewCourseEnrollmentSchema,
    CompletedCourseEnrollmentSchema,
  ]),
  chapterCount: z.number().int().min(5).max(8),
  completedChapterIds: z.array(V2IdentifierSchema).max(8),
  currentChapterId: V2IdentifierSchema.nullable(),
  submittedDeliverableCount: z.number().int().nonnegative().max(64),
  portfolioItemCount: z.number().int().nonnegative().max(64),
  evidenceCount: z.number().int().nonnegative().max(256),
  reviewStatus: CourseProgressReviewStatusSchema,
}).strict().superRefine((item, context) => {
  if (new Set(item.completedChapterIds).size !== item.completedChapterIds.length) {
    context.addIssue({
      code: "custom",
      path: ["completedChapterIds"],
      message: "已完成章节 ID 不得重复",
    });
  }
  if (item.completedChapterIds.length > item.chapterCount) {
    context.addIssue({
      code: "custom",
      path: ["completedChapterIds"],
      message: "已完成章节数不得超过课程章节总数",
    });
  }
  if (
    item.currentChapterId !== null
    && item.completedChapterIds.includes(item.currentChapterId)
  ) {
    context.addIssue({
      code: "custom",
      path: ["currentChapterId"],
      message: "当前章节不能同时出现在已完成章节集合中",
    });
  }
  if (item.enrollment.status === "claimed") {
    if (
      item.currentChapterId !== null
      || item.completedChapterIds.length !== 0
      || item.submittedDeliverableCount !== 0
      || item.portfolioItemCount !== 0
      || item.evidenceCount !== 0
      || item.reviewStatus !== "not_submitted"
    ) {
      context.addIssue({
        code: "custom",
        path: ["enrollment", "status"],
        message: "claimed courses cannot expose runtime progress or outcomes",
      });
    }
    return;
  }
  if (item.enrollment.status === "in_progress") {
    const allChaptersCompleted = item.completedChapterIds.length
      === item.chapterCount;
    if (
      item.reviewStatus !== "not_submitted"
      || (item.currentChapterId === null) !== allChaptersCompleted
      || (
        allChaptersCompleted
        && (
          item.submittedDeliverableCount < 1
          || item.portfolioItemCount < 1
          || item.evidenceCount < 1
        )
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["currentChapterId"],
        message: "进行中课程须保留当前章节，或冻结全部章节成果后进入提交准备态",
      });
    }
    return;
  }
  if (item.currentChapterId !== null) {
    context.addIssue({
      code: "custom",
      path: ["currentChapterId"],
      message: "待复核或已完成课程不得继续携带当前章节",
    });
  }
  const expectedReviewStatus = item.enrollment.status === "awaiting_review"
    ? "awaiting_review"
    : "completed";
  if (
    item.reviewStatus !== expectedReviewStatus
    || item.completedChapterIds.length !== item.chapterCount
    || item.submittedDeliverableCount < 1
    || item.portfolioItemCount < 1
    || item.evidenceCount < 1
  ) {
    context.addIssue({
      code: "custom",
      path: ["reviewStatus"],
      message: "待复核与已完成课程必须冻结全部章节、成果和证据",
    });
  }
});
export type CourseProgressItem = z.infer<typeof CourseProgressItemSchema>;

export const CourseProgressListSchema = z.object({
  schemaVersion: z.literal(CourseProgressListSchemaVersion),
  generatedAt: z.string().datetime(),
  items: z.array(CourseProgressItemSchema).max(64),
}).strict().superRefine((value, context) => {
  const enrollmentIds = value.items.map((item) => item.enrollment.enrollmentId);
  if (new Set(enrollmentIds).size !== enrollmentIds.length) {
    context.addIssue({
      code: "custom",
      path: ["items"],
      message: "课程进度不得重复认领记录",
    });
  }
});
export type CourseProgressList = z.infer<typeof CourseProgressListSchema>;

export const CoursePortfolioItemKindSchema = z.enum([
  "task_outcome",
  "interview_record",
  "article",
  "short_video_plan",
  "channel_variant",
]);
export type CoursePortfolioItemKind = z.infer<
  typeof CoursePortfolioItemKindSchema
>;

export const StudentPortfolioEvidenceSchema = z.object({
  evidenceId: V2IdentifierSchema,
  enrollmentId: V2IdentifierSchema,
  courseReleaseRef: CourseReleaseReferenceSchema,
  sessionId: V2IdentifierSchema,
  title: z.string().trim().min(1).max(240),
  basis: z.string().trim().min(1).max(2_000),
  artifactRevisionRefs: z.array(V2IdentifierSchema).max(64),
  createdAt: z.string().datetime(),
}).strict();
export type StudentPortfolioEvidence = z.infer<
  typeof StudentPortfolioEvidenceSchema
>;

export const StudentPortfolioItemSchema = z.object({
  portfolioItemId: V2IdentifierSchema,
  enrollmentId: V2IdentifierSchema,
  courseReleaseRef: CourseReleaseReferenceSchema,
  sessionId: V2IdentifierSchema,
  artifactId: V2IdentifierSchema,
  revisionId: V2IdentifierSchema,
  chapterId: V2IdentifierSchema,
  deliverableIds: z.array(V2IdentifierSchema).min(1).max(16),
  origin: z.enum(["student_artifact", "server_process_record"]),
  title: z.string().trim().min(1).max(240),
  kind: CoursePortfolioItemKindSchema,
  status: z.enum(["draft", "submitted"]),
  revisionNumber: z.number().int().positive(),
  summary: z.string().trim().min(1).max(1_200),
  contentHash: V2ContentHashSchema,
  evidenceIds: z.array(V2IdentifierSchema).max(256),
  updatedAt: z.string().datetime(),
}).strict();
export type StudentPortfolioItem = z.infer<typeof StudentPortfolioItemSchema>;

export const StudentPortfolioSchema = z.object({
  schemaVersion: z.literal(StudentPortfolioSchemaVersion),
  generatedAt: z.string().datetime(),
  items: z.array(StudentPortfolioItemSchema).max(256),
  evidence: z.array(StudentPortfolioEvidenceSchema).max(1_024),
}).strict().superRefine((value, context) => {
  const itemIds = value.items.map((item) => item.portfolioItemId);
  const evidenceIds = value.evidence.map((item) => item.evidenceId);
  if (new Set(itemIds).size !== itemIds.length) {
    context.addIssue({
      code: "custom",
      path: ["items"],
      message: "作品集条目 ID 不得重复",
    });
  }
  if (new Set(evidenceIds).size !== evidenceIds.length) {
    context.addIssue({
      code: "custom",
      path: ["evidence"],
      message: "作品集证据 ID 不得重复",
    });
  }
  const knownEvidenceIds = new Set(evidenceIds);
  const referencedEvidenceIds = new Set(
    value.items.flatMap((item) => item.evidenceIds),
  );
  const knownRevisionIds = new Set(value.items.map((item) => item.revisionId));
  value.evidence.forEach((evidence, index) => {
    if (!referencedEvidenceIds.has(evidence.evidenceId)) {
      context.addIssue({
        code: "custom",
        path: ["evidence", index, "evidenceId"],
        message: "作品集不得携带未被任何成果引用的无关证据",
      });
    }
    if (
      new Set(evidence.artifactRevisionRefs).size
        !== evidence.artifactRevisionRefs.length
      || evidence.artifactRevisionRefs.some((ref) => !knownRevisionIds.has(ref))
    ) {
      context.addIssue({
        code: "custom",
        path: ["evidence", index, "artifactRevisionRefs"],
        message: "作品集证据只能引用响应中已授权的成果版本",
      });
    }
  });
  value.items.forEach((item, index) => {
    if (new Set(item.deliverableIds).size !== item.deliverableIds.length) {
      context.addIssue({
        code: "custom",
        path: ["items", index, "deliverableIds"],
        message: "作品成果引用不得重复",
      });
    }
    if (new Set(item.evidenceIds).size !== item.evidenceIds.length) {
      context.addIssue({
        code: "custom",
        path: ["items", index, "evidenceIds"],
        message: "作品证据引用不得重复",
      });
    }
    for (const evidenceId of item.evidenceIds) {
      if (!knownEvidenceIds.has(evidenceId)) {
        context.addIssue({
          code: "custom",
          path: ["items", index, "evidenceIds"],
          message: "作品条目只能引用同一作品集响应中的证据",
        });
      }
    }
    const relatedEvidence = value.evidence.filter((evidence) => (
      item.evidenceIds.includes(evidence.evidenceId)
    ));
    for (const evidence of relatedEvidence) {
      if (
        evidence.enrollmentId !== item.enrollmentId
        || evidence.sessionId !== item.sessionId
        || evidence.courseReleaseRef.courseId !== item.courseReleaseRef.courseId
        || evidence.courseReleaseRef.releaseId !== item.courseReleaseRef.releaseId
        || evidence.courseReleaseRef.version !== item.courseReleaseRef.version
        || evidence.courseReleaseRef.contentHash !== item.courseReleaseRef.contentHash
        || !evidence.artifactRevisionRefs.includes(item.revisionId)
      ) {
        context.addIssue({
          code: "custom",
          path: ["items", index, "evidenceIds"],
          message: "portfolio evidence must belong to the same frozen enrollment and revision",
        });
      }
    }
  });
});
export type StudentPortfolio = z.infer<typeof StudentPortfolioSchema>;

export const CourseReviewRubricCriterionSnapshotSchema = z.object({
  criterionId: V2IdentifierSchema,
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(600),
  weight: z.number().int().positive().max(100),
  evidenceTypes: z.array(V2IdentifierSchema).min(1).max(12),
}).strict();

export const CourseReviewRubricChapterSnapshotSchema = z.object({
  chapterId: V2IdentifierSchema,
  title: z.string().trim().min(1).max(240),
  criteria: z.array(CourseReviewRubricCriterionSnapshotSchema).min(1).max(12),
}).strict().superRefine((chapter, context) => {
  const criterionIds = chapter.criteria.map((criterion) => criterion.criterionId);
  if (new Set(criterionIds).size !== criterionIds.length) {
    context.addIssue({
      code: "custom",
      path: ["criteria"],
      message: "章节量规标准 ID 不得重复",
    });
  }
  if (chapter.criteria.reduce((total, criterion) => total + criterion.weight, 0) !== 100) {
    context.addIssue({
      code: "custom",
      path: ["criteria"],
      message: "章节量规权重必须合计为 100",
    });
  }
});

export const CourseReviewSubmissionSchema = z.object({
  submissionId: V2IdentifierSchema,
  reviewTaskId: V2IdentifierSchema,
  enrollmentId: V2IdentifierSchema,
  courseReleaseRef: CourseReleaseReferenceSchema,
  sessionId: V2IdentifierSchema,
  submittedAt: z.string().datetime(),
  deliverableIds: z.array(V2IdentifierSchema).min(1).max(64),
  portfolioItemIds: z.array(V2IdentifierSchema).min(1).max(64),
  evidenceIds: z.array(V2IdentifierSchema).min(1).max(256),
  rubric: z.array(CourseReviewRubricChapterSnapshotSchema).min(5).max(8),
}).strict().superRefine((submission, context) => {
  for (const [field, refs] of [
    ["deliverableIds", submission.deliverableIds],
    ["portfolioItemIds", submission.portfolioItemIds],
    ["evidenceIds", submission.evidenceIds],
  ] as const) {
    if (new Set(refs).size !== refs.length) {
      context.addIssue({
        code: "custom",
        path: [field],
        message: "冻结提交引用不得重复",
      });
    }
  }
  const chapterIds = submission.rubric.map((chapter) => chapter.chapterId);
  if (new Set(chapterIds).size !== chapterIds.length) {
    context.addIssue({
      code: "custom",
      path: ["rubric"],
      message: "冻结量规章节不得重复",
    });
  }
});
export type CourseReviewSubmission = z.infer<
  typeof CourseReviewSubmissionSchema
>;

export const CourseReviewDimensionSchema = z.object({
  dimensionId: V2IdentifierSchema,
  label: z.string().trim().min(1).max(160),
  score: z.number().min(0).max(100),
  maxScore: z.number().positive().max(100),
  feedback: z.string().trim().min(1).max(1_200),
  evidenceRefs: z.array(V2IdentifierSchema).max(256),
}).strict().superRefine((dimension, context) => {
  if (dimension.score > dimension.maxScore) {
    context.addIssue({
      code: "custom",
      path: ["score"],
      message: "评价维度得分不得超过该维度满分",
    });
  }
  if (new Set(dimension.evidenceRefs).size !== dimension.evidenceRefs.length) {
    context.addIssue({
      code: "custom",
      path: ["evidenceRefs"],
      message: "评价证据引用不得重复",
    });
  }
});

export const CourseReviewResultSchema = z.object({
  reviewId: V2IdentifierSchema,
  finalScore: z.number().min(0).max(100),
  dimensions: z.array(CourseReviewDimensionSchema).min(1).max(64),
  publicSummary: z.string().trim().min(1).max(1_500),
  finalizedAt: z.string().datetime(),
}).strict().superRefine((review, context) => {
  const dimensionIds = review.dimensions.map((dimension) => (
    dimension.dimensionId
  ));
  if (new Set(dimensionIds).size !== dimensionIds.length) {
    context.addIssue({
      code: "custom",
      path: ["dimensions"],
      message: "公开评价维度 ID 不得重复",
    });
  }
});
export type CourseReviewResult = z.infer<typeof CourseReviewResultSchema>;

const CourseReviewWorkspaceSharedShape = {
  schemaVersion: z.literal(CourseReviewWorkspaceSchemaVersion),
  viewer: z.enum(["student", "teacher"]),
  generatedAt: z.string().datetime(),
};

export const CourseReviewNotSubmittedSchema = z.object({
  ...CourseReviewWorkspaceSharedShape,
  status: z.literal("not_submitted"),
  enrollment: InProgressCourseEnrollmentSchema,
  submission: z.null(),
  review: z.null(),
}).strict();

export const CourseReviewAwaitingSchema = z.object({
  ...CourseReviewWorkspaceSharedShape,
  status: z.literal("awaiting_review"),
  enrollment: AwaitingReviewCourseEnrollmentSchema,
  submission: CourseReviewSubmissionSchema,
  review: z.null(),
}).strict();

export const CourseReviewCompletedSchema = z.object({
  ...CourseReviewWorkspaceSharedShape,
  status: z.literal("completed"),
  enrollment: CompletedCourseEnrollmentSchema,
  submission: CourseReviewSubmissionSchema,
  review: CourseReviewResultSchema,
}).strict();

export const CourseReviewWorkspaceSchema = z.discriminatedUnion("status", [
  CourseReviewNotSubmittedSchema,
  CourseReviewAwaitingSchema,
  CourseReviewCompletedSchema,
]).superRefine((workspace, context) => {
  if (workspace.status === "not_submitted") return;
  const enrollment = workspace.enrollment;
  const submission = workspace.submission;
  if (
    submission.enrollmentId !== enrollment.enrollmentId
    || submission.sessionId !== enrollment.activeSessionId
    || submission.courseReleaseRef.courseId
      !== enrollment.courseReleaseRef.courseId
    || submission.courseReleaseRef.releaseId
      !== enrollment.courseReleaseRef.releaseId
    || submission.courseReleaseRef.version
      !== enrollment.courseReleaseRef.version
    || submission.courseReleaseRef.contentHash
      !== enrollment.courseReleaseRef.contentHash
  ) {
    context.addIssue({
      code: "custom",
      path: ["submission"],
      message: "复核工作区必须与认领时冻结的课程、会话和发布哈希一致",
    });
  }
  for (const [field, refs] of [
    ["deliverableIds", submission.deliverableIds],
    ["portfolioItemIds", submission.portfolioItemIds],
    ["evidenceIds", submission.evidenceIds],
  ] as const) {
    if (new Set(refs).size !== refs.length) {
      context.addIssue({
        code: "custom",
        path: ["submission", field],
        message: "冻结提交中的引用不得重复",
      });
    }
  }
  if (workspace.status === "completed") {
    const submittedEvidenceIds = new Set(submission.evidenceIds);
    workspace.review.dimensions.forEach((dimension, index) => {
      if (dimension.evidenceRefs.some((ref) => !submittedEvidenceIds.has(ref))) {
        context.addIssue({
          code: "custom",
          path: ["review", "dimensions", index, "evidenceRefs"],
          message: "公开评价只能引用冻结提交中的证据",
        });
      }
    });
  }
});
export type CourseReviewWorkspace = z.infer<
  typeof CourseReviewWorkspaceSchema
>;

export const CourseSubmissionRequestSchema = z.object({
  bindingId: V2IdentifierSchema,
  expectedEnrollmentStateVersion: z.number().int().nonnegative(),
  requestId: V2IdentifierSchema,
}).strict();
export type CourseSubmissionRequest = z.infer<
  typeof CourseSubmissionRequestSchema
>;

export const CourseReviewFinalizeRequestSchema = z.object({
  bindingId: V2IdentifierSchema,
  reviewTaskId: V2IdentifierSchema,
  expectedEnrollmentStateVersion: z.number().int().nonnegative(),
  requestId: V2IdentifierSchema,
}).strict();
export type CourseReviewFinalizeRequest = z.infer<
  typeof CourseReviewFinalizeRequestSchema
>;

export const CourseReviewTaskSchema = z.object({
  reviewTaskId: V2IdentifierSchema,
  enrollmentId: V2IdentifierSchema,
  learnerRef: V2IdentifierSchema,
  courseReleaseRef: CourseReleaseReferenceSchema,
  sessionId: V2IdentifierSchema,
  status: z.enum(["awaiting_review", "completed"]),
  stateVersion: z.number().int().positive(),
  submittedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
}).strict();
export type CourseReviewTask = z.infer<typeof CourseReviewTaskSchema>;

export const CourseReviewTaskListSchema = z.object({
  schemaVersion: z.literal(CourseReviewTaskListSchemaVersion),
  generatedAt: z.string().datetime(),
  sessionId: V2IdentifierSchema,
  items: z.array(CourseReviewTaskSchema).max(256),
}).strict().superRefine((value, context) => {
  const taskIds = value.items.map((item) => item.reviewTaskId);
  if (new Set(taskIds).size !== taskIds.length) {
    context.addIssue({
      code: "custom",
      path: ["items"],
      message: "教师复核任务 ID 不得重复",
    });
  }
  value.items.forEach((item, index) => {
    if (item.sessionId !== value.sessionId) {
      context.addIssue({
        code: "custom",
        path: ["items", index, "sessionId"],
        message: "教师复核任务必须属于列表声明的训练会话",
      });
    }
  });
});
export type CourseReviewTaskList = z.infer<
  typeof CourseReviewTaskListSchema
>;

export const CourseOutcomeMutationReceiptSchema = z.object({
  schemaVersion: z.literal(CourseOutcomeMutationReceiptSchemaVersion),
  accepted: z.literal(true),
  requestId: V2IdentifierSchema,
  sessionId: V2IdentifierSchema,
  enrollmentId: V2IdentifierSchema,
  status: z.enum(["awaiting_review", "completed"]),
  stateVersion: z.number().int().positive(),
}).strict();
export type CourseOutcomeMutationReceipt = z.infer<
  typeof CourseOutcomeMutationReceiptSchema
>;
