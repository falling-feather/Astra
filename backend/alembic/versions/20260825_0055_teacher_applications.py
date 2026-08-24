"""add teacher identity application workflow

Revision ID: 20260825_0055
Revises: 20260825_0054
Create Date: 2026-08-25
"""

from alembic import op
import sqlalchemy as sa


revision = "20260825_0055"
down_revision = "20260825_0054"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "teacher_applications",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("reviewed_by_user_id", sa.Integer(), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("review_note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "status IN ('pending', 'approved', 'rejected')",
            name="ck_teacher_applications_status",
        ),
        sa.ForeignKeyConstraint(["reviewed_by_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_teacher_applications_id", "teacher_applications", ["id"], unique=False)
    op.create_index(
        "ix_teacher_applications_status_id",
        "teacher_applications",
        ["status", "id"],
        unique=False,
    )
    op.create_index(
        "ix_teacher_applications_user_id_id",
        "teacher_applications",
        ["user_id", "id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_teacher_applications_user_id_id", table_name="teacher_applications")
    op.drop_index("ix_teacher_applications_status_id", table_name="teacher_applications")
    op.drop_index("ix_teacher_applications_id", table_name="teacher_applications")
    op.drop_table("teacher_applications")
