"""Repair publication status independently of removed shared-draft membership."""
from alembic import op
import sqlalchemy as sa

revision = "20260908_0060"
down_revision = "20260907_0059"
branch_labels = None
depends_on = None

CURRENT_UNITS = """
SELECT ru.source_course_unit_id
FROM course_release_units ru
JOIN course_releases r ON r.id = ru.course_release_id
JOIN (SELECT course_id, MAX(release_number) AS latest FROM course_releases GROUP BY course_id) current_release
ON current_release.course_id = r.course_id AND current_release.latest = r.release_number
"""


def upgrade():
    op.execute(sa.text(f"UPDATE course_units SET status='published' WHERE id IN ({CURRENT_UNITS})"))


def downgrade():
    # Reconstruct the prior representation of removed drafts for older code.
    # Immutable content, release packages and all learning records stay intact.
    op.execute(sa.text(f"""
UPDATE course_units SET status='archived' WHERE id IN ({CURRENT_UNITS})
AND EXISTS (SELECT 1 FROM content_drafts d WHERE d.course_unit_id=course_units.id)
AND NOT EXISTS (SELECT 1 FROM content_drafts d WHERE d.course_unit_id=course_units.id AND d.active_key='shared')
"""))
