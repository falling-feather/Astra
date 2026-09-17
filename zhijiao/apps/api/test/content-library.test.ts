import { describe, expect, it } from "vitest";
import {
  CONTENT_LIBRARY_SEED_COUNTS,
  ContentLibraryAuthorizationError,
  buildContentLibrarySeed,
  createContentLibraryHandlers,
  registerContentLibrary,
  type ContentLibraryIngestionPort,
  type ContentLibraryServicePort,
  type ContentLibrarySearchRequest,
  type ContentLibrarySearchResult,
  type ContentLibrarySeedRecord,
} from "../src/content-library.js";

class FakeContentLibraryPort implements ContentLibraryIngestionPort {
  migrated = false;
  imported: readonly ContentLibrarySeedRecord[] = [];

  async migrate(): Promise<void> {
    this.migrated = true;
  }

  async importKnowledgeSeed(input: readonly ContentLibrarySeedRecord[]) {
    this.imported = input;
    return {
      total: input.length,
      imported: input.length,
      idempotent: 0,
      sourceRevisionCount: new Set(input.map((record) => `${record.source.sourceId}:${record.source.sourceVersion}`)).size,
      knowledgeRevisionIds: Object.fromEntries(input.map((record) => [record.knowledgeId, `revision:${record.knowledgeId}`])),
    };
  }

  async search(input: ContentLibrarySearchRequest): Promise<ContentLibrarySearchResult> {
    return {
      query: input.query,
      retrieverVersion: "fake",
      corpusVersion: "fake",
      citations: [],
      gaps: ["fake"],
      conflicts: [],
    };
  }
}

class FakeContentLibraryServicePort extends FakeContentLibraryPort implements ContentLibraryServicePort {
  async listSourceDocuments(): Promise<readonly unknown[]> {
    return [];
  }

  async listKnowledge(): Promise<readonly unknown[]> {
    return [];
  }

  async createCaseDraft(): Promise<unknown> {
    return { caseId: "case-1" };
  }

  async publishCase(): Promise<unknown> {
    return { releaseId: "release-1" };
  }

  async recordReview(): Promise<unknown> {
    return { reviewId: "review-1" };
  }

  async listReviews(): Promise<readonly unknown[]> {
    return [];
  }
}

describe("content-library API boundary", () => {
  it("includes the new course alongside existing knowledge without duplicating identifiers", () => {
    const seed = buildContentLibrarySeed();
    expect(CONTENT_LIBRARY_SEED_COUNTS).toEqual({ base: 70, flagshipExtension: 12, professional: 24, total: 106 });
    expect(seed).toHaveLength(106);
    expect(new Set(seed.map((record) => record.knowledgeId)).size).toBe(106);
    expect(seed.every((record) => record.source.url.startsWith("https://"))).toBe(true);
    expect(seed.filter((record) => record.reviewStatus === "pending_expert_review")).toHaveLength(106);
    expect(seed.filter((record) => record.metadata?.schemaVersion === "professional-training-knowledge/1.0.0")
      .every((record) => record.teachingSummary.includes("反例：") && record.teachingSummary.includes("可执行处置："))).toBe(true);
  });

  it("keeps initialization, seed import, and authorized retrieval as explicit server-owned ports", async () => {
    const port = new FakeContentLibraryPort();
    const handlers = createContentLibraryHandlers(port);
    await handlers.initialize();
    const imported = await handlers.seedExistingCourseContent();
    const result = await handlers.retrieve({ query: "来源", courseId: "course-xunpu-intangible-media" });
    expect(port.migrated).toBe(true);
    expect(imported.total).toBe(106);
    expect(port.imported).toHaveLength(106);
    expect(result.gaps).toEqual(["fake"]);
  });

  it("injects authorization before content reads and writes", async () => {
    const port = new FakeContentLibraryServicePort();
    const requests: string[] = [];
    let allowed = true;
    const service = registerContentLibrary({
      port,
      authorize: async (request) => {
        requests.push(request.action);
        return allowed;
      },
    });
    await service.retrieve({ query: "来源", courseId: "course-test" });
    await service.listKnowledge({ courseId: "course-test" });
    expect(requests).toEqual(["search", "knowledge_read"]);
    allowed = false;
    await expect(service.seedExistingCourseContent()).rejects.toBeInstanceOf(ContentLibraryAuthorizationError);
  });
});
