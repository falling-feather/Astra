from datetime import UTC, datetime
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from app.core.config import get_settings
from app.db.session import reset_database_state
from app.models import (
    ContentDraft,
    Course,
    CourseClassReleaseBinding,
    CourseRelease,
    CourseReleaseUnit,
)
from app.models import content_platform as publication_models
from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.dialects import mysql
from sqlalchemy.schema import CreateTable

PUBLICATION_TABLES = {
    "course_releases",
    "course_release_units",
    "course_class_release_bindings",
}


def test_publication_models_match_the_be027_architecture_and_mysql():
    models = (CourseRelease, CourseReleaseUnit, CourseClassReleaseBinding)
    assert {model.__table__.name for model in models} == PUBLICATION_TABLES
    assert Course.__table__.c.content_draft_revision.nullable is False
    assert ContentDraft.__table__.c.course_id.nullable is True
    assert ContentDraft.__table__.c.course_unit_id.nullable is True
    assert ContentDraft.__table__.c.revision.nullable is False

    for model in models:
        ddl = str(CreateTable(model.__table__).compile(dialect=mysql.dialect()))
        assert model.__table__.name in ddl
        assert "FOREIGN KEY" in ddl
        assert "DATETIME(6)" in ddl

    release_ddl = str(
        CreateTable(CourseRelease.__table__).compile(dialect=mysql.dialect())
    )
    assert "uq_course_releases_course_number" in release_ddl
    assert "uq_course_releases_course_hash" in release_ddl
    assert "draft_revision" in release_ddl
    assert "completion_rule_snapshot" in release_ddl
    binding_ddl = str(
        CreateTable(CourseClassReleaseBinding.__table__).compile(
            dialect=mysql.dialect()
        )
    )
    assert "previous_binding_id" in binding_ddl
    assert "uq_course_class_release_binding_revision" in binding_ddl

    for model in models:
        assert event.contains(
            model,
            "before_update",
            publication_models._reject_append_only_mutation,
        )
        assert event.contains(
            model,
            "before_delete",
            publication_models._reject_append_only_mutation,
        )


def test_0057_empty_sqlite_upgrade_downgrade_reupgrade(tmp_path, monkeypatch):
    database_path = tmp_path / "course-publication-empty.db"
    database_url = f"sqlite+pysqlite:///{database_path.as_posix()}"
    config = _migration_config(database_url, monkeypatch)
    engine = create_engine(database_url)
    try:
        command.upgrade(config, "head")
        script = ScriptDirectory.from_config(config)
        assert script.get_heads() == ["20260825_0058"]
        inspector = inspect(engine)
        assert "checkpoint_attempts" in inspector.get_table_names()
        assert PUBLICATION_TABLES.issubset(inspector.get_table_names())
        assert "content_draft_revision" in {
            column["name"] for column in inspector.get_columns("courses")
        }
        content_draft_columns = {
            column["name"] for column in inspector.get_columns("content_drafts")
        }
        assert {"course_id", "course_unit_id", "revision"}.issubset(
            content_draft_columns
        )

        command.downgrade(config, "20260825_0056")
        inspector = inspect(engine)
        assert PUBLICATION_TABLES.isdisjoint(inspector.get_table_names())
        assert "content_draft_revision" not in {
            column["name"] for column in inspector.get_columns("courses")
        }
        content_draft_columns = {
            column["name"] for column in inspector.get_columns("content_drafts")
        }
        assert {"course_id", "course_unit_id", "revision"}.isdisjoint(
            content_draft_columns
        )

        command.upgrade(config, "head")
        assert PUBLICATION_TABLES.issubset(inspect(engine).get_table_names())
        with engine.connect() as connection:
            assert (
                connection.execute(
                    text("SELECT version_num FROM alembic_version")
                ).scalar_one()
                    == "20260825_0058"
            )
    finally:
        engine.dispose()
        _reset_migration_environment()


def test_0057_preserves_approved_courses_without_creating_placeholder_releases(
    tmp_path,
    monkeypatch,
):
    database_path = tmp_path / "course-publication-existing.db"
    database_url = f"sqlite+pysqlite:///{database_path.as_posix()}"
    config = _migration_config(database_url, monkeypatch)
    engine = create_engine(database_url)
    try:
        command.upgrade(config, "20260825_0056")
        _insert_0056_approved_course(engine)

        command.upgrade(config, "20260825_0057")
        with engine.connect() as connection:
            assert connection.execute(
                text("SELECT id, content_draft_revision FROM courses")
            ).one() == (1, 0)
            assert (
                connection.execute(
                    text("SELECT COUNT(*) FROM course_releases")
                ).scalar_one()
                == 0
            )
            assert (
                connection.execute(
                    text("SELECT COUNT(*) FROM course_class_release_bindings")
                ).scalar_one()
                == 0
            )
            assert (
                connection.execute(
                    text("SELECT COUNT(*) FROM course_units")
                ).scalar_one()
                == 0
            )

        command.downgrade(config, "20260825_0056")
        with engine.connect() as connection:
            assert connection.execute(
                text("SELECT title FROM courses")
            ).scalar_one() == ("Approved Empty Course")
            assert (
                connection.execute(
                    text("SELECT COUNT(*) FROM course_classes")
                ).scalar_one()
                == 1
            )
    finally:
        engine.dispose()
        _reset_migration_environment()


def _migration_config(database_url: str, monkeypatch) -> Config:
    backend_root = Path(__file__).resolve().parents[1]
    monkeypatch.setenv("ASTRA_DATABASE_URL", database_url)
    get_settings.cache_clear()
    reset_database_state()
    config = Config(str(backend_root / "alembic.ini"))
    config.set_main_option("script_location", str(backend_root / "alembic"))
    return config


def _reset_migration_environment() -> None:
    reset_database_state()
    get_settings.cache_clear()


def _insert_0056_approved_course(engine) -> None:
    now = datetime(2026, 8, 25, 12, 0, tzinfo=UTC).isoformat()
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO users "
                "(id, username, normalized_username, display_name, password_hash, role, status, "
                "created_at, updated_at) VALUES "
                "(1, 'release_teacher', 'release_teacher', 'Release Teacher', 'hash', "
                "'teacher', 'active', :now, :now)"
            ),
            {"now": now},
        )
        connection.execute(
            text(
                "INSERT INTO schools (id, name, status, version, created_at, updated_at) "
                "VALUES (1, 'Release School', 'active', 1, :now, :now)"
            ),
            {"now": now},
        )
        connection.execute(
            text(
                "INSERT INTO class_groups "
                "(id, school_id, name, kind, status, version, created_at, updated_at) "
                "VALUES (1, 1, 'Course Cohort', 'course_cohort', 'active', 1, :now, :now)"
            ),
            {"now": now},
        )
        connection.execute(
            text(
                "INSERT INTO courses "
                "(id, school_id, creator_user_id, galaxy_key, subject_key, course_key, title, "
                "summary, course_code, admission_mode, status, created_at, updated_at) VALUES "
                "(1, 1, 1, 'englab', 'physics', 'approved-empty-course', "
                "'Approved Empty Course', 'No placeholder release', 'ABCDEFGH', 'open', "
                "'published', :now, :now)"
            ),
            {"now": now},
        )
        connection.execute(
            text(
                "INSERT INTO course_classes "
                "(id, course_id, class_id, status, plan_version, created_at, updated_at) "
                "VALUES (1, 1, 1, 'active', 1, :now, :now)"
            ),
            {"now": now},
        )
