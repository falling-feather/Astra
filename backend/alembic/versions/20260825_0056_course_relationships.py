"""add course information, admission, request, and enrollment relations

Revision ID: 20260825_0056
Revises: 20260825_0055
Create Date: 2026-08-25
"""

from alembic import op
import sqlalchemy as sa


revision = "20260825_0056"
down_revision = "20260825_0055"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("courses") as batch_op:
        batch_op.add_column(sa.Column("course_code", sa.String(length=24), nullable=True))
        batch_op.add_column(sa.Column("academic_year", sa.String(length=32), nullable=True))
        batch_op.add_column(sa.Column("schedule_text", sa.String(length=240), nullable=True))
        batch_op.add_column(sa.Column("total_hours", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("admission_mode", sa.String(length=24), nullable=True))

    op.execute(
        sa.text(
            "UPDATE courses SET admission_mode = CASE "
            "WHEN EXISTS ("
            "SELECT 1 FROM course_classes "
            "WHERE course_classes.course_id = courses.id "
            "AND course_classes.status = 'active'"
            ") THEN 'class_restricted' ELSE 'open' END "
            "WHERE admission_mode IS NULL OR admission_mode = ''"
        )
    )

    with op.batch_alter_table("courses") as batch_op:
        batch_op.alter_column(
            "admission_mode",
            existing_type=sa.String(length=24),
            nullable=False,
        )
        batch_op.create_unique_constraint("uq_courses_course_code", ["course_code"])
        batch_op.create_check_constraint(
            "ck_courses_admission_mode",
            "admission_mode IN ('open', 'class_restricted')",
        )
        batch_op.create_check_constraint(
            "ck_courses_total_hours_positive",
            "total_hours IS NULL OR total_hours > 0",
        )

    op.create_table(
        "course_information_revisions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("course_id", sa.Integer(), nullable=False),
        sa.Column("revision_number", sa.Integer(), nullable=False),
        sa.Column("information_snapshot", sa.JSON(), nullable=False),
        sa.Column("teacher_ids_snapshot", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), nullable=False),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reviewed_by_user_id", sa.Integer(), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("review_note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "revision_number > 0",
            name="ck_course_info_revisions_number_positive",
        ),
        sa.CheckConstraint(
            "status IN ('draft', 'submitted', 'approved', 'rejected')",
            name="ck_course_info_revisions_status",
        ),
        sa.ForeignKeyConstraint(["course_id"], ["courses.id"]),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["reviewed_by_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "course_id",
            "revision_number",
            name="uq_course_info_revisions_course_number",
        ),
    )
    op.create_index(
        "ix_course_information_revisions_id",
        "course_information_revisions",
        ["id"],
        unique=False,
    )
    op.create_index(
        "ix_course_information_revisions_course_id",
        "course_information_revisions",
        ["course_id"],
        unique=False,
    )
    op.create_index(
        "ix_course_information_revisions_created_by_user_id",
        "course_information_revisions",
        ["created_by_user_id"],
        unique=False,
    )
    op.create_index(
        "ix_course_information_revisions_reviewed_by_user_id",
        "course_information_revisions",
        ["reviewed_by_user_id"],
        unique=False,
    )
    op.create_index(
        "ix_course_info_revisions_course_status_id",
        "course_information_revisions",
        ["course_id", "status", "id"],
        unique=False,
    )

    with op.batch_alter_table("courses") as batch_op:
        batch_op.add_column(
            sa.Column("current_information_revision_id", sa.Integer(), nullable=True)
        )
        batch_op.create_foreign_key(
            "fk_courses_current_information_revision_id",
            "course_information_revisions",
            ["current_information_revision_id"],
            ["id"],
        )
        batch_op.create_index(
            "ix_courses_current_information_revision_id",
            ["current_information_revision_id"],
            unique=False,
        )

    op.create_table(
        "course_admission_classes",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("course_id", sa.Integer(), nullable=False),
        sa.Column("class_id", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "status IN ('active', 'inactive')",
            name="ck_course_admission_classes_status",
        ),
        sa.ForeignKeyConstraint(["class_id"], ["class_groups.id"]),
        sa.ForeignKeyConstraint(["course_id"], ["courses.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "course_id",
            "class_id",
            name="uq_course_admission_classes_course_class",
        ),
    )
    op.create_index(
        "ix_course_admission_classes_id",
        "course_admission_classes",
        ["id"],
        unique=False,
    )
    op.create_index(
        "ix_course_admission_classes_course_id",
        "course_admission_classes",
        ["course_id"],
        unique=False,
    )
    op.create_index(
        "ix_course_admission_classes_class_id",
        "course_admission_classes",
        ["class_id"],
        unique=False,
    )
    op.create_index(
        "ix_course_admission_classes_course_status_id",
        "course_admission_classes",
        ["course_id", "status", "id"],
        unique=False,
    )

    op.create_table(
        "course_join_requests",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("course_id", sa.Integer(), nullable=False),
        sa.Column("student_id", sa.Integer(), nullable=False),
        sa.Column("source_class_id", sa.Integer(), nullable=True),
        sa.Column("request_number", sa.Integer(), nullable=False),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("reviewed_by_user_id", sa.Integer(), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("review_note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "request_number > 0",
            name="ck_course_join_requests_number_positive",
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'approved', 'rejected')",
            name="ck_course_join_requests_status",
        ),
        sa.ForeignKeyConstraint(["course_id"], ["courses.id"]),
        sa.ForeignKeyConstraint(["reviewed_by_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["source_class_id"], ["class_groups.id"]),
        sa.ForeignKeyConstraint(["student_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "course_id",
            "student_id",
            "request_number",
            name="uq_course_join_requests_course_student_number",
        ),
    )
    for column_name in (
        "id",
        "course_id",
        "student_id",
        "source_class_id",
        "reviewed_by_user_id",
    ):
        op.create_index(
            f"ix_course_join_requests_{column_name}",
            "course_join_requests",
            [column_name],
            unique=False,
        )
    op.create_index(
        "ix_course_join_requests_course_status_id",
        "course_join_requests",
        ["course_id", "status", "id"],
        unique=False,
    )
    op.create_index(
        "ix_course_join_requests_student_status_id",
        "course_join_requests",
        ["student_id", "status", "id"],
        unique=False,
    )

    op.create_table(
        "course_enrollments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("course_id", sa.Integer(), nullable=False),
        sa.Column("student_id", sa.Integer(), nullable=False),
        sa.Column("source_class_id", sa.Integer(), nullable=True),
        sa.Column("source", sa.String(length=24), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "source IN ('request', 'class_batch', 'teacher', 'admin')",
            name="ck_course_enrollments_source",
        ),
        sa.CheckConstraint(
            "status IN ('active', 'left')",
            name="ck_course_enrollments_status",
        ),
        sa.ForeignKeyConstraint(["course_id"], ["courses.id"]),
        sa.ForeignKeyConstraint(["source_class_id"], ["class_groups.id"]),
        sa.ForeignKeyConstraint(["student_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "course_id",
            "student_id",
            name="uq_course_enrollments_course_student",
        ),
    )
    for column_name in ("id", "course_id", "student_id", "source_class_id"):
        op.create_index(
            f"ix_course_enrollments_{column_name}",
            "course_enrollments",
            [column_name],
            unique=False,
        )
    op.create_index(
        "ix_course_enrollments_course_status_id",
        "course_enrollments",
        ["course_id", "status", "id"],
        unique=False,
    )
    op.create_index(
        "ix_course_enrollments_student_status_id",
        "course_enrollments",
        ["student_id", "status", "id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_course_enrollments_student_status_id",
        table_name="course_enrollments",
    )
    op.drop_index(
        "ix_course_enrollments_course_status_id",
        table_name="course_enrollments",
    )
    for column_name in ("source_class_id", "student_id", "course_id", "id"):
        op.drop_index(
            f"ix_course_enrollments_{column_name}",
            table_name="course_enrollments",
        )
    op.drop_table("course_enrollments")

    op.drop_index(
        "ix_course_join_requests_student_status_id",
        table_name="course_join_requests",
    )
    op.drop_index(
        "ix_course_join_requests_course_status_id",
        table_name="course_join_requests",
    )
    for column_name in (
        "reviewed_by_user_id",
        "source_class_id",
        "student_id",
        "course_id",
        "id",
    ):
        op.drop_index(
            f"ix_course_join_requests_{column_name}",
            table_name="course_join_requests",
        )
    op.drop_table("course_join_requests")

    op.drop_index(
        "ix_course_admission_classes_course_status_id",
        table_name="course_admission_classes",
    )
    op.drop_index(
        "ix_course_admission_classes_class_id",
        table_name="course_admission_classes",
    )
    op.drop_index(
        "ix_course_admission_classes_course_id",
        table_name="course_admission_classes",
    )
    op.drop_index(
        "ix_course_admission_classes_id",
        table_name="course_admission_classes",
    )
    op.drop_table("course_admission_classes")

    with op.batch_alter_table("courses") as batch_op:
        batch_op.drop_constraint(
            "fk_courses_current_information_revision_id",
            type_="foreignkey",
        )
        batch_op.drop_index("ix_courses_current_information_revision_id")
        batch_op.drop_column("current_information_revision_id")

    op.drop_index(
        "ix_course_info_revisions_course_status_id",
        table_name="course_information_revisions",
    )
    op.drop_index(
        "ix_course_information_revisions_reviewed_by_user_id",
        table_name="course_information_revisions",
    )
    op.drop_index(
        "ix_course_information_revisions_created_by_user_id",
        table_name="course_information_revisions",
    )
    op.drop_index(
        "ix_course_information_revisions_course_id",
        table_name="course_information_revisions",
    )
    op.drop_index(
        "ix_course_information_revisions_id",
        table_name="course_information_revisions",
    )
    op.drop_table("course_information_revisions")

    with op.batch_alter_table("courses") as batch_op:
        batch_op.drop_constraint("ck_courses_total_hours_positive", type_="check")
        batch_op.drop_constraint("ck_courses_admission_mode", type_="check")
        batch_op.drop_constraint("uq_courses_course_code", type_="unique")
        batch_op.drop_column("admission_mode")
        batch_op.drop_column("total_hours")
        batch_op.drop_column("schedule_text")
        batch_op.drop_column("academic_year")
        batch_op.drop_column("course_code")
