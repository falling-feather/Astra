"""Separate editable course settings and share immutable workflow receipts."""
from alembic import op
import sqlalchemy as sa

revision = "20260916_0062"
down_revision = "20260916_0061"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("courses") as batch:
        batch.add_column(sa.Column("workflow_generation", sa.Integer(), server_default="1", nullable=False))
        batch.add_column(sa.Column("draft_settings_json", sa.JSON(), nullable=True))
        batch.add_column(sa.Column("level_key", sa.String(32), nullable=True))
        batch.add_column(sa.Column("source_revision_id", sa.Integer(), nullable=True))
        batch.create_foreign_key("fk_courses_source_revision", "course_revisions", ["source_revision_id"], ["id"])
    with op.batch_alter_table("course_candidates") as batch:
        batch.add_column(sa.Column("dependencies_json", sa.JSON(), nullable=True))
    op.rename_table("course_publication_operations", "course_workflow_operations")
    with op.batch_alter_table("course_workflow_operations") as batch:
        batch.add_column(sa.Column("operation_kind", sa.String(48), server_default="publish", nullable=False))
        batch.add_column(sa.Column("scope_json", sa.JSON(), nullable=True))
    op.execute("UPDATE course_workflow_operations SET scope_json = '{}'")
    with op.batch_alter_table("course_workflow_operations") as batch:
        batch.alter_column("scope_json", existing_type=sa.JSON(), nullable=False)


def downgrade():
    if op.get_context().as_sql:
        raise RuntimeError("Course authoring downgrade requires an online data check")
    connection = op.get_bind()
    if connection.execute(sa.text("SELECT COUNT(*) FROM courses WHERE workflow_generation <> 1 OR draft_settings_json IS NOT NULL OR level_key IS NOT NULL OR source_revision_id IS NOT NULL")).scalar_one():
        raise RuntimeError("Cannot downgrade authored v2 courses without losing their draft settings")
    if connection.execute(sa.text("SELECT COUNT(*) FROM course_workflow_operations WHERE operation_kind <> 'publish'")).scalar_one():
        raise RuntimeError("Cannot downgrade non-publication workflow receipts")
    if connection.execute(sa.text("SELECT COUNT(*) FROM course_candidates WHERE dependencies_json IS NOT NULL")).scalar_one():
        raise RuntimeError("Cannot downgrade frozen candidate dependencies")
    with op.batch_alter_table("course_workflow_operations") as batch:
        batch.drop_column("scope_json")
        batch.drop_column("operation_kind")
    op.rename_table("course_workflow_operations", "course_publication_operations")
    with op.batch_alter_table("course_candidates") as batch:
        batch.drop_column("dependencies_json")
    with op.batch_alter_table("courses") as batch:
        batch.drop_constraint("fk_courses_source_revision", type_="foreignkey")
        batch.drop_column("source_revision_id")
        batch.drop_column("level_key")
        batch.drop_column("draft_settings_json")
        batch.drop_column("workflow_generation")
