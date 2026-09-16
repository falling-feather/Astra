"""Pinned learning scopes, immutable attempts/grades, and explicit result recognition."""
from datetime import datetime
from uuid import uuid4

from sqlalchemy import JSON, Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, event
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, utc_now


class LearningContext(Base):
    __tablename__ = "learning_contexts"
    __table_args__ = (
        UniqueConstraint("user_id", "client_request_id", name="uq_learning_context_request"),
        CheckConstraint("mode IN ('formal', 'explore', 'preview')", name="ck_learning_context_mode"),
        CheckConstraint("mode <> 'formal' OR (course_id IS NOT NULL AND course_unit_id IS NOT NULL AND course_release_id IS NOT NULL AND class_id IS NOT NULL)", name="ck_learning_context_formal_scope"),
        Index("ix_learning_context_user_course", "user_id", "course_id", "created_at", "id"),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    context_key: Mapped[str] = mapped_column(String(36), default=lambda: str(uuid4()), unique=True, nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    mode: Mapped[str] = mapped_column(String(16), nullable=False)
    school_id: Mapped[int | None] = mapped_column(ForeignKey("schools.id"), nullable=True)
    course_id: Mapped[int | None] = mapped_column(ForeignKey("courses.id"), nullable=True)
    course_unit_id: Mapped[int | None] = mapped_column(ForeignKey("course_units.id"), nullable=True)
    class_id: Mapped[int | None] = mapped_column(ForeignKey("class_groups.id"), nullable=True)
    course_release_id: Mapped[int | None] = mapped_column(ForeignKey("course_releases.id"), nullable=True)
    resource_version_id: Mapped[int | None] = mapped_column(ForeignKey("learning_resource_versions.id"), nullable=True)
    assignment_id: Mapped[int | None] = mapped_column(ForeignKey("assignments.id"), nullable=True)
    assignment_snapshot_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    client_request_id: Mapped[str] = mapped_column(String(128), nullable=False)
    request_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    scope_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class AssignmentAttempt(Base):
    __tablename__ = "assignment_attempts"
    __table_args__ = (
        UniqueConstraint("submission_id", "attempt_number", name="uq_assignment_attempt_number"),
        UniqueConstraint("student_id", "client_request_id", name="uq_assignment_attempt_request"),
        CheckConstraint("attempt_number > 0", name="ck_assignment_attempt_number"),
        Index("ix_assignment_attempt_release_student", "course_release_id", "student_id", "assignment_id", "id"),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    submission_id: Mapped[int] = mapped_column(ForeignKey("submissions.id"), nullable=False)
    assignment_id: Mapped[int] = mapped_column(ForeignKey("assignments.id"), nullable=False)
    student_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    class_id: Mapped[int | None] = mapped_column(ForeignKey("class_groups.id"), nullable=True)
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id"), nullable=False)
    course_unit_id: Mapped[int] = mapped_column(ForeignKey("course_units.id"), nullable=False)
    context_id: Mapped[int | None] = mapped_column(ForeignKey("learning_contexts.id"), nullable=True)
    course_release_id: Mapped[int | None] = mapped_column(ForeignKey("course_releases.id"), nullable=True)
    attempt_number: Mapped[int] = mapped_column(Integer, nullable=False)
    submission_revision: Mapped[int | None] = mapped_column(Integer, nullable=True)
    client_request_id: Mapped[str] = mapped_column(String(128), nullable=False)
    request_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    content_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    assignment_snapshot_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    provenance: Mapped[str] = mapped_column(String(32), nullable=False)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class AssignmentGrade(Base):
    __tablename__ = "assignment_grades"
    __table_args__ = (
        UniqueConstraint("attempt_id", "revision", name="uq_assignment_grade_revision"),
        UniqueConstraint("graded_by_user_id", "client_request_id", name="uq_assignment_grade_request"),
        CheckConstraint("revision > 0", name="ck_assignment_grade_revision"),
        CheckConstraint("status IN ('graded', 'returned')", name="ck_assignment_grade_status"),
        Index("ix_assignment_grade_attempt_latest", "attempt_id", "revision", "id"),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    attempt_id: Mapped[int] = mapped_column(ForeignKey("assignment_attempts.id"), nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    feedback: Mapped[str | None] = mapped_column(Text, nullable=True)
    graded_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    client_request_id: Mapped[str] = mapped_column(String(128), nullable=False)
    request_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    graded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    provenance: Mapped[str] = mapped_column(String(32), nullable=False)
    source_audit_log_id: Mapped[int | None] = mapped_column(ForeignKey("audit_logs.id"), unique=True, nullable=True)
    feedback_retained: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    submission_revision: Mapped[int | None] = mapped_column(Integer, nullable=True)
    point_delta: Mapped[int | None] = mapped_column(Integer, nullable=True)


class LearningResult(Base):
    """Normalized index of a source fact; only source owners append this row."""
    __tablename__ = "learning_results"
    __table_args__ = (
        UniqueConstraint("checkpoint_attempt_id", name="uq_learning_result_checkpoint"),
        UniqueConstraint("assignment_grade_id", name="uq_learning_result_grade"),
        UniqueConstraint("evidence_event_id", name="uq_learning_result_event"),
        CheckConstraint("(CASE WHEN checkpoint_attempt_id IS NOT NULL THEN 1 ELSE 0 END + CASE WHEN assignment_grade_id IS NOT NULL THEN 1 ELSE 0 END + CASE WHEN evidence_event_id IS NOT NULL THEN 1 ELSE 0 END) = 1", name="ck_learning_result_one_fact"),
        Index("ix_learning_result_scope", "course_id", "student_id", "course_unit_id", "course_release_id", "id"),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    school_id: Mapped[int] = mapped_column(ForeignKey("schools.id"), nullable=False)
    class_id: Mapped[int | None] = mapped_column(ForeignKey("class_groups.id"), nullable=True)
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id"), nullable=False)
    course_unit_id: Mapped[int] = mapped_column(ForeignKey("course_units.id"), nullable=False)
    course_release_id: Mapped[int | None] = mapped_column(ForeignKey("course_releases.id"), nullable=True)
    context_id: Mapped[int | None] = mapped_column(ForeignKey("learning_contexts.id"), nullable=True)
    checkpoint_attempt_id: Mapped[int | None] = mapped_column(ForeignKey("checkpoint_attempts.id"), nullable=True)
    assignment_grade_id: Mapped[int | None] = mapped_column(ForeignKey("assignment_grades.id"), nullable=True)
    evidence_event_id: Mapped[int | None] = mapped_column(ForeignKey("learning_evidence_events.id"), nullable=True)
    completion_event_id: Mapped[int | None] = mapped_column(ForeignKey("learning_evidence_events.id"), nullable=True)
    completed: Mapped[bool] = mapped_column(Boolean, nullable=False)
    provenance: Mapped[str] = mapped_column(String(48), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class LearningResultRecognition(Base):
    """A reviewed publication accepts a particular older result; no fact is rewritten."""
    __tablename__ = "learning_result_recognitions"
    __table_args__ = (
        UniqueConstraint("target_release_id", "result_id", name="uq_learning_result_recognition"),
        Index("ix_learning_recognition_target_student", "target_release_id", "student_id", "course_unit_id", "id"),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    result_id: Mapped[int] = mapped_column(ForeignKey("learning_results.id"), nullable=False)
    target_release_id: Mapped[int] = mapped_column(ForeignKey("course_releases.id"), nullable=False)
    course_unit_id: Mapped[int] = mapped_column(ForeignKey("course_units.id"), nullable=False)
    student_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    candidate_id: Mapped[int] = mapped_column(ForeignKey("course_candidates.id"), nullable=False)
    authorized_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    target_class_id: Mapped[int] = mapped_column(ForeignKey("class_groups.id"), nullable=False)
    completed: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    basis_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


def _immutable(_mapper, _connection, _target):
    raise ValueError("Learning identities, attempts, grades and recognition facts are immutable")


for _model in (LearningContext, AssignmentAttempt, AssignmentGrade, LearningResult, LearningResultRecognition):
    event.listen(_model, "before_update", _immutable)
    event.listen(_model, "before_delete", _immutable)
