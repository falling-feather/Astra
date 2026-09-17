import { describe, expect, it } from "vitest";
import {
  AuthorizedContentRetrievalService,
  ContentRetrievalDeniedError,
  type SqlContentRetrievalPort,
} from "../src/content-retrieval.js";
import type { TextEmbeddingProvider } from "@ronggang/context-engine";

class FakeEmbeddingProvider implements TextEmbeddingProvider {
  async embedDocuments(texts: readonly string[], modelVersion = "fake/1") {
    return {
      modelVersion,
      dimension: 2,
      vectors: texts.map((_, index) => index === 0 ? [1, 0] : [0, 1]),
    };
  }

  async embedQuery(_query: string, modelVersion = "fake/1") {
    return { modelVersion, dimension: 2, vector: [1, 0] };
  }
}

class FakeRetrievalStore implements SqlContentRetrievalPort {
  readonly embeddings: unknown[] = [];

  async upsertFragmentEmbedding(input: unknown) {
    this.embeddings.push(input);
    return input;
  }

  async search(input: { embedding?: { modelVersion: string; vector: readonly number[] }; query: string }) {
    return {
      query: input.query,
      retrieverVersion: "hybrid-sql-vector/1",
      corpusVersion: "content-store/1",
      citations: [],
      gaps: input.embedding ? [] : ["missing embedding"],
      conflicts: [],
      embeddingModelVersion: input.embedding?.modelVersion ?? null,
    };
  }
}

describe("AuthorizedContentRetrievalService", () => {
  it("indexes vectors and passes a query embedding only after authorization", async () => {
    const store = new FakeRetrievalStore();
    const service = new AuthorizedContentRetrievalService({
      store,
      embeddings: new FakeEmbeddingProvider(),
      authorize: async () => true,
    });
    const indexed = await service.indexFragments({
      fragments: [{ fragmentId: "fragment-a", text: "来源核验" }, { fragmentId: "fragment-b", text: "授权范围" }],
    });
    const result = await service.retrieve({ query: "如何核验来源", courseId: "course-test" });
    expect(indexed).toMatchObject({ modelVersion: "BAAI/bge-small-zh-v1.5", dimension: 2, indexed: 2 });
    expect(store.embeddings).toHaveLength(2);
    expect(result.embeddingModelVersion).toBe("BAAI/bge-small-zh-v1.5");
    expect(result.gaps).toEqual([]);
  });

  it("fails closed before indexing or retrieval when authorization is denied", async () => {
    const service = new AuthorizedContentRetrievalService({
      store: new FakeRetrievalStore(),
      embeddings: new FakeEmbeddingProvider(),
      authorize: async () => false,
    });
    await expect(service.indexFragments({ fragments: [{ fragmentId: "f", text: "text" }] }))
      .rejects.toBeInstanceOf(ContentRetrievalDeniedError);
    await expect(service.retrieve({ query: "text", courseId: "course-test" }))
      .rejects.toBeInstanceOf(ContentRetrievalDeniedError);
  });
});
