"""Immutable uploaded bytes and explicit course reuse grants."""
from datetime import datetime
from uuid import uuid4

from sqlalchemy import DateTime, ForeignKey, Integer, LargeBinary, String, UniqueConstraint, event
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, utc_now


class CourseMediaAsset(Base):
    __tablename__ = "course_media_assets"
    __table_args__ = (UniqueConstraint("created_by_user_id", "client_request_id", name="uq_course_media_request"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    asset_key: Mapped[str] = mapped_column(String(120), default=lambda: f"asset.{uuid4().hex}", unique=True, nullable=False)
    school_id: Mapped[int] = mapped_column(ForeignKey("schools.id"), index=True, nullable=False)
    source_course_id: Mapped[int] = mapped_column(ForeignKey("courses.id"), index=True, nullable=False)
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    client_request_id: Mapped[str] = mapped_column(String(128), nullable=False)
    filename: Mapped[str] = mapped_column(String(180), nullable=False)
    media_type: Mapped[str] = mapped_column(String(16), nullable=False)
    content_type: Mapped[str] = mapped_column(String(80), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    content_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    content_bytes: Mapped[bytes] = mapped_column(LargeBinary(length=16_777_215), deferred=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class CourseMediaGrant(Base):
    __tablename__ = "course_media_grants"
    __table_args__ = (UniqueConstraint("course_id", "asset_id", name="uq_course_media_grant"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id"), index=True, nullable=False)
    asset_id: Mapped[int] = mapped_column(ForeignKey("course_media_assets.id"), index=True, nullable=False)
    granted_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


def _immutable(_mapper, _connection, _target):
    raise ValueError("Course media versions and grants are immutable")


for _model in (CourseMediaAsset, CourseMediaGrant):
    event.listen(_model, "before_update", _immutable)
    event.listen(_model, "before_delete", _immutable)
