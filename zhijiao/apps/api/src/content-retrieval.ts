import {
  ChineseContentEmbeddingModel,
  type TextEmbeddingProvider,
} from "@ronggang/context-engine";
import type {
  ContentSearchInput,
  ContentSearchResult,
} from "@ronggang/content-store";

export type ContentRetrievalInput = ContentSearchInput;
export type ContentRetrievalResult = ContentSearchResult;
export type ContentRetrievalEmbedding = NonNullable<ContentSearchInput["embedding"]>;

export interface SqlContentRetrievalPort {
  search(input: ContentSearchInput): Promise<ContentSearchResult>;
  upsertFragmentEmbedding(input: {
    fragmentId: string;
    modelVersion: string;
    vector: readonly number[];
  }): Promise<unknown>;
}

export interface ContentRetrievalAuthorizeRequest {
  action: "retrieve" | "index";
  courseId?: string | null;
  subjectRef?: string | null;
  purpose?: ContentRetrievalInput["purpose"];
}

export type ContentRetrievalAuthorize = (
  input: ContentRetrievalAuthorizeRequest,
) => boolean | Promise<boolean>;

export class ContentRetrievalDeniedError extends Error {
  constructor(action: ContentRetrievalAuthorizeRequest["action"]) {
    super(`content retrieval authorization denied: ${action}`);
    this.name = "ContentRetrievalDeniedError";
  }
}

export class AuthorizedContentRetrievalService {
  readonly #store: SqlContentRetrievalPort;
  readonly #embeddings: TextEmbeddingProvider;
  readonly #authorize: ContentRetrievalAuthorize;

  constructor(options: {
    store: SqlContentRetrievalPort;
    embeddings: TextEmbeddingProvider;
    authorize: ContentRetrievalAuthorize;
  }) {
    this.#store = options.store;
    this.#embeddings = options.embeddings;
    this.#authorize = options.authorize;
  }

  async indexFragments(input: {
    fragments: readonly { fragmentId: string; text: string }[];
    modelVersion?: string;
  }): Promise<{ modelVersion: string; dimension: number; indexed: number }> {
    if (!(await this.#authorize({ action: "index" }))) throw new ContentRetrievalDeniedError("index");
    const modelVersion = input.modelVersion ?? ChineseContentEmbeddingModel;
    const batch = await this.#embeddings.embedDocuments(
      input.fragments.map((fragment) => fragment.text),
      modelVersion,
    );
    for (let index = 0; index < input.fragments.length; index += 1) {
      await this.#store.upsertFragmentEmbedding({
        fragmentId: input.fragments[index]!.fragmentId,
        modelVersion: batch.modelVersion,
        vector: batch.vectors[index]!,
      });
    }
    return { modelVersion: batch.modelVersion, dimension: batch.dimension, indexed: input.fragments.length };
  }

  async retrieve(input: ContentRetrievalInput): Promise<ContentRetrievalResult> {
    const authorization: ContentRetrievalAuthorizeRequest = {
      action: "retrieve",
      purpose: input.purpose ?? "retrieval",
    };
    if (input.courseId !== undefined) authorization.courseId = input.courseId;
    if (input.subjectRef !== undefined) authorization.subjectRef = input.subjectRef;
    if (!(await this.#authorize(authorization))) throw new ContentRetrievalDeniedError("retrieve");
    const embedding = await this.#embeddings.embedQuery(input.query, ChineseContentEmbeddingModel);
    return this.#store.search({ ...input, embedding });
  }
}
