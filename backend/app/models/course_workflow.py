"""Course lineage and immutable revision / review facts for the v2 workflow."""

from datetime import datetime
from uuid import uuid4

from sqlalchemy import JSON, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, event
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, utc_now


class CourseFamily(Base):
    __tablename__ = "course_families"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    family_key: Mapped[str] = mapped_column(String(36), default=lambda: str(uuid4()), unique=True, nullable=False)
    school_id: Mapped[int] = mapped_column(ForeignKey("schools.id"), index=True, nullable=False)
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class CourseRevision(Base):
    __tablename__ = "course_revisions"
    __table_args__ = (
        UniqueConstraint("course_id", "revision_number", name="uq_course_revisions_number"),
        CheckConstraint("revision_number >= 0", name="ck_course_revisions_number"),
        Index("ix_course_revisions_course_created", "course_id", "created_at", "id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id"), nullable=False)
    revision_number: Mapped[int] = mapped_column(Integer, nullable=False)
    snapshot_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    content_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class CourseChangeBatch(Base):
    __tablename__ = "course_change_batches"
    __table_args__ = (
        UniqueConstraint("created_by_user_id", "client_request_id", name="uq_course_batches_request"),
        Index("ix_course_batches_school_created", "school_id", "created_at", "id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    school_id: Mapped[int] = mapped_column(ForeignKey("schools.id"), nullable=False)
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    client_request_id: Mapped[str] = mapped_column(String(128), nullable=False)
    request_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    source_revision_id: Mapped[int | None] = mapped_column(ForeignKey("course_revisions.id"), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class CourseCandidate(Base):
    __tablename__ = "course_candidates"
    __table_args__ = (
        UniqueConstraint("batch_id", "course_id", name="uq_course_candidates_batch_course"),
        Index("ix_course_candidates_course_id", "course_id", "id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    batch_id: Mapped[int] = mapped_column(ForeignKey("course_change_batches.id"), nullable=False)
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id"), nullable=False)
    revision_id: Mapped[int] = mapped_column(ForeignKey("course_revisions.id"), nullable=False)
    base_release_id: Mapped[int | None] = mapped_column(ForeignKey("course_releases.id"), nullable=True)
    result_policy_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    impact_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    dependencies_json: Mapped[dict | None] = mapped_column(JSON, default=dict, nullable=True)
    candidate_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class CourseReviewItem(TimestampMixin, Base):
    __tablename__ = "course_review_items"
    __table_args__ = (
        UniqueConstraint("candidate_id", name="uq_course_reviews_candidate"),
        UniqueConstraint("course_id", "active_key", name="uq_course_reviews_active"),
        CheckConstraint("status IN ('submitted', 'approved', 'rejected', 'withdrawn')", name="ck_course_review_status"),
        CheckConstraint("version > 0", name="ck_course_review_version"),
        CheckConstraint("(status = 'submitted' AND active_key IS NOT NULL AND active_key = 'pending') OR (status <> 'submitted' AND active_key IS NULL)", name="ck_course_review_active"),
        Index("ix_course_reviews_school_status", "school_id", "status", "id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    candidate_id: Mapped[int] = mapped_column(ForeignKey("course_candidates.id"), nullable=False)
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id"), nullable=False)
    school_id: Mapped[int] = mapped_column(ForeignKey("schools.id"), nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="submitted", nullable=False)
    active_key: Mapped[str | None] = mapped_column(String(16), default="pending", nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    reviewed_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    review_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class CourseWorkflowOperation(Base):
    __tablename__ = "course_workflow_operations"
    __table_args__ = (UniqueConstraint("actor_user_id", "client_request_id", name="uq_publication_operations_request"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    actor_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    operation_kind: Mapped[str] = mapped_column(String(48), default="publish", nullable=False)
    scope_json: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    client_request_id: Mapped[str] = mapped_column(String(128), nullable=False)
    request_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    receipt_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


def _prevent_rewrite(_mapper, _connection, _target):
    raise ValueError("Workflow snapshots and receipts are immutable")


for _model in (CourseRevision, CourseChangeBatch, CourseCandidate, CourseWorkflowOperation):
    event.listen(_model, "before_update", _prevent_rewrite)
    event.listen(_model, "before_delete", _prevent_rewrite)
