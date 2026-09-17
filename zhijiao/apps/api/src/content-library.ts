import {
  courseContentReleases,
  xunpuV4AddedKnowledgeRecords,
  professionalTrainingKnowledgeRecords,
  hashCanonical,
} from "@ronggang/course-content";
import type { SourceLocator } from "@ronggang/content-store";

export const CONTENT_LIBRARY_SEED_COUNTS = {
  base: 70,
  flagshipExtension: 12,
  professional: 24,
  total: 106,
} as const;

export type ContentLibraryPurpose = "teaching" | "retrieval" | "model_context" | "publication" | "audit";

export interface ContentLibrarySeedSource {
  sourceId: string;
  title: string;
  publisher: string;
  url: string;
  publicationDate: string;
  accessedAt: string;
  locator: string;
  sourceVersion: string;
  rightsNote?: string;
}

export interface ContentLibrarySeedRecord {
  knowledgeId: string;
  courseId: string;
  topic?: string;
  title?: string;
  teachingSummary: string;
  applicableSectionIds: readonly string[];
  source: ContentLibrarySeedSource;
  reviewStatus: "verified" | "pending_expert_review" | "retired";
  reviewNote?: string;
  tags?: readonly string[];
  synonyms?: readonly string[];
  contentHash?: string;
  metadata?: Record<string, unknown>;
}

export interface ContentLibrarySearchRequest {
  query: string;
  courseId?: string | null;
  purpose?: ContentLibraryPurpose;
  subjectRef?: string | null;
  limit?: number;
  allowedFragmentIds?: ReadonlySet<string>;
}

export interface ContentLibraryCitation {
  citationId: string;
  sourceId: string;
  sourceRevisionId: string;
  fragmentId: string;
  title: string;
  publisher: string | null;
  canonicalUrl: string | null;
  sourceVersion: string;
  sourceByteHash: string | null;
  locator: SourceLocator;
  text: string;
  knowledgeRevisionIds: string[];
  claimIds: string[];
  reviewStatus: "draft" | "pending_expert_review" | "verified" | "retired" | null;
  score: number;
}

export interface ContentLibrarySearchResult {
  query: string;
  retrieverVersion: string;
  corpusVersion: string;
  citations: ContentLibraryCitation[];
  gaps: string[];
  conflicts: Array<{ claimId: string; supporting: string[]; refuting: string[] }>;
}

export interface ContentLibrarySeedImportResult {
  total: number;
  imported: number;
  idempotent: number;
  sourceRevisionCount: number;
  knowledgeRevisionIds: Record<string, string>;
}

export interface ContentLibraryIngestionPort {
  migrate(): Promise<void>;
  importKnowledgeSeed(input: readonly ContentLibrarySeedRecord[]): Promise<ContentLibrarySeedImportResult>;
  search(input: ContentLibrarySearchRequest): Promise<ContentLibrarySearchResult>;
}

export type ContentLibraryAuthorizationAction =
  | "source_read"
  | "knowledge_read"
  | "search"
  | "seed_import"
  | "case_write"
  | "review_write";

export interface ContentLibraryAuthorizationRequest {
  action: ContentLibraryAuthorizationAction;
  purpose?: ContentLibraryPurpose | undefined;
  courseId?: string | null | undefined;
  subjectRef?: string | null | undefined;
  resourceRef?: string | undefined;
}

export type ContentLibraryAuthorize = (
  request: ContentLibraryAuthorizationRequest,
) => boolean | Promise<boolean>;

export class ContentLibraryAuthorizationError extends Error {
  constructor(action: ContentLibraryAuthorizationAction) {
    super(`Content library authorization denied for ${action}`);
    this.name = "ContentLibraryAuthorizationError";
  }
}

export interface ContentLibrarySourceListRequest {
  courseId?: string | null;
  limit?: number;
  cursor?: string;
}

export interface ContentLibraryKnowledgeListRequest {
  courseId?: string | null;
  status?: "draft" | "pending_expert_review" | "verified" | "retired";
  limit?: number;
}

export interface ContentLibraryCaseDraftInput {
  caseId?: string;
  courseId: string;
  caseKey: string;
  version: number;
  title: string;
  contentHash?: string;
  payload: Record<string, unknown>;
  status?: "draft" | "review";
}

export interface ContentLibraryCaseReleaseInput {
  releaseId?: string;
  caseId: string;
  courseId: string;
  releaseVersion: string;
  contentHash: string;
  metadata?: Record<string, unknown>;
}

export interface ContentLibraryReviewInput {
  reviewId?: string;
  entityType: "source_revision" | "knowledge_revision" | "case_draft" | "case_release" | "asset";
  entityId: string;
  reviewerId: string;
  status: "pending" | "approved" | "rejected";
  rationale: string;
  evidenceRefs?: readonly string[];
}

/** Stable handoff ports for BE-007 material processing; implementation stays with the data store/processor. */
export interface ContentLibraryProcessorPort {
  ingestSourceRevision(input: {
    sourceId: string;
    sourceVersion: string;
    sourceByteHash: string | null;
    mimeType: string;
    byteSize: number;
    objectKey?: string | null;
    publicationDate?: string | null;
    accessedAt?: string;
    status?: "current" | "historical" | "failed";
    metadata?: Record<string, unknown>;
    fragments: ReadonlyArray<{
      fragmentId?: string;
      ordinal: number;
      text: string;
      locator: Record<string, unknown>;
      contentHash?: string;
      metadata?: Record<string, unknown>;
    }>;
  }): Promise<unknown>;
  createProcessingJob(input: {
    jobId?: string;
    assetId: string;
    sourceRevisionId: string;
    kind: "parse_text" | "parse_pdf" | "ocr" | "asr";
    provider?: string | null;
    idempotencyKey: string;
    metadata?: Record<string, unknown>;
  }): Promise<unknown>;
  updateProcessingJob(input: {
    jobId: string;
    status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
    errorCode?: string | null;
    outputMetadata?: Record<string, unknown> | null;
    incrementAttempt?: boolean;
  }): Promise<unknown>;
}

export interface ContentLibraryServicePort extends ContentLibraryIngestionPort {
  listSourceDocuments(input: ContentLibrarySourceListRequest): Promise<readonly unknown[]>;
  listKnowledge(input: ContentLibraryKnowledgeListRequest): Promise<readonly unknown[]>;
  createCaseDraft(input: ContentLibraryCaseDraftInput): Promise<unknown>;
  publishCase(input: ContentLibraryCaseReleaseInput): Promise<unknown>;
  recordReview(input: ContentLibraryReviewInput): Promise<unknown>;
  listReviews(input: { entityType?: ContentLibraryReviewInput["entityType"]; entityId?: string }): Promise<readonly unknown[]>;
}

/**
 * Convert the existing course snapshots into the SQL library's seed boundary.
 * The source URL and locator stay metadata only; this function never claims the
 * original bytes were downloaded.
 */
export function buildContentLibrarySeed(): ContentLibrarySeedRecord[] {
  const base = courseContentReleases.flatMap((release) => release.knowledgeRecords.map((record) => ({
    knowledgeId: record.knowledgeId,
    courseId: release.releaseRef.courseId,
    topic: record.topic,
    title: record.topic,
    teachingSummary: record.teachingSummary,
    applicableSectionIds: record.applicableSectionIds,
    source: {
      sourceId: record.source.sourceId,
      title: record.source.title,
      publisher: record.source.publisher,
      url: record.source.url,
      publicationDate: record.source.publicationDate,
      accessedAt: record.source.accessedAt,
      locator: record.source.locator,
      sourceVersion: record.source.sourceVersion,
      rightsNote: record.source.rightsNote,
    },
    reviewStatus: record.reviewStatus,
    reviewNote: record.reviewNote,
    contentHash: record.contentHash,
    metadata: {
      schemaVersion: record.schemaVersion,
      topic: record.topic,
      publicationStatus: record.source.publicationStatus,
      accessStatus: record.source.accessStatus,
      reusePolicy: record.reusePolicy,
    },
  })));

  const flagshipExtension = xunpuV4AddedKnowledgeRecords.map((record) => ({
    knowledgeId: record.knowledgeId,
    courseId: "course-xunpu-intangible-media",
    title: record.title,
    teachingSummary: record.teachingSummary,
    applicableSectionIds: [],
    source: {
      sourceId: `seed-source-${record.url}`,
      title: record.sourceTitle,
      publisher: record.publisher,
      url: record.url,
      publicationDate: record.publishedAt,
      accessedAt: record.accessedAt,
      locator: record.locator,
      sourceVersion: record.sourceVersion,
    },
    reviewStatus: record.reviewStatus,
    contentHash: record.contentHash,
    metadata: {
      extension: "xunpu-flagship-v4",
      copyrightNote: record.copyrightNote,
      storedExcerpt: record.storedExcerpt,
    },
  }));

  if (base.length !== CONTENT_LIBRARY_SEED_COUNTS.base) {
    throw new Error(`Expected ${CONTENT_LIBRARY_SEED_COUNTS.base} base knowledge records, got ${base.length}`);
  }
  if (flagshipExtension.length !== CONTENT_LIBRARY_SEED_COUNTS.flagshipExtension) {
    throw new Error(`Expected ${CONTENT_LIBRARY_SEED_COUNTS.flagshipExtension} flagship extension records, got ${flagshipExtension.length}`);
  }
  const professional = professionalTrainingKnowledgeRecords.map((record): ContentLibrarySeedRecord => {
    const teachingSummary = [record.teachingSummary, `适用条件：${record.applicableConditions.join("；")}`,
      `反例：${record.counterExamples.join("；")}`, `可执行处置：${record.executableDisposal.join("；")}`,
      `事实边界：${record.factBoundary}`].join("\n");
    return {
      knowledgeId: record.knowledgeId, courseId: "course-xunpu-intangible-media", title: record.topic, topic: record.topic,
      teachingSummary, applicableSectionIds: record.applicableSectionIds,
      source: { ...record.source, accessedAt: "2026-09-07T00:00:00.000Z" },
      reviewStatus: record.reviewStatus, reviewNote: record.reviewNote,
      contentHash: hashCanonical({ authoredContentHash: record.contentHash, teachingSummary }),
      metadata: { schemaVersion: record.schemaVersion, authoredContentHash: record.contentHash, accessStatus: record.source.accessStatus,
        factBoundary: record.factBoundary, applicableConditions: record.applicableConditions,
        counterExamples: record.counterExamples, executableDisposal: record.executableDisposal },
    };
  });
  if (professional.length !== CONTENT_LIBRARY_SEED_COUNTS.professional) throw new Error("专业知识种子数量与发布包不一致");
  return [...base, ...flagshipExtension, ...professional];
}

export interface ContentLibraryHandlers {
  initialize(): Promise<void>;
  seedExistingCourseContent(): Promise<ContentLibrarySeedImportResult>;
  retrieve(input: ContentLibrarySearchRequest): Promise<ContentLibrarySearchResult>;
}

export interface ContentLibraryService extends ContentLibraryHandlers {
  listSourceDocuments(input: ContentLibrarySourceListRequest): Promise<readonly unknown[]>;
  listKnowledge(input: ContentLibraryKnowledgeListRequest): Promise<readonly unknown[]>;
  createCaseDraft(input: ContentLibraryCaseDraftInput): Promise<unknown>;
  publishCase(input: ContentLibraryCaseReleaseInput): Promise<unknown>;
  recordReview(input: ContentLibraryReviewInput): Promise<unknown>;
  listReviews(input: { entityType?: ContentLibraryReviewInput["entityType"]; entityId?: string }): Promise<readonly unknown[]>;
}

/** Public API boundary for server composition; routes remain owned by the main group. */
export function createContentLibraryHandlers(port: ContentLibraryIngestionPort): ContentLibraryHandlers {
  return {
    initialize: () => port.migrate(),
    seedExistingCourseContent: () => port.importKnowledgeSeed(buildContentLibrarySeed()),
    retrieve: (input) => port.search(input),
  };
}

/**
 * Register the SQL-backed content service without coupling routes to the store.
 * Every read/write crosses the injected authorization callback before reaching
 * the persistence port; server.ts remains responsible for Fastify wiring.
 */
export function registerContentLibrary(options: {
  port: ContentLibraryServicePort;
  authorize: ContentLibraryAuthorize;
  search?: (input: ContentLibrarySearchRequest) => Promise<ContentLibrarySearchResult>;
}): ContentLibraryService {
  const assertAuthorized = async (request: ContentLibraryAuthorizationRequest): Promise<void> => {
    if (!(await options.authorize(request))) throw new ContentLibraryAuthorizationError(request.action);
  };
  return {
    initialize: () => options.port.migrate(),
    seedExistingCourseContent: async () => {
      await assertAuthorized({ action: "seed_import" });
      return options.port.importKnowledgeSeed(buildContentLibrarySeed());
    },
    retrieve: async (input) => {
      await assertAuthorized({
        action: "search",
        purpose: input.purpose ?? "retrieval",
        courseId: input.courseId,
        subjectRef: input.subjectRef,
      });
      return (options.search ?? ((query) => options.port.search(query)))(input);
    },
    listSourceDocuments: async (input) => {
      await assertAuthorized({ action: "source_read", courseId: input.courseId, purpose: "teaching" });
      return options.port.listSourceDocuments(input);
    },
    listKnowledge: async (input) => {
      await assertAuthorized({ action: "knowledge_read", courseId: input.courseId, purpose: "teaching" });
      return options.port.listKnowledge(input);
    },
    createCaseDraft: async (input) => {
      await assertAuthorized({ action: "case_write", courseId: input.courseId, purpose: "teaching" });
      return options.port.createCaseDraft(input);
    },
    publishCase: async (input) => {
      await assertAuthorized({ action: "case_write", courseId: input.courseId, purpose: "publication" });
      return options.port.publishCase(input);
    },
    recordReview: async (input) => {
      await assertAuthorized({ action: "review_write", resourceRef: `${input.entityType}:${input.entityId}` });
      return options.port.recordReview(input);
    },
    listReviews: async (input) => {
      await assertAuthorized({ action: "knowledge_read", resourceRef: input.entityId, purpose: "audit" });
      return options.port.listReviews(input);
    },
  };
}
