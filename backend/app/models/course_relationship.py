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
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class CourseInformationRevision(TimestampMixin, Base):
    __tablename__ = "course_information_revisions"
    __table_args__ = (
        UniqueConstraint(
            "course_id",
            "revision_number",
            name="uq_course_info_revisions_course_number",
        ),
        CheckConstraint(
            "revision_number > 0",
            name="ck_course_info_revisions_number_positive",
        ),
        CheckConstraint(
            "status IN ('draft', 'submitted', 'approved', 'rejected')",
            name="ck_course_info_revisions_status",
        ),
        Index(
            "ix_course_info_revisions_course_status_id",
            "course_id",
            "status",
            "id",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    edit_revision: Mapped[int] = mapped_column(Integer, default=1, server_default="1", nullable=False)
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id"), index=True, nullable=False)
    revision_number: Mapped[int] = mapped_column(Integer, nullable=False)
    information_snapshot: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    teacher_ids_snapshot: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    status: Mapped[str] = mapped_column(String(24), default="draft", nullable=False)
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reviewed_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"),
        index=True,
        nullable=True,
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    review_note: Mapped[str | None] = mapped_column(Text, nullable=True)


class CourseAdmissionClass(TimestampMixin, Base):
    __tablename__ = "course_admission_classes"
    __table_args__ = (
        UniqueConstraint(
            "course_id",
            "class_id",
            name="uq_course_admission_classes_course_class",
        ),
        CheckConstraint(
            "status IN ('active', 'inactive')",
            name="ck_course_admission_classes_status",
        ),
        Index(
            "ix_course_admission_classes_course_status_id",
            "course_id",
            "status",
            "id",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id"), index=True, nullable=False)
    class_id: Mapped[int] = mapped_column(ForeignKey("class_groups.id"), index=True, nullable=False)
    status: Mapped[str] = mapped_column(String(24), default="active", nullable=False)


class CourseJoinRequest(TimestampMixin, Base):
    __tablename__ = "course_join_requests"
    __table_args__ = (
        UniqueConstraint(
            "course_id",
            "student_id",
            "request_number",
            name="uq_course_join_requests_course_student_number",
        ),
        CheckConstraint(
            "request_number > 0",
            name="ck_course_join_requests_number_positive",
        ),
        CheckConstraint(
            "status IN ('pending', 'approved', 'rejected')",
            name="ck_course_join_requests_status",
        ),
        Index(
            "ix_course_join_requests_course_status_id",
            "course_id",
            "status",
            "id",
        ),
        Index(
            "ix_course_join_requests_student_status_id",
            "student_id",
            "status",
            "id",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id"), index=True, nullable=False)
    student_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    source_class_id: Mapped[int | None] = mapped_column(
        ForeignKey("class_groups.id"),
        index=True,
        nullable=True,
    )
    request_number: Mapped[int] = mapped_column(Integer, nullable=False)
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(24), default="pending", nullable=False)
    reviewed_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"),
        index=True,
        nullable=True,
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    review_note: Mapped[str | None] = mapped_column(Text, nullable=True)


class CourseEnrollment(TimestampMixin, Base):
    __tablename__ = "course_enrollments"
    __table_args__ = (
        UniqueConstraint(
            "course_id",
            "student_id",
            name="uq_course_enrollments_course_student",
        ),
        CheckConstraint(
            "source IN ('request', 'class_batch', 'teacher', 'admin')",
            name="ck_course_enrollments_source",
        ),
        CheckConstraint(
            "status IN ('active', 'left')",
            name="ck_course_enrollments_status",
        ),
        Index(
            "ix_course_enrollments_course_status_id",
            "course_id",
            "status",
            "id",
        ),
        Index(
            "ix_course_enrollments_student_status_id",
            "student_id",
            "status",
            "id",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id"), index=True, nullable=False)
    student_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    source_class_id: Mapped[int | None] = mapped_column(
        ForeignKey("class_groups.id"),
        index=True,
        nullable=True,
    )
    source: Mapped[str] = mapped_column(String(24), nullable=False)
    status: Mapped[str] = mapped_column(String(24), default="active", nullable=False)
