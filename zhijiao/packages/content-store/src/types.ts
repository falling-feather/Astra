import type { IncomingHttpHeaders } from "node:http";

export const CONTENT_STORE_SCHEMA_VERSION = "content-store/1.0.0" as const;

export type SourceDocumentKind =
  | "official"
  | "course_material"
  | "interview"
  | "user_upload"
  | "web_capture"
  | "simulation";

export type SourceRevisionStatus = "current" | "historical" | "failed";
export type KnowledgeReviewStatus =
  | "draft"
  | "pending_expert_review"
  | "verified"
  | "retired";
export type ContentReviewStatus = "pending" | "approved" | "rejected";
export type FragmentRelation = "supports" | "refutes" | "context";
export type AssetKind = "document" | "image" | "audio" | "video" | "other";
export type ProcessingKind = "parse_text" | "parse_pdf" | "ocr" | "asr";
export type ProcessingStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";
export type CaseReleaseStatus = "draft" | "published" | "retired";

export interface SqlResult<Row extends Record<string, unknown> = Record<string, unknown>> {
  rows: Row[];
  affectedRows?: number;
}

/**
 * The intentionally small surface shared by PGlite and a regular PostgreSQL
 * client. The store never depends on a vendor specific query builder.
 */
export interface SqlClient {
  exec(sql: string): Promise<unknown>;
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<SqlResult<Row>>;
  transaction?<T>(callback: (client: SqlClient) => Promise<T>): Promise<T>;
  close?(): Promise<void>;
}

export interface ContentObjectStore {
  put(input: {
    objectKey: string;
    bytes: Uint8Array;
    mimeType: string;
  }): Promise<{ objectKey: string; byteSize: number; sourceByteHash: string }>;
  read?(objectKey: string): Promise<Uint8Array>;
}

export interface SourceLocator {
  page?: number;
  startPage?: number;
  endPage?: number;
  startMs?: number;
  endMs?: number;
  startChar?: number;
  endChar?: number;
  bbox?: { x: number; y: number; width: number; height: number };
  label?: string;
}

export interface SourceDocumentInput {
  sourceId: string;
  courseId?: string | null;
  kind: SourceDocumentKind;
  title: string;
  publisher?: string | null;
  canonicalUrl?: string | null;
  rightsNote?: string | null;
  metadata?: Record<string, unknown>;
}

export interface SourceRevisionInput {
  sourceId: string;
  sourceVersion: string;
  sourceByteHash: string | null;
  mimeType: string;
  byteSize: number;
  objectKey?: string | null;
  publicationDate?: string | null;
  accessedAt?: string;
  status?: SourceRevisionStatus;
  metadata?: Record<string, unknown>;
  fragments: readonly SourceFragmentInput[];
}

export interface SourceFragmentInput {
  fragmentId?: string;
  ordinal: number;
  text: string;
  locator: SourceLocator;
  contentHash?: string;
  metadata?: Record<string, unknown>;
}

export interface SourceDocumentRecord extends SourceDocumentInput {
  createdAt: string;
  updatedAt: string;
}

export interface SourceRevisionRecord extends Omit<SourceRevisionInput, "fragments" | "status"> {
  revisionId: string;
  sourceId: string;
  revisionKey: string;
  sourceByteHash: string | null;
  status: SourceRevisionStatus;
  fragments: SourceFragmentRecord[];
  createdAt: string;
  fragmentCount: number;
}

export interface SourceFragmentRecord extends SourceFragmentInput {
  fragmentId: string;
  revisionId: string;
  contentHash: string;
  createdAt: string;
}

export interface UsageGrantInput {
  grantId?: string;
  sourceRevisionId?: string | null;
  assetId?: string | null;
  courseId?: string | null;
  purpose: "teaching" | "retrieval" | "model_context" | "publication" | "audit";
  scope: "course" | "session" | "role" | "public";
  subjectRef?: string | null;
  grantedBy: string;
  status?: "active" | "expired" | "revoked";
  expiresAt?: string | null;
  note?: string | null;
}

export interface UsageGrantRecord extends Omit<UsageGrantInput, "status"> {
  grantId: string;
  status: NonNullable<UsageGrantInput["status"]>;
  createdAt: string;
}

export interface KnowledgeRecordInput {
  knowledgeId: string;
  courseId: string;
  title: string;
  teachingSummary: string;
  applicableSectionIds?: readonly string[];
  tags?: readonly string[];
  synonyms?: readonly string[];
  reviewStatus?: KnowledgeReviewStatus;
  reviewNote?: string;
  contentHash?: string;
  sourceRevisionId?: string | null;
  sourceRefs?: readonly string[];
  metadata?: Record<string, unknown>;
}

export interface KnowledgeRevisionRecord extends Omit<KnowledgeRecordInput, "contentHash" | "reviewStatus"> {
  knowledgeRevisionId: string;
  revisionNumber: number;
  reviewStatus: KnowledgeReviewStatus;
  contentHash: string;
  createdAt: string;
}

export interface ClaimInput {
  claimId: string;
  knowledgeRevisionId?: string | null;
  statement: string;
  polarity?: "supported" | "contested" | "unknown";
  metadata?: Record<string, unknown>;
}

export interface ClaimRecord extends ClaimInput {
  claimId: string;
  polarity: "supported" | "contested" | "unknown";
  createdAt: string;
}

export interface ClaimSupportInput {
  claimId: string;
  fragmentId: string;
  relation: FragmentRelation;
  note?: string | null;
}

export interface ClaimSupportRecord extends ClaimSupportInput {
  claimSupportId: string;
  createdAt: string;
}

export interface AssetInput {
  assetId?: string;
  sourceRevisionId?: string | null;
  courseId?: string | null;
  objectKey: string;
  assetKind: AssetKind;
  mimeType: string;
  byteSize: number;
  sourceByteHash: string;
  metadata?: Record<string, unknown>;
  rightsStatus?: "unknown" | "pending" | "granted" | "restricted" | "revoked";
  aiDisclosure?: "not_applicable" | "declared" | "missing";
}

export interface AssetRecord extends AssetInput {
  assetId: string;
  rightsStatus: NonNullable<AssetInput["rightsStatus"]>;
  aiDisclosure: NonNullable<AssetInput["aiDisclosure"]>;
  createdAt: string;
}

export interface ProcessingJobInput {
  jobId?: string;
  assetId: string;
  sourceRevisionId: string;
  kind: ProcessingKind;
  provider?: string | null;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}

export interface ProcessingJobRecord extends ProcessingJobInput {
  jobId: string;
  status: ProcessingStatus;
  attemptCount: number;
  errorCode: string | null;
  outputMetadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface CaseDraftInput {
  caseId?: string;
  courseId: string;
  caseKey: string;
  version: number;
  title: string;
  contentHash?: string;
  payload: Record<string, unknown>;
  status?: "draft" | "review";
}

export interface CaseDraftRecord extends CaseDraftInput {
  caseId: string;
  contentHash: string;
  status: NonNullable<CaseDraftInput["status"]>;
  createdAt: string;
  updatedAt: string;
}

export interface CaseReleaseInput {
  releaseId?: string;
  caseId: string;
  courseId: string;
  releaseVersion: string;
  contentHash: string;
  metadata?: Record<string, unknown>;
}

export interface CaseReleaseRecord extends CaseReleaseInput {
  releaseId: string;
  status: CaseReleaseStatus;
  publishedAt: string | null;
  createdAt: string;
}

export interface ContentReviewInput {
  reviewId?: string;
  entityType: "source_revision" | "knowledge_revision" | "case_draft" | "case_release" | "asset";
  entityId: string;
  reviewerId: string;
  status: ContentReviewStatus;
  rationale: string;
  evidenceRefs?: readonly string[];
}

export interface ContentReviewRecord extends ContentReviewInput {
  reviewId: string;
  createdAt: string;
}

export interface ContentSearchInput {
  query: string;
  courseId?: string | null;
  purpose?: UsageGrantInput["purpose"];
  subjectRef?: string | null;
  limit?: number;
  allowedFragmentIds?: ReadonlySet<string>;
  embedding?: {
    modelVersion: string;
    vector: readonly number[];
  };
}

export interface ContentCitation {
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
  reviewStatus: KnowledgeReviewStatus | null;
  score: number;
  embeddingModelVersion?: string | null;
}

export interface ContentSearchResult {
  query: string;
  retrieverVersion: string;
  corpusVersion: string;
  citations: ContentCitation[];
  gaps: string[];
  conflicts: Array<{ claimId: string; supporting: string[]; refuting: string[] }>;
  embeddingModelVersion?: string | null;
}

export interface ContentStore {
  migrate(): Promise<void>;
  close(): Promise<void>;
  getSchemaVersion(): Promise<string>;
  upsertSourceDocument(input: SourceDocumentInput): Promise<SourceDocumentRecord>;
  ingestSourceRevision(input: SourceRevisionInput): Promise<{
    document: SourceDocumentRecord;
    revision: SourceRevisionRecord;
    fragments: SourceFragmentRecord[];
    idempotent: boolean;
  }>;
  listSourceDocuments(input: { courseId?: string | null; limit?: number; cursor?: string }): Promise<SourceDocumentRecord[]>;
  getSourceDocument(sourceId: string): Promise<SourceDocumentRecord | null>;
  getSourceRevision(revisionId: string): Promise<SourceRevisionRecord | null>;
  listSourceFragments(revisionId: string): Promise<SourceFragmentRecord[]>;
  upsertKnowledgeRecord(input: KnowledgeRecordInput): Promise<KnowledgeRevisionRecord>;
  listKnowledge(input: { courseId?: string | null; status?: KnowledgeReviewStatus; limit?: number }): Promise<KnowledgeRevisionRecord[]>;
  getKnowledge(knowledgeId: string, revisionNumber?: number): Promise<KnowledgeRevisionRecord | null>;
  upsertClaim(input: ClaimInput): Promise<ClaimRecord>;
  linkClaimSupport(input: ClaimSupportInput): Promise<ClaimSupportRecord>;
  createAsset(input: AssetInput): Promise<AssetRecord>;
  getAsset(assetId: string): Promise<AssetRecord | null>;
  createProcessingJob(input: ProcessingJobInput): Promise<ProcessingJobRecord>;
  updateProcessingJob(input: {
    jobId: string;
    status: ProcessingStatus;
    errorCode?: string | null;
    outputMetadata?: Record<string, unknown> | null;
    incrementAttempt?: boolean;
  }): Promise<ProcessingJobRecord>;
  listProcessingJobs(input?: { status?: ProcessingStatus; limit?: number }): Promise<ProcessingJobRecord[]>;
  grantUsage(input: UsageGrantInput): Promise<UsageGrantRecord>;
  updateUsageGrantStatus(input: { grantId: string; status: NonNullable<UsageGrantInput["status"]> }): Promise<UsageGrantRecord>;
  listUsageGrants(input: { sourceRevisionId?: string; assetId?: string; purpose?: UsageGrantInput["purpose"]; subjectRef?: string | null }): Promise<UsageGrantRecord[]>;
  createCaseDraft(input: CaseDraftInput): Promise<CaseDraftRecord>;
  getCaseDraft(caseId: string): Promise<CaseDraftRecord | null>;
  listCaseDrafts(input?: { courseId?: string; caseKey?: string }): Promise<CaseDraftRecord[]>;
  publishCase(input: CaseReleaseInput): Promise<CaseReleaseRecord>;
  listCaseReleases(courseId?: string): Promise<CaseReleaseRecord[]>;
  recordReview(input: ContentReviewInput): Promise<ContentReviewRecord>;
  listReviews(input: { entityType?: ContentReviewInput["entityType"]; entityId?: string }): Promise<ContentReviewRecord[]>;
  importKnowledgeSeed(input: readonly SeedKnowledgeLike[]): Promise<KnowledgeSeedImportResult>;
  search(input: ContentSearchInput): Promise<ContentSearchResult>;
  upsertFragmentEmbedding(input: {
    fragmentId: string;
    modelVersion: string;
    vector: readonly number[];
  }): Promise<{ fragmentId: string; modelVersion: string; dimension: number; embeddingHash: string }>;
}

export interface KnowledgeSeedImportResult {
  total: number;
  imported: number;
  idempotent: number;
  sourceRevisionCount: number;
  knowledgeRevisionIds: Record<string, string>;
}

export interface SeedSourceLike {
  sourceId: string;
  title?: string;
  sourceTitle?: string;
  publisher: string;
  url: string;
  publicationDate?: string;
  publishedAt?: string;
  accessedAt?: string;
  locator: string;
  sourceVersion: string;
  rightsNote?: string;
}

export interface SeedKnowledgeLike {
  knowledgeId: string;
  courseId: string;
  topic?: string;
  title?: string;
  teachingSummary: string;
  applicableSectionIds?: readonly string[];
  source?: SeedSourceLike;
  sourceTitle?: string;
  publisher?: string;
  url?: string;
  publishedAt?: string;
  accessedAt?: string;
  locator?: string;
  sourceVersion?: string;
  reviewStatus?: KnowledgeReviewStatus;
  reviewNote?: string;
  contentHash?: string;
  tags?: readonly string[];
  synonyms?: readonly string[];
  metadata?: Record<string, unknown>;
}

export interface HttpImportHeaders {
  headers?: IncomingHttpHeaders;
}
