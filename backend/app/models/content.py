from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Index, Integer, LargeBinary, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


def _content_draft_author_as_last_editor(context) -> int:
    return int(context.get_current_parameters()["author_user_id"])


class ContentPageRecord(TimestampMixin, Base):
    __tablename__ = "content_pages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    slug: Mapped[str] = mapped_column(String(180), unique=True, index=True, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="draft", nullable=False)
    version: Mapped[str] = mapped_column(String(64), nullable=False)
    schema_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    schema_hash: Mapped[str | None] = mapped_column(String(64), index=True, nullable=True)
    current_version_id: Mapped[int | None] = mapped_column(
        ForeignKey(
            "content_page_versions.id",
            name="fk_content_pages_current_version_id_content_page_versions",
            use_alter=True,
        ),
        index=True,
        nullable=True,
    )
    published_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True, nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True, nullable=True)


class ContentDraft(TimestampMixin, Base):
    __tablename__ = "content_drafts"
    __table_args__ = (
        UniqueConstraint(
            "author_user_id",
            "target_slug",
            "active_key",
            name="uq_content_drafts_active_author_target",
        ),
        UniqueConstraint(
            "course_unit_id",
            "active_key",
            name="uq_content_drafts_active_course_unit",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    course_id: Mapped[int | None] = mapped_column(ForeignKey("courses.id"), index=True, nullable=True)
    course_unit_id: Mapped[int | None] = mapped_column(
        ForeignKey("course_units.id"), index=True, nullable=True
    )
    revision: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    author_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    last_editor_user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id"),
        index=True,
        nullable=False,
        default=_content_draft_author_as_last_editor,
    )
    target_slug: Mapped[str] = mapped_column(String(180), index=True, nullable=False)
    title: Mapped[str] = mapped_column(String(240), nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="draft", index=True, nullable=False)
    active_key: Mapped[str | None] = mapped_column(String(16), index=True, nullable=True)
    schema_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    schema_hash: Mapped[str | None] = mapped_column(String(64), index=True, nullable=True)
    base_version_id: Mapped[int | None] = mapped_column(
        ForeignKey(
            "content_page_versions.id",
            name="fk_content_drafts_base_version_id_content_page_versions",
            use_alter=True,
        ),
        index=True,
        nullable=True,
    )
    base_schema_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    allow_script: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    script_risk_level: Mapped[str | None] = mapped_column(String(32), default="none", index=True, nullable=True)
    script_analysis_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    script_review_status: Mapped[str] = mapped_column(String(32), default="not_required", index=True, nullable=False)
    script_reviewed_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True, nullable=True)
    script_reviewed_schema_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    script_reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    script_review_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True, nullable=True)
    withdrawn_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    change_requested_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True, nullable=True)
    change_requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    change_request_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    published_page_id: Mapped[int | None] = mapped_column(ForeignKey("content_pages.id"), index=True, nullable=True)
    published_version_id: Mapped[int | None] = mapped_column(
        ForeignKey(
            "content_page_versions.id",
            name="fk_content_drafts_published_version_id_content_page_versions",
            use_alter=True,
        ),
        index=True,
        nullable=True,
    )
    published_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True, nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ContentPageVersion(TimestampMixin, Base):
    __tablename__ = "content_page_versions"
    __table_args__ = (
        UniqueConstraint("slug", "version", name="uq_content_page_versions_slug_version"),
        UniqueConstraint("source_draft_id", name="uq_content_page_versions_source_draft_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    page_id: Mapped[int] = mapped_column(ForeignKey("content_pages.id"), index=True, nullable=False)
    slug: Mapped[str] = mapped_column(String(180), index=True, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    version: Mapped[str] = mapped_column(String(64), nullable=False)
    schema_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    schema_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    source_draft_id: Mapped[int | None] = mapped_column(ForeignKey("content_drafts.id"), index=True, nullable=True)
    restored_from_version_id: Mapped[int | None] = mapped_column(
        ForeignKey("content_page_versions.id"),
        index=True,
        nullable=True,
    )
    previous_version_id: Mapped[int | None] = mapped_column(
        ForeignKey("content_page_versions.id"),
        index=True,
        nullable=True,
    )
    published_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)


class ContentScriptAsset(TimestampMixin, Base):
    __tablename__ = "content_script_assets"
    __table_args__ = (
        UniqueConstraint(
            "page_version_id",
            "sandbox_id",
            "reference_value_sha256",
            name="uq_content_script_assets_version_sandbox_reference",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    page_id: Mapped[int] = mapped_column(ForeignKey("content_pages.id"), index=True, nullable=False)
    page_version_id: Mapped[int] = mapped_column(ForeignKey("content_page_versions.id"), index=True, nullable=False)
    slug: Mapped[str] = mapped_column(String(180), index=True, nullable=False)
    sandbox_id: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    reference_key: Mapped[str] = mapped_column(String(64), nullable=False)
    reference_value_sha256: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    source_url: Mapped[str] = mapped_column(Text, nullable=False)
    source_host: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    integrity: Mapped[str] = mapped_column(Text, nullable=False)
    matched_algorithm: Mapped[str] = mapped_column(String(16), nullable=False)
    asset_sha256: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    asset_size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    content_bytes: Mapped[bytes] = mapped_column(LargeBinary(length=1_048_576), nullable=False)
    policy_version: Mapped[str] = mapped_column(String(64), nullable=False)
    policy_context_hash: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    published_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, nullable=False)


class ContentScriptHostPolicy(TimestampMixin, Base):
    __tablename__ = "content_script_host_policies"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    source_host: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="watch", index=True, nullable=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewed_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    reviewed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, nullable=False)


class ContentScriptAssetScanRun(TimestampMixin, Base):
    __tablename__ = "content_script_asset_scan_runs"
    __table_args__ = (
        UniqueConstraint("run_key", name="uq_content_script_asset_scan_runs_run_key"),
        Index("ix_script_scan_type_started", "scan_type", "started_at", "id"),
        Index("ix_script_scan_status_started", "status", "started_at", "id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    run_key: Mapped[str] = mapped_column(String(160), index=True, nullable=False)
    scan_type: Mapped[str] = mapped_column(String(32), default="remote_drift", index=True, nullable=False)
    trigger_source: Mapped[str] = mapped_column(String(32), default="manual", index=True, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="success", index=True, nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True, nullable=True)
    created_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True, nullable=True)
    attempt_count: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    scheduler_lease_owner: Mapped[str | None] = mapped_column(String(96), nullable=True)
    scheduler_lease_token: Mapped[str | None] = mapped_column(String(64), nullable=True)
    scheduler_lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True, nullable=True)
    scheduler_heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    filters_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    totals_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    issue_counts_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    issue_summary_json: Mapped[list] = mapped_column(JSON, nullable=False)
    alert_status: Mapped[str] = mapped_column(String(32), default="ok", index=True, nullable=False)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
