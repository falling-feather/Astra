"""add V8.4 course taxonomy and class kinds

Revision ID: 20260825_0054
Revises: 20260810_0053
Create Date: 2026-08-25
"""

from alembic import op
import sqlalchemy as sa


revision = "20260825_0054"
down_revision = "20260810_0053"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("courses") as batch_op:
        batch_op.add_column(sa.Column("subject_key", sa.String(length=96), nullable=True))
        batch_op.create_index("ix_courses_galaxy_subject", ["galaxy_key", "subject_key"], unique=False)

    op.execute(
        sa.text(
            "UPDATE courses SET subject_key = course_key "
            "WHERE subject_key IS NULL OR subject_key = ''"
        )
    )
    with op.batch_alter_table("courses") as batch_op:
        batch_op.alter_column("subject_key", existing_type=sa.String(length=96), nullable=False)

    with op.batch_alter_table("class_groups") as batch_op:
        batch_op.add_column(sa.Column("kind", sa.String(length=24), nullable=True))

    op.execute(
        sa.text(
            "UPDATE class_groups SET kind = 'homeroom' "
            "WHERE kind IS NULL OR kind = ''"
        )
    )
    with op.batch_alter_table("class_groups") as batch_op:
        batch_op.alter_column("kind", existing_type=sa.String(length=24), nullable=False)
        batch_op.create_check_constraint(
            "ck_class_groups_kind",
            "kind IN ('homeroom', 'course_cohort')",
        )
        batch_op.create_index("ix_class_groups_school_kind_status", ["school_id", "kind", "status", "id"])


def downgrade() -> None:
    with op.batch_alter_table("class_groups") as batch_op:
        batch_op.drop_index("ix_class_groups_school_kind_status")
        batch_op.drop_constraint("ck_class_groups_kind", type_="check")
        batch_op.drop_column("kind")

    with op.batch_alter_table("courses") as batch_op:
        batch_op.drop_index("ix_courses_galaxy_subject")
        batch_op.drop_column("subject_key")
