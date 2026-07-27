"""add authoritative learning evidence and completion rules

Revision ID: 20260727_0051
Revises: 20260719_0050
Create Date: 2026-07-27
"""

from datetime import UTC, datetime
import hashlib

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import mysql


revision = "20260727_0051"
down_revision = "20260719_0050"
branch_labels = None
depends_on = None
_LEGACY_BACKFILL_BATCH_SIZE = 1000


def _timestamp_type(dialect_name: str | None = None):
    active_dialect = dialect_name or op.get_bind().dialect.name
    if active_dialect == "mysql":
        return mysql.DATETIME(fsp=6)
    return sa.DateTime(timezone=True)


def _client_event_id_type(dialect_name: str | None = None):
    active_dialect = dialect_name or op.get_bind().dialect.name
    if active_dialect == "mysql":
        return mysql.VARCHAR(length=128, charset="ascii", collation="ascii_bin")
    return sa.String(length=128)


def upgrade() -> None:
    op.create_table(
        "learning_completion_rules",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("course_id", sa.Integer(), sa.ForeignKey("courses.id"), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("definition_json", sa.JSON(), nullable=False),
        sa.Column("definition_sha256", sa.String(length=64), nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("activated_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("activated_at", _timestamp_type(), nullable=True),
        sa.Column("created_at", _timestamp_type(), nullable=False),
        sa.UniqueConstraint("course_id", "version_number", name="uq_le_rules_course_version"),
        sa.CheckConstraint("version_number > 0", name="ck_le_rules_version_positive"),
        sa.CheckConstraint("status IN ('draft', 'active')", name="ck_le_rules_status"),
    )
    op.create_index("ix_learning_completion_rules_course_id", "learning_completion_rules", ["course_id"])
    op.create_index(
        "ix_learning_completion_rules_created_by_user_id",
        "learning_completion_rules",
        ["created_by_user_id"],
    )
    op.create_index(
        "ix_le_rules_course_status_version",
        "learning_completion_rules",
        ["course_id", "status", "version_number"],
    )

    op.create_table(
        "learning_rule_activations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("course_id", sa.Integer(), sa.ForeignKey("courses.id"), nullable=False),
        sa.Column(
            "active_rule_id",
            sa.Integer(),
            sa.ForeignKey("learning_completion_rules.id"),
            nullable=False,
        ),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("activated_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("activated_at", _timestamp_type(), nullable=False),
        sa.Column("created_at", _timestamp_type(), nullable=False),
        sa.Column("updated_at", _timestamp_type(), nullable=False),
        sa.UniqueConstraint("course_id", name="uq_le_rule_activation_course"),
        sa.CheckConstraint("revision >= 0", name="ck_le_rule_activation_revision"),
    )
    op.create_index("ix_learning_rule_activations_course_id", "learning_rule_activations", ["course_id"])
    op.create_index(
        "ix_learning_rule_activations_active_rule_id",
        "learning_rule_activations",
        ["active_rule_id"],
    )

    op.create_table(
        "learning_rule_class_bindings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("course_class_id", sa.Integer(), sa.ForeignKey("course_classes.id"), nullable=False),
        sa.Column("plan_version", sa.Integer(), nullable=False),
        sa.Column("rule_id", sa.Integer(), sa.ForeignKey("learning_completion_rules.id"), nullable=False),
        sa.Column("rule_version", sa.Integer(), nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", _timestamp_type(), nullable=False),
        sa.UniqueConstraint("course_class_id", "plan_version", name="uq_le_rule_binding_plan"),
        sa.CheckConstraint("plan_version > 0", name="ck_le_rule_binding_plan_positive"),
        sa.CheckConstraint("rule_version > 0", name="ck_le_rule_binding_rule_positive"),
    )
    op.create_index(
        "ix_learning_rule_class_bindings_course_class_id",
        "learning_rule_class_bindings",
        ["course_class_id"],
    )
    op.create_index(
        "ix_learning_rule_class_bindings_rule_id",
        "learning_rule_class_bindings",
        ["rule_id"],
    )
    op.create_index(
        "ix_le_rule_binding_rule_plan",
        "learning_rule_class_bindings",
        ["rule_id", "course_class_id", "plan_version"],
    )

    op.create_table(
        "learning_evidence_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("client_event_id", _client_event_id_type(), nullable=False),
        sa.Column("request_sha256", sa.String(length=64), nullable=False),
        sa.Column("actor_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("subject_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("producer_type", sa.String(length=32), nullable=False),
        sa.Column("school_id", sa.Integer(), sa.ForeignKey("schools.id"), nullable=False),
        sa.Column("class_id", sa.Integer(), sa.ForeignKey("class_groups.id"), nullable=False),
        sa.Column("course_id", sa.Integer(), sa.ForeignKey("courses.id"), nullable=False),
        sa.Column("course_unit_id", sa.Integer(), sa.ForeignKey("course_units.id"), nullable=False),
        sa.Column("assignment_id", sa.Integer(), sa.ForeignKey("assignments.id"), nullable=True),
        sa.Column("activity_key", sa.String(length=120), nullable=False),
        sa.Column("rule_id", sa.Integer(), sa.ForeignKey("learning_completion_rules.id"), nullable=False),
        sa.Column("rule_version", sa.Integer(), nullable=False),
        sa.Column("event_schema_version", sa.Integer(), nullable=False),
        sa.Column("event_type", sa.String(length=32), nullable=False),
        sa.Column("evidence_json", sa.JSON(), nullable=False),
        sa.Column("source_event_ids_json", sa.JSON(), nullable=False),
        sa.Column(
            "corrects_event_id",
            sa.Integer(),
            sa.ForeignKey("learning_evidence_events.id"),
            nullable=True,
        ),
        sa.Column("occurred_at", _timestamp_type(), nullable=False),
        sa.Column("received_at", _timestamp_type(), nullable=False),
        sa.UniqueConstraint("client_event_id", name="uq_le_events_client_event"),
        sa.UniqueConstraint("corrects_event_id", name="uq_le_events_correction_target"),
        sa.CheckConstraint(
            "event_type IN ("
            "'started', 'predicted', 'attempted', 'corrected', 'explained', "
            "'completed', 'transferred', 'administrative_correction'"
            ")",
            name="ck_le_events_type",
        ),
        sa.CheckConstraint(
            "producer_type IN ('learner', 'rule', 'trusted_assessment', 'teacher_correction')",
            name="ck_le_events_producer",
        ),
        sa.CheckConstraint(
            "("
            "(producer_type = 'learner' AND event_type IN "
            "('started', 'predicted', 'attempted', 'corrected', 'explained')) OR "
            "(producer_type IN ('rule', 'trusted_assessment') AND event_type IN "
            "('completed', 'transferred')) OR "
            "(producer_type = 'teacher_correction' AND event_type = 'administrative_correction')"
            ")",
            name="ck_le_events_producer_type",
        ),
        sa.CheckConstraint(
            "event_schema_version > 0",
            name="ck_le_events_schema_version_positive",
        ),
        sa.CheckConstraint(
            "occurred_at >= '1000-01-01 00:00:00'",
            name="ck_le_events_occurred_at_mysql_range",
        ),
    )
    for column in (
        "actor_user_id",
        "subject_user_id",
        "school_id",
        "class_id",
        "course_id",
        "course_unit_id",
        "assignment_id",
        "rule_id",
        "event_type",
        "corrects_event_id",
    ):
        op.create_index(f"ix_learning_evidence_events_{column}", "learning_evidence_events", [column])
    op.create_index(
        "ix_le_events_subject_scope_order",
        "learning_evidence_events",
        [
            "subject_user_id",
            "class_id",
            "course_id",
            "course_unit_id",
            "rule_id",
            "occurred_at",
            "id",
        ],
    )
    op.create_index(
        "ix_le_events_class_course_received",
        "learning_evidence_events",
        ["class_id", "course_id", "received_at", "id"],
    )

    op.create_table(
        "learning_activity_projections",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("subject_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("school_id", sa.Integer(), sa.ForeignKey("schools.id"), nullable=False),
        sa.Column("class_id", sa.Integer(), sa.ForeignKey("class_groups.id"), nullable=False),
        sa.Column("course_id", sa.Integer(), sa.ForeignKey("courses.id"), nullable=False),
        sa.Column("course_unit_id", sa.Integer(), sa.ForeignKey("course_units.id"), nullable=False),
        sa.Column("activity_key", sa.String(length=120), nullable=False),
        sa.Column("rule_id", sa.Integer(), sa.ForeignKey("learning_completion_rules.id"), nullable=False),
        sa.Column("rule_version", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("learner_event_count", sa.Integer(), nullable=False),
        sa.Column("attempt_count", sa.Integer(), nullable=False),
        sa.Column("reported_correct_attempt_count", sa.Integer(), nullable=False),
        sa.Column("corrected_count", sa.Integer(), nullable=False),
        sa.Column("explained_count", sa.Integer(), nullable=False),
        sa.Column("first_started_at", _timestamp_type(), nullable=True),
        sa.Column("last_occurred_at", _timestamp_type(), nullable=True),
        sa.Column("last_received_at", _timestamp_type(), nullable=True),
        sa.Column("completed_at", _timestamp_type(), nullable=True),
        sa.Column("transferred_at", _timestamp_type(), nullable=True),
        sa.Column("last_event_id", sa.Integer(), sa.ForeignKey("learning_evidence_events.id"), nullable=True),
        sa.Column("resume_cursor_json", sa.JSON(), nullable=False),
        sa.Column("projection_revision", sa.Integer(), nullable=False),
        sa.Column("created_at", _timestamp_type(), nullable=False),
        sa.Column("updated_at", _timestamp_type(), nullable=False),
        sa.UniqueConstraint(
            "subject_user_id",
            "class_id",
            "course_id",
            "course_unit_id",
            "rule_id",
            name="uq_le_activity_projection_scope",
        ),
        sa.CheckConstraint(
            "status IN ('not_started', 'in_progress', 'completed', 'transferred')",
            name="ck_le_activity_projection_status",
        ),
    )
    for column in (
        "subject_user_id",
        "school_id",
        "class_id",
        "course_id",
        "course_unit_id",
        "rule_id",
    ):
        op.create_index(
            f"ix_learning_activity_projections_{column}",
            "learning_activity_projections",
            [column],
        )
    op.create_index(
        "ix_le_activity_projection_class_course",
        "learning_activity_projections",
        ["class_id", "course_id", "rule_id", "status"],
    )

    op.create_table(
        "learning_resume_projections",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("subject_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("school_id", sa.Integer(), sa.ForeignKey("schools.id"), nullable=False),
        sa.Column("class_id", sa.Integer(), sa.ForeignKey("class_groups.id"), nullable=False),
        sa.Column("course_id", sa.Integer(), sa.ForeignKey("courses.id"), nullable=False),
        sa.Column("course_unit_id", sa.Integer(), sa.ForeignKey("course_units.id"), nullable=False),
        sa.Column("activity_key", sa.String(length=120), nullable=False),
        sa.Column("rule_id", sa.Integer(), sa.ForeignKey("learning_completion_rules.id"), nullable=False),
        sa.Column("rule_version", sa.Integer(), nullable=False),
        sa.Column("last_event_id", sa.Integer(), sa.ForeignKey("learning_evidence_events.id"), nullable=False),
        sa.Column("last_occurred_at", _timestamp_type(), nullable=False),
        sa.Column("cursor_json", sa.JSON(), nullable=False),
        sa.Column("created_at", _timestamp_type(), nullable=False),
        sa.Column("updated_at", _timestamp_type(), nullable=False),
        sa.UniqueConstraint(
            "subject_user_id",
            "class_id",
            "course_id",
            "rule_id",
            name="uq_le_resume_projection_scope",
        ),
    )
    for column in ("subject_user_id", "school_id", "class_id", "course_id", "rule_id"):
        op.create_index(
            f"ix_learning_resume_projections_{column}",
            "learning_resume_projections",
            [column],
        )
    op.create_index(
        "ix_le_resume_subject_updated",
        "learning_resume_projections",
        ["subject_user_id", "updated_at", "id"],
    )

    op.create_table(
        "legacy_access_entitlements",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("entitlement_key", sa.String(length=64), nullable=False),
        sa.Column("subject_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("class_id", sa.Integer(), sa.ForeignKey("class_groups.id"), nullable=False),
        sa.Column("prerequisite_unit_id", sa.Integer(), sa.ForeignKey("course_units.id"), nullable=False),
        sa.Column(
            "source_learning_event_id",
            sa.Integer(),
            sa.ForeignKey("learning_events.id"),
            nullable=True,
        ),
        sa.Column("source_event_kind", sa.String(length=48), nullable=False),
        sa.Column("migration_revision", sa.String(length=64), nullable=False),
        sa.Column("created_at", _timestamp_type(), nullable=False),
        sa.UniqueConstraint("entitlement_key", name="uq_legacy_access_entitlement_key"),
    )
    for column in (
        "subject_user_id",
        "class_id",
        "prerequisite_unit_id",
        "source_learning_event_id",
    ):
        op.create_index(
            f"ix_legacy_access_entitlements_{column}",
            "legacy_access_entitlements",
            [column],
        )
    op.create_index(
        "ix_legacy_access_subject_prerequisite",
        "legacy_access_entitlements",
        ["subject_user_id", "class_id", "prerequisite_unit_id"],
    )

    _backfill_legacy_access_entitlements()


def _backfill_legacy_access_entitlements() -> None:
    bind = op.get_bind()
    table = sa.table(
        "legacy_access_entitlements",
        sa.column("entitlement_key", sa.String()),
        sa.column("subject_user_id", sa.Integer()),
        sa.column("class_id", sa.Integer()),
        sa.column("prerequisite_unit_id", sa.Integer()),
        sa.column("source_learning_event_id", sa.Integer()),
        sa.column("source_event_kind", sa.String()),
        sa.column("migration_revision", sa.String()),
        sa.column("created_at", _timestamp_type()),
    )
    revision_token = revision
    now = datetime.now(UTC)
    last_id = 0
    while True:
        batch = list(
            bind.execute(
                sa.text(
                    "SELECT id, user_id, class_id, unit_id, occurred_at "
                    "FROM learning_events "
                    "WHERE event_type = 'complete' "
                    "AND class_id IS NOT NULL "
                    "AND unit_id IS NOT NULL "
                    "AND id > :last_id "
                    "ORDER BY id "
                    "LIMIT :batch_size"
                ),
                {
                    "last_id": last_id,
                    "batch_size": _LEGACY_BACKFILL_BATCH_SIZE,
                },
            ).mappings()
        )
        if not batch:
            break
        insert_rows: list[dict] = []
        for row in batch:
            key_source = (
                f"{row['user_id']}:{row['class_id']}:{row['unit_id']}:"
                f"{row['id']}:{revision_token}"
            )
            insert_rows.append(
                {
                    "entitlement_key": hashlib.sha256(key_source.encode("utf-8")).hexdigest(),
                    "subject_user_id": row["user_id"],
                    "class_id": row["class_id"],
                    "prerequisite_unit_id": row["unit_id"],
                    "source_learning_event_id": row["id"],
                    "source_event_kind": "legacy_complete",
                    "migration_revision": revision_token,
                    "created_at": _coerce_datetime(row["occurred_at"]) or now,
                }
            )
        op.bulk_insert(table, insert_rows)
        last_id = int(batch[-1]["id"])


def _coerce_datetime(value):
    if value is None or isinstance(value, datetime):
        return value
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


def downgrade() -> None:
    op.drop_index("ix_legacy_access_subject_prerequisite", table_name="legacy_access_entitlements")
    for column in (
        "source_learning_event_id",
        "prerequisite_unit_id",
        "class_id",
        "subject_user_id",
    ):
        op.drop_index(f"ix_legacy_access_entitlements_{column}", table_name="legacy_access_entitlements")
    op.drop_table("legacy_access_entitlements")

    op.drop_index("ix_le_resume_subject_updated", table_name="learning_resume_projections")
    for column in ("rule_id", "course_id", "class_id", "school_id", "subject_user_id"):
        op.drop_index(f"ix_learning_resume_projections_{column}", table_name="learning_resume_projections")
    op.drop_table("learning_resume_projections")

    op.drop_index("ix_le_activity_projection_class_course", table_name="learning_activity_projections")
    for column in (
        "rule_id",
        "course_unit_id",
        "course_id",
        "class_id",
        "school_id",
        "subject_user_id",
    ):
        op.drop_index(
            f"ix_learning_activity_projections_{column}",
            table_name="learning_activity_projections",
        )
    op.drop_table("learning_activity_projections")

    op.drop_index("ix_le_events_class_course_received", table_name="learning_evidence_events")
    op.drop_index("ix_le_events_subject_scope_order", table_name="learning_evidence_events")
    for column in (
        "corrects_event_id",
        "event_type",
        "rule_id",
        "assignment_id",
        "course_unit_id",
        "course_id",
        "class_id",
        "school_id",
        "subject_user_id",
        "actor_user_id",
    ):
        op.drop_index(f"ix_learning_evidence_events_{column}", table_name="learning_evidence_events")
    op.drop_table("learning_evidence_events")

    op.drop_index("ix_le_rule_binding_rule_plan", table_name="learning_rule_class_bindings")
    op.drop_index("ix_learning_rule_class_bindings_rule_id", table_name="learning_rule_class_bindings")
    op.drop_index(
        "ix_learning_rule_class_bindings_course_class_id",
        table_name="learning_rule_class_bindings",
    )
    op.drop_table("learning_rule_class_bindings")

    op.drop_index("ix_learning_rule_activations_active_rule_id", table_name="learning_rule_activations")
    op.drop_index("ix_learning_rule_activations_course_id", table_name="learning_rule_activations")
    op.drop_table("learning_rule_activations")

    op.drop_index("ix_le_rules_course_status_version", table_name="learning_completion_rules")
    op.drop_index(
        "ix_learning_completion_rules_created_by_user_id",
        table_name="learning_completion_rules",
    )
    op.drop_index("ix_learning_completion_rules_course_id", table_name="learning_completion_rules")
    op.drop_table("learning_completion_rules")
