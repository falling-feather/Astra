"""add shared course drafts and immutable course releases

Revision ID: 20260825_0057
Revises: 20260825_0056
Create Date: 2026-08-25
"""

import sqlalchemy as sa
from alembic import op

revision = "20260825_0057"
down_revision = "20260825_0056"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("courses") as batch_op:
        batch_op.add_column(
            sa.Column(
                "content_draft_revision",
                sa.Integer(),
                nullable=False,
                server_default=sa.text("0"),
            )
        )

    with op.batch_alter_table("content_drafts") as batch_op:
        batch_op.add_column(sa.Column("course_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("course_unit_id", sa.Integer(), nullable=True))
        batch_op.add_column(
            sa.Column(
                "revision", sa.Integer(), nullable=False, server_default=sa.text("0")
            )
        )
        batch_op.create_foreign_key(
            "fk_content_drafts_course_id_courses",
            "courses",
            ["course_id"],
            ["id"],
        )
        batch_op.create_foreign_key(
            "fk_content_drafts_course_unit_id_course_units",
            "course_units",
            ["course_unit_id"],
            ["id"],
        )
        batch_op.create_index(
            "ix_content_drafts_course_id", ["course_id"], unique=False
        )
        batch_op.create_index(
            "ix_content_drafts_course_unit_id", ["course_unit_id"], unique=False
        )
        batch_op.create_unique_constraint(
            "uq_content_drafts_active_course_unit",
            ["course_unit_id", "active_key"],
        )

    op.create_table(
        "course_releases",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("course_id", sa.Integer(), nullable=False),
        sa.Column("release_number", sa.Integer(), nullable=False),
        sa.Column("draft_revision", sa.Integer(), nullable=False),
        sa.Column("schema_version", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("title_snapshot", sa.String(length=180), nullable=False),
        sa.Column("summary_snapshot", sa.Text(), nullable=True),
        sa.Column("completion_rule_id", sa.Integer(), nullable=True),
        sa.Column("completion_rule_sha256", sa.String(length=64), nullable=False),
        sa.Column("completion_rule_snapshot", sa.JSON(), nullable=False),
        sa.Column("package_sha256", sa.String(length=64), nullable=False),
        sa.Column("published_by_user_id", sa.Integer(), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "draft_revision >= 0", name="ck_course_releases_draft_revision"
        ),
        sa.CheckConstraint(
            "release_number > 0", name="ck_course_releases_number_positive"
        ),
        sa.CheckConstraint("status = 'published'", name="ck_course_releases_published"),
        sa.ForeignKeyConstraint(
            ["completion_rule_id"], ["learning_completion_rules.id"]
        ),
        sa.ForeignKeyConstraint(["course_id"], ["courses.id"]),
        sa.ForeignKeyConstraint(["published_by_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "course_id", "package_sha256", name="uq_course_releases_course_hash"
        ),
        sa.UniqueConstraint(
            "course_id", "release_number", name="uq_course_releases_course_number"
        ),
    )
    for column_name in (
        "id",
        "course_id",
        "completion_rule_id",
        "published_by_user_id",
    ):
        op.create_index(
            f"ix_course_releases_{column_name}",
            "course_releases",
            [column_name],
            unique=False,
        )
    op.create_index(
        "ix_course_releases_course_published",
        "course_releases",
        ["course_id", "published_at", "id"],
        unique=False,
    )

    op.create_table(
        "course_release_units",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("course_release_id", sa.Integer(), nullable=False),
        sa.Column("source_course_unit_id", sa.Integer(), nullable=False),
        sa.Column("activity_key", sa.String(length=120), nullable=False),
        sa.Column("title_snapshot", sa.String(length=180), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("content_slug", sa.String(length=180), nullable=False),
        sa.Column("content_page_version_id", sa.Integer(), nullable=False),
        sa.Column("content_schema_sha256", sa.String(length=64), nullable=False),
        sa.Column("media_snapshot_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "position > 0", name="ck_course_release_units_position_positive"
        ),
        sa.ForeignKeyConstraint(
            ["content_page_version_id"], ["content_page_versions.id"]
        ),
        sa.ForeignKeyConstraint(["course_release_id"], ["course_releases.id"]),
        sa.ForeignKeyConstraint(["source_course_unit_id"], ["course_units.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "course_release_id",
            "activity_key",
            name="uq_course_release_units_release_activity",
        ),
        sa.UniqueConstraint(
            "course_release_id",
            "position",
            name="uq_course_release_units_release_position",
        ),
        sa.UniqueConstraint(
            "course_release_id",
            "source_course_unit_id",
            name="uq_course_release_units_release_source",
        ),
    )
    for column_name in (
        "id",
        "course_release_id",
        "source_course_unit_id",
        "content_page_version_id",
    ):
        op.create_index(
            f"ix_course_release_units_{column_name}",
            "course_release_units",
            [column_name],
            unique=False,
        )
    op.create_index(
        "ix_course_release_units_release_order",
        "course_release_units",
        ["course_release_id", "position", "id"],
        unique=False,
    )

    op.create_table(
        "course_class_release_bindings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("course_class_id", sa.Integer(), nullable=False),
        sa.Column("course_release_id", sa.Integer(), nullable=False),
        sa.Column("binding_revision", sa.Integer(), nullable=False),
        sa.Column("previous_binding_id", sa.Integer(), nullable=True),
        sa.Column("bound_by_user_id", sa.Integer(), nullable=False),
        sa.Column("binding_reason", sa.String(length=240), nullable=True),
        sa.Column("bound_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "binding_revision > 0",
            name="ck_course_class_release_binding_revision_positive",
        ),
        sa.ForeignKeyConstraint(["bound_by_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["course_class_id"], ["course_classes.id"]),
        sa.ForeignKeyConstraint(["course_release_id"], ["course_releases.id"]),
        sa.ForeignKeyConstraint(
            ["previous_binding_id"], ["course_class_release_bindings.id"]
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "course_class_id",
            "binding_revision",
            name="uq_course_class_release_binding_revision",
        ),
        sa.UniqueConstraint(
            "previous_binding_id",
            name="uq_course_class_release_binding_previous",
        ),
    )
    for column_name in (
        "id",
        "course_class_id",
        "course_release_id",
        "previous_binding_id",
        "bound_by_user_id",
    ):
        op.create_index(
            f"ix_course_class_release_bindings_{column_name}",
            "course_class_release_bindings",
            [column_name],
            unique=False,
        )
    op.create_index(
        "ix_course_class_release_binding_current",
        "course_class_release_bindings",
        ["course_class_id", "binding_revision", "id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_course_class_release_binding_current",
        table_name="course_class_release_bindings",
    )
    for column_name in (
        "bound_by_user_id",
        "previous_binding_id",
        "course_release_id",
        "course_class_id",
        "id",
    ):
        op.drop_index(
            f"ix_course_class_release_bindings_{column_name}",
            table_name="course_class_release_bindings",
        )
    op.drop_table("course_class_release_bindings")

    op.drop_index(
        "ix_course_release_units_release_order", table_name="course_release_units"
    )
    for column_name in (
        "content_page_version_id",
        "source_course_unit_id",
        "course_release_id",
        "id",
    ):
        op.drop_index(
            f"ix_course_release_units_{column_name}",
            table_name="course_release_units",
        )
    op.drop_table("course_release_units")

    op.drop_index("ix_course_releases_course_published", table_name="course_releases")
    for column_name in (
        "published_by_user_id",
        "completion_rule_id",
        "course_id",
        "id",
    ):
        op.drop_index(
            f"ix_course_releases_{column_name}",
            table_name="course_releases",
        )
    op.drop_table("course_releases")

    with op.batch_alter_table("content_drafts") as batch_op:
        batch_op.drop_constraint("uq_content_drafts_active_course_unit", type_="unique")
        batch_op.drop_index("ix_content_drafts_course_unit_id")
        batch_op.drop_index("ix_content_drafts_course_id")
        batch_op.drop_constraint(
            "fk_content_drafts_course_unit_id_course_units", type_="foreignkey"
        )
        batch_op.drop_constraint(
            "fk_content_drafts_course_id_courses", type_="foreignkey"
        )
        batch_op.drop_column("revision")
        batch_op.drop_column("course_unit_id")
        batch_op.drop_column("course_id")

    with op.batch_alter_table("courses") as batch_op:
        batch_op.drop_column("content_draft_revision")
