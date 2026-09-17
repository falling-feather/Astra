import { PGlite } from "@electric-sql/pglite";
import type { PGliteInterface } from "@electric-sql/pglite";
import { CONTENT_STORE_MIGRATIONS } from "./migrations.js";
import {
  canonicalStringify,
  hashCanonical,
  hashText,
  stableId,
} from "./canonical.js";
import type {
  AssetInput,
  AssetRecord,
  CaseDraftInput,
  CaseDraftRecord,
  CaseReleaseInput,
  CaseReleaseRecord,
  ClaimInput,
  ClaimRecord,
  ClaimSupportInput,
  ClaimSupportRecord,
  ContentCitation,
  ContentReviewInput,
  ContentReviewRecord,
  ContentSearchInput,
  ContentSearchResult,
  ContentStore,
  KnowledgeRecordInput,
  KnowledgeRevisionRecord,
  KnowledgeSeedImportResult,
  ProcessingJobInput,
  ProcessingJobRecord,
  ProcessingStatus,
  SeedKnowledgeLike,
  SourceDocumentInput,
  SourceDocumentRecord,
  SourceFragmentRecord,
  SourceRevisionInput,
  SourceRevisionRecord,
  SqlClient,
  SqlResult,
  UsageGrantInput,
  UsageGrantRecord,
} from "./types.js";

type Row = Record<string, unknown>;

export class ContentStoreConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContentStoreConflictError";
  }
}

export class ContentStoreValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContentStoreValidationError";
  }
}

type PGliteClientLike = {
  exec(sql: string): Promise<unknown>;
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: Row[]; affectedRows?: number }>;
  transaction?<T>(callback: (client: PGliteClientLike) => Promise<T>): Promise<T>;
  close?(): Promise<void>;
};

/** Adapt PGlite and its transaction object to the store's vendor-neutral SQL port. */
export function createPGliteSqlClient(client: PGliteInterface): SqlClient {
  const raw = client as unknown as PGliteClientLike;
  const adapted: SqlClient = {
    exec: (sql) => raw.exec(sql),
    query: async <T extends Record<string, unknown> = Record<string, unknown>>(
      sql: string,
      params?: readonly unknown[],
    ): Promise<SqlResult<T>> => {
      const result = await raw.query<T>(sql, params ? [...params] : undefined);
      return result.affectedRows === undefined
        ? { rows: result.rows }
        : { rows: result.rows, affectedRows: result.affectedRows };
    },
  };
  if (raw.close) adapted.close = () => raw.close!();
  if (raw.transaction) {
    adapted.transaction = <T>(callback: (transaction: SqlClient) => Promise<T>) =>
      raw.transaction!(async (transaction) => callback(createPGliteSqlClient(
        transaction as unknown as PGliteInterface,
      )));
  }
  return adapted;
}

export async function openPGliteContentStore(
  dataDir = "memory://ronggang-content-store",
): Promise<SqlContentStore> {
  const database = new PGlite(dataDir);
  await database.waitReady;
  const store = new SqlContentStore(createPGliteSqlClient(database));
  await store.migrate();
  return store;
}

function nowIso(): string {
  return new Date().toISOString();
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ContentStoreValidationError(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new ContentStoreValidationError("Expected a string or null");
  return value.trim() || null;
}

function timestampToIso(value: unknown, field: string): string {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) {
      throw new ContentStoreValidationError(`${field} is an invalid timestamp`);
    }
    return value.toISOString();
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) {
      throw new ContentStoreValidationError(`${field} is an invalid timestamp`);
    }
    return new Date(parsed).toISOString();
  }
  throw new ContentStoreValidationError(`${field} must be a timestamp string or Date`);
}

function optionalTimestamp(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  return timestampToIso(value, field);
}

function nonNegativeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ContentStoreValidationError(`${field} must be a non-negative integer`);
  }
  return value;
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ContentStoreValidationError(`${field} must be a positive integer`);
  }
  return value;
}

function jsonValue(value: unknown, fallback: unknown): string {
  return JSON.stringify(value ?? fallback);
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== "string") return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function parseRecord(value: unknown): Record<string, unknown> {
  const parsed = parseJson<unknown>(value, {});
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
}

function parseStringArray(value: unknown): string[] {
  const parsed = parseJson<unknown>(value, []);
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
}

function rowString(row: Row, key: string): string {
  return requiredString(row[key], key);
}

function rowOptionalString(row: Row, key: string): string | null {
  return optionalString(row[key]);
}

function rowNumber(row: Row, key: string): number {
  const value = row[key];
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`Invalid integer returned for ${key}`);
  return parsed;
}

function rowDate(row: Row, key: string): string {
  return timestampToIso(row[key], key);
}

function rowOptionalTimestamp(row: Row, key: string): string | null {
  return optionalTimestamp(row[key], key);
}

function sameValue(left: unknown, right: unknown): boolean {
  return canonicalStringify(left) === canonicalStringify(right);
}

function boundedLimit(value: number | undefined, fallback = 50): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ContentStoreValidationError("limit must be a positive integer");
  }
  return Math.min(value, 200);
}

function normalizeTerms(query: string): string[] {
  const segments = query.toLowerCase().split(/[\s，。；、：！？,.!?;:()（）[\]{}<>《》“”‘’]+/u).filter(Boolean);
  const terms = segments.flatMap((segment) => {
    if (!/[\p{Script=Han}]/u.test(segment) || segment.length < 3) return [segment];
    return [segment, ...Array.from({ length: segment.length - 1 }, (_, index) => segment.slice(index, index + 2))];
  });
  return [...new Set(terms)].filter((term) => term.length > 0);
}

function sourceDocumentFromRow(row: Row): SourceDocumentRecord {
  return {
    sourceId: rowString(row, "source_id"),
    courseId: rowOptionalString(row, "course_id"),
    kind: rowString(row, "kind") as SourceDocumentRecord["kind"],
    title: rowString(row, "title"),
    publisher: rowOptionalString(row, "publisher"),
    canonicalUrl: rowOptionalString(row, "canonical_url"),
    rightsNote: rowOptionalString(row, "rights_note"),
    metadata: parseRecord(row.metadata),
    createdAt: rowDate(row, "created_at"),
    updatedAt: rowDate(row, "updated_at"),
  };
}

function sourceFragmentFromRow(row: Row): SourceFragmentRecord {
  return {
    fragmentId: rowString(row, "fragment_id"),
    revisionId: rowString(row, "revision_id"),
    ordinal: rowNumber(row, "ordinal"),
    text: rowString(row, "text"),
    locator: parseRecord(row.locator) as SourceFragmentRecord["locator"],
    contentHash: rowString(row, "content_hash"),
    metadata: parseRecord(row.metadata),
    createdAt: rowDate(row, "created_at"),
  };
}

function sourceRevisionFromRow(row: Row, fragments: SourceFragmentRecord[] = []): SourceRevisionRecord {
  return {
    sourceId: rowString(row, "source_id"),
    sourceVersion: rowString(row, "source_version"),
    sourceByteHash: rowOptionalString(row, "source_byte_hash"),
    mimeType: rowString(row, "mime_type"),
    byteSize: rowNumber(row, "byte_size"),
    objectKey: rowOptionalString(row, "object_key"),
    publicationDate: rowOptionalString(row, "publication_date"),
    accessedAt: rowDate(row, "accessed_at"),
    status: rowString(row, "status") as NonNullable<SourceRevisionRecord["status"]>,
    metadata: parseRecord(row.metadata),
    fragments,
    revisionId: rowString(row, "revision_id"),
    revisionKey: rowString(row, "revision_key"),
    createdAt: rowDate(row, "created_at"),
    fragmentCount: row["fragment_count"] === undefined ? fragments.length : rowNumber(row, "fragment_count"),
  };
}

function knowledgeFromRow(row: Row): KnowledgeRevisionRecord {
  const reviewNote = rowOptionalString(row, "review_note");
  return {
    knowledgeId: rowString(row, "knowledge_id"),
    courseId: rowString(row, "course_id"),
    title: rowString(row, "title"),
    teachingSummary: rowString(row, "teaching_summary"),
    applicableSectionIds: parseStringArray(row.applicable_section_ids),
    tags: parseStringArray(row.tags),
    synonyms: parseStringArray(row.synonyms),
    reviewStatus: rowString(row, "review_status") as NonNullable<KnowledgeRevisionRecord["reviewStatus"]>,
    contentHash: rowString(row, "content_hash"),
    sourceRevisionId: rowOptionalString(row, "source_revision_id"),
    sourceRefs: parseStringArray(row.source_refs),
    metadata: parseRecord(row.metadata),
    knowledgeRevisionId: rowString(row, "knowledge_revision_id"),
    revisionNumber: rowNumber(row, "revision_number"),
    createdAt: rowDate(row, "created_at"),
    ...(reviewNote === null ? {} : { reviewNote }),
  };
}

function claimFromRow(row: Row): ClaimRecord {
  return {
    claimId: rowString(row, "claim_id"),
    knowledgeRevisionId: rowOptionalString(row, "knowledge_revision_id"),
    statement: rowString(row, "statement"),
    polarity: rowString(row, "polarity") as ClaimRecord["polarity"],
    metadata: parseRecord(row.metadata),
    createdAt: rowDate(row, "created_at"),
  };
}

function claimSupportFromRow(row: Row): ClaimSupportRecord {
  return {
    claimId: rowString(row, "claim_id"),
    fragmentId: rowString(row, "fragment_id"),
    relation: rowString(row, "relation") as ClaimSupportRecord["relation"],
    note: rowOptionalString(row, "note"),
    claimSupportId: rowString(row, "claim_support_id"),
    createdAt: rowDate(row, "created_at"),
  };
}

function assetFromRow(row: Row): AssetRecord {
  return {
    assetId: rowString(row, "asset_id"),
    sourceRevisionId: rowOptionalString(row, "source_revision_id"),
    courseId: rowOptionalString(row, "course_id"),
    objectKey: rowString(row, "object_key"),
    assetKind: rowString(row, "asset_kind") as AssetRecord["assetKind"],
    mimeType: rowString(row, "mime_type"),
    byteSize: rowNumber(row, "byte_size"),
    sourceByteHash: rowString(row, "source_byte_hash"),
    metadata: parseRecord(row.metadata),
    rightsStatus: rowString(row, "rights_status") as AssetRecord["rightsStatus"],
    aiDisclosure: rowString(row, "ai_disclosure") as AssetRecord["aiDisclosure"],
    createdAt: rowDate(row, "created_at"),
  };
}

function processingJobFromRow(row: Row): ProcessingJobRecord {
  return {
    jobId: rowString(row, "job_id"),
    assetId: rowString(row, "asset_id"),
    sourceRevisionId: rowString(row, "source_revision_id"),
    kind: rowString(row, "kind") as ProcessingJobRecord["kind"],
    provider: rowOptionalString(row, "provider"),
    idempotencyKey: rowString(row, "idempotency_key"),
    metadata: parseRecord(row.metadata),
    status: rowString(row, "status") as ProcessingJobRecord["status"],
    attemptCount: rowNumber(row, "attempt_count"),
    errorCode: rowOptionalString(row, "error_code"),
    outputMetadata: row["output_metadata"] === null || row["output_metadata"] === undefined
      ? null
      : parseRecord(row.output_metadata),
    createdAt: rowDate(row, "created_at"),
    updatedAt: rowDate(row, "updated_at"),
    startedAt: row["started_at"] === null || row["started_at"] === undefined ? null : rowDate(row, "started_at"),
    completedAt: row["completed_at"] === null || row["completed_at"] === undefined ? null : rowDate(row, "completed_at"),
  };
}

function usageGrantFromRow(row: Row): UsageGrantRecord {
  return {
    grantId: rowString(row, "grant_id"),
    sourceRevisionId: rowOptionalString(row, "source_revision_id"),
    assetId: rowOptionalString(row, "asset_id"),
    courseId: rowOptionalString(row, "course_id"),
    purpose: rowString(row, "purpose") as UsageGrantRecord["purpose"],
    scope: rowString(row, "scope") as UsageGrantRecord["scope"],
    subjectRef: rowOptionalString(row, "subject_ref"),
    grantedBy: rowString(row, "granted_by"),
    status: rowString(row, "status") as NonNullable<UsageGrantRecord["status"]>,
    expiresAt: rowOptionalTimestamp(row, "expires_at"),
    note: rowOptionalString(row, "note"),
    createdAt: rowDate(row, "created_at"),
  };
}

function caseDraftFromRow(row: Row): CaseDraftRecord {
  return {
    caseId: rowString(row, "case_id"),
    courseId: rowString(row, "course_id"),
    caseKey: rowString(row, "case_key"),
    version: rowNumber(row, "version"),
    title: rowString(row, "title"),
    contentHash: rowString(row, "content_hash"),
    payload: parseRecord(row.payload),
    status: rowString(row, "status") as CaseDraftRecord["status"],
    createdAt: rowDate(row, "created_at"),
    updatedAt: rowDate(row, "updated_at"),
  };
}

function caseReleaseFromRow(row: Row): CaseReleaseRecord {
  return {
    releaseId: rowString(row, "release_id"),
    caseId: rowString(row, "case_id"),
    courseId: rowString(row, "course_id"),
    releaseVersion: rowString(row, "release_version"),
    contentHash: rowString(row, "content_hash"),
    metadata: parseRecord(row.metadata),
    status: rowString(row, "status") as CaseReleaseRecord["status"],
    publishedAt: row["published_at"] === null || row["published_at"] === undefined ? null : rowDate(row, "published_at"),
    createdAt: rowDate(row, "created_at"),
  };
}

function reviewFromRow(row: Row): ContentReviewRecord {
  return {
    reviewId: rowString(row, "review_id"),
    entityType: rowString(row, "entity_type") as ContentReviewRecord["entityType"],
    entityId: rowString(row, "entity_id"),
    reviewerId: rowString(row, "reviewer_id"),
    status: rowString(row, "status") as ContentReviewRecord["status"],
    rationale: rowString(row, "rationale"),
    evidenceRefs: parseStringArray(row.evidence_refs),
    createdAt: rowDate(row, "created_at"),
  };
}

export class SqlContentStore implements ContentStore {
  readonly #client: SqlClient;
  #migrationPromise: Promise<void> | undefined;

  constructor(client: SqlClient) {
    this.#client = client;
  }

  async #withTransaction<T>(callback: (client: SqlClient) => Promise<T>): Promise<T> {
    if (this.#client.transaction) return this.#client.transaction(callback);
    await this.#client.exec("BEGIN");
    try {
      const result = await callback(this.#client);
      await this.#client.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        await this.#client.exec("ROLLBACK");
      } catch {
        // Preserve the original database error.
      }
      throw error;
    }
  }

  async #one<T extends Row>(client: SqlClient, sql: string, params: readonly unknown[] = []): Promise<T | null> {
    const result = await client.query<T>(sql, params);
    return result.rows[0] ?? null;
  }

  async migrate(): Promise<void> {
    if (!this.#migrationPromise) this.#migrationPromise = this.#runMigrations();
    return this.#migrationPromise;
  }

  async #runMigrations(): Promise<void> {
    await this.#client.exec(`
      CREATE TABLE IF NOT EXISTS content_store_schema_migration (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    for (const migration of CONTENT_STORE_MIGRATIONS) {
      await this.#withTransaction(async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [migration.version]);
        const existing = await this.#one(client,
          "SELECT version FROM content_store_schema_migration WHERE version = $1",
          [migration.version],
        );
        if (existing) return;
        await client.exec(migration.sql);
        await client.query(
          "INSERT INTO content_store_schema_migration (version) VALUES ($1) ON CONFLICT (version) DO NOTHING",
          [migration.version],
        );
      });
    }
  }

  async close(): Promise<void> {
    await this.#client.close?.();
  }

  async getSchemaVersion(): Promise<string> {
    const row = await this.#one(this.#client,
      "SELECT version FROM content_store_schema_migration ORDER BY applied_at DESC, version DESC LIMIT 1",
    );
    return row ? rowString(row, "version") : "content-store/0.0.0";
  }

  async #upsertSourceDocument(client: SqlClient, input: SourceDocumentInput): Promise<SourceDocumentRecord> {
    const sourceId = requiredString(input.sourceId, "sourceId");
    const title = requiredString(input.title, "title");
    const metadata = input.metadata ?? {};
    await client.query(
      `INSERT INTO source_document
        (source_id, course_id, kind, title, publisher, canonical_url, rights_note, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       ON CONFLICT (source_id) DO UPDATE SET
         course_id = EXCLUDED.course_id,
         kind = EXCLUDED.kind,
         title = EXCLUDED.title,
         publisher = EXCLUDED.publisher,
         canonical_url = EXCLUDED.canonical_url,
         rights_note = EXCLUDED.rights_note,
         metadata = EXCLUDED.metadata,
         updated_at = CURRENT_TIMESTAMP`,
      [
        sourceId,
        optionalString(input.courseId),
        input.kind,
        title,
        optionalString(input.publisher),
        optionalString(input.canonicalUrl),
        optionalString(input.rightsNote),
        jsonValue(metadata, {}),
      ],
    );
    const row = await this.#one(client, "SELECT * FROM source_document WHERE source_id = $1", [sourceId]);
    if (!row) throw new Error(`Source document disappeared after upsert: ${sourceId}`);
    return sourceDocumentFromRow(row);
  }

  async upsertSourceDocument(input: SourceDocumentInput): Promise<SourceDocumentRecord> {
    return this.#withTransaction((client) => this.#upsertSourceDocument(client, input));
  }

  async #listFragments(client: SqlClient, revisionId: string): Promise<SourceFragmentRecord[]> {
    const result = await client.query(
      "SELECT * FROM source_fragment WHERE revision_id = $1 ORDER BY ordinal ASC",
      [revisionId],
    );
    return result.rows.map(sourceFragmentFromRow);
  }

  async #sourceRevision(client: SqlClient, revisionId: string): Promise<SourceRevisionRecord | null> {
    const row = await this.#one(client,
      `SELECT sr.*, COUNT(sf.fragment_id)::int AS fragment_count
       FROM source_revision sr
       LEFT JOIN source_fragment sf ON sf.revision_id = sr.revision_id
       WHERE sr.revision_id = $1
       GROUP BY sr.revision_id`,
      [revisionId],
    );
    if (!row) return null;
    return sourceRevisionFromRow(row, await this.#listFragments(client, revisionId));
  }

  async #insertSourceRevision(
    client: SqlClient,
    input: SourceRevisionInput,
    document: SourceDocumentRecord,
  ): Promise<{ revision: SourceRevisionRecord; idempotent: boolean }> {
    const sourceVersion = requiredString(input.sourceVersion, "sourceVersion");
    const mimeType = requiredString(input.mimeType, "mimeType");
    const byteSize = nonNegativeInteger(input.byteSize, "byteSize");
    const sourceByteHash = optionalString(input.sourceByteHash);
    const revisionId = stableId("source-revision", input.sourceId, sourceVersion);
    const revisionKey = `${input.sourceId}:${sourceVersion}`;
    const fragments = [...input.fragments].sort((left, right) => left.ordinal - right.ordinal);
    const ordinals = new Set<number>();
    for (const fragment of fragments) {
      nonNegativeInteger(fragment.ordinal, "fragment.ordinal");
      if (ordinals.has(fragment.ordinal)) throw new ContentStoreValidationError("fragment ordinals must be unique");
      ordinals.add(fragment.ordinal);
      requiredString(fragment.text, "fragment.text");
      if (fragment.contentHash !== undefined) requiredString(fragment.contentHash, "fragment.contentHash");
    }

    const existing = await this.#one(client,
      "SELECT * FROM source_revision WHERE source_id = $1 AND source_version = $2",
      [input.sourceId, sourceVersion],
    );
    if (existing) {
      const current = await this.#sourceRevision(client, rowString(existing, "revision_id"));
      if (!current) throw new Error("Source revision disappeared during idempotency check");
      const existingFragments = current.fragments;
      const sameRevision = (
        current.sourceByteHash === sourceByteHash
        && current.mimeType === mimeType
        && current.byteSize === byteSize
        && current.objectKey === optionalString(input.objectKey)
        && current.publicationDate === optionalString(input.publicationDate)
        && current.status === (input.status ?? "current")
        && sameValue(current.metadata, input.metadata ?? {})
        && existingFragments.length === fragments.length
        && existingFragments.every((fragment, index) => {
          const incoming = fragments[index];
          if (!incoming) return false;
          const expectedHash = incoming.contentHash ?? hashText(incoming.text);
          return fragment.ordinal === incoming.ordinal
            && fragment.text === incoming.text
            && fragment.contentHash === expectedHash
            && sameValue(fragment.locator, incoming.locator)
            && sameValue(fragment.metadata, incoming.metadata ?? {});
        })
      );
      if (!sameRevision) {
        throw new ContentStoreConflictError(
          `Source revision is immutable and already exists with different content: ${input.sourceId}@${sourceVersion}`,
        );
      }
      return { revision: current, idempotent: true };
    }

    await client.query(
      `INSERT INTO source_revision
        (revision_id, source_id, revision_key, source_version, source_byte_hash, mime_type, byte_size,
         object_key, publication_date, accessed_at, status, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)`,
      [
        revisionId,
        document.sourceId,
        revisionKey,
        sourceVersion,
        sourceByteHash,
        mimeType,
        byteSize,
        optionalString(input.objectKey),
        optionalString(input.publicationDate),
        input.accessedAt ?? nowIso(),
        input.status ?? "current",
        jsonValue(input.metadata, {}),
      ],
    );
    for (const fragment of fragments) {
      const text = requiredString(fragment.text, "fragment.text");
      const contentHash = fragment.contentHash ?? hashText(text);
      const fragmentId = fragment.fragmentId?.trim() || stableId("source-fragment", revisionId, fragment.ordinal, contentHash);
      await client.query(
        `INSERT INTO source_fragment
          (fragment_id, revision_id, ordinal, text, locator, content_hash, metadata)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb)`,
        [
          fragmentId,
          revisionId,
          fragment.ordinal,
          text,
          jsonValue(fragment.locator, {}),
          contentHash,
          jsonValue(fragment.metadata, {}),
        ],
      );
    }
    const revision = await this.#sourceRevision(client, revisionId);
    if (!revision) throw new Error(`Source revision disappeared after insert: ${revisionId}`);
    return { revision, idempotent: false };
  }

  async ingestSourceRevision(input: SourceRevisionInput): Promise<{
    document: SourceDocumentRecord;
    revision: SourceRevisionRecord;
    fragments: SourceFragmentRecord[];
    idempotent: boolean;
  }> {
    return this.#withTransaction(async (client) => {
      const existingDocument = await this.#one(client,
        "SELECT * FROM source_document WHERE source_id = $1",
        [input.sourceId],
      );
      const document = existingDocument
        ? sourceDocumentFromRow(existingDocument)
        : await this.#upsertSourceDocument(client, {
          sourceId: input.sourceId,
          courseId: input.metadata && typeof input.metadata.courseId === "string" ? input.metadata.courseId : null,
          kind: input.metadata && typeof input.metadata.kind === "string"
            ? input.metadata.kind as SourceDocumentInput["kind"]
            : "course_material",
          title: input.metadata && typeof input.metadata.title === "string" ? input.metadata.title : input.sourceId,
          publisher: input.metadata && typeof input.metadata.publisher === "string" ? input.metadata.publisher : null,
          canonicalUrl: input.metadata && typeof input.metadata.canonicalUrl === "string" ? input.metadata.canonicalUrl : null,
          rightsNote: input.metadata && typeof input.metadata.rightsNote === "string" ? input.metadata.rightsNote : null,
          metadata: input.metadata ?? {},
        });
      const result = await this.#insertSourceRevision(client, input, document);
      return { document, revision: result.revision, fragments: result.revision.fragments, idempotent: result.idempotent };
    });
  }

  async listSourceDocuments(input: { courseId?: string | null; limit?: number; cursor?: string }): Promise<SourceDocumentRecord[]> {
    const limit = boundedLimit(input.limit);
    const params: unknown[] = [];
    const conditions: string[] = [];
    if (input.courseId !== undefined) {
      params.push(optionalString(input.courseId));
      conditions.push(`(course_id = $${params.length} OR course_id IS NULL)`);
    }
    if (input.cursor) {
      params.push(input.cursor);
      conditions.push(`source_id > $${params.length}`);
    }
    params.push(limit);
    const result = await this.#client.query(
      `SELECT * FROM source_document${conditions.length ? ` WHERE ${conditions.join(" AND ")}` : ""}
       ORDER BY source_id ASC LIMIT $${params.length}`,
      params,
    );
    return result.rows.map(sourceDocumentFromRow);
  }

  async getSourceDocument(sourceId: string): Promise<SourceDocumentRecord | null> {
    const row = await this.#one(this.#client, "SELECT * FROM source_document WHERE source_id = $1", [requiredString(sourceId, "sourceId")]);
    return row ? sourceDocumentFromRow(row) : null;
  }

  async getSourceRevision(revisionId: string): Promise<SourceRevisionRecord | null> {
    return this.#sourceRevision(this.#client, requiredString(revisionId, "revisionId"));
  }

  async listSourceFragments(revisionId: string): Promise<SourceFragmentRecord[]> {
    return this.#listFragments(this.#client, requiredString(revisionId, "revisionId"));
  }

  #knowledgePayload(input: KnowledgeRecordInput): Record<string, unknown> {
    return {
      knowledgeId: requiredString(input.knowledgeId, "knowledgeId"),
      courseId: requiredString(input.courseId, "courseId"),
      title: requiredString(input.title, "title"),
      teachingSummary: requiredString(input.teachingSummary, "teachingSummary"),
      applicableSectionIds: [...(input.applicableSectionIds ?? [])],
      tags: [...(input.tags ?? [])],
      synonyms: [...(input.synonyms ?? [])],
      reviewStatus: input.reviewStatus ?? "draft",
      reviewNote: input.reviewNote ?? null,
      sourceRevisionId: input.sourceRevisionId ?? null,
      sourceRefs: [...(input.sourceRefs ?? [])],
      metadata: input.metadata ?? {},
    };
  }

  async #upsertKnowledge(client: SqlClient, input: KnowledgeRecordInput): Promise<{ record: KnowledgeRevisionRecord; idempotent: boolean }> {
    const payload = this.#knowledgePayload(input);
    const knowledgeId = payload.knowledgeId as string;
    const courseId = payload.courseId as string;
    const contentHash = optionalString(input.contentHash) ?? hashCanonical(payload);
    await client.query(
      `INSERT INTO knowledge_item (knowledge_id, course_id)
       VALUES ($1, $2)
       ON CONFLICT (knowledge_id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
       WHERE knowledge_item.course_id = EXCLUDED.course_id`,
      [knowledgeId, courseId],
    );
    const item = await this.#one(client, "SELECT course_id FROM knowledge_item WHERE knowledge_id = $1", [knowledgeId]);
    if (!item || rowString(item, "course_id") !== courseId) {
      throw new ContentStoreConflictError(`Knowledge ID belongs to another course: ${knowledgeId}`);
    }
    const sameHash = await this.#one(client,
      `SELECT kr.*, ki.course_id FROM knowledge_revision kr
       JOIN knowledge_item ki ON ki.knowledge_id = kr.knowledge_id
       WHERE kr.knowledge_id = $1 AND kr.content_hash = $2`,
      [knowledgeId, contentHash],
    );
    if (sameHash) return { record: knowledgeFromRow(sameHash), idempotent: true };
    const latest = await this.#one(client,
      "SELECT revision_number FROM knowledge_revision WHERE knowledge_id = $1 ORDER BY revision_number DESC LIMIT 1",
      [knowledgeId],
    );
    const revisionNumber = latest ? rowNumber(latest, "revision_number") + 1 : 1;
    const knowledgeRevisionId = stableId("knowledge-revision", knowledgeId, revisionNumber, contentHash);
    await client.query(
      `INSERT INTO knowledge_revision
        (knowledge_revision_id, knowledge_id, revision_number, title, teaching_summary,
         applicable_section_ids, tags, synonyms, review_status, review_note, content_hash,
         source_revision_id, source_refs, metadata)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10, $11, $12, $13::jsonb, $14::jsonb)`,
      [
        knowledgeRevisionId,
        knowledgeId,
        revisionNumber,
        payload.title,
        payload.teachingSummary,
        jsonValue(payload.applicableSectionIds, []),
        jsonValue(payload.tags, []),
        jsonValue(payload.synonyms, []),
        payload.reviewStatus,
        payload.reviewNote,
        contentHash,
        optionalString(input.sourceRevisionId),
        jsonValue(payload.sourceRefs, []),
        jsonValue(payload.metadata, {}),
      ],
    );
    const inserted = await this.#one(client,
      `SELECT kr.*, ki.course_id FROM knowledge_revision kr
       JOIN knowledge_item ki ON ki.knowledge_id = kr.knowledge_id
       WHERE kr.knowledge_revision_id = $1`,
      [knowledgeRevisionId],
    );
    if (!inserted) throw new Error(`Knowledge revision disappeared after insert: ${knowledgeRevisionId}`);
    return { record: knowledgeFromRow(inserted), idempotent: false };
  }

  async upsertKnowledgeRecord(input: KnowledgeRecordInput): Promise<KnowledgeRevisionRecord> {
    return (await this.#withTransaction((client) => this.#upsertKnowledge(client, input))).record;
  }

  async listKnowledge(input: { courseId?: string | null; status?: KnowledgeRecordInput["reviewStatus"]; limit?: number }): Promise<KnowledgeRevisionRecord[]> {
    const params: unknown[] = [];
    const conditions: string[] = [];
    if (input.courseId !== undefined) {
      params.push(optionalString(input.courseId));
      conditions.push(`course_id = $${params.length}`);
    }
    if (input.status !== undefined) {
      params.push(input.status);
      conditions.push(`review_status = $${params.length}`);
    }
    params.push(boundedLimit(input.limit));
    const result = await this.#client.query(
      `WITH latest AS (
         SELECT DISTINCT ON (knowledge_id) *
         FROM knowledge_revision
         ORDER BY knowledge_id, revision_number DESC
       )
       SELECT latest.*, ki.course_id
       FROM latest
       JOIN knowledge_item ki ON ki.knowledge_id = latest.knowledge_id
       ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
       ORDER BY latest.knowledge_id ASC
       LIMIT $${params.length}`,
      params,
    );
    return result.rows.map(knowledgeFromRow);
  }

  async getKnowledge(knowledgeId: string, revisionNumber?: number): Promise<KnowledgeRevisionRecord | null> {
    const id = requiredString(knowledgeId, "knowledgeId");
    const row = revisionNumber === undefined
      ? await this.#one(this.#client,
        `SELECT kr.*, ki.course_id FROM knowledge_revision kr
         JOIN knowledge_item ki ON ki.knowledge_id = kr.knowledge_id
         WHERE kr.knowledge_id = $1 ORDER BY kr.revision_number DESC LIMIT 1`,
        [id],
      )
      : await this.#one(this.#client,
        `SELECT kr.*, ki.course_id FROM knowledge_revision kr
         JOIN knowledge_item ki ON ki.knowledge_id = kr.knowledge_id
         WHERE kr.knowledge_id = $1 AND kr.revision_number = $2`,
        [id, positiveInteger(revisionNumber, "revisionNumber")],
      );
    return row ? knowledgeFromRow(row) : null;
  }

  async upsertClaim(input: ClaimInput): Promise<ClaimRecord> {
    return this.#withTransaction(async (client) => {
      const claimId = requiredString(input.claimId, "claimId");
      await client.query(
        `INSERT INTO claim (claim_id, knowledge_revision_id, statement, polarity, metadata)
         VALUES ($1, $2, $3, $4, $5::jsonb)
         ON CONFLICT (claim_id) DO UPDATE SET
           knowledge_revision_id = EXCLUDED.knowledge_revision_id,
           statement = EXCLUDED.statement,
           polarity = EXCLUDED.polarity,
           metadata = EXCLUDED.metadata`,
        [
          claimId,
          optionalString(input.knowledgeRevisionId),
          requiredString(input.statement, "statement"),
          input.polarity ?? "unknown",
          jsonValue(input.metadata, {}),
        ],
      );
      const row = await this.#one(client, "SELECT * FROM claim WHERE claim_id = $1", [claimId]);
      if (!row) throw new Error(`Claim disappeared after upsert: ${claimId}`);
      return claimFromRow(row);
    });
  }

  async linkClaimSupport(input: ClaimSupportInput): Promise<ClaimSupportRecord> {
    return this.#withTransaction(async (client) => {
      const claimId = requiredString(input.claimId, "claimId");
      const fragmentId = requiredString(input.fragmentId, "fragmentId");
      const relation = input.relation;
      const claimSupportId = stableId("claim-support", claimId, fragmentId, relation);
      await client.query(
        `INSERT INTO claim_support (claim_support_id, claim_id, fragment_id, relation, note)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (claim_id, fragment_id, relation) DO UPDATE SET note = EXCLUDED.note`,
        [claimSupportId, claimId, fragmentId, relation, optionalString(input.note)],
      );
      const row = await this.#one(client, "SELECT * FROM claim_support WHERE claim_support_id = $1", [claimSupportId]);
      if (!row) throw new Error(`Claim support disappeared after upsert: ${claimSupportId}`);
      return claimSupportFromRow(row);
    });
  }

  async createAsset(input: AssetInput): Promise<AssetRecord> {
    return this.#withTransaction(async (client) => {
      const objectKey = requiredString(input.objectKey, "objectKey");
      const sourceByteHash = requiredString(input.sourceByteHash, "sourceByteHash");
      const byteSize = nonNegativeInteger(input.byteSize, "byteSize");
      const assetId = input.assetId?.trim() || stableId("asset", objectKey, sourceByteHash);
      const existing = await this.#one(client,
        "SELECT * FROM asset WHERE asset_id = $1 OR object_key = $2",
        [assetId, objectKey],
      );
      if (existing) {
        const same = (
          rowString(existing, "asset_id") === assetId
          && rowString(existing, "object_key") === objectKey
          && rowOptionalString(existing, "source_revision_id") === optionalString(input.sourceRevisionId)
          && rowOptionalString(existing, "course_id") === optionalString(input.courseId)
          && rowString(existing, "asset_kind") === input.assetKind
          && rowString(existing, "mime_type") === input.mimeType
          && rowNumber(existing, "byte_size") === byteSize
          && rowString(existing, "source_byte_hash") === sourceByteHash
          && sameValue(parseRecord(existing.metadata), input.metadata ?? {})
          && rowString(existing, "rights_status") === (input.rightsStatus ?? "unknown")
          && rowString(existing, "ai_disclosure") === (input.aiDisclosure ?? "not_applicable")
        );
        if (!same) throw new ContentStoreConflictError(`Asset is immutable and already exists: ${objectKey}`);
        return assetFromRow(existing);
      }
      await client.query(
        `INSERT INTO asset
          (asset_id, source_revision_id, course_id, object_key, asset_kind, mime_type, byte_size,
           source_byte_hash, metadata, rights_status, ai_disclosure)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)`,
        [
          assetId,
          optionalString(input.sourceRevisionId),
          optionalString(input.courseId),
          objectKey,
          input.assetKind,
          requiredString(input.mimeType, "mimeType"),
          byteSize,
          sourceByteHash,
          jsonValue(input.metadata, {}),
          input.rightsStatus ?? "unknown",
          input.aiDisclosure ?? "not_applicable",
        ],
      );
      const row = await this.#one(client, "SELECT * FROM asset WHERE asset_id = $1", [assetId]);
      if (!row) throw new Error(`Asset disappeared after insert: ${assetId}`);
      return assetFromRow(row);
    });
  }

  async getAsset(assetId: string): Promise<AssetRecord | null> {
    const row = await this.#one(this.#client, "SELECT * FROM asset WHERE asset_id = $1", [requiredString(assetId, "assetId")]);
    return row ? assetFromRow(row) : null;
  }

  async createProcessingJob(input: ProcessingJobInput): Promise<ProcessingJobRecord> {
    return this.#withTransaction(async (client) => {
      const assetId = requiredString(input.assetId, "assetId");
      const sourceRevisionId = requiredString(input.sourceRevisionId, "sourceRevisionId");
      const idempotencyKey = requiredString(input.idempotencyKey, "idempotencyKey");
      const existing = await this.#one(client,
        "SELECT * FROM processing_job WHERE idempotency_key = $1",
        [idempotencyKey],
      );
      if (existing) {
        if (
          rowString(existing, "asset_id") !== assetId
          || rowString(existing, "source_revision_id") !== sourceRevisionId
          || rowString(existing, "kind") !== input.kind
        ) {
          throw new ContentStoreConflictError(`Processing idempotency key was reused with different work: ${idempotencyKey}`);
        }
        return processingJobFromRow(existing);
      }
      const jobId = input.jobId?.trim() || stableId("processing-job", idempotencyKey);
      await client.query(
        `INSERT INTO processing_job
          (job_id, asset_id, source_revision_id, kind, provider, idempotency_key, status, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, 'queued', $7::jsonb)`,
        [
          jobId,
          assetId,
          sourceRevisionId,
          input.kind,
          optionalString(input.provider),
          idempotencyKey,
          jsonValue(input.metadata, {}),
        ],
      );
      const row = await this.#one(client, "SELECT * FROM processing_job WHERE job_id = $1", [jobId]);
      if (!row) throw new Error(`Processing job disappeared after insert: ${jobId}`);
      return processingJobFromRow(row);
    });
  }

  async updateProcessingJob(input: {
    jobId: string;
    status: ProcessingStatus;
    errorCode?: string | null;
    outputMetadata?: Record<string, unknown> | null;
    incrementAttempt?: boolean;
  }): Promise<ProcessingJobRecord> {
    return this.#withTransaction(async (client) => {
      const jobId = requiredString(input.jobId, "jobId");
      const existing = await this.#one(client, "SELECT * FROM processing_job WHERE job_id = $1", [jobId]);
      if (!existing) throw new ContentStoreValidationError(`Unknown processing job: ${jobId}`);
      const current = rowString(existing, "status") as ProcessingStatus;
      const allowed: Record<ProcessingStatus, readonly ProcessingStatus[]> = {
        queued: ["queued", "running", "cancelled", "failed"],
        running: ["running", "succeeded", "failed", "cancelled"],
        succeeded: ["succeeded"],
        failed: ["failed", "queued", "running"],
        cancelled: ["cancelled", "queued"],
      };
      if (!allowed[current].includes(input.status)) {
        throw new ContentStoreConflictError(`Invalid processing state transition ${current} -> ${input.status}`);
      }
      const terminal = input.status === "succeeded" || input.status === "failed" || input.status === "cancelled";
      await client.query(
        `UPDATE processing_job SET
           status = $2,
           attempt_count = attempt_count + $3,
           error_code = $4,
           output_metadata = $5::jsonb,
           updated_at = CURRENT_TIMESTAMP,
           started_at = CASE WHEN $2 = 'running' THEN COALESCE(started_at, CURRENT_TIMESTAMP) ELSE started_at END,
           completed_at = CASE WHEN $6 THEN COALESCE(completed_at, CURRENT_TIMESTAMP) ELSE NULL END
         WHERE job_id = $1`,
        [
          jobId,
          input.status,
          input.incrementAttempt ? 1 : 0,
          input.errorCode === undefined ? rowOptionalString(existing, "error_code") : optionalString(input.errorCode),
          input.outputMetadata === undefined
            ? (existing.output_metadata === null || existing.output_metadata === undefined ? null : JSON.stringify(parseRecord(existing.output_metadata)))
            : input.outputMetadata === null ? null : JSON.stringify(input.outputMetadata),
          terminal,
        ],
      );
      const row = await this.#one(client, "SELECT * FROM processing_job WHERE job_id = $1", [jobId]);
      if (!row) throw new Error(`Processing job disappeared after update: ${jobId}`);
      return processingJobFromRow(row);
    });
  }

  async listProcessingJobs(input: { status?: ProcessingStatus; limit?: number } = {}): Promise<ProcessingJobRecord[]> {
    const params: unknown[] = [];
    const conditions: string[] = [];
    if (input.status !== undefined) {
      params.push(input.status);
      conditions.push(`status = $${params.length}`);
    }
    params.push(boundedLimit(input.limit));
    const result = await this.#client.query(
      `SELECT * FROM processing_job${conditions.length ? ` WHERE ${conditions.join(" AND ")}` : ""}
       ORDER BY updated_at ASC, job_id ASC LIMIT $${params.length}`,
      params,
    );
    return result.rows.map(processingJobFromRow);
  }

  async #grantUsage(client: SqlClient, input: UsageGrantInput): Promise<UsageGrantRecord> {
    const sourceRevisionId = optionalString(input.sourceRevisionId);
    const assetId = optionalString(input.assetId);
    const expiresAt = optionalTimestamp(input.expiresAt, "expiresAt");
    if (!sourceRevisionId && !assetId) {
      throw new ContentStoreValidationError("A usage grant must reference a source revision or asset");
    }
    const grantedBy = requiredString(input.grantedBy, "grantedBy");
    const grantId = input.grantId?.trim() || stableId(
      "usage-grant",
      sourceRevisionId,
      assetId,
      input.courseId ?? null,
      input.purpose,
      input.scope,
      input.subjectRef ?? null,
      grantedBy,
      expiresAt,
    );
    const existing = await this.#one(client, "SELECT * FROM usage_grant WHERE grant_id = $1", [grantId]);
    if (existing) {
      const same = (
        rowOptionalString(existing, "source_revision_id") === sourceRevisionId
        && rowOptionalString(existing, "asset_id") === assetId
        && rowOptionalString(existing, "course_id") === optionalString(input.courseId)
        && rowString(existing, "purpose") === input.purpose
        && rowString(existing, "scope") === input.scope
        && rowOptionalString(existing, "subject_ref") === optionalString(input.subjectRef)
        && rowString(existing, "granted_by") === grantedBy
        && rowString(existing, "status") === (input.status ?? "active")
        && rowOptionalTimestamp(existing, "expires_at") === expiresAt
        && rowOptionalString(existing, "note") === optionalString(input.note)
      );
      if (!same) throw new ContentStoreConflictError(`Usage grant ID was reused with different policy: ${grantId}`);
      return usageGrantFromRow(existing);
    }
    await client.query(
      `INSERT INTO usage_grant
        (grant_id, source_revision_id, asset_id, course_id, purpose, scope, subject_ref, granted_by, status, expires_at, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        grantId,
        sourceRevisionId,
        assetId,
        optionalString(input.courseId),
        input.purpose,
        input.scope,
        optionalString(input.subjectRef),
        grantedBy,
        input.status ?? "active",
        expiresAt,
        optionalString(input.note),
      ],
    );
    const row = await this.#one(client, "SELECT * FROM usage_grant WHERE grant_id = $1", [grantId]);
    if (!row) throw new Error(`Usage grant disappeared after insert: ${grantId}`);
    return usageGrantFromRow(row);
  }

  async grantUsage(input: UsageGrantInput): Promise<UsageGrantRecord> {
    return this.#withTransaction((client) => this.#grantUsage(client, input));
  }

  async updateUsageGrantStatus(input: {
    grantId: string;
    status: NonNullable<UsageGrantInput["status"]>;
  }): Promise<UsageGrantRecord> {
    return this.#withTransaction(async (client) => {
      const grantId = requiredString(input.grantId, "grantId");
      const existing = await this.#one(client, "SELECT * FROM usage_grant WHERE grant_id = $1", [grantId]);
      if (!existing) throw new ContentStoreValidationError(`Unknown usage grant: ${grantId}`);
      await client.query(
        "UPDATE usage_grant SET status = $2 WHERE grant_id = $1",
        [grantId, input.status],
      );
      const row = await this.#one(client, "SELECT * FROM usage_grant WHERE grant_id = $1", [grantId]);
      if (!row) throw new Error(`Usage grant disappeared after status update: ${grantId}`);
      return usageGrantFromRow(row);
    });
  }

  async listUsageGrants(input: {
    sourceRevisionId?: string;
    assetId?: string;
    purpose?: UsageGrantInput["purpose"];
    subjectRef?: string | null;
  }): Promise<UsageGrantRecord[]> {
    const params: unknown[] = [];
    const conditions: string[] = [];
    if (input.sourceRevisionId !== undefined) {
      params.push(requiredString(input.sourceRevisionId, "sourceRevisionId"));
      conditions.push(`source_revision_id = $${params.length}`);
    }
    if (input.assetId !== undefined) {
      params.push(requiredString(input.assetId, "assetId"));
      conditions.push(`asset_id = $${params.length}`);
    }
    if (input.purpose !== undefined) {
      params.push(input.purpose);
      conditions.push(`purpose = $${params.length}`);
    }
    if (input.subjectRef !== undefined) {
      params.push(optionalString(input.subjectRef));
      conditions.push(input.subjectRef === null ? "subject_ref IS NULL" : `subject_ref = $${params.length}`);
    }
    const result = await this.#client.query(
      `SELECT * FROM usage_grant${conditions.length ? ` WHERE ${conditions.join(" AND ")}` : ""}
       ORDER BY created_at ASC, grant_id ASC`,
      params,
    );
    return result.rows.map(usageGrantFromRow);
  }

  async createCaseDraft(input: CaseDraftInput): Promise<CaseDraftRecord> {
    return this.#withTransaction(async (client) => {
      const courseId = requiredString(input.courseId, "courseId");
      const caseKey = requiredString(input.caseKey, "caseKey");
      const version = positiveInteger(input.version, "version");
      const title = requiredString(input.title, "title");
      const contentHash = optionalString(input.contentHash) ?? hashCanonical({ courseId, caseKey, version, title, payload: input.payload });
      const caseId = input.caseId?.trim() || stableId("case-draft", courseId, caseKey, version, contentHash);
      const existing = await this.#one(client,
        "SELECT * FROM case_draft WHERE case_id = $1 OR (course_id = $2 AND case_key = $3 AND version = $4)",
        [caseId, courseId, caseKey, version],
      );
      if (existing) {
        const same = (
          rowString(existing, "case_id") === caseId
          && rowString(existing, "course_id") === courseId
          && rowString(existing, "case_key") === caseKey
          && rowNumber(existing, "version") === version
          && rowString(existing, "title") === title
          && rowString(existing, "content_hash") === contentHash
          && sameValue(parseRecord(existing.payload), input.payload)
          && rowString(existing, "status") === (input.status ?? "draft")
        );
        if (!same) throw new ContentStoreConflictError(`Case draft version is immutable: ${courseId}/${caseKey}@${version}`);
        return caseDraftFromRow(existing);
      }
      await client.query(
        `INSERT INTO case_draft
          (case_id, course_id, case_key, version, title, content_hash, payload, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
        [caseId, courseId, caseKey, version, title, contentHash, jsonValue(input.payload, {}), input.status ?? "draft"],
      );
      const row = await this.#one(client, "SELECT * FROM case_draft WHERE case_id = $1", [caseId]);
      if (!row) throw new Error(`Case draft disappeared after insert: ${caseId}`);
      return caseDraftFromRow(row);
    });
  }

  async getCaseDraft(caseId: string): Promise<CaseDraftRecord | null> {
    const row = await this.#one(this.#client, "SELECT * FROM case_draft WHERE case_id = $1", [requiredString(caseId, "caseId")]);
    return row ? caseDraftFromRow(row) : null;
  }

  async listCaseDrafts(input: { courseId?: string; caseKey?: string } = {}): Promise<CaseDraftRecord[]> {
    const params: unknown[] = [], conditions: string[] = [];
    if (input.courseId !== undefined) { params.push(requiredString(input.courseId, "courseId")); conditions.push(`course_id = $${params.length}`); }
    if (input.caseKey !== undefined) { params.push(requiredString(input.caseKey, "caseKey")); conditions.push(`case_key = $${params.length}`); }
    const result = await this.#client.query(`SELECT * FROM case_draft${conditions.length ? ` WHERE ${conditions.join(" AND ")}` : ""} ORDER BY created_at, version, case_id`, params);
    return result.rows.map(caseDraftFromRow);
  }

  async publishCase(input: CaseReleaseInput): Promise<CaseReleaseRecord> {
    return this.#withTransaction(async (client) => {
      const caseId = requiredString(input.caseId, "caseId");
      const draft = await this.#one(client, "SELECT * FROM case_draft WHERE case_id = $1", [caseId]);
      if (!draft) throw new ContentStoreValidationError(`Cannot publish unknown case draft: ${caseId}`);
      const courseId = requiredString(input.courseId, "courseId");
      if (rowString(draft, "course_id") !== courseId) throw new ContentStoreConflictError("Case release course does not match draft");
      if (rowString(draft, "content_hash") !== requiredString(input.contentHash, "contentHash")) {
        throw new ContentStoreConflictError("Case release content hash does not match the immutable draft");
      }
      const releaseVersion = requiredString(input.releaseVersion, "releaseVersion");
      const contentHash = requiredString(input.contentHash, "contentHash");
      const releaseId = input.releaseId?.trim() || stableId("case-release", courseId, releaseVersion, contentHash);
      const existing = await this.#one(client,
        "SELECT * FROM case_release WHERE release_id = $1 OR (course_id = $2 AND release_version = $3)",
        [releaseId, courseId, releaseVersion],
      );
      if (existing) {
        if (
          rowString(existing, "release_id") !== releaseId
          || rowString(existing, "case_id") !== caseId
          || rowString(existing, "content_hash") !== contentHash
        ) throw new ContentStoreConflictError(`Case release version is immutable: ${courseId}/${releaseVersion}`);
        return caseReleaseFromRow(existing);
      }
      await client.query(
        `INSERT INTO case_release
          (release_id, case_id, course_id, release_version, content_hash, metadata, status, published_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'published', CURRENT_TIMESTAMP)`,
        [releaseId, caseId, courseId, releaseVersion, contentHash, jsonValue(input.metadata, {})],
      );
      const row = await this.#one(client, "SELECT * FROM case_release WHERE release_id = $1", [releaseId]);
      if (!row) throw new Error(`Case release disappeared after insert: ${releaseId}`);
      return caseReleaseFromRow(row);
    });
  }

  async listCaseReleases(courseId?: string): Promise<CaseReleaseRecord[]> {
    const params: unknown[] = [];
    const condition = courseId === undefined ? "" : "WHERE course_id = $1";
    if (courseId !== undefined) params.push(requiredString(courseId, "courseId"));
    const result = await this.#client.query(
      `SELECT * FROM case_release ${condition} ORDER BY created_at ASC, release_id ASC`,
      params,
    );
    return result.rows.map(caseReleaseFromRow);
  }

  async recordReview(input: ContentReviewInput): Promise<ContentReviewRecord> {
    return this.#withTransaction(async (client) => {
      const entityType = input.entityType;
      const entityId = requiredString(input.entityId, "entityId");
      const reviewerId = requiredString(input.reviewerId, "reviewerId");
      const rationale = requiredString(input.rationale, "rationale");
      const evidenceRefs = [...(input.evidenceRefs ?? [])];
      const reviewId = input.reviewId?.trim() || stableId("content-review", entityType, entityId, reviewerId, input.status, rationale, evidenceRefs);
      const existing = await this.#one(client, "SELECT * FROM content_review WHERE review_id = $1", [reviewId]);
      if (existing) {
        const same = (
          rowString(existing, "entity_type") === entityType
          && rowString(existing, "entity_id") === entityId
          && rowString(existing, "reviewer_id") === reviewerId
          && rowString(existing, "status") === input.status
          && rowString(existing, "rationale") === rationale
          && sameValue(parseStringArray(existing.evidence_refs), evidenceRefs)
        );
        if (!same) throw new ContentStoreConflictError(`Review ID was reused with different content: ${reviewId}`);
        return reviewFromRow(existing);
      }
      await client.query(
        `INSERT INTO content_review
          (review_id, entity_type, entity_id, reviewer_id, status, rationale, evidence_refs)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
        [reviewId, entityType, entityId, reviewerId, input.status, rationale, jsonValue(evidenceRefs, [])],
      );
      const row = await this.#one(client, "SELECT * FROM content_review WHERE review_id = $1", [reviewId]);
      if (!row) throw new Error(`Review disappeared after insert: ${reviewId}`);
      return reviewFromRow(row);
    });
  }

  async listReviews(input: { entityType?: ContentReviewInput["entityType"]; entityId?: string }): Promise<ContentReviewRecord[]> {
    const params: unknown[] = [];
    const conditions: string[] = [];
    if (input.entityType !== undefined) {
      params.push(input.entityType);
      conditions.push(`entity_type = $${params.length}`);
    }
    if (input.entityId !== undefined) {
      params.push(requiredString(input.entityId, "entityId"));
      conditions.push(`entity_id = $${params.length}`);
    }
    const result = await this.#client.query(
      `SELECT * FROM content_review${conditions.length ? ` WHERE ${conditions.join(" AND ")}` : ""}
       ORDER BY created_at ASC, review_id ASC`,
      params,
    );
    return result.rows.map(reviewFromRow);
  }

  async upsertFragmentEmbedding(input: {
    fragmentId: string;
    modelVersion: string;
    vector: readonly number[];
  }): Promise<{ fragmentId: string; modelVersion: string; dimension: number; embeddingHash: string }> {
    const fragmentId = requiredString(input.fragmentId, "fragmentId");
    const modelVersion = requiredString(input.modelVersion, "modelVersion");
    if (input.vector.length === 0 || input.vector.some((value) => !Number.isFinite(value))) {
      throw new ContentStoreValidationError("embedding vector must be a non-empty finite vector");
    }
    const vector = [...input.vector];
    const embeddingHash = hashCanonical(vector);
    await this.#client.query(
      `INSERT INTO source_fragment_embedding
        (fragment_id, model_version, dimension, vector_json, embedding_hash)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       ON CONFLICT (fragment_id, model_version) DO UPDATE SET
         dimension = EXCLUDED.dimension,
         vector_json = EXCLUDED.vector_json,
         embedding_hash = EXCLUDED.embedding_hash`,
      [fragmentId, modelVersion, vector.length, JSON.stringify(vector), embeddingHash],
    );
    return { fragmentId, modelVersion, dimension: vector.length, embeddingHash };
  }

  async importKnowledgeSeed(input: readonly SeedKnowledgeLike[]): Promise<KnowledgeSeedImportResult> {
    if (input.length === 0) {
      return { total: 0, imported: 0, idempotent: 0, sourceRevisionCount: 0, knowledgeRevisionIds: {} };
    }
    type SeedSource = {
      sourceId: string;
      sourceVersion: string;
      title: string;
      publisher: string;
      url: string | null;
      publicationDate: string | null;
      accessedAt: string | null;
      locatorByKnowledgeId: Map<string, string>;
      items: SeedKnowledgeLike[];
    };
    const groups = new Map<string, SeedSource>();
    for (const item of input) {
      const knowledgeId = requiredString(item.knowledgeId, "knowledgeId");
      const sourceId = requiredString(item.source?.sourceId, `sourceId for ${knowledgeId}`);
      const sourceTitle = requiredString(
        item.source?.title ?? item.source?.sourceTitle ?? item.sourceTitle ?? sourceId,
        `source title for ${knowledgeId}`,
      );
      const publisher = requiredString(item.source?.publisher ?? item.publisher, `publisher for ${knowledgeId}`);
      const url = optionalString(item.source?.url ?? item.url);
      const sourceVersion = requiredString(
        item.source?.sourceVersion
          ?? item.sourceVersion
          ?? stableId("seed-source-version", sourceId, url, item.source?.publicationDate ?? item.publishedAt ?? null),
        `sourceVersion for ${knowledgeId}`,
      );
      const groupKey = `${sourceId}\u0000${sourceVersion}`;
      let group = groups.get(groupKey);
      if (!group) {
        group = {
          sourceId,
          sourceVersion,
          title: sourceTitle,
          publisher,
          url,
          publicationDate: optionalString(item.source?.publicationDate ?? item.publishedAt),
          accessedAt: optionalString(item.source?.accessedAt ?? item.accessedAt),
          locatorByKnowledgeId: new Map(),
          items: [],
        };
        groups.set(groupKey, group);
      } else if (group.title !== sourceTitle || group.publisher !== publisher || group.url !== url) {
        throw new ContentStoreConflictError(`Seed records disagree about source ${sourceId}@${sourceVersion}`);
      }
      group.locatorByKnowledgeId.set(
        knowledgeId,
        requiredString(item.source?.locator ?? item.locator ?? item.title ?? item.topic ?? knowledgeId, `locator for ${knowledgeId}`),
      );
      group.items.push(item);
    }

    return this.#withTransaction(async (client) => {
      let imported = 0;
      let idempotent = 0;
      const knowledgeRevisionIds: Record<string, string> = {};
      for (const group of groups.values()) {
        const document = await this.#upsertSourceDocument(client, {
          sourceId: group.sourceId,
          courseId: null,
          kind: "official",
          title: group.title,
          publisher: group.publisher,
          canonicalUrl: group.url,
          rightsNote: "仅保存来源元数据、定位和教学改写；没有原件时不生成源字节 hash。",
          metadata: {
            seedImport: true,
            sourceVersion: group.sourceVersion,
            representation: "paraphrase/metadata-only",
          },
        });
        const sortedItems = [...group.items].sort((left, right) => left.knowledgeId.localeCompare(right.knowledgeId));
        const revisionInput: SourceRevisionInput = {
          sourceId: group.sourceId,
          sourceVersion: group.sourceVersion,
          sourceByteHash: null,
          mimeType: "text/plain",
          byteSize: 0,
          objectKey: null,
          publicationDate: group.publicationDate,
          status: "current",
          metadata: {
            seedImport: true,
            derivedText: "teaching_summary",
            representation: "paraphrase/metadata-only",
            sourceUrl: group.url,
          },
          fragments: sortedItems.map((item, ordinal) => ({
            fragmentId: stableId("seed-fragment", group.sourceId, group.sourceVersion, item.knowledgeId),
            ordinal,
            text: requiredString(item.teachingSummary, `teachingSummary for ${item.knowledgeId}`),
            locator: { label: group.locatorByKnowledgeId.get(item.knowledgeId) ?? item.knowledgeId },
            metadata: {
              seedKnowledgeId: item.knowledgeId,
              derivedText: true,
              representation: "paraphrase/metadata-only",
            },
          })),
          ...(group.accessedAt === null ? {} : { accessedAt: group.accessedAt }),
        };
        const revisionResult = await this.#insertSourceRevision(client, revisionInput, document);
        const fragmentByKnowledgeId = new Map(
          revisionResult.revision.fragments.map((fragment) => [
            requiredString(parseRecord(fragment.metadata).seedKnowledgeId, "seed fragment knowledgeId"),
            fragment,
          ]),
        );
        for (const item of group.items) {
          const fragment = fragmentByKnowledgeId.get(item.knowledgeId);
          if (!fragment) throw new Error(`Missing seed fragment for ${item.knowledgeId}`);
          const knowledgeInput: KnowledgeRecordInput = {
            knowledgeId: item.knowledgeId,
            courseId: item.courseId,
            title: item.title ?? item.topic ?? item.knowledgeId,
            teachingSummary: item.teachingSummary,
            applicableSectionIds: item.applicableSectionIds ?? [],
            tags: item.tags ?? [],
            synonyms: item.synonyms ?? [],
            reviewStatus: item.reviewStatus ?? "pending_expert_review",
            sourceRevisionId: revisionResult.revision.revisionId,
            sourceRefs: [group.sourceId, fragment.fragmentId],
            metadata: {
              ...(item.metadata ?? {}),
              seedSource: {
                sourceId: group.sourceId,
                title: group.title,
                publisher: group.publisher,
                url: group.url,
                sourceVersion: group.sourceVersion,
                locator: group.locatorByKnowledgeId.get(item.knowledgeId),
              },
            },
          };
          if (item.reviewNote !== undefined) knowledgeInput.reviewNote = item.reviewNote;
          if (item.contentHash !== undefined) knowledgeInput.contentHash = item.contentHash;
          const result = await this.#upsertKnowledge(client, knowledgeInput);
          knowledgeRevisionIds[item.knowledgeId] = result.record.knowledgeRevisionId;
          if (result.idempotent) idempotent += 1;
          else imported += 1;
          await this.#grantUsage(client, {
            grantId: stableId("seed-usage-grant", revisionResult.revision.revisionId, item.courseId),
            sourceRevisionId: revisionResult.revision.revisionId,
            courseId: item.courseId,
            purpose: "retrieval",
            scope: "course",
            grantedBy: "seed-import",
            status: "active",
            note: "Seed metadata and teaching rewrite only; source bytes were not imported.",
          });
        }
      }
      return {
        total: input.length,
        imported,
        idempotent,
        sourceRevisionCount: groups.size,
        knowledgeRevisionIds,
      };
    });
  }

  async search(input: ContentSearchInput): Promise<ContentSearchResult> {
    const query = input.query.trim();
    const retrieverVersion = input.embedding ? `hybrid-sql-vector/1.1.0:${input.embedding.modelVersion}` : "sql-lexical/1.0.0";
    const terms = normalizeTerms(query);
    const allowedFragmentIds = input.allowedFragmentIds ? [...input.allowedFragmentIds] : undefined;
    if (input.embedding && (
      input.embedding.vector.length === 0
      || input.embedding.vector.some((value) => !Number.isFinite(value))
    )) {
      throw new ContentStoreValidationError("search embedding must be a non-empty finite vector");
    }
    if (allowedFragmentIds && allowedFragmentIds.length === 0) {
      return {
        query: input.query,
        retrieverVersion,
        corpusVersion: "content-store/1.0.0",
        citations: [],
        gaps: ["调用方没有提供可检索的片段范围"],
        conflicts: [],
      };
    }

    const params: unknown[] = [input.purpose ?? "retrieval", optionalString(input.courseId), optionalString(input.subjectRef)];
    const embeddingModelParameter = input.embedding
      ? (() => {
        params.push(requiredString(input.embedding!.modelVersion, "embedding.modelVersion"));
        return `$${params.length}`;
      })()
      : null;
    const embeddingVectorParameter = input.embedding
      ? (() => { params.push([...input.embedding!.vector]); return `$${params.length}::double precision[]`; })()
      : null;
    const embeddingNormParameter = input.embedding
      ? (() => { params.push(input.embedding!.vector.reduce((norm, value) => Math.hypot(norm, value), 0)); return `$${params.length}::double precision`; })()
      : null;
    const termParameters: string[] = [];
    const scoreParts = terms.map((term) => {
      params.push(term);
      const parameter = `$${params.length}`;
      termParameters.push(parameter);
      const haystack = "lower(coalesce(sd.title, '') || ' ' || coalesce(sd.publisher, '') || ' ' || sf.text)";
      return `CASE WHEN position(lower(${parameter}) in ${haystack}) > 0 THEN ${Math.max(1, term.length)} ELSE 0 END`;
    });
    const lexicalCondition = terms.length === 0
      ? ""
      : `(${termParameters.map((parameter) => {
        const haystack = "lower(coalesce(sd.title, '') || ' ' || coalesce(sd.publisher, '') || ' ' || sf.text)";
        return `position(lower(${parameter}) in ${haystack}) > 0`;
      }).join(" OR ")})`;
    const matchCondition = input.embedding
      ? terms.length === 0
        ? "AND sfe.embedding_hash IS NOT NULL"
        : `AND (${lexicalCondition} OR sfe.embedding_hash IS NOT NULL)`
      : lexicalCondition ? `AND ${lexicalCondition}` : "";
    const allowedCondition = allowedFragmentIds
      ? (() => {
        params.push(allowedFragmentIds);
        return `AND sf.fragment_id = ANY($${params.length}::text[])`;
      })()
      : "";
    const requestedLimit = boundedLimit(input.limit, 8);
    params.push(requestedLimit);
    const limitParameter = `$${params.length}`;
    const score = scoreParts.length ? scoreParts.join(" + ") : "0";
    const embeddingSelect = embeddingModelParameter
      ? `sfe.vector_json AS embedding_vector, sfe.model_version AS embedding_model_version,`
      : "NULL::jsonb AS embedding_vector, NULL::text AS embedding_model_version,";
    const embeddingJoin = embeddingModelParameter
      ? `LEFT JOIN source_fragment_embedding sfe
           ON sfe.fragment_id = sf.fragment_id AND sfe.model_version = ${embeddingModelParameter}`
      : "";
    const lexicalMaximum = Math.max(1, terms.reduce((total, term) => total + Math.max(1, term.length), 0));
    // Score the complete authorized set inside one SQL snapshot. The limit applies
    // only after semantic/lexical ranking, not to a prefix of fragment identifiers.
    const vectorScore = embeddingVectorParameter
      ? `CASE WHEN jsonb_array_length(ranked.embedding_vector) = cardinality(${embeddingVectorParameter})
          THEN LEAST(1, GREATEST(0, COALESCE((
            SELECT SUM(component.value::double precision * (${embeddingVectorParameter})[component.ordinality])
              / NULLIF(SQRT(SUM(component.value::double precision * component.value::double precision)) * ${embeddingNormParameter}, 0)
            FROM jsonb_array_elements_text(ranked.embedding_vector) WITH ORDINALITY AS component(value, ordinality)
          ), 0))) ELSE 0 END`
      : "0";
    const combinedScore = input.embedding
      ? `(scored.vector_score * 0.65) + (LEAST(1, GREATEST(0, scored.score / ${lexicalMaximum})) * 0.35)`
      : "scored.score";
    const result = await this.#client.query(
      `SELECT scored.*, (${combinedScore})::double precision AS relevance_score FROM (
        SELECT ranked.*, (${vectorScore})::double precision AS vector_score FROM (
         SELECT DISTINCT ON (sf.fragment_id)
           sf.fragment_id,
           sf.text,
           sf.locator,
           sr.source_id,
           sr.revision_id AS source_revision_id,
           sr.source_version,
           sr.source_byte_hash,
           sd.title,
           sd.publisher,
           sd.canonical_url,
           (${score})::double precision AS score,
           ${embeddingSelect}
           COALESCE((
             SELECT json_agg(DISTINCT kr.knowledge_revision_id)
             FROM knowledge_revision kr
             JOIN knowledge_item ki ON ki.knowledge_id = kr.knowledge_id
             WHERE ($2::text IS NULL OR ki.course_id = $2)
               AND (
                 (jsonb_array_length(kr.source_refs) = 0 AND kr.source_revision_id = sr.revision_id)
                 OR (jsonb_array_length(kr.source_refs) > 0 AND EXISTS (
                   SELECT 1 FROM jsonb_array_elements_text(kr.source_refs) AS ref(value)
                   WHERE ref.value = sf.fragment_id
                 ))
               )
           ), '[]'::json) AS knowledge_revision_ids,
           COALESCE((
             SELECT json_agg(DISTINCT c.claim_id)
             FROM claim_support cs
             JOIN claim c ON c.claim_id = cs.claim_id
             WHERE cs.fragment_id = sf.fragment_id
           ), '[]'::json) AS claim_ids,
           (
             SELECT kr.review_status
             FROM knowledge_revision kr
             JOIN knowledge_item ki ON ki.knowledge_id = kr.knowledge_id
             WHERE ($2::text IS NULL OR ki.course_id = $2)
               AND (
                 (jsonb_array_length(kr.source_refs) = 0 AND kr.source_revision_id = sr.revision_id)
                 OR (jsonb_array_length(kr.source_refs) > 0 AND EXISTS (
                   SELECT 1 FROM jsonb_array_elements_text(kr.source_refs) AS ref(value)
                   WHERE ref.value = sf.fragment_id
                 ))
               )
             ORDER BY kr.revision_number DESC
             LIMIT 1
           ) AS review_status
          FROM source_fragment sf
          JOIN source_revision sr ON sr.revision_id = sf.revision_id
          JOIN source_document sd ON sd.source_id = sr.source_id
          ${embeddingJoin}
         WHERE sr.status IN ('current', 'historical')
           AND (($2::text IS NULL AND sd.course_id IS NULL)
             OR ($2::text IS NOT NULL AND (sd.course_id IS NULL OR sd.course_id = $2)))
           AND EXISTS (
             SELECT 1 FROM usage_grant ug
             WHERE ug.source_revision_id = sr.revision_id
               AND ug.purpose = $1
               AND ug.status = 'active'
               AND (ug.expires_at IS NULL OR ug.expires_at > CURRENT_TIMESTAMP)
               AND (($2::text IS NULL AND ug.course_id IS NULL)
               OR ($2::text IS NOT NULL AND (ug.course_id IS NULL OR ug.course_id = $2)))
               AND (ug.subject_ref IS NULL OR ($3::text IS NOT NULL AND ug.subject_ref = $3))
           )
           AND (
             $2::text IS NULL
             OR NOT EXISTS (
               SELECT 1
               FROM knowledge_revision kr_any
               WHERE (
                 (jsonb_array_length(kr_any.source_refs) = 0 AND kr_any.source_revision_id = sr.revision_id)
                 OR (jsonb_array_length(kr_any.source_refs) > 0 AND EXISTS (
                   SELECT 1 FROM jsonb_array_elements_text(kr_any.source_refs) AS ref(value)
                   WHERE ref.value = sf.fragment_id
                 ))
               )
             )
             OR EXISTS (
               SELECT 1
               FROM knowledge_revision kr_allowed
               JOIN knowledge_item ki_allowed ON ki_allowed.knowledge_id = kr_allowed.knowledge_id
                 WHERE ki_allowed.course_id = $2
                   AND (
                     (jsonb_array_length(kr_allowed.source_refs) = 0 AND kr_allowed.source_revision_id = sr.revision_id)
                     OR (jsonb_array_length(kr_allowed.source_refs) > 0 AND EXISTS (
                       SELECT 1 FROM jsonb_array_elements_text(kr_allowed.source_refs) AS ref(value)
                       WHERE ref.value = sf.fragment_id
                     ))
                   )
             )
           )
           ${matchCondition}
           ${allowedCondition}
         ORDER BY sf.fragment_id, score DESC
        ) AS ranked) AS scored
       ORDER BY relevance_score DESC, scored.fragment_id COLLATE "C" ASC
       LIMIT ${limitParameter}`,
       params,
     );
    const citations: ContentCitation[] = result.rows.map((row) => {
      return {
      citationId: stableId("citation", rowString(row, "fragment_id")),
      sourceId: rowString(row, "source_id"),
      sourceRevisionId: rowString(row, "source_revision_id"),
      fragmentId: rowString(row, "fragment_id"),
      title: rowString(row, "title"),
      publisher: rowOptionalString(row, "publisher"),
      canonicalUrl: rowOptionalString(row, "canonical_url"),
      sourceVersion: rowString(row, "source_version"),
      sourceByteHash: rowOptionalString(row, "source_byte_hash"),
      locator: parseRecord(row.locator) as ContentCitation["locator"],
      text: rowString(row, "text"),
      knowledgeRevisionIds: parseStringArray(row.knowledge_revision_ids),
      claimIds: parseStringArray(row.claim_ids),
      reviewStatus: rowOptionalString(row, "review_status") as ContentCitation["reviewStatus"],
      score: Number(row.relevance_score),
      embeddingModelVersion: rowOptionalString(row, "embedding_model_version"),
      };
    });

    const conflicts: Array<{ claimId: string; supporting: string[]; refuting: string[] }> = [];
    if (citations.length > 0) {
      const supportRows = await this.#client.query(
        `SELECT cs.claim_id, cs.fragment_id, cs.relation
         FROM claim_support cs
         WHERE cs.fragment_id = ANY($1::text[])`,
        [citations.map((citation) => citation.fragmentId)],
      );
      const grouped = new Map<string, { supporting: string[]; refuting: string[] }>();
      for (const row of supportRows.rows) {
        const claimId = rowString(row, "claim_id");
        const existing = grouped.get(claimId) ?? { supporting: [], refuting: [] };
        const fragmentId = rowString(row, "fragment_id");
        if (rowString(row, "relation") === "supports") existing.supporting.push(fragmentId);
        if (rowString(row, "relation") === "refutes") existing.refuting.push(fragmentId);
        grouped.set(claimId, existing);
      }
      for (const [claimId, values] of grouped) {
        if (values.supporting.length > 0 && values.refuting.length > 0) conflicts.push({ claimId, ...values });
      }
    }
    const gaps = citations.length === 0 ? ["没有找到具有当前授权的匹配资料片段"] : [];
    const hasIndexedVector = result.rows.some((row) => {
      const vector = parseJson<unknown>(row.embedding_vector, []);
      return Array.isArray(vector) && vector.length > 0;
    });
    if (input.embedding && !hasIndexedVector) {
      gaps.push(`模型 ${input.embedding.modelVersion} 没有可用片段向量，本次仅使用词项回退`);
    }
    return {
      query: input.query,
      retrieverVersion,
      corpusVersion: "content-store/1.0.0",
      citations,
      gaps,
      conflicts,
      embeddingModelVersion: input.embedding?.modelVersion ?? null,
    };
  }
}
