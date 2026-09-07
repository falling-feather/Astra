from alembic import command
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app.main import create_app
from test_content_platform_api import _auth, _completed_workbench_course
from test_content_platform_storage import _migration_config, _reset_migration_environment


def test_status_repair_keeps_withdrawn_drafts_and_published_learning_records(tmp_path, monkeypatch):
    monkeypatch.setenv("ASTRA_ALLOW_LEGACY_LOCAL_BOOTSTRAP", "true")
    url = f"sqlite+pysqlite:///{(tmp_path / 'published-status.db').as_posix()}"
    config = _migration_config(url, monkeypatch)
    engine = create_engine(url)
    try:
        command.upgrade(config, "20260907_0059")
        with TestClient(create_app()) as client:
            scope = _completed_workbench_course(client, "repair_status")
            unit_id, course_id = scope["unit_id"], scope["course_id"]
            with engine.begin() as connection:
                connection.execute(text("UPDATE course_units SET status='archived' WHERE id=:id"), {"id": unit_id})
                connection.execute(text("UPDATE content_drafts SET status='withdrawn', active_key=NULL WHERE course_unit_id=:id"), {"id": unit_id})
                evidence_count = connection.execute(text("SELECT COUNT(*) FROM learning_evidence_events")).scalar_one()
            command.upgrade(config, "20260908_0060")
            draft = client.get(f"/api/v1/courses/{course_id}/draft", headers=_auth(scope["owner"]["token"]))
            assert draft.status_code == 200 and draft.json()["units"] == []
            current = client.get(f"/api/v1/courses/{course_id}/releases/current", headers=_auth(scope["student"]["token"]))
            assert current.status_code == 200
            assert current.json()["release"]["units"][0]["source_course_unit_id"] == unit_id
            for target, expected in [("20260907_0059", "archived"), ("20260908_0060", "published")]:
                if expected == "archived":
                    command.downgrade(config, target)
                else:
                    command.upgrade(config, target)
                with engine.connect() as connection:
                    assert connection.execute(text("SELECT status FROM course_units WHERE id=:id"), {"id": unit_id}).scalar_one() == expected
                    assert connection.execute(text("SELECT COUNT(*) FROM learning_evidence_events")).scalar_one() == evidence_count
                    assert connection.execute(text("SELECT COUNT(*) FROM course_releases")).scalar_one() == 1
    finally:
        engine.dispose()
        _reset_migration_environment()
