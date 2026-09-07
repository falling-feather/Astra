"""Add owned notes and information-draft revisions for the formal portal."""
import sqlalchemy as sa
from alembic import op

revision = "20260907_0059"
down_revision = "20260825_0058"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("course_information_revisions", sa.Column("edit_revision", sa.Integer(), nullable=False, server_default="1"))
    op.create_table("user_notes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(180), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False))
    op.create_index("ix_user_notes_user_id", "user_notes", ["user_id"])


def downgrade():
    op.drop_index("ix_user_notes_user_id", table_name="user_notes")
    op.drop_table("user_notes")
    op.drop_column("course_information_revisions", "edit_revision")
