import { mkdir, open, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  CourseEnrollmentSchema,
  CourseOutcomeMutationReceiptSchema,
  CourseReviewResultSchema,
  CourseReviewSubmissionSchema,
  StudentPortfolioSchema,
  StudentPortfolioSchemaVersion,
  StudentPortfolioEvidenceSchema,
  StudentPortfolioItemSchema,
} from "@ronggang/contracts";
import { z } from "zod";
import type {
  CourseEnrollmentStore,
  StoredCourseEnrollment,
} from "./course-learning.js";

const HashSchema = z.string().regex(/^[a-f0-9]{64}$/u);

const StoredOutcomeIdempotencySchema = z.object({
  requestId: z.string().trim().min(1).max(240),
  requestHash: HashSchema,
  receipt: CourseOutcomeMutationReceiptSchema,
}).strict();

const StoredCourseOutcomeSchema = z.object({
  submissionRequest: StoredOutcomeIdempotencySchema.nullable(),
  reviewRequest: StoredOutcomeIdempotencySchema.nullable(),
  submission: CourseReviewSubmissionSchema.nullable(),
  portfolioItems: z.array(StudentPortfolioItemSchema).max(256),
  evidence: z.array(StudentPortfolioEvidenceSchema).max(1_024),
  review: CourseReviewResultSchema.nullable(),
}).strict();

const CompletedLearningSummarySchema = z.object({
  portfolioItemIds: z.array(z.string().trim().min(1).max(240)).min(1).max(256),
  evidenceIds: z.array(z.string().trim().min(1).max(240)).min(1).max(1_024),
  reviewId: z.string().trim().min(1).max(240),
}).strict().superRefine((summary, context) => {
  for (const [field, refs] of [
    ["portfolioItemIds", summary.portfolioItemIds],
    ["evidenceIds", summary.evidenceIds],
  ] as const) {
    if (new Set(refs).size !== refs.length) {
      context.addIssue({
        code: "custom",
        path: [field],
        message: "完成引用不得重复",
      });
    }
  }
});

const StoredCourseEnrollmentSchema = z.object({
  principalId: z.string().trim().min(1).max(240),
  enrollment: CourseEnrollmentSchema,
  submittedDeliverableIds: z.array(
    z.string().trim().min(1).max(240),
  ).max(128),
  completion: CompletedLearningSummarySchema.nullable(),
  outcome: StoredCourseOutcomeSchema.optional(),
}).strict().superRefine((record, context) => {
  const sameSet = (left: readonly string[], right: readonly string[]) => (
    left.length === right.length
    && new Set(left).size === left.length
    && new Set(right).size === right.length
    && left.every((value) => right.includes(value))
    && right.every((value) => left.includes(value))
  );
  const deliverables = record.submittedDeliverableIds;
  if (new Set(deliverables).size !== deliverables.length) {
    context.addIssue({
      code: "custom",
      path: ["submittedDeliverableIds"],
      message: "冻结成果引用不得重复",
    });
  }
  const outcome = record.outcome;
  const status = record.enrollment.status;
  if (outcome) {
    const portfolio = StudentPortfolioSchema.safeParse({
      schemaVersion: StudentPortfolioSchemaVersion,
      generatedAt: record.enrollment.updatedAt,
      items: outcome.portfolioItems,
      evidence: outcome.evidence,
    });
    if (!portfolio.success) {
      context.addIssue({
        code: "custom",
        path: ["outcome"],
        message: "持久化课程作品与证据交叉引用不一致",
      });
    }
    const sessionId = record.enrollment.activeSessionId;
    if (
      outcome.submission
      && (
        outcome.submission.enrollmentId !== record.enrollment.enrollmentId
        || outcome.submission.sessionId !== sessionId
        || outcome.submission.courseReleaseRef.courseId
          !== record.enrollment.courseReleaseRef.courseId
        || outcome.submission.courseReleaseRef.releaseId
          !== record.enrollment.courseReleaseRef.releaseId
        || outcome.submission.courseReleaseRef.version
          !== record.enrollment.courseReleaseRef.version
        || outcome.submission.courseReleaseRef.contentHash
          !== record.enrollment.courseReleaseRef.contentHash
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["outcome", "submission"],
        message: "持久化提交与冻结认领记录不一致",
      });
    }
    for (const [field, request, expectedStatus] of [
      ["submissionRequest", outcome.submissionRequest, "awaiting_review"],
      ["reviewRequest", outcome.reviewRequest, "completed"],
    ] as const) {
      if (
        request
        && (
          request.receipt.requestId !== request.requestId
          || request.receipt.enrollmentId !== record.enrollment.enrollmentId
          || request.receipt.sessionId !== sessionId
          || request.receipt.status !== expectedStatus
        )
      ) {
        context.addIssue({
          code: "custom",
          path: ["outcome", field],
          message: "持久化幂等回执与原请求或冻结认领记录不一致",
        });
      }
    }
  }
  if (status === "claimed" || status === "in_progress") {
    if (
      record.completion !== null
      || deliverables.length !== 0
      || (
        outcome !== undefined
        && (
          outcome.submission !== null
          || outcome.review !== null
          || outcome.submissionRequest !== null
          || outcome.reviewRequest !== null
          || outcome.portfolioItems.length !== 0
          || outcome.evidence.length !== 0
        )
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["enrollment", "status"],
        message: "未提交课程不得携带冻结成果或评价",
      });
    }
    return;
  }
  if (
    !outcome?.submission
    || !outcome.submissionRequest
    || outcome.portfolioItems.length === 0
    || outcome.evidence.length === 0
    || deliverables.length === 0
  ) {
    context.addIssue({
      code: "custom",
      path: ["outcome"],
      message: "待复核或已完成课程必须保存冻结提交、作品、证据与幂等回执",
    });
    return;
  }
  const portfolioItemIds = outcome.portfolioItems.map((item) => (
    item.portfolioItemId
  ));
  const evidenceIds = outcome.evidence.map((item) => item.evidenceId);
  if (
    !sameSet(record.submittedDeliverableIds, outcome.submission.deliverableIds)
    || !sameSet(outcome.submission.portfolioItemIds, portfolioItemIds)
    || !sameSet(outcome.submission.evidenceIds, evidenceIds)
    || outcome.portfolioItems.some((item) => (
      item.enrollmentId !== record.enrollment.enrollmentId
      || item.sessionId !== record.enrollment.activeSessionId
      || item.courseReleaseRef.courseId
        !== record.enrollment.courseReleaseRef.courseId
      || item.courseReleaseRef.releaseId
        !== record.enrollment.courseReleaseRef.releaseId
      || item.courseReleaseRef.version
        !== record.enrollment.courseReleaseRef.version
      || item.courseReleaseRef.contentHash
        !== record.enrollment.courseReleaseRef.contentHash
    ))
    || outcome.evidence.some((item) => (
      item.enrollmentId !== record.enrollment.enrollmentId
      || item.sessionId !== record.enrollment.activeSessionId
      || item.courseReleaseRef.courseId
        !== record.enrollment.courseReleaseRef.courseId
      || item.courseReleaseRef.releaseId
        !== record.enrollment.courseReleaseRef.releaseId
      || item.courseReleaseRef.version
        !== record.enrollment.courseReleaseRef.version
      || item.courseReleaseRef.contentHash
        !== record.enrollment.courseReleaseRef.contentHash
    ))
  ) {
    context.addIssue({
      code: "custom",
      path: ["outcome", "submission"],
      message: "冻结提交必须与认领、成果、证据和交付物集合完全一致",
    });
  }
  if (status === "awaiting_review") {
    if (
      record.completion !== null
      || outcome.review !== null
      || outcome.reviewRequest !== null
    ) {
      context.addIssue({
        code: "custom",
        path: ["enrollment", "status"],
        message: "待复核课程不得提前保存完成结果",
      });
    }
    if (
      outcome.submissionRequest.receipt.stateVersion
        !== record.enrollment.stateVersion
    ) {
      context.addIssue({
        code: "custom",
        path: ["outcome", "submissionRequest", "receipt", "stateVersion"],
        message: "提交回执版本必须等于待复核认领版本",
      });
    }
    return;
  }
  if (!record.completion || !outcome.review || !outcome.reviewRequest) {
    context.addIssue({
      code: "custom",
      path: ["enrollment", "status"],
      message: "已完成课程必须保存权威评价、完成引用与复核幂等回执",
    });
    return;
  }
  const submittedEvidenceIds = new Set(outcome.submission.evidenceIds);
  if (
    !sameSet(record.completion.portfolioItemIds, portfolioItemIds)
    || !sameSet(record.completion.evidenceIds, evidenceIds)
    || record.completion.reviewId !== outcome.review.reviewId
    || outcome.review.dimensions.some((dimension) => (
      dimension.evidenceRefs.some((ref) => !submittedEvidenceIds.has(ref))
    ))
    || outcome.reviewRequest.receipt.stateVersion
      !== record.enrollment.stateVersion
    || outcome.submissionRequest.receipt.stateVersion
      !== record.enrollment.stateVersion - 1
  ) {
    context.addIssue({
      code: "custom",
      path: ["completion"],
      message: "完成引用、权威评价证据与两次冻结回执版本必须完全一致",
    });
  }
});

const CourseEnrollmentStoreFrameSchema = z.object({
  kind: z.literal("course_enrollment_snapshot"),
  formatVersion: z.literal(1),
  sequence: z.number().int().positive(),
  writtenAt: z.string().datetime(),
  records: z.array(StoredCourseEnrollmentSchema).max(10_000),
}).strict().superRefine((frame, context) => {
  const keys = frame.records.map((record) => (
    `${record.principalId}:${record.enrollment.courseReleaseRef.courseId}`
  ));
  const enrollmentIds = frame.records.map((record) => (
    record.enrollment.enrollmentId
  ));
  if (new Set(keys).size !== keys.length) {
    context.addIssue({
      code: "custom",
      path: ["records"],
      message: "同一主体与课程只能保存一条认领快照",
    });
  }
  if (new Set(enrollmentIds).size !== enrollmentIds.length) {
    context.addIssue({
      code: "custom",
      path: ["records"],
      message: "课程认领 ID 不得重复",
    });
  }
});

type CourseEnrollmentStoreFrame = z.infer<
  typeof CourseEnrollmentStoreFrameSchema
>;

const pathLocks = new Map<string, Promise<void>>();

function recordKey(record: StoredCourseEnrollment): string {
  return `${record.principalId}:${record.enrollment.courseReleaseRef.courseId}`;
}

function cloneRecord(record: StoredCourseEnrollment): StoredCourseEnrollment {
  return structuredClone(record);
}

function sameStoredIdentity(
  left: StoredCourseEnrollment,
  right: StoredCourseEnrollment,
): boolean {
  return left.principalId === right.principalId
    && left.enrollment.enrollmentId === right.enrollment.enrollmentId
    && left.enrollment.courseReleaseRef.releaseId
      === right.enrollment.courseReleaseRef.releaseId
    && left.enrollment.courseReleaseRef.version
      === right.enrollment.courseReleaseRef.version
    && left.enrollment.courseReleaseRef.contentHash
      === right.enrollment.courseReleaseRef.contentHash
    && left.enrollment.claimedAt === right.enrollment.claimedAt
    && left.enrollment.primaryJobId === right.enrollment.primaryJobId
    && left.enrollment.primaryRoleId === right.enrollment.primaryRoleId;
}

async function appendAndSync(
  path: string,
  frame: CourseEnrollmentStoreFrame,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const handle = await open(path, "a");
  try {
    await handle.writeFile(`${JSON.stringify(frame)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function readLatestFrame(
  path: string,
): Promise<CourseEnrollmentStoreFrame | null> {
  let body: Buffer;
  try {
    body = await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (body.length === 0) return null;
  if (body.at(-1) !== 0x0a) {
    throw new Error("课程认领日志末尾帧不完整，拒绝恢复");
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch (error) {
    throw new Error("课程认领日志不是有效 UTF-8", { cause: error });
  }
  const lines = text.split("\n");
  lines.pop();
  let latest: CourseEnrollmentStoreFrame | null = null;
  for (const [index, line] of lines.entries()) {
    if (line.length === 0) {
      throw new Error(`课程认领日志第 ${index + 1} 行为空帧`);
    }
    let frame: CourseEnrollmentStoreFrame;
    try {
      frame = CourseEnrollmentStoreFrameSchema.parse(JSON.parse(line));
    } catch (error) {
      throw new Error(`课程认领日志第 ${index + 1} 行损坏`, {
        cause: error,
      });
    }
    if (frame.sequence !== index + 1) {
      throw new Error(`课程认领日志第 ${index + 1} 行序号漂移`);
    }
    latest = frame;
  }
  return latest;
}

/**
 * 本地原型的 append-only、fsync-backed 课程旅程存储。
 *
 * 每次写入在同一路径进程锁内重新读取最后快照，再执行 create/CAS 并
 * 追加完整新快照。多进程生产部署仍应替换为具备事务的数据库实现。
 */
export class JsonlCourseEnrollmentStore implements CourseEnrollmentStore {
  readonly #path: string;

  constructor(path: string) {
    this.#path = resolve(path);
  }

  async #withLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = pathLocks.get(this.#path) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const next = result.then(() => undefined, () => undefined);
    pathLocks.set(this.#path, next);
    try {
      return await result;
    } finally {
      if (pathLocks.get(this.#path) === next) pathLocks.delete(this.#path);
    }
  }

  async #readRecords(): Promise<StoredCourseEnrollment[]> {
    const frame = await readLatestFrame(this.#path);
    return (frame?.records ?? []).map((record) => cloneRecord(record));
  }

  async #persist(
    previous: CourseEnrollmentStoreFrame | null,
    records: readonly StoredCourseEnrollment[],
  ): Promise<void> {
    const frame = CourseEnrollmentStoreFrameSchema.parse({
      kind: "course_enrollment_snapshot",
      formatVersion: 1,
      sequence: (previous?.sequence ?? 0) + 1,
      writtenAt: new Date().toISOString(),
      records,
    });
    await appendAndSync(this.#path, frame);
  }

  async #mutate<T>(
    operation: (
      records: StoredCourseEnrollment[],
    ) => { changed: boolean; result: T },
  ): Promise<T> {
    return this.#withLock(async () => {
      const previous = await readLatestFrame(this.#path);
      const records = (previous?.records ?? []).map((record) => (
        cloneRecord(record)
      ));
      const mutation = operation(records);
      if (mutation.changed) await this.#persist(previous, records);
      return mutation.result;
    });
  }

  getByPrincipalAndCourse(
    principalId: string,
    courseId: string,
  ): Promise<StoredCourseEnrollment | null> {
    return this.#withLock(async () => {
      const record = (await this.#readRecords()).find((candidate) => (
        candidate.principalId === principalId
        && candidate.enrollment.courseReleaseRef.courseId === courseId
      ));
      return record ? cloneRecord(record) : null;
    });
  }

  listByPrincipal(principalId: string): Promise<StoredCourseEnrollment[]> {
    return this.#withLock(async () => (await this.#readRecords())
      .filter((record) => record.principalId === principalId)
      .sort((left, right) => (
        left.enrollment.claimedAt.localeCompare(right.enrollment.claimedAt)
        || left.enrollment.enrollmentId.localeCompare(
          right.enrollment.enrollmentId,
        )
      ))
      .map((record) => cloneRecord(record)));
  }

  getByPrincipalAndSession(
    principalId: string,
    sessionId: string,
  ): Promise<StoredCourseEnrollment | null> {
    return this.#withLock(async () => {
      const record = (await this.#readRecords()).find((candidate) => (
        candidate.principalId === principalId
        && candidate.enrollment.activeSessionId === sessionId
      ));
      return record ? cloneRecord(record) : null;
    });
  }

  listBySessionId(sessionId: string): Promise<StoredCourseEnrollment[]> {
    return this.#withLock(async () => (await this.#readRecords())
      .filter((record) => record.enrollment.activeSessionId === sessionId)
      .sort((left, right) => (
        left.enrollment.claimedAt.localeCompare(right.enrollment.claimedAt)
        || left.enrollment.enrollmentId.localeCompare(
          right.enrollment.enrollmentId,
        )
      ))
      .map((record) => cloneRecord(record)));
  }

  create(record: StoredCourseEnrollment): Promise<boolean> {
    const parsed = StoredCourseEnrollmentSchema.parse(record);
    return this.#mutate((records) => {
      const key = recordKey(parsed);
      if (records.some((candidate) => recordKey(candidate) === key)) {
        return { changed: false, result: false };
      }
      records.push(cloneRecord(parsed));
      return { changed: true, result: true };
    });
  }

  compareAndSwap(input: {
    record: StoredCourseEnrollment;
    expectedStateVersion: number;
  }): Promise<boolean> {
    const parsed = StoredCourseEnrollmentSchema.parse(input.record);
    return this.#mutate((records) => {
      const key = recordKey(parsed);
      const index = records.findIndex((candidate) => (
        recordKey(candidate) === key
      ));
      if (
        index < 0
        || records[index]!.enrollment.stateVersion
          !== input.expectedStateVersion
        || !sameStoredIdentity(records[index]!, parsed)
      ) {
        return { changed: false, result: false };
      }
      records[index] = cloneRecord(parsed);
      return { changed: true, result: true };
    });
  }

  put(record: StoredCourseEnrollment): Promise<void> {
    const parsed = StoredCourseEnrollmentSchema.parse(record);
    return this.#mutate((records) => {
      const key = recordKey(parsed);
      const index = records.findIndex((candidate) => (
        recordKey(candidate) === key
      ));
      if (index < 0) records.push(cloneRecord(parsed));
      else records[index] = cloneRecord(parsed);
      return { changed: true, result: undefined };
    });
  }
}
