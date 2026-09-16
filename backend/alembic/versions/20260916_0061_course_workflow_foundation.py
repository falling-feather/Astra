"""Add independent resource versions, course lineage and review snapshots.

Existing courses become independent roots; migration never guesses common
authorship from a title and never invents approval for a historical release.
"""

from alembic import op
import sqlalchemy as sa

revision = "20260916_0061"
down_revision = "20260908_0060"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "learning_resources",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("resource_key", sa.String(120), nullable=False, unique=True),
        sa.Column("space_key", sa.String(32), nullable=False),
        sa.Column("subject_key", sa.String(96), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("kind IN ('activity', 'template', 'media')", name="ck_learning_resource_kind"),
        sa.CheckConstraint("status IN ('active', 'retired')", name="ck_learning_resource_status"),
    )
    op.create_index("ix_learning_resources_space_subject", "learning_resources", ["space_key", "subject_key", "status"])
    op.create_table(
        "learning_resource_versions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("resource_id", sa.Integer(), sa.ForeignKey("learning_resources.id"), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(240), nullable=False),
        sa.Column("renderer", sa.String(64), nullable=False),
        sa.Column("definition_json", sa.JSON(), nullable=False),
        sa.Column("capabilities_json", sa.JSON(), nullable=False),
        sa.Column("provenance_json", sa.JSON(), nullable=False),
        sa.Column("content_sha256", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("resource_id", "version_number", name="uq_resource_versions_number"),
        sa.UniqueConstraint("resource_id", "content_sha256", name="uq_resource_versions_hash"),
        sa.CheckConstraint("version_number > 0", name="ck_resource_versions_number"),
    )
    op.create_index("ix_learning_resource_versions_resource_id", "learning_resource_versions", ["resource_id"])
    op.create_table(
        "course_families",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("family_key", sa.String(36), nullable=False, unique=True),
        sa.Column("school_id", sa.Integer(), sa.ForeignKey("schools.id"), nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_course_families_school_id", "course_families", ["school_id"])
    op.create_table(
        "course_revisions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("course_id", sa.Integer(), sa.ForeignKey("courses.id"), nullable=False),
        sa.Column("revision_number", sa.Integer(), nullable=False),
        sa.Column("snapshot_json", sa.JSON(), nullable=False),
        sa.Column("content_sha256", sa.String(64), nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("course_id", "revision_number", name="uq_course_revisions_number"),
        sa.CheckConstraint("revision_number >= 0", name="ck_course_revisions_number"),
    )
    op.create_index("ix_course_revisions_course_created", "course_revisions", ["course_id", "created_at", "id"])
    op.create_table(
        "course_change_batches",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("school_id", sa.Integer(), sa.ForeignKey("schools.id"), nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("client_request_id", sa.String(128), nullable=False),
        sa.Column("request_sha256", sa.String(64), nullable=False),
        sa.Column("source_revision_id", sa.Integer(), sa.ForeignKey("course_revisions.id"), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("created_by_user_id", "client_request_id", name="uq_course_batches_request"),
    )
    op.create_index("ix_course_batches_school_created", "course_change_batches", ["school_id", "created_at", "id"])
    op.create_table(
        "course_candidates",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("batch_id", sa.Integer(), sa.ForeignKey("course_change_batches.id"), nullable=False),
        sa.Column("course_id", sa.Integer(), sa.ForeignKey("courses.id"), nullable=False),
        sa.Column("revision_id", sa.Integer(), sa.ForeignKey("course_revisions.id"), nullable=False),
        sa.Column("base_release_id", sa.Integer(), sa.ForeignKey("course_releases.id"), nullable=True),
        sa.Column("result_policy_json", sa.JSON(), nullable=False),
        sa.Column("impact_json", sa.JSON(), nullable=False),
        sa.Column("candidate_sha256", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("batch_id", "course_id", name="uq_course_candidates_batch_course"),
    )
    op.create_index("ix_course_candidates_course_id", "course_candidates", ["course_id", "id"])
    op.create_table(
        "course_review_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("candidate_id", sa.Integer(), sa.ForeignKey("course_candidates.id"), nullable=False),
        sa.Column("course_id", sa.Integer(), sa.ForeignKey("courses.id"), nullable=False),
        sa.Column("school_id", sa.Integer(), sa.ForeignKey("schools.id"), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("active_key", sa.String(16), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("reviewed_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("review_note", sa.Text(), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("candidate_id", name="uq_course_reviews_candidate"),
        sa.UniqueConstraint("course_id", "active_key", name="uq_course_reviews_active"),
        sa.CheckConstraint("status IN ('submitted', 'approved', 'rejected', 'withdrawn')", name="ck_course_review_status"),
        sa.CheckConstraint("version > 0", name="ck_course_review_version"),
        sa.CheckConstraint("(status = 'submitted' AND active_key IS NOT NULL AND active_key = 'pending') OR (status <> 'submitted' AND active_key IS NULL)", name="ck_course_review_active"),
    )
    op.create_index("ix_course_reviews_school_status", "course_review_items", ["school_id", "status", "id"])
    op.create_table(
        "course_publication_operations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("actor_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("client_request_id", sa.String(128), nullable=False),
        sa.Column("request_sha256", sa.String(64), nullable=False),
        sa.Column("receipt_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("actor_user_id", "client_request_id", name="uq_publication_operations_request"),
    )

    with op.batch_alter_table("courses") as batch:
        batch.add_column(sa.Column("family_id", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("source_course_id", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("source_release_id", sa.Integer(), nullable=True))
        batch.create_foreign_key("fk_courses_family", "course_families", ["family_id"], ["id"])
        batch.create_foreign_key("fk_courses_source_course", "courses", ["source_course_id"], ["id"])
        batch.create_foreign_key("fk_courses_source_release", "course_releases", ["source_release_id"], ["id"])
        batch.create_index("ix_courses_family_id", ["family_id"])
    with op.batch_alter_table("course_units") as batch:
        batch.add_column(sa.Column("origin_key", sa.String(120), nullable=True))
        batch.add_column(sa.Column("block_origins_json", sa.JSON(), nullable=True))
        batch.add_column(sa.Column("resource_version_id", sa.Integer(), nullable=True))
        batch.create_foreign_key("fk_course_units_resource_version", "learning_resource_versions", ["resource_version_id"], ["id"])
        batch.create_unique_constraint("uq_course_units_course_origin", ["course_id", "origin_key"])
    with op.batch_alter_table("course_releases") as batch:
        batch.add_column(sa.Column("candidate_id", sa.Integer(), nullable=True))
        batch.create_foreign_key("fk_course_releases_candidate", "course_candidates", ["candidate_id"], ["id"])
        batch.create_unique_constraint("uq_course_releases_candidate_id", ["candidate_id"])

    courses = sa.table("courses", sa.column("id", sa.Integer()), sa.column("school_id", sa.Integer()), sa.column("creator_user_id", sa.Integer()), sa.column("family_id", sa.Integer()))
    families = sa.table("course_families", sa.column("id", sa.Integer()), sa.column("family_key", sa.String()), sa.column("school_id", sa.Integer()), sa.column("created_by_user_id", sa.Integer()), sa.column("created_at", sa.DateTime()))
    op.execute(families.insert().from_select(
        ["id", "family_key", "school_id", "created_by_user_id", "created_at"],
        sa.select(courses.c.id, sa.literal("legacy-course-") + sa.cast(courses.c.id, sa.String()), courses.c.school_id, courses.c.creator_user_id, sa.func.current_timestamp()),
    ))
    op.execute(courses.update().values(family_id=courses.c.id))
    units = sa.table("course_units", sa.column("id", sa.Integer()), sa.column("origin_key", sa.String()))
    op.execute(units.update().values(origin_key=sa.literal("legacy-unit-") + sa.cast(units.c.id, sa.String())))
    op.execute("UPDATE course_units SET block_origins_json = '{}'")
    with op.batch_alter_table("course_units") as batch:
        batch.alter_column("origin_key", existing_type=sa.String(120), nullable=False)
        batch.alter_column("block_origins_json", existing_type=sa.JSON(), nullable=False)


def downgrade():
    # A rollback must not silently discard content or approval facts created by v2.
    if op.get_context().as_sql:
        raise RuntimeError("Workflow downgrade requires an online data-preservation check")
    connection = op.get_bind()
    for table in ("learning_resources", "course_revisions", "course_change_batches", "course_publication_operations"):
        if connection.execute(sa.text(f"SELECT COUNT(*) FROM {table}")).scalar_one():
            raise RuntimeError("Cannot downgrade populated v2 workflow: preserve the database and restore a compatible backup")
    if connection.execute(sa.text("SELECT COUNT(*) FROM courses WHERE source_course_id IS NOT NULL OR source_release_id IS NOT NULL")).scalar_one():
        raise RuntimeError("Cannot downgrade derived courses without losing their lineage")
    with op.batch_alter_table("course_releases") as batch:
        batch.drop_constraint("uq_course_releases_candidate_id", type_="unique")
        batch.drop_constraint("fk_course_releases_candidate", type_="foreignkey")
        batch.drop_column("candidate_id")
    with op.batch_alter_table("course_units") as batch:
        batch.drop_constraint("uq_course_units_course_origin", type_="unique")
        batch.drop_constraint("fk_course_units_resource_version", type_="foreignkey")
        batch.drop_column("resource_version_id")
        batch.drop_column("block_origins_json")
        batch.drop_column("origin_key")
    with op.batch_alter_table("courses") as batch:
        batch.drop_index("ix_courses_family_id")
        batch.drop_constraint("fk_courses_family", type_="foreignkey")
        batch.drop_constraint("fk_courses_source_course", type_="foreignkey")
        batch.drop_constraint("fk_courses_source_release", type_="foreignkey")
        batch.drop_column("source_release_id")
        batch.drop_column("source_course_id")
        batch.drop_column("family_id")
    for table in ("course_publication_operations", "course_review_items", "course_candidates", "course_change_batches", "course_revisions", "course_families", "learning_resource_versions", "learning_resources"):
        op.drop_table(table)
