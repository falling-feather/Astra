import { z } from "zod";

export const CourseReleaseSchemaVersion = "course-release/2.0.0" as const;
export const CourseEnrollmentSchemaVersion =
  "course-enrollment/2.0.0" as const;
export const LearningActivitySchemaVersion =
  "learning-activity/2.0.0" as const;

export const V2IdentifierSchema = z.string()
  .min(1)
  .max(320)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/@-]*$/u);
export const V2ContentHashSchema = z.string().regex(/^[a-f0-9]{64}$/u);

export const CourseReleaseReferenceSchema = z.object({
  courseId: V2IdentifierSchema,
  releaseId: V2IdentifierSchema,
  version: z.number().int().positive(),
  contentHash: V2ContentHashSchema,
}).strict();
export type CourseReleaseReference = z.infer<
  typeof CourseReleaseReferenceSchema
>;

export const ScenarioReleaseReferenceSchema = z.object({
  scenarioId: V2IdentifierSchema,
  version: z.string().trim().min(1).max(120),
  contentHash: V2ContentHashSchema,
}).strict();
export type ScenarioReleaseReference = z.infer<
  typeof ScenarioReleaseReferenceSchema
>;

export const CourseSourceReviewStatusSchema = z.enum([
  "verified",
  "pending_expert_review",
  "retired",
]);
export type CourseSourceReviewStatus = z.infer<
  typeof CourseSourceReviewStatusSchema
>;

export const CourseSourceRecordSchema = z.object({
  sourceId: V2IdentifierSchema,
  title: z.string().trim().min(1).max(500),
  publisher: z.string().trim().min(1).max(240),
  url: z.string().url().refine(
    (value) => value.startsWith("https://"),
    "课程公开来源必须使用 HTTPS",
  ),
  publishedAt: z.string().date().nullable(),
  accessedAt: z.string().date(),
  locator: z.string().trim().min(1).max(1_000),
  sourceVersion: z.string().trim().min(1).max(240),
  reviewStatus: CourseSourceReviewStatusSchema,
  copyrightNote: z.string().trim().min(1).max(1_000),
  excerpt: z.string().trim().min(1).max(280).nullable(),
}).strict();
export type CourseSourceRecord = z.infer<typeof CourseSourceRecordSchema>;

export const CourseRubricCriterionSchema = z.object({
  criterionId: V2IdentifierSchema,
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(600),
  weight: z.number().int().positive().max(100),
  evidenceTypes: z.array(V2IdentifierSchema).min(1).max(12),
}).strict();
export type CourseRubricCriterion = z.infer<
  typeof CourseRubricCriterionSchema
>;

export const CourseChapterSchema = z.object({
  chapterId: V2IdentifierSchema,
  order: z.number().int().positive(),
  title: z.string().trim().min(1).max(240),
  objective: z.string().trim().min(1).max(1_000),
  taskBrief: z.string().trim().min(1).max(2_000),
  publicSourceRefs: z.array(V2IdentifierSchema).min(1).max(32),
  hiddenFactRefs: z.array(V2IdentifierSchema).min(1).max(32),
  availableActionIds: z.array(V2IdentifierSchema).min(1).max(24),
  dynamicEventIds: z.array(V2IdentifierSchema).min(1).max(16),
  candidateAgentIds: z.array(V2IdentifierSchema).min(1).max(14),
  teacherGateIds: z.array(V2IdentifierSchema).min(1).max(8),
  deliverableIds: z.array(V2IdentifierSchema).min(1).max(16),
  evidenceRequirements: z.array(
    z.string().trim().min(1).max(500),
  ).min(1).max(16),
  rubricCriteria: z.array(CourseRubricCriterionSchema).min(1).max(12),
  transferReflection: z.string().trim().min(1).max(1_000),
  finalChapter: z.boolean(),
}).strict();
export type CourseChapter = z.infer<typeof CourseChapterSchema>;

export const CourseReleaseSchema = z.object({
  schemaVersion: z.literal(CourseReleaseSchemaVersion),
  releaseStatus: z.literal("released"),
  courseId: V2IdentifierSchema,
  releaseId: V2IdentifierSchema,
  version: z.number().int().positive(),
  contentHash: V2ContentHashSchema,
  title: z.string().trim().min(1).max(240),
  summary: z.string().trim().min(1).max(2_000),
  primaryJob: z.object({
    jobId: z.literal("integrated_media_reporter"),
    title: z.literal("融媒体采编岗"),
    studentRoleId: z.literal("reporter"),
  }).strict(),
  scenarioReleaseRef: ScenarioReleaseReferenceSchema,
  sources: z.array(CourseSourceRecordSchema).min(1).max(120),
  chapters: z.array(CourseChapterSchema).min(5).max(8),
  studentDecisionOptions: z.tuple([
    z.literal("accept"),
    z.literal("request_evidence"),
    z.literal("reject"),
  ]),
  publishedAt: z.string().datetime(),
}).strict().superRefine((release, context) => {
  const sourceIds = new Set(release.sources.map((source) => source.sourceId));
  const chapterIds = release.chapters.map((chapter) => chapter.chapterId);
  if (new Set(chapterIds).size !== chapterIds.length) {
    context.addIssue({
      code: "custom",
      path: ["chapters"],
      message: "课程章节 ID 必须唯一",
    });
  }
  const expectedOrders = release.chapters.map((_, index) => index + 1);
  release.chapters.forEach((chapter, index) => {
    if (chapter.order !== expectedOrders[index]) {
      context.addIssue({
        code: "custom",
        path: ["chapters", index, "order"],
        message: "课程章节顺序必须从 1 连续递增",
      });
    }
    for (const sourceRef of chapter.publicSourceRefs) {
      if (!sourceIds.has(sourceRef)) {
        context.addIssue({
          code: "custom",
          path: ["chapters", index, "publicSourceRefs"],
          message: "章节公开来源必须引用本发布版已登记来源",
        });
      }
    }
    const criterionWeight = chapter.rubricCriteria.reduce(
      (sum, criterion) => sum + criterion.weight,
      0,
    );
    if (criterionWeight !== 100) {
      context.addIssue({
        code: "custom",
        path: ["chapters", index, "rubricCriteria"],
        message: "每节量规权重必须合计 100",
      });
    }
  });
  if (release.chapters.filter((chapter) => chapter.finalChapter).length !== 1
    || release.chapters.at(-1)?.finalChapter !== true) {
    context.addIssue({
      code: "custom",
      path: ["chapters"],
      message: "课程只能把最后一节标记为最终成果章节",
    });
  }
  const dynamicEventIds = new Set(
    release.chapters.flatMap((chapter) => chapter.dynamicEventIds),
  );
  if (dynamicEventIds.size < 2) {
    context.addIssue({
      code: "custom",
      path: ["chapters"],
      message: "每门课程必须至少包含两项不同动态事件",
    });
  }
});
export type CourseRelease = z.infer<typeof CourseReleaseSchema>;

const CourseEnrollmentSharedShape = {
  schemaVersion: z.literal(CourseEnrollmentSchemaVersion),
  enrollmentId: V2IdentifierSchema,
  bindingId: V2IdentifierSchema,
  courseReleaseRef: CourseReleaseReferenceSchema,
  primaryJobId: z.literal("integrated_media_reporter"),
  primaryRoleId: z.literal("reporter"),
  claimedAt: z.string().datetime(),
  stateVersion: z.number().int().nonnegative(),
  updatedAt: z.string().datetime(),
};

export const ClaimedCourseEnrollmentSchema = z.object({
  ...CourseEnrollmentSharedShape,
  status: z.literal("claimed"),
  activeSessionId: z.null(),
  startedAt: z.null(),
  submittedAt: z.null(),
  completedAt: z.null(),
}).strict();

export const InProgressCourseEnrollmentSchema = z.object({
  ...CourseEnrollmentSharedShape,
  status: z.literal("in_progress"),
  activeSessionId: V2IdentifierSchema,
  startedAt: z.string().datetime(),
  submittedAt: z.null(),
  completedAt: z.null(),
}).strict();

export const AwaitingReviewCourseEnrollmentSchema = z.object({
  ...CourseEnrollmentSharedShape,
  status: z.literal("awaiting_review"),
  activeSessionId: V2IdentifierSchema,
  startedAt: z.string().datetime(),
  submittedAt: z.string().datetime(),
  completedAt: z.null(),
}).strict();

export const CompletedCourseEnrollmentSchema = z.object({
  ...CourseEnrollmentSharedShape,
  status: z.literal("completed"),
  activeSessionId: V2IdentifierSchema,
  startedAt: z.string().datetime(),
  submittedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
}).strict();

export const CourseEnrollmentSchema = z.discriminatedUnion("status", [
  ClaimedCourseEnrollmentSchema,
  InProgressCourseEnrollmentSchema,
  AwaitingReviewCourseEnrollmentSchema,
  CompletedCourseEnrollmentSchema,
]).superRefine((enrollment, context) => {
  const claimedAt = Date.parse(enrollment.claimedAt);
  const updatedAt = Date.parse(enrollment.updatedAt);
  const orderedDates = [
    enrollment.startedAt,
    enrollment.submittedAt,
    enrollment.completedAt,
  ].filter((value): value is string => value !== null).map(Date.parse);
  const lifecycleFields = [
    "startedAt",
    "submittedAt",
    "completedAt",
  ] as const;
  let previous = claimedAt;
  orderedDates.forEach((date, index) => {
    if (date < previous) {
      context.addIssue({
        code: "custom",
        path: [lifecycleFields[index] ?? "updatedAt"],
        message: "课程认领时间必须按认领、开始、提交、完成递增",
      });
    }
    previous = date;
  });
  if (updatedAt < previous) {
    context.addIssue({
      code: "custom",
      path: ["updatedAt"],
      message: "更新时间不得早于最后业务状态时间",
    });
  }
});
export type CourseEnrollment = z.infer<typeof CourseEnrollmentSchema>;

export const LearningActivityGuideStepSchema = z.object({
  stepId: V2IdentifierSchema,
  order: z.number().int().min(1).max(3),
  title: z.string().trim().min(1).max(120),
  instruction: z.string().trim().min(1).max(500),
  status: z.enum(["completed", "current", "pending"]),
}).strict();
export type LearningActivityGuideStep = z.infer<
  typeof LearningActivityGuideStepSchema
>;

export const LearningActivityTaskSchema = z.object({
  taskId: V2IdentifierSchema,
  chapterId: V2IdentifierSchema,
  title: z.string().trim().min(1).max(240),
  objective: z.string().trim().min(1).max(1_000),
  sceneId: V2IdentifierSchema,
  sourceEventId: V2IdentifierSchema.nullable(),
  priority: z.enum(["normal", "high", "urgent"]),
}).strict();
export type LearningActivityTask = z.infer<
  typeof LearningActivityTaskSchema
>;

const ActivitySharedShape = {
  schemaVersion: z.literal(LearningActivitySchemaVersion),
  bindingId: V2IdentifierSchema,
  stateVersion: z.number().int().nonnegative(),
  generatedAt: z.string().datetime(),
};

const ActivityPrimaryActionBase = {
  label: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(320),
};

export const EmptyLearningActivitySchema = z.object({
  ...ActivitySharedShape,
  status: z.literal("empty"),
  enrollment: z.null(),
  courseReleaseRef: z.null(),
  sessionId: z.null(),
  currentTask: z.null(),
  guideSteps: z.array(LearningActivityGuideStepSchema).length(0),
  submittedDeliverableIds: z.array(V2IdentifierSchema).length(0),
  completion: z.null(),
  primaryAction: z.object({
    ...ActivityPrimaryActionBase,
    actionId: z.literal("browse_courses"),
  }).strict(),
}).strict();

export const ReadyLearningActivitySchema = z.object({
  ...ActivitySharedShape,
  status: z.literal("ready"),
  enrollment: ClaimedCourseEnrollmentSchema,
  courseReleaseRef: CourseReleaseReferenceSchema,
  sessionId: z.null(),
  currentTask: z.null(),
  guideSteps: z.array(LearningActivityGuideStepSchema).length(0),
  submittedDeliverableIds: z.array(V2IdentifierSchema).length(0),
  completion: z.null(),
  primaryAction: z.object({
    ...ActivityPrimaryActionBase,
    actionId: z.literal("start_training"),
  }).strict(),
}).strict();

export const ActiveLearningActivitySchema = z.object({
  ...ActivitySharedShape,
  status: z.literal("active"),
  enrollment: InProgressCourseEnrollmentSchema,
  courseReleaseRef: CourseReleaseReferenceSchema,
  sessionId: V2IdentifierSchema,
  currentTask: LearningActivityTaskSchema,
  guideSteps: z.array(LearningActivityGuideStepSchema).length(3),
  submittedDeliverableIds: z.array(V2IdentifierSchema).max(64),
  completion: z.null(),
  primaryAction: z.object({
    ...ActivityPrimaryActionBase,
    actionId: z.literal("continue_task"),
  }).strict(),
}).strict();

export const AwaitingReviewLearningActivitySchema = z.object({
  ...ActivitySharedShape,
  status: z.literal("awaiting_review"),
  enrollment: AwaitingReviewCourseEnrollmentSchema,
  courseReleaseRef: CourseReleaseReferenceSchema,
  sessionId: V2IdentifierSchema,
  currentTask: z.null(),
  guideSteps: z.array(LearningActivityGuideStepSchema).length(0),
  submittedDeliverableIds: z.array(V2IdentifierSchema).min(1).max(64),
  completion: z.null(),
  primaryAction: z.object({
    ...ActivityPrimaryActionBase,
    actionId: z.literal("view_submission"),
  }).strict(),
}).strict();

export const CompletedLearningActivitySchema = z.object({
  ...ActivitySharedShape,
  status: z.literal("completed"),
  enrollment: CompletedCourseEnrollmentSchema,
  courseReleaseRef: CourseReleaseReferenceSchema,
  sessionId: V2IdentifierSchema,
  currentTask: z.null(),
  guideSteps: z.array(LearningActivityGuideStepSchema).length(0),
  submittedDeliverableIds: z.array(V2IdentifierSchema).min(1).max(64),
  completion: z.object({
    portfolioItemIds: z.array(V2IdentifierSchema).min(1).max(64),
    evidenceIds: z.array(V2IdentifierSchema).min(1).max(256),
    reviewId: V2IdentifierSchema,
  }).strict(),
  primaryAction: z.object({
    ...ActivityPrimaryActionBase,
    actionId: z.literal("review_learning"),
  }).strict(),
}).strict();

export const LearningActivitySchema = z.discriminatedUnion("status", [
  EmptyLearningActivitySchema,
  ReadyLearningActivitySchema,
  ActiveLearningActivitySchema,
  AwaitingReviewLearningActivitySchema,
  CompletedLearningActivitySchema,
]).superRefine((activity, context) => {
  if (activity.status === "empty") return;
  const activityRef = activity.courseReleaseRef;
  const enrollmentRef = activity.enrollment.courseReleaseRef;
  if (
    activityRef.courseId !== enrollmentRef.courseId
    || activityRef.releaseId !== enrollmentRef.releaseId
    || activityRef.version !== enrollmentRef.version
    || activityRef.contentHash !== enrollmentRef.contentHash
  ) {
    context.addIssue({
      code: "custom",
      path: ["courseReleaseRef"],
      message: "学习活动必须与认领时冻结的课程版本和内容哈希完全一致",
    });
  }
  if (
    activity.sessionId !== null
    && activity.sessionId !== activity.enrollment.activeSessionId
  ) {
    context.addIssue({
      code: "custom",
      path: ["sessionId"],
      message: "学习活动会话必须与认领记录中的活动会话一致",
    });
  }
  if (activity.status === "active") {
    const orders = activity.guideSteps.map((step) => step.order);
    if (orders.join(",") !== "1,2,3") {
      context.addIssue({
        code: "custom",
        path: ["guideSteps"],
        message: "活动中的三步指引必须按 1、2、3 排列",
      });
    }
    if (activity.guideSteps.filter((step) => step.status === "current").length !== 1) {
      context.addIssue({
        code: "custom",
        path: ["guideSteps"],
        message: "活动中的三步指引必须且只能有一个当前步骤",
      });
    }
  }
});
export type LearningActivity = z.infer<typeof LearningActivitySchema>;

export function courseReleaseReferenceOf(
  release: Pick<CourseRelease, "courseId" | "releaseId" | "version" | "contentHash">,
): CourseReleaseReference {
  return {
    courseId: release.courseId,
    releaseId: release.releaseId,
    version: release.version,
    contentHash: release.contentHash,
  };
}
