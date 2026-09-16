"""Versioned system resources; a resource is not a student's course-unit instance."""

from datetime import datetime

from sqlalchemy import JSON, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint, event
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, utc_now


class LearningResource(TimestampMixin, Base):
    __tablename__ = "learning_resources"
    __table_args__ = (
        CheckConstraint("kind IN ('activity', 'template', 'media')", name="ck_learning_resource_kind"),
        CheckConstraint("status IN ('active', 'retired')", name="ck_learning_resource_status"),
        Index("ix_learning_resources_space_subject", "space_key", "subject_key", "status"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    resource_key: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    space_key: Mapped[str] = mapped_column(String(32), nullable=False)
    subject_key: Mapped[str] = mapped_column(String(96), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="active", nullable=False)


class LearningResourceVersion(Base):
    __tablename__ = "learning_resource_versions"
    __table_args__ = (
        UniqueConstraint("resource_id", "version_number", name="uq_resource_versions_number"),
        UniqueConstraint("resource_id", "content_sha256", name="uq_resource_versions_hash"),
        CheckConstraint("version_number > 0", name="ck_resource_versions_number"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    resource_id: Mapped[int] = mapped_column(ForeignKey("learning_resources.id"), index=True, nullable=False)
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(240), nullable=False)
    renderer: Mapped[str] = mapped_column(String(64), nullable=False)
    definition_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    capabilities_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    provenance_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    content_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


@event.listens_for(LearningResourceVersion, "before_update")
@event.listens_for(LearningResourceVersion, "before_delete")
def prevent_resource_version_rewrite(_mapper, _connection, _target):
    raise ValueError("Resource versions are immutable; append a new version instead")
