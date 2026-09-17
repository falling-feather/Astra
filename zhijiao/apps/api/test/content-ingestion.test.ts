import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { openPGliteContentStore } from "@ronggang/content-store";
import { InMemoryContentAddressedObjectStore } from "../src/local-object-store.js";
import {
  ContentIngestionService,
  LocalContentIngestionProcessor,
  type ContentIngestionObjectStore,
  type ContentIngestionProcessor,
  type ContentIngestionStorePort,
  type ContentProcessingJob,
} from "../src/content-ingestion.js";

class FakeObjectStore implements ContentIngestionObjectStore {
  readonly objects = new Map<string, Buffer>();

  async put(input: { sessionId: string; bytes: Buffer; contentHash: string }) {
    const sourceRef = `object://${input.sessionId}/${input.contentHash}`;
    this.objects.set(sourceRef, Buffer.from(input.bytes));
    return { sourceRef, contentHash: input.contentHash, sizeBytes: input.bytes.length };
  }

  async get(sourceRef: string): Promise<Buffer> {
    const bytes = this.objects.get(sourceRef);
    if (!bytes) throw new Error("missing object");
    return Buffer.from(bytes);
  }
}

class FakeStore implements ContentIngestionStorePort {
  readonly jobs = new Map<string, ContentProcessingJob>();
  readonly assets = new Map<string, { assetId: string; objectKey: string; sourceRevisionId: string | null; mimeType: string; byteSize: number; sourceByteHash: string }>();
  readonly grants: unknown[] = [];
  revisionCounter = 0;
  readonly revisionsByVersion = new Map<string, string>();

  async upsertSourceDocument(): Promise<unknown> {
    return { sourceId: "source" };
  }

  async ingestSourceRevision(input: { sourceVersion: string; fragments: readonly unknown[] }) {
    const existingRevisionId = this.revisionsByVersion.get(input.sourceVersion);
    if (existingRevisionId) {
      return {
        document: {},
        revision: {
          revisionId: existingRevisionId,
          sourceVersion: input.sourceVersion,
          sourceByteHash: null,
          fragments: [],
        },
        fragments: [],
        idempotent: true,
      };
    }
    this.revisionCounter += 1;
    const revisionId = `revision-${this.revisionCounter}`;
    this.revisionsByVersion.set(input.sourceVersion, revisionId);
    const fragments = input.fragments.map((_, ordinal) => ({ fragmentId: `fragment-${revisionId}-${ordinal}`, ordinal }));
    return {
      document: {},
      revision: {
        revisionId,
        sourceVersion: input.sourceVersion,
        sourceByteHash: null,
        fragments,
      },
      fragments,
      idempotent: false,
    };
  }

  async createAsset(input: { assetId?: string; sourceRevisionId?: string | null; objectKey: string; mimeType: string; byteSize: number; sourceByteHash: string }) {
    const asset = {
      assetId: input.assetId ?? "asset-1",
      objectKey: input.objectKey,
      sourceRevisionId: input.sourceRevisionId ?? null,
      mimeType: input.mimeType,
      byteSize: input.byteSize,
      sourceByteHash: input.sourceByteHash,
    };
    this.assets.set(asset.assetId, asset);
    return asset;
  }

  async getAsset(assetId: string) {
    return this.assets.get(assetId) ?? null;
  }

  async createProcessingJob(input: {
    assetId: string;
    sourceRevisionId: string;
    kind: ContentProcessingJob["kind"];
    idempotencyKey: string;
    metadata?: Record<string, unknown>;
  }): Promise<ContentProcessingJob> {
    const existing = [...this.jobs.values()].find((job) => job.idempotencyKey === input.idempotencyKey);
    if (existing) return existing;
    const job: ContentProcessingJob = {
      jobId: `job-${this.jobs.size + 1}`,
      assetId: input.assetId,
      sourceRevisionId: input.sourceRevisionId,
      kind: input.kind,
      idempotencyKey: input.idempotencyKey,
      status: "queued",
      attemptCount: 0,
      errorCode: null,
      outputMetadata: null,
      metadata: input.metadata ?? {},
    };
    this.jobs.set(job.jobId, job);
    return job;
  }

  async updateProcessingJob(input: {
    jobId: string;
    status: ContentProcessingJob["status"];
    errorCode?: string | null;
    outputMetadata?: Record<string, unknown> | null;
    incrementAttempt?: boolean;
  }): Promise<ContentProcessingJob> {
    const current = this.jobs.get(input.jobId);
    if (!current) throw new Error("job missing");
    const updated: ContentProcessingJob = {
      ...current,
      status: input.status,
      attemptCount: current.attemptCount + (input.incrementAttempt ? 1 : 0),
      errorCode: input.errorCode === undefined ? current.errorCode : input.errorCode,
      outputMetadata: input.outputMetadata === undefined ? current.outputMetadata : input.outputMetadata,
    };
    this.jobs.set(updated.jobId, updated);
    return updated;
  }

  async listProcessingJobs(input: { status?: ContentProcessingJob["status"] } = {}) {
    return [...this.jobs.values()].filter((job) => input.status === undefined || job.status === input.status);
  }

  async grantUsage(input: unknown): Promise<unknown> {
    this.grants.push(input);
    return input;
  }
}

const fakeProcessor: ContentIngestionProcessor = {
  async process() {
    return {
      processorVersion: "fake/1.0.0",
      fragments: [{
        ordinal: 0,
        text: "真实解析片段",
        locator: { page: 1, label: "第 1 页" },
        metadata: { representation: "extracted-source" },
      }],
      metadata: { engine: "fake" },
      capabilityGaps: [],
    };
  },
};

describe("ContentIngestionService", () => {
  it("creates a new processing job when the processor profile changes without replacing original bytes", async () => {
    const store = await openPGliteContentStore();
    try {
      const objectStore = new FakeObjectStore();
      const input = { sourceId: "processor-upgrade", courseId: "course-processor-upgrade", kind: "user_upload" as const, title: "处理版本测试", fileName: "source.txt", mimeType: "text/plain" as const, bytes: Buffer.from("原件内容保持不变"), storageSessionId: "processor-upgrade", grantedBy: "teacher-processor" };
      const run = (version: string) => new ContentIngestionService({ store, objectStore, authorize: () => true, processor: { processorId: version, process: async () => ({ processorVersion: version, fragments: [{ ordinal: 0, text: `解析结果 ${version}`, locator: { label: "全文" } }], metadata: {}, capabilityGaps: [] }) } }).ingestBytes(input);
      const first = await run("processor/1.0.0");
      const next = await run("processor/1.0.1");
      expect(next.rawRevisionId).toBe(first.rawRevisionId);
      expect(next.asset.sourceByteHash).toBe(first.asset.sourceByteHash);
      expect(next.job.jobId).not.toBe(first.job.jobId);
      expect(next.parsedRevisionId).not.toBe(first.parsedRevisionId);
      expect((await run("processor/1.0.1")).status).toBe("already_completed");
      expect((await store.listProcessingJobs()).length).toBe(2);
    } finally { await store.close(); }
  }, 30_000);

  const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const runtimePython = resolve(repositoryRoot, ".local/be007-venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  it.skipIf(!existsSync(runtimePython))("transports Chinese JSON as UTF-8 even when the parent environment defaults to GBK", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ingestion-utf8-"));
    try {
      const workerPath = join(directory, "worker.py");
      await writeFile(workerPath, 'import json\nprint(json.dumps({"ok":True,"fragments":[{"ordinal":0,"text":"中华人民共和国统计法","locator":{"page":1,"label":"第 1 页"}}],"metadata":{},"capabilities":[]}, ensure_ascii=False))\n', "utf8");
      vi.stubEnv("PYTHONIOENCODING", "gbk");
      const result = await new LocalContentIngestionProcessor({ pythonExecutable: runtimePython, workerPath }).process({ kind: "document", mimeType: "application/pdf", filePath: join(directory, "input.pdf") });
      expect(result.fragments[0]?.text).toBe("中华人民共和国统计法");
      expect(result.fragments[0]?.locator.label).toBe("第 1 页");
      expect(JSON.stringify(result)).not.toContain("\uFFFD");
    } finally {
      vi.unstubAllEnvs();
      if (!resolve(directory).startsWith(resolve(tmpdir(), "ingestion-utf8-"))) throw new Error("unexpected fixture directory");
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps authorization and original-byte hash at the ingestion boundary", async () => {
    const store = new FakeStore();
    const objects = new FakeObjectStore();
    const requests: string[] = [];
    const service = new ContentIngestionService({
      store,
      objectStore: objects,
      processor: fakeProcessor,
      authorize: async (request) => {
        requests.push(request.action);
        return true;
      },
    });
    const result = await service.ingest({
      sourceId: "source-upload",
      courseId: "course-test",
      kind: "user_upload",
      title: "测试 PDF",
      fileName: "sample.pdf",
      mimeType: "application/pdf",
      bytes: Buffer.from("%PDF-1.7\nreal-bytes"),
      storageSessionId: "session-test",
      grantedBy: "teacher-1",
    });
    expect(result.status).toBe("completed");
    expect(result.parsedRevisionId).toBe("revision-2");
    expect(result.job.attemptCount).toBe(1);
    expect(requests).toEqual(["source_write"]);
    expect(store.grants).toHaveLength(1);
    expect(objects.objects.size).toBe(1);
  });

  it("turns a worker restart into a queued retry instead of losing the job", async () => {
    const store = new FakeStore();
    const job = await store.createProcessingJob({
      assetId: "asset-1",
      sourceRevisionId: "revision-1",
      kind: "parse_pdf",
      idempotencyKey: "restart-test",
      metadata: {},
    });
    await store.updateProcessingJob({ jobId: job.jobId, status: "running", incrementAttempt: true });
    const service = new ContentIngestionService({
      store,
      objectStore: new FakeObjectStore(),
      processor: fakeProcessor,
      authorize: async () => true,
    });
    expect(await service.recoverRunningJobs()).toBe(1);
    expect((await store.listProcessingJobs())[0]?.status).toBe("queued");
    expect((await store.listProcessingJobs())[0]?.errorCode).toBe("worker_restarted");
  });

  it("resumes queued processing from the stored original bytes without re-upload", async () => {
    const store = new FakeStore();
    const objects = new FakeObjectStore();
    const bytes = Buffer.from("%PDF-1.7\nresume-bytes");
    const contentHash = createHash("sha256").update(bytes).digest("hex");
    const stored = await objects.put({ sessionId: "resume-session", bytes, contentHash });
    await store.createAsset({
      assetId: "asset-resume",
      sourceRevisionId: "revision-raw",
      objectKey: stored.sourceRef,
      mimeType: "application/pdf",
      byteSize: bytes.length,
      sourceByteHash: contentHash,
    });
    const job = await store.createProcessingJob({
      assetId: "asset-resume",
      sourceRevisionId: "revision-raw",
      kind: "parse_pdf",
      idempotencyKey: "resume-idempotency",
      metadata: {
        sourceId: "source-resume",
        sourceVersion: "original-resume",
        fileName: "resume.pdf",
        mimeType: "application/pdf",
        courseId: "course-resume",
        purpose: "retrieval",
        scope: "course",
        grantedBy: "teacher-resume",
      },
    });
    await store.updateProcessingJob({ jobId: job.jobId, status: "running", incrementAttempt: true });
    const service = new ContentIngestionService({
      store,
      objectStore: objects,
      processor: fakeProcessor,
      authorize: async () => true,
    });
    const resumed = await service.resumePendingJobs();
    expect(resumed).toHaveLength(1);
    expect(resumed[0]?.status).toBe("succeeded");
    expect(resumed[0]?.attemptCount).toBe(2);
    expect(resumed[0]?.outputMetadata).toMatchObject({ fragmentCount: 1 });
  });

  it("records failure and permits a same-idempotency retry", async () => {
    const store = new FakeStore();
    const objects = new FakeObjectStore();
    let calls = 0;
    const flakyProcessor: ContentIngestionProcessor = {
      async process() {
        calls += 1;
        if (calls === 1) throw new Error("temporary parser failure");
        return fakeProcessor.process({ kind: "document", mimeType: "application/pdf", filePath: "unused" });
      },
    };
    const service = new ContentIngestionService({ store, objectStore: objects, processor: flakyProcessor, authorize: async () => true });
    const input = {
      sourceId: "source-retry",
      courseId: "course-test",
      kind: "user_upload" as const,
      title: "retry PDF",
      fileName: "retry.pdf",
      mimeType: "application/pdf" as const,
      bytes: Buffer.from("%PDF-1.7\nretry"),
      storageSessionId: "session-retry",
      grantedBy: "teacher-1",
    };
    expect((await service.ingest(input)).status).toBe("failed");
    const retried = await service.ingest(input);
    expect(retried.status).toBe("completed");
    expect(retried.job.attemptCount).toBe(2);
  });

  it("cancels a running local processor through AbortSignal", async () => {
    const processor: ContentIngestionProcessor = {
      async process(input) {
        await new Promise<void>((_, reject) => {
          input.signal?.addEventListener("abort", () => {
            const error = new Error("cancelled");
            error.name = "AbortError";
            reject(error);
          }, { once: true });
        });
        throw new Error("unreachable");
      },
    };
    const service = new ContentIngestionService({
      store: new FakeStore(),
      objectStore: new FakeObjectStore(),
      processor,
      authorize: async () => true,
    });
    const controller = new AbortController();
    const promise = service.ingest({
      sourceId: "source-cancel",
      kind: "user_upload",
      title: "cancel PDF",
      fileName: "cancel.pdf",
      mimeType: "application/pdf",
      bytes: Buffer.from("%PDF-1.7\ncancel"),
      storageSessionId: "session-cancel",
      grantedBy: "teacher-1",
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 15);
    expect((await promise).status).toBe("cancelled");
  });

  it("real SqlContentStore permits cancelled retry and preserves attempt history and source boundaries", async () => {
    const store = await openPGliteContentStore("memory://be007-cancel-retry-real");
    const objectStore = new InMemoryContentAddressedObjectStore();
    const waitingProcessor: ContentIngestionProcessor = {
      async process(input) {
        await new Promise<void>((_, reject) => {
          input.signal?.addEventListener("abort", () => {
            const error = new Error("cancelled");
            error.name = "AbortError";
            reject(error);
          }, { once: true });
        });
        throw new Error("unreachable");
      },
    };
    const processedProcessor: ContentIngestionProcessor = {
      async process() {
        return {
          processorVersion: "fake/1",
          fragments: [{ ordinal: 0, text: "processed", locator: { page: 1 }, metadata: { representation: "processor-owned" } }],
          metadata: { representation: "processor-must-not-overwrite", sourceByteHash: "fake" },
          capabilityGaps: [],
        };
      },
    };
    const input = {
      sourceId: "source-real-cancel-retry",
      courseId: "course-real-cancel-retry",
      kind: "user_upload" as const,
      title: "real cancel retry",
      fileName: "real-cancel.pdf",
      mimeType: "application/pdf" as const,
      bytes: Buffer.from("%PDF-1.7\nreal-cancel-retry"),
      storageSessionId: "real-cancel-retry",
      grantedBy: "teacher-real",
    };
    const controller = new AbortController();
    const firstPromise = new ContentIngestionService({
      store,
      objectStore,
      processor: waitingProcessor,
      authorize: async () => true,
    }).ingest({ ...input, signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    expect((await firstPromise).status).toBe("cancelled");
    const retried = await new ContentIngestionService({
      store,
      objectStore,
      processor: processedProcessor,
      authorize: async () => true,
    }).ingest(input);
    expect(retried.status).toBe("completed");
    expect(retried.job.attemptCount).toBe(2);
    expect(retried.job.outputMetadata?.attemptHistory).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: "cancelled" }),
      expect.objectContaining({ status: "retry_requested" }),
      expect.objectContaining({ status: "completed" }),
    ]));
    const parsed = await store.getSourceRevision(retried.parsedRevisionId!);
    expect(parsed?.metadata).toMatchObject({
      representation: "parsed-source",
      processorMetadata: { representation: "processor-must-not-overwrite", sourceByteHash: "fake" },
    });
    expect(parsed?.sourceByteHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(parsed?.fragments).toHaveLength(1);
    await store.close();
  }, 30_000);

  it.skipIf(!existsSync(runtimePython))("runs real OCR on the repository image sample", async () => {
    const processor = new LocalContentIngestionProcessor({
      pythonExecutable: runtimePython,
      workerPath: resolve(repositoryRoot, "packages/media-processing/worker/content_ingestion_worker.py"),
      modelDir: resolve(repositoryRoot, ".local/be007-models"),
    });
    const result = await processor.process({
      kind: "image",
      mimeType: "image/png",
      filePath: resolve(repositoryRoot, "资料/91-视觉与演示资产/课程视觉参考/视觉参考-智能体情境游戏-v2/01-学生端-事件驱动职业工作台-v2.png"),
    });
    expect(result.fragments.length).toBeGreaterThan(0);
    expect(result.fragments.map((fragment) => fragment.text).join("\n")).toMatch(/[\u4e00-\u9fff]/u);
    expect(JSON.stringify(result)).not.toContain("\uFFFD");
    expect(result.fragments[0]?.locator).toMatchObject({ page: 1, bbox: expect.any(Object) });
  }, 30_000);

  it.skipIf(!existsSync(runtimePython))("runs real ASR with time positions on the repository interview sample", async () => {
    const processor = new LocalContentIngestionProcessor({
      pythonExecutable: runtimePython,
      workerPath: resolve(repositoryRoot, "packages/media-processing/worker/content_ingestion_worker.py"),
      modelDir: resolve(repositoryRoot, ".local/be007-models"),
    });
    const result = await processor.process({
      kind: "audio",
      mimeType: "audio/wav",
      filePath: resolve(repositoryRoot, "apps/web/public/assets/flagship-world/v4/audio-ahuan-interview-01.wav"),
    });
    expect(result.fragments.length).toBeGreaterThan(0);
    expect(result.fragments.map((fragment) => fragment.text).join("\n")).toMatch(/[\u4e00-\u9fff]/u);
    expect(JSON.stringify(result)).not.toContain("\uFFFD");
    expect(result.fragments[0]?.locator).toMatchObject({ startMs: expect.any(Number), endMs: expect.any(Number) });
  }, 30_000);

  it.skipIf(!existsSync(runtimePython))("parses a real PDF into page-positioned fragments", async () => {
    const processor = new LocalContentIngestionProcessor({
      pythonExecutable: runtimePython,
      workerPath: resolve(repositoryRoot, "packages/media-processing/worker/content_ingestion_worker.py"),
      modelDir: resolve(repositoryRoot, ".local/be007-models"),
    });
    const result = await processor.process({
      kind: "document",
      mimeType: "application/pdf",
      filePath: resolve(repositoryRoot, "演示/融岗智训-V2.4.9-全功能架构与交互演示手册.pdf"),
    });
    expect(result.fragments.length).toBeGreaterThan(0);
    expect(result.fragments.map((fragment) => fragment.text).join("\n")).toMatch(/[\u4e00-\u9fff]/u);
    expect(JSON.stringify(result)).not.toContain("\uFFFD");
    expect(result.fragments[0]?.locator).toMatchObject({ page: 1 });
  }, 30_000);
});
