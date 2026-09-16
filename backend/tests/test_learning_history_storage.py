from datetime import UTC, datetime, timedelta

import pytest
from alembic import command
from sqlalchemy import MetaData, Table, create_engine, inspect, select, text

from test_content_platform_storage import _insert_0056_approved_course, _migration_config, _reset_migration_environment


@pytest.fixture()
def database(tmp_path, monkeypatch):
    url = f"sqlite+pysqlite:///{(tmp_path / 'history.db').as_posix()}"
    config = _migration_config(url, monkeypatch)
    engine = create_engine(url)
    try:
        yield config, engine
    finally:
        engine.dispose()
        _reset_migration_environment()


def test_empty_history_migration_roundtrip(database):
    config, engine = database
    for _ in range(2):
        command.upgrade(config, "head")
        assert "learning_contexts" in inspect(engine).get_table_names()
        assert "current_attempt_id" in {column["name"] for column in inspect(engine).get_columns("submissions")}
        command.downgrade(config, "20260916_0063")
        assert "learning_results" not in inspect(engine).get_table_names()


def test_legacy_audited_scores_are_retained_without_inventing_versions_or_feedback(database):
    config, engine = database
    command.upgrade(config, "20260908_0060")
    _insert_0056_approved_course(engine)
    command.upgrade(config, "20260916_0063")
    metadata = MetaData()
    names = ["users", "course_units", "assignments", "submissions", "audit_logs"]
    table = {name: Table(name, metadata, autoload_with=engine) for name in names}
    moment = datetime(2026, 9, 1, 12, 0, tzinfo=UTC)
    with engine.begin() as connection:
        connection.execute(table["users"].insert().values(id=2, username="history_student", normalized_username="history_student", display_name="历史学生", password_hash="fixture", role="student", status="active", created_at=moment, updated_at=moment))
        connection.execute(table["course_units"].insert().values(id=1, course_id=1, activity_key="physics.mechanics", title="历史单元", position=1, status="published", origin_key="legacy-unit-1", block_origins_json={}, created_at=moment, updated_at=moment))
        connection.execute(table["assignments"].insert().values(id=1, unit_id=1, title="旧作业", description="原题目", max_score=100, status="active", audience_mode="all_attached_classes", created_at=moment, updated_at=moment))
        connection.execute(table["submissions"].insert().values(id=1, assignment_id=1, student_id=2, class_id=1, content={"answer":"原提交"}, status="graded", score=85, feedback="最终保留的反馈", graded_by_user_id=1, submitted_at=moment, graded_at=moment+timedelta(hours=2), created_at=moment, updated_at=moment+timedelta(hours=2)))
        for index, score in enumerate([60, 85], 1):
            connection.execute(table["audit_logs"].insert().values(id=index, actor_user_id=1, actor_role="teacher", action="submission.grade", resource="submission:1", resource_type="submission", resource_id="1", school_id=1, class_id=1, event_result="success", snapshot_json={"after":{"status":"graded","score":score,"feedback":{"redacted":True},"graded_by_user_id":1}}, created_at=moment+timedelta(hours=index), updated_at=moment+timedelta(hours=index)))
    for _ in range(2):
        command.upgrade(config, "head")
        current = MetaData()
        attempts = Table("assignment_attempts", current, autoload_with=engine)
        grades = Table("assignment_grades", current, autoload_with=engine)
        with engine.connect() as connection:
            attempt = connection.execute(select(attempts)).mappings().one()
            assert attempt["content_json"] == {"answer":"原提交"}
            assert attempt["course_release_id"] is None and attempt["context_id"] is None
            history = connection.execute(select(grades).order_by(grades.c.revision)).mappings().all()
            assert [grade["score"] for grade in history] == [60, 85]
            assert all(grade["max_score"] is None for grade in history)
            assert history[0]["feedback"] is None and not history[0]["feedback_retained"]
            assert history[0]["graded_at"] is None
            assert history[1]["feedback"] == "最终保留的反馈" and history[1]["feedback_retained"]
            assert connection.execute(text("SELECT score FROM submissions WHERE id=1")).scalar_one() == 85
        command.downgrade(config, "20260916_0063")
        with engine.connect() as connection:
            assert connection.execute(text("SELECT COUNT(*) FROM audit_logs")).scalar_one() == 2
            assert connection.execute(text("SELECT feedback FROM submissions WHERE id=1")).scalar_one() == "最终保留的反馈"


def test_history_downgrade_refuses_new_published_result_contract(database):
    config, engine = database
    command.upgrade(config, "20260908_0060")
    _insert_0056_approved_course(engine)
    command.upgrade(config, "head")
    moment = datetime.now(UTC)
    releases = Table("course_releases", MetaData(), autoload_with=engine)
    with engine.begin() as connection:
        connection.execute(releases.insert().values(course_id=1, release_number=1, draft_revision=0, result_contract_version=2, schema_version="fixture", status="published", title_snapshot="新结果契约", completion_rule_sha256="a"*64, completion_rule_snapshot={}, package_sha256="b"*64, published_by_user_id=1, published_at=moment, created_at=moment))
    with pytest.raises(RuntimeError, match="Cannot downgrade new learning histories"):
        command.downgrade(config, "20260916_0063")
    assert "learning_contexts" in inspect(engine).get_table_names()
