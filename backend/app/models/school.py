from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class School(TimestampMixin, Base):
    __tablename__ = "schools"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(160), unique=True, nullable=False)
    region: Mapped[str | None] = mapped_column(String(160), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="active", nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)


class SchoolMembership(TimestampMixin, Base):
    __tablename__ = "school_memberships"
    __table_args__ = (
        UniqueConstraint("school_id", "user_id", "role", name="uq_school_membership_user_role"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    school_id: Mapped[int] = mapped_column(ForeignKey("schools.id"), index=True, nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    role: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="active", nullable=False)


class ClassGroup(TimestampMixin, Base):
    __tablename__ = "class_groups"
    __table_args__ = (
        UniqueConstraint("school_id", "name", name="uq_class_group_school_name"),
        CheckConstraint("kind IN ('homeroom', 'course_cohort')", name="ck_class_groups_kind"),
        Index("ix_class_groups_school_kind_status", "school_id", "kind", "status", "id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    school_id: Mapped[int] = mapped_column(ForeignKey("schools.id"), index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    kind: Mapped[str] = mapped_column(String(24), default="homeroom", nullable=False)
    grade: Mapped[str | None] = mapped_column(String(64), nullable=True)
    term: Mapped[str | None] = mapped_column(String(64), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="active", nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)


class ClassMembership(TimestampMixin, Base):
    __tablename__ = "class_memberships"
    __table_args__ = (
        UniqueConstraint("class_id", "user_id", "role", name="uq_class_membership_user_role"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    class_id: Mapped[int] = mapped_column(ForeignKey("class_groups.id"), index=True, nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    role: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="active", nullable=False)


class ClassJoinRequest(TimestampMixin, Base):
    __tablename__ = "class_join_requests"
    __table_args__ = (
        UniqueConstraint("class_id", "user_id", "role", name="uq_class_join_request_user_role"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    school_id: Mapped[int] = mapped_column(ForeignKey("schools.id"), index=True, nullable=False)
    class_id: Mapped[int] = mapped_column(ForeignKey("class_groups.id"), index=True, nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    role: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="pending", index=True, nullable=False)
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    requested_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    reviewed_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True, nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    review_note: Mapped[str | None] = mapped_column(Text, nullable=True)
