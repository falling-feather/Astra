from datetime import UTC, datetime
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError

from app.core.config import get_settings
from app.db.session import reset_database_state
from app.models import (
    Course,
    CourseAdmissionClass,
    CourseEnrollment,
    CourseInformationRevision,
    CourseJoinRequest,
)


def test_course_relationship_metadata_matches_planned_boundaries() -> None:
    assert Course.__table__.c.course_code.nullable is True
    assert Course.__table__.c.current_information_revision_id.nullable is True
    assert Course.__table__.c.admission_mode.nullable is False
    assert CourseInformationRevision.__tablename__ == "course_information_revisions"
    assert CourseAdmissionClass.__tablename__ == "course_admission_classes"
    assert CourseJoinRequest.__tablename__ == "course_join_requests"
    assert CourseEnrollment.__tablename__ == "course_enrollments"

    enrollment_uniques = {
        constraint.name
        for constraint in CourseEnrollment.__table__.constraints
        if constraint.name is not None
    }
    assert "uq_course_enrollments_course_student" in enrollment_uniques
    assert "uq_course_info_revisions_course_number" in {
        constraint.name
        for constraint in CourseInformationRevision.__table__.constraints
        if constraint.name is not None
    }


def test_0056_sqlite_roundtrip_preserves_legacy_courses(tmp_path, monkeypatch) -> None:
    database_path = tmp_path / "course-relationships-roundtrip.db"
    database_url = f"sqlite+pysqlite:///{database_path.as_posix()}"
    backend_root = Path(__file__).resolve().parents[1]
    monkeypatch.setenv("ASTRA_DATABASE_URL", database_url)
    get_settings.cache_clear()
    reset_database_state()
    config = Config(str(backend_root / "alembic.ini"))
    config.set_main_option("script_location", str(backend_root / "alembic"))
    try:
        command.upgrade(config, "20260825_0055")
        engine = create_engine(database_url)
        now = datetime.now(UTC).isoformat()
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO users "
                    "(id, username, normalized_username, display_name, password_hash, role, status, created_at, updated_at) "
                    "VALUES "
                    "(1, 'legacy_course_teacher', 'legacy_course_teacher', 'Legacy Teacher', "
                    "'hash', 'teacher', 'active', :now, :now), "
                    "(2, 'legacy_course_student', 'legacy_course_student', 'Legacy Student', "
                    "'hash', 'student', 'active', :now, :now)"
                ),
                {"now": now},
            )
            connection.execute(
                text(
                    "INSERT INTO schools (id, name, status, version, created_at, updated_at) "
                    "VALUES (1, 'Legacy Course School', 'active', 1, :now, :now)"
                ),
                {"now": now},
            )
            connection.execute(
                text(
                    "INSERT INTO class_groups "
                    "(id, school_id, name, kind, status, version, created_at, updated_at) "
                    "VALUES (1, 1, 'Legacy Homeroom', 'homeroom', 'active', 1, :now, :now)"
                ),
                {"now": now},
            )
            connection.execute(
                text(
                    "INSERT INTO courses "
                    "(id, school_id, creator_user_id, galaxy_key, subject_key, course_key, title, status, created_at, updated_at) "
                    "VALUES "
                    "(1, 1, 1, 'englab', 'physics', 'legacy-physics', 'Legacy Physics', 'published', :now, :now), "
                    "(2, 1, 1, 'englab', 'math', 'legacy-math', 'Legacy Mathematics', 'draft', :now, :now)"
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

        command.upgrade(config, "20260825_0056")
        inspector = inspect(engine)
        course_columns = {column["name"] for column in inspector.get_columns("courses")}
        assert {
            "course_code",
            "academic_year",
            "schedule_text",
            "total_hours",
            "admission_mode",
            "current_information_revision_id",
        }.issubset(course_columns)
        assert {
            "course_information_revisions",
            "course_admission_classes",
            "course_join_requests",
            "course_enrollments",
        }.issubset(set(inspector.get_table_names()))

        with engine.connect() as connection:
            legacy_rows = connection.execute(
                text(
                    "SELECT id, course_code, academic_year, schedule_text, total_hours, "
                    "admission_mode, current_information_revision_id "
                    "FROM courses ORDER BY id"
                )
            ).mappings().all()
        assert legacy_rows == [
            {
                "id": 1,
                "course_code": None,
                "academic_year": None,
                "schedule_text": None,
                "total_hours": None,
                "admission_mode": "class_restricted",
                "current_information_revision_id": None,
            },
            {
                "id": 2,
                "course_code": None,
                "academic_year": None,
                "schedule_text": None,
                "total_hours": None,
                "admission_mode": "open",
                "current_information_revision_id": None,
            },
        ]

        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO course_information_revisions "
                    "(id, course_id, revision_number, information_snapshot, teacher_ids_snapshot, "
                    "status, created_by_user_id, created_at, updated_at) "
                    "VALUES (1, 1, 1, :information, :teachers, 'draft', 1, :now, :now)"
                ),
                {
                    "information": '{"title":"Legacy Physics"}',
                    "teachers": "[1]",
                    "now": now,
                },
            )
            connection.execute(
                text(
                    "UPDATE courses SET current_information_revision_id = 1 WHERE id = 1"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO course_admission_classes "
                    "(id, course_id, class_id, status, created_at, updated_at) "
                    "VALUES (1, 1, 1, 'active', :now, :now)"
                ),
                {"now": now},
            )
            connection.execute(
                text(
                    "INSERT INTO course_join_requests "
                    "(id, course_id, student_id, source_class_id, request_number, status, created_at, updated_at) "
                    "VALUES (1, 1, 2, 1, 1, 'approved', :now, :now)"
                ),
                {"now": now},
            )
            connection.execute(
                text(
                    "INSERT INTO course_enrollments "
                    "(id, course_id, student_id, source_class_id, source, status, created_at, updated_at) "
                    "VALUES (1, 1, 2, 1, 'request', 'active', :now, :now)"
                ),
                {"now": now},
            )

        with pytest.raises(IntegrityError):
            with engine.begin() as connection:
                connection.execute(
                    text(
                        "INSERT INTO course_enrollments "
                        "(id, course_id, student_id, source, status, created_at, updated_at) "
                        "VALUES (2, 1, 2, 'teacher', 'active', :now, :now)"
                    ),
                    {"now": now},
                )

        command.downgrade(config, "20260825_0055")
        downgraded_inspector = inspect(engine)
        assert not {
            "course_information_revisions",
            "course_admission_classes",
            "course_join_requests",
            "course_enrollments",
        }.intersection(downgraded_inspector.get_table_names())
        assert "admission_mode" not in {
            column["name"] for column in downgraded_inspector.get_columns("courses")
        }
        with engine.connect() as connection:
            assert connection.execute(text("SELECT COUNT(*) FROM courses")).scalar_one() == 2
            assert connection.execute(text("SELECT COUNT(*) FROM course_classes")).scalar_one() == 1

        command.upgrade(config, "20260825_0056")
        with engine.connect() as connection:
            assert connection.execute(
                text("SELECT admission_mode FROM courses WHERE id = 1")
            ).scalar_one() == "class_restricted"
            assert connection.execute(
                text("SELECT admission_mode FROM courses WHERE id = 2")
            ).scalar_one() == "open"
            assert connection.execute(
                text("SELECT version_num FROM alembic_version")
            ).scalar_one() == "20260825_0056"
    finally:
        reset_database_state()
        get_settings.cache_clear()
