"""add immutable checkpoint attempts and repair published unit status

Revision ID: 20260825_0058
Revises: 20260825_0057
Create Date: 2026-08-25
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql

revision = "20260825_0058"
down_revision = "20260825_0057"
branch_labels = None
depends_on = None


def _attempt_id_type():
    if op.get_bind().dialect.name == "mysql":
        return mysql.VARCHAR(length=128, charset="ascii", collation="ascii_bin")
    return sa.String(length=128)


def _timestamp_type():
    if op.get_bind().dialect.name == "mysql":
        return mysql.DATETIME(fsp=6)
    return sa.DateTime(timezone=True)


def upgrade() -> None:
    op.create_table(
        "checkpoint_attempts",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("client_attempt_id", _attempt_id_type(), nullable=False),
        sa.Column("request_sha256", sa.String(length=64), nullable=False),
        sa.Column("student_id", sa.Integer(), nullable=False),
        sa.Column("class_id", sa.Integer(), nullable=False),
        sa.Column("course_id", sa.Integer(), nullable=False),
        sa.Column("course_unit_id", sa.Integer(), nullable=False),
        sa.Column("course_release_id", sa.Integer(), nullable=False),
        sa.Column("content_page_version_id", sa.Integer(), nullable=False),
        sa.Column("checkpoint_key", sa.String(length=120), nullable=False),
        sa.Column("rule_id", sa.Integer(), nullable=False),
        sa.Column("rule_version", sa.Integer(), nullable=False),
        sa.Column("attempt_number", sa.Integer(), nullable=False),
        sa.Column("response_json", sa.JSON(), nullable=False),
        sa.Column("response_sha256", sa.String(length=64), nullable=False),
        sa.Column("is_correct", sa.Boolean(), nullable=False),
        sa.Column("submitted_at", _timestamp_type(), nullable=False),
        sa.CheckConstraint(
            "attempt_number > 0", name="ck_checkpoint_attempts_number_positive"
        ),
        sa.ForeignKeyConstraint(["class_id"], ["class_groups.id"]),
        sa.ForeignKeyConstraint(
            ["content_page_version_id"], ["content_page_versions.id"]
        ),
        sa.ForeignKeyConstraint(["course_id"], ["courses.id"]),
        sa.ForeignKeyConstraint(["course_release_id"], ["course_releases.id"]),
        sa.ForeignKeyConstraint(["course_unit_id"], ["course_units.id"]),
        sa.ForeignKeyConstraint(["rule_id"], ["learning_completion_rules.id"]),
        sa.ForeignKeyConstraint(["student_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "client_attempt_id", name="uq_checkpoint_attempts_client_attempt"
        ),
        sa.UniqueConstraint(
            "course_release_id",
            "course_unit_id",
            "checkpoint_key",
            "student_id",
            "attempt_number",
            name="uq_checkpoint_attempts_scope_number",
        ),
    )
    for column_name in (
        "student_id",
        "class_id",
        "course_id",
        "course_unit_id",
        "course_release_id",
        "content_page_version_id",
        "rule_id",
    ):
        op.create_index(
            f"ix_checkpoint_attempts_{column_name}",
            "checkpoint_attempts",
            [column_name],
            unique=False,
        )
    op.create_index(
        "ix_checkpoint_attempts_student_scope",
        "checkpoint_attempts",
        ["student_id", "course_id", "course_unit_id", "submitted_at", "id"],
        unique=False,
    )
    op.execute(
        sa.text(
            "UPDATE course_units SET status = 'published' "
            "WHERE status <> 'archived' AND id IN "
            "(SELECT source_course_unit_id FROM course_release_units)"
        )
    )


def downgrade() -> None:
    op.drop_index(
        "ix_checkpoint_attempts_student_scope", table_name="checkpoint_attempts"
    )
    for column_name in (
        "rule_id",
        "content_page_version_id",
        "course_release_id",
        "course_unit_id",
        "course_id",
        "class_id",
        "student_id",
    ):
        op.drop_index(
            f"ix_checkpoint_attempts_{column_name}",
            table_name="checkpoint_attempts",
        )
    op.drop_table("checkpoint_attempts")
