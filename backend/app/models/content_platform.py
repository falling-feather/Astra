"""Immutable course publication facts for the V8.4 teaching-course loop.

The editable source remains ``CourseUnit`` plus one active shared
``ContentDraft`` for each unit. This module owns only immutable releases and
the append-only pointer history for a course's hidden ``course_cohort``.
"""

from datetime import datetime

from sqlalchemy import (
    JSON,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    event,
)
from sqlalchemy.dialects import mysql
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, utc_now
from app.models.course import Course


def _publication_datetime_type():
    return DateTime(timezone=True).with_variant(mysql.DATETIME(fsp=6), "mysql")


# ``course.py`` is a frozen legacy surface. The V8.4 publication owner attaches
# its aggregate revision here so the old module does not gain a second concern.
Course.content_draft_revision = mapped_column(Integer, default=0, nullable=False)


class CourseRelease(Base):
    __tablename__ = "course_releases"
    __table_args__ = (
        UniqueConstraint(
            "course_id", "release_number", name="uq_course_releases_course_number"
        ),
        UniqueConstraint(
            "course_id", "package_sha256", name="uq_course_releases_course_hash"
        ),
        CheckConstraint(
            "release_number > 0", name="ck_course_releases_number_positive"
        ),
        CheckConstraint(
            "draft_revision >= 0", name="ck_course_releases_draft_revision"
        ),
        CheckConstraint("status = 'published'", name="ck_course_releases_published"),
        Index("ix_course_releases_course_published", "course_id", "published_at", "id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    course_id: Mapped[int] = mapped_column(
        ForeignKey("courses.id"), index=True, nullable=False
    )
    release_number: Mapped[int] = mapped_column(Integer, nullable=False)
    draft_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    schema_version: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="published", nullable=False)
    title_snapshot: Mapped[str] = mapped_column(String(180), nullable=False)
    summary_snapshot: Mapped[str | None] = mapped_column(Text, nullable=True)
    completion_rule_id: Mapped[int | None] = mapped_column(
        ForeignKey("learning_completion_rules.id"), index=True, nullable=True
    )
    completion_rule_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    completion_rule_snapshot: Mapped[dict] = mapped_column(JSON, nullable=False)
    package_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    published_by_user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id"), index=True, nullable=False
    )
    published_at: Mapped[datetime] = mapped_column(
        _publication_datetime_type(), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        _publication_datetime_type(), default=utc_now, nullable=False
    )


class CourseReleaseUnit(Base):
    __tablename__ = "course_release_units"
    __table_args__ = (
        UniqueConstraint(
            "course_release_id",
            "activity_key",
            name="uq_course_release_units_release_activity",
        ),
        UniqueConstraint(
            "course_release_id",
            "position",
            name="uq_course_release_units_release_position",
        ),
        UniqueConstraint(
            "course_release_id",
            "source_course_unit_id",
            name="uq_course_release_units_release_source",
        ),
        CheckConstraint(
            "position > 0", name="ck_course_release_units_position_positive"
        ),
        Index(
            "ix_course_release_units_release_order",
            "course_release_id",
            "position",
            "id",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    course_release_id: Mapped[int] = mapped_column(
        ForeignKey("course_releases.id"), index=True, nullable=False
    )
    source_course_unit_id: Mapped[int] = mapped_column(
        ForeignKey("course_units.id"), index=True, nullable=False
    )
    activity_key: Mapped[str] = mapped_column(String(120), nullable=False)
    title_snapshot: Mapped[str] = mapped_column(String(180), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    content_slug: Mapped[str] = mapped_column(String(180), nullable=False)
    content_page_version_id: Mapped[int] = mapped_column(
        ForeignKey("content_page_versions.id"), index=True, nullable=False
    )
    content_schema_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    media_snapshot_json: Mapped[list] = mapped_column(
        JSON, default=list, nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        _publication_datetime_type(), default=utc_now, nullable=False
    )


class CourseClassReleaseBinding(Base):
    __tablename__ = "course_class_release_bindings"
    __table_args__ = (
        UniqueConstraint(
            "course_class_id",
            "binding_revision",
            name="uq_course_class_release_binding_revision",
        ),
        UniqueConstraint(
            "previous_binding_id", name="uq_course_class_release_binding_previous"
        ),
        CheckConstraint(
            "binding_revision > 0",
            name="ck_course_class_release_binding_revision_positive",
        ),
        Index(
            "ix_course_class_release_binding_current",
            "course_class_id",
            "binding_revision",
            "id",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    course_class_id: Mapped[int] = mapped_column(
        ForeignKey("course_classes.id"), index=True, nullable=False
    )
    course_release_id: Mapped[int] = mapped_column(
        ForeignKey("course_releases.id"), index=True, nullable=False
    )
    binding_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    previous_binding_id: Mapped[int | None] = mapped_column(
        ForeignKey("course_class_release_bindings.id"), index=True, nullable=True
    )
    bound_by_user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id"), index=True, nullable=False
    )
    binding_reason: Mapped[str | None] = mapped_column(String(240), nullable=True)
    bound_at: Mapped[datetime] = mapped_column(
        _publication_datetime_type(), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        _publication_datetime_type(), default=utc_now, nullable=False
    )


def _reject_append_only_mutation(_mapper, _connection, target) -> None:
    raise ValueError(f"{target.__class__.__name__} is append-only")


for _append_only_model in (CourseRelease, CourseReleaseUnit, CourseClassReleaseBinding):
    event.listen(_append_only_model, "before_update", _reject_append_only_mutation)
    event.listen(_append_only_model, "before_delete", _reject_append_only_mutation)
