from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy import JSON
from sqlalchemy.dialects import mysql
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, utc_now


_CODE_JUDGE_STATES = (
    "'queued', 'runner_unavailable', 'running', 'accepted', 'wrong_answer', 'partial', "
    "'compile_error', 'runtime_error', 'time_limit', 'memory_limit', 'output_limit', "
    "'internal_error', 'cancelled'"
)


def _client_submission_id_type():
    return String(128).with_variant(
        mysql.VARCHAR(length=128, charset="ascii", collation="ascii_bin"),
        "mysql",
    )


class CodeProblem(TimestampMixin, Base):
    __tablename__ = "code_problems"
    __table_args__ = (
        UniqueConstraint("course_id", "course_unit_id", name="uq_code_problems_course_unit"),
        UniqueConstraint("course_id", "activity_key", name="uq_code_problems_course_activity_key"),
        Index("ix_code_problems_course_activity_status", "course_id", "activity_key", "status"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    school_id: Mapped[int] = mapped_column(ForeignKey("schools.id"), index=True, nullable=False)
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id"), index=True, nullable=False)
    course_unit_id: Mapped[int] = mapped_column(ForeignKey("course_units.id"), index=True, nullable=False)
    activity_key: Mapped[str] = mapped_column(String(120), nullable=False)
    title: Mapped[str] = mapped_column(String(180), nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="active", nullable=False)
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)


class CodeProblemVersion(TimestampMixin, Base):
    __tablename__ = "code_problem_versions"
    __table_args__ = (
        UniqueConstraint("problem_id", "version_number", name="uq_code_problem_versions_problem_number"),
        Index("ix_code_problem_versions_problem_status_number", "problem_id", "status", "version_number"),
        CheckConstraint("version_number > 0", name="ck_code_problem_versions_number_positive"),
        CheckConstraint("source_max_bytes > 0", name="ck_code_problem_versions_source_limit_positive"),
        CheckConstraint("input_max_bytes >= 0", name="ck_code_problem_versions_input_limit_nonnegative"),
        CheckConstraint("output_max_bytes > 0", name="ck_code_problem_versions_output_limit_positive"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    problem_id: Mapped[int] = mapped_column(ForeignKey("code_problems.id"), index=True, nullable=False)
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="active", nullable=False)
    statement_markdown: Mapped[str] = mapped_column(Text, nullable=False)
    test_spec_json: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    language_allowlist_json: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    resource_policy_json: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    source_max_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    input_max_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    output_max_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    spec_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)


class CodeSubmission(TimestampMixin, Base):
    __tablename__ = "code_submissions"
    __table_args__ = (
        UniqueConstraint(
            "student_id",
            "problem_id",
            "class_id",
            "client_submission_id",
            name="uq_code_submissions_actor_scope_client",
        ),
        Index("ix_code_submissions_class_course_activity_created", "class_id", "course_id", "activity_key", "created_at", "id"),
        Index("ix_code_submissions_student_created", "student_id", "created_at", "id"),
        Index("ix_code_submissions_status_created", "status", "created_at", "id"),
        CheckConstraint(f"status IN ({_CODE_JUDGE_STATES})", name="ck_code_submissions_status"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    school_id: Mapped[int] = mapped_column(ForeignKey("schools.id"), index=True, nullable=False)
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id"), index=True, nullable=False)
    class_id: Mapped[int] = mapped_column(ForeignKey("class_groups.id"), index=True, nullable=False)
    course_unit_id: Mapped[int] = mapped_column(ForeignKey("course_units.id"), index=True, nullable=False)
    activity_key: Mapped[str] = mapped_column(String(120), nullable=False)
    problem_id: Mapped[int] = mapped_column(ForeignKey("code_problems.id"), index=True, nullable=False)
    problem_version_id: Mapped[int] = mapped_column(ForeignKey("code_problem_versions.id"), index=True, nullable=False)
    student_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    client_submission_id: Mapped[str] = mapped_column(_client_submission_id_type(), nullable=False)
    language: Mapped[str] = mapped_column(String(24), nullable=False)
    source_code: Mapped[str] = mapped_column(Text, nullable=False)
    stdin: Mapped[str] = mapped_column(Text, default="", nullable=False)
    source_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    input_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    problem_snapshot_json: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    resource_policy_snapshot_json: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="queued", nullable=False)
    result_summary_json: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    judged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class CodeJudgeAttempt(TimestampMixin, Base):
    __tablename__ = "code_judge_attempts"
    __table_args__ = (
        UniqueConstraint("submission_id", "attempt_number", name="uq_code_judge_attempts_submission_number"),
        Index("ix_code_judge_attempts_claim", "status", "available_at", "id"),
        Index("ix_code_judge_attempts_expired_claim", "status", "claim_expires_at", "id"),
        CheckConstraint("attempt_number > 0", name="ck_code_judge_attempts_number_positive"),
        CheckConstraint(f"status IN ({_CODE_JUDGE_STATES})", name="ck_code_judge_attempts_status"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    submission_id: Mapped[int] = mapped_column(ForeignKey("code_submissions.id"), index=True, nullable=False)
    attempt_number: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="queued", nullable=False)
    adapter_name: Mapped[str] = mapped_column(String(80), default="disabled", nullable=False)
    resource_policy_snapshot_json: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    result_summary_json: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    available_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    claim_owner: Mapped[str | None] = mapped_column(String(160), nullable=True)
    claim_token: Mapped[str | None] = mapped_column(String(64), nullable=True)
    claim_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(80), nullable=True)
