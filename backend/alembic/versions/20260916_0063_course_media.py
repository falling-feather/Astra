"""Add immutable course media and provenance-preserving reuse grants."""
from alembic import op
import sqlalchemy as sa

revision = "20260916_0063"
down_revision = "20260916_0062"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("course_media_assets",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("asset_key", sa.String(120), nullable=False),
        sa.Column("school_id", sa.Integer(), sa.ForeignKey("schools.id"), nullable=False),
        sa.Column("source_course_id", sa.Integer(), sa.ForeignKey("courses.id"), nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("client_request_id", sa.String(128), nullable=False),
        sa.Column("filename", sa.String(180), nullable=False),
        sa.Column("media_type", sa.String(16), nullable=False),
        sa.Column("content_type", sa.String(80), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("content_sha256", sa.String(64), nullable=False),
        sa.Column("content_bytes", sa.LargeBinary(length=16_777_215), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("asset_key", name="uq_course_media_asset_key"),
        sa.UniqueConstraint("created_by_user_id", "client_request_id", name="uq_course_media_request"))
    op.create_index("ix_course_media_assets_school_id", "course_media_assets", ["school_id"])
    op.create_index("ix_course_media_assets_source_course_id", "course_media_assets", ["source_course_id"])
    op.create_table("course_media_grants",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("course_id", sa.Integer(), sa.ForeignKey("courses.id"), nullable=False),
        sa.Column("asset_id", sa.Integer(), sa.ForeignKey("course_media_assets.id"), nullable=False),
        sa.Column("granted_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("course_id", "asset_id", name="uq_course_media_grant"))
    op.create_index("ix_course_media_grants_course_id", "course_media_grants", ["course_id"])
    op.create_index("ix_course_media_grants_asset_id", "course_media_grants", ["asset_id"])


def downgrade():
    if op.get_context().as_sql or op.get_bind().execute(sa.text("SELECT COUNT(*) FROM course_media_assets")).scalar_one():
        raise RuntimeError("Cannot downgrade stored course media; preserve the assets and references")
    op.drop_table("course_media_grants")
    op.drop_table("course_media_assets")
