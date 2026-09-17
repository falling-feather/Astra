import {
  CourseEnrollmentSchema,
  CourseOutcomeMutationReceiptSchema,
  CourseProgressListSchema,
  CourseRubricCriterionSchema,
  CourseSourceRecordSchema,
  CourseReviewTaskListSchema,
  CourseReviewWorkspaceSchema,
  LearningActivitySchema,
  PrincipalSchema,
  RoleBindingSchema,
  SessionExperienceDescriptorResponseSchema,
  StudentTrainingMutationReceiptSchema,
  StudentTrainingContextSchema,
  StudentCollaborationEpisodeSchema,
  StudentPortfolioSchema,
  V2IdentifierSchema,
  type CourseEnrollment,
  type CourseOutcomeMutationReceipt,
  type CourseProgressList,
  type CourseReviewTaskList,
  type CourseReviewWorkspace,
  type LearningActivity,
  type SessionExperienceDescriptor,
  type StudentPortfolio,
  type StudentTrainingMutationReceipt,
  type StudentTrainingContext,
  type StudentCollaborationEpisode,
} from "@ronggang/contracts";
import type {
  CourseReleaseDetailChapter,
  CourseReleaseDetailView,
  CourseReleaseSummary,
  DemoAuthContext,
} from "./models";
import type { TeacherGateMutationReceipt } from "./teacher-models";

export class WireFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WireFormatError";
  }
}

function objectOf(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WireFormatError(`${label} 必须是对象`);
  }
  return value as Record<string, unknown>;
}

function exactObject(
  value: unknown,
  keys: readonly string[],
  label: string,
): Record<string, unknown> {
  const object = objectOf(value, label);
  const actual = Object.keys(object).sort();
  const expected = [...keys].sort();
  if (actual.join("\u0000") !== expected.join("\u0000")) {
    throw new WireFormatError(`${label} 字段不符合冻结接口`);
  }
  return object;
}

function stringOf(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new WireFormatError(`${label} 必须是非空字符串`);
  }
  return value;
}

function integerOf(value: unknown, label: string, minimum: number): number {
  if (!Number.isInteger(value) || (value as number) < minimum) {
    throw new WireFormatError(`${label} 必须是大于等于 ${minimum} 的整数`);
  }
  return value as number;
}

function literalOf<T extends string>(
  value: unknown,
  expected: T,
  label: string,
): T {
  if (value !== expected) {
    throw new WireFormatError(`${label} 必须为 ${expected}`);
  }
  return expected;
}

function dateTimeOf(value: unknown, label: string): string {
  const text = stringOf(value, label);
  if (!Number.isFinite(Date.parse(text))) {
    throw new WireFormatError(`${label} 必须是 ISO 日期时间`);
  }
  return text;
}

function contentHashOf(value: unknown): string {
  const hash = stringOf(value, "contentHash");
  if (!/^[a-f0-9]{64}$/u.test(hash)) {
    throw new WireFormatError("contentHash 必须是 64 位小写十六进制");
  }
  return hash;
}

function boundedTextOf(value: unknown, label: string, maximum: number): string {
  const text = stringOf(value, label).trim();
  if (text.length === 0 || text.length > maximum) {
    throw new WireFormatError(`${label} 长度不符合冻结接口`);
  }
  return text;
}

function identifierOf(value: unknown, label: string): string {
  const parsed = V2IdentifierSchema.safeParse(value);
  if (!parsed.success) throw new WireFormatError(`${label} 不是合法标识`);
  return parsed.data;
}

function identifierListOf(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): string[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw new WireFormatError(`${label} 数量不符合冻结接口`);
  }
  const items = value.map((item, index) => identifierOf(item, `${label}[${index}]`));
  if (new Set(items).size !== items.length) {
    throw new WireFormatError(`${label} 不得包含重复标识`);
  }
  return items;
}

function textListOf(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
  itemMaximum: number,
): string[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw new WireFormatError(`${label} 数量不符合冻结接口`);
  }
  return value.map((item, index) => (
    boundedTextOf(item, `${label}[${index}]`, itemMaximum)
  ));
}

function parseCourseDetailChapter(
  value: unknown,
  index: number,
): CourseReleaseDetailChapter {
  const label = `CourseReleaseDetailView.chapters[${index}]`;
  const object = exactObject(value, [
    "chapterId",
    "order",
    "title",
    "objective",
    "taskBrief",
    "publicSourceRefs",
    "deliverableIds",
    "evidenceRequirements",
    "rubricCriteria",
    "transferReflection",
    "finalChapter",
  ], label);
  if (!Array.isArray(object.rubricCriteria)
    || object.rubricCriteria.length < 1
    || object.rubricCriteria.length > 12) {
    throw new WireFormatError(`${label}.rubricCriteria 数量不符合冻结接口`);
  }
  const rubricCriteria = object.rubricCriteria.map((criterion) => (
    CourseRubricCriterionSchema.parse(criterion)
  ));
  if (rubricCriteria.reduce((sum, item) => sum + item.weight, 0) !== 100) {
    throw new WireFormatError(`${label}.rubricCriteria 权重必须合计 100`);
  }
  if (typeof object.finalChapter !== "boolean") {
    throw new WireFormatError(`${label}.finalChapter 必须为布尔值`);
  }
  return {
    chapterId: identifierOf(object.chapterId, `${label}.chapterId`),
    order: integerOf(object.order, `${label}.order`, 1),
    title: boundedTextOf(object.title, `${label}.title`, 240),
    objective: boundedTextOf(object.objective, `${label}.objective`, 1_000),
    taskBrief: boundedTextOf(object.taskBrief, `${label}.taskBrief`, 2_000),
    publicSourceRefs: identifierListOf(
      object.publicSourceRefs,
      `${label}.publicSourceRefs`,
      1,
      32,
    ),
    deliverableIds: identifierListOf(
      object.deliverableIds,
      `${label}.deliverableIds`,
      1,
      16,
    ),
    evidenceRequirements: textListOf(
      object.evidenceRequirements,
      `${label}.evidenceRequirements`,
      1,
      16,
      500,
    ),
    rubricCriteria,
    transferReflection: boundedTextOf(
      object.transferReflection,
      `${label}.transferReflection`,
      1_000,
    ),
    finalChapter: object.finalChapter,
  };
}

export function parseCourseReleaseDetailView(
  value: unknown,
): CourseReleaseDetailView {
  const object = exactObject(value, [
    "schemaVersion",
    "releaseStatus",
    "courseId",
    "courseReleaseId",
    "releaseId",
    "version",
    "contentHash",
    "title",
    "summary",
    "primaryJob",
    "sources",
    "chapters",
    "studentDecisionOptions",
    "publishedAt",
  ], "CourseReleaseDetailView");
  const courseReleaseId = identifierOf(
    object.courseReleaseId,
    "CourseReleaseDetailView.courseReleaseId",
  );
  const releaseId = identifierOf(
    object.releaseId,
    "CourseReleaseDetailView.releaseId",
  );
  if (courseReleaseId !== releaseId) {
    throw new WireFormatError("CourseReleaseDetailView 双发布标识必须一致");
  }
  const primaryJob = exactObject(object.primaryJob, [
    "jobId",
    "title",
    "studentRoleId",
  ], "CourseReleaseDetailView.primaryJob");
  if (!Array.isArray(object.sources)
    || object.sources.length < 1
    || object.sources.length > 120) {
    throw new WireFormatError("CourseReleaseDetailView.sources 数量不符合冻结接口");
  }
  const sources = object.sources.map((source) => CourseSourceRecordSchema.parse(source));
  if (!Array.isArray(object.chapters)
    || object.chapters.length < 5
    || object.chapters.length > 8) {
    throw new WireFormatError("CourseReleaseDetailView.chapters 数量不符合冻结接口");
  }
  const chapters = object.chapters.map(parseCourseDetailChapter);
  if (new Set(chapters.map((chapter) => chapter.chapterId)).size !== chapters.length) {
    throw new WireFormatError("CourseReleaseDetailView 章节 ID 必须唯一");
  }
  const sourceIds = new Set(sources.map((source) => source.sourceId));
  chapters.forEach((chapter, index) => {
    if (chapter.order !== index + 1) {
      throw new WireFormatError("CourseReleaseDetailView 章节顺序必须连续");
    }
    if (chapter.publicSourceRefs.some((sourceRef) => !sourceIds.has(sourceRef))) {
      throw new WireFormatError("CourseReleaseDetailView 章节引用了未登记来源");
    }
  });
  if (
    chapters.filter((chapter) => chapter.finalChapter).length !== 1
    || chapters.at(-1)?.finalChapter !== true
  ) {
    throw new WireFormatError("CourseReleaseDetailView 只能把最后一节标为最终成果");
  }
  if (!Array.isArray(object.studentDecisionOptions)
    || object.studentDecisionOptions.length !== 3
    || object.studentDecisionOptions[0] !== "accept"
    || object.studentDecisionOptions[1] !== "request_evidence"
    || object.studentDecisionOptions[2] !== "reject") {
    throw new WireFormatError("CourseReleaseDetailView 学生决定集合不符合冻结接口");
  }
  const publishedAt = stringOf(object.publishedAt, "CourseReleaseDetailView.publishedAt");
  if (Number.isNaN(Date.parse(publishedAt)) || !publishedAt.includes("T")) {
    throw new WireFormatError("CourseReleaseDetailView.publishedAt 必须为日期时间");
  }
  return {
    schemaVersion: literalOf(
      object.schemaVersion,
      "course-release-detail/2.0.0",
      "CourseReleaseDetailView.schemaVersion",
    ),
    releaseStatus: literalOf(
      object.releaseStatus,
      "released",
      "CourseReleaseDetailView.releaseStatus",
    ),
    courseId: identifierOf(object.courseId, "CourseReleaseDetailView.courseId"),
    courseReleaseId,
    releaseId,
    version: integerOf(object.version, "CourseReleaseDetailView.version", 1),
    contentHash: contentHashOf(object.contentHash),
    title: boundedTextOf(object.title, "CourseReleaseDetailView.title", 240),
    summary: boundedTextOf(object.summary, "CourseReleaseDetailView.summary", 2_000),
    primaryJob: {
      jobId: literalOf(
        primaryJob.jobId,
        "integrated_media_reporter",
        "CourseReleaseDetailView.primaryJob.jobId",
      ),
      title: literalOf(
        primaryJob.title,
        "融媒体采编岗",
        "CourseReleaseDetailView.primaryJob.title",
      ),
      studentRoleId: literalOf(
        primaryJob.studentRoleId,
        "reporter",
        "CourseReleaseDetailView.primaryJob.studentRoleId",
      ),
    },
    sources,
    chapters,
    studentDecisionOptions: ["accept", "request_evidence", "reject"],
    publishedAt,
  };
}

export function parseCourseReleaseSummary(
  value: unknown,
): CourseReleaseSummary {
  const object = exactObject(value, [
    "schemaVersion",
    "courseId",
    "courseReleaseId",
    "releaseId",
    "version",
    "contentHash",
    "title",
    "summary",
    "primaryJob",
    "chapterCount",
    "sourceCount",
    "publishedAt",
  ], "CourseReleaseSummary");
  const primaryJob = exactObject(object.primaryJob, [
    "jobId",
    "title",
    "studentRoleId",
  ], "CourseReleaseSummary.primaryJob");
  const courseReleaseId = stringOf(
    object.courseReleaseId,
    "CourseReleaseSummary.courseReleaseId",
  );
  const releaseId = stringOf(
    object.releaseId,
    "CourseReleaseSummary.releaseId",
  );
  if (courseReleaseId !== releaseId) {
    throw new WireFormatError(
      "CourseReleaseSummary 的 courseReleaseId 与 releaseId 必须一致",
    );
  }
  return {
    schemaVersion: literalOf(
      object.schemaVersion,
      "course-release-summary/2.0.0",
      "CourseReleaseSummary.schemaVersion",
    ),
    courseId: stringOf(object.courseId, "CourseReleaseSummary.courseId"),
    courseReleaseId,
    releaseId,
    version: integerOf(object.version, "CourseReleaseSummary.version", 1),
    contentHash: contentHashOf(object.contentHash),
    title: stringOf(object.title, "CourseReleaseSummary.title"),
    summary: stringOf(object.summary, "CourseReleaseSummary.summary"),
    primaryJob: {
      jobId: literalOf(
        primaryJob.jobId,
        "integrated_media_reporter",
        "CourseReleaseSummary.primaryJob.jobId",
      ),
      title: literalOf(
        primaryJob.title,
        "融媒体采编岗",
        "CourseReleaseSummary.primaryJob.title",
      ),
      studentRoleId: literalOf(
        primaryJob.studentRoleId,
        "reporter",
        "CourseReleaseSummary.primaryJob.studentRoleId",
      ),
    },
    chapterCount: integerOf(
      object.chapterCount,
      "CourseReleaseSummary.chapterCount",
      1,
    ),
    sourceCount: integerOf(
      object.sourceCount,
      "CourseReleaseSummary.sourceCount",
      1,
    ),
    publishedAt: dateTimeOf(
      object.publishedAt,
      "CourseReleaseSummary.publishedAt",
    ),
  };
}

export function parseCoursesResponse(value: unknown): CourseReleaseSummary[] {
  const wrapper = exactObject(value, ["courses"], "课程目录响应");
  if (!Array.isArray(wrapper.courses)) {
    throw new WireFormatError("课程目录响应 courses 必须是数组");
  }
  return wrapper.courses.map(parseCourseReleaseSummary);
}

export function parseCourseResponse(value: unknown): CourseReleaseDetailView {
  const wrapper = exactObject(value, ["course"], "课程详情响应");
  return parseCourseReleaseDetailView(wrapper.course);
}

export function parseCourseProgressResponse(value: unknown): CourseProgressList {
  const wrapper = exactObject(value, ["progress"], "课程进度响应");
  return CourseProgressListSchema.parse(wrapper.progress);
}

export function parseStudentPortfolioResponse(value: unknown): StudentPortfolio {
  const wrapper = exactObject(value, ["portfolio"], "学生作品集响应");
  return StudentPortfolioSchema.parse(wrapper.portfolio);
}

export function parseCourseReviewResponse(value: unknown): CourseReviewWorkspace {
  const wrapper = exactObject(value, ["review"], "课程复核响应");
  return CourseReviewWorkspaceSchema.parse(wrapper.review);
}

export function parseCourseReviewTasksResponse(value: unknown): CourseReviewTaskList {
  const wrapper = exactObject(value, ["tasks"], "课程复核任务响应");
  return CourseReviewTaskListSchema.parse(wrapper.tasks);
}

export function parseCourseOutcomeMutationReceipt(
  value: unknown,
): CourseOutcomeMutationReceipt {
  const wrapper = exactObject(value, ["receipt"], "课程成果写入回执");
  return CourseOutcomeMutationReceiptSchema.parse(wrapper.receipt);
}

export function parseEnrollmentsResponse(value: unknown): CourseEnrollment[] {
  const wrapper = exactObject(value, ["enrollments"], "课程认领响应");
  if (!Array.isArray(wrapper.enrollments)) {
    throw new WireFormatError("课程认领响应 enrollments 必须是数组");
  }
  return wrapper.enrollments.map((item) => CourseEnrollmentSchema.parse(item));
}

export function parseClaimResponse(value: unknown): CourseEnrollment {
  const wrapper = exactObject(value, ["enrollment"], "认领课程响应");
  return CourseEnrollmentSchema.parse(wrapper.enrollment);
}

export function parseLearningActivityResponse(value: unknown): LearningActivity {
  const wrapper = exactObject(value, ["activity"], "学习活动响应");
  return LearningActivitySchema.parse(wrapper.activity);
}

export function parseSessionExperienceDescriptorResponse(
  value: unknown,
): SessionExperienceDescriptor {
  return SessionExperienceDescriptorResponseSchema.parse(value).descriptor;
}

export function parseStudentTrainingContextResponse(
  value: unknown,
): StudentTrainingContext {
  return StudentTrainingContextSchema.parse(value);
}

export function parseStudentTrainingMutationReceipt(
  value: unknown,
): StudentTrainingMutationReceipt {
  return StudentTrainingMutationReceiptSchema.parse(value);
}

export function parseTeacherGateMutationReceipt(
  value: unknown,
): TeacherGateMutationReceipt {
  const object = exactObject(value, [
    "schemaVersion",
    "accepted",
    "sessionId",
    "stateVersion",
    "gateId",
    "decision",
  ], "TeacherGateMutationReceipt");
  const decision = stringOf(
    object.decision,
    "TeacherGateMutationReceipt.decision",
  );
  if (!["approve", "request_evidence", "reject"].includes(decision)) {
    throw new WireFormatError("TeacherGateMutationReceipt.decision 非法");
  }
  if (object.accepted !== true) {
    throw new WireFormatError("TeacherGateMutationReceipt.accepted 必须为 true");
  }
  const sessionId = stringOf(
    object.sessionId,
    "TeacherGateMutationReceipt.sessionId",
  );
  const gateId = stringOf(object.gateId, "TeacherGateMutationReceipt.gateId");
  const identifierPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:/@-]*$/u;
  if (!identifierPattern.test(sessionId) || !identifierPattern.test(gateId)) {
    throw new WireFormatError("TeacherGateMutationReceipt 含非法标识符");
  }
  return {
    schemaVersion: literalOf(
      object.schemaVersion,
      "teacher-gate-mutation-receipt/2.0.0",
      "TeacherGateMutationReceipt.schemaVersion",
    ),
    accepted: true,
    sessionId,
    stateVersion: integerOf(
      object.stateVersion,
      "TeacherGateMutationReceipt.stateVersion",
      0,
    ),
    gateId,
    decision: decision as TeacherGateMutationReceipt["decision"],
  };
}

export function parseStudentEpisodeResponse(
  value: unknown,
): StudentCollaborationEpisode {
  return StudentCollaborationEpisodeSchema.parse(value);
}

export interface DemoAuthExpectation {
  profileId?: string;
  sessionId?: string;
  now?: number;
}

export function parseDemoAuthContext(
  value: unknown,
  expectation: DemoAuthExpectation,
): DemoAuthContext {
  const object = exactObject(value, [
    "profileId",
    "principal",
    "bindings",
    "csrfToken",
    "expiresAt",
  ], "DemoAuthContext");
  if (!Array.isArray(object.bindings)) {
    throw new WireFormatError("DemoAuthContext.bindings 必须是数组");
  }
  const principal = PrincipalSchema.parse(object.principal);
  const bindings = object.bindings.map((item) => RoleBindingSchema.parse(item));
  const profileId = stringOf(object.profileId, "DemoAuthContext.profileId");
  const expiresAt = dateTimeOf(object.expiresAt, "DemoAuthContext.expiresAt");
  const now = expectation.now ?? Date.now();
  if (expectation.profileId !== undefined && profileId !== expectation.profileId) {
    throw new WireFormatError("演示身份与请求的 profileId 不一致");
  }
  if (principal.status !== "active") {
    throw new WireFormatError("演示身份 principal 不是 active 状态");
  }
  if (Date.parse(expiresAt) <= now) {
    throw new WireFormatError("演示身份会话已经过期");
  }
  for (const binding of bindings) {
    if (
      binding.principalId !== principal.principalId
      || binding.status !== "active"
      || binding.expiresAt === null
      || Date.parse(binding.expiresAt) <= now
    ) {
      throw new WireFormatError("演示身份包含无效、过期或越界岗位绑定");
    }
  }
  if (
    expectation.sessionId
    && !bindings.some((binding) => binding.sessionId === expectation.sessionId)
  ) {
    throw new WireFormatError("演示身份缺少当前训练会话岗位绑定");
  }
  return {
    profileId,
    principal,
    bindings,
    csrfToken: stringOf(object.csrfToken, "DemoAuthContext.csrfToken"),
    expiresAt,
  };
}
