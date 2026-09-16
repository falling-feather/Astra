"""Functional storage boundaries for the first v2 migration block."""

from datetime import UTC, datetime

import pytest
from alembic import command
from sqlalchemy import MetaData, Table, create_engine, inspect, select, text
from sqlalchemy.dialects import mysql
from sqlalchemy.orm import Session
from sqlalchemy.schema import CreateTable

from app.models import (
    CourseCandidate, CourseChangeBatch, CourseFamily, CoursePublicationOperation,
    CourseRevision, CourseReviewItem, LearningResource, LearningResourceVersion,
)
from test_content_platform_storage import (
    _insert_0056_approved_course, _migration_config, _reset_migration_environment,
)

FOUNDATION = (
    LearningResource, LearningResourceVersion, CourseFamily, CourseRevision,
    CourseChangeBatch, CourseCandidate, CourseReviewItem, CoursePublicationOperation,
)


@pytest.fixture()
def migration_database(tmp_path, monkeypatch):
    url = f"sqlite+pysqlite:///{(tmp_path / 'workflow.db').as_posix()}"
    config = _migration_config(url, monkeypatch)
    engine = create_engine(url)
    try:
        yield config, engine
    finally:
        engine.dispose()
        _reset_migration_environment()


def test_independent_legacy_roots_roundtrip_without_fabricated_review(migration_database):
    config, engine = migration_database
    command.upgrade(config, "20260908_0060")
    _insert_0056_approved_course(engine)
    metadata = MetaData()
    courses = Table("courses", metadata, autoload_with=engine)
    units = Table("course_units", metadata, autoload_with=engine)
    releases = Table("course_releases", metadata, autoload_with=engine)
    with engine.begin() as connection:
        old = dict(connection.execute(select(courses)).mappings().one())
        connection.execute(courses.insert().values(**{
            **old, "id": 2, "course_key": "another-course", "title": "Another physics course", "course_code": "BCDEFGHI",
        }))
        for course_id in (1, 2):
            connection.execute(units.insert().values(
                id=course_id, course_id=course_id, activity_key="physics.mechanics", title="Same system resource",
                position=1, content_slug=f"courses/{course_id}/physics.mechanics", status="published",
                created_at=datetime.now(UTC), updated_at=datetime.now(UTC),
            ))
        connection.execute(releases.insert().values(
            id=1, course_id=1, release_number=1, draft_revision=0,
            schema_version="legacy-snapshot", status="published", title_snapshot="Original title",
            completion_rule_sha256="1" * 64, completion_rule_snapshot={}, package_sha256="2" * 64,
            published_by_user_id=1, published_at=datetime.now(UTC), created_at=datetime.now(UTC),
        ))
    for _round in range(2):
        command.upgrade(config, "head")
        with engine.connect() as connection:
            lineage = connection.execute(text("SELECT id, family_id, source_course_id, source_release_id FROM courses ORDER BY id")).all()
            assert lineage == [(1, 1, None, None), (2, 2, None, None)]
            assert connection.execute(text("SELECT family_key FROM course_families ORDER BY id")).scalars().all() == ["legacy-course-1", "legacy-course-2"]
            assert connection.execute(text("SELECT origin_key FROM course_units ORDER BY id")).scalars().all() == ["legacy-unit-1", "legacy-unit-2"]
            assert connection.execute(text("SELECT title_snapshot, candidate_id FROM course_releases")).one() == ("Original title", None)
            assert connection.execute(text("SELECT COUNT(*) FROM course_review_items")).scalar_one() == 0
        command.downgrade(config, "20260908_0060")
        with engine.connect() as connection:
            assert connection.execute(text("SELECT COUNT(*) FROM courses")).scalar_one() == 2
            assert connection.execute(text("SELECT COUNT(*) FROM course_units")).scalar_one() == 2
            assert connection.execute(text("SELECT package_sha256 FROM course_releases")).scalar_one() == "2" * 64


def test_resource_versions_are_immutable_and_lossy_downgrade_is_rejected(migration_database):
    config, engine = migration_database
    command.upgrade(config, "head")
    with Session(engine) as db:
        resource = LearningResource(resource_key="history.source", space_key="archives", subject_key="history", kind="activity")
        db.add(resource)
        db.flush()
        version = LearningResourceVersion(resource_id=resource.id, version_number=1, title="Evidence reading", renderer="legacy", definition_json={"entry": "labs/index.html"}, capabilities_json={"records_operations": False}, provenance_json={"kind": "test"}, content_sha256="a" * 64)
        db.add(version)
        db.commit()
        version_id = version.id
        version.title = "Silently overwritten"
        with pytest.raises(ValueError, match="immutable"):
            db.commit()
        db.rollback()
        assert db.get(LearningResourceVersion, version_id).title == "Evidence reading"
        db.delete(db.get(LearningResourceVersion, version_id))
        with pytest.raises(ValueError, match="immutable"):
            db.commit()
        db.rollback()
    with pytest.raises(RuntimeError, match="Cannot downgrade populated v2"):
        command.downgrade(config, "20260908_0060")
    with engine.connect() as connection:
        assert connection.execute(text("SELECT COUNT(*) FROM learning_resource_versions")).scalar_one() == 1
        assert connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == "20260916_0061"


def test_only_one_submitted_candidate_per_course_but_reviewed_history_remains(migration_database):
    config, engine = migration_database
    command.upgrade(config, "20260908_0060")
    _insert_0056_approved_course(engine)
    command.upgrade(config, "head")
    now = datetime.now(UTC)
    with engine.begin() as connection:
        connection.execute(text("INSERT INTO course_revisions (id, course_id, revision_number, snapshot_json, content_sha256, created_by_user_id, created_at) VALUES (1, 1, 0, '{}', :sha, 1, :now)"), {"sha": "a" * 64, "now": now})
        for number in (1, 2):
            connection.execute(text("INSERT INTO course_change_batches (id, school_id, created_by_user_id, client_request_id, request_sha256, created_at) VALUES (:id, 1, 1, :key, :sha, :now)"), {"id": number, "key": str(number), "sha": "b" * 64, "now": now})
            connection.execute(text("INSERT INTO course_candidates (id, batch_id, course_id, revision_id, result_policy_json, impact_json, candidate_sha256, created_at) VALUES (:id, :id, 1, 1, '{}', '{}', :sha, :now)"), {"id": number, "sha": "c" * 64, "now": now})
    from sqlalchemy.exc import IntegrityError
    with Session(engine) as db:
        first = CourseReviewItem(candidate_id=1, course_id=1, school_id=1)
        db.add(first)
        db.commit()
        first_id = first.id
        db.add(CourseReviewItem(candidate_id=2, course_id=1, school_id=1))
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()
        first = db.get(CourseReviewItem, first_id)
        first.status, first.active_key, first.version = "approved", None, 2
        db.commit()
        db.add(CourseReviewItem(candidate_id=2, course_id=1, school_id=1))
        db.commit()
        assert len(db.scalars(select(CourseReviewItem)).all()) == 2


def test_foundation_tables_compile_for_mysql_without_loading_application_data():
    for model in FOUNDATION:
        ddl = str(CreateTable(model.__table__).compile(dialect=mysql.dialect()))
        assert model.__tablename__ in ddl
        assert "FOREIGN KEY" in ddl or model is LearningResource
    assert "uq_course_reviews_active" in str(CreateTable(CourseReviewItem.__table__).compile(dialect=mysql.dialect()))
