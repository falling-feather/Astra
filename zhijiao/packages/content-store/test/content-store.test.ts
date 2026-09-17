import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ContentStoreConflictError,
  SqlContentStore,
  createPGliteSqlClient,
} from "../src/index.js";
import type { SeedKnowledgeLike } from "../src/index.js";

const opened: SqlContentStore[] = [];

vi.setConfig({ testTimeout: 30_000 });

async function openStore(dataDir = `memory://content-store-test-${crypto.randomUUID()}`) {
  const database = new PGlite(dataDir);
  await database.waitReady;
  const store = new SqlContentStore(createPGliteSqlClient(database));
  await store.migrate();
  opened.push(store);
  return store;
}

afterEach(async () => {
  for (const store of opened.splice(0)) await store.close();
});

function sourceRevisionInput() {
  return {
    sourceId: "source-test-official",
    sourceVersion: "2026-09-07",
    sourceByteHash: null,
    mimeType: "text/plain",
    byteSize: 0,
    objectKey: null,
    publicationDate: "2026-09-07",
    accessedAt: "2026-09-07T00:00:00.000Z",
    status: "current" as const,
    metadata: { title: "测试来源", publisher: "测试发布方", canonicalUrl: "https://example.test/source" },
    fragments: [
      {
        fragmentId: "fragment-test-one",
        ordinal: 0,
        text: "事实核查需要回到原始来源，并保留定位。",
        locator: { page: 3, label: "第 3 页" },
        metadata: { section: "verification" },
      },
    ],
  };
}

function seedRecords(): SeedKnowledgeLike[] {
  return [
    {
      knowledgeId: "knowledge-test-source",
      courseId: "course-test",
      topic: "来源核验",
      title: "来源核验",
      teachingSummary: "事实核查需要回到原始来源，并保留定位。",
      applicableSectionIds: ["section-fact-check"],
      source: {
        sourceId: "source-seed-test",
        title: "测试来源",
        publisher: "测试发布方",
        url: "https://example.test/seed",
        publicationDate: "2026-09-07",
        accessedAt: "2026-09-07",
        locator: "第 3 页",
        sourceVersion: "2026-09-07",
      },
      reviewStatus: "pending_expert_review",
      reviewNote: "尚待专业教师复核。",
    },
    {
      knowledgeId: "knowledge-test-consent",
      courseId: "course-test",
      topic: "采访授权",
      title: "采访授权",
      teachingSummary: "采访前应说明用途、范围和可撤回的版本处理方式。",
      applicableSectionIds: ["section-interview"],
      source: {
        sourceId: "source-seed-test",
        title: "测试来源",
        publisher: "测试发布方",
        url: "https://example.test/seed",
        publicationDate: "2026-09-07",
        accessedAt: "2026-09-07",
        locator: "第 4 页",
        sourceVersion: "2026-09-07",
      },
      reviewStatus: "pending_expert_review",
    },
  ];
}

describe("SqlContentStore", () => {
  it("persists a source revision across PGlite restart and keeps a missing byte hash null", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "ronggang-content-store-"));
    try {
      const first = await openStore(dataDir);
      const input = sourceRevisionInput();
      const inserted = await first.ingestSourceRevision({
        ...input,
        metadata: { ...input.metadata, title: "测试来源" },
      });
      expect(inserted.idempotent).toBe(false);
      expect(inserted.revision.sourceByteHash).toBeNull();
      expect(inserted.fragments).toHaveLength(1);
      expect(await first.getSchemaVersion()).toBe("content-store/1.0.0");
      await first.close();
      opened.splice(opened.findIndex((entry) => entry === first), 1);

      const second = await openStore(dataDir);
      const reopened = await second.getSourceRevision(inserted.revision.revisionId);
      expect(reopened).toMatchObject({
        revisionId: inserted.revision.revisionId,
        sourceByteHash: null,
        fragmentCount: 1,
      });
      const repeated = await second.ingestSourceRevision(input);
      expect(repeated.idempotent).toBe(true);
      expect(repeated.revision.revisionId).toBe(inserted.revision.revisionId);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  }, 30_000);

  it("rejects a changed immutable source revision", async () => {
    const store = await openStore();
    const input = sourceRevisionInput();
    await store.ingestSourceRevision(input);
    await expect(store.ingestSourceRevision({
      ...input,
      fragments: [{ ...input.fragments[0]!, text: "被替换的来源片段" }],
    })).rejects.toBeInstanceOf(ContentStoreConflictError);
  });

  it("creates a new knowledge revision for changed teaching content while retaining the old one", async () => {
    const store = await openStore();
    const first = await store.upsertKnowledgeRecord({
      knowledgeId: "knowledge-versioned",
      courseId: "course-test",
      title: "第一版",
      teachingSummary: "第一版教学摘要。",
      reviewStatus: "pending_expert_review",
    });
    const repeated = await store.upsertKnowledgeRecord({
      knowledgeId: "knowledge-versioned",
      courseId: "course-test",
      title: "第一版",
      teachingSummary: "第一版教学摘要。",
      reviewStatus: "pending_expert_review",
    });
    const second = await store.upsertKnowledgeRecord({
      knowledgeId: "knowledge-versioned",
      courseId: "course-test",
      title: "第二版",
      teachingSummary: "第二版教学摘要，新增适用边界。",
      reviewStatus: "pending_expert_review",
    });
    expect(repeated.knowledgeRevisionId).toBe(first.knowledgeRevisionId);
    expect(second.revisionNumber).toBe(2);
    expect((await store.getKnowledge("knowledge-versioned", 1))?.title).toBe("第一版");
    expect((await store.getKnowledge("knowledge-versioned"))?.title).toBe("第二版");
    expect(await store.listKnowledge({ courseId: "course-test" })).toHaveLength(1);
  });

  it("imports shared seed records idempotently and searches only through an active course grant", async () => {
    const store = await openStore();
    const seeds = seedRecords();
    const crossCourseSeed = [
      ...seeds,
      { ...seeds[0]!, knowledgeId: "knowledge-test-other-course", courseId: "other-course" },
    ];
    const first = await store.importKnowledgeSeed(crossCourseSeed);
    const second = await store.importKnowledgeSeed(crossCourseSeed);
    expect(first).toMatchObject({ total: 3, imported: 3, idempotent: 0, sourceRevisionCount: 1 });
    expect(second).toMatchObject({ total: 3, imported: 0, idempotent: 3, sourceRevisionCount: 1 });
    const revisionId = Object.values(first.knowledgeRevisionIds)[0]!;
    const grants = await store.listUsageGrants({ purpose: "retrieval" });
    const revision = await store.getSourceRevision(grants[0]!.sourceRevisionId!);
    expect(revision?.sourceByteHash).toBeNull();
    expect(revision?.metadata).toMatchObject({ representation: "paraphrase/metadata-only" });
    expect(revision?.fragments).toHaveLength(3);
    expect(revision?.fragments.every((fragment) => (
      fragment.metadata?.representation === "paraphrase/metadata-only"
    ))).toBe(true);
    expect(new Set(grants.map((grant) => grant.courseId))).toEqual(new Set(["course-test", "other-course"]));
    expect(revisionId).toMatch(/^knowledge-revision-/);

    const authorized = await store.search({ query: "原始来源 定位", courseId: "course-test" });
    expect(authorized.citations).toHaveLength(2);
    expect(authorized.citations).toContainEqual(expect.objectContaining({
      sourceId: "source-seed-test",
      canonicalUrl: "https://example.test/seed",
      sourceByteHash: null,
      reviewStatus: "pending_expert_review",
    }));
    const otherCourse = await store.search({ query: "原始来源", courseId: "other-course" });
    expect(otherCourse.citations).toHaveLength(1);
    const denied = await store.search({ query: "原始来源", courseId: "ungranted-course" });
    expect(denied.citations).toHaveLength(0);
    expect(denied.gaps).not.toHaveLength(0);
  });

  it("keeps processing jobs idempotent and records terminal state", async () => {
    const store = await openStore();
    const source = await store.ingestSourceRevision(sourceRevisionInput());
    const asset = await store.createAsset({
      sourceRevisionId: source.revision.revisionId,
      courseId: "course-test",
      objectKey: "assets/test.pdf",
      assetKind: "document",
      mimeType: "application/pdf",
      byteSize: 12,
      sourceByteHash: "a".repeat(64),
    });
    const job = await store.createProcessingJob({
      assetId: asset.assetId,
      sourceRevisionId: source.revision.revisionId,
      kind: "parse_pdf",
      provider: "pdfjs",
      idempotencyKey: "parse:test.pdf:v1",
    });
    expect((await store.createProcessingJob({
      assetId: asset.assetId,
      sourceRevisionId: source.revision.revisionId,
      kind: "parse_pdf",
      provider: "pdfjs",
      idempotencyKey: "parse:test.pdf:v1",
    })).jobId).toBe(job.jobId);
    const running = await store.updateProcessingJob({ jobId: job.jobId, status: "running", incrementAttempt: true });
    const succeeded = await store.updateProcessingJob({
      jobId: job.jobId,
      status: "succeeded",
      outputMetadata: { pages: 3 },
    });
    expect(running.attemptCount).toBe(1);
    expect(succeeded.status).toBe("succeeded");
    expect(succeeded.completedAt).not.toBeNull();
    expect(succeeded.outputMetadata).toEqual({ pages: 3 });
  });

  it("normalizes timestamp usage grants and excludes due or expired grants from search", async () => {
    const store = await openStore();
    const cases = [
      { sourceId: "source-grant-future", courseId: "course-grant-future", expiresAt: new Date(Date.now() + 86_400_000).toISOString() },
      { sourceId: "source-grant-due", courseId: "course-grant-due", expiresAt: new Date(Date.now() - 1_000).toISOString() },
      { sourceId: "source-grant-expired", courseId: "course-grant-expired", expiresAt: "2000-01-01T00:00:00.000Z" },
    ];
    for (const item of cases) {
      const source = await store.ingestSourceRevision({
        ...sourceRevisionInput(),
        sourceId: item.sourceId,
        sourceVersion: "grant-test-1",
        fragments: [{
          ...sourceRevisionInput().fragments[0]!,
          fragmentId: `${item.sourceId}-fragment`,
        }],
      });
      const grant = await store.grantUsage({
        grantId: `${item.sourceId}-grant`,
        sourceRevisionId: source.revision.revisionId,
        courseId: item.courseId,
        purpose: "retrieval",
        scope: "course",
        grantedBy: "teacher-grants",
        status: "active",
        expiresAt: item.expiresAt,
      });
      expect(grant.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/u);
    }
    expect((await store.search({ query: "事实核查", courseId: "course-grant-future" })).citations.length).toBeGreaterThan(0);
    expect((await store.search({ query: "事实核查", courseId: "course-grant-due" })).citations).toHaveLength(0);
    expect((await store.search({ query: "事实核查", courseId: "course-grant-expired" })).citations).toHaveLength(0);
  });

  it("filters grants before hybrid vector retrieval and binds citations to the embedding model", async () => {
    const store = await openStore();
    await store.importKnowledgeSeed(seedRecords());
    const grant = (await store.listUsageGrants({ purpose: "retrieval" }))[0]!;
    const fragments = await store.listSourceFragments(grant.sourceRevisionId!);
    await expect(store.upsertFragmentEmbedding({
      fragmentId: "missing-fragment",
      modelVersion: "BAAI/bge-small-zh-v1.5",
      vector: [1, 0],
    })).rejects.toBeDefined();
    await store.upsertFragmentEmbedding({
      fragmentId: fragments[0]!.fragmentId,
      modelVersion: "BAAI/bge-small-zh-v1.5",
      vector: [1, 0],
    });
    await store.upsertFragmentEmbedding({
      fragmentId: fragments[1]!.fragmentId,
      modelVersion: "BAAI/bge-small-zh-v1.5",
      vector: [0, 1],
    });
    const result = await store.search({
      query: "完全不相干的问题",
      courseId: "course-test",
      embedding: { modelVersion: "BAAI/bge-small-zh-v1.5", vector: [1, 0] },
      limit: 1,
    });
    expect(result.embeddingModelVersion).toBe("BAAI/bge-small-zh-v1.5");
    expect(result.retrieverVersion).toContain("hybrid-sql-vector");
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0]?.fragmentId).toBe(fragments[0]!.fragmentId);
    expect(result.citations[0]?.embeddingModelVersion).toBe("BAAI/bge-small-zh-v1.5");
    expect(result.gaps).toHaveLength(0);
    const lexicalFallback = await store.search({
      query: "事实核查",
      courseId: "course-test",
      embedding: { modelVersion: "qa-unindexed-model", vector: [1, 0] },
    });
    expect(lexicalFallback.citations).toHaveLength(1);
    await store.upsertFragmentEmbedding({
      fragmentId: fragments[0]!.fragmentId,
      modelVersion: "qa-mixed-model",
      vector: [1, 0],
    });
    const mixed = await store.search({
      query: "完全不相干的问题",
      courseId: "course-test",
      embedding: { modelVersion: "qa-mixed-model", vector: [1, 0] },
    });
    expect(mixed.citations).toHaveLength(1);
    expect(mixed.citations[0]?.fragmentId).toBe(fragments[0]!.fragmentId);
    const emptyAllowed = await store.search({
      query: "事实核查",
      courseId: "course-test",
      allowedFragmentIds: new Set<string>(),
      embedding: { modelVersion: "BAAI/bge-small-zh-v1.5", vector: [1, 0] },
    });
    expect(emptyAllowed.citations).toHaveLength(0);
    await store.updateUsageGrantStatus({ grantId: grant.grantId, status: "revoked" });
    const revoked = await store.search({
      query: "完全不相干的问题",
      courseId: "course-test",
      embedding: { modelVersion: "BAAI/bge-small-zh-v1.5", vector: [1, 0] },
    });
    expect(revoked.citations).toHaveLength(0);
    expect(revoked.gaps).toContain("没有找到具有当前授权的匹配资料片段");
  });

  it("ranks all authorized fragments before limiting hybrid results, including late IDs and lexical-only sources", async () => {
    const store = await openStore();
    await store.upsertSourceDocument({ sourceId: "large-source", courseId: "large-course", kind: "simulation", title: "授权片段集合" });
    const fragments = Array.from({ length: 204 }, (_, index) => ({ fragmentId: `large-fragment-${String(index).padStart(3, "0")}`, ordinal: index,
      text: index >= 200 ? "唯一精确目标资料" : "普通无关背景", locator: { page: index + 1 } }));
    const { revision } = await store.ingestSourceRevision({ sourceId: "large-source", sourceVersion: "r1", sourceByteHash: null, mimeType: "text/plain", byteSize: 0, fragments });
    const grant = await store.grantUsage({ sourceRevisionId: revision.revisionId, courseId: "large-course", purpose: "retrieval", scope: "course", grantedBy: "test-teacher" });
    for (let index = 0; index < 203; index += 1) {
      await store.upsertFragmentEmbedding({ fragmentId: fragments[index]!.fragmentId, modelVersion: "large-vector", vector: index === 200 ? [1, 0] : index === 201 ? [-1, 0] : index === 202 ? [1, 0, 0] : [0, 1] });
    }
    const input = { courseId: "large-course", query: "唯一精确目标", limit: 1, embedding: { modelVersion: "large-vector", vector: [1, 0] } };
    const result = await store.search(input);
    expect(result.citations.map(item => item.fragmentId)).toEqual(["large-fragment-200"]);
    expect(result.citations[0]!.score).toBeCloseTo(1);
    const allowed = await store.search({ ...input, limit: 4, allowedFragmentIds: new Set(fragments.slice(200).map(item => item.fragmentId)) });
    expect(allowed.citations.map(item => item.fragmentId)).toEqual(fragments.slice(200).map(item => item.fragmentId));
    expect(allowed.citations.map(item => Number(item.score.toFixed(2)))).toEqual([1, 0.35, 0.35, 0.35]);
    expect((await store.search({ ...input, embedding: { ...input.embedding, vector: [0, 0] } })).citations[0]!.score).toBeCloseTo(0.35);
    expect((await store.search({ ...input, courseId: "other-course" })).citations).toEqual([]);
    expect((await store.search({ ...input, allowedFragmentIds: new Set() })).citations).toEqual([]);
    const lexical = await store.search({ ...input, embedding: { modelVersion: "not-indexed", vector: [1, 0] } });
    expect(lexical.citations[0]!.fragmentId).toBe("large-fragment-200");
    expect(lexical.citations[0]!.score).toBeCloseTo(0.35);
    await store.updateUsageGrantStatus({ grantId: grant.grantId, status: "revoked" });
    expect((await store.search(input)).citations).toEqual([]);
  });

  it("publishes immutable case releases and deduplicates reviews", async () => {
    const store = await openStore();
    const draft = await store.createCaseDraft({
      courseId: "course-test",
      caseKey: "case-source-check",
      version: 1,
      title: "来源核验案例",
      payload: { task: "核查" },
    });
    const release = await store.publishCase({
      caseId: draft.caseId,
      courseId: draft.courseId,
      releaseVersion: "1.0.0",
      contentHash: draft.contentHash,
    });
    expect((await store.publishCase({
      caseId: draft.caseId,
      courseId: draft.courseId,
      releaseVersion: "1.0.0",
      contentHash: draft.contentHash,
    })).releaseId).toBe(release.releaseId);
    const review = await store.recordReview({
      entityType: "case_release",
      entityId: release.releaseId,
      reviewerId: "teacher-1",
      status: "pending",
      rationale: "等待专业教师复核。",
      evidenceRefs: ["source-fragment-1"],
    });
    expect((await store.recordReview({
      entityType: "case_release",
      entityId: release.releaseId,
      reviewerId: "teacher-1",
      status: "pending",
      rationale: "等待专业教师复核。",
      evidenceRefs: ["source-fragment-1"],
    })).reviewId).toBe(review.reviewId);
  });
});
