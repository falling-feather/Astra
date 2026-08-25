from datetime import datetime

from sqlalchemy import (
    Boolean,
    JSON,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    event,
    inspect as sa_inspect,
)
from sqlalchemy.dialects import mysql
from sqlalchemy.orm import Mapped, mapped_column

from app.core.learning_evidence_contract import MAX_RULE_WITNESS_EVENTS
from app.models.base import Base, TimestampMixin, utc_now


LEARNER_EVENT_TYPES = ("started", "predicted", "attempted", "corrected", "explained")
DERIVED_EVENT_TYPES = ("completed", "transferred")
ADMINISTRATIVE_EVENT_TYPE = "administrative_correction"
CURRENT_EVENT_SCHEMA_VERSION = 1
CURRENT_RULE_DEFINITION_SCHEMA_VERSION = 1


def _evidence_datetime_type():
    return DateTime(timezone=True).with_variant(mysql.DATETIME(fsp=6), "mysql")


def _client_event_id_type():
    return String(128).with_variant(
        mysql.VARCHAR(length=128, charset="ascii", collation="ascii_bin"),
        "mysql",
    )


class LearningCompletionRule(Base):
    __tablename__ = "learning_completion_rules"
    __table_args__ = (
        UniqueConstraint("course_id", "version_number", name="uq_le_rules_course_version"),
        CheckConstraint("version_number > 0", name="ck_le_rules_version_positive"),
        CheckConstraint("status IN ('draft', 'active')", name="ck_le_rules_status"),
        Index("ix_le_rules_course_status_version", "course_id", "status", "version_number"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id"), index=True, nullable=False)
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="draft", nullable=False)
    definition_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    definition_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    activated_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    activated_at: Mapped[datetime | None] = mapped_column(_evidence_datetime_type(), nullable=True)
    created_at: Mapped[datetime] = mapped_column(_evidence_datetime_type(), default=utc_now, nullable=False)


class LearningRuleActivation(TimestampMixin, Base):
    __tablename__ = "learning_rule_activations"
    __table_args__ = (
        UniqueConstraint("course_id", name="uq_le_rule_activation_course"),
        CheckConstraint("revision >= 0", name="ck_le_rule_activation_revision"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id"), index=True, nullable=False)
    active_rule_id: Mapped[int] = mapped_column(
        ForeignKey("learning_completion_rules.id"),
        index=True,
        nullable=False,
    )
    revision: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    activated_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    activated_at: Mapped[datetime] = mapped_column(_evidence_datetime_type(), default=utc_now, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        _evidence_datetime_type(),
        default=utc_now,
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        _evidence_datetime_type(),
        default=utc_now,
        onupdate=utc_now,
        nullable=False,
    )


class LearningRuleClassBinding(Base):
    __tablename__ = "learning_rule_class_bindings"
    __table_args__ = (
        UniqueConstraint(
            "course_class_id",
            "plan_version",
            name="uq_le_rule_binding_plan",
        ),
        CheckConstraint("plan_version > 0", name="ck_le_rule_binding_plan_positive"),
        CheckConstraint("rule_version > 0", name="ck_le_rule_binding_rule_positive"),
        Index("ix_le_rule_binding_rule_plan", "rule_id", "course_class_id", "plan_version"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    course_class_id: Mapped[int] = mapped_column(ForeignKey("course_classes.id"), index=True, nullable=False)
    plan_version: Mapped[int] = mapped_column(Integer, nullable=False)
    rule_id: Mapped[int] = mapped_column(
        ForeignKey("learning_completion_rules.id"),
        index=True,
        nullable=False,
    )
    rule_version: Mapped[int] = mapped_column(Integer, nullable=False)
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(_evidence_datetime_type(), default=utc_now, nullable=False)


class CheckpointAttempt(Base):
    """Immutable server-graded answer fact for one released inline checkpoint."""

    __tablename__ = "checkpoint_attempts"
    __table_args__ = (
        UniqueConstraint(
            "client_attempt_id", name="uq_checkpoint_attempts_client_attempt"
        ),
        UniqueConstraint(
            "course_release_id",
            "course_unit_id",
            "checkpoint_key",
            "student_id",
            "attempt_number",
            name="uq_checkpoint_attempts_scope_number",
        ),
        CheckConstraint(
            "attempt_number > 0", name="ck_checkpoint_attempts_number_positive"
        ),
        Index(
            "ix_checkpoint_attempts_student_scope",
            "student_id",
            "course_id",
            "course_unit_id",
            "submitted_at",
            "id",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    client_attempt_id: Mapped[str] = mapped_column(
        _client_event_id_type(), nullable=False
    )
    request_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    student_id: Mapped[int] = mapped_column(
        ForeignKey("users.id"), index=True, nullable=False
    )
    class_id: Mapped[int] = mapped_column(
        ForeignKey("class_groups.id"), index=True, nullable=False
    )
    course_id: Mapped[int] = mapped_column(
        ForeignKey("courses.id"), index=True, nullable=False
    )
    course_unit_id: Mapped[int] = mapped_column(
        ForeignKey("course_units.id"), index=True, nullable=False
    )
    course_release_id: Mapped[int] = mapped_column(
        ForeignKey("course_releases.id"), index=True, nullable=False
    )
    content_page_version_id: Mapped[int] = mapped_column(
        ForeignKey("content_page_versions.id"), index=True, nullable=False
    )
    checkpoint_key: Mapped[str] = mapped_column(String(120), nullable=False)
    rule_id: Mapped[int] = mapped_column(
        ForeignKey("learning_completion_rules.id"), index=True, nullable=False
    )
    rule_version: Mapped[int] = mapped_column(Integer, nullable=False)
    attempt_number: Mapped[int] = mapped_column(Integer, nullable=False)
    response_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    response_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    is_correct: Mapped[bool] = mapped_column(Boolean, nullable=False)
    submitted_at: Mapped[datetime] = mapped_column(
        _evidence_datetime_type(), default=utc_now, nullable=False
    )


class LearningActivityRuntime(TimestampMixin, Base):
    """Exact identity plus independent learner/server cursors for one run.

    Rows created before migration 0053 intentionally have no runtime.  The
    service must never infer these coordinates from the legacy event stream.
    """

    __tablename__ = "learning_activity_runtimes"
    __table_args__ = (
        UniqueConstraint(
            "subject_user_id",
            "class_id",
            "course_id",
            "course_unit_id",
            "run_id",
            "group_id",
            name="uq_le_activity_runtime_identity",
        ),
        CheckConstraint(
            "subject_identity_kind = 'learner'",
            name="ck_le_activity_runtime_subject_kind",
        ),
        CheckConstraint(
            "event_schema_version > 0",
            name="ck_le_activity_runtime_event_schema_positive",
        ),
        CheckConstraint(
            "rule_version > 0",
            name="ck_le_activity_runtime_rule_version_positive",
        ),
        CheckConstraint(
            "last_learner_sequence >= 0",
            name="ck_le_activity_runtime_last_learner_nonnegative",
        ),
        CheckConstraint(
            "last_server_sequence >= last_learner_sequence",
            name="ck_le_activity_runtime_server_covers_learner",
        ),
        CheckConstraint(
            "snapshot_applied_through_learner_sequence = last_learner_sequence",
            name="ck_le_activity_runtime_snapshot_learner_cursor",
        ),
        Index(
            "ix_le_activity_runtime_subject_scope",
            "subject_user_id",
            "class_id",
            "course_id",
            "course_unit_id",
            "updated_at",
            "id",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    subject_user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id"), index=True, nullable=False
    )
    subject_identity_kind: Mapped[str] = mapped_column(
        String(16), default="learner", nullable=False
    )
    subject_identity_id: Mapped[str] = mapped_column(String(128), nullable=False)
    school_id: Mapped[int] = mapped_column(
        ForeignKey("schools.id"), index=True, nullable=False
    )
    class_id: Mapped[int] = mapped_column(
        ForeignKey("class_groups.id"), index=True, nullable=False
    )
    course_id: Mapped[int] = mapped_column(
        ForeignKey("courses.id"), index=True, nullable=False
    )
    course_unit_id: Mapped[int] = mapped_column(
        ForeignKey("course_units.id"), index=True, nullable=False
    )
    activity_key: Mapped[str] = mapped_column(String(120), nullable=False)
    run_id: Mapped[str] = mapped_column(_client_event_id_type(), nullable=False)
    group_id: Mapped[str] = mapped_column(_client_event_id_type(), nullable=False)
    manifest_version: Mapped[str] = mapped_column(String(64), nullable=False)
    content_version: Mapped[str] = mapped_column(String(64), nullable=False)
    event_schema_version: Mapped[int] = mapped_column(Integer, nullable=False)
    state_schema_version: Mapped[str] = mapped_column(String(64), nullable=False)
    rule_id: Mapped[int] = mapped_column(
        ForeignKey("learning_completion_rules.id"), index=True, nullable=False
    )
    rule_version: Mapped[int] = mapped_column(Integer, nullable=False)
    generation: Mapped[str] = mapped_column(String(128), nullable=False)
    authority_revision: Mapped[str] = mapped_column(String(64), nullable=False)
    release_revision: Mapped[str] = mapped_column(String(64), nullable=False)
    last_learner_sequence: Mapped[int] = mapped_column(
        Integer, default=0, nullable=False
    )
    last_server_sequence: Mapped[int] = mapped_column(
        Integer, default=0, nullable=False
    )
    snapshot_applied_through_learner_sequence: Mapped[int] = mapped_column(
        Integer, default=0, nullable=False
    )
    snapshot_json: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    snapshot_captured_at: Mapped[datetime] = mapped_column(
        _evidence_datetime_type(), default=utc_now, nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        _evidence_datetime_type(), default=utc_now, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        _evidence_datetime_type(),
        default=utc_now,
        onupdate=utc_now,
        nullable=False,
    )


class LearningEvidenceEvent(Base):
    __tablename__ = "learning_evidence_events"
    __table_args__ = (
        UniqueConstraint("client_event_id", name="uq_le_events_client_event"),
        UniqueConstraint("corrects_event_id", name="uq_le_events_correction_target"),
        UniqueConstraint(
            "activity_runtime_id",
            "server_sequence",
            name="uq_le_events_runtime_server_sequence",
        ),
        UniqueConstraint(
            "activity_runtime_id",
            "learner_sequence",
            name="uq_le_events_runtime_learner_sequence",
        ),
        CheckConstraint(
            "event_type IN ("
            "'started', 'predicted', 'attempted', 'corrected', 'explained', "
            "'completed', 'transferred', 'administrative_correction'"
            ")",
            name="ck_le_events_type",
        ),
        CheckConstraint(
            "producer_type IN ('learner', 'rule', 'trusted_assessment', 'teacher_correction')",
            name="ck_le_events_producer",
        ),
        CheckConstraint(
            "("
            "(producer_type = 'learner' AND event_type IN "
            "('started', 'predicted', 'attempted', 'corrected', 'explained')) OR "
            "(producer_type IN ('rule', 'trusted_assessment') AND event_type IN "
            "('completed', 'transferred')) OR "
            "(producer_type = 'teacher_correction' AND event_type = 'administrative_correction')"
            ")",
            name="ck_le_events_producer_type",
        ),
        CheckConstraint(
            "event_schema_version > 0",
            name="ck_le_events_schema_version_positive",
        ),
        CheckConstraint(
            "occurred_at >= '1000-01-01 00:00:00'",
            name="ck_le_events_occurred_at_mysql_range",
        ),
        CheckConstraint(
            "(activity_runtime_id IS NULL AND server_sequence IS NULL AND "
            "learner_sequence IS NULL AND activity_sidecar_json IS NULL AND "
            "activity_sidecar_sha256 IS NULL) OR "
            "(activity_runtime_id IS NOT NULL AND server_sequence IS NOT NULL "
            "AND server_sequence > 0 AND ((producer_type = 'learner' AND "
            "learner_sequence IS NOT NULL AND learner_sequence > 0 AND "
            "activity_sidecar_json IS NOT NULL AND "
            "activity_sidecar_sha256 IS NOT NULL) OR "
            "(producer_type IN ('rule', 'trusted_assessment') AND "
            "learner_sequence IS NULL AND activity_sidecar_json IS NULL AND "
            "activity_sidecar_sha256 IS NULL)))",
            name="ck_le_events_runtime_cursor_sidecar_shape",
        ),
        Index(
            "ix_le_events_subject_scope_order",
            "subject_user_id",
            "class_id",
            "course_id",
            "course_unit_id",
            "rule_id",
            "occurred_at",
            "id",
        ),
        Index("ix_le_events_class_course_received", "class_id", "course_id", "received_at", "id"),
        Index(
            "ix_le_events_runtime_order",
            "activity_runtime_id",
            "server_sequence",
            "id",
        ),
        Index(
            "ix_le_events_runtime_learner_order",
            "activity_runtime_id",
            "learner_sequence",
            "id",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    client_event_id: Mapped[str] = mapped_column(_client_event_id_type(), nullable=False)
    request_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    actor_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    subject_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    producer_type: Mapped[str] = mapped_column(String(32), nullable=False)
    school_id: Mapped[int] = mapped_column(ForeignKey("schools.id"), index=True, nullable=False)
    class_id: Mapped[int] = mapped_column(ForeignKey("class_groups.id"), index=True, nullable=False)
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id"), index=True, nullable=False)
    course_unit_id: Mapped[int] = mapped_column(ForeignKey("course_units.id"), index=True, nullable=False)
    assignment_id: Mapped[int | None] = mapped_column(ForeignKey("assignments.id"), index=True, nullable=True)
    activity_key: Mapped[str] = mapped_column(String(120), nullable=False)
    rule_id: Mapped[int] = mapped_column(
        ForeignKey("learning_completion_rules.id"),
        index=True,
        nullable=False,
    )
    rule_version: Mapped[int] = mapped_column(Integer, nullable=False)
    event_schema_version: Mapped[int] = mapped_column(
        Integer,
        default=CURRENT_EVENT_SCHEMA_VERSION,
        nullable=False,
    )
    event_type: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    evidence_json: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    source_event_ids_json: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    activity_runtime_id: Mapped[int | None] = mapped_column(
        ForeignKey("learning_activity_runtimes.id"), index=True, nullable=True
    )
    server_sequence: Mapped[int | None] = mapped_column(Integer, nullable=True)
    learner_sequence: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # ``none_as_null`` is required by the database shape constraint: server
    # events carry SQL NULL here, never the JSON literal ``null``.
    activity_sidecar_json: Mapped[dict | None] = mapped_column(
        JSON(none_as_null=True), nullable=True
    )
    activity_sidecar_sha256: Mapped[str | None] = mapped_column(
        String(64), nullable=True
    )
    corrects_event_id: Mapped[int | None] = mapped_column(
        ForeignKey("learning_evidence_events.id"),
        index=True,
        nullable=True,
    )
    occurred_at: Mapped[datetime] = mapped_column(_evidence_datetime_type(), nullable=False)
    received_at: Mapped[datetime] = mapped_column(_evidence_datetime_type(), default=utc_now, nullable=False)


class LearningActivityProjection(TimestampMixin, Base):
    __tablename__ = "learning_activity_projections"
    # course_unit_id is the stable activity identity. CourseUnit enforces
    # (course_id, activity_key) uniqueness, and the write service rejects a key
    # that does not match that unit. A future versioned activity model must
    # migrate this scope before relaxing either invariant.
    __table_args__ = (
        UniqueConstraint(
            "subject_user_id",
            "class_id",
            "course_id",
            "course_unit_id",
            "rule_id",
            name="uq_le_activity_projection_scope",
        ),
        CheckConstraint(
            "status IN ('not_started', 'in_progress', 'completed', 'transferred')",
            name="ck_le_activity_projection_status",
        ),
        Index(
            "ix_le_activity_projection_class_course",
            "class_id",
            "course_id",
            "rule_id",
            "status",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    subject_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    school_id: Mapped[int] = mapped_column(ForeignKey("schools.id"), index=True, nullable=False)
    class_id: Mapped[int] = mapped_column(ForeignKey("class_groups.id"), index=True, nullable=False)
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id"), index=True, nullable=False)
    course_unit_id: Mapped[int] = mapped_column(ForeignKey("course_units.id"), index=True, nullable=False)
    activity_key: Mapped[str] = mapped_column(String(120), nullable=False)
    rule_id: Mapped[int] = mapped_column(
        ForeignKey("learning_completion_rules.id"),
        index=True,
        nullable=False,
    )
    rule_version: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(24), default="not_started", nullable=False)
    learner_event_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    attempt_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    reported_correct_attempt_count: Mapped[int] = mapped_column(
        Integer,
        default=0,
        nullable=False,
    )
    corrected_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    explained_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    first_started_at: Mapped[datetime | None] = mapped_column(_evidence_datetime_type(), nullable=True)
    last_occurred_at: Mapped[datetime | None] = mapped_column(_evidence_datetime_type(), nullable=True)
    last_received_at: Mapped[datetime | None] = mapped_column(_evidence_datetime_type(), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(_evidence_datetime_type(), nullable=True)
    transferred_at: Mapped[datetime | None] = mapped_column(_evidence_datetime_type(), nullable=True)
    last_event_id: Mapped[int | None] = mapped_column(ForeignKey("learning_evidence_events.id"), nullable=True)
    resume_cursor_json: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    projection_revision: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        _evidence_datetime_type(),
        default=utc_now,
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        _evidence_datetime_type(),
        default=utc_now,
        onupdate=utc_now,
        nullable=False,
    )


class LearningResumeProjection(TimestampMixin, Base):
    __tablename__ = "learning_resume_projections"
    __table_args__ = (
        UniqueConstraint(
            "subject_user_id",
            "class_id",
            "course_id",
            "rule_id",
            name="uq_le_resume_projection_scope",
        ),
        Index("ix_le_resume_subject_updated", "subject_user_id", "updated_at", "id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    subject_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    school_id: Mapped[int] = mapped_column(ForeignKey("schools.id"), index=True, nullable=False)
    class_id: Mapped[int] = mapped_column(ForeignKey("class_groups.id"), index=True, nullable=False)
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id"), index=True, nullable=False)
    course_unit_id: Mapped[int] = mapped_column(ForeignKey("course_units.id"), nullable=False)
    activity_key: Mapped[str] = mapped_column(String(120), nullable=False)
    rule_id: Mapped[int] = mapped_column(
        ForeignKey("learning_completion_rules.id"),
        index=True,
        nullable=False,
    )
    rule_version: Mapped[int] = mapped_column(Integer, nullable=False)
    last_event_id: Mapped[int] = mapped_column(ForeignKey("learning_evidence_events.id"), nullable=False)
    last_occurred_at: Mapped[datetime] = mapped_column(_evidence_datetime_type(), nullable=False)
    cursor_json: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        _evidence_datetime_type(),
        default=utc_now,
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        _evidence_datetime_type(),
        default=utc_now,
        onupdate=utc_now,
        nullable=False,
    )


class LegacyAccessEntitlement(Base):
    __tablename__ = "legacy_access_entitlements"
    __table_args__ = (
        UniqueConstraint("entitlement_key", name="uq_legacy_access_entitlement_key"),
        Index(
            "ix_legacy_access_subject_prerequisite",
            "subject_user_id",
            "class_id",
            "prerequisite_unit_id",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    entitlement_key: Mapped[str] = mapped_column(String(64), nullable=False)
    subject_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    class_id: Mapped[int] = mapped_column(ForeignKey("class_groups.id"), index=True, nullable=False)
    prerequisite_unit_id: Mapped[int] = mapped_column(ForeignKey("course_units.id"), index=True, nullable=False)
    source_learning_event_id: Mapped[int | None] = mapped_column(
        ForeignKey("learning_events.id"),
        index=True,
        nullable=True,
    )
    source_event_kind: Mapped[str] = mapped_column(String(48), nullable=False)
    migration_revision: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(_evidence_datetime_type(), default=utc_now, nullable=False)


def _reject_append_only_mutation(_mapper, _connection, target) -> None:
    raise ValueError(f"{target.__class__.__name__} is append-only")


def _validate_evidence_event_insert(_mapper, _connection, target) -> None:
    if (
        target.event_type in DERIVED_EVENT_TYPES
        and len(target.source_event_ids_json or []) > MAX_RULE_WITNESS_EVENTS
    ):
        raise ValueError(
            "Derived learning evidence may reference at most "
            f"{MAX_RULE_WITNESS_EVENTS} source events"
        )
    if target.activity_runtime_id is None:
        if any(
            value is not None
            for value in (
                target.server_sequence,
                target.learner_sequence,
                target.activity_sidecar_json,
                target.activity_sidecar_sha256,
            )
        ):
            raise ValueError("Legacy evidence cannot claim activity runtime cursors")
        return
    if target.server_sequence is None or target.server_sequence <= 0:
        raise ValueError("Runtime evidence requires a positive server_sequence")
    if target.producer_type == "learner":
        if (
            target.learner_sequence is None
            or target.learner_sequence <= 0
            or not isinstance(target.activity_sidecar_json, dict)
            or not isinstance(target.activity_sidecar_sha256, str)
            or len(target.activity_sidecar_sha256) != 64
        ):
            raise ValueError(
                "Runtime learner evidence requires learner cursor and sidecar"
            )
    elif (
        target.learner_sequence is not None
        or target.activity_sidecar_json is not None
        or target.activity_sidecar_sha256 is not None
    ):
        raise ValueError("Server-derived runtime evidence cannot carry learner sidecar")


def _protect_completion_rule_update(_mapper, _connection, target) -> None:
    state = sa_inspect(target)
    immutable_fields = (
        "id",
        "course_id",
        "version_number",
        "definition_json",
        "definition_sha256",
        "created_by_user_id",
        "created_at",
    )
    if any(state.attrs[field].history.has_changes() for field in immutable_fields):
        raise ValueError("LearningCompletionRule definition is immutable")

    status_changed = state.attrs.status.history.has_changes()
    activation_changed = any(
        state.attrs[field].history.has_changes()
        for field in ("activated_by_user_id", "activated_at")
    )
    if status_changed:
        old_statuses = state.attrs.status.history.deleted
        if target.status != "active" or (old_statuses and old_statuses[0] != "draft"):
            raise ValueError("LearningCompletionRule status transition is immutable")
    elif activation_changed:
        raise ValueError("LearningCompletionRule activation metadata is immutable")


def _protect_activity_runtime_update(_mapper, _connection, target) -> None:
    state = sa_inspect(target)
    immutable_fields = (
        "id",
        "subject_user_id",
        "subject_identity_kind",
        "subject_identity_id",
        "school_id",
        "class_id",
        "course_id",
        "course_unit_id",
        "activity_key",
        "run_id",
        "group_id",
        "manifest_version",
        "content_version",
        "event_schema_version",
        "state_schema_version",
        "rule_id",
        "rule_version",
        "generation",
        "authority_revision",
        "release_revision",
        "created_at",
    )
    if any(state.attrs[field].history.has_changes() for field in immutable_fields):
        raise ValueError("LearningActivityRuntime identity is immutable")


event.listen(LearningCompletionRule, "before_update", _protect_completion_rule_update)
event.listen(LearningCompletionRule, "before_delete", _reject_append_only_mutation)
event.listen(LearningActivityRuntime, "before_update", _protect_activity_runtime_update)
event.listen(LearningActivityRuntime, "before_delete", _reject_append_only_mutation)
event.listen(LearningEvidenceEvent, "before_insert", _validate_evidence_event_insert)


for _append_only_model in (
    CheckpointAttempt,
    LearningRuleClassBinding,
    LearningEvidenceEvent,
    LegacyAccessEntitlement,
):
    event.listen(_append_only_model, "before_update", _reject_append_only_mutation)
    event.listen(_append_only_model, "before_delete", _reject_append_only_mutation)
