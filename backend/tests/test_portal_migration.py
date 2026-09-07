from datetime import UTC, datetime

from alembic import command
from sqlalchemy import create_engine, inspect, text

from test_content_platform_storage import (
    _insert_0056_approved_course, _migration_config, _reset_migration_environment,
)


def test_portal_migration_preserves_existing_revision_and_roundtrips(tmp_path, monkeypatch):
    url = f"sqlite+pysqlite:///{(tmp_path / 'portal.db').as_posix()}"
    config = _migration_config(url, monkeypatch)
    engine = create_engine(url)
    try:
        command.upgrade(config, "20260825_0058")
        _insert_0056_approved_course(engine)
        with engine.begin() as connection:
            connection.execute(text(
                "INSERT INTO course_information_revisions "
                "(id, course_id, revision_number, information_snapshot, teacher_ids_snapshot, status, created_by_user_id, created_at, updated_at) "
                "VALUES (1, 1, 1, :snapshot, '[1]', 'draft', 1, :now, :now)"
            ), {"snapshot": '{"title":"Existing course"}', "now": datetime.now(UTC).isoformat()})
        command.upgrade(config, "20260907_0059")
        assert "user_notes" in inspect(engine).get_table_names()
        with engine.connect() as connection:
            row = connection.execute(text("SELECT edit_revision, information_snapshot FROM course_information_revisions WHERE id=1")).one()
            assert row[0] == 1 and "Existing course" in row[1]
        command.downgrade(config, "20260825_0058")
        assert "user_notes" not in inspect(engine).get_table_names()
        assert "edit_revision" not in {column["name"] for column in inspect(engine).get_columns("course_information_revisions")}
        command.upgrade(config, "20260907_0059")
        with engine.connect() as connection:
            assert connection.execute(text("SELECT edit_revision FROM course_information_revisions WHERE id=1")).scalar_one() == 1
    finally:
        engine.dispose()
        _reset_migration_environment()
