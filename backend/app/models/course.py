from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects import mysql
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, utc_now


def _knowledge_window_datetime_type():
    return DateTime(timezone=True).with_variant(mysql.DATETIME(fsp=6), "mysql")

class Course(TimestampMixin, Base):
    __tablename__ = "courses"
    __table_args__ = (
        UniqueConstraint("school_id", "title", name="uq_courses_school_title"),
        UniqueConstraint("school_id", "galaxy_key", "course_key", name="uq_courses_school_galaxy_course_key"),
        Index("ix_courses_galaxy_subject", "galaxy_key", "subject_key"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    school_id: Mapped[int] = mapped_column(ForeignKey("schools.id"), index=True, nullable=False)
    creator_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    galaxy_key: Mapped[str] = mapped_column(String(32), nullable=False)
    subject_key: Mapped[str] = mapped_column(String(96), default="general", nullable=False)
    course_key: Mapped[str] = mapped_column(String(96), nullable=False)
    title: Mapped[str] = mapped_column(String(180), nullable=False)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="draft", nullable=False)

class CourseClass(TimestampMixin, Base):
    __tablename__ = "course_classes"
    __table_args__ = (UniqueConstraint("course_id", "class_id", name="uq_course_classes_course_class"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id"), index=True, nullable=False)
    class_id: Mapped[int] = mapped_column(ForeignKey("class_groups.id"), index=True, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="active", nullable=False)
    plan_version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)


class CourseCollaborator(TimestampMixin, Base):
    __tablename__ = "course_collaborators"
    __table_args__ = (UniqueConstraint("course_id", "user_id", name="uq_course_collaborators_course_user"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id"), index=True, nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    role: Mapped[str] = mapped_column(String(32), default="editor", nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="active", nullable=False)


class CourseUnit(TimestampMixin, Base):
    __tablename__ = "course_units"
    __table_args__ = (
        UniqueConstraint("course_id", "position", name="uq_course_units_course_position"),
        UniqueConstraint("course_id", "content_slug", name="uq_course_units_course_content_slug"),
        UniqueConstraint("course_id", "activity_key", name="uq_course_units_course_activity_key"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id"), index=True, nullable=False)
    activity_key: Mapped[str] = mapped_column(String(120), nullable=False)
    title: Mapped[str] = mapped_column(String(180), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    content_slug: Mapped[str | None] = mapped_column(String(180), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="published", nullable=False)


class CourseUnitClassPlan(TimestampMixin, Base):
    __tablename__ = "course_unit_class_plans"
    __table_args__ = (
        UniqueConstraint("course_class_id", "course_unit_id", name="uq_course_unit_class_plans_class_unit"),
        UniqueConstraint("course_class_id", "position", name="uq_course_unit_class_plans_class_position"),
        CheckConstraint("position > 0", name="ck_course_unit_class_plans_position_positive"),
        CheckConstraint(
            "release_mode IN ('hidden', 'locked', 'open')",
            name="ck_course_unit_class_plans_release_mode",
        ),
        Index("ix_course_unit_class_plans_class_release_open", "course_class_id", "release_mode", "open_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    course_class_id: Mapped[int] = mapped_column(ForeignKey("course_classes.id"), index=True, nullable=False)
    course_unit_id: Mapped[int] = mapped_column(ForeignKey("course_units.id"), index=True, nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    release_mode: Mapped[str] = mapped_column(String(16), default="open", nullable=False)
    open_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    prerequisite_unit_id: Mapped[int | None] = mapped_column(
        ForeignKey("course_units.id"), index=True, nullable=True
    )


class Assignment(TimestampMixin, Base):
    __tablename__ = "assignments"
    __table_args__ = (UniqueConstraint("unit_id", "title", name="uq_assignments_unit_title"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    unit_id: Mapped[int] = mapped_column(ForeignKey("course_units.id"), index=True, nullable=False)
    title: Mapped[str] = mapped_column(String(180), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    max_score: Mapped[int] = mapped_column(Integer, default=100, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="active", nullable=False)
    audience_mode: Mapped[str] = mapped_column(String(32), default="all_attached_classes", nullable=False)
    point_rule_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class AssignmentClassPolicy(TimestampMixin, Base):
    __tablename__ = "assignment_class_policies"
    __table_args__ = (
        UniqueConstraint("assignment_id", "class_id", name="uq_assignment_class_policies_assignment_class"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    assignment_id: Mapped[int] = mapped_column(ForeignKey("assignments.id"), index=True, nullable=False)
    class_id: Mapped[int] = mapped_column(ForeignKey("class_groups.id"), index=True, nullable=False)
    assigned: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    status_override: Mapped[str | None] = mapped_column(String(32), nullable=True)
    due_at_overridden: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    due_at_override: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    point_rule_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class Submission(TimestampMixin, Base):
    __tablename__ = "submissions"
    __table_args__ = (
        UniqueConstraint(
            "assignment_id",
            "student_id",
            "class_id",
            name="uq_submissions_assignment_student_class",
        ),
        Index("ix_submissions_status_submitted_id", "status", "submitted_at", "id"),
        Index("ix_submissions_class_status_submitted", "class_id", "status", "submitted_at", "id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    assignment_id: Mapped[int] = mapped_column(ForeignKey("assignments.id"), index=True, nullable=False)
    student_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    class_id: Mapped[int | None] = mapped_column(ForeignKey("class_groups.id"), index=True, nullable=True)
    content: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="submitted", nullable=False)
    score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    feedback: Mapped[str | None] = mapped_column(Text, nullable=True)
    graded_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True, nullable=True)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    graded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class PointLedger(TimestampMixin, Base):
    __tablename__ = "point_ledger"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    school_id: Mapped[int | None] = mapped_column(ForeignKey("schools.id"), index=True, nullable=True)
    class_id: Mapped[int | None] = mapped_column(ForeignKey("class_groups.id"), index=True, nullable=True)
    assignment_id: Mapped[int | None] = mapped_column(ForeignKey("assignments.id"), index=True, nullable=True)
    submission_id: Mapped[int | None] = mapped_column(ForeignKey("submissions.id"), index=True, nullable=True)
    delta: Mapped[int] = mapped_column(Integer, nullable=False)
    reason: Mapped[str] = mapped_column(String(80), nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True, nullable=True)


class LearningEvent(TimestampMixin, Base):
    __tablename__ = "learning_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    school_id: Mapped[int | None] = mapped_column(ForeignKey("schools.id"), index=True, nullable=True)
    class_id: Mapped[int | None] = mapped_column(ForeignKey("class_groups.id"), index=True, nullable=True)
    course_id: Mapped[int | None] = mapped_column(ForeignKey("courses.id"), index=True, nullable=True)
    unit_id: Mapped[int | None] = mapped_column(ForeignKey("course_units.id"), index=True, nullable=True)
    assignment_id: Mapped[int | None] = mapped_column(ForeignKey("assignments.id"), index=True, nullable=True)
    knowledge_code: Mapped[str | None] = mapped_column(String(120), index=True, nullable=True)
    event_type: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    payload: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class ClassKnowledgeSnapshot(TimestampMixin, Base):
    __tablename__ = "class_knowledge_snapshots"
    __table_args__ = (
        UniqueConstraint(
            "class_id",
            "course_scope_id",
            "granularity",
            "period_start",
            "period_end",
            "rule_version",
            name="uq_class_knowledge_snapshot_window",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    school_id: Mapped[int] = mapped_column(ForeignKey("schools.id"), index=True, nullable=False)
    class_id: Mapped[int] = mapped_column(ForeignKey("class_groups.id"), index=True, nullable=False)
    course_id: Mapped[int | None] = mapped_column(ForeignKey("courses.id"), index=True, nullable=True)
    course_scope_id: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    granularity: Mapped[str] = mapped_column(String(16), default="custom", index=True, nullable=False)
    period_start: Mapped[datetime] = mapped_column(_knowledge_window_datetime_type(), index=True, nullable=False)
    period_end: Mapped[datetime] = mapped_column(_knowledge_window_datetime_type(), index=True, nullable=False)
    rule_version: Mapped[str] = mapped_column(String(32), default="v1", nullable=False)
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    students_total: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    students_active: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    assignment_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    expected_submissions: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    submitted_assignments: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    graded_assignments: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_events: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    complete_events: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    score_total: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    max_score_total: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    average_score_percent: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    completion_percent: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    total_points: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    average_points_per_student: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    knowledge_stats_json: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    calculated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class UserKnowledgeSnapshot(TimestampMixin, Base):
    __tablename__ = "user_knowledge_snapshots"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "class_scope_id",
            "course_scope_id",
            "granularity",
            "period_start",
            "period_end",
            "rule_version",
            name="uq_user_knowledge_snapshot_window",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    school_id: Mapped[int | None] = mapped_column(ForeignKey("schools.id"), index=True, nullable=True)
    class_id: Mapped[int | None] = mapped_column(ForeignKey("class_groups.id"), index=True, nullable=True)
    class_scope_id: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    course_id: Mapped[int | None] = mapped_column(ForeignKey("courses.id"), index=True, nullable=True)
    course_scope_id: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    granularity: Mapped[str] = mapped_column(String(16), default="custom", index=True, nullable=False)
    period_start: Mapped[datetime] = mapped_column(_knowledge_window_datetime_type(), index=True, nullable=False)
    period_end: Mapped[datetime] = mapped_column(_knowledge_window_datetime_type(), index=True, nullable=False)
    rule_version: Mapped[str] = mapped_column(String(32), default="v1", nullable=False)
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    assignment_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    submitted_assignments: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    graded_assignments: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_events: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    visit_events: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    start_events: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    submit_events: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    complete_events: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    score_total: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    max_score_total: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    accuracy_percent: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    completion_percent: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    total_points: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    knowledge_stats_json: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    calculated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class KnowledgeSnapshotRun(TimestampMixin, Base):
    __tablename__ = "knowledge_snapshot_runs"
    __table_args__ = (
        UniqueConstraint("run_key", name="uq_knowledge_snapshot_runs_run_key"),
        Index("ix_knowledge_runs_started_id", "started_at", "id"),
        Index("ix_knowledge_runs_status_started", "status", "started_at", "id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    run_key: Mapped[str] = mapped_column(String(160), nullable=False)
    granularity: Mapped[str] = mapped_column(String(16), index=True, nullable=False)
    period_start: Mapped[datetime] = mapped_column(_knowledge_window_datetime_type(), index=True, nullable=False)
    period_end: Mapped[datetime] = mapped_column(_knowledge_window_datetime_type(), index=True, nullable=False)
    trigger_source: Mapped[str] = mapped_column(String(32), default="script", nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="running", index=True, nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    scheduler_lease_owner: Mapped[str | None] = mapped_column(String(96), nullable=True)
    scheduler_lease_token: Mapped[str | None] = mapped_column(String(64), nullable=True)
    scheduler_lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True, nullable=True)
    scheduler_heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    attempt_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    user_snapshot_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    class_snapshot_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
