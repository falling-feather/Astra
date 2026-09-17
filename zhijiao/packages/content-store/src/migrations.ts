export interface ContentStoreMigration {
  version: string;
  sql: string;
}

export const CONTENT_STORE_MIGRATIONS: readonly ContentStoreMigration[] = [
  {
    version: "content-store/1.0.0",
    sql: `
      CREATE TABLE IF NOT EXISTS source_document (
        source_id TEXT PRIMARY KEY,
        course_id TEXT,
        kind TEXT NOT NULL CHECK (kind IN ('official', 'course_material', 'interview', 'user_upload', 'web_capture', 'simulation')),
        title TEXT NOT NULL CHECK (length(trim(title)) > 0),
        publisher TEXT,
        canonical_url TEXT,
        rights_note TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS source_revision (
        revision_id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL REFERENCES source_document(source_id) ON DELETE RESTRICT,
        revision_key TEXT NOT NULL UNIQUE,
        source_version TEXT NOT NULL,
        source_byte_hash TEXT,
        mime_type TEXT NOT NULL CHECK (length(trim(mime_type)) > 0),
        byte_size BIGINT NOT NULL CHECK (byte_size >= 0),
        object_key TEXT,
        publication_date TEXT,
        accessed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        status TEXT NOT NULL CHECK (status IN ('current', 'historical', 'failed')),
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (source_id, source_version)
      );

      CREATE TABLE IF NOT EXISTS source_fragment (
        fragment_id TEXT PRIMARY KEY,
        revision_id TEXT NOT NULL REFERENCES source_revision(revision_id) ON DELETE RESTRICT,
        ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
        text TEXT NOT NULL CHECK (length(trim(text)) > 0),
        locator JSONB NOT NULL DEFAULT '{}'::jsonb,
        content_hash TEXT NOT NULL CHECK (length(trim(content_hash)) > 0),
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (revision_id, ordinal)
      );

      CREATE TABLE IF NOT EXISTS source_fragment_embedding (
        fragment_id TEXT NOT NULL REFERENCES source_fragment(fragment_id) ON DELETE CASCADE,
        model_version TEXT NOT NULL CHECK (length(trim(model_version)) > 0),
        dimension INTEGER NOT NULL CHECK (dimension > 0),
        vector_json JSONB NOT NULL,
        embedding_hash TEXT NOT NULL CHECK (length(trim(embedding_hash)) > 0),
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (fragment_id, model_version)
      );

      CREATE TABLE IF NOT EXISTS usage_grant (
        grant_id TEXT PRIMARY KEY,
        source_revision_id TEXT REFERENCES source_revision(revision_id) ON DELETE RESTRICT,
        asset_id TEXT,
        course_id TEXT,
        purpose TEXT NOT NULL CHECK (purpose IN ('teaching', 'retrieval', 'model_context', 'publication', 'audit')),
        scope TEXT NOT NULL CHECK (scope IN ('course', 'session', 'role', 'public')),
        subject_ref TEXT,
        granted_by TEXT NOT NULL CHECK (length(trim(granted_by)) > 0),
        status TEXT NOT NULL CHECK (status IN ('active', 'expired', 'revoked')),
        expires_at TIMESTAMPTZ,
        note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK (source_revision_id IS NOT NULL OR asset_id IS NOT NULL)
      );

      CREATE TABLE IF NOT EXISTS knowledge_item (
        knowledge_id TEXT PRIMARY KEY,
        course_id TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS knowledge_revision (
        knowledge_revision_id TEXT PRIMARY KEY,
        knowledge_id TEXT NOT NULL REFERENCES knowledge_item(knowledge_id) ON DELETE RESTRICT,
        revision_number INTEGER NOT NULL CHECK (revision_number > 0),
        title TEXT NOT NULL CHECK (length(trim(title)) > 0),
        teaching_summary TEXT NOT NULL CHECK (length(trim(teaching_summary)) > 0),
        applicable_section_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
        tags JSONB NOT NULL DEFAULT '[]'::jsonb,
        synonyms JSONB NOT NULL DEFAULT '[]'::jsonb,
        review_status TEXT NOT NULL CHECK (review_status IN ('draft', 'pending_expert_review', 'verified', 'retired')),
        review_note TEXT,
        content_hash TEXT NOT NULL CHECK (length(trim(content_hash)) > 0),
        source_revision_id TEXT REFERENCES source_revision(revision_id) ON DELETE RESTRICT,
        source_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (knowledge_id, revision_number),
        UNIQUE (knowledge_id, content_hash)
      );

      CREATE TABLE IF NOT EXISTS claim (
        claim_id TEXT PRIMARY KEY,
        knowledge_revision_id TEXT REFERENCES knowledge_revision(knowledge_revision_id) ON DELETE RESTRICT,
        statement TEXT NOT NULL CHECK (length(trim(statement)) > 0),
        polarity TEXT NOT NULL CHECK (polarity IN ('supported', 'contested', 'unknown')),
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS claim_support (
        claim_support_id TEXT PRIMARY KEY,
        claim_id TEXT NOT NULL REFERENCES claim(claim_id) ON DELETE RESTRICT,
        fragment_id TEXT NOT NULL REFERENCES source_fragment(fragment_id) ON DELETE RESTRICT,
        relation TEXT NOT NULL CHECK (relation IN ('supports', 'refutes', 'context')),
        note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (claim_id, fragment_id, relation)
      );

      CREATE TABLE IF NOT EXISTS asset (
        asset_id TEXT PRIMARY KEY,
        source_revision_id TEXT REFERENCES source_revision(revision_id) ON DELETE RESTRICT,
        course_id TEXT,
        object_key TEXT NOT NULL UNIQUE,
        asset_kind TEXT NOT NULL CHECK (asset_kind IN ('document', 'image', 'audio', 'video', 'other')),
        mime_type TEXT NOT NULL CHECK (length(trim(mime_type)) > 0),
        byte_size BIGINT NOT NULL CHECK (byte_size >= 0),
        source_byte_hash TEXT NOT NULL CHECK (length(trim(source_byte_hash)) > 0),
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        rights_status TEXT NOT NULL CHECK (rights_status IN ('unknown', 'pending', 'granted', 'restricted', 'revoked')),
        ai_disclosure TEXT NOT NULL CHECK (ai_disclosure IN ('not_applicable', 'declared', 'missing')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'usage_grant_asset_id_fkey'
            AND conrelid = 'usage_grant'::regclass
        ) THEN
          ALTER TABLE usage_grant
            ADD CONSTRAINT usage_grant_asset_id_fkey
            FOREIGN KEY (asset_id) REFERENCES asset(asset_id) ON DELETE RESTRICT;
        END IF;
      END $$;

      CREATE TABLE IF NOT EXISTS processing_job (
        job_id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL REFERENCES asset(asset_id) ON DELETE RESTRICT,
        source_revision_id TEXT NOT NULL REFERENCES source_revision(revision_id) ON DELETE RESTRICT,
        kind TEXT NOT NULL CHECK (kind IN ('parse_text', 'parse_pdf', 'ocr', 'asr')),
        provider TEXT,
        idempotency_key TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
        attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
        error_code TEXT,
        output_metadata JSONB,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        started_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS case_draft (
        case_id TEXT PRIMARY KEY,
        course_id TEXT NOT NULL,
        case_key TEXT NOT NULL,
        version INTEGER NOT NULL CHECK (version > 0),
        title TEXT NOT NULL CHECK (length(trim(title)) > 0),
        content_hash TEXT NOT NULL CHECK (length(trim(content_hash)) > 0),
        payload JSONB NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('draft', 'review')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (course_id, case_key, version)
      );

      CREATE TABLE IF NOT EXISTS case_release (
        release_id TEXT PRIMARY KEY,
        case_id TEXT NOT NULL REFERENCES case_draft(case_id) ON DELETE RESTRICT,
        course_id TEXT NOT NULL,
        release_version TEXT NOT NULL,
        content_hash TEXT NOT NULL CHECK (length(trim(content_hash)) > 0),
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'retired')),
        published_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (course_id, release_version)
      );

      CREATE TABLE IF NOT EXISTS content_review (
        review_id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL CHECK (entity_type IN ('source_revision', 'knowledge_revision', 'case_draft', 'case_release', 'asset')),
        entity_id TEXT NOT NULL,
        reviewer_id TEXT NOT NULL CHECK (length(trim(reviewer_id)) > 0),
        status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
        rationale TEXT NOT NULL CHECK (length(trim(rationale)) > 0),
        evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS content_store_schema_migration (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS source_revision_source_id_idx ON source_revision (source_id);
      CREATE INDEX IF NOT EXISTS source_revision_status_idx ON source_revision (status, source_id);
      CREATE INDEX IF NOT EXISTS source_fragment_revision_ordinal_idx ON source_fragment (revision_id, ordinal);
      CREATE INDEX IF NOT EXISTS source_fragment_embedding_model_idx ON source_fragment_embedding (model_version, fragment_id);
      CREATE INDEX IF NOT EXISTS usage_grant_revision_policy_idx ON usage_grant (source_revision_id, purpose, status, course_id, subject_ref);
      CREATE INDEX IF NOT EXISTS usage_grant_asset_policy_idx ON usage_grant (asset_id, purpose, status, course_id, subject_ref);
      CREATE INDEX IF NOT EXISTS knowledge_item_course_idx ON knowledge_item (course_id, knowledge_id);
      CREATE INDEX IF NOT EXISTS knowledge_revision_item_idx ON knowledge_revision (knowledge_id, revision_number DESC);
      CREATE INDEX IF NOT EXISTS knowledge_revision_status_idx ON knowledge_revision (review_status, knowledge_id);
      CREATE INDEX IF NOT EXISTS knowledge_revision_source_idx ON knowledge_revision (source_revision_id);
      CREATE INDEX IF NOT EXISTS claim_knowledge_revision_idx ON claim (knowledge_revision_id);
      CREATE INDEX IF NOT EXISTS claim_support_claim_idx ON claim_support (claim_id);
      CREATE INDEX IF NOT EXISTS claim_support_fragment_idx ON claim_support (fragment_id);
      CREATE INDEX IF NOT EXISTS asset_source_revision_idx ON asset (source_revision_id);
      CREATE INDEX IF NOT EXISTS asset_course_idx ON asset (course_id, asset_id);
      CREATE INDEX IF NOT EXISTS processing_job_status_idx ON processing_job (status, updated_at);
      CREATE INDEX IF NOT EXISTS processing_job_asset_idx ON processing_job (asset_id, source_revision_id);
      CREATE INDEX IF NOT EXISTS case_draft_course_idx ON case_draft (course_id, case_key, version DESC);
      CREATE INDEX IF NOT EXISTS case_release_course_status_idx ON case_release (course_id, status, release_version);
      CREATE INDEX IF NOT EXISTS content_review_entity_idx ON content_review (entity_type, entity_id, created_at);
    `,
  },
] as const;
