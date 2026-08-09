"""separate code revisions from request replay

Revision ID: 20260809_0052
Revises: 20260727_0051
Create Date: 2026-08-09
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import mysql


revision = "20260809_0052"
down_revision = "20260727_0051"
branch_labels = None
depends_on = None

_BACKFILL_BATCH_SIZE = 1000
_OLD_UNIQUE = "uq_code_submissions_student_version_class"
_NEW_UNIQUE = "uq_code_submissions_actor_scope_client"


def _client_submission_id_type(dialect_name: str | None = None):
    active_dialect = dialect_name or op.get_bind().dialect.name
    if active_dialect == "mysql":
        return mysql.VARCHAR(length=128, charset="ascii", collation="ascii_bin")
    return sa.String(length=128)


def _submission_table():
    return sa.table(
        "code_submissions",
        sa.column("id", sa.Integer()),
        sa.column("student_id", sa.Integer()),
        sa.column("problem_id", sa.Integer()),
        sa.column("problem_version_id", sa.Integer()),
        sa.column("class_id", sa.Integer()),
        sa.column("client_submission_id", _client_submission_id_type()),
    )


def upgrade() -> None:
    client_id_type = _client_submission_id_type()
    op.add_column(
        "code_submissions",
        sa.Column("client_submission_id", client_id_type, nullable=True),
    )

    bind = op.get_bind()
    submissions = _submission_table()
    last_id = 0
    while True:
        ids = list(
            bind.scalars(
                sa.select(submissions.c.id)
                .where(submissions.c.id > last_id)
                .order_by(submissions.c.id)
                .limit(_BACKFILL_BATCH_SIZE)
            )
        )
        if not ids:
            break
        bind.execute(
            submissions.update()
            .where(submissions.c.id == sa.bindparam("_submission_id"))
            .values(client_submission_id=sa.bindparam("_client_submission_id")),
            [
                {
                    "_submission_id": submission_id,
                    "_client_submission_id": f"legacy:{submission_id}",
                }
                for submission_id in ids
            ],
        )
        last_id = int(ids[-1])

    with op.batch_alter_table("code_submissions") as batch_op:
        batch_op.drop_constraint(_OLD_UNIQUE, type_="unique")
        batch_op.alter_column(
            "client_submission_id",
            existing_type=client_id_type,
            nullable=False,
        )
        batch_op.create_unique_constraint(
            _NEW_UNIQUE,
            ["student_id", "problem_id", "class_id", "client_submission_id"],
        )


def downgrade() -> None:
    bind = op.get_bind()
    submissions = _submission_table()
    duplicate_revision_scope = bind.execute(
        sa.select(
            submissions.c.student_id,
            submissions.c.problem_version_id,
            submissions.c.class_id,
            sa.func.count().label("revision_count"),
        )
        .group_by(
            submissions.c.student_id,
            submissions.c.problem_version_id,
            submissions.c.class_id,
        )
        .having(sa.func.count() > 1)
        .limit(1)
    ).first()
    if duplicate_revision_scope is not None:
        raise RuntimeError(
            "cannot downgrade BE-014 while multiple code revisions share the legacy "
            "student/problem-version/class scope"
        )

    client_id_type = _client_submission_id_type()
    with op.batch_alter_table("code_submissions") as batch_op:
        batch_op.drop_constraint(_NEW_UNIQUE, type_="unique")
        batch_op.create_unique_constraint(
            _OLD_UNIQUE,
            ["student_id", "problem_version_id", "class_id"],
        )
        batch_op.drop_column("client_submission_id", existing_type=client_id_type)
