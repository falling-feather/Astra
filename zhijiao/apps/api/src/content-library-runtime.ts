import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ContentStoreValidationError, openPGliteContentStore, type SqlContentStore } from "@ronggang/content-store";
import { LocalFastEmbedProvider, type TextEmbeddingProvider } from "@ronggang/context-engine";
import { buildContentLibrarySeed, registerContentLibrary } from "./content-library.js";
import { ContentIngestionService, LocalContentIngestionProcessor, type ContentIngestionObjectStore, type ContentIngestionProcessor } from "./content-ingestion.js";
import { AuthorizedContentRetrievalService } from "./content-retrieval.js";
import { assertContentCourseAccess, type ContentLibraryIdentity } from "./content-library-authorization.js";
import { CourseLearningError } from "./course-learning.js";
import { seedCourseCaseLibrary } from "./course-case-library.js";
import { applyFlagshipKnowledgeCurations } from "./flagship-knowledge-curation.js";

const repositoryRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));

function localPython(directory: string, configured: string | undefined): string {
  if (configured) return configured;
  const candidate = resolve(repositoryRoot, ".local", directory, process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  return existsSync(candidate) ? candidate : "python";
}

/** One SQL instance per application; authority stays in immutable source/work records. */
export class ContentLibraryRuntime {
  #store: Promise<SqlContentStore> | null = null;
  readonly #processor: ContentIngestionProcessor;
  readonly #embeddings: TextEmbeddingProvider;
  readonly #indexing = new Map<string, Promise<{ indexed: number }>>();

  constructor(private readonly options: {
    dataDir?: string;
    objectStore: ContentIngestionObjectStore;
    assertCourse(courseId: string): void;
    environment?: NodeJS.ProcessEnv;
    processor?: ContentIngestionProcessor;
    embeddings?: TextEmbeddingProvider;
  }) {
    const environment = options.environment ?? process.env;
    this.#processor = options.processor ?? new LocalContentIngestionProcessor({
      pythonExecutable: localPython("be007-venv", environment.RONGGANG_CONTENT_PYTHON),
      workerPath: resolve(repositoryRoot, "packages/media-processing/worker/content_ingestion_worker.py"),
      modelDir: environment.RONGGANG_BE007_MODEL_DIR ?? resolve(repositoryRoot, ".local/be007-models"),
    });
    this.#embeddings = options.embeddings ?? new LocalFastEmbedProvider({
      pythonExecutable: localPython("ai025-venv", environment.RONGGANG_AI025_PYTHON),
      workerPath: resolve(repositoryRoot, "packages/context-engine/worker/embedding_worker.py"),
      ...(environment.RONGGANG_AI025_MODEL_DIR ? { modelDir: environment.RONGGANG_AI025_MODEL_DIR } : {}),
    });
  }

  store(): Promise<SqlContentStore> {
    this.#store ??= (async () => {
      const store = await openPGliteContentStore(this.options.dataDir);
      try {
        const seeds = buildContentLibrarySeed();
        const existing = new Map((await Promise.all(seeds.map(async (seed) => [seed.knowledgeId, await store.getKnowledge(seed.knowledgeId)] as const))));
        await store.importKnowledgeSeed(seeds.filter((seed) => !existing.get(seed.knowledgeId)));
        // Bootstrap grants apply only to the unchanged bundled teaching text and never revive a revoked grant.
        for (const seed of seeds) {
          const knowledge = await store.getKnowledge(seed.knowledgeId);
          if (!knowledge?.sourceRevisionId || (seed.contentHash && knowledge.contentHash !== seed.contentHash)) continue;
          for (const purpose of ["teaching", "model_context"] as const) {
            const grants = await store.listUsageGrants({ sourceRevisionId: knowledge.sourceRevisionId, purpose });
            if (grants.some((grant) => grant.courseId === seed.courseId && grant.subjectRef == null)) continue;
            await store.grantUsage({ sourceRevisionId: knowledge.sourceRevisionId, courseId: seed.courseId, purpose, scope: "course", grantedBy: "bundled-course-content", note: "公开来源的项目教学转译；原件未入库时不声称原文片段或专业外审。" });
          }
        }
        await applyFlagshipKnowledgeCurations(store);
        await seedCourseCaseLibrary(store);
        return store;
      } catch (error) {
        await store.close();
        throw error;
      }
    })();
    return this.#store;
  }

  hasPersistedStore(): boolean {
    return this.options.dataDir !== undefined && existsSync(this.options.dataDir);
  }

  async close(): Promise<void> {
    if (!this.#store) return;
    await (await this.#store).close();
  }

  #authorize(identity: ContentLibraryIdentity, courseId?: string | null): boolean {
    if (!identity.principalId) return false;
    assertContentCourseAccess(identity, courseId);
    if (courseId) this.options.assertCourse(courseId);
    return true;
  }

  async library(identity: ContentLibraryIdentity) {
    const store = await this.store();
    return registerContentLibrary({
      port: store,
      authorize: (request) => this.#authorize(identity, request.courseId)
        && (request.action === "search" || identity.role !== "student"),
      search: (input) => this.retrieve(identity, input),
    });
  }

  async ingestion(identity: ContentLibraryIdentity): Promise<ContentIngestionService> {
    if (identity.role === "student") throw new CourseLearningError("access_denied", "资料维护由教师或管理员操作");
    return new ContentIngestionService({
      store: await this.store(),
      objectStore: this.options.objectStore,
      processor: this.#processor,
      authorize: (request) => this.#authorize(identity, request.courseId) && identity.role !== "student",
    });
  }

  async #retriever(identity: ContentLibraryIdentity) {
    return new AuthorizedContentRetrievalService({
      store: await this.store(),
      embeddings: this.#embeddings,
      authorize: (request) => this.#authorize(identity, request.courseId)
        && (request.action !== "index" || identity.role !== "student")
        && (request.subjectRef == null || request.subjectRef === identity.principalId),
    });
  }

  async authorizedRevision(revisionId: string, identity: ContentLibraryIdentity, courseId: string) {
    if (identity.role === "student") throw new CourseLearningError("access_denied", "资料维护由教师或管理员执行");
    this.options.assertCourse(courseId);
    const store = await this.store();
    const revision = await store.getSourceRevision(revisionId);
    if (!revision) throw new ContentStoreValidationError("资料版本不存在");
    const grants = await store.listUsageGrants({ sourceRevisionId: revisionId, purpose: "retrieval" });
    if (!grants.some((grant) => grant.courseId === courseId && grant.status === "active"
      && (grant.subjectRef == null || grant.subjectRef === identity.principalId)
      && (!grant.expiresAt || Date.parse(grant.expiresAt) > Date.now()))) {
      throw new CourseLearningError("access_denied", "资料版本不属于所选课程的有效检索授权");
    }
    return revision;
  }

  async indexRevision(revisionId: string, identity: ContentLibraryIdentity, courseId: string): Promise<{ indexed: number }> {
    const { fragments } = await this.authorizedRevision(revisionId, identity, courseId);
    const retriever = await this.#retriever(identity);
    return retriever.indexFragments({ fragments: fragments.map((fragment) => ({ fragmentId: fragment.fragmentId, text: fragment.text })) });
  }

  async indexFragments(fragments: readonly { fragmentId: string; text: string }[], identity: ContentLibraryIdentity) {
    if (identity.role === "student") throw new CourseLearningError("access_denied", "索引维护由教师或管理员执行");
    return (await this.#retriever(identity)).indexFragments({ fragments });
  }

  async indexCourse(courseId: string, identity: ContentLibraryIdentity): Promise<{ indexed: number }> {
    if (identity.role === "student") throw new CourseLearningError("access_denied", "索引维护由教师或管理员执行");
    this.options.assertCourse(courseId);
    const existing = this.#indexing.get(courseId);
    if (existing) return existing;
    const operation = (async () => {
      const store = await this.store();
      const knowledge = await store.listKnowledge({ courseId, limit: 200 });
      const revisionIds = [...new Set(knowledge.flatMap((item) => item.sourceRevisionId ? [item.sourceRevisionId] : []))];
      const fragments = (await Promise.all(revisionIds.map(async (revisionId) => (await this.authorizedRevision(revisionId, identity, courseId)).fragments))).flat();
      const retriever = await this.#retriever(identity);
      return retriever.indexFragments({ fragments: [...new Map(fragments.map((fragment) => [fragment.fragmentId, { fragmentId: fragment.fragmentId, text: fragment.text }])).values()] });
    })();
    this.#indexing.set(courseId, operation);
    try { return await operation; }
    finally { this.#indexing.delete(courseId); }
  }

  async retrieve(identity: ContentLibraryIdentity, input: Parameters<AuthorizedContentRetrievalService["retrieve"]>[0]) {
    const retriever = await this.#retriever(identity);
    return retriever.retrieve(input);
  }
}
