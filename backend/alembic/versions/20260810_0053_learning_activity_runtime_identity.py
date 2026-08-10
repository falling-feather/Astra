"""add dual-cursor learning activity runtime identity and exact sidecars

Revision ID: 20260810_0053
Revises: 20260809_0052
Create Date: 2026-08-10
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import mysql


revision = "20260810_0053"
down_revision = "20260809_0052"
branch_labels = None
depends_on = None


def _token_type(dialect_name: str | None = None):
    active_dialect = dialect_name or op.get_bind().dialect.name
    if active_dialect == "mysql":
        return mysql.VARCHAR(
            length=128,
            charset="ascii",
            collation="ascii_bin",
        )
    return sa.String(length=128)


def _evidence_datetime_type():
    return sa.DateTime(timezone=True).with_variant(
        mysql.DATETIME(fsp=6),
        "mysql",
    )


def upgrade() -> None:
    timestamp_type = _evidence_datetime_type()
    op.create_table(
        "learning_activity_runtimes",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("subject_user_id", sa.Integer(), nullable=False),
        sa.Column("subject_identity_kind", sa.String(length=16), nullable=False),
        sa.Column("subject_identity_id", sa.String(length=128), nullable=False),
        sa.Column("school_id", sa.Integer(), nullable=False),
        sa.Column("class_id", sa.Integer(), nullable=False),
        sa.Column("course_id", sa.Integer(), nullable=False),
        sa.Column("course_unit_id", sa.Integer(), nullable=False),
        sa.Column("activity_key", sa.String(length=120), nullable=False),
        sa.Column("run_id", _token_type(), nullable=False),
        sa.Column("group_id", _token_type(), nullable=False),
        sa.Column("manifest_version", sa.String(length=64), nullable=False),
        sa.Column("content_version", sa.String(length=64), nullable=False),
        sa.Column("event_schema_version", sa.Integer(), nullable=False),
        sa.Column("state_schema_version", sa.String(length=64), nullable=False),
        sa.Column("rule_id", sa.Integer(), nullable=False),
        sa.Column("rule_version", sa.Integer(), nullable=False),
        sa.Column("generation", sa.String(length=128), nullable=False),
        sa.Column("authority_revision", sa.String(length=64), nullable=False),
        sa.Column("release_revision", sa.String(length=64), nullable=False),
        sa.Column("last_learner_sequence", sa.Integer(), nullable=False),
        sa.Column("last_server_sequence", sa.Integer(), nullable=False),
        sa.Column(
            "snapshot_applied_through_learner_sequence",
            sa.Integer(),
            nullable=False,
        ),
        sa.Column("snapshot_json", sa.JSON(), nullable=False),
        sa.Column("snapshot_captured_at", timestamp_type, nullable=False),
        sa.Column("created_at", timestamp_type, nullable=False),
        sa.Column("updated_at", timestamp_type, nullable=False),
        sa.CheckConstraint(
            "subject_identity_kind = 'learner'",
            name="ck_le_activity_runtime_subject_kind",
        ),
        sa.CheckConstraint(
            "event_schema_version > 0",
            name="ck_le_activity_runtime_event_schema_positive",
        ),
        sa.CheckConstraint(
            "rule_version > 0",
            name="ck_le_activity_runtime_rule_version_positive",
        ),
        sa.CheckConstraint(
            "last_learner_sequence >= 0",
            name="ck_le_activity_runtime_last_learner_nonnegative",
        ),
        sa.CheckConstraint(
            "last_server_sequence >= last_learner_sequence",
            name="ck_le_activity_runtime_server_covers_learner",
        ),
        sa.CheckConstraint(
            "snapshot_applied_through_learner_sequence = last_learner_sequence",
            name="ck_le_activity_runtime_snapshot_learner_cursor",
        ),
        sa.ForeignKeyConstraint(["subject_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["school_id"], ["schools.id"]),
        sa.ForeignKeyConstraint(["class_id"], ["class_groups.id"]),
        sa.ForeignKeyConstraint(["course_id"], ["courses.id"]),
        sa.ForeignKeyConstraint(["course_unit_id"], ["course_units.id"]),
        sa.ForeignKeyConstraint(
            ["rule_id"],
            ["learning_completion_rules.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "subject_user_id",
            "class_id",
            "course_id",
            "course_unit_id",
            "run_id",
            "group_id",
            name="uq_le_activity_runtime_identity",
        ),
    )
    for column_name in (
        "subject_user_id",
        "school_id",
        "class_id",
        "course_id",
        "course_unit_id",
        "rule_id",
    ):
        op.create_index(
            f"ix_learning_activity_runtimes_{column_name}",
            "learning_activity_runtimes",
            [column_name],
            unique=False,
        )
    op.create_index(
        "ix_le_activity_runtime_subject_scope",
        "learning_activity_runtimes",
        [
            "subject_user_id",
            "class_id",
            "course_id",
            "course_unit_id",
            "updated_at",
            "id",
        ],
        unique=False,
    )

    with op.batch_alter_table("learning_evidence_events") as batch_op:
        batch_op.add_column(
            sa.Column("activity_runtime_id", sa.Integer(), nullable=True)
        )
        batch_op.add_column(
            sa.Column("server_sequence", sa.Integer(), nullable=True)
        )
        batch_op.add_column(
            sa.Column("learner_sequence", sa.Integer(), nullable=True)
        )
        batch_op.add_column(
            sa.Column(
                "activity_sidecar_json",
                sa.JSON(none_as_null=True),
                nullable=True,
            )
        )
        batch_op.add_column(
            sa.Column(
                "activity_sidecar_sha256",
                sa.String(length=64),
                nullable=True,
            )
        )
        batch_op.create_foreign_key(
            "fk_le_events_activity_runtime",
            "learning_activity_runtimes",
            ["activity_runtime_id"],
            ["id"],
        )
        batch_op.create_check_constraint(
            "ck_le_events_runtime_cursor_sidecar_shape",
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
        )
        batch_op.create_unique_constraint(
            "uq_le_events_runtime_server_sequence",
            ["activity_runtime_id", "server_sequence"],
        )
        batch_op.create_unique_constraint(
            "uq_le_events_runtime_learner_sequence",
            ["activity_runtime_id", "learner_sequence"],
        )
        batch_op.create_index(
            "ix_learning_evidence_events_activity_runtime_id",
            ["activity_runtime_id"],
            unique=False,
        )
        batch_op.create_index(
            "ix_le_events_runtime_order",
            ["activity_runtime_id", "server_sequence", "id"],
            unique=False,
        )
        batch_op.create_index(
            "ix_le_events_runtime_learner_order",
            ["activity_runtime_id", "learner_sequence", "id"],
            unique=False,
        )


def downgrade() -> None:
    runtime_count = int(
        op.get_bind().execute(
            sa.text("SELECT COUNT(*) FROM learning_activity_runtimes")
        ).scalar_one()
    )
    if runtime_count:
        raise RuntimeError(
            "cannot downgrade BE-018 while exact activity runtime identities exist"
        )
    with op.batch_alter_table("learning_evidence_events") as batch_op:
        batch_op.drop_index("ix_le_events_runtime_learner_order")
        batch_op.drop_index("ix_le_events_runtime_order")
        batch_op.drop_index("ix_learning_evidence_events_activity_runtime_id")
        batch_op.drop_constraint(
            "uq_le_events_runtime_learner_sequence",
            type_="unique",
        )
        batch_op.drop_constraint(
            "uq_le_events_runtime_server_sequence",
            type_="unique",
        )
        batch_op.drop_constraint(
            "ck_le_events_runtime_cursor_sidecar_shape",
            type_="check",
        )
        batch_op.drop_constraint(
            "fk_le_events_activity_runtime",
            type_="foreignkey",
        )
        batch_op.drop_column("activity_sidecar_sha256")
        batch_op.drop_column("activity_sidecar_json")
        batch_op.drop_column("learner_sequence")
        batch_op.drop_column("server_sequence")
        batch_op.drop_column("activity_runtime_id")

    op.drop_index(
        "ix_le_activity_runtime_subject_scope",
        table_name="learning_activity_runtimes",
    )
    for column_name in reversed(
        (
            "subject_user_id",
            "school_id",
            "class_id",
            "course_id",
            "course_unit_id",
            "rule_id",
        )
    ):
        op.drop_index(
            f"ix_learning_activity_runtimes_{column_name}",
            table_name="learning_activity_runtimes",
        )
    op.drop_table("learning_activity_runtimes")
