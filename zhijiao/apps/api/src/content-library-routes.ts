import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { ContentStore } from "@ronggang/content-store";
import { professionalTrainingPackage, xunpuFlagshipContentV4 } from "@ronggang/course-content";
import { GroundedKnowledgeClaimRelationsSchema } from "./content-grounded-retrieval.js";
import type { ContentIngestionService } from "./content-ingestion.js";
import type { ContentLibraryService } from "./content-library.js";
import { CourseLearningError } from "./course-learning.js";
import { readCourseCaseDossier } from "./course-case-library.js";
import { assertContentCourseAccess, type ContentLibraryIdentity } from "./content-library-authorization.js";
export type { ContentLibraryIdentity } from "./content-library-authorization.js";

const id = z.string().trim().min(1).max(240);
const empty = z.object({}).strict();
const courseQuery = z.object({ courseId: id, limit: z.coerce.number().int().min(1).max(200).optional() }).strict()
  .transform(({ courseId, limit }) => ({ courseId, ...(limit === undefined ? {} : { limit }) }));
const searchBody = z.object({ courseId: id, query: z.string().trim().min(1).max(2_000), limit: z.number().int().min(1).max(32).optional() }).strict()
  .transform(({ courseId, query, limit }) => ({ courseId, query, ...(limit === undefined ? {} : { limit }) }));
const uploadBytesLimit = 32 * 1024 * 1024;
const uploadBody = z.object({
  courseId: id,
  sourceKey: id,
  title: z.string().trim().min(1).max(240),
  kind: z.enum(["course_material", "interview", "user_upload", "simulation"]),
  fileName: z.string().trim().min(1).max(160),
  mimeType: z.enum(["application/pdf", "text/plain", "image/jpeg", "image/png", "audio/mpeg", "audio/wav", "video/mp4"]),
  contentBase64: z.string().min(4).max(Math.ceil(uploadBytesLimit / 3) * 4).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u),
  publisher: z.string().trim().min(1).max(240).optional(),
  canonicalUrl: z.string().url().startsWith("https://").optional(),
  rightsNote: z.string().trim().min(1).max(2_000),
  publicationDate: z.string().date().optional(),
  allowModelContext: z.boolean().default(false),
}).strict();

export interface ContentLibraryRouteDependencies {
  authorize(request: FastifyRequest, mutation: boolean, courseId?: string): ContentLibraryIdentity | Promise<ContentLibraryIdentity>;
  assertCourse(courseId: string): void;
  library(identity: ContentLibraryIdentity): Promise<ContentLibraryService>;
  store(): Promise<ContentStore>;
  ingestion(identity: ContentLibraryIdentity): Promise<ContentIngestionService>;
  indexRevision(revisionId: string, identity: ContentLibraryIdentity, courseId: string): Promise<{ indexed: number }>;
  indexCourse(courseId: string, identity: ContentLibraryIdentity): Promise<{ indexed: number }>;
  assertRevisionCourse(revisionId: string, identity: ContentLibraryIdentity, courseId: string): Promise<void>;
}

function requireStaff(identity: ContentLibraryIdentity): void {
  if (identity.role === "student") throw new CourseLearningError("access_denied", "资料维护与课程发布由教师或管理员操作");
}

export async function registerContentLibraryRoutes(app: FastifyInstance, dependencies: ContentLibraryRouteDependencies): Promise<void> {
  app.get("/api/content-library/professional-tasks", async (request) => {
    const { courseId } = z.object({ courseId: id }).strict().parse(request.query);
    const identity = await dependencies.authorize(request, false, courseId);
    assertContentCourseAccess(identity, courseId);
    dependencies.assertCourse(courseId);
    return { package: courseId === "course-xunpu-intangible-media" ? {
      packageId: professionalTrainingPackage.packageId, title: professionalTrainingPackage.title,
      reviewBoundary: professionalTrainingPackage.reviewBoundary, tasks: professionalTrainingPackage.tasks,
    } : null };
  });
  app.get("/api/content-library/case-dossier", async (request) => {
    const { courseId } = z.object({ courseId: id }).strict().parse(request.query);
    const identity = await dependencies.authorize(request, false, courseId);
    assertContentCourseAccess(identity, courseId);
    dependencies.assertCourse(courseId);
    return { result: await readCourseCaseDossier(await dependencies.store(), courseId, identity.role) };
  });
  app.get("/api/content-library/sources", async (request) => {
    const query = courseQuery.parse(request.query);
    const identity = await dependencies.authorize(request, false);
    requireStaff(identity);
    dependencies.assertCourse(query.courseId);
    return { sources: await (await dependencies.library(identity)).listSourceDocuments(query) };
  });
  app.get("/api/content-library/knowledge", async (request) => {
    const query = courseQuery.parse(request.query);
    const identity = await dependencies.authorize(request, false);
    requireStaff(identity);
    dependencies.assertCourse(query.courseId);
    return { knowledge: await (await dependencies.library(identity)).listKnowledge(query) };
  });
  app.post("/api/content-library/search", async (request) => {
    empty.parse(request.query);
    const body = searchBody.parse(request.body);
    const identity = await dependencies.authorize(request, false, body.courseId);
    assertContentCourseAccess(identity, body.courseId);
    dependencies.assertCourse(body.courseId);
    return { result: await (await dependencies.library(identity)).retrieve({
      ...body, purpose: "retrieval", subjectRef: identity.principalId,
    }) };
  });
  app.post("/api/content-library/materials", { bodyLimit: 48 * 1024 * 1024 }, async (request, reply) => {
    empty.parse(request.query);
    const body = uploadBody.parse(request.body);
    const identity = await dependencies.authorize(request, true);
    requireStaff(identity);
    dependencies.assertCourse(body.courseId);
    const bytes = Buffer.from(body.contentBase64, "base64");
    if (bytes.length === 0 || bytes.length > uploadBytesLimit || bytes.toString("base64") !== body.contentBase64) {
      throw new CourseLearningError("version_hash_drift", "资料正文编码无效或超过 32 MB 上限");
    }
    const sourceId = `material-${createHash("sha256").update(JSON.stringify([identity.principalId, body.courseId, body.sourceKey])).digest("hex").slice(0, 32)}`;
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.raw.once("aborted", abort);
    try {
      const ingestion = await dependencies.ingestion(identity);
      const { allowModelContext } = body;
      const result = await ingestion.ingestBytes({
        sourceId,
        courseId: body.courseId,
        title: body.title,
        kind: body.kind,
        fileName: body.fileName,
        mimeType: body.mimeType,
        publisher: body.publisher ?? null,
        canonicalUrl: body.canonicalUrl ?? null,
        rightsNote: body.rightsNote,
        publicationDate: body.publicationDate ?? null,
        bytes,
        storageSessionId: `content-${createHash("sha256").update(body.courseId).digest("hex").slice(0, 24)}`,
        purpose: "retrieval",
        scope: "course",
        subjectRef: null,
        grantedBy: identity.principalId,
        signal: controller.signal,
      });
      const parsedRevisionId = result.parsedRevisionId ?? (typeof result.job.outputMetadata?.parsedRevisionId === "string" ? result.job.outputMetadata.parsedRevisionId : null);
      let indexing: { status: "ready" | "failed" | "not_processed"; indexed: number; message?: string } = { status: "not_processed", indexed: 0 };
      if (parsedRevisionId && (result.status === "completed" || result.status === "already_completed")) {
        const store = await dependencies.store();
        await store.grantUsage({ sourceRevisionId: parsedRevisionId, courseId: body.courseId, purpose: "teaching", scope: "course", grantedBy: identity.principalId });
        if (allowModelContext) await store.grantUsage({ sourceRevisionId: parsedRevisionId, courseId: body.courseId, purpose: "model_context", scope: "course", grantedBy: identity.principalId });
        try {
          const indexed = await dependencies.indexRevision(parsedRevisionId, identity, body.courseId);
          indexing = { status: "ready", indexed: indexed.indexed };
        } catch (error) {
          request.log.error({ err: error, sourceId, parsedRevisionId }, "content embedding failed after material was persisted");
          indexing = { status: "failed", indexed: 0, message: "原件和解析结果已保存，语义索引未完成；修复本地索引运行环境后可重试。" };
        }
      }
      reply.code(result.status === "completed" ? 201 : 200);
      return { material: {
        sourceId,
        status: result.status,
        assetId: result.asset.assetId,
        sourceByteHash: result.asset.sourceByteHash,
        rawRevisionId: result.rawRevisionId,
        parsedRevisionId,
        indexing,
        job: { jobId: result.job.jobId, status: result.job.status, attemptCount: result.job.attemptCount, errorCode: result.job.errorCode },
        capabilityGaps: result.capabilityGaps,
      } };
    } finally {
      request.raw.off("aborted", abort);
    }
  });
  app.post("/api/content-library/index", async (request) => {
    empty.parse(request.query);
    const body = z.object({ courseId: id, revisionId: id.optional() }).strict().parse(request.body);
    const identity = await dependencies.authorize(request, true);
    requireStaff(identity);
    dependencies.assertCourse(body.courseId);
    return { indexing: body.revisionId
      ? await dependencies.indexRevision(body.revisionId, identity, body.courseId)
      : await dependencies.indexCourse(body.courseId, identity) };
  });
  app.get<{ Params: { revisionId: string } }>("/api/content-library/revisions/:revisionId", async (request) => {
    empty.parse(request.query);
    const params = z.object({ revisionId: id }).strict().parse(request.params);
    const identity = await dependencies.authorize(request, false);
    requireStaff(identity);
    const revision = await (await dependencies.store()).getSourceRevision(params.revisionId);
    if (!revision) throw new CourseLearningError("course_not_found", "资料版本不存在");
    return { revision };
  });
  app.post("/api/content-library/knowledge", async (request) => {
    empty.parse(request.query);
    const body = z.object({ knowledgeId: id, courseId: id, sourceRevisionId: id, title: z.string().trim().min(1).max(240), teachingSummary: z.string().trim().min(1).max(4_000), applicableSectionIds: z.array(id).max(32).default([]), tags: z.array(id).max(24).default([]), groundedClaimRelations: GroundedKnowledgeClaimRelationsSchema.default([]) }).strict().parse(request.body);
    const identity = await dependencies.authorize(request, true);
    requireStaff(identity);
    dependencies.assertCourse(body.courseId);
    await dependencies.assertRevisionCourse(body.sourceRevisionId, identity, body.courseId);
    const { groundedClaimRelations, ...record } = body;
    if (groundedClaimRelations.some((relation) => body.courseId !== "course-xunpu-intangible-media" || !xunpuFlagshipContentV4.groundedClaims.some((claim) => claim.claimId === relation.claimRef && claim.knowledgeRefs.includes(body.knowledgeId)))) {
      throw new CourseLearningError("version_hash_drift", "引用关系不属于当前课程知识对应的判断");
    }
    return { knowledge: await (await dependencies.store()).upsertKnowledgeRecord({ ...record, metadata: { groundedClaimRelations }, reviewStatus: "pending_expert_review", reviewNote: "由课程维护者建立待复核知识修订，不自动认定为专业审核结论。" }) };
  });
  app.get("/api/content-library/grounding-claims", async (request) => {
    const { courseId } = z.object({ courseId: id }).strict().parse(request.query);
    const identity = await dependencies.authorize(request, false);
    requireStaff(identity);
    dependencies.assertCourse(courseId);
    return { claims: courseId === "course-xunpu-intangible-media" ? xunpuFlagshipContentV4.groundedClaims : [] };
  });
  app.get("/api/content-library/jobs", async (request) => {
    empty.parse(request.query);
    const identity = await dependencies.authorize(request, false);
    requireStaff(identity);
    const store = await dependencies.store();
    const jobs = await store.listProcessingJobs({ limit: 100 });
    const sourceIds = new Map(await Promise.all([...new Set(jobs.map((job) => job.sourceRevisionId))]
      .map(async (revisionId) => [revisionId, (await store.getSourceRevision(revisionId))?.sourceId ?? null] as const)));
    return { jobs: jobs.map((job) => ({ jobId: job.jobId, assetId: job.assetId,
      sourceId: sourceIds.get(job.sourceRevisionId) ?? null,
      sourceFileName: typeof job.metadata?.fileName === "string" ? job.metadata.fileName : null,
      sourceRevisionId: job.sourceRevisionId, parsedRevisionId: typeof job.outputMetadata?.parsedRevisionId === "string" ? job.outputMetadata.parsedRevisionId : null, kind: job.kind, status: job.status, attemptCount: job.attemptCount, errorCode: job.errorCode, createdAt: job.createdAt, updatedAt: job.updatedAt })) };
  });
  app.post("/api/content-library/jobs/resume", async (request) => {
    empty.parse(request.query);
    const body = z.object({ includeFailed: z.boolean().default(false) }).strict().parse(request.body);
    const identity = await dependencies.authorize(request, true);
    requireStaff(identity);
    return { recovery: await (await dependencies.ingestion(identity)).resumePendingJobs(body) };
  });
  app.post("/api/content-library/cases", async (request) => {
    empty.parse(request.query);
    const body = z.object({ courseId: id, caseKey: id, version: z.number().int().positive(), title: z.string().trim().min(1).max(240), payload: z.record(z.string(), z.unknown()) }).strict().parse(request.body);
    const identity = await dependencies.authorize(request, true);
    requireStaff(identity);
    dependencies.assertCourse(body.courseId);
    return { draft: await (await dependencies.library(identity)).createCaseDraft({ ...body, status: "draft" }) };
  });
  app.post("/api/content-library/case-releases", async (request) => {
    empty.parse(request.query);
    const body = z.object({ caseId: id, courseId: id, releaseVersion: id, contentHash: z.string().regex(/^[a-f0-9]{64}$/u) }).strict().parse(request.body);
    const identity = await dependencies.authorize(request, true);
    requireStaff(identity);
    dependencies.assertCourse(body.courseId);
    return { release: await (await dependencies.library(identity)).publishCase(body) };
  });
  app.post("/api/content-library/reviews", async (request) => {
    empty.parse(request.query);
    const body = z.object({ entityType: z.enum(["source_revision", "knowledge_revision", "case_draft", "case_release", "asset"]), entityId: id, status: z.enum(["pending", "approved", "rejected"]), rationale: z.string().trim().min(1).max(2_000), evidenceRefs: z.array(id).max(32).optional() }).strict().parse(request.body);
    const identity = await dependencies.authorize(request, true);
    requireStaff(identity);
    return { review: await (await dependencies.library(identity)).recordReview({ ...body, evidenceRefs: body.evidenceRefs ?? [], reviewerId: identity.principalId }) };
  });
}
